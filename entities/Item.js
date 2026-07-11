import { getItemConfig } from '../data/items.js';

export class Item {
  constructor(itemId) {
    const config = getItemConfig(itemId);
    if (!config) throw new Error(`Unknown item: ${itemId}`);
    this.config = config;
    this.instanceId = `${itemId}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  }

  get id() { return this.config.id; }
  get name() { return this.config.name; }
  get type() { return this.config.type; }
  get stats() { return this.config.stats ?? {}; }
  get moveIds() { return this.config.moveIds ?? []; }
  get visual() { return this.config.visual ?? {}; }
  get twoHanded() { return this.config.twoHanded ?? false; }

  static fromId(itemId) {
    return new Item(itemId);
  }
}
