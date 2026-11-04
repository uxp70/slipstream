// Arena definitions. Each map is built from the same vocabulary of boxes but
// arranged on a different archetype, so the three arenas ask for different
// movement and different fights:
//
//   CIRCUIT — single atrium ring, balanced cover, one raised core. Reads first.
//   SPIRE   — vertical jungle gym, stacked offset tiers around a tower.
//   RIFT    — open canyon, sparse cover, long sightlines over three lanes.
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

export const MAP_BUILDERS = {
  circuit: buildCircuit,
  spire: buildSpire,
  rift: buildRift,
};
