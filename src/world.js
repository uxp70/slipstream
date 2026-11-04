import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { MAPS, MAP_BUILDERS } from './maps.js';

// Arena geometry + collision AABBs + ray queries against the level.
// Static solids are merged into three batches (bodies, neon edges, glowing
// caps), so an entire arena is three draw calls instead of ~150.
export { MAPS };

const EDGE_INDEX = [
  [0, 1], [1, 3], [3, 2], [2, 0],
  [4, 5], [5, 7], [7, 6], [6, 4],
  [0, 4], [1, 5], [2, 6], [3, 7],
];

export class World {
  constructor(scene) {
    this.scene = scene;
    this.V3 = THREE.Vector3;
    this.colliders = [];
    this.spawnPoints = [];
    this.pads = [];
    this.decor = [];
    this.bounds = 43;
    this.time = 0;
    this.mapId = 'circuit';
    this.startPos = new THREE.Vector3(0, 1.2, 30);

    this.root = new THREE.Group();
    this.scene.add(this.root);

    this.boxes = [];
    this.bodyMat = new THREE.MeshLambertMaterial({ vertexColors: true, emissive: 0x0a1c30 });
    this.edgeMat = new THREE.LineBasicMaterial({
      vertexColors: true,
      transparent: true,
      opacity: 0.36,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    this.capMat = new THREE.MeshBasicMaterial({
      vertexColors: true,
      transparent: true,
      opacity: 0.24,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    this.merged = [];
    this.decorMeshes = [];

    this.buildSky();
    this.buildFloor();
    this.buildLights();
    this.build('circuit');
  }

  // ------------------------------------------------------------------ statics
  solid(cx, yBottom, cz, w, h, d, opts = {}) {
    this.boxes.push({
      cx, y: yBottom, cz, w, h, d,
      color: opts.color ?? 0x1b2a42,
      edge: opts.edge ?? 0x4fe6ff,
      cap: opts.cap ?? 0x2ba9c4,
      capOpacity: opts.capOpacity ?? 0.18,
    });
    this.colliders.push({
      min: new THREE.Vector3(cx - w / 2, yBottom, cz - d / 2),
      max: new THREE.Vector3(cx + w / 2, yBottom + h, cz + d / 2),
    });
  }

  wallRing(bounds, height, opts) {
    const b = bounds;
    this.solid(0, 0, -b, b * 2 + 4, height, 1.4, opts);
    this.solid(0, 0, b, b * 2 + 4, height, 1.4, opts);
    this.solid(-b, 0, 0, 1.4, height, b * 2 + 4, opts);
    this.solid(b, 0, 0, 1.4, height, b * 2 + 4, opts);
  }

  horizonStrips(bounds, height) {
    const stripMat =
      this.stripMat ||
      (this.stripMat = new THREE.MeshBasicMaterial({
        color: 0x2ce0ff,
        transparent: true,
        opacity: 0.5,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }));
    for (const [x, z, w, d] of [
      [0, -bounds + 0.8, bounds * 2 - 2, 0.12],
      [0, bounds - 0.8, bounds * 2 - 2, 0.12],
      [-bounds + 0.8, 0, 0.12, bounds * 2 - 2],
      [bounds - 0.8, 0, 0.12, bounds * 2 - 2],
    ]) {
      const strip = new THREE.Mesh(new THREE.BoxGeometry(w, 0.22, d), stripMat);
      strip.position.set(x, height, z);
      strip.matrixAutoUpdate = false;
      strip.updateMatrix();
      this.root.add(strip);
    }
  }

  // merge every box into three batched meshes
  bake() {
    const bodies = [];
    const edgePos = [];
    const edgeCol = [];
    const caps = [];
    const c = new THREE.Color();

    for (const b of this.boxes) {
      const geo = new THREE.BoxGeometry(b.w, b.h, b.d);
      geo.translate(b.cx, b.y + b.h / 2, b.cz);
      const n = geo.attributes.position.count;
      c.set(b.color);
      const col = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) {
        col[i * 3] = c.r;
        col[i * 3 + 1] = c.g;
        col[i * 3 + 2] = c.b;
      }
      geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
      bodies.push(geo);

      const x0 = b.cx - b.w / 2;
      const x1 = b.cx + b.w / 2;
      const y0 = b.y;
      const y1 = b.y + b.h;
      const z0 = b.cz - b.d / 2;
      const z1 = b.cz + b.d / 2;
      const corners = [
        [x0, y0, z0], [x1, y0, z0], [x0, y0, z1], [x1, y0, z1],
        [x0, y1, z0], [x1, y1, z0], [x0, y1, z1], [x1, y1, z1],
      ];
      c.set(b.edge);
      for (const [a, bb] of EDGE_INDEX) {
        const p = corners[a];
        const q = corners[bb];
        edgePos.push(p[0], p[1], p[2], q[0], q[1], q[2]);
        for (let i = 0; i < 2; i++) edgeCol.push(c.r, c.g, c.b);
      }

      if (b.h > 0.5 && b.capOpacity > 0.02) {
        const cap = new THREE.PlaneGeometry(b.w * 0.94, b.d * 0.94);
        cap.rotateX(-Math.PI / 2);
        cap.translate(b.cx, b.y + b.h + 0.012, b.cz);
        const cn = cap.attributes.position.count;
        c.set(b.cap);
        const ca = new Float32Array(cn * 3);
        for (let i = 0; i < cn; i++) {
          ca[i * 3] = c.r * b.capOpacity * 4;
          ca[i * 3 + 1] = c.g * b.capOpacity * 4;
          ca[i * 3 + 2] = c.b * b.capOpacity * 4;
        }
        cap.setAttribute('color', new THREE.BufferAttribute(ca, 3));
        caps.push(cap);
      }
    }

    if (bodies.length) {
      const merged = mergeGeometries(bodies, false);
      bodies.forEach((g) => g.dispose());
      const mesh = new THREE.Mesh(merged, this.bodyMat);
      mesh.matrixAutoUpdate = false;
      mesh.updateMatrix();
      this.root.add(mesh);
      this.merged.push(merged);
    }

    if (edgePos.length) {
      const eg = new THREE.BufferGeometry();
      eg.setAttribute('position', new THREE.Float32BufferAttribute(edgePos, 3));
      eg.setAttribute('color', new THREE.Float32BufferAttribute(edgeCol, 3));
      const lines = new THREE.LineSegments(eg, this.edgeMat);
      lines.matrixAutoUpdate = false;
      lines.updateMatrix();
      this.root.add(lines);
      this.merged.push(eg);
    }

    if (caps.length) {
      const mergedCaps = mergeGeometries(caps, false);
      caps.forEach((g) => g.dispose());
      const mesh = new THREE.Mesh(mergedCaps, this.capMat);
      mesh.matrixAutoUpdate = false;
      mesh.updateMatrix();
      this.root.add(mesh);
      this.merged.push(mergedCaps);
    }
  }

  clear() {
    this.root.clear();
    for (const g of this.merged) g.dispose();
    this.merged = [];
    this.decorMeshes = [];
    this.colliders = [];
    this.spawnPoints = [];
    this.pads = [];
    this.decor = [];
    this.boxes = [];
  }

  // --------------------------------------------------------------- sky/floor
  buildSky() {
    const geo = new THREE.SphereGeometry(280, 32, 20);
    const mat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      uniforms: {
        top: { value: new THREE.Color(0x02030a) },
        bottom: { value: new THREE.Color(0x0a1a30) },
        glow: { value: new THREE.Color(0x1e6b8a) },
      },
      vertexShader: /* glsl */ `
        varying vec3 vPos;
        void main() {
          vPos = position;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        uniform vec3 top;
        uniform vec3 bottom;
        uniform vec3 glow;
        varying vec3 vPos;
        void main() {
          vec3 n = normalize(vPos);
          float h = clamp(n.y * 0.5 + 0.5, 0.0, 1.0);
          vec3 col = mix(bottom, top, pow(h, 0.9));
          float horizon = pow(1.0 - abs(n.y), 9.0);
          col += glow * horizon * 0.55;
          gl_FragColor = vec4(col, 1.0);
        }
      `,
    });
    this.sky = new THREE.Mesh(geo, mat);
    this.sky.frustumCulled = false;
    this.scene.add(this.sky);

    const count = 900;
    const pos = new Float32Array(count * 3);
    const col = new Float32Array(count * 3);
    const c = new THREE.Color();
    for (let i = 0; i < count; i++) {
      const r = 140 + Math.random() * 110;
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(Math.min(1, Math.max(-1, Math.random() * 1.4 - 0.35)));
      pos[i * 3] = Math.sin(phi) * Math.cos(theta) * r;
      pos[i * 3 + 1] = Math.abs(Math.cos(phi)) * r * 0.9;
      pos[i * 3 + 2] = Math.sin(phi) * Math.sin(theta) * r;
      c.setHSL(0.5 + Math.random() * 0.12, 0.6, 0.55 + Math.random() * 0.4);
      col[i * 3] = c.r;
      col[i * 3 + 1] = c.g;
      col[i * 3 + 2] = c.b;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    const m = new THREE.PointsMaterial({
      size: 2.1,
      map: makeDotTexture(),
      vertexColors: true,
      transparent: true,
      opacity: 0.8,
      sizeAttenuation: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      fog: false,
    });
    this.stars = new THREE.Points(g, m);
    this.stars.frustumCulled = false;
    this.scene.add(this.stars);
  }

  buildFloor() {
    const tex = makeGridTexture();
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(12, 12);
    tex.anisotropy = 4;
    this.floorMat = new THREE.MeshBasicMaterial({ map: tex, color: 0xffffff });
    this.floor = new THREE.Mesh(new THREE.PlaneGeometry(130, 130), this.floorMat);
    this.floor.rotation.x = -Math.PI / 2;
    this.floor.matrixAutoUpdate = false;
    this.floor.updateMatrix();
    this.scene.add(this.floor);
  }

  buildLights() {
    this.scene.add(new THREE.HemisphereLight(0x4d6fa8, 0x0a0e18, 0.95));

    const key = new THREE.DirectionalLight(0xa8c8ff, 1.4);
    key.position.set(35, 60, 22);
    this.scene.add(key);

    const rim = new THREE.DirectionalLight(0xff5fd8, 0.5);
    rim.position.set(-40, 24, -35);
    this.scene.add(rim);

    const fill = new THREE.DirectionalLight(0x39e6ff, 0.4);
    fill.position.set(0, 18, 50);
    this.scene.add(fill);

    const core = new THREE.PointLight(0x2ce0ff, 110, 55, 2);
    core.position.set(0, 9, 0);
    this.scene.add(core);
    this.coreLight = core;
  }

  // ---------------------------------------------------------------- map build
  build(id) {
    const map = MAPS.find((m) => m.id === id) || MAPS[0];
    this.clear();
    this.mapId = map.id;
    this.bounds = 43;

    const builder = MAP_BUILDERS[map.id] || MAP_BUILDERS.circuit;
    builder(this);

    this.buildPads();
    this.buildDecor();
    this.bake();
    this.resetPads();
    return map;
  }

  // ------------------------------------------------------------------- extras
  buildPads() {
    const ringGeo = this.padRingGeo || (this.padRingGeo = new THREE.RingGeometry(1.28, 1.6, 40));
    const discGeo = this.padDiscGeo || (this.padDiscGeo = new THREE.CylinderGeometry(1.5, 1.7, 0.18, 32));
    const colGeo = this.padColGeo || (this.padColGeo = new THREE.CylinderGeometry(0.95, 1.15, 6, 20, 1, true));
    const discMat =
      this.padDiscMat ||
      (this.padDiscMat = new THREE.MeshStandardMaterial({
        color: 0x2a1a0a,
        emissive: 0xffa63c,
        emissiveIntensity: 1.4,
        roughness: 0.4,
        metalness: 0.6,
      }));

    for (const [x, z] of this.padSpots || []) {
      const group = new THREE.Group();
      const disc = new THREE.Mesh(discGeo, discMat);
      disc.position.y = 0.09;
      group.add(disc);

      const ring = new THREE.Mesh(
        ringGeo,
        new THREE.MeshBasicMaterial({
          color: 0xffc063,
          transparent: true,
          opacity: 0.85,
          side: THREE.DoubleSide,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
        })
      );
      ring.rotation.x = -Math.PI / 2;
      ring.position.y = 0.26;
      group.add(ring);

      const column = new THREE.Mesh(
        colGeo,
        new THREE.MeshBasicMaterial({
          color: 0xffa63c,
          transparent: true,
          opacity: 0.06,
          side: THREE.DoubleSide,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
        })
      );
      column.position.y = 3;
      group.add(column);

      group.position.set(x, 0, z);
      this.root.add(group);
      this.pads.push({
        group, ring, column,
        pos: new THREE.Vector3(x, 0, z),
        radius: 1.85,
        power: 20.5,
        cooldown: 0,
      });
    }
  }

  buildDecor() {
    const geo = this.decorGeo || (this.decorGeo = new THREE.BoxGeometry(1, 1, 1));
    const mat = this.decorMat || (this.decorMat = new THREE.MeshBasicMaterial({ color: 0x0a1424 }));
    for (let i = 0; i < 14; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = 70 + Math.random() * 60;
      const h = 6 + Math.random() * 26;
      const w = 2 + Math.random() * 5;
      const mesh = new THREE.Mesh(geo, mat);
      mesh.scale.set(w, h, w * (0.7 + Math.random() * 0.6));
      mesh.position.set(Math.cos(a) * r, h / 2 - 6 + Math.random() * 10, Math.sin(a) * r);
      mesh.rotation.y = Math.random() * Math.PI;
      mesh.matrixAutoUpdate = false;
      mesh.updateMatrix();
      this.root.add(mesh);
      this.decorMeshes.push(mesh);
      this.decor.push({ mesh, spin: (Math.random() - 0.5) * 0.02 });
    }
  }

  buildSpawns(radius, count) {
    for (let i = 0; i < count; i++) {
      const a = (i / count) * Math.PI * 2;
      this.spawnPoints.push(
        new THREE.Vector3(Math.cos(a) * radius, 0.2 + (i % 4 === 0 ? 2.2 : 0), Math.sin(a) * radius)
      );
    }
  }

  resetPads() {
    for (const p of this.pads) p.cooldown = 0;
  }

  update(dt, time) {
    this.time = time;
    for (const d of this.decor) {
      if (!d.spin) continue;
      d.mesh.rotation.y += d.spin * dt * 10;
      d.mesh.updateMatrix();
    }
    for (const p of this.pads) {
      p.cooldown = Math.max(0, p.cooldown - dt);
      const pulse = 0.9 + Math.sin(time * 3 + p.pos.x) * 0.12;
      p.ring.scale.setScalar(pulse * (p.cooldown > 0 ? 0.75 : 1));
      p.ring.material.opacity = p.cooldown > 0 ? 0.25 : 0.75;
      p.column.material.opacity = (p.cooldown > 0 ? 0.02 : 0.06) + Math.sin(time * 2.5) * 0.015;
    }
    if (this.coreLight) this.coreLight.intensity = 110 + Math.sin(time * 1.6) * 22;
  }

  // Ray vs AABB slab test over every solid, plus the ground plane.
  raycast(origin, dir, maxDist = 200) {
    let best = null;
    for (const c of this.colliders) {
      const hit = rayAabb(origin, dir, c.min, c.max);
      if (hit && hit.t >= 0 && hit.t <= maxDist && (!best || hit.t < best.distance)) {
        best = { distance: hit.t, point: null, normal: hit.normal };
        best.point = origin.clone().addScaledVector(dir, hit.t);
      }
    }
    if (dir.y < 0) {
      const t = -origin.y / dir.y;
      if (t > 0 && t <= maxDist && (!best || t < best.distance)) {
        best = {
          distance: t,
          point: new THREE.Vector3(origin.x + dir.x * t, 0, origin.z + dir.z * t),
          normal: new THREE.Vector3(0, 1, 0),
        };
      }
    }
    return best;
  }
}

let _gridTex = null;
function makeGridTexture() {
  if (_gridTex) return _gridTex;
  const size = 256;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#060b14';
  ctx.fillRect(0, 0, size, size);

  ctx.strokeStyle = 'rgba(44,150,180,0.32)';
  ctx.lineWidth = 1;
  for (let i = 1; i < 4; i++) {
    const p = (i / 4) * size;
    ctx.beginPath();
    ctx.moveTo(p, 0);
    ctx.lineTo(p, size);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(0, p);
    ctx.lineTo(size, p);
    ctx.stroke();
  }

  ctx.shadowColor = 'rgba(99,245,255,0.95)';
  ctx.shadowBlur = 12;
  ctx.strokeStyle = 'rgba(120,248,255,0.8)';
  ctx.lineWidth = 2;
  ctx.strokeRect(0, 0, size, size);

  ctx.shadowBlur = 6;
  ctx.fillStyle = 'rgba(200,255,255,0.65)';
  for (const [x, y] of [[0, 0], [size, 0], [0, size], [size, size]]) {
    ctx.beginPath();
    ctx.arc(x, y, 2.2, 0, Math.PI * 2);
    ctx.fill();
  }

  _gridTex = new THREE.CanvasTexture(c);
  _gridTex.colorSpace = THREE.SRGBColorSpace;
  return _gridTex;
}

let _dotTex = null;
function makeDotTexture() {
  if (_dotTex) return _dotTex;
  const size = 64;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  const grad = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.35, 'rgba(255,255,255,0.55)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);
  _dotTex = new THREE.CanvasTexture(c);
  _dotTex.colorSpace = THREE.SRGBColorSpace;
  return _dotTex;
}

const _n = new THREE.Vector3();
export function rayAabb(origin, dir, min, max) {
  let tmin = 0;
  let tmax = Infinity;
  let axis = 0;
  let sign = 1;
  const o = [origin.x, origin.y, origin.z];
  const d = [dir.x, dir.y, dir.z];
  const mn = [min.x, min.y, min.z];
  const mx = [max.x, max.y, max.z];

  let hit = true;
  for (let i = 0; i < 3; i++) {
    if (Math.abs(d[i]) < 1e-8) {
      if (o[i] < mn[i] || o[i] > mx[i]) {
        hit = false;
        break;
      }
      continue;
    }
    const inv = 1 / d[i];
    let t1 = (mn[i] - o[i]) * inv;
    let t2 = (mx[i] - o[i]) * inv;
    let s = -1;
    if (t1 > t2) {
      const tmp = t1;
      t1 = t2;
      t2 = tmp;
      s = 1;
    }
    if (t1 > tmin) {
      tmin = t1;
      axis = i;
      sign = s;
    }
    tmax = Math.min(tmax, t2);
    if (tmin > tmax) {
      hit = false;
      break;
    }
  }
  if (!hit) return null;
  _n.set(0, 0, 0);
  _n.setComponent(axis, sign);
  return { t: tmin, normal: _n.clone() };
}
