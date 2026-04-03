import type { GameState } from '../types';
import { GRID_SIZE, WALL_THICKNESS, SNAP_DISTANCE, DOOR_WIDTH } from '../types';
import type { InputState } from '../core/inputManager';
import { makeWall, makeThreat } from './room';
import type { Vec2 } from '../math/vec2';
import { distance, distToSegment } from '../math/vec2';

let wallStart: Vec2 | null = null;

/** Snap a position to the grid */
export function snapToGrid(pos: Vec2): Vec2 {
  return {
    x: Math.round(pos.x / GRID_SIZE) * GRID_SIZE,
    y: Math.round(pos.y / GRID_SIZE) * GRID_SIZE,
  };
}

/** Handle wall drawing tool */
export function handleWallTool(state: GameState, input: InputState) {
  if (input.justPressed) {
    wallStart = snapToGrid(input.mousePos);
  }

  if (input.justReleased && wallStart) {
    const end = snapToGrid(input.mousePos);
    const len = distance(wallStart, end);
    if (len > GRID_SIZE) {
      state.room.walls.push(makeWall(wallStart.x, wallStart.y, end.x, end.y));
      updateFloorPolygon(state);
    }
    wallStart = null;
  }
}

/** Get the current wall preview (while drawing) */
export function getWallPreview(): { start: Vec2; end: Vec2 } | null {
  return wallStart ? { start: wallStart, end: wallStart } : null;
}

export function getWallStart(): Vec2 | null {
  return wallStart;
}

/** Handle door placement tool - click on a wall to add a door */
export function handleDoorTool(state: GameState, input: InputState) {
  if (input.justPressed) {
    // Find nearest wall segment
    let nearestIdx = -1;
    let nearestDist = Infinity;

    for (let i = 0; i < state.room.walls.length; i++) {
      const wall = state.room.walls[i];
      if (wall.hasDoor) continue; // already has door
      const d = distToSegment(input.mousePos, wall.a, wall.b);
      if (d < nearestDist && d < SNAP_DISTANCE + WALL_THICKNESS) {
        nearestDist = d;
        nearestIdx = i;
      }
    }

    if (nearestIdx >= 0) {
      const wall = state.room.walls[nearestIdx];
      const len = distance(wall.a, wall.b);
      if (len >= DOOR_WIDTH + 20) {
        // Toggle door on this wall
        wall.hasDoor = true;
        wall.doorOpen = true;
      }
    }
  }
}

/** Handle threat placement tool */
export function handleThreatTool(state: GameState, input: InputState) {
  if (input.justPressed) {
    // Check if clicking on existing threat to remove it
    for (let i = state.room.threats.length - 1; i >= 0; i--) {
      if (distance(input.mousePos, state.room.threats[i].position) < 15) {
        state.room.threats.splice(i, 1);
        return;
      }
    }

    // Place new threat
    const snapped = snapToGrid(input.mousePos);
    state.room.threats.push(makeThreat(snapped.x, snapped.y));
  }
}

/** Recompute floor polygon from walls (simple bounding box approach) */
function updateFloorPolygon(state: GameState) {
  if (state.room.walls.length < 3) return;

  // Find bounding box of all wall endpoints
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const w of state.room.walls) {
    minX = Math.min(minX, w.a.x, w.b.x);
    minY = Math.min(minY, w.a.y, w.b.y);
    maxX = Math.max(maxX, w.a.x, w.b.x);
    maxY = Math.max(maxY, w.a.y, w.b.y);
  }

  state.room.floor = [
    { x: minX, y: minY },
    { x: maxX, y: minY },
    { x: maxX, y: maxY },
    { x: minX, y: maxY },
  ];
}
