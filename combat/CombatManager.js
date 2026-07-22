import { COOLDOWN_TYPES, MOVE_PROPERTIES } from '../utils/Constants.js';
import { GOLD_REWARD_RATIO } from '../utils/Constants.js';
import { DamageCalculator } from './DamageCalculator.js';
import { EnergySystem, CooldownSystem } from './EnergySystem.js';
import { TurnOrderSystem } from './TurnOrderSystem.js';
import { StatusEffectSystem } from './StatusEffectSystem.js';
import { EnemyAI } from './EnemyAI.js';
import { rollDrop } from '../utils/RandomUtils.js';
import { rollChance } from '../utils/MathUtils.js';
import { getItemConfig } from '../data/items.js';
import { getConsumableConfig } from '../data/consumables.js';
import { STATUS_EFFECTS } from '../data/statusEffectConfig.js';
import { statLabel } from '../ui/InfoFormatters.js';
import { t, tData } from '../ui/i18n.js';

export const COMBAT_PHASE = {
  WAITING: 'waiting',
  PLAYER_TURN: 'player_turn',
  ENEMY_TURN: 'enemy_turn',
  RESOLVING: 'resolving',
  VICTORY: 'victory',
  DEFEAT: 'defeat',
};

export class CombatManager {
  constructor(eventBus) {
    this.eventBus = eventBus;
    this.turnOrder = new TurnOrderSystem();
    this.energySystem = new EnergySystem();
    this.cooldownSystem = new CooldownSystem();
    this.statusSystem = new StatusEffectSystem();
    this.enemyAI = new EnemyAI();
    this.reset();
  }

  reset() {
    this.player = null;
    this.enemies = [];
    this.phase = COMBAT_PHASE.WAITING;
    this.currentActor = null;
    this.log = [];
    this.rewards = null;
    this.selectedMove = null;
    this.pendingExplorationBuffs = [];
    this.sequence = [];
    this.turnOrder.reset();
    this.enemyAI.reset();
  }

  /**
   * Every meaningful sub-event of a synchronous cascade (fight-turn
   * start, a character's turn beginning, a status tick, a move landing)
   * gets pushed here instead of only surfacing as a text log line. The
   * whole batch is flushed as one `combat:sequence` array right before
   * control visibly returns to someone (player's turn, victory, defeat)
   * — FightState replays it at a human pace even though every mutation
   * inside it already happened instantly, under the hood, in order.
   */
  record(step) {
    this.sequence.push(step);
  }

  recordTick({ character, effectId, amount }, phase) {
    this.record({
      kind: 'statusTick',
      character,
      effectId,
      amount,
      phase,
      health: character.currentHealth,
      energy: character.energy,
    });
  }

  flushSequence() {
    if (!this.sequence.length) return;
    const steps = this.sequence;
    this.sequence = [];
    this.eventBus.emit('combat:sequence', steps);
  }

  startCombat({ player, enemies, explorationBuffs = [] }) {
    this.reset();
    this.player = player;
    this.enemies = enemies;
    this.pendingExplorationBuffs = explorationBuffs;

    [player, ...enemies].forEach((c) => c.resetBattleState());
    this.record({
      kind: 'fightInit',
      combatants: this.combatants.map((c) => ({ character: c, health: c.currentHealth, energy: c.energy, speed: c.battleSpeed })),
    });
    this.applyExplorationBuffs();
    this.triggerPassives('fight_start');
    this.turnOrder.beginFightTurn(this.combatants);
    this.record({ kind: 'fightTurn', n: this.turnOrder.fightTurn, isFirst: true });
    this.statusSystem.tickFightTurnStart(this.combatants, (m) => this.logMessage(m), (tick) => this.recordTick(tick, 'fightTurnStart'));
    this.processDotEffects();
    this.cooldownSystem.tickFightTurn(this.combatants);
    this.triggerPassives('fight_turn_start');
    this.advanceTurn();
    this.eventBus.emit('combat:started', this.getState());
  }

