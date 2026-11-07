import * as THREE from 'three';
import { buildWeaponModel } from './weaponModels.js';
import { WEAPONS } from './weapon.js';

// The third-person body. It is only built once and hidden in first person, so
// switching view costs a visibility flag rather than a scene rebuild.
//
// Proportions follow a roughly 7.5-head figure: the head is about 1/7.5 of the
// body, shoulders span a little over two head widths, the ribcage tapers into
// the waist, and the limbs use tapered cylinders with separate upper and lower
// segments. Joints are spheres, not boxes, so elbows and knees stay round when
// they bend. The armour is deliberately close-fitting; the bright trim on the
// spine, shoulders, calves and helmet keeps the back readable in dark arenas.
//
// The skeleton is procedural: the run, slide and air poses are driven by the
// player's actual speed and state. The right arm carries the rifle and the
// left arm is solved with a two-bone IK every frame so the support hand stays
// on the foregrip instead of swinging loose.
export class Avatar {
  constructor(scene, player, weapons) {
    this.scene = scene;
    this.player = player;
    this.weapons = weapons;

    this.root = new THREE.Group();
    this.root.visible = false;
    this.root.frustumCulled = false;
    scene.add(this.root);

    this.body = new THREE.Group();
    this.root.add(this.body);

    this.suit = new THREE.MeshStandardMaterial({
      color: 0x2c4055,
      roughness: 0.74,
      metalness: 0.16,
      emissive: 0x050b12,
      emissiveIntensity: 1,
    });
    this.plate = new THREE.MeshStandardMaterial({
      color: 0x5a7590,
      roughness: 0.42,
      metalness: 0.46,
      emissive: 0x0a1a26,
      emissiveIntensity: 1,
    });
    this.glass = new THREE.MeshStandardMaterial({
      color: 0x07131c,
      roughness: 0.16,
      metalness: 0.82,
      emissive: 0x02070b,
      emissiveIntensity: 1,
    });
    this.trim = new THREE.MeshBasicMaterial({ color: 0x63f5ff });
    this.visor = new THREE.MeshBasicMaterial({ color: 0xa8f4ff });
    this.hot = new THREE.MeshBasicMaterial({ color: 0xffb347 });

    this.phase = 0;
    this.gunIndex = -1;
    this.flashTimer = 0;

    this.buildLegs();
    this.buildTorso();
    this.buildArms();
    this.buildGuns();
  }

  // -------------------------------------------------------------- primitives
  mesh(geometry, mat, parent, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1) {
    const mesh = new THREE.Mesh(geometry, mat);
    mesh.position.set(x, y, z);
    mesh.rotation.set(rx, ry, rz);
    mesh.scale.set(sx, sy, sz);
    mesh.frustumCulled = false;
    parent.add(mesh);
    return mesh;
  }

  capsule(radius, length, mat, parent, x, y, z, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1) {
    return this.mesh(
      new THREE.CapsuleGeometry(radius, length, 6, 16),
      mat, parent, x, y, z, rx, ry, rz, sx, sy, sz
    );
  }

  cylinder(top, bottom, height, mat, parent, x, y, z, sx = 1, sy = 1, sz = 1) {
    return this.mesh(
      new THREE.CylinderGeometry(top, bottom, height, 18),
      mat, parent, x, y, z, 0, 0, 0, sx, sy, sz
    );
  }

  sphere(radius, mat, parent, x, y, z, sx = 1, sy = 1, sz = 1) {
    return this.mesh(
      new THREE.SphereGeometry(radius, 20, 14),
      mat, parent, x, y, z, 0, 0, 0, sx, sy, sz
    );
  }

