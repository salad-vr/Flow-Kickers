/**
 * All game-screen input handling extracted from main.ts.
 * Handles camera, share panel, HUD buttons, operator interactions,
 * radial menus, waypoint placement, etc.
 */
import type { GameState, HudBtn, Operator } from '../types';
import { OP_R, NODE_R, DEPLOY_PANEL_H, DEPLOY_OP_SPACING, DOOR_W, makeWaypoint } from '../types';
import type { Vec2 } from '../math/vec2';
import { distance, copy, distToSegment, closestPointOnSegment } from '../math/vec2';
import { rebuildPathLUT } from '../operator/pathFollower';
import { getStairAtPoint, getStairDestFloor } from '../room/room';
import { getInput } from '../core/inputManager';
import { SHARE_BTN, getShareBtnX } from '../rendering/renderer';
import { screenToWorld, hitBtn } from './helpers';
import { hitTestRadialMenu, getRadialItems, handleRadialItemAction, bakePieDirection, findDoorsNear } from './radialMenu';
import { doGo, doReset, doReplay, doClearLevel, saveStage, editStage, deleteSelected } from './actions';
import { openSharePanel, closeSharePanel, copyRoomCode, doExportGif, downloadShareGif } from './hudActions';
import { saveProgress } from './persistence';
import { sfxClick, sfxSelect, sfxConfirm, sfxBack, sfxTick, sfxDelete } from '../audio/sfx';
import { getNetSync } from '../network/index';

/** Check if the local player can interact with an operator (ownership check) */
function canInteract(state: GameState, opId: number): boolean {
  const sync = getNetSync();
  if (!sync || !state.multiplayer) return true; // single player
  return sync.isOwnedByLocal(opId) || sync.isUnclaimed(opId);
}

/** Check if operator is owned by another player (for greying out) */
function isOtherPlayersOp(state: GameState, opId: number): boolean {
  const sync = getNetSync();
  if (!sync || !state.multiplayer) return false;
  return !sync.isOwnedByLocal(opId) && !sync.isUnclaimed(opId);
}

/** Visual confirmation overlay for save progress */
export let saveConfirmTimer = 0;
export function showSaveConfirmation() {
  saveConfirmTimer = 90;
}
export function tickSaveConfirmTimer() {
  if (saveConfirmTimer > 0) saveConfirmTimer--;
}

/**
 * Handle camera pan/zoom input.
 */
export function handleCamera(state: GameState, canvas: HTMLCanvasElement) {
  const input = getInput();

  // Scroll wheel zoom
  if (input.scrollDelta !== 0) {
    const zoomFactor = 1 + input.scrollDelta * 0.001;
    const oldZoom = state.camera.zoom;
    state.camera.zoom = Math.max(0.3, Math.min(3, oldZoom * zoomFactor));
    const mouseWorld = screenToWorld(input.mousePos, state.camera, canvas.width, canvas.height);
    state.camera.x += (mouseWorld.x - state.camera.x) * (1 - oldZoom / state.camera.zoom) * 0.3;
    state.camera.y += (mouseWorld.y - state.camera.y) * (1 - oldZoom / state.camera.zoom) * 0.3;
  }

  // Right-click pan
  if (state.isPanning && input.rightMouseDown) {
    const dx = (input.mousePos.x - state.panStart.x) / state.camera.zoom;
    const dy = (input.mousePos.y - state.panStart.y) / state.camera.zoom;
    state.camera.x = state.panCamStart.x - dx;
    state.camera.y = state.panCamStart.y - dy;
  }
  if (state.isPanning && input.rightJustReleased) {
    state.isPanning = false;
  }
  // Middle-click pan
  if (input.middleJustPressed) {
    state.isPanning = true;
    state.panStart = { x: input.mousePos.x, y: input.mousePos.y };
    state.panCamStart = { x: state.camera.x, y: state.camera.y };
  }
  if (state.isPanning && input.middleMouseDown) {
    const dx = (input.mousePos.x - state.panStart.x) / state.camera.zoom;
    const dy = (input.mousePos.y - state.panStart.y) / state.camera.zoom;
    state.camera.x = state.panCamStart.x - dx;
    state.camera.y = state.panCamStart.y - dy;
  }
  if (input.middleJustReleased) {
    state.isPanning = false;
  }
}

/**
 * Main game input handler. Call once per frame.
 * `selRoom` and `selOpCount` are passed so saveProgress can serialize them.
 */
