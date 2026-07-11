import { GAME_STATES } from '../utils/Constants.js';

export class LockerState {
  constructor(app) { this.app = app; }

  enter(root) {
    this.root = root;
    root.innerHTML = `
      <div class="locker-screen">
        <button class="back-btn">RETURN HOME</button>
        <h1>LOCKER</h1>
        <div class="locker-columns">
          <div class="locker-equipped"></div>
          <div class="locker-owned"></div>
        </div>
      </div>`;
    root.querySelector('.back-btn').addEventListener('click', () => this.app.setState(GAME_STATES.HOME));
    this.equippedEl = root.querySelector('.locker-equipped');
    this.ownedEl = root.querySelector('.locker-owned');
    this.renderAll();
  }

  exit() {}

  renderAll() {
    const { app } = this;
    const equipped = app.inventory.getEquippedItems();
    this.equippedEl.innerHTML = '<h3>Equipped</h3>' + Object.entries(equipped).map(([slot, id]) => `
      <div class="locker-row">
        <span>${slot}: ${id ?? '(empty)'}</span>
        ${id ? `<button data-unequip="${slot}">Unequip</button>` : ''}
      </div>`).join('');

    this.ownedEl.innerHTML = '<h3>Owned</h3>' + app.inventory.getOwnedItems().map((item) => {
      const isEquipped = Object.values(equipped).includes(item.id);
      return `
        <div class="locker-row">
          <span>${item.name} (${item.type})</span>
          <button data-equip="${item.id}" ${isEquipped ? 'disabled' : ''}>${isEquipped ? 'Equipped' : 'Equip'}</button>
        </div>`;
    }).join('');

    this.equippedEl.querySelectorAll('[data-unequip]').forEach((btn) => {
      btn.addEventListener('click', () => { app.inventory.unequipSlot(btn.dataset.unequip); this.renderAll(); });
    });
    this.ownedEl.querySelectorAll('[data-equip]').forEach((btn) => {
      btn.addEventListener('click', () => { app.inventory.equipItem(btn.dataset.equip); this.renderAll(); });
    });
  }
}
