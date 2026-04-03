import type { Room, WallSegment, ThreatMarker } from '../types';
import type { Vec2 } from '../math/vec2';
import { DOOR_WIDTH } from '../types';
import type { Wall } from '../math/intersection';

/** Create a wall segment */
export function makeWall(ax: number, ay: number, bx: number, by: number, hasDoor = false): WallSegment {
  return {
    a: { x: ax, y: ay },
    b: { x: bx, y: by },
    hasDoor,
    doorOpen: false,
  };
}

/** Create a threat marker */
export function makeThreat(x: number, y: number): ThreatMarker {
  return {
    position: { x, y },
    neutralized: false,
    neutralizeTimer: 0,
  };
}

/** Convert room walls to intersection-friendly format (expanding doors into gaps) */
export function getWallsForCollision(room: Room): Wall[] {
  const walls: Wall[] = [];
  for (const seg of room.walls) {
    if (seg.hasDoor && !seg.doorOpen) {
      // Door is closed - treat as full wall
      walls.push({ ax: seg.a.x, ay: seg.a.y, bx: seg.b.x, by: seg.b.y });
    } else if (seg.hasDoor && seg.doorOpen) {
      // Door is open - split wall into two segments with a gap
      const dx = seg.b.x - seg.a.x;
      const dy = seg.b.y - seg.a.y;
      const len = Math.sqrt(dx * dx + dy * dy);
      if (len < DOOR_WIDTH) continue; // wall too short for door
      const doorFraction = DOOR_WIDTH / len;
      const gapStart = 0.5 - doorFraction / 2;
      const gapEnd = 0.5 + doorFraction / 2;

      // Left portion
      if (gapStart > 0.01) {
        walls.push({
          ax: seg.a.x, ay: seg.a.y,
          bx: seg.a.x + dx * gapStart, by: seg.a.y + dy * gapStart,
        });
      }
      // Right portion
      if (gapEnd < 0.99) {
        walls.push({
          ax: seg.a.x + dx * gapEnd, ay: seg.a.y + dy * gapEnd,
          bx: seg.b.x, by: seg.b.y,
        });
      }
    } else {
      // Normal wall
      walls.push({ ax: seg.a.x, ay: seg.a.y, bx: seg.b.x, by: seg.b.y });
    }
  }
  return walls;
}

/** Get door center position for a wall segment with a door */
export function getDoorCenter(seg: WallSegment): Vec2 {
  return {
    x: (seg.a.x + seg.b.x) / 2,
    y: (seg.a.y + seg.b.y) / 2,
  };
}

/** Create an empty room */
export function createEmptyRoom(): Room {
  return {
    walls: [],
    threats: [],
    floor: [],
    name: 'Custom Room',
    entryPoints: [],
  };
}

/** Get entry points - positions just outside doors */
export function computeEntryPoints(room: Room): Vec2[] {
  const points: Vec2[] = [];
  for (const wall of room.walls) {
    if (wall.hasDoor) {
      const center = getDoorCenter(wall);
      const dx = wall.b.x - wall.a.x;
      const dy = wall.b.y - wall.a.y;
      const len = Math.sqrt(dx * dx + dy * dy);
      if (len < 1) continue;
      // Normal to the wall (perpendicular)
      const nx = -dy / len;
      const ny = dx / len;
      // Two sides of the door
      points.push({ x: center.x + nx * 30, y: center.y + ny * 30 });
      points.push({ x: center.x - nx * 30, y: center.y - ny * 30 });
    }
  }
  return points;
}
