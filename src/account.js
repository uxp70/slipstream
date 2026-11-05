// Accounts are local to this device: a callsign and a passcode, stored as a
// PBKDF2-SHA-256 hash with a per-account salt. There is no server (the game is
// static files on GitHub Pages), so this is device identity, not a cloud login:
// it scopes the wallet, the loadout and the squad callsign to a named operator,
// and it is what a hosted provider would replace later.
const ACCOUNTS_KEY = 'slipstream.accounts';
const SESSION_KEY = 'slipstream.session';
const SESSION_MS = 30 * 24 * 60 * 60 * 1000;
const ITERATIONS = 120000;
const MIN_PASS = 4;

export class Accounts {
  constructor(game) {
    this.game = game;
    this.screen = document.getElementById('screen-login');
    this.nameEl = document.getElementById('login-name');
    this.passEl = document.getElementById('login-pass');
    this.statusEl = document.getElementById('login-status');
    this.titleEl = document.getElementById('login-title');
    this.submitEl = document.getElementById('btn-login-submit');
    this.modeEl = document.getElementById('btn-login-mode');
    this.outEl = document.getElementById('btn-login-out');
    this.labelEl = document.getElementById('account-label');
    this.openBtn = document.getElementById('btn-account');

    this.current = null; // { id, name }
    this.mode = 'signin';
    this.busy = false;
    this.list = readAccounts();
    this.statusText = 'SIGN IN OR CREATE AN ACCOUNT · THE WALLET BELONGS TO THE ACCOUNT';

    document.getElementById('btn-account')?.addEventListener('click', (e) => {
      e.stopPropagation();
      game.audio.init();
      game.audio.ui();
      this.open();
    });
    document.getElementById('btn-login-back')?.addEventListener('click', (e) => {
      e.stopPropagation();
      game.audio.ui();
      this.close();
    });
    this.modeEl?.addEventListener('click', (e) => {
      e.stopPropagation();
      game.audio.ui();
      this.setMode(this.mode === 'create' ? 'signin' : 'create');
    });
    this.outEl?.addEventListener('click', (e) => {
      e.stopPropagation();
      game.audio.ui();
      this.signOut();
    });
    this.submitEl?.addEventListener('click', (e) => {
      e.stopPropagation();
      this.submit();
    });
    this.passEl?.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') this.submit();
    });
    this.nameEl?.addEventListener('keydown', (e) => e.stopPropagation());

    window.addEventListener('keydown', (e) => {
      if (e.code !== 'Escape' || !this.isOpen()) return;
      this.close();
    });

    this.paint();
  }

  // Every per-account store goes through here, so signing in or out swaps the
  // wallet, the loadout and the buffs without touching a second code path.
  storageKey(base) {
    return this.current ? `${base}#${this.current.id}` : base;
  }

  isOpen() {
    return !!this.screen && !this.screen.classList.contains('hidden');
  }

  open() {
    this.setMode(this.mode);
    this.screen?.classList.remove('hidden');
    this.nameEl?.focus();
  }

  close() {
    this.screen?.classList.add('hidden');
  }

  setMode(mode) {
    this.mode = mode === 'create' ? 'create' : 'signin';
    const create = this.mode === 'create';
    if (this.titleEl) this.titleEl.textContent = create ? 'CREATE ACCOUNT' : 'SIGN IN';
    if (this.submitEl) this.submitEl.textContent = create ? 'CREATE' : 'SIGN IN';
    if (this.modeEl) this.modeEl.textContent = create ? 'I HAVE AN ACCOUNT' : 'CREATE ACCOUNT';
    if (this.outEl) this.outEl.classList.toggle('hidden', !this.current);
    this.status(create ? 'PICK A CALLSIGN AND A PASSCODE. COINS STAY ON THIS DEVICE.' : 'ENTER YOUR CALLSIGN AND PASSCODE.');
  }

  status(text) {
    this.statusText = text;
    if (this.statusEl) this.statusEl.textContent = text;
  }

  paint() {
    if (this.labelEl) this.labelEl.textContent = this.current ? this.current.name : 'GUEST';
    if (this.openBtn) this.openBtn.textContent = this.current ? 'ACCOUNT' : 'SIGN IN';
    if (this.outEl) this.outEl.classList.toggle('hidden', !this.current);
    if (this.nameEl && this.current) this.nameEl.value = this.current.name;
    if (this.statusEl) this.statusEl.textContent = this.statusText;
  }

  // ------------------------------------------------------------------ actions
  async submit() {
    if (this.busy) return;
    const name = String(this.nameEl?.value || '').trim();
    const pass = String(this.passEl?.value || '');
    if (!/^[A-Za-z0-9 _-]{3,10}$/.test(name)) {
      this.status('CALLSIGN: 3-10 LETTERS, NUMBERS, SPACES, _ OR -');
      return;
    }
    if (pass.length < MIN_PASS) {
      this.status(`PASSCODE: AT LEAST ${MIN_PASS} CHARACTERS`);
      return;
    }
    if (!hasCrypto()) {
      this.status('THIS PAGE CANNOT HASH PASSCODES · OPEN IT OVER HTTPS');
      return;
    }
    const record = this.find(name);
    if (this.mode === 'create') {
      if (record) {
        this.status('THAT CALLSIGN IS TAKEN');
        return;
      }
      this.busy = true;
      try {
        const salt = randomSalt();
        const hash = await derive(pass, salt);
        const entry = {
          id: crypto.randomUUID ? crypto.randomUUID() : `a${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`,
          name,
          salt: b64(salt),
          hash,
          created: Date.now(),
        };
        this.list.push(entry);
        writeAccounts(this.list);
        this.apply(entry, false);
        this.game.audio.ui();
      } catch {
        this.status('COULD NOT CREATE THE ACCOUNT');
      } finally {
        this.busy = false;
      }
      return;
    }

    if (!record) {
      this.status('NO ACCOUNT WITH THAT CALLSIGN');
      return;
    }
    this.busy = true;
    try {
      const attempt = await derive(pass, unb64(record.salt));
      if (attempt !== record.hash) {
        this.status('WRONG PASSCODE');
        return;
      }
      this.apply(record, false);
      this.game.audio.ui();
    } catch {
      this.status('COULD NOT SIGN IN');
    } finally {
      this.busy = false;
    }
  }

  find(name) {
    const key = name.toLowerCase();
    return this.list.find((a) => a.name.toLowerCase() === key) || null;
  }

  apply(record, silent) {
    this.current = { id: record.id, name: record.name };
    writeSession({ id: record.id, at: Date.now() });
    // identity is shared with the online side: the squad callsign is the account
    this.game.squad?.useAccountName?.(record.name);
    this.game.arsenal?.reload?.();
    this.game.armory?.reload?.();
    this.paint();
    if (!silent) this.status(`SIGNED IN AS ${record.name}`);
    this.close();
    return this.current;
  }

  signOut() {
    const was = this.current;
    this.current = null;
    clearSession();
    this.game.arsenal?.reload?.();
    this.game.armory?.reload?.();
    this.paint();
    this.status(was ? `SIGNED OUT OF ${was.name} · PLAYING AS GUEST` : 'ALREADY PLAYING AS GUEST');
    this.setMode('signin');
  }

  // called once at boot: a live session means the wallet and callsign come back
  restore() {
    const sess = readSession();
    if (!sess) {
      this.paint();
      return null;
    }
    const record = this.list.find((a) => a.id === sess.id);
    if (!record) {
      clearSession();
      this.paint();
      return null;
    }
    if (Date.now() - (sess.at || 0) > SESSION_MS) {
      clearSession();
      this.status('SESSION EXPIRED · SIGN IN AGAIN');
      this.paint();
      return null;
    }
    return this.apply(record, true);
  }
}

