import { MOVE_TEMPLATES } from './moves.js';

export const CHARACTERS = {
  artius: {
    id: 'artius',
    name: 'Artius',
    description: 'Challenger of the 7 Trials.',
    lore: 'Challenger of the 7 Trials',
    arcs: ['arc0', 'arc1', 'arc2'],
    visual: {
      shape: 'square',
      width: 48,
      height: 48,
      color: '#d4a574',
      label: 'Artius',
      spriteId: 'artius',
    },
    baseStats: {
      con: 600,
      dex: 13,
      str: 13,
      spd: 12,
      def: 10,
      int: 12,
      critChance: 9,
      critDamage: 10,
    },
    moveIds: [
      'challengers_mettle',
      'golden_calling',
      'strike',
      'stance_shatter',
      'deliberate_blow',
      'ignite',
      'guard',
      'minor_heal',
      'arcane_split',
    ],
    unlockedByDefault: true,
    unlockArc: 'arc0',
  },
};

export function getCharacterConfig(id) {
  return CHARACTERS[id] ?? null;
}

export function getCharacterMoveIds(characterId) {
  return CHARACTERS[characterId]?.moveIds ?? [];
}
