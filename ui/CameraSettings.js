/**
 * Shared constants/formula for the exploration camera's Angle/Height
 * settings — used by both SettingsState and PauseOverlay so the "Camera
 * Orientation" combined slider and its Fine Tune sub-sliders stay in
 * exact agreement between the two screens.
 */
export const CAMERA_ANGLE_MIN = 0;
export const CAMERA_ANGLE_MAX = 90;
export const CAMERA_HEIGHT_MIN_PERCENT = 33;
export const CAMERA_HEIGHT_MAX_PERCENT = 150;

// The combined "Camera Orientation" slider drags angle and height together
// along a fixed correspondence (per user request: 0deg/80% at the low end,
// 90deg/135% at the high end) — independently adjusting the two used to
// produce combinations ("improper effects") that don't look right; this
// keeps the simple slider always on a sensible path through that space.
export const LINKED_HEIGHT_MIN_PERCENT = 80;
export const LINKED_HEIGHT_MAX_PERCENT = 135;

/** The linked height percent for a given angle, per the fixed 0/80 - 90/135 correspondence. */
export function linkedHeightPercentForAngle(angleDeg) {
  return LINKED_HEIGHT_MIN_PERCENT
    + (angleDeg / CAMERA_ANGLE_MAX) * (LINKED_HEIGHT_MAX_PERCENT - LINKED_HEIGHT_MIN_PERCENT);
}

export const DEFAULT_CAMERA_ANGLE = 28;
// Derived from linkedHeightPercentForAngle(28) (~97.1%, displayed as 28/97) so the
// default stays exactly on the combined slider's correspondence line.
export const DEFAULT_CAMERA_HEIGHT = linkedHeightPercentForAngle(DEFAULT_CAMERA_ANGLE) / 100;

// Mouse-look Camera Sensitivity: a 0-200% multiplier on the free-look
// camera's base mouse sensitivity (see MOUSE_YAW_SENSITIVITY/
// MOUSE_PITCH_SENSITIVITY in DungeonRenderer3D.js, which already reflect
// the doubled baseline) — 100% is the exact midpoint of this range, so
// a fresh save starts right on that doubled baseline with room to go
// lower or higher.
export const CAMERA_SENSITIVITY_MIN_PERCENT = 0;
export const CAMERA_SENSITIVITY_MAX_PERCENT = 200;
export const DEFAULT_CAMERA_SENSITIVITY_PERCENT = 100;
