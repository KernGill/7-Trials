import { clamp } from '../utils/MathUtils.js';
import { getConsumableConfig } from '../data/consumables.js';
import { getItemConfig } from '../data/items.js';
import { TooltipManager } from '../ui/TooltipManager.js';
import { itemTooltipHTML, equipmentGridHTML, equipmentTotalsHTML, cardTileHTML } from '../ui/InfoFormatters.js';
import { t, tData } from '../ui/i18n.js';

const LANGUAGE_OPTIONS = ['en', 'es'];

/**
 * PauseOverlay — reusable pause-menu component mounted/unmounted by
 * ExploreState and FightState (pausing is valid in either place; only
 * "can I abandon?" differs). Pure DOM, re-renders only on its own
 * button clicks — never on a timer/frame loop.
 */
export class PauseOverlay {
  constructor(app) {
    this.app = app;
    this.el = null;
  }

  mount(root, { canAbandon, allowConsumables = false, onUseConsumable = null }) {
    this.canAbandon = canAbandon;
    this.allowConsumables = allowConsumables;
    this.onUseConsumable = onUseConsumable;
    this.el = document.createElement('div');
    this.el.className = 'pause-overlay';
    root.appendChild(this.el);
    this.tooltip = new TooltipManager();
    this.render();
  }

  unmount() {
    this.el?.remove();
    this.el = null;
    this.tooltip?.destroy();
    this.tooltip = null;
  }

  render() {
    if (!this.el) return;
    const { app } = this;
    const view = app.gameState.pauseView ?? 'menu';
    if (view === 'settings') return this.renderSettings();
    if (view === 'loadout') return this.renderLoadout();
    if (view === 'cards') return this.renderCards();
    if (view === 'consumables') return this.renderConsumables();
    return this.renderMenu();
  }

  renderMenu() {
    const { app } = this;
    this.el.innerHTML = `
      <div class="pause-box">
        <h2>${t('pause.title')}</h2>
        <button data-a="resume">${t('pause.resume')}</button>
        <button data-a="loadout">${t('pause.view_loadout')}</button>
        <button data-a="cards">${t('pause.view_cards')}</button>
        ${this.allowConsumables ? `<button data-a="consumables">${t('pause.use_consumables')}</button>` : ''}
        <button data-a="settings">${t('pause.open_settings')}</button>
        <button data-a="abandon" ${this.canAbandon ? '' : 'disabled'}>
          ${this.canAbandon ? t('pause.abandon_run') : t('pause.cannot_leave')}
        </button>
      </div>`;
    this.el.querySelector('[data-a="resume"]').addEventListener('click', () => app.togglePause());
    this.el.querySelector('[data-a="loadout"]').addEventListener('click', () => { app.gameState.pauseView = 'loadout'; this.render(); });
    this.el.querySelector('[data-a="cards"]').addEventListener('click', () => { app.gameState.pauseView = 'cards'; this.render(); });
    this.el.querySelector('[data-a="settings"]').addEventListener('click', () => { app.gameState.pauseView = 'settings'; this.render(); });
    if (this.allowConsumables) {
      this.el.querySelector('[data-a="consumables"]').addEventListener('click', () => { app.gameState.pauseView = 'consumables'; this.render(); });
    }
    if (this.canAbandon) {
      this.el.querySelector('[data-a="abandon"]').addEventListener('click', () => {
        app.gameState.run.active = false;
        app.goHome();
      });
    }
  }

  renderConsumables() {
    const { app } = this;
    const entries = Object.entries(app.gameState.run.consumables ?? {}).filter(([, amt]) => amt > 0);
    this.el.innerHTML = `
      <div class="pause-box">
        <h2>${t('pause.consumables_title')}</h2>
        ${entries.length === 0 ? `<div class="pause-row">${t('fight.no_consumables')}</div>` : ''}
        ${entries.map(([id, amt]) => {
          const cfg = getConsumableConfig(id);
          return `<button data-use="${id}">${t('pause.use_item', { name: tData('consumable', id, cfg?.name ?? id), amount: amt })}</button>`;
        }).join('')}
        <button data-a="back">${t('common.back')}</button>
      </div>`;
    this.el.querySelectorAll('[data-use]').forEach((btn) => {
      btn.addEventListener('click', () => {
        this.onUseConsumable?.(btn.dataset.use);
        this.render();
      });
    });
    this.el.querySelector('[data-a="back"]').addEventListener('click', () => { app.gameState.pauseView = 'menu'; this.render(); });
  }

