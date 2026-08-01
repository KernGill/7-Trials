import * as THREE from '../vendor/three/three.module.js';
import { TILE_TYPES } from './Tile.js';
import { clamp } from '../utils/MathUtils.js';
import { t } from '../ui/i18n.js';
import {
  CAMERA_ANGLE_MIN, CAMERA_ANGLE_MAX, CAMERA_HEIGHT_MIN_PERCENT, CAMERA_HEIGHT_MAX_PERCENT,
  DEFAULT_CAMERA_ANGLE, DEFAULT_CAMERA_HEIGHT, DEFAULT_CAMERA_SENSITIVITY_PERCENT, DEFAULT_CAMERA_ZOOM_PERCENT,
  linkedHeightPercentForAngle, zoomMultiplierForPercent, autoFovPercentForAngle,
} from '../ui/CameraSettings.js';

const BACKGROUND_COLOR = 0x0b0c10;
const VIEW_HEIGHT = 10; // world units of vertical span visible in the ortho frustum

const TILE_SIZE = 2;
const WALL_HEIGHT = TILE_SIZE * 12; // tall enough that the top edge is never visible in frame
const WALL_THICKNESS = TILE_SIZE * 0.1; // thin panel, not a full-tile block
// A BoxGeometry side face is just 4 corner vertices by default — with no
// intermediate vertices, the GPU can only ever draw a single straight-line
// blend between whatever color sits at the bottom and whatever sits at the
// top, no matter what curve/span was actually computed. So both the
// ambient wall panels (wallPanelNS/EW, ordinary ambient light) and the
// torch-lit ones (torchWallBaseNS/EW, createTorchWallGeometry/
// writeTorchWallGeometryColors — a finer subdivision since it also needs
// to bake real per-band hue shifts, not just a grayscale multiplier) are
// built with real intermediate rows of vertices so
// applyWallHeightGradient's span/curve actually shows up.
const WALL_HEIGHT_SEGMENTS = 8;
const TORCH_WALL_SEGMENTS = 10;
// How far up from the floor the vertical shading gradient travels before
// settling at its dimmest value. Per user request, this is deliberately
// shorter than the full WALL_HEIGHT (was the entire panel) so the fade to
// dark completes a bit sooner instead of still being mid-transition
// wherever the camera happens to be looking.
const WALL_HEIGHT_GRADIENT_SPAN = WALL_HEIGHT * 0.65;
const WALL_HEIGHT_BRIGHTNESS_TOP = 0.08; // vertex-color multiplier at/above the gradient span — low enough to read as a clear dark cap even against a warm torch hue

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

// Tile visibility is a live radius around the player, recomputed every
// frame from the player's actual (continuous, tweened) world position —
// not a persistent "once seen, always shown" memory, and not pinned to
// whatever grid tile the player last stood on — using true Euclidean
// (radial) distance so it reads as a genuine circle of light centered on
// Artius herself, not square rings stepped out from a tile origin. This
// also means the light already tracks smoothly through the movement
// tween today, and will keep working unchanged once free (non-grid-
// locked) movement lands. Each material is still precomputed per
// INTEGER distance (0..VISIBLE_RADIUS, or 0..TORCH_VISIBLE_RADIUS — see
// visibilityStrength/torchVisibilityStrength below) since a continuous
// distance would need one material per tile per frame; the live radial
// distance is rounded to the nearest of those precomputed steps to pick
// a material, while the visible/not-visible cutoff itself still uses the
// unrounded distance, so the outer edge of the circle stays smooth
// rather than snapping to whichever ring rounds closest. Every
// individual tile distance still gets its own point on a smooth
// continuous falloff curve rather than a handful of discrete bands, so
// the fade reads as gradual rather than stepped; anything past
// VISIBLE_RADIUS isn't rendered at all — true darkness.
//
// Walls/floor stay fully OPAQUE at every distance — they fade by blending
// their color toward the background color instead, so a distant wall
// still fully occludes what's behind it (no see-through). Markers (the
// actual objects on a tile) are the opposite: they stay transparent,
// fading via opacity instead of color.
const VISIBLE_RADIUS = 9; // max distance (tiles) anything renders at all — +2 over the original 7, per user request: bird's-eye camera angles already give away too much, so ground-level play needed a bit more reach to compensate
// >1 keeps the falloff gentle for the first few tiles and steep from
// ~5 tiles out — visibilityStrength(5..7) drops off much faster than
// visibilityStrength(0..4) does, matching "hard to see from 5 onward".
const VISIBILITY_FALLOFF_POWER = 2.5;
// Bumped up from 0.45/0.15 — per user request the un-torched view should
// read as "a little brighter" overall, on top of the moonlight hue shift
// below (moonHue) doing most of the actual visual lift near the player.
const MAX_FLOOR_KEEP = 0.62; // floor color-keep fraction at distance 0 (rest blended to background) — floor stays legible as "the path"
// Per user request: was 0.28, which read as noticeably darker/muddier than
// the floor right next to it at the same distance — matched to
// MAX_FLOOR_KEEP so a wall and the floor tile it borders land on the same
// base color before the per-vertex height gradient (see
// WALL_HEIGHT_GRADIENT_SPAN) darkens the wall going up.
const MAX_WALL_KEEP = MAX_FLOOR_KEEP;
const MAX_MARKER_OPACITY = 1; // marker opacity at distance 0

// Ambient (no Torch) lighting reads as pale moonlight falling on whatever's
// closest to the player, fading through a series of increasingly dark,
// desaturated blues the farther a tile sits, finally dissolving into the
// same near-black BACKGROUND_COLOR everything else fades to — see moonHue()
// below, the un-torched equivalent of torchHue() above.
const MOON_COLOR_NEAR = 0xc3ecf7; // white/grey/blue moonlight spotlight, right at the player
const MOON_COLOR_STEP2 = 0x87b8d4; // desaturated light navy blue
const MOON_COLOR_STEP3 = 0x84acb8; // slightly desaturated darkish blue
const MOON_COLOR_STEP4 = 0x2f5561; // really dark blue
const MOON_COLOR_FAR = 0x000000; // black — full darkness, right at the edge of sight

