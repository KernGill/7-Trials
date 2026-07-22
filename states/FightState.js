import { MOVE_CATEGORIES, MOVE_PROPERTIES } from '../utils/Constants.js';
import { COMBAT_PHASE } from '../combat/CombatManager.js';
import { PauseOverlay } from './PauseOverlay.js';
import { getConsumableConfig } from '../data/consumables.js';
import { STATUS_EFFECTS } from '../data/statusEffectConfig.js';
import { getCharacterSprite, getEnemySprite, CHARACTER_BORDER } from '../data/sprites.js';
import { t, tData, tReason } from '../ui/i18n.js';

const STAT_KEY_TO_TKEY = { con: 'tooltip.con', dex: 'tooltip.dex', str: 'tooltip.str', spd: 'tooltip.spd', def: 'tooltip.def', int: 'tooltip.int' };
function statLabel(key) { return t(STAT_KEY_TO_TKEY[key] ?? key); }

function isAttack(m) { return m.properties.includes(MOVE_PROPERTIES.PHYSICAL) || m.properties.includes(MOVE_PROPERTIES.MAGIC); }
function isSustain(m) { return m.properties.includes(MOVE_PROPERTIES.DEFENCE) || m.properties.includes(MOVE_PROPERTIES.HEALING); }
function isConsumable(m) { return m.properties.includes(MOVE_PROPERTIES.CONSUMABLE); }
function isSpecial(m) { return !isAttack(m) && !isSustain(m) && !isConsumable(m); }

/** Every move animates as exactly one of these 3, priority Attack > Defence > Special. */
function moveAnimationCategory(move) {
  if (move.properties?.includes(MOVE_PROPERTIES.PHYSICAL) || move.properties?.includes(MOVE_PROPERTIES.MAGIC)) return 'attack';
  if (move.properties?.includes(MOVE_PROPERTIES.DEFENCE)) return 'defence';
  return 'special';
}

// How much of the actual on-screen gap between the two avatar boxes the
// attack animation crosses — short of 100% so the boxes don't fully
// overlap at the peak of the swing.
const ATTACK_TRAVEL_RATIO = 0.85;

// --- Playback pacing --------------------------------------------------
// Every beat in the combat timeline has its own fixed duration; damage
// and other landing effects apply at a *peak* offset within a move's own
// beat — the moment the attacker's swing is closest to the defender for
// attacks, or the moment a defensive stance is at its biggest — rather
// than at the very start of the animation, so it actually looks like the
// hit (or the brace) is what's causing the effect.
const FIGHT_TURN_FLASH_MS = 1000;
const INTER_TURN_GAP_MS = 1000; // pause after a turn ends, before the next one's first beat
const SPEED_CHECK_MS = 1000; // holding both speeds on screen, winner highlighted, before their turn begins
const TURN_END_SPEED_HOLD_MS = 600; // holding the post-loss speed once a turn ends, before the inter-turn gap
const STATUS_TICK_MS = 500;
const TURN_SKIP_MS = 600;
const CONSUMABLE_BEAT_MS = 500;
const ATTACK_DURATION_MS = 1500;
const ATTACK_PEAK_MS = 750; // 50% — matches the anim-attack keyframe's midpoint
const DEFENCE_DURATION_MS = 500;
const DEFENCE_PEAK_MS = 350; // 70% — matches the anim-defence keyframe's biggest-scale point
const SPECIAL_DURATION_MS = 500; // effects apply immediately (peak 0) — special is left as-is

const DAMAGE_NUMBER_LIFETIME_MS = 1200;
const CRIT_COLOR = '#f1c40f';
const REGULAR_DAMAGE_COLOR = '#fff';
const MISS_COLOR = '#999';

const FILTERS = {
  [MOVE_CATEGORIES.ATTACKS]: isAttack,
  [MOVE_CATEGORIES.SUSTAIN]: isSustain,
  [MOVE_CATEGORIES.SPECIALS]: isSpecial,
  [MOVE_CATEGORIES.CONSUMABLES]: isConsumable,
};
const CATEGORY_LABEL_KEYS = {
  [MOVE_CATEGORIES.ATTACKS]: 'fight.category_attacks',
  [MOVE_CATEGORIES.SUSTAIN]: 'fight.category_sustain',
  [MOVE_CATEGORIES.SPECIALS]: 'fight.category_specials',
  [MOVE_CATEGORIES.CONSUMABLES]: 'fight.category_consumables',
};

