import * as THREE from 'three';

const TAU = Math.PI * 2;

// The VX-9: hitscan rifle with bloom, recoil, focus aim, procedural viewmodel
// animation and a layered muzzle flash.
export class Weapon {
  constructor(camera, scene, audio, effects, player, world, enemies) {
    this.camera = camera;
    this.scene = scene;
    this.audio = audio;
    this.effects = effects;
    this.player = player;
    this.world = world;
    this.enemies = enemies;

    this.magSize = 30;
    this.ammo = 30;
    this.fireInterval = 0.088;
    this.cooldown = 0;
    this.reloadTime = 1.35;
    this.reloading = false;
    this.reloadTimer = 0;
    this.emptyCooldown = 0;

    this.damage = 20;
    this.headshotMultiplier = 2.2;
    this.bloom = 0;
    this.ads = 0;
    this.kick = 0;
    this.kickVel = 0;
    this.kickPitch = 0;
    this.swayX = 0;
    this.swayY = 0;
    this.time = 0;

    this.onHit = null;
    this.onShoot = null;

    this.hitPoint = new THREE.Vector3();
    this.hitNormal = new THREE.Vector3();

    this.build();
  }

  build() {
    const group = new THREE.Group();
    const bodyMat = new THREE.MeshStandardMaterial({
      color: 0x2a3a52,
      roughness: 0.42,
      metalness: 0.55,
      emissive: 0x0d2436,
      emissiveIntensity: 0.9,
    });
    const darkMat = new THREE.MeshStandardMaterial({
      color: 0x111a28,
      roughness: 0.6,
      metalness: 0.4,
      emissive: 0x081420,
      emissiveIntensity: 0.6,
    });
    const glowMat = new THREE.MeshBasicMaterial({ color: 0x2bb8c8 });
    const accentMat = new THREE.MeshBasicMaterial({ color: 0xffb347 });

    const add = (geo, mat, x, y, z, rx = 0, ry = 0, rz = 0) => {
      const m = new THREE.Mesh(geo, mat);
      m.position.set(x, y, z);
      m.rotation.set(rx, ry, rz);
      group.add(m);
      return m;
    };

    // receiver / barrel / rail
    add(new THREE.BoxGeometry(0.17, 0.16, 0.6), bodyMat, 0, 0, 0);
    add(new THREE.BoxGeometry(0.085, 0.085, 0.46), bodyMat, 0, 0.012, -0.48);
    add(new THREE.BoxGeometry(0.115, 0.115, 0.13), darkMat, 0, 0.012, -0.74);
    add(new THREE.BoxGeometry(0.13, 0.05, 0.34), darkMat, 0, 0.105, -0.2);
    add(new THREE.BoxGeometry(0.055, 0.026, 0.05), darkMat, 0, 0.133, -0.07);
    add(new THREE.BoxGeometry(0.016, 0.016, 0.016), glowMat, 0, 0.14, -0.095);
    add(new THREE.BoxGeometry(0.03, 0.008, 0.008), accentMat, 0, 0.12, -0.02);

    // grip, magazine, stock
    add(new THREE.BoxGeometry(0.075, 0.22, 0.1), darkMat, 0, -0.17, 0.16, 0.28);
    this.magMesh = add(new THREE.BoxGeometry(0.095, 0.27, 0.14), bodyMat, 0, -0.2, -0.02, -0.1);
    add(new THREE.BoxGeometry(0.075, 0.13, 0.26), darkMat, 0, -0.015, 0.36);

    // glowing spine strips (readability in a dark arena)
    add(new THREE.BoxGeometry(0.012, 0.012, 0.42), glowMat, -0.088, 0.058, -0.02);
    add(new THREE.BoxGeometry(0.012, 0.012, 0.42), glowMat, 0.088, 0.058, -0.02);
    add(new THREE.BoxGeometry(0.012, 0.012, 0.2), accentMat, 0.088, -0.045, 0.12);

    // muzzle flash sprite + light
    this.muzzle = new THREE.Object3D();
    this.muzzle.position.set(0, 0.012, -0.86);
    group.add(this.muzzle);

    const flashMat = new THREE.SpriteMaterial({
      map: muzzleTexture(),
      color: 0xffd58a,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      depthTest: false,
    });
    this.flashSprite = new THREE.Sprite(flashMat);
    this.flashSprite.scale.setScalar(0.55);
    this.flashSprite.visible = false;
    this.muzzle.add(this.flashSprite);

    this.flashLight = new THREE.PointLight(0xffc063, 0, 16, 2);
    this.flashLight.position.copy(this.muzzle.position);
    group.add(this.flashLight);
    this.flashTimer = 0;

    this.group = group;
    group.visible = false;
    this.camera.add(group);

    group.scale.setScalar(0.66);
    this.hip = new THREE.Vector3(0.32, -0.285, -0.6);
    this.adsPos = new THREE.Vector3(0, -0.16, -0.46);
    group.position.copy(this.hip);
    group.rotation.set(0, 0.035, 0);
  }

