import type { Operator, GameState } from '../types';
import { getPointAtDistance, getTangentAtDistance, buildSplineLUT } from '../math/spline';
import { angle as vecAngle, distance, angleDiff, lerpAngle } from '../math/vec2';

const TURN_RATE = 6.0; // radians per second - how fast operators rotate
const ARRIVE_SLOW_RADIUS = 30; // start slowing down within this distance of hold waypoint

/**
 * Rebuild the spline LUT for an operator's path.
 * Call this whenever waypoints change.
 */
export function rebuildPathLUT(op: Operator) {
  if (op.path.waypoints.length < 2) {
    op.path.splineLUT = null;
    return;
  }
  const points = op.path.waypoints.map(w => w.position);
  op.path.splineLUT = buildSplineLUT(points, 30);
}

/**
 * Update an operator's movement along its path.
 * Returns true if the operator moved.
 */
export function updatePathFollowing(op: Operator, dt: number, state: GameState): boolean {
  const lut = op.path.splineLUT;
  if (!lut || lut.totalLength === 0 || op.reachedEnd) {
    op.isMoving = false;
    return false;
  }

  // Check if currently holding at a waypoint
  if (op.isHolding) {
    const wp = op.path.waypoints[op.currentWaypointIndex];
    if (wp && wp.hold) {
      const goCode = wp.goCode || 'A'; // Default to go code A
      if (!state.goCodesTriggered[goCode]) {
        // Still holding - update facing if there's an override
        if (wp.facingOverride !== null) {
          op.angle = lerpAngle(op.angle, wp.facingOverride, TURN_RATE * dt);
        }
        return false;
      }
      // Go code triggered - release the hold
      op.isHolding = false;
    }
  }

  // Calculate target speed (with arrive behavior near hold waypoints)
  let speed = op.speed;

  // Look ahead for the next hold waypoint
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

  // Move along the spline
  const moveDist = speed * dt;
  op.distanceTraveled += moveDist;
  op.isMoving = true;

  // Check if we've reached the end
  if (op.distanceTraveled >= lut.totalLength) {
    op.distanceTraveled = lut.totalLength;
    op.reachedEnd = true;
    op.isMoving = false;
    op.position = getPointAtDistance(lut, lut.totalLength);

    // Apply final waypoint facing if set
    const lastWp = op.path.waypoints[op.path.waypoints.length - 1];
    if (lastWp && lastWp.facingOverride !== null) {
      op.angle = lerpAngle(op.angle, lastWp.facingOverride, TURN_RATE * dt);
    }
    return true;
  }

  // Get new position from spline
  const newPos = getPointAtDistance(lut, op.distanceTraveled);
  op.position = newPos;

  // Get tangent for facing
  const tangent = getTangentAtDistance(lut, op.distanceTraveled);
  let targetAngle = vecAngle(tangent);

  // Check if we've reached the current waypoint
  checkWaypointReached(op, lut);

  // Apply facing override if current waypoint has one
  const currentWp = op.path.waypoints[op.currentWaypointIndex];
  if (currentWp && currentWp.facingOverride !== null) {
    // Blend toward override as we approach the waypoint
    const wpDist = getWaypointDistance(op, op.currentWaypointIndex);
    if (wpDist !== null) {
      const distToWp = Math.abs(wpDist - op.distanceTraveled);
      if (distToWp < 50) {
        const blend = 1 - distToWp / 50;
        targetAngle = lerpAngle(targetAngle, currentWp.facingOverride, blend);
      }
    }
  }

  // Smooth rotation toward target angle
  op.angle = lerpAngle(op.angle, targetAngle, Math.min(1, TURN_RATE * dt));

  return true;
}

/** Find the next waypoint with hold=true after current position */
function findNextHoldWaypoint(op: Operator): number | null {
  for (let i = op.currentWaypointIndex; i < op.path.waypoints.length; i++) {
    if (op.path.waypoints[i].hold) return i;
  }
  return null;
}

/** Get the approximate distance along the spline to a specific waypoint index */
function getWaypointDistance(op: Operator, wpIndex: number): number | null {
  const lut = op.path.splineLUT;
  if (!lut || op.path.waypoints.length < 2) return null;

  // Waypoints are evenly distributed across segments
  const segmentFraction = wpIndex / (op.path.waypoints.length - 1);
  return segmentFraction * lut.totalLength;
}

/** Check if we've passed the current waypoint and advance */
function checkWaypointReached(op: Operator, lut: { totalLength: number }) {
  const wpCount = op.path.waypoints.length;
  if (wpCount < 2) return;

  const targetIndex = op.currentWaypointIndex + 1;
  if (targetIndex >= wpCount) return;

  const wpDist = (targetIndex / (wpCount - 1)) * lut.totalLength;

  if (op.distanceTraveled >= wpDist - 5) {
    op.currentWaypointIndex = targetIndex;

    // Check if this waypoint has a hold
    const wp = op.path.waypoints[targetIndex];
    if (wp && wp.hold) {
      op.isHolding = true;
      op.distanceTraveled = wpDist; // Snap to waypoint position
    }
  }
}
