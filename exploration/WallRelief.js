import * as THREE from '../vendor/three/three.module.js';

/**
 * Real extruded brick relief for wall panels — raised brick boxes (a front
 * face + 4 "skirt" sides down to the flat panel plane) merged onto the
 * ordinary flat panel box, running-bond offset row to row like Textures.js's
 * painted brick pattern, covering the panel's FULL height. Only ONE side of
 * each panel gets relief (the side that actually faces into a room/corridor
 * — see `direction`), which is why DungeonRenderer3D.js now needs one
 * geometry per cardinal direction instead of the old shared NS/EW pair.
 *
 * Chunkier (fewer, bigger bricks) than the painted texture's own pattern on
 * purpose: this is real triangles rendered every frame across every visible
 * wall panel, so it trades a bit of visual fidelity for triangle count.
 *
 * The resulting geometry has TWO material groups (see `geometry.groups`):
 * group 0 is the ordinary flat box (unchanged — still gets the painted
 * texture as its `map`, same as before this file existed), group 1 is the
 * brick relief. Relief vertices carry NO texture UV worth sampling (their
 * `uv` is a dummy constant) — instead every vertex (both groups) gets an
 * `aoMultiplier` scalar (1 for the flat box and brick fronts, ~0.45 for the
 * shadowed skirts) baked into BOTH the `color` attribute (front) and a
 * standalone `aoMultiplier` attribute (torch geometries need it separately
 * — see writeTorchWallGeometryColors in DungeonRenderer3D.js, which
 * multiplies it into its own live per-frame color instead of reading
 * `color` directly). Group 1's material must have NO map and must reuse
 * the SAME dynamic `.color` (ambient) — same live per-frame Color object
 * as group 0's material — so relief bricks are tinted by the exact same
 * distance/moonlight/torch color as the rest of the wall instead of
 * rendering as flat, unlit, unmatched brick-gray. See DungeonRenderer3D.js
 * for how the two materials/groups are wired together.
 *
 * Nothing here does real lighting — this renderer has no THREE.Light
 * objects and uses MeshBasicMaterial everywhere (see DungeonRenderer3D.js)
 * — so the skirts' "shadow in the groove" read is the aoMultiplier trick
 * above, not real lighting. Material `side` must be THREE.DoubleSide —
 * winding is corrected per-triangle against a single known "outward"
 * direction (see addTriangle), which is robust but not guaranteed
 * pixel-perfect for the skirt faces (whose true normal isn't purely that
 * outward direction), so DoubleSide is the safety net that keeps a stray
 * backwards triangle from just vanishing.
 */

const BRICK_ROW_HEIGHT = 0.5;
const BRICK_WIDTH = 1;
const MORTAR_GAP = 0.06;
const BRICK_DEPTH = 0.08; // how far a brick front protrudes beyond the flat panel face
const BRICK_FRONT_AO = 1; // no darkening — the front face reads at full material color, same as the flat wall around it
const BRICK_SKIRT_AO = 0.45; // baked "shadow in the groove" — see module doc comment

const OUTWARD = {
  north: [0, 0, -1],
  south: [0, 0, 1],
  east: [1, 0, 0],
  west: [-1, 0, 0],
};

function toXYZ(u2x, w2x, u, v, w) {
  const p = [0, v, 0];
  p[u2x === 'x' ? 0 : 2] = u;
  p[w2x === 'x' ? 0 : 2] = w;
  return p;
}

function vert(pos, normal, uv, ao) {
  return { pos, normal, uv, ao };
}

/** Flips a triangle's winding (swaps its 2nd/3rd vertex) if its true geometric normal doesn't point toward `outward` — see the module doc comment. */
function addTriangle(list, outward, a, b, c) {
  const [ax, ay, az] = a.pos;
  const ux = b.pos[0] - ax; const uy = b.pos[1] - ay; const uz = b.pos[2] - az;
  const vx = c.pos[0] - ax; const vy = c.pos[1] - ay; const vz = c.pos[2] - az;
  const nx = uy * vz - uz * vy;
  const ny = uz * vx - ux * vz;
  const nz = ux * vy - uy * vx;
  const dot = nx * outward[0] + ny * outward[1] + nz * outward[2];
  if (dot < 0) list.push(a, c, b);
  else list.push(a, b, c);
}

function addQuad(list, outward, p0, p1, p2, p3) {
  addTriangle(list, outward, p0, p1, p2);
  addTriangle(list, outward, p0, p2, p3);
}

