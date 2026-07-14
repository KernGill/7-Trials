import { FROST_MAX_STACKS } from '../utils/Constants.js';
import { STATUS_EFFECTS as CONFIG } from '../data/statusEffectConfig.js';

export class StatusEffectSystem {
  tickCharacterTurnStart(character, log) {
    character.statusEffects.forEach((effect) => {
      const template = CONFIG[effect.id];
      if (!template || template.tickOn !== 'character_turn_start') return;
      const damage = template.formula(effect.stacks, character);
      if (damage > 0) {
        character.takeDamage(damage, { source: effect.id });
        log?.(`${character.name} takes ${damage} ${template.name} damage.`);
      }
    });
  }

  tickFightTurnStart(combatants, log) {
    combatants.forEach((character) => {
      character.statusEffects.forEach((effect) => {
        const template = CONFIG[effect.id];
        if (!template || template.tickOn !== 'fight_turn_start') return;
        const damage = template.formula(effect.stacks, character);
        if (damage > 0) {
          character.takeDamage(damage, { source: effect.id });
          log?.(`${character.name} takes ${damage} ${template.name} damage.`);
        }
      });
    });
  }

  /**
   * Fire no longer decays on a timer here — Character.takeDamage()
   * burns off 35% of fire stacks whenever the burning character takes
   * any OTHER instance of damage (fire's own tick is exempted there).
   */
  tickFightTurnEnd(combatants, log) {
    combatants.forEach((character) => {
      character.statusEffects.forEach((effect) => {
        const template = CONFIG[effect.id];
        if (!template || template.tickOn !== 'fight_turn_end') return;
        const damage = template.formula(effect.stacks, character);
        if (damage > 0) {
          character.takeDamage(damage, { source: effect.id });
          log?.(`${character.name} takes ${damage} ${template.name} damage.`);
        }
      });

      character.statusEffects = character.statusEffects.filter((effect) => {
        if (effect.durationFightTurns > 0) {
          effect.durationFightTurns -= 1;
          return effect.durationFightTurns > 0;
        }
        return true;
      });
    });
  }

  applyDebuffs(target, debuffs, attacker) {
    debuffs?.forEach((debuff) => {
      let stacks = debuff.stacks ?? (debuff.stacksMin
        ? Math.floor(Math.random() * ((debuff.stacksMax ?? debuff.stacksMin) - debuff.stacksMin + 1)) + debuff.stacksMin
        : 1);
      if (debuff.bonusPerDex && attacker) {
        stacks += Math.floor(attacker.getStat('dex') * debuff.bonusPerDex);
      }
      if (debuff.effect === 'frost') {
        const current = target.getStatusStacks('frost') + stacks;
        if (current >= FROST_MAX_STACKS) {
          target.removeStatusEffect('frost');
          target.addStatusEffect('frostbite', 1);
        } else {
          target.addStatusEffect('frost', stacks);
        }
        return;
      }
      target.addStatusEffect(debuff.effect, stacks, {
        durationFightTurns: debuff.durationFightTurns ?? -1,
      });
    });
  }

  applyBuffs(target, buffs, attacker) {
    buffs?.forEach((buff) => {
      if (buff.effect) {
        const stacks = buff.stacks ?? buff.stacksMin
          ? Math.floor(Math.random() * ((buff.stacksMax ?? 1) - (buff.stacksMin ?? 1) + 1)) + (buff.stacksMin ?? 1)
          : 1;
        target.addStatusEffect(buff.effect, stacks, {
          durationFightTurns: buff.durationFightTurns ?? -1,
        });
      }
      if (buff.type === 'stat') {
        target.statBuffs.push({
          stat: buff.stat,
          amount: buff.amount,
          duration: buff.duration ?? -1,
          durationFightTurns: buff.durationFightTurns ?? -1,
        });
        target.temporaryStatModifiers[buff.stat] =
          (target.temporaryStatModifiers[buff.stat] ?? 0) + buff.amount;
      }
      if (buff.type === 'conFromInt') {
        const bonus = target.getStat('int');
        target.temporaryStatModifiers.con = (target.temporaryStatModifiers.con ?? 0) + bonus;
        target.currentHealth = Math.min(target.getMaxHealth(), target.currentHealth + bonus);
      }
      if (buff.type === 'energyGainBonus') {
        target.energyGainBonus = (target.energyGainBonus ?? 0) + buff.amount;
        target.energyGainBonusTurns = buff.durationFightTurns ?? 2;
      }
    });
  }

  decayBuffDurations(character) {
    character.statBuffs = character.statBuffs.filter((buff) => {
      if (buff.durationFightTurns > 0) buff.durationFightTurns -= 1;
      if (buff.duration > 0) buff.duration -= 1;
      const active = (buff.durationFightTurns ?? -1) !== 0 && (buff.duration ?? -1) !== 0;
      if (!active) {
        character.temporaryStatModifiers[buff.stat] =
          (character.temporaryStatModifiers[buff.stat] ?? 0) - buff.amount;
      }
      return active;
    });

    if (character.energyGainBonusTurns > 0) {
      character.energyGainBonusTurns -= 1;
      if (character.energyGainBonusTurns <= 0) character.energyGainBonus = 0;
    }
  }
}
