import { Character } from './Character.js';
import { getCharacterConfig } from '../data/chracters.js';
import { getMoveTemplate } from '../data/moves.js';
import { getCardBonusStats } from '../data/cards.js';
import { MOVE_PROPERTIES } from '../utils/Constants.js';
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
      cardBonusStats: extra.cardBonusStats,
      moveIds: config.moveIds,
      visual: config.visual,
      currentHealth: extra.currentHealth,
    });

    this.characterId = characterId;
    this.initializeMoves((id) => Move.fromId(id, this));
  }

  static create(characterId, inventorySystem, currentHealth, cards = []) {
    const equipmentStats = inventorySystem.getEquippedStatTotals();
    const cardBonusStats = getCardBonusStats(cards);
    const baseMoveIds = [...new Set(getCharacterConfig(characterId).moveIds)];
    const equipmentMoveIds = inventorySystem.getEquippedMoveIds();
    const player = new Player(characterId, equipmentStats, { currentHealth, cardBonusStats });

    // Passive moves granted by equipment stack: one independently-firing
    // Move per equipped copy (2x Flesh Eater's Palm = 2 separate
    // Gluttonous Maw rolls). Active moves never stack — duplicates just
    // collapse to the one already present, same as before.
    const finalMoveIds = [...baseMoveIds];
    equipmentMoveIds.forEach((id) => {
      const isPassive = getMoveTemplate(id)?.properties?.includes(MOVE_PROPERTIES.PASSIVE);
      if (isPassive || !finalMoveIds.includes(id)) finalMoveIds.push(id);
    });

    player.moveIds = finalMoveIds;
    player.initializeMoves((id) => Move.fromId(id, player));
    return player;
  }
}
