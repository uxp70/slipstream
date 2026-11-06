// Audio for the wave-drop consumables. Kept beside the gameplay module rather
// than in AudioEngine so the new cues stay one self-contained layer: every
// sound is built from the engine's own primitives (noise buffer, percussive
// envelopes, stereo panner, reverb send), so it obeys master volume, pause
// ducking and the compressor exactly like the shipped weapon voices.
//
// The design rule for these three is the same as the menu layer: a transient
// that says *what happened* and a short body that says *how big*. Nothing here
// loops, and the only repeated cue (the turret shot) is deliberately quiet and
// fired sparsely, so a 26-second turret never becomes a metronome.
export class TacticalSfx {
  constructor(audio) {
    this.audio = audio;
  }

  get ready() {
    return !!(this.audio && this.audio.ready);
  }

  // Stereo position + distance gain for a world point.
  place(pos, camera) {
    if (!this.audio) return { pan: 0, gain: 1 };
    return this.audio.spatial(pos, camera);
  }

  tone(freq, opts = {}) {
    const a = this.audio;
    if (!this.ready) return;
    const {
      type = 'triangle',
      at = 0,
      dur = 0.2,
      gain = 0.06,
      to = null,
      pan = 0,
      send = 0.22,
      attack = 0.004,
    } = opts;
    const ctx = a.ctx;
    const t = a.now() + at;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(Math.max(18, freq), t);
    if (to) o.frequency.exponentialRampToValueAtTime(Math.max(18, to), t + dur);
    const g = ctx.createGain();
    a.perc(g.gain, t, gain, attack, dur);
    const out = a.panner(pan);
    o.connect(g).connect(out);
    if (send > 0) {
      const s = ctx.createGain();
      s.gain.value = send;
      g.connect(s).connect(a.verbSend);
    }
    o.start(t);
    o.stop(t + attack + dur + 0.03);
  }

  hiss(opts = {}) {
    const a = this.audio;
    if (!this.ready) return;
    const {
      at = 0,
      dur = 0.3,
      gain = 0.18,
      pan = 0,
      send = 0.3,
      type = 'lowpass',
      from = 1800,
      to = 200,
      q = 1,
      rate = 1,
      attack = 0.004,
    } = opts;
    const ctx = a.ctx;
    const t = a.now() + at;
    const n = a.noise(rate);
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.Q.value = q;
    f.frequency.setValueAtTime(Math.max(40, from), t);
    f.frequency.exponentialRampToValueAtTime(Math.max(40, to), t + dur);
    const g = ctx.createGain();
    a.perc(g.gain, t, gain, attack, dur);
    n.connect(f).connect(g);
    g.connect(a.panner(pan));
    if (send > 0) {
      const s = ctx.createGain();
      s.gain.value = send;
      g.connect(s).connect(a.verbSend);
    }
  }

  // ------------------------------------------------------------- the reward
  // Awarded at the end of a milestone wave: a small major arpeggio, well under
  // a second, so it reads as a pickup and never covers the wave-clear fanfare.
  grant() {
    const notes = [659.25, 830.61, 987.77];
    notes.forEach((f, i) => {
      this.tone(f, { type: 'triangle', at: i * 0.055, dur: 0.3, gain: 0.05, send: 0.4 });
      this.tone(f * 2, { type: 'sine', at: i * 0.055, dur: 0.12, gain: 0.018, send: 0.2 });
    });
    this.hiss({ at: 0, dur: 0.18, gain: 0.03, type: 'highpass', from: 3000, to: 6000, send: 0.2 });
  }

  // Pressed with nothing in the pocket: a flat double thud, lower than any
  // weapon cue so it is unmistakably "no".
  deny() {
    this.tone(150, { type: 'square', dur: 0.09, gain: 0.05, to: 96, send: 0.05 });
    this.tone(120, { type: 'square', at: 0.09, dur: 0.12, gain: 0.045, to: 80, send: 0.05 });
  }

  // --------------------------------------------------------------- turret
  // Servo unlock, then the two-note deploy chirp. The chirp is the important
  // part: it tells the player the post is live without them looking at it.
  turretDeploy(pos, camera) {
    const { pan, gain } = this.place(pos, camera);
    this.tone(240, { type: 'sawtooth', dur: 0.16, gain: 0.05 * gain, to: 520, pan, send: 0.1 });
    this.hiss({ dur: 0.12, gain: 0.05 * gain, pan, from: 2400, to: 900, send: 0.12 });
    this.tone(880, { type: 'sine', at: 0.12, dur: 0.09, gain: 0.05 * gain, pan, send: 0.25 });
    this.tone(1320, { type: 'sine', at: 0.22, dur: 0.12, gain: 0.04 * gain, pan, send: 0.3 });
  }

  // Fired on a subset of shots only; a turret at 6 shots a second would
  // otherwise lay a continuous synth buzz over the player's own gun.
  turretShot(pos, camera) {
    const { pan, gain } = this.place(pos, camera);
    this.hiss({ dur: 0.045, gain: 0.045 * gain, pan, type: 'bandpass', from: 2600, to: 1400, q: 1.4, send: 0.06 });
    this.tone(1500, { type: 'triangle', dur: 0.05, gain: 0.022 * gain, to: 640, pan, send: 0.06 });
  }

