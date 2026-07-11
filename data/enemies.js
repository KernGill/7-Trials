import { MOVE_TEMPLATES } from './moves.js';

export const ENEMIES = {
  indebted_fallen: {
    id: 'indebted_fallen',
    name: 'Indebted Fallen',
    description: 'Corpses of the fallen who owed a great debt to the Great Witch of Boons.',
    arcs: ['arc0'],
    visual: {
      shape: 'square',
      width: 44,
      height: 44,
      color: '#bdc3c7',
      label: 'IF',
      spriteId: 'indebted_fallen',
    },
    baseStats: {
      con: 150,
      dex: 7,
      str: 12,
      spd: 8,
      def: 26,
      int: 0,
      critChance: 4,
      critDamage: 43,
    },
    moveIds: [
      'shard_stab',
      'bone_zone',
      'undead_fury',
      'bone_barrier',
      'hollow_stance',
      'final_rites',
    ],
    drops: {
      materials: [
        { id: 'bones', chance: 100, quantity: [3, 5] },
        { id: 'mana_stone', chance: 50, quantity: [1, 1] },
      ],
      items: [
        { id: 'bone_sword', chance: 10, quantity: [1, 1] },
        { id: 'skull_helmet', chance: 10, quantity: [1, 1] },
      ],
    },
  },
  indebted_fallen_boss: {
    id: 'indebted_fallen_boss',
    name: 'Indebted Fallen — Warden',
    description: 'A towering skeleton bound by ancient debt.',
    arcs: ['arc0'],
    isBoss: true,
    visual: {
      shape: 'square',
      width: 64,
      height: 64,
      color: '#95a5a6',
      label: 'BOSS',
      spriteId: 'indebted_fallen_boss',
    },
    baseStats: {
      con: 400,
      dex: 10,
      str: 18,
      spd: 12,
      def: 30,
      int: 0,
      critChance: 6,
      critDamage: 50,
    },
    moveIds: [
      'shard_stab',
      'bone_zone',
      'undead_fury',
      'bone_barrier',
      'hollow_stance',
      'final_rites',
    ],
    drops: {
      materials: [
        { id: 'bones', chance: 100, quantity: [8, 12] },
        { id: 'mana_stone', chance: 100, quantity: [2, 3] },
      ],
      items: [
        { id: 'bone_sword', chance: 50, quantity: [1, 1] },
        { id: 'skull_helmet', chance: 50, quantity: [1, 1] },
      ],
    },
  },
  the_hollowed: {
    id: 'the_hollowed',
    name: 'The Hollowed',
    description: 'Corpses without a will, controlled by fungal disease.',
    arcs: ['arc0', 'arc1'],
    visual: {
      shape: 'square',
      width: 44,
      height: 44,
      color: '#6ab04c',
      label: 'TH',
      spriteId: 'the_hollowed',
    },
    baseStats: {
      con: 220,
      dex: 10,
      str: 9,
      spd: 10,
      def: 5,
      int: 0,
      critChance: 5,
      critDamage: 54,
    },
    moveIds: [
      'spore_assault',
      'pocket_flesh',
      'necro_claw',
      'virulent_tear',
      'tomb_ward',
      'rotten_bulwark',
    ],
    drops: {
      materials: [
        { id: 'flesh', chance: 100, quantity: [2, 4] },
      ],
      items: [
        { id: 'minor_potion', chance: 20, quantity: [1, 1], isConsumable: true },
        { id: 'ragged_shirt', chance: 10, quantity: [1, 1] },
      ],
    },
  },
};

export function getEnemyConfig(id) {
  return ENEMIES[id] ?? null;
}

export function getEnemiesForArc(arcId) {
  return Object.values(ENEMIES).filter(
    (enemy) => enemy.arcs.includes(arcId) && !enemy.isBoss,
  );
}
