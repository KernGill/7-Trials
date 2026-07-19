import { getEnemyConfig } from '../data/enemies.js';

export class BestiarySystem {
  constructor(gameState) {
    this.gameState = gameState;
  }

  /**
   * name/description/stats/moveIds are refreshed from the current enemy
   * config on *every* encounter, not just the first — otherwise a
   * balance patch (stat tweaks, a reworked moveset) would leave anyone
   * who'd already recorded that enemy staring at stale numbers forever.
   * Only `kills` and `firstSeenArc` are genuinely one-way history, so
   * those are the only fields actually preserved across encounters.
   */
  recordEncounter(enemy) {
    const existing = this.gameState.bestiary[enemy.enemyId];
    this.gameState.bestiary[enemy.enemyId] = {
      id: enemy.enemyId,
      name: enemy.name,
      description: enemy.description,
      kills: (existing?.kills ?? 0) + 1,
      stats: { ...enemy.baseStats },
      moveIds: [...enemy.moveIds],
      firstSeenArc: existing?.firstSeenArc ?? this.gameState.meta.currentArc,
    };
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
