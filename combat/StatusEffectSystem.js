import { FROST_MAX_STACKS } from '../utils/Constants.js';
import { STATUS_EFFECTS as CONFIG } from '../data/statusEffectConfig.js';
import { t, tData } from '../ui/i18n.js';
import { rollChance } from '../utils/MathUtils.js';

export class StatusEffectSystem {
  /**
   * `onTick`, when passed, receives `{ character, effectId, amount }` for
   * every landed tick — structured data CombatManager uses to record a
   * timeline step (for paced damage-number playback in FightState),
   * separate from `log`'s plain text message. `amount` is the actual
   * post-multiplier damage (Character.takeDamage's return value), not
   * the raw formula output, so it always matches what really landed.
   */
  tickCharacterTurnStart(character, log, onTick) {
    character.statusEffects.forEach((effect) => {
      const template = CONFIG[effect.id];
      if (!template || template.tickOn !== 'character_turn_start') return;
      const damage = template.formula(effect.stacks, character);
      if (damage > 0) {
        const actual = character.takeDamage(damage, { source: effect.id });
        log?.(t('log.status_damage', { name: character.name, n: actual, status: tData('status', effect.id, template.name) }));
        onTick?.({ character, effectId: effect.id, amount: actual });
      }
    });
  }

  tickFightTurnStart(combatants, log, onTick) {
    combatants.forEach((character) => {
      character.statusEffects.forEach((effect) => {
        const template = CONFIG[effect.id];
        if (!template || template.tickOn !== 'fight_turn_start') return;
        const damage = template.formula(effect.stacks, character);
        if (damage > 0) {
          const actual = character.takeDamage(damage, { source: effect.id });
          log?.(t('log.status_damage', { name: character.name, n: actual, status: tData('status', effect.id, template.name) }));
          onTick?.({ character, effectId: effect.id, amount: actual });
        }
      });
    });
  }

  /**
   * Fire no longer decays on a timer here — Character.takeDamage()
   * burns off 35% of fire stacks whenever the burning character takes
   * any OTHER instance of damage (fire's own tick is exempted there).
   */
  tickFightTurnEnd(combatants, log, onTick) {
    combatants.forEach((character) => {
      character.statusEffects.forEach((effect) => {
        const template = CONFIG[effect.id];
        if (!template || template.tickOn !== 'fight_turn_end') return;
        const damage = template.formula(effect.stacks, character);
        if (damage > 0) {
          const actual = character.takeDamage(damage, { source: effect.id });
          log?.(t('log.status_damage', { name: character.name, n: actual, status: tData('status', effect.id, template.name) }));
          onTick?.({ character, effectId: effect.id, amount: actual });
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

  /**
   * No current STATUS_EFFECTS entry uses tickOn: 'character_turn_end'
   * yet, but the hook exists (mirroring the other three) so an
   * end-of-turn tick works correctly, including its paced timeline
   * placement, the moment one is added.
   */
  tickCharacterTurnEnd(character, log, onTick) {
    character.statusEffects.forEach((effect) => {
      const template = CONFIG[effect.id];
      if (!template || template.tickOn !== 'character_turn_end') return;
      const damage = template.formula(effect.stacks, character);
      if (damage > 0) {
        const actual = character.takeDamage(damage, { source: effect.id });
        log?.(t('log.status_damage', { name: character.name, n: actual, status: tData('status', effect.id, template.name) }));
        onTick?.({ character, effectId: effect.id, amount: actual });
      }
    });
  }

  applyDebuffs(target, debuffs, attacker) {
    debuffs?.forEach((debuff) => {
      if (rollChance(target.getStat('statusResist'))) return;
      // Status Reflection: each stack is a 10% chance for this specific
      // debuff to land on the original attacker instead of the target.
      const reflectChance = target.getStatusStacks('statusReflection') * 10;
      const recipient = (attacker && attacker !== target && reflectChance > 0 && rollChance(reflectChance))
        ? attacker : target;
      let stacks = debuff.stacks ?? (debuff.stacksMin
        ? Math.floor(Math.random() * ((debuff.stacksMax ?? debuff.stacksMin) - debuff.stacksMin + 1)) + debuff.stacksMin
        : 1);
      if (debuff.bonusPerDex && attacker) {
        stacks += Math.floor(attacker.getStat('dex') * debuff.bonusPerDex);
      }
      if (debuff.effect === 'frost') {
        const current = recipient.getStatusStacks('frost') + stacks;
        if (current >= FROST_MAX_STACKS) {
          recipient.removeStatusEffect('frost');
          recipient.addStatusEffect('frostbite', 1);
        } else {
          recipient.addStatusEffect('frost', stacks);
        }
        return;
      }
      recipient.addStatusEffect(debuff.effect, stacks, {
        durationFightTurns: debuff.durationFightTurns ?? -1,
      });
    });
  }

  applyBuffs(target, buffs, attacker) {
    buffs?.forEach((buff) => {
      if (buff.effect) {
        const stacks = buff.stacks ?? (buff.stacksMin
          ? Math.floor(Math.random() * ((buff.stacksMax ?? buff.stacksMin) - buff.stacksMin + 1)) + buff.stacksMin
          : 1);
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

    if (character.reflectSplitTurnsRemaining > 0) {
      character.reflectSplitTurnsRemaining -= 1;
      if (character.reflectSplitTurnsRemaining <= 0) character.reflectSplitPercent = 0;
    }

    if (character.guaranteedDodgeTurnsRemaining > 0) {
      character.guaranteedDodgeTurnsRemaining -= 1;
    }

    if (character.pendingReactiveHealTurnsRemaining > 0) {
      character.pendingReactiveHealTurnsRemaining -= 1;
      if (character.pendingReactiveHealTurnsRemaining <= 0) character.pendingReactiveHeal = null;
    }
  }
}
