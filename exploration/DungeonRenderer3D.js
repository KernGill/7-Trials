import * as THREE from '../vendor/three/three.module.js';
import { TILE_TYPES } from './Tile.js';
import { clamp } from '../utils/MathUtils.js';
import { t } from '../ui/i18n.js';
import {
  CAMERA_ANGLE_MIN, CAMERA_ANGLE_MAX, CAMERA_HEIGHT_MIN_PERCENT, CAMERA_HEIGHT_MAX_PERCENT,
  DEFAULT_CAMERA_ANGLE, DEFAULT_CAMERA_HEIGHT, DEFAULT_CAMERA_SENSITIVITY_PERCENT,
  linkedHeightPercentForAngle,
} from '../ui/CameraSettings.js';

const BACKGROUND_COLOR = 0x0b0c10;
const VIEW_HEIGHT = 10; // world units of vertical span visible in the ortho frustum

const TILE_SIZE = 2;
const WALL_HEIGHT = TILE_SIZE * 8; // tall enough that the top edge is never visible in frame
const WALL_THICKNESS = TILE_SIZE * 0.1; // thin panel, not a full-tile block

// A wall tile only gets geometry on the sides that actually border a
// non-wall tile — a wall surrounded entirely by other walls renders
// nothing at all, and a wall with floor on only one side gets a single
// thin panel there, not a solid block filling the whole cell. This keeps
// walls reading as boundaries between spaces rather than stacked blocks.
const CARDINAL_DIRS = [
  { dx: 0, dy: -1, side: 'north' },
  { dx: 0, dy: 1, side: 'south' },
  { dx: 1, dy: 0, side: 'east' },
  { dx: -1, dy: 0, side: 'west' },
];

// Tile visibility is a live radius around the player, recomputed on every
// move — not a persistent "once seen, always shown" memory — using
// Chebyshev (grid, not Euclidean) distance so it reads as clean square
// rings. Every individual tile distance (0..VISIBLE_RADIUS) gets its own
// point on a smooth continuous falloff curve rather than a handful of
// discrete bands, so the fade reads as gradual rather than stepped;
// anything past VISIBLE_RADIUS isn't rendered at all — true darkness.
//
// Walls/floor stay fully OPAQUE at every distance — they fade by blending
// their color toward the background color instead, so a distant wall
// still fully occludes what's behind it (no see-through). Markers (the
// actual objects on a tile) are the opposite: they stay transparent,
// fading via opacity instead of color.
const VISIBLE_RADIUS = 7; // max distance (tiles) anything renders at all
// >1 keeps the falloff gentle for the first few tiles and steep from
// ~5 tiles out — visibilityStrength(5..7) drops off much faster than
// visibilityStrength(0..4) does, matching "hard to see from 5 onward".
const VISIBILITY_FALLOFF_POWER = 2.5;
const MAX_FLOOR_KEEP = 0.55; // floor color-keep fraction at distance 0 (rest blended to background) — floor stays legible as "the path"
const MAX_WALL_KEEP = 0.2; // wall color-keep fraction at distance 0 — deliberately low so even nearby walls sit close to the background color
const MAX_MARKER_OPACITY = 1; // marker opacity at distance 0

/**
 * Smooth per-tile-distance visibility strength in [0,1]: 1 at distance 0,
 * gently tapering through the first few tiles, then dropping steeply from
 * ~5 tiles out, reaching (but never quite hitting) 0 at VISIBLE_RADIUS —
 * every individual integer distance gets a distinct point on the curve.
 */
function visibilityStrength(dist) {
  const t = clamp(dist / (VISIBLE_RADIUS + 1), 0, 1);
  return (1 - t) ** VISIBILITY_FALLOFF_POWER;
}

// The camera sits behind the player relative to facing, so a wall directly
// behind the player (the tile one step opposite of facing) can sit right
// on the camera-to-player line and hide the character sprite entirely.
// That one wall panel — the one facing the player — is made mostly
// transparent so the character stays visible; turning restores it to
// normal and makes whichever wall is newly "behind" transparent instead.
const BEHIND_WALL_OPACITY = 0.15;

const PLAYER_SPRITE_PATH = '../assets/sprites/characters/artius.png';
const PLAYER_HEIGHT = TILE_SIZE * 0.6;
const LOOK_AT_HEIGHT = TILE_SIZE * 0.5;

const CAMERA_HORIZONTAL_OFFSET = TILE_SIZE; // camera sits up to 1 tile behind the player at angle=0, shrinking toward 0 as angle approaches 90 (bird's eye)
// Extra height added to the look-at target only (not the camera) — aims
// the camera at a point above the character instead of straight at them,
// so the character sits lower in frame rather than filling the whole screen.
const CAMERA_LOOK_LIFT = TILE_SIZE * 1.5;
const TWEEN_SPEED = 10; // per second; reaches ~95% of the way to target in ~300ms