export function handleInput(state: GameState, canvas: HTMLCanvasElement, selRoom: string, selOpCount: number) {
  const input = getInput();
  if (state.screen !== 'game') return;

  handleCamera(state, canvas);

  const worldMouse = screenToWorld(input.mousePos, state.camera, canvas.width, canvas.height);

  // ---- Share panel interaction ----
  if (state.sharePanel.open) {
    handleSharePanelInput(state, canvas, input);
    return;
  }

  // ---- Top-right SHARE button ----
  const W = canvas.width;
  const shareBx = getShareBtnX(W);
  const shareHit = hitBtn(input.mousePos, shareBx, SHARE_BTN.y, SHARE_BTN.w, SHARE_BTN.h);
  if (shareHit) {
    state.hoveredHudBtn = 'share';
    canvas.style.cursor = 'pointer';
    if (input.justPressed) { sfxClick(); openSharePanel(state); return; }
  }

  // ---- Bottom HUD bar hover ----
  const hudBarY = canvas.height - 44;
  const btnY = hudBarY + 9;
  const btnH = 26;
  const rightBlockX = W / 2 + 20;
  // Dynamic right group position (must match renderer logic)
  const totalStages = state.stages.length;
  let rg = rightBlockX;
  if (totalStages > 0) {
    const pillW = 28, pillGap = 5, editBtnW = 48;
    const viewIdx = state.viewingStageIndex;
    const hasSelection = viewIdx >= 0 && viewIdx < totalStages && state.mode === 'planning';
    const totalPills = totalStages + (state.mode === 'planning' ? 1 : 0);
    const totalW = totalPills * (pillW + pillGap) - pillGap + (hasSelection ? editBtnW + pillGap + 6 : 0);
    const pillsRight = W / 2 + totalW / 2 + 12;
    rg = Math.max(rightBlockX, pillsRight + 8);
  }
  const hudBtns: Record<string, { x: number; y: number; w: number; h: number }> = {
    clear_level: { x: 10, y: btnY, w: 54, h: btnH },
    menu: { x: 77, y: btnY, w: 50, h: btnH },
    save_progress: { x: 140, y: btnY, w: 48, h: btnH },
    save_stage: { x: rg, y: btnY, w: 100, h: btnH },
    go: { x: rg + 113, y: btnY - 1, w: 68, h: btnH + 2 },
    reset: { x: rg + 194, y: btnY, w: 54, h: btnH },
    replay: { x: rg + 254, y: btnY, w: 60, h: btnH },
  };
  // Dynamic stage pill buttons
  if (totalStages > 0) {
    const pillW = 28, pillH = 22, pillGap = 5;
    const editBtnW = 48;
    const viewIdx = state.viewingStageIndex;
    const hasSelection = viewIdx >= 0 && viewIdx < totalStages && state.mode === 'planning';
    const totalPills = totalStages + (state.mode === 'planning' ? 1 : 0);
    const totalW = totalPills * (pillW + pillGap) - pillGap + (hasSelection ? editBtnW + pillGap + 6 : 0);
    const startX = W / 2 - totalW / 2;
    const pillY = btnY + (btnH - pillH) / 2;
    for (let i = 0; i < totalStages; i++) {
      hudBtns[`stage_${i}`] = { x: startX + i * (pillW + pillGap), y: pillY, w: pillW, h: pillH };
    }
    if (hasSelection) {
      const editX = startX + totalPills * (pillW + pillGap) + 6;
      hudBtns['edit_stage'] = { x: editX, y: pillY, w: editBtnW, h: pillH };
    }
  }
  if (input.mousePos.y > hudBarY) {
    canvas.style.cursor = 'default';
    if (!shareHit) state.hoveredHudBtn = null;
    for (const [key, b] of Object.entries(hudBtns)) {
      if (hitBtn(input.mousePos, b.x, b.y, b.w, b.h)) { state.hoveredHudBtn = key as HudBtn; break; }
    }
    if (state.hoveredHudBtn) canvas.style.cursor = 'pointer';
  } else if (!shareHit) {
    state.hoveredHudBtn = null;
    canvas.style.cursor = 'crosshair';
    // Floor indicator pill hover
    const maxFloor = state.room.floors ? Math.max(0, ...state.room.floors.map(f => f.level)) : 0;
    if (maxFloor > 0) {
      const pillW = 36, pillH = 22, gap = 4, margin = 10;
      const totalW = (maxFloor + 1) * (pillW + gap) - gap;
      const startX = canvas.width - margin - totalW;
      const fy = margin;
      for (let level = 0; level <= maxFloor; level++) {
        const px = startX + level * (pillW + gap);
        if (hitBtn(input.mousePos, px, fy, pillW, pillH)) {
          state.hoveredHudBtn = `floor_${level}` as HudBtn;
          canvas.style.cursor = 'pointer';
          break;
        }
      }
    }
  }

  // Floor pill clicks
  if (input.justPressed && state.hoveredHudBtn && (state.hoveredHudBtn as string).startsWith('floor_')) {
    const level = parseInt((state.hoveredHudBtn as string).split('_')[1]);
    state.activeFloor = level;
    sfxTick();
    return;
  }

  // HUD bar button clicks work in ALL modes
  if (input.justPressed && input.mousePos.y > hudBarY) {
    if (handleHudButtonClick(state, canvas, selRoom, selOpCount)) return;
  }

  if (state.mode === 'executing') return;
  const inter = state.interaction;

  // Speed slider
  if (state.speedSlider && state.interaction.type === 'speed_slider') {
    handleSpeedSliderInput(state, input);
    return;
  }

  // Radial menu
  if (state.radialMenu) {
    handleRadialMenuInput(state, canvas, input, worldMouse);
    return;
  }

  // Legacy popup fallback
  if (state.popup && input.justPressed) {
    state.popup = null;
    return;
  }

  // Deploying operator
  if (inter.type === 'deploying_op') {
    handleDeployingOp(state, input, worldMouse);
    return;
  }

  // Moving operator
  if (inter.type === 'moving_op') {
    handleMovingOp(state, input, worldMouse);
    return;
  }

  // Pending node confirm/cancel
  if (state.pendingNode && inter.type === 'placing_waypoints' && input.justPressed) {
    if (handlePendingNodeButtons(state, canvas, input)) return;
  }

  // Placing waypoints
  if (inter.type === 'placing_waypoints') {
    handlePlacingWaypoints(state, canvas, input, worldMouse);
    return;
  }

  // Setting facing
  if (inter.type === 'setting_facing') {
    handleSettingFacing(state, input, worldMouse);
    return;
  }

  // Dragging node
  if (inter.type === 'dragging_node') {
    handleDraggingNode(state, input, worldMouse);
    return;
  }

  // Setting look target
  if (inter.type === 'setting_look_target') {
    if (input.justPressed) {
      const op = state.operators.find(o => o.id === inter.opId);
      if (op) { op.path.waypoints[inter.wpIdx].lookTarget = copy(worldMouse); op.path.waypoints[inter.wpIdx].facingOverride = null; }
      state.interaction = { type: 'idle' };
    }
    return;
  }

  // Tempo ring
  if (inter.type === 'tempo_ring') {
    handleTempoRing(state, input, worldMouse);
    return;
  }

  // Spinning direction
  if (inter.type === 'spinning_direction') {
    handleSpinningDirection(state, input, worldMouse);
    return;
  }

  // Placing pie
  if (inter.type === 'placing_pie') {
    handlePlacingPie(state, input, worldMouse);
    return;
  }

  // IDLE: right-click
  if (input.rightJustPressed) {
    handleIdleRightClick(state, input, worldMouse);
    return;
  }

  // IDLE: left-click
  if (input.justPressed) {
    handleIdleLeftClick(state, canvas, input, worldMouse);
  }
}

