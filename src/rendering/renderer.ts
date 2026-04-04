import type { GameState, Operator, Room, WallSegment, ThreatMarker, NodePopup, Camera, HudBtn, SharePanelBtn, SpeedSliderState } from '../types';
import { WALL_W, OP_R, THREAT_R, GRID, DOOR_W, C, NODE_R, DEPLOY_PANEL_H, DEPLOY_OP_SPACING } from '../types';
import { getWallsForCollision } from '../room/room';
import { computeOperatorFOV } from '../operator/visibility';
import type { Vec2 } from '../math/vec2';
import type { Wall } from '../math/intersection';

function worldToScreen(p: Vec2, cam: Camera, W: number, H: number): Vec2 {
  return {
    x: (p.x - cam.x) * cam.zoom + W / 2,
    y: (p.y - cam.y) * cam.zoom + H / 2,
  };
}

export function renderGame(canvas: HTMLCanvasElement, state: GameState) {
  const ctx = canvas.getContext('2d')!;
  const W = canvas.width, H = canvas.height;
  const walls = getWallsForCollision(state.room);
  const sid = state.selectedOpId;
  const cam = state.camera;

  // Clear full screen
  ctx.fillStyle = C.bg;
  ctx.fillRect(0, 0, W, H);

  // ---- Apply camera transform for world-space drawing ----
  ctx.save();
  ctx.translate(W / 2, H / 2);
  ctx.scale(cam.zoom, cam.zoom);
  ctx.translate(-cam.x, -cam.y);

  // Floor cells
  const fl = state.room.floor;
  if (fl.length > 0) {
    ctx.fillStyle = C.floor;
    for (const cell of fl) {
      ctx.fillRect(cell.x, cell.y, GRID, GRID);
    }
  }

  // Grid (subtle)
  ctx.strokeStyle = C.grid; ctx.lineWidth = 0.5 / cam.zoom;
  const gridStep = GRID;
  const viewLeft = cam.x - W / 2 / cam.zoom;
  const viewTop = cam.y - H / 2 / cam.zoom;
  const viewRight = cam.x + W / 2 / cam.zoom;
  const viewBottom = cam.y + H / 2 / cam.zoom;
  const gx0 = Math.floor(viewLeft / gridStep) * gridStep;
  const gy0 = Math.floor(viewTop / gridStep) * gridStep;
  for (let x = gx0; x <= viewRight; x += gridStep) { ctx.beginPath(); ctx.moveTo(x, viewTop); ctx.lineTo(x, viewBottom); ctx.stroke(); }
  for (let y = gy0; y <= viewBottom; y += gridStep) { ctx.beginPath(); ctx.moveTo(viewLeft, y); ctx.lineTo(viewRight, y); ctx.stroke(); }

  // FOV cones
  const isExecMode = state.mode === 'executing' || state.mode === 'paused';
  for (const op of state.operators) {
    if (!op.deployed) continue;
    const grey = sid !== null && op.id !== sid;
    drawFOV(ctx, op, walls, grey, isExecMode);
  }

  // Threats
  for (const t of state.room.threats) drawThreat(ctx, t);

  // Walls
  for (const w of state.room.walls) drawWall(ctx, w);

  // Paths
  for (const op of state.operators) {
    if (!op.deployed) continue;
    const grey = sid !== null && op.id !== sid;
    drawPath(ctx, op, grey, state);
  }

  // Path preview (placing waypoints mode)
  if (state.interaction.type === 'placing_waypoints') {
    const inter = state.interaction;
    const op = state.operators.find(o => o.id === inter.opId);
    if (op && op.path.waypoints.length > 0) {
      const last = op.path.waypoints[op.path.waypoints.length - 1];
      ctx.strokeStyle = op.color; ctx.lineWidth = 1; ctx.globalAlpha = 0.35;
      ctx.setLineDash([6, 4]);
      ctx.beginPath(); ctx.moveTo(last.position.x, last.position.y);
      ctx.stroke(); ctx.setLineDash([]); ctx.globalAlpha = 1;
    }
  }

  // Pie targets (dotted line + pizza icon)
  for (const op of state.operators) {
    if (!op.deployed || !op.pieTarget) continue;
    const grey = sid !== null && op.id !== sid;
    drawPieTarget(ctx, op, grey);
  }

  // Operators (deployed ones + the one currently being dragged from deploy panel)
  const deployingOpId = state.interaction.type === 'deploying_op' ? state.interaction.opId : -1;
  const isExec = state.mode === 'executing' || state.mode === 'paused';
  for (const op of state.operators) {
    if (!op.deployed && op.id !== deployingOpId) continue;
    const grey = sid !== null && op.id !== sid;
    const isDragging = op.id === deployingOpId;
    drawOp(ctx, op, op.id === sid || isDragging, grey, isDragging, isExec);
  }

  // ---- Restore from camera transform (back to screen space) ----
  ctx.restore();

  // Deploy panel (screen space)
  drawDeployPanel(ctx, state, H);

  // Bottom HUD bar (screen space)
  drawHUD(ctx, state, W, H);

  // Popup (screen space - but positioned relative to world object)
  if (state.popup) {
    // Convert popup world position to screen
    const sp = worldToScreen(state.popup.position, cam, W, H);
    drawPopup(ctx, { ...state.popup, position: sp }, state);
  }

  // Speed slider (screen space)
  if (state.speedSlider) {
    drawSpeedSlider(ctx, state.speedSlider);
  }

  // Pending node confirm/cancel buttons (screen space)
  drawPendingNodeButtons(ctx, state);

  // Room cleared overlay (screen space)
  if (state.roomCleared) {
    ctx.fillStyle = 'rgba(0,0,0,0.3)'; ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = 'rgba(10,30,20,0.9)';
    const bx = W / 2 - 130, by = H / 2 - 30;
    ctx.fillRect(bx, by, 260, 60);
    ctx.strokeStyle = C.cleared; ctx.lineWidth = 2; ctx.strokeRect(bx, by, 260, 60);
    ctx.fillStyle = C.cleared; ctx.font = 'bold 22px monospace'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('ROOM CLEARED', W / 2, H / 2); ctx.textBaseline = 'alphabetic';
  }

  // Share panel overlay
  if (state.sharePanel.open) {
    drawSharePanel(ctx, state, W, H);
  }
}

