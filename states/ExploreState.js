import { TILE_TYPES } from '../exploration/Tile.js';
import { PauseOverlay } from './PauseOverlay.js';
import { getConsumableConfig } from '../data/consumables.js';
import { getMaterialConfig } from '../data/items.js';
import { getArcForFloor } from '../data/arcs.js';
import {
  rollCardOffer, rollShrineCard, canFuseCards, fuseCards, cardValueForRarity, cardsInCategory,
  CARDS, RARITIES, RARITY_COLORS, CARD_PRICES,
} from '../data/cards.js';
import { cardTileHTML, cardTooltipHTML, shopCardTileHTML, statLabel } from '../ui/InfoFormatters.js';
import { arrowIconSVG, holdIconSVG, mashIconSVG, lockIconSVG } from '../ui/DirectionIcons.js';
import { t, tData } from '../ui/i18n.js';
import { DungeonRenderer3D } from '../exploration/DungeonRenderer3D.js';
import { Minimap } from '../exploration/Minimap.js';
import { TooltipManager } from '../ui/TooltipManager.js';
import {
  CHEST_TRAP_DAMAGE, TEMPORAL_CHEST_TRAP_DAMAGE, LOCKED_ROOM_GOLD_REWARD,
  SEALED_SHRINE_KILLBAR_FAIL_DAMAGE, SEALED_SHRINE_TIMEOUT_FAIL_DAMAGE,
  ARCANE_SIGIL_TRAP_DAMAGE, WOUNDED_ANIMAL_MASH_FAIL_DAMAGE,
} from '../utils/Constants.js';
import { randomInt, clamp } from '../utils/MathUtils.js';
import { pickRandom, rollWeightedChoice } from '../utils/RandomUtils.js';
import {
  CAMERA_ZOOM_MIN_PERCENT, CAMERA_ZOOM_MAX_PERCENT, DEFAULT_CAMERA_ZOOM_PERCENT, CAMERA_ZOOM_STEP_PERCENT,
} from '../ui/CameraSettings.js';
import { DEFAULT_WALK_SPEED_PERCENT } from '../ui/WalkSpeedSettings.js';

const FACING_ORDER = ['north', 'east', 'south', 'west']; // clockwise

// Omnidirectional free movement (per user request — no longer tile-locked):
// held movement keys/touch buttons integrate a continuous position every
// physics tick (see updateContinuousMovement), moving in the exact
// direction the free-look camera is currently pointing (not snapped to
// the nearest cardinal zone) rather than hopping one whole tile at a
// time. PLAYER_MOVE_SPEED is tuned to roughly match how long the OLD
// tile-to-tile tween used to take (~1 tile per third of a second).
const PLAYER_MOVE_SPEED = 3; // tile-widths per second
// Collision radius (tile-widths) swept against WALL tiles' footprints —
// small enough to comfortably fit through a single-tile-wide corridor
// (which has exactly 1.0 tile-width of open space) with real clearance on
// both sides, per resolveMovement's axis-separated wall-slide.
const PLAYER_COLLISION_RADIUS = 0.3;
// True Euclidean reveal radius (tile-widths) — per user request, checked
// every frame against the player's own continuous position (see
// revealNearbyTiles/tick), driving BOTH the cheap tile-level "visited"
// bookkeeping below (still what the HUD's Explored % is computed from)
// and, more importantly, Minimap.revealCircle's actual pixel-resolution
// fog-of-war reveal (a soft-edged circle stamped at this exact radius,
// not snapped to any tile grid at all — see Minimap.js's class doc
// comment). Per a later user request ("the torch is already increasing
// the exploration radius, so bump that increase to 50% and raise the
// base up to match what the torch used to give"): the base radius was
// bumped up to the OLD torch value (was 1.4, torch was 2.4), and the
// torch radius is now exactly 1.5x the (new) base — was already a torch
// buff over base, this just resets both anchors and the multiplier.
const REVEAL_RADIUS = 2.4;
const TORCH_REVEAL_RADIUS = REVEAL_RADIUS * 1.5;
// Continuous movement no longer has a natural "one save per step" moment
// the way discrete tile-hopping did — autosaving on every physics tick
// would be excessive, so instead this throttles to at most once per this
// many seconds of actual held-key movement (tile-trigger events like
// stepping onto a chest still save immediately, same as before).
const MOVE_AUTOSAVE_INTERVAL_SECONDS = 3;
// Per user request, the fog-of-war's actual revealed pixels persist
// exactly across save/reload (see syncFogToDungeon/dungeon.fogData) —
// PNG-encoding the fog canvas isn't free, so this throttles how often the
// live canvas gets re-encoded onto run.dungeon.fogData to once per this
// many seconds while exploring, rather than every single reveal frame.
// syncFogToDungeon() is also called an extra, immediate time right before
// the two floor-LEAVING moments (stairs descent, elevator travel) that
// actually archive `run.dungeon` to disk, since those are the moments
// where a stale fogData would actually be visible on return — mid-
// exploration staleness of a couple seconds is never itself observable.
const FOG_SYNC_INTERVAL_SECONDS = 2;

const QTE_DIRECTIONS = ['up', 'down', 'left', 'right'];
const QTE_DIRECTION_KEYS = {
  w: 'up', arrowup: 'up',
  s: 'down', arrowdown: 'down',
  a: 'left', arrowleft: 'left',
  d: 'right', arrowright: 'right',
};
const QTE_BASE_SECONDS = 5;
const QTE_DEX_SECONDS_INTERVAL = 50;
// Halved per user request (to make Thief's flat qteBonusSeconds gear more
// worth chasing than just stacking raw dex) — was 1 full second per
// QTE_DEX_SECONDS_INTERVAL dex, now 0.5.
const QTE_DEX_SECONDS_PER_INTERVAL = 0.5;
const QTE_BASE_ARROWS = 7; // + 1 per floor (floor 1 = 8, floor 10 = 17)
// Base door/chest/temporal-chest reward amounts (LOCKED_ROOM_GOLD_REWARD,
// the chest randomInt(2,4) material roll, etc) are quartered via
// REWARD_INITIAL_SCALE, then grown back +25%/floor *compounding* (not
// additive) via REWARD_FLOOR_BONUS_PER_FLOOR — see getRewardMultiplier.
const REWARD_INITIAL_SCALE = 0.25;
const REWARD_FLOOR_BONUS_PER_FLOOR = 0.25;
// 50% harder than a regular chest/door on both halves of its combo QTE
// (arrow count AND timing rounds/zone — see buildComboQTE).
const TEMPORAL_CHEST_ARROW_MULTIPLIER = 1.5;
// Tripled per user request ("super hard, super worth it") on top of its
// prior 2x-a-regular-chest value, to match the Arrow+Timing combo QTE
// (see buildComboQTE) now guarding it.
const TEMPORAL_CHEST_REWARD_MULTIPLIER = 9;
// Combo QTE's flat timer — bumped to a full 20s per user request now that
// the arrow strip and timing bar run as one interlocked mechanic (see
// buildComboQTE) rather than two independent races; the old +3s-over-Arrow
// budget was sized for "do both quickly," not "keep pace with an endless
// timing loop while also clearing every arrow."
const COMBO_BASE_SECONDS = 20;
// The timing TRACK renders this many times wider for Combo specifically
// (see buildComboQTE's 'combo-wide' CSS class, style.css) so it doesn't
// look tiny next to the arrow strip above it — purely a container size
// change. Per user correction, the green sweet-spot zone and the marker's
// sweep speed must NOT scale up along with it — buildComboQTE divides
// computeTimingParams' zonePercent by this same multiplier (keeping the
// zone's actual PIXEL width identical to standalone Timing's) and
// multiplies periodSeconds by it (keeping the marker's PIXEL speed
// identical too, since it now has 3x the distance to cover).
const COMBO_TIMING_TRACK_WIDTH_MULTIPLIER = 3;
const RARE_MATERIALS = ['jar_of_spores', 'memory_fragment'];
const TEMPORAL_CHEST_RARE_CHANCE = 20; // vs. 0% from a normal chest's material pool
// Thief's Curiosity (Thief's Skeleton): flat penalty for failing the
// one-time retry — see finishQTE.
const QTE_SECOND_CHANCE_FAIL_DAMAGE = 100;

// QTE session types — see startQTE's dispatcher + the build*QTE methods.
// 'arrow' is the original mechanic, kept only for Temporal Chest; the
// other four are new. Every type shares the same finishQTE/mode/mouse-
// look/Thief's-Curiosity-retry plumbing — only the build*/handle*/submit*
// methods differ per type.
const QTE_TYPES = { ARROW: 'arrow', TIMING: 'timing', HOLD: 'hold', MEMORY: 'memory', MASH: 'mash', COMBO: 'combo' };

// --- Timing bar QTE (Locked Door, Treasure) ---
// Steepened per user report: at floor 10 with no gear, the old curve
// (6 rounds, 20%-wide zone, in a flat 6s timer) was comfortably doable —
// "even the easiest QTE should be extremely hard by floor 10." Rounds now
// grow every 2 floors instead of 3, and the zone shrinks to its floor
// nearly 3x faster (reaching TIMING_MIN_ZONE_PERCENT by floor 10 instead
// of floor 22+); the flat, non-scaling timer does the rest of the work —
// more required hits inside a much narrower window, same time budget.
const TIMING_BASE_ROUNDS = 3; // + 1 per TIMING_FLOOR_ROUNDS_INTERVAL floors
const TIMING_FLOOR_ROUNDS_INTERVAL = 2;
// One full sweep of the track — constant across floors, only the zone
// shrinks. 20% faster per user request (was 1.1s flat). Combo QTE's
// marker (Temporal Chest) derives its own period from this same constant
// — see buildComboQTE — so it speeds up in lockstep automatically.
const TIMING_MARKER_PERIOD_SECONDS = 1.1 / 1.2;
const TIMING_BASE_ZONE_PERCENT = 28; // sweet-spot width as % of track, floor 1
const TIMING_ZONE_SHRINK_PER_FLOOR = 2.2;
const TIMING_MIN_ZONE_PERCENT = 6;
// Dexterity widens the zone directly (on top of its universal Dex-adds-
// seconds bonus to the timer — see computeQTETimeLimit), same interval
// as every other type's Dex knob, applied AFTER the floor shrink above.
// Capped well short of the whole track so it's never trivial even at
// very high Dex.
const TIMING_DEX_ZONE_PERCENT_PER_INTERVAL = 1.5;
const TIMING_MAX_ZONE_PERCENT = 50;
const TIMING_BASE_SECONDS = 6;

// --- Hold QTE (Sealed Shrine) ---
// A balance challenge, not a race to fill: a narrow "slit" sits on the
// fill track and drifts along it erratically (random speed + direction,
// re-rolled every HOLD_SLIT_MOVE_RETARGET_*_SECONDS, always bouncing off
// both ends — see tickQTEProgress); holding raises the fill level fast,
// releasing drains it just as fast. Success is decided ONLY when the
// timer runs out — the fill level must be resting inside the slit's
// CURRENT position at that exact moment (see tick()'s HOLD-specific
// timeout branch). Failure has two paths: the ordinary timeout-without-
// being-in-the-slit case, AND an early "kill bar" fail — see
// HOLD_KILL_BAR_THRESHOLD_PERCENT below and tickQTEProgress — that fires
// the moment cumulative time spent outside the slit crosses that percent
// of the session's total time limit, so stalling out of the zone doesn't
// just cost you the final check, it can end the attempt outright. Unlike
// every other QTE type, Hold's timer is a flat constant, untouched by
// Dexterity (or floor) — Dex's contribution is redirected into narrowing
// the slit's random speed range instead (see
// HOLD_SLIT_MOVE_SPEED_DEX_REDUCTION_PER_INTERVAL and
// computeQTETimeLimit's Hold special-case). Deliberately the hardest QTE
// in the game — Sealed Shrine's card reward is worth it.
const HOLD_BASE_SECONDS = 5; // always exactly this — see computeQTETimeLimit
const HOLD_KILL_BAR_THRESHOLD_PERCENT = 65; // cumulative out-of-slit time, as % of the total timer, that triggers an instant fail
const HOLD_KILL_BAR_SAFE_COLOR = '#2ecc71'; // full/safe — same green as the rest of the game's QTE fill bars
const HOLD_KILL_BAR_DANGER_COLOR = '#e94560'; // empty/about to die — same red as the rest of the game's danger states
const HOLD_FILL_PER_SECOND_HELD = 68; // % fill/sec while held, constant across floors — twitchy on purpose
const HOLD_DECAY_PER_SECOND = 44; // % fill lost/sec while released, constant
const HOLD_BASE_SLIT_PERCENT = 12; // slit width as % of the track, floor 1 — small
const HOLD_SLIT_SHRINK_PER_FLOOR = 1; // gets harder — narrower slit per floor
const HOLD_MIN_SLIT_PERCENT = 5; // floor for the above
const HOLD_MAX_SLIT_PERCENT = 60; // ceiling once gear widens it — deliberately well short of trivial even fully kitted
// The slit's drift is erratic, not a steady sweep: every retarget tick it
// picks a fresh random speed (% of track/sec) from [moveSpeedMin,
// moveSpeedMax] and a fresh random direction, in addition to always
// bouncing off the track's ends — see tickQTEProgress. Floor-independent
// (slit WIDTH is the per-floor difficulty knob, same as Hold's other
// constants above). Dexterity narrows this speed range (both ends slide
// down together) instead of widening the slit — same interval as every
// other type's Dex-adds-seconds formula, just a different unit.
const HOLD_SLIT_MOVE_SPEED_MIN_BASE = 20;
const HOLD_SLIT_MOVE_SPEED_MAX_BASE = 55;
const HOLD_SLIT_MOVE_SPEED_DEX_REDUCTION_PER_INTERVAL = 3;
const HOLD_SLIT_MOVE_SPEED_FLOOR_MIN = 6; // floor for moveSpeedMin
const HOLD_SLIT_MOVE_SPEED_FLOOR_MAX = 14; // floor for moveSpeedMax — never fully predictable
const HOLD_SLIT_MOVE_RETARGET_MIN_SECONDS = 0.12; // how often the random speed/direction re-rolls
const HOLD_SLIT_MOVE_RETARGET_MAX_SECONDS = 0.35;
// Thief's Prophecy (Goggles): widens the slit further on top of the
// Ring/Sleeves-adjusted width, same "extra margin for error" spirit as
// its double-advance effect on the step-indexed QTE types.
const HOLD_DOUBLE_ADVANCE_SLIT_MULTIPLIER = 1.5;

// --- Memory / Simon-Says QTE (Arcane Sigil) ---
// Steepened alongside Timing/Mash (see their comments) so this doesn't
// stay the "easy" QTE by floor 10 — a longer sequence, revealed faster,
// is what makes memorization genuinely hard, so both knobs move.
const MEMORY_BASE_LENGTH = 4;
const MEMORY_LENGTH_PER_FLOOR = 0.7; // ~+1 length every 1.4 floors
const MEMORY_MAX_LENGTH = 14;
const MEMORY_BASE_REVEAL_MS = 900; // ms each icon is shown during playback
const MEMORY_REVEAL_SHRINK_PER_FLOOR_MS = 40;
const MEMORY_MIN_REVEAL_MS = 300;
const MEMORY_GAP_MS = 220; // pause between icons during playback, floor-independent
const MEMORY_INPUT_SECONDS = 8; // time allowed to reproduce, floor-independent (dex/qteBonusSeconds still apply) — only counted once the reveal phase ends, see tick()

// --- Mash QTE (Wounded Animal, 70% branch) ---
// Per user report: floor 10 with no gear was still "easily" doable — the
// old curve (fillPerPress only fell to 6.5% by floor 10, decay flat at
// 12%/sec, stamina clock flat at 2s regardless of floor) barely scaled
// at all. Now fillPerPress falls much further (to its floor by floor 10
// instead of still sitting well above it), the passive decay itself gets
// harsher per floor (any hesitation costs more), and the stamina clock's
// BASE window also shrinks per floor — Dex still extends it back, same
// as before, but a floor-10 no-gear attempt starts from a much shorter
// base window instead of the same flat 2s every floor gets. Floor 1
// barely moves (all three floor-1 values land within a hair of the old
// numbers) — this is specifically a late-floor curve fix.
const MASH_BASE_SECONDS = 5;
const MASH_FILL_PER_PRESS = 9; // % fill per press, floor 1 (~12 presses)
const MASH_FILL_PER_PRESS_FLOOR_DECAY = -0.65;
const MASH_MIN_FILL_PER_PRESS = 2.5; // floor for the above (~40 presses) — reached by floor 10 instead of still being 2x above it
const MASH_DECAY_PER_SECOND_BASE = 12; // passive drain while not pressing, floor 1
const MASH_DECAY_PER_SECOND_PER_FLOOR = 1; // grows harsher per floor — hesitating costs more progress at higher floors
const MASH_DECAY_PER_SECOND_MAX = 32; // ceiling for the above
// A separate "stamina" meter (see buildMashQTE/submitMashPress/
// tickQTEProgress) starts full and drains on a fixed clock — NOT tied to
// presses — going from full to empty in a per-floor window (below).
// Once empty it turns red and stays down for MASH_STAMINA_LOCKOUT_SECONDS
// before snapping back to full; pressing while it's down/red is an
// instant fail (see submitMashPress), so the player has to read the bar
// and hold off rather than just mash through it. Dex extends the window
// back (same interval/mechanism as before); the per-floor shrink below is
// applied FIRST, then Dex's bonus on top, then the result is clamped to
// MASH_STAMINA_MAX_DRAIN_SECONDS.
const MASH_STAMINA_DRAIN_BASE_SECONDS = 2; // floor 1 baseline
const MASH_STAMINA_DRAIN_SHRINK_PER_FLOOR = 0.09;
const MASH_STAMINA_DRAIN_MIN_BASE_SECONDS = 1; // floor for the shrink above, before Dex's extension
const MASH_STAMINA_LOCKOUT_SECONDS = 1;
const MASH_STAMINA_DEX_DRAIN_SECONDS_PER_INTERVAL = 0.3;
const MASH_STAMINA_MAX_DRAIN_SECONDS = 8; // ceiling for the above