// ---- Internal sub-handlers ----

function handleSharePanelInput(state: GameState, canvas: HTMLCanvasElement, input: ReturnType<typeof getInput>) {
  const W = canvas.width, H = canvas.height;
  const sp = state.sharePanel;
  const panelW = 340, panelH = sp.gifBlob ? 330 : 300;
  const px = W / 2 - panelW / 2, py = H / 2 - panelH / 2;
  const mx = input.mousePos.x, my = input.mousePos.y;

  const btnW = panelW - 40, btnH2 = 36, btnX = px + 20;
  const startY = py + 58;
  const gap = 10;
  const gifSectionY = startY + btnH2 + gap + 26;

  state.hoveredShareBtn = null;
  canvas.style.cursor = 'default';

  if (mx >= px && mx <= px + panelW && my >= py && my <= py + panelH) {
    if (hitBtn(input.mousePos, px + panelW - 32, py + 8, 24, 24)) {
      state.hoveredShareBtn = 'close';
      canvas.style.cursor = 'pointer';
    } else if (hitBtn(input.mousePos, btnX, startY, btnW, btnH2)) {
      state.hoveredShareBtn = 'copy_code';
      canvas.style.cursor = 'pointer';
    } else if (!sp.exporting) {
      if (sp.gifBlob) {
        if (hitBtn(input.mousePos, btnX, gifSectionY, btnW, btnH2)) {
          state.hoveredShareBtn = 'download_gif';
          canvas.style.cursor = 'pointer';
        } else if (hitBtn(input.mousePos, btnX, gifSectionY + btnH2 + gap + 18, btnW, 30)) {
          state.hoveredShareBtn = 'export_gif';
          canvas.style.cursor = 'pointer';
        }
      } else {
        if (hitBtn(input.mousePos, btnX, gifSectionY, btnW, btnH2)) {
          state.hoveredShareBtn = 'export_gif';
          canvas.style.cursor = 'pointer';
        }
      }
    }
  }

  if (input.justPressed) {
    if (state.hoveredShareBtn === 'close') { sfxBack(); closeSharePanel(state); }
    else if (state.hoveredShareBtn === 'copy_code') { sfxConfirm(); copyRoomCode(state); }
    else if (state.hoveredShareBtn === 'export_gif') { sfxClick(); doExportGif(state); }
    else if (state.hoveredShareBtn === 'download_gif') { sfxConfirm(); downloadShareGif(state); }
    else if (!sp.exporting && !(mx >= px && mx <= px + panelW && my >= py && my <= py + panelH)) {
      sfxBack(); closeSharePanel(state);
    }
  }
}