  // ---------------------------------------------------------------- skeleton
  buildLegs() {
    // Hip joint at 0.94 m, knee at 0.54 m, ankle at 0.19 m. The thigh and shin
    // are tapered separately so the leg narrows toward the knee and again
    // toward the ankle instead of reading as one tube.
    this.legL = new THREE.Group();
    this.legL.position.set(-0.103, 0.94, 0);
    this.body.add(this.legL);
    this.legR = new THREE.Group();
    this.legR.position.set(0.103, 0.94, 0);
    this.body.add(this.legR);

    this.kneeL = new THREE.Group();
    this.kneeL.position.y = -0.4;
    this.legL.add(this.kneeL);
    this.kneeR = new THREE.Group();
    this.kneeR.position.y = -0.4;
    this.legR.add(this.kneeR);

    this.footL = new THREE.Group();
    this.footL.position.y = -0.35;
    this.kneeL.add(this.footL);
    this.footR = new THREE.Group();
    this.footR.position.y = -0.35;
    this.kneeR.add(this.footR);

    const build = (leg, knee, foot, side) => {
      // thigh: broad at the hip, narrowing into the knee
      this.sphere(0.083, this.suit, leg, 0, -0.005, 0, 1.02, 1.05, 1);
      this.cylinder(0.084, 0.061, 0.32, this.suit, leg, 0, -0.18, 0, 1, 1, 0.96);
      this.sphere(0.074, this.suit, leg, 0, -0.14, -0.018, 1, 1.35, 0.92);
      this.sphere(0.06, this.plate, leg, side * 0.055, -0.13, 0.005, 0.75, 1.35, 0.9);
      this.capsule(0.008, 0.12, this.trim, leg, 0, -0.17, 0.076, 0, 0, 0.02);
      this.capsule(0.008, 0.11, this.trim, leg, side * 0.072, -0.18, 0, 0, 0, side * 0.03);

      // knee joint and floating cap
      this.sphere(0.053, this.suit, knee, 0, 0, 0, 1, 0.94, 1);
      this.sphere(0.051, this.plate, knee, 0, 0.005, -0.043, 0.98, 1.08, 0.55);

      // calf: the muscle sits high at the back, then the shin narrows
      this.cylinder(0.061, 0.044, 0.3, this.suit, knee, 0, -0.17, 0, 1, 1, 0.96);
      this.sphere(0.055, this.suit, knee, 0, -0.095, 0.021, 0.95, 1.4, 0.92);
      this.sphere(0.043, this.suit, knee, 0, -0.335, 0, 1, 1.1, 0.95);
      this.capsule(0.008, 0.13, this.trim, knee, 0, -0.18, 0.058, 0, 0, 0, 1, 1, 1);

      // boot: ankle cuff, rounded foot and a flat sole that reaches the floor
      this.cylinder(0.052, 0.047, 0.09, this.plate, foot, 0, -0.045, 0, 1, 1, 0.95);
      this.sphere(0.046, this.plate, foot, 0, -0.05, -0.005, 1, 1.05, 1);
      this.capsule(0.055, 0.12, this.plate, foot, 0, -0.105, -0.05, Math.PI / 2, 0, 0, 1, 1, 0.9);
      this.capsule(0.05, 0.14, this.suit, foot, 0, -0.135, -0.045, Math.PI / 2, 0, 0, 1, 0.55, 0.92);
      this.sphere(0.055, this.plate, foot, 0, -0.105, -0.155, 0.9, 0.62, 0.72);
      this.sphere(0.045, this.plate, foot, 0, -0.105, 0.052, 0.9, 0.8, 0.6);
      this.capsule(0.007, 0.08, this.trim, foot, 0, -0.085, 0.045, 0, 0, Math.PI / 2);
    };

    build(this.legL, this.kneeL, this.footL, -1);
    build(this.legR, this.kneeR, this.footR, 1);

    // pelvis + glutes: broad hips, but still narrower than the shoulders
    this.sphere(0.145, this.suit, this.body, 0, 0.95, 0, 1.22, 0.84, 0.96);
    this.sphere(0.06, this.suit, this.body, -0.064, 0.93, 0.068, 1, 1.02, 0.8);
    this.sphere(0.06, this.suit, this.body, 0.064, 0.93, 0.068, 1, 1.02, 0.8);
    // a fitted belt band instead of a floating hoop
    this.cylinder(0.163, 0.168, 0.058, this.plate, this.body, 0, 0.99, 0, 1, 1, 0.72);
    this.sphere(0.032, this.plate, this.body, 0, 0.99, -0.115, 1.25, 0.72, 0.42);
    this.sphere(0.024, this.trim, this.body, 0, 0.99, -0.13, 1.3, 0.62, 0.3);
  }

