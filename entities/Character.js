import {
  DEX_CRIT_RATIO,
  DEX_COOLDOWN_REDUCTION_INTERVAL,
  ENERGY_CAP_RATIO,
  STAT_KEYS,
} from '../utils/Constants.js';
import { clamp, roundUp } from '../utils/MathUtils.js';
import { StatusEffect } from './SatusEffect.js';
import { Move } from './Move.js';

export class Character {
  constructor(config) {
    this.id = config.id;
    this.name = config.name ?? config.id;
    this.isPlayer = config.isPlayer ?? false;
    this.isEnemy = config.isEnemy ?? false;
    this.visual = config.visual ?? {
      shape: 'square',
      width: 40,
      height: 40,
      color: '#ffffff',
      label: config.name,
      spriteId: config.id,
    };

    this.baseStats = { ...config.baseStats };
    this.equipmentStats = config.equipmentStats ?? {};
    this.battleBuffs = {};
    this.statusEffects = [];
    this.statBuffs = [];
    this.temporaryStatModifiers = {};

    this.currentHealth = config.currentHealth ?? this.getMaxHealth();
    this.battleSpeed = config.battleSpeed ?? this.getStat('spd');
    this.storedSpeed = 0;
    this.energy = 0;
    this.hasMoved = false;
    this.skippedThisFightTurn = false;
    this.pendingDamageReduction = null;
    this.guardState = null;
    this.reflectSplitPercent = 0;
    this.moveIds = [...(config.moveIds ?? [])];
    this.moves = [];
    this.combatLogTag = config.combatLogTag ?? this.name;

    this.dotEffects = [];
    this.passiveTriggers = [];
    this.energyGainBonus = 0;
    this.energyGainBonusTurns = 0;
  }

  getStat(stat) {
    const base = this.baseStats[stat] ?? 0;
    const equip = this.equipmentStats[stat] ?? 0;
    const battle = this.battleBuffs[stat] ?? 0;
    const temp = this.temporaryStatModifiers[stat] ?? 0;
    let value = base + equip + battle + temp;

    if (stat === 'critChance' && stat !== 'fromDex') {
      const dexBonus = Math.floor((this.getStat('dex')) * DEX_CRIT_RATIO);
      if (stat === 'critChance') value += dexBonus;
    }

    this.statusEffects.forEach((effect) => {
      const template = effect.id;
      if (template === 'defenceReduction' && stat === 'def') {
        value -= 10 * effect.stacks;
      }
      if (template === 'strength' && stat === 'str') {
        value += effect.stacks;
      }
    });

    this.statBuffs.forEach((buff) => {
      if (buff.stat === stat) value += buff.amount;
    });

    return Math.max(0, value);
  }

  getEffectiveCritChance() {
    const dexBonus = Math.floor(this.getStat('dex') * DEX_CRIT_RATIO);
    return this.getStat('critChance') + dexBonus;
  }

  getMaxHealth() {
    return this.getStat('con');
  }

  getMaxEnergy() {
    return Math.max(1, Math.round(this.getStat('con') * ENERGY_CAP_RATIO));
  }

  getCooldownReduction() {
    return Math.floor(this.getStat('dex') / DEX_COOLDOWN_REDUCTION_INTERVAL);
  }

  initializeMoves(moveFactory) {
    this.moves = this.moveIds
      .map((id) => moveFactory(id, this))
      .filter(Boolean);
  }

  addStatusEffect(effectId, stacks = 1, extra = {}) {
    const existing = this.statusEffects.find((e) => e.id === effectId);
    if (existing && !extra.replace) {
      existing.stacks += stacks;
      if (extra.durationFightTurns) existing.durationFightTurns = extra.durationFightTurns;
      return existing;
    }
    const effect = StatusEffect.fromType(effectId, stacks, extra);
    if (!effect) return null;
    if (existing && extra.replace) {
      const idx = this.statusEffects.indexOf(existing);
      this.statusEffects[idx] = effect;
      return effect;
    }
    this.statusEffects.push(effect);
    return effect;
  }

  removeStatusEffect(effectId) {
    this.statusEffects = this.statusEffects.filter((e) => e.id !== effectId);
  }

  getStatusStacks(effectId) {
    return this.statusEffects.find((e) => e.id === effectId)?.stacks ?? 0;
  }

  isStunned() {
    return this.getStatusStacks('stun') > 0;
  }

  takeDamage(amount) {
    const actual = Math.max(0, Math.round(amount));
    this.currentHealth = clamp(this.currentHealth - actual, 0, this.getMaxHealth());
    return actual;
  }

  heal(amount) {
    const actual = Math.max(0, Math.round(amount));
    this.currentHealth = clamp(this.currentHealth + actual, 0, this.getMaxHealth());
    return actual;
  }

  healMissingPercent(percent) {
    const missing = this.getMaxHealth() - this.currentHealth;
    return this.heal(Math.ceil(missing * (percent / 100)));
  }

  isAlive() {
    return this.currentHealth > 0;
  }

  isDead() {
    return this.currentHealth <= 0;
  }

  resetBattleState() {
    this.currentHealth = Math.min(this.currentHealth, this.getMaxHealth());
    this.battleSpeed = this.getStat('spd');
    this.storedSpeed = 0;
    this.energy = 0;
    this.hasMoved = false;
    this.skippedThisFightTurn = false;
    this.pendingDamageReduction = null;
    this.guardState = null;
    this.reflectSplitPercent = 0;
    this.statusEffects = [];
    this.dotEffects = [];
    this.statBuffs = [];
    this.temporaryStatModifiers = {};
    this.battleBuffs = {};
    this.energyGainBonus = 0;
    this.energyGainBonusTurns = 0;
    this.moves.forEach((move) => {
      move.currentCooldown = 0;
      move.passiveCounter = 0;
    });
  }

  toSnapshot() {
    return {
      id: this.id,
      name: this.name,
      currentHealth: this.currentHealth,
      battleSpeed: this.battleSpeed,
      energy: this.energy,
      statusEffects: this.statusEffects.map((e) => e.clone()),
      hasMoved: this.hasMoved,
    };
  }
}
