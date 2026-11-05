import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

import { World, MAPS } from './world.js';
import { Player } from './player.js';
import { WeaponSystem } from './weapon.js';
import { EnemyManager } from './enemies.js';
import { Effects } from './effects.js';
import { AudioEngine } from './audio.js';
import { Hud } from './hud.js';
import { Input } from './input.js';
import { TouchControls } from './touch.js';
import { Squad } from './squad.js';

const BEST_KEY = 'slipstream.best';
const SENS_KEY = 'slipstream.sens';
const VOL_KEY = 'slipstream.vol';
const MAP_KEY = 'slipstream.map';
const QUALITY_KEY = 'slipstream.quality';
const DIFF_KEY = 'slipstream.diff';

class Game {
  constructor() {
    this.app = document.getElementById('app');

    // A coarse pointer or a small touch screen gets the on-screen controls and
    // the cheaper render path. Body class drives the mobile CSS layout.
    this.isTouch =
      window.matchMedia('(pointer: coarse)').matches ||
      (navigator.maxTouchPoints > 0 && window.innerWidth < 1200);
    document.body.classList.toggle('touch', this.isTouch);

    this.baseDpr = Math.min(window.devicePixelRatio || 1, this.isTouch ? 1.4 : 1.6);
    this.dprScale = 1;
    this.quality = readString(QUALITY_KEY, 'auto');
    this.bloomAllowed = this.quality !== 'performance';

    this.renderer = new THREE.WebGLRenderer({ antialias: !this.isTouch, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(this.currentDpr());
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    // we report the scene's draw calls, so don't let each internal render pass
    // reset the counters
    this.renderer.info.autoReset = false;
    this.app.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.FogExp2(0x05070f, 0.0105);
    this.camera = new THREE.PerspectiveCamera(88, window.innerWidth / window.innerHeight, 0.05, 420);
    this.scene.add(this.camera);

    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(
      new THREE.Vector2(window.innerWidth, window.innerHeight),
      this.isTouch ? 0.5 : 0.62,
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
    this.weapons = new WeaponSystem(
      this.camera, this.scene, this.audio, this.effects, this.player, this.world, this.enemies
    );
    this.weapon = this.weapons;
    this.squad = new Squad(this);

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
    this.mapId = readString(MAP_KEY, 'circuit');
    this.difficulty = readString(DIFF_KEY, 'standard');

    this.weapons.onShoot = () => {
      this.shots++;
    };
    this.weapons.onHit = (info) => this.handleHit(info);
    this.weapons.onSwitch = () => this.hud.setWeapon(this.weapons.index);

    this.enemies.onPickup = (amount) => {
      this.hud.popCenter(`+${amount} INTEGRITY`, 'bonus', -70);
    };

    this.hud.setBest(this.best);
    this.bindUi();
    this.applySettingsFromStorage();
    this.selectMap(this.mapId, true);
    this.setDifficulty(this.difficulty, true);
    this.applyQuality(this.quality, true);
    this.hud.showStart();
    this.hud.setWeapon(0);

    if (this.isTouch) {
      const startBtn = document.getElementById('btn-start');
      if (startBtn) startBtn.textContent = 'TAP TO PLAY';
      const pauseKeys = document.querySelector('#screen-pause .keys');
      if (pauseKeys) pauseKeys.textContent = 'Left stick to move · drag the right side to aim · tap the weapon strip to swap';
      const overKeys = document.querySelector('#screen-over .keys');
      if (overKeys) overKeys.textContent = 'Tap RUN IT BACK to restart';
    }

    this.player.reset(this.world.spawnAt.clone());
    this.weapons.setVisible(false);
    this.hud.off();

    this.clock = new THREE.Clock();
    this.frameAcc = 0;
    this.frameCount = 0;
    this.fps = 60;
    this.drawCalls = 0;
    this.perfWindow = 0;
    this.slowWindows = 0;

    window.addEventListener('resize', () => this.onResize());
    window.addEventListener('orientationchange', () => setTimeout(() => this.onResize(), 250));
    this.renderer.setAnimationLoop(() => this.loop());

    // warm the shader cache so the first frames of a run don't hitch
    this.renderer.compile?.(this.scene, this.camera);

    // handy for debugging from the console (and for automated smoke tests)
    window.__game = this;
  }

  // ------------------------------------------------------------ quality / dpr
  currentDpr() {
    const cap = this.quality === 'high'
      ? (this.isTouch ? 1.8 : 2)
      : this.quality === 'performance'
        ? 1
        : this.baseDpr;
    return Math.max(0.55, Math.min(cap, cap * this.dprScale));
  }

  applyQuality(mode, initial = false) {
    this.quality = mode;
    this.bloomAllowed = mode !== 'performance';
    if (!initial) store(QUALITY_KEY, mode);
    this.dprScale = mode === 'high' ? 1 : mode === 'performance' ? 0.8 : 1;
    this.renderer.setPixelRatio(this.currentDpr());
    this.bloom.enabled = this.bloomAllowed;
    this.onResize();
    for (const el of document.querySelectorAll('[data-quality]')) {
      el.classList.toggle('sel', el.dataset.quality === mode);
    }
    this.hud.setQualityLabel(mode);
  }

  setDprScale(scale) {
    const next = Math.max(0.55, Math.min(1, scale));
    if (Math.abs(next - this.dprScale) < 0.01) return;
    this.dprScale = next;
    this.renderer.setPixelRatio(this.currentDpr());
    this.onResize();
  }

  // Adaptive resolution: hold the frame rate first, resolution second. One
  // window per half second, with a dead band so it cannot ping-pong.
  samplePerf(raw, calls) {
    this.frameAcc += raw;
    this.frameCount++;
    this.drawCalls = calls;
    if (this.frameAcc < 0.5) return;
    this.fps = Math.round(this.frameCount / this.frameAcc);
    this.frameAcc = 0;
    this.frameCount = 0;
    this.hud.setFps(this.fps);
    if (this.quality !== 'auto') return;

    if (this.fps < 48) {
      this.slowWindows++;
      this.setDprScale(this.dprScale - 0.08);
      if (this.slowWindows >= 3 && this.bloom.enabled) {
        this.bloom.enabled = false;
        this.slowWindows = 0;
      }
    } else if (this.fps > 58) {
      this.slowWindows = 0;
      if (!this.bloom.enabled && this.fps > 62) this.bloom.enabled = this.bloomAllowed;
      if (this.dprScale < 1) this.setDprScale(this.dprScale + 0.04);
    }
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

    // map picker
    for (const el of document.querySelectorAll('[data-map]')) {
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        this.audio.init();
        this.audio.ui();
        this.selectMap(el.dataset.map);
      });
    }

    for (const el of document.querySelectorAll('[data-quality]')) {
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        this.audio.ui();
        this.applyQuality(el.dataset.quality);
      });
    }