  buildTorso() {
    this.torso = new THREE.Group();
    this.torso.position.y = 1.0;
    this.body.add(this.torso);

    // A lathed torso gives a real anatomical taper: narrow at the waist,
    // widest across the ribcage, then sloping into the collar. Scaling Z
    // flattens the body of revolution into an elliptical chest.
    const profile = [
      [0.138, -0.01],
      [0.146, 0.035],
      [0.16, 0.09],
      [0.18, 0.15],
      [0.197, 0.21],
      [0.205, 0.27],
      [0.196, 0.32],
      [0.17, 0.36],
      [0.135, 0.39],
      [0.105, 0.41],
    ].map(([r, y]) => new THREE.Vector2(r, y));
    this.mesh(new THREE.LatheGeometry(profile, 32), this.suit, this.torso, 0, 0, 0, 0, 0, 0, 1, 1, 0.7);

    // smooth chest and abdominal plates over the suit; spheres avoid the hard
    // open edges a half-lathe would leave across the ribs
    this.sphere(0.12, this.plate, this.torso, 0, 0.285, 0.065, 1.35, 1.05, 0.35);
    this.sphere(0.075, this.plate, this.torso, -0.06, 0.29, -0.088, 1.15, 0.95, 0.5);
    this.sphere(0.075, this.plate, this.torso, 0.06, 0.29, -0.088, 1.15, 0.95, 0.5);
    this.sphere(0.095, this.plate, this.torso, 0, 0.17, -0.075, 1.15, 0.8, 0.32);
    this.capsule(0.008, 0.18, this.trim, this.torso, 0, 0.17, -0.105, 0, 0, Math.PI / 2, 1, 1, 0.35);
    this.capsule(0.008, 0.22, this.trim, this.torso, 0, 0.15, 0.108, 0, 0, Math.PI / 2, 1, 1, 0.35);

    // trapezius slopes connect the neck to the deltoids instead of leaving
    // the shoulders as two floating balls
    this.sphere(0.063, this.plate, this.torso, -0.125, 0.355, 0.012, 1.28, 0.42, 0.82);
    this.sphere(0.063, this.plate, this.torso, 0.125, 0.355, 0.012, 1.28, 0.42, 0.82);

    // collar bones, sternum and the spine strips that read from the chase cam
    this.capsule(0.008, 0.13, this.trim, this.torso, -0.078, 0.39, -0.105, 0, 0, Math.PI / 2 - 0.18);
    this.capsule(0.008, 0.13, this.trim, this.torso, 0.078, 0.39, -0.105, 0, 0, -(Math.PI / 2 - 0.18));
    this.sphere(0.018, this.hot, this.torso, 0, 0.29, -0.142, 1, 1, 0.55);
    this.capsule(0.009, 0.26, this.trim, this.torso, 0, 0.25, 0.122);
    this.capsule(0.007, 0.11, this.trim, this.torso, -0.105, 0.32, 0.112, 0, 0, 0.12);
    this.capsule(0.007, 0.11, this.trim, this.torso, 0.105, 0.32, 0.112, 0, 0, -0.12);

    // neck: a tapered column with a sloped collar, not a ring floating around it
    this.capsule(0.055, 0.07, this.suit, this.torso, 0, 0.49, 0.005);
    this.cylinder(0.055, 0.088, 0.07, this.plate, this.torso, 0, 0.45, 0.005, 1, 1, 0.88);
    this.capsule(0.007, 0.08, this.trim, this.torso, 0, 0.455, -0.072, 0, 0, Math.PI / 2, 1, 1, 0.5);

    this.head = new THREE.Group();
    this.head.position.set(0, 0.55, 0);
    this.torso.add(this.head);

    // skull and jaw: tall rather than spherical, narrowing at the chin so the
    // head reads as a head even under the helmet
    this.sphere(0.105, this.suit, this.head, 0, 0.095, 0, 0.9, 1.16, 0.98);
    this.sphere(0.078, this.suit, this.head, 0, 0.018, -0.026, 0.88, 0.72, 0.94);
    this.sphere(0.026, this.plate, this.head, -0.096, 0.075, 0.004, 0.55, 1, 1);
    this.sphere(0.026, this.plate, this.head, 0.096, 0.075, 0.004, 0.55, 1, 1);

    // crown cap and rear half-shell leave the face open below the brow
    this.mesh(
      new THREE.SphereGeometry(0.112, 24, 16, 0, Math.PI * 2, 0, Math.PI * 0.36),
      this.plate, this.head, 0, 0.094, 0.004, 0, 0, 0, 1.0, 1.06, 1.02
    );
    const rearMat = this.plate.clone();
    rearMat.side = THREE.DoubleSide;
    this.mesh(
      new THREE.SphereGeometry(0.108, 24, 16, 0, Math.PI, Math.PI * 0.16, Math.PI * 0.6),
      rearMat, this.head, 0, 0.092, 0.004
    );

    // one narrow wrap-around visor, not two glowing eyes: a dark glass band
    // with a thin cyan rim along its lower edge, leaving the jaw visible
    const visorMat = this.plate.clone();
    visorMat.side = THREE.DoubleSide;
    this.mesh(
      new THREE.CylinderGeometry(0.103, 0.103, 0.032, 24, 1, true, Math.PI / 2, Math.PI),
      visorMat, this.head, 0, 0.094, 0
    );
    const glassMat = this.glass.clone();
    glassMat.side = THREE.DoubleSide;
    this.mesh(
      new THREE.CylinderGeometry(0.105, 0.105, 0.022, 24, 1, true, Math.PI / 2, Math.PI),
      glassMat, this.head, 0, 0.094, 0
    );
    this.mesh(
      new THREE.CylinderGeometry(0.108, 0.107, 0.012, 24, 1, true, Math.PI / 2, Math.PI),
      visorMat, this.head, 0, 0.114, 0
    );

    // a small side light on the helmet, kept out of the face so the visor
    // stays a single dark band instead of a pair of glowing eyes
    this.sphere(0.008, this.trim, this.head, -0.098, 0.1, 0.036, 1, 1, 0.55);

    // rear trim: two strips and a nape line keep the helmet readable
    this.capsule(0.007, 0.13, this.trim, this.head, 0, 0.085, 0.104, 0, 0, 0.04);
    this.capsule(0.006, 0.05, this.trim, this.head, -0.075, 0.15, 0.062, 0, 0, 0.35);
    this.capsule(0.006, 0.05, this.trim, this.head, 0.075, 0.15, 0.062, 0, 0, -0.35);
  }

