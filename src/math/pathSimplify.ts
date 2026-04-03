import type { Vec2 } from './vec2';

/**
 * Ramer-Douglas-Peucker line simplification.
 * Takes a list of points and returns a simplified version.
 */
export function simplifyPath(points: Vec2[], epsilon: number): Vec2[] {
  if (points.length <= 2) return [...points];

  // Find the point with the maximum distance from the line (first -> last)
  const first = points[0];
  const last = points[points.length - 1];
  let maxDist = 0;
  let maxIdx = 0;

  for (let i = 1; i < points.length - 1; i++) {
    const d = perpendicularDistance(points[i], first, last);
    if (d > maxDist) {
      maxDist = d;
      maxIdx = i;
    }
  }

  if (maxDist > epsilon) {
    const left = simplifyPath(points.slice(0, maxIdx + 1), epsilon);
    const right = simplifyPath(points.slice(maxIdx), epsilon);
    return [...left.slice(0, -1), ...right];
  } else {
    return [first, last];
  }
}

function perpendicularDistance(point: Vec2, lineA: Vec2, lineB: Vec2): number {
  const dx = lineB.x - lineA.x;
  const dy = lineB.y - lineA.y;
  const lenSq = dx * dx + dy * dy;

  if (lenSq < 1e-8) {
    const ddx = point.x - lineA.x;
    const ddy = point.y - lineA.y;
    return Math.sqrt(ddx * ddx + ddy * ddy);
  }

  const t = Math.max(0, Math.min(1,
    ((point.x - lineA.x) * dx + (point.y - lineA.y) * dy) / lenSq
  ));

  const projX = lineA.x + t * dx;
  const projY = lineA.y + t * dy;

  const ddx = point.x - projX;
  const ddy = point.y - projY;
  return Math.sqrt(ddx * ddx + ddy * ddy);
}
