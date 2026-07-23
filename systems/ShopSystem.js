import { ITEM_STATES, GOLD_REWARD_RATIO, enemyStatMultiplierForFloor } from '../utils/Constants.js';
import { getShopItems, getItemConfig } from '../data/items.js';
import { getShopConsumables, getConsumableConfig } from '../data/consumables.js';
import { getAllEnemies } from '../data/enemies.js';
import { t, tData } from '../ui/i18n.js';

// Sell pricing for equipment that's exclusively obtainable via enemy drop
// (item.price === null — see data/items.js's `unlock: { dropOnly: true }`
// items) has no shop price to halve, so it's priced instead against what
// killing enemies is actually worth: the gold+materials a player would get
// from killing SELL_KILL_COUNT copies of its source enemy, evaluated at a
// fixed SELL_REFERENCE_FLOOR so the price doesn't drift with the player's
// current run floor.
const SELL_KILL_COUNT = 5;
const SELL_REFERENCE_FLOOR = 1;

/**
 * Finds the enemy whose drop table includes this equipment item,
 * preferring a non-boss variant when both a regular and boss version can
 * drop it (e.g. indebted_fallen vs indebted_fallen_boss both drop
 * bone_sword) — the boss is a rarer, tougher outlier, not representative
 * of "how much this item is worth" to kill for.
 */
function findDropSourceEnemy(itemId) {
  const candidates = getAllEnemies().filter(
    (e) => e.drops?.items?.some((d) => d.id === itemId && !d.isConsumable),
  );
  return candidates.find((e) => !e.isBoss) ?? candidates[0] ?? null;
}

/**
 * Expected gold+materials from killing `count` copies of `enemy` on
 * `floor`, using the same gold formula CombatManager.finishVictory() uses
 * for a live kill (health * GOLD_REWARD_RATIO, floor-scaled the same way
 * StateManager.startCombat() scales a fresh Enemy's stats) — but material
 * *quantities* use their statistical expected value (chance% * the
 * average of the roll range) rather than an actual random roll, since a
 * sell price needs to be one stable number, not a fresh roll every time
 * the shop re-renders.
 */
function expectedKillRewards(enemy, floor, count) {
  const mult = enemyStatMultiplierForFloor(floor);
  const scaledCon = Math.round(enemy.baseStats.con * mult);
  const gold = Math.floor(scaledCon * GOLD_REWARD_RATIO) * count;

  const materials = {};
  (enemy.drops?.materials ?? []).forEach((drop) => {
    const [min, max] = drop.quantity;
    const expectedPerKill = (drop.chance / 100) * ((min + max) / 2);
    const total = Math.round(expectedPerKill * count);
    if (total > 0) materials[drop.id] = total;
  });

  return { gold, materials };
}

export class ShopSystem {
  constructor(gameState, inventorySystem, progressionSystem) {
    this.gameState = gameState;
    this.inventory = inventorySystem;
    this.progression = progressionSystem;
  }

  /**
   * `category` splits the old single flat (gold-sorted) list into
   * 'equipment' / 'consumables' — consumables used to get lost between
   * mid-tier equipment rows since everything sorted purely by gold price.
   * Omit (or pass 'all') for the combined list.
   */
  getListings(category = 'all') {
    const items = category === 'consumables' ? [] : getShopItems().map((item) => this.buildListing(item, 'item'));
    const consumables = category === 'equipment' ? [] : getShopConsumables().map((c) => this.buildListing(c, 'consumable'));
    return [...items, ...consumables].sort((a, b) => a.sortOrder - b.sortOrder);
  }

