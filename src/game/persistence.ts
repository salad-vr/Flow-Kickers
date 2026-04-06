/**
 * Session persistence (refresh protection) and saved maps/in-progress logic.
 * Extracted from main.ts to enable multiplayer reuse.
 */
import type { GameState, Room, Operator, Waypoint, WaypointPath, Stage, GoCode } from '../types';
import type { Vec2 } from '../math/vec2';
import { C, OP_SPEED, FOV_ANG, FOV_DIST } from '../types';
import { makeWall, makeThreat, createEmptyRoom } from '../room/room';
import { rebuildPathLUT } from '../operator/pathFollower';
import { createOperator, resetOperatorId, setOperatorNextId } from '../operator/operator';

// ---- Serialized types ----
export interface SerializedSession {
  room: {
    name: string;
    w: any[][];
    t: number[][];
    e: number[][];
    f: number[][];
    o?: any[];
    fc?: any[];
    floors?: any[];
  };
  operators: {
    id: number;
    position: { x: number; y: number };
    angle: number;
    color: string;
    label: string;
    deployed: boolean;
    startPosition: { x: number; y: number };
    startAngle: number;
    tempo: number;
    pieTarget: { x: number; y: number } | null;
    waypoints: any[];
  }[];
  stages: any[];
  currentStageIndex: number;
  camera: { x: number; y: number; zoom: number };
  goCodesTriggered: Record<string, boolean>;
  roomCleared: boolean;
  selRoom: string;
  selOpCount: number;
}

export interface SavedSession {
  name: string;
  data: SerializedSession;
  savedAt: number;
}

export interface SavedMap {
  name: string;
  data: {
    w: any[][];
    t: number[][];
    e: number[][];
    f?: number[][];
    o?: any[];
    fc?: any[];
    floors?: any[];
  };
  createdAt: number;
}

// ---- Wall / Object restoration helpers ----
export function restoreWalls(arr: any[]): import('../types').WallSegment[] {
  return (arr || []).map((w: any[]) => {
    const wall = makeWall(w[0], w[1], w[2], w[3]);
    if (Array.isArray(w[4])) {
      wall.doors = w[4].map((d: any) => ({ pos: d[0], open: d[1] === 1 }));
    } else if (w[4] > 0) {
      wall.doors = [{ pos: w[5] ?? 0.5, open: w[4] === 1 }];
    }
    return wall;
  });
}

export function restoreObjects(arr: any[]): import('../types').RoomObject[] {
  return (arr || []).map((o: any) => {
    const obj: import('../types').RoomObject = {
      x: o[0] ?? o.x, y: o[1] ?? o.y, w: o[2] ?? o.w, h: o[3] ?? o.h,
      type: o[4] ?? o.type ?? 'block',
    };
    if (Array.isArray(o[5])) obj.connectsFloors = [o[5][0], o[5][1]];
    else if (o.connectsFloors) obj.connectsFloors = o.connectsFloors;
    return obj;
  });
}

export function roomFromSavedMap(mapData: SavedMap['data']): Room {
  return {
    name: 'Custom',
    walls: restoreWalls(mapData.w),
    threats: (mapData.t || []).map((t: number[]) => makeThreat(t[0], t[1])),
    entryPoints: (mapData.e || []).map((e: number[]) => ({ x: e[0], y: e[1] })),
    floor: (mapData.f || []).map((p: number[]) => ({ x: p[0], y: p[1] })),
    objects: restoreObjects(mapData.o || []),
    floorCut: (mapData.fc || []).map((p: any) => ({ x: p[0] ?? p.x, y: p[1] ?? p.y })),
    labels: ((mapData as any).lb || []).map((l: any) => ({ position: { x: l.position?.x ?? l[0], y: l.position?.y ?? l[1] }, text: l.text ?? l[2] ?? '' })),
    floors: (mapData.floors || []).map((fl: any) => ({
      level: fl.level,
      bounds: fl.bounds || { x: 0, y: 0, w: 0, h: 0 },
      walls: restoreWalls(fl.w || []),
      threats: (fl.t || []).map((t: number[]) => makeThreat(t[0], t[1])),
      objects: restoreObjects(fl.o || []),
      floor: [],
      floorCut: (fl.fc || []).map((p: any) => ({ x: p[0] ?? p.x, y: p[1] ?? p.y })),
    })),
  };
}

