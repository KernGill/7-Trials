export const FPS = 60;

export const GAME_STATES = {
  HOME: 'home',
  EXPLORE: 'explore',
  FIGHT: 'fight',
  SHOP: 'shop',
  INN: 'inn',
  LOCKER: 'locker',
  SETTINGS: 'settings',
  BESTIARY: 'bestiary',
  SAVES: 'saves',
  ENCYCLOPEDIA: 'encyclopedia',
  ACHIEVEMENTS: 'achievements',
};

export const MOVE_CATEGORIES = {
  ATTACKS: 'attacks',
  SUSTAIN: 'sustain',
  SPECIALS: 'specials',
  CONSUMABLES: 'consumables',
};

export const CHEST_TRAP_DAMAGE = 30; // leaves party at 1 HP, never kills
export const TEMPORAL_CHEST_TRAP_DAMAGE = 100; // leaves party at 1 HP, never kills
export const LOCKED_ROOM_GOLD_REWARD = 80;

export const SINGLE_EQUIPMENT_SLOTS = [
  'mainWeapon', 'offHand', 'chest', 'head', 'boots', 'arms', 'legs',
];

/** category -> max simultaneously equipped. Replaces the old ring1/ring2 (etc) numbered-slot scheme. */
export const MULTI_EQUIPMENT_SLOTS = {
  ring: 2,
  glove: 2,
  accessory: 2,
};

export const EQUIPMENT_SLOTS = [...SINGLE_EQUIPMENT_SLOTS, ...Object.keys(MULTI_EQUIPMENT_SLOTS)];

export const STAT_KEYS = [
  'con', 'dex', 'str', 'spd', 'def', 'int', 'critChance', 'critDamage', 'energy',
];

export const SCALING_TYPES = {
  NONE: 'none',
  STR: 'str',
  DEX: 'dex',
  INT: 'int',
};

export const MOVE_PROPERTIES = {
  MELEE: 'melee',
  RANGED: 'ranged',
  PHYSICAL: 'physical',
  MAGIC: 'magic',
  DEBUFF: 'debuff',
  BUFF: 'buff',
  DEFENCE: 'defence',
  HEALING: 'healing',
  AOE: 'aoe',
  PASSIVE: 'passive',
  CONSUMABLE: 'consumable',
};

export const COOLDOWN_TYPES = {
  FIGHT_TURN: 'fight_turn',
  CHARACTER_TURN: 'character_turn',
};

export const ITEM_STATES = {
  BOUGHT: 'bought',
  FOR_SALE: 'forSale',
  LOCKED: 'locked',
};

export const CANVAS_WIDTH = 960;
export const CANVAS_HEIGHT = 640;

export const SPEED_LOSS_RATIO = 0.75;
export const ENERGY_CAP_RATIO = 0.1;
export const DEFAULT_ENERGY_GAIN = 1;
export const DEX_CRIT_RATIO = 0.02;
export const DEX_ENERGY_THRESHOLD = 100;
export const DEX_COOLDOWN_REDUCTION_INTERVAL = 35;
export const DEF_DAMAGE_REDUCTION_PER_TWO = 0.01;
export const GOLD_REWARD_RATIO = 0.2;
// How much stronger (stats, and therefore combat gold reward) an enemy gets
// per dungeon floor — additive, not compounding (e.g. floor 10 = 2.5x).
// Shared by StateManager.startCombat() (applies it to a fresh Enemy's
// stats) and ShopSystem's drop-only sell-price calculator (needs the
// floor-1 value to compute "gold+materials from killing 5 on floor 1").
export const ENEMY_STAT_SCALING_PER_FLOOR = 0.15;
export function enemyStatMultiplierForFloor(floor) {
  return 1 + ENEMY_STAT_SCALING_PER_FLOOR * floor;
}
export const FROST_MAX_STACKS = 25;
export const FROST_HIT_PENALTY = 0.03;
export const FROST_DAMAGE_BONUS = 0.01;
// Darkness (Vanguard of Darkness): -5% accuracy per stack, and a
// stacks*10% chance per attacker-turn-start for the inflicting side to
// steal 1 energy — see Character.getStat's accuracy branch and
// CombatManager.resolveEnemyTurn.
export const DARKNESS_ACCURACY_PENALTY = 0.05;
export const DARKNESS_ENERGY_STEAL_CHANCE_PER_STACK = 10;
export const THORNS_REFLECT_PER_STACK = 0.03;
export const LIFESTEAL_PER_STACK = 0.05;
export const FIRE_DECAY_RATIO = 0.35;
export const FIRE_DAMAGE_MULTIPLIER = 3;
