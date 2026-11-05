import * as THREE from 'three';
import { buildWeaponModel } from './weaponModels.js';

const TAU = Math.PI * 2;

// Four archetypes, deliberately split so each owns a different fight:
//   VX-9   tracking hitscan   — mid range, forgiving, needs sustained aim
//   BR-12  spread hitscan     — point blank burst, shell-by-shell reload
//   LN-7   precision hitscan  — long sightlines, huge damage, long cycle
//   PR-4   splash projectile  — area denial, corners, rocket-jump movement
// Two hitscan that differ by range and spread, two that differ by delivery.
export const WEAPONS = [
  {
    id: 'rifle',
    name: 'VX-9 ARC RIFLE',
    short: 'RIFLE',
    kind: 'hitscan',
    damage: 20,
    headMult: 2.2,
    interval: 0.088,
    mag: 30,
    reload: 1.35,
    spread: 0.0016,
    bloomPerShot: 1.15,
    bloomMax: 16,
    recoilPitch: 0.0075,
    recoilYaw: 0.003,
    shake: 0.075,
    fovKick: 0.85,
    color: 0xffe3b0,
    flash: 0xffd58a,
    adsTime: 14,
    lowAmmo: 8,
  },
  {
    id: 'breach',
    name: 'BR-12 BREACHER',
    short: 'BREACH',
    kind: 'shotgun',
    pellets: 9,
    damage: 9,
    headMult: 1.7,
    interval: 0.78,
    mag: 6,
    reload: 0.34,
    shellReload: true,
    spread: 0.032,
    bloomPerShot: 0,
    bloomMax: 0,
    recoilPitch: 0.032,
    recoilYaw: 0.009,
    shake: 0.2,
    fovKick: 3.2,
    color: 0xffd08a,
    flash: 0xffb347,
    adsTime: 11,
    lowAmmo: 2,
  },
  {
    id: 'lance',
    name: 'LN-7 LANCE',
    short: 'LANCE',
    kind: 'rail',
    damage: 95,
    headMult: 2,
    interval: 1.35,
    mag: 5,
    reload: 2.1,
    spread: 0,
    bloomPerShot: 0,
    bloomMax: 0,
    recoilPitch: 0.05,
    recoilYaw: 0.004,
    shake: 0.28,
    fovKick: 6,
    color: 0x8ef8ff,
    flash: 0xa8f4ff,
    adsTime: 9,
    lowAmmo: 1,
  },
  {
    id: 'havoc',
    name: 'PR-4 HAVOC',
    short: 'HAVOC',
    kind: 'rocket',
    damage: 105,
    splash: 72,
    splashRadius: 3.8,
    speed: 32,
    interval: 0.9,
    mag: 4,
    reload: 1.9,
    spread: 0.004,
    bloomPerShot: 0,
    bloomMax: 0,
    recoilPitch: 0.034,
    recoilYaw: 0.006,
    shake: 0.24,
    fovKick: 4,
    color: 0xffa63c,
    flash: 0xffb347,
    adsTime: 12,
    lowAmmo: 1,
  },
];

const HIP = new THREE.Vector3(0.32, -0.285, -0.6);
const ADS = new THREE.Vector3(0, -0.16, -0.46);

export class WeaponSystem {
  constructor(camera, scene, audio, effects, player, world, enemies) {
    this.camera = camera;
    this.scene = scene;
    this.audio = audio;
    this.effects = effects;
    this.player = player;
    this.world = world;
    this.enemies = enemies;

    this.defs = WEAPONS;
    this.index = 0;
    // slot -> weapon index. The slot order is the player's loadout, and every
    // key/button addresses a slot, so "1" is whatever was carried in slot 1.
    this.order = WEAPONS.map((_, i) => i);
    this.startSlot = 0;
    this.states = WEAPONS.map((def) => ({
      ammo: def.mag,
      cooldown: 0,
      reloading: false,
      reloadTimer: 0,
      bloom: 0,
      kick: 0,
      kickVel: 0,
      kickPitch: 0,
      raise: 0,
      ads: 0,
      flashTimer: 0,
    }));

    this.swayX = 0;
    this.swayY = 0;
    this.time = 0;
    this.visible = false;
    this.projectiles = [];

    this.onHit = null;
    this.onShoot = null;
    this.onSwitch = null;

    this.hitPoint = new THREE.Vector3();
    this.hitNormal = new THREE.Vector3();
    this._dir = new THREE.Vector3();
    this._right = new THREE.Vector3();
    this._up = new THREE.Vector3();
    this._muzzle = new THREE.Vector3();
    this._end = new THREE.Vector3();
    this._origin = new THREE.Vector3();
    this._v = new THREE.Vector3();
    this._hits = new Map();

    this.models = WEAPONS.map((def) => {
      const model = buildWeaponModel(def);
      model.group.position.copy(HIP);
      model.group.visible = false;
      this.camera.add(model.group);
      return model;
    });
    this.applyActive();
  }

