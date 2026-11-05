import { MAPS } from './maps.js';

// Events bundle a themed arena with an enemy skin and a gun skin. Picking one on
// the start screen swaps all three at once, so an event reads as a different
// place to fight rather than a recoloured arena. Everything here is data: an
// enemy palette per type (plus an optional silhouette), and four colours for the
// weapon materials. The map -> event mapping must stay unambiguous, because a
// squad guest adopts the host's event from the arena it joins.
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
    gun: { body: 0x5a3a22, dark: 0x2b1a10, glow: 0xffb347, accent: 0xffd166 },
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
  },
];

export function eventById(id) {
  return EVENTS.find((e) => e.id === id) || EVENTS[0];
}

export function eventForMap(mapId) {
  return EVENTS.find((e) => e.maps.includes(mapId)) || EVENTS[0];
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