// ---- Exports for GIF ----
export function getCanvas(): HTMLCanvasElement { return document.getElementById('cv') as HTMLCanvasElement; }
export function getCtx(): CanvasRenderingContext2D { return getCanvas().getContext('2d')!; }

// ---- Drawing functions ----

function drawFOV(ctx: CanvasRenderingContext2D, op: Operator, walls: Wall[], grey: boolean, executing: boolean = false) {
  if (grey) ctx.globalAlpha = 0.08;
  const poly = computeOperatorFOV(op, walls);
  if (poly.length < 2) { ctx.globalAlpha = 1; return; }
  const pos = executing ? op.smoothPosition : op.position;
  ctx.fillStyle = C.fov(op.color);
  ctx.beginPath(); ctx.moveTo(pos.x, pos.y);
  for (const p of poly) ctx.lineTo(p.x, p.y);
  ctx.closePath(); ctx.fill();
  ctx.strokeStyle = C.fovEdge(op.color); ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(pos.x, pos.y); ctx.lineTo(poly[0].x, poly[0].y); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(pos.x, pos.y); ctx.lineTo(poly[poly.length - 1].x, poly[poly.length - 1].y); ctx.stroke();
  ctx.globalAlpha = 1;
}

function drawThreat(ctx: CanvasRenderingContext2D, t: ThreatMarker) {
  const p = t.position, r = THREAT_R, n = t.neutralized;
  ctx.fillStyle = n ? 'rgba(80,80,80,0.15)' : C.threatGlow;
  ctx.beginPath(); ctx.arc(p.x, p.y, r * 2.5, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = n ? C.threatDead : C.threat; ctx.lineWidth = n ? 2 : 3; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(p.x - r, p.y - r); ctx.lineTo(p.x + r, p.y + r); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(p.x + r, p.y - r); ctx.lineTo(p.x - r, p.y + r); ctx.stroke();
}

function drawWall(ctx: CanvasRenderingContext2D, w: WallSegment) {
  const { a, b, hasDoor, doorOpen } = w;
  if (hasDoor) {
    const dx = b.x - a.x, dy = b.y - a.y, len = Math.sqrt(dx * dx + dy * dy);
    if (len < 1) return;
    const dp = w.doorPos;
    const f = Math.min(DOOR_W / len, 0.9), gs = dp - f / 2, ge = dp + f / 2;
    ctx.lineCap = 'round'; ctx.strokeStyle = C.wall; ctx.lineWidth = WALL_W;
    if (gs > 0.02) { ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(a.x + dx * gs, a.y + dy * gs); ctx.stroke(); }
    if (ge < 0.98) { ctx.beginPath(); ctx.moveTo(a.x + dx * ge, a.y + dy * ge); ctx.lineTo(b.x, b.y); ctx.stroke(); }
    const px = -dy / len * 5, py = dx / len * 5;
    ctx.strokeStyle = doorOpen ? C.doorOpen : C.doorClosed; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(a.x + dx * gs + px, a.y + dy * gs + py); ctx.lineTo(a.x + dx * gs - px, a.y + dy * gs - py); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(a.x + dx * ge + px, a.y + dy * ge + py); ctx.lineTo(a.x + dx * ge - px, a.y + dy * ge - py); ctx.stroke();
  } else {
    ctx.lineCap = 'round';
    ctx.strokeStyle = C.wallEdge; ctx.lineWidth = WALL_W + 2;
    ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
    ctx.strokeStyle = C.wall; ctx.lineWidth = WALL_W;
    ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
  }
}

function drawPath(ctx: CanvasRenderingContext2D, op: Operator, grey: boolean, state: GameState) {
  const wps = op.path.waypoints;
  if (wps.length < 2) return;
  const alpha = grey ? C.pathGrey : C.pathAlpha;
  const lut = op.path.splineLUT;
  if (lut && lut.samples.length > 1) {
    ctx.strokeStyle = grey ? '#444' : op.color;
    ctx.globalAlpha = alpha; ctx.lineWidth = 2; ctx.setLineDash([8, 5]); ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(lut.samples[0].x, lut.samples[0].y);
    for (let i = 1; i < lut.samples.length; i++) ctx.lineTo(lut.samples[i].x, lut.samples[i].y);
    ctx.stroke(); ctx.setLineDash([]); ctx.globalAlpha = 1;
  }
  if (grey) return;

  const isSel = state.selectedOpId === op.id;
  for (let i = 0; i < wps.length; i++) {
    const wp = wps[i], p = wp.position;
    const r = isSel ? NODE_R : 3;
    ctx.fillStyle = wp.hold ? C.hold : op.color;
    ctx.strokeStyle = C.node; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, Math.PI * 2); ctx.fill(); ctx.stroke();

    if (wp.facingOverride !== null) {
      const al = 14, ax = p.x + Math.cos(wp.facingOverride) * al, ay = p.y + Math.sin(wp.facingOverride) * al;
      ctx.strokeStyle = op.color; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(ax, ay); ctx.stroke();
    }
    if (wp.lookTarget) {
      ctx.strokeStyle = C.lookLine; ctx.lineWidth = 1; ctx.setLineDash([5, 4]); ctx.globalAlpha = 0.5;
      ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(wp.lookTarget.x, wp.lookTarget.y); ctx.stroke();
      ctx.setLineDash([]); ctx.globalAlpha = 1;
      ctx.strokeStyle = C.lookLine; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(wp.lookTarget.x - 5, wp.lookTarget.y); ctx.lineTo(wp.lookTarget.x + 5, wp.lookTarget.y); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(wp.lookTarget.x, wp.lookTarget.y - 5); ctx.lineTo(wp.lookTarget.x, wp.lookTarget.y + 5); ctx.stroke();
    }
    if (wp.hold) {
      ctx.strokeStyle = C.hold; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(p.x, p.y, r + 4, 0, Math.PI * 2); ctx.stroke();
    }
    if (wp.tempo !== 1 && isSel) {
      ctx.fillStyle = wp.tempo > 1 ? C.tempoFast : C.tempoSlow;
      ctx.font = '8px monospace'; ctx.textAlign = 'center'; ctx.textBaseline = 'top';
      ctx.fillText(`${wp.tempo}x`, p.x, p.y + r + 3);
    }
  }
}

