// Arena definitions. Each map is built from the same vocabulary of boxes but
// arranged on a different archetype, so the arenas ask for different movement
// and different fights:
//
//   CIRCUIT — single atrium ring, balanced cover, one raised core. Reads first.
//   SPIRE   — vertical jungle gym, stacked offset tiers around a tower.
//   RIFT    — open canyon, sparse cover, long sightlines over three lanes.
//   DUSTFALL— frontier main street between two rows of storefronts (WILD WEST).
//   GLACIER — frozen basin, staggered shelves and two high bridges (CRYO).
//
// Builders receive the World instance and use its solid()/wallRing()/horizonStrips()
// helpers; they only describe geometry, so the heavy merging stays in world.js.

export const MAPS = [
  {
    id: 'circuit',
    name: 'CIRCUIT',
    tag: 'SINGLE ATRIUM',
    blurb: 'Ring loop, raised core, even cover. The clean read.',
  },
  {
    id: 'spire',
    name: 'SPIRE',
    tag: 'VERTICAL',
    blurb: 'Stacked tiers around a tower. Fights jump between floors.',
  },
  {
    id: 'rift',
    name: 'RIFT',
    tag: 'CANYON',
    blurb: 'Long lanes and thin cover. Distance is the weapon.',
  },
  {
    id: 'dustfall',
    name: 'DUSTFALL',
    tag: 'FRONTIER STREET',
    blurb: 'A dusty main street with false-front stores. Hold the boardwalk.',
  },
  {
    id: 'glacier',
    name: 'GLACIER',
    tag: 'FROZEN BASIN',
    blurb: 'Broken ice shelves over a frozen well, crossed by two high bridges.',
  },
];

// --- single atrium: circular loop, central high ground, four floating decks
export function buildCircuit(w) {
  const std = { color: 0x111c30, edge: 0x3fe4ff, edgeOpacity: 0.4 };
  w.bounds = 43;
  w.wallRing(46, 18, { color: 0x0a1220, edge: 0x2ad4ff, edgeOpacity: 0.35 });
  w.horizonStrips(46, 15.5);

  // raised core plus two step-up blocks so it is climbable without a pad
  w.solid(0, 2.7, 0, 13, 0.75, 13, { ...std, cap: 0x1e8aa8, capOpacity: 0.3 });
  w.solid(0, 0, 0, 3.4, 2.7, 3.4, { color: 0x0d1626, edge: 0x2fbfe0, edgeOpacity: 0.3 });
  w.solid(-4.6, 1.35, 0, 3.2, 1.35, 3.2, std);
  w.solid(4.6, 1.35, 0, 3.2, 1.35, 3.2, std);

  for (const [x, z] of [[-9.5, -9.5], [9.5, -9.5], [-9.5, 9.5], [9.5, 9.5]]) {
    w.solid(x, 0, z, 4.4, 1.35, 4.4, std);
  }

  // mid cover, offset so no two blocks stack
  w.solid(-9.5, 0, 0, 3.4, 2.65, 2.2, { ...std, edge: 0xff4fd8, edgeOpacity: 0.25 });
  w.solid(9.5, 0, 0, 3.4, 2.65, 2.2, { ...std, edge: 0xff4fd8, edgeOpacity: 0.25 });
  w.solid(0, 0, -9.5, 2.2, 2.65, 3.4, std);
  w.solid(0, 0, 9.5, 2.2, 2.65, 3.4, std);

  // long strafe walls break the ring into two racing lines
  w.solid(-27, 0, 0, 1.5, 3.1, 20, { ...std, cap: 0x1a5f78 });
  w.solid(27, 0, 0, 1.5, 3.1, 20, { ...std, cap: 0x1a5f78 });

  for (const [x, z] of [[-19, -19], [19, -19], [-19, 19], [19, 19]]) {
    w.solid(x, 0, z, 1.8, 8.5, 1.8, { ...std, edge: 0xffc063, edgeOpacity: 0.22 });
  }

  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2;
    const r = 33;
    w.solid(Math.cos(a) * r, 0, Math.sin(a) * r, 2.4, i % 3 === 0 ? 4.4 : 2.4, 2.4, {
      ...std,
      edge: i % 2 ? 0x3fe4ff : 0xff4fd8,
      edgeOpacity: 0.28,
    });
  }

  const float = { color: 0x0f1a2b, edge: 0x63f5ff, edgeOpacity: 0.5, cap: 0x2fa5c4, capOpacity: 0.35 };
  w.solid(-20, 6.0, -22, 7.5, 0.6, 7.5, float);
  w.solid(20, 7.0, 20, 8, 0.6, 8, float);
  w.solid(0, 7.2, -27, 9, 0.6, 6, float);
  w.solid(-24, 7.6, 22, 6, 0.6, 6, { ...float, edge: 0xff4fd8 });

  w.solid(0, 0, 23, 16, 0.55, 6, { ...std, capOpacity: 0.18 });
  w.solid(0, 0, -23, 16, 0.55, 6, { ...std, capOpacity: 0.18 });

  w.padSpots = [[-33, -33], [33, -33], [-33, 33], [33, 33], [0, -36], [0, 36]];
  w.spawnAt = new w.V3(0, 1.2, 30);
  w.buildSpawns(37, 12);
  w.fogColor = 0x05070f;
  w.floorTint = 0xffffff;
}

