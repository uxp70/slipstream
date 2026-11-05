import * as THREE from 'three';
import { DIFFICULTIES } from './difficulty.js';

const TAU = Math.PI * 2;

export const ENEMY_TYPES = {
  drifter: {
    hp: 46,
    speed: 4.0,
    radius: 0.92,
    headRadius: 0.34,
    baseY: 2.1,
    color: 0xff4fd8,
    emissive: 0x7c1558,
    score: 100,
    damage: 9,
    projectileSpeed: 26,
    idealRange: 15,
    fireDelay: [1.9, 2.9],
    telegraph: 0.5,
  },
  skitter: {
    hp: 32,
    speed: 10.5,
    radius: 0.55,
    headRadius: 0.3,
    baseY: 0.95,
    color: 0xff3b61,
    emissive: 0x8c0f22,
    score: 130,
    damage: 14,
    projectileSpeed: 0,
    idealRange: 0,
    melee: true,
  },
  sentry: {
    hp: 165,
    speed: 2.2,
    radius: 1.35,
    headRadius: 0.46,
    baseY: 3.0,
    color: 0xb06bff,
    emissive: 0x4a1e8c,
    score: 240,
    damage: 7,
    projectileSpeed: 30,
    idealRange: 21,
    fireDelay: [2.6, 3.4],
    telegraph: 0.65,
    burst: 3,
  },
};

const TYPE_ORDER = ['drifter', 'skitter', 'sentry'];

export class EnemyManager {
  constructor(scene, audio, effects, world, camera) {
    this.scene = scene;
    this.audio = audio;
    this.effects = effects;
    this.world = world;
    this.camera = camera;
    this.list = [];
    this.projectiles = [];
    this.pickups = [];
    this.queue = [];
    this.wave = 1;
    this.time = 0;
    // difficulty mods, swapped by setDifficulty (see DIFFICULTIES)
    this.difficulty = 'standard';
    this.mods = DIFFICULTIES.standard;
    this.onPickup = null;
    // ---- squad co-op
    // Every enemy carries an id so guests can refer to it, remote bodies are
    // extra things enemies may hit, and a guest drives visuals from the host's
    // snapshots instead of running the AI (mirrorStep).
    this._nextId = 1;
    this.netMirror = false;
    this.remoteTargets = [];
    this._v = new THREE.Vector3();
    this._p = new THREE.Vector3();
    this._d = new THREE.Vector3();
    this._center = new THREE.Vector3();
  }

  // ---------------------------------------------------------------- spawning
  spawnWave(wave, playerPos) {
    this.wave = wave;
    const scale = this.mods.count;
    const drifters = Math.max(
      1,
      Math.min(12, Math.round(Math.min(9, 2 + Math.ceil(wave * 0.8)) * scale))
    );
    const skitters = wave >= 2 ? Math.min(9, Math.round(Math.min(7, Math.floor(wave * 0.7)) * scale)) : 0;
    const sentries = wave >= 3 ? Math.min(4, Math.round(Math.min(3, Math.floor(wave / 3)) * scale)) : 0;
    const list = [];
    for (let i = 0; i < drifters; i++) list.push('drifter');
    for (let i = 0; i < skitters; i++) list.push('skitter');
    for (let i = 0; i < sentries; i++) list.push('sentry');
    for (let i = list.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [list[i], list[j]] = [list[j], list[i]];
    }
    // always open with a drifter so the first target is readable
    const first = list.indexOf('drifter');
    if (first > 0) [list[0], list[first]] = [list[first], list[0]];
    this.queue = list.map((type, i) => ({ type, t: i * 0.28 }));
    this._playerPos = playerPos;
  }

  pickSpawn(playerPos) {
    let best = null;
    let bestD = -1;
    for (let i = 0; i < 8; i++) {
      const p = this.world.spawnPoints[Math.floor(Math.random() * this.world.spawnPoints.length)];
      const d = p.distanceToSquared(playerPos);
      if (d > 22 * 22) return p.clone();
      if (d > bestD) {
        bestD = d;
        best = p;
      }
    }
    return best.clone();
  }

