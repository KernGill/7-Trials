import { TILE_TYPES } from '../exploration/Tile.js';
import { PauseOverlay } from './PauseOverlay.js';
import { getConsumableConfig } from '../data/consumables.js';
import { getMaterialConfig } from '../data/items.js';
import { getArcForFloor } from '../data/arcs.js';
import {
  rollCardOffer, canFuseCards, fuseCards, cardValueForRarity, cardsInCategory,
  CARDS, RARITIES, RARITY_COLORS, CARD_PRICES,
} from '../data/cards.js';
import { cardTileHTML, cardTooltipHTML, shopCardTileHTML } from '../ui/InfoFormatters.js';
import { arrowIconSVG } from '../ui/DirectionIcons.js';
import { t, tData } from '../ui/i18n.js';
import { DungeonRenderer3D } from '../exploration/DungeonRenderer3D.js';
import { Minimap } from '../exploration/Minimap.js';
import { TooltipManager } from '../ui/TooltipManager.js';
import { CHEST_TRAP_DAMAGE, TEMPORAL_CHEST_TRAP_DAMAGE, LOCKED_ROOM_GOLD_REWARD } from '../utils/Constants.js';
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
// 50% harder than a regular chest (arrow count).
const TEMPORAL_CHEST_ARROW_MULTIPLIER = 1.5;
// Base reward bumped +50% on top of its prior 2x-a-regular-chest value.
const TEMPORAL_CHEST_REWARD_MULTIPLIER = 3;
const RARE_MATERIALS = ['jar_of_spores', 'memory_fragment'];
const TEMPORAL_CHEST_RARE_CHANCE = 20; // vs. 0% from a normal chest's material pool
// Thief's Curiosity (Thief's Skeleton): flat penalty for failing the
// one-time retry — see finishQTE.
const QTE_SECOND_CHANCE_FAIL_DAMAGE = 100;

