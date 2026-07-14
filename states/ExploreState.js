import { TILE_TYPES } from '../exploration/Tile.js';
import { PauseOverlay } from './PauseOverlay.js';
import { clamp } from '../utils/MathUtils.js';
import { getConsumableConfig } from '../data/consumables.js';
import { getMaterialConfig } from '../data/items.js';
import { getArcForFloor } from '../data/arcs.js';

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

    if (effect.healMaxPercent) {
      const healed = this.player.heal(Math.ceil(this.player.getMaxHealth() * (effect.healMaxPercent / 100)));
      this.app.gameState.addLog(`Used ${cfg.name}, healed ${healed} HP.`);
    }
    if (effect.buff) {
      this.app.gameState.run.explorationBuffs = this.app.gameState.run.explorationBuffs ?? [];
      this.app.gameState.run.explorationBuffs.push(effect.buff);
      this.app.gameState.addLog(`Used ${cfg.name}. Its effect will apply at the start of your next fight.`);
    }

    this.app.inventory.useConsumable(id, 1);
    this.app.trackConsumableUsed(id);
    this.app.gameState.run.savedHealth = this.player.currentHealth;
    this.app.saveSystem.save();
    this.renderAll();
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
    const nx = run.playerPosition.x + dx;
    const ny = run.playerPosition.y + dy;
    if (nx < 0 || ny < 0 || nx >= dungeon.width || ny >= dungeon.height) return;
    const tile = this.getTileAt(nx, ny);
    if (!tile || !tile.isWalkable()) return;

    run.playerPosition = { x: nx, y: ny };
    if (!tile.explored) { tile.explored = true; run.tilesExplored += 1; }

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
    this.app.saveSystem.save();
    this.renderAll();
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
          this.showResult('LOCKED ROOM — OPENED', [
            `Success chance was ${Math.round(result.chance)}%.`,
            `Reward: +${result.reward.amount} gold.`,
          ]);
        } else {
          this.showResult('LOCKED ROOM — FAILED', [
            `Success chance was ${Math.round(result.chance)}%.`,
            'The lock held. No harm done.',
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
          this.showResult('CHEST — OPENED', [
            `Success chance was ${Math.round(result.chance)}%.`,
            `Reward: ${result.reward.amount}x ${getMaterialConfig(result.reward.id)?.name ?? result.reward.id}.`,
          ]);
        } else {
          const before = this.player.currentHealth;
          this.player.currentHealth = Math.max(1, this.player.currentHealth - result.damage);
          const dealt = before - this.player.currentHealth;
          run.savedHealth = this.player.currentHealth;
          this.showResult('CHEST — TRAPPED', [
            `Success chance was ${Math.round(result.chance)}%.`,
            `The chest was trapped! Took ${dealt} damage.`,
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
        <button class="result-close">CLOSE</button>
      </div>`;
    this.root.appendChild(modal);
    modal.querySelector('.result-close').addEventListener('click', () => {
      modal.remove();
      this.resultOpen = false;
    });
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
      else if (tile.type === TILE_TYPES.TREASURE) { cls += ' t-treasure'; label = 'CHEST'; }
      else cls += ' t-floor';
    } else {
      cls += ' t-unseen';
    }
    if (isPlayer) { cls += ' t-player'; label = 'PLAYER'; }
    return `<div class="${cls}">${label}</div>`;
  }
}
