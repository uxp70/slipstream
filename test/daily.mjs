import { chromium } from 'playwright';

// The daily supply drop, kept out of the main feature suite so each stays
// readable. Claims are evaluated against explicit timestamps, so a week of days
// fits in one run without waiting for a real midnight.
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

const daily = await page.evaluate(async () => {
  const g = window.__game;
  const out = {};
  const KEY = 'slipstream.daily';

  // claims are evaluated against an explicit timestamp, so the suite can walk a
  // week of days without waiting for a real midnight
  localStorage.removeItem(KEY);
  g.daily.reload();
  const base = new Date();
  base.setHours(12, 0, 0, 0);
  const at = (n) => {
    const d = new Date(base);
    d.setDate(base.getDate() + n);
    return d.getTime();
  };

  document.getElementById('btn-daily').click();
  out.visible = !document.getElementById('screen-daily').classList.contains('hidden');
  out.cards = document.querySelectorAll('[data-day]').length;

  const first = g.daily.plan(at(-9));
  out.firstDay = first.day;
  out.firstReward = first.reward.coins;

  g.armory.coins = 0;
  g.armory.save();
  g.armory.paint();

  const c1 = g.daily.claim(at(-9));
  out.claim1 = c1.coins;
  out.wallet1 = g.armory.coins;
  const twice = g.daily.claim(at(-9) + 60 * 60 * 1000);
  out.twiceOk = twice.ok;
  out.twiceReason = twice.reason;
  out.walletTwice = g.armory.coins;

  const c2 = g.daily.claim(at(-8));
  out.day2 = c2.day;
  out.streak2 = c2.streak;
  out.claim2 = c2.coins;

  for (let n = -7; n <= -3; n++) g.daily.claim(at(n));
  const wrap = g.daily.claim(at(-2));
  out.wrapDay = wrap.day;
  out.wrapStreak = wrap.streak;

  const afterGap = g.daily.plan(at(0));
  out.gapStreak = afterGap.streakNext;
  out.gapDay = afterGap.day;
  out.gapAvailable = afterGap.available;

  // a clock that went backwards must not pay twice
  const back = g.daily.claim(at(-3));
  out.backOk = back.ok;
  out.backReason = back.reason;
  out.backText = document.getElementById('daily-status').textContent;

  out.chip = document.getElementById('daily-label').textContent;
  out.claimText = document.getElementById('btn-daily-claim').textContent;
  out.guestCoins = g.armory.coins;
  g.daily.close();
  out.closed = document.getElementById('screen-daily').classList.contains('hidden');

  // the streak is the operator's, not the device's
  g.accounts.list = g.accounts.list.filter((a) => a.name !== 'SCOUT');
  g.accounts.setMode('create');
  document.getElementById('login-name').value = 'SCOUT';
  document.getElementById('login-pass').value = 'pass1234';
  await g.accounts.submit();
  out.signedIn = g.accounts.current?.name || '';
  out.accountWallet = g.armory.coins;
  out.accountFresh = g.daily.plan(at(0)).available;
  const accountClaim = g.daily.claim(at(-1));
  out.accountClaim = accountClaim.coins;
  out.accountAfter = g.armory.coins;
  g.accounts.signOut();
  out.guestBack = g.armory.coins;
  out.guestAvailable = g.daily.plan(at(0)).available;
  return out;
});
console.log('daily:', JSON.stringify(daily));
check(daily.visible && daily.closed, 'daily screen opens and closes from the start screen');
check(daily.cards === 7, 'the drop shows seven days', `cards=${daily.cards}`);
check(
  daily.firstDay === 1 && daily.firstReward === 40,
  'a fresh streak starts on day one',
  `day=${daily.firstDay} coins=${daily.firstReward}`
);
check(
  daily.claim1 === 40 && daily.wallet1 === 40,
  'claiming pays the day into the wallet',
  `+${daily.claim1}`
);
check(
  daily.twiceOk === false && daily.twiceReason === 'claimed' && daily.walletTwice === 40,
  'a second claim the same day is refused',
  daily.twiceReason
);
check(
  daily.day2 === 2 && daily.streak2 === 2 && daily.claim2 === 60,
  'the next day continues the streak and pays more',
  `day=${daily.day2} streak=${daily.streak2} +${daily.claim2}`
);
check(
  daily.wrapDay === 1 && daily.wrapStreak === 8,
  'the cycle wraps back to day one',
  `day=${daily.wrapDay} streak=${daily.wrapStreak}`
);
check(
  daily.gapStreak === 1 && daily.gapDay === 1 && daily.gapAvailable,
  'a missed day resets the streak',
  `next=${daily.gapStreak}`
);
check(
  daily.backOk === false && daily.backReason === 'clock' && /CLOCK IS BEHIND/.test(daily.backText),
  'a clock set backwards is refused',
  daily.backReason
);
check(
  daily.signedIn === 'SCOUT' && daily.accountFresh && daily.accountClaim === 40 && daily.accountAfter === 40,
  'a fresh operator starts their own streak',
  `${daily.signedIn} +${daily.accountClaim}`
);
check(
  daily.guestBack === daily.guestCoins && daily.guestAvailable,
  'signing out brings the guest streak back',
  `${daily.guestBack} vs ${daily.guestCoins}`
);
check(
  /READY/.test(daily.chip) && /40/.test(daily.claimText),
  'the start-screen chip shows the waiting drop',
  `${daily.chip}/${daily.claimText}`
);

const dailyUi = await page.evaluate(() => {
  const g = window.__game;
  const out = {};
  out.before = g.armory.coins;
  document.getElementById('btn-daily').click();
  out.opened = !document.getElementById('screen-daily').classList.contains('hidden');
  out.today = document.querySelectorAll('.daily-card.today').length;
  out.claimText = document.getElementById('btn-daily-claim').textContent;
  out.expected = g.daily.plan().reward.coins;
  document.getElementById('btn-daily-claim').click();
  out.paid = g.armory.coins - out.before;
  out.chip = document.getElementById('daily-label').textContent;
  out.disabled = document.getElementById('btn-daily-claim').disabled;
  out.panelCoins = document.getElementById('daily-coins').textContent;
  out.walletCoins = document.getElementById('coin-num').textContent;
  document.getElementById('btn-daily-back').click();
  out.closed = document.getElementById('screen-daily').classList.contains('hidden');
  return out;
});
console.log('daily ui:', JSON.stringify(dailyUi));
check(dailyUi.opened && dailyUi.closed, 'the drop opens from the start-screen button');
check(dailyUi.today === 1, 'exactly one day is framed as today', `today=${dailyUi.today}`);
check(
  dailyUi.paid === dailyUi.expected && dailyUi.paid === 40,
  'the claim button pays the day',
  `+${dailyUi.paid}`
);
check(dailyUi.disabled && /CLAIMED/.test(dailyUi.chip), 'the chip flips to claimed', dailyUi.chip);
check(
  dailyUi.panelCoins === dailyUi.walletCoins,
  'the panel and the wallet agree',
  `${dailyUi.panelCoins}/${dailyUi.walletCoins}`
);

check(errors.length === 0, 'no console errors', errors.slice(0, 2).join(' '));

await browser.close();
console.log(fails.length ? `\n${fails.length} FAILED` : '\nALL DAILY CHECKS PASSED');
process.exit(fails.length ? 1 : 0);