// --- vertical jungle gym: tower, three offset tiers, pad-only high ring
export function buildSpire(w) {
  const std = { color: 0x101a2e, edge: 0x63f5ff, edgeOpacity: 0.38 };
  const hot = { ...std, edge: 0xff4fd8, edgeOpacity: 0.32 };
  w.bounds = 39;
  w.wallRing(41, 24, { color: 0x0a1020, edge: 0x2ad4ff, edgeOpacity: 0.32 });
  w.horizonStrips(41, 21);

  // central tower; its top is pad-only
  w.solid(0, 0, 0, 7, 13, 7, { color: 0x0d1626, edge: 0x2fbfe0, edgeOpacity: 0.34, cap: 0x1e8aa8, capOpacity: 0.3 });
  w.solid(0, 13, 0, 4.2, 0.6, 4.2, { ...hot, capOpacity: 0.4 });

  // tier 1 — four decks, each reachable with a 1.45 m step
  for (const [x, z] of [[-11, -11], [11, -11], [-11, 11], [11, 11]]) {
    w.solid(x, 2.2, z, 8, 0.55, 8, std);
    w.solid(x * 0.55, 1.1, z * 0.55, 3.2, 1.1, 3.2, std);
    w.solid(x, 0, z * 1.55, 3, 1.45, 3, std);
  }

  // tier 2 — catwalks between the decks
  w.solid(-17, 4.6, 0, 3, 0.5, 12, hot);
  w.solid(17, 4.6, 0, 3, 0.5, 12, hot);
  w.solid(0, 4.6, -17, 12, 0.5, 3, std);
  w.solid(0, 4.6, 17, 12, 0.5, 3, std);

  // tier 3 — high ring, pad or long jump only
  for (const [x, z] of [[-14, 0], [14, 0], [0, -14], [0, 14]]) {
    w.solid(x * 1.15, 8.4, z * 1.15, 4.6, 0.5, 4.6, { ...std, edge: 0xffc063, edgeOpacity: 0.4 });
  }
  w.solid(-8, 8.4, -8, 3.4, 0.5, 3.4, hot);
  w.solid(8, 8.4, 8, 3.4, 0.5, 3.4, hot);

  // cover pillars at different heights so every sightline is broken somewhere
  for (const [x, z, h] of [
    [-24, -24, 6], [24, -5, 4.2], [24, 20, 7], [-6, 26, 4.2],
    [-26, 8, 3.2], [7, -25, 5], [-18, 22, 3], [20, -20, 3.4],
  ]) {
    w.solid(x, 0, z, 2, h, 2, { ...std, edge: 0x3fe4ff, edgeOpacity: 0.26 });
  }

  w.solid(0, 0, 30, 22, 0.5, 5, std);
  w.solid(0, 0, -30, 22, 0.5, 5, std);

  w.padSpots = [[-29, 0], [29, 0], [0, -29], [0, 29], [-30, -30], [30, 30]];
  w.spawnAt = new w.V3(-20, 1.2, 22);
  w.buildSpawns(34, 14);
  w.fogColor = 0x060610;
  w.floorTint = 0xd8f2ff;
}

