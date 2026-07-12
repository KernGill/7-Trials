import { clamp } from '../utils/MathUtils.js';
import { getConsumableConfig } from '../data/consumables.js';

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
    this.render();
  }

  unmount() {
    this.el?.remove();
    this.el = null;
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
          Brightness: ${Math.round(s.brightness * 100)}%
          <input type="range" min="30" max="150" value="${Math.round(s.brightness * 100)}" class="brightness-slider">
        </div>
        <div class="pause-row">Sound: <button data-a="sound">${s.sound ? 'On' : 'Off'}</button></div>
        <button data-a="back">&larr; BACK</button>
      </div>`;
    this.el.querySelector('.brightness-slider').addEventListener('change', () => app.saveSystem.save());
    this.el.querySelector('.brightness-slider').addEventListener('input', (e) => {
      s.brightness = clamp(Number(e.target.value) / 100, 0.3, 1.5);
    });
    this.el.querySelector('[data-a="sound"]').addEventListener('click', () => { s.sound = !s.sound; app.saveSystem.save(); this.render(); });
    this.el.querySelector('[data-a="back"]').addEventListener('click', () => { app.gameState.pauseView = 'menu'; this.render(); });
  }

  renderLoadout() {
    const { app } = this;
    const totals = app.inventory.getEquippedStatTotals();
    this.el.innerHTML = `
      <div class="pause-box">
        <h2>LOADOUT</h2>
        ${Object.entries(totals).map(([k, v]) => `<div class="pause-row">${k}: +${v}</div>`).join('')}
        <button data-a="back">&larr; BACK</button>
      </div>`;
    this.el.querySelector('[data-a="back"]').addEventListener('click', () => { app.gameState.pauseView = 'menu'; this.render(); });
  }
}
