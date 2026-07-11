import { GAME_STATES } from '../utils/Constants.js';

export class InnState {
  constructor(app) { this.app = app; }

  enter(root) {
    this.root = root;
    root.innerHTML = `
      <div class="inn-screen">
        <button class="back-btn">RETURN HOME</button>
        <h1>INN</h1>
        <div class="inn-list"></div>
      </div>`;
    root.querySelector('.back-btn').addEventListener('click', () => this.app.setState(GAME_STATES.HOME));
    this.list = root.querySelector('.inn-list');
    this.renderAll();
  }

  exit() {}

  renderAll() {
    const { app } = this;
    if (!app.inn.isUnlocked()) {
      this.list.innerHTML = '<div class="inn-locked">The Inn unlocks after clearing Arc 2.</div>';
      return;
    }
    this.list.innerHTML = app.inn.getCharacters().map((c) => {
      const selected = app.gameState.meta.selectedCharacterId === c.id;
      return `
        <div class="inn-card" data-id="${c.id}">
          <div class="inn-name">${c.name}${selected ? ' \u2713' : ''}</div>
          <div class="inn-desc">${c.description ?? ''}</div>
        </div>`;
    }).join('');
    this.list.querySelectorAll('[data-id]').forEach((el) => {
      el.addEventListener('click', () => {
        app.inn.selectMainCharacter(el.dataset.id);
        this.renderAll();
      });
    });
  }
}
