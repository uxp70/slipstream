import * as THREE from 'three';
import './contracts.css';

// Per-wave contracts. Two things ride on a wave and disappear with it:
//
//   ANOMALY — every fourth wave the arena itself changes the fight for one
//   wave: the swarm calls extras, the lights go out, or the ground starts
//   firing. It pays a score multiplier for the wave, so the modifiers are
//   risk with a number attached instead of a difficulty spike the player
//   cannot read.
//
//   BOUNTY — one enemy in the wave is marked, tougher, and worth coins (and on
//   odd waves a consumable charge). It gives the wave a target inside the
//   crowd and a reason to push through the swarm instead of backing off.
//
// The host owns both in co-op: guests never see a contract, which is better
// than a contract whose kills the host does not believe in.

const TAU = Math.PI * 2;
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

export const ANOMALIES = [
  { id: 'surge', name: 'SURGE', blurb: 'THE SWARM CALLS EXTRAS', mult: 1.25 },
  { id: 'blackout', name: 'BLACKOUT', blurb: 'THE LIGHTS GO OUT', mult: 1.35 },
  { id: 'storm', name: 'ION STORM', blurb: 'THE GROUND IS HOSTILE', mult: 1.2 },
];

const REWARD_NAME = { turret: 'TURRET', drone: 'DRONE STRIKE' };

export class Contracts {
  constructor(game) {
    this.game = game;
    this.wave = 0;
    this.anomaly = null;
    this.fogBase = null;
    this.lightBase = null;
    this.strikeTimer = 0;
    this.strikes = [];
    this.bounty = null;
    this.marker = null;
    this.pending = null;
    this._v = new THREE.Vector3();
    this.buildHud();
  }

  // ------------------------------------------------------------------- HUD
  buildHud() {
    if (typeof document === 'undefined') return;
    const bar = document.createElement('div');
    bar.id = 'contracts';
    bar.setAttribute('aria-label', 'Wave contracts');
    bar.innerHTML = '<span class="cchip" id="chip-anomaly"></span><span class="cchip bounty" id="chip-bounty"></span>';
    // it hangs off the wave corner so it flows under the hostiles count instead
    // of floating over the wave banner at whatever height the screen happens to be
    const host = document.querySelector('.hud-corner.tc') || document.body;
    host.appendChild(bar);
    this.bar = bar;
    this.chipAnomaly = bar.querySelector('#chip-anomaly');
    this.chipBounty = bar.querySelector('#chip-bounty');
  }

  paint() {
    if (!this.chipAnomaly) return;
    const a = this.anomaly;
    this.chipAnomaly.className = `cchip${a ? ` on ${a.id}` : ''}`;
    if (a) this.chipAnomaly.innerHTML = `<b>${a.name}</b><i>×${a.mult.toFixed(2)} SCORE</i>`;

    const b = this.pending || this.bounty;
    this.chipBounty.className = `cchip bounty${b ? ' on' : ''}`;
    if (b) {
      const coins = 25 + (b.wave || this.wave) * 6;
      const reward = b.reward ? ` · +${REWARD_NAME[b.reward]}` : '';
      this.chipBounty.innerHTML = `<b>BOUNTY</b><i>${coins} COINS${reward}</i>`;
    }
  }

  // --------------------------------------------------------------- lifecycle
  reset() {
    this.clear();
    this.wave = 0;
  }

  clear() {
    this.leaveAnomaly();
    this.strikes.length = 0;
    this.strikeTimer = 0;
    this.dropBounty();
    this.pending = null;
    this.paint();
  }

  enter(wave) {
    const game = this.game;
    if (game.squad && game.squad.isGuest) return;
    this.clear();
    this.wave = wave;

    if (wave >= 4 && wave % 4 === 0) {
      const slot = Math.floor(wave / 4) - 1;
      this.startAnomaly(ANOMALIES[slot % ANOMALIES.length]);
    }

    // A bounty every wave from the second, but only odd waves pay a charge:
    // coins alone would be too small a reason to leave cover, a charge every
    // wave would make the milestone drops meaningless.
    if (wave >= 2) {
      const reward = wave % 2 === 1 ? (Math.floor(wave / 2) % 2 ? 'drone' : 'turret') : null;
      this.pending = { wave, reward };
    }

    this.paint();
    if (this.pending) game.hud.popCenter('BOUNTY POSTED', 'bonus', -110);
  }

