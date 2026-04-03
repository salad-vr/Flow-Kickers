import type { GameState, Operator, Room, WallSegment, ThreatMarker, Waypoint, RadialMenu } from '../types';
import { WALL_THICKNESS, OPERATOR_RADIUS, THREAT_RADIUS, GRID_SIZE, DOOR_WIDTH, COLORS,
  NODE_HIT_RADIUS, RADIAL_RADIUS, RADIAL_ITEM_RADIUS } from '../types';
import { getWallsForCollision } from '../room/room';
import { computeOperatorFOV } from '../operator/visibility';
import type { Vec2 } from '../math/vec2';
import type { Wall } from '../math/intersection';

export function renderGame(canvas: HTMLCanvasElement, state: GameState) {
  const ctx = canvas.getContext('2d')!;
  const w = canvas.width;
  const h = canvas.height;
  const walls = getWallsForCollision(state.room);
  const focusedOpId = state.selectedOperatorId; // non-null = focus mode

  ctx.fillStyle = COLORS.bgOuter;
  ctx.fillRect(0, 0, w, h);
  drawFloor(ctx, state.room);
  drawGrid(ctx, w, h);

  // FOV cones
  for (const op of state.operators) {
    const greyed = focusedOpId !== null && op.id !== focusedOpId;
    drawFOVCone(ctx, op, walls, greyed);
  }

  // Threats
  for (const t of state.room.threats) drawThreat(ctx, t);

  // Walls
  for (const wall of state.room.walls) drawWall(ctx, wall);

  // Paths (greyed-out for non-focused)
  for (const op of state.operators) {
    const greyed = focusedOpId !== null && op.id !== focusedOpId;
    drawPath(ctx, op, greyed, state);
  }

  // Path being drawn
  if (state.interaction.type === 'drawing_path' || state.interaction.type === 'redrawing_from_node') {
    const inter = state.interaction;
    const pts = inter.rawPoints;
    if (pts.length > 1) {
      const op = state.operators.find(o => o.id === inter.opId);
      ctx.strokeStyle = op ? op.color : '#fff';
      ctx.globalAlpha = 0.5;
      ctx.lineWidth = 2;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(pts[0].x, pts[0].y);
      for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.globalAlpha = 1;
    }
  }

  // Operators
  for (const op of state.operators) {
    const greyed = focusedOpId !== null && op.id !== focusedOpId;
    drawOperator(ctx, op, op.id === focusedOpId, greyed);
  }

  // Look target indicator (if setting)
  if (state.interaction.type === 'setting_look_target') {
    const inter = state.interaction;
    const op = state.operators.find(o => o.id === inter.opId);
    if (op) {
      const wp = op.path.waypoints[inter.waypointIndex];
      ctx.strokeStyle = COLORS.lookTargetLine;
      ctx.lineWidth = 1.5;
      ctx.setLineDash([6, 4]);
      ctx.globalAlpha = 0.6;
      ctx.beginPath();
      ctx.moveTo(wp.position.x, wp.position.y);
      // Draw to mouse cursor (use a crosshair marker)
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.globalAlpha = 1;
      // Crosshair at cursor position during setting
    }
  }

  // Tempo drag indicator
  if (state.interaction.type === 'tempo_drag') {
    const inter = state.interaction;
    const op = state.operators.find(o => o.id === inter.opId);
    if (op) {
      const tempo = inter.waypointIndex !== null ? op.path.waypoints[inter.waypointIndex].tempo : op.tempo;
      const pos = inter.waypointIndex !== null ? op.path.waypoints[inter.waypointIndex].position : op.position;
      drawTempoIndicator(ctx, pos, tempo);
    }
  }

  // Radial menu
  if (state.radialMenu) {
    drawRadialMenu(ctx, state.radialMenu);
  }

  // HUD
  drawCanvasHUD(ctx, state, w, h);
}

export function getCanvas(): HTMLCanvasElement {
  return document.getElementById('game-canvas') as HTMLCanvasElement;
}
export function getCtx(): CanvasRenderingContext2D {
  return getCanvas().getContext('2d')!;
}

