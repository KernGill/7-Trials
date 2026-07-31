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
// run.facing value — the SAME convention the live camera yaw itself
// already uses (see DungeonRenderer3D.FACING_ANGLES, which resolves to
// these exact 4 angles), so it doubles as a plain fallback for whichever
// marker-drawing path doesn't have a real continuous yaw on hand yet (the
// very first paint, before the camera's first frame). Everywhere else the
// marker now uses the real continuous yaw directly instead of snapping to
// one of these 4 zones — see _drawPlayerMarker (drawExpanded's one-shot
// bake) and _applyArrowRotation (the corner view's per-frame CSS overlay).
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
 * Per user request, "explored" is no longer a per-tile boolean at all —
 * it's a genuinely continuous, pixel-resolution fog-of-war, built from two
 * offscreen layers per floor:
 *   - `_terrainCanvas`: the dungeon's true tile colors, drawn ONCE per
 *     floor load (the layout itself never changes while exploring it, so
 *     this never needs repainting again — unlike the old per-tile draw
 *     loop, which re-ran on every single reveal).
 *   - `_fogCanvas`: starts fully opaque (black), and `revealCircle()`
 *     permanently erases a soft-edged circle into it — via a radial-
 *     gradient brush composited with `destination-out` — at the player's
 *     exact CONTINUOUS position, every frame (see ExploreState.
 *     revealNearbyTiles). Because the brush fades smoothly from opaque at
 *     its center to transparent at its edge, and is stamped at the
 *     player's real sub-tile position rather than snapped to a tile
 *     center, the revealed boundary reads as a soft, organic torchlit
 *     edge rather than a grid of hard-edged tile squares.
 * The two layers are composited onto the visible `canvas` (terrain then
 * fog on top) every time either changes; fog's own alpha channel does the
 * masking, so there's no separate "is this tile visible" branch left
 * anywhere in the draw path.
 *
 * The corner view leaves ROTATION entirely to CSS: transform-origin is
 * pinned to the player's exact pixel, and left/top position that same
 * pixel at the viewport's center, so rotating the whole canvas around it
 * keeps the player perfectly still on-screen at any angle — a cheap CSS
 * property update every frame, not a per-frame canvas redraw, and what
 * lets the corner view track the free-look camera's continuous yaw
 * smoothly for free.
 *
 * Fog persistence: per user request, the actual fog pixels survive a
 * save/reload exactly (not just an approximation reconstructed from
 * visited tiles) — see getFogDataUrl()/`dungeon.fogData` and
 * _ensureFloorLoaded()'s restore path.
 */
export class Minimap {
  constructor(app) {
    this.app = app;
    this._dungeon = null;
    this._terrainCanvas = null;
    this._fogCanvas = null;
    // Bumped on every floor (re)load; an in-flight async fog-image decode
    // checks its own captured token against this before applying, so a
    // slow decode for a floor the player has since left (e.g. rapid
    // elevator hopping) can never clobber a newer floor's fog with stale
    // pixels.
    this._fogLoadToken = 0;
  }

  mount(container, { onClick } = {}) {
    this.wrapper = document.createElement('div');
    this.wrapper.className = 'minimap';
    this.wrapper.style.width = `${VIEWPORT_SIZE}px`;
    this.wrapper.style.height = `${VIEWPORT_SIZE}px`;
    this.canvas = document.createElement('canvas');
    this.canvas.style.position = 'absolute';
    this.wrapper.appendChild(this.canvas);
    // Player marker for the corner view lives OUTSIDE the tile canvas as
    // its own always-centered overlay (see _updatePan()'s comment on why
    // the canvas's own panning technique already keeps the player's pixel
    // pinned to the wrapper's exact center at every rotation) — that's
    // what lets update() spin it every single frame off the live camera
    // yaw for cheap, exactly like the map's own CSS rotation, instead of
    // only updating whenever a tile-pixel repaint happens to run.
    this.arrowEl = document.createElement('div');
    this.arrowEl.className = 'minimap-arrow';
    this.wrapper.appendChild(this.arrowEl);
    container.appendChild(this.wrapper);
    this._onClick = () => onClick?.();
    this.wrapper.addEventListener('click', this._onClick);
    this._dungeon = null; // force a fresh floor load on the next check
    this._ensureFloorLoaded();
    this.applyRotationDeg(0);
    this._applyArrowRotation(undefined);
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
    this.arrowEl = null;
    this._terrainCanvas = null;
    this._fogCanvas = null;
    this._dungeon = null;
    this._fogLoadToken += 1; // orphan any in-flight fog-image decode
  }