  // ---------------------------------------------------------------- anomalies
  startAnomaly(def) {
    const game = this.game;
    this.anomaly = def;

    if (def.id === 'surge') {
      const extra = clamp(2 + Math.floor(this.wave / 2), 2, 7);
      for (let i = 0; i < extra; i++) {
        game.enemies.spawn(i % 3 === 2 ? 'skitter' : 'drifter', game.player.pos);
      }
    } else if (def.id === 'blackout') {
      const fog = game.scene.fog;
      if (fog) {
        this.fogBase = fog.density;
        fog.density = Math.min(0.085, fog.density * 2.4);
      }
      const lights = game.world && game.world.lights;
      if (lights) {
        this.lightBase = ['key', 'rim', 'fill'].map((id) => [id, lights[id].intensity]);
        for (const [id] of this.lightBase) lights[id].intensity *= 0.34;
      }
      game.player.fovKick = 4;
    } else if (def.id === 'storm') {
      this.strikeTimer = 0.8;
    }

    game.audio.uiConfirm();
    game.hud.popCenter(def.name, 'bonus', -150);
  }

  leaveAnomaly() {
    const game = this.game;
    if (this.fogBase != null && game.scene.fog) {
      game.scene.fog.density = this.fogBase;
    }
    if (this.lightBase && game.world && game.world.lights) {
      for (const [id, value] of this.lightBase) game.world.lights[id].intensity = value;
    }
    this.fogBase = null;
    this.lightBase = null;
    this.anomaly = null;
  }

  scoreMult() {
    return this.anomaly ? this.anomaly.mult : 1;
  }

  // ------------------------------------------------------------------- storm
  strikePoint() {
    const player = this.game.player.pos;
    const limit = (this.game.world.bounds || 43) - 2;
    this._v.set(Math.random() * TAU, 0, 0);
    const a = this._v.x;
    const d = 5 + Math.random() * 9;
    return new THREE.Vector3(
      clamp(player.x + Math.cos(a) * d, -limit, limit),
      0.02,
      clamp(player.z + Math.sin(a) * d, -limit, limit),
    );
  }

  updateStorm(dt) {
    const game = this.game;
    this.strikeTimer -= dt;
    if (this.strikeTimer <= 0 && this.strikes.length < 2 && game.enemies.remaining() > 0) {
      this.strikeTimer = 1.15;
      const point = this.strikePoint();
      this.strikes.push({ point, t: 0.8 });
      game.effects.ring(point, 0xff8ad8, 0.5, 0.8, 5.2);
      game.audio.uiHover();
    }

    for (let i = this.strikes.length - 1; i >= 0; i--) {
      const s = this.strikes[i];
      s.t -= dt;
      if (s.t > 0) continue;
      this.strikes.splice(i, 1);
      this.detonate(s.point);
    }
  }

  detonate(point) {
    const game = this.game;
    game.effects.explosion(point, 0xff8ad8);
    game.effects.ring(point, 0xff8ad8, 1, 0.5, 14);
    game.effects.flash(point, 0xffd6f2, 9, 0.22);
    game.audio.explosion();
    const hits = game.enemies.damageRadius(point, 4.6, 135);
    for (const h of hits) {
      if (h.enemy.dead) continue;
      const res = game.enemies.hit(h.enemy, h.damage, h.enemy.pos.clone(), false);
      if (res.killed) game.contracts.noteKill(h.enemy);
    }
    const player = game.player;
    if (!player.dead && player.pos.distanceTo(point) < 4.4) {
      player.damage(11, point);
      player.addShake(0.2);
    }
  }