// --- canyon: three lanes, sparse low cover, two high bridges
export function buildRift(w) {
  const std = { color: 0x121a2a, edge: 0x3fe4ff, edgeOpacity: 0.34 };
  w.bounds = 47;
  w.wallRing(50, 20, { color: 0x0b1220, edge: 0x2ad4ff, edgeOpacity: 0.3 });
  w.horizonStrips(50, 17);

  // two long canyon walls make three lanes, with gaps you can fight through
  w.solid(-15, 0, 0, 2.2, 5.5, 44, { ...std, edge: 0xff4fd8, edgeOpacity: 0.26, cap: 0x1a5f78 });
  w.solid(15, 0, 0, 2.2, 5.5, 44, { ...std, edge: 0xff4fd8, edgeOpacity: 0.26, cap: 0x1a5f78 });
  w.solid(-15, 0, -26, 2.2, 2.2, 6, std);
  w.solid(15, 0, 26, 2.2, 2.2, 6, std);
  w.solid(-15, 0, 24, 2.2, 2.2, 6, std);
  w.solid(15, 0, -24, 2.2, 2.2, 6, std);

  // sparse low cover: enough to break a sightline, never enough to camp behind
  for (const [x, z, ww, dd, h] of [
    [-30, -12, 6, 2.2, 2.2],
    [-30, 14, 2.2, 8, 1.4],
    [30, -16, 2.2, 8, 1.4],
    [30, 10, 6, 2.2, 2.2],
    [-24, 30, 8, 2.2, 1.4],
    [24, -30, 8, 2.2, 1.4],
    [0, 38, 10, 2.2, 1.4],
    [0, -38, 10, 2.2, 1.4],
    [-40, 0, 3, 3, 3.2],
    [40, 0, 3, 3, 3.2],
  ]) {
    w.solid(x, 0, z, ww, h, dd, std);
  }

  // centre island: the only high ground in reach without a pad
  w.solid(0, 0, 0, 12, 0.6, 12, { ...std, cap: 0x1e8aa8, capOpacity: 0.26 });
  w.solid(-4, 0.6, 0, 2.4, 1.1, 2.4, std);
  w.solid(4, 0.6, 0, 2.4, 1.1, 2.4, std);

  // high bridges over the lanes, reachable only by pad
  w.solid(0, 5.4, -20, 30, 0.5, 3.2, { ...std, edge: 0xffc063, edgeOpacity: 0.35, capOpacity: 0.3 });
  w.solid(0, 5.4, 20, 30, 0.5, 3.2, { ...std, edge: 0xffc063, edgeOpacity: 0.35, capOpacity: 0.3 });

  w.padSpots = [[-38, -38], [38, 38], [-38, 38], [38, -38], [0, 44], [0, -44]];
  w.spawnAt = new w.V3(0, 1.2, 34);
  w.buildSpawns(42, 12);
  w.fogColor = 0x07050e;
  w.floorTint = 0xfff0e0;
}

// --- frontier town: one wide main street, storefronts either side, water tower
export function buildDustfall(w) {
  const plank = { color: 0x140f0a, edge: 0xffa63c, edgeOpacity: 0.32 };
  const roof = { ...plank, edge: 0xffd166, edgeOpacity: 0.26, cap: 0x8a5a1e, capOpacity: 0.3 };
  w.bounds = 44;
  w.wallRing(47, 15, { color: 0x0d0906, edge: 0xd9822b, edgeOpacity: 0.3 });
  w.horizonStrips(47, 12.5);

  // two rows of storefronts with a boardwalk in front of each
  for (const side of [-1, 1]) {
    for (let i = 0; i < 3; i++) {
      const z = -22 + i * 22;
      const h = 6.4 + i * 1.1;
      w.solid(side * 24, 0, z, 12, h, 14, i === 1 ? roof : plank);
      w.solid(side * 17.4, 0, z, 2.4, 0.55, 14, { ...plank, capOpacity: 0.16 });
      w.solid(side * 16.4, 0, z - 6, 0.5, 4.6, 0.5, { ...plank, edge: 0xffd166, edgeOpacity: 0.4 });
      w.solid(side * 16.4, 0, z + 6, 0.5, 4.6, 0.5, { ...plank, edge: 0xffd166, edgeOpacity: 0.4 });
    }
  }

  // saloon across the top of the street, on a raised porch
  w.solid(0, 0, -34, 30, 8.2, 8, { ...roof, cap: 0xa8702a, capOpacity: 0.34 });
  w.solid(0, 0, -28.4, 26, 0.6, 3.4, { ...plank, capOpacity: 0.2 });

  // water tower: four legs under a tank, the town's landmark
  for (const [x, z] of [[-32, 30], [-28, 30], [-32, 34], [-28, 34]]) {
    w.solid(x, 0, z, 0.7, 7.6, 0.7, { ...plank, edge: 0xffc063, edgeOpacity: 0.34 });
  }
  w.solid(-30, 7.6, 32, 6.4, 3.6, 6.4, { ...roof, cap: 0x9a6a2a, capOpacity: 0.4 });

  // wagons, crates and a low boardwalk break the street without closing it
  for (const [x, z, ww, dd, h] of [
    [-6, -12, 4.4, 2, 1.8],
    [7, 10, 3.2, 2, 1.4],
    [-8, 16, 2.4, 2.4, 1.1],
    [6, -20, 2.6, 2.6, 1.1],
    [0, 4, 8, 0.6, 0.5],
  ]) {
    w.solid(x, 0, z, ww, h, dd, plank);
  }

  // hitching rails
  for (const [x, z] of [[-14, -6], [14, 6], [-14, 22], [14, -22]]) {
    w.solid(x, 0, z, 5, 1.3, 0.6, { ...plank, edge: 0xffd166, edgeOpacity: 0.3 });
  }

  // the town well: the only cover in the middle of the street
  w.solid(0, 0, 0, 5, 1.2, 5, { ...roof, edge: 0xffd166, capOpacity: 0.24 });
  w.solid(0, 1.2, 0, 0.6, 4, 0.6, plank);

  w.padSpots = [[-34, -34], [34, 34], [-34, 34], [34, -34], [0, -40], [0, 40]];
  w.spawnAt = new w.V3(0, 1.2, 26);
  w.buildSpawns(38, 12);
  w.fogColor = 0x0a0603;
  w.floorTint = 0xffcf8a;
}

