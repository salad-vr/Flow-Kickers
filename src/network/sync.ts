/**
 * Network synchronization layer.
 * Translates local game actions into network messages (outbound),
 * and applies incoming network messages to local game state (inbound).
 */
import type { GameState, Operator, Waypoint } from '../types';
import type { Vec2 } from '../math/vec2';
import type {
  NetMessage, MultiplayerState, PlayerInfo,
  OperatorClaimMsg, OperatorReleaseMsg, OperatorMoveMsg,
  WaypointAddMsg, WaypointMoveMsg, WaypointDeleteMsg,
  FacingUpdateMsg, TempoUpdateMsg, HoldToggleMsg,
  PieUpdateMsg, LookTargetMsg, DoorActionMsg,
  RouteStartMsg, ReadyMsg, UnreadyMsg,
  StageExecuteMsg, StageSaveMsg,
  FullStateMsg, PlayerInfoMsg, PlayerJoinMsg,
  ResetMsg, ClearLevelMsg, ReplayMsg, EditStageMsg,
} from './types';
import { createMultiplayerState, PLAYER_COLORS } from './types';
import { NetworkManager, type ConnectionEvent } from './peer';
import { rebuildPathLUT } from '../operator/pathFollower';
import { doGo, doReset, doReplay, doClearLevel, editStage, loadAndExecuteStage, saveStage } from '../game/actions';
import { serializeSession, restoreSession } from '../game/persistence';
import { makeWaypoint } from '../types';

/**
 * NetworkSync manages the connection between game state and network.
 * It's the single point of contact for all multiplayer logic.
 */
export class NetworkSync {
  private net: NetworkManager | null = null;
  private state: GameState;
  private playerName: string;
  /** Callback to trigger UI refresh (e.g. lobby screen update) */
  private onUIUpdate: () => void;
  /** Callback when transitioning to game */
  private onStartGame: () => void;

  constructor(
    state: GameState,
    playerName: string,
    onUIUpdate: () => void,
    onStartGame: () => void,
  ) {
    this.state = state;
    this.playerName = playerName;
    this.onUIUpdate = onUIUpdate;
    this.onStartGame = onStartGame;
  }

  get isConnected(): boolean {
    return this.net !== null && this.state.multiplayer !== null;
  }

  get isHost(): boolean {
    return this.state.multiplayer?.isHost ?? false;
  }

  get localPlayerId(): string {
    return this.state.multiplayer?.localPlayerId ?? '';
  }

  // ---- Connection Management ----

  async hostRoom(): Promise<string> {
    this.net = new NetworkManager((event) => this.handleEvent(event));
    const roomCode = await this.net.createRoom();
    this.state.multiplayer = createMultiplayerState(true, this.net.myPeerId, roomCode);
    // Host adds themselves to the player list
    const hostPlayer: PlayerInfo = {
      id: this.net.myPeerId,
      name: this.playerName,
      colorIndex: 0,
      connected: true,
    };
    this.state.multiplayer.players.push(hostPlayer);
    this.state.multiplayer.status = 'lobby';
    this.onUIUpdate();
    return roomCode;
  }

  async joinRoom(roomCode: string): Promise<void> {
    this.net = new NetworkManager((event) => this.handleEvent(event));
    await this.net.joinRoom(roomCode);
    this.state.multiplayer = createMultiplayerState(false, this.net.myPeerId, roomCode);
    this.state.multiplayer.status = 'connecting';
    // Send join message to host
    this.net.sendToAll({
      type: 'player_join',
      senderId: this.net.myPeerId,
      name: this.playerName,
    });
    this.onUIUpdate();
  }

  disconnect() {
    if (this.net) {
      this.net.destroy();
      this.net = null;
    }
    this.state.multiplayer = null;
  }

  // ---- Outbound: Local actions -> Network messages ----

