import './style.css';
import type { GameState, Operator, Interaction, NodePopup, Room, SharePanelBtn, PendingNode, SpeedSliderState, RadialMenu, RadialMenuItem, HudBtn } from './types';
import type { Vec2 } from './math/vec2';
import { C, OP_R, NODE_R, DEPLOY_PANEL_H, DEPLOY_OP_SPACING, GRID, DOOR_W, WALL_W, makeWaypoint } from './types';
import { startGameLoop } from './core/gameLoop';
import { initInput, getInput, clearFrameInput } from './core/inputManager';
import { ROOM_TEMPLATES, type RoomTemplateName, STAMP_TEMPLATES, STAMP_NAMES, type StampName } from './room/templates';
import { createOperator, resetOperatorId, resetOperator } from './operator/operator';
import { rebuildPathLUT } from './operator/pathFollower';
import { distance, copy, distToSegment, closestPointOnSegment } from './math/vec2';
import { updateSimulation, resetSimulation, startExecution } from './core/simulation';
import { renderGame, resetSharePanelAnim } from './rendering/renderer';
import { exportGIF, downloadBlob } from './export/gifExporter';
import { cornerFedRoom } from './room/templates';
import { makeWall, makeThreat, createEmptyRoom } from './room/room';

// ---- HTML ----
const app = document.getElementById('app')!;
app.innerHTML = `
<div id="menu-screen">
  <div class="menu-content">
    <div class="menu-header">
      <h1 class="menu-title">
        <span class="menu-title-flow">Flow</span>
        <span class="menu-title-kickers">Kickers</span>
      </h1>
      <div class="menu-swoosh">
        <svg viewBox="0 0 200 16" preserveAspectRatio="none"><path d="M0 12 C40 12, 60 2, 100 2 S160 12, 200 8" fill="none" stroke="var(--cream)" stroke-width="2.5" stroke-linecap="round" opacity=".3"/></svg>
      </div>
      <p class="menu-subtitle">Room Clearing Simulator</p>
    </div>

    <div class="menu-section">
      <label class="menu-label">Select Room</label>
      <div id="room-btns" class="menu-room-grid"></div>
    </div>

    <button id="btn-start" class="menu-start-btn">START MISSION</button>

    <div class="menu-code-section">
      <div class="menu-code-header">
        <label class="menu-label">Enter Room Code</label>
      </div>
      <div class="menu-code-row">
        <input id="menu-code-input" class="menu-code-input" type="text" placeholder="Paste room code here..." spellcheck="false" autocomplete="off" />
        <button id="btn-load-code" class="menu-code-btn">LOAD</button>
      </div>
      <p id="menu-code-error" class="menu-code-error"></p>
    </div>

    <div id="custom-maps-section" class="menu-section" style="display:none">
      <label class="menu-label">Your Custom Maps</label>
      <div id="custom-map-btns" class="menu-room-grid"></div>
    </div>

    <div class="menu-footer">
      <div class="menu-footer-row">
        <button id="btn-tut" class="menu-link-btn">How to Play</button>
        <button id="btn-build" class="menu-link-btn">Build Your Own</button>
      </div>
    </div>
  </div>
</div>

<div id="tut-screen" style="display:none">
  <div class="menu-content tut-content">
    <h2 class="tut-heading">How to Play</h2>
    <div class="tut-steps">
      <div class="tut-step"><span class="tut-num">1</span><span>Drag operators from the left panel onto the map to deploy them</span></div>
      <div class="tut-step"><span class="tut-num">2</span><span>Click a deployed operator, then click on the map to place waypoints</span></div>
      <div class="tut-step"><span class="tut-num">3</span><span>Right-click + drag to set <b>facing direction</b> at any point</span></div>
      <div class="tut-step"><span class="tut-num">4</span><span>Click a waypoint node to open options: hold, speed, delete, look-at</span></div>
      <div class="tut-step"><span class="tut-num">5</span><span>Press <b>Space</b> or click <b>GO</b> to execute the plan</span></div>
      <div class="tut-step"><span class="tut-num">6</span><span>Pause with <b>Space</b>, reset with <b>R</b></span></div>
    </div>
    <button id="btn-tut-back" class="menu-start-btn" style="margin-top:8px;">BACK TO MENU</button>
  </div>
</div>

<div id="build-screen" style="display:none">
  <div class="build-layout">
    <div class="build-canvas-area">
      <canvas id="build-cv"></canvas>
    </div>
    <div class="build-sidebar">
      <h2 class="build-title">BUILD YOUR OWN</h2>
      <div class="build-tools-section">
        <label class="menu-label">TOOLS</label>
        <div class="build-tools-grid">
          <button class="build-tool active" data-tool="line"><div class="build-tool-icon"><svg width="20" height="20" viewBox="0 0 20 20"><line x1="3" y1="17" x2="17" y2="3" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/></svg></div><span>Line</span><kbd>1</kbd></button>
          <button class="build-tool" data-tool="square"><div class="build-tool-icon"><svg width="20" height="20" viewBox="0 0 20 20"><rect x="3" y="3" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/></svg></div><span>Square</span><kbd>2</kbd></button>
          <button class="build-tool" data-tool="delete"><div class="build-tool-icon"><svg width="20" height="20" viewBox="0 0 20 20"><line x1="5" y1="5" x2="15" y2="15" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/><line x1="15" y1="5" x2="5" y2="15" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/></svg></div><span>Delete</span><kbd>3</kbd></button>
          <button class="build-tool" data-tool="door"><div class="build-tool-icon"><svg width="20" height="20" viewBox="0 0 20 20"><rect x="5" y="2" width="10" height="16" fill="none" stroke="currentColor" stroke-width="1.8" rx="1.5"/><circle cx="13" cy="11" r="1.5" fill="currentColor"/></svg></div><span>Door</span><kbd>4</kbd></button>
        </div>
      </div>
      <div class="build-tools-section">
        <label class="menu-label">MARKERS</label>
        <div class="build-tools-grid">
          <button class="build-tool" data-tool="threat"><div class="build-tool-icon"><svg width="20" height="20" viewBox="0 0 20 20"><circle cx="10" cy="10" r="7" fill="none" stroke="currentColor" stroke-width="1.5"/><line x1="10" y1="4.5" x2="10" y2="9" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><circle cx="10" cy="13" r="1.2" fill="currentColor"/></svg></div><span>Threat</span><kbd>5</kbd></button>
          <button class="build-tool" data-tool="entry"><div class="build-tool-icon"><svg width="20" height="20" viewBox="0 0 20 20"><path d="M10 3L10 13M6 9L10 13L14 9" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><line x1="4" y1="17" x2="16" y2="17" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg></div><span>Entry</span><kbd>6</kbd></button>
        </div>
      </div>
      <div class="build-tools-section">
        <label class="menu-label">ROOM STAMPS</label>
        <div class="build-stamps-grid" id="build-stamps"></div>
      </div>
      <div class="build-divider"></div>
      <div class="build-tools-section">
        <label class="menu-label">ACTIONS</label>
        <div class="build-actions-row">
          <button id="build-undo" class="build-action-btn">Undo</button>
          <button id="build-clear" class="build-action-btn build-action-danger">Clear All</button>
        </div>
      </div>
      <div class="build-tools-section">
        <label class="menu-label">SHARE CODE</label>
        <textarea id="build-code" class="build-textarea" rows="2" placeholder="Paste room code..."></textarea>
        <div class="build-actions-row">
          <button id="build-export" class="build-action-btn">Copy Code</button>
          <button id="build-import" class="build-action-btn">Load Code</button>
        </div>
      </div>
      <button id="build-save" class="menu-start-btn build-play-btn">SAVE THIS MAP</button>
      <button id="build-back" class="menu-link-btn" style="width:100%;justify-content:center;">Back to Menu</button>
    </div>
  </div>
</div>

<div id="save-modal" class="save-modal-overlay" style="display:none">
  <div class="save-modal">
    <h3 class="save-modal-title">Save Map</h3>
    <label class="menu-label" style="width:100%">MAP NAME</label>
    <input id="save-name-input" class="save-name-input" type="text" placeholder="Enter map name..." maxlength="32" autocomplete="off" />
    <div class="save-modal-btns">
      <button id="save-cancel" class="menu-link-btn">Cancel</button>
      <button id="save-confirm" class="menu-start-btn" style="flex:1;">SAVE</button>
    </div>
  </div>
</div>

<div id="game-screen" style="display:none">
  <canvas id="cv"></canvas>
</div>
`;

const canvas = document.getElementById('cv') as HTMLCanvasElement;

function sizeCanvas() {
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
}
sizeCanvas();
// resize handled below with buildCv
initInput(canvas);

// Build canvas
const buildCv = document.getElementById('build-cv') as HTMLCanvasElement;
function sizeBuildCanvas() {
  const area = document.querySelector('.build-canvas-area');
  if (!area) return;
  const rect = area.getBoundingClientRect();
  if (rect.width < 1 || rect.height < 1) return;
  buildCv.width = Math.round(rect.width);
  buildCv.height = Math.round(rect.height);
}
sizeBuildCanvas();
window.addEventListener('resize', () => { sizeCanvas(); sizeBuildCanvas(); });

// ---- State ----
let selRoom: RoomTemplateName = 'Corner Fed';
let selOpCount = 7;

const state: GameState = {
  screen: 'menu', mode: 'planning',
  room: cornerFedRoom(),
  operators: [], goCodesTriggered: { A: false, B: false, C: false },
  elapsedTime: 0, selectedOpId: null, playbackSpeed: 1, roomCleared: false,
  interaction: { type: 'idle' }, popup: null,
  camera: { x: 0, y: 0, zoom: 1 },
  isPanning: false, panStart: { x: 0, y: 0 }, panCamStart: { x: 0, y: 0 },
  hoveredHudBtn: null,
  sharePanel: { open: false, exporting: false, exportProgress: 0, gifBlob: null, copiedRoomCode: false },
  hoveredShareBtn: null,
  pendingNode: null,
  speedSlider: null,
  exportingGif: false,
  radialMenu: null,
  stages: [],
  currentStageIndex: 0,
  executingStageIndex: -1,
  isReplaying: false,
  stageJustCompleted: false,
  preGoSnapshot: null,
  viewingStageIndex: -1,
};

// ---- Build state ----
let customRoom: Room = createEmptyRoom();
type BuildToolType = 'line' | 'square' | 'delete' | 'door' | 'threat' | 'entry' | 'room';
let buildTool: BuildToolType = 'line';
let buildSelectedStamp: StampName = 'Simple Box';
let buildDragStart: Vec2 | null = null;
let buildDragEnd: Vec2 | null = null;
let buildMousePos: Vec2 = { x: 0, y: 0 };
let buildMouseDown = false;
let buildHoveredWall = -1;
let buildHistory: string[] = [];
let buildAnimT = 0;
let buildLastTime = performance.now();

// Build camera
let buildCam = { x: 400, y: 300, zoom: 1 };
let buildPanning = false;
let buildPanStart: Vec2 = { x: 0, y: 0 };
let buildPanCamStart: Vec2 = { x: 0, y: 0 };

function buildScreenToWorld(sx: number, sy: number): Vec2 {
  const w = buildCv.width, h = buildCv.height;
  return {
    x: (sx - w / 2) / buildCam.zoom + buildCam.x,
    y: (sy - h / 2) / buildCam.zoom + buildCam.y,
  };
}

function pushHistory() {
  buildHistory.push(JSON.stringify({
    w: customRoom.walls, t: customRoom.threats,
    e: customRoom.entryPoints, f: customRoom.floor,
  }));
  if (buildHistory.length > 50) buildHistory.shift();
}
function undoHistory() {
  if (!buildHistory.length) return;
  const d = JSON.parse(buildHistory.pop()!);
  customRoom.walls = d.w; customRoom.threats = d.t;
  customRoom.entryPoints = d.e; customRoom.floor = d.f;
}

// ---- Saved Maps (localStorage) ----
interface SavedMap {
  name: string;
  data: {
    w: number[][];
    t: number[][];
    e: number[][];
    f: number[][];
  };
  createdAt: number;
}

const SAVED_MAPS_KEY = 'flowkickers_saved_maps';

