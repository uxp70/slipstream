// Keyboard + mouse + touch input. Touch devices use the on-screen stick/buttons
// wired up by TouchControls, which feed virtual keys/mouse buttons and raw look
// deltas through the same interface as a mouse.
export class Input {
  constructor(canvas) {
    this.canvas = canvas;
    this.keys = new Set();
    this.edges = new Set();
    this.mouseButtons = new Set();
    this.mouseEdges = new Set();
    this.dx = 0;
    this.dy = 0;
    this.locked = false;
    // set when the browser refuses pointer lock (e.g. an embedded preview
    // iframe): mouse look still works from raw deltas, just without capture
    this.fallback = false;
    this.sensitivity = 0.0022;
    this.invertY = false;
    this.onLockChange = null;
    this.onLockError = null;

    // touch state (filled by TouchControls)
    this.touchMode = false;
    this.touchMove = { x: 0, y: 0 };
    this.touchLook = { dx: 0, dy: 0 };
    this.virtualKeys = new Set();
    this.virtualEdges = new Set();
    this.virtualMouse = new Set();
    this.virtualMouseEdges = new Set();

    window.addEventListener('keydown', (e) => {
      if (e.repeat) return;
      // keep the page from scrolling / tabbing while playing
      if (['Space', 'ControlLeft', 'ControlRight', 'ShiftLeft', 'Tab'].includes(e.code) && (this.locked || this.fallback)) {
        e.preventDefault();
      }
      this.keys.add(e.code);
      this.edges.add(e.code);
    });

    window.addEventListener('keyup', (e) => {
      this.keys.delete(e.code);
    });

    window.addEventListener('blur', () => {
      this.keys.clear();
      this.mouseButtons.clear();
      this.clearVirtual();
      this.touchMove.x = 0;
      this.touchMove.y = 0;
    });

    window.addEventListener('mousemove', (e) => {
      if (!this.locked && !this.fallback) return;
      this.dx += e.movementX || 0;
      this.dy += e.movementY || 0;
    });

    window.addEventListener('mousedown', (e) => {
      if (!this.locked && !this.fallback) return;
      this.mouseButtons.add(e.button);
      this.mouseEdges.add(e.button);
    });

    window.addEventListener('mouseup', (e) => {
      this.mouseButtons.delete(e.button);
    });

    window.addEventListener('contextmenu', (e) => {
      if (this.locked || this.fallback) e.preventDefault();
    });

    document.addEventListener('pointerlockerror', () => {
      if (this.onLockError) this.onLockError();
    });

    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === this.canvas;
      this.dx = 0;
      this.dy = 0;
      if (!this.locked) {
        this.mouseButtons.clear();
        this.keys.clear();
      }
      if (this.onLockChange) this.onLockChange(this.locked);
    });
  }

  down(code) {
    return this.keys.has(code) || this.virtualKeys.has(code);
  }

  pressed(code) {
    return this.edges.has(code) || this.virtualEdges.has(code);
  }

  mouse(button = 0) {
    return this.mouseButtons.has(button) || this.virtualMouse.has(button);
  }

  mousePressed(button = 0) {
    return this.mouseEdges.has(button) || this.virtualMouseEdges.has(button);
  }

  // Movement axes in local space: x = strafe (right positive), y = forward.
  // Keyboard is digital; the touch stick is analog and gets priority when used.
  moveAxis(out = { x: 0, y: 0 }) {
    let x = (this.down('KeyD') ? 1 : 0) - (this.down('KeyA') ? 1 : 0);
    let y = (this.down('KeyW') ? 1 : 0) - (this.down('KeyS') ? 1 : 0);
    if (this.touchMode) {
      x += this.touchMove.x;
      y += this.touchMove.y;
    }
    const len = Math.hypot(x, y);
    if (len > 1) {
      x /= len;
      y /= len;
    }
    out.x = x;
    out.y = y;
    return out;
  }

  consumeMouse() {
    const out = { dx: this.dx + this.touchLook.dx, dy: this.dy + this.touchLook.dy };
    this.dx = 0;
    this.dy = 0;
    this.touchLook.dx = 0;
    this.touchLook.dy = 0;
    return out;
  }

  endFrame() {
    this.edges.clear();
    this.mouseEdges.clear();
    this.virtualEdges.clear();
    this.virtualMouseEdges.clear();
  }

  // ------------------------------------------------------------- virtual input
  setVirtualKey(code, on) {
    if (on) {
      if (!this.virtualKeys.has(code)) this.virtualEdges.add(code);
      this.virtualKeys.add(code);
    } else {
      this.virtualKeys.delete(code);
    }
  }

  pressVirtualKey(code) {
    this.virtualEdges.add(code);
  }

  setVirtualMouse(button, on) {
    if (on) {
      if (!this.virtualMouse.has(button)) this.virtualMouseEdges.add(button);
      this.virtualMouse.add(button);
    } else {
      this.virtualMouse.delete(button);
    }
  }

  clearVirtual() {
    this.virtualKeys.clear();
    this.virtualMouse.clear();
  }

  lock() {
    try {
      const p = this.canvas.requestPointerLock?.();
      if (p && typeof p.catch === 'function') p.catch(() => {});
    } catch {
      if (this.onLockError) this.onLockError();
    }
  }

  get controlling() {
    return this.locked || this.fallback || this.touchMode;
  }

  unlock() {
    if (document.pointerLockElement) document.exitPointerLock();
  }
}
