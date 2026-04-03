import type { Vec2 } from './math/vec2';
import type { SplineLUT } from './math/spline';

// ---- Room Types ----

export interface WallSegment {
  a: Vec2;
  b: Vec2;
  hasDoor: boolean;
  doorOpen: boolean;
}

export interface ThreatMarker {
  position: Vec2;
  neutralized: boolean;
  neutralizeTimer: number; // counts up when in FOV
}

export interface Room {
  walls: WallSegment[];
  threats: ThreatMarker[];
  floor: Vec2[]; // polygon for floor area fill
  name: string;
  entryPoints: Vec2[]; // suggested operator starting positions near doors
}

// ---- Operator Types ----

export interface Waypoint {
  position: Vec2;
  facingOverride: number | null; // angle in radians, null = auto
  hold: boolean; // stop here until go-code triggered
  goCode: GoCode | null; // which go-code releases this hold
}

export type GoCode = 'A' | 'B' | 'C';

export interface WaypointPath {
  waypoints: Waypoint[];
  splineLUT: SplineLUT | null;
  color: string;
}

export interface Operator {
  id: number;
  position: Vec2;
  angle: number; // facing direction in radians
  speed: number; // pixels per second
  fovAngle: number; // total FOV arc in radians (e.g., PI/2 = 90 degrees)
  fovRange: number; // max FOV distance in pixels
  color: string;
  label: string;
  path: WaypointPath;

  // Runtime state during execution
  distanceTraveled: number;
  currentWaypointIndex: number;
  isHolding: boolean;
  isMoving: boolean;
  reachedEnd: boolean;

  // Start position for reset
  startPosition: Vec2;
  startAngle: number;
}

// ---- Game State ----

export type GameMode = 'planning' | 'executing' | 'paused';
export type EditorTool = 'select' | 'wall' | 'door' | 'threat' | 'path' | 'facing' | 'move_operator';

export interface GameState {
  mode: GameMode;
  activeTool: EditorTool;
  room: Room;
  operators: Operator[];
  goCodesTriggered: Record<GoCode, boolean>;
  elapsedTime: number; // execution time in seconds
  selectedOperatorId: number | null;
  playbackSpeed: number; // 1 = normal, 2 = fast, 0.5 = slow
  roomCleared: boolean;
}

// ---- Colors (Door Kickers inspired) ----

export const COLORS = {
  // Background / environment
  bgOuter: '#0d1b1e',
  bgFloor: '#6b5d4a',
  bgFloorLight: '#7a6b56',
  gridLine: 'rgba(0,0,0,0.15)',

  // Walls
  wallFill: '#1a1a1a',
  wallStroke: '#0a0a0a',
  wallHighlight: '#444',

  // Door
  doorFrame: '#3a3a2a',
  doorOpen: '#5a5a3a',

  // Fog of war
  fogColor: 'rgba(10, 25, 30, 0.75)',
  fogExplored: 'rgba(10, 25, 30, 0.35)',

  // Threats
  threatActive: '#cc3333',
  threatNeutralized: '#555555',

  // Operators
  operatorColors: ['#44aaff', '#ff8844', '#44dd66', '#dd44dd', '#ffdd44', '#44dddd'],
  operatorOutline: '#111',
  operatorBody: '#ccbb88',

  // FOV
  fovFill: 'rgba(255, 230, 150, 0.15)',
  fovStroke: 'rgba(255, 230, 150, 0.3)',

  // Paths
  pathDash: [8, 5],

  // UI
  uiBg: '#1a2a2a',
  uiBorder: '#2a4a4a',
  uiText: '#aaccbb',
  uiTextBright: '#ddeedd',
  uiAccent: '#44bbaa',
  uiDanger: '#cc4444',
  uiButton: '#223838',
  uiButtonHover: '#2a4a4a',
  uiButtonActive: '#44bbaa',

  // Room cleared
  clearedText: '#44dd66',
} as const;

// ---- Constants ----

export const GRID_SIZE = 20; // pixels per grid cell
export const WALL_THICKNESS = 6;
export const DOOR_WIDTH = 40;
export const OPERATOR_RADIUS = 10;
export const OPERATOR_SPEED = 120; // pixels per second
export const FOV_ANGLE = Math.PI * 0.5; // 90 degrees
export const FOV_RANGE = 250;
export const THREAT_RADIUS = 8;
export const NEUTRALIZE_TIME = 0.3; // seconds in FOV to neutralize
export const PATH_SIMPLIFY_EPSILON = 8;
export const SNAP_DISTANCE = 10;
