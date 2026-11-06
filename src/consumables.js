import * as THREE from 'three';
import { TacticalSfx } from './tactical-sfx.js';
import './consumables.css';

// Wave-drop consumables. Every one of them is earned inside a run and thrown
// away with it: nothing here touches localStorage, the armory or the account,
// so a drop can never be banked for the next match.
//
// Cadence follows the same clock the warden uses (BOSS_EVERY = 5): clearing a
// wave you already had to survive the boss for is what pays the turret. The
// drone is on the ten, the nuke is on the fifty — one long-run payoff the
// player can plan around rather than another random pickup.
//
// Placement, not timers, is where the skill is: the turret wants a lane with
// sightlines and the drone wants the ground the swarm is walking over, so both
// ask the player to read the arena while moving.
const TAU = Math.PI * 2;
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

export const DROPS = [
  { id: 'turret', name: 'TURRET', short: 'TURRET', letter: 'X', key: 'KeyX', every: 5 },
  { id: 'drone', name: 'DRONE STRIKE', short: 'DRONE', letter: 'C', key: 'KeyC', every: 10 },
  { id: 'nuke', name: 'NUKE', short: 'NUKE', letter: 'V', key: 'KeyV', every: 50 },
];

const TURRET = {
  range: 30,
  interval: 0.16,
  damage: 16,
  life: 26,
  build: 0.35,
  shotsPerSound: 3,
};

const STRIKE = {
  delay: 1.55,
  radius: 6,
  damage: 165,
  hits: 7,
  spacing: 2.6,
  tick: 0.1,
};

const NUKE = {
  charge: 2.4,
  radius: 90,
  damage: 6000,
  bossShare: 0.45,
};

export class Consumables {
  constructor(game) {
    this.game = game;
    this.counts = { turret: 0, drone: 0, nuke: 0 };
    this.sentries = [];
    this.strikes = [];
    this.nuke = null;
    this.sfx = new TacticalSfx(game.audio);
    this._dir = new THREE.Vector3();
    this._point = new THREE.Vector3();
    this._up = new THREE.Vector3(0, 1, 0);
    this._geo = {
      base: new THREE.CylinderGeometry(0.62, 0.8, 0.16, 8),
      ring: new THREE.TorusGeometry(0.52, 0.035, 6, 28),
      post: new THREE.CylinderGeometry(0.12, 0.17, 0.7, 6),
      hull: new THREE.BoxGeometry(0.62, 0.3, 0.5),
      eye: new THREE.SphereGeometry(0.1, 12, 10),
      barrel: new THREE.CylinderGeometry(0.05, 0.05, 0.72, 6),
      mark: new THREE.TorusGeometry(6, 0.09, 6, 64),
      markInner: new THREE.TorusGeometry(2.2, 0.06, 6, 40),
      beam: new THREE.CylinderGeometry(0.05, 0.3, 9, 8, 1, true),
    };
    this.buildHud();
    this.paint();
  }

