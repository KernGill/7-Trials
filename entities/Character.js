import {
  DEX_CRIT_RATIO,
  FROST_HIT_PENALTY,
  DARKNESS_ACCURACY_PENALTY,
  STAT_KEYS,
} from '../utils/Constants.js';
import { clamp, roundDown, roundUp } from '../utils/MathUtils.js';
import { StatusEffect } from './SatusEffect.js';
import { Move } from './Move.js';
import { STATUS_EFFECTS } from '../data/statusEffectConfig.js';
import { tData } from '../ui/i18n.js';

export class Character {
  constructor(config) {
    this.id = config.id;
    this._name = config.name ?? config.id;
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
    this.cardBonusStats = config.cardBonusStats ?? {};
    this.battleBuffs = {};
    this.statusEffects = [];
    this.statBuffs = [];
    this.temporaryStatModifiers = {};

    this.currentHealth = config.currentHealth ?? this.getMaxHealth();
    this.diedFromStatusId = null;
    // Tracks which move's own damage killed this character, when that
    // move doesn't go through the normal status-tick path (e.g. Erratic
    // Combustion's consumeStatusForDamage) — read by achievement checks
    // that care about the specific move, not just the status it used.
    this.diedFromMoveId = null;
    this.battleSpeed = config.battleSpeed ?? this.getStat('spd');
    this.storedSpeed = 0;
    this.energy = 0;
    this.hasMoved = false;
    // Set the first time CombatManager.executeMove runs with this character
    // as the attacker — unlike hasMoved (reset every fight turn), this
    // stays true for the rest of the fight. Lets a move's own template flag
    // (usePriorityAsOpeningMove — see Extreme Ignition, EnemyAI.chooseMove)
    // guarantee "always the very first move of the fight" without the AI
    // needing to track turn counts itself.
    this.hasActedInCombat = false;
    this.skippedThisFightTurn = false;
    this.pendingDamageReduction = null;
    this.guardState = null;
    this.reflectSplitPercent = 0;
    this.reflectSplitTurnsRemaining = 0;
    // The other combatant in the current fight — wired up by
    // CombatManager.startCombat() right after resetBattleState() runs (this
    // game is always 1v1, so there's only ever one candidate). Lets
    // takeDamage() redirect a reflectSplitPercent share of *status* damage
    // (see Arcane Split) without every status-tick call site needing to
    // pass an attacker reference of its own — a status tick genuinely has
    // no "attacker" the way a direct hit does.
    this.combatOpponent = null;
    this.guaranteedDodgeTurnsRemaining = 0;
    this.pendingReactiveHeal = null;
    this.pendingReactiveHealTurnsRemaining = 0;
    this.physicalDamageReductionPercent = 0;
    this.statusDamageMultipliers = null;
    // Stun-trap (Vine Trap, Dread Grasp) — see DamageCalculator.resolveAttack.
    // Deliberately plain Character fields, not a StatusEffect: never shown
    // as a buff icon. `stunTrapTurnsRemaining` of -1 means no timed
    // expiry (Dread Grasp — lasts until it triggers); a positive count
    // decays once per fight-turn (see StatusEffectSystem.decayBuffDurations)
    // and clears itself if it never triggers in time (Vine Trap).
    this.stunTrapActive = false;
    this.stunTrapTurnsRemaining = 0;
    // How many stun stacks the trap applies once it triggers — set from
    // the arming move's own template (attackerStunTrap.stunStacks) at the
    // moment it's armed, defaulting to 1 (Vine Trap's original behavior).
    // See CombatManager.executeMove and DamageCalculator.resolveAttack.
    this.stunTrapStunStacks = 1;
    // One-time on-death revive passive (Vanguard of Darkness) — see
    // CombatManager.checkFightEnd. Never reset mid-fight; only cleared on
    // resetBattleState() for the next fight.
    this.hasRevived = false;
    // Running total of status-tick damage (source-tagged takeDamage calls)
    // taken so far THIS fight turn — reset at the start of every fight
    // turn (StatusEffectSystem.tickFightTurnStart), read by Abyssal Fire's
    // own end-of-turn formula. See _applyOwnDamage.
    this.statusDamageThisFightTurn = 0;
    // Tracks repeated same-move casts in a row (Vanguard's Umbral Ward) —
    // see CombatManager.executeMove's debuffOnRepeatCast handling.
    this.lastMoveId = null;
    this.consecutiveMoveCount = 0;
    this.moveIds = [...(config.moveIds ?? [])];
    this.moves = [];
    this.combatLogTag = config.combatLogTag ?? this.name;

    this.dotEffects = [];
    this.passiveTriggers = [];
    this.energyGainBonus = 0;
    this.energyGainBonusTurns = 0;
    // Set only on Player instances by Player.create() from live equipment —
    // read by CombatManager.executeMove for the Torch item's fire-move
    // energy discount. Always false on enemies.
    this.hasTorchEquipped = false;
  }

