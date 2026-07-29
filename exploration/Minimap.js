import { TILE_TYPES } from './Tile.js';
import { getMoveTemplate } from '../data/moves.js';

// Thief's Future (Thief's Idol): these tile types count as "events" that
// get marked on the map before they're actually explored.
const REVEALABLE_EVENT_TYPES = [TILE_TYPES.LOCKED_DOOR, TILE_TYPES.TREASURE, TILE_TYPES.TEMPORAL_CHEST];

const RADIUS = 4; // 9x9 visible window, per user request ("4 block radius")
const CELL_SIZE = 16;
const VIEWPORT_SIZE = (RADIUS * 2 + 1) * CELL_SIZE;

const TILE_COLORS = {
  [TILE_TYPES.WALL]: '#3a3a3a',
  [TILE_TYPES.FLOOR]: '#5a5a5a',
  [TILE_TYPES.STAIRS]: '#c9a227',
  [TILE_TYPES.ENEMY]: '#c0392b',
  [TILE_TYPES.LOCKED_DOOR]: '#7c4fd1',
  [TILE_TYPES.TREASURE]: '#c9962a',
  [TILE_TYPES.TEMPORAL_CHEST]: '#1f5fd9',
  [TILE_TYPES.ELEVATOR]: '#2ecc71',
  [TILE_TYPES.VENDOR]: '#d4af37',
};
const UNKNOWN_COLOR = '#000000';
const PLAYER_COLOR = '#ffffff';

// Absolute compass angle (radians, 0 = up/north, clockwise) for each
// run.facing value — baked straight into the marker's canvas pixels at the
// SAME angle regardless of which view is drawing it. Both the corner view's
// CSS rotation (0 in Fixed Minimap mode, -yaw in heading-up mode) and the
// expanded view's (always -yaw, see drawExpanded) get applied to the whole
// canvas, arrow included — so a compass-angle arrow automatically ends up
// pointing screen-up in heading-up mode (facing ≈ yaw, so compass angle +
// (-yaw) ≈ 0) with zero extra fixed/heading-up special-casing needed here.
const FACING_TO_ANGLE = { north: 0, east: Math.PI / 2, south: Math.PI, west: (3 * Math.PI) / 2 };

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

  /** Thief's Future (Thief's Idol): checked straight off equipped item ids, not a live Player instance — Minimap only ever has `this.app`, not ExploreState's cached player. */
  hasEventRevealPassive() {
    return this.app.inventory.getEquippedMoveIds().some((id) => getMoveTemplate(id)?.revealsUnexploredEvents);
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
    const revealEvents = this.hasEventRevealPassive();
    dungeon.tiles.forEach((tile) => {
      // meta.hiddenPastGate (floor-5 secret hallway, past its blocking
      // gate, plus the arena) never draws here — per user request, the
      // map should only ever show the harmless dead-end-looking stub
      // before the gate, never the secret half, even once explored.
      if (tile.meta?.hiddenPastGate) return;
      // Thief's Future: an unresolved event tile draws even before it's
      // actually been explored.
      const revealed = revealEvents && !tile.meta?.resolved && REVEALABLE_EVENT_TYPES.includes(tile.type);
      if (!tile.explored && !revealed) return;
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

  /**
   * Draws every explored tile of the current floor onto a caller-provided
   * canvas (the expanded modal view opened by clicking the corner minimap
   * or pressing M), sized+positioned to fill `viewport` (a fixed-size
   * square element) and rotated to `angleDeg` — per user request, "heading
   * up" (whichever way the player is currently looking) rather than
   * always north-up. Uses the exact same "center the player's pixel,
   * rotate around it" CSS technique as the corner view's redrawMap(), just
   * scaled up: the canvas is drawn at native CELL_SIZE resolution, then
   * CSS-scaled so its LONGER axis exactly fills the viewport (its shorter
   * axis, and anything rotated past the viewport's edges, gets cropped by
   * the viewport's own overflow:hidden — same crop trade-off the corner
   * view already makes while rotating, just on a bigger, still mostly-
   * unclipped canvas instead of a tiny fixed 9x9 window).
   */
  drawExpanded(canvas, viewport, angleDeg = 0) {
    const run = this.app.gameState.run;
    const dungeon = run?.dungeon;
    if (!dungeon || !viewport) return;
    canvas.width = dungeon.width * CELL_SIZE;
    canvas.height = dungeon.height * CELL_SIZE;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = UNKNOWN_COLOR;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const revealEvents = this.hasEventRevealPassive();
    dungeon.tiles.forEach((tile) => {
      if (tile.meta?.hiddenPastGate) return;
      const revealed = revealEvents && !tile.meta?.resolved && REVEALABLE_EVENT_TYPES.includes(tile.type);
      if (!tile.explored && !revealed) return;
      ctx.fillStyle = tileColor(tile);
      ctx.fillRect(tile.x * CELL_SIZE, tile.y * CELL_SIZE, CELL_SIZE, CELL_SIZE);
    });

    const { x: px, y: py } = run.playerPosition;
    const pixelX = px * CELL_SIZE + CELL_SIZE / 2;
    const pixelY = py * CELL_SIZE + CELL_SIZE / 2;
    this._drawPlayerMarker(ctx, pixelX, pixelY, CELL_SIZE);

    const viewportPx = viewport.clientWidth;
    const scale = viewportPx / Math.max(canvas.width, canvas.height);
    canvas.style.position = 'absolute';
    canvas.style.width = `${canvas.width * scale}px`;
    canvas.style.height = `${canvas.height * scale}px`;
    canvas.style.left = `${viewportPx / 2 - pixelX * scale}px`;
    canvas.style.top = `${viewportPx / 2 - pixelY * scale}px`;
    canvas.style.transformOrigin = `${pixelX * scale}px ${pixelY * scale}px`;
    canvas.style.transform = `rotate(${angleDeg}deg)`;
  }

  /** White arrow (not a plain dot) so facing is readable at a glance — points in run.facing's compass direction, drawn pointing up (0 rotation) then rotated to FACING_TO_ANGLE. See that constant's comment for why baking the absolute compass angle in here (rather than something view-mode-specific) already comes out correct in both Fixed Minimap and heading-up rotation modes. */
  _drawPlayerMarker(ctx, x, y, cellSize) {
    const angle = FACING_TO_ANGLE[this.app.gameState.run?.facing] ?? 0;
    const r = Math.max(3, cellSize * 0.55);
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle);
    ctx.fillStyle = PLAYER_COLOR;
    ctx.beginPath();
    ctx.moveTo(0, -r); // tip
    ctx.lineTo(r * 0.62, r * 0.75); // back-right
    ctx.lineTo(0, r * 0.4); // concave back-notch, reads as an arrowhead rather than a plain triangle
    ctx.lineTo(-r * 0.62, r * 0.75); // back-left
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }
}
