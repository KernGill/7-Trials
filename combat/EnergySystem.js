import { COOLDOWN_TYPES } from '../utils/Constants.js';
import { EnergyCalculator } from './DamageCalculator.js';
import { rollChance } from '../utils/MathUtils.js';

export class EnergySystem {
  gainEnergy(character) {
    let gain = EnergyCalculator.rollEnergyGain(character);
    if (gain > 0 && rollChance(character.getStat('doubleEnergyChance'))) gain *= 2;
    const max = character.getMaxEnergy();
    character.energy = Math.min(max, character.energy + gain);
    return gain;
  }

  spendEnergy(character, amount) {
    if (character.energy < amount) return false;
    character.energy -= amount;
    return true;
  }

  drainEnergy(character, amount) {
    character.energy = Math.max(0, character.energy - amount);
  }

  stealEnergy(from, to, amount) {
    const stolen = Math.min(from.energy, amount);
    from.energy -= stolen;
    to.energy = Math.min(to.getMaxEnergy(), to.energy + stolen);
    return stolen;
  }
}

export class CooldownSystem {
  tickFightTurn(combatants) {
    combatants.forEach((c) => {
      c.moves.forEach((move) => move.tickCooldown(COOLDOWN_TYPES.FIGHT_TURN));
    });
  }

  tickCharacterTurn(character) {
    character.moves.forEach((move) => move.tickCooldown(COOLDOWN_TYPES.CHARACTER_TURN));
  }

  getEffectiveCooldown(character, move) {
    return Math.max(1, move.cooldown - character.getCooldownReduction());
  }
}
