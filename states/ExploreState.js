import { TILE_TYPES } from '../exploration/Tile.js';
import { PauseOverlay } from './PauseOverlay.js';
import { clamp } from '../utils/MathUtils.js';

const VIEW_W = 9;
const VIEW_H = 7;

/**
 * ExploreState — dungeon crawling. Top-level peer of FightState. Only
 * a VIEW_W x VIEW_H window around the player renders at once (the
 * floor is bigger than the screen, per design doc). Walking onto an
 * enemy tile calls app.startCombat(), which immediately transitions
 * to FIGHT — no intermediate flag.
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
    this.app.input.on('keydown', this._onKeydown);
    this.renderAll();
  }

  exit() {
    this.app.input.off('keydown', this._onKeydown);
    this.pause.unmount();
  }

  onPauseToggled() {
    if (this.app.gameState.paused) this.pause.mount(this.root, { canAbandon: true });
    else this.pause.unmount();
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
    if (this.app.gameState.paused) return;
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
    const nx = run.playerPosition.x + dx;
    const ny = run.playerPosition.y + dy;
    if (nx < 0 || ny < 0 || nx >= dungeon.width || ny >= dungeon.height) return;
    const tile = this.getTileAt(nx, ny);
    if (!tile || !tile.isWalkable()) return;

    run.playerPosition = { x: nx, y: ny };
    if (!tile.explored) { tile.explored = true; run.tilesExplored += 1; }
    this.handleTileEffect(tile);
    this.renderAll();
  }

  handleTileEffect(tile) {
    const { app } = this;
    const run = app.gameState.run;
    switch (tile.type) {
      case TILE_TYPES.ENEMY: {
        const enemyId = app.progression.getEnemyForFloor(run.floor);
        run.savedHealth = this.player.currentHealth;
        tile.type = TILE_TYPES.FLOOR;
        app.startCombat(enemyId); // immediate setState(FIGHT)
        break;
      }
      case TILE_TYPES.STAIRS: {
        if (run.enemiesRemaining > 0) {
          run.floorMessage = { text: 'Enemies still wander about', timer: 2 };
          break;
        }
        run.floor += 1;
        run.savedHealth = this.player.currentHealth;
        app.generateFloor();
        app.gameState.addLog(`Descended to floor ${run.floor}.`);
        this.player = app.createPlayer();
        break;
      }
      case TILE_TYPES.LOCKED_DOOR: {
        if (tile.meta.resolved) break;
        const result = app.trapSystem.attemptLockedRoom(this.player.getStat('dex'));
        tile.meta.resolved = true;
        if (result.success) {
          app.gameState.player.gold += result.reward.amount;
          app.gameState.addLog(`Locked room opened! +${result.reward.amount} gold.`);
        } else {
          app.gameState.addLog('Failed to open the locked room.');
        }
        break;
      }
      default:
        break;
    }
  }

  renderAll() {
    const { app } = this;
    const run = app.gameState.run;
    const dungeon = run.dungeon;

    this.els.hud.innerHTML = `
      <span>Floor ${run.floor}</span>
      <span>Explored: ${run.tilesExplored}/${dungeon?.tilesTotal ?? 0}</span>
      <span>Enemies remaining: ${run.enemiesRemaining}</span>
      <span>HP: ${this.player.currentHealth}/${this.player.getMaxHealth()}</span>`;
    this.els.msg.textContent = run.floorMessage?.text ?? '';

    if (!dungeon) return;
    const px = run.playerPosition.x;
    const py = run.playerPosition.y;
    const startX = clamp(px - Math.floor(VIEW_W / 2), 0, Math.max(0, dungeon.width - VIEW_W));
    const startY = clamp(py - Math.floor(VIEW_H / 2), 0, Math.max(0, dungeon.height - VIEW_H));

    let html = '';
    for (let y = startY; y < startY + VIEW_H; y += 1) {
      for (let x = startX; x < startX + VIEW_W; x += 1) {
        const tile = this.getTileAt(x, y);
        html += this.tileHTML(tile, x === px && y === py);
      }
    }
    this.els.grid.style.gridTemplateColumns = `repeat(${VIEW_W}, 1fr)`;
    this.els.grid.innerHTML = html;
  }

  tileHTML(tile, isPlayer) {
    if (!tile || tile.type === TILE_TYPES.WALL) return '<div class="dtile blank"></div>';
    let label = '';
    let cls = 'dtile';
    if (tile.explored) {
      if (tile.type === TILE_TYPES.ENEMY) { cls += ' t-enemy'; label = 'ENEMY'; }
      else if (tile.type === TILE_TYPES.STAIRS) { cls += ' t-stairs'; label = 'STAIRS'; }
      else if (tile.type === TILE_TYPES.LOCKED_DOOR) { cls += ' t-locked'; label = 'LOCKED ROOM'; }
      else cls += ' t-floor';
    } else {
      cls += ' t-unseen';
    }
    if (isPlayer) { cls += ' t-player'; label = 'PLAYER'; }
    return `<div class="${cls}">${label}</div>`;
  }
}
