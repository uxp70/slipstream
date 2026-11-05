import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { MAPS, MAP_BUILDERS } from './maps.js';
import { artForMap } from './events.js';

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
    this.faces = [];
    this.signs = [];
    this.art = DEFAULT_ART;

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
    const art = this.art || DEFAULT_ART;
    const stripMat =
      this.stripMat ||
      (this.stripMat = new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false }));
    stripMat.color.setHex(art.strips.color);
    stripMat.opacity = art.strips.opacity;
    stripMat.blending = art.strips.additive ? THREE.AdditiveBlending : THREE.NormalBlending;
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
    // paint hooks: an event maps the arena's neon colours onto its own palette
    const art = this.art || DEFAULT_ART;
    const paintBody = painter(art.bodies.paint);
    const paintEdge = painter(art.edges.paint);
    const paintCap = painter(art.caps.paint);
    const solidCaps = !!art.caps.solid;

    for (const b of this.boxes) {
      const geo = new THREE.BoxGeometry(b.w, b.h, b.d);
      geo.translate(b.cx, b.y + b.h / 2, b.cz);
      const n = geo.attributes.position.count;
      c.set(paintBody(b.color));
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
      c.set(paintEdge(b.edge));
      for (const [a, bb] of EDGE_INDEX) {
        const p = corners[a];
        const q = corners[bb];
        edgePos.push(p[0], p[1], p[2], q[0], q[1], q[2]);
        for (let i = 0; i < 2; i++) edgeCol.push(c.r, c.g, c.b);
      }

      if (b.h > 0.5 && (solidCaps || b.capOpacity > 0.02)) {
        const cap = new THREE.PlaneGeometry(b.w * 0.94, b.d * 0.94);
        cap.rotateX(-Math.PI / 2);
        cap.translate(b.cx, b.y + b.h + 0.012, b.cz);
        const cn = cap.attributes.position.count;
        c.set(paintCap(b.cap));
        const ca = new Float32Array(cn * 3);
        // additive caps carry their brightness in the vertex colour; a solid
        // roof just takes the painted colour at face value
        const k = solidCaps ? 1 : b.capOpacity * 4;
        for (let i = 0; i < cn; i++) {
          ca[i * 3] = c.r * k;
          ca[i * 3 + 1] = c.g * k;
          ca[i * 3 + 2] = c.b * k;
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

    this.bakeFaces();
    this.bakeSigns();
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
    this.faces.length = 0;
    this.signs.length = 0;
  }

  // ------------------------------------------------------------- art direction
  // Render state only: one call restyles the arena for the event that owns it
  // without touching a single collider.
  applyArt(art) {
    this.art = art;
    const L = this.lights;

    const u = this.sky.material.uniforms;
    u.top.value.setHex(art.sky.top);
    u.bottom.value.setHex(art.sky.bottom);
    u.glow.value.setHex(art.sky.horizon);
    u.power.value = art.sky.horizonPower;
    u.haze.value = art.sky.haze;
    this.stars.visible = art.sky.stars > 0.01;
    this.stars.material.opacity = art.sky.stars;

    L.hemi.color.setHex(art.light.hemi.sky);
    L.hemi.groundColor.setHex(art.light.hemi.ground);
    L.hemi.intensity = art.light.hemi.intensity;
    for (const id of ['key', 'rim', 'fill']) {
      const light = L[id];
      const spec = art.light[id];
      light.color.setHex(spec.color);
      light.intensity = spec.intensity;
      if (spec.pos) light.position.set(spec.pos[0], spec.pos[1], spec.pos[2]);
    }
    L.core.color.setHex(art.light.core.color);
    L.core.intensity = art.light.core.intensity;
    this.coreBase = art.light.core.intensity;

    this.bodyMat.emissive.setHex(art.bodyEmissive);
    // additive blending is the whole neon read: without it the edges become
    // shadow lines on a lit surface instead of glowing wireframe
    this.edgeMat.blending = art.edges.additive ? THREE.AdditiveBlending : THREE.NormalBlending;
    this.edgeMat.opacity = art.edges.opacity;
    this.capMat.blending = art.caps.additive ? THREE.AdditiveBlending : THREE.NormalBlending;
    this.capMat.opacity = art.caps.opacity;

    if (this.stripMat) {
      this.stripMat.color.setHex(art.strips.color);
      this.stripMat.opacity = art.strips.opacity;
      this.stripMat.blending = art.strips.additive ? THREE.AdditiveBlending : THREE.NormalBlending;
    }
    if (this.decorMat) this.decorMat.color.setHex(art.decor);

    const tex = groundTexture(art.ground.texture);
    tex.repeat.set(art.ground.repeat, art.ground.repeat);
    this.floorMat.map = tex;
    this.floorMat.needsUpdate = true;
  }

  // A flat quad on a wall (window, door, painted board). Merged into its own
  // batch with no collider, so facade detail costs no raycast work.
  face(f) {
    this.faces.push({ color: 0x1b2126, ry: 0, rx: 0, ...f });
  }

  // A lettered board. Every sign shares one atlas, so a whole street of them is
  // one mesh and one texture.
  sign(s) {
    this.signs.push(s);
  }

  bakeFaces() {
    if (!this.faces.length) return;
    const geos = [];
    const c = new THREE.Color();
    for (const f of this.faces) {
      const g = new THREE.PlaneGeometry(f.w, f.h);
      const n = g.attributes.position.count;
      c.set(f.color);
      const col = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) {
        col[i * 3] = c.r;
        col[i * 3 + 1] = c.g;
        col[i * 3 + 2] = c.b;
      }
      g.setAttribute('color', new THREE.BufferAttribute(col, 3));
      if (f.rx) g.rotateX(f.rx);
      if (f.ry) g.rotateY(f.ry);
      g.translate(f.x, f.y, f.z);
      geos.push(g);
    }
    const mat = this.faceMat || (this.faceMat = new THREE.MeshLambertMaterial({ vertexColors: true }));
    this.addBatch(mergeGeometries(geos, false), geos, mat);
  }

  bakeSigns() {
    if (!this.signs.length) return;
    const atlas = signAtlas(this.signs.map((s) => s.name));
    const geos = [];
    for (const s of this.signs) {
      const g = new THREE.PlaneGeometry(s.w, s.h);
      const uv = g.attributes.uv;
      const cell = atlas.cells[atlas.index[s.name]] || atlas.cells[0];
      for (let i = 0; i < uv.count; i++) {
        uv.setXY(
          i,
          cell.u0 + uv.getX(i) * (cell.u1 - cell.u0),
          cell.v0 + uv.getY(i) * (cell.v1 - cell.v0)
        );
      }
      if (s.ry) g.rotateY(s.ry);
      g.translate(s.x, s.y, s.z);
      geos.push(g);
    }
    const mat = this.signMat || (this.signMat = new THREE.MeshBasicMaterial({ map: atlas.texture }));
    mat.map = atlas.texture;
    this.addBatch(mergeGeometries(geos, false), geos, mat);
  }

  addBatch(merged, sources, mat) {
    sources.forEach((g) => g.dispose());
    const mesh = new THREE.Mesh(merged, mat);
    mesh.matrixAutoUpdate = false;
    mesh.updateMatrix();
    this.root.add(mesh);
    this.merged.push(merged);
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
        power: { value: 9 },
        haze: { value: 0.55 },
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
        uniform float power;
        uniform float haze;
        varying vec3 vPos;
        void main() {
          vec3 n = normalize(vPos);
          float h = clamp(n.y * 0.5 + 0.5, 0.0, 1.0);
          vec3 col = mix(bottom, top, pow(h, 0.9));
          float horizon = pow(1.0 - abs(n.y), power);
          col += glow * horizon * haze;
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
    this.floorMat = new THREE.MeshBasicMaterial({ map: groundTexture('grid'), color: 0xffffff });
    this.floor = new THREE.Mesh(new THREE.PlaneGeometry(130, 130), this.floorMat);
    this.floor.rotation.x = -Math.PI / 2;
    this.floor.matrixAutoUpdate = false;
    this.floor.updateMatrix();
    this.scene.add(this.floor);
  }

  buildLights() {
    const hemi = new THREE.HemisphereLight(0x4d6fa8, 0x0a0e18, 0.95);
    this.scene.add(hemi);

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
    // kept together so an event's art direction can restyle the whole rig
    this.lights = { hemi, key, rim, fill, core };
    this.coreBase = 110;
  }

  // ---------------------------------------------------------------- map build
  build(id) {
    const map = MAPS.find((m) => m.id === id) || MAPS[0];
    this.clear();
    this.mapId = map.id;
    this.bounds = 43;

    // the arena's event owns how it is lit and painted, so the art is in place
    // before a single box is built
    this.applyArt(mergeArt(DEFAULT_ART, artForMap(map.id)));

    const builder = MAP_BUILDERS[map.id] || MAP_BUILDERS.circuit;
    builder(this);

    this.buildPads();
    this.buildDecor();
    this.bake();
    // the builder may tint the ground itself; the event's art wins when it has one
    this.floorMat.color.setHex(this.art.ground.color ?? this.floorTint ?? 0xffffff);
    this.resetPads();
    return map;
  }

  // ------------------------------------------------------------------- extras
  buildPads() {
    const ringGeo = this.padRingGeo || (this.padRingGeo = new THREE.RingGeometry(1.28, 1.6, 40));
    const discGeo = this.padDiscGeo || (this.padDiscGeo = new THREE.CylinderGeometry(1.5, 1.7, 0.18, 32));
    const colGeo = this.padColGeo || (this.padColGeo = new THREE.CylinderGeometry(0.95, 1.15, 6, 20, 1, true));
    const pads = (this.art || DEFAULT_ART).pads;
    this.padDiscMat?.dispose();
    const discMat = (this.padDiscMat = new THREE.MeshStandardMaterial({
      color: pads.disc,
      emissive: pads.emissive,
      emissiveIntensity: pads.emissiveIntensity,
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
          color: pads.ring,
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
          color: pads.column,
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
    const art = this.art || DEFAULT_ART;
    const mat = this.decorMat || (this.decorMat = new THREE.MeshBasicMaterial({ color: art.decor }));
    mat.color.setHex(art.decor);
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
    if (this.coreLight && this.coreBase > 0) {
      this.coreLight.intensity = this.coreBase * (1 + Math.sin(time * 1.6) * 0.2);
    }
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

// ---------------------------------------------------------------- art defaults
// The neon baseline that every event's art is merged over. A null means "keep
// whatever the arena or the graphics setting already picked", so an event only
// has to state what it actually changes.
export const DEFAULT_ART = {
  exposure: null,
  bloom: { strength: null, radius: null, threshold: null },
  fog: { color: null, density: null },
  sky: { top: 0x02030a, bottom: 0x0a1a30, horizon: 0x1e6b8a, horizonPower: 9, haze: 0.55, stars: 0.8 },
  light: {
    hemi: { sky: 0x4d6fa8, ground: 0x0a0e18, intensity: 0.95 },
    key: { color: 0xa8c8ff, intensity: 1.4, pos: [35, 60, 22] },
    rim: { color: 0xff5fd8, intensity: 0.5, pos: [-40, 24, -35] },
    fill: { color: 0x39e6ff, intensity: 0.4, pos: [0, 18, 50] },
    core: { color: 0x2ce0ff, intensity: 110 },
  },
  bodyEmissive: 0x0a1c30,
  bodies: { paint: null },
  edges: { additive: true, opacity: 0.36, paint: null },
  caps: { additive: true, opacity: 0.24, solid: false, paint: null },
  strips: { color: 0x2ce0ff, opacity: 0.5, additive: true },
  ground: { texture: 'grid', color: null, repeat: 12 },
  decor: 0x0a1424,
  pads: { disc: 0x2a1a0a, emissive: 0xffa63c, emissiveIntensity: 1.4, ring: 0xffc063, column: 0xffa63c },
};

function mergeArt(base, over) {
  if (!over) return base;
  const out = { ...base };
  for (const key of Object.keys(over)) {
    const value = over[key];
    out[key] =
      value && typeof value === 'object' && !Array.isArray(value)
        ? { ...(base[key] || {}), ...value }
        : value;
  }
  return out;
}

// a paint table maps the colours the arena was authored with to the event's own
function painter(table) {
  if (!table) return (hex) => hex;
  return (hex) => (table[hex] != null ? table[hex] : hex);
}

const _groundTex = new Map();
function groundTexture(kind) {
  const hit = _groundTex.get(kind);
  if (hit) return hit;
  const tex =
    kind === 'dirt' ? makeDirtTexture() : kind === 'snow' ? makeSnowTexture() : makeGridTexture();
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 4;
  tex.colorSpace = THREE.SRGBColorSpace;
  _groundTex.set(kind, tex);
  return tex;
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

let _dirtTex = null;
function makeDirtTexture() {
  if (_dirtTex) return _dirtTex;
  const size = 512;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#96744a';
  ctx.fillRect(0, 0, size, size);

  // every blob is stamped on a wrapped 3x3 grid, so the tile has no seams
  const blob = (x, y, r, fill, alpha) => {
    ctx.globalAlpha = alpha;
    ctx.fillStyle = fill;
    for (let ox = -1; ox <= 1; ox++) {
      for (let oy = -1; oy <= 1; oy++) {
        ctx.beginPath();
        ctx.arc(x + ox * size, y + oy * size, r, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  };
  const tones = ['#a8854f', '#7d5c35', '#b39468', '#6f5230'];
  for (let i = 0; i < 240; i++) {
    blob(
      Math.random() * size,
      Math.random() * size,
      6 + Math.random() * 32,
      tones[i % tones.length],
      0.14 + Math.random() * 0.16
    );
  }

  // wheel ruts down the street
  ctx.globalAlpha = 0.11;
  ctx.strokeStyle = '#6d5335';
  ctx.lineWidth = 10;
  for (const y of [size * 0.32, size * 0.68]) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    for (let x = 0; x <= size; x += 32) ctx.lineTo(x, y + Math.sin((x / size) * Math.PI * 4) * 4);
    ctx.stroke();
  }

  // gravel and dry grass
  for (let i = 0; i < 520; i++) {
    ctx.globalAlpha = 0.1 + Math.random() * 0.22;
    ctx.fillStyle = Math.random() > 0.5 ? '#6f5636' : '#d8c09a';
    const r = 0.8 + Math.random() * 1.8;
    ctx.fillRect(Math.random() * size, Math.random() * size, r, r);
  }
  ctx.globalAlpha = 1;
  _dirtTex = new THREE.CanvasTexture(c);
  return _dirtTex;
}

let _snowTex = null;
function makeSnowTexture() {
  if (_snowTex) return _snowTex;
  const size = 512;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#e9f3f9';
  ctx.fillRect(0, 0, size, size);
  const tones = ['#dceaf3', '#f7fcff', '#cfe1ec', '#e2eef6'];
  for (let i = 0; i < 200; i++) {
    ctx.globalAlpha = 0.2 + Math.random() * 0.3;
    ctx.fillStyle = tones[i % tones.length];
    ctx.beginPath();
    ctx.arc(Math.random() * size, Math.random() * size, 10 + Math.random() * 46, 0, Math.PI * 2);
    ctx.fill();
  }
  // wind-blown drifts and a few surface cracks
  ctx.globalAlpha = 0.16;
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 6;
  for (let i = 0; i < 14; i++) {
    const y = Math.random() * size;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.bezierCurveTo(size * 0.3, y + 18, size * 0.6, y - 16, size, y + 6);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
  _snowTex = new THREE.CanvasTexture(c);
  return _snowTex;
}

// One atlas for every sign in a street: a board with plank lines and a painted
// trade name, drawn with the canvas API so there is no font or image asset.
const _signCache = new Map();
function signAtlas(names) {
  const list = Array.from(new Set(names)).slice(0, 8);
  const key = list.join('|');
  const hit = _signCache.get(key);
  if (hit) return hit;

  const cols = 4;
  const rows = 2;
  const cw = 512;
  const ch = 160;
  const canvas = document.createElement('canvas');
  canvas.width = cols * cw;
  canvas.height = rows * ch;
  const ctx = canvas.getContext('2d');

  const index = {};
  list.forEach((name, i) => {
    drawSignBoard(ctx, (i % cols) * cw, Math.floor(i / cols) * ch, cw, ch, name);
    index[name] = i;
  });

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  const cells = list.map((_, i) => {
    const col = i % cols;
    const row = Math.floor(i / cols);
    return { u0: col / cols, u1: (col + 1) / cols, v0: 1 - (row + 1) / rows, v1: 1 - row / rows };
  });
  const out = { texture, cells, index };
  _signCache.set(key, out);
  return out;
}

function drawSignBoard(ctx, x, y, w, h, name) {
  ctx.save();
  ctx.translate(x, y);
  ctx.fillStyle = '#2b1d12';
  ctx.fillRect(0, 0, w, h);

  for (let i = 0; i < 4; i++) {
    ctx.fillStyle = i % 2 ? 'rgba(72,50,30,0.55)' : 'rgba(52,35,22,0.6)';
    ctx.fillRect(0, (h / 4) * i, w, h / 4 - 2);
  }
  for (let i = 0; i < 110; i++) {
    ctx.fillStyle = `rgba(0,0,0,${0.03 + Math.random() * 0.07})`;
    ctx.fillRect(Math.random() * w, Math.random() * h, 6 + Math.random() * 40, 1.5);
  }

  ctx.strokeStyle = '#180f08';
  ctx.lineWidth = 6;
  ctx.strokeRect(3, 3, w - 6, h - 6);

  ctx.fillStyle = '#f3e3c0';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  let size = 76;
  const font = (px) => `bold ${px}px Georgia, 'Times New Roman', serif`;
  ctx.font = font(size);
  while (ctx.measureText(name).width > w - 60 && size > 26) {
    size -= 4;
    ctx.font = font(size);
  }
  ctx.fillText(name, w / 2, h / 2 + 3);
  ctx.restore();
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
