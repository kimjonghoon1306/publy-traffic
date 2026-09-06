// ─────────────────────────────────────────────────────────────
// 어댑터 발굴기 — 후보 사이트를 자동 조사해 "무료로 되는 것만" 추린다.
//  1) 무인증 API형: 실제 POST 테스트 → 진짜 URL 나오면 free(무료 확정)
//  2) 계정형: 가입 페이지 열어 폼 판별
//     - 전화칸/카드칸 있음 → paid(유료, 제외)
//     - 이메일가입 O + 전화 X → free(무료 가능)
//     - 캡차만 있음 → captcha_only(2captcha로 가능, 거의 무료)
//     - 소셜로그인만 → social(불가)
// 결과는 backlink_discovery_record RPC로 저장. 관제탑에서 확인 후 어댑터 승격.
// ─────────────────────────────────────────────────────────────
import { chromium } from "playwright";

export type Verdict = "free" | "paid" | "social" | "dead" | "captcha_only";
export type DiscoverResult = { domain: string; kind: "api" | "account"; verdict: Verdict; testUrl?: string; note: string };

// ── 무인증 API 후보(실제 POST 테스트) ──
//   되는 게 나오면 즉시 어댑터화 가능. 이미 쓰는 6개는 제외하고 신규만.
const API_CANDIDATES: { domain: string; test: () => Promise<{ ok: boolean; url?: string; note: string }> }[] = [
  { domain: "controlc.com", test: async () => tryFormPost("https://controlc.com/index.php?act=submit", { subdomain: "", input_text: "테스트 https://example.com", paste_password: "", timestamp: String(Date.now()) }) },
  { domain: "ideone.com", test: async () => ({ ok: false, note: "폼 파라미터 복잡·csrf 필요" }) },
  { domain: "pastebin.pl", test: async () => tryTextPost("https://pastebin.pl/api", "테스트 https://example.com") },
  { domain: "0paste.com", test: async () => tryFormPost("https://0paste.com/pastes", { "paste[body]": "테스트 https://example.com", "paste[language]": "text" }) },
  { domain: "commie.io", test: async () => tryFormPost("https://commie.io/api/create", { text: "테스트 https://example.com" }) },
  { domain: "textbin.net", test: async () => tryFormPost("https://textbin.net/save", { code: "테스트 https://example.com", lang: "text" }) },
  { domain: "paste.ee", test: async () => ({ ok: false, note: "API 키 필요(가입해야 발급)" }) },
  { domain: "justpaste.it", test: async () => ({ ok: false, note: "reCAPTCHA로 봇 차단" }) },
  { domain: "write.as", test: async () => tryJsonPost("https://write.as/api/posts", { body: "테스트 https://example.com" }) },
];

async function tryTextPost(url: string, body: string): Promise<{ ok: boolean; url?: string; note: string }> {
  try {
    const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), 12000);
    const res = await fetch(url, { method: "POST", headers: { "Content-Type": "text/plain", "User-Agent": "Mozilla/5.0" }, body, signal: ctrl.signal });
    clearTimeout(t);
    const txt = (await res.text()).trim();
    const u = txt.match(/https?:\/\/[^\s"']+/)?.[0] || "";
    if ((res.ok || res.status === 201) && u) return { ok: true, url: u, note: `HTTP ${res.status}` };
    return { ok: false, note: `HTTP ${res.status} · URL 없음` };
  } catch (e: any) { return { ok: false, note: `오류: ${e?.message || e}` }; }
}
async function tryFormPost(url: string, params: Record<string, string>): Promise<{ ok: boolean; url?: string; note: string }> {
  try {
    const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), 12000);
    const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", "User-Agent": "Mozilla/5.0" }, body: new URLSearchParams(params).toString(), redirect: "follow", signal: ctrl.signal });
    clearTimeout(t);
    const finalUrl = res.url; const txt = (await res.text()).slice(0, 5000);
    const u = txt.match(/https?:\/\/[^\s"'<>]+/)?.[0] || (finalUrl !== url ? finalUrl : "");
    if (res.ok && u) return { ok: true, url: u, note: `HTTP ${res.status}` };
    return { ok: false, note: `HTTP ${res.status}` };
  } catch (e: any) { return { ok: false, note: `오류: ${e?.message || e}` }; }
}
async function tryJsonPost(url: string, obj: any): Promise<{ ok: boolean; url?: string; note: string }> {
  try {
    const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), 12000);
    const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json", "User-Agent": "Mozilla/5.0" }, body: JSON.stringify(obj), signal: ctrl.signal });
    clearTimeout(t);
    const j: any = await res.json().catch(() => ({}));
    const u = j?.data?.url || j?.url || j?.html_url || "";
    if (res.ok && u) return { ok: true, url: u, note: `HTTP ${res.status}` };
    return { ok: false, note: `HTTP ${res.status}` };
  } catch (e: any) { return { ok: false, note: `오류: ${e?.message || e}` }; }
}

// ── 계정형 후보(가입폼 자동 판별) ──
const ACCOUNT_CANDIDATES: { domain: string; signup: string }[] = [
  { domain: "livejournal.com", signup: "https://www.livejournal.com/create/" },
  { domain: "tumblr.com", signup: "https://www.tumblr.com/register" },
  { domain: "hashnode.com", signup: "https://hashnode.com/signup" },
  { domain: "write.as", signup: "https://write.as/signup" },
  { domain: "telegra.ph", signup: "https://telegra.ph" },
  { domain: "penzu.com", signup: "https://penzu.com/signup" },
  { domain: "postach.io", signup: "https://postach.io/site/new" },
  { domain: "bravenet.com", signup: "https://www.bravenet.com/register" },
  { domain: "webnode.com", signup: "https://www.webnode.com/register/" },
  { domain: "jimdo.com", signup: "https://www.jimdo.com/signup/" },
];

