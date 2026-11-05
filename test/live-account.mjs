import { chromium } from 'playwright';

const URL = 'https://uxp70.github.io/slipstream/';
const fails = [];
const check = (ok, label, extra = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${extra ? `  (${extra})` : ''}`);
  if (!ok) fails.push(label);
};

const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
await page.goto(URL, { waitUntil: 'networkidle' });
await page.waitForFunction(() => !!window.__game, null, { timeout: 30000 });

const out = await page.evaluate(async () => {
  const g = window.__game;
  const r = {};
  localStorage.removeItem('slipstream.accounts');
  localStorage.removeItem('slipstream.session');
  g.accounts.list = [];
  g.accounts.current = null;

  document.getElementById('btn-account').click();
  r.opened = !document.getElementById('screen-login').classList.contains('hidden');
  g.accounts.setMode('create');
  document.getElementById('login-name').value = 'LIVEOP';
  document.getElementById('login-pass').value = 'hunter2000';
  await g.accounts.submit();
  r.label = document.getElementById('account-label').textContent;
  r.squad = g.squad.name;
  r.hashed = /^[A-Za-z0-9+/=]{40,}$/.test(g.accounts.list[0].hash);
  r.plain = JSON.stringify(g.accounts.list).includes('hunter2000');

  g.armory.coins = 640;
  g.armory.save();
  g.accounts.signOut();
  r.guestCoins = g.armory.coins;
  g.accounts.setMode('signin');
  document.getElementById('login-name').value = 'LIVEOP';
  document.getElementById('login-pass').value = 'wrongpass';
  await g.accounts.submit();
  r.bad = g.accounts.current;
  r.badText = document.getElementById('login-status').textContent;
  document.getElementById('login-pass').value = 'hunter2000';
  await g.accounts.submit();
  r.backCoins = g.armory.coins;
  r.backLabel = document.getElementById('account-label').textContent;
  return r;
});
console.log('live account:', JSON.stringify(out));
check(out.opened, 'sign-in screen opens on the deployed site');
check(out.label === 'LIVEOP' && out.backLabel === 'LIVEOP', 'creating an operator signs you in', out.label);
check(out.squad === 'LIVEOP', 'the operator callsign is the squad identity', out.squad);
check(out.hashed && !out.plain, 'the passcode is stored hashed on the live site');
check(out.bad === null && /WRONG PASSCODE/.test(out.badText), 'a wrong passcode is refused', out.badText);
check(out.backCoins === 640 && out.guestCoins !== 640, 'the wallet belongs to the operator', `back=${out.backCoins} guest=${out.guestCoins}`);
check(errors.length === 0, 'no console errors', errors.slice(0, 2).join(' '));

await browser.close();
console.log(fails.length ? `\n${fails.length} FAILED` : '\nALL LIVE ACCOUNT CHECKS PASSED');
process.exit(fails.length ? 1 : 0);
