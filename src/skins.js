// Gun skins and the crates that drop them.
//
// A skin belongs to exactly one gun and carries four colours, which are the
// same four material slots the event kits already paint (`body`, `dark`,
// `glow`, `accent`). Nothing here touches weapon stats: a skin is a finish,
// and a player who owns one can equip it without changing how the gun fights.
//
// Crates roll a rarity first, then a uniform skin inside that rarity, so the
// odds printed on the crate are the odds a player actually gets even when a
// rarity has only one or two finishes in that pool.

export const RARITIES = {
  common: {
    id: 'common',
    name: 'COMMON',
    color: '#9fb6c8',
    refund: 40,
    rank: 0,
  },
  rare: {
    id: 'rare',
    name: 'RARE',
    color: '#63f5ff',
    refund: 90,
    rank: 1,
  },
  epic: {
    id: 'epic',
    name: 'EPIC',
    color: '#c58cff',
    refund: 220,
    rank: 2,
  },
  legendary: {
    id: 'legendary',
    name: 'LEGENDARY',
    color: '#ffb347',
    refund: 500,
    rank: 3,
  },
};

export const RARITY_ORDER = ['common', 'rare', 'epic', 'legendary'];

export const GUNS = [
  { id: 'rifle', short: 'VX-9', name: 'VX-9 ARC RIFLE' },
  { id: 'breach', short: 'BR-12', name: 'BR-12 BREACHER' },
  { id: 'lance', short: 'LN-7', name: 'LN-7 LANCE' },
  { id: 'havoc', short: 'PR-4', name: 'PR-4 HAVOC' },
];

export const CRATES = [
  {
    id: 'basic',
    name: 'BASIC CRATE',
    tag: 'STANDARD ISSUE',
    price: 250,
    accent: '#9fb6c8',
    blurb: 'Common finishes with a rare upgrade and a sliver of epic. The cheap way in.',
    odds: { common: 72, rare: 26, epic: 2, legendary: 0 },
  },
  {
    id: 'normal',
    name: 'NORMAL CRATE',
    tag: 'FIELD SUPPLY',
    price: 600,
    accent: '#63f5ff',
    blurb: 'Better odds and better paint. Legendary finishes can appear here.',
    odds: { common: 38, rare: 44, epic: 16, legendary: 2 },
  },
  {
    id: 'quality',
    name: 'QUALITY CRATE',
    tag: 'MASTER WORK',
    price: 1400,
    accent: '#c58cff',
    blurb: 'No commons. Every roll is rare or better, with the best legendary odds.',
    odds: { common: 0, rare: 34, epic: 48, legendary: 18 },
  },
  {
    id: 'west',
    name: 'WEST CRATE',
    tag: 'EVENT · FRONTIER',
    price: 1100,
    accent: '#ffb347',
    blurb: 'Wild West finishes only: timber, brass and dust. Home of DESERT HAVOC.',
    odds: { common: 0, rare: 50, epic: 40, legendary: 10 },
  },
  {
    id: 'polar',
    name: 'POLAR CRATE',
    tag: 'EVENT · WHITEOUT',
    price: 1100,
    accent: '#9fe8ff',
    blurb: 'Polar finishes only: pale steel, ice glow and whiteout camo.',
    odds: { common: 0, rare: 50, epic: 40, legendary: 10 },
  },
];

