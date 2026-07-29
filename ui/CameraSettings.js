/**
 * Shared constants/formula for the exploration camera's Angle/Height
 * settings — used by both SettingsState and PauseOverlay so the "Camera
 * Orientation" combined slider and its Fine Tune sub-sliders stay in
 * exact agreement between the two screens.
 */
function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

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

// FOV (exploration camera zoom): a 0-100% slider that also live-updates via
// scroll wheel / I (zoom in) / O (zoom out) while exploring — see
// ExploreState's wheel listener and handleKeydown. Since the dungeon camera
// is orthographic, "zoom" here means shrinking/growing the visible world-unit
// span of its frustum (see zoomMultiplierForPercent below and its use in
// DungeonRenderer3D), not moving the camera closer/farther (which would do
// nothing to an orthographic projection's apparent scale).
export const CAMERA_ZOOM_MIN_PERCENT = 0;
export const CAMERA_ZOOM_MAX_PERCENT = 100;
// Per user request: today's default view sits at 40% up the slider, not at
// either end, so there's room to zoom in tighter as well as further out.
export const DEFAULT_CAMERA_ZOOM_PERCENT = 40;
// The view-span multiplier at each anchor point of the slider (applied to
// DungeonRenderer3D's base VIEW_HEIGHT): 40% is a 1x multiplier (exactly
// today's view, unchanged), 100% is 3x (per user request: "3 times more
// than I currently do"). 0% has no literal "first person" camera rig to
// reuse — this ortho rig's zoom is purely a frustum-size change — so the
// closest approximation is the tightest zoom the frustum math still
// renders sensibly at, picked small enough to read as being right up in
// whatever's in front of the player.
const ZOOM_MULT_AT_DEFAULT = 1;
const ZOOM_MULT_AT_MAX = 3;
const ZOOM_MULT_AT_MIN = 0.12;

/** Piecewise-linear: 0% -> ZOOM_MULT_AT_MIN, 40% (DEFAULT_CAMERA_ZOOM_PERCENT) -> 1, 100% -> 3. Two segments (not one straight line) since a single slope can't hit all three anchor points without going negative below 40%. */
export function zoomMultiplierForPercent(percent) {
  const p = clamp(percent, CAMERA_ZOOM_MIN_PERCENT, CAMERA_ZOOM_MAX_PERCENT);
  if (p <= DEFAULT_CAMERA_ZOOM_PERCENT) {
    const t = p / DEFAULT_CAMERA_ZOOM_PERCENT;
    return ZOOM_MULT_AT_MIN + t * (ZOOM_MULT_AT_DEFAULT - ZOOM_MULT_AT_MIN);
  }
  const t = (p - DEFAULT_CAMERA_ZOOM_PERCENT) / (CAMERA_ZOOM_MAX_PERCENT - DEFAULT_CAMERA_ZOOM_PERCENT);
  return ZOOM_MULT_AT_DEFAULT + t * (ZOOM_MULT_AT_MAX - ZOOM_MULT_AT_DEFAULT);
}

// Fixed step nudged per scroll-wheel tick / I or O keypress (ExploreState).
export const CAMERA_ZOOM_STEP_PERCENT = 4;