/** Returns true if a HUD button was clicked (consumed the input) */
function handleHudButtonClick(state: GameState, canvas: HTMLCanvasElement, selRoom: string, selOpCount: number): boolean {
  const h = state.hoveredHudBtn;
  if (!h) return false;

  if (h === 'go') {
    sfxConfirm();
    const sync = getNetSync();
    if (state.multiplayer && sync && state.mode === 'planning') {
      // Multiplayer: toggle READY instead of GO
      const mp = state.multiplayer;
      if (mp.readyPlayers.includes(mp.localPlayerId)) {
        sync.sendUnready();
      } else {
        sync.sendReady();
      }
    } else {
      // Single player: normal GO/pause behavior
      if (state.mode === 'planning') doGo(state);
      else if (state.mode === 'executing') { state.mode = 'paused'; }
      else if (state.mode === 'paused') { state.mode = 'executing'; }
    }
    return true;
  }
  if (h === 'save_stage') { sfxConfirm(); saveStage(state); state.stageJustCompleted = false; return true; }
  if (h === 'reset') { sfxBack(); doReset(state); return true; }
  if (h === 'clear_level') { sfxDelete(); doClearLevel(state); return true; }
  if (h === 'menu') { sfxBack(); return true; } // caller handles show('menu')
  if (h === 'replay') { sfxClick(); doReplay(state); return true; }
  if (h === 'save_progress') { sfxConfirm(); saveProgress(state, selRoom, selOpCount); showSaveConfirmation(); return true; }
  if (h === 'edit_stage') { sfxClick(); editStage(state); return true; }
  if (h.startsWith('stage_')) {
    sfxTick();
    const idx = parseInt(h.split('_')[1]);
    if (state.mode === 'planning') {
      state.viewingStageIndex = state.viewingStageIndex === idx ? -1 : idx;
    }
    return true;
  }
  return false;
}

function handleSpeedSliderInput(state: GameState, input: ReturnType<typeof getInput>) {
  const slider = state.speedSlider!;
  const inter = state.interaction as { type: 'speed_slider'; opId: number; wpIdx: number | null; sliderValue: number };
  const sliderX = slider.screenPos.x;
  const sliderY = slider.screenPos.y;
  const sliderW = 120, sliderH = 30;
  const trackX = sliderX + 10, trackW = sliderW - 20;

  if (input.justPressed) {
    if (input.mousePos.x >= sliderX && input.mousePos.x <= sliderX + sliderW &&
        input.mousePos.y >= sliderY - 5 && input.mousePos.y <= sliderY + sliderH + 5) {
      slider.dragging = true;
    } else {
      state.speedSlider = null;
      state.interaction = { type: 'idle' };
      state.popup = null;
      return;
    }
  }
  if (slider.dragging && input.mouseDown) {
    const frac = Math.max(0, Math.min(1, (input.mousePos.x - trackX) / trackW));
    const newTempo = Math.round((0.2 + frac * 2.8) * 10) / 10;
    slider.value = newTempo;
    const op = state.operators.find(o => o.id === inter.opId);
    if (op) {
      if (inter.wpIdx !== null) {
        op.path.waypoints[inter.wpIdx].tempo = newTempo;
      } else {
        op.tempo = newTempo;
      }
    }
  }
  if (input.justReleased) {
    slider.dragging = false;
  }
}

