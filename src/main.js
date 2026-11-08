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
import { Online } from './online.js';
import { EventDirector } from './events.js';
import { Arsenal } from './inventory.js';
import { Armory } from './buffs.js';
import { Accounts } from './account.js';
import { Daily } from './daily.js';
import { Consumables } from './consumables.js';
import { Architecture } from './architecture.js';
import { Contracts } from './contracts.js';
import { Avatar } from './avatar.js';
import { Crates } from './crates.js';

const BEST_KEY = 'slipstream.best';
const SENS_KEY = 'slipstream.sens';
const VOL_KEY = 'slipstream.vol';
const MAP_KEY = 'slipstream.map';
const QUALITY_KEY = 'slipstream.quality';
const DIFF_KEY = 'slipstream.diff';
const VIEW_KEY = 'slipstream.view';

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
    // the strength quality picked; an event may overrule it, and switching back
    // to an event with no opinion has to restore this, not keep the last one
    this.bloomBase = this.bloom.strength;
    this.composer.addPass(new OutputPass());

    this.hud = new Hud();
    this.audio = new AudioEngine();
    this.input = new Input(this.renderer.domElement);
    this.input.touchMode = this.isTouch;
    this.touch = new TouchControls(this.input, { onPause: () => this.pause() });
    this.world = new World(this.scene);
    // render-only dressing: skyline, windows, rooflines; rebuilt with each map
    this.architecture = new Architecture(this.world);
    this.effects = new Effects(this.scene);
    this.player = new Player(this.camera, this.world, this.audio, this.effects);
    this.enemies = new EnemyManager(this.scene, this.audio, this.effects, this.world, this.camera);
    this.weapons = new WeaponSystem(
      this.camera, this.scene, this.audio, this.effects, this.player, this.world, this.enemies
    );
    this.weapon = this.weapons;
    // the third-person body is built once and hidden while first person is on
    this.avatar = new Avatar(this.scene, this.player, this.weapons);
    this.squad = new Squad(this);
    // The public arena is a separate transport from squad co-op: same game,
    // same weapons, server-owned health and no wave director.
    this.online = new Online(this);
    this.weapons.playerTargets = this.online;
    this.mode = 'solo';

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
    this.best = readNumber(BEST_KEY, 0);
    this.mapId = readString(MAP_KEY, 'circuit');
    this.difficulty = readString(DIFF_KEY, 'standard');
    // the event owns the arena list, the enemy skins and the gun skins
    this.eventId = 'neon';
    this.events = new EventDirector(this);
    // accounts own the wallet, the loadout and the squad callsign, so they are
    // built before anything that resolves a storage key through them
    this.accounts = new Accounts(this);
    this.account = this.accounts;
    // inventory: which gun sits in which slot, and which slot a run starts on
    this.arsenal = new Arsenal(this);
    this.arsenal.apply();
    // coins + the pre-match buff shop: armed buffs are spent by the next run
    this.armory = new Armory(this);
    // cosmetics: crate rolls, the collection, and which finish each gun wears
    this.crates = new Crates(this);
    // the daily drop pays into that same wallet, so it is built after the armory
    this.daily = new Daily(this);
    // wave drops: turret, drone strike, nuke — earned and spent inside one run
    this.consumables = new Consumables(this);
    // per-wave anomalies and bounty contracts; host-side only in co-op
    this.contracts = new Contracts(this);
    // a live session brings back the operator, its wallet and its loadout
    this.accounts.restore();
    // the collection is account-scoped too, and Crates is built before the
    // session restores, so read it again once the operator is known
    this.crates.reload();
    const applyAccount = this.accounts.apply.bind(this.accounts);
    this.accounts.apply = (record, silent) => {
      const out = applyAccount(record, silent);
      this.crates?.reload?.();
      return out;
    };
    const signOutAccount = this.accounts.signOut.bind(this.accounts);
    this.accounts.signOut = () => {
      const out = signOutAccount();
      this.crates?.reload?.();
      return out;
    };

    this.weapons.onShoot = () => {
      this.shots++;
      this.avatar.triggerFlash();
    };
    this.weapons.onHit = (info) => this.handleHit(info);
    this.weapons.onSwitch = () => {
      this.hud.setWeapon(this.weapons.index);
      this.avatar.setGun(this.weapons.weaponIndex());
      if (this.viewMode === 'third') this.weapons.muzzleSource = this.avatar.muzzleFor(this.weapons.weaponIndex());
    };

    this.enemies.onPickup = (amount) => {
      this.hud.popCenter(`+${amount} INTEGRITY`, 'bonus', -70);
    };

    this.hud.setBest(this.best);
    this.bindUi();
    this.applySettingsFromStorage();
    this.setViewMode(readString(VIEW_KEY, 'first'), true);
    this.events.init();
    this.selectMap(this.mapId, true);
    this.setDifficulty(this.difficulty, true);
    this.applyQuality(this.quality, true);
    this.hud.showStart();
    this.hud.setWeapon(0);
    this.syncStartHeadline();

    if (this.isTouch) {
      const startBtn = document.getElementById('btn-start');
      if (startBtn) startBtn.textContent = 'TAP TO PLAY';
      const pauseKeys = document.querySelector('#screen-pause .keys');
      if (pauseKeys) pauseKeys.textContent = 'Left stick to move · drag the right side to aim · tap the weapon strip to swap';
      const overKeys = document.querySelector('#screen-over .keys');
      if (overKeys) overKeys.textContent = 'Tap MAIN MENU to return to the hangar';
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
      this.audio.uiClose();
      this.toMenu();
    });

    // The hangar panels are screens of their own, so each transition gets the
    // short whoosh: opening sweeps up, closing sweeps down.
    for (const [id, sound] of [
      ['btn-arsenal', 'uiOpen'],
      ['btn-armory', 'uiOpen'],
      ['btn-account', 'uiOpen'],
      ['btn-daily', 'uiOpen'],
      ['btn-crates', 'uiOpen'],
      ['btn-arsenal-back', 'uiClose'],
      ['btn-armory-back', 'uiClose'],
      ['btn-daily-back', 'uiClose'],
      ['btn-crates-back', 'uiClose'],
      ['btn-login-back', 'uiClose'],
    ]) {
      document.getElementById(id)?.addEventListener('click', () => this.audio[sound]());
    }

    this.bindMenuHover();

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

    // both the start row and the pause panel carry the same two buttons
    for (const el of document.querySelectorAll('[data-view]')) {
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        this.audio.uiConfirm();
        this.setViewMode(el.dataset.view);
      });
    }

    // difficulty: in a squad the host owns the wave, so a guest only gets told
    for (const el of document.querySelectorAll('[data-diff]')) {
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        this.audio.uiConfirm();
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
        this.toMenu();
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

    // the event's art direction owns the atmosphere; the arena only supplies a
    // tint of its own for the neon events, which have no art of their own
    const art = this.world.art;
    this.scene.fog.color.setHex(art.fog.color ?? this.world.fogColor ?? 0x05070f);
    this.scene.fog.density = art.fog.density ?? 0.0105;
    // bloom and exposure stay whatever quality picked unless the event asks
    if (art.bloom.strength != null) this.bloom.strength = art.bloom.strength;
    else this.bloom.strength = this.bloomBase;
    if (art.bloom.radius != null) this.bloom.radius = art.bloom.radius;
    if (art.bloom.threshold != null) this.bloom.threshold = art.bloom.threshold;
    if (art.exposure != null) this.renderer.toneMappingExposure = art.exposure;

    // the arena decides the event (a squad guest adopts the host's event here)
    if (this.events) this.events.noteMap(map.id);
    const blurb = document.getElementById('map-blurb');
    if (blurb) blurb.textContent = `${map.tag} — ${map.blurb}`;
    this.hud.setMap(this.mapLabel());
    this.syncStartHeadline();

    this.player.reset(this.world.spawnAt.clone());
    this.architecture.build();
    this.renderer.compile?.(this.scene, this.camera);
    return map;
  }

  // -------------------------------------------------------------- difficulty
  // the arena label doubles as the tier readout, so the run always shows what
  // rules it is being fought under
  mapLabel() {
    const name = this.world.mapId.toUpperCase();
    const tier = this.online?.connected ? 'ONLINE' : this.enemies.mods ? this.enemies.mods.name : '';
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
    this.syncStartHeadline();
    return diff;
  }

  // first / third person. The movement model does not change; the camera boom,
  // the avatar and the tracer origin do.
  setViewMode(mode, initial = false) {
    const third = mode === 'third';
    this.viewMode = third ? 'third' : 'first';
    this.player.setThirdPerson(third);
    this.weapons.setCameraMode(third, third ? this.avatar.muzzleFor(this.weapons.weaponIndex()) : null);
    for (const el of document.querySelectorAll('[data-view]')) {
      el.classList.toggle('sel', el.dataset.view === this.viewMode);
    }
    if (!initial) store(VIEW_KEY, this.viewMode);
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
    if (this.state === 'menu') {
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
      if (this.state === 'menu') {
        this.beginRun();
      } else if (this.state === 'over') {
        // a stray click must not start a run behind the stats screen
        this.toMenu();
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
    this.audio.setMenu(false);

    this.score = 0;
    this.combo = 0;
    this.comboTimer = 0;
    this.kills = 0;
    this.shots = 0;
    this.hits = 0;
    this.headshots = 0;
    this.topSpeed = 0;
    this.runCoins = 0;
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

    // Public PvP: no wave, no armory spend, no NPCs. The server owns health,
    // respawns and score; everything local is movement, weapons and feedback.
    if (this.online?.connected) {
      this.mode = 'pvp';
      this.player.maxHealth = 100;
      this.player.dashCooldownMult = 1;
      this.player.healthRegen = false;
      this.player.reset(this.online.spawnPoint());
      this.weapons.reset();
      this.consumables.reset();
      this.contracts.reset();
      this.weapons.setVisible(true);

      this.hud.reset();
      this.hud.on();
      this.hud.hideStart();
      this.hud.hidePause();
      this.hud.hideOver();
      this.hud.setBest(this.best);
      this.hud.setScore(0);
      this.hud.setHealth(100, 100);
      this.hud.setMap(this.mapLabel());
      this.hud.setWeapon(0);
      this.hud.setAmmo(this.weapons.ammo, this.weapons.magSize, false, this.weapons.def);
      this.hud.setWave(0, 0);

      this.state = 'playing';
      if (this.isTouch && this.touch) this.touch.show();
      this.online.startRun();
      return;
    }

    this.mode = 'solo';
    // armed buffs are spent here, so their effects last exactly this run
    this.armory.beginRun();
    this.player.maxHealth = 100 + this.armory.bonusHealth();
    this.player.dashCooldownMult = this.armory.dashMult();
    this.player.healthRegen = true;
    this.player.reset(this.world.spawnAt.clone());
    this.weapons.reset();
    // drops never outlive the match that earned them
    this.consumables.reset();
    this.contracts.reset();
    this.weapons.setVisible(true);

    this.hud.reset();
    this.hud.setPvp(false);
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

  // A run ends on the report, not on another run: the report is a readout and
  // what happens next is a choice. Everything the hangar shows is repainted
  // here, so the next pick is made on numbers from the run that just ended.
  toMenu(force = false) {
    if (!force && (this.state === 'playing' || this.state === 'paused')) return;
    this.state = 'menu';
    this.mode = 'solo';
    this.player.dead = false;
    this.deathTimer = 0;
    this.overShown = false;
    this.hitstop = 0;
    this.hud.hideOver();
    this.hud.hidePause();
    this.consumables.clear();
    this.contracts.clear();
    this.hud.setBoss(null, 0);
    this.hud.setPvp(false);
    this.hud.setLowHp(false);
    this.hud.off();
    this.weapons.setVisible(false);
    this.hud.showStart();
    this.hud.setBest(this.best);
    this.armory.paint();
    this.arsenal.render();
    this.daily.paint();
    this.crates.paint();
    this.events.render();
    this.syncStartHeadline();
    this.audio.setMenu(true);
    if (this.touch) this.touch.hide();
  }

  // One line, always on screen, naming exactly what the big button starts.
  syncStartHeadline() {
    const where = this.world.mapId.toUpperCase();
    const online = !!this.online?.connected;
    const tier = online ? 'ONLINE' : this.enemies.mods ? this.enemies.mods.name : 'STANDARD';
    const mode = online
      ? `PVP · ${this.online.rows.length || 1} PLAYER${this.online.rows.length === 1 ? '' : 'S'}`
      : this.squad && this.squad.isGuest
        ? 'SQUAD GUEST'
        : 'SOLO';
    const context = document.getElementById('start-context');
    if (context) context.textContent = `${where} · ${tier} · ${mode}`;
    const match = document.getElementById('match-summary');
    const event = this.events && this.events.id ? this.events.id.toUpperCase() : 'NEON SIEGE';
    if (match) match.textContent = `${event} · ${where} · ${tier}`;
  }

  // A hover tick on everything pressable, throttled so sliding across a row of
  // cards reads as one sweep instead of a machine-gun of ticks.
  bindMenuHover() {
    const selector = 'button, .map-card, .event-card';
    let last = 0;
    let current = null;
    for (const screen of document.querySelectorAll('.screen')) {
      screen.addEventListener('pointerover', (e) => {
        const el = e.target.closest ? e.target.closest(selector) : null;
        if (!el || el === current) return;
        current = el;
        if (!this.audio.ready || el.disabled) return;
        const now = performance.now();
        if (now - last < 60) return;
        last = now;
        this.audio.uiHover();
      });
      screen.addEventListener('pointerout', (e) => {
        const el = e.target.closest ? e.target.closest(selector) : null;
        if (el && el === current) current = null;
      });
    }
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
    this.contracts.enter(n);
  }

  startDeath() {
    this.state = 'dead';
    if (this.touch) this.touch.hide();
    this.deathTimer = 1.35;
    this.audio.gameOver();
    this.weapons.setVisible(false);
    this.consumables.clear();
    this.contracts.clear();
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
      coins: this.runCoins,
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

  // coins are banked as they are earned, so a run that ends badly still pays
  gainCoins(amount) {
    const n = Math.max(0, Math.round(Number(amount) || 0));
    if (n > 0) this.armory.earn(n);
    this.runCoins = (this.runCoins || 0) + n;
    return n;
  }

  handleHit({ enemy, target, point, headshot, damage, weapon }) {
    // A PvP hit is resolved by the server: this reports it and shows the local
    // feedback, but never changes a remote player's health directly.
    if (target) {
      this.hits++;
      if (headshot) this.headshots++;
      this.online.reportHit(target, damage, headshot, weapon);
      this.audio.hit(headshot, this.combo);
      this.hud.hitmarker(headshot ? 'head' : 'hit');
      this.hud.popAtWorld(point, this.camera, String(Math.round(damage)), headshot ? 'head' : '');
      return;
    }
    // damage buffs multiply before the hit is reported, so a guest sends the
    // boosted number and the host applies it unchanged
    const dmg = damage * this.armory.damageMult();
    // guests report hits to the host, which owns enemy health and scoring
    if (this.squad.reportHit({ enemy, point, headshot, damage: dmg })) return;
    this.hits++;
    if (headshot) this.headshots++;
    const res = this.enemies.hit(enemy, dmg, point, headshot);
    this.audio.hit(headshot, this.combo);
    this.hud.hitmarker(res.killed ? 'kill' : headshot ? 'head' : 'hit');
    this.hud.popAtWorld(point, this.camera, String(Math.round(dmg)), headshot ? 'head' : '');

    if (res.killed) {
      this.kills++;
      this.combo++;
      this.comboTimer = 5;
      const mult = this.multiplier();
      const airborne = !this.player.onGround;
      const gained =
        Math.round(res.score * mult * this.contracts.scoreMult()) +
        (headshot ? 50 : 0) +
        (airborne ? 40 : 0);
      this.score += gained;
      this.hud.popAtWorld(point, this.camera, `+${gained}`, 'kill', 40);
      if (headshot) this.hud.popCenter('HEADSHOT +50', 'bonus', -54);
      if (airborne) this.hud.popCenter('AIRBORNE +40', 'bonus', -96);
      const coins = this.gainCoins(this.armory.killCoins(res.score));
      if (coins > 0) this.hud.popAtWorld(point, this.camera, `+${coins} COINS`, 'bonus', 64);
      if (enemy.cfg.boss) this.hud.popCenter('WARDEN DOWN', 'bonus', -120);
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

    // visibility follows whatever the weapon system is allowed to show, so the
    // body appears exactly when the first-person viewmodel would have
    this.avatar.update(raw, this.weapons.visible);

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
      if (this.online?.connected) {
        // No enemy simulation in the public arena; remote players come from
        // the server snapshot and every hit is reported over the socket.
        this.online.update(d);
      } else {
        // guests render the host's wave instead of running the AI themselves
        if (!this.squad.isGuest) this.enemies.update(d, this.player, this.t);
        this.squad.update(d);
        this.consumables.update(d);
        this.contracts.update(d);
      }
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

  updateCombatHud(dt) {
    this.topSpeed = Math.max(this.topSpeed, this.player.horizSpeed());
    const def = this.weapons.def;
    this.hud.setHealth(this.player.health, this.player.maxHealth);
    this.hud.setAmmo(this.weapons.ammo, this.weapons.magSize, this.weapons.reloading, def);
    this.hud.setWeapons(this.weapons.allAmmo(), this.weapons.index, this.weapons.reloading);
    this.hud.setDash(1 - this.player.dashCooldown / this.player.dashCycle());
    this.hud.setSpeed(this.player.horizSpeed());
    this.hud.crosshairSpread(this.weapons.spreadPixels());
    this.hud.setFocused(this.weapons.ads > 0.5);

    // the boss bar tracks the live warden, so it appears with the boss and clears
    // the frame it dies — on the host and on every guest alike
    const boss = this.enemies.findBoss();
    this.hud.setBoss(boss ? boss.cfg.name || 'BOSS' : null, boss ? boss.hp / boss.maxHp : 0);

    if (this.combo > 0) {
      this.comboTimer -= dt;
      if (this.comboTimer <= 0) this.combo = 0;
    }
    this.hud.setCombo(this.combo, this.multiplier(), Math.max(0, this.comboTimer) / 5);

    if (this.t - this.startedAt > 9) this.hud.fadeHint();
  }

  updateGame(dt) {
    if (this.online?.active) {
      this.updateCombatHud(dt);
      if (this.player.dead) {
        this.online.handleDown();
        return;
      }
      return;
    }

    if (this.player.dead) {
      // in co-op a downed player rebuilds instead of ending the run
      if (this.squad.handleDown()) return;
      this.startDeath();
      return;
    }

    this.updateCombatHud(dt);
    this.hud.setWave(this.wave, this.enemies.remaining());

    // wave flow: the host is the only authority that advances waves in co-op
    if (this.squad.isGuest) return;

    if (!this.waveCleared && this.enemies.remaining() === 0) {
      this.waveCleared = true;
      this.waveDelay = 2.6;
      const bonus = 200 + this.wave * 75;
      const heal = this.enemies.mods.waveHeal;
      const waveCoins = this.gainCoins(20 + this.wave * 8);
      this.score += bonus;
      this.hud.setScore(this.score);
      const drop = this.consumables.award(this.wave);
      this.hud.banner(
        'WAVE CLEAR',
        `+${bonus} BONUS · +${waveCoins} COINS · +${heal} INTEGRITY${drop ? ` · ${drop} READY` : ''}`,
      );
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
  if (n % 5 === 0) return 'THE WARDEN WAKES';
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
