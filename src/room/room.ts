import type { Room, WallSegment, ThreatMarker } from '../types';
import { DOOR_W } from '../types';
import type { Wall } from '../math/intersection';

export function makeWall(ax: number, ay: number, bx: number, by: number, hasDoor = false): WallSegment {
  return { a: { x: ax, y: ay }, b: { x: bx, y: by }, hasDoor, doorOpen: false };
}

export function makeThreat(x: number, y: number): ThreatMarker {
  return { position: { x, y }, neutralized: false, neutralizeTimer: 0 };
}

export function getWallsForCollision(room: Room): Wall[] {
  const walls: Wall[] = [];
  for (const seg of room.walls) {
    if (seg.hasDoor && !seg.doorOpen) {
      walls.push({ ax: seg.a.x, ay: seg.a.y, bx: seg.b.x, by: seg.b.y });
    } else if (seg.hasDoor && seg.doorOpen) {
      const dx = seg.b.x - seg.a.x, dy = seg.b.y - seg.a.y;
      const len = Math.sqrt(dx * dx + dy * dy);
      if (len < DOOR_W) continue;
      const f = DOOR_W / len, gs = 0.5 - f / 2, ge = 0.5 + f / 2;
      if (gs > 0.01) walls.push({ ax: seg.a.x, ay: seg.a.y, bx: seg.a.x + dx * gs, by: seg.a.y + dy * gs });
      if (ge < 0.99) walls.push({ ax: seg.a.x + dx * ge, ay: seg.a.y + dy * ge, bx: seg.b.x, by: seg.b.y });
    } else {
      walls.push({ ax: seg.a.x, ay: seg.a.y, bx: seg.b.x, by: seg.b.y });
    }
  }
  return walls;
}

export function createEmptyRoom(): Room {
  return { walls: [], threats: [], floor: [], name: 'Custom Room' };
}
