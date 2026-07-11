import { StateManager } from './core/StateManager.js';

function boot() {
  const screenRoot = document.getElementById('screen');
  const app = new StateManager({ screenRoot });
  app.start();
  window.__game = app; // debugging: window.__game.gameState, .combatManager, etc.
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot);
} else {
  boot();
}
