import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// Render-only architecture. The arena's colliders and raycasts stay exactly as
// maps.js wrote them: this module reads the boxes an arena is made of and hangs
// detail on them — lit windows, parapets, roof units, masts, corner neon — then
// builds a city skyline outside the walls. Everything merges into three meshes
// (bodies, windows, neon), so a whole decorated district costs three draw calls.
//
// The reason to derive it from the solids rather than author it per map: every
// arena already declares its buildings as boxes with a colour. Reading that
// means a new map gets the treatment for free, and no gameplay geometry moves.

const TAU = Math.PI * 2;

const SKYLINE = [0x0a1220, 0x0c1726, 0x0e1b2c, 0x091019, 0x101a26, 0x0b1622];
const WARM = 0xffc978;
const COOL = 0x9ae8ff;
const OFF = 0x16283a;

function hash(text) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return h >>> 0;
}

// mulberry32: same map, same skyline, no assets to ship
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

function tint(geo, hex, gain = 1) {
  const n = geo.attributes.position.count;
  const c = new THREE.Color(hex);
  const r = c.r * gain;
  const g = c.g * gain;
  const b = c.b * gain;
  const col = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    col[i * 3] = r;
    col[i * 3 + 1] = g;
    col[i * 3 + 2] = b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return geo;
}

function box(w, h, d, cx, cy, cz, hex, gain = 1) {
  const g = new THREE.BoxGeometry(w, h, d);
  g.translate(cx, cy, cz);
  return tint(g, hex, gain);
}

function quad(w, h, cx, cy, cz, ry, hex, gain = 1) {
  const g = new THREE.PlaneGeometry(w, h);
  if (ry) g.rotateY(ry);
  g.translate(cx, cy, cz);
  return tint(g, hex, gain);
}

function shade(hex, k) {
  const c = new THREE.Color(hex);
  return c.multiplyScalar(k).getHex();
}