function handleRadialMenuInput(state: GameState, canvas: HTMLCanvasElement, input: ReturnType<typeof getInput>, worldMouse: Vec2) {
  const menu = state.radialMenu!;
  menu.hoveredIdx = hitTestRadialMenu(worldMouse, menu, state);
  if (menu.animT < 1) menu.animT = Math.min(1, menu.animT + 0.15);

  if (input.justPressed) {
    const items = getRadialItems(menu.wpIdx, state, menu.opId);
    if (menu.hoveredIdx >= 0) {
      sfxSelect();
      const item = items[menu.hoveredIdx];
      const op = state.operators.find(o => o.id === menu.opId);
      if (op) {
        handleRadialItemAction(item, op, menu, state, canvas);
      }
    }
    state.radialMenu = null;
    return;
  }
  if (input.rightJustPressed) {
    state.radialMenu = null;
    return;
  }
}

function handleDeployingOp(state: GameState, input: ReturnType<typeof getInput>, worldMouse: Vec2) {
  const inter = state.interaction as { type: 'deploying_op'; opId: number };
  const op = state.operators.find(o => o.id === inter.opId);
  if (op && input.mouseDown) op.position = copy(worldMouse);
  if (input.justReleased && op) {
    op.deployed = true;
    op.startPosition = copy(op.position);
    op.smoothPosition = copy(op.position);
    op.angle = 0;
    op.startAngle = 0;
    op.currentFloor = state.activeFloor;
    op.startFloor = state.activeFloor;
    state.interaction = { type: 'idle' };
    // Multiplayer: claim this operator
    const sync = getNetSync();
    if (sync) sync.sendOperatorClaim(op.id, op.position, op.angle, op.currentFloor);
  }
}

function handleMovingOp(state: GameState, input: ReturnType<typeof getInput>, worldMouse: Vec2) {
  const inter = state.interaction as { type: 'moving_op'; opId: number };
  const op = state.operators.find(o => o.id === inter.opId);
  if (op && input.mouseDown && input.isDragging) {
    op.position = copy(worldMouse);
    op.startPosition = copy(op.position);
    if (op.path.waypoints.length > 0) {
      op.path.waypoints[0].position = copy(worldMouse);
      rebuildPathLUT(op);
    }
  }
  if (input.justReleased) {
    if (!input.isDragging && op) {
      state.radialMenu = { center: copy(op.position), opId: op.id, wpIdx: -1, hoveredIdx: -1, animT: 0 };
    }
    // Multiplayer: send final operator position
    if (op && input.isDragging) {
      const sync = getNetSync();
      if (sync) sync.sendOperatorMove(op.id, op.position, op.angle);
    }
    state.interaction = { type: 'idle' };
  }
}

/** Returns true if a pending node button was clicked */
function handlePendingNodeButtons(state: GameState, canvas: HTMLCanvasElement, input: ReturnType<typeof getInput>): boolean {
  const pn = state.pendingNode!;
  const op = state.operators.find(o => o.id === pn.opId);
  if (!op || pn.wpIdx >= op.path.waypoints.length) return false;

  const wp = op.path.waypoints[pn.wpIdx];
  const cam2 = state.camera;
  const sp2 = {
    x: (wp.position.x - cam2.x) * cam2.zoom + canvas.width / 2,
    y: (wp.position.y - cam2.y) * cam2.zoom + canvas.height / 2,
  };
  const btnSize = 16;
  const checkX = sp2.x + 14, checkY = sp2.y - 8;
  if (hitBtn(input.mousePos, checkX, checkY, btnSize, btnSize)) {
    state.pendingNode = null;
    state.interaction = { type: 'idle' };
    return true;
  }
  const cancelX = sp2.x - 14 - btnSize, cancelY = sp2.y - 8;
  if (hitBtn(input.mousePos, cancelX, cancelY, btnSize, btnSize)) {
    op.path.waypoints.splice(pn.wpIdx, 1);
    rebuildPathLUT(op);
    state.pendingNode = null;
    state.interaction = { type: 'idle' };
    return true;
  }
  return false;
}

