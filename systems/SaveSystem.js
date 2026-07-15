export const SAVE_SLOT_COUNT = 3;

const LEGACY_KEY = 'seven_trials_save';
const SLOT_KEY_PREFIX = 'seven_trials_save_slot_';
const ACTIVE_SLOT_KEY = 'seven_trials_active_slot';

export class SaveSystem {
  constructor(gameState) {
    this.gameState = gameState;
    this.migrateLegacySave();
    this.activeSlot = this.readActiveSlot();
  }

  /**
   * Everyone already using the game has their progress under the old
   * single-key scheme. On first boot under the new slot system, that
   * data becomes Slot 1 verbatim — copied once, never overwritten by
   * this migration again (checked via slot 1 already existing), and the
   * legacy key itself is left alone as an inert backup.
   */
  migrateLegacySave() {
    const legacy = localStorage.getItem(LEGACY_KEY);
    if (!legacy || localStorage.getItem(this.slotKey(1))) return;
    localStorage.setItem(this.slotKey(1), legacy);
  }

  slotKey(slot) {
    return `${SLOT_KEY_PREFIX}${slot}`;
  }

  readActiveSlot() {
    const n = Number(localStorage.getItem(ACTIVE_SLOT_KEY));
    return Number.isInteger(n) && n >= 1 && n <= SAVE_SLOT_COUNT ? n : 1;
  }

  setActiveSlot(slot) {
    this.activeSlot = slot;
    localStorage.setItem(ACTIVE_SLOT_KEY, String(slot));
  }

  save(slot = this.activeSlot) {
    const payload = this.gameState.getSnapshot();
    localStorage.setItem(this.slotKey(slot), JSON.stringify(payload));
    return true;
  }

  load(slot = this.activeSlot) {
    const raw = localStorage.getItem(this.slotKey(slot));
    if (!raw) return false;
    try {
      const snapshot = JSON.parse(raw);
      this.gameState.loadSnapshot(snapshot);
      return true;
    } catch {
      return false;
    }
  }

  /** Read-only peek at a slot's raw snapshot, for the slot-picker preview — never touches live gameState. */
  peek(slot) {
    const raw = localStorage.getItem(this.slotKey(slot));
    if (!raw) return null;
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }

  hasSlot(slot) {
    return localStorage.getItem(this.slotKey(slot)) !== null;
  }

  clearSlot(slot) {
    localStorage.removeItem(this.slotKey(slot));
  }

  clear() {
    this.clearSlot(this.activeSlot);
  }
}
