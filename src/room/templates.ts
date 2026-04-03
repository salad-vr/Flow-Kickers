import type { Room } from '../types';
import { makeWall } from './room';

const CX = 500, CY = 340;

export function cornerFedRoom(): Room {
  const x = CX - 150, y = CY - 120, w = 300, h = 240;
  return { name: 'Corner Fed', threats: [], walls: [
    makeWall(x, y, x + w, y), makeWall(x + w, y, x + w, y + h),
    makeWall(x, y + h, x + 60, y + h), makeWall(x + 100, y + h, x + w, y + h),
    makeWall(x + 60, y + h, x + 100, y + h, true), makeWall(x, y, x, y + h),
  ], floor: [{ x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h }] };
}

export function centerFedRoom(): Room {
  const x = CX - 160, y = CY - 120, w = 320, h = 240;
  return { name: 'Center Fed', threats: [], walls: [
    makeWall(x, y, x + w, y), makeWall(x + w, y, x + w, y + h),
    makeWall(x, y + h, x + w / 2 - 20, y + h), makeWall(x + w / 2 + 20, y + h, x + w, y + h),
    makeWall(x + w / 2 - 20, y + h, x + w / 2 + 20, y + h, true), makeWall(x, y, x, y + h),
  ], floor: [{ x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h }] };
}

export function lShapeRoom(): Room {
  const x = CX - 180, y = CY - 140;
  return { name: 'L-Shape', threats: [], walls: [
    makeWall(x, y, x, y + 280), makeWall(x, y + 280, x + 80, y + 280),
    makeWall(x + 120, y + 280, x + 200, y + 280), makeWall(x + 80, y + 280, x + 120, y + 280, true),
    makeWall(x + 200, y + 140, x + 200, y + 280), makeWall(x + 200, y + 140, x + 360, y + 140),
    makeWall(x + 360, y, x + 360, y + 140), makeWall(x + 200, y, x + 360, y), makeWall(x, y, x + 200, y),
  ], floor: [{ x, y },{ x: x+360, y },{ x: x+360, y: y+140 },{ x: x+200, y: y+140 },{ x: x+200, y: y+280 },{ x, y: y+280 }] };
}

export function tShapeRoom(): Room {
  const x = CX - 200, y = CY - 100;
  return { name: 'T-Shape', threats: [], walls: [
    makeWall(x, y, x + 400, y), makeWall(x, y, x, y + 100),
    makeWall(x, y + 100, x + 150, y + 100), makeWall(x + 250, y + 100, x + 400, y + 100),
    makeWall(x + 400, y, x + 400, y + 100), makeWall(x + 150, y + 100, x + 150, y + 260),
    makeWall(x + 250, y + 100, x + 250, y + 260), makeWall(x + 150, y + 260, x + 180, y + 260),
    makeWall(x + 220, y + 260, x + 250, y + 260), makeWall(x + 180, y + 260, x + 220, y + 260, true),
  ], floor: [{ x, y },{ x: x+400, y },{ x: x+400, y: y+100 },{ x: x+250, y: y+100 },{ x: x+250, y: y+260 },{ x: x+150, y: y+260 },{ x: x+150, y: y+100 },{ x, y: y+100 }] };
}

export function simpleRoom(): Room {
  const x = CX - 120, y = CY - 100, w = 240, h = 200;
  return { name: 'Simple Box', threats: [], walls: [
    makeWall(x, y, x + w, y), makeWall(x + w, y, x + w, y + h),
    makeWall(x, y + h, x + w / 2 - 20, y + h), makeWall(x + w / 2 + 20, y + h, x + w, y + h),
    makeWall(x + w / 2 - 20, y + h, x + w / 2 + 20, y + h, true), makeWall(x, y, x, y + h),
  ], floor: [{ x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h }] };
}

export const ROOM_TEMPLATES = {
  'Corner Fed': cornerFedRoom, 'Center Fed': centerFedRoom,
  'L-Shape': lShapeRoom, 'T-Shape': tShapeRoom, 'Simple Box': simpleRoom,
} as const;
export type RoomTemplateName = keyof typeof ROOM_TEMPLATES;
