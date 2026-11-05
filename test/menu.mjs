import { chromium } from 'playwright';

// The hangar contract: a run starts from the start screen, a run ends on the
// report, and the report goes back to the hangar instead of straight into
// another run. Also covers the menu sound layer existing and being safe to call
// before a run, and the sticky primary action staying on screen while the
// configuration scrolls.
const URL = 'http://127.0.0.1:3000/';

const fails = [];
const check = (ok, label, extra = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${extra ? `  (${extra})` : ''}`);
  if (!ok) fails.push(label);
};

const browser = await chromium.launch({
  args: [
    '--use-gl=swiftshader',
    '--enable-unsafe-swiftshader',
    '--ignore-gpu-blocklist',
    '--autoplay-policy=no-user-gesture-required',
  ],
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
  const res = {};
  const visible = (id) => {
    const el = document.getElementById(id);
    return !!el && !el.classList.contains('hidden');
  };
  const hudOn = () => document.getElementById('hud').classList.contains('on');

  // ---- the hangar at boot
  res.startVisible = visible('screen-start');
  res.overHidden = !visible('screen-over');
  res.hudOff = !hudOn();
  res.state = g.state;
  res.cta = document.getElementById('btn-start').textContent.trim();
  res.context = document.getElementById('start-context').textContent;
  res.match = document.getElementById('match-summary').textContent;

  // the primary action is pinned: visible without scrolling to it
  const screen = document.getElementById('screen-start');
  screen.scrollTop = 0;
  const r0 = document.getElementById('btn-start').getBoundingClientRect();
  res.stickyAtTop = r0.top >= 0 && r0.bottom <= window.innerHeight + 1;
  screen.scrollTop = screen.scrollHeight;
  const r1 = document.getElementById('btn-start').getBoundingClientRect();
  res.stickyAtBottom = r1.top >= 0 && r1.bottom <= window.innerHeight + 1;
  screen.scrollTop = 0;

  // ---- a run starts from the hangar
  g.player.maxHealth = 4000;
  g.beginRun();
  await wait(300);
  res.playing = g.state;
  res.startHidden = !visible('screen-start');
  res.hudPlaying = hudOn();
  res.menuModePlaying = g.audio.menuMode === false;

  // ---- the run ends on the report (the death timer runs on the render loop,
  // which is slow under software GL, so wait for the state instead of a clock)
  const waitOver = async () => {
    const t0 = performance.now();
    while (g.state !== 'over' && performance.now() - t0 < 12000) await wait(100);
    return g.state;
  };
  g.startDeath();
  await waitOver();
  res.over = g.state;
  res.overVisible = visible('screen-over');
  res.overLabel = document.getElementById('btn-restart').textContent.trim();
  res.noRunItBack = !/RUN IT BACK/.test(document.body.innerHTML);

  // ---- the report goes home
  g.audio.init();
  await wait(60);
  res.audioReady = g.audio.ready === true;
  document.getElementById('btn-restart').click();
  await wait(250);
  res.backState = g.state;
  res.startBack = visible('screen-start');
  res.overBack = !visible('screen-over');
  res.hudBackOff = !hudOn();
  res.menuModeMenu = g.audio.menuMode === true;
  res.weaponsHidden = g.weapons.root ? !g.weapons.root.visible : true;
  res.contextBack = document.getElementById('start-context').textContent;

  // a stray click on the report must not start a run
  g.beginRun();
  await wait(150);
  g.startDeath();
  await waitOver();
  document.getElementById('screen-over').click();
  await wait(200);
  res.strayState = g.state;

  // ---- R on the report returns to the hangar too
  g.beginRun();
  await wait(150);
  g.startDeath();
  await waitOver();
  window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyR' }));
  await wait(200);
  res.rState = g.state;
  res.rStart = visible('screen-start');

  // ---- the sound layer exists and is safe to call
  res.audioApi = ['ui', 'uiHover', 'uiOpen', 'uiClose', 'uiConfirm', 'setMenu'].every(
    (k) => typeof g.audio[k] === 'function'
  );
  res.menuPad = !!g.audio.menuPad;
  try {
    g.audio.uiHover();
    g.audio.ui();
    g.audio.uiOpen();
    g.audio.uiClose();
    g.audio.uiConfirm();
    g.audio.setMenu(false);
    g.audio.setMenu(true);
    res.audioCalls = true;
  } catch (e) {
    res.audioCalls = String(e);
  }

  return res;
});

console.log('menu:', JSON.stringify(out));

check(out.startVisible && out.overHidden && out.hudOff, 'the game boots on the hangar');
check(out.cta === 'JACK IN', 'the hangar has one primary action', out.cta);
check(out.stickyAtTop && out.stickyAtBottom, 'the primary action stays pinned while the screen scrolls');
check(
  /·/.test(out.context) && /·/.test(out.match),
  'the bar and the MATCH divider name the selected match',
  `${out.context} | ${out.match}`
);
check(out.playing === 'playing' && out.startHidden && out.hudPlaying, 'JACK IN starts a run');
check(out.menuModePlaying, 'the hangar bed is silent during a run');
check(out.over === 'over' && out.overVisible, 'a run ends on the report', out.over);
check(out.overLabel === 'MAIN MENU', 'the report offers the main menu', out.overLabel);
check(out.noRunItBack, 'the replay button is gone');
check(out.backState === 'menu' && out.startBack && out.overBack, 'MAIN MENU returns to the hangar', out.backState);
check(out.hudBackOff && out.weaponsHidden, 'the HUD is off on the hangar');
check(out.menuModeMenu, 'the hangar bed returns with the hangar');
check(out.strayState === 'over', 'a stray click on the report starts nothing', out.strayState);
check(out.rState === 'menu' && out.rStart, 'R on the report returns to the hangar', out.rState);
check(out.audioApi && out.menuPad, 'the menu sound layer is wired');
check(out.audioCalls === true, 'menu cues are safe to call', String(out.audioCalls));

// a real pointer pass over the hangar must not throw while the audio is live
await page.hover('#btn-arsenal');
await page.hover('#btn-start');
await page.waitForTimeout(150);

check(errors.length === 0, 'no console errors', errors.slice(0, 2).join(' | '));

await browser.close();
console.log(fails.length ? `\nFAILED: ${fails.join(', ')}` : '\nALL MENU CHECKS PASSED');
process.exit(fails.length ? 1 : 0);
