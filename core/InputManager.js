export class InputManager {
  constructor(root) {
    this.root = root;
    this.handlers = new Map();
    this.boundKeydown = this.onKeydown.bind(this);
    this.boundKeyup = this.onKeyup.bind(this);
    window.addEventListener('keydown', this.boundKeydown);
    window.addEventListener('keyup', this.boundKeyup);
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
      l: 'navigate_saves',
      p: 'toggle_pause',
    };
    if (map[key]) this.emit(map[key], { key });
  }

  /** Mirrors onKeydown's lowercasing — used by anything that needs to know when a held key is released (e.g. ExploreState's continuous movement), not just when it's first pressed. */
  onKeyup(event) {
    const key = event.key.toLowerCase();
    this.emit('keyup', { key, originalEvent: event });
  }

  destroy() {
    window.removeEventListener('keydown', this.boundKeydown);
    window.removeEventListener('keyup', this.boundKeyup);
  }
}