// --- Sealed Shrine / Arcane Sigil / Wandering Satchel / Wounded Animal ---
const WOUNDED_ANIMAL_INSTANT_CHANCE = 30; // % chance "Try and save it" succeeds instantly, no QTE
// Mash-QTE success previously granted ONLY the pending-bleed-debuff
// reward (see resolveWoundedAnimalMash) — nothing for actually winning
// the QTE itself beyond that single-slot debuff. A small flat gold
// bonus on top, deliberately modest (a fraction of a locked room's
// gold), so clearing the Mash QTE always feels like it did something
// even on the (common) turn a debuff is already queued and unconsumed.
const WOUNDED_ANIMAL_MASH_BONUS_GOLD_RATIO = 0.3;
// Arcane Sigil's pre-fight buff amount — a separate floor-LINEAR formula
// (not getRewardMultiplier's compounding gold/material curve, which would
// start a flat stat buff at a token 25% of its floor-1 value) calibrated
// against the reference consumable buff {stat:'str',amount:5,duration:-1}.
const ARCANE_SIGIL_BASE_BUFF_AMOUNT = 6;
const ARCANE_SIGIL_BUFF_PER_FLOOR = 1.5;
const ARCANE_SIGIL_BUFF_STATS = ['str', 'int', 'dex', 'spd', 'def', 'con'];
// Wandering Satchel's 3 reward-option shapes, all further scaled by getRewardMultiplier.
const SATCHEL_GOLD_RATIO = 0.8;
const SATCHEL_MATERIAL_MIN = 3;
const SATCHEL_MATERIAL_MAX = 5;
const SATCHEL_MIXED_GOLD_RATIO = 0.4;
const SATCHEL_MIXED_MATERIAL_MIN = 2;
const SATCHEL_MIXED_MATERIAL_MAX = 3;

// Hidden floor-5 boss encounter (see DungeonGenerator's placeHiddenArena
// and the TILE_TYPES.HIDDEN_ENEMY case below): shake+darken plays over the
// dungeon view for HIDDEN_BOSS_TRANSITION_MS before the actual combat
// transition tears the renderer down.
const HIDDEN_BOSS_SHAKE_MS = 900;
const HIDDEN_BOSS_SHAKE_MAGNITUDE = 0.15;
const HIDDEN_BOSS_TRANSITION_MS = 1000;

/** Linearly interpolates between two `#rrggbb` colors at `t` (0 = colorA, 1 = colorB) — used for the Hold QTE's kill bar (see tickQTEProgress) so its color shifts continuously instead of flipping abruptly between two fixed states. */
function lerpColor(colorA, colorB, t) {
  const a = [1, 3, 5].map((i) => parseInt(colorA.slice(i, i + 2), 16));
  const b = [1, 3, 5].map((i) => parseInt(colorB.slice(i, i + 2), 16));
  const mix = a.map((c, i) => Math.round(c + (b[i] - c) * t));
  return `rgb(${mix[0]}, ${mix[1]}, ${mix[2]})`;
}

/** Rotates a facing direction by `steps` 90-degree turns (+1 clockwise, -1 counterclockwise). */
function rotateFacing(facing, steps) {
  const idx = FACING_ORDER.indexOf(facing);
  return FACING_ORDER[(idx + steps + FACING_ORDER.length) % FACING_ORDER.length];
}

/** Hover-tooltip content for the HUD's events-remaining indicator. */
function eventsBreakdownHTML(counts) {
  return `
    <div class="tt-row"><span>${t('explore.locked_rooms_remaining')}</span><span>${counts.lockedRooms}</span></div>
    <div class="tt-row"><span>${t('explore.chests_remaining')}</span><span>${counts.chests}</span></div>
    <div class="tt-row"><span>${t('explore.temporal_chests_remaining')}</span><span>${counts.temporalChests}</span></div>
    <div class="tt-row"><span>${t('explore.shrines_remaining')}</span><span>${counts.shrines}</span></div>
    <div class="tt-row"><span>${t('explore.sigils_remaining')}</span><span>${counts.sigils}</span></div>
    <div class="tt-row"><span>${t('explore.satchels_remaining')}</span><span>${counts.satchels}</span></div>
    <div class="tt-row"><span>${t('explore.wounded_animals_remaining')}</span><span>${counts.woundedAnimals}</span></div>
  `;
}

/**
 * ExploreState — dungeon crawling. Top-level peer of FightState. Rendered
 * as an oblique 3D scene by DungeonRenderer3D, mounted into `.dungeon-grid`.
 * Walking onto an enemy tile calls app.startCombat(), which immediately
 * transitions to FIGHT — no intermediate flag.
 */
export class ExploreState {
  constructor(app) {
    this.app = app;
    this._onKeydown = this.handleKeydown.bind(this);
    this._onKeyup = this.handleKeyup.bind(this);
    this._onBlur = () => { this._heldKeys.clear(); this._heldTouchActions.clear(); };
    // Safety net for a plain tab close/refresh while exploring: fog reveals
    // and position update on every frame in memory, but only reach
    // localStorage via throttled/movement-triggered saves (see tick(),
    // updateContinuousMovement) — someone who stops moving to admire the
    // map then closes the tab would otherwise lose whatever was revealed
    // since the last save. pagehide (not beforeunload) since it also fires
    // on mobile Safari's app-switch/backgrounding, not just an actual close.
    this._onPageHide = () => {
      this.syncFogToDungeon();
      this.app.saveSystem.save();
    };
    this.pause = new PauseOverlay(app);
    this.qte = null;
    // 'normal' | 'modal' | 'qte' | 'result' — replaces what used to be two
    // separate flags (a `resultOpen` boolean plus `this.qte` doubling as its
    // own boolean gate). They were never actually independent: startQTE()
    // set resultOpen=true BEFORE constructing this.qte, and it stayed true
    // continuously through the QTE AND its trailing result modal — qte was
    // really a sub-state of "something is blocking normal play", not a
    // sibling of it. this.qte itself is unchanged (still the QTE's own live
    // data object, still what handleKeydown checks to route into
    // handleQTEKeydown) — it just no longer needs to double as a mode flag.
    this.mode = 'normal';
    // Continuous-movement input state — see updateContinuousMovement.
    // Two separate sets (rather than one shared "held actions" set)
    // because keyboard naturally tracks raw KEYS (so e.g. releasing 'w'
    // while 'arrowup' is still down doesn't wrongly cancel "forward"),
    // while touch buttons are already action-named — resolved together
    // each tick instead.
    this._heldKeys = new Set();
    this._heldTouchActions = new Set();
    this._moveAutosaveTimer = 0;
    this._fogSyncTimer = 0;
  }

  enter(root) {
    this.root = root;
    this.player = this.app.createPlayer();
    root.innerHTML = `
      <div class="explore-screen">
        <div class="explore-hud"></div>
        <div class="dungeon-grid"></div>
        <div class="floor-message"></div>
        <div class="descend-prompt"></div>
        <div class="mobile-controls">
          <div class="touch-dpad">
            <button class="touch-dpad-btn" data-move="forward" aria-label="Forward">${arrowIconSVG('up')}</button>
            <button class="touch-dpad-btn" data-move="backward" aria-label="Backward">${arrowIconSVG('down')}</button>
            <button class="touch-dpad-btn" data-move="strafeLeft" aria-label="Strafe left">${arrowIconSVG('left')}</button>
            <button class="touch-dpad-btn" data-move="strafeRight" aria-label="Strafe right">${arrowIconSVG('right')}</button>
          </div>
          <div class="touch-camera-zone"></div>
          <div class="touch-turn-btns">
            <button class="touch-turn-btn" data-turn="-1" aria-label="Turn left">${arrowIconSVG('left')}</button>
            <button class="touch-turn-btn" data-turn="1" aria-label="Turn right">${arrowIconSVG('right')}</button>
          </div>
        </div>
        <button class="mobile-pause-btn explore-mobile-pause" aria-label="Pause">&#10074;&#10074;</button>
      </div>`;
    this.els = {
      screen: root.querySelector('.explore-screen'),
      hud: root.querySelector('.explore-hud'),
      grid: root.querySelector('.dungeon-grid'),
      msg: root.querySelector('.floor-message'),
      descend: root.querySelector('.descend-prompt'),
    };
    this.renderer3d = new DungeonRenderer3D(this.app);
    // This ExploreState instance is a long-lived singleton (StateManager
    // creates it once), but a fresh DungeonRenderer3D is created on every
    // enter() — reset the sync guard so syncDungeon3D() below doesn't
    // wrongly no-op just because `run.dungeon` didn't change (e.g.
    // returning from combat on the same floor), leaving the new renderer's
    // geometry never built.
    this._synced3DDungeon = null;
    this.renderer3d.mount(this.els.grid);
    this.minimap = new Minimap(this.app);
    this.minimap.mount(this.els.screen, { onClick: () => this.openMinimapExpanded() });
    this.tooltip = new TooltipManager();
    this.syncDungeon3D();
    this.syncPlayer3D();
    const { playerPosition } = this.app.gameState.run;
    const spawnX = Math.round(playerPosition.x);
    const spawnY = Math.round(playerPosition.y);
    this.revealNearbyTiles(playerPosition.x, playerPosition.y);
    this._lastTriggerTileKey = `${spawnX},${spawnY}`;
    this.app.input.on('keydown', this._onKeydown);
    this.app.input.on('keyup', this._onKeyup);
    window.addEventListener('blur', this._onBlur);
    window.addEventListener('pagehide', this._onPageHide);
    this._heldKeys.clear();
    this._heldTouchActions.clear();
    this.mountTouchControls();
    this._onWheel = (e) => {
      if (!this.canAct()) return;
      e.preventDefault();
      // Normalized to one fixed step per wheel event, not scaled by the
      // raw deltaY magnitude — that varies wildly between a notched mouse
      // wheel and a trackpad's continuous stream, so treating every event
      // as "one tick" keeps zoom speed consistent across input devices.
      this.adjustZoom(Math.sign(e.deltaY) * CAMERA_ZOOM_STEP_PERCENT);
    };
    this.els.grid.addEventListener('wheel', this._onWheel, { passive: false });
    this.renderHUD();
    // Re-entering explore after combat (see handleTileEffect's ENEMY case,
    // which captures this before app.startCombat() tears the old renderer
    // down) — best-effort only, since combat resolves automatically with
    // no click to hang a Pointer Lock request on (see
    // DungeonRenderer3D.requestPointerLockIfPossible).
    if (this._pendingMouseLookRestore) {
      this.renderer3d.requestPointerLockIfPossible();
      this._pendingMouseLookRestore = false;
    }
  }

  /** Rebuilds the 3D renderer's tile geometry when run.dungeon changes (new floor). No-op if already in sync. */
  syncDungeon3D() {
    if (!this.renderer3d) return;
    const { dungeon } = this.app.gameState.run;
    if (dungeon && dungeon !== this._synced3DDungeon) {
      this.renderer3d.setDungeon(dungeon);
      this._synced3DDungeon = dungeon;
    }
  }

  /** Pushes the current position/facing to the 3D renderer's camera+sprite target. */
  syncPlayer3D() {
    if (!this.renderer3d) return;
    const run = this.app.gameState.run;
    this.renderer3d.setPlayerState({ x: run.playerPosition.x, y: run.playerPosition.y, facing: run.facing });
  }

  exit() {
    this.app.input.off('keydown', this._onKeydown);
    this.app.input.off('keyup', this._onKeyup);
    window.removeEventListener('blur', this._onBlur);
    window.removeEventListener('pagehide', this._onPageHide);
    this._heldKeys.clear();
    this._heldTouchActions.clear();
    this.els.grid?.removeEventListener('wheel', this._onWheel);
    this.renderer3d?.unmount();
    this.minimap?.unmount();
    this.tooltip?.destroy();
    this.pause.unmount();
  }

  /** True while grid movement / camera-turn / look input should actually take effect — mirrors handleKeydown's own guard. */
  canAct() {
    return !this.app.gameState.paused && this.mode === 'normal';
  }

  /**
   * Wires the on-screen touch controls (see the .mobile-controls markup in
   * enter()) — a left-side 4-way D-pad for omnidirectional movement (held
   * for as long as the finger stays down, exactly like a held keyboard key
   * — see updateContinuousMovement, which resolves _heldTouchActions the
   * same way it resolves _heldKeys), 2 right-side quick-turn buttons
   * (single-tap 90° snaps, mirroring the left/right arrow keys), and a
   * right-side drag zone that feeds raw touch-move deltas straight into
   * DungeonRenderer3D.applyLookDelta — the touch equivalent of mouse-look,
   * since touch has no Pointer Lock relative-movement deltas to read. CSS
   * (`@media (hover:none) and (pointer:coarse)`) hides all of this on
   * mouse/trackpad devices, so listeners here are harmless no-ops on
   * desktop rather than needing a JS feature-detect gate too.
   */
  mountTouchControls() {
    const root = this.root;
    root.querySelectorAll('.touch-dpad-btn').forEach((btn) => {
      const action = btn.dataset.move;
      const start = (e) => { e.preventDefault(); this._heldTouchActions.add(action); };
      const stop = () => this._heldTouchActions.delete(action);
      btn.addEventListener('touchstart', start, { passive: false });
      btn.addEventListener('touchend', stop);
      btn.addEventListener('touchcancel', stop);
    });

    root.querySelectorAll('.touch-turn-btn').forEach((btn) => {
      const steps = Number(btn.dataset.turn);
      btn.addEventListener('touchstart', (e) => {
        e.preventDefault();
        if (this.canAct()) this.turnPlayer(steps);
      }, { passive: false });
    });

    root.querySelector('.explore-mobile-pause')?.addEventListener('touchstart', (e) => {
      e.preventDefault();
      this.app.togglePause();
    }, { passive: false });

    const zone = root.querySelector('.touch-camera-zone');
    let lastX = null;
    let lastY = null;
    zone?.addEventListener('touchstart', (e) => {
      const t = e.touches[0];
      lastX = t.clientX;
      lastY = t.clientY;
    }, { passive: true });
    zone?.addEventListener('touchmove', (e) => {
      if (lastX === null || !this.canAct()) return;
      e.preventDefault();
      const t = e.touches[0];
      const dx = t.clientX - lastX;
      const dy = t.clientY - lastY;
      lastX = t.clientX;
      lastY = t.clientY;
      this.renderer3d?.applyLookDelta(dx, dy);
    }, { passive: false });
    const endTouch = () => { lastX = null; lastY = null; };
    zone?.addEventListener('touchend', endTouch);
    zone?.addEventListener('touchcancel', endTouch);
  }

  onPauseToggled() {
    if (this.app.gameState.paused) {
      // Opening the pause menu is the natural "I'm done exploring for now"
      // moment — flush the fog canvas + a save right here rather than
      // relying on the next throttled tick()/movement-triggered save,
      // since the player may well close the tab from the pause menu
      // without moving again first.
      this.syncFogToDungeon();
      this.app.saveSystem.save();
      this.pause.mount(this.root, {
        canAbandon: true,
        allowConsumables: true,
        onUseConsumable: (id) => this.useConsumable(id),
      });
    } else {
      this.pause.unmount();
    }
  }

  /** Uses a consumable's explorationEffect (distinct from its combatEffect). */
  useConsumable(id) {
    const cfg = getConsumableConfig(id);
    if (!cfg) return;
    const effect = cfg.explorationEffect ?? {};

    const name = tData('consumable', id, cfg.name);
    if (effect.healMaxPercent) {
      const healed = this.player.heal(Math.ceil(this.player.getMaxHealth() * (effect.healMaxPercent / 100)));
      this.app.gameState.addLog(t('log.used_consumable_heal', { name, n: healed }));
    }
    if (effect.buff) {
      this.app.gameState.run.explorationBuffs = this.app.gameState.run.explorationBuffs ?? [];
      const alreadyQueued = effect.noStack
        && this.app.gameState.run.explorationBuffs.some((b) => b.effect === effect.buff.effect);
      if (!alreadyQueued) {
        this.app.gameState.run.explorationBuffs.push(effect.buff);
        this.app.gameState.addLog(t('log.used_consumable_buff', { name }));
      }
    }

    this.app.inventory.useConsumable(id, 1);
    this.app.trackConsumableUsed(id);
    this.app.gameState.run.savedHealth = this.player.currentHealth;
    this.app.saveSystem.save();
    this.renderHUD();
  }

  tick(dt) {
    this.updateContinuousMovement(dt);
    const run = this.app.gameState.run;
    if (run.dungeon) {
      this.revealNearbyTiles(run.playerPosition.x, run.playerPosition.y);
      this._fogSyncTimer += dt;
      if (this._fogSyncTimer >= FOG_SYNC_INTERVAL_SECONDS) {
        this._fogSyncTimer = 0;
        this.syncFogToDungeon();
      }
    }
    this.minimap?.update(dt, this.renderer3d?.getLookYaw());
    if (run.floorMessage?.timer > 0) {
      run.floorMessage.timer -= dt;
      if (run.floorMessage.timer <= 0) {
        run.floorMessage = null;
        this.els.msg.textContent = '';
      }
    }

    if (this.qte) {
      // Memory's reveal choreography is un-clocked against the fail-timer —
      // it only starts counting down once the input phase begins (see
      // buildMemoryQTE/playMemoryReveal).
      const memoryReveal = this.qte.type === QTE_TYPES.MEMORY && this.qte.memory?.phase === 'reveal';
      if (!memoryReveal) {
        this.qte.remaining -= dt;
        if (this.qte.remaining <= 0) {
          // Hold's win condition is checked ONLY here, at timeout — see
          // buildHoldQTE's doc comment. Every other type simply fails on
          // timeout (their success paths resolve earlier, mid-session).
          if (this.qte.type === QTE_TYPES.HOLD) {
            this.finishQTE(this.isHoldInSlit(), 'timeout');
          } else {
            this.finishQTE(false);
          }
        } else {
          this.updateQTETimerUI();
          this.tickQTEProgress(dt);
        }
      }
    }
  }

  handleKeydown(e) {
    if (this.qte) {
      this.handleQTEKeydown(e);
      return;
    }
    if (this.app.gameState.paused || this.mode !== 'normal') return;
    const key = e.key;
    // WASD/arrow-up/arrow-down are tracked as HELD (see updateContinuousMovement,
    // which reads _heldKeys every physics tick) rather than moving once per
    // keydown — movement is now continuous/omnidirectional, not one tile per
    // press. Left/right arrows still turn in place immediately on keydown —
    // that's a discrete camera snap, unrelated to positional movement.
    const moveKeys = new Set(['w', 'arrowup', 's', 'arrowdown', 'a', 'd']);
    const turnSteps = { arrowleft: -1, arrowright: 1 };
    if (moveKeys.has(key)) {
      e.originalEvent?.preventDefault?.();
      this._heldKeys.add(key);
    } else if (turnSteps[key] !== undefined) {
      e.originalEvent?.preventDefault?.();
      this.turnPlayer(turnSteps[key]);
    } else if (key === 'm') {
      // Same modal the corner minimap's own click already opens — the
      // mode!=='normal' guard above already keeps this a no-op if it's open.
      this.openMinimapExpanded();
    } else if (key === 'i') {
      this.adjustZoom(-CAMERA_ZOOM_STEP_PERCENT); // zoom in (toward 0% / first-person)
    } else if (key === 'o') {
      this.adjustZoom(CAMERA_ZOOM_STEP_PERCENT); // zoom out (toward 100% / 3x view)
    }
  }

  /** Releases a held movement key (see handleKeydown) — always tracked regardless of pause/QTE/modal state, so a key released while one of those was active doesn't read as still held once it ends. */
  handleKeyup(e) {
    this._heldKeys.delete(e.key);
    this.handleQTEKeyup(e);
  }

