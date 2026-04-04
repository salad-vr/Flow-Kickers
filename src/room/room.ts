import type { Room, WallSegment, ThreatMarker } from '../types';
import { DOOR_W } from '../types';
import type { Wall } from '../math/intersection';

export function makeWall(ax: number, ay: number, bx: number, by: number, hasDoor = false, doorPos = 0.5): WallSegment {
  return { a: { x: ax, y: ay }, b: { x: bx, y: by }, doors: hasDoor ? [{ pos: doorPos, open: false }] : [] };
}

export function makeThreat(x: number, y: number): ThreatMarker {
  return { position: { x, y }, neutralized: false, neutralizeTimer: 0 };
}

export function getWallsForCollision(room: Room): Wall[] {
  const walls: Wall[] = [];
  for (const seg of room.walls) {
    if (seg.doors.length === 0) {
      walls.push({ ax: seg.a.x, ay: seg.a.y, bx: seg.b.x, by: seg.b.y });
    } else {
      const dx = seg.b.x - seg.a.x, dy = seg.b.y - seg.a.y;
      const len = Math.sqrt(dx * dx + dy * dy);
      if (len < 1) continue;
      // Collect open door gaps as [start, end] fractions
      const gaps: [number, number][] = [];
      for (const d of seg.doors) {
        if (!d.open) continue; // closed doors block like walls
        const f = DOOR_W / len;
        gaps.push([d.pos - f / 2, d.pos + f / 2]);
      }
      if (gaps.length === 0) {
        walls.push({ ax: seg.a.x, ay: seg.a.y, bx: seg.b.x, by: seg.b.y });
        continue;
      }
      // Sort gaps and build solid wall segments between them
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

export function createEmptyRoom(): Room {
  return { walls: [], threats: [], floor: [], name: 'Custom Room', entryPoints: [], objects: [], floorCut: [] };
}
