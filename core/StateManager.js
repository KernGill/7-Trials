import { GAME_STATES } from '../utils/Constants.js';
import { GameState } from './GameState.js';
import { EventBus } from './EventBus.js';
import { InputManager } from './InputManager.js';
import { GameLoop } from './GameLoop.js';
import { CombatManager } from '../combat/CombatManager.js';
import { InventorySystem } from '../systems/InventorySystem.js';
import { ProgressionSystem } from '../systems/ProgressionSystem.js';
import { AchievementSystem } from '../systems/AchievementSystem.js';
import { getAchievementConfig } from '../data/achievements.js';
import { ShopSystem } from '../systems/ShopSystem.js';
import { InnSystem } from '../systems/InnSystem.js';
import { BestiarySystem } from '../systems/BestiarySystem.js';
import { SaveSystem } from '../systems/SaveSystem.js';
import { DungeonGenerator } from '../exploration/DungeonGenerator.js';
import { TrapSystem } from '../exploration/TrapSystem.js';
import { getArcForFloor } from '../data/arcs.js';
import { Player } from '../entities/Player.js';
import { Enemy } from '../entities/Enemy.js';
import { getEnemyConfig } from '../data/enemies.js';
import { HomeState } from '../states/HomeState.js';
import { ExploreState } from '../states/ExploreState.js';
import { FightState } from '../states/FightState.js';
import { ShopState } from '../states/ShopState.js';
import { InnState } from '../states/InnState.js';
import { LockerState } from '../states/LockerState.js';
import { SettingsState } from '../states/SettingsState.js';
import { BestiaryState } from '../states/BestiaryState.js';

/**
 * StateManager — owns every system and the top-level state machine.
 *
 * Pure DOM UI: every state gets a single `screenRoot` element and fully
 * owns its own markup (no shared canvas, no generic bottom button bar).
 * States re-render themselves only in response to actual events
 * (button clicks, combat events) — never from a per-frame loop. That
 * per-frame rebuild pattern is what broke the fight-move buttons
 * before, so it's gone entirely now.
 *
 * Navigation is strictly hub-and-spoke: HOME can go anywhere; every
 * other state can only return to HOME (enforced below, not by
 * convention). EXPLORE and FIGHT are peer top-level states — stepping
 * onto an enemy tile is an immediate setState(FIGHT); winning returns
 * to setState(EXPLORE).
 */
export class StateManager {
  constructor({ screenRoot }) {
    this.gameState = new GameState();
    this.eventBus = new EventBus();
    this.input = new InputManager(document);
    this.combatManager = new CombatManager(this.eventBus);
    this.inventory = new InventorySystem(this.gameState);
    this.achievements = new AchievementSystem(this.gameState);
    this.progression = new ProgressionSystem(this.gameState, this.achievements);
    this.shop = new ShopSystem(this.gameState, this.inventory, this.progression);
    this.inn = new InnSystem(this.gameState);
    this.bestiary = new BestiarySystem(this.gameState);
    this.saveSystem = new SaveSystem(this.gameState);
    this.trapSystem = new TrapSystem();
    this.screenRoot = screenRoot;

    this.states = {
      [GAME_STATES.HOME]: new HomeState(this),
      [GAME_STATES.EXPLORE]: new ExploreState(this),
      [GAME_STATES.FIGHT]: new FightState(this),
      [GAME_STATES.SHOP]: new ShopState(this),
      [GAME_STATES.INN]: new InnState(this),
      [GAME_STATES.LOCKER]: new LockerState(this),
      [GAME_STATES.SETTINGS]: new SettingsState(this),
      [GAME_STATES.BESTIARY]: new BestiaryState(this),
    };

    this.bindEvents();
    this.bindInput();
    this.saveSystem.load();
    this.applyBrightness();
    // A persisted active run (see ExploreState's autosave checkpoints)
    // resumes straight into exploration instead of bouncing to Home.
    this.setState(this.gameState.run?.active ? GAME_STATES.EXPLORE : GAME_STATES.HOME);
  }

