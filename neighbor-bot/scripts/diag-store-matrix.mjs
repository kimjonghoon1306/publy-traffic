import { chromium } from "playwright";

const HOST = "http://gw.dataimpulse.com:10000";
const UB = "6f4612398e929e09a365__cr.kr";
const PASS = "d62608f358fe9282";
const UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";
const STORE = "https://m.smartstore.naver.com/01074323888/products/5251966721";

async function run(label, { headful, proxy, realchrome, warm }) {
  const sess = Math.random().toString(36).slice(2, 8);
  const opts = { headless: !headful, args: ["--no-sandbox", "--disable-blink-features=AutomationControlled"] };
  if (realchrome) opts.channel = "chrome";
  if (proxy) opts.proxy = { server: HOST, username: `${UB};sessid.${sess};sessttl.10`, password: PASS };
  let browser;
  try { browser = await chromium.launch(opts); }
  catch (e) { console.log(`[${label}] ❌launch실패: ${(e.message || "").slice(0, 70)}`); return; }
  const ctx = await browser.newContext({ userAgent: UA, viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 3, locale: "ko-KR" });
  await ctx.addInitScript(() => { Object.defineProperty(navigator, "webdriver", { get: () => undefined }); });
  const page = await ctx.newPage();
  let ip = "?"; try { const r = await page.request.get("http://ip-api.com/json/?fields=query,isp", { timeout: 12000 }); const j = await r.json(); ip = `${j.query}/${j.isp}`; } catch {}
  if (warm) { try { await page.goto("https://m.search.naver.com/search.naver?query=%EA%B5%B4%EB%B9%84%EA%B0%80%EA%B2%8C", { waitUntil: "domcontentloaded", timeout: 30000 }); await page.waitForTimeout(2500); } catch {} }
  let st = "?"; try { const r = await page.goto(STORE, { waitUntil: "domcontentloaded", timeout: 40000, referer: warm ? "https://m.search.naver.com/" : undefined }); st = r ? r.status() : "no-resp"; } catch (e) { st = "err:" + (e.message || "").slice(0, 28); }
  await page.waitForTimeout(3000);
  const body = await page.evaluate(() => (document.body ? document.body.innerText : "")).catch(() => "");
  const title = await page.title().catch(() => "");
  const blocked = /현재 서비스 접속이 불가|비정상적인 접근|일시적으로 제한/.test(body);
  console.log(`[${label}]`);
  console.log(`   ip=${ip} HTTP=${st} blocked=${blocked ? "🚫YES" : "✅NO"} len=${body.length} title="${title}"`);
  await browser.close();
}

(async () => {
  await run("1. headless + 모바일프록시 (오늘조건)", { headful: false, proxy: true, realchrome: false });
  await run("2. headful 진짜크롬 + 모바일프록시", { headful: true, proxy: true, realchrome: true });
  await run("3. headful 진짜크롬 + 내 실IP(프록시off)", { headful: true, proxy: false, realchrome: true });
  await run("4. headful 진짜크롬 + 내 실IP + 검색워밍업", { headful: true, proxy: false, realchrome: true, warm: true });
})();
