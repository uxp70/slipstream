import { WEAPONS } from './weapon.js';

// The inventory: every gun in the game, which slot it is bound to, and which
// slot a run starts holding. Slot order *is* the loadout, so the number keys,
// the HUD strip and the viewmodels all follow what the player picked instead of
// the catalogue order.
const LOADOUT_KEY = 'slipstream.loadout';
const START_KEY = 'slipstream.startslot';
const DEFAULT_ORDER = WEAPONS.map((w) => w.id);

const SHORT = { rifle: 'RIFLE', breach: 'BREACH', lance: 'LANCE', havoc: 'HAVOC' };

const ROLES = {
  rifle: 'Sustained mid-range hitscan. The all-rounder.',
  breach: 'Nine-pellet burst. Point blank only.',
  lance: 'One beam, huge damage, slow cycle. Long sightlines.',
  havoc: 'Splash rocket, and your rocket-jump tool.',
};

export class Arsenal {
  constructor(game) {
    this.game = game;
    this.screen = document.getElementById('screen-arsenal');
    this.gunsEl = document.getElementById('arsenal-guns');
    this.slotsEl = document.getElementById('arsenal-slots');
    this.startEl = document.getElementById('arsenal-start');
    this.summaryEl = document.getElementById('arsenal-summary');
    this.blurbEl = document.getElementById('arsenal-blurb');

    this.order = readOrder(this.key(LOADOUT_KEY));
    this.startSlot = readStart(this.key(START_KEY));
    this.selected = this.order[0];

    document.getElementById('btn-arsenal')?.addEventListener('click', (e) => {
      e.stopPropagation();
      game.audio.init();
      game.audio.ui();
      this.open();
    });
    document.getElementById('btn-arsenal-back')?.addEventListener('click', (e) => {
      e.stopPropagation();
      this.game.audio.ui();
      this.close();
    });

    // one delegated listener per board: gun cards pick what to equip, slot cards
    // say where, so a click never has to be re-bound after a re-render
    this.gunsEl?.addEventListener('click', (e) => {
      const el = e.target.closest('[data-gun]');
      if (!el) return;
      e.stopPropagation();
      this.selected = el.dataset.gun;
      this.game.audio.ui();
      this.render();
    });
    this.slotsEl?.addEventListener('click', (e) => {
      const el = e.target.closest('[data-slot]');
      if (!el) return;
      e.stopPropagation();
      this.equip(this.selected, Number(el.dataset.slot));
    });
    this.startEl?.addEventListener('click', (e) => {
      const el = e.target.closest('[data-start]');
      if (!el) return;
      e.stopPropagation();
      this.setStartSlot(Number(el.dataset.start));
    });

    window.addEventListener('keydown', (e) => {
      if (e.code !== 'Escape' || !this.isOpen()) return;
      this.close();
    });
  }

  // the loadout belongs to the signed-in operator, so the key is resolved at
  // read time rather than captured once
  key(base) {
    return this.game.account ? this.game.account.storageKey(base) : base;
  }

  // re-read after a sign-in or sign-out
  reload() {
    this.order = readOrder(this.key(LOADOUT_KEY));
    this.startSlot = readStart(this.key(START_KEY));
    this.selected = this.order[0];
    this.apply();
    return this;
  }

  isOpen() {
    return !!this.screen && !this.screen.classList.contains('hidden');
  }

  open() {
    this.render();
    if (this.screen) this.screen.classList.remove('hidden');
  }

  close() {
    if (this.screen) this.screen.classList.add('hidden');
  }

  // push the loadout into the weapon system (slot order + starting slot)
  apply() {
    this.game.weapons.setLoadout(this.order, this.startSlot);
    this.render();
  }

  // the arsenal always carries all four guns, so equipping one into an occupied
  // slot swaps the two rather than leaving a hole in the strip
  equip(id, slot) {
    const from = this.order.indexOf(id);
    if (from < 0 || slot < 0 || slot >= this.order.length) return;
    this.selected = id;
    if (from === slot) {
      this.render();
      return;
    }
    const displaced = this.order[slot];
    this.order[slot] = id;
    this.order[from] = displaced;
    this.game.audio.ui();
    this.save();
    this.apply();
  }