  /** Called when local player drags an operator to deploy */
  sendOperatorClaim(opId: number, position: Vec2, angle: number, floor: number) {
    console.log('[SYNC] sendOperatorClaim', opId, 'net?', !!this.net, 'mp?', !!this.state.multiplayer);
    if (!this.net || !this.state.multiplayer) return;
    const msg: OperatorClaimMsg = {
      type: 'op_claim',
      senderId: this.localPlayerId,
      opId, position, angle, floor,
    };
    this.state.multiplayer.operatorOwnership[opId] = this.localPlayerId;
    this.net.sendToAll(msg);
  }

  /** Called when local player removes an operator from the field */
  sendOperatorRelease(opId: number) {
    if (!this.net || !this.state.multiplayer) return;
    const msg: OperatorReleaseMsg = {
      type: 'op_release',
      senderId: this.localPlayerId,
      opId,
    };
    delete this.state.multiplayer.operatorOwnership[opId];
    this.net.sendToAll(msg);
  }

  /** Called when local player moves their operator */
  sendOperatorMove(opId: number, position: Vec2, angle: number) {
    if (!this.net || !this.state.multiplayer) return;
    const msg: OperatorMoveMsg = {
      type: 'op_move',
      senderId: this.localPlayerId,
      opId, position, angle,
    };
    this.net.sendToAll(msg);
  }

  /** Called when local player starts route drawing */
  sendRouteStart(opId: number) {
    if (!this.net || !this.state.multiplayer) return;
    const msg: RouteStartMsg = {
      type: 'route_start',
      senderId: this.localPlayerId,
      opId,
    };
    this.net.sendToAll(msg);
  }

  /** Called when local player places a waypoint */
  sendWaypointAdd(opId: number, wpIdx: number, waypoint: Waypoint) {
    if (!this.net || !this.state.multiplayer) return;
    const msg: WaypointAddMsg = {
      type: 'wp_add',
      senderId: this.localPlayerId,
      opId, wpIdx,
      waypoint: JSON.parse(JSON.stringify(waypoint)),
    };
    this.net.sendToAll(msg);
  }

  /** Called when local player drags a waypoint node */
  sendWaypointMove(opId: number, wpIdx: number, position: Vec2) {
    if (!this.net || !this.state.multiplayer) return;
    const msg: WaypointMoveMsg = {
      type: 'wp_move',
      senderId: this.localPlayerId,
      opId, wpIdx, position,
    };
    this.net.sendToAll(msg);
  }

  /** Called when local player deletes a waypoint */
  sendWaypointDelete(opId: number, wpIdx: number) {
    if (!this.net || !this.state.multiplayer) return;
    const msg: WaypointDeleteMsg = {
      type: 'wp_delete',
      senderId: this.localPlayerId,
      opId, wpIdx,
    };
    this.net.sendToAll(msg);
  }

  /** Called when local player sets facing direction */
  sendFacingUpdate(opId: number, wpIdx: number | null, angle: number) {
    if (!this.net || !this.state.multiplayer) return;
    const msg: FacingUpdateMsg = {
      type: 'facing_update',
      senderId: this.localPlayerId,
      opId, wpIdx, angle,
    };
    this.net.sendToAll(msg);
  }

  /** Called when local player changes tempo */
  sendTempoUpdate(opId: number, wpIdx: number | null, tempo: number) {
    if (!this.net || !this.state.multiplayer) return;
    const msg: TempoUpdateMsg = {
      type: 'tempo_update',
      senderId: this.localPlayerId,
      opId, wpIdx, tempo,
    };
    this.net.sendToAll(msg);
  }

  /** Called when local player toggles hold */
  sendHoldToggle(opId: number, wpIdx: number, hold: boolean, goCode: import('../types').GoCode | null) {
    if (!this.net || !this.state.multiplayer) return;
    const msg: HoldToggleMsg = {
      type: 'hold_toggle',
      senderId: this.localPlayerId,
      opId, wpIdx, hold, goCode,
    };
    this.net.sendToAll(msg);
  }

  /** Called when local player sets/clears pie target */
  sendPieUpdate(opId: number, pieTarget: Vec2 | null, angle: number) {
    if (!this.net || !this.state.multiplayer) return;
    const msg: PieUpdateMsg = {
      type: 'pie_update',
      senderId: this.localPlayerId,
      opId, pieTarget, angle,
    };
    this.net.sendToAll(msg);
  }

