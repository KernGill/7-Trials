/**
 * Detailed, numbers-included descriptions for the click-to-inspect status
 * effect panel (FightState). Deliberately separate from InfoFormatters.js
 * — this reads live game constants (Constants.js) and the hovered
 * character's own current state (stacks, opponent, this turn's status
 * damage) to produce exact numbers, not just static flavor text. English
 * only, matching how move.description is already handled elsewhere —
 * these are dense technical sentences, not simple UI chrome.
 */
import { STATUS_EFFECTS } from '../data/statusEffectConfig.js';
import {
  FROST_HIT_PENALTY, FROST_DAMAGE_BONUS, FROST_MAX_STACKS,
  DARKNESS_ACCURACY_PENALTY, DARKNESS_ENERGY_STEAL_CHANCE_PER_STACK,
  THORNS_REFLECT_PER_STACK, LIFESTEAL_PER_STACK,
  FIRE_DECAY_RATIO, FIRE_DAMAGE_MULTIPLIER,
} from '../utils/Constants.js';
import { tData } from './i18n.js';

const pct = (n) => `${Math.round(n * 1000) / 10}%`;

const TICK_LABEL = {
  fight_turn_start: 'Ticks once at the start of each fight turn.',
  fight_turn_end: 'Ticks once at the end of each fight turn.',
  character_turn_start: "Ticks at the start of each of this character's own turns.",
  character_turn_end: "Ticks at the end of each of this character's own turns.",
};