// "Vanguard calling" effect: once floor 5's hidden gate has opened (every
// enemy dead, every event looted) and Vanguard of Darkness hasn't been
// beaten yet THIS run (see ExploreState.checkHiddenGateUnlock /
// StateManager's run.vanguardDefeated), floor and walls both stop using
// their normal continuous distance gradient — per user request, meant to
// read as "your own radiating moonlight is barely holding back the dark."
// Ends the instant Vanguard is defeated or the player leaves floor 5 (see
// updateVisibility()'s vanguardCalling check). The two surfaces get
// deliberately different treatments:
// - Walls: flat/binary, no blend — MOON_COLOR_NEAR within
//   VANGUARD_CALLING_WALL_NEAR_RADIUS tiles, MOON_COLOR_FAR beyond it —
//   using the normal visibility cutoff/radius, nothing shrinks here.
// - Floor: a much tighter, steeper gradient than usual (fades from
//   MOON_COLOR_NEAR at dist 0 to fully black by
//   VANGUARD_CALLING_FLOOR_GRADIENT_RADIUS tiles out, via
//   VANGUARD_CALLING_FLOOR_FALLOFF_POWER — steeper than the normal ambient
//   VISIBILITY_FALLOFF_POWER) PLUS simply not rendering at all past
//   VANGUARD_CALLING_FLOOR_VISIBLE_RADIUS, a much tighter cutoff than the
//   normal VISIBLE_RADIUS, so the ground itself seems to be swallowed by
//   the dark a few steps out rather than just changing color.
const VANGUARD_CALLING_WALL_NEAR_RADIUS = 2;
const VANGUARD_CALLING_FLOOR_GRADIENT_RADIUS = 2;
const VANGUARD_CALLING_FLOOR_VISIBLE_RADIUS = 3;
const VANGUARD_CALLING_FLOOR_FALLOFF_POWER = 4;

// Reused across every moonHue/torchHue/blendColor call instead of a fresh
// `new THREE.Color(...)` per call (these run per visible floor tile, per
// visible ambient wall panel, AND per vertex of every visible torch wall
// panel, every single frame — real GC pressure at scale). Safe to share
// module-wide: every call's result is fully consumed (an immediate
// `.copy()` into a persistent material color, or `.setXYZ()` into a vertex
// buffer) before the next call reuses these same objects — JS is single-
// threaded and nothing here is async, so nothing ever holds a reference
// across calls. This changes ONLY the allocation strategy — the underlying
// distance math stays exactly continuous/unrounded, per updateVisibility()'s
// doc comment on why bucketing floor/wall colors was deliberately rejected.
const _hueOut = new THREE.Color();
const _hueLerpTarget = new THREE.Color();
const _blendTarget = new THREE.Color();

/** Ambient equivalent of torchHue(): pale moonlight near, fading through five color stops (moonlight -> light navy -> darkish blue -> really dark blue -> black) across four equal quarter-segments of the visible radius — no background blending yet (see blendColor for that half, applied on top via MAX_FLOOR_KEEP/MAX_WALL_KEEP same as before). Mutates and returns the shared `_hueOut` scratch (see comment above) instead of allocating. */
function moonHue(dist) {
  const t = clamp(dist / VISIBLE_RADIUS, 0, 1);
  if (t < 0.25) return _hueOut.setHex(MOON_COLOR_NEAR).lerp(_hueLerpTarget.setHex(MOON_COLOR_STEP2), t / 0.25);
  if (t < 0.5) return _hueOut.setHex(MOON_COLOR_STEP2).lerp(_hueLerpTarget.setHex(MOON_COLOR_STEP3), (t - 0.25) / 0.25);
  if (t < 0.75) return _hueOut.setHex(MOON_COLOR_STEP3).lerp(_hueLerpTarget.setHex(MOON_COLOR_STEP4), (t - 0.5) / 0.25);
  return _hueOut.setHex(MOON_COLOR_STEP4).lerp(_hueLerpTarget.setHex(MOON_COLOR_FAR), (t - 0.75) / 0.25);
}

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