  /** settings.brightness is stored/edited from two places (SettingsState, PauseOverlay) — this is the one place it actually takes visual effect. */
  applyBrightness() {
    document.body.style.filter = `brightness(${this.gameState.settings.brightness})`;
  }

  setFPS(fps) {
    this.gameState.settings.fps = fps;
    this.loop?.setFPS(fps);
  }

  bindEvents() {
    this.eventBus.on('combat:enemy_move_flash', ({ move }) => {
      this.currentStateHandler.onEnemyMoveFlash?.(move);
    });
    this.eventBus.on('combat:victory', () => this.deferCombatEnd(() => this.onCombatVictory()));
    this.eventBus.on('combat:defeat', () => this.deferCombatEnd(() => this.onCombatDefeat()));
    this.eventBus.on('combat:abandoned', () => this.onCombatDefeat());
    this.eventBus.on('combat:player_turn', () => this.currentStateHandler.onCombatUpdate?.());
    this.eventBus.on('combat:move_resolved', (payload) => {
      this.trackAchievementTriggers(payload);
      this.currentStateHandler.onCombatUpdate?.();
      this.currentStateHandler.onMoveResolved?.(payload);
    });
    this.eventBus.on('combat:log', () => this.currentStateHandler.onCombatUpdate?.());
  }

  /**
   * The killing blow's own animation is still queued/playing in
   * FightState when combat:victory/defeat fires (CombatManager resolves
   * everything synchronously). Route through FightState so the screen
   * doesn't get torn down mid-animation; anything else just runs now.
   */
  deferCombatEnd(fn) {
    if (this.currentStateHandler?.deferUntilAnimationsDone) {
      this.currentStateHandler.deferUntilAnimationsDone(fn);
    } else {
      fn();
    }
  }

  /**
   * Central place for "did something achievement-relevant just happen"
   * checks that hook into combat events. Final Rites specifically:
   * count hits on the player within the current run; checked against
   * the achievement's target when the run is survived (see goHome).
   */
  trackAchievementTriggers({ defender, move, result }) {
    if (move?.id === 'final_rites' && defender?.isPlayer && result?.hit) {
      this.gameState.run.achievementProgress = this.gameState.run.achievementProgress ?? {};
      this.gameState.run.achievementProgress.finalRitesHits =
        (this.gameState.run.achievementProgress.finalRitesHits ?? 0) + 1;
    }
  }

  bindInput() {
    const homeOnlyNav = {
      navigate_battle: () => this.startRun(),
      navigate_shop: () => this.setState(GAME_STATES.SHOP),
      navigate_inn: () => this.setState(GAME_STATES.INN),
      navigate_locker: () => this.setState(GAME_STATES.LOCKER),
      navigate_bestiary: () => this.setState(GAME_STATES.BESTIARY),
      navigate_settings: () => this.setState(GAME_STATES.SETTINGS),
    };
    Object.entries(homeOnlyNav).forEach(([event, handler]) => {
      this.input.on(event, () => {
        if (this.gameState.currentState === GAME_STATES.HOME) handler();
      });
    });
    this.input.on('toggle_pause', () => this.togglePause());
  }

  get currentStateHandler() {
    return this.states[this.gameState.currentState];
  }

  setState(stateId) {
    this.currentStateHandler?.exit?.();
    this.gameState.setState(stateId);
    this.screenRoot.innerHTML = '';
    this.currentStateHandler.enter(this.screenRoot);
  }