/** effectId -> (stacks, character) => array of detail lines (plain sentences). */
const DETAILS = {
  bleed: (stacks, character) => {
    const dmg = STATUS_EFFECTS.bleed.formula(stacks, character);
    return [`Deals 1% of max health per stack (minimum 1), rounded up.`,
      `At ${stacks} stack${stacks === 1 ? '' : 's'}: ${dmg} damage per tick (${pct(dmg / character.getMaxHealth())} of ${character.getMaxHealth()} max health).`];
  },
  poison: (stacks) => [
    `Deals exactly 1 damage per stack.`,
    `At ${stacks} stack${stacks === 1 ? '' : 's'}: ${stacks} damage per tick.`,
  ],
  fire: (stacks) => [
    `Deals ${FIRE_DAMAGE_MULTIPLIER} damage per stack.`,
    `At ${stacks} stack${stacks === 1 ? '' : 's'}: ${stacks * FIRE_DAMAGE_MULTIPLIER} damage per tick.`,
    `Also burns off ${pct(FIRE_DECAY_RATIO)} of its own stacks (rounded down, minimum 1) any time this character is hit by a DIRECT ATTACK — status damage (its own tick included) never triggers this, only landing on the receiving end of an actual move.`,
  ],
  stun: (stacks) => [
    `Not a damage-over-time effect — no periodic tick. Each stack fully skips one of this character's own turns instead.`,
    `At ${stacks} stack${stacks === 1 ? '' : 's'}: the next ${stacks} turn${stacks === 1 ? '' : 's'} will be skipped entirely.`,
  ],
  frost: (stacks, character) => {
    const acc = stacks * FROST_HIT_PENALTY * 100;
    const dmgBonus = stacks * FROST_DAMAGE_BONUS * 100;
    return [
      `No periodic tick — works continuously instead.`,
      `Reduces both Accuracy and Dodge by ${pct(FROST_HIT_PENALTY)} per stack — lower Accuracy makes this character's own attacks more likely to miss, and lower Dodge makes this character easier for opponents to hit.`,
      `At ${stacks} stack${stacks === 1 ? '' : 's'}: Accuracy -${Math.round(acc)} (now ${Math.round(character.getStat('accuracy'))}), Dodge -${Math.round(acc)} (now ${Math.round(character.getStat('dodge'))}).`,
      `Also makes this character take ${pct(FROST_DAMAGE_BONUS)} more physical damage per stack — at ${stacks} stacks, +${Math.round(dmgBonus)}% physical damage taken.`,
      `If a single application would push Frost to ${FROST_MAX_STACKS} stacks or more, all of it is replaced by 1 stack of Frostbite instead.`,
    ];
  },
  frostbite: (stacks) => {
    const cumulative = 1 - 0.75 ** stacks;
    return [
      `No periodic tick. Each stack independently has a 25% chance to fully block this character's energy gain at the start of their own turn — stacking doesn't add flatly, it compounds (more stacks = more independent rolls, not one bigger percentage).`,
      `At ${stacks} stack${stacks === 1 ? '' : 's'}: ${pct(cumulative)} chance of losing that turn's energy gain entirely.`,
      `Cannot be cleansed (Cure, Umbral Purge) or reflected (Status Reflection).`,
    ];
  },
  lifesteal: (stacks) => [
    `No periodic tick — heals this character for ${pct(LIFESTEAL_PER_STACK)} of the damage they deal, per stack, every time they land a hit.`,
    `At ${stacks} stack${stacks === 1 ? '' : 's'}: heals for ${pct(stacks * LIFESTEAL_PER_STACK)} of damage dealt.`,
  ],
  thorns: (stacks) => [
    `No periodic tick — reflects ${pct(THORNS_REFLECT_PER_STACK)} of incoming damage per stack back at the attacker.`,
    `At ${stacks} stack${stacks === 1 ? '' : 's'}: reflects ${pct(stacks * THORNS_REFLECT_PER_STACK)} of damage taken.`,
  ],
  strength: (stacks) => [
    `No periodic tick — a plain +1 Strength per stack, applied continuously.`,
    `At ${stacks} stack${stacks === 1 ? '' : 's'}: +${stacks} Strength.`,
  ],
  defenceReduction: (stacks) => [
    `No periodic tick, and never expires once applied — reduces Defense by 15% per stack, additive (not compounding).`,
    `At ${stacks} stack${stacks === 1 ? '' : 's'}: -${Math.min(100, stacks * 15)}% Defense.`,
  ],
  statusReflection: (stacks) => [
    `No periodic tick — whenever an opponent applies a debuff to this character, this reflects that percentage of the incoming STACK COUNT straight back onto whoever applied it (the rest still lands as normal). 10% per stack, capped at 100%.`,
    `At ${stacks} stack${stacks === 1 ? '' : 's'}: reflects ${pct(Math.min(1, stacks * 0.10))} of any incoming debuff's stacks.`,
    `Darkness and Frostbite can never be reflected, regardless of stacks.`,
  ],
  darkness: (stacks, character) => {
    const acc = stacks * DARKNESS_ACCURACY_PENALTY * 100;
    const budget = stacks * DARKNESS_ENERGY_STEAL_CHANCE_PER_STACK;
    return [
      `No periodic tick.`,
      `Reduces this character's Accuracy by ${pct(DARKNESS_ACCURACY_PENALTY)} per stack.`,
      `At ${stacks} stack${stacks === 1 ? '' : 's'}: Accuracy -${Math.round(acc)} (now ${Math.round(character.getStat('accuracy'))}).`,
      `Also gives whoever inflicted it a ${DARKNESS_ENERGY_STEAL_CHANCE_PER_STACK}% "energy steal budget" per stack at the start of their own turn — every full 100% of budget guarantees 1 stolen energy, the leftover fraction is one more steal's worth of chance.`,
      `At ${stacks} stack${stacks === 1 ? '' : 's'}: ${Math.round(budget)}% budget (${Math.floor(budget / 100)} guaranteed steal${Math.floor(budget / 100) === 1 ? '' : 's'}${budget % 100 > 0 ? ` + ${Math.round(budget % 100)}% chance of one more` : ''}).`,
      `Cannot be cleansed or reflected.`,
    ];
  },
  wearingDarkness: (stacks) => [
    `No periodic tick — reduces both Speed and Defense by 5% per stack for the duration.`,
    `At ${stacks} stack${stacks === 1 ? '' : 's'}: Speed -${Math.min(100, stacks * 5)}%, Defense -${Math.min(100, stacks * 5)}%.`,
  ],
  speedReduction: (stacks) => [
    `No periodic tick, and never expires — a flat -10 Speed per stack, additive.`,
    `At ${stacks} stack${stacks === 1 ? '' : 's'}: -${stacks * 10} Speed. Speed can never drop below 5, no matter how many stacks.`,
  ],
  abyssalFire: (stacks, character) => {
    const runningTotal = character.statusDamageThisFightTurn ?? 0;
    const wouldDeal = Math.round(0.5 * runningTotal * stacks);
    return [
      `Deals damage equal to half of ALL OTHER status damage this character has taken THIS fight turn (from any source — poison, bleed, fire, etc), multiplied by stacks. Recalculated fresh at the moment it ticks, using that turn's own total.`,
      `Status damage taken so far this fight turn: ${runningTotal}. At ${stacks} stack${stacks === 1 ? '' : 's'}, ticking right now would deal ${wouldDeal} damage — the real number at the actual tick depends on everything that lands before it this turn.`,
    ];
  },
};

/** { name, stacks, timingLine, detailLines[] } for the given status effect id on the given character, or null if unrecognized. */
export function getStatusEffectDetail(effectId, character) {
  const cfg = STATUS_EFFECTS[effectId];
  if (!cfg) return null;
  const effect = character.statusEffects.find((e) => e.id === effectId);
  const stacks = effect?.stacks ?? 0;
  const name = tData('status', effectId, cfg.name);
  const timingLine = cfg.tickOn ? TICK_LABEL[cfg.tickOn] ?? null : null;
  const detailFn = DETAILS[effectId];
  const detailLines = detailFn ? detailFn(stacks, character) : [];
  return { name, stacks, timingLine, detailLines };
}
