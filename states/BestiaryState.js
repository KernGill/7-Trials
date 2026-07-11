import { GAME_STATES } from '../utils/Constants.js';

export class BestiaryState {
  constructor(app) { this.app = app; }

  enter(root) {
    this.root = root;
    root.innerHTML = `
      <div class="bestiary-screen">
        <button class="back-btn">RETURN HOME</button>
        <h1>BESTIARY</h1>
        <div class="bestiary-list"></div>
      </div>`;
    root.querySelector('.back-btn').addEventListener('click', () => this.app.setState(GAME_STATES.HOME));
    this.list = root.querySelector('.bestiary-list');
    this.renderAll();
  }

  exit() {}

  renderAll() {
    const entries = this.app.bestiary.getEntries();
    if (!entries.length) {
      this.list.innerHTML = '<div class="bestiary-empty">No enemies discovered yet.</div>';
      return;
    }
    this.list.innerHTML = entries.map((e) => `
      <div class="bestiary-card">
        <div class="bestiary-name">${e.name} (defeated x${e.kills})</div>
        <div class="bestiary-stats">
          Con:${e.stats.con} Dex:${e.stats.dex} Str:${e.stats.str}
          Spd:${e.stats.spd} Def:${e.stats.def} Int:${e.stats.int}
          Crit:${e.stats.critChance}%
        </div>
      </div>`).join('');
  }
}