  /**
   * (Re)builds the two offscreen layers for whatever `run.dungeon`
   * currently is, if it isn't the one already loaded — a no-op on every
   * other call (cheap reference check), so it's safe to call from any
   * hot path (see revealCircle()). Terrain is drawn synchronously in full
   * (see _buildTerrain). Fog either starts fully opaque (a floor with no
   * `dungeon.fogData` yet — brand new this run) or is restored from that
   * saved PNG (a floor revisited via the elevator) — the restore is
   * necessarily async (decoding an image), so the fog canvas is filled
   * opaque as an immediate placeholder and swapped the instant the real
   * pixels finish decoding, rather than leaving stale/wrong-floor pixels
   * visible in the meantime.
   */
  _ensureFloorLoaded() {
    if (!this.canvas) return;
    const run = this.app.gameState.run;
    const dungeon = run?.dungeon;
    if (!dungeon || dungeon === this._dungeon) return;
    this._dungeon = dungeon;

    const w = dungeon.width * CELL_SIZE;
    const h = dungeon.height * CELL_SIZE;
    this.canvas.width = w;
    this.canvas.height = h;
    this._terrainCanvas = document.createElement('canvas');
    this._terrainCanvas.width = w;
    this._terrainCanvas.height = h;
    this._buildTerrain(dungeon);

    this._fogCanvas = document.createElement('canvas');
    this._fogCanvas.width = w;
    this._fogCanvas.height = h;
    this._fillFogOpaque();

    const token = (this._fogLoadToken += 1);
    if (dungeon.fogData) {
      const img = new Image();
      img.onload = () => {
        if (token !== this._fogLoadToken || !this._fogCanvas) return;
        const ctx = this._fogCanvas.getContext('2d');
        // Plain drawImage would use 'source-over' compositing, which only
        // ever ADDS opacity on top of the current (opaque placeholder)
        // canvas — it can't restore transparency, since a fully-transparent
        // source pixel contributes nothing and leaves the opaque
        // destination as-is. clearRect first so the restored PNG's own
        // alpha (including its previously-revealed, transparent areas)
        // fully replaces the placeholder instead of blending over it.
        ctx.clearRect(0, 0, this._fogCanvas.width, this._fogCanvas.height);
        ctx.drawImage(img, 0, 0);
        this._applyEventRevealOverrides(dungeon);
        this._composite();
      };
      // Corrupted/truncated fog data shouldn't crash or wedge the map —
      // just fall back to the already-applied opaque placeholder.
      img.onerror = () => {
        if (token !== this._fogLoadToken) return;
        this._applyEventRevealOverrides(dungeon);
        this._composite();
      };
      img.src = dungeon.fogData;
    }

    this._applyEventRevealOverrides(dungeon);
    this._composite();
    this._updatePan();
  }

  /** Public alias — external callers (e.g. right after a fresh floor's dungeon reference is assigned) can call this directly instead of waiting for the next revealCircle() to notice the change. */
  redrawMap() {
    this._ensureFloorLoaded();
  }

  _fillFogOpaque() {
    if (!this._fogCanvas) return;
    const ctx = this._fogCanvas.getContext('2d');
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = 'rgba(0, 0, 0, 1)';
    ctx.fillRect(0, 0, this._fogCanvas.width, this._fogCanvas.height);
  }

  /** The dungeon's true colors, drawn once and never touched again while this floor is active — fog (not terrain) is what hides anything, so every tile paints its real color unconditionally, including meta.hiddenPastGate's caveat below. */
  _buildTerrain(dungeon) {
    const ctx = this._terrainCanvas.getContext('2d');
    ctx.fillStyle = UNKNOWN_COLOR;
    ctx.fillRect(0, 0, this._terrainCanvas.width, this._terrainCanvas.height);
    dungeon.tiles.forEach((tile) => {
      // meta.hiddenPastGate (floor-5 secret hallway, past its blocking
      // gate, plus the arena) never draws here at all — per user request,
      // the map should only ever show the harmless dead-end-looking stub
      // before the gate, never the secret half, even once explored (fog
      // can't reveal what the terrain layer never painted in the first
      // place).
      if (tile.meta?.hiddenPastGate) return;
      ctx.fillStyle = tileColor(tile);
      ctx.fillRect(tile.x * CELL_SIZE, tile.y * CELL_SIZE, CELL_SIZE, CELL_SIZE);
    });
  }

