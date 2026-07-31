import { rollChance } from '../utils/MathUtils.js';

/**
 * Scales an array of buff/debuff entries by `count` — used when N equipped
 * copies of the same passive move fire together as ONE combined application
 * instead of N separate small ones (see PassiveTriggerSystem.trigger).
 * Multiplies whichever numeric field the entry actually uses (`stacks` for
 * status effects, `amount` for a flat stat buff); an entry with neither
 * (e.g. `type: 'conFromInt'`, whose value is computed live off a stat, not
 * a static number here) has nothing to scale, so it's just repeated as its
 * own separate entry `count` times instead.
 */
function scaleEntries(entries, count) {
  if (count <= 1) return entries;
  return entries.flatMap((entry) => {
    if (entry.stacks !== undefined) return [{ ...entry, stacks: entry.stacks * count }];
    if (entry.amount !== undefined) return [{ ...entry, amount: entry.amount * count }];
    return Array(count).fill(entry);
  });
}

/**
 * Extracted from CombatManager — fires every equipped passive move whose
 * `trigger` string matches, handling `triggerOnFightTurn`/`triggerInterval`
 * gating and every passive-only template field (buffs, debuffs,
 * selfDebuffs, grantConsumables, grantGoldFlat,
 * physicalDamageReductionPercent, statusDamageMultipliers). Stateless —
 * `trigger()` takes the context it needs as an explicit parameter each
 * call, matching this codebase's existing convention for service classes
 * (StatusEffectSystem, EnergySystem) rather than holding a back-reference
 * to CombatManager. `applySelfBuffs` stays owned by CombatManager (it's
 * also called directly from executeMove for active-move buffs, not just
 * passives) and is passed in as a bound callback.
 */