  setStartSlot(slot) {
    const next = Math.max(0, Math.min(this.order.length - 1, slot | 0));
    if (next === this.startSlot) return;
    this.startSlot = next;
    this.game.audio.ui();
    this.save();
    this.apply();
  }

  reset() {
    this.order = DEFAULT_ORDER.slice();
    this.startSlot = 0;
    this.selected = this.order[0];
    this.save();
    this.apply();
    return this.order;
  }

  save() {
    try {
      localStorage.setItem(this.key(LOADOUT_KEY), JSON.stringify(this.order));
      localStorage.setItem(this.key(START_KEY), String(this.startSlot));
    } catch {
      /* storage can be blocked; the loadout just won't persist */
    }
  }

  render() {
    const order = this.order;

    if (this.slotsEl) {
      this.slotsEl.innerHTML = order
        .map((id, i) => {
          const sel = id === this.selected ? ' sel' : '';
          const start = i === this.startSlot ? ' start' : '';
          return `<button type="button" class="arsenal-slot${sel}${start}" data-slot="${i}"><b>${i + 1}</b><span>${SHORT[id] || id}</span></button>`;
        })
        .join('');
    }

    if (this.gunsEl) {
      this.gunsEl.innerHTML = WEAPONS.map((def) => {
        const slot = order.indexOf(def.id);
        const sel = def.id === this.selected ? ' sel' : '';
        return (
          `<button type="button" class="gun-card${sel}" data-gun="${def.id}">` +
          `<div class="gun-head"><b>${def.name}</b><i>SLOT ${slot + 1}</i></div>` +
          `<div class="gun-role">${ROLES[def.id] || ''}</div>` +
          '<div class="gun-stats">' +
          `<span>DMG <b>${def.damage}</b></span>` +
          `<span>RPM <b>${Math.round(60 / def.interval)}</b></span>` +
          `<span>MAG <b>${def.mag}</b></span>` +
          `<span>RELOAD <b>${def.reload}s</b></span>` +
          '</div>' +
          '</button>'
        );
      }).join('');
    }

    if (this.startEl) {
      this.startEl.innerHTML = order
        .map(
          (id, i) =>
            `<button type="button" class="qbtn${i === this.startSlot ? ' sel' : ''}" data-start="${i}">SLOT ${i + 1}</button>`
        )
        .join('');
    }

    if (this.summaryEl) {
      this.summaryEl.textContent = order.map((id, i) => `${i + 1} ${SHORT[id] || id}`).join(' · ');
    }

    this.paintStrip();

    if (this.blurbEl) {
      const def = WEAPONS.find((w) => w.id === this.selected) || WEAPONS[0];
      this.blurbEl.textContent = `${def.name} — pick a slot to carry it there; the two guns swap.`;
    }
  }

  // the strip is static markup because touch binds to those buttons once, so the
  // labels are patched in place instead of re-rendering the list
  paintStrip() {
    const slots = document.querySelectorAll('#weapon-strip .wslot');
    slots.forEach((el, i) => {
      const def = WEAPONS.find((w) => w.id === this.order[i]);
      if (!def) return;
      const nameEl = el.querySelector('.wname');
      if (nameEl && nameEl.textContent !== def.short) nameEl.textContent = def.short;
      el.setAttribute('aria-label', def.name);
    });
  }
}

function readOrder(storageKey = LOADOUT_KEY) {
  const ids = DEFAULT_ORDER.slice();
  let raw = null;
  try {
    raw = JSON.parse(localStorage.getItem(storageKey) || 'null');
  } catch {
    raw = null;
  }
  if (!Array.isArray(raw) || raw.length !== ids.length) return ids;
  if (new Set(raw).size !== ids.length || !raw.every((id) => ids.includes(id))) return ids;
  return raw;
}

function readStart(storageKey = START_KEY) {
  try {
    const v = Number(localStorage.getItem(storageKey));
    if (Number.isInteger(v) && v >= 0 && v < DEFAULT_ORDER.length) return v;
  } catch {
    /* fall through to the default */
  }
  return 0;
}
