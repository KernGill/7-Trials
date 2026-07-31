import { clamp } from '../utils/MathUtils.js';
import { GAME_STATES } from '../utils/Constants.js';
import { getConsumableConfig } from '../data/consumables.js';
import { getItemConfig } from '../data/items.js';
import { getAllAchievements } from '../data/achievements.js';
import { achievementCardHTML } from './AchievementsState.js';
import { TooltipManager } from '../ui/TooltipManager.js';
import { itemTooltipHTML, equipmentGridHTML, equipmentTotalsHTML, cardTileHTML } from '../ui/InfoFormatters.js';
import { t, tData } from '../ui/i18n.js';
import {
  CAMERA_ANGLE_MIN, CAMERA_ANGLE_MAX, CAMERA_HEIGHT_MIN_PERCENT, CAMERA_HEIGHT_MAX_PERCENT,
  DEFAULT_CAMERA_ANGLE, DEFAULT_CAMERA_HEIGHT, linkedHeightPercentForAngle,
  CAMERA_SENSITIVITY_MIN_PERCENT, CAMERA_SENSITIVITY_MAX_PERCENT, DEFAULT_CAMERA_SENSITIVITY_PERCENT,
  CAMERA_ZOOM_MIN_PERCENT, CAMERA_ZOOM_MAX_PERCENT, DEFAULT_CAMERA_ZOOM_PERCENT,
  DEFAULT_AUTO_FOV, autoFovPercentForAngle,
} from '../ui/CameraSettings.js';
import { WALK_SPEED_MIN_PERCENT, WALK_SPEED_MAX_PERCENT, DEFAULT_WALK_SPEED_PERCENT } from '../ui/WalkSpeedSettings.js';

const LANGUAGE_OPTIONS = ['en', 'es'];

/**
 * PauseOverlay — reusable pause-menu component mounted/unmounted by
 * ExploreState and FightState (pausing is valid in either place; only
 * "can I abandon?" differs). Pure DOM, re-renders only on its own
 * button clicks — never on a timer/frame loop.
 */
export class PauseOverlay {
  constructor(app) {
    this.app = app;
    this.el = null;
    this.fineTuneOpen = false;
  }

  mount(root, { canAbandon, allowConsumables = false, onUseConsumable = null }) {
    this.canAbandon = canAbandon;
    this.allowConsumables = allowConsumables;
    this.onUseConsumable = onUseConsumable;
    this.el = document.createElement('div');
    this.el.className = 'pause-overlay';
    root.appendChild(this.el);
    this.tooltip = new TooltipManager();
    this.render();
  }

  unmount() {
    this.el?.remove();
    this.el = null;
    this.tooltip?.destroy();
    this.tooltip = null;
  }

  render() {
    if (!this.el) return;
    const { app } = this;
    const view = app.gameState.pauseView ?? 'menu';
    if (view === 'settings') return this.renderSettings();
    if (view === 'loadout') return this.renderLoadout();
    if (view === 'cards') return this.renderCards();
    if (view === 'consumables') return this.renderConsumables();
    if (view === 'encyclopedia') return this.renderEncyclopedia();
    if (view === 'achievements') return this.renderAchievements();
    return this.renderMenu();
  }

