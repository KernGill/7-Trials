import { clamp } from '../utils/MathUtils.js';
import { t } from './i18n.js';
import {
  CAMERA_ANGLE_MIN, CAMERA_ANGLE_MAX, CAMERA_HEIGHT_MIN_PERCENT, CAMERA_HEIGHT_MAX_PERCENT,
  DEFAULT_CAMERA_ANGLE, DEFAULT_CAMERA_HEIGHT, linkedHeightPercentForAngle,
  DEFAULT_CAMERA_ZOOM_PERCENT, autoFovPercentForAngle,
} from './CameraSettings.js';

/**
 * If Auto FOV is on, derives cameraZoom from the current cameraAngle —
 * called anywhere cameraAngle changes (either camera slider, or Reset to
 * Default) and when Auto FOV is toggled on, so the FOV slider always lands
 * back in sync with orientation. Exported standalone (not a
 * CameraOrientationPanel method) since SettingsState/PauseOverlay's own
 * FOV-slider rendering and the Auto FOV toggle button both call it
 * directly too, not just this panel.
 */
export function applyAutoFov(s) {
  if (!s.autoFOV) return;
  s.cameraZoom = autoFovPercentForAngle(s.cameraAngle ?? DEFAULT_CAMERA_ANGLE);
}

/**
 * The Camera Orientation slider + its Fine Tune sub-panel — extracted as
 * one shared unit (not folded into the generic SliderRow helper, see that
 * file) since one of its inputs writes TWO settings fields (cameraAngle
 * derives cameraHeight) and drives a multi-widget resync, genuinely
 * different from every other slider. Was previously copy-pasted
 * byte-for-byte between SettingsState.js and PauseOverlay.js.
 * `fineTuneOpen` is owned by the panel instance itself (component-local UI
 * state, not a settings field) — each caller constructs its own instance.
 */
export class CameraOrientationPanel {
  constructor() {
    this.fineTuneOpen = false;
  }

  /** `rowClass` is the caller's own row wrapper class ('settings-row' or 'pause-row'). */
  html(s, rowClass) {
    const angle = Math.round(s.cameraAngle ?? DEFAULT_CAMERA_ANGLE);
    const linkedHeight = Math.round(linkedHeightPercentForAngle(angle));
    const height = Math.round((s.cameraHeight ?? DEFAULT_CAMERA_HEIGHT) * 100);
    return `
      <div class="${rowClass}">
        <span class="camera-combined-label">${t('settings.camera_orientation', { angle, height: linkedHeight })}</span>
        <input type="range" min="${CAMERA_ANGLE_MIN}" max="${CAMERA_ANGLE_MAX}" step="1" value="${angle}" class="camera-combined-slider">
        <button class="fine-tune-btn">${t('settings.fine_tune')}</button>
      </div>
      ${this.fineTuneOpen ? `
        <div class="${rowClass} fine-tune-row">
          <span class="camera-angle-label">${t('settings.camera_angle', { deg: angle })}</span>
          <input type="range" min="${CAMERA_ANGLE_MIN}" max="${CAMERA_ANGLE_MAX}" step="1" value="${angle}" class="camera-angle-slider">
        </div>
        <div class="${rowClass} fine-tune-row">
          <span class="camera-height-label">${t('settings.camera_height', { percent: height })}</span>
          <input type="range" min="${CAMERA_HEIGHT_MIN_PERCENT}" max="${CAMERA_HEIGHT_MAX_PERCENT}" step="1" value="${height}" class="camera-height-slider">
        </div>
        <div class="${rowClass} fine-tune-row">
          <button class="camera-reset-btn">${t('settings.reset_default')}</button>
        </div>
      ` : ''}`;
  }

  /** Keeps the combined slider's label and (if open) the fine-tune sub-sliders' thumbs/labels all in sync, without a full re-render. Also re-syncs the FOV slider whenever Auto FOV is on, since angle changes drive it too — `container` must already have `.camera-fov-label`/`.camera-fov-slider` rendered (both callers always render the FOV slider alongside this panel). */
  syncDisplays(container, s) {
    const angle = Math.round(s.cameraAngle ?? DEFAULT_CAMERA_ANGLE);
    const linkedHeight = Math.round(linkedHeightPercentForAngle(angle));
    const height = Math.round((s.cameraHeight ?? DEFAULT_CAMERA_HEIGHT) * 100);
    container.querySelector('.camera-combined-label').textContent = t('settings.camera_orientation', { angle, height: linkedHeight });
    container.querySelector('.camera-combined-slider').value = angle;
    applyAutoFov(s);
    container.querySelector('.camera-fov-label').textContent = t('settings.camera_fov', { percent: Math.round(s.cameraZoom ?? DEFAULT_CAMERA_ZOOM_PERCENT) });
    container.querySelector('.camera-fov-slider').value = Math.round(s.cameraZoom ?? DEFAULT_CAMERA_ZOOM_PERCENT);
    if (!this.fineTuneOpen) return;
    container.querySelector('.camera-angle-label').textContent = t('settings.camera_angle', { deg: angle });
    container.querySelector('.camera-angle-slider').value = angle;
    container.querySelector('.camera-height-label').textContent = t('settings.camera_height', { percent: height });
    container.querySelector('.camera-height-slider').value = height;
  }

  /** `save()` persists; `rerender()` triggers the caller's own full-screen re-render (needed when Fine Tune toggles or Reset is pressed, since those change what's rendered, not just a label). */
  bind(container, s, { save, rerender }) {
    container.querySelector('.camera-combined-slider').addEventListener('change', save);
    container.querySelector('.camera-combined-slider').addEventListener('input', (e) => {
      s.cameraAngle = clamp(Number(e.target.value), CAMERA_ANGLE_MIN, CAMERA_ANGLE_MAX);
      s.cameraHeight = linkedHeightPercentForAngle(s.cameraAngle) / 100;
      this.syncDisplays(container, s);
    });
    container.querySelector('.fine-tune-btn').addEventListener('click', () => {
      this.fineTuneOpen = !this.fineTuneOpen;
      rerender();
    });
    if (!this.fineTuneOpen) return;
    container.querySelector('.camera-angle-slider').addEventListener('change', save);
    container.querySelector('.camera-angle-slider').addEventListener('input', (e) => {
      s.cameraAngle = clamp(Number(e.target.value), CAMERA_ANGLE_MIN, CAMERA_ANGLE_MAX);
      this.syncDisplays(container, s);
    });
    container.querySelector('.camera-height-slider').addEventListener('change', save);
    container.querySelector('.camera-height-slider').addEventListener('input', (e) => {
      s.cameraHeight = clamp(Number(e.target.value) / 100, CAMERA_HEIGHT_MIN_PERCENT / 100, CAMERA_HEIGHT_MAX_PERCENT / 100);
      this.syncDisplays(container, s);
    });
    container.querySelector('.camera-reset-btn').addEventListener('click', () => {
      s.cameraAngle = DEFAULT_CAMERA_ANGLE;
      s.cameraHeight = DEFAULT_CAMERA_HEIGHT;
      save();
      rerender();
    });
  }
}
