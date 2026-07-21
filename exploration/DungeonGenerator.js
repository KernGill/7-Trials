import { TILE_TYPES, Tile } from './Tile.js';
import { randomInt, shuffle } from '../utils/MathUtils.js';

const DIRS = [[0, -1], [0, 1], [-1, 0], [1, 0]];

const CARVE_DENSITY = 0.3125; // target carved-tile fraction of the grid

// Momentum-biased, anti-clump random walk (see generate()'s block comment
// below for why): STRAIGHT_BIAS favors continuing in the same direction,
// producing long corridor runs instead of aimless wandering; carving is
// rejected whenever it would complete a 2x2 open square (see
// wouldFormOpenBlock), which is what actually reads as a "room"/clump —
// a plain per-cell neighbor-count cap doesn't prevent this, since a cell
// carved with a low neighbor count at the time can still be pushed into
// a blob later by *other*, unrelated carves that each individually look fine.
const STRAIGHT_BIAS = 0.7;

const LOCKED_DOOR_COUNT = 3;
const TREASURE_COUNT = 2;
const TEMPORAL_CHEST_COUNT = 1;

// Open flat rooms (per user request), placed before the maze walker runs
// and chain-connected so they're always reachable. Room count scales
// gently with floor size instead of being a flat constant.
const ROOM_MIN_SIZE = 4;
const ROOM_MAX_SIZE = 5;
const ROOM_PADDING = 2; // keeps rooms off the outer permanent-wall ring, plus a 1-tile buffer so rooms never touch each other directly
const ROOM_PLACEMENT_ATTEMPTS = 30;

// Corridor widening: rolled per corridor tile so "most" hallways end up
// two-wide without making literally all of them uniform (per user request
// to "leave a decent amount of gaps").
const WIDEN_CHANCE = 0.65;

// Extra loop connections punched through thin walls between two nearby
// corridor strands, on top of the base (fairly tree-like) maze — this is
// what makes hallways actually interconnect rather than just branch.
const EXTRA_CONNECTION_RATIO = 0.04;

/** True if carving (cx,cy) would complete any of the four 2x2 blocks it could be a corner of. */
function wouldFormOpenBlock(at, cx, cy) {
  const isFloor = (x, y) => {
    if (x === cx && y === cy) return true; // the candidate cell itself, about to become floor
    const t = at(x, y);
    return !!t && t.type !== TILE_TYPES.WALL;
  };
  const blocks = [
    [[0, 0], [1, 0], [0, 1], [1, 1]],
    [[-1, 0], [0, 0], [-1, 1], [0, 1]],
    [[0, -1], [1, -1], [0, 0], [1, 0]],
    [[-1, -1], [0, -1], [-1, 0], [0, 0]],
  ];
  return blocks.some((corners) => corners.every(([dx, dy]) => isFloor(cx + dx, cy + dy)));
}

/** Derives a 5:4-ish grid big enough to comfortably carve `tilesPerFloor` floor tiles. */
function computeDungeonDimensions(tilesPerFloor) {
  const area = tilesPerFloor / CARVE_DENSITY;
  const width = Math.round(Math.sqrt(area * 1.25));
  const height = Math.round(width * 0.8);
  return { width, height };
}

/**
 * Places up to `count` flat 4x4/5x5 open rooms at random non-overlapping
 * interior spots (with a 1-tile buffer so rooms never directly touch each
 * other). Carved immediately as FLOOR — rooms are deliberately open, so
 * they bypass the walker's anti-2x2-block rule entirely. Returns the
 * placed rooms (cells + center), in placement order; a room is silently
 * skipped if no valid spot is found within ROOM_PLACEMENT_ATTEMPTS.
 */
