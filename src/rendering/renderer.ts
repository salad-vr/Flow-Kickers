import type { GameState, Operator, Room, WallSegment, ThreatMarker } from '../types';
import { WALL_THICKNESS, OPERATOR_RADIUS, THREAT_RADIUS, GRID_SIZE, DOOR_WIDTH, COLORS } from '../types';
import { PALETTE } from './colors';
import { getWallsForCollision } from '../room/room';
import { computeOperatorFOV } from '../operator/visibility';
import type { Vec2 } from '../math/vec2';
import type { Wall } from '../math/intersection';

let canvas: HTMLCanvasElement;
let ctx: CanvasRenderingContext2D;
let walls: Wall[] = [];

export function initRenderer(c: HTMLCanvasElement) {
  canvas = c;
  const context = c.getContext('2d');
  if (!context) throw new Error('Failed to get 2d context');
  ctx = context;
}

export function getCtx(): CanvasRenderingContext2D {
  return ctx;
}

export function getCanvas(): HTMLCanvasElement {
  return canvas;
}

export function render(state: GameState) {
  const w = canvas.width;
  const h = canvas.height;

  // Cache walls for collision
  walls = getWallsForCollision(state.room);

  // Clear
  ctx.fillStyle = PALETTE.bgOuter;
  ctx.fillRect(0, 0, w, h);

  // Draw floor
  drawFloor(state.room);

  // Draw grid
  drawGrid(w, h);

  // Draw FOV cones (under fog, above floor)
  for (const op of state.operators) {
    drawFOVCone(op, walls);
  }

  // Draw threats
  for (const threat of state.room.threats) {
    drawThreat(threat);
  }

  // Draw walls
  for (const wall of state.room.walls) {
    drawWall(wall);
  }

  // Draw paths (in planning mode or always)
  for (const op of state.operators) {
    drawPath(op);
  }

  // Draw operators
  for (const op of state.operators) {
    drawOperator(op, state.selectedOperatorId === op.id);
  }

  // Draw entry point indicators (planning mode)
  if (state.mode === 'planning' && state.operators.length === 0) {
    drawEntryPoints(state.room);
  }

  // Draw HUD overlay
  drawHUD(state, w, h);
}

function drawFloor(room: Room) {
  if (room.floor.length < 3) return;
  ctx.beginPath();
  ctx.moveTo(room.floor[0].x, room.floor[0].y);
  for (let i = 1; i < room.floor.length; i++) {
    ctx.lineTo(room.floor[i].x, room.floor[i].y);
  }
  ctx.closePath();
  ctx.fillStyle = PALETTE.floor;
  ctx.fill();

  // Subtle noise/texture pattern
  ctx.strokeStyle = PALETTE.floorAlt;
  ctx.globalAlpha = 0.3;
  for (let i = 0; i < room.floor.length; i++) {
    const p = room.floor[i];
    const next = room.floor[(i + 1) % room.floor.length];
    // Just add subtle line detail
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
    ctx.lineTo(next.x, next.y);
    ctx.lineWidth = 1;
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
}

function drawGrid(w: number, h: number) {
  ctx.strokeStyle = PALETTE.grid;
  ctx.lineWidth = 0.5;
  for (let x = 0; x < w; x += GRID_SIZE) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, h);
    ctx.stroke();
  }
  for (let y = 0; y < h; y += GRID_SIZE) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(w, y);
    ctx.stroke();
  }
}

function drawWall(wall: WallSegment) {
  const { a, b, hasDoor, doorOpen } = wall;

  if (hasDoor) {
    // Calculate door gap
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.sqrt(dx * dx + dy * dy);
    const doorFrac = DOOR_WIDTH / len;
    const gapStart = 0.5 - doorFrac / 2;
    const gapEnd = 0.5 + doorFrac / 2;

    // Draw wall segments on each side of door
    ctx.lineCap = 'round';
    ctx.strokeStyle = PALETTE.wall;
    ctx.lineWidth = WALL_THICKNESS;

    if (gapStart > 0.01) {
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(a.x + dx * gapStart, a.y + dy * gapStart);
      ctx.stroke();
    }
    if (gapEnd < 0.99) {
      ctx.beginPath();
      ctx.moveTo(a.x + dx * gapEnd, a.y + dy * gapEnd);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    }

    // Draw door frame
    const doorStartX = a.x + dx * gapStart;
    const doorStartY = a.y + dy * gapStart;
    const doorEndX = a.x + dx * gapEnd;
    const doorEndY = a.y + dy * gapEnd;

    // Door frame markers
    const perpX = -dy / len * 4;
    const perpY = dx / len * 4;

    ctx.strokeStyle = doorOpen ? PALETTE.doorOpen : PALETTE.doorClosed;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(doorStartX + perpX, doorStartY + perpY);
    ctx.lineTo(doorStartX - perpX, doorStartY - perpY);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(doorEndX + perpX, doorEndY + perpY);
    ctx.lineTo(doorEndX - perpX, doorEndY - perpY);
    ctx.stroke();

    if (!doorOpen) {
      // Draw closed door as thinner line
      ctx.strokeStyle = PALETTE.doorClosed;
      ctx.lineWidth = 2;
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.moveTo(doorStartX, doorStartY);
      ctx.lineTo(doorEndX, doorEndY);
      ctx.stroke();
      ctx.setLineDash([]);
    }
  } else {
    // Normal wall
    ctx.lineCap = 'round';
    ctx.strokeStyle = PALETTE.wallEdge;
    ctx.lineWidth = WALL_THICKNESS + 2;
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();

    ctx.strokeStyle = PALETTE.wall;
    ctx.lineWidth = WALL_THICKNESS;
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
  }
}

