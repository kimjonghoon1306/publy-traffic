import { chromium } from "playwright";

const HOST = "http://gw.dataimpulse.com:10000";
const USER_BASE = "6f4612398e929e09a365__cr.kr";
const PASS = "d62608f358fe9282";
const UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";
const URL = "https://smartstore.naver.com/01074323888/products/5251966721"; // 테리 실제 대상

const AD = /doubleclick|googlesyndication|google-analytics|googletagmanager|adservice|criteo|taboola|scorecardresearch|facebook\.net|analytics|adsystem|ad\.naver|adcr\.naver|wcs\.naver|siape\.veta/i;

async function test(label, mode) {
  // mode: "none"=리소스 다 받음 / "saver"=봇 초절약(이미지 허용, media/font/광고 abort)
  const sess = Math.random().toString(36).slice(2, 8);
  const browser = await chromium.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-blink-features=AutomationControlled"],
    proxy: { server: HOST, username: `${USER_BASE};sessid.${sess};sessttl.10`, password: PASS },
  });
  const ctx = await browser.newContext({ userAgent: UA, viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 3, locale: "ko-KR" });
  await ctx.addInitScript(() => { Object.defineProperty(navigator, "webdriver", { get: () => undefined }); });
  if (mode === "saver") {
    await ctx.route("**/*", (route) => {
      const t = route.request().resourceType();
      const u = route.request().url();
      if (AD.test(u)) return route.abort();
      if (t === "media" || t === "font") return route.abort();
      // 스토어라 이미지는 허용(continue)
      return route.continue();
    });
  }
  const page = await ctx.newPage();
  let ip = "?";
  try {
    const r = await page.request.get("http://ip-api.com/json/?fields=query,isp,mobile", { timeout: 15000 });
    const j = await r.json(); ip = `${j.query}/${j.isp}/mobile:${j.mobile}`;
  } catch {}
  let status = "?";
  try {
    const resp = await page.goto(URL, { waitUntil: "domcontentloaded", timeout: 40000 });
    status = resp ? resp.status() : "no-resp";
  } catch (e) { status = "goto-err:" + (e.message || "").slice(0, 40); }
  await page.waitForTimeout(3500);
  const body = await page.evaluate(() => (document.body ? document.body.innerText : "")).catch(() => "");
  const title = await page.title().catch(() => "");
  const blocked = /현재 서비스 접속이 불가|비정상적인 접근|일시적으로 제한|접근이 일시적/.test(body);
  console.log(`[${label}] sess=${sess} ip=${ip}`);
  console.log(`   HTTP=${status} blocked=${blocked ? "🚫YES" : "✅no"} title="${title}" bodyLen=${body.length}`);
  console.log(`   body앞120: ${body.slice(0, 120).replace(/\s+/g, " ")}`);
  await browser.close();
}

(async () => {
  console.log("=== A) 리소스 차단 없음(다 받음) ===");
  for (let i = 0; i < 3; i++) await test("A", "none");
  console.log("\n=== B) 봇 초절약 route (이미지허용/media·font·광고 차단) ===");
  for (let i = 0; i < 3; i++) await test("B", "saver");
})();
