import { RemotePlayers } from './remote.js';

// Public free-for-all against the Wispbyte game server. The server owns the
// room, health, respawns and score; the client keeps movement responsive and
// reports hits, which the server validates before applying them.
const SEND_HZ = 20;
const MAX_MESSAGE = 250;
const ONLINE_LANDING = 'http://78.154.103.43:11603/';
// A static HTTPS page cannot open the arena's insecure WebSocket. GitHub Pages
// keeps solo/co-op local and sends PLAY ONLINE to the Wispbyte launcher instead.
const STATIC_HOST = location.protocol === 'https:' || /(^|\.)github\.io$/i.test(location.hostname);

export class Online {
  constructor(game) {
    this.game = game;
    this.remotes = new RemotePlayers(game.scene, 1.05);
    this.ws = null;
    this.joined = false;
    this.connecting = false;
    this.running = false;
    this.down = false;
    this.manualClose = false;
    this.id = null;
    this.name = 'RUNNER';
    this.room = '';
    this.map = 'circuit';
    this.slot = 0;
    this.spawn = 0;
    this.rows = [];
    this.sendTimer = 0;
    this.connectTimer = 0;
    this.external = STATIC_HOST;
    this.autoJoin =
      !this.external && new URLSearchParams(window.location.search).get('online') === '1';

    this.bindUi();
    if (this.autoJoin) {
      // Give the rest of the hangar one frame to finish wiring, then walk into
      // the public room. The player still presses JACK IN so pointer lock runs
      // inside a real click.
      window.setTimeout(() => {
        if (this.game.state === 'menu' && !this.joined && !this.connecting) this.connect();
      }, 0);
    }
  }

  // Only live while the PvP run is actually ticking. The weapon system asks
  // this object for player hit volumes, so a disconnected/solo session gets no
  // PvP targets and keeps the normal enemy path untouched.
  get active() {
    return this.joined && this.running && this.game.state === 'playing';
  }

  get connected() {
    return this.joined;
  }

  get count() {
    return this.rows.length;
  }

  // ------------------------------------------------------------------- setup
  bindUi() {
    this.playBtn = document.getElementById('online-play');
    this.statusEl = document.getElementById('online-status');
    this.pauseLeaveBtn = document.getElementById('btn-leave-online');
    this.boardEl = document.getElementById('pvp-rows');
    this.boardCountEl = document.getElementById('pvp-count');
    this.boardTitleEl = document.getElementById('pvp-title');
    this.aliveEl = document.getElementById('pvp-alive');
    this.board = document.getElementById('pvp-board');
    this.noteEl = document.querySelector('.online-note');

    if (this.external) {
      this.playBtn?.setAttribute('aria-label', 'Play online on the Wispbyte public arena');
      if (this.noteEl) this.noteEl.textContent = 'WISPBYTE PUBLIC ARENA';
    }

    this.playBtn?.addEventListener('click', (e) => {
      e.stopPropagation();
      this.game.audio.init();
      if (this.external) {
        window.location.assign(ONLINE_LANDING);
        return;
      }
      if (this.joined || this.connecting) this.leave();
      else this.connect();
    });
    this.pauseLeaveBtn?.addEventListener('click', (e) => {
      e.stopPropagation();
      this.game.audio.ui();
      this.leave();
    });

    this.paintButton();
    this.menuStatus();
  }

  setStatus(text, state = '') {
    if (this.statusEl) {
      this.statusEl.textContent = text;
      if (state) this.statusEl.dataset.state = state;
      else delete this.statusEl.dataset.state;
    }
    if (this.boardTitleEl && this.joined && this.room) {
      this.boardTitleEl.textContent = this.room;
    }
  }

  paintButton() {
    if (!this.playBtn) return;
    if (this.external) {
      this.playBtn.textContent = 'PLAY ONLINE ↗';
      this.playBtn.disabled = false;
      this.playBtn.classList.remove('online-on', 'busy');
      return;
    }
    if (this.joined) this.playBtn.textContent = 'LEAVE ONLINE';
    else if (this.connecting) this.playBtn.textContent = 'CONNECTING…';
    else this.playBtn.textContent = 'PLAY ONLINE';
    this.playBtn.disabled = this.connecting;
    this.playBtn.classList.toggle('online-on', this.joined);
    this.playBtn.classList.toggle('busy', this.connecting);
  }