// ---- Serialization ----
export function serializeSession(state: GameState, selRoom: string, selOpCount: number): SerializedSession {
  return {
    room: {
      name: state.room.name,
      w: state.room.walls.map(w => [w.a.x, w.a.y, w.b.x, w.b.y, w.doors.map(d => [d.pos, d.open ? 1 : 0])]),
      t: state.room.threats.map(t => [t.position.x, t.position.y, t.neutralized ? 1 : 0]),
      e: state.room.entryPoints.map(e => [e.x, e.y]),
      f: state.room.floor.map(p => [p.x, p.y]),
      o: state.room.objects.map(o => {
        const arr: any[] = [o.x, o.y, o.w, o.h, o.type];
        if (o.connectsFloors) arr.push(o.connectsFloors);
        return arr;
      }),
      fc: state.room.floorCut.map(p => [p.x, p.y]),
      floors: (state.room.floors || []).map(fl => ({
        level: fl.level,
        bounds: fl.bounds,
        w: fl.walls.map(w => [w.a.x, w.a.y, w.b.x, w.b.y, w.doors.map(d => [d.pos, d.open ? 1 : 0])]),
        t: fl.threats.map(t => [t.position.x, t.position.y, t.neutralized ? 1 : 0]),
        o: fl.objects.map(o => {
          const arr: any[] = [o.x, o.y, o.w, o.h, o.type];
          if (o.connectsFloors) arr.push(o.connectsFloors);
          return arr;
        }),
        fc: fl.floorCut.map(p => [p.x, p.y]),
      })),
    },
    operators: state.operators.map(op => ({
      id: op.id,
      position: { x: op.position.x, y: op.position.y },
      angle: op.angle,
      color: op.color,
      label: op.label,
      deployed: op.deployed,
      startPosition: { x: op.startPosition.x, y: op.startPosition.y },
      startAngle: op.startAngle,
      tempo: op.tempo,
      pieTarget: op.pieTarget ? { x: op.pieTarget.x, y: op.pieTarget.y } : null,
      waypoints: op.path.waypoints.map(wp => ({
        position: { x: wp.position.x, y: wp.position.y },
        facingOverride: wp.facingOverride,
        lookTarget: wp.lookTarget ? { x: wp.lookTarget.x, y: wp.lookTarget.y } : null,
        hold: wp.hold,
        goCode: wp.goCode,
        tempo: wp.tempo,
      })),
    })),
    stages: state.stages.map(s => ({
      operatorStates: s.operatorStates.map(os => ({
        opId: os.opId,
        startPosition: { x: os.startPosition.x, y: os.startPosition.y },
        startAngle: os.startAngle,
        waypoints: os.waypoints.map(wp => ({
          position: { x: wp.position.x, y: wp.position.y },
          facingOverride: wp.facingOverride,
          lookTarget: wp.lookTarget ? { x: wp.lookTarget.x, y: wp.lookTarget.y } : null,
          hold: wp.hold,
          goCode: wp.goCode,
          tempo: wp.tempo,
        })),
        tempo: os.tempo,
        pieTarget: os.pieTarget ? { x: os.pieTarget.x, y: os.pieTarget.y } : null,
      })),
    })),
    currentStageIndex: state.currentStageIndex,
    camera: { x: state.camera.x, y: state.camera.y, zoom: state.camera.zoom },
    goCodesTriggered: { ...state.goCodesTriggered },
    roomCleared: state.roomCleared,
    selRoom,
    selOpCount,
  };
}

