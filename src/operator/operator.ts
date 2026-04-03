import type { Operator, WaypointPath } from '../types';
import { OPERATOR_SPEED, FOV_ANGLE, FOV_RANGE, COLORS } from '../types';
import type { Vec2 } from '../math/vec2';

let nextId = 1;

export function createOperator(position: Vec2, angle: number, colorIndex: number): Operator {
  const color = COLORS.operatorColors[colorIndex % COLORS.operatorColors.length];
  const id = nextId++;

  const emptyPath: WaypointPath = {
    waypoints: [],
    splineLUT: null,
    color,
  };

  return {
    id,
    position: { x: position.x, y: position.y },
    angle,
    speed: OPERATOR_SPEED,
    fovAngle: FOV_ANGLE,
    fovRange: FOV_RANGE,
    color,
    label: String(id),
    path: emptyPath,
    distanceTraveled: 0,
    currentWaypointIndex: 0,
    isHolding: false,
    isMoving: false,
    reachedEnd: false,
    startPosition: { x: position.x, y: position.y },
    startAngle: angle,
  };
}

export function resetOperator(op: Operator) {
  op.position = { x: op.startPosition.x, y: op.startPosition.y };
  op.angle = op.startAngle;
  op.distanceTraveled = 0;
  op.currentWaypointIndex = 0;
  op.isHolding = false;
  op.isMoving = false;
  op.reachedEnd = false;
}

export function resetOperatorId() {
  nextId = 1;
}
