import type { GameState, Operator, Room, WallSegment, ThreatMarker, NodePopup, Camera, HudBtn, SharePanelBtn, SpeedSliderState, RadialMenu, RadialMenuItem } from '../types';
import { WALL_W, OP_R, THREAT_R, GRID, DOOR_W, C, NODE_R, DEPLOY_PANEL_H, DEPLOY_OP_SPACING } from '../types';
import { getWallsForCollision } from '../room/room';
import { computeOperatorFOV } from '../operator/visibility';
import type { Vec2 } from '../math/vec2';
import type { Wall } from '../math/intersection';

let roomClearedAnimT = 0;

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
  const cam = state.camera;
  const exporting = state.exportingGif;

  // During GIF export: no selection (prevents grey-out), no planning overlays
  const sid = exporting ? null : state.selectedOpId;

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

  // Grid (skip during export for cleaner look)
  if (!exporting) {
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
  }

  // FOV cones (clipped to floor area so they don't bleed into the void)
  const isExecMode = state.mode === 'executing' || state.mode === 'paused';
  if (fl.length > 0) {
    ctx.save();
    ctx.beginPath();
    for (const cell of fl) {
      ctx.rect(cell.x, cell.y, GRID, GRID);
    }
    ctx.clip();
    for (const op of state.operators) {
      if (!op.deployed) continue;
      const grey = sid !== null && op.id !== sid;
      drawFOV(ctx, op, walls, grey, isExecMode);
    }
    ctx.restore();
  }

  // Threats
  for (const t of state.room.threats) drawThreat(ctx, t);

  // Walls
  for (const w of state.room.walls) drawWall(ctx, w);

  // Paths, waypoints, pie targets — skip entirely during GIF export (planning artifacts)
  if (!exporting) {
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
  }

  // Operators (deployed ones + the one currently being dragged from deploy panel)
  const deployingOpId = exporting ? -1 : (state.interaction.type === 'deploying_op' ? state.interaction.opId : -1);
  const isExec = state.mode === 'executing' || state.mode === 'paused';
  for (const op of state.operators) {
    if (!op.deployed && op.id !== deployingOpId) continue;
    const grey = sid !== null && op.id !== sid;
    const isDragging = op.id === deployingOpId;
    drawOp(ctx, op, op.id === sid || isDragging, grey, isDragging, isExec);
  }

  // Selection glow ring (world-space) — only in planning, never during export
  if (sid !== null && state.mode === 'planning') {
    const selOp = state.operators.find(o => o.id === sid && o.deployed);
    if (selOp) drawSelectionGlow(ctx, selOp);
  }

  // Radial menu (world-space) — only in planning, never during export
  if (state.radialMenu && state.mode === 'planning') {
    drawRadialMenu(ctx, state.radialMenu, state);
  }

  // ---- Restore from camera transform (back to screen space) ----
  ctx.restore();

  if (state.exportingGif) {
    // GIF export mode: only draw a prominent watermark logo, no HUD/popups/overlays
    drawExportWatermark(ctx, W, H);

    // Room cleared overlay (simpler for GIF)
    if (state.roomCleared) {
      ctx.fillStyle = 'rgba(0,0,0,0.25)'; ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = C.cleared; ctx.font = 'bold 22px monospace'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText('ROOM CLEARED', W / 2, H / 2); ctx.textBaseline = 'alphabetic';
    }
    return;
  }

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

  // Room cleared overlay (screen space) - with smooth animation
  if (state.roomCleared) {
    // Track animation progress
    if (!roomClearedAnimT) roomClearedAnimT = performance.now();
    const elapsed = (performance.now() - roomClearedAnimT) / 1000;
    const fadeIn = Math.min(1, elapsed / 0.4); // 0.4s fade
    const scaleT = Math.min(1, elapsed / 0.35);
    const eased = 1 - Math.pow(1 - scaleT, 3); // ease-out cubic
    const bannerScale = 0.85 + 0.15 * eased;

    ctx.save();
    ctx.globalAlpha = fadeIn * 0.3;
    ctx.fillStyle = 'rgba(0,0,0,1)'; ctx.fillRect(0, 0, W, H);
    ctx.globalAlpha = fadeIn;
    
    ctx.translate(W / 2, H / 2);
    ctx.scale(bannerScale, bannerScale);
    ctx.translate(-W / 2, -H / 2);

    ctx.fillStyle = 'rgba(10,30,20,0.9)';
    const bx = W / 2 - 130, by = H / 2 - 30;
    // Rounded rectangle for banner
    ctx.beginPath();
    ctx.roundRect(bx, by, 260, 60, 8);
    ctx.fill();
    ctx.strokeStyle = C.cleared; ctx.lineWidth = 2;
    ctx.stroke();
    // Subtle glow
    ctx.shadowColor = C.cleared;
    ctx.shadowBlur = 20;
    ctx.fillStyle = C.cleared; ctx.font = 'bold 22px monospace'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('ROOM CLEARED', W / 2, H / 2);
    ctx.shadowBlur = 0;
    ctx.textBaseline = 'alphabetic';
    ctx.restore();
  } else {
    roomClearedAnimT = 0;
  }

  // Share panel overlay
  if (state.sharePanel.open) {
    drawSharePanel(ctx, state, W, H);
  }
}

