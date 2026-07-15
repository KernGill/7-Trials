import { GAME_STATES } from '../utils/Constants.js';
import { SAVE_SLOT_COUNT } from '../systems/SaveSystem.js';
import { InventorySystem } from '../systems/InventorySystem.js';
import { getArcConfig } from '../data/arcs.js';
import { TooltipManager } from '../ui/TooltipManager.js';
import { equipmentGridHTML, equipmentTotalsHTML } from '../ui/InfoFormatters.js';
import { t } from '../ui/i18n.js';

/**
 * SaveSlotsState — a fixed-size row of save slots (Load/Save/Delete per
 * slot), reached from Home's new "Load" button. Hovering a slot with
 * data shows the same equipment-grid preview as PauseOverlay's "View
 * Loadout", built from that slot's own peeked snapshot (never the live
 * gameState) via a throwaway InventorySystem wrapper — see
 * SaveSystem.peek().
 */
export class SaveSlotsState {
  constructor(app) {
    this.app = app;
  }

  enter(root) {
    this.root = root;
    this.confirmingDeleteSlot = null;
    this.tooltip = new TooltipManager();
    root.innerHTML = `
      <div class="saves-screen">
        <button class="back-btn">${t('common.return_home')}</button>
        <h1>${t('saves.title')}</h1>
        <div class="save-slots"></div>
      </div>`;
    root.querySelector('.back-btn').addEventListener('click', () => this.app.setState(GAME_STATES.HOME));
    this.list = root.querySelector('.save-slots');
    this.renderAll();
  }

  exit() {
    this.tooltip?.destroy();
  }

  renderAll() {
    const { app } = this;
    const slots = Array.from({ length: SAVE_SLOT_COUNT }, (_, i) => i + 1);

    this.list.innerHTML = slots.map((slot) => {
      const snapshot = app.saveSystem.peek(slot);
      const isActive = slot === app.saveSystem.activeSlot;
      const deleting = this.confirmingDeleteSlot === slot;

      const meta = snapshot
        ? `<div class="save-slot-meta">${t('saves.gold_arc', {
            gold: snapshot.player?.gold ?? 0,
            arc: getArcConfig(snapshot.meta?.currentArc ?? 0).index,
          })}</div>`
        : `<div class="save-slot-empty">${t('saves.empty')}</div>`;

      return `
        <div class="save-slot ${isActive ? 'active' : ''}" data-slot="${slot}">
          <div class="save-slot-info" ${snapshot ? 'data-has-save="1"' : ''}>
            <div class="save-slot-name">${t('saves.slot', { n: slot })}${isActive ? `<span class="active-tag">${t('saves.active_tag')}</span>` : ''}</div>
            ${meta}
          </div>
          <div class="save-slot-actions">
            <button data-a="load" ${snapshot ? '' : 'disabled'}>${t('saves.load')}</button>
            <button data-a="save">${t('saves.save')}</button>
            <button data-a="delete" ${snapshot ? '' : 'disabled'} class="${deleting ? 'confirming' : ''}">${deleting ? t('saves.confirm_delete') : t('saves.delete')}</button>
          </div>
        </div>`;
    }).join('');

    this.list.querySelectorAll('[data-has-save]').forEach((info) => {
      const slot = Number(info.closest('[data-slot]').dataset.slot);
      this.tooltip.bind(info, () => {
        const snapshot = app.saveSystem.peek(slot);
        if (!snapshot) return '';
        const fakeInventory = new InventorySystem({ player: snapshot.player, run: { materials: {} } });
        const equipped = fakeInventory.getEquippedItems();
        const totals = fakeInventory.getEquippedStatTotals();
        return `${equipmentGridHTML(equipped)}${equipmentTotalsHTML(totals)}`;
      }, 'wide');
    });

    this.list.querySelectorAll('[data-a="load"]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const slot = Number(btn.closest('[data-slot]').dataset.slot);
        app.loadFromSlot(slot);
      });
    });
    this.list.querySelectorAll('[data-a="save"]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const slot = Number(btn.closest('[data-slot]').dataset.slot);
        this.confirmingDeleteSlot = null;
        app.saveToSlot(slot);
        this.renderAll();
      });
    });
    this.list.querySelectorAll('[data-a="delete"]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const slot = Number(btn.closest('[data-slot]').dataset.slot);
        if (this.confirmingDeleteSlot === slot) {
          app.deleteSlot(slot);
          this.confirmingDeleteSlot = null;
        } else {
          this.confirmingDeleteSlot = slot;
        }
        this.renderAll();
      });
    });
  }
}
