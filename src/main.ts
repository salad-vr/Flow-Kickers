import './style.css';
import type { GameState, Operator, Waypoint, RadialMenu, RadialMenuItem, InteractionMode } from './types';
import type { Vec2 } from './math/vec2';
import { COLORS, OPERATOR_RADIUS, PATH_SIMPLIFY_EPSILON, NODE_HIT_RADIUS, PATH_HIT_DISTANCE,
  RADIAL_RADIUS, RADIAL_ITEM_RADIUS, GRID_SIZE, createDefaultWaypoint } from './types';
import { startGameLoop } from './core/gameLoop';
import { initInput, getInput, clearFrameInput } from './core/inputManager';
import { cornerFedRoom } from './room/templates';
import { ROOM_TEMPLATES, type RoomTemplateName } from './room/templates';
import { createOperator, resetOperatorId, resetOperator } from './operator/operator';
import { rebuildPathLUT } from './operator/pathFollower';
import { simplifyPath } from './math/pathSimplify';
import { distance, distToSegment, closestPointOnSegment, sub, add, scale, normalize, copy } from './math/vec2';
import { updateSimulation, resetSimulation, startExecution } from './core/simulation';
import { renderGame } from './rendering/renderer';
import { exportGIF, downloadBlob } from './export/gifExporter';
import { makeWall, makeThreat, createEmptyRoom } from './room/room';

// ---- HTML Setup ----
const app = document.getElementById('app')!;
app.innerHTML = `
<div id="menu-screen">
  <div class="menu-content">
    <h1 class="menu-title">FLOW KICKERS</h1>
    <p class="menu-subtitle">Room Clearing Simulator</p>

    <div class="menu-section">
      <label class="menu-label">ROOM TYPE</label>
      <div id="room-buttons" class="menu-grid"></div>
    </div>

    <div class="menu-section">
      <label class="menu-label">OPERATORS</label>
      <div id="op-count-selector" class="menu-row"></div>
    </div>

    <button id="btn-start" class="menu-start-btn">START MISSION</button>

    <div class="menu-divider"></div>

    <button id="btn-tutorial" class="menu-link-btn">How to Play</button>
    <button id="btn-build" class="menu-link-btn">Build Your Own Room</button>
  </div>
</div>

<div id="tutorial-screen" style="display:none;">
  <div class="menu-content tutorial-content">
    <h2 class="tutorial-title">HOW TO PLAY</h2>
    <div class="tutorial-steps">
      <div class="tut-step"><span class="tut-num">1</span><span>Click an operator and <b>drag</b> to draw their movement path</span></div>
      <div class="tut-step"><span class="tut-num">2</span><span>Click on a path to <b>add control nodes</b> - drag nodes to adjust</span></div>
      <div class="tut-step"><span class="tut-num">3</span><span><b>Click a node</b> to open the radial menu: set facing, speed, look target, or delete</span></div>
      <div class="tut-step"><span class="tut-num">4</span><span><b>Right-click drag</b> from operator or node to set facing direction</span></div>
      <div class="tut-step"><span class="tut-num">5</span><span>Press <b>Space</b> or click <b>GO</b> to execute. Operators follow their paths and clear threats.</span></div>
      <div class="tut-step"><span class="tut-num">6</span><span>Export your solution as a <b>GIF</b> to share!</span></div>
    </div>
    <button id="btn-tutorial-back" class="menu-start-btn">BACK</button>
  </div>
</div>

<div id="build-screen" style="display:none;">
  <div class="build-layout">
    <canvas id="build-canvas"></canvas>
    <div class="build-sidebar">
      <h2 class="build-title">BUILD YOUR OWN</h2>
      <div class="build-tools">
        <button id="build-wall" class="build-tool-btn selected">Wall</button>
        <button id="build-door" class="build-tool-btn">Door</button>
        <button id="build-threat" class="build-tool-btn">Threat</button>
        <button id="build-entry" class="build-tool-btn">Entry</button>
      </div>
      <button id="build-clear" class="build-action-btn">Clear All</button>
      <div class="build-section">
        <label class="menu-label">SHARE CODE</label>
        <textarea id="build-code" class="build-textarea" rows="4" placeholder="Export or paste a room code..."></textarea>
        <div class="build-row">
          <button id="build-export-code" class="build-action-btn">Copy Code</button>
          <button id="build-import-code" class="build-action-btn">Load Code</button>
        </div>
      </div>
      <div class="build-section">
        <label class="menu-label">OPERATORS</label>
        <div id="build-op-selector" class="menu-row"></div>
      </div>
      <button id="build-play" class="menu-start-btn">PLAY THIS ROOM</button>
      <button id="build-back" class="build-action-btn">Back to Menu</button>
    </div>
  </div>
</div>

<div id="game-screen" style="display:none;">
  <canvas id="game-canvas"></canvas>
  <div id="game-hud">
    <div class="hud-left">
      <button id="hud-back" class="hud-btn">MENU</button>
    </div>
    <div class="hud-center">
      <button id="hud-go" class="hud-btn hud-go">GO!</button>
      <button id="hud-pause" class="hud-btn" style="display:none;">PAUSE</button>
      <button id="hud-resume" class="hud-btn hud-go" style="display:none;">RESUME</button>
      <button id="hud-reset" class="hud-btn">RESET</button>
      <select id="hud-speed" class="hud-select">
        <option value="0.5">0.5x</option>
        <option value="1" selected>1x</option>
        <option value="2">2x</option>
      </select>
    </div>
    <div class="hud-right">
      <span id="hud-timer" class="hud-timer">00:00</span>
      <button id="hud-export" class="hud-btn">GIF</button>
      <span id="hud-export-status" class="hud-status"></span>
    </div>
  </div>
</div>
`;

