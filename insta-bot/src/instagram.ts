import { chromium, BrowserContext, Page } from "playwright";
import fs from "fs";
import path from "path";
import { hasSession, readSession, writeSession } from "./session-store";

// ─────────────────────────────────────────────────────────────
//  insta-bot — 인스타그램 자동화 (기존 naver/neighbor 봇과 동일 패턴)
//  ⚠️ 인스타는 자동화/스크래핑을 ToS로 금지하고 봇 탐지가 공격적입니다.
//     반드시 휴먼딜레이 + 소량 + 계정 워밍업 전제로 사용하세요.
//  ⚠️ 셀렉터는 인스타 UI 변경/지역화에 따라 1회 실측 튜닝이 필요할 수 있습니다
//     (naver-bot도 동일하게 실측으로 다듬었음).
// ─────────────────────────────────────────────────────────────

const LEGACY_SESSION_DIRS = [path.join(__dirname, "../sessions")];
const sessionName = (accountId: string) => `insta_${accountId}`;

export function instaSessionExists(accountId: string): boolean {
  return hasSession(sessionName(accountId), LEGACY_SESSION_DIRS);
}

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

const LAUNCH_ARGS = [
  "--no-sandbox",
  "--disable-blink-features=AutomationControlled",
  "--disable-features=IsolateOrigins,site-per-process",
  "--no-first-run",
  "--no-default-browser-check",
];

const ANTI_DETECTION_SCRIPT = `
  Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
  if (!window.chrome) { window.chrome = { runtime: {} }; }
  Object.defineProperty(navigator, 'languages', { get: () => ['ko-KR','ko','en-US','en'] });
  Object.defineProperty(navigator, 'plugins', { get: () => [1,2,3,4,5].map(() => ({ name: 'Chrome PDF Plugin' })) });
`;

async function newContext(opts: { withSession?: boolean; accountId?: string }): Promise<{ browser: any; context: BrowserContext }> {
  const browser = await chromium.launch({ headless: false, args: LAUNCH_ARGS, slowMo: 40 });
  const context = await browser.newContext({
    userAgent: UA,
    viewport: { width: 1280, height: 900 },
    locale: "ko-KR",
    timezoneId: "Asia/Seoul",
    storageState: opts.withSession && opts.accountId && instaSessionExists(opts.accountId)
      ? readSession<any>(sessionName(opts.accountId), LEGACY_SESSION_DIRS) : undefined,
  });
  await context.addInitScript(ANTI_DETECTION_SCRIPT);
  return { browser, context };
}