  renderMenu() {
    const { app } = this;
    this.el.innerHTML = `
      <div class="pause-box">
        <h2>${t('pause.title')}</h2>
        <button data-a="resume">${t('pause.resume')}</button>
        <button data-a="loadout">${t('pause.view_loadout')}</button>
        <button data-a="cards">${t('pause.view_cards')}</button>
        ${this.allowConsumables ? `<button data-a="consumables">${t('pause.use_consumables')}</button>` : ''}
        <button data-a="encyclopedia">${t('pause.encyclopedia')}</button>
        <button data-a="settings">${t('pause.open_settings')}</button>
        <button data-a="abandon" ${this.canAbandon ? '' : 'disabled'}>
          ${this.canAbandon ? t('pause.abandon_run') : t('pause.cannot_leave')}
        </button>
      </div>`;
    this.el.querySelector('[data-a="resume"]').addEventListener('click', () => app.togglePause());
    this.el.querySelector('[data-a="loadout"]').addEventListener('click', () => { app.gameState.pauseView = 'loadout'; this.render(); });
    this.el.querySelector('[data-a="cards"]').addEventListener('click', () => { app.gameState.pauseView = 'cards'; this.render(); });
    this.el.querySelector('[data-a="encyclopedia"]').addEventListener('click', () => { app.gameState.pauseView = 'encyclopedia'; this.render(); });
    this.el.querySelector('[data-a="settings"]').addEventListener('click', () => { app.gameState.pauseView = 'settings'; this.render(); });
    if (this.allowConsumables) {
      this.el.querySelector('[data-a="consumables"]').addEventListener('click', () => { app.gameState.pauseView = 'consumables'; this.render(); });
    }
    if (this.canAbandon) {
      this.el.querySelector('[data-a="abandon"]').addEventListener('click', () => {
        app.abandonRun();
      });
    }
  }

  renderConsumables() {
    const { app } = this;
    const entries = Object.entries(app.gameState.run.consumables ?? {}).filter(([, amt]) => amt > 0);
    this.el.innerHTML = `
      <div class="pause-box">
        <h2>${t('pause.consumables_title')}</h2>
        ${entries.length === 0 ? `<div class="pause-row">${t('fight.no_consumables')}</div>` : ''}
        ${entries.map(([id, amt]) => {
          const cfg = getConsumableConfig(id);
          return `<button data-use="${id}">${t('pause.use_item', { name: tData('consumable', id, cfg?.name ?? id), amount: amt })}</button>`;
        }).join('')}
        <button data-a="back">${t('common.back')}</button>
      </div>`;
    this.el.querySelectorAll('[data-use]').forEach((btn) => {
      btn.addEventListener('click', () => {
        this.onUseConsumable?.(btn.dataset.use);
        this.render();
      });
    });
    this.el.querySelector('[data-a="back"]').addEventListener('click', () => { app.gameState.pauseView = 'menu'; this.render(); });
  }

  cameraSectionHTML(s) {
    const angle = Math.round(s.cameraAngle ?? DEFAULT_CAMERA_ANGLE);
    const linkedHeight = Math.round(linkedHeightPercentForAngle(angle));
    const height = Math.round((s.cameraHeight ?? DEFAULT_CAMERA_HEIGHT) * 100);
    return `
      <div class="pause-row">
        <span class="camera-combined-label">${t('settings.camera_orientation', { angle, height: linkedHeight })}</span>
        <input type="range" min="${CAMERA_ANGLE_MIN}" max="${CAMERA_ANGLE_MAX}" step="1" value="${angle}" class="camera-combined-slider">
        <button class="fine-tune-btn">${t('settings.fine_tune')}</button>
      </div>
      ${this.fineTuneOpen ? `
        <div class="pause-row fine-tune-row">
          <span class="camera-angle-label">${t('settings.camera_angle', { deg: angle })}</span>
          <input type="range" min="${CAMERA_ANGLE_MIN}" max="${CAMERA_ANGLE_MAX}" step="1" value="${angle}" class="camera-angle-slider">
        </div>
        <div class="pause-row fine-tune-row">
          <span class="camera-height-label">${t('settings.camera_height', { percent: height })}</span>
          <input type="range" min="${CAMERA_HEIGHT_MIN_PERCENT}" max="${CAMERA_HEIGHT_MAX_PERCENT}" step="1" value="${height}" class="camera-height-slider">
        </div>
        <div class="pause-row fine-tune-row">
          <button class="camera-reset-btn">${t('settings.reset_default')}</button>
        </div>
      ` : ''}`;
  }

  /** If Auto FOV is on, derives cameraZoom from the current cameraAngle — called anywhere cameraAngle changes (either camera slider, or Reset to Default) and when Auto FOV is toggled on, so the FOV slider always lands back in sync with orientation. */
  applyAutoFov(s) {
    if (!s.autoFOV) return;
    s.cameraZoom = autoFovPercentForAngle(s.cameraAngle ?? DEFAULT_CAMERA_ANGLE);
  }

