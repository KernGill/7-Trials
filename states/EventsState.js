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
    note: "Marker sweeps every 1.1s, always, inside a flat 6s timer — more hits packed into a shrinking window is what makes late floors brutal. Miss the zone once, or time out, and it fails. Space only. Dex widens the zone directly, on top of its usual time bonus: +1.5% width per 50 DEX, up to 50%. Thief's Prophecy (Goggles) puts TWO zones on the track instead of one — twice the chance to land a hit each sweep — rather than banking extra rounds per hit.",
  },
  {
    id: 'combo', color: '#f39c12', name: 'Arrow+Timing Combo', usedBy: 'Temporal Chest only',
    baseTime: '5s', knobLabel: 'Arrow count — locking isn\'t enough, every arrow must be BROKEN', floorValues: '12 arrows → 18 arrows → 24 arrows (win once every one is permanently broken)',
    note: "The highest-risk, highest-reward QTE in the game — Temporal Chest's payout is 9× a regular chest's, and a flat 5s (cut from an original 20s, in two rounds of \"still too easy\" nerfs) is brutally tight for what's being asked of you. The timing bar is split into a BLUE left half and a RED right half; a tiny green slit sits somewhere on the track — a real target, pressed with Space (or click/tap), not just a visual landmark — and jumps to a new random spot every time you land it, just like standalone Timing's own zone. Pressing the next arrow (WASD/arrow keys) LOCKS it — a provisional state, dark blue+lock icon on the left half, dark red+lock icon on the right half, depending on which half the marker was over at that instant. Landing the green slit converts every CURRENTLY-locked arrow (either color) into a permanent BROKEN state, which is immune to everything and counts toward the win, then relocates the slit for the next lap. Miss the slit and nothing happens — there's always another lap. The risk is each color's own clock: a blue-locked arrow not yet broken reverts to unpressed the instant the marker wraps back to the start (re-entering blue); a red-locked arrow not yet broken reverts the instant the marker crosses back into red. Splitting locks into two independently-timed colors (instead of one shared clock for everything) is what keeps this fair rather than luck-gated — you're never stuck waiting on a single random zone, since a hit on the slit always cashes in whatever's currently locked on EITHER side. A wrong arrow press still fails the whole attempt instantly. Dex, Ring/Sleeves, and Lockpick/Skeleton all still apply to the arrow strip and the green slit exactly as they do on standalone Timing; Goggles still locks the next arrow free on a correct press, in the same color.",
  },
  {
    id: 'hold', color: '#b370c9', name: 'Hold', usedBy: 'Sealed Shrine',
    baseTime: '5s, fixed', knobLabel: 'Slit width (win zone)', floorValues: '11% → 7% → 5%',
    note: 'The hardest QTE in the game, by design — Sealed Shrine drops a card. No early win — checked only the instant the timer hits 0, against ANY of your slits (1 normally, 2 with Goggles — see below). There IS an early fail: a kill bar tracks cumulative time spent outside every slit and ends the attempt the moment that crosses 65% of the timer (80% with Thief\'s Skill/Lockpick) — losing this way costs 50 flat damage, since you were nowhere close. Losing to the ordinary timeout instead costs a much steeper 200 — the closer you got, the worse the backlash. Fill/drain are twitchy and fast, tuned to make chasing a far-off slit realistic: 85%/s held, 55%/s released. Each slit is tiny and drifts erratically — random speed (20–55%-of-track/sec base) AND direction, re-rolled every 0.12–0.35s, always bouncing at the ends. Dex narrows that random speed range instead of widening the slit or adding time: −3%/sec per 50 DEX, floors at 6–14%/sec. Thief\'s Prophecy (Goggles) replaces its usual "wider slit" bonus here with a SECOND independent slit that also drifts 1.4x faster — twice the targets, but harder to track either one.',
  },
  {
    id: 'memory', color: '#2fd9c4', name: 'Memory', usedBy: 'Arcane Sigil',
    baseTime: '8s (input only)', knobLabel: 'Sequence length / reveal speed', floorValues: '5 @860ms → 8 @700ms → 10 @540ms',
    note: 'Timer is frozen during playback — only counts once you start answering. Sequence length is the dominant difficulty knob — by floor 9 you\'re memorizing 10 random directions flashed under a second apart.',
  },
  {
    id: 'mash', color: '#e0584a', name: 'Mash', usedBy: 'Wounded Animal (70% branch)',
    baseTime: '7s', knobLabel: 'Fill % per press', floorValues: '8.35% → 5.75% → 3.15%',
    note: '≈12 presses at floor 1 vs. ≈32 at floor 9, and the passive decay while not pressing gets harsher per floor too (12%/s → 21%/s by floor 9), so hesitating costs more late-game. A separate stamina bar drains on its own clock, continuously shading green→red as it empties (same color language as Sealed Shrine\'s kill bar) — pressing while it\'s fully red/empty is an instant fail — and that clock\'s base window also shrinks per floor; Dex extends it back: +0.3s per 50 DEX, up to an 8s cap. Dex ALSO shortens the lockout itself once it triggers: -5% per 70 DEX, capped at -30% — a fully-decked-out Thief\'s-set Artius (434 DEX) lands exactly on that cap. The fill bar\'s own passive decay is HALVED for the whole time you\'re locked out — you can\'t press during it anyway, so a forced pause no longer bleeds progress at the full rate too; the fill bar still decays, just gently, rewarding being lax exactly when the game is holding you back rather than punishing it same as any other hesitation. Thief\'s Prophecy (Goggles) makes every press ALSO drain a little stamina on top of the clock — a deliberate double edge: the doubled fill-per-press it already grants means far fewer presses needed overall, but mashing blindly into an already-low bar now risks draining it yourself, not just mistiming the clock. Every success branch of Wounded Animal (this QTE\'s win, its fallback, and the 30% instant-save) also grants tokens, scaled the same way Locked Door\'s gold is.',
  },
];

