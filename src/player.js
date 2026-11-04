import * as THREE from 'three';

// Quake-derived movement model (projection-limited acceleration + friction),
// auto-bunnyhop, air-strafing, sliding, dash, coyote time, jump buffering.
// Movement numbers are tuned for a fast, readable arena shooter.
const CFG = {
  half: 0.4,
  standHeight: 1.8,
  slideHeight: 1.05,
  eyeStand: 1.62,
  eyeSlide: 1.02,
  maxSpeed: 11.2,
  groundAccel: 13.5,
  friction: 8.5,
  slideFriction: 2.1,
  airAccel: 2.0,
  airWishSpeed: 11.2,
  airMax: 30,
  topSpeed: 23,
  gravity: 26,
  jumpSpeed: 9.3,
  stepHeight: 0.62,
  coyoteTime: 0.1,
  jumpBuffer: 0.13,
  dashSpeed: 17.5,
  dashCooldown: 1.65,
  dashTime: 0.22,
  terminal: 58,
};

const UP = new THREE.Vector3(0, 1, 0);
const _v = new THREE.Vector3();
const _wish = new THREE.Vector3();
const _axis = { x: 0, y: 0 };
const _right = new THREE.Vector3();
const _euler = new THREE.Euler(0, 0, 0, 'YXZ');

export class Player {
  constructor(camera, world, audio, effects) {
    this.camera = camera;
    this.world = world;
    this.audio = audio;
    this.effects = effects;

    this.pos = new THREE.Vector3(0, 1, 22);
    this.vel = new THREE.Vector3();
    this.yaw = 0;
    this.pitch = 0;
    this.recoilPitch = 0;
    this.recoilYaw = 0;
    this.height = CFG.standHeight;
    this.eye = CFG.eyeStand;

    this.onGround = true;
    this.wasOnGround = true;
    this.coyote = 0;
    this.jumpBuffer = 0;
    this.jumpHeld = false;
    this.prevJumpHeld = false;
    this.landedImpact = 0;
    this.stepTimer = 0;

    this.health = 100;
    this.maxHealth = 100;
    this.dead = false;
    this.timeSinceDamage = 99;

    this.dashCooldown = 0;
    this.dashTimer = 0;
    this.dashDir = new THREE.Vector3();
    this.wasDashReady = true;

    this.bobPhase = 0;
    this.bobAmount = 0;
    this.dip = 0;
    this.dipVel = 0;
    this.roll = 0;
    this.rollTarget = 0;

    this.shakeTrauma = 0;
    this.shakeTime = 0;
    this.fov = 88;
    this.fovKick = 0;
    this.baseFov = 88;
    this.ads = 0;
    this.moveInput = new THREE.Vector2();
    this.moveMagnitude = 1;
    this.moveInput.set(0, 0);
    this.moveMagnitude = 1;
    this.lookDelta = new THREE.Vector2();
    this.horizSpeedValue = 0;
    this.sliding = false;
    this.hitWall = false;
    this.sensitivity = 0.0022;
    this.speedBoost = 0;
  }

  reset(spawn) {
    this.pos.copy(spawn);
    this.pos.y = Math.max(this.pos.y, 0);
    this.vel.set(0, 0, 0);
    this.yaw = 0;
    this.pitch = -0.03;
    this.recoilPitch = 0;
    this.recoilYaw = 0;
    this.height = CFG.standHeight;
    this.eye = CFG.eyeStand;
    this.onGround = true;
    this.coyote = 0;
    this.jumpBuffer = 0;
    this.health = this.maxHealth;
    this.dead = false;
    this.timeSinceDamage = 99;
    this.dashCooldown = 0;
    this.dashTimer = 0;
    this.shakeTrauma = 0;
    this.dip = 0;
    this.dipVel = 0;
    this.roll = 0;
    this.bobPhase = 0;
    this.speedBoost = 0;
    this.ads = 0;
    this.horizSpeedValue = 0;
    this.fov = this.baseFov;
    this.applyCamera(0, 0);
  }