  // ------------------------------------------------------------------ getters
  weaponIndex(i = this.index) {
    const w = this.order[i];
    return w === undefined ? i : w;
  }

  get def() {
    return this.defs[this.weaponIndex()];
  }

  get state() {
    return this.states[this.weaponIndex()];
  }

  get ammo() {
    return this.state.ammo;
  }

  get magSize() {
    return this.def.mag;
  }

  get reloading() {
    return this.state.reloading;
  }

  get ads() {
    return this.state.ads;
  }

  get current() {
    return this.def.id;
  }

  // one row per slot, in loadout order, so the HUD strip reads 1..4 as carried
  allAmmo() {
    return this.order.map((w) => ({
      ammo: this.states[w].ammo,
      mag: this.defs[w].mag,
      id: this.defs[w].id,
      short: this.defs[w].short,
      name: this.defs[w].name,
    }));
  }

  applyActive() {
    const active = this.weaponIndex();
    this.models.forEach((m, i) => {
      m.group.visible = this.visible && i === active;
    });
  }

  setVisible(v) {
    this.visible = v;
    this.applyActive();
  }

  // ------------------------------------------------------------------ control
  switchTo(i, silent = false) {
    if (i < 0 || i >= this.order.length) return;
    const target = (i + this.order.length) % this.order.length;
    if (target === this.index) return;
    const prev = this.state;
    prev.reloading = false;
    prev.reloadTimer = 0;
    prev.ads = 0;
    this.index = target;
    const s = this.state;
    s.raise = 0;
    s.cooldown = Math.max(s.cooldown, 0.08);
    this.applyActive();
    if (!silent) {
      this.audio.ui();
      if (this.onSwitch) this.onSwitch(target);
    }
  }

  cycle(dir) {
    this.switchTo(this.index + dir);
  }

  // The loadout is a permutation of the four guns across the four slots, so
  // every slot always resolves to a real weapon and nothing downstream has to
  // handle an empty hand.
  setLoadout(ids, startSlot = 0) {
    const all = this.defs.map((d) => d.id);
    if (Array.isArray(ids) && ids.length === all.length) {
      const next = ids.map((id) => all.indexOf(id));
      const unique = new Set(next).size === all.length;
      if (unique && next.every((i) => i >= 0)) this.order = next;
    }
    this.startSlot = Math.max(0, Math.min(this.order.length - 1, startSlot | 0));
    const vis = this.visible;
    this.reset();
    this.setVisible(vis);
    return this.order;
  }

  reset() {
    for (let i = 0; i < this.states.length; i++) {
      const s = this.states[i];
      s.ammo = this.defs[i].mag;
      s.cooldown = 0;
      s.reloading = false;
      s.reloadTimer = 0;
      s.bloom = 0;
      s.kick = 0;
      s.kickVel = 0;
      s.kickPitch = 0;
      s.ads = 0;
      s.raise = 1;
      s.flashTimer = 0;
    }
    this.clearProjectiles();
    this.setVisible(true);
    this.switchTo(this.startSlot, true);
    this.applyActive();
  }

  startReload() {
    const s = this.state;
    const def = this.def;
    if (s.reloading || s.ammo >= def.mag) return;
    s.reloading = true;
    s.reloadTimer = 0;
    s.bloom = 0;
    this.audio.reload();
  }

  spreadRadians() {
    const s = this.state;
    const def = this.def;
    return (def.spread + s.bloom * 0.00052 + this.player.horizSpeed() * 0.00006) * (1 - 0.74 * s.ads);
  }