  get combatants() {
    return [this.player, ...this.enemies].filter(Boolean);
  }

  get aliveEnemies() {
    return this.enemies.filter((e) => e.isAlive());
  }

  applyExplorationBuffs() {
    this.pendingExplorationBuffs.forEach((buff) => {
      this.statusSystem.applyBuffs(this.player, [buff], this.player);
    });
    this.pendingExplorationBuffs = [];
  }

  /**
   * Pushed oldest-first (newest at the end) so FightState's battle log
   * reads top-to-bottom in chronological order. Each entry is tagged with
   * the fight turn and the currently-acting character it happened
   * under — `this.currentActor` is set once per character-turn (in
   * advanceTurn(), right before that actor's own turnStart/moves/turnEnd
   * all run) and stays accurate for every logMessage() call in between,
   * so FightState can group consecutive same-turn/same-actor lines
   * together and insert separators when either changes.
   */
  logMessage(message) {
    this.log.push({ message, fightTurn: this.turnOrder.fightTurn, actor: this.currentActor });
    if (this.log.length > 30) this.log.shift();
    this.eventBus.emit('combat:log', message);
  }

  /** One log line per debuff StatusEffectSystem.applyDebuffs actually landed (its return value already excludes anything blocked by statusResist). */
  logDebuffResults(applied) {
    applied.forEach(({ recipient, effectId, stacks }) => {
      this.logMessage(t('log.debuff_applied', {
        name: recipient.name,
        n: stacks,
        status: tData('status', effectId, STATUS_EFFECTS[effectId]?.name ?? effectId),
      }));
    });
  }

  /** One log line per buff StatusEffectSystem.applyBuffs actually granted. */
  logBuffResults(target, applied) {
    applied.forEach((buff) => {
      if (buff.type === 'stat') {
        this.logMessage(t('log.stat_buff', { name: target.name, n: buff.amount, stat: statLabel(buff.stat) }));
      } else if (buff.type === 'effect') {
        this.logMessage(t('log.buff_applied', {
          name: target.name,
          n: buff.stacks,
          status: tData('status', buff.effectId, STATUS_EFFECTS[buff.effectId]?.name ?? buff.effectId),
        }));
      } else if (buff.type === 'energyGainBonus') {
        this.logMessage(t('log.energy_buff', { name: target.name }));
      } else if (buff.type === 'conFromInt') {
        this.logMessage(t('log.health_buff', { name: target.name, n: buff.amount }));
      }
    });
  }

  getState() {
    return {
      phase: this.phase,
      fightTurn: this.turnOrder.fightTurn,
      currentActor: this.currentActor,
      player: this.player,
      enemies: this.enemies,
      log: [...this.log],
      rewards: this.rewards,
    };
  }

  /**
   * Status damage (bleed/poison/fire) is applied inside tick blocks below,
   * not as part of a move's own executeMove()/endActorTurn() chain — so a
   * kill from a tick doesn't get the immediate follow-up victory/defeat
   * check that a direct attack kill does. Without this, the enemy could
   * die to a status tick mid-advanceTurn(), the game would still hand the
   * player another turn, and playerUseMove() would then fail forever with
   * "No valid target" (since aliveEnemies is empty) without ever calling
   * advanceTurn() again to notice the fight is actually over.
   * Returns true if the fight ended (caller should stop immediately).
   */
  checkFightEnd() {
    if (!this.player?.isAlive()) {
      this.phase = COMBAT_PHASE.DEFEAT;
      this.flushSequence();
      this.eventBus.emit('combat:defeat', this.getState());
      return true;
    }
    if (!this.aliveEnemies.length) {
      this.finishVictory();
      return true;
    }
    return false;
  }