// `crate` is the pool a skin drops from. Every skin names one gun, one crate
// and one rarity, and the colour set is the whole visual definition.
export const SKINS = [
  // ------------------------------------------------------------- standard
  skin('alloy', 'ALLOY', 'rifle', 'common', 'basic', 0x5b6b7a, 0x1b2430, 0xbcd9e8, 0x8fa6b8,
    'Bare steel and a cold bore. The first finish in every collection.'),
  skin('slate', 'SLATE', 'breach', 'common', 'basic', 0x4d5158, 0x1a1c20, 0xd8e2ea, 0xa0a8b4,
    'Matte grey panels that hide the muzzle smoke.'),
  skin('cobalt', 'COBALT', 'lance', 'common', 'basic', 0x27406e, 0x0d1730, 0x6fb8ff, 0xbfe4ff,
    'Deep blue housing with an ice-blue coil.'),
  skin('ash', 'ASH', 'havoc', 'common', 'basic', 0x4a4a46, 0x1b1b19, 0xffcf8a, 0xff8a3c,
    'Scorched grey, still warm from the last launch.'),
  skin('ember', 'EMBER', 'rifle', 'rare', 'basic', 0x6a2a1e, 0x260d08, 0xff7a3c, 0xffd0a0,
    'Burnt-orange furniture over a black receiver.'),
  skin('riptide', 'RIPTIDE', 'breach', 'rare', 'basic', 0x2b4a5e, 0x0d1e28, 0x63f5ff, 0xa8f4ff,
    'Wave-cut blue steel with a cyan shell rail.'),
  skin('violet-arc', 'VIOLET ARC', 'lance', 'rare', 'basic', 0x4a2a6a, 0x1a0f26, 0xc58cff, 0xecd6ff,
    'Purple anodised coils that bloom on every shot.'),
  skin('rustfire', 'RUSTFIRE', 'havoc', 'rare', 'basic', 0x6a3a1a, 0x2a1508, 0xffa63c, 0xffe0a8,
    'Weathered orange launcher with a brass drum.'),
  skin('signal', 'SIGNAL', 'rifle', 'rare', 'basic', 0x1f4a47, 0x0a1f1d, 0x63ffcf, 0xd8ffe9,
    'Teal field paint and a green running light.'),
  skin('nox', 'NOX', 'breach', 'epic', 'normal', 0x111318, 0x05060a, 0xb06bff, 0xff4fd8,
    'Blacked out, with a violet tube that gives the shooter away.'),
  skin('sunspot', 'SUNSPOT', 'lance', 'epic', 'normal', 0x7a4a12, 0x2a1806, 0xffd166, 0xfff3c4,
    'Amber rail housing, hot enough to read at range.'),
  skin('toxic', 'TOXIC', 'havoc', 'epic', 'normal', 0x2a3a1a, 0x0d1408, 0xa8ff3c, 0xe8ff9a,
    'Acid-green drum and a spill light that never turns off.'),
  skin('mirage', 'MIRAGE', 'rifle', 'epic', 'normal', 0x8a7355, 0x3a2c1c, 0xffd9a0, 0xfff0c8,
    'Desert-tan polymer that shimmers under the arena lights.'),
  skin('solar-flare', 'SOLAR FLARE', 'havoc', 'legendary', 'quality', 0x5a120a, 0x220604, 0xffb347, 0xfff0a0,
    'A red-hot launcher with a white-gold muzzle ring.'),
  skin('gilded', 'GILDED', 'lance', 'legendary', 'quality', 0x6a5418, 0x241c06, 0xffd166, 0xfff6c8,
    'Gold plate over black, with a coin-bright coil.'),
  skin('nightfall', 'NIGHTFALL', 'breach', 'legendary', 'quality', 0x0f1424, 0x04060c, 0x8a7bff, 0xdad4ff,
    'Midnight blue that turns almost black between shots.'),

  // ------------------------------------------------------------- west event
  skin('deadwood', 'DEADWOOD', 'rifle', 'rare', 'west', 0x6b4a2a, 0x241708, 0xffb347, 0xd9a066,
    'Sun-bleached timber and a brass sight.'),
  skin('six-shooter', 'SIX-SHOOTER', 'breach', 'rare', 'west', 0x5a3a22, 0x1f1209, 0xffc063, 0xffe4b0,
    'Worn walnut stock, hand-oiled and honest.'),
  skin('rattler', 'RATTLER', 'lance', 'rare', 'west', 0x7a5a1e, 0x2c1e06, 0xffd166, 0xf4e2b0,
    'Rattlesnake tan with a warning-yellow coil.'),
  skin('dust-devil', 'DUST DEVIL', 'havoc', 'rare', 'west', 0x8a6a3a, 0x2f220e, 0xffc063, 0xfff0d0,
    'Caked in trail dust, and still the loudest thing in town.'),
  skin('outrider', 'OUTRIDER', 'rifle', 'epic', 'west', 0x4a3a2a, 0x1a1208, 0xff8a3c, 0xffe0b0,
    'Scout-issue rifle with a campfire glow.'),
  skin('bandolier', 'BANDOLIER', 'lance', 'epic', 'west', 0x5a2a1a, 0x1f0c06, 0xffd166, 0xfff0c0,
    'Oxblood furniture banded in cartridge brass.'),
  skin('desert-havoc', 'DESERT HAVOC', 'havoc', 'epic', 'west', 0xa87f45, 0x3d2c16, 0xffd166, 0xfff0c0,
    'The one everybody wants: sand-blasted tan and a sun-gold muzzle.'),
  skin('gold-rush', 'GOLD RUSH', 'breach', 'legendary', 'west', 0xb08a2a, 0x3a2a06, 0xffd166, 0xfff6c8,
    'A shotgun that looks like it was paid for in nuggets.'),

  // ------------------------------------------------------------ polar event
  skin('frostbite', 'FROSTBITE', 'rifle', 'rare', 'polar', 0x5a7a8a, 0x1a2830, 0x9fe8ff, 0xdff6ff,
    'Pale arctic steel with a freezing bore light.'),
  skin('tundra', 'TUNDRA', 'breach', 'rare', 'polar', 0x6a7a86, 0x1f262c, 0xbfe6ff, 0xeaf7ff,
    'Grey-green field paint and a frosted shell rail.'),
  skin('icicle', 'ICICLE', 'lance', 'rare', 'polar', 0x3a6a8a, 0x0e1c28, 0x8fe4ff, 0xd6f7ff,
    'A blue coil that looks grown rather than machined.'),
  skin('blizzard', 'BLIZZARD', 'havoc', 'rare', 'polar', 0x5a6a7a, 0x1a2228, 0xd6f7ff, 0xffffff,
    'White-out launcher with a cold white drum light.'),
  skin('aurora', 'AURORA', 'rifle', 'epic', 'polar', 0x1f4a5a, 0x08141a, 0x63ffd8, 0xb06bff,
    'Green-to-violet bands that shift with the camera.'),
  skin('glacial', 'GLACIAL', 'lance', 'epic', 'polar', 0x2a4a6a, 0x0a1622, 0x9fe8ff, 0xffffff,
    'Deep ice-blue housing with a white-hot coil.'),
  skin('permafrost', 'PERMAFROST', 'havoc', 'epic', 'polar', 0x3a5a5a, 0x0e1a1a, 0x8fffe0, 0xd8fff4,
    'Frozen teal plates and a green core.'),
  skin('whiteout', 'WHITEOUT', 'breach', 'legendary', 'polar', 0xdfeff7, 0x4a5a66, 0xffffff, 0x9fe8ff,
    'Snow-white furniture with an ice-blue shell rail.'),
];