// ---- Canvas setup ----
const canvas = document.getElementById('game-canvas') as HTMLCanvasElement;
canvas.width = 1000;
canvas.height = 700;
initInput(canvas);

const buildCanvas = document.getElementById('build-canvas') as HTMLCanvasElement;
buildCanvas.width = 700;
buildCanvas.height = 600;

// ---- State ----
let selectedRoom: RoomTemplateName | 'custom' = 'Corner Fed';
let selectedOpCount = 2;
let buildOpCount = 2;
let customRoom: Room = createEmptyRoom();
let buildTool: 'wall' | 'door' | 'threat' | 'entry' = 'wall';
let buildWallStart: Vec2 | null = null;

const state: GameState = {
  screen: 'menu',
  mode: 'planning',
  room: cornerFedRoom(),
  operators: [],
  goCodesTriggered: { A: false, B: false, C: false },
  elapsedTime: 0,
  selectedOperatorId: null,
  selectedWaypointIndex: null,
  playbackSpeed: 1,
  roomCleared: false,
  interaction: { type: 'idle' },
  radialMenu: null,
  isEditing: false,
  editorTool: null,
};

// ========== MENU ==========
const roomBtns = document.getElementById('room-buttons')!;
for (const name of Object.keys(ROOM_TEMPLATES)) {
  const btn = document.createElement('button');
  btn.className = 'menu-room-btn';
  btn.textContent = name;
  if (name === selectedRoom) btn.classList.add('selected');
  btn.addEventListener('click', () => {
    selectedRoom = name as RoomTemplateName;
    roomBtns.querySelectorAll('.menu-room-btn').forEach(b => b.classList.remove('selected'));
    btn.classList.add('selected');
  });
  roomBtns.appendChild(btn);
}

const opSelector = document.getElementById('op-count-selector')!;
for (let i = 1; i <= 6; i++) {
  const btn = document.createElement('button');
  btn.className = 'menu-op-btn';
  btn.textContent = String(i);
  if (i === selectedOpCount) btn.classList.add('selected');
  btn.addEventListener('click', () => {
    selectedOpCount = i;
    opSelector.querySelectorAll('.menu-op-btn').forEach(b => b.classList.remove('selected'));
    btn.classList.add('selected');
  });
  opSelector.appendChild(btn);
}

document.getElementById('btn-start')!.addEventListener('click', () => startMission(false));
document.getElementById('btn-tutorial')!.addEventListener('click', () => showScreen('tutorial'));
document.getElementById('btn-tutorial-back')!.addEventListener('click', () => showScreen('menu'));
document.getElementById('btn-build')!.addEventListener('click', () => { customRoom = createEmptyRoom(); customRoom.name = 'Custom Room'; showScreen('build'); });
document.getElementById('build-back')!.addEventListener('click', () => showScreen('menu'));
document.getElementById('build-play')!.addEventListener('click', () => { selectedRoom = 'custom'; startMission(true); });