  /**
   * Resolves queued follow-up damage instances (e.g. Bone Zone: 1 hit on
   * cast + 2 more queued via `repeatInstances`, one per fight-turn-start).
   * Each instance re-rolls hit/crit/defense like a normal attack and only
   * applies the move's debuffs if it actually lands.
   */
  processDotEffects() {
    this.combatants.forEach((attacker) => {
      if (!attacker.dotEffects.length) return;
      attacker.dotEffects = attacker.dotEffects.filter((dot) => {
        if (!attacker.isAlive() || !dot.target.isAlive()) return false;

        const result = DamageCalculator.resolveAttack({ attacker, defender: dot.target, move: dot.move });
        const dotMoveName = tData('move', dot.move.id, dot.move.name);
        if (!result.hit) {
          this.logMessage(t('log.follow_up_missed', { move: dotMoveName, target: dot.target.name }));
        } else {
          const critText = result.isCrit ? t('log.crit_suffix') : '';
          this.logMessage(t('log.follow_up_damage', { move: dotMoveName, n: result.damage, target: dot.target.name, crit: critText }));
          if (dot.move.debuffs) this.logDebuffResults(this.statusSystem.applyDebuffs(dot.target, dot.move.debuffs, attacker));
          this.eventBus.emit('combat:move_resolved', { attacker, defender: dot.target, move: dot.move, result });
        }
        this.record({
          kind: 'move',
          attacker,
          defender: dot.target,
          move: dot.move,
          result,
          attackerHealth: attacker.currentHealth,
          attackerEnergy: attacker.energy,
          defenderHealth: dot.target.currentHealth,
          defenderEnergy: dot.target.energy,
        });

        dot.remaining -= 1;
        return dot.remaining > 0;
      });
    });
  }

  advanceTurn() {
    if (this.checkFightEnd()) return;

    if (this.turnOrder.allHaveMoved(this.combatants)) {
      this.statusSystem.tickFightTurnEnd(this.combatants, (m) => this.logMessage(m), (tick) => this.recordTick(tick, 'fightTurnEnd'));
      if (this.checkFightEnd()) return;
      this.combatants.forEach((c) => this.statusSystem.decayBuffDurations(c));
      this.turnOrder.endFightTurn(this.combatants);
      this.turnOrder.beginFightTurn(this.combatants);
      this.record({ kind: 'fightTurn', n: this.turnOrder.fightTurn, isFirst: false });
      this.statusSystem.tickFightTurnStart(this.combatants, (m) => this.logMessage(m), (tick) => this.recordTick(tick, 'fightTurnStart'));
      if (this.checkFightEnd()) return;
      this.processDotEffects();
      if (this.checkFightEnd()) return;
      this.cooldownSystem.tickFightTurn(this.combatants);
      this.triggerPassives('fight_turn_start');
    }

    const actor = this.turnOrder.getNextActor(this.combatants);
    if (!actor) return;

    this.currentActor = actor;
    // A distinct beat showing every combatant's current battleSpeed
    // *before* revealing whose turn this is — so the comparison that
    // decides the next actor is actually visible, not just its result.
    this.record({
      kind: 'speedCheck',
      combatants: this.combatants.map((c) => ({ character: c, speed: c.battleSpeed })),
      actor,
    });
    const skip = this.turnOrder.onCharacterTurnStart(actor);
    if (skip.skipped) {
      this.logMessage(t('log.stunned_skip', { name: actor.name }));
      this.record({ kind: 'turnSkip', character: actor, health: actor.currentHealth, energy: actor.energy });
      this.endActorTurn(actor);
      return;
    }

    this.record({ kind: 'turnStart', character: actor, health: actor.currentHealth, energy: actor.energy });
    this.statusSystem.tickCharacterTurnStart(actor, (m) => this.logMessage(m), (tick) => this.recordTick(tick, 'characterTurnStart'));
    if (this.checkFightEnd()) return;
    this.triggerPassives('character_turn_start', actor);
    const gained = this.energySystem.gainEnergy(actor);
    if (gained > 0) {
      this.logMessage(t('log.gains_energy', { name: actor.name, n: gained }));
      // Turn-start energy gain has no animated beat of its own — the
      // `turnStart` step above was recorded (and will display) *before*
      // this ran, so without this the x/max energy readout stays stuck on
      // the pre-gain value until some unrelated later step happens to
      // resnapshot this character. Record it so FightState refreshes the
      // display immediately once this reaches the player.
      this.record({ kind: 'energyGain', character: actor, health: actor.currentHealth, energy: actor.energy });
    }

    if (actor.isPlayer) {
      this.phase = COMBAT_PHASE.PLAYER_TURN;
      this.flushSequence();
      this.eventBus.emit('combat:player_turn', this.getState());
    } else {
      this.phase = COMBAT_PHASE.ENEMY_TURN;
      this.resolveEnemyTurn(actor);
    }
  }

