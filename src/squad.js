import * as THREE from 'three';
import { SquadNet, cleanCode, isValidCode } from './net.js';
import { RemotePlayers, TEAM_COLORS } from './remote.js';

// Squad co-op. One player hosts: their browser owns the enemy wave, damage and
// scoring. Guests simulate their own movement locally (so aiming and strafing
// stay responsive at any ping) and send their position, hits and health to the
// host, which is the only authority on what dies. Everything is peer-to-peer
// WebRTC, so this works on plain static hosting with no server of our own.
const SNAP_HZ = 15; // host -> guests
const STATE_HZ = 20; // guest -> host
const RESPAWN_TIME = 3.4;
const NAME_KEY = 'slipstream.name';
const MAX_SLOTS = 4;

export class Squad {
  constructor(game) {
    this.game = game;
    this.net = new SquadNet();
    this.remotes = new RemotePlayers(game.scene);

    this.role = null; // 'host' | 'guest' | null
    this.selfId = 'host';
    this.selfSlot = 0;
    this.name = readName();
    this.running = false;
    this.leaving = false;

    this.bodies = new Map(); // host: peerId -> enemy target body
    this.slots = new Map(); // host: peerId -> slot
    this.players = new Map(); // host: peerId -> { name, slot }

    this.sendTimer = 0;
    this.snapTimer = 0;
    this.rosterTimer = 0;
    this.respawnTimer = 0;
    this.down = false;
    this.lastWave = 0;
    this.remaining = 0;
    this._rosterKey = '';
    this.pendingWelcome = null;

    this.bindUi();
    this.net.onData = (from, msg) => this.onMessage(from, msg);
    this.net.onJoin = (id) => this.onPeerJoin(id);
    this.net.onLeave = (id) => this.onPeerLeave(id);
    this.net.onStatus = (text, state) => this.setStatus(text, state);
  }

  // --------------------------------------------------------------- getters
  get isHost() {
    return this.role === 'host';
  }

  get isGuest() {
    return this.role === 'guest';
  }

  get connected() {
    return this.role !== null;
  }

