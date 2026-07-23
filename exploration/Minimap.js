import { TILE_TYPES } from './Tile.js';

const RADIUS = 4; // 9x9 visible window, per user request ("4 block radius")
const CELL_SIZE = 16;
const EXPANDED_MAX_CELL_SIZE = 14;
const VIEWPORT_SIZE = (RADIUS * 2 + 1) * CELL_SIZE;

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

/**
 * Top-down minimap — a small always-on corner view (9x9 tiles, player
 * centered) plus a click-to-open expanded view of everything explored so
 * far.
 *
 * The corner view draws the WHOLE explored dungeon onto one canvas sized
 * to the full map (same "explored tiles only" rule drawExpanded already
 * uses — ExploreState.markNearbyExplored marks the immediate area around
 * every tile the player has stood next to as explored, so there's no
 * "close but not yet explored" gap this loses), then leaves ROTATION
 * entirely to CSS: transform-origin is pinned to the player's exact
 * pixel, and left/top position that same pixel at the viewport's center,
 * so rotating the whole canvas around it keeps the player perfectly
 * still on-screen at any angle. That's the "easy way to rotate it" — a
 * cheap CSS property update every frame, not a per-frame canvas redraw —
 * and it's what lets the corner view track the free-look camera's
 * continuous yaw smoothly for free. The canvas's actual PIXELS only get
 * repainted when the dungeon or explored-tile state changes
 * (redrawMap()), never on a per-frame basis.
 */
export class Minimap {
  constructor(app) {
    this.app = app;
    this._dungeon = null;
  }

  mount(container, { onClick } = {}) {
    this.wrapper = document.createElement('div');
    this.wrapper.className = 'minimap';
    this.wrapper.style.width = `${VIEWPORT_SIZE}px`;
    this.wrapper.style.height = `${VIEWPORT_SIZE}px`;
    this.canvas = document.createElement('canvas');
    this.canvas.style.position = 'absolute';
    this.wrapper.appendChild(this.canvas);
    container.appendChild(this.wrapper);
    this._onClick = () => onClick?.();
    this.wrapper.addEventListener('click', this._onClick);
    this._dungeon = null; // force a fresh full-size redraw on the next redrawMap()
    this.redrawMap();
    this.applyRotationDeg(0);
  }

  unmount() {
    this.wrapper?.removeEventListener('click', this._onClick);
    this.wrapper?.remove();
    this.wrapper = null;
    this.canvas = null;
    this._dungeon = null;
  }

  /**
   * Repaints the full-map canvas's pixel content (every explored tile
   * plus the player marker) and repositions it so the player's exact
   * pixel sits at the viewport's center with rotation pivoting around
   * that same point. Call whenever the dungeon reference changes, the
   * player moves, or a tile's explored state changes — never per-frame
   * (see update()/applyRotationDeg() for the cheap per-frame part).
   */
  redrawMap() {
    if (!this.canvas) return;
    const run = this.app.gameState.run;
    const dungeon = run?.dungeon;
    if (!dungeon) return;

    if (dungeon !== this._dungeon) {
      this._dungeon = dungeon;
      this.canvas.width = dungeon.width * CELL_SIZE;
      this.canvas.height = dungeon.height * CELL_SIZE;
    }

    const ctx = this.canvas.getContext('2d');
    ctx.fillStyle = UNKNOWN_COLOR;
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    dungeon.tiles.forEach((tile) => {
      if (!tile.explored) return;
      ctx.fillStyle = tileColor(tile);
      ctx.fillRect(tile.x * CELL_SIZE, tile.y * CELL_SIZE, CELL_SIZE, CELL_SIZE);
    });

    const { x: px, y: py } = run.playerPosition;
    const pixelX = px * CELL_SIZE + CELL_SIZE / 2;
    const pixelY = py * CELL_SIZE + CELL_SIZE / 2;
    this._drawPlayerMarker(ctx, pixelX, pixelY, CELL_SIZE);

    this.canvas.style.left = `${VIEWPORT_SIZE / 2 - pixelX}px`;
    this.canvas.style.top = `${VIEWPORT_SIZE / 2 - pixelY}px`;
    this.canvas.style.transformOrigin = `${pixelX}px ${pixelY}px`;
  }

  /**
   * Cheap per-frame step — only ever touches the CSS rotation, never
   * repaints pixels. North-up (0deg) when "Fixed Minimap" is on;
   * otherwise mirrors the live free-look camera yaw. Negated: the
   * minimap's on-screen-clockwise CSS rotation is the mirror image of
   * the 3D camera's world-yaw convention at every cardinal angle (e.g.
   * facing/looking east puts east at the top via a COUNTERclockwise
   * quarter turn, i.e. a negative angle) — same relationship the old
   * per-facing FACING_ANGLES table encoded, generalized to a continuous
   * angle instead of 4 discrete ones.
   */
  update(dt, cameraYaw) {
    if (!this.canvas) return;
    const fixed = this.app.gameState.settings.fixedMinimap ?? true;
    const angleDeg = (fixed || cameraYaw === undefined) ? 0 : -(cameraYaw * 180) / Math.PI;
    this.applyRotationDeg(angleDeg);
  }

  applyRotationDeg(angleDeg) {
    if (!this.canvas) return;
    this.canvas.style.transform = `rotate(${angleDeg}deg)`;
  }

  /** Draws every explored tile of the current floor onto a caller-provided canvas (the expanded modal view). No "close" bonus — memory only. Always north-up, independent of the corner view's rotation. */
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
