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
  neutralizeTimer: number;
}

export interface Room {
  walls: WallSegment[];
  threats: ThreatMarker[];
  floor: Vec2[];
  name: string;
  entryPoints: Vec2[];
}

// ---- Operator Types ----

export interface Waypoint {
  position: Vec2;
  facingOverride: number | null;  // angle in radians, null = auto (face movement dir)
  lookTarget: Vec2 | null;        // "pie" threshold - dotted line to this point, lock facing
  hold: boolean;
  goCode: GoCode | null;
  tempo: number;                  // speed multiplier from this node onward (1 = default)
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
  angle: number;
  speed: number;
  fovAngle: number;
  fovRange: number;
  color: string;
  label: string;
  path: WaypointPath;
  tempo: number;                  // base tempo for this operator (1 = default)
  distanceTraveled: number;
  currentWaypointIndex: number;
  isHolding: boolean;
  isMoving: boolean;
  reachedEnd: boolean;
  startPosition: Vec2;
  startAngle: number;
}

// ---- App Screens ----

export type AppScreen = 'menu' | 'game';
export type GameMode = 'planning' | 'executing' | 'paused';

// Radial menu
export interface RadialMenuItem {
  label: string;
  icon: string;        // short text icon
  action: () => void;
  color?: string;
}

export interface RadialMenu {
  position: Vec2;
  items: RadialMenuItem[];
  hoveredIndex: number;
}

// Interaction states
export type InteractionMode =
  | { type: 'idle' }
  | { type: 'drawing_path'; opId: number; rawPoints: Vec2[] }
  | { type: 'dragging_node'; opId: number; waypointIndex: number }
  | { type: 'setting_facing'; opId: number; waypointIndex: number | null }
  | { type: 'setting_look_target'; opId: number; waypointIndex: number }
  | { type: 'redrawing_from_node'; opId: number; fromIndex: number; rawPoints: Vec2[] }
  | { type: 'radial_menu' }
  | { type: 'placing_wall'; start: Vec2 }
  | { type: 'placing_door' }
  | { type: 'placing_threat' }
  | { type: 'tempo_drag'; opId: number; waypointIndex: number | null; startY: number; startTempo: number };

export interface GameState {
  screen: AppScreen;
  mode: GameMode;
  room: Room;
  operators: Operator[];
  goCodesTriggered: Record<GoCode, boolean>;
  elapsedTime: number;
  selectedOperatorId: number | null;
  selectedWaypointIndex: number | null; // which waypoint is selected on the selected op
  playbackSpeed: number;
  roomCleared: boolean;
  interaction: InteractionMode;
  radialMenu: RadialMenu | null;
  // Room editor state (for Build Your Own)
  isEditing: boolean;
  editorTool: 'wall' | 'door' | 'threat' | 'entry' | null;
}

export function createDefaultWaypoint(pos: Vec2): Waypoint {
  return {
    position: { x: pos.x, y: pos.y },
    facingOverride: null,
    lookTarget: null,
    hold: false,
    goCode: null,
    tempo: 1,
  };
}

// ---- Colors ----

export const COLORS = {
  bgOuter: '#0d1b1e',
  bgFloor: '#6b5d4a',
  bgFloorLight: '#7a6b56',
  gridLine: 'rgba(0,0,0,0.12)',
  wallFill: '#1a1a1a',
  wallStroke: '#0a0a0a',
  doorFrame: '#3a3a2a',
  doorClosed: '#4a4a3a',
  doorOpen: '#5a6a3a',
  threatActive: '#cc3333',
  threatGlow: 'rgba(200, 50, 50, 0.3)',
  threatNeutralized: '#555555',
  threatNeutralizedGlow: 'rgba(80, 80, 80, 0.2)',
  operatorColors: ['#44aaff', '#ff8844', '#44dd66', '#dd44dd', '#ffdd44', '#44dddd'],
  operatorOutline: '#111',
  operatorBody: '#ccbb88',
  operatorBodyGrey: '#666',
  fovFill: 'rgba(255, 220, 120, 0.12)',
  fovEdge: 'rgba(255, 220, 120, 0.25)',
  pathAlpha: 0.7,
  pathGreyAlpha: 0.15,
  holdMarker: '#ff8844',
  lookTargetLine: '#88ddff',
  uiOverlayBg: 'rgba(15, 30, 35, 0.85)',
  uiText: '#aaccbb',
  uiTextBright: '#ddeedd',
  uiAccent: '#44bbaa',
  cleared: '#44dd66',
  radialBg: 'rgba(15, 25, 30, 0.92)',
  radialHover: 'rgba(68, 187, 170, 0.3)',
  radialBorder: '#2a5a5a',
  tempoSlow: '#44aaff',
  tempoFast: '#ff6644',
  nodeActive: '#ffffff',
  nodeHover: '#88ffee',
  entryPoint: '#44bbaa',
} as const;

// ---- Constants ----

export const GRID_SIZE = 20;
export const WALL_THICKNESS = 8;
export const DOOR_WIDTH = 40;
export const OPERATOR_RADIUS = 12;
export const OPERATOR_SPEED = 100;
export const FOV_ANGLE = Math.PI * 0.55;
export const FOV_RANGE = 280;
export const THREAT_RADIUS = 8;
export const NEUTRALIZE_TIME = 0.3;
export const PATH_SIMPLIFY_EPSILON = 8;
export const NODE_HIT_RADIUS = 10;
export const PATH_HIT_DISTANCE = 12;
export const RADIAL_RADIUS = 50;
export const RADIAL_ITEM_RADIUS = 18;