const UNIVERSAL_CELLS = [
  { label: 'Dexterity → time', value: '+0.5s / 50 DEX', formula: 'timeLimit = base + ⌊dex÷50⌋ × 0.5 — except Hold, see its card. Also widens Timing\'s zone directly, see its card.' },
  { label: "Thief's Lockpick", value: '+1.0s flat', formula: "stacks per copy equipped · ALSO raises Sealed Shrine's kill-bar threshold from 65% to 80%, see Hold's card" },
  { label: "Thief's Skeleton", value: '1 free retry', formula: 'fresh session on first fail · 100 dmg if the retry fails too' },
  { label: "Thief's Socks", value: 'No fail damage', formula: "skips the event's own trap/backfire damage" },
  { label: "Thief's Halo", value: '+40% max HP', formula: 'on any successful event, any type' },
];

/** Header cell + 5 data cells per row — a full-width `wide` row applies identically across every type instead of varying per column. */
const MATRIX_ROWS = [
  {
    item: "Thief's Providence", sub: "Thief's Ring · −20% difficulty, min 1 unit",
    cells: [
      '−20% arrow count',
      '−20% rounds needed',
      '+20%-equiv. wider slit',
      '−20% sequence length',
      '+20%-equiv. higher fill/press',
    ],
  },
  {
    item: "Thief's Providence — rounding guarantee", sub: 'applyDiscreteQteReduction', wide: true,
    text: "A reduction on a discrete knob (arrow count, timing rounds, memory length) is guaranteed to remove at least 1 whole unit from what you'd have gotten with no Ring/Sleeves at all — a small fractional cut that would otherwise round straight back up to \"no visible change\" (e.g. 3 rounds × 0.8 = 2.4, which naive ceiling-rounding sends right back to 3) instead just forces baseline−1. Doesn't apply to Hold/Mash's continuous fill-rate knobs, which don't have a rounding step to swallow the effect in the first place.",
  },
  {
    item: "Thief's Resolve", sub: "Thief's Sleeves · +30% difficulty, +50% reward",
    cells: ['+30% arrow count', '+30% rounds needed', 'narrower slit (−30%-equiv.)', '+30% sequence length', 'lower fill/press (−30%-equiv.)'],
  },
  {
    item: "Thief's Prophecy", sub: "Thief's Goggles · double-advance",
    cells: [
      'correct press also clears the next arrow',
      'two zones on the track instead of one',
      'two slits instead of one, both drifting 1.4× faster',
      'correct press also fills the next symbol',
      'fill-per-press ×2, AND every press drains a little stamina too',
    ],
  },
  {
    item: "Thief's Lockpick", sub: 'qteBonusSeconds +1s', wide: true,
    text: "Adds a flat second to the timer before it starts counting down — same effect as the Dex bonus above, just from gear instead of a stat. Also carries a separate holdKillBarBonusPercent field that raises Sealed Shrine's kill-bar tolerance from 65% to 80%.",
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
    cells: ['+20% gold + material', '+20% gold (door) / material (chest)', 'n/a on the card itself — rarity roll, not scalable', "+20% Sigil's buff magnitude", '+20%, fallback-material path only'],
  },
  {
    item: "Thief's Earring + Thief's Resolve — Shrine rarity", sub: 'shrineEpicWeightBonus / shrineLegendaryWeightBonus / shrineMythicWeightBonus', wide: true,
    text: "Both nudge Sealed Shrine's card roll toward epic, legendary, and mythic, stacking if both are equipped — kept deliberately modest (a handful of weight points redistributed from the low tiers, not a rarity floor) since an all-epic-and-above shrine pool would be overpowered.",
  },
  {
    item: "Thief's Halo", sub: 'eventSuccessHealPercent +40%', wide: true,
    text: 'Heals 40% of max HP the instant any event resolves successfully — every event type, including Wandering Satchel and both Wounded Animal success branches.',
  },
];

