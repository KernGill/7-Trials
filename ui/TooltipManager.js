export class TooltipManager {
  constructor(rootElement) {
    this.root = rootElement;
    this.tooltip = document.createElement('div');
    this.tooltip.className = 'tooltip hidden';
    this.root.appendChild(this.tooltip);
  }

  show(html, x, y) {
    this.tooltip.innerHTML = html;
    this.tooltip.classList.remove('hidden');
    this.tooltip.style.left = `${x + 12}px`;
    this.tooltip.style.top = `${y + 12}px`;
  }

  hide() {
    this.tooltip.classList.add('hidden');
  }
}
