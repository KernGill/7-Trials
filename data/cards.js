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
  spd: {
    id: 'spd', category: 'util', statKey: 'spd', name: 'Speed', isPercent: false,
    values: [3, 5, 7, 10, 15, 25],
    description: 'Increases Speed, making you act earlier in turn order.',
  },

  // --- Shrine-only cards (Sealed Shrine event) ---
  // Not part of the normal card pool — see cardsInCategory's shrineOnly
  // filter, which keeps these out of the stairs offer and Vendor Shop.
  // Only reachable via rollShrineCard(). Each is exactly 3x its base
  // stat card's values (per user request: "the increase in the stat from
  // the shrine card should be triple that of any regular card").
  shrine_int: {
    id: 'shrine_int', category: 'attack', statKey: 'int', name: 'Shrine Intellect', isPercent: false, shrineOnly: true,
    values: [9, 15, 21, 30, 45, 75], // = CARDS.int.values x 3
    description: 'A shrine-blessed surge of Intellect — triple the potency of a normal Intellect card.',
  },
  shrine_str: {
    id: 'shrine_str', category: 'attack', statKey: 'str', name: 'Shrine Strength', isPercent: false, shrineOnly: true,
    values: [9, 15, 21, 30, 45, 75], // = CARDS.str.values x 3
    description: 'A shrine-blessed surge of Strength — triple the potency of a normal Strength card.',
  },
  shrine_dex: {
    id: 'shrine_dex', category: 'util', statKey: 'dex', name: 'Shrine Dexterity', isPercent: false, shrineOnly: true,
    values: [9, 15, 21, 30, 45, 75], // = CARDS.dex.values x 3
    description: 'A shrine-blessed surge of Dexterity — triple the potency of a normal Dexterity card.',
  },
  shrine_def: {
    id: 'shrine_def', category: 'sustain', statKey: 'def', name: 'Shrine Defense', isPercent: false, shrineOnly: true,
    values: [6, 9, 12, 18, 27, 39], // = CARDS.defense.values x 3
    description: 'A shrine-blessed surge of Defense — triple the potency of a normal Defense card.',
  },
  shrine_spd: {
    id: 'shrine_spd', category: 'util', statKey: 'spd', name: 'Shrine Speed', isPercent: false, shrineOnly: true,
    values: [9, 15, 21, 30, 45, 75], // = CARDS.spd.values x 3
    description: 'A shrine-blessed surge of Speed — triple the potency of a normal Speed card.',
  },
};

const SHRINE_CARD_IDS = ['shrine_int', 'shrine_str', 'shrine_dex', 'shrine_def', 'shrine_spd'];

// Sealed Shrine's card rarity, per user request, scales off the current
// floor instead of using the flat RARITY_WEIGHTS every other card roll
// uses — "can't win by getting lucky from the shrine too much." Per a
// later user request ("scale much better — floor 10 should be MINIMUM
// epic, with a decent chance at legendary and mythic"), Common/Uncommon
// now actively DECAY to exactly 0 weight by floor 10 (shrineDecayWeight)
// instead of just sitting flat while other tiers dilute their share — floor
// 10 genuinely can't roll them anymore, not just "rarely." Rare rises
// through the early-mid floors (same growth formula as before) but is
// ALSO decayed to exactly 0 by floor 10 via the same multiplier, so it
// phases out right as Epic/Legendary/Mythic take over rather than lingering
// forever as a low-odds trap. Epic/Legendary/Mythic keep the original
// unlock-floor-then-grow shape (shrineTierWeight) — Epic still unlocks at
// floor 2 (0% at floor 1, per the original request), Legendary/Mythic still
// unlock at floor 6 — but their growth rates are tuned so floor 10 lands on
// weights 40/35/25 respectively (with nothing else in the pool at that
// floor, that's a literal 40%/35%/25% split), then keep climbing a bit
// further before their caps take over around floor 13-14, settling near a
// 32%/39%/29% split for the rest of the run. Thief's Greed/Resolve still
// add flat bonuses on top of all this (see rollShrineCard) — now a much
// smaller proportional nudge than before given how much bigger these base
// weights are, but still the only way to see Epic/Legendary/Mythic at all
// in floors 1-5's otherwise-locked tiers.
const SHRINE_COMMON_WEIGHT = 25;
const SHRINE_UNCOMMON_WEIGHT = 25;
const SHRINE_LOW_TIER_ZERO_FLOOR = 10; // Common/Uncommon/Rare all hit exactly 0 weight at this floor
const SHRINE_RARE_UNLOCK_FLOOR = 1;
const SHRINE_RARE_GROWTH_PER_FLOOR = 3;
const SHRINE_RARE_MAX_WEIGHT = 20;
const SHRINE_EPIC_UNLOCK_FLOOR = 2;
const SHRINE_EPIC_GROWTH_PER_FLOOR = 40 / 9; // hits exactly 40 weight at floor 10 (see module comment)
const SHRINE_EPIC_MAX_WEIGHT = 50;
const SHRINE_LEGENDARY_UNLOCK_FLOOR = 6;
const SHRINE_LEGENDARY_GROWTH_PER_FLOOR = 7; // hits exactly 35 weight at floor 10
const SHRINE_LEGENDARY_MAX_WEIGHT = 60;
const SHRINE_MYTHIC_UNLOCK_FLOOR = 6;
const SHRINE_MYTHIC_GROWTH_PER_FLOOR = 5; // hits exactly 25 weight at floor 10
const SHRINE_MYTHIC_MAX_WEIGHT = 45;

