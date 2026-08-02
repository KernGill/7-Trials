import { GAME_STATES } from '../utils/Constants.js';
import { t } from '../ui/i18n.js';

/**
 * Static reference data for the six QTE mechanics (see
 * states/ExploreState.js's QTE_TYPES/build*QTE methods, which this
 * mirrors) — floor-1/5/9 knob values are pre-computed here rather than
 * imported live, since ExploreState's constants aren't exported and this
 * screen is pure documentation, not a live read of game state.
 */
const QTE_TYPE_CARDS = [
  {
    id: 'arrow', color: '#4d84ef', name: 'Arrow', usedBy: 'Treasure only',
    baseTime: '5s', knobLabel: 'Arrows in sequence', floorValues: '8 → 12 → 16',
    note: 'One wrong press = instant fail. WASD/arrow keys only.',
  },
  {
    id: 'timing', color: '#9a7ce0', name: 'Timing', usedBy: 'Locked Door only',
    baseTime: '6s', knobLabel: 'Hits needed / zone width', floorValues: '3 hits, 26% → 5 hits, 17% → 7 hits, 8%',
    note: 'Marker sweeps every 1.1s, always, inside a flat 6s timer — more hits packed into a shrinking window is what makes late floors brutal. Miss the zone once, or time out, and it fails. Space only.',
  },
  {
    id: 'combo', color: '#f39c12', name: 'Arrow+Timing Combo', usedBy: 'Temporal Chest only',
    baseTime: '8s, flat', knobLabel: 'Arrow count, AND Timing rounds/zone — both live at once', floorValues: '12 arrows + 5 hits (26%) → 18 arrows + 8 hits (17%) → 24 arrows + 11 hits (8%)',
    note: "The highest-risk, highest-reward QTE in the game — Temporal Chest's payout is 9× a regular chest's. The arrow strip (WASD/arrow keys) and the timing bar underneath it (Space) both run AT THE SAME TIME, sharing one 8s timer; a miss on EITHER half fails the whole attempt instantly, and BOTH halves have to finish before time runs out to succeed. Both halves scale 1.5× harder than their standalone Treasure/Locked-Door counterparts. Thief's Ring/Sleeves/Goggles apply their arrow-count and timing-rounds effects to both halves at once; Lockpick's bonus second and Skeleton's free retry apply to the whole combo session, not either half individually.",
  },
  {
    id: 'hold', color: '#b370c9', name: 'Hold', usedBy: 'Sealed Shrine',
    baseTime: '5s, fixed', knobLabel: 'Slit width (win zone)', floorValues: '11% → 7% → 5%',
    note: 'The hardest QTE in the game, by design — Sealed Shrine drops a card. No early win — checked only the instant the timer hits 0. But there IS an early fail: a kill bar tracks cumulative time spent outside the slit and ends the attempt the moment that crosses 65% of the timer — losing this way costs 50 flat damage, since you were nowhere close. Losing to the ordinary timeout instead (holding position right up to the final instant, just not quite in the zone) costs a much steeper 200 — the closer you got, the worse the backlash. Fill/drain are twitchy: 68%/s held, 44%/s released. The slit is tiny and drifts erratically — random speed (20–55%-of-track/sec base) AND direction, re-rolled every 0.12–0.35s, always bouncing at the ends. Dex narrows that random speed range instead of widening the slit or adding time: −3%/sec per 50 DEX, floors at 6–14%/sec.',
  },
  {
    id: 'memory', color: '#2fd9c4', name: 'Memory', usedBy: 'Arcane Sigil',
    baseTime: '8s (input only)', knobLabel: 'Sequence length / reveal speed', floorValues: '5 @860ms → 8 @700ms → 10 @540ms',
    note: 'Timer is frozen during playback — only counts once you start answering. Sequence length is the dominant difficulty knob — by floor 9 you\'re memorizing 10 random directions flashed under a second apart.',
  },
  {
    id: 'mash', color: '#e0584a', name: 'Mash', usedBy: 'Wounded Animal (70% branch)',
    baseTime: '5s', knobLabel: 'Fill % per press', floorValues: '8.35% → 5.75% → 3.15%',
    note: '≈12 presses at floor 1 vs. ≈32 at floor 9, and the passive decay while not pressing gets harsher per floor too (12%/s → 21%/s by floor 9), so hesitating costs more late-game. A separate stamina bar drains on its own clock — pressing while it\'s red/empty is an instant fail — and that clock\'s base window also shrinks per floor (2s at floor 1 down toward its 1s floor by around floor 9-10), not just Dex-dependent like before; Dex still extends it back on top: +0.3s per 50 DEX, up to an 8s cap.',
  },
];