  spreadPixels() {
    const s = this.state;
    const def = this.def;
    const base = def.kind === 'rail' ? 2 : def.kind === 'shotgun' ? 26 : def.kind === 'rocket' ? 6 : 7;
    return base + s.bloom * 1.05 + Math.min(8, this.player.horizSpeed() * 0.22) - s.ads * 4;
  }

  // ------------------------------------------------------------------- update
  update(dt, input, canFire) {
    this.time += dt;

    // switching commits on the input event; the raise animation catches up
    if (canFire) {
      for (let i = 0; i < this.order.length; i++) {
        if (input.pressed(`Digit${i + 1}`)) this.switchTo(i);
      }
      if (input.pressed('KeyQ')) this.cycle(1);
      const wheel = input.consumeWheel ? input.consumeWheel() : 0;
      if (wheel !== 0) this.cycle(wheel > 0 ? 1 : -1);
    }

    const def = this.def;
    const s = this.state;

    s.cooldown = Math.max(0, s.cooldown - dt);
    s.bloom *= Math.exp(-dt * 7.5);
    s.raise = Math.min(1, s.raise + dt * 7);

    const adsTarget = canFire && input.mouse(2) && !s.reloading ? 1 : 0;
    s.ads += (adsTarget - s.ads) * Math.min(1, dt * def.adsTime);

    if (s.reloading) {
      s.reloadTimer += dt;
      if (def.shellReload) {
        if (s.reloadTimer >= def.reload) {
          s.reloadTimer -= def.reload;
          s.ammo = Math.min(def.mag, s.ammo + 1);
          if (s.ammo >= def.mag) s.reloading = false;
        }
      } else if (s.reloadTimer >= def.reload) {
        s.reloading = false;
        s.ammo = def.mag;
        s.bloom = 0;
      }
    }

    if (canFire) {
      if (input.mouse(0)) {
        if (s.reloading && s.ammo > 0) {
          // firing cancels a reload; shells already loaded stay loaded
          s.reloading = false;
          s.reloadTimer = 0;
        }
        if (s.ammo > 0) {
          let guard = 0;
          while (s.cooldown <= 0 && s.ammo > 0 && guard++ < 8) {
            this.fire();
            s.cooldown += def.interval;
          }
        } else {
          this.startReload();
        }
      }
      if (input.pressed('KeyR')) this.startReload();
      if (s.ammo === 0 && !s.reloading) this.startReload();
    }

    this.updateProjectiles(dt);

    // ---- viewmodel sway + springs
    const swayTX = Math.max(-0.05, Math.min(0.05, -this.player.lookDelta.x * 0.0009));
    const swayTY = Math.max(-0.05, Math.min(0.05, -this.player.lookDelta.y * 0.0009));
    this.swayX += (swayTX - this.swayX) * Math.min(1, dt * 11);
    this.swayY += (swayTY - this.swayY) * Math.min(1, dt * 11);

    s.kickVel += (-s.kick * 260 - s.kickVel * 22) * dt;
    s.kick += s.kickVel * dt;
    s.kickPitch *= Math.exp(-dt * 9);

    const model = this.models[this.weaponIndex()];
    if (!model) return;

    let reloadDip = 0;
    let reloadRoll = 0;
    let magOffset = 0;
    if (s.reloading) {
      const t = Math.min(1, s.reloadTimer / def.reload);
      const curve = Math.sin(t * Math.PI);
      reloadDip = curve * (def.shellReload ? 0.07 : 0.13);
      reloadRoll = curve * (def.shellReload ? 0.35 : 0.7);
      magOffset = -Math.sin(Math.min(1, t * 1.4) * Math.PI) * 0.12;
    }
    if (model.magMesh) {
      if (model.magMesh.userData.y0 === undefined) model.magMesh.userData.y0 = model.magMesh.position.y;
      model.magMesh.position.y = model.magMesh.userData.y0 + magOffset;
    }

    if (s.flashTimer > 0) {
      s.flashTimer -= dt;
      const k = Math.max(0, s.flashTimer / 0.06);
      model.flashSprite.material.opacity = k;
      model.flashSprite.visible = k > 0;
      model.flashSprite.scale.setScalar(0.35 + (1 - k) * 0.5);
      model.flashLight.intensity = k * 320;
      if (s.flashTimer <= 0) model.flashLight.intensity = 0;
    }

    const a = s.ads;
    const bob = this.player.bobAmount * (1 - a * 0.85);
    const bobX = Math.cos(this.player.bobPhase) * 0.012 * bob;
    const bobY = Math.sin(this.player.bobPhase * 2) * 0.009 * bob;
    const raiseOffset = (1 - easeOutCubic(s.raise)) * -0.34;
    const adsOffset = def.id === 'havoc' ? -0.03 : 0;

    const g = model.group;
    g.position.x = HIP.x + (ADS.x - HIP.x) * a + this.swayX * (1 - a * 0.7) + bobX;
    g.position.y = HIP.y + (ADS.y - HIP.y) * a + this.swayY * (1 - a * 0.7) + bobY + reloadDip + raiseOffset;
    g.position.z = HIP.z + adsOffset + s.kick * 0.09;
    g.rotation.x = s.kickPitch * 0.5 + reloadRoll * 0.35 + this.swayY * 2.2 - raiseOffset * 1.1;
    g.rotation.y = this.swayX * 2.4 + (1 - a) * 0.035;
    g.rotation.z = reloadRoll * 0.7 + this.player.roll * 0.35;

    if (this.player.dead) {
      g.position.y -= 0.35;
      g.rotation.x += 0.7;
    }
  }