  /** Keeps the combined slider's label and (if open) the fine-tune sub-sliders' thumbs/labels all in sync, without a full re-render. Also re-syncs the FOV slider whenever Auto FOV is on, since angle changes drive it too. */
  syncCameraDisplays(s) {
    const angle = Math.round(s.cameraAngle ?? DEFAULT_CAMERA_ANGLE);
    const linkedHeight = Math.round(linkedHeightPercentForAngle(angle));
    const height = Math.round((s.cameraHeight ?? DEFAULT_CAMERA_HEIGHT) * 100);
    this.el.querySelector('.camera-combined-label').textContent = t('settings.camera_orientation', { angle, height: linkedHeight });
    this.el.querySelector('.camera-combined-slider').value = angle;
    this.applyAutoFov(s);
    this.el.querySelector('.camera-fov-label').textContent = t('settings.camera_fov', { percent: Math.round(s.cameraZoom ?? DEFAULT_CAMERA_ZOOM_PERCENT) });
    this.el.querySelector('.camera-fov-slider').value = Math.round(s.cameraZoom ?? DEFAULT_CAMERA_ZOOM_PERCENT);
    if (!this.fineTuneOpen) return;
    this.el.querySelector('.camera-angle-label').textContent = t('settings.camera_angle', { deg: angle });
    this.el.querySelector('.camera-angle-slider').value = angle;
    this.el.querySelector('.camera-height-label').textContent = t('settings.camera_height', { percent: height });
    this.el.querySelector('.camera-height-slider').value = height;
  }

  bindCameraEvents(s) {
    const { app } = this;
    this.el.querySelector('.camera-combined-slider').addEventListener('change', () => app.saveSystem.save());
    this.el.querySelector('.camera-combined-slider').addEventListener('input', (e) => {
      s.cameraAngle = clamp(Number(e.target.value), CAMERA_ANGLE_MIN, CAMERA_ANGLE_MAX);
      s.cameraHeight = linkedHeightPercentForAngle(s.cameraAngle) / 100;
      this.syncCameraDisplays(s);
    });
    this.el.querySelector('.fine-tune-btn').addEventListener('click', () => {
      this.fineTuneOpen = !this.fineTuneOpen;
      this.render();
    });
    if (!this.fineTuneOpen) return;
    this.el.querySelector('.camera-angle-slider').addEventListener('change', () => app.saveSystem.save());
    this.el.querySelector('.camera-angle-slider').addEventListener('input', (e) => {
      s.cameraAngle = clamp(Number(e.target.value), CAMERA_ANGLE_MIN, CAMERA_ANGLE_MAX);
      this.syncCameraDisplays(s);
    });
    this.el.querySelector('.camera-height-slider').addEventListener('change', () => app.saveSystem.save());
    this.el.querySelector('.camera-height-slider').addEventListener('input', (e) => {
      s.cameraHeight = clamp(Number(e.target.value) / 100, CAMERA_HEIGHT_MIN_PERCENT / 100, CAMERA_HEIGHT_MAX_PERCENT / 100);
      this.syncCameraDisplays(s);
    });
    this.el.querySelector('.camera-reset-btn').addEventListener('click', () => {
      s.cameraAngle = DEFAULT_CAMERA_ANGLE;
      s.cameraHeight = DEFAULT_CAMERA_HEIGHT;
      app.saveSystem.save();
      this.render();
    });
  }

