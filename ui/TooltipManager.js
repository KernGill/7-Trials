/**
 * TooltipManager — a single hover-tooltip <div> appended to <body>,
 * repositioned to follow the cursor near whatever element it's bound
 * to. Each screen that wants hover cards owns one instance (create in
 * enter(), destroy() in exit()) so nothing leaks across re-entries.
 */
export class TooltipManager {
  constructor() {
    this.el = document.createElement('div');
    this.el.className = 'hover-tooltip hidden';
    document.body.appendChild(this.el);
  }

  show(html, x, y) {
    this.el.innerHTML = html;
    this.el.classList.remove('hidden');
    this.reposition(x, y);
  }

  reposition(x, y) {
    const pad = 16;
    this.el.style.left = '0px';
    this.el.style.top = '0px';
    const rect = this.el.getBoundingClientRect();
    let left = x + pad;
    let top = y + pad;
    if (left + rect.width > window.innerWidth) left = x - rect.width - pad;
    if (top + rect.height > window.innerHeight) top = y - rect.height - pad;
    this.el.style.left = `${Math.max(4, left)}px`;
    this.el.style.top = `${Math.max(4, top)}px`;
  }

  hide() {
    this.el.classList.add('hidden');
  }

  /**
   * Wires hover show/hide of `contentFn()`'s HTML onto `el`. contentFn
   * is called fresh on every mouseenter so it can reflect current state;
   * returning a falsy value skips showing the tooltip entirely.
   */
  bind(el, contentFn) {
    el.addEventListener('mouseenter', (e) => {
      const html = contentFn();
      if (html) this.show(html, e.clientX, e.clientY);
    });
    el.addEventListener('mousemove', (e) => {
      if (!this.el.classList.contains('hidden')) this.reposition(e.clientX, e.clientY);
    });
    el.addEventListener('mouseleave', () => this.hide());
  }

  destroy() {
    this.el.remove();
  }
}