  buildArms() {
    // Shoulder width across the deltoids is about 0.41 m, a little over two
    // head widths. Each arm is a deltoid + tapered upper arm, then an elbow
    // group with a tapered forearm and a gloved hand.
    this.armL = new THREE.Group();
    this.armL.position.set(-0.205, 1.415, 0);
    this.body.add(this.armL);
    this.armR = new THREE.Group();
    this.armR.position.set(0.205, 1.415, 0);
    this.body.add(this.armR);

    this.elbowL = new THREE.Group();
    this.elbowL.position.y = -0.29;
    this.armL.add(this.elbowL);
    this.elbowR = new THREE.Group();
    this.elbowR.position.y = -0.29;
    this.armR.add(this.elbowR);

    const build = (arm, elbow, side, right) => {
      this.sphere(0.052, this.plate, arm, 0, -0.003, 0, 1.02, 0.9, 1.0);
      this.cylinder(0.046, 0.038, 0.23, this.suit, arm, 0, -0.135, 0, 1, 1, 0.95);
      this.capsule(0.008, 0.08, this.trim, arm, side * 0.038, -0.145, 0.032, 0, 0, side * 0.04);
      this.sphere(0.007, this.hot, arm, side * 0.045, -0.018, -0.039, 1, 1, 0.6);

      this.sphere(0.036, this.suit, elbow, 0, 0, 0, 1, 0.95, 1);
      this.cylinder(0.038, 0.029, 0.18, this.suit, elbow, 0, -0.11, 0, 1, 1, 0.95);
      this.sphere(0.034, this.plate, elbow, 0, -0.085, -0.017, 1.05, 0.82, 0.5);
      this.capsule(0.007, 0.1, this.trim, elbow, side * 0.03, -0.11, 0.024, 0, 0, side * 0.03);

      // glove: palm, thumb and a knuckle plate; small enough to read as a
      // hand at chase distance instead of a mitten
      const hand = this.sphere(0.038, this.suit, elbow, 0, -0.238, -0.008, 1.08, 1.22, 0.8);
      this.sphere(0.019, this.suit, elbow, side * -0.031, -0.228, -0.028, 0.9, 1.3, 0.8);
      this.sphere(0.027, this.plate, elbow, 0, -0.235, -0.03, 1.05, 0.85, 0.45);
      this.capsule(0.006, 0.052, this.trim, elbow, 0, -0.228, 0.029, 0, 0, 0, 1, 1, 0.7);
      if (right) this.handR = hand;
      else this.handL = hand;
    };

    build(this.armL, this.elbowL, -1, false);
    build(this.armR, this.elbowR, 1, true);
  }

