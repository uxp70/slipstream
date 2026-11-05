// Coins are banked between runs and spent on buffs, which are a pre-match
// purchase: you arm stacks on the start screen, the next run spends them, and
// the effects last exactly that run. Everything here is personal to the player,
// so the co-op host stays the only authority over the wave and the score.
const COINS_KEY = 'slipstream.coins';
const ARMED_KEY = 'slipstream.buffs';

// coins per point of enemy score — a 100-point drifter pays 15
const COIN_RATE = 0.15;

export const BUFFS = [
  {
    id: 'rounds',
    name: 'OVERCLOCK ROUNDS',
    max: 3,
    cost: 180,
    blurb: '+12% weapon damage. Stack three packs and everything hits half again as hard.',
  },
  {
    id: 'plating',
    name: 'REINFORCED PLATING',
    max: 3,
    cost: 160,
    blurb: '+20 max integrity for the run, and the bar starts full.',
  },
  {
    id: 'thrusters',
    name: 'SCRAMBLE THRUSTERS',
    max: 3,
    cost: 150,
    blurb: '−15% dash cooldown. The gap between a dodge and a habit.',
  },
  {
    id: 'salvage',
    name: 'SALVAGE DRONE',
    max: 3,
    cost: 200,
    blurb: '+25% coins from every kill, so the next shopping trip is cheaper.',
  },
];

const SHORT = {
  rounds: 'ROUNDS',
  plating: 'PLATING',
  thrusters: 'THRUSTERS',
  salvage: 'SALVAGE',
};

const empty = () => ({ rounds: 0, plating: 0, thrusters: 0, salvage: 0 });

export class Armory {
  constructor(game) {
    this.game = game;
    this.screen = document.getElementById('screen-armory');
    this.cardsEl = document.getElementById('armory-buffs');
    this.coinsEl = document.getElementById('armory-coins');
    this.startCoinsEl = document.getElementById('coin-num');
    this.summaryEl = document.getElementById('armory-summary');
    this.statusEl = document.getElementById('armory-status');

    this.coins = readInt(COINS_KEY, 0);
    this.armed = readArmed();
    // effects of the run in progress; beginRun() copies the armed stacks here
    this.active = empty();
    this.statusText = 'BUFFS APPLY TO THE NEXT RUN ONLY. EVERY RUN PAYS COINS.';

    document.getElementById('btn-armory')?.addEventListener('click', (e) => {
      e.stopPropagation();
      game.audio.init();
      game.audio.ui();
      this.open();
    });
    document.getElementById('btn-armory-back')?.addEventListener('click', (e) => {
      e.stopPropagation();
      game.audio.ui();
      this.close();
    });
    document.getElementById('btn-armory-clear')?.addEventListener('click', (e) => {
      e.stopPropagation();
      this.clear();
    });

    // one delegated listener: a card is a buy button, and re-rendering never has
    // to re-bind anything
    this.cardsEl?.addEventListener('click', (e) => {
      const el = e.target.closest('[data-buff]');
      if (!el) return;
      e.stopPropagation();
      this.buy(el.dataset.buff);
    });

    window.addEventListener('keydown', (e) => {
      if (e.code !== 'Escape' || !this.isOpen()) return;
      this.close();
    });

    this.paint();
  }

  isOpen() {
    return !!this.screen && !this.screen.classList.contains('hidden');
  }

  open() {
    this.statusText = this.summary();
    this.paint();
    this.screen?.classList.remove('hidden');
  }

  close() {
    this.screen?.classList.add('hidden');
  }

  summary() {
    const parts = BUFFS.filter((b) => (this.armed[b.id] | 0) > 0).map(
      (b) => `${SHORT[b.id]} ×${this.armed[b.id]}`
    );
    return parts.length
      ? `${parts.join(' · ')} — SPENDS ON THE NEXT RUN`
      : 'NO BUFFS ARMED. EVERY RUN PAYS COINS.';
  }

  // each stack costs more than the last, so stacking is a real decision
  price(def) {
    return Math.round(def.cost * (1 + (this.armed[def.id] | 0) * 0.6));
  }