  endActorTurn(actor) {
    this.cooldownSystem.tickCharacterTurn(actor);
    this.turnOrder.onCharacterTurnEnd(actor);
    if (!actor.isPlayer) this.enemyAI.onTurnEnd();
    this.statusSystem.tickCharacterTurnEnd(actor, (m) => this.logMessage(m), (tick) => this.recordTick(tick, 'characterTurnEnd'));
    this.record({ kind: 'turnEnd', character: actor, health: actor.currentHealth, energy: actor.energy, speed: actor.battleSpeed });
    this.advanceTurn();
  }

  resolveEnemyTurn(enemy) {
    const move = this.enemyAI.chooseMove(enemy, this.player);
    if (!move) {
      this.logMessage(t('log.cannot_act', { name: enemy.name }));
      this.endActorTurn(enemy);
      return;
    }
    this.eventBus.emit('combat:enemy_move_flash', { enemy, move });
    this.executeMove(enemy, this.player, move);
    this.endActorTurn(enemy);
  }

  playerUseMove(moveId, targetId = null) {
    if (this.phase !== COMBAT_PHASE.PLAYER_TURN) return { ok: false, reason: 'Not your turn.' };
    const move = this.player.moves.find((m) => m.id === moveId);
    if (!move) return { ok: false, reason: 'Unknown move.' };
    if (!move.isAvailable(this.player.energy)) return { ok: false, reason: 'Move unavailable.' };

    const target = this.enemies.find((e) => e.id === targetId) ?? this.aliveEnemies[0];
    if (!target) return { ok: false, reason: 'No valid target.' };

    this.executeMove(this.player, target, move);
    this.endActorTurn(this.player);
    return { ok: true };
  }