  /** Called when local player sets a look target */
  sendLookTarget(opId: number, wpIdx: number, lookTarget: Vec2 | null) {
    if (!this.net || !this.state.multiplayer) return;
    const msg: LookTargetMsg = {
      type: 'look_target',
      senderId: this.localPlayerId,
      opId, wpIdx, lookTarget,
    };
    this.net.sendToAll(msg);
  }

  /** Called when local player sets door action on waypoint */
  sendDoorAction(opId: number, wpIdx: number, openDoors: { wallIdx: number; doorIdx: number }[]) {
    if (!this.net || !this.state.multiplayer) return;
    const msg: DoorActionMsg = {
      type: 'door_action',
      senderId: this.localPlayerId,
      opId, wpIdx, openDoors,
    };
    this.net.sendToAll(msg);
  }

  /** Called when local player hits READY */
  sendReady() {
    if (!this.net || !this.state.multiplayer) return;
    const mp = this.state.multiplayer;
    if (!mp.readyPlayers.includes(this.localPlayerId)) {
      mp.readyPlayers.push(this.localPlayerId);
    }
    const msg: ReadyMsg = {
      type: 'ready',
      senderId: this.localPlayerId,
    };
    this.net.sendToAll(msg);
    this.checkAllReady();
    this.onUIUpdate();
  }

  /** Called when local player hits UNREADY */
  sendUnready() {
    if (!this.net || !this.state.multiplayer) return;
    const mp = this.state.multiplayer;
    mp.readyPlayers = mp.readyPlayers.filter(id => id !== this.localPlayerId);
    const msg: UnreadyMsg = {
      type: 'unready',
      senderId: this.localPlayerId,
    };
    this.net.sendToAll(msg);
    this.onUIUpdate();
  }

  // ---- Ownership Checks ----

  /** Check if local player owns an operator (or if no one owns it in single player) */
  isOwnedByLocal(opId: number): boolean {
    if (!this.state.multiplayer) return true; // single player
    const owner = this.state.multiplayer.operatorOwnership[opId];
    return owner === this.localPlayerId || owner === undefined;
  }

  /** Check if an operator is unclaimed */
  isUnclaimed(opId: number): boolean {
    if (!this.state.multiplayer) return true;
    return !(opId in this.state.multiplayer.operatorOwnership);
  }

  /** Get the owner player info for an operator */
  getOwner(opId: number): PlayerInfo | null {
    if (!this.state.multiplayer) return null;
    const ownerId = this.state.multiplayer.operatorOwnership[opId];
    if (!ownerId) return null;
    return this.state.multiplayer.players.find(p => p.id === ownerId) || null;
  }

  // ---- Inbound: Network messages -> Game state ----

  private handleEvent(event: ConnectionEvent) {
    const mp = this.state.multiplayer;
    if (!mp) return;

    switch (event.type) {
      case 'connected':
        // A peer connected (relevant for host)
        break;

      case 'disconnected':
        this.handlePeerDisconnect(event.peerId);
        break;

      case 'message':
        this.handleMessage(event.data);
        break;

      case 'error':
        mp.status = 'error';
        mp.errorMessage = event.error;
        this.addNotification(event.error);
        this.onUIUpdate();
        break;

      case 'open':
        // Our peer ID is ready
        break;
    }
  }

