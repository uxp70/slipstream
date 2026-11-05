# Slipstream

A browser-based 3D arena shooter built around movement: Quake-style air control,
auto-bunnyhop, dashes, slides and jump pads, all wrapped in a neon arena with
fully procedural audio. Built with Three.js and Vite, playable with keyboard and
mouse or with touch controls on a phone, solo or in an online squad of up to four.

**Play it:** https://uxp70.github.io/slipstream/

Pick an event on the start screen — each one bundles its own arena, enemy skin and
gun skin — then fight through waves with four distinct weapons and an instant
weapon switch. Create a squad to bring up to three other players into the same
wave.

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

Five hand-built layouts on the same movement kit, chosen for different fight
shapes. The three NEON SIEGE arenas are always available; DUSTFALL and GLACIER
arrive with their events:

| Arena | Layout |
| --- | --- |
| **CIRCUIT** | Single wide atrium with a sunken centre and a ring of pillars — keeps fights at mid range and rewards the rifle |
| **SPIRE** | Vertical jungle gym: stacked platforms and pads over a deep shaft, for air-strafe duels and rail angles |
| **RIFT** | Long canyon with a raised span across the middle and hard cover walls, for spray control and rocket arcs |
| **DUSTFALL** | Frontier main street: two rows of false-front storefronts, boardwalks either side, wagons and a water tower |
| **GLACIER** | Frozen basin: four ice shelves at staggered heights around a frozen well, two high bridges and pale spires |

Each arena brings its own collider set, spawn ring, fog colour and jump-pad
placement; the start screen shows a blurb for the selected arena.

## Events

An event is a theme bundle: an arena list, an enemy skin and a gun skin. One pick
on the start screen swaps all three, so each event reads as a different fight
rather than a recoloured circuit.

| Event | Arena | Enemy skin | Gun skin |
| --- | --- | --- | --- |
| **NEON SIEGE** | CIRCUIT, SPIRE, RIFT | default shells | default chrome |
| **FRONTIER** (wild west) | DUSTFALL | brass and rust, angular shells — drifters become octahedra, sentries become crates | walnut and gunmetal with an ember glow |
| **WHITEOUT** (cryo) | GLACIER | pale ice blue, frosted shells, one faceted silhouette per type | brushed steel with an ice-blue glow |

- The arena decides the event: every arena belongs to exactly one event, so a
  co-op guest adopts the host's event from the map it joins and no extra message
  is needed in the squad protocol.
- Enemy skins override colour, emissive and silhouette only; health, speed,
  damage, fire range and score still come from the type and the difficulty tier,
  so an event never changes the balance.
- Gun skins recolour the four merged viewmodel materials (`body`, `dark`, `glow`,
  `accent`) in place. The original colours are remembered the first time a skin is
  applied, so switching back to NEON SIEGE restores the base kit exactly.
- The choice is remembered between sessions (`slipstream.event`), and the arena
  picker re-renders from the selected event, so a one-arena event shows one card.

## Inventory and loadout

The **ARSENAL** button on the start screen opens the inventory: the four guns
with their damage, cyclic rate, magazine and reload, the four carry slots, and
which slot a run starts holding.

- **Slots are the loadout.** Equipping a gun into an occupied slot swaps the two,
  so all four are always carried and no slot is ever empty — nothing downstream
  has to handle an empty hand.
- The number keys, the mouse wheel, `Q`, the touch strip and the HUD labels all
  address slots, so they follow the loadout without a second code path.
- **START WITH** picks which slot the run begins holding, which is a real choice
  against a first wave (a launcher start plays very differently from a rifle
  start).
- The loadout and the starting slot persist (`slipstream.loadout`,
  `slipstream.startslot`), and **reset** restores the default kit.
- The HUD strip stays static markup because touch binds to those buttons once, so
  the labels are patched in place instead of re-rendering the list.

## Coins and buffs

Kills and cleared waves pay **coins**, which are banked between sessions
(`slipstream.coins`). The **ARMORY** button on the start screen spends them on
buffs for the next run — and only the next run:

