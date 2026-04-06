/**
 * HUD button interactions: share panel, GIF export, room code copying.
 */
import type { GameState } from '../types';
import { resetSharePanelAnim } from '../rendering/renderer';
import { encodeRoomCode } from '../room/roomCode';
import { exportGIF, downloadBlob } from '../export/gifExporter';
import { doReset } from './actions';

export function openSharePanel(state: GameState) {
  state.sharePanel = { open: true, exporting: false, exportProgress: 0, gifBlob: null, copiedRoomCode: false };
  state.hoveredShareBtn = null;
  if (state.mode === 'executing') state.mode = 'paused';
  resetSharePanelAnim();
}

export function closeSharePanel(state: GameState) {
  state.sharePanel.open = false;
  state.hoveredShareBtn = null;
}

export function getRoomShareCode(state: GameState): string {
  return encodeRoomCode(state.room);
}

export function copyRoomCode(state: GameState) {
  const code = getRoomShareCode(state);
  navigator.clipboard.writeText(code).then(() => {
    state.sharePanel.copiedRoomCode = true;
    setTimeout(() => { state.sharePanel.copiedRoomCode = false; }, 2000);
  }).catch(() => {});
}

export async function doExportGif(state: GameState) {
  if (state.stages.length === 0) return;
  state.sharePanel.exporting = true;
  state.sharePanel.exportProgress = 0;
  state.sharePanel.gifBlob = null;
  try {
    const blob = await exportGIF(state, (p) => { state.sharePanel.exportProgress = p; });
    state.sharePanel.gifBlob = blob;
  } catch (err) {
    console.error(err);
    state.exportingGif = false;
  }
  state.sharePanel.exporting = false;
  doReset(state);
}

export function downloadShareGif(state: GameState) {
  if (state.sharePanel.gifBlob) {
    downloadBlob(state.sharePanel.gifBlob, `flow-kickers-${Date.now()}.gif`);
  }
}
