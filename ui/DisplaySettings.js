/**
 * Shared MIN/MAX/DEFAULT constants for the four simple sliders that didn't
 * already have their own settings module — mirrors the existing
 * ui/CameraSettings.js / ui/WalkSpeedSettings.js pattern. Both
 * SettingsState and PauseOverlay import these instead of independently
 * hardcoding the same literals in their own templates and clamp calls.
 */
export const BRIGHTNESS_MIN_PERCENT = 30;
export const BRIGHTNESS_MAX_PERCENT = 150;
export const DEFAULT_BRIGHTNESS_PERCENT = 100;

export const GAME_SPEED_MIN = 1;
export const GAME_SPEED_MAX = 5;
export const DEFAULT_GAME_SPEED = 2;

export const DAMAGE_NUMBER_DURATION_MIN = 1;
export const DAMAGE_NUMBER_DURATION_MAX = 10;
export const DAMAGE_NUMBER_DURATION_STEP = 0.5;
export const DEFAULT_DAMAGE_NUMBER_DURATION = 1;

export const DAMAGE_NUMBER_SIZE_MIN = 1;
export const DAMAGE_NUMBER_SIZE_MAX = 3;
export const DAMAGE_NUMBER_SIZE_STEP = 0.1;
export const DEFAULT_DAMAGE_NUMBER_SIZE = 1;