| Buff | Effect per stack | Stacks |
| --- | --- | --- |
| **OVERCLOCK ROUNDS** | +12% weapon damage | 3 |
| **REINFORCED PLATING** | +20 max integrity, and the bar starts full | 3 |
| **SCRAMBLE THRUSTERS** | −15% dash cooldown | 3 |
| **SALVAGE DRONE** | +25% coins from kills | 3 |

- Buying arms the stack; nothing is applied until the run starts, and the run
  that starts spends what was armed. Buying is therefore a plan for one fight,
  not a permanent upgrade.
- Each further stack of the same buff costs 60% more than the last, so three
  packs of rounds is a real commitment rather than the default purchase.
- A drifter pays about 15 coins, a sentry about 20, and a cleared wave pays
  `20 + 8 × wave`, so a decent run funds a buff or two.
- Buffs are personal. Damage is applied before a hit is reported, so a co-op
  guest sends its boosted number and the host applies it unchanged; integrity and
  dash are local to your own player. The host stays the only authority over the
  wave and the score.
- **DISARM ALL** clears the armed stacks without a refund, for when you would
  rather save the coins.

## Accounts

The **SIGN IN** button on the start screen opens the operator panel: a callsign
and a passcode, either created there or entered to come back to an existing one.

- The passcode is stored as a **PBKDF2-SHA-256 hash** with a per-account random
  salt (120k iterations, via WebCrypto), never as text.
- An account **owns the wallet, the loadout and the starting slot**, so those are
  per-operator rather than per-device. Signing out drops you back to the guest
  wallet; signing in brings yours back.
- The session lasts 30 days and restores at boot, so a returning player lands
  signed in.
- On the online side the account **is** your identity: the callsign fills the
  squad name and travels in the join handshake, so the roster shows the operator.
- Co-op kills pay the shooter: the host confirms what died and sends that kill's
  coins to the guest's account, which is why a guest's wallet still grows.
- This is device identity, not a cloud login — the game is static files with no
  server, so anyone with devtools can read or edit the local data. It is a real
  progression layer between sessions and operators on one device, and the seam a
  hosted provider would sit behind later.

## Difficulties

Three tiers, chosen on the start screen and remembered between sessions:

| Tier | Wave size | Hostiles | Wave-clear repair |
| --- | --- | --- | --- |
| **ROOKIE** | ~35% fewer | 0.8× health, 0.9× speed, 0.65× damage, slower shots | +25 integrity |
| **STANDARD** | baseline | 1× everything | +15 integrity |
| **OVERCLOCK** | ~45% more | 1.3× health, 1.1× speed, 1.45× damage, faster shots | +8 integrity |

The tiers only scale levers the wave already has — how many hostiles spawn per
wave, their health, speed, projectile and melee damage, and the gap between their
shots — so no enemy needs a second rule set and the arenas stay readable. Combo
and score rules are identical on every tier, so best scores are comparable, and
the HUD's arena label carries the tier while you play (`CIRCUIT · OVERCLOCK`).

In co-op the host's tier applies to the whole squad: it travels with the run
start, and a guest who presses a tier button is told the host decides.

## Squad co-op (online)

Up to four players fight the same wave together. The host presses **CREATE
SQUAD** on the start screen and gets a five-character code (or **COPY LINK**,
which puts the code in the URL hash so it is one tap to join). Everyone else
types the code, presses **JOIN SQUAD**, then **ENTER ARENA**.

- **Host authority.** The host's browser owns the enemy wave, damage and scoring
  for the whole squad. Guests simulate their own movement locally so aiming and
  strafing stay responsive at any ping, and report their hits; the host decides
  what dies and broadcasts the wave, the score and everyone's health.
- **Peer-to-peer.** There is no game server. The public PeerJS broker is used
  only to exchange WebRTC offers; after that every packet travels directly
  between browsers. That is what lets co-op run on plain static hosting.
- **Downed, not dead.** A downed player rebuilds after about 3.5 seconds at their
  team spawn instead of ending the run, and the squad only advances to the next
  wave when the host clears the current one.
- **Mid-run escape.** `LEAVE SQUAD` lives in the pause panel, because the start
  screen is hidden while a run is live.
