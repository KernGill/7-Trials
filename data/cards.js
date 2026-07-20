import { rollWeightedChoice } from '../utils/RandomUtils.js';

export const RARITIES = ['common', 'uncommon', 'rare', 'epic', 'legendary', 'mythic'];
export const RARITY_WEIGHTS = [25, 25, 20, 15, 10, 5];
export const RARITY_COLORS = {
  common: '#9e9e9e',
  uncommon: '#2ecc71',
  rare: '#3498db',
  epic: '#9b59b6',
  legendary: '#f1c40f',
  mythic: '#e74c3c',
};

export const CARD_CATEGORIES = { ATTACK: 'attack', SUSTAIN: 'sustain', UTIL: 'util' };

export const CARDS = {
  int: { id: 'int', category: 'attack', statKey: 'int', name: 'Intellect', isPercent: false, values: [3, 5, 7, 10, 15, 25] },
  str: { id: 'str', category: 'attack', statKey: 'str', name: 'Strength', isPercent: false, values: [3, 5, 7, 10, 15, 25] },
  critChance: { id: 'critChance', category: 'attack', statKey: 'critChance', name: 'Critical Chance', isPercent: true, values: [1, 2, 3, 5, 9, 15] },
  critDamage: { id: 'critDamage', category: 'attack', statKey: 'critDamage', name: 'Critical Damage', isPercent: true, values: [8, 12, 16, 20, 28, 40] },
  damage: { id: 'damage', category: 'attack', statKey: 'damageBonusPercent', name: 'Damage', isPercent: true, values: [2, 4, 6, 9, 14, 20] },
  decreaseEnemyDefense: { id: 'decreaseEnemyDefense', category: 'attack', statKey: 'enemyDefenseReduction', name: 'Defense Break', isPercent: false, values: [3, 5, 7, 10, 15, 25] },
  healingIncrease: { id: 'healingIncrease', category: 'sustain', statKey: 'healingIncreasePercent', name: 'Healing', isPercent: true, values: [2, 4, 6, 9, 14, 20] },
  decreaseEnemyDamage: { id: 'decreaseEnemyDamage', category: 'sustain', statKey: 'enemyDamageReductionPercent', name: 'Warding', isPercent: true, values: [1, 2, 3, 5, 7, 10] },
  statusDamageReduction: { id: 'statusDamageReduction', category: 'sustain', statKey: 'statusDamageReductionPercent', name: 'Status Ward', isPercent: true, values: [2, 4, 6, 9, 14, 20] },
  statusResist: { id: 'statusResist', category: 'sustain', statKey: 'statusResist', name: 'Status Resist', isPercent: true, values: [3, 6, 9, 13, 21, 30] },
  defense: { id: 'defense', category: 'sustain', statKey: 'def', name: 'Defense', isPercent: false, values: [3, 5, 7, 10, 15, 25] },
  dodgeChance: { id: 'dodgeChance', category: 'util', statKey: 'dodge', name: 'Dodge', isPercent: true, values: [1, 2, 3, 5, 7, 10] },
  dex: { id: 'dex', category: 'util', statKey: 'dex', name: 'Dexterity', isPercent: false, values: [3, 5, 7, 10, 15, 25] },
  doubleEnergyChance: { id: 'doubleEnergyChance', category: 'util', statKey: 'doubleEnergyChance', name: 'Double Energy', isPercent: true, values: [2, 4, 6, 9, 14, 20] },
  noCooldownChance: { id: 'noCooldownChance', category: 'util', statKey: 'noCooldownChance', name: 'Swiftcast', isPercent: true, values: [2, 4, 6, 9, 14, 20] },
};

function cardsInCategory(category) {
  return Object.values(CARDS).filter((c) => c.category === category);
}

function rollRarityIndex() {
  return rollWeightedChoice(RARITIES.map((r, i) => ({ weight: RARITY_WEIGHTS[i], value: i })));
}

function rollOneCard(category) {
  const pool = cardsInCategory(category);
  const type = pool[Math.floor(Math.random() * pool.length)];
  const rarityIndex = rollRarityIndex();
  return { cardId: type.id, category, rarityIndex, value: type.values[rarityIndex] };
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
    totals[type.statKey] = (totals[type.statKey] ?? 0) + type.values[picked.rarityIndex];
  });
  return totals;
}
