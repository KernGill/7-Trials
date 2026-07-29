import { TILE_TYPES } from '../exploration/Tile.js';
import { PauseOverlay } from './PauseOverlay.js';
import { getConsumableConfig } from '../data/consumables.js';
import { getMaterialConfig } from '../data/items.js';
import { getArcForFloor } from '../data/arcs.js';
import { rollCardOffer } from '../data/cards.js';
import { cardTileHTML } from '../ui/InfoFormatters.js';
import { arrowIconSVG } from '../ui/DirectionIcons.js';
import { t, tData } from '../ui/i18n.js';
import { DungeonRenderer3D } from '../exploration/DungeonRenderer3D.js';
import { Minimap } from '../exploration/Minimap.js';
import { TooltipManager } from '../ui/TooltipManager.js';
import { CHEST_TRAP_DAMAGE, TEMPORAL_CHEST_TRAP_DAMAGE, LOCKED_ROOM_GOLD_REWARD } from '../utils/Constants.js';
import { randomInt } from '../utils/MathUtils.js';
import { pickRandom, rollWeightedChoice } from '../utils/RandomUtils.js';

const FACING_ORDER = ['north', 'east', 'south', 'west']; // clockwise
const FACING_DELTAS = {
  north: { dx: 0, dy: -1 },
  east: { dx: 1, dy: 0 },
  south: { dx: 0, dy: 1 },
  west: { dx: -1, dy: 0 },
};

