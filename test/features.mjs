import { chromium } from 'playwright';

const URL = 'http://127.0.0.1:3000/';
const fails = [];
const check = (ok, label, extra = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${extra ? `  (${extra})` : ''}`);
  if (!ok) fails.push(label);
};

const browser = await chromium.launch({
  args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});

const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
const page = await ctx.newPage();
const errors = [];
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
page.on('pageerror', (e) => errors.push(String(e)));

await page.goto(URL, { waitUntil: 'networkidle' });
await page.waitForFunction(() => !!window.__game, null, { timeout: 20000 });

// ---------------------------------------------------------------- maps
const mapCount = await page.locator('[data-map]').count();
check(mapCount === 3, 'start screen offers 3 arenas', `cards=${mapCount}`);

const mapInfo = await page.evaluate(async () => {
  const g = window.__game;
  const out = {};
  for (const id of ['circuit', 'spire', 'rift']) {
    g.selectMap(id);
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    out[id] = {
      id: g.world.mapId,
      colliders: g.world.colliders.length,
      pads: g.world.pads.length,
      spawns: g.world.spawnPoints.length,
      bounds: g.world.bounds,
      merged: g.world.merged.length,
      start: [g.world.spawnAt.x, g.world.spawnAt.z],
      calls: g.drawCalls,
      // geometry signature: volumes + extents, so two arenas with the same
      // number of blocks still read as different layouts
      signature: g.world.colliders
        .map((c) => {
          const w = c.max.x - c.min.x;
          const h = c.max.y - c.min.y;
          const d = c.max.z - c.min.z;
          return `${w.toFixed(1)}x${h.toFixed(1)}x${d.toFixed(1)}@${c.min.y.toFixed(1)}`;
        })
        .sort()
        .join('|'),
    };
  }
  return out;
});

console.log('maps:', JSON.stringify(mapInfo));
check(
  new Set([mapInfo.circuit.signature, mapInfo.spire.signature, mapInfo.rift.signature]).size === 3,
  'each arena has a distinct layout'
);
check(
  mapInfo.spire.pads >= 4 && mapInfo.rift.pads >= 4 && mapInfo.circuit.pads >= 4,
  'every arena has jump pads',
  `${mapInfo.circuit.pads}/${mapInfo.spire.pads}/${mapInfo.rift.pads}`
);
check(
  mapInfo.circuit.start[1] !== mapInfo.spire.start[1] &&
    mapInfo.spire.start[1] !== mapInfo.rift.start[1],
  'each arena has its own spawn'
);
check(
  mapInfo.circuit.merged === 3 && mapInfo.spire.merged === 3 && mapInfo.rift.merged === 3,
  'static geometry is merged into 3 batches per arena',
  `merged=${mapInfo.circuit.merged}`
);

await page.evaluate(() => window.__game.selectMap('circuit'));
check(await page.evaluate(() => document.querySelector('[data-map="circuit"]').classList.contains('sel')), 'selected arena is highlighted');
check(
  (await page.evaluate(() => document.getElementById('map-blurb').textContent)).includes('SINGLE ATRIUM'),
  'map blurb updates with the selection'
);

// -------------------------------------------------------------- difficulty
const diffCount = await page.locator('[data-diff]').count();
check(diffCount === 3, 'start screen offers 3 difficulties', `buttons=${diffCount}`);

const diffInfo = await page.evaluate(() => {
  const g = window.__game;
  const out = {};
  for (const id of ['rookie', 'standard', 'overclock']) {
    g.setDifficulty(id);
    g.enemies.clear();
    g.enemies.spawnWave(4, g.player.pos);
    const queued = g.enemies.queue.length;
    for (const q of g.enemies.queue) q.t = 0;
    g.enemies.update(0.016, g.player, 1);
    // spawns land in reverse queue order, so compare a known type
    const e = g.enemies.list.find((x) => x.type === 'drifter') || g.enemies.list[0];
    out[id] = {
      queued,
      hp: e ? Math.round(e.hp) : 0,
      speed: e ? Number(e.speed.toFixed(2)) : 0,
      damage: e ? Number(e.damage.toFixed(1)) : 0,
      waveHeal: g.enemies.mods.waveHeal,
      sel: document.querySelector('[data-diff].sel')?.dataset.diff,
      label: document.getElementById('map-name').textContent,
    };
  }
  g.setDifficulty('standard');
  g.enemies.clear();
  return out;
});
console.log('difficulty:', JSON.stringify(diffInfo));
check(
  diffInfo.standard.queued > diffInfo.rookie.queued &&
    diffInfo.overclock.queued > diffInfo.standard.queued,
  'tier scales wave size',
  `${diffInfo.rookie.queued}/${diffInfo.standard.queued}/${diffInfo.overclock.queued}`
);
check(
  diffInfo.standard.hp > diffInfo.rookie.hp && diffInfo.overclock.hp > diffInfo.standard.hp,
  'tier scales enemy health',
  `${diffInfo.rookie.hp}/${diffInfo.standard.hp}/${diffInfo.overclock.hp}`
);
check(
  diffInfo.standard.damage > diffInfo.rookie.damage &&
    diffInfo.overclock.damage > diffInfo.standard.damage,
  'tier scales enemy damage',
  `${diffInfo.rookie.damage}/${diffInfo.standard.damage}/${diffInfo.overclock.damage}`
);
check(
  diffInfo.overclock.speed > diffInfo.rookie.speed,
  'tier scales enemy speed',
  `${diffInfo.rookie.speed}/${diffInfo.overclock.speed}`
);
check(
  diffInfo.overclock.waveHeal < diffInfo.rookie.waveHeal,
  'tier changes the wave-clear repair',
  `${diffInfo.rookie.waveHeal}/${diffInfo.overclock.waveHeal}`
);
check(
  diffInfo.standard.sel === 'standard' &&
    diffInfo.overclock.sel === 'overclock' &&
    diffInfo.overclock.label.includes('OVERCLOCK'),
  'selection and HUD label follow the tier',
  diffInfo.overclock.label
);

// ---------------------------------------------------------------- start run
await page.click('#btn-start');
await page.evaluate(() => document.dispatchEvent(new Event('pointerlockerror')));
await page.waitForTimeout(900);
check((await page.evaluate(() => window.__game.state)) === 'playing', 'run starts');

const slotCount = await page.locator('#weapon-strip .wslot').count();
check(slotCount === 4, 'HUD shows all four weapon slots', `slots=${slotCount}`);
check(
  (await page.locator('#weapon-strip .wslot.active').getAttribute('data-slot')) === '0',
  'rifle starts selected'
);

// ---------------------------------------------------------------- weapons
for (const [i, key, name] of [
  [1, 'Digit2', 'BR-12 BREACHER'],
  [2, 'Digit3', 'LN-7 LANCE'],
  [3, 'Digit4', 'PR-4 HAVOC'],
  [0, 'Digit1', 'VX-9 ARC RIFLE'],
]) {
  await page.keyboard.press(key);
  await page.waitForTimeout(120);
  const st = await page.evaluate(() => ({
    index: window.__game.weapons.index,
    tag: document.getElementById('reload-tag').textContent,
    active: document.querySelector('#weapon-strip .wslot.active')?.dataset.slot,
    visible: window.__game.weapons.models.map((m) => m.group.visible),
  }));
  check(
    st.index === i && st.tag === name && st.active === String(i),
    `switch to slot ${i + 1} (${name})`,
    `idx=${st.index} tag=${st.tag}`
  );
  check(
    st.visible.filter(Boolean).length === 1 && st.visible[i],
    `only the equipped weapon's viewmodel is drawn (slot ${i + 1})`
  );
}

