import * as THREE from 'three';

// Teammate avatars. Guests never simulate each other's movement, so these are
// interpolated toward the last state packet the host relayed. Deliberately
// cheap: one icosahedron, one wire cage, one ring and a name sprite per player,
// so co-op costs a handful of draw calls no matter how many teammates join.
export const TEAM_COLORS = [0x63f5ff, 0xffc063, 0x9d7bff, 0x6bffa8, 0xff6b9d, 0x8dffcf];

export class RemotePlayers {
  // PvP targets sit at torso height so a ray aimed at the floating avatar is a
  // hit; co-op keeps the original ground-level marker. The body offset is only
  // visual, and the online hit volume uses the same number.
  constructor(scene, bodyOffset = 0) {
    this.scene = scene;
    this.map = new Map();
    this.time = 0;
    this.bodyOffset = bodyOffset;
  }

  get count() {
    return this.map.size;
  }

  makeAvatar(id, name, slot) {
    const color = TEAM_COLORS[slot % TEAM_COLORS.length];
    const group = new THREE.Group();

    const core = new THREE.Mesh(
      new THREE.IcosahedronGeometry(0.34, 0),
      new THREE.MeshStandardMaterial({
        color,
        emissive: color,
        emissiveIntensity: 1.5,
        roughness: 0.3,
        metalness: 0.5,
        flatShading: true,
      })
    );
    group.add(core);

    const cage = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.IcosahedronGeometry(0.56, 0)),
      new THREE.LineBasicMaterial({
        color,
        transparent: true,
        opacity: 0.5,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      })
    );
    group.add(cage);

    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(0.82, 0.022, 4, 36),
      new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: 0.7,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      })
    );
    ring.rotation.x = Math.PI / 2.4;
    group.add(ring);

    const label = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: labelTexture(name, color),
        transparent: true,
        depthWrite: false,
        depthTest: false,
      })
    );
    label.scale.set(1.9, 0.47, 1);
    label.position.y = 0.92;
    group.add(label);

    group.position.set(0, 1.2, 0);
    group.visible = false;
    this.scene.add(group);

    return {
      id,
      name,
      color,
      group,
      core,
      cage,
      ring,
      label,
      pos: new THREE.Vector3(0, 1.2, 0),
      target: new THREE.Vector3(0, 1.2, 0),
      vel: new THREE.Vector3(),
      health: 100,
      maxHealth: 100,
      weapon: 0,
      dead: false,
      spawnT: 0,
      phase: Math.random() * Math.PI * 2,
    };
  }

  ensure(id, name, slot) {
    let avatar = this.map.get(id);
    if (!avatar) {
      avatar = this.makeAvatar(id, name, slot);
      avatar.group.scale.setScalar(0.01);
      this.map.set(id, avatar);
    } else if (name && avatar.name !== name) {
      avatar.name = name;
      avatar.label.material.map?.dispose();
      avatar.label.material.map = labelTexture(name, avatar.color);
      avatar.label.material.needsUpdate = true;
    }
    return avatar;
  }

  setState(id, state) {
    const avatar = this.ensure(id, state.name, state.slot || 0);
    avatar.target.set(state.x, state.y + 0.1, state.z);
    avatar.health = state.health ?? avatar.health;
    avatar.maxHealth = state.maxHealth ?? avatar.maxHealth;
    avatar.weapon = state.weapon ?? avatar.weapon;
    avatar.dead = !!state.dead;
    if (!avatar.group.visible) {
      avatar.group.visible = true;
      avatar.pos.copy(avatar.target);
      avatar.group.position.copy(avatar.pos);
    }
    // a huge jump means a respawn or teleport: snap instead of skating there
    if (avatar.pos.distanceToSquared(avatar.target) > 24 * 24) {
      avatar.pos.copy(avatar.target);
      avatar.group.position.copy(avatar.pos);
    }
    return avatar;
  }

  remove(id) {
    const avatar = this.map.get(id);
    if (!avatar) return;
    this.scene.remove(avatar.group);
    avatar.core.geometry.dispose();
    avatar.core.material.dispose();
    avatar.cage.geometry.dispose();
    avatar.cage.material.dispose();
    avatar.ring.geometry.dispose();
    avatar.ring.material.dispose();
    avatar.label.material.map?.dispose();
    avatar.label.material.dispose();
    this.map.delete(id);
  }

  clear() {
    for (const id of [...this.map.keys()]) this.remove(id);
  }

  update(dt) {
    this.time += dt;
    for (const avatar of this.map.values()) {
      const before = avatar.pos.clone();
      avatar.pos.lerp(avatar.target, Math.min(1, dt * 13));
      avatar.vel.subVectors(avatar.pos, before).multiplyScalar(1 / Math.max(0.0001, dt));

      avatar.spawnT = Math.min(1, avatar.spawnT + dt * 4);
      const grow = avatar.dead ? 0.55 : easeOut(avatar.spawnT);
      avatar.group.scale.setScalar(grow);

      const bob = Math.sin(this.time * 2.2 + avatar.phase) * 0.07;
      avatar.group.position.set(avatar.pos.x, avatar.pos.y + this.bodyOffset + bob, avatar.pos.z);

      const speed = Math.hypot(avatar.vel.x, avatar.vel.z);
      if (speed > 0.6) {
        avatar.group.rotation.y = Math.atan2(avatar.vel.x, avatar.vel.z);
      }
      avatar.cage.rotation.y += dt * (1.1 + speed * 0.16);
      avatar.cage.rotation.x += dt * 0.6;
      avatar.ring.rotation.z += dt * (avatar.dead ? 0.7 : 2.1);
      avatar.ring.material.opacity = avatar.dead ? 0.25 : 0.55 + Math.min(0.35, speed * 0.02);

      const hurt = avatar.health / Math.max(1, avatar.maxHealth);
      avatar.core.material.emissiveIntensity = avatar.dead ? 0.35 : 1.1 + (1 - hurt) * 1.3;
      avatar.label.material.opacity = avatar.dead ? 0.35 : 1;
      avatar.label.visible = speed > -1;
    }
  }
}

function easeOut(t) {
  return 1 - Math.pow(1 - t, 3);
}

const labels = new Map();

// Name tags are tiny, cached, and one canvas each — cheap enough to rebuild on
// rename and never touched again during play.
function labelTexture(name, color) {
  const key = name + '|' + color;
  const cached = labels.get(key);
  if (cached) return cached;

  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 64;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, 256, 64);
  ctx.font = 'bold 30px ui-monospace, Menlo, Consolas, monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = 'rgba(4, 8, 14, 0.55)';
  ctx.fillRect(8, 12, 240, 40);
  ctx.fillStyle = '#' + color.toString(16).padStart(6, '0');
  ctx.fillText(String(name || 'RUNNER').slice(0, 10).toUpperCase(), 128, 33);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.minFilter = THREE.LinearFilter;
  labels.set(key, tex);
  return tex;
}