export class PassiveTriggerSystem {
  /**
   * Returns a flat array of every status/stat change this call actually
   * applied — `{ recipient, kind: 'status', effectId, stacks } |
   * { recipient, kind: 'stat', stat, amount }` — same shape executeMove
   * uses for its own moveEffects.events, so both feed FightState's floating
   * call-out rendering identically. `{ announce: true }` additionally
   * records a standalone 'passiveEffect' beat (grouped per affected
   * character) for triggers with no move animation of their own to piggy-
   * back on (fight_turn_start, character_turn_start) — reactive triggers
   * fired from inside executeMove (melee_hit_taken, player_guarded) leave
   * announce off and let the caller merge this return value into the
   * move's own beat instead, so e.g. Retaliatory Soul's bleed flashes at
   * the same peak moment as the hit that provoked it.
   */
  trigger(triggerName, actor, {
    combatants, aliveEnemies, player, enemies, turnOrder, statusSystem,
    applySelfBuffs, logDebuffResults, record, announce = false,
  }) {
    const actors = actor ? [actor] : combatants;
    const appliedEvents = [];
    actors.forEach((character) => {
      // Group by template id first — duplicate equipped copies of the same
      // passive (e.g. 4x Ember Curse) fire together as ONE combined
      // application instead of N separate small ones. This matters most
      // for self-inflicted debuffs: StatusEffectSystem.applyDebuffs' Status
      // Reflection self-redirect rounds PER application — at 1 stack per
      // instance, a single reflect roll could swallow the WHOLE
      // application every time, making self-burn effectively vanish.
      // Totaling first means the redirect only ever shaves off its actual
      // percentage of the real combined total, same as a single big hit.
      const groups = new Map();
      character.moves.forEach((move) => {
        if (move.template.trigger !== triggerName) return;
        if (!groups.has(move.template.id)) groups.set(move.template.id, []);
        groups.get(move.template.id).push(move);
      });
      groups.forEach((instances) => {
        const move = instances[0]; // representative instance for once-per-fire state (hasFiredOnce/passiveCounter)
        const count = instances.length;
        // triggerOnFightTurn fires exactly once per fight, on the specific
        // numbered fight turn given (Flesh Eater's Palm: fight turn 5) —
        // mutually exclusive with triggerInterval below.
        if (move.template.triggerOnFightTurn) {
          if (move.hasFiredOnce || turnOrder.fightTurn !== move.template.triggerOnFightTurn) return;
          move.hasFiredOnce = true;
        }
        // triggerInterval lets a passive fire only every Nth time its
        // trigger event happens (e.g. Challenger's Mettle: every 2nd of
        // its owner's own character_turn_start) instead of every single
        // occurrence.
        if (move.template.triggerInterval) {
          move.passiveCounter += 1;
          if (move.passiveCounter % move.template.triggerInterval !== 0) return;
        }
        if (move.template.buffs) {
          const applied = applySelfBuffs(character, scaleEntries(move.template.buffs, count));
          applied.forEach((buff) => {
            if (buff.type === 'stat') appliedEvents.push({ recipient: character, kind: 'stat', stat: buff.stat, amount: buff.amount });
            else if (buff.type === 'effect') appliedEvents.push({ recipient: character, kind: 'status', effectId: buff.effectId, stacks: buff.stacks });
          });
        }
        if (move.template.debuffs) {
          const chanceOk = !move.template.debuffChance || rollChance(move.template.debuffChance);
          if (chanceOk) {
            const scaledDebuffs = scaleEntries(move.template.debuffs, count);
            // aoeDebuffs (Ember Curse): hits every alive enemy at once
            // instead of just whichever one is currently targeted.
            if (character.isPlayer && move.template.aoeDebuffs) {
              aliveEnemies.forEach((e) => {
                const applied = statusSystem.applyDebuffs(e, scaledDebuffs, character);
                logDebuffResults(applied);
                applied.forEach((d) => appliedEvents.push({ recipient: d.recipient, kind: 'status', effectId: d.effectId, stacks: d.stacks }));
              });
            } else {
              const target = character.isPlayer ? (character.combatOpponent ?? aliveEnemies[0]) : player;
              if (target) {
                const applied = statusSystem.applyDebuffs(target, scaledDebuffs, character);
                logDebuffResults(applied);
                applied.forEach((d) => appliedEvents.push({ recipient: d.recipient, kind: 'status', effectId: d.effectId, stacks: d.stacks }));
              }
            }
          }
        }
        // Unlike `debuffs` (always routed to the opponent above),
        // `selfDebuffs` targets the passive's own owner — Ash Eater.
        if (move.template.selfDebuffs) {
          const opposingSide = character.isPlayer ? enemies : [player];
          const applied = statusSystem.applyDebuffs(character, scaleEntries(move.template.selfDebuffs, count), character, opposingSide);
          logDebuffResults(applied);
          applied.forEach((d) => appliedEvents.push({ recipient: d.recipient, kind: 'status', effectId: d.effectId, stacks: d.stacks }));
        }
        if (move.template.grantConsumables) {
          character.combatConsumables = { ...move.template.grantConsumables };
        }
        if (move.template.grantGoldFlat) {
          character.pendingGoldBonus = (character.pendingGoldBonus ?? 0) + move.template.grantGoldFlat * count;
        }
        if (move.template.physicalDamageReductionPercent) {
          character.physicalDamageReductionPercent =
            (character.physicalDamageReductionPercent ?? 0) + move.template.physicalDamageReductionPercent * count;
        }
        if (move.template.statusDamageMultipliers) {
          // Multiplied (not overwritten) so two copies of the same passive
          // (e.g. Formless from two equipped sources) genuinely compound.
          const current = character.statusDamageMultipliers ?? {};
          const next = { ...current };
          Object.entries(move.template.statusDamageMultipliers).forEach(([key, mult]) => {
            next[key] = (current[key] ?? 1) * mult ** count;
          });
          character.statusDamageMultipliers = next;
        }
      });
    });

    if (announce && appliedEvents.length) {
      const byRecipient = new Map();
      appliedEvents.forEach((event) => {
        if (!byRecipient.has(event.recipient)) byRecipient.set(event.recipient, []);
        byRecipient.get(event.recipient).push(event);
      });
      byRecipient.forEach((events, character) => {
        record({
          kind: 'passiveEffect',
          character,
          events,
          health: character.currentHealth,
          energy: character.energy,
        });
      });
    }

    return appliedEvents;
  }
}