function drawPieTarget(ctx: CanvasRenderingContext2D, op: Operator, grey: boolean) {
  const pie = op.pieTarget;
  if (!pie) return;
  const p = op.position;

  // Dotted line from operator to pie target
  ctx.save();
  ctx.globalAlpha = grey ? 0.15 : 0.55;
  ctx.strokeStyle = op.color;
  ctx.lineWidth = 1.5;
  ctx.setLineDash([6, 5]);
  ctx.beginPath();
  ctx.moveTo(p.x, p.y);
  ctx.lineTo(pie.x, pie.y);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.globalAlpha = grey ? 0.2 : 1;

  // Pizza icon at target position
  const r = 8;
  // Outer circle (crust)
  ctx.fillStyle = '#d4a24a';
  ctx.beginPath();
  ctx.arc(pie.x, pie.y, r, 0, Math.PI * 2);
  ctx.fill();
  // Inner circle (cheese)
  ctx.fillStyle = '#e8c84a';
  ctx.beginPath();
  ctx.arc(pie.x, pie.y, r * 0.75, 0, Math.PI * 2);
  ctx.fill();
  // Slice lines
  ctx.strokeStyle = '#b8842a';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(pie.x, pie.y);
  ctx.lineTo(pie.x + r * Math.cos(0), pie.y + r * Math.sin(0));
  ctx.moveTo(pie.x, pie.y);
  ctx.lineTo(pie.x + r * Math.cos(Math.PI * 0.667), pie.y + r * Math.sin(Math.PI * 0.667));
  ctx.moveTo(pie.x, pie.y);
  ctx.lineTo(pie.x + r * Math.cos(Math.PI * 1.333), pie.y + r * Math.sin(Math.PI * 1.333));
  ctx.stroke();
  // Pepperoni dots
  ctx.fillStyle = '#cc4433';
  const dots = [
    { x: pie.x + 3, y: pie.y - 2 },
    { x: pie.x - 2, y: pie.y + 3 },
    { x: pie.x - 3, y: pie.y - 3 },
  ];
  for (const d of dots) {
    ctx.beginPath();
    ctx.arc(d.x, d.y, 1.5, 0, Math.PI * 2);
    ctx.fill();
  }
  // Border ring
  ctx.strokeStyle = grey ? '#555' : op.color;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.arc(pie.x, pie.y, r + 1, 0, Math.PI * 2);
  ctx.stroke();

  ctx.restore();
}

