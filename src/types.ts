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

export interface Camera { x: number; y: number; zoom: number; }

export interface GameState {
  screen: AppScreen; mode: GameMode; room: Room;
  operators: Operator[];
  goCodesTriggered: Record<GoCode, boolean>;
  elapsedTime: number; selectedOpId: number | null;
  playbackSpeed: number; roomCleared: boolean;
  interaction: Interaction; popup: NodePopup | null;
  camera: Camera;
  isPanning: boolean;
  panStart: Vec2;
  panCamStart: Vec2;
}

export function makeWaypoint(pos: Vec2): Waypoint {
  return { position: { x: pos.x, y: pos.y }, facingOverride: null, lookTarget: null, hold: false, goCode: null, tempo: 1 };
}

export const C = {
  bg: '#0c1525', floor: '#2a3552', grid: 'rgba(232,223,198,0.03)',
  wall: '#1e3352', wallEdge: '#0c1525', doorOpen: '#4a6040', doorClosed: '#2a3530',
  threat: '#cc4433', threatDead: '#3a3a44', threatGlow: 'rgba(200,60,50,0.2)',
  opColors: ['#5588cc','#cc7744','#55aa66','#aa55aa','#ccaa44','#55aaaa'],
  opBody: '#c8bb96', opBodyGrey: '#666', opOutline: '#0c1525',
  fov: (c: string) => c + '15', fovEdge: (c: string) => c + '35',
  pathAlpha: 0.65, pathGrey: 0.12, node: '#e8dfc6', nodeSelected: '#f2ecda',
  hold: '#cc7744', lookLine: '#6699bb', tempoSlow: '#5588cc', tempoFast: '#cc5544',
  hud: 'rgba(12,21,37,0.92)', hudBorder: '#1e3352', hudText: '#8a836e', hudBright: '#e8dfc6',
  accent: '#e8dfc6', cleared: '#55aa66',
  panelBg: 'rgba(12,21,37,0.95)', panelBorder: '#1e3352',
  popupBg: 'rgba(17,29,51,0.96)', popupBorder: '#274166',
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
