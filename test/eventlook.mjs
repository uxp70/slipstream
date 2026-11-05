import { chromium } from 'playwright';

// Event art direction: each event renders the level its own way. FRONTIER is a
// sunlit town of painted timber and tin, WHITEOUT is overcast ice, and NEON SIEGE
// keeps the original additive wireframe. The checks are about what the renderer
// is actually doing (blending modes, light and fog colours, ground texture,
// dressed facades) rather than about pixels.
const URL = 'http://127.0.0.1:3000/';
const ADDITIVE = 2;
const NORMAL = 1;

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
  const rgb = (hex) => [(hex >> 16) & 255, (hex >> 8) & 255, hex & 255];
  const res = {};

  const look = () => ({
    map: g.world.mapId,
    art: g.world.art ? g.world.mapId : '',
    ground: g.world.art.ground.texture,
    groundUuid: g.world.floorMat.map ? g.world.floorMat.map.uuid : '',
    stars: g.world.stars.visible,
    edgeBlend: g.world.edgeMat.blending,
    edgeOpacity: g.world.edgeMat.opacity,
    capBlend: g.world.capMat.blending,
    emissive: g.world.bodyMat.emissive.getHex(),
    bloom: g.bloom.strength,
    fog: g.scene.fog.color.getHex(),
    fogDensity: g.scene.fog.density,
    skyTop: g.world.sky.material.uniforms.top.value.getHex(),
    skyBottom: g.world.sky.material.uniforms.bottom.value.getHex(),
    key: g.world.lights.key.intensity,
    core: g.world.lights.core.intensity,
    signs: g.world.signs.length,
    tradeNames: Array.from(new Set(g.world.signs.map((s) => s.name))).sort(),
    faces: g.world.faces.length,
    colliders: g.world.colliders.length,
    // the brightest vertex in the merged body batch: neon bodies are dark and
    // only glow through their emissive, a painted town is lit timber
    bodyMax: (() => {
      const col = g.world.merged[0] && g.world.merged[0].getAttribute('color');
      if (!col) return 0;
      let max = 0;
      for (let i = 0; i < Math.min(col.count * 3, 3000); i += 3) max = Math.max(max, col.array[i]);
      return Math.round(max * 100) / 100;
    })(),
    calls: g.drawCalls,
  });

  res.neon = look();

  g.events.select('frontier');
  await wait(400);
  res.frontier = look();
  res.frontier.rgb = rgb(res.frontier.fog);
  res.frontier.sky = rgb(res.frontier.skyBottom);

  g.events.select('whiteout');
  await wait(400);
  res.whiteout = look();

  g.events.select('neon');
  await wait(400);
  res.back = look();
  return res;
});

console.log('look:', JSON.stringify(out));

const f = out.frontier;
check(f.map === 'dustfall', 'selecting FRONTIER builds the town', f.map);
check(f.stars === false, 'a daytime town has no starfield');
check(f.edgeBlend === NORMAL, 'the town drops the additive neon outlines', `blending=${f.edgeBlend}`);
check(f.capBlend === NORMAL, 'roof caps are solid, not glowing planes', `blending=${f.capBlend}`);
check(f.emissive === 0, 'town surfaces are lit, not self-lit', `emissive=${f.emissive}`);
check(f.bodyMax > 0.2, 'the town is painted in sunlit timber', `bodyMax=${f.bodyMax}`);
check(f.ground === 'dirt' && f.groundUuid !== out.neon.groundUuid, 'the street is dirt, not a neon grid');
check(f.rgb[0] > f.rgb[1] && f.rgb[1] > f.rgb[2], 'the air is warm dust haze', `rgb=${f.rgb}`);
check(f.sky[0] > f.sky[2] && out.neon.skyBottom % 0x100 !== f.sky[2], 'the sky is a dusty sunset');
check(f.bloom < 0.3, 'the town barely blooms', `strength=${f.bloom}`);
check(f.key > 2, 'a hard sun lights the street', `key=${f.key}`);
check(f.core === 0, 'no neon core light in the town', `core=${f.core}`);
check(f.signs >= 6, 'the storefronts are lettered', `signs=${f.signs}`);
check(f.tradeNames.includes('SALOON') && f.tradeNames.includes('MERCANTILE'), 'the boards name the trades', f.tradeNames.join('/'));
check(f.faces >= 6, 'windows and doors are painted on the facades', `faces=${f.faces}`);
check(f.colliders > 40, 'the town is still solid to walk in', `colliders=${f.colliders}`);

const w = out.whiteout;
check(w.map === 'glacier' && w.ground === 'snow', 'WHITEOUT freezes the ground', `${w.map}/${w.ground}`);
check(w.stars === false && w.edgeBlend === NORMAL, 'WHITEOUT is overcast, not neon');
check(w.faces === 0 && w.signs === 0, 'no frontier dressing leaks into the basin');

const b = out.back;
check(b.map === 'circuit', 'switching back returns to the neon arenas', b.map);
check(b.edgeBlend === ADDITIVE, 'neon outlines come back for the chrome kit', `blending=${b.edgeBlend}`);
check(b.capBlend === ADDITIVE && b.emissive !== 0, 'neon caps and self-lit surfaces come back');
check(b.stars === true, 'the night sky returns');
check(b.ground === 'grid', 'the grid floor returns', b.ground);
check(b.bloom > 0.3, 'neon bloom returns', `strength=${b.bloom}`);
check(b.faces === 0 && b.signs === 0, 'the town dressing is dropped with the town');

check(errors.length === 0, 'no console errors', errors.slice(0, 2).join(' | '));

await browser.close();
console.log(
  fails.length ? `\nFAILED: ${fails.join(', ')}` : '\nALL EVENT LOOK CHECKS PASSED'
);
process.exit(fails.length ? 1 : 0);