export class Architecture {
  constructor(world) {
    this.world = world;
    // bodies reuse the arena's own lambert material, so a new map's art
    // direction repaints the dressing with it
    this.bodyMat = world.bodyMat;
    this.winMat = new THREE.MeshBasicMaterial({ vertexColors: true });
    this.neonMat = new THREE.MeshBasicMaterial({
      vertexColors: true,
      transparent: true,
      opacity: 0.62,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    this.meshes = [];
    this.stats = { towers: 0, windows: 0, details: 0 };
    this.bodies = [];
    this.windows = [];
    this.neon = [];
  }

  build() {
    this.clear();
    this.stats = { towers: 0, windows: 0, details: 0 };
    const world = this.world;
    const rand = rng(hash(world.mapId || 'circuit'));

    // the flat decor boxes are replaced by the skyline below; hiding them keeps
    // the old maps' silhouettes from poking through the new district
    for (const m of world.decorMeshes) m.visible = false;

    this.ground();
    // the frontier has no downtown: that map gets buttes on the horizon instead
    // of the tower district the neon arenas share
    if (world.mapId === 'dustfall') this.mesas(rand);
    else this.skyline(rand);
    this.facades(rand);
    this.flush();
    return this.stats;
  }

  clear() {
    for (const entry of this.meshes) {
      this.world.root.remove(entry.mesh);
      entry.geo.dispose();
    }
    this.meshes = [];
    this.bodies = [];
    this.windows = [];
    this.neon = [];
  }

  flush() {
    const add = (list, mat) => {
      if (!list.length) return;
      const geo = mergeGeometries(list, false);
      list.forEach((g) => g.dispose());
      const mesh = new THREE.Mesh(geo, mat);
      mesh.matrixAutoUpdate = false;
      mesh.updateMatrix();
      this.world.root.add(mesh);
      this.meshes.push({ mesh, geo });
    };
    add(this.bodies, this.bodyMat);
    add(this.windows, this.winMat);
    add(this.neon, this.neonMat);
  }

  // The floor plane is 130 m across; the skyline sits past it, so a dark apron
  // under everything stops the towers from floating over nothing.
  ground() {
    const g = new THREE.PlaneGeometry(420, 420);
    g.rotateX(-Math.PI / 2);
    g.translate(0, -0.4, 0);
    this.bodies.push(tint(g, 0x05070f));
  }

  // ---------------------------------------------------------------- skyline
  skyline(rand) {
    const bounds = this.world.bounds || 43;
    const count = 30;
    for (let i = 0; i < count; i++) {
      const a = (i / count) * TAU + (rand() - 0.5) * 0.2;
      const r = bounds + 24 + rand() * 74;
      const cx = Math.cos(a) * r;
      const cz = Math.sin(a) * r;
      const bw = 7 + rand() * 15;
      const bd = 7 + rand() * 15;
      const bh = 16 + rand() * 46;
      const base = SKYLINE[(rand() * SKYLINE.length) | 0];

      this.bodies.push(box(bw, bh, bd, cx, bh / 2, cz, base, 1.15));
      let top = bh;

      // setback: the second tier is what makes a block read as a tower
      if (rand() < 0.72) {
        const sh = 5 + rand() * 16;
        const sw = bw * (0.5 + rand() * 0.22);
        const sd = bd * (0.5 + rand() * 0.22);
        this.bodies.push(box(sw, sh, sd, cx, top + sh / 2, cz, shade(base, 1.3), 1.2));
        top += sh;
        if (rand() < 0.4) {
          const th = 4 + rand() * 9;
          this.bodies.push(box(sw * 0.55, th, sd * 0.55, cx, top + th / 2, cz, shade(base, 1.5), 1.25));
          top += th;
        }
      }

      // mast + beacon: the skyline's only moving-looking detail, and it costs
      // six vertices
      if (rand() < 0.55) {
        const mh = 4 + rand() * 8;
        this.bodies.push(box(0.42, mh, 0.42, cx, top + mh / 2, cz, 0x0d1622, 1.1));
        this.neon.push(box(0.5, 0.5, 0.5, cx, top + mh + 0.2, cz, 0xff5c7a, 2.2));
        this.stats.details++;
      }

      this.faces(cx, cz, bw, bd, 1.0, bh, base, rand, 6, 11, 0.44);
      this.stats.towers++;
    }

    // a low haze band at the horizon so the city does not end in a hard line
    for (let i = 0; i < 18; i++) {
      const a = rand() * TAU;
      const r = bounds + 34 + rand() * 46;
      const w = 14 + rand() * 26;
      const h = 3 + rand() * 9;
      const g = new THREE.PlaneGeometry(w, h);
      g.rotateY(Math.atan2(Math.cos(a), Math.sin(a)) + Math.PI / 2);
      g.translate(Math.cos(a) * r, h / 2 + 1, Math.sin(a) * r);
      this.neon.push(tint(g, 0x14324a, 0.5));
    }
  }

  // Distant buttes for the frontier map: wide, low, flat-topped, no windows.
  mesas(rand) {
    const bounds = this.world.bounds || 44;
    const count = 14;
    for (let i = 0; i < count; i++) {
      const a = (i / count) * TAU + (rand() - 0.5) * 0.28;
      const r = bounds + 20 + rand() * 58;
      const cx = Math.cos(a) * r;
      const cz = Math.sin(a) * r;
      const bw = 22 + rand() * 36;
      const bd = 15 + rand() * 26;
      const bh = 6 + rand() * 13;
      const base = 0x2a1c12;
      this.bodies.push(box(bw, bh, bd, cx, bh / 2 - 1.6, cz, base, 1.05));
      const top = bh - 1.6;
      const cw = bw * (0.52 + rand() * 0.22);
      const cd = bd * (0.52 + rand() * 0.22);
      const ch = 2 + rand() * 5;
      this.bodies.push(box(cw, ch, cd, cx, top + ch / 2, cz, shade(base, 1.25), 1.05));
      // a single mine lamp on some of them: enough life to say somebody is out there
      if (rand() < 0.45) {
        this.neon.push(box(0.5, 0.5, 0.5, cx + cw * 0.3, top + ch + 0.3, cz + cd * 0.22, 0xffb45c, 1.8));
      }
      this.stats.towers++;
    }
    // low ridge behind, so the horizon is a shape rather than a fade
    for (let i = 0; i < 9; i++) {
      const a = rand() * TAU;
      const r = bounds + 58 + rand() * 58;
      const w = 38 + rand() * 54;
      this.bodies.push(box(w, 4 + rand() * 7, 14 + rand() * 14, Math.cos(a) * r, 1.4, Math.sin(a) * r, 0x1b120c));
    }
  }

  // Window grids on the faces that look inward, where the player can see them.
  faces(cx, cz, bw, bd, inset, bh, base, rand, maxCols, maxRows, lit) {
    const towardX = -cx;
    const towardZ = -cz;
    const len = Math.hypot(cx, cz) || 1;
    const faces = [
      { nx: 1, nz: 0, span: bd, cx: cx + bw / 2, cz, ry: Math.PI / 2 },
      { nx: -1, nz: 0, span: bd, cx: cx - bw / 2, cz, ry: -Math.PI / 2 },
      { nx: 0, nz: 1, span: bw, cx, cz: cz + bd / 2, ry: 0 },
      { nx: 0, nz: -1, span: bw, cx, cz: cz - bd / 2, ry: Math.PI },
    ];
    for (const f of faces) {
      const dot = (f.nx * towardX + f.nz * towardZ) / len;
      if (dot < -0.15) continue;
      const cols = clamp(Math.floor(f.span / 2.1), 2, maxCols);
      const rows = clamp(Math.floor((bh - 4) / 2.9), 1, maxRows);
      const cellW = f.span / cols;
      const cellH = (bh - 3.4) / (rows + 0.6);
      const ww = Math.min(1.15, cellW * 0.5);
      const wh = Math.min(1.45, cellH * 0.5);
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const warm = rand() < 0.42;
          const on = rand() < lit;
          const color = on ? (warm ? WARM : COOL) : OFF;
          const gain = on ? 0.62 + rand() * 0.95 : 0.9;
          const off = (c + 0.5) * cellW - f.span / 2;
          const y = 2.4 + (r + 0.5) * cellH;
          if (y > bh - 0.8) continue;
          const px = f.cx + f.nx * (inset + 0.02) + (f.nz !== 0 ? off : 0);
          const pz = f.cz + f.nz * (inset + 0.02) + (f.nx !== 0 ? off : 0);
          this.windows.push(quad(ww, wh, px, y, pz, f.ry, color, gain));
          this.stats.windows++;
        }
      }
      // a sill band under each row: three verts of neon, a lot of read
      if (bh > 10) {
        for (let r = 0; r < rows; r += 2) {
          const y = 2.4 + r * cellH;
          const px = f.cx + f.nx * (inset + 0.03);
          const pz = f.cz + f.nz * (inset + 0.03);
          this.neon.push(quad(f.span * 0.94, 0.05, px, y, pz, f.ry, shade(base, 2.2), 0.7));
        }
      }
    }
  }

