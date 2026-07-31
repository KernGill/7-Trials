/**
 * Generic markup + binding for a settings slider row — factored out of
 * SettingsState.js/PauseOverlay.js, which each independently implemented
 * the same label+range-input template and change(save)/input(clamp+write+
 * relabel) listener pair for every simple slider (brightness, game speed,
 * damage number duration/size, camera sensitivity, walk speed, camera
 * FOV). Two-phase, matching this codebase's existing "template string then
 * bind" convention elsewhere (e.g. bindStatusIcons, bindCameraEvents):
 * `sliderRowHTML` returns markup to interpolate into a caller's larger
 * template string; `bindSliderRow` wires listeners against the resulting
 * DOM afterward.
 *
 * The Camera Orientation slider (plus its Fine Tune sub-panel) is NOT
 * built on this helper — one of its inputs writes two settings fields and
 * drives a multi-widget resync, genuinely different from every other
 * slider here. See ui/CameraOrientationPanel.js instead.
 */

/** Markup for one slider row — a label span + range input, no wrapping beyond `rowClass`'s own element. */
export function sliderRowHTML({ rowClass, labelClass, sliderClass, labelText, min, max, step, value, disabled = false }) {
  return `
    <div class="${rowClass}">
      <span class="${labelClass}">${labelText}</span>
      <input type="range" min="${min}" max="${max}"${step !== undefined ? ` step="${step}"` : ''} value="${value}" class="${sliderClass}"${disabled ? ' disabled' : ''}>
    </div>`;
}

/**
 * Wires the generic `change`(save)/`input`(recompute+relabel) pair onto an
 * already-rendered slider row. `onInput(rawValue)` receives the slider's
 * raw `Number(e.target.value)` — unclamped, in whatever units the slider
 * itself displays — and must return the new label text; it's responsible
 * for its own clamping and for writing the result onto `gameState.settings`
 * (bounds vary per-slider, and a couple of callers store a different unit
 * than what's shown, e.g. camera sensitivity/walk speed show a percent but
 * store a fraction — trying to bake that into this helper would be more
 * complex than just letting each call site do it).
 */
export function bindSliderRow(container, { sliderClass, labelClass, onInput, onSave }) {
  const slider = container.querySelector(`.${sliderClass}`);
  const label = container.querySelector(`.${labelClass}`);
  slider.addEventListener('change', onSave);
  slider.addEventListener('input', (e) => {
    label.textContent = onInput(Number(e.target.value));
  });
}
