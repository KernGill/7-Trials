import { GAME_STATES } from '../utils/Constants.js';
import { getArcConfig, ARCS } from '../data/arcs.js';
import { getMoveTemplate } from '../data/moves.js';
import { getEnemySprite } from '../data/sprites.js';
import { TooltipManager } from '../ui/TooltipManager.js';
import { statsListHTML, abilityDetailHTML } from '../ui/InfoFormatters.js';
import { t, tData } from '../ui/i18n.js';

const SLOTS_PER_ARC = 12;
const MAX_ARC_INDEX = Math.max(...Object.values(ARCS).map((a) => a.index));

/**
 * BestiaryState — arc-grouped 12-slot grid (Previous/Next arc nav),
 * hover-tooltip stats on discovered tiles, click to open a detail panel
 * with a scrollable, hoverable moves list. Undiscovered enemies (ones
 * you haven't beaten yet) stay locked behind "???" — that gating is
 * existing gameplay (BestiarySystem.recordEncounter on victory) and is
 * preserved here, not touched. Pool slots with no enemy defined yet at
 * all show "Future enemy", matching the design doc.
 */
export class BestiaryState {
  constructor(app) {
    this.app = app;
    this.arcIndex = 0;
    this.openEnemyId = null;
  }

  enter(root) {
    this.root = root;
    this.arcIndex = 0;
    this.openEnemyId = null;
    this.tooltip = new TooltipManager();
    root.innerHTML = `
      <div class="bestiary-screen">
        <button class="back-btn">${t('common.return_home')}</button>
        <h1>${t('bestiary.title')}</h1>
        <div class="bestiary-panel">
          <div class="bestiary-arc-header"></div>
          <div class="bestiary-grid"></div>
          <div class="bestiary-detail hidden"></div>
        </div>
        <div class="bestiary-nav">
          <button class="arc-nav-btn" data-nav="prev">${t('bestiary.previous')}</button>
          <button class="arc-nav-btn" data-nav="next">${t('bestiary.next')}</button>
        </div>
      </div>`;
    root.querySelector('.back-btn').addEventListener('click', () => this.app.setState(GAME_STATES.HOME));
    this.els = {
      arcHeader: root.querySelector('.bestiary-arc-header'),
      grid: root.querySelector('.bestiary-grid'),
      detail: root.querySelector('.bestiary-detail'),
      prevBtn: root.querySelector('[data-nav="prev"]'),
      nextBtn: root.querySelector('[data-nav="next"]'),
    };
    this.els.prevBtn.addEventListener('click', () => {
      this.arcIndex = Math.max(0, this.arcIndex - 1);
      this.openEnemyId = null;
      this.renderAll();
    });
    this.els.nextBtn.addEventListener('click', () => {
      this.arcIndex = Math.min(MAX_ARC_INDEX, this.arcIndex + 1);
      this.openEnemyId = null;
      this.renderAll();
    });
    this.renderAll();
  }

  exit() {
    this.tooltip?.destroy();
  }

  renderAll() {
    const arc = getArcConfig(this.arcIndex);
    this.els.arcHeader.textContent = t('bestiary.arc', { n: arc.index });
    this.els.prevBtn.disabled = this.arcIndex <= 0;
    this.els.nextBtn.disabled = this.arcIndex >= MAX_ARC_INDEX;

    const poolIds = [...(arc.enemyPool ?? [])];
    if (arc.bossId) poolIds.push(arc.bossId);
    const slots = Array.from({ length: SLOTS_PER_ARC }).map((_, i) => poolIds[i] ?? null);

    this.els.grid.innerHTML = slots.map((enemyId) => {
      const entry = enemyId ? this.app.bestiary.getEntry(enemyId) : null;
      if (!entry) {
        return `<div class="bestiary-tile locked">${enemyId ? t('bestiary.unknown') : t('bestiary.future_enemy')}</div>`;
      }
      return `<button class="bestiary-tile discovered" data-enemy="${enemyId}">${tData('enemy', enemyId, entry.name)}</button>`;
    }).join('');

    this.els.grid.querySelectorAll('[data-enemy]').forEach((tile) => {
      const enemyId = tile.dataset.enemy;
      const entry = this.app.bestiary.getEntry(enemyId);
      this.tooltip.bind(tile, () => `<h4>${tData('enemy', enemyId, entry.name)}</h4>${statsListHTML(entry.stats)}`);
      tile.addEventListener('click', () => {
        this.openEnemyId = enemyId;
        this.renderDetail();
      });
    });

    if (this.openEnemyId) this.renderDetail();
    else this.els.detail.classList.add('hidden');
  }

  renderDetail() {
    const entry = this.app.bestiary.getEntry(this.openEnemyId);
    if (!entry) {
      this.openEnemyId = null;
      this.els.detail.classList.add('hidden');
      return;
    }

    const sprite = getEnemySprite(this.openEnemyId);
    const enemyName = tData('enemy', this.openEnemyId, entry.name);
    this.els.detail.classList.remove('hidden');
    this.els.detail.innerHTML = `
      <button class="detail-close" data-a="close">&times;</button>
      <div class="detail-left">
        <div class="detail-name">${enemyName}</div>
        <div class="detail-image">${sprite ? `<img src="${sprite}" alt="${enemyName}">` : t('bestiary.no_image')}</div>
        <div class="detail-stats">${statsListHTML(entry.stats)}</div>
      </div>
      <div class="detail-moves">
        ${entry.moveIds.map((id) => {
          const move = getMoveTemplate(id);
          if (!move) return '';
          return `
            <button class="detail-move-row" data-move="${id}">
              <span>${tData('move', id, move.name)}</span><span>${(move.properties ?? []).map((w) => t(`property.${w}`)).join(', ')}</span>
            </button>`;
        }).join('')}
      </div>
      <div class="detail-move-info"></div>`;

    this.els.detail.querySelector('[data-a="close"]').addEventListener('click', () => {
      this.openEnemyId = null;
      this.els.detail.classList.add('hidden');
    });

    const infoPanel = this.els.detail.querySelector('.detail-move-info');
    this.els.detail.querySelectorAll('[data-move]').forEach((row) => {
      const move = getMoveTemplate(row.dataset.move);
      row.addEventListener('mouseenter', () => { infoPanel.innerHTML = abilityDetailHTML(move); });
      row.addEventListener('mouseleave', () => { infoPanel.innerHTML = ''; });
    });
  }
}
