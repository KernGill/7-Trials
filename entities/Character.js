import {
  DEX_CRIT_RATIO,
  DEX_COOLDOWN_REDUCTION_INTERVAL,
  FROST_HIT_PENALTY,
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
    this.skippedThisFightTurn = false;
    this.pendingDamageReduction = null;
    this.guardState = null;
    this.reflectSplitPercent = 0;
    this.reflectSplitTurnsRemaining = 0;
    this.guaranteedDodgeTurnsRemaining = 0;
    this.pendingReactiveHeal = null;
    this.pendingReactiveHealTurnsRemaining = 0;
    this.physicalDamageReductionPercent = 0;
    this.statusDamageMultipliers = null;
    // Vine Trap-style "ignore the next melee attack" — consumed the
    // instant a melee attack lands (see DamageCalculator.resolveAttack)
    // or decremented to 0 after this many fight_turns, whichever first.
    this.meleeBlockTurnsRemaining = 0;
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
      return Math.max(0, base + card - frostStacks * FROST_HIT_PENALTY * 100);
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
      if (template === 'defenceReduction' && stat === 'def') {
        value -= 10 * effect.stacks;
      }
      if (template === 'strength' && stat === 'str') {
        value += effect.stacks;
      }
    });

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
    let actual = Math.max(0, Math.round(amount));
    if (source) actual = Math.max(0, Math.round(actual * this.getStatusDamageMultiplier(source)));
    this.currentHealth = clamp(this.currentHealth - actual, 0, this.getMaxHealth());
    // Tracks which status effect's tick landed the killing blow, if any —
    // read by achievement checks (e.g. "defeat an enemy via Burn/Bleed").
    if (source && actual > 0 && this.currentHealth <= 0) this.diedFromStatusId = source;
    // Fire's own tick doesn't count as "an instance of damage" for its
    // own decay — everything else that lands (attacks, other status
    // ticks) burns off 35% of the stacks.
    if (actual > 0 && source !== 'fire') this.decayFireStacks();
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
    this.skippedThisFightTurn = false;
    this.pendingDamageReduction = null;
    this.guardState = null;
    this.reflectSplitPercent = 0;
    this.reflectSplitTurnsRemaining = 0;
    this.guaranteedDodgeTurnsRemaining = 0;
    this.pendingReactiveHeal = null;
    this.pendingReactiveHealTurnsRemaining = 0;
    this.physicalDamageReductionPercent = 0;
    this.statusDamageMultipliers = null;
    this.meleeBlockTurnsRemaining = 0;
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
