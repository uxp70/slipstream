import * as THREE from 'three';
import { buildWeaponModel } from './weaponModels.js';
import { WEAPONS } from './weapon.js';

// The third-person body. It is only built once and hidden in first person, so
// switching view costs a visibility flag rather than a scene rebuild.
//
// The model is deliberately readable at arena distance: dark suit, bright
// shoulder/chest/knee trim, a visor, and the gun carried out in front where the
// muzzle flash and tracer origin are easy to find. Limbs are separate groups so
// the run cycle, slide and air pose can be posed from the player's real speed
// and state instead of a canned animation clip.
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
      color: 0x16222f,
      roughness: 0.62,
      metalness: 0.3,
      emissive: 0x050b12,
      emissiveIntensity: 1,
    });
    this.plate = new THREE.MeshStandardMaterial({
      color: 0x2c4055,
      roughness: 0.48,
      metalness: 0.45,
      emissive: 0x0a1a26,
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

  box(w, h, d, mat, x, y, z, parent = this.body) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    mesh.position.set(x, y, z);
    mesh.frustumCulled = false;
    parent.add(mesh);
    return mesh;
  }

  buildLegs() {
    this.legL = new THREE.Group();
    this.legL.position.set(-0.145, 0.92, 0);
    this.body.add(this.legL);
    this.legR = new THREE.Group();
    this.legR.position.set(0.145, 0.92, 0);
    this.body.add(this.legR);

    for (const [leg, side] of [
      [this.legL, -1],
      [this.legR, 1],
    ]) {
      this.box(0.175, 0.72, 0.2, this.suit, 0, -0.36, 0, leg);
      this.box(0.185, 0.085, 0.21, this.suit, 0, -0.055, 0, leg);
      this.box(0.2, 0.13, 0.3, this.plate, 0, -0.76, -0.05, leg);
      // knee light: a bright dot at the joint is what makes the run read
      this.box(0.06, 0.05, 0.02, this.trim, 0, -0.44, -0.112, leg);
      // the camera lives behind the player, so each limb also carries a rear
      // strip; without these the body is a black silhouette at arena distance
      this.box(0.03, 0.16, 0.015, this.trim, 0, -0.3, 0.106, leg);
      // hip plate, offset outward so the legs read as separate volumes
      this.box(0.06, 0.18, 0.18, this.plate, side * 0.1, -0.1, 0, leg);
    }
  }

  buildTorso() {
    this.torso = new THREE.Group();
    this.torso.position.y = 0.92;
    this.body.add(this.torso);

    this.box(0.46, 0.5, 0.28, this.suit, 0, 0.3, 0, this.torso);
    this.box(0.48, 0.24, 0.31, this.plate, 0, 0.43, 0, this.torso);
    this.box(0.3, 0.08, 0.05, this.trim, 0, 0.46, -0.16, this.torso);
    this.box(0.06, 0.2, 0.04, this.hot, 0, 0.29, -0.155, this.torso);
    this.box(0.3, 0.26, 0.16, this.plate, 0, 0.36, 0.19, this.torso);
    this.box(0.16, 0.04, 0.02, this.trim, 0, 0.48, 0.276, this.torso);
    this.box(0.24, 0.035, 0.015, this.trim, 0, 0.54, 0.158, this.torso);
    // belt + thigh holster read at a glance from behind
    this.box(0.48, 0.08, 0.3, this.plate, 0, 0.04, 0, this.torso);
    this.box(0.12, 0.04, 0.02, this.trim, 0, 0.04, -0.152, this.torso);

    this.head = new THREE.Group();
    // local to the torso group (which is already at hip height), so this is
    // the collar joint, not the top of the body
    this.head.position.y = 0.56;
    this.torso.add(this.head);
    this.box(0.28, 0.26, 0.26, this.suit, 0, 0.13, 0, this.head);
    this.box(0.3, 0.08, 0.28, this.plate, 0, 0.27, 0, this.head);
    this.box(0.22, 0.07, 0.02, this.visor, 0, 0.14, -0.135, this.head);
    this.box(0.14, 0.025, 0.015, this.trim, 0, 0.19, 0.135, this.head);
    // antenna
    this.box(0.02, 0.14, 0.02, this.trim, 0.1, 0.36, 0.02, this.head);
  }

  buildArms() {
    this.armL = new THREE.Group();
    this.armL.position.set(-0.3, 1.42, 0);
    this.body.add(this.armL);
    this.box(0.13, 0.42, 0.16, this.suit, 0, -0.22, 0, this.armL);
    this.box(0.14, 0.14, 0.17, this.plate, 0, -0.46, -0.02, this.armL);
    this.box(0.2, 0.12, 0.22, this.plate, 0, 0.02, 0, this.armL);
    this.box(0.06, 0.03, 0.02, this.trim, 0, 0.02, -0.114, this.armL);
    this.box(0.02, 0.16, 0.015, this.trim, -0.01, -0.24, 0.083, this.armL);
    this.box(0.02, 0.03, 0.12, this.trim, -0.098, 0.02, 0, this.armL);

    this.armR = new THREE.Group();
    this.armR.position.set(0.3, 1.42, 0);
    this.body.add(this.armR);
    this.box(0.13, 0.42, 0.16, this.suit, 0, -0.22, 0, this.armR);
    this.box(0.14, 0.14, 0.17, this.plate, 0, -0.46, -0.02, this.armR);
    this.box(0.2, 0.12, 0.22, this.plate, 0, 0.02, 0, this.armR);
    this.box(0.06, 0.03, 0.02, this.trim, 0, 0.02, -0.114, this.armR);
    this.box(0.02, 0.16, 0.015, this.trim, 0.01, -0.24, 0.083, this.armR);
    this.box(0.02, 0.03, 0.12, this.trim, 0.098, 0.02, 0, this.armR);
  }

  buildGuns() {
    this.guns = WEAPONS.map((def) => {
      const model = buildWeaponModel(def);
      const group = model.group;
      group.visible = false;
      group.position.set(0.01, -0.49, 0.02);
      // the arm rotates forward, so the gun counter-rotates to point down -Z
      group.rotation.set(1.38, 0, 0);
      group.scale.setScalar(0.9);
      this.armR.add(group);
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
    const swing = Math.sin(this.phase) * 0.85 * run;
    const slide = p.sliding;
    const air = !p.onGround;

    if (slide) {
      // feet forward, body low: the slide should read as a pose, not a squat
      this.body.position.y = -0.4;
      this.legL.rotation.x = -1.25;
      this.legR.rotation.x = -0.95;
      this.legL.rotation.z = 0.08;
      this.legR.rotation.z = -0.08;
      this.torso.rotation.x = 0.4;
      this.armL.rotation.x = 0.5;
      this.armR.rotation.x = -1.15;
      this.head.rotation.x = -0.25;
    } else if (air) {
      this.body.position.y = 0;
      this.legL.rotation.x = -0.55 + Math.sin(this.phase) * 0.1;
      this.legR.rotation.x = 0.4 - Math.sin(this.phase) * 0.1;
      this.legL.rotation.z = 0;
      this.legR.rotation.z = 0;
      this.torso.rotation.x = 0.08;
      this.armL.rotation.x = -0.35;
      this.armR.rotation.x = -1.25;
      this.head.rotation.x = -0.08;
    } else {
      this.body.position.y = moving ? Math.abs(Math.sin(this.phase)) * 0.035 * run : 0;
      this.legL.rotation.x = swing;
      this.legR.rotation.x = -swing;
      this.legL.rotation.z = 0;
      this.legR.rotation.z = 0;
      this.torso.rotation.x = 0.05 + run * 0.11;
      this.armL.rotation.x = -swing * 0.75 - 0.15;
      this.armR.rotation.x = -1.38 - p.pitch * 0.55 + Math.sin(this.phase * 2) * 0.015;
      this.head.rotation.x = -0.04 - p.pitch * 0.3;
    }

    // keep the carried gun level with the aim line, not with the arm swing
    const gun = this.guns[this.gunIndex];
    if (gun) {
      gun.group.rotation.x = 1.38 + p.pitch * 0.55;
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
