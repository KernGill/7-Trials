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
};

export function getAchievementConfig(id) {
  return ACHIEVEMENTS[id] ?? null;
}

export function getAllAchievements() {
  return Object.values(ACHIEVEMENTS);
}
