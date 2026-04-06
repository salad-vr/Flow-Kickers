/**
 * Multiplayer message types and state definitions.
 * All messages are JSON-serialized and sent over PeerJS DataConnection.
 */
import type { Vec2 } from '../math/vec2';
import type { Waypoint, GoCode } from '../types';

// ---- Player Info ----
export interface PlayerInfo {
  id: string;         // PeerJS peer ID
  name: string;       // display name
  colorIndex: number; // 0-3, maps to player colors
  connected: boolean;
}

// Player colors (distinct from opColors - these are UI accent colors per player)
export const PLAYER_COLORS = ['#5588cc', '#cc7744', '#55aa66', '#aa55aa'] as const;
export const PLAYER_LABELS = ['P1', 'P2', 'P3', 'P4'] as const;

// ---- Multiplayer State (lives on GameState) ----
export interface MultiplayerState {
  enabled: boolean;
  isHost: boolean;
  localPlayerId: string;
  players: PlayerInfo[];
  /** opId -> playerId who owns it */
  operatorOwnership: Record<number, string>;
  /** playerIds who have hit "Ready" */
  readyPlayers: string[];
  roomCode: string;
  /** Connection status */
  status: 'connecting' | 'lobby' | 'in_game' | 'disconnected' | 'error';
  /** Error message if status === 'error' */
  errorMessage: string | null;
  /** Notification banners (e.g. "Player X disconnected") */
  notifications: { text: string; time: number }[];
}

export function createMultiplayerState(isHost: boolean, localPlayerId: string, roomCode: string): MultiplayerState {
  return {
    enabled: true,
    isHost,
    localPlayerId,
    players: [],
    operatorOwnership: {},
    readyPlayers: [],
    roomCode,
    status: 'connecting',
    errorMessage: null,
    notifications: [],
  };
}

// ---- Message Types ----
// Every message has a `type` discriminator and a `senderId`

export type NetMessage =
  | PlayerJoinMsg
  | PlayerLeaveMsg
  | PlayerInfoMsg
  | FullStateMsg
  | OperatorClaimMsg
  | OperatorReleaseMsg
  | OperatorMoveMsg
  | WaypointAddMsg
  | WaypointMoveMsg
  | WaypointDeleteMsg
  | FacingUpdateMsg
  | TempoUpdateMsg
  | HoldToggleMsg
  | GoCodeUpdateMsg
  | PieUpdateMsg
  | LookTargetMsg
  | DoorActionMsg
  | RouteStartMsg
  | ReadyMsg
  | UnreadyMsg
  | StageExecuteMsg
  | StageSaveMsg
  | ChatMsg;

// ---- Connection / Lobby ----

export interface PlayerJoinMsg {
  type: 'player_join';
  senderId: string;
  name: string;
}

export interface PlayerLeaveMsg {
  type: 'player_leave';
  senderId: string;
}

/** Host sends this to all clients with the full player list */
export interface PlayerInfoMsg {
  type: 'player_info';
  senderId: string;
  players: PlayerInfo[];
}

/** Host sends complete game state to a newly joined player */
export interface FullStateMsg {
  type: 'full_state';
  senderId: string;
  /** Serialized room + operators + stages + ownership */
  roomData: any; // SerializedSession format
  ownership: Record<number, string>;
  readyPlayers: string[];
}

// ---- Operator Ownership ----

export interface OperatorClaimMsg {
  type: 'op_claim';
  senderId: string;
  opId: number;
  position: Vec2;
  angle: number;
  floor: number;
}

export interface OperatorReleaseMsg {
  type: 'op_release';
  senderId: string;
  opId: number;
}

export interface OperatorMoveMsg {
  type: 'op_move';
  senderId: string;
  opId: number;
  position: Vec2;
  angle: number;
}

// ---- Route Editing ----

/** Player starts drawing a route (creates waypoint 0 at op position) */
export interface RouteStartMsg {
  type: 'route_start';
  senderId: string;
  opId: number;
}

export interface WaypointAddMsg {
  type: 'wp_add';
  senderId: string;
  opId: number;
  wpIdx: number;
  waypoint: Waypoint;
}

export interface WaypointMoveMsg {
  type: 'wp_move';
  senderId: string;
  opId: number;
  wpIdx: number;
  position: Vec2;
}

export interface WaypointDeleteMsg {
  type: 'wp_delete';
  senderId: string;
  opId: number;
  wpIdx: number;
}

// ---- Waypoint Properties ----

export interface FacingUpdateMsg {
  type: 'facing_update';
  senderId: string;
  opId: number;
  /** wpIdx null = operator facing, number = waypoint facing */
  wpIdx: number | null;
  angle: number;
}

export interface TempoUpdateMsg {
  type: 'tempo_update';
  senderId: string;
  opId: number;
  wpIdx: number | null;
  tempo: number;
}

export interface HoldToggleMsg {
  type: 'hold_toggle';
  senderId: string;
  opId: number;
  wpIdx: number;
  hold: boolean;
  goCode: GoCode | null;
}

export interface GoCodeUpdateMsg {
  type: 'gocode_update';
  senderId: string;
  opId: number;
  wpIdx: number;
  goCode: GoCode | null;
}

export interface PieUpdateMsg {
  type: 'pie_update';
  senderId: string;
  opId: number;
  pieTarget: Vec2 | null;
  angle: number;
}

export interface LookTargetMsg {
  type: 'look_target';
  senderId: string;
  opId: number;
  wpIdx: number;
  lookTarget: Vec2 | null;
}

export interface DoorActionMsg {
  type: 'door_action';
  senderId: string;
  opId: number;
  wpIdx: number;
  openDoors: { wallIdx: number; doorIdx: number }[];
}

// ---- Game Flow ----

export interface ReadyMsg {
  type: 'ready';
  senderId: string;
}

export interface UnreadyMsg {
  type: 'unready';
  senderId: string;
}

/** All players ready - host triggers execution */
export interface StageExecuteMsg {
  type: 'stage_execute';
  senderId: string;
  /** Timestamp for synchronized start */
  startTime: number;
}

/** Host saves stage, syncs to all - includes full stage data */
export interface StageSaveMsg {
  type: 'stage_save';
  senderId: string;
  stageData: any; // Stage serialized
}

export interface ChatMsg {
  type: 'chat';
  senderId: string;
  text: string;
}
