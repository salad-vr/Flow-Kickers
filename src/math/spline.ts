import type { Vec2 } from './vec2';
import { distance } from './vec2';

/**
 * Catmull-Rom spline evaluation.
 * p0, p1, p2, p3 are control points.
 * t in [0, 1] interpolates between p1 and p2.
 */
export function catmullRom(p0: Vec2, p1: Vec2, p2: Vec2, p3: Vec2, t: number): Vec2 {
  const t2 = t * t;
  const t3 = t2 * t;
  return {
    x: 0.5 * (
      (2 * p1.x) +
      (-p0.x + p2.x) * t +
      (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 +
      (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3
    ),
    y: 0.5 * (
      (2 * p1.y) +
      (-p0.y + p2.y) * t +
      (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 +
      (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3
    ),
  };
}

/**
 * Build a lookup table for arc-length parameterization of a Catmull-Rom spline.
 * waypoints: ordered list of points the spline passes through.
 * Returns cumulative distances at each sample.
 */
export interface SplineLUT {
  /** Total arc length of the spline */
  totalLength: number;
  /** Sampled points along the spline */
  samples: Vec2[];
  /** Cumulative distance at each sample */
  distances: number[];
  /** Number of segments (waypoints.length - 1) */
  segmentCount: number;
}

export function buildSplineLUT(waypoints: Vec2[], samplesPerSegment: number = 20): SplineLUT {
  if (waypoints.length < 2) {
    return { totalLength: 0, samples: [...waypoints], distances: [0], segmentCount: 0 };
  }

  const samples: Vec2[] = [];
  const distances: number[] = [];
  let cumDist = 0;
  const n = waypoints.length;
  const segmentCount = n - 1;

  for (let seg = 0; seg < segmentCount; seg++) {
    // Clamp indices for the 4 control points
    const p0 = waypoints[Math.max(0, seg - 1)];
    const p1 = waypoints[seg];
    const p2 = waypoints[seg + 1];
    const p3 = waypoints[Math.min(n - 1, seg + 2)];

    const steps = samplesPerSegment;
    for (let i = 0; i <= steps; i++) {
      // Skip first sample of non-first segments (avoid duplicate at junction)
      if (seg > 0 && i === 0) continue;

      const t = i / steps;
      const point = catmullRom(p0, p1, p2, p3, t);

      if (samples.length > 0) {
        cumDist += distance(samples[samples.length - 1], point);
      }
      samples.push(point);
      distances.push(cumDist);
    }
  }

  return { totalLength: cumDist, samples, distances, segmentCount };
}

/**
 * Get the position along a spline at a given distance from the start.
 * Uses binary search on the LUT.
 */
export function getPointAtDistance(lut: SplineLUT, dist: number): Vec2 {
  if (lut.samples.length === 0) return { x: 0, y: 0 };
  if (dist <= 0) return lut.samples[0];
  if (dist >= lut.totalLength) return lut.samples[lut.samples.length - 1];

  // Binary search for the segment containing this distance
  let lo = 0;
  let hi = lut.distances.length - 1;
  while (lo < hi - 1) {
    const mid = (lo + hi) >> 1;
    if (lut.distances[mid] <= dist) lo = mid;
    else hi = mid;
  }

  const segLen = lut.distances[hi] - lut.distances[lo];
  if (segLen < 1e-8) return lut.samples[lo];

  const t = (dist - lut.distances[lo]) / segLen;
  return {
    x: lut.samples[lo].x + (lut.samples[hi].x - lut.samples[lo].x) * t,
    y: lut.samples[lo].y + (lut.samples[hi].y - lut.samples[lo].y) * t,
  };
}

/**
 * Get tangent direction at a distance along the spline.
 */
export function getTangentAtDistance(lut: SplineLUT, dist: number): Vec2 {
  const epsilon = 0.5;
  const a = getPointAtDistance(lut, dist - epsilon);
  const b = getPointAtDistance(lut, dist + epsilon);
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.sqrt(dx * dx + dy * dy);
  if (len < 1e-8) return { x: 1, y: 0 };
  return { x: dx / len, y: dy / len };
}
