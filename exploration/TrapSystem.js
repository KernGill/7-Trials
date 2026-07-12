import { rollChance, randomInt } from '../utils/MathUtils.js';
import {
  LOCKED_ROOM_SUCCESS_BASE, LOCKED_ROOM_GOLD_REWARD,
  CHEST_SUCCESS_BASE, CHEST_TRAP_DAMAGE,
} from '../utils/Constants.js';

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

  /**
   * Chest resolution: 50% + 0.25*Dex chance to succeed. Failure deals
   * flat damage but can never reduce the party below 1 HP. Success
   * grants a random material from the current arc's pool.
   */
  attemptChest(dexterity, materialPool = []) {
    const chance = Math.min(99, CHEST_SUCCESS_BASE + 0.25 * dexterity);
    const success = rollChance(chance);
    if (success) {
      const materialId = materialPool[randomInt(0, Math.max(0, materialPool.length - 1))];
      return { success, chance, reward: materialId ? { type: 'material', id: materialId, amount: randomInt(2, 4) } : null, damage: 0 };
    }
    return { success, chance, reward: null, damage: CHEST_TRAP_DAMAGE };
  }
}
