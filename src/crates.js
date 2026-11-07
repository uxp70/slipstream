import {
  SKINS,
  CRATES,
  CRATE_BY_ID,
  SKIN_BY_ID,
  RARITIES,
  GUNS,
  GUN_BY_ID,
  rollSkin,
} from './skins.js';
import { WEAPONS } from './weapon.js';
import { applyGunSkin } from './events.js';
import './crates.css';

const OWNED_KEY = 'slipstream.skins';
const EQUIP_KEY = 'slipstream.skins.equip';

// Crates are a pure cosmetics economy: coins go in, a finish comes out, and a
// duplicate pays part of its rarity back. A skin only ever fits one gun, so the
// collection is a set of per-gun loadouts rather than a single global paint.
export class Crates {
  constructor(game) {
    this.game = game;
    // the panel and the camera rows are injected here, so the feature ships as
    // a module + stylesheet without requiring a hand edit of index.html
    this.ensureDom();
    this.screen = document.getElementById('screen-crates');
    this.coinsEl = document.getElementById('crate-coins');
    this.ownedEl = document.getElementById('crate-owned');
    this.gridEl = document.getElementById('crate-grid');
    this.stageEl = document.getElementById('crate-stage');
    this.stageTitleEl = document.getElementById('crate-stage-title');
    this.reelMask = document.getElementById('crate-reel-mask');
    this.reelEl = document.getElementById('crate-reel');
    this.resultEl = document.getElementById('crate-result');
    this.statusEl = document.getElementById('crate-status');
    this.filtersEl = document.getElementById('skin-filters');
    this.skinsEl = document.getElementById('skin-grid');
    this.summaryEl = document.getElementById('crates-summary');

    this.owned = new Set(readOwned(this.key(OWNED_KEY)));
    this.equipped = readEquipped(this.key(EQUIP_KEY), this.owned);
    this.filter = 'all';
    this.rolling = false;
    this.pending = null;
    this.lastRoll = null;
    this.reelTimer = null;
    this.rng = Math.random;
    this.statusText = 'OPEN A CRATE · DUPLICATES PAY COINS BACK · SKINS FIT ONE GUN';

    document.getElementById('btn-crates')?.addEventListener('click', (e) => {
      e.stopPropagation();
      game.audio.init();
      game.audio.ui();
      this.show();
    });
    document.getElementById('btn-crates-back')?.addEventListener('click', (e) => {
      e.stopPropagation();
      game.audio.ui();
      this.close();
    });

    this.gridEl?.addEventListener('click', (e) => {
      const el = e.target.closest('[data-crate]');
      if (!el) return;
      e.stopPropagation();
      this.open(el.dataset.crate);
    });

    this.skinsEl?.addEventListener('click', (e) => {
      const el = e.target.closest('[data-skin]');
      if (!el) return;
      e.stopPropagation();
      this.equip(el.dataset.skin);
    });

    this.filtersEl?.addEventListener('click', (e) => {
      const el = e.target.closest('[data-skin-filter]');
      if (!el) return;
      e.stopPropagation();
      this.filter = el.dataset.skinFilter;
      this.game.audio.ui();
      this.renderFilters();
      this.renderCollection();
    });

    this.resultEl?.addEventListener('click', (e) => {
      const equip = e.target.closest('[data-equip-last]');
      if (equip) {
        e.stopPropagation();
        if (this.lastRoll) this.equip(this.lastRoll.skinId);
      }
    });

    window.addEventListener('keydown', (e) => {
      if (e.code !== 'Escape' || !this.isOpen()) return;
      this.close();
    });

    this.hookEvents();
    this.paint();
  }