  reset() {
    this.ammo = this.magSize;
    this.reloading = false;
    this.reloadTimer = 0;
    this.cooldown = 0;
    this.bloom = 0;
    this.kick = 0;
    this.kickVel = 0;
    this.kickPitch = 0;
    this.ads = 0;
    this.flashTimer = 0;
    this.flashSprite.visible = false;
    this.flashLight.intensity = 0;
    this.group.visible = true;
  }

  setVisible(v) {
    this.group.visible = v;
  }

  startReload() {
    if (this.reloading || this.ammo === this.magSize) return;
    this.reloading = true;
    this.reloadTimer = 0;
    this.audio.reload();
    this.bloom = 0;
  }

  spreadRadians() {
    return (0.0016 + this.bloom * 0.00052 + this.player.horizSpeed() * 0.00006) * (1 - 0.74 * this.ads);
  }

  spreadPixels() {
    return 7 + this.bloom * 1.05 + Math.min(8, this.player.horizSpeed() * 0.22) - this.ads * 4;
  }

  update(dt, input, canFire) {
    this.time += dt;
    this.cooldown = Math.max(0, this.cooldown - dt);
    this.emptyCooldown = Math.max(0, this.emptyCooldown - dt);
    this.bloom *= Math.exp(-dt * 7.5);

    const adsTarget = canFire && input.mouse(2) && !this.reloading ? 1 : 0;
    this.ads += (adsTarget - this.ads) * Math.min(1, dt * 14);

    // reload
    if (this.reloading) {
      this.reloadTimer += dt;
      if (this.reloadTimer >= this.reloadTime) {
        this.reloading = false;
        this.ammo = this.magSize;
        this.bloom = 0;
      }
    }

    // firing
    if (canFire && !this.reloading) {
      if (input.mouse(0)) {
        if (this.ammo > 0) {
          while (this.cooldown <= 0 && this.ammo > 0) {
            this.fire();
            this.cooldown += this.fireInterval;
          }
        } else if (this.emptyCooldown <= 0) {
          this.audio.empty();
          this.emptyCooldown = 0.28;
          this.startReload();
        }
      }
      if (input.pressed('KeyR')) this.startReload();
      if (this.ammo === 0) this.startReload();
    }

    // viewmodel sway from mouse movement
    const swayTX = Math.max(-0.05, Math.min(0.05, -this.player.lookDelta.x * 0.0009));
    const swayTY = Math.max(-0.05, Math.min(0.05, -this.player.lookDelta.y * 0.0009));
    this.swayX += (swayTX - this.swayX) * Math.min(1, dt * 11);
    this.swayY += (swayTY - this.swayY) * Math.min(1, dt * 11);

    // recoil spring
    this.kickVel += (-this.kick * 260 - this.kickVel * 22) * dt;
    this.kick += this.kickVel * dt;
    this.kickPitch *= Math.exp(-dt * 9);

    // reload animation
    let reloadDip = 0;
    let reloadRoll = 0;
    let magY = 0;
    if (this.reloading) {
      const t = Math.min(1, this.reloadTimer / this.reloadTime);
      const curve = Math.sin(t * Math.PI);
      reloadDip = curve * 0.13;
      reloadRoll = curve * 0.7;
      const magPhase = Math.min(1, Math.max(0, (t - 0.12) / 0.5));
      magY = -Math.sin(magPhase * Math.PI) * 0.2;
    }
    this.magMesh.position.y = -0.2 + magY;

    // muzzle flash decay
    if (this.flashTimer > 0) {
      this.flashTimer -= dt;
      const k = Math.max(0, this.flashTimer / 0.055);
      this.flashSprite.material.opacity = k;
      this.flashSprite.scale.setScalar(0.35 + (1 - k) * 0.45);
      this.flashLight.intensity = k * 320;
      if (this.flashTimer <= 0) {
        this.flashSprite.visible = false;
        this.flashLight.intensity = 0;
      }
    }

    // assemble transform
    const a = this.ads;
    const bob = this.player.bobAmount * (1 - a * 0.85);
    const bobX = Math.cos(this.player.bobPhase) * 0.012 * bob;
    const bobY = Math.sin(this.player.bobPhase * 2) * 0.009 * bob;

    const g = this.group;
    g.position.x = this.hip.x + (this.adsPos.x - this.hip.x) * a + this.swayX * (1 - a * 0.7) + bobX;
    g.position.y = this.hip.y + (this.adsPos.y - this.hip.y) * a + this.swayY * (1 - a * 0.7) + bobY + reloadDip;
    g.position.z = this.hip.z + (this.adsPos.z - this.hip.z) * a + this.kick * 0.09;
    g.rotation.x = this.kickPitch * 0.5 + reloadRoll * 0.35 + this.swayY * 2.2;
    g.rotation.y = this.swayX * 2.4 + (1 - a) * 0.035;
    g.rotation.z = reloadRoll * 0.7 + this.player.roll * 0.35;

    // when the player dies the rifle drops out of frame
    if (this.player.dead) {
      g.position.y -= 0.35;
      g.rotation.x += 0.7;
    }
  }

