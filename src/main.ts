import './style.css';
import type { GameState, Operator, Interaction, NodePopup, Room } from './types';
import type { Vec2 } from './math/vec2';
import { C, OP_R, NODE_R, DEPLOY_PANEL_W, makeWaypoint } from './types';
import { startGameLoop } from './core/gameLoop';
import { initInput, getInput, clearFrameInput } from './core/inputManager';
import { ROOM_TEMPLATES, type RoomTemplateName } from './room/templates';
import { createOperator, resetOperatorId, resetOperator } from './operator/operator';
import { rebuildPathLUT } from './operator/pathFollower';
import { distance, copy, distToSegment, closestPointOnSegment } from './math/vec2';
import { updateSimulation, resetSimulation, startExecution } from './core/simulation';
import { renderGame } from './rendering/renderer';
import { exportGIF, downloadBlob } from './export/gifExporter';
import { cornerFedRoom } from './room/templates';

// ---- HTML ----
const app = document.getElementById('app')!;
app.innerHTML = `
<div id="menu-screen">
  <div class="menu-bg-grid"></div>
  <div class="menu-bg-vignette"></div>

  <div class="menu-content">
    <!-- Header / Logo -->
    <div class="menu-header">
      <div class="menu-logo-mark">
        <svg viewBox="0 0 40 40" fill="none">
          <path d="M20 4L4 16l6 3.5L20 12l10 7.5L36 16 20 4z" fill="var(--accent)" opacity=".85"/>
          <path d="M10 19.5L20 27l10-7.5v6.5L20 33.5 10 26v-6.5z" fill="var(--accent)" opacity=".4"/>
          <path d="M10 26l10 7.5L30 26" stroke="var(--accent)" stroke-width="1.5" fill="none" opacity=".25"/>
        </svg>
      </div>
      <h1 class="menu-title">FLOW <span class="menu-title-hl">KICKERS</span></h1>
      <p class="menu-subtitle">TACTICAL ROOM CLEARING SIMULATOR</p>
      <div class="menu-title-rule"></div>
    </div>

    <!-- Room Selection -->
    <div class="menu-section">
      <label class="menu-label">SELECT ROOM</label>
      <div id="room-btns" class="menu-room-grid"></div>
    </div>

    <!-- Operator Count -->
    <div class="menu-section">
      <label class="menu-label">OPERATORS</label>
      <div id="op-btns" class="menu-op-row"></div>
    </div>

    <!-- Start Button -->
    <button id="btn-start" class="menu-start-btn">
      <span class="menu-start-text">START MISSION</span>
      <svg class="menu-start-arrow" viewBox="0 0 20 20" fill="none"><path d="M6 4l8 6-8 6V4z" fill="currentColor"/></svg>
    </button>

    <!-- Footer Links -->
    <div class="menu-footer">
      <div class="menu-divider"></div>
      <div class="menu-footer-row">
        <button id="btn-tut" class="menu-link-btn">
          <svg class="menu-link-icon" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="6.5" stroke="currentColor" stroke-width="1.2"/><path d="M7.2 7h1.6v3.5H7.2z" fill="currentColor"/><circle cx="8" cy="5.2" r=".9" fill="currentColor"/></svg>
          How to Play
        </button>
      </div>
    </div>
  </div>

  <span class="menu-version">v1.0</span>
</div>

<div id="tut-screen" style="display:none">
  <div class="menu-bg-vignette"></div>
  <div class="menu-content tut-content">
    <h2 class="tut-heading">HOW TO PLAY</h2>
    <div class="tut-steps">
      <div class="tut-step"><span class="tut-num">1</span><span>Drag operators from the left panel onto the map to deploy them</span></div>
      <div class="tut-step"><span class="tut-num">2</span><span>Click a deployed operator, then click on the map to place waypoints</span></div>
      <div class="tut-step"><span class="tut-num">3</span><span>Right-click + drag to set <b>facing direction</b> at any point</span></div>
      <div class="tut-step"><span class="tut-num">4</span><span>Click a waypoint node to open options: hold, speed, delete, look-at</span></div>
      <div class="tut-step"><span class="tut-num">5</span><span>Press <b>SPACE</b> or click <b>GO</b> to execute the plan</span></div>
      <div class="tut-step"><span class="tut-num">6</span><span>Pause with <b>SPACE</b>, reset with <b>R</b></span></div>
    </div>
    <button id="btn-tut-back" class="menu-start-btn" style="margin-top:8px;">
      <span class="menu-start-text">BACK TO MENU</span>
    </button>
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

// ---- State ----
let selRoom: RoomTemplateName = 'Corner Fed';
let selOpCount = 2;

const state: GameState = {
  screen: 'menu', mode: 'planning',
  room: cornerFedRoom(),
  operators: [], goCodesTriggered: { A: false, B: false, C: false },
  elapsedTime: 0, selectedOpId: null, playbackSpeed: 1, roomCleared: false,
  interaction: { type: 'idle' }, popup: null,
};

// ---- Menu ----
// Room template mini-preview SVGs
const ROOM_PREVIEWS: Record<string, string> = {
  'Corner Fed': '<svg viewBox="0 0 60 48"><rect x="6" y="4" width="48" height="36" fill="none" stroke="var(--accent)" stroke-width="1.5" opacity=".5"/><line x1="6" y1="40" x2="22" y2="40" stroke="var(--accent)" stroke-width="1.5" opacity=".25"/><line x1="34" y1="40" x2="54" y2="40" stroke="var(--accent)" stroke-width="1.5" opacity=".25"/><rect x="22" y="38" width="12" height="4" rx="1" fill="var(--accent)" opacity=".7"/></svg>',
  'Center Fed': '<svg viewBox="0 0 60 48"><rect x="4" y="4" width="52" height="36" fill="none" stroke="var(--accent)" stroke-width="1.5" opacity=".5"/><line x1="4" y1="40" x2="24" y2="40" stroke="var(--accent)" stroke-width="1.5" opacity=".25"/><line x1="36" y1="40" x2="56" y2="40" stroke="var(--accent)" stroke-width="1.5" opacity=".25"/><rect x="24" y="38" width="12" height="4" rx="1" fill="var(--accent)" opacity=".7"/></svg>',
  'L-Shape': '<svg viewBox="0 0 60 48"><path d="M4 4h52v20H28v20H4V4z" fill="none" stroke="var(--accent)" stroke-width="1.5" opacity=".5"/><rect x="10" y="42" width="10" height="3" rx="1" fill="var(--accent)" opacity=".7"/></svg>',
  'T-Shape': '<svg viewBox="0 0 60 48"><path d="M4 4h52v16H38v24H22V20H4V4z" fill="none" stroke="var(--accent)" stroke-width="1.5" opacity=".5"/><rect x="26" y="42" width="8" height="3" rx="1" fill="var(--accent)" opacity=".7"/></svg>',
  'Simple Box': '<svg viewBox="0 0 60 48"><rect x="10" y="6" width="40" height="34" fill="none" stroke="var(--accent)" stroke-width="1.5" opacity=".5"/><rect x="24" y="38" width="12" height="3" rx="1" fill="var(--accent)" opacity=".7"/></svg>',
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

document.getElementById('btn-start')!.onclick = startMission;
document.getElementById('btn-tut')!.onclick = () => show('tut');
document.getElementById('btn-tut-back')!.onclick = () => show('menu');

function show(s: 'menu' | 'tut' | 'game') {
  document.getElementById('menu-screen')!.style.display = s === 'menu' ? 'flex' : 'none';
  document.getElementById('tut-screen')!.style.display = s === 'tut' ? 'flex' : 'none';
  document.getElementById('game-screen')!.style.display = s === 'game' ? 'flex' : 'none';
  state.screen = s === 'game' ? 'game' : 'menu';
}

function startMission() {
  state.room = (ROOM_TEMPLATES as Record<string, () => Room>)[selRoom]();
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
  // Create operators (undeployed - they sit in the panel)
  for (let i = 0; i < selOpCount; i++) {
    state.operators.push(createOperator(i));
  }
  show('game');
}

// ---- Keyboard ----
window.addEventListener('keydown', (e) => {
  if (state.screen !== 'game') return;
  if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement || e.target instanceof HTMLTextAreaElement) return;
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

// ---- Input ----
function handleInput() {
  const input = getInput();
  if (state.screen !== 'game') return;
  if (state.mode === 'executing') return;
  const inter = state.interaction;
  const W = canvas.width, H = canvas.height;

  // --- Popup click handling ---
  if (state.popup && input.justPressed) {
    // Check if clicking within popup area (handled by renderer hit-test)
    // For now just close popup on any click outside
    state.popup = null;
    // Don't process further this frame
    return;
  }

  // --- Deploying operator (drag from panel) ---
  if (inter.type === 'deploying_op') {
    const op = state.operators.find(o => o.id === inter.opId);
    if (op && input.mouseDown) {
      op.position = copy(input.mousePos);
    }
    if (input.justReleased && op) {
      // If released on map area (not back on panel), deploy
      if (input.mousePos.x > DEPLOY_PANEL_W + 10) {
        op.deployed = true;
        op.startPosition = copy(op.position);
      }
      state.interaction = { type: 'idle' };
    }
    return;
  }

  // --- Moving deployed operator ---
  if (inter.type === 'moving_op') {
    const op = state.operators.find(o => o.id === inter.opId);
    if (op && input.mouseDown) {
      op.position = copy(input.mousePos);
      op.startPosition = copy(op.position);
    }
    if (input.justReleased) state.interaction = { type: 'idle' };
    return;
  }

  // --- Placing waypoints (click-to-place mode) ---
  if (inter.type === 'placing_waypoints') {
    const op = state.operators.find(o => o.id === inter.opId);
    if (input.justPressed && op) {
      // Check if clicking near another operator or the deploy panel - cancel
      if (input.mousePos.x < DEPLOY_PANEL_W) {
        state.interaction = { type: 'idle' };
        return;
      }
      // Add waypoint at click position
      op.path.waypoints.push(makeWaypoint(input.mousePos));
      rebuildPathLUT(op);
    }
    // Right click = finish placing + set facing at last waypoint
    if (input.rightJustPressed && op) {
      state.interaction = { type: 'idle' };
    }
    return;
  }

  // --- Setting facing (right-drag) ---
  if (inter.type === 'setting_facing') {
    const op = state.operators.find(o => o.id === inter.opId);
    if (op && input.rightMouseDown) {
      const target = inter.wpIdx !== null ? op.path.waypoints[inter.wpIdx] : null;
      const origin = target ? target.position : op.position;
      const dx = input.mousePos.x - origin.x, dy = input.mousePos.y - origin.y;
      if (dx * dx + dy * dy > 64) {
        const a = Math.atan2(dy, dx);
        if (target) { target.facingOverride = a; target.lookTarget = null; }
        else { op.angle = a; op.startAngle = a; }
      }
    }
    if (input.rightJustReleased) state.interaction = { type: 'idle' };
    return;
  }

  // --- Dragging a waypoint node ---
  if (inter.type === 'dragging_node') {
    const op = state.operators.find(o => o.id === inter.opId);
    if (op && input.mouseDown) {
      op.path.waypoints[inter.wpIdx].position = copy(input.mousePos);
      rebuildPathLUT(op);
    }
    if (input.justReleased) {
      if (!input.isDragging) {
        // Was a click, not drag - open popup
        if (op) state.popup = { opId: op.id, wpIdx: inter.wpIdx, position: copy(op.path.waypoints[inter.wpIdx].position) };
      }
      state.interaction = { type: 'idle' };
    }
    return;
  }

  // --- Setting look target ---
  if (inter.type === 'setting_look_target') {
    if (input.justPressed) {
      const op = state.operators.find(o => o.id === inter.opId);
      if (op) {
        op.path.waypoints[inter.wpIdx].lookTarget = copy(input.mousePos);
        op.path.waypoints[inter.wpIdx].facingOverride = null;
      }
      state.interaction = { type: 'idle' };
    }
    return;
  }

  // --- Tempo ring drag ---
  if (inter.type === 'tempo_ring') {
    if (input.mouseDown) {
      const op = state.operators.find(o => o.id === inter.opId);
      if (op) {
        // Angle from center determines tempo (0.2 - 3.0)
        const target = inter.wpIdx !== null ? op.path.waypoints[inter.wpIdx] : null;
        const origin = target ? target.position : op.position;
        const a = Math.atan2(input.mousePos.y - origin.y, input.mousePos.x - origin.x);
        // Map angle to tempo: right=1x, top=2x, left=3x, bottom=0.5x
        // Normalize to 0..1 range around the circle
        let norm = (a + Math.PI) / (2 * Math.PI); // 0..1
        const tempo = Math.round((0.2 + norm * 2.8) * 10) / 10;
        if (target) target.tempo = tempo;
        else op.tempo = tempo;
      }
    }
    if (input.justReleased) state.interaction = { type: 'idle' };
    return;
  }

  // ========== IDLE: New clicks ==========

  // Right-click: set facing
  if (input.rightJustPressed) {
    const selOp = state.operators.find(o => o.id === state.selectedOpId && o.deployed);
    if (selOp) {
      // Check waypoints
      for (let i = 0; i < selOp.path.waypoints.length; i++) {
        if (distance(input.mousePos, selOp.path.waypoints[i].position) < NODE_R + 6) {
          state.interaction = { type: 'setting_facing', opId: selOp.id, wpIdx: i };
          return;
        }
      }
      // Operator itself
      if (distance(input.mousePos, selOp.position) < OP_R + 8) {
        state.interaction = { type: 'setting_facing', opId: selOp.id, wpIdx: null };
        return;
      }
      // Far right-click: set facing toward that point
      const dx = input.mousePos.x - selOp.position.x, dy = input.mousePos.y - selOp.position.y;
      selOp.angle = Math.atan2(dy, dx);
      selOp.startAngle = selOp.angle;
    }
    return;
  }

  // Left-click
  if (input.justPressed) {
    // 1. Check deploy panel (undeployed operators)
    if (input.mousePos.x < DEPLOY_PANEL_W + 5) {
      const undeployed = state.operators.filter(o => !o.deployed);
      for (let i = 0; i < undeployed.length; i++) {
        const py = 80 + i * 36;
        if (Math.abs(input.mousePos.y - py) < 16) {
          const op = undeployed[i];
          op.position = copy(input.mousePos);
          state.interaction = { type: 'deploying_op', opId: op.id };
          state.selectedOpId = op.id;
          return;
        }
      }
      return;
    }

    // 2. Check waypoint nodes of selected operator
    const selOp = state.operators.find(o => o.id === state.selectedOpId && o.deployed);
    if (selOp) {
      for (let i = 0; i < selOp.path.waypoints.length; i++) {
        if (distance(input.mousePos, selOp.path.waypoints[i].position) < NODE_R + 4) {
          state.interaction = { type: 'dragging_node', opId: selOp.id, wpIdx: i };
          return;
        }
      }
      // 3. Check clicking on the path line to insert a node
      const lut = selOp.path.splineLUT;
      if (lut && lut.samples.length > 1) {
        let bestD = Infinity, bestI = -1;
        for (let i = 0; i < lut.samples.length - 1; i++) {
          const d = distToSegment(input.mousePos, lut.samples[i], lut.samples[i + 1]);
          if (d < bestD) { bestD = d; bestI = i; }
        }
        if (bestD < 12) {
          const cp = closestPointOnSegment(input.mousePos, lut.samples[bestI], lut.samples[bestI + 1]);
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

    // 4. Check deployed operators
    for (const op of state.operators) {
      if (!op.deployed) continue;
      if (distance(input.mousePos, op.position) < OP_R + 6) {
        if (state.selectedOpId === op.id) {
          // Already selected - start moving or continue placing
          if (op.path.waypoints.length === 0) {
            // No path yet - start placing waypoints. First wp = operator pos
            op.path.waypoints.push(makeWaypoint(op.position));
            state.interaction = { type: 'placing_waypoints', opId: op.id };
          } else {
            // Has path - open popup or start moving
            state.interaction = { type: 'moving_op', opId: op.id };
          }
        } else {
          state.selectedOpId = op.id;
          state.popup = null;
          // If no path, start placing
          if (op.path.waypoints.length === 0) {
            op.path.waypoints.push(makeWaypoint(op.position));
            state.interaction = { type: 'placing_waypoints', opId: op.id };
          }
        }
        return;
      }
    }

    // 5. If in placing_waypoints mode but didn't hit anything above,
    //    the placing_waypoints handler at top would have caught it.
    //    If we reach here, deselect.
    if (state.interaction.type === 'idle') {
      state.selectedOpId = null;
      state.popup = null;
    }
  }
}

// ---- Game Loop ----
function update(dt: number) {
  if (state.screen !== 'game') return;
  handleInput();
  if (state.mode === 'executing') updateSimulation(state, dt * state.playbackSpeed);
  clearFrameInput();
}

function renderFrame() {
  if (state.screen === 'game') renderGame(canvas, state);
}

startGameLoop(update, renderFrame);
