import * as THREE from 'three';

// All HUD/screen DOM wiring. Writes are cached so the per-frame update stays
// cheap, and every readout is driven directly by simulation state.
export class Hud {
  constructor() {
    this.root = document.getElementById('hud');
    this.crosshair = document.getElementById('crosshair');
    this.hitmarkerEl = document.getElementById('hitmarker');
    this.pops = document.getElementById('pops');
    this.vignette = document.getElementById('damage-vignette');
    this.edgeGlow = document.getElementById('edge-glow');
    this.flashEl = document.getElementById('flash');
    this.bannerEl = document.getElementById('banner');
    this.bannerTitle = document.getElementById('banner-title');
    this.bannerSub = document.getElementById('banner-sub');
    this.hint = document.getElementById('hint');
    this.lockNotice = document.getElementById('lock-notice');

    this.el = {
      score: document.getElementById('score-num'),
      best: document.getElementById('best-num'),
      startBest: document.getElementById('start-best'),
      wave: document.getElementById('wave-num'),
      waveLeft: document.getElementById('wave-left'),
      hpNum: document.getElementById('hp-num'),
      hpFill: document.getElementById('hp-fill'),
      speedNum: document.getElementById('speed-num'),
      speedFill: document.getElementById('speed-fill'),
      ammoCur: document.getElementById('ammo-cur'),
      ammoMag: document.getElementById('ammo-mag'),
      ammoPips: document.getElementById('ammo-pips'),
      ammoTag: document.getElementById('reload-tag'),
      dashRing: document.getElementById('dash-ring'),
      combo: document.getElementById('combo'),
      comboNum: document.getElementById('combo-num'),
      comboMult: document.getElementById('combo-mult'),
      comboFill: document.getElementById('combo-fill'),
    };

    this.screens = {
      start: document.getElementById('screen-start'),
      pause: document.getElementById('screen-pause'),
      over: document.getElementById('screen-over'),
    };

    this.pips = [];
    this.lastPips = -1;
    this.cache = {};
    this.hintHidden = false;
    this._v = new THREE.Vector3();
    this._popsList = [];
    this._bannerTimer = 0;
    this._dmgTimer = 0;

    this.buildPips(30);
    this.reset();
  }

  buildPips(count) {
    this.el.ammoPips.innerHTML = '';
    this.pips = [];
    for (let i = 0; i < count; i++) {
      const pip = document.createElement('i');
      this.el.ammoPips.appendChild(pip);
      this.pips.push(pip);
    }
    this.lastPips = -1;
  }

  tx(el, value) {
    if (!el) return;
    const key = el.id;
    if (this.cache[key] === value) return;
    this.cache[key] = value;
    el.textContent = value;
  }

  on() {
    this.root.classList.add('on');
  }

  off() {
    this.root.classList.remove('on');
  }

  reset() {
    this.cache = {};
    this.clearPops();
    this.setHealth(100, 100);
    this.setAmmo(30, 30, false);
    this.setDash(1);
    this.setSpeed(0);
    this.setScore(0);
    this.setCombo(0, 1, 0);
    this.setWave(1, 0);
    this.setLowHp(false);
    this.setFocused(false);
    this.crosshairSpread(7);
    this.vignette.style.opacity = '0';
    this.flashEl.style.opacity = '0';
    this.bannerEl.classList.remove('show');
    this.hint.style.opacity = '1';
    this.hintHidden = false;
    this.lastPips = -1;
    this.hitmarkerEl.className = '';
  }

  setHealth(cur, max) {
    const pct = Math.max(0, Math.min(100, (cur / max) * 100));
    this.el.hpFill.style.width = `${pct}%`;
    this.tx(this.el.hpNum, String(Math.max(0, Math.ceil(cur))));
    this.setLowHp(cur / max < 0.33);
  }

  setLowHp(low) {
    this.el.hpFill.classList.toggle('low', low);
    this.edgeGlow.classList.toggle('on', low);
  }

  setAmmo(cur, mag, reloading) {
    this.tx(this.el.ammoCur, String(cur));
    this.tx(this.el.ammoMag, String(mag));
    this.el.ammoTag.classList.toggle('reloading', !!reloading);
    this.tx(this.el.ammoTag, reloading ? 'RELOADING…' : 'VX-9 ARC RIFLE');
    if (this.lastPips !== cur) {
      this.lastPips = cur;
      for (let i = 0; i < this.pips.length; i++) {
        this.pips[i].classList.toggle('spent', i >= cur);
      }
    }
  }

  setDash(ready01) {
    const pct = Math.max(0, Math.min(1, ready01));
    const ready = pct >= 0.999;
    this.el.dashRing.classList.toggle('cooling', !ready);
    if (!ready) this.el.dashRing.style.setProperty('--p', String(Math.round(pct * 360)));
  }