  menuStatus() {
    if (this.external) {
      this.setStatus('PUBLIC PVP · WISPBYTE ARENA · CLICK TO ENTER', 'ok');
      return;
    }
    if (this.connecting) {
      this.setStatus('CONNECTING TO PUBLIC ARENA…', 'busy');
    } else if (this.joined) {
      const n = this.rows.length || 1;
      this.setStatus(`${this.room} · ${n} PLAYER${n === 1 ? '' : 'S'} · PRESS JACK IN`, 'ok');
    } else {
      this.setStatus('PUBLIC ARENA · NO BOTS · CLICK TO CONNECT');
    }
  }

  // ---------------------------------------------------------------- transport
  url() {
    const url = new URL('/pvp', window.location.href);
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
    return url.href;
  }

  connect() {
    if (this.external) {
      window.location.assign(ONLINE_LANDING);
      return;
    }
    if (this.joined || this.connecting) return;
    if (this.game.squad?.connected || this.game.squad?.connecting) {
      this.setStatus('LEAVE YOUR SQUAD BEFORE JOINING THE PUBLIC ARENA', 'err');
      return;
    }
    if (this.game.state !== 'menu') return;

    this.name = this.game.squad?.name || 'RUNNER';
    this.manualClose = false;
    this.connecting = true;
    this.paintButton();
    this.setStatus('CONNECTING TO PUBLIC ARENA…', 'busy');

    let ws;
    try {
      ws = new WebSocket(this.url());
    } catch {
      this.connecting = false;
      this.paintButton();
      this.setStatus('ONLINE SERVER UNAVAILABLE', 'err');
      return;
    }
    this.ws = ws;

    this.connectTimer = window.setTimeout(() => {
      if (!this.connecting) return;
      this.setStatus('NO ANSWER FROM THE ONLINE SERVER', 'err');
      try {
        ws.close();
      } catch {
        /* already gone */
      }
    }, 12000);

    ws.addEventListener('open', () => {
      if (this.ws !== ws) return;
      this.setStatus('MATCHING…', 'busy');
      this.send({ t: 'join', name: this.name, map: this.game.mapId });
    });
    ws.addEventListener('message', (event) => {
      if (this.ws !== ws) return;
      let msg;
      try {
        msg = JSON.parse(event.data);
      } catch {
        return;
      }
      if (msg && typeof msg === 'object') this.onMessage(msg);
    });
    ws.addEventListener('close', () => {
      if (this.ws !== ws) return;
      this.onClose();
    });
    ws.addEventListener('error', () => {
      /* close follows and owns the user-facing message */
    });
  }

  onClose() {
    window.clearTimeout(this.connectTimer);
    this.ws = null;
    const wasJoined = this.joined;
    const wasRunning = this.running;
    this.joined = false;
    this.connecting = false;
    this.running = false;
    this.down = false;
    this.id = null;
    this.room = '';
    this.rows = [];
    this.cleanupWorld();
    this.paintButton();
    if (wasJoined && wasRunning && (this.game.state === 'playing' || this.game.state === 'paused')) {
      this.game.hud.banner('ONLINE LINK LOST', 'RETURNING TO THE HANGAR');
      this.game.toMenu(true);
    } else {
      this.setStatus('ONLINE SERVER UNAVAILABLE · TRY AGAIN', 'err');
    }
    this.game.syncStartHeadline();
  }