function handlePlacingWaypoints(state: GameState, canvas: HTMLCanvasElement, input: ReturnType<typeof getInput>, worldMouse: Vec2) {
  const inter = state.interaction as { type: 'placing_waypoints'; opId: number };
  const op = state.operators.find(o => o.id === inter.opId);
  if (input.justPressed && op) {
    const hudBarY = canvas.height - 44;
    const deployBarY = hudBarY - DEPLOY_PANEL_H - 6;
    if (input.mousePos.y > deployBarY) { state.interaction = { type: 'idle' }; state.pendingNode = null; return; }
    if (distance(worldMouse, op.position) < OP_R + 8) {
      state.interaction = { type: 'idle' };
      state.pendingNode = null;
      state.radialMenu = { center: copy(op.position), opId: op.id, wpIdx: -1, hoveredIdx: -1, animT: 0 };
      return;
    }
    const wpFloor = state.activeFloor;
    const stair = getStairAtPoint(state.room, worldMouse.x, worldMouse.y, state.activeFloor);
    if (stair && stair.connectsFloors) {
      const prevWp = op.path.waypoints.length > 0 ? op.path.waypoints[op.path.waypoints.length - 1] : null;
      const prevOnSameStair = prevWp &&
        prevWp.position.x >= stair.x && prevWp.position.x <= stair.x + stair.w &&
        prevWp.position.y >= stair.y && prevWp.position.y <= stair.y + stair.h;
      if (!prevOnSameStair) {
        const destFloor = getStairDestFloor(stair, state.activeFloor);
        state.activeFloor = destFloor;
      }
    }
    const newWp = makeWaypoint(worldMouse, wpFloor);
    op.path.waypoints.push(newWp);
    rebuildPathLUT(op);
    state.pendingNode = { opId: op.id, wpIdx: op.path.waypoints.length - 1 };
    // Multiplayer: send waypoint add
    const sync = getNetSync();
    if (sync) sync.sendWaypointAdd(op.id, op.path.waypoints.length - 1, newWp);
  }
  if (input.rightJustPressed && op) { state.interaction = { type: 'idle' }; state.pendingNode = null; }
}

function handleSettingFacing(state: GameState, input: ReturnType<typeof getInput>, worldMouse: Vec2) {
  const inter = state.interaction as { type: 'setting_facing'; opId: number; wpIdx: number | null };
  const op = state.operators.find(o => o.id === inter.opId);
  if (op) {
    const target = inter.wpIdx !== null ? op.path.waypoints[inter.wpIdx] : null;
    const origin = target ? target.position : op.position;
    const dx = worldMouse.x - origin.x, dy = worldMouse.y - origin.y;
    if (dx * dx + dy * dy > 64) {
      const a = Math.atan2(dy, dx);
      if (input.rightMouseDown || input.mouseDown) {
        if (target) { target.facingOverride = a; target.lookTarget = null; }
        else { op.angle = a; op.startAngle = a; }
      }
    }
  }
  if (input.justReleased || input.rightJustReleased) {
    // Multiplayer: send final facing
    if (op) {
      const sync = getNetSync();
      if (sync) {
        const target = inter.wpIdx !== null ? op.path.waypoints[inter.wpIdx] : null;
        const angle = target ? (target.facingOverride ?? 0) : op.angle;
        sync.sendFacingUpdate(op.id, inter.wpIdx, angle);
      }
    }
    state.interaction = { type: 'idle' };
  }
}

function handleDraggingNode(state: GameState, input: ReturnType<typeof getInput>, worldMouse: Vec2) {
  const inter = state.interaction as { type: 'dragging_node'; opId: number; wpIdx: number };
  const op = state.operators.find(o => o.id === inter.opId);
  if (op && input.mouseDown) {
    if (inter.wpIdx === 0) {
      op.position = copy(worldMouse);
      op.startPosition = copy(worldMouse);
      op.path.waypoints[0].position = copy(worldMouse);
    } else {
      op.path.waypoints[inter.wpIdx].position = copy(worldMouse);
    }
    rebuildPathLUT(op);
  }
  if (input.justReleased) {
    if (!input.isDragging && op) {
      if (inter.wpIdx > 0) {
        state.radialMenu = { center: copy(op.path.waypoints[inter.wpIdx].position), opId: op.id, wpIdx: inter.wpIdx, hoveredIdx: -1, animT: 0 };
      }
    }
    // Multiplayer: send waypoint move
    if (op && input.isDragging) {
      const sync = getNetSync();
      if (sync) sync.sendWaypointMove(op.id, inter.wpIdx, op.path.waypoints[inter.wpIdx].position);
    }
    state.interaction = { type: 'idle' };
  }
}

