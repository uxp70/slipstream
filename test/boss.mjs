import { chromium } from 'playwright';

// Boss waves: every fifth wave fields a warden, and the HUD carries its health
// bar for as long as it is alive. The bar follows the enemy rather than the wave
// number, so the same readout comes out of a solo host and out of a squad
// guest's mirrored snapshot.
const URL = 'http://127.0.0.1:3000/';
const fails = [];
const check = (ok, label, extra = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${extra ? `  (${extra})` : ''}`);
  if (!ok) fails.push(label);
};

const browser = await chromium.launch({
  args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
page.on('pageerror', (e) => errors.push(String(e)));

await page.goto(URL, { waitUntil: 'networkidle' });
await page.waitForFunction(() => !!window.__game, null, { timeout: 20000 });

const out = await page.evaluate(async () => {
  const g = window.__game;
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const bar = document.getElementById('boss-bar');
  const fill = document.getElementById('boss-fill');
  const res = {};

  // the bar is written by the running game, so the checks need a live run
  g.beginRun();
  g.player.maxHealth = 4000;
  g.player.health = 4000;
  await wait(250);

  g.startWave(4);
  await wait(350);
  res.wave4Boss = !!g.enemies.findBoss();
  res.wave4Bar = bar.classList.contains('on');
  res.wave4Count = g.enemies.remaining();

  g.startWave(5);
  await wait(700);
  const boss = g.enemies.findBoss();
  res.bossFound = !!boss;
  res.bossName = boss ? boss.cfg.name : '';
  res.bossRadius = boss ? boss.radius : 0;
  res.bossHp = boss ? Math.round(boss.maxHp) : 0;
  res.wave5Count = g.enemies.remaining();
  res.waveSub = document.getElementById('banner-sub').textContent;
  res.barOn = bar.classList.contains('on');
  res.barName = document.getElementById('boss-name').textContent;
  res.barPct = document.getElementById('boss-pct').textContent;
  res.barFull = parseFloat(fill.style.width);
  res.barTop = Math.round(bar.getBoundingClientRect().top);
  res.barVisible = getComputedStyle(bar).opacity;

  // half the hull reads as half a bar
  g.enemies.hit(boss, boss.maxHp * 0.5, boss.pos.clone(), false);
  await wait(220);
  res.halfW = parseFloat(fill.style.width);
  res.halfPct = document.getElementById('boss-pct').textContent;

  // under a third of the hull the bar turns hot
  g.enemies.hit(boss, boss.maxHp * 0.25, boss.pos.clone(), false);
  await wait(240);
  res.lowW = parseFloat(fill.style.width);
  res.hurt = bar.classList.contains('hurt');

  // killing it clears the bar through the real scoring path
  const beforeScore = g.score;
  const beforeCoins = g.armory.coins;
  g.handleHit({ enemy: boss, point: boss.pos.clone(), headshot: false, damage: boss.maxHp * 2 });
  await wait(320);
  res.barAfterKill = bar.classList.contains('on');
  res.scoreGain = g.score - beforeScore;
  res.coinGain = g.armory.coins - beforeCoins;

  // a guest never runs the AI, so its bar has to come from the host's rows
  g.enemies.applyMirror([[7777, 3, 0, 3.9, 0, 40, 0, 0]], []);
  await wait(260);
  const mirror = g.enemies.findBoss();
  res.mirrorBoss = !!mirror;
  res.mirrorPct = mirror ? Math.round((mirror.hp / mirror.maxHp) * 100) : 0;
  res.mirrorBar = bar.classList.contains('on');
  res.mirrorW = parseFloat(fill.style.width);
  res.mirrorName = document.getElementById('boss-name').textContent;

  // the next snapshot without it clears the bar again
  g.enemies.applyMirror([], []);
  await wait(260);
  res.barAfterMirror = bar.classList.contains('on');

  res.wave9 = g.enemies.waveIsBoss(9);
  res.wave10 = g.enemies.waveIsBoss(10);
  res.wave15 = g.enemies.waveIsBoss(15);
  return res;
});
console.log('boss:', JSON.stringify(out));

check(out.wave4Boss === false && out.wave4Bar === false, 'wave four is an ordinary wave');
check(
  out.bossFound && out.bossName === 'WARDEN',
  'every fifth wave fields the warden',
  `${out.bossName} hp=${out.bossHp}`
);
check(out.bossRadius > 2, 'the boss is built bigger than a sentry', `r=${out.bossRadius}`);
check(
  out.wave5Count < out.wave4Count,
  'the boss wave thins its escort to make room',
  `${out.wave5Count} vs ${out.wave4Count}`
);
check(out.waveSub === 'THE WARDEN WAKES', 'the wave banner calls out the boss', out.waveSub);
check(
  out.barOn && out.barName === 'WARDEN' && out.barPct === '100%',
  'the boss bar is visible with the warden at full hull',
  `${out.barName} ${out.barPct}`
);
check(
  out.barVisible === '1' && out.barFull === 100,
  'the bar is painted and full',
  `opacity=${out.barVisible} width=${out.barFull}%`
);
check(
  Math.abs(out.halfW - 50) < 6 && /^\d+%$/.test(out.halfPct),
  'damage shortens the bar',
  `${out.halfW}% / ${out.halfPct}`
);
check(
  out.hurt === true && Math.abs(out.lowW - 25) < 6,
  'a boss under a third of its hull turns the bar hot',
  `${out.lowW}%`
);
check(out.barAfterKill === false, 'killing the boss clears the bar');
check(
  out.scoreGain >= 1500 && out.coinGain > 0,
  'the boss pays score and coins',
  `+${out.scoreGain} pts +${out.coinGain} coins`
);
check(
  out.mirrorBoss && Math.abs(out.mirrorPct - 40) <= 2,
  'a guest mirrors the host boss with its health',
  `${out.mirrorPct}%`
);
check(
  out.mirrorBar && Math.abs(out.mirrorW - out.mirrorPct) < 6,
  'the guest bar follows the mirrored boss',
  `${out.mirrorW}%`
);
check(out.barAfterMirror === false, 'the bar clears when the host drops the boss');
check(
  out.wave9 === false && out.wave10 === true && out.wave15 === true,
  'the boss cadence is every fifth wave',
  `9=${out.wave9} 10=${out.wave10} 15=${out.wave15}`
);
check(errors.length === 0, 'no console errors', errors.slice(0, 2).join(' '));

await browser.close();
console.log(fails.length ? `\n${fails.length} FAILED` : '\nALL BOSS CHECKS PASSED');
process.exit(fails.length ? 1 : 0);
