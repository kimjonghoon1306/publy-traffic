import { chromium } from "playwright";

const HOST = "http://gw.dataimpulse.com:10000";
const UB = "6f4612398e929e09a365__cr.kr";
const PASS = "d62608f358fe9282";
const UA_M = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";
// ★ /main/products/{번호} 형식 (스토어ID 경로 대신)
const MAIN = "https://m.smartstore.naver.com/main/products/5251966721";
const OLD = "https://m.smartstore.naver.com/01074323888/products/5251966721";

function isBlocked(s) { return /현재 서비스 접속이 불가|비정상적인 접근|일시적으로 제한/.test(s); }

async function run(label, url, { headful, proxy }) {
  const sess = Math.random().toString(36).slice(2, 8);
  const opts = { headless: !headful, args: ["--no-sandbox", "--disable-blink-features=AutomationControlled"] };
  if (headful) opts.channel = "chrome";
  if (proxy) opts.proxy = { server: HOST, username: `${UB};sessid.${sess};sessttl.10`, password: PASS };
  let browser; try { browser = await chromium.launch(opts); } catch (e) { console.log(`[${label}] launch err ${e.message.slice(0,40)}`); return; }
  const ctx = await browser.newContext({ userAgent: UA_M, viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 3, locale: "ko-KR" });
  await ctx.addInitScript(() => { Object.defineProperty(navigator, "webdriver", { get: () => undefined }); });
  const page = await ctx.newPage();
  let st = "?"; try { const r = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 40000 }); st = r ? r.status() : "no-resp"; } catch (e) { st = "err:" + (e.message || "").slice(0, 25); }
  await page.waitForTimeout(3500);
  const body = await page.evaluate(() => document.body?.innerText || "").catch(() => "");
  const title = await page.title().catch(() => "");
  const hasBuy = /구매하기|장바구니|옵션|배송|찜|리뷰/.test(body);
  console.log(`[${label}] HTTP=${st} blocked=${isBlocked(body) ? "🚫YES" : "✅NO"} 상품마커=${hasBuy ? "🛒있음" : "없음"} len=${body.length} title="${title}" url=${page.url().slice(0,55)}`);
  await browser.close();
}

(async () => {
  console.log("=== 대조: 옛 스토어ID 경로 (봇이 쓰던 것) ===");
  await run("옛경로 headless+프록시", OLD, { headful: false, proxy: true });
  console.log("\n=== ★ 새 /main/products/ 경로 ===");
  await run("main headless+프록시", MAIN, { headful: false, proxy: true });
  await run("main headful실크롬+프록시", MAIN, { headful: true, proxy: true });
})();
