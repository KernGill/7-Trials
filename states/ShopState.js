import { GAME_STATES, ITEM_STATES } from '../utils/Constants.js';
import { getMaterialConfig, getItemConfig } from '../data/items.js';
import { getConsumableConfig } from '../data/consumables.js';
import { TooltipManager } from '../ui/TooltipManager.js';
import { itemTooltipHTML, abilitySummaryLine } from '../ui/InfoFormatters.js';
import { t, tData, tReason } from '../ui/i18n.js';

function consumableTooltipHTML(config) {
  const ability = config.moveId ? abilitySummaryLine(config.moveId) : '';
  return `
    <h4>${tData('consumable', config.id, config.name)}</h4>
    <div class="tt-row"><span>${tData('consumableFlavour', config.id, config.flavour ?? '')}</span></div>
    ${ability ? `<div class="tt-row tt-section-label"><strong>${t('tooltip.effect')}</strong></div>${ability}` : ''}
  `;
}

function formatPrice(price) {
  if (!price) return '';
  const parts = [];
  if (price.gold) parts.push(`${price.gold}g`);
  Object.entries(price.materials ?? {}).forEach(([id, amt]) => {
    parts.push(`${amt} ${tData('material', id, getMaterialConfig(id)?.name ?? id)}`);
  });
  Object.entries(price.consumables ?? {}).forEach(([id, amt]) => {
    parts.push(`${amt} ${tData('consumable', id, getConsumableConfig(id)?.name ?? id)}`);
  });
  return parts.join(', ');
}

export class ShopState {
  constructor(app) { this.app = app; }

  enter(root) {
    this.root = root;
    this.mode = 'buy';
    root.innerHTML = `
      <div class="shop-screen">
        <button class="back-btn">${t('common.return_home')}</button>
        <h1>${t('shop.title')}</h1>
        <div class="shop-gold"></div>
        <div class="shop-mode-tabs">
          <button class="shop-tab-btn" data-mode="buy">${t('shop.tab_buy')}</button>
          <button class="shop-tab-btn" data-mode="sell">${t('shop.tab_sell')}</button>
        </div>
        <div class="shop-list"></div>
        <div class="flash-message"></div>
      </div>`;
    root.querySelector('.back-btn').addEventListener('click', () => this.app.setState(GAME_STATES.HOME));
    root.querySelectorAll('.shop-tab-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        this.mode = btn.dataset.mode;
        this.renderAll();
      });
    });
    this.els = {
      gold: root.querySelector('.shop-gold'),
      list: root.querySelector('.shop-list'),
      flash: root.querySelector('.flash-message'),
      tabs: root.querySelectorAll('.shop-tab-btn'),
    };
    this.tooltip = new TooltipManager();
    this.renderAll();
  }

  exit() {
    clearTimeout(this.flashTimeout);
    this.tooltip?.destroy();
  }

  /** Prioritizes gold over materials — canBuy() already checks gold first and short-circuits, so the reason string tells us which one to flash. */
  flashBuyFailure(reason) {
    const text = reason === 'Not enough gold.' ? t('shop.flash_gold')
      : reason === 'Not enough materials.' ? t('shop.flash_materials')
      : null;
    if (!text || !this.els.flash) return;
    clearTimeout(this.flashTimeout);
    this.els.flash.textContent = text;
    this.els.flash.classList.add('visible');
    this.flashTimeout = setTimeout(() => this.els.flash.classList.remove('visible'), 2000);
  }

  renderAll() {
    const { app } = this;
    this.els.gold.textContent = t('shop.gold', { amount: app.gameState.player.gold });
    this.els.tabs.forEach((btn) => btn.classList.toggle('active', btn.dataset.mode === this.mode));
    if (this.mode === 'sell') this.renderSellList();
    else this.renderBuyList();
  }

  renderBuyList() {
    const { app } = this;
    const listings = app.shop.getListings();
    this.els.list.innerHTML = listings.map((l) => {
      const label = l.state === ITEM_STATES.LOCKED ? t('shop.locked') : formatPrice(l.price);
      const ownedTag = l.type === 'item' ? `<div class="shop-owned">${t('shop.owned', { amount: l.ownedCount })}</div>` : '';
      const flavourKind = l.type === 'item' ? 'itemFlavour' : 'consumableFlavour';
      return `
        <div class="shop-row" data-row-id="${l.id}" data-row-type="${l.type}">
          <div class="shop-item-name">${tData(l.type, l.id, l.name)}</div>
          <div class="shop-item-flavour">${tData(flavourKind, l.id, l.flavour ?? '')}</div>
          ${ownedTag}
          <button class="shop-buy-btn" data-id="${l.id}" ${l.state === ITEM_STATES.LOCKED ? 'disabled' : ''}>${label}</button>
        </div>`;
    }).join('');
    this.els.list.querySelectorAll('[data-row-id]').forEach((row) => {
      this.tooltip.bind(row, () => {
        const config = row.dataset.rowType === 'item' ? getItemConfig(row.dataset.rowId) : getConsumableConfig(row.dataset.rowId);
        if (!config) return '';
        return row.dataset.rowType === 'item' ? itemTooltipHTML(config) : consumableTooltipHTML(config);
      });
    });
    this.els.list.querySelectorAll('[data-id]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const result = app.shop.buy(btn.dataset.id);
        app.gameState.addLog(result.ok ? t('shop.purchased') : tReason(result.reason));
        if (result.ok) app.saveSystem.save();
        else this.flashBuyFailure(result.reason);
        this.renderAll();
      });
    });
  }

  /**
   * Every owned equipment item (regardless of buy-listing visibility —
   * drop-only gear never appears under Buy but is still sellable here)
   * with its computed sell price as the button's label, same convention
   * as the buy list's price-as-label buttons.
   */
  renderSellList() {
    const { app } = this;
    const listings = app.shop.getSellableListings();
    if (!listings.length) {
      this.els.list.innerHTML = `<div class="shop-empty">${t('shop.sell_empty')}</div>`;
      return;
    }
    this.els.list.innerHTML = listings.map((l) => {
      const label = formatPrice(l.sellPrice) || t('shop.sell_worthless');
      return `
        <div class="shop-row" data-row-id="${l.id}" data-row-type="item">
          <div class="shop-item-name">${tData('item', l.id, l.name)}</div>
          <div class="shop-item-flavour">${tData('itemFlavour', l.id, l.flavour ?? '')}</div>
          <div class="shop-owned">${t('shop.owned', { amount: l.ownedCount })}</div>
          <button class="shop-sell-btn" data-id="${l.id}">${label}</button>
        </div>`;
    }).join('');
    this.els.list.querySelectorAll('[data-row-id]').forEach((row) => {
      this.tooltip.bind(row, () => {
        const config = getItemConfig(row.dataset.rowId);
        return config ? itemTooltipHTML(config) : '';
      });
    });
    this.els.list.querySelectorAll('[data-id]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const result = app.shop.sell(btn.dataset.id);
        app.gameState.addLog(result.ok ? t('shop.sold') : tReason(result.reason));
        if (result.ok) app.saveSystem.save();
        this.renderAll();
      });
    });
  }
}
