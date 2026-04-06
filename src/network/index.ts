/**
 * Global network sync accessor.
 * Allows game modules to check multiplayer state and send messages
 * without circular dependencies.
 */
import type { NetworkSync } from './sync';

let _netSync: NetworkSync | null = null;

export function setNetSync(sync: NetworkSync | null) {
  _netSync = sync;
}

export function getNetSync(): NetworkSync | null {
  return _netSync;
}
