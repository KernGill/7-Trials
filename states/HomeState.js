import { GAME_STATES } from '../utils/Constants.js';

/** HomeState — the only hub. Every other state can only return here. */
export class HomeState {
  constructor(app) {
    this.app = app;
  }

  enter(root) {
    root.innerHTML = `
      <div class="home-screen">
        <h1 class="home-title">7 TRIALS</h1>
        <div class="home-grid">
          <button class="home-tile" data-a="shop">SHOP</button>
          <button class="home-tile" data-a="bestiary">BESTIARY</button>
          <button class="home-tile" data-a="inn">INN</button>
          <button class="home-tile home-tile-battle" data-a="battle">BATTLE</button>
          <button class="home-tile" data-a="settings">SETTINGS</button>
          <button class="home-tile" data-a="locker">LOCKER</button>
        </div>
      </div>`;

    const actions = {
      battle: () => this.app.startRun(),
      shop: () => this.app.setState(GAME_STATES.SHOP),
      bestiary: () => this.app.setState(GAME_STATES.BESTIARY),
      inn: () => this.app.setState(GAME_STATES.INN),
      locker: () => this.app.setState(GAME_STATES.LOCKER),
      settings: () => this.app.setState(GAME_STATES.SETTINGS),
    };
    root.querySelectorAll('[data-a]').forEach((btn) => {
      btn.addEventListener('click', () => actions[btn.dataset.a]());
    });
  }

  exit() {}
}