  // ------------------------------------------------------------------ bounty
  pickBounty() {
    const game = this.game;
    const list = game.enemies.list.filter((e) => !e.dead && !e.cfg.boss);
    if (!list.length) return;
    const enemy = list[(Math.random() * list.length) | 0];
    enemy.maxHp *= 1.55;
    enemy.hp = enemy.maxHp;
    enemy.bounty = true;

    const group = new THREE.Group();
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(0.95, 0.05, 6, 40),
      new THREE.MeshBasicMaterial({
        color: 0xffc063,
        transparent: true,
        opacity: 0.85,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    );
    ring.rotation.x = Math.PI / 2;
    group.add(ring);
    const beam = new THREE.Mesh(
      new THREE.CylinderGeometry(0.05, 0.05, 6, 6, 1, true),
      new THREE.MeshBasicMaterial({
        color: 0xffc063,
        transparent: true,
        opacity: 0.1,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
      }),
    );
    beam.position.y = 3;
    group.add(beam);
    group.position.copy(enemy.pos).setY(enemy.pos.y + 1.5);
    game.scene.add(group);

    this.marker = { group, ring, beam };
    this.bounty = { enemy, wave: this.pending.wave, reward: this.pending.reward, t: 0 };
    this.pending = null;
    this.paint();
    game.hud.popCenter('BOUNTY ACQUIRED', 'bonus', -110);
    game.audio.uiConfirm();
  }

  updateBounty(dt) {
    const game = this.game;
    const b = this.bounty;
    if (!b) return;
    const enemy = b.enemy;

    if (enemy.dead) {
      this.claim();
      return;
    }
    if (!game.enemies.list.includes(enemy)) {
      // the wave was torn down around it; nothing to pay for
      this.dropBounty();
      return;
    }

    b.t += dt;
    const m = this.marker;
    if (m) {
      m.group.position.copy(enemy.pos).setY(enemy.pos.y + 1.5 + Math.sin(b.t * 3) * 0.12);
      m.ring.scale.setScalar(1 + Math.sin(b.t * 4) * 0.06);
      m.ring.rotation.z += dt * 1.4;
      m.beam.material.opacity = 0.08 + Math.sin(b.t * 2.4) * 0.03;
    }
  }

  claim() {
    const game = this.game;
    const b = this.bounty;
    if (!b) return;
    const point = b.enemy.pos.clone().setY(Math.max(0.4, b.enemy.pos.y));
    const coins = 25 + b.wave * 6;
    game.gainCoins(coins);
    let extra = '';
    if (b.reward && game.consumables) {
      const counts = game.consumables.counts;
      counts[b.reward] = (counts[b.reward] || 0) + 1;
      game.consumables.paint();
      game.consumables.pulse(b.reward);
      extra = ` · +1 ${REWARD_NAME[b.reward]}`;
    }
    game.hud.popCenter(`BOUNTY CLAIMED · +${coins} COINS${extra}`, 'bonus', -150);
    game.effects.ring(point, 0xffc063, 1.3, 0.55, 10);
    game.effects.burst(point, 0xffc063, 28, 7, 0.18, 0.65, 3);
    game.audio.pickup();
    this.dropBounty();
  }

  dropBounty() {
    const game = this.game;
    if (this.bounty && this.bounty.enemy) this.bounty.enemy.bounty = false;
    this.bounty = null;
    if (this.marker) {
      game.scene.remove(this.marker.group);
      this.marker.group.traverse((o) => {
        if (o.geometry) o.geometry.dispose();
        if (o.material) o.material.dispose();
      });
      this.marker = null;
    }
    if (this.chipBounty) this.paint();
  }

  // Called when a contract kill lands through a path that is not the player's
  // gun (an anomaly strike, a turret, the nuke) so a bounty still pays out.
  noteKill(enemy) {
    if (this.bounty && this.bounty.enemy === enemy) {
      this.claim();
      return true;
    }
    return false;
  }

  // ------------------------------------------------------------------- tick
  update(dt) {
    if (this.game.squad && this.game.squad.isGuest) return;
    if (this.pending && !this.bounty) this.pickBounty();
    if (this.bounty) this.updateBounty(dt);
    if (this.anomaly && this.anomaly.id === 'storm') this.updateStorm(dt);
  }
}
