import type { GameState, RadialMenu, RadialMenuItem, Operator, DoorRef } from '../types';
import { DOOR_W, makeWaypoint } from '../types';
import type { Vec2 } from '../math/vec2';
import { distance, copy } from '../math/vec2';
import { rebuildPathLUT } from '../operator/pathFollower';
import { getNetSync } from '../network/index';

// ---- Radial Menu Definitions ----
export const RADIAL_R = 28; // radius of icon ring around center (world-space)
export const RADIAL_ICON_R = 10; // radius of each icon hit area (world-space)

const OP_RADIAL_ITEMS: RadialMenuItem[] = [
  { id: 'direction', icon: 'direction', label: 'Direction' },
  { id: 'pie',       icon: 'pie',       label: 'Pie' },
  { id: 'route',     icon: 'route',     label: 'Route' },
  { id: 'speed',     icon: 'speed',     label: 'Speed' },
];

const NODE_RADIAL_ITEMS: RadialMenuItem[] = [
  { id: 'direction', icon: 'direction', label: 'Direction' },
  { id: 'route',     icon: 'route',     label: 'Add Route' },
  { id: 'delete',    icon: 'delete',    label: 'Delete' },
  { id: 'speed',     icon: 'speed',     label: 'Speed' },
  { id: 'hold',      icon: 'hold',      label: 'Hold' },
];

/** Find all doors within radius of a world position */
export function findDoorsNear(pos: { x: number; y: number }, radius: number, state: GameState): { wallIdx: number; doorIdx: number; dist: number }[] {
  const results: { wallIdx: number; doorIdx: number; dist: number }[] = [];
  for (let wi = 0; wi < state.room.walls.length; wi++) {
    const w = state.room.walls[wi];
    const dx = w.b.x - w.a.x, dy = w.b.y - w.a.y;
    for (let di = 0; di < w.doors.length; di++) {
      const d = w.doors[di];
      const doorX = w.a.x + dx * d.pos;
      const doorY = w.a.y + dy * d.pos;
      const dist = Math.sqrt((pos.x - doorX) ** 2 + (pos.y - doorY) ** 2);
      if (dist < radius) results.push({ wallIdx: wi, doorIdx: di, dist });
    }
  }
  results.sort((a, b) => a.dist - b.dist);
  return results;
}

export function getRadialItems(wpIdx: number, state: GameState, opId?: number): RadialMenuItem[] {
  if (wpIdx < 0) return OP_RADIAL_ITEMS;
  const op = state.operators.find(o => o.id === opId);
  if (op && wpIdx < op.path.waypoints.length) {
    const wp = op.path.waypoints[wpIdx];
    const nearDoors = findDoorsNear(wp.position, DOOR_W * 2, state);
    if (nearDoors.length > 0) {
      const hasDoorAction = wp.openDoors && wp.openDoors.length > 0;
      return [
        ...NODE_RADIAL_ITEMS,
        { id: 'door', icon: 'door', label: hasDoorAction ? 'Cancel Door' : 'Open Door' },
      ];
    }
  }
  return NODE_RADIAL_ITEMS;
}

/** Get world-space position of a radial menu icon */
export function getRadialIconPos(center: Vec2, idx: number, total: number): Vec2 {
  const a = -Math.PI / 2 + (idx / total) * Math.PI * 2;
  return { x: center.x + Math.cos(a) * RADIAL_R, y: center.y + Math.sin(a) * RADIAL_R };
}

/** Hit-test radial menu icons in world-space, return index or -1 */
export function hitTestRadialMenu(worldMouse: Vec2, menu: RadialMenu, state: GameState): number {
  const items = getRadialItems(menu.wpIdx, state, menu.opId);
  for (let i = 0; i < items.length; i++) {
    const p = getRadialIconPos(menu.center, i, items.length);
    if (distance(worldMouse, p) < RADIAL_ICON_R + 2) return i;
  }
  return -1;
}

