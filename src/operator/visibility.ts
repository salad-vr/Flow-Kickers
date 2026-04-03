import type { Operator, Room, ThreatMarker } from '../types';
import { NEUTRALIZE_TIME } from '../types';
import { computeVisibilityPolygon, pointInPolygon, type Wall } from '../math/intersection';
import { getWallsForCollision } from '../room/room';
import type { Vec2 } from '../math/vec2';

/**
 * Compute the visibility polygon for an operator's FOV.
 * Returns the polygon vertices for rendering.
 */
export function computeOperatorFOV(op: Operator, walls: Wall[]): Vec2[] {
  const halfFov = op.fovAngle / 2;
  const startAngle = op.angle - halfFov;
  const endAngle = op.angle + halfFov;

  return computeVisibilityPolygon(
    op.position,
    walls,
    startAngle,
    endAngle,
    op.fovRange,
    80, // number of rays
  );
}

/**
 * Check threats against operator FOV and update neutralization.
 */
export function updateThreatEngagement(
  operators: Operator[],
  room: Room,
  walls: Wall[],
  dt: number,
): void {
  for (const threat of room.threats) {
    if (threat.neutralized) continue;

    let inAnyFov = false;

    for (const op of operators) {
      if (!op.isMoving && !op.reachedEnd && op.path.waypoints.length === 0) continue;

      // Quick angle check first
      const dx = threat.position.x - op.position.x;
      const dy = threat.position.y - op.position.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist > op.fovRange) continue;

      const angleToThreat = Math.atan2(dy, dx);
      let angleDiff = angleToThreat - op.angle;
      while (angleDiff > Math.PI) angleDiff -= Math.PI * 2;
      while (angleDiff < -Math.PI) angleDiff += Math.PI * 2;
      if (Math.abs(angleDiff) > op.fovAngle / 2) continue;

      // Detailed check: compute FOV polygon (with origin) and test if threat is inside
      const fovPoly = computeOperatorFOV(op, walls);
      // Include operator origin to form the full fan/cone polygon
      const fullPoly = [op.position, ...fovPoly];
      if (pointInPolygon(threat.position, fullPoly)) {
        inAnyFov = true;
        break;
      }
    }

    if (inAnyFov) {
      threat.neutralizeTimer += dt;
      if (threat.neutralizeTimer >= NEUTRALIZE_TIME) {
        threat.neutralized = true;
      }
    } else {
      // Reset timer when not in FOV (optional: could keep accumulated time)
      threat.neutralizeTimer = Math.max(0, threat.neutralizeTimer - dt * 0.5);
    }
  }
}

/**
 * Check if all threats in the room are neutralized.
 */
export function isRoomCleared(room: Room): boolean {
  return room.threats.length > 0 && room.threats.every(t => t.neutralized);
}
