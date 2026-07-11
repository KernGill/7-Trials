export class SaveSystem {
  constructor(gameState) {
    this.gameState = gameState;
    this.storageKey = 'seven_trials_save';
  }

  save() {
    const payload = this.gameState.getSnapshot();
    localStorage.setItem(this.storageKey, JSON.stringify(payload));
    return true;
  }

  load() {
    const raw = localStorage.getItem(this.storageKey);
    if (!raw) return false;
    try {
      const snapshot = JSON.parse(raw);
      this.gameState.loadSnapshot(snapshot);
      return true;
    } catch {
      return false;
    }
  }

  clear() {
    localStorage.removeItem(this.storageKey);
  }
}
