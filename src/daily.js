// The daily supply drop: one claim per calendar day, on a seven-day cycle that
// climbs and then restarts. The coins land in the wallet the armory spends from,
// so a streak is how a player funds a buff without grinding a run.
//
// There is no server here (the game is static files), so the calendar comes from
// the device clock: moving it forward lets a player claim early, and nothing
// offline can prevent that. What this does refuse is a claim timestamped *after*
// now — a clock that went backwards, which is also what a timezone change looks
// like — so a claim can never silently pay twice.
const DAILY_KEY = 'slipstream.daily';
const CYCLE = 7;
const HOUR_MS = 60 * 60 * 1000;

export const DAILY_REWARDS = [
  { coins: 40, name: 'PATCH KIT' },
  { coins: 60, name: 'FIELD RATION' },
  { coins: 90, name: 'AMMO CACHE' },
  { coins: 140, name: 'SUPPLY CRATE' },
  { coins: 200, name: 'MUNITIONS CRATE' },
  { coins: 280, name: 'TITANIUM HAUL' },
  { coins: 420, name: 'JACKPOT' },
];

export class Daily {
  constructor(game) {
    this.game = game;
    this.screen = document.getElementById('screen-daily');
    this.daysEl = document.getElementById('daily-days');
    this.coinsEl = document.getElementById('daily-coins');
    this.statusEl = document.getElementById('daily-status');
    this.claimEl = document.getElementById('btn-daily-claim');
    this.titleEl = document.getElementById('daily-title');
    this.labelEl = document.getElementById('daily-label');
    this.summaryEl = document.getElementById('daily-summary');
    this.walletEl = document.getElementById('coin-num');

    this.data = this.read();
    // a message from the last claim, cleared whenever the panel is opened
    this.statusText = null;

    document.getElementById('btn-daily')?.addEventListener('click', (e) => {
      e.stopPropagation();
      this.game.audio.init();
      this.game.audio.ui();
      this.open();
    });
    document.getElementById('btn-daily-back')?.addEventListener('click', (e) => {
      e.stopPropagation();
      this.game.audio.ui();
      this.close();
    });
    this.claimEl?.addEventListener('click', (e) => {
      e.stopPropagation();
      this.claim();
    });

    window.addEventListener('keydown', (e) => {
      if (e.code !== 'Escape' || !this.isOpen()) return;
      this.close();
    });

    this.paint();
  }

  // the streak belongs to the signed-in operator, so the key is resolved at read
  // time and a sign-in or sign-out swaps the whole calendar
  key(base = DAILY_KEY) {
    return this.game.account ? this.game.account.storageKey(base) : base;
  }

  read() {
    try {
      const raw = JSON.parse(localStorage.getItem(this.key()) || 'null');
      if (!raw || typeof raw !== 'object') return emptyData();
      return {
        streak: clamp(raw.streak, 0, 9999),
        last: typeof raw.last === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(raw.last) ? raw.last : '',
        stamp: Math.max(0, Number(raw.stamp) || 0),
        total: Math.max(0, Number(raw.total) || 0),
      };
    } catch {
      return emptyData();
    }
  }

  write() {
    try {
      localStorage.setItem(this.key(), JSON.stringify(this.data));
    } catch {
      /* storage can be blocked; the streak just won't persist */
    }
  }

  // re-read after a sign-in or sign-out
  reload() {
    this.data = this.read();
    this.statusText = null;
    this.paint();
    return this;
  }

  isOpen() {
    return !!this.screen && !this.screen.classList.contains('hidden');
  }

  open() {
    this.statusText = null;
    this.paint();
    this.screen?.classList.remove('hidden');
  }

  close() {
    this.screen?.classList.add('hidden');
  }

  // What a claim at `now` would do, without changing anything. `now` is a
  // parameter so the test suite can walk a week without waiting for midnight.
  plan(now = Date.now()) {
    const data = this.data;
    const today = dayKey(now);
    const claimedToday = data.last === today;
    const gap = data.last ? dayGap(data.last, today) : null;
    // a missed day (or a clock that has gone backwards) starts the run over
    const kept = gap === 1 ? data.streak | 0 : 0;
    const streakNext = claimedToday ? data.streak | 0 : kept + 1;
    const day = cycleDay(streakNext);
    // no bitwise truncation here: a millisecond stamp does not fit in 32 bits
    const behind = !claimedToday && data.stamp > now;
    return {
      today,
      claimedToday,
      behind,
      streak: claimedToday ? data.streak | 0 : kept,
      streakNext,
      day,
      // the day a claim made right now would pay (or the day already claimed)
      reward: DAILY_REWARDS[day - 1],
      available: !claimedToday && !behind,
      nextDay: claimedToday ? cycleDay(streakNext + 1) : day,
      total: data.total | 0,
      nextIn: msToMidnight(now),
    };
  }

