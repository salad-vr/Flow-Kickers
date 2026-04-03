import type { Room } from '../types';
import { makeWall } from './room';

const CX = 500, CY = 340;

export function cornerFedRoom(): Room {
  const x = CX - 150, y = CY - 120, w = 300, h = 240;
  return { name: 'Corner Fed', threats: [], walls: [
    makeWall(x, y, x + w, y), makeWall(x + w, y, x + w, y + h),
    makeWall(x, y + h, x + 60, y + h), makeWall(x + 100, y + h, x + w, y + h),
    makeWall(x + 60, y + h, x + 100, y + h, true), makeWall(x, y, x, y + h),
  ], floor: [{ x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h }], entryPoints: [{ x: x + 80, y: y + h + 40 }] };
}

export function centerFedRoom(): Room {
  const x = CX - 160, y = CY - 120, w = 320, h = 240;
  return { name: 'Center Fed', threats: [], walls: [
    makeWall(x, y, x + w, y), makeWall(x + w, y, x + w, y + h),
    makeWall(x, y + h, x + w / 2 - 20, y + h), makeWall(x + w / 2 + 20, y + h, x + w, y + h),
    makeWall(x + w / 2 - 20, y + h, x + w / 2 + 20, y + h, true), makeWall(x, y, x, y + h),
  ], floor: [{ x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h }], entryPoints: [{ x: x + w / 2, y: y + h + 40 }] };
}

export function lShapeRoom(): Room {
  const x = CX - 180, y = CY - 140;
  return { name: 'L-Shape', threats: [], walls: [
    makeWall(x, y, x, y + 280), makeWall(x, y + 280, x + 80, y + 280),
    makeWall(x + 120, y + 280, x + 200, y + 280), makeWall(x + 80, y + 280, x + 120, y + 280, true),
    makeWall(x + 200, y + 140, x + 200, y + 280), makeWall(x + 200, y + 140, x + 360, y + 140),
    makeWall(x + 360, y, x + 360, y + 140), makeWall(x + 200, y, x + 360, y), makeWall(x, y, x + 200, y),
  ], floor: [{ x, y },{ x: x+360, y },{ x: x+360, y: y+140 },{ x: x+200, y: y+140 },{ x: x+200, y: y+280 },{ x, y: y+280 }], entryPoints: [{ x: x + 100, y: y + 280 + 40 }] };
}

export function tShapeRoom(): Room {
  const x = CX - 200, y = CY - 100;
  return { name: 'T-Shape', threats: [], walls: [
    makeWall(x, y, x + 400, y), makeWall(x, y, x, y + 100),
    makeWall(x, y + 100, x + 150, y + 100), makeWall(x + 250, y + 100, x + 400, y + 100),
    makeWall(x + 400, y, x + 400, y + 100), makeWall(x + 150, y + 100, x + 150, y + 260),
    makeWall(x + 250, y + 100, x + 250, y + 260), makeWall(x + 150, y + 260, x + 180, y + 260),
    makeWall(x + 220, y + 260, x + 250, y + 260), makeWall(x + 180, y + 260, x + 220, y + 260, true),
  ], floor: [{ x, y },{ x: x+400, y },{ x: x+400, y: y+100 },{ x: x+250, y: y+100 },{ x: x+250, y: y+260 },{ x: x+150, y: y+260 },{ x: x+150, y: y+100 },{ x, y: y+100 }], entryPoints: [{ x: x + 200, y: y + 260 + 40 }] };
}

export function simpleRoom(): Room {
  const x = CX - 120, y = CY - 100, w = 240, h = 200;
  return { name: 'Simple Box', threats: [], walls: [
    makeWall(x, y, x + w, y), makeWall(x + w, y, x + w, y + h),
    makeWall(x, y + h, x + w / 2 - 20, y + h), makeWall(x + w / 2 + 20, y + h, x + w, y + h),
    makeWall(x + w / 2 - 20, y + h, x + w / 2 + 20, y + h, true), makeWall(x, y, x, y + h),
  ], floor: [{ x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h }], entryPoints: [{ x: x + w / 2, y: y + h + 40 }] };
}

export const ROOM_TEMPLATES = {
  'Corner Fed': cornerFedRoom, 'Center Fed': centerFedRoom,
  'L-Shape': lShapeRoom, 'T-Shape': tShapeRoom, 'Simple Box': simpleRoom,
} as const;
export type RoomTemplateName = keyof typeof ROOM_TEMPLATES;

