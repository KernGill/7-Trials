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
      def: 5,
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
      def: 5,
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
      def: 0,
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
      def: 25,
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
      'cinder_skin',
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
      'icy_ward',
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
  // Hidden superboss — never listed in any arc's enemyPool, only ever
  // spawned directly by id from the floor-5 secret arena's HIDDEN_ENEMY
  // tile (see ExploreState/DungeonGenerator). Always fought at its exact
  // hand-authored stats — StateManager.startCombat is called with
  // { noScale: true } for this fight, bypassing the normal per-floor
  // stat multiplier.
  vanguard_of_darkness: {
    id: 'vanguard_of_darkness',
    species: 'vanguard',
    name: 'Vanguard of Darkness',
    description: 'A guardian bound to a forgotten arena, waiting in the dark for someone curious enough to find it.',
    arcs: ['arc0'],
    isBoss: true,
    visual: {
      shape: 'square',
      width: 64,
      height: 64,
      color: '#1a1730',
      label: 'VANGUARD',
      spriteId: 'vanguard_of_darkness',
    },
    baseStats: {
      con: 5000,
      dex: 0,
      str: 0,
      spd: 300,
      def: 100,
      int: 50,
      critChance: 20,
      critDamage: 100,
      dodge: 100,
      accuracy: 100,
      energy: 20,
    },
    moveIds: [
      'vanguard_dark_strike',
      'vanguard_crippling_shadow',
      'vanguard_frostbite_touch',
      'vanguard_abyssal_cascade',
      'vanguard_umbral_ward',
      'vanguard_dread_grasp',
      'vanguard_shroud_of_malice',
      'vanguard_revival',
      'vanguard_umbral_purge',
      'vanguard_wearing_darkness',
      'vanguard_dark_empowerment',
    ],
    drops: {
      itemPool: ['void_reaver_glaive', 'umbral_striders', 'eclipse_signet'],
    },
  },
  // Hidden superboss — floor 1, first link in the secret chain (see
  // data/hiddenBosses.js). Its own hidden gate additionally requires
  // vanguardDefeated on top of floor 1 being fully cleared — see
  // ExploreState.checkHiddenGateUnlock. Same never-in-any-enemyPool,
  // always-{noScale:true} convention as Vanguard.
  warrior_of_darkness: {
    id: 'warrior_of_darkness',
    species: 'warrior',
    name: 'Warrior of Darkness',
    description: 'The first and rawest of the dark guardians — no arena tricks, just relentless aggression.',
    arcs: ['arc0'],
    isBoss: true,
    visual: {
      shape: 'square',
      width: 64,
      height: 64,
      color: '#2b1414',
      label: 'WARRIOR',
      spriteId: 'warrior_of_darkness',
    },
    baseStats: {
      con: 2200,
      dex: 20,
      str: 60,
      spd: 150,
      def: 40,
      int: 0,
      critChance: 15,
      critDamage: 60,
      dodge: 100,
      accuracy: 100,
      energy: 14,
    },
    moveIds: [
      'warrior_reckless_slash',
      'warrior_savage_momentum',
      'warrior_bloodfrenzy_cleave',
      'warrior_unbroken_rage',
      'warrior_warpath_roar',
      'warrior_death_throes',
      'warrior_final_stand',
    ],
    drops: {
      itemPool: ['wraithsteel_warblade', 'berserkers_warwraps'],
    },
  },
  // Hidden superboss — floor 8, second link in the secret chain. Its gate
  // additionally requires warriorDefeated.
  herald_of_the_dark: {
    id: 'herald_of_the_dark',
    species: 'herald',
    name: 'Herald of the Dark',
    description: 'A caster bound to announce the abyss\' arrival — every curse it speaks lingers.',
    arcs: ['arc0'],
    isBoss: true,
    visual: {
      shape: 'square',
      width: 64,
      height: 64,
      color: '#1a1436',
      label: 'HERALD',
      spriteId: 'herald_of_the_dark',
    },
    baseStats: {
      con: 3200,
      dex: 10,
      str: 0,
      spd: 220,
      def: 60,
      int: 90,
      critChance: 15,
      critDamage: 70,
      dodge: 100,
      accuracy: 100,
      energy: 18,
    },
    moveIds: [
      'herald_abyssal_bolt',
      'herald_curse_sermon',
      'herald_withering_gaze',
      'herald_voice_of_the_abyss',
      'herald_shroud_ward',
      'herald_pronouncement_of_doom',
      'herald_dread_choir',
      'herald_last_rites',
      'herald_sermons_end',
    ],
    drops: {
      itemPool: ['voidcall_scepter', 'heralds_vestments', 'doomcallers_circlet'],
    },
  },
  // Hidden superboss — floor 10, arc0's TRUE final boss (see
  // StateManager.onCombatVictory's floor-10 suppression logic and
  // data/hiddenBosses.js). Its gate additionally requires heraldDefeated;
  // beating this one — not the ordinary floor-10 boss — is what completes
  // arc0 once that prerequisite is met.
  abyss_old_hero: {
    id: 'abyss_old_hero',
    species: 'ancient_hero',
    name: "The Abyss' Old Hero",
    description: 'A legendary guardian, lost to the abyss long before this dungeon had a name.',
    arcs: ['arc0'],
    isBoss: true,
    visual: {
      shape: 'square',
      width: 64,
      height: 64,
      color: '#0d0d1f',
      label: 'OLD HERO',
      spriteId: 'abyss_old_hero',
    },
    baseStats: {
      con: 6500,
      dex: 20,
      str: 40,
      spd: 260,
      def: 120,
      int: 70,
      critChance: 25,
      critDamage: 110,
      dodge: 100,
      accuracy: 100,
      energy: 24,
    },
    moveIds: [
      'abyss_guardian_strike',
      'abyss_fallen_oath',
      'abyss_corrupted_vow',
      'abyss_abyssal_judgment',
      'abyss_heros_bulwark',
      'abyss_oathbreakers_snare',
      'abyss_radiant_ruin',
      'abyss_undying_vow',
      'abyss_last_light',
      'abyss_legends_weight',
      'abyss_echo_of_the_abyss',
    ],
    drops: {
      itemPool: ['oathkeepers_greatblade', 'ancient_guardians_plate', 'ring_of_the_fallen_hero', 'crown_of_the_abyssal_hero'],
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