// Hidden floor-5 boss encounter (see DungeonGenerator's placeHiddenArena
// and the TILE_TYPES.HIDDEN_ENEMY case below): shake+darken plays over the
// dungeon view for HIDDEN_BOSS_TRANSITION_MS before the actual combat
// transition tears the renderer down.
const HIDDEN_BOSS_SHAKE_MS = 900;
const HIDDEN_BOSS_SHAKE_MAGNITUDE = 0.15;
const HIDDEN_BOSS_TRANSITION_MS = 1000;

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
    this.pause = new PauseOverlay(app);
    this.qte = null;
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
    return !this.app.gameState.paused && !this.resultOpen && !this.qte;
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
      this.qte.remaining -= dt;
      if (this.qte.remaining <= 0) {
        this.finishQTE(false);
      } else {
        this.updateQTETimerUI();
      }
    }
  }

  handleKeydown(e) {
    if (this.qte) {
      this.handleQTEKeydown(e);
      return;
    }
    if (this.app.gameState.paused || this.resultOpen) return;
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
      // resultOpen guard above already keeps this a no-op if it's open.
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
        this.startQTE((success) => this.resolveLockedDoor(success, tile));
        break;
      }
      case TILE_TYPES.TREASURE: {
        if (tile.meta.resolved) break;
        tile.meta.resolved = true;
        this.startQTE((success) => this.resolveTreasure(success, tile));
        break;
      }
      case TILE_TYPES.TEMPORAL_CHEST: {
        if (tile.meta.resolved) break;
        tile.meta.resolved = true;
        this.startQTE((success) => this.resolveTemporalChest(success, tile), { arrowMultiplier: TEMPORAL_CHEST_ARROW_MULTIPLIER });
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
    this.resultOpen = true;
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
      this.resultOpen = false;
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
    this.resultOpen = true;
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
          this.resultOpen = false;
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
    this.resultOpen = true;
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
        this.resultOpen = false;
        this.restoreMouseLookAfterEvent();
        this.useElevator(target);
      });
    });
    modal.querySelector('.result-close').addEventListener('click', () => {
      modal.remove();
      this.resultOpen = false;
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
    this.resultOpen = true;
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
      this.resultOpen = false;
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
   * Quick-time event gating locked doors and chests. Dex adds time (not
   * success chance, per user request), and arrow count/rewards both scale
   * with the current floor — see resolveLockedDoor/resolveTreasure.
   */
  startQTE(onResolve, { arrowMultiplier = 1, isRetry = false } = {}) {
    const run = this.app.gameState.run;
    const baseArrowCount = Math.floor((QTE_BASE_ARROWS + run.floor) * arrowMultiplier);
    // Thief's Providence (Thief's Ring) reduces arrow count; Thief's
    // Resolve (Thief's Sleeves) increases it — both flat percents, summed
    // into one net multiplier so equipping both nets their difference
    // rather than compounding in some arbitrary order.
    const arrowReductionPercent = this.getPassiveSum('qteArrowReductionPercent');
    const arrowIncreasePercent = this.getPassiveSum('qteArrowIncreasePercent');
    const netPercent = arrowIncreasePercent - arrowReductionPercent;
    const arrowCount = Math.max(1, Math.ceil(baseArrowCount * (1 + netPercent / 100)));
    const directions = Array.from({ length: arrowCount }, () => pickRandom(QTE_DIRECTIONS));
    const dex = this.player.getStat('dex');
    const timeLimit = QTE_BASE_SECONDS + Math.floor(dex / QTE_DEX_SECONDS_INTERVAL) * QTE_DEX_SECONDS_PER_INTERVAL + this.getPassiveSum('qteBonusSeconds');

    this.resultOpen = true;
    this.pauseMouseLookForEvent();
    // Thief's Prophecy (Thief's Goggles): every OTHER arrow gets auto-cleared
    // for free (see advanceQTE), always starting from index 0 — so which
    // arrows actually need a press is fixed and known up front. Marked
    // visually (red underglow = press this one, greyscale = it's free) so
    // the player can tell at a glance which ones to ignore.
    const doubleAdvance = this.hasPassiveFlag('qteDoubleAdvance');
    const modal = document.createElement('div');
    modal.className = 'qte-overlay';
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
    this.root.appendChild(modal);
    // Touch input for the same sequence keyboard players answer with
    // QTE_DIRECTION_KEYS — see submitQTEDirection, the shared core both
    // this and handleQTEKeydown funnel into.
    modal.querySelectorAll('.qte-touch-btn').forEach((btn) => {
      btn.addEventListener('touchstart', (e) => {
        e.preventDefault();
        this.submitQTEDirection(btn.dataset.dir);
      }, { passive: false });
    });
    // Captured up front, by index, rather than re-querying '.qte-key' on
    // every keypress — a querySelector re-grab would return the same
    // still-in-DOM first element if two correct presses land faster than
    // advanceQTE's 120ms removal animation, leaving the visual strip a
    // step behind the (still-correct) internal index.
    const keyElements = Array.from(modal.querySelectorAll('.qte-key'));

    this.qte = { directions, index: 0, timeLimit, remaining: timeLimit, modal, keyElements, onResolve, arrowMultiplier, isRetry };
    this.updateQTETimerUI();
  }

  handleQTEKeydown(e) {
    const dir = QTE_DIRECTION_KEYS[e.key];
    if (!dir) return;
    e.originalEvent?.preventDefault?.();
    this.submitQTEDirection(dir);
  }

  /** Shared core behind keyboard (handleQTEKeydown) and the on-screen touch arrow pad (see startQTE's .qte-touch-btn wiring). */
  submitQTEDirection(dir) {
    if (!this.qte) return;
    const expected = this.qte.directions[this.qte.index];
    if (dir === expected) {
      this.advanceQTE();
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
  advanceQTE() {
    const advance = this.hasPassiveFlag('qteDoubleAdvance') ? 2 : 1;
    for (let i = 0; i < advance && this.qte.index < this.qte.directions.length; i += 1) {
      const keyEl = this.qte.keyElements[this.qte.index];
      keyEl?.classList.add('correct');
      setTimeout(() => keyEl?.remove(), 120);
      this.qte.index += 1;
    }
    if (this.qte.index >= this.qte.directions.length) {
      this.finishQTE(true);
    }
  }

  updateQTETimerUI() {
    if (!this.qte) return;
    const fill = this.qte.modal.querySelector('.qte-timer-fill');
    if (fill) fill.style.width = `${Math.max(0, (this.qte.remaining / this.qte.timeLimit) * 100)}%`;
  }

  /**
   * Thief's Curiosity (Thief's Skeleton): a failed QTE gets ONE retry — a
   * completely fresh attempt (new arrows, fresh timer), transparent to
   * the caller (onResolve still only ever fires once, exactly as before).
   * Failing the retry too costs a flat QTE_SECOND_CHANCE_FAIL_DAMAGE — its
   * own distinct penalty for having taken the second chance at all, NOT
   * "damage from failing a QTE" in the sense Thief's Experience/
   * noQteFailDamage protects against (that's about the event's own
   * chest-trap-style damage), so it always applies even with the full
   * Thief's set equipped.
   */
  finishQTE(success) {
    const { onResolve, modal, isRetry, arrowMultiplier } = this.qte;
    if (!success && this.hasPassiveFlag('qteSecondChance') && !isRetry) {
      modal.remove();
      this.qte = null;
      this.resultOpen = false;
      this.app.gameState.addLog(t('log.thiefs_curiosity_retry'));
      this.startQTE(onResolve, { arrowMultiplier, isRetry: true });
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
    this.resultOpen = false;
    onResolve(success);
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
   * grants BOTH gold (2x a locked room's) and materials (2x a regular
   * chest's), with a real (if still minority) chance at a rare material
   * regular chests never roll at all.
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

  /** Unresolved locked-door/chest/temporal-chest tiles left on the current floor. */
  getRemainingEventCounts() {
    const tiles = this.app.gameState.run.dungeon?.tiles ?? [];
    const lockedRooms = tiles.filter((t) => t.type === TILE_TYPES.LOCKED_DOOR && !t.meta.resolved).length;
    const chests = tiles.filter((t) => t.type === TILE_TYPES.TREASURE && !t.meta.resolved).length;
    const temporalChests = tiles.filter((t) => t.type === TILE_TYPES.TEMPORAL_CHEST && !t.meta.resolved).length;
    return { lockedRooms, chests, temporalChests, total: lockedRooms + chests + temporalChests };
  }

  /**
   * "Thief's Instinct" achievement: on a single floor numbered 3 or
   * higher, every locked door / chest / temporal chest on it has been
   * successfully looted (a failed QTE resolves the tile but doesn't
   * count — see the `tile.meta.looted` flag set only on success above).
   * Checked after every event resolution; no-ops on floors below 3 or a
   * floor with no events at all (nothing to loot isn't "looting all of it").
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
    this.resultOpen = true;
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
      this.resultOpen = false;
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