  // pays one day and books the claim; the wallet is the armory's, so this is the
  // same coin balance the buffs are bought from
  claim(now = Date.now()) {
    const p = this.plan(now);
    if (p.claimedToday) {
      this.statusText = `DAY ${p.day} IS ALREADY CLAIMED · NEXT DROP IN ${waitText(p.nextIn)}`;
      this.game.audio.ui();
      this.paint();
      return { ok: false, reason: 'claimed', ...p };
    }
    if (p.behind) {
      this.statusText = 'THE CLOCK IS BEHIND THE LAST CLAIM · FIX THE DATE AND TRY AGAIN';
      this.game.audio.ui();
      this.paint();
      return { ok: false, reason: 'clock', ...p };
    }
    const reward = p.reward;
    const wallet = this.game.armory ? this.game.armory.earn(reward.coins) : 0;
    this.data = {
      streak: p.streakNext,
      last: p.today,
      stamp: now,
      total: (this.data.total | 0) + reward.coins,
    };
    this.write();
    this.statusText = `DAY ${p.day} CLAIMED · +${reward.coins} COINS · STREAK ×${p.streakNext}`;
    this.game.audio.ui();
    this.game.hud?.popCenter?.(`+${reward.coins} COINS · DAY ${p.day}`, 'bonus', -60);
    this.paint();
    return {
      ok: true,
      coins: reward.coins,
      day: p.day,
      streak: p.streakNext,
      wallet,
    };
  }

  paint() {
    const p = this.plan();
    const coins = (this.game.armory ? this.game.armory.coins : 0).toLocaleString('en-US');
    if (this.coinsEl) this.coinsEl.textContent = coins;
    if (this.walletEl) this.walletEl.textContent = coins;
    if (this.titleEl) this.titleEl.textContent = `DAY ${p.day} OF ${CYCLE}`;
    if (this.labelEl) {
      this.labelEl.textContent = p.available
        ? `DAY ${p.day} READY`
        : p.claimedToday
          ? `CLAIMED · ${waitText(p.nextIn)}`
          : 'CHECK THE CLOCK';
    }
    if (this.summaryEl) {
      this.summaryEl.textContent = p.claimedToday
        ? `STREAK ×${p.streak} · NEXT DROP IN ${waitText(p.nextIn)}`
        : p.available
          ? `STREAK ×${p.streak} · ${p.reward.coins} COINS WAITING`
          : `STREAK ×${p.streak} · CLOCK BEHIND THE LAST CLAIM`;
    }
    if (this.claimEl) {
      this.claimEl.disabled = !p.available;
      this.claimEl.textContent = p.available
        ? `CLAIM ${p.reward.coins} COINS`
        : p.claimedToday
          ? 'CLAIMED TODAY'
          : 'CLOCK BEHIND';
    }
    if (this.statusEl) {
      this.statusEl.textContent =
        this.statusText ||
        (p.claimedToday
          ? `DAY ${p.day} DONE · COME BACK TOMORROW FOR ${DAILY_REWARDS[p.nextDay - 1].coins} COINS`
          : `CLAIM DAY ${p.day} FOR ${p.reward.coins} COINS · MISS A DAY AND THE STREAK STARTS OVER`);
    }
    this.render(p);
  }

  render(p) {
    if (!this.daysEl) return;
    this.daysEl.innerHTML = DAILY_REWARDS.map((reward, i) => {
      const day = i + 1;
      const today = day === p.day;
      const claimed = today && p.claimedToday;
      const cls = `daily-card${today ? ' today' : ''}${claimed ? ' claimed' : ''}${today ? '' : ' locked'}`;
      const tag = claimed ? 'CLAIMED' : today && p.available ? 'READY' : `${reward.coins}`;
      return (
        `<div class="${cls}" data-day="${day}">` +
        `<div class="daily-head"><b>DAY ${day}</b><i>${tag}</i></div>` +
        `<div class="daily-name">${reward.name}</div>` +
        `<div class="daily-coins">${reward.coins} COINS</div>` +
        '</div>'
      );
    }).join('');
  }
}

// --------------------------------------------------------------------- dates
// A local calendar day, so "tomorrow" means the player's tomorrow, not UTC's.
function dayKey(ms) {
  const d = new Date(ms);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

// Whole days between two date keys, built at UTC midnight so a DST shift can
// never leave a fraction of a day behind.
function dayGap(fromKey, toKey) {
  const from = Date.parse(`${fromKey}T00:00:00Z`);
  const to = Date.parse(`${toKey}T00:00:00Z`);
  if (!Number.isFinite(from) || !Number.isFinite(to)) return null;
  return Math.round((to - from) / (24 * HOUR_MS));
}

function msToMidnight(ms) {
  const d = new Date(ms);
  const next = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1, 0, 0, 0, 0);
  return Math.max(0, next.getTime() - ms);
}

function cycleDay(streak) {
  return (((streak - 1) % CYCLE) + CYCLE) % CYCLE + 1;
}

function waitText(ms) {
  const minutes = Math.max(0, Math.floor(ms / 60000));
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return hours > 0 ? `${hours}H ${rest}M` : `${rest}M`;
}

function clamp(value, min, max) {
  const n = Math.floor(Number(value) || 0);
  return Math.max(min, Math.min(max, n));
}

function emptyData() {
  return { streak: 0, last: '', stamp: 0, total: 0 };
}
