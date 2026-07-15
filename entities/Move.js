import { deepClone } from '../utils/MathUtils.js';
import { getMoveTemplate } from '../data/moves.js';
import { tData } from '../ui/i18n.js';

export class Move {
  constructor(template, owner = null) {
    this.template = deepClone(template);
    this.owner = owner;
    this.currentCooldown = 0;
    this.passiveCounter = 0;
  }

  get id() { return this.template.id; }
  get name() { return tData('move', this.template.id, this.template.name); }
  get properties() { return this.template.properties ?? []; }
  get damage() { return this.template.damage ?? 0; }
  get scaling() { return this.template.scaling ?? 'none'; }
  get critChance() { return this.template.critChance ?? 0; }
  get energyCost() { return this.template.energyCost ?? 0; }
  get cooldown() { return this.template.cooldown ?? 0; }
  get cooldownType() { return this.template.cooldownType ?? 'character_turn'; }

  isOnCooldown() {
    return this.currentCooldown > 0;
  }

  canAfford(energy) {
    return energy >= this.energyCost;
  }

  isAvailable(energy) {
    return !this.isOnCooldown() && this.canAfford(energy);
  }

  startCooldown(reduction = 0) {
    this.currentCooldown = Math.max(1, this.cooldown - reduction);
  }

  tickCooldown(type) {
    if (this.cooldownType === type && this.currentCooldown > 0) {
      this.currentCooldown -= 1;
    }
  }

  static fromId(moveId, owner = null) {
    const template = getMoveTemplate(moveId);
    if (!template) return null;
    return new Move(template, owner);
  }

  toJSON() {
    return {
      id: this.id,
      currentCooldown: this.currentCooldown,
      passiveCounter: this.passiveCounter,
    };
  }
}
