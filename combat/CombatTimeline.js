/**
 * Extracted from CombatManager — the timeline sequence recorder. Every
 * meaningful sub-event of a synchronous combat cascade (fight-turn start, a
 * character's turn beginning, a status tick, a move landing) gets pushed
 * here instead of only surfacing as a text log line; the whole batch is
 * flushed as one `combat:sequence` array right before control visibly
 * returns to someone (player's turn, victory, defeat) — FightState replays
 * it at a human pace even though every mutation inside it already happened
 * instantly, under the hood, in order. Fully self-contained: owns its own
 * `sequence` array and only needs the `eventBus` to flush through.
 */
export class CombatTimeline {
  constructor(eventBus) {
    this.eventBus = eventBus;
    this.sequence = [];
  }

  reset() {
    this.sequence = [];
  }

  record(step) {
    this.sequence.push(step);
  }

  recordTick({ character, effectId, amount, reflected }, phase) {
    this.record({
      kind: 'statusTick',
      character,
      effectId,
      amount,
      phase,
      health: character.currentHealth,
      energy: character.energy,
      // Arcane-Split-style reflect on a status tick (see Character.
      // takeDamage/lastReflectSplit) — the other combatant's own share of
      // this same tick, so FightState.playStatusTickStep can show both
      // sides taking damage instead of only the primary target.
      reflected: reflected ? {
        character: reflected.recipient,
        amount: reflected.amount,
        health: reflected.recipient.currentHealth,
        energy: reflected.recipient.energy,
      } : null,
    });
  }

  flushSequence() {
    if (!this.sequence.length) return;
    const steps = this.sequence;
    this.sequence = [];
    this.eventBus.emit('combat:sequence', steps);
  }
}
