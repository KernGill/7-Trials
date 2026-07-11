import { Character } from './Character.js';
import { getEnemyConfig } from '../data/enemies.js';
import { Move } from './Move.js';

export class Enemy extends Character {
  constructor(enemyId, modifiers = {}) {
    const config = getEnemyConfig(enemyId);
    if (!config) throw new Error(`Unknown enemy: ${enemyId}`);

    const scaledStats = { ...config.baseStats };
    Object.entries(modifiers.statMultipliers ?? {}).forEach(([stat, mult]) => {
      if (scaledStats[stat] !== undefined) {
        scaledStats[stat] = Math.round(scaledStats[stat] * mult);
      }
    });

    super({
      ...config,
      id: config.id,
      name: config.name,
      isEnemy: true,
      baseStats: scaledStats,
      moveIds: config.moveIds,
      visual: config.visual,
    });

    this.enemyId = enemyId;
    this.description = config.description;
    this.drops = config.drops ?? {};
    this.isBoss = config.isBoss ?? false;
    this.lockedMoveId = null;
    this.initializeMoves((id) => Move.fromId(id, this));
  }
}