  // ------------------------------------------------------------------- UI
  bindUi() {
    this.statusEl = document.getElementById('sq-status');
    this.nameEl = document.getElementById('sq-name');
    this.codeInput = document.getElementById('sq-code-input');
    this.hostBtn = document.getElementById('sq-host');
    this.joinBtn = document.getElementById('sq-join');
    this.leaveBtn = document.getElementById('sq-leave');
    this.enterBtn = document.getElementById('sq-enter');
    this.copyBtn = document.getElementById('sq-copy');
    this.codeRow = document.getElementById('sq-code-row');
    this.codeEl = document.getElementById('sq-code');
    this.rosterEl = document.getElementById('squad-roster');
    this.pauseLeaveBtn = document.getElementById('btn-leave-squad');

    if (this.nameEl) this.nameEl.value = this.name;

    this.hostBtn?.addEventListener('click', (e) => {
      e.stopPropagation();
      this.game.audio.init();
      this.game.audio.ui();
      this.createRoom();
    });
    this.joinBtn?.addEventListener('click', (e) => {
      e.stopPropagation();
      this.game.audio.init();
      this.game.audio.ui();
      this.joinRoom();
    });
    this.enterBtn?.addEventListener('click', (e) => {
      e.stopPropagation();
      this.enter();
    });
    this.leaveBtn?.addEventListener('click', (e) => {
      e.stopPropagation();
      this.game.audio.ui();
      this.leave();
    });
    // mid-run escape hatch: the start screen is hidden while playing, so the
    // pause panel needs its own way out of a squad
    this.pauseLeaveBtn?.addEventListener('click', (e) => {
      e.stopPropagation();
      this.game.audio.ui();
      this.leave();
    });
    this.copyBtn?.addEventListener('click', async (e) => {
      e.stopPropagation();
      const link = location.origin + location.pathname + '#' + (this.net.code || '');
      try {
        await navigator.clipboard.writeText(link);
        if (this.copyBtn) this.copyBtn.textContent = 'COPIED';
      } catch {
        if (this.copyBtn) this.copyBtn.textContent = 'CODE ' + this.net.code;
      }
      this.game.audio.ui();
    });
    this.nameEl?.addEventListener('change', () => {
      this.name = readNameFrom(this.nameEl);
      try {
        localStorage.setItem(NAME_KEY, this.name);
      } catch {
        /* storage can be blocked */
      }
    });
    this.codeInput?.addEventListener('input', () => {
      if (!this.codeInput) return;
      this.codeInput.value = cleanCode(this.codeInput.value);
    });
    this.codeInput?.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') this.joinRoom();
    });
    this.nameEl?.addEventListener('keydown', (e) => e.stopPropagation());

    // a shared link carries the code in the hash, so joining is one tap
    const hash = cleanCode(location.hash.replace('#', ''));
    if (hash && isValidCode(hash)) {
      if (this.codeInput) this.codeInput.value = hash;
      this.setStatus('CODE ' + hash + ' LOADED · PRESS JOIN SQUAD');
    }
  }

  setStatus(text, state = '') {
    if (!this.statusEl) return;
    this.statusEl.textContent = text;
    if (state) this.statusEl.dataset.state = state;
    else delete this.statusEl.dataset.state;
  }

  setBusy(busy) {
    for (const btn of [this.hostBtn, this.joinBtn]) {
      if (!btn) continue;
      btn.disabled = busy;
      btn.style.opacity = busy ? '0.5' : '';
    }
  }

  updateRoster() {
    const el = this.rosterEl;
    if (!el) return;
    const on = this.connected;
    el.classList.toggle('on', on);
    if (!on) {
      if (this._rosterKey !== '') {
        this._rosterKey = '';
        el.innerHTML = '';
      }
      return;
    }
    const rows = [
      { name: this.name || 'RUNNER', slot: this.selfSlot, hp: this.game.player.health, self: true },
    ];
    for (const avatar of this.remotes.map.values()) {
      rows.push({ name: avatar.name, slot: avatar.slot ?? 1, hp: avatar.health, self: false });
    }
    const key = rows.map((r) => `${r.name}:${Math.round(r.hp)}:${r.self ? 1 : 0}`).join('|');
    if (key === this._rosterKey) return;
    this._rosterKey = key;
    const code = this.isHost && this.net.code ? `<div class="sq-code">CODE ${escapeHtml(this.net.code)}</div>` : '';
    el.innerHTML =
      code +
      rows
        .map(
          (r) =>
            `<div class="sq-row${r.self ? ' self' : ''}"><i style="--c:${hexColor(r.slot)}"></i>` +
            `<b>${escapeHtml(r.name)}</b><span>${Math.max(0, Math.round(r.hp))}</span></div>`
        )
        .join('');
  }

  // ---------------------------------------------------------------- hosting
  async createRoom() {
    if (this.role || this.net.role) return;
    this.name = readNameFrom(this.nameEl);
    this.setBusy(true);
    this.setStatus('OPENING LINK…', 'busy');
    try {
      const info = await this.net.host();
      this.role = 'host';
      this.selfId = 'host';
      this.selfSlot = 0;
      this.remotes.clear();
      this.bodies.clear();
      this.slots.clear();
      this.players.clear();
      this.game.enemies.remoteTargets = [];
      this.codeRow?.classList.remove('hidden');
      if (this.codeEl) this.codeEl.textContent = info.code;
      this.hostBtn?.classList.add('hidden');
      this.joinBtn?.classList.add('hidden');
      this.leaveBtn?.classList.remove('hidden');
      if (this.codeInput) this.codeInput.value = info.code;
      this.pauseLeaveBtn?.classList.remove('hidden');
      this.setStatus('LIVE · CODE ' + info.code + ' · PRESS JACK IN TO START', 'ok');
      this.updateRoster();
    } catch (err) {
      this.setStatus('COULD NOT OPEN A LINK · ' + shortError(err), 'err');
    } finally {
      this.setBusy(false);
    }
  }

  // ---------------------------------------------------------------- joining
  async joinRoom() {
    if (this.role) return;
    const raw = cleanCode(this.codeInput ? this.codeInput.value : '');
    if (!isValidCode(raw)) {
      this.setStatus('THAT CODE IS NOT VALID', 'err');
      return;
    }
    this.name = readNameFrom(this.nameEl);
    this.setBusy(true);
    this.setStatus('DIALLING ' + raw + '…', 'busy');

    const welcome = new Promise((resolve) => {
      this.pendingWelcome = resolve;
      setTimeout(() => resolve(null), 18000);
    });

    try {
      await this.net.join(raw);
      this.net.sendHost({ t: 'hello', name: this.name });
      this.setStatus('CONNECTED · HANDSHAKE…', 'busy');
      const msg = await welcome;
      if (!msg || !msg.slot) {
        this.setStatus('NO ANSWER FROM THE HOST', 'err');
        this.net.close();
        return;
      }
      this.role = 'guest';
      this.selfId = this.net.selfId;
      this.selfSlot = msg.slot | 0;
      this.game.selectMap(msg.map || this.game.mapId, true);
      if (msg.diff) this.game.setDifficulty(msg.diff, true);
      this.codeRow?.classList.remove('hidden');
      if (this.codeEl) this.codeEl.textContent = this.net.code;
      this.hostBtn?.classList.add('hidden');
      this.joinBtn?.classList.add('hidden');
      this.enterBtn?.classList.remove('hidden');
      this.leaveBtn?.classList.remove('hidden');
      this.pauseLeaveBtn?.classList.remove('hidden');
      this.setStatus('LINKED · PRESS ENTER ARENA', 'ok');
      this.updateRoster();
    } catch (err) {
      const type = String((err && err.type) || '');
      this.net.close();
      this.setStatus(
        type === 'peer-unavailable'
          ? 'NO SQUAD ON ' + raw + ' · CHECK THE CODE'
          : type === 'invalid-code'
            ? 'THAT CODE IS NOT VALID'
            : 'LINK FAILED · ' + shortError(err),
        'err'
      );
    } finally {
      this.pendingWelcome = null;
      this.setBusy(false);
    }
  }

  // the guest starts their own client-side run when they enter the arena; the
  // host's snapshots immediately take over the wave and the score
  enter() {
    if (!this.isGuest) return;
    const g = this.game;
    g.audio.init();
    g.audio.ui();
    if (g.isTouch) g.startTouchRun();
    else g.input.lock();
    setTimeout(() => {
      if (g.state === 'menu' && this.isGuest) g.beginRun();
    }, 320);
  }

  leave() {
    if (this.leaving) return;
    this.leaving = true;
    const wasGuest = this.isGuest;
    this.net.close();
    this.role = null;
    this.running = false;
    this.down = false;
    this.respawnTimer = 0;
    this.remotes.clear();
    this.bodies.clear();
    this.slots.clear();
    this.players.clear();
    this.game.enemies.remoteTargets = [];
    // the mirror only exists on a guest; clearing it on a host would kill the
    // wave it is running
    if (wasGuest) this.game.enemies.applyMirror([], []);
    this.codeRow?.classList.add('hidden');
    this.hostBtn?.classList.remove('hidden');
    this.joinBtn?.classList.remove('hidden');
    this.enterBtn?.classList.add('hidden');
    this.leaveBtn?.classList.add('hidden');
    this.pauseLeaveBtn?.classList.add('hidden');
    this.setStatus('SOLO · CREATE A SQUAD OR JOIN WITH A CODE');
    this._rosterKey = 'x';
    this.updateRoster();
    if (this.game.state === 'playing' || this.game.state === 'paused') this.game.beginRun();
    this.leaving = false;
  }

  // ------------------------------------------------------------ run lifecycle
  onRunStart() {
    if (!this.role) return;
    this.running = true;
    this.down = false;
    this.respawnTimer = 0;
    this.lastWave = this.game.wave;
    if (this.isGuest) {
      this.placeAtSlot();
      this.setStatus('IN ARENA · CODE ' + (this.net.code || '----'), 'ok');
    } else {
      this.net.broadcast({ t: 'start', m: this.game.mapId, d: this.game.difficulty });
      this.syncSnapshot();
    }
    this._rosterKey = 'x';
    this.updateRoster();
  }

  placeAtSlot() {
    const g = this.game;
    const points = g.world.spawnPoints || [];
    const spawn = points.length ? points[this.selfSlot % points.length] : g.world.spawnAt;
    if (spawn) {
      g.player.reset(spawn.clone());
      g.player.yaw = (this.selfSlot / MAX_SLOTS) * Math.PI * 2;
    }
  }

  // A downed player rebuilds instead of ending the run. Pointer lock is kept so
  // the player does not have to re-capture the mouse mid-fight.
  handleDown() {
    if (!this.running) return false;
    if (!this.down) {
      this.down = true;
      this.respawnTimer = RESPAWN_TIME;
      this.game.hud.banner('SIGNAL LOST', 'REBUILDING…');
      this.game.audio.gameOver();
      this.game.weapons.setVisible(false);
      if (this.game.touch) this.game.touch.hide();
    }
    return true;
  }

  tickRespawn(dt) {
    if (!this.down) return;
    this.respawnTimer -= dt;
    if (this.respawnTimer > 0) return;
    this.down = false;
    const g = this.game;
    this.placeAtSlot();
    g.weapons.reset();
    g.weapons.setVisible(true);
    g.hud.setHealth(g.player.health, g.player.maxHealth);
    g.hud.banner('LINK RESTORED', 'BACK IN THE FIGHT');
    if (g.isTouch && g.touch) g.touch.show();
  }

  // --------------------------------------------------------------- per frame
  update(dt) {
    if (!this.role) return;
    this.remotes.update(dt);

    if (this.isHost) {
      for (const [id, body] of this.bodies) {
        const avatar = this.remotes.map.get(id);
        if (avatar) body.pos.copy(avatar.pos);
      }
      this.snapTimer += dt;
      if (this.snapTimer >= 1 / SNAP_HZ) {
        this.snapTimer = 0;
        this.syncSnapshot();
      }
    } else {
      if (this.running) {
        this.game.enemies.mirrorStep(dt, this.game.t);
        this.sendTimer += dt;
        if (this.sendTimer >= 1 / STATE_HZ) {
          this.sendTimer = 0;
          this.sendState();
        }
      }
    }

    if (this.running) this.tickRespawn(dt);

    this.rosterTimer += dt;
    if (this.rosterTimer >= 0.25) {
      this.rosterTimer = 0;
      this.updateRoster();
    }
  }

  syncSnapshot() {
    if (!this.isHost || this.net.conns.size === 0) return;
    const g = this.game;
    const players = [
      [
        'host',
        r2(g.player.pos.x),
        r2(g.player.pos.y),
        r2(g.player.pos.z),
        Math.round(g.player.health),
        g.weapons.index,
        g.player.dead ? 1 : 0,
        this.selfSlot,
        this.name || 'HOST',
      ],
    ];
    for (const [id, body] of this.bodies) {
      const info = this.players.get(id) || { name: 'RUNNER', slot: 1 };
      players.push([
        id,
        r2(body.pos.x),
        r2(body.pos.y),
        r2(body.pos.z),
        Math.round(body.health),
        body.weapon | 0,
        body.dead ? 1 : 0,
        info.slot,
        info.name,
      ]);
    }
    this.net.broadcast({
      t: 's',
      w: g.wave,
      r: g.enemies.remaining(),
      cl: g.waveCleared ? 1 : 0,
      sc: g.score,
      e: g.enemies.netRows(),
      k: g.enemies.shotRows(),
      p: players,
    });
  }

  sendState() {
    const g = this.game;
    this.net.sendHost({
      t: 'p',
      x: r2(g.player.pos.x),
      y: r2(g.player.pos.y),
      z: r2(g.player.pos.z),
      hp: Math.round(g.player.health),
      w: g.weapons.index,
      d: g.player.dead ? 1 : 0,
    });
  }

  // ----------------------------------------------------------------- traffic
  onMessage(from, msg) {
    if (!msg || typeof msg !== 'object') return;
    if (this.isHost) this.onHostMessage(from, msg);
    // the welcome arrives before this.role is set, so also accept traffic while
    // the transport already knows we are the guest
    else if (this.isGuest || this.net.role === 'guest') this.onGuestMessage(msg);
  }

  onHostMessage(from, msg) {
    if (msg.t === 'hello') {
      this.acceptGuest(from, msg);
      return;
    }
    if (msg.t === 'p') {
      const info = this.players.get(from);
      if (!info) return;
      const avatar = this.remotes.ensure(from, info.name, info.slot);
      this.remotes.setState(from, {
        name: info.name,
        slot: info.slot,
        x: msg.x,
        y: msg.y,
        z: msg.z,
        health: msg.hp ?? 100,
        maxHealth: 100,
        weapon: msg.w | 0,
        dead: !!msg.d,
      });
      const body = this.bodies.get(from);
      if (body) {
        body.health = msg.hp ?? body.health;
        body.weapon = msg.w | 0;
        body.dead = !!msg.d;
      }
      return;
    }
    if (msg.t === 'hit') this.applyRemoteHit(msg);
  }

  onGuestMessage(msg) {
    if (msg.t === 'welcome') {
      if (this.pendingWelcome) this.pendingWelcome(msg);
      return;
    }
    if (msg.t === 'start') {
      // the host owns the wave, so its tier is the squad's tier
      if (msg.d) this.game.setDifficulty(msg.d, true);
      return;
    }
    if (msg.t === 's') {
      this.applySnapshot(msg);
      return;
    }
    if (msg.t === 'dmg') {
      const g = this.game;
      if (g.state === 'playing' && !g.player.dead) g.player.damage(Number(msg.a) || 0, null);
      return;
    }
    if (msg.t === 'full') this.setStatus('THAT SQUAD IS FULL', 'err');
  }

  acceptGuest(peerId, msg) {
    if (this.slots.has(peerId)) return;
    const used = new Set(this.slots.values());
    let slot = 1;
    while (slot < MAX_SLOTS && used.has(slot)) slot++;
    if (slot >= MAX_SLOTS) {
      this.net.send(peerId, { t: 'full' });
      return;
    }
    const name = cleanName(msg.name);
    this.slots.set(peerId, slot);
    this.players.set(peerId, { name, slot });
    const avatar = this.remotes.ensure(peerId, name, slot);
    avatar.group.visible = true;
    const body = {
      id: peerId,
      pos: new THREE.Vector3().copy(avatar.pos),
      health: 100,
      maxHealth: 100,
      weapon: 0,
      dead: false,
      damage: (amount) => this.damageGuest(peerId, amount),
    };
    this.bodies.set(peerId, body);
    this.game.enemies.remoteTargets = [...this.bodies.values()];

    this.net.send(peerId, {
      t: 'welcome',
      slot,
      code: this.net.code,
      map: this.game.mapId,
      diff: this.game.difficulty,
      running: this.running ? 1 : 0,
      wave: this.game.wave,
    });
    this.setStatus(`SQUAD ${this.bodies.size + 1}/${MAX_SLOTS} · CODE ${this.net.code}`, 'ok');
    this.game.hud.popCenter(name + ' JOINED', 'bonus', -44);
    this._rosterKey = 'x';
    this.updateRoster();
    this.syncSnapshot();
  }

  damageGuest(peerId, amount) {
    const body = this.bodies.get(peerId);
    if (!body || body.dead) return;
    body.health = Math.max(0, body.health - amount);
    if (body.health <= 0) body.dead = true;
    this.net.send(peerId, { t: 'dmg', a: Math.round(amount) });
  }

  applyRemoteHit(msg) {
    const g = this.game;
    const enemy = g.enemies.byId(msg.id);
    if (!enemy || enemy.dead) return;
    const damage = Math.max(0, Math.min(400, Number(msg.d) || 0));
    const res = g.enemies.hit(enemy, damage, enemy.pos.clone(), !!msg.h);
    if (!res.killed) return;
    g.kills++;
    g.score += Math.round(res.score * g.multiplier());
    g.hud.setScore(g.score);
    g.hud.popCenter('SQUAD KILL', 'bonus', -74);
  }

  applySnapshot(msg) {
    const g = this.game;
    if (!this.running) return;
    g.enemies.applyMirror(msg.e || [], msg.k || []);

    for (const row of msg.p || []) {
      if (row[0] === this.selfId) continue;
      this.remotes.setState(row[0], {
        name: row[8],
        slot: row[7] | 0,
        x: row[1],
        y: row[2],
        z: row[3],
        health: row[4],
        maxHealth: 100,
        weapon: row[5] | 0,
        dead: !!row[6],
      });
    }

    this.score = msg.sc | 0;
    g.score = this.score;
    g.hud.setScore(this.score);
    this.remaining = msg.r | 0;
    g.waveCleared = !!msg.cl;
    g.wave = msg.w | 0;
    g.hud.setWave(g.wave, this.remaining);
    if (g.wave !== this.lastWave) {
      this.lastWave = msg.w | 0;
      g.wave = this.lastWave;
      if (this.lastWave > 1) {
        g.hud.banner('WAVE ' + String(this.lastWave).padStart(2, '0'), 'SQUAD LINK');
        g.audio.waveStart(this.lastWave);
      }
    }
  }

  // Hosts own enemy health, so a guest reports its hit and shows the feedback
  // locally; the death arrives in the next snapshot.
  reportHit(info) {
    if (!this.isGuest || !this.running) return false;
    const g = this.game;
    const enemy = info && info.enemy;
    if (!enemy || enemy.id == null) return false;
    this.net.sendHost({
      t: 'hit',
      id: enemy.id,
      d: Math.round(info.damage),
      h: info.headshot ? 1 : 0,
    });
    g.hud.hitmarker(info.headshot ? 'head' : 'hit');
    g.hud.popAtWorld(info.point, g.camera, String(Math.round(info.damage)), info.headshot ? 'head' : '');
    g.audio.hit(!!info.headshot, g.combo);
    return true;
  }

  onPeerJoin(peerId) {
    if (!this.isHost) return;
    this.net.send(peerId, { t: 'ack' });
  }

  onPeerLeave(peerId) {
    if (this.isGuest) {
      if (peerId !== 'host') return;
      this.running = false;
      this.setStatus('LINK LOST · THE HOST LEFT', 'err');
      this.leave();
      return;
    }
    if (!this.slots.has(peerId)) return;
    const info = this.players.get(peerId);
    this.slots.delete(peerId);
    this.players.delete(peerId);
    this.bodies.delete(peerId);
    this.remotes.remove(peerId);
    this.game.enemies.remoteTargets = [...this.bodies.values()];
    if (info) this.game.hud.popCenter(info.name + ' LEFT', '', -44);
    this.setStatus(
      `SQUAD ${this.bodies.size + 1}/${MAX_SLOTS} · CODE ${this.net.code}`,
      'ok'
    );
    this._rosterKey = 'x';
    this.updateRoster();
  }
}

