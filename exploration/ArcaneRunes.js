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

/**
 * A leafy vine flanking each rune, filling the margin between the glyph's
 * own footprint and the wall panel's actual edges — the in-game counterpart
 * of the reference sheet built for this feature (see the "Arcane Sigils"
 * exploration doc). Deliberately NOT glowing/emissive like the rune itself
 * (see DungeonRenderer3D's plain, non-additive vineStem/vineLeaf materials)
 * — it reads as ordinary matte foliage growing around the light, not part
 * of the light.
 *
 * Built as one merged, static BufferGeometry per stat (stem + leaves each
 * get their own, since they use different colors/materials), reused as a
 * single shared Mesh instance across every wall panel that has earned that
 * stat's rune — same sharing convention as runeBarBeam/runeRing, and for
 * the same reason: a floor can have hundreds of wall panels, each with up
 * to 3 rune slots, so anything built per-instance here would multiply fast.
 *
 * Coordinates below work in the SAME "percent of wall width" space the
 * reference sheet's SVG used (0-100, x=50/y=50 is the wall's own center) —
 * porting its math directly — then get converted to real local units of
 * the rune's own Group (see _addRuneMesh's local X/Y/Z convention) via
 * `toLocal()`, using `tileSize` as the isotropic 100-unit-square scale
 * factor. Y is flipped (real Y = -(percentY-50)) since the reference sheet
 * authored its curve in SVG's y-down convention while this Group's local Y
 * is ordinary 3D "up".
 */
export const VINE_COLOR = 0x6f9b5f;
// A small palette of natural greens leaf blades cycle through (per user
// request — "express different shades of green better") rather than one
// flat fill. Baked in as real per-vertex colors (see pushBladeTriangles),
// not separate materials, since every leaf in a stat's merged geometry
// still has to share one Mesh/material (see the class doc comment above
// for why anything per-instance here would multiply across a whole floor).
const VINE_LEAF_SHADES = [0x6f9b5f, 0x86b873, 0x9cc98d, 0x577f4c];

const VINE_AMPLITUDE = 6;
const VINE_WAVES = 2;
const VINE_FREQ = (Math.PI * 2 * VINE_WAVES) / 100;
const VINE_STROKE_PERCENT = 1.4;
const VINE_LEAF_CLUSTER_XS = [8, 25, 41.5, 58, 74.5, 91];
// Leaf blades read thin against the rune's own thick white beam — widen
// every blade width by this factor (per user request: "make the vine
// leafs thicker"). Stem stroke is untouched; only the leaves were asked for.
const VINE_LEAF_WIDTH_SCALE = 1.45;
// "Two rows of vines... 30% from the bottom to the top of the sigil and
// 70%" per user request, replacing the old single row centered on the
// glyph's own vertical middle — see vineRowBaselinesForStat.
const VINE_ROW_FRACTIONS = [0.3, 0.7];

/** The stem's own oscillation, independent of which row it's riding on. */
const stemWaveOffset = (x) => VINE_AMPLITUDE * Math.sin(x * VINE_FREQ);
const vineStemY = (x, baselineY) => baselineY + stemWaveOffset(x);

function toLocal(px, py, tileSize) {
  return { x: ((px - 50) / 100) * tileSize, y: -((py - 50) / 100) * tileSize };
}

function hexToRgbFloat(hex) {
  return [((hex >> 16) & 255) / 255, ((hex >> 8) & 255) / 255, (hex & 255) / 255];
}

/** Min/max local x (in RUNE_GLYPHS' own -0.5..0.5 unit space) a glyph's segments/circle actually occupy. */
function glyphExtentX(glyph) {
  let min = Infinity;
  let max = -Infinity;
  glyph.segments.forEach(([[x1], [x2]]) => {
    min = Math.min(min, x1, x2);
    max = Math.max(max, x1, x2);
  });
  if (glyph.circle) {
    min = Math.min(min, -glyph.circle.radius);
    max = Math.max(max, glyph.circle.radius);
  }
  return { min, max };
}

/** Min/max local y, same idea as glyphExtentX but vertical — this is "the bottom" and "the top" of the sigil for VINE_ROW_FRACTIONS to measure against. */
function glyphExtentY(glyph) {
  let min = Infinity;
  let max = -Infinity;
  glyph.segments.forEach(([[, y1], [, y2]]) => {
    min = Math.min(min, y1, y2);
    max = Math.max(max, y1, y2);
  });
  if (glyph.circle) {
    min = Math.min(min, -glyph.circle.radius);
    max = Math.max(max, glyph.circle.radius);
  }
  return { min, max };
}