  leave() {
    if (!this.joined && !this.connecting) return;
    this.manualClose = true;
    window.clearTimeout(this.connectTimer);
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.send({ t: 'leave' });
    }
    if (this.ws) {
      try {
        this.ws.close();
      } catch {
        /* already closed */
      }
      this.ws = null;
    }
    const wasRunning = this.running;
    this.joined = false;
    this.connecting = false;
    this.running = false;
    this.down = false;
    this.id = null;
    this.room = '';
    this.rows = [];
    this.cleanupWorld();
    this.paintButton();
    this.setStatus('PUBLIC ARENA · NO BOTS · CLICK TO CONNECT');
    this.game.syncStartHeadline();
    if (wasRunning && (this.game.state === 'playing' || this.game.state === 'paused')) {
      this.game.toMenu(true);
    }
  }

  send(msg) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return false;
    try {
      this.ws.send(JSON.stringify(msg));
      return true;
    } catch {
      return false;
    }
  }

  cleanupWorld() {
    this.remotes.clear();
    this.game.hud.setPvp(false);
    this.game.hud.setPvpBoard([], null, 0);
    this.game.hud.setMap(this.game.mapLabel());
    this.pauseLeaveBtn?.classList.add('hidden');
    if (this.game.weapons) {
      this.game.weapons.playerTargets = this;
    }
  }

  // ----------------------------------------------------------------- traffic
  onMessage(msg) {
    if (msg.t === 'welcome') {
      this.onWelcome(msg);
      return;
    }
    if (!this.joined) return;
    if (msg.t === 's') this.applySnapshot(msg);
    else if (msg.t === 'hurt') this.applyHurt(msg);
    else if (msg.t === 'kill') this.onKill(msg);
    else if (msg.t === 'respawn') this.respawn(msg);
    else if (msg.t === 'join') {
      const n = Number(msg.players) || this.rows.length;
      if (this.game.state === 'menu') this.setStatus(`${this.room} · ${n} PLAYER${n === 1 ? '' : 'S'} · PRESS JACK IN`, 'ok');
    } else if (msg.t === 'leave') {
      const n = Number(msg.players) || 0;
      if (this.game.state === 'menu') {
        this.setStatus(`${this.room} · ${n} PLAYER${n === 1 ? '' : 'S'} · PRESS JACK IN`, 'ok');
      }
    } else if (msg.t === 'full') {
      this.setStatus('THE PUBLIC ARENA IS FULL · TRY AGAIN', 'err');
      this.leave();
    }
  }

  onWelcome(msg) {
    window.clearTimeout(this.connectTimer);
    this.joined = true;
    this.connecting = false;
    this.id = String(msg.id || '');
    this.room = String(msg.room || 'ARENA');
    this.map = msg.map || 'circuit';
    this.slot = Number(msg.slot) || 0;
    this.spawn = Number(msg.spawn) || 0;
    this.rows = Array.isArray(msg.players) ? msg.players : [];
    this.remotes.clear();

    // The room map belongs to the first player in it. A joiner adopts it before
    // the run starts, exactly like accepting the host's arena in co-op.
    if (this.game.state === 'menu' && this.map && this.map !== this.game.mapId) {
      this.game.selectMap(this.map, true);
    }
    if (this.game.events) this.game.events.noteMap(this.map);
    this.game.hud.setMap(this.game.mapLabel());
    this.game.syncStartHeadline();
    this.paintButton();
    this.setStatus(
      `${this.room} · ${this.rows.length || 1} PLAYER${this.rows.length === 1 ? '' : 'S'} · PRESS JACK IN`,
      'ok'
    );
    this.game.audio.uiConfirm();
  }

  applySnapshot(msg) {
    const rows = Array.isArray(msg.players) ? msg.players : [];
    this.rows = rows;
    const seen = new Set();
    let alive = 0;
    let me = null;

    for (const row of rows) {
      if (!Array.isArray(row) || row.length < 8) continue;
      const [id, name, slot, x, y, z, hp, dead, kills, deaths, weapon, yaw, hasState] = row;
      seen.add(id);
      if (!dead) alive++;
      if (id !== this.id) {
        if (!hasState) continue;
        this.remotes.setState(id, {
          name,
          slot,
          x,
          y,
          z,
          health: hp,
          maxHealth: 100,
          weapon: weapon | 0,
          dead: !!dead,
        });
      } else {
        me = { id, name, slot, hp, dead: !!dead, kills: kills | 0, deaths: deaths | 0 };
      }
    }

    for (const id of [...this.remotes.map.keys()]) {
      if (!seen.has(id)) this.remotes.remove(id);
    }

    if (me) {
      this.game.kills = me.kills;
      this.game.score = me.kills * 100;
      this.game.hud.setScore(this.game.score);
      // Only let a snapshot revive us when the server's respawn message has
      // already put us back in play. Otherwise the death animation is allowed
      // to finish and the respawn packet owns the reset.
      if (me.dead) {
        this.game.player.health = 0;
        this.game.player.dead = true;
      } else if (!this.down) {
        this.game.player.health = me.hp;
        this.game.player.dead = false;
      }
    }

    this.game.hud.setPvpBoard(rows, this.id, alive);
    this.game.hud.setPvpCount(alive, rows.length);
    if (this.game.state === 'menu') {
      this.setStatus(
        `${this.room} · ${rows.length || 1} PLAYER${rows.length === 1 ? '' : 'S'} · PRESS JACK IN`,
        'ok'
      );
    }
  }

  applyHurt(msg) {
    if (!this.running) return;
    const hp = Math.max(0, Math.min(100, Math.round(Number(msg.hp) || 0)));
    const g = this.game;
    g.player.health = hp;
    g.player.timeSinceDamage = 0;
    g.player.dead = hp <= 0;
    g.hud.setHealth(hp, 100);
    g.hud.damage(0.8);
    g.player.addShake(0.32);
    g.audio.playerHit();
    g.effects.burst(
      g.player.pos.clone().setY(g.player.pos.y + 1.1),
      0xff3b61,
      12,
      6,
      0.14,
      0.4,
      6
    );
    if (hp <= 0) this.handleDown();
  }

  onKill(msg) {
    const g = this.game;
    if (msg.by === this.id) {
      g.hud.popCenter(`ELIMINATED ${msg.victimName || 'RUNNER'}`, 'kill', -86);
      g.hud.flash('rgba(255,255,255,0.08)');
      g.audio.hit(true, 8);
    } else if (msg.victim === this.id) {
      g.hud.popCenter(`ELIMINATED BY ${msg.byName || 'RUNNER'}`, 'kill', -86);
    } else {
      g.hud.popCenter(`${msg.byName || 'RUNNER'} › ${msg.victimName || 'RUNNER'}`, '', -86);
    }
  }

  handleDown() {
    if (!this.running) return false;
    if (!this.down) {
      this.down = true;
      this.game.hud.banner('SIGNAL LOST', 'REDEPLOYING…');
      this.game.audio.gameOver();
      this.game.weapons.setVisible(false);
      if (this.game.touch) this.game.touch.hide();
    }
    return true;
  }

  respawn(msg) {
    if (!this.joined) return;
    this.down = false;
    const g = this.game;
    this.placeAt(Number(msg.spawn) || 0);
    g.player.dead = false;
    g.player.maxHealth = 100;
    g.player.health = 100;
    g.player.timeSinceDamage = 99;
    g.weapons.reset();
    g.weapons.setVisible(true);
    g.hud.setHealth(100, 100);
    g.hud.setPvpCount(this.rows.filter((r) => !r[7]).length, this.rows.length);
    g.hud.banner('REDEPLOYED', 'BACK IN THE ARENA');
    g.audio.uiConfirm();
    if (g.isTouch && g.touch) g.touch.show();
    this.sendState(true);
  }

  placeAt(index) {
    const g = this.game;
    const points = g.world.spawnPoints || [];
    const spawn = points.length
      ? points[((index % points.length) + points.length) % points.length]
      : g.world.spawnAt;
    const pos = spawn.clone();
    g.player.reset(pos);
    g.player.yaw = Math.atan2(pos.x, pos.z);
    g.player.health = 100;
    g.player.dead = false;
    g.player.timeSinceDamage = 99;
  }

  // ---------------------------------------------------------------- run hooks
  spawnPoint() {
    const points = this.game.world.spawnPoints || [];
    if (!points.length) return this.game.world.spawnAt.clone();
    return points[this.spawn % points.length].clone();
  }

  startRun() {
    this.running = true;
    this.down = false;
    this.sendTimer = 0;
    this.remotes.clear();
    this.pauseLeaveBtn?.classList.remove('hidden');
    this.game.hud.setPvp(true);
    this.game.hud.setPvpCount(1, this.rows.length || 1);
    this.sendState(true);
  }

  update(dt) {
    if (!this.joined) return;
    this.remotes.update(dt);
    if (!this.running || this.down || this.game.player.dead) return;
    this.sendTimer += dt;
    if (this.sendTimer >= 1 / SEND_HZ) {
      this.sendTimer = 0;
      this.sendState(false);
    }
  }

  sendState(force = false) {
    if (!this.joined) return false;
    const g = this.game;
    return this.send({
      t: 'p',
      x: round2(g.player.pos.x),
      y: round2(g.player.pos.y),
      z: round2(g.player.pos.z),
      yaw: round2(g.player.yaw),
      w: g.weapons.index,
      f: force ? 1 : 0,
    });
  }

  // ------------------------------------------------------------- PvP combat
  reportHit(target, damage, headshot, weapon) {
    if (!this.active || !target || !target.id) return false;
    const dmg = Math.max(1, Math.min(MAX_MESSAGE, Math.round(Number(damage) || 0)));
    this.send({
      t: 'hit',
      target: target.id,
      d: dmg,
      h: headshot ? 1 : 0,
      w: weapon || '',
    });
    return true;
  }

  // A ray against the floating avatar body. The head sphere sits above the
  // body; the server does not care which one was hit beyond the damage number.
  raycast(origin, dir, maxDist) {
    if (!this.active) return null;
    let best = null;
    for (const avatar of this.remotes.map.values()) {
      if (avatar.dead) continue;
      const bodyY = avatar.pos.y + this.remotes.bodyOffset;
      const bodyT = raySphere(origin, dir, avatar.pos.x, bodyY, avatar.pos.z, 0.56);
      if (bodyT !== null && bodyT <= maxDist && (!best || bodyT < best.distance)) {
        best = {
          target: { id: avatar.id, name: avatar.name },
          distance: bodyT,
          headshot: false,
          point: origin.clone().addScaledVector(dir, bodyT),
        };
      }
      const headT = raySphere(origin, dir, avatar.pos.x, bodyY + 0.52, avatar.pos.z, 0.27);
      if (headT !== null && headT <= maxDist && (!best || headT < best.distance)) {
        best = {
          target: { id: avatar.id, name: avatar.name },
          distance: headT,
          headshot: true,
          point: origin.clone().addScaledVector(dir, headT),
        };
      }
    }
    return best;
  }

  segmentHit(origin, dir, maxDist) {
    if (!this.active) return null;
    let best = null;
    for (const avatar of this.remotes.map.values()) {
      if (avatar.dead) continue;
      const bodyY = avatar.pos.y + this.remotes.bodyOffset;
      const t = raySphere(origin, dir, avatar.pos.x, bodyY, avatar.pos.z, 0.64);
      if (t !== null && t <= maxDist && (!best || t < best.distance)) {
        best = {
          target: { id: avatar.id, name: avatar.name },
          distance: t,
          headshot: false,
          point: origin.clone().addScaledVector(dir, t),
        };
      }
    }
    return best;
  }

  splash(point, radius, damage, excludeId = null) {
    if (!this.active) return [];
    const out = [];
    for (const avatar of this.remotes.map.values()) {
      if (avatar.dead || avatar.id === excludeId) continue;
      const center = {
        x: avatar.pos.x,
        y: avatar.pos.y + this.remotes.bodyOffset,
        z: avatar.pos.z,
      };
      const d = Math.max(
        0,
        Math.hypot(center.x - point.x, center.y - point.y, center.z - point.z) - 0.35
      );
      if (d > radius) continue;
      const falloff = Math.max(0.25, 1 - d / radius);
      out.push({
        target: { id: avatar.id, name: avatar.name },
        damage: damage * falloff,
      });
    }
    return out;
  }
}

function raySphere(origin, dir, cx, cy, cz, radius) {
  const ox = origin.x - cx;
  const oy = origin.y - cy;
  const oz = origin.z - cz;
  const b = ox * dir.x + oy * dir.y + oz * dir.z;
  const c = ox * ox + oy * oy + oz * oz - radius * radius;
  const h = b * b - c;
  if (h < 0) return null;
  const sq = Math.sqrt(h);
  const t0 = -b - sq;
  const t1 = -b + sq;
  if (t1 < 0) return null;
  return t0 >= 0 ? t0 : 0;
}

function round2(value) {
  return Math.round(value * 100) / 100;
}