// Torch equipped (offHand === 'torch' — see DungeonRenderer3D._hasTorchEquipped):
// sees TORCH_EXTRA_RADIUS tiles further than normal, and the fade itself
// reads as actual firelight (warm yellow up close, through orange, to a
// dying red at the edge of its reach) instead of the plain grey-to-black
// blend everyone else gets. A larger set of precomputed per-distance
// marker materials (torchMarkerByDist — see the constructor) exists
// purely so markers never need to rebuild anything at runtime; floor and
// walls both compute their own color live every frame instead of picking
// from a precomputed set at all (see updateVisibility()'s doc comment) —
// for walls that means writing a real per-band GEOMETRY color (see
// writeTorchWallGeometryColors) since climbing one needs a height
// component too, not just a flat hue.
// updateVisibility() picks which set to index into (or which hue/keep
// function/geometry-write to use, for floor/walls) based on current
// equipment, every frame.
const TORCH_EXTRA_RADIUS = 3;
const TORCH_VISIBLE_RADIUS = VISIBLE_RADIUS + TORCH_EXTRA_RADIUS;
const TORCH_COLOR_NEAR = 0xffe066; // warm yellow, right at the flame
const TORCH_COLOR_MID = 0xff8c1a; // orange
const TORCH_COLOR_FAR = 0xe61400; // ember red, right before the torch's own reach gives out — per user request, pushed even further red/saturated than the prior 0xd4220a
const TORCH_FLOOR_KEEP = 0.75; // brighter than MAX_FLOOR_KEEP — floor should read as genuinely lit, not just "less dark"
const TORCH_WALL_KEEP = 0.85; // was 0.4 — that blended 60% of even the closest wall's hue toward near-black background, reading as muted brown instead of the saturated yellow/orange/red the torch is supposed to look like
// Per user request: yellow should hold about 1 tile longer than before
// (was fully orange by t=0.2, i.e. dist 2.4 — now dist ~3.4) before
// starting its climb into orange.
const TORCH_HUE_YELLOW_END_T = 0.28;
// Per user request: orange should finish turning into red well before the
// light "begins darkening too much" (i.e. while torchVisibilityStrength is
// still reasonably high, not right at the torch's fading-out edge) — so
// red is reached well before t=1 (the very edge, already near-black from
// the brightness falloff) instead of only there. Combined with
// TORCH_HUE_YELLOW_END_T, orange's own share of the curve (YELLOW_END_T -
// ORANGE_END_T) is now much shorter than the original single-midpoint
// version. Bumped +1 tile since (was 0.5/dist 6, now dist 7) per a
// follow-up "make the orange 1 tile longer" request. Past this point the
// hue itself no longer changes — from here to the edge it's pure
// TORCH_COLOR_FAR, with the actual fade to black entirely down to
// torchVisibilityStrength's falloff (see updateVisibility()/
// writeTorchWallGeometryColors's blendColor calls).
const TORCH_HUE_ORANGE_END_T = 0.58;

/** Torch-equipped equivalent of visibilityStrength, using the torch's own (larger) radius as the falloff's basis. */
function torchVisibilityStrength(dist) {
  const t = clamp(dist / (TORCH_VISIBLE_RADIUS + 1), 0, 1);
  return (1 - t) ** VISIBILITY_FALLOFF_POWER;
}