  horizSpeed() {
    return Math.hypot(this.vel.x, this.vel.z);
  }

  addRecoil(pitch, yaw) {
    this.recoilPitch += pitch;
    this.recoilYaw += yaw;
  }

  addShake(amount) {
    this.shakeTrauma = Math.min(1, this.shakeTrauma + amount);
  }

  heal(amount) {
    this.health = Math.min(this.maxHealth, this.health + amount);
  }

  damage(amount, fromPos) {
    if (this.dead) return;
    this.health = Math.max(0, this.health - amount);
    this.timeSinceDamage = 0;
    this.addShake(Math.min(0.85, 0.28 + amount * 0.02));
    this.audio.playerHit();
    this.effects.burst(this.pos.clone().add(new THREE.Vector3(0, 1.1, 0)), 0xff3b61, 12, 6, 0.14, 0.4, 6);
    if (fromPos) {
      // small knockback away from the damage source
      _v.subVectors(this.pos, fromPos).setY(0);
      if (_v.lengthSq() > 0.001) {
        _v.normalize().multiplyScalar(1.4);
        this.vel.add(_v);
      }
    }
    if (this.health <= 0) this.dead = true;
  }

  // ------------------------------------------------------------- movement
  wishDirection(input, out) {
    const axis = input.moveAxis(_axis);
    const f = axis.y;
    const s = axis.x;
    this.moveInput.set(s, f);
    this.moveMagnitude = Math.min(1, Math.hypot(s, f));
    out.set(0, 0, 0);
    if (this.moveMagnitude < 0.001) return out;
    const sin = Math.sin(this.yaw);
    const cos = Math.cos(this.yaw);
    // forward = (-sin, 0, -cos), right = (cos, 0, -sin)
    out.x = -sin * f + cos * s;
    out.z = -cos * f - sin * s;
    out.normalize();
    return out;
  }

