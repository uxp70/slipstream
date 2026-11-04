// On-screen touch controls: a floating thumbstick on the left, and action
// buttons on the right. Look is handled by dragging anywhere else on screen.
// Everything is routed through Input's virtual key / virtual mouse layer so the
// gameplay code does not need a mobile-specific path.
export class TouchControls {
  constructor(input, { onPause } = {}) {
    this.input = input;
    this.onPause = onPause;
    this.enabled = false;
    this.lookScale = 2.3;

    this.root = document.getElementById('touch-ui');
    this.stickZone = document.getElementById('stick-zone');
    this.stickBase = document.getElementById('stick-base');
    this.knob = document.getElementById('stick-knob');
    this.lookZone = document.getElementById('look-zone');

    this.stickPointer = null;
    this.stickCenter = { x: 0, y: 0 };
    this.lookPointer = null;
    this.lookLast = { x: 0, y: 0 };

    if (!this.root) return;

    this.bindStick();
    this.bindLook();
    this.bindHold('tb-fire', 'mouse', 0);
    this.bindHold('tb-aim', 'mouse', 2);
    this.bindHold('tb-jump', 'key', 'Space');
    this.bindPress('tb-dash', 'ShiftLeft');
    this.bindPress('tb-reload', 'KeyR');

    const pause = document.getElementById('tb-pause');
    if (pause) {
      pause.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (this.onPause) this.onPause();
      });
    }

    window.addEventListener('orientationchange', () => this.resetStick());
    window.addEventListener('resize', () => this.resetStick());
  }

  setVisibleClass(el, on) {
    if (el) el.classList.toggle('active', on);
  }

  // --------------------------------------------------------------- thumbstick
  bindStick() {
    const el = this.stickZone;
    if (!el) return;

    el.addEventListener('pointerdown', (e) => {
      if (!this.enabled || this.stickPointer !== null) return;
      e.preventDefault();
      e.stopPropagation();
      this.stickPointer = e.pointerId;
      el.setPointerCapture?.(e.pointerId);
      this.setVisibleClass(el, true);
      const r = this.stickBase.getBoundingClientRect();
      this.stickCenter = { x: r.left + r.width / 2, y: r.top + r.height / 2 };
      this.updateStick(e.clientX, e.clientY);
    });

    el.addEventListener('pointermove', (e) => {
      if (!this.enabled || e.pointerId !== this.stickPointer) return;
      e.preventDefault();
      this.updateStick(e.clientX, e.clientY);
    });

    const release = (e) => {
      if (e.pointerId !== this.stickPointer) return;
      this.stickPointer = null;
      this.setVisibleClass(el, false);
      this.input.touchMove.x = 0;
      this.input.touchMove.y = 0;
      this.centerKnob();
    };
    el.addEventListener('pointerup', release);
    el.addEventListener('pointercancel', release);
    el.addEventListener('lostpointercapture', release);
  }

  updateStick(x, y) {
    const max = 50;
    let dx = x - this.stickCenter.x;
    let dy = y - this.stickCenter.y;
    const len = Math.hypot(dx, dy);
    if (len > max) {
      dx = (dx / len) * max;
      dy = (dy / len) * max;
    }
    if (this.knob) this.knob.style.transform = `translate(-50%, -50%) translate(${dx}px, ${dy}px)`;

    let nx = dx / max;
    let ny = dy / max;
    const mag = Math.hypot(nx, ny);

    if (mag < 0.16) {
      this.input.touchMove.x = 0;
      this.input.touchMove.y = 0;
      return;
    }
    // remap past the deadzone so small pushes are slow, full pushes are fast
    const strength = Math.min(1, (mag - 0.16) / 0.74);
    this.input.touchMove.x = (nx / mag) * strength;
    this.input.touchMove.y = (-ny / mag) * strength;
  }

  centerKnob() {
    if (this.knob) this.knob.style.transform = 'translate(-50%, -50%)';
  }

  resetStick() {
    this.stickPointer = null;
    this.centerKnob();
    this.input.touchMove.x = 0;
    this.input.touchMove.y = 0;
    if (this.stickZone) this.setVisibleClass(this.stickZone, false);
  }

  // --------------------------------------------------------------------- look
  bindLook() {
    const el = this.lookZone;
    if (!el) return;

    el.addEventListener('pointerdown', (e) => {
      if (!this.enabled || this.lookPointer !== null) return;
      e.preventDefault();
      this.lookPointer = e.pointerId;
      this.lookLast.x = e.clientX;
      this.lookLast.y = e.clientY;
      el.setPointerCapture?.(e.pointerId);
    });

    el.addEventListener('pointermove', (e) => {
      if (!this.enabled || e.pointerId !== this.lookPointer) return;
      e.preventDefault();
      const dx = e.clientX - this.lookLast.x;
      const dy = e.clientY - this.lookLast.y;
      this.lookLast.x = e.clientX;
      this.lookLast.y = e.clientY;
      this.input.touchLook.dx += dx * this.lookScale;
      this.input.touchLook.dy += dy * this.lookScale;
    });

    const release = (e) => {
      if (e.pointerId !== this.lookPointer) return;
      this.lookPointer = null;
    };
    el.addEventListener('pointerup', release);
    el.addEventListener('pointercancel', release);
    el.addEventListener('lostpointercapture', release);
  }

  // ------------------------------------------------------------------ buttons
  bindHold(id, type, code) {
    const el = document.getElementById(id);
    if (!el) return;
    const set = (on) => {
      if (type === 'mouse') this.input.setVirtualMouse(code, on);
      else this.input.setVirtualKey(code, on);
      this.setVisibleClass(el, on);
    };
    el.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (!this.enabled) return;
      el.setPointerCapture?.(e.pointerId);
      set(true);
    });
    const release = (e) => {
      e.preventDefault();
      set(false);
    };
    el.addEventListener('pointerup', release);
    el.addEventListener('pointercancel', release);
    el.addEventListener('lostpointercapture', release);
    el.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  bindPress(id, code) {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (!this.enabled) return;
      this.input.pressVirtualKey(code);
      this.setVisibleClass(el, true);
    });
    const release = () => this.setVisibleClass(el, false);
    el.addEventListener('pointerup', release);
    el.addEventListener('pointercancel', release);
    el.addEventListener('lostpointercapture', release);
  }

  // -------------------------------------------------------------------- state
  show() {
    if (!this.root) return;
    this.enabled = true;
    this.root.classList.remove('hidden');
  }

  hide() {
    if (!this.root) return;
    this.enabled = false;
    this.root.classList.add('hidden');
    this.resetStick();
    this.lookPointer = null;
    this.input.clearVirtual();
    this.input.touchLook.dx = 0;
    this.input.touchLook.dy = 0;
    this.input.touchMove.x = 0;
    this.input.touchMove.y = 0;
  }
}
