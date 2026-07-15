import { COOLDOWN_TYPES, MOVE_PROPERTIES } from '../utils/Constants.js';
import { GOLD_REWARD_RATIO } from '../utils/Constants.js';
import { DamageCalculator } from './DamageCalculator.js';
import { EnergySystem, CooldownSystem } from './EnergySystem.js';
import { TurnOrderSystem } from './TurnOrderSystem.js';
import { StatusEffectSystem } from './StatusEffectSystem.js';
import { EnemyAI } from './EnemyAI.js';
import { rollDrop } from '../utils/RandomUtils.js';
import { getItemConfig } from '../data/items.js';
import { getConsumableConfig } from '../data/consumables.js';
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
    this.turnOrder.reset();
    this.enemyAI.reset();
  }

  startCombat({ player, enemies, explorationBuffs = [] }) {
    this.reset();
    this.player = player;
    this.enemies = enemies;
    this.pendingExplorationBuffs = explorationBuffs;

    [player, ...enemies].forEach((c) => c.resetBattleState());
    this.applyExplorationBuffs();
    this.triggerPassives('fight_start');
    this.turnOrder.beginFightTurn(this.combatants);
    this.statusSystem.tickFightTurnStart(this.combatants, (m) => this.logMessage(m));
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

  logMessage(message) {
    this.log.unshift(message);
    if (this.log.length > 30) this.log.pop();
    this.eventBus.emit('combat:log', message);
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
          if (dot.move.debuffs) this.statusSystem.applyDebuffs(dot.target, dot.move.debuffs, attacker);
          this.eventBus.emit('combat:move_resolved', { attacker, defender: dot.target, move: dot.move, result });
        }

        dot.remaining -= 1;
        return dot.remaining > 0;
      });
    });
  }

  advanceTurn() {
    if (this.checkFightEnd()) return;

    if (this.turnOrder.allHaveMoved(this.combatants)) {
      this.statusSystem.tickFightTurnEnd(this.combatants, (m) => this.logMessage(m));
      if (this.checkFightEnd()) return;
      this.combatants.forEach((c) => this.statusSystem.decayBuffDurations(c));
      this.turnOrder.endFightTurn(this.combatants);
      this.turnOrder.beginFightTurn(this.combatants);
      this.statusSystem.tickFightTurnStart(this.combatants, (m) => this.logMessage(m));
      if (this.checkFightEnd()) return;
      this.processDotEffects();
      if (this.checkFightEnd()) return;
      this.cooldownSystem.tickFightTurn(this.combatants);
      this.triggerPassives('fight_turn_start');
    }

    const actor = this.turnOrder.getNextActor(this.combatants);
    if (!actor) return;

    this.currentActor = actor;
    const skip = this.turnOrder.onCharacterTurnStart(actor);
    if (skip.skipped) {
      this.logMessage(t('log.stunned_skip', { name: actor.name }));
      this.endActorTurn(actor);
      return;
    }

    this.statusSystem.tickCharacterTurnStart(actor, (m) => this.logMessage(m));
    if (this.checkFightEnd()) return;
    this.triggerPassives('character_turn_start', actor);
    const gained = this.energySystem.gainEnergy(actor);
    if (gained > 0) this.logMessage(t('log.gains_energy', { name: actor.name, n: gained }));

    if (actor.isPlayer) {
      this.phase = COMBAT_PHASE.PLAYER_TURN;
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
    if (!this.energySystem.spendEnergy(attacker, move.energyCost)) {
      this.logMessage(t('log.lacks_energy', { name: attacker.name, move: move.name }));
      return;
    }

    const reduction = attacker.getCooldownReduction();
    move.startCooldown(reduction);
    this.logMessage(t('log.uses_move', { name: attacker.name, move: move.name }));

    if (move.template.healMaxPercent) {
      const healed = attacker.healMissingPercent(move.template.healMaxPercent);
      this.logMessage(t('log.heals', { name: attacker.name, n: healed }));
    }

    let result = null;
    if (move.template.damage > 0 || move.scaling !== 'none') {
      result = DamageCalculator.resolveAttack({ attacker, defender, move });
      if (!result.hit) {
        this.logMessage(t('log.missed', { name: attacker.name, move: move.name }));
      } else if (result.split) {
        this.logMessage(t('log.splits_damage', { move: move.name }));
      } else {
        const critText = result.isCrit ? t('log.crit_suffix') : '';
        this.logMessage(t('log.deals_damage', { move: move.name, n: result.damage, crit: critText }));
        if (result.healed > 0) this.logMessage(t('log.lifesteals', { name: attacker.name, n: result.healed }));
      }
    }

    if (move.template.debuffs && (!result || result.hit)) {
      this.statusSystem.applyDebuffs(defender, move.template.debuffs, attacker);
    }
    if (move.template.buffs) {
      this.statusSystem.applyBuffs(attacker, move.template.buffs, attacker);
    }

    if (move.template.guardPercent) {
      attacker.guardState = { percent: move.template.guardPercent };
    }
    if (move.template.damageReductionNext) {
      attacker.pendingDamageReduction = { flat: move.template.damageReductionNext };
    }
    if (move.template.damageReductionPercent) {
      attacker.pendingDamageReduction = {
        percent: move.template.damageReductionPercent,
        hits: move.template.damageReductionHits ?? 1,
        includesStatus: move.template.includesStatusDamage ?? false,
      };
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
      this.statusSystem.applyBuffs(this.player, [effect.buff], this.player);
    }

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
          this.statusSystem.applyBuffs(character, move.template.buffs, character);
        }
        if (move.template.debuffs) {
          const target = character.isPlayer ? this.aliveEnemies[0] : this.player;
          if (target) this.statusSystem.applyDebuffs(target, move.template.debuffs, character);
        }
        if (move.template.grantConsumables) {
          character.combatConsumables = { ...move.template.grantConsumables };
        }
        if (move.template.physicalDamageReductionPercent) {
          character.physicalDamageReductionPercent =
            (character.physicalDamageReductionPercent ?? 0) + move.template.physicalDamageReductionPercent;
        }
        if (move.template.statusDamageMultipliers) {
          character.statusDamageMultipliers = {
            ...(character.statusDamageMultipliers ?? {}),
            ...move.template.statusDamageMultipliers,
          };
        }
      });
    });
  }

  finishVictory() {
    this.phase = COMBAT_PHASE.VICTORY;
    const totalHealth = this.enemies.reduce((sum, e) => sum + e.baseStats.con, 0);
    const gold = Math.floor(totalHealth * GOLD_REWARD_RATIO);
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
    this.eventBus.emit('combat:victory', this.getState());
  }

  abandon() {
    this.phase = COMBAT_PHASE.DEFEAT;
    this.eventBus.emit('combat:abandoned', this.getState());
  }
}
