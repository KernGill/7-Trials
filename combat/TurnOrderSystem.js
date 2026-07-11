import { SPEED_LOSS_RATIO } from '../utils/Constants.js';
import { roundUp } from '../utils/MathUtils.js';

export class TurnOrderSystem {
  constructor() {
    this.fightTurn = 1;
    this.characterTurnIndex = 0;
  }

  reset() {
    this.fightTurn = 1;
    this.characterTurnIndex = 0;
  }

  getNextActor(combatants) {
    const alive = combatants.filter((c) => c.isAlive());
    if (!alive.length) return null;

    const sorted = [...alive].sort((a, b) => {
      if (b.battleSpeed !== a.battleSpeed) return b.battleSpeed - a.battleSpeed;
      return a.isPlayer ? -1 : 1;
    });
    return sorted[0];
  }

  allHaveMoved(combatants) {
    return combatants.filter((c) => c.isAlive()).every((c) => c.hasMoved);
  }

  beginFightTurn(combatants) {
    combatants.forEach((c) => {
      c.hasMoved = false;
      if (c.skippedThisFightTurn) {
        c.battleSpeed = c.storedSpeed;
        c.skippedThisFightTurn = false;
        c.storedSpeed = 0;
      }
    });
  }

  endFightTurn(combatants) {
    combatants.forEach((c) => {
      if (c.isAlive()) {
        c.battleSpeed += c.getStat('spd');
      }
    });
    this.fightTurn += 1;
  }

  onCharacterTurnStart(actor) {
    if (actor.isStunned()) {
      actor.storedSpeed = actor.battleSpeed;
      actor.battleSpeed = 0;
      actor.skippedThisFightTurn = true;
      actor.hasMoved = true;
      const stun = actor.statusEffects.find((e) => e.id === 'stun');
      if (stun) {
        stun.stacks -= 1;
        if (stun.stacks <= 0) actor.removeStatusEffect('stun');
      }
      return { skipped: true };
    }
    return { skipped: false };
  }

  onCharacterTurnEnd(actor) {
    actor.hasMoved = true;
    const loss = roundUp(actor.battleSpeed * SPEED_LOSS_RATIO);
    actor.battleSpeed = Math.max(0, actor.battleSpeed - loss);
  }
}
