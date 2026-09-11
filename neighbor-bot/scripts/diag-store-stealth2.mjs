import { chromium } from "patchright";

const HOST = "http://gw.dataimpulse.com:10000";
const UB = "6f4612398e929e09a365__cr.kr";
const PASS = "d62608f358fe9282";
const UA_M = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";
const MAIN = "https://m.smartstore.naver.com/main/products/5251966721";
const KEYWORD = "굴비가게";
const STORE_ID = "01074323888";

function isBlocked(s) { return /현재 서비스 접속이 불가|비정상적인 접근|일시적으로 제한/.test(s); }
function isLogin(s, t) { return /NAVER 로그인|로그인이 필요/.test(t) || /로그인이 필요/.test(s); }

async function run(useProxy) {
  const sess = Math.random().toString(36).slice(2, 8);
  const opts = { channel: "chrome", headless: false, userAgent: UA_M, viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 3, locale: "ko-KR" };
  if (useProxy) opts.proxy = { server: HOST, username: `${UB};sessid.${sess};sessttl.10`, password: PASS };
  const ctx = await chromium.launchPersistentContext("", opts);
  const page = await ctx.newPage();
  console.log(`\n=== ${useProxy ? "모바일프록시" : "실IP"} — patchright 검색경유 쿠키워밍 ===`);

  // 1) 검색 (쿠키 워밍업)
  try { await page.goto(`https://m.search.naver.com/search.naver?query=${encodeURIComponent(KEYWORD)}`, { waitUntil: "domcontentloaded", timeout: 45000 }); } catch {}
  await page.waitForTimeout(3000);
  // 2) 쇼핑탭도 한번 (자연스러운 브라우징 + 쿠키 강화)
  try { await page.goto(`https://msearch.shopping.naver.com/search/all?query=${encodeURIComponent(KEYWORD)}`, { waitUntil: "domcontentloaded", timeout: 45000 }); } catch {}
  await page.waitForTimeout(2500);
  const cookies = await ctx.cookies();
  console.log(`  쿠키 ${cookies.length}개 확보`);

  // 3) 검색결과에서 실제 상품 링크 찾아 클릭(가능하면) — 없으면 main goto with referer
  let clicked = false;
  try {
    const link = await page.$(`a[href*="smartstore.naver.com/${STORE_ID}"], a[href*="/products/5251966721"], a[href*="inflow.pay.naver.com"]`);
    if (link) { await Promise.all([page.waitForNavigation({ timeout: 40000 }).catch(() => {}), link.click().catch(() => {})]); clicked = true; }
  } catch {}
  if (!clicked) {
    try { await page.goto(MAIN, { waitUntil: "domcontentloaded", timeout: 45000, referer: "https://m.search.naver.com/" }); } catch {}
  }
  await page.waitForTimeout(4000);

  const body = await page.evaluate(() => document.body?.innerText || "").catch(() => "");
  const title = await page.title().catch(() => "");
  const hasBuy = /구매하기|장바구니|옵션|배송|찜하기|리뷰/.test(body);
  console.log(`  진입방식=${clicked ? "실클릭" : "main+referer"} 최종URL=${page.url().slice(0, 55)}`);
  console.log(`  HTTP상태 blocked=${isBlocked(body) ? "🚫차단" : "✅통과"} 로그인벽=${isLogin(body, title) ? "🔒있음" : "✅없음"} 상품마커=${hasBuy ? "🛒있음!" : "없음"} len=${body.length} title="${title}"`);
  await ctx.close();
}

(async () => {
  await run(true);
  await run(false);
})();