  private handleMessage(msg: NetMessage) {
    const mp = this.state.multiplayer;
    if (!mp) return;

    // Don't apply our own messages (they were already applied locally)
    if (msg.senderId === this.localPlayerId) return;
    
    console.log('[MP] Received:', msg.type, 'from', msg.senderId.substring(0, 12));

    switch (msg.type) {
      case 'player_join': this.onPlayerJoin(msg); break;
      case 'player_leave': this.onPlayerLeave(msg); break;
      case 'player_info': this.onPlayerInfo(msg); break;
      case 'full_state': this.onFullState(msg); break;
      case 'op_claim': this.onOperatorClaim(msg); break;
      case 'op_release': this.onOperatorRelease(msg); break;
      case 'op_move': this.onOperatorMove(msg); break;
      case 'route_start': this.onRouteStart(msg); break;
      case 'wp_add': this.onWaypointAdd(msg); break;
      case 'wp_move': this.onWaypointMove(msg); break;
      case 'wp_delete': this.onWaypointDelete(msg); break;
      case 'facing_update': this.onFacingUpdate(msg); break;
      case 'tempo_update': this.onTempoUpdate(msg); break;
      case 'hold_toggle': this.onHoldToggle(msg); break;
      case 'pie_update': this.onPieUpdate(msg); break;
      case 'look_target': this.onLookTarget(msg); break;
      case 'door_action': this.onDoorAction(msg); break;
      case 'ready': this.onReady(msg); break;
      case 'unready': this.onUnready(msg); break;
      case 'stage_execute': this.onStageExecute(msg); break;
      case 'stage_save': this.onStageSave(msg); break;
      case 'reset': this.onRemoteReset(); break;
      case 'clear_level': this.onRemoteClearLevel(); break;
      case 'replay': this.onRemoteReplay(); break;
      case 'edit_stage': this.onRemoteEditStage((msg as EditStageMsg).stageIndex); break;
    }
  }

  // ---- Player Management ----

  private onPlayerJoin(msg: PlayerJoinMsg) {
    const mp = this.state.multiplayer!;
    // Only host processes joins directly
    if (!mp.isHost) return;

    // Assign next available color
    const usedColors = mp.players.map(p => p.colorIndex);
    let colorIdx = 0;
    for (let i = 0; i < 4; i++) {
      if (!usedColors.includes(i)) { colorIdx = i; break; }
    }

    const newPlayer: PlayerInfo = {
      id: msg.senderId,
      name: msg.name,
      colorIndex: colorIdx,
      connected: true,
    };
    mp.players.push(newPlayer);

    // Broadcast updated player list to all
    this.broadcastPlayerInfo();

    // Send full game state to the new joiner
    if (mp.status === 'in_game') {
      this.sendFullState(msg.senderId);
    }

    this.addNotification(`${msg.name} joined`);
    this.onUIUpdate();
  }

  private onPlayerLeave(msg: { senderId: string }) {
    const mp = this.state.multiplayer!;
    const player = mp.players.find(p => p.id === msg.senderId);
    if (player) {
      player.connected = false;
      this.addNotification(`${player.name} left`);

      // Release their operators
      for (const [opIdStr, ownerId] of Object.entries(mp.operatorOwnership)) {
        if (ownerId === msg.senderId) {
          delete mp.operatorOwnership[parseInt(opIdStr)];
        }
      }

      // Remove from ready list
      mp.readyPlayers = mp.readyPlayers.filter(id => id !== msg.senderId);
    }

    if (mp.isHost) {
      this.broadcastPlayerInfo();
    }
    this.onUIUpdate();
  }

  private handlePeerDisconnect(peerId: string) {
    const mp = this.state.multiplayer!;
    const player = mp.players.find(p => p.id === peerId);

    if (!mp.isHost && peerId.includes(mp.roomCode)) {
      // Host disconnected
      mp.status = 'disconnected';
      mp.errorMessage = 'Host disconnected. Game ended.';
      this.addNotification('Host disconnected');
      this.onUIUpdate();
      return;
    }

    if (player) {
      this.onPlayerLeave({ senderId: peerId });
    }
  }

  private onPlayerInfo(msg: PlayerInfoMsg) {
    const mp = this.state.multiplayer!;
    mp.players = msg.players;
    // Update our own local player ID's color from the authoritative list
    mp.status = 'lobby';
    this.onUIUpdate();
  }

  private broadcastPlayerInfo() {
    if (!this.net || !this.state.multiplayer) return;
    const msg: PlayerInfoMsg = {
      type: 'player_info',
      senderId: this.localPlayerId,
      players: this.state.multiplayer.players,
    };
    this.net.broadcast(msg);
  }