/**
 * Every Thief's-set piece and exactly which of the 7 exploration events its
 * passive touches — verified against the resolver code (see
 * states/ExploreState.js), not just each move's own flavor text, which
 * undersells a couple of these (Idol's reveal, Halo's heal).
 */
const THIEFS_SET_EVENTS = [
  {
    item: "Thief's Gloves", slot: 'Glove', passive: "Thief's Wit", effect: '+40 flat gold on winning a fight',
    events: null,
  },
  {
    item: "Thief's Lockpick", slot: 'Accessory', passive: "Thief's Skill", effect: '+1s on every QTE timer; raises Sealed Shrine\'s kill-bar tolerance 65% → 80%',
    events: [
      { event: 'Locked Door', desc: '+1s on the timing bar\'s timer' },
      { event: 'Treasure', desc: '+1s on the arrow sequence\'s timer' },
      { event: 'Temporal Chest', desc: '+1s on the combined arrow+timing timer' },
      { event: 'Sealed Shrine', desc: '+1s on the hold timer, and the kill bar tolerates 80% out-of-slit time instead of 65%' },
      { event: 'Arcane Sigil', desc: '+1s on the memory input timer' },
      { event: 'Wounded Animal', desc: '+1s, only on the 70% Mash-QTE branch' },
    ],
  },
  {
    item: "Thief's Earring", slot: 'Accessory', passive: "Thief's Greed", effect: '+20% gold/material rewards; nudges Sealed Shrine toward epic/legendary/mythic',
    events: [
      { event: 'Locked Door', desc: '+20% gold reward' },
      { event: 'Treasure', desc: '+20% material reward' },
      { event: 'Temporal Chest', desc: '+20% both gold and material reward' },
      { event: 'Sealed Shrine', desc: 'small weight bump toward epic/legendary/mythic on the card roll' },
      { event: 'Arcane Sigil', desc: '+20% on the granted stat buff\'s magnitude' },
      { event: 'Wandering Satchel', desc: '+20% on whichever reward shape you pick' },
      { event: 'Wounded Animal', desc: '+20% on the material reward (instant-save or debuff-already-queued fallback)' },
    ],
  },
  {
    item: "Thief's Socks", slot: 'Boots', passive: "Thief's Experience", effect: 'No damage from failing a QTE',
    events: [
      { event: 'Treasure', desc: 'Skips the chest trap damage' },
      { event: 'Temporal Chest', desc: 'Skips its (larger) trap damage' },
      { event: 'Sealed Shrine', desc: 'Skips the shrine trap damage' },
      { event: 'Arcane Sigil', desc: 'Skips the sigil trap damage' },
      { event: 'Wounded Animal', desc: 'Skips the 80-damage Mash-QTE fail penalty' },
    ],
  },
  {
    item: "Thief's Ring", slot: 'Ring', passive: "Thief's Providence", effect: '−20% to each QTE\'s difficulty knob, guaranteed at least 1 whole unit',
    events: [
      { event: 'Locked Door', desc: 'Fewer timing-bar rounds needed' },
      { event: 'Treasure', desc: 'Fewer arrows in the sequence' },
      { event: 'Temporal Chest', desc: 'Fewer arrows (arrow half only — the timing bar is infinite and has no difficulty knob)' },
      { event: 'Sealed Shrine', desc: 'Higher hold fill-rate' },
      { event: 'Arcane Sigil', desc: 'Shorter memory sequence' },
      { event: 'Wounded Animal', desc: 'Higher fill-per-press, Mash branch only' },
    ],
  },
  {
    item: "Thief's Goggles", slot: 'Head', passive: "Thief's Prophecy", effect: '"Double advance," reinterpreted per QTE type',
    events: [
      { event: 'Locked Door', desc: 'Two sweet-spot zones on the timing bar instead of one' },
      { event: 'Treasure', desc: 'A correct press also clears the next arrow for free' },
      { event: 'Temporal Chest', desc: 'A correct press also locks the next arrow for free, and the timing bar gets two zones' },
      { event: 'Sealed Shrine', desc: 'Two independent slits instead of one, both drifting 1.4× faster' },
      { event: 'Arcane Sigil', desc: 'A correct press also fills the next symbol for free' },
      { event: 'Wounded Animal', desc: 'Fill-per-press ×2, AND every press also drains a little stamina — Mash branch only' },
    ],
  },
  {
    item: "Thief's Idol", slot: 'Main Weapon', passive: "Thief's Future", effect: 'Reveals unresolved events on the minimap early',
    events: [
      { event: 'All 7 events', desc: 'Every unresolved event tile is marked before you\'ve explored near it — wider than its own flavor text lets on, which only mentions the original 3' },
    ],
  },
  {
    item: "Thief's Skeleton", slot: 'Chest', passive: "Thief's Curiosity", effect: 'One free retry on a failed QTE (100 dmg if that retry also fails)',
    events: [
      { event: 'Locked Door', desc: 'Free retry on a missed timing hit' },
      { event: 'Treasure', desc: 'Free retry on a wrong arrow press' },
      { event: 'Temporal Chest', desc: 'Free retry on a wrong arrow press' },
      { event: 'Sealed Shrine', desc: 'Free retry on a failed hold attempt' },
      { event: 'Arcane Sigil', desc: 'Free retry on a wrong memory input' },
      { event: 'Wounded Animal', desc: 'Free retry on a failed Mash attempt (70% branch only)' },
    ],
  },
  {
    item: "Thief's Sleeves", slot: 'Arms', passive: "Thief's Resolve", effect: '+30% to each QTE\'s difficulty knob, +50% rewards, nudges Sealed Shrine toward epic/legendary/mythic',
    events: [
      { event: 'Locked Door', desc: 'More timing-bar rounds; +50% gold' },
      { event: 'Treasure', desc: 'More arrows; +50% material' },
      { event: 'Temporal Chest', desc: 'More arrows (arrow half only); +50% gold+material' },
      { event: 'Sealed Shrine', desc: 'Lower hold fill-rate (harder), plus a weight bump toward epic/legendary/mythic on the card roll' },
      { event: 'Arcane Sigil', desc: 'Longer sequence; +50% on the buff magnitude' },
      { event: 'Wandering Satchel', desc: '+50% on whichever reward shape you pick' },
      { event: 'Wounded Animal', desc: 'Lower fill-per-press (Mash branch, harder); +50% on its material/gold rewards' },
    ],
  },
  {
    item: "Thief's Halo", slot: 'Ring', passive: "Thief's Repentance", effect: '+40% max HP heal on any successful event',
    events: [
      { event: 'All 7 events', desc: 'Heals 40% max HP on every successful resolution — the only fully universal passive in the set' },
    ],
  },
  {
    item: "Thief's Skin", slot: 'Glove', passive: "Thief's Guilt", effect: 'Triples the last enemy\'s kill-drop rolls',
    events: null,
  },
  {
    item: "Thief's Dagger Holster", slot: 'Legs', passive: "Thief's Envy", effect: '10% chance to copy an enemy\'s buff',
    events: null,
  },
];