// Build tools
for (const t of ['wall', 'door', 'threat', 'entry'] as const) {
  document.getElementById(`build-${t}`)!.addEventListener('click', () => {
    buildTool = t;
    document.querySelectorAll('.build-tool-btn').forEach(b => b.classList.remove('selected'));
    document.getElementById(`build-${t}`)!.classList.add('selected');
  });
}
document.getElementById('build-clear')!.addEventListener('click', () => {
  customRoom = createEmptyRoom(); customRoom.name = 'Custom Room';
});

// Build op count
const buildOpSel = document.getElementById('build-op-selector')!;
for (let i = 1; i <= 6; i++) {
  const btn = document.createElement('button');
  btn.className = 'menu-op-btn';
  btn.textContent = String(i);
  if (i === buildOpCount) btn.classList.add('selected');
  btn.addEventListener('click', () => {
    buildOpCount = i;
    buildOpSel.querySelectorAll('.menu-op-btn').forEach(b => b.classList.remove('selected'));
    btn.classList.add('selected');
  });
  buildOpSel.appendChild(btn);
}

// Export/Import room code
document.getElementById('build-export-code')!.addEventListener('click', () => {
  const code = JSON.stringify({ w: customRoom.walls.map(w => [w.a.x,w.a.y,w.b.x,w.b.y,w.hasDoor?1:0]),
    t: customRoom.threats.map(t => [t.position.x, t.position.y]),
    e: customRoom.entryPoints.map(e => [e.x, e.y]),
    f: customRoom.floor.map(p => [p.x, p.y]) });
  const ta = document.getElementById('build-code') as HTMLTextAreaElement;
  ta.value = code;
  navigator.clipboard.writeText(code).catch(() => {});
});

document.getElementById('build-import-code')!.addEventListener('click', () => {
  try {
    const ta = document.getElementById('build-code') as HTMLTextAreaElement;
    const d = JSON.parse(ta.value);
    customRoom.walls = (d.w || []).map((w: number[]) => makeWall(w[0],w[1],w[2],w[3],!!w[4]));
    customRoom.threats = (d.t || []).map((t: number[]) => makeThreat(t[0], t[1]));
    customRoom.entryPoints = (d.e || []).map((e: number[]) => ({ x: e[0], y: e[1] }));
    customRoom.floor = (d.f || []).map((p: number[]) => ({ x: p[0], y: p[1] }));
    customRoom.name = 'Custom Room';
  } catch { alert('Invalid room code'); }
});

function showScreen(s: 'menu' | 'tutorial' | 'build' | 'game') {
  document.getElementById('menu-screen')!.style.display = s === 'menu' ? 'flex' : 'none';
  document.getElementById('tutorial-screen')!.style.display = s === 'tutorial' ? 'flex' : 'none';
  document.getElementById('build-screen')!.style.display = s === 'build' ? 'flex' : 'none';
  document.getElementById('game-screen')!.style.display = s === 'game' ? 'flex' : 'none';
  state.screen = (s === 'game') ? 'game' : 'menu';
}

import type { Room } from './types';

function startMission(isCustom: boolean) {
  const room = isCustom ? JSON.parse(JSON.stringify(customRoom)) as Room
    : (ROOM_TEMPLATES as Record<string, () => Room>)[selectedRoom as string]();
  state.room = room;
  for (const w of state.room.walls) { if (w.hasDoor) w.doorOpen = true; }
  state.operators = [];
  state.selectedOperatorId = null;
  state.selectedWaypointIndex = null;
  state.mode = 'planning';
  state.elapsedTime = 0;
  state.roomCleared = false;
  state.goCodesTriggered = { A: false, B: false, C: false };
  state.interaction = { type: 'idle' };
  state.radialMenu = null;
  resetOperatorId();

  const count = isCustom ? buildOpCount : selectedOpCount;
  const entries = state.room.entryPoints;
  for (let i = 0; i < count; i++) {
    let pos = { x: 500, y: 550 };
    if (i < entries.length) pos = { x: entries[i].x, y: entries[i].y };
    else if (entries.length > 0) {
      const base = entries[entries.length - 1];
      pos = { x: base.x + (i - entries.length + 1) * 35, y: base.y };
    }
    state.operators.push(createOperator(pos, -Math.PI / 2, i));
  }

  showScreen('game');
  updateHUD();
}

