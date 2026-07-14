import { MOVE_TEMPLATES } from './moves.js';

export const ENEMIES = {
  indebted_fallen: {
    id: 'indebted_fallen',
    species: 'skeleton',
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
      con: 325,
      dex: 14,
      str: 24,
      spd: 55,
      def: 52,
      int: 0,
      critChance: 4,
      critDamage: 0,
      dodge: 100,
      accuracy: 100,
      energy: 6,
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
    species: 'skeleton',
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
      con: 2000,
      dex: 300,
      str: 36,
      spd: 300,
      def: 60,
      int: 0,
      critChance: 6,
      critDamage: 50,
      dodge: 100,
      accuracy: 100,
      energy: 10,
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
        { id: 'bones', chance: 100, quantity: [13, 19] },
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
    species: 'zombie',
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
      con: 395,
      dex: 20,
      str: 18,
      spd: 70,
      def: 10,
      int: 0,
      critChance: 5,
      critDamage: 60,
      dodge: 100,
      accuracy: 100,
      energy: 6,
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