  // ------------------------------------------------------------------- HUD
  // The strip is built here rather than in index.html so the drop list has a
  // single source of truth: add a row to DROPS and it appears everywhere.
  buildHud() {
    const host = document.querySelector('.hud-bottom-left') || document.getElementById('hud');
    if (!host) return;
    const wrap = document.createElement('div');
    wrap.id = 'consumables';
    wrap.setAttribute('aria-label', 'Consumables');
    wrap.innerHTML = DROPS.map(
      (d) => `<button type="button" class="cslot empty" data-use="${d.id}" title="${d.name} — press ${d.letter}">
        <b>${d.letter}</b><span>${d.name}</span><em data-count>0</em>
      </button>`,
    ).join('');
    host.appendChild(wrap);
    this.strip = wrap;
    this.chips = {};
    for (const el of wrap.querySelectorAll('[data-use]')) {
      this.chips[el.dataset.use] = el;
      el.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.use(el.dataset.use);
      });
    }

    // Phones have no keyboard, so the strip gets the same three actions as
    // real touch buttons, stacked above the stick where a thumb can reach them.
    if (this.game.isTouch) {
      const holder = document.getElementById('touch-buttons');
      if (holder) {
        this.touchButtons = {};
        for (const d of DROPS) {
          const b = document.createElement('button');
          b.type = 'button';
          b.id = `tb-use-${d.id}`;
          b.className = 'tbtn small cons';
          b.textContent = d.letter;
          b.setAttribute('aria-label', d.name);
          b.addEventListener('click', (e) => {
            e.preventDefault();
            this.use(d.id);
          });
          holder.appendChild(b);
          this.touchButtons[d.id] = b;
        }
      }
    }
  }

  paint() {
    for (const d of DROPS) {
      const n = this.counts[d.id] || 0;
      const chip = this.chips && this.chips[d.id];
      if (chip) {
        const count = chip.querySelector('[data-count]');
        if (count) count.textContent = String(n);
        chip.classList.toggle('empty', n === 0);
        chip.classList.toggle('ready', n > 0);
        chip.disabled = n === 0;
      }
      const tb = this.touchButtons && this.touchButtons[d.id];
      if (tb) {
        tb.textContent = n > 0 ? `${d.letter}${n}` : d.letter;
        tb.classList.toggle('ready', n > 0);
        tb.disabled = n === 0;
      }
    }
  }

  pulse(id) {
    const chip = this.chips && this.chips[id];
    if (!chip) return;
    chip.classList.remove('pulse');
    void chip.offsetWidth;
    chip.classList.add('pulse');
    setTimeout(() => chip.classList.remove('pulse'), 620);
  }

  // --------------------------------------------------------------- lifecycle
  reset() {
    this.counts = { turret: 0, drone: 0, nuke: 0 };
    this.clear();
    this.paint();
  }

  // Removes everything this run put in the world. The counts go with it: a
  // consumable that survived the match would be a loadout item, and these are
  // deliberately not.
  clear() {
    for (const s of this.sentries) this.removeSentries(s);
    this.sentries.length = 0;
    for (const s of this.strikes) this.removeStrike(s);
    this.strikes.length = 0;
    this.nuke = null;
  }

  // ------------------------------------------------------------------ awards
  // Called from the wave-clear path. Returns the label the banner appends, or
  // an empty string on a wave that pays nothing.
  award(wave) {
    const got = [];
    for (const d of DROPS) {
      if (wave % d.every !== 0) continue;
      this.counts[d.id]++;
      got.push(d);
    }
    if (!got.length) return '';
    this.paint();
    this.sfx.grant();
    for (const d of got) this.pulse(d.id);
    return got.map((d) => d.name).join(' · ');
  }

  use(id) {
    const def = DROPS.find((d) => d.id === id);
    if (!def) return false;
    if ((this.counts[id] || 0) <= 0) {
      this.sfx.deny();
      this.game.hud.popCenter('NO ' + def.short, 'bonus', -120);
      return false;
    }
    let ok = false;
    if (id === 'turret') ok = this.placeTurret();
    else if (id === 'drone') ok = this.callDrone();
    else if (id === 'nuke') ok = this.armNuke();
    if (!ok) return false;
    this.counts[id]--;
    this.paint();
    return true;
  }

  // -------------------------------------------------------------- placement
  forward() {
    const dir = this.game.camera.getWorldDirection(this._dir).clone();
    dir.y = 0;
    if (dir.lengthSq() < 1e-5) dir.set(0, 0, -1);
    return dir.normalize();
  }

  arenaLimit() {
    const bounds = this.game.world && this.game.world.bounds ? this.game.world.bounds : 42;
    return Math.max(12, bounds - 3.5);
  }

  // True when a point sits inside (or right against) a solid. Used so a drop
  // is never posted inside a wall: illegal placement should slide back toward
  // the player, not fail outright and eat the charge.
  blocked(point) {
    const colliders = (this.game.world && this.game.world.colliders) || [];
    for (const c of colliders) {
      if (!c || !c.min || !c.max) continue;
      if (c.max.y < 1.2) continue;
      if (
        point.x > c.min.x - 0.9 &&
        point.x < c.max.x + 0.9 &&
        point.z > c.min.z - 0.9 &&
        point.z < c.max.z + 0.9
      ) {
        return true;
      }
    }
    return false;
  }

  // Where the player is actually pointing: ray down the camera against the
  // arena (ground plane included), then clamped into the play field.
  aimPoint(maxDist = 90) {
    const camera = this.game.camera;
    const dir = camera.getWorldDirection(this._dir).clone();
    const hit = this.game.world.raycast(camera.position, dir, maxDist);
    const point = hit && hit.point ? hit.point.clone() : camera.position.clone().addScaledVector(dir, 14);
    const limit = this.arenaLimit();
    point.x = clamp(point.x, -limit, limit);
    point.z = clamp(point.z, -limit, limit);
    point.y = 0;
    return point;
  }

  // ---------------------------------------------------------------- turret
  placeTurret() {
    const player = this.game.player;
    if (!player) return false;
    const dir = this.forward();
    const point = player.pos.clone().addScaledVector(dir, 3.4);
    const limit = this.arenaLimit();
    point.x = clamp(point.x, -limit, limit);
    point.z = clamp(point.z, -limit, limit);
    point.y = 0;

    // step back toward the player until the spot is clear of geometry
    if (this.blocked(point)) {
      for (let i = 0; i < 7; i++) {
        point.lerp(player.pos, 0.28);
        point.y = 0;
        if (!this.blocked(point)) break;
      }
    }
    if (this.blocked(point)) point.copy(player.pos).setY(0);

    const mesh = this.buildTurret();
    mesh.position.copy(point);
    mesh.rotation.y = Math.atan2(-dir.x, -dir.z);
    this.game.scene.add(mesh);
    const sentry = {
      mesh,
      head: mesh.userData.head,
      pos: point.clone(),
      life: TURRET.life,
      cool: TURRET.interval,
      target: null,
      shots: 0,
      spawn: 0,
      flashT: 0,
    };
    mesh.scale.setScalar(0.2);
    this.sentries.push(sentry);
    this.game.effects.ring(point, 0x63f5ff, 0.8, 0.4, 5);
    this.sfx.turretDeploy(point, this.game.camera);
    this.game.hud.popCenter('TURRET DEPLOYED', 'bonus', -110);
    return true;
  }

  buildTurret() {
    const group = new THREE.Group();
    const dark = new THREE.MeshStandardMaterial({ color: 0x0b1a22, roughness: 0.55, metalness: 0.55 });
    const glow = new THREE.MeshStandardMaterial({
      color: 0x9dfaff,
      emissive: 0x2ad9ee,
      emissiveIntensity: 2.6,
      roughness: 0.3,
    });
    const base = new THREE.Mesh(this._geo.base, dark);
    base.position.y = 0.08;
    const ring = new THREE.Mesh(this._geo.ring, glow);
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 0.2;
    const post = new THREE.Mesh(this._geo.post, dark);
    post.position.y = 0.55;
    const head = new THREE.Group();
    head.position.y = 0.95;
    const hull = new THREE.Mesh(this._geo.hull, dark);
    head.add(hull);
    const eye = new THREE.Mesh(this._geo.eye, glow);
    eye.position.set(0, 0.06, -0.26);
    head.add(eye);
    for (const sx of [-0.15, 0.15]) {
      const barrel = new THREE.Mesh(this._geo.barrel, glow);
      barrel.rotation.x = Math.PI / 2;
      barrel.position.set(sx, 0.02, -0.46);
      head.add(barrel);
    }
    group.add(base, ring, post, head);
    group.userData.head = head;
    return group;
  }

  updateSentries(dt) {
    const enemies = this.game.enemies;
    for (let i = this.sentries.length - 1; i >= 0; i--) {
      const s = this.sentries[i];
      s.life -= dt;
      s.spawn = Math.min(1, s.spawn + dt * 4);
      if (s.spawn < 1) s.mesh.scale.setScalar(0.2 + s.spawn * 0.8);
      if (s.life <= 0) {
        this.game.effects.ring(s.pos, 0x63f5ff, 0.7, 0.35, 4);
        this.sfx.turretExpire(s.pos, this.game.camera);
        this.removeSentries(s);
        this.sentries.splice(i, 1);
        continue;
      }

      // Retarget on a short interval: picking the nearest enemy every frame
      // makes the head jitter between two equidistant targets.
      s.cool -= dt;
      const retarget = !s.target || s.target.dead || s.target.pos.distanceTo(s.pos) > TURRET.range;
      if (retarget) s.target = this.nearestEnemy(s.pos, TURRET.range);

      if (s.target) {
        const to = this._point.subVectors(s.target.pos, s.pos);
        const want = Math.atan2(to.x, to.z);
        let delta = want - s.head.rotation.y;
        while (delta > Math.PI) delta -= TAU;
        while (delta < -Math.PI) delta += TAU;
        s.head.rotation.y += clamp(delta, -6 * dt, 6 * dt);

        // only fire once the head is roughly on target, so the shots read as
        // aimed instead of radiating out of a spinning post
        if (s.cool <= 0 && Math.abs(delta) < 0.45) {
          s.cool = TURRET.interval;
          this.turretShot(s);
        }
        if (s.cool < -0.4) s.cool = 0;
      } else if (s.cool < 0) {
        s.cool = 0;
      }
    }
  }

  turretShot(s) {
    const target = s.target;
    if (!target || target.dead) return;
    const from = s.pos.clone();
    from.y += 1.0;
    const to = target.pos.clone();
    this.game.effects.tracer(from, to, 0x8ef8ff);
    this.game.effects.sparks(to, this._up, 0x8ef8ff, 4);
    this.game.effects.flash(from, 0x8ef8ff, 1.2, 0.08);
    const res = this.game.enemies.hit(target, TURRET.damage, to, false);
    if (res.killed) this.creditKill(res, to, 0.5);
    s.shots++;
    if (s.shots % TURRET.shotsPerSound === 0) this.sfx.turretShot(s.pos, this.game.camera);
  }

  nearestEnemy(point, range) {
    let best = null;
    let bestD = range * range;
    for (const e of this.game.enemies.list) {
      if (e.dead) continue;
      const d = e.pos.distanceToSquared(point);
      if (d < bestD) {
        bestD = d;
        best = e;
      }
    }
    return best;
  }

  removeSentries(s) {
    if (!s) return;
    this.game.scene.remove(s.mesh);
    s.mesh.traverse((o) => {
      if (o.isMesh && o.material && o.material.dispose) o.material.dispose();
    });
  }

  // ----------------------------------------------------------- drone strike
  callDrone() {
    const point = this.aimPoint();
    if (!point) return false;
    const marker = this.buildMarker();
    marker.position.copy(point);
    this.game.scene.add(marker);

    // the pass runs across the target line, not through it: standing on the
    // marker is survivable, standing downrange of it is not
    const dir = this.forward();
    const axis = new THREE.Vector3(-dir.z, 0, dir.x).normalize();
    const strike = {
      point: point.clone(),
      marker,
      axis,
      t: 0,
      booms: [],
      next: 0,
      warned: false,
    };
    for (let i = 0; i < STRIKE.hits; i++) {
      const off = (i - (STRIKE.hits - 1) / 2) * STRIKE.spacing;
      const p = point.clone().addScaledVector(axis, off);
      p.y = 0;
      strike.booms.push({ point: p, t: STRIKE.delay + i * STRIKE.tick });
    }
    this.strikes.push(strike);
    this.sfx.strikeCall(point, this.game.camera);
    this.game.hud.popCenter('DRONE STRIKE MARKED', 'bonus', -110);
    return true;
  }

  buildMarker() {
    const group = new THREE.Group();
    const mat = new THREE.MeshBasicMaterial({
      color: 0x63f5ff,
      transparent: true,
      opacity: 0.6,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const ring = new THREE.Mesh(this._geo.mark, mat);
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 0.04;
    const inner = new THREE.Mesh(this._geo.markInner, mat);
    inner.rotation.x = Math.PI / 2;
    inner.position.y = 0.05;
    const beamMat = new THREE.MeshBasicMaterial({
      color: 0x63f5ff,
      transparent: true,
      opacity: 0.05,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const beam = new THREE.Mesh(this._geo.beam, beamMat);
    beam.position.y = 4.5;
    group.add(ring, inner, beam);
    group.userData = { ring, inner, beam, beamMat };
    return group;
  }

  updateStrikes(dt) {
    for (let i = this.strikes.length - 1; i >= 0; i--) {
      const s = this.strikes[i];
      s.t += dt;
      const data = s.marker.userData;
      const pulse = 1 + Math.sin(s.t * 12) * 0.03;
      data.ring.scale.setScalar(pulse);
      data.inner.scale.setScalar(1 + Math.sin(s.t * 9) * 0.08);
      data.ring.material.opacity = 0.45 + Math.sin(s.t * 10) * 0.18;
      data.beamMat.opacity = 0.04 + Math.sin(s.t * 7) * 0.015;

      if (!s.warned && s.t >= 0.12) {
        s.warned = true;
        this.sfx.strikeWarn(s.point, this.game.camera, STRIKE.delay);
      }

      while (s.next < s.booms.length && s.t >= s.booms[s.next].t) {
        this.strikeImpact(s.booms[s.next].point);
        s.next++;
      }

      const done = s.t > STRIKE.delay + STRIKE.hits * STRIKE.tick + 0.9;
      if (done) {
        this.removeStrike(s);
        this.strikes.splice(i, 1);
      }
    }
  }

  strikeImpact(point) {
    const effects = this.game.effects;
    effects.explosion(point, 0x8ef8ff);
    effects.ring(point, 0x63f5ff, 1.4, 0.45, 16);
    effects.flash(point, 0xffffff, 7, 0.2);
    this.sfx.strikeBoom(point, this.game.camera);
    this.game.player.addShake(0.3);
    const hits = this.game.enemies.damageRadius(point, STRIKE.radius, STRIKE.damage);
    for (const h of hits) {
      if (h.enemy.dead) continue;
      const res = this.game.enemies.hit(h.enemy, h.damage, h.enemy.pos.clone(), false);
      if (res.killed) this.creditKill(res, h.enemy.pos, 0.6);
    }
  }

  removeStrike(s) {
    if (!s) return;
    this.game.scene.remove(s.marker);
    s.marker.traverse((o) => {
      if (o.isMesh && o.material && o.material.dispose) o.material.dispose();
    });
  }

  // ------------------------------------------------------------------- nuke
  armNuke() {
    if (this.nuke) return false;
    this.nuke = { t: 0, dur: NUKE.charge, ticks: 0 };
    this.sfx.nukeCharge(NUKE.charge);
    this.game.hud.popCenter('FISSION ARMED', 'bonus', -130);
    this.game.hud.banner('FISSION ARMED', 'CLEAR THE BLAST RADIUS');
    return true;
  }

  updateNuke(dt) {
    const n = this.nuke;
    if (!n) return;
    n.t += dt;
    const frac = n.t / n.dur;
    // rings converge on the player as the charge builds: the visual timer is
    // the countdown, so nothing else has to explain how long is left
    const step = Math.floor(n.t / 0.4);
    if (step > n.ticks) {
      n.ticks = step;
      const r = 5.5 * (1 - Math.min(1, frac));
      this.game.effects.ring(
        this.game.player.pos.clone().setY(0.06),
        0xffffff,
        1 + r,
        0.3,
        2 + frac * 3,
      );
    }
    if (n.t >= n.dur) {
      this.nuke = null;
      this.detonate();
    }
  }

  detonate() {
    const game = this.game;
    const player = game.player;
    const origin = player.pos.clone();
    origin.y = 1.2;
    const effects = game.effects;
    effects.flash(origin, 0xffffff, 26, 0.5);
    effects.ring(origin.clone().setY(0.08), 0xffffff, 2, 0.9, 55);
    effects.ring(origin.clone().setY(0.1), 0x63f5ff, 1, 0.7, 40);
    effects.burst(origin, 0xffffff, 90, 26, 0.4, 1.1, 2);
    this.sfx.nukeBoom();
    this.sfx.nukeAfter();
    game.hud.flash('rgba(226, 248, 255, 0.92)');
    player.addShake(1.15);
    game.hitstop = 0.12;

    let kills = 0;
    for (const e of [...game.enemies.list]) {
      if (e.dead) continue;
      if (e.pos.distanceTo(origin) > NUKE.radius) continue;
      const dmg = e.cfg && e.cfg.boss ? Math.max(400, e.hp * NUKE.bossShare) : NUKE.damage;
      const res = game.enemies.hit(e, dmg, e.pos.clone(), false);
      if (res.killed) {
        kills++;
        this.creditKill(res, e.pos, 0.75, false);
      }
    }
    game.effects.flash(origin, 0xffffff, 18, 0.4);
    game.hud.banner('ARENA PURGED', kills > 0 ? `${kills} HOSTILE${kills === 1 ? '' : 'S'} ERASED` : 'NO TARGETS IN RANGE');
  }

  // Kills made by a consumable still pay, but at the listed share of the score
  // and without touching the chain: the chain is for the gun in your hands.
  creditKill(res, point, share = 0.5, pop = true) {
    const game = this.game;
    game.kills++;
    const gained = Math.round(res.score * share);
    if (gained > 0) {
      game.score += gained;
      game.hud.setScore(game.score);
      if (pop) game.hud.popAtWorld(point, game.camera, `+${gained}`, 'kill', 32);
    }
  }

  // ------------------------------------------------------------------ tick
  update(dt) {
    const input = this.game.input;
    for (const d of DROPS) {
      if (input.pressed && input.pressed(d.key)) this.use(d.id);
    }
    this.updateSentries(dt);
    this.updateStrikes(dt);
    this.updateNuke(dt);
  }
}