  private sendFullState(targetPeerId: string) {
    if (!this.net || !this.state.multiplayer) return;
    const mp = this.state.multiplayer;
    const sessionData = serializeSession(this.state, '', 7);
    const msg: FullStateMsg = {
      type: 'full_state',
      senderId: this.localPlayerId,
      roomData: sessionData,
      ownership: { ...mp.operatorOwnership },
      readyPlayers: [...mp.readyPlayers],
    };
    this.net.send(targetPeerId, msg);
  }

  private onFullState(msg: FullStateMsg) {
    // Save multiplayer state before restoreSession (it doesn't touch mp, but be safe)
    const mp = this.state.multiplayer!;
    const savedMp = { ...mp, players: [...mp.players] };
    
    console.log('[MP] Received full_state from host, restoring game...');
    console.log('[MP] Room data operators:', msg.roomData?.operators?.length, 'walls:', msg.roomData?.room?.w?.length);
    
    // Restore the full game state from host
    restoreSession(this.state, msg.roomData);
    
    // Re-attach multiplayer state (restoreSession doesn't know about it)
    this.state.multiplayer = savedMp;
    this.state.multiplayer.operatorOwnership = msg.ownership;
    this.state.multiplayer.readyPlayers = msg.readyPlayers;
    this.state.multiplayer.status = 'in_game';
    
    // Ensure game is in planning mode
    this.state.screen = 'game';
    this.state.mode = 'planning';
    
    console.log('[MP] State restored. Operators:', this.state.operators.length, 'Room:', this.state.room.name);
    
    this.onStartGame();
    this.onUIUpdate();
  }

  // ---- Operator actions (inbound) ----

  private onOperatorClaim(msg: OperatorClaimMsg) {
    const mp = this.state.multiplayer!;
    mp.operatorOwnership[msg.opId] = msg.senderId;
    console.log('[MP] Operator', msg.opId, 'claimed by', msg.senderId);
    const op = this.state.operators.find(o => o.id === msg.opId);
    if (op) {
      op.deployed = true;
      op.position = { x: msg.position.x, y: msg.position.y };
      op.startPosition = { x: msg.position.x, y: msg.position.y };
      op.smoothPosition = { x: msg.position.x, y: msg.position.y };
      op.angle = msg.angle;
      op.startAngle = msg.angle;
      op.currentFloor = msg.floor;
      op.startFloor = msg.floor;
    }
  }

  private onOperatorRelease(msg: OperatorReleaseMsg) {
    const mp = this.state.multiplayer!;
    delete mp.operatorOwnership[msg.opId];
    const op = this.state.operators.find(o => o.id === msg.opId);
    if (op) {
      op.deployed = false;
      op.path.waypoints = [];
      op.path.splineLUT = null;
      op.pieTarget = null;
    }
  }

  private onOperatorMove(msg: OperatorMoveMsg) {
    const op = this.state.operators.find(o => o.id === msg.opId);
    if (op) {
      op.position = { x: msg.position.x, y: msg.position.y };
      op.startPosition = { x: msg.position.x, y: msg.position.y };
      op.smoothPosition = { x: msg.position.x, y: msg.position.y };
      op.angle = msg.angle;
      op.startAngle = msg.angle;
      if (op.path.waypoints.length > 0) {
        op.path.waypoints[0].position = { x: msg.position.x, y: msg.position.y };
        rebuildPathLUT(op);
      }
    }
  }

  private onRouteStart(msg: RouteStartMsg) {
    const op = this.state.operators.find(o => o.id === msg.opId);
    if (op && op.path.waypoints.length === 0) {
      op.path.waypoints = [makeWaypoint(op.position, op.currentFloor)];
      op.path.splineLUT = null;
    }
  }

  private onWaypointAdd(msg: WaypointAddMsg) {
    const op = this.state.operators.find(o => o.id === msg.opId);
    if (op) {
      const wp: Waypoint = {
        position: { x: msg.waypoint.position.x, y: msg.waypoint.position.y },
        facingOverride: msg.waypoint.facingOverride,
        lookTarget: msg.waypoint.lookTarget,
        hold: msg.waypoint.hold,
        goCode: msg.waypoint.goCode,
        tempo: msg.waypoint.tempo,
        floorLevel: msg.waypoint.floorLevel,
        openDoors: msg.waypoint.openDoors || [],
      };
      op.path.waypoints.splice(msg.wpIdx, 0, wp);
      rebuildPathLUT(op);
    }
  }