/**
 * FightState — 1v1 turn-based combat, top-level peer of ExploreState.
 * Layout: battle log (left) + arena (center) + move-category panel
 * (right).
 *
 * CombatManager still resolves an entire cascade (a player move, any
 * immediate enemy counter-move, status ticks, turn changes) fully
 * synchronously and instantly, exactly as before — nothing about the
 * underlying rules or their timing changed. What changed is that it now
 * also records that cascade as an ordered list of steps ("combat:sequence")
 * instead of just mutating state and firing one-shot events. This file
 * *replays* that list at a human pace: a fight-turn flash, a beat per
 * status tick, a beat per move (with damage/effects landing at the
 * animation's visual peak instead of instantly), and a 1s gap between
 * one character's turn ending and the next one's first beat.
 *
 * Because the underlying mutations already happened by the time replay
 * starts, the two avatar boxes can't just re-render from `character
 * .currentHealth` — that's already the *final* post-cascade value. Each
 * step instead carries a snapshot of the exact health/energy/speed it
 * should show once its beat arrives; `displayed`/`displayedSpeed` track
 * the currently-revealed values per character, fed by those snapshots
 * as playback proceeds.
 *
 * Turn order itself gets the same treatment: CombatManager decides who
 * goes next instantly, but a `speedCheck` beat shows every combatant's
 * current speed (highlighting the winner) *before* that character's
 * turn plays, and `turnEnd` holds on their post-loss speed for a beat
 * afterward — so the speed comparison that actually drives turn order
 * is something you watch happen, not just a result you're told.
 */
export class FightState {
  constructor(app) {
    this.app = app;
    this.openCategory = null;
    this.pause = new PauseOverlay(app);
    this.playbackQueue = [];
    this.playing = false;
    this.lastStepKind = null;
    this.displayed = new Map();
    this.displayedSpeed = new Map();
    this.pendingEndCallback = null;
    this.timers = [];
  }

  enter(root) {
    this.root = root;
    this.openCategory = null;
    this.playbackQueue = [];
    this.playing = false;
    this.lastStepKind = null;
    this.displayed = new Map();
    this.displayedSpeed = new Map();
    this.pendingEndCallback = null;
    this.timers.forEach((id) => clearTimeout(id));
    this.timers = [];
    root.innerHTML = `
      <div class="fight-screen">
        <div class="fight-turn"></div>
        <div class="turn-flash hidden"></div>
        <div class="battle-log"></div>
        <div class="arena">
          <div class="combatant enemy-slot"></div>
          <div class="arena-spacer"></div>
          <div class="combatant player-slot"></div>
        </div>
        <div class="fight-sidebar">
          <div class="move-order"></div>
          <div class="category-panel"></div>
        </div>
      </div>`;
    this.els = {
      turn: root.querySelector('.fight-turn'),
      flash: root.querySelector('.turn-flash'),
      log: root.querySelector('.battle-log'),
      enemy: root.querySelector('.enemy-slot'),
      player: root.querySelector('.player-slot'),
      order: root.querySelector('.move-order'),
      panel: root.querySelector('.category-panel'),
    };
    this.renderAll();
  }

  exit() {
    this.pause.unmount();
    this.timers.forEach((id) => clearTimeout(id));
    this.timers = [];
  }

  onPauseToggled() {
    if (this.app.gameState.paused) this.pause.mount(this.root, { canAbandon: false });
    else this.pause.unmount();
    this.renderAll();
  }

  /** Battle log stays live/instant — only the arena (avatars, damage numbers, turn flow) is paced. */
  onLog() {
    this.renderLog();
  }

  /** A whole cascade's worth of steps arrives as one batch; queue it and keep playing. */
  onSequence(steps) {
    if (!steps?.length) return;
    this.playbackQueue.push(...steps);
    this.drainQueue();
  }

  drainQueue() {
    if (this.playing || !this.playbackQueue.length) return;
    this.playing = true;
    this.playStep(this.playbackQueue.shift());
  }

