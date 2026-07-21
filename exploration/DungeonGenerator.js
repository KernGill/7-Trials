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
 * Maze-like dungeon: starts all-WALL, then random-walks a connected path
 * of `tilesPerFloor` floor tiles from the center. Only carved tiles are
 * ever rendered, so the map reads as an actual dungeon shape rather
 * than a filled rectangle. Carving is confined to the interior (never the
 * outermost ring of the grid), so that ring stays permanent wall and the
 * floor always reads as a sealed space — no separate border-wrap step
 * needed. Stairs are always placed on an edge tile of that carveable
 * interior (per design doc) so they can't wall off enemy/treasure tiles,
 * and are still guaranteed a wall just beyond them either way.
 * Regenerated fresh every time the player takes the stairs.
 *
 * The walk itself is biased toward long straight runs (STRAIGHT_BIAS) and
 * refuses to carve a cell that would complete a 2x2 open block — a plain
 * memoryless random walk tends to double back on itself into small open
 * blobs near the start point; this keeps corridors narrow and winding (a
 * real labyrinth) instead, while still allowing normal branches/forks.
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

    let cx = Math.floor(width / 2);
    let cy = Math.floor(height / 2);
    const carved = [at(cx, cy)];
    carved[0].type = TILE_TYPES.FLOOR;

    // Carveable interior excludes the outermost ring on every side, which
    // is what keeps that ring permanently WALL without padding the grid.
    const target = Math.min(this.arcConfig.tilesPerFloor ?? 50, (width - 2) * (height - 2) - 1);
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

    const startTile = carved[0];
    const isEdge = (t) => t.x === 1 || t.y === 1 || t.x === width - 2 || t.y === height - 2;
    const edgeCandidates = carved.filter((t) => t !== startTile && isEdge(t));
    const stairsTile = edgeCandidates.length ? shuffle(edgeCandidates)[0]
      : shuffle(carved.filter((t) => t !== startTile))[0];
    stairsTile.type = TILE_TYPES.STAIRS;

    const remaining = shuffle(carved.filter((t) => t !== startTile && t !== stairsTile));
    const enemyCount = Math.min(3, this.arcConfig.enemiesPerFloor ?? 3, remaining.length);
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

    const lockedRoomTile = remaining[enemyCount];
    if (lockedRoomTile) {
      lockedRoomTile.type = TILE_TYPES.LOCKED_DOOR;
      lockedRoomTile.meta.lockDifficulty = 10 + floor;
    }

    const treasureTile = remaining[enemyCount + 1];
    if (treasureTile) {
      treasureTile.type = TILE_TYPES.TREASURE;
    }

    const temporalChestTile = remaining[enemyCount + 2];
    if (temporalChestTile) {
      temporalChestTile.type = TILE_TYPES.TEMPORAL_CHEST;
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