// ========== HUD ==========
document.getElementById('hud-back')!.addEventListener('click', () => showScreen('menu'));
document.getElementById('hud-go')!.addEventListener('click', doGo);
document.getElementById('hud-pause')!.addEventListener('click', () => { state.mode = 'paused'; updateHUD(); });
document.getElementById('hud-resume')!.addEventListener('click', () => { state.mode = 'executing'; updateHUD(); });
document.getElementById('hud-reset')!.addEventListener('click', doReset);
document.getElementById('hud-export')!.addEventListener('click', doExport);
(document.getElementById('hud-speed') as HTMLSelectElement).addEventListener('change', (e) => {
  state.playbackSpeed = parseFloat((e.target as HTMLSelectElement).value);
});

function doGo() {
  if (state.mode !== 'planning' || state.operators.length === 0) return;
  state.radialMenu = null;
  state.interaction = { type: 'idle' };
  startExecution(state);
  updateHUD();
}

function doReset() {
  state.mode = 'planning';
  state.elapsedTime = 0;
  state.roomCleared = false;
  state.goCodesTriggered = { A: false, B: false, C: false };
  state.radialMenu = null;
  state.interaction = { type: 'idle' };
  for (const op of state.operators) resetOperator(op);
  for (const t of state.room.threats) { t.neutralized = false; t.neutralizeTimer = 0; }
  updateHUD();
}

async function doExport() {
  if (!state.operators.some(op => op.path.waypoints.length >= 2)) return;
  const btn = document.getElementById('hud-export') as HTMLButtonElement;
  btn.disabled = true;
  const el = document.getElementById('hud-export-status')!;
  el.textContent = 'Exporting...';
  try {
    const blob = await exportGIF(state, (p) => { el.textContent = `${Math.floor(p * 100)}%`; });
    downloadBlob(blob, `flow-kickers-${Date.now()}.gif`);
    el.textContent = 'Done!';
  } catch (err) { console.error(err); el.textContent = 'Error!'; }
  btn.disabled = false;
  doReset();
  setTimeout(() => { el.textContent = ''; }, 3000);
}

function updateHUD() {
  document.getElementById('hud-go')!.style.display = state.mode === 'planning' ? '' : 'none';
  document.getElementById('hud-pause')!.style.display = state.mode === 'executing' ? '' : 'none';
  document.getElementById('hud-resume')!.style.display = state.mode === 'paused' ? '' : 'none';
}

// ---- Keyboard ----
window.addEventListener('keydown', (e) => {
  if (state.screen !== 'game') return;
  if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement || e.target instanceof HTMLTextAreaElement) return;
  switch (e.key) {
    case ' ': e.preventDefault();
      if (state.mode === 'planning') doGo();
      else if (state.mode === 'executing') { state.mode = 'paused'; updateHUD(); }
      else if (state.mode === 'paused') { state.mode = 'executing'; updateHUD(); }
      break;
    case 'r': case 'R': doReset(); break;
    case 'Escape': state.radialMenu = null; state.interaction = { type: 'idle' }; state.selectedOperatorId = null; state.selectedWaypointIndex = null; break;
    case 'Delete': case 'Backspace': deleteSelectedNode(); break;
  }
});

function deleteSelectedNode() {
  if (state.selectedOperatorId === null || state.selectedWaypointIndex === null) return;
  const op = state.operators.find(o => o.id === state.selectedOperatorId);
  if (!op || op.path.waypoints.length <= 2) return;
  op.path.waypoints.splice(state.selectedWaypointIndex, 1);
  rebuildPathLUT(op);
  state.selectedWaypointIndex = null;
  state.radialMenu = null;
}

// ========== RADIAL MENU ==========
function openRadialForOperator(op: Operator) {
  const items: RadialMenuItem[] = [
    { label: 'Speed', icon: 'SPD', action: () => {
      state.interaction = { type: 'tempo_drag', opId: op.id, waypointIndex: null, startY: 0, startTempo: op.tempo };
      state.radialMenu = null;
    }},
    { label: 'Clear Path', icon: 'CLR', color: '#cc4444', action: () => {
      op.path.waypoints = []; op.path.splineLUT = null; state.radialMenu = null;
    }},
  ];
  state.radialMenu = { position: copy(op.position), items, hoveredIndex: -1 };
}

