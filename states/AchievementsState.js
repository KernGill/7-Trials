import { GAME_STATES } from '../utils/Constants.js';
import { getAllAchievements } from '../data/achievements.js';
import { ITEMS } from '../data/items.js';
import { t, tData } from '../ui/i18n.js';

/**
 * AchievementsState — every achievement, green if completed, dark grey
 * if not, each showing its unlock condition, progress (when the target
 * is more than a plain done/not-done), and whatever item(s) it gates in
 * the shop (cross-referenced from data/items.js's own unlock.achievement
 * field — most items are gated this way, but plenty of achievements are
 * pure trophies with nothing to unlock, which is fine).
 */
export class AchievementsState {
  constructor(app) {
    this.app = app;
  }

  enter(root) {
    this.root = root;
    root.innerHTML = `
      <div class="achievements-screen">
        <button class="back-btn">${t('common.return_home')}</button>
        <h1>${t('achievements.title')}</h1>
        <div class="achievements-list"></div>
      </div>`;
    root.querySelector('.back-btn').addEventListener('click', () => this.app.setState(GAME_STATES.HOME));
    this.renderList();
  }

  exit() {}

  /** Every item whose shop unlock is gated behind this achievement, translated. */
  getUnlockedItemNames(achievementId) {
    return Object.values(ITEMS)
      .filter((item) => item.unlock?.achievement === achievementId)
      .map((item) => tData('item', item.id, item.name));
  }

  renderList() {
    const list = this.root.querySelector('.achievements-list');
    const achievements = getAllAchievements();
    list.innerHTML = achievements.map((config) => {
      const completed = this.app.achievements.isComplete(config.id);
      const progress = this.app.achievements.getProgress(config.id);
      const unlocks = this.getUnlockedItemNames(config.id);
      const name = tData('achievement', config.id, config.name);
      const description = tData('achievement_desc', config.id, config.description);
      return `
        <div class="achievement-card ${completed ? 'completed' : 'locked'}">
          <div class="achievement-card-header">
            <span class="achievement-name">${name}</span>
            <span class="achievement-status">${completed ? t('achievements.completed') : t('achievements.locked')}</span>
          </div>
          <div class="achievement-desc">${description}</div>
          ${config.target > 1 ? `<div class="achievement-progress">${t('achievements.progress', { current: progress, target: config.target })}</div>` : ''}
          <div class="achievement-unlocks">${t('achievements.unlocks')} ${unlocks.length ? unlocks.join(', ') : t('achievements.unlocks_none')}</div>
        </div>`;
    }).join('');
  }
}
