// The Lance's scoped view. It lives under the HUD and touch controls so the
// score, ammo and AIM/FIRE targets stay readable while the optic is up.
const SCOPE_CSS = `
#scope {
  position: fixed;
  inset: 0;
  z-index: 11;
  pointer-events: none;
  opacity: 0;
  visibility: hidden;
  background:
    radial-gradient(circle at 50% 50%,
      rgba(0, 0, 0, 0) 0 33.6vmin,
      rgba(2, 5, 10, 0.5) 34.2vmin,
      rgba(2, 4, 9, 0.96) 37.5vmin,
      #020409 52vmin);
  transition: opacity 0.08s linear;
}
#scope.on {
  opacity: 1;
  visibility: visible;
}
#scope .lens {
  position: absolute;
  left: 50%;
  top: 50%;
  width: 68vmin;
  height: 68vmin;
  transform: translate(-50%, -50%);
  border-radius: 50%;
  border: 1px solid rgba(99, 245, 255, 0.48);
  box-shadow:
    inset 0 0 80px rgba(0, 0, 0, 0.55),
    0 0 30px rgba(58, 210, 255, 0.14);
}
#scope .lens::before {
  content: '';
  position: absolute;
  inset: -9px;
  border-radius: 50%;
  border: 1px solid rgba(99, 245, 255, 0.16);
  box-shadow: 0 0 24px rgba(58, 210, 255, 0.12);
}
#scope .lens::after {
  content: '';
  position: absolute;
  inset: 0;
  border-radius: 50%;
  background: radial-gradient(circle, rgba(80, 225, 255, 0.035), transparent 62%);
}
#scope .line {
  position: absolute;
  background: rgba(190, 250, 255, 0.78);
  box-shadow: 0 0 7px rgba(82, 230, 255, 0.42);
}
#scope .line.h {
  top: calc(50% - 0.5px);
  width: 37%;
  height: 1px;
}
#scope .line.h.l {
  left: 8%;
}
#scope .line.h.r {
  left: 55%;
}
#scope .line.v {
  left: calc(50% - 0.5px);
  width: 1px;
  height: 37%;
}
#scope .line.v.t {
  top: 8%;
}
#scope .line.v.b {
  top: 55%;
}
#scope .dot {
  position: absolute;
  left: calc(50% - 2px);
  top: calc(50% - 2px);
  width: 4px;
  height: 4px;
  border-radius: 50%;
  background: #eaffff;
  box-shadow: 0 0 10px rgba(99, 245, 255, 0.9);
}
#scope .mil {
  position: absolute;
  left: 50%;
  height: 1px;
  transform: translateX(-50%);
  background: rgba(190, 250, 255, 0.58);
}
#scope .m1 {
  top: 59%;
  width: 3px;
}
#scope .m2 {
  top: 65%;
  width: 6px;
}
#scope .m3 {
  top: 71%;
  width: 9px;
}
#scope .kicker,
#scope .label {
  position: absolute;
  left: 50%;
  transform: translateX(-50%);
  white-space: nowrap;
  font-family: var(--mono, 'SFMono-Regular', monospace);
  text-transform: uppercase;
  text-shadow: 0 1px 8px rgba(0, 0, 0, 0.9);
}
#scope .kicker {
  top: 6.5%;
  color: rgba(170, 245, 255, 0.56);
  font-size: 8px;
  letter-spacing: 0.26em;
}
#scope .label {
  bottom: 6.5%;
  display: flex;
  align-items: baseline;
  gap: 11px;
  color: rgba(170, 245, 255, 0.68);
  font-size: 9px;
  letter-spacing: 0.16em;
}
#scope .label b {
  color: #e8ffff;
  font-size: 11px;
  letter-spacing: 0.12em;
}
#hud.scoped #crosshair {
  opacity: 0;
}
`;

export class ScopeOverlay {
  constructor() {
    if (!document.getElementById('scope-styles')) {
      const style = document.createElement('style');
      style.id = 'scope-styles';
      style.textContent = SCOPE_CSS;
      document.head.appendChild(style);
    }

    this.el = document.getElementById('scope');
    if (!this.el) {
      this.el = document.createElement('div');
      this.el.id = 'scope';
      this.el.setAttribute('aria-hidden', 'true');
      this.el.innerHTML = `
        <div class="lens">
          <span class="line h l"></span>
          <span class="line h r"></span>
          <span class="line v t"></span>
          <span class="line v b"></span>
          <span class="dot"></span>
          <span class="mil m1"></span>
          <span class="mil m2"></span>
          <span class="mil m3"></span>
          <span class="kicker">TARGET ACQUISITION</span>
          <span class="label"><b>LN-7 LANCE</b><span>PRECISION OPTIC</span></span>
        </div>`;
      document.body.appendChild(this.el);
    }

    this.on = false;
    this.set(false);
  }

  set(on) {
    const next = !!on;
    if (next === this.on) return;
    this.on = next;
    this.el.classList.toggle('on', next);
    this.el.setAttribute('aria-hidden', String(!next));
  }
}