function drawOp(ctx: CanvasRenderingContext2D, op: Operator, selected: boolean, grey: boolean, dragging: boolean = false, executing: boolean = false) {
  // Use smoothed position during execution for aesthetic polish
  const p = executing ? op.smoothPosition : op.position;
  const { angle, color } = op;
  const r = OP_R;
  ctx.save();
  ctx.translate(p.x, p.y);

  // Drag animation: scale up slightly + drop shadow
  if (dragging) {
    ctx.scale(1.25, 1.25);
    ctx.shadowColor = 'rgba(0,0,0,0.5)';
    ctx.shadowBlur = 16;
    ctx.shadowOffsetX = 3;
    ctx.shadowOffsetY = 3;
  }

  ctx.rotate(angle);
  if (grey) ctx.globalAlpha = 0.25;
  if (selected && !dragging) { ctx.shadowColor = color; ctx.shadowBlur = 12; }

  const tip = r + 3, back = -r + 1, side = r - 1, notch = -r * 0.25;
  ctx.beginPath();
  ctx.moveTo(tip, 0);
  ctx.lineTo(back, -side);
  ctx.lineTo(notch, 0);
  ctx.lineTo(back, side);
  ctx.closePath();
  ctx.fillStyle = grey ? C.opBodyGrey : C.opBody;
  ctx.fill();
  ctx.strokeStyle = grey ? '#555' : color; ctx.lineWidth = 2; ctx.stroke();
  ctx.strokeStyle = C.opOutline; ctx.lineWidth = 0.8; ctx.stroke();
  ctx.shadowBlur = 0; ctx.shadowColor = 'transparent';
  ctx.shadowOffsetX = 0; ctx.shadowOffsetY = 0;

  ctx.globalAlpha = 1;
  ctx.restore();
}

function drawDeployPanel(ctx: CanvasRenderingContext2D, state: GameState, H: number) {
  if (state.mode !== 'planning') return;
  const undeployed = state.operators.filter(o => !o.deployed);
  if (undeployed.length === 0) return;

  const hudBarY = H - 36;
  const barY = hudBarY - DEPLOY_PANEL_H - 4;
  const barW = 20 + undeployed.length * DEPLOY_OP_SPACING;
  const barH = DEPLOY_PANEL_H;
  const deployY = barY + barH / 2;

  // Background
  ctx.fillStyle = C.panelBg;
  ctx.fillRect(8, barY, barW, barH);

  // Dotted border
  ctx.strokeStyle = C.accent; ctx.lineWidth = 1.5;
  ctx.setLineDash([5, 4]);
  ctx.strokeRect(8, barY, barW, barH);
  ctx.setLineDash([]);

  // Label above
  ctx.fillStyle = C.hudText; ctx.font = '9px monospace'; ctx.textAlign = 'left'; ctx.textBaseline = 'bottom';
  ctx.fillText('DRAG OPERATORS INTO PLACE', 12, barY - 4);

  // Operators in a horizontal row facing right
  for (let i = 0; i < undeployed.length; i++) {
    const op = undeployed[i];
    const ox = 30 + i * DEPLOY_OP_SPACING;

    ctx.save();
    ctx.translate(ox, deployY);
    ctx.rotate(0); // facing right

    // Draw chevron shape (same as game operator but slightly larger for grab-ability)
    const r = OP_R + 2;
    const tip = r + 3, back = -r + 1, side = r - 1, notch = -r * 0.25;
    ctx.beginPath();
    ctx.moveTo(tip, 0);
    ctx.lineTo(back, -side);
    ctx.lineTo(notch, 0);
    ctx.lineTo(back, side);
    ctx.closePath();
    ctx.fillStyle = C.opBody;
    ctx.fill();
    ctx.strokeStyle = op.color; ctx.lineWidth = 2.5; ctx.stroke();
    ctx.strokeStyle = C.opOutline; ctx.lineWidth = 0.8; ctx.stroke();
    ctx.restore();
  }
}

