import { getEnemyConfig } from '../data/enemies.js';

export class BestiarySystem {
  constructor(gameState) {
    this.gameState = gameState;
  }

  recordEncounter(enemy) {
    const existing = this.gameState.bestiary[enemy.enemyId];
    if (!existing) {
      this.gameState.bestiary[enemy.enemyId] = {
        id: enemy.enemyId,
        name: enemy.name,
        description: enemy.description,
        kills: 1,
        stats: { ...enemy.baseStats },
        moveIds: [...enemy.moveIds],
        firstSeenArc: this.gameState.meta.currentArc,
      };
    } else {
      existing.kills += 1;
    }
  }

  getEntries() {
    return Object.values(this.gameState.bestiary);
  }

  getEntry(enemyId) {
    return this.gameState.bestiary[enemyId] ?? null;
  }

  getEntriesForArc(arcIndex) {
    return this.getEntries().filter((entry) => entry.firstSeenArc <= arcIndex);
  }
}
