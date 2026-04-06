/**
 * Core game state mutations: doGo, doReset, saveStage, editStage, doClearLevel, etc.
 * These are the pure state‐manipulation functions that both local input
 * and (future) network messages will call.
 */
import type { GameState, Operator, Stage, GoCode, Room } from '../types';
import type { Vec2 } from '../math/vec2';
import { rebuildPathLUT } from '../operator/pathFollower';
import { resetOperator } from '../operator/operator';
import { bakePieDirection } from './radialMenu';

// ---- Helpers ----

/** Reset all threats across all floors */
export function resetAllThreats(state: GameState) {
  for (const t of state.room.threats) { t.neutralized = false; t.neutralizeTimer = 0; }
  if (state.room.floors) {
    for (const fl of state.room.floors) {
      for (const t of fl.threats) { t.neutralized = false; t.neutralizeTimer = 0; }
    }
  }
}

/** Clear UI overlays from state */
export function clearUIOverlays(state: GameState) {
  state.popup = null;
  state.radialMenu = null;
  state.pendingNode = null;
  state.speedSlider = null;
}

/** Reset an operator's movement state (but keep position/path) */
export function resetOperatorMovement(op: Operator) {
  op.distanceTraveled = 0;
  op.currentWaypointIndex = 0;
  op.isHolding = false;
  op.isMoving = false;
  op.reachedEnd = false;
}

// ---- Stage Management ----

/** Load a stage's paths onto operators and start executing */
export function loadAndExecuteStage(state: GameState, stageIdx: number) {
  const stage = state.stages[stageIdx];
  if (!stage) return;

  state.executingStageIndex = stageIdx;
  state.elapsedTime = 0;
  state.goCodesTriggered = { A: false, B: false, C: false };

  for (const op of state.operators) {
    if (!op.deployed) continue;
    const snap = stage.operatorStates.find(s => s.opId === op.id);
    if (snap) {
      op.position = { x: snap.startPosition.x, y: snap.startPosition.y };
      op.startPosition = { x: snap.startPosition.x, y: snap.startPosition.y };
      op.angle = snap.startAngle;
      op.startAngle = snap.startAngle;
      op.path.waypoints = JSON.parse(JSON.stringify(snap.waypoints));
      op.tempo = snap.tempo;
      op.pieTarget = snap.pieTarget ? { x: snap.pieTarget.x, y: snap.pieTarget.y } : null;
      op.currentFloor = snap.startFloor ?? 0;
      op.startFloor = snap.startFloor ?? 0;
    } else {
      op.path.waypoints = [];
      op.path.splineLUT = null;
      op.pieTarget = null;
    }
    resetOperatorMovement(op);
    if (op.smoothPosition) op.smoothPosition = { x: op.position.x, y: op.position.y };
    rebuildPathLUT(op);
  }

  state.mode = 'executing';
  state.goCodesTriggered.A = true;
}

/** Check if current stage is done and advance to next */
export function checkStageCompletion(state: GameState) {
  if (state.mode !== 'executing' || state.executingStageIndex < 0) return;
  const allDone = state.operators.every(
    o => !o.deployed || o.reachedEnd || o.path.waypoints.length === 0
  );
  if (!allDone) return;

  const nextStage = state.executingStageIndex + 1;
  if (nextStage < state.stages.length) {
    const endAngles: Record<number, number> = {};
    for (const op of state.operators) {
      if (op.deployed) endAngles[op.id] = op.angle;
    }
    loadAndExecuteStage(state, nextStage);
    for (const op of state.operators) {
      if (op.deployed && endAngles[op.id] !== undefined) {
        op.angle = endAngles[op.id];
      }
    }
  } else {
    state.mode = 'paused';
    state.stageJustCompleted = true;
  }
}

/** Edit a previously saved stage: reset to its start, delete it and all future stages */
export function editStage(state: GameState) {
  const idx = state.viewingStageIndex;
  if (idx < 0 || idx >= state.stages.length) return;
  if (state.mode !== 'planning') return;

  const targetStage = state.stages[idx];

  for (const snap of targetStage.operatorStates) {
    const op = state.operators.find(o => o.id === snap.opId);
    if (!op) continue;
    op.position = { x: snap.startPosition.x, y: snap.startPosition.y };
    op.startPosition = { x: snap.startPosition.x, y: snap.startPosition.y };
    op.angle = snap.startAngle;
    op.startAngle = snap.startAngle;
    op.path.waypoints = [];
    op.path.splineLUT = null;
    op.pieTarget = null;
    resetOperatorMovement(op);
    if (op.smoothPosition) op.smoothPosition = { x: op.position.x, y: op.position.y };
  }

  state.stages.splice(idx);
  state.currentStageIndex = state.stages.length;
  state.viewingStageIndex = -1;
  state.preGoSnapshot = null;
  state.executingStageIndex = -1;
  state.isReplaying = false;
  state.stageJustCompleted = false;

  clearUIOverlays(state);
  state.selectedOpId = null;
  state.interaction = { type: 'idle' };
}