function drawHUD(ctx: CanvasRenderingContext2D, state: GameState, W: number, H: number) {
  const barH = 36, barY = H - barH;
  const hov = state.hoveredHudBtn;

  // Bar background
  ctx.fillStyle = C.hud;
  ctx.fillRect(0, barY, W, barH);
  ctx.strokeStyle = C.hudBorder; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(0, barY); ctx.lineTo(W, barY); ctx.stroke();

  ctx.font = 'bold 11px monospace'; ctx.textBaseline = 'middle';
  const cy = barY + barH / 2;

  // Left: room name
  ctx.fillStyle = C.hudBright; ctx.textAlign = 'left';
  ctx.fillText(state.room.name.toUpperCase(), 12, cy);

  // Center: GO / PAUSE / RESET
  ctx.textAlign = 'center';
  const mode = state.mode;
  if (mode === 'planning') {
    drawHudBtn(ctx, W / 2 - 40, barY + 5, 80, 26, 'GO!', C.accent, hov === 'go');
  } else if (mode === 'executing') {
    drawHudBtn(ctx, W / 2 - 40, barY + 5, 80, 26, 'PAUSE', C.hudText, hov === 'go');
  } else {
    drawHudBtn(ctx, W / 2 - 40, barY + 5, 80, 26, 'RESUME', C.accent, hov === 'go');
  }
  drawHudBtn(ctx, W / 2 + 50, barY + 5, 60, 26, 'RESET', C.hudText, hov === 'reset');
  drawHudBtn(ctx, W / 2 - 110, barY + 5, 60, 26, 'MENU', C.hudText, hov === 'menu');

  // Right: timer + SHARE
  const m = Math.floor(state.elapsedTime / 60), s = Math.floor(state.elapsedTime % 60);
  ctx.fillStyle = C.accent; ctx.textAlign = 'right'; ctx.font = 'bold 12px monospace';
  ctx.fillText(`${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`, W - 78, cy);
  drawHudBtn(ctx, W - 64, barY + 5, 56, 26, 'SHARE', C.hudText, hov === 'share');

  // Mode indicator top-right
  ctx.fillStyle = C.hud; ctx.fillRect(W - 110, 8, 102, 22);
  ctx.strokeStyle = mode === 'executing' ? C.cleared : C.accent; ctx.lineWidth = 1;
  ctx.strokeRect(W - 110, 8, 102, 22);
  ctx.fillStyle = mode === 'executing' ? C.cleared : C.hudBright;
  ctx.font = 'bold 10px monospace'; ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
  ctx.fillText(mode.toUpperCase(), W - 14, 19);
  ctx.textBaseline = 'alphabetic';

  // Flow Kickers logo top-left - matches menu title style
  ctx.save();
  ctx.globalAlpha = 0.35;
  // "Flow" - big italic serif
  ctx.font = 'italic 700 42px Georgia, "Times New Roman", serif';
  ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = '#f2ecda'; // cream-bright
  ctx.fillText('Flow', 14, 44);
  const flowW = ctx.measureText('Flow').width;
  // "Kickers" - smaller uppercase monospace with letter-spacing
  ctx.font = 'bold 15px monospace';
  ctx.fillStyle = '#b0a88e'; // cream-dim
  // Canvas doesn't support letter-spacing, so draw char by char
  const kickers = 'KICKERS';
  let kx = 14 + flowW + 8;
  const ky = 44; // aligned to baseline of "Flow"
  for (const ch of kickers) {
    ctx.fillText(ch, kx, ky);
    kx += ctx.measureText(ch).width + 4; // 4px extra spacing
  }
  ctx.globalAlpha = 1;
  ctx.restore();
}

