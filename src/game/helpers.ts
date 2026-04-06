import type { Vec2 } from '../math/vec2';
import type { Camera } from '../types';
import { GRID } from '../types';

/** Convert screen-space mouse pos to world-space (accounting for camera pan/zoom) */
export function screenToWorld(screenPos: Vec2, camera: Camera, canvasWidth: number, canvasHeight: number): Vec2 {
  return {
    x: (screenPos.x - canvasWidth / 2) / camera.zoom + camera.x,
    y: (screenPos.y - canvasHeight / 2) / camera.zoom + camera.y,
  };
}

/** Simple rectangle hit test */
export function hitBtn(mouse: Vec2, x: number, y: number, w: number, h: number): boolean {
  return mouse.x >= x && mouse.x <= x + w && mouse.y >= y && mouse.y <= y + h;
}

export function snapGrid(v: number) { return Math.round(v / GRID) * GRID; }
export function snapVec(p: Vec2): Vec2 { return { x: snapGrid(p.x), y: snapGrid(p.y) }; }

export function snapAngle(start: Vec2, end: Vec2): Vec2 {
  const dx = end.x - start.x, dy = end.y - start.y;
  const len = Math.sqrt(dx * dx + dy * dy);
  if (len < 5) return end;
  const ang = Math.atan2(dy, dx);
  const SNAP = Math.PI / 12; // 15 degrees
  const snapped = Math.round(ang / SNAP) * SNAP;
  return { x: start.x + Math.cos(snapped) * len, y: start.y + Math.sin(snapped) * len };
}

/** Compute enclosed floor cells using ray-casting.
 *  For each grid cell, cast rays in 4 cardinal directions.
 *  A cell is "enclosed" if rays hit walls in at least 3 of 4 directions. */
export function computeFloorCells(walls: { a: Vec2; b: Vec2; doors: { pos: number; open: boolean }[] }[]): Vec2[] {
  if (walls.length < 3) return [];
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const w of walls) {
    x0 = Math.min(x0, w.a.x, w.b.x); y0 = Math.min(y0, w.a.y, w.b.y);
    x1 = Math.max(x1, w.a.x, w.b.x); y1 = Math.max(y1, w.a.y, w.b.y);
  }
  x0 = snapGrid(x0) - GRID; y0 = snapGrid(y0) - GRID;
  x1 = snapGrid(x1) + GRID; y1 = snapGrid(y1) + GRID;

  const cells: Vec2[] = [];
  const half = GRID / 2;

  for (let cx = x0; cx < x1; cx += GRID) {
    for (let cy = y0; cy < y1; cy += GRID) {
      const px = cx + half, py = cy + half;
      let dirs = 0;
      if (rayHitsWall(px, py, 1, 0, walls)) dirs++;
      if (rayHitsWall(px, py, -1, 0, walls)) dirs++;
      if (rayHitsWall(px, py, 0, 1, walls)) dirs++;
      if (rayHitsWall(px, py, 0, -1, walls)) dirs++;
      if (dirs >= 3) cells.push({ x: cx, y: cy });
    }
  }
  return cells;
}

/** Check if a ray from (ox,oy) in direction (dx,dy) hits any wall segment */
function rayHitsWall(ox: number, oy: number, dx: number, dy: number, walls: { a: Vec2; b: Vec2 }[]): boolean {
  for (const w of walls) {
    const ex = w.b.x - w.a.x, ey = w.b.y - w.a.y;
    const denom = dx * ey - dy * ex;
    if (Math.abs(denom) < 1e-10) continue;
    const t = ((w.a.x - ox) * ey - (w.a.y - oy) * ex) / denom;
    const u = ((w.a.x - ox) * dy - (w.a.y - oy) * dx) / denom;
    if (t > 0.5 && u >= 0 && u <= 1) return true;
  }
  return false;
}