/** Save current paths as a stage, then prepare for next stage planning */
export function saveStage(state: GameState) {
  // Case 1: After execution just completed (stageJustCompleted glow prompt)
  if (state.stageJustCompleted) {
    state.stageJustCompleted = false;
    state.preGoSnapshot = null;
    state.mode = 'planning';
    state.currentStageIndex = state.stages.length;
    state.executingStageIndex = -1;
    for (const op of state.operators) {
      if (!op.deployed) continue;
      op.startPosition = { x: op.position.x, y: op.position.y };
      op.startAngle = op.angle;
      op.path.waypoints = [];
      op.path.splineLUT = null;
      op.pieTarget = null;
      resetOperatorMovement(op);
    }
    clearUIOverlays(state);
    state.selectedOpId = null;
    state.interaction = { type: 'idle' };
    return;
  }

  // Case 2: Normal save during planning
  if (state.mode !== 'planning') return;
  const deployed = state.operators.filter(o => o.deployed);
  if (deployed.length === 0) return;
  if (!deployed.some(o => o.path.waypoints.length >= 2)) return;

  for (const op of deployed) bakePieDirection(op);

  const stage: Stage = {
    operatorStates: deployed.map(op => ({
      opId: op.id,
      startPosition: { x: op.position.x, y: op.position.y },
      startAngle: op.angle,
      waypoints: JSON.parse(JSON.stringify(op.path.waypoints)),
      tempo: op.tempo,
      pieTarget: op.pieTarget ? { x: op.pieTarget.x, y: op.pieTarget.y } : null,
      startFloor: op.currentFloor,
    })),
  };
  state.stages.push(stage);
  state.currentStageIndex = state.stages.length;

  for (const op of deployed) {
    if (op.path.waypoints.length >= 2) {
      const lastWp = op.path.waypoints[op.path.waypoints.length - 1];
      const endPos = { x: lastWp.position.x, y: lastWp.position.y };
      op.position = { x: endPos.x, y: endPos.y };
      op.startPosition = { x: endPos.x, y: endPos.y };
      op.currentFloor = lastWp.floorLevel;
      op.startFloor = lastWp.floorLevel;
      if (lastWp.facingOverride !== null) {
        op.angle = lastWp.facingOverride;
      } else if (op.pieTarget) {
        const dx = op.pieTarget.x - endPos.x, dy = op.pieTarget.y - endPos.y;
        if (dx * dx + dy * dy > 1) op.angle = Math.atan2(dy, dx);
      }
      op.startAngle = op.angle;
    }
    op.path.waypoints = [];
    op.path.splineLUT = null;
    op.pieTarget = null;
  }

  clearUIOverlays(state);
  state.selectedOpId = null;
  state.interaction = { type: 'idle' };
}

/** Execute: save current paths as a temporary stage, snapshot pre-GO state, then run all stages */
export function doGo(state: GameState) {
  if (state.mode !== 'planning') return;
  const deployed = state.operators.filter(o => o.deployed);
  if (deployed.length === 0) return;
  if (!deployed.some(o => o.path.waypoints.length >= 2) && state.stages.length === 0) return;

  for (const op of deployed) bakePieDirection(op);

  // Save pre-GO snapshot so RESET can return to this exact state
  state.preGoSnapshot = {
    operatorStates: deployed.map(op => ({
      opId: op.id,
      startPosition: { x: op.position.x, y: op.position.y },
      startAngle: op.angle,
      waypoints: JSON.parse(JSON.stringify(op.path.waypoints)),
      tempo: op.tempo,
      pieTarget: op.pieTarget ? { x: op.pieTarget.x, y: op.pieTarget.y } : null,
      startFloor: op.currentFloor,
    })),
  };

  // Auto-save current paths as a stage if there are any
  if (deployed.some(o => o.path.waypoints.length >= 2)) {
    const stage: Stage = {
      operatorStates: deployed.map(op => ({
        opId: op.id,
        startPosition: { x: op.position.x, y: op.position.y },
        startAngle: op.angle,
        waypoints: JSON.parse(JSON.stringify(op.path.waypoints)),
        tempo: op.tempo,
        pieTarget: op.pieTarget ? { x: op.pieTarget.x, y: op.pieTarget.y } : null,
        startFloor: op.currentFloor,
      })),
    };
    state.stages.push(stage);
  }

  if (state.stages.length === 0) return;

  clearUIOverlays(state);
  state.interaction = { type: 'idle' };
  state.stageJustCompleted = false;
  state.viewingStageIndex = -1;

  // Start executing from stage 0
  state.executingStageIndex = 0;
  state.isReplaying = false;
  loadAndExecuteStage(state, 0);
}

