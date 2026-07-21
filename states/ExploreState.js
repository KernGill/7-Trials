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
import { CHEST_TRAP_DAMAGE, LOCKED_ROOM_GOLD_REWARD } from '../utils/Constants.js';
import { randomInt } from '../utils/MathUtils.js';
import { pickRandom } from '../utils/RandomUtils.js';

const FACING_ORDER = ['north', 'east', 'south', 'west']; // clockwise
const FACING_DELTAS = {
  north: { dx: 0, dy: -1 },
  east: { dx: 1, dy: 0 },
  south: { dx: 0, dy: 1 },
  west: { dx: -1, dy: 0 },
};

const QTE_DIRECTIONS = ['up', 'down', 'left', 'right'];
const QTE_DIRECTION_KEYS = {
  w: 'up', arrowup: 'up',
  s: 'down', arrowdown: 'down',
  a: 'left', arrowleft: 'left',
  d: 'right', arrowright: 'right',
};
const QTE_BASE_SECONDS = 5;
const QTE_DEX_SECONDS_INTERVAL = 50;
const QTE_BASE_ARROWS = 7; // + 1 per floor (floor 1 = 8, floor 10 = 17)
const REWARD_FLOOR_BONUS_PER_FLOOR = 0.10;

/** Rotates a facing direction by `steps` 90-degree turns (+1 clockwise, -1 counterclockwise). */
function rotateFacing(facing, steps) {
  const idx = FACING_ORDER.indexOf(facing);
  return FACING_ORDER[(idx + steps + FACING_ORDER.length) % FACING_ORDER.length];
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
      </div>`;
    this.els = {
      hud: root.querySelector('.explore-hud'),
      grid: root.querySelector('.dungeon-grid'),
      msg: root.querySelector('.floor-message'),
    };
    this.renderer3d = new DungeonRenderer3D();
    // This ExploreState instance is a long-lived singleton (StateManager
    // creates it once), but a fresh DungeonRenderer3D is created on every
    // enter() — reset the sync guard so syncDungeon3D() below doesn't
    // wrongly no-op just because `run.dungeon` didn't change (e.g.
    // returning from combat on the same floor), leaving the new renderer's
    // geometry never built.
    this._synced3DDungeon = null;
    this.renderer3d.mount(this.els.grid);
    this.syncDungeon3D();
    this.syncPlayer3D();
    this.app.input.on('keydown', this._onKeydown);
    this.renderHUD();
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
    this.renderer3d?.unmount();
    this.pause.unmount();
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

  /** Turns facing by ±1 quarter-turn in place — no movement, no tile effects. */
  turnPlayer(steps) {
    const run = this.app.gameState.run;
    if (!run.dungeon) return;
    run.facing = rotateFacing(run.facing, steps);
    this.syncPlayer3D();
    this.app.saveSystem.save();
  }

  /** Resolves a forward/backward/strafeLeft/strafeRight action to a grid delta relative to the current facing. */
  moveRelative(action) {
    const run = this.app.gameState.run;
    if (!run.dungeon) return;
    const facing = run.facing;
    let delta;
    switch (action) {
      case 'forward': delta = FACING_DELTAS[facing]; break;
      case 'backward': { const f = FACING_DELTAS[facing]; delta = { dx: -f.dx, dy: -f.dy }; break; }
      case 'strafeLeft': delta = FACING_DELTAS[rotateFacing(facing, -1)]; break;
      case 'strafeRight': delta = FACING_DELTAS[rotateFacing(facing, 1)]; break;
      default: return;
    }
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
    // needed; the "explored" flag here is purely the permanent HUD/save
    // progress counter, unrelated to what's currently visible on screen.
    this.syncPlayer3D();
    if (!tile.explored) {
      tile.explored = true;
      run.tilesExplored += 1;
    }

    // Enemy tiles hand off to FightState immediately — nothing left on
    // this screen to render or save. Autosaving here would also let a
    // refresh-mid-fight consume the enemy tile for free (it's already
    // flipped to FLOOR by handleTileEffect before combat even starts),
    // so a fight in progress is deliberately the one checkpoint we skip.
    if (tile.type === TILE_TYPES.ENEMY) {
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
        const enemyId = tile.meta.isBoss ? app.progression.getBossId(run.floor) : app.progression.getRandomEnemyId(run.floor);
        run.savedHealth = this.player.currentHealth;
        tile.type = TILE_TYPES.FLOOR;
        app.startCombat(enemyId); // immediate setState(FIGHT)
        break;
      }
      case TILE_TYPES.STAIRS: {
        if (run.enemiesRemaining > 0) {
          run.floorMessage = { text: t('explore.enemies_wander'), timer: 2 };
          break;
        }
        this.showCardPick();
        break;
      }
      case TILE_TYPES.LOCKED_DOOR: {
        if (tile.meta.resolved) break;
        tile.meta.resolved = true;
        this.startQTE((success) => this.resolveLockedDoor(success));
        break;
      }
      case TILE_TYPES.TREASURE: {
        if (tile.meta.resolved) break;
        tile.meta.resolved = true;
        this.startQTE((success) => this.resolveTreasure(success));
        break;
      }
      default:
        break;
    }
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
        this.applyCardPick(picked);
      });
    });
  }

  applyCardPick(picked) {
    const { app } = this;
    const run = app.gameState.run;
    run.cards.push(picked);
    run.floor += 1;
    run.savedHealth = this.player.currentHealth;
    app.generateFloor();
    app.gameState.addLog(t('log.descended', { n: run.floor }));
    this.player = app.createPlayer();
    this.syncDungeon3D();
    this.syncPlayer3D();
    this.app.saveSystem.save();
    this.renderHUD();
  }

  /**
   * Quick-time event gating locked doors and chests. Dex adds time (not
   * success chance, per user request), and arrow count/rewards both scale
   * with the current floor — see resolveLockedDoor/resolveTreasure.
   */
  startQTE(onResolve) {
    const run = this.app.gameState.run;
    const arrowCount = QTE_BASE_ARROWS + run.floor;
    const directions = Array.from({ length: arrowCount }, () => pickRandom(QTE_DIRECTIONS));
    const dex = this.player.getStat('dex');
    const timeLimit = QTE_BASE_SECONDS + Math.floor(dex / QTE_DEX_SECONDS_INTERVAL) + this.getPassiveSum('qteBonusSeconds');

    this.resultOpen = true;
    const modal = document.createElement('div');
    modal.className = 'qte-overlay';
    modal.innerHTML = `
      <div class="qte-box">
        <div class="qte-strip">
          ${directions.map((d) => `<div class="qte-key" data-dir="${d}">${arrowIconSVG(d)}</div>`).join('')}
        </div>
        <div class="qte-timer-track"><div class="qte-timer-fill"></div></div>
      </div>`;
    this.root.appendChild(modal);
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

  /** Base reward multiplier: +10%/floor, plus any equipped reward-boost passive (e.g. Thief's Greed) — rounded up. */
  getRewardMultiplier(run) {
    return (1 + REWARD_FLOOR_BONUS_PER_FLOOR * run.floor) * (1 + this.getPassiveSum('rewardBonusPercent') / 100);
  }

  resolveLockedDoor(success) {
    const { app } = this;
    const run = app.gameState.run;
    if (success) {
      const amount = Math.ceil(LOCKED_ROOM_GOLD_REWARD * this.getRewardMultiplier(run));
      app.gameState.player.gold += amount;
      run.achievementProgress = run.achievementProgress ?? {};
      run.achievementProgress.doorOpenedFloor = run.floor;
      this.showResult(t('explore.locked_room_opened'), [t('explore.reward_gold', { n: amount })]);
    } else {
      this.showResult(t('explore.locked_room_failed'), [t('explore.lock_held')]);
    }
    this.app.saveSystem.save();
  }

  resolveTreasure(success) {
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
    this.app.saveSystem.save();
    this.renderHUD();
  }

  renderHUD() {
    const run = this.app.gameState.run;
    const dungeon = run.dungeon;

    this.els.hud.innerHTML = `
      <span>${t('explore.floor', { n: run.floor })}</span>
      <span>${t('explore.explored', { explored: run.tilesExplored, total: dungeon?.tilesTotal ?? 0 })}</span>
      <span>${t('explore.enemies_remaining', { n: run.enemiesRemaining })}</span>
      <span>${t('explore.hp', { current: this.player.currentHealth, max: this.player.getMaxHealth() })}</span>`;
    this.els.msg.textContent = run.floorMessage?.text ?? '';
  }
}
