import { GAME_STATES, ITEM_STATES } from '../utils/Constants.js';
import { getMaterialConfig } from '../data/items.js';
import { getConsumableConfig } from '../data/consumables.js';

function formatPrice(price) {
  if (!price) return '';
  const parts = [];
  if (price.gold) parts.push(`${price.gold}g`);
  Object.entries(price.materials ?? {}).forEach(([id, amt]) => {
    parts.push(`${amt} ${getMaterialConfig(id)?.name ?? id}`);
  });
  Object.entries(price.consumables ?? {}).forEach(([id, amt]) => {
    parts.push(`${amt} ${getConsumableConfig(id)?.name ?? id}`);
  });
  return parts.join(', ');
}

export class ShopState {
  constructor(app) { this.app = app; }

  enter(root) {
    this.root = root;
    root.innerHTML = `
      <div class="shop-screen">
        <button class="back-btn">RETURN HOME</button>
        <h1>SHOP</h1>
        <div class="shop-gold"></div>
        <div class="shop-list"></div>
        <div class="flash-message"></div>
      </div>`;
    root.querySelector('.back-btn').addEventListener('click', () => this.app.setState(GAME_STATES.HOME));
    this.els = {
      gold: root.querySelector('.shop-gold'),
      list: root.querySelector('.shop-list'),
      flash: root.querySelector('.flash-message'),
    };
    this.renderAll();
  }

  exit() {
    clearTimeout(this.flashTimeout);
  }

  /** Prioritizes gold over materials — canBuy() already checks gold first and short-circuits, so the reason string tells us which one to flash. */
  flashBuyFailure(reason) {
    const text = reason === 'Not enough gold.' ? 'NOT ENOUGH GOLD'
      : reason === 'Not enough materials.' ? 'NOT ENOUGH MATERIALS'
      : null;
    if (!text || !this.els.flash) return;
    clearTimeout(this.flashTimeout);
    this.els.flash.textContent = text;
    this.els.flash.classList.add('visible');
    this.flashTimeout = setTimeout(() => this.els.flash.classList.remove('visible'), 2000);
  }

  renderAll() {
    const { app } = this;
    this.els.gold.textContent = `Gold: ${app.gameState.player.gold}`;
    const listings = app.shop.getListings();
    this.els.list.innerHTML = listings.map((l) => {
      const label = l.state === ITEM_STATES.LOCKED ? 'LOCKED' : formatPrice(l.price);
      const ownedTag = l.type === 'item' ? `<div class="shop-owned">Owned: ${l.ownedCount}</div>` : '';
      return `
        <div class="shop-row">
          <div class="shop-item-name">${l.name}</div>
          <div class="shop-item-flavour">${l.flavour ?? ''}</div>
          ${ownedTag}
          <button class="shop-buy-btn" data-id="${l.id}" ${l.state === ITEM_STATES.LOCKED ? 'disabled' : ''}>${label}</button>
        </div>`;
    }).join('');
    this.els.list.querySelectorAll('[data-id]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const result = app.shop.buy(btn.dataset.id);
        app.gameState.addLog(result.ok ? 'Purchased.' : result.reason);
        if (result.ok) app.saveSystem.save();
        else this.flashBuyFailure(result.reason);
        this.renderAll();
      });
    });
  }
}