function drawFloor(ctx: CanvasRenderingContext2D, room: Room) {
  if (room.floor.length < 3) return;
  ctx.beginPath();
  ctx.moveTo(room.floor[0].x, room.floor[0].y);
  for (let i = 1; i < room.floor.length; i++) ctx.lineTo(room.floor[i].x, room.floor[i].y);
  ctx.closePath();
  ctx.fillStyle = COLORS.bgFloor;
  ctx.fill();
}

function drawGrid(ctx: CanvasRenderingContext2D, w: number, h: number) {
  ctx.strokeStyle = COLORS.gridLine; ctx.lineWidth = 0.5;
  for (let x = 0; x < w; x += GRID_SIZE) { ctx.beginPath(); ctx.moveTo(x,0); ctx.lineTo(x,h); ctx.stroke(); }
  for (let y = 0; y < h; y += GRID_SIZE) { ctx.beginPath(); ctx.moveTo(0,y); ctx.lineTo(w,y); ctx.stroke(); }
}

function drawWall(ctx: CanvasRenderingContext2D, wall: WallSegment) {
  const { a, b, hasDoor, doorOpen } = wall;
  if (hasDoor) {
    const dx = b.x-a.x, dy = b.y-a.y;
    const len = Math.sqrt(dx*dx+dy*dy);
    if (len < 1) return;
    const doorFrac = Math.min(DOOR_WIDTH / len, 0.9);
    const gs = 0.5 - doorFrac/2, ge = 0.5 + doorFrac/2;
    ctx.lineCap = 'round'; ctx.strokeStyle = COLORS.wallFill; ctx.lineWidth = WALL_THICKNESS;
    if (gs > 0.02) { ctx.beginPath(); ctx.moveTo(a.x,a.y); ctx.lineTo(a.x+dx*gs,a.y+dy*gs); ctx.stroke(); }
    if (ge < 0.98) { ctx.beginPath(); ctx.moveTo(a.x+dx*ge,a.y+dy*ge); ctx.lineTo(b.x,b.y); ctx.stroke(); }
    const px=-dy/len*5, py=dx/len*5;
    const dsx=a.x+dx*gs, dsy=a.y+dy*gs, dex=a.x+dx*ge, dey=a.y+dy*ge;
    ctx.strokeStyle = doorOpen ? COLORS.doorOpen : COLORS.doorClosed; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(dsx+px,dsy+py); ctx.lineTo(dsx-px,dsy-py); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(dex+px,dey+py); ctx.lineTo(dex-px,dey-py); ctx.stroke();
    if (!doorOpen) { ctx.strokeStyle=COLORS.doorClosed; ctx.lineWidth=2; ctx.setLineDash([3,3]); ctx.beginPath(); ctx.moveTo(dsx,dsy); ctx.lineTo(dex,dey); ctx.stroke(); ctx.setLineDash([]); }
  } else {
    ctx.lineCap='round'; ctx.strokeStyle=COLORS.wallStroke; ctx.lineWidth=WALL_THICKNESS+2;
    ctx.beginPath(); ctx.moveTo(a.x,a.y); ctx.lineTo(b.x,b.y); ctx.stroke();
    ctx.strokeStyle=COLORS.wallFill; ctx.lineWidth=WALL_THICKNESS;
    ctx.beginPath(); ctx.moveTo(a.x,a.y); ctx.lineTo(b.x,b.y); ctx.stroke();
  }
}

function drawThreat(ctx: CanvasRenderingContext2D, t: ThreatMarker) {
  const p = t.position, r = THREAT_RADIUS, n = t.neutralized;
  ctx.fillStyle = n ? COLORS.threatNeutralizedGlow : COLORS.threatGlow;
  ctx.beginPath(); ctx.arc(p.x,p.y,r*2.5,0,Math.PI*2); ctx.fill();
  ctx.strokeStyle = n ? COLORS.threatNeutralized : COLORS.threatActive;
  ctx.lineWidth = n ? 2 : 3; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(p.x-r,p.y-r); ctx.lineTo(p.x+r,p.y+r); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(p.x+r,p.y-r); ctx.lineTo(p.x-r,p.y+r); ctx.stroke();
}

