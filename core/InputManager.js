export class InputManager {
  constructor(root) {
    this.root = root;
    this.handlers = new Map();
    this.boundKeydown = this.onKeydown.bind(this);
    window.addEventListener('keydown', this.boundKeydown);
  }

  on(event, handler) {
    if (!this.handlers.has(event)) this.handlers.set(event, new Set());
    this.handlers.get(event).add(handler);
  }

  off(event, handler) {
    this.handlers.get(event)?.delete(handler);
  }

  emit(event, payload) {
    this.handlers.get(event)?.forEach((handler) => handler(payload));
  }

  onKeydown(event) {
    const key = event.key.toLowerCase();
    this.emit('keydown', { key, originalEvent: event });
    const map = {
      f: 'navigate_battle',
      s: 'navigate_shop',
      i: 'navigate_inn',
      e: 'navigate_locker',
      b: 'navigate_bestiary',
      o: 'navigate_settings',
      p: 'toggle_pause',
    };
    if (map[key]) this.emit(map[key], { key });
  }

  destroy() {
    window.removeEventListener('keydown', this.boundKeydown);
  }
}