  update(dt, input, adsTarget = 0) {
    if (this.dead) {
      this.deadUpdate(dt);
      return;
    }
    this.timeSinceDamage += dt;

    // ----- look (once per frame, not per substep)
    const m = input.consumeMouse();
    this.lookDelta.set(m.dx, m.dy);
    const sens = this.sensitivity * (1 - 0.38 * this.ads);
    this.yaw -= m.dx * sens;
    this.pitch -= m.dy * sens * (input.invertY ? -1 : 1);
    this.pitch = Math.max(-1.553, Math.min(1.553, this.pitch));

    this.ads += (adsTarget - this.ads) * Math.min(1, dt * 12);

    // ----- intents
    const wish = this.wishDirection(input, _wish);
    const jumpHeld = input.down('Space');
    if (input.pressed('Space')) this.jumpBuffer = CFG.jumpBuffer;
    if (input.pressed('ShiftLeft') || input.pressed('ShiftRight')) this.tryDash(wish);
    const wantSlide = input.down('ControlLeft') || input.down('ControlRight');

    // jump-cut: releasing space shortens the hop for precision landings
    if (this.prevJumpHeld && !jumpHeld && this.vel.y > 2.4 && !this.onGround) {
      this.vel.y *= 0.5;
    }
    this.prevJumpHeld = jumpHeld;
    this.jumpHeld = jumpHeld;
    this.jumpBuffer = Math.max(0, this.jumpBuffer - dt);

    // dash cooldown
    this.dashCooldown = Math.max(0, this.dashCooldown - dt);
    this.dashTimer = Math.max(0, this.dashTimer - dt);
    const dashReady = this.dashCooldown <= 0;
    if (dashReady && !this.wasDashReady) {
      this.audio.dashReady();
      this.fovKick += 1.2;
    }
    this.wasDashReady = dashReady;

    // ----- fixed substeps for stable collision at high speed
    const steps = Math.max(1, Math.min(8, Math.ceil(dt / 0.007)));
    const h = dt / steps;
    this.wasOnGround = this.onGround;
    this.hitWall = false;

    for (let i = 0; i < steps; i++) {
      this.physicsStep(h, wish, jumpHeld, wantSlide);
    }

    // ----- coyote time
    if (this.onGround) this.coyote = CFG.coyoteTime;
    else this.coyote = Math.max(0, this.coyote - dt);

    // ----- speed assist pads / dash trail
    if (this.speedBoost > 0) this.speedBoost = Math.max(0, this.speedBoost - dt);
    this.horizSpeedValue = this.horizSpeed();

    // ----- landing feedback
    if (this.onGround && !this.wasOnGround && this.landedImpact > 2.4) {
      const impact = this.landedImpact;
      this.audio.land(impact);
      this.addShake(Math.min(0.45, impact * 0.016));
      this.dipVel -= Math.min(1.9, impact * 0.075);
      const ground = this.pos.clone();
      ground.y = this.pos.y + 0.02;
      this.effects.ring(ground, 0x63f5ff, 0.5, 0.38, Math.min(5, impact * 0.18));
      this.effects.burst(ground, 0x9fe9ff, Math.min(16, Math.floor(impact)), Math.min(7, impact * 0.35), 0.09, 0.35, 9);
    }
    this.landedImpact = 0;

    // ----- footsteps
    if (this.onGround && !this.sliding && this.horizSpeed() > 1.5) {
      this.bobPhase += dt * (3.4 + this.horizSpeed() * 0.85);
      this.stepTimer -= dt;
      if (this.stepTimer <= 0) {
        this.stepTimer = Math.min(0.44, 4.4 / Math.max(2.4, this.horizSpeed()));
        this.audio.step(this.horizSpeed());
      }
    } else {
      this.bobPhase += dt * 1.1;
    }

    // ----- bob + camera springs
    const targetBob = this.onGround ? Math.min(1, this.horizSpeed() / CFG.maxSpeed) : 0;
    this.bobAmount += (targetBob - this.bobAmount) * Math.min(1, dt * 8);
    this.dipVel += (-this.dip * 130 - this.dipVel * 18) * dt;
    this.dip += this.dipVel * dt;

    const velRight = this.vel.x * Math.cos(this.yaw) - this.vel.z * Math.sin(this.yaw);
    this.rollTarget = -velRight * 0.0055 + (this.dashTimer > 0 ? -0.045 : 0);
    this.roll += (this.rollTarget - this.roll) * Math.min(1, dt * 7);

    // recoil recovery
    this.recoilPitch *= Math.exp(-dt * 9);
    this.recoilYaw *= Math.exp(-dt * 9);
    this.shakeTrauma = Math.max(0, this.shakeTrauma - dt * 1.9);
    this.fovKick *= Math.exp(-dt * 6);

    // ----- fov
    const speedFov = Math.min(1, Math.max(0, (this.horizSpeed() - CFG.maxSpeed) / 18)) * 9;
    const targetFov = this.baseFov + speedFov + this.fovKick - 12 * this.ads;
    this.fov += (targetFov - this.fov) * Math.min(1, dt * 7);

    this.audio.setSpeed(this.horizSpeed());

    // health regen after a quiet moment
    if (this.timeSinceDamage > 5.5 && this.health < this.maxHealth) {
      this.health = Math.min(this.maxHealth, this.health + dt * 14);
    }

    this.applyCamera(dt, this.ads);
  }

