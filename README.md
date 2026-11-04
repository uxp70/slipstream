# Slipstream

A browser-based 3D arena shooter built around movement: Quake-style air control,
auto-bunnyhop, dashes, slides and jump pads, all wrapped in a neon arena with
fully procedural audio. Built with Three.js and Vite, playable with keyboard and
mouse or with touch controls on a phone.

**Play it:** https://uxp70.github.io/slipstream/

Pick one of three arenas on the start screen, then fight through waves with four
distinct weapons and an instant weapon switch.

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

## Arsenal

Four archetypes, each with its own magazine and reload behaviour, so they cover
different ranges instead of being upgrades of one another:

| Slot | Weapon | Role |
| --- | --- | --- |
| 1 | **VX-9 ARC RIFLE** | Hitscan automatic, 30-round mag, tight spread — the all-rounder |
| 2 | **BR-12 BREACHER** | 8-pellet hitscan shotgun, 6 shells, one-shot reload per shell, big close-range burst |
| 3 | **LN-7 LANCE** | Precision rail: single hitscan beam, 5-round mag, heavy damage at any range, slow cycle |
| 4 | **PR-4 HAVOC** | Splash rocket, 4 rockets, radius damage, self-knockback — the rocket-jump tool |

- Switching is instant (`1`–`4`, `Q`, mouse wheel, or tapping a strip slot on
  touch) and each weapon keeps its own ammo and reload state.
- The shotgun reloads shell by shell and can be interrupted by firing; the other
  three swap a whole clip.
- The launcher's splash damages enemies in a radius and pushes you, so a rocket
  under your feet is a legitimate movement option.

## Arenas

Three hand-built layouts on the same movement kit, chosen for different fight
shapes:

| Arena | Layout |
| --- | --- |
| **CIRCUIT** | Single wide atrium with a sunken centre and a ring of pillars — keeps fights at mid range and rewards the rifle |
| **SPIRE** | Vertical jungle gym: stacked platforms and pads over a deep shaft, for air-strafe duels and rail angles |
| **RIFT** | Long canyon with a raised span across the middle and hard cover walls, for spray control and rocket arcs |

Each arena brings its own collider set, spawn ring, fog colour and jump-pad
placement; the start screen shows a blurb for the selected map.

## Graphics quality

Three modes, switchable in-game and on the start screen:

- **AUTO** (default) samples the frame rate and adjusts: it lowers the render
  scale first, and only drops the bloom pass if resolution scaling is not enough.
  It climbs back up when there is headroom.
- **HIGH** keeps bloom, MSAA and the full pixel ratio.
- **FRAMES** drops bloom and pins the render scale low for the smoothest
  possible motion.

The static geometry of each arena is merged into three batched meshes (bodies,
edges and caps) with vertex colours and a single material, and each weapon
viewmodel is merged by material, which keeps the scene at roughly 20 draw calls
on desktop instead of one per prop.

## Sound

All audio is synthesized at runtime with the Web Audio API — no asset downloads.
Shots are layered (transient crack, body blast, sub thump, metallic tail) with
slight per-shot pitch variation and a per-weapon profile; the launcher adds a
dedicated explosion voice. Enemies are panned by their position relative to the
camera; wind and a low ambience bed respond to speed. A small procedural
convolution reverb is used as a send so shots sit in the arena.

## Mobile

Touch is a first-class input, not a shim:

- Left **thumbstick** with a deadzone remap and analog magnitude, so walking is
  slower than running.
- **Drag anywhere on the right** to look; look sensitivity is scaled for touch.
- **FIRE** (hold), **AIM**, **JUMP** (hold for bunnyhop), **DASH**, **RELOAD** and a
  **pause** tile. Buttons are separate hit targets, so multi-touch works.
- A **weapon strip**: a thumb-sized row at the bottom centre in landscape, and a
  right-hand column in portrait, kept clear of the fire cluster.
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
| Weapon 1–4 | `1`–`4` / wheel | tap strip slot |
| Next weapon | `Q` / wheel | tap strip slot |
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
| `src/main.js` | Boot, loop, game state, DOM wiring, map selection, adaptive quality |
| `src/player.js` | Movement, collision, camera, dash, slide |
| `src/input.js` | Keyboard/mouse plus the virtual input used by touch |
| `src/touch.js` | Thumbstick, look surface, on-screen buttons, weapon strip |
| `src/weapon.js` | The four weapons: fire modes, reloads, spread, projectiles |
| `src/weaponModels.js` | Viewmodels, muzzle flash, merged by material |
| `src/maps.js` | The three arena layouts |
| `src/world.js` | Collider set, merged geometry batches, spawns, jump pads |
| `src/enemies.js` | Waves, AI steering, projectiles, pickups, radius damage |
| `src/effects.js` | Particles, tracers, rings, screen shake sources |
| `src/hud.js` | HUD updates, weapon strip, map label, FPS readout, banners |
| `src/audio.js` | Procedural Web Audio engine |
| `src/style.css` | Base HUD and screens |
| `src/ui.css` | Weapon strip, map picker and quality controls |
| `src/touch.css` | Touch layout overrides and portrait handling |

## Performance

Desktop renders at up to 1.5× device pixel ratio with MSAA; mobile caps the
pixel ratio at 1.35 and disables MSAA. In AUTO the renderer samples the frame
time and moves between 0.7× and 1× of that scale, so a slow frame costs
resolution before it costs the bloom pass. The HUD shows live FPS, draw calls and
the active mode on the start screen.

## Verification

- `test/features.mjs`: map selection (three distinct layouts, pads, spawns,
  merged batches), weapon switching and per-weapon ammo, projectile and splash
  damage, FRAMES/AUTO quality behaviour, draw-call budget, and console error
  checks on desktop and touch.
- `test/mobile.mjs`: a Playwright touch-emulation pass (844×390 landscape and
  390×844 portrait, plus a desktop regression run) checks stick movement, look
  deltas, firing, reload, jump, dash cooldown, pause/resume, portrait FOV, weapon
  strip hit targets and that no control overlaps another.
- `npm run build` completes and the Pages workflow publishes `dist/`.
