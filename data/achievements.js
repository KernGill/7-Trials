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
};

export function getAchievementConfig(id) {
  return ACHIEVEMENTS[id] ?? null;
}

export function getAllAchievements() {
  return Object.values(ACHIEVEMENTS);
}