  renderSettings() {
    const { app } = this;
    const s = app.gameState.settings;
    this.applyAutoFov(s);
    this.el.innerHTML = `
      <div class="pause-box settings-box">
        <h2>${t('settings.title')}</h2>
        <div class="pause-row">
          <span class="brightness-label">${t('settings.brightness', { percent: Math.round(s.brightness * 100) })}</span>
          <input type="range" min="30" max="150" value="${Math.round(s.brightness * 100)}" class="brightness-slider">
        </div>
        <div class="pause-row">
          <span class="gamespeed-label">${t('settings.game_speed', { mult: s.gameSpeed ?? 2 })}</span>
          <input type="range" min="1" max="5" step="1" value="${s.gameSpeed ?? 2}" class="gamespeed-slider">
        </div>
        <div class="pause-row">
          <span class="damage-number-duration-label">${t('settings.damage_number_duration', { mult: (s.damageNumberDuration ?? 1).toFixed(1) })}</span>
          <input type="range" min="1" max="10" step="0.5" value="${s.damageNumberDuration ?? 1}" class="damage-number-duration-slider">
        </div>
        <div class="pause-row">
          <span class="damage-number-size-label">${t('settings.damage_number_size', { mult: (s.damageNumberSize ?? 1).toFixed(1) })}</span>
          <input type="range" min="1" max="3" step="0.1" value="${s.damageNumberSize ?? 1}" class="damage-number-size-slider">
        </div>
        <div class="pause-row">
          <span>${t('settings.language')}</span>
          <select class="language-select">
            ${LANGUAGE_OPTIONS.map((lang) => `<option value="${lang}" ${lang === s.language ? 'selected' : ''}>${t(`settings.language.${lang}`)}</option>`).join('')}
          </select>
        </div>
        <div class="pause-row">${t('settings.sound')} <button data-a="sound">${s.sound ? t('settings.on') : t('settings.off')}</button></div>
        <div class="pause-row">${t('settings.fixed_minimap')} <button data-a="fixed-minimap">${s.fixedMinimap ? t('settings.on') : t('settings.off')}</button></div>
        <div class="pause-row">
          <span class="camera-sensitivity-label">${t('settings.camera_sensitivity', { percent: Math.round((s.cameraSensitivity ?? DEFAULT_CAMERA_SENSITIVITY_PERCENT / 100) * 100) })}</span>
          <input type="range" min="${CAMERA_SENSITIVITY_MIN_PERCENT}" max="${CAMERA_SENSITIVITY_MAX_PERCENT}" step="1" value="${Math.round((s.cameraSensitivity ?? DEFAULT_CAMERA_SENSITIVITY_PERCENT / 100) * 100)}" class="camera-sensitivity-slider">
        </div>
        <div class="pause-row">
          <span class="walk-speed-label">${t('settings.walk_speed', { percent: Math.round((s.walkSpeed ?? DEFAULT_WALK_SPEED_PERCENT / 100) * 100) })}</span>
          <input type="range" min="${WALK_SPEED_MIN_PERCENT}" max="${WALK_SPEED_MAX_PERCENT}" step="1" value="${Math.round((s.walkSpeed ?? DEFAULT_WALK_SPEED_PERCENT / 100) * 100)}" class="walk-speed-slider">
        </div>
        <div class="pause-row">
          <span class="camera-fov-label">${t('settings.camera_fov', { percent: Math.round(s.cameraZoom ?? DEFAULT_CAMERA_ZOOM_PERCENT) })}</span>
          <input type="range" min="${CAMERA_ZOOM_MIN_PERCENT}" max="${CAMERA_ZOOM_MAX_PERCENT}" step="1" value="${Math.round(s.cameraZoom ?? DEFAULT_CAMERA_ZOOM_PERCENT)}" class="camera-fov-slider" ${s.autoFOV ? 'disabled' : ''}>
        </div>
        <div class="pause-row">${t('settings.auto_fov')} <button data-a="auto-fov">${(s.autoFOV ?? DEFAULT_AUTO_FOV) ? t('settings.on') : t('settings.off')}</button></div>
        ${this.cameraSectionHTML(s)}
        <button data-a="back">${t('common.back')}</button>
      </div>`;
    this.el.querySelector('.brightness-slider').addEventListener('change', () => app.saveSystem.save());
    this.el.querySelector('.brightness-slider').addEventListener('input', (e) => {
      s.brightness = clamp(Number(e.target.value) / 100, 0.3, 1.5);
      app.applyBrightness();
      this.el.querySelector('.brightness-label').textContent = t('settings.brightness', { percent: Math.round(s.brightness * 100) });
    });
    this.el.querySelector('.gamespeed-slider').addEventListener('change', () => app.saveSystem.save());
    this.el.querySelector('.gamespeed-slider').addEventListener('input', (e) => {
      s.gameSpeed = clamp(Number(e.target.value), 1, 5);
      this.el.querySelector('.gamespeed-label').textContent = t('settings.game_speed', { mult: s.gameSpeed });
    });
    this.el.querySelector('.damage-number-duration-slider').addEventListener('change', () => app.saveSystem.save());
    this.el.querySelector('.damage-number-duration-slider').addEventListener('input', (e) => {
      s.damageNumberDuration = clamp(Number(e.target.value), 1, 10);
      this.el.querySelector('.damage-number-duration-label').textContent = t('settings.damage_number_duration', { mult: s.damageNumberDuration.toFixed(1) });
    });
    this.el.querySelector('.damage-number-size-slider').addEventListener('change', () => app.saveSystem.save());
    this.el.querySelector('.damage-number-size-slider').addEventListener('input', (e) => {
      s.damageNumberSize = clamp(Number(e.target.value), 1, 3);
      this.el.querySelector('.damage-number-size-label').textContent = t('settings.damage_number_size', { mult: s.damageNumberSize.toFixed(1) });
    });
    this.el.querySelector('.language-select').addEventListener('change', (e) => {
      app.setLanguage(e.target.value);
      app.saveSystem.save();
      this.render(); // full re-render — every label on this view needs the new language
    });
    this.el.querySelector('[data-a="sound"]').addEventListener('click', () => { s.sound = !s.sound; app.saveSystem.save(); this.render(); });
    this.el.querySelector('[data-a="fixed-minimap"]').addEventListener('click', () => {
      s.fixedMinimap = !s.fixedMinimap;
      app.saveSystem.save();
      this.render();
    });
    this.el.querySelector('.camera-sensitivity-slider').addEventListener('change', () => app.saveSystem.save());
    this.el.querySelector('.camera-sensitivity-slider').addEventListener('input', (e) => {
      s.cameraSensitivity = clamp(Number(e.target.value) / 100, CAMERA_SENSITIVITY_MIN_PERCENT / 100, CAMERA_SENSITIVITY_MAX_PERCENT / 100);
      this.el.querySelector('.camera-sensitivity-label').textContent = t('settings.camera_sensitivity', { percent: Math.round(s.cameraSensitivity * 100) });
    });
    this.el.querySelector('.walk-speed-slider').addEventListener('change', () => app.saveSystem.save());
    this.el.querySelector('.walk-speed-slider').addEventListener('input', (e) => {
      s.walkSpeed = clamp(Number(e.target.value) / 100, WALK_SPEED_MIN_PERCENT / 100, WALK_SPEED_MAX_PERCENT / 100);
      this.el.querySelector('.walk-speed-label').textContent = t('settings.walk_speed', { percent: Math.round(s.walkSpeed * 100) });
    });
    this.el.querySelector('.camera-fov-slider').addEventListener('change', () => app.saveSystem.save());
    this.el.querySelector('.camera-fov-slider').addEventListener('input', (e) => {
      s.cameraZoom = clamp(Number(e.target.value), CAMERA_ZOOM_MIN_PERCENT, CAMERA_ZOOM_MAX_PERCENT);
      this.el.querySelector('.camera-fov-label').textContent = t('settings.camera_fov', { percent: Math.round(s.cameraZoom) });
    });
    this.el.querySelector('[data-a="auto-fov"]').addEventListener('click', () => {
      s.autoFOV = !(s.autoFOV ?? DEFAULT_AUTO_FOV);
      this.applyAutoFov(s); // snaps the FOV slider into alignment immediately when turning on
      app.saveSystem.save();
      this.render();
    });
    this.bindCameraEvents(s);
    this.el.querySelector('[data-a="back"]').addEventListener('click', () => { app.gameState.pauseView = 'menu'; this.render(); });
  }