  /**
   * Every timing constant in this file is written at its 1x baseline
   * and passed through here before being handed to setTimeout — divides
   * by the user's gameSpeed setting (1-5x, default 2x), so turning the
   * slider up makes every beat proportionally shorter without having to
   * touch the constants themselves or their relative timing.
   */
  scaled(ms) {
    const speed = this.app.gameState.settings.gameSpeed ?? 2;
    return ms / speed;
  }

  /** The only source of the 1s inter-turn pause: whatever follows a `turnEnd` beat waits an extra second before starting its own beat. */
  playStep(step) {
    const preDelay = this.lastStepKind === 'turnEnd' ? this.scaled(INTER_TURN_GAP_MS) : 0;
    this.timers.push(setTimeout(() => this.runStep(step), preDelay));
  }

  runStep(step) {
    this.lastStepKind = step.kind;
    switch (step.kind) {
      case 'fightInit': return this.playFightInitStep(step);
      case 'fightTurn': return this.playFightTurnStep(step);
      case 'speedCheck': return this.playSpeedCheckStep(step);
      case 'statusTick': return this.playStatusTickStep(step);
      case 'turnStart': return this.playTurnStartStep(step);
      case 'energyGain': return this.playEnergyGainStep(step);
      case 'turnSkip': return this.playTurnSkipStep(step);
      case 'move': return this.playMoveStep(step);
      case 'consumable': return this.playConsumableStep(step);
      case 'turnEnd': return this.playTurnEndStep(step);
      default: return this.finishStep();
    }
  }

  finishStep() {
    this.playing = false;
    if (this.playbackQueue.length) this.drainQueue();
    else this.onPlaybackDrained();
  }

  onPlaybackDrained() {
    if (this.pendingEndCallback) {
      const cb = this.pendingEndCallback;
      this.pendingEndCallback = null;
      cb();
      return;
    }
    this.renderAll(); // everything's settled — safe to re-show the move panel etc.
  }

  /**
   * Called by StateManager instead of jumping straight to the
   * victory/defeat screen, so the killing blow's own beat gets to
   * finish playing before the arena is torn down.
   */
  deferUntilAnimationsDone(fn) {
    if (!this.playing && !this.playbackQueue.length) fn();
    else this.pendingEndCallback = fn;
  }

  // --- Individual step players -------------------------------------------

  playFightInitStep(step) {
    step.combatants.forEach(({ character, health, energy, speed }) => {
      this.setDisplayed(character, health, energy);
      this.setDisplayedSpeed(character, speed);
    });
    this.renderAll();
    this.finishStep();
  }

  playFightTurnStep(step) {
    const text = step.isFirst ? t('fight.start_flash') : t('fight.turn_flash', { n: step.n });
    this.els.turn.textContent = t('fight.turn', { n: step.n });
    this.els.flash.textContent = text;
    this.els.flash.classList.remove('hidden');
    this.timers.push(setTimeout(() => {
      this.els.flash.classList.add('hidden');
      this.finishStep();
    }, this.scaled(FIGHT_TURN_FLASH_MS)));
  }

  /**
   * Every combatant's current speed, side by side, with whoever's about
   * to act highlighted — held on screen for a beat *before* that
   * character's own turn starts, so the comparison that decided it is
   * something the player actually watches rather than a result they're
   * just told.
   */
  playSpeedCheckStep(step) {
    step.combatants.forEach(({ character, speed }) => this.setDisplayedSpeed(character, speed));
    this.renderMoveOrder(step.actor);
    this.timers.push(setTimeout(() => this.finishStep(), this.scaled(SPEED_CHECK_MS)));
  }

  playStatusTickStep(step) {
    const cfg = STATUS_EFFECTS[step.effectId];
    this.setDisplayed(step.character, step.health, step.energy);
    this.renderCombatant(step.character);
    this.spawnDamageNumber(step.character, `-${step.amount}`, cfg?.color ?? REGULAR_DAMAGE_COLOR);
    this.timers.push(setTimeout(() => this.finishStep(), this.scaled(STATUS_TICK_MS)));
  }

  playTurnStartStep(step) {
    this.setDisplayed(step.character, step.health, step.energy);
    this.renderCombatant(step.character);
    this.renderMoveOrder(step.character);
    this.finishStep();
  }

  /** Turn-start energy gain has no beat of its own — refresh the display immediately (no delay) right after it happens, so x/max energy doesn't stay stuck on the pre-gain value shown by the turnStart step above. */
  playEnergyGainStep(step) {
    this.setDisplayed(step.character, step.health, step.energy);
    this.renderCombatant(step.character);
    this.finishStep();
  }

