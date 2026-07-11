export const TILE_TYPES = {
  FLOOR: 'floor',
  WALL: 'wall',
  STAIRS: 'stairs',
  ENEMY: 'enemy',
  TREASURE: 'treasure',
  TRAP: 'trap',
  LOCKED_DOOR: 'locked_door',
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
}