  /**
   * Thief's Idol: permanently punches a hard-edged, tile-sized fog hole
   * over every unresolved revealable-event tile whenever the passive is
   * equipped — independent of player proximity. Called on every floor
   * load and every revealCircle() (cheap — a handful of fillRects at
   * most, and destination-out on already-erased pixels is a visual
   * no-op), so equipping it mid-floor takes effect on the very next
   * frame. Unlike the old per-frame boolean-gated draw, this reveal is
   * permanent once painted (matches fog's own "never re-hides" nature) —
   * unequipping the item afterward does not re-hide a tile it already
   * revealed, which reads as "you found out where it was" rather than
   * "you lost the ability to see it," a reasonable difference from the
   * old strictly-live gate.
   */
  _applyEventRevealOverrides(dungeon) {
    if (!this._fogCanvas || !this.hasEventRevealPassive()) return;
    const ctx = this._fogCanvas.getContext('2d');
    ctx.save();
    ctx.globalCompositeOperation = 'destination-out';
    ctx.fillStyle = 'rgba(0, 0, 0, 1)';
    dungeon.tiles.forEach((tile) => {
      if (tile.meta?.resolved || !REVEALABLE_EVENT_TYPES.includes(tile.type)) return;
      ctx.fillRect(tile.x * CELL_SIZE, tile.y * CELL_SIZE, CELL_SIZE, CELL_SIZE);
    });
    ctx.restore();
  }

  _composite() {
    if (!this.canvas || !this._terrainCanvas || !this._fogCanvas) return;
    const ctx = this.canvas.getContext('2d');
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.drawImage(this._terrainCanvas, 0, 0);
    ctx.drawImage(this._fogCanvas, 0, 0);
  }

  /** Repositions the canvas so the player's exact pixel sits at the viewport's center, rotation pivoting around that same point — see the class doc comment. Runs every frame via revealCircle() now (previously only on a tile-arrival event), so panning itself is now as continuous as the reveal is. */
  _updatePan() {
    if (!this.canvas) return;
    const run = this.app.gameState.run;
    if (!run?.dungeon) return;
    const { x: px, y: py } = run.playerPosition;
    const pixelX = px * CELL_SIZE + CELL_SIZE / 2;
    const pixelY = py * CELL_SIZE + CELL_SIZE / 2;
    this.canvas.style.left = `${VIEWPORT_SIZE / 2 - pixelX}px`;
    this.canvas.style.top = `${VIEWPORT_SIZE / 2 - pixelY}px`;
    this.canvas.style.transformOrigin = `${pixelX}px ${pixelY}px`;
  }

  /**
   * Punches a soft-edged circle of true radius `radiusTiles` (tile-units)
   * centered at the CONTINUOUS point (px,py) permanently into the fog
   * layer — called every frame from ExploreState.revealNearbyTiles with
   * the player's exact live position, giving a smooth, pixel-precise
   * "torchlight" reveal edge instead of the old hard tile-by-tile
   * boundary. A radial-gradient brush (opaque core out to ~55% of the
   * radius, fading to fully transparent at the edge) composited with
   * destination-out erases proportionally to its own alpha, leaving a
   * soft, organic fringe rather than a hard-edged disc. Safe/cheap to
   * call every single frame even when nothing new is actually revealed —
   * destination-out over already-transparent pixels is a visual no-op,
   * and canvas compositing at this scale is well under a millisecond.
   */
  revealCircle(px, py, radiusTiles) {
    this._ensureFloorLoaded();
    if (!this._fogCanvas) return;
    const dungeon = this._dungeon;
    const ctx = this._fogCanvas.getContext('2d');
    const cx = px * CELL_SIZE;
    const cy = py * CELL_SIZE;
    const r = radiusTiles * CELL_SIZE;
    const gradient = ctx.createRadialGradient(cx, cy, r * 0.55, cx, cy, r);
    gradient.addColorStop(0, 'rgba(0, 0, 0, 1)');
    gradient.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.save();
    ctx.globalCompositeOperation = 'destination-out';
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    if (dungeon) this._applyEventRevealOverrides(dungeon);
    this._composite();
    this._updatePan();
  }

  /**
   * Base64 PNG snapshot of the current fog layer, for persistence (see
   * `dungeon.fogData` / ExploreState's throttled sync in tick()) — a real
   * PNG encode, not free, so callers should throttle how often this gets
   * called rather than doing it every frame.
   */
  getFogDataUrl() {
    return this._fogCanvas ? this._fogCanvas.toDataURL('image/png') : null;
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
    this._applyArrowRotation(cameraYaw);
  }

