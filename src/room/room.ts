import type { Room, WallSegment, ThreatMarker, FloorLayer } from '../types';
import { DOOR_W } from '../types';
import type { Wall } from '../math/intersection';

export function makeWall(ax: number, ay: number, bx: number, by: number, hasDoor = false, doorPos = 0.5): WallSegment {
  return { a: { x: ax, y: ay }, b: { x: bx, y: by }, doors: hasDoor ? [{ pos: doorPos, open: false }] : [] };
}

export function makeThreat(x: number, y: number): ThreatMarker {
  return { position: { x, y }, neutralized: false, neutralizeTimer: 0 };
}

/** Convert wall segments (with door gaps) into simple collision walls */
function wallSegmentsToCollision(segments: WallSegment[]): Wall[] {
  const walls: Wall[] = [];
  for (const seg of segments) {
    if (seg.doors.length === 0) {
      walls.push({ ax: seg.a.x, ay: seg.a.y, bx: seg.b.x, by: seg.b.y });
    } else {
      const dx = seg.b.x - seg.a.x, dy = seg.b.y - seg.a.y;
      const len = Math.sqrt(dx * dx + dy * dy);
      if (len < 1) continue;
      const gaps: [number, number][] = [];
      for (const d of seg.doors) {
        if (!d.open) continue;
        const f = DOOR_W / len;
        gaps.push([d.pos - f / 2, d.pos + f / 2]);
      }
      if (gaps.length === 0) {
        walls.push({ ax: seg.a.x, ay: seg.a.y, bx: seg.b.x, by: seg.b.y });
        continue;
      }
      gaps.sort((a, b) => a[0] - b[0]);
      let cursor = 0;
      for (const [gs, ge] of gaps) {
        if (gs > cursor + 0.01) {
          walls.push({ ax: seg.a.x + dx * cursor, ay: seg.a.y + dy * cursor, bx: seg.a.x + dx * gs, by: seg.a.y + dy * gs });
        }
        cursor = ge;
      }
      if (cursor < 0.99) {
        walls.push({ ax: seg.a.x + dx * cursor, ay: seg.a.y + dy * cursor, bx: seg.b.x, by: seg.b.y });
      }
    }
  }
  return walls;
}

/** Get collision walls for a specific floor level (0 = ground) */
export function getWallsForCollision(room: Room, floorLevel = 0): Wall[] {
  if (floorLevel === 0) {
    return wallSegmentsToCollision(room.walls);
  }
  const fl = room.floors?.find(f => f.level === floorLevel);
  if (!fl) return [];
  return wallSegmentsToCollision(fl.walls);
}

/** Get walls, threats, objects, floor, and floorCut for a given floor level.
 *  Connected stairs are included on every floor they connect to. */
export function getFloorData(room: Room, floorLevel: number): {
  walls: WallSegment[]; threats: ThreatMarker[]; objects: import('../types').RoomObject[];
  floor: import('../math/vec2').Vec2[]; floorCut: import('../math/vec2').Vec2[];
} {
  let baseObjects: import('../types').RoomObject[];
  let walls: WallSegment[];
  let threats: ThreatMarker[];
  let floor: import('../math/vec2').Vec2[];
  let floorCut: import('../math/vec2').Vec2[];

  if (floorLevel === 0) {
    baseObjects = room.objects;
    walls = room.walls; threats = room.threats; floor = room.floor; floorCut = room.floorCut;
  } else {
    const fl = room.floors?.find(f => f.level === floorLevel);
    if (!fl) return { walls: [], threats: [], objects: [], floor: [], floorCut: [] };
    baseObjects = fl.objects;
    walls = fl.walls; threats = fl.threats; floor = fl.floor; floorCut = fl.floorCut;
  }

  // Collect connected stairs from OTHER floors that also connect to this floor
  const extraStairs: import('../types').RoomObject[] = [];
  // Check ground floor objects (if we're not on ground floor)
  if (floorLevel !== 0) {
    for (const obj of room.objects) {
      if (obj.type === 'stairs' && obj.connectsFloors &&
          (obj.connectsFloors[0] === floorLevel || obj.connectsFloors[1] === floorLevel)) {
        // Only add if not already in baseObjects
        if (!baseObjects.includes(obj)) extraStairs.push(obj);
      }
    }
  }
  // Check other floor layers
  if (room.floors) {
    for (const fl of room.floors) {
      if (fl.level === floorLevel) continue;
      for (const obj of fl.objects) {
        if (obj.type === 'stairs' && obj.connectsFloors &&
            (obj.connectsFloors[0] === floorLevel || obj.connectsFloors[1] === floorLevel)) {
          if (!baseObjects.includes(obj)) extraStairs.push(obj);
        }
      }
    }
  }

  const objects = extraStairs.length > 0 ? [...baseObjects, ...extraStairs] : baseObjects;
  return { walls, threats, objects, floor, floorCut };
}

/** Get the maximum floor level in a room */
export function getMaxFloorLevel(room: Room): number {
  if (!room.floors || room.floors.length === 0) return 0;
  return Math.max(0, ...room.floors.map(f => f.level));
}

/** Get all threats across all floors */
export function getAllThreats(room: Room): ThreatMarker[] {
  const all = [...room.threats];
  if (room.floors) {
    for (const fl of room.floors) all.push(...fl.threats);
  }
  return all;
}

/** Check if a point is on a staircase that connects to a given floor */
export function getStairAtPoint(room: Room, x: number, y: number, fromFloor: number): import('../types').RoomObject | null {
  // Check ground floor objects
  const allObjects = [...room.objects];
  if (room.floors) {
    for (const fl of room.floors) allObjects.push(...fl.objects);
  }
  for (const obj of allObjects) {
    if (obj.type !== 'stairs') continue;
    if (x >= obj.x && x <= obj.x + obj.w && y >= obj.y && y <= obj.y + obj.h) {
      if (obj.connectsFloors && (obj.connectsFloors[0] === fromFloor || obj.connectsFloors[1] === fromFloor)) {
        return obj;
      }
    }
  }
  return null;
}

/** Get the destination floor when using stairs from a given floor */
export function getStairDestFloor(stair: import('../types').RoomObject, fromFloor: number): number {
  if (!stair.connectsFloors) return fromFloor;
  return stair.connectsFloors[0] === fromFloor ? stair.connectsFloors[1] : stair.connectsFloors[0];
}

export function createEmptyRoom(): Room {
  return { walls: [], threats: [], floor: [], name: 'Custom Room', entryPoints: [], objects: [], floorCut: [], floors: [] };
}
