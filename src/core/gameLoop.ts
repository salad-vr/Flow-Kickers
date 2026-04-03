export type UpdateFn = (dt: number) => void;
export type RenderFn = () => void;

let lastTime = 0;
let running = false;
let animFrameId = 0;
let updateFn: UpdateFn | null = null;
let renderFn: RenderFn | null = null;
let paused = false;

function loop(time: number) {
  animFrameId = requestAnimationFrame(loop);

  const dt = Math.min((time - lastTime) / 1000, 0.05); // cap at 50ms
  lastTime = time;

  if (!paused && updateFn) {
    updateFn(dt);
  }

  if (renderFn) {
    renderFn();
  }
}

export function startGameLoop(update: UpdateFn, render: RenderFn) {
  updateFn = update;
  renderFn = render;
  if (!running) {
    running = true;
    lastTime = performance.now();
    animFrameId = requestAnimationFrame(loop);
  }
}

export function stopGameLoop() {
  running = false;
  cancelAnimationFrame(animFrameId);
}

export function setPaused(p: boolean) {
  paused = p;
}

export function isPaused(): boolean {
  return paused;
}