  /** Nudges the live FOV/zoom setting (see CameraSettings.js) by `deltaPercent`, clamped — shared by the scroll-wheel handler and the I/O keys. No-ops while Auto FOV is on, since cameraZoom is driven by camera angle then, not manual input. */
  adjustZoom(deltaPercent) {
    const settings = this.app.gameState.settings;
    if (settings.autoFOV) return;
    const current = settings.cameraZoom ?? DEFAULT_CAMERA_ZOOM_PERCENT;
    settings.cameraZoom = clamp(current + deltaPercent, CAMERA_ZOOM_MIN_PERCENT, CAMERA_ZOOM_MAX_PERCENT);
  }

  /**
   * Indexed by "x,y" and rebuilt whenever `run.dungeon` changes reference
   * (new floor) — a plain linear `tiles.find()` was fine back when this
   * only ran a few times per discrete step, but continuous movement's
   * per-frame collision checks (see circleHitsWall) call this many times
   * every physics tick, so an O(1) lookup actually matters now.
   */
  getTileAt(x, y) {
    const dungeon = this.app.gameState.run.dungeon;
    if (!dungeon) return null;
    if (this._tileIndexFor !== dungeon) {
      this._tileIndex = new Map(dungeon.tiles.map((t) => [`${t.x},${t.y}`, t]));
      this._tileIndexFor = dungeon;
    }
    return this._tileIndex.get(`${x},${y}`) ?? null;
  }

  /** Sums a numeric passive template field across the player's equipped moves (e.g. Thief's Skill's qteBonusSeconds). */
  getPassiveSum(field) {
    return this.player.moves.reduce((sum, m) => sum + (m.template[field] ?? 0), 0);
  }

  /** True if any equipped move's template sets a truthy flag field (e.g. Thief's Experience's noQteFailDamage). */
  hasPassiveFlag(field) {
    return this.player.moves.some((m) => m.template[field]);
  }

  /**
   * Marks every tile within a true Euclidean REVEAL_RADIUS (or
   * TORCH_REVEAL_RADIUS with Torch equipped) of the CONTINUOUS point
   * (px,py) as explored — not just the tile actually stood on — so it
   * fills in permanently instead of reverting once the player walks away.
   * Called every single frame from tick() with the player's live,
   * unrounded position (see REVEAL_RADIUS's comment). Does two genuinely
   * separate things now: (1) the tile-level "visited" bookkeeping below —
   * kept purely because it's cheap and it's still what run.tilesExplored
   * (the HUD's Explored %) is computed from, since dungeon.tilesTotal
   * itself only counts walkable tiles — and (2) delegating the actual
   * ON-SCREEN minimap reveal to Minimap.revealCircle(), which paints a
   * true pixel-resolution, tile-grid-independent soft circle instead of
   * lighting up whole tile squares. The two are deliberately decoupled:
   * the visual fog can (and does) look smoother/rounder than the coarse
   * per-tile percentage it's paired with.
   */
  revealNearbyTiles(px, py) {
    const run = this.app.gameState.run;
    const dungeon = run.dungeon;
    if (!dungeon) return;
    const hasTorch = this.app.inventory.getEquippedItems().offHand === 'torch';
    const radius = hasTorch ? TORCH_REVEAL_RADIUS : REVEAL_RADIUS;
    const radiusSq = radius * radius;
    dungeon.tiles.forEach((tile) => {
      if (tile.explored) return;
      const dx = tile.x - px;
      const dy = tile.y - py;
      if (dx * dx + dy * dy > radiusSq) return;
      tile.explored = true;
      // meta.hidden tiles (the floor-5 secret hallway/arena) were never
      // counted into dungeon.tilesTotal in the first place — counting
      // them here too would push "Explored" past 100%.
      if (tile.type !== TILE_TYPES.WALL && !tile.meta.hidden) run.tilesExplored += 1;
    });
    this.minimap?.revealCircle(px, py, radius);
  }

  /**
   * PNG-encodes the corner minimap's current fog-of-war pixels onto
   * `run.dungeon.fogData` so the exact revealed shape (not an
   * approximation reconstructed from visited tiles) survives a save,
   * archive, or reload — see FOG_SYNC_INTERVAL_SECONDS's comment for the
   * throttling rationale. A no-op if there's no dungeon/minimap yet.
   */
  syncFogToDungeon() {
    const run = this.app.gameState.run;
    if (!run.dungeon || !this.minimap) return;
    const fogData = this.minimap.getFogDataUrl();
    if (fogData) run.dungeon.fogData = fogData;
  }

  /**
   * Snaps the camera to the next/previous 90° zone in place — no
   * movement, no tile effects. Purely a camera action now (see
   * DungeonRenderer3D.turnCameraSnap): grid position/visibility don't
   * change, so there's nothing else here to resync. run.facing is kept
   * updated as a mirror of the target zone purely for save-file
   * continuity and to seed the next floor's starting camera direction
   * (see syncPlayer3D/DungeonRenderer3D.setPlayerState) — it no longer
   * drives movement itself.
   */
  turnPlayer(steps) {
    const run = this.app.gameState.run;
    if (!run.dungeon) return;
    const currentZone = this.renderer3d.getFacingZone() ?? run.facing;
    this.renderer3d.turnCameraSnap(steps);
    run.facing = rotateFacing(currentZone, steps);
    // No explicit minimap refresh needed here — the corner minimap's
    // player marker is a per-frame CSS overlay driven straight off the
    // live camera yaw (see Minimap.update()/_applyArrowRotation()), so it
    // picks up a pure snap-turn on its own, same as free mouse-look.
    this.app.saveSystem.save();
  }

  /** True if solid-body movement should be blocked by tile (tx,ty) — anything but a walkable in-bounds tile, matching the old grid model's "can I step here" rule, just now checked continuously against a circle instead of once per whole-tile hop. */
  isTileSolid(tx, ty) {
    const tile = this.getTileAt(tx, ty);
    return !tile || !tile.isWalkable();
  }

  /**
   * True if a circle of PLAYER_COLLISION_RADIUS centered at (cx,cy)
   * (tile-space) overlaps any solid tile's footprint. Tile (tx,ty) occupies
   * the unit square [tx-0.5, tx+0.5] x [ty-0.5, ty+0.5] in tile-space —
   * matching DungeonRenderer3D's own worldX = tile.x * TILE_SIZE convention
   * (tile centers sit on integers) — so this is a standard circle-vs-AABB
   * closest-point test against the 3x3 neighborhood of tiles around the
   * circle's own (rounded) position, comfortably covering any radius < 1.
   */
  circleHitsWall(cx, cy) {
    const tcx = Math.round(cx);
    const tcy = Math.round(cy);
    for (let ty = tcy - 1; ty <= tcy + 1; ty += 1) {
      for (let tx = tcx - 1; tx <= tcx + 1; tx += 1) {
        if (!this.isTileSolid(tx, ty)) continue;
        const closestX = clamp(cx, tx - 0.5, tx + 0.5);
        const closestY = clamp(cy, ty - 0.5, ty + 0.5);
        const ddx = cx - closestX;
        const ddy = cy - closestY;
        if (ddx * ddx + ddy * ddy < PLAYER_COLLISION_RADIUS * PLAYER_COLLISION_RADIUS) return true;
      }
    }
    return false;
  }

  /**
   * Axis-separated collision resolution (the standard "slide along walls"
   * technique): tries the X move and the Y move independently rather than
   * testing the full diagonal step at once, so bumping into a wall at an
   * angle only stops the into-wall component instead of halting movement
   * entirely — walking diagonally alongside a wall keeps working smoothly.
   */
  resolveMovement(px, py, dx, dy) {
    let x = px;
    let y = py;
    const nx = x + dx;
    if (!this.circleHitsWall(nx, y)) x = nx;
    const ny = y + dy;
    if (!this.circleHitsWall(x, ny)) y = ny;
    return { x, y };
  }

  /** Resolves the keyboard/touch-held movement keys into a normalized (forward, strafe) pair — see updateContinuousMovement. */
  getHeldMoveInput() {
    let fwd = 0;
    let strafe = 0;
    if (this._heldKeys.has('w') || this._heldKeys.has('arrowup') || this._heldTouchActions.has('forward')) fwd += 1;
    if (this._heldKeys.has('s') || this._heldKeys.has('arrowdown') || this._heldTouchActions.has('backward')) fwd -= 1;
    if (this._heldKeys.has('d') || this._heldTouchActions.has('strafeRight')) strafe += 1;
    if (this._heldKeys.has('a') || this._heldTouchActions.has('strafeLeft')) strafe -= 1;
    return { fwd, strafe };
  }

  /**
   * The core of free movement — called every physics tick (see tick()).
   * Resolves whichever movement keys/touch buttons are currently held into
   * a direction relative to the free-look camera's CURRENT, unsnapped yaw
   * (DungeonRenderer3D.getLookYaw — not getFacingZone's nearest-cardinal
   * zone), so the character can walk in any direction the camera is
   * actually pointing, not just the 4 old cardinal steps. Integrates that
   * direction by PLAYER_MOVE_SPEED * the live Walk Speed setting * dt,
   * resolves it against nearby walls (resolveMovement), and pushes the
   * result straight to the renderer via
   * setPlayerPositionLive (no tween — see that method's own comment).
   * run.facing is still refreshed from getFacingZone() on an actual move,
   * purely for save-file continuity/next-floor spawn-seeding (unaffected
   * by any of this, per setPlayerState's own doc comment) — nothing else
   * reads it as driving movement anymore.
   */
  updateContinuousMovement(dt) {
    if (!this.canAct()) return;
    const run = this.app.gameState.run;
    if (!run.dungeon || !this.renderer3d) return;
    const { fwd, strafe } = this.getHeldMoveInput();
    if (fwd === 0 && strafe === 0) return;
    const yaw = this.renderer3d.getLookYaw();
    if (yaw === undefined) return;
    // Matches DungeonRenderer3D's own (sin(yaw), -cos(yaw)) forward
    // convention exactly (world-x <-> tile-x, world-z <-> tile-y) — see
    // that file's _facingVec — so "forward" here always agrees with
    // whichever way the camera is actually looking. Right = forward
    // rotated +90°.
    const fx = Math.sin(yaw);
    const fy = -Math.cos(yaw);
    const rx = Math.cos(yaw);
    const ry = Math.sin(yaw);
    let mx = fx * fwd + rx * strafe;
    let my = fy * fwd + ry * strafe;
    const len = Math.hypot(mx, my);
    if (len === 0) return;
    mx /= len;
    my /= len;

    // Read fresh every call (not cached) so dragging the Walk Speed slider
    // mid-run takes effect on the very next physics tick, same as
    // DungeonRenderer3D.applyLookDelta does for Camera Sensitivity.
    const walkSpeed = this.app.gameState.settings.walkSpeed ?? DEFAULT_WALK_SPEED_PERCENT / 100;
    const step = PLAYER_MOVE_SPEED * walkSpeed * dt;
    const resolved = this.resolveMovement(run.playerPosition.x, run.playerPosition.y, mx * step, my * step);
    if (resolved.x === run.playerPosition.x && resolved.y === run.playerPosition.y) return; // fully blocked

    run.playerPosition = resolved;
    run.facing = this.renderer3d.getFacingZone() ?? run.facing;
    this.renderer3d.setPlayerPositionLive(resolved.x, resolved.y);

    this._moveAutosaveTimer += dt;
    if (this._moveAutosaveTimer >= MOVE_AUTOSAVE_INTERVAL_SECONDS) {
      this._moveAutosaveTimer = 0;
      // Sync the fog canvas right before this save rather than waiting for
      // tick()'s own throttled FOG_SYNC_INTERVAL_SECONDS check (which runs
      // after this call, same frame) — otherwise every autosave persists
      // fog as of up to FOG_SYNC_INTERVAL_SECONDS ago instead of now.
      this.syncFogToDungeon();
      this.app.saveSystem.save();
    }
    this.checkTileTrigger(resolved.x, resolved.y);
  }

  /**
   * Fires the same one-shot-per-arrival tile effects the old discrete
   * grid-step model did (chests, doors, enemies, stairs message, elevator,
   * vendor), but now edge-triggered off which tile the continuous position
   * is nearest to (Math.round), rather than off an actual whole-tile hop —
   * so it still fires exactly once per arrival on a given tile, not every
   * single frame spent standing on it.
   */
  checkTileTrigger(x, y) {
    const tx = Math.round(x);
    const ty = Math.round(y);
    const key = `${tx},${ty}`;
    if (this._lastTriggerTileKey === key) return;
    this._lastTriggerTileKey = key;
    const tile = this.getTileAt(tx, ty);
    if (!tile) return;
    // The permanent "explored" HUD/save/minimap marker is no longer tied
    // to tile-arrival at all — see tick(), which calls revealNearbyTiles()
    // every frame off the player's live continuous position, unrelated to
    // what's currently visible on-screen (DungeonRenderer3D's own live
    // radial light also tracks the continuous position every frame,
    // separately).

    // Enemy tiles hand off to FightState immediately — nothing left on
    // this screen to render or save. Autosaving here would also let a
    // refresh-mid-fight consume the enemy tile for free (it's already
    // flipped to FLOOR by handleTileEffect before combat even starts),
    // so a fight in progress is deliberately the one checkpoint we skip.
    // HIDDEN_ENEMY is the same story, just with a shake/darken beat
    // before the (still deferred, still one-shot) combat transition.
    if (tile.type === TILE_TYPES.ENEMY || tile.type === TILE_TYPES.HIDDEN_ENEMY) {
      this.handleTileEffect(tile);
      return;
    }

    this.handleTileEffect(tile);
    this.syncDungeon3D(); // no-op unless handleTileEffect just generated a new floor (STAIRS)
    this.syncFogToDungeon(); // see updateContinuousMovement's own call for why this precedes the save
    this.app.saveSystem.save();
    this._moveAutosaveTimer = 0;
    this.renderHUD();
  }

  handleTileEffect(tile) {
    const { app } = this;
    const run = app.gameState.run;
    switch (tile.type) {
      case TILE_TYPES.ENEMY: {
        // The boss always fights alone, and only once every other enemy
        // tile on the floor is already cleared — run.enemiesRemaining only
        // decrements once per cleared tile-encounter (on victory), so ===1
        // here means this boss tile is the only encounter left, with zero
        // extra tracking state needed. Tile stays untouched (still walkable,
        // still an ENEMY tile) so simply walking away and clearing the rest
        // of the floor first "just works."
        if (tile.meta.isBoss && run.enemiesRemaining > 1) {
          run.floorMessage = { text: t('explore.boss_locked'), timer: 2 };
          break;
        }
        const groupSize = tile.meta.isBoss ? 1 : (tile.meta.groupSize ?? 1);
        const enemyIds = tile.meta.isBoss
          ? [app.progression.getBossId(run.floor)]
          : Array.from({ length: groupSize }, () => app.progression.getRandomEnemyId(run.floor));
        run.savedHealth = this.player.currentHealth;
        tile.type = TILE_TYPES.FLOOR;
        // Captured here (not read back off the renderer later — it's
        // about to be torn down by the state switch below) so enter()
        // knows whether to try re-engaging mouse-look once we're back.
        this._pendingMouseLookRestore = this.renderer3d?.isPointerLocked() ?? false;
        app.startCombat(enemyIds); // immediate setState(FIGHT)
        break;
      }
      case TILE_TYPES.STAIRS: {
        // No longer auto-descends — renderHUD() shows a "Descend?" prompt
        // whenever the player is standing here with 0 enemies remaining,
        // so stepping onto the stairs no longer forces an instant floor
        // change and cuts a looting run short.
        if (run.enemiesRemaining > 0) {
          run.floorMessage = { text: t('explore.enemies_wander'), timer: 2 };
        }
        break;
      }
      case TILE_TYPES.LOCKED_DOOR: {
        if (tile.meta.resolved) break;
        tile.meta.resolved = true;
        this.startQTE((success) => this.resolveLockedDoor(success, tile), { type: QTE_TYPES.TIMING });
        break;
      }
      case TILE_TYPES.TREASURE: {
        if (tile.meta.resolved) break;
        tile.meta.resolved = true;
        this.startQTE((success) => this.resolveTreasure(success, tile), { type: QTE_TYPES.ARROW });
        break;
      }
      case TILE_TYPES.TEMPORAL_CHEST: {
        if (tile.meta.resolved) break;
        tile.meta.resolved = true;
        this.startQTE((success) => this.resolveTemporalChest(success, tile), { type: QTE_TYPES.COMBO, difficultyMultiplier: TEMPORAL_CHEST_ARROW_MULTIPLIER });
        break;
      }
      case TILE_TYPES.SEALED_SHRINE: {
        if (tile.meta.resolved) break;
        tile.meta.resolved = true;
        this.startQTE((success, reason) => this.resolveSealedShrine(success, tile, reason), { type: QTE_TYPES.HOLD });
        break;
      }
      case TILE_TYPES.ARCANE_SIGIL: {
        if (tile.meta.resolved) break;
        tile.meta.resolved = true;
        this.startQTE((success) => this.resolveArcaneSigil(success, tile), { type: QTE_TYPES.MEMORY });
        break;
      }
      case TILE_TYPES.WANDERING_SATCHEL: {
        if (tile.meta.resolved) break;
        tile.meta.resolved = true;
        this.showSatchelPicker(tile);
        break;
      }
      case TILE_TYPES.WOUNDED_ANIMAL: {
        if (tile.meta.resolved) break;
        tile.meta.resolved = true;
        this.showWoundedAnimalChoice(tile);
        break;
      }
      case TILE_TYPES.HIDDEN_ENEMY: {
        // One-shot, mirrors the ENEMY case — `triggering` additionally
        // guards the shake/darken window itself (stepping off and back on
        // before the timeout below fires must not double-schedule combat).
        if (tile.meta.resolved || tile.meta.triggering) break;
        tile.meta.triggering = true;
        run.savedHealth = this.player.currentHealth;
        this._pendingMouseLookRestore = this.renderer3d?.isPointerLocked() ?? false;
        this.renderer3d?.triggerShake(HIDDEN_BOSS_SHAKE_MS, HIDDEN_BOSS_SHAKE_MAGNITUDE);
        this.els.screen.classList.add('screen-darken');
        // The shake+darken plays out over the dungeon view itself, so the
        // actual combat transition (which tears the renderer down) is
        // deliberately deferred a beat rather than firing immediately —
        // unlike the ENEMY case (which flips its tile the instant combat
        // starts, in the same synchronous tick), the flip here is held off
        // until this timeout actually fires, so a refresh during this
        // window finds the encounter still fully intact on disk (nothing
        // above this point ever gets saved), exactly like a regular enemy.
        setTimeout(() => {
          tile.meta.resolved = true;
          tile.type = TILE_TYPES.FLOOR;
          app.startCombat('vanguard_of_darkness', { noScale: true });
        }, HIDDEN_BOSS_TRANSITION_MS);
        break;
      }
      case TILE_TYPES.ELEVATOR: {
        // Never resolved/consumed — always reopens the picker, every visit.
        this.showElevatorPicker();
        break;
      }
      case TILE_TYPES.VENDOR: {
        // Never resolved/consumed — always reopens the fusion UI, every visit.
        this.showVendor();
        break;
      }
      default:
        break;
    }
  }

