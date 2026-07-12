import { ACHIEVEMENTS, getAchievementConfig } from '../data/achievements.js';

/**
 * AchievementSystem — each achievement in data/achievements.js gets a
 * tracked record here: { progress, completed }. Completed is a plain
 * boolean; progress is the "its own variable being kept track of"
 * counter toward that achievement's target. Once completed, an
 * achievement never un-completes and progress calls become no-ops.
 */
export class AchievementSystem {
  constructor(gameState) {
    this.gameState = gameState;
    this.ensureStructure();
  }

  ensureStructure() {
    if (!this.gameState.meta.achievements) this.gameState.meta.achievements = {};
    Object.keys(ACHIEVEMENTS).forEach((id) => {
      if (!this.gameState.meta.achievements[id]) {
        this.gameState.meta.achievements[id] = { progress: 0, completed: false };
      }
    });
  }

  isComplete(id) {
    return this.gameState.meta.achievements[id]?.completed ?? false;
  }

  getProgress(id) {
    return this.gameState.meta.achievements[id]?.progress ?? 0;
  }

  /** Increments progress toward an achievement; auto-completes at target. */
  recordProgress(id, amount = 1) {
    this.ensureStructure();
    const config = getAchievementConfig(id);
    const entry = this.gameState.meta.achievements[id];
    if (!config || !entry || entry.completed) return;
    entry.progress = Math.min(config.target, entry.progress + amount);
    if (entry.progress >= config.target) entry.completed = true;
  }

  /** Direct completion for conditions tracked/verified externally (e.g. per-run counters). */
  setComplete(id) {
    this.ensureStructure();
    const config = getAchievementConfig(id);
    const entry = this.gameState.meta.achievements[id];
    if (!config || !entry) return;
    entry.progress = config.target;
    entry.completed = true;
  }
}