/** Bake pie target direction into operator startAngle so facing persists after pie is removed */
export function bakePieDirection(op: Operator) {
  if (!op.pieTarget) return;
  const pie = op.pieTarget;
  const dx = pie.x - op.position.x, dy = pie.y - op.position.y;
  if (dx * dx + dy * dy > 1) {
    op.angle = Math.atan2(dy, dx);
    op.startAngle = op.angle;
  }
}

/** Handle radial menu item selection. Returns true if an item was acted upon. */
export function handleRadialItemAction(
  item: RadialMenuItem,
  op: Operator,
  menu: RadialMenu,
  state: GameState,
  canvas: HTMLCanvasElement,
): void {
  const sync = getNetSync();
  if (menu.wpIdx < 0) {
    // Operator radial menu actions
    if (item.id === 'direction') {
      state.interaction = { type: 'spinning_direction', opId: op.id };
    } else if (item.id === 'pie') {
      if (op.pieTarget) {
        bakePieDirection(op);
        op.pieTarget = null;
        if (sync) sync.sendPieUpdate(op.id, null, op.angle);
        state.interaction = { type: 'idle' };
      } else {
        state.interaction = { type: 'placing_pie', opId: op.id };
      }
    } else if (item.id === 'route') {
      if (op.path.waypoints.length === 0) {
        op.path.waypoints = [makeWaypoint(op.position, op.currentFloor)];
        op.path.splineLUT = null;
        if (sync) sync.sendRouteStart(op.id);
      }
      state.interaction = { type: 'placing_waypoints', opId: op.id };
    } else if (item.id === 'speed') {
      const cam2 = state.camera;
      const sp2 = { x: (op.position.x - cam2.x) * cam2.zoom + canvas.width / 2, y: (op.position.y - cam2.y) * cam2.zoom + canvas.height / 2 };
      state.speedSlider = { screenPos: { x: sp2.x + 20, y: sp2.y + 20 }, value: op.tempo, dragging: false };
      state.interaction = { type: 'speed_slider', opId: op.id, wpIdx: null, sliderValue: op.tempo };
    }
  } else {
    // Node radial menu actions
    const wp = op.path.waypoints[menu.wpIdx];
    if (item.id === 'direction') {
      state.interaction = { type: 'setting_facing', opId: op.id, wpIdx: menu.wpIdx };
    } else if (item.id === 'route') {
      state.interaction = { type: 'placing_waypoints', opId: op.id };
    } else if (item.id === 'delete') {
      if (op.path.waypoints.length > 2) {
        op.path.waypoints.splice(menu.wpIdx, 1);
        rebuildPathLUT(op);
        if (sync) sync.sendWaypointDelete(op.id, menu.wpIdx);
      }
    } else if (item.id === 'speed') {
      const cam2 = state.camera;
      const sp2 = { x: (wp.position.x - cam2.x) * cam2.zoom + canvas.width / 2, y: (wp.position.y - cam2.y) * cam2.zoom + canvas.height / 2 };
      state.speedSlider = { screenPos: { x: sp2.x + 20, y: sp2.y + 20 }, value: wp.tempo, dragging: false };
      state.interaction = { type: 'speed_slider', opId: op.id, wpIdx: menu.wpIdx, sliderValue: wp.tempo };
    } else if (item.id === 'hold') {
      wp.hold = !wp.hold;
      if (wp.hold && !wp.goCode) wp.goCode = 'A';
      if (sync) sync.sendHoldToggle(op.id, menu.wpIdx, wp.hold, wp.goCode);
    } else if (item.id === 'door') {
      if (wp.openDoors && wp.openDoors.length > 0) {
        wp.openDoors = [];
      } else {
        const nearDoors = findDoorsNear(wp.position, DOOR_W * 2, state);
        wp.openDoors = nearDoors.map(nd => ({ wallIdx: nd.wallIdx, doorIdx: nd.doorIdx }));
      }
      if (sync) sync.sendDoorAction(op.id, menu.wpIdx, wp.openDoors);
    }
  }
}
