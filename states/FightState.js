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

// Pacing "beat" every queued move animation occupies before the next one
// starts / input re-enables, regardless of how long its own CSS keyframes
// run for (defence and special finish well under this and just hold).
const ANIMATION_STEP_MS = 1500;

// How much of the actual on-screen gap between the two avatar boxes the
// attack animation crosses — short of 100% so the boxes don't fully
// overlap at the peak of the swing.
const ATTACK_TRAVEL_RATIO = 0.85;

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
 * (right). Every combat message (whose move was used, damage dealt,
 * energy gained, etc) accumulates in the left-side log instead of
 * flashing transiently in the middle of the arena.
 *
 * Re-renders only from real events (StateManager wires combat:log /
 * combat:player_turn / combat:move_resolved to onCombatUpdate()) —
 * never a per-frame loop, which is what broke the category buttons
 * before this file was rewritten.
 */
export class FightState {
  constructor(app) {
    this.app = app;
    this.openCategory = null;
    this.pause = new PauseOverlay(app);
    this.animQueue = [];
    this.animating = false;
    this.pendingEndCallback = null;
    this.animTimers = [];
  }

  enter(root) {
    this.root = root;
    this.openCategory = null;
    this.animQueue = [];
    this.animating = false;
    this.pendingEndCallback = null;
    this.animTimers.forEach((id) => clearTimeout(id));
    this.animTimers = [];
    root.innerHTML = `
      <div class="fight-screen">
        <div class="fight-turn"></div>
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
    this.animTimers.forEach((id) => clearTimeout(id));
    this.animTimers = [];
  }

  onPauseToggled() {
    if (this.app.gameState.paused) this.pause.mount(this.root, { canAbandon: false });
    else this.pause.unmount();
    this.renderAll();
  }

  onCombatUpdate() { this.renderAll(); }

  /**
   * Every resolved move (including Bone Zone's queued follow-up hits)
   * becomes one animated "beat". CombatManager itself runs fully
   * synchronously — a player move can cascade straight through an
   * enemy counter-move within the same call stack — so beats are
   * buffered here and played out one at a time on a real timer instead
   * of all flashing at once. Health/energy/log still update live via
   * onCombatUpdate(); only the avatar animation and (via the panel
   * guard in renderCategoryPanel) player input are paced by the queue.
   */
  onMoveResolved({ attacker, move, result } = {}) {
    if (!attacker || !move || (result && !result.hit)) return;
    this.animQueue.push({ attacker, move });
    this.drainAnimQueue();
  }

  /**
   * CombatManager can cascade several moves through one synchronous call
   * stack (player move -> immediate enemy counter-move), and every log
   * line along the way triggers its own renderAll() that rebuilds the
   * avatar-box. Adding the animation class inline here would just get
   * wiped by the next renderAll() a moment later, before the browser
   * ever paints it. Waiting a tick (setTimeout 0) lets that synchronous
   * burst finish and the DOM settle before the class actually goes on.
   */
  drainAnimQueue() {
    if (this.animating || !this.animQueue.length) return;
    this.animating = true;
    this.animTimers.push(setTimeout(() => {
      const { attacker, move } = this.animQueue.shift();
      this.playMoveAnimation(attacker, move);
      this.animTimers.push(setTimeout(() => {
        this.animating = false;
        if (this.animQueue.length) this.drainAnimQueue();
        else this.onAnimQueueDrained();
      }, ANIMATION_STEP_MS));
    }, 0));
  }

  onAnimQueueDrained() {
    if (this.pendingEndCallback) {
      const cb = this.pendingEndCallback;
      this.pendingEndCallback = null;
      cb();
      return;
    }
    this.renderAll(); // re-show the move panel now that the beat is over
  }

  /**
   * Called by StateManager instead of jumping straight to the
   * victory/defeat screen, so the killing blow's own animation gets to
   * finish playing before the arena is torn down.
   */
  deferUntilAnimationsDone(fn) {
    if (!this.animating && !this.animQueue.length) fn();
    else this.pendingEndCallback = fn;
  }

  playMoveAnimation(attacker, move) {
    if (!this.els) return;
    const slot = attacker.isPlayer ? this.els.player : this.els.enemy;
    const box = slot?.querySelector('.avatar-box');
    if (!box) return;

    const category = moveAnimationCategory(move);
    const animClass = category === 'attack' ? 'anim-attack' : category === 'defence' ? 'anim-defence' : 'anim-special';

    if (category === 'attack') box.style.setProperty('--attack-travel', `${this.attackTravelPx(attacker, box)}px`);
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

  renderAll() {
    const { app } = this;
    const combat = app.combatManager;
    if (!combat.player) return;

    this.els.turn.textContent = t('fight.turn', { n: combat.turnOrder.fightTurn });
    this.els.player.innerHTML = this.combatantHTML(combat.player, t('fight.player'));
    combat.enemies.forEach((e) => { this.els.enemy.innerHTML = this.combatantHTML(e, t('fight.enemy')); });

    // Newest message on top.
    this.els.log.innerHTML = combat.log.map((line) => `<div class="log-line">${line}</div>`).join('');

    const order = [...combat.combatants].sort((a, b) => b.battleSpeed - a.battleSpeed);
    this.els.order.innerHTML = `<div class="order-title">${t('fight.move_order')}</div>` +
      order.map((c) => `<div>${c.name}: ${Math.round(c.battleSpeed)}</div>`).join('');

    this.renderCategoryPanel();

    if (app.gameState.paused) this.pause.render();
  }

  combatantHTML(c, label) {
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
      <div class="stat-line">${c.currentHealth} / ${c.getMaxHealth()}</div>
      <div class="stat-line">${c.energy} / ${c.getMaxEnergy()}</div>`;
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
        this.animating || this.animQueue.length) {
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
        this.renderAll();
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
        this.renderAll();
      });
    });
  }
}