function drawThreat(threat: ThreatMarker) {
  const { position: p, neutralized } = threat;
  const r = THREAT_RADIUS;

  // Glow
  ctx.fillStyle = neutralized ? PALETTE.threatNeutralizedGlow : PALETTE.threatGlow;
  ctx.beginPath();
  ctx.arc(p.x, p.y, r * 2.5, 0, Math.PI * 2);
  ctx.fill();

  // X marker
  ctx.strokeStyle = neutralized ? PALETTE.threatNeutralized : PALETTE.threatActive;
  ctx.lineWidth = neutralized ? 2 : 3;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(p.x - r, p.y - r);
  ctx.lineTo(p.x + r, p.y + r);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(p.x + r, p.y - r);
  ctx.lineTo(p.x - r, p.y + r);
  ctx.stroke();
}

function drawFOVCone(op: Operator, collisionWalls: Wall[]) {
  // Only draw FOV if operator is placed (has started or has path)
  const fovPoly = computeOperatorFOV(op, collisionWalls);
  if (fovPoly.length < 2) return;

  // Fill FOV polygon
  ctx.fillStyle = op.color + '18'; // very transparent team color
  ctx.beginPath();
  ctx.moveTo(op.position.x, op.position.y);
  for (const p of fovPoly) {
    ctx.lineTo(p.x, p.y);
  }
  ctx.closePath();
  ctx.fill();

  // Edge of FOV
  ctx.strokeStyle = op.color + '40';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(op.position.x, op.position.y);
  ctx.lineTo(fovPoly[0].x, fovPoly[0].y);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(op.position.x, op.position.y);
  ctx.lineTo(fovPoly[fovPoly.length - 1].x, fovPoly[fovPoly.length - 1].y);
  ctx.stroke();
}

