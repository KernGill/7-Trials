import { COOLDOWN_TYPES, MOVE_PROPERTIES } from '../utils/Constants.js';
import { GOLD_REWARD_RATIO, DARKNESS_ENERGY_STEAL_CHANCE_PER_STACK } from '../utils/Constants.js';
import { DamageCalculator } from './DamageCalculator.js';
import { EnergySystem, CooldownSystem } from './EnergySystem.js';
import { TurnOrderSystem } from './TurnOrderSystem.js';
import { StatusEffectSystem } from './StatusEffectSystem.js';
import { EnemyAI } from './EnemyAI.js';
import { CombatTimeline } from './CombatTimeline.js';
import { PassiveTriggerSystem } from './PassiveTriggerSystem.js';
import { rollDrop, pickRandom } from '../utils/RandomUtils.js';
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
    this.timeline = new CombatTimeline(eventBus);
    this.passiveSystem = new PassiveTriggerSystem();
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
    this.pendingEnemyDebuff = null;
    this.timeline.reset();
    this.turnOrder.reset();
    this.enemyAI.reset();
    // Thief's Guilt (Thief's Skin) needs to know which enemy died LAST in
    // a multi-enemy fight — see stampEnemyDeaths/finishVictory.
    this.deathCounter = 0;
  }

  /**
   * Stamps `enemy.deathOrder` (a monotonic sequence number) on any enemy
   * that's newly dead since the last call — called at the top of every
   * checkFightEnd(), which already runs after essentially every
   * damage-dealing action in the game, so real single-target kills get
   * their true chronological order. Simultaneous AOE kills within one
   * move (which all become non-alive together, with no checkFightEnd in
   * between) fall back to array order as a deterministic tie-break —
   * invisible in practice since the player can't perceive sub-turn
   * ordering anyway.
   */
  stampEnemyDeaths() {
    this.enemies.forEach((e) => {
      if (!e.isAlive() && e.deathOrder === -1) {
        this.deathCounter += 1;
        e.deathOrder = this.deathCounter;
      }
    });
  }

  // The timeline sequence recorder — see CombatTimeline's own doc comment.
  // Kept as thin delegates (rather than switching every call site to
  // `this.timeline.record(...)`) so this extraction touched zero of the
  // ~19 existing call sites.
  record(step) {
    this.timeline.record(step);
  }

  recordTick(tick, phase) {
    this.timeline.recordTick(tick, phase);
  }

  flushSequence() {
    this.timeline.flushSequence();
  }

  startCombat({ player, enemies, explorationBuffs = [], pendingEnemyDebuff = null }) {
    this.reset();
    this.player = player;
    this.enemies = enemies;
    this.pendingExplorationBuffs = explorationBuffs;
    this.pendingEnemyDebuff = pendingEnemyDebuff;

    [player, ...enemies].forEach((c) => c.resetBattleState());
    // Enemies always fight a solo player, so every enemy's combatOpponent
    // is simply the player, unconditionally. The player's combatOpponent
    // instead means "the player's currently selected target" (see
    // setPlayerTarget below) — reused by Character.takeDamage's
    // reflectSplitPercent (Arcane Split) redirect and Dark Empowerment's
    // live str bonus, on top of driving move targeting — defaulting to the
    // first alive enemy until the player picks someone else.
    enemies.forEach((e) => { e.combatOpponent = player; });
    player.combatOpponent = enemies.find((e) => e.isAlive()) ?? null;
    this.record({
      kind: 'fightInit',
      combatants: this.combatants.map((c) => ({ character: c, health: c.currentHealth, energy: c.energy, speed: c.battleSpeed })),
    });
    this.applyExplorationBuffs();
    this.applyPendingEnemyDebuff();
    this.triggerPassives('fight_start');
    this.turnOrder.beginFightTurn(this.combatants);
    this.record({ kind: 'fightTurn', n: this.turnOrder.fightTurn, isFirst: true });
    this.statusSystem.tickFightTurnStart(this.combatants, (m) => this.logMessage(m), (tick) => this.recordTick(tick, 'fightTurnStart'));
    this.processDotEffects();
    this.cooldownSystem.tickFightTurn(this.combatants);
    this.triggerPassives('fight_turn_start', null, { announce: true });
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
   * Wounded Animal's queued next-fight debuff (see StateManager.startCombat,
   * which reads-and-clears run.pendingEnemyDebuff the instant this fight
   * begins). Applied to the FIRST enemy only, not every enemy in a
   * multi-enemy pack — keeps the reward proportionate to a single Mash
   * QTE (comparable to a Locked Door's own reward), and "the first enemy"
   * is already this codebase's established primary-target convention
   * (see player.combatOpponent's own default above).
   */
  applyPendingEnemyDebuff() {
    if (!this.pendingEnemyDebuff) return;
    const target = this.enemies[0];
    if (target) this.logDebuffResults(this.statusSystem.applyDebuffs(target, [this.pendingEnemyDebuff], this.player));
    this.pendingEnemyDebuff = null;
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
    this.stampEnemyDeaths();
    if (!this.player?.isAlive()) {
      this.phase = COMBAT_PHASE.DEFEAT;
      this.flushSequence();
      this.eventBus.emit('combat:defeat', this.getState());
      return true;
    }
    if (!this.aliveEnemies.length) {
      // On-death revive passive (Vanguard of Darkness's vanguard_revival):
      // the fight doesn't actually end if the just-died enemy has an
      // unused 'on_death' passive — it comes back at 50% health with its
      // own selfDebuffs applied instead.
      const revivable = this.enemies.find((e) => !e.isAlive() && !e.hasRevived
        && e.moves.some((m) => m.template.trigger === 'on_death'));
      if (revivable) {
        revivable.hasRevived = true;
        revivable.currentHealth = Math.round(revivable.getMaxHealth() * 0.5);
        const reviveMove = revivable.moves.find((m) => m.template.trigger === 'on_death');
        if (reviveMove.template.selfDebuffs) {
          this.logDebuffResults(this.statusSystem.applyDebuffs(revivable, reviveMove.template.selfDebuffs, revivable, [this.player]));
        }
        this.logMessage(t('log.enemy_revives', { name: revivable.name }));
        this.record({ kind: 'revive', character: revivable, health: revivable.currentHealth, energy: revivable.energy });
        return false;
      }
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
      this.triggerPassives('fight_turn_start', null, { announce: true });
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
    this.triggerPassives('character_turn_start', actor, { announce: true });
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

    // Motivation (Ignite): a separate, explicit mechanic from the normal
    // energy roll above — consumes exactly 1 stack and grants exactly 1
    // flat energy, every one of the owner's own character-turns for as
    // long as any stacks remain, so the remaining stack count visibly
    // ticks down on their status icon instead of hiding behind an
    // internal timer. See data/statusEffectConfig.js's motivation entry.
    if (actor.getStatusStacks('motivation') > 0) {
      const motivation = actor.statusEffects.find((e) => e.id === 'motivation');
      motivation.stacks -= 1;
      if (motivation.stacks <= 0) actor.removeStatusEffect('motivation');
      actor.energy = Math.min(actor.getMaxEnergy(), actor.energy + 1);
      this.logMessage(t('log.motivation_energy', { name: actor.name }));
      this.record({ kind: 'energyGain', character: actor, health: actor.currentHealth, energy: actor.energy });
    }

    if (actor.isPlayer) {
      // Auto-retarget: whoever the player had selected may have died since
      // their last turn (their own attack, a DoT tick, etc) — never leave
      // them pointed at a corpse going into their next move.
      if (this.player.combatOpponent && !this.player.combatOpponent.isAlive()) {
        this.player.combatOpponent = this.aliveEnemies[0] ?? null;
      }
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
    // Darkness's energy-steal side: keyed off the status itself (whichever
    // enemy is acting), not a specific enemy id — see Character.getStat
    // for the matching accuracy-penalty side. Guaranteed-plus-remainder
    // budget (see Constants.js) rather than a single rollChance: past
    // 100% budget (25+ stacks) this steals more than 1 energy per turn.
    const darknessStacks = this.player.getStatusStacks('darkness');
    if (darknessStacks > 0 && this.player.energy > 0) {
      const budget = darknessStacks * DARKNESS_ENERGY_STEAL_CHANCE_PER_STACK / 100;
      let steals = Math.floor(budget);
      const remainderChance = (budget - steals) * 100;
      if (remainderChance > 0 && rollChance(remainderChance)) steals += 1;
      if (steals > 0) {
        const stolen = this.energySystem.stealEnergy(this.player, enemy, steals);
        if (stolen > 0) this.logMessage(t('log.darkness_steals_energy', { name: enemy.name }));
      }
    }

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

  /** Click-to-target: FightState calls this when the player picks an enemy portrait, before using a move. */
  setPlayerTarget(instanceId) {
    const target = this.aliveEnemies.find((e) => e.instanceId === instanceId);
    if (!target) return { ok: false, reason: 'No valid target.' };
    this.player.combatOpponent = target;
    return { ok: true };
  }

  playerUseMove(moveId, targetId = null) {
    if (this.phase !== COMBAT_PHASE.PLAYER_TURN) return { ok: false, reason: 'Not your turn.' };
    const move = this.player.moves.find((m) => m.id === moveId);
    if (!move) return { ok: false, reason: 'Unknown move.' };
    if (!move.isAvailable(this.player.energy)) return { ok: false, reason: 'Move unavailable.' };

    // `targetId`, when given, overrides the player's standing selection
    // (combatOpponent, kept current by setPlayerTarget + advanceTurn's
    // auto-retarget) — instanceId-keyed since `id` is just the shared
    // species config id and duplicate-species enemies would collide on it.
    const target = (targetId ? this.enemies.find((e) => e.instanceId === targetId) : this.player.combatOpponent)
      ?? this.aliveEnemies[0];
    if (!target) return { ok: false, reason: 'No valid target.' };

    this.executeMove(this.player, target, move);
    this.endActorTurn(this.player);
    return { ok: true };
  }

  executeMove(attacker, defender, move) {
    // See Character.hasActedInCombat — read by EnemyAI.chooseMove to
    // guarantee an opening-priority move (Extreme Ignition) only ever fires
    // on this character's actual first move of the fight.
    attacker.hasActedInCombat = true;
    // Collects every status/stat/heal/damage change this move causes —
    // attached to the recorded 'move' step below so FightState can flash a
    // floating call-out for each one at the move's animation peak (the
    // moment the attacker and defender are visually close together), same
    // beat as the damage number, instead of only ever showing in the text
    // log. `events` covers applied AND removed status/stat changes (kind:
    // 'status' | 'removed' | 'stat'); `extraDamage` covers damage dealt
    // outside the normal DamageCalculator result (Erratic Combustion,
    // Chaotic Combustion, Umbral Purge's bonus damage) — none of which had
    // ANY floating number before, only ever the text log.
    const moveEffects = { events: [], heal: null, extraDamage: [] };
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

    // Umbral Ward's escalating punishment (debuffOnRepeatCast below) needs
    // to know whether THIS cast is a repeat of the attacker's own last
    // move — tracked on every successful cast, before anything else runs.
    attacker.consecutiveMoveCount = attacker.lastMoveId === move.id ? attacker.consecutiveMoveCount + 1 : 1;
    attacker.lastMoveId = move.id;

    if (!rollChance(attacker.getStat('noCooldownChance'))) {
      move.startCooldown();
    }
    this.logMessage(t('log.uses_move', { name: attacker.name, move: move.name }));

    if (move.template.healMaxPercent) {
      const healed = attacker.healMissingPercent(move.template.healMaxPercent);
      this.logMessage(t('log.heals', { name: attacker.name, n: healed }));
      if (healed > 0) moveEffects.heal = { recipient: attacker, amount: healed };
    }

    // debuffOnRepeatCast: applies only from the 2nd consecutive cast of
    // THIS exact move onward — Umbral Ward's "isn't wasting his turn"
    // escalation, so blocking over and over during a speed streak has a
    // real cost instead of being free.
    if (move.template.debuffOnRepeatCast && attacker.consecutiveMoveCount >= 2) {
      this.logDebuffResults(this.statusSystem.applyDebuffs(defender, [move.template.debuffOnRepeatCast], attacker));
    }

    // Cure: reduces each of the caster's own negative status stacks by a
    // percentage, rounded down independently per effect (so 3 stacks at
    // 30% rounds to 0 removed, matching the move's own description).
    // Effects flagged cannotCleanse (Frostbite, Darkness) are skipped
    // entirely rather than partially reduced — see statusEffectConfig.js.
    if (move.template.cleanseNegativePercent) {
      const percent = move.template.cleanseNegativePercent / 100;
      attacker.statusEffects.forEach((effect) => {
        const config = STATUS_EFFECTS[effect.id];
        if (config?.type !== 'debuff' || config?.cannotCleanse) return;
        const amount = Math.floor(effect.stacks * percent);
        if (amount > 0) {
          effect.stacks -= amount;
          this.logMessage(t('log.status_cured', {
            name: attacker.name,
            n: amount,
            status: tData('status', effect.id, config.name),
          }));
          moveEffects.events.push({ recipient: attacker, kind: 'removed', effectId: effect.id, stacks: amount });
        }
      });
      attacker.statusEffects = attacker.statusEffects.filter((e) => e.stacks > 0);
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
        moveEffects.events.push({ recipient: defender, kind: 'removed', effectId: effect, stacks });
        // Tagged with the consumed effect as its damage source (e.g.
        // 'fire' for Erratic Combustion) so it correctly scales with
        // getStatusDamageMultiplier — same as any other status tick — so
        // a target's fire vulnerability (Formless) or fire resistance
        // applies to it too, not just literal burn ticks.
        const dealt = defender.takeDamage(stacks * damagePerStack, { source: effect });
        moveEffects.extraDamage.push({ recipient: defender, amount: dealt });
        this.logMessage(t('log.consumed_status_damage', {
          name: defender.name,
          n: dealt,
          status: tData('status', effect, STATUS_EFFECTS[effect]?.name ?? effect),
        }));
        // diedFromStatusId alone can't tell "died to Erratic Combustion"
        // apart from any other fire-tagged death (a burn tick, Chaotic
        // Combustion) — achievement checks that need the specific move
        // read this instead.
        if (defender.currentHealth <= 0) defender.diedFromMoveId = move.template.id;
      }
    }

    // Chaotic Combustion: consumes the given status from the attacker AND
    // every alive enemy, summed into one combined total — that total
    // (times damagePerStack) hits every enemy IN FULL (not split between
    // them), while the attacker only takes a fraction of that same total.
    // Doesn't depend on `defender` at all — it always hits the whole party
    // regardless of which enemy is currently targeted.
    if (move.template.consumeStatusForDamageAllEnemies) {
      const { effect, damagePerStack, selfDamageDivisor = 4 } = move.template.consumeStatusForDamageAllEnemies;
      let totalStacks = 0;
      const attackerStacks = attacker.getStatusStacks(effect);
      if (attackerStacks > 0) {
        attacker.removeStatusEffect(effect);
        moveEffects.events.push({ recipient: attacker, kind: 'removed', effectId: effect, stacks: attackerStacks });
        totalStacks += attackerStacks;
      }
      this.aliveEnemies.forEach((enemy) => {
        const stacks = enemy.getStatusStacks(effect);
        if (stacks > 0) {
          enemy.removeStatusEffect(effect);
          moveEffects.events.push({ recipient: enemy, kind: 'removed', effectId: effect, stacks });
          totalStacks += stacks;
        }
      });
      if (totalStacks > 0) {
        const totalDamage = totalStacks * damagePerStack;
        this.aliveEnemies.forEach((enemy) => {
          const dealt = enemy.takeDamage(totalDamage, { source: effect });
          moveEffects.extraDamage.push({ recipient: enemy, amount: dealt });
        });
        const selfDealt = attacker.takeDamage(Math.floor(totalDamage / selfDamageDivisor), { source: effect });
        moveEffects.extraDamage.push({ recipient: attacker, amount: selfDealt });
        this.logMessage(t('log.chaotic_combustion', { name: attacker.name, n: totalDamage }));
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

    // Umbral Purge: strips every status effect off both sides (except the
    // caster's own listed exclusions — its self-inflicted Frostbite),
    // dealing bonus flat damage per status actually removed. Unconditional
    // (no attack roll involved) — matches the move's own damage:0/
    // scaling:none guaranteed-application design. Runs BEFORE `debuffs`
    // below on purpose — Umbral Purge's own `debuffs` (5 stacks of
    // Darkness) is meant to land AFTER the purge, not get immediately
    // stripped back off by the very effect that's supposed to follow it.
    if (move.template.clearAllStatusesForDamage) {
      const { damagePerStatus, excludeSelf = [] } = move.template.clearAllStatusesForDamage;
      let removedCount = 0;
      [attacker, defender].forEach((character) => {
        // cannotCleanse effects (Frostbite, Darkness) survive even a
        // full status wipe — see statusEffectConfig.js. On the defender
        // specifically, only their own BUFFS get stripped — their
        // negative status effects stay put, unlike the attacker's own
        // side, which still loses everything (bar excludeSelf/cannotCleanse).
        const toRemove = character.statusEffects.filter((e) => !(character === attacker && excludeSelf.includes(e.id))
          && !STATUS_EFFECTS[e.id]?.cannotCleanse
          && (character === attacker || STATUS_EFFECTS[e.id]?.type === 'buff'));
        toRemove.forEach((effect) => {
          character.removeStatusEffect(effect.id);
          moveEffects.events.push({ recipient: character, kind: 'removed', effectId: effect.id, stacks: effect.stacks });
          removedCount += 1;
        });
      });
      if (removedCount > 0) {
        const bonus = removedCount * damagePerStatus;
        const dealt = defender.takeDamage(bonus);
        moveEffects.extraDamage.push({ recipient: defender, amount: dealt });
        this.logMessage(t('log.status_purge_damage', { name: defender.name, n: bonus, count: removedCount }));
      }
    }
    if (move.template.debuffs && (!result || result.hit)) {
      // aoeDebuffs (Ember Wisp): the status effects land on every alive
      // enemy at once — only the move's own direct-damage roll (above)
      // stays aimed at whichever single enemy was actually targeted.
      if (move.template.aoeDebuffs) {
        this.aliveEnemies.forEach((e) => {
          const applied = this.statusSystem.applyDebuffs(e, move.template.debuffs, attacker);
          this.logDebuffResults(applied);
          applied.forEach((d) => moveEffects.events.push({ recipient: d.recipient, kind: 'status', effectId: d.effectId, stacks: d.stacks }));
        });
      } else {
        const applied = this.statusSystem.applyDebuffs(defender, move.template.debuffs, attacker);
        this.logDebuffResults(applied);
        applied.forEach((d) => moveEffects.events.push({ recipient: d.recipient, kind: 'status', effectId: d.effectId, stacks: d.stacks }));
      }
    }
    // Percent-of-current-stat debuff on the opponent (Vanguard's Crippling
    // Shadow: -50% speed for 5 turns) — computed here (not baked into the
    // static move template) since it depends on the defender's CURRENT
    // stat value at the moment it lands. Reuses the same
    // statBuffs/temporaryStatModifiers/decayBuffDurations pipeline
    // applySelfBuffs already uses, just aimed at the defender instead.
    if (move.template.percentStatDebuff && (!result || result.hit)) {
      const { stat, percent, durationFightTurns } = move.template.percentStatDebuff;
      const amount = Math.round(defender.getStat(stat) * (percent / 100));
      const applied = this.statusSystem.applyBuffs(defender, [{ type: 'stat', stat, amount, durationFightTurns }], attacker);
      applied.forEach((buff) => {
        this.logMessage(t('log.stat_debuff_applied', { name: defender.name, n: Math.abs(buff.amount), stat: statLabel(buff.stat) }));
        moveEffects.events.push({ recipient: defender, kind: 'stat', stat: buff.stat, amount: buff.amount });
      });
    }
    // Unlike `debuffs` above (routed to the defender, gated on a hit),
    // `selfDebuffs` on an active move always lands on its own caster —
    // e.g. Ember Wisp singing the attacker's own fingers regardless of
    // whether the bolt itself connects. Mirrors triggerPassives' handling
    // of the same field for passive moves (Ash Eater, Ember Curse).
    if (move.template.selfDebuffs) {
      const applied = this.statusSystem.applyDebuffs(attacker, move.template.selfDebuffs, attacker, [defender]);
      this.logDebuffResults(applied);
      applied.forEach((d) => moveEffects.events.push({ recipient: d.recipient, kind: 'status', effectId: d.effectId, stacks: d.stacks }));
    }
    if (move.template.buffs) {
      const applied = this.applySelfBuffs(attacker, move.template.buffs);
      applied.forEach((buff) => {
        if (buff.type === 'stat') moveEffects.events.push({ recipient: attacker, kind: 'stat', stat: buff.stat, amount: buff.amount });
        else if (buff.type === 'effect') moveEffects.events.push({ recipient: attacker, kind: 'status', effectId: buff.effectId, stacks: buff.stacks });
      });
    }

    // The exact percent/flat amount varies per move (and isn't known
    // until it actually blocks something — see result.reducedAmount in
    // the damage-dealt branch above), so this just announces that a
    // shield is now up, not how strong it is.
    if (move.template.guardPercent) {
      attacker.guardState = { percent: move.template.guardPercent, sourceMoveName: move.name };
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
    // Stun-trap (Vine Trap, Dread Grasp) — see DamageCalculator.resolveAttack
    // for the trigger and StatusEffectSystem.decayBuffDurations for the
    // timed-expiry side. Not logged as a buff/debuff (it isn't one — no
    // status icon, per design) — just a quiet armed-state change.
    if (move.template.attackerStunTrap) {
      attacker.stunTrapActive = true;
      attacker.stunTrapTurnsRemaining = move.template.attackerStunTrap.durationFightTurns ?? -1;
      // Vine Trap's original 1-stack stun stays the default; Dread Grasp
      // sets its own higher value — see DamageCalculator.resolveAttack.
      attacker.stunTrapStunStacks = move.template.attackerStunTrap.stunStacks ?? 1;
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

    // Reactive passives (Mind Erosion, Retaliatory Soul): fired on the
    // defender, scoped to just them, whenever a melee attack actually lands
    // on them. Mirrors the debuffs guard above — no result at all (0-damage
    // touch moves) counts as an automatic hit, same as a rolled one. Merged
    // into THIS move's own moveEffects (rather than getting a standalone
    // beat) so e.g. Retaliatory Soul's bleed flashes at the exact same peak
    // moment as the attacker's hit landing — the whole point of it being a
    // reaction to that specific contact.
    if ((!result || (result.hit && !result.split)) && move.properties.includes(MOVE_PROPERTIES.MELEE)) {
      moveEffects.events.push(...this.triggerPassives('melee_hit_taken', defender));
    }

    // Reactive passive (Icy Ward): fired on the defender whenever the
    // PLAYER specifically uses the basic 'guard' move against them —
    // scoped by move id, not by any property, since Guard is the one
    // always-available, no-real-cost defensive option this is meant to
    // punish. Also merged into this move's own beat, same reasoning.
    if (attacker.isPlayer && move.template.id === 'guard') {
      moveEffects.events.push(...this.triggerPassives('player_guarded', defender));
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
      effects: moveEffects,
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
      const target = this.player.combatOpponent ?? this.aliveEnemies[0];
      if (target) this.logDebuffResults(this.statusSystem.applyDebuffs(target, [effect.debuff], this.player));
    }

    this.record({ kind: 'consumable', character: this.player, health: this.player.currentHealth, energy: this.player.energy });
    this.endActorTurn(this.player);
    return { ok: true };
  }

  // See PassiveTriggerSystem's own doc comment for the returned event
  // shape and `announce` semantics — kept as a thin delegate here (rather
  // than switching every call site to `this.passiveSystem.trigger(...)`),
  // assembling the context object PassiveTriggerSystem needs from `this`.
  triggerPassives(trigger, actor = null, { announce = false } = {}) {
    return this.passiveSystem.trigger(trigger, actor, {
      combatants: this.combatants,
      aliveEnemies: this.aliveEnemies,
      player: this.player,
      enemies: this.enemies,
      turnOrder: this.turnOrder,
      statusSystem: this.statusSystem,
      applySelfBuffs: (character, buffs) => this.applySelfBuffs(character, buffs),
      logDebuffResults: (applied) => this.logDebuffResults(applied),
      record: (step) => this.record(step),
      announce,
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
    const opponent = character.isPlayer ? (character.combatOpponent ?? this.aliveEnemies[0]) : this.player;
    if (!opponent) return applied;
    const stealChance = opponent.moves.reduce((max, m) => Math.max(max, m.template.stealBuffChance ?? 0), 0);
    if (stealChance > 0 && rollChance(stealChance)) {
      const stolen = this.statusSystem.applyBuffs(opponent, buffs, opponent);
      this.logBuffResults(opponent, stolen);
    }
    return applied;
  }

  finishVictory() {
    this.phase = COMBAT_PHASE.VICTORY;
    this.triggerPassives('combat_victory', this.player);
    const totalHealth = this.enemies.reduce((sum, e) => sum + e.baseStats.con, 0);
    const gold = Math.floor(totalHealth * GOLD_REWARD_RATIO) + (this.player.pendingGoldBonus ?? 0);
    this.player.pendingGoldBonus = 0;
    const drops = { materials: {}, items: [], consumables: {} };

    // Thief's Guilt (Thief's Skin): the enemy with the HIGHEST deathOrder
    // stamp (see stampEnemyDeaths) is the one that died last in the party
    // — its material table gets rolled 3 independent times instead of 1,
    // for variety (not just 3x the quantity of a single roll).
    const tripleLastKillDrops = this.player.moves.some((m) => m.template.tripleLastKillDrops);
    const lastKilledEnemy = tripleLastKillDrops
      ? this.enemies.reduce((latest, e) => ((e.deathOrder ?? -1) > (latest?.deathOrder ?? -1) ? e : latest), null)
      : null;

    this.enemies.forEach((enemy) => {
      const config = enemy.drops;
      const materialRolls = enemy === lastKilledEnemy ? 3 : 1;
      for (let i = 0; i < materialRolls; i += 1) {
        config.materials?.forEach((drop) => {
          const qty = rollDrop(drop);
          if (qty > 0) drops.materials[drop.id] = (drops.materials[drop.id] ?? 0) + qty;
        });
      }
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
      // Guaranteed-exactly-one-of-N drop (Vanguard of Darkness's 3-item
      // pool) — distinct from the independent per-item rolls above.
      if (config.itemPool?.length) {
        drops.items.push(pickRandom(config.itemPool));
      }
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
