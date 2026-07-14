/**
 * Single source of truth for which characters/enemies have a real
 * sprite image yet. Anything not listed here falls back to its plain
 * colored square (visual.color) — this is purely a display lookup, no
 * gameplay significance.
 */
export const CHARACTER_SPRITES = {
  artius: 'assets/sprites/characters/artius.png',
};

export const ENEMY_SPRITES = {
  indebted_fallen: 'assets/sprites/enemies/indebted_fallen.png',
};

/** Decorative frame drawn over every combatant's avatar box, sprite or not. */
export const CHARACTER_BORDER = 'assets/sprites/borders/character_border.png';

export function getCharacterSprite(characterId) {
  return CHARACTER_SPRITES[characterId] ?? null;
}

export function getEnemySprite(enemyId) {
  return ENEMY_SPRITES[enemyId] ?? null;
}
