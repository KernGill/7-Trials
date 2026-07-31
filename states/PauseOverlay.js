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
  CAMERA_SENSITIVITY_MIN_PERCENT, CAMERA_SENSITIVITY_MAX_PERCENT, DEFAULT_CAMERA_SENSITIVITY_PERCENT,
  CAMERA_ZOOM_MIN_PERCENT, CAMERA_ZOOM_MAX_PERCENT, DEFAULT_CAMERA_ZOOM_PERCENT,
  DEFAULT_AUTO_FOV,
} from '../ui/CameraSettings.js';
import { WALK_SPEED_MIN_PERCENT, WALK_SPEED_MAX_PERCENT, DEFAULT_WALK_SPEED_PERCENT } from '../ui/WalkSpeedSettings.js';
import {
  BRIGHTNESS_MIN_PERCENT, BRIGHTNESS_MAX_PERCENT, DEFAULT_BRIGHTNESS_PERCENT,
  GAME_SPEED_MIN, GAME_SPEED_MAX, DEFAULT_GAME_SPEED,
  DAMAGE_NUMBER_DURATION_MIN, DAMAGE_NUMBER_DURATION_MAX, DAMAGE_NUMBER_DURATION_STEP, DEFAULT_DAMAGE_NUMBER_DURATION,
  DAMAGE_NUMBER_SIZE_MIN, DAMAGE_NUMBER_SIZE_MAX, DAMAGE_NUMBER_SIZE_STEP, DEFAULT_DAMAGE_NUMBER_SIZE,
} from '../ui/DisplaySettings.js';
import { sliderRowHTML, bindSliderRow } from '../ui/SliderRow.js';
import { CameraOrientationPanel, applyAutoFov } from '../ui/CameraOrientationPanel.js';

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
    this.cameraPanel = new CameraOrientationPanel();
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

  renderSettings() {
    const { app } = this;
    const s = app.gameState.settings;
    const save = () => app.saveSystem.save();
    applyAutoFov(s);
    this.el.innerHTML = `
      <div class="pause-box settings-box">
        <h2>${t('settings.title')}</h2>
        ${sliderRowHTML({
          rowClass: 'pause-row', labelClass: 'brightness-label', sliderClass: 'brightness-slider',
          labelText: t('settings.brightness', { percent: Math.round(s.brightness * 100) }),
          min: BRIGHTNESS_MIN_PERCENT, max: BRIGHTNESS_MAX_PERCENT, value: Math.round(s.brightness * 100),
        })}
        ${sliderRowHTML({
          rowClass: 'pause-row', labelClass: 'gamespeed-label', sliderClass: 'gamespeed-slider',
          labelText: t('settings.game_speed', { mult: s.gameSpeed ?? DEFAULT_GAME_SPEED }),
          min: GAME_SPEED_MIN, max: GAME_SPEED_MAX, step: 1, value: s.gameSpeed ?? DEFAULT_GAME_SPEED,
        })}
        ${sliderRowHTML({
          rowClass: 'pause-row', labelClass: 'damage-number-duration-label', sliderClass: 'damage-number-duration-slider',
          labelText: t('settings.damage_number_duration', { mult: (s.damageNumberDuration ?? DEFAULT_DAMAGE_NUMBER_DURATION).toFixed(1) }),
          min: DAMAGE_NUMBER_DURATION_MIN, max: DAMAGE_NUMBER_DURATION_MAX, step: DAMAGE_NUMBER_DURATION_STEP, value: s.damageNumberDuration ?? DEFAULT_DAMAGE_NUMBER_DURATION,
        })}
        ${sliderRowHTML({
          rowClass: 'pause-row', labelClass: 'damage-number-size-label', sliderClass: 'damage-number-size-slider',
          labelText: t('settings.damage_number_size', { mult: (s.damageNumberSize ?? DEFAULT_DAMAGE_NUMBER_SIZE).toFixed(1) }),
          min: DAMAGE_NUMBER_SIZE_MIN, max: DAMAGE_NUMBER_SIZE_MAX, step: DAMAGE_NUMBER_SIZE_STEP, value: s.damageNumberSize ?? DEFAULT_DAMAGE_NUMBER_SIZE,
        })}
        <div class="pause-row">
          <span>${t('settings.language')}</span>
          <select class="language-select">
            ${LANGUAGE_OPTIONS.map((lang) => `<option value="${lang}" ${lang === s.language ? 'selected' : ''}>${t(`settings.language.${lang}`)}</option>`).join('')}
          </select>
        </div>
        <div class="pause-row">${t('settings.sound')} <button data-a="sound">${s.sound ? t('settings.on') : t('settings.off')}</button></div>
        <div class="pause-row">${t('settings.fixed_minimap')} <button data-a="fixed-minimap">${s.fixedMinimap ? t('settings.on') : t('settings.off')}</button></div>
        ${sliderRowHTML({
          rowClass: 'pause-row', labelClass: 'camera-sensitivity-label', sliderClass: 'camera-sensitivity-slider',
          labelText: t('settings.camera_sensitivity', { percent: Math.round((s.cameraSensitivity ?? DEFAULT_CAMERA_SENSITIVITY_PERCENT / 100) * 100) }),
          min: CAMERA_SENSITIVITY_MIN_PERCENT, max: CAMERA_SENSITIVITY_MAX_PERCENT, step: 1,
          value: Math.round((s.cameraSensitivity ?? DEFAULT_CAMERA_SENSITIVITY_PERCENT / 100) * 100),
        })}
        ${sliderRowHTML({
          rowClass: 'pause-row', labelClass: 'walk-speed-label', sliderClass: 'walk-speed-slider',
          labelText: t('settings.walk_speed', { percent: Math.round((s.walkSpeed ?? DEFAULT_WALK_SPEED_PERCENT / 100) * 100) }),
          min: WALK_SPEED_MIN_PERCENT, max: WALK_SPEED_MAX_PERCENT, step: 1,
          value: Math.round((s.walkSpeed ?? DEFAULT_WALK_SPEED_PERCENT / 100) * 100),
        })}
        ${sliderRowHTML({
          rowClass: 'pause-row', labelClass: 'camera-fov-label', sliderClass: 'camera-fov-slider',
          labelText: t('settings.camera_fov', { percent: Math.round(s.cameraZoom ?? DEFAULT_CAMERA_ZOOM_PERCENT) }),
          min: CAMERA_ZOOM_MIN_PERCENT, max: CAMERA_ZOOM_MAX_PERCENT, step: 1,
          value: Math.round(s.cameraZoom ?? DEFAULT_CAMERA_ZOOM_PERCENT), disabled: !!s.autoFOV,
        })}
        <div class="pause-row">${t('settings.auto_fov')} <button data-a="auto-fov">${(s.autoFOV ?? DEFAULT_AUTO_FOV) ? t('settings.on') : t('settings.off')}</button></div>
        ${this.cameraPanel.html(s, 'pause-row')}
        <button data-a="back">${t('common.back')}</button>
      </div>`;

    bindSliderRow(this.el, {
      sliderClass: 'brightness-slider', labelClass: 'brightness-label', onSave: save,
      onInput: (v) => {
        s.brightness = clamp(v / 100, BRIGHTNESS_MIN_PERCENT / 100, BRIGHTNESS_MAX_PERCENT / 100);
        app.applyBrightness();
        return t('settings.brightness', { percent: Math.round(s.brightness * 100) });
      },
    });
    bindSliderRow(this.el, {
      sliderClass: 'gamespeed-slider', labelClass: 'gamespeed-label', onSave: save,
      onInput: (v) => {
        s.gameSpeed = clamp(v, GAME_SPEED_MIN, GAME_SPEED_MAX);
        return t('settings.game_speed', { mult: s.gameSpeed });
      },
    });
    bindSliderRow(this.el, {
      sliderClass: 'damage-number-duration-slider', labelClass: 'damage-number-duration-label', onSave: save,
      onInput: (v) => {
        s.damageNumberDuration = clamp(v, DAMAGE_NUMBER_DURATION_MIN, DAMAGE_NUMBER_DURATION_MAX);
        return t('settings.damage_number_duration', { mult: s.damageNumberDuration.toFixed(1) });
      },
    });
    bindSliderRow(this.el, {
      sliderClass: 'damage-number-size-slider', labelClass: 'damage-number-size-label', onSave: save,
      onInput: (v) => {
        s.damageNumberSize = clamp(v, DAMAGE_NUMBER_SIZE_MIN, DAMAGE_NUMBER_SIZE_MAX);
        return t('settings.damage_number_size', { mult: s.damageNumberSize.toFixed(1) });
      },
    });
    this.el.querySelector('.language-select').addEventListener('change', (e) => {
      app.setLanguage(e.target.value);
      save();
      this.render(); // full re-render — every label on this view needs the new language
    });
    this.el.querySelector('[data-a="sound"]').addEventListener('click', () => { s.sound = !s.sound; save(); this.render(); });
    this.el.querySelector('[data-a="fixed-minimap"]').addEventListener('click', () => {
      s.fixedMinimap = !s.fixedMinimap;
      save();
      this.render();
    });
    bindSliderRow(this.el, {
      sliderClass: 'camera-sensitivity-slider', labelClass: 'camera-sensitivity-label', onSave: save,
      onInput: (v) => {
        s.cameraSensitivity = clamp(v / 100, CAMERA_SENSITIVITY_MIN_PERCENT / 100, CAMERA_SENSITIVITY_MAX_PERCENT / 100);
        return t('settings.camera_sensitivity', { percent: Math.round(s.cameraSensitivity * 100) });
      },
    });
    bindSliderRow(this.el, {
      sliderClass: 'walk-speed-slider', labelClass: 'walk-speed-label', onSave: save,
      onInput: (v) => {
        s.walkSpeed = clamp(v / 100, WALK_SPEED_MIN_PERCENT / 100, WALK_SPEED_MAX_PERCENT / 100);
        return t('settings.walk_speed', { percent: Math.round(s.walkSpeed * 100) });
      },
    });
    bindSliderRow(this.el, {
      sliderClass: 'camera-fov-slider', labelClass: 'camera-fov-label', onSave: save,
      onInput: (v) => {
        s.cameraZoom = clamp(v, CAMERA_ZOOM_MIN_PERCENT, CAMERA_ZOOM_MAX_PERCENT);
        return t('settings.camera_fov', { percent: Math.round(s.cameraZoom) });
      },
    });
    this.el.querySelector('[data-a="auto-fov"]').addEventListener('click', () => {
      s.autoFOV = !(s.autoFOV ?? DEFAULT_AUTO_FOV);
      applyAutoFov(s); // snaps the FOV slider into alignment immediately when turning on
      save();
      this.render();
    });
    this.cameraPanel.bind(this.el, s, { save, rerender: () => this.render() });
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