  // --------------------------------------------------------------------- fire
  fire() {
    const def = this.def;
    const s = this.state;
    s.ammo--;
    if (def.bloomMax) s.bloom = Math.min(def.bloomMax, s.bloom + def.bloomPerShot);
    if (this.onShoot) this.onShoot(def);

    const origin = this._origin.copy(this.camera.position);
    const dir = this._dir;
    this.camera.getWorldDirection(dir);

    // resolve the muzzle before the shot is built: tracers and rockets spawn at
    // it, and the viewmodel transform is only rebuilt later in the frame
    this.camera.updateMatrixWorld();
    const model = this.models[this.weaponIndex()];
    model.muzzle.getWorldPosition(this._muzzle);

    if (def.kind === 'shotgun') {
      this.fireShotgun(origin, dir);
    } else if (def.kind === 'rail') {
      this.fireRail(origin, dir);
    } else if (def.kind === 'rocket') {
      this.fireRocket(origin, dir);
    } else {
      this.fireHitscan(origin, dir);
    }

    this.player.addRecoil(
      def.recoilPitch + Math.random() * def.recoilPitch * 0.4,
      (Math.random() - 0.5) * def.recoilYaw * 2
    );
    this.player.addShake(def.shake);

    s.kickVel += def.kind === 'shotgun' ? 1.5 : def.kind === 'rail' ? 1.7 : 0.85;
    s.kickPitch += def.recoilPitch * 6 + Math.random() * 0.015;
    model.flashSprite.visible = true;
    model.flashSprite.material.rotation = Math.random() * TAU;
    model.flashSprite.material.opacity = 1;
    model.flashLight.intensity = 320;
    s.flashTimer = 0.06;
    this.player.fovKick += def.fovKick;
  }

  applySpread(dir, spread) {
    if (spread <= 0) return dir;
    const right = this._right.set(1, 0, 0).applyQuaternion(this.camera.quaternion);
    const up = this._up.set(0, 1, 0).applyQuaternion(this.camera.quaternion);
    const ang = Math.random() * TAU;
    const r = Math.sqrt(Math.random()) * spread;
    return dir.addScaledVector(right, Math.cos(ang) * r).addScaledVector(up, Math.sin(ang) * r).normalize();
  }

  fireHitscan(origin, dir) {
    const def = this.def;
    const rayDir = this.applySpread(dir.clone(), this.spreadRadians());

    const worldHit = this.world.raycast(origin, rayDir, 220);
    const eHit = this.enemies.raycast(origin, rayDir, worldHit ? worldHit.distance : 220);
    let end;
    if (eHit) {
      end = eHit.point;
      const dmg = def.damage * (eHit.headshot ? def.headMult : 1);
      this.effects.sparks(end, rayDir.clone().negate(), eHit.headshot ? 0xffd88a : 0xff9ae8, 8);
      if (this.onHit) {
        this.onHit({ enemy: eHit.enemy, point: eHit.point, headshot: eHit.headshot, damage: dmg, weapon: def.id });
      }
    } else if (worldHit) {
      end = worldHit.point;
      this.effects.impact(worldHit.point, worldHit.normal, 0xffc063);
      this.audio.impact(worldHit.point, this.camera);
    } else {
      end = origin.clone().addScaledVector(rayDir, 140);
    }

    this.effects.tracer(this._muzzle, end, def.color);
    this.audio.shoot(0.9, def.id);
  }

