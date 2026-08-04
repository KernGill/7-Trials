// Procedural low-poly geometry for exploration-event floor markers, built
// entirely from THREE's native primitives (Box/Cylinder/Cone/Sphere/Torus/
// Octahedron/Tetrahedron — no external models, matching this project's
// "no image/model assets, generate it" convention used by Textures.js and
// WallRelief.js). Each tile type gets a small silhouette distinct enough to
// read at a glance instead of every event sharing one plain colored cube —
// and each PART of that silhouette carries its own real-world-material
// color (dark wood vs. brass vs. iron, stone vs. violet gem, ...) instead
// of the whole shape sharing one flat per-type hue (a chest isn't just
// "yellow": it's brown wood with a gold latch).
//
// All geometries here are built ONCE (see buildEventMarkerGeometries) and
// shared across every tile of a given type, exactly like the rest of
// DungeonRenderer3D's this._geo — DungeonRenderer3D disposes them
// recursively via its existing disposeDeep(this._geo) call in unmount(), so
// nothing here needs its own disposal path. getMarkerLayout() then returns,
// per tile type, a flat list of {geometry, position, rotation, scale, color}
// parts — DungeonRenderer3D turns that into a small THREE.Group of Mesh
// children, each with its OWN persistent, opaque material seeded from that
// part's `color` (never shared across tiles/types, same as floor tiles/wall
// panels) so every part can keep fading toward the ambient darkness from
// its own true color rather than picking from one shared per-type material.

import * as THREE from '../vendor/three/three.module.js';
import { TILE_TYPES } from './Tile.js';

/** Builds every geometry any marker layout below might reference. Called once per DungeonRenderer3D instance (in mount()). */
export function buildEventMarkerGeometries(TILE_SIZE) {
  const s = TILE_SIZE;
  return {
    // Shared placeholder cube — used verbatim for ENEMY/HIDDEN_ENEMY, which
    // stay deliberate plain-cube encounters (see DungeonRenderer3D's prior
    // "placeholder, per design" comment) rather than getting a themed shape.
    plainCube: new THREE.BoxGeometry(s * 0.8, s * 0.8, s * 0.8),

    // Stairs: three stacked, shrinking slabs — an ascending step silhouette.
    stairStep1: new THREE.BoxGeometry(s * 0.7, s * 0.06, s * 0.7),
    stairStep2: new THREE.BoxGeometry(s * 0.5, s * 0.06, s * 0.5),
    stairStep3: new THREE.BoxGeometry(s * 0.3, s * 0.06, s * 0.3),

    // Locked Door: an upright frame + panel + lock plate + handle.
    doorFrame: new THREE.BoxGeometry(s * 0.55, s * 0.8, s * 0.06),
    doorPanel: new THREE.BoxGeometry(s * 0.44, s * 0.68, s * 0.05),
    doorLock: new THREE.BoxGeometry(s * 0.09, s * 0.09, s * 0.1),
    doorHandle: new THREE.CylinderGeometry(s * 0.025, s * 0.025, s * 0.14, 6),

    // Treasure chest: base + a lid popped open on its back hinge, plus a latch.
    chestBase: new THREE.BoxGeometry(s * 0.5, s * 0.22, s * 0.35),
    chestLid: new THREE.BoxGeometry(s * 0.5, s * 0.16, s * 0.35),
    chestLatch: new THREE.BoxGeometry(s * 0.08, s * 0.1, s * 0.06),

    // Temporal Chest: same chest, plus a floating halo ring above it.
    temporalRing: new THREE.TorusGeometry(s * 0.22, s * 0.025, 8, 24),

    // Sealed Shrine: pedestal + hovering gem + a thin ring around the gem.
    shrinePedestal: new THREE.CylinderGeometry(s * 0.16, s * 0.22, s * 0.3, 8),
    shrineGem: new THREE.OctahedronGeometry(s * 0.14),
    shrineRing: new THREE.TorusGeometry(s * 0.18, s * 0.02, 6, 20),

    // Arcane Sigil: two flat concentric rings + a spinning shard in the middle.
    sigilOuterRing: new THREE.TorusGeometry(s * 0.26, s * 0.025, 6, 28),
    sigilInnerRing: new THREE.TorusGeometry(s * 0.14, s * 0.02, 6, 20),
    sigilShard: new THREE.TetrahedronGeometry(s * 0.1),

    // Wandering Satchel: a squashed rounded pouch + a flap + a carry loop.
    satchelBody: new THREE.SphereGeometry(s * 0.24, 10, 8),
    satchelFlap: new THREE.BoxGeometry(s * 0.3, s * 0.06, s * 0.2),
    satchelLoop: new THREE.TorusGeometry(s * 0.16, s * 0.02, 6, 16, Math.PI),

    // Wounded Animal: a low curled body + head + ears + a drooping tail.
    animalBody: new THREE.SphereGeometry(s * 0.24, 10, 8),
    animalHead: new THREE.SphereGeometry(s * 0.13, 8, 6),
    animalEar: new THREE.ConeGeometry(s * 0.045, s * 0.11, 6),
    animalTail: new THREE.ConeGeometry(s * 0.045, s * 0.2, 6),

    // Elevator: a square platform framed by four corner posts + a top ring.
    elevatorPlatform: new THREE.BoxGeometry(s * 0.6, s * 0.06, s * 0.6),
    elevatorPost: new THREE.CylinderGeometry(s * 0.03, s * 0.03, s * 0.7, 6),
    elevatorCap: new THREE.BoxGeometry(s * 0.6, s * 0.05, s * 0.6),

    // Vendor: a stall cart + a corner awning pole + a pyramidal canopy.
    vendorCart: new THREE.BoxGeometry(s * 0.6, s * 0.3, s * 0.36),
    vendorPole: new THREE.CylinderGeometry(s * 0.025, s * 0.025, s * 0.55, 6),
    vendorCanopy: new THREE.ConeGeometry(s * 0.4, s * 0.22, 4),
  };
}

