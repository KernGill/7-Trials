/**
 * Pure display-only helpers for hover tooltips (Shop/Bestiary/Locker/Inn).
 * These only read data configs and format HTML strings — no gameplay
 * logic, no mutation, safe to reuse anywhere a stat block or ability
 * description needs to be shown. Fully localized via t()/tData().
 */
import { getMoveTemplate } from '../data/moves.js';
import { getItemConfig } from '../data/items.js';
import { CARDS, RARITIES, RARITY_COLORS } from '../data/cards.js';
import { categoryIconSVG } from './CardIcons.js';
import { t, tData } from './i18n.js';

const STAT_DISPLAY_ORDER = ['con', 'dex', 'str', 'spd', 'def', 'int', 'critChance', 'critDamage'];
const STAT_KEY_TO_TKEY = {
  con: 'tooltip.con', dex: 'tooltip.dex', str: 'tooltip.str', spd: 'tooltip.spd',
  def: 'tooltip.def', int: 'tooltip.int', critChance: 'tooltip.critchance', critDamage: 'tooltip.critdamage',
};
const PERCENT_STATS = new Set(['critChance', 'critDamage']);
const SCALING_TKEYS = { str: 'scaling.str', dex: 'scaling.dex', int: 'scaling.int' };

export function statLabel(key) {
  return t(STAT_KEY_TO_TKEY[key] ?? key);
}

function propertyLabel(word) {
  return t(`property.${word}`);
}

export function statsListHTML(stats = {}) {
  return STAT_DISPLAY_ORDER
    .filter((key) => stats[key] !== undefined)
    .map((key) => `<div class="tt-row"><span>${statLabel(key)}:</span><span>${stats[key]}${PERCENT_STATS.has(key) ? '%' : ''}</span></div>`)
    .join('');
}

/**
 * Compact ability breakdown — used for the Bestiary move-hover, Inn
 * ability-hover, in-battle move-hover, and item/equipment tooltips.
 * Properties/Energy/Cooldown always show; Damage and bonus CritChance
 * only show when the move actually has them. Everything else (debuffs,
 * buffs, healing, defense, special triggers) is covered by the move's
 * own hand-written `description` — one or two plain sentences — rather
 * than a field-by-field mechanical dump.
 */
export function abilityDetailHTML(move) {
  if (!move) return '';
  const scalingLabel = move.scaling && move.scaling !== 'none' ? ` + ${t(SCALING_TKEYS[move.scaling] ?? move.scaling)}` : '';
  const hasDamage = move.damage > 0 || (move.scaling && move.scaling !== 'none');
  const cooldownUnit = t(move.cooldownType === 'fight_turn' ? 'tooltip.fight_turn' : 'tooltip.character_turn');
  const properties = (move.properties ?? []).map(propertyLabel).join(', ') || t('tooltip.none');
  return `
    <h4>${tData('move', move.id, move.name)}</h4>
    <div class="tt-row"><span>${t('tooltip.properties')}</span><span>${properties}</span></div>
    ${hasDamage ? `<div class="tt-row"><span>${t('tooltip.damage')}</span><span>${move.damage || 0}${scalingLabel}</span></div>` : ''}
    ${move.critChance > 0 ? `<div class="tt-row"><span>${t('tooltip.critchance_label')}</span><span>+${move.critChance}%</span></div>` : ''}
    <div class="tt-row"><span>${t('tooltip.energycost')}</span><span>${move.energyCost ?? 0}</span></div>
    <div class="tt-row"><span>${t('tooltip.cooldown')}</span><span>${move.cooldown ?? 0} ${cooldownUnit}${move.cooldown === 1 ? '' : 's'}</span></div>
    ${move.description ? `<div class="tt-desc">${move.description}</div>` : ''}
  `;
}

/** One-line "Ability Name: Properties" summary used inside item/character tooltips. */
export function abilitySummaryLine(moveId) {
  const move = getMoveTemplate(moveId);
  if (!move) return '';
  const properties = (move.properties ?? []).map(propertyLabel).join(', ');
  return `<div class="tt-ability"><span class="tt-ability-name">${tData('move', move.id, move.name)}:</span> ${properties}</div>`;
}