  buy(id) {
    const def = BUFFS.find((b) => b.id === id);
    if (!def) return { ok: false, reason: 'unknown' };
    const owned = this.armed[id] | 0;
    if (owned >= def.max) {
      this.setStatus(`${def.name} IS MAXED FOR THE NEXT RUN`);
      this.game.audio.ui();
      return { ok: false, reason: 'maxed' };
    }
    const price = this.price(def);
    if (this.coins < price) {
      this.setStatus(`NEED ${price - this.coins} MORE COINS FOR ${def.name}`);
      this.game.audio.ui();
      return { ok: false, reason: 'coins', price };
    }
    this.coins -= price;
    this.armed[id] = owned + 1;
    this.game.audio.ui();
    this.save();
    this.setStatus(`${def.name} ARMED ×${this.armed[id]} — ${price} COINS SPENT`);
    // repaint so the wallet, the stack counts and the start-screen summary all
    // move with the purchase
    this.paint();
    return { ok: true, price };
  }

  // disarm without a refund: the wallet already paid, so this is only for
  // taking a different set into the run
  clear() {
    this.armed = empty();
    this.game.audio.ui();
    this.save();
    this.setStatus('ALL BUFFS DISARMED. NOTHING WILL BE SPENT ON THE NEXT RUN.');
    this.paint();
    return this.armed;
  }

  // called once per run: the armed stacks become this run's effects, then the
  // armory is empty again so nothing is spent twice
  beginRun() {
    this.active = empty();
    for (const def of BUFFS) this.active[def.id] = this.armed[def.id] | 0;
    this.armed = empty();
    this.save();
    this.setStatus('BUFFS SPENT. WIN THE RUN TO FUND THE NEXT ONE.');
    this.paint();
    return this.active;
  }

  // ---------------------------------------------------------------- effects
  damageMult() {
    return 1 + this.active.rounds * 0.12;
  }

  bonusHealth() {
    return this.active.plating * 20;
  }

  dashMult() {
    return Math.max(0.4, 1 - this.active.thrusters * 0.15);
  }

  coinMult() {
    return 1 + this.active.salvage * 0.25;
  }

  // what a kill actually pays, once the drones have taken their share
  killCoins(score) {
    return Math.max(1, Math.round((Number(score) || 0) * COIN_RATE * this.coinMult()));
  }

  earn(amount) {
    const n = Math.round(Number(amount) || 0);
    if (n === 0) return this.coins;
    this.coins = Math.max(0, this.coins + n);
    this.save();
    this.paint();
    return this.coins;
  }

  armedCount() {
    return BUFFS.reduce((sum, def) => sum + (this.armed[def.id] | 0), 0);
  }

  save() {
    try {
      localStorage.setItem(COINS_KEY, String(this.coins));
      localStorage.setItem(ARMED_KEY, JSON.stringify(this.armed));
    } catch {
      /* storage can be blocked; coins just won't persist */
    }
  }

  setStatus(text) {
    this.statusText = text;
    if (this.statusEl) this.statusEl.textContent = text;
  }

  paint() {
    const coins = this.coins.toLocaleString('en-US');
    if (this.coinsEl) this.coinsEl.textContent = coins;
    if (this.startCoinsEl) this.startCoinsEl.textContent = coins;
    if (this.summaryEl) this.summaryEl.textContent = this.summary();
    if (this.statusEl) this.statusEl.textContent = this.statusText;
    this.render();
  }

  render() {
    if (!this.cardsEl) return;
    this.cardsEl.innerHTML = BUFFS.map((def) => {
      const owned = this.armed[def.id] | 0;
      const price = this.price(def);
      const maxed = owned >= def.max;
      const poor = !maxed && this.coins < price;
      const cls = `buff-card${owned > 0 ? ' sel' : ''}${maxed ? ' maxed' : ''}${poor ? ' poor' : ''}`;
      const cost = maxed ? 'MAXED' : `${price} COINS`;
      return (
        `<button type="button" class="${cls}" data-buff="${def.id}">` +
        `<div class="buff-head"><b>${def.name}</b><i>×${owned} / ${def.max}</i></div>` +
        `<div class="buff-blurb">${def.blurb}</div>` +
        `<span class="buff-cost">${cost}</span>` +
        '</button>'
      );
    }).join('');
  }
}

function readInt(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    if (raw === null) return fallback;
    const v = Number(raw);
    return Number.isFinite(v) && v >= 0 ? Math.floor(v) : fallback;
  } catch {
    return fallback;
  }
}

function readArmed() {
  const out = empty();
  let raw = null;
  try {
    raw = JSON.parse(localStorage.getItem(ARMED_KEY) || 'null');
  } catch {
    raw = null;
  }
  if (!raw || typeof raw !== 'object') return out;
  for (const def of BUFFS) {
    const v = raw[def.id] | 0;
    out[def.id] = Math.max(0, Math.min(def.max, v));
  }
  return out;
}