async function judgeSignup(url: string): Promise<{ verdict: Verdict; note: string }> {
  const browser = await chromium.launch({ headless: true, args: ["--no-sandbox", "--disable-blink-features=AutomationControlled"] });
  try {
    const page = await browser.newPage({ userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" });
    const resp = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 20000 }).catch(() => null);
    if (!resp || !resp.ok()) { await browser.close(); return { verdict: "dead", note: `접속 불가(HTTP ${resp?.status() || "?"})` }; }
    await page.waitForTimeout(2500);
    const f = await page.evaluate(() => {
      const has = (sel: string) => !!document.querySelector(sel);
      const bodyText = (document.body.innerText || "").toLowerCase();
      return {
        email: has("input[type=email]") || has("input[name*='email' i]") || /이메일|email/.test(bodyText),
        password: has("input[type=password]"),
        phone: has("input[type=tel]") || has("input[name*='phone' i]") || /휴대폰|전화번호|phone number|sms/i.test(bodyText),
        card: /카드|credit card|payment|billing|결제/i.test(bodyText),
        captcha: /recaptcha|hcaptcha|captcha|로봇이 아닙니다|not a robot/i.test(document.documentElement.innerHTML.toLowerCase()),
        google: has("[class*='google' i]") || /google로 로그인|sign in with google|continue with google/i.test(bodyText),
        emailInputs: document.querySelectorAll("input[type=email]").length,
        pwInputs: document.querySelectorAll("input[type=password]").length,
      };
    });
    await browser.close();
    // 판별 우선순위: 전화/카드 있으면 유료 → 이메일가입O전화X면 무료(캡차면 captcha_only) → 소셜만이면 social
    if (f.phone || f.card) return { verdict: "paid", note: `전화/카드 인증 필요(phone=${f.phone} card=${f.card})` };
    if (f.email && f.password) {
      if (f.captcha) return { verdict: "captcha_only", note: "이메일가입 가능·캡차만 있음(2captcha로 무료 뚫기 가능)" };
      return { verdict: "free", note: "이메일가입 가능·전화/카드/캡차 없음(무료 계정 대량 가능)" };
    }
    if (f.google && !f.email) return { verdict: "social", note: "구글 소셜로그인만(봇 불가)" };
    return { verdict: "dead", note: "가입폼 판별 불가(이메일칸 없음)" };
  } catch (e: any) { await browser.close().catch(() => {}); return { verdict: "dead", note: `오류: ${e?.message || e}` }; }
}

// 전체 발굴 실행(SSE 로그 콜백)
export async function runDiscovery(send: (o: any) => void, recordFn: (r: DiscoverResult) => Promise<void>) {
  send({ type: "log", kind: "wait", msg: `🔍 어댑터 발굴 시작 — 무인증 API ${API_CANDIDATES.length}개 + 계정형 ${ACCOUNT_CANDIDATES.length}개 조사` });
  let free = 0, captcha = 0, paid = 0, dead = 0;

  // 1) 무인증 API
  send({ type: "log", kind: "apistart", msg: `━ 1단계: 무인증 API형(진짜 무료) 실제 게시 테스트 ━` });
  for (const c of API_CANDIDATES) {
    try {
      const r = await c.test();
      const verdict: Verdict = r.ok ? "free" : "dead";
      const res: DiscoverResult = { domain: c.domain, kind: "api", verdict, testUrl: r.url, note: r.note };
      await recordFn(res);
      if (r.ok) { free++; send({ type: "log", kind: "post", msg: `✅ [무료] ${c.domain} — 실제 게시됨! ${r.url}` }); }
      else { dead++; send({ type: "log", kind: "skip", msg: `⊝ [제외] ${c.domain} — 안 되는 후보라 그냥 버립니다(우리 시스템엔 영향 없음 · ${r.note})` }); }
    } catch (e: any) { dead++; send({ type: "log", kind: "skip", msg: `⊝ [제외] ${c.domain} — 조사 중 오류라 건너뜁니다(영향 없음)` }); }
  }

  // 2) 계정형 가입폼 판별
  send({ type: "log", kind: "botstart", msg: `━ 2단계: 계정형 가입폼 판별(무료/유료 구분) ━` });
  for (const c of ACCOUNT_CANDIDATES) {
    const j = await judgeSignup(c.signup);
    const res: DiscoverResult = { domain: c.domain, kind: "account", verdict: j.verdict, note: j.note };
    await recordFn(res);
    if (j.verdict === "free") { free++; send({ type: "log", kind: "post", msg: `✅ [무료가능] ${c.domain} — ${j.note}` }); }
    else if (j.verdict === "captcha_only") { captcha++; send({ type: "log", kind: "index", msg: `🟡 [캡차만·거의무료] ${c.domain} — ${j.note}` }); }
    else if (j.verdict === "paid") { paid++; send({ type: "log", kind: "warn", msg: `💰 [유료·제외] ${c.domain} — ${j.note}` }); }
    else { dead++; send({ type: "log", kind: "fail", msg: `✖ [${j.verdict}] ${c.domain} — ${j.note}` }); }
  }

  send({ type: "log", kind: "done", msg: `🎉 발굴 완료 — 무료 ${free}개 · 캡차만(거의무료) ${captcha}개 · 유료제외 ${paid}개 · 안됨 ${dead}개` });
  send({ type: "done", free, captcha, paid, dead });
}
