import type { Operator, GameState } from '../types';
import { getPointAtDistance, getTangentAtDistance, buildSplineLUT } from '../math/spline';
import { angle as vecAngle, lerpAngle } from '../math/vec2';

const TURN_RATE = 6.0;
const ARRIVE_SLOW_RADIUS = 30;

export function rebuildPathLUT(op: Operator) {
  if (op.path.waypoints.length < 2) {
    op.path.splineLUT = null;
    return;
  }
  const points = op.path.waypoints.map(w => w.position);
  op.path.splineLUT = buildSplineLUT(points, 30);
}

export function updatePathFollowing(op: Operator, dt: number, state: GameState): boolean {
  const lut = op.path.splineLUT;
  if (!lut || lut.totalLength === 0 || op.reachedEnd) {
    op.isMoving = false;
    return false;
  }

  // Check hold
  if (op.isHolding) {
    const wp = op.path.waypoints[op.currentWaypointIndex];
    if (wp && wp.hold) {
      const goCode = wp.goCode || 'A';
      if (!state.goCodesTriggered[goCode]) {
        if (wp.facingOverride !== null) {
          op.angle = lerpAngle(op.angle, wp.facingOverride, TURN_RATE * dt);
        } else if (wp.lookTarget) {
          const la = Math.atan2(wp.lookTarget.y - op.position.y, wp.lookTarget.x - op.position.x);
          op.angle = lerpAngle(op.angle, la, TURN_RATE * dt);
        }
        return false;
      }
      op.isHolding = false;
    }
  }

  // Get current tempo: operator base * current waypoint's tempo
  const currentWp = op.path.waypoints[op.currentWaypointIndex];
  const wpTempo = currentWp ? currentWp.tempo : 1;
  const effectiveTempo = op.tempo * wpTempo;

  let speed = op.speed * effectiveTempo;

  // Arrive behavior near hold waypoints
  const nextHoldWp = findNextHoldWaypoint(op);
  if (nextHoldWp !== null) {
    const holdDist = getWaypointDistance(op, nextHoldWp);
    if (holdDist !== null) {
      const distToHold = holdDist - op.distanceTraveled;
      if (distToHold < ARRIVE_SLOW_RADIUS && distToHold > 0) {
        speed = Math.max(speed * (distToHold / ARRIVE_SLOW_RADIUS), speed * 0.15);
      }
    }
  }

  const moveDist = speed * dt;
  op.distanceTraveled += moveDist;
  op.isMoving = true;

  if (op.distanceTraveled >= lut.totalLength) {
    op.distanceTraveled = lut.totalLength;
    op.reachedEnd = true;
    op.isMoving = false;
    op.position = getPointAtDistance(lut, lut.totalLength);
    const lastWp = op.path.waypoints[op.path.waypoints.length - 1];
    if (lastWp && lastWp.facingOverride !== null) {
      op.angle = lerpAngle(op.angle, lastWp.facingOverride, TURN_RATE * dt);
    } else if (lastWp && lastWp.lookTarget) {
      const la = Math.atan2(lastWp.lookTarget.y - op.position.y, lastWp.lookTarget.x - op.position.x);
      op.angle = lerpAngle(op.angle, la, TURN_RATE * dt);
    }
    return true;
  }

  const newPos = getPointAtDistance(lut, op.distanceTraveled);
  op.position = newPos;

  const tangent = getTangentAtDistance(lut, op.distanceTraveled);
  let targetAngle = vecAngle(tangent);

  checkWaypointReached(op, lut);

  // Apply look target or facing override
  const activeWp = op.path.waypoints[op.currentWaypointIndex];
  if (activeWp) {
    if (activeWp.lookTarget) {
      // Lock facing toward the look target point
      targetAngle = Math.atan2(
        activeWp.lookTarget.y - op.position.y,
        activeWp.lookTarget.x - op.position.x
      );
    } else if (activeWp.facingOverride !== null) {
      const wpDist = getWaypointDistance(op, op.currentWaypointIndex);
      if (wpDist !== null) {
        const distToWp = Math.abs(wpDist - op.distanceTraveled);
        if (distToWp < 50) {
          const blend = 1 - distToWp / 50;
          targetAngle = lerpAngle(targetAngle, activeWp.facingOverride, blend);
        }
      }
    }
  }

  op.angle = lerpAngle(op.angle, targetAngle, Math.min(1, TURN_RATE * dt));
  return true;
}

function findNextHoldWaypoint(op: Operator): number | null {
  for (let i = op.currentWaypointIndex; i < op.path.waypoints.length; i++) {
    if (op.path.waypoints[i].hold) return i;
  }
  return null;
}

function getWaypointDistance(op: Operator, wpIndex: number): number | null {
  const lut = op.path.splineLUT;
  if (!lut || op.path.waypoints.length < 2) return null;
  const segmentFraction = wpIndex / (op.path.waypoints.length - 1);
  return segmentFraction * lut.totalLength;
}

function checkWaypointReached(op: Operator, lut: { totalLength: number }) {
  const wpCount = op.path.waypoints.length;
  if (wpCount < 2) return;
  const targetIndex = op.currentWaypointIndex + 1;
  if (targetIndex >= wpCount) return;
  const wpDist = (targetIndex / (wpCount - 1)) * lut.totalLength;
  if (op.distanceTraveled >= wpDist - 5) {
    op.currentWaypointIndex = targetIndex;
    const wp = op.path.waypoints[targetIndex];
    if (wp && wp.hold) {
      op.isHolding = true;
      op.distanceTraveled = wpDist;
    }
  }
}
