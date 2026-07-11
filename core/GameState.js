import { GAME_STATES } from '../utils/Constants.js';
import { deepClone } from '../utils/MathUtils.js';

const DEFAULT_META = {
  currentArc: 0,
  arcsCompleted: [],
  innUnlocked: false,
  partyUnlocked: false,
  totalPotionsUsed: 0,
  killCounts: {},
  achievementFlags: {},
  unlockedCharacters: ['artius'],
  selectedCharacterId: 'artius',
};

const DEFAULT_RUN = {
  active: false,
  floor: 1,
  tilesExplored: 0,
  enemiesRemaining: 3,
  inTreasureRoom: false,
  dungeonSeed: null,
  playerPosition: { x: 0, y: 0 },
  dungeon: null,
  consumables: [],
  materials: {},
  runInventory: [],
};

const DEFAULT_PLAYER = {
  gold: 200,
  ownedEquipment: [],
  equipped: {},
  backpackMaterials: {},
  consumables: { minor_potion: 2 },
  lockerMaterials: {},
};

export class GameState {
  constructor() {
    this.reset();
  }

  reset() {
    this.currentState = GAME_STATES.HOME;
    this.previousState = null;
    this.meta = deepClone(DEFAULT_META);
    this.player = deepClone(DEFAULT_PLAYER);
    this.run = deepClone(DEFAULT_RUN);
    this.bestiary = {};
    this.combat = null;
    this.settings = { brightness: 1, sound: true };
    this.log = [];
    this.paused = false;
    this.enemyMoveFlash = null;
  }

  setState(nextState) {
    this.previousState = this.currentState;
    this.currentState = nextState;
  }

  addLog(message) {
    this.log.unshift({ message, time: Date.now() });
    if (this.log.length > 50) this.log.pop();
  }

  getSnapshot() {
    // Deliberately NOT persisting `run` or `currentState`: an in-progress
    // dungeon run contains Tile class instances that would lose their
    // methods across a JSON round-trip, and resuming mid-fight isn't
    // meaningfully reconstructable anyway. A refresh always drops you
    // back to Home with everything you've already banked there (gold,
    // equipment, bestiary, arc progress) intact — same rule the game
    // already uses for dying mid-run.
    return {
      meta: deepClone(this.meta),
      player: deepClone(this.player),
      bestiary: deepClone(this.bestiary),
      settings: deepClone(this.settings),
    };
  }

  loadSnapshot(snapshot) {
    const { meta, player, bestiary, settings } = deepClone(snapshot);
    if (meta) this.meta = meta;
    if (player) this.player = player;
    if (bestiary) this.bestiary = bestiary;
    if (settings) this.settings = settings;
  }
}