// wheel + Q cycling
await page.mouse.wheel(0, 120);
await page.waitForTimeout(120);
check((await page.evaluate(() => window.__game.weapons.index)) === 1, 'mouse wheel cycles weapons');

// ---------------------------------------------------------------- firing
async function fireWith(index, holdMs = 500) {
  await page.keyboard.press(`Digit${index + 1}`);
  await page.waitForTimeout(120);
  const before = await page.evaluate(() => ({
    ammo: window.__game.weapons.ammo,
    shots: window.__game.shots,
  }));
  await page.mouse.down();
  await page.waitForTimeout(holdMs);
  await page.mouse.up();
  await page.waitForTimeout(150);
  const after = await page.evaluate(() => ({
    ammo: window.__game.weapons.ammo,
    shots: window.__game.shots,
    mag: window.__game.weapons.magSize,
  }));
  return { before, after };
}

for (const [i, label] of [
  [0, 'rifle'],
  [1, 'shotgun'],
  [2, 'rail'],
  [3, 'launcher'],
]) {
  const { before, after } = await fireWith(i, i === 2 ? 400 : 500);
  check(after.shots > before.shots, `${label} fires`, `shots ${before.shots}->${after.shots}`);
  check(after.ammo < before.ammo || after.ammo === after.mag, `${label} consumes ammo`, `${before.ammo}->${after.ammo}`);
}