function placeRooms(at, width, height, count) {
  const rooms = [];
  for (let i = 0; i < count; i += 1) {
    for (let attempt = 0; attempt < ROOM_PLACEMENT_ATTEMPTS; attempt += 1) {
      const size = randomInt(ROOM_MIN_SIZE, ROOM_MAX_SIZE);
      const maxX0 = width - ROOM_PADDING - size;
      const maxY0 = height - ROOM_PADDING - size;
      if (maxX0 < ROOM_PADDING || maxY0 < ROOM_PADDING) break; // grid too small for this room size — give up on this room
      const x0 = randomInt(ROOM_PADDING, maxX0);
      const y0 = randomInt(ROOM_PADDING, maxY0);

      let clear = true;
      for (let y = y0 - 1; y <= y0 + size && clear; y += 1) {
        for (let x = x0 - 1; x <= x0 + size && clear; x += 1) {
          const t = at(x, y);
          if (!t || t.type !== TILE_TYPES.WALL) clear = false;
        }
      }
      if (!clear) continue;

      const cells = [];
      for (let y = y0; y < y0 + size; y += 1) {
        for (let x = x0; x < x0 + size; x += 1) {
          const t = at(x, y);
          t.type = TILE_TYPES.FLOOR;
          cells.push(t);
        }
      }
      rooms.push({ cells, centerX: x0 + Math.floor(size / 2), centerY: y0 + Math.floor(size / 2) });
      break;
    }
  }
  return rooms;
}

/** Carves a straight L-shaped 1-wide connector between two points, ignoring the maze's normal 2x2 rule (a deliberate constructed link, not organic maze). Returns the newly-carved tiles. */
function carveLine(at, x0, y0, x1, y1) {
  const carvedHere = [];
  const carveCell = (x, y) => {
    const t = at(x, y);
    if (t && t.type === TILE_TYPES.WALL) {
      t.type = TILE_TYPES.FLOOR;
      carvedHere.push(t);
    }
  };
  let cx = x0;
  let cy = y0;
  const horizontalFirst = Math.random() < 0.5;
  const stepX = () => { cx += Math.sign(x1 - cx); carveCell(cx, cy); };
  const stepY = () => { cy += Math.sign(y1 - cy); carveCell(cx, cy); };
  if (horizontalFirst) {
    while (cx !== x1) stepX();
    while (cy !== y1) stepY();
  } else {
    while (cy !== y1) stepY();
    while (cx !== x1) stepX();
  }
  return carvedHere;
}

/** Widens roughly WIDEN_CHANCE of corridor tiles by one cell, perpendicular to the corridor's local direction, so most hallways read as two-wide without being perfectly uniform. */
function widenCorridors(at, carved, width, height) {
  const candidates = carved.filter((t) => t.type === TILE_TYPES.FLOOR);
  candidates.forEach((tile) => {
    if (Math.random() > WIDEN_CHANCE) return;
    const west = at(tile.x - 1, tile.y);
    const east = at(tile.x + 1, tile.y);
    const north = at(tile.x, tile.y - 1);
    const south = at(tile.x, tile.y + 1);
    const westFloor = west?.type !== TILE_TYPES.WALL;
    const eastFloor = east?.type !== TILE_TYPES.WALL;
    const northFloor = north?.type !== TILE_TYPES.WALL;
    const southFloor = south?.type !== TILE_TYPES.WALL;
    const horizontal = (westFloor || eastFloor) && !(northFloor && southFloor);
    const vertical = (northFloor || southFloor) && !(westFloor && eastFloor);

    let candidate = null;
    if (horizontal) candidate = Math.random() < 0.5 ? north : south;
    else if (vertical) candidate = Math.random() < 0.5 ? west : east;

    if (candidate && candidate.type === TILE_TYPES.WALL
      && candidate.x > 0 && candidate.y > 0 && candidate.x < width - 1 && candidate.y < height - 1) {
      candidate.type = TILE_TYPES.FLOOR;
      carved.push(candidate);
    }
  });
}

