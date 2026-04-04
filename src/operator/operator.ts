import type { Operator, WaypointPath } from '../types';
import { OP_SPEED, FOV_ANG, FOV_DIST, C } from '../types';

let nextId = 1;

export function createOperator(colorIndex: number): Operator {
  const color = C.opColors[colorIndex % C.opColors.length];
  const id = nextId++;
  const emptyPath: WaypointPath = { waypoints: [], splineLUT: null, color };
  return {
    id, position: { x: 0, y: 0 }, angle: 0, // facing right
    speed: OP_SPEED, fovAngle: FOV_ANG, fovRange: FOV_DIST,
    color, label: String(id), path: emptyPath, tempo: 1, deployed: false,
    distanceTraveled: 0, currentWaypointIndex: 0,
    isHolding: false, isMoving: false, reachedEnd: false,
    startPosition: { x: 0, y: 0 }, startAngle: 0,
    pieTarget: null,
    smoothPosition: { x: 0, y: 0 },
  };
}

export function resetOperator(op: Operator) {
  op.position = { x: op.startPosition.x, y: op.startPosition.y };
  op.smoothPosition = { x: op.startPosition.x, y: op.startPosition.y };
  op.angle = op.startAngle;
  op.distanceTraveled = 0; op.currentWaypointIndex = 0;
  op.isHolding = false; op.isMoving = false; op.reachedEnd = false;
}

export function createDeployedOperator(pos: { x: number; y: number }, colorIndex: number): Operator {
  const op = createOperator(colorIndex);
  op.position = { x: pos.x, y: pos.y };
  op.smoothPosition = { x: pos.x, y: pos.y };
  op.startPosition = { x: pos.x, y: pos.y };
  op.deployed = true;
  return op;
}

export function resetOperatorId() { nextId = 1; }
