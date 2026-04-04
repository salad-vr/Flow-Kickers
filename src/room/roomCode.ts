/**
 * Room Share Code encoding/decoding.
 *
 * v1 format: "v1:<base64>"
 *   The base64 payload is a binary encoding of walls, threats, entry points,
 *   objects, and floor-cut points.
 *   Floor cells are omitted because they are recomputed from walls on load.
 *
 * Binary layout (all values little-endian unless noted):
 *   [wallCount: U16]
 *   For each wall:
 *     [ax: I16, ay: I16, bx: I16, by: I16, doorCount: U16]
 *     For each door: [pos_x100: U16, open: U8]
 *   [threatCount: U16]
 *   For each threat: [x: I16, y: I16]
 *   [entryCount: U16]
 *   For each entry: [x: I16, y: I16]
 *   [objectCount: U16]
 *   For each object: [x: I16, y: I16, w: I16, h: I16, type: U8]  (0=block, 1=stairs)
 *   [floorCutCount: U16]
 *   For each floorCut: [x: I16, y: I16]
 *
 * Coordinates are stored as signed Int16 to support negative values.
 * Door positions are stored as (pos * 100) rounded to Uint16 for 0.01 precision.
 *
 * Legacy format: raw JSON starting with '{' — still accepted on decode.
 */

const CODE_PREFIX = 'v1:';

const OBJ_TYPE_MAP: Record<string, number> = { block: 0, stairs: 1 };
const OBJ_TYPE_REV: string[] = ['block', 'stairs'];

export interface RoomCodeData {
  w: any[][];    // walls: [ax, ay, bx, by, [[doorPos, open], ...]]
  t: number[][]; // threats: [x, y]
  e: number[][]; // entry points: [x, y]
  f?: number[][]; // floor (optional — recomputed on load)
  o?: any[];     // objects: [x, y, w, h, type]
  fc?: any[];    // floor cut points: [x, y]
}

/** Encode room data into a compact share code string. */
export function encodeRoomCode(data: {
  walls: { a: { x: number; y: number }; b: { x: number; y: number }; doors: { pos: number; open: boolean }[] }[];
  threats: { position: { x: number; y: number } }[];
  entryPoints: { x: number; y: number }[];
  objects?: { x: number; y: number; w: number; h: number; type: string }[];
  floorCut?: { x: number; y: number }[];
}): string {
  const objects = data.objects || [];
  const floorCut = data.floorCut || [];

  // Calculate required buffer size
  let size = 2; // wallCount
  for (const w of data.walls) {
    size += 2 * 4 + 2; // ax, ay, bx, by (Int16 each) + doorCount (Uint16)
    size += w.doors.length * 3; // each door: pos_x100 (Uint16) + open (Uint8)
  }
  size += 2; // threatCount
  size += data.threats.length * 4; // each: x, y (Int16 each)
  size += 2; // entryCount
  size += data.entryPoints.length * 4; // each: x, y (Int16 each)
  size += 2; // objectCount
  size += objects.length * 9; // each: x, y, w, h (Int16 each = 8) + type (Uint8 = 1)
  size += 2; // floorCutCount
  size += floorCut.length * 4; // each: x, y (Int16 each)

  const buf = new ArrayBuffer(size);
  const view = new DataView(buf);
  let offset = 0;

  function writeU16(v: number) { view.setUint16(offset, v, true); offset += 2; }
  function writeI16(v: number) { view.setInt16(offset, Math.round(v), true); offset += 2; }
  function writeU8(v: number) { view.setUint8(offset, v); offset += 1; }

  // Walls
  writeU16(data.walls.length);
  for (const w of data.walls) {
    writeI16(w.a.x);
    writeI16(w.a.y);
    writeI16(w.b.x);
    writeI16(w.b.y);
    writeU16(w.doors.length);
    for (const d of w.doors) {
      writeU16(Math.round(d.pos * 100));
      writeU8(d.open ? 1 : 0);
    }
  }

  // Threats
  writeU16(data.threats.length);
  for (const t of data.threats) {
    writeI16(t.position.x);
    writeI16(t.position.y);
  }

  // Entry points
  writeU16(data.entryPoints.length);
  for (const e of data.entryPoints) {
    writeI16(e.x);
    writeI16(e.y);
  }

  // Objects
  writeU16(objects.length);
  for (const o of objects) {
    writeI16(o.x);
    writeI16(o.y);
    writeI16(o.w);
    writeI16(o.h);
    writeU8(OBJ_TYPE_MAP[o.type] ?? 0);
  }

  // Floor cut points
  writeU16(floorCut.length);
  for (const p of floorCut) {
    writeI16(p.x);
    writeI16(p.y);
  }

  // Convert to Base64
  const bytes = new Uint8Array(buf);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return CODE_PREFIX + btoa(binary);
}

