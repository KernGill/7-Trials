import * as THREE from '../vendor/three/three.module.js';

/**
 * Flat billboard "paper doll" build of Artius, using the real chibi sprite
 * artwork the user provided directly (assets/sprites/characters/artius_
 * chibi_*.png — cropped/split from that source image, pixels untouched, no
 * hand-painted/procedural recreation) instead of a generated texture.
 *
 * The source art (a 151x192 chibi portrait) was split into 5 pieces
 * so the legs/arms can swing independently while the head/torso/hair stay
 * fixed:
 *   - artius_chibi_body.png  — the full 151x192 canvas with the leg/arm
 *     regions erased to transparent (so it tiles seamlessly under the
 *     limb sprites at rest).
 *   - artius_chibi_leg_l/leg_r.png, artius_chibi_arm_l/arm_r.png — just
 *     those pixel regions, cropped at the hip/shoulder line so the crop's
 *     TOP edge is the pivot point.
 * All 5 pieces share one pixel coordinate system (the original 151x192
 * image), so PIVOT_BOXES below (in that same image-pixel space) is enough
 * to position every piece correctly relative to the others — see
 * imageBoxToWorld().
 */

const SPRITE_DIR = '../assets/sprites/characters/';
const IMG_W = 151;
const IMG_H = 192;
// Image-pixel boxes {x0,y0,x1,y1} matching exactly how each PNG above was
// cropped from the 151x192 source — used to place each piece back in its
// original position (see imageBoxToWorld()).
const PIVOT_BOXES = {
  legL: { x0: 58, y0: 143, x1: 100, y1: 192 },
  legR: { x0: 100, y0: 143, x1: 145, y1: 192 },
  armL: { x0: 8, y0: 93, x1: 45, y1: 158 },
  armR: { x0: 118, y0: 95, x1: 151, y1: 158 },
};

const BRIGHTNESS = 0.85; // SpriteMaterial is unlit, so dim it a touch to sit right in the dim dungeon (mirrors the original PLAYER_SPRITE_BRIGHTNESS)

function loadTexture(filename) {
  const url = new URL(SPRITE_DIR + filename, import.meta.url).href;
  const texture = new THREE.TextureLoader().load(url);
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.NearestFilter;
  return texture;
}

/**
 * Converts an image-pixel box (in the shared 151x192 source coordinate
 * system) into a Sprite's world position/scale, given the total on-screen
 * height (`worldPerPx` — world units per source pixel) and whether it's a
 * top-anchored limb (pivots at the box's top edge, hangs down — matches
 * `sprite.center.set(0.5, 1)`) or the full-canvas body (default center).
 */
function imageBoxToWorld(box, worldPerPx, topAnchored) {
  const width = (box.x1 - box.x0) * worldPerPx;
  const height = (box.y1 - box.y0) * worldPerPx;
  const centerX = (box.x0 + box.x1) / 2;
  const x = (centerX - IMG_W / 2) * worldPerPx;
  // Image y grows downward; world y grows upward, with the image's bottom
  // edge (feet, y=IMG_H) at world y=0.
  const anchorImageY = topAnchored ? box.y0 : (box.y0 + box.y1) / 2;
  const y = (IMG_H - anchorImageY) * worldPerPx;
  return { x, y, width, height };
}

function makeSprite(texture, width, height, pivotY) {
  const material = new THREE.SpriteMaterial({
    map: texture,
    transparent: true,
    depthWrite: false,
    color: new THREE.Color().setScalar(BRIGHTNESS),
  });
  const sprite = new THREE.Sprite(material);
  sprite.center.set(0.5, pivotY);
  sprite.scale.set(width, height, 1);
  return sprite;
}

/**
 * Builds the paper doll and returns `{ root, parts }` — `root` is the
 * THREE.Group DungeonRenderer3D adds to the scene and moves every frame;
 * `parts` exposes the four limb Sprites (`legL/legR/armL/armR`) whose
 * `material.rotation` DungeonRenderer3D animates for the walk cycle.
 */
export function buildPlayerModel(s) {
  const root = new THREE.Group();
  const TOTAL_HEIGHT_WORLD = s * 0.8;
  const worldPerPx = TOTAL_HEIGHT_WORLD / IMG_H;

  const bodyBox = { x0: 0, y0: 0, x1: IMG_W, y1: IMG_H };
  const bodyPlaced = imageBoxToWorld(bodyBox, worldPerPx, false);
  const bodySprite = makeSprite(loadTexture('artius_chibi_body.png'), bodyPlaced.width, bodyPlaced.height, 0.5);
  bodySprite.position.set(bodyPlaced.x, bodyPlaced.y, 0);
  root.add(bodySprite);

  function makeLimb(key, filename, zOffset) {
    const placed = imageBoxToWorld(PIVOT_BOXES[key], worldPerPx, true);
    const sprite = makeSprite(loadTexture(filename), placed.width, placed.height, 1.0);
    sprite.position.set(placed.x, placed.y, zOffset);
    root.add(sprite);
    return sprite;
  }
  const legL = makeLimb('legL', 'artius_chibi_leg_l.png', -s * 0.02);
  const legR = makeLimb('legR', 'artius_chibi_leg_r.png', -s * 0.02);
  const armL = makeLimb('armL', 'artius_chibi_arm_l.png', s * 0.02);
  const armR = makeLimb('armR', 'artius_chibi_arm_r.png', s * 0.02);

  return {
    root,
    parts: {
      legL, legR, armL, armR,
    },
  };
}

/** Frees every sprite's material/texture under `root` — call once from DungeonRenderer3D.unmount(). */
export function disposePlayerModel(root) {
  if (!root) return;
  root.traverse((obj) => {
    if (!obj.isSprite) return;
    obj.material.map?.dispose();
    obj.material.dispose();
  });
}