/** Punches `count` extra connections through thin (1-tile) walls sandwiched between two already-carved corridor strands, adding loops/interconnection on top of the base tree-like maze. */
function addExtraConnections(at, carved, width, height, count) {
  const candidates = [];
  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const tile = at(x, y);
      if (tile.type !== TILE_TYPES.WALL) continue;
      const westFloor = at(x - 1, y)?.type !== TILE_TYPES.WALL;
      const eastFloor = at(x + 1, y)?.type !== TILE_TYPES.WALL;
      const northFloor = at(x, y - 1)?.type !== TILE_TYPES.WALL;
      const southFloor = at(x, y + 1)?.type !== TILE_TYPES.WALL;
      if ((westFloor && eastFloor) || (northFloor && southFloor)) candidates.push(tile);
    }
  }
  shuffle(candidates).slice(0, count).forEach((tile) => {
    tile.type = TILE_TYPES.FLOOR;
    carved.push(tile);
  });
}

/**
 * Maze-like dungeon with embedded open rooms: a handful of flat 4x4/5x5
 * rooms are placed and chain-connected first, then a random walk carves
 * a connected web of corridors out from the first room to fill the rest
 * of `tilesPerFloor`, followed by a widening pass (most hallways end up
 * two-wide) and an extra-connections pass (more loops/interconnection).
 * Only carved tiles are ever rendered, so the map reads as an actual
 * dungeon shape rather than a filled rectangle. Carving is confined to
 * the interior (never the outermost ring of the grid), so that ring stays
 * permanent wall and the floor always reads as a sealed space — no
 * separate border-wrap step needed. Stairs are always placed on an edge
 * tile of that carveable interior (per design doc) so they can't wall off
 * enemy/treasure tiles, and are still guaranteed a wall just beyond them
 * either way. Regenerated fresh every time the player takes the stairs.
 *
 * The walker itself is biased toward long straight runs (STRAIGHT_BIAS)
 * and refuses to carve a cell that would complete a 2x2 open block — a
 * plain memoryless random walk tends to double back on itself into small
 * open blobs near the start point; this keeps the *walker's own* corridors
 * narrow and winding (a real labyrinth), while the rooms/widening/extra-
 * connections passes deliberately add back open space, width, and loops
 * on top of that skeleton.
 */
export class DungeonGenerator {
  constructor(arcConfig) {
    this.arcConfig = arcConfig;
  }