  /**
   * Spins the player-marker overlay to the exact continuous camera yaw —
   * not just the nearest of the 4 cardinal run.facing zones — every
   * single frame, cheaply (a CSS rotate, same as applyRotationDeg()).
   * cameraYaw already uses the identical "0 = north, clockwise" compass
   * convention as the old FACING_TO_ANGLE table (see
   * DungeonRenderer3D.FACING_ANGLES, which north/east/south/west resolve
   * to the exact same 4 angles), so it can be used as that angle directly
   * with no conversion beyond radians -> degrees. In Fixed Minimap (north-
   * up) mode the map itself doesn't rotate, so the arrow needs that full
   * compass angle. In heading-up mode the map already rotates by
   * -cameraYaw (see update() above) so that the camera's own direction
   * reads as screen-up — since the arrow overlay sits OUTSIDE that
   * rotated canvas (see mount()), it only needs to counter-rotate by the
   * same amount to land back at 0deg, i.e. it simply always points
   * straight up, exactly mirroring what the old approximate
   * "facing ≈ yaw so compass angle + (-yaw) ≈ 0" comment described, now
   * exact instead of only true at the 4 cardinal zones.
   */
  _applyArrowRotation(cameraYaw) {
    if (!this.arrowEl) return;
    const fixed = this.app.gameState.settings.fixedMinimap ?? true;
    let deg = 0;
    if (fixed) {
      deg = cameraYaw !== undefined
        ? (cameraYaw * 180) / Math.PI
        : (FACING_TO_ANGLE[this.app.gameState.run?.facing] ?? 0) * (180 / Math.PI);
    }
    this.arrowEl.style.transform = `translate(-50%, -50%) rotate(${deg}deg)`;
  }

  applyRotationDeg(angleDeg) {
    if (!this.canvas) return;
    this.canvas.style.transform = `rotate(${angleDeg}deg)`;
  }

  /**
   * Composites the corner view's own already-up-to-date terrain+fog
   * layers onto a caller-provided canvas (the expanded modal view opened
   * by clicking the corner minimap or pressing M), sized+positioned to
   * fill `viewport` (a fixed-size square element) and rotated to
   * `angleDeg` — per user request, "heading up" (whichever way the
   * player is currently looking) rather than always north-up. Uses the
   * exact same "center the player's pixel, rotate around it" CSS
   * technique as the corner view's _updatePan(), just scaled up: the
   * canvas is drawn at native CELL_SIZE resolution, then CSS-scaled so
   * its LONGER axis exactly fills the viewport (its shorter axis, and
   * anything rotated past the viewport's edges, gets cropped by the
   * viewport's own overflow:hidden — same crop trade-off the corner view
   * already makes while rotating, just on a bigger, still mostly-
   * unclipped canvas instead of a tiny fixed 9x9 window). `yaw` is the
   * exact continuous camera look-yaw at the moment the modal was opened
   * (movement/look is blocked while it's up, so a single bake here is all
   * that's ever needed) — passed straight to _drawPlayerMarker so the
   * baked arrow matches the camera's actual direction instead of only the
   * nearest of the 4 cardinal run.facing zones.
   */
  drawExpanded(canvas, viewport, angleDeg = 0, yaw) {
    const run = this.app.gameState.run;
    const dungeon = run?.dungeon;
    if (!dungeon || !viewport || !this._terrainCanvas || !this._fogCanvas) return;
    canvas.width = dungeon.width * CELL_SIZE;
    canvas.height = dungeon.height * CELL_SIZE;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(this._terrainCanvas, 0, 0);
    ctx.drawImage(this._fogCanvas, 0, 0);

    const { x: px, y: py } = run.playerPosition;
    const pixelX = px * CELL_SIZE + CELL_SIZE / 2;
    const pixelY = py * CELL_SIZE + CELL_SIZE / 2;
    this._drawPlayerMarker(ctx, pixelX, pixelY, CELL_SIZE, yaw);

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

  /**
   * White arrow (not a plain dot) so facing is readable at a glance —
   * only used by drawExpanded() now (the corner view's own marker is a
   * separate CSS-rotated overlay, see mount()/_applyArrowRotation()).
   * Points in the exact continuous camera `yaw` (same "0 = north,
   * clockwise" compass convention as FACING_TO_ANGLE — see
   * _applyArrowRotation()'s comment for why that needs no conversion),
   * falling back to the nearest cardinal run.facing zone via
   * FACING_TO_ANGLE only if no yaw is available at all. Drawn pointing up
   * (0 rotation) then rotated to that angle.
   */
  _drawPlayerMarker(ctx, x, y, cellSize, yaw) {
    const angle = yaw !== undefined ? yaw : (FACING_TO_ANGLE[this.app.gameState.run?.facing] ?? 0);
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
