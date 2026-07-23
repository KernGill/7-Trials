import { GAME_STATES } from '../utils/Constants.js';
import { deepClone } from '../utils/MathUtils.js';
import { Tile } from '../exploration/Tile.js';
import { DEFAULT_CAMERA_ANGLE, DEFAULT_CAMERA_HEIGHT, DEFAULT_CAMERA_SENSITIVITY_PERCENT } from '../ui/CameraSettings.js';

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
  cards: [],
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
    this.settings = {
      brightness: 1, sound: true, fps: 60, language: 'en', gameSpeed: 2, fixedMinimap: true,
      // cameraAngle: 0 (horizontal) - 90 (bird's eye) degrees. cameraHeight: multiplier
      // on the previous fixed camera height, 1/3 - 1.5. Sourced from ui/CameraSettings.js
      // so this stays in sync with the Camera Orientation slider's own default.
      cameraAngle: DEFAULT_CAMERA_ANGLE,
      cameraHeight: DEFAULT_CAMERA_HEIGHT,
      // Multiplier (0 - 2) on the free-look camera's base mouse
      // sensitivity — 1 (100%) is the default, dead center of the slider's range.
      cameraSensitivity: DEFAULT_CAMERA_SENSITIVITY_PERCENT / 100,
    };
    this.log = [];
    this.paused = false;
    this.enemyMoveFlash = null;
    // Snapshot of a voluntarily-abandoned run (floor/cards/health/
    // achievement progress/equipped — see StateManager.abandonRun()),
    // offered back on the Home screen's Battle button as "Continue: Floor
    // N" until consumed by continueRun() or discarded by starting a fresh
    // run.
    this.abandonedRun = null;
    // Set only while a continued run is in progress: the loadout the
    // player actually had equipped at Home right before hitting Continue
    // (which may differ from what the abandoned run itself had equipped —
    // see StateManager.continueRun()). Restored the moment that continued
    // run ends (death, abandon, or victory — see StateManager.goHome()),
    // so continuing a run never permanently alters the player's build.
    this.preContinueEquipped = null;
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
      abandonedRun: this.abandonedRun ? deepClone(this.abandonedRun) : null,
      preContinueEquipped: this.preContinueEquipped ? deepClone(this.preContinueEquipped) : null,
    };
  }

  loadSnapshot(snapshot) {
    const { meta, player, bestiary, settings, run, abandonedRun, preContinueEquipped } = deepClone(snapshot);
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
    // Validate shape, not just presence — abandonedRun's schema changed
    // shape mid-development (from a handful of top-level fields to
    // { run, equipped }) while this feature was already shipping to save
    // files. A save written under the old shape has no `.run` here, and
    // HomeState reads `snapshot.run.floor` unconditionally — trusting it
    // as-is would throw the instant the Battle button is clicked (an old
    // dungeon/tile layout couldn't be restored correctly even if it
    // didn't throw), so just discard anything that doesn't match today's
    // shape rather than trying to migrate it.
    this.abandonedRun = abandonedRun?.run ? abandonedRun : null;
    this.preContinueEquipped = preContinueEquipped ?? null;
  }
}
