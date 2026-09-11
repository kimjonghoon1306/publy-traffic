import { chromium } from "playwright";

const STORE_PC = "https://smartstore.naver.com/01074323888/products/5251966721";
const UA_PC = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
const UA_M = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";

async function run(label, { headful, realchrome, mobile }) {
  const opts = { headless: !headful, args: ["--no-sandbox", "--disable-blink-features=AutomationControlled"] };
  if (realchrome) opts.channel = "chrome";
  let browser;
  try { browser = await chromium.launch(opts); }
  catch (e) { console.log(`[${label}] ❌launch: ${(e.message || "").slice(0, 60)}`); return; }
  const ctxOpts = mobile
    ? { userAgent: UA_M, viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 3, locale: "ko-KR" }
    : { userAgent: UA_PC, viewport: { width: 1280, height: 800 }, locale: "ko-KR" };
  const ctx = await browser.newContext(ctxOpts);
  await ctx.addInitScript(() => { Object.defineProperty(navigator, "webdriver", { get: () => undefined }); });
  const page = await ctx.newPage();
  let st = "?"; try { const r = await page.goto(STORE_PC, { waitUntil: "domcontentloaded", timeout: 40000 }); st = r ? r.status() : "no-resp"; } catch (e) { st = "err:" + (e.message || "").slice(0, 28); }
  await page.waitForTimeout(3500);
  const body = await page.evaluate(() => (document.body ? document.body.innerText : "")).catch(() => "");
  const title = await page.title().catch(() => "");
  const blocked = /현재 서비스 접속이 불가|비정상적인 접근|일시적으로 제한/.test(body);
  const hasBuy = /구매하기|장바구니|옵션/.test(body);
  console.log(`[${label}] HTTP=${st} blocked=${blocked ? "🚫YES" : "✅NO"} 상품마커=${hasBuy ? "🛒있음" : "없음"} len=${body.length} title="${title}"`);
  await browser.close();
}

(async () => {
  console.log("=== PC 도메인(smartstore.naver.com) 브라우저 접속 — 내 실IP ===");
  await run("1. headless + PC UA", { headful: false, realchrome: false, mobile: false });
  await run("2. headful 진짜크롬 + PC UA", { headful: true, realchrome: true, mobile: false });
  await run("3. headful 진짜크롬 + 모바일 UA", { headful: true, realchrome: true, mobile: true });
})();
