import {
  DEF_DAMAGE_REDUCTION_PER_TWO,
  DEX_CRIT_RATIO,
  DEX_ENERGY_THRESHOLD,
  FROST_DAMAGE_BONUS,
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

  /**
   * Dodge/accuracy only ever move via frost (see Character.getStat).
   * Excess dodge (>100) is a chance to evade; excess accuracy (>100)
   * cancels out excess dodge point-for-point. Accuracy below 100 is a
   * flat miss chance that stacks on top of whatever dodge gets through.
   */
  static calculateHitChance(attacker, defender) {
    // Ethereal Form's "100% dodge chance" is a full guarantee, not a
    // stat that could be cancelled out by the attacker's accuracy.
    if (defender.guaranteedDodgeTurnsRemaining > 0) return 0;

    const dodgeExcess = Math.max(0, defender.getStat('dodge') - 100);
    const accuracyExcess = Math.max(0, attacker.getStat('accuracy') - 100);
    const effectiveDodge = Math.max(0, dodgeExcess - accuracyExcess);
    const accuracyDeficit = Math.max(0, 100 - attacker.getStat('accuracy'));
    const missChance = clamp(effectiveDodge + accuracyDeficit, 0, 100);
    return clamp(100 - missChance, 0, 100);
  }

  static applyDefense(damage, defender, move = null) {
    const def = defender.getStat('def');
    let reductionPercent = (def / 2) * (DEF_DAMAGE_REDUCTION_PER_TWO * 100);
    if (move?.properties?.includes('physical') && defender.physicalDamageReductionPercent) {
      reductionPercent += defender.physicalDamageReductionPercent;
    }
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

  /**
   * Flashback's "heal 2x the damage taken from the next hit" — only
   * ever reached from resolveAttack's direct-hit paths below, never
   * from status ticks (those go through Character.takeDamage directly,
   * not DamageCalculator), so this naturally excludes status damage.
   */
  static applyReactiveHeal(defender, damageTaken) {
    if (!defender.pendingReactiveHeal || damageTaken <= 0) return;
    const heal = Math.round(damageTaken * defender.pendingReactiveHeal.multiplier);
    defender.pendingReactiveHeal = null;
    defender.heal(heal);
  }

  static resolveAttack({ attacker, defender, move, forceHit = false }) {
    if (!forceHit && !rollChance(this.calculateHitChance(attacker, defender))) {
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
      defender.reflectSplitTurnsRemaining = 0;
      const takenAfterDefense = this.applyDefense(taken, defender, move);
      const returnedAfterDefense = this.applyDefense(returned, attacker, move);
      defender.takeDamage(takenAfterDefense);
      attacker.takeDamage(returnedAfterDefense);
      this.applyReactiveHeal(defender, takenAfterDefense);
      this.applyReactiveHeal(attacker, returnedAfterDefense);
      return { hit: true, damage: taken, healed: 0, reflected: returned, isCrit: crit.isCrit, split: true };
    }

    damage = this.applyDefense(damage, defender, move);
    damage = this.applyDamageReductionState(damage, defender);
    const thorns = this.applyThorns(attacker, defender, damage);
    defender.takeDamage(thorns.finalDamage);
    this.applyReactiveHeal(defender, thorns.finalDamage);
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
    if (rollChance(dex / 2)) gain += 1;
    if (dex > DEX_ENERGY_THRESHOLD && rollChance((dex - DEX_ENERGY_THRESHOLD) / 2)) gain += 1;

    return gain;
  }
}
