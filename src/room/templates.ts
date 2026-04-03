import type { Room } from '../types';
import { makeWall, makeThreat } from './room';

const CX = 500; // canvas center x
const CY = 350; // canvas center y

/**
 * Corner-fed room: door is near a corner.
 * Operators enter along the wall and sweep diagonally.
 */
export function cornerFedRoom(): Room {
  const x = CX - 150;
  const y = CY - 120;
  const w = 300;
  const h = 240;

  return {
    name: 'Corner Fed',
    walls: [
      // Top wall
      makeWall(x, y, x + w, y),
      // Right wall
      makeWall(x + w, y, x + w, y + h),
      // Bottom wall - door near left corner
      makeWall(x, y + h, x + 60, y + h), // left of door
      makeWall(x + 100, y + h, x + w, y + h, false), // right of door
      makeWall(x + 60, y + h, x + 100, y + h, true), // door segment
      // Left wall
      makeWall(x, y, x, y + h),
    ],
    threats: [
      makeThreat(x + w - 50, y + 50),
      makeThreat(x + w - 60, y + h - 60),
      makeThreat(x + 100, y + 60),
    ],
    floor: [
      { x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h },
    ],
    entryPoints: [
      { x: x + 40, y: y + h + 30 },
      { x: x + 120, y: y + h + 30 },
    ],
  };
}

/**
 * Center-fed room: door is in the middle of a wall.
 * Operators split left/right on entry.
 */
export function centerFedRoom(): Room {
  const x = CX - 160;
  const y = CY - 120;
  const w = 320;
  const h = 240;

  return {
    name: 'Center Fed',
    walls: [
      // Top wall
      makeWall(x, y, x + w, y),
      // Right wall
      makeWall(x + w, y, x + w, y + h),
      // Bottom wall - door in center
      makeWall(x, y + h, x + w / 2 - 20, y + h),
      makeWall(x + w / 2 + 20, y + h, x + w, y + h),
      makeWall(x + w / 2 - 20, y + h, x + w / 2 + 20, y + h, true), // door
      // Left wall
      makeWall(x, y, x, y + h),
    ],
    threats: [
      makeThreat(x + 50, y + 50),
      makeThreat(x + w - 50, y + 50),
      makeThreat(x + w / 2, y + 80),
    ],
    floor: [
      { x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h },
    ],
    entryPoints: [
      { x: x + w / 2 - 30, y: y + h + 30 },
      { x: x + w / 2 + 30, y: y + h + 30 },
    ],
  };
}

/**
 * L-shaped room: two connected rectangles forming an L.
 * Complex geometry requiring careful angle clearing.
 */
export function lShapeRoom(): Room {
  const x = CX - 180;
  const y = CY - 140;

  // L-shape: main rect + extension to the right
  // Main: 200x280, Extension: 160x140 on the top-right
  return {
    name: 'L-Shape',
    walls: [
      // Main room - left wall
      makeWall(x, y, x, y + 280),
      // Main room - bottom wall with door
      makeWall(x, y + 280, x + 80, y + 280),
      makeWall(x + 120, y + 280, x + 200, y + 280),
      makeWall(x + 80, y + 280, x + 120, y + 280, true), // door
      // Main room - right wall (partial - up to extension)
      makeWall(x + 200, y + 140, x + 200, y + 280),
      // Extension - bottom wall (connects main to extension)
      makeWall(x + 200, y + 140, x + 360, y + 140),
      // Extension - right wall
      makeWall(x + 360, y, x + 360, y + 140),
      // Extension - top wall
      makeWall(x + 200, y, x + 360, y),
      // Main - top wall
      makeWall(x, y, x + 200, y),
    ],
    threats: [
      makeThreat(x + 50, y + 60),
      makeThreat(x + 280, y + 70),
      makeThreat(x + 320, y + 110),
      makeThreat(x + 160, y + 200),
    ],
    floor: [
      { x, y },
      { x: x + 360, y },
      { x: x + 360, y: y + 140 },
      { x: x + 200, y: y + 140 },
      { x: x + 200, y: y + 280 },
      { x, y: y + 280 },
    ],
    entryPoints: [
      { x: x + 80, y: y + 280 + 30 },
      { x: x + 120, y: y + 280 + 30 },
    ],
  };
}

/**
 * T-shaped room: main corridor with a perpendicular branch.
 */
export function tShapeRoom(): Room {
  const x = CX - 200;
  const y = CY - 100;

  return {
    name: 'T-Shape',
    walls: [
      // Horizontal corridor (top portion)
      makeWall(x, y, x + 400, y), // top
      makeWall(x, y, x, y + 100), // left end
      makeWall(x, y + 100, x + 150, y + 100), // bottom-left
      makeWall(x + 250, y + 100, x + 400, y + 100), // bottom-right
      makeWall(x + 400, y, x + 400, y + 100), // right end

      // Vertical branch downward
      makeWall(x + 150, y + 100, x + 150, y + 260),
      makeWall(x + 250, y + 100, x + 250, y + 260),
      // Bottom with door
      makeWall(x + 150, y + 260, x + 180, y + 260),
      makeWall(x + 220, y + 260, x + 250, y + 260),
      makeWall(x + 180, y + 260, x + 220, y + 260, true), // door
    ],
    threats: [
      makeThreat(x + 60, y + 50),
      makeThreat(x + 340, y + 50),
      makeThreat(x + 200, y + 50),
      makeThreat(x + 200, y + 180),
    ],
    floor: [
      { x, y },
      { x: x + 400, y },
      { x: x + 400, y: y + 100 },
      { x: x + 250, y: y + 100 },
      { x: x + 250, y: y + 260 },
      { x: x + 150, y: y + 260 },
      { x: x + 150, y: y + 100 },
      { x, y: y + 100 },
    ],
    entryPoints: [
      { x: x + 180, y: y + 260 + 30 },
      { x: x + 220, y: y + 260 + 30 },
    ],
  };
}

/** Small square room for testing */
export function simpleRoom(): Room {
  const x = CX - 120;
  const y = CY - 100;
  const w = 240;
  const h = 200;

  return {
    name: 'Simple Box',
    walls: [
      makeWall(x, y, x + w, y),
      makeWall(x + w, y, x + w, y + h),
      makeWall(x, y + h, x + w / 2 - 20, y + h),
      makeWall(x + w / 2 + 20, y + h, x + w, y + h),
      makeWall(x + w / 2 - 20, y + h, x + w / 2 + 20, y + h, true),
      makeWall(x, y, x, y + h),
    ],
    threats: [
      makeThreat(x + w / 2, y + 50),
    ],
    floor: [
      { x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h },
    ],
    entryPoints: [
      { x: x + w / 2, y: y + h + 30 },
    ],
  };
}

export const ROOM_TEMPLATES = {
  'Corner Fed': cornerFedRoom,
  'Center Fed': centerFedRoom,
  'L-Shape': lShapeRoom,
  'T-Shape': tShapeRoom,
  'Simple Box': simpleRoom,
} as const;

export type RoomTemplateName = keyof typeof ROOM_TEMPLATES;
