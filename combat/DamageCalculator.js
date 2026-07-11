import {
  DEF_DAMAGE_REDUCTION_PER_TWO,
  DEX_CRIT_RATIO,
  DEX_ENERGY_THRESHOLD,
  FROST_DAMAGE_BONUS,
  FROST_HIT_PENALTY,
  LIFESTEAL_PER_STACK,
  SCALING_TYPES,
  THORNS_REFLECT_PER_STACK,
} from '../utils/Constants.js';
import { clamp, rollChance, roundUp } from '../utils/MathUtils.js';

export class DamageCalculator {
  static getScalingStat(attacker, scaling) {
    switch (scaling) {
      case SCALING_TYPES.STR: return attacker.getStat('str');
      case SCALING_TYPES.DEX: return attacker.getStat('dex');
      case SCALING_TYPES.INT: return attacker.getStat('int');
      default: return 0;
    }
  }

  static calculateBaseDamage(attacker, move) {
    const scalingStat = this.getScalingStat(attacker, move.scaling);
    let damage = move.damage + scalingStat;

    const frostStacks = attacker.getStatusStacks('frost');
    if (frostStacks > 0 && move.properties.includes('physical')) {
      damage *= (1 + frostStacks * FROST_DAMAGE_BONUS);
    }

    return Math.max(0, Math.round(damage));
  }

  static rollCrit(attacker, moveCritChance = 0) {
    const totalCrit = attacker.getEffectiveCritChance() + moveCritChance;
    if (totalCrit <= 0) return { isCrit: false, multiplier: 1, tier: 0 };

    const roll = Math.random() * 100;
    if (roll >= totalCrit) return { isCrit: false, multiplier: 1, tier: 0 };

    const tier = Math.floor(totalCrit / 100);
    const critDamageBonus = attacker.getStat('critDamage') / 100;
    let multiplier = 2;
    for (let i = 0; i < tier; i += 1) {
      multiplier *= 2;
    }
    multiplier *= (1 + critDamageBonus);
    return { isCrit: true, multiplier, tier };
  }

  static calculateAccuracy(attacker, defender) {
    let accuracy = 100;
    const attackerFrost = attacker.getStatusStacks('frost');
    const defenderFrost = defender.getStatusStacks('frost');
    accuracy -= attackerFrost * FROST_HIT_PENALTY * 100;
    accuracy += defenderFrost * FROST_HIT_PENALTY * 100;
    return clamp(accuracy, 5, 100);
  }

  static applyDefense(damage, defender) {
    const def = defender.getStat('def');
    const reductionPercent = (def / 2) * (DEF_DAMAGE_REDUCTION_PER_TWO * 100);
    const reduction = Math.ceil(damage * (reductionPercent / 100));
    return Math.max(1, damage - reduction);
  }

  static applyDamageReductionState(damage, defender) {
    let remaining = damage;

    if (defender.guardState) {
      remaining = Math.max(1, Math.round(remaining * (1 - defender.guardState.percent / 100)));
      defender.guardState = null;
    }

    if (defender.pendingDamageReduction) {
      const dr = defender.pendingDamageReduction;
      if (dr.flat) remaining = Math.max(0, remaining - dr.flat);
      if (dr.percent) remaining = Math.max(1, Math.round(remaining * (1 - dr.percent / 100)));
      if (dr.hits) {
        dr.hits -= 1;
        if (dr.hits <= 0) defender.pendingDamageReduction = null;
      } else {
        defender.pendingDamageReduction = null;
      }
    }

    return remaining;
  }

  static applyThorns(attacker, defender, damageAfterDef) {
    const thornsStacks = defender.getStatusStacks('thorns');
    if (!thornsStacks) return { finalDamage: damageAfterDef, reflected: 0 };
    const reflectPercent = thornsStacks * THORNS_REFLECT_PER_STACK;
    const reflected = Math.round(damageAfterDef * reflectPercent);
    const finalDamage = Math.max(0, damageAfterDef - reflected);
    if (reflected > 0) attacker.takeDamage(reflected);
    return { finalDamage, reflected };
  }

  static applyLifesteal(attacker, damageDealt) {
    const stacks = attacker.getStatusStacks('lifesteal');
    if (!stacks || damageDealt <= 0) return 0;
    const heal = Math.ceil(damageDealt * stacks * LIFESTEAL_PER_STACK);
    return attacker.heal(heal);
  }

  static resolveAttack({ attacker, defender, move, forceHit = false }) {
    if (!forceHit && !rollChance(this.calculateAccuracy(attacker, defender))) {
      return { hit: false, damage: 0, healed: 0, reflected: 0, isCrit: false };
    }

    let damage = this.calculateBaseDamage(attacker, move);
    const crit = this.rollCrit(attacker, move.critChance ?? 0);
    if (crit.isCrit) damage = Math.round(damage * crit.multiplier);

    if (defender.reflectSplitPercent > 0) {
      const split = defender.reflectSplitPercent / 100;
      const taken = Math.round(damage * split);
      const returned = damage - taken;
      defender.reflectSplitPercent = 0;
      defender.takeDamage(this.applyDefense(taken, defender));
      attacker.takeDamage(this.applyDefense(returned, attacker));
      return { hit: true, damage: taken, healed: 0, reflected: returned, isCrit: crit.isCrit, split: true };
    }

    damage = this.applyDefense(damage, defender);
    damage = this.applyDamageReductionState(damage, defender);
    const thorns = this.applyThorns(attacker, defender, damage);
    defender.takeDamage(thorns.finalDamage);
    const healed = this.applyLifesteal(attacker, thorns.finalDamage);

    return {
      hit: true,
      damage: thorns.finalDamage,
      healed,
      reflected: thorns.reflected,
      isCrit: crit.isCrit,
    };
  }
}

export class EnergyCalculator {
  static rollEnergyGain(character) {
    const frostbiteStacks = character.getStatusStacks('frostbite');
    for (let i = 0; i < frostbiteStacks; i += 1) {
      if (rollChance(25)) return 0;
    }

    let gain = 1 + (character.energyGainBonus ?? 0);
    const dex = character.getStat('dex');
    if (rollChance(dex)) gain += 1;
    if (dex > DEX_ENERGY_THRESHOLD && rollChance(dex - DEX_ENERGY_THRESHOLD)) gain += 1;

    return gain;
  }
}