function drawHudBtn(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, label: string, color: string, hovered: boolean = false) {
  const r = 4; // border radius

  // Background
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
  ctx.fillStyle = hovered ? 'rgba(40,55,75,0.95)' : 'rgba(18,30,48,0.85)';
  ctx.fill();

  // Border
  ctx.strokeStyle = hovered ? C.accent : C.hudBorder;
  ctx.lineWidth = 1;
  ctx.stroke();

  // Label
  ctx.fillStyle = hovered ? C.hudBright : color;
  ctx.font = 'bold 10px monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, x + w / 2, y + h / 2);
  ctx.textBaseline = 'alphabetic';
}

function drawPopup(ctx: CanvasRenderingContext2D, popup: NodePopup, state: GameState) {
  const op = state.operators.find(o => o.id === popup.opId);
  if (!op) return;
  const isOp = popup.wpIdx < 0;
  const wp = isOp ? null : op.path.waypoints[popup.wpIdx];
  const p = popup.position;

  const items = isOp
    ? ['Draw Path', 'Direction', 'Speed', 'Clear Path']
    : ['Set Direction', 'Delete Node', 'Add Route', 'Speed'];
  const iw = 80, ih = 24, gap = 4;
  const totalH = items.length * (ih + gap) - gap;
  const px = p.x + 20, py = p.y - totalH / 2;

  // Background
  ctx.fillStyle = C.popupBg;
  ctx.beginPath();
  ctx.roundRect(px - 6, py - 6, iw + 12, totalH + 12, 4);
  ctx.fill();
  ctx.strokeStyle = C.popupBorder; ctx.lineWidth = 1;
  ctx.stroke();

  for (let i = 0; i < items.length; i++) {
    const iy = py + i * (ih + gap);
    ctx.beginPath();
    ctx.roundRect(px, iy, iw, ih, 3);
    ctx.fillStyle = 'rgba(25,45,50,0.9)';
    ctx.fill();
    ctx.strokeStyle = C.panelBorder; ctx.lineWidth = 0.5;
    ctx.stroke();
    ctx.fillStyle = C.hudBright; ctx.font = '9px monospace'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(items[i], px + iw / 2, iy + ih / 2);
  }

  // Tempo display for node popup
  if (!isOp && wp) {
    if (wp.tempo !== 1) {
      ctx.fillStyle = wp.tempo > 1 ? C.tempoFast : C.tempoSlow;
      ctx.font = 'bold 9px monospace'; ctx.textAlign = 'left'; ctx.textBaseline = 'top';
      ctx.fillText(`${wp.tempo}x`, px + iw + 8, py);
    }
  }
  ctx.textBaseline = 'alphabetic';
}

function drawSpeedSlider(ctx: CanvasRenderingContext2D, slider: SpeedSliderState) {
  const { screenPos, value } = slider;
  const x = screenPos.x, y = screenPos.y;
  const w = 140, h = 40;

  // Background panel
  ctx.beginPath();
  ctx.roundRect(x - 6, y - 6, w + 12, h + 16, 6);
  ctx.fillStyle = C.popupBg;
  ctx.fill();
  ctx.strokeStyle = C.popupBorder; ctx.lineWidth = 1;
  ctx.stroke();

  // Label
  ctx.fillStyle = C.hudText; ctx.font = '8px monospace'; ctx.textAlign = 'left'; ctx.textBaseline = 'top';
  ctx.fillText('SPEED', x, y);

  // Value display
  ctx.fillStyle = value > 1 ? C.tempoFast : value < 1 ? C.tempoSlow : C.hudBright;
  ctx.font = 'bold 10px monospace'; ctx.textAlign = 'right';
  ctx.fillText(`${value.toFixed(1)}x`, x + w, y);

  // Track
  const trackX = x + 10, trackW = w - 20;
  const trackY = y + 22;
  ctx.fillStyle = 'rgba(30,51,82,0.8)';
  ctx.beginPath();
  ctx.roundRect(trackX - 2, trackY - 4, trackW + 4, 8, 4);
  ctx.fill();
  ctx.strokeStyle = C.popupBorder; ctx.lineWidth = 0.5;
  ctx.stroke();

  // Fill (left portion to thumb)
  const frac = (value - 0.2) / 2.8;
  const fillW = frac * trackW;
  if (fillW > 0) {
    ctx.beginPath();
    ctx.roundRect(trackX, trackY - 3, fillW, 6, 3);
    ctx.fillStyle = value > 1 ? 'rgba(204,85,68,0.6)' : 'rgba(85,136,204,0.6)';
    ctx.fill();
  }

  // Thumb
  const thumbX = trackX + frac * trackW;
  ctx.beginPath();
  ctx.arc(thumbX, trackY, 6, 0, Math.PI * 2);
  ctx.fillStyle = C.hudBright;
  ctx.fill();
  ctx.strokeStyle = C.popupBorder; ctx.lineWidth = 1;
  ctx.stroke();

  // Tick marks
  ctx.fillStyle = C.hudText; ctx.font = '7px monospace'; ctx.textAlign = 'center'; ctx.textBaseline = 'top';
  const ticks = [0.5, 1.0, 2.0, 3.0];
  for (const t of ticks) {
    const tf = (t - 0.2) / 2.8;
    const tx = trackX + tf * trackW;
    ctx.fillText(t === 1 ? '1x' : `${t}`, tx, trackY + 8);
  }

  ctx.textBaseline = 'alphabetic';
}

