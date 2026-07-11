import { GAME_STATES, ITEM_STATES } from '../utils/Constants.js';

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
      </div>`;
    root.querySelector('.back-btn').addEventListener('click', () => this.app.setState(GAME_STATES.HOME));
    this.els = { gold: root.querySelector('.shop-gold'), list: root.querySelector('.shop-list') };
    this.renderAll();
  }

  exit() {}

  renderAll() {
    const { app } = this;
    this.els.gold.textContent = `Gold: ${app.gameState.player.gold}`;
    const listings = app.shop.getListings();
    this.els.list.innerHTML = listings.map((l) => {
      const label = l.state === ITEM_STATES.BOUGHT ? 'OWNED'
        : l.state === ITEM_STATES.LOCKED ? 'LOCKED'
        : `${l.price?.gold ?? 0}g${l.price?.materials ? ' + mats' : ''}`;
      return `
        <div class="shop-row">
          <div class="shop-item-name">${l.name}</div>
          <div class="shop-item-flavour">${l.flavour ?? ''}</div>
          <button class="shop-buy-btn" data-id="${l.id}" ${l.state === ITEM_STATES.FOR_SALE ? '' : 'disabled'}>${label}</button>
        </div>`;
    }).join('');
    this.els.list.querySelectorAll('[data-id]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const result = app.shop.buy(btn.dataset.id);
        app.gameState.addLog(result.ok ? 'Purchased.' : result.reason);
        this.renderAll();
      });
    });
  }
}
