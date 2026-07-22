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

/** A resolved chest/door (already opened — see ExploreState.handleTileEffect's meta.resolved gate) reads as plain floor, since it no longer does anything when walked onto. */
function tileColor(tile) {
  if (tile.meta?.resolved) return TILE_COLORS[TILE_TYPES.FLOOR];
  return TILE_COLORS[tile.type] ?? '#222222';
}

// Rotation (radians) applied to the corner minimap so the given facing
// direction always renders at the top — north needs none since world-north
// (dy=-1) already draws at the top by default; the rest follow from there.
const FACING_ANGLES = {
  north: 0,
  east: -Math.PI / 2,
  south: Math.PI,
  west: Math.PI / 2,
};

// Same exponential-decay tween speed the 3D renderer uses for its camera
// turn, so the two rotations feel like the same animation.
const TWEEN_SPEED = 10;

/** Shortest signed angular delta from `from` to `to`, in (-PI, PI]. */
function shortestAngleDelta(from, to) {
  let delta = (to - from) % (Math.PI * 2);
  if (delta > Math.PI) delta -= Math.PI * 2;
  if (delta < -Math.PI) delta += Math.PI * 2;
  return delta;
}

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
    this._currentAngle = 0;
    this._targetAngle = 0;
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
    // Snap instantly to the current facing/fixed-setting rotation instead of
    // animating in from north-up every time a new floor mounts a fresh Minimap.
    const run = this.app.gameState.run;
    const fixed = this.app.gameState.settings.fixedMinimap ?? true;
    this._currentAngle = fixed ? 0 : (FACING_ANGLES[run?.facing] ?? 0);
    this._targetAngle = this._currentAngle;
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
   * Advances the corner minimap's rotation tween toward the current
   * facing/fixed-setting target (same exponential-decay speed the 3D
   * camera uses, so the two turning animations feel identical), then
   * redraws. Call every frame (e.g. from ExploreState.tick) so turning
   * with "Fixed Minimap" off animates smoothly instead of snapping.
   */
  update(dt) {
    if (!this.canvas) return;
    const run = this.app.gameState.run;
    const fixed = this.app.gameState.settings.fixedMinimap ?? true;
    const rawAngle = fixed ? 0 : (FACING_ANGLES[run?.facing] ?? 0);
    this._targetAngle = this._currentAngle + shortestAngleDelta(this._currentAngle, rawAngle);
    const t = 1 - Math.exp(-TWEEN_SPEED * dt);
    this._currentAngle += (this._targetAngle - this._currentAngle) * t;
    this.render();
  }

  /**
   * Redraws the small corner minimap centered on the player's current
   * position, at the current (possibly mid-tween) rotation angle. North-up
   * when the "Fixed Minimap" setting is on (the default); otherwise
   * rotated so the direction the player is facing eases toward the top —
   * the expanded full-map view (drawExpanded) is never rotated, only this
   * corner view.
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
    const angle = this._currentAngle;

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
        ctx.fillStyle = tileColor(tile);
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
      ctx.fillStyle = tileColor(tile);
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