  playTurnSkipStep(step) {
    this.setDisplayed(step.character, step.health, step.energy);
    this.renderCombatant(step.character);
    this.renderMoveOrder(step.character);
    this.timers.push(setTimeout(() => this.finishStep(), this.scaled(TURN_SKIP_MS)));
  }

  playConsumableStep(step) {
    this.setDisplayed(step.character, step.health, step.energy);
    this.renderCombatant(step.character);
    this.timers.push(setTimeout(() => this.finishStep(), this.scaled(CONSUMABLE_BEAT_MS)));
  }

  /** Holds on the character's just-reduced speed for a beat, so losing it from acting is actually visible before the next speedCheck compares again. */
  playTurnEndStep(step) {
    this.setDisplayed(step.character, step.health, step.energy);
    this.setDisplayedSpeed(step.character, step.speed);
    this.renderCombatant(step.character);
    this.renderMoveOrder(step.character);
    this.timers.push(setTimeout(() => this.finishStep(), this.scaled(TURN_END_SPEED_HOLD_MS)));
  }

  playMoveStep(step) {
    const { attacker, defender, move } = step;
    if (!move) { this.finishStep(); return; } // enemy had nothing it could use — just a quiet beat

    const category = moveAnimationCategory(move);
    const duration = this.scaled(
      category === 'attack' ? ATTACK_DURATION_MS : category === 'defence' ? DEFENCE_DURATION_MS : SPECIAL_DURATION_MS,
    );
    const peak = this.scaled(category === 'attack' ? ATTACK_PEAK_MS : category === 'defence' ? DEFENCE_PEAK_MS : 0);
    this.playMoveAnimation(attacker, category, duration);

    const applyEffects = () => {
      this.setDisplayed(attacker, step.attackerHealth, step.attackerEnergy);
      this.setDisplayed(defender, step.defenderHealth, step.defenderEnergy);
      this.renderCombatant(attacker);
      this.renderCombatant(defender);
      this.spawnMoveDamageNumbers(step);
    };

    this.timers.push(setTimeout(applyEffects, peak));
    this.timers.push(setTimeout(() => this.finishStep(), duration));
  }

  spawnMoveDamageNumbers(step) {
    const { attacker, defender, result } = step;
    if (!result) return; // pure buff/defence move with no attack roll at all
    if (!result.hit) {
      this.spawnDamageNumber(defender, t('fight.miss_popup'), MISS_COLOR);
      return;
    }
    const regularColor = result.isCrit ? CRIT_COLOR : REGULAR_DAMAGE_COLOR;
    if (result.split) {
      this.spawnDamageNumber(defender, `-${result.damage}`, regularColor, result.isCrit);
      if (result.reflected > 0) this.spawnDamageNumber(attacker, `-${result.reflected}`, regularColor, result.isCrit);
      return;
    }
    this.spawnDamageNumber(defender, `-${result.damage}`, regularColor, result.isCrit);
    if (result.reflected > 0) {
      this.spawnDamageNumber(attacker, `-${result.reflected}`, STATUS_EFFECTS.thorns?.color ?? REGULAR_DAMAGE_COLOR);
    }
  }

  // --- Rendering -----------------------------------------------------------

  setDisplayed(character, health, energy) {
    if (!character) return;
    this.displayed.set(character, { health, energy });
  }

  getDisplayed(character) {
    if (!character) return { health: 0, energy: 0 };
    if (!this.displayed.has(character)) {
      this.displayed.set(character, { health: character.currentHealth, energy: character.energy });
    }
    return this.displayed.get(character);
  }

  setDisplayedSpeed(character, speed) {
    if (!character) return;
    this.displayedSpeed.set(character, speed);
  }

  getDisplayedSpeed(character) {
    if (!character) return 0;
    if (!this.displayedSpeed.has(character)) this.displayedSpeed.set(character, character.battleSpeed);
    return this.displayedSpeed.get(character);
  }