  executeMove(attacker, defender, move) {
    // Torch's fire-move discount: any move that applies the 'fire' debuff
    // costs 1 less energy for a player wielding it — data-driven off the
    // move's own debuffs list (not a hardcoded move-id allowlist), so it
    // covers Ignite plus anything else that applies fire, present or future.
    const appliesFire = move.template.debuffs?.some((d) => d.effect === 'fire');
    const energyCost = (attacker.isPlayer && attacker.hasTorchEquipped && appliesFire)
      ? Math.max(0, move.energyCost - 1)
      : move.energyCost;
    if (!this.energySystem.spendEnergy(attacker, energyCost)) {
      this.logMessage(t('log.lacks_energy', { name: attacker.name, move: move.name }));
      return;
    }

    if (!rollChance(attacker.getStat('noCooldownChance'))) {
      const reduction = attacker.getCooldownReduction();
      move.startCooldown(reduction);
    }
    this.logMessage(t('log.uses_move', { name: attacker.name, move: move.name }));

    if (move.template.healMaxPercent) {
      const healed = attacker.healMissingPercent(move.template.healMaxPercent);
      this.logMessage(t('log.heals', { name: attacker.name, n: healed }));
    }

    // Erratic Combustion: consumed BEFORE this move's own debuffs apply —
    // the defender loses all stacks of the given status, taking flat
    // damage per stack lost. Unconditional (no attack roll involved),
    // same as the debuffs/buffs blocks below.
    if (move.template.consumeStatusForDamage) {
      const { effect, damagePerStack } = move.template.consumeStatusForDamage;
      const stacks = defender.getStatusStacks(effect);
      if (stacks > 0) {
        defender.removeStatusEffect(effect);
        // Tagged with the consumed effect as its damage source (e.g.
        // 'fire' for Erratic Combustion) so it correctly scales with
        // getStatusDamageMultiplier — same as any other status tick — so
        // a target's fire vulnerability (Formless) or fire resistance
        // applies to it too, not just literal burn ticks.
        defender.takeDamage(stacks * damagePerStack, { source: effect });
      }
    }

    // Chaotic Combustion: consumes the given status from BOTH sides
    // independently — each side's damage comes from its OWN removed
    // stacks (your own pile of self-inflicted fire hurts you, not them),
    // unlike consumeStatusForDamage above which only ever touches the
    // defender.
    if (move.template.consumeStatusForDamageBothSides) {
      const { effect, damagePerStack } = move.template.consumeStatusForDamageBothSides;
      const defenderStacks = defender.getStatusStacks(effect);
      if (defenderStacks > 0) {
        defender.removeStatusEffect(effect);
        defender.takeDamage(defenderStacks * damagePerStack, { source: effect });
      }
      const attackerStacks = attacker.getStatusStacks(effect);
      if (attackerStacks > 0) {
        attacker.removeStatusEffect(effect);
        attacker.takeDamage(attackerStacks * damagePerStack, { source: effect });
      }
    }

    let result = null;
    if (move.template.damage > 0 || move.scaling !== 'none') {
      result = DamageCalculator.resolveAttack({ attacker, defender, move });
      if (!result.hit) {
        this.logMessage(result.blocked
          ? t('log.melee_blocked', { name: defender.name, move: move.name })
          : t('log.missed', { name: attacker.name, move: move.name }));
      } else if (result.split) {
        this.logMessage(t('log.splits_damage', { move: move.name }));
      } else {
        const critText = result.isCrit ? t('log.crit_suffix') : '';
        this.logMessage(t('log.deals_damage', { move: move.name, n: result.damage, crit: critText }));
        if (result.healed > 0) this.logMessage(t('log.lifesteals', { name: attacker.name, n: result.healed }));
        if (result.reducedAmount > 0) {
          this.logMessage(t('log.damage_negated', { n: result.reducedAmount, move: result.reducedByMoveName }));
        }
        if (result.reflected > 0) {
          this.logMessage(t('log.thorns_reflected', { n: result.reflected, name: attacker.name }));
        }
      }
    }

    // Only if the attack actually landed (never on a miss or a Vine Trap
    // block) — Extreme Ignition's self-harm cost.
    if (move.template.selfDamagePercentOnHit && result?.hit) {
      attacker.takeDamage(attacker.currentHealth * (move.template.selfDamagePercentOnHit / 100));
    }

    if (move.template.debuffs && (!result || result.hit)) {
      this.logDebuffResults(this.statusSystem.applyDebuffs(defender, move.template.debuffs, attacker));
    }
    if (move.template.buffs) {
      this.applySelfBuffs(attacker, move.template.buffs);
    }

    // The exact percent/flat amount varies per move (and isn't known
    // until it actually blocks something — see result.reducedAmount in
    // the damage-dealt branch above), so this just announces that a
    // shield is now up, not how strong it is.
    if (move.template.guardPercent) {
      attacker.guardState = { percent: move.template.guardPercent, sourceMoveName: move.name };
      this.logMessage(t('log.defensive_stance', { name: attacker.name }));
    }
    if (move.template.damageReductionNext) {
      attacker.pendingDamageReduction = { flat: move.template.damageReductionNext, sourceMoveName: move.name };
      this.logMessage(t('log.defensive_stance', { name: attacker.name }));
    }
    if (move.template.damageReductionPercent) {
      attacker.pendingDamageReduction = {
        percent: move.template.damageReductionPercent,
        hits: move.template.damageReductionHits ?? 1,
        includesStatus: move.template.includesStatusDamage ?? false,
        sourceMoveName: move.name,
      };
      this.logMessage(t('log.defensive_stance', { name: attacker.name }));
    }
    if (move.template.reflectSplitPercent) {
      attacker.reflectSplitPercent = move.template.reflectSplitPercent;
      attacker.reflectSplitTurnsRemaining = move.template.reflectSplitDurationFightTurns ?? 1;
    }
    if (move.template.guaranteedDodgeFightTurns) {
      attacker.guaranteedDodgeTurnsRemaining = move.template.guaranteedDodgeFightTurns;
    }
    if (move.template.reactiveHealMultiplier) {
      attacker.pendingReactiveHeal = { multiplier: move.template.reactiveHealMultiplier };
      attacker.pendingReactiveHealTurnsRemaining = move.template.reactiveHealDurationFightTurns ?? -1;
    }
    if (move.template.meleeBlockFightTurns) {
      attacker.meleeBlockTurnsRemaining = move.template.meleeBlockFightTurns;
    }

    if (move.template.repeatInstances) {
      attacker.dotEffects.push({
        move: move.template,
        remaining: move.template.repeatInstances,
        target: defender,
      });
    }

    if (attacker.isPlayer && result?.hit && !result.split) {
      defender.playerHitCount = (defender.playerHitCount ?? 0) + 1;
    }

    // Reactive passives (Mind Erosion): fired on the defender, scoped to
    // just them, whenever a melee attack actually lands on them. Mirrors
    // the debuffs guard above — no result at all (0-damage touch moves)
    // counts as an automatic hit, same as a rolled one.
    if ((!result || (result.hit && !result.split)) && move.properties.includes(MOVE_PROPERTIES.MELEE)) {
      this.triggerPassives('melee_hit_taken', defender);
    }

    this.record({
      kind: 'move',
      attacker,
      defender,
      move,
      result,
      attackerHealth: attacker.currentHealth,
      attackerEnergy: attacker.energy,
      defenderHealth: defender.currentHealth,
      defenderEnergy: defender.energy,
    });

    this.eventBus.emit('combat:move_resolved', { attacker, defender, move, result });
  }

