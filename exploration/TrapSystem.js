import { rollChance } from '../utils/MathUtils.js';
import { LOCKED_ROOM_SUCCESS_BASE, LOCKED_ROOM_GOLD_REWARD } from '../utils/Constants.js';

/**
 * Locked Room resolution per design doc: 75% + 0.25*Dex chance to
 * succeed. Success grants flat gold, failure does nothing (no risk).
 */
export class TrapSystem {
  attemptLockedRoom(dexterity) {
    const chance = Math.min(99, LOCKED_ROOM_SUCCESS_BASE + 0.25 * dexterity);
    const success = rollChance(chance);
    return { success, chance, reward: success ? { type: 'gold', amount: LOCKED_ROOM_GOLD_REWARD } : null };
  }
}
