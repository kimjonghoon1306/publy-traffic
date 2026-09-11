import { chromium } from "playwright";

const HOST = "http://gw.dataimpulse.com:10000";
const UB = "6f4612398e929e09a365__cr.kr";
const PASS = "d62608f358fe9282";
const UA_M = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";
const KEYWORD = "굴비가게";
const STORE_ID = "01074323888";

function isBlocked(s) { return /현재 서비스 접속이 불가|비정상적인 접근|일시적으로 제한/.test(s); }

async function run(useProxy) {
  const sess = Math.random().toString(36).slice(2, 8);
  const opts = { headless: false, channel: "chrome", args: ["--no-sandbox", "--disable-blink-features=AutomationControlled"] };
  if (useProxy) opts.proxy = { server: HOST, username: `${UB};sessid.${sess};sessttl.10`, password: PASS };
  let browser; try { browser = await chromium.launch(opts); } catch (e) { console.log("launch err", e.message); return; }
  const ctx = await browser.newContext({ userAgent: UA_M, viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 3, locale: "ko-KR" });
  await ctx.addInitScript(() => { Object.defineProperty(navigator, "webdriver", { get: () => undefined }); });
  const page = await ctx.newPage();
  console.log(`\n=== ${useProxy ? "모바일프록시" : "내 실IP"} — 검색→실클릭 경로 ===`);

  // 1) 모바일 통합검색
  let s1; try { const r = await page.goto(`https://m.search.naver.com/search.naver?query=${encodeURIComponent(KEYWORD)}`, { waitUntil: "domcontentloaded", timeout: 40000 }); s1 = r?.status(); } catch (e) { s1 = "err"; }
  await page.waitForTimeout(2500);
  const b1 = await page.evaluate(() => document.body?.innerText || "");
  console.log(`  [검색] HTTP=${s1} blocked=${isBlocked(b1) ? "🚫" : "✅"} len=${b1.length}`);

  // 2) 페이지에서 그 스토어 상품 링크 찾기
  const links = await page.$$eval("a[href]", (as, sid) => as.map(a => a.href).filter(h => h && (h.includes("smartstore.naver.com/" + sid) || h.includes("/rd?") || h.includes("cr.shopping.naver") || (h.includes("smartstore") && h.includes("/products/")))).slice(0, 8), STORE_ID).catch(() => []);
  console.log(`  발견 링크 ${links.length}개: ${links.slice(0, 3).map(l => l.slice(0, 55)).join(" | ")}`);

  if (!links.length) {
    // 링크 못 찾으면 쇼핑탭으로 재검색
    let s2; try { const r = await page.goto(`https://msearch.shopping.naver.com/search/all?query=${encodeURIComponent(KEYWORD)}`, { waitUntil: "domcontentloaded", timeout: 40000 }); s2 = r?.status(); } catch (e) { s2 = "err"; }
    await page.waitForTimeout(2500);
    const b2 = await page.evaluate(() => document.body?.innerText || "");
    console.log(`  [쇼핑탭] HTTP=${s2} blocked=${isBlocked(b2) ? "🚫" : "✅"} len=${b2.length}`);
    const links2 = await page.$$eval("a[href]", (as, sid) => as.map(a => a.href).filter(h => h && h.includes("smartstore") && h.includes(sid)).slice(0, 5), STORE_ID).catch(() => []);
    console.log(`  쇼핑탭 링크 ${links2.length}개: ${links2.slice(0, 2).map(l => l.slice(0, 60)).join(" | ")}`);
    links.push(...links2);
  }

  // 3) 첫 링크를 실제 goto(검색페이지 referer 유지)로 진입
  if (links.length) {
    let s3; try { const r = await page.goto(links[0], { waitUntil: "domcontentloaded", timeout: 40000, referer: "https://m.search.naver.com/" }); s3 = r?.status(); } catch (e) { s3 = "err:" + (e.message || "").slice(0, 25); }
    await page.waitForTimeout(3500);
    const b3 = await page.evaluate(() => document.body?.innerText || "");
    const title = await page.title().catch(() => "");
    const hasBuy = /구매하기|장바구니|옵션|배송/.test(b3);
    console.log(`  [상품 실클릭진입] HTTP=${s3} 최종URL=${page.url().slice(0, 60)}`);
    console.log(`     blocked=${isBlocked(b3) ? "🚫YES" : "✅NO"} 상품마커=${hasBuy ? "🛒있음" : "없음"} len=${b3.length} title="${title}"`);
  } else {
    console.log("  ❌ 검색결과에서 상품 링크를 못 찾음");
  }
  await browser.close();
}

(async () => {
  await run(true);   // 모바일 프록시
  await run(false);  // 내 실IP
})();