  // Build the screen and the three control rows if they are not in the page.
  // Existing markup is left alone, so a hand-authored screen still wins.
  ensureDom() {
    if (!document.getElementById('screen-crates')) {
      const screen = document.createElement('div');
      screen.id = 'screen-crates';
      screen.className = 'screen hidden';
      screen.innerHTML =
        '<div class="panel wide crate-panel">' +
        '<div class="eyebrow">SUPPLY · SKIN CRATES</div>' +
        '<h2>CRATES</h2>' +
        '<div class="coin-line">COINS <b id="crate-coins">0</b> <span id="crate-owned">0 / 0 SKINS</span></div>' +
        '<div class="crate-grid" id="crate-grid"></div>' +
        '<div class="crate-stage hidden" id="crate-stage">' +
        '<div class="crate-stage-head" id="crate-stage-title">OPENING CRATE</div>' +
        '<div class="reel-mask" id="crate-reel-mask"><div class="reel" id="crate-reel"></div></div>' +
        '<div class="crate-result" id="crate-result"></div>' +
        '</div>' +
        '<div class="skin-head"><span>COLLECTION</span><div class="skin-filters" id="skin-filters"></div></div>' +
        '<div class="skin-grid" id="skin-grid"></div>' +
        '<div class="map-blurb" id="crate-status">OPEN A CRATE · DUPLICATES PAY COINS BACK · SKINS FIT ONE GUN</div>' +
        '<button id="btn-crates-back" class="cta small">BACK</button>' +
        '</div>';
      document.body.insertBefore(screen, document.getElementById('screen-daily') || null);
    }

    const start = document.getElementById('screen-start');
    if (start && !start.querySelector('[data-view]')) {
      const qualityRow = start.querySelector('[data-quality]')?.closest('.graphics-row');
      qualityRow?.insertAdjacentHTML(
        'afterend',
        '<div class="graphics-row view-row">' +
          '<span class="picker-label">CAMERA</span>' +
          '<button type="button" class="qbtn sel" data-view="first">FIRST PERSON</button>' +
          '<button type="button" class="qbtn" data-view="third">THIRD PERSON</button>' +
          '</div>'
      );
      const arsenalRow = document.getElementById('btn-arsenal')?.closest('.graphics-row');
      arsenalRow?.insertAdjacentHTML(
        'afterend',
        '<div class="graphics-row">' +
          '<span class="picker-label">SKINS</span>' +
          '<button type="button" class="qbtn" id="btn-crates">CRATES</button>' +
          '<span id="crates-summary">0 / 0 SKINS · 0 EQUIPPED</span>' +
          '</div>'
      );
    }

    const pause = document.getElementById('screen-pause');
    if (pause && !pause.querySelector('[data-view]')) {
      pause.querySelector('.settings')?.insertAdjacentHTML(
        'beforeend',
        '<div class="settings-row">' +
          '<span>CAMERA</span>' +
          '<div class="view-toggle">' +
          '<button type="button" class="qbtn sel" data-view="first">FIRST PERSON</button>' +
          '<button type="button" class="qbtn" data-view="third">THIRD PERSON</button>' +
          '</div></div>'
      );
    }
  }

  // Personal finishes must survive every event repaint. The event director is
  // wrapped here rather than edited, so the base kit keeps owning its palette
  // and this layer only overrides the guns the player has actually equipped.
  hookEvents() {
    const events = this.game.events;
    if (!events || events.__cratesHooked) return;
    const original = events.apply.bind(events);
    events.apply = (ev) => {
      original(ev);
      if (this.game.avatar) applyGunSkin(this.game.avatar.guns, ev.gun || null);
      this.applyEquipped();
    };
    events.__cratesHooked = true;
  }

  key(base) {
    return this.game.account ? this.game.account.storageKey(base) : base;
  }

  reload() {
    this.owned = new Set(readOwned(this.key(OWNED_KEY)));
    this.equipped = readEquipped(this.key(EQUIP_KEY), this.owned);
    this.lastRoll = null;
    // repaint from the event kit first, so the previous operator's finish does
    // not linger on a gun the new one has not equipped anything on
    if (this.game.events) this.game.events.apply(this.game.events.event);
    else this.applyEquipped();
    this.paint();
    return this;
  }

  isOpen() {
    return !!this.screen && !this.screen.classList.contains('hidden');
  }

  // the panel is `show` because `open` is the crate roll itself
  show() {
    this.paint();
    this.screen?.classList.remove('hidden');
  }