function drawExportWatermark(ctx: CanvasRenderingContext2D, W: number, H: number) {
  ctx.save();
  ctx.globalAlpha = 0.55;
  // "Flow" - big italic serif
  ctx.font = 'italic 700 42px Georgia, "Times New Roman", serif';
  ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = '#f2ecda';
  ctx.fillText('Flow', 14, 44);
  const flowW = ctx.measureText('Flow').width;
  // "Kickers" - smaller uppercase monospace with letter-spacing
  ctx.font = 'bold 15px monospace';
  ctx.fillStyle = '#b0a88e';
  const kickers = 'KICKERS';
  let kx = 14 + flowW + 8;
  const ky = 44;
  for (const ch of kickers) {
    ctx.fillText(ch, kx, ky);
    kx += ctx.measureText(ch).width + 4;
  }
  ctx.globalAlpha = 1;
  ctx.restore();
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
  const { a, b } = w;
  if (w.doors.length === 0) {
    // Solid wall
    ctx.lineCap = 'round';
    ctx.strokeStyle = C.wallEdge; ctx.lineWidth = WALL_W + 2;
    ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
    ctx.strokeStyle = C.wall; ctx.lineWidth = WALL_W;
    ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
  } else {
    const dx = b.x - a.x, dy = b.y - a.y, len = Math.sqrt(dx * dx + dy * dy);
    if (len < 1) return;
    // Collect door gaps sorted by position
    const sorted = [...w.doors].sort((a2, b2) => a2.pos - b2.pos);
    const gaps: { gs: number; ge: number; open: boolean }[] = sorted.map(d => {
      const f = Math.min(DOOR_W / len, 0.9);
      return { gs: d.pos - f / 2, ge: d.pos + f / 2, open: d.open };
    });
    // Draw solid wall segments between gaps
    ctx.lineCap = 'round'; ctx.strokeStyle = C.wall; ctx.lineWidth = WALL_W;
    let cursor = 0;
    for (const g of gaps) {
      if (g.gs > cursor + 0.02) {
        ctx.beginPath();
        ctx.moveTo(a.x + dx * cursor, a.y + dy * cursor);
        ctx.lineTo(a.x + dx * g.gs, a.y + dy * g.gs);
        ctx.stroke();
      }
      cursor = g.ge;
    }
    if (cursor < 0.98) {
      ctx.beginPath();
      ctx.moveTo(a.x + dx * cursor, a.y + dy * cursor);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    }
    // Draw door frames
    const px = -dy / len * 5, py = dx / len * 5;
    for (const g of gaps) {
      ctx.strokeStyle = g.open ? C.doorOpen : C.doorClosed; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(a.x + dx * g.gs + px, a.y + dy * g.gs + py); ctx.lineTo(a.x + dx * g.gs - px, a.y + dy * g.gs - py); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(a.x + dx * g.ge + px, a.y + dy * g.ge + py); ctx.lineTo(a.x + dx * g.ge - px, a.y + dy * g.ge - py); ctx.stroke();
    }
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
  for (let i = 1; i < wps.length; i++) { // start at 1: node 0 IS the operator
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

  // Pizza SLICE icon at target position
  const r = 10;
  const sliceAngle = Math.PI * 0.45; // width of the slice wedge
  const sliceDir = -Math.PI / 2; // point upward

  // Crust arc (outer edge)
  ctx.fillStyle = '#d4a24a';
  ctx.beginPath();
  ctx.moveTo(pie.x, pie.y);
  ctx.arc(pie.x, pie.y, r, sliceDir - sliceAngle / 2, sliceDir + sliceAngle / 2);
  ctx.closePath();
  ctx.fill();

  // Cheese fill (inner wedge, slightly smaller)
  ctx.fillStyle = '#e8c84a';
  ctx.beginPath();
  ctx.moveTo(pie.x, pie.y);
  ctx.arc(pie.x, pie.y, r * 0.82, sliceDir - sliceAngle / 2 + 0.08, sliceDir + sliceAngle / 2 - 0.08);
  ctx.closePath();
  ctx.fill();

  // Crust outline
  ctx.strokeStyle = '#b8842a';
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.moveTo(pie.x, pie.y);
  ctx.arc(pie.x, pie.y, r, sliceDir - sliceAngle / 2, sliceDir + sliceAngle / 2);
  ctx.closePath();
  ctx.stroke();

  // Pepperoni dots
  ctx.fillStyle = '#cc4433';
  const pd = r * 0.5;
  const pepX = pie.x + Math.cos(sliceDir) * pd;
  const pepY = pie.y + Math.sin(sliceDir) * pd;
  ctx.beginPath(); ctx.arc(pepX - 1.5, pepY + 1, 1.5, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.arc(pepX + 2, pepY - 0.5, 1.2, 0, Math.PI * 2); ctx.fill();

  // Colored border ring for visibility
  ctx.strokeStyle = grey ? '#555' : op.color;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.arc(pie.x, pie.y, r + 2, 0, Math.PI * 2);
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

// ---- Radial Menu Constants (must match main.ts) ----
const RADIAL_R = 28;
const RADIAL_ICON_R = 10;

const OP_RADIAL_ITEMS: RadialMenuItem[] = [
  { id: 'direction', icon: 'direction', label: 'Direction' },
  { id: 'pie',       icon: 'pie',       label: 'Pie' },
  { id: 'route',     icon: 'route',     label: 'Route' },
  { id: 'speed',     icon: 'speed',     label: 'Speed' },
];
const NODE_RADIAL_ITEMS: RadialMenuItem[] = [
  { id: 'direction', icon: 'direction', label: 'Direction' },
  { id: 'route',     icon: 'route',     label: 'Add Route' },
  { id: 'delete',    icon: 'delete',    label: 'Delete' },
  { id: 'speed',     icon: 'speed',     label: 'Speed' },
  { id: 'hold',      icon: 'hold',      label: 'Hold' },
];

function getRadialItems(wpIdx: number): RadialMenuItem[] {
  return wpIdx < 0 ? OP_RADIAL_ITEMS : NODE_RADIAL_ITEMS;
}

function getRadialIconPos(center: Vec2, idx: number, total: number): Vec2 {
  const a = -Math.PI / 2 + (idx / total) * Math.PI * 2;
  return { x: center.x + Math.cos(a) * RADIAL_R, y: center.y + Math.sin(a) * RADIAL_R };
}

function drawSelectionGlow(ctx: CanvasRenderingContext2D, op: Operator) {
  const p = op.position;
  const r = OP_R + 8;
  ctx.save();
  // Animated pulsing glow
  const t = performance.now() / 1000;
  const pulse = 0.6 + 0.4 * Math.sin(t * 3);

  // Outer glow
  ctx.strokeStyle = op.color;
  ctx.lineWidth = 2;
  ctx.globalAlpha = 0.25 * pulse;
  ctx.beginPath();
  ctx.arc(p.x, p.y, r + 4, 0, Math.PI * 2);
  ctx.stroke();

  // Main ring
  ctx.globalAlpha = 0.5 + 0.2 * pulse;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
  ctx.stroke();

  ctx.globalAlpha = 1;
  ctx.restore();
}

function drawRadialIcon(ctx: CanvasRenderingContext2D, cx: number, cy: number, icon: string, hovered: boolean, color: string) {
  const r = RADIAL_ICON_R;

  // Background circle
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fillStyle = hovered ? 'rgba(40,65,90,0.95)' : 'rgba(17,29,51,0.92)';
  ctx.fill();
  ctx.strokeStyle = hovered ? color : C.popupBorder;
  ctx.lineWidth = hovered ? 1.5 : 1;
  ctx.stroke();

  // Icon drawing
  ctx.save();
  ctx.translate(cx, cy);
  ctx.strokeStyle = hovered ? '#fff' : C.hudBright;
  ctx.fillStyle = hovered ? '#fff' : C.hudBright;
  ctx.lineWidth = 1.5;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  if (icon === 'direction') {
    // Arrow pointing right
    ctx.beginPath();
    ctx.moveTo(-4, 0); ctx.lineTo(4, 0);
    ctx.moveTo(1, -3); ctx.lineTo(4, 0); ctx.lineTo(1, 3);
    ctx.stroke();
  } else if (icon === 'pie') {
    // Pizza slice wedge (proper slice shape)
    const sr = 6;
    const sa = Math.PI * 0.45;
    const sd = -Math.PI / 2; // point up
    // Crust
    ctx.fillStyle = hovered ? '#d4a24a' : '#b8923a';
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.arc(0, 0, sr, sd - sa / 2, sd + sa / 2);
    ctx.closePath();
    ctx.fill();
    // Cheese
    ctx.fillStyle = hovered ? '#e8c84a' : '#c8a83a';
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.arc(0, 0, sr * 0.8, sd - sa / 2 + 0.1, sd + sa / 2 - 0.1);
    ctx.closePath();
    ctx.fill();
    // Outline
    ctx.strokeStyle = hovered ? '#d4a24a' : '#a0822a';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.arc(0, 0, sr, sd - sa / 2, sd + sa / 2);
    ctx.closePath();
    ctx.stroke();
    // Pepperoni dot
    ctx.fillStyle = '#cc4433';
    ctx.beginPath(); ctx.arc(Math.cos(sd) * sr * 0.45, Math.sin(sd) * sr * 0.45, 1.3, 0, Math.PI * 2); ctx.fill();
  } else if (icon === 'route') {
    // Plus sign
    ctx.beginPath();
    ctx.moveTo(0, -4); ctx.lineTo(0, 4);
    ctx.moveTo(-4, 0); ctx.lineTo(4, 0);
    ctx.stroke();
  } else if (icon === 'speed') {
    // Hourglass icon
    ctx.beginPath();
    // Top triangle
    ctx.moveTo(-3, -5); ctx.lineTo(3, -5); ctx.lineTo(0, -1);
    ctx.closePath();
    ctx.stroke();
    // Bottom triangle
    ctx.beginPath();
    ctx.moveTo(-3, 5); ctx.lineTo(3, 5); ctx.lineTo(0, 1);
    ctx.closePath();
    ctx.stroke();
    // Top and bottom bars
    ctx.beginPath();
    ctx.moveTo(-4, -5); ctx.lineTo(4, -5);
    ctx.moveTo(-4, 5); ctx.lineTo(4, 5);
    ctx.stroke();
  } else if (icon === 'delete') {
    // X mark
    ctx.beginPath();
    ctx.moveTo(-3, -3); ctx.lineTo(3, 3);
    ctx.moveTo(3, -3); ctx.lineTo(-3, 3);
    ctx.stroke();
  } else if (icon === 'hold') {
    // Pause bars
    ctx.fillRect(-3, -3, 2, 6);
    ctx.fillRect(1, -3, 2, 6);
  }

  ctx.restore();
}

function drawRadialMenu(ctx: CanvasRenderingContext2D, menu: RadialMenu, state: GameState) {
  const items = getRadialItems(menu.wpIdx);
  const t = Math.min(1, menu.animT);
  const eased = 1 - Math.pow(1 - t, 3); // ease-out cubic

  const op = state.operators.find(o => o.id === menu.opId);
  const color = op ? op.color : C.accent;

  // Connecting ring (faint)
  ctx.save();
  ctx.globalAlpha = 0.2 * eased;
  ctx.strokeStyle = color;
  ctx.lineWidth = 1;
  ctx.setLineDash([4, 3]);
  ctx.beginPath();
  ctx.arc(menu.center.x, menu.center.y, RADIAL_R, 0, Math.PI * 2);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.globalAlpha = 1;

  // Draw each icon
  for (let i = 0; i < items.length; i++) {
    const pos = getRadialIconPos(menu.center, i, items.length);
    // Animate: icons slide out from center
    const ix = menu.center.x + (pos.x - menu.center.x) * eased;
    const iy = menu.center.y + (pos.y - menu.center.y) * eased;
    const hovered = i === menu.hoveredIdx;

    ctx.globalAlpha = eased;
    drawRadialIcon(ctx, ix, iy, items[i].icon, hovered, color);

    // Hover tooltip label
    if (hovered && eased > 0.5) {
      ctx.globalAlpha = 1;
      ctx.fillStyle = C.popupBg;
      ctx.font = 'bold 8px monospace';
      const label = items[i].label;
      const tw = ctx.measureText(label).width;
      const lx = ix - tw / 2 - 4, ly = iy - RADIAL_ICON_R - 14;
      ctx.beginPath();
      ctx.roundRect(lx, ly, tw + 8, 13, 3);
      ctx.fill();
      ctx.strokeStyle = C.popupBorder; ctx.lineWidth = 0.5;
      ctx.stroke();
      ctx.fillStyle = C.hudBright;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(label, ix, ly + 6.5);
    }
  }

  ctx.globalAlpha = 1;
  ctx.restore();
}

let deployPanelAnimT = 0;

function drawDeployPanel(ctx: CanvasRenderingContext2D, state: GameState, H: number) {
  if (state.mode !== 'planning') { deployPanelAnimT = 0; return; }
  const undeployed = state.operators.filter(o => !o.deployed);
  if (undeployed.length === 0) { deployPanelAnimT = 0; return; }

  // Smooth entrance
  deployPanelAnimT = Math.min(1, deployPanelAnimT + 0.06);
  const eased = 1 - Math.pow(1 - deployPanelAnimT, 3);

  const hudBarY = H - 36;
  const barY = hudBarY - DEPLOY_PANEL_H - 4;
  const barW = 20 + undeployed.length * DEPLOY_OP_SPACING;
  const barH = DEPLOY_PANEL_H;
  const deployY = barY + barH / 2;

  // Slide up from below
  const slideOffset = (1 - eased) * 30;

  ctx.save();
  ctx.globalAlpha = eased;
  ctx.translate(0, slideOffset);

  // Background with rounded corners
  ctx.beginPath();
  ctx.roundRect(8, barY, barW, barH, 6);
  ctx.fillStyle = C.panelBg;
  ctx.fill();

  // Dotted border
  ctx.strokeStyle = C.accent; ctx.lineWidth = 1.5;
  ctx.setLineDash([5, 4]);
  ctx.stroke();
  ctx.setLineDash([]);

  // Label above
  ctx.fillStyle = C.hudText; ctx.font = '9px monospace'; ctx.textAlign = 'left'; ctx.textBaseline = 'bottom';
  ctx.fillText('DRAG OPERATORS INTO PLACE', 12, barY - 4);

  // Operators in a horizontal row facing right - with subtle idle bob
  const t = performance.now() / 1000;
  for (let i = 0; i < undeployed.length; i++) {
    const op = undeployed[i];
    const ox = 30 + i * DEPLOY_OP_SPACING;
    const bob = Math.sin(t * 2 + i * 0.8) * 1.5; // subtle floating effect

    ctx.save();
    ctx.translate(ox, deployY + bob);
    ctx.rotate(0); // facing right

    // Draw chevron shape
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
  ctx.restore();
}

function drawHUD(ctx: CanvasRenderingContext2D, state: GameState, W: number, H: number) {
  const barH = 36, barY = H - barH;
  const hov = state.hoveredHudBtn;

  // Bar background with subtle gradient feel
  ctx.fillStyle = C.hud;
  ctx.fillRect(0, barY, W, barH);
  // Top border with glow
  const hudGrad = ctx.createLinearGradient(0, barY, 0, barY + 2);
  hudGrad.addColorStop(0, 'rgba(30,51,82,0.6)');
  hudGrad.addColorStop(1, 'rgba(30,51,82,0)');
  ctx.fillStyle = hudGrad;
  ctx.fillRect(0, barY, W, 2);
  ctx.strokeStyle = C.hudBorder; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(0, barY); ctx.lineTo(W, barY); ctx.stroke();

  ctx.font = 'bold 11px monospace'; ctx.textBaseline = 'middle';
  const cy = barY + barH / 2;
  const by = barY + 5;
  const mode = state.mode;
  const rightBlockX = W / 2 + 20;
  const totalStages = state.stages.length;

  // ---- Left: CLEAR + MENU + SAVE ----
  drawHudBtn(ctx, 8, by, 56, 26, 'CLEAR', '#cc5544', hov === 'clear_level');
  drawHudBtn(ctx, 72, by, 50, 26, 'MENU', C.hudText, hov === 'menu');
  if (mode === 'planning') {
    drawHudBtn(ctx, 130, by, 50, 26, 'SAVE', '#55aa66', hov === 'save_progress');
  }

  // ---- Center: Stage indicators (clickable pill buttons) ----
  if (totalStages > 0) {
    const pillW = 26, pillH = 20, pillGap = 4;
    const editBtnW = 46;
    const viewIdx = state.viewingStageIndex;
    const hasSelection = viewIdx >= 0 && viewIdx < totalStages && mode === 'planning';
    const totalPills = totalStages + (mode === 'planning' ? 1 : 0);
    const totalW = totalPills * (pillW + pillGap) - pillGap + (hasSelection ? editBtnW + pillGap + 4 : 0);
    const startX = W / 2 - totalW / 2;
    const pillY = by + (26 - pillH) / 2;

    for (let i = 0; i < totalStages; i++) {
      const px = startX + i * (pillW + pillGap);
      const executing = state.executingStageIndex === i;
      const selected = viewIdx === i && mode === 'planning';
      const isHov = hov === `stage_${i}`;

      // Pill background
      ctx.beginPath();
      ctx.roundRect(px, pillY, pillW, pillH, 4);
      if (selected) {
        ctx.fillStyle = 'rgba(85,170,102,0.25)';
      } else if (executing) {
        ctx.fillStyle = 'rgba(30,60,90,0.95)';
      } else if (isHov) {
        ctx.fillStyle = 'rgba(40,60,80,0.9)';
      } else {
        ctx.fillStyle = 'rgba(18,30,48,0.85)';
      }
      ctx.fill();

      // Border
      ctx.strokeStyle = selected ? '#55aa66' : executing ? C.accent : isHov ? C.hudText : C.hudBorder;
      ctx.lineWidth = selected ? 1.5 : 1;
      ctx.stroke();

      // Number
      ctx.fillStyle = selected ? '#55aa66' : executing ? C.accent : isHov ? C.hudBright : C.hudText;
      ctx.font = (executing || selected) ? 'bold 10px monospace' : '10px monospace';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(String(i + 1), px + pillW / 2, pillY + pillH / 2);

      // Active underline for executing stage
      if (executing) {
        ctx.fillStyle = C.accent;
        ctx.fillRect(px + 4, pillY + pillH - 2, pillW - 8, 2);
      }
    }

    // Current planning stage (dotted outline)
    if (mode === 'planning') {
      const px = startX + totalStages * (pillW + pillGap);
      ctx.beginPath();
      ctx.roundRect(px, pillY, pillW, pillH, 4);
      ctx.fillStyle = 'rgba(18,30,48,0.6)';
      ctx.fill();
      ctx.strokeStyle = C.accent; ctx.lineWidth = 1;
      ctx.setLineDash([3, 3]);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = C.accent;
      ctx.font = '10px monospace'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(String(totalStages + 1), px + pillW / 2, pillY + pillH / 2);
    }

    // EDIT button (appears when a stage is selected in planning mode)
    if (hasSelection) {
      const editX = startX + totalPills * (pillW + pillGap) + 4;
      const isEditHov = hov === 'edit_stage';
      ctx.beginPath();
      ctx.roundRect(editX, pillY, editBtnW, pillH, 4);
      ctx.fillStyle = isEditHov ? 'rgba(85,170,102,0.3)' : 'rgba(18,30,48,0.85)';
      ctx.fill();
      ctx.strokeStyle = isEditHov ? '#55aa66' : C.hudBorder;
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.fillStyle = isEditHov ? '#55aa66' : C.hudText;
      ctx.font = 'bold 9px monospace'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText('EDIT', editX + editBtnW / 2, pillY + pillH / 2);
    }
  }

  // ---- Right block: SAVE STAGE + GO + RESET + REPLAY + SHARE ----
  // SAVE STAGE (glows when stage just completed as a prompt)
  const saveLabel = totalStages === 0 ? 'SAVE STAGE' : `SAVE ${totalStages + 1}`;
  const saveGlow = state.stageJustCompleted;
  if (mode === 'planning' || saveGlow) {
    if (saveGlow) {
      const pulse = 0.5 + 0.5 * Math.sin(Date.now() * 0.005);
      ctx.shadowColor = '#f2ecda';
      ctx.shadowBlur = 14 * pulse;
    }
    drawHudBtn(ctx, rightBlockX, by, 100, 26, saveLabel, saveGlow ? '#f2ecda' : C.accent, hov === 'save_stage');
    ctx.shadowBlur = 0; ctx.shadowColor = 'transparent';
  }

  // GO / PAUSE / RESUME
  if (mode === 'planning') {
    drawHudBtn(ctx, rightBlockX + 108, by, 70, 26, 'GO!', C.accent, hov === 'go');
  } else if (mode === 'executing') {
    drawHudBtn(ctx, rightBlockX + 108, by, 70, 26, 'PAUSE', C.hudText, hov === 'go');
  } else {
    drawHudBtn(ctx, rightBlockX + 108, by, 70, 26, 'RESUME', C.accent, hov === 'go');
  }

  drawHudBtn(ctx, rightBlockX + 186, by, 56, 26, 'RESET', C.hudText, hov === 'reset');

  if (totalStages > 0) {
    drawHudBtn(ctx, rightBlockX + 250, by, 60, 26, 'REPLAY', C.accent, hov === 'replay');
  }

  // ---- Top-right: SHARE button (prominent, always visible) ----
  drawShareButton(ctx, W, hov === 'share');

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

// Track hover animation per button for smooth transitions
const hudBtnHoverT: Record<string, number> = {};

function drawHudBtn(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, label: string, color: string, hovered: boolean = false, btnKey: string = label) {
  const r = 5; // border radius
  
  // Smooth hover interpolation
  if (!hudBtnHoverT[btnKey]) hudBtnHoverT[btnKey] = 0;
  const target = hovered ? 1 : 0;
  hudBtnHoverT[btnKey] += (target - hudBtnHoverT[btnKey]) * 0.2;
  const t = hudBtnHoverT[btnKey];

  // Hover lift effect
  const lift = t * 1.5;
  const drawY = y - lift;

  // Background
  ctx.beginPath();
  ctx.roundRect(x, drawY, w, h, r);
  
  // Interpolated background
  const bgR = 18 + 22 * t, bgG = 30 + 25 * t, bgB = 48 + 27 * t;
  ctx.fillStyle = `rgba(${bgR},${bgG},${bgB},${0.85 + 0.1 * t})`;
  ctx.fill();

  // Border with glow on hover
  if (t > 0.05) {
    ctx.shadowColor = color;
    ctx.shadowBlur = 6 * t;
  }
  const borderR = 30 + 202 * t, borderG = 51 + 172 * t, borderB = 82 + 116 * t;
  ctx.strokeStyle = `rgba(${borderR},${borderG},${borderB},${0.5 + 0.5 * t})`;
  ctx.lineWidth = 1 + 0.5 * t;
  ctx.stroke();
  ctx.shadowBlur = 0; ctx.shadowColor = 'transparent';

  // Label
  const textAlpha = 0.7 + 0.3 * t;
  ctx.fillStyle = t > 0.5 ? C.hudBright : color;
  ctx.globalAlpha = textAlpha;
  ctx.font = 'bold 10px monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, x + w / 2, drawY + h / 2);
  ctx.textBaseline = 'alphabetic';
  ctx.globalAlpha = 1;
}

// Share button dimensions (used by renderer + input handler)
export const SHARE_BTN = { x: 0, y: 10, w: 90, h: 30, margin: 12 };
export function getShareBtnX(canvasW: number) { return canvasW - SHARE_BTN.w - SHARE_BTN.margin; }

function drawShareButton(ctx: CanvasRenderingContext2D, W: number, hovered: boolean) {
  const bx = getShareBtnX(W), by = SHARE_BTN.y, bw = SHARE_BTN.w, bh = SHARE_BTN.h;
  const r = 6;

  // Smooth hover
  if (!hudBtnHoverT['_share_top']) hudBtnHoverT['_share_top'] = 0;
  const target = hovered ? 1 : 0;
  hudBtnHoverT['_share_top'] += (target - hudBtnHoverT['_share_top']) * 0.18;
  const t = hudBtnHoverT['_share_top'];

  // Background
  ctx.beginPath();
  ctx.roundRect(bx, by, bw, bh, r);
  ctx.fillStyle = `rgba(${18 + 20 * t},${30 + 22 * t},${48 + 24 * t},${0.92 + 0.05 * t})`;
  ctx.fill();

  // Border glow
  if (t > 0.05) { ctx.shadowColor = C.accent; ctx.shadowBlur = 8 * t; }
  ctx.strokeStyle = `rgba(${80 + 152 * t},${75 + 148 * t},${60 + 138 * t},${0.5 + 0.5 * t})`;
  ctx.lineWidth = 1.2 + 0.4 * t;
  ctx.stroke();
  ctx.shadowBlur = 0; ctx.shadowColor = 'transparent';

  // Share icon (simple upload/share arrow) - left of text
  const iconX = bx + 18, iconY = by + bh / 2;
  ctx.strokeStyle = t > 0.5 ? C.hudBright : C.hudText;
  ctx.lineWidth = 1.8;
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  // Arrow pointing up
  ctx.beginPath();
  ctx.moveTo(iconX, iconY + 4);
  ctx.lineTo(iconX, iconY - 4);
  ctx.lineTo(iconX - 3.5, iconY - 0.5);
  ctx.moveTo(iconX, iconY - 4);
  ctx.lineTo(iconX + 3.5, iconY - 0.5);
  ctx.stroke();
  // Tray
  ctx.beginPath();
  ctx.moveTo(iconX - 5, iconY + 1);
  ctx.lineTo(iconX - 5, iconY + 5);
  ctx.lineTo(iconX + 5, iconY + 5);
  ctx.lineTo(iconX + 5, iconY + 1);
  ctx.stroke();

  // Label
  ctx.fillStyle = t > 0.5 ? C.hudBright : C.accent;
  ctx.globalAlpha = 0.75 + 0.25 * t;
  ctx.font = 'bold 11px monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('SHARE', bx + bw / 2 + 7, by + bh / 2);
  ctx.textBaseline = 'alphabetic';
  ctx.globalAlpha = 1;
}

function drawPopup(ctx: CanvasRenderingContext2D, popup: NodePopup, state: GameState) {
  const op = state.operators.find(o => o.id === popup.opId);
  if (!op) return;
  const isOp = popup.wpIdx < 0;
  const wp = isOp ? null : op.path.waypoints[popup.wpIdx];
  const p = popup.position;

  const items = isOp
    ? ['Draw Path', 'Direction', 'Pie', 'Speed', 'Clear Path']
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

let pendingNodeAnimT = 0;
let lastPendingNodeId = -1;

function drawPendingNodeButtons(ctx: CanvasRenderingContext2D, state: GameState) {
  if (!state.pendingNode) { pendingNodeAnimT = 0; lastPendingNodeId = -1; return; }
  const pn = state.pendingNode;
  const op = state.operators.find(o => o.id === pn.opId);
  if (!op || pn.wpIdx >= op.path.waypoints.length) return;
  
  // Reset animation when a new node is pending
  const nodeKey = pn.opId * 1000 + pn.wpIdx;
  if (nodeKey !== lastPendingNodeId) { pendingNodeAnimT = 0; lastPendingNodeId = nodeKey; }
  pendingNodeAnimT = Math.min(1, pendingNodeAnimT + 0.12);
  const eased = 1 - Math.pow(1 - pendingNodeAnimT, 3);

  const wp = op.path.waypoints[pn.wpIdx];
  const cam = state.camera;
  const W = ctx.canvas.width, H = ctx.canvas.height;
  const sp = {
    x: (wp.position.x - cam.x) * cam.zoom + W / 2,
    y: (wp.position.y - cam.y) * cam.zoom + H / 2,
  };

  const btnSize = 18;
  const offset = 16;

  ctx.save();
  ctx.globalAlpha = eased;

  // Checkmark button (right side) - slides in from center
  const checkXTarget = sp.x + offset;
  const checkX = sp.x + offset * eased;
  const checkY = sp.y - btnSize / 2;
  ctx.beginPath();
  ctx.roundRect(checkX, checkY, btnSize, btnSize, 5);
  ctx.fillStyle = 'rgba(85,170,102,0.9)';
  ctx.fill();
  ctx.strokeStyle = 'rgba(120,200,140,0.8)'; ctx.lineWidth = 1;
  ctx.stroke();
  ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(checkX + 4, checkY + btnSize / 2);
  ctx.lineTo(checkX + btnSize / 2 - 1, checkY + btnSize - 5);
  ctx.lineTo(checkX + btnSize - 4, checkY + 5);
  ctx.stroke();

  // X button (left side) - slides in from center
  const cancelX = sp.x - offset * eased - btnSize;
  const cancelY = sp.y - btnSize / 2;
  ctx.beginPath();
  ctx.roundRect(cancelX, cancelY, btnSize, btnSize, 5);
  ctx.fillStyle = 'rgba(204,68,51,0.9)';
  ctx.fill();
  ctx.strokeStyle = 'rgba(230,100,80,0.8)'; ctx.lineWidth = 1;
  ctx.stroke();
  ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.lineCap = 'round';
  const xPad = 5;
  ctx.beginPath();
  ctx.moveTo(cancelX + xPad, cancelY + xPad);
  ctx.lineTo(cancelX + btnSize - xPad, cancelY + btnSize - xPad);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(cancelX + btnSize - xPad, cancelY + xPad);
  ctx.lineTo(cancelX + xPad, cancelY + btnSize - xPad);
  ctx.stroke();

  ctx.restore();
}

// ---- Share Panel ----

const shareBtnHoverT: Record<string, number> = {};

function drawSharePanelBtn(
  ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number,
  label: string, color: string, hovered: boolean, disabled: boolean = false,
) {
  const r = 6;
  
  // Smooth hover interpolation
  const key = label;
  if (!shareBtnHoverT[key]) shareBtnHoverT[key] = 0;
  shareBtnHoverT[key] += ((hovered ? 1 : 0) - shareBtnHoverT[key]) * 0.2;
  const t = shareBtnHoverT[key];

  const lift = disabled ? 0 : t * 1;
  
  ctx.beginPath();
  ctx.roundRect(x, y - lift, w, h, r);
  if (disabled) {
    ctx.fillStyle = 'rgba(18,30,48,0.5)';
  } else {
    const bgR = 22 + 18 * t, bgG = 38 + 22 * t, bgB = 60 + 25 * t;
    ctx.fillStyle = `rgba(${bgR},${bgG},${bgB},${0.9 + 0.05 * t})`;
  }
  ctx.fill();
  
  if (!disabled && t > 0.05) {
    ctx.shadowColor = color;
    ctx.shadowBlur = 4 * t;
  }
  ctx.strokeStyle = hovered && !disabled ? C.accent : C.hudBorder;
  ctx.lineWidth = 1 + 0.5 * t;
  ctx.stroke();
  ctx.shadowBlur = 0; ctx.shadowColor = 'transparent';
  
  ctx.fillStyle = disabled ? 'rgba(138,131,110,0.4)' : (t > 0.5 ? C.hudBright : color);
  ctx.font = 'bold 11px monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, x + w / 2, y - lift + h / 2);
  ctx.textBaseline = 'alphabetic';
}

let sharePanelAnimT = 0;

export function resetSharePanelAnim() { sharePanelAnimT = 0; }

function drawSharePanel(ctx: CanvasRenderingContext2D, state: GameState, W: number, H: number) {
  const hov = state.hoveredShareBtn;
  const sp = state.sharePanel;

  // Animate open
  sharePanelAnimT = Math.min(1, sharePanelAnimT + 0.1);
  const eased = 1 - Math.pow(1 - sharePanelAnimT, 3);

  // Dimmed backdrop
  ctx.save();
  ctx.globalAlpha = eased * 0.55;
  ctx.fillStyle = 'rgba(0,0,0,1)';
  ctx.fillRect(0, 0, W, H);
  ctx.globalAlpha = eased;
  ctx.restore();

  // Panel dimensions - taller to fit re-export
  const panelW = 340, panelH = sp.gifBlob ? 330 : 300;
  const px = W / 2 - panelW / 2, py = H / 2 - panelH / 2;
  const r = 8;

  // Animate panel scale/position
  ctx.save();
  const panelScale = 0.92 + 0.08 * eased;
  ctx.translate(W / 2, H / 2);
  ctx.scale(panelScale, panelScale);
  ctx.globalAlpha = eased;
  ctx.translate(-W / 2, -H / 2);

  // Panel shadow
  ctx.shadowColor = 'rgba(0,0,0,0.4)';
  ctx.shadowBlur = 24;
  ctx.shadowOffsetY = 4;

  // Panel background
  ctx.beginPath();
  ctx.roundRect(px, py, panelW, panelH, r);
  ctx.fillStyle = C.panelBg;
  ctx.fill();

  ctx.shadowBlur = 0; ctx.shadowColor = 'transparent'; ctx.shadowOffsetY = 0;

  ctx.strokeStyle = C.popupBorder;
  ctx.lineWidth = 1.5;
  ctx.stroke();

  // Title bar with subtle line
  ctx.fillStyle = C.accent;
  ctx.font = 'bold 14px monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('SHARE', W / 2, py + 26);

  // Subtle separator under title
  ctx.strokeStyle = C.hudBorder; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(px + 16, py + 44); ctx.lineTo(px + panelW - 16, py + 44); ctx.stroke();

  // Close button (X) top-right
  const closeX = px + panelW - 32, closeY = py + 8, closeS = 24;
  ctx.fillStyle = hov === 'close' ? 'rgba(200,60,50,0.25)' : 'transparent';
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
  const btnW = panelW - 40, btnH = 36, btnX = px + 20;
  const startY = py + 58;
  const gap = 10;

  // ---- ROOM CODE SECTION ----
  ctx.fillStyle = C.hudText;
  ctx.font = 'bold 9px monospace';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText('ROOM CODE', btnX, startY - 8);

  const copyLabel = sp.copiedRoomCode ? 'COPIED TO CLIPBOARD' : 'COPY ROOM CODE';
  const copyColor = sp.copiedRoomCode ? C.cleared : C.hudBright;
  drawSharePanelBtn(ctx, btnX, startY, btnW, btnH, copyLabel, copyColor, hov === 'copy_code');

  // Small description under
  ctx.fillStyle = 'rgba(138,131,110,0.6)';
  ctx.font = '8px monospace';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText('Share with others to load this room layout', btnX + 2, startY + btnH + 10);

  // ---- GIF EXPORT SECTION ----
  const gifSectionY = startY + btnH + gap + 26;
  ctx.fillStyle = C.hudText;
  ctx.font = 'bold 9px monospace';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText('GIF EXPORT', btnX, gifSectionY - 8);

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
      ctx.fillStyle = 'rgba(85,170,102,0.5)';
      ctx.fill();
    }

    // Progress text
    ctx.fillStyle = C.hudBright;
    ctx.font = 'bold 11px monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(`EXPORTING... ${Math.round(progress * 100)}%`, barX + barW / 2, barY + barH / 2);
    ctx.textBaseline = 'alphabetic';

    // Hint below progress
    ctx.fillStyle = 'rgba(138,131,110,0.5)';
    ctx.font = '8px monospace';
    ctx.textAlign = 'center';
    ctx.fillText('Recording simulation frames', barX + barW / 2, barY + barH + 12);

  } else if (sp.gifBlob) {
    // Download GIF button (gif ready - prominent green styling)
    drawSharePanelBtn(ctx, btnX, gifSectionY, btnW, btnH, 'DOWNLOAD GIF', C.cleared, hov === 'download_gif');

    // File size to the right of the button
    const sizeMB = sp.gifBlob.size > 1024 * 1024
      ? `${(sp.gifBlob.size / (1024 * 1024)).toFixed(1)} MB`
      : `${Math.round(sp.gifBlob.size / 1024)} KB`;
    ctx.fillStyle = C.hudText;
    ctx.font = '9px monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(`Ready - ${sizeMB}`, btnX + btnW / 2, gifSectionY + btnH + 12);

    // Re-export button (smaller, below)
    const reExportY = gifSectionY + btnH + gap + 18;
    drawSharePanelBtn(ctx, btnX, reExportY, btnW, 30, 'RE-EXPORT GIF', C.hudText, hov === 'export_gif');

  } else {
    // Export GIF button (not yet exported)
    drawSharePanelBtn(ctx, btnX, gifSectionY, btnW, btnH, 'EXPORT GIF', C.hudBright, hov === 'export_gif');

    // Subtitle
    ctx.fillStyle = 'rgba(138,131,110,0.6)';
    ctx.font = '8px monospace';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText('Record and save your simulation as animated GIF', btnX + 2, gifSectionY + btnH + 10);
  }

  // Bottom hint (ESC or click outside)
  ctx.fillStyle = 'rgba(138,131,110,0.4)';
  ctx.font = '8px monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('Click outside or press ESC to close', W / 2, py + panelH - 14);
  ctx.textBaseline = 'alphabetic';

  ctx.restore(); // restore panel scale transform
}
