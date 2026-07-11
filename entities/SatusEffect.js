import { deepClone } from '../utils/MathUtils.js';
import { STATUS_EFFECTS } from '../data/statusEffectConfig.js';

export class StatusEffect {
  constructor(config) {
    this.id = config.id;
    this.stacks = config.stacks ?? 1;
    this.durationFightTurns = config.durationFightTurns ?? -1;
    this.durationCharacterTurns = config.durationCharacterTurns ?? -1;
    this.meta = config.meta ?? {};
  }

  static fromType(effectId, stacks = 1, extra = {}) {
    const template = STATUS_EFFECTS[effectId];
    if (!template) return null;
    return new StatusEffect({
      id: effectId,
      stacks,
      durationFightTurns: extra.durationFightTurns ?? template.durationFightTurns ?? -1,
      durationCharacterTurns: extra.durationCharacterTurns ?? -1,
      meta: deepClone(extra.meta ?? {}),
    });
  }

  clone() {
    return new StatusEffect({
      id: this.id,
      stacks: this.stacks,
      durationFightTurns: this.durationFightTurns,
      durationCharacterTurns: this.durationCharacterTurns,
      meta: deepClone(this.meta),
    });
  }
}