function emitBrick(list, outward, { uLeft, uRight, v0, v1, wBase, wFront, u2x, w2x }) {
  const corner = (u, v, w) => toXYZ(u2x, w2x, u, v, w);
  const uv = [0.5, 0.5]; // dummy — this vertex's material group has no map, see module doc comment
  const front = (pos) => vert(pos, outward, uv, BRICK_FRONT_AO);
  const skirt = (pos) => vert(pos, outward, uv, BRICK_SKIRT_AO);

  const fbl = corner(uLeft, v0, wFront); const fbr = corner(uRight, v0, wFront);
  const ftr = corner(uRight, v1, wFront); const ftl = corner(uLeft, v1, wFront);
  const bbl = corner(uLeft, v0, wBase); const bbr = corner(uRight, v0, wBase);
  const btr = corner(uRight, v1, wBase); const btl = corner(uLeft, v1, wBase);

  addQuad(list, outward, front(fbl), front(fbr), front(ftr), front(ftl));
  addQuad(list, outward, skirt(bbl), skirt(bbr), skirt(fbr), skirt(fbl)); // bottom
  addQuad(list, outward, skirt(ftl), skirt(ftr), skirt(btr), skirt(btl)); // top
  addQuad(list, outward, skirt(bbl), skirt(btl), skirt(ftl), skirt(fbl)); // left
  addQuad(list, outward, skirt(bbr), skirt(fbr), skirt(ftr), skirt(btr)); // right
}

function addBrickRelief(list, outward, { u2x, w2x, panelWidth, panelHeight, thickness, sign }) {
  const halfW = panelWidth / 2;
  const halfH = panelHeight / 2;
  const wBase = sign * (thickness / 2);
  const wFront = sign * (thickness / 2 + BRICK_DEPTH);
  const rows = Math.floor(panelHeight / BRICK_ROW_HEIGHT); // full panel height, not just a band near the floor — see module doc comment
  for (let row = 0; row < rows; row += 1) {
    const v0 = -halfH + row * BRICK_ROW_HEIGHT + MORTAR_GAP / 2;
    const v1 = -halfH + (row + 1) * BRICK_ROW_HEIGHT - MORTAR_GAP / 2;
    const rowOffset = row % 2 === 0 ? 0 : -BRICK_WIDTH / 2;
    let u = -halfW + rowOffset;
    while (u < halfW) {
      const uLeft = Math.max(u, -halfW) + MORTAR_GAP / 2;
      const uRight = Math.min(u + BRICK_WIDTH, halfW) - MORTAR_GAP / 2;
      if (uRight > uLeft) emitBrick(list, outward, { uLeft, uRight, v0, v1, wBase, wFront, u2x, w2x });
      u += BRICK_WIDTH;
    }
  }
}

/**
 * Builds one direction's relief wall panel geometry: the same flat box
 * DungeonRenderer3D.js used to build directly (back face + 4 thin edges +
 * the full front face, untouched — still there underneath as the mortar
 * plane) plus real brick-bump triangles merged on top of its outward face,
 * covering the panel's full height. See the module doc comment for the
 * resulting geometry's two material groups / aoMultiplier attribute.
 */
export function buildReliefWallGeometry({ direction, panelWidth, panelHeight, panelThickness, heightSegments }) {
  const isNS = direction === 'north' || direction === 'south';
  const sign = direction === 'south' || direction === 'east' ? 1 : -1;
  const u2x = isNS ? 'x' : 'z';
  const w2x = isNS ? 'z' : 'x';
  const outward = OUTWARD[direction];

  // toNonIndexed() first — BoxGeometry's raw position/normal/uv arrays are
  // INDEXED (unique vertices meant to be read through box.index), and this
  // function builds a plain triangle-soup array below (no index at all,
  // same as the brick relief triangles) where every 3 consecutive vertices
  // must already BE a triangle. Copying the indexed arrays directly here
  // silently mis-groups unrelated vertices into garbage triangles — the
  // bug behind an earlier broken-looking build of this geometry.
  const rawBox = isNS
    ? new THREE.BoxGeometry(panelWidth, panelHeight, panelThickness, 1, heightSegments, 1)
    : new THREE.BoxGeometry(panelThickness, panelHeight, panelWidth, 1, heightSegments, 1);
  const box = rawBox.toNonIndexed();
  rawBox.dispose();
  const basePos = Array.from(box.attributes.position.array);
  const baseNormal = Array.from(box.attributes.normal.array);
  const baseUv = Array.from(box.attributes.uv.array);
  box.dispose();
  const baseVertexCount = basePos.length / 3;
  const baseColor = new Array(baseVertexCount * 3).fill(BRICK_FRONT_AO);
  const baseAo = new Array(baseVertexCount).fill(BRICK_FRONT_AO);

  const tris = [];
  addBrickRelief(tris, outward, {
    u2x, w2x, panelWidth, panelHeight, thickness: panelThickness, sign,
  });
  const extraPos = []; const extraNormal = []; const extraUv = []; const extraColor = []; const extraAo = [];
  tris.forEach((v) => {
    extraPos.push(...v.pos);
    extraNormal.push(...v.normal);
    extraUv.push(...v.uv);
    extraColor.push(v.ao, v.ao, v.ao);
    extraAo.push(v.ao);
  });
  const reliefVertexCount = extraPos.length / 3;

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute([...basePos, ...extraPos], 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute([...baseNormal, ...extraNormal], 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute([...baseUv, ...extraUv], 2));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute([...baseColor, ...extraColor], 3));
  geometry.setAttribute('aoMultiplier', new THREE.Float32BufferAttribute([...baseAo, ...extraAo], 1));
  geometry.addGroup(0, baseVertexCount, 0);
  geometry.addGroup(baseVertexCount, reliefVertexCount, 1);
  return geometry;
}