function loadSavedMaps(): SavedMap[] {
  try {
    const raw = localStorage.getItem(SAVED_MAPS_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

function saveMapsToStorage(maps: SavedMap[]) {
  localStorage.setItem(SAVED_MAPS_KEY, JSON.stringify(maps));
}

function saveCurrentMap(name: string) {
  const maps = loadSavedMaps();
  const mapData: SavedMap = {
    name,
    data: {
      w: customRoom.walls.map(w => [w.a.x, w.a.y, w.b.x, w.b.y, w.hasDoor ? (w.doorOpen ? 1 : 2) : 0, w.doorPos]),
      t: customRoom.threats.map(t => [t.position.x, t.position.y]),
      e: customRoom.entryPoints.map(e => [e.x, e.y]),
      f: customRoom.floor.map(p => [p.x, p.y]),
    },
    createdAt: Date.now(),
  };
  maps.push(mapData);
  saveMapsToStorage(maps);
  refreshCustomMapsUI();
}

function deleteSavedMap(index: number) {
  const maps = loadSavedMaps();
  maps.splice(index, 1);
  saveMapsToStorage(maps);
  refreshCustomMapsUI();
}

function roomFromSavedMap(mapData: SavedMap['data']): Room {
  return {
    name: 'Custom',
    walls: (mapData.w || []).map((w: number[]) => {
      const wall = makeWall(w[0], w[1], w[2], w[3], w[4] > 0, w[5] ?? 0.5);
      if (w[4] === 1) wall.doorOpen = true;
      return wall;
    }),
    threats: (mapData.t || []).map((t: number[]) => makeThreat(t[0], t[1])),
    entryPoints: (mapData.e || []).map((e: number[]) => ({ x: e[0], y: e[1] })),
    floor: (mapData.f || []).map((p: number[]) => ({ x: p[0], y: p[1] })),
  };
}

function startSavedMapMission(mapData: SavedMap['data']) {
  state.room = roomFromSavedMap(mapData);
  state.room.floor = computeFloorCells(state.room.walls);
  for (const w of state.room.walls) if (w.hasDoor) w.doorOpen = true;
  state.operators = [];
  state.selectedOpId = null;
  state.mode = 'planning';
  state.elapsedTime = 0;
  state.roomCleared = false;
  state.goCodesTriggered = { A: false, B: false, C: false };
  state.interaction = { type: 'idle' };
  state.popup = null;
  state.radialMenu = null;
  state.pendingNode = null;
  state.speedSlider = null;
  state.stages = [];
  state.currentStageIndex = 0;
  state.executingStageIndex = -1;
  state.isReplaying = false;
  resetOperatorId();
  for (let i = 0; i < selOpCount; i++) {
    state.operators.push(createOperator(i));
  }
  // Center camera on room
  if (state.room.walls.length > 0) {
    let cx = 0, cy = 0, count = 0;
    for (const w of state.room.walls) { cx += w.a.x + w.b.x; cy += w.a.y + w.b.y; count += 2; }
    cx /= count; cy /= count;
    state.camera = { x: cx, y: cy, zoom: 1 };
  } else {
    state.camera = { x: 500, y: 350, zoom: 1 };
  }
  show('game');
}

function refreshCustomMapsUI() {
  const maps = loadSavedMaps();
  const container = document.getElementById('custom-map-btns')!;
  const section = document.getElementById('custom-maps-section')!;
  container.innerHTML = '';

  if (maps.length === 0) {
    section.style.display = 'none';
    return;
  }

  section.style.display = '';
  for (let i = 0; i < maps.length; i++) {
    const map = maps[i];
    const card = document.createElement('div');
    card.className = 'room-card custom-map-card';
    card.innerHTML = `
      <div class="room-card-preview"><svg viewBox="0 0 60 48"><rect x="8" y="6" width="44" height="34" fill="none" stroke="var(--cream)" stroke-width="1.5" opacity=".35"/><text x="30" y="28" text-anchor="middle" fill="var(--cream)" font-size="10" opacity=".4" font-family="var(--mono)">MAP</text></svg></div>
      <span class="room-card-name">${map.name}</span>
      <button class="custom-map-delete" title="Delete map">&times;</button>
    `;
    const playBtn = card;
    playBtn.addEventListener('click', (e) => {
      if ((e.target as HTMLElement).classList.contains('custom-map-delete')) return;
      startSavedMapMission(map.data);
    });
    card.querySelector('.custom-map-delete')!.addEventListener('click', (e) => {
      e.stopPropagation();
      if (confirm(`Delete "${map.name}"?`)) {
        deleteSavedMap(i);
      }
    });
    container.appendChild(card);
  }
}

// Save modal logic
function openSaveModal() {
  if (customRoom.walls.length < 3) {
    alert('Add some walls before saving!');
    return;
  }
  const modal = document.getElementById('save-modal')!;
  const input = document.getElementById('save-name-input') as HTMLInputElement;
  modal.style.display = 'flex';
  input.value = '';
  input.focus();
}

function closeSaveModal() {
  document.getElementById('save-modal')!.style.display = 'none';
}

function confirmSave() {
  const input = document.getElementById('save-name-input') as HTMLInputElement;
  const name = input.value.trim();
  if (!name) {
    input.classList.add('shake');
    setTimeout(() => input.classList.remove('shake'), 400);
    return;
  }
  saveCurrentMap(name);
  closeSaveModal();
  show('menu');
}

document.getElementById('save-cancel')!.onclick = closeSaveModal;
document.getElementById('save-confirm')!.onclick = confirmSave;
document.getElementById('save-name-input')!.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') confirmSave();
  if (e.key === 'Escape') closeSaveModal();
});

// Initialize custom maps UI on load
refreshCustomMapsUI();

function snapGrid(v: number) { return Math.round(v / GRID) * GRID; }
function snapVec(p: Vec2): Vec2 { return { x: snapGrid(p.x), y: snapGrid(p.y) }; }

function snapAngle(start: Vec2, end: Vec2): Vec2 {
  const dx = end.x - start.x, dy = end.y - start.y;
  const len = Math.sqrt(dx * dx + dy * dy);
  if (len < 5) return end;
  const ang = Math.atan2(dy, dx);
  const SNAP = Math.PI / 12; // 15 degrees
  const snapped = Math.round(ang / SNAP) * SNAP;
  return { x: start.x + Math.cos(snapped) * len, y: start.y + Math.sin(snapped) * len };
}

function updateFloor() {
  customRoom.floor = computeFloorCells(customRoom.walls);
}

/** Compute enclosed floor cells using ray-casting.
 *  For each grid cell, cast rays in 4 cardinal directions.
 *  A cell is "enclosed" if rays hit walls in at least 3 of 4 directions. */
function computeFloorCells(walls: { a: Vec2; b: Vec2; hasDoor: boolean }[]): Vec2[] {
  if (walls.length < 3) return [];
  // Find bounding box of all walls
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const w of walls) {
    x0 = Math.min(x0, w.a.x, w.b.x); y0 = Math.min(y0, w.a.y, w.b.y);
    x1 = Math.max(x1, w.a.x, w.b.x); y1 = Math.max(y1, w.a.y, w.b.y);
  }
  // Expand slightly
  x0 = snapGrid(x0) - GRID; y0 = snapGrid(y0) - GRID;
  x1 = snapGrid(x1) + GRID; y1 = snapGrid(y1) + GRID;

  const cells: Vec2[] = [];
  const half = GRID / 2;

  for (let cx = x0; cx < x1; cx += GRID) {
    for (let cy = y0; cy < y1; cy += GRID) {
      const px = cx + half, py = cy + half;
      let dirs = 0;
      // Cast rays in 4 directions from cell center, check if each hits a wall
      if (rayHitsWall(px, py, 1, 0, walls)) dirs++;   // right
      if (rayHitsWall(px, py, -1, 0, walls)) dirs++;  // left
      if (rayHitsWall(px, py, 0, 1, walls)) dirs++;   // down
      if (rayHitsWall(px, py, 0, -1, walls)) dirs++;  // up
      if (dirs >= 3) cells.push({ x: cx, y: cy });
    }
  }
  return cells;
}

/** Check if a ray from (ox,oy) in direction (dx,dy) hits any wall segment */
function rayHitsWall(ox: number, oy: number, dx: number, dy: number, walls: { a: Vec2; b: Vec2 }[]): boolean {
  for (const w of walls) {
    // Ray-segment intersection
    const ex = w.b.x - w.a.x, ey = w.b.y - w.a.y;
    const denom = dx * ey - dy * ex;
    if (Math.abs(denom) < 1e-10) continue;
    const t = ((w.a.x - ox) * ey - (w.a.y - oy) * ex) / denom;
    const u = ((w.a.x - ox) * dy - (w.a.y - oy) * dx) / denom;
    if (t > 0.5 && u >= 0 && u <= 1) return true;
  }
  return false;
}

// ---- Wall merging: merge collinear overlapping walls into one ----
function mergeWalls() {
  const EPS = 2;
  let merged = true;
  while (merged) {
    merged = false;
    for (let i = 0; i < customRoom.walls.length && !merged; i++) {
      for (let j = i + 1; j < customRoom.walls.length && !merged; j++) {
        const a = customRoom.walls[i], b = customRoom.walls[j];
        if (a.hasDoor || b.hasDoor) continue;
        const m = tryMerge(a, b, EPS);
        if (m) {
          customRoom.walls[i] = m;
          customRoom.walls.splice(j, 1);
          merged = true;
        }
      }
    }
  }
}

function tryMerge(
  w1: { a: Vec2; b: Vec2 },
  w2: { a: Vec2; b: Vec2 },
  eps: number,
): ReturnType<typeof makeWall> | null {
  const dx1 = w1.b.x - w1.a.x, dy1 = w1.b.y - w1.a.y;
  const len1 = Math.sqrt(dx1 * dx1 + dy1 * dy1);
  if (len1 < 1) return null;
  const nx = -dy1 / len1, ny = dx1 / len1;
  const d2a = Math.abs((w2.a.x - w1.a.x) * nx + (w2.a.y - w1.a.y) * ny);
  const d2b = Math.abs((w2.b.x - w1.a.x) * nx + (w2.b.y - w1.a.y) * ny);
  if (d2a > eps || d2b > eps) return null;
  const ux = dx1 / len1, uy = dy1 / len1;
  const p = (v: Vec2) => (v.x - w1.a.x) * ux + (v.y - w1.a.y) * uy;
  const t1a = p(w1.a), t1b = p(w1.b);
  const t2a = p(w2.a), t2b = p(w2.b);
  const min1 = Math.min(t1a, t1b), max1 = Math.max(t1a, t1b);
  const min2 = Math.min(t2a, t2b), max2 = Math.max(t2a, t2b);
  if (max1 < min2 - eps || max2 < min1 - eps) return null;
  const minT = Math.min(min1, min2), maxT = Math.max(max1, max2);
  const ax = w1.a.x + ux * minT, ay = w1.a.y + uy * minT;
  const bx = w1.a.x + ux * maxT, by = w1.a.y + uy * maxT;
  return makeWall(Math.round(ax), Math.round(ay), Math.round(bx), Math.round(by));
}

// ---- Door slot helpers ----
const DOOR_SLOT_SPACING = 20;

function getDoorSlots(w: { a: Vec2; b: Vec2 }): number[] {
  const dx = w.b.x - w.a.x, dy = w.b.y - w.a.y;
  const len = Math.sqrt(dx * dx + dy * dy);
  if (len < DOOR_W + 10) return [];
  const margin = (DOOR_W / 2 + 4) / len;
  const usable = 1 - 2 * margin;
  if (usable <= 0) return [];
  const count = Math.max(1, Math.floor((usable * len) / DOOR_SLOT_SPACING) + 1);
  const slots: number[] = [];
  if (count === 1) { slots.push(0.5); }
  else { for (let i = 0; i < count; i++) slots.push(margin + (usable * i) / (count - 1)); }
  return slots;
}

let buildHoveredDoorSlot: { wallIdx: number; slotFrac: number } | null = null;

