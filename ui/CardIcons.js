/** Inline SVG icons for card categories — no icon assets/library in this repo, so these are hand-drawn minimal glyphs. */

export function swordIconSVG() {
  return `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
    <line x1="14.5" y1="3" x2="21" y2="9.5"></line>
    <line x1="3" y1="21" x2="13" y2="11"></line>
    <path d="M13 11 L17 7 L21 9.5 L14.5 3 L11 7 Z"></path>
    <line x1="8" y1="16" x2="11" y2="19"></line>
  </svg>`;
}

export function shieldIconSVG() {
  return `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
    <path d="M12 2.5 L20 6 V11.5 C20 16.5 16.5 20 12 21.5 C7.5 20 4 16.5 4 11.5 V6 Z"></path>
  </svg>`;
}

export function shoeIconSVG() {
  return `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
    <path d="M3 17 V12.5 C3 11 4 9.5 5.5 9 L9 8 L14 5 C15 4.4 16.3 4.6 17 5.5 L18.5 7.5 C19.7 8 21 9.3 21 11 V17 Z"></path>
    <line x1="3" y1="17" x2="21" y2="17"></line>
    <line x1="9" y1="8" x2="9" y2="12"></line>
  </svg>`;
}

export function categoryIconSVG(category) {
  if (category === 'attack') return swordIconSVG();
  if (category === 'sustain') return shieldIconSVG();
  if (category === 'util') return shoeIconSVG();
  return '';
}
