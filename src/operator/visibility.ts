import type { Operator, Room } from '../types';
import { NEUTRALIZE_T } from '../types';
import { computeVisibilityPolygon, pointInPolygon, type Wall } from '../math/intersection';
import type { Vec2 } from '../math/vec2';

export function computeOperatorFOV(op: Operator, walls: Wall[]): Vec2[] {
  const half = op.fovAngle / 2;
  return computeVisibilityPolygon(op.position, walls, op.angle - half, op.angle + half, op.fovRange, 60);
}

export function updateThreatEngagement(operators: Operator[], room: Room, walls: Wall[], dt: number, floorLevel = 0): void {
  // Get threats for this floor level
  const threats = floorLevel === 0 ? room.threats : (room.floors?.find(f => f.level === floorLevel)?.threats || []);
  for (const t of threats) {
    if (t.neutralized) continue;
    let seen = false;
    for (const op of operators) {
      if (!op.deployed) continue;
      if (op.currentFloor !== floorLevel) continue; // Only engage threats on same floor
      if (!op.isMoving && !op.reachedEnd && op.path.waypoints.length === 0) continue;
      const dx = t.position.x - op.position.x, dy = t.position.y - op.position.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist > op.fovRange) continue;
      let ad = Math.atan2(dy, dx) - op.angle;
      while (ad > Math.PI) ad -= Math.PI * 2;
      while (ad < -Math.PI) ad += Math.PI * 2;
      if (Math.abs(ad) > op.fovAngle / 2) continue;
      const poly = [op.position, ...computeOperatorFOV(op, walls)];
      if (pointInPolygon(t.position, poly)) { seen = true; break; }
    }
    if (seen) { t.neutralizeTimer += dt; if (t.neutralizeTimer >= NEUTRALIZE_T) t.neutralized = true; }
    else t.neutralizeTimer = Math.max(0, t.neutralizeTimer - dt * 0.5);
  }
}

export function isRoomCleared(room: Room): boolean {
  // Check all floors
  const allThreats = [...room.threats];
  if (room.floors) {
    for (const fl of room.floors) allThreats.push(...fl.threats);
  }
  return allThreats.length > 0 && allThreats.every(t => t.neutralized);
}