// Touch D-pad "hold to keep moving" repeat, mirroring how holding a
// keyboard key auto-repeats keydown at the OS rate — an initial delay
// before repeats start feels less twitchy than repeating immediately.
const TOUCH_MOVE_REPEAT_DELAY_MS = 380;
const TOUCH_MOVE_REPEAT_INTERVAL_MS = 220;

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
    this.pause = new PauseOverlay(app);
    this.qte = null;
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
    this.markNearbyExplored(playerPosition.x, playerPosition.y);
    this.app.input.on('keydown', this._onKeydown);
    this._touchMoveIntervals = new Set();
    this.mountTouchControls();
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
    this._touchMoveIntervals?.forEach((cancel) => cancel());
    this._touchMoveIntervals?.clear();
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
   * enter()) — a left-side 4-way D-pad for grid movement (hold-to-repeat,
   * mirroring a held keyboard key's auto-repeat), 2 right-side quick-turn
   * buttons (single-tap 90° snaps, mirroring the left/right arrow keys),
   * and a right-side drag zone that feeds raw touch-move deltas straight
   * into DungeonRenderer3D.applyLookDelta — the touch equivalent of
   * mouse-look, since touch has no Pointer Lock relative-movement deltas
   * to read. CSS (`@media (hover:none) and (pointer:coarse)`) hides all of
   * this on mouse/trackpad devices, so listeners here are harmless no-ops
   * on desktop rather than needing a JS feature-detect gate too.
   */
  mountTouchControls() {
    const root = this.root;
    root.querySelectorAll('.touch-dpad-btn').forEach((btn) => {
      const action = btn.dataset.move;
      const fire = () => { if (this.canAct()) this.moveRelative(action); };
      // Fire once immediately, then after an initial delay (feels less
      // twitchy than repeating right away) settle into a steady repeat
      // rate until the finger lifts — mirrors a held keyboard key's
      // native auto-repeat. `cancel` (rather than a raw timer id) is what
      // gets tracked/cleared, since it spans a timeout-then-interval
      // handoff, not a single timer.
      let delayId = null;
      let repeatId = null;
      const cancel = () => {
        if (delayId !== null) { clearTimeout(delayId); delayId = null; }
        if (repeatId !== null) { clearInterval(repeatId); repeatId = null; }
        this._touchMoveIntervals.delete(cancel);
      };
      const start = (e) => {
        e.preventDefault();
        fire();
        delayId = setTimeout(() => {
          delayId = null;
          repeatId = setInterval(fire, TOUCH_MOVE_REPEAT_INTERVAL_MS);
        }, TOUCH_MOVE_REPEAT_DELAY_MS);
        this._touchMoveIntervals.add(cancel);
      };
      btn.addEventListener('touchstart', start, { passive: false });
      btn.addEventListener('touchend', cancel);
      btn.addEventListener('touchcancel', cancel);
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
    this.minimap?.update(dt, this.renderer3d?.getLookYaw());
    const run = this.app.gameState.run;
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
    // WASD moves relative to the current facing (forward/back/strafe) and
    // never changes facing itself. Left/right arrows turn in place —
    // rotate facing without moving — independent of movement.
    const moveActions = {
      w: 'forward', arrowup: 'forward',
      s: 'backward', arrowdown: 'backward',
      a: 'strafeLeft',
      d: 'strafeRight',
    };
    const turnSteps = { arrowleft: -1, arrowright: 1 };
    if (moveActions[key]) {
      e.originalEvent?.preventDefault?.();
      this.moveRelative(moveActions[key]);
    } else if (turnSteps[key] !== undefined) {
      e.originalEvent?.preventDefault?.();
      this.turnPlayer(turnSteps[key]);
    } else if (key === 'm') {
      // Same modal the corner minimap's own click already opens — the
      // resultOpen guard above already keeps this a no-op if it's open.
      this.openMinimapExpanded();
    }
  }

  getTileAt(x, y) {
    return this.app.gameState.run.dungeon?.tiles.find((t) => t.x === x && t.y === y) ?? null;
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
   * Marks every tile in the (3x3, or 5x5 with Torch equipped) area around
   * (cx,cy) as explored — not just the one actually stood on — so it
   * fills in permanently instead of reverting once the player walks away,
   * making it much faster to fill in. Walls are marked too (so the
   * minimap remembers corridor edges/shape) but only walkable tiles count
   * toward the "Explored: X/Y" HUD total, since dungeon.tilesTotal itself
   * only counts walkable tiles. This is also the ONLY place the corner
   * minimap's pixel content needs repainting from — its "close" ring is
   * always already covered by this radius (>= the minimap's own former
   * close-range bonus), so Minimap just draws whatever's `explored`.
   */
  markNearbyExplored(cx, cy) {
    const run = this.app.gameState.run;
    const hasTorch = this.app.inventory.getEquippedItems().offHand === 'torch';
    const radius = hasTorch ? 2 : 1;
    for (let dy = -radius; dy <= radius; dy += 1) {
      for (let dx = -radius; dx <= radius; dx += 1) {
        const tile = this.getTileAt(cx + dx, cy + dy);
        if (!tile || tile.explored) continue;
        tile.explored = true;
        // meta.hidden tiles (the floor-5 secret hallway/arena) were never
        // counted into dungeon.tilesTotal in the first place — counting
        // them here too would push "Explored" past "Total".
        if (tile.type !== TILE_TYPES.WALL && !tile.meta.hidden) run.tilesExplored += 1;
      }
    }
    this.minimap?.redrawMap();
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
    this.app.saveSystem.save();
  }

  /**
   * Resolves a forward/backward/strafeLeft/strafeRight action to a grid
   * delta relative to the camera's CURRENT directional zone (see
   * DungeonRenderer3D.getFacingZone) — not a separately-tracked facing —
   * so pressing W always moves you forward relative to wherever the
   * free-look camera happens to be pointing right now, mouse-driven
   * turns included, not just explicit left/right-arrow snaps.
   */
  moveRelative(action) {
    const run = this.app.gameState.run;
    if (!run.dungeon) return;
    const facing = this.renderer3d.getFacingZone() ?? run.facing;
    let delta;
    switch (action) {
      case 'forward': delta = FACING_DELTAS[facing]; break;
      case 'backward': { const f = FACING_DELTAS[facing]; delta = { dx: -f.dx, dy: -f.dy }; break; }
      case 'strafeLeft': delta = FACING_DELTAS[rotateFacing(facing, -1)]; break;
      case 'strafeRight': delta = FACING_DELTAS[rotateFacing(facing, 1)]; break;
      default: return;
    }
    run.facing = facing; // keep the save/spawn-seed mirror current at the moment of an actual move
    this.movePlayer(delta.dx, delta.dy);
  }

  movePlayer(dx, dy) {
    const run = this.app.gameState.run;
    const dungeon = run.dungeon;
    if (!dungeon) return;
    const nx = run.playerPosition.x + dx;
    const ny = run.playerPosition.y + dy;
    if (nx < 0 || ny < 0 || nx >= dungeon.width || ny >= dungeon.height) return;
    const tile = this.getTileAt(nx, ny);
    if (!tile || !tile.isWalkable()) return;

    run.playerPosition = { x: nx, y: ny };
    // syncPlayer3D() (below) already recomputes every tile's visibility
    // tier from the new position on every move — no separate reveal call
    // needed; the "explored" flag here is purely the permanent HUD/save/
    // minimap progress marker, unrelated to what's currently visible
    // on-screen in the live 3D view.
    this.syncPlayer3D();
    this.markNearbyExplored(nx, ny);

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
    this.syncPlayer3D(); // re-sync in case a floor transition just reset playerPosition to the new spawn
    this.app.saveSystem.save();
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
   */
  showCardPick() {
    this.resultOpen = true;
    this.pauseMouseLookForEvent();
    const offer = rollCardOffer();
    const modal = document.createElement('div');
    modal.className = 'result-overlay';
    modal.innerHTML = `
      <div class="result-box card-pick-box">
        <h2>${t('explore.choose_card')}</h2>
        <div class="card-pick-grid">
          ${offer.map((card, i) => cardTileHTML(card, i)).join('')}
        </div>
      </div>`;
    this.root.appendChild(modal);
    modal.querySelectorAll('[data-card-index]').forEach((tile) => {
      tile.addEventListener('click', () => {
        const picked = offer[Number(tile.dataset.cardIndex)];
        modal.remove();
        this.resultOpen = false;
        this.restoreMouseLookAfterEvent();
        this.applyCardPick(picked);
      });
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
    if (!app.travelToFloor(targetFloor)) return;
    app.gameState.addLog(t('log.elevator_traveled', { n: run.floor }));
    this.player = app.createPlayer();
    this.syncDungeon3D();
    this.syncPlayer3D();
    this.markNearbyExplored(run.playerPosition.x, run.playerPosition.y);
    this.app.saveSystem.save();
    this.renderHUD();
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
    this.markNearbyExplored(run.playerPosition.x, run.playerPosition.y);
    this.app.saveSystem.save();
    this.renderHUD();
  }

  /**
   * Quick-time event gating locked doors and chests. Dex adds time (not
   * success chance, per user request), and arrow count/rewards both scale
   * with the current floor — see resolveLockedDoor/resolveTreasure.
   */
  startQTE(onResolve, { arrowMultiplier = 1 } = {}) {
    const run = this.app.gameState.run;
    const arrowCount = Math.floor((QTE_BASE_ARROWS + run.floor) * arrowMultiplier);
    const directions = Array.from({ length: arrowCount }, () => pickRandom(QTE_DIRECTIONS));
    const dex = this.player.getStat('dex');
    const timeLimit = QTE_BASE_SECONDS + Math.floor(dex / QTE_DEX_SECONDS_INTERVAL) * QTE_DEX_SECONDS_PER_INTERVAL + this.getPassiveSum('qteBonusSeconds');

    this.resultOpen = true;
    this.pauseMouseLookForEvent();
    const modal = document.createElement('div');
    modal.className = 'qte-overlay';
    modal.innerHTML = `
      <div class="qte-box">
        <div class="qte-strip">
          ${directions.map((d) => `<div class="qte-key" data-dir="${d}">${arrowIconSVG(d)}</div>`).join('')}
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

    this.qte = { directions, index: 0, timeLimit, remaining: timeLimit, modal, keyElements, onResolve };
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

  advanceQTE() {
    const keyEl = this.qte.keyElements[this.qte.index];
    keyEl?.classList.add('correct');
    setTimeout(() => keyEl?.remove(), 120);
    this.qte.index += 1;
    if (this.qte.index >= this.qte.directions.length) {
      this.finishQTE(true);
    }
  }

  updateQTETimerUI() {
    if (!this.qte) return;
    const fill = this.qte.modal.querySelector('.qte-timer-fill');
    if (fill) fill.style.width = `${Math.max(0, (this.qte.remaining / this.qte.timeLimit) * 100)}%`;
  }

  finishQTE(success) {
    const { onResolve, modal } = this.qte;
    modal.remove();
    this.qte = null;
    this.resultOpen = false;
    onResolve(success);
  }

  /** Base reward multiplier: initial (floor-independent) amounts are quartered, then grown back +15%/floor *compounding*, plus any equipped reward-boost passive (e.g. Thief's Greed) — rounded up. */
  getRewardMultiplier(run) {
    return REWARD_INITIAL_SCALE * (1 + REWARD_FLOOR_BONUS_PER_FLOOR) ** run.floor * (1 + this.getPassiveSum('rewardBonusPercent') / 100);
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
      this.showResult(t('explore.locked_room_opened'), [t('explore.reward_gold', { n: amount })]);
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
      this.showResult(t('explore.chest_opened'), [t('explore.reward_material', { n: amount, material: materialName })]);
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

      this.showResult(t('explore.temporal_chest_opened'), [
        t('explore.reward_gold', { n: goldAmount }),
        t('explore.reward_material', { n: materialAmount, material: materialName }),
      ]);
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

  /** Full explored-so-far map, opened by clicking the corner minimap. Blocks movement like every other modal here. */
  openMinimapExpanded() {
    this.resultOpen = true;
    this.pauseMouseLookForEvent();
    const modal = document.createElement('div');
    modal.className = 'result-overlay';
    modal.innerHTML = `
      <div class="result-box minimap-expanded-box">
        <h2>${t('explore.minimap_title')}</h2>
        <div class="minimap-scroll"><canvas class="minimap-expanded-canvas"></canvas></div>
        <button class="result-close">${t('explore.close')}</button>
      </div>`;
    this.root.appendChild(modal);
    this.minimap.drawExpanded(modal.querySelector('.minimap-expanded-canvas'));
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
    const currentTile = this.getTileAt(run.playerPosition.x, run.playerPosition.y);
    const canDescend = currentTile?.type === TILE_TYPES.STAIRS && run.enemiesRemaining === 0;

    this.els.hud.innerHTML = `
      <span>${t('explore.floor', { n: run.floor })}</span>
      <span>${t('explore.explored', { explored: run.tilesExplored, total: dungeon?.tilesTotal ?? 0 })}</span>
      <span>${t('explore.enemies_remaining', { n: run.enemiesRemaining })}</span>
      <span class="events-indicator" data-events>${t('explore.events_remaining', { n: counts.total })}</span>
      <span>${t('explore.hp', { current: this.player.currentHealth, max: this.player.getMaxHealth() })}</span>`;
    this.els.msg.textContent = run.floorMessage?.text ?? '';
    this.tooltip.bind(this.els.hud.querySelector('[data-events]'), () => eventsBreakdownHTML(counts));

    this.els.descend.innerHTML = canDescend ? `<button data-descend>${t('explore.descend')}</button>` : '';
    this.els.descend.querySelector('[data-descend]')?.addEventListener('click', () => this.showCardPick());
  }
}