  fireShotgun(origin, dir) {
    const def = this.def;
    const spread = this.spreadRadians() + 0.004;
    this._hits.clear();
    let anyWorld = null;

    for (let p = 0; p < def.pellets; p++) {
      const rayDir = this.applySpread(dir.clone(), spread);
      const worldHit = this.world.raycast(origin, rayDir, 90);
      const eHit = this.enemies.raycast(origin, rayDir, worldHit ? worldHit.distance : 90);
      if (eHit) {
        const dmg = def.damage * (eHit.headshot ? def.headMult : 1);
        const rec = this._hits.get(eHit.enemy) || { damage: 0, point: eHit.point, headshot: false };
        rec.damage += dmg;
        rec.headshot = rec.headshot || eHit.headshot;
        this._hits.set(eHit.enemy, rec);
        this.effects.sparks(eHit.point, rayDir.clone().negate(), eHit.headshot ? 0xffd88a : 0xffb3ef, 3);
      } else if (worldHit) {
        anyWorld = worldHit;
      }
    }

    if (anyWorld) {
      this.effects.impact(anyWorld.point, anyWorld.normal, 0xffc063);
      this.audio.impact(anyWorld.point, this.camera);
    }

    const tip = this._end.copy(this._muzzle).addScaledVector(dir, 3.2);
    this.effects.tracer(this._muzzle, tip, def.color);

    for (const [enemy, rec] of this._hits) {
      if (this.onHit) {
        this.onHit({ enemy, point: rec.point, headshot: rec.headshot, damage: rec.damage, weapon: def.id });
      }
    }
    this.audio.shoot(1, 'shotgun');
  }

  fireRail(origin, dir) {
    const def = this.def;
    const rayDir = dir.clone();
    const worldHit = this.world.raycast(origin, rayDir, 260);
    const eHit = this.enemies.raycast(origin, rayDir, worldHit ? worldHit.distance : 260);
    let end;
    if (eHit) {
      end = eHit.point;
      const dmg = def.damage * (eHit.headshot ? def.headMult : 1);
      this.effects.sparks(end, rayDir.clone().negate(), 0xa8f4ff, 18);
      this.effects.ring(eHit.point, 0x8ef8ff, 0.7, 0.4, 6);
      if (this.onHit) {
        this.onHit({ enemy: eHit.enemy, point: eHit.point, headshot: eHit.headshot, damage: dmg, weapon: def.id });
      }
    } else if (worldHit) {
      end = worldHit.point;
      this.effects.impact(worldHit.point, worldHit.normal, 0x8ef8ff);
      this.effects.ring(worldHit.point, 0x8ef8ff, 0.6, 0.35, 5);
      this.audio.impact(worldHit.point, this.camera);
    } else {
      end = origin.clone().addScaledVector(rayDir, 200);
    }

    // a rail beam reads as a thick, fast-fading line
    this.effects.tracer(this._muzzle, end, 0xd8feff);
    this.effects.tracer(this._muzzle, end, 0x8ef8ff);
    this.effects.flash(end, 0x8ef8ff, 2.2, 0.14);
    this.audio.shoot(1, 'rail');
  }

