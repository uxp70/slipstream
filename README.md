# Slipstream

A browser-based 3D arena shooter built around movement: Quake-style air control,
auto-bunnyhop, dashes, slides and jump pads, all wrapped in a neon arena with
fully procedural audio. Built with Three.js and Vite, playable with keyboard and
mouse or with touch controls on a phone.

**Play it:** https://uxp70.github.io/slipstream/

## Movement

The feel comes from Quake's movement model rather than "apply force while a key
is held":

- **Projection-limited acceleration** on the ground, so turning while moving
  re-projects your speed instead of resetting it.
- **Air strafing**: in air, only the component of velocity along the wish
direction is limited (Quake's `AirAccelerate`), which is what lets you gain
  speed by strafing in a circle. Gains taper near the speed cap so momentum
  stays controllable.
- **Auto-bunnyhop**: holding jump re-jumps on landing, and the jump is applied
  before ground friction so a hop never bleeds momentum.
- **Coyote time / jump buffering**: 100 ms of grace leaving a ledge, 130 ms of
  buffered jump input, plus jump-cut on release for short hops.
- **Dash** (1.65 s cooldown) along the wish direction, airborne or grounded,
  with a FOV kick and a trail burst.
- **Slide** to duck under fire, with its own lower friction.

Speed also drives the camera FOV, the roll, the wind layer and the crosshair, so
moving fast reads as fast.

## Sound

All audio is synthesized at runtime with the Web Audio API — no asset downloads.
Shots are layered (transient crack, body blast, sub thump, metallic tail) with
slight per-shot pitch variation; enemies are panned by their position relative to
the camera; wind and a low ambience bed respond to speed. A small procedural
convolution reverb is used as a send so shots sit in the arena.

## Mobile

Touch is a first-class input, not a shim:

- Left **thumbstick** with a deadzone remap and analog magnitude, so walking is
  slower than running.
- **Drag anywhere on the right** to look; look sensitivity is scaled for touch.
- **FIRE** (hold), **AIM**, **JUMP** (hold for bunnyhop), **DASH**, **RELOAD** and a
  **pause** tile. Buttons are separate hit targets, so multi-touch works.
- Touch input goes through the same virtual-input layer as the keyboard, so the
  movement and weapon code has no mobile-specific branches.
- Portrait widens the vertical FOV and moves the HUD to the top corners, with a
  rotate hint; short landscape screens get a compact start/pause layout.
- Mobile also drops MSAA, caps the pixel ratio and softens bloom.

## Controls

| Action | Keyboard | Touch |
| --- | --- | --- |
| Move | `WASD` | left stick |
| Look | mouse | drag right side |
| Fire | left mouse | FIRE |
| Aim | right mouse | AIM |
| Jump / bhop | `Space` (hold) | JUMP (hold) |
| Dash | `Shift` | DASH |
| Slide | `Ctrl` | — |
| Reload | `R` | RELOAD |
| Pause | `Esc` | pause tile |

## Run locally

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # production build into dist/
```

## Hosting

GitHub Pages, via the workflow in `.github/workflows/deploy.yml`: every push to
`main` builds with Vite and publishes `dist/`.

- Live site: https://uxp70.github.io/slipstream/
- `vite.config.js` sets `base: './'`, so the same build works at a repo subpath
  and at the domain root.

## Structure

| File | Role |
| --- | --- |
| `src/main.js` | Boot, loop, game state, DOM wiring, touch lifecycle |
| `src/player.js` | Movement, collision, camera, dash, slide |
| `src/input.js` | Keyboard/mouse plus the virtual input used by touch |
| `src/touch.js` | Thumbstick, look surface and on-screen buttons |
| `src/weapon.js` | Rifle: fire rate, spread, recoil, hitscan |
| `src/enemies.js` | Waves, AI steering, projectiles, pickups |
| `src/world.js` | Arena geometry, colliders, spawn points, jump pads |
| `src/effects.js` | Particles, tracers, rings, screen shake sources |
| `src/hud.js` | HUD updates, popups, hitmarkers, banners |
| `src/audio.js` | Procedural Web Audio engine |
| `src/style.css` | HUD, screens and the touch layout |

## Performance

Desktop renders at up to 1.5× device pixel ratio with MSAA; mobile caps the
pixel ratio at 1.35 and disables MSAA, which keeps phones at a stable frame rate
while the bloom pass stays on.

## Verification

- A Playwright touch-emulation pass (844×390 landscape and 390×844 portrait,
  plus a desktop regression run) checks stick movement, look deltas, firing,
  reload, jump, dash cooldown, pause/resume, portrait FOV and that no control
  overlaps another.
- `npm run build` completes and the Pages workflow publishes `dist/`.