  physicsStep(dt, wish, jumpHeld, wantSlide) {
    const groundSpeedBefore = this.horizSpeed();

    // collision height follows slide state
    const targetHeight = wantSlide && this.onGround ? CFG.slideHeight : CFG.standHeight;
    this.height += (targetHeight - this.height) * Math.min(1, dt * 16);
    this.sliding = wantSlide && this.onGround && groundSpeedBefore > 5;

    if (this.onGround) {
      const wantsJump = this.jumpBuffer > 0 || jumpHeld;
      if (wantsJump) {
        // jump before friction so ground friction never eats the momentum
        this.vel.y = CFG.jumpSpeed;
        this.onGround = false;
        this.coyote = 0;
        this.jumpBuffer = 0;
        this.audio.jump();
        this.fovKick += 1.6;
        const p = this.pos.clone().add(new THREE.Vector3(0, 0.08, 0));
        this.effects.ring(p, 0x63f5ff, 0.42, 0.3, 4);
        this.addShake(0.06);
      } else {
        // Quake friction
        const speed = this.horizSpeed();
        if (speed > 0.001) {
          const fr = this.sliding ? CFG.slideFriction : CFG.friction;
          const drop = speed * fr * dt;
          const scale = Math.max(speed - drop, 0) / speed;
          this.vel.x *= scale;
          this.vel.z *= scale;
        }
        // accelerate (projection-limited)
        if (wish.lengthSq() > 0) {
          const wishSpeed = CFG.maxSpeed * Math.max(0.25, this.moveMagnitude);
          const current = this.vel.x * wish.x + this.vel.z * wish.z;
          const add = wishSpeed - current;
          if (add > 0) {
            const accelSpeed = Math.min(CFG.groundAccel * wishSpeed * dt, add);
            this.vel.x += wish.x * accelSpeed;
            this.vel.z += wish.z * accelSpeed;
          }
        }
      }
    } else if (wish.lengthSq() > 0) {
      // Quake air accelerate: only the projection of velocity onto the wish
      // direction is limited, which is what makes air-strafing gain speed.
      // The gain tapers off near topSpeed so momentum stays controllable.
      const wishSpeed = CFG.airWishSpeed;
      const current = this.vel.x * wish.x + this.vel.z * wish.z;
      const add = Math.min(wishSpeed, CFG.airMax) - current;
      if (add > 0) {
        const sp = this.horizSpeed();
        const taper = sp > 16 ? Math.max(0, (CFG.topSpeed - sp) / 7) : 1;
        const accelSpeed = Math.min(CFG.airAccel * wishSpeed * dt * taper, add);
        this.vel.x += wish.x * accelSpeed;
        this.vel.z += wish.z * accelSpeed;
      }
    }

    // dash impulse (works on ground and in air)
    if (this.dashTimer > 0) {
      this.vel.x = this.dashDir.x * Math.max(this.horizSpeed(), CFG.dashSpeed * 0.7);
      this.vel.z = this.dashDir.z * Math.max(this.horizSpeed(), CFG.dashSpeed * 0.7);
    }

    // gravity with a little apex hang for readable arcs
    let grav = CFG.gravity;
    if (Math.abs(this.vel.y) < 2.2 && !this.onGround) grav *= 0.72;
    this.vel.y = Math.max(-CFG.terminal, this.vel.y - grav * dt);

    // hard speed cap (keeps air-strafe from becoming unbounded)
    const hs = this.horizSpeed();
    if (hs > CFG.topSpeed) {
      const k = CFG.topSpeed / hs;
      this.vel.x *= k;
      this.vel.z *= k;
    }

    const wasGrounded = this.onGround;
    const fallSpeed = -this.vel.y;

    // integrate + resolve per axis
    this.moveAxisX(dt);
    this.moveAxisZ(dt);
    this.moveAxisY(dt);

    if (this.onGround && !wasGrounded) this.landedImpact = Math.max(this.landedImpact, fallSpeed);

    // jump pads
    for (const pad of this.world.pads) {
      if (pad.cooldown > 0) continue;
      const dx = this.pos.x - pad.pos.x;
      const dz = this.pos.z - pad.pos.z;
      if (dx * dx + dz * dz < pad.radius * pad.radius && this.pos.y < pad.pos.y + 0.9 && this.vel.y < 12) {
        pad.cooldown = 0.8;
        this.vel.y = pad.power;
        this.onGround = false;
        this.audio.jumpPad();
        this.fovKick += 4;
        this.addShake(0.2);
        this.effects.ring(pad.pos.clone().setY(pad.pos.y + 0.3), 0xffc063, 1.2, 0.5, 5);
        this.effects.burst(pad.pos.clone().setY(pad.pos.y + 0.4), 0xffc063, 20, 6, 0.14, 0.5, 4);
      }
    }

    // fell out of the world
    if (this.pos.y < -25) {
      this.pos.set(0, 2, 22);
      this.vel.set(0, 0, 0);
      this.damage(20, null);
    }

    this.height = Math.max(CFG.slideHeight, Math.min(CFG.standHeight, this.height));
    const eyeTarget = this.sliding ? CFG.eyeSlide : CFG.eyeStand;
    this.eye += (eyeTarget - this.eye) * Math.min(1, dt * 14);
  }

