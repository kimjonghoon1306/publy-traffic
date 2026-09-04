const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch();
  const pg = await b.newPage();
  const hits = [];
  pg.on('response', async r => {
    const u = r.url();
    if (u.includes('product_options')) {
      try { hits.push({ url: u, body: await r.text() }); } catch(e){}
    }
  });
  await pg.goto('https://app.yuanfnb.com/shop/product/5aaa0929-30da-409f-860a-b62deec472a9', { waitUntil: 'networkidle', timeout: 40000 });
  await pg.waitForTimeout(3000);
  console.log('=== product_options 요청 수:', hits.length);
  hits.forEach(h => { console.log('URL:', h.url); console.log('BODY:', h.body.slice(0, 1500)); });
  await b.close();
})().catch(e => { console.error('ERR:', e.message); process.exit(1); });
