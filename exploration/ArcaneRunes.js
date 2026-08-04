import * as THREE from '../vendor/three/three.module.js';

/**
 * Data + textures for Arcane Sigil wall runes — one identity per stat an
 * Arcane Sigil can buff (see ExploreState.ARCANE_SIGIL_BUFF_STATS).
 *
 * The rune's actual SHAPE is now real 3D geometry, not a texture (see
 * DungeonRenderer3D._addRuneMesh, which turns RUNE_GLYPHS below into
 * extruded 3D bars + a torus for `con`'s ring) — a genuine white "beam of
 * light" with real thickness, not a flat painted symbol. This file only
 * supplies that geometry's raw shape data, plus a small radial-gradient
 * glow texture per stat: a white-hot center that dissipates FAST into that
 * stat's own color and then to nothing — the actual light radiating off
 * the white beam. That glow texture is applied with real alpha blending
 * (see DungeonRenderer3D's `runeGlowByStat` material, `transparent: true`
 * + `THREE.AdditiveBlending`) — deliberately real transparency here, unlike
 * the rest of this renderer's opaque-only convention, because additive
 * blending is order-independent (it only ever adds light, never occludes),
 * so it never causes the depth-sorting artifacts plain alpha blending does
 * — the actual reason transparency was avoided elsewhere in this file.
 */

/** Per-stat rune identity — color doubles as the glyph's glow tint (the solid 3D beam itself is always white — see DungeonRenderer3D's runeCore material). */
export const RUNE_COLORS = {
  str: 0xe0512b, // fiery red-orange
  int: 0x5a6fd4, // arcane blue-violet
  dex: 0x4ad46a, // vibrant green
  spd: 0xe8d23a, // electric yellow
  def: 0x6a8caf, // steel blue-gray
  con: 0xc98a3f, // earthy amber
};

/**
 * Each glyph is a list of straight-line segments (`[[x1,y1],[x2,y2]], ...`)
 * in a "unit" square roughly spanning -0.5..0.5 (DungeonRenderer3D scales
 * this by RUNE_GLYPH_SIZE at build time — see `_addRuneMesh`'s `u()`
 * helper), plus an optional `circle: { radius }` for con's ring. Simple
 * straight strokes only (in the spirit of a real runic alphabet), so each
 * stat reads as a distinct silhouette even as a small glowing shape across
 * a dim wall.
 */
export const RUNE_GLYPHS = {
  // str — an upward chevron on a short stem (an ascent/power mark).
  str: {
    segments: [
      [[-0.4375, -0.0625], [0, 0.5]],
      [[0, 0.5], [0.4375, -0.0625]],
      [[0, 0.375], [0, -0.5]],
    ],
  },
  // int — a diamond outline (a crystalline "mind's eye").
  int: {
    segments: [
      [[0, 0.5625], [0.5, 0]],
      [[0.5, 0], [0, -0.5625]],
      [[0, -0.5625], [-0.5, 0]],
      [[-0.5, 0], [0, 0.5625]],
    ],
  },
  // dex — a lightning-bolt zigzag (quickness).
  dex: {
    segments: [
      [[0.125, 0.5625], [-0.3125, 0]],
      [[-0.3125, 0], [0.0625, 0]],
      [[0.0625, 0], [-0.375, -0.5625]],
    ],
  },
  // spd — three parallel speed-lines.
  spd: {
    segments: [
      [[-0.4375, 0.375], [-0.0625, 0.625]],
      [[-0.5, 0], [0.0625, 0.375]],
      [[-0.4375, -0.375], [0.125, 0.0625]],
    ],
  },
  // def — a shield outline (flat top, pointed base).
  def: {
    segments: [
      [[-0.375, 0.5], [0.375, 0.5]],
      [[0.375, 0.5], [0.375, 0]],
      [[0.375, 0], [0, -0.5625]],
      [[0, -0.5625], [-0.375, 0]],
      [[-0.375, 0], [-0.375, 0.5]],
    ],
  },
  // con — an unbroken circle with a horizontal line through it (a whole, steady vessel).
  con: {
    segments: [
      [[-0.4375, 0], [0.4375, 0]],
    ],
    circle: { radius: 0.5 },
  },
};

function hexToRgbTuple(hex) {
  return [(hex >> 16) & 255, (hex >> 8) & 255, hex & 255];
}

/**
 * A small radial-gradient "aura" texture for the given stat — white-hot at
 * the very center, dissipating through that stat's own color, then fully
 * transparent well before the texture's edge (a FAST falloff — a tight
 * radiating glow, not a big soft cloud). Applied to a single quad behind/
 * around each rune's solid 3D beam (see DungeonRenderer3D._addRuneMesh).
 */
export function createRuneGlowTexture(stat) {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  const [r, g, b] = hexToRgbTuple(RUNE_COLORS[stat] ?? RUNE_COLORS.str);
  const cx = size / 2;
  const cy = size / 2;
  // Deliberately modest peak alpha (well under 1) — the solid white beam
  // geometry itself is what's fully bright; this is only the light
  // radiating OFF it, and three of these sit close together on the same
  // wall (see RUNE_SPACING), so each needs headroom before additive
  // blending stacks them past white without needing to shrink the glow
  // itself down to nothing.
  const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, size / 2);
  grad.addColorStop(0, 'rgba(255,255,255,0.55)');
  grad.addColorStop(0.1, `rgba(255,255,255,0.42)`);
  grad.addColorStop(0.22, `rgba(${r},${g},${b},0.38)`);
  grad.addColorStop(0.45, `rgba(${r},${g},${b},0.14)`);
  grad.addColorStop(0.7, `rgba(${r},${g},${b},0.03)`);
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);

  const texture = new THREE.CanvasTexture(canvas);
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearFilter;
  return texture;
}