  tryDash(wish) {
    if (this.dashCooldown > 0 || this.dead) return;
    // dash in wish direction, or straight forward when no key is held
    if (wish.lengthSq() > 0) this.dashDir.copy(wish);
    else this.dashDir.set(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    this.dashCooldown = CFG.dashCooldown;
    this.dashTimer = CFG.dashTime;
    this.vel.x = this.dashDir.x * CFG.dashSpeed;
    this.vel.z = this.dashDir.z * CFG.dashSpeed;
    this.vel.y = Math.max(this.vel.y, this.onGround ? 2.2 : 0.4);
    this.audio.dash();
    this.addShake(0.22);
    this.fovKick += 5;
    const p = this.pos.clone().add(new THREE.Vector3(0, this.height * 0.55, 0));
    this.effects.dashTrail(p, this.dashDir, 0x63f5ff);
  }

  overlaps(c, minX, minY, minZ, maxX, maxY, maxZ) {
    return !(maxX <= c.min.x || minX >= c.max.x || maxY <= c.min.y || minY >= c.max.y || maxZ <= c.min.z || minZ >= c.max.z);
  }

  moveAxisX(dt) {
    this.pos.x += this.vel.x * dt;
    const half = CFG.half;
    for (const c of this.world.colliders) {
      if (!this.overlaps(c, this.pos.x - half, this.pos.y, this.pos.z - half, this.pos.x + half, this.pos.y + this.height, this.pos.z + half)) continue;
      if (this.tryStepUp(c)) continue;
      if (this.vel.x > 0) this.pos.x = c.min.x - half - 0.001;
      else if (this.vel.x < 0) this.pos.x = c.max.x + half + 0.001;
      this.vel.x = 0;
      this.hitWall = true;
    }
  }

  moveAxisZ(dt) {
    this.pos.z += this.vel.z * dt;
    const half = CFG.half;
    for (const c of this.world.colliders) {
      if (!this.overlaps(c, this.pos.x - half, this.pos.y, this.pos.z - half, this.pos.x + half, this.pos.y + this.height, this.pos.z + half)) continue;
      if (this.tryStepUp(c)) continue;
      if (this.vel.z > 0) this.pos.z = c.min.z - half - 0.001;
      else if (this.vel.z < 0) this.pos.z = c.max.z + half + 0.001;
      this.vel.z = 0;
      this.hitWall = true;
    }
  }

  moveAxisY(dt) {
    const prevY = this.pos.y;
    this.pos.y += this.vel.y * dt;
    const half = CFG.half;
    this.onGround = false;
    for (const c of this.world.colliders) {
      if (!this.overlaps(c, this.pos.x - half, this.pos.y, this.pos.z - half, this.pos.x + half, this.pos.y + this.height, this.pos.z + half)) continue;
      const penTop = c.max.y - this.pos.y;
      const penBottom = this.pos.y + this.height - c.min.y;
      if (penTop <= penBottom) {
        this.pos.y = c.max.y;
        if (this.vel.y <= 0) {
          this.vel.y = 0;
          this.onGround = true;
        }
      } else {
        this.pos.y = c.min.y - this.height;
        if (this.vel.y > 0) this.vel.y = 0;
      }
    }
    // ground probe (a hair below the feet) keeps coyote time honest on ledges
    if (!this.onGround && this.vel.y <= 0.001) {
      const probeY = this.pos.y - 0.06;
      for (const c of this.world.colliders) {
        if (
          this.pos.x + half > c.min.x &&
          this.pos.x - half < c.max.x &&
          this.pos.z + half > c.min.z &&
          this.pos.z - half < c.max.z &&
          probeY <= c.max.y + 0.02 &&
          probeY >= c.max.y - 0.12 &&
          prevY >= c.max.y - 0.3
        ) {
          this.onGround = true;
          this.vel.y = 0;
          break;
        }
      }
    }
    if (this.pos.y <= 0 && this.vel.y <= 0) {
      this.pos.y = 0;
      this.vel.y = 0;
      this.onGround = true;
    }
  }

  // step onto small ledges without losing speed
  tryStepUp(c) {
    if (!this.onGround) return false;
    const rise = c.max.y - this.pos.y;
    if (rise <= 0.02 || rise > CFG.stepHeight) return false;
    if (this.pos.y + this.height + rise > c.min.y && rise > this.height) return false;
    const testY = c.max.y + 0.002;
    const half = CFG.half;
    for (const o of this.world.colliders) {
      if (o === c) continue;
      if (this.overlaps(o, this.pos.x - half, testY, this.pos.z - half, this.pos.x + half, testY + this.height, this.pos.z + half)) {
        return false;
      }
    }
    this.pos.y = testY;
    return true;
  }

  applyCamera(dt, ads = 0) {
    const half = CFG.half;
    const targetEye = this.pos.y + this.eye + this.dip;
    const right = _right.set(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
    const bobScale = this.bobAmount * (1 - ads * 0.7);
    const bobY = Math.sin(this.bobPhase * 2) * 0.022 * bobScale;
    const bobX = Math.cos(this.bobPhase) * 0.02 * bobScale;

    this.shakeTime += dt;
    const t = this.shakeTime * 44;
    const s = this.shakeTrauma * this.shakeTrauma;
    const shakePitch = Math.sin(t * 1.7) * Math.sin(t * 0.83) * s * 0.03;
    const shakeYaw = Math.sin(t * 1.31 + 2.1) * s * 0.03;
    const shakeRoll = Math.sin(t * 2.11 + 1.3) * s * 0.045;
    const shakeY = Math.sin(t * 2.7 + 0.4) * s * 0.035;

    this.camera.position.set(this.pos.x + right.x * bobX, targetEye + bobY + shakeY, this.pos.z + right.z * bobX);
    _euler.set(this.pitch + this.recoilPitch + shakePitch, this.yaw + this.recoilYaw + shakeYaw, this.roll + shakeRoll);
    this.camera.quaternion.setFromEuler(_euler);
    this.camera.position.x += half * 0; // keep collision box centered

    let fov = this.fov;
    const aspect = this.camera.aspect || 1;
    if (aspect < 1) {
      // portrait phones: widen vertically so the usable view isn't a slit
      fov = Math.min(104, fov * (1 + (1 - aspect) * 0.55));
    }
    if (Math.abs(this.camera.fov - fov) > 0.01) {
      this.camera.fov = fov;
      this.camera.updateProjectionMatrix();
    }
  }

  deadUpdate(dt) {
    // slump forward and drift to a stop
    this.vel.multiplyScalar(Math.max(0, 1 - dt * 4));
    this.pos.y = Math.max(0, this.pos.y + this.vel.y * dt);
    this.vel.y = Math.max(-30, this.vel.y - 26 * dt);
    this.pos.x += this.vel.x * dt;
    this.pos.z += this.vel.z * dt;
    if (this.pos.y <= 0) {
      this.pos.y = 0;
      this.vel.y = 0;
    }
    this.height = Math.max(0.6, this.height - dt * 1.2);
    this.eye = Math.max(0.45, this.eye - dt * 1.6);
    this.roll += (-0.55 - this.roll) * Math.min(1, dt * 3);
    this.pitch += (-0.35 - this.pitch) * Math.min(1, dt * 2);
    this.applyCamera(dt, 0);
  }

  eyePosition(out = new THREE.Vector3()) {
    return out.set(this.pos.x, this.pos.y + this.eye, this.pos.z);
  }

  center(out = new THREE.Vector3()) {
    return out.set(this.pos.x, this.pos.y + this.height * 0.55, this.pos.z);
  }
}

export { CFG as PlayerConfig };
