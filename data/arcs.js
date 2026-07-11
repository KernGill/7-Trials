export const ARCS = {
  arc0: {
    id: 'arc0',
    index: 0,
    name: 'Arc 0 — The First Trial',
    description: 'Basic mobs and starter equipment.',
    bossFloor: 10,
    tilesPerFloor: 50,
    enemiesPerFloor: 3,
    enemyPool: ['indebted_fallen', 'the_hollowed'],
    bossId: 'indebted_fallen_boss',
    shopTier: 'arc0',
    startFloor: 1,
  },
  arc1: {
    id: 'arc1',
    index: 1,
    name: 'Arc 1',
    description: 'Placeholder for future content.',
    bossFloor: 20,
    tilesPerFloor: 50,
    enemiesPerFloor: 3,
    enemyPool: ['the_hollowed'],
    bossId: 'the_hollowed_boss',
    shopTier: 'arc1',
    startFloor: 11,
    locked: true,
  },
  arc2: {
    id: 'arc2',
    index: 2,
    name: 'Arc 2',
    description: 'Placeholder for future content.',
    bossFloor: 30,
    tilesPerFloor: 50,
    enemiesPerFloor: 3,
    enemyPool: [],
    bossId: null,
    shopTier: 'arc2',
    startFloor: 21,
    locked: true,
    unlocksInn: true,
  },
};

export function getArcConfig(arcIndex) {
  return Object.values(ARCS).find((arc) => arc.index === arcIndex) ?? ARCS.arc0;
}

export function getArcById(arcId) {
  return ARCS[arcId] ?? ARCS.arc0;
}