/** Encode room data from the raw serialized format (w/t/e/o/fc arrays). */
export function encodeRoomCodeFromRaw(raw: {
  w: any[][];
  t: number[][];
  e: number[][];
  o?: any[];
  fc?: any[];
}): string {
  return encodeRoomCode({
    walls: raw.w.map(w => ({
      a: { x: w[0], y: w[1] },
      b: { x: w[2], y: w[3] },
      doors: Array.isArray(w[4])
        ? w[4].map((d: any) => ({ pos: d[0], open: d[1] === 1 }))
        : w[4] > 0
          ? [{ pos: w[5] ?? 0.5, open: w[4] === 1 }]
          : [],
    })),
    threats: raw.t.map(t => ({ position: { x: t[0], y: t[1] } })),
    entryPoints: raw.e.map(e => ({ x: e[0], y: e[1] })),
    objects: (raw.o || []).map((o: any) => ({
      x: o[0] ?? o.x, y: o[1] ?? o.y,
      w: o[2] ?? o.w, h: o[3] ?? o.h,
      type: o[4] ?? o.type ?? 'block',
    })),
    floorCut: (raw.fc || []).map((p: any) => ({ x: p[0] ?? p.x, y: p[1] ?? p.y })),
  });
}

/**
 * Decode a room share code (v1 binary or legacy JSON).
 * Returns the raw data object with w, t, e, o, fc arrays (no floor — caller should recompute).
 */
export function decodeRoomCode(code: string): RoomCodeData {
  const trimmed = code.trim();

  // Legacy: raw JSON
  if (trimmed.startsWith('{')) {
    const d = JSON.parse(trimmed);
    if (!d.w || !Array.isArray(d.w)) throw new Error('Missing wall data');
    return d as RoomCodeData;
  }

  // v1: binary + base64
  if (!trimmed.startsWith(CODE_PREFIX)) {
    throw new Error('Unrecognized room code format');
  }

  const b64 = trimmed.slice(CODE_PREFIX.length);
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }

  const view = new DataView(bytes.buffer);
  let offset = 0;
  const len = bytes.length;

  function readU16() { const v = view.getUint16(offset, true); offset += 2; return v; }
  function readI16() { const v = view.getInt16(offset, true); offset += 2; return v; }
  function readU8() { const v = view.getUint8(offset); offset += 1; return v; }

  // Walls
  const wallCount = readU16();
  const w: any[][] = [];
  for (let i = 0; i < wallCount; i++) {
    const ax = readI16(), ay = readI16(), bx = readI16(), by = readI16();
    const doorCount = readU16();
    const doors: [number, number][] = [];
    for (let j = 0; j < doorCount; j++) {
      const pos = readU16() / 100;
      const open = readU8();
      doors.push([pos, open]);
    }
    w.push([ax, ay, bx, by, doors]);
  }

  // Threats
  const threatCount = readU16();
  const t: number[][] = [];
  for (let i = 0; i < threatCount; i++) {
    t.push([readI16(), readI16()]);
  }

  // Entry points
  const entryCount = readU16();
  const e: number[][] = [];
  for (let i = 0; i < entryCount; i++) {
    e.push([readI16(), readI16()]);
  }

  // Objects (may not exist in older v1 codes)
  const o: any[] = [];
  if (offset < len) {
    const objCount = readU16();
    for (let i = 0; i < objCount; i++) {
      const ox = readI16(), oy = readI16(), ow = readI16(), oh = readI16();
      const otype = readU8();
      o.push([ox, oy, ow, oh, OBJ_TYPE_REV[otype] || 'block']);
    }
  }

  // Floor cut points (may not exist in older v1 codes)
  const fc: any[] = [];
  if (offset < len) {
    const fcCount = readU16();
    for (let i = 0; i < fcCount; i++) {
      fc.push([readI16(), readI16()]);
    }
  }

  return { w, t, e, o, fc };
}
