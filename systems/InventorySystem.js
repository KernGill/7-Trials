import { SINGLE_EQUIPMENT_SLOTS, MULTI_EQUIPMENT_SLOTS, STAT_KEYS } from '../utils/Constants.js';
import { getItemConfig } from '../data/items.js';
import { deepClone } from '../utils/MathUtils.js';

const LOADOUT_SLOT_COUNT = 5;

/**
 * Equipment model: single slots (mainWeapon, offHand, chest, head,
 * boots, arms, legs) hold exactly one item each. ring/glove/accessory
 * are "multi" categories that can hold up to MULTI_EQUIPMENT_SLOTS[cat]
 * items simultaneously (arrays), replacing the old numbered ring1/ring2
 * (etc) scheme — which had a real bug: every ring/glove/accessory item's
 * `type` was hardcoded to the "1" variant and nothing in the UI ever
 * targeted the "2" slot, so it was permanently unreachable.
 *
 * Ownership is a count (player.ownedEquipment[itemId] = quantity), not
 * a boolean — you can buy multiple copies of the same item, which is
 * what lets you fill both ring slots with two Wooden Rings, etc.
 */
export class InventorySystem {
  constructor(gameState) {
    this.gameState = gameState;
  }

  get player() {
    return this.gameState.player;
  }

  ensureEquippedStructure() {
    SINGLE_EQUIPMENT_SLOTS.forEach((slot) => {
      if (this.player.equipped[slot] === undefined) this.player.equipped[slot] = null;
    });
    Object.keys(MULTI_EQUIPMENT_SLOTS).forEach((slot) => {
      if (!Array.isArray(this.player.equipped[slot])) this.player.equipped[slot] = [];
    });
  }

  forEachEquippedItem(fn) {
    this.ensureEquippedStructure();
    SINGLE_EQUIPMENT_SLOTS.forEach((slot) => fn(this.player.equipped[slot], slot));
    Object.keys(MULTI_EQUIPMENT_SLOTS).forEach((category) => {
      this.player.equipped[category].forEach((itemId) => fn(itemId, category));
    });
  }

  getEquippedStatTotals() {
    const totals = {};
    STAT_KEYS.forEach((stat) => { totals[stat] = 0; });
    this.forEachEquippedItem((itemId) => {
      if (!itemId) return;
      const config = getItemConfig(itemId);
      if (!config?.stats) return;
      Object.entries(config.stats).forEach(([stat, value]) => {
        totals[stat] = (totals[stat] ?? 0) + value;
      });
    });
    return totals;
  }

  getEquippedMoveIds() {
    const moveIds = [];
    this.forEachEquippedItem((itemId) => {
      if (!itemId) return;
      const config = getItemConfig(itemId);
      moveIds.push(...(config?.moveIds ?? []));
    });
    return moveIds;
  }

  countEquippedInstances(itemId) {
    let count = 0;
    this.forEachEquippedItem((id) => { if (id === itemId) count += 1; });
    return count;
  }

  ownsItem(itemId) {
    return this.getOwnedCount(itemId) > 0;
  }

  getOwnedCount(itemId) {
    return this.player.ownedEquipment[itemId] ?? 0;
  }

  /** Buying/finding an item increases how many copies you own (supports owning duplicates). */
  addItem(itemId, amount = 1) {
    this.player.ownedEquipment[itemId] = (this.player.ownedEquipment[itemId] ?? 0) + amount;
  }

  /** Selling an item decreases how many copies you own (floors at 0), auto-unequipping any now-unowned copies so equipped state never outpaces ownership. */
  removeItem(itemId, amount = 1) {
    const next = Math.max(0, this.getOwnedCount(itemId) - amount);
    this.player.ownedEquipment[itemId] = next;
    this.ensureEquippedStructure();
    while (this.countEquippedInstances(itemId) > next) {
      const singleSlot = SINGLE_EQUIPMENT_SLOTS.find((slot) => this.player.equipped[slot] === itemId);
      if (singleSlot) { this.player.equipped[singleSlot] = null; continue; }
      const multiSlot = Object.keys(MULTI_EQUIPMENT_SLOTS).find((slot) => this.player.equipped[slot].includes(itemId));
      if (multiSlot) { this.unequipSlot(multiSlot, itemId); continue; }
      break; // shouldn't happen — safety valve against an infinite loop
    }
  }

  addMaterial(materialId, amount, toRun = false) {
    const target = toRun ? this.gameState.run.materials : this.player.backpackMaterials;
    target[materialId] = (target[materialId] ?? 0) + amount;
  }

  getMaterialCount(materialId, includeRun = true) {
    const locker = this.player.backpackMaterials[materialId] ?? 0;
    const run = includeRun ? (this.gameState.run.materials[materialId] ?? 0) : 0;
    return locker + run;
  }

  spendMaterials(requirements = {}, includeRun = true) {
    Object.entries(requirements).forEach(([id, amount]) => {
      let remaining = amount;
      if (includeRun && this.gameState.run.materials[id]) {
        const used = Math.min(remaining, this.gameState.run.materials[id]);
        this.gameState.run.materials[id] -= used;
        remaining -= used;
      }
      if (remaining > 0) {
        this.player.backpackMaterials[id] = (this.player.backpackMaterials[id] ?? 0) - remaining;
      }
    });
  }

  canAffordMaterials(requirements = {}) {
    return Object.entries(requirements).every(
      ([id, amount]) => this.getMaterialCount(id) >= amount,
    );
  }

  addConsumable(consumableId, amount = 1, toRun = false) {
    const target = toRun ? this.gameState.run.consumables : this.player.consumables;
    target[consumableId] = (target[consumableId] ?? 0) + amount;
  }