  /** Same per-slot hover-tooltip behavior as LockerState's equipment tab. */
  renderLoadout() {
    const { app } = this;
    const equipped = app.inventory.getEquippedItems();
    const totals = app.inventory.getEquippedStatTotals();

    this.el.innerHTML = `
      <div class="pause-box loadout-box">
        <h2>${t('pause.loadout_title')}</h2>
        ${equipmentGridHTML(equipped)}
        <div class="loadout-totals">
          <h3>${t('pause.total_stats')}</h3>
          ${equipmentTotalsHTML(totals)}
        </div>
        <button data-a="back">${t('common.back')}</button>
      </div>`;

    this.el.querySelectorAll('[data-item-id]').forEach((tile) => {
      this.tooltip.bind(tile, () => {
        const config = getItemConfig(tile.dataset.itemId);
        return config ? itemTooltipHTML(config) : '';
      });
    });
    this.el.querySelector('[data-a="back"]').addEventListener('click', () => { app.gameState.pauseView = 'menu'; this.render(); });
  }

  /** Lists every card picked so far this run — cards are wiped whenever the run ends, so this is always run-scoped. */
  renderCards() {
    const { app } = this;
    const cards = app.gameState.run.cards ?? [];

    this.el.innerHTML = `
      <div class="pause-box cards-box">
        <h2>${t('pause.cards_title')}</h2>
        ${cards.length === 0
          ? `<div class="pause-row">${t('pause.no_cards')}</div>`
          : `<div class="cards-list">${cards.map((c) => cardTileHTML(c)).join('')}</div>`}
        <button data-a="back">${t('common.back')}</button>
      </div>`;

    this.el.querySelector('[data-a="back"]').addEventListener('click', () => { app.gameState.pauseView = 'menu'; this.render(); });
  }