export function restoreSession(state: GameState, data: SerializedSession): { selRoom: string; selOpCount: number } {
  // Restore room
  const room: Room = {
    name: data.room.name,
    walls: restoreWalls(data.room.w || []),
    threats: (data.room.t || []).map((t: number[]) => {
      const threat = makeThreat(t[0], t[1]);
      if (t[2] === 1) { threat.neutralized = true; threat.neutralizeTimer = 1; }
      return threat;
    }),
    entryPoints: (data.room.e || []).map((e: number[]) => ({ x: e[0], y: e[1] })),
    floor: (data.room.f || []).map((p: number[]) => ({ x: p[0], y: p[1] })),
    objects: restoreObjects((data.room as any).o || []),
    floorCut: ((data.room as any).fc || []).map((p: any) => ({ x: p[0] ?? p.x, y: p[1] ?? p.y })),
    labels: ((data.room as any).lb || []).map((l: any) => ({ position: { x: l.position?.x ?? l[0], y: l.position?.y ?? l[1] }, text: l.text ?? l[2] ?? '' })),
    floors: ((data.room as any).floors || []).map((fl: any) => ({
      level: fl.level,
      bounds: fl.bounds || { x: 0, y: 0, w: 0, h: 0 },
      walls: restoreWalls(fl.w || fl.walls || []),
      threats: (fl.t || fl.threats || []).map((t: any) => {
        if (Array.isArray(t)) return makeThreat(t[0], t[1]);
        return makeThreat(t.position.x, t.position.y);
      }),
      objects: restoreObjects(fl.o || fl.objects || []),
      floor: fl.floor || [],
      floorCut: (fl.fc || fl.floorCut || []).map((p: any) => ({ x: p[0] ?? p.x, y: p[1] ?? p.y })),
    })),
  };
  state.room = room;

  // Restore operators
  resetOperatorId();
  let maxOpId = 0;
  state.operators = data.operators.map((od, i) => {
    if (od.id > maxOpId) maxOpId = od.id;
    const color = od.color || C.opColors[i % C.opColors.length];
    const emptyPath: WaypointPath = { waypoints: [], splineLUT: null, color };
    const op: Operator = {
      id: od.id,
      position: { x: od.position.x, y: od.position.y },
      angle: od.angle,
      speed: OP_SPEED,
      fovAngle: FOV_ANG,
      fovRange: FOV_DIST,
      color,
      label: od.label,
      path: emptyPath,
      tempo: od.tempo,
      deployed: od.deployed,
      distanceTraveled: 0,
      currentWaypointIndex: 0,
      isHolding: false,
      isMoving: false,
      reachedEnd: false,
      startPosition: { x: od.startPosition.x, y: od.startPosition.y },
      startAngle: od.startAngle,
      pieTarget: od.pieTarget ? { x: od.pieTarget.x, y: od.pieTarget.y } : null,
      smoothPosition: { x: od.position.x, y: od.position.y },
      currentFloor: (od as any).currentFloor ?? 0,
      startFloor: (od as any).startFloor ?? 0,
    };
    if (od.waypoints && od.waypoints.length > 0) {
      op.path.waypoints = od.waypoints.map((wp: any) => ({
        position: { x: wp.position.x, y: wp.position.y },
        facingOverride: wp.facingOverride,
        lookTarget: wp.lookTarget ? { x: wp.lookTarget.x, y: wp.lookTarget.y } : null,
        hold: wp.hold,
        goCode: wp.goCode,
        tempo: wp.tempo,
        floorLevel: wp.floorLevel ?? 0,
        openDoors: wp.openDoors || [],
      }));
      if (op.path.waypoints.length >= 2) {
        rebuildPathLUT(op);
      }
    }
    return op;
  });
  setOperatorNextId(maxOpId + 1);

  // Restore stages
  state.stages = (data.stages || []).map((s: any) => ({
    operatorStates: s.operatorStates.map((os: any) => ({
      opId: os.opId,
      startPosition: { x: os.startPosition.x, y: os.startPosition.y },
      startAngle: os.startAngle,
      waypoints: os.waypoints.map((wp: any) => ({
        position: { x: wp.position.x, y: wp.position.y },
        facingOverride: wp.facingOverride,
        lookTarget: wp.lookTarget ? { x: wp.lookTarget.x, y: wp.lookTarget.y } : null,
        hold: wp.hold,
        goCode: wp.goCode,
        tempo: wp.tempo,
        floorLevel: wp.floorLevel ?? 0,
      })),
      tempo: os.tempo,
      pieTarget: os.pieTarget ? { x: os.pieTarget.x, y: os.pieTarget.y } : null,
      startFloor: os.startFloor ?? 0,
    })),
  }));
  state.currentStageIndex = data.currentStageIndex || 0;

  // Restore camera
  state.camera = { x: data.camera.x, y: data.camera.y, zoom: data.camera.zoom };

  // Restore misc state
  state.goCodesTriggered = { A: false, B: false, C: false, ...data.goCodesTriggered } as Record<GoCode, boolean>;
  state.roomCleared = data.roomCleared || false;
  state.mode = 'planning';
  state.elapsedTime = 0;
  state.interaction = { type: 'idle' };
  state.popup = null;
  state.radialMenu = null;
  state.pendingNode = null;
  state.speedSlider = null;
  state.selectedOpId = null;
  state.executingStageIndex = -1;
  state.isReplaying = false;
  state.stageJustCompleted = false;
  state.preGoSnapshot = null;
  state.viewingStageIndex = -1;

  return {
    selRoom: data.selRoom || 'Corner Fed',
    selOpCount: data.selOpCount || 7,
  };
}

