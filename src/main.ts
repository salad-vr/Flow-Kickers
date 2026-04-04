import './style.css';
import type { GameState, Operator, Interaction, NodePopup, Room } from './types';
import type { Vec2 } from './math/vec2';
import { C, OP_R, NODE_R, DEPLOY_PANEL_H, DEPLOY_OP_SPACING, GRID, DOOR_W, WALL_W, makeWaypoint } from './types';
import { startGameLoop } from './core/gameLoop';
import { initInput, getInput, clearFrameInput } from './core/inputManager';
import { ROOM_TEMPLATES, type RoomTemplateName, STAMP_TEMPLATES, STAMP_NAMES, type StampName } from './room/templates';
import { createOperator, createDeployedOperator, resetOperatorId, resetOperator } from './operator/operator';
import { rebuildPathLUT } from './operator/pathFollower';
import { distance, copy, distToSegment, closestPointOnSegment } from './math/vec2';
import { updateSimulation, resetSimulation, startExecution } from './core/simulation';
import { renderGame } from './rendering/renderer';
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

    <div class="menu-section">
      <label class="menu-label">Operators</label>
      <div id="op-btns" class="menu-op-row"></div>
    </div>

    <button id="btn-start" class="menu-start-btn">START MISSION</button>

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
        <label class="menu-label">OPERATORS</label>
        <div id="build-op-btns" class="menu-op-row"></div>
      </div>
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
      <button id="build-play" class="menu-start-btn build-play-btn">PLAY THIS ROOM</button>
      <button id="build-back" class="menu-link-btn" style="width:100%;justify-content:center;">Back to Menu</button>
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
window.addEventListener('resize', sizeCanvas);
initInput(canvas);

// Build canvas
const buildCv = document.getElementById('build-cv') as HTMLCanvasElement;
buildCv.width = 800;
buildCv.height = 600;

// ---- State ----
let selRoom: RoomTemplateName = 'Corner Fed';
let selOpCount = 2;
let buildOpCount = 2;

const state: GameState = {
  screen: 'menu', mode: 'planning',
  room: cornerFedRoom(),
  operators: [], goCodesTriggered: { A: false, B: false, C: false },
  elapsedTime: 0, selectedOpId: null, playbackSpeed: 1, roomCleared: false,
  interaction: { type: 'idle' }, popup: null,
  camera: { x: 0, y: 0, zoom: 1 },
  isPanning: false, panStart: { x: 0, y: 0 }, panCamStart: { x: 0, y: 0 },
  hoveredHudBtn: null,
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
const opBtns = document.getElementById('op-btns')!;
for (let i = 1; i <= 6; i++) {
  const b = document.createElement('button');
  b.className = 'op-btn';
  b.textContent = String(i);
  if (i === selOpCount) b.classList.add('sel');
  b.onclick = () => { selOpCount = i; opBtns.querySelectorAll('.op-btn').forEach(x => x.classList.remove('sel')); b.classList.add('sel'); };
  opBtns.appendChild(b);
}

// Build operator selector
const buildOpBtns = document.getElementById('build-op-btns')!;
for (let i = 1; i <= 6; i++) {
  const b = document.createElement('button');
  b.className = 'op-btn';
  b.textContent = String(i);
  if (i === buildOpCount) b.classList.add('sel');
  b.onclick = () => { buildOpCount = i; buildOpBtns.querySelectorAll('.op-btn').forEach(x => x.classList.remove('sel')); b.classList.add('sel'); };
  buildOpBtns.appendChild(b);
}

document.getElementById('btn-start')!.onclick = startMission;
document.getElementById('btn-tut')!.onclick = () => show('tut');
document.getElementById('btn-tut-back')!.onclick = () => show('menu');
document.getElementById('btn-build')!.onclick = () => {
  customRoom = createEmptyRoom();
  buildHistory = [];
  show('build');
};
document.getElementById('build-back')!.onclick = () => show('menu');
document.getElementById('build-play')!.onclick = startCustomMission;
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
  document.getElementById('menu-screen')!.style.display = s === 'menu' ? 'flex' : 'none';
  document.getElementById('tut-screen')!.style.display = s === 'tut' ? 'flex' : 'none';
  document.getElementById('build-screen')!.style.display = s === 'build' ? 'flex' : 'none';
  document.getElementById('game-screen')!.style.display = s === 'game' ? 'flex' : 'none';
  state.screen = s === 'game' ? 'game' : 'menu';
  if (s === 'game') {
    // Re-size canvas now that game screen is visible
    requestAnimationFrame(() => sizeCanvas());
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

function startCustomMission() {
  state.room = JSON.parse(JSON.stringify(customRoom)) as Room;
  state.room.floor = computeFloorCells(state.room.walls);
  for (const w of state.room.walls) if (w.hasDoor && w.doorOpen) w.doorOpen = true;
  state.operators = [];
  state.selectedOpId = null;
  state.mode = 'planning';
  state.elapsedTime = 0;
  state.roomCleared = false;
  state.goCodesTriggered = { A: false, B: false, C: false };
  state.interaction = { type: 'idle' };
  state.popup = null;
  resetOperatorId();
  const entries = state.room.entryPoints;
  for (let i = 0; i < buildOpCount; i++) {
    let pos = { x: 500, y: 550 };
    if (i < entries.length) pos = { x: entries[i].x, y: entries[i].y };
    else if (entries.length > 0) {
      const base = entries[entries.length - 1];
      pos = { x: base.x + (i - entries.length + 1) * 35, y: base.y };
    }
    state.operators.push(createDeployedOperator(pos, i));
  }
  show('game');
}

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
      if (state.interaction.type === 'placing_waypoints') state.interaction = { type: 'idle' };
      state.selectedOpId = null;
      break;
    case 'Delete': case 'Backspace': deleteSelected(); break;
  }
});

