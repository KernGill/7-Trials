import { GAME_STATES } from '../utils/Constants.js';
import { t } from '../ui/i18n.js';

/** EncyclopediaState — a small hub between Home and the Bestiary/Achievements screens. */
export class EncyclopediaState {
  constructor(app) {
    this.app = app;
  }

  enter(root) {
    this.root = root;
    root.innerHTML = `
      <div class="encyclopedia-screen">
        <button class="back-btn">${t('common.return_home')}</button>
        <h1>${t('encyclopedia.title')}</h1>
        <div class="encyclopedia-options">
          <button class="encyclopedia-option" data-a="bestiary">${t('encyclopedia.bestiary')}</button>
          <button class="encyclopedia-option" data-a="achievements">${t('encyclopedia.achievements')}</button>
        </div>
      </div>`;
    root.querySelector('.back-btn').addEventListener('click', () => this.app.setState(GAME_STATES.HOME));
    root.querySelector('[data-a="bestiary"]').addEventListener('click', () => this.app.setState(GAME_STATES.BESTIARY));
    root.querySelector('[data-a="achievements"]').addEventListener('click', () => this.app.setState(GAME_STATES.ACHIEVEMENTS));
  }

  exit() {}
}
