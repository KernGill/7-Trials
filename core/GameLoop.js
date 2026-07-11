import { FPS } from '../utils/Constants.js';

export class GameLoop {
  constructor(update, render) {
    this.update = update;
    this.render = render;
    this.running = false;
    this.lastTime = 0;
    this.accumulator = 0;
    this.frame = 0;
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
    const step = 1000 / FPS;

    while (this.accumulator >= step) {
      this.update(step / 1000);
      this.accumulator -= step;
      this.frame += 1;
    }

    this.render();
    requestAnimationFrame(this.tick.bind(this));
  }
}