function openRadialForNode(op: Operator, wpIdx: number) {
  const wp = op.path.waypoints[wpIdx];
  const items: RadialMenuItem[] = [
    { label: 'Look At', icon: 'EYE', action: () => {
      state.interaction = { type: 'setting_look_target', opId: op.id, waypointIndex: wpIdx };
      state.radialMenu = null;
    }},
    { label: 'Speed', icon: 'SPD', action: () => {
      state.interaction = { type: 'tempo_drag', opId: op.id, waypointIndex: wpIdx, startY: 0, startTempo: wp.tempo };
      state.radialMenu = null;
    }},
    { label: wp.hold ? 'Un-Hold' : 'Hold', icon: 'HLD', color: COLORS.holdMarker, action: () => {
      wp.hold = !wp.hold;
      if (wp.hold && !wp.goCode) wp.goCode = 'A';
      state.radialMenu = null;
    }},
    { label: 'Delete', icon: 'DEL', color: '#cc4444', action: () => {
      if (op.path.waypoints.length > 2) {
        op.path.waypoints.splice(wpIdx, 1);
        rebuildPathLUT(op);
      }
      state.selectedWaypointIndex = null;
      state.radialMenu = null;
    }},
    { label: 'Redraw From', icon: 'RDW', action: () => {
      // Trim path to this node, then start drawing from here
      op.path.waypoints = op.path.waypoints.slice(0, wpIdx + 1);
      rebuildPathLUT(op);
      state.interaction = { type: 'redrawing_from_node', opId: op.id, fromIndex: wpIdx, rawPoints: [copy(wp.position)] };
      state.radialMenu = null;
    }},
  ];
  // Clear look target option if already set
  if (wp.lookTarget) {
    items.unshift({ label: 'Clear Look', icon: 'CLR', action: () => { wp.lookTarget = null; state.radialMenu = null; }});
  }
  state.radialMenu = { position: copy(wp.position), items, hoveredIndex: -1 };
}