  close() {
    if (this.rolling) return;
    this.screen?.classList.add('hidden');
  }

  wallet() {
    return this.game.armory ? this.game.armory.coins : 0;
  }

  // charges the same wallet the armory uses, and repaints it in place
  charge(price) {
    const armory = this.game.armory;
    if (!armory || armory.coins < price) return false;
    armory.coins -= price;
    armory.save();
    armory.paint();
    return true;
  }

  setStatus(text) {
    this.statusText = text;
    if (this.statusEl) this.statusEl.textContent = text;
  }

  // --------------------------------------------------------------- opening
  // `instant` skips the reel for tests and for a player who already watched the
  // animation; the economy and the result are identical either way.
  open(crateId, { instant = false } = {}) {
    if (this.rolling) return { ok: false, reason: 'busy' };
    const crate = CRATE_BY_ID.get(crateId);
    if (!crate) return { ok: false, reason: 'unknown' };
    const price = crate.price;
    if (this.wallet() < price) {
      this.setStatus(`NEED ${price - this.wallet()} MORE COINS FOR THE ${crate.name}`);
      this.game.audio.ui();
      return { ok: false, reason: 'coins', price };
    }

    const skin = rollSkin(crate, this.rng);
    const duplicate = this.owned.has(skin.id);
    if (!duplicate) this.owned.add(skin.id);
    const refund = duplicate ? RARITIES[skin.rarity].refund : 0;

    // the wallet is always charged in full, then a duplicate pays part back
    this.charge(price);
    if (refund > 0) this.game.armory.earn(refund);

    this.save();
    this.lastRoll = {
      crateId: crate.id,
      skinId: skin.id,
      gun: skin.gun,
      rarity: skin.rarity,
      duplicate,
      refund,
      price,
      at: Date.now(),
    };
    this.setStatus(
      duplicate
        ? `${skin.name} IS ALREADY OWNED · +${refund} COINS SALVAGED`
        : `${skin.name} ADDED TO THE COLLECTION · ${price} COINS SPENT`
    );
    this.paint();
    this.game.audio.uiConfirm();
    this.showStage(crate, skin, duplicate, refund, instant);

    if (instant) return this.lastRoll;
    this.pending = new Promise((resolve) => {
      this._resolve = resolve;
    });
    return this.pending;
  }

  showStage(crate, skin, duplicate, refund, instant) {
    if (!this.stageEl || !this.reelEl) return;
    this.stageEl.classList.remove('hidden', 'revealed');
    if (this.stageTitleEl) this.stageTitleEl.textContent = `OPENING ${crate.name}`;
    if (this.resultEl) this.resultEl.innerHTML = '';

    const pool = SKINS.filter((s) => s.crate === crate.id);
    const winnerAt = 28;
    const cards = [];
    for (let i = 0; i < 36; i++) {
      const pick = i === winnerAt ? skin : pool[Math.floor(this.rng() * pool.length)] || skin;
      cards.push(
        `<div class="reel-card rarity-${pick.rarity}">` +
          `<i>${RARITIES[pick.rarity].name}</i>` +
          `<b>${pick.name}</b>` +
          `<span>${GUN_BY_ID.get(pick.gun).short} · ${GUN_BY_ID.get(pick.gun).name.split(' ')[0]}</span>` +
          '</div>'
      );
    }
    this.reelEl.innerHTML = cards.join('');

    if (instant) {
      this.reelEl.style.transition = 'none';
      this.reelEl.style.transform = 'translateX(0)';
      this.finishRoll(duplicate, refund);
      return;
    }

    this.rolling = true;
    this.stageEl.classList.add('rolling');
    this.reelEl.style.transition = 'none';
    this.reelEl.style.transform = 'translateX(0)';
    void this.reelEl.offsetWidth;

    const step = 132;
    const mask = this.reelMask?.clientWidth || 520;
    const offset = winnerAt * step + step / 2 - mask / 2 + (this.rng() * 40 - 20);
    this.reelEl.style.transition = 'transform 3.2s cubic-bezier(0.12, 0.66, 0.09, 1)';
    this.reelEl.style.transform = `translateX(${-Math.max(0, offset)}px)`;

    clearTimeout(this.reelTimer);
    this.reelTimer = setTimeout(() => this.finishRoll(duplicate, refund), 3300);
  }