  buildListing(config, type) {
    const unlocked = this.progression.meetsUnlockCondition(config.unlock);
    const state = unlocked ? ITEM_STATES.FOR_SALE : ITEM_STATES.LOCKED;
    const ownedCount = type === 'item' ? this.inventory.getOwnedCount(config.id) : 0;

    return {
      id: config.id,
      name: config.name,
      type,
      flavour: config.flavour,
      price: config.price,
      state,
      ownedCount,
      stats: config.stats,
      score: config.score,
      unlock: config.unlock,
      // Equipment sorts by its 1-10 power score first (so the shop reads
      // as a genuine progression) then gold within a tier; consumables
      // have no score and just sort by gold as before.
      sortOrder: type === 'item' ? (config.score ?? 0) * 1000000 + (config.price?.gold ?? 0) : (config.price?.gold ?? 9999),
      visual: config.visual,
    };
  }

  canBuy(listing) {
    if (listing.state === ITEM_STATES.LOCKED) {
      return { ok: false, reason: 'You do not meet the requirements to purchase this item.' };
    }
    const price = listing.price ?? {};
    if ((this.gameState.player.gold ?? 0) < (price.gold ?? 0)) {
      return { ok: false, reason: 'Not enough gold.' };
    }
    if (!this.inventory.canAffordMaterials(price.materials ?? {})) {
      return { ok: false, reason: 'Not enough materials.' };
    }
    if (price.consumables) {
      const missing = Object.entries(price.consumables).some(
        ([id, amt]) => this.inventory.getConsumableCount(id, false) < amt,
      );
      if (missing) return { ok: false, reason: 'Not enough materials.' };
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

    const name = tData(listing.type === 'item' ? 'item' : 'consumable', listing.id, listing.name);
    this.gameState.addLog(t('log.purchased_item', { name }));
    return { ok: true };
  }

  /**
   * Gold+materials refunded for selling one copy of `itemId`. Shop-
   * purchasable equipment (has a `price`) sells for half its listed
   * price; equipment that's exclusively obtainable via enemy drop
   * (`price: null`, `unlock: { dropOnly: true }`) has no shop price to
   * halve, so it's priced against SELL_KILL_COUNT kills of its source
   * enemy on SELL_REFERENCE_FLOOR instead (see expectedKillRewards above).
   */
  getSellPrice(itemId) {
    const config = getItemConfig(itemId);
    if (!config) return { gold: 0, materials: {} };
    if (config.price) {
      return {
        gold: Math.floor((config.price.gold ?? 0) / 2),
        materials: Object.fromEntries(
          Object.entries(config.price.materials ?? {}).map(([id, amt]) => [id, Math.floor(amt / 2)]),
        ),
      };
    }
    const enemy = findDropSourceEnemy(itemId);
    if (!enemy) return { gold: 0, materials: {} };
    return expectedKillRewards(enemy, SELL_REFERENCE_FLOOR, SELL_KILL_COUNT);
  }

  /** Every owned equipment item (regardless of shop-buy visibility — drop-only gear is never a "buy" listing but is still sellable) with its computed sell price attached. */
  getSellableListings() {
    return this.inventory.getOwnedItems().map((item) => ({
      id: item.id,
      name: item.name,
      flavour: item.flavour,
      visual: item.visual,
      ownedCount: item.ownedCount,
      sellPrice: this.getSellPrice(item.id),
    })).sort((a, b) => b.sellPrice.gold - a.sellPrice.gold);
  }

  canSell(itemId) {
    if (!this.inventory.ownsItem(itemId)) return { ok: false, reason: 'Item not owned.' };
    return { ok: true };
  }

  sell(itemId) {
    const check = this.canSell(itemId);
    if (!check.ok) return check;

    const price = this.getSellPrice(itemId);
    this.gameState.player.gold += price.gold;
    Object.entries(price.materials).forEach(([id, amt]) => {
      if (amt > 0) this.inventory.addMaterial(id, amt, false);
    });
    this.inventory.removeItem(itemId, 1);

    const config = getItemConfig(itemId);
    const name = tData('item', itemId, config?.name ?? itemId);
    this.gameState.addLog(t('log.sold_item', { name }));
    return { ok: true };
  }
}
