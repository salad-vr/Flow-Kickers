import { GIFEncoder, quantize, applyPalette } from 'gifenc';
import type { GameState } from '../types';
import { render, getCtx, getCanvas } from '../rendering/renderer';
import { updateSimulation, resetSimulation } from '../core/simulation';

export interface ExportOptions {
  fps: number;
  scale: number; // downscale factor (1 = full, 2 = half, etc.)
  maxDuration: number; // max seconds to record
}

const DEFAULT_OPTIONS: ExportOptions = {
  fps: 20,
  scale: 1,
  maxDuration: 15,
};

/**
 * Export the current simulation as a GIF.
 * Runs the simulation headlessly (not real-time) and captures frames.
 */
export async function exportGIF(
  state: GameState,
  onProgress?: (progress: number) => void,
  options: Partial<ExportOptions> = {},
): Promise<Blob> {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const canvas = getCanvas();
  const ctx = getCtx();

  const w = Math.floor(canvas.width / opts.scale);
  const h = Math.floor(canvas.height / opts.scale);

  // Create an offscreen canvas for scaled capture
  const offscreen = document.createElement('canvas');
  offscreen.width = w;
  offscreen.height = h;
  const offCtx = offscreen.getContext('2d')!;

  const gif = GIFEncoder();
  const dt = 1 / opts.fps;
  const maxFrames = Math.floor(opts.maxDuration * opts.fps);
  const delay = Math.floor(1000 / opts.fps);

  // Reset simulation to beginning and set to executing mode
  resetSimulation(state);
  state.mode = 'executing';
  state.goCodesTriggered.A = true;

  // Compute a global palette from first frame
  render(state);
  offCtx.drawImage(canvas, 0, 0, w, h);
  const firstFrame = offCtx.getImageData(0, 0, w, h);
  const globalPalette = quantize(firstFrame.data, 256);

  // Reset again for actual capture
  resetSimulation(state);
  state.mode = 'executing';
  state.goCodesTriggered.A = true;

  let frame = 0;
  let simDone = false;

  while (frame < maxFrames && !simDone) {
    // Step simulation
    updateSimulation(state, dt);

    // Render
    render(state);

    // Capture frame
    offCtx.drawImage(canvas, 0, 0, w, h);
    const imageData = offCtx.getImageData(0, 0, w, h);
    const index = applyPalette(imageData.data, globalPalette);

    gif.writeFrame(index, w, h, {
      palette: globalPalette,
      delay,
    });

    frame++;

    // Check if all operators finished and room is cleared
    const allDone = state.operators.every(op => op.reachedEnd || op.path.waypoints.length === 0);
    if (allDone && state.roomCleared) {
      // Record a few more frames after completion
      for (let extra = 0; extra < Math.floor(opts.fps * 1.5); extra++) {
        render(state);
        offCtx.drawImage(canvas, 0, 0, w, h);
        const extraData = offCtx.getImageData(0, 0, w, h);
        const extraIndex = applyPalette(extraData.data, globalPalette);
        gif.writeFrame(extraIndex, w, h, { palette: globalPalette, delay });
      }
      simDone = true;
    }

    if (onProgress) {
      onProgress(frame / maxFrames);
    }

    // Yield to prevent blocking UI
    if (frame % 5 === 0) {
      await new Promise(resolve => setTimeout(resolve, 0));
    }
  }

  gif.finish();

  const bytes = gif.bytes();
  // Copy to a new Uint8Array to ensure clean ArrayBuffer
  const copy = new Uint8Array(bytes.length);
  copy.set(bytes);
  return new Blob([copy], { type: 'image/gif' });
}

/**
 * Download a blob as a file.
 */
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