// Camera Angle setting: 0deg (horizontal, eye-level) - 90deg (bird's eye,
// straight down). Camera Height setting: a multiplier on CAMERA_HEIGHT_BASE,
// 1/3 - 1.5x. Both are independent — angle alone controls how far back the
// camera sits (via cos), height alone controls how high up it sits — unlike
// the old single fixed-pitch formula, which derived height from angle via
// tan() and breaks down (divides by ~0) as angle approaches 90deg. Range/
// default constants live in ui/CameraSettings.js (shared with the Settings
// screens so the sliders there can't drift out of sync with what this
// renderer actually accepts).
const DEFAULT_CAMERA_ANGLE_DEG = DEFAULT_CAMERA_ANGLE;
const DEFAULT_CAMERA_HEIGHT_MULT = DEFAULT_CAMERA_HEIGHT;
const CAMERA_ANGLE_MIN_DEG = CAMERA_ANGLE_MIN;
const CAMERA_ANGLE_MAX_DEG = CAMERA_ANGLE_MAX;
const CAMERA_HEIGHT_MULT_MIN = CAMERA_HEIGHT_MIN_PERCENT / 100;
const CAMERA_HEIGHT_MULT_MAX = CAMERA_HEIGHT_MAX_PERCENT / 100;
// The camera's actual world-space height under the old fixed 30deg config
// (LOOK_AT_HEIGHT + CAMERA_HORIZONTAL_OFFSET*tan(30deg), plus CAMERA_LOOK_LIFT
// which the old formula folded into the camera's own height too) — this is
// the "100%"/1x baseline the new Camera Height setting scales from, so a
// fresh save with both settings at their defaults looks exactly as before.
const CAMERA_HEIGHT_BASE = LOOK_AT_HEIGHT + CAMERA_HORIZONTAL_OFFSET * Math.tan((DEFAULT_CAMERA_ANGLE_DEG * Math.PI) / 180) + CAMERA_LOOK_LIFT;

// Maps run.facing to the world-space direction the player is walking
// toward, matching the (tile.x, tile.y) -> world (x, z) mapping used
// throughout this renderer.
const FACING_VECTORS = {
  north: new THREE.Vector3(0, 0, -1),
  south: new THREE.Vector3(0, 0, 1),
  east: new THREE.Vector3(1, 0, 0),
  west: new THREE.Vector3(-1, 0, 0),
};

// Continuous-angle equivalent of FACING_VECTORS (vec = (sin(a), 0, -cos(a))).
// The camera's own look yaw is mouse-driven and independent of run.facing
// (see MOUSE_YAW_SENSITIVITY below) — this map is only used to (a) seed the
// camera's starting yaw from the player's initial facing on spawn, and (b)
// find the nearest cardinal direction to the camera's CURRENT yaw, for the
// behind-the-player wall occlusion check.
const FACING_ANGLES = { north: 0, east: Math.PI / 2, south: Math.PI, west: -Math.PI / 2 };
const FACING_BY_QUADRANT = ['north', 'east', 'south', 'west'];

/** Nearest of the 4 cardinal facings to a given yaw angle (any real value, wraps). */
function nearestFacingFromYaw(yaw) {
  const twoPi = Math.PI * 2;
  let a = yaw % twoPi;
  if (a < 0) a += twoPi;
  const idx = Math.round(a / (Math.PI / 2)) % 4;
  return FACING_BY_QUADRANT[idx];
}

/**
 * Shortest signed angular delta from `from` to `to`, in (-PI, PI] —
 * used only for the arrow-key "snap to zone center" turn tween below
 * (see turnCameraSnap/_yawSnapTarget). Works correctly even when `from`
 * is a large unbounded accumulator (e.g. after many mouse-look turns)
 * and `to` is one of the small canonical FACING_ANGLES values, since the
 * modulo here normalizes the DIFFERENCE, not either angle itself.
 */
function shortestAngleDelta(from, to) {
  let delta = (to - from) % (Math.PI * 2);
  if (delta > Math.PI) delta -= Math.PI * 2;
  if (delta < -Math.PI) delta += Math.PI * 2;
  return delta;
}

// Mouse-look sensitivity: yaw is unbounded (full omnidirectional orbit
// around the player); pitch reuses the Camera Angle setting's own
// [CAMERA_ANGLE_MIN_DEG, CAMERA_ANGLE_MAX_DEG] range as its clamp, so it
// can never flip past eye-level or past straight-down. Moving the mouse
// right turns the view right (clockwise, matching standard mouselook);
// moving it DOWN orbits the camera up and over the character (pitch
// rises toward bird's-eye) — inverted from a plain FPS look, per user
// request. These are the baseline ("100%") values the Camera Sensitivity
// setting scales — see _handleMouseMove.
const MOUSE_YAW_SENSITIVITY = 0.0044; // radians per pixel of mouse movementX
const MOUSE_PITCH_SENSITIVITY = 0.24; // degrees per pixel of mouse movementY

