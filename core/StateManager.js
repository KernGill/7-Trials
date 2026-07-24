import { GAME_STATES, STAT_KEYS, enemyStatMultiplierForFloor } from '../utils/Constants.js';
import { deepClone } from '../utils/MathUtils.js';
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
import { Tile } from '../exploration/Tile.js';
import { getArcForFloor } from '../data/arcs.js';
import { Player } from '../entities/Player.js';
import { Enemy } from '../entities/Enemy.js';
import { getEnemyConfig, getEnemiesForArc } from '../data/enemies.js';
import { getItemConfig } from '../data/items.js';
import { HomeState } from '../states/HomeState.js';
import { ExploreState } from '../states/ExploreState.js';
import { FightState } from '../states/FightState.js';
import { ShopState } from '../states/ShopState.js';
import { InnState } from '../states/InnState.js';
import { LockerState } from '../states/LockerState.js';
import { SettingsState } from '../states/SettingsState.js';
import { BestiaryState } from '../states/BestiaryState.js';
import { SaveSlotsState } from '../states/SaveSlotsState.js';
import { setLanguage, t } from '../ui/i18n.js';

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
      [GAME_STATES.SAVES]: new SaveSlotsState(this),
    };

    this.bindEvents();
    this.bindInput();
    this.saveSystem.load();
    this.applyBrightness();
    this.applyLanguage();
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

  /** ui/i18n.js keeps the active language in a module-level singleton (read by every t()/tData() call) so states don't need gameState threaded through every render call — this is the one place that singleton gets synced from settings. */
  applyLanguage() {
    setLanguage(this.gameState.settings.language);
  }

  setLanguage(lang) {
    this.gameState.settings.language = lang;
    this.applyLanguage();
  }

  // --- Save slots ----------------------------------------------------------

  /**
   * Replaces live gameState with `slot`'s data and makes it the slot
   * future autosaves target. An empty/deleted slot is a valid target
   * too — it "loads" a brand new game (current brightness/language
   * preferences carry over since those aren't really game progress),
   * immediately saved into the slot so it's a real save from this point
   * on rather than reverting to whatever was live before on refresh.
   */
  loadFromSlot(slot) {
    const loaded = this.saveSystem.load(slot);
    if (!loaded) {
      const settings = { ...this.gameState.settings };
      this.gameState.reset();
      this.gameState.settings = settings;
    }
    this.saveSystem.setActiveSlot(slot);
    if (!loaded) this.saveSystem.save(slot);
    this.applyBrightness();
    this.applyLanguage();
    this.combatManager.reset();
    this.gameState.combat = null;
    this.gameState.paused = false;
    this.setState(this.gameState.run?.active ? GAME_STATES.EXPLORE : GAME_STATES.HOME);
    return true;
  }

  /** Writes the current live gameState into `slot` and makes it the slot future autosaves target. */
  saveToSlot(slot) {
    this.saveSystem.setActiveSlot(slot);
    this.saveSystem.save(slot);
  }

  deleteSlot(slot) {
    this.saveSystem.clearSlot(slot);
  }

  bindEvents() {
    this.eventBus.on('combat:enemy_move_flash', ({ move }) => {
      this.currentStateHandler.onEnemyMoveFlash?.(move);
    });
    this.eventBus.on('combat:victory', () => this.deferCombatEnd(() => this.onCombatVictory()));
    this.eventBus.on('combat:defeat', () => this.deferCombatEnd(() => this.onCombatDefeat()));
    this.eventBus.on('combat:abandoned', () => this.onCombatDefeat());
    // Achievement tracking only cares that a move resolved, not when it's
    // *visually* revealed — combat:sequence (below) drives all pacing.
    this.eventBus.on('combat:move_resolved', (payload) => this.trackAchievementTriggers(payload));
    this.eventBus.on('combat:sequence', (steps) => this.currentStateHandler.onSequence?.(steps));
    this.eventBus.on('combat:log', () => this.currentStateHandler.onLog?.());
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
      navigate_battle: () => this.states[GAME_STATES.HOME].handleBattleClick(),
      navigate_shop: () => this.setState(GAME_STATES.SHOP),
      navigate_inn: () => this.setState(GAME_STATES.INN),
      navigate_locker: () => this.setState(GAME_STATES.LOCKER),
      navigate_bestiary: () => this.setState(GAME_STATES.BESTIARY),
      navigate_settings: () => this.setState(GAME_STATES.SETTINGS),
      navigate_saves: () => this.setState(GAME_STATES.SAVES),
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

  /**
   * Voluntary "Abandon Run" from the pause menu (ExploreState only —
   * never available mid-fight). Snapshots the ENTIRE run — dungeon
   * (including which chests/doors are already resolved via each Tile's
   * meta.resolved), player position/facing, enemiesRemaining,
   * tilesExplored, cards, health, achievement progress — not just a
   * cherry-picked subset. Without the full dungeon, continuing used to
   * regenerate a brand-new (unseeded-random) floor layout every time,
   * which both threw away real exploration progress AND let a player
   * repeatedly abandon+continue to re-roll a floor full of fresh,
   * unopened chests/doors for infinite rewards. So HomeState can later
   * offer "Continue: Floor N" instead of only "Begin Anew". Death and
   * arc-completion both also route through goHome() but deliberately do
   * NOT call this — there's nothing to continue after either of those.
   *
   * `equipped` is captured from whatever is LIVE right now, which is
   * correct whether this run was fresh (live == the player's normal
   * loadout) or itself a continued run (live == the frozen loadout
   * continueRun() swapped in) — either way, that's genuinely what this
   * run was played with.
   */
  abandonRun() {
    this.gameState.abandonedRun = {
      run: deepClone(this.gameState.run),
      equipped: deepClone(this.gameState.player.equipped),
    };
    this.gameState.run.active = false;
    this.goHome();
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
    } else {
      // Dying ends the run permanently — there's nothing left to offer
      // "Continue: Floor N" on next time, even if this death happened
      // mid-way through an already-continued run (see continueRun()).
      // Only the explicit pause-menu Abandon button (abandonRun()) is
      // ever allowed to leave a fresh continue offer behind.
      this.gameState.abandonedRun = null;
    }

    // These two don't require surviving — just doing the thing within one run.
    const ifKills = this.gameState.run?.achievementProgress?.indebtedFallenKillsThisRun ?? 0;
    const ifTarget = getAchievementConfig('beat_4_indebted_fallen_in_run')?.target ?? 4;
    if (ifKills >= ifTarget) this.achievements.setComplete('beat_4_indebted_fallen_in_run');

    const potions = this.gameState.run?.achievementProgress?.potionsUsedThisRun ?? 0;
    const potionTarget = getAchievementConfig('use_10_potions_in_run')?.target ?? 10;
    if (potions >= potionTarget) this.achievements.setComplete('use_10_potions_in_run');

    const chests = this.gameState.run?.achievementProgress?.chestsOpenedThisRun ?? 0;
    const chestTarget = getAchievementConfig('open_3_chests_in_run')?.target ?? 3;
    if (chests >= chestTarget) this.achievements.setComplete('open_3_chests_in_run');

    // If this run was a continued one (see continueRun()), it was played
    // on a loadout frozen from the abandoned run rather than the player's
    // live one — restore whatever was actually equipped before Continue
    // was pressed, now that this run is over (death, abandon, or
    // victory), so continuing a run never permanently alters the
    // player's build.
    if (this.gameState.preContinueEquipped) {
      this.gameState.player.equipped = this.gameState.preContinueEquipped;
      this.gameState.preContinueEquipped = null;
    }

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
      facing: 'south',
      dungeon: null,
      consumables: { ...this.gameState.player.consumables },
      materials: {},
      explorationBuffs: [],
      savedHealth: null,
      floorMessage: null,
      cards: [],
    };
    // A fresh run (or one explicitly started over via "Begin Anew")
    // discards any pending "Continue: Floor N" offer.
    this.gameState.abandonedRun = null;
    this.generateFloor();
    this.saveSystem.save();
    this.setState(GAME_STATES.EXPLORE);
  }

  /**
   * Resumes a voluntarily-abandoned run (see abandonRun()) exactly where
   * it left off — same dungeon layout, same already-resolved chests/
   * doors, same position/facing/enemiesRemaining/tilesExplored/cards/
   * health — by restoring the whole snapshotted run object directly
   * (skipping generateFloor() entirely, unlike startRun()). No-ops if
   * there's nothing to continue.
   *
   * Two fields are deliberately NOT restored as-snapshotted:
   *  - materials: the snapshot's run.materials was already banked into
   *    player.backpackMaterials by the goHome() that ran right after
   *    abandonRun() captured it — restoring it too would double-count
   *    those materials the next time this run ends and banks again.
   *  - consumables: re-seeded fresh from the player's CURRENT permanent
   *    stock (same as a normal startRun()) rather than the stale
   *    snapshot, so potions bought/used while at Home in between are
   *    reflected instead of silently overwritten away next time goHome()
   *    mirrors run.consumables back onto player.consumables.
   *
   * Continuing must not silently change the player's build either: it
   * swaps in whatever was equipped at the moment of abandon (which may
   * differ from what's equipped right now, e.g. gear bought/equipped
   * since then), remembering the current loadout in preContinueEquipped
   * so goHome() can restore it the instant this continued run ends,
   * however it ends.
   */
  continueRun() {
    const snapshot = this.gameState.abandonedRun;
    if (!snapshot) return;
    this.gameState.preContinueEquipped = deepClone(this.gameState.player.equipped);
    this.gameState.player.equipped = deepClone(snapshot.equipped ?? {});

    const run = deepClone(snapshot.run);
    run.active = true;
    run.materials = {};
    run.consumables = { ...this.gameState.player.consumables };
    if (run.dungeon?.tiles) run.dungeon.tiles = run.dungeon.tiles.map((tile) => Tile.fromJSON(tile));
    this.gameState.run = run;
    this.gameState.abandonedRun = null;

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
      this.gameState.run.cards,
    );
  }

  /**
   * Called by ExploreState the instant the player steps onto an enemy
   * tile. `noScale` bypasses the normal per-floor stat multiplier — used
   * for the hidden floor-5 boss, whose hand-authored stats are meant to
   * mean exactly what they say regardless of which floor its arena
   * happens to sit on.
   */
  startCombat(enemyId, { noScale = false } = {}) {
    const player = this.createPlayer();
    const mult = noScale ? 1 : enemyStatMultiplierForFloor(this.gameState.run.floor);
    const statMultipliers = Object.fromEntries(STAT_KEYS.map((k) => [k, mult]));
    const enemy = new Enemy(enemyId, { statMultipliers });
    // FightState has to be listening (via currentStateHandler) *before*
    // combatManager.startCombat() runs its first synchronous cascade —
    // otherwise the very first combat:sequence batch (e.g. the enemy
    // acting first) fires while ExploreState is still current and gets
    // silently dropped, since ExploreState doesn't implement onSequence.
    this.setState(GAME_STATES.FIGHT);
    this.combatManager.startCombat({
      player,
      enemies: [enemy],
      explorationBuffs: this.gameState.run.explorationBuffs ?? [],
    });
    this.gameState.combat = this.combatManager.getState();
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

      if (enemy.enemyId === 'vanguard_of_darkness') {
        this.achievements.setComplete('defeat_vanguard_of_darkness');
      }

      if (config?.species === 'skeleton') {
        this.achievements.recordProgress('kill_one_skeleton', 1);
      }
      if (config?.species === 'zombie') {
        this.achievements.recordProgress('kill_one_zombie', 1);
        progress.beatHollowedThisRun = true; // for Ossifying Chokehold's "die to IF after beating a Hollowed"
        if (progress.chestOpenedFloor === this.gameState.run.floor && progress.doorOpenedFloor === this.gameState.run.floor) {
          this.achievements.setComplete('beat_zombie_after_chest_and_door');
        }
      }
      if (config?.species === 'ghost') {
        if (this.gameState.run.floor === 5) this.achievements.setComplete('beat_ghost_floor_5');
        if (this.combatManager.player.getStatusStacks('frostbite') >= 2) {
          this.achievements.setComplete('beat_ghost_with_2_frostbite');
        }
        if (enemy.diedFromStatusId === 'fire') {
          this.achievements.setComplete('beat_false_apparition_with_burn');
          if (this.inventory.countEquippedInstances('spore_cloak') > 0
            && this.inventory.countEquippedInstances('shrouded_footsteps') > 0) {
            progress.ghostsBurnedWithSporeGearThisRun = (progress.ghostsBurnedWithSporeGearThisRun ?? 0) + 1;
            if (progress.ghostsBurnedWithSporeGearThisRun >= 2) {
              this.achievements.setComplete('burn_2_ghosts_with_spore_gear');
            }
          }
        }
      }
      if (enemy.diedFromStatusId === 'bleed') this.achievements.setComplete('beat_enemy_with_bleed');
      if (enemy.diedFromStatusId && this.combatManager.player.getStatusStacks('stun') > 0) {
        this.achievements.setComplete('beat_enemy_with_status_while_stunned');
      }

      // "On one floor defeat a skeleton, a zombie, and a ghost" — tracked
      // per-floor, reset whenever the floor number changes.
      if (config?.species) {
        if (progress.speciesFloorTracker?.floor !== this.gameState.run.floor) {
          progress.speciesFloorTracker = { floor: this.gameState.run.floor, species: [] };
        }
        if (!progress.speciesFloorTracker.species.includes(config.species)) {
          progress.speciesFloorTracker.species.push(config.species);
        }
        if (['skeleton', 'zombie', 'ghost'].every((s) => progress.speciesFloorTracker.species.includes(s))) {
          this.achievements.setComplete('beat_all_species_one_floor');
        }
      }

      // "One-hit kill every Arc0 mob type at least once in a run" — Rage
      // of Vitalire's gate. Tracked as a set of enemy ids so it doesn't
      // matter which order or which single fight each one-hit came from.
      if (oneHitKill && config?.arcs?.includes('arc0') && !config?.isBoss) {
        progress.oneHitArc0MobsThisRun = progress.oneHitArc0MobsThisRun ?? [];
        if (!progress.oneHitArc0MobsThisRun.includes(enemy.enemyId)) {
          progress.oneHitArc0MobsThisRun.push(enemy.enemyId);
        }
        const allArc0Ids = getEnemiesForArc('arc0').map((e) => e.id);
        if (allArc0Ids.every((id) => progress.oneHitArc0MobsThisRun.includes(id))) {
          this.achievements.setComplete('one_hit_kill_all_arc0_mobs');
        }
      }
      if (enemy.enemyId === 'indebted_fallen' || enemy.enemyId === 'indebted_fallen_boss') {
        progress.indebtedFallenKillsThisRun = (progress.indebtedFallenKillsThisRun ?? 0) + 1;
      }
    });

    this.gameState.run.savedHealth = this.combatManager.player.currentHealth;
    this.gameState.run.enemiesRemaining -= 1;
    this.gameState.run.explorationBuffs = [];
    this.gameState.addLog(t('log.battle_won'));

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

  /** True if any currently-equipped item grants the Formless passive — used by Unshielded Immolation's achievement gate. */
  hasFormlessGearEquipped() {
    const equipped = this.inventory.getEquippedItems();
    const ids = Object.values(equipped).flatMap((v) => (Array.isArray(v) ? v : (v ? [v] : [])));
    return ids.some((id) => getItemConfig(id)?.moveIds?.includes('formless_gear'));
  }

  onCombatDefeat() {
    this.gameState.run.active = false;
    this.gameState.run.savedHealth = null;
    this.gameState.addLog(t('log.defeated'));

    // Check before combatManager.reset() (called inside goHome) wipes `enemies`/`player`.
    const player = this.combatManager.player;
    const diedToSkeleton = this.combatManager.enemies.some(
      (e) => getEnemyConfig(e.enemyId)?.species === 'skeleton',
    );
    const diedToGhost = this.combatManager.enemies.some(
      (e) => getEnemyConfig(e.enemyId)?.species === 'ghost',
    );
    const beatHollowedThisRun = this.gameState.run.achievementProgress?.beatHollowedThisRun;
    if (diedToSkeleton && beatHollowedThisRun) {
      this.achievements.setComplete('die_to_indebted_fallen_after_hollowed');
    }
    if (player?.diedFromMoveId === 'erratic_combustion' && !this.hasFormlessGearEquipped()) {
      this.achievements.setComplete('die_to_erratic_combustion_unshielded');
    }
    if (player?.diedFromStatusId === 'fire' && diedToGhost) {
      this.achievements.setComplete('burn_to_death_vs_ghost');
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
