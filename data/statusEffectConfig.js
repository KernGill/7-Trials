export const STATUS_EFFECTS = {
  bleed: {
    id: 'bleed',
    name: 'Bleed',
    type: 'debuff',
    icon: 'B',
    color: '#c0392b',
    tickOn: 'character_turn_start',
    // 1% of max health per stack normally; against bosses (isBoss —
    // covers both a regular arc boss like Indebted Fallen — Warden and a
    // hidden superboss like Vanguard of Darkness, same flag) it's a
    // third of that: 0.33% per stack, i.e. every 3 stacks is 1%.
    formula: (stacks, target) => Math.max(1, Math.ceil(target.getMaxHealth() * (target.isBoss ? stacks / 300 : stacks * 0.01))),
    stacksDecrease: false,
  },
  poison: {
    id: 'poison',
    name: 'Poison',
    type: 'debuff',
    icon: 'P',
    color: '#27ae60',
    tickOn: 'fight_turn_start',
    formula: (stacks) => stacks,
    stacksDecrease: false,
  },
  fire: {
    id: 'fire',
    name: 'Fire',
    type: 'debuff',
    icon: 'F',
    color: '#e67e22',
    tickOn: 'fight_turn_end',
    formula: (stacks) => stacks * 3,
    stacksDecrease: true,
    decayRatio: 0.35,
  },
  stun: {
    id: 'stun',
    name: 'Stun',
    type: 'debuff',
    icon: 'S',
    color: '#f1c40f',
    skipTurn: true,
    stacksDecreaseOnSkip: true,
  },
  frost: {
    id: 'frost',
    name: 'Frost',
    type: 'debuff',
    icon: 'Fr',
    color: '#74b9ff',
    hitPenaltyPerStack: 0.03,
    damageTakenBonusPerStack: 0.01,
    convertAt: 25,
    convertTo: 'frostbite',
  },
  frostbite: {
    id: 'frostbite',
    name: 'Frostbite',
    type: 'debuff',
    icon: 'Fb',
    color: '#0984e3',
    energyBlockChancePerStack: 0.25,
    stacksDecrease: false,
    cannotCleanse: true,
    // Can't be redirected back onto the attacker by Status Reflection
    // either — see StatusEffectSystem.applyDebuffs.
    noReflect: true,
  },
  lifesteal: {
    id: 'lifesteal',
    name: 'Lifesteal',
    type: 'buff',
    icon: 'L',
    color: '#9b59b6',
    healRatioPerStack: 0.05,
    stacksDecrease: false,
  },
  thorns: {
    id: 'thorns',
    name: 'Thorns',
    type: 'buff',
    icon: 'T',
    color: '#8e44ad',
    reflectPerStack: 0.03,
    stacksDecrease: false,
  },
  // Ignite's Motivation buff — 2 stacks granted per cast. Pure
  // stack-tracker + icon/flavor metadata, same convention as
  // strength/thorns/lifesteal below: the real mechanic (consume exactly
  // 1 stack, grant 1 flat energy, on the owner's own next character-turn)
  // is hardcoded in CombatManager's character-turn-start flow, right
  // after the normal per-turn energy roll — not tickOn/formula-based
  // like the damage-over-time effects above, since it grants energy
  // rather than dealing damage.
  motivation: {
    id: 'motivation',
    name: 'Motivation',
    type: 'buff',
    icon: 'Mv',
    color: '#f39c12',
    flavour: 'Ignite the enemy and your heart.',
    stacksDecrease: false,
  },
  strength: {
    id: 'strength',
    name: 'Strength',
    type: 'buff',
    icon: '+S',
    color: '#e17055',
    statBonus: { str: 1 },
    stacksDecrease: false,
  },
  // Real behavior (15%-per-stack, additive, permanent) is hardcoded in
  // Character.getStat's def branch — no statBonus/durationFightTurns
  // fields here, both are dead reads left over from an earlier flat-value
  // design.
  defenceReduction: {
    id: 'defenceReduction',
    name: 'Shattered Stance',
    type: 'debuff',
    icon: '-D',
    color: '#636e72',
    stacksDecrease: false,
  },
  statusReflection: {
    id: 'statusReflection',
    name: 'Status Reflection',
    type: 'buff',
    icon: 'SR',
    color: '#00cec9',
    // Not a chance to redirect the WHOLE application anymore — each stack
    // reflects this % of whatever stack count was about to be applied
    // back onto the original attacker, the rest still lands on the
    // target. 10 fire incoming at 8 stacks (40%) → 4 reflected, 6 still
    // applies. See StatusEffectSystem.applyDebuffs.
    reflectPercentPerStack: 5,
    stacksDecrease: false,
  },
  // Pure stack-tracker, same as stun/strength/defenceReduction above — real
  // behavior (accuracy penalty, energy-steal chance) is hardcoded in
  // Character.getStat() and CombatManager.resolveEnemyTurn().
  darkness: {
    id: 'darkness',
    name: 'Darkness',
    type: 'debuff',
    icon: 'Dk',
    color: '#2c2c54',
    stacksDecrease: false,
    // Same flag frostbite already carries — see Cure's cleanseNegativePercent
    // and Umbral Purge's clearAllStatusesForDamage in CombatManager.js,
    // the only two mechanics that ever strip statuses off a character.
    cannotCleanse: true,
    // Can't be redirected back onto the attacker by Status Reflection
    // either — see StatusEffectSystem.applyDebuffs.
    noReflect: true,
  },
  // Vanguard's Wearing Darkness passive — real behavior (spd AND def both
  // reduced 5% per stack, additive) hardcoded in Character.getStat.
  // Stack count is set per-application from the caster's current energy
  // (see StatusEffectSystem.applyDebuffs' stacksFromCasterEnergy), not a
  // fixed number here.
  wearingDarkness: {
    id: 'wearingDarkness',
    name: 'Wearing Darkness',
    type: 'debuff',
    icon: 'WD',
    color: '#1e1b3a',
    stacksDecrease: false,
  },
  // Vanguard's Crippling Shadow — permanent flat -10 speed per stack (see
  // Character.getStat's spd branch), floored at 5 total speed same as
  // every other source of speed loss.
  speedReduction: {
    id: 'speedReduction',
    name: 'Speed Reduction',
    type: 'debuff',
    icon: '-Sp',
    color: '#57606f',
    stacksDecrease: false,
  },
  // Vanguard's Abyssal Cascade — end-of-fight-turn-only damage: half the
  // TOTAL status damage this character took from every other source this
  // fight turn (poison, bleed, fire, etc — see
  // Character.statusDamageThisFightTurn), multiplied by stacks. Ticks
  // last among fight_turn_end effects every turn it's active — see
  // StatusEffectSystem.tickFightTurnEnd's two-pass ordering.
  abyssalFire: {
    id: 'abyssalFire',
    name: 'Abyssal Fire',
    type: 'debuff',
    icon: 'AF',
    color: '#4b0082',
    tickOn: 'fight_turn_end',
    formula: (stacks, target) => Math.round(0.5 * (target.statusDamageThisFightTurn ?? 0) * stacks),
    stacksDecrease: false,
  },
};