  getConsumableCount(consumableId, includeRun = true) {
    const locker = this.player.consumables[consumableId] ?? 0;
    const run = includeRun ? (this.gameState.run.consumables[consumableId] ?? 0) : 0;
    return locker + run;
  }

  useConsumable(consumableId, amount = 1) {
    let remaining = amount;
    if (this.gameState.run.consumables[consumableId]) {
      const used = Math.min(remaining, this.gameState.run.consumables[consumableId]);
      this.gameState.run.consumables[consumableId] -= used;
      remaining -= used;
    }
    if (remaining > 0) {
      this.player.consumables[consumableId] = (this.player.consumables[consumableId] ?? 0) - remaining;
    }
  }

  isTwoHandedEquipped() {
    const weapon = getItemConfig(this.player.equipped.mainWeapon);
    return !!weapon?.twoHanded;
  }

  equipItem(itemId, slotOverride = null) {
    const config = getItemConfig(itemId);
    if (!config) return { ok: false, reason: 'Unknown item.' };
    if (!this.ownsItem(itemId)) return { ok: false, reason: 'Item not owned.' };
    this.ensureEquippedStructure();

    if (config.twoHanded) {
      this.player.equipped.mainWeapon = itemId;
      this.player.equipped.offHand = null;
      return { ok: true };
    }

    const category = slotOverride ?? config.type;

    // Fix: equipping an offhand item used to silently succeed even
    // while a two-handed weapon was equipped, effectively undoing the
    // "equipping 2H clears offhand" rule the moment you put anything
    // back in. Block it instead.
    if (category === 'offHand' && this.isTwoHandedEquipped()) {
      return { ok: false, reason: 'Cannot equip an offhand item while wielding a two-handed weapon.' };
    }

    if (MULTI_EQUIPMENT_SLOTS[category] !== undefined) {
      const maxSlots = MULTI_EQUIPMENT_SLOTS[category];
      const arr = this.player.equipped[category];
      const equippedCopies = arr.filter((id) => id === itemId).length;
      if (equippedCopies >= this.getOwnedCount(itemId)) {
        return { ok: false, reason: 'You do not own another copy of this item.' };
      }
      if (arr.length >= maxSlots) {
        arr.shift(); // least-recently-equipped is replaced first, per design doc
      }
      arr.push(itemId);
      return { ok: true };
    }

    this.player.equipped[category] = itemId;
    return { ok: true };
  }

  /** For multi-slot categories, itemId narrows which specific copy to remove (default: the last one). */
  unequipSlot(slot, itemId = null) {
    this.ensureEquippedStructure();
    if (MULTI_EQUIPMENT_SLOTS[slot] !== undefined) {
      const arr = this.player.equipped[slot];
      if (itemId) {
        const idx = arr.lastIndexOf(itemId);
        if (idx !== -1) arr.splice(idx, 1);
      } else {
        arr.pop();
      }
      return;
    }
    this.player.equipped[slot] = null;
  }

  getEquippedItems() {
    this.ensureEquippedStructure();
    return { ...this.player.equipped };
  }

  getOwnedItems() {
    return Object.entries(this.player.ownedEquipment)
      .filter(([, count]) => count > 0)
      .map(([id, count]) => {
        const config = getItemConfig(id);
        return config ? { ...config, ownedCount: count } : null;
      })
      .filter(Boolean);
  }

  /** Backfills to exactly LOADOUT_SLOT_COUNT slots — old saves made before loadouts existed just get empty ones appended. */
  ensureLoadoutsStructure() {
    if (!Array.isArray(this.player.loadouts)) this.player.loadouts = [];
    while (this.player.loadouts.length < LOADOUT_SLOT_COUNT) {
      this.player.loadouts.push({ name: null, equipped: null });
    }
  }

  getLoadouts() {
    this.ensureLoadoutsStructure();
    return this.player.loadouts;
  }

  /** Snapshots the CURRENT equipped setup into slot `index`. An empty/whitespace-only name defaults to "Loadout {n}" (1-indexed), per user request. */
  saveLoadout(index, name) {
    this.ensureEquippedStructure();
    this.ensureLoadoutsStructure();
    const trimmed = name?.trim();
    this.player.loadouts[index] = {
      name: trimmed || `Loadout ${index + 1}`,
      equipped: deepClone(this.player.equipped),
    };
  }

  /**
   * Restores slot `index`'s saved setup as the current equipped loadout.
   * Anything no longer owned in sufficient quantity (sold since saving) is
   * silently dropped rather than blocking the whole load — returns the
   * dropped item ids so the caller can tell the player what got skipped.
   */
  loadLoadout(index) {
    this.ensureLoadoutsStructure();
    const loadout = this.player.loadouts[index];
    if (!loadout?.equipped) return { ok: false, reason: 'Empty loadout slot.' };

    const skipped = [];
    const next = {};
    SINGLE_EQUIPMENT_SLOTS.forEach((slot) => {
      const itemId = loadout.equipped[slot] ?? null;
      if (itemId && this.getOwnedCount(itemId) < 1) {
        skipped.push(itemId);
        next[slot] = null;
      } else {
        next[slot] = itemId;
      }
    });
    Object.keys(MULTI_EQUIPMENT_SLOTS).forEach((category) => {
      const remaining = {};
      next[category] = (loadout.equipped[category] ?? []).filter((itemId) => {
        if (remaining[itemId] === undefined) remaining[itemId] = this.getOwnedCount(itemId);
        if (remaining[itemId] > 0) { remaining[itemId] -= 1; return true; }
        skipped.push(itemId);
        return false;
      });
    });

    this.player.equipped = next;
    return { ok: true, skipped };
  }
}