  goHome({ died = false } = {}) {
    // Bank any materials picked up this run into permanent storage
    // before the run object gets wiped/replaced by the next startRun().
    const runMaterials = this.gameState.run?.materials ?? {};
    Object.entries(runMaterials).forEach(([id, amt]) => {
      if (amt > 0) this.inventory.addMaterial(id, amt, false);
    });

    // run.consumables started as a copy of the permanent stock at
    // startRun() and only ever depletes (usage) or grows (drops) from
    // there — write it back so the next run starts from the correct
    // count instead of silently resetting to what you had before.
    if (this.gameState.run?.consumables) {
      this.gameState.player.consumables = { ...this.gameState.run.consumables };
    }

    // "Survive a run" achievements only count if you actually survived
    // (left voluntarily or won) — not if you died.
    if (!died) {
      const hits = this.gameState.run?.achievementProgress?.finalRitesHits ?? 0;
      const target = getAchievementConfig('survive_final_rites')?.target ?? 3;
      if (hits >= target) this.achievements.setComplete('survive_final_rites');
    }

    // These two don't require surviving — just doing the thing within one run.
    const ifKills = this.gameState.run?.achievementProgress?.indebtedFallenKillsThisRun ?? 0;
    const ifTarget = getAchievementConfig('beat_4_indebted_fallen_in_run')?.target ?? 4;
    if (ifKills >= ifTarget) this.achievements.setComplete('beat_4_indebted_fallen_in_run');

    const potions = this.gameState.run?.achievementProgress?.potionsUsedThisRun ?? 0;
    const potionTarget = getAchievementConfig('use_10_potions_in_run')?.target ?? 10;
    if (potions >= potionTarget) this.achievements.setComplete('use_10_potions_in_run');

    this.combatManager.reset();
    this.gameState.combat = null;
    this.gameState.paused = false;
    this.setState(GAME_STATES.HOME);
    this.saveSystem.save();
  }

  /** Called by ExploreState/FightState right after a consumable is used, for per-run achievement tracking. */
  trackConsumableUsed(id) {
    if (id !== 'minor_potion') return;
    this.gameState.run.achievementProgress = this.gameState.run.achievementProgress ?? {};
    this.gameState.run.achievementProgress.potionsUsedThisRun =
      (this.gameState.run.achievementProgress.potionsUsedThisRun ?? 0) + 1;
  }

  togglePause() {
    if (this.gameState.currentState !== GAME_STATES.EXPLORE &&
        this.gameState.currentState !== GAME_STATES.FIGHT) return;
    this.gameState.paused = !this.gameState.paused;
    this.gameState.pauseView = 'menu';
    this.currentStateHandler.onPauseToggled?.();
  }

  // --- Run lifecycle -----------------------------------------------------

  startRun() {
    const arc = this.progression.getCurrentArc();
    this.gameState.run = {
      active: true,
      floor: 1,
      tilesExplored: 0,
      enemiesRemaining: arc.enemiesPerFloor,
      playerPosition: { x: 0, y: 0 },
      dungeon: null,
      consumables: { ...this.gameState.player.consumables },
      materials: {},
      explorationBuffs: [],
      savedHealth: null,
      floorMessage: null,
    };
    this.generateFloor();
    this.saveSystem.save();
    this.setState(GAME_STATES.EXPLORE);
  }

  generateFloor() {
    const arc = getArcForFloor(this.gameState.run.floor);
    const generator = new DungeonGenerator(arc);
    const dungeon = generator.generate(this.gameState.run.floor);
    this.gameState.run.dungeon = dungeon;
    this.gameState.run.playerPosition = { ...dungeon.playerPos };
    this.gameState.run.enemiesRemaining = dungeon.enemiesRemaining;
    this.gameState.run.tilesExplored = 0;
    const start = dungeon.tiles.find((t) => t.x === dungeon.playerPos.x && t.y === dungeon.playerPos.y);
    if (start) { start.explored = true; this.gameState.run.tilesExplored = 1; }
  }

  createPlayer() {
    const savedHealth = this.gameState.run.savedHealth ?? null;
    return Player.create(
      this.gameState.meta.selectedCharacterId,
      this.inventory,
      savedHealth,
    );
  }

  /** Called by ExploreState the instant the player steps onto an enemy tile. */
  startCombat(enemyId) {
    const player = this.createPlayer();
    const enemy = new Enemy(enemyId);
    this.combatManager.startCombat({
      player,
      enemies: [enemy],
      explorationBuffs: this.gameState.run.explorationBuffs ?? [],
    });
    this.gameState.combat = this.combatManager.getState();
    this.setState(GAME_STATES.FIGHT);
  }

