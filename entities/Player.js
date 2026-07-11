import { Character } from './Character.js';
import { getCharacterConfig } from '../data/chracters.js';
import { Move } from './Move.js';

export class Player extends Character {
  constructor(characterId, equipmentStats = {}, extra = {}) {
    const config = getCharacterConfig(characterId);
    if (!config) throw new Error(`Unknown character: ${characterId}`);

    super({
      ...config,
      id: config.id,
      name: config.name,
      isPlayer: true,
      equipmentStats,
      moveIds: config.moveIds,
      visual: config.visual,
      currentHealth: extra.currentHealth,
    });

    this.characterId = characterId;
    this.initializeMoves((id) => Move.fromId(id, this));
  }

  static create(characterId, inventorySystem, currentHealth) {
    const equipmentStats = inventorySystem.getEquippedStatTotals();
    const moveIds = [...getCharacterConfig(characterId).moveIds];
    const equipmentMoves = inventorySystem.getEquippedMoveIds();
    const player = new Player(characterId, equipmentStats, { currentHealth });
    player.moveIds = [...new Set([...moveIds, ...equipmentMoves])];
    player.initializeMoves((id) => Move.fromId(id, player));
    return player;
  }
}
