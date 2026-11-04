import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// Procedural viewmodels: four silhouettes you can tell apart at a glance in a
// dark arena (fat shotgun, long coil railgun, boxy launcher, slim rifle).
// Static parts are merged per material, so each gun is ~4 draw calls instead of
// one per box; only the magazine and muzzle flash stay as separate objects
// because they animate.
export function buildWeaponModel(def) {
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
  const glowMat = new THREE.MeshBasicMaterial({ color: def.color });
  const accentMat = new THREE.MeshBasicMaterial({ color: 0xffb347 });

  const parts = [];
  const add = (geo, mat, x, y, z, rx = 0, ry = 0, rz = 0) => {
    geo.applyMatrix4(
      new THREE.Matrix4().compose(
        new THREE.Vector3(x, y, z),
        new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)),
        new THREE.Vector3(1, 1, 1)
      )
    );
    parts.push({ geo, mat });
  };
  const addDynamic = (geo, mat, x, y, z, rx = 0, ry = 0, rz = 0) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.rotation.set(rx, ry, rz);
    m.frustumCulled = false;
    group.add(m);
    return m;
  };

  let magMesh = null;
  let muzzleZ = -0.86;

  if (def.id === 'rifle') {
    add(new THREE.BoxGeometry(0.17, 0.16, 0.6), bodyMat, 0, 0, 0);
    add(new THREE.BoxGeometry(0.085, 0.085, 0.46), bodyMat, 0, 0.012, -0.48);
    add(new THREE.BoxGeometry(0.115, 0.115, 0.13), darkMat, 0, 0.012, -0.74);
    add(new THREE.BoxGeometry(0.13, 0.05, 0.34), darkMat, 0, 0.105, -0.2);
    add(new THREE.BoxGeometry(0.055, 0.026, 0.05), darkMat, 0, 0.133, -0.07);
    add(new THREE.BoxGeometry(0.016, 0.016, 0.016), glowMat, 0, 0.14, -0.095);
    add(new THREE.BoxGeometry(0.03, 0.008, 0.008), accentMat, 0, 0.12, -0.02);
    add(new THREE.BoxGeometry(0.075, 0.22, 0.1), darkMat, 0, -0.17, 0.16, 0.28);
    magMesh = addDynamic(new THREE.BoxGeometry(0.095, 0.27, 0.14), bodyMat, 0, -0.2, -0.02, -0.1);
    add(new THREE.BoxGeometry(0.075, 0.13, 0.26), darkMat, 0, -0.015, 0.36);
    add(new THREE.BoxGeometry(0.012, 0.012, 0.42), glowMat, -0.088, 0.058, -0.02);
    add(new THREE.BoxGeometry(0.012, 0.012, 0.42), glowMat, 0.088, 0.058, -0.02);
    add(new THREE.BoxGeometry(0.012, 0.012, 0.2), accentMat, 0.088, -0.045, 0.12);
  } else if (def.id === 'breach') {
    // fat receiver, twin tubes, shell rail, wide muzzle
    add(new THREE.BoxGeometry(0.22, 0.19, 0.54), bodyMat, 0, 0, 0);
    add(new THREE.BoxGeometry(0.1, 0.1, 0.5), darkMat, 0, 0.06, -0.48);
    add(new THREE.BoxGeometry(0.09, 0.09, 0.44), darkMat, 0, -0.045, -0.46);
    add(new THREE.BoxGeometry(0.17, 0.17, 0.1), darkMat, 0, 0.01, -0.76);
    magMesh = addDynamic(new THREE.BoxGeometry(0.05, 0.05, 0.34), accentMat, -0.13, 0, -0.12);
    add(new THREE.BoxGeometry(0.09, 0.26, 0.12), darkMat, 0, -0.19, 0.15, 0.3);
    add(new THREE.BoxGeometry(0.2, 0.07, 0.16), bodyMat, 0, 0.12, 0.1);
    for (let i = 0; i < 4; i++) {
      add(new THREE.BoxGeometry(0.014, 0.014, 0.09), glowMat, -0.085 + i * 0.055, 0.1, -0.02);
    }
    add(new THREE.BoxGeometry(0.02, 0.02, 0.34), glowMat, 0.115, 0, -0.16);
    muzzleZ = -0.9;
  } else if (def.id === 'lance') {
    // long barrel, coil rings, scope spine
    add(new THREE.BoxGeometry(0.14, 0.15, 0.5), bodyMat, 0, 0, 0);
    add(new THREE.CylinderGeometry(0.035, 0.035, 0.95, 10), darkMat, 0, 0.02, -0.62, Math.PI / 2);
    for (let i = 0; i < 5; i++) {
      add(new THREE.TorusGeometry(0.075, 0.016, 4, 16), glowMat, 0, 0.02, -0.35 - i * 0.16);
    }
    add(new THREE.BoxGeometry(0.05, 0.075, 0.3), darkMat, 0, 0.115, -0.08);
    add(new THREE.BoxGeometry(0.014, 0.014, 0.012), accentMat, 0, 0.16, -0.2);
    magMesh = addDynamic(new THREE.BoxGeometry(0.08, 0.2, 0.1), glowMat, 0, -0.19, 0.05, -0.15);
    add(new THREE.BoxGeometry(0.08, 0.24, 0.1), darkMat, 0, -0.18, 0.18, 0.3);
    add(new THREE.BoxGeometry(0.07, 0.12, 0.24), darkMat, 0, -0.01, 0.33);
    add(new THREE.BoxGeometry(0.012, 0.012, 0.3), glowMat, -0.075, 0.05, 0.06);
    add(new THREE.BoxGeometry(0.012, 0.012, 0.3), glowMat, 0.075, 0.05, 0.06);
    muzzleZ = -1.12;
  } else {
    // boxy launcher with a drum and a flared muzzle
    add(new THREE.BoxGeometry(0.24, 0.22, 0.62), bodyMat, 0, 0, 0);
    add(new THREE.CylinderGeometry(0.115, 0.13, 0.5, 14), darkMat, 0, 0, -0.58, Math.PI / 2);
    add(new THREE.CylinderGeometry(0.16, 0.12, 0.16, 14), accentMat, 0, 0, -0.84, Math.PI / 2);
    magMesh = addDynamic(new THREE.CylinderGeometry(0.115, 0.115, 0.14, 16), bodyMat, 0, -0.12, 0.06, 0, 0, Math.PI / 2);
    add(new THREE.TorusGeometry(0.12, 0.015, 4, 18), glowMat, 0, -0.12, 0.06);
    add(new THREE.BoxGeometry(0.09, 0.24, 0.12), darkMat, 0, -0.2, 0.2, 0.3);
    add(new THREE.BoxGeometry(0.06, 0.06, 0.32), darkMat, 0, 0.14, -0.05);
    add(new THREE.BoxGeometry(0.016, 0.016, 0.26), glowMat, -0.128, 0.06, -0.05);
    add(new THREE.BoxGeometry(0.016, 0.016, 0.26), glowMat, 0.128, 0.06, -0.05);
    muzzleZ = -0.95;
  }

  const byMat = new Map();
  for (const p of parts) {
    const list = byMat.get(p.mat) || [];
    list.push(p.geo);
    byMat.set(p.mat, list);
  }
  for (const [mat, geos] of byMat) {
    const merged = geos.length === 1 ? geos[0] : mergeGeometries(geos, false);
    const mesh = new THREE.Mesh(merged, mat);
    mesh.frustumCulled = false;
    group.add(mesh);
  }

  const muzzle = new THREE.Object3D();
  muzzle.position.set(0, 0.012, muzzleZ);
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

  group.scale.setScalar(def.id === 'havoc' ? 0.62 : 0.66);
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
