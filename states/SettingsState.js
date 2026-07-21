import { GAME_STATES } from '../utils/Constants.js';
import { clamp } from '../utils/MathUtils.js';
import { t } from '../ui/i18n.js';
import {
  CAMERA_ANGLE_MIN, CAMERA_ANGLE_MAX, CAMERA_HEIGHT_MIN_PERCENT, CAMERA_HEIGHT_MAX_PERCENT,
  DEFAULT_CAMERA_ANGLE, DEFAULT_CAMERA_HEIGHT, linkedHeightPercentForAngle,
} from '../ui/CameraSettings.js';

const FPS_OPTIONS = [30, 60, 90, 120, 144];
const LANGUAGE_OPTIONS = ['en', 'es'];

export class SettingsState {
  constructor(app) {
    this.app = app;
    this.fineTuneOpen = false;
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

  cameraSectionHTML(s) {
    const angle = Math.round(s.cameraAngle ?? DEFAULT_CAMERA_ANGLE);
    const linkedHeight = Math.round(linkedHeightPercentForAngle(angle));
    const height = Math.round((s.cameraHeight ?? DEFAULT_CAMERA_HEIGHT) * 100);
    return `
      <div class="settings-row">
        <span class="camera-combined-label">${t('settings.camera_orientation', { angle, height: linkedHeight })}</span>
        <input type="range" min="${CAMERA_ANGLE_MIN}" max="${CAMERA_ANGLE_MAX}" step="1" value="${angle}" class="camera-combined-slider">
        <button class="fine-tune-btn">${t('settings.fine_tune')}</button>
      </div>
      ${this.fineTuneOpen ? `
        <div class="settings-row fine-tune-row">
          <span class="camera-angle-label">${t('settings.camera_angle', { deg: angle })}</span>
          <input type="range" min="${CAMERA_ANGLE_MIN}" max="${CAMERA_ANGLE_MAX}" step="1" value="${angle}" class="camera-angle-slider">
        </div>
        <div class="settings-row fine-tune-row">
          <span class="camera-height-label">${t('settings.camera_height', { percent: height })}</span>
          <input type="range" min="${CAMERA_HEIGHT_MIN_PERCENT}" max="${CAMERA_HEIGHT_MAX_PERCENT}" step="1" value="${height}" class="camera-height-slider">
        </div>
        <div class="settings-row fine-tune-row">
          <button class="camera-reset-btn">${t('settings.reset_default')}</button>
        </div>
      ` : ''}`;
  }

  /** Keeps the combined slider's label and (if open) the fine-tune sub-sliders' thumbs/labels all in sync, without a full re-render — mirrors the lightweight label-only updates the other sliders here already use. */
  syncCameraDisplays(s) {
    const angle = Math.round(s.cameraAngle ?? DEFAULT_CAMERA_ANGLE);
    const linkedHeight = Math.round(linkedHeightPercentForAngle(angle));
    const height = Math.round((s.cameraHeight ?? DEFAULT_CAMERA_HEIGHT) * 100);
    this.body.querySelector('.camera-combined-label').textContent = t('settings.camera_orientation', { angle, height: linkedHeight });
    this.body.querySelector('.camera-combined-slider').value = angle;
    if (!this.fineTuneOpen) return;
    this.body.querySelector('.camera-angle-label').textContent = t('settings.camera_angle', { deg: angle });
    this.body.querySelector('.camera-angle-slider').value = angle;
    this.body.querySelector('.camera-height-label').textContent = t('settings.camera_height', { percent: height });
    this.body.querySelector('.camera-height-slider').value = height;
  }

  bindCameraEvents(s) {
    this.body.querySelector('.camera-combined-slider').addEventListener('change', () => this.app.saveSystem.save());
    this.body.querySelector('.camera-combined-slider').addEventListener('input', (e) => {
      s.cameraAngle = clamp(Number(e.target.value), CAMERA_ANGLE_MIN, CAMERA_ANGLE_MAX);
      s.cameraHeight = linkedHeightPercentForAngle(s.cameraAngle) / 100;
      this.syncCameraDisplays(s);
    });
    this.body.querySelector('.fine-tune-btn').addEventListener('click', () => {
      this.fineTuneOpen = !this.fineTuneOpen;
      this.renderAll();
    });
    if (!this.fineTuneOpen) return;
    this.body.querySelector('.camera-angle-slider').addEventListener('change', () => this.app.saveSystem.save());
    this.body.querySelector('.camera-angle-slider').addEventListener('input', (e) => {
      s.cameraAngle = clamp(Number(e.target.value), CAMERA_ANGLE_MIN, CAMERA_ANGLE_MAX);
      this.syncCameraDisplays(s);
    });
    this.body.querySelector('.camera-height-slider').addEventListener('change', () => this.app.saveSystem.save());
    this.body.querySelector('.camera-height-slider').addEventListener('input', (e) => {
      s.cameraHeight = clamp(Number(e.target.value) / 100, CAMERA_HEIGHT_MIN_PERCENT / 100, CAMERA_HEIGHT_MAX_PERCENT / 100);
      this.syncCameraDisplays(s);
    });
    this.body.querySelector('.camera-reset-btn').addEventListener('click', () => {
      s.cameraAngle = DEFAULT_CAMERA_ANGLE;
      s.cameraHeight = DEFAULT_CAMERA_HEIGHT;
      this.app.saveSystem.save();
      this.renderAll();
    });
  }

  renderAll() {
    const s = this.app.gameState.settings;
    this.body.innerHTML = `
      <div class="settings-row">
        <span class="brightness-label">${t('settings.brightness', { percent: Math.round(s.brightness * 100) })}</span>
        <input type="range" min="30" max="150" value="${Math.round(s.brightness * 100)}" class="brightness-slider">
      </div>
      <div class="settings-row">
        <span class="gamespeed-label">${t('settings.game_speed', { mult: s.gameSpeed ?? 2 })}</span>
        <input type="range" min="1" max="5" step="1" value="${s.gameSpeed ?? 2}" class="gamespeed-slider">
      </div>
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
      ${this.cameraSectionHTML(s)}`;
    this.body.querySelector('.brightness-slider').addEventListener('change', () => this.app.saveSystem.save());
    this.body.querySelector('.brightness-slider').addEventListener('input', (e) => {
      s.brightness = clamp(Number(e.target.value) / 100, 0.3, 1.5);
      this.app.applyBrightness();
      this.body.querySelector('.brightness-label').textContent = t('settings.brightness', { percent: Math.round(s.brightness * 100) });
    });
    this.body.querySelector('.gamespeed-slider').addEventListener('change', () => this.app.saveSystem.save());
    this.body.querySelector('.gamespeed-slider').addEventListener('input', (e) => {
      s.gameSpeed = clamp(Number(e.target.value), 1, 5);
      this.body.querySelector('.gamespeed-label').textContent = t('settings.game_speed', { mult: s.gameSpeed });
    });
    this.body.querySelector('.fps-select').addEventListener('change', (e) => {
      this.app.setFPS(Number(e.target.value));
      this.app.saveSystem.save();
    });
    this.body.querySelector('.language-select').addEventListener('change', (e) => {
      this.app.setLanguage(e.target.value);
      this.app.saveSystem.save();
      this.enter(this.root); // full re-render — every label on this screen needs the new language
    });
    this.body.querySelector('.sound-btn').addEventListener('click', () => { s.sound = !s.sound; this.app.saveSystem.save(); this.renderAll(); });
    this.body.querySelector('.fixed-minimap-btn').addEventListener('click', () => {
      s.fixedMinimap = !s.fixedMinimap;
      this.app.saveSystem.save();
      this.renderAll();
    });
    this.bindCameraEvents(s);
  }
}
