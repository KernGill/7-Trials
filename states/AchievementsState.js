import { GAME_STATES } from '../utils/Constants.js';
import { getAllAchievements } from '../data/achievements.js';
import { ITEMS } from '../data/items.js';
import { TILE_TYPES } from '../exploration/Tile.js';
import { t, tData } from '../ui/i18n.js';

/** Every item whose shop unlock is gated behind this achievement, translated. */
export function getUnlockedItemNames(achievementId) {
  return Object.values(ITEMS)
    .filter((item) => item.unlock?.achievement === achievementId)
    .map((item) => tData('item', item.id, item.name));
}

/**
 * "Thief's Instinct" is a per-floor streak, not the permanent
 * AchievementSystem progress field (that's cross-run and capped at
 * target:1 — the wrong shape for "how far through THIS floor's events am
 * I right now"). See ExploreState.updateThiefStreak for where the streak
 * itself is maintained; this just renders it live, and only while it's
 * actually meaningful — an active run, standing on floor 3+, with the
 * achievement not already earned on some earlier run.
 */
function liveThiefProgressHTML(app, achievementId) {
  if (achievementId !== 'loot_all_events_floor_3_plus') return null;
  if (app.achievements.isComplete(achievementId)) return null;
  const run = app.gameState.run;
  if (!run?.active || run.floor < 3) return null;
  const eventTypes = [TILE_TYPES.LOCKED_DOOR, TILE_TYPES.TREASURE, TILE_TYPES.TEMPORAL_CHEST];
  const totalEvents = (run.dungeon?.tiles ?? []).filter((tile) => eventTypes.includes(tile.type)).length;
  if (!totalEvents) return null;
  const current = run.achievementProgress?.thiefStreak ?? 0;
  return `<div class="achievement-progress">${t('achievements.progress', { current, target: totalEvents })}</div>`;
}

/** One achievement's card markup — shared by AchievementsState (full screen) and PauseOverlay (in-run sub-view), so both stay in sync automatically. */
export function achievementCardHTML(app, config) {
  const completed = app.achievements.isComplete(config.id);
  const progress = app.achievements.getProgress(config.id);
  const unlocks = getUnlockedItemNames(config.id);
  const name = tData('achievement', config.id, config.name);
  const description = tData('achievement_desc', config.id, config.description);
  const liveProgress = liveThiefProgressHTML(app, config.id);
  const staticProgress = config.target > 1 ? `<div class="achievement-progress">${t('achievements.progress', { current: progress, target: config.target })}</div>` : '';
  return `
    <div class="achievement-card ${completed ? 'completed' : 'locked'}">
      <div class="achievement-card-header">
        <span class="achievement-name">${name}</span>
        <span class="achievement-status">${completed ? t('achievements.completed') : t('achievements.locked')}</span>
      </div>
      <div class="achievement-desc">${description}</div>
      ${liveProgress ?? staticProgress}
      <div class="achievement-unlocks">${t('achievements.unlocks')} ${unlocks.length ? unlocks.join(', ') : t('achievements.unlocks_none')}</div>
    </div>`;
}

/**
 * AchievementsState — every achievement, green if completed, dark grey
 * if not, each showing its unlock condition, progress (when the target
 * is more than a plain done/not-done, or live per-floor progress for
 * Thief's Instinct — see achievementCardHTML), and whatever item(s) it
 * gates in the shop.
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

  renderList() {
    const list = this.root.querySelector('.achievements-list');
    list.innerHTML = getAllAchievements().map((config) => achievementCardHTML(this.app, config)).join('');
  }
}