/** Pure flame hue at a torch-relative distance — yellow near, through orange, to red by the reach's midpoint, then held at red the rest of the way out — with no background blending yet (see blendColor for that half). Mutates and returns the shared `_hueOut` scratch (see comment above moonHue) instead of allocating. */
function torchHue(dist) {
  const t = clamp(dist / TORCH_VISIBLE_RADIUS, 0, 1);
  if (t < TORCH_HUE_YELLOW_END_T) return _hueOut.setHex(TORCH_COLOR_NEAR).lerp(_hueLerpTarget.setHex(TORCH_COLOR_MID), t / TORCH_HUE_YELLOW_END_T);
  if (t < TORCH_HUE_ORANGE_END_T) {
    return _hueOut.setHex(TORCH_COLOR_MID).lerp(
      _hueLerpTarget.setHex(TORCH_COLOR_FAR),
      (t - TORCH_HUE_YELLOW_END_T) / (TORCH_HUE_ORANGE_END_T - TORCH_HUE_YELLOW_END_T),
    );
  }
  return _hueOut.setHex(TORCH_COLOR_FAR);
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
// SpriteMaterial is unlit, so unlike every tile mesh (which dims with
// distance via blendColor) the player sprite would otherwise always render
// at full, un-dimmed brightness — and since it always sits at distance 0,
// right in front of the camera, that made it look glaringly bright next to
// the tiles around it. Flat tint, not a fade: there's no "distance" for the
// sprite to fade over.
const PLAYER_SPRITE_BRIGHTNESS = 0.75;

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

// Floor/wall ambient color now comes from moonHue() (see above) instead of a
// flat constant — COLOR_WALL survives only for the flat behindWall overlay
// below, which isn't distance-graded.
const COLOR_WALL = 0x3a3a3a; // walls had no prior color — they were invisible blank cells in the old grid
const MARKER_COLORS = {
  [TILE_TYPES.ENEMY]: 0x7a1f1f,
  [TILE_TYPES.STAIRS]: 0x7a5c1f,
  [TILE_TYPES.LOCKED_DOOR]: 0x3a1f7a,
  [TILE_TYPES.TREASURE]: 0x7a6a1f,
  [TILE_TYPES.TEMPORAL_CHEST]: 0x1f5fd9,
  [TILE_TYPES.HIDDEN_ENEMY]: 0x000000,
  [TILE_TYPES.ELEVATOR]: 0x2ecc71,
  [TILE_TYPES.VENDOR]: 0xd4af37, // gold — reads as a distinct "shop" landmark against the elevator's green
};

function tileKey(x, y) {
  return `${x},${y}`;
}

/**
 * Blends `color` toward `towardHex`, keeping `keepFraction` of the original.
 * Mutates `color` IN PLACE (via `.lerp`) and returns it — every real call
 * site passes the just-computed moonHue()/torchHue() result (itself the
 * shared `_hueOut` scratch, never an independent object — see the comment
 * above moonHue), so there's nothing left to allocate here either.
 */
function blendColor(color, keepFraction, towardHex) {
  return color.lerp(_blendTarget.setHex(towardHex), 1 - keepFraction);
}

/**
 * Stamps a vertical brightness ramp onto a wall panel geometry's vertex
 * colors — full brightness at floor height (local Y = -WALL_HEIGHT/2),
 * fading to `brightnessTop` by `span` units up. This is a per-vertex
 * *multiplier* layered on top of whatever flat distance/torch color the
 * panel's material already resolves to (the material must set
 * vertexColors:true to pick it up) — it's what makes light read as coming
 * from roughly waist height rather than washing the whole (very tall — see
 * WALL_HEIGHT) panel evenly. Geometry is shared across every wall mesh
 * using it, so this only ever needs to run once per geometry — see mount(),
 * which calls it once for the ambient wall geometries and once more (with a
 * steeper span) for the torch-lit ones.
 */
function applyWallHeightGradient(geometry, span, brightnessTop) {
  const position = geometry.attributes.position;
  const colors = new Float32Array(position.count * 3);
  for (let i = 0; i < position.count; i += 1) {
    const heightFromFloor = position.getY(i) + WALL_HEIGHT / 2;
    const t = clamp(heightFromFloor / span, 0, 1);
    // sqrt, not linear: darkens faster over the first few tile-heights so
    // the typical camera framing (which sits well above floor level, not
    // right at it) lands mid-transition instead of near the flat top end.
    const brightness = 1 - Math.sqrt(t) * (1 - brightnessTop);
    colors[i * 3] = brightness;
    colors[i * 3 + 1] = brightness;
    colors[i * 3 + 2] = brightness;
  }
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
}

/**
 * Clones a torch-lit wall panel's base shape (must already have
 * heightSegments = TORCH_WALL_SEGMENTS — see torchWallBaseNS/EW in
 * mount() — giving TORCH_WALL_SEGMENTS+1 rows of vertices evenly spaced
 * from floor to ceiling) and gives the clone its own private 'color'
 * attribute for writeTorchWallGeometryColors to fill in every frame. One
 * clone per wall panel (see setDungeon()) rather than a shared bucket —
 * each panel's own live, unrounded distance needs to be able to shift its
 * baked colors independently and continuously as the player moves, the
 * same reasoning as the floor's per-tile material (see updateVisibility()'s
 * floor-color comment). Initial values don't matter; the first
 * updateVisibility() call overwrites them before a frame ever renders.
 */
function createTorchWallGeometry(baseGeometry) {
  const geometry = baseGeometry.clone();
  const colors = new Float32Array(geometry.attributes.position.count * 3);
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  return geometry;
}

/**
 * Bakes a torch-lit wall panel's FULL final color (not a multiplier — the
 * material for these is plain white, see torchWallMaterial) directly into
 * `geometry`'s vertex colors, one real point on the curve per band. Band 0
 * (the floor row) gets exactly this tile's normal distance color —
 * torchHue(dist) blended toward the background, the same formula the flat
 * floor/wall materials already use — and each band above it adds one more
 * *virtual* tile of distance to that same formula. That's the trick:
 * climbing the wall now fades along the exact same yellow -> orange -> red
 * -> background curve that walking farther down the hall already does, so
 * a near (yellow) wall's 2nd band up reads as the "3 tiles away" hue, a
 * mid (orange) wall's climbs into red, and a far (red) wall fades to
 * background-black almost immediately — and because each band is a real
 * vertex with a real computed color (not just two endpoints with a
 * straight blend between them), the curve's actual shape shows up instead
 * of a single flat linear ramp. `dist` is the tile's own exact, unrounded
 * radial distance (see updateVisibility()) — not rounded to an integer
 * tier — so climbing a wall AND walking toward one both animate along the
 * exact same continuous curve, with no banding either way.
 */
function writeTorchWallGeometryColors(geometry, dist) {
  const position = geometry.attributes.position;
  const color = geometry.attributes.color;
  const segmentHeight = WALL_HEIGHT / TORCH_WALL_SEGMENTS;
  for (let i = 0; i < position.count; i += 1) {
    const heightFromFloor = position.getY(i) + WALL_HEIGHT / 2;
    const band = Math.round(heightFromFloor / segmentHeight);
    const effectiveDist = dist + band;
    const c = blendColor(
      torchHue(effectiveDist),
      TORCH_WALL_KEEP * torchVisibilityStrength(effectiveDist),
      BACKGROUND_COLOR,
    );
    color.setXYZ(i, c.r, c.g, c.b);
  }
  color.needsUpdate = true;
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
    const spriteMaterial = new THREE.SpriteMaterial({
      map: new THREE.TextureLoader().load(spriteUrl),
      color: new THREE.Color().setScalar(PLAYER_SPRITE_BRIGHTNESS),
    });
    this.playerSprite = new THREE.Sprite(spriteMaterial);
    this.playerSprite.scale.set(TILE_SIZE, TILE_SIZE, 1);
    this.scene.add(this.playerSprite);

    // Shared geometries/materials, reused across every tile mesh —
    // cheap to keep alive for the renderer's lifetime, disposed in unmount().
    // Walls/floor fade purely by color (toward the background, staying
    // opaque — see MAX_FLOOR_KEEP / MAX_WALL_KEEP above); markers fade via
    // transparency instead. One material per integer distance
    // (0..VISIBLE_RADIUS) is precomputed here so updateVisibility() can
    // just index into it every frame, rather than allocating per-frame.
    this._geo = {
      floor: new THREE.PlaneGeometry(TILE_SIZE, TILE_SIZE),
      // Thin panels, not full-tile blocks — see CARDINAL_DIRS comment above.
      // wallPanelNS spans the tile's width, wallPanelEW spans its depth;
      // both are only WALL_THICKNESS deep in the direction they face.
      // heightSegments = WALL_HEIGHT_SEGMENTS — see that constant's comment.
      wallPanelNS: new THREE.BoxGeometry(TILE_SIZE, WALL_HEIGHT, WALL_THICKNESS, 1, WALL_HEIGHT_SEGMENTS, 1),
      wallPanelEW: new THREE.BoxGeometry(WALL_THICKNESS, WALL_HEIGHT, TILE_SIZE, 1, WALL_HEIGHT_SEGMENTS, 1),
      marker: new THREE.BoxGeometry(TILE_SIZE * 0.5, TILE_SIZE * 0.25, TILE_SIZE * 0.5),
      stairsMarker: new THREE.BoxGeometry(TILE_SIZE * 0.6, TILE_SIZE * 0.075, TILE_SIZE * 0.6),
      // Enemy tiles get their own plain cube for now (placeholder, per design).
      enemyCube: new THREE.BoxGeometry(TILE_SIZE * 0.8, TILE_SIZE * 0.8, TILE_SIZE * 0.8),
    };
    applyWallHeightGradient(this._geo.wallPanelNS, WALL_HEIGHT_GRADIENT_SPAN, WALL_HEIGHT_BRIGHTNESS_TOP);
    applyWallHeightGradient(this._geo.wallPanelEW, WALL_HEIGHT_GRADIENT_SPAN, WALL_HEIGHT_BRIGHTNESS_TOP);
    // Torch-equipped wall geometry template — heightSegments =
    // TORCH_WALL_SEGMENTS (finer than WALL_HEIGHT_SEGMENTS) since climbing
    // a torch-lit wall needs to trace the same curve real distance does
    // (see writeTorchWallGeometryColors), not just fade toward one flat
    // dark cap the way the ambient height gradient does. Kept around (not
    // disposed) purely as a clone source: setDungeon() clones one of these
    // per wall panel via createTorchWallGeometry, since every panel needs
    // its own live-mutable copy — see updateVisibility()'s wall-color
    // comment for why a shared/precomputed set doesn't work here.
    this._geo.torchWallBaseNS = new THREE.BoxGeometry(TILE_SIZE, WALL_HEIGHT, WALL_THICKNESS, 1, TORCH_WALL_SEGMENTS, 1);
    this._geo.torchWallBaseEW = new THREE.BoxGeometry(WALL_THICKNESS, WALL_HEIGHT, TILE_SIZE, 1, TORCH_WALL_SEGMENTS, 1);
    // Walls have no precomputed distance-bucketed material/geometry of
    // their own here, ambient or torch — like floor, each wall panel gets
    // its own persistent, live-colored material (ambient) and geometry
    // (torch), built in setDungeon() and updated every frame in
    // updateVisibility(); see that method's wall-color comment for why.
    const markerByDist = Object.fromEntries(
      Object.entries(MARKER_COLORS).map(([type, color]) => [
        type,
        // depthWrite:false — a semi-transparent box writing depth lets its
        // own back faces fight its front faces (and neighboring geometry)
        // for the depth buffer in an undefined order, which is what turns a
        // partly-faded marker into a hazy, glow-like blob instead of a
        // clean translucent cube. Doesn't matter for a small marker sitting
        // on its own floor tile, and fixes the artifact for free.
        Array.from({ length: VISIBLE_RADIUS + 1 }, (_, d) => new THREE.MeshBasicMaterial({
          color, transparent: true, depthWrite: false, opacity: MAX_MARKER_OPACITY * visibilityStrength(d),
        })),
      ]),
    );
    // Torch-equipped equivalents — see the TORCH_* constants' comment above.
    // Same structure as markerByDist, just sized to TORCH_VISIBLE_RADIUS
    // and colored via torchHue() instead of moonHue(). Markers keep their
    // own distinct colors (re-hueing an enemy cube red-to-yellow would
    // blur what it means) — only their opacity falloff uses the torch's
    // longer reach. torchWallMaterial (below) is the single plain-white
    // material every torch-lit wall panel's mesh uses regardless of
    // distance — the real color comes from each panel's own private,
    // live-updated geometry (see createTorchWallGeometry/
    // writeTorchWallGeometryColors), not from this material.
    const torchMarkerByDist = Object.fromEntries(
      Object.entries(MARKER_COLORS).map(([type, color]) => [
        type,
        Array.from({ length: TORCH_VISIBLE_RADIUS + 1 }, (_, d) => new THREE.MeshBasicMaterial({
          color, transparent: true, depthWrite: false, opacity: MAX_MARKER_OPACITY * torchVisibilityStrength(d),
        })),
      ]),
    );
    this._mat = {
      markerByDist,
      torchWallMaterial: new THREE.MeshBasicMaterial({ color: 0xffffff, vertexColors: true }),
      torchMarkerByDist,
      // Behind-the-player occlusion override — see BEHIND_WALL_OPACITY comment above. depthWrite:false for the same reason as the marker materials above.
      behindWall: new THREE.MeshBasicMaterial({ color: COLOR_WALL, transparent: true, depthWrite: false, opacity: BEHIND_WALL_OPACITY, vertexColors: true }),
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
      // Auto FOV: keep cameraZoom riding along with the angle mouse-look
      // just moved to, exactly like the Settings/Pause sliders do — see
      // CameraSettings.js's autoFovPercentForAngle.
      if (this.app.gameState.settings.autoFOV) {
        this.app.gameState.settings.cameraZoom = autoFovPercentForAngle(this._lookPitchDeg);
      }
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
    this._aspect = w / h;
    this._applyZoom();
  }

  /**
   * Sets the ortho camera's frustum span from VIEW_HEIGHT and the live FOV
   * setting (see CameraSettings.js's zoomMultiplierForPercent) — called on
   * resize() and every frame from _applyCameraFromCurrentState() so scroll-
   * wheel/I/O zoom nudges (see ExploreState) take effect immediately without
   * needing a window-resize event. Cheap (4 number writes + a 3x3 matrix
   * recompute), same "every frame is fine" precedent as heightMult below.
   */
  _applyZoom() {
    if (!this._aspect) return;
    const settings = this.app?.gameState?.settings ?? {};
    const zoomMult = zoomMultiplierForPercent(settings.cameraZoom ?? DEFAULT_CAMERA_ZOOM_PERCENT);
    const viewHeight = VIEW_HEIGHT * zoomMult;
    const viewWidth = viewHeight * this._aspect;
    this.camera.left = -viewWidth / 2;
    this.camera.right = viewWidth / 2;
    this.camera.top = viewHeight / 2;
    this.camera.bottom = -viewHeight / 2;
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
    this._applyZoom();
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
   * not just on movement. Also recomputes the radial light/visibility
   * circle from that same tweened position (see updateVisibility) and
   * re-derives which wall (if any) sits between the camera and the player
   * from the camera's CURRENT orbit position — unlike grid movement/
   * turning, mouse-look isn't tile-discrete, so that occlusion check
   * can't just run once per move either.
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
    this.updateVisibility();
    if (this._playerGridX !== undefined) {
      this._applyBehindWallOcclusion(this._playerGridX, this._playerGridY, nearestFacingFromYaw(this._lookYaw));
    }
  }

  /** Builds the floor's tile geometry — walls, floor planes, and tile-type markers (visibility applied separately). */
  setDungeon(dungeon) {
    // Geometries/materials are shared (this._geo/this._mat) and disposed
    // once in unmount() — removing the group from the scene is enough.
    // Floor materials and wall panels' ambientMaterial/torchGeometry are
    // the exception (see updateVisibility()'s floor-color and wall-color
    // comments) — each tile/panel owns its own persistent, live-updated
    // one rather than sharing from this._mat/this._geo, so the outgoing
    // floor's need disposing explicitly here before they're replaced, same
    // as unmount() does for the renderer's own teardown.
    this.tileMeshes.forEach((entry) => {
      entry.floor?.material.dispose();
      entry.walls?.forEach((w) => { w.ambientMaterial.dispose(); w.torchGeometry.dispose(); });
    });
    if (this.dungeonGroup) this.scene.remove(this.dungeonGroup);
    this.dungeon = dungeon;
    this.tileMeshes.clear();
    this.dungeonGroup = new THREE.Group();
    // A new floor's spawn tile can be anywhere on the map — snap the
    // camera/sprite to it on the next setPlayerState() rather than
    // tweening a long swoop across the whole dungeon.
    this._playerStateInitialized = false;
    // Vanguard-calling wall effect (see VANGUARD_CALLING_WALL_RADIUS) —
    // cached once per setDungeon() call rather than re-scanning
    // dungeon.tiles every frame in updateVisibility(). Only floor 5's
    // dungeon has a tile with meta.isHiddenGate at all, so this is null
    // (effect off) on every other floor automatically; checkHiddenGateUnlock()
    // mutates THIS SAME tile object's .type in place (never replaces it),
    // so re-reading .type off the cached reference each frame stays live.
    this._callingGateTile = dungeon.tiles.find((t) => t.meta.isHiddenGate) ?? null;

    const tilesByKey = new Map(dungeon.tiles.map((t) => [tileKey(t.x, t.y), t]));

    dungeon.tiles.forEach((tile) => {
      // Everything past the floor-5 hidden gate gets skipped entirely —
      // no mesh, no tileMeshes entry, nothing — while that gate is still
      // sealed (this._callingGateTile.type === WALL). Minimap.js already
      // refuses to DRAW anything flagged hiddenPastGate, but this renderer
      // had no equivalent guard: it built full geometry for every tile
      // regardless, so the oblique camera could see clean over/around a
      // single thin gate panel into the "secret" corridor and room beyond
      // it — a real leak (see live report), since a solid gate tile only
      // blocks foot traffic, not sightlines, once its neighbor geometry
      // exists. Once checkHiddenGateUnlock() flips the SAME gate tile
      // object to FLOOR and rebuilds via a fresh setDungeon() call, this
      // condition is false and the whole area gets built normally.
      if (tile.meta.hiddenPastGate && this._callingGateTile?.type === TILE_TYPES.WALL) return;

      const worldX = tile.x * TILE_SIZE;
      const worldZ = tile.y * TILE_SIZE;

      if (tile.type === TILE_TYPES.WALL) {
        const walls = [];
        CARDINAL_DIRS.forEach(({ dx, dy, side }) => {
          const neighbor = tilesByKey.get(tileKey(tile.x + dx, tile.y + dy));
          if (!neighbor || neighbor.type === TILE_TYPES.WALL) return; // no panel toward another wall or off-grid
          // Nor toward a concealed hiddenPastGate neighbor — same as
          // whichever tile OWNS this panel skipping its own geometry
          // above, a WALL tile bordering a still-locked hidden neighbor
          // must not paint a panel facing it either. Without this the gate
          // tile itself is the concrete example: its far side (away from
          // the player, toward the sealed corridor) has a genuine FLOOR
          // neighbor one step past it — that neighbor's own rendering is
          // skipped, but its `.type` is still FLOOR, so this check alone
          // would still build a real panel facing directly into the
          // "hidden" area, visible peeking out past the near-side panel
          // from the oblique camera (the actual leak — see live report).
          if (neighbor.meta.hiddenPastGate && this._callingGateTile?.type === TILE_TYPES.WALL) return;
          const isNS = side === 'north' || side === 'south';
          // Own private ambient material + torch geometry per panel (not
          // shared from this._mat/this._geo) — see updateVisibility()'s
          // wall-color comment for why. Initial values don't matter; the
          // very next updateVisibility() call overwrites them before a
          // frame ever renders.
          const ambientMaterial = new THREE.MeshBasicMaterial({ color: BACKGROUND_COLOR, vertexColors: true });
          const torchGeometry = createTorchWallGeometry(isNS ? this._geo.torchWallBaseNS : this._geo.torchWallBaseEW);
          const panel = new THREE.Mesh(isNS ? this._geo.wallPanelNS : this._geo.wallPanelEW, ambientMaterial);
          panel.position.set(
            worldX + (dx * TILE_SIZE) / 2,
            WALL_HEIGHT / 2,
            worldZ + (dy * TILE_SIZE) / 2,
          );
          this.dungeonGroup.add(panel);
          walls.push({
            mesh: panel, dx, dy, isNS, ambientMaterial, torchGeometry,
          });
        });
        this.tileMeshes.set(tileKey(tile.x, tile.y), {
          walls, type: TILE_TYPES.WALL, x: tile.x, y: tile.y,
        });
        return;
      }

      // A dedicated material per floor tile (not a shared one from
      // this._mat) — see updateVisibility()'s floor-color comment for why.
      // Initial color doesn't matter; the very next updateVisibility()
      // call (from setPlayerState, right after setDungeon() in every
      // caller) overwrites it before a frame ever renders.
      const floor = new THREE.Mesh(this._geo.floor, new THREE.MeshBasicMaterial({ color: BACKGROUND_COLOR }));
      floor.rotation.x = -Math.PI / 2;
      floor.position.set(worldX, 0, worldZ);
      this.dungeonGroup.add(floor);

      const entry = {
        floor, marker: null, type: tile.type, x: tile.x, y: tile.y,
      };
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
    } else if (tile.type === TILE_TYPES.ELEVATOR || tile.type === TILE_TYPES.VENDOR) {
      // Genuine cube, same treatment as TEMPORAL_CHEST — a permanent
      // landmark, never one-shot/consumed like the flatter default marker.
      geo = this._geo.enemyCube;
      height = TILE_SIZE * 0.4;
    }
    const marker = new THREE.Mesh(geo, markerMats[VISIBLE_RADIUS]);
    marker.position.set(tile.x * TILE_SIZE, height, tile.y * TILE_SIZE);
    this.dungeonGroup.add(marker);
    entry.marker = marker;
  }

  /** True while the equipped offHand item is the Torch — see the TORCH_* constants above. Cheap enough (a shallow inventory read, already called every frame elsewhere — see ExploreState.revealNearbyTiles) to just re-check on demand rather than cache. */
  _hasTorchEquipped() {
    return this.app?.inventory?.getEquippedItems?.().offHand === 'torch';
  }

  /**
   * Recomputes every tile's visibility from the player's current
   * CONTINUOUS world position (`currentPlayerPos`, the same tweened point
   * the camera/sprite already use — not a grid tile) using true radial
   * (Euclidean) distance, so the lit area reads as a genuine circle
   * centered on Artius rather than square rings stepped out from a tile
   * origin. Markers are the one thing that still pick from a small
   * precomputed set of materials per INTEGER distance step
   * (0..VISIBLE_RADIUS, or 0..TORCH_VISIBLE_RADIUS with the Torch equipped
   * — see _hasTorchEquipped and visibilityStrength/torchVisibilityStrength
   * above), rounding the live distance to the nearest step — cheap, and
   * the banding it produces is minor on a small, already-colorful marker.
   *
   * Floor and walls get different treatment: rounding produced visible
   * artifacts once movement stopped being tile-locked. For floor —
   * standing BETWEEN tiles, every nearby tile's distance is >= ~0.5, so it
   * rounds straight past the brightest ("distance 0") step and the true
   * "you're standing right here" color never appears (a missing middle of
   * the gradient); and standing near a tile's EDGE, that whole tile falls
   * inside the wide "rounds to 0" bucket and flares to full brightness
   * across its entire ~1-tile footprint, reading as the light recentering
   * on that tile instead of staying on Artius. For walls — the same
   * rounding meant a wall's shade would visibly jump/flicker between
   * shades as the player's distance crossed each .5 boundary, rather than
   * shifting smoothly, since a shared per-integer-distance material (or,
   * for torch mode, a shared per-integer-distance geometry) was swapped in
   * wholesale the instant the rounded distance ticked over. So instead of
   * picking a bucketed material/geometry, both floor and walls compute
   * their OWN color directly from THEIR OWN exact, unrounded distance
   * every frame (see setDungeon(), where every floor tile and wall panel
   * is given a private material — and, for wall panels, an additional
   * private torch geometry — instead of a shared one from this._mat/
   * this._geo) — a true continuous gradient, independent of the tile
   * grid, that only ever depends on how far that exact point actually is
   * from Artius right now.
   *
   * The visible/not-visible cutoff itself always uses the unrounded
   * distance (for markers too) so the circle's outer edge stays smooth.
   * Walls/floor fade by shifting color toward the background while
   * staying fully opaque; markers fade via transparency instead. Runs
   * every frame (from update()) — this is live sight, not a permanent
   * "once seen" reveal.
   */
  updateVisibility() {
    const torch = this._hasTorchEquipped();
    const maxRadius = torch ? TORCH_VISIBLE_RADIUS : VISIBLE_RADIUS;
    const markerByDist = torch ? this._mat.torchMarkerByDist : this._mat.markerByDist;
    const floorKeep = torch ? TORCH_FLOOR_KEEP : MAX_FLOOR_KEEP;
    const floorHueFor = torch ? torchHue : moonHue;
    const floorStrengthFor = torch ? torchVisibilityStrength : visibilityStrength;
    const px = this.currentPlayerPos.x / TILE_SIZE;
    const py = this.currentPlayerPos.z / TILE_SIZE;
    // See the VANGUARD_CALLING_* constants' comment — overrides wall AND
    // floor coloring (markers keep their normal continuous behavior)
    // whenever floor 5's gate is open and Vanguard hasn't been beaten yet
    // this run.
    const vanguardCalling = !!this._callingGateTile
      && this._callingGateTile.type === TILE_TYPES.FLOOR
      && !this.app?.gameState?.run?.vanguardDefeated;

    this.tileMeshes.forEach((entry) => {
      const dx = entry.x - px;
      const dy = entry.y - py;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const visible = dist <= maxRadius;
      const distIdx = Math.min(Math.round(dist), maxRadius);

      if (entry.walls) {
        entry.walls.forEach((w) => {
          w.mesh.visible = visible;
          if (!visible) return;
          if (vanguardCalling) {
            // Flat/binary — no blend, uses the normal visibility cutoff
            // (see VANGUARD_CALLING_WALL_NEAR_RADIUS's comment; the floor
            // branch below is what shrinks the render distance, not this).
            w.ambientMaterial.color.set(dist <= VANGUARD_CALLING_WALL_NEAR_RADIUS ? MOON_COLOR_NEAR : MOON_COLOR_FAR);
            w.mesh.material = w.ambientMaterial;
            w.mesh.geometry = w.isNS ? this._geo.wallPanelNS : this._geo.wallPanelEW;
          } else if (torch) {
            writeTorchWallGeometryColors(w.torchGeometry, dist);
            w.mesh.material = this._mat.torchWallMaterial;
            w.mesh.geometry = w.torchGeometry;
          } else {
            w.ambientMaterial.color.copy(blendColor(moonHue(dist), MAX_WALL_KEEP * visibilityStrength(dist), BACKGROUND_COLOR));
            w.mesh.material = w.ambientMaterial;
            w.mesh.geometry = w.isNS ? this._geo.wallPanelNS : this._geo.wallPanelEW;
          }
        });
        return;
      }
      // Overrides the normal visibility cutoff too, not just the color —
      // see VANGUARD_CALLING_FLOOR_VISIBLE_RADIUS's comment: the ground
      // itself shrinks in around you during this effect.
      const floorVisible = vanguardCalling ? dist <= VANGUARD_CALLING_FLOOR_VISIBLE_RADIUS : visible;
      entry.floor.visible = floorVisible;
      // See this method's doc comment — floor is deliberately NOT bucketed
      // by rounded distance like walls/markers; only actually compute (and
      // allocate the intermediate Color objects for) it while visible.
      if (floorVisible) {
        if (vanguardCalling) {
          // One formula covers both the 0..GRADIENT_RADIUS fade AND the
          // solid-black band beyond it out to VISIBLE_RADIUS: strength
          // hits exactly 0 (pure black, since MOON_COLOR_NEAR * 0 = black)
          // right at GRADIENT_RADIUS and stays clamped there.
          const strength = Math.max(0, 1 - dist / VANGUARD_CALLING_FLOOR_GRADIENT_RADIUS) ** VANGUARD_CALLING_FLOOR_FALLOFF_POWER;
          entry.floor.material.color.setHex(MOON_COLOR_NEAR).multiplyScalar(strength);
        } else {
          entry.floor.material.color.copy(blendColor(floorHueFor(dist), floorKeep * floorStrengthFor(dist), BACKGROUND_COLOR));
        }
      }
      if (entry.marker) {
        entry.marker.visible = visible;
        entry.marker.material = markerByDist[entry.type]?.[distIdx];
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
   * Called every frame from update() — right after updateVisibility(),
   * which already reset EVERY wall (including whatever this method
   * occluded last frame) back to its normal distance-tiered material a
   * moment earlier in the same frame, so there's nothing left here to
   * manually restore. This just tracks + repopulates `_lastOccludedWalls`
   * (still needed so a future refactor that reorders these two calls, or
   * skips updateVisibility for some frame, doesn't silently leave stale
   * occlusion around) and computes/applies the new occluded set for
   * `facing` (the cardinal direction nearest the camera's current yaw) —
   * mouse-look isn't tile-discrete, so this set can change between any
   * two frames even with no grid movement at all.
   */
  _applyBehindWallOcclusion(px, py, facing) {
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
    // Reads currentPlayerPos, so this must run after the first-call snap
    // above — every subsequent frame's update() keeps this current as the
    // position tweens toward desiredPlayerPos; this call just avoids a
    // single-frame flash of the wrong (default-brightest) materials
    // between a floor load and the next animation frame.
    this.updateVisibility();
  }

  /**
   * Directly sets the player's world position, bypassing the tween
   * entirely — used for continuous, omnidirectional movement (see
   * ExploreState's per-frame movement integration), where the position
   * itself already updates smoothly every physics tick; an extra
   * smoothing layer on top of that would just add input lag, chasing a
   * constantly-moving target. setPlayerState (still tweened) remains for
   * genuine teleports — floor entry, elevator travel, spawn — where a
   * single instant jump benefits from being eased in.
   * No-ops until setPlayerState has run at least once (mirrors
   * applyLookDelta's guard) since it doesn't do its own first-call setup.
   */
  setPlayerPositionLive(x, y) {
    if (this._lookYaw === undefined) return;
    this._playerGridX = Math.round(x);
    this._playerGridY = Math.round(y);
    this.desiredPlayerPos.set(x * TILE_SIZE, 0, y * TILE_SIZE);
    this.currentPlayerPos.copy(this.desiredPlayerPos);
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
    // Both _geo and _mat hold a mix of shapes: plain objects (behindWall),
    // flat arrays (markerByDist's per-type arrays) — recurse until
    // something disposable is found rather than assuming a fixed depth.
    // Floor materials and wall panels' ambientMaterial/torchGeometry are
    // the exception: they're private per-tile/per-panel instances (see
    // updateVisibility()'s floor-color and wall-color comments), never
    // stored in this._mat/this._geo, so they're disposed directly off
    // tileMeshes here instead.
    const disposeDeep = (value) => {
      if (!value) return;
      if (typeof value.dispose === 'function') value.dispose();
      else Object.values(value).forEach(disposeDeep);
    };
    this.tileMeshes.forEach((entry) => {
      entry.floor?.material.dispose();
      entry.walls?.forEach((w) => { w.ambientMaterial.dispose(); w.torchGeometry.dispose(); });
    });
    disposeDeep(this._geo);
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