function drawPendingNodeButtons(ctx: CanvasRenderingContext2D, state: GameState) {
  if (!state.pendingNode) return;
  const pn = state.pendingNode;
  const op = state.operators.find(o => o.id === pn.opId);
  if (!op || pn.wpIdx >= op.path.waypoints.length) return;
  const wp = op.path.waypoints[pn.wpIdx];
  const cam = state.camera;
  const W = ctx.canvas.width, H = ctx.canvas.height;
  const sp = {
    x: (wp.position.x - cam.x) * cam.zoom + W / 2,
    y: (wp.position.y - cam.y) * cam.zoom + H / 2,
  };

  const btnSize = 16;
  const offset = 14;

  // Checkmark button (right side)
  const checkX = sp.x + offset, checkY = sp.y - btnSize / 2;
  ctx.beginPath();
  ctx.roundRect(checkX, checkY, btnSize, btnSize, 3);
  ctx.fillStyle = 'rgba(85,170,102,0.85)';
  ctx.fill();
  ctx.strokeStyle = 'rgba(85,170,102,1)'; ctx.lineWidth = 1;
  ctx.stroke();
  // Draw checkmark
  ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(checkX + 3, checkY + btnSize / 2);
  ctx.lineTo(checkX + btnSize / 2 - 1, checkY + btnSize - 4);
  ctx.lineTo(checkX + btnSize - 3, checkY + 4);
  ctx.stroke();

  // X button (left side)
  const cancelX = sp.x - offset - btnSize, cancelY = sp.y - btnSize / 2;
  ctx.beginPath();
  ctx.roundRect(cancelX, cancelY, btnSize, btnSize, 3);
  ctx.fillStyle = 'rgba(204,68,51,0.85)';
  ctx.fill();
  ctx.strokeStyle = 'rgba(204,68,51,1)'; ctx.lineWidth = 1;
  ctx.stroke();
  // Draw X
  ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.lineCap = 'round';
  const xPad = 4;
  ctx.beginPath();
  ctx.moveTo(cancelX + xPad, cancelY + xPad);
  ctx.lineTo(cancelX + btnSize - xPad, cancelY + btnSize - xPad);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(cancelX + btnSize - xPad, cancelY + xPad);
  ctx.lineTo(cancelX + xPad, cancelY + btnSize - xPad);
  ctx.stroke();
}

// ---- Share Panel ----

function drawSharePanelBtn(
  ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number,
  label: string, color: string, hovered: boolean, disabled: boolean = false,
) {
  const r = 5;
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
  if (disabled) {
    ctx.fillStyle = 'rgba(18,30,48,0.5)';
  } else if (hovered) {
    ctx.fillStyle = 'rgba(40,60,85,0.95)';
  } else {
    ctx.fillStyle = 'rgba(22,38,60,0.9)';
  }
  ctx.fill();
  ctx.strokeStyle = hovered && !disabled ? C.accent : C.hudBorder;
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.fillStyle = disabled ? 'rgba(138,131,110,0.4)' : (hovered ? C.hudBright : color);
  ctx.font = 'bold 11px monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, x + w / 2, y + h / 2);
  ctx.textBaseline = 'alphabetic';
}