  generate(floor, seed = Date.now()) {
    const { width, height } = computeDungeonDimensions(this.arcConfig.tilesPerFloor ?? 50);
    const tiles = [];
    const byKey = new Map();
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const tile = new Tile(x, y, TILE_TYPES.WALL);
        tiles.push(tile);
        byKey.set(`${x},${y}`, tile);
      }
    }
    // O(1) lookup — at large tile counts (500+) the old tiles.find() linear
    // scan, called on every step of a carve loop that can run tens of
    // thousands of iterations, became a real bottleneck.
    const at = (x, y) => byKey.get(`${x},${y}`);

    // Carveable interior excludes the outermost ring on every side, which
    // is what keeps that ring permanently WALL without padding the grid.
    const target = Math.min(this.arcConfig.tilesPerFloor ?? 50, (width - 2) * (height - 2) - 1);
    const carved = [];

    const roomCount = Math.max(2, Math.min(8, Math.floor(target / 70)));
    const rooms = placeRooms(at, width, height, roomCount);
    rooms.forEach((room) => carved.push(...room.cells));
    for (let i = 1; i < rooms.length; i += 1) {
      carved.push(...carveLine(at, rooms[i - 1].centerX, rooms[i - 1].centerY, rooms[i].centerX, rooms[i].centerY));
    }

    // The walker starts inside the first room (guaranteed already
    // connected via the chain above) — falls back to the map center if no
    // room could be placed at all (e.g. a very small grid).
    let cx = rooms[0]?.centerX ?? Math.floor(width / 2);
    let cy = rooms[0]?.centerY ?? Math.floor(height / 2);
    const startTile = at(cx, cy);
    if (startTile.type === TILE_TYPES.WALL) {
      startTile.type = TILE_TYPES.FLOOR;
      carved.push(startTile);
    }

    let lastDir = null;
    let guard = 0;
    // Anti-clump rejection means not every attempted step carves a tile —
    // scale the attempt budget with the target instead of a flat constant.
    const guardLimit = Math.max(10000, target * 150);
    while (carved.length < target && guard < guardLimit) {
      guard += 1;
      const useMomentum = lastDir && Math.random() < STRAIGHT_BIAS;
      const [dx, dy] = useMomentum ? lastDir : DIRS[randomInt(0, 3)];
      const nx = cx + dx;
      const ny = cy + dy;
      if (nx < 1 || ny < 1 || nx >= width - 1 || ny >= height - 1) {
        lastDir = null; // hit the boundary — drop momentum, re-roll fresh next step
        continue;
      }
      cx = nx;
      cy = ny;
      lastDir = [dx, dy];
      const tile = at(cx, cy);
      if (tile.type === TILE_TYPES.WALL) {
        // The walker's position advances even on a step it declines to
        // carve (see the boundary/2x2 checks above and below) — without
        // requiring an existing floor neighbor here, a later carve could
        // land on a cell only reachable through one of those declined
        // tiles, orphaning it from the rest of the floor.
        const touchesExistingFloor = DIRS.some(([ddx, ddy]) => {
          const neighbor = at(cx + ddx, cy + ddy);
          return neighbor && neighbor.type !== TILE_TYPES.WALL;
        });
        if (touchesExistingFloor && !wouldFormOpenBlock(at, cx, cy)) {
          tile.type = TILE_TYPES.FLOOR;
          carved.push(tile);
        }
      }
    }

    widenCorridors(at, carved, width, height);
    addExtraConnections(at, carved, width, height, Math.round(target * EXTRA_CONNECTION_RATIO));

    const isEdge = (t) => t.x === 1 || t.y === 1 || t.x === width - 2 || t.y === height - 2;
    const edgeCandidates = carved.filter((t) => t !== startTile && isEdge(t));
    const stairsTile = edgeCandidates.length ? shuffle(edgeCandidates)[0]
      : shuffle(carved.filter((t) => t !== startTile))[0];
    stairsTile.type = TILE_TYPES.STAIRS;

    const remaining = shuffle(carved.filter((t) => t !== startTile && t !== stairsTile));
    const enemyCount = Math.min(this.arcConfig.enemiesPerFloor ?? 5, remaining.length);
    for (let i = 0; i < enemyCount; i += 1) {
      remaining[i].type = TILE_TYPES.ENEMY;
      remaining[i].meta.enemySpawn = true;
    }

    // Boss floor: exactly ONE of the enemy tiles is the boss, not every
    // enemy tile on that floor. (Previously the boss check was purely
    // floor-based with no tile distinction, so every enemy encounter on
    // the boss floor silently WAS the boss — killing any of them
    // completed the arc and flipped the enemy pool over to the next
    // arc's roster.)
    const isBossFloor = floor === this.arcConfig.bossFloor;
    if (isBossFloor && enemyCount > 0) {
      remaining[0].meta.isBoss = true;
    }

    for (let i = 0; i < LOCKED_DOOR_COUNT; i += 1) {
      const lockedRoomTile = remaining[enemyCount + i];
      if (lockedRoomTile) {
        lockedRoomTile.type = TILE_TYPES.LOCKED_DOOR;
        lockedRoomTile.meta.lockDifficulty = 10 + floor;
      }
    }

    for (let i = 0; i < TREASURE_COUNT; i += 1) {
      const treasureTile = remaining[enemyCount + LOCKED_DOOR_COUNT + i];
      if (treasureTile) {
        treasureTile.type = TILE_TYPES.TREASURE;
      }
    }

    for (let i = 0; i < TEMPORAL_CHEST_COUNT; i += 1) {
      const temporalChestTile = remaining[enemyCount + LOCKED_DOOR_COUNT + TREASURE_COUNT + i];
      if (temporalChestTile) {
        temporalChestTile.type = TILE_TYPES.TEMPORAL_CHEST;
      }
    }

    return {
      floor,
      seed,
      width,
      height,
      tiles,
      tilesTotal: carved.length,
      tilesExplored: 0,
      playerPos: { x: startTile.x, y: startTile.y },
      enemiesRemaining: enemyCount,
    };
  }
}