function handleTempoRing(state: GameState, input: ReturnType<typeof getInput>, worldMouse: Vec2) {
  const inter = state.interaction as { type: 'tempo_ring'; opId: number; wpIdx: number | null; centerAngle: number; startTempo: number };
  if (input.mouseDown) {
    const op = state.operators.find(o => o.id === inter.opId);
    if (op) {
      const target = inter.wpIdx !== null ? op.path.waypoints[inter.wpIdx] : null;
      const origin = target ? target.position : op.position;
      const a = Math.atan2(worldMouse.y - origin.y, worldMouse.x - origin.x);
      const norm = (a + Math.PI) / (2 * Math.PI);
      const tempo = Math.round((0.2 + norm * 2.8) * 10) / 10;
      if (target) target.tempo = tempo; else op.tempo = tempo;
    }
  }
  if (input.justReleased) state.interaction = { type: 'idle' };
}

function handleSpinningDirection(state: GameState, input: ReturnType<typeof getInput>, worldMouse: Vec2) {
  const inter = state.interaction as { type: 'spinning_direction'; opId: number };
  const op = state.operators.find(o => o.id === inter.opId);
  if (op) {
    const dx = worldMouse.x - op.position.x;
    const dy = worldMouse.y - op.position.y;
    if (dx * dx + dy * dy > 16) {
      op.angle = Math.atan2(dy, dx);
      op.startAngle = op.angle;
    }
  }
  if (input.justPressed) { state.interaction = { type: 'idle' }; return; }
  if (input.rightJustPressed) { state.interaction = { type: 'idle' }; return; }
}

function handlePlacingPie(state: GameState, input: ReturnType<typeof getInput>, worldMouse: Vec2) {
  const inter = state.interaction as { type: 'placing_pie'; opId: number };
  const op = state.operators.find(o => o.id === inter.opId);
  if (input.justPressed && op) {
    op.pieTarget = copy(worldMouse);
    const dx = worldMouse.x - op.position.x;
    const dy = worldMouse.y - op.position.y;
    if (dx * dx + dy * dy > 16) {
      op.angle = Math.atan2(dy, dx);
      op.startAngle = op.angle;
    }
    state.interaction = { type: 'idle' };
    return;
  }
  if (input.rightJustPressed) {
    if (op) { bakePieDirection(op); op.pieTarget = null; }
    state.interaction = { type: 'idle' };
    return;
  }
}

function handleIdleRightClick(state: GameState, input: ReturnType<typeof getInput>, worldMouse: Vec2) {
  const selOp = state.operators.find(o => o.id === state.selectedOpId && o.deployed);
  if (selOp) {
    for (let i = 1; i < selOp.path.waypoints.length; i++) {
      if (distance(worldMouse, selOp.path.waypoints[i].position) < NODE_R + 6) {
        state.interaction = { type: 'setting_facing', opId: selOp.id, wpIdx: i };
        return;
      }
    }
    state.interaction = { type: 'setting_facing', opId: selOp.id, wpIdx: null };
    return;
  }
  state.isPanning = true;
  state.panStart = { x: input.mousePos.x, y: input.mousePos.y };
  state.panCamStart = { x: state.camera.x, y: state.camera.y };
}