  private onWaypointMove(msg: WaypointMoveMsg) {
    const op = this.state.operators.find(o => o.id === msg.opId);
    if (op && msg.wpIdx < op.path.waypoints.length) {
      op.path.waypoints[msg.wpIdx].position = { x: msg.position.x, y: msg.position.y };
      if (msg.wpIdx === 0) {
        op.position = { x: msg.position.x, y: msg.position.y };
        op.startPosition = { x: msg.position.x, y: msg.position.y };
      }
      rebuildPathLUT(op);
    }
  }

  private onWaypointDelete(msg: WaypointDeleteMsg) {
    const op = this.state.operators.find(o => o.id === msg.opId);
    if (op && op.path.waypoints.length > 2 && msg.wpIdx < op.path.waypoints.length) {
      op.path.waypoints.splice(msg.wpIdx, 1);
      rebuildPathLUT(op);
    }
  }

  private onFacingUpdate(msg: FacingUpdateMsg) {
    const op = this.state.operators.find(o => o.id === msg.opId);
    if (op) {
      if (msg.wpIdx !== null && msg.wpIdx < op.path.waypoints.length) {
        op.path.waypoints[msg.wpIdx].facingOverride = msg.angle;
        op.path.waypoints[msg.wpIdx].lookTarget = null;
      } else {
        op.angle = msg.angle;
        op.startAngle = msg.angle;
      }
    }
  }

  private onTempoUpdate(msg: TempoUpdateMsg) {
    const op = this.state.operators.find(o => o.id === msg.opId);
    if (op) {
      if (msg.wpIdx !== null && msg.wpIdx < op.path.waypoints.length) {
        op.path.waypoints[msg.wpIdx].tempo = msg.tempo;
      } else {
        op.tempo = msg.tempo;
      }
    }
  }

  private onHoldToggle(msg: HoldToggleMsg) {
    const op = this.state.operators.find(o => o.id === msg.opId);
    if (op && msg.wpIdx < op.path.waypoints.length) {
      op.path.waypoints[msg.wpIdx].hold = msg.hold;
      op.path.waypoints[msg.wpIdx].goCode = msg.goCode;
    }
  }

  private onPieUpdate(msg: PieUpdateMsg) {
    const op = this.state.operators.find(o => o.id === msg.opId);
    if (op) {
      op.pieTarget = msg.pieTarget ? { x: msg.pieTarget.x, y: msg.pieTarget.y } : null;
      op.angle = msg.angle;
      op.startAngle = msg.angle;
    }
  }

  private onLookTarget(msg: LookTargetMsg) {
    const op = this.state.operators.find(o => o.id === msg.opId);
    if (op && msg.wpIdx < op.path.waypoints.length) {
      op.path.waypoints[msg.wpIdx].lookTarget = msg.lookTarget;
      if (msg.lookTarget) op.path.waypoints[msg.wpIdx].facingOverride = null;
    }
  }

  private onDoorAction(msg: DoorActionMsg) {
    const op = this.state.operators.find(o => o.id === msg.opId);
    if (op && msg.wpIdx < op.path.waypoints.length) {
      op.path.waypoints[msg.wpIdx].openDoors = msg.openDoors;
    }
  }

  // ---- Ready / Execution ----

  private onReady(msg: ReadyMsg) {
    const mp = this.state.multiplayer!;
    if (!mp.readyPlayers.includes(msg.senderId)) {
      mp.readyPlayers.push(msg.senderId);
    }
    this.onUIUpdate();

    // Host checks if all ready
    if (mp.isHost) {
      this.checkAllReady();
    }
  }

  private onUnready(msg: UnreadyMsg) {
    const mp = this.state.multiplayer!;
    mp.readyPlayers = mp.readyPlayers.filter(id => id !== msg.senderId);
    this.onUIUpdate();
  }

