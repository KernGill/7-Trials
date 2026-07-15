import { TRANSLATIONS, DATA_TRANSLATIONS } from '../data/i18n.js';

let currentLanguage = 'en';

export function setLanguage(lang) {
  currentLanguage = TRANSLATIONS[lang] ? lang : 'en';
}

export function getLanguage() {
  return currentLanguage;
}

/** UI chrome strings (buttons, labels, headers, log templates). `{key}` placeholders get substituted from `vars`. */
export function t(key, vars = {}) {
  const dict = TRANSLATIONS[currentLanguage] ?? TRANSLATIONS.en;
  let str = dict[key] ?? TRANSLATIONS.en[key] ?? key;
  Object.entries(vars).forEach(([k, v]) => {
    str = str.replaceAll(`{${k}}`, v);
  });
  return str;
}

/**
 * Data-driven names/flavour/descriptions (move/item/enemy/character/
 * consumable/material/status names) — kept in a separate table from UI
 * chrome since they're looked up by (kind, id) rather than a fixed key,
 * and always fall back to the English value already sitting in the
 * data file itself (fallback) so a missing translation never breaks
 * anything, just silently shows English for that one string.
 */
export function tData(kind, id, fallback) {
  if (currentLanguage === 'en') return fallback ?? id;
  const table = DATA_TRANSLATIONS[currentLanguage]?.[kind];
  return table?.[id] ?? fallback ?? id;
}

/**
 * Systems (ShopSystem/InventorySystem/InnSystem/CombatManager) return
 * fixed English reason strings — some UI code compares against them
 * exactly (e.g. ShopState.flashBuyFailure), so those strings themselves
 * stay English at the source. This translates one for DISPLAY only,
 * falling back to the raw string itself if it's not a recognized reason.
 */
const REASON_KEYS = {
  'Not your turn.': 'reason.not_your_turn',
  'Unknown move.': 'reason.unknown_move',
  'Move unavailable.': 'reason.move_unavailable',
  'No valid target.': 'reason.no_target',
  'Not enough gold.': 'reason.not_enough_gold',
  'Not enough materials.': 'reason.not_enough_materials',
  'You do not meet the requirements to purchase this item.': 'reason.locked_requirements',
  'Item not found.': 'reason.item_not_found',
  'Unknown item.': 'reason.unknown_item',
  'Item not owned.': 'reason.item_not_owned',
  'Cannot equip an offhand item while wielding a two-handed weapon.': 'reason.cannot_equip_offhand',
  'You do not own another copy of this item.': 'reason.no_owned_copy',
  'Character not unlocked.': 'reason.character_not_unlocked',
};

export function tReason(raw) {
  const key = REASON_KEYS[raw];
  return key ? t(key) : raw;
}