// ========== INPUT HANDLING ==========
function handleInput() {
  const input = getInput();
  if (state.screen !== 'game') return;
  if (state.mode === 'executing') return;

  const inter = state.interaction;

  // --- Handle radial menu ---
  if (state.radialMenu) {
    const rm = state.radialMenu;
    // Update hover
    rm.hoveredIndex = -1;
    const count = rm.items.length;
    for (let i = 0; i < count; i++) {
      const angle = (i / count) * Math.PI * 2 - Math.PI / 2;
      const ix = rm.position.x + Math.cos(angle) * RADIAL_RADIUS;
      const iy = rm.position.y + Math.sin(angle) * RADIAL_RADIUS;
      if (distance(input.mousePos, { x: ix, y: iy }) < RADIAL_ITEM_RADIUS + 4) {
        rm.hoveredIndex = i;
        break;
      }
    }
    if (input.justPressed) {
      if (rm.hoveredIndex >= 0) {
        rm.items[rm.hoveredIndex].action();
      } else {
        state.radialMenu = null;
      }
      return;
    }
    return;
  }

  // --- Tempo drag mode ---
  if (inter.type === 'tempo_drag') {
    if (input.justPressed) {
      inter.startY = input.mousePos.y;
      const op = state.operators.find(o => o.id === inter.opId);
      if (op) {
        inter.startTempo = inter.waypointIndex !== null ? op.path.waypoints[inter.waypointIndex].tempo : op.tempo;
      }
    }
    if (input.mouseDown) {
      const deltaY = inter.startY - input.mousePos.y; // up = faster
      const newTempo = Math.max(0.2, Math.min(3, inter.startTempo + deltaY * 0.01));
      const op = state.operators.find(o => o.id === inter.opId);
      if (op) {
        if (inter.waypointIndex !== null) {
          op.path.waypoints[inter.waypointIndex].tempo = Math.round(newTempo * 10) / 10;
        } else {
          op.tempo = Math.round(newTempo * 10) / 10;
        }
      }
    }
    if (input.justReleased) {
      state.interaction = { type: 'idle' };
    }
    return;
  }

  // --- Setting look target ---
  if (inter.type === 'setting_look_target') {
    if (input.justPressed) {
      const op = state.operators.find(o => o.id === inter.opId);
      if (op) {
        op.path.waypoints[inter.waypointIndex].lookTarget = copy(input.mousePos);
        op.path.waypoints[inter.waypointIndex].facingOverride = null; // look target overrides facing
      }
      state.interaction = { type: 'idle' };
    }
    return;
  }

  // --- Drawing path ---
  if (inter.type === 'drawing_path') {
    if (input.mouseDown) {
      const pts = inter.rawPoints;
      const last = pts[pts.length - 1];
      if (distance(input.mousePos, last) > 4) {
        pts.push(copy(input.mousePos));
      }
    }
    if (input.justReleased) {
      const op = state.operators.find(o => o.id === inter.opId);
      if (op && inter.rawPoints.length >= 2) {
        const simplified = simplifyPath(inter.rawPoints, PATH_SIMPLIFY_EPSILON);
        op.path.waypoints = simplified.map(p => createDefaultWaypoint(p));
        rebuildPathLUT(op);
      }
      state.interaction = { type: 'idle' };
    }
    return;
  }

  // --- Redrawing from node ---
  if (inter.type === 'redrawing_from_node') {
    if (input.mouseDown) {
      const pts = inter.rawPoints;
      const last = pts[pts.length - 1];
      if (distance(input.mousePos, last) > 4) {
        pts.push(copy(input.mousePos));
      }
    }
    if (input.justReleased) {
      const op = state.operators.find(o => o.id === inter.opId);
      if (op && inter.rawPoints.length >= 2) {
        const simplified = simplifyPath(inter.rawPoints, PATH_SIMPLIFY_EPSILON);
        const newWps = simplified.slice(1).map(p => createDefaultWaypoint(p));
        op.path.waypoints = [...op.path.waypoints.slice(0, inter.fromIndex + 1), ...newWps];
        rebuildPathLUT(op);
      }
      state.interaction = { type: 'idle' };
    }
    return;
  }

  // --- Dragging a node ---
  if (inter.type === 'dragging_node') {
    if (input.mouseDown && input.isDragging) {
      const op = state.operators.find(o => o.id === inter.opId);
      if (op) {
        op.path.waypoints[inter.waypointIndex].position = copy(input.mousePos);
        rebuildPathLUT(op);
      }
    }
    if (input.justReleased) {
      if (!input.isDragging) {
        // Was just a click, not a drag - open radial menu for this node
        const op = state.operators.find(o => o.id === inter.opId);
        if (op) openRadialForNode(op, inter.waypointIndex);
      }
      state.interaction = { type: 'idle' };
    }
    return;
  }

  // --- Right-click: set facing ---
  if (inter.type === 'setting_facing') {
    if (input.rightMouseDown) {
      const op = state.operators.find(o => o.id === inter.opId);
      if (op) {
        const target = inter.waypointIndex !== null ? op.path.waypoints[inter.waypointIndex] : null;
        const origin = target ? target.position : op.position;
        const dx = input.mousePos.x - origin.x;
        const dy = input.mousePos.y - origin.y;
        if (dx * dx + dy * dy > 100) {
          const a = Math.atan2(dy, dx);
          if (target) { target.facingOverride = a; target.lookTarget = null; }
          else { op.angle = a; op.startAngle = a; }
        }
      }
    }
    if (input.rightJustReleased) {
      state.interaction = { type: 'idle' };
    }
    return;
  }

  // ========== IDLE STATE: process new clicks ==========

  // RIGHT CLICK: start setting facing
  if (input.rightJustPressed) {
    // Check if near an operator or waypoint of selected op
    const selOp = state.operators.find(o => o.id === state.selectedOperatorId);
    if (selOp) {
      // Check waypoints first
      for (let i = 0; i < selOp.path.waypoints.length; i++) {
        if (distance(input.mousePos, selOp.path.waypoints[i].position) < NODE_HIT_RADIUS + 5) {
          state.interaction = { type: 'setting_facing', opId: selOp.id, waypointIndex: i };
          return;
        }
      }
      // Check operator itself
      if (distance(input.mousePos, selOp.position) < OPERATOR_RADIUS + 10) {
        state.interaction = { type: 'setting_facing', opId: selOp.id, waypointIndex: null };
        return;
      }
    }
    // Check any operator
    for (const op of state.operators) {
      if (distance(input.mousePos, op.position) < OPERATOR_RADIUS + 10) {
        state.selectedOperatorId = op.id;
        state.interaction = { type: 'setting_facing', opId: op.id, waypointIndex: null };
        return;
      }
    }
  }

  // LEFT CLICK
  if (input.justPressed) {
    // 1. Check if clicking on a waypoint node of selected operator
    const selOp = state.operators.find(o => o.id === state.selectedOperatorId);
    if (selOp) {
      for (let i = 0; i < selOp.path.waypoints.length; i++) {
        if (distance(input.mousePos, selOp.path.waypoints[i].position) < NODE_HIT_RADIUS) {
          state.selectedWaypointIndex = i;
          // If it's a short click (no drag), open radial menu. We start as drag, and on release check.
          state.interaction = { type: 'dragging_node', opId: selOp.id, waypointIndex: i };
          return;
        }
      }

      // 2. Check if clicking on the path line of selected operator to insert a node
      if (selOp.path.splineLUT && selOp.path.splineLUT.samples.length > 1) {
        const samples = selOp.path.splineLUT.samples;
        let bestDist = Infinity;
        let bestIdx = -1;
        for (let i = 0; i < samples.length - 1; i++) {
          const d = distToSegment(input.mousePos, samples[i], samples[i + 1]);
          if (d < bestDist) { bestDist = d; bestIdx = i; }
        }
        if (bestDist < PATH_HIT_DISTANCE) {
          // Insert a new waypoint at the closest point on the path
          const cp = closestPointOnSegment(input.mousePos, samples[bestIdx], samples[bestIdx + 1]);
          // Find which waypoint segment this is between
          const wpCount = selOp.path.waypoints.length;
          const lut = selOp.path.splineLUT!;
          const sampleFrac = bestIdx / (samples.length - 1);
          const insertAfter = Math.min(Math.floor(sampleFrac * (wpCount - 1)), wpCount - 2);
          const newWp = createDefaultWaypoint(cp);
          selOp.path.waypoints.splice(insertAfter + 1, 0, newWp);
          rebuildPathLUT(selOp);
          state.selectedWaypointIndex = insertAfter + 1;
          state.interaction = { type: 'dragging_node', opId: selOp.id, waypointIndex: insertAfter + 1 };
          return;
        }
      }
    }

    // 3. Check if clicking an operator
    for (const op of state.operators) {
      if (distance(input.mousePos, op.position) < OPERATOR_RADIUS + 8) {
        if (state.selectedOperatorId === op.id && op.path.waypoints.length > 0) {
          // Already selected with path - open radial
          openRadialForOperator(op);
        } else {
          state.selectedOperatorId = op.id;
          state.selectedWaypointIndex = null;
          // Start drawing path
          state.interaction = { type: 'drawing_path', opId: op.id, rawPoints: [copy(op.position)] };
          op.path.waypoints = [];
          op.path.splineLUT = null;
        }
        return;
      }
    }

    // 4. Click on empty space - deselect
    state.selectedOperatorId = null;
    state.selectedWaypointIndex = null;
  }

}

