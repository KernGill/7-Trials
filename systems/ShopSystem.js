import { ITEM_STATES } from '../utils/Constants.js';
import { getShopItems, getItemConfig } from '../data/items.js';
import { getShopConsumables, getConsumableConfig } from '../data/consumables.js';

export class ShopSystem {
  constructor(gameState, inventorySystem, progressionSystem) {
    this.gameState = gameState;
    this.inventory = inventorySystem;
    this.progression = progressionSystem;
  }

  getListings() {
    const items = getShopItems().map((item) => this.buildListing(item, 'item'));
    const consumables = getShopConsumables().map((c) => this.buildListing(c, 'consumable'));
    return [...items, ...consumables].sort((a, b) => a.sortOrder - b.sortOrder);
  }

  buildListing(config, type) {
    const unlocked = this.progression.meetsUnlockCondition(config.unlock);
    let state = unlocked ? ITEM_STATES.FOR_SALE : ITEM_STATES.LOCKED;
    if (type === 'item' && this.inventory.ownsItem(config.id)) state = ITEM_STATES.BOUGHT;

    return {
      id: config.id,
      name: config.name,
      type,
      flavour: config.flavour,
      price: config.price,
      state,
      stats: config.stats,
      unlock: config.unlock,
      sortOrder: config.price?.gold ?? 9999,
      visual: config.visual,
    };
  }

  canBuy(listing) {
    if (listing.state === ITEM_STATES.LOCKED) {
      return { ok: false, reason: 'You do not meet the requirements to purchase this item.' };
    }
    if (listing.state === ITEM_STATES.BOUGHT) {
      return { ok: false, reason: 'Already owned.' };
    }
    const price = listing.price ?? {};
    if ((this.gameState.player.gold ?? 0) < (price.gold ?? 0)) {
      return { ok: false, reason: 'Not Enough Gold.' };
    }
    if (!this.inventory.canAffordMaterials(price.materials ?? {})) {
      return { ok: false, reason: 'Not Enough Materials.' };
    }
    if (price.consumables) {
      const missing = Object.entries(price.consumables).some(
        ([id, amt]) => this.inventory.getConsumableCount(id, false) < amt,
      );
      if (missing) return { ok: false, reason: 'Not Enough Materials.' };
    }
    return { ok: true };
  }

  buy(listingId) {
    const listing = this.getListings().find((l) => l.id === listingId);
    if (!listing) return { ok: false, reason: 'Item not found.' };

    const check = this.canBuy(listing);
    if (!check.ok) return check;

    const price = listing.price ?? {};
    this.gameState.player.gold -= price.gold ?? 0;
    this.inventory.spendMaterials(price.materials ?? {}, false);
    if (price.consumables) {
      Object.entries(price.consumables).forEach(([id, amt]) => {
        this.inventory.useConsumable(id, amt);
      });
    }

    if (listing.type === 'item') {
      this.inventory.addItem(listing.id);
    } else {
      this.inventory.addConsumable(listing.id, 1, false);
    }

    this.gameState.addLog(`Purchased ${listing.name}.`);
    return { ok: true };
  }
}
