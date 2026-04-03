import type { GameState, EditorTool, GoCode } from '../types';
import { COLORS } from '../types';
import { ROOM_TEMPLATES, type RoomTemplateName } from '../room/templates';
import { startExecution, resetSimulation, triggerGoCode } from '../core/simulation';
import { createOperator, resetOperatorId } from '../operator/operator';
import { exportGIF, downloadBlob } from '../export/gifExporter';

let state: GameState;
let toolbar: HTMLElement;

export function initToolbar(gameState: GameState) {
  state = gameState;
  toolbar = document.getElementById('toolbar')!;

  buildToolbar();
}

function buildToolbar() {
  toolbar.innerHTML = `
    <div class="toolbar-section">
      <div class="toolbar-label">ROOM</div>
      <div class="toolbar-row" id="room-templates"></div>
    </div>
    <div class="toolbar-section">
      <div class="toolbar-label">TOOLS</div>
      <div class="toolbar-row" id="editor-tools"></div>
    </div>
    <div class="toolbar-section">
      <div class="toolbar-label">OPERATORS</div>
      <div class="toolbar-row">
        <button id="btn-add-op" class="toolbar-btn" title="Add operator at entry point">+ Add</button>
        <button id="btn-remove-op" class="toolbar-btn" title="Remove last operator">- Remove</button>
        <span id="op-count" class="toolbar-info">0 ops</span>
      </div>
    </div>
    <div class="toolbar-section">
      <div class="toolbar-label">CONTROL</div>
      <div class="toolbar-row">
        <button id="btn-go" class="toolbar-btn accent" title="Start execution (Space)">GO</button>
        <button id="btn-pause" class="toolbar-btn" title="Pause/Resume (Space)">PAUSE</button>
        <button id="btn-reset" class="toolbar-btn" title="Reset to planning">RESET</button>
        <select id="speed-select" class="toolbar-select" title="Playback speed">
          <option value="0.5">0.5x</option>
          <option value="1" selected>1x</option>
          <option value="2">2x</option>
          <option value="3">3x</option>
        </select>
      </div>
    </div>
    <div class="toolbar-section">
      <div class="toolbar-label">GO CODES</div>
      <div class="toolbar-row">
        <button id="btn-go-a" class="toolbar-btn go-code" title="Trigger Go Code A">A</button>
        <button id="btn-go-b" class="toolbar-btn go-code" title="Trigger Go Code B">B</button>
        <button id="btn-go-c" class="toolbar-btn go-code" title="Trigger Go Code C">C</button>
      </div>
    </div>
    <div class="toolbar-section">
      <div class="toolbar-label">EXPORT</div>
      <div class="toolbar-row">
        <button id="btn-export-gif" class="toolbar-btn accent" title="Export replay as GIF">Export GIF</button>
        <span id="export-status" class="toolbar-info"></span>
      </div>
    </div>
    <div class="toolbar-section help">
      <div class="toolbar-label">CONTROLS</div>
      <div class="toolbar-help">
        <span>L-Click drag on operator: Draw path</span>
        <span>R-Click drag on waypoint: Set facing</span>
        <span>Double-click waypoint: Toggle hold</span>
        <span>Space: Go / Pause</span>
        <span>1-6: Switch tools</span>
        <span>R: Reset</span>
      </div>
    </div>
  `;

  // Room templates
  const templatesRow = document.getElementById('room-templates')!;
  for (const name of Object.keys(ROOM_TEMPLATES)) {
    const btn = document.createElement('button');
    btn.className = 'toolbar-btn';
    btn.textContent = name;
    btn.addEventListener('click', () => loadTemplate(name as RoomTemplateName));
    templatesRow.appendChild(btn);
  }

  // Editor tools
  const toolsRow = document.getElementById('editor-tools')!;
  const tools: { key: EditorTool; label: string; shortcut: string }[] = [
    { key: 'select', label: 'Select', shortcut: '1' },
    { key: 'path', label: 'Path', shortcut: '2' },
    { key: 'wall', label: 'Wall', shortcut: '3' },
    { key: 'door', label: 'Door', shortcut: '4' },
    { key: 'threat', label: 'Threat', shortcut: '5' },
  ];
  for (const tool of tools) {
    const btn = document.createElement('button');
    btn.className = 'toolbar-btn tool-btn';
    btn.dataset.tool = tool.key;
    btn.textContent = `${tool.label} (${tool.shortcut})`;
    btn.addEventListener('click', () => setTool(tool.key));
    toolsRow.appendChild(btn);
  }

  // Event listeners
  document.getElementById('btn-add-op')!.addEventListener('click', addOperator);
  document.getElementById('btn-remove-op')!.addEventListener('click', removeOperator);
  document.getElementById('btn-go')!.addEventListener('click', () => {
    if (state.mode === 'planning') {
      startExecution(state);
    }
  });
  document.getElementById('btn-pause')!.addEventListener('click', togglePause);
  document.getElementById('btn-reset')!.addEventListener('click', resetToPlanning);
  document.getElementById('btn-go-a')!.addEventListener('click', () => triggerGoCode(state, 'A'));
  document.getElementById('btn-go-b')!.addEventListener('click', () => triggerGoCode(state, 'B'));
  document.getElementById('btn-go-c')!.addEventListener('click', () => triggerGoCode(state, 'C'));
  document.getElementById('btn-export-gif')!.addEventListener('click', handleExportGIF);

  const speedSelect = document.getElementById('speed-select') as HTMLSelectElement;
  speedSelect.addEventListener('change', () => {
    state.playbackSpeed = parseFloat(speedSelect.value);
  });

  // Keyboard shortcuts
  window.addEventListener('keydown', (e) => {
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;

    switch (e.key.toLowerCase()) {
      case ' ':
        e.preventDefault();
        if (state.mode === 'planning') {
          startExecution(state);
        } else {
          togglePause();
        }
        break;
      case 'r':
        resetToPlanning();
        break;
      case '1': setTool('select'); break;
      case '2': setTool('path'); break;
      case '3': setTool('wall'); break;
      case '4': setTool('door'); break;
      case '5': setTool('threat'); break;
    }
  });

  updateToolbarState();
}

