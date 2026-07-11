import { TILE_TYPES, Tile } from './Tile.js';
import { randomInt, shuffle } from '../utils/MathUtils.js';

const DIRS = [[0, -1], [0, 1], [-1, 0], [1, 0]];

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
    const width = 14;
    const height = 10;
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
    const lockedRoomTile = remaining[enemyCount];
    if (lockedRoomTile) {
      lockedRoomTile.type = TILE_TYPES.LOCKED_DOOR;
      lockedRoomTile.meta.lockDifficulty = 10 + floor;
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