// ---- Menu ----
const ROOM_PREVIEWS: Record<string, string> = {
  'Corner Fed': '<svg viewBox="0 0 60 48"><rect x="6" y="4" width="48" height="36" fill="none" stroke="var(--cream)" stroke-width="1.5" opacity=".45"/><line x1="6" y1="40" x2="22" y2="40" stroke="var(--cream)" stroke-width="1.5" opacity=".2"/><line x1="34" y1="40" x2="54" y2="40" stroke="var(--cream)" stroke-width="1.5" opacity=".2"/><rect x="22" y="38" width="12" height="4" rx="1" fill="var(--cream)" opacity=".5"/></svg>',
  'Center Fed': '<svg viewBox="0 0 60 48"><rect x="4" y="4" width="52" height="36" fill="none" stroke="var(--cream)" stroke-width="1.5" opacity=".45"/><line x1="4" y1="40" x2="24" y2="40" stroke="var(--cream)" stroke-width="1.5" opacity=".2"/><line x1="36" y1="40" x2="56" y2="40" stroke="var(--cream)" stroke-width="1.5" opacity=".2"/><rect x="24" y="38" width="12" height="4" rx="1" fill="var(--cream)" opacity=".5"/></svg>',
  'L-Shape': '<svg viewBox="0 0 60 48"><path d="M4 4h52v20H28v20H4V4z" fill="none" stroke="var(--cream)" stroke-width="1.5" opacity=".45"/><rect x="10" y="42" width="10" height="3" rx="1" fill="var(--cream)" opacity=".5"/></svg>',
  'T-Shape': '<svg viewBox="0 0 60 48"><path d="M4 4h52v16H38v24H22V20H4V4z" fill="none" stroke="var(--cream)" stroke-width="1.5" opacity=".45"/><rect x="26" y="42" width="8" height="3" rx="1" fill="var(--cream)" opacity=".5"/></svg>',
  'Simple Box': '<svg viewBox="0 0 60 48"><rect x="10" y="6" width="40" height="34" fill="none" stroke="var(--cream)" stroke-width="1.5" opacity=".45"/><rect x="24" y="38" width="12" height="3" rx="1" fill="var(--cream)" opacity=".5"/></svg>',
};

const roomBtns = document.getElementById('room-btns')!;
for (const name of Object.keys(ROOM_TEMPLATES)) {
  const b = document.createElement('button');
  b.className = 'room-card';
  b.innerHTML = `<div class="room-card-preview">${ROOM_PREVIEWS[name] || ''}</div><span class="room-card-name">${name}</span>`;
  if (name === selRoom) b.classList.add('sel');
  b.onclick = () => { selRoom = name as RoomTemplateName; roomBtns.querySelectorAll('.room-card').forEach(x => x.classList.remove('sel')); b.classList.add('sel'); };
  roomBtns.appendChild(b);
}
// Operator count is always 7 - no selector needed

// Operator count is always 7 for build screen too - no selector needed

document.getElementById('btn-start')!.onclick = startMission;
document.getElementById('btn-tut')!.onclick = () => show('tut');
document.getElementById('btn-tut-back')!.onclick = () => show('menu');

// Load room from code input on menu
document.getElementById('btn-load-code')!.onclick = () => {
  const input = document.getElementById('menu-code-input') as HTMLInputElement;
  const errorEl = document.getElementById('menu-code-error')!;
  const code = input.value.trim();
  errorEl.textContent = '';
  if (!code) { errorEl.textContent = 'Paste a room code first'; return; }
  try {
    const d = JSON.parse(code);
    if (!d.w || !Array.isArray(d.w)) throw new Error('Missing wall data');
    startSavedMapMission(d);
    input.value = '';
  } catch {
    errorEl.textContent = 'Invalid room code';
  }
};
// Also allow Enter key in the code input
document.getElementById('menu-code-input')!.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') document.getElementById('btn-load-code')!.click();
});
document.getElementById('btn-build')!.onclick = () => {
  customRoom = createEmptyRoom();
  buildHistory = [];
  show('build');
};
document.getElementById('build-back')!.onclick = () => show('menu');
document.getElementById('build-save')!.onclick = openSaveModal;
document.getElementById('build-undo')!.onclick = undoHistory;
document.getElementById('build-clear')!.onclick = () => { pushHistory(); customRoom = createEmptyRoom(); };

// Build tools
document.querySelectorAll('.build-tool').forEach(btn => {
  btn.addEventListener('click', () => {
    buildTool = (btn as HTMLElement).dataset.tool as BuildToolType;
    document.querySelectorAll('.build-tool').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.build-stamp-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
  });
});

// Stamp template buttons
const stampsEl = document.getElementById('build-stamps')!;
const STAMP_SVG: Record<string, string> = {
  'Simple Box': '<svg viewBox="0 0 32 24"><rect x="2" y="2" width="28" height="20" fill="none" stroke="currentColor" stroke-width="1.5"/></svg>',
  'Corner Fed': '<svg viewBox="0 0 32 24"><rect x="2" y="2" width="28" height="20" fill="none" stroke="currentColor" stroke-width="1.5" opacity=".5"/><line x1="2" y1="22" x2="9" y2="22" stroke="currentColor" stroke-width="1.5"/><line x1="15" y1="22" x2="30" y2="22" stroke="currentColor" stroke-width="1.5"/></svg>',
  'Center Fed': '<svg viewBox="0 0 32 24"><rect x="2" y="2" width="28" height="20" fill="none" stroke="currentColor" stroke-width="1.5" opacity=".5"/><line x1="2" y1="22" x2="12" y2="22" stroke="currentColor" stroke-width="1.5"/><line x1="20" y1="22" x2="30" y2="22" stroke="currentColor" stroke-width="1.5"/></svg>',
  'L-Shape': '<svg viewBox="0 0 32 24"><path d="M2 2h28v10H18v10H2V2z" fill="none" stroke="currentColor" stroke-width="1.5"/></svg>',
  'T-Shape': '<svg viewBox="0 0 32 24"><path d="M2 2h28v8H22v12H10V10H2V2z" fill="none" stroke="currentColor" stroke-width="1.5"/></svg>',
};
for (const name of STAMP_NAMES) {
  const btn = document.createElement('button');
  btn.className = 'build-stamp-btn';
  btn.innerHTML = `<div class="build-stamp-icon">${STAMP_SVG[name] || ''}</div><span>${name}</span>`;
  btn.onclick = () => {
    buildTool = 'room';
    buildSelectedStamp = name;
    document.querySelectorAll('.build-tool').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.build-stamp-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
  };
  stampsEl.appendChild(btn);
}

// Share codes
document.getElementById('build-export')!.onclick = () => {
  const code = JSON.stringify({
    w: customRoom.walls.map(w => [w.a.x, w.a.y, w.b.x, w.b.y, w.hasDoor ? (w.doorOpen ? 1 : 2) : 0, w.doorPos]),
    t: customRoom.threats.map(t => [t.position.x, t.position.y]),
    e: customRoom.entryPoints.map(e => [e.x, e.y]),
    f: customRoom.floor.map(p => [p.x, p.y]),
  });
  (document.getElementById('build-code') as HTMLTextAreaElement).value = code;
  navigator.clipboard.writeText(code).catch(() => {});
};
document.getElementById('build-import')!.onclick = () => {
  try {
    const d = JSON.parse((document.getElementById('build-code') as HTMLTextAreaElement).value);
    pushHistory();
    customRoom.walls = (d.w || []).map((w: number[]) => {
      const wall = makeWall(w[0], w[1], w[2], w[3], w[4] > 0, w[5] ?? 0.5);
      if (w[4] === 1) wall.doorOpen = true;
      return wall;
    });
    customRoom.threats = (d.t || []).map((t: number[]) => makeThreat(t[0], t[1]));
    customRoom.entryPoints = (d.e || []).map((e: number[]) => ({ x: e[0], y: e[1] }));
    customRoom.floor = (d.f || []).map((p: number[]) => ({ x: p[0], y: p[1] }));
  } catch { alert('Invalid room code'); }
};

function show(s: 'menu' | 'tut' | 'build' | 'game') {
  const screens = {
    menu: document.getElementById('menu-screen')!,
    tut: document.getElementById('tut-screen')!,
    build: document.getElementById('build-screen')!,
    game: document.getElementById('game-screen')!,
  };

  // For each screen: if it's the target, make sure it's visible first then fade in
  // If it's not the target, fade out then hide
  for (const [key, el] of Object.entries(screens)) {
    if (key === s) {
      // Show this screen
      el.style.display = 'flex';
      // Force reflow before removing hidden class for transition
      el.offsetHeight;
      el.classList.remove('screen-hidden');
      el.style.opacity = '1';
      el.style.transform = 'none';
    } else {
      // Hide this screen instantly (no lingering)
      el.style.display = 'none';
      el.classList.add('screen-hidden');
    }
  }

  state.screen = s === 'game' ? 'game' : 'menu';
  if (s === 'game') {
    requestAnimationFrame(() => sizeCanvas());
  }
  if (s === 'build') {
    requestAnimationFrame(() => sizeBuildCanvas());
  }
  // Re-trigger entrance animation for menu-content when coming back to menu
  if (s === 'menu' || s === 'tut') {
    const content = screens[s].querySelector('.menu-content');
    if (content) {
      content.classList.remove('animate-enter');
      void (content as HTMLElement).offsetHeight;
      content.classList.add('animate-enter');
    }
  }
}

function startMission() {
  state.room = (ROOM_TEMPLATES as Record<string, () => Room>)[selRoom]();
  state.room.floor = computeFloorCells(state.room.walls);
  for (const w of state.room.walls) if (w.hasDoor) w.doorOpen = true;
  state.operators = [];
  state.selectedOpId = null;
  state.mode = 'planning';
  state.elapsedTime = 0;
  state.roomCleared = false;
  state.goCodesTriggered = { A: false, B: false, C: false };
  state.interaction = { type: 'idle' };
  state.popup = null;
  state.radialMenu = null;
  state.pendingNode = null;
  state.speedSlider = null;
  state.stages = [];
  state.currentStageIndex = 0;
  state.executingStageIndex = -1;
  state.isReplaying = false;
  resetOperatorId();
  for (let i = 0; i < selOpCount; i++) {
    state.operators.push(createOperator(i));
  }
  // Center camera on room
  if (state.room.walls.length > 0) {
    let cx = 0, cy = 0, count = 0;
    for (const w of state.room.walls) { cx += w.a.x + w.b.x; cy += w.a.y + w.b.y; count += 2; }
    cx /= count; cy /= count;
    state.camera = { x: cx, y: cy, zoom: 1 };
  } else {
    state.camera = { x: 500, y: 350, zoom: 1 };
  }
  show('game');
}

// startCustomMission removed - saved maps now launch through menu via startSavedMapMission

// ---- Keyboard ----
window.addEventListener('keydown', (e) => {
  if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement || e.target instanceof HTMLTextAreaElement) return;

  // Build screen shortcuts
  if (document.getElementById('build-screen')!.style.display !== 'none') {
    if (e.key === 'z' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); undoHistory(); return; }
    const toolKeys: Record<string, BuildToolType> = { '1': 'line', '2': 'square', '3': 'delete', '4': 'door', '5': 'threat', '6': 'entry' };
    if (toolKeys[e.key]) {
      buildTool = toolKeys[e.key];
      document.querySelectorAll('.build-tool').forEach(b => b.classList.remove('active'));
      document.querySelector(`.build-tool[data-tool="${buildTool}"]`)?.classList.add('active');
      return;
    }
    if (e.key === 'Escape') { show('menu'); return; }
    return;
  }

  if (state.screen !== 'game') return;

  // Share panel ESC handling (takes priority)
  if (e.key === 'Escape' && state.sharePanel.open && !state.sharePanel.exporting) {
    closeSharePanel();
    e.preventDefault();
    return;
  }

  switch (e.key) {
    case ' ':
      e.preventDefault();
      if (state.mode === 'planning') doGo();
      else if (state.mode === 'executing') { state.mode = 'paused'; }
      else if (state.mode === 'paused') { state.mode = 'executing'; }
      break;
    case 'r': case 'R': doReset(); break;
    case 'Escape':
      state.popup = null;
      state.radialMenu = null;
      state.pendingNode = null;
      state.speedSlider = null;
      if (state.interaction.type === 'placing_waypoints' || state.interaction.type === 'placing_pie' || state.interaction.type === 'speed_slider') state.interaction = { type: 'idle' };
      state.selectedOpId = null;
      break;
    case 'Delete': case 'Backspace': deleteSelected(); break;
  }
});