function skin(id, name, gun, rarity, crate, body, dark, glow, accent, blurb) {
  return { id, name, gun, rarity, crate, body, dark, glow, accent, blurb };
}

export const SKIN_BY_ID = new Map(SKINS.map((s) => [s.id, s]));
export const CRATE_BY_ID = new Map(CRATES.map((c) => [c.id, c]));
export const GUN_BY_ID = new Map(GUNS.map((g) => [g.id, g]));

export function cratePool(crateId) {
  return SKINS.filter((s) => s.crate === crateId);
}

export function skinsForGun(gunId) {
  return SKINS.filter((s) => s.gun === gunId);
}

export function crateOdds(crate) {
  const total = RARITY_ORDER.reduce((sum, id) => sum + (crate.odds[id] | 0), 0);
  if (total !== 100) return { ...crate.odds };
  return { ...crate.odds };
}

// Weighted rarity pick, then a uniform pick inside it. `roll` is injectable so
// the crate tests can drive exact outcomes instead of hoping for a drop.
export function rollSkin(crate, roll = Math.random) {
  const odds = crate.odds || {};
  const total = RARITY_ORDER.reduce((sum, id) => sum + Math.max(0, odds[id] | 0), 0);
  let pick = Math.min(0.999999, Math.max(0, Number(roll()) || 0)) * total;
  let rarity = 'common';
  for (const id of RARITY_ORDER) {
    pick -= Math.max(0, odds[id] | 0);
    if (pick < 0) {
      rarity = id;
      break;
    }
  }
  let pool = SKINS.filter((s) => s.crate === crate.id && s.rarity === rarity);
  if (!pool.length) pool = cratePool(crate.id);
  if (!pool.length) pool = SKINS;
  const at = Math.min(pool.length - 1, Math.floor((Number(roll()) || 0) * pool.length));
  return pool[at];
}

export function rarityOf(id) {
  return RARITIES[id] || RARITIES.common;
}