function drawSharePanel(ctx: CanvasRenderingContext2D, state: GameState, W: number, H: number) {
  const hov = state.hoveredShareBtn;
  const sp = state.sharePanel;

  // Dimmed backdrop
  ctx.fillStyle = 'rgba(0,0,0,0.5)';
  ctx.fillRect(0, 0, W, H);

  // Panel dimensions
  const panelW = 320, panelH = 300;
  const px = W / 2 - panelW / 2, py = H / 2 - panelH / 2;
  const r = 8;

  // Panel background
  ctx.beginPath();
  ctx.roundRect(px, py, panelW, panelH, r);
  ctx.fillStyle = C.panelBg;
  ctx.fill();
  ctx.strokeStyle = C.popupBorder;
  ctx.lineWidth = 1.5;
  ctx.stroke();

  // Title
  ctx.fillStyle = C.accent;
  ctx.font = 'bold 16px monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('SHARE', W / 2, py + 28);

  // Close button (X) top-right
  const closeX = px + panelW - 32, closeY = py + 8, closeS = 24;
  ctx.fillStyle = hov === 'close' ? 'rgba(200,60,50,0.3)' : 'transparent';
  ctx.beginPath();
  ctx.roundRect(closeX, closeY, closeS, closeS, 4);
  ctx.fill();
  ctx.strokeStyle = hov === 'close' ? '#cc4433' : C.hudText;
  ctx.lineWidth = 2;
  const cx = closeX + closeS / 2, cy = closeY + closeS / 2;
  ctx.beginPath();
  ctx.moveTo(cx - 5, cy - 5); ctx.lineTo(cx + 5, cy + 5);
  ctx.moveTo(cx + 5, cy - 5); ctx.lineTo(cx - 5, cy + 5);
  ctx.stroke();

  // Button layout
  const btnW = panelW - 40, btnH = 34, btnX = px + 20;
  const startY = py + 50;
  const gap = 10;

  // Divider label - ROOM CODE
  ctx.fillStyle = C.hudText;
  ctx.font = '9px monospace';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText('ROOM CODE', btnX, startY - 6);

  // Copy Room Code button
  const copyLabel = sp.copiedRoomCode ? 'COPIED!' : 'COPY ROOM CODE';
  const copyColor = sp.copiedRoomCode ? C.cleared : C.hudBright;
  drawSharePanelBtn(ctx, btnX, startY, btnW, btnH, copyLabel, copyColor, hov === 'copy_code');

  // Divider label - GIF EXPORT
  const gifSectionY = startY + btnH + gap + 20;
  ctx.fillStyle = C.hudText;
  ctx.font = '9px monospace';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText('GIF EXPORT', btnX, gifSectionY - 6);

  if (sp.exporting) {
    // Progress bar during export
    const barX = btnX, barY = gifSectionY, barW = btnW, barH = btnH;
    ctx.beginPath();
    ctx.roundRect(barX, barY, barW, barH, 5);
    ctx.fillStyle = 'rgba(18,30,48,0.85)';
    ctx.fill();
    ctx.strokeStyle = C.hudBorder;
    ctx.lineWidth = 1;
    ctx.stroke();

    // Progress fill
    const progress = sp.exportProgress;
    const fillW = Math.max(0, (barW - 4) * progress);
    if (fillW > 0) {
      ctx.beginPath();
      ctx.roundRect(barX + 2, barY + 2, fillW, barH - 4, 3);
      ctx.fillStyle = 'rgba(85,170,102,0.6)';
      ctx.fill();
    }

    // Progress text
    ctx.fillStyle = C.hudBright;
    ctx.font = 'bold 11px monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(`EXPORTING... ${Math.round(progress * 100)}%`, barX + barW / 2, barY + barH / 2);
    ctx.textBaseline = 'alphabetic';
  } else if (sp.gifBlob) {
    // Download GIF button (gif ready)
    drawSharePanelBtn(ctx, btnX, gifSectionY, btnW, btnH, 'DOWNLOAD GIF', C.cleared, hov === 'download_gif');

    // File size info
    const sizeMB = (sp.gifBlob.size / (1024 * 1024)).toFixed(1);
    ctx.fillStyle = C.hudText;
    ctx.font = '9px monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(`${sizeMB} MB`, btnX + btnW / 2, gifSectionY + btnH + 12);
    ctx.textBaseline = 'alphabetic';
  } else {
    // Export GIF button (not yet exported)
    drawSharePanelBtn(ctx, btnX, gifSectionY, btnW, btnH, 'EXPORT GIF', C.hudBright, hov === 'export_gif');

    // Subtitle
    ctx.fillStyle = C.hudText;
    ctx.font = '9px monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('Records simulation as animated GIF', btnX + btnW / 2, gifSectionY + btnH + 12);
    ctx.textBaseline = 'alphabetic';
  }

  // Bottom hint
  ctx.fillStyle = C.hudText;
  ctx.font = '9px monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('Click outside to close', W / 2, py + panelH - 16);
  ctx.textBaseline = 'alphabetic';
}
