import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

// Procedural weapon family. Each gun has its own silhouette, but they share a
// visual language: rounded receivers, tapered barrels, real muzzle devices,
// optical sights, skeleton stocks, and small mechanical details. The silhouette
// still has to read at a glance in a dark arena:
//
//   rifle    slim, optical, skeleton stock
//   shotgun  fat twin-tube pump, brass shell rail
//   lance    long rail barrel, coil rings, big scope
//   havoc    thick launcher tube, side drum, venturi exhaust
//
// Static parts are merged per material, so a whole gun stays at four draw calls
// plus its animated magazine/shell carrier. The four material names (`body`,
// `dark`, `glow`, `accent`) are the hooks the crate skins repaint.

export function buildWeaponModel(def) {
  const group = new THREE.Group();

  const bodyMat = new THREE.MeshStandardMaterial({
    name: 'body',
    color: 0x2a3a52,
    roughness: 0.34,
    metalness: 0.68,
    emissive: 0x0d2436,
    emissiveIntensity: 0.85,
  });
  const darkMat = new THREE.MeshStandardMaterial({
    name: 'dark',
    color: 0x111a28,
    roughness: 0.56,
    metalness: 0.42,
    emissive: 0x081420,
    emissiveIntensity: 0.55,
  });
  const glowMat = new THREE.MeshBasicMaterial({ name: 'glow', color: def.color });
  const accentMat = new THREE.MeshBasicMaterial({ name: 'accent', color: 0xffb347 });
  // Optics keep their own dark blue glass at every rarity. It is deliberately
  // outside the skin slots, so a whiteout finish still has a readable lens.
  const lensMat = new THREE.MeshStandardMaterial({
    name: 'lens',
    color: 0x07131c,
    roughness: 0.08,
    metalness: 0.9,
    emissive: 0x061b28,
    emissiveIntensity: 1.4,
  });

  const parts = [];
  const add = (geo, mat, x, y, z, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1) => {
    if (sx !== 1 || sy !== 1 || sz !== 1) geo.scale(sx, sy, sz);
    geo.applyMatrix4(
      new THREE.Matrix4().compose(
        new THREE.Vector3(x, y, z),
        new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)),
        new THREE.Vector3(1, 1, 1)
      )
    );
    // Normalise index/attribute layout so boxes, cylinders, tori and lathes can
    // share one merged buffer per material.
    if (geo.index) {
      const nonIndexed = geo.toNonIndexed();
      geo.dispose();
      geo = nonIndexed;
    }
    geo.deleteAttribute('uv');
    geo.deleteAttribute('uv1');
    geo.clearGroups();
    parts.push({ geo, mat });
  };

  const rbox = (w, h, d, r = 0.012) =>
    new RoundedBoxGeometry(w, h, d, 2, Math.min(r, Math.min(w, h, d) * 0.48));
  const box = (w, h, d) => new THREE.BoxGeometry(w, h, d);
  // +Y of a cylinder is the muzzle end after this rotation.
  const cylZ = (rFront, rRear, len, seg = 18) =>
    new THREE.CylinderGeometry(rFront, rRear, len, seg, 1, false);
  const cylX = (rFront, rRear, len, seg = 18) =>
    new THREE.CylinderGeometry(rFront, rRear, len, seg, 1, false);
  const ring = (radius, tube, seg = 24) => new THREE.TorusGeometry(radius, tube, 6, seg);
  const disc = (radius, seg = 20) => new THREE.CircleGeometry(radius, seg);

  const addCylZ = (rFront, rRear, len, mat, x, y, z, seg = 18) =>
    add(cylZ(rFront, rRear, len, seg), mat, x, y, z, -Math.PI / 2);
  const addCylX = (rFront, rRear, len, mat, x, y, z, seg = 18) =>
    add(cylX(rFront, rRear, len, seg), mat, x, y, z, 0, 0, Math.PI / 2);
  const addRing = (radius, tube, mat, x, y, z, ry = 0, rx = 0, seg = 24) =>
    add(ring(radius, tube, seg), mat, x, y, z, rx, ry);

  let magMesh = null;
  let muzzleZ = -0.84;
  let muzzleY = 0.1;

  // ------------------------------------------------------------------ rifle
  if (def.id === 'rifle') {
    // receiver and top rail
    add(rbox(0.15, 0.14, 0.48, 0.02), bodyMat, 0, 0.055, -0.06);
    add(rbox(0.135, 0.05, 0.46, 0.012), darkMat, 0, 0.145, -0.08);
    for (let i = 0; i < 9; i++) {
      add(box(0.145, 0.008, 0.013), darkMat, 0, 0.176, -0.27 + i * 0.052);
    }
    add(box(0.079, 0.052, 0.135), darkMat, 0.078, 0.10, -0.06);
    add(box(0.006, 0.036, 0.11), accentMat, 0.081, 0.10, -0.06);

    // handguard with M-LOK style slots and a tapered front cap
    add(rbox(0.125, 0.115, 0.30, 0.024), bodyMat, 0, 0.10, -0.43);
    add(rbox(0.10, 0.036, 0.31, 0.01), darkMat, 0, 0.168, -0.43);
    for (let i = 0; i < 4; i++) {
      const z = -0.40 - i * 0.062;
      add(box(0.008, 0.042, 0.036), darkMat, -0.061, 0.10, z);
      add(box(0.008, 0.042, 0.036), darkMat, 0.061, 0.10, z);
      add(box(0.006, 0.009, 0.031), accentMat, -0.063, 0.078, z);
      add(box(0.006, 0.009, 0.031), accentMat, 0.063, 0.078, z);
    }
    add(rbox(0.135, 0.128, 0.04, 0.012), darkMat, 0, 0.10, -0.59);
    add(rbox(0.055, 0.026, 0.13, 0.008), darkMat, 0, 0.038, -0.47, -0.18);
    add(box(0.018, 0.012, 0.11), accentMat, 0, 0.058, -0.47, -0.18);

    // barrel, gas block and ported brake
    addCylZ(0.022, 0.024, 0.30, darkMat, 0, 0.112, -0.72, 14);
    add(rbox(0.065, 0.077, 0.07, 0.012), darkMat, 0, 0.112, -0.58);
    addCylZ(0.034, 0.028, 0.11, bodyMat, 0, 0.112, -0.86, 14);
    for (let i = 0; i < 3; i++) {
      add(box(0.052, 0.012, 0.014), darkMat, 0, 0.135, -0.84 - i * 0.027);
      add(box(0.052, 0.012, 0.014), darkMat, 0, 0.089, -0.84 - i * 0.027);
    }
    addRing(0.035, 0.006, accentMat, 0, 0.112, -0.92);
    addCylZ(0.021, 0.021, 0.035, darkMat, 0, 0.112, -0.932, 12);
    muzzleZ = -0.952;
    muzzleY = 0.112;

    // skeleton stock, rubber pad and adjustable cheek rest
    addCylZ(0.032, 0.032, 0.18, darkMat, 0, 0.075, 0.25, 12);
    add(rbox(0.074, 0.16, 0.055, 0.018), bodyMat, 0, 0.035, 0.39);
    add(rbox(0.086, 0.172, 0.026, 0.01), darkMat, 0, 0.03, 0.423);
    add(rbox(0.065, 0.034, 0.17, 0.012), darkMat, 0, 0.142, 0.29);
    add(rbox(0.062, 0.06, 0.075, 0.014), bodyMat, 0, 0.025, 0.285, 0.12);
    add(box(0.012, 0.095, 0.012), darkMat, -0.026, 0.02, 0.36);
    add(box(0.012, 0.095, 0.012), darkMat, 0.026, 0.02, 0.36);
    addRing(0.026, 0.005, darkMat, 0, -0.035, 0.385, Math.PI / 2);
    add(box(0.008, 0.008, 0.14), accentMat, 0, 0.164, 0.30);

    // pistol grip and trigger guard
    add(rbox(0.068, 0.185, 0.095, 0.022), darkMat, 0, -0.075, 0.075, -0.32);
    add(rbox(0.057, 0.045, 0.06, 0.014), bodyMat, 0, -0.158, 0.105, -0.32);
    add(box(0.062, 0.007, 0.012), accentMat, 0, -0.03, 0.031);
    add(box(0.008, 0.055, 0.10), darkMat, 0, -0.055, -0.005);
    add(box(0.009, 0.01, 0.10), darkMat, 0, -0.083, -0.005);
    add(box(0.009, 0.01, 0.06), darkMat, 0, -0.083, 0.045);
    add(box(0.012, 0.035, 0.008), accentMat, 0, -0.048, 0.008, 0.3);

    // low optical sight with a real lens and protective hood
    add(rbox(0.072, 0.022, 0.13, 0.006), darkMat, 0, 0.185, -0.04);
    addCylZ(0.038, 0.038, 0.13, darkMat, 0, 0.238, -0.06, 16);
    addCylZ(0.048, 0.041, 0.055, bodyMat, 0, 0.238, -0.145, 16);
    addCylZ(0.037, 0.037, 0.035, darkMat, 0, 0.238, 0.005, 16);
    add(disc(0.034, 20), lensMat, 0, 0.238, -0.174);
    addRing(0.046, 0.005, accentMat, 0, 0.238, -0.172);
    add(rbox(0.012, 0.045, 0.02, 0.004), darkMat, -0.035, 0.207, -0.10);
    add(rbox(0.012, 0.045, 0.02, 0.004), darkMat, 0.035, 0.207, -0.10);
    add(box(0.009, 0.014, 0.009), accentMat, 0.044, 0.242, -0.02);

    // slim curved magazine, three segments and an accent floor plate
    const mag = new THREE.Group();
    mag.position.set(0, -0.095, -0.045);
    const seg = (w, h, d, x, y, z, rx) => {
      const m = new THREE.Mesh(rbox(w, h, d, 0.014), bodyMat);
      m.position.set(x, y, z);
      m.rotation.x = rx;
      m.frustumCulled = false;
      mag.add(m);
    };
    seg(0.072, 0.11, 0.11, 0, -0.035, 0.012, 0.12);
    seg(0.068, 0.10, 0.105, 0, -0.12, 0.035, 0.22);
    seg(0.062, 0.06, 0.10, 0, -0.182, 0.066, 0.3);
    const magBase = new THREE.Mesh(box(0.078, 0.018, 0.11), accentMat);
    magBase.position.set(0, -0.212, 0.085);
    magBase.rotation.x = 0.3;
    magBase.frustumCulled = false;
    mag.add(magBase);
    group.add(mag);
    magMesh = mag;

    add(box(0.006, 0.018, 0.12), glowMat, -0.077, 0.085, -0.19);
    add(box(0.006, 0.018, 0.12), glowMat, 0.077, 0.085, -0.19);
    add(box(0.012, 0.012, 0.16), glowMat, 0, 0.145, 0.20);
  }

  // ---------------------------------------------------------------- shotgun
  else if (def.id === 'breach') {
    // fat receiver with a shell deflector and a side loading gate
    add(rbox(0.205, 0.175, 0.38, 0.028), bodyMat, 0, 0.055, -0.035);
    add(rbox(0.18, 0.06, 0.30, 0.016), darkMat, 0, 0.16, -0.055);
    add(rbox(0.045, 0.09, 0.15, 0.014), darkMat, 0.105, 0.07, -0.045);
    add(box(0.008, 0.055, 0.11), accentMat, 0.109, 0.06, -0.045);
    add(rbox(0.055, 0.032, 0.12, 0.008), darkMat, 0, 0.045, 0.15);
    add(box(0.045, 0.012, 0.012), accentMat, 0, 0.185, 0.038);

    // heavy barrel, ventilated heat shield and under-barrel magazine tube
    addCylZ(0.039, 0.043, 0.62, darkMat, 0, 0.112, -0.49, 18);
    addCylZ(0.058, 0.058, 0.32, bodyMat, 0, 0.112, -0.38, 18);
    for (let i = 0; i < 5; i++) {
      addRing(0.057, 0.009, darkMat, 0, 0.112, -0.26 - i * 0.055);
    }
    for (let i = 0; i < 4; i++) {
      const z = -0.29 - i * 0.055;
      add(box(0.018, 0.05, 0.028), darkMat, -0.056, 0.11, z);
      add(box(0.018, 0.05, 0.028), darkMat, 0.056, 0.11, z);
    }
    addCylZ(0.031, 0.031, 0.50, bodyMat, 0, 0.012, -0.49, 14);
    addCylZ(0.04, 0.033, 0.05, accentMat, 0, 0.012, -0.74, 14);
    addRing(0.038, 0.005, glowMat, 0, 0.012, -0.765);
    addCylZ(0.023, 0.023, 0.022, darkMat, 0, 0.012, -0.78, 12);

    // A wide, near-black pump is the shotgun's strongest silhouette cue: it
    // sits proud of the barrel and reads separately from the receiver even when
    // both are painted the same event colour.
    add(rbox(0.175, 0.155, 0.24, 0.034), darkMat, 0, 0.055, -0.54);
    add(rbox(0.17, 0.036, 0.05, 0.012), bodyMat, 0, 0.055, -0.66);
    add(rbox(0.12, 0.05, 0.08, 0.014), bodyMat, 0, 0.03, -0.42);
    for (let i = 0; i < 5; i++) {
      add(box(0.014, 0.142, 0.02), darkMat, -0.07 + i * 0.035, 0.055, -0.49);
      add(box(0.014, 0.142, 0.02), darkMat, -0.07 + i * 0.035, 0.055, -0.59);
    }
    add(box(0.15, 0.009, 0.02), accentMat, 0, 0.135, -0.54);
    add(box(0.15, 0.01, 0.018), glowMat, 0, -0.02, -0.54);
    add(box(0.018, 0.075, 0.15), accentMat, -0.088, 0.02, -0.54);
    add(box(0.018, 0.075, 0.15), accentMat, 0.088, 0.02, -0.54);

    // ported breacher choke with a toothed crown
    addCylZ(0.061, 0.051, 0.12, bodyMat, 0, 0.112, -0.84, 18);
    for (let i = 0; i < 3; i++) {
      add(box(0.102, 0.019, 0.02), darkMat, 0, 0.112, -0.805 - i * 0.025);
    }
    addCylZ(0.045, 0.045, 0.03, darkMat, 0, 0.112, -0.91, 16);
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      add(box(0.012, 0.02, 0.035), accentMat, Math.cos(a) * 0.045, 0.112 + Math.sin(a) * 0.045, -0.925, 0, 0, a);
    }
    muzzleZ = -0.945;
    muzzleY = 0.112;

    // stock with a thick recoil pad and a moulded cheek weld
    add(rbox(0.12, 0.15, 0.27, 0.03), bodyMat, 0, 0.02, 0.27);
    add(rbox(0.135, 0.185, 0.055, 0.018), darkMat, 0, 0.005, 0.415);
    add(rbox(0.105, 0.045, 0.16, 0.014), darkMat, 0, 0.115, 0.24);
    add(box(0.17, 0.012, 0.085), accentMat, 0, 0.128, 0.30);
    add(box(0.02, 0.08, 0.16), darkMat, -0.065, 0.03, 0.27);
    add(box(0.02, 0.08, 0.16), darkMat, 0.065, 0.03, 0.27);

    // pistol grip, guard and a wide trigger
    add(rbox(0.075, 0.19, 0.10, 0.024), darkMat, 0, -0.08, 0.085, -0.26);
    add(rbox(0.07, 0.05, 0.07, 0.014), bodyMat, 0, -0.17, 0.11, -0.26);
    add(box(0.075, 0.008, 0.013), accentMat, 0, -0.035, 0.037);
    add(box(0.008, 0.05, 0.105), darkMat, 0, -0.065, -0.005);
    add(box(0.009, 0.011, 0.115), darkMat, 0, -0.09, 0.0);
    add(box(0.012, 0.04, 0.012), accentMat, 0, -0.055, 0.02, 0.2);

    // ghost-ring rear sight and a bright front bead
    addRing(0.029, 0.006, darkMat, 0, 0.215, 0.01);
    addRing(0.017, 0.004, glowMat, 0, 0.215, 0.01);
    add(rbox(0.018, 0.035, 0.02, 0.005), darkMat, 0, 0.19, 0.085);
    add(rbox(0.012, 0.028, 0.018, 0.004), darkMat, 0, 0.19, -0.02);
    add(box(0.012, 0.018, 0.012), glowMat, 0, 0.205, -0.69);

    // loaded shells on the left side; this carrier lifts away during reload
    const shells = new THREE.Group();
    shells.position.set(-0.118, 0.055, 0.01);
    for (let i = 0; i < 4; i++) {
      const shell = new THREE.Mesh(cylX(0.02, 0.02, 0.075, 12), accentMat);
      shell.rotation.z = Math.PI / 2;
      shell.position.set(0, 0.045 - i * 0.032, -0.05 + i * 0.012);
      shell.frustumCulled = false;
      shells.add(shell);
      const brass = new THREE.Mesh(cylX(0.021, 0.021, 0.018, 12), glowMat);
      brass.rotation.z = Math.PI / 2;
      brass.position.set(-0.036, 0.045 - i * 0.032, -0.05 + i * 0.012);
      brass.frustumCulled = false;
      shells.add(brass);
    }
    add(rbox(0.022, 0.15, 0.21, 0.008), darkMat, -0.118, 0.055, -0.02);
    group.add(shells);
    magMesh = shells;

    add(box(0.008, 0.025, 0.14), glowMat, -0.104, 0.085, -0.18);
    add(box(0.008, 0.025, 0.14), glowMat, 0.104, 0.085, -0.18);
  }

  // ------------------------------------------------------------------ lance
  else if (def.id === 'lance') {
    // slim receiver, heat-sink spine and side charge canister
    add(rbox(0.14, 0.15, 0.46, 0.022), bodyMat, 0, 0.055, -0.02);
    add(rbox(0.105, 0.055, 0.40, 0.014), darkMat, 0, 0.16, 0.0);
    for (let i = 0; i < 6; i++) {
      add(box(0.125, 0.035, 0.012), darkMat, 0, 0.172, 0.13 - i * 0.035);
    }
    add(rbox(0.042, 0.115, 0.20, 0.012), darkMat, 0.10, 0.045, 0.02);
    addCylZ(0.028, 0.028, 0.15, bodyMat, 0.125, 0.045, 0.02, 12);
    addRing(0.03, 0.007, glowMat, 0.125, 0.045, -0.055);
    addRing(0.03, 0.007, accentMat, 0.125, 0.045, 0.095);

    // long accelerator rails and the exposed coil section
    addCylZ(0.03, 0.034, 0.98, darkMat, 0, 0.105, -0.62, 16);
    add(rbox(0.028, 0.065, 0.76, 0.007), bodyMat, -0.056, 0.10, -0.51);
    add(rbox(0.028, 0.065, 0.76, 0.007), bodyMat, 0.056, 0.10, -0.51);
    add(box(0.012, 0.012, 0.82), glowMat, 0, 0.148, -0.49);
    for (let i = 0; i < 6; i++) {
      addRing(0.076, 0.011, glowMat, 0, 0.105, -0.31 - i * 0.125, 0, 0, 32);
      addRing(0.084, 0.007, darkMat, 0, 0.105, -0.31 - i * 0.125, 0, 0, 32);
    }
    add(rbox(0.16, 0.05, 0.28, 0.014), bodyMat, 0, 0.17, -0.25);
    add(rbox(0.135, 0.04, 0.10, 0.01), darkMat, 0, 0.203, -0.20);
    add(box(0.10, 0.008, 0.045), accentMat, 0, 0.17, -0.36);
    add(box(0.012, 0.016, 0.14), glowMat, -0.071, 0.12, -0.30);
    add(box(0.012, 0.016, 0.14), glowMat, 0.071, 0.12, -0.30);

    // Open accelerator muzzle: a dark collar, two body-colour prongs and a
    // recessed glowing emitter, so the tip doesn't read as a bright solid block.
    addCylZ(0.052, 0.047, 0.06, darkMat, 0, 0.105, -1.115, 20);
    addRing(0.047, 0.009, accentMat, 0, 0.105, -1.147);
    addCylZ(0.036, 0.04, 0.09, bodyMat, 0, 0.105, -1.17, 18);
    add(rbox(0.022, 0.06, 0.16, 0.006), bodyMat, -0.054, 0.105, -1.22);
    add(rbox(0.022, 0.06, 0.16, 0.006), bodyMat, 0.054, 0.105, -1.22);
    add(box(0.007, 0.045, 0.14), glowMat, -0.066, 0.105, -1.22);
    add(box(0.007, 0.045, 0.14), glowMat, 0.066, 0.105, -1.22);
    add(box(0.02, 0.014, 0.035), accentMat, -0.054, 0.105, -1.30);
    add(box(0.02, 0.014, 0.035), accentMat, 0.054, 0.105, -1.30);
    addCylZ(0.023, 0.028, 0.07, darkMat, 0, 0.105, -1.265, 16);
    add(disc(0.021, 16), lensMat, 0, 0.105, -1.302);
    addRing(0.03, 0.005, glowMat, 0, 0.105, -1.30);
    muzzleZ = -1.32;
    muzzleY = 0.105;

    // precision stock: buffer, skeletal frame, adjustable cheek piece
    addCylZ(0.035, 0.035, 0.18, darkMat, 0, 0.09, 0.27, 12);
    add(rbox(0.07, 0.18, 0.06, 0.018), bodyMat, 0, 0.045, 0.42);
    add(rbox(0.085, 0.19, 0.028, 0.01), darkMat, 0, 0.04, 0.455);
    add(rbox(0.075, 0.05, 0.20, 0.014), darkMat, 0, 0.16, 0.31);
    add(rbox(0.055, 0.09, 0.07, 0.012), bodyMat, 0, 0.035, 0.31);
    add(box(0.014, 0.12, 0.016), darkMat, -0.025, 0.04, 0.385);
    add(box(0.014, 0.12, 0.016), darkMat, 0.025, 0.04, 0.385);
    add(box(0.012, 0.012, 0.15), glowMat, 0, 0.185, 0.32);
    addRing(0.027, 0.005, darkMat, 0, -0.02, 0.42, Math.PI / 2);

    // pistol grip and trigger
    add(rbox(0.07, 0.195, 0.095, 0.022), darkMat, 0, -0.085, 0.09, -0.3);
    add(rbox(0.06, 0.05, 0.06, 0.014), bodyMat, 0, -0.175, 0.12, -0.3);
    add(box(0.066, 0.008, 0.012), accentMat, 0, -0.035, 0.043);
    add(box(0.008, 0.055, 0.105), darkMat, 0, -0.065, 0.0);
    add(box(0.009, 0.01, 0.10), darkMat, 0, -0.092, 0.005);
    add(box(0.012, 0.04, 0.012), accentMat, 0, -0.05, 0.018, 0.24);

    // large scope with sunshade, turrets and glass
    add(rbox(0.085, 0.022, 0.30, 0.006), darkMat, 0, 0.205, -0.06);
    addCylZ(0.045, 0.045, 0.34, darkMat, 0, 0.285, -0.06, 20);
    addCylZ(0.058, 0.048, 0.10, bodyMat, 0, 0.285, -0.245, 20);
    addCylZ(0.043, 0.043, 0.055, darkMat, 0, 0.285, 0.105, 16);
    add(disc(0.052, 20), lensMat, 0, 0.285, -0.298);
    addRing(0.059, 0.006, accentMat, 0, 0.285, -0.294);
    add(cylX(0.022, 0.027, 0.06, 16), darkMat, 0.058, 0.285, -0.02, 0, 0, Math.PI / 2);
    add(new THREE.CylinderGeometry(0.022, 0.018, 0.05, 12), accentMat, 0, 0.36, -0.06);
    add(rbox(0.035, 0.045, 0.03, 0.006), darkMat, -0.04, 0.235, -0.14);
    add(rbox(0.035, 0.045, 0.03, 0.006), darkMat, 0.04, 0.235, -0.14);
    add(box(0.01, 0.018, 0.012), glowMat, 0.052, 0.285, 0.08);

    // folded bipod under the accelerator
    add(rbox(0.16, 0.035, 0.05, 0.01), darkMat, 0, -0.01, -0.60);
    addCylZ(0.009, 0.009, 0.30, darkMat, -0.058, -0.02, -0.48, 8);
    addCylZ(0.009, 0.009, 0.30, darkMat, 0.058, -0.02, -0.48, 8);
    add(box(0.025, 0.016, 0.06), accentMat, -0.058, -0.02, -0.32);
    add(box(0.025, 0.016, 0.06), accentMat, 0.058, -0.02, -0.32);

    // slim energy cell magazine
    const cell = new THREE.Group();
    cell.position.set(0, -0.09, 0.02);
    const cellBody = new THREE.Mesh(rbox(0.072, 0.19, 0.11, 0.014), bodyMat);
    cellBody.frustumCulled = false;
    cell.add(cellBody);
    const cellGlow = new THREE.Mesh(box(0.052, 0.105, 0.012), glowMat);
    cellGlow.position.set(0, -0.005, -0.061);
    cellGlow.frustumCulled = false;
    cell.add(cellGlow);
    const cellBase = new THREE.Mesh(box(0.085, 0.03, 0.125), darkMat);
    cellBase.position.y = -0.09;
    cellBase.frustumCulled = false;
    cell.add(cellBase);
    group.add(cell);
    magMesh = cell;
  }

  // ------------------------------------------------------------------ havoc
  else {
    // fat launcher tube with an armoured top spine
    addCylZ(0.11, 0.105, 0.82, bodyMat, 0, 0.065, -0.21, 24);
    add(rbox(0.19, 0.055, 0.55, 0.018), bodyMat, 0, 0.17, -0.15);
    add(rbox(0.14, 0.08, 0.16, 0.018), darkMat, 0, 0.195, 0.03);
    add(rbox(0.13, 0.04, 0.16, 0.01), accentMat, 0, 0.20, -0.22);
    add(box(0.04, 0.04, 0.24), darkMat, -0.055, 0.205, 0.08);
    add(box(0.04, 0.04, 0.24), darkMat, 0.055, 0.205, 0.08);
    addCylZ(0.055, 0.08, 0.08, darkMat, 0, 0.065, 0.22, 18);

    // front collar, heat shield and ported muzzle
    addCylZ(0.14, 0.118, 0.15, bodyMat, 0, 0.065, -0.66, 24);
    addCylZ(0.125, 0.125, 0.09, darkMat, 0, 0.065, -0.78, 24);
    addCylZ(0.148, 0.13, 0.055, accentMat, 0, 0.065, -0.835, 24);
    addRing(0.135, 0.012, glowMat, 0, 0.065, -0.86, 0, 0, 32);
    addCylZ(0.095, 0.095, 0.025, darkMat, 0, 0.065, -0.865, 24);
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2;
      add(box(0.034, 0.034, 0.075), darkMat, Math.cos(a) * 0.125, 0.065 + Math.sin(a) * 0.125, -0.76, 0, 0, a);
    }
    muzzleZ = -0.885;
    muzzleY = 0.065;

    // rear venturi and back-blast cage
    addCylZ(0.11, 0.165, 0.18, bodyMat, 0, 0.065, 0.28, 24);
    addRing(0.155, 0.018, accentMat, 0, 0.065, 0.37, 0, 0, 32);
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2;
      add(box(0.018, 0.024, 0.14), darkMat, Math.cos(a) * 0.13, 0.065 + Math.sin(a) * 0.13, 0.30, 0, 0, a);
    }
    addCylZ(0.09, 0.11, 0.025, darkMat, 0, 0.065, 0.385, 20);

    // side-loading rocket drum with visible warheads
    const drum = new THREE.Group();
    drum.position.set(0, -0.115, 0.04);
    const drumBody = new THREE.Mesh(cylX(0.135, 0.135, 0.18, 24), bodyMat);
    drumBody.rotation.z = Math.PI / 2;
    drumBody.frustumCulled = false;
    drum.add(drumBody);
    // Keep the drum's near face visible and load it with three warheads; the
    // earlier full-width inner cylinder turned the whole side into a black disc.
    const drumFace = new THREE.Mesh(disc(0.10, 28), darkMat);
    drumFace.rotation.y = Math.PI / 2;
    drumFace.position.x = 0.091;
    drumFace.frustumCulled = false;
    drum.add(drumFace);
    const drumHub = new THREE.Mesh(cylX(0.04, 0.04, 0.022, 16), bodyMat);
    drumHub.rotation.z = Math.PI / 2;
    drumHub.position.x = 0.102;
    drumHub.frustumCulled = false;
    drum.add(drumHub);
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2;
      const warhead = new THREE.Mesh(cylX(0.024, 0.028, 0.12, 12), accentMat);
      warhead.rotation.z = Math.PI / 2;
      warhead.position.set(0.115, Math.sin(a) * 0.062, Math.cos(a) * 0.062);
      warhead.frustumCulled = false;
      drum.add(warhead);
      const tip = new THREE.Mesh(new THREE.ConeGeometry(0.028, 0.045, 12), glowMat);
      tip.rotation.z = -Math.PI / 2;
      tip.position.set(0.194, Math.sin(a) * 0.062, Math.cos(a) * 0.062);
      tip.frustumCulled = false;
      drum.add(tip);
    }
    const drumGlow = new THREE.Mesh(ring(0.128, 0.008, 32), glowMat);
    drumGlow.rotation.y = Math.PI / 2;
    drumGlow.position.x = 0.092;
    drumGlow.frustumCulled = false;
    drum.add(drumGlow);
    const drumRim = new THREE.Mesh(ring(0.132, 0.01, 32), accentMat);
    drumRim.rotation.y = Math.PI / 2;
    drumRim.position.x = 0.09;
    drumRim.frustumCulled = false;
    drum.add(drumRim);
    group.add(drum);
    magMesh = drum;

    // under-barrel foregrip with a trigger guard
    add(rbox(0.075, 0.19, 0.095, 0.022), darkMat, 0, -0.09, -0.39, 0.22);
    add(rbox(0.062, 0.05, 0.06, 0.014), bodyMat, 0, -0.18, -0.42, 0.22);
    add(box(0.07, 0.008, 0.012), accentMat, 0, -0.02, -0.37);
    add(box(0.008, 0.055, 0.105), darkMat, 0, -0.065, -0.31);
    add(box(0.009, 0.01, 0.105), darkMat, 0, -0.092, -0.31);

    // pistol grip and shoulder rest
    add(rbox(0.08, 0.20, 0.10, 0.024), darkMat, 0, -0.095, 0.17, -0.28);
    add(rbox(0.07, 0.055, 0.07, 0.014), bodyMat, 0, -0.19, 0.20, -0.28);
    add(box(0.075, 0.008, 0.013), accentMat, 0, -0.04, 0.13);
    add(rbox(0.15, 0.17, 0.05, 0.02), darkMat, 0, 0.02, 0.43);
    add(rbox(0.16, 0.19, 0.03, 0.014), bodyMat, 0, 0.01, 0.46);
    add(box(0.15, 0.012, 0.09), accentMat, 0, 0.11, 0.41);

    // side-mounted range optic
    add(rbox(0.07, 0.09, 0.13, 0.012), darkMat, 0.12, 0.19, -0.08);
    addCylZ(0.04, 0.04, 0.10, bodyMat, 0.12, 0.19, -0.17, 16);
    add(disc(0.034, 16), lensMat, 0.12, 0.19, -0.222);
    addRing(0.041, 0.005, glowMat, 0.12, 0.19, -0.22);
    add(rbox(0.025, 0.055, 0.025, 0.005), darkMat, 0.155, 0.13, -0.09);
    add(box(0.03, 0.03, 0.12), accentMat, -0.12, 0.16, -0.32);

    // warning bands and vents
    addRing(0.111, 0.008, accentMat, 0, 0.065, -0.48, 0, 0, 28);
    addRing(0.111, 0.008, accentMat, 0, 0.065, -0.54, 0, 0, 28);
    addRing(0.111, 0.007, glowMat, 0, 0.065, 0.07, 0, 0, 28);
    for (let i = 0; i < 4; i++) {
      add(box(0.025, 0.012, 0.08), darkMat, 0.102, 0.13 - i * 0.035, 0.02);
    }
    add(box(0.008, 0.018, 0.24), glowMat, -0.108, 0.10, -0.18);
    add(box(0.008, 0.018, 0.24), glowMat, 0.108, 0.10, -0.18);
  }

  // Merge every static part by material. `toNonIndexed` above keeps the buffers
  // compatible regardless of which primitive produced them.
  const byMat = new Map();
  for (const p of parts) {
    const list = byMat.get(p.mat) || [];
    list.push(p.geo);
    byMat.set(p.mat, list);
  }
  for (const [mat, geos] of byMat) {
    const merged = geos.length === 1 ? geos[0] : mergeGeometries(geos, false);
    if (!merged) continue;
    const mesh = new THREE.Mesh(merged, mat);
    mesh.frustumCulled = false;
    group.add(mesh);
  }

  const muzzle = new THREE.Object3D();
  muzzle.position.set(0, muzzleY, muzzleZ);
  group.add(muzzle);

  const flashSprite = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: muzzleTexture(),
      color: def.flash,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      depthTest: false,
    })
  );
  flashSprite.scale.setScalar(0.55);
  flashSprite.visible = false;
  muzzle.add(flashSprite);

  const flashLight = new THREE.PointLight(def.flash, 0, 16, 2);
  flashLight.position.copy(muzzle.position);
  group.add(flashLight);

  // the launcher is physically bulkier; a slightly smaller mount keeps the
  // first-person viewmodel from swallowing the right side of the screen
  group.scale.setScalar(def.id === 'havoc' ? 0.64 : 0.66);
  group.rotation.set(0, 0.035, 0);

  return { group, muzzle, flashSprite, flashLight, magMesh, def };
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
