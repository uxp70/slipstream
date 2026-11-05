import { MAPS } from './maps.js';

// Events bundle a themed arena with an enemy skin, a gun skin and an art
// direction. Picking one on the start screen swaps all of them at once, so an
// event reads as a different place to fight rather than a recoloured arena.
// Everything here is data: an enemy palette per type (plus an optional
// silhouette), four colours for the weapon materials, and the art block that
// repaints the level itself (see world.js: DEFAULT_ART for the full shape of
// it). Art is a deep merge over that default, so an event only states what it
// changes. The map -> event mapping must stay unambiguous, because a squad
// guest adopts the host's event from the arena it joins.
export const EVENTS = [
  {
    id: 'neon',
    name: 'NEON SIEGE',
    tag: 'CORE PLAYLIST',
    blurb: 'the three original arenas under the default chrome kit.',
    maps: ['circuit', 'spire', 'rift'],
    enemy: null,
    gun: null,
  },
  {
    id: 'frontier',
    name: 'FRONTIER',
    tag: 'WILD WEST',
    blurb: 'dust, brass and long barrels. Outlaw drones hold the main street.',
    maps: ['dustfall'],
    enemy: {
      drifter: { color: 0xffb347, emissive: 0x7a3c07, shape: 'octa' },
      skitter: { color: 0xff6b3d, emissive: 0x8c2208, shape: 'tetra' },
      sentry: { color: 0xd9a066, emissive: 0x5a3410, shape: 'box' },
    },
    gun: { body: 0x8a5a34, dark: 0x3c2617, glow: 0xffb347, accent: 0xffd166 },
    // Sun-bleached timber, tin roofs and dust haze. The palette is the one
    // period photography lands on: deep amber, burnt sienna, charcoal and bone.
    // Bodies are painted over the map's neon colours, the additive edge glow is
    // replaced by dark shadow lines, and the glowing caps become solid roofs, so
    // the arena stops reading as a wireframe and starts reading as a place.
    art: {
      exposure: 1.0,
      bloom: { strength: 0.1, radius: 0.35, threshold: 1.0 },
      fog: { color: 0xdcbf93, density: 0.0088 },
      sky: { top: 0x27548c, bottom: 0xefc994, horizon: 0xffb573, horizonPower: 4.5, haze: 0.6, stars: 0 },
      light: {
        hemi: { sky: 0xdde8f4, ground: 0x7c5838, intensity: 0.92 },
        key: { color: 0xfff2d6, intensity: 2.5, pos: [38, 44, -26] },
        rim: { color: 0xffb072, intensity: 0.55, pos: [-44, 26, 30] },
        fill: { color: 0xa9c2d8, intensity: 0.3, pos: [0, 20, 60] },
        core: { color: 0xffd7a0, intensity: 0 },
      },
      bodyEmissive: 0x000000,
      // the map is authored in neon colours; these are the roles they play here
      bodies: {
        paint: {
          0x140f0a: 0x8a7355, // sawn timber walls
          0x1a1a14: 0xb3a184, // sun-bleached boardwalk
          0x0d0906: 0x6d5a42, // the stockade edge of town
          0x1b2a42: 0x7d6a50,
          0x3a2a20: 0xc0ac86, // bone-painted false front
          0x2a3a30: 0x8b9a8c, // sage-painted false front
          0x3a2020: 0xa87a63, // faded red false front
        },
      },
      edges: {
        additive: false,
        opacity: 0.5,
        paint: { 0xffa63c: 0x2e2418, 0xffd166: 0x241b12, 0xd9822b: 0x2a2118, 0xffc063: 0x2e2418, 0x4fe6ff: 0x2a2118 },
      },
      caps: {
        additive: false,
        opacity: 1,
        solid: true,
        paint: { 0x8a5a1e: 0x8d8b84, 0xa8702a: 0x9a938a, 0x9a6a2a: 0x837d74, 0x2ba9c4: 0x8d8b84, 0x6b4a2a: 0x6f563a },
      },
      strips: { color: 0x6b5334, opacity: 0.9, additive: false },
      ground: { texture: 'dirt', color: 0xffffff, repeat: 16 },
      decor: 0x9a7a58,
      pads: { disc: 0x2a1a0a, emissive: 0xffa63c, emissiveIntensity: 1.0, ring: 0xffc063, column: 0xffa63c },
    },
  },
  {
    id: 'whiteout',
    name: 'WHITEOUT',
    tag: 'CRYO BREACH',
    blurb: 'a frozen basin. Pale shells, ice-cut rifles, thin air.',
    maps: ['glacier'],
    enemy: {
      drifter: { color: 0x9fe8ff, emissive: 0x1d5f7a, shape: 'ico' },
      skitter: { color: 0xd6f7ff, emissive: 0x2b7f9c, shape: 'octa' },
      sentry: { color: 0x7fb8ff, emissive: 0x1b3f7a, shape: 'dodeca' },
    },
    gun: { body: 0x9fb6c8, dark: 0x2a3644, glow: 0x9fe8ff, accent: 0xd6f7ff },
    // Overcast polar light: flat pale ice, no neon, no stars, thin snowfall haze.
    art: {
      exposure: 1.02,
      bloom: { strength: 0.2, radius: 0.4, threshold: 0.95 },
      fog: { color: 0xd6e8f2, density: 0.0105 },
      sky: { top: 0x8fb2cc, bottom: 0xeaf5fb, horizon: 0xf4fcff, horizonPower: 6, haze: 0.8, stars: 0 },
      light: {
        hemi: { sky: 0xeaf6ff, ground: 0x94aab9, intensity: 1.0 },
        key: { color: 0xf2faff, intensity: 1.9, pos: [26, 50, 30] },
        rim: { color: 0xbfe6ff, intensity: 0.5, pos: [-40, 28, -35] },
        fill: { color: 0xd6eefc, intensity: 0.35, pos: [0, 18, 50] },
        core: { color: 0xbfeaff, intensity: 0 },
      },
      bodyEmissive: 0x0a1620,
      bodies: { paint: { 0x0c1a24: 0xa9c9d8, 0x08131c: 0x8fb2c4, 0x1b2a42: 0x9dbece } },
      edges: {
        additive: false,
        opacity: 0.45,
        paint: { 0x9fe8ff: 0x5c7f92, 0x6fd8f5: 0x547c8d, 0xd6f7ff: 0x6f93a4, 0x2ad4ff: 0x547c8d },
      },
      caps: {
        additive: false,
        opacity: 1,
        solid: true,
        paint: { 0x4fb6d8: 0xdfeff7, 0x63f5ff: 0xe8f7fc, 0x2ba9c4: 0xdfeff7 },
      },
      strips: { color: 0xdff1fa, opacity: 0.85, additive: false },
      ground: { texture: 'snow', color: 0xffffff, repeat: 10 },
      decor: 0xb9d3e0,
      pads: { disc: 0x0e2230, emissive: 0x8fe4ff, emissiveIntensity: 1.1, ring: 0xcdf3ff, column: 0xbfeaff },
    },
  },
];