  buildGuns() {
    this.guns = WEAPONS.map((def) => {
      const model = buildWeaponModel(def);
      const group = model.group;
      group.visible = false;
      // The gun sits in the right hand at the end of the forearm. The arm is
      // bent at the elbow, so the gun counter-rotates by both arm segments to
      // stay level with the aim line.
      group.position.set(0.005, -0.24, -0.01);
      group.rotation.set(1.38, 0, 0);
      group.scale.setScalar(0.9);
      this.elbowR.add(group);
      return model;
    });
    this.setGun(0);
  }

  setGun(index) {
    const i = Math.max(0, Math.min(this.guns.length - 1, index | 0));
    this.gunIndex = i;
    this.guns.forEach((g, n) => {
      g.group.visible = n === i;
    });
  }

  muzzleFor(index) {
    const gun = this.guns[index | 0];
    return gun ? gun.muzzle : null;
  }

  triggerFlash() {
    const gun = this.guns[this.gunIndex];
    if (!gun) return;
    this.flashTimer = 0.06;
    gun.flashSprite.visible = true;
    gun.flashSprite.material.rotation = Math.random() * Math.PI * 2;
    gun.flashSprite.material.opacity = 1;
    gun.flashLight.intensity = 300;
  }

  // Two-bone IK: place the left hand on the rifle's foregrip. The elbow is
  // pushed down and away from the chest by a pole vector, which keeps the pose
  // anatomical instead of collapsing the arm across the body.
  supportGun() {
    const gun = this.guns[this.gunIndex];
    if (!gun || !this.handL) return;

    const grip = new THREE.Vector3();
    const muzzle = new THREE.Vector3();
    gun.group.getWorldPosition(grip);
    gun.muzzle.getWorldPosition(muzzle);
    const targetWorld = grip.lerp(muzzle, 0.13);
    const target = this.body.worldToLocal(targetWorld.clone());

    const L1 = 0.29;
    const L2 = 0.238;
    const shoulder = this.armL.position;
    const v = target.sub(shoulder);
    const D = Math.min(L1 + L2 - 0.003, Math.max(0.06, v.length()));
    const dir = v.normalize();

    const cosA = (L1 * L1 + D * D - L2 * L2) / (2 * L1 * D);
    const alpha = Math.acos(Math.max(-1, Math.min(1, cosA)));
    const pole = new THREE.Vector3(-0.2, -1, 0.23).normalize();
    const perp = pole.addScaledVector(dir, -pole.dot(dir));
    if (perp.lengthSq() < 1e-5) perp.set(0, -1, 0);
    perp.normalize();
    const upper = dir.clone().multiplyScalar(Math.cos(alpha)).addScaledVector(perp, Math.sin(alpha)).normalize();

    const bendDir = dir.clone().addScaledVector(upper, -dir.dot(upper));
    if (bendDir.lengthSq() < 1e-4) bendDir.copy(perp);
    bendDir.normalize();

    // local +Y points up the upper arm, local -Y is the limb direction; the
    // elbow hinge is local X and local +Z is the bend plane
    const yAxis = upper.clone().negate();
    const xAxis = new THREE.Vector3().crossVectors(yAxis, bendDir).normalize();
    const zAxis = new THREE.Vector3().crossVectors(xAxis, yAxis).normalize();
    const basis = new THREE.Matrix4().makeBasis(xAxis, yAxis, zAxis);
    this.armL.quaternion.setFromRotationMatrix(basis);

    const cosE = (L1 * L1 + L2 * L2 - D * D) / (2 * L1 * L2);
    const bend = Math.PI - Math.acos(Math.max(-1, Math.min(1, cosE)));
    this.elbowL.rotation.set(-bend, 0, 0);
  }