function drawFOVCone(ctx: CanvasRenderingContext2D, op: Operator, walls: Wall[], greyed: boolean) {
  if (greyed) { ctx.globalAlpha = 0.1; }
  const fovPoly = computeOperatorFOV(op, walls);
  if (fovPoly.length < 2) { ctx.globalAlpha = 1; return; }
  ctx.fillStyle = op.color + '18';
  ctx.beginPath(); ctx.moveTo(op.position.x,op.position.y);
  for (const p of fovPoly) ctx.lineTo(p.x,p.y);
  ctx.closePath(); ctx.fill();
  ctx.strokeStyle = op.color + '40'; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(op.position.x,op.position.y); ctx.lineTo(fovPoly[0].x,fovPoly[0].y); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(op.position.x,op.position.y); ctx.lineTo(fovPoly[fovPoly.length-1].x,fovPoly[fovPoly.length-1].y); ctx.stroke();
  ctx.globalAlpha = 1;
}

function drawPath(ctx: CanvasRenderingContext2D, op: Operator, greyed: boolean, state: GameState) {
  const wps = op.path.waypoints;
  if (wps.length < 2) return;
  const alpha = greyed ? COLORS.pathGreyAlpha : COLORS.pathAlpha;
  const lut = op.path.splineLUT;
  if (lut && lut.samples.length > 1) {
    ctx.strokeStyle = greyed ? '#555' : op.color;
    ctx.globalAlpha = alpha; ctx.lineWidth = 2; ctx.setLineDash([8,5]); ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(lut.samples[0].x,lut.samples[0].y);
    for (let i=1;i<lut.samples.length;i++) ctx.lineTo(lut.samples[i].x,lut.samples[i].y);
    ctx.stroke(); ctx.setLineDash([]); ctx.globalAlpha = 1;
  }
  if (greyed) return; // don't draw nodes for greyed ops

  // Waypoint nodes
  const isSelectedOp = state.selectedOperatorId === op.id;
  for (let i = 0; i < wps.length; i++) {
    const wp = wps[i];
    const isSelectedNode = isSelectedOp && state.selectedWaypointIndex === i;
    const r = isSelectedNode ? 6 : 4;

    ctx.fillStyle = wp.hold ? COLORS.holdMarker : (isSelectedNode ? COLORS.nodeActive : op.color);
    ctx.strokeStyle = isSelectedNode ? COLORS.nodeHover : '#fff';
    ctx.lineWidth = isSelectedNode ? 2.5 : 1.5;
    ctx.beginPath(); ctx.arc(wp.position.x,wp.position.y,r,0,Math.PI*2); ctx.fill(); ctx.stroke();

    // Facing arrow
    if (wp.facingOverride !== null) {
      const al = 16;
      const ax = wp.position.x + Math.cos(wp.facingOverride)*al;
      const ay = wp.position.y + Math.sin(wp.facingOverride)*al;
      ctx.strokeStyle = op.color; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(wp.position.x,wp.position.y); ctx.lineTo(ax,ay); ctx.stroke();
      const hl=5, ha=0.5;
      ctx.beginPath(); ctx.moveTo(ax,ay);
      ctx.lineTo(ax-hl*Math.cos(wp.facingOverride-ha),ay-hl*Math.sin(wp.facingOverride-ha));
      ctx.moveTo(ax,ay);
      ctx.lineTo(ax-hl*Math.cos(wp.facingOverride+ha),ay-hl*Math.sin(wp.facingOverride+ha));
      ctx.stroke();
    }

    // Look target line (dotted line to target point)
    if (wp.lookTarget) {
      ctx.strokeStyle = COLORS.lookTargetLine; ctx.lineWidth = 1.5; ctx.setLineDash([6,4]);
      ctx.globalAlpha = 0.6;
      ctx.beginPath(); ctx.moveTo(wp.position.x,wp.position.y); ctx.lineTo(wp.lookTarget.x,wp.lookTarget.y); ctx.stroke();
      ctx.setLineDash([]); ctx.globalAlpha = 1;
      // Crosshair at target
      const tx = wp.lookTarget.x, ty = wp.lookTarget.y;
      ctx.strokeStyle = COLORS.lookTargetLine; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(tx-6,ty); ctx.lineTo(tx+6,ty); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(tx,ty-6); ctx.lineTo(tx,ty+6); ctx.stroke();
    }

    // Hold ring
    if (wp.hold) {
      ctx.strokeStyle = COLORS.holdMarker; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(wp.position.x,wp.position.y,r+4,0,Math.PI*2); ctx.stroke();
    }

    // Tempo indicator (small colored bar below node)
    if (wp.tempo !== 1) {
      const barW = 16, barH = 3;
      const barX = wp.position.x - barW/2, barY = wp.position.y + r + 5;
      ctx.fillStyle = wp.tempo > 1 ? COLORS.tempoFast : COLORS.tempoSlow;
      ctx.fillRect(barX, barY, barW * Math.min(wp.tempo / 2, 1), barH);
      ctx.strokeStyle = '#555'; ctx.lineWidth = 0.5;
      ctx.strokeRect(barX, barY, barW, barH);
      ctx.fillStyle = COLORS.uiText; ctx.font = '8px monospace'; ctx.textAlign = 'center'; ctx.textBaseline = 'top';
      ctx.fillText(`${wp.tempo}x`, wp.position.x, barY + barH + 1);
    }
  }
}

