export interface Vec2 {
  x: number;
  y: number;
}

export function vec2(x: number, y: number): Vec2 {
  return { x, y };
}

export function add(a: Vec2, b: Vec2): Vec2 {
  return { x: a.x + b.x, y: a.y + b.y };
}

export function sub(a: Vec2, b: Vec2): Vec2 {
  return { x: a.x - b.x, y: a.y - b.y };
}

export function scale(v: Vec2, s: number): Vec2 {
  return { x: v.x * s, y: v.y * s };
}

export function length(v: Vec2): number {
  return Math.sqrt(v.x * v.x + v.y * v.y);
}

export function lengthSq(v: Vec2): number {
  return v.x * v.x + v.y * v.y;
}

export function normalize(v: Vec2): Vec2 {
  const len = length(v);
  if (len < 1e-8) return { x: 0, y: 0 };
  return { x: v.x / len, y: v.y / len };
}

export function dot(a: Vec2, b: Vec2): number {
  return a.x * b.x + a.y * b.y;
}

export function cross(a: Vec2, b: Vec2): number {
  return a.x * b.y - a.y * b.x;
}

export function distance(a: Vec2, b: Vec2): number {
  return length(sub(b, a));
}

export function distanceSq(a: Vec2, b: Vec2): number {
  return lengthSq(sub(b, a));
}

export function lerp(a: Vec2, b: Vec2, t: number): Vec2 {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

export function angle(v: Vec2): number {
  return Math.atan2(v.y, v.x);
}

export function fromAngle(a: number): Vec2 {
  return { x: Math.cos(a), y: Math.sin(a) };
}

export function rotate(v: Vec2, a: number): Vec2 {
  const c = Math.cos(a);
  const s = Math.sin(a);
  return { x: v.x * c - v.y * s, y: v.x * s + v.y * c };
}

/** Shortest angular difference, result in [-PI, PI] */
export function angleDiff(from: number, to: number): number {
  let d = to - from;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}

/** Lerp angle taking shortest path */
export function lerpAngle(from: number, to: number, t: number): number {
  return from + angleDiff(from, to) * t;
}

/** Clamp a number between min and max */
export function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

/** Point to line segment closest point */
export function closestPointOnSegment(p: Vec2, a: Vec2, b: Vec2): Vec2 {
  const ab = sub(b, a);
  const ap = sub(p, a);
  const lenSq = lengthSq(ab);
  if (lenSq < 1e-8) return a;
  const t = clamp(dot(ap, ab) / lenSq, 0, 1);
  return add(a, scale(ab, t));
}

/** Distance from point to line segment */
export function distToSegment(p: Vec2, a: Vec2, b: Vec2): number {
  return distance(p, closestPointOnSegment(p, a, b));
}

export function copy(v: Vec2): Vec2 {
  return { x: v.x, y: v.y };
}