/** Save current paths as a stage, then prepare for next stage planning */
function saveStage() {
  if (state.mode !== 'planning') return;
  const deployed = state.operators.filter(o => o.deployed);
  if (deployed.length === 0) return;
  // Only save if at least one operator has a path in this stage
  if (!deployed.some(o => o.path.waypoints.length >= 2)) return;

  // Snapshot current paths into a stage
  const stage: import('./types').Stage = {
    operatorStates: deployed.map(op => ({
      opId: op.id,
      startPosition: { x: op.position.x, y: op.position.y },
      startAngle: op.angle,
      waypoints: JSON.parse(JSON.stringify(op.path.waypoints)),
      tempo: op.tempo,
    })),
  };
  state.stages.push(stage);
  state.currentStageIndex = state.stages.length;

  // Move operators to where their paths end (start of next stage)
  for (const op of deployed) {
    if (op.path.waypoints.length >= 2) {
      const lastWp = op.path.waypoints[op.path.waypoints.length - 1];
      op.position = { x: lastWp.position.x, y: lastWp.position.y };
      op.startPosition = { x: lastWp.position.x, y: lastWp.position.y };
      if (lastWp.facingOverride !== null) {
        op.angle = lastWp.facingOverride;
        op.startAngle = lastWp.facingOverride;
      }
    }
    // Clear path for next stage planning
    op.path.waypoints = [];
    op.path.splineLUT = null;
  }

  // Clear UI state
  state.popup = null;
  state.radialMenu = null;
  state.pendingNode = null;
  state.speedSlider = null;
  state.selectedOpId = null;
  state.interaction = { type: 'idle' };
}

/** Execute: save current paths as a temporary stage, snapshot pre-GO state, then run all stages */
function doGo() {
  if (state.mode !== 'planning') return;
  const deployed = state.operators.filter(o => o.deployed);
  if (deployed.length === 0) return;
  if (!deployed.some(o => o.path.waypoints.length >= 2) && state.stages.length === 0) return;

  // Save pre-GO snapshot so RESET can return to this exact state
  state.preGoSnapshot = {
    operatorStates: deployed.map(op => ({
      opId: op.id,
      startPosition: { x: op.position.x, y: op.position.y },
      startAngle: op.angle,
      waypoints: JSON.parse(JSON.stringify(op.path.waypoints)),
      tempo: op.tempo,
    })),
  };

  // Auto-save current paths as a stage if there are any
  if (deployed.some(o => o.path.waypoints.length >= 2)) {
    const stage: import('./types').Stage = {
      operatorStates: deployed.map(op => ({
        opId: op.id,
        startPosition: { x: op.position.x, y: op.position.y },
        startAngle: op.angle,
        waypoints: JSON.parse(JSON.stringify(op.path.waypoints)),
        tempo: op.tempo,
      })),
    };
    state.stages.push(stage);
  }

  if (state.stages.length === 0) return;

  state.popup = null;
  state.radialMenu = null;
  state.pendingNode = null;
  state.speedSlider = null;
  state.interaction = { type: 'idle' };
  state.stageJustCompleted = false;

  // Start executing from stage 0
  state.executingStageIndex = 0;
  state.isReplaying = false;
  loadAndExecuteStage(0);
}

/** Load a stage's paths onto operators and start executing */
function loadAndExecuteStage(stageIdx: number) {
  const stage = state.stages[stageIdx];
  if (!stage) return;

  state.executingStageIndex = stageIdx;
  state.elapsedTime = 0;
  state.goCodesTriggered = { A: false, B: false, C: false };

  // Restore operator positions and paths from this stage
  for (const snap of stage.operatorStates) {
    const op = state.operators.find(o => o.id === snap.opId);
    if (!op) continue;
    op.position = { x: snap.startPosition.x, y: snap.startPosition.y };
    op.startPosition = { x: snap.startPosition.x, y: snap.startPosition.y };
    op.angle = snap.startAngle;
    op.startAngle = snap.startAngle;
    op.path.waypoints = JSON.parse(JSON.stringify(snap.waypoints));
    op.tempo = snap.tempo;
    op.distanceTraveled = 0;
    op.currentWaypointIndex = 0;
    op.isHolding = false;
    op.isMoving = false;
    op.reachedEnd = false;
    op.smoothPosition = { x: op.position.x, y: op.position.y };
    rebuildPathLUT(op);
  }

  state.mode = 'executing';
  state.goCodesTriggered.A = true;
}

/** Check if current stage is done and advance to next */
function checkStageCompletion() {
  if (state.mode !== 'executing' || state.executingStageIndex < 0) return;
  const allDone = state.operators.every(
    o => !o.deployed || o.reachedEnd || o.path.waypoints.length === 0
  );
  if (!allDone) return;

  const nextStage = state.executingStageIndex + 1;
  if (nextStage < state.stages.length) {
    // Advance to next stage
    loadAndExecuteStage(nextStage);
  } else {
    // All stages done - pause and prompt to save stage
    state.mode = 'paused';
    state.stageJustCompleted = true;
  }
}

/** Replay all stages from the beginning */
function doReplay() {
  if (state.stages.length === 0) return;
  state.isReplaying = true;
  state.roomCleared = false;
  for (const t of state.room.threats) { t.neutralized = false; t.neutralizeTimer = 0; }
  loadAndExecuteStage(0);
}

/** Reset returns to pre-GO state with routes intact (if GO was pressed),
 *  or to initial state if no GO snapshot exists */
function doReset() {
  state.mode = 'planning';
  state.elapsedTime = 0;
  state.roomCleared = false;
  state.goCodesTriggered = { A: false, B: false, C: false };
  state.popup = null;
  state.radialMenu = null;
  state.pendingNode = null;
  state.speedSlider = null;
  state.interaction = { type: 'idle' };
  state.executingStageIndex = -1;
  state.isReplaying = false;
  state.stageJustCompleted = false;

  if (state.preGoSnapshot) {
    // Pop the auto-saved stage that doGo added
    state.stages.pop();
    state.currentStageIndex = state.stages.length;

    // Restore operator positions and paths from pre-GO snapshot
    for (const snap of state.preGoSnapshot.operatorStates) {
      const op = state.operators.find(o => o.id === snap.opId);
      if (!op) continue;
      op.position = { x: snap.startPosition.x, y: snap.startPosition.y };
      op.startPosition = { x: snap.startPosition.x, y: snap.startPosition.y };
      op.angle = snap.startAngle;
      op.startAngle = snap.startAngle;
      op.path.waypoints = JSON.parse(JSON.stringify(snap.waypoints));
      op.tempo = snap.tempo;
      op.distanceTraveled = 0;
      op.currentWaypointIndex = 0;
      op.isHolding = false;
      op.isMoving = false;
      op.reachedEnd = false;
      if (op.smoothPosition) op.smoothPosition = { x: op.position.x, y: op.position.y };
      rebuildPathLUT(op);
    }
    state.preGoSnapshot = null;
  } else {
    // No snapshot - full reset
    for (const op of state.operators) {
      if (op.deployed) resetOperator(op);
      op.path.waypoints = [];
      op.path.splineLUT = null;
      op.distanceTraveled = 0;
      op.currentWaypointIndex = 0;
      op.isHolding = false;
      op.isMoving = false;
      op.reachedEnd = false;
    }
    state.stages = [];
    state.currentStageIndex = 0;
  }
  for (const t of state.room.threats) { t.neutralized = false; t.neutralizeTimer = 0; }
}

/** Clear everything - operators, paths, stages, back to fresh deployment */
function doClearLevel() {
  state.mode = 'planning';
  state.elapsedTime = 0;
  state.roomCleared = false;
  state.goCodesTriggered = { A: false, B: false, C: false };
  state.popup = null;
  state.radialMenu = null;
  state.pendingNode = null;
  state.speedSlider = null;
  state.interaction = { type: 'idle' };
  state.executingStageIndex = -1;
  state.isReplaying = false;
  state.stageJustCompleted = false;
  state.preGoSnapshot = null;
  state.viewingStageIndex = -1;
  state.stages = [];
  state.currentStageIndex = 0;
  state.selectedOpId = null;
  // Undeploy all operators
  for (const op of state.operators) {
    op.deployed = false;
    op.position = { x: 0, y: 0 };
    op.startPosition = { x: 0, y: 0 };
    op.angle = 0;
    op.startAngle = 0;
    op.path.waypoints = [];
    op.path.splineLUT = null;
    op.distanceTraveled = 0;
    op.currentWaypointIndex = 0;
    op.isHolding = false;
    op.isMoving = false;
    op.reachedEnd = false;
  }
  for (const t of state.room.threats) { t.neutralized = false; t.neutralizeTimer = 0; }
}

function deleteSelected() {
  if (!state.popup || state.popup.wpIdx < 0) return;
  const op = state.operators.find(o => o.id === state.popup!.opId);
  if (!op || op.path.waypoints.length <= 2) return;
  op.path.waypoints.splice(state.popup.wpIdx, 1);
  rebuildPathLUT(op);
  state.popup = null;
}

function openSharePanel() {
  state.sharePanel = { open: true, exporting: false, exportProgress: 0, gifBlob: null, copiedRoomCode: false };
  state.hoveredShareBtn = null;
  if (state.mode === 'executing') state.mode = 'paused';
  // Reset share panel animation (renderer reads this)
  resetSharePanelAnim();
}

function closeSharePanel() {
  state.sharePanel.open = false;
  state.hoveredShareBtn = null;
}

async function doExportGif() {
  if (!state.operators.some(op => op.path.waypoints.length >= 2)) return;
  state.sharePanel.exporting = true;
  state.sharePanel.exportProgress = 0;
  state.sharePanel.gifBlob = null;
  try {
    const blob = await exportGIF(state, (p) => { state.sharePanel.exportProgress = p; });
    state.sharePanel.gifBlob = blob;
  } catch (err) {
    console.error(err);
    state.exportingGif = false;
  }
  state.sharePanel.exporting = false;
  doReset();
}

function downloadShareGif() {
  if (state.sharePanel.gifBlob) {
    downloadBlob(state.sharePanel.gifBlob, `flow-kickers-${Date.now()}.gif`);
  }
}

function getRoomShareCode(): string {
  return JSON.stringify({
    w: state.room.walls.map(w => [w.a.x, w.a.y, w.b.x, w.b.y, w.hasDoor ? (w.doorOpen ? 1 : 2) : 0, w.doorPos]),
    t: state.room.threats.map(t => [t.position.x, t.position.y]),
    e: state.room.entryPoints.map(e => [e.x, e.y]),
    f: state.room.floor.map(p => [p.x, p.y]),
  });
}

function copyRoomCode() {
  const code = getRoomShareCode();
  navigator.clipboard.writeText(code).then(() => {
    state.sharePanel.copiedRoomCode = true;
    setTimeout(() => { state.sharePanel.copiedRoomCode = false; }, 2000);
  }).catch(() => {});
}

// ---- Camera ----
/** Convert screen-space mouse pos to world-space (accounting for camera pan/zoom) */
function screenToWorld(screenPos: Vec2): Vec2 {
  const cam = state.camera;
  return {
    x: (screenPos.x - canvas.width / 2) / cam.zoom + cam.x,
    y: (screenPos.y - canvas.height / 2) / cam.zoom + cam.y,
  };
}

function handleCamera() {
  const input = getInput();

  // Scroll wheel zoom
  if (input.scrollDelta !== 0) {
    const zoomFactor = 1 + input.scrollDelta * 0.001;
    const oldZoom = state.camera.zoom;
    state.camera.zoom = Math.max(0.3, Math.min(3, oldZoom * zoomFactor));
    // Zoom toward mouse position
    const mouseWorld = screenToWorld(input.mousePos);
    state.camera.x += (mouseWorld.x - state.camera.x) * (1 - oldZoom / state.camera.zoom) * 0.3;
    state.camera.y += (mouseWorld.y - state.camera.y) * (1 - oldZoom / state.camera.zoom) * 0.3;
  }

  // Right-click pan (when not doing anything else)
  if (state.isPanning && input.rightMouseDown) {
    const dx = (input.mousePos.x - state.panStart.x) / state.camera.zoom;
    const dy = (input.mousePos.y - state.panStart.y) / state.camera.zoom;
    state.camera.x = state.panCamStart.x - dx;
    state.camera.y = state.panCamStart.y - dy;
  }
  if (state.isPanning && input.rightJustReleased) {
    state.isPanning = false;
  }
  // Also support middle-click pan as fallback
  if (input.middleJustPressed) {
    state.isPanning = true;
    state.panStart = { x: input.mousePos.x, y: input.mousePos.y };
    state.panCamStart = { x: state.camera.x, y: state.camera.y };
  }
  if (state.isPanning && input.middleMouseDown) {
    const dx = (input.mousePos.x - state.panStart.x) / state.camera.zoom;
    const dy = (input.mousePos.y - state.panStart.y) / state.camera.zoom;
    state.camera.x = state.panCamStart.x - dx;
    state.camera.y = state.panCamStart.y - dy;
  }
  if (input.middleJustReleased) {
    state.isPanning = false;
  }
}