// How long the "Press ESC to disable mouse look" hint stays up after
// Pointer Lock engages before auto-hiding — the browser's own native
// pointer-lock notification already covers this longer-term, so ours
// only needs to reinforce it briefly.
const MOUSELOOK_ESC_HINT_MS = 4000;

// Same palette as the old .dtile CSS classes, so the 3D view stays
// visually consistent with the rest of the app during the transition.
const COLOR_FLOOR = 0x222222;
const COLOR_WALL = 0x3a3a3a; // walls had no prior color — they were invisible blank cells in the old grid
const MARKER_COLORS = {
  [TILE_TYPES.ENEMY]: 0x7a1f1f,
  [TILE_TYPES.STAIRS]: 0x7a5c1f,
  [TILE_TYPES.LOCKED_DOOR]: 0x3a1f7a,
  [TILE_TYPES.TREASURE]: 0x7a6a1f,
  [TILE_TYPES.TEMPORAL_CHEST]: 0x1f5fd9,
  [TILE_TYPES.HIDDEN_ENEMY]: 0x000000,
};

function tileKey(x, y) {
  return `${x},${y}`;
}

/** Blends a color toward `towardHex`, keeping `keepFraction` of the original. */
function blendColor(hex, keepFraction, towardHex) {
  return new THREE.Color(hex).lerp(new THREE.Color(towardHex), 1 - keepFraction);
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
  constructor(app) {
    this.app = app;
  }

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

    this.tileMeshes = new Map(); // "x,y" -> { walls: [{mesh,dx,dy},...] } | { floor, marker, type }
    this.dungeonGroup = null;
    this.dungeon = null;

    // Camera/player tween state: `current*` is what's actually rendered
    // each frame; `desired*` is set instantly by setPlayerState() and
    // smoothed toward in update(dt). `_playerStateInitialized` guards the
    // very first setPlayerState() call so the camera/sprite snap to the
    // spawn tile instead of lerping in from the origin.
    this._cameraPos = new THREE.Vector3();
    this._lookAtPos = new THREE.Vector3();
    this._facingVec = new THREE.Vector3();
    // Mouse-look camera orientation — independent of run.facing (grid
    // movement stays tile-locked; only the VIEW is free). Undefined until
    // the first setPlayerState() seeds a starting yaw from the player's
    // spawn facing; pitch is seeded from the Camera Angle setting.
    this._lookYaw = undefined;
    const initialSettings = this.app?.gameState?.settings ?? {};
    this._lookPitchDeg = clamp(
      initialSettings.cameraAngle ?? DEFAULT_CAMERA_ANGLE_DEG,
      CAMERA_ANGLE_MIN_DEG, CAMERA_ANGLE_MAX_DEG,
    );
    // Set by turnCameraSnap() (left/right arrow keys) — while defined,
    // update() eases _lookYaw toward it every frame; any subsequent mouse
    // movement cancels it immediately so manual look always wins.
    this._yawSnapTarget = undefined;
    this.currentPlayerPos = new THREE.Vector3();
    this.desiredPlayerPos = new THREE.Vector3();
    this._playerStateInitialized = false;
    this._playerGridX = undefined;
    this._playerGridY = undefined;
    // Wall panels currently overridden to the see-through "behind the
    // player" material — restored to their normal distance-tiered
    // material every frame before the new set (from the camera's current
    // orbit position) is computed, since that set now changes continuously
    // with the mouse instead of only on a grid move/turn.
    this._lastOccludedWalls = [];
    // Screen shake (see triggerShake) — a fixed end-timestamp + magnitude
    // rather than a countdown, so it's immune to any dt weirdness.
    this._shakeUntil = 0;
    this._shakeMagnitude = 0;

    const spriteUrl = new URL(PLAYER_SPRITE_PATH, import.meta.url).href;
    const spriteMaterial = new THREE.SpriteMaterial({ map: new THREE.TextureLoader().load(spriteUrl) });
    this.playerSprite = new THREE.Sprite(spriteMaterial);
    this.playerSprite.scale.set(TILE_SIZE, TILE_SIZE, 1);
    this.scene.add(this.playerSprite);

    // Shared geometries/materials, reused across every tile mesh —
    // cheap to keep alive for the renderer's lifetime, disposed in unmount().
    // Walls/floor fade purely by color (toward the background, staying
    // opaque — see MAX_FLOOR_KEEP / MAX_WALL_KEEP above); markers fade via
    // transparency instead. One material per integer distance
    // (0..VISIBLE_RADIUS) is precomputed here so updateVisibility() can
    // just index into it every move, rather than allocating per-frame.
    this._geo = {
      floor: new THREE.PlaneGeometry(TILE_SIZE, TILE_SIZE),
      // Thin panels, not full-tile blocks — see CARDINAL_DIRS comment above.
      // wallPanelNS spans the tile's width, wallPanelEW spans its depth;
      // both are only WALL_THICKNESS deep in the direction they face.
      wallPanelNS: new THREE.BoxGeometry(TILE_SIZE, WALL_HEIGHT, WALL_THICKNESS),
      wallPanelEW: new THREE.BoxGeometry(WALL_THICKNESS, WALL_HEIGHT, TILE_SIZE),
      marker: new THREE.BoxGeometry(TILE_SIZE * 0.5, TILE_SIZE * 0.25, TILE_SIZE * 0.5),
      stairsMarker: new THREE.BoxGeometry(TILE_SIZE * 0.6, TILE_SIZE * 0.075, TILE_SIZE * 0.6),
      // Enemy tiles get their own plain cube for now (placeholder, per design).
      enemyCube: new THREE.BoxGeometry(TILE_SIZE * 0.8, TILE_SIZE * 0.8, TILE_SIZE * 0.8),
    };
    // Opaque — no `transparent`/`opacity` at all, so a distant wall/floor
    // still fully blocks whatever's behind it; only the color shifts
    // toward the background as distance increases. floorByDist[d] /
    // wallByDist[d] / markerByDist[type][d] hold the distance-`d` material.
    const floorByDist = [];
    const wallByDist = [];
    for (let d = 0; d <= VISIBLE_RADIUS; d += 1) {
      const v = visibilityStrength(d);
      floorByDist.push(new THREE.MeshBasicMaterial({ color: blendColor(COLOR_FLOOR, MAX_FLOOR_KEEP * v, BACKGROUND_COLOR) }));
      wallByDist.push(new THREE.MeshBasicMaterial({ color: blendColor(COLOR_WALL, MAX_WALL_KEEP * v, BACKGROUND_COLOR) }));
    }
    const markerByDist = Object.fromEntries(
      Object.entries(MARKER_COLORS).map(([type, color]) => [
        type,
        Array.from({ length: VISIBLE_RADIUS + 1 }, (_, d) => new THREE.MeshBasicMaterial({
          color, transparent: true, opacity: MAX_MARKER_OPACITY * visibilityStrength(d),
        })),
      ]),
    );
    this._mat = {
      floorByDist,
      wallByDist,
      markerByDist,
      // Behind-the-player occlusion override — see BEHIND_WALL_OPACITY comment above.
      behindWall: new THREE.MeshBasicMaterial({ color: COLOR_WALL, transparent: true, opacity: BEHIND_WALL_OPACITY }),
    };

    this._onResize = () => this.resize();
    window.addEventListener('resize', this._onResize);
    this.resize();

    // Mouse-look: click the canvas to engage the Pointer Lock API (needed
    // for raw relative movementX/Y deltas, and to hide/freeze the OS
    // cursor). A hint overlay prompts for that first click; once locked,
    // it flips to the "how to exit" reminder for a few seconds and then
    // hides itself (the browser's own native pointer-lock notification
    // already covers the rest of the session), and it reverts to the
    // "click to enable" prompt the instant the lock is lost (Escape,
    // tab-out, or the pause check in update() below releasing it).
    this._hintEl = document.createElement('div');
    this._hintEl.className = 'mouselook-hint';
    this._hintEl.textContent = t('explore.mouselook_hint');
    container.appendChild(this._hintEl);
    this._hintHideTimeout = null;

    this._onCanvasClick = () => {
      if (document.pointerLockElement !== this.canvas) this.canvas.requestPointerLock?.();
    };
    this.canvas.addEventListener('click', this._onCanvasClick);

    this._onPointerLockChange = () => {
      const locked = document.pointerLockElement === this.canvas;
      if (this._hintHideTimeout) { clearTimeout(this._hintHideTimeout); this._hintHideTimeout = null; }
      if (!this._hintEl) return;
      if (locked) {
        this._hintEl.textContent = t('explore.mouselook_esc_hint');
        this._hintEl.style.display = '';
        this._hintHideTimeout = setTimeout(() => {
          if (this._hintEl) this._hintEl.style.display = 'none';
        }, MOUSELOOK_ESC_HINT_MS);
      } else {
        this._hintEl.textContent = t('explore.mouselook_hint');
        this._hintEl.style.display = '';
      }
    };
    document.addEventListener('pointerlockchange', this._onPointerLockChange);

    this._onMouseMove = (e) => this._handleMouseMove(e);
    document.addEventListener('mousemove', this._onMouseMove);

    this._lastTime = performance.now();
    this._animate = this._animate.bind(this);
    this._rafId = requestAnimationFrame(this._animate);
  }

  /**
   * Applies a locked-pointer mousemove delta to the free-look yaw/pitch,
   * scaled by the live Camera Sensitivity setting. No-op while unlocked,
   * paused, or before the first setPlayerState() has seeded a starting
   * yaw. Pitch changes are also written straight back into
   * settings.cameraAngle/cameraHeight (via the same linked formula the
   * Camera Orientation slider itself uses) — per user request, looking
   * up/down with the mouse IS adjusting that setting live, not a
   * separate value that drifts out of sync with it.
   */
  _handleMouseMove(e) {
    if (document.pointerLockElement !== this.canvas) return;
    this.applyLookDelta(e.movementX, e.movementY);
  }

  /**
   * Applies a raw (unscaled-by-sensitivity) yaw/pitch pixel delta to the
   * free-look camera — the shared core behind both mouse-look
   * (_handleMouseMove, fed Pointer Lock's movementX/Y) and touch-look
   * (ExploreState's touch-drag handler on the right-side camera zone,
   * which has no Pointer Lock to read relative deltas from and calls this
   * directly with its own raw touch-move delta each frame). Also mirrors
   * pitch into the Camera Angle/Height settings either way — see the old
   * _handleMouseMove's comment on why.
   */
  applyLookDelta(dx, dy) {
    if (this._lookYaw === undefined) return;
    if (this.app?.gameState?.paused) return;
    const settings = this.app?.gameState?.settings ?? {};
    const sensitivity = (settings.cameraSensitivity ?? DEFAULT_CAMERA_SENSITIVITY_PERCENT / 100);
    this._yawSnapTarget = undefined; // manual look input always overrides a pending arrow-key snap
    this._lookYaw += dx * MOUSE_YAW_SENSITIVITY * sensitivity;
    // Inverted from a plain FPS look (moving down raises pitch toward
    // bird's-eye) — see MOUSE_PITCH_SENSITIVITY's comment.
    this._lookPitchDeg = clamp(
      this._lookPitchDeg + dy * MOUSE_PITCH_SENSITIVITY * sensitivity,
      CAMERA_ANGLE_MIN_DEG, CAMERA_ANGLE_MAX_DEG,
    );
    if (this.app?.gameState) {
      this.app.gameState.settings.cameraAngle = this._lookPitchDeg;
      this.app.gameState.settings.cameraHeight = linkedHeightPercentForAngle(this._lookPitchDeg) / 100;
    }
  }

  /** Current mouse-look yaw (radians, unbounded), for callers that need to read the live camera direction (e.g. the minimap's rotation). */
  getLookYaw() {
    return this._lookYaw;
  }

  /** Nearest of the 4 cardinal directions to the camera's CURRENT view — the "directional zone" the free-look camera is pointing into right now. Grid movement (ExploreState) resolves WASD against this instead of a separately-tracked facing, so movement always matches whichever way you're currently looking. */
  getFacingZone() {
    return this._lookYaw === undefined ? undefined : nearestFacingFromYaw(this._lookYaw);
  }

  /**
   * Left/right-arrow "quick turn": animates the camera's yaw to the
   * center of the next/previous 90° zone relative to whichever zone it's
   * currently in — a keyboard-driven quarter-turn that still works while
   * mouse-looking (steps=+1 turns right/clockwise, -1 turns left). Purely
   * changes the CAMERA; grid movement then just follows since it reads
   * getFacingZone() live.
   */
  turnCameraSnap(steps) {
    if (this._lookYaw === undefined) return;
    const currentIdx = FACING_BY_QUADRANT.indexOf(nearestFacingFromYaw(this._lookYaw));
    const targetZone = FACING_BY_QUADRANT[(currentIdx + steps + FACING_BY_QUADRANT.length) % FACING_BY_QUADRANT.length];
    this._yawSnapTarget = FACING_ANGLES[targetZone];
  }

  /** True if this renderer's canvas currently holds Pointer Lock. */
  isPointerLocked() {
    return !!this.canvas && document.pointerLockElement === this.canvas;
  }

  /** Releases Pointer Lock if this renderer's canvas currently holds it — no-op otherwise (e.g. already unlocked). */
  releasePointerLock() {
    if (this.isPointerLocked()) document.exitPointerLock();
  }

  /**
   * Best-effort re-engage of Pointer Lock — used by ExploreState to
   * resume mouse-look after an event (chest/door/room, combat, descend)
   * that was interrupted by one. Browsers only grant Pointer Lock from
   * within a live user-gesture call stack (a click/keydown handler), so
   * this reliably succeeds when called synchronously from one (e.g. the
   * "Close"/card-pick click that ends an event) but may silently no-op
   * when called from a fully automatic transition (e.g. right after
   * combat auto-resolves with no click involved) — the "click to enable"
   * hint is always there as the fallback either way, so a failed attempt
   * here is harmless.
   */
  requestPointerLockIfPossible() {
    if (!this.canvas || this.isPointerLocked()) return;
    this.canvas.requestPointerLock?.();
  }

  /** Transient camera-position jitter for `durationMs`, applied every frame in _applyCameraFromCurrentState — see the hidden-boss encounter trigger in ExploreState. */
  triggerShake(durationMs, magnitude) {
    this._shakeUntil = performance.now() + durationMs;
    this._shakeMagnitude = magnitude;
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

  /**
   * Reads the live Camera Height setting, the mouse-driven look yaw/pitch,
   * and the smoothed player position, and applies the resulting
   * position/up/lookAt to the camera — called every frame. Driving both
   * position and up off the SAME `_lookYaw`/`_lookPitchDeg` keeps them in
   * lockstep (no wobble), and computing the camera's offset from an angle
   * (rather than lerping two Cartesian points) makes it trace a true
   * constant-radius arc around the player instead of cutting a chord
   * through its orbit circle. No-ops until the first setPlayerState() call
   * has established a starting yaw/position to compute from.
   */
  _applyCameraFromCurrentState() {
    if (this._lookYaw === undefined) return;
    const settings = this.app?.gameState?.settings ?? {};
    const heightMult = clamp(settings.cameraHeight ?? DEFAULT_CAMERA_HEIGHT_MULT, CAMERA_HEIGHT_MULT_MIN, CAMERA_HEIGHT_MULT_MAX);
    const angleRad = (this._lookPitchDeg * Math.PI) / 180;
    // horizontal shrinks to 0 as pitch approaches 90deg (camera moves directly
    // overhead); height is fully independent, purely from the height setting.
    const horizontal = CAMERA_HORIZONTAL_OFFSET * Math.cos(angleRad);
    const height = CAMERA_HEIGHT_BASE * heightMult;

    // (sin, 0, -cos) of the current look yaw — matches FACING_VECTORS
    // exactly at the 4 cardinal angles, but varies continuously in between
    // since yaw is now mouse-driven and unbounded, not tied to run.facing.
    this._facingVec.set(Math.sin(this._lookYaw), 0, -Math.cos(this._lookYaw));

    this._lookAtPos.set(this.currentPlayerPos.x, LOOK_AT_HEIGHT + CAMERA_LOOK_LIFT, this.currentPlayerPos.z);
    this._cameraPos.copy(this.currentPlayerPos).addScaledVector(this._facingVec, -horizontal);
    this._cameraPos.y += height;

    // Screen shake (see triggerShake) — a transient random jitter added to
    // the camera's position only, never its look-at target, so it reads as
    // a genuine wobble around the player rather than a whip-pan.
    if (this._shakeUntil && performance.now() < this._shakeUntil) {
      this._cameraPos.x += (Math.random() - 0.5) * this._shakeMagnitude;
      this._cameraPos.y += (Math.random() - 0.5) * this._shakeMagnitude;
      this._cameraPos.z += (Math.random() - 0.5) * this._shakeMagnitude;
    }

    // At pitch=90 the view direction is exactly vertical, which makes the
    // default (0,1,0) up-vector parallel to it — a degenerate case where
    // lookAt() can't determine roll, so the screen silently stops rotating
    // with yaw. Blending up toward facingVec as pitch approaches 90 fixes
    // that (and, as a bonus, makes bird's-eye view a proper heading-up
    // rotation, matching the minimap's own convention) while leaving
    // pitch=0 exactly as before (cos(0)=1, sin(0)=0 — pure worldUp).
    this.camera.up.set(0, Math.cos(angleRad), 0).addScaledVector(this._facingVec, Math.sin(angleRad)).normalize();

    this.camera.position.copy(this._cameraPos);
    this.camera.lookAt(this._lookAtPos);
  }

  /**
   * Smoothly tweens player position toward its latest target, then
   * (re)applies the camera every frame — both for live setting changes
   * (Camera Height) and because mouse-look yaw/pitch change continuously,
   * not just on movement. Also re-derives which wall (if any) sits between
   * the camera and the player from the camera's CURRENT orbit position —
   * unlike grid movement/turning, mouse-look isn't tile-discrete, so this
   * can't just run once per move like updateVisibility() does.
   */
  update(dt) {
    const tweenT = 1 - Math.exp(-TWEEN_SPEED * dt);
    this.currentPlayerPos.lerp(this.desiredPlayerPos, tweenT);
    // Pointer Lock freezes/hides the OS cursor, which would make the pause
    // menu unclickable — release it the instant the game pauses; the hint
    // overlay reappears via the pointerlockchange listener in mount().
    if (this.app?.gameState?.paused) this.releasePointerLock();
    // Arrow-key quick-turn tween (see turnCameraSnap) — mouse movement
    // clears _yawSnapTarget immediately, so this only ever runs when
    // nothing has manually overridden it since the key was pressed.
    if (this._yawSnapTarget !== undefined) {
      this._lookYaw += shortestAngleDelta(this._lookYaw, this._yawSnapTarget) * tweenT;
    }
    this._applyCameraFromCurrentState();
    this.playerSprite.position.set(this.currentPlayerPos.x, PLAYER_HEIGHT, this.currentPlayerPos.z);
    if (this._playerGridX !== undefined) {
      this._applyBehindWallOcclusion(this._playerGridX, this._playerGridY, nearestFacingFromYaw(this._lookYaw));
    }
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

    const tilesByKey = new Map(dungeon.tiles.map((t) => [tileKey(t.x, t.y), t]));

    dungeon.tiles.forEach((tile) => {
      const worldX = tile.x * TILE_SIZE;
      const worldZ = tile.y * TILE_SIZE;

      if (tile.type === TILE_TYPES.WALL) {
        const walls = [];
        CARDINAL_DIRS.forEach(({ dx, dy, side }) => {
          const neighbor = tilesByKey.get(tileKey(tile.x + dx, tile.y + dy));
          if (!neighbor || neighbor.type === TILE_TYPES.WALL) return; // no panel toward another wall or off-grid
          const isNS = side === 'north' || side === 'south';
          const panel = new THREE.Mesh(isNS ? this._geo.wallPanelNS : this._geo.wallPanelEW, this._mat.wallByDist[VISIBLE_RADIUS]);
          panel.position.set(
            worldX + (dx * TILE_SIZE) / 2,
            WALL_HEIGHT / 2,
            worldZ + (dy * TILE_SIZE) / 2,
          );
          this.dungeonGroup.add(panel);
          walls.push({ mesh: panel, dx, dy });
        });
        this.tileMeshes.set(tileKey(tile.x, tile.y), { walls, type: TILE_TYPES.WALL });
        return;
      }

      const floor = new THREE.Mesh(this._geo.floor, this._mat.floorByDist[VISIBLE_RADIUS]);
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
    // A resolved chest/door (already opened — see ExploreState.handleTileEffect's
    // meta.resolved gate) is functionally inert; skip its marker so a
    // restored/continued run doesn't show a chest that no longer does
    // anything when walked onto.
    if (tile.meta?.resolved) return;
    const markerMats = this._mat.markerByDist[tile.type];
    if (!markerMats || entry.marker) return;
    let geo = this._geo.marker;
    let height = TILE_SIZE * 0.3;
    if (tile.type === TILE_TYPES.STAIRS) {
      geo = this._geo.stairsMarker;
      height = TILE_SIZE * 0.15;
    } else if (tile.type === TILE_TYPES.ENEMY) {
      geo = this._geo.enemyCube;
      height = TILE_SIZE * 0.4;
    } else if (tile.type === TILE_TYPES.TEMPORAL_CHEST) {
      // A genuine cube (per user request "make it a blue cube"), not the
      // flatter default marker block used for STAIRS/LOCKED_DOOR/TREASURE.
      geo = this._geo.enemyCube;
      height = TILE_SIZE * 0.4;
    } else if (tile.type === TILE_TYPES.HIDDEN_ENEMY) {
      // Pure black cube — deliberately reads as an anomaly against the
      // dark-but-not-black dungeon palette, for a player who's already
      // gone looking somewhere the game gives them no other reason to.
      geo = this._geo.enemyCube;
      height = TILE_SIZE * 0.4;
    }
    const marker = new THREE.Mesh(geo, markerMats[VISIBLE_RADIUS]);
    marker.position.set(tile.x * TILE_SIZE, height, tile.y * TILE_SIZE);
    this.dungeonGroup.add(marker);
    entry.marker = marker;
  }

  /**
   * Recomputes every tile's visibility from the player's current grid
   * position: each integer distance 0..VISIBLE_RADIUS has its own
   * precomputed material (see visibilityStrength above), so the fade reads
   * as continuous per-tile rather than a few discrete bands; anything
   * beyond VISIBLE_RADIUS is hidden entirely. Walls/floor fade by shifting
   * color toward the background while staying fully opaque; markers fade
   * via transparency instead. Runs on every move — this is live sight, not
   * a permanent "once seen" reveal.
   */
  updateVisibility(px, py) {
    this.tileMeshes.forEach((entry, key) => {
      const [txStr, tyStr] = key.split(',');
      const dist = Math.max(Math.abs(Number(txStr) - px), Math.abs(Number(tyStr) - py));
      const visible = dist <= VISIBLE_RADIUS;
      const distIdx = Math.min(dist, VISIBLE_RADIUS);

      if (entry.walls) {
        const mat = this._mat.wallByDist[distIdx];
        entry.walls.forEach(({ mesh }) => {
          mesh.visible = visible;
          mesh.material = mat;
        });
        return;
      }
      entry.floor.visible = visible;
      entry.floor.material = this._mat.floorByDist[distIdx];
      if (entry.marker) {
        entry.marker.visible = visible;
        entry.marker.material = this._mat.markerByDist[entry.type]?.[distIdx];
      }
    });
  }

  /**
   * A wall directly behind the CAMERA's current view (one tile opposite of
   * wherever the mouse has it looking, not necessarily run.facing anymore)
   * can land right on the camera-to-player line and hide the character
   * sprite. Widen the see-through window to 3 tiles — directly behind, plus
   * the two tiles flanking it one step to each side — so there's a clear
   * gap around the character instead of a single narrow slit.
   *
   * Called every frame from update() (mouse-look isn't tile-discrete, so
   * the occluded set can change between any two frames even with no
   * movement at all) — first restores whatever was overridden last frame
   * back to its normal distance-tiered material, then computes and applies
   * the new set for `facing` (the cardinal direction nearest the camera's
   * current yaw). A real grid move/turn still resets everything through
   * updateVisibility() first, same as before; this restore step covers the
   * in-between frames that updateVisibility() no longer does.
   */
  _applyBehindWallOcclusion(px, py, facing) {
    this._lastOccludedWalls.forEach(({ mesh, tileX, tileY }) => {
      const dist = Math.max(Math.abs(tileX - px), Math.abs(tileY - py));
      mesh.material = this._mat.wallByDist[Math.min(dist, VISIBLE_RADIUS)];
    });
    this._lastOccludedWalls = [];

    const facingVec = FACING_VECTORS[facing] ?? FACING_VECTORS.south;
    // Perpendicular to facing (rotate the facing vector ±90° on the ground plane).
    const perpA = { x: facingVec.z, z: -facingVec.x };
    const perpB = { x: -facingVec.z, z: facingVec.x };
    const behindX = px - facingVec.x;
    const behindY = py - facingVec.z;

    // Directly behind: only the one panel that actually faces the player.
    const behindEntry = this.tileMeshes.get(tileKey(behindX, behindY));
    const centerPanel = behindEntry?.walls?.find((w) => w.dx === facingVec.x && w.dy === facingVec.z);
    if (centerPanel) {
      centerPanel.mesh.material = this._mat.behindWall;
      this._lastOccludedWalls.push({ mesh: centerPanel.mesh, tileX: behindX, tileY: behindY });
    }

    // The two flanking tiles: make all of their panels transparent, since
    // they aren't cardinally adjacent to the player so there's no single
    // "faces the player" panel to pick out.
    [perpA, perpB].forEach((perp) => {
      const tx = behindX + perp.x;
      const ty = behindY + perp.z;
      const sideEntry = this.tileMeshes.get(tileKey(tx, ty));
      sideEntry?.walls?.forEach(({ mesh }) => {
        mesh.material = this._mat.behindWall;
        this._lastOccludedWalls.push({ mesh, tileX: tx, tileY: ty });
      });
    });
  }

  /**
   * Sets the player's next tween target (position lerps toward it in
   * update()) and recomputes tile visibility immediately (visibility is
   * tile-discrete, not tweened). The camera itself is fully mouse-driven
   * now (see _lookYaw/_lookPitchDeg) and no longer tracks `facing` at
   * all — `facing` here only matters for (a) seeding the camera's
   * starting look direction on the very first call, so a fresh floor
   * still opens with the character in view, and (b) grid movement/turn
   * logic elsewhere (ExploreState), which is unaffected by any of this.
   * On the very first call, snaps instantly instead of tweening in from
   * the origin.
   */
  setPlayerState({ x, y, facing }) {
    this.updateVisibility(x, y);
    this._playerGridX = x;
    this._playerGridY = y;

    this.desiredPlayerPos.set(x * TILE_SIZE, 0, y * TILE_SIZE);

    if (!this._playerStateInitialized) {
      this._playerStateInitialized = true;
      this.currentPlayerPos.copy(this.desiredPlayerPos);
      this._lookYaw = FACING_ANGLES[facing] ?? FACING_ANGLES.south;
      this._applyCameraFromCurrentState();
      this.playerSprite.position.set(this.currentPlayerPos.x, PLAYER_HEIGHT, this.currentPlayerPos.z);
    }
  }

  unmount() {
    if (this._rafId) cancelAnimationFrame(this._rafId);
    if (this._onResize) window.removeEventListener('resize', this._onResize);
    if (this._onCanvasClick) this.canvas?.removeEventListener('click', this._onCanvasClick);
    if (this._onPointerLockChange) document.removeEventListener('pointerlockchange', this._onPointerLockChange);
    if (this._onMouseMove) document.removeEventListener('mousemove', this._onMouseMove);
    if (document.pointerLockElement === this.canvas) document.exitPointerLock();
    if (this._hintHideTimeout) clearTimeout(this._hintHideTimeout);
    this._hintEl?.remove();
    Object.values(this._geo ?? {}).forEach((g) => g.dispose());
    // _mat holds a mix of shapes: plain materials (behindWall), flat arrays
    // indexed by distance (floorByDist/wallByDist), and nested per-type
    // arrays of arrays (markerByDist) — recurse until something disposable
    // is found rather than assuming a fixed depth.
    const disposeDeep = (value) => {
      if (!value) return;
      if (typeof value.dispose === 'function') value.dispose();
      else Object.values(value).forEach(disposeDeep);
    };
    disposeDeep(this._mat);
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
