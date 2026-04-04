import type { Vec2 } from './math/vec2';
import type { SplineLUT } from './math/spline';

export interface WallSegment { a: Vec2; b: Vec2; hasDoor: boolean; doorOpen: boolean; doorPos: number; }
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
  pieTarget: Vec2 | null;
  /** Smoothed display position for aesthetic interpolation */
  smoothPosition: Vec2;
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
  | { type: 'tempo_ring'; opId: number; wpIdx: number | null; centerAngle: number; startTempo: number }
  | { type: 'spinning_direction'; opId: number }
  | { type: 'placing_pie'; opId: number }
  | { type: 'speed_slider'; opId: number; wpIdx: number | null; sliderValue: number };

export interface NodePopup { opId: number; wpIdx: number; position: Vec2; }

export interface Camera { x: number; y: number; zoom: number; }

export type HudBtn = 'go' | 'reset' | 'menu' | 'share' | 'save_stage' | 'replay' | 'clear_level' | null;

/** A snapshot of all operator paths + start positions for one phase of the plan */
export interface Stage {
  /** Per-operator snapshot: startPos, startAngle, waypoints */
  operatorStates: {
    opId: number;
    startPosition: Vec2;
    startAngle: number;
    waypoints: Waypoint[];
    tempo: number;
  }[];
}

export interface SharePanelState {
  open: boolean;
  exporting: boolean;
  exportProgress: number;
  gifBlob: Blob | null;
  copiedRoomCode: boolean;
}

export type SharePanelBtn = 'close' | 'copy_code' | 'export_gif' | 'download_gif' | 'copy_link' | null;

export interface PendingNode {
  opId: number;
  wpIdx: number; // index of the waypoint that was just placed
}

export interface RadialMenuItem {
  id: string;
  icon: 'direction' | 'pie' | 'route' | 'speed' | 'delete' | 'hold' | 'clear';
  label: string;
}

export interface RadialMenu {
  /** World-space center position */
  center: Vec2;
  /** The operator this menu belongs to */
  opId: number;
  /** If >= 0, this is a node menu at this waypoint index. If -1, operator menu */
  wpIdx: number;
  /** Index of hovered item, or -1 */
  hoveredIdx: number;
  /** Animation progress 0..1 for open animation */
  animT: number;
}

export interface SpeedSliderState {
  /** Screen-space position of the slider popup */
  screenPos: Vec2;
  /** Current value 0.2 - 3.0 */
  value: number;
  /** Whether the user is actively dragging the slider thumb */
  dragging: boolean;
}

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
  hoveredHudBtn: HudBtn;
  sharePanel: SharePanelState;
  hoveredShareBtn: SharePanelBtn;
  /** Node that was just placed and needs confirm/cancel */
  pendingNode: PendingNode | null;
  /** Speed slider state when open */
  speedSlider: SpeedSliderState | null;
  /** True during GIF export rendering - hides HUD, shows prominent watermark */
  exportingGif: boolean;
  /** Radial menu (replaces old popup for operator/node menus) */
  radialMenu: RadialMenu | null;
  /** Saved stages (completed planning phases) */
  stages: Stage[];
  /** Which stage is currently being planned (stages.length = next one) */
  currentStageIndex: number;
  /** Which stage is being executed during playback (-1 = not replaying) */
  executingStageIndex: number;
  /** True when replaying all stages sequentially */
  isReplaying: boolean;
  /** True when all stages just finished executing - prompts SAVE STAGE glow */
  stageJustCompleted: boolean;
  /** Snapshot of operator states before GO was pressed, for reset-to-planning */
  preGoSnapshot: Stage | null;
  /** Index of stage user clicked in the indicator to view */
  viewingStageIndex: number;
}

export function makeWaypoint(pos: Vec2): Waypoint {
  return { position: { x: pos.x, y: pos.y }, facingOverride: null, lookTarget: null, hold: false, goCode: null, tempo: 1 };
}

export const C = {
  bg: '#0c1525', floor: '#d4c9a8', floorLine: 'rgba(0,0,0,0.06)', grid: 'rgba(0,0,0,0.04)',
  wall: '#1e3352', wallEdge: '#0c1525', wallInner: '#3a2a1a', wallInnerEdge: '#1a1208',
  doorOpen: '#4a6040', doorClosed: '#2a3530',
  threat: '#cc4433', threatDead: '#3a3a44', threatGlow: 'rgba(200,60,50,0.2)',
  opColors: ['#5588cc','#cc7744','#55aa66','#aa55aa','#ccaa44','#55aaaa','#cc5577'],
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
export const OP_SPEED = 55;
export const FOV_ANG = Math.PI * 0.5;
export const FOV_DIST = 260;
export const THREAT_R = 7;
export const NEUTRALIZE_T = 0.3;
export const PATH_SIMP = 8;
export const NODE_R = 5;
export const DEPLOY_PANEL_H = 56;  // height of deploy bar at bottom-left
export const DEPLOY_OP_SPACING = 40; // horizontal spacing between deploy ops
