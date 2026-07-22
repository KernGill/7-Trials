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

function statusLabel(id) {
  return tData('status', id, id.charAt(0).toUpperCase() + id.slice(1));
}

export function statsListHTML(stats = {}) {
  return STAT_DISPLAY_ORDER
    .filter((key) => stats[key] !== undefined)
    .map((key) => `<div class="tt-row"><span>${statLabel(key)}:</span><span>${stats[key]}${PERCENT_STATS.has(key) ? '%' : ''}</span></div>`)
    .join('');
}

function debuffsText(move) {
  if (!move.debuffs?.length) return t('tooltip.none');
  return `${move.debuffs.map((d) => `${statusLabel(d.effect)} x${d.stacks ?? 1}`).join(', ')}.`;
}

function buffsText(move) {
  if (!move.buffs?.length) return t('tooltip.none');
  return `${move.buffs.map((b) => (b.type === 'stat' ? `+${b.amount} ${statLabel(b.stat)}` : statusLabel(b.effect ?? b.type))).join(', ')}.`;
}

function healingDefenceText(move) {
  const parts = [];
  if (move.healMaxPercent) parts.push(t('ability.heals_missing', { n: move.healMaxPercent }));
  if (move.guardPercent) parts.push(t('ability.guards_next', { n: move.guardPercent }));
  if (move.damageReductionPercent) {
    parts.push(move.damageReductionHits
      ? t('ability.reduces_damage_taken_hits', { n: move.damageReductionPercent, hits: move.damageReductionHits })
      : t('ability.reduces_damage_taken', { n: move.damageReductionPercent }));
  }
  if (move.damageReductionNext) parts.push(t('ability.reduces_next_flat', { n: move.damageReductionNext }));
  if (move.reflectSplitPercent) parts.push(t('ability.splits_incoming', { n: move.reflectSplitPercent }));
  if (move.guaranteedDodgeFightTurns) parts.push(t('ability.guaranteed_dodge'));
  if (move.reactiveHealMultiplier) parts.push(t('ability.reactive_heal', { n: move.reactiveHealMultiplier }));
  return parts.length ? parts.join(' ') : t('tooltip.none');
}

function specialEffectsText(move) {
  const parts = [];
  if (move.repeatInstances) parts.push(t('ability.repeats', { n: move.repeatInstances }));
  if (move.trigger) {
    const suffix = move.triggerInterval === 2 ? 'nd' : move.triggerInterval === 3 ? 'rd' : 'th';
    const interval = move.triggerInterval > 1 ? t('ability.every_nth', { n: move.triggerInterval, suffix }) : '';
    parts.push(t('ability.triggers_on', { trigger: move.trigger.replace(/_/g, ' '), interval }));
  }
  if (move.usePriorityBelowHealthPercent) parts.push(t('ability.prioritized_below', { n: move.usePriorityBelowHealthPercent }));
  if (move.physicalDamageReductionPercent) parts.push(t('ability.physical_reduction', { n: move.physicalDamageReductionPercent }));
  if (move.statusDamageMultipliers) {
    Object.entries(move.statusDamageMultipliers).forEach(([key, mult]) => {
      const label = key === 'default' ? t('ability.status_default') : statusLabel(key);
      const pct = Math.round(Math.abs(mult - 1) * 100);
      parts.push(mult > 1
        ? t('ability.status_extra_damage', { status: label, n: pct })
        : t('ability.status_less_damage', { status: label, n: pct }));
    });
  }
  return parts.length ? parts.join(' ') : t('tooltip.none');
}

/** Full ability breakdown — used for the Bestiary move-hover and Inn ability-hover panels. */
export function abilityDetailHTML(move) {
  if (!move) return '';
  const scalingLabel = move.scaling && move.scaling !== 'none' ? ` + ${t(SCALING_TKEYS[move.scaling] ?? move.scaling)}` : '';
  const damageText = move.damage > 0 || (move.scaling && move.scaling !== 'none') ? `${move.damage || 0}${scalingLabel}` : t('tooltip.none');
  const cooldownUnit = t(move.cooldownType === 'fight_turn' ? 'tooltip.fight_turn' : 'tooltip.character_turn');
  const properties = (move.properties ?? []).map(propertyLabel).join(', ') || t('tooltip.none');
  return `
    <h4>${tData('move', move.id, move.name)}</h4>
    <div class="tt-row"><span>${t('tooltip.properties')}</span><span>${properties}</span></div>
    <div class="tt-row"><span>${t('tooltip.damage')}</span><span>${damageText}</span></div>
    <div class="tt-row"><span>${t('tooltip.critchance_label')}</span><span>${move.critChance ?? 0}${t('tooltip.critchance_from_stats')}</span></div>
    <div class="tt-row"><span>${t('tooltip.energycost')}</span><span>${move.energyCost ?? 0}</span></div>
    <div class="tt-row"><span>${t('tooltip.cooldown')}</span><span>${move.cooldown ?? 0} ${cooldownUnit}${move.cooldown === 1 ? '' : 's'}</span></div>
    <div class="tt-row"><span>${t('tooltip.debuffs')}</span><span>${debuffsText(move)}</span></div>
    <div class="tt-row"><span>${t('tooltip.buffs')}</span><span>${buffsText(move)}</span></div>
    <div class="tt-row"><span>${t('tooltip.healing_defence')}</span><span>${healingDefenceText(move)}</span></div>
    <div class="tt-row"><span>${t('tooltip.specialeffects')}</span><span>${specialEffectsText(move)}</span></div>
  `;
}

/** One-line "Ability Name: Properties" summary used inside item/character tooltips. */
export function abilitySummaryLine(moveId) {
  const move = getMoveTemplate(moveId);
  if (!move) return '';
  const properties = (move.properties ?? []).map(propertyLabel).join(', ');
  return `<div class="tt-ability"><span class="tt-ability-name">${tData('move', move.id, move.name)}:</span> ${properties}</div>`;
}

/** Stat block + abilities list for an equipment item (Shop/Locker/PauseOverlay loadout). */
export function itemTooltipHTML(config) {
  const abilities = (config.moveIds ?? []).map((id) => abilitySummaryLine(id)).join('');
  return `
    <h4>${tData('item', config.id, config.name)}</h4>
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