  /** Full initial build for a combatant's box — only ever used before any animation is in flight (enter/pause/idle-settle), never mid-beat, since it replaces the whole node (and would wipe a running CSS animation). */
  renderAll() {
    const { app } = this;
    const combat = app.combatManager;
    if (!combat.player) return;

    this.els.turn.textContent = t('fight.turn', { n: combat.turnOrder.fightTurn });
    this.els.player.innerHTML = this.combatantHTML(combat.player, t('fight.player'));
    combat.enemies.forEach((e) => { this.els.enemy.innerHTML = this.combatantHTML(e, t('fight.enemy')); });

    this.renderLog();
    this.renderMoveOrder(combat.currentActor);
    this.renderCategoryPanel();

    if (app.gameState.paused) this.pause.render();
  }

  renderLog() {
    if (!this.els) return;
    this.els.log.innerHTML = this.app.combatManager.log.map((line) => `<div class="log-line">${line}</div>`).join('');
  }

  renderMoveOrder(highlight = null) {
    if (!this.els) return;
    const combat = this.app.combatManager;
    const order = [...combat.combatants].sort((a, b) => this.getDisplayedSpeed(b) - this.getDisplayedSpeed(a));
    this.els.order.innerHTML = `<div class="order-title">${t('fight.move_order')}</div>` +
      order.map((c) => `<div class="${c === highlight ? 'order-active' : ''}">${c.name}: ${Math.round(this.getDisplayedSpeed(c))}</div>`).join('');
  }

  /**
   * Surgical update, used for every in-playback refresh — only touches
   * the status-icon list and the two stat-line text nodes, leaving the
   * `.avatar-box` element itself (and any CSS animation class currently
   * running on it) completely untouched.
   */
  renderCombatant(character) {
    if (!this.els || !character) return;
    const slot = character.isPlayer ? this.els.player : this.els.enemy;
    if (!slot) return;
    const { health, energy } = this.getDisplayed(character);
    const statusEl = slot.querySelector('.status-icons');
    if (statusEl) statusEl.innerHTML = this.statusIconsHTML(character);
    const statLines = slot.querySelectorAll('.stat-line');
    if (statLines[0]) statLines[0].textContent = `${health} / ${character.getMaxHealth()}`;
    if (statLines[1]) statLines[1].textContent = `${energy} / ${character.getMaxEnergy()}`;
  }

  /** `durationMs` is the already gameSpeed-scaled value the JS timers are using for this beat — set as a CSS var so the visual keyframe animation finishes at exactly the same moment, at any speed. */
  playMoveAnimation(attacker, category, durationMs) {
    if (!this.els) return;
    const slot = attacker.isPlayer ? this.els.player : this.els.enemy;
    const box = slot?.querySelector('.avatar-box');
    if (!box) return;

    const animClass = category === 'attack' ? 'anim-attack' : category === 'defence' ? 'anim-defence' : 'anim-special';

    if (category === 'attack') box.style.setProperty('--attack-travel', `${this.attackTravelPx(attacker, box)}px`);
    box.style.setProperty('--anim-duration', `${durationMs}ms`);
    box.classList.remove('anim-attack', 'anim-defence', 'anim-special');
    void box.offsetWidth; // restart the animation if it's still mid-flight
    box.classList.add(animClass);
  }

  /** Signed on-screen distance from the attacker's box to the defender's, so the attack lands on the opponent instead of a small nudge. */
  attackTravelPx(attacker, attackerBox) {
    const defenderSlot = attacker.isPlayer ? this.els.enemy : this.els.player;
    const defenderBox = defenderSlot?.querySelector('.avatar-box');
    if (!defenderBox) return attacker.isPlayer ? -40 : 40;

    const attackerRect = attackerBox.getBoundingClientRect();
    const defenderRect = defenderBox.getBoundingClientRect();
    const attackerCenterY = attackerRect.top + attackerRect.height / 2;
    const defenderCenterY = defenderRect.top + defenderRect.height / 2;
    return (defenderCenterY - attackerCenterY) * ATTACK_TRAVEL_RATIO;
  }

