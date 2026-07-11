import { EQUIPMENT_SLOTS, STAT_KEYS } from '../utils/Constants.js';
import { getItemConfig } from '../data/items.js';
import { Item } from '../entities/Item.js';

export class InventorySystem {
  constructor(gameState) {
    this.gameState = gameState;
  }

  get player() {
    return this.gameState.player;
  }

  ensureEquippedStructure() {
    EQUIPMENT_SLOTS.forEach((slot) => {
      if (this.player.equipped[slot] === undefined) this.player.equipped[slot] = null;
    });
  }

  getEquippedStatTotals() {
    this.ensureEquippedStructure();
    const totals = {};
    STAT_KEYS.forEach((stat) => { totals[stat] = 0; });

    Object.values(this.player.equipped).forEach((itemId) => {
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
    this.ensureEquippedStructure();
    const moveIds = [];
    Object.values(this.player.equipped).forEach((itemId) => {
      if (!itemId) return;
      const config = getItemConfig(itemId);
      moveIds.push(...(config?.moveIds ?? []));
    });
    return moveIds;
  }

  ownsItem(itemId) {
    return this.player.ownedEquipment.includes(itemId);
  }

  addItem(itemId) {
    if (!this.ownsItem(itemId)) {
      this.player.ownedEquipment.push(itemId);
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

  equipItem(itemId, slot = null) {
    const config = getItemConfig(itemId);
    if (!config) return { ok: false, reason: 'Unknown item.' };
    if (!this.ownsItem(itemId)) return { ok: false, reason: 'Item not owned.' };

    const targetSlot = slot ?? config.type;
    if (config.twoHanded) {
      this.player.equipped.mainWeapon = itemId;
      this.player.equipped.offHand = null;
      return { ok: true };
    }
    this.player.equipped[targetSlot] = itemId;
    return { ok: true };
  }

  unequipSlot(slot) {
    this.player.equipped[slot] = null;
  }

  getEquippedItems() {
    this.ensureEquippedStructure();
    return { ...this.player.equipped };
  }

  getOwnedItems() {
    return this.player.ownedEquipment.map((id) => getItemConfig(id)).filter(Boolean);
  }
}
