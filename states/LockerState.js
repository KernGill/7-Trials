import { GAME_STATES, SINGLE_EQUIPMENT_SLOTS, MULTI_EQUIPMENT_SLOTS } from '../utils/Constants.js';
import { getMaterialConfig } from '../data/items.js';
import { getConsumableConfig } from '../data/consumables.js';

export class LockerState {
  constructor(app) { this.app = app; }

  enter(root) {
    this.root = root;
    this.tab = 'equipment'; // 'equipment' | 'materials' | 'consumables'
    root.innerHTML = `
      <div class="locker-screen">
        <button class="back-btn">RETURN HOME</button>
        <h1>LOCKER</h1>
        <div class="locker-tabs">
          <button class="tab-btn" data-tab="equipment">EQUIPMENT</button>
          <button class="tab-btn" data-tab="materials">MATERIALS</button>
          <button class="tab-btn" data-tab="consumables">CONSUMABLES</button>
        </div>
        <div class="locker-body"></div>
      </div>`;
    root.querySelector('.back-btn').addEventListener('click', () => this.app.setState(GAME_STATES.HOME));
    root.querySelectorAll('[data-tab]').forEach((btn) => {
      btn.addEventListener('click', () => { this.tab = btn.dataset.tab; this.renderAll(); });
    });
    this.body = root.querySelector('.locker-body');
    this.renderAll();
  }

  exit() {}

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
      return `
        <div class="locker-row">
          <span>${slot}: ${id ?? '(empty)'}</span>
          ${id ? `<button data-unequip="${slot}">Unequip</button>` : ''}
        </div>`;
    }).join('');

    const multiRows = Object.keys(MULTI_EQUIPMENT_SLOTS).map((category) => {
      const max = MULTI_EQUIPMENT_SLOTS[category];
      const items = equipped[category] ?? [];
      const filled = items.map((id, i) => `
        <div class="locker-row">
          <span>${category} ${i + 1}: ${id}</span>
          <button data-unequip="${category}" data-item="${id}">Unequip</button>
        </div>`).join('');
      const empty = Array.from({ length: max - items.length }).map((_, i) => `
        <div class="locker-row">
          <span>${category} ${items.length + i + 1}: (empty)</span>
        </div>`).join('');
      return filled + empty;
    }).join('');

    const ownedList = app.inventory.getOwnedItems().map((item) => {
      const equippedCount = app.inventory.countEquippedInstances(item.id);
      const canEquipMore = equippedCount < item.ownedCount;
      return `
        <div class="locker-row">
          <span>${item.name} (${item.type}) — Owned: ${item.ownedCount}, Equipped: ${equippedCount}</span>
          <button data-equip="${item.id}" ${canEquipMore ? '' : 'disabled'}>Equip</button>
        </div>`;
    }).join('');

    this.body.innerHTML = `
      <div class="locker-columns">
        <div class="locker-equipped"><h3>Equipped</h3>${singleRows}${multiRows}</div>
        <div class="locker-owned"><h3>Owned</h3>${ownedList || '<div class="locker-empty">Nothing yet.</div>'}</div>
      </div>`;

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
        if (!result.ok) app.gameState.addLog(result.reason);
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
          <div class="material-name">Gold</div>
          <div class="material-amount">${app.gameState.player.gold}</div>
        </div>
        ${entries.map(([id, amt]) => {
          const cfg = getMaterialConfig(id);
          return `
            <div class="material-card">
              <div class="material-name">${cfg?.name ?? id}</div>
              <div class="material-amount">${amt}</div>
            </div>`;
        }).join('')}
        ${entries.length === 0 ? '<div class="locker-empty">No materials yet — fight enemies or open locked rooms to find some.</div>' : ''}
      </div>`;
  }

  renderConsumables() {
    const { app } = this;
    const entries = Object.entries(app.gameState.player.consumables ?? {}).filter(([, amt]) => amt > 0);
    if (entries.length === 0) {
      this.body.innerHTML = '<div class="locker-empty">No consumables yet — buy some from the Shop.</div>';
      return;
    }
    this.body.innerHTML = `
      <div class="materials-grid">
        ${entries.map(([id, amt]) => {
          const cfg = getConsumableConfig(id);
          return `
            <div class="material-card">
              <div class="material-name">${cfg?.name ?? id}</div>
              <div class="material-amount">${amt}</div>
            </div>`;
        }).join('')}
      </div>`;
  }
}