  setSpeed(v) {
    this.tx(this.el.speedNum, String(Math.round(v)));
    const pct = Math.min(100, (v / 26) * 100);
    if (this.cache.speedW !== pct) {
      this.cache.speedW = pct;
      this.el.speedFill.style.width = `${pct}%`;
    }
  }

  setScore(v) {
    this.tx(this.el.score, v.toLocaleString('en-US'));
  }

  setBest(v) {
    const s = v.toLocaleString('en-US');
    this.tx(this.el.best, s);
    this.tx(this.el.startBest, s);
  }

  setCombo(count, mult, frac) {
    this.tx(this.el.comboNum, String(count));
    this.tx(this.el.comboMult, `x${mult.toFixed(1)}`);
    this.el.comboFill.style.width = `${Math.max(0, Math.min(1, frac)) * 100}%`;
    this.el.combo.style.opacity = count > 0 ? '1' : '0.35';
  }

  setWave(n, remaining) {
    this.tx(this.el.wave, String(n));
    this.tx(this.el.waveLeft, String(remaining));
  }

  crosshairSpread(px) {
    const v = `${Math.max(3, Math.min(46, px)).toFixed(1)}px`;
    if (this.cache.spread === v) return;
    this.cache.spread = v;
    this.crosshair.style.setProperty('--gap', v);
  }

  setFocused(on) {
    this.root.classList.toggle('focus', !!on);
  }

  hitmarker(kind = 'hit') {
    const el = this.hitmarkerEl;
    el.className = '';
    // force the animation to restart
    void el.offsetWidth;
    el.className = `show ${kind}`;
  }

  damage(strength = 1) {
    this.vignette.style.opacity = String(Math.min(0.95, 0.45 + strength * 0.25));
    clearTimeout(this._dmgTimer);
    this._dmgTimer = setTimeout(() => {
      this.vignette.style.opacity = '0';
    }, 110);
  }

  flash(color = 'rgba(255,255,255,0.55)') {
    this.flashEl.style.background = color;
    this.flashEl.style.opacity = '1';
    clearTimeout(this._flashTimer);
    this._flashTimer = setTimeout(() => {
      this.flashEl.style.opacity = '0';
    }, 40);
  }

  popText(x, y, text, cls = '') {
    const div = document.createElement('div');
    div.className = `pop ${cls}`;
    div.textContent = text;
    div.style.left = `${x}px`;
    div.style.top = `${y}px`;
    this.pops.appendChild(div);
    this._popsList.push(div);
    while (this._popsList.length > 22) {
      const old = this._popsList.shift();
      if (old && old.parentNode) old.parentNode.removeChild(old);
    }
    setTimeout(() => {
      if (div.parentNode) div.parentNode.removeChild(div);
      const i = this._popsList.indexOf(div);
      if (i >= 0) this._popsList.splice(i, 1);
    }, 900);
  }

  popAtWorld(point, camera, text, cls = '', spread = 18) {
    this._v.copy(point).project(camera);
    if (this._v.z > 1) return;
    const x = (this._v.x * 0.5 + 0.5) * window.innerWidth + (Math.random() - 0.5) * spread;
    const y = (-this._v.y * 0.5 + 0.5) * window.innerHeight + (Math.random() - 0.5) * spread;
    this.popText(x, y, text, cls);
  }

  popCenter(text, cls = '', offset = 0) {
    this.popText(window.innerWidth * 0.5, window.innerHeight * 0.5 + offset, text, cls);
  }

  banner(title, sub = '') {
    this.bannerTitle.textContent = title;
    this.bannerSub.textContent = sub;
    this.bannerEl.classList.remove('show');
    void this.bannerEl.offsetWidth;
    this.bannerEl.classList.add('show');
  }

  clearPops() {
    this.pops.innerHTML = '';
    this._popsList = [];
  }

  showLockNotice(on) {
    if (!this.lockNotice) return;
    this.lockNotice.classList.toggle('on', !!on);
  }

  fadeHint() {
    if (this.hintHidden) return;
    this.hintHidden = true;
    this.hint.style.opacity = '0';
  }

  showStart() {
    this.screens.start.classList.remove('hidden');
  }

  hideStart() {
    this.screens.start.classList.add('hidden');
  }

  showPause() {
    this.screens.pause.classList.remove('hidden');
  }

  hidePause() {
    this.screens.pause.classList.add('hidden');
  }

  showGameOver(stats) {
    document.getElementById('over-score').textContent = stats.score.toLocaleString('en-US');
    document.getElementById('over-wave').textContent = String(stats.wave);
    document.getElementById('over-kills').textContent = String(stats.kills);
    document.getElementById('over-acc').textContent = `${stats.accuracy}%`;
    document.getElementById('over-speed').textContent = stats.topSpeed.toFixed(1);
    this.screens.over.classList.remove('hidden');
  }

  hideOver() {
    this.screens.over.classList.add('hidden');
  }
}