function drawOperator(ctx: CanvasRenderingContext2D, op: Operator, selected: boolean, greyed: boolean) {
  const { position: p, angle, color } = op;
  const r = OPERATOR_RADIUS;

  ctx.save();
  ctx.translate(p.x, p.y);
  ctx.rotate(angle);

  if (greyed) ctx.globalAlpha = 0.3;
  if (selected) { ctx.shadowColor = color; ctx.shadowBlur = 14; }

  const tipX = r + 4, backX = -r + 2, sideY = r - 1, notchX = -r * 0.3;
  ctx.beginPath();
  ctx.moveTo(tipX, 0);
  ctx.lineTo(backX, -sideY);
  ctx.lineTo(notchX, 0);
  ctx.lineTo(backX, sideY);
  ctx.closePath();

  ctx.fillStyle = greyed ? COLORS.operatorBodyGrey : COLORS.operatorBody;
  ctx.fill();
  ctx.strokeStyle = greyed ? '#555' : color;
  ctx.lineWidth = 2.5;
  ctx.stroke();
  ctx.strokeStyle = COLORS.operatorOutline; ctx.lineWidth = 1; ctx.stroke();
  ctx.shadowBlur = 0; ctx.shadowColor = 'transparent';

  ctx.fillStyle = greyed ? '#888' : '#fff';
  ctx.font = 'bold 9px monospace'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(op.label, -1, 0);

  ctx.globalAlpha = 1;
  ctx.restore();

  // Tempo label if not default
  if (op.tempo !== 1 && !greyed) {
    ctx.fillStyle = op.tempo > 1 ? COLORS.tempoFast : COLORS.tempoSlow;
    ctx.font = 'bold 9px monospace'; ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    ctx.fillText(`${op.tempo}x`, p.x, p.y + r + 4);
  }
}

function drawTempoIndicator(ctx: CanvasRenderingContext2D, pos: Vec2, tempo: number) {
  const w = 60, h = 20;
  const x = pos.x - w/2, y = pos.y - 40;
  ctx.fillStyle = COLORS.radialBg;
  ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = COLORS.radialBorder; ctx.lineWidth = 1;
  ctx.strokeRect(x, y, w, h);
  // Bar
  const barW = w - 8, barH = 6;
  const barX = x + 4, barY = y + 3;
  ctx.fillStyle = '#333';
  ctx.fillRect(barX, barY, barW, barH);
  const fill = (tempo - 0.2) / 2.8; // 0.2 to 3.0
  ctx.fillStyle = tempo > 1 ? COLORS.tempoFast : COLORS.tempoSlow;
  ctx.fillRect(barX, barY, barW * Math.max(0, Math.min(1, fill)), barH);
  // Label
  ctx.fillStyle = COLORS.uiTextBright; ctx.font = 'bold 10px monospace'; ctx.textAlign = 'center'; ctx.textBaseline = 'top';
  ctx.fillText(`${tempo.toFixed(1)}x`, pos.x, y + barH + 5);
}