/**
 * Sealed Shrine's card rarity, computed at representative floors from the
 * exact formula in data/cards.js (shrineBaseWeights) — no gear equipped.
 * Per user request ("scale much better — floor 10 should be MINIMUM epic,
 * with a decent chance at legendary and mythic"), Common/Uncommon/Rare all
 * decay linearly to EXACTLY 0 weight by floor 10 (not just a shrinking
 * share — floor 10 genuinely cannot roll them), while Epic/Legendary/
 * Mythic (still unlocking at floor 2 and floor 6 respectively, so floor 1
 * is still exactly 0% for all three) grow fast enough to land on a literal
 * 40%/35%/25% split at floor 10 (nothing else is left in the pool there),
 * then keep climbing a bit further before their caps settle the odds near
 * 32%/39%/29% for floor 15 onward.
 */
const SHRINE_RARITY_BY_FLOOR = [
  { floor: 1, common: 47.17, uncommon: 47.17, rare: 5.66, epic: 0, legendary: 0, mythic: 0 },
  { floor: 2, common: 40.98, uncommon: 40.98, rare: 9.84, epic: 8.20, legendary: 0, mythic: 0 },
  { floor: 3, common: 35.50, uncommon: 35.50, rare: 12.78, epic: 16.23, legendary: 0, mythic: 0 },
  { floor: 4, common: 30.49, uncommon: 30.49, rare: 14.63, epic: 24.39, legendary: 0, mythic: 0 },
  { floor: 5, common: 25.77, uncommon: 25.77, rare: 15.46, epic: 32.99, legendary: 0, mythic: 0 },
  { floor: 6, common: 17.24, uncommon: 17.24, rare: 12.41, epic: 34.48, legendary: 10.86, mythic: 7.76 },
  { floor: 7, common: 11.26, uncommon: 11.26, rare: 9.01, epic: 36.04, legendary: 18.92, mythic: 13.51 },
  { floor: 10, common: 0, uncommon: 0, rare: 0, epic: 40, legendary: 35, mythic: 25 },
  { floor: 13, common: 0, uncommon: 0, rare: 0, epic: 34.25, legendary: 38.36, mythic: 27.40 },
  { floor: 15, common: 0, uncommon: 0, rare: 0, epic: 32.26, legendary: 38.71, mythic: 29.03 },
];

