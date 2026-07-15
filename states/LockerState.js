import { GAME_STATES, SINGLE_EQUIPMENT_SLOTS, MULTI_EQUIPMENT_SLOTS } from '../utils/Constants.js';
import { getMaterialConfig, getItemConfig } from '../data/items.js';
import { getConsumableConfig } from '../data/consumables.js';
import { TooltipManager } from '../ui/TooltipManager.js';
import { itemTooltipHTML } from '../ui/InfoFormatters.js';
import { t, tData, tReason } from '../ui/i18n.js';

export class LockerState {
  constructor(app) { this.app = app; }

  enter(root) {
    this.root = root;
    this.tab = 'equipment'; // 'equipment' | 'materials' | 'consumables'
    root.innerHTML = `
      <div class="locker-screen">
        <button class="back-btn">${t('common.return_home')}</button>
        <h1>${t('locker.title')}</h1>
        <div class="locker-tabs">
          <button class="tab-btn" data-tab="equipment">${t('locker.tab_equipment')}</button>
          <button class="tab-btn" data-tab="materials">${t('locker.tab_materials')}</button>
          <button class="tab-btn" data-tab="consumables">${t('locker.tab_consumables')}</button>
        </div>
        <div class="locker-body"></div>
      </div>`;
    root.querySelector('.back-btn').addEventListener('click', () => this.app.setState(GAME_STATES.HOME));
    root.querySelectorAll('[data-tab]').forEach((btn) => {
      btn.addEventListener('click', () => { this.tab = btn.dataset.tab; this.renderAll(); });
    });
    this.body = root.querySelector('.locker-body');
    this.tooltip = new TooltipManager();
    this.renderAll();
  }

  exit() {
    this.tooltip?.destroy();
  }

  renderAll() {
    this.root.querySelectorAll('[data-tab]').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.tab === this.tab);
    });
    if (this.tab === 'materials') this.renderMaterials();
    else if (this.tab === 'consumables') this.renderConsumables();
    else this.renderEquipment();
  }

  renderEquipment() {
    const { app } = this;
    const equipped = app.inventory.getEquippedItems();

    const singleRows = SINGLE_EQUIPMENT_SLOTS.map((slot) => {
      const id = equipped[slot];
      const itemName = id ? tData('item', id, getItemConfig(id)?.name ?? id) : t('locker.empty');
      return `
        <div class="locker-row" ${id ? `data-item-id="${id}"` : ''}>
          <span>${t(`locker.slot.${slot}`)}: ${itemName}</span>
          ${id ? `<button data-unequip="${slot}">${t('locker.unequip')}</button>` : ''}
        </div>`;
    }).join('');

    const multiRows = Object.keys(MULTI_EQUIPMENT_SLOTS).map((category) => {
      const max = MULTI_EQUIPMENT_SLOTS[category];
      const items = equipped[category] ?? [];
      const filled = items.map((id, i) => `
        <div class="locker-row" data-item-id="${id}">
          <span>${t(`locker.slot.${category}`)} ${i + 1}: ${tData('item', id, getItemConfig(id)?.name ?? id)}</span>
          <button data-unequip="${category}" data-item="${id}">${t('locker.unequip')}</button>
        </div>`).join('');
      const empty = Array.from({ length: max - items.length }).map((_, i) => `
        <div class="locker-row">
          <span>${t(`locker.slot.${category}`)} ${items.length + i + 1}: ${t('locker.empty')}</span>
        </div>`).join('');
      return filled + empty;
    }).join('');

    const ownedList = app.inventory.getOwnedItems().map((item) => {
      const equippedCount = app.inventory.countEquippedInstances(item.id);
      const canEquipMore = equippedCount < item.ownedCount;
      const itemName = tData('item', item.id, item.name);
      const slotName = t(`locker.slot.${item.type}`);
      return `
        <div class="locker-row" data-item-id="${item.id}">
          <span>${itemName} (${slotName})${t('locker.owned_equipped', { owned: item.ownedCount, equipped: equippedCount })}</span>
          <button data-equip="${item.id}" ${canEquipMore ? '' : 'disabled'}>${t('locker.equip')}</button>
        </div>`;
    }).join('');

    this.body.innerHTML = `
      <div class="locker-columns">
        <div class="locker-equipped"><h3>${t('locker.equipped')}</h3>${singleRows}${multiRows}</div>
        <div class="locker-owned">
          <h3>${t('locker.owned')}</h3>
          <div class="locker-owned-list">${ownedList || `<div class="locker-empty">${t('locker.nothing_yet')}</div>`}</div>
        </div>
      </div>`;

    this.body.querySelectorAll('[data-item-id]').forEach((row) => {
      this.tooltip.bind(row, () => {
        const config = getItemConfig(row.dataset.itemId);
        return config ? itemTooltipHTML(config) : '';
      });
    });
    this.body.querySelectorAll('[data-unequip]').forEach((btn) => {
      btn.addEventListener('click', () => {
        app.inventory.unequipSlot(btn.dataset.unequip, btn.dataset.item ?? null);
        app.saveSystem.save();
        this.renderAll();
      });
    });
    this.body.querySelectorAll('[data-equip]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const result = app.inventory.equipItem(btn.dataset.equip);
        if (!result.ok) app.gameState.addLog(tReason(result.reason));
        app.saveSystem.save();
        this.renderAll();
      });
    });
  }

  renderMaterials() {
    const { app } = this;
    const entries = Object.entries(app.gameState.player.backpackMaterials).filter(([, amt]) => amt > 0);
    this.body.innerHTML = `
      <div class="materials-grid">
        <div class="material-card gold-card">
          <div class="material-name">${t('locker.gold')}</div>
          <div class="material-amount">${app.gameState.player.gold}</div>
        </div>
        ${entries.map(([id, amt]) => {
          const cfg = getMaterialConfig(id);
          return `
            <div class="material-card">
              <div class="material-name">${tData('material', id, cfg?.name ?? id)}</div>
              <div class="material-amount">${amt}</div>
            </div>`;
        }).join('')}
        ${entries.length === 0 ? `<div class="locker-empty">${t('locker.no_materials')}</div>` : ''}
      </div>`;
  }

  renderConsumables() {
    const { app } = this;
    const entries = Object.entries(app.gameState.player.consumables ?? {}).filter(([, amt]) => amt > 0);
    if (entries.length === 0) {
      this.body.innerHTML = `<div class="locker-empty">${t('locker.no_consumables')}</div>`;
      return;
    }
    this.body.innerHTML = `
      <div class="materials-grid">
        ${entries.map(([id, amt]) => {
          const cfg = getConsumableConfig(id);
          return `
            <div class="material-card">
              <div class="material-name">${tData('consumable', id, cfg?.name ?? id)}</div>
              <div class="material-amount">${amt}</div>
            </div>`;
        }).join('')}
      </div>`;
  }
}