  finishRoll(duplicate, refund) {
    this.rolling = false;
    this.stageEl?.classList.remove('rolling');
    this.stageEl?.classList.add('revealed');
    this.renderResult(duplicate, refund);
    this.game.audio.pickup();
    const resolve = this._resolve;
    this._resolve = null;
    this.pending = null;
    if (resolve) resolve(this.lastRoll);
  }

  renderResult(duplicate, refund) {
    if (!this.resultEl || !this.lastRoll) return;
    const skin = SKIN_BY_ID.get(this.lastRoll.skinId);
    if (!skin) return;
    const rarity = RARITIES[skin.rarity];
    const equipped = this.equipped[skin.gun] === skin.id;
    const note = duplicate
      ? `DUPLICATE · +${refund} COINS SALVAGED`
      : 'NEW FINISH ADDED TO YOUR COLLECTION';
    this.resultEl.innerHTML =
      `<div class="result-card rarity-${skin.rarity}">` +
      `<div class="result-rarity">${rarity.name}</div>` +
      `<div class="result-name">${skin.name}</div>` +
      `<div class="result-gun">${GUN_BY_ID.get(skin.gun).name}</div>` +
      swatch(skin) +
      `<div class="result-note">${note}</div>` +
      (equipped ? '<div class="result-eq">EQUIPPED</div>' : '<button type="button" class="qbtn" data-equip-last>EQUIP ON ' + GUN_BY_ID.get(skin.gun).short + '</button>') +
      '</div>';
  }

  // ------------------------------------------------------------- collection
  equip(skinId) {
    const skin = SKIN_BY_ID.get(skinId);
    if (!skin || !this.owned.has(skin.id)) return { ok: false, reason: 'locked' };
    const current = this.equipped[skin.gun] === skin.id;
    this.equipped[skin.gun] = current ? null : skin.id;
    this.save();
    // repaint through the event director so unequipping restores the event kit
    if (this.game.events) this.game.events.apply(this.game.events.event);
    else this.applyEquipped();
    this.paint();
    this.renderResult(!!this.lastRoll?.duplicate, this.lastRoll?.refund || 0);
    this.game.audio.uiConfirm();
    this.setStatus(
      current
        ? `${GUN_BY_ID.get(skin.gun).short} RETURNED TO THE EVENT FINISH`
        : `${skin.name} EQUIPPED ON ${GUN_BY_ID.get(skin.gun).short}`
    );
    return { ok: true, equipped: this.equipped[skin.gun] };
  }

  // Paint the personal finish over the event kit. Only equipped guns are
  // touched, so an event's own palette still shows on everything else.
  applyEquipped() {
    const paint = (models) => {
      if (!models) return;
      WEAPONS.forEach((def, i) => {
        const id = this.equipped[def.id];
        const skin = id ? SKIN_BY_ID.get(id) : null;
        if (skin && models[i]) applyGunSkin([models[i]], skin);
      });
    };
    paint(this.game.weapons?.models);
    paint(this.game.avatar?.guns);
  }

  equippedCount() {
    return Object.values(this.equipped).filter(Boolean).length;
  }

  // -------------------------------------------------------------------- paint
  paint() {
    const wallet = this.wallet().toLocaleString('en-US');
    if (this.coinsEl) this.coinsEl.textContent = wallet;
    if (this.ownedEl) this.ownedEl.textContent = `${this.owned.size} / ${SKINS.length} SKINS`;
    if (this.summaryEl) {
      this.summaryEl.textContent = `${this.owned.size} / ${SKINS.length} SKINS · ${this.equippedCount()} EQUIPPED`;
    }
    if (this.statusEl) this.statusEl.textContent = this.statusText;
    this.renderCrates();
    this.renderFilters();
    this.renderCollection();
  }

