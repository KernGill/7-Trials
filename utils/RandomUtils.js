import { randomInt, rollChance } from './MathUtils.js';

export function pickRandom(items) {
  if (!items.length) return null;
  return items[randomInt(0, items.length - 1)];
}

export function rollDrop(dropConfig) {
  if (!dropConfig) return 0;
  if (!rollChance(dropConfig.chance)) return 0;
  const min = dropConfig.quantity?.[0] ?? dropConfig.quantityMin ?? 1;
  const max = dropConfig.quantity?.[1] ?? dropConfig.quantityMax ?? min;
  return randomInt(min, max);
}

export function rollWeightedChoice(entries) {
  const total = entries.reduce((sum, entry) => sum + entry.weight, 0);
  let roll = Math.random() * total;
  for (const entry of entries) {
    roll -= entry.weight;
    if (roll <= 0) return entry.value;
  }
  return entries[entries.length - 1]?.value ?? null;
}