  fireRocket(origin, dir) {
    const def = this.def;
    const rayDir = this.applySpread(dir.clone(), this.spreadRadians());

    const group = new THREE.Group();
    const shell = new THREE.Mesh(
      new THREE.CapsuleGeometry(0.12, 0.34, 4, 8),
      new THREE.MeshBasicMaterial({ color: def.color })
    );
    shell.rotation.x = Math.PI / 2;
    group.add(shell);
    const glow = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: shellTexture(),
        color: def.color,
        transparent: true,
        opacity: 0.85,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      })
    );
    glow.scale.setScalar(1.1);
    group.add(glow);
    group.position.copy(this._muzzle);
    this.scene.add(group);

    this.projectiles.push({
      mesh: group,
      pos: this._muzzle.clone(),
      vel: rayDir.multiplyScalar(def.speed),
      life: 4,
      damage: def.damage,
      splash: def.splash,
      radius: def.splashRadius,
      color: def.color,
      trail: 0,
    });
    this.audio.shoot(1, 'rocket');
  }

  updateProjectiles(dt) {
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const p = this.projectiles[i];
      p.life -= dt;
      const step = this._v.copy(p.vel).multiplyScalar(dt);
      const dist = step.length();
      const dir = step.clone().normalize();

      // closest enemy along this step
      let hitEnemy = null;
      let hitDist = dist;
      for (const e of this.enemies.list) {
        if (e.dead) continue;
        const toE = this._v.copy(e.pos).sub(p.pos);
        const along = toE.dot(dir);
        if (along < 0 || along > dist + e.radius) continue;
        const perp = toE.addScaledVector(dir, -along).length();
        if (perp < e.radius + 0.35 && along < hitDist) {
          hitDist = along;
          hitEnemy = e;
        }
      }

      const worldHit = this.world.raycast(p.pos, dir, dist);
      if (worldHit && worldHit.distance < hitDist) hitDist = worldHit.distance;

      if (hitEnemy || (worldHit && worldHit.distance <= dist)) {
        const point = p.pos.clone().addScaledVector(dir, hitDist);
        this.explode(point, p, hitEnemy);
        this.scene.remove(p.mesh);
        this.projectiles.splice(i, 1);
        continue;
      }

      p.pos.add(step);
      p.mesh.position.copy(p.pos);
      p.mesh.rotation.y += dt * 8;
      p.trail -= dt;
      if (p.trail <= 0) {
        p.trail = 0.02;
        this.effects.spawn(p.pos.x, p.pos.y, p.pos.z, 0, 0, 0, 0xffa63c, 0.22, 0.22, 0, 3);
      }
      if (p.life <= 0) {
        this.explode(p.pos.clone(), p, null);
        this.scene.remove(p.mesh);
        this.projectiles.splice(i, 1);
      }
    }
  }

  explode(point, p, directTarget) {
    const def = this.def;
    this.effects.explosion(point, def.color);
    this.effects.flash(point, def.color, 7, 0.24);
    this.effects.ring(point, def.color, 1.4, 0.5, 12);
    this.audio.explosion();
    this.player.addShake(0.3);

    if (directTarget && this.onHit) {
      this.onHit({ enemy: directTarget, point, headshot: false, damage: p.damage, weapon: def.id });
    }
    // splash to everything else nearby (the direct target already took full damage)
    const hits = this.enemies.damageRadius(point, p.radius, p.splash, directTarget);
    for (const h of hits) {
      if (this.onHit) {
        this.onHit({ enemy: h.enemy, point, headshot: false, damage: h.damage, weapon: def.id, splash: true });
      }
    }

    // rocket jumping: knock yourself away from the blast, with light damage
    const toPlayer = this.player.pos.clone().add(new THREE.Vector3(0, 0.9, 0)).sub(point);
    const d = toPlayer.length();
    if (d < p.radius * 1.15 && d > 0.001) {
      const falloff = Math.max(0, 1 - d / (p.radius * 1.15));
      toPlayer.normalize();
      const power = 12 + falloff * 15;
      this.player.vel.x += toPlayer.x * power;
      this.player.vel.z += toPlayer.z * power;
      this.player.vel.y = Math.max(this.player.vel.y, toPlayer.y * power * 0.85 + 4.2 * falloff);
      this.player.onGround = false;
      this.player.fovKick += 6 * falloff;
      if (falloff > 0.35) this.player.damage(Math.round(5 * falloff), point);
    }
  }

  clearProjectiles() {
    for (const p of this.projectiles) this.scene.remove(p.mesh);
    this.projectiles = [];
  }
}

function easeOutCubic(t) {
  return 1 - Math.pow(1 - t, 3);
}

let _shellTex = null;
function shellTexture() {
  if (_shellTex) return _shellTex;
  const size = 128;
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  const ctx = c.getContext('2d');
  const grad = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.25, 'rgba(255,235,180,0.85)');
  grad.addColorStop(0.55, 'rgba(255,170,60,0.28)');
  grad.addColorStop(1, 'rgba(255,120,0,0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);
  _shellTex = new THREE.CanvasTexture(c);
  _shellTex.colorSpace = THREE.SRGBColorSpace;
  return _shellTex;
}
