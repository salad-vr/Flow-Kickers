import { GIFEncoder, quantize, applyPalette } from 'gifenc';
import type { GameState } from '../types';
import { renderGame, getCanvas } from '../rendering/renderer';
import { updateSimulation, resetSimulation } from '../core/simulation';

/**
 * Export the current simulation as an animated GIF.
 *
 * Key improvements:
 * - Renders frame 0 (operators at start positions) BEFORE any simulation step
 * - Uses a representative palette sampled from multiple frames across the simulation
 * - Sets exportingGif flag so renderer hides HUD and shows clean watermark
 * - Stops shortly after all operators finish + room cleared (tight ending)
 * - Renders to offscreen canvas copy to avoid visual glitches on the main canvas
 */
export async function exportGIF(
  state: GameState,
  onProgress?: (progress: number) => void,
): Promise<Blob> {
  const canvas = getCanvas();
  const w = canvas.width, h = canvas.height;

  // Offscreen canvas for frame capture (avoids flashing the main canvas)
  const offscreen = document.createElement('canvas');
  offscreen.width = w; offscreen.height = h;
  const offCtx = offscreen.getContext('2d')!;

  const gif = GIFEncoder();
  const fps = 20;
  const dt = 1 / fps;
  const maxFrames = fps * 20; // 20 second max
  const delay = Math.floor(1000 / fps); // 50ms per frame

  // ---- Build a representative 256-color palette ----
  // Sample a few frames spread across a short pre-run of the simulation
  // to capture the full color range (floor, walls, FOV cones, operators, etc.)
  state.exportingGif = true;

  resetSimulation(state);
  state.mode = 'executing';
  state.goCodesTriggered.A = true;

  const samplePixels: Uint8ClampedArray[] = [];

  // Sample frame 0 (start position)
  renderGame(canvas, state);
  offCtx.drawImage(canvas, 0, 0, w, h);
  samplePixels.push(offCtx.getImageData(0, 0, w, h).data);

  // Run ~3 seconds of simulation and sample a few frames for palette diversity
  const sampleInterval = fps; // every 1 second
  for (let i = 0; i < fps * 3; i++) {
    updateSimulation(state, dt);
    if (i > 0 && i % sampleInterval === 0) {
      renderGame(canvas, state);
      offCtx.drawImage(canvas, 0, 0, w, h);
      samplePixels.push(offCtx.getImageData(0, 0, w, h).data);
    }
  }

  // Combine sampled pixels into one array for palette quantization
  const totalPixelCount = samplePixels.reduce((sum, d) => sum + d.length, 0);
  const combined = new Uint8Array(totalPixelCount);
  let offset = 0;
  for (const d of samplePixels) {
    combined.set(d, offset);
    offset += d.length;
  }
  const palette = quantize(combined, 256);

  // ---- Now do the actual export run ----
  resetSimulation(state);
  state.mode = 'executing';
  state.goCodesTriggered.A = true;

  let frame = 0;
  let done = false;
  let lingerFrames = 0;
  const maxLinger = Math.floor(fps * 1.5); // 1.5 seconds of hold at the end

  // Render frame 0: operators at start positions BEFORE any simulation step
  renderGame(canvas, state);
  offCtx.drawImage(canvas, 0, 0, w, h);
  const f0 = offCtx.getImageData(0, 0, w, h);
  gif.writeFrame(applyPalette(f0.data, palette), w, h, { palette, delay });
  frame++;

  if (onProgress) onProgress(0);

  while (frame < maxFrames && !done) {
    updateSimulation(state, dt);
    renderGame(canvas, state);
    offCtx.drawImage(canvas, 0, 0, w, h);
    const imgData = offCtx.getImageData(0, 0, w, h);
    gif.writeFrame(applyPalette(imgData.data, palette), w, h, { palette, delay });
    frame++;

    // Check if simulation is complete
    const allDone = state.operators.every(o => o.reachedEnd || o.path.waypoints.length === 0);
    if (allDone && state.roomCleared) {
      // Add a short linger at the final frame
      while (lingerFrames < maxLinger) {
        renderGame(canvas, state);
        offCtx.drawImage(canvas, 0, 0, w, h);
        const lingerData = offCtx.getImageData(0, 0, w, h);
        gif.writeFrame(applyPalette(lingerData.data, palette), w, h, { palette, delay });
        lingerFrames++;
        frame++;
      }
      done = true;
    } else if (allDone && !state.roomCleared) {
      // Operators done but room not cleared - give a few more seconds for threat engagement
      // (threats may still be being neutralized)
    }

    // Report progress (estimate: if not done by maxFrames, we stop anyway)
    if (onProgress) onProgress(Math.min(frame / (maxFrames * 0.8), 0.99));

    // Yield to event loop periodically so the UI stays responsive
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