/**
 * Thief's Greed and Thief's Resolve each add a FLAT bonus to the Epic/
 * Legendary/Mythic weight, on top of the floor curve above, before the
 * percentages are recomputed — see rollShrineCard in data/cards.js and
 * their shrineEpicWeightBonus/shrineLegendaryWeightBonus/
 * shrineMythicWeightBonus move fields. Stacks if both are equipped.
 */
const SHRINE_GEAR_BONUS_ROWS = [
  { item: "Thief's Earring", passive: "Thief's Greed", epic: 1, legendary: 1, mythic: 2 },
  { item: "Thief's Sleeves", passive: "Thief's Resolve", epic: 1, legendary: 2, mythic: 2 },
  { item: 'Both equipped', passive: 'stacked', epic: 2, legendary: 3, mythic: 4, wide: true },
];

/**
 * Worked examples showing exactly what those bonuses do to two floors:
 * floor 1 (where epic/legendary/mythic are otherwise 0% — this is the ONLY
 * way to see them that early) and floor 10, where common/uncommon/rare are
 * ALREADY at 0% from the floor curve alone (see SHRINE_RARITY_BY_FLOOR) —
 * the bonus there just further tilts the epic/legendary/mythic split, it
 * can't summon a low tier back into the pool.
 */
const SHRINE_GEAR_EXAMPLES = [
  {
    floor: 1, label: 'Floor 1, both equipped',
    common: 40.32, uncommon: 40.32, rare: 4.84, epic: 3.23, legendary: 4.84, mythic: 6.45,
  },
  {
    floor: 10, label: 'Floor 10, both equipped',
    common: 0, uncommon: 0, rare: 0, epic: 38.53, legendary: 34.86, mythic: 26.61,
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

const RARITY_COLS = [
  { key: 'common', label: 'Common', color: '#9e9e9e' },
  { key: 'uncommon', label: 'Uncommon', color: '#2ecc71' },
  { key: 'rare', label: 'Rare', color: '#3498db' },
  { key: 'epic', label: 'Epic', color: '#9b59b6' },
  { key: 'legendary', label: 'Legendary', color: '#f1c40f' },
  { key: 'mythic', label: 'Mythic', color: '#e74c3c' },
];

function pct(n) { return `${n.toFixed(n === 0 || Number.isInteger(n) ? 0 : 2)}%`; }

/** Sealed Shrine's no-gear rarity odds by floor — see SHRINE_RARITY_BY_FLOOR. Zero cells render dim/muted so "0%" floors read at a glance. */
function shrineRarityTableHTML() {
  return `
    <div class="shrine-rarity-scroll">
      <table class="shrine-rarity-table">
        <thead>
          <tr>
            <th>Floor</th>
            ${RARITY_COLS.map((c) => `<th style="color:${c.color}">${c.label}</th>`).join('')}
          </tr>
        </thead>
        <tbody>
          ${SHRINE_RARITY_BY_FLOOR.map((row) => `
            <tr>
              <td class="shrine-rarity-floor">${row.floor}${row.floor === 15 ? '+' : ''}</td>
              ${RARITY_COLS.map((c) => `<td class="${row[c.key] === 0 ? 'zero' : ''}">${pct(row[c.key])}</td>`).join('')}
            </tr>`).join('')}
        </tbody>
      </table>
    </div>`;
}

/** Thief's Greed/Resolve's exact weight bonuses, plus two worked floor examples — see SHRINE_GEAR_BONUS_ROWS/SHRINE_GEAR_EXAMPLES. */
function shrineGearInfluenceHTML() {
  return `
    <div class="shrine-rarity-scroll">
      <table class="shrine-rarity-table shrine-gear-table">
        <thead>
          <tr><th>Gear</th><th>Passive</th><th style="color:#9b59b6">Epic weight</th><th style="color:#f1c40f">Legendary weight</th><th style="color:#e74c3c">Mythic weight</th></tr>
        </thead>
        <tbody>
          ${SHRINE_GEAR_BONUS_ROWS.map((r) => `
            <tr${r.wide ? ' class="shrine-gear-total"' : ''}>
              <td>${r.item}</td><td>${r.passive}</td><td>+${r.epic}</td><td>+${r.legendary}</td><td>+${r.mythic}</td>
            </tr>`).join('')}
        </tbody>
      </table>
    </div>
    <p class="events-note">Weight is additive, on top of whatever the floor curve above already gives that tier — worked examples:</p>
    <div class="shrine-rarity-scroll">
      <table class="shrine-rarity-table">
        <thead>
          <tr><th>Scenario</th>${RARITY_COLS.map((c) => `<th style="color:${c.color}">${c.label}</th>`).join('')}</tr>
        </thead>
        <tbody>
          ${SHRINE_GEAR_EXAMPLES.map((row) => `
            <tr>
              <td class="shrine-rarity-floor">${row.label}</td>
              ${RARITY_COLS.map((c) => `<td class="${row[c.key] === 0 ? 'zero' : ''}">${pct(row[c.key])}</td>`).join('')}
            </tr>`).join('')}
        </tbody>
      </table>
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

/** One card per Thief's-set piece — see THIEFS_SET_EVENTS. `events: null` renders as a muted "None" line instead of a list. */
function thiefsSetCardHTML(entry) {
  const eventsHTML = entry.events
    ? `<div class="thiefs-set-events">
        ${entry.events.map((e) => `
          <div class="thiefs-set-event-row">
            <span class="thiefs-set-event-chip">${e.event}</span>
            <span class="thiefs-set-event-desc">${e.desc}</span>
          </div>`).join('')}
      </div>`
    : '<div class="thiefs-set-none">None — no exploration-event tie-in</div>';
  return `
    <div class="thiefs-set-card">
      <div class="thiefs-set-card-head">
        <span class="thiefs-set-name">${entry.item}</span>
        <span class="thiefs-set-slot">${entry.slot}</span>
      </div>
      <div class="thiefs-set-passive"><strong>${entry.passive}</strong> — ${entry.effect}</div>
      ${eventsHTML}
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
    </div>

    <h2 class="events-section-head">${t('events.section_thiefs_set')}</h2>
    <p class="events-note">${t('events.thiefs_set_note')}</p>
    <div class="thiefs-set-grid">
      ${THIEFS_SET_EVENTS.map(thiefsSetCardHTML).join('')}
    </div>

    <h2 class="events-section-head">${t('events.section_shrine_rarity')}</h2>
    <p class="events-note">${t('events.shrine_rarity_note')}</p>
    ${shrineRarityTableHTML()}
    <p class="events-footnote">${t('events.shrine_rarity_footnote')}</p>
    <p class="events-note">${t('events.shrine_gear_note')}</p>
    ${shrineGearInfluenceHTML()}`;
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