- **Room codes** use 20 unambiguous characters (no `I`, `O`, `0` or `1`), and the
  transport retries if a code is already taken.

Both peers need WebRTC, which every current desktop and mobile browser supports;
a symmetric NAT or a restrictive corporate firewall can still block the direct
link. All players should be on the same client version, because the snapshot
protocol is not versioned.

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
| Leave squad | — | pause panel |

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
| `src/main.js` | Boot, loop, game state, DOM wiring, map, event and difficulty selection, adaptive quality |
| `src/player.js` | Movement, collision, camera, dash, slide |
| `src/input.js` | Keyboard/mouse plus the virtual input used by touch |
| `src/touch.js` | Thumbstick, look surface, on-screen buttons, weapon strip |
| `src/weapon.js` | The four weapons: fire modes, reloads, spread, projectiles |
| `src/weaponModels.js` | Viewmodels, muzzle flash, merged by material |
| `src/inventory.js` | Arsenal inventory: loadout slots, starting slot, persistence |
| `src/buffs.js` | Coin balance, the buff catalogue, and the armory screen |
| `src/account.js` | Local accounts, hashed passcodes, sessions and account-scoped storage |
| `src/maps.js` | The five arena layouts and the map registry |
| `src/events.js` | Event bundles (arena, enemy skin, gun skin), start-screen pickers, skin application |
| `src/world.js` | Collider set, merged geometry batches, spawns, jump pads |
| `src/difficulty.js` | Difficulty tiers and the levers each one scales |
| `src/enemies.js` | Waves, AI steering, projectiles, pickups, radius damage |
| `src/net.js` | PeerJS transport: room codes, hosting, dialling, packets |
| `src/remote.js` | Teammate avatars, interpolation and name tags |
| `src/squad.js` | Co-op orchestration: roles, roster, snapshots, respawns |
| `src/effects.js` | Particles, tracers, rings, screen shake sources |
| `src/hud.js` | HUD updates, weapon strip, map label, FPS readout, banners |
| `src/audio.js` | Procedural Web Audio engine |
| `src/style.css` | Base HUD and screens |
| `src/ui.css` | Weapon strip, event and map pickers, arsenal, armory, accounts, quality controls and squad panel |
| `src/touch.css` | Touch layout overrides and portrait handling |

## Performance

Desktop renders at up to 1.5× device pixel ratio with MSAA; mobile caps the
pixel ratio at 1.35 and disables MSAA. In AUTO the renderer samples the frame
time and moves between 0.7× and 1× of that scale, so a slow frame costs
resolution before it costs the bloom pass. The HUD shows live FPS, draw calls and
the active mode on the start screen.

## Verification

- `test/features.mjs`: map selection (three distinct layouts, pads, spawns,
  merged batches), events (one arena list per event, enemy palette and silhouette
  swaps, gun-skin colours, HUD label), the inventory (four guns and four slots,
  equipping into a slot changes what key 1 fires, starting slot, persistence and
  reset), accounts (create, hashed passcode, session restore, per-account wallet,
  a wrong passcode refused, and a host-confirmed guest kill paying that guest),
  the armory (coin balance, buying, stacking prices, a purchase the wallet cannot
  cover, and the buff effects the next run starts with), difficulty scaling (wave
  size, enemy health, damage, speed and the wave-clear repair), weapon switching
  and per-weapon ammo, projectile and splash damage, FRAMES/AUTO quality
  behaviour, draw-call budget, and console error checks on desktop and touch.
- `test/mobile.mjs`: a Playwright touch-emulation pass (844×390 landscape and
  390×844 portrait, plus a desktop regression run) checking stick movement, look
  deltas, firing, reload, jump, dash cooldown, pause/resume, portrait FOV, weapon
  strip hit targets and that no control overlaps another.
- `test/squad.mjs`: two headless clients through the real broker — one hosts,
  the other joins by code, and the test checks the handshake, teammate
  replication, shared waves and score, guest hit reporting and a clean leave with
  no console errors on either side.
- `npm run build` completes and the Pages workflow publishes `dist/`.