function shrineTierWeight(floor, unlockFloor, growthPerFloor, maxWeight) {
  if (floor < unlockFloor) return 0;
  return Math.min(maxWeight, (floor - unlockFloor + 1) * growthPerFloor);
}

/** Linearly decays from `startWeight` at floor 1 to exactly 0 at floor=`zeroFloor` (and stays 0 beyond) — see SHRINE_LOW_TIER_ZERO_FLOOR's comment. */
function shrineDecayWeight(floor, startWeight, zeroFloor) {
  if (floor >= zeroFloor) return 0;
  return startWeight * (1 - (floor - 1) / (zeroFloor - 1));
}

/** Floor-scaled base weights (indexed exactly like RARITIES) for the Sealed Shrine's card roll — see the SHRINE_* constants above. */
function shrineBaseWeights(floor) {
  const rareGrowth = shrineTierWeight(floor, SHRINE_RARE_UNLOCK_FLOOR, SHRINE_RARE_GROWTH_PER_FLOOR, SHRINE_RARE_MAX_WEIGHT);
  const rareDecayFactor = floor >= SHRINE_LOW_TIER_ZERO_FLOOR ? 0 : 1 - (floor - 1) / (SHRINE_LOW_TIER_ZERO_FLOOR - 1);
  return [
    shrineDecayWeight(floor, SHRINE_COMMON_WEIGHT, SHRINE_LOW_TIER_ZERO_FLOOR),
    shrineDecayWeight(floor, SHRINE_UNCOMMON_WEIGHT, SHRINE_LOW_TIER_ZERO_FLOOR),
    rareGrowth * rareDecayFactor,
    shrineTierWeight(floor, SHRINE_EPIC_UNLOCK_FLOOR, SHRINE_EPIC_GROWTH_PER_FLOOR, SHRINE_EPIC_MAX_WEIGHT),
    shrineTierWeight(floor, SHRINE_LEGENDARY_UNLOCK_FLOOR, SHRINE_LEGENDARY_GROWTH_PER_FLOOR, SHRINE_LEGENDARY_MAX_WEIGHT),
    shrineTierWeight(floor, SHRINE_MYTHIC_UNLOCK_FLOOR, SHRINE_MYTHIC_GROWTH_PER_FLOOR, SHRINE_MYTHIC_MAX_WEIGHT),
    0, // god — never rolled naturally, see RARITY_WEIGHTS' own comment
  ];
}

export function cardsInCategory(category) {
  return Object.values(CARDS).filter((c) => c.category === category && !c.shrineOnly);
}

/** The value a card of `cardId` shows at `rarityIndex` — including the synthetic 'god' tier (always 3x that card's mythic value), which has no slot of its own in `values`. */
export function cardValueForRarity(cardId, rarityIndex) {
  const type = CARDS[cardId];
  if (!type) return 0;
  if (rarityIndex === GOD_RARITY_INDEX) return Math.round(type.values[MYTHIC_RARITY_INDEX] * GOD_VALUE_MULTIPLIER);
  return type.values[rarityIndex] ?? 0;
}

function rollRarityIndex(weights = RARITY_WEIGHTS) {
  return rollWeightedChoice(RARITIES.map((r, i) => ({ weight: weights[i], value: i })));
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

/**
 * Sealed Shrine reward: a random shrine-only stat card at a random rarity,
 * using shrineBaseWeights(floor) — NOT the flat RARITY_WEIGHTS every other
 * card roll uses — so the odds scale with how deep the run is (see that
 * function's comment). Thief's Greed and Thief's Resolve each nudge weight
 * from the low tiers into epic/legendary/mythic on TOP of the floor curve
 * (see their shrineEpicWeightBonus/shrineLegendaryWeightBonus/
 * shrineMythicWeightBonus move fields, plus a shrineRareWeightBonus,
 * summed by the caller in ExploreState's resolveSealedShrine) — kept
 * deliberately modest per user request ("shouldn't be too much... having
 * all epic and above cards is overpowered"), god stays untouched (still
 * unreachable naturally, weight 0). Mythic's bonus is deliberately smaller
 * than Legendary's (see thiefs_greed/thiefs_resolve's own comments) — on
 * floors 1-5, where Legendary/Mythic both still have exactly 0 BASE weight
 * (they unlock at floor 6), the gear bonus is the ONLY thing setting their
 * odds, so Mythic's bonus outweighing Legendary's would make the rarer
 * tier roll MORE often than the one below it.
 */
export function rollShrineCard({
  floor = 1, rareBonus = 0, epicBonus = 0, legendaryBonus = 0, mythicBonus = 0,
} = {}) {
  const cardId = pickRandom(SHRINE_CARD_IDS);
  const weights = shrineBaseWeights(floor);
  weights[RARITIES.indexOf('rare')] += rareBonus;
  weights[RARITIES.indexOf('epic')] += epicBonus;
  weights[RARITIES.indexOf('legendary')] += legendaryBonus;
  weights[RARITIES.indexOf('mythic')] += mythicBonus;
  const rarityIndex = rollRarityIndex(weights);
  return { cardId, category: CARDS[cardId].category, rarityIndex, value: cardValueForRarity(cardId, rarityIndex) };
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