// --------------------------------------------------------------------- utils
function r2(v) {
  return Math.round(v * 100) / 100;
}

function readName() {
  try {
    return cleanName(localStorage.getItem(NAME_KEY) || '');
  } catch {
    return 'RUNNER';
  }
}

function readNameFrom(el) {
  if (el && el.value) {
    const name = cleanName(el.value);
    try {
      localStorage.setItem(NAME_KEY, name);
    } catch {
      /* storage can be blocked */
    }
    return name;
  }
  return readName();
}

function cleanName(raw) {
  const name = String(raw || '')
    .replace(/[^A-Za-z0-9 _-]/g, '')
    .trim()
    .slice(0, 10);
  return name || 'RUNNER';
}

function escapeHtml(text) {
  return String(text).replace(/[&<>"']/g, (ch) => {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch];
  });
}

function hexColor(slot) {
  const color = TEAM_COLORS[(slot | 0) % TEAM_COLORS.length];
  return '#' + color.toString(16).padStart(6, '0');
}

function shortError(err) {
  const type = String((err && err.type) || '');
  if (type === 'timeout') return 'TIMEOUT';
  if (type === 'browser-incompatible') return 'BROWSER BLOCKED WEBRTC';
  return type ? type.toUpperCase() : 'NETWORK';
}
