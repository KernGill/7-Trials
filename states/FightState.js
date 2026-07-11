import { MOVE_CATEGORIES, MOVE_PROPERTIES } from '../utils/Constants.js';
import { COMBAT_PHASE } from '../combat/CombatManager.js';
import { PauseOverlay } from './PauseOverlay.js';

function isAttack(m) { return m.properties.includes(MOVE_PROPERTIES.PHYSICAL) || m.properties.includes(MOVE_PROPERTIES.MAGIC); }
function isSustain(m) { return m.properties.includes(MOVE_PROPERTIES.DEFENCE) || m.properties.includes(MOVE_PROPERTIES.HEALING); }
function isConsumable(m) { return m.properties.includes(MOVE_PROPERTIES.CONSUMABLE); }
function isSpecial(m) { return !isAttack(m) && !isSustain(m) && !isConsumable(m); }

const FILTERS = {
  [MOVE_CATEGORIES.ATTACKS]: isAttack,
  [MOVE_CATEGORIES.SUSTAIN]: isSustain,
  [MOVE_CATEGORIES.SPECIALS]: isSpecial,
  [MOVE_CATEGORIES.CONSUMABLES]: isConsumable,
};
const CATEGORY_LABELS = {
  [MOVE_CATEGORIES.ATTACKS]: 'ATTACKS',
  [MOVE_CATEGORIES.SUSTAIN]: 'SUSTAIN (DEFENCE / HEALING)',
  [MOVE_CATEGORIES.SPECIALS]: 'SPECIALS',
  [MOVE_CATEGORIES.CONSUMABLES]: 'CONSUMABLES',
};

/**
 * FightState — 1v1 turn-based combat, top-level peer of ExploreState.
 * Arena (left) + move-category panel (right), matching the PDF layout.
 *
 * IMPORTANT: this panel is rebuilt ONLY in response to actual events
 * (StateManager wires combat:log / combat:player_turn / combat:move_resolved
 * to onCombatUpdate()) — never from a per-frame render loop. That frame-loop
 * rebuild was exactly what broke the category buttons before: DOM nodes
 * were being destroyed/recreated up to 60x/sec, so any click landing
 * between two rebuilds lost its target.
 */
export class FightState {
  constructor(app) {
    this.app = app;
    this.openCategory = null;
    this.pause = new PauseOverlay(app);
  }

  enter(root) {
    this.root = root;
    this.openCategory = null;
    root.innerHTML = `
      <div class="fight-screen">
        <div class="fight-turn"></div>
        <div class="arena">
          <div class="combatant enemy-slot"></div>
          <div class="feedback-line"></div>
          <div class="combatant player-slot"></div>
        </div>
        <div class="fight-sidebar">
          <div class="move-order"></div>
          <div class="category-panel"></div>
        </div>
      </div>`;
    this.els = {
      turn: root.querySelector('.fight-turn'),
      enemy: root.querySelector('.enemy-slot'),
      player: root.querySelector('.player-slot'),
      feedback: root.querySelector('.feedback-line'),
      order: root.querySelector('.move-order'),
      panel: root.querySelector('.category-panel'),
    };
    this.renderAll();
  }

  exit() {
    this.pause.unmount();
  }

  onPauseToggled() {
    if (this.app.gameState.paused) this.pause.mount(this.root, { canAbandon: false });
    else this.pause.unmount();
    this.renderAll();
  }

  onCombatUpdate() { this.renderAll(); }

  onEnemyMoveFlash(move) {
    if (this.els?.feedback) this.els.feedback.textContent = `Enemy uses ${move.name}!`;
  }

  renderAll() {
    const { app } = this;
    const combat = app.combatManager;
    if (!combat.player) return;

    this.els.turn.textContent = `FIGHT TURN: ${combat.turnOrder.fightTurn}`;
    this.els.player.innerHTML = this.combatantHTML(combat.player, 'PLAYER');
    combat.enemies.forEach((e) => { this.els.enemy.innerHTML = this.combatantHTML(e, 'ENEMY'); });
    this.els.feedback.textContent = combat.log[0] ?? '';

    const order = [...combat.combatants].sort((a, b) => b.battleSpeed - a.battleSpeed);
    this.els.order.innerHTML = '<div class="order-title">Move Order:</div>' +
      order.map((c) => `<div>${c.name}: ${Math.round(c.battleSpeed)}</div>`).join('');

    this.renderCategoryPanel();

    if (app.gameState.paused) this.pause.render();
  }

  combatantHTML(c, label) {
    const color = c.visual?.color ?? '#555';
    return `
      <div class="label">${label}</div>
      <div class="avatar-box" style="background:${color}"></div>
      <div class="stat-line">${c.currentHealth} / ${c.getMaxHealth()}</div>
      <div class="stat-line">${c.energy} / ${c.getMaxEnergy()}</div>`;
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

    if (app.gameState.paused || combat.phase !== COMBAT_PHASE.PLAYER_TURN) {
      panel.innerHTML = '';
      return;
    }

    if (!this.openCategory) {
      panel.innerHTML = Object.values(MOVE_CATEGORIES)
        .map((cat) => `<button class="cat-btn" data-cat="${cat}">${CATEGORY_LABELS[cat]}</button>`)
        .join('');
      panel.querySelectorAll('[data-cat]').forEach((btn) => {
        btn.addEventListener('click', () => {
          this.openCategory = btn.dataset.cat;
          this.renderCategoryPanel();
        });
      });
      return;
    }

    const player = combat.player;
    const moves = this.getAvailableMoves(this.openCategory);
    const moveButtons = moves.map((move) => {
      const affordable = move.isAvailable(player.energy);
      const cdTag = move.isOnCooldown() ? ` (CD ${move.currentCooldown})` : '';
      return `
        <button class="move-btn" data-move="${move.id}" ${affordable ? '' : 'disabled'}>
          <strong>${move.name}</strong><br>
          <small>${move.properties.join(', ')}</small><br>
          <small>Cost: ${move.energyCost}${cdTag}</small>
        </button>`;
    }).join('');
    panel.innerHTML = `<button class="cat-btn back-btn">&larr; BACK</button>${moveButtons || '<div class="empty-note">No moves in this category.</div>'}`;

    panel.querySelector('.back-btn').addEventListener('click', () => {
      this.openCategory = null;
      this.renderCategoryPanel();
    });
    panel.querySelectorAll('[data-move]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const result = combat.playerUseMove(btn.dataset.move);
        if (!result.ok) app.gameState.addLog(result.reason);
        this.openCategory = null;
        this.renderAll();
      });
    });
  }
}
