import { rollWeightedChoice, pickRandom } from '../utils/RandomUtils.js';

// 'god' is never rolled naturally (weight 0 in RARITY_WEIGHTS below) — the
// only way to get one is fusing two mythic cards at The Vendor (see
// fuseCards). Its color is white, per user request, distinct from every
// natural rarity.
export const RARITIES = ['common', 'uncommon', 'rare', 'epic', 'legendary', 'mythic', 'god'];
export const RARITY_WEIGHTS = [25, 25, 20, 15, 10, 5, 0];
export const RARITY_COLORS = {
  common: '#9e9e9e',
  uncommon: '#2ecc71',
  rare: '#3498db',
  epic: '#9b59b6',
  legendary: '#f1c40f',
  mythic: '#e74c3c',
  god: '#ffffff',
};
const GOD_RARITY_INDEX = RARITIES.indexOf('god');
const MYTHIC_RARITY_INDEX = RARITIES.indexOf('mythic');
// God-rarity cards don't have their own slot in each card's `values` array
// (that only ever covers common..mythic) — their value is always exactly
// 3x whatever that card's mythic value is, computed on the fly wherever
// it's needed (fuseCards, cardValueForRarity) rather than duplicated per card.
const GOD_VALUE_MULTIPLIER = 3;

// The Vendor's Shop tab — direct token price per rarity (indexed exactly
// like RARITIES). Common and mythic are pinned by user request (20 / 250);
// god is also pinned (500, exactly 2x mythic); the rest is a smooth ramp
// between common and mythic.
export const CARD_PRICES = [20, 45, 80, 130, 180, 250, 500];

export const CARD_CATEGORIES = { ATTACK: 'attack', SUSTAIN: 'sustain', UTIL: 'util' };

export const CARDS = {
  int: {
    id: 'int', category: 'attack', statKey: 'int', name: 'Intellect', isPercent: false,
    values: [3, 5, 7, 10, 15, 25],
    description: 'Increases Intellect, boosting the damage of Intellect-scaling moves.',
  },
  str: {
    id: 'str', category: 'attack', statKey: 'str', name: 'Strength', isPercent: false,
    values: [3, 5, 7, 10, 15, 25],
    description: 'Increases Strength, boosting the damage of Strength-scaling moves.',
  },
  critChance: {
    id: 'critChance', category: 'attack', statKey: 'critChance', name: 'Critical Chance', isPercent: true,
    values: [1, 2, 3, 5, 9, 15],
    description: 'Increases the chance for your attacks to land a critical hit.',
  },
  critDamage: {
    id: 'critDamage', category: 'attack', statKey: 'critDamage', name: 'Critical Damage', isPercent: true,
    values: [8, 12, 16, 20, 28, 40],
    description: 'Increases the bonus damage dealt whenever you land a critical hit.',
  },
  damage: {
    id: 'damage', category: 'attack', statKey: 'damageBonusPercent', name: 'Damage', isPercent: true,
    values: [2, 4, 6, 9, 14, 20],
    description: 'Increases all damage you deal, from any source.',
  },
  decreaseEnemyDefense: {
    id: 'decreaseEnemyDefense', category: 'attack', statKey: 'enemyDefenseReduction', name: 'Defense Break', isPercent: false,
    values: [3, 5, 7, 10, 15, 25],
    description: "Flatly reduces whatever enemy you're attacking own Defense stat before damage is calculated, making your hits land harder.",
  },
  healingIncrease: {
    id: 'healingIncrease', category: 'sustain', statKey: 'healingIncreasePercent', name: 'Healing', isPercent: true,
    values: [2, 4, 6, 9, 14, 20],
    description: 'Increases the amount of health you recover from any healing.',
  },
  decreaseEnemyDamage: {
    id: 'decreaseEnemyDamage', category: 'sustain', statKey: 'enemyDamageReductionPercent', name: 'Warding', isPercent: true,
    values: [1, 2, 3, 5, 7, 10],
    description: 'Reduces the direct damage you take from enemy attacks. Does NOT reduce status-effect damage (Bleed, Poison, Burn, etc.) — see Status Ward for that.',
  },
  statusDamageReduction: {
    id: 'statusDamageReduction', category: 'sustain', statKey: 'statusDamageReductionPercent', name: 'Status Ward', isPercent: true,
    values: [2, 4, 6, 9, 14, 20],
    description: 'Reduces the damage you take specifically from status effects (Bleed, Poison, Burn, Abyssal Fire, etc). Does NOT reduce direct attack damage — see Warding for that.',
  },
  statusResist: {
    id: 'statusResist', category: 'sustain', statKey: 'statusResist', name: 'Status Resist', isPercent: true,
    values: [3, 6, 9, 13, 21, 30],
    description: 'Gives a chance to fully resist an incoming status effect application (debuffs like Bleed, Poison, Stun, etc.) before it ever lands on you.',
  },
  defense: {
    id: 'defense', category: 'sustain', statKey: 'def', name: 'Defense', isPercent: false,
    // Halved from the original [3,5,7,10,15,25] — 25 flat Defense at
    // mythic was overtuned relative to every other stat card's scaling.
    values: [2, 3, 4, 6, 9, 13],
    description: 'Increases your Defense stat, reducing incoming physical damage.',
  },
  dodgeChance: {
    id: 'dodgeChance', category: 'util', statKey: 'dodge', name: 'Dodge', isPercent: true,
    values: [1, 2, 3, 5, 7, 10],
    description: 'Increases your Dodge stat, making enemy attacks more likely to miss.',
  },
  dex: {
    id: 'dex', category: 'util', statKey: 'dex', name: 'Dexterity', isPercent: false,
    values: [3, 5, 7, 10, 15, 25],
    description: 'Increases Dexterity, giving more time on quick-time events and boosting Dexterity-scaling effects.',
  },
  doubleEnergyChance: {
    id: 'doubleEnergyChance', category: 'util', statKey: 'doubleEnergyChance', name: 'Double Energy', isPercent: true,
    values: [2, 4, 6, 9, 14, 20],
    description: 'Gives a chance to gain double Energy whenever you would gain Energy on your turn.',
  },
  noCooldownChance: {
    id: 'noCooldownChance', category: 'util', statKey: 'noCooldownChance', name: 'Swiftcast', isPercent: true,
    values: [2, 4, 6, 9, 14, 20],
    description: 'Gives a chance for a move you use to not go on cooldown at all.',
  },
};

