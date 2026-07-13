/**
 * Single source of truth for which characters/enemies have a real
 * sprite image yet. Anything not listed here falls back to its plain
 * colored square (visual.color) — this is purely a display lookup, no
 * gameplay significance.
 */
export const CHARACTER_SPRITES = {
  artius: 'assets/sprites/characters/artius.png',
};

export function getCharacterSprite(characterId) {
  return CHARACTER_SPRITES[characterId] ?? null;
}
