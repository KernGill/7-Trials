/**
 * Shared config for every hidden/secret superboss — Vanguard of Darkness
 * (floor 5, arc0's first) plus the 3 added alongside it. Every place that
 * used to hardcode 'vanguard_of_darkness' / `floor === 5` (DungeonGenerator's
 * hallway placement, ExploreState's gate unlock + hidden-tile trigger,
 * StateManager's achievement/defeated-flag/enemiesRemaining bookkeeping,
 * DungeonRenderer3D's wall-darkening effect, arc0's Bestiary secretBossIds)
 * looks an entry up here instead, so adding a 5th boss later never means
 * hunting down N near-duplicate special cases again.
 *
 * Order encodes the intended unlock chain via `requiresDefeatedFlag`:
 * Vanguard (floor 5, no prerequisite) -> Warrior (floor 1, requires
 * Vanguard) -> Herald (floor 8, requires Warrior) -> The Abyss' Old Hero
 * (floor 10, requires Herald, and is arc0's true final boss — see
 * StateManager.onCombatVictory's floor-10 suppression logic). A boss's own
 * hidden hallway/gate still generates unconditionally on its floor exactly
 * like Vanguard's always has; `requiresDefeatedFlag` only ever gates
 * whether ExploreState.checkHiddenGateUnlock is willing to open ITS gate,
 * on top of that floor's own normal "fully cleared" requirement.
 */
export const HIDDEN_BOSSES = [
  {
    id: 'vanguard_of_darkness',
    floor: 5,
    achievementId: 'defeat_vanguard_of_darkness',
    defeatedFlag: 'vanguardDefeated',
    requiresDefeatedFlag: null,
  },
  {
    id: 'warrior_of_darkness',
    floor: 1,
    achievementId: 'defeat_warrior_of_darkness',
    defeatedFlag: 'warriorDefeated',
    requiresDefeatedFlag: 'vanguardDefeated',
  },
  {
    id: 'herald_of_the_dark',
    floor: 8,
    achievementId: 'defeat_herald_of_the_dark',
    defeatedFlag: 'heraldDefeated',
    requiresDefeatedFlag: 'warriorDefeated',
  },
  {
    id: 'abyss_old_hero',
    floor: 10,
    achievementId: 'defeat_abyss_old_hero',
    defeatedFlag: 'abyssOldHeroDefeated',
    requiresDefeatedFlag: 'heraldDefeated',
  },
];

export function getHiddenBossForFloor(floor) {
  return HIDDEN_BOSSES.find((b) => b.floor === floor) ?? null;
}

export function getHiddenBossById(enemyId) {
  return HIDDEN_BOSSES.find((b) => b.id === enemyId) ?? null;
}
