import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

import { World } from './world.js';
import { Player } from './player.js';
import { Weapon } from './weapon.js';
import { EnemyManager } from './enemies.js';
import { Effects } from './effects.js';
import { AudioEngine } from './audio.js';
import { Hud } from './hud.js';
import { Input } from './input.js';
import { TouchControls } from './touch.js';

const BEST_KEY = 'slipstream.best';
const SENS_KEY = 'slipstream.sens';
const VOL_KEY = 'slipstream.vol';

class Game {
  constructor() {
    this.app = document.getElementById('app');

    // A coarse pointer or a small touch screen gets the on-screen controls and
    // the cheaper render path. Body class drives the mobile CSS layout.
    this.isTouch =
      window.matchMedia('(pointer: coarse)').matches ||
      (navigator.maxTouchPoints > 0 && window.innerWidth < 1200);
    document.body.classList.toggle('touch', this.isTouch);

    this.renderer = new THREE.WebGLRenderer({ antialias: !this.isTouch, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, this.isTouch ? 1.35 : 1.5));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    this.app.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.FogExp2(0x05070f, 0.0105);
    this.camera = new THREE.PerspectiveCamera(88, window.innerWidth / window.innerHeight, 0.05, 420);
    this.scene.add(this.camera);

    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(
      new THREE.Vector2(window.innerWidth, window.innerHeight),
      this.isTouch ? 0.52 : 0.62,
      0.55,
      0.74
    );
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());

    this.hud = new Hud();
    this.audio = new AudioEngine();
    this.input = new Input(this.renderer.domElement);
    this.input.touchMode = this.isTouch;
    this.touch = new TouchControls(this.input, { onPause: () => this.pause() });
    this.world = new World(this.scene);
    this.effects = new Effects(this.scene);
    this.player = new Player(this.camera, this.world, this.audio, this.effects);
    this.enemies = new EnemyManager(this.scene, this.audio, this.effects, this.world, this.camera);
    this.weapon = new Weapon(this.camera, this.scene, this.audio, this.effects, this.player, this.world, this.enemies);

    this.state = 'menu';
    this.t = 0;
    this.score = 0;
    this.combo = 0;
    this.comboTimer = 0;
    this.kills = 0;
    this.shots = 0;
    this.hits = 0;
    this.headshots = 0;
    this.topSpeed = 0;
    this.wave = 1;
    this.waveDelay = 0;
    this.waveCleared = false;
    this.hitstop = 0;
    this.deathTimer = 0;
    this.overShown = false;
    this.startedAt = 0;
    this.pendingRestart = false;
    this.best = readNumber(BEST_KEY, 0);

    this.weapon.onShoot = () => {
      this.shots++;
    };
    this.weapon.onHit = (info) => this.handleHit(info);

    this.enemies.onPickup = (amount) => {
      this.hud.popCenter(`+${amount} INTEGRITY`, 'bonus', -70);
    };

    this.hud.setBest(this.best);
    this.bindUi();
    this.applySettingsFromStorage();
    this.hud.showStart();

    if (this.isTouch) {
      const startBtn = document.getElementById('btn-start');
      if (startBtn) startBtn.textContent = 'TAP TO PLAY';
      const pauseKeys = document.querySelector('#screen-pause .keys');
      if (pauseKeys) pauseKeys.textContent = 'Left stick to move · drag the right side to aim · FIRE / JUMP / DASH buttons';
      const overKeys = document.querySelector('#screen-over .keys');
      if (overKeys) overKeys.textContent = 'Tap RUN IT BACK to restart';
    }

    this.player.reset(new THREE.Vector3(0, 1.2, 30));
    this.weapon.setVisible(false);
    this.hud.off();

    this.clock = new THREE.Clock();
    window.addEventListener('resize', () => this.onResize());
    window.addEventListener('orientationchange', () => setTimeout(() => this.onResize(), 250));
    this.renderer.setAnimationLoop(() => this.loop());