  renderCrates() {
    if (!this.gridEl) return;
    const wallet = this.wallet();
    this.gridEl.innerHTML = CRATES.map((crate) => {
      const poor = wallet < crate.price;
      const odds = Object.keys(crate.odds)
        .filter((id) => crate.odds[id] > 0)
        .map((id) => `${RARITIES[id].name.slice(0, 1)}${crate.odds[id]}%`)
        .join(' · ');
      return (
        `<button type="button" class="crate-card${poor ? ' poor' : ''}" data-crate="${crate.id}" style="--crate-accent:${crate.accent}">` +
        `<div class="crate-head"><b>${crate.name}</b><i>${crate.price} COINS</i></div>` +
        `<span class="crate-tag">${crate.tag}</span>` +
        `<div class="crate-blurb">${crate.blurb}</div>` +
        `<span class="crate-odds">${odds}</span>` +
        '</button>'
      );
    }).join('');
  }

  renderFilters() {
    if (!this.filtersEl) return;
    const items = [{ id: 'all', label: 'ALL' }, ...GUNS.map((g) => ({ id: g.id, label: g.short }))];
    this.filtersEl.innerHTML = items
      .map(
        (item) =>
          `<button type="button" class="skin-filter${item.id === this.filter ? ' sel' : ''}" data-skin-filter="${item.id}">${item.label}</button>`
      )
      .join('');
  }

  renderCollection() {
    if (!this.skinsEl) return;
    let list = SKINS.filter((s) => this.owned.has(s.id));
    if (this.filter !== 'all') list = list.filter((s) => s.gun === this.filter);
    if (!list.length) {
      this.skinsEl.innerHTML =
        '<div class="skin-empty">NO FINISHES HERE YET · OPEN A CRATE TO START THE COLLECTION</div>';
      return;
    }
    this.skinsEl.innerHTML = list
      .map((skin) => {
        const eq = this.equipped[skin.gun] === skin.id;
        return (
          `<button type="button" class="skin-card${eq ? ' eq' : ''} rarity-${skin.rarity}" data-skin="${skin.id}">` +
          swatch(skin) +
          `<b>${skin.name}</b>` +
          `<span>${GUN_BY_ID.get(skin.gun).short} · ${RARITIES[skin.rarity].name}${eq ? ' · EQUIPPED' : ''}</span>` +
          '</button>'
        );
      })
      .join('');
  }

  save() {
    try {
      localStorage.setItem(this.key(OWNED_KEY), JSON.stringify([...this.owned]));
      localStorage.setItem(this.key(EQUIP_KEY), JSON.stringify(this.equipped));
    } catch {
      /* storage can be blocked; the collection just won't persist */
    }
  }
}

function swatch(skin) {
  return (
    '<span class="skin-swatches">' +
    `<i style="background:#${hex(skin.body)}"></i>` +
    `<i style="background:#${hex(skin.dark)}"></i>` +
    `<i style="background:#${hex(skin.glow)}"></i>` +
    `<i style="background:#${hex(skin.accent)}"></i>` +
    '</span>'
  );
}

function hex(n) {
  return (n >>> 0).toString(16).padStart(6, '0');
}

function readOwned(storageKey) {
  let raw = null;
  try {
    raw = JSON.parse(localStorage.getItem(storageKey) || '[]');
  } catch {
    raw = null;
  }
  if (!Array.isArray(raw)) return [];
  return [...new Set(raw.filter((id) => typeof id === 'string' && SKIN_BY_ID.has(id)))];
}

function readEquipped(storageKey, owned) {
  const out = { rifle: null, breach: null, lance: null, havoc: null };
  let raw = null;
  try {
    raw = JSON.parse(localStorage.getItem(storageKey) || 'null');
  } catch {
    raw = null;
  }
  if (!raw || typeof raw !== 'object') return out;
  for (const gun of Object.keys(out)) {
    const id = raw[gun];
    const skin = typeof id === 'string' ? SKIN_BY_ID.get(id) : null;
    if (skin && skin.gun === gun && owned.has(skin.id)) out[gun] = skin.id;
  }
  return out;
}