  /**
   * Using a consumable takes the character's turn but skips normal
   * move machinery (no energy cost, no cooldown, no target selection —
   * always affects the player). `effect` is the consumable's own
   * combatEffect config (data/consumables.js), applied here so
   * CombatManager stays the single place that knows how to end a turn.
   */
  playerUseConsumable(name, effect = {}) {
    if (this.phase !== COMBAT_PHASE.PLAYER_TURN) return { ok: false, reason: 'Not your turn.' };

    this.logMessage(t('log.uses_move', { name: this.player.name, move: name }));
    if (effect.healMaxPercent) {
      const healed = this.player.healMissingPercent(effect.healMaxPercent);
      this.logMessage(t('log.heals', { name: this.player.name, n: healed }));
    }
    if (effect.buff) {
      this.logBuffResults(this.player, this.statusSystem.applyBuffs(this.player, [effect.buff], this.player));
    }
    if (effect.debuff) {
      const target = this.aliveEnemies[0];
      if (target) this.logDebuffResults(this.statusSystem.applyDebuffs(target, [effect.debuff], this.player));
    }

    this.record({ kind: 'consumable', character: this.player, health: this.player.currentHealth, energy: this.player.energy });
    this.endActorTurn(this.player);
    return { ok: true };
  }

  triggerPassives(trigger, actor = null) {
    const actors = actor ? [actor] : this.combatants;
    actors.forEach((character) => {
      character.moves.forEach((move) => {
        if (move.template.trigger !== trigger) return;
        // triggerInterval lets a passive fire only every Nth time its
        // trigger event happens (e.g. Challenger's Mettle: every 2nd of
        // its owner's own character_turn_start; Gluttonous Maw: every
        // 4th fight_turn_start) instead of every single occurrence.
        if (move.template.triggerInterval) {
          move.passiveCounter += 1;
          if (move.passiveCounter % move.template.triggerInterval !== 0) return;
        }
        if (move.template.buffs) {
          this.applySelfBuffs(character, move.template.buffs);
        }
        if (move.template.debuffs) {
          const target = character.isPlayer ? this.aliveEnemies[0] : this.player;
          const chanceOk = !move.template.debuffChance || rollChance(move.template.debuffChance);
          if (target && chanceOk) this.logDebuffResults(this.statusSystem.applyDebuffs(target, move.template.debuffs, character));
        }
        // Unlike `debuffs` (always routed to the opponent above),
        // `selfDebuffs` targets the passive's own owner — Ash Eater.
        if (move.template.selfDebuffs) {
          this.logDebuffResults(this.statusSystem.applyDebuffs(character, move.template.selfDebuffs, character));
        }
        if (move.template.grantConsumables) {
          character.combatConsumables = { ...move.template.grantConsumables };
        }
        if (move.template.grantGoldFlat) {
          character.pendingGoldBonus = (character.pendingGoldBonus ?? 0) + move.template.grantGoldFlat;
        }
        if (move.template.physicalDamageReductionPercent) {
          character.physicalDamageReductionPercent =
            (character.physicalDamageReductionPercent ?? 0) + move.template.physicalDamageReductionPercent;
        }
        if (move.template.statusDamageMultipliers) {
          // Multiplied (not overwritten) so two copies of the same passive
          // (e.g. Formless from two equipped sources) genuinely compound.
          const current = character.statusDamageMultipliers ?? {};
          const next = { ...current };
          Object.entries(move.template.statusDamageMultipliers).forEach(([key, mult]) => {
            next[key] = (current[key] ?? 1) * mult;
          });
          character.statusDamageMultipliers = next;
        }
      });
    });
  }

