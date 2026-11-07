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
await page.waitForTimeout(400);

// ---------------------------------------------------------------- architecture
const arch = await page.evaluate(() => {
  const a = window.__game.architecture;
  return { stats: { ...a.stats }, meshes: a.meshes.length, decorHidden: window.__game.world.decorMeshes.every((m) => !m.visible) };
});
check(arch.stats.towers >= 20, 'skyline builds towers', `towers=${arch.stats.towers}`);
check(arch.stats.windows > 400, 'facades and towers get lit windows', `windows=${arch.stats.windows}`);
check(arch.stats.details > 10, 'roof plant, masts and beacons exist', `details=${arch.stats.details}`);
check(arch.meshes === 3, 'all dressing merges into three meshes', `meshes=${arch.meshes}`);
check(arch.decorHidden, 'the old flat decor boxes are hidden');

const maps = await page.evaluate(() => {
  const g = window.__game;
  const out = {};
  for (const id of ['dustfall', 'spire', 'rift', 'glacier']) {
    g.selectMap(id, true);
    out[id] = { ...g.architecture.stats, map: g.world.mapId };
  }
  g.selectMap('circuit', true);
  return out;
});
for (const [id, s] of Object.entries(maps)) {
  check(s.map === id && s.windows > 60, `map ${id} gets dressed`, `windows=${s.windows}`);
}

// ------------------------------------------------------------------- contracts
await page.evaluate(() => window.__game.beginRun());
await page.waitForTimeout(300);

const noContract = await page.evaluate(() => {
  const g = window.__game;
  return { wave: g.contracts.wave, anomaly: g.contracts.anomaly, pending: g.contracts.pending };
});
check(noContract.wave === 1 && noContract.anomaly === null && noContract.pending === null, 'wave 1 has no contract');

const surge = await page.evaluate(() => {
  const g = window.__game;
  const before = g.enemies.remaining();
  g.startWave(4);
  const c = g.contracts;
  return {
    id: c.anomaly && c.anomaly.id,
    mult: c.scoreMult(),
    before,
    after: g.enemies.remaining(),
    chip: document.getElementById('chip-anomaly').className,
    chipText: document.getElementById('chip-anomaly').textContent,
  };
});
check(surge.id === 'surge' && surge.mult === 1.25, 'wave 4 is a SURGE anomaly', `${surge.id} ×${surge.mult}`);
check(surge.after > surge.before, 'SURGE spawns extra enemies', `${surge.before} -> ${surge.after}`);
check(surge.chip.includes('on') && surge.chipText.includes('SURGE'), 'the anomaly chip reads SURGE', surge.chipText);

const blackout = await page.evaluate(() => {
  const g = window.__game;
  const base = g.scene.fog.density;
  const keyBase = g.world.lights.key.intensity;
  g.startWave(8);
  const dim = g.scene.fog.density;
  const keyDim = g.world.lights.key.intensity;
  const mult = g.contracts.scoreMult();
  g.contracts.clear();
  return { base, dim, keyBase, keyDim, mult, restored: g.scene.fog.density, keyRestored: g.world.lights.key.intensity };
});
check(blackout.mult === 1.35 && blackout.dim > blackout.base * 2, 'BLACKOUT closes the fog in', `${blackout.base} -> ${blackout.dim}`);
check(blackout.keyDim < blackout.keyBase * 0.5, 'BLACKOUT dims the key light', `${blackout.keyBase} -> ${blackout.keyDim}`);
check(
  Math.abs(blackout.restored - blackout.base) < 0.0001 && Math.abs(blackout.keyRestored - blackout.keyBase) < 0.01,
  'leaving the anomaly restores fog and lights',
);

const storm = await page.evaluate(() => {
  const g = window.__game;
  const c = g.contracts;
  g.startWave(12);
  const id = c.anomaly && c.anomaly.id;
  // drop a target on the next strike so the hit is deterministic
  c.strikeTimer = 0;
  c.update(1 / 60);
  const s = c.strikes[0];
  g.enemies.spawn('drifter', g.player.pos, { pos: s.point.clone().setY(1.8) });
  const e = g.enemies.list[g.enemies.list.length - 1];
  const hp = e.hp;
  c.update(0.9);
  return { id, strikes: c.strikes.length, hp, after: e.hp, dead: e.dead };
});
check(storm.id === 'storm', 'wave 12 is an ION STORM', storm.id);
check(storm.dead || storm.after < storm.hp, 'storm strikes damage what is standing in them', `${storm.hp} -> ${storm.after}`);
check(storm.strikes === 0, 'strikes resolve and clear themselves');

const bounty = await page.evaluate(() => {
  const g = window.__game;
  const c = g.contracts;
  g.startWave(3);
  g.enemies.list.forEach((e) => (e.dead = true));
  g.enemies.clear();
  g.enemies.spawn('drifter', g.player.pos);
  const baseHp = g.enemies.list[g.enemies.list.length - 1].hp;
  c.pending = { wave: 3, reward: 'drone' };
  c.bounty = null;
  c.update(1 / 60);
  const b = c.bounty;
  const marked = b ? b.enemy.bounty : false;
  const boosted = b ? b.enemy.maxHp : 0;
  const ratio = baseHp > 0 ? boosted / baseHp : 0;
  const marker = !!(c.marker && c.marker.group.parent);
  const coins = g.armory.coins;
  const charges = g.consumables.counts.drone;
  if (b) g.enemies.hit(b.enemy, 1e6, b.enemy.pos.clone(), false);
  c.update(1 / 60);
  return {
    has: !!b,
    marked,
    boosted,
    ratio,
    marker,
    claimed: c.bounty === null,
    coinGain: g.armory.coins - coins,
    chargeGain: g.consumables.counts.drone - charges,
    chip: document.getElementById('chip-bounty').className,
  };
});
check(bounty.has && bounty.marked && bounty.ratio > 1.5, 'a bounty marks and toughens one enemy', `hp=${Math.round(bounty.boosted)}`);
check(bounty.marker, 'the bounty carries a marker in the world');
check(bounty.claimed && bounty.coinGain > 0, 'killing the bounty pays coins', `+${bounty.coinGain}`);
check(bounty.chargeGain === 1, 'an odd-wave bounty also pays a drop charge', `+${bounty.chargeGain}`);
check(bounty.chip.trim() === 'cchip bounty', 'the bounty chip clears after the claim', bounty.chip);

const end = await page.evaluate(() => {
  const g = window.__game;
  g.startWave(6);
  g.contracts.enter(4);
  const during = g.contracts.anomaly.id;
  g.startDeath();
  return { during, after: g.contracts.anomaly, chip: document.getElementById('chip-anomaly').className };
});
check(end.during === 'surge' && end.after === null, 'dying clears the active anomaly');
check(end.chip.trim() === 'cchip', 'the anomaly chip hides on death', end.chip);

check(errors.length === 0, 'no console errors', errors.slice(0, 3).join(' | '));

await browser.close();
console.log(fails.length ? `\nFAILED: ${fails.join(', ')}` : '\nALL CONTRACT CHECKS PASSED');
process.exit(fails.length ? 1 : 0);
