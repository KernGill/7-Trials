import { FPS } from '../utils/Constants.js';

export class GameLoop {
  constructor(update, render, fps = FPS) {
    this.update = update;
    this.render = render;
    this.fps = fps;
    this.running = false;
    this.lastTime = 0;
    this.accumulator = 0;
    this.frame = 0;
  }

  /** Takes effect on the very next tick — no restart needed. */
  setFPS(fps) {
    this.fps = Math.max(1, fps);
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.lastTime = performance.now();
    requestAnimationFrame(this.tick.bind(this));
  }

  stop() {
    this.running = false;
  }

  tick(now) {
    if (!this.running) return;
    const delta = now - this.lastTime;
    this.lastTime = now;
    this.accumulator += delta;
    const step = 1000 / this.fps;

    while (this.accumulator >= step) {
      this.update(step / 1000);
      this.accumulator -= step;
      this.frame += 1;
    }

    this.render();
    requestAnimationFrame(this.tick.bind(this));
  }
}