  /**
   * Applies a self-buff (attacker buffing themselves, either via an
   * active move or a passive) and — Thief's Envy — gives the opposing
   * side a chance to steal the same buff for themselves.
   */
  applySelfBuffs(character, buffs) {
    const applied = this.statusSystem.applyBuffs(character, buffs, character);
    this.logBuffResults(character, applied);
    const opponent = character.isPlayer ? this.aliveEnemies[0] : this.player;
    if (!opponent) return;
    const stealChance = opponent.moves.reduce((max, m) => Math.max(max, m.template.stealBuffChance ?? 0), 0);
    if (stealChance > 0 && rollChance(stealChance)) {
      const stolen = this.statusSystem.applyBuffs(opponent, buffs, opponent);
      this.logBuffResults(opponent, stolen);
    }
  }

  finishVictory() {
    this.phase = COMBAT_PHASE.VICTORY;
    this.triggerPassives('combat_victory', this.player);
    const totalHealth = this.enemies.reduce((sum, e) => sum + e.baseStats.con, 0);
    const gold = Math.floor(totalHealth * GOLD_REWARD_RATIO) + (this.player.pendingGoldBonus ?? 0);
    this.player.pendingGoldBonus = 0;
    const drops = { materials: {}, items: [], consumables: {} };

    this.enemies.forEach((enemy) => {
      const config = enemy.drops;
      config.materials?.forEach((drop) => {
        const qty = rollDrop(drop);
        if (qty > 0) drops.materials[drop.id] = (drops.materials[drop.id] ?? 0) + qty;
      });
      config.items?.forEach((drop) => {
        const qty = rollDrop(drop);
        if (qty > 0) {
          if (drop.isConsumable) {
            drops.consumables[drop.id] = (drops.consumables[drop.id] ?? 0) + qty;
          } else {
            drops.items.push(drop.id);
          }
        }
      });
    });

    this.rewards = { gold, drops };
    this.logMessage(t('log.victory', { n: gold }));
    this.flushSequence();
    this.eventBus.emit('combat:victory', this.getState());
  }

  abandon() {
    this.phase = COMBAT_PHASE.DEFEAT;
    this.eventBus.emit('combat:abandoned', this.getState());
  }
}
