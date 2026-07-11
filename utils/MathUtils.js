export function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

export function roundUp(value) {
  return Math.ceil(value);
}

export function roundDown(value) {
  return Math.floor(value);
}

export function percentOf(value, percent) {
  return value * (percent / 100);
}

export function applyPercentReduction(damage, percent) {
  const reduction = Math.ceil(damage * (percent / 100));
  return Math.max(1, damage - reduction);
}

export function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

export function rollChance(percent) {
  return Math.random() * 100 < percent;
}

export function shuffle(array) {
  const copy = [...array];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

export function deepClone(value) {
  return JSON.parse(JSON.stringify(value));
}