function hitBtn(mouse: Vec2, x: number, y: number, w: number, h: number): boolean {
  return mouse.x >= x && mouse.x <= x + w && mouse.y >= y && mouse.y <= y + h;
}

// ---- Radial Menu Definitions ----
const RADIAL_R = 28; // radius of icon ring around center (world-space)
const RADIAL_ICON_R = 10; // radius of each icon hit area (world-space)

const OP_RADIAL_ITEMS: RadialMenuItem[] = [
  { id: 'direction', icon: 'direction', label: 'Direction' },
  { id: 'pie',       icon: 'pie',       label: 'Pie' },
  { id: 'route',     icon: 'route',     label: 'Route' },
  { id: 'speed',     icon: 'speed',     label: 'Speed' },
];

const NODE_RADIAL_ITEMS: RadialMenuItem[] = [
  { id: 'direction', icon: 'direction', label: 'Direction' },
  { id: 'route',     icon: 'route',     label: 'Add Route' },
  { id: 'delete',    icon: 'delete',    label: 'Delete' },
  { id: 'speed',     icon: 'speed',     label: 'Speed' },
  { id: 'hold',      icon: 'hold',      label: 'Hold' },
];

function getRadialItems(wpIdx: number): RadialMenuItem[] {
  return wpIdx < 0 ? OP_RADIAL_ITEMS : NODE_RADIAL_ITEMS;
}

/** Get world-space position of a radial menu icon */
function getRadialIconPos(center: Vec2, idx: number, total: number): Vec2 {
  const a = -Math.PI / 2 + (idx / total) * Math.PI * 2;
  return { x: center.x + Math.cos(a) * RADIAL_R, y: center.y + Math.sin(a) * RADIAL_R };
}

/** Hit-test radial menu icons in world-space, return index or -1 */
function hitTestRadialMenu(worldMouse: Vec2, menu: RadialMenu): number {
  const items = getRadialItems(menu.wpIdx);
  for (let i = 0; i < items.length; i++) {
    const p = getRadialIconPos(menu.center, i, items.length);
    if (distance(worldMouse, p) < RADIAL_ICON_R + 2) return i;
  }
  return -1;
}

