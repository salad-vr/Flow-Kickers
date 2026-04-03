import './style.css';
import type { GameState } from './types';
import { startGameLoop } from './core/gameLoop';
import { initInput, getInput, clearFrameInput } from './core/inputManager';
import { initRenderer, render } from './rendering/renderer';
import { initToolbar, updateToolbarState } from './ui/toolbar';
import { cornerFedRoom } from './room/templates';
import { updateSimulation } from './core/simulation';
import { handlePathTool, handleFacingTool, handleWaypointInteraction, isCurrentlyDrawing, getRawPoints } from './planning/pathTool';
import { handleWallTool, handleDoorTool, handleThreatTool, getWallStart, snapToGrid } from './room/wallTool';

// ---- Canvas Setup ----
const app = document.getElementById('app')!;
app.innerHTML = `
  <div id="game-container">
    <canvas id="game-canvas"></canvas>
    <div id="toolbar"></div>
  </div>
`;

const canvas = document.getElementById('game-canvas') as HTMLCanvasElement;
const CANVAS_W = 1000;
const CANVAS_H = 700;
canvas.width = CANVAS_W;
canvas.height = CANVAS_H;

// ---- Initialize Systems ----
initInput(canvas);
initRenderer(canvas);

// ---- Game State ----
const state: GameState = {
  mode: 'planning',
  activeTool: 'path',
  room: cornerFedRoom(),
  operators: [],
  goCodesTriggered: { A: false, B: false, C: false },
  elapsedTime: 0,
  selectedOperatorId: null,
  playbackSpeed: 1,
  roomCleared: false,
};

initToolbar(state);

// ---- Game Loop ----
function update(dt: number) {
  const input = getInput();

  if (state.mode === 'planning' || state.mode === 'paused') {
    // Handle editor tools
    switch (state.activeTool) {
      case 'path':
        handlePathTool(state, input);
        handleFacingTool(state, input);
        break;
      case 'select':
        // Facing tool uses right-click only, so no conflict
        handleFacingTool(state, input);
        // Operator drag and waypoint interaction both use left-click
        // Drag takes priority if near an operator
        if (!handleOperatorDrag(state, input)) {
          handleWaypointInteraction(state, input);
        }
        break;
      case 'wall':
        handleWallTool(state, input);
        break;
      case 'door':
        handleDoorTool(state, input);
        break;
      case 'threat':
        handleThreatTool(state, input);
        break;
    }
  }
  if (state.mode === 'executing') {
    updateSimulation(state, dt * state.playbackSpeed);
  }

  clearFrameInput();
}

// Operator dragging in select mode
let draggingOp: number | null = null;

/** Returns true if it consumed the click (started dragging an operator) */
function handleOperatorDrag(gameState: GameState, input: ReturnType<typeof getInput>): boolean {
  let consumed = false;

  if (input.justPressed) {
    for (const op of gameState.operators) {
      const dx = input.mousePos.x - op.position.x;
      const dy = input.mousePos.y - op.position.y;
      if (dx * dx + dy * dy < 400) {
        draggingOp = op.id;
        gameState.selectedOperatorId = op.id;
        consumed = true;
        break;
      }
    }
  }

  if (input.mouseDown && draggingOp !== null && input.isDragging) {
    const op = gameState.operators.find(o => o.id === draggingOp);
    if (op) {
      op.position = { x: input.mousePos.x, y: input.mousePos.y };
      op.startPosition = { x: input.mousePos.x, y: input.mousePos.y };
    }
    consumed = true;
  }

  if (input.justReleased) {
    draggingOp = null;
  }

  return consumed;
}

function renderFrame() {
  const ctx = canvas.getContext('2d')!;
  render(state);
  updateToolbarState();

  // Draw wall preview if using wall tool
  if (state.activeTool === 'wall') {
    const wallStart = getWallStart();
    const input = getInput();
    if (wallStart && input.mouseDown) {
      const end = snapToGrid(input.mousePos);
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 4;
      ctx.setLineDash([6, 4]);
      ctx.globalAlpha = 0.6;
      ctx.beginPath();
      ctx.moveTo(wallStart.x, wallStart.y);
      ctx.lineTo(end.x, end.y);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.globalAlpha = 1;
    }
  }

  // Draw path being drawn
  if (isCurrentlyDrawing()) {
    const points = getRawPoints();
    if (points.length > 1) {
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 2;
      ctx.globalAlpha = 0.5;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(points[0].x, points[0].y);
      for (let i = 1; i < points.length; i++) {
        ctx.lineTo(points[i].x, points[i].y);
      }
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.globalAlpha = 1;
    }
  }
}

startGameLoop(update, renderFrame);