// ---- Stamp templates: generate walls for an arbitrary bounding box ----
import type { WallSegment } from '../types';

/** Generate "Simple Box" walls fitted to the given rect */
function stampBox(x: number, y: number, w: number, h: number): WallSegment[] {
  return [
    makeWall(x, y, x + w, y), makeWall(x + w, y, x + w, y + h),
    makeWall(x + w, y + h, x, y + h), makeWall(x, y + h, x, y),
  ];
}

/** Generate "Corner Fed" walls: box with door gap in bottom-left area */
function stampCornerFed(x: number, y: number, w: number, h: number): WallSegment[] {
  const dw = Math.min(40, w * 0.15);
  const dpos = w * 0.25;
  return [
    makeWall(x, y, x + w, y), makeWall(x + w, y, x + w, y + h),
    makeWall(x, y + h, x + dpos - dw / 2, y + h),
    makeWall(x + dpos + dw / 2, y + h, x + w, y + h),
    makeWall(x + dpos - dw / 2, y + h, x + dpos + dw / 2, y + h, true, 0.5),
    makeWall(x, y, x, y + h),
  ];
}

/** Generate "Center Fed" walls: box with door gap centered on bottom */
function stampCenterFed(x: number, y: number, w: number, h: number): WallSegment[] {
  const dw = Math.min(40, w * 0.15);
  return [
    makeWall(x, y, x + w, y), makeWall(x + w, y, x + w, y + h),
    makeWall(x, y + h, x + w / 2 - dw / 2, y + h),
    makeWall(x + w / 2 + dw / 2, y + h, x + w, y + h),
    makeWall(x + w / 2 - dw / 2, y + h, x + w / 2 + dw / 2, y + h, true, 0.5),
    makeWall(x, y, x, y + h),
  ];
}

/** Generate "L-Shape" walls fitted to the given rect */
function stampLShape(x: number, y: number, w: number, h: number): WallSegment[] {
  const midX = x + w * 0.55;
  const midY = y + h * 0.5;
  const dw = Math.min(40, w * 0.12);
  const dpos = x + (midX - x) * 0.5;
  return [
    makeWall(x, y, x + w, y),                        // top full
    makeWall(x + w, y, x + w, midY),                  // right upper
    makeWall(x + w, midY, midX, midY),                 // inner horizontal
    makeWall(midX, midY, midX, y + h),                 // inner vertical
    makeWall(x, y + h, dpos - dw / 2, y + h),         // bottom left
    makeWall(dpos + dw / 2, y + h, midX, y + h),      // bottom right
    makeWall(dpos - dw / 2, y + h, dpos + dw / 2, y + h, true, 0.5), // door
    makeWall(x, y, x, y + h),                          // left
  ];
}

/** Generate "T-Shape" walls fitted to the given rect */
function stampTShape(x: number, y: number, w: number, h: number): WallSegment[] {
  const armY = y + h * 0.38;
  const stemL = x + w * 0.38;
  const stemR = x + w * 0.62;
  const dw = Math.min(40, w * 0.1);
  const dpos = (stemL + stemR) / 2;
  return [
    makeWall(x, y, x + w, y),                         // top
    makeWall(x, y, x, armY),                           // left side
    makeWall(x, armY, stemL, armY),                    // inner left
    makeWall(stemR, armY, x + w, armY),                // inner right
    makeWall(x + w, y, x + w, armY),                   // right side
    makeWall(stemL, armY, stemL, y + h),               // stem left
    makeWall(stemR, armY, stemR, y + h),               // stem right
    makeWall(stemL, y + h, dpos - dw / 2, y + h),     // bottom left
    makeWall(dpos + dw / 2, y + h, stemR, y + h),     // bottom right
    makeWall(dpos - dw / 2, y + h, dpos + dw / 2, y + h, true, 0.5), // door
  ];
}

export type StampName = 'Simple Box' | 'Corner Fed' | 'Center Fed' | 'L-Shape' | 'T-Shape';

export const STAMP_TEMPLATES: Record<StampName, (x: number, y: number, w: number, h: number) => WallSegment[]> = {
  'Simple Box': stampBox,
  'Corner Fed': stampCornerFed,
  'Center Fed': stampCenterFed,
  'L-Shape': stampLShape,
  'T-Shape': stampTShape,
};

export const STAMP_NAMES: StampName[] = ['Simple Box', 'Corner Fed', 'Center Fed', 'L-Shape', 'T-Shape'];
