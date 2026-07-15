/**
 * Pure display-only helpers for hover tooltips (Shop/Bestiary/Locker/Inn).
 * These only read data configs and format HTML strings — no gameplay
 * logic, no mutation, safe to reuse anywhere a stat block or ability
 * description needs to be shown.
 */
import { getMoveTemplate } from '../data/moves.js';

const STAT_DISPLAY_ORDER = ['con', 'dex', 'str', 'spd', 'def', 'int', 'critChance', 'critDamage'];
const STAT_LABELS = {
  con: 'Con', dex: 'Dex', str: 'Str', spd: 'Spd',
  def: 'Def', int: 'Int', critChance: 'CritChance', critDamage: 'CritDamage',
};
const PERCENT_STATS = new Set(['critChance', 'critDamage']);
const SCALING_LABELS = { str: 'Strength', dex: 'Dexterity', int: 'Intelligence', none: '' };
const COOLDOWN_LABELS = { character_turn: 'character_turn', fight_turn: 'fight_turn' };

function capitalize(word) {
  return word.charAt(0).toUpperCase() + word.slice(1);
}

export function statsListHTML(stats = {}) {
  return STAT_DISPLAY_ORDER
    .filter((key) => stats[key] !== undefined)
    .map((key) => `<div class="tt-row"><span>${STAT_LABELS[key]}:</span><span>${stats[key]}${PERCENT_STATS.has(key) ? '%' : ''}</span></div>`)
    .join('');
}

function debuffsText(move) {
  if (!move.debuffs?.length) return 'None.';
  return `${move.debuffs.map((d) => `${capitalize(d.effect)} x${d.stacks ?? 1}`).join(', ')}.`;
}

function buffsText(move) {
  if (!move.buffs?.length) return 'None.';
  return `${move.buffs.map((b) => (b.type === 'stat' ? `+${b.amount} ${capitalize(b.stat)}` : capitalize(b.effect ?? b.type))).join(', ')}.`;
}

function healingDefenceText(move) {
  const parts = [];
  if (move.healMaxPercent) parts.push(`Heals ${move.healMaxPercent}% of missing health.`);
  if (move.guardPercent) parts.push(`Guards ${move.guardPercent}% of the next hit.`);
  if (move.damageReductionPercent) {
    parts.push(`Reduces damage taken by ${move.damageReductionPercent}%${move.damageReductionHits ? ` for ${move.damageReductionHits} hits` : ''}.`);
  }
  if (move.damageReductionNext) parts.push(`Reduces the next hit by ${move.damageReductionNext} flat damage.`);
  if (move.reflectSplitPercent) parts.push(`Splits ${move.reflectSplitPercent}% of incoming damage back to the attacker.`);
  return parts.length ? parts.join(' ') : 'None.';
}

function specialEffectsText(move) {
  const parts = [];
  if (move.repeatInstances) parts.push(`Repeats ${move.repeatInstances} more time(s) at the start of following fight turns.`);
  if (move.trigger) {
    const everyNth = move.triggerInterval > 1 ? ` (every ${move.triggerInterval}${move.triggerInterval === 2 ? 'nd' : move.triggerInterval === 3 ? 'rd' : 'th'} time)` : '';
    parts.push(`Triggers automatically on ${move.trigger.replace(/_/g, ' ')}${everyNth}.`);
  }
  if (move.usePriorityBelowHealthPercent) parts.push(`Prioritized below ${move.usePriorityBelowHealthPercent}% health.`);
  return parts.length ? parts.join(' ') : 'None.';
}

/** Full ability breakdown — used for the Bestiary move-hover and Inn ability-hover panels. */
export function abilityDetailHTML(move) {
  if (!move) return '';
  const scalingLabel = move.scaling && move.scaling !== 'none' ? ` + ${SCALING_LABELS[move.scaling] ?? move.scaling} Scaling` : '';
  const damageText = move.damage > 0 || (move.scaling && move.scaling !== 'none') ? `${move.damage || 0}${scalingLabel}` : 'None.';
  const cooldownUnit = COOLDOWN_LABELS[move.cooldownType] ?? move.cooldownType;
  return `
    <h4>${move.name}</h4>
    <div class="tt-row"><span>Properties:</span><span>${(move.properties ?? []).map(capitalize).join(', ') || 'None'}</span></div>
    <div class="tt-row"><span>Damage:</span><span>${damageText}</span></div>
    <div class="tt-row"><span>CritChance:</span><span>${move.critChance ?? 0}% + CritChance from stats%</span></div>
    <div class="tt-row"><span>EnergyCost:</span><span>${move.energyCost ?? 0}</span></div>
    <div class="tt-row"><span>Cooldown:</span><span>${move.cooldown ?? 0} ${cooldownUnit}${move.cooldown === 1 ? '' : 's'}</span></div>
    <div class="tt-row"><span>Debuffs:</span><span>${debuffsText(move)}</span></div>
    <div class="tt-row"><span>Buffs:</span><span>${buffsText(move)}</span></div>
    <div class="tt-row"><span>Healing/Defence:</span><span>${healingDefenceText(move)}</span></div>
    <div class="tt-row"><span>SpecialEffects:</span><span>${specialEffectsText(move)}</span></div>
  `;
}

/** One-line "Ability Name: Properties" summary used inside item/character tooltips. */
export function abilitySummaryLine(moveId) {
  const move = getMoveTemplate(moveId);
  if (!move) return '';
  return `<div class="tt-ability"><span class="tt-ability-name">${move.name}:</span> ${(move.properties ?? []).map(capitalize).join(', ')}</div>`;
}

/** Stat block + abilities list for an equipment item (Shop/Locker/PauseOverlay loadout). */
export function itemTooltipHTML(config) {
  const abilities = (config.moveIds ?? []).map((id) => abilitySummaryLine(id)).join('');
  return `
    <h4>${config.name}</h4>
    ${statsListHTML(config.stats)}
    ${abilities ? `<div class="tt-row tt-section-label"><strong>Abilities:</strong></div>${abilities}` : ''}
  `;
}

/** Stat block + abilities list for a playable character (Inn roster) or enemy (Bestiary). */
export function characterTooltipHTML(config) {
  const abilities = (config.moveIds ?? []).map((id) => abilitySummaryLine(id)).join('');
  return `
    <h4>${config.name}</h4>
    ${statsListHTML(config.baseStats ?? config.stats)}
    ${abilities ? `<div class="tt-row tt-section-label"><strong>Abilities:</strong></div>${abilities}` : ''}
  `;
}