/** The two "margin" ranges (in wall-percent space) flanking a stat's glyph — left of it and right of it. */
function vineRangesForStat(stat, tileSize, glyphSize) {
  const glyph = RUNE_GLYPHS[stat] ?? RUNE_GLYPHS.str;
  const { min, max } = glyphExtentX(glyph);
  const leftEdge = 50 + ((min * glyphSize) / tileSize) * 100;
  const rightEdge = 50 + ((max * glyphSize) / tileSize) * 100;
  return { leftEdge, rightEdge };
}

/**
 * The two vine rows' baseline heights (wall-percent space, same convention
 * as VINE_ROW_FRACTIONS' doc comment above) for a stat's glyph — 30% and
 * 70% of the way from the glyph's own bottom to its own top, per user
 * request. Real glyph-local Y is "up positive" (RUNE_GLYPHS' own
 * convention) while wall-percent Y is "down positive" (inherited from the
 * reference sheet's SVG authoring — see the class doc comment), hence the
 * sign flip versus vineRangesForStat's equivalent X math above.
 */
function vineRowBaselinesForStat(stat, tileSize, glyphSize) {
  const glyph = RUNE_GLYPHS[stat] ?? RUNE_GLYPHS.str;
  const { min, max } = glyphExtentY(glyph);
  return VINE_ROW_FRACTIONS.map((f) => 50 - (((min + f * (max - min)) * glyphSize) / tileSize) * 100);
}

function pushStemRange(fromX, toX, tileSize, baselineY, positions) {
  if (toX - fromX < 0.5) return;
  const step = 2;
  const xs = [];
  for (let x = fromX; x < toX; x += step) xs.push(x);
  xs.push(toX);
  const halfW = ((VINE_STROKE_PERCENT / 2) / 100) * tileSize;
  const pts = xs.map((x) => toLocal(x, vineStemY(x, baselineY), tileSize));
  for (let i = 0; i < pts.length - 1; i += 1) {
    const a = pts[i];
    const b = pts[i + 1];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy) || 1;
    const nx = (-dy / len) * halfW;
    const ny = (dx / len) * halfW;
    positions.push(
      a.x + nx, a.y + ny, 0, b.x + nx, b.y + ny, 0, b.x - nx, b.y - ny, 0,
      a.x + nx, a.y + ny, 0, b.x - nx, b.y - ny, 0, a.x - nx, a.y - ny, 0,
    );
  }
}

/** Points along a leaf blade's two quadratic-bezier edges (an asymmetric, tapering "swept blade" outline — same shape as the reference sheet's `bladePath`), already in real local units and centered on its own base point. */
function bladeOutline(len, width, sweep) {
  const samples = 6;
  const quad = (p0, p1, p2, t) => [
    (1 - t) * (1 - t) * p0[0] + 2 * (1 - t) * t * p1[0] + t * t * p2[0],
    (1 - t) * (1 - t) * p0[1] + 2 * (1 - t) * t * p1[1] + t * t * p2[1],
  ];
  const base = [0, 0];
  const tip = [0, len];
  const c1 = [width * sweep, len * 0.55];
  const c2 = [-width * sweep * 0.3, len * 0.55];
  const pts = [];
  for (let i = 1; i <= samples; i += 1) pts.push(quad(base, c1, tip, i / samples));
  for (let i = 1; i < samples; i += 1) pts.push(quad(tip, c2, base, i / samples));
  return pts;
}

function pushBladeTriangles(len, width, sweep, offsetX, offsetY, angleRad, color, positions, colors) {
  const outline = bladeOutline(len, width, sweep);
  const cos = Math.cos(angleRad);
  const sin = Math.sin(angleRad);
  const world = outline.map(([x, y]) => [offsetX + x * cos - y * sin, offsetY + x * sin + y * cos]);
  const [r, g, b] = color;
  for (let i = 0; i < world.length; i += 1) {
    const next = world[(i + 1) % world.length];
    positions.push(offsetX, offsetY, 0, world[i][0], world[i][1], 0, next[0], next[1], 0);
    colors.push(r, g, b, r, g, b, r, g, b);
  }
}

/** A little fan of 2-3 blades branching from one point on the stem — mirrors `leafCluster()`. Each blade gets its own shade off VINE_LEAF_SHADES, cycling by cluster+blade index so neighboring blades never repeat the same green. */
function pushLeafCluster(x, index, tileSize, baselineY, positions, colors) {
  const { x: lx, y: ly } = toLocal(x, vineStemY(x, baselineY), tileSize);
  const up = index % 2 === 0;
  const baseAngle = up ? 0 : 180;
  const sizeScale = 0.75 + (x / 100) * 0.5;
  const blades = [
    { angle: baseAngle - 26, len: 10, width: 3.4 * VINE_LEAF_WIDTH_SCALE, sweep: 1 },
    { angle: baseAngle + 10, len: 12.5, width: 3.8 * VINE_LEAF_WIDTH_SCALE, sweep: -1 },
    { angle: baseAngle + 34, len: 8, width: 2.8 * VINE_LEAF_WIDTH_SCALE, sweep: 1 },
  ];
  blades.forEach(({ angle, len, width, sweep }, i) => {
    const realLen = ((len * sizeScale) / 100) * tileSize;
    const realWidth = ((width * sizeScale) / 100) * tileSize;
    const shade = VINE_LEAF_SHADES[(index + i) % VINE_LEAF_SHADES.length];
    pushBladeTriangles(realLen, realWidth, sweep, lx, ly, (angle * Math.PI) / 180, hexToRgbFloat(shade), positions, colors);
  });
}

