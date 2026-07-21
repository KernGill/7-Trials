/**
 * Achievements — each one is either complete (true) or not (false),
 * with its own tracked progress variable toward a target. Add a new
 * entry here to gate new equipment/content; the tracking logic that
 * increments progress lives wherever the triggering event happens
 * (see AchievementSystem + the call sites that call recordProgress/
 * setComplete), not in this file — this file only defines *what*
 * counts as complete.
 */
export const ACHIEVEMENTS = {
  survive_final_rites: {
    id: 'survive_final_rites',
    name: 'Marked for Death',
    description: "Survive a run after being hit 3 times by an Indebted Fallen's Final Rites.",
    target: 3,
  },
  kill_one_skeleton: {
    id: 'kill_one_skeleton',
    name: 'Bone Breaker',
    description: 'Defeat at least one skeleton-type enemy.',
    target: 1,
  },
  kill_one_zombie: {
    id: 'kill_one_zombie',
    name: 'Rot Cleaver',
    description: 'Defeat at least one zombie-type enemy.',
    target: 1,
  },
  beat_4_indebted_fallen_in_run: {
    id: 'beat_4_indebted_fallen_in_run',
    name: 'Debt Collector',
    description: 'Beat 4 Indebted Fallen in a single run.',
    target: 4,
  },
  use_10_potions_in_run: {
    id: 'use_10_potions_in_run',
    name: 'Potion Chugger',
    description: 'Use 10 potions in a single run.',
    target: 10,
  },
  die_to_indebted_fallen_after_hollowed: {
    id: 'die_to_indebted_fallen_after_hollowed',
    name: 'Cursed Debt',
    description: 'In one run, die to an Indebted Fallen after already beating a Hollowed.',
    target: 1,
  },
  beat_both_in_one_hit_each: {
    id: 'beat_both_in_one_hit_each',
    name: "Vitalire's Wrath",
    description: 'In one run, using only Arc0 equipment, defeat a skeleton-type enemy and a zombie-type enemy each in a single hit.',
    target: 1,
  },
  beat_false_apparition_with_burn: {
    id: 'beat_false_apparition_with_burn',
    name: 'Burnt Offering',
    description: 'Defeat a False Apparition with a damage instance from the Burn status effect.',
    target: 1,
  },
  beat_ghost_with_2_frostbite: {
    id: 'beat_ghost_with_2_frostbite',
    name: 'Frozen Reckoning',
    description: 'Beat a ghost while 2 stacks of Frostbite are inflicted on you.',
    target: 1,
  },
  open_3_chests_in_run: {
    id: 'open_3_chests_in_run',
    name: 'Treasure Hunter',
    description: 'Successfully open 3 chests in a single run.',
    target: 3,
  },
  beat_all_species_one_floor: {
    id: 'beat_all_species_one_floor',
    name: 'Triple Threat',
    description: 'On one floor, defeat a skeleton, a zombie, and a ghost.',
    target: 1,
  },
  beat_zombie_after_chest_and_door: {
    id: 'beat_zombie_after_chest_and_door',
    name: 'Cleared the Room',
    description: 'Defeat a Zombie after successfully opening a chest and a locked door on the same floor.',
    target: 1,
  },
  beat_ghost_floor_5: {
    id: 'beat_ghost_floor_5',
    name: 'Fifth Floor Phantom',
    description: 'Defeat a ghost on the 5th floor.',
    target: 1,
  },
  burn_2_ghosts_with_spore_gear: {
    id: 'burn_2_ghosts_with_spore_gear',
    name: 'Spore-Born Cremation',
    description: 'While wearing a Spore Cloak and Shrouded Footsteps, burn 2 ghosts to death in one run.',
    target: 2,
  },
  beat_enemy_with_bleed: {
    id: 'beat_enemy_with_bleed',
    name: 'Death by a Thousand Cuts',
    description: "Defeat an enemy with the Bleed status effect's damage instance.",
    target: 1,
  },
  beat_enemy_with_status_while_stunned: {
    id: 'beat_enemy_with_status_while_stunned',
    name: 'Stunned Victory',
    description: 'Defeat an enemy with status damage on a fight turn you were stunned.',
    target: 1,
  },
};

export function getAchievementConfig(id) {
  return ACHIEVEMENTS[id] ?? null;
}

export function getAllAchievements() {
  return Object.values(ACHIEVEMENTS);
}
