import { GAME_STATES } from '../utils/Constants.js';
import { deepClone } from '../utils/MathUtils.js';
import { Tile } from '../exploration/Tile.js';

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
  facing: 'south',
  dungeon: null,
  consumables: [],
  materials: {},
  runInventory: [],
};

const DEFAULT_PLAYER = {
  gold: 200,
  ownedEquipment: {},
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
    // gameSpeed: 1-5x multiplier on combat pacing (turn flashes, gaps,
    // move/status beats). Defaults to 2x — twice the original pace —
    // for everyone, new and existing saves alike (loadSnapshot's merge
    // below only overwrites this if an already-saved settings object
    // explicitly has its own gameSpeed value).
    this.settings = { brightness: 1, sound: true, fps: 60, language: 'en', gameSpeed: 2 };
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
    // `run` is only ever persisted while active, and only up through safe
    // exploration checkpoints (see ExploreState) — never mid-fight, since
    // live Combat/Player/Enemy instances aren't reconstructable. Tile
    // instances inside run.dungeon lose their class (and isWalkable())
    // across the JSON round-trip; loadSnapshot() rehydrates them below.
    return {
      meta: deepClone(this.meta),
      player: deepClone(this.player),
      bestiary: deepClone(this.bestiary),
      settings: deepClone(this.settings),
      run: this.run?.active ? deepClone(this.run) : null,
    };
  }

  loadSnapshot(snapshot) {
    const { meta, player, bestiary, settings, run } = deepClone(snapshot);
    if (meta) this.meta = meta;
    if (player) this.player = player;
    if (bestiary) this.bestiary = bestiary;
    // Merge rather than replace: an older save made before `fps` existed
    // would otherwise wipe it out, leaving GameLoop dividing by undefined.
    if (settings) this.settings = { ...this.settings, ...settings };
    if (run?.active) {
      if (run.dungeon?.tiles) run.dungeon.tiles = run.dungeon.tiles.map((t) => Tile.fromJSON(t));
      this.run = run;
    }
  }
}
