import type { GameState, GoCode } from '../types';
import { updatePathFollowing } from '../operator/pathFollower';
import { updateThreatEngagement, isRoomCleared } from '../operator/visibility';
import { getWallsForCollision } from '../room/room';
import { resetOperator } from '../operator/operator';

/**
 * Update the simulation by one time step.
 * Can be called in any mode - the caller decides when to call it.
 */
export function updateSimulation(state: GameState, dt: number) {
  state.elapsedTime += dt;

  // Update operator path following
  for (const op of state.operators) {
    updatePathFollowing(op, dt, state);
  }

  // Update threat engagement
  const walls = getWallsForCollision(state.room);
  updateThreatEngagement(state.operators, state.room, walls, dt);

  // Check room cleared
  if (!state.roomCleared && isRoomCleared(state.room)) {
    state.roomCleared = true;
  }
}

/**
 * Reset the simulation to initial state.
 * Does NOT change mode - caller is responsible for setting mode.
 */
export function resetSimulation(state: GameState) {
  state.elapsedTime = 0;
  state.roomCleared = false;
  state.goCodesTriggered = { A: false, B: false, C: false };

  // Reset operators
  for (const op of state.operators) {
    resetOperator(op);
  }

  // Reset threats
  for (const threat of state.room.threats) {
    threat.neutralized = false;
    threat.neutralizeTimer = 0;
  }

  // Auto-open all doors
  for (const wall of state.room.walls) {
    if (wall.hasDoor) {
      wall.doorOpen = true;
    }
  }
}

/**
 * Trigger a go code - releases all operators holding on this code.
 */
export function triggerGoCode(state: GameState, code: GoCode) {
  state.goCodesTriggered[code] = true;
}

/**
 * Start execution from planning mode.
 */
export function startExecution(state: GameState) {
  // Store starting positions
  for (const op of state.operators) {
    op.startPosition = { x: op.position.x, y: op.position.y };
    op.startAngle = op.angle;
  }

  resetSimulation(state);
  state.mode = 'executing';

  // Auto-trigger go code A after a brief delay (operators start moving)
  // Actually, trigger all go codes that have no associated holds
  // For simplicity, trigger A immediately
  state.goCodesTriggered.A = true;
}
