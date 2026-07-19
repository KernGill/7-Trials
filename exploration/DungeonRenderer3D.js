import * as THREE from '../vendor/three/three.module.js';
import { TILE_TYPES } from './Tile.js';

const BACKGROUND_COLOR = 0x0b0c10;
const VIEW_HEIGHT = 10; // world units of vertical span visible in the ortho frustum

const TILE_SIZE = 2;
const WALL_HEIGHT = TILE_SIZE * 1.5;

// Tile visibility is a live radius around the player, recomputed on every
// move — not a persistent "once seen, always shown" memory. CLEAR_RADIUS
// is a Chebyshev (grid, not Euclidean) distance so it reads as a clean
// square ring: dist<=1 is the 3x3 block centered on the player (the
// player's own tile plus its 8 neighbors), dist<=2 is one further ring
// out (rendered heavily dimmed), and anything past that isn't rendered
// at all — true darkness, not just dark color.
const CLEAR_RADIUS = 1;
const DIM_RADIUS = 2;
const DIM_BLEND = 0.18; // fraction of true color kept at the dim tier; rest is blended toward black

const PLAYER_SPRITE_PATH = '../assets/sprites/characters/artius.png';
const PLAYER_HEIGHT = TILE_SIZE * 0.6;
const LOOK_AT_HEIGHT = TILE_SIZE * 0.5;

const CAMERA_DISTANCE = TILE_SIZE * 3.5;
const CAMERA_PITCH = Math.PI / 4; // 45 degrees from the ground
const CAMERA_VERTICAL_OFFSET = CAMERA_DISTANCE * Math.sin(CAMERA_PITCH);
const CAMERA_HORIZONTAL_OFFSET = CAMERA_DISTANCE * Math.cos(CAMERA_PITCH);
const TWEEN_SPEED = 10; // per second; reaches ~95% of the way to target in ~300ms

// Maps run.facing to the world-space direction the player is walking
// toward, matching the (tile.x, tile.y) -> world (x, z) mapping used
// throughout this renderer.
const FACING_VECTORS = {
  north: new THREE.Vector3(0, 0, -1),
  south: new THREE.Vector3(0, 0, 1),
  east: new THREE.Vector3(1, 0, 0),
  west: new THREE.Vector3(-1, 0, 0),
};

// Same palette as the old .dtile CSS classes, so the 3D view stays
// visually consistent with the rest of the app during the transition.
const COLOR_FLOOR = 0x222222;
const COLOR_WALL = 0x3a3a3a; // walls had no prior color — they were invisible blank cells in the old grid
const MARKER_COLORS = {
  [TILE_TYPES.ENEMY]: 0x7a1f1f,
  [TILE_TYPES.STAIRS]: 0x7a5c1f,
  [TILE_TYPES.LOCKED_DOOR]: 0x3a1f7a,
  [TILE_TYPES.TREASURE]: 0x7a6a1f,
};

function tileKey(x, y) {
  return `${x},${y}`;
}

/** Blends a color toward black, keeping `DIM_BLEND` of the original — used for the shadowy outer ring. */
function dimColor(hex) {
  return new THREE.Color(hex).lerp(new THREE.Color(0x000000), 1 - DIM_BLEND);
}

/**
 * Renders dungeon exploration as an oblique 3D scene. Mounted into the
 * same `.dungeon-grid` container ExploreState already builds, using the
 * mount()/unmount() convention PauseOverlay established. Owns its own
 * requestAnimationFrame loop — StateManager.tick(dt) only drives timers,
 * never per-frame rendering (see StateManager's "no shared canvas"
 * comment), so nothing else will ever call our per-frame update.
 */