const IDENTITY_ROT = [0, 0, 0];
const IDENTITY_SCALE = [1, 1, 1];

/**
 * Returns { parts, spinSpeed } for the given tile type, or null for types
 * with no marker at all. `parts` positions are in the marker group's LOCAL
 * space, i.e. relative to the tile's floor origin (0 = floor level) —
 * DungeonRenderer3D positions the group itself at the tile's world (x, 0,
 * z). Position numbers below are fractions of TILE_SIZE (matching the SAME
 * convention buildEventMarkerGeometries' own dimensions use, e.g. "0.4"
 * meaning "0.4 * TILE_SIZE") — the local `pt()` closure applies that
 * scaling, so every layout below can be written and reasoned about in
 * tile-relative terms regardless of TILE_SIZE's actual value.
 *
 * Each part also carries its own `color` (a real material hue — dark wood,
 * brass, iron, stone, gem, fur, ...) rather than every part of a type
 * sharing one flat color; DungeonRenderer3D fades each part's OWN color
 * toward the ambient darkness independently (see updateVisibility()'s
 * marker branch), so the multi-material read survives at every distance.
 * `fallbackColor` is only consulted for ENEMY/HIDDEN_ENEMY, whose single
 * plain cube deliberately keeps one flat hue (see
 * buildEventMarkerGeometries' comment on `plainCube`) rather than getting
 * a themed multi-part palette.
 *
 * `spinSpeed` (radians/sec, optional) is applied to the whole group's Y
 * rotation by DungeonRenderer3D while visible, for the few markers
 * (currently just Arcane Sigil) whose design reads better with a slow idle
 * spin.
 */
