/**
 * Shared constants for the exploration "Walk Speed" setting — used by
 * GameState (default value), SettingsState and PauseOverlay (the slider
 * itself), and ExploreState (turning the stored percent into the actual
 * per-frame movement multiplier), so all four stay in exact agreement.
 * Per user request: 15% - 300%, with today's speed as the 100% midpoint
 * of neither end — a plain linear percent-of-baseline multiplier, no
 * piecewise mapping needed (unlike CameraSettings.js's zoom/FOV curves).
 */
export const WALK_SPEED_MIN_PERCENT = 15;
export const WALK_SPEED_MAX_PERCENT = 300;
export const DEFAULT_WALK_SPEED_PERCENT = 100;