function drawPath(op: Operator) {
  const waypoints = op.path.waypoints;
  if (waypoints.length < 2) return;

  // Draw the spline path as dashed line
  const lut = op.path.splineLUT;
  if (lut && lut.samples.length > 1) {
    ctx.strokeStyle = op.color;
    ctx.globalAlpha = PALETTE.pathAlpha;
    ctx.lineWidth = 2;
    ctx.setLineDash([8, 5]);
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(lut.samples[0].x, lut.samples[0].y);
    for (let i = 1; i < lut.samples.length; i++) {
      ctx.lineTo(lut.samples[i].x, lut.samples[i].y);
    }
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.globalAlpha = 1;
  }

  // Draw waypoint circles
  for (let i = 0; i < waypoints.length; i++) {
    const wp = waypoints[i];
    const r = 5;

    // Waypoint dot
    ctx.fillStyle = wp.hold ? PALETTE.holdMarker : op.color;
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(wp.position.x, wp.position.y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    // Facing override arrow
    if (wp.facingOverride !== null) {
      const arrowLen = 18;
      const ax = wp.position.x + Math.cos(wp.facingOverride) * arrowLen;
      const ay = wp.position.y + Math.sin(wp.facingOverride) * arrowLen;
      ctx.strokeStyle = op.color;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(wp.position.x, wp.position.y);
      ctx.lineTo(ax, ay);
      ctx.stroke();

      // Arrowhead
      const headLen = 6;
      const headAngle = 0.5;
      ctx.beginPath();
      ctx.moveTo(ax, ay);
      ctx.lineTo(
        ax - headLen * Math.cos(wp.facingOverride - headAngle),
        ay - headLen * Math.sin(wp.facingOverride - headAngle),
      );
      ctx.moveTo(ax, ay);
      ctx.lineTo(
        ax - headLen * Math.cos(wp.facingOverride + headAngle),
        ay - headLen * Math.sin(wp.facingOverride + headAngle),
      );
      ctx.stroke();
    }

    // Hold indicator - orange ring
    if (wp.hold) {
      ctx.strokeStyle = PALETTE.holdMarker;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(wp.position.x, wp.position.y, r + 4, 0, Math.PI * 2);
      ctx.stroke();

      // Go code label
      if (wp.goCode) {
        ctx.fillStyle = PALETTE.holdMarker;
        ctx.font = 'bold 10px monospace';
        ctx.textAlign = 'center';
        ctx.fillText(wp.goCode, wp.position.x, wp.position.y - 12);
      }
    }
  }
}

function drawOperator(op: Operator, selected: boolean) {
  const { position: p, angle, color } = op;
  const r = OPERATOR_RADIUS;

  // Selection ring
  if (selected) {
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(p.x, p.y, r + 5, 0, Math.PI * 2);
    ctx.stroke();
  }

  // Body circle
  ctx.fillStyle = PALETTE.opBody;
  ctx.strokeStyle = PALETTE.opOutline;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  // Team color ring
  ctx.strokeStyle = color;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(p.x, p.y, r - 1, 0, Math.PI * 2);
  ctx.stroke();

  // Facing direction indicator (small line)
  const dirLen = r + 6;
  ctx.strokeStyle = color;
  ctx.lineWidth = 2.5;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(p.x + Math.cos(angle) * (r - 2), p.y + Math.sin(angle) * (r - 2));
  ctx.lineTo(p.x + Math.cos(angle) * dirLen, p.y + Math.sin(angle) * dirLen);
  ctx.stroke();

  // Label
  ctx.fillStyle = '#fff';
  ctx.font = 'bold 9px monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(op.label, p.x, p.y);
}

function drawEntryPoints(room: Room) {
  for (const ep of room.entryPoints) {
    ctx.strokeStyle = PALETTE.uiAccent;
    ctx.lineWidth = 1.5;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.arc(ep.x, ep.y, 12, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.fillStyle = PALETTE.uiAccent;
    ctx.font = '10px monospace';
    ctx.textAlign = 'center';
    ctx.fillText('+', ep.x, ep.y + 3);
  }
}

function drawHUD(state: GameState, w: number, _h: number) {
  // Mode indicator
  const modeLabels: Record<string, string> = {
    planning: 'PLANNING',
    executing: 'EXECUTING',
    paused: 'PAUSED',
  };
  const modeText = modeLabels[state.mode] || state.mode.toUpperCase();

  ctx.fillStyle = PALETTE.uiOverlayBg;
  ctx.fillRect(w - 160, 8, 152, 28);
  ctx.strokeStyle = PALETTE.uiAccent;
  ctx.lineWidth = 1;
  ctx.strokeRect(w - 160, 8, 152, 28);

  ctx.fillStyle = state.mode === 'executing' ? PALETTE.cleared : PALETTE.uiTextBright;
  ctx.font = 'bold 12px monospace';
  ctx.textAlign = 'right';
  ctx.fillText(modeText, w - 18, 27);

  // Timer
  const minutes = Math.floor(state.elapsedTime / 60);
  const seconds = Math.floor(state.elapsedTime % 60);
  const timeStr = `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;

  ctx.fillStyle = PALETTE.uiOverlayBg;
  ctx.fillRect(w - 160, 40, 152, 24);
  ctx.strokeStyle = '#2a4a4a';
  ctx.lineWidth = 1;
  ctx.strokeRect(w - 160, 40, 152, 24);

  ctx.fillStyle = PALETTE.uiText;
  ctx.font = '11px monospace';
  ctx.textAlign = 'right';
  ctx.fillText(timeStr, w - 18, 56);

  // Room name
  ctx.fillStyle = PALETTE.uiOverlayBg;
  ctx.fillRect(8, 8, 160, 28);
  ctx.strokeStyle = '#2a4a4a';
  ctx.lineWidth = 1;
  ctx.strokeRect(8, 8, 160, 28);
  ctx.fillStyle = PALETTE.uiTextBright;
  ctx.font = 'bold 12px monospace';
  ctx.textAlign = 'left';
  ctx.fillText(state.room.name, 16, 27);

  // Room cleared overlay
  if (state.roomCleared) {
    ctx.fillStyle = 'rgba(0,0,0,0.4)';
    ctx.fillRect(w / 2 - 100, _h / 2 - 25, 200, 50);
    ctx.strokeStyle = PALETTE.cleared;
    ctx.lineWidth = 2;
    ctx.strokeRect(w / 2 - 100, _h / 2 - 25, 200, 50);

    ctx.fillStyle = PALETTE.cleared;
    ctx.font = 'bold 22px monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('ROOM CLEARED', w / 2, _h / 2);
    ctx.textBaseline = 'alphabetic';
  }

  // Tool indicator (bottom left)
  if (state.mode === 'planning') {
    const toolNames: Record<string, string> = {
      select: 'SELECT',
      wall: 'WALL',
      door: 'DOOR',
      threat: 'THREAT',
      path: 'PATH',
      facing: 'FACING',
      move_operator: 'MOVE OP',
    };
    const toolText = toolNames[state.activeTool] || state.activeTool;
    ctx.fillStyle = PALETTE.uiOverlayBg;
    ctx.fillRect(8, _h - 36, 120, 28);
    ctx.strokeStyle = PALETTE.uiAccent;
    ctx.lineWidth = 1;
    ctx.strokeRect(8, _h - 36, 120, 28);
    ctx.fillStyle = PALETTE.uiAccent;
    ctx.font = 'bold 11px monospace';
    ctx.textAlign = 'left';
    ctx.fillText(`TOOL: ${toolText}`, 16, _h - 18);
  }
}

export { walls as cachedWalls };