// ------------------------------------------------------------------- hashing
function hasCrypto() {
  return typeof crypto !== 'undefined' && !!crypto.subtle && typeof crypto.subtle.deriveBits === 'function';
}

function randomSalt() {
  const salt = new Uint8Array(16);
  crypto.getRandomValues(salt);
  return salt;
}

async function derive(pass, salt) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', enc.encode(pass), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations: ITERATIONS, hash: 'SHA-256' },
    key,
    256
  );
  return b64(new Uint8Array(bits));
}

function b64(bytes) {
  let out = '';
  for (const b of bytes) out += String.fromCharCode(b);
  return btoa(out);
}

function unb64(text) {
  const raw = atob(String(text || ''));
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

// ------------------------------------------------------------------- storage
function readAccounts() {
  try {
    const raw = JSON.parse(localStorage.getItem(ACCOUNTS_KEY) || '[]');
    if (!Array.isArray(raw)) return [];
    return raw.filter((a) => a && typeof a.id === 'string' && typeof a.name === 'string' && typeof a.hash === 'string' && typeof a.salt === 'string');
  } catch {
    return [];
  }
}

function writeAccounts(list) {
  try {
    localStorage.setItem(ACCOUNTS_KEY, JSON.stringify(list));
  } catch {
    /* storage can be blocked; the account just won't persist */
  }
}

function readSession() {
  try {
    const raw = JSON.parse(localStorage.getItem(SESSION_KEY) || 'null');
    return raw && typeof raw.id === 'string' ? raw : null;
  } catch {
    return null;
  }
}

function writeSession(session) {
  try {
    localStorage.setItem(SESSION_KEY, JSON.stringify(session));
  } catch {
    /* storage can be blocked */
  }
}

function clearSession() {
  try {
    localStorage.removeItem(SESSION_KEY);
  } catch {
    /* storage can be blocked */
  }
}
