import { GIFEncoder, quantize, applyPalette } from 'gifenc';
import type { GameState } from '../types';
import { renderGame, getCanvas, getCtx } from '../rendering/renderer';
import { updateSimulation, resetSimulation } from '../core/simulation';

export interface ExportOptions {
  fps: number;
  scale: number;
  maxDuration: number;
}

const DEFAULT_OPTIONS: ExportOptions = {
  fps: 20,
  scale: 1,
  maxDuration: 15,
};

export async function exportGIF(
  state: GameState,
  onProgress?: (progress: number) => void,
  options: Partial<ExportOptions> = {},
): Promise<Blob> {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const canvas = getCanvas();

  const w = Math.floor(canvas.width / opts.scale);
  const h = Math.floor(canvas.height / opts.scale);

  const offscreen = document.createElement('canvas');
  offscreen.width = w;
  offscreen.height = h;
  const offCtx = offscreen.getContext('2d')!;

  const gif = GIFEncoder();
  const dt = 1 / opts.fps;
  const maxFrames = Math.floor(opts.maxDuration * opts.fps);
  const delay = Math.floor(1000 / opts.fps);

  // Reset and set to executing
  resetSimulation(state);
  state.mode = 'executing';
  state.goCodesTriggered.A = true;

  // Global palette from first frame
  renderGame(canvas, state);
  offCtx.drawImage(canvas, 0, 0, w, h);
  const firstFrame = offCtx.getImageData(0, 0, w, h);
  const globalPalette = quantize(firstFrame.data, 256);

  // Reset for capture
  resetSimulation(state);
  state.mode = 'executing';
  state.goCodesTriggered.A = true;

  let frame = 0;
  let simDone = false;

  while (frame < maxFrames && !simDone) {
    updateSimulation(state, dt);
    renderGame(canvas, state);

    offCtx.drawImage(canvas, 0, 0, w, h);
    const imageData = offCtx.getImageData(0, 0, w, h);
    const index = applyPalette(imageData.data, globalPalette);
    gif.writeFrame(index, w, h, { palette: globalPalette, delay });

    frame++;

    const allDone = state.operators.every(op => op.reachedEnd || op.path.waypoints.length === 0);
    if (allDone && state.roomCleared) {
      for (let extra = 0; extra < Math.floor(opts.fps * 1.5); extra++) {
        renderGame(canvas, state);
        offCtx.drawImage(canvas, 0, 0, w, h);
        const extraData = offCtx.getImageData(0, 0, w, h);
        const extraIndex = applyPalette(extraData.data, globalPalette);
        gif.writeFrame(extraIndex, w, h, { palette: globalPalette, delay });
      }
      simDone = true;
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
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