/** Replay all stages from the beginning */
export function doReplay(state: GameState) {
  if (state.stages.length === 0) return;
  state.isReplaying = true;
  state.roomCleared = false;
  resetAllThreats(state);
  loadAndExecuteStage(state, 0);
}

/** Reset returns to pre-GO state with routes intact (if GO was pressed),
 *  or to initial state if no GO snapshot exists */
export function doReset(state: GameState) {
  state.mode = 'planning';
  state.elapsedTime = 0;
  state.roomCleared = false;
  state.goCodesTriggered = { A: false, B: false, C: false };
  clearUIOverlays(state);
  state.interaction = { type: 'idle' };
  state.executingStageIndex = -1;
  state.isReplaying = false;
  state.stageJustCompleted = false;

  if (state.preGoSnapshot) {
    state.stages.pop();
    state.currentStageIndex = state.stages.length;

    for (const snap of state.preGoSnapshot.operatorStates) {
      const op = state.operators.find(o => o.id === snap.opId);
      if (!op) continue;
      op.position = { x: snap.startPosition.x, y: snap.startPosition.y };
      op.startPosition = { x: snap.startPosition.x, y: snap.startPosition.y };
      op.angle = snap.startAngle;
      op.startAngle = snap.startAngle;
      op.path.waypoints = JSON.parse(JSON.stringify(snap.waypoints));
      op.tempo = snap.tempo;
      op.pieTarget = snap.pieTarget ? { x: snap.pieTarget.x, y: snap.pieTarget.y } : null;
      op.currentFloor = snap.startFloor ?? 0;
      op.startFloor = snap.startFloor ?? 0;
      resetOperatorMovement(op);
      if (op.smoothPosition) op.smoothPosition = { x: op.position.x, y: op.position.y };
      rebuildPathLUT(op);
    }
    state.preGoSnapshot = null;
  } else {
    for (const op of state.operators) {
      if (op.deployed) resetOperator(op);
      op.pieTarget = null;
      op.path.waypoints = [];
      op.path.splineLUT = null;
      resetOperatorMovement(op);
    }
    state.stages = [];
    state.currentStageIndex = 0;
  }
  resetAllThreats(state);
}

/** Clear everything - operators, paths, stages, back to fresh deployment */
export function doClearLevel(state: GameState) {
  state.mode = 'planning';
  state.elapsedTime = 0;
  state.roomCleared = false;
  state.goCodesTriggered = { A: false, B: false, C: false };
  clearUIOverlays(state);
  state.interaction = { type: 'idle' };
  state.executingStageIndex = -1;
  state.isReplaying = false;
  state.stageJustCompleted = false;
  state.preGoSnapshot = null;
  state.viewingStageIndex = -1;
  state.stages = [];
  state.currentStageIndex = 0;
  state.selectedOpId = null;
  for (const op of state.operators) {
    op.deployed = false;
    op.position = { x: 0, y: 0 };
    op.startPosition = { x: 0, y: 0 };
    op.angle = 0;
    op.startAngle = 0;
    op.path.waypoints = [];
    op.path.splineLUT = null;
    op.pieTarget = null;
    resetOperatorMovement(op);
  }
  resetAllThreats(state);
}

/** Delete a selected waypoint from the popup */
export function deleteSelected(state: GameState) {
  if (!state.popup || state.popup.wpIdx < 0) return;
  const op = state.operators.find(o => o.id === state.popup!.opId);
  if (!op || op.path.waypoints.length <= 2) return;
  op.path.waypoints.splice(state.popup.wpIdx, 1);
  rebuildPathLUT(op);
  state.popup = null;
}