// ========== BUILD SCREEN INPUT ==========
let buildMouseDown = false;
buildCanvas.addEventListener('mousedown', (e) => {
  const rect = buildCanvas.getBoundingClientRect();
  const mx = (e.clientX - rect.left) * (buildCanvas.width / rect.width);
  const my = (e.clientY - rect.top) * (buildCanvas.height / rect.height);
  const snap = (v: number) => Math.round(v / GRID_SIZE) * GRID_SIZE;
  buildMouseDown = true;

  if (buildTool === 'wall') {
    buildWallStart = { x: snap(mx), y: snap(my) };
  } else if (buildTool === 'threat') {
    customRoom.threats.push(makeThreat(snap(mx), snap(my)));
  } else if (buildTool === 'entry') {
    customRoom.entryPoints.push({ x: snap(mx), y: snap(my) });
  } else if (buildTool === 'door') {
    // Find nearest wall and add door
    let bestDist = Infinity; let bestIdx = -1;
    for (let i = 0; i < customRoom.walls.length; i++) {
      const w = customRoom.walls[i];
      const d = distToSegment({ x: mx, y: my }, w.a, w.b);
      if (d < bestDist) { bestDist = d; bestIdx = i; }
    }
    if (bestIdx >= 0 && bestDist < 20) {
      customRoom.walls[bestIdx].hasDoor = true;
      customRoom.walls[bestIdx].doorOpen = true;
    }
  }
});

buildCanvas.addEventListener('mouseup', (e) => {
  if (!buildMouseDown) return;
  buildMouseDown = false;
  if (buildTool === 'wall' && buildWallStart) {
    const rect = buildCanvas.getBoundingClientRect();
    const mx = (e.clientX - rect.left) * (buildCanvas.width / rect.width);
    const my = (e.clientY - rect.top) * (buildCanvas.height / rect.height);
    const snap = (v: number) => Math.round(v / GRID_SIZE) * GRID_SIZE;
    const end = { x: snap(mx), y: snap(my) };
    if (distance(buildWallStart, end) > GRID_SIZE) {
      customRoom.walls.push(makeWall(buildWallStart.x, buildWallStart.y, end.x, end.y));
      // Auto-update floor polygon
      if (customRoom.walls.length >= 3) {
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        for (const w of customRoom.walls) {
          minX = Math.min(minX, w.a.x, w.b.x); minY = Math.min(minY, w.a.y, w.b.y);
          maxX = Math.max(maxX, w.a.x, w.b.x); maxY = Math.max(maxY, w.a.y, w.b.y);
        }
        customRoom.floor = [{x:minX,y:minY},{x:maxX,y:minY},{x:maxX,y:maxY},{x:minX,y:maxY}];
      }
    }
    buildWallStart = null;
  }
});

