import { GIFEncoder, quantize, applyPalette } from 'gifenc';
import type { GameState } from '../types';
import { renderGame, getCanvas } from '../rendering/renderer';
import { updateSimulation } from '../core/simulation';
import { rebuildPathLUT } from '../operator/pathFollower';

// ---------------------------------------------------------------------------
// Stage loading — mirrors loadAndExecuteStage in main.ts exactly
// ---------------------------------------------------------------------------

function loadStageForExport(state: GameState, stageIdx: number) {
  const stage = state.stages[stageIdx];
  if (!stage) return;

  state.executingStageIndex = stageIdx;
  state.elapsedTime = 0;
  state.goCodesTriggered = { A: false, B: false, C: false };

  for (const op of state.operators) {
    if (!op.deployed) continue;
    const snap = stage.operatorStates.find(s => s.opId === op.id);
    if (snap) {
      op.position = { x: snap.startPosition.x, y: snap.startPosition.y };
      op.startPosition = { x: snap.startPosition.x, y: snap.startPosition.y };
      op.angle = snap.startAngle;
      op.startAngle = snap.startAngle;
      op.path.waypoints = JSON.parse(JSON.stringify(snap.waypoints));
      op.tempo = snap.tempo;
      op.pieTarget = snap.pieTarget ? { x: snap.pieTarget.x, y: snap.pieTarget.y } : null;
      op.currentFloor = snap.startFloor ?? 0;
      op.startFloor = snap.startFloor ?? 0;
    } else {
      // Operator not in this stage — keep position, clear path
      op.path.waypoints = [];
      op.path.splineLUT = null;
      op.pieTarget = null;
    }
    op.distanceTraveled = 0;
    op.currentWaypointIndex = 0;
    op.isHolding = false;
    op.isMoving = false;
    op.reachedEnd = false;
    if (op.smoothPosition) op.smoothPosition = { x: op.position.x, y: op.position.y };
    rebuildPathLUT(op);
  }

  state.mode = 'executing';
  state.goCodesTriggered.A = true;

  // Set active floor to whichever floor the first operator in this stage starts on
  if (stage.operatorStates.length > 0) {
    state.activeFloor = stage.operatorStates[0].startFloor ?? 0;
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function resetAllThreats(state: GameState) {
  for (const t of state.room.threats) { t.neutralized = false; t.neutralizeTimer = 0; }
  if (state.room.floors) {
    for (const fl of state.room.floors) {
      for (const t of fl.threats) { t.neutralized = false; t.neutralizeTimer = 0; }
    }
  }
}

function allRoutesDone(state: GameState): boolean {
  return state.operators.every(
    o => !o.deployed || o.reachedEnd || o.path.waypoints.length === 0,
  );
}

/** Track floor changes each sim tick and auto-switch activeFloor */
function updateActiveFloor(state: GameState, prevFloors: Map<number, number>) {
  for (const op of state.operators) {
    if (!op.deployed) continue;
    const prev = prevFloors.get(op.id);
    if (prev !== undefined && prev !== op.currentFloor) {
      state.activeFloor = op.currentFloor;
      return; // follow the first operator that transitions
    }
  }
}

function snapshotFloors(state: GameState): Map<number, number> {
  const m = new Map<number, number>();
  for (const op of state.operators) {
    if (op.deployed) m.set(op.id, op.currentFloor);
  }
  return m;
}

function captureFrame(
  canvas: HTMLCanvasElement, offCtx: CanvasRenderingContext2D,
  gif: ReturnType<typeof GIFEncoder>, palette: number[][],
  w: number, h: number, delay: number, state: GameState,
) {
  renderGame(canvas, state);
  offCtx.drawImage(canvas, 0, 0, w, h);
  gif.writeFrame(
    applyPalette(offCtx.getImageData(0, 0, w, h).data, palette),
    w, h, { palette, delay },
  );
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

export async function exportGIF(
  state: GameState,
  onProgress?: (progress: number) => void,
): Promise<Blob> {
  const canvas = getCanvas();
  const w = canvas.width, h = canvas.height;
  const offscreen = document.createElement('canvas');
  offscreen.width = w; offscreen.height = h;
  const offCtx = offscreen.getContext('2d')!;
  const gif = GIFEncoder();

  const fps = 20;
  const dt = 1 / fps;
  const delay = Math.floor(1000 / fps);   // 50 ms per frame
  const maxFramesPerStage = fps * 30;      // 30 s safety cap per stage
  const leadInFrames = 4;                  // 0.2 s still frame before each stage
  const tailFrames = 4;                    // 0.2 s after last route in stage ends

  const numStages = state.stages.length;
  if (numStages === 0) throw new Error('No stages to export');

  // --- Save state that we'll mutate during export ---
  const savedActiveFloor = state.activeFloor;
  const savedSelectedOp = state.selectedOpId;

  state.exportingGif = true;
  state.selectedOpId = null;               // no grey-out, no selection artifacts
  state.roomCleared = false;

  // Reset all threats so they start fresh
  resetAllThreats(state);

  // ------------------------------------------------------------------
  // 1. Build a representative 256-colour palette
  //    Sample start + ~1 s into each stage, across all active floors
  // ------------------------------------------------------------------
  const samples: Uint8ClampedArray[] = [];

  for (let si = 0; si < numStages; si++) {
    loadStageForExport(state, si);

    // Sample start frame on the stage's starting floor
    renderGame(canvas, state);
    offCtx.drawImage(canvas, 0, 0, w, h);
    samples.push(offCtx.getImageData(0, 0, w, h).data);

    // Advance ~1 s with floor tracking so we sample the right floor
    for (let i = 0; i < fps; i++) {
      const prev = snapshotFloors(state);
      updateSimulation(state, dt);
      updateActiveFloor(state, prev);
    }
    renderGame(canvas, state);
    offCtx.drawImage(canvas, 0, 0, w, h);
    samples.push(offCtx.getImageData(0, 0, w, h).data);

    // If this map has upper floors, also sample those floor views
    if (state.room.floors && state.room.floors.length > 0) {
      for (const fl of state.room.floors) {
        state.activeFloor = fl.level;
        renderGame(canvas, state);
        offCtx.drawImage(canvas, 0, 0, w, h);
        samples.push(offCtx.getImageData(0, 0, w, h).data);
      }
    }
  }

  const totalLen = samples.reduce((a, s) => a + s.length, 0);
  const combined = new Uint8ClampedArray(totalLen);
  let off = 0;
  for (const s of samples) { combined.set(s, off); off += s.length; }
  const palette = quantize(combined, 256);

  // ------------------------------------------------------------------
  // 2. Record all stages sequentially
  // ------------------------------------------------------------------
  resetAllThreats(state);
  let totalFrames = 0;
  const estTotal = numStages * fps * 6;

  for (let si = 0; si < numStages; si++) {
    // Preserve end angles from previous stage for seamless transitions
    const endAngles: Record<number, number> = {};
    if (si > 0) {
      for (const op of state.operators) {
        if (op.deployed) endAngles[op.id] = op.angle;
      }
    }

    loadStageForExport(state, si);

    // Apply preserved angles from previous stage
    if (si > 0) {
      for (const op of state.operators) {
        if (op.deployed && endAngles[op.id] !== undefined) {
          op.angle = endAngles[op.id];
        }
      }
    }

    // Lead-in: still frames showing operators at start positions
    for (let i = 0; i < leadInFrames; i++) {
      captureFrame(canvas, offCtx, gif, palette, w, h, delay, state);
      totalFrames++;
    }

    // Simulation loop for this stage
    let tailCount = -1;
    let stageFrames = 0;

    while (stageFrames < maxFramesPerStage) {
      // Snapshot floors before sim step
      const prevFloors = snapshotFloors(state);

      updateSimulation(state, dt);

      // Auto-switch active floor when an operator transitions
      updateActiveFloor(state, prevFloors);

      captureFrame(canvas, offCtx, gif, palette, w, h, delay, state);
      stageFrames++;
      totalFrames++;

      // Tail: once all routes are done, record a few more frames then stop
      if (allRoutesDone(state) && tailCount < 0) tailCount = 0;
      if (tailCount >= 0) {
        tailCount++;
        if (tailCount >= tailFrames) break;
      }

      if (onProgress) onProgress(Math.min(0.99, totalFrames / estTotal));
      if (stageFrames % 4 === 0) await new Promise(r => setTimeout(r, 0));
    }
  }

  gif.finish();

  // --- Restore state ---
  state.exportingGif = false;
  state.activeFloor = savedActiveFloor;
  state.selectedOpId = savedSelectedOp;

  const bytes = gif.bytes();
  const copy = new Uint8Array(bytes.length);
  copy.set(bytes);
  return new Blob([copy], { type: 'image/gif' });
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click();
  document.body.removeChild(a); URL.revokeObjectURL(url);
}