  /**
   * Translated at read time (not baked in at construction) so every
   * existing call site that reads character.name — arena labels,
   * combat log messages, tooltips — automatically shows the current
   * language without needing to be touched individually. characterId/
   * enemyId aren't set yet during the base constructor (Player/Enemy
   * set them after calling super()), so this falls back to the raw
   * name until then; harmless since nothing reads .name that early.
   */
  get name() {
    const lookupId = this.isPlayer ? this.characterId : (this.isEnemy ? this.enemyId : null);
    if (!lookupId) return this._name;
    return tData(this.isPlayer ? 'character' : 'enemy', lookupId, this._name);
  }

  getStat(stat) {
    // Dodge/accuracy are only ever moved by frost — no equipment, battle
    // buff, or stat buff is allowed to touch them, so they bypass the
    // normal stacking pipeline entirely.
    if (stat === 'dodge' || stat === 'accuracy') {
      const base = this.baseStats[stat] ?? 100;
      const card = this.cardBonusStats[stat] ?? 0;
      const frostStacks = this.getStatusStacks('frost');
      // Darkness only ever muddies your own aim — it doesn't touch dodge.
      const darknessStacks = stat === 'accuracy' ? this.getStatusStacks('darkness') : 0;
      return Math.max(0, base + card - frostStacks * FROST_HIT_PENALTY * 100 - darknessStacks * DARKNESS_ACCURACY_PENALTY * 100);
    }

    const base = this.baseStats[stat] ?? 0;
    const equip = this.equipmentStats[stat] ?? 0;
    const battle = this.battleBuffs[stat] ?? 0;
    const temp = this.temporaryStatModifiers[stat] ?? 0;
    const card = this.cardBonusStats[stat] ?? 0;
    let value = base + equip + battle + temp + card;

    if (stat === 'critChance') {
      const dexBonus = Math.floor(this.getStat('dex') * DEX_CRIT_RATIO);
      value += dexBonus;
    }

    this.statusEffects.forEach((effect) => {
      const template = effect.id;
      // Percent, not flat, and additive per stack — same convention as
      // frost's accuracy penalty (see the accuracy/dodge special case
      // above): 3 stacks is a straightforward 45% reduction, not a
      // compounding 85%^3, so "each stack reduces defense by 15%" reads
      // exactly as stated rather than quietly underselling itself.
      if (template === 'defenceReduction' && stat === 'def') {
        value *= Math.max(0, 1 - 0.15 * effect.stacks);
      }
      if (template === 'strength' && stat === 'str') {
        value += effect.stacks;
      }
      // Vanguard's Wearing Darkness — same additive-percent convention as
      // defenceReduction above, just spread across two stats at once.
      if (template === 'wearingDarkness' && (stat === 'def' || stat === 'spd')) {
        value *= Math.max(0, 1 - 0.05 * effect.stacks);
      }
      // Vanguard's Crippling Shadow — permanent flat reduction (not
      // percent), unlike every other stacking debuff in this file. Floor
      // is applied below, after every other spd modifier has stacked up.
      if (template === 'speedReduction' && stat === 'spd') {
        value -= 10 * effect.stacks;
      }
    });

    // Vanguard's Dark Empowerment — a live bonus, not a fixed passive
    // snapshot: recalculated on every read from the opponent's CURRENT
    // Darkness stacks, so it rises and falls with the fight in real time
    // rather than being locked in once at fight_start like Cinder Skin's
    // resistance. Gated by template flag (not a hardcoded move id) so any
    // future move could grant the same behavior.
    if (stat === 'str' && this.moves?.some((m) => m.template.grantsStrFromOpponentDarkness)) {
      value += this.combatOpponent?.getStatusStacks('darkness') ?? 0;
    }

    if (stat === 'spd') return Math.max(5, value);
    return Math.max(0, value);
  }

  /**
   * NOTE: getStat('critChance') already folds in the dex bonus (see the
   * critChance branch in getStat above) — this method used to add it a
   * SECOND time on top, silently inflating crit chance for every
   * character with any dex at all. Just return getStat directly now.
   */
  getEffectiveCritChance() {
    return this.getStat('critChance');
  }

  getMaxHealth() {
    return this.getStat('con');
  }

