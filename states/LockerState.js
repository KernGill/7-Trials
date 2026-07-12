import { GAME_STATES } from '../utils/Constants.js';
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
    const equippedList = Object.entries(equipped).map(([slot, id]) => `
      <div class="locker-row">
        <span>${slot}: ${id ?? '(empty)'}</span>
        ${id ? `<button data-unequip="${slot}">Unequip</button>` : ''}
      </div>`).join('');
    const ownedList = app.inventory.getOwnedItems().map((item) => {
      const isEquipped = Object.values(equipped).includes(item.id);
      return `
        <div class="locker-row">
          <span>${item.name} (${item.type})</span>
          <button data-equip="${item.id}" ${isEquipped ? 'disabled' : ''}>${isEquipped ? 'Equipped' : 'Equip'}</button>
        </div>`;
    }).join('');

    this.body.innerHTML = `
      <div class="locker-columns">
        <div class="locker-equipped"><h3>Equipped</h3>${equippedList}</div>
        <div class="locker-owned"><h3>Owned</h3>${ownedList || '<div class="locker-empty">Nothing yet.</div>'}</div>
      </div>`;

    this.body.querySelectorAll('[data-unequip]').forEach((btn) => {
      btn.addEventListener('click', () => { app.inventory.unequipSlot(btn.dataset.unequip); app.saveSystem.save(); this.renderAll(); });
    });
    this.body.querySelectorAll('[data-equip]').forEach((btn) => {
      btn.addEventListener('click', () => { app.inventory.equipItem(btn.dataset.equip); app.saveSystem.save(); this.renderAll(); });
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