  /**
   * Pointer Lock hides/freezes the cursor, which would make any of the
   * click-driven modals below (result/card-pick/minimap-expanded) totally
   * unusable while it's engaged — release it (if currently on) the instant
   * one of them opens, remembering that it WAS on so the matching
   * restoreMouseLookAfterEvent() call (in that same modal's closing click
   * handler) knows to try re-engaging it, per user request: mouse-look
   * should only resume after an event if it was active when that event began.
   */
  pauseMouseLookForEvent() {
    this._pendingMouseLookRestore = this.renderer3d?.isPointerLocked() ?? false;
    this.renderer3d?.releasePointerLock();
  }

  /** Re-engages mouse-look after an event's closing click, but only if pauseMouseLookForEvent() found it active when that event began. */
  restoreMouseLookAfterEvent() {
    if (!this._pendingMouseLookRestore) return;
    this._pendingMouseLookRestore = false;
    this.renderer3d?.requestPointerLockIfPossible();
  }

  /**
   * Persistent result window (per user request): stays on screen until
   * explicitly closed, rather than just flashing a log line. Movement
   * is blocked while it's open.
   */
  showResult(title, lines) {
    // No pauseMouseLookForEvent()/mode='modal' here — showResult() is only
    // ever reached from finishQTE()'s onResolve() chain, which has already
    // set mode='result' (and mouse-look was already suspended back when the
    // QTE itself started) — see finishQTE's terminal path.
    const modal = document.createElement('div');
    modal.className = 'result-overlay';
    modal.innerHTML = `
      <div class="result-box">
        <h2>${title}</h2>
        ${lines.map((l) => `<div class="result-line">${l}</div>`).join('')}
        <button class="result-close">${t('explore.close')}</button>
      </div>`;
    this.root.appendChild(modal);
    modal.querySelector('.result-close').addEventListener('click', () => {
      modal.remove();
      this.mode = 'normal';
      this.restoreMouseLookAfterEvent();
    });
  }

  /**
   * Card-pick modal shown on every stairs descent — mirrors showResult()'s
   * blocking pattern, but the floor advance/dungeon regen/player rebuild
   * are deferred until a card is actually picked (see applyCardPick),
   * so the new floor's stat scaling and the player's cardBonusStats are
   * both in sync with the freshly-picked card from the moment it loads.
   *
   * The offer itself is NOT rolled here — it was already rolled once, the
   * moment this floor was generated (StateManager.generateFloor), and
   * saved immediately after. Rolling it fresh on every open used to let a
   * player reroll for free just by refreshing the page and walking back to
   * the stairs; reading the persisted run.cardOffer instead means a
   * refresh always shows the exact same offer. The one legitimate reroll
   * (see rerollCardOffer) is itself saved the instant it's used, so it
   * can't be undone by refreshing either.
   */
  showCardPick() {
    this.mode = 'modal';
    this.pauseMouseLookForEvent();
    const run = this.app.gameState.run;
    // Defensive fallback only — a save from before this feature existed
    // would have no cardOffer at all.
    if (!run.cardOffer) { run.cardOffer = rollCardOffer(); run.cardOfferRerolled = false; }

    const modal = document.createElement('div');
    modal.className = 'result-overlay';
    modal.innerHTML = `
      <div class="result-box card-pick-box">
        <h2>${t('explore.choose_card')}</h2>
        <div class="card-pick-grid"></div>
        <button class="card-reroll-btn">${t('explore.reroll_cards')}</button>
      </div>`;
    this.root.appendChild(modal);
    const grid = modal.querySelector('.card-pick-grid');
    const rerollBtn = modal.querySelector('.card-reroll-btn');

    const renderOffer = () => {
      grid.innerHTML = run.cardOffer.map((card, i) => cardTileHTML(card, i)).join('');
      grid.querySelectorAll('[data-card-index]').forEach((tile) => {
        this.tooltip.bind(tile, () => cardTooltipHTML(run.cardOffer[Number(tile.dataset.cardIndex)]));
        tile.addEventListener('click', () => {
          const picked = run.cardOffer[Number(tile.dataset.cardIndex)];
          modal.remove();
          this.mode = 'normal';
          this.restoreMouseLookAfterEvent();
          this.applyCardPick(picked);
        });
      });
      rerollBtn.disabled = run.cardOfferRerolled;
    };
    renderOffer();

    rerollBtn.addEventListener('click', () => {
      if (run.cardOfferRerolled) return;
      run.cardOffer = rollCardOffer();
      run.cardOfferRerolled = true;
      this.app.saveSystem.save();
      renderOffer();
    });
  }

