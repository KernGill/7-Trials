import { clamp } from '../utils/MathUtils.js';
import { getConsumableConfig } from '../data/consumables.js';
import { getItemConfig } from '../data/items.js';
import { TooltipManager } from '../ui/TooltipManager.js';
import { itemTooltipHTML } from '../ui/InfoFormatters.js';

// Same 8 stats shown everywhere else (Shop/Bestiary/Locker/Inn tooltips) —
// keeps internal-only stats (energy, dodge, accuracy) out of this display.
const CORE_STAT_KEYS = ['con', 'dex', 'str', 'spd', 'def', 'int', 'critChance', 'critDamage'];

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
    if (view === 'consumables') return this.renderConsumables();
    return this.renderMenu();
  }

  renderMenu() {
    const { app } = this;
    this.el.innerHTML = `
      <div class="pause-box">
        <h2>PAUSED</h2>
        <button data-a="resume">RESUME (P)</button>
        <button data-a="loadout">VIEW LOADOUT</button>
        ${this.allowConsumables ? '<button data-a="consumables">USE CONSUMABLES</button>' : ''}
        <button data-a="settings">OPEN SETTINGS</button>
        <button data-a="abandon" ${this.canAbandon ? '' : 'disabled'}>
          ${this.canAbandon ? 'ABANDON RUN' : 'CANNOT LEAVE WHILE IN A FIGHT'}
        </button>
      </div>`;
    this.el.querySelector('[data-a="resume"]').addEventListener('click', () => app.togglePause());
    this.el.querySelector('[data-a="loadout"]').addEventListener('click', () => { app.gameState.pauseView = 'loadout'; this.render(); });
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
        <h2>CONSUMABLES</h2>
        ${entries.length === 0 ? '<div class="pause-row">No consumables carried this run.</div>' : ''}
        ${entries.map(([id, amt]) => {
          const cfg = getConsumableConfig(id);
          return `<button data-use="${id}">Use ${cfg?.name ?? id} (x${amt})</button>`;
        }).join('')}
        <button data-a="back">&larr; BACK</button>
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
        <h2>SETTINGS</h2>
        <div class="pause-row">
          <span class="brightness-label">Brightness: ${Math.round(s.brightness * 100)}%</span>
          <input type="range" min="30" max="150" value="${Math.round(s.brightness * 100)}" class="brightness-slider">
        </div>
        <div class="pause-row">Sound: <button data-a="sound">${s.sound ? 'On' : 'Off'}</button></div>
        <button data-a="back">&larr; BACK</button>
      </div>`;
    this.el.querySelector('.brightness-slider').addEventListener('change', () => app.saveSystem.save());
    this.el.querySelector('.brightness-slider').addEventListener('input', (e) => {
      s.brightness = clamp(Number(e.target.value) / 100, 0.3, 1.5);
      app.applyBrightness();
      this.el.querySelector('.brightness-label').textContent = `Brightness: ${Math.round(s.brightness * 100)}%`;
    });
    this.el.querySelector('[data-a="sound"]').addEventListener('click', () => { s.sound = !s.sound; app.saveSystem.save(); this.render(); });
    this.el.querySelector('[data-a="back"]').addEventListener('click', () => { app.gameState.pauseView = 'menu'; this.render(); });
  }

  /** Same per-slot hover-tooltip behavior as LockerState's equipment tab. */
  renderLoadout() {
    const { app } = this;
    const equipped = app.inventory.getEquippedItems();
    const totals = app.inventory.getEquippedStatTotals();

    const slotTile = (label, id) => `
      <div class="loadout-slot" ${id ? `data-item-id="${id}"` : ''}>
        <div class="loadout-slot-label">${label}</div>
        ${id ? `<div class="loadout-slot-item">${getItemConfig(id)?.name ?? id}</div>` : ''}
      </div>`;

    const leftCol = [
      slotTile('ACCESSORY', equipped.accessory?.[0]),
      slotTile('WEAPON', equipped.mainWeapon),
      slotTile('GLOVES', equipped.glove?.[0]),
      slotTile('RING', equipped.ring?.[0]),
    ].join('');
    const midCol = ['head', 'arms', 'chest', 'legs', 'boots']
      .map((slot) => slotTile(slot.toUpperCase(), equipped[slot]))
      .join('');
    const rightCol = [
      slotTile('ACCESSORY', equipped.accessory?.[1]),
      slotTile('OFFHAND', equipped.offHand),
      slotTile('GLOVES', equipped.glove?.[1]),
      slotTile('RING', equipped.ring?.[1]),
    ].join('');

    this.el.innerHTML = `
      <div class="pause-box loadout-box">
        <h2>LOADOUT</h2>
        <div class="loadout-grid">
          <div class="loadout-col">${leftCol}</div>
          <div class="loadout-col">${midCol}</div>
          <div class="loadout-col">${rightCol}</div>
        </div>
        <div class="loadout-totals">
          <h3>Total Stats:</h3>
          <div class="loadout-totals-grid">
            ${CORE_STAT_KEYS.map((k) => `<div class="tt-row"><span>${k}:</span><span>+${totals[k] ?? 0}</span></div>`).join('')}
          </div>
        </div>
        <button data-a="back">&larr; BACK</button>
      </div>`;

    this.el.querySelectorAll('[data-item-id]').forEach((tile) => {
      this.tooltip.bind(tile, () => {
        const config = getItemConfig(tile.dataset.itemId);
        return config ? itemTooltipHTML(config) : '';
      });
    });
    this.el.querySelector('[data-a="back"]').addEventListener('click', () => { app.gameState.pauseView = 'menu'; this.render(); });
  }
}