buildCanvas.addEventListener('contextmenu', (e) => e.preventDefault());

// ========== GAME LOOP ==========
function update(dt: number) {
  if (state.screen !== 'game') return;
  handleInput();
  if (state.mode === 'executing') {
    updateSimulation(state, dt * state.playbackSpeed);
  }
  const m = Math.floor(state.elapsedTime / 60);
  const s = Math.floor(state.elapsedTime % 60);
  document.getElementById('hud-timer')!.textContent = `${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
  updateHUD();
  clearFrameInput();
}

function renderFrame() {
  if (state.screen === 'game') {
    renderGame(canvas, state);
  }
  // Render build canvas
  if (document.getElementById('build-screen')!.style.display !== 'none') {
    renderBuildCanvas();
  }
}

function renderBuildCanvas() {
  const ctx = buildCanvas.getContext('2d')!;
  const w = buildCanvas.width, h = buildCanvas.height;
  ctx.fillStyle = COLORS.bgOuter;
  ctx.fillRect(0, 0, w, h);
  // Floor
  if (customRoom.floor.length >= 3) {
    ctx.beginPath();
    ctx.moveTo(customRoom.floor[0].x, customRoom.floor[0].y);
    for (let i = 1; i < customRoom.floor.length; i++) ctx.lineTo(customRoom.floor[i].x, customRoom.floor[i].y);
    ctx.closePath();
    ctx.fillStyle = COLORS.bgFloor;
    ctx.fill();
  }
  // Grid
  ctx.strokeStyle = COLORS.gridLine; ctx.lineWidth = 0.5;
  for (let x = 0; x < w; x += GRID_SIZE) { ctx.beginPath(); ctx.moveTo(x,0); ctx.lineTo(x,h); ctx.stroke(); }
  for (let y = 0; y < h; y += GRID_SIZE) { ctx.beginPath(); ctx.moveTo(0,y); ctx.lineTo(w,y); ctx.stroke(); }
  // Walls
  for (const wall of customRoom.walls) {
    ctx.lineCap = 'round'; ctx.strokeStyle = COLORS.wallFill; ctx.lineWidth = 8;
    ctx.beginPath(); ctx.moveTo(wall.a.x, wall.a.y); ctx.lineTo(wall.b.x, wall.b.y); ctx.stroke();
    if (wall.hasDoor) {
      const cx = (wall.a.x+wall.b.x)/2, cy = (wall.a.y+wall.b.y)/2;
      ctx.fillStyle = COLORS.doorOpen; ctx.beginPath(); ctx.arc(cx,cy,6,0,Math.PI*2); ctx.fill();
    }
  }
  // Threats
  for (const t of customRoom.threats) {
    ctx.strokeStyle = COLORS.threatActive; ctx.lineWidth = 3; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(t.position.x-6,t.position.y-6); ctx.lineTo(t.position.x+6,t.position.y+6); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(t.position.x+6,t.position.y-6); ctx.lineTo(t.position.x-6,t.position.y+6); ctx.stroke();
  }
  // Entry points
  for (const ep of customRoom.entryPoints) {
    ctx.strokeStyle = COLORS.entryPoint; ctx.lineWidth = 2; ctx.setLineDash([4,4]);
    ctx.beginPath(); ctx.arc(ep.x, ep.y, 10, 0, Math.PI*2); ctx.stroke(); ctx.setLineDash([]);
    ctx.fillStyle = COLORS.entryPoint; ctx.font = 'bold 12px monospace'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('+', ep.x, ep.y);
  }
  // Tool hint
  ctx.fillStyle = COLORS.uiText; ctx.font = '11px monospace'; ctx.textAlign = 'left'; ctx.textBaseline = 'top';
  ctx.fillText(`Tool: ${buildTool.toUpperCase()}`, 8, 8);
}

startGameLoop(update, renderFrame);