// ---- Input ----
function handleInput() {
  const input = getInput();
  if (state.screen !== 'game') return;

  // Camera always updates (even during execution)
  handleCamera();

  // Get world-space mouse position for all game interactions
  const worldMouse = screenToWorld(input.mousePos);

  // Share panel interaction (blocks all other input when open)
  if (state.sharePanel.open) {
    const W = canvas.width, H = canvas.height;
    const sp = state.sharePanel;
    const panelW = 340, panelH = sp.gifBlob ? 330 : 300;
    const px = W / 2 - panelW / 2, py = H / 2 - panelH / 2;
    const mx = input.mousePos.x, my = input.mousePos.y;

    // Button layout constants (must match renderer exactly)
    const btnW = panelW - 40, btnH = 36, btnX = px + 20;
    const startY = py + 58;
    const gap = 10;
    const gifSectionY = startY + btnH + gap + 26;

    state.hoveredShareBtn = null;
    canvas.style.cursor = 'default';

    if (mx >= px && mx <= px + panelW && my >= py && my <= py + panelH) {
      // Close button (top-right)
      if (hitBtn(input.mousePos, px + panelW - 32, py + 8, 24, 24)) {
        state.hoveredShareBtn = 'close';
        canvas.style.cursor = 'pointer';
      }
      // Copy Room Code button
      else if (hitBtn(input.mousePos, btnX, startY, btnW, btnH)) {
        state.hoveredShareBtn = 'copy_code';
        canvas.style.cursor = 'pointer';
      }
      // GIF section buttons
      else if (!sp.exporting) {
        if (sp.gifBlob) {
          // Download GIF button
          if (hitBtn(input.mousePos, btnX, gifSectionY, btnW, btnH)) {
            state.hoveredShareBtn = 'download_gif';
            canvas.style.cursor = 'pointer';
          }
          // Re-export button (below download)
          else if (hitBtn(input.mousePos, btnX, gifSectionY + btnH + gap + 18, btnW, 30)) {
            state.hoveredShareBtn = 'export_gif';
            canvas.style.cursor = 'pointer';
          }
        } else {
          // Export GIF button
          if (hitBtn(input.mousePos, btnX, gifSectionY, btnW, btnH)) {
            state.hoveredShareBtn = 'export_gif';
            canvas.style.cursor = 'pointer';
          }
        }
      }
    }

    if (input.justPressed) {
      if (state.hoveredShareBtn === 'close') { closeSharePanel(); }
      else if (state.hoveredShareBtn === 'copy_code') { copyRoomCode(); }
      else if (state.hoveredShareBtn === 'export_gif') { doExportGif(); }
      else if (state.hoveredShareBtn === 'download_gif') { downloadShareGif(); }
      // Click outside panel closes it (but not during export)
      else if (!sp.exporting && !(mx >= px && mx <= px + panelW && my >= py && my <= py + panelH)) {
        closeSharePanel();
      }
    }
    return; // block all other input while share panel is open
  }

  // HUD hover detection (runs every frame, all modes)
  const hudBarY = canvas.height - 36;
  const W = canvas.width;
  const btnY = hudBarY + 5;
  // HUD button positions (must match renderer drawHUD exactly)
  // Layout: CLEAR(left) | ... [stage dots centered] ... | SAVE STAGE | GO! | RESET | REPLAY | SHARE(right)
  const rightBlockX = W / 2 + 20; // right side starts here
  const hudBtns = {
    clear_level: { x: 8, y: btnY, w: 56, h: 26 },
    menu: { x: 72, y: btnY, w: 50, h: 26 },
    save_stage: { x: rightBlockX, y: btnY, w: 100, h: 26 },
    go: { x: rightBlockX + 108, y: btnY, w: 70, h: 26 },
    reset: { x: rightBlockX + 186, y: btnY, w: 56, h: 26 },
    replay: { x: rightBlockX + 250, y: btnY, w: 60, h: 26 },
    share: { x: W - 64, y: btnY, w: 56, h: 26 },
  };
  if (input.mousePos.y > hudBarY) {
    canvas.style.cursor = 'default';
    state.hoveredHudBtn = null;
    for (const [key, b] of Object.entries(hudBtns)) {
      if (hitBtn(input.mousePos, b.x, b.y, b.w, b.h)) { state.hoveredHudBtn = key as HudBtn; break; }
    }
    if (state.hoveredHudBtn) canvas.style.cursor = 'pointer';
  } else {
    state.hoveredHudBtn = null;
    canvas.style.cursor = 'crosshair';
  }

  // HUD bar button clicks work in ALL modes (including executing)
  if (input.justPressed && input.mousePos.y > hudBarY) {
    const h = state.hoveredHudBtn;
    if (h === 'go') {
      if (state.mode === 'planning') doGo();
      else if (state.mode === 'executing') { state.mode = 'paused'; }
      else if (state.mode === 'paused') { state.mode = 'executing'; }
    }
    else if (h === 'save_stage') { saveStage(); state.stageJustCompleted = false; }
    else if (h === 'reset') doReset();
    else if (h === 'clear_level') doClearLevel();
    else if (h === 'menu') show('menu');
    else if (h === 'replay') doReplay();
    else if (h === 'share') openSharePanel();
    return;
  }

  if (state.mode === 'executing') return;
  const inter = state.interaction;

  // Speed slider interaction (takes priority when open)
  if (state.speedSlider && state.interaction.type === 'speed_slider') {
    const slider = state.speedSlider;
    const inter = state.interaction;
    const sliderX = slider.screenPos.x;
    const sliderY = slider.screenPos.y;
    const sliderW = 120, sliderH = 30;
    const trackX = sliderX + 10, trackW = sliderW - 20;
    const trackY = sliderY + sliderH / 2;

    // Check if mouse is near the slider track for dragging
    if (input.justPressed) {
      if (input.mousePos.x >= sliderX && input.mousePos.x <= sliderX + sliderW &&
          input.mousePos.y >= sliderY - 5 && input.mousePos.y <= sliderY + sliderH + 5) {
        slider.dragging = true;
      } else {
        // Click outside slider - close it and apply
        state.speedSlider = null;
        state.interaction = { type: 'idle' };
        state.popup = null;
        return;
      }
    }
    if (slider.dragging && input.mouseDown) {
      const frac = Math.max(0, Math.min(1, (input.mousePos.x - trackX) / trackW));
      const newTempo = Math.round((0.2 + frac * 2.8) * 10) / 10;
      slider.value = newTempo;
      const op = state.operators.find(o => o.id === inter.opId);
      if (op) {
        if (inter.wpIdx !== null) {
          op.path.waypoints[inter.wpIdx].tempo = newTempo;
        } else {
          op.tempo = newTempo;
        }
      }
    }
    if (input.justReleased) {
      slider.dragging = false;
    }
    return;
  }

  // Radial menu interaction (takes priority when open)
  if (state.radialMenu) {
    const menu = state.radialMenu;
    // Update hover state every frame
    menu.hoveredIdx = hitTestRadialMenu(worldMouse, menu);
    // Animate open
    if (menu.animT < 1) menu.animT = Math.min(1, menu.animT + 0.15);

    if (input.justPressed) {
      const items = getRadialItems(menu.wpIdx);
      if (menu.hoveredIdx >= 0) {
        const item = items[menu.hoveredIdx];
        const op = state.operators.find(o => o.id === menu.opId);
        if (op) {
          if (menu.wpIdx < 0) {
            // Operator radial menu actions
            if (item.id === 'direction') {
              state.interaction = { type: 'spinning_direction', opId: op.id };
            } else if (item.id === 'pie') {
              state.interaction = { type: 'placing_pie', opId: op.id };
            } else if (item.id === 'route') {
              if (op.path.waypoints.length === 0) {
                op.path.waypoints = [makeWaypoint(op.position)];
                op.path.splineLUT = null;
              }
              state.interaction = { type: 'placing_waypoints', opId: op.id };
            } else if (item.id === 'speed') {
              const cam2 = state.camera;
              const sp2 = { x: (op.position.x - cam2.x) * cam2.zoom + canvas.width / 2, y: (op.position.y - cam2.y) * cam2.zoom + canvas.height / 2 };
              state.speedSlider = { screenPos: { x: sp2.x + 20, y: sp2.y + 20 }, value: op.tempo, dragging: false };
              state.interaction = { type: 'speed_slider', opId: op.id, wpIdx: null, sliderValue: op.tempo };
            }
          } else {
            // Node radial menu actions
            const wp = op.path.waypoints[menu.wpIdx];
            if (item.id === 'direction') {
              state.interaction = { type: 'setting_facing', opId: op.id, wpIdx: menu.wpIdx };
            } else if (item.id === 'route') {
              state.interaction = { type: 'placing_waypoints', opId: op.id };
            } else if (item.id === 'delete') {
              if (op.path.waypoints.length > 2) {
                op.path.waypoints.splice(menu.wpIdx, 1);
                rebuildPathLUT(op);
              }
            } else if (item.id === 'speed') {
              const cam2 = state.camera;
              const sp2 = { x: (wp.position.x - cam2.x) * cam2.zoom + canvas.width / 2, y: (wp.position.y - cam2.y) * cam2.zoom + canvas.height / 2 };
              state.speedSlider = { screenPos: { x: sp2.x + 20, y: sp2.y + 20 }, value: wp.tempo, dragging: false };
              state.interaction = { type: 'speed_slider', opId: op.id, wpIdx: menu.wpIdx, sliderValue: wp.tempo };
            } else if (item.id === 'hold') {
              wp.hold = !wp.hold;
              if (wp.hold && !wp.goCode) wp.goCode = 'A';
            }
          }
        }
      }
      // Always close radial menu on click (whether item was hit or not)
      state.radialMenu = null;
      return;
    }
    if (input.rightJustPressed) {
      state.radialMenu = null;
      return;
    }
    return; // block other input while radial menu is open
  }

  // Legacy popup fallback (kept for compatibility)
  if (state.popup && input.justPressed) {
    state.popup = null;
    return;
  }

  if (inter.type === 'deploying_op') {
    const op = state.operators.find(o => o.id === inter.opId);
    if (op && input.mouseDown) op.position = copy(worldMouse);
    if (input.justReleased && op) {
      op.deployed = true;
      op.startPosition = copy(op.position);
      op.smoothPosition = copy(op.position);
      op.angle = 0; // face right when placed
      op.startAngle = 0;
      state.interaction = { type: 'idle' };
    }
    return;
  }

  if (inter.type === 'moving_op') {
    const op = state.operators.find(o => o.id === inter.opId);
    if (op && input.mouseDown && input.isDragging) {
      op.position = copy(worldMouse);
      op.startPosition = copy(op.position);
      // Keep waypoint 0 synced with operator position
      if (op.path.waypoints.length > 0) {
        op.path.waypoints[0].position = copy(worldMouse);
        rebuildPathLUT(op);
      }
    }
    if (input.justReleased) {
      if (!input.isDragging && op) {
        // Short click on already-selected op = open radial menu
        state.radialMenu = { center: copy(op.position), opId: op.id, wpIdx: -1, hoveredIdx: -1, animT: 0 };
      }
      state.interaction = { type: 'idle' };
    }
    return;
  }

  // Handle pending node confirm/cancel buttons (only while in placing_waypoints mode)
  if (state.pendingNode && inter.type === 'placing_waypoints' && input.justPressed) {
    const pn = state.pendingNode;
    const op = state.operators.find(o => o.id === pn.opId);
    if (op && pn.wpIdx < op.path.waypoints.length) {
      const wp = op.path.waypoints[pn.wpIdx];
      const cam2 = state.camera;
      const sp2 = {
        x: (wp.position.x - cam2.x) * cam2.zoom + canvas.width / 2,
        y: (wp.position.y - cam2.y) * cam2.zoom + canvas.height / 2,
      };
      // Check mark button (right side of node)
      const checkX = sp2.x + 14, checkY = sp2.y - 8, btnSize = 16;
      if (hitBtn(input.mousePos, checkX, checkY, btnSize, btnSize)) {
        // Confirm: keep the node, exit placing mode back to idle (selection mode)
        // Operator stays selected so user can drag nodes, set directions, etc.
        state.pendingNode = null;
        state.interaction = { type: 'idle' };
        return;
      }
      // X button (left side of node)
      const cancelX = sp2.x - 14 - btnSize, cancelY = sp2.y - 8;
      if (hitBtn(input.mousePos, cancelX, cancelY, btnSize, btnSize)) {
        // Cancel: remove the node, exit placing mode
        op.path.waypoints.splice(pn.wpIdx, 1);
        rebuildPathLUT(op);
        state.pendingNode = null;
        state.interaction = { type: 'idle' };
        return;
      }
    }
  }

  if (inter.type === 'placing_waypoints') {
    const op = state.operators.find(o => o.id === inter.opId);
    if (input.justPressed && op) {
      // check if clicking in deploy bar area - cancel waypoint placing
      const hudBarY = canvas.height - 36;
      const deployBarY = hudBarY - DEPLOY_PANEL_H - 4;
      if (input.mousePos.y > deployBarY) { state.interaction = { type: 'idle' }; state.pendingNode = null; return; }
      // Check if clicking on the current operator itself - open radial menu
      if (distance(worldMouse, op.position) < OP_R + 8) {
        state.interaction = { type: 'idle' };
        state.pendingNode = null;
        state.radialMenu = { center: copy(op.position), opId: op.id, wpIdx: -1, hoveredIdx: -1, animT: 0 };
        return;
      }
      op.path.waypoints.push(makeWaypoint(worldMouse));
      rebuildPathLUT(op);
      // Set this as pending node needing confirm/cancel
      state.pendingNode = { opId: op.id, wpIdx: op.path.waypoints.length - 1 };
    }
    if (input.rightJustPressed && op) { state.interaction = { type: 'idle' }; state.pendingNode = null; }
    return;
  }

  if (inter.type === 'setting_facing') {
    const op = state.operators.find(o => o.id === inter.opId);
    if (op) {
      const target = inter.wpIdx !== null ? op.path.waypoints[inter.wpIdx] : null;
      const origin = target ? target.position : op.position;
      // Continuously preview facing direction toward mouse
      const dx = worldMouse.x - origin.x, dy = worldMouse.y - origin.y;
      if (dx * dx + dy * dy > 64) {
        const a = Math.atan2(dy, dx);
        if (input.rightMouseDown || input.mouseDown) {
          if (target) { target.facingOverride = a; target.lookTarget = null; }
          else { op.angle = a; op.startAngle = a; }
        }
      }
    }
    // Left-click or right-click release confirms
    if (input.justReleased || input.rightJustReleased) state.interaction = { type: 'idle' };
    return;
  }

  if (inter.type === 'dragging_node') {
    const op = state.operators.find(o => o.id === inter.opId);
    if (op && input.mouseDown) {
      if (inter.wpIdx === 0) {
        // Node 0 IS the operator - move operator + sync node 0
        op.position = copy(worldMouse);
        op.startPosition = copy(worldMouse);
        op.path.waypoints[0].position = copy(worldMouse);
      } else {
        op.path.waypoints[inter.wpIdx].position = copy(worldMouse);
      }
      rebuildPathLUT(op);
    }
    if (input.justReleased) {
      if (!input.isDragging && op) {
        // Short click on node = open node radial menu (but not for node 0 - that's the operator)
        if (inter.wpIdx > 0) {
          state.radialMenu = { center: copy(op.path.waypoints[inter.wpIdx].position), opId: op.id, wpIdx: inter.wpIdx, hoveredIdx: -1, animT: 0 };
        }
      }
      state.interaction = { type: 'idle' };
    }
    return;
  }

  if (inter.type === 'setting_look_target') {
    if (input.justPressed) {
      const op = state.operators.find(o => o.id === inter.opId);
      if (op) { op.path.waypoints[inter.wpIdx].lookTarget = copy(worldMouse); op.path.waypoints[inter.wpIdx].facingOverride = null; }
      state.interaction = { type: 'idle' };
    }
    return;
  }

  if (inter.type === 'tempo_ring') {
    if (input.mouseDown) {
      const op = state.operators.find(o => o.id === inter.opId);
      if (op) {
        const target = inter.wpIdx !== null ? op.path.waypoints[inter.wpIdx] : null;
        const origin = target ? target.position : op.position;
        const a = Math.atan2(worldMouse.y - origin.y, worldMouse.x - origin.x);
        const norm = (a + Math.PI) / (2 * Math.PI);
        const tempo = Math.round((0.2 + norm * 2.8) * 10) / 10;
        if (target) target.tempo = tempo; else op.tempo = tempo;
      }
    }
    if (input.justReleased) state.interaction = { type: 'idle' };
    return;
  }

  if (inter.type === 'spinning_direction') {
    const op = state.operators.find(o => o.id === inter.opId);
    if (op) {
      // Continuously set facing toward mouse (tracks without clicking)
      const dx = worldMouse.x - op.position.x;
      const dy = worldMouse.y - op.position.y;
      if (dx * dx + dy * dy > 16) {
        op.angle = Math.atan2(dy, dx);
        op.startAngle = op.angle;
      }
    }
    // Click to confirm and exit direction mode
    if (input.justPressed) {
      state.interaction = { type: 'idle' };
      return;
    }
    // Right-click also exits
    if (input.rightJustPressed) {
      state.interaction = { type: 'idle' };
      return;
    }
    return;
  }

  if (inter.type === 'placing_pie') {
    const op = state.operators.find(o => o.id === inter.opId);
    if (input.justPressed && op) {
      op.pieTarget = copy(worldMouse);
      // Set initial facing toward pie target
      const dx = worldMouse.x - op.position.x;
      const dy = worldMouse.y - op.position.y;
      if (dx * dx + dy * dy > 16) {
        op.angle = Math.atan2(dy, dx);
        op.startAngle = op.angle;
      }
      state.interaction = { type: 'idle' };
      return;
    }
    if (input.rightJustPressed) {
      // Right-click cancels, also clears existing pie target
      if (op) op.pieTarget = null;
      state.interaction = { type: 'idle' };
      return;
    }
    return;
  }

  // IDLE: right-click
  if (input.rightJustPressed) {
    const selOp = state.operators.find(o => o.id === state.selectedOpId && o.deployed);
    if (selOp) {
      // Check if right-clicking near a waypoint node first
      for (let i = 1; i < selOp.path.waypoints.length; i++) {
        if (distance(worldMouse, selOp.path.waypoints[i].position) < NODE_R + 6) {
          state.interaction = { type: 'setting_facing', opId: selOp.id, wpIdx: i };
          return;
        }
      }
      // Otherwise: right-click anywhere with an operator selected = set that operator's direction
      state.interaction = { type: 'setting_facing', opId: selOp.id, wpIdx: null };
      return;
    }
    // No operator selected - start panning
    state.isPanning = true;
    state.panStart = { x: input.mousePos.x, y: input.mousePos.y };
    state.panCamStart = { x: state.camera.x, y: state.camera.y };
    return;
  }

  if (input.justPressed) {
    // Deploy bar hit test (screen-space) - horizontal row at bottom-left
    {
      const hudBarY2 = canvas.height - 36;
      const deployY = hudBarY2 - DEPLOY_PANEL_H / 2;
      const undeployed = state.operators.filter(o => !o.deployed);
      if (undeployed.length > 0 && input.mousePos.y > hudBarY2 - DEPLOY_PANEL_H - 8 && input.mousePos.y < hudBarY2) {
        for (let i = 0; i < undeployed.length; i++) {
          const opX = 30 + i * DEPLOY_OP_SPACING;
          if (Math.abs(input.mousePos.x - opX) < 16 && Math.abs(input.mousePos.y - deployY) < 18) {
            const op = undeployed[i];
            op.position = copy(worldMouse);
            state.interaction = { type: 'deploying_op', opId: op.id };
            state.selectedOpId = op.id;
            return;
          }
        }
      }
    }
    
    // HUD bar clicks already handled above

    // All game-world hit tests use worldMouse
    // Priority: selected operator's body/nodes/path FIRST, then other operators

    const selOp = state.operators.find(o => o.id === state.selectedOpId && o.deployed);
    if (selOp) {
      // 1. Selected operator body
      if (distance(worldMouse, selOp.position) < OP_R + 8) {
        state.interaction = { type: 'moving_op', opId: selOp.id };
        return;
      }
      // 2. Selected operator's path nodes
      for (let i = 1; i < selOp.path.waypoints.length; i++) {
        if (distance(worldMouse, selOp.path.waypoints[i].position) < NODE_R + 4) {
          state.interaction = { type: 'dragging_node', opId: selOp.id, wpIdx: i }; return;
        }
      }
      // 3. Selected operator's path spline (click to insert node)
      const lut = selOp.path.splineLUT;
      if (lut && lut.samples.length > 1) {
        let bestD = Infinity, bestI = -1;
        for (let i = 0; i < lut.samples.length - 1; i++) {
          const d = distToSegment(worldMouse, lut.samples[i], lut.samples[i + 1]);
          if (d < bestD) { bestD = d; bestI = i; }
        }
        if (bestD < 12) {
          const cp = closestPointOnSegment(worldMouse, lut.samples[bestI], lut.samples[bestI + 1]);
          const wc = selOp.path.waypoints.length;
          const frac = bestI / (lut.samples.length - 1);
          const insertAfter = Math.min(Math.floor(frac * (wc - 1)), wc - 2);
          selOp.path.waypoints.splice(insertAfter + 1, 0, makeWaypoint(cp));
          rebuildPathLUT(selOp);
          state.interaction = { type: 'dragging_node', opId: selOp.id, wpIdx: insertAfter + 1 };
          return;
        }
      }
    }

    // 4. Other operators (swap selection)
    for (const op of state.operators) {
      if (!op.deployed) continue;
      if (op.id === state.selectedOpId) continue; // already handled above
      if (distance(worldMouse, op.position) < OP_R + 8) {
        state.selectedOpId = op.id;
        state.popup = null;
        state.radialMenu = null;
        state.pendingNode = null;
        state.interaction = { type: 'idle' };
        return;
      }
    }

    if (state.interaction.type === 'idle') {
      state.selectedOpId = null; state.popup = null; state.radialMenu = null;
    }
  }
}

