import { FPS } from '../utils/Constants.js';

// A backgrounded tab throttles/pauses requestAnimationFrame — on return,
// `delta` could otherwise be huge, and the fixed-timestep catch-up loop in
// tick() would fire potentially hundreds of update() calls synchronously in
// one frame (a classic "spiral of death"), freezing the tab on resume.
// Clamping delta treats a long pause as one dropped beat instead.
const MAX_DELTA_MS = 250;

export class GameLoop {
  constructor(update, render, fps = FPS) {
    this.update = update;
    this.render = render;
    this.fps = fps;
    this.running = false;
    this.lastTime = 0;
    this.accumulator = 0;
    this.frame = 0;
    // Bound once and reused — see tick()'s own requestAnimationFrame call,
    // which would otherwise allocate a fresh bound function every single
    // frame forever (DungeonRenderer3D._animate already does this
    // correctly; this mirrors that).
    this._boundTick = this.tick.bind(this);
  }

  /** Takes effect on the very next tick — no restart needed. */
  setFPS(fps) {
    this.fps = Math.max(1, fps);
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.lastTime = performance.now();
    requestAnimationFrame(this._boundTick);
  }

  stop() {
    this.running = false;
  }

  tick(now) {
    if (!this.running) return;
    const delta = Math.min(now - this.lastTime, MAX_DELTA_MS);
    this.lastTime = now;
    this.accumulator += delta;
    const step = 1000 / this.fps;

    while (this.accumulator >= step) {
      this.update(step / 1000);
      this.accumulator -= step;
      this.frame += 1;
    }

    this.render();
    requestAnimationFrame(this._boundTick);
  }
}
