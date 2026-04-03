import type { Vec2 } from './vec2';

export interface IntersectResult {
  t: number; // parameter along first segment [0,1]
  u: number; // parameter along second segment [0,1]
  point: Vec2;
}

/**
 * Line segment intersection.
 * Segment 1: a->b, Segment 2: c->d
 * Returns intersection parameters t,u and point, or null if no intersection.
 */
export function segmentIntersect(
  ax: number, ay: number, bx: number, by: number,
  cx: number, cy: number, dx: number, dy: number,
): IntersectResult | null {
  const dxAB = bx - ax;
  const dyAB = by - ay;
  const dxCD = dx - cx;
  const dyCD = dy - cy;

  const denom = dxAB * dyCD - dyAB * dxCD;
  if (Math.abs(denom) < 1e-10) return null;

  const t = ((cx - ax) * dyCD - (cy - ay) * dxCD) / denom;
  const u = ((cx - ax) * dyAB - (cy - ay) * dxAB) / denom;

  if (t < 0 || t > 1 || u < 0 || u > 1) return null;

  return {
    t,
    u,
    point: { x: ax + t * dxAB, y: ay + t * dyAB },
  };
}

/**
 * Ray intersection with a line segment.
 * Ray: origin + direction * t (t >= 0)
 * Segment: c->d
 * Returns t parameter along ray and u parameter along segment, or null.
 */
export function raySegmentIntersect(
  ox: number, oy: number, dx_ray: number, dy_ray: number,
  cx: number, cy: number, ex: number, ey: number,
): { t: number; u: number; point: Vec2 } | null {
  const dxSeg = ex - cx;
  const dySeg = ey - cy;

  const denom = dx_ray * dySeg - dy_ray * dxSeg;
  if (Math.abs(denom) < 1e-10) return null;

  const t = ((cx - ox) * dySeg - (cy - oy) * dxSeg) / denom;
  const u = ((cx - ox) * dy_ray - (cy - oy) * dx_ray) / denom;

  if (t < 0 || u < 0 || u > 1) return null;

  return {
    t,
    u,
    point: { x: ox + t * dx_ray, y: oy + t * dy_ray },
  };
}

export interface Wall {
  ax: number; ay: number;
  bx: number; by: number;
}

/**
 * Cast rays from origin within angle range, find visibility polygon.
 * Returns array of polygon vertices in angle order.
 */
export function computeVisibilityPolygon(
  origin: Vec2,
  walls: Wall[],
  startAngle: number,
  endAngle: number,
  maxDist: number,
  rayCount: number,
): Vec2[] {
  const points: Vec2[] = [];
  const angleRange = endAngle - startAngle;

  for (let i = 0; i <= rayCount; i++) {
    const a = startAngle + (angleRange * i) / rayCount;
    const dirX = Math.cos(a);
    const dirY = Math.sin(a);

    let closestT = maxDist;
    let closestPoint: Vec2 = {
      x: origin.x + dirX * maxDist,
      y: origin.y + dirY * maxDist,
    };

    for (const wall of walls) {
      const hit = raySegmentIntersect(
        origin.x, origin.y, dirX, dirY,
        wall.ax, wall.ay, wall.bx, wall.by,
      );
      if (hit && hit.t < closestT) {
        closestT = hit.t;
        closestPoint = hit.point;
      }
    }

    points.push(closestPoint);
  }

  return points;
}

/**
 * Check line of sight between two points.
 * Returns true if clear (no wall intersection).
 */
export function hasLineOfSight(
  from: Vec2,
  to: Vec2,
  walls: Wall[],
): boolean {
  const dx = to.x - from.x;
  const dy = to.y - from.y;

  for (const wall of walls) {
    const hit = segmentIntersect(
      from.x, from.y, to.x, to.y,
      wall.ax, wall.ay, wall.bx, wall.by,
    );
    if (hit && hit.t > 0.001 && hit.t < 0.999) return false;
  }

  return true;
}

/**
 * Check if a point is inside a convex or simple polygon.
 * Uses ray casting (even-odd rule).
 */
export function pointInPolygon(p: Vec2, polygon: Vec2[]): boolean {
  let inside = false;
  const n = polygon.length;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = polygon[i].x, yi = polygon[i].y;
    const xj = polygon[j].x, yj = polygon[j].y;
    if (
      ((yi > p.y) !== (yj > p.y)) &&
      (p.x < (xj - xi) * (p.y - yi) / (yj - yi) + xi)
    ) {
      inside = !inside;
    }
  }
  return inside;
}