  /** Floating combat-text at a random spot over the character's avatar box. */
  spawnDamageNumber(character, text, color, isCrit = false) {
    if (!this.els) return;
    const slot = character.isPlayer ? this.els.player : this.els.enemy;
    const box = slot?.querySelector('.avatar-box');
    if (!box) return;

    const lifetime = this.scaled(DAMAGE_NUMBER_LIFETIME_MS);
    const el = document.createElement('div');
    el.className = `damage-number${isCrit ? ' crit' : ''}`;
    el.textContent = text;
    el.style.color = color;
    el.style.setProperty('--damage-number-duration', `${lifetime}ms`);
    const offsetX = Math.round((Math.random() - 0.5) * 64);
    const offsetY = Math.round((Math.random() - 0.5) * 30) - 6;
    el.style.left = `calc(50% + ${offsetX}px)`;
    el.style.top = `calc(35% + ${offsetY}px)`;
    box.appendChild(el);

    const cleanup = () => el.remove();
    el.addEventListener('animationend', cleanup);
    this.timers.push(setTimeout(cleanup, lifetime));
  }

  combatantHTML(c, label) {
    const { health, energy } = this.getDisplayed(c);
    const color = c.visual?.color ?? '#555';
    const sprite = c.isPlayer ? getCharacterSprite(c.characterId) : getEnemySprite(c.enemyId);
    const inner = sprite
      ? `<img class="avatar-inner avatar-sprite" src="${sprite}" alt="${c.name}">`
      : `<div class="avatar-inner" style="background:${color}"></div>`;
    return `
      <div class="label">${label}</div>
      <div class="avatar-box">
        ${inner}
        <img class="avatar-border" src="${CHARACTER_BORDER}" alt="">
      </div>
      <div class="status-icons">${this.statusIconsHTML(c)}</div>
      <div class="stat-line">${health} / ${c.getMaxHealth()}</div>
      <div class="stat-line">${energy} / ${c.getMaxEnergy()}</div>`;
  }

  /**
   * Beyond the raw statusEffects list, also surfaces things that were
   * previously invisible to the player: stacked stat buffs (Golden
   * Calling's permanent +str, Accumulating Mana's per-turn +str, etc,
   * grouped and totalled per stat) and active defensive move states
   * (Guard, the various damageReduction moves, Arcane Split's reflect)
   * so "I used a defence move" has visible on-board proof.
   */
  statusIconsHTML(character) {
    const icons = character.statusEffects.map((effect) => {
      const cfg = STATUS_EFFECTS[effect.id];
      if (!cfg) return '';
      const name = tData('status', effect.id, cfg.name);
      return `
        <span class="status-icon ${cfg.type}" style="background:${cfg.color}" title="${name} x${effect.stacks}">
          ${cfg.icon}<sub class="status-stacks">${effect.stacks}</sub>
        </span>`;
    });

    const buffTotals = {};
    character.statBuffs.forEach((buff) => {
      buffTotals[buff.stat] = (buffTotals[buff.stat] ?? 0) + buff.amount;
    });
    Object.entries(buffTotals).forEach(([stat, amount]) => {
      if (amount === 0) return;
      const fullLabel = statLabel(stat).toUpperCase();
      const label = fullLabel.slice(0, 3);
      icons.push(`
        <span class="status-icon buff" style="background:#2ecc71" title="${fullLabel} +${amount}">
          +${label}<sub class="status-stacks">${amount}</sub>
        </span>`);
    });

    if (character.guardState) {
      icons.push(`
        <span class="status-icon defence" style="background:#3498db" title="${t('fight.guarding', { percent: character.guardState.percent })}">
          GD
        </span>`);
    }
    if (character.pendingDamageReduction) {
      const dr = character.pendingDamageReduction;
      const label = dr.percent
        ? `${t('fight.defended_percent', { percent: dr.percent })}${dr.hits ? t('fight.hits_left', { n: dr.hits }) : ''}`
        : t('fight.defended_flat', { amount: dr.flat });
      icons.push(`
        <span class="status-icon defence" style="background:#3498db" title="${label}">
          DEF
        </span>`);
    }
    if (character.reflectSplitPercent > 0) {
      icons.push(`
        <span class="status-icon defence" style="background:#3498db" title="${t('fight.reflecting', { percent: character.reflectSplitPercent })}">
          RS
        </span>`);
    }
    if (character.guaranteedDodgeTurnsRemaining > 0) {
      icons.push(`
        <span class="status-icon defence" style="background:#3498db" title="${t('fight.guaranteed_dodge')}">
          DDG
        </span>`);
    }
    if (character.pendingReactiveHeal) {
      icons.push(`
        <span class="status-icon defence" style="background:#3498db" title="${t('fight.reactive_heal', { n: character.pendingReactiveHeal.multiplier })}">
          HL
        </span>`);
    }

    return icons.join('');
  }

