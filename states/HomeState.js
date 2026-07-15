import { GAME_STATES } from '../utils/Constants.js';
import { t } from '../ui/i18n.js';

/** HomeState — the only hub. Every other state can only return here. */
export class HomeState {
  constructor(app) {
    this.app = app;
  }

  enter(root) {
    this.root = root;
    root.innerHTML = `
      <div class="home-screen">
        <h1 class="home-title">${t('home.title')}</h1>
        <div class="home-grid">
          <button class="home-tile" data-a="shop">${t('home.shop')}</button>
          <button class="home-tile" data-a="bestiary">${t('home.bestiary')}</button>
          <button class="home-tile" data-a="inn">${t('home.inn')}</button>
          <button class="home-tile home-tile-battle" data-a="battle">${t('home.battle')}</button>
          <button class="home-tile" data-a="settings">${t('home.settings')}</button>
          <button class="home-tile" data-a="locker">${t('home.locker')}</button>
        </div>
        <div class="home-save-row">
          <button class="save-btn" data-a="save">${t('home.save')}</button>
          <button class="save-btn" data-a="load">${t('home.load')}</button>
        </div>
      </div>`;

    const actions = {
      battle: () => this.app.startRun(),
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

  flashSaved() {
    const btn = this.root?.querySelector('[data-a="save"]');
    if (!btn) return;
    const original = btn.textContent;
    btn.textContent = t('home.saved');
    setTimeout(() => { if (btn.isConnected) btn.textContent = original; }, 900);
  }

  exit() {}
}