  // ---------------------------------------------------------- arena facades
  facades(rand) {
    for (const b of this.world.boxes) {
      if (b.h < 4.5) continue;
      const minD = Math.min(b.w, b.d);
      const maxD = Math.max(b.w, b.d);
      if (maxD > 40) continue; // the arena walls are not buildings
      if (minD < 1.2) continue; // posts, rails, rails on posts
      if (minD < 3.2) this.pillar(b, rand);
      else this.building(b, rand);
    }
  }

  // Tall thin arena pieces — the ring pylons, canyon walls, bridge posts: they
  // get edge light and a beacon rather than windows they are too narrow to hold.
  pillar(b, rand) {
    const top = b.y + b.h;
    const edge = b.edge ?? 0x4fe6ff;
    const ix = b.w / 2 - 0.1;
    const iz = b.d / 2 - 0.1;
    for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      this.neon.push(box(0.1, b.h * 0.82, 0.1, b.cx + sx * ix, b.y + b.h * 0.5, b.cz + sz * iz, edge, 1.15));
    }
    if (b.h > 6) {
      this.neon.push(box(b.w + 0.16, 0.12, b.d + 0.16, b.cx, top - 1.1, b.cz, edge, 0.9));
      this.neon.push(box(0.26, 0.26, 0.26, b.cx, top + 0.22, b.cz, edge, 2.4));
      this.stats.details++;
    }
    if (rand() < 0.4) this.neon.push(box(b.w + 0.1, 0.08, b.d + 0.1, b.cx, b.y + 0.5, b.cz, edge, 0.8));
  }

  building(b, rand) {
    const top = b.y + b.h;
    const body = shade(b.color ?? 0x111c30, 1.5);
    const trim = shade(b.color ?? 0x111c30, 2.1);
    const edge = b.edge ?? 0x4fe6ff;

    // parapet: a roofline is the cheapest way to turn a box into a building
    const t = 0.28;
    const px = Math.max(0.6, b.w / 2 - t / 2 - 0.16);
    const pz = Math.max(0.6, b.d / 2 - t / 2 - 0.16);
    const ph = 0.5;
    this.bodies.push(box(b.w - 0.2, ph, t, b.cx, top + ph / 2, b.cz - pz, trim, 1.1));
    this.bodies.push(box(b.w - 0.2, ph, t, b.cx, top + ph / 2, b.cz + pz, trim, 1.1));
    this.bodies.push(box(t, ph, b.d - 0.2, b.cx - px, top + ph / 2, b.cz, trim, 1.1));
    this.bodies.push(box(t, ph, b.d - 0.2, b.cx + px, top + ph / 2, b.cz, trim, 1.1));

    // roof rim light follows the parapet
    this.neon.push(box(b.w - 0.24, 0.06, 0.06, b.cx, top + ph + 0.02, b.cz - pz, edge, 1.0));
    this.neon.push(box(b.w - 0.24, 0.06, 0.06, b.cx, top + ph + 0.02, b.cz + pz, edge, 1.0));
    this.neon.push(box(0.06, 0.06, b.d - 0.24, b.cx - px, top + ph + 0.02, b.cz, edge, 1.0));
    this.neon.push(box(0.06, 0.06, b.d - 0.24, b.cx + px, top + ph + 0.02, b.cz, edge, 1.0));

    // rooftop plant: one or two boxes, never symmetrical
    if (b.w > 4 && b.d > 4) {
      const units = rand() < 0.5 ? 2 : 1;
      for (let i = 0; i < units; i++) {
        const uw = b.w * (0.14 + rand() * 0.14);
        const ud = b.d * (0.14 + rand() * 0.14);
        const uh = 0.5 + rand() * 0.8;
        const ox = (rand() - 0.5) * (b.w - uw - 1.6);
        const oz = (rand() - 0.5) * (b.d - ud - 1.6);
        this.bodies.push(box(uw, uh, ud, b.cx + ox, top + uh / 2, b.cz + oz, body, 1.2));
        this.stats.details++;
      }
    }

    // mast + beacon for anything that can be seen over the arena
    if (b.h >= 7) {
      const mh = 1.8 + rand() * 1.8;
      this.bodies.push(box(0.16, mh, 0.16, b.cx, top + mh / 2, b.cz, 0x0d1622, 1.1));
      this.neon.push(box(0.3, 0.3, 0.3, b.cx, top + mh + 0.12, b.cz, edge, 2.2));
      this.stats.details++;
    }

    // windows on every face the map has not already painted
    const faces = [
      { axis: 'x', sign: 1, plane: b.cx + b.w / 2, ry: Math.PI / 2, span: b.d, along: 'z' },
      { axis: 'x', sign: -1, plane: b.cx - b.w / 2, ry: -Math.PI / 2, span: b.d, along: 'z' },
      { axis: 'z', sign: 1, plane: b.cz + b.d / 2, ry: 0, span: b.w, along: 'x' },
      { axis: 'z', sign: -1, plane: b.cz - b.d / 2, ry: Math.PI, span: b.w, along: 'x' },
    ];
    for (const f of faces) {
      if (this.painted(f, b)) continue;
      const cols = clamp(Math.floor((f.span - 1.4) / 2.5), 1, 8);
      const rows = clamp(Math.floor((b.h - 2.6) / 2.6), 1, 10);
      const cellW = f.span / cols;
      const cellH = (b.h - 2.2) / rows;
      const ww = Math.min(1.35, cellW * 0.52);
      const wh = Math.min(1.55, cellH * 0.5);
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          if (rand() < 0.14) continue;
          const off = (c + 0.5) * cellW - f.span / 2;
          const y = b.y + 1.9 + (r + 0.5) * cellH;
          if (y > top - 0.7) continue;
          const frontier = this.world.mapId === 'dustfall';
          const on = rand() < (frontier ? 0.38 : 0.52);
          // gaslight, not neon: the town's windows stay in the warm range
          const color = on ? (frontier || rand() < 0.5 ? WARM : COOL) : OFF;
          const gain = on ? (frontier ? 0.45 + rand() * 0.5 : 0.55 + rand() * 0.8) : 0.85;
          const x = f.axis === 'x' ? f.plane + f.sign * 0.05 : b.cx + off;
          const z = f.axis === 'z' ? f.plane + f.sign * 0.05 : b.cz + off;
          this.windows.push(quad(ww, wh, x, y, z, f.ry, color, gain));
          this.stats.windows++;
        }
      }
    }
  }

  // A painted face (dustfall's storefronts) already describes its own windows
  // and doors; adding a second grid on top of it would just read as noise.
  painted(f, b) {
    for (const face of this.world.faces) {
      if (face.y < b.y || face.y > b.y + b.h) continue;
      if (f.axis === 'x') {
        if (Math.abs(face.x - f.plane) > 0.9) continue;
        if (Math.abs(face.z - b.cz) > f.span / 2) continue;
      } else {
        if (Math.abs(face.z - f.plane) > 0.9) continue;
        if (Math.abs(face.x - b.cx) > f.span / 2) continue;
      }
      return true;
    }
    return false;
  }
}