// 정규분포 휴먼 딜레이 (초)
function humanDelayMs(minSec: number, maxSec: number): number {
  const u1 = Math.random(), u2 = Math.random();
  const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  const mid = (minSec + maxSec) / 2;
  const sd = (maxSec - minSec) / 4;
  return Math.max(minSec, Math.min(maxSec, mid + z * sd)) * 1000;
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// 인스타 팝업(정보 저장/알림 켜기 등) 닫기
async function dismissDialogs(page: Page) {
  const labels = ["나중에 하기", "Not Now", "취소", "닫기", "Cancel"];
  for (const t of labels) {
    try {
      const btn = page.locator(`button:has-text("${t}"), div[role="button"]:has-text("${t}")`).first();
      if (await btn.isVisible({ timeout: 800 }).catch(() => false)) {
        await btn.click({ timeout: 1000 }).catch(() => {});
        await page.waitForTimeout(400);
      }
    } catch {}
  }
}

async function isLoggedIn(page: Page): Promise<boolean> {
  if (page.url().includes("/accounts/login")) return false;
  // 로그인 후엔 홈/검색 아이콘이 보임
  const ok = await page
    .locator('svg[aria-label="홈"], svg[aria-label="Home"], a[href="/"][role="link"]')
    .first()
    .isVisible({ timeout: 4000 })
    .catch(() => false);
  return ok;
}

// ── 로그인 + 세션 저장 (수동 캡차/2FA 직접 처리) ────────────────
export async function saveInstaSession(accountId: string, id: string, pw: string): Promise<{ username: string }> {
  const { browser, context } = await newContext({ withSession: false });
  const page = await context.newPage();
  try {
    await page.goto("https://www.instagram.com/accounts/login/", { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForTimeout(1200);
    await dismissDialogs(page);

    await page.fill('input[name="username"]', id, { timeout: 15000 });
    await page.waitForTimeout(humanDelayMs(0.4, 1));
    await page.fill('input[name="password"]', pw, { timeout: 15000 });
    await page.waitForTimeout(humanDelayMs(0.4, 1));
    await page.click('button[type="submit"]').catch(() => {});

    // 로그인 완료 또는 2FA/캡차 수동 처리 대기 (최대 120초)
    await page.waitForFunction(() => !location.pathname.includes("/accounts/login"), { timeout: 120000 }).catch(() => {});
    await page.waitForTimeout(2000);
    await dismissDialogs(page);

    if (!(await isLoggedIn(page))) {
      throw new Error("로그인 실패 — 2FA/캡차가 있으면 창에서 직접 통과시킨 뒤 다시 시도하세요.");
    }

    writeSession(sessionName(accountId), await context.storageState());
    await browser.close().catch(() => {});
    return { username: id };
  } catch (e) {
    await browser.close().catch(() => {});
    throw e;
  }
}

// og:description 에서 팔로워 수 파싱 ("1,234 Followers, ...", "1.2M Followers")
function parseFollowers(desc: string): number {
  const m = desc.match(/([\d.,]+)\s*([KMkm]?)\s*(Followers|팔로워)/);
  if (!m) return 0;
  let n = parseFloat(m[1].replace(/,/g, ""));
  const suf = m[2].toUpperCase();
  if (suf === "K") n *= 1_000;
  if (suf === "M") n *= 1_000_000;
  return Math.round(n);
}

export interface CrawlTarget { username: string; followers: number; fullName: string; }

// ── 키워드로 계정 수집 + 팔로워 수 채우기 + 필터 ────────────────
export async function crawlByKeyword(params: {
  accountId: string;
  keyword: string;
  limit: number;
  minFollowers: number;
  maxFollowers: number;
  onLog: (msg: string) => void;
  onResult: (t: CrawlTarget) => void;
  stopSignal: () => boolean;
}): Promise<CrawlTarget[]> {
  const { accountId, keyword, limit, minFollowers, maxFollowers, onLog, onResult, stopSignal } = params;
  const { browser, context } = await newContext({ withSession: true, accountId });
  const page = await context.newPage();
  const collected: CrawlTarget[] = [];
  try {
    await page.goto("https://www.instagram.com/", { waitUntil: "domcontentloaded", timeout: 30000 });
    await dismissDialogs(page);
    if (!(await isLoggedIn(page))) throw new Error("세션 만료 — 계정 다시 로그인이 필요합니다.");

    // topsearch JSON 으로 후보 username 수집 (로그인 쿠키로 호출)
    onLog(`🔍 "${keyword}" 계정 검색 중...`);
    const candidates: string[] = await page.evaluate(async (kw) => {
      try {
        const r = await fetch(`https://www.instagram.com/web/search/topsearch/?context=blended&query=${encodeURIComponent(kw)}&count=50`, { headers: { "x-requested-with": "XMLHttpRequest" } });
        const j = await r.json();
        return (j.users || []).map((u: any) => u.user?.username).filter(Boolean);
      } catch { return []; }
    }, keyword);

    if (!candidates.length) onLog("⚠️ 검색 결과가 비었어요 (인스타 검색 차단 또는 키워드 무결과). 프로필 방문 방식으로 재시도하세요.");
    onLog(`📋 후보 ${candidates.length}개 — 팔로워 수 확인 중 (필터 ${minFollowers}~${maxFollowers || "∞"})`);

    for (const username of candidates) {
      if (stopSignal()) { onLog("⏹️ 중단됨"); break; }
      if (collected.length >= limit) break;
      try {
        await page.goto(`https://www.instagram.com/${username}/`, { waitUntil: "domcontentloaded", timeout: 20000 });
        await page.waitForTimeout(humanDelayMs(1.5, 3)); // 휴먼 딜레이 (탐지 회피)
        const desc = await page.locator('meta[property="og:description"]').getAttribute("content").catch(() => "") || "";
        const followers = parseFollowers(desc);
        const fullName = (await page.title()).split("(")[0].trim();

        const passMin = followers >= minFollowers;
        const passMax = !maxFollowers || followers <= maxFollowers;
        if (passMin && passMax) {
          const t = { username, followers, fullName };
          collected.push(t);
          onResult(t);
          onLog(`✅ @${username} (팔로워 ${followers.toLocaleString()})`);
        } else {
          onLog(`⏭️ @${username} (팔로워 ${followers.toLocaleString()}) — 필터 제외`);
        }
      } catch (e: any) {
        onLog(`⚠️ @${username} 확인 실패: ${e.message}`);
      }
    }
    onLog(`🎉 수집 완료 — ${collected.length}개`);
    await browser.close().catch(() => {});
    return collected;
  } catch (e) {
    await browser.close().catch(() => {});
    throw e;
  }
}

export interface SendTarget { id?: string; username: string; }
export interface SendResult { username: string; status: "sent" | "fail"; reason?: string; targetId?: string; }

// ── DM 발송 ──────────────────────────────────────────────────
export async function sendDMs(params: {
  accountId: string;
  targets: SendTarget[];
  message: string;
  delayMin: number;
  delayMax: number;
  dailyLimit: number;
  onLog: (msg: string) => void;
  onResult: (r: SendResult) => void | Promise<void>;
  onProgress: (done: number, fail: number) => void;
  stopSignal: () => boolean;
}): Promise<void> {
  const { accountId, targets, message, delayMin, delayMax, dailyLimit, onLog, onResult, onProgress, stopSignal } = params;
  const { browser, context } = await newContext({ withSession: true, accountId });
  const page = await context.newPage();
  let done = 0, fail = 0;
  try {
    await page.goto("https://www.instagram.com/", { waitUntil: "domcontentloaded", timeout: 30000 });
    await dismissDialogs(page);
    if (!(await isLoggedIn(page))) throw new Error("세션 만료 — 계정 다시 로그인이 필요합니다.");

    for (const t of targets) {
      if (stopSignal()) { onLog("⏹️ 중단됨"); break; }
      if (done >= dailyLimit) { onLog(`🛑 오늘 한도(${dailyLimit}) 도달 — 중단`); break; }
      const username = t.username.replace(/^@/, "").trim();
      try {
        onLog(`✉️ @${username} 에게 DM 작성 중...`);
        // 새 메시지 화면
        await page.goto("https://www.instagram.com/direct/new/", { waitUntil: "domcontentloaded", timeout: 25000 });
        await page.waitForTimeout(humanDelayMs(1.5, 3));
        await dismissDialogs(page);

        // 수신자 검색
        const searchBox = page.locator('input[placeholder*="검색"], input[name="queryBox"], input[aria-label*="검색"], input[placeholder*="Search"]').first();
        await searchBox.fill(username, { timeout: 15000 });
        await page.waitForTimeout(humanDelayMs(2, 3.5));

        // 첫 결과 선택 (체크박스/행)
        const firstRow = page.locator('div[role="dialog"] [role="button"]:has-text("' + username + '"), div[role="dialog"] [role="checkbox"]').first();
        await firstRow.click({ timeout: 8000 });
        await page.waitForTimeout(humanDelayMs(0.6, 1.4));

        // 다음/채팅
        const nextBtn = page.locator('div[role="dialog"] button:has-text("다음"), div[role="dialog"] button:has-text("채팅"), div[role="dialog"] button:has-text("Next"), div[role="dialog"] button:has-text("Chat")').first();
        await nextBtn.click({ timeout: 8000 });
        await page.waitForTimeout(humanDelayMs(1.2, 2.5));

        // 메시지 입력 + 전송
        const msgBox = page.locator('div[role="textbox"][contenteditable="true"], textarea[placeholder*="메시지"], textarea[placeholder*="Message"]').first();
        await msgBox.click({ timeout: 8000 });
        await msgBox.type(message, { delay: 30 + Math.random() * 60 });
        await page.waitForTimeout(humanDelayMs(0.5, 1.2));
        await page.keyboard.press("Enter");
        await page.waitForTimeout(humanDelayMs(1.5, 2.5));

        done++;
        onLog(`✅ @${username} 발송 완료 (${done}/${dailyLimit})`);
        await onResult({ username, status: "sent", targetId: t.id });
      } catch (e: any) {
        fail++;
        onLog(`❌ @${username} 실패: ${e.message}`);
        await onResult({ username, status: "fail", reason: e.message, targetId: t.id });
      }
      onProgress(done, fail);
      // 다음 발송 전 휴먼 딜레이 (가장 중요한 탐지 회피)
      await sleep(humanDelayMs(delayMin, delayMax));
    }
    await browser.close().catch(() => {});
  } catch (e) {
    await browser.close().catch(() => {});
    throw e;
  }
}