  getAvailableMoves(category) {
    const player = this.app.combatManager.player;
    if (!player) return [];
    return player.moves.filter((m) => !m.properties.includes(MOVE_PROPERTIES.PASSIVE) && FILTERS[category](m));
  }

  renderCategoryPanel() {
    const { app } = this;
    const combat = app.combatManager;
    const panel = this.els.panel;

    if (app.gameState.paused || combat.phase !== COMBAT_PHASE.PLAYER_TURN ||
        this.playing || this.playbackQueue.length) {
      panel.innerHTML = '';
      return;
    }

    if (!this.openCategory) {
      panel.innerHTML = Object.values(MOVE_CATEGORIES)
        .map((cat) => `<button class="cat-btn" data-cat="${cat}">${t(CATEGORY_LABEL_KEYS[cat])}</button>`)
        .join('');
      panel.querySelectorAll('[data-cat]').forEach((btn) => {
        btn.addEventListener('click', () => {
          this.openCategory = btn.dataset.cat;
          this.renderCategoryPanel();
        });
      });
      return;
    }

    if (this.openCategory === MOVE_CATEGORIES.CONSUMABLES) {
      this.renderConsumablesCategory();
      return;
    }

    const player = combat.player;
    const moves = this.getAvailableMoves(this.openCategory);
    const moveButtons = moves.map((move) => {
      const affordable = move.isAvailable(player.energy);
      const cdTag = move.isOnCooldown() ? t('fight.cd', { n: move.currentCooldown }) : '';
      return `
        <button class="move-btn" data-move="${move.id}" ${affordable ? '' : 'disabled'}>
          <strong>${move.name}</strong><br>
          <small>${move.properties.map((w) => t(`property.${w}`)).join(', ')}</small><br>
          <small>${t('fight.cost', { amount: move.energyCost })}${cdTag}</small>
        </button>`;
    }).join('');
    panel.innerHTML = `<button class="cat-btn back-btn">${t('common.back')}</button>${moveButtons || `<div class="empty-note">${t('fight.no_moves')}</div>`}`;

    panel.querySelector('.back-btn').addEventListener('click', () => {
      this.openCategory = null;
      this.renderCategoryPanel();
    });
    panel.querySelectorAll('[data-move]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const result = combat.playerUseMove(btn.dataset.move);
        if (!result.ok) app.gameState.addLog(tReason(result.reason));
        this.openCategory = null;
        this.renderCategoryPanel();
      });
    });
  }

  /**
   * CONSUMABLES draws from the player's actual carried items
   * (gameState.run.consumables — seeded from the permanent locker
   * stock at run start), not from player.moves. Using one applies its
   * combatEffect and ends the turn, same as any other action.
   */
  renderConsumablesCategory() {
    const { app } = this;
    const combat = app.combatManager;
    const panel = this.els.panel;
    const entries = Object.entries(app.gameState.run.consumables ?? {}).filter(([, amt]) => amt > 0);

    const itemButtons = entries.map(([id, amt]) => {
      const cfg = getConsumableConfig(id);
      return `
        <button class="move-btn" data-consumable="${id}">
          <strong>${tData('consumable', id, cfg?.name ?? id)}</strong> x${amt}<br>
          <small>${tData('consumableFlavour', id, cfg?.flavour ?? '')}</small>
        </button>`;
    }).join('');
    panel.innerHTML = `<button class="cat-btn back-btn">${t('common.back')}</button>${itemButtons || `<div class="empty-note">${t('fight.no_consumables')}</div>`}`;

    panel.querySelector('.back-btn').addEventListener('click', () => {
      this.openCategory = null;
      this.renderCategoryPanel();
    });
    panel.querySelectorAll('[data-consumable]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const id = btn.dataset.consumable;
        const cfg = getConsumableConfig(id);
        if (!cfg) return;
        const result = combat.playerUseConsumable(tData('consumable', id, cfg.name), cfg.combatEffect ?? {});
        if (result.ok) { app.inventory.useConsumable(id, 1); app.trackConsumableUsed(id); }
        else app.gameState.addLog(tReason(result.reason));
        this.openCategory = null;
        this.renderCategoryPanel();
      });
    });
  }
}