const UNIVERSAL_CELLS = [
  { label: 'Dexterity → time', value: '+0.5s / 50 DEX', formula: 'timeLimit = base + ⌊dex÷50⌋ × 0.5 — except Hold, see its card' },
  { label: "Thief's Lockpick", value: '+1.0s flat', formula: 'stacks per copy equipped' },
  { label: "Thief's Skeleton", value: '1 free retry', formula: 'fresh session on first fail · 100 dmg if the retry fails too' },
  { label: "Thief's Socks", value: 'No fail damage', formula: "skips the event's own trap/backfire damage" },
  { label: "Thief's Halo", value: '+40% max HP', formula: 'on any successful event, any type' },
];

/** Header cell + 5 data cells per row — a full-width `wide` row applies identically across every type instead of varying per column. */
const MATRIX_ROWS = [
  {
    item: "Thief's Providence", sub: "Thief's Ring · −17% difficulty",
    cells: ['−17% arrow count', '−17% rounds needed', '+17%-equiv. wider slit', '−17% sequence length', '+17%-equiv. higher fill/press'],
  },
  {
    item: "Thief's Resolve", sub: "Thief's Sleeves · +30% difficulty, +50% reward",
    cells: ['+30% arrow count', '+30% rounds needed', 'narrower slit (−30%-equiv.)', '+30% sequence length', 'lower fill/press (−30%-equiv.)'],
  },
  {
    item: "Thief's Prophecy", sub: "Thief's Goggles · double-advance",
    cells: [
      'correct press also clears the next arrow',
      '+2 rounds banked per hit',
      'slit width ×1.5, stacked after Ring/Sleeves',
      'correct press also fills the next symbol',
      'fill-per-press ×2',
    ],
  },
  {
    item: "Thief's Lockpick", sub: 'qteBonusSeconds +1s', wide: true,
    text: 'Adds a flat second to the timer before it starts counting down — same effect as the Dex bonus above, just from gear instead of a stat.',
  },
  {
    item: "Thief's Skeleton", sub: 'qteSecondChance', wide: true,
    text: 'On a failed attempt, the whole session restarts fresh (same type, same difficulty) — the event resolver still only ever sees one final result.',
  },
  {
    item: "Thief's Socks", sub: 'noQteFailDamage', wide: true,
    text: "Skips the event's trap/backfire damage on failure — n/a for Locked Door (never had any) and Wandering Satchel (no QTE, no fail state).",
  },
  {
    item: "Thief's Earring", sub: 'rewardBonusPercent +20%',
    cells: ['+20% gold + material', '+20% gold (door) / material (chest)', 'n/a — rarity roll, not scalable', "+20% Sigil's buff magnitude", '+20%, fallback-material path only'],
  },
  {
    item: "Thief's Halo", sub: 'eventSuccessHealPercent +40%', wide: true,
    text: 'Heals 40% of max HP the instant any event resolves successfully — both Wounded Animal success branches included.',
  },
];

const EVENT_LEGEND = [
  { color: '#4d84ef', name: 'Arrow', event: 'Treasure' },
  { color: '#9a7ce0', name: 'Timing', event: 'Locked Door' },
  { color: '#b370c9', name: 'Hold', event: 'Sealed Shrine' },
  { color: '#2fd9c4', name: 'Memory', event: 'Arcane Sigil' },
  { color: '#e0584a', name: 'Mash', event: 'Wounded Animal (70% of "try and save it")' },
  { color: '#f39c12', name: 'Arrow+Timing Combo', event: 'Temporal Chest (×1.5 difficulty, ×9 reward)' },
];

