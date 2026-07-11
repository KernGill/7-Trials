import { getArcConfig } from '../data/arcs.js';
import { getEnemiesForArc } from '../data/enemies.js';
import { pickRandom } from '../utils/RandomUtils.js';

export class ProgressionSystem {
  constructor(gameState) {
    this.gameState = gameState;
  }

  get meta() {
    return this.gameState.meta;
  }

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

  completeArc() {
    const arc = this.getCurrentArc();
    if (!this.meta.arcsCompleted.includes(arc.id)) {
      this.meta.arcsCompleted.push(arc.id);
    }
    this.meta.currentArc += 1;
    this.checkUnlocks();
  }

  canStartArc(arcIndex) {
    if (arcIndex === 0) return true;
    const prevArc = getArcConfig(arcIndex - 1);
    return this.meta.arcsCompleted.includes(prevArc.id);
  }

  getEnemyForFloor(floor) {
    const arc = this.getCurrentArc();
    const pool = getEnemiesForArc(arc.id);
    if (floor === arc.bossFloor) return arc.bossId;
    return pickRandom(pool)?.id ?? 'indebted_fallen';
  }

  isBossFloor(floor) {
    return floor === this.getCurrentArc().bossFloor;
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
      return !!this.meta.achievementFlags[unlock.achievement];
    }
    if (unlock.runKill) {
      const key = `run_${unlock.runKill.enemyId}`;
      return (this.meta.achievementFlags[key] ?? 0) >= unlock.runKill.count;
    }
    return true;
  }
}
