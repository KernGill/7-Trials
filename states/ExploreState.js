import { TILE_TYPES } from '../exploration/Tile.js';
import { PauseOverlay } from './PauseOverlay.js';
import { getConsumableConfig } from '../data/consumables.js';
import { getMaterialConfig } from '../data/items.js';
import { getArcForFloor } from '../data/arcs.js';
import { t, tData } from '../ui/i18n.js';
import { DungeonRenderer3D } from '../exploration/DungeonRenderer3D.js';

const DIR_FROM_DELTA = { '0,-1': 'north', '0,1': 'south', '-1,0': 'west', '1,0': 'east' };

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
      this.app.gameState.run.explorationBuffs.push(effect.buff);
      this.app.gameState.addLog(t('log.used_consumable_buff', { name }));
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
  }

  handleKeydown(e) {
    if (this.app.gameState.paused || this.resultOpen) return;
    const key = e.key;
    const moves = {
      arrowup: [0, -1], w: [0, -1],
      arrowdown: [0, 1], s: [0, 1],
      arrowleft: [-1, 0], a: [-1, 0],
      arrowright: [1, 0], d: [1, 0],
    };
    if (moves[key]) {
      e.originalEvent?.preventDefault?.();
      this.movePlayer(...moves[key]);
    }
  }

  getTileAt(x, y) {
    return this.app.gameState.run.dungeon?.tiles.find((t) => t.x === x && t.y === y) ?? null;
  }

  movePlayer(dx, dy) {
    const run = this.app.gameState.run;
    const dungeon = run.dungeon;
    if (!dungeon) return;
    const dir = DIR_FROM_DELTA[`${dx},${dy}`];
    if (dir) run.facing = dir;
    // Push the turn to the 3D camera immediately, even if the move below
    // ends up blocked — bumping a wall still turns the character to face
    // it, per the early-return checks that follow.
    this.syncPlayer3D();
    const nx = run.playerPosition.x + dx;
    const ny = run.playerPosition.y + dy;
    if (nx < 0 || ny < 0 || nx >= dungeon.width || ny >= dungeon.height) return;
    const tile = this.getTileAt(nx, ny);
    if (!tile || !tile.isWalkable()) return;

    run.playerPosition = { x: nx, y: ny };
    this.syncPlayer3D();
    if (!tile.explored) {
      tile.explored = true;
      run.tilesExplored += 1;
      this.renderer3d?.revealTile(tile);
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
        run.floor += 1;
        run.savedHealth = this.player.currentHealth;
        app.generateFloor();
        app.gameState.addLog(t('log.descended', { n: run.floor }));
        this.player = app.createPlayer();
        break;
      }
      case TILE_TYPES.LOCKED_DOOR: {
        if (tile.meta.resolved) break;
        const result = app.trapSystem.attemptLockedRoom(this.player.getStat('dex'));
        tile.meta.resolved = true;
        if (result.success) {
          app.gameState.player.gold += result.reward.amount;
          this.showResult(t('explore.locked_room_opened'), [
            t('explore.success_chance', { n: Math.round(result.chance) }),
            t('explore.reward_gold', { n: result.reward.amount }),
          ]);
        } else {
          this.showResult(t('explore.locked_room_failed'), [
            t('explore.success_chance', { n: Math.round(result.chance) }),
            t('explore.lock_held'),
          ]);
        }
        break;
      }
      case TILE_TYPES.TREASURE: {
        if (tile.meta.resolved) break;
        const materialPool = getArcForFloor(run.floor).materials ?? ['bones', 'flesh', 'mana_stone'];
        const result = app.trapSystem.attemptChest(this.player.getStat('dex'), materialPool);
        tile.meta.resolved = true;
        if (result.success) {
          app.inventory.addMaterial(result.reward.id, result.reward.amount, true);
          const materialName = tData('material', result.reward.id, getMaterialConfig(result.reward.id)?.name ?? result.reward.id);
          this.showResult(t('explore.chest_opened'), [
            t('explore.success_chance', { n: Math.round(result.chance) }),
            t('explore.reward_material', { n: result.reward.amount, material: materialName }),
          ]);
        } else {
          const before = this.player.currentHealth;
          this.player.currentHealth = Math.max(1, this.player.currentHealth - result.damage);
          const dealt = before - this.player.currentHealth;
          run.savedHealth = this.player.currentHealth;
          this.showResult(t('explore.chest_trapped_title'), [
            t('explore.success_chance', { n: Math.round(result.chance) }),
            t('explore.chest_trapped_line', { n: dealt }),
          ]);
        }
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