export function getMarkerLayout(type, geo, TILE_SIZE, fallbackColor) {
  const s = TILE_SIZE;
  const pt = (x, y, z) => [x * s, y * s, z * s];
  const part = (geometry, color, position, rotation = IDENTITY_ROT, scale = IDENTITY_SCALE) => ({
    geometry, color, position, rotation, scale,
  });
  switch (type) {
    case TILE_TYPES.STAIRS:
      return {
        parts: [
          part(geo.stairStep1, 0x4a3c28, pt(0, 0.03, 0)), // stone/tan, darkest at the bottom
          part(geo.stairStep2, 0x6b5638, pt(0, 0.09, 0)),
          part(geo.stairStep3, 0x8f7548, pt(0, 0.15, 0)), // lightest at the top — catches the light climbing up
        ],
      };

    case TILE_TYPES.ENEMY:
    case TILE_TYPES.HIDDEN_ENEMY:
      // Deliberate plain single-hue cube — see buildEventMarkerGeometries' comment.
      return { parts: [part(geo.plainCube, fallbackColor, pt(0, 0.4, 0))] };

    case TILE_TYPES.LOCKED_DOOR:
      return {
        parts: [
          part(geo.doorFrame, 0x2e2115, pt(0, 0.4, 0)), // dark wood frame
          part(geo.doorPanel, 0x4a3320, pt(0, 0.38, 0.01)), // medium wood panel
          part(geo.doorLock, 0x232323, pt(0.16, 0.4, 0.04)), // iron lock plate
          part(geo.doorHandle, 0xb08d3e, pt(0.16, 0.4, 0.08), [Math.PI / 2, 0, 0]), // brass handle
        ],
      };

    case TILE_TYPES.TREASURE:
      return {
        parts: [
          part(geo.chestBase, 0x6b4423, pt(0, 0.11, 0)), // brown wood
          // Lid tilted back on its rear edge, like a chest popped open.
          part(geo.chestLid, 0x4a2f16, pt(0, 0.24, -0.14), [-0.9, 0, 0]), // darker wood
          part(geo.chestLatch, 0xd4af37, pt(0, 0.2, 0.175)), // gold latch — the one gold accent, not the whole chest
        ],
      };

    case TILE_TYPES.TEMPORAL_CHEST:
      return {
        parts: [
          // Blue-tinted wood, not the plain brown of a regular chest — reads
          // as a distinct "temporal" variant even before the ring registers.
          part(geo.chestBase, 0x24304f, pt(0, 0.11, 0)),
          part(geo.chestLid, 0x1a2338, pt(0, 0.24, -0.14), [-0.9, 0, 0]),
          part(geo.chestLatch, 0xd4af37, pt(0, 0.2, 0.175)),
          part(geo.temporalRing, 0x4fc3f7, pt(0, 0.55, 0), [Math.PI / 2, 0, 0]), // bright cyan halo
        ],
      };

    case TILE_TYPES.SEALED_SHRINE:
      return {
        parts: [
          part(geo.shrinePedestal, 0x6e6a72, pt(0, 0.15, 0)), // gray stone
          part(geo.shrineRing, 0x9b59b6, pt(0, 0.62, 0), [Math.PI / 2, 0, 0]), // violet magic ring
          part(geo.shrineGem, 0xd68fff, pt(0, 0.62, 0), [0.5, 0.4, 0]), // brighter pink-violet gem, pops against the ring
        ],
      };

    case TILE_TYPES.ARCANE_SIGIL:
      return {
        parts: [
          part(geo.sigilOuterRing, 0x1fd9c9, pt(0, 0.18, 0), [Math.PI / 2, 0, 0]), // teal
          part(geo.sigilInnerRing, 0x8ff5ec, pt(0, 0.24, 0), [Math.PI / 2, 0, Math.PI / 6]), // lighter cyan
          part(geo.sigilShard, 0xf2fffb, pt(0, 0.34, 0)), // near-white arcane crystal
        ],
        spinSpeed: 0.8,
      };

    case TILE_TYPES.WANDERING_SATCHEL:
      return {
        parts: [
          part(geo.satchelBody, 0x8a5a2f, pt(0, 0.22, 0), IDENTITY_ROT, [1, 0.85, 0.9]), // brown leather
          part(geo.satchelFlap, 0x5f3d20, pt(0, 0.36, 0.02), [0.35, 0, 0]), // darker leather flap
          part(geo.satchelLoop, 0xb98a4e, pt(0, 0.5, -0.08), [0, 0, Math.PI / 2]), // tan strap
        ],
      };

    case TILE_TYPES.WOUNDED_ANIMAL:
      return {
        parts: [
          part(geo.animalBody, 0x9c4a37, pt(0, 0.18, 0), IDENTITY_ROT, [1.45, 0.65, 0.85]), // rust-red fur
          part(geo.animalHead, 0xc9765a, pt(0.32, 0.24, 0)), // lighter fur
          part(geo.animalEar, 0x5c2c1f, pt(0.36, 0.34, -0.06), [0, 0, -0.3]), // dark fur
          part(geo.animalEar, 0x5c2c1f, pt(0.36, 0.34, 0.06), [0, 0, -0.3]),
          part(geo.animalTail, 0x5c2c1f, pt(-0.32, 0.12, 0), [0, 0, Math.PI * 0.65]),
        ],
      };

    case TILE_TYPES.ELEVATOR:
      return {
        parts: [
          part(geo.elevatorPlatform, 0x7f8c8d, pt(0, 0.03, 0)), // metal gray
          part(geo.elevatorPost, 0x596566, pt(0.27, 0.35, 0.27)), // darker metal posts
          part(geo.elevatorPost, 0x596566, pt(-0.27, 0.35, 0.27)),
          part(geo.elevatorPost, 0x596566, pt(0.27, 0.35, -0.27)),
          part(geo.elevatorPost, 0x596566, pt(-0.27, 0.35, -0.27)),
          part(geo.elevatorCap, 0x2ecc71, pt(0, 0.7, 0)), // green cap — keeps the elevator's established green identity
        ],
      };

    case TILE_TYPES.VENDOR:
      return {
        parts: [
          part(geo.vendorCart, 0x6b4423, pt(0, 0.15, 0)), // brown wood cart
          part(geo.vendorPole, 0x4a3320, pt(0, 0.575, -0.15)), // dark wood pole
          part(geo.vendorCanopy, 0xa13d3d, pt(0, 0.96, -0.15), [0, Math.PI / 4, 0]), // maroon awning fabric
        ],
      };

    default:
      return null;
  }
}
