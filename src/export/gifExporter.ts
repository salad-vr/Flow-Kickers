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
  const fps = 20, dt = 1 / fps, maxFrames = fps * 15, delay = Math.floor(1000 / fps);

  resetSimulation(state);
  state.mode = 'executing';
  state.goCodesTriggered.A = true;

  renderGame(canvas, state);
  offCtx.drawImage(canvas, 0, 0, w, h);
  const palette = quantize(offCtx.getImageData(0, 0, w, h).data, 256);

  resetSimulation(state);
  state.mode = 'executing';
  state.goCodesTriggered.A = true;

  let frame = 0, done = false;
  while (frame < maxFrames && !done) {
    updateSimulation(state, dt);
    renderGame(canvas, state);
    offCtx.drawImage(canvas, 0, 0, w, h);
    const d = offCtx.getImageData(0, 0, w, h);
    gif.writeFrame(applyPalette(d.data, palette), w, h, { palette, delay });
    frame++;
    if (state.operators.every(o => o.reachedEnd || o.path.waypoints.length === 0) && state.roomCleared) {
      for (let e = 0; e < fps; e++) {
        renderGame(canvas, state);
        offCtx.drawImage(canvas, 0, 0, w, h);
        gif.writeFrame(applyPalette(offCtx.getImageData(0, 0, w, h).data, palette), w, h, { palette, delay });
      }
      done = true;
    }
    if (onProgress) onProgress(frame / maxFrames);
    if (frame % 5 === 0) await new Promise(r => setTimeout(r, 0));
  }
  gif.finish();
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
