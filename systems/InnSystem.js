import { getCharacterConfig } from '../data/chracters.js';

export class InnSystem {
  constructor(gameState) {
    this.gameState = gameState;
  }

  isUnlocked() {
    return this.gameState.meta.innUnlocked;
  }

  getCharacters() {
    return this.gameState.meta.unlockedCharacters
      .map((id) => getCharacterConfig(id))
      .filter(Boolean);
  }

  selectMainCharacter(characterId) {
    if (!this.gameState.meta.unlockedCharacters.includes(characterId)) {
      return { ok: false, reason: 'Character not unlocked.' };
    }
    this.gameState.meta.selectedCharacterId = characterId;
    return { ok: true };
  }
}
