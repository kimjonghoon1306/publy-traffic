const { chromium } = require('playwright');
(async () => {
  const outDir = '/tmp/publyrec9';
  const b = await chromium.launch();
  const ctx = await b.newContext({
    viewport: { width: 720, height: 1280 },
    recordVideo: { dir: outDir, size: { width: 720, height: 1280 } },
  });
  const pg = await ctx.newPage();
  await pg.goto('file:///Users/apple/Downloads/publy-BAP/public/intro-cinema.html', { waitUntil: 'load' });
  await pg.addStyleTag({ content: '.ctrls,.tap-hint{display:none!important}' });
  await pg.waitForTimeout(21000);
  await ctx.close();
  await b.close();
  console.log('done9x16');
})().catch(e => { console.error('ERR:', e.message); process.exit(1); });