  update(dt, visible) {
    const p = this.player;
    const show = !!visible && p.thirdPerson && !p.dead;
    this.root.visible = show;
    if (!show) return;

    this.root.position.set(p.pos.x, p.pos.y, p.pos.z);
    this.root.rotation.y = p.yaw;
    if (this.weapons && this.weapons.weaponIndex) {
      const active = this.weapons.weaponIndex();
      if (active !== this.gunIndex && this.guns[active]) this.setGun(active);
    }

    const speed = p.horizSpeed();
    const run = Math.min(1.35, speed / 10.5);
    const moving = speed > 0.6;
    const phaseRate = moving ? 4.5 + speed * 0.6 : 1.2;
    this.phase += dt * phaseRate;
    const gait = Math.sin(this.phase);
    const swing = gait * 0.78 * run;
    const slide = p.sliding;
    const air = !p.onGround;

    // reset every joint each frame; poses then only state what they change,
    // and no state leaks from a slide back into a run
    this.body.position.y = 0;
    this.torso.position.y = 1.0;
    this.torso.rotation.set(0.02, 0, 0);
    this.head.rotation.set(0, 0, 0);
    this.legL.rotation.set(0, 0, 0);
    this.legR.rotation.set(0, 0, 0);
    this.kneeL.rotation.set(-0.03, 0, 0);
    this.kneeR.rotation.set(-0.03, 0, 0);
    this.footL.rotation.set(-0.02, 0, 0);
    this.footR.rotation.set(-0.02, 0, 0);
    // Right arm hangs close to the body and bends at the elbow to bring the
    // rifle up in front of the chest. Keeping the upper arm vertical instead
    // of swinging the whole arm forward is what makes the hold look human.
    this.armR.rotation.set(0.2 - p.pitch * 0.22, 0, 0.05);
    this.elbowR.rotation.set(1.9 + p.pitch * 0.15, 0, 0.02);

    if (slide) {
      // feet forward, hips low, chest leaning back to counterbalance
      this.body.position.y = -0.34;
      this.legL.rotation.x = 1.18;
      this.legR.rotation.x = 0.92;
      this.kneeL.rotation.x = -0.62;
      this.kneeR.rotation.x = -0.86;
      this.footL.rotation.x = -0.45;
      this.footR.rotation.x = -0.28;
      this.torso.rotation.x = 0.24;
      this.torso.rotation.y = 0.04;
      this.armR.rotation.set(0.4 - p.pitch * 0.18, 0, 0.06);
      this.elbowR.rotation.x = 1.5 + p.pitch * 0.1;
      this.head.rotation.x = -0.16;
    } else if (air) {
      // front knee drives up, trailing leg extends
      this.legL.rotation.x = 0.62 + gait * 0.08;
      this.legR.rotation.x = -0.34 - gait * 0.08;
      this.kneeL.rotation.x = -0.92;
      this.kneeR.rotation.x = -0.46;
      this.footL.rotation.x = -0.2;
      this.footR.rotation.x = -0.1;
      this.torso.rotation.x = 0.06;
      this.armR.rotation.set(0.14 - p.pitch * 0.2, 0, 0.05);
      this.elbowR.rotation.x = 1.82 + p.pitch * 0.12;
      this.head.rotation.x = -0.06;
    } else if (moving) {
      // Contralateral run: each knee bends only while its leg travels behind
      // the body, which is what makes the cycle read as running.
      this.body.position.y = Math.abs(gait) * 0.026 * run;
      this.legL.rotation.x = swing;
      this.legR.rotation.x = -swing;
      this.kneeL.rotation.x = -Math.max(0, -swing) * 1.45 - 0.06;
      this.kneeR.rotation.x = -Math.max(0, swing) * 1.45 - 0.06;
      this.footL.rotation.x = -0.02 - this.legL.rotation.x * 0.28;
      this.footR.rotation.x = -0.02 - this.legR.rotation.x * 0.28;
      this.torso.rotation.x = 0.05 + run * 0.09;
      this.torso.rotation.y = gait * 0.06 * run;
      this.armR.rotation.set(0.2 - p.pitch * 0.22 + Math.sin(this.phase * 2) * 0.01, 0, 0.05);
      this.elbowR.rotation.x = 1.88 + p.pitch * 0.15;
      this.head.rotation.x = -0.05 - p.pitch * 0.3;
      this.head.rotation.y = -gait * 0.035 * run;
    } else {
      // idle: a slow breath and a little weight shift, still holding the gun
      const breath = Math.sin(this.phase * 0.9);
      this.body.position.y = breath * 0.004;
      this.torso.rotation.x = 0.02 + breath * 0.008;
      this.torso.rotation.y = breath * 0.012;
      this.armR.rotation.set(0.2 - p.pitch * 0.22 + breath * 0.006, 0, 0.05);
      this.elbowR.rotation.x = 1.9 + p.pitch * 0.15;
      this.head.rotation.x = -0.04 - p.pitch * 0.3;
      this.head.rotation.y = -breath * 0.02;
    }

    // Keep the gun level with the aim line while the arm and elbow move. The
    // muzzle is the tracer source, so this also keeps shots starting at the
    // barrel instead of at the camera.
    const gun = this.guns[this.gunIndex];
    if (gun) {
      gun.group.rotation.x = p.pitch * 0.55 - this.armR.rotation.x - this.elbowR.rotation.x;
      this.supportGun();
      if (this.flashTimer > 0) {
        this.flashTimer -= dt;
        const k = Math.max(0, this.flashTimer / 0.06);
        gun.flashSprite.material.opacity = k;
        gun.flashSprite.visible = k > 0;
        gun.flashSprite.scale.setScalar(0.5 + (1 - k) * 0.5);
        gun.flashLight.intensity = k * 300;
        if (this.flashTimer <= 0) gun.flashLight.intensity = 0;
      }
    }
  }
}
