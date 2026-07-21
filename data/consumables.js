export const CONSUMABLES = {
  minor_potion: {
    id: 'minor_potion',
    name: 'Minor Potion',
    flavour: 'A simple healing remedy.',
    price: { gold: 30 },
    unlock: null,
    explorationEffect: { healMaxPercent: 20, party: true },
    combatEffect: { healMaxPercent: 30 },
    moveId: 'minor_potion_move',
    visual: { shape: 'square', color: '#e74c3c', spriteId: 'minor_potion' },
  },
  strength_elixir: {
    id: 'strength_elixir',
    name: 'Strength Elixir',
    flavour: 'A brew that sharpens muscle and nerve.',
    price: { gold: 100 },
    unlock: null,
    explorationEffect: { buff: { type: 'stat', stat: 'str', amount: 5, duration: -1 }, party: true },
    combatEffect: { buff: { type: 'stat', stat: 'str', amount: 10, duration: -1 } },
    moveId: 'strength_elixir_move',
    visual: { shape: 'square', color: '#f39c12', spriteId: 'strength_elixir' },
  },
  soul_bomb: {
    id: 'soul_bomb',
    name: 'Soul Bomb',
    flavour: 'Death spreads to all life.',
    price: { gold: 500, materials: { mana_stone: 1, bones: 5, flesh: 3, jar_of_spores: 2 } },
    unlock: null,
    explorationEffect: { buff: { effect: 'statusReflection', stacks: 3 }, party: true, noStack: true },
    combatEffect: { debuff: { effect: 'frostbite', stacks: 1 } },
    moveId: 'soul_bomb_move',
    visual: { shape: 'square', color: '#2d3436', spriteId: 'soul_bomb' },
  },
};

export function getConsumableConfig(id) {
  return CONSUMABLES[id] ?? null;
}

export function getShopConsumables() {
  return Object.values(CONSUMABLES);
}
