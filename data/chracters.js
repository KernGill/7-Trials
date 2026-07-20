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
      dex: 14,
      str: 20,
      spd: 13,
      def: 12,
      int: 25,
      critChance: 8,
      critDamage: 33,
      dodge: 100,
      accuracy: 100,
      energy: 6,
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