  spawn(type, playerPos, opts = {}) {
    const cfg = ENEMY_TYPES[type];
    const group = new THREE.Group();
    const mods = this.mods;
    const hpScale = (1 + (this.wave - 1) * 0.075) * mods.hp;
    const speedScale = Math.min(1.6, (1 + (this.wave - 1) * 0.035) * mods.speed);

    let geo;
    if (type === 'skitter') geo = new THREE.TetrahedronGeometry(cfg.radius, 0);
    else if (type === 'sentry') geo = new THREE.DodecahedronGeometry(cfg.radius, 0);
    else geo = new THREE.IcosahedronGeometry(cfg.radius, 0);

    const coreMat = new THREE.MeshStandardMaterial({
      color: cfg.color,
      emissive: cfg.emissive,
      emissiveIntensity: 1.6,
      roughness: 0.28,
      metalness: 0.55,
      flatShading: true,
    });
    const core = new THREE.Mesh(geo, coreMat);
    core.castShadow = false;
    group.add(core);

    const cageGeo = new THREE.IcosahedronGeometry(cfg.radius * 1.35, 0);
    const cage = new THREE.LineSegments(
      new THREE.EdgesGeometry(cageGeo),
      new THREE.LineBasicMaterial({
        color: cfg.color,
        transparent: true,
        opacity: 0.55,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      })
    );
    group.add(cage);

    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(cfg.radius * 1.6, 0.035, 5, 40),
      new THREE.MeshBasicMaterial({
        color: cfg.color,
        transparent: true,
        opacity: 0.75,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      })
    );
    ring.rotation.x = Math.PI / 2.3;
    group.add(ring);

    if (type === 'sentry') {
      const ring2 = ring.clone();
      ring2.material = ring.material.clone();
      ring2.rotation.set(Math.PI / 1.7, 0.4, 0);
      ring2.scale.setScalar(1.22);
      group.add(ring2);
      group.userData.ring2 = ring2;
    }

    // bright eye so the enemy has a clear front
    const eye = new THREE.Mesh(
      new THREE.SphereGeometry(cfg.radius * 0.32, 12, 10),
      new THREE.MeshBasicMaterial({ color: 0xffffff })
    );
    eye.position.z = cfg.radius * 0.82;
    group.add(eye);

    const pos = opts.pos ? opts.pos.clone() : this.pickSpawn(playerPos);
    if (!opts.pos) pos.y = cfg.baseY;
    group.position.copy(pos);
    group.scale.setScalar(opts.silent ? 1 : 0.01);
    this.scene.add(group);

    if (!opts.silent) {
      this.effects.ring(pos.clone().setY(Math.max(0.05, pos.y - cfg.baseY + 0.1)), cfg.color, 0.7, 0.45, 5);
      this.effects.burst(pos, cfg.color, 22, 5, 0.14, 0.5, 2);
    }

