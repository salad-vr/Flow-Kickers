import type { GameState, GoCode } from '../types';
import { updatePathFollowing } from '../operator/pathFollower';
import { updateThreatEngagement, isRoomCleared } from '../operator/visibility';
import { getWallsForCollision } from '../room/room';
import { resetOperator } from '../operator/operator';

export function updateSimulation(state: GameState, dt: number) {
  state.elapsedTime += dt;
  for (const op of state.operators) {
    if (op.deployed) updatePathFollowing(op, dt, state);
  }
  const walls = getWallsForCollision(state.room);
  updateThreatEngagement(state.operators, state.room, walls, dt);
  if (!state.roomCleared && isRoomCleared(state.room)) state.roomCleared = true;
}

export function resetSimulation(state: GameState) {
  state.elapsedTime = 0;
  state.roomCleared = false;
  state.goCodesTriggered = { A: false, B: false, C: false };
  for (const op of state.operators) resetOperator(op);
  for (const t of state.room.threats) { t.neutralized = false; t.neutralizeTimer = 0; }
  for (const w of state.room.walls) for (const d of w.doors) d.open = true;
}

export function triggerGoCode(state: GameState, code: GoCode) { state.goCodesTriggered[code] = true; }

export function startExecution(state: GameState) {
  for (const op of state.operators) {
    if (op.deployed) { op.startPosition = { x: op.position.x, y: op.position.y }; op.startAngle = op.angle; }
  }
  resetSimulation(state);
  state.mode = 'executing';
  state.goCodesTriggered.A = true;
}