  // Power-down: pitch falls out of the chirp's register and ends on a clunk.
  turretExpire(pos, camera) {
    const { pan, gain } = this.place(pos, camera);
    this.tone(620, { type: 'triangle', dur: 0.5, gain: 0.045 * gain, to: 90, pan, send: 0.2 });
    this.hiss({ at: 0.34, dur: 0.1, gain: 0.06 * gain, pan, from: 1200, to: 200, send: 0.1 });
  }

  // ----------------------------------------------------------- drone strike
  // Two clipped radio beeps: the call is acknowledged, the run is coming.
  strikeCall(pos, camera) {
    const { pan, gain } = this.place(pos, camera);
    this.tone(1720, { type: 'square', dur: 0.035, gain: 0.032 * gain, pan, send: 0.08 });
    this.tone(1720, { type: 'square', at: 0.075, dur: 0.035, gain: 0.03 * gain, pan, send: 0.08 });
    this.hiss({ at: 0.11, dur: 0.14, gain: 0.035 * gain, pan, type: 'highpass', from: 2200, to: 3800, send: 0.1 });
  }

  // The telegraph: a thin descending whistle that lands exactly on the first
  // impact, so the player hears the timer rather than reading it.
  strikeWarn(pos, camera, dur = 1.5) {
    const { pan, gain } = this.place(pos, camera);
    this.tone(980, { type: 'sine', dur, gain: 0.05 * gain, to: 240, pan, send: 0.35, attack: 0.25 });
    this.tone(490, { type: 'triangle', dur, gain: 0.02 * gain, to: 120, pan, send: 0.2, attack: 0.3 });
  }

  // One pass of the strafe. Slightly smaller than the engine's rocket blast so
  // a seven-hit run builds instead of clipping.
  strikeBoom(pos, camera) {
    const { pan, gain } = this.place(pos, camera);
    this.hiss({ dur: 0.65, gain: 0.34 * gain, pan, from: 1500, to: 90, send: 0.4 });
    this.tone(96, { type: 'sine', dur: 0.55, gain: 0.32 * gain, to: 26, pan, send: 0.25 });
    this.hiss({ at: 0.04, dur: 0.3, gain: 0.14 * gain, pan, type: 'highpass', from: 2600, to: 900, send: 0.3 });
  }

  // ------------------------------------------------------------------ nuke
  // A rising siren with a tremolo on top: the one cue in the game that is
  // allowed to be long, because it is also the countdown.
  nukeCharge(dur = 2.4) {
    const a = this.audio;
    if (!this.ready) return;
    const ctx = a.ctx;
    const t = a.now();
    const o = ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(70, t);
    o.frequency.linearRampToValueAtTime(250, t + dur);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(500, t);
    lp.frequency.linearRampToValueAtTime(2400, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.16, t + dur * 0.9);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    // amplitude tremolo makes the siren read as a machine winding up
    const lfo = ctx.createOscillator();
    lfo.type = 'sine';
    lfo.frequency.setValueAtTime(6, t);
    lfo.frequency.linearRampToValueAtTime(18, t + dur);
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 0.05;
    lfo.connect(lfoGain).connect(g.gain);
    o.connect(lp).connect(g);
    g.connect(a.master);
    g.connect(a.verbSend);
    o.start(t);
    o.stop(t + dur + 0.05);
    lfo.start(t);
    lfo.stop(t + dur + 0.05);
    this.tone(52, { type: 'sine', dur, gain: 0.2, to: 40, send: 0.1, attack: 0.4 });
  }

  // The payoff: sub drop, wide noise, and a long metallic tail. Loud on
  // purpose, but the compressor catches it so it cannot swallow the gunfight.
  nukeBoom() {
    const a = this.audio;
    if (!this.ready) return;
    const ctx = a.ctx;
    const t = a.now();
    this.tone(74, { type: 'sine', dur: 1.7, gain: 0.5, to: 17, send: 0.35, attack: 0.01 });
    this.tone(110, { type: 'triangle', dur: 0.5, gain: 0.28, to: 32, send: 0.2 });
    this.hiss({ dur: 1.4, gain: 0.5, from: 5200, to: 60, send: 0.55, rate: 0.8 });
    this.hiss({ dur: 0.28, gain: 0.3, type: 'highpass', from: 1800, to: 5200, send: 0.4 });
    // metal ringing over the top, fading out well after the blast body
    const ring = ctx.createOscillator();
    ring.type = 'triangle';
    ring.frequency.setValueAtTime(2400, t);
    ring.frequency.exponentialRampToValueAtTime(180, t + 1.6);
    const rg = ctx.createGain();
    this.audio.perc(rg.gain, t, 0.05, 0.01, 1.8);
    const pan = ctx.createStereoPanner();
    pan.pan.value = 0;
    ring.connect(rg).connect(pan);
    pan.connect(a.master);
    rg.connect(a.verbSend);
    ring.start(t);
    ring.stop(t + 1.9);
  }

  // A short "field is clean" chime after the blast, so the silence that follows
  // a screen clear is a beat rather than a hole.
  nukeAfter() {
    [523.25, 783.99].forEach((f, i) =>
      this.tone(f, { type: 'sine', at: 0.55 + i * 0.12, dur: 0.6, gain: 0.035, send: 0.6 }),
    );
  }
}