// rocket projectile really exists and travels
await page.keyboard.press('Digit4');
await page.waitForTimeout(250);
await page.waitForFunction(() => window.__game.weapons.state.cooldown <= 0, null, { timeout: 5000 });
await page.mouse.down();
const flying = await page.evaluate(
  () =>
    new Promise((resolve) => {
      const g = window.__game;
      const t0 = performance.now();
      const tick = () => {
        const p = g.weapons.projectiles[0];
        if (p) return resolve({ count: g.weapons.projectiles.length, moving: p.vel.length() });
        if (performance.now() - t0 > 2000) {
          return resolve({ count: g.weapons.projectiles.length, moving: 0 });
        }
        requestAnimationFrame(tick);
      };
      tick();
    })
);
await page.mouse.up();
await page.waitForTimeout(1800);
const afterFlight = await page.evaluate(() => window.__game.weapons.projectiles.length);
check(flying.count > 0 && flying.moving > 10, 'launcher spawns a moving projectile', `speed=${flying.moving.toFixed(1)}`);
check(afterFlight < flying.count, 'projectile resolves (impact or timeout)', `${flying.count}->${afterFlight}`);

// splash damage reaches nearby enemies
const splash = await page.evaluate(() => {
  const g = window.__game;
  g.enemies.clear();
  g.enemies.spawn('drifter', g.player.pos);
  g.enemies.spawn('drifter', g.player.pos);
  const first = g.enemies.list[0];
  const point = first.pos.clone();
  const hits = g.enemies.damageRadius(point, 6, 60);
  const damage = hits.reduce((s, h) => s + h.damage, 0);
  return { enemies: g.enemies.list.length, hits: hits.length, damage };
});
check(splash.hits >= 1 && splash.damage > 0, 'explosive splash damages enemies in radius', JSON.stringify(splash));

// ---------------------------------------------------------------- perf
const perf = await page.evaluate(() => {
  const g = window.__game;
  g.applyQuality('performance');
  const perfState = {
    dpr: g.renderer.getPixelRatio(),
    bloom: g.bloom.enabled,
  };
  g.applyQuality('auto');
  g.setDprScale(0.7);
  const low = g.renderer.getPixelRatio();
  g.setDprScale(1);
  return {
    perfState,
    low,
    full: g.renderer.getPixelRatio(),
    fps: g.fps,
    calls: g.drawCalls,
    label: document.getElementById('quality-label').textContent,
    bloomOn: g.bloom.enabled,
  };
});
console.log('perf:', JSON.stringify(perf));
check(perf.perfState.bloom === false && perf.perfState.dpr < perf.full, 'FRAMES mode drops bloom and resolution');
check(perf.low < perf.full, 'adaptive scale lowers device pixel ratio', `${perf.low.toFixed(2)} < ${perf.full.toFixed(2)}`);
check(perf.bloomOn === true, 'AUTO restores bloom');
check(perf.calls > 0 && perf.calls < 60, 'scene draw calls stay low', `calls=${perf.calls}`);
check(Number(perf.label.length) > 0, 'quality label is rendered', perf.label);

// ---------------------------------------------------------------- touch strip
await page.close();
const touchCtx = await browser.newContext({
  viewport: { width: 844, height: 390 },
  hasTouch: true,
  isMobile: true,
  deviceScaleFactor: 2,
});
const tpage = await touchCtx.newPage();
const terr = [];
tpage.on('console', (m) => m.type() === 'error' && terr.push(m.text()));
tpage.on('pageerror', (e) => terr.push(String(e)));
await tpage.goto(URL, { waitUntil: 'networkidle' });
await tpage.waitForFunction(() => !!window.__game, null, { timeout: 20000 });
await tpage.tap('#btn-start');
await tpage.waitForTimeout(700);
check((await tpage.evaluate(() => window.__game.state)) === 'playing', 'touch run starts');

const slotBox = await tpage.evaluate(() => {
  const r = document.querySelector('#weapon-strip .wslot[data-slot="2"]').getBoundingClientRect();
  return { x: r.x + r.width / 2, y: r.y + r.height / 2, w: r.width, h: r.height, right: r.right, bottom: r.bottom };
});
check(slotBox.w >= 100 && slotBox.h >= 26, 'touch weapon slots are thumb sized', `${Math.round(slotBox.w)}x${Math.round(slotBox.h)}`);
await tpage.touchscreen.tap(slotBox.x, slotBox.y);
await tpage.waitForTimeout(200);
check((await tpage.evaluate(() => window.__game.weapons.index)) === 2, 'tapping the strip swaps to the railgun on touch');

const touchCalls = await tpage.evaluate(() => window.__game.drawCalls);
check(touchCalls > 0 && touchCalls < 80, 'touch scene draw calls stay low', `calls=${touchCalls}`);
await tpage.screenshot({ path: 'artifacts/weapons-touch.png' });

console.log('desktop errors:', errors.length ? errors : 'none');
console.log('touch errors:', terr.length ? terr : 'none');
check(errors.length === 0 && terr.length === 0, 'no console errors');

await browser.close();
console.log(fails.length ? `\n${fails.length} FAILED` : '\nALL FEATURE CHECKS PASSED');
process.exit(fails.length ? 1 : 0);