  getMaxEnergy() {
    return Math.max(1, Math.round(this.getStat('energy')));
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

  /**
   * Composes every source of status-damage-taken modifier (Ethereal
   * Form's 50% reduction while its dodge buff is active, Formless's
   * per-status multipliers) into one multiplier for a given status id.
   * Only ever consulted from takeDamage() when a `source` is passed —
   * every takeDamage() caller that passes one is a status tick
   * (StatusEffectSystem), never a direct attack, so this can't
   * accidentally apply to attack damage.
   */
  getStatusDamageMultiplier(statusId) {
    let multiplier = 1;
    if (this.guaranteedDodgeTurnsRemaining > 0) multiplier *= 0.5;
    if (this.statusDamageMultipliers) {
      const override = this.statusDamageMultipliers[statusId] ?? this.statusDamageMultipliers.default;
      if (override !== undefined) multiplier *= override;
    }
    multiplier *= 1 - this.getStat('statusDamageReductionPercent') / 100;
    return multiplier;
  }

  takeDamage(amount, { source = null } = {}) {
    const rawAmount = Math.max(0, Math.round(amount));
    // Arcane Split covers status damage too, not just direct hits (see
    // DamageCalculator.resolveAttack for the attack-path version) — split
    // the *raw* amount before either side's own multiplier/reduction is
    // applied, same as the attack path does with applyDefense, so each
    // side's own resistances apply to their own share rather than one
    // pre-computed number just being cut in two. One-shot: consumed the
    // instant it applies to a status hit, same as a direct hit.
    if (source && this.reflectSplitPercent > 0 && this.combatOpponent) {
      const split = this.reflectSplitPercent / 100;
      const taken = Math.round(rawAmount * split);
      const returned = rawAmount - taken;
      this.reflectSplitPercent = 0;
      this.reflectSplitTurnsRemaining = 0;
      this.combatOpponent.takeDamage(returned, { source });
      return this._applyOwnDamage(taken, source);
    }
    return this._applyOwnDamage(rawAmount, source);
  }

  /** The actual per-target damage pipeline (multiplier, shields, health) — split out of takeDamage() so Arcane Split can run it once per side instead of once on a single pre-split total. */
  _applyOwnDamage(rawAmount, source) {
    let actual = rawAmount;
    if (source) actual = Math.max(0, Math.round(actual * this.getStatusDamageMultiplier(source)));
    // A damageReductionPercent/Hits shield tagged includesStatusDamage
    // (see CombatManager.executeMove) also covers status-tick damage, not
    // just direct hits — direct hits go through
    // DamageCalculator.applyDamageReductionState instead, so this only
    // ever fires for a `source`-tagged (status) instance.
    if (source && this.pendingDamageReduction?.includesStatus) {
      const dr = this.pendingDamageReduction;
      if (dr.percent) actual = Math.max(0, Math.round(actual * (1 - dr.percent / 100)));
      if (dr.hits) {
        dr.hits -= 1;
        if (dr.hits <= 0) this.pendingDamageReduction = null;
      } else {
        this.pendingDamageReduction = null;
      }
    }
    this.currentHealth = clamp(this.currentHealth - actual, 0, this.getMaxHealth());
    // Every source-tagged damage instance counts toward this fight turn's
    // running total — read by Abyssal Fire's own end-of-turn formula. Not
    // scoped to any particular status id: whatever landed, landed.
    if (source && actual > 0) this.statusDamageThisFightTurn = (this.statusDamageThisFightTurn ?? 0) + actual;
    // Tracks which status effect's tick landed the killing blow, if any —
    // read by achievement checks (e.g. "defeat an enemy via Burn/Bleed").
    if (source && actual > 0 && this.currentHealth <= 0) this.diedFromStatusId = source;
    // Only a genuine direct attack (no source at all) burns off 35% of
    // fire's stacks — any status-tagged damage (fire's own tick included,
    // but also poison, bleed, darkness's purge bonus, Abyssal Fire, etc.)
    // does NOT trigger this. `source` is only ever set by status ticks;
    // resolveAttack's takeDamage() calls always leave it null.
    if (actual > 0 && !source) this.decayFireStacks();
    return actual;
  }

  decayFireStacks() {
    const fire = this.statusEffects.find((e) => e.id === 'fire');
    if (!fire) return;
    const decay = Math.max(1, roundDown(fire.stacks * STATUS_EFFECTS.fire.decayRatio));
    fire.stacks = Math.max(0, fire.stacks - decay);
    if (fire.stacks <= 0) this.removeStatusEffect('fire');
  }

  heal(amount) {
    const boosted = amount * (1 + this.getStat('healingIncreasePercent') / 100);
    const actual = Math.max(0, Math.round(boosted));
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
    this.diedFromStatusId = null;
    this.diedFromMoveId = null;
    this.battleSpeed = this.getStat('spd');
    this.storedSpeed = 0;
    this.energy = 0;
    this.hasMoved = false;
    this.hasActedInCombat = false;
    this.skippedThisFightTurn = false;
    this.pendingDamageReduction = null;
    this.guardState = null;
    this.reflectSplitPercent = 0;
    this.reflectSplitTurnsRemaining = 0;
    this.combatOpponent = null;
    this.guaranteedDodgeTurnsRemaining = 0;
    this.pendingReactiveHeal = null;
    this.pendingReactiveHealTurnsRemaining = 0;
    this.physicalDamageReductionPercent = 0;
    this.statusDamageMultipliers = null;
    this.stunTrapActive = false;
    this.stunTrapTurnsRemaining = 0;
    this.stunTrapStunStacks = 1;
    this.hasRevived = false;
    this.statusDamageThisFightTurn = 0;
    this.lastMoveId = null;
    this.consecutiveMoveCount = 0;
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
      move.hasFiredOnce = false;
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