// ========== BUILD SCREEN INPUT ==========
function buildPos(e: MouseEvent): Vec2 {
  const r = buildCv.getBoundingClientRect();
  const sx = (e.clientX - r.left) * (buildCv.width / r.width);
  const sy = (e.clientY - r.top) * (buildCv.height / r.height);
  return buildScreenToWorld(sx, sy);
}
function buildScreenPos(e: MouseEvent): Vec2 {
  const r = buildCv.getBoundingClientRect();
  return { x: (e.clientX - r.left) * (buildCv.width / r.width), y: (e.clientY - r.top) * (buildCv.height / r.height) };
}

buildCv.addEventListener('mousemove', (e) => {
  buildMousePos = buildPos(e);
  if (buildTool === 'delete') {
    buildHoveredWall = -1;
    let best = 15;
    for (let i = 0; i < customRoom.walls.length; i++) {
      const d = distToSegment(buildMousePos, customRoom.walls[i].a, customRoom.walls[i].b);
      if (d < best) { best = d; buildHoveredWall = i; }
    }
  }
  if (buildTool === 'door') {
    // Find nearest door slot across all walls
    buildHoveredWall = -1;
    buildHoveredDoorSlot = null;
    let bestDist = 20;
    for (let i = 0; i < customRoom.walls.length; i++) {
      const w = customRoom.walls[i];
      const slots = getDoorSlots(w);
      const dx = w.b.x - w.a.x, dy = w.b.y - w.a.y;
      for (const frac of slots) {
        const sx = w.a.x + dx * frac, sy = w.a.y + dy * frac;
        const d = distance(buildMousePos, { x: sx, y: sy });
        if (d < bestDist) {
          bestDist = d;
          buildHoveredWall = i;
          buildHoveredDoorSlot = { wallIdx: i, slotFrac: frac };
        }
      }
    }
  }
  if (buildMouseDown && buildDragStart) {
    if (buildTool === 'line') buildDragEnd = snapAngle(buildDragStart, snapVec(buildMousePos));
    else if (buildTool === 'square' || buildTool === 'room') buildDragEnd = snapVec(buildMousePos);
  }
});

buildCv.addEventListener('mousedown', (e) => {
  if (e.button !== 0) return;
  const p = buildPos(e);
  buildMouseDown = true;

  if (buildTool === 'line' || buildTool === 'square' || buildTool === 'room') {
    buildDragStart = snapVec(p); buildDragEnd = null;
  } else if (buildTool === 'delete') {
    if (buildHoveredWall >= 0) { pushHistory(); customRoom.walls.splice(buildHoveredWall, 1); buildHoveredWall = -1; updateFloor(); }
  } else if (buildTool === 'door') {
    if (buildHoveredDoorSlot) {
      const w = customRoom.walls[buildHoveredDoorSlot.wallIdx];
      const clickedFrac = buildHoveredDoorSlot.slotFrac;
      pushHistory();
      if (!w.hasDoor) {
        // Place door at this slot
        w.hasDoor = true; w.doorOpen = true; w.doorPos = clickedFrac;
      } else if (Math.abs(w.doorPos - clickedFrac) < 0.05) {
        // Clicking on existing door position: cycle open -> closed -> remove
        if (w.doorOpen) { w.doorOpen = false; }
        else { w.hasDoor = false; w.doorOpen = false; }
      } else {
        // Clicking a different slot: move door there
        w.doorPos = clickedFrac; w.doorOpen = true;
      }
    }
  } else if (buildTool === 'threat') {
    pushHistory(); customRoom.threats.push(makeThreat(snapGrid(p.x), snapGrid(p.y)));
  } else if (buildTool === 'entry') {
    pushHistory(); customRoom.entryPoints.push({ x: snapGrid(p.x), y: snapGrid(p.y) });
  }
});

buildCv.addEventListener('mouseup', () => {
  if (!buildMouseDown) return;
  buildMouseDown = false;

  if (buildTool === 'line' && buildDragStart && buildDragEnd) {
    const s = buildDragStart, e = { x: snapGrid(buildDragEnd.x), y: snapGrid(buildDragEnd.y) };
    if (distance(s, e) > GRID * 0.5) { pushHistory(); customRoom.walls.push(makeWall(s.x, s.y, e.x, e.y)); mergeWalls(); updateFloor(); }
  } else if (buildTool === 'square' && buildDragStart && buildDragEnd) {
    const s = buildDragStart, e = buildDragEnd;
    const x0 = Math.min(s.x, e.x), y0 = Math.min(s.y, e.y), x1 = Math.max(s.x, e.x), y1 = Math.max(s.y, e.y);
    if (x1 - x0 > GRID * 0.5 && y1 - y0 > GRID * 0.5) {
      pushHistory();
      customRoom.walls.push(makeWall(x0, y0, x1, y0)); // top
      customRoom.walls.push(makeWall(x1, y0, x1, y1)); // right
      customRoom.walls.push(makeWall(x1, y1, x0, y1)); // bottom
      customRoom.walls.push(makeWall(x0, y1, x0, y0)); // left
      mergeWalls(); updateFloor();
    }
  } else if (buildTool === 'room' && buildDragStart && buildDragEnd) {
    const s = buildDragStart, e = buildDragEnd;
    const x0 = Math.min(s.x, e.x), y0 = Math.min(s.y, e.y), x1 = Math.max(s.x, e.x), y1 = Math.max(s.y, e.y);
    const rw = x1 - x0, rh = y1 - y0;
    if (rw > GRID * 1.5 && rh > GRID * 1.5) {
      pushHistory();
      const stampFn = STAMP_TEMPLATES[buildSelectedStamp];
      const newWalls = stampFn(x0, y0, rw, rh);
      customRoom.walls.push(...newWalls);
      mergeWalls(); updateFloor();
    }
  }
  buildDragStart = null; buildDragEnd = null;
});

buildCv.addEventListener('contextmenu', (e) => e.preventDefault());

// Build canvas zoom + pan
buildCv.addEventListener('wheel', (e) => {
  e.preventDefault();
  const factor = 1 - e.deltaY * 0.001;
  buildCam.zoom = Math.max(0.2, Math.min(4, buildCam.zoom * factor));
}, { passive: false });

buildCv.addEventListener('mousedown', (e2) => {
  if (e2.button === 2 || e2.button === 1) { // right click or middle click = pan
    e2.preventDefault();
    buildPanning = true;
    buildPanStart = buildScreenPos(e2);
    buildPanCamStart = { x: buildCam.x, y: buildCam.y };
  }
});
window.addEventListener('mousemove', (e2) => {
  if (buildPanning) {
    const sp = buildScreenPos(e2);
    buildCam.x = buildPanCamStart.x - (sp.x - buildPanStart.x) / buildCam.zoom;
    buildCam.y = buildPanCamStart.y - (sp.y - buildPanStart.y) / buildCam.zoom;
  }
});
window.addEventListener('mouseup', (e2) => {
  if (e2.button === 2 || e2.button === 1) buildPanning = false;
});

// ---- Game Loop ----
function update(dt: number) {
  if (state.screen !== 'game') return;
  handleInput();
  if (state.mode === 'executing') {
    updateSimulation(state, dt * state.playbackSpeed);
    checkStageCompletion();
  }
  clearFrameInput();
}

function renderFrame() {
  if (state.screen === 'game') renderGame(canvas, state);
  if (document.getElementById('build-screen')!.style.display !== 'none') renderBuild();
}

