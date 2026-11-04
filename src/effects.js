import * as THREE from 'three';

// Pooled particle / tracer / ring / decal effects. Everything is additive and
// bloom-friendly, and nothing allocates during combat.
const MAX_PARTICLES = 3000;

export class Effects {
  constructor(scene) {
    this.scene = scene;
    this.cursor = 0;
    this.time = 0;

    const geo = new THREE.BufferGeometry();
    this.pos = new Float32Array(MAX_PARTICLES * 3);
    this.col = new Float32Array(MAX_PARTICLES * 3);
    this.size = new Float32Array(MAX_PARTICLES);
    this.alpha = new Float32Array(MAX_PARTICLES);
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('aColor', new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('aAlpha', new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage));

    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: { uPR: { value: Math.min(2, window.devicePixelRatio || 1) } },
      vertexShader: /* glsl */ `
        attribute float aSize;
        attribute float aAlpha;
        attribute vec3 aColor;
        uniform float uPR;
        varying vec3 vColor;
        varying float vAlpha;
        void main() {
          vColor = aColor;
          vAlpha = aAlpha;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = aSize * uPR * (300.0 / max(0.2, -mv.z));
          gl_Position = projectionMatrix * mv;
        }
      `,
      fragmentShader: /* glsl */ `
        varying vec3 vColor;
        varying float vAlpha;
        void main() {
          float d = length(gl_PointCoord - vec2(0.5));
          float a = smoothstep(0.5, 0.03, d);
          if (a <= 0.002) discard;
          gl_FragColor = vec4(vColor, a * vAlpha);
        }
      `,
    });
    this.points = new THREE.Points(geo, mat);
    this.points.frustumCulled = false;
    scene.add(this.points);

    // particle state
    this.vel = new Float32Array(MAX_PARTICLES * 3);
    this.life = new Float32Array(MAX_PARTICLES);
    this.maxLife = new Float32Array(MAX_PARTICLES);
    this.baseSize = new Float32Array(MAX_PARTICLES);
    this.gravity = new Float32Array(MAX_PARTICLES);
    this.drag = new Float32Array(MAX_PARTICLES);
    this.baseCol = new Float32Array(MAX_PARTICLES * 3);

    this.ringPool = [];
    for (let i = 0; i < 18; i++) {
      const mesh = new THREE.Mesh(
        new THREE.RingGeometry(0.86, 1, 48),
        new THREE.MeshBasicMaterial({
          color: 0xffffff,
          transparent: true,
          opacity: 0,
          side: THREE.DoubleSide,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
        })
      );
      mesh.rotation.x = -Math.PI / 2;
      mesh.visible = false;
      scene.add(mesh);
      this.ringPool.push({ mesh, life: 0, maxLife: 0.5, grow: 6 });
    }
    this.ringCursor = 0;

    this.tracerPool = [];
    for (let i = 0; i < 26; i++) {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3).setUsage(THREE.DynamicDrawUsage));
      const line = new THREE.Line(
        g,
        new THREE.LineBasicMaterial({
          color: 0xffd88a,
          transparent: true,
          opacity: 0,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
        })
      );
      line.frustumCulled = false;
      line.visible = false;
      scene.add(line);
      this.tracerPool.push({ line, life: 0 });
    }
    this.tracerCursor = 0;

    this.spriteTex = makeGlowTexture();

    this.decalPool = [];
    for (let i = 0; i < 30; i++) {
      const mesh = new THREE.Mesh(
        new THREE.PlaneGeometry(1, 1),
        new THREE.MeshBasicMaterial({
          map: this.spriteTex,
          color: 0xffffff,
          transparent: true,
          opacity: 0,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
        })
      );
      mesh.visible = false;
      scene.add(mesh);
      this.decalPool.push({ mesh, life: 0 });
    }
    this.decalCursor = 0;

    this.flashPool = [];
    for (let i = 0; i < 10; i++) {
      const sprite = new THREE.Sprite(
        new THREE.SpriteMaterial({
          map: this.spriteTex,
          color: 0xffffff,
          transparent: true,
          opacity: 0,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
        })
      );
      sprite.visible = false;
      scene.add(sprite);
      this.flashPool.push({ sprite, life: 0, maxLife: 0.2, to: 6 });
    }
    this.flashCursor = 0;

    this._c = new THREE.Color();
  }

  spawn(x, y, z, vx, vy, vz, color, size, life, gravity = 0, drag = 1.5) {
    const i = this.cursor;
    this.cursor = (this.cursor + 1) % MAX_PARTICLES;
    const i3 = i * 3;
    this.pos[i3] = x;
    this.pos[i3 + 1] = y;
    this.pos[i3 + 2] = z;
    this.vel[i3] = vx;
    this.vel[i3 + 1] = vy;
    this.vel[i3 + 2] = vz;
    this._c.set(color);
    this.baseCol[i3] = this._c.r;
    this.baseCol[i3 + 1] = this._c.g;
    this.baseCol[i3 + 2] = this._c.b;
    this.col[i3] = this._c.r;
    this.col[i3 + 1] = this._c.g;
    this.col[i3 + 2] = this._c.b;
    this.size[i] = size;
    this.baseSize[i] = size;
    this.alpha[i] = 1;
    this.life[i] = life;
    this.maxLife[i] = life;
    this.gravity[i] = gravity;
    this.drag[i] = drag;
  }

  burst(point, color, count = 18, speed = 7, size = 0.16, life = 0.55, gravity = 8) {
    for (let i = 0; i < count; i++) {
      const v = randomDir();
      const s = speed * (0.35 + Math.random() * 0.9);
      this.spawn(
        point.x,
        point.y,
        point.z,
        v.x * s,
        v.y * s,
        v.z * s,
        Math.random() < 0.35 ? 0xffffff : color,
        size * (0.6 + Math.random() * 0.9),
        life * (0.6 + Math.random() * 0.8),
        gravity,
        2.2
      );
    }
  }

  sparks(point, normal, color = 0xffd88a, count = 9) {
    for (let i = 0; i < count; i++) {
      const v = randomDir();
      v.addScaledVector(normal, 0.9).normalize();
      const s = 3 + Math.random() * 9;
      this.spawn(
        point.x + normal.x * 0.05,
        point.y + normal.y * 0.05,
        point.z + normal.z * 0.05,
        v.x * s,
        v.y * s + 1.5,
        v.z * s,
        Math.random() < 0.4 ? 0xffffff : color,
        0.09 + Math.random() * 0.12,
        0.25 + Math.random() * 0.35,
        16,
        3
      );
    }
  }

  impact(point, normal, color = 0xffc063) {
    this.sparks(point, normal, color, 10);
    this.decal(point, normal, color);
    this.ring(point, color, 0.5, 0.34, 4);
  }

  explosion(point, color = 0xff4fd8) {
    this.burst(point, color, 60, 12, 0.26, 0.85, 7);
    this.burst(point, 0xffffff, 16, 7, 0.14, 0.4, 2);
    this.sparks(point, new THREE.Vector3(0, 1, 0), 0xffffff, 16);
    this.ring(point, color, 1.2, 0.55, 12);
    this.flash(point, color, 6, 0.22);
  }

  ring(point, color = 0x63f5ff, radius = 1, life = 0.5, grow = 8) {
    const r = this.ringPool[this.ringCursor];
    this.ringCursor = (this.ringCursor + 1) % this.ringPool.length;
    r.mesh.position.set(point.x, Math.max(0.03, point.y), point.z);
    r.mesh.visible = true;
    r.mesh.material.color.set(color);
    r.mesh.material.opacity = 0.95;
    r.mesh.scale.setScalar(radius);
    r.life = life;
    r.maxLife = life;
    r.grow = grow;
    r.radius = radius;
  }

  flash(point, color = 0xffffff, size = 4, life = 0.18) {
    const f = this.flashPool[this.flashCursor];
    this.flashCursor = (this.flashCursor + 1) % this.flashPool.length;
    f.sprite.position.copy(point);
    f.sprite.visible = true;
    f.sprite.material.color.set(color);
    f.sprite.material.opacity = 0.95;
    f.sprite.scale.setScalar(size * 0.4);
    f.life = life;
    f.maxLife = life;
    f.to = size;
  }

  decal(point, normal, color = 0xffc063) {
    const d = this.decalPool[this.decalCursor];
    this.decalCursor = (this.decalCursor + 1) % this.decalPool.length;
    d.mesh.position.copy(point).addScaledVector(normal, 0.02);
    d.mesh.lookAt(point.clone().add(normal));
    d.mesh.material.color.set(color);
    d.mesh.material.opacity = 0.85;
    d.mesh.scale.setScalar(0.5 + Math.random() * 0.25);
    d.mesh.visible = true;
    d.life = 2.6;
  }

  tracer(from, to, color = 0xffd88a) {
    const t = this.tracerPool[this.tracerCursor];
    this.tracerCursor = (this.tracerCursor + 1) % this.tracerPool.length;
    const arr = t.line.geometry.attributes.position.array;
    arr[0] = from.x;
    arr[1] = from.y;
    arr[2] = from.z;
    arr[3] = to.x;
    arr[4] = to.y;
    arr[5] = to.z;
    t.line.geometry.attributes.position.needsUpdate = true;
    t.line.material.color.set(color);
    t.line.material.opacity = 0.9;
    t.line.visible = true;
    t.life = 0.075;
  }

  dashTrail(position, forward, color = 0x63f5ff) {
    for (let i = 0; i < 22; i++) {
      const spread = 0.6;
      this.spawn(
        position.x + (Math.random() - 0.5) * 0.9,
        position.y + (Math.random() - 0.5) * 1.2,
        position.z + (Math.random() - 0.5) * 0.9,
        -forward.x * (5 + Math.random() * 7) + (Math.random() - 0.5) * spread,
        -forward.y * (5 + Math.random() * 7) + (Math.random() - 0.5) * spread,
        -forward.z * (5 + Math.random() * 7) + (Math.random() - 0.5) * spread,
        Math.random() < 0.3 ? 0xffffff : color,
        0.12 + Math.random() * 0.14,
        0.3 + Math.random() * 0.25,
        0,
        1.5
      );
    }
  }

  update(dt) {
    this.time += dt;
    const pos = this.pos;
    const vel = this.vel;
    for (let i = 0; i < MAX_PARTICLES; i++) {
      if (this.life[i] <= 0) {
        if (this.alpha[i] !== 0) {
          this.alpha[i] = 0;
          this.size[i] = 0;
        }
        continue;
      }
      this.life[i] -= dt;
      const i3 = i * 3;
      const d = Math.max(0, 1 - this.drag[i] * dt);
      vel[i3] *= d;
      vel[i3 + 1] = vel[i3 + 1] * d - this.gravity[i] * dt;
      vel[i3 + 2] *= d;
      pos[i3] += vel[i3] * dt;
      pos[i3 + 1] += vel[i3 + 1] * dt;
      pos[i3 + 2] += vel[i3 + 2] * dt;

      const t = Math.max(0, this.life[i] / this.maxLife[i]);
      this.alpha[i] = t * t;
      const flicker = 0.8 + Math.random() * 0.4;
      this.size[i] = this.baseSize[i] * (0.5 + t * 0.8) * flicker;
      // fade toward white-hot as it dies
      const bc = this.baseCol;
      this.col[i3] = bc[i3];
      this.col[i3 + 1] = bc[i3 + 1];
      this.col[i3 + 2] = bc[i3 + 2];
      if (this.life[i] <= 0) {
        this.alpha[i] = 0;
        this.size[i] = 0;
      }
    }

    const g = this.points.geometry;
    g.attributes.position.needsUpdate = true;
    g.attributes.aColor.needsUpdate = true;
    g.attributes.aSize.needsUpdate = true;
    g.attributes.aAlpha.needsUpdate = true;

    for (const r of this.ringPool) {
      if (r.life <= 0) {
        if (r.mesh.visible) r.mesh.visible = false;
        continue;
      }
      r.life -= dt;
      const t = Math.max(0, r.life / r.maxLife);
      r.mesh.scale.setScalar(r.radius + (1 - t) * r.grow);
      r.mesh.material.opacity = t * t * 0.9;
      if (r.life <= 0) r.mesh.visible = false;
    }

    for (const t of this.tracerPool) {
      if (t.life <= 0) continue;
      t.life -= dt;
      t.line.material.opacity = Math.max(0, t.life / 0.075) * 0.9;
      if (t.life <= 0) t.line.visible = false;
    }

    for (const d of this.decalPool) {
      if (d.life <= 0) continue;
      d.life -= dt;
      d.mesh.material.opacity = Math.min(0.85, d.life / 1.1);
      if (d.life <= 0) d.mesh.visible = false;
    }

    for (const f of this.flashPool) {
      if (f.life <= 0) continue;
      f.life -= dt;
      const t = Math.max(0, f.life / f.maxLife);
      f.sprite.scale.setScalar(f.to * (1.2 - t * 0.6));
      f.sprite.material.opacity = t * 0.95;
      if (f.life <= 0) f.sprite.visible = false;
    }
  }

  reset() {
    for (let i = 0; i < MAX_PARTICLES; i++) {
      this.life[i] = 0;
      this.alpha[i] = 0;
      this.size[i] = 0;
    }
    for (const r of this.ringPool) {
      r.life = 0;
      r.mesh.visible = false;
    }
    for (const t of this.tracerPool) {
      t.life = 0;
      t.line.visible = false;
    }
    for (const d of this.decalPool) {
      d.life = 0;
      d.mesh.visible = false;
    }
    for (const f of this.flashPool) {
      f.life = 0;
      f.sprite.visible = false;
    }
  }
}

function randomDir() {
  const u = Math.random() * 2 - 1;
  const phi = Math.random() * Math.PI * 2;
  const s = Math.sqrt(1 - u * u);
  return new THREE.Vector3(s * Math.cos(phi), u, s * Math.sin(phi));
}

function makeGlowTexture() {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  const grad = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.25, 'rgba(255,255,255,0.75)');
  grad.addColorStop(0.55, 'rgba(255,255,255,0.18)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