  private checkAllReady() {
    const mp = this.state.multiplayer;
    if (!mp || !mp.isHost) return;

    const connectedPlayers = mp.players.filter(p => p.connected);
    if (connectedPlayers.length < 2) return; // need at least 2 players

    const allReady = connectedPlayers.every(p => mp.readyPlayers.includes(p.id));
    if (allReady) {
      // All players ready - trigger execution
      const msg: StageExecuteMsg = {
        type: 'stage_execute',
        senderId: this.localPlayerId,
        startTime: Date.now() + 500, // 500ms grace period for sync
      };
      this.net?.broadcast(msg);
      // Host also executes locally
      mp.readyPlayers = [];
      doGo(this.state);
      this.onUIUpdate();
    }
  }

  private onStageExecute(_msg: StageExecuteMsg) {
    const mp = this.state.multiplayer!;
    mp.readyPlayers = [];
    doGo(this.state);
    this.onUIUpdate();
  }

  private onStageSave(msg: StageSaveMsg) {
    // Host broadcasts stage save - apply it locally
    saveStage(this.state);
    this.onUIUpdate();
  }

  /** Host broadcasts that stage was saved */
  sendStageSave() {
    if (!this.net || !this.state.multiplayer) return;
    const msg: StageSaveMsg = {
      type: 'stage_save',
      senderId: this.localPlayerId,
      stageData: null,
    };
    this.net.sendToAll(msg);
  }

  sendReset() {
    if (!this.net || !this.state.multiplayer) return;
    const msg: ResetMsg = { type: 'reset', senderId: this.localPlayerId };
    this.net.sendToAll(msg);
  }

  sendClearLevel() {
    if (!this.net || !this.state.multiplayer) return;
    const msg: ClearLevelMsg = { type: 'clear_level', senderId: this.localPlayerId };
    this.net.sendToAll(msg);
  }

  sendReplay() {
    if (!this.net || !this.state.multiplayer) return;
    const msg: ReplayMsg = { type: 'replay', senderId: this.localPlayerId };
    this.net.sendToAll(msg);
  }

  sendEditStage(stageIndex: number) {
    if (!this.net || !this.state.multiplayer) return;
    const msg: EditStageMsg = { type: 'edit_stage', senderId: this.localPlayerId, stageIndex };
    this.net.sendToAll(msg);
  }

  // ---- Receive handlers for new message types ----

  private onRemoteReset() {
    doReset(this.state);
    this.onUIUpdate();
  }

  private onRemoteClearLevel() {
    doClearLevel(this.state);
    this.onUIUpdate();
  }

  private onRemoteReplay() {
    doReplay(this.state);
    this.onUIUpdate();
  }

  private onRemoteEditStage(stageIndex: number) {
    this.state.viewingStageIndex = stageIndex;
    editStage(this.state);
    this.onUIUpdate();
  }

  /** Host starts the game (transitions from lobby to in_game) */
  startGame(selRoom: string, selOpCount: number) {
    if (!this.state.multiplayer || !this.state.multiplayer.isHost) return;
    const mp = this.state.multiplayer;
    mp.status = 'in_game';

    // Send full state to all clients
    const sessionData = serializeSession(this.state, selRoom, selOpCount);
    for (const player of mp.players) {
      if (player.id === this.localPlayerId) continue;
      const msg: FullStateMsg = {
        type: 'full_state',
        senderId: this.localPlayerId,
        roomData: sessionData,
        ownership: { ...mp.operatorOwnership },
        readyPlayers: [],
      };
      this.net?.send(player.id, msg);
    }
    this.onStartGame();
  }

  // ---- Utilities ----

  private addNotification(text: string) {
    const mp = this.state.multiplayer;
    if (!mp) return;
    mp.notifications.push({ text, time: Date.now() });
    // Keep last 5
    if (mp.notifications.length > 5) mp.notifications.shift();
  }

  /** Clean up old notifications (call from game loop) */
  tickNotifications() {
    const mp = this.state.multiplayer;
    if (!mp) return;
    const now = Date.now();
    mp.notifications = mp.notifications.filter(n => now - n.time < 5000);
  }
}