export function cardsInCategory(category) {
  return Object.values(CARDS).filter((c) => c.category === category);
}

/** The value a card of `cardId` shows at `rarityIndex` — including the synthetic 'god' tier (always 3x that card's mythic value), which has no slot of its own in `values`. */
export function cardValueForRarity(cardId, rarityIndex) {
  const type = CARDS[cardId];
  if (!type) return 0;
  if (rarityIndex === GOD_RARITY_INDEX) return Math.round(type.values[MYTHIC_RARITY_INDEX] * GOD_VALUE_MULTIPLIER);
  return type.values[rarityIndex] ?? 0;
}

function rollRarityIndex() {
  return rollWeightedChoice(RARITIES.map((r, i) => ({ weight: RARITY_WEIGHTS[i], value: i })));
}

function rollOneCard(category) {
  const pool = cardsInCategory(category);
  const type = pickRandom(pool);
  const rarityIndex = rollRarityIndex();
  return { cardId: type.id, category, rarityIndex, value: cardValueForRarity(type.id, rarityIndex) };
}

/** One random card per category (Attack/Sustain/Util), each independently rolled to a random rarity. */
export function rollCardOffer() {
  return [CARD_CATEGORIES.ATTACK, CARD_CATEGORIES.SUSTAIN, CARD_CATEGORIES.UTIL].map(rollOneCard);
}

/** Sums picked cards' values by statKey into a flat additive-bonus object, for Character.cardBonusStats. */
export function getCardBonusStats(cards = []) {
  const totals = {};
  cards.forEach((picked) => {
    const type = CARDS[picked.cardId];
    if (!type) return;
    const amount = cardValueForRarity(picked.cardId, picked.rarityIndex);
    totals[type.statKey] = (totals[type.statKey] ?? 0) + amount;
  });
  return totals;
}

/**
 * Fusion rules (The Vendor), all gated on same rarity first — fusing two
 * differently-rarity cards is never allowed, full stop, even if they're
 * otherwise the exact same card:
 *  - Same cardId + same rarity -> that same card, one rarity higher.
 *  - Different cardId but same category + same rarity -> a random card
 *    from that category, one rarity higher.
 *  - Different category -> never allowed, no matter what.
 *  - Whenever both inputs are already mythic (the top of the normal
 *    scale), either of the above outcomes instead produces a 'god'-rarity
 *    card (see cardValueForRarity) rather than a nonexistent "mythic+1".
 */
export function canFuseCards(a, b) {
  if (!a || !b || a === b) return false;
  if (a.rarityIndex !== b.rarityIndex) return false;
  if (a.cardId === b.cardId) return true;
  const catA = CARDS[a.cardId]?.category;
  const catB = CARDS[b.cardId]?.category;
  return !!catA && catA === catB;
}

/** Returns the fused card `{cardId, category, rarityIndex, value}`, or null if `a`/`b` can't be fused (see canFuseCards). */
export function fuseCards(a, b) {
  if (!canFuseCards(a, b)) return null;
  const sameCard = a.cardId === b.cardId;
  const category = CARDS[a.cardId].category;
  const resultCardId = sameCard ? a.cardId : pickRandom(cardsInCategory(category)).id;
  const resultRarityIndex = a.rarityIndex >= MYTHIC_RARITY_INDEX ? GOD_RARITY_INDEX : a.rarityIndex + 1;
  return {
    cardId: resultCardId,
    category,
    rarityIndex: resultRarityIndex,
    value: cardValueForRarity(resultCardId, resultRarityIndex),
  };
}
