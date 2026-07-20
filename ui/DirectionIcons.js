/** Inline SVG directional arrows for the QTE key strip — bold triangle, matches WASD/Arrow-key inputs. */

const ROTATION = { up: 0, right: 90, down: 180, left: 270 };

export function arrowIconSVG(direction) {
  const rotation = ROTATION[direction] ?? 0;
  return `<svg viewBox="0 0 24 24" width="32" height="32" style="transform:rotate(${rotation}deg)">
    <path d="M12 3 L21 15 L15 15 L15 21 L9 21 L9 15 L3 15 Z" fill="#ffffff"></path>
  </svg>`;
}
