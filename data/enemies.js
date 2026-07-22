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
      con: 250,
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
      dex: 80,
      str: 10,
      spd: 200,
      def: 65,
      int: 0,
      critChance: 0,
      critDamage: 0,
      dodge: 100,
      accuracy: 100,
      energy: 12,
    },
    moveIds: [
      'shard_stab',
      'bone_zone',
      'undead_fury',
      'bone_barrier',
      'hollow_stance',
      'final_rites',
      'bone_shards',
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
      spd: 10,
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
  torch_eater: {
    id: 'torch_eater',
    species: 'plant',
    name: 'Torch Eater',
    description: 'Parties of adventurers wiped out in the dark. "But what of the torchbearers?" one might ask. Their flames now lead to death instead of victory.',
    arcs: ['arc0', 'arc1', 'arc2'],
    visual: {
      shape: 'square',
      width: 44,
      height: 44,
      color: '#e74c3c',
      label: 'TE',
      spriteId: 'torch_eater',
    },
    baseStats: {
      con: 150,
      dex: 10,
      str: 10,
      spd: 100,
      def: 150,
      int: 10,
      critChance: 5,
      critDamage: 0,
      dodge: 100,
      accuracy: 100,
      energy: 6,
    },
    moveIds: [
      'burning_will',
      'extreme_ignition',
      'vine_trap',
      'flame_guard',
      'erratic_combustion',
      'ash_eater',
    ],
    drops: {
      materials: [
        { id: 'vines', chance: 100, quantity: [1, 2] },
        { id: 'ashes', chance: 10, quantity: [3, 3] },
      ],
      items: [
        { id: 'torch', chance: 5, quantity: [1, 1] },
      ],
    },
  },
  false_apparition: {
    id: 'false_apparition',
    species: 'ghost',
    name: 'False Apparition',
    description: 'Fungi extract the memories of people from their infected corpses to create an embodiment of spores. Almost like a lure, an imitation of the damned spirits; calling out to the living. A lure to bait the clueless challengers.',
    arcs: ['arc0', 'arc1'],
    visual: {
      shape: 'square',
      width: 44,
      height: 44,
      color: '#a29bfe',
      label: 'FA',
      spriteId: 'false_apparition',
    },
    baseStats: {
      con: 250,
      dex: 12,
      str: 0,
      spd: 19,
      def: 0,
      int: 20,
      critChance: 5,
      critDamage: 20,
      dodge: 100,
      accuracy: 100,
      energy: 6,
    },
    moveIds: [
      'echo_memory',
      'consume_memory',
      'ethereal_form',
      'flashback',
      'mind_erosion',
      'formless',
    ],
    drops: {
      materials: [
        { id: 'jar_of_spores', chance: 35, quantity: [1, 2] },
        { id: 'memory_fragment', chance: 1, quantity: [1, 1] },
      ],
      items: [
        { id: 'shrouded_footsteps', chance: 15, quantity: [1, 1] },
      ],
    },
  },
};

export function getEnemyConfig(id) {
  return ENEMIES[id] ?? null;
}

export function getAllEnemies() {
  return Object.values(ENEMIES);
}

export function getEnemiesForArc(arcId) {
  return Object.values(ENEMIES).filter(
    (enemy) => enemy.arcs.includes(arcId) && !enemy.isBoss,
  );
}