  onCombatVictory() {
    const { rewards } = this.combatManager;
    const enemies = this.combatManager.enemies;
    this.gameState.player.gold += rewards?.gold ?? 0;

    Object.entries(rewards?.drops?.materials ?? {}).forEach(([id, amt]) => {
      this.inventory.addMaterial(id, amt, true);
    });
    rewards?.drops?.items?.forEach((id) => this.inventory.addItem(id));
    Object.entries(rewards?.drops?.consumables ?? {}).forEach(([id, amt]) => {
      this.inventory.addConsumable(id, amt, true);
    });

    enemies.forEach((enemy) => {
      this.progression.recordKill(enemy.enemyId);
      this.progression.recordRunKill(enemy.enemyId);
      this.bestiary.recordEncounter(enemy);

      this.gameState.run.achievementProgress = this.gameState.run.achievementProgress ?? {};
      const progress = this.gameState.run.achievementProgress;
      const config = getEnemyConfig(enemy.enemyId);
      const oneHitKill = enemy.playerHitCount === 1;

      if (config?.species === 'skeleton') {
        this.achievements.recordProgress('kill_one_skeleton', 1);
        if (oneHitKill) progress.oneHitSkeleton = true;
      }
      if (config?.species === 'zombie') {
        this.achievements.recordProgress('kill_one_zombie', 1);
        progress.beatHollowedThisRun = true; // for Ossifying Chokehold's "die to IF after beating a Hollowed"
        if (oneHitKill) progress.oneHitZombie = true;
      }
      if (progress.oneHitSkeleton && progress.oneHitZombie) {
        this.achievements.setComplete('beat_both_in_one_hit_each');
      }
      if (enemy.enemyId === 'indebted_fallen' || enemy.enemyId === 'indebted_fallen_boss') {
        progress.indebtedFallenKillsThisRun = (progress.indebtedFallenKillsThisRun ?? 0) + 1;
      }
    });

    this.gameState.run.savedHealth = this.combatManager.player.currentHealth;
    this.gameState.run.enemiesRemaining -= 1;
    this.gameState.run.explorationBuffs = [];
    this.gameState.addLog('Battle won.');

    if (this.progression.isBossFloor(this.gameState.run.floor) &&
        enemies.some((e) => e.isBoss)) {
      const clearedArc = getArcForFloor(this.gameState.run.floor);
      this.progression.completeArc(clearedArc.id); // no-ops if already completed before
      this.gameState.run.active = false;
      this.goHome();
      return;
    }

    this.combatManager.reset();
    // Checkpoint here too — otherwise a refresh in the gap between
    // winning and your next move would resurrect the enemy tile and
    // undo this fight's rewards (see the matching skip in ExploreState
    // .movePlayer for why entering combat itself isn't a checkpoint).
    this.saveSystem.save();
    this.setState(GAME_STATES.EXPLORE);
  }

  onCombatDefeat() {
    this.gameState.run.active = false;
    this.gameState.run.savedHealth = null;
    this.gameState.addLog('You were defeated.');

    // Check before combatManager.reset() (called inside goHome) wipes `enemies`.
    const diedToSkeleton = this.combatManager.enemies.some(
      (e) => getEnemyConfig(e.enemyId)?.species === 'skeleton',
    );
    const beatHollowedThisRun = this.gameState.run.achievementProgress?.beatHollowedThisRun;
    if (diedToSkeleton && beatHollowedThisRun) {
      this.achievements.setComplete('die_to_indebted_fallen_after_hollowed');
    }

    this.goHome({ died: true });
  }

  // --- Loop (timers only — no per-frame rendering) ------------------------

  update(dt) {
    this.currentStateHandler.tick?.(dt);
  }

  start() {
    this.loop = new GameLoop((dt) => this.update(dt), () => {}, this.gameState.settings.fps);
    this.loop.start();
  }
}