// --- cryo basin: broken ice shelves around a frozen well, two high bridges
export function buildGlacier(w) {
  const ice = { color: 0x0c1a24, edge: 0x9fe8ff, edgeOpacity: 0.34 };
  const shelf = { ...ice, cap: 0x4fb6d8, capOpacity: 0.28 };
  w.bounds = 45;
  w.wallRing(48, 22, { color: 0x08131c, edge: 0x6fd8f5, edgeOpacity: 0.3 });
  w.horizonStrips(48, 19);

  // four shelves at staggered heights, each with a step up from the ice floor
  for (const [x, z, h, ww, dd] of [
    [-20, -18, 2.4, 16, 12],
    [20, -16, 3.6, 14, 12],
    [20, 20, 2.4, 16, 14],
    [-22, 20, 1.4, 14, 12],
  ]) {
    w.solid(x, 0, z, ww, h, dd, h > 3 ? { ...shelf, edge: 0xd6f7ff, edgeOpacity: 0.4 } : shelf);
    const stepX = x + (x > 0 ? -ww / 2 - 1.6 : ww / 2 + 1.6);
    w.solid(stepX, 0, z, 3, Math.min(h, 1.4), 3, ice);
  }

  // frozen well in the middle, with the two bridges that cross the basin
  w.solid(0, 0, 0, 12, 1.8, 12, { ...shelf, cap: 0x63f5ff, capOpacity: 0.3 });
  w.solid(0, 1.8, 0, 3.4, 0.9, 3.4, ice);
  w.solid(0, 4.6, -18, 4, 0.5, 16, { ...shelf, edge: 0xd6f7ff, edgeOpacity: 0.42 });
  w.solid(0, 4.6, 18, 4, 0.5, 16, { ...shelf, edge: 0xd6f7ff, edgeOpacity: 0.42 });

  // spires: thin, tall, pale-edged. They break sightlines without giving cover
  for (const [x, z, h] of [
    [-32, 0, 6],
    [32, 0, 6],
    [-10, -32, 7],
    [10, 32, 7],
    [-30, -30, 9],
    [30, 30, 9],
    [34, -8, 4],
    [-34, 10, 4],
  ]) {
    w.solid(x, 0, z, 2.2, h, 2.2, {
      ...ice,
      edge: 0xd6f7ff,
      edgeOpacity: 0.38,
      cap: 0x63f5ff,
      capOpacity: 0.3,
    });
  }

  // low ice walls along the east and west lanes
  w.solid(-38, 0, 0, 2, 2.6, 26, { ...ice, edge: 0x9fe8ff, edgeOpacity: 0.26 });
  w.solid(38, 0, 0, 2, 2.6, 26, { ...ice, edge: 0x9fe8ff, edgeOpacity: 0.26 });

  w.padSpots = [[-40, -40], [40, 40], [-40, 40], [40, -40], [0, 42], [0, -42]];
  w.spawnAt = new w.V3(0, 1.2, 30);
  w.buildSpawns(40, 14);
  w.fogColor = 0x03080f;
  w.floorTint = 0xcfefff;
}

export const MAP_BUILDERS = {
  circuit: buildCircuit,
  spire: buildSpire,
  rift: buildRift,
  dustfall: buildDustfall,
  glacier: buildGlacier,
};