function loadTemplate(name: RoomTemplateName) {
  const templateFn = ROOM_TEMPLATES[name];
  state.room = templateFn();
  state.operators = [];
  state.selectedOperatorId = null;
  state.mode = 'planning';
  state.elapsedTime = 0;
  state.roomCleared = false;
  resetOperatorId();
  updateToolbarState();
}

function setTool(tool: EditorTool) {
  state.activeTool = tool;
  updateToolbarState();
}

function addOperator() {
  if (state.operators.length >= 6) return;
  if (state.mode !== 'planning') return;

  const entryPoints = state.room.entryPoints;
  const idx = state.operators.length;

  let pos = { x: 500, y: 500 }; // default
  if (idx < entryPoints.length) {
    pos = { x: entryPoints[idx].x, y: entryPoints[idx].y };
  } else if (entryPoints.length > 0) {
    // Offset from last entry point
    const base = entryPoints[entryPoints.length - 1];
    pos = { x: base.x + (idx - entryPoints.length + 1) * 30, y: base.y };
  }

  const op = createOperator(pos, -Math.PI / 2, idx); // face upward
  state.operators.push(op);
  state.selectedOperatorId = op.id;
  updateToolbarState();
}

function removeOperator() {
  if (state.operators.length === 0) return;
  if (state.mode !== 'planning') return;

  const removed = state.operators.pop();
  if (removed && state.selectedOperatorId === removed.id) {
    state.selectedOperatorId = null;
  }
  updateToolbarState();
}

function togglePause() {
  if (state.mode === 'executing') {
    state.mode = 'paused';
  } else if (state.mode === 'paused') {
    state.mode = 'executing';
  }
  updateToolbarState();
}

function resetToPlanning() {
  state.mode = 'planning';
  state.elapsedTime = 0;
  state.roomCleared = false;
  state.goCodesTriggered = { A: false, B: false, C: false };

  for (const op of state.operators) {
    op.position = { x: op.startPosition.x, y: op.startPosition.y };
    op.angle = op.startAngle;
    op.distanceTraveled = 0;
    op.currentWaypointIndex = 0;
    op.isHolding = false;
    op.isMoving = false;
    op.reachedEnd = false;
  }

  for (const threat of state.room.threats) {
    threat.neutralized = false;
    threat.neutralizeTimer = 0;
  }

  // Close doors
  for (const wall of state.room.walls) {
    if (wall.hasDoor) {
      wall.doorOpen = true; // Keep doors open for visibility
    }
  }

  updateToolbarState();
}

async function handleExportGIF() {
  if (state.operators.length === 0) {
    setExportStatus('Add operators first!');
    return;
  }

  const hasPath = state.operators.some(op => op.path.waypoints.length >= 2);
  if (!hasPath) {
    setExportStatus('Draw paths first!');
    return;
  }

  const btn = document.getElementById('btn-export-gif') as HTMLButtonElement;
  btn.disabled = true;
  setExportStatus('Exporting...');

  // Save current state
  const savedMode = state.mode;

  try {
    const blob = await exportGIF(state, (progress) => {
      setExportStatus(`${Math.floor(progress * 100)}%`);
    });

    const timestamp = new Date().toISOString().slice(0, 19).replace(/[:-]/g, '');
    downloadBlob(blob, `flow-kickers-${timestamp}.gif`);
    setExportStatus('Done!');
  } catch (err) {
    console.error('GIF export failed:', err);
    setExportStatus('Failed!');
  }

  // Restore state
  state.mode = savedMode;
  btn.disabled = false;

  // Reset after export
  resetToPlanning();

  setTimeout(() => setExportStatus(''), 3000);
}

function setExportStatus(text: string) {
  const el = document.getElementById('export-status');
  if (el) el.textContent = text;
}

export function updateToolbarState() {
  // Update operator count
  const opCount = document.getElementById('op-count');
  if (opCount) opCount.textContent = `${state.operators.length} ops`;

  // Update tool button highlights
  const toolBtns = document.querySelectorAll('.tool-btn');
  toolBtns.forEach(btn => {
    const el = btn as HTMLElement;
    el.classList.toggle('active', el.dataset.tool === state.activeTool);
  });

  // Update go code button states
  for (const code of ['A', 'B', 'C'] as GoCode[]) {
    const btn = document.getElementById(`btn-go-${code.toLowerCase()}`);
    if (btn) {
      btn.classList.toggle('triggered', state.goCodesTriggered[code]);
    }
  }
}
