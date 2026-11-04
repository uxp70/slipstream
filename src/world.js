import * as THREE from 'three';

// Arena geometry + collision AABBs + ray queries against the level.
export class World {
  constructor(scene) {
    this.scene = scene;
    this.colliders = [];
    this.spawnPoints = [];
    this.pads = [];
    this.decor = [];
    this.bounds = 43;
    this.time = 0;

    this.buildSky();
    this.buildFloor();
    this.buildArena();
    this.buildPads();
    this.buildDecor();
    this.buildSpawns();
    this.buildLights();
  }

  solid(cx, yBottom, cz, w, h, d, opts = {}) {
    const group = new THREE.Group();
    const geo = new THREE.BoxGeometry(w, h, d);
    const mat = new THREE.MeshStandardMaterial({
      color: opts.color ?? 0x1b2a42,
      roughness: opts.roughness ?? 0.58,
      metalness: 0.22,
      emissive: opts.emissive ?? 0x0a1c30,
      emissiveIntensity: opts.emissiveIntensity ?? 1.15,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(0, 0, 0);
    group.add(mesh);

    // neon edge outline
    const edges = new THREE.LineSegments(
      new THREE.EdgesGeometry(geo),
      new THREE.LineBasicMaterial({
        color: opts.edge ?? 0x4fe6ff,
        transparent: true,
        opacity: opts.edgeOpacity ?? 0.3,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      })
    );
    group.add(edges);

    // glowing cap so platforms read clearly at speed
    if (h > 0.5) {
      const cap = new THREE.Mesh(
        new THREE.PlaneGeometry(w * 0.94, d * 0.94),
        new THREE.MeshBasicMaterial({
          color: opts.cap ?? 0x2ba9c4,
          transparent: true,
          opacity: opts.capOpacity ?? 0.18,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
        })
      );
      cap.rotation.x = -Math.PI / 2;
      cap.position.y = h / 2 + 0.012;
      group.add(cap);
    }

    group.position.set(cx, yBottom + h / 2, cz);
    this.scene.add(group);

    this.colliders.push({
      min: new THREE.Vector3(cx - w / 2, yBottom, cz - d / 2),
      max: new THREE.Vector3(cx + w / 2, yBottom + h, cz + d / 2),
    });
    return group;
  }

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
          float h = clamp(normalize(vPos).y * 0.5 + 0.5, 0.0, 1.0);
          vec3 col = mix(bottom, top, pow(h, 0.9));
          float horizon = pow(1.0 - abs(normalize(vPos).y), 9.0);
          col += glow * horizon * 0.55;
          gl_FragColor = vec4(col, 1.0);
        }
      `,
    });
    this.scene.add(new THREE.Mesh(geo, mat));

    // star field
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
    this.scene.add(new THREE.Points(g, m));
  }

  buildFloor() {
    const tex = makeGridTexture();
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(12, 12);
    tex.anisotropy = 4;
    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(120, 120),
      new THREE.MeshBasicMaterial({ map: tex, fog: true })
    );
    floor.rotation.x = -Math.PI / 2;
    this.scene.add(floor);
    this.grid = null;

    // arena boundary walls (outside playable space, but visible)
    const wallOpts = { color: 0x0a1220, emissive: 0x06101e, edge: 0x2ad4ff, edgeOpacity: 0.35 };
    this.solid(0, 0, -46, 96, 18, 1.4, wallOpts);
    this.solid(0, 0, 46, 96, 18, 1.4, wallOpts);
    this.solid(-46, 0, 0, 1.4, 18, 96, wallOpts);
    this.solid(46, 0, 0, 1.4, 18, 96, wallOpts);

    // glowing horizon strips on the walls
    const stripMat = new THREE.MeshBasicMaterial({
      color: 0x2ce0ff,
      transparent: true,
      opacity: 0.55,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    for (const [x, z, w, d] of [
      [0, -45.2, 92, 0.12],
      [0, 45.2, 92, 0.12],
      [-45.2, 0, 0.12, 92],
      [45.2, 0, 0.12, 92],
    ]) {
      const strip = new THREE.Mesh(new THREE.BoxGeometry(w, 0.2, d), stripMat);
      strip.position.set(x, 15.5, z);
      this.scene.add(strip);
    }
  }

  buildArena() {
    const std = { color: 0x111c30, emissive: 0x07172a, edge: 0x3fe4ff, edgeOpacity: 0.4 };

    // central elevated platform + its approach blocks
    this.solid(0, 2.7, 0, 13, 0.75, 13, { ...std, cap: 0x1e8aa8, capOpacity: 0.3 });
    this.solid(0, 0, 0, 3.4, 2.7, 3.4, { color: 0x0d1626, edge: 0x2fbfe0, edgeOpacity: 0.3 });

    this.solid(-9.5, 0, -9.5, 4.4, 1.35, 4.4, std);
    this.solid(9.5, 0, -9.5, 4.4, 1.35, 4.4, std);
    this.solid(-9.5, 0, 9.5, 4.4, 1.35, 4.4, std);
    this.solid(9.5, 0, 9.5, 4.4, 1.35, 4.4, std);

    // mid cover blocks
    this.solid(-9.5, 0, 0, 3.4, 2.65, 2.2, { ...std, edge: 0xff4fd8, edgeOpacity: 0.25 });
    this.solid(9.5, 0, 0, 3.4, 2.65, 2.2, { ...std, edge: 0xff4fd8, edgeOpacity: 0.25 });
    this.solid(0, 0, -9.5, 2.2, 2.65, 3.4, std);
    this.solid(0, 0, 9.5, 2.2, 2.65, 3.4, std);

    // long strafe walls
    this.solid(-27, 0, 0, 1.5, 3.1, 20, { ...std, cap: 0x1a5f78 });
    this.solid(27, 0, 0, 1.5, 3.1, 20, { ...std, cap: 0x1a5f78 });

    // tall pillars for cover and line-of-sight breaks
    for (const [x, z] of [
      [-19, -19],
      [19, -19],
      [-19, 19],
      [19, 19],
    ]) {
      this.solid(x, 0, z, 1.8, 8.5, 1.8, { ...std, edge: 0xffc063, edgeOpacity: 0.22 });
    }

    // outer cover ring
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2;
      const r = 33;
      const h = i % 3 === 0 ? 4.4 : 2.4;
      this.solid(Math.cos(a) * r, 0, Math.sin(a) * r, 2.4, h, 2.4, {
        ...std,
        edge: i % 2 ? 0x3fe4ff : 0xff4fd8,
        edgeOpacity: 0.28,
      });
    }

    // floating platforms (reachable via launch pads)
    const float = { color: 0x0f1a2b, emissive: 0x09203a, edge: 0x63f5ff, edgeOpacity: 0.5, cap: 0x2fa5c4, capOpacity: 0.35 };
    this.solid(-20, 6.0, -22, 7.5, 0.6, 7.5, float);
    this.solid(20, 7.0, 20, 8, 0.6, 8, float);
    this.solid(0, 7.2, -27, 9, 0.6, 6, float);
    this.solid(-24, 7.6, 22, 6, 0.6, 6, { ...float, edge: 0xff4fd8 });

    // low ramps/ledges for slide practice
    this.solid(0, 0, 23, 16, 0.55, 6, { ...std, capOpacity: 0.18 });
    this.solid(0, 0, -23, 16, 0.55, 6, { ...std, capOpacity: 0.18 });
  }

  buildPads() {
    const spots = [
      [-33, 0, -33],
      [33, 0, -33],
      [-33, 0, 33],
      [33, 0, 33],
      [0, 0, -36],
      [0, 0, 36],
    ];
    const ringGeo = new THREE.RingGeometry(1.28, 1.6, 40);
    const discGeo = new THREE.CylinderGeometry(1.5, 1.7, 0.18, 32);
    for (const [x, y, z] of spots) {
      const group = new THREE.Group();
      const disc = new THREE.Mesh(
        discGeo,
        new THREE.MeshStandardMaterial({
          color: 0x2a1a0a,
          emissive: 0xffa63c,
          emissiveIntensity: 1.4,
          roughness: 0.4,
          metalness: 0.6,
        })
      );
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

      // vertical light column
      const column = new THREE.Mesh(
        new THREE.CylinderGeometry(0.95, 1.15, 6, 20, 1, true),
        new THREE.MeshBasicMaterial({
          color: 0xffa63c,
          transparent: true,
          opacity: 0.05,
          side: THREE.DoubleSide,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
        })
      );
      column.position.y = 3;
      group.add(column);

      group.position.set(x, y, z);
      this.scene.add(group);
      this.pads.push({
        group,
        ring,
        column,
        pos: new THREE.Vector3(x, y, z),
        radius: 1.85,
        power: 20.5,
        cooldown: 0,
      });
    }
  }

  buildDecor() {
    // floating monoliths in the distance
    for (let i = 0; i < 14; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = 70 + Math.random() * 60;
      const h = 6 + Math.random() * 26;
      const geo = new THREE.BoxGeometry(2 + Math.random() * 5, h, 2 + Math.random() * 5);
      const mat = new THREE.MeshStandardMaterial({
        color: 0x0a1220,
        emissive: 0x081a2e,
        emissiveIntensity: 1,
        roughness: 0.7,
        metalness: 0.5,
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(Math.cos(a) * r, h / 2 - 6 + Math.random() * 10, Math.sin(a) * r);
      mesh.rotation.y = Math.random() * Math.PI;
      this.scene.add(mesh);

      const edge = new THREE.LineSegments(
        new THREE.EdgesGeometry(geo),
        new THREE.LineBasicMaterial({
          color: i % 3 === 0 ? 0xff4fd8 : 0x3fe4ff,
          transparent: true,
          opacity: 0.2,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
        })
      );
      edge.position.copy(mesh.position);
      edge.rotation.copy(mesh.rotation);
      this.scene.add(edge);
      this.decor.push({ mesh, edge, spin: (Math.random() - 0.5) * 0.02, phase: Math.random() * 6.28 });
    }

  }

  buildSpawns() {
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      const r = 37;
      this.spawnPoints.push(new THREE.Vector3(Math.cos(a) * r, 0.2, Math.sin(a) * r));
    }
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

  resetPads() {
    for (const p of this.pads) p.cooldown = 0;
  }

  update(dt, time) {
    this.time = time;
    for (const d of this.decor) {
      if (d.spin) d.mesh.rotation.y += d.spin * dt * 10;
      if (d.mesh.rotation.x !== undefined && d.spin && Math.abs(d.spin) < 0.05) {
        d.mesh.rotation.z += d.spin * dt;
      }
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
  for (const [x, y] of [
    [0, 0],
    [size, 0],
    [0, size],
    [size, size],
  ]) {
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
