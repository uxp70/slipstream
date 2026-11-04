import * as THREE from 'three';

// Per-weapon voice: crack (transient brightness), body (blast pitch), tail
// (metallic ring), gain and base pitch. Enough to tell them apart with eyes shut.
const SHOOT_PROFILES = {
  rifle: { crack: 2600, body: 230, tail: 1250, gain: 0.9, pitch: 0.93 },
  shotgun: { crack: 1500, body: 150, tail: 780, gain: 1.15, pitch: 0.8 },
  rail: { crack: 4200, body: 320, tail: 1900, gain: 1.05, pitch: 1.06 },
  rocket: { crack: 900, body: 120, tail: 520, gain: 1.05, pitch: 0.72 },
};

// Fully procedural audio: every sound effect is synthesized with Web Audio,
// so there are no asset downloads and every shot has slight pitch variation.
// Weapon shots are layered transient + body + sub + metallic tail, the same
// technique used for gun sound design in shipped shooters.
export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.ready = false;
    this.volume = 0.7;
    this.paused = false;
    this._tmpA = new THREE.Vector3();
    this._tmpB = new THREE.Vector3();
  }

  init() {
    if (this.ready) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = (this.ctx = new AC());

    this.master = ctx.createGain();
    this.master.gain.value = this.volume;

    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -16;
    comp.knee.value = 22;
    comp.ratio.value = 5;
    comp.attack.value = 0.003;
    comp.release.value = 0.2;
    this.master.connect(comp);
    comp.connect(ctx.destination);

    // small procedural plate reverb used as a send
    this.verb = ctx.createConvolver();
    this.verb.buffer = this.makeIR(1.9, 2.6);
    this.verbSend = ctx.createGain();
    this.verbSend.gain.value = 0.5;
    this.verbSend.connect(this.verb);
    this.verb.connect(this.master);

    this.noiseBuf = this.makeNoise(3);
    this.ready = true;

    this.startAmbience();
    this.startWind();
  }

  // ---------------------------------------------------------------- helpers
  now() {
    return this.ctx.currentTime;
  }

  makeNoise(seconds) {
    const ctx = this.ctx;
    const len = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    return buf;
  }

  makeIR(seconds, decay) {
    const ctx = this.ctx;
    const rate = ctx.sampleRate;
    const len = Math.floor(rate * seconds);
    const buf = ctx.createBuffer(2, len, rate);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      for (let i = 0; i < len; i++) {
        const t = i / len;
        // sparse early reflections + exponential tail
        const tail = Math.pow(1 - t, decay) * (Math.random() * 2 - 1);
        const early = i < rate * 0.06 ? (Math.random() < 0.002 ? 1 : 0) : 0;
        d[i] = tail * 0.7 + early * 0.4;
      }
    }
    return buf;
  }

  noise(rate = 1) {
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.playbackRate.value = rate;
    src.start(this.now(), Math.random() * 1.4);
    return src;
  }

  // attack / exponential decay envelope on a gain param
  perc(param, t, peak, attack, decay) {
    param.cancelScheduledValues(t);
    param.setValueAtTime(0.0001, t);
    param.exponentialRampToValueAtTime(Math.max(peak, 0.0002), t + attack);
    param.exponentialRampToValueAtTime(0.0001, t + attack + decay);
  }

  panner(pan = 0) {
    const p = this.ctx.createStereoPanner();
    p.pan.value = Math.max(-1, Math.min(1, pan));
    p.connect(this.master);
    return p;
  }

  // stereo placement for a world position relative to the camera
  spatial(pos, camera) {
    if (!camera) return { pan: 0, gain: 1 };
    const toSrc = this._tmpA.subVectors(pos, camera.position);
    const dist = toSrc.length();
    toSrc.normalize();
    const right = this._tmpB.set(1, 0, 0).applyQuaternion(camera.quaternion);
    const pan = toSrc.dot(right) * 0.85;
    const gain = Math.max(0.05, Math.min(1, 22 / Math.max(4, dist)));
    return { pan, gain };
  }

  setVolume(v) {
    this.volume = v;
    if (!this.ready) return;
    this.master.gain.setTargetAtTime(this.paused ? v * 0.35 : v, this.now(), 0.1);
  }

  setPaused(p) {
    this.paused = p;
    if (!this.ready) return;
    this.master.gain.setTargetAtTime(p ? this.volume * 0.35 : this.volume, this.now(), 0.12);
  }

  // ---------------------------------------------------------------- weapons
  // Each weapon gets its own voice: the rifle cracks, the shotgun thumps, the
  // rail rings out and the launcher is all body.
  shoot(volume = 1, kind = 'rifle') {
    if (!this.ready) return;
    const ctx = this.ctx;
    const t = this.now();
    const profile = SHOOT_PROFILES[kind] || SHOOT_PROFILES.rifle;
    const pitch = profile.pitch + Math.random() * 0.14;
    volume *= profile.gain;

    // 1. transient crack
    {
      const n = this.noise(1);
      const hp = ctx.createBiquadFilter();
      hp.type = 'highpass';
      hp.frequency.value = 620;
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = profile.crack * pitch;
      bp.Q.value = 0.8;
      const g = ctx.createGain();
      this.perc(g.gain, t, 0.5 * volume, 0.002, 0.1);
      n.connect(hp).connect(bp).connect(g);
      g.connect(this.master);
      g.connect(this.verbSend);
    }

    // 2. body / blast
    {
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.setValueAtTime(profile.body * pitch, t);
      o.frequency.exponentialRampToValueAtTime(58, t + 0.11);
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.setValueAtTime(1600, t);
      lp.frequency.exponentialRampToValueAtTime(320, t + 0.14);
      const g = ctx.createGain();
      this.perc(g.gain, t, 0.3 * volume, 0.004, 0.15);
      o.connect(lp).connect(g);
      g.connect(this.master);
      o.start(t);
      o.stop(t + 0.24);
    }

    // 3. sub thump that gives the shot weight
    {
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.setValueAtTime(115, t);
      o.frequency.exponentialRampToValueAtTime(41, t + 0.13);
      const g = ctx.createGain();
      this.perc(g.gain, t, 0.34 * volume, 0.003, 0.13);
      o.connect(g).connect(this.master);
      o.start(t);
      o.stop(t + 0.2);
    }

    // 4. metallic mechanical tail
    {
      const o = ctx.createOscillator();
      o.type = 'triangle';
      o.frequency.setValueAtTime(profile.tail * pitch, t);
      o.frequency.exponentialRampToValueAtTime(620, t + 0.16);
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = 1500;
      bp.Q.value = 3.5;
      const g = ctx.createGain();
      this.perc(g.gain, t, 0.055 * volume, 0.004, 0.18);
      o.connect(bp).connect(g);
      g.connect(this.master);
      g.connect(this.verbSend);
      o.start(t);
      o.stop(t + 0.24);
    }
  }

  explosion() {
    if (!this.ready) return;
    const ctx = this.ctx;
    const t = this.now();
    const n = this.noise(0.8);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(2600, t);
    lp.frequency.exponentialRampToValueAtTime(120, t + 0.5);
    const g = ctx.createGain();
    this.perc(g.gain, t, 0.42, 0.004, 0.5);
    n.connect(lp).connect(g);
    g.connect(this.master);
    g.connect(this.verbSend);
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(120, t);
    o.frequency.exponentialRampToValueAtTime(30, t + 0.45);
    const og = ctx.createGain();
    this.perc(og.gain, t, 0.45, 0.005, 0.45);
    o.connect(og).connect(this.master);
    o.start(t);
    o.stop(t + 0.55);
  }

  hit(headshot = false, combo = 0) {
    if (!this.ready) return;
    const t = this.now();
    const semis = Math.min(combo, 14) * 0.7 + (headshot ? 7 : 0);
    const base = 1250 * Math.pow(2, semis / 12);
    [1, 1.5].forEach((mult, i) => {
      const o = this.ctx.createOscillator();
      o.type = 'sine';
      o.frequency.value = base * mult;
      const g = this.ctx.createGain();
      this.perc(g.gain, t, (i ? 0.055 : 0.11) * (headshot ? 1.2 : 1), 0.002, i ? 0.05 : 0.075);
      o.connect(g).connect(this.master);
      o.start(t);
      o.stop(t + 0.12);
    });
    const n = this.noise(1);
    const bp = this.ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 4200;
    const g = this.ctx.createGain();
    this.perc(g.gain, t, 0.05, 0.001, 0.03);
    n.connect(bp).connect(g).connect(this.master);
  }

  kill() {
    if (!this.ready) return;
    const ctx = this.ctx;
    const t = this.now();
    // body implosion
    const n = this.noise(1);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(2400, t);
    lp.frequency.exponentialRampToValueAtTime(180, t + 0.32);
    const g = ctx.createGain();
    this.perc(g.gain, t, 0.34, 0.004, 0.34);
    n.connect(lp).connect(g);
    g.connect(this.master);
    g.connect(this.verbSend);
    // sub boom
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(170, t);
    o.frequency.exponentialRampToValueAtTime(34, t + 0.3);
    const og = ctx.createGain();
    this.perc(og.gain, t, 0.4, 0.004, 0.3);
    o.connect(og).connect(this.master);
    o.start(t);
    o.stop(t + 0.38);
    // shimmer
    const s = ctx.createOscillator();
    s.type = 'triangle';
    s.frequency.setValueAtTime(1500, t);
    s.frequency.exponentialRampToValueAtTime(3200, t + 0.18);
    const sg = ctx.createGain();
    this.perc(sg.gain, t, 0.05, 0.006, 0.22);
    s.connect(sg);
    sg.connect(this.master);
    sg.connect(this.verbSend);
    s.start(t);
    s.stop(t + 0.3);
  }

  impact(pos, camera) {
    if (!this.ready) return;
    const { pan, gain } = this.spatial(pos, camera);
    if (gain < 0.06) return;
    const t = this.now();
    const n = this.noise(1.2 + Math.random() * 0.3);
    const bp = this.ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 900 + Math.random() * 1400;
    bp.Q.value = 1.4;
    const g = this.ctx.createGain();
    this.perc(g.gain, t, 0.1 * gain, 0.001, 0.06);
    n.connect(bp).connect(g).connect(this.panner(pan));
  }

  enemyShot(pos, camera) {
    if (!this.ready) return;
    const { pan, gain } = this.spatial(pos, camera);
    const t = this.now();
    const o = this.ctx.createOscillator();
    o.type = 'square';
    o.frequency.setValueAtTime(760, t);
    o.frequency.exponentialRampToValueAtTime(300, t + 0.14);
    const bp = this.ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 900;
    bp.Q.value = 2;
    const g = this.ctx.createGain();
    this.perc(g.gain, t, 0.1 * gain, 0.003, 0.13);
    o.connect(bp).connect(g).connect(this.panner(pan));
    o.start(t);
    o.stop(t + 0.2);
  }

  enemyDie(pos, camera) {
    if (!this.ready) return;
    const { pan, gain } = this.spatial(pos, camera);
    const t = this.now();
    const n = this.noise(1);
    const lp = this.ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(1800, t);
    lp.frequency.exponentialRampToValueAtTime(220, t + 0.26);
    const g = this.ctx.createGain();
    this.perc(g.gain, t, 0.16 * gain + 0.03, 0.004, 0.26);
    n.connect(lp).connect(g).connect(this.master);
  }

  charge(pos, camera) {
    if (!this.ready) return;
    const { pan, gain } = this.spatial(pos, camera);
    const t = this.now();
    const o = this.ctx.createOscillator();
    o.type = 'triangle';
    o.frequency.setValueAtTime(420, t);
    o.frequency.exponentialRampToValueAtTime(980, t + 0.34);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.05 * gain + 0.005, t + 0.2);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.4);
    o.connect(g).connect(this.panner(pan));
    o.start(t);
    o.stop(t + 0.45);
  }

  // ---------------------------------------------------------------- player
  jump() {
    if (!this.ready) return;
    const t = this.now();
    const n = this.noise(1);
    const bp = this.ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.setValueAtTime(700, t);
    bp.frequency.exponentialRampToValueAtTime(1900, t + 0.12);
    bp.Q.value = 1.2;
    const g = this.ctx.createGain();
    this.perc(g.gain, t, 0.13, 0.004, 0.12);
    n.connect(bp).connect(g).connect(this.master);
    const o = this.ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(190, t);
    o.frequency.exponentialRampToValueAtTime(320, t + 0.1);
    const og = this.ctx.createGain();
    this.perc(og.gain, t, 0.05, 0.004, 0.1);
    o.connect(og).connect(this.master);
    o.start(t);
    o.stop(t + 0.16);
  }

  land(impact) {
    if (!this.ready) return;
    const t = this.now();
    const power = Math.min(1, Math.max(0.25, impact / 14));
    const o = this.ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(130, t);
    o.frequency.exponentialRampToValueAtTime(44, t + 0.17);
    const g = this.ctx.createGain();
    this.perc(g.gain, t, 0.3 * power, 0.003, 0.17);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + 0.24);
    const n = this.noise(0.8);
    const lp = this.ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 900;
    const ng = this.ctx.createGain();
    this.perc(ng.gain, t, 0.12 * power, 0.002, 0.1);
    n.connect(lp).connect(ng).connect(this.master);
  }

  step(speed) {
    if (!this.ready) return;
    const t = this.now();
    const n = this.noise(1);
    const bp = this.ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 620 + Math.random() * 520;
    bp.Q.value = 2.4;
    const g = this.ctx.createGain();
    this.perc(g.gain, t, Math.min(0.075, 0.022 + speed * 0.0035), 0.001, 0.045);
    n.connect(bp).connect(g).connect(this.master);
  }

  dash() {
    if (!this.ready) return;
    const t = this.now();
    // air whoosh
    const n = this.noise(1);
    const bp = this.ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.Q.value = 0.7;
    bp.frequency.setValueAtTime(320, t);
    bp.frequency.exponentialRampToValueAtTime(2800, t + 0.16);
    bp.frequency.exponentialRampToValueAtTime(500, t + 0.34);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.26, t + 0.06);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.36);
    n.connect(bp).connect(g);
    g.connect(this.master);
    g.connect(this.verbSend);
    // pitch drop for the impulse
    const o = this.ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(260, t);
    o.frequency.exponentialRampToValueAtTime(58, t + 0.26);
    const og = this.ctx.createGain();
    this.perc(og.gain, t, 0.2, 0.005, 0.26);
    o.connect(og).connect(this.master);
    o.start(t);
    o.stop(t + 0.34);
  }

  reload() {
    if (!this.ready) return;
    this.clickAt(0.02, 0.1, 1300);
    this.clickAt(0.34, 0.09, 800);
    this.clickAt(0.62, 0.08, 1700);
    this.clickAt(1.0, 0.13, 500);
  }

  clickAt(delay, gain, freq) {
    const t = this.now() + delay;
    const n = this.noise(1);
    const bp = this.ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = freq;
    bp.Q.value = 4;
    const g = this.ctx.createGain();
    this.perc(g.gain, t, gain, 0.001, 0.05);
    n.connect(bp).connect(g);
    g.connect(this.master);
    g.connect(this.verbSend);
  }

  empty() {
    if (!this.ready) return;
    this.clickAt(0, 0.14, 2400);
    this.clickAt(0.06, 0.08, 1700);
  }

  pickup() {
    if (!this.ready) return;
    const t = this.now();
    [880, 1320, 1760].forEach((f, i) => {
      const o = this.ctx.createOscillator();
      o.type = 'sine';
      o.frequency.value = f;
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(0.0001, t + i * 0.06);
      g.gain.exponentialRampToValueAtTime(0.07, t + i * 0.06 + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t + i * 0.06 + 0.2);
      o.connect(g);
      g.connect(this.master);
      g.connect(this.verbSend);
      o.start(t + i * 0.06);
      o.stop(t + i * 0.06 + 0.26);
    });
  }

  playerHit() {
    if (!this.ready) return;
    const t = this.now();
    const n = this.noise(0.7);
    const lp = this.ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(1400, t);
    lp.frequency.exponentialRampToValueAtTime(260, t + 0.2);
    const g = this.ctx.createGain();
    this.perc(g.gain, t, 0.28, 0.002, 0.22);
    n.connect(lp).connect(g).connect(this.master);
    const o = this.ctx.createOscillator();
    o.type = 'triangle';
    o.frequency.setValueAtTime(160, t);
    o.frequency.exponentialRampToValueAtTime(70, t + 0.22);
    const og = this.ctx.createGain();
    this.perc(og.gain, t, 0.22, 0.003, 0.22);
    o.connect(og).connect(this.master);
    o.start(t);
    o.stop(t + 0.3);
  }

  jumpPad() {
    if (!this.ready) return;
    const t = this.now();
    const o = this.ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(240, t);
    o.frequency.exponentialRampToValueAtTime(880, t + 0.24);
    const g = this.ctx.createGain();
    this.perc(g.gain, t, 0.22, 0.005, 0.24);
    o.connect(g);
    g.connect(this.master);
    g.connect(this.verbSend);
    o.start(t);
    o.stop(t + 0.32);
  }

  dashReady() {
    if (!this.ready) return;
    const t = this.now();
    const o = this.ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(900, t);
    o.frequency.exponentialRampToValueAtTime(1400, t + 0.08);
    const g = this.ctx.createGain();
    this.perc(g.gain, t, 0.045, 0.004, 0.12);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + 0.18);
  }

  waveStart(n) {
    if (!this.ready) return;
    const t = this.now();
    const root = 82.4 * Math.pow(2, ((n - 1) % 5) / 12);
    [1, 1.5, 2, 3].forEach((mult, i) => {
      const o = this.ctx.createOscillator();
      o.type = i === 0 ? 'sine' : 'triangle';
      o.frequency.value = root * mult;
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.06 / (i + 1), t + 0.25);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 1.6);
      o.connect(g);
      g.connect(this.master);
      g.connect(this.verbSend);
      o.start(t);
      o.stop(t + 1.7);
    });
    const nz = this.noise(1);
    const bp = this.ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.Q.value = 0.8;
    bp.frequency.setValueAtTime(300, t);
    bp.frequency.exponentialRampToValueAtTime(4000, t + 0.7);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.06, t + 0.5);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 1.1);
    nz.connect(bp).connect(g);
    g.connect(this.master);
    g.connect(this.verbSend);
  }

  waveClear() {
    if (!this.ready) return;
    const t = this.now();
    [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => {
      const o = this.ctx.createOscillator();
      o.type = 'triangle';
      o.frequency.value = f;
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(0.0001, t + i * 0.09);
      g.gain.exponentialRampToValueAtTime(0.05, t + i * 0.09 + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t + i * 0.09 + 0.7);
      o.connect(g);
      g.connect(this.master);
      g.connect(this.verbSend);
      o.start(t + i * 0.09);
      o.stop(t + i * 0.09 + 0.8);
    });
  }

  gameOver() {
    if (!this.ready) return;
    const t = this.now();
    const o = this.ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(220, t);
    o.frequency.exponentialRampToValueAtTime(28, t + 1.4);
    const lp = this.ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(900, t);
    lp.frequency.exponentialRampToValueAtTime(120, t + 1.5);
    const g = this.ctx.createGain();
    this.perc(g.gain, t, 0.22, 0.02, 1.5);
    o.connect(lp).connect(g);
    g.connect(this.master);
    g.connect(this.verbSend);
    o.start(t);
    o.stop(t + 1.7);
  }

  ui() {
    if (!this.ready) return;
    const t = this.now();
    const o = this.ctx.createOscillator();
    o.type = 'square';
    o.frequency.value = 1080;
    const g = this.ctx.createGain();
    this.perc(g.gain, t, 0.03, 0.001, 0.035);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + 0.06);
  }

  // ---------------------------------------------------------------- beds
  startWind() {
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.loop = true;
    src.start();
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 420;
    bp.Q.value = 0.8;
    const g = ctx.createGain();
    g.gain.value = 0;
    src.connect(bp).connect(g).connect(this.master);
    this.windFilter = bp;
    this.windGain = g;
  }

  // speed-driven wind layer — one of the strongest cues that you are going fast
  setSpeed(speed) {
    if (!this.ready) return;
    const t = this.now();
    const target = Math.min(0.15, Math.max(0, (speed - 8) / 24) * 0.15);
    this.windGain.gain.setTargetAtTime(target, t, 0.1);
    this.windFilter.frequency.setTargetAtTime(260 + speed * 42, t, 0.12);
    this.windFilter.Q.setTargetAtTime(0.7 + speed * 0.02, t, 0.15);
  }

  startAmbience() {
    const ctx = this.ctx;
    const bus = ctx.createGain();
    bus.gain.value = 0.0001;
    bus.gain.linearRampToValueAtTime(0.1, ctx.currentTime + 4);

    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 300;
    lp.Q.value = 2.5;

    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.055;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 120;
    lfo.connect(lfoGain).connect(lp.frequency);
    lfo.start();

    [55, 82.5, 110, 164.81].forEach((f, i) => {
      const o = ctx.createOscillator();
      o.type = i === 2 ? 'triangle' : 'sine';
      o.frequency.value = f;
      o.detune.value = (Math.random() - 0.5) * 10;
      const g = ctx.createGain();
      g.gain.value = i === 3 ? 0.12 : 0.5;
      o.connect(g).connect(lp);
      o.start();
    });

    lp.connect(bus).connect(this.master);

    // high airy shimmer
    const air = ctx.createBufferSource();
    air.buffer = this.noiseBuf;
    air.loop = true;
    air.start();
    const airBp = ctx.createBiquadFilter();
    airBp.type = 'bandpass';
    airBp.frequency.value = 3200;
    airBp.Q.value = 0.6;
    const airG = ctx.createGain();
    airG.gain.value = 0.012;
    air.connect(airBp).connect(airG).connect(this.master);

    this.ambience = bus;
  }
}
