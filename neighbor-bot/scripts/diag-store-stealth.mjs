import { chromium } from "patchright";

const HOST = "http://gw.dataimpulse.com:10000";
const UB = "6f4612398e929e09a365__cr.kr";
const PASS = "d62608f358fe9282";
const UA_M = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";
const MAIN = "https://m.smartstore.naver.com/main/products/5251966721";
const STOREID = "https://m.smartstore.naver.com/01074323888/products/5251966721";

function isBlocked(s) { return /현재 서비스 접속이 불가|비정상적인 접근|일시적으로 제한/.test(s); }

async function run(label, url, useProxy) {
  const sess = Math.random().toString(36).slice(2, 8);
  const opts = {
    channel: "chrome", headless: false,
    userAgent: UA_M, viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 3, locale: "ko-KR",
  };
  if (useProxy) opts.proxy = { server: HOST, username: `${UB};sessid.${sess};sessttl.10`, password: PASS };
  let ctx;
  try { ctx = await chromium.launchPersistentContext("", opts); }
  catch (e) { console.log(`[${label}] launch err: ${(e.message || "").slice(0, 70)}`); return; }
  const page = await ctx.newPage();
  let st = "?"; try { const r = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 }); st = r ? r.status() : "no-resp"; } catch (e) { st = "err:" + (e.message || "").slice(0, 25); }
  await page.waitForTimeout(4000);
  const body = await page.evaluate(() => document.body?.innerText || "").catch(() => "");
  const title = await page.title().catch(() => "");
  const hasBuy = /구매하기|장바구니|옵션|배송|찜|리뷰/.test(body);
  console.log(`[${label}] HTTP=${st} blocked=${isBlocked(body) ? "🚫YES" : "✅NO"} 상품마커=${hasBuy ? "🛒있음" : "없음"} len=${body.length} title="${title}"`);
  await ctx.close();
}

(async () => {
  console.log("=== patchright(안티디텍트) 스텔스 테스트 ===");
  await run("① main + 모바일프록시", MAIN, true);
  await run("② storeId경로 + 모바일프록시", STOREID, true);
  await run("③ main + 내 실IP", MAIN, false);
})();
