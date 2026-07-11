import { GAME_STATES } from '../utils/Constants.js';
import { clamp } from '../utils/MathUtils.js';

export class SettingsState {
  constructor(app) { this.app = app; }

  enter(root) {
    this.root = root;
    root.innerHTML = `
      <div class="settings-screen">
        <button class="back-btn">RETURN HOME</button>
        <h1>SETTINGS</h1>
        <div class="settings-body"></div>
      </div>`;
    root.querySelector('.back-btn').addEventListener('click', () => this.app.setState(GAME_STATES.HOME));
    this.body = root.querySelector('.settings-body');
    this.renderAll();
  }

  exit() {}

  renderAll() {
    const s = this.app.gameState.settings;
    this.body.innerHTML = `
      <div class="settings-row">
        <span>Brightness: ${Math.round(s.brightness * 100)}%</span>
        <input type="range" min="30" max="150" value="${Math.round(s.brightness * 100)}" class="brightness-slider">
      </div>
      <div class="settings-row">
        <span>Sound: (no audio implemented yet)</span>
        <button class="sound-btn">${s.sound ? 'On' : 'Off'}</button>
      </div>`;
    this.body.querySelector('.brightness-slider').addEventListener('input', (e) => {
      s.brightness = clamp(Number(e.target.value) / 100, 0.3, 1.5);
    });
    this.body.querySelector('.sound-btn').addEventListener('click', () => { s.sound = !s.sound; this.renderAll(); });
  }
}
