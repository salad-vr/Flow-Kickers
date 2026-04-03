import type { Vec2 } from '../math/vec2';

export interface InputState {
  mousePos: Vec2;        // screen-space (pixel coords on canvas)
  mouseDown: boolean;
  rightMouseDown: boolean;
  middleMouseDown: boolean;
  mouseButton: number;
  justPressed: boolean;
  justReleased: boolean;
  rightJustPressed: boolean;
  rightJustReleased: boolean;
  middleJustPressed: boolean;
  middleJustReleased: boolean;
  dragStart: Vec2 | null;
  isDragging: boolean;
  scrollDelta: number;   // positive = zoom in, negative = zoom out
  keys: Set<string>;
  keysJustPressed: Set<string>;
}

const state: InputState = {
  mousePos: { x: 0, y: 0 },
  mouseDown: false,
  rightMouseDown: false,
  middleMouseDown: false,
  mouseButton: -1,
  justPressed: false,
  justReleased: false,
  rightJustPressed: false,
  rightJustReleased: false,
  middleJustPressed: false,
  middleJustReleased: false,
  dragStart: null,
  isDragging: false,
  scrollDelta: 0,
  keys: new Set(),
  keysJustPressed: new Set(),
};

let canvas: HTMLCanvasElement | null = null;

export function initInput(c: HTMLCanvasElement) {
  canvas = c;
  canvas.addEventListener('mousedown', onMouseDown);
  canvas.addEventListener('mousemove', onMouseMove);
  canvas.addEventListener('mouseup', onMouseUp);
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  canvas.addEventListener('wheel', onWheel, { passive: false });
  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
}

function getCanvasPos(e: MouseEvent): Vec2 {
  if (!canvas) return { x: 0, y: 0 };
  const rect = canvas.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0) return { x: 0, y: 0 };
  const scaleX = canvas.width / rect.width;
  const scaleY = canvas.height / rect.height;
  return {
    x: (e.clientX - rect.left) * scaleX,
    y: (e.clientY - rect.top) * scaleY,
  };
}

function onMouseDown(e: MouseEvent) {
  const pos = getCanvasPos(e);
  state.mousePos = pos;
  state.mouseButton = e.button;
  if (e.button === 0) {
    state.mouseDown = true;
    state.justPressed = true;
    state.dragStart = { x: pos.x, y: pos.y };
  } else if (e.button === 1) {
    e.preventDefault();
    state.middleMouseDown = true;
    state.middleJustPressed = true;
  } else if (e.button === 2) {
    state.rightMouseDown = true;
    state.rightJustPressed = true;
  }
}

function onMouseMove(e: MouseEvent) {
  state.mousePos = getCanvasPos(e);
  if (state.mouseDown && state.dragStart) {
    const dx = state.mousePos.x - state.dragStart.x;
    const dy = state.mousePos.y - state.dragStart.y;
    if (dx * dx + dy * dy > 25) state.isDragging = true;
  }
}

function onMouseUp(e: MouseEvent) {
  if (e.button === 0) {
    state.mouseDown = false;
    state.justReleased = true;
    state.isDragging = false;
    state.dragStart = null;
  } else if (e.button === 1) {
    state.middleMouseDown = false;
    state.middleJustReleased = true;
  } else if (e.button === 2) {
    state.rightMouseDown = false;
    state.rightJustReleased = true;
  }
}

function onWheel(e: WheelEvent) {
  e.preventDefault();
  state.scrollDelta += -e.deltaY; // positive = zoom in
}

function onKeyDown(e: KeyboardEvent) {
  if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
  state.keys.add(e.key.toLowerCase());
  state.keysJustPressed.add(e.key.toLowerCase());
}

function onKeyUp(e: KeyboardEvent) {
  state.keys.delete(e.key.toLowerCase());
}

export function clearFrameInput() {
  state.justPressed = false;
  state.justReleased = false;
  state.rightJustPressed = false;
  state.rightJustReleased = false;
  state.middleJustPressed = false;
  state.middleJustReleased = false;
  state.scrollDelta = 0;
  state.keysJustPressed.clear();
}

export function getInput(): InputState {
  return state;
}