  fire() {
    this.ammo--;
    this.bloom = Math.min(16, this.bloom + 1.15);
    if (this.onShoot) this.onShoot();

    // note: viewmodel transform is only rebuilt next frame, so compute the
    // muzzle from the camera directly to keep tracers perfectly aligned.
    const origin = this.camera.position.clone();
    const dir = new THREE.Vector3();
    this.camera.getWorldDirection(dir);

    const spread = this.spreadRadians();
    if (spread > 0) {
      const right = new THREE.Vector3(1, 0, 0).applyQuaternion(this.camera.quaternion);
      const up = new THREE.Vector3(0, 1, 0).applyQuaternion(this.camera.quaternion);
      const ang = Math.random() * TAU;
      const r = Math.sqrt(Math.random()) * spread;
      dir.addScaledVector(right, Math.cos(ang) * r).addScaledVector(up, Math.sin(ang) * r).normalize();
    }

    this.camera.updateMatrixWorld();
    const muzzlePos = new THREE.Vector3();
    this.muzzle.getWorldPosition(muzzlePos);

    const worldHit = this.world.raycast(origin, dir, 220);
    const eHit = this.enemies.raycast(origin, dir, worldHit ? worldHit.distance : 220);

    let end;
    if (eHit) {
      end = eHit.point;
      const dmg = this.damage * (eHit.headshot ? this.headshotMultiplier : 1);
      this.effects.sparks(end, dir.clone().negate(), eHit.headshot ? 0xffd88a : 0xff9ae8, 8);
      if (this.onHit) this.onHit({ enemy: eHit.enemy, point: eHit.point, headshot: eHit.headshot, damage: dmg });
    } else if (worldHit) {
      end = worldHit.point;
      this.effects.impact(worldHit.point, worldHit.normal, 0xffc063);
      this.audio.impact(worldHit.point, this.camera);
    } else {
      end = origin.clone().addScaledVector(dir, 140);
    }

    this.effects.tracer(muzzlePos, end, 0xffe3b0);
    this.audio.shoot(0.9);
    this.player.addRecoil(0.0075 + Math.random() * 0.0035, (Math.random() - 0.5) * 0.006);
    this.player.addShake(0.075);

    this.kickVel += 0.85;
    this.kickPitch += 0.05 + Math.random() * 0.02;
    this.flashSprite.visible = true;
    this.flashSprite.material.rotation = Math.random() * TAU;
    this.flashSprite.material.opacity = 1;
    this.flashTimer = 0.055;
    this.flashLight.intensity = 320;
  }
}

let _muzzleTex = null;
function muzzleTexture() {
  if (_muzzleTex) return _muzzleTex;
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
  // star spikes
  ctx.strokeStyle = 'rgba(255,240,200,0.9)';
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.moveTo(size / 2, 8);
  ctx.lineTo(size / 2, size - 8);
  ctx.moveTo(8, size / 2);
  ctx.lineTo(size - 8, size / 2);
  ctx.stroke();
  _muzzleTex = new THREE.CanvasTexture(c);
  _muzzleTex.colorSpace = THREE.SRGBColorSpace;
  return _muzzleTex;
}
