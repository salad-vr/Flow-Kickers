/**
 * PeerJS wrapper for WebRTC multiplayer.
 * Star topology: host acts as relay hub. All messages go through host.
 * Host broadcasts to other clients.
 */
import Peer from 'peerjs';
import type { NetMessage } from './types';

// PeerJS DataConnection type - use ReturnType to avoid direct import issues
type DataConnection = ReturnType<Peer['connect']>;

// Room code prefix so PeerJS IDs don't collide with other apps
const PEER_PREFIX = 'fk-';

/** Generate a short room code like "FKAB12" */
function generateRoomCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no I,O,0,1 to avoid confusion
  let code = '';
  for (let i = 0; i < 4; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return 'FK' + code;
}

export type ConnectionEvent =
  | { type: 'connected'; peerId: string }
  | { type: 'disconnected'; peerId: string }
  | { type: 'message'; peerId: string; data: NetMessage }
  | { type: 'error'; error: string }
  | { type: 'open'; myPeerId: string };

export type EventCallback = (event: ConnectionEvent) => void;

export class NetworkManager {
  private peer: Peer | null = null;
  private connections: Map<string, DataConnection> = new Map();
  private callback: EventCallback;
  private _isHost = false;
  private _roomCode = '';
  private _myPeerId = '';
  private _destroyed = false;

  constructor(callback: EventCallback) {
    this.callback = callback;
  }

  get isHost() { return this._isHost; }
  get roomCode() { return this._roomCode; }
  get myPeerId() { return this._myPeerId; }
  get connectedPeerIds(): string[] { return Array.from(this.connections.keys()); }

  /** Create a room (host). Returns the room code. */
  createRoom(): Promise<string> {
    return new Promise((resolve, reject) => {
      this._isHost = true;
      this._roomCode = generateRoomCode();
      const peerId = PEER_PREFIX + this._roomCode;

      this.peer = new Peer(peerId, {
        debug: 0, // 0=none, 1=errors, 2=warnings, 3=all
      });

      this.peer.on('open', (id) => {
        this._myPeerId = id;
        this.callback({ type: 'open', myPeerId: id });
        resolve(this._roomCode);
      });

      this.peer.on('connection', (conn) => {
        this.setupConnection(conn);
      });

      this.peer.on('error', (err) => {
        const msg = (err as any).type === 'unavailable-id'
          ? 'Room code already in use. Try again.'
          : `Connection error: ${err.message || err}`;
        this.callback({ type: 'error', error: msg });
        reject(new Error(msg));
      });

      this.peer.on('disconnected', () => {
        if (!this._destroyed) {
          this.callback({ type: 'error', error: 'Lost connection to signaling server. Trying to reconnect...' });
          this.peer?.reconnect();
        }
      });
    });
  }

  /** Join an existing room (client). */
  joinRoom(roomCode: string): Promise<void> {
    return new Promise((resolve, reject) => {
      this._isHost = false;
      this._roomCode = roomCode.toUpperCase();
      const hostPeerId = PEER_PREFIX + this._roomCode;

      // Generate a unique client peer ID
      const clientId = PEER_PREFIX + this._roomCode + '-' + Math.random().toString(36).substring(2, 8);

      this.peer = new Peer(clientId, {
        debug: 0,
      });

      this.peer.on('open', (id) => {
        this._myPeerId = id;
        this.callback({ type: 'open', myPeerId: id });

        // Connect to host
        const conn = this.peer!.connect(hostPeerId, { reliable: true });
        this.setupConnection(conn);

        conn.on('open', () => {
          resolve();
        });

        conn.on('error', (err) => {
          const msg = `Failed to connect to room: ${err}`;
          this.callback({ type: 'error', error: msg });
          reject(new Error(msg));
        });
      });

      this.peer.on('error', (err) => {
        const errType = (err as any).type;
        let msg: string;
        if (errType === 'peer-unavailable') {
          msg = `Room "${this._roomCode}" not found. Check the code and try again.`;
        } else {
          msg = `Connection error: ${err.message || err}`;
        }
        this.callback({ type: 'error', error: msg });
        reject(new Error(msg));
      });

      this.peer.on('disconnected', () => {
        if (!this._destroyed) {
          this.callback({ type: 'error', error: 'Lost connection. Trying to reconnect...' });
          this.peer?.reconnect();
        }
      });

      // For clients: also handle incoming connections (in case host relays through them - not used in star topology, but good to have)
      this.peer.on('connection', (conn) => {
        this.setupConnection(conn);
      });
    });
  }

  private setupConnection(conn: DataConnection) {
    console.log('[PEER] setupConnection for', conn.peer, 'open?', conn.open);
    
    conn.on('open', () => {
      console.log('[PEER] Connection OPEN with', conn.peer, '| Total connections:', this.connections.size + 1);
      this.connections.set(conn.peer, conn);
      this.callback({ type: 'connected', peerId: conn.peer });
    });

    conn.on('data', (data) => {
      const msg = data as NetMessage;
      console.log('[PEER] DATA from', conn.peer, ':', msg.type);
      this.callback({ type: 'message', peerId: conn.peer, data: msg });

      // Host relays messages to all other connected peers
      if (this._isHost) {
        console.log('[PEER] Host relaying', msg.type, 'to', this.connections.size - 1, 'other peers');
        this.broadcast(msg, conn.peer);
      }
    });

    conn.on('close', () => {
      this.connections.delete(conn.peer);
      this.callback({ type: 'disconnected', peerId: conn.peer });
    });

    conn.on('error', (err) => {
      console.warn('Connection error with', conn.peer, err);
      this.connections.delete(conn.peer);
      this.callback({ type: 'disconnected', peerId: conn.peer });
    });
  }

  /** Send a message to a specific peer */
  send(peerId: string, msg: NetMessage) {
    const conn = this.connections.get(peerId);
    if (conn && conn.open) {
      conn.send(msg);
    } else {
      console.warn('[PEER] send FAILED - no open connection for', peerId, '| connections:', Array.from(this.connections.keys()));
    }
  }

  /** Send a message to all connected peers */
  broadcast(msg: NetMessage, excludePeerId?: string) {
    for (const [peerId, conn] of this.connections) {
      if (peerId === excludePeerId) continue;
      if (conn.open) conn.send(msg);
    }
  }

  /** Send to host (for clients) or broadcast (for host) */
  sendToAll(msg: NetMessage) {
    console.log('[PEER] sendToAll:', msg.type, '| isHost:', this._isHost, '| connections:', this.connections.size);
    if (this._isHost) {
      this.broadcast(msg);
    } else {
      // Client: send only to host (host will relay)
      const hostPeerId = PEER_PREFIX + this._roomCode;
      this.send(hostPeerId, msg);
    }
  }

  /** Clean up everything */
  destroy() {
    this._destroyed = true;
    for (const conn of this.connections.values()) {
      conn.close();
    }
    this.connections.clear();
    if (this.peer) {
      this.peer.destroy();
      this.peer = null;
    }
  }
}
