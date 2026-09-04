const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch();
  const pg = await b.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 2 });
  await pg.goto('file://' + __dirname + '/public/publy-intro.html', { waitUntil: 'networkidle' });
  const pts = [2400, 4800, 9200, 10800];
  let prev = 0;
  for (const t of pts) { await pg.waitForTimeout(t - prev); prev = t; await pg.screenshot({ path: __dirname + `/_intro_${t}.png` }); }
  await b.close();
  console.log('shots done');
})().catch(e => { console.error('ERR:', e.message); process.exit(1); });