// ---- Storage helpers ----
const SESSION_KEY = 'flowkickers_active_session';
const IN_PROGRESS_KEY = 'flowkickers_in_progress';
const SAVED_MAPS_KEY = 'flowkickers_saved_maps';

export function saveSessionToStorage(state: GameState, selRoom: string, selOpCount: number) {
  if (state.screen !== 'game') return;
  if (state.mode === 'executing') return;
  try {
    const data = serializeSession(state, selRoom, selOpCount);
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(data));
  } catch { /* ignore quota errors */ }
}

export function clearSessionStorage() {
  sessionStorage.removeItem(SESSION_KEY);
}

export function loadSessionFromStorage(): SerializedSession | null {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

export function loadSavedMaps(): SavedMap[] {
  try {
    const raw = localStorage.getItem(SAVED_MAPS_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

export function saveMapsToStorage(maps: SavedMap[]) {
  localStorage.setItem(SAVED_MAPS_KEY, JSON.stringify(maps));
}

export function deleteSavedMap(index: number) {
  const maps = loadSavedMaps();
  maps.splice(index, 1);
  saveMapsToStorage(maps);
}

export function saveImportedMap(mapData: SavedMap['data']) {
  const maps = loadSavedMaps();
  const newJson = JSON.stringify(mapData.w);
  const alreadyExists = maps.some(m => JSON.stringify(m.data.w) === newJson);
  if (alreadyExists) return;

  const wallCount = (mapData.w || []).length;
  const threatCount = (mapData.t || []).length;
  const name = `Imported (${wallCount}w ${threatCount}t)`;
  const saved: SavedMap = { name, data: mapData, createdAt: Date.now() };
  maps.push(saved);
  saveMapsToStorage(maps);
}

export function loadInProgressSessions(): SavedSession[] {
  try {
    const raw = localStorage.getItem(IN_PROGRESS_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

export function saveInProgressToStorage(sessions: SavedSession[]) {
  localStorage.setItem(IN_PROGRESS_KEY, JSON.stringify(sessions));
}

export function deleteInProgressSession(index: number) {
  const sessions = loadInProgressSessions();
  sessions.splice(index, 1);
  saveInProgressToStorage(sessions);
}

export function saveProgress(state: GameState, selRoom: string, selOpCount: number): string {
  const data = serializeSession(state, selRoom, selOpCount);
  const sessions = loadInProgressSessions();
  const roomName = state.room.name || selRoom;
  const stageCount = state.stages.length;
  const deployedCount = state.operators.filter(o => o.deployed).length;
  const name = `${roomName} - ${deployedCount} ops, ${stageCount} stage${stageCount !== 1 ? 's' : ''}`;

  sessions.push({ name, data, savedAt: Date.now() });
  saveInProgressToStorage(sessions);
  return name;
}

export function saveCurrentMap(name: string, customRoom: Room, refreshUI: () => void) {
  const maps = loadSavedMaps();
  const mapData: SavedMap = {
    name,
    data: {
      w: customRoom.walls.map(w => [w.a.x, w.a.y, w.b.x, w.b.y, w.doors.map(d => [d.pos, d.open ? 1 : 0])]),
      t: customRoom.threats.map(t => [t.position.x, t.position.y]),
      e: customRoom.entryPoints.map(e => [e.x, e.y]),
      f: customRoom.floor.map(p => [p.x, p.y]),
      o: customRoom.objects.map(o => {
        const arr: any[] = [o.x, o.y, o.w, o.h, o.type];
        if (o.connectsFloors) arr.push(o.connectsFloors);
        return arr;
      }),
      fc: customRoom.floorCut.map(p => [p.x, p.y]),
      floors: customRoom.floors.map(fl => ({
        level: fl.level,
        bounds: fl.bounds,
        w: fl.walls.map(w => [w.a.x, w.a.y, w.b.x, w.b.y, w.doors.map(d => [d.pos, d.open ? 1 : 0])]),
        t: fl.threats.map(t => [t.position.x, t.position.y]),
        o: fl.objects.map(o => {
          const arr: any[] = [o.x, o.y, o.w, o.h, o.type];
          if (o.connectsFloors) arr.push(o.connectsFloors);
          return arr;
        }),
        fc: fl.floorCut.map(p => [p.x, p.y]),
      })),
    },
    createdAt: Date.now(),
  };
  maps.push(mapData);
  saveMapsToStorage(maps);
  refreshUI();
}
