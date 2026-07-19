import { TILE_TYPES, Tile } from './Tile.js';
import { randomInt, shuffle } from '../utils/MathUtils.js';

const DIRS = [[0, -1], [0, 1], [-1, 0], [1, 0]];

const CARVE_DENSITY = 0.3125; // target carved-tile fraction of the grid

/** Derives a 5:4-ish grid big enough to comfortably carve `tilesPerFloor` floor tiles. */
function computeDungeonDimensions(tilesPerFloor) {
  const area = tilesPerFloor / CARVE_DENSITY;
  const width = Math.round(Math.sqrt(area * 1.25));
  const height = Math.round(width * 0.8);
  return { width, height };
}

/**
 * Organic dungeon: starts all-WALL, then random-walks a connected path
 * of `tilesPerFloor` floor tiles from the center. Only carved tiles are
 * ever rendered, so the map reads as an actual dungeon shape rather
 * than a filled rectangle. Stairs are always placed on an edge tile
 * (per design doc) so they can't wall off enemy/treasure tiles.
 * Regenerated fresh every time the player takes the stairs.
 */
export class DungeonGenerator {
  constructor(arcConfig) {
    this.arcConfig = arcConfig;
  }

  generate(floor, seed = Date.now()) {
    const { width, height } = computeDungeonDimensions(this.arcConfig.tilesPerFloor ?? 50);
    const tiles = [];
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        tiles.push(new Tile(x, y, TILE_TYPES.WALL));
      }
    }
    const at = (x, y) => tiles.find((t) => t.x === x && t.y === y);

    let cx = Math.floor(width / 2);
    let cy = Math.floor(height / 2);
    const carved = [at(cx, cy)];
    carved[0].type = TILE_TYPES.FLOOR;

    const target = Math.min(this.arcConfig.tilesPerFloor ?? 50, width * height - 1);
    let guard = 0;
    while (carved.length < target && guard < 10000) {
      guard += 1;
      const [dx, dy] = DIRS[randomInt(0, 3)];
      const nx = cx + dx;
      const ny = cy + dy;
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
      cx = nx;
      cy = ny;
      const tile = at(cx, cy);
      if (tile.type === TILE_TYPES.WALL) {
        tile.type = TILE_TYPES.FLOOR;
        carved.push(tile);
      }
    }

    const startTile = carved[0];
    const isEdge = (t) => t.x === 0 || t.y === 0 || t.x === width - 1 || t.y === height - 1;
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

    // Wrap the carved interior in a 1-tile border of permanent walls so no
    // carved tile — including the stairs, which are deliberately placed on
    // an edge tile above — is ever exposed to open void at the map
    // boundary. The whole floor reads as a sealed space from any angle.
    const outerWidth = width + 2;
    const outerHeight = height + 2;
    const bordered = [];
    for (let y = 0; y < outerHeight; y += 1) {
      for (let x = 0; x < outerWidth; x += 1) {
        bordered.push(new Tile(x, y, TILE_TYPES.WALL));
      }
    }
    const atOuter = (x, y) => bordered[y * outerWidth + x];
    tiles.forEach((tile) => {
      const shifted = atOuter(tile.x + 1, tile.y + 1);
      shifted.type = tile.type;
      shifted.meta = tile.meta;
      shifted.explored = tile.explored;
    });

    return {
      floor,
      seed,
      width: outerWidth,
      height: outerHeight,
      tiles: bordered,
      tilesTotal: carved.length,
      tilesExplored: 0,
      playerPos: { x: startTile.x + 1, y: startTile.y + 1 },
      enemiesRemaining: enemyCount,
    };
  }
}