function drawRadialMenu(ctx: CanvasRenderingContext2D, rm: RadialMenu) {
  const cx = rm.position.x, cy = rm.position.y;
  const count = rm.items.length;

  // Background ring
  ctx.fillStyle = COLORS.radialBg;
  ctx.beginPath(); ctx.arc(cx, cy, RADIAL_RADIUS + RADIAL_ITEM_RADIUS + 6, 0, Math.PI*2); ctx.fill();
  ctx.strokeStyle = COLORS.radialBorder; ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.arc(cx, cy, RADIAL_RADIUS + RADIAL_ITEM_RADIUS + 6, 0, Math.PI*2); ctx.stroke();

  // Center dot
  ctx.fillStyle = '#334'; ctx.beginPath(); ctx.arc(cx, cy, 8, 0, Math.PI*2); ctx.fill();

  for (let i = 0; i < count; i++) {
    const a = (i / count) * Math.PI * 2 - Math.PI / 2;
    const ix = cx + Math.cos(a) * RADIAL_RADIUS;
    const iy = cy + Math.sin(a) * RADIAL_RADIUS;
    const hovered = rm.hoveredIndex === i;
    const item = rm.items[i];

    // Button circle
    ctx.fillStyle = hovered ? COLORS.radialHover : 'rgba(30, 50, 55, 0.9)';
    ctx.strokeStyle = hovered ? COLORS.uiAccent : (item.color || COLORS.radialBorder);
    ctx.lineWidth = hovered ? 2 : 1;
    ctx.beginPath(); ctx.arc(ix, iy, RADIAL_ITEM_RADIUS, 0, Math.PI*2); ctx.fill(); ctx.stroke();

    // Icon text
    ctx.fillStyle = item.color || COLORS.uiTextBright;
    ctx.font = 'bold 9px monospace'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(item.icon, ix, iy - 1);

    // Label below
    ctx.fillStyle = COLORS.uiText; ctx.font = '8px monospace'; ctx.textBaseline = 'top';
    ctx.fillText(item.label, ix, iy + RADIAL_ITEM_RADIUS + 2);
  }
}

function drawCanvasHUD(ctx: CanvasRenderingContext2D, state: GameState, w: number, h: number) {
  ctx.fillStyle = COLORS.uiOverlayBg; ctx.fillRect(8,8,150,26);
  ctx.strokeStyle = COLORS.uiAccent; ctx.lineWidth = 1; ctx.strokeRect(8,8,150,26);
  ctx.fillStyle = COLORS.uiTextBright; ctx.font = 'bold 12px monospace'; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
  ctx.fillText(state.room.name.toUpperCase(), 16, 21);

  const mt = state.mode.toUpperCase();
  ctx.fillStyle = COLORS.uiOverlayBg; ctx.fillRect(w-130,8,122,26);
  ctx.strokeStyle = state.mode==='executing' ? COLORS.cleared : COLORS.uiAccent; ctx.lineWidth=1; ctx.strokeRect(w-130,8,122,26);
  ctx.fillStyle = state.mode==='executing' ? COLORS.cleared : COLORS.uiTextBright; ctx.font = 'bold 12px monospace'; ctx.textAlign = 'right';
  ctx.fillText(mt, w-16, 21);

  if (state.roomCleared) {
    ctx.fillStyle = 'rgba(0,0,0,0.35)'; ctx.fillRect(0,0,w,h);
    const bw=260,bh=60,bx=w/2-bw/2,by=h/2-bh/2;
    ctx.fillStyle='rgba(10,30,20,0.9)'; ctx.fillRect(bx,by,bw,bh);
    ctx.strokeStyle=COLORS.cleared; ctx.lineWidth=2; ctx.strokeRect(bx,by,bw,bh);
    ctx.fillStyle=COLORS.cleared; ctx.font='bold 24px monospace'; ctx.textAlign='center'; ctx.textBaseline='middle';
    ctx.fillText('ROOM CLEARED',w/2,h/2);
  }
  ctx.textBaseline = 'alphabetic';
}
