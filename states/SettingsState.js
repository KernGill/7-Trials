import { GAME_STATES } from '../utils/Constants.js';
import { clamp } from '../utils/MathUtils.js';
import { t } from '../ui/i18n.js';
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

const FPS_OPTIONS = [30, 60, 90, 120, 144];
const LANGUAGE_OPTIONS = ['en', 'es'];
const ROW_CLASS = 'settings-row';

export class SettingsState {
  constructor(app) {
    this.app = app;
    this.cameraPanel = new CameraOrientationPanel();
  }

  enter(root) {
    this.root = root;
    root.innerHTML = `
      <div class="settings-screen">
        <button class="back-btn">${t('common.return_home')}</button>
        <h1>${t('settings.title')}</h1>
        <div class="settings-body"></div>
      </div>`;
    root.querySelector('.back-btn').addEventListener('click', () => this.app.setState(GAME_STATES.HOME));
    this.body = root.querySelector('.settings-body');
    this.renderAll();
  }

  exit() {}

  renderAll() {
    const s = this.app.gameState.settings;
    const save = () => this.app.saveSystem.save();
    applyAutoFov(s);
    this.body.innerHTML = `
      ${sliderRowHTML({
        rowClass: ROW_CLASS, labelClass: 'brightness-label', sliderClass: 'brightness-slider',
        labelText: t('settings.brightness', { percent: Math.round(s.brightness * 100) }),
        min: BRIGHTNESS_MIN_PERCENT, max: BRIGHTNESS_MAX_PERCENT, value: Math.round(s.brightness * 100),
      })}
      ${sliderRowHTML({
        rowClass: ROW_CLASS, labelClass: 'gamespeed-label', sliderClass: 'gamespeed-slider',
        labelText: t('settings.game_speed', { mult: s.gameSpeed ?? DEFAULT_GAME_SPEED }),
        min: GAME_SPEED_MIN, max: GAME_SPEED_MAX, step: 1, value: s.gameSpeed ?? DEFAULT_GAME_SPEED,
      })}
      ${sliderRowHTML({
        rowClass: ROW_CLASS, labelClass: 'damage-number-duration-label', sliderClass: 'damage-number-duration-slider',
        labelText: t('settings.damage_number_duration', { mult: (s.damageNumberDuration ?? DEFAULT_DAMAGE_NUMBER_DURATION).toFixed(1) }),
        min: DAMAGE_NUMBER_DURATION_MIN, max: DAMAGE_NUMBER_DURATION_MAX, step: DAMAGE_NUMBER_DURATION_STEP, value: s.damageNumberDuration ?? DEFAULT_DAMAGE_NUMBER_DURATION,
      })}
      ${sliderRowHTML({
        rowClass: ROW_CLASS, labelClass: 'damage-number-size-label', sliderClass: 'damage-number-size-slider',
        labelText: t('settings.damage_number_size', { mult: (s.damageNumberSize ?? DEFAULT_DAMAGE_NUMBER_SIZE).toFixed(1) }),
        min: DAMAGE_NUMBER_SIZE_MIN, max: DAMAGE_NUMBER_SIZE_MAX, step: DAMAGE_NUMBER_SIZE_STEP, value: s.damageNumberSize ?? DEFAULT_DAMAGE_NUMBER_SIZE,
      })}
      <div class="settings-row">
        <span>${t('settings.fps')}</span>
        <select class="fps-select">
          ${FPS_OPTIONS.map((fps) => `<option value="${fps}" ${fps === s.fps ? 'selected' : ''}>${fps}</option>`).join('')}
        </select>
      </div>
      <div class="settings-row">
        <span>${t('settings.language')}</span>
        <select class="language-select">
          ${LANGUAGE_OPTIONS.map((lang) => `<option value="${lang}" ${lang === s.language ? 'selected' : ''}>${t(`settings.language.${lang}`)}</option>`).join('')}
        </select>
      </div>
      <div class="settings-row">
        <span>${t('settings.sound')}</span>
        <button class="sound-btn">${s.sound ? t('settings.on') : t('settings.off')}</button>
      </div>
      <div class="settings-row">
        <span>${t('settings.fixed_minimap')}</span>
        <button class="fixed-minimap-btn">${s.fixedMinimap ? t('settings.on') : t('settings.off')}</button>
      </div>
      ${sliderRowHTML({
        rowClass: ROW_CLASS, labelClass: 'camera-sensitivity-label', sliderClass: 'camera-sensitivity-slider',
        labelText: t('settings.camera_sensitivity', { percent: Math.round((s.cameraSensitivity ?? DEFAULT_CAMERA_SENSITIVITY_PERCENT / 100) * 100) }),
        min: CAMERA_SENSITIVITY_MIN_PERCENT, max: CAMERA_SENSITIVITY_MAX_PERCENT, step: 1,
        value: Math.round((s.cameraSensitivity ?? DEFAULT_CAMERA_SENSITIVITY_PERCENT / 100) * 100),
      })}
      ${sliderRowHTML({
        rowClass: ROW_CLASS, labelClass: 'walk-speed-label', sliderClass: 'walk-speed-slider',
        labelText: t('settings.walk_speed', { percent: Math.round((s.walkSpeed ?? DEFAULT_WALK_SPEED_PERCENT / 100) * 100) }),
        min: WALK_SPEED_MIN_PERCENT, max: WALK_SPEED_MAX_PERCENT, step: 1,
        value: Math.round((s.walkSpeed ?? DEFAULT_WALK_SPEED_PERCENT / 100) * 100),
      })}
      ${sliderRowHTML({
        rowClass: ROW_CLASS, labelClass: 'camera-fov-label', sliderClass: 'camera-fov-slider',
        labelText: t('settings.camera_fov', { percent: Math.round(s.cameraZoom ?? DEFAULT_CAMERA_ZOOM_PERCENT) }),
        min: CAMERA_ZOOM_MIN_PERCENT, max: CAMERA_ZOOM_MAX_PERCENT, step: 1,
        value: Math.round(s.cameraZoom ?? DEFAULT_CAMERA_ZOOM_PERCENT), disabled: !!s.autoFOV,
      })}
      <div class="settings-row">
        <span>${t('settings.auto_fov')}</span>
        <button class="auto-fov-btn">${(s.autoFOV ?? DEFAULT_AUTO_FOV) ? t('settings.on') : t('settings.off')}</button>
      </div>
      ${this.cameraPanel.html(s, ROW_CLASS)}`;

    bindSliderRow(this.body, {
      sliderClass: 'brightness-slider', labelClass: 'brightness-label', onSave: save,
      onInput: (v) => {
        s.brightness = clamp(v / 100, BRIGHTNESS_MIN_PERCENT / 100, BRIGHTNESS_MAX_PERCENT / 100);
        this.app.applyBrightness();
        return t('settings.brightness', { percent: Math.round(s.brightness * 100) });
      },
    });
    bindSliderRow(this.body, {
      sliderClass: 'gamespeed-slider', labelClass: 'gamespeed-label', onSave: save,
      onInput: (v) => {
        s.gameSpeed = clamp(v, GAME_SPEED_MIN, GAME_SPEED_MAX);
        return t('settings.game_speed', { mult: s.gameSpeed });
      },
    });
    bindSliderRow(this.body, {
      sliderClass: 'damage-number-duration-slider', labelClass: 'damage-number-duration-label', onSave: save,
      onInput: (v) => {
        s.damageNumberDuration = clamp(v, DAMAGE_NUMBER_DURATION_MIN, DAMAGE_NUMBER_DURATION_MAX);
        return t('settings.damage_number_duration', { mult: s.damageNumberDuration.toFixed(1) });
      },
    });
    bindSliderRow(this.body, {
      sliderClass: 'damage-number-size-slider', labelClass: 'damage-number-size-label', onSave: save,
      onInput: (v) => {
        s.damageNumberSize = clamp(v, DAMAGE_NUMBER_SIZE_MIN, DAMAGE_NUMBER_SIZE_MAX);
        return t('settings.damage_number_size', { mult: s.damageNumberSize.toFixed(1) });
      },
    });
    this.body.querySelector('.fps-select').addEventListener('change', (e) => {
      this.app.setFPS(Number(e.target.value));
      save();
    });
    this.body.querySelector('.language-select').addEventListener('change', (e) => {
      this.app.setLanguage(e.target.value);
      save();
      this.enter(this.root); // full re-render — every label on this screen needs the new language
    });
    this.body.querySelector('.sound-btn').addEventListener('click', () => { s.sound = !s.sound; save(); this.renderAll(); });
    this.body.querySelector('.fixed-minimap-btn').addEventListener('click', () => {
      s.fixedMinimap = !s.fixedMinimap;
      save();
      this.renderAll();
    });
    bindSliderRow(this.body, {
      sliderClass: 'camera-sensitivity-slider', labelClass: 'camera-sensitivity-label', onSave: save,
      onInput: (v) => {
        s.cameraSensitivity = clamp(v / 100, CAMERA_SENSITIVITY_MIN_PERCENT / 100, CAMERA_SENSITIVITY_MAX_PERCENT / 100);
        return t('settings.camera_sensitivity', { percent: Math.round(s.cameraSensitivity * 100) });
      },
    });
    bindSliderRow(this.body, {
      sliderClass: 'walk-speed-slider', labelClass: 'walk-speed-label', onSave: save,
      onInput: (v) => {
        s.walkSpeed = clamp(v / 100, WALK_SPEED_MIN_PERCENT / 100, WALK_SPEED_MAX_PERCENT / 100);
        return t('settings.walk_speed', { percent: Math.round(s.walkSpeed * 100) });
      },
    });
    bindSliderRow(this.body, {
      sliderClass: 'camera-fov-slider', labelClass: 'camera-fov-label', onSave: save,
      onInput: (v) => {
        s.cameraZoom = clamp(v, CAMERA_ZOOM_MIN_PERCENT, CAMERA_ZOOM_MAX_PERCENT);
        return t('settings.camera_fov', { percent: Math.round(s.cameraZoom) });
      },
    });
    this.body.querySelector('.auto-fov-btn').addEventListener('click', () => {
      s.autoFOV = !(s.autoFOV ?? DEFAULT_AUTO_FOV);
      applyAutoFov(s); // snaps the FOV slider into alignment immediately when turning on
      save();
      this.renderAll();
    });
    this.cameraPanel.bind(this.body, s, { save, rerender: () => this.renderAll() });
  }
}