function handleIdleLeftClick(state: GameState, canvas: HTMLCanvasElement, input: ReturnType<typeof getInput>, worldMouse: Vec2) {
  // Deploy bar hit test
  {
    const hudBarY2 = canvas.height - 44;
    const deployY = hudBarY2 - DEPLOY_PANEL_H / 2 - 3;
    const undeployed = state.operators.filter(o => !o.deployed);
    if (undeployed.length > 0 && input.mousePos.y > hudBarY2 - DEPLOY_PANEL_H - 10 && input.mousePos.y < hudBarY2) {
      for (let i = 0; i < undeployed.length; i++) {
        const opX = 30 + i * DEPLOY_OP_SPACING;
        if (Math.abs(input.mousePos.x - opX) < 16 && Math.abs(input.mousePos.y - deployY) < 18) {
          const op = undeployed[i];
          op.position = copy(worldMouse);
          state.interaction = { type: 'deploying_op', opId: op.id };
          state.selectedOpId = op.id;
          return;
        }
      }
    }
  }

  // Selected operator body/nodes/path
  const selOp = state.operators.find(o => o.id === state.selectedOpId && o.deployed);
  if (selOp) {
    if (distance(worldMouse, selOp.position) < OP_R + 8) {
      state.interaction = { type: 'moving_op', opId: selOp.id };
      return;
    }
    for (let i = 1; i < selOp.path.waypoints.length; i++) {
      if (distance(worldMouse, selOp.path.waypoints[i].position) < NODE_R + 4) {
        state.interaction = { type: 'dragging_node', opId: selOp.id, wpIdx: i }; return;
      }
    }
    const lut = selOp.path.splineLUT;
    if (lut && lut.samples.length > 1) {
      let bestD = Infinity, bestI = -1;
      for (let i = 0; i < lut.samples.length - 1; i++) {
        const d = distToSegment(worldMouse, lut.samples[i], lut.samples[i + 1]);
        if (d < bestD) { bestD = d; bestI = i; }
      }
      if (bestD < 12) {
        const cp = closestPointOnSegment(worldMouse, lut.samples[bestI], lut.samples[bestI + 1]);
        const wc = selOp.path.waypoints.length;
        const frac = bestI / (lut.samples.length - 1);
        const insertAfter = Math.min(Math.floor(frac * (wc - 1)), wc - 2);
        selOp.path.waypoints.splice(insertAfter + 1, 0, makeWaypoint(cp, state.activeFloor));
        rebuildPathLUT(selOp);
        state.interaction = { type: 'dragging_node', opId: selOp.id, wpIdx: insertAfter + 1 };
        return;
      }
    }
  }

  // Other operators (only select if we can interact)
  for (const op of state.operators) {
    if (!op.deployed) continue;
    if (op.id === state.selectedOpId) continue;
    if (distance(worldMouse, op.position) < OP_R + 8) {
      if (isOtherPlayersOp(state, op.id)) continue; // can't select other players' ops
      state.selectedOpId = op.id;
      state.activeFloor = op.currentFloor;
      state.popup = null;
      state.radialMenu = null;
      state.pendingNode = null;
      state.interaction = { type: 'idle' };
      return;
    }
  }

  if (state.interaction.type === 'idle') {
    state.selectedOpId = null; state.popup = null; state.radialMenu = null;
    state.activeFloor = 0;
  }
}

/**
 * Handle keyboard input for game screen.
 * Returns 'menu' if the user pressed Escape to go to menu, null otherwise.
 */
export function handleGameKeydown(e: KeyboardEvent, state: GameState): 'menu' | null {
  if (state.screen !== 'game') return null;

  // Share panel ESC handling
  if (e.key === 'Escape' && state.sharePanel.open && !state.sharePanel.exporting) {
    closeSharePanel(state);
    e.preventDefault();
    return null;
  }

  switch (e.key) {
    case ' ':
      e.preventDefault();
      {
        const sync = getNetSync();
        if (state.multiplayer && sync && state.mode === 'planning') {
          const mp = state.multiplayer;
          if (mp.readyPlayers.includes(mp.localPlayerId)) sync.sendUnready();
          else sync.sendReady();
        } else {
          if (state.mode === 'planning') doGo(state);
          else if (state.mode === 'executing') { state.mode = 'paused'; }
          else if (state.mode === 'paused') { state.mode = 'executing'; }
        }
      }
      break;
    case 'r': case 'R': doReset(state); break;
    case 'Escape':
      state.popup = null;
      state.radialMenu = null;
      state.pendingNode = null;
      state.speedSlider = null;
      if (state.interaction.type === 'placing_pie') {
        const inter = state.interaction;
        const op = state.operators.find(o => o.id === inter.opId);
        if (op) { bakePieDirection(op); op.pieTarget = null; }
      }
      if (state.interaction.type === 'placing_waypoints' || state.interaction.type === 'placing_pie' || state.interaction.type === 'speed_slider') state.interaction = { type: 'idle' };
      state.selectedOpId = null;
      break;
    case 'Delete': case 'Backspace': deleteSelected(state); break;
  }
  return null;
}
