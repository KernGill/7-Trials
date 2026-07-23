import { GAME_STATES } from '../utils/Constants.js';
import { t } from '../ui/i18n.js';
import { TooltipManager } from '../ui/TooltipManager.js';
import { equipmentGridHTML, equipmentTotalsHTML, cardTileHTML } from '../ui/InfoFormatters.js';
import { InventorySystem } from '../systems/InventorySystem.js';

/** HomeState — the only hub. Every other state can only return here. */
export class HomeState {
  constructor(app) {
    this.app = app;
  }

  enter(root) {
    this.root = root;
    this.tooltip = new TooltipManager();
    root.innerHTML = `
      <div class="home-screen">
        <h1 class="home-title">${t('home.title')}</h1>
        <div class="home-grid">
          <button class="home-tile home-tile-icon" data-a="shop"><span class="home-tile-icon-img"></span><span class="home-tile-label">${t('home.shop')}</span></button>
          <button class="home-tile home-tile-icon" data-a="bestiary"><span class="home-tile-icon-img"></span><span class="home-tile-label">${t('home.bestiary')}</span></button>
          <button class="home-tile" data-a="inn">${t('home.inn')}</button>
          <button class="home-tile home-tile-battle" data-a="battle">${t('home.battle')}</button>
          <button class="home-tile home-tile-icon" data-a="settings"><span class="home-tile-icon-img"></span><span class="home-tile-label">${t('home.settings')}</span></button>
          <button class="home-tile home-tile-icon" data-a="locker"><span class="home-tile-icon-img"></span><span class="home-tile-label">${t('home.locker')}</span></button>
        </div>
        <div class="home-save-row">
          <button class="save-btn" data-a="save">${t('home.save')}</button>
          <button class="save-btn" data-a="load">${t('home.load')}</button>
        </div>
      </div>`;

    const actions = {
      battle: () => this.handleBattleClick(),
      shop: () => this.app.setState(GAME_STATES.SHOP),
      bestiary: () => this.app.setState(GAME_STATES.BESTIARY),
      inn: () => this.app.setState(GAME_STATES.INN),
      locker: () => this.app.setState(GAME_STATES.LOCKER),
      settings: () => this.app.setState(GAME_STATES.SETTINGS),
      save: () => { this.app.saveSystem.save(); this.flashSaved(); },
      load: () => this.app.setState(GAME_STATES.SAVES),
    };
    root.querySelectorAll('[data-a]').forEach((btn) => {
      btn.addEventListener('click', () => actions[btn.dataset.a]());
    });
  }

  exit() {
    this.tooltip?.destroy();
  }

  flashSaved() {
    const btn = this.root?.querySelector('[data-a="save"]');
    if (!btn) return;
    const original = btn.textContent;
    btn.textContent = t('home.saved');
    setTimeout(() => { if (btn.isConnected) btn.textContent = original; }, 900);
  }

  /** A voluntarily-abandoned run (see StateManager.abandonRun()) is offered back here instead of unconditionally starting fresh. Guards against a malformed/stale snapshot (e.g. an older save written under a previous abandonedRun shape) rather than letting showRunChoiceModal throw and silently eat the click. */
  handleBattleClick() {
    const abandoned = this.app.gameState.abandonedRun;
    if (abandoned?.run) this.showRunChoiceModal(abandoned);
    else this.app.startRun();
  }

  /** "Continue: Floor N" / "Begin Anew" choice, same result-overlay/result-box modal pattern used elsewhere (ExploreState's card pick, minimap expand, etc). Hovering Continue previews the loadout the abandoned run actually had equipped (which Continue restores — not necessarily what's equipped right now) plus the cards it had picked. */
  showRunChoiceModal(snapshot) {
    const modal = document.createElement('div');
    modal.className = 'result-overlay';
    modal.innerHTML = `
      <div class="result-box">
        <h2>${t('home.resume_run_title')}</h2>
        <button class="continue-run-btn">${t('home.continue_run', { floor: snapshot.run.floor })}</button>
        <button class="begin-anew-btn">${t('home.begin_anew')}</button>
      </div>`;
    this.root.appendChild(modal);

    const continueBtn = modal.querySelector('.continue-run-btn');
    this.tooltip.bind(continueBtn, () => {
      // A throwaway InventorySystem over just the snapshot's equipped
      // set — same "peek without touching live state" trick SaveSlotsState
      // uses for its own hover preview — so this shows what Continue will
      // actually restore, not whatever's currently equipped at Home.
      const snapshotInventory = new InventorySystem({ player: { equipped: snapshot.equipped ?? {} }, run: { materials: {} } });
      const equipped = snapshotInventory.getEquippedItems();
      const totals = snapshotInventory.getEquippedStatTotals();
      const cards = snapshot.run.cards ?? [];
      const cardsHTML = cards.length
        ? `<div class="tt-section-label">${t('pause.cards_title')}</div><div class="cards-list">${cards.map((c) => cardTileHTML(c)).join('')}</div>`
        : '';
      return `${equipmentGridHTML(equipped)}${equipmentTotalsHTML(totals)}${cardsHTML}`;
    }, 'wide');

    continueBtn.addEventListener('click', () => {
      modal.remove();
      this.app.continueRun();
    });
    modal.querySelector('.begin-anew-btn').addEventListener('click', () => {
      modal.remove();
      this.app.startRun();
    });
  }
}