  /**
   * Mirrors Home's Encyclopedia hub (Bestiary/Achievements), but Bestiary
   * is only offered when paused from Explore, not Fight: it's a
   * full-screen state switch (see below), and returning cleanly into a
   * fight-in-progress isn't something this codebase's FightState
   * supports — Explore has no such risk, so it's fine there. Achievements
   * always stays available since it's a same-DOM sub-view, never a state
   * switch.
   */
  renderEncyclopedia() {
    const { app } = this;
    this.el.innerHTML = `
      <div class="pause-box">
        <h2>${t('encyclopedia.title')}</h2>
        ${this.canAbandon ? `<button data-a="bestiary">${t('encyclopedia.bestiary')}</button>` : ''}
        <button data-a="achievements">${t('encyclopedia.achievements')}</button>
        <button data-a="back">${t('common.back')}</button>
      </div>`;
    if (this.canAbandon) {
      this.el.querySelector('[data-a="bestiary"]').addEventListener('click', () => {
        // The one deliberate exception to "every state's back button goes
        // Home" — see StateManager.resumeFromBestiary for the return trip.
        app.returnStateAfterBestiary = app.gameState.currentState;
        app.setState(GAME_STATES.BESTIARY);
      });
    }
    this.el.querySelector('[data-a="achievements"]').addEventListener('click', () => { app.gameState.pauseView = 'achievements'; this.render(); });
    this.el.querySelector('[data-a="back"]').addEventListener('click', () => { app.gameState.pauseView = 'menu'; this.render(); });
  }

  /**
   * Same achievement cards as the full-screen AchievementsState (shared
   * achievementCardHTML — see that file), rendered in-place as a pause
   * sub-view instead of a full state switch, so checking progress
   * mid-run (per user request, chiefly for Thief's Instinct's live
   * per-floor streak) never tears down the active Explore/Fight screen
   * underneath.
   */
  renderAchievements() {
    const { app } = this;
    this.el.innerHTML = `
      <div class="pause-box achievements-box">
        <h2>${t('achievements.title')}</h2>
        <div class="achievements-list">${getAllAchievements().map((config) => achievementCardHTML(app, config)).join('')}</div>
        <button data-a="back">${t('common.back')}</button>
      </div>`;
    this.el.querySelector('[data-a="back"]').addEventListener('click', () => { app.gameState.pauseView = 'encyclopedia'; this.render(); });
  }
}