// ========== BUILD CANVAS RENDERING ==========
function renderBuild() {
  const ctx = buildCv.getContext('2d')!;
  const W = buildCv.width, H = buildCv.height;
  const now = performance.now();
  const buildDt = Math.min((now - buildLastTime) / 1000, 0.05);
  buildLastTime = now;
  buildAnimT += buildDt;

  // Background
  ctx.fillStyle = '#080e12';
  ctx.fillRect(0, 0, W, H);

  // Apply build camera
  ctx.save();
  ctx.translate(W / 2, H / 2);
  ctx.scale(buildCam.zoom, buildCam.zoom);
  ctx.translate(-buildCam.x, -buildCam.y);

  // Floor cells
  if (customRoom.floor.length > 0) {
    ctx.fillStyle = '#1a1814';
    for (const cell of customRoom.floor) {
      ctx.fillRect(cell.x, cell.y, GRID, GRID);
    }
  }

  // Grid dots (world space, only visible area)
  ctx.fillStyle = 'rgba(68,187,170,0.06)';
  {
    const vl = buildCam.x - W / 2 / buildCam.zoom, vt = buildCam.y - H / 2 / buildCam.zoom;
    const vr = buildCam.x + W / 2 / buildCam.zoom, vb = buildCam.y + H / 2 / buildCam.zoom;
    const gx0 = Math.floor(vl / GRID) * GRID, gy0 = Math.floor(vt / GRID) * GRID;
    for (let x = gx0; x <= vr; x += GRID) for (let y = gy0; y <= vb; y += GRID) {
      ctx.beginPath(); ctx.arc(x, y, 1 / buildCam.zoom, 0, Math.PI * 2); ctx.fill();
    }
  }

  // Crosshair guide lines
  if (buildTool !== 'delete' && buildTool !== 'door') {
    const sx = snapGrid(buildMousePos.x), sy = snapGrid(buildMousePos.y);
    const vl = buildCam.x - W / 2 / buildCam.zoom, vt = buildCam.y - H / 2 / buildCam.zoom;
    const vr = buildCam.x + W / 2 / buildCam.zoom, vb = buildCam.y + H / 2 / buildCam.zoom;
    ctx.strokeStyle = 'rgba(68,187,170,0.08)';
    ctx.lineWidth = 1 / buildCam.zoom; ctx.setLineDash([4 / buildCam.zoom, 10 / buildCam.zoom]);
    ctx.beginPath(); ctx.moveTo(sx, vt); ctx.lineTo(sx, vb); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(vl, sy); ctx.lineTo(vr, sy); ctx.stroke();
    ctx.setLineDash([]);
  }

  // ---- Walls ----
  for (let i = 0; i < customRoom.walls.length; i++) {
    const w = customRoom.walls[i];
    const hover = i === buildHoveredWall && (buildTool === 'delete' || buildTool === 'door');
    drawBuildWall(ctx, w, hover);
  }

  // ---- Preview: Line ----
  if (buildTool === 'line' && buildDragStart && buildDragEnd) {
    const s = buildDragStart, e = { x: snapGrid(buildDragEnd.x), y: snapGrid(buildDragEnd.y) };
    ctx.lineCap = 'round'; ctx.strokeStyle = 'rgba(68,187,170,0.45)'; ctx.lineWidth = 8;
    ctx.setLineDash([10, 6]);
    ctx.beginPath(); ctx.moveTo(s.x, s.y); ctx.lineTo(e.x, e.y); ctx.stroke();
    ctx.setLineDash([]);
    // Endpoints
    ctx.fillStyle = '#44bbaa';
    ctx.beginPath(); ctx.arc(s.x, s.y, 5, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(e.x, e.y, 5, 0, Math.PI * 2); ctx.fill();
    // Angle + length label
    const dx = e.x - s.x, dy = e.y - s.y;
    const deg = Math.round(Math.atan2(-dy, dx) * 180 / Math.PI);
    const len = Math.round(distance(s, e));
    ctx.fillStyle = 'rgba(68,187,170,0.8)'; ctx.font = 'bold 10px monospace'; ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
    ctx.fillText(`${deg}\u00B0  ${len}px`, (s.x + e.x) / 2, (s.y + e.y) / 2 - 14);
  }

  // ---- Preview: Square ----
  if (buildTool === 'square' && buildDragStart && buildDragEnd) {
    const s = buildDragStart, e = buildDragEnd;
    const x0 = Math.min(s.x, e.x), y0 = Math.min(s.y, e.y), x1 = Math.max(s.x, e.x), y1 = Math.max(s.y, e.y);
    ctx.strokeStyle = 'rgba(68,187,170,0.45)'; ctx.lineWidth = 8; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.setLineDash([10, 6]);
    ctx.strokeRect(x0, y0, x1 - x0, y1 - y0);
    ctx.setLineDash([]);
    // Corner dots
    ctx.fillStyle = '#44bbaa';
    for (const p of [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }]) {
      ctx.beginPath(); ctx.arc(p.x, p.y, 5, 0, Math.PI * 2); ctx.fill();
    }
    // Size label
    ctx.fillStyle = 'rgba(68,187,170,0.8)'; ctx.font = 'bold 10px monospace'; ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
    ctx.fillText(`${x1 - x0} \u00D7 ${y1 - y0}`, (x0 + x1) / 2, y0 - 10);
  }

  // ---- Preview: Room Stamp ----
  if (buildTool === 'room' && buildDragStart && buildDragEnd) {
    const s = buildDragStart, e = buildDragEnd;
    const x0 = Math.min(s.x, e.x), y0 = Math.min(s.y, e.y), x1 = Math.max(s.x, e.x), y1 = Math.max(s.y, e.y);
    const rw = x1 - x0, rh = y1 - y0;
    if (rw > GRID && rh > GRID) {
      const stampFn = STAMP_TEMPLATES[buildSelectedStamp];
      const previewWalls = stampFn(x0, y0, rw, rh);
      ctx.globalAlpha = 0.45;
      for (const pw of previewWalls) {
        ctx.lineCap = 'round'; ctx.lineWidth = 8;
        ctx.strokeStyle = pw.hasDoor ? 'rgba(192,160,96,0.5)' : 'rgba(68,187,170,0.5)';
        ctx.setLineDash([10, 6]);
        ctx.beginPath(); ctx.moveTo(pw.a.x, pw.a.y); ctx.lineTo(pw.b.x, pw.b.y); ctx.stroke();
        ctx.setLineDash([]);
      }
      ctx.globalAlpha = 1;
      // Corner dots
      ctx.fillStyle = '#44bbaa';
      for (const p of [{x:x0,y:y0},{x:x1,y:y0},{x:x1,y:y1},{x:x0,y:y1}]) {
        ctx.beginPath(); ctx.arc(p.x, p.y, 5, 0, Math.PI * 2); ctx.fill();
      }
      // Label
      ctx.fillStyle = 'rgba(68,187,170,0.8)'; ctx.font = 'bold 10px monospace'; ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
      ctx.fillText(buildSelectedStamp + ` ${rw}\u00D7${rh}`, (x0 + x1) / 2, y0 - 10);
    }
  }

  // ---- Threats ----
  for (const t of customRoom.threats) {
    ctx.fillStyle = 'rgba(200,50,50,0.12)';
    ctx.beginPath(); ctx.arc(t.position.x, t.position.y, 16, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#cc3333'; ctx.lineWidth = 3; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(t.position.x - 6, t.position.y - 6); ctx.lineTo(t.position.x + 6, t.position.y + 6); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(t.position.x + 6, t.position.y - 6); ctx.lineTo(t.position.x - 6, t.position.y + 6); ctx.stroke();
    ctx.fillStyle = 'rgba(204,51,51,0.5)'; ctx.font = '8px monospace'; ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    ctx.fillText('THREAT', t.position.x, t.position.y + 10);
  }

  // ---- Entry Points ----
  for (let i = 0; i < customRoom.entryPoints.length; i++) {
    const ep = customRoom.entryPoints[i];
    const pulse = buildAnimT * 20;
    ctx.strokeStyle = '#44bbaa'; ctx.lineWidth = 2;
    ctx.setLineDash([5, 5]); ctx.lineDashOffset = pulse;
    ctx.beginPath(); ctx.arc(ep.x, ep.y, 12, 0, Math.PI * 2); ctx.stroke();
    ctx.setLineDash([]); ctx.lineDashOffset = 0;
    ctx.fillStyle = '#44bbaa'; ctx.font = 'bold 13px monospace'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('\u2193', ep.x, ep.y);
    ctx.fillStyle = 'rgba(68,187,170,0.5)'; ctx.font = '8px monospace'; ctx.textBaseline = 'top';
    ctx.fillText(`ENTRY ${i + 1}`, ep.x, ep.y + 16);
  }

  // Snap cursor dot
  if (buildTool !== 'delete' && buildTool !== 'door') {
    const sx = snapGrid(buildMousePos.x), sy = snapGrid(buildMousePos.y);
    ctx.fillStyle = 'rgba(68,187,170,0.3)';
    ctx.beginPath(); ctx.arc(sx, sy, 4 / buildCam.zoom, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = 'rgba(68,187,170,0.5)'; ctx.lineWidth = 1 / buildCam.zoom;
    ctx.beginPath(); ctx.arc(sx, sy, 4 / buildCam.zoom, 0, Math.PI * 2); ctx.stroke();
  }

  // Delete cursor
  if (buildTool === 'delete' && buildHoveredWall < 0) {
    ctx.strokeStyle = 'rgba(255,80,60,0.25)'; ctx.lineWidth = 2; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(buildMousePos.x - 6, buildMousePos.y - 6); ctx.lineTo(buildMousePos.x + 6, buildMousePos.y + 6); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(buildMousePos.x + 6, buildMousePos.y - 6); ctx.lineTo(buildMousePos.x - 6, buildMousePos.y + 6); ctx.stroke();
  }

  // Door tool: show all slots on all walls
  if (buildTool === 'door') {
    for (let i = 0; i < customRoom.walls.length; i++) {
      const w = customRoom.walls[i];
      const slots = getDoorSlots(w);
      const dx = w.b.x - w.a.x, dy = w.b.y - w.a.y;
      for (const frac of slots) {
        const sx = w.a.x + dx * frac, sy = w.a.y + dy * frac;
        const isHovered = buildHoveredDoorSlot?.wallIdx === i && Math.abs(buildHoveredDoorSlot.slotFrac - frac) < 0.01;
        const isExisting = w.hasDoor && Math.abs(w.doorPos - frac) < 0.05;
        if (isExisting) continue; // don't draw slot dot over existing door
        const pulse = isHovered ? 0.5 + 0.5 * Math.sin(buildAnimT * 5) : 0;
        const alpha = isHovered ? 0.6 + pulse * 0.4 : 0.2;
        const r = isHovered ? 6 + pulse * 2 : 4;
        ctx.fillStyle = `rgba(192,160,96,${alpha})`;
        ctx.beginPath(); ctx.arc(sx, sy, r, 0, Math.PI * 2); ctx.fill();
        if (isHovered) {
          ctx.strokeStyle = `rgba(192,160,96,0.6)`; ctx.lineWidth = 1.5;
          ctx.beginPath(); ctx.arc(sx, sy, r + 3, 0, Math.PI * 2); ctx.stroke();
        }
      }
    }
  }

  // Restore camera for HUD (screen-space)
  ctx.restore();

  // Tool info HUD
  const toolLabel: Record<BuildToolType, string> = {
    line: 'LINE', square: 'SQUARE', delete: 'DELETE', door: 'DOOR', threat: 'THREAT', entry: 'ENTRY', room: buildSelectedStamp.toUpperCase(),
  };
  const toolHint: Record<BuildToolType, string> = {
    line: 'Drag to draw a wall. Snaps to 15\u00B0 increments.',
    square: 'Drag to create a rectangle of 4 walls.',
    delete: 'Click on any wall to remove it.',
    door: 'Click a slot on any wall to place or toggle a door.',
    threat: 'Click to place a threat marker.',
    entry: 'Click to place an operator entry point.',
    room: 'Drag to stamp a ' + buildSelectedStamp + ' room layout.',
  };
  ctx.fillStyle = 'rgba(8,14,18,0.85)';
  ctx.fillRect(6, 6, 320, 32);
  ctx.strokeStyle = 'rgba(68,187,170,0.2)'; ctx.lineWidth = 1;
  ctx.strokeRect(6, 6, 320, 32);
  ctx.fillStyle = '#44bbaa'; ctx.font = 'bold 11px monospace'; ctx.textAlign = 'left'; ctx.textBaseline = 'top';
  ctx.fillText(toolLabel[buildTool], 14, 11);
  ctx.fillStyle = 'rgba(138,170,153,0.6)'; ctx.font = '9px monospace';
  ctx.fillText(toolHint[buildTool], 14 + ctx.measureText(toolLabel[buildTool] + '  ').width + 8, 13);

  // Stats bar
  ctx.fillStyle = 'rgba(8,14,18,0.75)'; ctx.fillRect(0, H - 22, W, 22);
  ctx.strokeStyle = 'rgba(68,187,170,0.1)'; ctx.beginPath(); ctx.moveTo(0, H - 22); ctx.lineTo(W, H - 22); ctx.stroke();
  ctx.fillStyle = 'rgba(138,170,153,0.45)'; ctx.font = '9px monospace'; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
  const doors = customRoom.walls.filter(w => w.hasDoor).length;
  ctx.fillText(`Walls: ${customRoom.walls.length}  Doors: ${doors}  Threats: ${customRoom.threats.length}  Entries: ${customRoom.entryPoints.length}`, 10, H - 11);
  ctx.textAlign = 'right';
  ctx.fillText('[1-6] Tools  [Ctrl+Z] Undo', W - 10, H - 11);
}

function drawBuildWall(ctx: CanvasRenderingContext2D, w: { a: Vec2; b: Vec2; hasDoor: boolean; doorOpen: boolean; doorPos: number }, hover: boolean) {
  const { a, b } = w;
  const dx = b.x - a.x, dy = b.y - a.y, len = Math.sqrt(dx * dx + dy * dy);
  if (len < 1) return;

  if (w.hasDoor) {
    const dp = w.doorPos;
    const f = Math.min(DOOR_W / len, 0.9), gs = dp - f / 2, ge = dp + f / 2;
    // Wall segments
    ctx.lineCap = 'round';
    ctx.strokeStyle = hover ? '#ff6655' : '#d8cbb0';
    ctx.lineWidth = hover ? 10 : WALL_W;
    if (gs > 0.02) { ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(a.x + dx * gs, a.y + dy * gs); ctx.stroke(); }
    if (ge < 0.98) { ctx.beginPath(); ctx.moveTo(a.x + dx * ge, a.y + dy * ge); ctx.lineTo(b.x, b.y); ctx.stroke(); }
    // Door frame
    const nx = -dy / len, ny = dx / len;
    const dsx = a.x + dx * gs, dsy = a.y + dy * gs, dex = a.x + dx * ge, dey = a.y + dy * ge;
    if (w.doorOpen) {
      // Open: just frame marks, no door panel
      ctx.strokeStyle = '#5a8a5a'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(dsx + nx * 6, dsy + ny * 6); ctx.lineTo(dsx - nx * 6, dsy - ny * 6); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(dex + nx * 6, dey + ny * 6); ctx.lineTo(dex - nx * 6, dey - ny * 6); ctx.stroke();
      // no label text for open doors
    } else {
      // Closed: door panel across gap
      ctx.strokeStyle = '#8a6a3a'; ctx.lineWidth = 4;
      ctx.beginPath(); ctx.moveTo(dsx, dsy); ctx.lineTo(dex, dey); ctx.stroke();
      ctx.strokeStyle = '#8a6a3a'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(dsx + nx * 6, dsy + ny * 6); ctx.lineTo(dsx - nx * 6, dsy - ny * 6); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(dex + nx * 6, dey + ny * 6); ctx.lineTo(dex - nx * 6, dey - ny * 6); ctx.stroke();
      ctx.fillStyle = '#c0a060'; ctx.beginPath();
      ctx.arc((dsx + dex) / 2 + nx * 3, (dsy + dey) / 2 + ny * 3, 2.5, 0, Math.PI * 2); ctx.fill();
      // no label text for closed doors
    }
  } else {
    // Regular wall: outline + fill
    ctx.lineCap = 'round';
    ctx.strokeStyle = hover && buildTool === 'delete' ? 'rgba(255,80,60,0.25)' : 'rgba(0,0,0,0.4)';
    ctx.lineWidth = hover ? 12 : WALL_W + 2;
    ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
    ctx.strokeStyle = hover && buildTool === 'delete' ? '#ff6655' : hover && buildTool === 'door' ? '#c0a060' : '#d8cbb0';
    ctx.lineWidth = WALL_W;
    ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
    // Endpoint dots
    ctx.fillStyle = hover ? '#fff' : '#c8bca8';
    ctx.beginPath(); ctx.arc(a.x, a.y, 3, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(b.x, b.y, 3, 0, Math.PI * 2); ctx.fill();
  }
}

startGameLoop(update, renderFrame);