/** Stat block + a full ability breakdown (not just a one-liner) for an equipment item (Shop/Locker/PauseOverlay loadout) — so a new player can see exactly what a move does without a separate trip to the Inn. */
export function itemTooltipHTML(config) {
  const abilities = (config.moveIds ?? []).map((id) => abilityDetailHTML(getMoveTemplate(id))).join('');
  return `
    <h4>${tData('item', config.id, config.name)}</h4>
    ${config.score !== undefined ? `<div class="tt-row"><span>${t('tooltip.score')}</span><span>${config.score}</span></div>` : ''}
    ${statsListHTML(config.stats)}
    ${abilities ? `<div class="tt-row tt-section-label"><strong>${t('tooltip.abilities')}</strong></div>${abilities}` : ''}
  `;
}

/** Stat block + abilities list for a playable character (Inn roster) or enemy (Bestiary). */
export function characterTooltipHTML(config) {
  const abilities = (config.moveIds ?? []).map((id) => abilitySummaryLine(id)).join('');
  return `
    <h4>${tData('character', config.id, config.name)}</h4>
    ${statsListHTML(config.baseStats ?? config.stats)}
    ${abilities ? `<div class="tt-row tt-section-label"><strong>${t('tooltip.abilities')}</strong></div>${abilities}` : ''}
  `;
}

/**
 * Three-column equipment grid (accessory/weapon/glove/ring down each
 * side, armour pieces down the middle) — shared by PauseOverlay's "View
 * Loadout" panel and the save-slot picker's hover preview, since both
 * just need to render an `equipped` object (single-slot ids + multi-slot
 * arrays) with hoverable `data-item-id` tiles. Callers bind their own
 * TooltipManager against those tiles.
 */
export function equipmentGridHTML(equipped = {}) {
  const slotTile = (slotKey, id) => `
    <div class="loadout-slot" ${id ? `data-item-id="${id}"` : ''}>
      <div class="loadout-slot-label">${t(`locker.slot.${slotKey}`)}</div>
      ${id ? `<div class="loadout-slot-item">${tData('item', id, getItemConfig(id)?.name ?? id)}</div>` : ''}
    </div>`;

  const leftCol = [
    slotTile('accessory', equipped.accessory?.[0]),
    slotTile('mainWeapon', equipped.mainWeapon),
    slotTile('glove', equipped.glove?.[0]),
    slotTile('ring', equipped.ring?.[0]),
  ].join('');
  const midCol = ['head', 'arms', 'chest', 'legs', 'boots']
    .map((slot) => slotTile(slot, equipped[slot]))
    .join('');
  const rightCol = [
    slotTile('accessory', equipped.accessory?.[1]),
    slotTile('offHand', equipped.offHand),
    slotTile('glove', equipped.glove?.[1]),
    slotTile('ring', equipped.ring?.[1]),
  ].join('');

  return `
    <div class="loadout-grid">
      <div class="loadout-col">${leftCol}</div>
      <div class="loadout-col">${midCol}</div>
      <div class="loadout-col">${rightCol}</div>
    </div>`;
}

/** Stat totals grid (+N per stat) shown below the equipment grid. */
export function equipmentTotalsHTML(totals = {}) {
  return `
    <div class="loadout-totals-grid">
      ${STAT_DISPLAY_ORDER.map((k) => `<div class="tt-row"><span>${statLabel(k)}:</span><span>+${totals[k] ?? 0}</span></div>`).join('')}
    </div>`;
}

/**
 * One card tile: name, rarity-colored border, category icon (sword/
 * shield/shoe) between name and description. Shared by the stairs
 * card-pick modal (ExploreState) and the pause menu's View Cards panel.
 * `index`, when given, is stamped as data-card-index so the caller can
 * wire click handling positionally against the offer/list array.
 */
export function cardTileHTML(picked, index = null) {
  const type = CARDS[picked.cardId];
  if (!type) return '';
  const rarity = RARITIES[picked.rarityIndex];
  const color = RARITY_COLORS[rarity];
  const name = tData('card', type.id, type.name);
  const desc = `+${picked.value}${type.isPercent ? '%' : ''} ${name}`;
  const indexAttr = index !== null ? ` data-card-index="${index}"` : '';
  return `
    <div class="card-tile" data-rarity="${rarity}" style="border-color:${color}"${indexAttr}>
      <div class="card-name" style="color:${color}">${name}</div>
      <div class="card-icon">${categoryIconSVG(type.category)}</div>
      <div class="card-desc">${desc}</div>
    </div>`;
}
