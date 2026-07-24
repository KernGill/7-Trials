export const TILE_TYPES = {
  FLOOR: 'floor',
  WALL: 'wall',
  STAIRS: 'stairs',
  ENEMY: 'enemy',
  TREASURE: 'treasure',
  TRAP: 'trap',
  LOCKED_DOOR: 'locked_door',
  TEMPORAL_CHEST: 'temporal_chest',
  // A secret, non-tracked enemy tile — see DungeonGenerator's floor-5
  // hidden-arena pass. Deliberately excluded from ExploreState's
  // "remaining events" HUD counter and from tilesTotal/tilesExplored, so
  // it never shows up as a discoverable objective.
  HIDDEN_ENEMY: 'hidden_enemy',
};

export class Tile {
  constructor(x, y, type = TILE_TYPES.FLOOR, meta = {}) {
    this.x = x;
    this.y = y;
    this.type = type;
    this.explored = false;
    this.visible = false;
    this.meta = meta;
  }

  isWalkable() {
    return this.type !== TILE_TYPES.WALL;
  }

  /** Rehydrates a plain object (e.g. round-tripped through JSON via SaveSystem) back into a real Tile so isWalkable() etc. work again. */
  static fromJSON(obj) {
    const tile = new Tile(obj.x, obj.y, obj.type, obj.meta ?? {});
    tile.explored = !!obj.explored;
    tile.visible = !!obj.visible;
    return tile;
  }
}
