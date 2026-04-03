import type { Vec2 } from './math/vec2';
import type { SplineLUT } from './math/spline';

export interface WallSegment { a: Vec2; b: Vec2; hasDoor: boolean; doorOpen: boolean; }
export interface ThreatMarker { position: Vec2; neutralized: boolean; neutralizeTimer: number; }
export interface Room { walls: WallSegment[]; threats: ThreatMarker[]; floor: Vec2[]; name: string; entryPoints: Vec2[]; }

export interface Waypoint {
  position: Vec2;
  facingOverride: number | null;
  lookTarget: Vec2 | null;
  hold: boolean;
  goCode: GoCode | null;
  tempo: number;
}
export type GoCode = 'A' | 'B' | 'C';
export interface WaypointPath { waypoints: Waypoint[]; splineLUT: SplineLUT | null; color: string; }

export interface Operator {
  id: number; position: Vec2; angle: number; speed: number;
  fovAngle: number; fovRange: number; color: string; label: string;
  path: WaypointPath; tempo: number; deployed: boolean;
  distanceTraveled: number; currentWaypointIndex: number;
  isHolding: boolean; isMoving: boolean; reachedEnd: boolean;
  startPosition: Vec2; startAngle: number;
}

export type AppScreen = 'menu' | 'game';
export type GameMode = 'planning' | 'executing' | 'paused';

export type Interaction =
  | { type: 'idle' }
  | { type: 'deploying_op'; opId: number }
  | { type: 'moving_op'; opId: number }
  | { type: 'placing_waypoints'; opId: number }
  | { type: 'setting_facing'; opId: number; wpIdx: number | null }
  | { type: 'dragging_node'; opId: number; wpIdx: number }
  | { type: 'setting_look_target'; opId: number; wpIdx: number }
  | { type: 'tempo_ring'; opId: number; wpIdx: number | null; centerAngle: number; startTempo: number };

export interface NodePopup { opId: number; wpIdx: number; position: Vec2; }

export interface GameState {
  screen: AppScreen; mode: GameMode; room: Room;
  operators: Operator[];
  goCodesTriggered: Record<GoCode, boolean>;
  elapsedTime: number; selectedOpId: number | null;
  playbackSpeed: number; roomCleared: boolean;
  interaction: Interaction; popup: NodePopup | null;
}

export function makeWaypoint(pos: Vec2): Waypoint {
  return { position: { x: pos.x, y: pos.y }, facingOverride: null, lookTarget: null, hold: false, goCode: null, tempo: 1 };
}

export const C = {
  bg: '#0d1b1e', floor: '#5c5040', grid: 'rgba(255,255,255,0.03)',
  wall: '#111', wallEdge: '#000', doorOpen: '#5a6a3a', doorClosed: '#3a3a2a',
  threat: '#cc3333', threatDead: '#444', threatGlow: 'rgba(200,50,50,0.25)',
  opColors: ['#4499ff','#ff7733','#33cc55','#cc44cc','#ddcc33','#33cccc'],
  opBody: '#c0ad80', opBodyGrey: '#666', opOutline: '#111',
  fov: (c: string) => c + '15', fovEdge: (c: string) => c + '35',
  pathAlpha: 0.65, pathGrey: 0.12, node: '#fff', nodeSelected: '#88ffee',
  hold: '#ff8844', lookLine: '#77ccee', tempoSlow: '#4499ff', tempoFast: '#ff5533',
  hud: 'rgba(12,22,28,0.88)', hudBorder: '#1a3a3a', hudText: '#8aa', hudBright: '#cdc',
  accent: '#44bbaa', cleared: '#44dd66',
  panelBg: 'rgba(10,18,22,0.92)', panelBorder: '#1a3a3a',
  popupBg: 'rgba(14,26,32,0.95)', popupBorder: '#2a5555',
} as const;

export const GRID = 20;
export const WALL_W = 8;
export const DOOR_W = 40;
export const OP_R = 9;
export const OP_SPEED = 100;
export const FOV_ANG = Math.PI * 0.5;
export const FOV_DIST = 260;
export const THREAT_R = 7;
export const NEUTRALIZE_T = 0.3;
export const PATH_SIMP = 8;
export const NODE_R = 5;
export const DEPLOY_PANEL_W = 50;
