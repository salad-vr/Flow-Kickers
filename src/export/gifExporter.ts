import { GIFEncoder, quantize, applyPalette } from 'gifenc';
import type { GameState } from '../types';
import { renderGame, getCanvas } from '../rendering/renderer';
import { updateSimulation, resetSimulation } from '../core/simulation';
import { rebuildPathLUT } from '../operator/pathFollower';

/** Load a stage's data onto operators for execution */
function loadStageForExport(state: GameState, stageIdx: number) {
  const stage = state.stages[stageIdx];
  if (!stage) return;
  state.elapsedTime = 0;
  state.goCodesTriggered = { A: false, B: false, C: false };
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
    if (op.smoothPosition) op.smoothPosition = { x: op.position.x, y: op.position.y };
    rebuildPathLUT(op);
  }
  state.mode = 'executing';
  state.goCodesTriggered.A = true;
  state.executingStageIndex = stageIdx;
}

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
  const fps = 20, dt = 1 / fps, delay = Math.floor(1000 / fps);
  const maxFramesPerStage = fps * 20; // safety cap per stage
  const tailFrames = 5;

  state.exportingGif = true;

  const numStages = state.stages.length;
  if (numStages === 0) { state.exportingGif = false; throw new Error('No stages to export'); }

  // ---- Build palette from samples across stages ----
  const samples: Uint8ClampedArray[] = [];
  for (let si = 0; si < numStages; si++) {
    loadStageForExport(state, si);
    renderGame(canvas, state);
    offCtx.drawImage(canvas, 0, 0, w, h);
    samples.push(offCtx.getImageData(0, 0, w, h).data);
    // Advance a bit for color variety
    for (let i = 0; i < fps; i++) updateSimulation(state, dt);
    renderGame(canvas, state);
    offCtx.drawImage(canvas, 0, 0, w, h);
    samples.push(offCtx.getImageData(0, 0, w, h).data);
  }
  const totalLen = samples.reduce((a, s) => a + s.length, 0);
  const combined = new Uint8ClampedArray(totalLen);
  let offset = 0;
  for (const s of samples) { combined.set(s, offset); offset += s.length; }
  const palette = quantize(combined, 256);

  // ---- Record all stages sequentially ----
  let totalFrames = 0;
  const estTotalFrames = numStages * fps * 5; // rough estimate for progress

  for (let si = 0; si < numStages; si++) {
    loadStageForExport(state, si);

    // Frame 0 of this stage
    renderGame(canvas, state);
    offCtx.drawImage(canvas, 0, 0, w, h);
    gif.writeFrame(applyPalette(offCtx.getImageData(0, 0, w, h).data, palette), w, h, { palette, delay });
    totalFrames++;

    let stageFrames = 0;
    let tailCount = -1;

    while (stageFrames < maxFramesPerStage) {
      updateSimulation(state, dt);
      renderGame(canvas, state);
      offCtx.drawImage(canvas, 0, 0, w, h);
      gif.writeFrame(applyPalette(offCtx.getImageData(0, 0, w, h).data, palette), w, h, { palette, delay });
      stageFrames++;
      totalFrames++;

      const allDone = state.operators.every(
        o => o.reachedEnd || o.path.waypoints.length === 0 || !o.deployed,
      );
      if (allDone && tailCount < 0) tailCount = 0;
      if (tailCount >= 0) { tailCount++; if (tailCount >= tailFrames) break; }

      if (onProgress) onProgress(Math.min(0.99, totalFrames / estTotalFrames));
      if (stageFrames % 4 === 0) await new Promise(r => setTimeout(r, 0));
    }
  }

  gif.finish();
  state.exportingGif = false;

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
