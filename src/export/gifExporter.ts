import { GIFEncoder, quantize, applyPalette } from 'gifenc';
import type { GameState } from '../types';
import { renderGame, getCanvas } from '../rendering/renderer';
import { updateSimulation, resetSimulation } from '../core/simulation';

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
  const maxFrames = fps * 30; // hard safety cap
  const delay = Math.floor(1000 / fps);
  const tailFrames = 5; // 0.25 seconds after last route finishes

  state.exportingGif = true;

  // ---- Palette: quick sample from frame 0 + one mid-simulation frame ----
  resetSimulation(state);
  state.mode = 'executing';
  state.goCodesTriggered.A = true;

  renderGame(canvas, state);
  offCtx.drawImage(canvas, 0, 0, w, h);
  const sample0 = offCtx.getImageData(0, 0, w, h).data;

  // Advance 1 second for a second color sample
  for (let i = 0; i < fps; i++) updateSimulation(state, dt);
  renderGame(canvas, state);
  offCtx.drawImage(canvas, 0, 0, w, h);
  const sample1 = offCtx.getImageData(0, 0, w, h).data;

  const combined = new Uint8ClampedArray(sample0.length + sample1.length);
  combined.set(sample0, 0);
  combined.set(sample1, sample0.length);
  const palette = quantize(combined, 256);

  // ---- Record ----
  resetSimulation(state);
  state.mode = 'executing';
  state.goCodesTriggered.A = true;

  let frame = 0;
  let tailCount = -1; // -1 = routes still running

  // Frame 0: operators at start positions
  renderGame(canvas, state);
  offCtx.drawImage(canvas, 0, 0, w, h);
  gif.writeFrame(applyPalette(offCtx.getImageData(0, 0, w, h).data, palette), w, h, { palette, delay });
  frame++;
  if (onProgress) onProgress(0);

  while (frame < maxFrames) {
    updateSimulation(state, dt);
    renderGame(canvas, state);
    offCtx.drawImage(canvas, 0, 0, w, h);
    gif.writeFrame(applyPalette(offCtx.getImageData(0, 0, w, h).data, palette), w, h, { palette, delay });
    frame++;

    // Once every operator's route is done, start the tail countdown
    const allRoutesFinished = state.operators.every(
      o => o.reachedEnd || o.path.waypoints.length === 0 || !o.deployed,
    );

    if (allRoutesFinished && tailCount < 0) {
      tailCount = 0; // start counting
    }

    if (tailCount >= 0) {
      tailCount++;
      if (tailCount >= tailFrames) break;
    }

    if (onProgress) onProgress(Math.min(0.99, frame / (frame + 10)));

    // Yield every 4 frames so UI stays responsive
    if (frame % 4 === 0) await new Promise(r => setTimeout(r, 0));
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
