import type { Operator, GameState } from '../types';
import { getPointAtDistance, getTangentAtDistance, buildSplineLUT } from '../math/spline';
import { angle as vecAngle, lerpAngle } from '../math/vec2';

const TURN = 6.0;
const SLOW_R = 30;
/** Smoothing factor for visual position interpolation (higher = snappier, lower = smoother) */
const SMOOTH_FACTOR = 18;

export function rebuildPathLUT(op: Operator) {
  if (op.path.waypoints.length < 2) { op.path.splineLUT = null; return; }
  op.path.splineLUT = buildSplineLUT(op.path.waypoints.map(w => w.position), 30);
}

export function updatePathFollowing(op: Operator, dt: number, state: GameState): boolean {
  const lut = op.path.splineLUT;
  if (!lut || lut.totalLength === 0 || op.reachedEnd) {
    op.isMoving = false;
    // Keep smooth position synced when not moving
    op.smoothPosition.x = op.position.x;
    op.smoothPosition.y = op.position.y;
    return false;
  }

  if (op.isHolding) {
    const wp = op.path.waypoints[op.currentWaypointIndex];
    if (wp?.hold) {
      const gc = wp.goCode || 'A';
      if (!state.goCodesTriggered[gc]) {
        if (wp.facingOverride !== null) op.angle = lerpAngle(op.angle, wp.facingOverride, TURN * dt);
        else if (wp.lookTarget) op.angle = lerpAngle(op.angle, Math.atan2(wp.lookTarget.y - op.position.y, wp.lookTarget.x - op.position.x), TURN * dt);
        else if (op.pieTarget) op.angle = lerpAngle(op.angle, Math.atan2(op.pieTarget.y - op.position.y, op.pieTarget.x - op.position.x), TURN * dt);
        // Keep smooth position synced while holding
        op.smoothPosition.x = op.position.x;
        op.smoothPosition.y = op.position.y;
        return false;
      }
      op.isHolding = false;
    }
  }

  const cw = op.path.waypoints[op.currentWaypointIndex];
  const t = op.tempo * (cw?.tempo ?? 1);
  let spd = op.speed * t;

  // Arrive behavior
  for (let i = op.currentWaypointIndex; i < op.path.waypoints.length; i++) {
    if (op.path.waypoints[i].hold) {
      const hd = (i / (op.path.waypoints.length - 1)) * lut.totalLength;
      const dist = hd - op.distanceTraveled;
      if (dist > 0 && dist < SLOW_R) spd = Math.max(spd * (dist / SLOW_R), spd * 0.15);
      break;
    }
  }

  op.distanceTraveled += spd * dt;
  op.isMoving = true;

  if (op.distanceTraveled >= lut.totalLength) {
    op.distanceTraveled = lut.totalLength;
    op.reachedEnd = true;
    op.isMoving = false;
    op.position = getPointAtDistance(lut, lut.totalLength);
    // Snap to exact target angle (not lerp) so stage transitions capture the correct facing
    const last = op.path.waypoints[op.path.waypoints.length - 1];
    if (last?.facingOverride !== null) op.angle = last.facingOverride!;
    else if (last?.lookTarget) op.angle = Math.atan2(last.lookTarget.y - op.position.y, last.lookTarget.x - op.position.x);
    else if (op.pieTarget) op.angle = Math.atan2(op.pieTarget.y - op.position.y, op.pieTarget.x - op.position.x);
    return true;
  }

  op.position = getPointAtDistance(lut, op.distanceTraveled);

  // Advance waypoint index
  const wc = op.path.waypoints.length;
  if (wc >= 2) {
    const ni = op.currentWaypointIndex + 1;
    if (ni < wc) {
      const wd = (ni / (wc - 1)) * lut.totalLength;
      if (op.distanceTraveled >= wd - 5) {
        op.currentWaypointIndex = ni;
        // Floor transition: update operator's floor when reaching a waypoint on a different floor
        const wp = op.path.waypoints[ni];
        if (wp && wp.floorLevel !== undefined && wp.floorLevel !== op.currentFloor) {
          op.currentFloor = wp.floorLevel;
        }
        if (wp?.hold) { op.isHolding = true; op.distanceTraveled = wd; }
      }
    }
  }

  // Determine facing target
  let target: number;
  const aw = op.path.waypoints[op.currentWaypointIndex];

  if (aw?.lookTarget) {
    // Explicit look-at target on this waypoint (highest priority)
    target = Math.atan2(aw.lookTarget.y - op.position.y, aw.lookTarget.x - op.position.x);
  } else if (aw?.facingOverride !== null && aw.facingOverride !== undefined) {
    // Explicit direction set on this waypoint overrides pie
    target = aw.facingOverride;
  } else if (op.pieTarget) {
    // Pie target: continuously face toward the pizza (smooth tracking)
    target = Math.atan2(op.pieTarget.y - op.position.y, op.pieTarget.x - op.position.x);
  } else {
    // Default: follow spline tangent
    const tan = getTangentAtDistance(lut, op.distanceTraveled);
    target = vecAngle(tan);
  }

  op.angle = lerpAngle(op.angle, target, Math.min(1, TURN * dt));

  // Smooth visual position (subtle aesthetic interpolation)
  const sf = Math.min(1, SMOOTH_FACTOR * dt);
  op.smoothPosition.x += (op.position.x - op.smoothPosition.x) * sf;
  op.smoothPosition.y += (op.position.y - op.smoothPosition.y) * sf;

  return true;
}
