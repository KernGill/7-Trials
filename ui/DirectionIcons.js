/** Inline SVG directional arrows for the QTE key strip — bold triangle, matches WASD/Arrow-key inputs. */

const ROTATION = { up: 0, right: 90, down: 180, left: 270 };

export function arrowIconSVG(direction) {
  const rotation = ROTATION[direction] ?? 0;
  return `<svg viewBox="0 0 24 24" width="32" height="32" style="transform:rotate(${rotation}deg)">
    <path d="M12 3 L21 15 L15 15 L15 21 L9 21 L9 15 L3 15 Z" fill="#ffffff"></path>
  </svg>`;
}

/** Filled target/circle glyph — Hold QTE's "press and hold" affordance. */
export function holdIconSVG() {
  return `<svg viewBox="0 0 24 24" width="32" height="32">
    <circle cx="12" cy="12" r="9" fill="none" stroke="#ffffff" stroke-width="2"></circle>
    <circle cx="12" cy="12" r="4" fill="#ffffff"></circle>
  </svg>`;
}

/** Overlapping chevrons — Mash QTE's "rapid repeat-press" affordance. */
export function mashIconSVG() {
  return `<svg viewBox="0 0 24 24" width="32" height="32">
    <path d="M6 4 L12 10 L18 4" fill="none" stroke="#ffffff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"></path>
    <path d="M6 13 L12 19 L18 13" fill="none" stroke="#ffffff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"></path>
  </svg>`;
}

/** Padlock glyph — Combo QTE's "arrow pressed but not broken free yet" state (see ExploreState's lockComboArrow). */
export function lockIconSVG() {
  return `<svg viewBox="0 0 24 24" width="28" height="28">
    <rect x="5" y="11" width="14" height="10" rx="2" fill="none" stroke="#8ec9ff" stroke-width="2"></rect>
    <path d="M8 11 V7 a4 4 0 0 1 8 0 V11" fill="none" stroke="#8ec9ff" stroke-width="2"></path>
    <circle cx="12" cy="16" r="1.6" fill="#8ec9ff"></circle>
  </svg>`;
}