    // difficulty: in a squad the host owns the wave, so a guest only gets told
    for (const el of document.querySelectorAll('[data-diff]')) {
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        this.audio.ui();
        if (this.squad.isGuest) {
          this.squad.setStatus('THE HOST SETS THE SQUAD DIFFICULTY');
          return;
        }
        this.setDifficulty(el.dataset.diff);
      });
    }

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

  // --------------------------------------------------------------- map select
  selectMap(id, initial = false) {
    const map = this.world.build(id);
    this.mapId = map.id;
    if (!initial) store(MAP_KEY, map.id);

    this.scene.fog.color.setHex(this.world.fogColor || 0x05070f);
    if (this.world.floorMat) this.world.floorMat.color.setHex(this.world.floorTint ?? 0xffffff);

    for (const el of document.querySelectorAll('[data-map]')) {
      el.classList.toggle('sel', el.dataset.map === map.id);
    }
    const blurb = document.getElementById('map-blurb');
    if (blurb) blurb.textContent = `${map.tag} — ${map.blurb}`;
    this.hud.setMap(this.mapLabel());

    this.player.reset(this.world.spawnAt.clone());
    this.renderer.compile?.(this.scene, this.camera);
    return map;
  }

  // -------------------------------------------------------------- difficulty
  // the arena label doubles as the tier readout, so the run always shows what
  // rules it is being fought under
  mapLabel() {
    const name = this.world.mapId.toUpperCase();
    const tier = this.enemies.mods ? this.enemies.mods.name : '';
    return tier ? `${name} · ${tier}` : name;
  }

  setDifficulty(id, initial = false) {
    const diff = this.enemies.setDifficulty(id);
    this.difficulty = diff.id;
    if (!initial) store(DIFF_KEY, diff.id);
    for (const el of document.querySelectorAll('[data-diff]')) {
      el.classList.toggle('sel', el.dataset.diff === diff.id);
    }
    const blurb = document.getElementById('diff-blurb');
    if (blurb) blurb.textContent = `${diff.name} — ${diff.blurb}`;
    this.hud.setMap(this.mapLabel());
    return diff;
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
      this.weapons.setVisible(true);
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
        this.weapons.setVisible(true);
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
    this.weapons.setVisible(false);
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
    this.weapons.setVisible(true);
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
    this.composer.setPixelRatio?.(this.renderer.getPixelRatio());
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
    this.player.reset(this.world.spawnAt.clone());
    this.weapons.reset();
    this.weapons.setVisible(true);

    this.hud.reset();
    this.hud.on();
    this.hud.hideStart();
    this.hud.hidePause();
    this.hud.hideOver();
    this.hud.setBest(this.best);
    this.hud.setScore(0);
    this.hud.setHealth(this.player.health, this.player.maxHealth);
    this.hud.setMap(this.mapLabel());
    this.hud.setWeapon(0);
    this.hud.setAmmo(this.weapons.ammo, this.weapons.magSize, false, this.weapons.def);
    this.hud.setWave(1, 0);

    this.startWave(1);
    this.state = 'playing';
    if (this.isTouch && this.touch) this.touch.show();
    this.squad.onRunStart();
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
    if (this.squad && this.squad.isGuest) {
      this.hud.setWave(n, 0);
      return;
    }
    this.enemies.spawnWave(n, this.player.pos);
    this.hud.setWave(n, this.enemies.remaining());
    const sub = n === 1 ? `${waveSubtitle(n)} · ${this.enemies.mods.name}` : waveSubtitle(n);
    this.hud.banner(`WAVE ${String(n).padStart(2, '0')}`, sub);
    this.audio.waveStart(n);
  }

  startDeath() {
    this.state = 'dead';
    if (this.touch) this.touch.hide();
    this.deathTimer = 1.35;
    this.audio.gameOver();
    this.weapons.setVisible(false);
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
    // guests report hits to the host, which owns enemy health and scoring
    if (this.squad.reportHit({ enemy, point, headshot, damage })) return;
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

    this.renderer.info.reset();
    this.composer.render();
    this.input.endFrame();
    this.samplePerf(raw, this.renderer.info.render.calls);
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
      this.weapons.update(d, this.input, controlling && !this.player.dead);
      // guests render the host's wave instead of running the AI themselves
      if (!this.squad.isGuest) this.enemies.update(d, this.player, this.t);
      this.squad.update(d);
      this.updateGame(d, raw);
    } else if (this.state === 'dead' || this.state === 'over') {
      this.player.update(raw, this.input, 0);
      this.weapons.update(raw, this.input, false);
      this.enemies.update(raw, this.player, this.t);
      if (this.state === 'dead') {
        this.deathTimer -= raw;
        if (this.deathTimer <= 0 && !this.overShown) this.showGameOver();
      }
    }
  }

  updateGame(dt) {
    if (this.player.dead) {
      // in co-op a downed player rebuilds instead of ending the run
      if (this.squad.handleDown()) return;
      this.startDeath();
      return;
    }

    // stats + HUD
    this.topSpeed = Math.max(this.topSpeed, this.player.horizSpeed());
    const def = this.weapons.def;
    this.hud.setHealth(this.player.health, this.player.maxHealth);
    this.hud.setAmmo(this.weapons.ammo, this.weapons.magSize, this.weapons.reloading, def);
    this.hud.setWeapons(this.weapons.allAmmo(), this.weapons.index, this.weapons.reloading);
    this.hud.setDash(1 - this.player.dashCooldown / 1.65);
    this.hud.setSpeed(this.player.horizSpeed());
    this.hud.setWave(this.wave, this.enemies.remaining());
    this.hud.crosshairSpread(this.weapons.spreadPixels());
    this.hud.setFocused(this.weapons.ads > 0.5);

    if (this.combo > 0) {
      this.comboTimer -= dt;
      if (this.comboTimer <= 0) this.combo = 0;
    }
    this.hud.setCombo(this.combo, this.multiplier(), Math.max(0, this.comboTimer) / 5);

    if (this.t - this.startedAt > 9) this.hud.fadeHint();

    // wave flow: the host is the only authority that advances waves in co-op
    if (this.squad.isGuest) return;

    if (!this.waveCleared && this.enemies.remaining() === 0) {
      this.waveCleared = true;
      this.waveDelay = 2.6;
      const bonus = 200 + this.wave * 75;
      const heal = this.enemies.mods.waveHeal;
      this.score += bonus;
      this.hud.setScore(this.score);
      this.hud.banner('WAVE CLEAR', `+${bonus} BONUS · +${heal} INTEGRITY`);
      this.audio.waveClear();
      this.player.heal(heal);
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
    /* storage can be blocked; settings just won't persist */
  }
}

new Game();

export { Game, MAPS };
