const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch();
  const pg = await b.newPage({ viewport: { width: 1440, height: 810 }, deviceScaleFactor: 1 });
  await pg.goto('https://blogautopro.com', { waitUntil: 'domcontentloaded', timeout: 40000 });
  await pg.waitForTimeout(3500);
  await pg.screenshot({ path: __dirname + '/_bap1.png' });
  await pg.waitForTimeout(3500);
  await pg.screenshot({ path: __dirname + '/_bap2.png' });
  await b.close();
  console.log('bap shots done');
})().catch(e => { console.error('ERR:', e.message); process.exit(1); });
