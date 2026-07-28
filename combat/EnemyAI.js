import { pickRandom } from '../utils/RandomUtils.js';
import { MOVE_PROPERTIES } from '../utils/Constants.js';

/** Passive moves only ever fire via CombatManager.triggerPassives (trigger-based, e.g. every fight_turn_start) — never as something the AI actively picks for its own character turn. */
function isActiveMove(move) {
  return !move.properties.includes(MOVE_PROPERTIES.PASSIVE);
}

export class EnemyAI {
  constructor() {
    this.lockedMoveId = null;
    this.lockedTurnsRemaining = 0;
  }

  reset() {
    this.lockedMoveId = null;
    this.lockedTurnsRemaining = 0;
  }

  chooseMove(enemy, player) {
    // usePriorityAsOpeningMove (Extreme Ignition): guaranteed as this
    // character's very first move of the fight, checked before the
    // health-threshold priority below — see Character.hasActedInCombat,
    // set the instant any move actually executes, so this can never fire
    // a second time. Energy is topped up (not granted for free — only up
    // to exactly what the move costs) rather than gating on
    // isAvailable(), since a fresh combatant starts every fight at 0
    // energy and only gains a little per turn: without this, "always the
    // opening move" would silently fail to fire on any move pricier than
    // whatever the first turn-start energy roll happens to grant.
    if (!enemy.hasActedInCombat) {
      const opener = enemy.moves.find((m) => isActiveMove(m) && m.template.usePriorityAsOpeningMove);
      if (opener && !opener.isOnCooldown()) {
        if (enemy.energy < opener.energyCost) enemy.energy = opener.energyCost;
        return opener;
      }
    }

    // usePriorityWhenAvailable (Abyssal Cascade): whenever this move is
    // off cooldown, it's always the first choice — not just one option
    // in the random pool, which could otherwise go many turns without
    // ever actually getting picked. If off cooldown but not yet
    // affordable, restrict this turn to free (0-cost) moves only so
    // energy accumulates toward it instead of getting spent on something
    // else — mirrors the existing lockMove energy-saving behavior below,
    // just proactive instead of reactive.
    const priorityWhenAvailable = enemy.moves.find((m) => isActiveMove(m) && m.template.usePriorityWhenAvailable && !m.isOnCooldown());
    if (priorityWhenAvailable) {
      if (priorityWhenAvailable.canAfford(enemy.energy)) return priorityWhenAvailable;
      const freeMoves = enemy.moves.filter(
        (m) => isActiveMove(m) && m.isAvailable(enemy.energy) && m.energyCost === 0 && !m.isOnCooldown() && !m.template.usePriorityBelowHealthPercent
          && (!m.template.requiresRevived || enemy.hasRevived),
      );
      return freeMoves.length ? pickRandom(freeMoves) : null;
    }

    // Each priority move carries its OWN threshold (final_rites: 10%,
    // Erratic Combustion: 50%) rather than one shared cutoff — checked
    // per-move so different enemies' priority specials can trigger at
    // different health percentages.
    const healthPercent = (enemy.currentHealth / enemy.getMaxHealth()) * 100;
    const priority = enemy.moves.find((m) => isActiveMove(m)
      && m.template.usePriorityBelowHealthPercent
      && healthPercent <= m.template.usePriorityBelowHealthPercent);
    if (priority?.isAvailable(enemy.energy)) return priority;

    if (this.lockedMoveId && this.lockedTurnsRemaining > 0) {
      const locked = enemy.moves.find((m) => m.id === this.lockedMoveId);
      if (locked && !locked.isOnCooldown() && locked.canAfford(enemy.energy)) {
        return locked;
      }
      const freeMoves = enemy.moves.filter(
        (m) => isActiveMove(m) && m.isAvailable(enemy.energy) && m.energyCost === 0 && !m.isOnCooldown() && !m.template.usePriorityBelowHealthPercent
          && (!m.template.requiresRevived || enemy.hasRevived),
      );
      if (freeMoves.length) return pickRandom(freeMoves);
      return null;
    }

    const available = enemy.moves.filter(
      (m) => isActiveMove(m) && m.isAvailable(enemy.energy) && !m.isOnCooldown() && !m.template.usePriorityBelowHealthPercent
        && (!m.template.requiresRevived || enemy.hasRevived),
    );
    if (!available.length) return null;

    const chosen = pickRandom(available);
    if (chosen.energyCost > enemy.energy) {
      this.lockMove(chosen.id, 3);
      const freeMoves = enemy.moves.filter(
        (m) => isActiveMove(m) && m.isAvailable(enemy.energy) && m.energyCost === 0 && !m.template.usePriorityBelowHealthPercent
          && (!m.template.requiresRevived || enemy.hasRevived),
      );
      return freeMoves.length ? pickRandom(freeMoves) : null;
    }

    if (chosen.energyCost > 0 && chosen.energyCost > enemy.energy * 0.5) {
      this.lockMove(chosen.id, 3);
    }

    return chosen;
  }

  lockMove(moveId, turns) {
    this.lockedMoveId = moveId;
    this.lockedTurnsRemaining = turns;
  }

  onTurnEnd() {
    if (this.lockedTurnsRemaining > 0) {
      this.lockedTurnsRemaining -= 1;
      if (this.lockedTurnsRemaining <= 0) this.lockedMoveId = null;
    }
  }

  chooseTarget(party) {
    const alive = party.filter((m) => m.isAlive());
    return pickRandom(alive);
  }
}