export function eventById(id) {
  return EVENTS.find((e) => e.id === id) || EVENTS[0];
}

export function eventForMap(mapId) {
  return EVENTS.find((e) => e.maps.includes(mapId)) || EVENTS[0];
}

// The art direction a given arena is rendered with, merged over world.js's
// default so an event never has to restate the neon baseline.
export function artForMap(mapId) {
  return eventForMap(mapId).art || null;
}

const GUN_SLOTS = new Set(['body', 'dark', 'glow', 'accent']);

// Recolour the merged viewmodel materials in place. The first colour each
// material was built with is remembered, so the default event restores the
// original kit exactly instead of drifting toward whatever was applied last.
export function applyGunSkin(models, skin) {
  for (const model of models || []) {
    model.group.traverse((obj) => {
      const mat = obj.material;
      if (!mat || !GUN_SLOTS.has(mat.name)) return;
      if (mat.userData.baseColor === undefined) mat.userData.baseColor = mat.color.getHex();
      const next = skin && skin[mat.name] != null ? skin[mat.name] : mat.userData.baseColor;
      mat.color.setHex(next);
    });
  }
}

const EVENT_KEY = 'slipstream.event';

// Owns the start-screen pickers and the skin swap. main.js only forwards the
// arena it just built (noteMap), so the event follows a squad host's map without
// any extra network message.
export class EventDirector {
  constructor(game) {
    this.game = game;
    this.id = eventById(readString(EVENT_KEY, EVENTS[0].id)).id;
    this.cardsEl = document.getElementById('event-cards');
    this.mapsEl = document.getElementById('map-cards');
    this.blurbEl = document.getElementById('event-blurb');

    this.cardsEl?.addEventListener('click', (e) => this.onClick(e, 'event'));
    this.mapsEl?.addEventListener('click', (e) => this.onClick(e, 'map'));
  }

  get event() {
    return eventById(this.id);
  }

  onClick(e, kind) {
    const el = e.target.closest(kind === 'event' ? '[data-event]' : '[data-map]');
    if (!el) return;
    e.stopPropagation();
    this.game.audio.init();
    this.game.audio.ui();
    if (kind === 'event') this.select(el.dataset.event);
    else this.game.selectMap(el.dataset.map);
  }

  // boot: adopt the stored event, then make sure the stored arena belongs to it
  init() {
    const ev = this.event;
    this.apply(ev);
    if (!ev.maps.includes(this.game.mapId)) this.game.mapId = ev.maps[0];
    this.render();
  }

  select(id) {
    const ev = eventById(id);
    if (ev.id === this.id) return;
    this.id = ev.id;
    store(EVENT_KEY, ev.id);
    this.apply(ev);
    // the arena cards change with the event, so move to one of its maps
    if (!ev.maps.includes(this.game.mapId)) this.game.selectMap(ev.maps[0]);
    else this.render();
  }

  // called by Game.selectMap: the arena decides the event
  noteMap(mapId) {
    const owner = eventForMap(mapId);
    if (owner.id !== this.id) {
      this.id = owner.id;
      this.apply(owner);
    }
    this.render();
  }

  apply(ev) {
    const g = this.game;
    g.eventId = ev.id;
    g.enemies.setSkin(ev.enemy || null);
    applyGunSkin(g.weapons.models, ev.gun || null);
    if (this.blurbEl) this.blurbEl.textContent = `${ev.name} — ${ev.blurb}`;
  }

  render() {
    const ev = this.event;
    if (this.cardsEl) {
      this.cardsEl.innerHTML = EVENTS.map(
        (e) =>
          `<button type="button" class="event-card${e.id === ev.id ? ' sel' : ''}" data-event="${e.id}">` +
          `<b>${e.name}</b><span>${e.tag}</span></button>`
      ).join('');
    }
    if (this.mapsEl) {
      this.mapsEl.innerHTML = ev.maps
        .map((id) => {
          const m = MAPS.find((x) => x.id === id);
          if (!m) return '';
          const sel = m.id === this.game.mapId ? ' sel' : '';
          return `<button type="button" class="map-card${sel}" data-map="${m.id}"><b>${m.name}</b><span>${m.tag}</span></button>`;
        })
        .join('');
    }
  }
}

function readString(key, fallback) {
  try {
    return localStorage.getItem(key) || fallback;
  } catch {
    return fallback;
  }
}

function store(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* storage can be blocked; the event just won't persist */
  }
}
