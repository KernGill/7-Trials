import { TILE_TYPES } from './Tile.js';

const RADIUS = 4; // 9x9 window, per user request ("4 block radius")
const CLOSE_RADIUS = 1; // always-visible "sense" ring (the 9 tiles right around the player), regardless of explored state
const CELL_SIZE = 16;
const EXPANDED_MAX_CELL_SIZE = 14;

const TILE_COLORS = {
  [TILE_TYPES.WALL]: '#3a3a3a',
  [TILE_TYPES.FLOOR]: '#5a5a5a',
  [TILE_TYPES.STAIRS]: '#c9a227',
  [TILE_TYPES.ENEMY]: '#c0392b',
  [TILE_TYPES.LOCKED_DOOR]: '#7c4fd1',
  [TILE_TYPES.TREASURE]: '#c9962a',
  [TILE_TYPES.TEMPORAL_CHEST]: '#1f5fd9',
};
const UNKNOWN_COLOR = '#000000';
const PLAYER_COLOR = '#ffffff';

// Rotation (radians) applied to the corner minimap so the given facing
// direction always renders at the top — north needs none since world-north
// (dy=-1) already draws at the top by default; the rest follow from there.
const FACING_ANGLES = {
  north: 0,
  east: -Math.PI / 2,
  south: Math.PI,
  west: Math.PI / 2,
};

/**
 * Top-down minimap — a small always-on corner view (9x9 tiles, player
 * centered) plus a click-to-open expanded view of everything explored so
 * far. Pure canvas rendering (cheap to fully redraw on every move, unlike
 * rebuilding DOM nodes each time) — kept entirely separate from the 3D
 * scene DungeonRenderer3D owns.
 */
export class Minimap {
  constructor(app) {
    this.app = app;
    this._tileMapDungeon = null;
    this._tileMap = null;
  }

  mount(container, { onClick } = {}) {
    this.wrapper = document.createElement('div');
    this.wrapper.className = 'minimap';
    this.canvas = document.createElement('canvas');
    const size = (RADIUS * 2 + 1) * CELL_SIZE;
    this.canvas.width = size;
    this.canvas.height = size;
    this.wrapper.appendChild(this.canvas);
    container.appendChild(this.wrapper);
    this._onClick = () => onClick?.();
    this.wrapper.addEventListener('click', this._onClick);
  }

  unmount() {
    this.wrapper?.removeEventListener('click', this._onClick);
    this.wrapper?.remove();
    this.wrapper = null;
    this.canvas = null;
  }

  /** Rebuilds the "x,y" -> tile lookup only when the dungeon reference actually changes (new floor). */
  _ensureTileMap(dungeon) {
    if (this._tileMapDungeon === dungeon) return this._tileMap;
    this._tileMap = new Map(dungeon.tiles.map((t) => [`${t.x},${t.y}`, t]));
    this._tileMapDungeon = dungeon;
    return this._tileMap;
  }

  /**
   * Redraws the small corner minimap centered on the player's current
   * position. North-up (no rotation) when the "Fixed Minimap" setting is
   * on (the default); otherwise rotated so the direction the player is
   * currently facing renders at the top — the expanded full-map view
   * (drawExpanded) is never rotated, only this corner view.
   */
  render() {
    if (!this.canvas) return;
    const run = this.app.gameState.run;
    const dungeon = run?.dungeon;
    const ctx = this.canvas.getContext('2d');
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = UNKNOWN_COLOR;
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    if (!dungeon) return;

    const tileMap = this._ensureTileMap(dungeon);
    const { x: px, y: py } = run.playerPosition;
    const center = RADIUS * CELL_SIZE + CELL_SIZE / 2;
    const fixed = this.app.gameState.settings.fixedMinimap ?? true;
    const angle = fixed ? 0 : (FACING_ANGLES[run.facing] ?? 0);

    ctx.save();
    ctx.translate(center, center);
    ctx.rotate(angle);
    ctx.translate(-center, -center);
    for (let dy = -RADIUS; dy <= RADIUS; dy += 1) {
      for (let dx = -RADIUS; dx <= RADIUS; dx += 1) {
        const tile = tileMap.get(`${px + dx},${py + dy}`);
        if (!tile) continue;
        const close = Math.max(Math.abs(dx), Math.abs(dy)) <= CLOSE_RADIUS;
        if (!tile.explored && !close) continue;
        ctx.fillStyle = TILE_COLORS[tile.type] ?? '#222222';
        ctx.fillRect((dx + RADIUS) * CELL_SIZE, (dy + RADIUS) * CELL_SIZE, CELL_SIZE, CELL_SIZE);
      }
    }
    ctx.restore();

    this._drawPlayerMarker(ctx, center, center, CELL_SIZE);
  }

  /** Draws every explored tile of the current floor onto a caller-provided canvas (the expanded modal view). No "close" bonus — memory only. */
  drawExpanded(canvas) {
    const run = this.app.gameState.run;
    const dungeon = run?.dungeon;
    if (!dungeon) return;
    const cellSize = Math.min(EXPANDED_MAX_CELL_SIZE, Math.max(4, Math.floor(600 / Math.max(dungeon.width, dungeon.height))));
    canvas.width = dungeon.width * cellSize;
    canvas.height = dungeon.height * cellSize;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = UNKNOWN_COLOR;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    dungeon.tiles.forEach((tile) => {
      if (!tile.explored) return;
      ctx.fillStyle = TILE_COLORS[tile.type] ?? '#222222';
      ctx.fillRect(tile.x * cellSize, tile.y * cellSize, cellSize, cellSize);
    });

    const { x: px, y: py } = run.playerPosition;
    this._drawPlayerMarker(ctx, px * cellSize + cellSize / 2, py * cellSize + cellSize / 2, cellSize);
  }

  _drawPlayerMarker(ctx, x, y, cellSize) {
    ctx.fillStyle = PLAYER_COLOR;
    ctx.beginPath();
    ctx.arc(x, y, Math.max(2, cellSize * 0.3), 0, Math.PI * 2);
    ctx.fill();
  }
}
