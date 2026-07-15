import { GAME_STATES } from '../utils/Constants.js';
import { getMoveTemplate } from '../data/moves.js';
import { getCharacterSprite, CHARACTER_BORDER } from '../data/sprites.js';
import { TooltipManager } from '../ui/TooltipManager.js';
import { statsListHTML, abilityDetailHTML } from '../ui/InfoFormatters.js';

/**
 * InnState — roster (currently just Artius, framed with the same
 * avatar-box/border treatment as battle) sits on the left; clicking a
 * card opens a detail panel beside it with image, description, stats
 * and a hoverable abilities list. Always shown — no locked/"unlocks
 * later" gate, even with only one character unlocked so far.
 */
export class InnState {
  constructor(app) { this.app = app; }

  enter(root) {
    this.root = root;
    this.openCharacterId = null;
    this.tooltip = new TooltipManager();
    root.innerHTML = `
      <div class="inn-screen">
        <button class="back-btn">RETURN HOME</button>
        <h1>INN</h1>
        <div class="inn-body">
          <div class="inn-roster"></div>
          <div class="inn-detail hidden"></div>
        </div>
      </div>`;
    root.querySelector('.back-btn').addEventListener('click', () => this.app.setState(GAME_STATES.HOME));
    this.roster = root.querySelector('.inn-roster');
    this.detail = root.querySelector('.inn-detail');
    this.renderAll();
  }

  exit() {
    this.tooltip?.destroy();
  }

  renderAll() {
    const { app } = this;
    this.roster.innerHTML = app.inn.getCharacters().map((c) => {
      const selected = app.gameState.meta.selectedCharacterId === c.id;
      const sprite = getCharacterSprite(c.id);
      const inner = sprite
        ? `<img class="avatar-inner avatar-sprite" src="${sprite}" alt="${c.name}">`
        : `<div class="avatar-inner" style="background:${c.visual?.color ?? '#555'}"></div>`;
      return `
        <div class="inn-roster-item" data-id="${c.id}">
          <div class="avatar-box avatar-box-lg">
            ${inner}
            <img class="avatar-border" src="${CHARACTER_BORDER}" alt="">
          </div>
          <div class="inn-roster-name">${c.name.toUpperCase()}${selected ? ' ✓' : ''}</div>
        </div>`;
    }).join('');
    this.roster.querySelectorAll('[data-id]').forEach((el) => {
      el.addEventListener('click', () => {
        app.inn.selectMainCharacter(el.dataset.id);
        app.saveSystem.save();
        this.openCharacterId = el.dataset.id;
        this.renderAll();
      });
    });

    if (this.openCharacterId) this.renderDetail();
    else this.detail.classList.add('hidden');
  }

  renderDetail() {
    const { app } = this;
    const config = app.inn.getCharacters().find((c) => c.id === this.openCharacterId);
    if (!config) {
      this.openCharacterId = null;
      this.detail.classList.add('hidden');
      return;
    }

    const sprite = getCharacterSprite(config.id);
    this.detail.classList.remove('hidden');
    this.detail.innerHTML = `
      <div class="detail-name-bar">
        <span>${config.name.toUpperCase()}</span>
        <button class="detail-close" data-a="close">&times;</button>
      </div>
      <div class="inn-detail-body">
        <div class="inn-detail-image">${sprite ? `<img src="${sprite}" alt="${config.name}">` : 'IMAGE'}</div>
        <div class="inn-detail-desc">${config.lore ?? config.description ?? ''}</div>
        <div class="inn-detail-stats">${statsListHTML(config.baseStats)}</div>
        <div class="inn-detail-abilities">
          ${config.moveIds.map((id) => {
            const move = getMoveTemplate(id);
            if (!move) return '';
            return `
              <button class="detail-move-row" data-move="${id}">
                <span>${move.name}</span><span>${(move.properties ?? []).join(', ')}</span>
              </button>`;
          }).join('')}
        </div>
      </div>`;

    this.detail.querySelector('[data-a="close"]').addEventListener('click', () => {
      this.openCharacterId = null;
      this.detail.classList.add('hidden');
    });

    this.detail.querySelectorAll('[data-move]').forEach((row) => {
      const move = getMoveTemplate(row.dataset.move);
      this.tooltip.bind(row, () => abilityDetailHTML(move));
    });
  }
}