  renderSettings() {
    const { app } = this;
    const s = app.gameState.settings;
    this.el.innerHTML = `
      <div class="pause-box">
        <h2>${t('settings.title')}</h2>
        <div class="pause-row">
          <span class="brightness-label">${t('settings.brightness', { percent: Math.round(s.brightness * 100) })}</span>
          <input type="range" min="30" max="150" value="${Math.round(s.brightness * 100)}" class="brightness-slider">
        </div>
        <div class="pause-row">
          <span class="gamespeed-label">${t('settings.game_speed', { mult: s.gameSpeed ?? 2 })}</span>
          <input type="range" min="1" max="5" step="1" value="${s.gameSpeed ?? 2}" class="gamespeed-slider">
        </div>
        <div class="pause-row">
          <span>${t('settings.language')}</span>
          <select class="language-select">
            ${LANGUAGE_OPTIONS.map((lang) => `<option value="${lang}" ${lang === s.language ? 'selected' : ''}>${t(`settings.language.${lang}`)}</option>`).join('')}
          </select>
        </div>
        <div class="pause-row">${t('settings.sound')} <button data-a="sound">${s.sound ? t('settings.on') : t('settings.off')}</button></div>
        <button data-a="back">${t('common.back')}</button>
      </div>`;
    this.el.querySelector('.brightness-slider').addEventListener('change', () => app.saveSystem.save());
    this.el.querySelector('.brightness-slider').addEventListener('input', (e) => {
      s.brightness = clamp(Number(e.target.value) / 100, 0.3, 1.5);
      app.applyBrightness();
      this.el.querySelector('.brightness-label').textContent = t('settings.brightness', { percent: Math.round(s.brightness * 100) });
    });
    this.el.querySelector('.gamespeed-slider').addEventListener('change', () => app.saveSystem.save());
    this.el.querySelector('.gamespeed-slider').addEventListener('input', (e) => {
      s.gameSpeed = clamp(Number(e.target.value), 1, 5);
      this.el.querySelector('.gamespeed-label').textContent = t('settings.game_speed', { mult: s.gameSpeed });
    });
    this.el.querySelector('.language-select').addEventListener('change', (e) => {
      app.setLanguage(e.target.value);
      app.saveSystem.save();
      this.render(); // full re-render — every label on this view needs the new language
    });
    this.el.querySelector('[data-a="sound"]').addEventListener('click', () => { s.sound = !s.sound; app.saveSystem.save(); this.render(); });
    this.el.querySelector('[data-a="back"]').addEventListener('click', () => { app.gameState.pauseView = 'menu'; this.render(); });
  }

  /** Same per-slot hover-tooltip behavior as LockerState's equipment tab. */
  renderLoadout() {
    const { app } = this;
    const equipped = app.inventory.getEquippedItems();
    const totals = app.inventory.getEquippedStatTotals();

    this.el.innerHTML = `
      <div class="pause-box loadout-box">
        <h2>${t('pause.loadout_title')}</h2>
        ${equipmentGridHTML(equipped)}
        <div class="loadout-totals">
          <h3>${t('pause.total_stats')}</h3>
          ${equipmentTotalsHTML(totals)}
        </div>
        <button data-a="back">${t('common.back')}</button>
      </div>`;

    this.el.querySelectorAll('[data-item-id]').forEach((tile) => {
      this.tooltip.bind(tile, () => {
        const config = getItemConfig(tile.dataset.itemId);
        return config ? itemTooltipHTML(config) : '';
      });
    });
    this.el.querySelector('[data-a="back"]').addEventListener('click', () => { app.gameState.pauseView = 'menu'; this.render(); });
  }

  /** Lists every card picked so far this run — cards are wiped whenever the run ends, so this is always run-scoped. */
  renderCards() {
    const { app } = this;
    const cards = app.gameState.run.cards ?? [];

    this.el.innerHTML = `
      <div class="pause-box cards-box">
        <h2>${t('pause.cards_title')}</h2>
        ${cards.length === 0
          ? `<div class="pause-row">${t('pause.no_cards')}</div>`
          : `<div class="cards-list">${cards.map((c) => cardTileHTML(c)).join('')}</div>`}
        <button data-a="back">${t('common.back')}</button>
      </div>`;

    this.el.querySelector('[data-a="back"]').addEventListener('click', () => { app.gameState.pauseView = 'menu'; this.render(); });
  }
}