    this.list.push({
      id: opts.id ?? this._nextId++,
      type,
      cfg,
      group,
      core,
      cage,
      ring,
      pos,
      vel: new THREE.Vector3(),
      hp: cfg.hp * hpScale,
      maxHp: cfg.hp * hpScale,
      speed: cfg.speed * speedScale,
      damage: cfg.damage * mods.damage,
      fireRange: cfg.fireDelay
        ? [cfg.fireDelay[0] * mods.fireDelay, cfg.fireDelay[1] * mods.fireDelay]
        : null,
      radius: cfg.radius,
      headRadius: cfg.headRadius,
      headPos: new THREE.Vector3(),
      orbit: Math.random() < 0.5 ? -1 : 1,
      phase: Math.random() * TAU,
      fireTimer: (1 + Math.random() * 2) * (cfg.fireDelay ? mods.fireDelay : 1),
      charge: 0,
      flash: 0,
      spawnT: opts.silent ? 1 : 0,
      netTarget: pos.clone(),
      dead: false,
      deadTimer: 0,
      score: cfg.score,
    });
  }

  // ------------------------------------------------------------------ combat
  raycast(origin, dir, maxDist = 200) {
    let best = null;
    for (const e of this.list) {
      if (e.dead) continue;
      const bodyT = raySphere(origin, dir, e.pos, e.radius * 0.95);
      const headT = raySphere(origin, dir, e.headPos, e.headRadius);
      if (bodyT !== null && bodyT <= maxDist && (!best || bodyT < best.distance)) {
        best = {
          enemy: e,
          distance: bodyT,
          headshot: false,
          point: origin.clone().addScaledVector(dir, bodyT),
        };
      }
      if (headT !== null && headT <= maxDist && (!best || headT < best.distance)) {
        best = {
          enemy: e,
          distance: headT,
          headshot: true,
          point: origin.clone().addScaledVector(dir, headT),
        };
      }
    }
    return best;
  }

  hit(enemy, damage, point, headshot) {
    if (enemy.dead) return { killed: false, score: 0, type: enemy.type };
    enemy.hp -= damage;
    enemy.flash = 1;
    this.effects.sparks(point, this._d.set(0, 1, 0), headshot ? 0xffd88a : 0xff9ae8, headshot ? 12 : 6);
    if (enemy.hp <= 0) {
      this.kill(enemy);
      return { killed: true, score: enemy.score, type: enemy.type };
    }
    return { killed: false, score: 0, type: enemy.type };
  }

  // Splash damage for explosive weapons. Returns the list of hits so the game
  // can score them through the same path as direct hits.
  damageRadius(point, radius, damage, exclude = null) {
    const out = [];
    for (const e of this.list) {
      if (e.dead || e === exclude) continue;
      const d = e.pos.distanceTo(point) - e.radius * 0.6;
      if (d > radius) continue;
      const falloff = Math.max(0.25, 1 - Math.max(0, d) / radius);
      out.push({ enemy: e, damage: damage * falloff });
    }
    return out;
  }

  kill(enemy) {
    enemy.dead = true;
    this.effects.explosion(enemy.pos, enemy.cfg.color);
    this.audio.enemyDie(enemy.pos, this.camera);
    if (Math.random() < 0.16) this.spawnPickup(enemy.pos.clone());
  }

  spawnPickup(pos) {
    const group = new THREE.Group();
    const core = new THREE.Mesh(
      new THREE.OctahedronGeometry(0.34, 0),
      new THREE.MeshStandardMaterial({
        color: 0xffc063,
        emissive: 0xff9a2e,
        emissiveIntensity: 2.2,
        roughness: 0.3,
        metalness: 0.4,
      })
    );
    group.add(core);
    const halo = new THREE.Mesh(
      new THREE.TorusGeometry(0.62, 0.02, 4, 32),
      new THREE.MeshBasicMaterial({
        color: 0xffc063,
        transparent: true,
        opacity: 0.7,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      })
    );
    halo.rotation.x = Math.PI / 2;
    group.add(halo);

    const p = pos.clone();
    p.y = Math.max(1.1, Math.min(2.6, pos.y));
    group.position.copy(p);
    this.scene.add(group);
    this.pickups.push({ group, core, halo, pos: p, life: 20, phase: Math.random() * TAU });
  }

  // ------------------------------------------------------------------- update
  update(dt, player, time) {
    this.time = time;
    this._center.copy(player.center(this._p));

    // staggered wave spawns
    for (let i = this.queue.length - 1; i >= 0; i--) {
      this.queue[i].t -= dt;
      if (this.queue[i].t <= 0) {
        this.spawn(this.queue[i].type, player.pos);
        this.queue.splice(i, 1);
      }
    }

    const playerCenter = this._center;

    for (const e of this.list) {
      if (e.dead) {
        e.deadTimer += dt;
        e.group.scale.multiplyScalar(Math.max(0, 1 - dt * 12));
        continue;
      }
      e.spawnT = Math.min(1, e.spawnT + dt * 4);
      const grow = e.spawnT < 1 ? easeOutBack(e.spawnT) : 1;
      e.group.scale.setScalar(grow);

      const toPlayer = this._v.subVectors(playerCenter, e.pos);
      const dist = toPlayer.length();
      const dir = toPlayer.clone().multiplyScalar(1 / Math.max(0.001, dist));
      const flat = new THREE.Vector3(dir.x, 0, dir.z).normalize();

      // -------- steering
      const desired = new THREE.Vector3();
      if (e.type === 'skitter') {
        desired.copy(flat).multiplyScalar(e.speed);
        desired.y = Math.sin(time * 4 + e.phase) * 0.8;
        if (dist < 1.9) {
          if (!this.hitRemoteNear(e.pos, 1.9, e.damage, e.cfg.color)) {
            player.damage(e.damage, e.pos);
          }
          this.effects.explosion(e.pos, e.cfg.color);
          this.audio.enemyDie(e.pos, this.camera);
          e.dead = true;
          e.group.visible = false;
          continue;
        }
      } else {
        const tangent = new THREE.Vector3(-flat.z, 0, flat.x).multiplyScalar(e.orbit);
        const radial = Math.max(-1, Math.min(1, (dist - e.cfg.idealRange) * 0.24));
        desired.copy(flat).multiplyScalar(radial * e.speed);
        desired.addScaledVector(tangent, e.speed * 0.75);
        desired.y = (e.cfg.baseY + Math.sin(time * 1.6 + e.phase) * 0.28 - e.pos.y) * 2.2;
      }
      e.vel.lerp(desired, Math.min(1, dt * 2.4));
      e.pos.addScaledVector(e.vel, dt);

      // keep inside the arena
      const lim = this.world.bounds - 1.5;
      e.pos.x = Math.max(-lim, Math.min(lim, e.pos.x));
      e.pos.z = Math.max(-lim, Math.min(lim, e.pos.z));
      e.pos.y = Math.max(0.55, Math.min(14, e.pos.y));

      // push out of level geometry so fliers never clip into blocks
      this.resolveArena(e);

      // -------- visuals
      e.group.position.copy(e.pos);
      e.group.lookAt(playerCenter.x, e.pos.y + (e.type === 'skitter' ? -0.15 : 0), playerCenter.z);
      e.cage.rotation.y += dt * (e.type === 'skitter' ? 2.6 : 0.9);
      e.cage.rotation.x += dt * 0.5;
      e.ring.rotation.z += dt * (e.type === 'sentry' ? 1.6 : 2.2);
      if (e.group.userData.ring2) e.group.userData.ring2.rotation.z -= dt * 2.4;

      e.flash = Math.max(0, e.flash - dt * 4.5);
      const chargeGlow = e.charge > 0 ? Math.sin(e.charge * 40) * 0.5 + 0.5 : 0;
      e.core.material.emissiveIntensity = 1.5 + e.flash * 7 + chargeGlow * 3.5;
      e.core.material.emissive.setHex(e.charge > 0 ? 0xffffff : e.cfg.emissive);
      e.ring.material.opacity = 0.55 + chargeGlow * 0.4;

      e.headPos.copy(e.pos);
      e.headPos.y += e.radius * 0.5;

      // -------- attacks
      if (e.cfg.melee) continue;
      const los = this.hasLineOfSight(e, playerCenter);
      if (e.charge > 0) {
        e.charge += dt;
        if (e.charge >= e.cfg.telegraph) {
          this.fireProjectile(e, playerCenter);
          e.charge = 0;
          e.fireTimer = e.fireRange[0] + Math.random() * (e.fireRange[1] - e.fireRange[0]);
        }
      } else {
        e.fireTimer -= dt;
        if (e.fireTimer <= 0 && los && dist < 46) {
          e.charge = 0.0001;
          this.audio.charge(e.pos, this.camera);
        }
      }
    }

    // projectiles
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const p = this.projectiles[i];
      p.life -= dt;
      p.pos.addScaledVector(p.vel, dt);
      p.mesh.position.copy(p.pos);
      p.mesh.rotation.x += dt * 6;
      p.mesh.rotation.y += dt * 5;

      const hitPlayer = p.pos.distanceTo(playerCenter) < 0.75 + p.radius;
      const hitRemote = this.hitRemoteNear(p.pos, 0.75 + p.radius, p.damage, p.color);
      const wHit = this.world.raycast(p.pos, this._d.copy(p.vel).normalize(), p.vel.length() * dt + 0.4);
      if (hitPlayer || hitRemote) {
        if (hitPlayer) player.damage(p.damage, p.pos);
        this.effects.burst(p.pos, p.color, 16, 5, 0.16, 0.4, 4);
        this.effects.flash(p.pos, p.color, 2.4, 0.16);
        this.removeProjectile(i);
        continue;
      }
      if (wHit) {
        this.effects.impact(wHit.point, wHit.normal, p.color);
        this.removeProjectile(i);
        continue;
      }
      if (p.life <= 0) this.removeProjectile(i);
    }

    // pickups
    for (let i = this.pickups.length - 1; i >= 0; i--) {
      const pk = this.pickups[i];
      pk.life -= dt;
      pk.group.position.y = pk.pos.y + Math.sin(time * 2.4 + pk.phase) * 0.16;
      pk.core.rotation.y += dt * 2;
      pk.halo.rotation.z += dt * 1.4;
      pk.group.scale.setScalar(1 + Math.sin(time * 4 + pk.phase) * 0.05);
      if (pk.pos.distanceTo(playerCenter) < 1.9) {
        player.heal(22);
        this.audio.pickup();
        this.effects.ring(pk.pos, 0xffc063, 0.6, 0.45, 6);
        this.effects.burst(pk.pos, 0xffc063, 18, 5, 0.12, 0.5, 2);
        if (this.onPickup) this.onPickup(22);
        this.removePickup(i);
        continue;
      }
      if (pk.life <= 0) this.removePickup(i);
    }

    // reap dead enemies
    for (let i = this.list.length - 1; i >= 0; i--) {
      const e = this.list[i];
      if (e.dead && (!e.group.visible || e.deadTimer > 0.4)) {
        this.scene.remove(e.group);
        this.list.splice(i, 1);
      }
    }
  }

  resolveArena(e) {
    for (const c of this.world.colliders) {
      const r = e.radius;
      if (
        e.pos.x + r < c.min.x ||
        e.pos.x - r > c.max.x ||
        e.pos.y + r < c.min.y ||
        e.pos.y - r > c.max.y ||
        e.pos.z + r < c.min.z ||
        e.pos.z - r > c.max.z
      ) {
        continue;
      }
      const up = c.max.y + r + 0.05 - e.pos.y;
      const dxMin = e.pos.x - (c.min.x - r);
      const dxMax = c.max.x + r - e.pos.x;
      const dzMin = e.pos.z - (c.min.z - r);
      const dzMax = c.max.z + r - e.pos.z;
      const min = Math.min(up, dxMin, dxMax, dzMin, dzMax);
      if (min === up) e.pos.y = c.max.y + r + 0.05;
      else if (min === dxMin) e.pos.x = c.min.x - r - 0.05;
      else if (min === dxMax) e.pos.x = c.max.x + r + 0.05;
      else if (min === dzMin) e.pos.z = c.min.z - r - 0.05;
      else e.pos.z = c.max.z + r + 0.05;
    }
    if (e.pos.y <= 0.6) e.pos.y = 0.6;
  }

  hasLineOfSight(e, playerCenter) {
    this._d.subVectors(playerCenter, e.pos);
    const dist = this._d.length();
    if (dist < 0.2) return true;
    this._d.multiplyScalar(1 / dist);
    const hit = this.world.raycast(e.pos, this._d, dist - 0.9);
    return !hit;
  }

  fireProjectile(e, playerCenter) {
    const cfg = e.cfg;
    const speed = cfg.projectileSpeed;
    const target = playerCenter.clone();
    const dist = e.pos.distanceTo(playerCenter);
    // slight lead so standing still is punished, strafing is rewarded
    target.addScaledVector(this._d.subVectors(playerCenter, e.pos).normalize(), 0);
    const shots = cfg.burst || 1;
    for (let b = 0; b < shots; b++) {
      const spread = shots > 1 ? (b - (shots - 1) / 2) * 0.055 : 0;
      const dir = target.clone().sub(e.pos).normalize();
      const right = new THREE.Vector3(-dir.z, 0, dir.x).normalize();
      dir.addScaledVector(right, spread).normalize();
      const pos = e.pos.clone().addScaledVector(dir, e.radius + 0.25);

      const group = new THREE.Group();
      const mesh = new THREE.Mesh(
        new THREE.IcosahedronGeometry(0.26, 0),
        new THREE.MeshBasicMaterial({ color: cfg.color })
      );
      group.add(mesh);
      const halo = new THREE.Sprite(
        new THREE.SpriteMaterial({
          color: cfg.color,
          transparent: true,
          opacity: 0.55,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
          map: sharedGlow(),
        })
      );
      halo.scale.setScalar(2.1);
      group.add(halo);
      group.position.copy(pos);
      this.scene.add(group);

      this.projectiles.push({
        id: this._nextId++,
        mesh: group,
        pos,
        vel: dir.multiplyScalar(speed * (0.92 + Math.random() * 0.12)),
        life: 4.2,
        damage: e.damage,
        radius: 0.3,
        color: cfg.color,
      });
    }
    this.audio.enemyShot(e.pos, this.camera);
  }

  removeProjectile(i) {
    const p = this.projectiles[i];
    this.scene.remove(p.mesh);
    this.projectiles.splice(i, 1);
  }

  removePickup(i) {
    const p = this.pickups[i];
    this.scene.remove(p.group);
    this.pickups.splice(i, 1);
  }

  remaining() {
    return this.list.filter((e) => !e.dead).length + this.queue.length;
  }

  // ------------------------------------------------------------------ tuning
  // Guests never run the AI, but adopting the host's tier keeps local spawns
  // and readouts consistent with the wave the host is actually driving.
  setDifficulty(id) {
    const diff = DIFFICULTIES[id] || DIFFICULTIES.standard;
    this.difficulty = diff.id;
    this.mods = diff;
    return diff;
  }

  // ------------------------------------------------------------ squad co-op
  hitRemoteNear(point, radius, damage, color) {
    for (const target of this.remoteTargets) {
      if (!target || target.dead) continue;
      if (target.pos.distanceTo(point) < radius + 0.55) {
        target.damage(damage, point);
        return true;
      }
    }
    return false;
  }

  byId(id) {
    for (const e of this.list) if (e.id === id) return e;
    return null;
  }

  // host: compact rows for the snapshot (2 decimals is well under a unit at
  // this scale, and keeps packets small enough for 15 Hz updates)
  netRows() {
    const rows = [];
    for (const e of this.list) {
      rows.push([
        e.id,
        TYPE_ORDER.indexOf(e.type),
        round2(e.pos.x),
        round2(e.pos.y),
        round2(e.pos.z),
        Math.max(0, Math.round((e.hp / e.maxHp) * 100)),
        e.charge > 0 ? 1 : 0,
        e.dead ? 1 : 0,
      ]);
    }
    return rows;
  }

  shotRows() {
    const rows = [];
    for (const p of this.projectiles) {
      rows.push([p.id, round2(p.pos.x), round2(p.pos.y), round2(p.pos.z), p.color]);
    }
    return rows;
  }

  // guest: rebuild the wave from the host's rows, keeping visuals local
  applyMirror(rows, shots) {
    if (!this._seen) this._seen = new Set();
    const seen = this._seen;
    seen.clear();

    for (const r of rows) {
      const id = r[0];
      seen.add(id);
      let e = this.byId(id);
      if (!e) {
        if (r[7]) continue;
        this.spawn(TYPE_ORDER[r[1]] || 'drifter', null, {
          pos: new THREE.Vector3(r[2], r[3], r[4]),
          id,
          silent: true,
        });
        e = this.byId(id);
        if (!e) continue;
      }
      e.netTarget.set(r[2], r[3], r[4]);
      if (e.pos.distanceTo(e.netTarget) > 14) e.pos.copy(e.netTarget);
      e.hp = Math.max(0, (r[5] / 100) * e.maxHp);
      e.charge = r[6] ? Math.max(e.charge, 0.001) : 0;
      if (r[7] && !e.dead) this.mirrorKill(e);
    }

    for (const e of this.list) {
      if (!seen.has(e.id) && !e.dead) this.mirrorKill(e);
    }

    if (shots) this.mirrorShots(shots);
  }

  mirrorKill(e) {
    e.dead = true;
    e.deadTimer = 0;
    this.effects.explosion(e.pos, e.cfg.color);
    this.audio.enemyDie(e.pos, this.camera);
  }

  mirrorShots(rows) {
    if (!this.netShots) this.netShots = new Map();
    if (!this._seenShots) this._seenShots = new Set();
    const seen = this._seenShots;
    seen.clear();
    for (const r of rows) {
      seen.add(r[0]);
      let mesh = this.netShots.get(r[0]);
      if (!mesh) {
        mesh = makeShotMesh(r[4]);
        this.scene.add(mesh);
        this.netShots.set(r[0], mesh);
      }
      mesh.position.set(r[1], r[2], r[3]);
    }
    for (const [id, mesh] of this.netShots) {
      if (seen.has(id)) continue;
      this.scene.remove(mesh);
      this.netShots.delete(id);
    }
  }

  // guest: animation only — positions come from the host, so no steering or
  // damage resolution happens here
  mirrorStep(dt, time) {
    const focus = this.camera ? this.camera.position : null;
    for (const e of this.list) {
      if (e.dead) {
        e.deadTimer += dt;
        e.group.scale.multiplyScalar(Math.max(0, 1 - dt * 12));
        continue;
      }
      e.pos.lerp(e.netTarget, Math.min(1, dt * 16));
      e.group.position.copy(e.pos);
      if (focus) e.group.lookAt(focus.x, e.pos.y - 0.1, focus.z);
      e.cage.rotation.y += dt * 0.9;
      e.cage.rotation.x += dt * 0.5;
      e.ring.rotation.z += dt * 2.2;
      if (e.group.userData.ring2) e.group.userData.ring2.rotation.z -= dt * 2.4;
      e.flash = Math.max(0, e.flash - dt * 4.5);
      const glow = e.charge > 0 ? Math.sin(time * 40) * 0.5 + 0.5 : 0;
      e.core.material.emissiveIntensity = 1.5 + e.flash * 7 + glow * 3.5;
      e.core.material.emissive.setHex(e.charge > 0 ? 0xffffff : e.cfg.emissive);
      e.headPos.copy(e.pos);
      e.headPos.y += e.radius * 0.5;
    }
    for (let i = this.list.length - 1; i >= 0; i--) {
      const e = this.list[i];
      if (e.dead && e.deadTimer > 0.4) {
        this.scene.remove(e.group);
        this.list.splice(i, 1);
      }
    }
    if (this.netShots) {
      for (const mesh of this.netShots.values()) {
        mesh.rotation.y += dt * 5;
        mesh.rotation.x += dt * 6;
      }
    }
  }

  clear() {
    for (const e of this.list) this.scene.remove(e.group);
    if (this.netShots) {
      for (const m of this.netShots.values()) this.scene.remove(m);
      this.netShots.clear();
    }
    for (const p of this.projectiles) this.scene.remove(p.mesh);
    for (const p of this.pickups) this.scene.remove(p.group);
    this.list = [];
    this.projectiles = [];
    this.pickups = [];
    this.queue = [];
  }
}

// -------------------------------------------------------------------- helpers
function raySphere(origin, dir, center, radius) {
  const ox = origin.x - center.x;
  const oy = origin.y - center.y;
  const oz = origin.z - center.z;
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

function easeOutBack(t) {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
}

function round2(v) {
  return Math.round(v * 100) / 100;
}

function makeShotMesh(color) {
  const group = new THREE.Group();
  group.add(
    new THREE.Mesh(new THREE.IcosahedronGeometry(0.26, 0), new THREE.MeshBasicMaterial({ color }))
  );
  const halo = new THREE.Sprite(
    new THREE.SpriteMaterial({
      color,
      transparent: true,
      opacity: 0.55,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      map: sharedGlow(),
    })
  );
  halo.scale.setScalar(2.1);
  group.add(halo);
  return group;
}

let _glow = null;
function sharedGlow() {
  if (_glow) return _glow;
  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  const grad = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.4, 'rgba(255,255,255,0.35)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);
  _glow = new THREE.CanvasTexture(canvas);
  _glow.colorSpace = THREE.SRGBColorSpace;
  return _glow;
}