export class DungeonRenderer3D {
  mount(container) {
    this.container = container;
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'dungeon-canvas';
    container.appendChild(this.canvas);

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(BACKGROUND_COLOR);

    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 100);
    this.camera.position.set(0, 10, 10);
    this.camera.lookAt(0, 0, 0);

    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true });

    this.tileMeshes = new Map(); // "x,y" -> { wall } | { floor, marker, type }
    this.dungeonGroup = null;
    this.dungeon = null;

    // Camera/player tween state: `current*` is what's actually rendered
    // each frame; `desired*` is set instantly by setPlayerState() and
    // smoothed toward in update(dt). `_playerStateInitialized` guards the
    // very first setPlayerState() call so the camera/sprite snap to the
    // spawn tile instead of lerping in from the origin.
    this.currentCameraPos = new THREE.Vector3();
    this.desiredCameraPos = new THREE.Vector3();
    this.currentLookAt = new THREE.Vector3();
    this.desiredLookAt = new THREE.Vector3();
    this.currentPlayerPos = new THREE.Vector3();
    this.desiredPlayerPos = new THREE.Vector3();
    this._playerStateInitialized = false;

    const spriteUrl = new URL(PLAYER_SPRITE_PATH, import.meta.url).href;
    const spriteMaterial = new THREE.SpriteMaterial({ map: new THREE.TextureLoader().load(spriteUrl) });
    this.playerSprite = new THREE.Sprite(spriteMaterial);
    this.playerSprite.scale.set(TILE_SIZE, TILE_SIZE, 1);
    this.scene.add(this.playerSprite);

    // Shared geometries/materials, reused across every tile mesh —
    // cheap to keep alive for the renderer's lifetime, disposed in unmount().
    // Two material variants per color (clear/dim) implement the visibility
    // tiers; the hidden tier is simply mesh.visible = false, no material.
    this._geo = {
      floor: new THREE.PlaneGeometry(TILE_SIZE, TILE_SIZE),
      wall: new THREE.BoxGeometry(TILE_SIZE, WALL_HEIGHT, TILE_SIZE),
      marker: new THREE.BoxGeometry(TILE_SIZE * 0.5, TILE_SIZE * 0.25, TILE_SIZE * 0.5),
      stairsMarker: new THREE.BoxGeometry(TILE_SIZE * 0.6, TILE_SIZE * 0.075, TILE_SIZE * 0.6),
      // Enemy tiles get their own plain cube for now (placeholder, per design).
      enemyCube: new THREE.BoxGeometry(TILE_SIZE * 0.8, TILE_SIZE * 0.8, TILE_SIZE * 0.8),
    };
    this._mat = {
      floor: new THREE.MeshBasicMaterial({ color: COLOR_FLOOR }),
      dimFloor: new THREE.MeshBasicMaterial({ color: dimColor(COLOR_FLOOR) }),
      wall: new THREE.MeshBasicMaterial({ color: COLOR_WALL }),
      dimWall: new THREE.MeshBasicMaterial({ color: dimColor(COLOR_WALL) }),
      markers: Object.fromEntries(
        Object.entries(MARKER_COLORS).map(([type, color]) => [type, new THREE.MeshBasicMaterial({ color })]),
      ),
      dimMarkers: Object.fromEntries(
        Object.entries(MARKER_COLORS).map(([type, color]) => [type, new THREE.MeshBasicMaterial({ color: dimColor(color) })]),
      ),
    };

    this._onResize = () => this.resize();
    window.addEventListener('resize', this._onResize);
    this.resize();

    this._lastTime = performance.now();
    this._animate = this._animate.bind(this);
    this._rafId = requestAnimationFrame(this._animate);
  }

  resize() {
    if (!this.container || !this.renderer) return;
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    if (!w || !h) return;
    this.renderer.setSize(w, h, false);
    const aspect = w / h;
    const viewWidth = VIEW_HEIGHT * aspect;
    this.camera.left = -viewWidth / 2;
    this.camera.right = viewWidth / 2;
    this.camera.top = VIEW_HEIGHT / 2;
    this.camera.bottom = -VIEW_HEIGHT / 2;
    this.camera.updateProjectionMatrix();
  }

  _animate() {
    this._rafId = requestAnimationFrame(this._animate);
    const now = performance.now();
    const dt = (now - this._lastTime) / 1000;
    this._lastTime = now;
    this.update(dt);
    this.renderer.render(this.scene, this.camera);
  }

  /** Smoothly tweens camera/player toward their latest setPlayerState() target. */
  update(dt) {
    const t = 1 - Math.exp(-TWEEN_SPEED * dt);
    this.currentCameraPos.lerp(this.desiredCameraPos, t);
    this.currentLookAt.lerp(this.desiredLookAt, t);
    this.currentPlayerPos.lerp(this.desiredPlayerPos, t);

    this.camera.position.copy(this.currentCameraPos);
    this.camera.lookAt(this.currentLookAt);
    this.playerSprite.position.set(this.currentPlayerPos.x, PLAYER_HEIGHT, this.currentPlayerPos.z);
  }

  /** Builds the floor's tile geometry — walls, floor planes, and tile-type markers (visibility applied separately). */
  setDungeon(dungeon) {
    // Geometries/materials are shared (this._geo/this._mat) and disposed
    // once in unmount() — removing the group from the scene is enough.
    if (this.dungeonGroup) this.scene.remove(this.dungeonGroup);
    this.dungeon = dungeon;
    this.tileMeshes.clear();
    this.dungeonGroup = new THREE.Group();
    // A new floor's spawn tile can be anywhere on the map — snap the
    // camera/sprite to it on the next setPlayerState() rather than
    // tweening a long swoop across the whole dungeon.
    this._playerStateInitialized = false;

    dungeon.tiles.forEach((tile) => {
      const worldX = tile.x * TILE_SIZE;
      const worldZ = tile.y * TILE_SIZE;

      if (tile.type === TILE_TYPES.WALL) {
        const wall = new THREE.Mesh(this._geo.wall, this._mat.wall);
        wall.position.set(worldX, WALL_HEIGHT / 2, worldZ);
        this.dungeonGroup.add(wall);
        this.tileMeshes.set(tileKey(tile.x, tile.y), { wall, type: TILE_TYPES.WALL });
        return;
      }

      const floor = new THREE.Mesh(this._geo.floor, this._mat.floor);
      floor.rotation.x = -Math.PI / 2;
      floor.position.set(worldX, 0, worldZ);
      this.dungeonGroup.add(floor);

      const entry = { floor, marker: null, type: tile.type };
      this.tileMeshes.set(tileKey(tile.x, tile.y), entry);
      // Markers are always built (not gated on `explored`) — visibility
      // within the view radius is what controls whether a tile's type
      // can be seen, per the "see it before you step on it" design; only
      // updateVisibility() decides whether it's actually shown right now.
      this._applyMarker(tile, entry);
    });

    this.scene.add(this.dungeonGroup);
  }

  _applyMarker(tile, entry) {
    const markerMat = this._mat.markers[tile.type];
    if (!markerMat || entry.marker) return;
    let geo = this._geo.marker;
    let height = TILE_SIZE * 0.3;
    if (tile.type === TILE_TYPES.STAIRS) {
      geo = this._geo.stairsMarker;
      height = TILE_SIZE * 0.15;
    } else if (tile.type === TILE_TYPES.ENEMY) {
      geo = this._geo.enemyCube;
      height = TILE_SIZE * 0.4;
    }
    const marker = new THREE.Mesh(geo, markerMat);
    marker.position.set(tile.x * TILE_SIZE, height, tile.y * TILE_SIZE);
    this.dungeonGroup.add(marker);
    entry.marker = marker;
  }

  /**
   * Recomputes every tile's visibility tier from the player's current grid
   * position: clear (true color) within CLEAR_RADIUS, dimmed within
   * DIM_RADIUS, and not rendered at all beyond that. Runs on every move —
   * this is live sight, not a permanent "once seen" reveal.
   */
  updateVisibility(px, py) {
    this.tileMeshes.forEach((entry, key) => {
      const [txStr, tyStr] = key.split(',');
      const dist = Math.max(Math.abs(Number(txStr) - px), Math.abs(Number(tyStr) - py));
      const tier = dist <= CLEAR_RADIUS ? 'clear' : dist <= DIM_RADIUS ? 'dim' : 'hidden';
      const visible = tier !== 'hidden';
      const dim = tier === 'dim';

      if (entry.wall) {
        entry.wall.visible = visible;
        entry.wall.material = dim ? this._mat.dimWall : this._mat.wall;
        return;
      }
      entry.floor.visible = visible;
      entry.floor.material = dim ? this._mat.dimFloor : this._mat.floor;
      if (entry.marker) {
        entry.marker.visible = visible;
        entry.marker.material = dim ? this._mat.dimMarkers[entry.type] : this._mat.markers[entry.type];
      }
    });
  }

  /**
   * Sets the camera/player target for the next tween step and recomputes
   * tile visibility immediately (visibility is tile-discrete, not tweened).
   * The camera sits behind the player relative to `facing`
   * (over-the-shoulder), looking toward the direction they're walking, at
   * a fixed 45-degree pitch. On the very first call, snaps instantly
   * instead of tweening in from the origin.
   */
  setPlayerState({ x, y, facing }) {
    this.updateVisibility(x, y);

    const facingVec = FACING_VECTORS[facing] ?? FACING_VECTORS.south;
    this.desiredPlayerPos.set(x * TILE_SIZE, 0, y * TILE_SIZE);
    this.desiredLookAt.set(
      this.desiredPlayerPos.x,
      LOOK_AT_HEIGHT,
      this.desiredPlayerPos.z,
    );
    this.desiredCameraPos.copy(this.desiredPlayerPos)
      .addScaledVector(facingVec, -CAMERA_HORIZONTAL_OFFSET)
      .add(new THREE.Vector3(0, CAMERA_VERTICAL_OFFSET, 0));

    if (!this._playerStateInitialized) {
      this._playerStateInitialized = true;
      this.currentPlayerPos.copy(this.desiredPlayerPos);
      this.currentLookAt.copy(this.desiredLookAt);
      this.currentCameraPos.copy(this.desiredCameraPos);
      this.camera.position.copy(this.currentCameraPos);
      this.camera.lookAt(this.currentLookAt);
      this.playerSprite.position.set(this.currentPlayerPos.x, PLAYER_HEIGHT, this.currentPlayerPos.z);
    }
  }

  unmount() {
    if (this._rafId) cancelAnimationFrame(this._rafId);
    if (this._onResize) window.removeEventListener('resize', this._onResize);
    Object.values(this._geo ?? {}).forEach((g) => g.dispose());
    Object.values(this._mat ?? {}).forEach((m) => {
      if (m.dispose) m.dispose();
      else Object.values(m).forEach((mm) => mm.dispose());
    });
    this.playerSprite?.material.map?.dispose();
    this.playerSprite?.material.dispose();
    this.renderer?.dispose();
    this.canvas?.remove();
    this.scene = null;
    this.camera = null;
    this.renderer = null;
    this.canvas = null;
    this.container = null;
    this.tileMeshes = null;
    this.dungeonGroup = null;
    this.playerSprite = null;
  }
}