  /**
   * Elevator floor-picker — mirrors showResult()'s blocking-modal pattern.
   * Lists every floor from 1 up to meta.highestFloorReached — the
   * permanent, cross-run depth record (see StateManager.generateFloor) —
   * except the current one, so a floor reached in a past run that ended in
   * death is still offered on a brand new run, not just floors generated
   * this specific run. Picking one hands off to useElevator() for the
   * actual travel.
   */
  showElevatorPicker() {
    this.mode = 'modal';
    this.pauseMouseLookForEvent();
    const { app } = this;
    const run = app.gameState.run;
    const maxReached = app.gameState.meta.highestFloorReached ?? 1;
    const otherFloors = Array.from({ length: maxReached }, (_, i) => i + 1).filter((f) => f !== run.floor);

    const modal = document.createElement('div');
    modal.className = 'result-overlay';
    modal.innerHTML = `
      <div class="result-box elevator-box">
        <h2>${t('explore.elevator_title')}</h2>
        ${otherFloors.length
          ? `<div class="result-line">${t('explore.elevator_prompt')}</div>
             <div class="elevator-floor-list">
               ${otherFloors.map((f) => `<button class="cat-btn" data-floor="${f}">${t('explore.elevator_floor_button', { n: f })}</button>`).join('')}
             </div>`
          : `<div class="result-line">${t('explore.elevator_no_floors')}</div>`}
        <button class="result-close">${t('explore.close')}</button>
      </div>`;
    this.root.appendChild(modal);
    modal.querySelectorAll('[data-floor]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const target = Number(btn.dataset.floor);
        modal.remove();
        this.mode = 'normal';
        this.restoreMouseLookAfterEvent();
        this.useElevator(target);
      });
    });
    modal.querySelector('.result-close').addEventListener('click', () => {
      modal.remove();
      this.mode = 'normal';
      this.restoreMouseLookAfterEvent();
    });
  }

  /** Actual travel, once a target floor is picked — mirrors applyCardPick's post-transition orchestration (player rebuild, 3D/minimap resync, save). */
  useElevator(targetFloor) {
    const { app } = this;
    const run = app.gameState.run;
    run.savedHealth = this.player.currentHealth;
    this.syncFogToDungeon(); // this floor's fog must be current before travelToFloor() archives it
    if (!app.travelToFloor(targetFloor)) return;
    app.gameState.addLog(t('log.elevator_traveled', { n: run.floor }));
    this.player = app.createPlayer();
    this.syncDungeon3D();
    this.syncPlayer3D();
    this.revealNearbyTiles(run.playerPosition.x, run.playerPosition.y);
    // Prevents checkTileTrigger from treating "arriving here" as a no-op
    // just because some earlier floor happened to leave the same tile-key
    // behind — a teleport always counts as a fresh arrival.
    this._lastTriggerTileKey = `${run.playerPosition.x},${run.playerPosition.y}`;
    this.app.saveSystem.save();
    this.renderHUD();
  }

  /**
   * The Vendor — two tabs. FUSION (the original UI): left is every card
   * currently owned (run.cards), click one to place it into the first
   * empty fusion slot; right is 2 input slots + 1 result-preview slot
   * showing exactly what fusing them would produce (or why it can't),
   * plus a Fuse button that commits it. SHOP: the full catalogue of every
   * card at every rarity, one row per rarity (common at top, god at
   * bottom), each row split into its 3 categories — buy directly with
   * run-scoped tokens (see TOKENS_PER_KILL) instead of fusing your way
   * there. Cards already owned are tracked by object reference (not
   * index) since fusion consumes and replaces run.cards entries — see
   * data/cards.js's canFuseCards/fuseCards for the actual rules. Every
   * card tile anywhere in either tab gets a hover tooltip (cardTooltipHTML)
   * with its full effect spelled out.
   */
  showVendor() {
    this.mode = 'modal';
    this.pauseMouseLookForEvent();
    const { app } = this;
    const run = app.gameState.run;
    let slotA = null;
    let slotB = null;

    const modal = document.createElement('div');
    modal.className = 'result-overlay';
    modal.innerHTML = `
      <div class="result-box vendor-box">
        <h2>${t('explore.vendor_title')}</h2>
        <div class="vendor-tabs">
          <button class="vendor-tab-btn active" data-tab="fusion">${t('explore.vendor_tab_fusion')}</button>
          <button class="vendor-tab-btn" data-tab="shop">${t('explore.vendor_tab_shop')}</button>
        </div>
        <div class="vendor-tab-panel" data-panel="fusion">
          <div class="vendor-columns">
            <div class="vendor-inventory">
              <div class="vendor-column-title">${t('explore.vendor_inventory')}</div>
              <div class="vendor-inventory-grid"></div>
            </div>
            <div class="vendor-fusion">
              <div class="vendor-column-title">${t('explore.vendor_fusion')}</div>
              <div class="vendor-slots">
                <div class="vendor-slot" data-slot="a"></div>
                <div class="vendor-slot" data-slot="b"></div>
                <div class="vendor-slot vendor-slot-result" data-slot="result"></div>
              </div>
              <div class="vendor-fusion-note"></div>
              <button class="vendor-fuse-btn" disabled>${t('explore.vendor_fuse')}</button>
            </div>
          </div>
        </div>
        <div class="vendor-tab-panel hidden" data-panel="shop">
          <div class="vendor-tokens">${t('explore.vendor_tokens', { n: run.tokens ?? 0 })}</div>
          <div class="shop-table"></div>
        </div>
        <button class="result-close">${t('explore.close')}</button>
      </div>`;
    this.root.appendChild(modal);

    const inventoryGrid = modal.querySelector('.vendor-inventory-grid');
    const slotAEl = modal.querySelector('[data-slot="a"]');
    const slotBEl = modal.querySelector('[data-slot="b"]');
    const resultEl = modal.querySelector('[data-slot="result"]');
    const noteEl = modal.querySelector('.vendor-fusion-note');
    const fuseBtn = modal.querySelector('.vendor-fuse-btn');
    const tokensEl = modal.querySelector('.vendor-tokens');
    const shopTable = modal.querySelector('.shop-table');

    const bindCardTile = (el, card) => {
      if (!el) return;
      this.tooltip.bind(el, () => cardTooltipHTML(card));
    };

    const renderSlot = (el, card, { removable = false } = {}) => {
      if (!card) {
        el.innerHTML = `<div class="vendor-slot-empty">${t('explore.vendor_slot_empty')}</div>`;
        return;
      }
      el.innerHTML = cardTileHTML(card);
      const tile = el.querySelector('.card-tile');
      bindCardTile(tile, card);
      if (removable) {
        tile.classList.add('vendor-slot-filled');
        tile.addEventListener('click', () => {
          if (slotA === card) slotA = null;
          else if (slotB === card) slotB = null;
          renderFusion();
        });
      }
    };

    const renderFusion = () => {
      // Inventory excludes whatever's currently sitting in a fusion slot,
      // by reference — same physical card object can't be placed twice.
      inventoryGrid.innerHTML = run.cards.map((card, i) => (card === slotA || card === slotB ? '' : cardTileHTML(card, i))).join('');
      inventoryGrid.querySelectorAll('[data-card-index]').forEach((tile) => {
        const card = run.cards[Number(tile.dataset.cardIndex)];
        bindCardTile(tile, card);
        tile.addEventListener('click', () => {
          if (!slotA) slotA = card;
          else if (!slotB) slotB = card;
          else return; // both slots full — remove one first
          renderFusion();
        });
      });

      renderSlot(slotAEl, slotA, { removable: true });
      renderSlot(slotBEl, slotB, { removable: true });

      const fusable = slotA && slotB ? canFuseCards(slotA, slotB) : false;
      const fused = fusable ? fuseCards(slotA, slotB) : null;
      if (fused) {
        resultEl.innerHTML = cardTileHTML(fused);
        bindCardTile(resultEl.querySelector('.card-tile'), fused);
        noteEl.textContent = '';
      } else {
        resultEl.innerHTML = `<div class="vendor-slot-empty">${t('explore.vendor_slot_empty')}</div>`;
        if (slotA && slotB) noteEl.textContent = t('explore.vendor_cannot_fuse');
        else noteEl.textContent = '';
      }
      fuseBtn.disabled = !fused;
    };
    renderFusion();

    fuseBtn.addEventListener('click', () => {
      if (!slotA || !slotB || !canFuseCards(slotA, slotB)) return;
      const fused = fuseCards(slotA, slotB);
      if (!fused) return;
      run.cards = run.cards.filter((c) => c !== slotA && c !== slotB);
      run.cards.push(fused);
      slotA = null;
      slotB = null;
      this.app.saveSystem.save();
      renderFusion();
    });

    // --- Shop tab: full catalogue, one row per rarity, columns grouped by
    // category (attack / sustain / util) — see shopCardTileHTML.
    const CATEGORY_ORDER = ['attack', 'sustain', 'util'];
    const renderShop = () => {
      tokensEl.textContent = t('explore.vendor_tokens', { n: run.tokens ?? 0 });
      shopTable.innerHTML = RARITIES.map((rarity, rarityIndex) => {
        const rarityColor = RARITY_COLORS[rarity];
        const price = CARD_PRICES[rarityIndex] ?? 0;
        const affordable = (run.tokens ?? 0) >= price;
        const groups = CATEGORY_ORDER.map((category) => `
          <div class="shop-group">
            <div class="shop-group-label">${t(`explore.vendor_category_${category}`)}</div>
            <div class="shop-group-cards">
              ${cardsInCategory(category).map((type) => shopCardTileHTML(type.id, rarityIndex, { affordable })).join('')}
            </div>
          </div>`).join('');
        return `
          <div class="shop-row">
            <div class="shop-row-label" style="color:${rarityColor}">${t(`card.rarity.${rarity}`)}<span class="shop-row-price">${t('explore.vendor_price', { n: price })}</span></div>
            <div class="shop-row-groups">${groups}</div>
          </div>`;
      }).join('');

      shopTable.querySelectorAll('.shop-card-tile').forEach((tile) => {
        const cardId = tile.dataset.cardId;
        const rarityIndex = Number(tile.dataset.rarityIndex);
        const value = cardValueForRarity(cardId, rarityIndex);
        bindCardTile(tile, { cardId, rarityIndex, value });
        if (tile.classList.contains('shop-card-unaffordable')) return;
        tile.addEventListener('click', () => {
          const price = CARD_PRICES[rarityIndex] ?? 0;
          if ((run.tokens ?? 0) < price) return;
          run.tokens -= price;
          run.cards.push({ cardId, category: CARDS[cardId].category, rarityIndex, value: cardValueForRarity(cardId, rarityIndex) });
          this.app.saveSystem.save();
          this.renderHUD();
          renderShop();
        });
      });
    };

    modal.querySelectorAll('.vendor-tab-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        modal.querySelectorAll('.vendor-tab-btn').forEach((b) => b.classList.toggle('active', b === btn));
        modal.querySelectorAll('.vendor-tab-panel').forEach((p) => p.classList.toggle('hidden', p.dataset.panel !== btn.dataset.tab));
        if (btn.dataset.tab === 'shop') renderShop();
        else renderFusion();
      });
    });

    modal.querySelector('.result-close').addEventListener('click', () => {
      modal.remove();
      this.mode = 'normal';
      this.restoreMouseLookAfterEvent();
    });
  }

  /**
   * Live per-floor streak toward "Thief's Instinct" (see the shared
   * achievementCardHTML's liveThiefProgressHTML) — deliberately NOT the
   * permanent AchievementSystem progress field (that's cross-run/capped at
   * target:1, wrong shape for "how far through THIS floor's events am I
   * right now"). Incremented by a success on floor 3+ (floors below that
   * never count, matching the achievement's own gate); reset to 0 by any
   * failure, and separately by applyCardPick on every floor change, since
   * a partial streak from a floor already left behind can never complete.
   */
  updateThiefStreak(success) {
    const run = this.app.gameState.run;
    run.achievementProgress = run.achievementProgress ?? {};
    if (success && run.floor >= 3) run.achievementProgress.thiefStreak = (run.achievementProgress.thiefStreak ?? 0) + 1;
    else if (!success) run.achievementProgress.thiefStreak = 0;
  }

  applyCardPick(picked) {
    const { app } = this;
    const run = app.gameState.run;
    run.cards.push(picked);
    this.syncFogToDungeon(); // this floor's fog must be current before archiveCurrentFloor() snapshots it
    app.archiveCurrentFloor(); // commit the floor being left before it's overwritten
    run.floor += 1;
    run.savedHealth = this.player.currentHealth;
    run.achievementProgress = run.achievementProgress ?? {};
    run.achievementProgress.thiefStreak = 0;
    app.generateFloor();
    app.gameState.addLog(t('log.descended', { n: run.floor }));
    this.player = app.createPlayer();
    this.syncDungeon3D();
    this.syncPlayer3D();
    this.revealNearbyTiles(run.playerPosition.x, run.playerPosition.y);
    // Prevents checkTileTrigger from treating "arriving here" as a no-op
    // just because some earlier floor happened to leave the same tile-key
    // behind — a teleport always counts as a fresh arrival.
    this._lastTriggerTileKey = `${run.playerPosition.x},${run.playerPosition.y}`;
    this.app.saveSystem.save();
    this.renderHUD();
  }

  /**
   * Quick-time event gating locked doors/chests/shrine/sigil/wounded-animal.
   * Dex adds time (not success chance, per user request); every type
   * shares this same session lifecycle (mode/mouse-look/timer/Thief's-
   * Curiosity-retry) and only differs in its own build/handle/submit
   * methods for that mechanic — see the QTE_TYPES constant.
   */
  startQTE(onResolve, { type = QTE_TYPES.ARROW, difficultyMultiplier = 1, isRetry = false } = {}) {
    const timeLimit = this.computeQTETimeLimit(type);
    this.mode = 'qte';
    this.pauseMouseLookForEvent();
    const modal = document.createElement('div');
    modal.className = 'qte-overlay';
    this.root.appendChild(modal);
    this.qte = { type, timeLimit, remaining: timeLimit, modal, onResolve, isRetry, difficultyMultiplier };
    switch (type) {
      case QTE_TYPES.TIMING: this.buildTimingQTE(modal, difficultyMultiplier); break;
      case QTE_TYPES.HOLD: this.buildHoldQTE(modal, difficultyMultiplier); break;
      case QTE_TYPES.MEMORY: this.buildMemoryQTE(modal, difficultyMultiplier); break;
      case QTE_TYPES.MASH: this.buildMashQTE(modal, difficultyMultiplier); break;
      case QTE_TYPES.COMBO: this.buildComboQTE(modal, difficultyMultiplier); break;
      default: this.buildArrowQTE(modal, difficultyMultiplier); break;
    }
    this.updateQTETimerUI();
  }

  /** Base seconds for `type` before dex/qteBonusSeconds — shared by every build*QTE. */
  qteBaseSeconds(type) {
    switch (type) {
      case QTE_TYPES.TIMING: return TIMING_BASE_SECONDS;
      case QTE_TYPES.HOLD: return HOLD_BASE_SECONDS;
      case QTE_TYPES.MEMORY: return MEMORY_INPUT_SECONDS;
      case QTE_TYPES.MASH: return MASH_BASE_SECONDS;
      case QTE_TYPES.COMBO: return COMBO_BASE_SECONDS;
      default: return QTE_BASE_SECONDS;
    }
  }

  /** Hold is deliberately excluded from Dex's time bonus — its timer is always exactly HOLD_BASE_SECONDS (plus qteBonusSeconds gear, same as everyone else); Dex slows its slit's drift instead, see buildHoldQTE. */
  computeQTETimeLimit(type) {
    const dexSeconds = type === QTE_TYPES.HOLD ? 0 : this.dexTimeBonusSeconds();
    return this.qteBaseSeconds(type) + dexSeconds + this.getPassiveSum('qteBonusSeconds');
  }

  dexTimeBonusSeconds() {
    const dex = this.player.getStat('dex');
    return Math.floor(dex / QTE_DEX_SECONDS_INTERVAL) * QTE_DEX_SECONDS_PER_INTERVAL;
  }

  /** Net difficulty percent shared across every type's Thief's Ring/Sleeves reinterpretation (see each build*QTE). */
  qteNetDifficultyPercent() {
    return this.getPassiveSum('qteArrowIncreasePercent') - this.getPassiveSum('qteArrowReductionPercent');
  }

  handleQTEKeydown(e) {
    switch (this.qte.type) {
      case QTE_TYPES.TIMING: this.handleTimingKeydown(e); break;
      case QTE_TYPES.HOLD: this.handleHoldKeydown(e); break;
      case QTE_TYPES.MEMORY: this.handleMemoryKeydown(e); break;
      case QTE_TYPES.MASH: this.handleMashKeydown(e); break;
      case QTE_TYPES.COMBO: this.handleComboKeydown(e); break;
      default: this.handleArrowKeydown(e); break;
    }
  }

  /** Releases Hold's press-state on keyup — the only type that cares about keyup, since it's the only one with a discrete "currently held" state. */
  handleQTEKeyup(e) {
    if (!this.qte) return;
    if (this.qte.type === QTE_TYPES.HOLD && e.key === ' ') this.qte.hold.isHeld = false;
  }

  // ---------------------------------------------------------------------
  // Arrow QTE (Temporal Chest only) — unchanged mechanic, ported verbatim
  // into the dispatcher shape.
  // ---------------------------------------------------------------------

  buildArrowQTE(modal, difficultyMultiplier) {
    const run = this.app.gameState.run;
    const baseArrowCount = Math.floor((QTE_BASE_ARROWS + run.floor) * difficultyMultiplier);
    // Thief's Providence (Thief's Ring) reduces arrow count; Thief's
    // Resolve (Thief's Sleeves) increases it — both flat percents, summed
    // into one net multiplier so equipping both nets their difference
    // rather than compounding in some arbitrary order.
    const netPercent = this.qteNetDifficultyPercent();
    const arrowCount = Math.max(1, Math.ceil(baseArrowCount * (1 + netPercent / 100)));
    const directions = Array.from({ length: arrowCount }, () => pickRandom(QTE_DIRECTIONS));
    // Thief's Prophecy (Thief's Goggles): every OTHER arrow gets auto-cleared
    // for free (see advanceArrowQTE), always starting from index 0 — so which
    // arrows actually need a press is fixed and known up front. Marked
    // visually (red underglow = press this one, greyscale = it's free) so
    // the player can tell at a glance which ones to ignore.
    const doubleAdvance = this.hasPassiveFlag('qteDoubleAdvance');
    modal.innerHTML = `
      <div class="qte-box">
        <div class="qte-strip">
          ${directions.map((d, i) => {
            const emphasisClass = doubleAdvance ? (i % 2 === 0 ? ' qte-key-press' : ' qte-key-skip') : '';
            return `<div class="qte-key${emphasisClass}" data-dir="${d}">${arrowIconSVG(d)}</div>`;
          }).join('')}
        </div>
        <div class="qte-timer-track"><div class="qte-timer-fill"></div></div>
        <div class="qte-touch-pad">
          <button class="qte-touch-btn" data-dir="up" aria-label="Up">${arrowIconSVG('up')}</button>
          <button class="qte-touch-btn" data-dir="left" aria-label="Left">${arrowIconSVG('left')}</button>
          <button class="qte-touch-btn" data-dir="down" aria-label="Down">${arrowIconSVG('down')}</button>
          <button class="qte-touch-btn" data-dir="right" aria-label="Right">${arrowIconSVG('right')}</button>
        </div>
      </div>`;
    // Touch input for the same sequence keyboard players answer with
    // QTE_DIRECTION_KEYS — see submitArrowDirection, the shared core both
    // this and handleArrowKeydown funnel into.
    modal.querySelectorAll('.qte-touch-btn').forEach((btn) => {
      btn.addEventListener('touchstart', (e) => {
        e.preventDefault();
        this.submitArrowDirection(btn.dataset.dir);
      }, { passive: false });
    });
    // Captured up front, by index, rather than re-querying '.qte-key' on
    // every keypress — a querySelector re-grab would return the same
    // still-in-DOM first element if two correct presses land faster than
    // advanceArrowQTE's 120ms removal animation, leaving the visual strip a
    // step behind the (still-correct) internal index.
    const keyElements = Array.from(modal.querySelectorAll('.qte-key'));
    this.qte.arrow = { directions, index: 0, keyElements };
  }

  handleArrowKeydown(e) {
    const dir = QTE_DIRECTION_KEYS[e.key];
    if (!dir) return;
    e.originalEvent?.preventDefault?.();
    this.submitArrowDirection(dir);
  }

  /** Shared core behind keyboard (handleArrowKeydown) and the on-screen touch arrow pad (see buildArrowQTE's .qte-touch-btn wiring). */
  submitArrowDirection(dir) {
    if (!this.qte) return;
    const arrow = this.qte.arrow;
    const expected = arrow.directions[arrow.index];
    if (dir === expected) {
      this.advanceArrowQTE();
    } else {
      this.finishQTE(false);
    }
  }

  /**
   * Thief's Prophecy (Thief's Goggles): a correct press also auto-completes
   * the NEXT arrow in the sequence for free, regardless of what it is — so
   * each real press covers 2 spots instead of 1. Advances by 1 as normal
   * without the passive, or when only one arrow is left either way.
   */
  advanceArrowQTE() {
    const arrow = this.qte.arrow;
    const advance = this.hasPassiveFlag('qteDoubleAdvance') ? 2 : 1;
    for (let i = 0; i < advance && arrow.index < arrow.directions.length; i += 1) {
      const keyEl = arrow.keyElements[arrow.index];
      keyEl?.classList.add('correct');
      setTimeout(() => keyEl?.remove(), 120);
      arrow.index += 1;
    }
    if (arrow.index >= arrow.directions.length) {
      this.finishQTE(true);
    }
  }

  // ---------------------------------------------------------------------
  // Timing bar QTE (Locked Door, Treasure)
  // ---------------------------------------------------------------------

  /**
   * A marker sweeps a track on a fixed-period CSS animation; one or more
   * randomly-positioned "sweet spot" zones (re-rolled every round) shrink
   * with floor and widen with Dex. A single input (Space/click/tap)
   * checks the marker's current position against ANY zone — hit advances
   * the round counter, miss or timeout fails immediately (mirrors the
   * arrow QTE's "one miss = fail").
   *
   * Thief's Prophecy (Goggles): for this type specifically, "double
   * advance" means TWO simultaneous zones on the track (twice the chance
   * to land a hit on any given sweep) instead of double credit per hit —
   * see computeTimingParams. A hit always advances exactly 1 round,
   * regardless of which zone it landed in or how many zones exist.
   */
  computeTimingParams(difficultyMultiplier) {
    const run = this.app.gameState.run;
    const netPercent = this.qteNetDifficultyPercent();
    const baseRounds = TIMING_BASE_ROUNDS + Math.floor(run.floor / TIMING_FLOOR_ROUNDS_INTERVAL);
    const roundsNeeded = Math.max(1, Math.ceil(baseRounds * difficultyMultiplier * (1 + netPercent / 100)));
    const baseZonePercent = Math.max(TIMING_MIN_ZONE_PERCENT, TIMING_BASE_ZONE_PERCENT - run.floor * TIMING_ZONE_SHRINK_PER_FLOOR);
    const dex = this.player.getStat('dex');
    const zonePercent = Math.min(TIMING_MAX_ZONE_PERCENT, baseZonePercent + Math.floor(dex / QTE_DEX_SECONDS_INTERVAL) * TIMING_DEX_ZONE_PERCENT_PER_INTERVAL);
    const zoneCount = this.hasPassiveFlag('qteDoubleAdvance') ? 2 : 1;
    return { roundsNeeded, zonePercent, periodSeconds: TIMING_MARKER_PERIOD_SECONDS, zoneCount };
  }

  buildTimingQTE(modal, difficultyMultiplier) {
    const { roundsNeeded, zonePercent, periodSeconds, zoneCount } = this.computeTimingParams(difficultyMultiplier);
    modal.innerHTML = `
      <div class="qte-box">
        <div class="timing-track">
          ${Array.from({ length: zoneCount }, () => '<div class="timing-zone"></div>').join('')}
          <div class="timing-marker"></div>
        </div>
        <div class="qte-timer-track"><div class="qte-timer-fill"></div></div>
        <button class="timing-touch-btn" aria-label="Hit">${arrowIconSVG('up')}</button>
      </div>`;
    const track = modal.querySelector('.timing-track');
    const marker = modal.querySelector('.timing-marker');
    marker.style.animationDuration = `${periodSeconds}s`;
    this.qte.timing = {
      round: 0, roundsNeeded, zonePercent, periodSeconds,
      sessionStartTime: performance.now(),
      zoneEls: Array.from(modal.querySelectorAll('.timing-zone')),
      zoneLefts: [],
    };
    this.rerollTimingZones();
    const submit = () => this.submitTimingPress();
    track.addEventListener('click', submit);
    modal.querySelector('.timing-touch-btn').addEventListener('touchstart', (e) => { e.preventDefault(); submit(); }, { passive: false });
  }

  /** Repositions every zone (1 normally, 2 with Thief's Goggles) independently at random — see buildTimingQTE/computeTimingParams. */
  rerollTimingZones() {
    const timing = this.qte.timing;
    timing.zoneLefts = timing.zoneEls.map((zoneEl) => {
      const left = Math.random() * (100 - timing.zonePercent);
      zoneEl.style.left = `${left}%`;
      zoneEl.style.width = `${timing.zonePercent}%`;
      zoneEl.classList.remove('hit');
      return left;
    });
  }

  handleTimingKeydown(e) {
    if (e.key !== ' ') return;
    e.originalEvent?.preventDefault?.();
    this.submitTimingPress();
  }

  submitTimingPress() {
    if (!this.qte || this.qte.type !== QTE_TYPES.TIMING) return;
    const timing = this.qte.timing;
    const elapsedMs = performance.now() - timing.sessionStartTime;
    const posPercent = ((elapsedMs % (timing.periodSeconds * 1000)) / (timing.periodSeconds * 1000)) * 100;
    const hitIndex = timing.zoneLefts.findIndex((left) => posPercent >= left && posPercent <= left + timing.zonePercent);
    if (hitIndex === -1) {
      this.finishQTE(false);
      return;
    }
    timing.zoneEls[hitIndex].classList.add('hit');
    timing.round += 1;
    if (timing.round >= timing.roundsNeeded) {
      this.finishQTE(true);
      return;
    }
    this.rerollTimingZones();
  }

  // ---------------------------------------------------------------------
  // Combo QTE (Temporal Chest only) — Arrow strip + an infinite Timing
  // bar working together, not two independent races. Per user redesign:
  // winning is ENTIRELY about the arrow strip — the timing bar underneath
  // never has a win/lose state of its own. A correct arrow press doesn't
  // finish that arrow, it LOCKS it (dark blue, lock icon) — locked arrows
  // only become permanent ('broken') the instant you land a hit in the
  // timing bar's green zone, which breaks every currently-locked arrow at
  // once. The timing marker loops forever; if a full lap goes by with no
  // successful hit, every still-locked (not yet broken) arrow reverts to
  // pending and has to be pressed again — see tickQTEProgress's COMBO
  // branch (relockCombo) and submitComboTimingPress (breakLockedArrows).
  // This is what forces genuine simultaneity: you can't just blitz the
  // arrows first and mop up timing after, since anything you don't lock
  // in via a timing hit within one lap unravels.
  // ---------------------------------------------------------------------

  /**
   * WASD/arrow keys press the next PENDING arrow in the strip (locking it
   * on a correct press); Space checks the timing marker against its
   * zone(s) and, on a hit, breaks every currently-locked arrow free for
   * good. A wrong arrow press still fails the whole session instantly,
   * same as standalone Arrow's "one miss = fail" — but a missed/late
   * Space press is harmless (there's always another lap coming). The
   * session only succeeds once every arrow has been broken.
   */
  buildComboQTE(modal, difficultyMultiplier) {
    const run = this.app.gameState.run;
    const netPercent = this.qteNetDifficultyPercent();

    const doubleAdvance = this.hasPassiveFlag('qteDoubleAdvance');

    const baseArrowCount = Math.floor((QTE_BASE_ARROWS + run.floor) * difficultyMultiplier);
    const arrowCount = Math.max(1, Math.ceil(baseArrowCount * (1 + netPercent / 100)));
    const directions = Array.from({ length: arrowCount }, () => pickRandom(QTE_DIRECTIONS));

    // roundsNeeded is unused here — Combo's timing bar is infinite, it
    // never finishes on its own (see class header comment above). The
    // TRACK renders COMBO_TIMING_TRACK_WIDTH_MULTIPLIER times wider, but
    // per user correction that's a container-size change only — the green
    // zone's actual pixel width and the marker's actual pixel speed must
    // match standalone Timing's exactly, so zonePercent (a %-of-track
    // value) is divided by the multiplier and periodSeconds is multiplied
    // by it before either is used for anything.
    const { zonePercent: rawZonePercent, periodSeconds: rawPeriodSeconds, zoneCount } = this.computeTimingParams(difficultyMultiplier);
    const zonePercent = rawZonePercent / COMBO_TIMING_TRACK_WIDTH_MULTIPLIER;
    const periodSeconds = rawPeriodSeconds * COMBO_TIMING_TRACK_WIDTH_MULTIPLIER;

    modal.innerHTML = `
      <div class="qte-box">
        <div class="qte-strip">
          ${directions.map((d, i) => {
            const emphasisClass = doubleAdvance ? (i % 2 === 0 ? ' qte-key-press' : ' qte-key-skip') : '';
            return `<div class="qte-key${emphasisClass}" data-dir="${d}">${arrowIconSVG(d)}</div>`;
          }).join('')}
        </div>
        <div class="timing-track combo-wide">
          ${Array.from({ length: zoneCount }, () => '<div class="timing-zone"></div>').join('')}
          <div class="timing-marker"></div>
        </div>
        <div class="qte-timer-track"><div class="qte-timer-fill"></div></div>
        <div class="qte-touch-pad">
          <button class="qte-touch-btn" data-dir="up" aria-label="Up">${arrowIconSVG('up')}</button>
          <button class="qte-touch-btn" data-dir="left" aria-label="Left">${arrowIconSVG('left')}</button>
          <button class="qte-touch-btn" data-dir="down" aria-label="Down">${arrowIconSVG('down')}</button>
          <button class="qte-touch-btn" data-dir="right" aria-label="Right">${arrowIconSVG('right')}</button>
        </div>
        <button class="timing-touch-btn" aria-label="Hit">${arrowIconSVG('up')}</button>
      </div>`;

    modal.querySelectorAll('.qte-touch-btn').forEach((btn) => {
      btn.addEventListener('touchstart', (e) => { e.preventDefault(); this.submitComboArrow(btn.dataset.dir); }, { passive: false });
    });
    const keyElements = Array.from(modal.querySelectorAll('.qte-key'));
    // states[i]: 'pending' (untouched) → 'locked' (correctly pressed,
    // awaiting a timing-bar break) → 'broken' (permanent — counts toward
    // the win condition). See renderComboArrowState for the visuals.
    // doubleAdvance is carried on the object (not just a local var) so
    // renderComboArrowState can re-derive the press/skip emphasis after a
    // relock without recomputing hasPassiveFlag.
    this.qte.arrow = { directions, states: keyElements.map(() => 'pending'), keyElements, doubleAdvance };

    const marker = modal.querySelector('.timing-marker');
    marker.style.animationDuration = `${periodSeconds}s`;
    this.qte.timing = {
      zonePercent, periodSeconds,
      sessionStartTime: performance.now(),
      zoneEls: Array.from(modal.querySelectorAll('.timing-zone')),
      zoneLefts: [],
      // Lap-wrap tracking for the relock penalty — see tickQTEProgress.
      // hitThisLap means "a hit has landed since the most recent lock" —
      // see lockComboArrow, which clears it back to false on every lock so
      // an earlier hit can't also cover arrows locked after it.
      currentLapIndex: 0,
      hitThisLap: false,
    };
    this.rerollTimingZones();
    const submitTiming = () => this.submitComboTimingPress();
    modal.querySelector('.timing-track').addEventListener('click', submitTiming);
    modal.querySelector('.timing-touch-btn').addEventListener('touchstart', (e) => { e.preventDefault(); submitTiming(); }, { passive: false });
  }

  /** WASD/arrow keys → the arrow half; Space → the timing half — both live at once, see buildComboQTE. */
  handleComboKeydown(e) {
    const dir = QTE_DIRECTION_KEYS[e.key];
    if (dir) {
      e.originalEvent?.preventDefault?.();
      this.submitComboArrow(dir);
      return;
    }
    if (e.key === ' ') {
      e.originalEvent?.preventDefault?.();
      this.submitComboTimingPress();
    }
  }

  /**
   * Renders arrow index `i`'s current state (pending/locked/broken) onto
   * its key element — see buildComboQTE's states array. Thief's Prophecy
   * (Goggles) press/skip emphasis only makes sense while an arrow is
   * still pending (it's telling you which ones need a real press) — it's
   * hidden the instant an arrow locks (the lock visual takes over) and
   * comes back automatically if a relock reverts it to pending, since the
   * emphasis is re-derived from index parity every render rather than
   * being a one-time class set at build time.
   */
  renderComboArrowState(i) {
    const arrow = this.qte.arrow;
    const keyEl = arrow.keyElements[i];
    if (!keyEl) return;
    const state = arrow.states[i];
    keyEl.classList.remove('locked', 'correct', 'qte-key-press', 'qte-key-skip');
    if (arrow.doubleAdvance && state === 'pending') {
      keyEl.classList.add(i % 2 === 0 ? 'qte-key-press' : 'qte-key-skip');
    }
    if (state === 'locked') {
      keyEl.classList.add('locked');
      keyEl.innerHTML = lockIconSVG();
    } else {
      if (state === 'broken') keyEl.classList.add('correct');
      keyEl.innerHTML = arrowIconSVG(arrow.directions[i]);
    }
  }

  /**
   * Locks arrow index `i` (correct press, awaiting a timing-bar break) —
   * see buildComboQTE. Per user correction, this also clears
   * `hitThisLap`: an earlier hit this lap already broke every arrow that
   * was locked before it, so it shouldn't also give a free pass to
   * whatever gets locked AFTER it — a fresh hit is required before the
   * next wrap or this arrow (and anything else still locked) reverts to
   * pending right at that wrap, same as if no hit had landed at all.
   */
  lockComboArrow(i) {
    this.qte.arrow.states[i] = 'locked';
    this.renderComboArrowState(i);
    this.qte.timing.hitThisLap = false;
  }

  /**
   * Presses the next PENDING arrow in the strip. Thief's Prophecy
   * (Goggles): a correct press also locks the NEXT pending arrow for
   * free — same "double advance" spirit as standalone Arrow, just landing
   * on 'locked' instead of an instant, permanent completion (it still
   * needs a timing-bar break like any other locked arrow).
   */
  submitComboArrow(dir) {
    if (!this.qte || this.qte.type !== QTE_TYPES.COMBO) return;
    const arrow = this.qte.arrow;
    const idx = arrow.states.indexOf('pending');
    if (idx === -1) return; // every arrow is already locked or broken — nothing to press right now
    const expected = arrow.directions[idx];
    if (dir !== expected) {
      this.finishQTE(false);
      return;
    }
    this.lockComboArrow(idx);
    if (this.hasPassiveFlag('qteDoubleAdvance')) {
      const nextIdx = arrow.states.indexOf('pending');
      if (nextIdx !== -1) this.lockComboArrow(nextIdx);
    }
  }

  /**
   * Checks the timing marker against its zone(s), same math as standalone
   * Timing — but a miss here is harmless (see class header comment); only
   * a hit matters, breaking every currently-locked arrow free for good
   * and marking this lap as "scored" so tickQTEProgress's lap-wrap check
   * doesn't relock anything.
   */
  submitComboTimingPress() {
    if (!this.qte || this.qte.type !== QTE_TYPES.COMBO) return;
    const timing = this.qte.timing;
    const elapsedMs = performance.now() - timing.sessionStartTime;
    const posPercent = ((elapsedMs % (timing.periodSeconds * 1000)) / (timing.periodSeconds * 1000)) * 100;
    const hitIndex = timing.zoneLefts.findIndex((left) => posPercent >= left && posPercent <= left + timing.zonePercent);
    if (hitIndex === -1) return;
    timing.zoneEls[hitIndex].classList.add('hit');
    timing.hitThisLap = true;
    this.breakLockedComboArrows();
    // breakLockedComboArrows() may have just won (and ended) the session —
    // this.qte is null in that case, nothing left to reroll.
    if (this.qte) this.rerollTimingZones();
  }

  /** Breaks every currently-locked arrow free for good, then checks the win condition. */
  breakLockedComboArrows() {
    const arrow = this.qte.arrow;
    arrow.states.forEach((s, i) => {
      if (s === 'locked') {
        arrow.states[i] = 'broken';
        this.renderComboArrowState(i);
      }
    });
    if (arrow.states.every((s) => s === 'broken')) {
      this.finishQTE(true);
    }
  }

  /** Combo QTE only: a full timing lap with no hit reverts every currently-locked arrow back to pending — see tickQTEProgress's COMBO branch. */
  relockCombo() {
    const arrow = this.qte?.arrow;
    if (!arrow) return;
    arrow.states.forEach((s, i) => {
      if (s === 'locked') {
        arrow.states[i] = 'pending';
        this.renderComboArrowState(i);
      }
    });
  }

  // ---------------------------------------------------------------------
  // Hold QTE (Sealed Shrine)
  // ---------------------------------------------------------------------

  /**
   * A single input held down raises the fill level at `fillPerSecond`
   * (fast); releasing drains it at `decayPerSecond` (just as fast) — the
   * fill bar is twitchy on purpose. A narrow "slit" marks the target zone
   * on the track and drifts ERRATICALLY along it (random speed AND
   * direction, re-rolled every HOLD_SLIT_MOVE_RETARGET_*_SECONDS, always
   * bouncing off both ends — see tickQTEProgress), so its motion can't be
   * timed like a metronome. The ONLY win condition is the fill level
   * resting inside the slit's CURRENT position the instant the timer
   * runs out (see tick()'s HOLD-specific timeout branch) — no early win.
   * There IS an early fail though: a "kill bar" tracks cumulative time
   * spent outside the slit and, the moment that crosses
   * HOLD_KILL_BAR_THRESHOLD_PERCENT of the total timer, ends the attempt
   * immediately (see tickQTEProgress) — so drifting outside the zone for
   * too long kills the run before the timer would have. Thief's
   * Ring/Sleeves widen/narrow the slit (inverse of their usual
   * "shrink/grow the difficulty knob" sign,
   * since a WIDER slit is what's easier here); Thief's Goggles widens it
   * further still. Dexterity narrows the slit's random speed range
   * instead of widening it — same interval as every other type's
   * Dex-adds-seconds bonus, just a different unit — Hold's timer itself
   * never moves, see computeQTETimeLimit's Hold special-case.
   */
  buildHoldQTE(modal, difficultyMultiplier) {
    const run = this.app.gameState.run;
    const netPercent = this.qteNetDifficultyPercent();
    const baseSlitPercent = Math.max(HOLD_MIN_SLIT_PERCENT, HOLD_BASE_SLIT_PERCENT - run.floor * HOLD_SLIT_SHRINK_PER_FLOOR);
    let slitPercent = baseSlitPercent * difficultyMultiplier * (1 - netPercent / 100);
    if (this.hasPassiveFlag('qteDoubleAdvance')) slitPercent *= HOLD_DOUBLE_ADVANCE_SLIT_MULTIPLIER;
    slitPercent = Math.min(HOLD_MAX_SLIT_PERCENT, Math.max(HOLD_MIN_SLIT_PERCENT, slitPercent));
    const dex = this.player.getStat('dex');
    const dexIntervals = Math.floor(dex / QTE_DEX_SECONDS_INTERVAL);
    const moveSpeedMin = Math.max(HOLD_SLIT_MOVE_SPEED_FLOOR_MIN, HOLD_SLIT_MOVE_SPEED_MIN_BASE - dexIntervals * HOLD_SLIT_MOVE_SPEED_DEX_REDUCTION_PER_INTERVAL);
    const moveSpeedMax = Math.max(HOLD_SLIT_MOVE_SPEED_FLOOR_MAX, HOLD_SLIT_MOVE_SPEED_MAX_BASE - dexIntervals * HOLD_SLIT_MOVE_SPEED_DEX_REDUCTION_PER_INTERVAL);
    const maxSlitLeft = 100 - slitPercent;
    const slitLeft = Math.random() * maxSlitLeft;
    const moveDir = Math.random() < 0.5 ? 1 : -1;
    const moveSpeed = moveSpeedMin + Math.random() * (moveSpeedMax - moveSpeedMin);
    const moveRetargetRemaining = HOLD_SLIT_MOVE_RETARGET_MIN_SECONDS + Math.random() * (HOLD_SLIT_MOVE_RETARGET_MAX_SECONDS - HOLD_SLIT_MOVE_RETARGET_MIN_SECONDS);
    const killThresholdSeconds = this.qte.timeLimit * (HOLD_KILL_BAR_THRESHOLD_PERCENT / 100);
    modal.innerHTML = `
      <div class="qte-box">
        <div class="qte-fill-track hold-kill-track"><div class="qte-fill-bar hold-kill-bar"></div></div>
        <div class="qte-fill-track">
          <div class="qte-fill-bar hold-fill-bar"></div>
          <div class="hold-slit"></div>
        </div>
        <div class="qte-timer-track"><div class="qte-timer-fill"></div></div>
        <button class="hold-touch-btn" aria-label="Hold">${holdIconSVG()}</button>
      </div>`;
    const slitEl = modal.querySelector('.hold-slit');
    slitEl.style.left = `${slitLeft}%`;
    slitEl.style.width = `${slitPercent}%`;
    this.qte.hold = {
      fill: 0, fillPerSecond: HOLD_FILL_PER_SECOND_HELD, decayPerSecond: HOLD_DECAY_PER_SECOND, isHeld: false,
      slitLeft, slitPercent, maxSlitLeft,
      moveSpeedMin, moveSpeedMax, moveSpeed, moveDir, moveRetargetRemaining,
      outOfZoneSeconds: 0, killThresholdSeconds,
      fillEl: modal.querySelector('.hold-fill-bar'), slitEl,
      killBarEl: modal.querySelector('.hold-kill-bar'),
    };
    const touchBtn = modal.querySelector('.hold-touch-btn');
    const setHeld = (held) => { if (this.qte?.hold) this.qte.hold.isHeld = held; };
    touchBtn.addEventListener('touchstart', (e) => { e.preventDefault(); setHeld(true); }, { passive: false });
    touchBtn.addEventListener('touchend', (e) => { e.preventDefault(); setHeld(false); }, { passive: false });
    touchBtn.addEventListener('touchcancel', (e) => { e.preventDefault(); setHeld(false); }, { passive: false });
  }

  /** True while the Hold QTE's fill level is currently resting inside the slit's current (possibly drifted) position — the win condition, checked at timeout (see tick()). */
  isHoldInSlit() {
    const hold = this.qte?.hold;
    if (!hold) return false;
    return hold.fill >= hold.slitLeft && hold.fill <= hold.slitLeft + hold.slitPercent;
  }

  handleHoldKeydown(e) {
    if (e.key !== ' ') return;
    e.originalEvent?.preventDefault?.();
    this.qte.hold.isHeld = true;
  }

  // ---------------------------------------------------------------------
  // Memory / Simon-Says QTE (Arcane Sigil)
  // ---------------------------------------------------------------------

  /**
   * A sequence of directions flashes one at a time, then hides; the
   * player reproduces it from memory using the same directional input as
   * the arrow QTE. Input is ignored during the reveal choreography — the
   * fail-timer (this.qte.remaining) is frozen until the input phase
   * actually begins (see tick()).
   *
   * Thief's Prophecy (Thief's Goggles) auto-clears every OTHER slot for
   * free here too (see submitMemoryDirection), same as the arrow QTE — but
   * unlike the arrow QTE the sequence isn't visible during input, so a
   * first-time Goggles owner has no way to notice that and will try to
   * memorize/press every slot, then fail when their press for an
   * already-cleared slot gets checked against the wrong index. Marked with
   * the exact same red-glow/greyscale language as the arrow strip, on both
   * the reveal flashes and the answer slots, so it reads as "you don't
   * need this one" from the very first flash.
   */
  buildMemoryQTE(modal, difficultyMultiplier) {
    const run = this.app.gameState.run;
    const netPercent = this.qteNetDifficultyPercent();
    const baseLength = MEMORY_BASE_LENGTH + run.floor * MEMORY_LENGTH_PER_FLOOR;
    const length = Math.min(MEMORY_MAX_LENGTH, Math.max(1, Math.round(baseLength * difficultyMultiplier * (1 + netPercent / 100))));
    const revealMs = Math.max(MEMORY_MIN_REVEAL_MS, MEMORY_BASE_REVEAL_MS - run.floor * MEMORY_REVEAL_SHRINK_PER_FLOOR_MS);
    const sequence = Array.from({ length }, () => pickRandom(QTE_DIRECTIONS));
    const doubleAdvance = this.hasPassiveFlag('qteDoubleAdvance');
    modal.innerHTML = `
      <div class="qte-box">
        <div class="memory-reveal"></div>
        <div class="memory-slots"></div>
        <div class="qte-timer-track"><div class="qte-timer-fill"></div></div>
        <div class="qte-touch-pad">
          <button class="qte-touch-btn" data-dir="up" aria-label="Up">${arrowIconSVG('up')}</button>
          <button class="qte-touch-btn" data-dir="left" aria-label="Left">${arrowIconSVG('left')}</button>
          <button class="qte-touch-btn" data-dir="down" aria-label="Down">${arrowIconSVG('down')}</button>
          <button class="qte-touch-btn" data-dir="right" aria-label="Right">${arrowIconSVG('right')}</button>
        </div>
      </div>`;
    const revealEl = modal.querySelector('.memory-reveal');
    const slotsEl = modal.querySelector('.memory-slots');
    slotsEl.innerHTML = sequence.map((_, i) => {
      const emphasisClass = doubleAdvance ? (i % 2 === 0 ? ' qte-key-press' : ' qte-key-skip') : '';
      return `<div class="qte-key-slot${emphasisClass}"></div>`;
    }).join('');
    modal.querySelectorAll('.qte-touch-btn').forEach((btn) => {
      btn.addEventListener('touchstart', (e) => { e.preventDefault(); this.submitMemoryDirection(btn.dataset.dir); }, { passive: false });
    });
    this.qte.memory = {
      sequence, index: 0, phase: 'reveal', revealMs, doubleAdvance,
      slotElements: Array.from(slotsEl.querySelectorAll('.qte-key-slot')),
    };
    this.playMemoryReveal(revealEl);
  }

  /** Flashes each icon in sequence, one at a time, then flips to the 'input' phase — see submitMemoryDirection. */
  playMemoryReveal(revealEl) {
    const memory = this.qte?.memory;
    if (!memory) return;
    let i = 0;
    const showNext = () => {
      if (!this.qte || this.qte.memory !== memory) return; // QTE ended/replaced mid-choreography (timeout, retry, etc)
      if (i >= memory.sequence.length) {
        revealEl.innerHTML = '';
        memory.phase = 'input';
        return;
      }
      const emphasisClass = memory.doubleAdvance ? (i % 2 === 0 ? ' qte-key-press' : ' qte-key-skip') : '';
      revealEl.innerHTML = `<div class="qte-key qte-key-reveal${emphasisClass}">${arrowIconSVG(memory.sequence[i])}</div>`;
      i += 1;
      setTimeout(() => {
        if (!this.qte || this.qte.memory !== memory) return;
        revealEl.innerHTML = '';
        setTimeout(showNext, MEMORY_GAP_MS);
      }, memory.revealMs);
    };
    showNext();
  }

  handleMemoryKeydown(e) {
    const dir = QTE_DIRECTION_KEYS[e.key];
    if (!dir) return;
    e.originalEvent?.preventDefault?.();
    this.submitMemoryDirection(dir);
  }

  /** Shared core behind keyboard (handleMemoryKeydown) and the touch pad — ignored during the reveal choreography, matching Simon-Says convention. */
  submitMemoryDirection(dir) {
    if (!this.qte || this.qte.type !== QTE_TYPES.MEMORY) return;
    const memory = this.qte.memory;
    if (memory.phase !== 'input') return;
    const expected = memory.sequence[memory.index];
    if (dir !== expected) {
      this.finishQTE(false);
      return;
    }
    const advance = this.hasPassiveFlag('qteDoubleAdvance') ? 2 : 1;
    for (let i = 0; i < advance && memory.index < memory.sequence.length; i += 1) {
      memory.slotElements[memory.index]?.classList.add('filled');
      memory.index += 1;
    }
    if (memory.index >= memory.sequence.length) {
      this.finishQTE(true);
    }
  }

  // ---------------------------------------------------------------------
  // Mash QTE (Wounded Animal, 70% branch)
  // ---------------------------------------------------------------------

  /**
   * Rapid single-input presses fill a bar by `fillPerPress` each; a
   * passive decay (see tickQTEProgress) that itself grows harsher per
   * floor requires sustained mashing, not just enough total presses at
   * any pace. Success at 100% fill; failure-by-timeout is the shared
   * tick()-driven path.
   *
   * A second "stamina" bar sits above the fill bar and drains on its own
   * clock — NOT tied to presses — going from full to empty in a per-floor
   * window (base window shrinks with floor, before Dex extends it back).
   * Once empty it turns red and stays down for MASH_STAMINA_LOCKOUT_SECONDS
   * before snapping back to full; pressing while it's down is an
   * immediate fail (see submitMashPress), so the player has to watch the
   * bar and hold off rather than mash through it blindly.
   */
  buildMashQTE(modal, difficultyMultiplier) {
    const run = this.app.gameState.run;
    const netPercent = this.qteNetDifficultyPercent();
    let fillPerPress = MASH_FILL_PER_PRESS + run.floor * MASH_FILL_PER_PRESS_FLOOR_DECAY;
    // Inverse sign vs. Timing/Memory's (1+net/100): fillPerPress is a
    // "bigger is easier" knob (like Hold's slit width), not a "bigger is
    // harder" count/length — a reduction (net<0) must RAISE it.
    fillPerPress = Math.max(MASH_MIN_FILL_PER_PRESS, fillPerPress * difficultyMultiplier * (1 - netPercent / 100));
    if (this.hasPassiveFlag('qteDoubleAdvance')) fillPerPress *= 2;
    const decayPerSecond = Math.min(MASH_DECAY_PER_SECOND_MAX, MASH_DECAY_PER_SECOND_BASE + run.floor * MASH_DECAY_PER_SECOND_PER_FLOOR);
    const dex = this.player.getStat('dex');
    const staminaDrainBaseSeconds = Math.max(MASH_STAMINA_DRAIN_MIN_BASE_SECONDS, MASH_STAMINA_DRAIN_BASE_SECONDS - run.floor * MASH_STAMINA_DRAIN_SHRINK_PER_FLOOR);
    const staminaDrainSeconds = Math.min(MASH_STAMINA_MAX_DRAIN_SECONDS, staminaDrainBaseSeconds + Math.floor(dex / QTE_DEX_SECONDS_INTERVAL) * MASH_STAMINA_DEX_DRAIN_SECONDS_PER_INTERVAL);
    modal.innerHTML = `
      <div class="qte-box">
        <div class="qte-fill-track mash-stamina-track"><div class="qte-fill-bar mash-stamina-bar"></div></div>
        <div class="qte-fill-track"><div class="qte-fill-bar mash-progress-bar"></div></div>
        <div class="qte-timer-track"><div class="qte-timer-fill"></div></div>
        <button class="mash-touch-btn" aria-label="Mash">${mashIconSVG()}</button>
      </div>`;
    this.qte.mash = {
      fill: 0, fillPerPress, decayPerSecond,
      stamina: 100, staminaDrainPerSecond: 100 / staminaDrainSeconds, lockoutRemaining: 0,
      fillEl: modal.querySelector('.mash-progress-bar'), staminaEl: modal.querySelector('.mash-stamina-bar'),
      touchBtn: modal.querySelector('.mash-touch-btn'),
    };
    this.qte.mash.touchBtn.addEventListener('touchstart', (e) => { e.preventDefault(); this.submitMashPress(); }, { passive: false });
  }

  handleMashKeydown(e) {
    if (e.key !== ' ') return;
    e.originalEvent?.preventDefault?.();
    this.submitMashPress();
  }

  submitMashPress() {
    if (!this.qte || this.qte.type !== QTE_TYPES.MASH) return;
    const mash = this.qte.mash;
    if (mash.lockoutRemaining > 0) {
      // Pressed while the stamina bar is down/red — instant fail, not a no-op.
      this.finishQTE(false);
      return;
    }
    mash.fill = Math.min(100, mash.fill + mash.fillPerPress);
    if (mash.fillEl) mash.fillEl.style.width = `${mash.fill}%`;
    if (mash.fill >= 100) this.finishQTE(true);
  }

  /** Per-frame continuous progress for Hold (fill + slit drift while held/released) and Mash (passive fill decay + clock-driven stamina drain/lockout) — called from tick() only while the QTE's fail-timer is actively running. */
  tickQTEProgress(dt) {
    if (!this.qte) return;
    if (this.qte.type === QTE_TYPES.HOLD) {
      // No early WIN here — success is decided only at timeout (see
      // tick()'s HOLD-specific branch), since this is a "hold position"
      // balance challenge, not a race to fill. There IS an early FAIL,
      // though — the kill bar below.
      const hold = this.qte.hold;
      hold.fill = clamp(hold.fill + (hold.isHeld ? hold.fillPerSecond : -hold.decayPerSecond) * dt, 0, 100);
      if (hold.maxSlitLeft > 0) {
        // Erratic drift: re-roll speed + direction on its own random clock,
        // on top of always bouncing off the track's ends — see buildHoldQTE.
        hold.moveRetargetRemaining -= dt;
        if (hold.moveRetargetRemaining <= 0) {
          hold.moveSpeed = hold.moveSpeedMin + Math.random() * (hold.moveSpeedMax - hold.moveSpeedMin);
          hold.moveDir = Math.random() < 0.5 ? 1 : -1;
          hold.moveRetargetRemaining = HOLD_SLIT_MOVE_RETARGET_MIN_SECONDS + Math.random() * (HOLD_SLIT_MOVE_RETARGET_MAX_SECONDS - HOLD_SLIT_MOVE_RETARGET_MIN_SECONDS);
        }
        hold.slitLeft += hold.moveDir * hold.moveSpeed * dt;
        if (hold.slitLeft <= 0) { hold.slitLeft = 0; hold.moveDir = 1; }
        else if (hold.slitLeft >= hold.maxSlitLeft) { hold.slitLeft = hold.maxSlitLeft; hold.moveDir = -1; }
        if (hold.slitEl) hold.slitEl.style.left = `${hold.slitLeft}%`;
      }
      const inSlit = this.isHoldInSlit();
      if (hold.fillEl) {
        hold.fillEl.style.width = `${hold.fill}%`;
        hold.fillEl.classList.toggle('in-slit', inSlit);
      }
      // Kill bar: cumulative time spent outside the slit, drawn as a bar
      // counting DOWN from full — hits 0 (and instantly ends the attempt)
      // once that cumulative time crosses HOLD_KILL_BAR_THRESHOLD_PERCENT
      // of the whole session's timer. Never recovers once spent, even
      // while resting back inside the slit (which is what makes it look
      // like it "pauses" sometimes — that's correct, not a glitch: it
      // only counts down while you're actually outside the zone). Color
      // interpolates continuously from green to red as it drains, rather
      // than a hard flip-and-pulse at some threshold — that binary switch
      // read as a jarring, glitchy "flash" instead of a steady warning.
      if (!inSlit) hold.outOfZoneSeconds += dt;
      const killBarPercent = clamp(100 * (1 - hold.outOfZoneSeconds / hold.killThresholdSeconds), 0, 100);
      if (hold.killBarEl) {
        hold.killBarEl.style.width = `${killBarPercent}%`;
        hold.killBarEl.style.background = lerpColor(HOLD_KILL_BAR_SAFE_COLOR, HOLD_KILL_BAR_DANGER_COLOR, 1 - killBarPercent / 100);
      }
      if (hold.outOfZoneSeconds >= hold.killThresholdSeconds) {
        // Snap the bar to a clean, fully-drained frame before the QTE
        // resolves, rather than freezing at whatever fraction was left
        // the instant the threshold was crossed.
        if (hold.killBarEl) {
          hold.killBarEl.style.width = '0%';
          hold.killBarEl.style.background = lerpColor(HOLD_KILL_BAR_SAFE_COLOR, HOLD_KILL_BAR_DANGER_COLOR, 1);
        }
        this.finishQTE(false, 'killBar');
        return;
      }
    } else if (this.qte.type === QTE_TYPES.MASH) {
      const mash = this.qte.mash;
      mash.fill = clamp(mash.fill - mash.decayPerSecond * dt, 0, 100);
      if (mash.fillEl) mash.fillEl.style.width = `${mash.fill}%`;
      if (mash.lockoutRemaining > 0) {
        mash.lockoutRemaining = Math.max(0, mash.lockoutRemaining - dt);
        if (mash.lockoutRemaining <= 0) {
          mash.stamina = 100;
          if (mash.staminaEl) { mash.staminaEl.style.width = '100%'; mash.staminaEl.classList.remove('locked'); }
          mash.touchBtn?.classList.remove('locked');
        }
      } else {
        mash.stamina = Math.max(0, mash.stamina - mash.staminaDrainPerSecond * dt);
        if (mash.staminaEl) mash.staminaEl.style.width = `${mash.stamina}%`;
        if (mash.stamina <= 0) {
          mash.lockoutRemaining = MASH_STAMINA_LOCKOUT_SECONDS;
          mash.staminaEl?.classList.add('locked');
          mash.touchBtn?.classList.add('locked');
        }
      }
    } else if (this.qte.type === QTE_TYPES.COMBO) {
      // Lap-wrap detection for the relock penalty (see relockCombo) — the
      // timing marker sweeps on a CSS animation, so JS has to independently
      // track lap boundaries by elapsed time to know when one completes
      // without a scored hit. A while loop (not an if) covers the
      // vanishingly rare case of more than one lap elapsing in a single
      // frame (e.g. a stalled tab regaining focus).
      const timing = this.qte.timing;
      const elapsedMs = performance.now() - timing.sessionStartTime;
      const lapIndex = Math.floor(elapsedMs / (timing.periodSeconds * 1000));
      while (timing.currentLapIndex < lapIndex) {
        if (!timing.hitThisLap) this.relockCombo();
        timing.hitThisLap = false;
        timing.currentLapIndex += 1;
      }
    }
  }

  updateQTETimerUI() {
    if (!this.qte) return;
    const fill = this.qte.modal.querySelector('.qte-timer-fill');
    if (fill) fill.style.width = `${Math.max(0, (this.qte.remaining / this.qte.timeLimit) * 100)}%`;
  }

  /**
   * Thief's Curiosity (Thief's Skeleton): a failed QTE gets ONE retry — a
   * completely fresh attempt (same type, fresh state, fresh timer),
   * transparent to the caller (onResolve still only ever fires once,
   * exactly as before). Failing the retry too costs a flat
   * QTE_SECOND_CHANCE_FAIL_DAMAGE — its own distinct penalty for having
   * taken the second chance at all, NOT "damage from failing a QTE" in
   * the sense Thief's Experience/noQteFailDamage protects against (that's
   * about the event's own trap-style damage), so it always applies even
   * with the full Thief's set equipped.
   */
  finishQTE(success, reason = null) {
    const { onResolve, modal, isRetry, type, difficultyMultiplier } = this.qte;
    if (!success && this.hasPassiveFlag('qteSecondChance') && !isRetry) {
      modal.remove();
      this.qte = null;
      // No mode write here — startQTE() below immediately re-sets
      // mode='qte' anyway, so there's no observable moment in between.
      this.app.gameState.addLog(t('log.thiefs_curiosity_retry'));
      this.startQTE(onResolve, { type, difficultyMultiplier, isRetry: true });
      return;
    }
    if (!success && isRetry) {
      const before = this.player.currentHealth;
      this.player.currentHealth = Math.max(1, this.player.currentHealth - QTE_SECOND_CHANCE_FAIL_DAMAGE);
      const dealt = before - this.player.currentHealth;
      this.app.gameState.run.savedHealth = this.player.currentHealth;
      if (dealt > 0) this.app.gameState.addLog(t('log.thiefs_curiosity_damage', { n: dealt }));
    }
    modal.remove();
    this.qte = null;
    // 'result' (not 'normal') — onResolve() below synchronously calls one
    // of the resolve*/show* methods, which always ends by calling
    // showResult(), so the QTE session isn't over yet; it's transitioning
    // straight into its trailing result modal without passing back
    // through 'normal' in between. Mouse-look stays suspended the whole
    // time (see showResult's own comment).
    this.mode = 'result';
    onResolve(success, reason);
  }

  /** Base reward multiplier: initial (floor-independent) amounts are quartered, then grown back +15%/floor *compounding*, plus any equipped reward-boost passive (e.g. Thief's Greed) — rounded up. */
  getRewardMultiplier(run) {
    return REWARD_INITIAL_SCALE * (1 + REWARD_FLOOR_BONUS_PER_FLOOR) ** run.floor * (1 + this.getPassiveSum('rewardBonusPercent') / 100);
  }

  /**
   * Thief's Repentance (Thief's Halo): a flat % of max HP back on any
   * successful event, clamped to max — returns the amount ACTUALLY
   * gained (Character.heal()'s own return value is the pre-clamp
   * attempted amount, which overstates this near max HP, so the real
   * gain is computed from the before/after health delta instead).
   */
  applyEventSuccessHeal() {
    const percent = this.getPassiveSum('eventSuccessHealPercent');
    if (percent <= 0) return 0;
    const before = this.player.currentHealth;
    this.player.heal(Math.round(this.player.getMaxHealth() * percent / 100));
    const healed = this.player.currentHealth - before;
    if (healed > 0) this.app.gameState.run.savedHealth = this.player.currentHealth;
    return healed;
  }

  resolveLockedDoor(success, tile) {
    const { app } = this;
    const run = app.gameState.run;
    if (success) {
      const amount = Math.ceil(LOCKED_ROOM_GOLD_REWARD * this.getRewardMultiplier(run));
      app.gameState.player.gold += amount;
      run.achievementProgress = run.achievementProgress ?? {};
      run.achievementProgress.doorOpenedFloor = run.floor;
      tile.meta.looted = true;
      const lines = [t('explore.reward_gold', { n: amount })];
      const healed = this.applyEventSuccessHeal();
      if (healed > 0) lines.push(t('explore.reward_heal', { n: healed }));
      this.showResult(t('explore.locked_room_opened'), lines);
    } else {
      this.showResult(t('explore.locked_room_failed'), [t('explore.lock_held')]);
    }
    this.updateThiefStreak(success);
    this.checkFloorFullyLooted();
    this.app.saveSystem.save();
  }

  resolveTreasure(success, tile) {
    const { app } = this;
    const run = app.gameState.run;
    if (success) {
      const materialPool = getArcForFloor(run.floor).materials ?? ['bones', 'flesh', 'mana_stone'];
      const materialId = materialPool[randomInt(0, Math.max(0, materialPool.length - 1))];
      const amount = Math.ceil(randomInt(2, 4) * this.getRewardMultiplier(run));
      app.inventory.addMaterial(materialId, amount, true);
      const materialName = tData('material', materialId, getMaterialConfig(materialId)?.name ?? materialId);
      run.achievementProgress = run.achievementProgress ?? {};
      run.achievementProgress.chestOpenedFloor = run.floor;
      run.achievementProgress.chestsOpenedThisRun = (run.achievementProgress.chestsOpenedThisRun ?? 0) + 1;
      tile.meta.looted = true;
      const lines = [t('explore.reward_material', { n: amount, material: materialName })];
      const healed = this.applyEventSuccessHeal();
      if (healed > 0) lines.push(t('explore.reward_heal', { n: healed }));
      this.showResult(t('explore.chest_opened'), lines);
    } else if (this.hasPassiveFlag('noQteFailDamage')) {
      this.showResult(t('explore.chest_trapped_title'), [t('explore.chest_trapped_line', { n: 0 })]);
    } else {
      const before = this.player.currentHealth;
      this.player.currentHealth = Math.max(1, this.player.currentHealth - CHEST_TRAP_DAMAGE);
      const dealt = before - this.player.currentHealth;
      run.savedHealth = this.player.currentHealth;
      this.showResult(t('explore.chest_trapped_title'), [t('explore.chest_trapped_line', { n: dealt })]);
    }
    this.updateThiefStreak(success);
    this.checkFloorFullyLooted();
    this.app.saveSystem.save();
    this.renderHUD();
  }

  /**
   * Temporal Chest: same failure behavior as a regular chest, but success
   * grants BOTH gold and materials at TEMPORAL_CHEST_REWARD_MULTIPLIER×
   * (9x, tripled per user request to match the new Combo QTE guarding
   * it — see buildComboQTE), with a real (if still minority) chance at a
   * rare material regular chests never roll at all.
   */
  resolveTemporalChest(success, tile) {
    const { app } = this;
    const run = app.gameState.run;
    if (success) {
      const mult = this.getRewardMultiplier(run);
      const goldAmount = Math.ceil(LOCKED_ROOM_GOLD_REWARD * TEMPORAL_CHEST_REWARD_MULTIPLIER * mult);
      app.gameState.player.gold += goldAmount;

      const isRare = rollWeightedChoice([
        { weight: TEMPORAL_CHEST_RARE_CHANCE, value: true },
        { weight: 100 - TEMPORAL_CHEST_RARE_CHANCE, value: false },
      ]);
      const materialPool = isRare ? RARE_MATERIALS : (getArcForFloor(run.floor).materials ?? ['bones', 'flesh', 'mana_stone']);
      const materialId = materialPool[randomInt(0, Math.max(0, materialPool.length - 1))];
      const materialAmount = Math.ceil(randomInt(2, 4) * TEMPORAL_CHEST_REWARD_MULTIPLIER * mult);
      app.inventory.addMaterial(materialId, materialAmount, true);
      const materialName = tData('material', materialId, getMaterialConfig(materialId)?.name ?? materialId);

      run.achievementProgress = run.achievementProgress ?? {};
      run.achievementProgress.chestOpenedFloor = run.floor;
      run.achievementProgress.chestsOpenedThisRun = (run.achievementProgress.chestsOpenedThisRun ?? 0) + 1;
      tile.meta.looted = true;

      const lines = [
        t('explore.reward_gold', { n: goldAmount }),
        t('explore.reward_material', { n: materialAmount, material: materialName }),
      ];
      const healed = this.applyEventSuccessHeal();
      if (healed > 0) lines.push(t('explore.reward_heal', { n: healed }));
      this.showResult(t('explore.temporal_chest_opened'), lines);
    } else if (this.hasPassiveFlag('noQteFailDamage')) {
      this.showResult(t('explore.chest_trapped_title'), [t('explore.chest_trapped_line', { n: 0 })]);
    } else {
      // Clamped to 1, never lethal — same "never kills" guarantee as a
      // regular chest, just with a bigger bite at TEMPORAL_CHEST_TRAP_DAMAGE.
      const before = this.player.currentHealth;
      this.player.currentHealth = Math.max(1, this.player.currentHealth - TEMPORAL_CHEST_TRAP_DAMAGE);
      const dealt = before - this.player.currentHealth;
      run.savedHealth = this.player.currentHealth;
      this.showResult(t('explore.chest_trapped_title'), [t('explore.chest_trapped_line', { n: dealt })]);
    }
    this.updateThiefStreak(success);
    this.checkFloorFullyLooted();
    this.app.saveSystem.save();
    this.renderHUD();
  }

  /**
   * Sealed Shrine (Hold QTE): grants a random-rarity Shrine card (see
   * rollShrineCard — a restricted "regular stat" pool at 3x a normal
   * card's value). Deliberately does NOT call updateThiefStreak/
   * checkFloorFullyLooted — per user decision, "Thief's Instinct" stays
   * scoped to only locked doors/chests/temporal chests (see
   * checkFloorFullyLooted's own doc comment). The new card takes effect
   * immediately (not just on the next floor change) by rebuilding the
   * player right here, mirroring applyCardPick's own rebuild.
   *
   * Failure damage depends on HOW the Hold QTE was lost (see `reason`,
   * forwarded from finishQTE): losing to the kill bar (an early fail with
   * time still on the clock — you weren't even close) costs
   * SEALED_SHRINE_KILLBAR_FAIL_DAMAGE; losing to the timer running out
   * while still holding position (right there, just not in the zone at
   * the final instant) costs the much steeper
   * SEALED_SHRINE_TIMEOUT_FAIL_DAMAGE — the closer you got, the worse the
   * backlash, per user request.
   */
  resolveSealedShrine(success, tile, reason) {
    const { app } = this;
    const run = app.gameState.run;
    if (success) {
      const picked = rollShrineCard();
      run.cards.push(picked);
      run.savedHealth = this.player.currentHealth;
      this.player = app.createPlayer();
      this.syncPlayer3D();
      tile.meta.looted = true;
      const name = tData('card', picked.cardId, CARDS[picked.cardId].name);
      const lines = [t('explore.reward_shrine_card', { name })];
      const healed = this.applyEventSuccessHeal();
      if (healed > 0) lines.push(t('explore.reward_heal', { n: healed }));
      this.showResult(t('explore.shrine_opened'), lines);
    } else if (this.hasPassiveFlag('noQteFailDamage')) {
      this.showResult(t('explore.shrine_failed_title'), [t('explore.shrine_failed_line', { n: 0 })]);
    } else {
      const damage = reason === 'killBar' ? SEALED_SHRINE_KILLBAR_FAIL_DAMAGE : SEALED_SHRINE_TIMEOUT_FAIL_DAMAGE;
      const before = this.player.currentHealth;
      this.player.currentHealth = Math.max(1, this.player.currentHealth - damage);
      const dealt = before - this.player.currentHealth;
      run.savedHealth = this.player.currentHealth;
      this.showResult(t('explore.shrine_failed_title'), [t('explore.shrine_failed_line', { n: dealt })]);
    }
    this.app.saveSystem.save();
    this.renderHUD();
  }

  /**
   * Arcane Sigil (Memory QTE): pushes a stat buff onto run.floorBuffs — a
   * genuine FLOOR buff per user request, distinct from the
   * run.explorationBuffs pipeline consumables use (that one is a
   * one-fight-only buff; see CombatManager.applyExplorationBuffs). This
   * buff instead reapplies at the start of EVERY fight for the rest of
   * the current floor (see CombatManager.applyFloorBuffs) and is only
   * cleared on floor change (StateManager.archiveCurrentFloor), not on
   * winning or losing any individual fight. Amount uses its own
   * floor-linear formula (not getRewardMultiplier's compounding curve,
   * which is tuned for gold/materials and would undervalue a flat stat
   * buff at low floors) — see ARCANE_SIGIL_BASE_BUFF_AMOUNT.
   */
  resolveArcaneSigil(success, tile) {
    const { app } = this;
    const run = app.gameState.run;
    if (success) {
      const stat = pickRandom(ARCANE_SIGIL_BUFF_STATS);
      let amount = Math.round(ARCANE_SIGIL_BASE_BUFF_AMOUNT + run.floor * ARCANE_SIGIL_BUFF_PER_FLOOR);
      amount = Math.round(amount * (1 + this.getPassiveSum('rewardBonusPercent') / 100));
      run.floorBuffs = run.floorBuffs ?? [];
      run.floorBuffs.push({ type: 'stat', stat, amount, duration: -1 });
      tile.meta.looted = true;
      const lines = [t('explore.reward_sigil_buff', { n: amount, stat: statLabel(stat) })];
      const healed = this.applyEventSuccessHeal();
      if (healed > 0) lines.push(t('explore.reward_heal', { n: healed }));
      this.showResult(t('explore.sigil_opened'), lines);
    } else if (this.hasPassiveFlag('noQteFailDamage')) {
      this.showResult(t('explore.sigil_failed_title'), [t('explore.sigil_failed_line', { n: 0 })]);
    } else {
      const before = this.player.currentHealth;
      this.player.currentHealth = Math.max(1, this.player.currentHealth - ARCANE_SIGIL_TRAP_DAMAGE);
      const dealt = before - this.player.currentHealth;
      run.savedHealth = this.player.currentHealth;
      this.showResult(t('explore.sigil_failed_title'), [t('explore.sigil_failed_line', { n: dealt })]);
    }
    this.app.saveSystem.save();
    this.renderHUD();
  }

  /** The 3 reward shapes a Wandering Satchel offers — see showSatchelPicker. */
  rollSatchelOptions(mult) {
    const run = this.app.gameState.run;
    const materialPool = getArcForFloor(run.floor).materials ?? ['bones', 'flesh', 'mana_stone'];
    const randomMaterial = () => materialPool[randomInt(0, Math.max(0, materialPool.length - 1))];
    return [
      { kind: 'gold', amount: Math.ceil(LOCKED_ROOM_GOLD_REWARD * SATCHEL_GOLD_RATIO * mult) },
      { kind: 'material', materialId: randomMaterial(), amount: Math.ceil(randomInt(SATCHEL_MATERIAL_MIN, SATCHEL_MATERIAL_MAX) * mult) },
      {
        kind: 'mixed',
        goldAmount: Math.ceil(LOCKED_ROOM_GOLD_REWARD * SATCHEL_MIXED_GOLD_RATIO * mult),
        materialId: randomMaterial(),
        materialAmount: Math.ceil(randomInt(SATCHEL_MIXED_MATERIAL_MIN, SATCHEL_MIXED_MATERIAL_MAX) * mult),
      },
    ];
  }

  satchelOptionLabel(option) {
    if (option.kind === 'gold') return t('explore.satchel_option_gold', { n: option.amount });
    if (option.kind === 'material') {
      const name = tData('material', option.materialId, getMaterialConfig(option.materialId)?.name ?? option.materialId);
      return t('explore.satchel_option_material', { n: option.amount, material: name });
    }
    const name = tData('material', option.materialId, getMaterialConfig(option.materialId)?.name ?? option.materialId);
    return t('explore.satchel_option_mixed', { gold: option.goldAmount, n: option.materialAmount, material: name });
  }

  /** Wandering Satchel: no QTE — pick one of 3 reward shapes (see rollSatchelOptions), always "succeeds" once picked. */
  showSatchelPicker(tile) {
    this.mode = 'modal';
    this.pauseMouseLookForEvent();
    const run = this.app.gameState.run;
    const mult = this.getRewardMultiplier(run);
    const options = this.rollSatchelOptions(mult);
    const modal = document.createElement('div');
    modal.className = 'result-overlay';
    modal.innerHTML = `
      <div class="result-box satchel-box">
        <h2>${t('explore.satchel_title')}</h2>
        <div class="satchel-options"></div>
      </div>`;
    this.root.appendChild(modal);
    const grid = modal.querySelector('.satchel-options');
    grid.innerHTML = options.map((opt, i) => `<button class="satchel-option-btn" data-i="${i}">${this.satchelOptionLabel(opt)}</button>`).join('');
    grid.querySelectorAll('[data-i]').forEach((btn) => {
      btn.addEventListener('click', () => {
        modal.remove();
        this.mode = 'normal';
        this.restoreMouseLookAfterEvent();
        this.applySatchelOption(options[Number(btn.dataset.i)], tile);
      });
    });
  }

  applySatchelOption(option, tile) {
    const { app } = this;
    const run = app.gameState.run;
    const lines = [];
    if (option.kind === 'gold') {
      app.gameState.player.gold += option.amount;
      lines.push(t('explore.reward_gold', { n: option.amount }));
    } else if (option.kind === 'material') {
      app.inventory.addMaterial(option.materialId, option.amount, true);
      const name = tData('material', option.materialId, getMaterialConfig(option.materialId)?.name ?? option.materialId);
      lines.push(t('explore.reward_material', { n: option.amount, material: name }));
    } else {
      app.gameState.player.gold += option.goldAmount;
      app.inventory.addMaterial(option.materialId, option.materialAmount, true);
      const name = tData('material', option.materialId, getMaterialConfig(option.materialId)?.name ?? option.materialId);
      lines.push(t('explore.reward_gold', { n: option.goldAmount }));
      lines.push(t('explore.reward_material', { n: option.materialAmount, material: name }));
    }
    tile.meta.looted = true;
    const healed = this.applyEventSuccessHeal();
    if (healed > 0) lines.push(t('explore.reward_heal', { n: healed }));
    this.showResult(t('explore.satchel_opened'), lines);
    run.savedHealth = this.player.currentHealth;
    this.app.saveSystem.save();
    this.renderHUD();
  }

  /** Wounded Animal: "Let it die" (no-op) vs "Try and save it" (30% instant success / 70% Mash QTE) — see attemptSaveWoundedAnimal. */
  showWoundedAnimalChoice(tile) {
    this.mode = 'modal';
    this.pauseMouseLookForEvent();
    const modal = document.createElement('div');
    modal.className = 'result-overlay';
    modal.innerHTML = `
      <div class="result-box wounded-animal-box">
        <h2>${t('explore.wounded_animal_title')}</h2>
        <div class="result-line">${t('explore.wounded_animal_prompt')}</div>
        <div class="wounded-animal-choices">
          <button class="cat-btn" data-choice="let_die">${t('explore.wounded_animal_let_die')}</button>
          <button class="cat-btn" data-choice="save">${t('explore.wounded_animal_save')}</button>
        </div>
      </div>`;
    this.root.appendChild(modal);
    modal.querySelector('[data-choice="let_die"]').addEventListener('click', () => {
      modal.remove();
      this.mode = 'normal';
      this.restoreMouseLookAfterEvent();
      this.app.gameState.addLog(t('log.wounded_animal_let_die'));
      this.app.saveSystem.save();
    });
    modal.querySelector('[data-choice="save"]').addEventListener('click', () => {
      modal.remove();
      this.mode = 'normal';
      this.restoreMouseLookAfterEvent();
      this.attemptSaveWoundedAnimal(tile);
    });
  }

  attemptSaveWoundedAnimal(tile) {
    const instantSuccess = rollWeightedChoice([
      { weight: WOUNDED_ANIMAL_INSTANT_CHANCE, value: true },
      { weight: 100 - WOUNDED_ANIMAL_INSTANT_CHANCE, value: false },
    ]);
    if (instantSuccess) {
      this.grantWoundedAnimalMaterials(tile);
      return;
    }
    this.startQTE((success) => this.resolveWoundedAnimalMash(success, tile), { type: QTE_TYPES.MASH });
  }

  /** Shared by the 30% instant-save branch and the Mash-success fallback (pending enemy debuff already queued) — identical to resolveTreasure's material reward. */
  grantWoundedAnimalMaterials(tile) {
    const { app } = this;
    const run = app.gameState.run;
    const materialPool = getArcForFloor(run.floor).materials ?? ['bones', 'flesh', 'mana_stone'];
    const materialId = materialPool[randomInt(0, Math.max(0, materialPool.length - 1))];
    const amount = Math.ceil(randomInt(2, 4) * this.getRewardMultiplier(run));
    app.inventory.addMaterial(materialId, amount, true);
    const materialName = tData('material', materialId, getMaterialConfig(materialId)?.name ?? materialId);
    tile.meta.looted = true;
    const lines = [t('explore.reward_material', { n: amount, material: materialName })];
    const healed = this.applyEventSuccessHeal();
    if (healed > 0) lines.push(t('explore.reward_heal', { n: healed }));
    this.showResult(t('explore.wounded_animal_saved'), lines);
    this.app.saveSystem.save();
    this.renderHUD();
  }

  /**
   * Mash-QTE branch (70% chance). Success queues a single-slot,
   * non-stacking "next enemy starts combat with 2 bleed stacks" debuff
   * (see run.pendingEnemyDebuff / CombatManager.applyPendingEnemyDebuff)
   * — if one is already queued and unconsumed, falls back to the same
   * material reward as the instant-save branch instead of stacking or
   * overwriting it. On top of the debuff, a small flat gold bonus (see
   * WOUNDED_ANIMAL_MASH_BONUS_GOLD_RATIO) rewards actually winning the
   * QTE itself, deliberately modest since the debuff is the real prize.
   * Failure deals a flat WOUNDED_ANIMAL_MASH_FAIL_DAMAGE, gated by
   * noQteFailDamage like every other event's trap damage.
   */
  resolveWoundedAnimalMash(success, tile) {
    const { app } = this;
    const run = app.gameState.run;
    if (success) {
      if (run.pendingEnemyDebuff) {
        this.grantWoundedAnimalMaterials(tile);
        return;
      }
      run.pendingEnemyDebuff = { effect: 'bleed', stacks: 2 };
      tile.meta.looted = true;
      const goldAmount = Math.ceil(LOCKED_ROOM_GOLD_REWARD * WOUNDED_ANIMAL_MASH_BONUS_GOLD_RATIO * this.getRewardMultiplier(run));
      app.gameState.player.gold += goldAmount;
      const lines = [t('explore.reward_pending_debuff'), t('explore.reward_gold', { n: goldAmount })];
      const healed = this.applyEventSuccessHeal();
      if (healed > 0) lines.push(t('explore.reward_heal', { n: healed }));
      this.showResult(t('explore.wounded_animal_saved'), lines);
    } else if (this.hasPassiveFlag('noQteFailDamage')) {
      this.showResult(t('explore.wounded_animal_failed_title'), [t('explore.wounded_animal_failed_line', { n: 0 })]);
    } else {
      const before = this.player.currentHealth;
      this.player.currentHealth = Math.max(1, this.player.currentHealth - WOUNDED_ANIMAL_MASH_FAIL_DAMAGE);
      const dealt = before - this.player.currentHealth;
      run.savedHealth = this.player.currentHealth;
      this.showResult(t('explore.wounded_animal_failed_title'), [t('explore.wounded_animal_failed_line', { n: dealt })]);
    }
    this.app.saveSystem.save();
    this.renderHUD();
  }

  /** Unresolved event tiles left on the current floor, across all 7 event types. */
  getRemainingEventCounts() {
    const tiles = this.app.gameState.run.dungeon?.tiles ?? [];
    const count = (type) => tiles.filter((t) => t.type === type && !t.meta.resolved).length;
    const lockedRooms = count(TILE_TYPES.LOCKED_DOOR);
    const chests = count(TILE_TYPES.TREASURE);
    const temporalChests = count(TILE_TYPES.TEMPORAL_CHEST);
    const shrines = count(TILE_TYPES.SEALED_SHRINE);
    const sigils = count(TILE_TYPES.ARCANE_SIGIL);
    const satchels = count(TILE_TYPES.WANDERING_SATCHEL);
    const woundedAnimals = count(TILE_TYPES.WOUNDED_ANIMAL);
    return {
      lockedRooms, chests, temporalChests, shrines, sigils, satchels, woundedAnimals,
      total: lockedRooms + chests + temporalChests + shrines + sigils + satchels + woundedAnimals,
    };
  }

  /**
   * "Thief's Instinct" achievement: on a single floor numbered 3 or
   * higher, every locked door / chest / temporal chest on it has been
   * successfully looted (a failed QTE resolves the tile but doesn't
   * count — see the `tile.meta.looted` flag set only on success above).
   * Checked after every event resolution; no-ops on floors below 3 or a
   * floor with no events at all (nothing to loot isn't "looting all of it").
   *
   * Deliberately still scoped to only these 3 original event types, NOT
   * all 7 (per user decision — the achievement's own description text
   * only ever promised "every locked door, chest, and temporal chest").
   * Sealed Shrine/Arcane Sigil/Wandering Satchel/Wounded Animal resolvers
   * never call this or updateThiefStreak. Contrast with
   * checkHiddenGateUnlock, which reads getRemainingEventCounts().total —
   * ALL 7 types — since floor 5's gate should require the floor genuinely
   * cleared, not leave 4 new event types permanently unclearable there.
   */
  checkFloorFullyLooted() {
    const run = this.app.gameState.run;
    if (run.floor < 3) return;
    const eventTypes = [TILE_TYPES.LOCKED_DOOR, TILE_TYPES.TREASURE, TILE_TYPES.TEMPORAL_CHEST];
    const eventTiles = (run.dungeon?.tiles ?? []).filter((t) => eventTypes.includes(t.type));
    if (!eventTiles.length) return;
    if (eventTiles.every((t) => t.meta.looted)) {
      this.app.achievements.setComplete('loot_all_events_floor_3_plus');
    }
  }

  /**
   * Full explored-so-far map, opened by clicking the corner minimap or
   * pressing M. Blocks movement like every other modal here — which also
   * means the player's look yaw can't change while this is open, so the
   * heading-up rotation only needs to be computed once, at open time, not
   * kept live-updated. Per user request, always oriented to whichever way
   * the player is currently looking (heading-up), independent of the
   * corner minimap's own separate "Fixed Minimap" north-up setting.
   */
  openMinimapExpanded() {
    this.mode = 'modal';
    this.pauseMouseLookForEvent();
    const modal = document.createElement('div');
    modal.className = 'result-overlay';
    modal.innerHTML = `
      <div class="result-box minimap-expanded-box">
        <h2>${t('explore.minimap_title')}</h2>
        <div class="minimap-scroll"><div class="minimap-expanded-viewport"><canvas class="minimap-expanded-canvas"></canvas></div></div>
        <button class="result-close">${t('explore.close')}</button>
      </div>`;
    this.root.appendChild(modal);
    const yaw = this.renderer3d?.getLookYaw();
    // Same sign convention as the corner minimap's own update() — its CSS
    // rotation is the mirror image of the 3D camera's world-yaw.
    const angleDeg = yaw === undefined ? 0 : -(yaw * 180) / Math.PI;
    this.minimap.drawExpanded(
      modal.querySelector('.minimap-expanded-canvas'),
      modal.querySelector('.minimap-expanded-viewport'),
      angleDeg,
      yaw,
    );
    modal.querySelector('.result-close').addEventListener('click', () => {
      modal.remove();
      this.mode = 'normal';
      this.restoreMouseLookAfterEvent();
    });
  }

  /**
   * Floor 5 only: the hidden hallway's mid-point gate (see
   * DungeonGenerator.placeHiddenArena) stays a plain WALL — reading as an
   * ordinary dead end — until the floor is genuinely finished: every
   * regular enemy dead and every locked door/chest/temporal chest looted.
   * Only then does it open, per user request, so finding the "dead end"
   * early doesn't shortcut clearing the floor. Self-guards on the gate
   * tile's own type, so it's cheap and safe to call from every renderHUD().
   */
  checkHiddenGateUnlock() {
    const run = this.app.gameState.run;
    if (run.floor !== 5) return;
    const gateTile = (run.dungeon?.tiles ?? []).find((tile) => tile.meta.isHiddenGate);
    if (!gateTile || gateTile.type !== TILE_TYPES.WALL) return;
    if (run.enemiesRemaining > 0 || this.getRemainingEventCounts().total > 0) return;
    gateTile.type = TILE_TYPES.FLOOR;
    run.floorMessage = { text: t('explore.hidden_gate_opened'), timer: 3 };
    // Bypasses the memoized syncDungeon3D() (which no-ops on an unchanged
    // dungeon reference) — this mutates a tile in place rather than
    // swapping in a new floor, so the renderer needs an explicit rebuild.
    this.renderer3d?.setDungeon(run.dungeon);
    this._synced3DDungeon = run.dungeon;
    this.app.saveSystem.save();
  }

  renderHUD() {
    const run = this.app.gameState.run;
    this.checkHiddenGateUnlock();
    const dungeon = run.dungeon;
    const counts = this.getRemainingEventCounts();
    // Rounded — run.playerPosition is a continuous free-movement position
    // now, not a grid index, so an exact getTileAt match would almost
    // never hit; "which tile am I on" is always the nearest one.
    const currentTile = this.getTileAt(Math.round(run.playerPosition.x), Math.round(run.playerPosition.y));
    const canDescend = currentTile?.type === TILE_TYPES.STAIRS && run.enemiesRemaining === 0;
    // Percentage, not a raw "X/Y" tile count, per user request — now that
    // exploration itself is a smooth continuous-radius reveal (see
    // revealNearbyTiles) rather than discrete tile-by-tile pop-in, a
    // percentage reads as the more natural match for that continuity.
    const exploredPercent = Math.floor(((run.tilesExplored / (dungeon?.tilesTotal || 1)) * 100));

    this.els.hud.innerHTML = `
      <span>${t('explore.floor', { n: run.floor })}</span>
      <span>${t('explore.explored', { percent: exploredPercent })}</span>
      <span>${t('explore.enemies_remaining', { n: run.enemiesRemaining })}</span>
      <span class="events-indicator" data-events>${t('explore.events_remaining', { n: counts.total })}</span>
      <span>${t('explore.hp', { current: this.player.currentHealth, max: this.player.getMaxHealth() })}</span>`;
    this.els.msg.textContent = run.floorMessage?.text ?? '';
    this.tooltip.bind(this.els.hud.querySelector('[data-events]'), () => eventsBreakdownHTML(counts));

    this.els.descend.innerHTML = canDescend ? `<button data-descend>${t('explore.descend')}</button>` : '';
    this.els.descend.querySelector('[data-descend]')?.addEventListener('click', () => this.showCardPick());
  }
}
