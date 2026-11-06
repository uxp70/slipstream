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

// the strip is built from the drop list, so it exists before a run starts
const hud = await page.evaluate(() => {
  const strip = document.getElementById('consumables');
  return {
    chips: strip ? strip.querySelectorAll('[data-use]').length : 0,
    keys: strip ? [...strip.querySelectorAll('b')].map((b) => b.textContent) : [],
    counts: strip ? [...strip.querySelectorAll('[data-count]')].map((e) => e.textContent) : [],
  };
});
check(hud.chips === 3, 'drop strip has three slots', `chips=${hud.chips}`);
check(hud.keys.join('') === 'XCV', 'slots are bound to X / C / V', hud.keys.join(''));
check(hud.counts.join('') === '000', 'every slot starts empty', hud.counts.join(''));

// a real run, driven directly so pointer lock is not involved
await page.evaluate(() => window.__game.beginRun());
await page.waitForTimeout(400);

const cadence = await page.evaluate(() => {
  const c = window.__game.consumables;
  const out = {};
  out.wave4 = c.award(4);
  out.after4 = { ...c.counts };
  out.wave5 = c.award(5);
  out.after5 = { ...c.counts };
  out.wave10 = c.award(10);
  out.after10 = { ...c.counts };
  out.wave50 = c.award(50);
  out.after50 = { ...c.counts };
  return out;
});
check(cadence.wave4 === '' && cadence.after4.turret === 0, 'wave 4 pays nothing');
check(cadence.wave5 === 'TURRET' && cadence.after5.turret === 1, 'wave 5 pays a turret', cadence.wave5);
check(
  cadence.wave10 === 'TURRET · DRONE STRIKE' && cadence.after10.turret === 2 && cadence.after10.drone === 1,
  'wave 10 pays a turret and a drone',
  cadence.wave10
);
check(
  cadence.after50.turret === 3 && cadence.after50.drone === 2 && cadence.after50.nuke === 1,
  'wave 50 pays all three',
  JSON.stringify(cadence.after50)
);

const chips = await page.evaluate(() => {
  const strip = document.getElementById('consumables');
  return {
    counts: [...strip.querySelectorAll('[data-count]')].map((e) => e.textContent),
    ready: strip.querySelectorAll('.cslot.ready').length,
  };
});
check(chips.counts.join('/') === '3/2/1' && chips.ready === 3, 'HUD strip shows the counts', chips.counts.join('/'));

// ---------------------------------------------------------------- turret
const turret = await page.evaluate(() => {
  const g = window.__game;
  const c = g.consumables;
  c.counts = { turret: 1, drone: 0, nuke: 0 };
  c.paint();
  const used = c.use('turret');
  const s = c.sentries[0];
  // park a drifter in front of the post so aiming and firing both happen
  g.enemies.spawn('drifter', g.player.pos);
  const e = g.enemies.list[g.enemies.list.length - 1];
  e.pos.set(s.pos.x + 4, 2.0, s.pos.z);
  e.group.position.copy(e.pos);
  const startHp = e.hp;
  for (let i = 0; i < 60; i++) c.update(1 / 60);
  return {
    used,
    sentries: c.sentries.length,
    inScene: !!s.mesh.parent,
    startHp,
    hp: e.hp,
    dead: e.dead,
    left: c.counts.turret,
    length: c.sentries[0]?.life,
  };
});
check(turret.used && turret.sentries === 1 && turret.inScene, 'turret deploys into the scene');
check(turret.left === 0, 'deploying spends the turret');
check(turret.hp < turret.startHp, 'turret damages what it can see', `${turret.startHp} -> ${turret.hp}`);
check(turret.length > 0 && turret.length < 26, 'turret burns down its lifetime', String(turret.length?.toFixed(2)));

