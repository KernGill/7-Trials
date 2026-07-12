import { getArcConfig, getArcById, getArcForFloor } from '../data/arcs.js';
import { getEnemiesForArc } from '../data/enemies.js';
import { pickRandom } from '../utils/RandomUtils.js';

export class ProgressionSystem {
  constructor(gameState, achievementSystem = null) {
    this.gameState = gameState;
    this.achievements = achievementSystem;
  }

  get meta() {
    return this.gameState.meta;
  }

  /** meta.currentArc is a progress marker for unlocks/shop tiers/Inn — NOT for what spawns where (see getArcForFloor). */
  getCurrentArc() {
    return getArcConfig(this.meta.currentArc);
  }

  recordKill(enemyId) {
    this.meta.killCounts[enemyId] = (this.meta.killCounts[enemyId] ?? 0) + 1;
    this.checkUnlocks();
  }

  recordRunKill(enemyId) {
    const key = `run_${enemyId}`;
    this.meta.achievementFlags[key] = (this.meta.achievementFlags[key] ?? 0) + 1;
  }

  checkUnlocks() {
    if (this.meta.currentArc >= 2) {
      this.meta.innUnlocked = true;
    }
    if (this.meta.currentArc >= 3) {
      this.meta.partyUnlocked = true;
    }
  }

  /**
   * Marks `arcId` as completed and advances the progress marker — but
   * only the FIRST time. Re-killing a boss you've already beaten (which
   * is intentionally always possible, per design) is just a repeat
   * fight: it must not re-trigger progression or skip you forward.
   */
  completeArc(arcId) {
    const arc = getArcById(arcId);
    if (this.meta.arcsCompleted.includes(arc.id)) return; // already cleared before; no-op
    this.meta.arcsCompleted.push(arc.id);
    this.meta.currentArc = Math.max(this.meta.currentArc, arc.index + 1);
    this.checkUnlocks();
  }

  canStartArc(arcIndex) {
    if (arcIndex === 0) return true;
    const prevArc = getArcConfig(arcIndex - 1);
    return this.meta.arcsCompleted.includes(prevArc.id);
  }

  /**
   * Normal (non-boss) enemy-tile resolution for a given floor: a random
   * pick from THAT FLOOR'S arc bracket — not meta.currentArc. This is
   * what makes floor 10 always roll from Arc0's roster (Indebted
   * Fallen / The Hollowed) even after Arc0 has been "completed" and
   * meta.currentArc has moved on.
   */
  getRandomEnemyId(floor) {
    const arc = getArcForFloor(floor);
    const pool = getEnemiesForArc(arc.id);
    return pickRandom(pool)?.id ?? 'indebted_fallen';
  }

  getBossId(floor) {
    return getArcForFloor(floor).bossId;
  }

  /** Purely floor-based: true for ANY arc's boss floor, regardless of progress. */
  isBossFloor(floor) {
    return getArcForFloor(floor).bossFloor === floor;
  }

  meetsUnlockCondition(unlock) {
    if (!unlock) return true;
    if (unlock.dropOnly) return false;
    if (unlock.kill) {
      return (this.meta.killCounts[unlock.kill.enemyId] ?? 0) >= unlock.kill.count;
    }
    if (unlock.potionsUsed) {
      return (this.meta.totalPotionsUsed ?? 0) >= unlock.potionsUsed;
    }
    if (unlock.achievement) {
      return this.achievements?.isComplete(unlock.achievement) ?? false;
    }
    if (unlock.runKill) {
      const key = `run_${unlock.runKill.enemyId}`;
      return (this.meta.achievementFlags[key] ?? 0) >= unlock.runKill.count;
    }
    return true;
  }
}
