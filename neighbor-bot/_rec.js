const { chromium } = require('playwright');
const path = require('path');
(async () => {
  const outDir = '/tmp/publyrec';
  const b = await chromium.launch();
  const ctx = await b.newContext({
    viewport: { width: 1280, height: 720 },
    recordVideo: { dir: outDir, size: { width: 1280, height: 720 } },
  });
  const pg = await ctx.newPage();
  await pg.goto('file:///Users/apple/Downloads/publy-BAP/public/intro-cinema.html', { waitUntil: 'load' });
  // 컨트롤 버튼/안내문 숨겨서 깔끔하게 녹화
  await pg.addStyleTag({ content: '.ctrls,.tap-hint{display:none!important}' });
  await pg.waitForTimeout(21000); // 영상 전체 길이
  await ctx.close(); // 비디오 저장 flush
  await b.close();
  console.log('REC_DIR:' + outDir);
})().catch(e => { console.error('ERR:', e.message); process.exit(1); });