    // handy for debugging from the console (and for automated smoke tests)
    window.__game = this;
  }

  // ------------------------------------------------------------------- setup
  bindUi() {
    this.input.onLockChange = (locked) => this.onLockChange(locked);
    this.input.onLockError = () => this.onLockError();

    const btnStart = document.getElementById('btn-start');
    const btnResume = document.getElementById('btn-resume');
    const btnRestart = document.getElementById('btn-restart');

    btnStart.addEventListener('click', () => {
      this.audio.init();
      this.audio.ui();
      if (this.isTouch) this.startTouchRun();
      else this.input.lock();
    });

    btnResume.addEventListener('click', () => {
      this.audio.init();
      this.audio.ui();
      if (this.isTouch) this.resumeFromPause();
      else this.input.lock();
    });

    btnRestart.addEventListener('click', () => {
      this.audio.ui();
      this.restart();
    });

    document.getElementById('screen-over').addEventListener('click', (e) => {
      if (e.target.id !== 'btn-restart') this.restart();
    });

    const sens = document.getElementById('sens');
    const sensVal = document.getElementById('sens-val');
    const vol = document.getElementById('vol');
    const volVal = document.getElementById('vol-val');

    sens.addEventListener('input', () => {
      const v = Number(sens.value) / 100;
      this.input.sensitivity = v;
      sensVal.textContent = v.toFixed(2);
      store(SENS_KEY, String(v));
    });

    vol.addEventListener('input', () => {
      const v = Number(vol.value) / 100;
      this.audio.setVolume(v);
      volVal.textContent = String(vol.value);
      store(VOL_KEY, String(v));
    });

    window.addEventListener('keydown', (e) => {
      if (e.code === 'KeyR' && (this.state === 'dead' || this.state === 'over')) {
        this.restart();
      }
      if (e.code === 'Escape' && this.state === 'playing') {
        if (this.input.locked) this.input.unlock();
        else this.pause();
      }
    });

    document.addEventListener('visibilitychange', () => {
      if (!document.hidden || this.state !== 'playing') return;
      if (this.isTouch) this.pause();
      else this.input.unlock();
    });

    this.sensEl = sens;
    this.sensValEl = sensVal;
    this.volEl = vol;
    this.volValEl = volVal;
  }

  applySettingsFromStorage() {
    const sens = readNumber(SENS_KEY, 0.22);
    const vol = readNumber(VOL_KEY, 0.7);
    this.input.sensitivity = sens;
    this.audio.volume = vol;
    if (this.sensEl) {
      this.sensEl.value = String(Math.round(sens * 100));
      this.sensValEl.textContent = sens.toFixed(2);
    }
    if (this.volEl) {
      this.volEl.value = String(Math.round(vol * 100));
      this.volValEl.textContent = String(Math.round(vol * 100));
    }
  }

  // Pointer lock can be refused inside embedded previews; fall back to
  // uncaptured mouse deltas so the game is still playable there.
  onLockError() {
    this.input.fallback = true;
    this.audio.init();
    this.hud.showLockNotice(true);
    if (this.state === 'menu' || this.state === 'over') {
      this.beginRun();
    } else if (this.state === 'paused') {
      this.state = 'playing';
      this.hud.hidePause();
      this.hud.on();
      this.weapon.setVisible(true);
      this.audio.setPaused(false);
    }
  }

  onLockChange(locked) {
    if (locked) {
      this.input.fallback = false;
      this.hud.showLockNotice(false);
      this.audio.init();
      this.audio.setPaused(false);
      if (this.state === 'menu' || this.state === 'over') {
        this.pendingRestart = false;
        this.beginRun();
      } else if (this.state === 'paused') {
        this.state = 'playing';
        this.hud.hidePause();
        this.hud.on();
        this.weapon.setVisible(true);
      }
    } else {
      this.pause();
    }
  }

  pause() {
    if (this.state !== 'playing') return;
    this.state = 'paused';
    this.hud.showPause();
    this.audio.setPaused(true);
    this.weapon.setVisible(false);
    this.input.mouseButtons.clear();
    this.input.keys.clear();
    this.input.clearVirtual();
    if (this.touch) this.touch.hide();
  }

  // Touch devices start straight into the run: pointer lock does not exist on
  // phones, so the on-screen stick and buttons are the control surface.
  startTouchRun() {
    this.input.touchMode = true;
    this.requestFullscreen();
    this.beginRun();
  }

  resumeFromPause() {
    if (this.state !== 'paused') return;
    this.state = 'playing';
    this.hud.hidePause();
    this.hud.on();
    this.weapon.setVisible(true);
    this.audio.setPaused(false);
    if (this.touch) this.touch.show();
  }

  requestFullscreen() {
    try {
      const p = document.documentElement.requestFullscreen?.({ navigationUI: 'hide' });
      if (p && typeof p.catch === 'function') p.catch(() => {});
      const orientation = screen.orientation;
      if (orientation && typeof orientation.lock === 'function') {
        const lock = orientation.lock('landscape');
        if (lock && typeof lock.catch === 'function') lock.catch(() => {});
      }
    } catch {
      /* fullscreen and orientation lock are best-effort */
    }
  }

  onResize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
    this.composer.setSize(w, h);
    // bloom at half resolution: much cheaper, visually indistinguishable here
    this.bloom.setSize(Math.max(1, Math.floor(w * 0.5)), Math.max(1, Math.floor(h * 0.5)));
  }

  // ------------------------------------------------------------- run control
  beginRun() {
    this.audio.init();
    this.audio.setPaused(false);

    this.score = 0;
    this.combo = 0;
    this.comboTimer = 0;
    this.kills = 0;
    this.shots = 0;
    this.hits = 0;
    this.headshots = 0;
    this.topSpeed = 0;
    this.wave = 0;
    this.waveDelay = 0;
    this.waveCleared = false;
    this.hitstop = 0;
    this.deathTimer = 0;
    this.overShown = false;
    this.startedAt = this.t;

    this.enemies.clear();
    this.effects.reset();
    this.world.resetPads();
    this.player.reset(new THREE.Vector3(0, 1.2, 30));
    this.weapon.reset();
    this.weapon.setVisible(true);

    this.hud.reset();
    this.hud.on();
    this.hud.hideStart();
    this.hud.hidePause();
    this.hud.hideOver();
    this.hud.setBest(this.best);
    this.hud.setScore(0);
    this.hud.setHealth(this.player.health, this.player.maxHealth);
    this.hud.setAmmo(this.weapon.ammo, this.weapon.magSize, false);
    this.hud.setWave(1, 0);

    this.startWave(1);
    this.state = 'playing';
    if (this.isTouch && this.touch) this.touch.show();
  }

  restart() {
    if (this.isTouch) {
      this.beginRun();
      return;
    }
    // Only start the new run once the pointer is actually captured, otherwise
    // the player would end up in a running game with a dead mouse.
    this.pendingRestart = true;
    this.input.lock();
  }

  startWave(n) {
    this.wave = n;
    this.waveCleared = false;
    this.waveDelay = 0;
    this.enemies.spawnWave(n, this.player.pos);
    this.hud.setWave(n, this.enemies.remaining());
    this.hud.banner(`WAVE ${String(n).padStart(2, '0')}`, waveSubtitle(n));
    this.audio.waveStart(n);
  }

  startDeath() {
    this.state = 'dead';
    if (this.touch) this.touch.hide();
    this.deathTimer = 1.35;
    this.audio.gameOver();
    this.weapon.setVisible(false);
    this.hud.banner('SIGNAL LOST', 'RUN TERMINATED');
    this.hud.setLowHp(false);
    this.input.unlock();
  }

  showGameOver() {
    this.overShown = true;
    this.state = 'over';
    const accuracy = this.shots > 0 ? Math.round((this.hits / this.shots) * 100) : 0;
    if (this.score > this.best) {
      this.best = this.score;
      store(BEST_KEY, String(this.best));
      this.hud.setBest(this.best);
    }
    this.hud.showGameOver({
      score: this.score,
      wave: this.wave,
      kills: this.kills,
      accuracy,
      topSpeed: this.topSpeed,
    });
    this.hud.off();
    if (this.touch) this.touch.hide();
  }

  multiplier() {
    return Math.min(5, 1 + Math.floor(this.combo / 4) * 0.5);
  }

  handleHit({ enemy, point, headshot, damage }) {
    this.hits++;
    if (headshot) this.headshots++;
    const res = this.enemies.hit(enemy, damage, point, headshot);
    this.audio.hit(headshot, this.combo);
    this.hud.hitmarker(res.killed ? 'kill' : headshot ? 'head' : 'hit');
    this.hud.popAtWorld(point, this.camera, String(Math.round(damage)), headshot ? 'head' : '');

    if (res.killed) {
      this.kills++;
      this.combo++;
      this.comboTimer = 5;
      const mult = this.multiplier();
      const airborne = !this.player.onGround;
      const gained = Math.round(res.score * mult) + (headshot ? 50 : 0) + (airborne ? 40 : 0);
      this.score += gained;
      this.hud.popAtWorld(point, this.camera, `+${gained}`, 'kill', 40);
      if (headshot) this.hud.popCenter('HEADSHOT +50', 'bonus', -54);
      if (airborne) this.hud.popCenter('AIRBORNE +40', 'bonus', -96);
      this.hitstop = 0.04;
      this.player.addShake(0.18);
      this.hud.setScore(this.score);
      this.hud.flash('rgba(255,255,255,0.06)');
    } else {
      this.comboTimer = Math.max(this.comboTimer, 2.1);
    }
  }

  // ---------------------------------------------------------------- main loop
  loop() {
    const raw = Math.min(0.05, this.clock.getDelta());
    this.t += raw;

    if (this.state === 'menu') {
      this.menuCamera();
      this.effects.update(raw * 0.5);
      this.world.update(raw, this.t);
    } else if (this.state === 'paused') {
      this.effects.update(raw * 0.15);
      this.world.update(raw * 0.25, this.t);
    } else {
      this.world.update(raw, this.t);
      this.effects.update(raw);
      this.step(raw);
    }

    this.composer.render();
    this.input.endFrame();
  }

  step(raw) {
    if (this.state === 'playing') {
      let d = raw;
      if (this.hitstop > 0) {
        this.hitstop -= raw;
        d *= 0.18;
      }
      const controlling = this.input.controlling;
      const ads = controlling && !this.player.dead && this.input.mouse(2) ? 1 : 0;
      this.player.update(d, this.input, ads);
      this.weapon.update(d, this.input, controlling && !this.player.dead);
      this.enemies.update(d, this.player, this.t);
      this.updateGame(d, raw);
    } else if (this.state === 'dead' || this.state === 'over') {
      this.player.update(raw, this.input, 0);
      this.weapon.update(raw, this.input, false);
      this.enemies.update(raw, this.player, this.t);
      if (this.state === 'dead') {
        this.deathTimer -= raw;
        if (this.deathTimer <= 0 && !this.overShown) this.showGameOver();
      }
    }
  }

  updateGame(dt) {
    if (this.player.dead) {
      this.startDeath();
      return;
    }

    // stats + HUD
    this.topSpeed = Math.max(this.topSpeed, this.player.horizSpeed());
    this.hud.setHealth(this.player.health, this.player.maxHealth);
    this.hud.setAmmo(this.weapon.ammo, this.weapon.magSize, this.weapon.reloading);
    this.hud.setDash(1 - this.player.dashCooldown / 1.65);
    this.hud.setSpeed(this.player.horizSpeed());
    this.hud.setWave(this.wave, this.enemies.remaining());
    this.hud.crosshairSpread(this.weapon.spreadPixels());
    this.hud.setFocused(this.weapon.ads > 0.5);

    if (this.combo > 0) {
      this.comboTimer -= dt;
      if (this.comboTimer <= 0) this.combo = 0;
    }
    this.hud.setCombo(this.combo, this.multiplier(), Math.max(0, this.comboTimer) / 5);

    if (this.t - this.startedAt > 9) this.hud.fadeHint();

    // wave flow
    if (!this.waveCleared && this.enemies.remaining() === 0) {
      this.waveCleared = true;
      this.waveDelay = 2.6;
      const bonus = 200 + this.wave * 75;
      this.score += bonus;
      this.hud.setScore(this.score);
      this.hud.banner('WAVE CLEAR', `+${bonus} BONUS · +15 INTEGRITY`);
      this.audio.waveClear();
      this.player.heal(15);
    }
    if (this.waveCleared) {
      this.waveDelay -= dt;
      if (this.waveDelay <= 0) this.startWave(this.wave + 1);
    }
  }

  menuCamera() {
    const a = this.t * 0.075;
    const r = 36;
    this.camera.position.set(Math.cos(a) * r, 9.5 + Math.sin(this.t * 0.32) * 1.6, Math.sin(a) * r);
    this.camera.lookAt(0, 3.6, 0);
    if (this.camera.fov !== 68) {
      this.camera.fov = 68;
      this.camera.updateProjectionMatrix();
    }
  }
}

function waveSubtitle(n) {
  if (n === 1) return 'SWARM DETECTED';
  if (n === 2) return 'SKITTERS INBOUND';
  if (n % 5 === 0) return 'ELITE SURGE';
  if (n === 3) return 'SENTRIES ONLINE';
  return 'HOSTILES INBOUND';
}

function readNumber(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    if (raw === null) return fallback;
    const v = Number(raw);
    return Number.isFinite(v) ? v : fallback;
  } catch {
    return fallback;
  }
}

function store(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* storage can be blocked; settings just won't persist */
  }
}

new Game();