/** Merged stem geometry (both margins, both rows) for one stat — pair with VINE_COLOR. */
export function buildVineStemGeometry(stat, tileSize, glyphSize) {
  const { leftEdge, rightEdge } = vineRangesForStat(stat, tileSize, glyphSize);
  const baselines = vineRowBaselinesForStat(stat, tileSize, glyphSize);
  const positions = [];
  baselines.forEach((baselineY) => {
    pushStemRange(0, leftEdge, tileSize, baselineY, positions);
    pushStemRange(rightEdge, 100, tileSize, baselineY, positions);
  });
  if (!positions.length) return null;
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  return geometry;
}

/** Merged leaf-cluster geometry (both margins, both rows) for one stat — vertex-colored, pair with a vertexColors material (e.g. DungeonRenderer3D's vineLeaf). */
export function buildVineLeafGeometry(stat, tileSize, glyphSize) {
  const { leftEdge, rightEdge } = vineRangesForStat(stat, tileSize, glyphSize);
  const baselines = vineRowBaselinesForStat(stat, tileSize, glyphSize);
  const positions = [];
  const colors = [];
  baselines.forEach((baselineY) => {
    VINE_LEAF_CLUSTER_XS.forEach((x, i) => {
      const inLeftMargin = x > 1 && x < leftEdge - 1;
      const inRightMargin = x > rightEdge + 1 && x < 99;
      if (!inLeftMargin && !inRightMargin) return;
      pushLeafCluster(x, i, tileSize, baselineY, positions, colors);
    });
  });
  if (!positions.length) return null;
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  return geometry;
}

/**
 * A small stat-agnostic tuft of blades for CONVEX wall corners (two panels
 * on the same WALL tile meeting at a shared vertical edge — see
 * DungeonRenderer3D's `_addCornerSprigMesh`). Each wall's own vine already
 * runs all the way to its own panel edge, but a flat per-wall decoration
 * can never actually continue across a real 3D bend the way it does
 * between two COPLANAR panels (see buildVineStemGeometry's doc comment) —
 * two different planes meeting at an angle just isn't the same curve. This
 * fills that gap with one extra clump planted right at the corner itself,
 * angled to face straight out along the corner's own bisector, so it reads
 * as belonging to both walls' vines rather than favoring either one. One
 * shared, vertex-colored geometry for every corner (pair with a
 * vertexColors material), spread symmetrically since it has no "which
 * wall" to lean toward. Row heights borrow `str`'s own vertical extent as
 * a representative reference — this tuft is stat-agnostic (it doesn't know
 * which glyph occupies whichever slot it's paired with), so it can't
 * measure "30%/70% of THIS sigil" the way the wall vine rows do; str's
 * shape is close enough to the other five that it lines up well regardless.
 */
export function buildCornerSprigGeometry(tileSize, glyphSize) {
  const baselines = vineRowBaselinesForStat('str', tileSize, glyphSize);
  const positions = [];
  const colors = [];
  const blades = [
    { angle: -46, len: 9, width: 3.2 * VINE_LEAF_WIDTH_SCALE, sweep: 1 },
    { angle: -14, len: 12, width: 3.6 * VINE_LEAF_WIDTH_SCALE, sweep: -1 },
    { angle: 14, len: 12, width: 3.6 * VINE_LEAF_WIDTH_SCALE, sweep: 1 },
    { angle: 46, len: 9, width: 3.2 * VINE_LEAF_WIDTH_SCALE, sweep: -1 },
  ];
  baselines.forEach((baselineY) => {
    const { y: ly } = toLocal(50, baselineY, tileSize);
    blades.forEach(({ angle, len, width, sweep }, i) => {
      const realLen = (len / 100) * tileSize;
      const realWidth = (width / 100) * tileSize;
      const shade = VINE_LEAF_SHADES[i % VINE_LEAF_SHADES.length];
      pushBladeTriangles(realLen, realWidth, sweep, 0, ly, (angle * Math.PI) / 180, hexToRgbFloat(shade), positions, colors);
    });
  });
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  return geometry;
}