function doGo() {
  if (state.mode !== 'planning') return;
  const deployed = state.operators.filter(o => o.deployed);
  if (deployed.length === 0) return;
  state.popup = null;
  state.interaction = { type: 'idle' };
  startExecution(state);
}

function doReset() {
  state.mode = 'planning';
  state.elapsedTime = 0;
  state.roomCleared = false;
  state.goCodesTriggered = { A: false, B: false, C: false };
  state.popup = null;
  state.interaction = { type: 'idle' };
  for (const op of state.operators) if (op.deployed) resetOperator(op);
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

async function doExport() {
  if (!state.operators.some(op => op.path.waypoints.length >= 2)) return;
  try {
    const blob = await exportGIF(state);
    downloadBlob(blob, `flow-kickers-${Date.now()}.gif`);
  } catch (err) { console.error(err); }
  doReset();
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

  // Middle-click pan
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

// ---- Input ----
function handleInput() {
  const input = getInput();
  if (state.screen !== 'game') return;

  // Camera always updates (even during execution)
  handleCamera();

  // Get world-space mouse position for all game interactions
  const worldMouse = screenToWorld(input.mousePos);

  // HUD hover detection (runs every frame, all modes)
  const hudBarY = canvas.height - 36;
  const W = canvas.width;
  const btnY = hudBarY + 5;
  if (input.mousePos.y > hudBarY) {
    canvas.style.cursor = 'default';
    if (hitBtn(input.mousePos, W / 2 - 40, btnY, 80, 26)) state.hoveredHudBtn = 'go';
    else if (hitBtn(input.mousePos, W / 2 + 50, btnY, 60, 26)) state.hoveredHudBtn = 'reset';
    else if (hitBtn(input.mousePos, W / 2 - 110, btnY, 60, 26)) state.hoveredHudBtn = 'menu';
    else if (hitBtn(input.mousePos, W - 56, btnY, 48, 26)) state.hoveredHudBtn = 'gif';
    else state.hoveredHudBtn = null;
    if (state.hoveredHudBtn) canvas.style.cursor = 'pointer';
  } else {
    state.hoveredHudBtn = null;
    canvas.style.cursor = 'crosshair';
  }

  // HUD bar button clicks work in ALL modes (including executing)
  if (input.justPressed && input.mousePos.y > hudBarY) {
    if (hitBtn(input.mousePos, W / 2 - 40, btnY, 80, 26)) {
      if (state.mode === 'planning') doGo();
      else if (state.mode === 'executing') { state.mode = 'paused'; }
      else if (state.mode === 'paused') { state.mode = 'executing'; }
    }
    else if (hitBtn(input.mousePos, W / 2 + 50, btnY, 60, 26)) doReset();
    else if (hitBtn(input.mousePos, W / 2 - 110, btnY, 60, 26)) show('menu');
    else if (hitBtn(input.mousePos, W - 56, btnY, 48, 26)) doExport();
    return; // always consume clicks in HUD bar
  }

  if (state.mode === 'executing') return;
  const inter = state.interaction;

  if (state.popup && input.justPressed) {
    // Check if clicking a popup menu item
    const pop = state.popup;
    const op = state.operators.find(o => o.id === pop.opId);
    const cam = state.camera;
    const W = canvas.width, H = canvas.height;
    const sp = { x: (pop.position.x - cam.x) * cam.zoom + W / 2, y: (pop.position.y - cam.y) * cam.zoom + H / 2 };
    const isOp = pop.wpIdx < 0;
    const items = isOp
      ? ['Draw Path', 'Direction', 'Speed', 'Clear Path']
      : ['Hold', 'Look At', 'Speed', 'Delete'];
    const iw = 70, ih = 24, gap = 4;
    const totalH = items.length * (ih + gap) - gap;
    const px = sp.x + 20, py = sp.y - totalH / 2;

    let clicked = -1;
    for (let i = 0; i < items.length; i++) {
      const iy = py + i * (ih + gap);
      if (hitBtn(input.mousePos, px, iy, iw, ih)) { clicked = i; break; }
    }

    if (clicked >= 0 && op) {
      if (isOp) {
        // Operator popup: Draw Path, Speed, Clear Path
        if (items[clicked] === 'Draw Path') {
          op.path.waypoints = [makeWaypoint(op.position)];
          op.path.splineLUT = null;
          state.interaction = { type: 'placing_waypoints', opId: op.id };
        } else if (items[clicked] === 'Direction') {
          state.interaction = { type: 'spinning_direction', opId: op.id };
        } else if (items[clicked] === 'Speed') {
          state.interaction = { type: 'tempo_ring', opId: op.id, wpIdx: null, centerAngle: 0, startTempo: op.tempo };
        } else if (items[clicked] === 'Clear Path') {
          op.path.waypoints = [];
          op.path.splineLUT = null;
        }
      } else {
        // Node popup: Hold, Look At, Speed, Delete
        const wp = op.path.waypoints[pop.wpIdx];
        if (items[clicked] === 'Hold') {
          wp.hold = !wp.hold;
          if (wp.hold && !wp.goCode) wp.goCode = 'A';
        } else if (items[clicked] === 'Look At') {
          state.interaction = { type: 'setting_look_target', opId: op.id, wpIdx: pop.wpIdx };
        } else if (items[clicked] === 'Speed') {
          state.interaction = { type: 'tempo_ring', opId: op.id, wpIdx: pop.wpIdx, centerAngle: 0, startTempo: wp.tempo };
        } else if (items[clicked] === 'Delete') {
          if (op.path.waypoints.length > 2) {
            op.path.waypoints.splice(pop.wpIdx, 1);
            rebuildPathLUT(op);
          }
        }
      }
    }
    state.popup = null;
    return;
  }

  if (inter.type === 'deploying_op') {
    const op = state.operators.find(o => o.id === inter.opId);
    if (op && input.mouseDown) op.position = copy(worldMouse);
    if (input.justReleased && op) {
      op.deployed = true;
      op.startPosition = copy(op.position);
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
    }
    if (input.justReleased) {
      if (!input.isDragging && op) {
        // Short click = open popup menu on operator
        state.popup = { opId: op.id, wpIdx: -1, position: copy(op.position) };
      }
      state.interaction = { type: 'idle' };
    }
    return;
  }

  if (inter.type === 'placing_waypoints') {
    const op = state.operators.find(o => o.id === inter.opId);
    if (input.justPressed && op) {
      // check if clicking in deploy bar area - cancel waypoint placing
      const hudBarY = canvas.height - 36;
      const deployBarY = hudBarY - DEPLOY_PANEL_H - 4;
      if (input.mousePos.y > deployBarY) { state.interaction = { type: 'idle' }; return; }
      op.path.waypoints.push(makeWaypoint(worldMouse));
      rebuildPathLUT(op);
    }
    if (input.rightJustPressed && op) state.interaction = { type: 'idle' };
    return;
  }

  if (inter.type === 'setting_facing') {
    const op = state.operators.find(o => o.id === inter.opId);
    if (op && input.rightMouseDown) {
      const target = inter.wpIdx !== null ? op.path.waypoints[inter.wpIdx] : null;
      const origin = target ? target.position : op.position;
      const dx = worldMouse.x - origin.x, dy = worldMouse.y - origin.y;
      if (dx * dx + dy * dy > 64) {
        const a = Math.atan2(dy, dx);
        if (target) { target.facingOverride = a; target.lookTarget = null; }
        else { op.angle = a; op.startAngle = a; }
      }
    }
    if (input.rightJustReleased) state.interaction = { type: 'idle' };
    return;
  }

  if (inter.type === 'dragging_node') {
    const op = state.operators.find(o => o.id === inter.opId);
    if (op && input.mouseDown) { op.path.waypoints[inter.wpIdx].position = copy(worldMouse); rebuildPathLUT(op); }
    if (input.justReleased) {
      if (!input.isDragging && op) state.popup = { opId: op.id, wpIdx: inter.wpIdx, position: copy(op.path.waypoints[inter.wpIdx].position) };
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
      // Continuously set facing toward mouse while any button is held or moving
      const dx = worldMouse.x - op.position.x;
      const dy = worldMouse.y - op.position.y;
      if (dx * dx + dy * dy > 16) {
        op.angle = Math.atan2(dy, dx);
        op.startAngle = op.angle;
      }
    }
    // Exit on click (after the initial menu click that started this)
    if (input.justPressed || input.rightJustPressed) {
      state.interaction = { type: 'idle' };
    }
    return;
  }

  // IDLE: new clicks
  if (input.rightJustPressed) {
    const selOp = state.operators.find(o => o.id === state.selectedOpId && o.deployed);
    if (selOp) {
      for (let i = 0; i < selOp.path.waypoints.length; i++) {
        if (distance(worldMouse, selOp.path.waypoints[i].position) < NODE_R + 6) {
          state.interaction = { type: 'setting_facing', opId: selOp.id, wpIdx: i }; return;
        }
      }
      if (distance(worldMouse, selOp.position) < OP_R + 8) {
        state.interaction = { type: 'setting_facing', opId: selOp.id, wpIdx: null }; return;
      }
      const dx = worldMouse.x - selOp.position.x, dy = worldMouse.y - selOp.position.y;
      selOp.angle = Math.atan2(dy, dx); selOp.startAngle = selOp.angle;
    }
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
    const selOp = state.operators.find(o => o.id === state.selectedOpId && o.deployed);
    if (selOp) {
      for (let i = 0; i < selOp.path.waypoints.length; i++) {
        if (distance(worldMouse, selOp.path.waypoints[i].position) < NODE_R + 4) {
          state.interaction = { type: 'dragging_node', opId: selOp.id, wpIdx: i }; return;
        }
      }
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

    // 4. Check ALL deployed operators (before path checks)
    for (const op of state.operators) {
      if (!op.deployed) continue;
      if (distance(worldMouse, op.position) < OP_R + 8) {
        if (state.selectedOpId === op.id) {
          // Already selected - start drag (will open popup on short click via release handler)
          state.interaction = { type: 'moving_op', opId: op.id };
        } else {
          // Select this operator
          state.selectedOpId = op.id;
          state.popup = null;
          state.interaction = { type: 'moving_op', opId: op.id };
        }
        return;
      }
    }

    if (state.interaction.type === 'idle') {
      state.selectedOpId = null; state.popup = null;
    }
  }
}

// ========== BUILD SCREEN INPUT ==========
function buildPos(e: MouseEvent): Vec2 {
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

// ---- Game Loop ----
function update(dt: number) {
  if (state.screen !== 'game') return;
  handleInput();
  if (state.mode === 'executing') updateSimulation(state, dt * state.playbackSpeed);
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
  buildAnimT += 0.016;

  // Background
  ctx.fillStyle = '#080e12';
  ctx.fillRect(0, 0, W, H);

  // Floor cells
  if (customRoom.floor.length > 0) {
    ctx.fillStyle = '#1a1814';
    for (const cell of customRoom.floor) {
      ctx.fillRect(cell.x, cell.y, GRID, GRID);
    }
  }

  // Grid dots
  ctx.fillStyle = 'rgba(68,187,170,0.06)';
  for (let x = 0; x <= W; x += GRID) for (let y = 0; y <= H; y += GRID) {
    ctx.beginPath(); ctx.arc(x, y, 1, 0, Math.PI * 2); ctx.fill();
  }

  // Crosshair guide lines
  if (buildTool !== 'delete' && buildTool !== 'door') {
    const sx = snapGrid(buildMousePos.x), sy = snapGrid(buildMousePos.y);
    ctx.strokeStyle = 'rgba(68,187,170,0.08)';
    ctx.lineWidth = 1; ctx.setLineDash([4, 10]);
    ctx.beginPath(); ctx.moveTo(sx, 0); ctx.lineTo(sx, H); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, sy); ctx.lineTo(W, sy); ctx.stroke();
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
    ctx.beginPath(); ctx.arc(sx, sy, 4, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = 'rgba(68,187,170,0.5)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.arc(sx, sy, 4, 0, Math.PI * 2); ctx.stroke();
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