function typeCardHTML(card) {
  return `
    <div class="event-type-card" style="--type-color:${card.color}">
      <div class="event-type-card-head">
        <span class="event-type-name">${card.name}</span>
        <span class="event-type-used-by">${card.usedBy}</span>
      </div>
      <div class="event-type-base">Base timer: <strong>${card.baseTime}</strong></div>
      <div class="event-type-knob-label">${card.knobLabel}</div>
      <div class="event-type-values">${card.floorValues}</div>
      <div class="event-type-note">${card.note}</div>
    </div>`;
}

function matrixRowHTML(row) {
  if (row.wide) {
    return `
      <div class="event-matrix-row wide">
        <div class="event-matrix-item"><span class="name">${row.item}</span><span class="sub">${row.sub}</span></div>
        <div class="event-matrix-cell wide">${row.text}</div>
      </div>`;
  }
  return `
    <div class="event-matrix-row">
      <div class="event-matrix-item"><span class="name">${row.item}</span><span class="sub">${row.sub}</span></div>
      ${row.cells.map((c) => `<div class="event-matrix-cell">${c}</div>`).join('')}
    </div>`;
}

/** Full Events reference content — shared by EventsState (full screen) and PauseOverlay (in-run sub-view), same pattern as achievementCardHTML. */
export function eventsContentHTML() {
  return `
    <p class="events-intro">${t('events.intro')}</p>

    <h2 class="events-section-head">${t('events.section_universal')}</h2>
    <div class="events-universal-grid">
      ${UNIVERSAL_CELLS.map((c) => `
        <div class="events-universal-cell">
          <span class="label">${c.label}</span>
          <span class="value">${c.value}</span>
          <span class="formula">${c.formula}</span>
        </div>`).join('')}
    </div>

    <h2 class="events-section-head">${t('events.section_types')}</h2>
    <div class="event-type-grid">
      ${QTE_TYPE_CARDS.map(typeCardHTML).join('')}
    </div>

    <h2 class="events-section-head">${t('events.section_matrix')}</h2>
    <p class="events-note">${t('events.matrix_note')}</p>
    <div class="event-matrix">
      <div class="event-matrix-row header">
        <div class="event-matrix-item"></div>
        <div class="event-matrix-cell" style="color:#4d84ef;">Arrow</div>
        <div class="event-matrix-cell" style="color:#9a7ce0;">Timing</div>
        <div class="event-matrix-cell" style="color:#b370c9;">Hold</div>
        <div class="event-matrix-cell" style="color:#2fd9c4;">Memory</div>
        <div class="event-matrix-cell" style="color:#e0584a;">Mash</div>
      </div>
      ${MATRIX_ROWS.map(matrixRowHTML).join('')}
    </div>
    <p class="events-footnote">${t('events.footnote')}</p>

    <h2 class="events-section-head">${t('events.section_legend')}</h2>
    <div class="events-legend">
      ${EVENT_LEGEND.map((l) => `
        <div class="events-legend-item">
          <span class="swatch" style="background:${l.color}"></span>
          <span class="qt">${l.name}</span>
          <span class="ev">— ${l.event}</span>
        </div>`).join('')}
    </div>`;
}

/** EventsState — full-screen QTE mechanics reference (Dex, floor scaling, Thief's-set gear), reachable from the Encyclopedia hub. Pure documentation, no live game state. */
export class EventsState {
  constructor(app) {
    this.app = app;
  }

  enter(root) {
    this.root = root;
    root.innerHTML = `
      <div class="events-screen">
        <button class="back-btn">${t('common.return_home')}</button>
        <h1>${t('events.title')}</h1>
        <div class="events-content">${eventsContentHTML()}</div>
      </div>`;
    root.querySelector('.back-btn').addEventListener('click', () => this.app.setState(GAME_STATES.HOME));
  }

  exit() {}
}
