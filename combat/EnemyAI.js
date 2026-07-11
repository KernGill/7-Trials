import { pickRandom } from '../utils/RandomUtils.js';

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
    if (enemy.currentHealth / enemy.getMaxHealth() <= 0.1) {
      const priority = enemy.moves.find((m) => m.template.usePriorityBelowHealthPercent);
      if (priority?.isAvailable(enemy.energy)) return priority;
    }

    if (this.lockedMoveId && this.lockedTurnsRemaining > 0) {
      const locked = enemy.moves.find((m) => m.id === this.lockedMoveId);
      if (locked && !locked.isOnCooldown() && locked.canAfford(enemy.energy)) {
        return locked;
      }
      const freeMoves = enemy.moves.filter(
        (m) => m.isAvailable(enemy.energy) && m.energyCost === 0 && !m.isOnCooldown(),
      );
      if (freeMoves.length) return pickRandom(freeMoves);
      return null;
    }

    const available = enemy.moves.filter((m) => m.isAvailable(enemy.energy) && !m.isOnCooldown());
    if (!available.length) return null;

    const chosen = pickRandom(available);
    if (chosen.energyCost > enemy.energy) {
      this.lockMove(chosen.id, 3);
      const freeMoves = enemy.moves.filter(
        (m) => m.isAvailable(enemy.energy) && m.energyCost === 0,
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