// ------------------------------------------------------------ drone strike
const drone = await page.evaluate(async () => {
  const g = window.__game;
  const c = g.consumables;
  c.counts = { turret: 0, drone: 1, nuke: 0 };
  c.paint();
  // aim straight at the floor ahead so the marker has a real landing point
  g.camera.lookAt(g.player.pos.x, 0, g.player.pos.z - 12);
  const used = c.use('drone');
  const strike = c.strikes[0];
  // the marker is torn down when the run ends, so read it before ticking
  const marked = !!(strike && strike.marker.parent);
  g.enemies.spawn('drifter', g.player.pos);
  const e = g.enemies.list[g.enemies.list.length - 1];
  e.pos.copy(strike.point).setY(1.8);
  e.group.position.copy(e.pos);
  const startHp = e.hp;
  for (let i = 0; i < 240; i++) c.update(1 / 60);
  return {
    used,
    marked,
    startHp,
    hp: e.hp,
    dead: e.dead,
    strikesLeft: c.strikes.length,
    left: c.counts.drone,
  };
});
check(drone.used && drone.marked, 'drone strike marks the ground');
check(drone.left === 0, 'calling the strike spends it');
check(drone.dead || drone.hp < drone.startHp, 'the pass damages what stands in it', `${drone.startHp} -> ${drone.hp}`);
check(drone.strikesLeft === 0, 'the marker clears itself after the run');

// -------------------------------------------------------------------- nuke
const nuke = await page.evaluate(() => {
  const g = window.__game;
  const c = g.consumables;
  c.counts = { turret: 0, drone: 0, nuke: 1 };
  c.paint();
  const used = c.use('nuke');
  const armed = !!c.nuke;
  for (let i = 0; i < 12; i++) g.enemies.spawn('drifter', g.player.pos);
  const before = g.enemies.list.filter((e) => !e.dead).length;
  for (let i = 0; i < 200; i++) c.update(1 / 60);
  const after = g.enemies.list.filter((e) => !e.dead).length;
  return { used, armed, before, after, left: c.counts.nuke, nuke: c.nuke };
});
check(nuke.used && nuke.armed, 'nuke arms a charge instead of firing instantly');
check(nuke.left === 0, 'arming the nuke spends it');
check(nuke.after < nuke.before, 'the blast clears the arena', `${nuke.before} -> ${nuke.after}`);
check(nuke.nuke === null, 'the charge resolves');

// ---------------------------------------------------- empty press and reset
const empty = await page.evaluate(() => {
  const g = window.__game;
  const c = g.consumables;
  c.counts = { turret: 0, drone: 0, nuke: 0 };
  c.paint();
  const before = c.sentries.length;
  return { used: c.use('turret'), before, after: c.sentries.length };
});
check(empty.used === false && empty.after === empty.before, 'an empty slot does nothing');

const keyPath = await page.evaluate(() => {
  const g = window.__game;
  const c = g.consumables;
  g.hud.hideOver();
  g.state = 'playing';
  c.counts = { turret: 1, drone: 0, nuke: 0 };
  c.paint();
  const before = c.sentries.length;
  window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyX' }));
  c.update(1 / 60);
  return { before, after: c.sentries.length, left: c.counts.turret };
});
check(keyPath.after === keyPath.before + 1 && keyPath.left === 0, 'X deploys the turret from the keyboard');

const reset = await page.evaluate(() => {
  const g = window.__game;
  const before = g.consumables.sentries.length + g.consumables.strikes.length;
  g.beginRun();
  const c = g.consumables;
  return {
    before,
    counts: { ...c.counts },
    sentries: c.sentries.length,
    strikes: c.strikes.length,
    nuke: c.nuke,
    hud: [...document.querySelectorAll('#consumables [data-count]')].map((e) => e.textContent).join(''),
  };
});
check(
  reset.before > 0 && reset.sentries === 0 && reset.strikes === 0 && reset.nuke === null,
  'a new match clears every drop and its actors',
  `cleared=${reset.before}`
);
check(reset.counts.turret === 0 && reset.counts.drone === 0 && reset.counts.nuke === 0, 'a new match starts with no drops');
check(reset.hud === '000', 'the strip empties with the match', reset.hud);

// the live loop must survive the new per-frame path
await page.waitForTimeout(900);
const running = await page.evaluate(() => ({
  state: window.__game.state,
  wave: window.__game.wave,
  scores: document.getElementById('score-num').textContent,
}));
check(running.state === 'playing' && running.wave >= 1, 'the run loop keeps ticking with drops armed', running.state);

check(errors.length === 0, 'no console errors', errors.slice(0, 3).join(' | '));

await browser.close();
console.log(fails.length ? `\nFAILED: ${fails.join(', ')}` : '\nALL CONSUMABLE CHECKS PASSED');
process.exit(fails.length ? 1 : 0);
