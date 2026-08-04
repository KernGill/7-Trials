import * as THREE from '../vendor/three/three.module.js';

/**
 * Procedural pixel-art stone textures for the dungeon's walls/floor — drawn
 * on an offscreen <canvas> at a tiny resolution and tiled via
 * THREE.RepeatWrapping + NearestFilter, so no image asset files are needed
 * and the blocky/pixelated look is intentional rather than a scaling
 * artifact. Reused as a single shared THREE.CanvasTexture instance per
 * surface (wall/floor) — every tile's material just points at the same
 * texture, same as the existing shared-geometry pattern in
 * DungeonRenderer3D.js. Multiplies naturally with each material's own
 * vertexColors/`.color` (three.js multiplies map x vertexColor x
 * material.color per pixel), so the distance fog, moonlight, and torch
 * lighting all keep working unchanged on top of these.
 */

const TEXTURE_SIZE = 64;

function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** Lightens (amt>0) or darkens (amt<0) a '#rrggbb' color by `amt` (-1..1). */
function shade(hex, amt) {
  const [r, g, b] = hexToRgb(hex);
  const adjust = (c) => Math.max(0, Math.min(255, Math.round(c + (amt >= 0 ? (255 - c) * amt : c * amt))));
  return `rgb(${adjust(r)}, ${adjust(g)}, ${adjust(b)})`;
}

const MORTAR_COLOR = '#170e0e';
const BRICK_COLORS = ['#8c8c8c', '#7a7a7a', '#969696', '#828282'];

/**
 * A running-bond (offset-row) brick pattern, roughly matching the reference
 * image's theme (gray stone blocks, near-black mortar, mottled per-brick
 * shading) without copying it exactly. `repeatY` controls how many times
 * the pattern repeats up a wall panel (see WALL_HEIGHT/TILE_SIZE in
 * DungeonRenderer3D.js) — repeatX is always 1 since a panel's width already
 * equals one game tile.
 */
export function createBrickWallTexture(repeatY = 1) {
  const canvas = document.createElement('canvas');
  canvas.width = TEXTURE_SIZE;
  canvas.height = TEXTURE_SIZE;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = MORTAR_COLOR;
  ctx.fillRect(0, 0, TEXTURE_SIZE, TEXTURE_SIZE);

  const rows = 6;
  const rowHeight = TEXTURE_SIZE / rows;
  const mortarPx = 2;
  const brickWidth = 22;

  for (let row = 0; row < rows; row += 1) {
    const y = row * rowHeight;
    const offset = row % 2 === 0 ? 0 : -brickWidth / 2;
    let x = offset;
    let i = 0;
    while (x < TEXTURE_SIZE) {
      const left = Math.max(x, 0);
      const right = Math.min(x + brickWidth, TEXTURE_SIZE);
      const w = right - left;
      if (w > mortarPx) {
        const base = BRICK_COLORS[(row * 3 + i) % BRICK_COLORS.length];
        ctx.fillStyle = base;
        ctx.fillRect(left + mortarPx / 2, y + mortarPx / 2, w - mortarPx, rowHeight - mortarPx);
        // Top-left highlight sliver — cheap "light from above" read.
        ctx.fillStyle = shade(base, 0.22);
        ctx.fillRect(left + mortarPx / 2, y + mortarPx / 2, Math.max(2, w * 0.18), rowHeight - mortarPx);
        // Occasional darker fleck for mottled stone grain, like the reference.
        if ((row + i) % 3 === 0) {
          ctx.fillStyle = shade(base, -0.18);
          ctx.fillRect(left + w * 0.45, y + rowHeight * 0.5, w * 0.35, rowHeight * 0.4);
        }
      }
      x += brickWidth;
      i += 1;
    }
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.NearestFilter;
  texture.repeat.set(1, repeatY);
  return texture;
}

/**
 * A flagstone floor — same gray/mortar palette as the wall brick texture
 * (reads as "the same dungeon"), but a 2x2 grid of bigger slabs per tile
 * instead of a running-bond pattern, so floor and walls stay visually
 * distinct at a glance the way real stonework usually does.
 */
export function createStoneFloorTexture(repeat = 1) {
  const canvas = document.createElement('canvas');
  canvas.width = TEXTURE_SIZE;
  canvas.height = TEXTURE_SIZE;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = MORTAR_COLOR;
  ctx.fillRect(0, 0, TEXTURE_SIZE, TEXTURE_SIZE);

  const cols = 2;
  const rows = 2;
  const cellW = TEXTURE_SIZE / cols;
  const cellH = TEXTURE_SIZE / rows;
  const mortarPx = 3;

  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      const base = BRICK_COLORS[(row * cols + col) % BRICK_COLORS.length];
      const x = col * cellW;
      const y = row * cellH;
      ctx.fillStyle = base;
      ctx.fillRect(x + mortarPx / 2, y + mortarPx / 2, cellW - mortarPx, cellH - mortarPx);
      ctx.fillStyle = shade(base, 0.15);
      ctx.fillRect(x + mortarPx / 2, y + mortarPx / 2, cellW - mortarPx, Math.max(2, cellH * 0.12));
      ctx.fillStyle = shade(base, -0.18);
      ctx.fillRect(x + cellW * 0.55, y + cellH * 0.55, cellW * 0.3, cellH * 0.3);
    }
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.NearestFilter;
  texture.repeat.set(repeat, repeat);
  return texture;
}
