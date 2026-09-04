import { chromium, BrowserContext, Frame, Page } from "playwright";
import fs from "fs";
import https from "https";
import http from "http";
import os from "os";
import path from "path";
import { deleteSession, hasSession, readSession, writeSession, sessionDiagnosis } from "./session-store";

const LEGACY_SESSION_DIRS = [path.join(__dirname, "../sessions")];

const naverSessionName = (userId: string) => `naver_${userId}`;
const naverAcctSessionName = (userId: string, naverId: string) => `naver_${userId}__${String(naverId).replace(/[^a-zA-Z0-9_-]/g, "")}`;
const googleSessionName = (userId: string) => `google_${userId}`;

// ★공용 blogId 확정("스킬") — 네이버 로그인ID ≠ 블로그주소(예: 로그인 bb9653 / 블로그 system-b)인 계정 대응.
//   neighbor-bot의 '제목수정(updatePostTitle)'에서 실측·검증된 resolveBlogIdFast를 그대로 이식.
//   저장된 blogId가 로그인ID로 잘못 박혀 있어도, 실행 시점에 GoBlogWrite 302 Location에서 진짜 blogId를 뽑아 교정한다.
//   글 편집(PostWriteForm?...&Redirect=Update)은 정확한 blogId 아니면 글목록(PostList)으로 튕기므로 필수.
const RESOLVE_INVALID = ["PostList", "BlogHome", "FeedList", "neighborPostList", "TagList", "GoBlogWrite", "RedirectWriteView", "PostWriteForm", "MyBlog", "section", "m", "manage", "admin", "GoMyblog", "Write", "fx"];
async function resolveNaverBlogId(storedBlogId: string, cookies: any[], userId: string, log: (m: string) => void = console.log): Promise<string> {
  storedBlogId = (storedBlogId || "").split("@")[0].trim();   // 이메일이 blogId로 들어오면 아이디만
  const pickFrom = (s: string): string => {
    const m = s.match(/[?&]blogId=([a-zA-Z0-9_-]+)/) || s.match(/blog\.naver\.com\/([a-zA-Z0-9_-]+)/);
    return (m && m[1] && !RESOLVE_INVALID.includes(m[1])) ? m[1] : "";
  };
  try {
    const cookieHeader = (cookies || []).map((c: any) => `${c.name}=${c.value}`).join("; ");
    if (!cookieHeader) return storedBlogId;
    const headers = { cookie: cookieHeader, "user-agent": UA } as any;
    let real = "";
    // 1순위: GoBlogWrite 302 Location에서 blogId
    try {
      const r = await fetch("https://blog.naver.com/GoBlogWrite.naver", { headers, redirect: "manual" as any });
      const loc = r.headers.get("location") || "";
      real = pickFrom(loc);
      if (!real && r.status >= 200 && r.status < 300) real = pickFrom((r as any).url || "");
    } catch {}
    // 2순위: 모바일 내블로그 리다이렉트
    if (!real) try {
      const r2 = await fetch("https://m.blog.naver.com/MyBlog.naver", { headers, redirect: "manual" as any });
      real = pickFrom(r2.headers.get("location") || "") || pickFrom((r2 as any).url || "");
    } catch {}
    if (real && real !== storedBlogId) {
      log(`[naver] [blogId교정] '${storedBlogId}' → '${real}' (로그인ID와 블로그주소가 달라 자동으로 맞췄어요)`);
      try { const s = readSession<any>(naverSessionName(userId), LEGACY_SESSION_DIRS); if (s) { s.blogId = real; writeSession(naverSessionName(userId), s); } } catch {}
      return real;
    }
  } catch {}
  return storedBlogId;
}

export function naverSessionExists(userId: string): boolean {
  return hasSession(naverSessionName(userId), LEGACY_SESSION_DIRS);
}
export function deleteNaverSession(userId: string): void { deleteSession(naverSessionName(userId), LEGACY_SESSION_DIRS); }
export function deleteGoogleSession(userId: string): void { deleteSession(googleSessionName(userId), LEGACY_SESSION_DIRS); }

export function activateNaverAccount(userId: string, naverId: string): boolean {
  try {
    const accountSessionName = naverAcctSessionName(userId, naverId);
    if (!hasSession(accountSessionName, LEGACY_SESSION_DIRS)) return false;
    const session = readSession<any>(accountSessionName, LEGACY_SESSION_DIRS);
    writeSession(naverSessionName(userId), session);
    return true;
  } catch {
    return false;
  }
}

/* ── 봇 탐지 우회 ── */
const ANTI_DETECTION_SCRIPT = `
  Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
  if (!window.chrome) {
    window.chrome = { runtime: {}, loadTimes: () => {}, csi: () => {} };
  }
  Object.defineProperty(navigator, 'plugins', {
    get: () => [1,2,3,4,5].map(() => ({ name: 'Chrome PDF Plugin' }))
  });
  Object.defineProperty(navigator, 'languages', {
    get: () => ['ko-KR','ko','en-US','en']
  });
  const origQuery = window.navigator.permissions?.query;
  if (origQuery) {
    window.navigator.permissions.query = (params) =>
      params.name === 'notifications'
        ? Promise.resolve({ state: Notification.permission })
        : origQuery(params);
  }
`;

const LAUNCH_ARGS = [
  "--no-sandbox",
  "--disable-blink-features=AutomationControlled",
  "--disable-features=IsolateOrigins,site-per-process",
  "--no-first-run",
  "--no-default-browser-check",
];

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

async function applyAntiDetection(context: BrowserContext) {
  await context.addInitScript(ANTI_DETECTION_SCRIPT);
}

/* ── 이미지 다운로드 (썸네일용) ── */
async function downloadImageToTemp(url: string): Promise<string | null> {
  try {
    // base64 data URL 처리 (AI 생성 이미지 — Replicate/DALL-E 등)
    if (url.startsWith("data:")) {
      const m = url.match(/^data:(image\/[\w+.-]+);base64,(.+)$/);
      if (!m) return null;
      const dext = m[1].includes("png") ? ".png" : m[1].includes("webp") ? ".webp" : ".jpg";
      const dtmp = path.join(os.tmpdir(), `publy_img_${Date.now()}_${Math.random().toString(36).slice(2, 7)}${dext}`);
      fs.writeFileSync(dtmp, Buffer.from(m[2], "base64"));
      return dtmp;
    }
    const ext = url.includes(".png") ? ".png" : ".jpg";
    // 로컬 파일 경로면 바로 반환 (Flow 이미지)
    if (!url.startsWith("http")) {
      if (fs.existsSync(url)) return url;
      return null;
    }
    const tmpFile = path.join(os.tmpdir(), `publy_img_${Date.now()}${ext}`);
    const proto = url.startsWith("https") ? https : http;
    return new Promise((resolve) => {
      const file = fs.createWriteStream(tmpFile);
      proto.get(url, (res) => {
        res.pipe(file);
        file.on("finish", () => { file.close(); resolve(tmpFile); });
      }).on("error", () => {
        try { fs.unlinkSync(tmpFile); } catch {}
        resolve(null);
      });
    });
  } catch {
    return null;
  }
}

/* ── 네이버 로그인 + blogId 추출 ── */
export async function saveNaverSession(
  userId: string, id: string, pw: string
): Promise<{ blogId: string }> {
  const browser = await chromium.launch({ headless: false, args: LAUNCH_ARGS, slowMo: 50 });
  const context = await browser.newContext({
    userAgent: UA, viewport: { width: 1280, height: 800 },
    locale: "ko-KR", timezoneId: "Asia/Seoul",
  });
  await applyAntiDetection(context);
  const page = await context.newPage();

  try {
    console.log("[naver] 로그인 페이지 진입...");
    await page.goto("https://nid.naver.com/nidlogin.login", { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForTimeout(800);

    await page.evaluate((v) => {
      const el = document.querySelector("#id") as HTMLInputElement;
      if (el) { el.focus(); el.value = v; el.dispatchEvent(new Event("input", { bubbles: true })); }
    }, id);
    await page.waitForTimeout(400);

    await page.evaluate((v) => {
      const el = document.querySelector("#pw") as HTMLInputElement;
      if (el) { el.focus(); el.value = v; el.dispatchEvent(new Event("input", { bubbles: true })); }
    }, pw);
    await page.waitForTimeout(400);

    // 로그인 버튼 클릭 (네이버 개편: #loginBtn_row/#loginBtn_column, class btn_done, type=button — 옛 .btn_login 사라짐)
    let _loginClicked = false;
    for (const _sel of ["#loginBtn_row", "#loginBtn_column"]) {
      try { const _el = await page.$(_sel); if (_el && await _el.isVisible()) { await _el.click(); _loginClicked = true; break; } } catch {}
    }
    if (!_loginClicked) { try { await page.click(".btn_login", { timeout: 2000 }); _loginClicked = true; } catch {} }
    if (!_loginClicked) { await page.keyboard.press("Enter"); }

    console.log("[naver] 로그인 대기 중... (캡차 있으면 직접 풀어주세요)");
    try {
      await page.waitForFunction(
        () => !location.href.includes("nid.naver.com/nidlogin"),
        { timeout: 90000 }
      );
    } catch {
      throw new Error("로그인 시간 초과 (90초)");
    }

    await page.waitForTimeout(2000);
    if (page.url().includes("nidlogin")) throw new Error("로그인 실패");
    console.log("[naver] ✅ 로그인 성공");

    // ★★근본해결(네이버ID≠블로그주소, 예: 네이버ID=bb9653 blogId=system-b):
    //   GoBlogWrite 리다이렉트 최종 URL은 `blog.naver.com/{blogId}?Redirect=Write`(경로형)이라
    //   기존 `?blogId=`만 찾는 정규식으론 못 뽑아 네이버ID로 잘못 저장됐다.
    //   → 경로형 `blog.naver.com/{blogId}` + 쿼리형 `?blogId=` 둘 다 파싱한다. 이후 모든 회원 자동 정상.
    let blogId: string | null = null;
    const BAD_BLOG_IDS = ["PostList","BlogHome","FeedList","neighborPostList","TagList","GoBlogWrite","RedirectWriteView","PostWriteForm","MyBlog","section","m","manage","admin","GoMyblog","Write","fx"];
    const pickBlogId = (u: string): string => {
      const mm = u.match(/[?&]blogId=([a-zA-Z0-9_-]+)/) || u.match(/(?:m\.)?blog\.naver\.com\/([a-zA-Z0-9_-]+)/);
      return (mm && mm[1] && !BAD_BLOG_IDS.includes(mm[1])) ? mm[1] : "";
    };
    try {
      await page.goto("https://blog.naver.com/GoBlogWrite.naver", { waitUntil: "domcontentloaded", timeout: 30000 });
      await page.waitForTimeout(3000);
      blogId = pickBlogId(page.url());
    } catch {}
    if (!blogId) {
      try {
        await page.goto("https://m.blog.naver.com", { waitUntil: "domcontentloaded", timeout: 20000 });
        await page.waitForTimeout(2000);
        blogId = pickBlogId(page.url());
      } catch {}
    }
    if (!blogId) { blogId = id; console.log(`[naver] ⚠️ blogId 자동추출 실패 → 네이버ID(${id})로 임시저장(실행 시 resolveBlogIdFast가 자동 교정)`); }
    console.log(`[naver] ✅ blogId: ${blogId}`);

    const cookies = await context.cookies();
    // ★비번 저장(자동 재로그인용, base64) — 재진입 시 세션 만료돼도 저장된 정보로 원터치 재연결.
    const session = {
      loginId: id,
      blogId,
      cookies,
      pw: Buffer.from(pw, "utf-8").toString("base64"),
    };
    writeSession(naverAcctSessionName(userId, id), session);
    writeSession(naverSessionName(userId), session);
    await browser.close();
    return { blogId };
  } catch (e) {
    await browser.close().catch(() => {});
    throw e;
  }
}

/* ── 자동 재로그인 (세션 만료 시) ──
   visible=false: 창 없이 조용히. visible=true: 창 띄워 아이디·비번 자동입력 후 보안문자(캡차)만 사용자가.
   ★캡차 회피: 실제 브라우저 모드+기존 쿠키(기기 신뢰) 재주입+사람같은 타이핑. */
export async function reloginNaverSilent(userId: string, visible = false): Promise<boolean> {
  if (!naverSessionExists(userId)) return false;
  const session = readSession<any>(naverSessionName(userId), LEGACY_SESSION_DIRS);
  const loginId: string = session.loginId;
  let pw: string | null = null;
  if (session.pw) { try { pw = Buffer.from(session.pw, "base64").toString("utf-8"); } catch {} }
  if (!pw) { console.log("[naver] 자동재로그인 실패: 저장된 비밀번호 없음"); return false; }

  const browser = await chromium.launch({ headless: !visible, args: visible ? [...LAUNCH_ARGS, "--start-maximized"] : LAUNCH_ARGS });
  const context = await browser.newContext({ userAgent: UA, viewport: { width: 1280, height: 800 }, locale: "ko-KR", timezoneId: "Asia/Seoul" });
  await applyAntiDetection(context);
  try { if (Array.isArray(session.cookies) && session.cookies.length) await context.addCookies(session.cookies); } catch {}
  const page = await context.newPage();
  if (visible) await page.bringToFront().catch(() => {});
  try {
    await page.goto("https://nid.naver.com/nidlogin.login", { waitUntil: "domcontentloaded", timeout: 20000 });
    await page.waitForTimeout(600);
    try { await page.click("#id"); await page.type("#id", loginId, { delay: 60 }); } catch { await page.evaluate((v) => { const el = document.querySelector("#id") as HTMLInputElement; if (el) { el.focus(); el.value = v; el.dispatchEvent(new Event("input", { bubbles: true })); } }, loginId); }
    await page.waitForTimeout(250);
    try { await page.click("#pw"); await page.type("#pw", pw, { delay: 55 }); } catch { await page.evaluate((v) => { const el = document.querySelector("#pw") as HTMLInputElement; if (el) { el.focus(); el.value = v; el.dispatchEvent(new Event("input", { bubbles: true })); } }, pw); }
    await page.waitForTimeout(300);
    { let _c = false; for (const _s of ["#loginBtn_row", "#loginBtn_column"]) { try { const _e = await page.$(_s); if (_e && await _e.isVisible()) { await _e.click(); _c = true; break; } } catch {} } if (!_c) { try { await page.click(".btn_login", { timeout: 2000 }); _c = true; } catch {} } if (!_c) { try { await page.click("button[type='submit']", { timeout: 2000 }); _c = true; } catch {} } if (!_c) { await page.keyboard.press("Enter"); } }
    const timeout = visible ? 120000 : 15000;
    try { await page.waitForFunction(() => !location.href.includes("nid.naver.com/nidlogin"), { timeout }); }
    catch { await browser.close().catch(() => {}); return false; }
    await page.waitForTimeout(1500);
    if (page.url().includes("nidlogin")) { await browser.close(); return false; }
    const cookies = await context.cookies();
    const old = readSession<any>(naverSessionName(userId), LEGACY_SESSION_DIRS);
    writeSession(naverSessionName(userId), { ...old, cookies });   // 비번 유지, 쿠키만 갱신
    await browser.close();
    console.log(`[naver] ✅ 자동 재로그인 성공${visible ? " (창 모드)" : ""}`);
    return true;
  } catch { await browser.close().catch(() => {}); return false; }
}

/* ★쿠키로 로그인 유효성 확인(가벼운 fetch). 만료면 nidlogin으로 리다이렉트. */
async function isSessionAliveNaver(cookies: any[]): Promise<boolean> {
  try {
    const h = (cookies || []).map((c: any) => `${c.name}=${c.value}`).join("; ");
    if (!h) return false;
    const r = await fetch("https://blog.naver.com/GoBlogWrite.naver", { headers: { cookie: h, "user-agent": UA } as any, redirect: "manual" as any });
    const loc = r.headers.get("location") || "";
    if (/nidlogin|nid\.naver\.com|\/login/i.test(loc)) return false;
    if (/PostWriteForm|RedirectWriteView|blogId=|Redirect=Write|blog\.naver\.com\/[a-zA-Z0-9_-]+/i.test(loc)) return true;
    return r.status >= 200 && r.status < 400;
  } catch { return true; }
}

/* ★★세션 원터치 재연결: 살아있으면 그대로, 만료면 저장된 비번으로 자동 재로그인(조용히→캡차면 창 모드). */
export async function ensureLiveSessionNaver(userId: string, log: (m: string) => void = console.log): Promise<any[]> {
  if (!naverSessionExists(userId)) {
    // 🔍 진단 첨부 — 폴더마다 세션 0개면 '계정 연결 안 함', 다른 이름 있으면 '경로/계정 불일치'
    const diag = sessionDiagnosis(naverSessionName(userId), LEGACY_SESSION_DIRS);
    log(`[세션] ❌ 세션 없음 — 계정=${userId} · 진단: ${diag}`);
    throw new Error(`네이버 세션 없음 — 계정 관리 탭에서 네이버 '연결하기'를 먼저 해주세요. [진단 userId=${userId} · ${diag}]`);
  }
  const cookies = readSession<any>(naverSessionName(userId), LEGACY_SESSION_DIRS).cookies;
  if (await isSessionAliveNaver(cookies)) return cookies;
  log("[세션] 로그인이 만료돼 저장된 정보로 자동 재연결을 시도해요...");
  if (await reloginNaverSilent(userId, false)) { log("[세션] ✅ 자동 재연결 성공"); return readSession<any>(naverSessionName(userId), LEGACY_SESSION_DIRS).cookies; }
  log("[세션] 🔐 보안문자(캡차)가 필요해요. 로그인 창을 띄웠어요 — 아이디·비번은 자동으로 채웠으니 보안문자만 입력해주세요(최대 2분).");
  if (await reloginNaverSilent(userId, true)) { log("[세션] ✅ 재연결 성공"); return readSession<any>(naverSessionName(userId), LEGACY_SESSION_DIRS).cookies; }
  throw new Error("로그인 재연결에 실패했어요. 계정 관리에서 '연결하기'를 한 번 눌러 직접 로그인해주세요.");
}

/* ── 카테고리 목록 조회 ── */
export async function getNaverCategories(
  userId: string
): Promise<{ id: string; name: string }[]> {
  if (!naverSessionExists(userId)) throw new Error("네이버 세션 없음");
  const { blogId, cookies } = readSession<any>(naverSessionName(userId), LEGACY_SESSION_DIRS);
  const browser = await chromium.launch({ headless: true, args: LAUNCH_ARGS });
  const context = await browser.newContext({
    userAgent: UA, viewport: { width: 1280, height: 800 },
    locale: "ko-KR", timezoneId: "Asia/Seoul",
  });
  await applyAntiDetection(context);
  await context.addCookies(cookies);
  const page = await context.newPage();

  try {
    await page.goto(
      `https://blog.naver.com/GoBlogWrite.naver?blogId=${blogId}`,
      { waitUntil: "domcontentloaded", timeout: 30000 }
    );
    await page.waitForTimeout(4000);

    const getFrame = () => {
      const frames = page.frames();
      return frames.find(f => f.name() === "mainFrame")
        ?? frames.find(f => f.url().includes("blog.naver.com"))
        ?? frames[1] ?? null;
    };
    let frame = getFrame();
    for (let i = 0; i < 6; i++) {
      if (frame) break;
      await page.waitForTimeout(1000);
      frame = getFrame() as Frame;
    }
    if (!frame) { await browser.close(); return []; }

    // 발행 레이어 열기(상단 '발행' 버튼) — option_category가 뜰 때까지 재시도
    let panelReady = false;
    for (let attempt = 0; attempt < 4 && !panelReady; attempt++) {
      await frame.$$eval("button", (bs) => {
        const b = bs.find(x => (x.textContent||"").trim()==="발행" && /publish_btn/.test((x as HTMLElement).className))
          || bs.find(x => (x.textContent||"").trim()==="발행");
        if (b) (b as HTMLElement).click();
      }).catch(()=>{});
      try { await frame.waitForSelector("[class*='option_category']", { timeout: 6000 }); panelReady = true; } catch {}
    }
    if (!panelReady) { await browser.close(); return []; }

    // 카테고리 드롭다운 펼치기(selectbox_button)
    await frame.evaluate(() => {
      const oc = document.querySelector("[class*='option_category']");
      const btn = oc?.querySelector("button,[role='button']") as HTMLElement | null;
      if (btn) btn.click();
    }).catch(()=>{});
    await page.waitForTimeout(1500);

    // 라디오 목록에서 카테고리 추출: input id="{카테고리ID}_{이름}", data-testid="categoryBtn_{ID}"
    const categories: { id: string; name: string }[] = await frame.evaluate(() => {
      const oc = document.querySelector("[class*='option_category']");
      if (!oc) return [];
      const seen = new Set<string>();
      const list: { id: string; name: string }[] = [];
      oc.querySelectorAll("li input[type=radio]").forEach((inp) => {
        const el = inp as HTMLInputElement;
        const testid = el.getAttribute("data-testid") || "";           // categoryBtn_1
        const idm = testid.match(/categoryBtn_(\d+)/);
        const idAttr = el.id || "";                                     // 1_맛집 리뷰
        const id = idm ? idm[1] : (idAttr.split("_")[0] || "");
        const lbl = oc.querySelector(`label[for="${CSS.escape(el.id)}"] .text__sraQE, label[for="${CSS.escape(el.id)}"]`);
        const name = (lbl?.textContent || idAttr.replace(/^\d+_/, "") || "").trim();
        if (id && name && !seen.has(id)) { seen.add(id); list.push({ id, name }); }
      });
      return list;
    });
    await browser.close();
    return categories;
  } catch (e) {
    await browser.close().catch(() => {});
    console.error("[naver] 카테고리 조회 실패:", e);
    return [];
  }
}

/* ── 마커 및 영문 섞임 텍스트 정리 ── */
export function cleanContent(text: string): string {
  return text
    // 구간 내용은 보존하고 앱 내부용 시작·끝 마커만 제거한다.
    // pubScope별 구간 제외는 아래의 블록/원문 필터가 담당한다.
    .replace(/\[(?:FAQ|참고자료|관련글)(?:시작|끝)\]/g, "")
    .replace(/\[[^\]]*\]/g, "")        // 나머지 [마커] 제거
    // 자주 쓰이는 영문 → 한국어 표기 변환
    .replace(/\bQ(\d+)\s*:/g, "Q$1.")   // Q1: → Q1.
    .replace(/\bA(\d+)\s*:/g, "A$1.")   // A1: → A1.
    .replace(/\bFAQ\b/g, "자주 묻는 질문")
    .replace(/\bTIP\b/gi, "팁")
    .replace(/\bNOTE\b/gi, "참고")
    .replace(/\n{3,}/g, "\n\n")        // 3줄 이상 공백 → 2줄로
    .trim();
}

/* ── 네이버 블로그 자동발행 ── */
export async function publishNaver(params: {
  userId: string;
  title: string;
  content: string;
  pubScope?: "body" | "faq" | "full";
  tags: string[];
  imageUrl?: string;
  categoryId?: string;
  visibility?: "public" | "neighbor" | "private";
  scheduleTime?: string;
  blocks?: Array<{type: string; content?: string; src?: string; alt?: string; link?: string}>;
  videoUrl?: string;
  videoPosition?: "top" | "middle" | "bottom";
  editLogNo?: string;   // ★있으면 새 글이 아니라 '그 글 편집화면'을 열어 기존 본문 비우고 통째 교체 재발행(주소·좋아요 유지)
  editBlogId?: string;  // ★글 살리기 원문 소유 blogId. 활성 세션의 실제 blogId와 다르면 원본 변경 전 안전중단.
  signal?: AbortSignal;
}): Promise<string> {
  const { userId, title: rawTitle, content, pubScope = "full", tags, imageUrl, categoryId, visibility = "public", scheduleTime, blocks, videoUrl, videoPosition = "middle", editLogNo, editBlogId, signal } = params;
  if (signal?.aborted) throw new Error("발행이 취소됐습니다");
  const isEdit = !!(editLogNo && /^\d+$/.test(String(editLogNo)));   // 글 살리기(덮어쓰기) 모드
  const title = rawTitle.replace(/\n/g, " ").trim().slice(0, 40);

  // pubScope에 따라 블록 필터링 + 마커 제거
  //   ★ "블록 단위"로 마커 포함 블록만 지우면, FAQ/Q&A가 여러 블록으로 쪼개졌을 때
  //     [FAQ시작] 마커 없는 Q&A 내용 블록이 살아남아 "본문만인데 Q&A가 들어가는" 버그가 됐다.
  //     FAQ·참고자료·관련글은 항상 글의 "뒷부분"이므로, 경계(시작 마커)가 처음 나오는 블록부터
  //     끝까지 통째로 잘라낸다(쪼개져도 확실히 제거). body=세 구간 전부, faq=참고자료·관련글만.
  const cutRe = pubScope === "body"
    ? /\[FAQ시작\]|\[참고자료시작\]|\[관련글시작\]/
    : pubScope === "faq"
    ? /\[참고자료시작\]|\[관련글시작\]/
    : null;
  let cutIdx = -1;
  if (cutRe) {
    cutIdx = (blocks || []).findIndex(b => b.type === "text" && cutRe.test(b.content || ""));
  }
  const keptBlocks = cutIdx >= 0 ? (blocks || []).slice(0, cutIdx) : (blocks || []);
  if (cutIdx >= 0) console.log(`[naver] 본문설정(${pubScope}): 경계 이후 ${(blocks || []).length - cutIdx}개 블록 제거`);
  const processedBlocks = keptBlocks.map(b =>
    b.type === "text" ? { ...b, content: cleanContent(b.content || "") } : b
  ) as typeof blocks;

  // 블록이 없는 예외 발행도 pubScope를 동일하게 지킨다.
  const scopedContent = pubScope === "body"
    ? content
        .replace(/\[FAQ시작\][\s\S]*?\[FAQ끝\]/g, "")
        .replace(/\[참고자료시작\][\s\S]*?\[참고자료끝\]/g, "")
        .replace(/\[관련글시작\][\s\S]*?\[관련글끝\]/g, "")
    : pubScope === "faq"
    ? content
        .replace(/\[참고자료시작\][\s\S]*?\[참고자료끝\]/g, "")
        .replace(/\[관련글시작\][\s\S]*?\[관련글끝\]/g, "")
    : content;
  const cleanedContent = cleanContent(scopedContent);
  const storedBlogId = readSession<any>(naverSessionName(userId), LEGACY_SESSION_DIRS)?.blogId;
  const cookies = await ensureLiveSessionNaver(userId);   // ★세션 만료면 저장된 비번으로 자동 재연결(캡차면 창 모드)
  // ★실제 blogId 확정(로그인ID≠블로그주소 대응) — 제목수정에서 검증된 공용 로직 재사용.
  //   특히 글 살리기(편집)는 정확한 blogId 아니면 PostWriteForm이 글목록으로 튕기므로 반드시 교정.
  const blogId = await resolveNaverBlogId(storedBlogId, cookies, userId, console.log);
  // ★작업 시작 요약 — 어떤 계정으로 어디로 보내는지(로그인 아이디·실제 블로그·대상 글 주소)를 맨 앞에 남긴다(테리 지시: 제대로 인식하는지 확인용).
  console.log(`[naver] ━━━━━ 작업 시작 ━━━━━`);
  console.log(`[naver] 로그인 계정: ${storedBlogId || "(세션 없음)"}${blogId && blogId !== storedBlogId ? ` → 실제 블로그: ${blogId}` : ""}`);
  console.log(isEdit
    ? `[naver] 작업 종류: 글 살리기(덮어쓰기) · 대상 글 https://blog.naver.com/${blogId}/${editLogNo}`
    : `[naver] 작업 종류: 새 글 발행 · 블로그 https://blog.naver.com/${blogId}`);
  if (isEdit && editBlogId) {
    const norm = (v: string) => String(v || "").trim().toLowerCase().replace(/@naver\.com$/i, "");
    if (norm(blogId) !== norm(editBlogId)) {
      throw new Error(`글 주인 계정 불일치: 선택 세션의 블로그는 '${blogId}', 살릴 글의 블로그는 '${editBlogId}'입니다. 원본은 변경하지 않았어요.`);
    }
    console.log(`[naver] ✅ 글 주인 계정 확인: ${blogId} (logNo=${editLogNo})`);
  }

  let closingExpected = false;
  const browser = await chromium.launch({ headless: false, args: LAUNCH_ARGS });
  const abortPublish = () => {
    closingExpected = true;
    void browser.close().catch(() => {});
  };
  signal?.addEventListener("abort", abortPublish, { once: true });
  const context = await browser.newContext({
    userAgent: UA, viewport: { width: 1280, height: 800 },
    locale: "ko-KR", timezoneId: "Asia/Seoul",
  });
  await applyAntiDetection(context);
  await context.addCookies(cookies);
  let page = await context.newPage();
  let lastPageAction = "발행 브라우저 초기화";
  let unexpectedPageClose = false;
  const markPageAction = (action: string) => { lastPageAction = action; };
  const assertPageOpen = (action: string) => {
    const previousAction = lastPageAction;
    markPageAction(action);
    if (page.isClosed()) {
      unexpectedPageClose = true;
      throw new Error(`네이버 발행 페이지가 닫혔습니다 (단계: ${action}, 직전 액션: ${previousAction})`);
    }
  };
  page.on("close", () => {
    if (closingExpected) return;
    unexpectedPageClose = true;
    console.error(`[naver] ❌ 발행 페이지 close 감지 (직전 액션: ${lastPageAction})`);
  });
  browser.on("disconnected", () => {
    if (closingExpected) return;
    console.error(`[naver] ❌ 발행 브라우저 disconnected 감지 (직전 액션: ${lastPageAction})`);
  });
  context.on("page", popup => {
    if (popup === page) return;
    console.log(`[naver] ⚠️ 새 탭/팝업 감지 — 원래 발행 page 유지 (직전 액션: ${lastPageAction})`);
    popup.waitForLoadState("domcontentloaded", { timeout: 5000 }).catch(() => {}).finally(() => {
      console.log(`[naver] 새 탭 URL: ${popup.isClosed() ? "(이미 닫힘)" : popup.url()}`);
    });
  });

  try {
    if (signal?.aborted) throw new Error("발행이 취소됐습니다");
    // 편집 성공은 URL이나 mainFrame 이름이 아니라 실제 SE ONE 제목 요소로 판정한다.
    // 공개 목록/보기에도 blog.naver.com 프레임이 있으므로 그것을 편집기로 오인하면 안 된다.
    const findEditorFrame = async (targetPage: Page): Promise<Frame | null> => {
      if (targetPage.isClosed()) return null;
      for (const candidate of targetPage.frames()) {
        if (await candidate.locator(".se-section-documentTitle").first().count().catch(() => 0)) return candidate;
      }
      return null;
    };
    const logEntryState = async (label: string) => {
      const frames = page.isClosed() ? [] : page.frames();
      const frameInfo = frames.map(f => `${f.name() || "(unnamed)"}=${f.url()}`).join(" | ");
      console.log(`[naver] 편집 진입 ${label} 최종 URL: ${page.isClosed() ? "(page closed)" : page.url()}`);
      console.log(`[naver] 편집 진입 ${label} 프레임(${frames.length}): ${frameInfo || "없음"}`);
    };
    const waitForEditor = async (label: string, timeoutMs = 15000): Promise<Frame | null> => {
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline && !page.isClosed()) {
        const found = await findEditorFrame(page);
        if (found) {
          console.log(`[naver] ✅ 편집기 확인(${label}): frame=${found.name() || "(unnamed)"}, url=${found.url()}`);
          return found;
        }
        // 잘못된 endpoint의 확정 실패는 15초를 다 기다리지 않는다.
        if (/PostList\.naver/i.test(page.url())) break;
        await page.waitForTimeout(500);
      }
      await logEntryState(label);
      return null;
    };

    let verifiedEditFrame: Frame | null = null;
    if (isEdit) {
      // ★검증된 제목수정(updatePostTitle) 진입과 동일: logNo를 Redirect 앞에 둔 형태가 실측으로 편집기를 연다.
      //   Redirect=Update가 logNo보다 앞이거나 categoryNo가 없으면 네이버가 대문(PrologueList)으로 튕긴다(실측 s9653 — 대문형 블로그).
      //   편집은 새 창을 띄우지 않으므로 같은 탭에서 순차 goto한다(context.waitForEvent('page')로 위젯 팝업을 잘못 채택하던 버그 제거).
      const editUrls = [
        `https://blog.naver.com/PostWriteForm.naver?blogId=${encodeURIComponent(blogId)}&logNo=${editLogNo}&Redirect=Update`,
        `https://blog.naver.com/PostWriteForm.naver?blogId=${encodeURIComponent(blogId)}&Redirect=Update&logNo=${editLogNo}&categoryNo=0`,
      ];
      for (let u = 0; u < editUrls.length && !verifiedEditFrame; u++) {
        console.log(`[naver] 글 살리기 진입(공식 Update, 시도 ${u + 1}/${editUrls.length}): ${editUrls[u]}`);
        markPageAction("편집 Update URL 이동");
        await page.goto(editUrls[u], { waitUntil: "domcontentloaded", timeout: 60000 }).catch(e => {
          console.log(`[naver] ⚠️ 편집 Update URL 이동 오류: ${e instanceof Error ? e.message : String(e)}`);
        });
        if (page.url().includes("nidlogin") || page.url().includes("login.naver")) {
          deleteSession(naverSessionName(userId), LEGACY_SESSION_DIRS);
          throw new Error("네이버 세션 만료. 재연결 필요");
        }
        verifiedEditFrame = await waitForEditor(`Update URL 시도${u + 1}`, 20000);
        if (!verifiedEditFrame) console.log(`[naver] 이 URL로는 편집기가 안 떠서 다음 형태로 재시도`);
      }

      if (!verifiedEditFrame) {
        // 직접 endpoint가 목록으로 튕기거나 창을 닫으면 깨끗한 탭에서 원문을 연 뒤,
        // 소유자에게만 노출되는 Update 링크/수정 버튼을 사용한다.
        if (page.isClosed()) page = await context.newPage();
        const viewUrl = `https://blog.naver.com/PostView.naver?blogId=${encodeURIComponent(blogId)}&logNo=${editLogNo}`;
        console.log(`[naver] 글 살리기 2차 진입(원문 소유자 수정 버튼): ${viewUrl}`);
        markPageAction("편집 원문 보기 이동");
        await page.goto(viewUrl, { waitUntil: "domcontentloaded", timeout: 60000 });
        await page.waitForLoadState("networkidle", { timeout: 10000 }).catch(() => {});
        await logEntryState("원문 보기");

        let editControl: { frame: Frame; selector: string } | null = null;
        const editSelectors = [
          `a[href*="PostWriteForm.naver"][href*="logNo=${editLogNo}"]`,
          `a[href*="Redirect=Update"][href*="logNo=${editLogNo}"]`,
          "a:has-text('수정')",
          "button:has-text('수정')",
        ];
        for (const candidate of page.frames()) {
          for (const selector of editSelectors) {
            const locator = candidate.locator(selector).filter({ visible: true }).first();
            if (await locator.count().catch(() => 0)) { editControl = { frame: candidate, selector }; break; }
          }
          if (editControl) break;
        }
        if (!editControl) throw new Error(`기존 글의 소유자 수정 버튼을 찾지 못했습니다 (logNo=${editLogNo}, 원본은 변경하지 않음)`);
        console.log(`[naver] 소유자 수정 컨트롤 클릭: ${editControl.selector}`);
        markPageAction("소유자 수정 버튼 클릭");
        const popupPromise = context.waitForEvent("page", { timeout: 12000 }).catch(() => null);
        await editControl.frame.locator(editControl.selector).filter({ visible: true }).first().click({ timeout: 10000 });
        const popup = await popupPromise;
        if (popup) {
          page = popup;
          await page.waitForLoadState("domcontentloaded", { timeout: 15000 }).catch(() => {});
          console.log(`[naver] 수정 버튼 새 페이지 채택: ${page.url()}`);
        }
        verifiedEditFrame = await waitForEditor("소유자 수정 버튼", 20000);
      }
      if (!verifiedEditFrame) {
        throw new Error(`스마트에디터 편집 화면 진입에 실패했습니다 (logNo=${editLogNo}, 원본은 변경하지 않음)`);
      }
    } else {
      // 새 글 경로는 기존 동작을 그대로 유지한다.
      const writeUrl = `https://blog.naver.com/GoBlogWrite.naver?blogId=${blogId}`;
      console.log(`[naver] 글쓰기 진입: ${writeUrl}`);
      assertPageOpen("글쓰기 페이지 이동 전");
      await page.goto(writeUrl, { waitUntil: "domcontentloaded", timeout: 60000 });
    }

    if (page.url().includes("nidlogin") || page.url().includes("login.naver")) {
      deleteSession(naverSessionName(userId), LEGACY_SESSION_DIRS);
      throw new Error("네이버 세션 만료. 재연결 필요");
    }

    console.log("[naver] SE4 로드 대기...");
    await page.waitForLoadState("networkidle", { timeout: 30000 }).catch(() => {});
    await page.waitForTimeout(5000);

    const getFrame = () => {
      if (isEdit) return verifiedEditFrame && !verifiedEditFrame.isDetached() ? verifiedEditFrame : null;
      const frames = page.frames();
      return frames.find(f => f.name() === "mainFrame")
        ?? frames.find(f => f.url().includes("blog.naver.com"))
        ?? frames[1] ?? null;
    };

    let frame: Frame = getFrame() as Frame;
    for (let i = 0; i < 10; i++) {
      await page.waitForTimeout(1000);
      frame = getFrame() as Frame;
      if (frame) break;
    }
    if (!frame) throw new Error("mainFrame을 찾을 수 없습니다");
    console.log("[naver] mainFrame 획득!");

    const ensureEditorReady = async (action: string) => {
      assertPageOpen(action);
      if (!frame || frame.isDetached()) {
        console.log(`[naver] ⚠️ mainFrame 재탐색 (단계: ${action})`);
        frame = getFrame() as Frame;
        if (!frame) throw new Error(`mainFrame이 분리되었습니다 (단계: ${action})`);
      }
    };

    // 복원 팝업 처리
    try {
      await frame.click(".se-popup-button-cancel", { timeout: 3000 });
      await page.waitForTimeout(1000);
    } catch {}

    // 도움말 닫기
    try {
      const helpVisible = await frame.isVisible(".se-help-panel-close-button");
      if (helpVisible) await frame.click(".se-help-panel-close-button", { timeout: 2000 });
    } catch {}

    // 편집 모드는 위에서 제목 요소까지 검증했다. 새 글도 기존 셀렉터 로드를 기다린다.
    if (isEdit) {
      await frame.waitForSelector(".se-section-documentTitle", { timeout: 5000 });
    } else {
      try {
        await frame.waitForSelector(".se-section-documentTitle, .se-editor, .se-container", { timeout: 40000 });
      } catch {}
    }
    await page.waitForTimeout(3000);

    // ── 제목 입력 ──
    console.log("[naver] 제목 입력...");
    await ensureEditorReady("제목 입력 전");
    // 제목 클릭 후 입력
    try {
      await frame.click(".se-section-documentTitle", { timeout: 5000 });
    } catch {
      await frame.click(".se-main-container", { timeout: 3000 }).catch(() => {});
    }
    await page.waitForTimeout(500);
    // ★글 살리기(편집): 기존 제목이 남아있으니 전체선택·삭제 후 새 제목 입력(안 그러면 붙어버림)
    if (isEdit) {
      const SEL_A = process.platform === "darwin" ? "Meta+A" : "Control+A";
      await page.keyboard.press(SEL_A); await page.waitForTimeout(150);
      await page.keyboard.press("Backspace"); await page.waitForTimeout(300);
      console.log("[naver] 글살리기: 기존 제목 비움 → 새 제목 입력");
    }
    await page.keyboard.type(title, { delay: 30 });
    await page.waitForTimeout(600);

    // 본문으로 이동 1순위: Enter (SE4 표준 - 제목에서 Enter → 본문 이동)
    console.log("[naver] 본문 영역으로 이동...");
    await page.keyboard.press("Enter");
    await page.waitForTimeout(600);

    // 이동됐는지 확인
    const stillInTitle = await frame.evaluate(() => {
      const el = document.activeElement;
      return !!document.querySelector(".se-section-documentTitle")?.contains(el);
    }).catch(() => false);
    if (stillInTitle) {
      // 2순위: frame.click으로 본문 contenteditable 직접 클릭
      try {
        await frame.click(".se-section:not(.se-section-documentTitle) [contenteditable='true']", { timeout: 3000, force: true });
        await page.waitForTimeout(400);
      } catch {
        // 3순위: 마우스로 제목 아래 클릭
        const titleEl = await frame.$(".se-section-documentTitle").catch(() => null);
        if (titleEl) {
          const box = await titleEl.boundingBox().catch(() => null);
          if (box) {
            await page.mouse.click(box.x + box.width / 2, box.y + box.height + 100);
            await page.waitForTimeout(400);
          }
        }
      }
    }
    await page.waitForTimeout(300);

    // ★글 살리기(편집): 본문 영역에 커서가 있는 지금, 기존 본문(글+이미지)을 전체선택·삭제해 비운다.
    //   이미지가 남을 수 있어 2회 반복. 이후 아래 로직이 빈 에디터에 새 본문·이미지를 채운다(=새 글과 동일).
    //   ⚠️ 실기기 검증 필요(에디터 구조 따라 Cmd+A 범위가 다를 수 있음) — 로그로 확인.
    if (isEdit) {
      const SEL_A = process.platform === "darwin" ? "Meta+A" : "Control+A";
      for (let z = 0; z < 3; z++) {
        await page.keyboard.press(SEL_A); await page.waitForTimeout(200);
        await page.keyboard.press("Backspace"); await page.waitForTimeout(400);
      }
      const leftover = await frame.evaluate(() => {
        const imgs = document.querySelectorAll(".se-component.se-image").length;
        const txt = (document.querySelector(".se-main-container")?.textContent || "").replace(/\s/g, "").length;
        return { imgs, txt };
      }).catch(() => ({ imgs: -1, txt: -1 }));
      console.log(`[naver] 글살리기: 기존 본문 비움 시도 → 남은 이미지 ${leftover.imgs}개·글자 ${leftover.txt}자`);
    }

    // ── 파일 업로드 헬퍼 (OS 파일 피커 다이얼로그 차단) ──
    const IMG_BTN_SELS = [
      "button[data-type='image']",
      "button[data-name='image']",
      "button[data-testid*='image' i]",
      ".se-toolbar-item-imageUpload button",
      ".se-toolbar-item-image button",
      "button[title='이미지']",
      "button[aria-label='이미지']",
      "button[aria-label*='사진']",
      ".se-toolbar button[class*='image']",
    ];
    const PC_UPLOAD_SELS = [
      ".se-popup-button-upload-file",
      "button:has-text('내 PC에서')",
      "button:has-text('컴퓨터에서')",
      ".se-image-select-type-upload button",
    ];

    async function uploadFileToEditor(files: string | string[]): Promise<boolean> {
      const fileList = Array.isArray(files) ? files : [files];
      for (let attempt = 1; attempt <= 3; attempt++) {
        await ensureEditorReady(`이미지 업로드 버튼 탐색 ${attempt}/3`);
        // 연속 업로드 뒤 툴바가 화면 밖/비활성 상태가 되는 경우 본문을 다시 활성화한다.
        await frame.locator(".se-toolbar, [class*='toolbar']").first().scrollIntoViewIfNeeded().catch(() => {});
        if (attempt > 1) {
          await frame.locator(".se-main-container").first().click({ timeout: 1500 }).catch(() => {});
          await page.waitForTimeout(500);
        }
        for (const sel of IMG_BTN_SELS) {
          try {
            const btn = await frame.$(sel) ?? await page.$(sel);
            if (!btn || !(await btn.isVisible().catch(() => false))) continue;
            await btn.scrollIntoViewIfNeeded().catch(() => {});
            markPageAction(`이미지 버튼 클릭 (${sel}, ${attempt}/3)`);
            // filechooser 인터셉션 먼저 등록 → OS 다이얼로그 차단
            const chooserPromise = page.waitForEvent("filechooser", { timeout: 5000 }).catch(() => null);
            await btn.click({ timeout: 3000 });
            await page.waitForTimeout(700);
            await ensureEditorReady("이미지 업로드 방식 선택 전");
            // 일부 SE4 버전은 모달 → "내 PC에서 올리기" 버튼 필요
            for (const pcSel of PC_UPLOAD_SELS) {
              try {
                const pcBtn = await frame.$(pcSel) ?? await page.$(pcSel);
                if (pcBtn) { markPageAction(`내 PC 업로드 클릭 (${pcSel})`); await pcBtn.click(); await page.waitForTimeout(300); break; }
              } catch {}
            }
            const chooser = await chooserPromise;
            if (chooser) {
              markPageAction(`파일 선택 적용 (${fileList.length}개)`);
              await chooser.setFiles(fileList);
              await page.waitForTimeout(4000);
              await ensureEditorReady("이미지 파일 적용 후");
              return true;
            }
            // fallback: 숨겨진 file input 직접 세팅
            const fi = await page.$("input[type='file']") ?? await frame.$("input[type='file']");
            if (fi) { markPageAction("숨겨진 file input 적용"); await fi.setInputFiles(fileList); await page.waitForTimeout(4000); await ensureEditorReady("이미지 file input 적용 후"); return true; }
          } catch (e: any) {
            if (page.isClosed()) throw e;
            console.log(`[naver] ⚠️ 이미지 버튼 시도 실패 (${attempt}/3, ${sel}): ${String(e?.message || e).split("\n")[0]}`);
          }
        }
        if (attempt < 3) {
          console.log(`[naver] 이미지 버튼 재탐색 대기 (${attempt}/3)`);
          await page.waitForTimeout(800);
        }
      }
      return false;
    }

    // ── 이미지 삽입 (썸네일) ──
    // ★ 썸네일(imageUrl)이 이미 본문 이미지 블록 중 하나면 맨 위에 또 넣지 않는다.
    //   (예전엔 맨 위에 넣고 본문 루프에서 같은 걸 건너뛰었는데, 맨 위 삽입이 실패하면
    //    그 이미지가 위에서도 본문에서도 빠져 "4장 만들었는데 3장"이 됐다. 이제 본문에 전부 넣는다.
    //    네이버 대표 이미지는 본문 첫 이미지로 자동 지정됨.)
    const thumbInBody = !!imageUrl && (processedBlocks || []).some(b =>
      (b.type === "image" && b.src === imageUrl) ||
      (b.type === "image-pair" && (b as any).images?.some((img: {src?: string}) => img.src === imageUrl))
    );
    if (imageUrl && !thumbInBody) {
      console.log("[naver] 이미지 삽입 시도...");
      const tmpFile = await downloadImageToTemp(imageUrl);
      if (tmpFile) {
        try {
          const ok = await uploadFileToEditor(tmpFile);
          if (ok) console.log("[naver] ✅ 썸네일 이미지 업로드 완료");
        } catch (e) {
          console.log("[naver] 이미지 삽입 실패 (무시):", e);
        } finally {
          try { fs.unlinkSync(tmpFile); } catch {}
        }
      }
    }

    // ── 본문 + 이미지 블록 순서대로 입력 ──
    console.log("[naver] 본문+이미지 블록 순서 발행 시작...");

    // SE4 에디터 클릭 헬퍼
    async function clickEditor() {
      const bodySels = [
        ".se-section-text .se-text-paragraph span[contenteditable='true']",
        ".se-section-text [contenteditable='true']",
        ".se-main-container .se-section:not(.se-section-documentTitle) [contenteditable='true']",
        ".se-component-content [contenteditable='true']",
      ];
      for (const sel of bodySels) {
        try {
          const el = await frame.$(sel);
          if (el) { await frame.click(sel, { timeout: 3000 }); return true; }
        } catch {}
      }
      await frame.click(".se-main-container", { timeout: 3000 }).catch(() => {});
      return false;
    }

    // ── 커서를 문서 맨 끝(마지막 블록의 끝)으로 확실히 이동 ──
    //   기존 Meta+End 단독은 Mac에서 '스크롤'만 하고 커서를 안 옮겨 글/이미지가 중간에 끼어들던 근본 버그를 잡음.
    async function moveCursorToEnd() {
      // 마지막 편집영역(가장 아래 contenteditable)을 실제 클릭 → 커서가 문서 끝으로.
      //   ⚠️ frame.evaluate(Selection API)는 이미지 업로드 직후 실제 브라우저에서 무한 대기/페이지 닫힘을
      //   유발(headless에선 재현 안 됨, 실측으로 확인). Meta+End(Mac)도 페이지 닫힘 유발. → 클릭 방식만 사용.
      const bodySels = [
        ".se-section-text:last-of-type [contenteditable='true']",
        ".se-main-container .se-section:not(.se-section-documentTitle):last-of-type [contenteditable='true']",
        ".se-section-text [contenteditable='true']",
        ".se-main-container .se-section:not(.se-section-documentTitle) [contenteditable='true']",
      ];
      // ★v2.0.30(잘 되던 때)로 되돌림: 마지막 편집영역을 "무조건" 클릭해 커서를 확실히 본문에 둔다.
      //   v2.0.44에서 캡션칸(.se-caption) skip을 넣었더니, 이미지 바로 다음에 본문 문단이 아직 없을 때
      //   클릭할 대상이 하나도 없어 커서가 붕 뜨고 → 이미지 직후 첫 텍스트(제휴 광고고지)가 통째로
      //   유실되던 회귀가 생겼다. 캡션 오염 방지보다 "제휴문구가 아예 안 나오는" 게 더 큰 문제라 원복.
      for (const sel of bodySels) {
        try {
          const els = await frame.$$(sel);
          if (els.length) { await els[els.length - 1].click({ timeout: 3000 }); await page.waitForTimeout(120); return; }
        } catch {}
      }
      await frame.click(".se-main-container", { timeout: 3000 }).catch(() => {});
      await page.waitForTimeout(120);
    }

    // 텍스트 블록 입력 헬퍼
    //   spacerBefore=true면 앞 내용과 사이에 빈 줄 하나를 먼저 넣어 문단이 붙지 않게(모바일 가독성)
    let anyBodyWritten = false;
    async function insertText(text: string, spacerBefore = false) {
      await ensureEditorReady("본문 텍스트 입력 전");
      const isHtml = /<[a-z][\s\S]*>/i.test(text);
      const plain = isHtml
        ? text
            .replace(/<br\s*\/?>/gi, "\n")
            .replace(/<\/p>/gi, "\n").replace(/<\/h[1-6]>/gi, "\n").replace(/<\/div>/gi, "\n")
            .replace(/<hr[^>]*>/gi, "\n---\n")
            .replace(/<figcaption[^>]*>([\s\S]*?)<\/figcaption>/gi, "[$1]")
            .replace(/<[^>]+>/g, "")
            .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"')
            .replace(/[\n]{3,}/g, "\n\n").trim()
        : text;

      await moveCursorToEnd();
      await page.waitForTimeout(200);
      // ★진단+방어: 본문 타이핑 직전 커서가 이미지 캡션칸(.se-caption)에 있으면 본문으로 다시 이동.
      //   (제휴 광고고지 등 본문 텍스트가 캡션에 새는 것 방지. throw 없이 — 못 빼도 그냥 진행.)
      //   어떤 텍스트를 넣는지 + 캡션에서 뺐는지 로그로 남겨 실제 경로를 눈으로 확인 가능하게.
      const beforeCap = await frame.evaluate(() => !!(document.activeElement as HTMLElement | null)?.closest(".se-caption")).catch(() => false);
      if (beforeCap) {
        console.log(`[naver] ⚠️ 본문 입력 직전 커서가 캡션칸 감지 → 본문으로 이동 (텍스트: ${plain.slice(0, 20)})`);
        await moveCursorToEnd();
        await page.waitForTimeout(120);
      }
      console.log(`[naver] 본문 텍스트 입력: ${plain.slice(0, 25)}${plain.length > 25 ? "…" : ""}`);
      // 앞 문단/이미지와 사이에 빈 줄 하나 → 문단이 딱 붙지 않게(모바일 가독성)
      //   블록 사이도 "엔터 2번(빈 줄 하나)"으로 통일 — 블록 안 문단 간격과 동일하게 숨통 트이게.
      if (spacerBefore && anyBodyWritten) {
        await page.keyboard.press("Enter");
        await page.waitForTimeout(120);
        await page.keyboard.press("Enter");
        await page.waitForTimeout(120);
      }
      const lines = plain.split("\n").filter(l => l.trim().length > 0); // 빈 줄 정리 후 균일 간격 적용
      for (let i = 0; i < lines.length; i++) {
        // delay를 높여 SE4가 붙여넣기가 아닌 진짜 타이핑으로 인식
        await ensureEditorReady(`본문 ${i + 1}/${lines.length}줄 입력 직전`);
        const isUrlLine = /^https?:\/\/\S+$/.test(lines[i].trim());   // 그 줄이 "URL만"인지
        await page.keyboard.type(lines[i], { delay: 80 });
        await page.waitForTimeout(100);
        anyBodyWritten = true;
        if (isUrlLine) {
          // ★URL 줄: 바로 Enter를 눌러 네이버가 '링크 카드'로 변환하게 하고, 카드가 렌더될 때까지 기다린다.
          //   (안 기다리면 URL이 생링크로 남고, 다음 본문이 카드보다 먼저 들어가 이미지-링크 사이에 글이 낀다.
          //    테리 실측: 온파트너 URL이 파란 생링크로 뜨고 본문이 그 밑에 끼던 문제. 임베드와 동일한 대기 방식.)
          await page.keyboard.press("Enter");
          await page.waitForTimeout(3500);   // 링크 카드 변환/렌더 대기
          console.log("[naver] 🔗 링크 카드 변환 대기 완료");
          if (i < lines.length - 1) { await page.keyboard.press("Enter"); await page.waitForTimeout(120); }
          continue;
        }
        if (i < lines.length - 1) {
          // 문단 사이: Enter 2번(빈 줄 하나) → 줄글이 빽빽하지 않게
          await page.keyboard.press("Enter");
          await page.waitForTimeout(120);
          await page.keyboard.press("Enter");
          await page.waitForTimeout(120);
        }
      }
    }

    // ★ 올린 이미지의 "네이버 전용 캡션칸"에 설명 직접 입력 (실측 DOM: .se-caption / placeholder "사진 설명을 입력하세요.")
    //   fromEnd=0 이면 가장 최근 이미지, 1이면 그 앞 이미지(페어의 첫 장 등)
    async function fillLastImageCaption(text: string, fromEnd: number = 0): Promise<boolean> {
      const cap = (text || "").trim();
      if (!cap) return false;
      try {
        await ensureEditorReady("이미지 캡션 입력 전");
        // 대상 이미지 컴포넌트 선택
        const comps = await frame.$$(".se-component.se-image");
        const comp = comps[comps.length - 1 - fromEnd];
        if (!comp) return false;
        await comp.scrollIntoViewIfNeeded().catch(() => {});
        // ★ 이미지를 먼저 클릭해 컴포넌트 활성화 → 빈 캡션(height 0)이 열림 (실측 확인)
        const imgRes = await comp.$(".se-image-resource") ?? await comp.$("img");
        if (imgRes) { await imgRes.click({ force: true }).catch(() => {}); await page.waitForTimeout(500); }
        // 캡션 문단 클릭 → 타이핑 (force 실패 시 좌표 클릭 폴백)
        const capMod = await comp.$(".se-caption");
        if (!capMod) return false;
        const p = await capMod.$(".se-text-paragraph") ?? capMod;
        try { await p.click({ timeout: 5000, force: true }); }
        catch { const r = await p.boundingBox(); if (r) await page.mouse.click(r.x + r.width / 2, r.y + r.height / 2); }
        await page.waitForTimeout(300);
        await ensureEditorReady("이미지 캡션 타이핑 직전");
        await page.keyboard.type(cap, { delay: 25 });
        await page.waitForTimeout(200);
        return true;
      } catch { return false; }
    }

    // 이미지 업로드 헬퍼
    // ★ 마지막 이미지에 링크 걸기(온파트너 배너 클릭 → 쇼핑몰). 실측 DOM: .se-link-toolbar-button + .se-custom-layer-link-input
    async function linkLastImage(url: string): Promise<boolean> {
      const link = (url || "").trim();
      if (!/^https?:\/\//.test(link)) return false;
      try {
        await ensureEditorReady("이미지 링크 입력 전");
        const comps = await frame.$$(".se-component.se-image");
        const comp = comps[comps.length - 1];
        if (!comp) return false;
        await comp.scrollIntoViewIfNeeded().catch(() => {});
        const imgRes = await comp.$(".se-image-resource") ?? await comp.$("img");
        if (imgRes) { await imgRes.click({ force: true }).catch(() => {}); await page.waitForTimeout(400); }
        // 이미지 링크 버튼 클릭
        const btnClicked = await frame.evaluate(() => {
          const b = document.querySelector(".se-link-toolbar-button") as HTMLElement | null;
          if (b) { b.click(); return true; } return false;
        });
        if (!btnClicked) return false;
        await page.waitForTimeout(600);
        // URL 입력칸에 입력
        const input = await frame.$(".se-custom-layer-link-input");
        if (!input) return false;
        await input.click({ force: true }).catch(() => {});
        await input.fill(link).catch(async () => { await ensureEditorReady("이미지 링크 타이핑 폴백 직전"); await page.keyboard.type(link, { delay: 15 }); });
        await page.waitForTimeout(300);
        // ★확인은 Enter가 아니라 "링크 입력" 적용 버튼 클릭이어야 실제로 걸린다(실측 확인).
        let applied = await frame.evaluate(() => {
          const b = document.querySelector(".se-custom-layer-link-apply-button") as HTMLElement | null;
          if (b) { b.click(); return true; } return false;
        });
        if (!applied) { await ensureEditorReady("이미지 링크 적용 Enter 직전"); await page.keyboard.press("Enter"); }  // 폴백
        await page.waitForTimeout(600);
        // 검증: 이미지가 링크로 감싸졌는지 확인(안 됐으면 실패 반환)
        const ok = await frame.evaluate(() => {
          const comp = [...document.querySelectorAll(".se-component.se-image")].pop();
          return !!(comp && comp.querySelector("a[href]"));
        });
        return ok;
      } catch { return false; }
    }
    // ★ 마지막 이미지 가운데 정렬
    async function centerLastImage(): Promise<void> {
      try {
        const comps = await frame.$$(".se-component.se-image");
        const comp = comps[comps.length - 1];
        if (!comp) return;
        const imgRes = await comp.$(".se-image-resource") ?? await comp.$("img");
        if (imgRes) { await imgRes.click({ force: true }).catch(() => {}); await page.waitForTimeout(300); }
        await frame.evaluate(() => {
          const btn = [...document.querySelectorAll("button")].find(b => /가운데 정렬/.test(b.getAttribute("aria-label") || "")) as HTMLElement | null;
          if (btn) btn.click();
        });
        await page.waitForTimeout(300);
      } catch {}
    }

    async function uploadImage(imgUrl: string, alt?: string, link?: string) {
      const tmpFile = await downloadImageToTemp(imgUrl);
      if (!tmpFile) { console.log("[naver] 이미지 다운로드 실패:", imgUrl.slice(0,60)); return; }
      try {
        await moveCursorToEnd();
        await page.keyboard.press("Enter");
        await page.waitForTimeout(500);

        const ok = await uploadFileToEditor(tmpFile);
        if (ok) {
          console.log("[naver] ✅ 이미지 업로드 완료");
          if (alt?.trim()) {
            // ★캡션 있는 이미지(본문 이미지): 이미지를 클릭해 정렬 + 캡션 입력.
            //   캡션 타이핑이 이미지를 '확정'해 커서가 본문으로 정상 복귀하므로 이미지를 잡아도 안전.
            await centerLastImage();
            const capOk = await fillLastImageCaption(alt.trim());
            console.log(capOk ? "[naver] ✅ 이미지 캡션 입력: " + alt.trim() : "[naver] ⚠️ 캡션칸 못찾음(캡션 생략)");
          } else {
            // ★캡션 없는 이미지(온파트너 썸네일 등)의 근본해결 (테리 실측 진단, 2026-08-21):
            //   증상=썸네일을 '잡아(선택)' 캡션을 쓰려다, 캡션을 안 쓰니 번쩍하며 이미지가 선택된 채 남고
            //        바로 다음 제휴문구가 갈 곳 없이 통째로 날아감('썸네일 한 번 클릭할 때 날린다').
            //   해결=캡션 없는 이미지는 "이미지를 절대 클릭/선택/정렬하지 않는다".
            //        업로드 직후 커서가 이미지 다음 본문에 있는 '자연 상태'를 그대로 두면 제휴문구가 정상 입력된다.
            //        (정렬 centerLastImage()도 이미지를 클릭하므로 캡션 없을 땐 생략 — 정렬보다 제휴문구가 우선.)
            console.log("[naver] 캡션 없는 이미지 → 이미지 안 건드림(선택/정렬/캡션 전부 생략, 제휴문구 유실 방지)");
          }
          // 온파트너 배너 등: 이미지에 링크 걸기(클릭 시 쇼핑몰)
          if (link?.trim()) {
            const linkOk = await linkLastImage(link.trim());
            console.log(linkOk ? "[naver] ✅ 이미지 링크 연결: " + link.trim() : "[naver] ⚠️ 이미지 링크 연결 실패");
          }
        } else {
          console.log(`[naver] 이미지 버튼 3회 못 찾음 - 이미지 스킵: ${imgUrl.slice(0, 100)}`);
        }
      } catch (e) {
        if (page.isClosed()) throw e;
        console.log("[naver] 이미지 업로드 실패:", e);
      } finally {
        try { fs.unlinkSync(tmpFile); } catch {}
      }
      await page.waitForTimeout(1000);
    }

    // ── 영상 임베드 헬퍼 ──
    //   네이버 블로그는 본문에 유튜브/네이버TV URL을 타이핑+Enter하면 자동 임베드됨(실측 확인).
    async function embedVideo(url: string) {
      const u = (url || "").trim();
      if (!u || !/^https?:\/\//.test(u)) return;
      try {
        console.log(`[naver] 영상 임베드: ${u.slice(0, 60)}`);
        await moveCursorToEnd();
        await page.keyboard.press("Enter");
        await page.waitForTimeout(200);
        await page.keyboard.type(u, { delay: 40 });
        await page.keyboard.press("Enter");
        await page.waitForTimeout(3500); // 임베드 변환 대기
        console.log("[naver] ✅ 영상 임베드 완료");
      } catch (e: any) {
        console.log("[naver] 영상 임베드 실패(무시):", e.message);
      }
    }

    // 영상을 상단에 넣는 경우: 본문 시작 전에 먼저
    if (videoUrl && videoPosition === "top") await embedVideo(videoUrl);

    // 영상 middle 위치용: 텍스트 블록 중간 지점 계산
    const totalTextBlocks = (processedBlocks || []).filter(b => b.type === "text").length;
    const videoMidPoint = Math.max(1, Math.floor(totalTextBlocks / 2));
    let textSeen = 0, videoMidDone = false;

    // processedBlocks(필터링+마커제거) 사용, 없으면 cleanedContent
    if (processedBlocks && processedBlocks.length > 0) {
      for (const block of processedBlocks) {
        if (block.type === "text" && block.content) {
          await insertText(block.content, true); // 앞 블록과 빈 줄 간격
          await page.waitForTimeout(200);
          // 영상 middle: 중간 문단 뒤에 삽입
          if (videoUrl && videoPosition === "middle" && !videoMidDone) {
            textSeen++;
            if (textSeen >= videoMidPoint) { await embedVideo(videoUrl); videoMidDone = true; }
          }
        } else if (block.type === "image-pair" && (block as any).images?.length >= 2) {
          // 2장 동시 업로드 → 한 줄 나란히 배치
          const pairImages = (block as any).images as {src:string;alt:string}[];
          const tmp1 = await downloadImageToTemp(pairImages[0].src);
          const tmp2 = await downloadImageToTemp(pairImages[1].src);
          if (tmp1 && tmp2) {
            try {
              await moveCursorToEnd();
              await page.keyboard.press("Enter");
              await page.waitForTimeout(500);
              const ok = await uploadFileToEditor([tmp1, tmp2]);
              if (ok) {
                console.log("[naver] ✅ 이미지 페어 업로드 완료");
                // 두 장 각각의 캡션칸에 입력 (fromEnd 0=둘째장, 1=첫째장)
                let capDone = false;
                if (pairImages[1].alt?.trim()) capDone = await fillLastImageCaption(pairImages[1].alt.trim(), 0) || capDone;
                if (pairImages[0].alt?.trim()) capDone = await fillLastImageCaption(pairImages[0].alt.trim(), 1) || capDone;
                // 캡션칸을 못 찾으면 문단 폴백
                if (!capDone) {
                  const pairAlt = pairImages[0].alt || pairImages[1].alt;
                  if (pairAlt?.trim()) {
                    try { await moveCursorToEnd(); await page.keyboard.press("Enter"); await insertText(pairAlt.trim()); } catch {}
                  }
                }
              }
            } catch(e) { console.log("[naver] 페어 이미지 업로드 실패:", e); }
            finally {
              try { fs.unlinkSync(tmp1); } catch {}
              try { fs.unlinkSync(tmp2); } catch {}
            }
          }
        } else if (block.type === "image" && block.src) {
          // 본문 이미지는 전부 순서대로 삽입(썸네일 중복 삽입은 위에서 thumbInBody로 이미 방지).
          await uploadImage(block.src, block.alt, (block as any).link);
        }
      }
    } else {
      // fallback: blocks 없으면 cleanedContent 입력
      await insertText(cleanedContent);
    }

    // 영상 bottom(끝) + middle이 못 들어간 경우(텍스트 적음) 폴백으로 끝에 삽입
    if (videoUrl && (videoPosition === "bottom" || (videoPosition === "middle" && !videoMidDone))) {
      await embedVideo(videoUrl);
    }

    await page.waitForTimeout(1000);

    // ── 발행 패널 열기 ──
    console.log("[naver] 발행 패널 열기...");
    await ensureEditorReady("발행 패널 열기 전");
    const publishSels = [
      "button.publish_btn__Y8C4q",
      "button[class*='publish_btn']",
      "button[data-testid='seOnePublishBtn']",
      "button:has-text('발행')",
    ];
    let panelOpened = false;
    for (const sel of publishSels) {
      try {
        const el = await frame.$(sel);
        if (el) { await frame.click(sel, { timeout: 5000 }); panelOpened = true; break; }
      } catch {}
    }
    if (!panelOpened) throw new Error("발행 버튼을 찾을 수 없습니다");
    await page.waitForTimeout(2500);

    // ── 태그 입력 ──
    if (tags.length > 0) {
      await ensureEditorReady("태그 입력 전");
      try {
        const tagSel = "input.tag_input__YWKIP, input[class*='tag_input'], input[placeholder*='태그']";
        const tagEl = await frame.$(tagSel);
        if (tagEl) {
          await frame.click(tagSel, { timeout: 5000 });
          for (const tag of tags.slice(0, 30)) {
            await frame.fill(tagSel, tag);
            await page.keyboard.press("Enter");
            await page.waitForTimeout(200);
          }
          console.log(`[naver] 태그 ${tags.length}개 입력`);
        }
      } catch (e) { console.log("[naver] 태그 입력 실패 (무시):", e); }
    }

    // ── 카테고리 선택 (SmartEditor ONE: option_category 안의 라디오 목록) ──
    if (categoryId) {
      console.log(`[naver] 카테고리 선택: ${categoryId}`);
      await ensureEditorReady("카테고리 선택 전");
      try {
        // 발행 레이어의 카테고리 영역 대기
        try { await frame.waitForSelector("[class*='option_category']", { timeout: 6000 }); } catch {}
        // 드롭다운 펼치기
        await frame.evaluate(() => {
          const oc = document.querySelector("[class*='option_category']");
          const btn = oc?.querySelector("button,[role='button']") as HTMLElement | null;
          if (btn) btn.click();
        });
        await page.waitForTimeout(800);
        // categoryId(숫자)와 일치하는 라디오/라벨 클릭 (data-testid=categoryBtn_{id} 또는 input id="{id}_이름")
        const done = await frame.evaluate((cid: string) => {
          const oc = document.querySelector("[class*='option_category']");
          if (!oc) return false;
          const radios = Array.from(oc.querySelectorAll("li input[type=radio]")) as HTMLInputElement[];
          const match = radios.find(r => {
            const t = r.getAttribute("data-testid") || "";
            const m = t.match(/categoryBtn_(\d+)/);
            const idFromTest = m ? m[1] : "";
            const idFromId = (r.id || "").split("_")[0];
            return idFromTest === cid || idFromId === cid;
          });
          if (!match) return false;
          const label = oc.querySelector(`label[for="${CSS.escape(match.id)}"]`) as HTMLElement | null;
          (label || match).click();
          return true;
        }, categoryId);
        await page.waitForTimeout(500);
        console.log(done ? "[naver] ✅ 카테고리 선택 완료" : "[naver] ⚠️ 일치 카테고리 못찾음(ID:" + categoryId + ")");
      } catch (e) { console.log("[naver] 카테고리 선택 실패 (무시):", e); }
    }

    // ── 공개 설정 ──
    console.log(`[naver] 공개 설정: ${visibility}`);
    await ensureEditorReady("공개 설정 전");
    try {
      if (visibility === "neighbor") {
        // 이웃공개
        const neighborSels = [
          "button:has-text('이웃공개')",
          "label:has-text('이웃공개')",
          "input[value='1'] + label",
          ".option_publish [class*='neighbor']",
        ];
        for (const sel of neighborSels) {
          try {
            const el = await frame.$(sel);
            if (el) { await frame.click(sel, { timeout: 3000 }); break; }
          } catch {}
        }
      } else if (visibility === "private") {
        // 비공개
        const privateSels = [
          "button:has-text('비공개')",
          "label:has-text('비공개')",
          "input[value='2'] + label",
          ".option_publish [class*='private']",
        ];
        for (const sel of privateSels) {
          try {
            const el = await frame.$(sel);
            if (el) { await frame.click(sel, { timeout: 3000 }); break; }
          } catch {}
        }
      }
      // public은 기본값이므로 별도 클릭 불필요
      await page.waitForTimeout(400);
    } catch (e) { console.log("[naver] 공개 설정 실패 (무시):", e); }

    // ── 예약 발행 (네이버 발행 레이어의 "예약" 기능에 시간 설정) ──
    //   ★ 네이버 예약 UI 실제 구조(2026): 발행 옵션에서 "예약" 라디오 선택 → 날짜(달력 셀 클릭) +
    //     시(select) + 분(select, 10분 단위). 예전엔 text input에 넣으려 해 전혀 안 먹혔음.
    //   즉시 글·이미지 작성 후 예약 확정 → PC 꺼도 네이버 서버가 그 시간에 발행.
    if (scheduleTime) {
      console.log(`[naver] 예약 발행 설정: ${scheduleTime}`);
      await ensureEditorReady("예약 발행 설정 전");
      try {
        const dt = new Date(scheduleTime);
        if (Number.isNaN(dt.getTime())) throw new Error("예약시간 형식이 올바르지 않습니다");
        // 봇 OS 타임존과 무관하게 네이버 UI에는 한국시간을 넣는다.
        const kst = new Date(dt.getTime() + 9 * 60 * 60 * 1000);
        const year = kst.getUTCFullYear();
        const month = kst.getUTCMonth() + 1;        // 1~12
        const day = kst.getUTCDate();               // 1~31
        const hour = kst.getUTCHours();             // 0~23
        const min = Math.floor(kst.getUTCMinutes() / 10) * 10; // 네이버는 10분 단위 → 내림

        // 1) "예약" 라디오 선택 (텍스트 → label 연결 radio → radio 직접 클릭 순서)
        const checkReserveSelected = () => frame.evaluate(() => {
          const visible = (e: Element) => {
            const el = e as HTMLElement;
            const s = getComputedStyle(el);
            const r = el.getBoundingClientRect();
            return s.display !== "none" && s.visibility !== "hidden" && r.width > 0 && r.height > 0;
          };
          const radios = [...document.querySelectorAll("input[type=radio]")] as HTMLInputElement[];
          if (radios.some(r => r.checked && /reserve|예약/i.test(`${r.value} ${r.id} ${r.name}`))) return true;
          const reserveOptions = [...document.querySelectorAll("label, button, [role=radio], [role=button]")]
            .filter(e => /예약/.test((e.textContent || "").replace(/\s/g, "")) && !/예약취소|취소예약/.test((e.textContent || "").replace(/\s/g, "")));
          if (reserveOptions.some(e =>
            e.getAttribute("aria-checked") === "true" || e.getAttribute("aria-selected") === "true" ||
            /active|selected|checked|on/i.test(String(e.className))
          )) return true;
          const visibleSelects = [...document.querySelectorAll("select")].filter(visible);
          const calendar = [...document.querySelectorAll("[class*='calendar' i], [class*='datepicker' i], [role=grid]")].some(visible);
          return visibleSelects.length >= 2 || calendar;
        });

        let reserveSelected = false;
        const pickMethods = ["text", "label-for", "radio"] as const;
        for (const method of pickMethods) {
          const clicked = await frame.evaluate((pickMethod) => {
            const normalized = (e: Element) => (e.textContent || "").replace(/\s/g, "");
            const isReserve = (e: Element) => /예약/.test(normalized(e)) && !/예약취소|취소예약/.test(normalized(e));
            if (pickMethod === "text") {
              const cands = [...document.querySelectorAll("label, button, [role=radio], [role=button], a, span")];
              const target = cands.find(e => normalized(e) === "예약") || cands.find(isReserve);
              if (target) { (target as HTMLElement).click(); return target.tagName.toLowerCase(); }
            } else if (pickMethod === "label-for") {
              const labels = [...document.querySelectorAll("label[for]")].filter(isReserve) as HTMLLabelElement[];
              for (const label of labels) {
                const radio = document.getElementById(label.htmlFor) as HTMLInputElement | null;
                if (radio?.type === "radio") { label.click(); radio.click(); return label.htmlFor; }
              }
            } else {
              const radios = [...document.querySelectorAll("input[type=radio]")] as HTMLInputElement[];
              const radio = radios.find(r => /reserve|예약/i.test(`${r.value} ${r.id} ${r.name} ${r.getAttribute("aria-label") || ""}`));
              if (radio) { radio.click(); return radio.id || radio.value || "radio"; }
            }
            return "";
          }, method);
          console.log(`[naver] 예약 선택 시도(${method}): ${clicked || "대상 없음"}`);
          if (!clicked) continue;
          await page.waitForTimeout(500);
          reserveSelected = await checkReserveSelected();
          console.log(`[naver] 예약 선택 확인(${method}): ${reserveSelected}`);
          if (reserveSelected) break;
        }
        if (!reserveSelected) throw new Error("예약 라디오 선택 상태를 확인하지 못했습니다");
        await page.waitForTimeout(700);

        // 2) 시(hour)·분(minute): native select 우선, 없으면 button/listbox형 커스텀 드롭다운.
        const setTime = await frame.evaluate(({ h, m }: { h: number; m: number }) => {
          const selects = [...document.querySelectorAll("select")] as HTMLSelectElement[];
          const pick = (sel: HTMLSelectElement, want: number) => {
            const opts = [...sel.options];
            let opt = opts.find(o => {
              const n = (o.textContent || o.value).replace(/[^\d]/g, "");
              return n !== "" && parseInt(n, 10) === want;
            });
            if (!opt) opt = opts.find(o => (o.value || "").replace(/[^\d]/g, "") === String(want));
            if (opt) { sel.value = opt.value; sel.dispatchEvent(new Event("change", { bubbles: true })); return true; }
            return false;
          };
          let hourSel: HTMLSelectElement | undefined, minSel: HTMLSelectElement | undefined;
          for (const s of selects) {
            const nums = [...s.options].map(o => parseInt((o.textContent || o.value).replace(/[^\d]/g, ""), 10)).filter(n => !isNaN(n));
            if (!nums.length) continue;
            const max = Math.max(...nums);
            if (max >= 20 && max <= 23 && !hourSel) hourSel = s;                         // 시: 최대 23
            else if (nums.includes(0) && nums.includes(10) && max <= 50 && !minSel) minSel = s; // 분: 0,10,…,50
          }
          const okH = hourSel ? pick(hourSel, h) : false;
          const okM = minSel ? pick(minSel, m) : false;
          return { okH, okM, selectCount: selects.length, methodH: okH ? "select" : "none", methodM: okM ? "select" : "none" };
        }, { h: hour, m: min });
        const setCustomTime = async (kind: "hour" | "minute", want: number): Promise<string> => {
          const opened = await frame.evaluate((timeKind) => {
            const visible = (e: Element) => { const el=e as HTMLElement,r=el.getBoundingClientRect(),s=getComputedStyle(el); return r.width>0&&r.height>0&&s.display!=="none"&&s.visibility!=="hidden"; };
            const re=timeKind==="hour"?/시|hour/i:/분|minute/i;
            const target=[...document.querySelectorAll("button, [role=combobox], [aria-haspopup=listbox], [aria-haspopup=menu]")]
              .filter(visible).find(e=>re.test(`${e.getAttribute("aria-label")||""} ${e.getAttribute("title")||""} ${e.textContent||""} ${String(e.className)}`));
            if(!target)return "control-not-found";
            (target as HTMLElement).click();
            return `${target.tagName.toLowerCase()}:${(target.textContent||target.getAttribute("aria-label")||"").trim().slice(0,40)}`;
          },kind);
          console.log(`[naver] ${kind === "hour" ? "시" : "분"} 커스텀 드롭다운 열기: ${opened}`);
          if(opened==="control-not-found")return "none";
          await page.waitForTimeout(300);
          return frame.evaluate(({ value, timeKind })=>{
            const visible=(e:Element)=>{const el=e as HTMLElement,r=el.getBoundingClientRect(),s=getComputedStyle(el);return r.width>0&&r.height>0&&s.display!=="none"&&s.visibility!=="hidden";};
            const suffix=timeKind==="hour"?"시":"분";
            const target=[...document.querySelectorAll("[role=option], [role=menuitem], li, button")].filter(visible).find(e=>{
              const text=(e.textContent||"").trim(),digits=text.replace(/[^\d]/g,"");
              return digits!==""&&Number(digits)===value&&(text===String(value)||text===String(value).padStart(2,"0")||text.includes(suffix));
            });
            if(!target)return "option-not-found";
            (target as HTMLElement).click(); return `${target.tagName.toLowerCase()}:${(target.textContent||"").trim()}`;
          },{value:want,timeKind:kind});
        };
        if(!setTime.okH){setTime.methodH=await setCustomTime("hour",hour);setTime.okH=!/none|not-found/.test(setTime.methodH);}
        if(!setTime.okM){setTime.methodM=await setCustomTime("minute",min);setTime.okM=!/none|not-found/.test(setTime.methodM);}
        console.log(`[naver] 시/분 설정 결과: ${JSON.stringify(setTime)}`);
        if (!setTime.okH || !setTime.okM) {
          throw new Error(`예약 시/분 설정 실패 (시:${setTime.methodH}, 분:${setTime.methodM})`);
        }

        // 3) 날짜: 입력값/aria/data 속성/datepicker 셀을 탐색하고 필요한 경우 월을 이동한다.
        const iso=`${year}-${String(month).padStart(2,"0")}-${String(day).padStart(2,"0")}`;
        const dotted=`${year}.${String(month).padStart(2,"0")}.${String(day).padStart(2,"0")}`;
        const todayKst=new Date(Date.now()+9*60*60*1000);
        const isToday=year===todayKst.getUTCFullYear()&&month===todayKst.getUTCMonth()+1&&day===todayKst.getUTCDate();
        const dateInputState=await frame.evaluate(({isoValue,dottedValue})=>{
          const visible=(e:Element)=>{const el=e as HTMLElement,r=el.getBoundingClientRect(),s=getComputedStyle(el);return r.width>0&&r.height>0&&s.display!=="none"&&s.visibility!=="hidden";};
          const text=(e:Element)=>`${e.getAttribute("aria-label")||""} ${e.getAttribute("title")||""} ${(e as HTMLInputElement).value||""} ${e.textContent||""}`;
          const controls=[...document.querySelectorAll("input, button, [role=button], [role=textbox]")].filter(visible);
          const already=controls.find(e=>text(e).includes(isoValue)||text(e).replace(/\s/g,"").includes(dottedValue));
          const opener=already||controls.find(e=>/달력|날짜|calendar|date|\d{4}[.\/-]\d{1,2}[.\/-]\d{1,2}/i.test(text(e)+" "+String(e.className)));
          if(opener)(opener as HTMLElement).click();
          return {already:!!already,opener:opener?`${opener.tagName.toLowerCase()}:${text(opener).trim().slice(0,60)}`:"none"};
        },{isoValue:iso,dottedValue:dotted});
        console.log(`[naver] 날짜 입력부 탐색: ${JSON.stringify(dateInputState)}`);
        await page.waitForTimeout(400);
        let dateSet="none";
        for(let nav=0;nav<25&&dateSet==="none";nav++){
          const attempt=await frame.evaluate(({y,mo,d,isoValue,dottedValue})=>{
            const visible=(e:Element)=>{const el=e as HTMLElement,r=el.getBoundingClientRect(),s=getComputedStyle(el);return r.width>0&&r.height>0&&s.display!=="none"&&s.visibility!=="hidden";};
            const enabled=(e:Element)=>!(e as HTMLButtonElement).disabled&&e.getAttribute("aria-disabled")!=="true"&&!/disabled|outside|other.month/i.test(String(e.className));
            const roots=[...document.querySelectorAll("[role=grid], [class*='calendar' i], [class*='datepicker' i], [class*='date_picker' i]")].filter(visible);
            const cells=[...document.querySelectorAll("[data-date], [data-day], [role=gridcell], td, button, a, [class*='day' i]")].filter(e=>visible(e)&&enabled(e));
            const labels=[isoValue,dottedValue,`${y}년 ${mo}월 ${d}일`,`${mo}월 ${d}일`];
            const byAttr=cells.find(e=>labels.some(v=>`${e.getAttribute("data-date")||""} ${e.getAttribute("data-day")||""} ${e.getAttribute("aria-label")||""} ${e.getAttribute("title")||""}`.includes(v)));
            if(byAttr){(byAttr as HTMLElement).click();return `attribute:${byAttr.tagName.toLowerCase()}`;}
            const header=[...document.querySelectorAll("[class*='month' i], [class*='calendar' i] strong, [role=heading]")].filter(visible).find(e=>/\d{4}\D+\d{1,2}|\d{1,2}\s*월/.test(e.textContent||""));
            const headerText=(header?.textContent||"").replace(/\s/g," ").trim();
            const ym=headerText.match(/(\d{4})\D+(\d{1,2})/)||headerText.match(/(\d{1,2})\s*월/);
            const current=ym?(ym.length>=3?Number(ym[1])*12+Number(ym[2]):y*12+Number(ym[1])):0,target=y*12+mo;
            if(current&&current!==target){
              const next=current<target,re=next?/다음|next|chevron_right|arrow_forward/i:/이전|prev|previous|chevron_left|arrow_back/i;
              const btn=[...document.querySelectorAll("button, [role=button], a")].filter(visible).find(e=>re.test(`${e.getAttribute("aria-label")||""} ${e.getAttribute("title")||""} ${e.textContent||""} ${String(e.className)}`));
              if(btn){(btn as HTMLElement).click();return `${next?"navigate-next":"navigate-prev"}:${headerText}`;}
            }
            // 숫자만 있는 셀은 열린 달이 목표 달임을 확인한 뒤에만 클릭한다(다른 달의 같은 일자 오선택 방지).
            const byDayData=cells.find(e=>e.getAttribute("data-day")===String(d)&&roots.some(root=>root.contains(e)));
            const byText=cells.find(e=>(e.textContent||"").trim()===String(d)&&roots.some(root=>root.contains(e)));
            const dayCell=byDayData||byText;
            if(dayCell&&current===target){(dayCell as HTMLElement).click();return `${byDayData?"data-day":"calendar-text"}:${dayCell.tagName.toLowerCase()}`;}
            return `none:${headerText||"header-not-found"}`;
          },{y:year,mo:month,d:day,isoValue:iso,dottedValue:dotted});
          console.log(`[naver] 날짜 셀 탐색 ${nav+1}/25: ${attempt}`);
          if(/^attribute:|^data-day:|^calendar-text:/.test(attempt))dateSet=attempt;
          else if(/^navigate-/.test(attempt))await page.waitForTimeout(350);
          else break;
        }
        if(dateSet==="none"&&isToday&&dateInputState.already){dateSet="today-already-selected";console.log("[naver] 오늘 날짜가 이미 선택되어 날짜 클릭을 생략합니다");}
        console.log(`[naver] 날짜 설정(${iso}): ${dateSet}`);
        if(dateSet==="none")throw new Error(`예약 날짜를 달력에서 찾지 못했습니다 (${iso})`);

        await page.waitForTimeout(600);
        console.log(`[naver] ✅ 예약 설정 완료: ${year}-${month}-${day} ${hour}:${String(min).padStart(2, "0")}`);
      } catch (e) {
        console.error("[naver] 예약 발행 설정 실패 — 즉시 발행하지 않습니다:", e);
        throw e;
      }
    }

    // ── 최종 발행 또는 예약 확정 ──
    console.log("[naver] 최종 발행...");
    await ensureEditorReady("최종 발행 전");
    const finalLabel = scheduleTime ? "예약" : "발행";
    const beforeFinalUrl = page.url();
    const finalResult = await frame.evaluate(({ label, scheduled }: { label: string; scheduled: boolean }) => {
      const visible = (el: HTMLElement) => {
        const s = getComputedStyle(el);
        const r = el.getBoundingClientRect();
        return s.display !== "none" && s.visibility !== "hidden" && r.width > 0 && r.height > 0;
      };
      const normalized = (el: Element) => (el.textContent || "").replace(/\s/g, "");
      const expected = scheduled ? /^(예약|예약발행)$/ : /^발행$/;

      if (scheduled) {
        const classText = (el: Element) => typeof el.className === "string" ? el.className : el.getAttribute("class") || "";
        const enabled = (el: Element) => !(el as HTMLButtonElement).disabled && el.getAttribute("aria-disabled") !== "true";
        const textParts = (el: Element) => [el.textContent || "", el.getAttribute("aria-label") || ""].map(value => value.replace(/\s/g, "")).filter(Boolean);
        const text = (el: Element) => textParts(el).join(" ");
        const controls = [...document.querySelectorAll("button, [role='button']")]
          .filter(el => visible(el as HTMLElement) && enabled(el));
        const layerSelector = "[class*='publish' i], [class*='layer' i], [class*='option' i], [role='dialog']";
        const inLayer = (el: Element) => !!el.closest(layerSelector);
        const primary = (el: Element) => /confirm(?:_btn)?|primary|submit|complete|apply|point/i.test(`${classText(el)} ${el.getAttribute("data-testid") || ""}`);
        const allowedReservation = (el: Element) => textParts(el).some(value => /예약/.test(value) && !/예약취소|예약해제|취소/.test(value));
        const exactReservation = (el: Element) => textParts(el).some(value => /^(예약|예약발행|예약완료|예약하기)$/.test(value));
        const describe = (el?: Element) => el ? {
          tag: el.tagName.toLowerCase(),
          text: (el.textContent || "").replace(/\s+/g, " ").trim().slice(0, 100),
          ariaLabel: el.getAttribute("aria-label") || "",
          className: classText(el).slice(0, 200),
        } : null;
        const attempts: Array<{ method: string; candidate: ReturnType<typeof describe> }> = [];
        const tryCandidate = (method: string, candidates: Element[]) => {
          const candidate = candidates.at(-1);
          attempts.push({ method, candidate: describe(candidate) });
          if (!candidate) return false;
          (candidate as HTMLElement).click();
          return true;
        };

        if (tryCandidate("exact+confirm-primary", controls.filter(el => exactReservation(el) && primary(el))))
          return { clicked: true, attempts };
        if (tryCandidate("exact+publish-layer", controls.filter(el => exactReservation(el) && inLayer(el))))
          return { clicked: true, attempts };
        if (tryCandidate("contains-reservation+confirm-primary", controls.filter(el => allowedReservation(el) && primary(el))))
          return { clicked: true, attempts };
        if (tryCandidate("contains-reservation+publish-layer", controls.filter(el => allowedReservation(el) && inLayer(el))))
          return { clicked: true, attempts };

        // 예약 선택 전에는 '발행'이던 동일 위치의 버튼일 수 있어, 발행 레이어의 primary/confirm을 다시 찾는다.
        if (tryCandidate("publish-layer+confirm-primary", controls.filter(el => inLayer(el) && primary(el) && !/취소|닫기/.test(text(el)))))
          return { clicked: true, attempts };
        const layers = [...document.querySelectorAll(layerSelector)].filter(el => visible(el as HTMLElement));
        const activeLayer = layers.at(-1);
        const footerControls = activeLayer
          ? controls.filter(el => activeLayer.contains(el) && !/취소|닫기|이전/.test(text(el)))
          : [];
        if (tryCandidate("publish-layer-last-enabled", footerControls))
          return { clicked: true, attempts };
        return { clicked: false, attempts };
      }

      const buttons = [...document.querySelectorAll("button")]
        .filter((b): b is HTMLButtonElement => visible(b) && !b.disabled && expected.test(normalized(b)));

      // CSS-module 해시는 무시하고 역할(confirm_btn) + 정확한 라벨을 함께 확인한다.
      // confirm 버튼이 없을 때만 발행 옵션 레이어 안의 마지막 정확-라벨 버튼을 사용한다.
      const confirm = buttons.filter(b => /(^|\s|_)confirm(?:_btn)?(?:__|\s|_|$)/i.test(b.className)).at(-1);
      const inPublishLayer = buttons.filter(b =>
        b.closest("[class*='publish'], [class*='Publish'], [class*='layer'], [role='dialog']")
      ).at(-1);
      const target = confirm || inPublishLayer;
      if (!target) return { clicked: false, attempts: [] };
      target.click();
      return { clicked: true, attempts: [] };
    }, { label: finalLabel, scheduled: Boolean(scheduleTime) });
    if (scheduleTime) {
      for (const attempt of finalResult.attempts) {
        console.log(`[naver] 예약 확정 버튼 탐색(${attempt.method}): ${JSON.stringify(attempt.candidate)}`);
      }
    }

    if (!finalResult.clicked) {
      if (scheduleTime) {
        try {
          const dump = await frame.evaluate(() => {
            const visible = (el: Element) => { const r = el.getBoundingClientRect(), s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.display !== "none" && s.visibility !== "hidden"; };
            const classText = (el: Element) => typeof (el as HTMLElement).className === "string" ? (el as HTMLElement).className : el.getAttribute("class") || "";
            const layerSelector = "[class*='publish' i], [class*='layer' i], [class*='option' i], [role='dialog']";
            const layers = [...document.querySelectorAll(layerSelector)].filter(visible);
            const activeLayer = layers.at(-1);
            const candidates = [...(activeLayer || document).querySelectorAll("button, [role='button']")]
              .filter(visible)
              .map(el => ({
                tag: el.tagName.toLowerCase(),
                textContent: (el.textContent || "").replace(/\s+/g, " ").trim().slice(0, 200),
                ariaLabel: el.getAttribute("aria-label") || "",
                role: el.getAttribute("role") || "",
                className: classText(el).slice(0, 300),
                disabled: (el as HTMLButtonElement).disabled || el.getAttribute("aria-disabled") === "true",
              }));
            return {
              activeLayer: activeLayer ? { tag: activeLayer.tagName.toLowerCase(), className: classText(activeLayer).slice(0, 300), role: activeLayer.getAttribute("role") || "" } : null,
              buttons: candidates,
            };
          });
          console.error(`[naver] 🔎 예약 확정 발행 레이어 DOM 덤프: ${JSON.stringify(dump)}`);
        } catch (e: any) {
          console.error(`[naver] ⚠️ 예약 확정 DOM 덤프 수집 실패: ${String(e?.message || e).split("\n")[0]}`);
        }
      }
      const message = scheduleTime
        ? "예약 확정 버튼을 찾지 못했습니다. 안전을 위해 즉시 발행하지 않습니다."
        : "발행 옵션 레이어의 최종 발행 버튼을 찾지 못했습니다.";
      console.error(`[naver] ❌ ${message}`);
      throw new Error(message);
    }

    await page.waitForTimeout(scheduleTime ? 3000 : 5000);

    const finalSignal = await frame.evaluate(({ scheduled }: { scheduled: boolean }) => {
      const visible = (el: HTMLElement) => {
        const s = getComputedStyle(el);
        const r = el.getBoundingClientRect();
        return s.display !== "none" && s.visibility !== "hidden" && r.width > 0 && r.height > 0;
      };
      const expected = scheduled ? /^(예약|예약발행)$/ : /^발행$/;
      const confirmStillVisible = [...document.querySelectorAll("button")]
        .some(b => visible(b as HTMLElement) && expected.test((b.textContent || "").replace(/\s/g, "")) &&
          (/confirm/i.test(b.className) || !!b.closest("[class*='publish'], [class*='Publish'], [class*='layer'], [role='dialog']")));
      const successText = /예약(?:이|이\s)?완료|예약되었습니다|발행되었습니다/.test(document.body.innerText);
      return { layerClosed: !confirmStillVisible, successText };
    }, { scheduled: Boolean(scheduleTime) });
    const urlChanged = page.url() !== beforeFinalUrl;
    console.log(`[naver] 최종 확정 신호: 레이어닫힘=${finalSignal.layerClosed}, URL변경=${urlChanged}, 완료문구=${finalSignal.successText}`);
    if (!finalSignal.layerClosed && !urlChanged && !finalSignal.successText) {
      throw new Error(`${finalLabel} 버튼 클릭 후 완료 신호를 확인하지 못했습니다`);
    }

    // URL 추출
    let postUrl = page.url();
    const viewMatch = postUrl.match(/blog\.naver\.com\/[^/]+\/(\d+)/) || postUrl.match(/logNo=(\d+)/);
    if (viewMatch) postUrl = `https://blog.naver.com/${blogId}/${viewMatch[1]}`;
    if (scheduleTime) postUrl = `https://blog.naver.com/${blogId}`;
    // ★실제 게시 검증: 예약이 아닌데 실제 글 주소(logNo)도 없고 완료문구도 없으면, 레이어만 닫혔을 뿐
    //   발행이 완료되지 않은 것(카테고리/검증 오류 등). write 페이지 URL을 성공처럼 반환하면 "완료 떴는데 글 없음"이 됨.
    //   → 가짜 성공을 막기 위해 실패로 처리한다.
    if (!scheduleTime && !viewMatch && !finalSignal.successText) {
      throw new Error("발행이 끝까지 완료되지 않았어요(글 주소를 못 받음). 카테고리 선택이나 네트워크 문제일 수 있어요 — 다시 시도해주세요.");
    }

    // 쿠키 갱신
    const newCookies = await context.cookies();
    const session = readSession<any>(naverSessionName(userId), LEGACY_SESSION_DIRS);
    session.cookies = newCookies;
    writeSession(naverSessionName(userId), session);

    closingExpected = true;
    signal?.removeEventListener("abort", abortPublish);
    await browser.close();
    console.log(`[naver] ✅ ${scheduleTime ? "예약 완료" : "발행 완료"}: ${postUrl}`);
    return postUrl;
  } catch (e: any) {
    console.error("[naver] ❌ 에러:", e.message);
    try {
      const debugDir = path.join(__dirname, "../debug");
      if (!fs.existsSync(debugDir)) fs.mkdirSync(debugDir, { recursive: true });
      if (!page.isClosed()) await page.screenshot({ path: path.join(debugDir, `naver_error_${Date.now()}.png`), fullPage: true });
      else console.error(`[naver] 스크린샷 불가: page가 이미 닫힘 (직전 액션: ${lastPageAction})`);
    } catch {}
    closingExpected = true;
    signal?.removeEventListener("abort", abortPublish);
    await browser.close().catch(() => {});
    const pageClosedError = unexpectedPageClose || /Target page, context or browser has been closed|page has been closed|browser has been closed/i.test(String(e?.message || e));
    if (isEdit && !signal?.aborted && pageClosedError && !(params as any).__pageCloseRetry) {
      console.error(`[naver] 🔁 page closed 발행 전체 재시도 1/1 (직전 액션: ${lastPageAction})`);
      return publishNaver({ ...params, __pageCloseRetry: true } as any);
    }
    throw e;
  }
}

/* ── Google 세션 ── */
export function googleSessionExists(userId: string): boolean {
  return hasSession(googleSessionName(userId), LEGACY_SESSION_DIRS);
}

export async function saveGoogleSession(userId: string, email?: string, pw?: string): Promise<void> {
  const browser = await chromium.launch({ headless: false, args: LAUNCH_ARGS });
  const context = await browser.newContext({
    userAgent: UA, viewport: { width: 1280, height: 800 }, locale: "ko-KR",
  });
  await applyAntiDetection(context);
  const page = await context.newPage();
  try {
    console.log("[google] Chrome이 열립니다. Google로 직접 로그인해주세요.");
    await page.goto("https://labs.google/fx/ko/tools/flow", { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForTimeout(2000);

    // 로그인 완료까지 대기 (최대 3분) - 로그인 버튼이 사라지면 완료
    console.log("[google] 로그인 대기 중... (Chrome에서 직접 로그인 후 3분 이내 완료)");
    await page.waitForFunction(
      () => {
        // 로그인 버튼이 없어지면 완료
        const btn = document.querySelector("button");
        const hasLoginBtn = btn && (btn.textContent?.includes("로그인") || btn.textContent?.includes("Sign in"));
        return !hasLoginBtn || document.querySelector("[data-testid='user-avatar'], .user-menu, img[alt*='profile']");
      },
      { timeout: 180000 }
    ).catch(() => {
      console.log("[google] ⚠️ 로그인 대기 시간 초과 - 현재 상태로 저장");
    });
    await page.waitForTimeout(3000);

    // 3단계: 로그인 후 storageState 전체 저장 (쿠키 + localStorage + sessionStorage)
    const saved = await context.storageState();
    writeSession(googleSessionName(userId), saved);

    await browser.close();
    console.log("[google] ✅ Google Flow 세션 저장 완료 (storageState)");
  } catch (e) {
    await browser.close().catch(() => {});
    throw e;
  }
}

/* ── Flow 이미지 프롬프트 → SEO 캡션 변환 ── */
function captionFromPrompt(prompt: string, idx: number, total: number): string {
  // 프롬프트에서 "제목" 형태로 키워드 추출
  const titleMatch = prompt.match(/"([^"]+)"/);
  const keyword = titleMatch ? titleMatch[1] : prompt.split(",")[0].replace(/^A\s+\w+\s+\w+\s+\w+\s+/i, "").trim();
  const p = prompt.toLowerCase();
  let style = "";
  if (p.includes("food") || p.includes("gourmet") || p.includes("cuisine")) style = "음식 스타일링 사진";
  else if (p.includes("travel") || p.includes("landscape") || p.includes("scenic")) style = "여행 풍경 사진";
  else if (p.includes("financial") || p.includes("business") || p.includes("workspace")) style = "비즈니스 컨셉 사진";
  else if (p.includes("technology") || p.includes("tech") || p.includes("device")) style = "기술 컨셉 사진";
  else if (p.includes("interior") || p.includes("home") || p.includes("decor")) style = "인테리어 스타일 사진";
  else if (p.includes("health") || p.includes("fitness") || p.includes("wellness")) style = "건강 라이프스타일 사진";
  else if (p.includes("fashion") || p.includes("outfit") || p.includes("style")) style = "패션 스타일 사진";
  else if (p.includes("car") || p.includes("vehicle") || p.includes("automotive")) style = "자동차 사진";
  else if (p.includes("sport") || p.includes("athlete") || p.includes("action")) style = "스포츠 액션 사진";
  else if (p.includes("beauty") || p.includes("skincare") || p.includes("cosmetic")) style = "뷰티 사진";
  else if (p.includes("nature") || p.includes("outdoor") || p.includes("garden")) style = "자연 풍경 사진";
  else if (p.includes("family") || p.includes("baby") || p.includes("child")) style = "가족 사진";
  else if (p.includes("pet") || p.includes("dog") || p.includes("cat")) style = "반려동물 사진";
  else if (p.includes("education") || p.includes("study") || p.includes("book")) style = "교육 컨셉 사진";
  else if (p.includes("wedding") || p.includes("couple") || p.includes("romance")) style = "웨딩 사진";
  else style = "관련 사진";
  // ★"사진 1/3" 같은 숫자(순번) 절대 넣지 않는다(테리 지적). 폴백일 때도 숫자 없이.
  return `${keyword} ${style}`;
}

/* ── Google Flow 이미지 생성 ── */
export async function generateFlowImages(params: {
  userId: string;
  prompts: string[];
  captions: string[];
  onLog?: (msg: string) => void;
}): Promise<{src: string; alt: string}[]> {
  const { userId, prompts, captions, onLog } = params;
  const log = onLog || console.log;
  const results: {src: string; alt: string}[] = [];

  if (!googleSessionExists(userId)) throw new Error("Google 세션 없음 — 계정 관리 탭에서 Google 로그인 먼저 해주세요");
  const googleSession = readSession<any>(googleSessionName(userId), LEGACY_SESSION_DIRS);

  const DOWNLOAD_DIR = path.join(__dirname, "../flow_downloads");
  if (!fs.existsSync(DOWNLOAD_DIR)) fs.mkdirSync(DOWNLOAD_DIR, { recursive: true });

  const browser = await chromium.launch({
    headless: false,
    args: ["--no-sandbox", "--disable-blink-features=AutomationControlled"],
  });

  // storageState 방식으로 로드 (쿠키+localStorage+sessionStorage 전체)
  const hasStorageState = googleSession.origins !== undefined;
  const context = await browser.newContext({
    ...(hasStorageState ? { storageState: googleSession } : {}),
    userAgent: UA,
    viewport: { width: 1280, height: 900 },
    locale: "ko-KR",
    acceptDownloads: true,
  });

  await applyAntiDetection(context);
  // 구버전 세션(쿠키만 있는 경우) 호환
  if (!hasStorageState && googleSession.cookies?.length) {
    await context.addCookies(googleSession.cookies);
  }
  const page = await context.newPage();

  // ── 헬퍼: Google 로그인 처리 ──
  async function handleGoogleLogin() {
    const email = googleSession.email || "";
    const pw = googleSession.pw ? Buffer.from(googleSession.pw, "base64").toString("utf-8") : "";

    // 로그인 버튼 클릭 (텍스트 다양하게 시도)
    const loginBtnSels = [
      "button:has-text('로그인')",
      "button:has-text('Google 계정으로 로그인')",
      "button:has-text('Sign in with Google')",
      "button:has-text('Sign in')",
      "a:has-text('로그인')",
      "a:has-text('Google 계정으로 로그인')",
      "[aria-label*='Sign in']",
      "[aria-label*='로그인']",
    ];
    let clicked = false;
    for (const sel of loginBtnSels) {
      try {
        const btn = await page.$(sel);
        if (btn) {
          log("[Flow] Google 로그인 버튼 클릭...");
          // 팝업 대기
          const popupPromise = page.context().waitForEvent("page", { timeout: 8000 }).catch(() => null);
          await btn.click();
          await page.waitForTimeout(2000);
          const popup = await popupPromise;
          if (popup) {
            await popup.waitForLoadState("domcontentloaded");
            await popup.waitForTimeout(1500);
            if (email) {
              const emailInput = await popup.$("input[type='email'], input[name='identifier']").catch(() => null);
              if (emailInput) {
                await emailInput.fill(email);
                await popup.keyboard.press("Enter");
                await popup.waitForTimeout(2500);
              }
            }
            if (pw) {
              const pwInput = await popup.$("input[type='password'], input[name='Passwd']").catch(() => null);
              if (pwInput) {
                await pwInput.fill(pw);
                await popup.keyboard.press("Enter");
                await popup.waitForTimeout(3000);
              }
            }
            // 팝업 닫힐 때까지 대기
            await popup.waitForEvent("close", { timeout: 60000 }).catch(() => {});
          }
          clicked = true;
          break;
        }
      } catch {}
    }
    if (!clicked && email && pw) {
      // 팝업 없이 현재 페이지에서 로그인
      await page.goto("https://accounts.google.com/signin", { waitUntil: "domcontentloaded", timeout: 20000 });
      await page.waitForTimeout(1500);
      const emailInput = await page.$("input[type='email'], input[name='identifier']").catch(() => null);
      if (emailInput) {
        await emailInput.fill(email);
        await page.keyboard.press("Enter");
        await page.waitForTimeout(2500);
        const pwInput = await page.$("input[type='password'], input[name='Passwd']").catch(() => null);
        if (pwInput) {
          await pwInput.fill(pw);
          await page.keyboard.press("Enter");
          await page.waitForTimeout(3000);
        }
      }
      // ImageFX로 돌아가기
      await page.goto("https://labs.google/fx/ko/tools/flow", { waitUntil: "domcontentloaded", timeout: 30000 });
    }
    await page.waitForTimeout(3000);
  }

  // ── 헬퍼: 프롬프트 입력 ──
  async function enterPrompt(prompt: string): Promise<boolean> {
    // 팝업 오버레이 재확인 및 제거
    await page.evaluate(() => {
      document.querySelectorAll("[data-state='open']").forEach(el => el.remove());
    }).catch(() => {});
    await page.waitForTimeout(500);

    let input: any = null;

    // textarea (visible 우선)
    try {
      await page.waitForSelector("textarea:visible", { timeout: 5000 });
      input = await page.$("textarea:visible");
    } catch {}

    // 모든 textarea
    if (!input) {
      try {
        input = await page.$("textarea");
        if (input) {
          await page.evaluate(() => {
            const ta = document.querySelector("textarea");
            if (ta) { ta.style.display = "block"; ta.style.visibility = "visible"; }
          }).catch(() => {});
        }
      } catch {}
    }

    // contenteditable
    if (!input) {
      try { input = await page.$("[contenteditable='true']:not([role='combobox'])"); } catch {}
    }

    if (!input) {
      log("⚠️ [Flow] 프롬프트 입력창을 찾을 수 없음");
      return false;
    }

    await input.click({ force: true });
    await page.waitForTimeout(400);
    // ★커서 튐 방지: 한 글자씩 타이핑(keyboard.type)하면 Flow가 입력 중 자동완성·리렌더로 커서를
    //   앞으로 되돌려 글자가 중간에 껴든다. → '한 번에' 값을 넣는다(fill → native setter → 최후에만 타이핑).
    let entered = false;
    try { await input.fill(""); await input.fill(prompt); entered = true; } catch {}
    if (!entered) {
      entered = await input.evaluate((el: any, val: string) => {
        try {
          if (el.isContentEditable) { el.focus(); el.textContent = val; el.dispatchEvent(new InputEvent("input", { bubbles: true })); return true; }
          const proto = el.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
          const setter = Object.getOwnPropertyDescriptor(proto, "value")!.set!;
          setter.call(el, val); el.dispatchEvent(new Event("input", { bubbles: true })); return true;
        } catch { return false; }
      }, prompt).catch(() => false);
    }
    // 값이 실제로 들어갔는지 확인 → 비었으면(제어 컴포넌트가 되돌린 경우) 최후 수단으로만 타이핑
    let cur = await input.evaluate((el: any) => (el.value ?? el.textContent ?? "")).catch(() => "");
    if (!cur || cur.trim().length < Math.min(5, prompt.length)) {
      await page.keyboard.press("Control+a").catch(() => {});
      await page.keyboard.press("Backspace").catch(() => {});
      await page.keyboard.type(prompt, { delay: 15 });
      cur = await input.evaluate((el: any) => (el.value ?? el.textContent ?? "")).catch(() => "");
    }
    await page.waitForTimeout(400);
    log(`  📝 프롬프트 입력(${entered ? "한번에" : "타이핑"}): ${prompt.slice(0, 50)}...`);
    return true;
  }

  // ── 헬퍼: 생성 버튼 클릭 ──
  async function clickGenerate(): Promise<boolean> {
    // Enter 키 우선 (대부분의 AI 이미지 사이트에서 작동)
    await page.keyboard.press("Enter");
    await page.waitForTimeout(500);

    // 버튼 클릭 시도
    const btns = [
      "button[aria-label*='generate' i]",
      "button[aria-label*='create' i]",
      "button[aria-label*='생성']",
      "button[aria-label*='만들기']",
      "button:has-text('Create')",
      "button:has-text('Generate')",
      "button:has-text('만들기')",
      "button:has-text('생성')",
    ];
    for (const sel of btns) {
      try {
        const btn = await page.$(sel);
        if (btn) {
          const visible = await btn.isVisible();
          if (visible) { await btn.click(); return true; }
        }
      } catch {}
    }
    return true; // Enter로 이미 시도했음
  }

  // ── 헬퍼: 생성된 이미지 저장 ──
  async function saveGeneratedImage(idx: number, caption: string): Promise<boolean> {
    // ★고정 대기(25초)는 생성이 느리면 완성 전에 넘어가 '중단'된다. → 완성될 때까지 폴링(진행 로그 포함).
    log("  ⏳ 이미지 생성 대기 (완성되면 바로 저장, 최대 3분)...");
    await page.waitForTimeout(8000);   // 생성 시작 최소 대기(UI 이미지 오검출 방지)
    const findImgs = () => page.evaluate(() => {
      const imgs = Array.from(document.querySelectorAll("img"));
      return imgs.map(img => img.src).filter(src =>
        src && src.length > 100 &&
        (src.includes("blob:") || src.includes("generativelanguage") ||
         src.includes("aidemos") || src.includes("googleusercontent") ||
         src.includes("data:image")));
    });
    let imgSrcs: string[] = [];
    const MAX_WAIT = 180000, STEP = 3000, t0 = Date.now();
    while (Date.now() - t0 < MAX_WAIT) {
      imgSrcs = await findImgs().catch(() => [] as string[]);
      if (imgSrcs.length > 0) break;
      // ★구글 정책 거부 감지 → 3분 기다리지 말고 즉시 넘어간다(프롬프트가 정책에 걸린 경우).
      const blocked = await page.evaluate(() => {
        const t = (document.body.innerText || "");
        return /정책|위반|생성할 수 없|사용하지 못|만들 수 없|violat|policy|not allowed|can(?:'|’)?t (?:be )?(?:create|generate)|unable to (?:create|generate)/i.test(t);
      }).catch(() => false);
      if (blocked) { log(`  🚫 [Flow] 구글 정책으로 이 프롬프트는 생성 불가 → 이 장 건너뜀`); return false; }
      const el = Math.round((Date.now() - t0) / 1000);
      if (el > 0 && el % 15 === 0) log(`  ⏳ [Flow] 생성 중... (${el}초 경과, 계속 기다려요)`);
      await page.waitForTimeout(STEP);
    }
    if (imgSrcs.length === 0) { log(`  ⚠️ [Flow] 생성이 너무 오래 걸려 이미지를 못 받았어요 (다음 장으로 진행)`); return false; }
    log(`  🖼️ [Flow] 이미지 확인 → 저장 중...`);

    if (imgSrcs.length > 0) {
      const src = imgSrcs[0];
      if (src.startsWith("blob:")) {
        // blob URL → base64 변환 후 파일 저장
        const base64 = await page.evaluate(async (blobUrl) => {
          const res = await fetch(blobUrl);
          const blob = await res.blob();
          return new Promise<string>((resolve) => {
            const reader = new FileReader();
            reader.onloadend = () => resolve(reader.result as string);
            reader.readAsDataURL(blob);
          });
        }, src);
        if (base64) {
          const filePath = path.join(DOWNLOAD_DIR, `flow_${Date.now()}_${idx}.png`);
          const base64Data = base64.replace(/^data:image\/\w+;base64,/, "");
          fs.writeFileSync(filePath, Buffer.from(base64Data, "base64"));
          results.push({ src: filePath, alt: caption });
          log(`  ✅ [Flow] 이미지 ${idx + 1} 저장 완료`);
          return true;
        }
      } else if (src.startsWith("http")) {
        results.push({ src, alt: caption });
        log(`  ✅ [Flow] 이미지 ${idx + 1} URL 저장`);
        return true;
      }
    }

    // 다운로드 버튼 시도
    try {
      const [download] = await Promise.all([
        page.waitForEvent("download", { timeout: 5000 }),
        page.click("[aria-label*='download' i], [aria-label*='다운로드'], button[title*='download' i]"),
      ]);
      const filePath = path.join(DOWNLOAD_DIR, `flow_${Date.now()}_${idx}.png`);
      await download.saveAs(filePath);
      results.push({ src: filePath, alt: caption });
      log(`  ✅ [Flow] 이미지 ${idx + 1} 다운로드 완료`);
      return true;
    } catch {}

    log(`  ⚠️ [Flow] 이미지 ${idx + 1} 저장 실패`);
    return false;
  }

  try {
    // 첫 페이지 로드
    await page.goto("https://labs.google/fx/ko/tools/flow", {
      waitUntil: "domcontentloaded", timeout: 30000,
    });
    await page.waitForTimeout(4000);

    // 팝업 오버레이 제거 + 버튼 클릭 (data-state="open" 오버레이가 클릭 차단)
    const dismissPopups = async () => {
      await page.evaluate(() => {
        document.querySelectorAll("[data-state='open']").forEach(el => el.remove());
        const btns = Array.from(document.querySelectorAll("button"));
        btns.forEach(btn => {
          const t = btn.textContent || "";
          if (t.includes("시작") || t.includes("닫기") || t.includes("동의") || t.includes("started") || t.includes("Get started")) {
            btn.click();
          }
        });
      }).catch(() => {});
      await page.waitForTimeout(1500);
    };
    await dismissPopups();

    // 로그인 버튼 있으면 처리
    const needLogin = await page.$("button:has-text('로그인'), button:has-text('Sign in')").catch(() => null);
    if (needLogin || page.url().includes("accounts.google.com")) {
      await handleGoogleLogin();
      await page.waitForTimeout(3000);
    }

    // 각 프롬프트별 이미지 생성
    for (let i = 0; i < prompts.length; i++) {
      log(`🎨 [Flow] [${i + 1}번째 / 총 ${prompts.length}장] 이미지 만드는 중...`);

      // 첫 번째 아니면 페이지 새로고침
      if (i > 0) {
        await page.reload({ waitUntil: "domcontentloaded", timeout: 20000 });
        await page.waitForTimeout(3000);
        await dismissPopups();
      }

      // 로그인 상태 재확인
      if (page.url().includes("accounts.google.com")) {
        await handleGoogleLogin();
        await page.waitForTimeout(3000);
      }

      const entered = await enterPrompt(prompts[i]);
      if (!entered) continue;

      await clickGenerate();
      // ★캡션 = 앱이 만들어 보낸 flowCaptions(본문 소제목 기반·서로 다름·숫자 없음)를 우선 사용.
      //   비어 있을 때만 프롬프트 기반 폴백(이 폴백도 이제 "사진 1/3" 같은 숫자 안 붙임).
      const seoCaption = (captions[i] && captions[i].trim()) ? captions[i].trim() : captionFromPrompt(prompts[i], i, prompts.length);
      await saveGeneratedImage(i, seoCaption);
    }

    await browser.close();
    log(`✅ [Flow] 전체 ${results.length}장 생성 완료`);
    return results;
  } catch (e: any) {
    await browser.close().catch(() => {});
    throw e;
  }
}

/* ── Google Flow 이미지 생성 (CDP 방식 · 사용자 실크롬 연결) ──────────
   구글이 자동화 브라우저 로그인을 차단하므로, 사용자가 로그인해둔 실제 크롬을
   디버깅 포트(--remote-debugging-port)로 띄우고 봇이 CDP로 붙어 Flow를 조작한다.
   별도 브라우저를 열지 않아 구글 봇 감지를 우회한다. (2026-08 실측 검증)      */
export async function generateFlowImagesCDP(params: {
  prompts: string[];
  captions?: string[];
  cdpPort?: number;
  onLog?: (msg: string) => void;
}): Promise<{ src: string; alt: string }[]> {
  const { prompts, captions = [], cdpPort = 9222, onLog } = params;
  const log = onLog || console.log;
  // 재시도 큐에서는 뒤 프롬프트가 먼저 성공할 수 있으므로 원래 순서를 함께 보존한다.
  const results: { src: string; alt: string; promptIndex: number }[] = [];

  // 0) 백업 폴더 준비: 바탕화면/Publy_Flow이미지_YYYY-MM-DD (생성 이미지 자동 보관)
  let backupDir = "";
  try {
    const today = new Date().toISOString().slice(0, 10);
    backupDir = path.join(os.homedir(), "Desktop", `Publy_Flow이미지_${today}`);
    if (!fs.existsSync(backupDir)) fs.mkdirSync(backupDir, { recursive: true });
  } catch { backupDir = ""; }

  // 1) 사용자 실크롬(디버깅 포트)에 연결
  log(`[Flow] 🔌 그림 만드는 프로그램을 여는 중이에요...`);
  let browser;
  try {
    browser = await chromium.connectOverCDP(`http://localhost:${cdpPort}`);
    log("[Flow] ✅ 프로그램이 잘 열렸어요");
  } catch (e: any) {
    throw new Error(`CDP_CONNECT_FAIL: 크롬이 디버깅 모드로 열려있지 않습니다 (포트 ${cdpPort}). Flow 준비 버튼을 먼저 눌러주세요.`);
  }

  try {
    const ctx = browser.contexts()[0];
    if (!ctx) throw new Error("크롬 컨텍스트를 찾을 수 없습니다");

    // 2) Flow 탭 찾기(없으면 새로 열기)
    log("[Flow] 🔎 그림 만드는 화면을 찾는 중이에요...");
    let page = ctx.pages().find(p => p.url().includes("labs.google/fx"));
    if (!page) {
      log("[Flow] 그림 만드는 화면을 새로 여는 중이에요");
      page = await ctx.newPage();
      await page.goto("https://labs.google/fx/ko/tools/flow", { waitUntil: "domcontentloaded", timeout: 30000 });
      await page.waitForTimeout(4000);
    } else {
      log("[Flow] ✅ 화면을 찾았어요");
    }
    await page.bringToFront();
    await page.waitForTimeout(1500);

    // ★ Flow 첫 진입 안내 팝업 닫기 — 안 닫으면 '새 세션' 클릭·프롬프트 입력이 막힌다.
    //   2026-08-28: 'Gemini Omni Flash 360p 추가' 변경사항 모달이 새로 생겨(버튼 '시작하기') 입력창을 가림.
    //   Flow는 이런 What's-new 다이얼로그를 수시로 띄우므로, 모달 안의 닫기/시작 계열 버튼을 눌러 없앤다.
    //   '모든 변경 로그 보기'(외부 이동) 같은 버튼은 피하고 닫기·시작 계열만 클릭 → 실패 시 Esc.
    const closeIntroPopup = async () => {
      for (let tries = 0; tries < 3; tries++) {
        const clicked = await page.evaluate(() => {
          const visible = (el: Element) => {
            const r = el.getBoundingClientRect();
            return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== "hidden";
          };
          const dialogs = [...document.querySelectorAll("[role=dialog],[role=alertdialog],[data-state=open]")].filter(visible);
          const btnRe = /^\s*(시작하기|시작|닫기|건너뛰기|나중에|확인|알겠|다음|Get started|Got it|Dismiss|Continue|Skip|Close|Next)\s*$/i;
          for (const dlg of dialogs) {
            const btns = [...dlg.querySelectorAll("button,[role=button]")].filter(visible);
            const hit = btns.find(b => btnRe.test(b.textContent || ""));
            if (hit) { (hit as HTMLElement).click(); return true; }
          }
          return false;
        }).catch(() => false);
        if (!clicked) await page.keyboard.press("Escape").catch(() => {});
        await page.waitForTimeout(700);
        const still = await page.$("[role=dialog],[role=alertdialog]").catch(() => null);
        if (!still) break;
      }
    };
    await closeIntroPopup();

    // 3) 로그인 상태 확인
    const loggedIn = await page.evaluate(() => {
      const t = document.body.innerText;
      const hasLoginBtn = [...document.querySelectorAll("button,a")].some(e => /sign in with google|Google 계정으로 로그인/i.test(e.textContent || ""));
      return !hasLoginBtn && /Flow|프로젝트|크레딧|안녕하세요/.test(t);
    });
    if (!loggedIn) throw new Error("FLOW_NOT_LOGGED_IN: 크롬에서 Google Flow에 먼저 로그인해주세요");
    log("[Flow] ✅ 로그인이 되어 있어요");

    // 4) ★항상 새 프로젝트로 시작 (이전 작업 컨텍스트/텍스트가 이미지에 섞이는 것 방지)
    //    기존 프로젝트에 있으면 홈으로 나갔다가 새로 생성한다.
    log("[Flow] 🧹 깨끗한 새 화면을 준비하는 중이에요 (이전 그림이 섞이지 않게)...");
    if (page.url().includes("/project/")) {
      await page.goto("https://labs.google/fx/ko/tools/flow", { waitUntil: "domcontentloaded", timeout: 30000 });
      await page.waitForTimeout(3500);
    }
    //   ★실제 Flow UI 버튼명은 "새 프로젝트"가 아니라 "새로운 세션"(edit_square)일 수 있다(로그 DOM 확인).
    //     이걸 못 눌러 기존 프로젝트에 이미지가 쌓이면, Flow(대화형)가 이전 이미지를 참조해 엉뚱한
    //     이미지(예: 양념게장이 게 괴물로)를 만든다. 여러 이름을 순서대로 시도한다.
    let newSessionOk = false;
    for (const label of ["새로운 세션", "새 프로젝트", "새 세션", "New session", "New project"]) {
      try {
        const btn = page.locator(`button:has-text('${label}')`).first();
        if (await btn.count() > 0) { await btn.click({ timeout: 4000 }); newSessionOk = true; log(`[Flow] 세션 초기화 클릭: ${label}`); break; }
      } catch {}
    }
    if (!newSessionOk) {
      try { await page.click("text=새 프로젝트", { timeout: 4000 }); newSessionOk = true; } catch {}
    }
    await page.waitForTimeout(5000);
    if (!page.url().includes("/project/") && !newSessionOk) {
      log("[Flow] ⚠️ 새 프로젝트/세션 진입 실패 — 현재 화면에서 진행");
    }

    // Flow UI는 자주 바뀌므로 실패 시 다음 수정에 필요한 DOM 단서를 로그로 남겨둔다.
    const dumpFlowControls = async (reason: string) => {
      try {
        const dump = await page.evaluate(() => {
          const visible = (el: Element) => {
            const r = el.getBoundingClientRect();
            const s = getComputedStyle(el);
            return r.width > 0 && r.height > 0 && s.display !== "none" && s.visibility !== "hidden";
          };
          const describe = (el: Element) => ({
            tag: el.tagName.toLowerCase(),
            text: (el.textContent || "").replace(/\s+/g, " ").trim().slice(0, 160),
            aria: el.getAttribute("aria-label") || "",
            title: el.getAttribute("title") || "",
            role: el.getAttribute("role") || "",
            type: el.getAttribute("type") || "",
            value: (el as HTMLInputElement).value || el.getAttribute("data-value") || "",
            disabled: (el as HTMLButtonElement).disabled || el.getAttribute("aria-disabled") === "true",
          });
          const buttons = [...document.querySelectorAll("button,[role=button]")].filter(visible).slice(0, 80).map(describe);
          const outputRelated = [...document.querySelectorAll("label,button,[role=button],[role=option],[role=menuitem],select,input,[aria-label]")]
            .filter(el => visible(el) && /\ucd9c\ub825\s*(\uac1c\uc218|\uc218)|\uc774\ubbf8\uc9c0\s*(\uac1c\uc218|\uc218)|number\s+of\s+outputs?|outputs?|images?\s*(count|number)|\uac1c\s*\uc0dd\uc131/i.test(`${el.textContent || ""} ${el.getAttribute("aria-label") || ""}`))
            .slice(0, 40).map(describe);
          const inputs = [...document.querySelectorAll("textarea,[contenteditable=true],input,select")].filter(visible).slice(0, 40).map(describe);
          return { url: location.href, buttons, outputRelated, inputs };
        });
        log(`[Flow] 🔎 DOM 진단(${reason}): ${JSON.stringify(dump)}`);
      } catch (e: any) {
        log(`[Flow] ⚠️ DOM 진단 수집 실패: ${String(e?.message || e).split("\n")[0]}`);
      }
    };

    // 설정 레이블과 같은 작은 컨테이너 안의 1만 누른다. 프로젝트 내 다른 "1" 버튼은 누르지 않는다.
    let outputCountIsOne = false;
    const setOutputCountToOne = async (): Promise<boolean> => {
      log("[Flow] 🎯 출력 개수 1장 설정 탐색...");
      try {
        const direct = await page.evaluate(() => {
          const visible = (el: Element) => {
            const r = el.getBoundingClientRect();
            const s = getComputedStyle(el);
            return r.width > 0 && r.height > 0 && s.display !== "none" && s.visibility !== "hidden";
          };
          const outputRe = /\ucd9c\ub825\s*(\uac1c\uc218|\uc218)|\uc774\ubbf8\uc9c0\s*(\uac1c\uc218|\uc218)|number\s+of\s+outputs?|outputs?|images?\s*(count|number)|\uac1c\s*\uc0dd\uc131/i;
          const labels = [...document.querySelectorAll("label,[aria-label],button,[role=button]")]
            .filter(el => visible(el) && outputRe.test(`${el.textContent || ""} ${el.getAttribute("aria-label") || ""}`));
          for (const label of labels) {
            let box: Element | null = label;
            for (let depth = 0; box && depth < 5; depth++, box = box.parentElement) {
              const select = box.querySelector("select") as HTMLSelectElement | null;
              if (select && [...select.options].some(o => o.value === "1" || o.text.trim() === "1")) {
                const opt = [...select.options].find(o => o.value === "1" || o.text.trim() === "1")!;
                select.value = opt.value;
                select.dispatchEvent(new Event("input", { bubbles: true }));
                select.dispatchEvent(new Event("change", { bubbles: true }));
                return `select:${(label.textContent || label.getAttribute("aria-label") || "").trim().slice(0, 80)}`;
              }
              const input = [...box.querySelectorAll('input[type="number"],input[type="range"]')]
                .find(el => visible(el)) as HTMLInputElement | undefined;
              if (input) {
                const min = Number(input.min || "1");
                const max = Number(input.max || "999");
                if (min <= 1 && max >= 1) {
                  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
                  setter?.call(input, "1");
                  input.dispatchEvent(new Event("input", { bubbles: true }));
                  input.dispatchEvent(new Event("change", { bubbles: true }));
                  return `input:${input.type}`;
                }
              }
              const one = [...box.querySelectorAll("button,[role=button],[role=option],[role=menuitem]")]
                .find(el => visible(el) && /^(1|1\s*\uc7a5|1\s*image)$/i.test((el.textContent || el.getAttribute("aria-label") || "").trim()));
              if (one) { (one as HTMLElement).click(); return "nearby-option:1"; }
            }
          }
          return "";
        });
        if (direct) {
          await page.waitForTimeout(600);
          log(`[Flow] ✅ 출력 개수 1장 설정 시도 완료 (${direct})`);
          return true;
        }

        // 드롭다운은 먼저 설정 트리거를 열어야 1 옵션이 DOM에 나온다.
        const trigger = page.locator('button,[role="button"]').filter({ hasText: /\ucd9c\ub825\s*(\uac1c\uc218|\uc218)|\uc774\ubbf8\uc9c0\s*(\uac1c\uc218|\uc218)|number\s+of\s+outputs?|outputs?|images?\s*(count|number)/i }).first();
        if (await trigger.isVisible().catch(() => false)) {
          await trigger.click({ timeout: 3000 });
          await page.waitForTimeout(500);
          const option = page.locator('[role="option"],[role="menuitem"],button').filter({ hasText: /^\s*(1|1\s*\uc7a5|1\s*image)\s*$/i }).first();
          if (await option.isVisible().catch(() => false)) {
            await option.click({ timeout: 3000 });
            log("[Flow] ✅ 출력 개수 1장 설정 시도 완료 (dropdown)");
            return true;
          }
        }
      } catch (e: any) {
        log(`[Flow] ⚠️ 출력 개수 설정 시도 오류: ${String(e?.message || e).split("\n")[0]}`);
      }
      log("[Flow] ⚠️ 출력개수 설정 못 찾음 — 여러 장 생성 시 1장 선택으로 폴백");
      await dumpFlowControls("출력개수 설정 실패");
      return false;
    };
    outputCountIsOne = await setOutputCountToOne();

    // 5) 프롬프트별 생성 — ★ 큐 방식: 실패한 프롬프트는 다시 시도(최대 3회)해서 "요청한 개수 정확히" 채운다.
    log(`[Flow] 🎬 준비 끝! 이제 그림 ${prompts.length}장을 한 장씩 만들게요`);
    const target = prompts.length;              // 요청한 총 장수
    const queue: number[] = prompts.map((_, i) => i);
    const attemptsById: Record<number, number> = {};
    const softened: Record<number, boolean> = {};   // 정책 거부로 프롬프트를 순화한 슬롯 표시
    // ── 부족분 자동 채우기 ──
    // 저작권/정책으로 원래 프롬프트가 막혀 목표 장수에 못 미치면(예: 5장 중 2장 거부),
    // 성공했던(=안전한) 프롬프트를 다시 그려 목표 장수를 채운다. 사용자가 다시 명령하지 않아도
    // '첫 지시(N장)'의 연장으로 자동 진행. Flow는 매번 다른 이미지를 주므로 같은 프롬프트라도 새 그림이 나온다.
    let fillTotal = 0;                       // 채우기로 큐에 넣은 총 횟수(무한루프 방지)
    const fillCap = target * 3 + 3;          // 채우기 시도 상한
    let fillNotice = false;
    while (results.length < target) {
      if (queue.length === 0) {
        const safeIdxs = [...new Set(results.map(r => r.promptIndex))];  // 성공한(=안전한) 프롬프트 인덱스
        if (safeIdxs.length === 0) break;    // 성공작이 하나도 없으면 채울 재료가 없어 종료
        if (fillTotal >= fillCap) { log(`[Flow] ⚠️ 자동 채우기 상한 도달 — ${results.length}/${target}장에서 마칠게요`); break; }
        if (!fillNotice) { log(`[Flow] 🧩 ${target}장 중 ${results.length}장만 됐어요(나머진 정책으로 막힘). 부족한 만큼 안전한 그림으로 자동으로 채울게요...`); fillNotice = true; }
        const need = target - results.length;
        for (let k = 0; k < need; k++) queue.push(safeIdxs[(fillTotal + k) % safeIdxs.length]);
        fillTotal += need;
      }
      const i = queue.shift()!;
      attemptsById[i] = (attemptsById[i] || 0) + 1;
      const requeue = () => { if (attemptsById[i] < 3) { queue.push(i); log(`[Flow] 🔁 ${i + 1}번째 그림을 다시 만들어 볼게요 (${attemptsById[i]}번째 시도)`); } else { log(`[Flow] ⛔ ${i + 1}번째 그림은 여러 번 해봐도 안 돼서 건너뛸게요`); } };
      // 텍스트 오염 방지 안전장치(어떤 경로로 온 프롬프트든 글자 없이 순수 이미지)
      let prompt = prompts[i];
      if (!/no text|no letters|글자 ?없/i.test(prompt)) {
        prompt += ", (photo only, absolutely no text, no letters, no words, no watermark, no logo)";
      }
      log(`[Flow] 🎨 ${i + 1}번째 그림 그리는 중이에요 (${prompts.length}장 중 ${i + 1}번째)`);

      // 안내 팝업이 세션 전환/새로고침 뒤 다시 뜰 수 있으므로 입력 전 한 번 더 닫는다.
      await closeIntroPopup();

      // 첫 화면에서 설정 UI가 늦게 로드되는 경우를 위해 실패했던 경우만 제출 직전 한 번 더 확인한다.
      if (!outputCountIsOne) outputCountIsOne = await setOutputCountToOne();

      // 입력창(보이는 contenteditable/textarea)에 입력.
      // ★오락가락 버그 수정: 1장 생성 직후 화면이 '결과 그리드'로 전환되며 입력창이 잠깐 사라졌다 다시 뜬다.
      //   한 번만 스냅샷 찍으면 그 순간 안 보여서 "입력창 못 찾음"이 됨 → 최대 12초 폴링하며 나타날 때까지 기다린다.
      let entered = false;
      const enterStart = Date.now();
      const enterDeadline = enterStart + 12000;
      let triedRecover = false;
      while (!entered && Date.now() < enterDeadline) {
        // ★프롬프트 입력칸을 '정확히' 고른다(테리: 프롬프트가 엉뚱한 곳으로 밀려감).
        //   Flow 화면엔 상단 검색창·프로젝트명 편집칸 등 다른 편집요소가 있어, 무조건 첫 요소를 잡으면
        //   거기에 타이핑돼 밀린다. → placeholder('무엇을 만들' 등)로 진짜 입력칸을 우선 찾고,
        //   없으면 '화면 최하단에 있는' 편집요소를 프롬프트칸으로 본다. 검색/제목 계열은 제외.
        const target = await page.evaluateHandle(() => {
          const visible = (el: Element) => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.visibility !== "hidden" && s.display !== "none"; };
          const all = [...document.querySelectorAll("[contenteditable=true], textarea")].filter(visible) as HTMLElement[];
          if (!all.length) return null;
          const ph = (el: HTMLElement) => (el.getAttribute("placeholder") || el.getAttribute("aria-label") || el.getAttribute("data-placeholder") || "").toLowerCase();
          const isSearch = (el: HTMLElement) => /검색|search|제목|title|이름|name/.test(ph(el));
          // 1순위: '무엇을 만들' 류 placeholder
          const byPh = all.find(el => /무엇을\s*만들|만들고\s*싶|describe|prompt|생성할/.test(ph(el)));
          if (byPh) return byPh;
          // 2순위: 검색/제목 아닌 것 중 화면 최하단(입력창은 보통 맨 아래)
          const cands = all.filter(el => !isSearch(el));
          const pool = cands.length ? cands : all;
          return pool.sort((a, b) => b.getBoundingClientRect().top - a.getBoundingClientRect().top)[0];
        });
        const el = target.asElement();
        if (el) {
          try {
            await el.click();
            await page.waitForTimeout(400);
            await page.keyboard.press(process.platform === "darwin" ? "Meta+A" : "Control+A");
            await page.keyboard.press("Backspace");
            await page.keyboard.type(prompt, { delay: 15 });
            // 입력 검증: 방금 친 프롬프트가 그 칸에 실제로 들어갔는지 확인(엉뚱한 곳이면 재시도)
            const ok = await el.evaluate((node: any, p: string) => (node instanceof HTMLTextAreaElement ? node.value : (node.textContent || "")).includes(p.slice(0, 20)), prompt).catch(() => false);
            if (ok) entered = true;
          } catch {}
        }
        if (!entered) {
          // ★한 장 만든 뒤 화면이 '결과 그리드'에 머물러 입력창이 안 보일 때: '새로운 세션'을 눌러 입력 화면으로 복귀(한 번만)
          if (!triedRecover && Date.now() - enterStart > 4000) {
            triedRecover = true;
            for (const label of ["새로운 세션", "새 프로젝트", "새 세션", "New session", "New project"]) {
              try { const b = page.locator(`button:has-text("${label}")`).first(); if (await b.count() > 0 && await b.isVisible()) { await b.click({ timeout: 3000 }); log(`[Flow] ↩️ 입력 화면으로 복귀 시도: ${label}`); await page.waitForTimeout(2000); break; } } catch {}
            }
          }
          await page.waitForTimeout(600);   // 아직 안 떴으면 잠깐 기다렸다 다시
        }
      }
      if (!entered) { log("[Flow] ⚠️ 입력창을 못 찾음(12초 대기+복귀 시도해도 안 나타남)"); await dumpFlowControls("입력창 못 찾음"); requeue(); await page.waitForTimeout(2500); continue; }
      await page.waitForTimeout(1500); // 입력 반영 + 전송버튼 활성화 대기

      // 전송 전 이미지 URL 집합 기록(개수가 아닌 URL diff로 새 이미지 판별 → 견고)
      const beforeSrcs: string[] = await page.evaluate(() =>
        [...document.querySelectorAll('img[src*="media.getMediaUrlRedirect"]')]
          .filter(im => (im as HTMLImageElement).naturalWidth >= 500)
          .map(im => (im as HTMLImageElement).src)
      );

      // 클릭 API가 성공해도 React가 이벤트를 놓칠 수 있으므로, 반드시 UI의 "전송 성공 신호"를
      // 확인한다. 실패하면 매번 다른 방식으로 다시 보내고, 전부 실패해도 생성 대기에는 진입하지 않는다.
      // 업로드(add_2/attach/image/reference)는 모든 탐색에서 제외한다.
      const submissionStarted = async (): Promise<boolean> => page.evaluate((expectedPrompt: string) => {
        const visible = (el: Element) => {
          const r = el.getBoundingClientRect();
          const s = getComputedStyle(el);
          return r.width > 0 && r.height > 0 && s.visibility !== "hidden" && s.display !== "none";
        };
        const values = [...document.querySelectorAll("[contenteditable=true], textarea")]
          .filter(visible)
          .map(el => el instanceof HTMLTextAreaElement ? el.value : (el.textContent || ""));
        // Flow는 제출 때 입력 노드를 비우거나 통째로 재렌더한다. 페이지의 다른
        // contenteditable을 잘못 집지 않도록, 방금 입력한 프롬프트의 잔존 여부로 판단한다.
        const inputCleared = !values.some(value => value.includes(expectedPrompt));
        // 완료형인 '이미지를 생성했습니다'는 일부러 포함하지 않는다.
        const generating = /생성\s*중|만들고\s*있|생성하고\s*있|generating|creating\b|thinking/i.test(document.body.innerText);
        return inputCleared || generating;
      }, prompt).catch(() => false);

      // ★제출 성공 신호에 '새 이미지가 실제로 뜨기 시작했나'도 포함(테리: 프롬프트만 계속 반복해서 씀).
      //   Flow가 제출 후에도 입력 텍스트를 잠깐 남기거나 '생성 중' 문구 없이 진행하면 submissionStarted가
      //   오탐(실패)하여 requeue→재타이핑→크레딧 낭비 루프가 됨. 새 큰 이미지가 하나라도 나타나면 제출 성공으로 본다.
      const newImageAppeared = async (): Promise<boolean> => page.evaluate((beforeArr: string[]) => {
        const before = new Set(beforeArr);
        return [...document.querySelectorAll('img[src*="media.getMediaUrlRedirect"]')]
          .some(im => (im as HTMLImageElement).naturalWidth >= 500 && !before.has((im as HTMLImageElement).src));
      }, beforeSrcs).catch(() => false);
      const waitForSubmission = async (): Promise<boolean> => {
        for (let check = 0; check < 10; check++) {
          await page.waitForTimeout(500);
          if (await submissionStarted()) return true;
          if (await newImageAppeared()) return true;
        }
        return false;
      };

      const clickSubmitCandidate = async (mode: "semantic" | "near" | "icon"): Promise<string> => page.evaluate(({ expectedPrompt, mode }) => {
        const visible = (el: Element) => {
          const r = el.getBoundingClientRect();
          const s = getComputedStyle(el);
          return r.width > 0 && r.height > 0 && s.display !== "none" && s.visibility !== "hidden";
        };
        const inputs = [...document.querySelectorAll("[contenteditable=true],textarea")].filter(visible);
        const input = inputs.find(el => (el instanceof HTMLTextAreaElement ? el.value : el.textContent || "").includes(expectedPrompt)) || inputs[0];
        if (!input) throw new Error("prompt input not found");
        const ir = input.getBoundingClientRect();
        const candidates = [...document.querySelectorAll("button,[role=button]")].filter(visible).map(el => {
          const text = `${el.textContent || ""} ${el.getAttribute("aria-label") || ""} ${el.getAttribute("title") || ""}`.replace(/\s+/g, " ").trim();
          const r = el.getBoundingClientRect();
          const distance = Math.hypot(r.left + r.width / 2 - (ir.left + ir.width / 2), r.top + r.height / 2 - (ir.top + ir.height / 2));
          const upload = /add_?2|upload|attach|reference|\uc5c5\ub85c\ub4dc|\ucca8\ubd80|\ucc38\uc870\s*\uc774\ubbf8\uc9c0|\uc774\ubbf8\uc9c0\s*\ucd94\uac00/i.test(text);
          const semantic = /\ub9cc\ub4e4\uae30|\uc0dd\uc131|create|generate|\uc804\uc1a1|submit/i.test(text);
          const icon = /arrow_forward|send|arrow_upward/i.test(text);
          const disabled = (el as HTMLButtonElement).disabled || el.getAttribute("aria-disabled") === "true";
          return { el, text, distance, upload, semantic, icon, disabled };
        }).filter(c => !c.upload && !c.disabled);
        let matches = mode === "semantic" ? candidates.filter(c => c.semantic) :
          mode === "icon" ? candidates.filter(c => c.icon) :
          candidates.filter(c => c.distance < Math.max(500, ir.width * 0.8) && (c.semantic || c.icon || c.distance < 180));
        matches = matches.sort((a, b) => (Number(b.semantic) + Number(b.icon) - b.distance / 1000) - (Number(a.semantic) + Number(a.icon) - a.distance / 1000));
        const chosen = matches[0];
        if (!chosen) throw new Error(`${mode} submit candidate not found`);
        (chosen.el as HTMLElement).click();
        return `${chosen.text.slice(0, 120)} (distance=${Math.round(chosen.distance)})`;
      }, { expectedPrompt: prompt, mode });

      const submitMethods: { name: string; run: () => Promise<string | void> }[] = [
        { name: "Enter", run: async () => { const inp = page.locator("[contenteditable=true]:visible,textarea:visible").filter({ hasText: prompt }).first(); await inp.click({ timeout: 3000 }).catch(async () => page.locator("[contenteditable=true]:visible,textarea:visible").first().click()); await page.keyboard.press("Enter"); } },
        { name: process.platform === "darwin" ? "Meta+Enter" : "Control+Enter", run: async () => { await page.keyboard.press(process.platform === "darwin" ? "Meta+Enter" : "Control+Enter"); } },
        { name: process.platform === "darwin" ? "Control+Enter" : "Meta+Enter", run: async () => { await page.keyboard.press(process.platform === "darwin" ? "Control+Enter" : "Meta+Enter"); } },
        { name: "의미/레이블 버튼", run: () => clickSubmitCandidate("semantic") },
        { name: "입력창 근처 제출 버튼", run: () => clickSubmitCandidate("near") },
        { name: "화살표/send 아이콘 버튼", run: () => clickSubmitCandidate("icon") },
      ];
      let sent = false;
      for (let attempt = 0; attempt < submitMethods.length && !sent; attempt++) {
        const method = submitMethods[attempt];
        try {
          await method.run();
        } catch (e: any) {
          // 전송 방식 실패는 조용히 다음 방식으로(사용자에겐 노이즈). 개발 진단은 최종 실패 로그로 충분.
        }
        sent = await waitForSubmission();
        if (sent) log(`[Flow]    ✅ 그림 그려 달라고 요청했어요`);
        else if (attempt < submitMethods.length - 1) log(`[Flow]    …다시 요청해 볼게요`);
      }
      if (!sent) {
        log(`[Flow] ⚠️ ${i + 1}번째 그림 요청이 잘 안 됐어요. 다시 해볼게요`);
        await dumpFlowControls("프롬프트 전송 실패");
        requeue();
        continue;
      }

      // ★크레딧 승인창 자동 처리 + 크레딧 소진 감지 (테리 실측: "크레딧 15개를 사용하여 생성할까요? [승인]"이
      //   반복해서 뜨고 이미지가 안 나옴). 승인창이 뜨면 '승인, 다시 묻지 않음'을 눌러 진행하고,
      //   '크레딧이 부족'류 문구가 뜨면 아무리 기다려도 안 되므로 즉시 전체 실패로 끝낸다(무한반복 방지).
      const creditState = await page.evaluate(() => {
        const body = document.body.innerText || "";
        const noCredit = /크레딧이?\s*(부족|없|모자|소진)|충분한?\s*크레딧|크레딧을?\s*모두|out of credits|not enough credits|insufficient credit|no credits|한도.*초과|일일.*한도/i.test(body);
        // 크레딧 사용 승인 다이얼로그(예: "크레딧 15개를 사용하여 …생성을 시작할까요?")
        const needApprove = /크레딧\s*\d+\s*개를?\s*사용|크레딧을?\s*사용하여|사용하여\s*\d+개/i.test(body);
        let approved = false;
        if (needApprove) {
          const btns = [...document.querySelectorAll("button,[role=button]")] as HTMLElement[];
          // '승인, 다시 묻지 않음' 우선 → 없으면 '승인'
          const pref = btns.find(b => /승인,?\s*다시\s*묻지\s*않음|승인,?\s*don'?t\s*ask/i.test(b.textContent || ""))
                    || btns.find(b => /^\s*승인\s*$|^\s*approve\s*$/i.test(b.textContent || ""));
          if (pref) { pref.click(); approved = true; }
        }
        return { noCredit, needApprove, approved };
      }).catch(() => ({ noCredit: false, needApprove: false, approved: false }));
      if (creditState.noCredit) {
        log(`[Flow] ⛔ Flow 무료 크레딧이 부족해요 — 이미지를 만들 수 없어요. Flow 계정을 바꾸거나 크레딧이 충전된 뒤 다시 해주세요.`);
        throw new Error("FLOW_NO_CREDIT: Flow 크레딧 부족 — 계정 변경 또는 충전 후 재시도");
      }
      if (creditState.approved) { log(`[Flow] ✅ 크레딧 사용 승인(다시 묻지 않음) — 생성을 진행해요`); await page.waitForTimeout(1500); }
      // 생성 대기(최대 165초): Flow는 한 번에 여러 후보를 순차적으로 렌더할 수 있다.
      // 첫 이미지에서 즉시 끝내지 말고, 생성 표시가 끝나고 후보 개수가 안정될 때까지 수집한다.
      log(`[Flow]    ⏳ 그림이 그려지길 기다리는 중이에요 (보통 1~2분 걸려요)`);
      let freshCandidates: { src: string; width: number; height: number }[] = [];
      let stableChecks = 0;
      let previousCount = 0;
      let firstCandidateAt = -1;
      let lastLoggedCount = -1;   // 상태 변화 있을 때만 로그(도배 방지)
      let policyBlocked = false;  // 구글이 이 프롬프트를 정책 위반으로 거부했는지
      for (let t = 0; t < 55; t++) {
        await page.waitForTimeout(3000);
        const snap = await page.evaluate((beforeArr: string[]) => {
          const before = new Set(beforeArr);
          const bySrc = new Map<string, { src: string; width: number; height: number }>();
          document.querySelectorAll('img[src*="media.getMediaUrlRedirect"]').forEach(im => {
            const el = im as HTMLImageElement;
            if (el.naturalWidth >= 500 && !before.has(el.src)) {
              const old = bySrc.get(el.src);
              if (!old || el.naturalWidth * el.naturalHeight > old.width * old.height) {
                bySrc.set(el.src, { src: el.src, width: el.naturalWidth, height: el.naturalHeight });
              }
            }
          });
          // ⚠️ '이미지를 생성했습니다'(완료) 오탐 방지 — 진행중 표현만 (~중/~ing만)
          const generating = /생성\s*중|만들고\s*있|생성하고\s*있|generating|creating\b|thinking/i.test(document.body.innerText);
          // ★구글이 프롬프트를 "정책 위반"으로 거부한 경우 감지(테리 실측: "이 생성은 구글 정책을 위반할
          //   수 있습니다. 다른 프롬프트를 사용해 보거나 의견을 보내주세요"). 이러면 같은 프롬프트론 계속 거부됨.
          const policyBlocked = /정책을?\s*위반|정책\s*위반|다른\s*프롬프트를?\s*사용|violat|policy|not\s*allowed|can'?t\s*(help|generate|create)|무언가\s*잘못/i.test(document.body.innerText);
          const noCredit = /크레딧이?\s*(부족|없|모자|소진)|충분한?\s*크레딧|크레딧을?\s*모두|out of credits|not enough credits|insufficient credit|no credits/i.test(document.body.innerText);
          return { fresh: [...bySrc.values()], generating, policyBlocked, noCredit };
        }, beforeSrcs);
        // 생성 중 크레딧 소진 감지 → 무한 대기 방지 위해 전체 실패로 끝낸다.
        if ((snap as any).noCredit && snap.fresh.length === 0) { throw new Error("FLOW_NO_CREDIT: Flow 크레딧 부족 — 계정 변경 또는 충전 후 재시도"); }
        // 정책 거부가 뜨면 이 프롬프트로는 아무리 기다려도 안 되므로 즉시 대기 종료한다.
        if (snap.policyBlocked && snap.fresh.length === 0) { policyBlocked = true; break; }
        // ★상태를 눈으로 볼 수 있게(테리: "Flow가 맘대로 움직일 때 알아야 한다"):
        //   후보 이미지 개수가 바뀌거나, 15초마다 "아직 그리는 중"을 로그로 남긴다.
        if (snap.fresh.length !== lastLoggedCount) {
          if (snap.fresh.length > 0) log(`[Flow]    …그림이 ${snap.fresh.length}장 나타났어요 (다 그려지면 제일 예쁜 걸 고를게요)`);
          lastLoggedCount = snap.fresh.length;
        } else if (t > 0 && t % 5 === 0) {
          log(`[Flow]    …${snap.generating ? "아직 그리는 중이에요, 조금만 더 기다려 주세요" : "거의 다 됐어요"} (${(t + 1) * 3}초째)`);
        }
        if (snap.fresh.length > 0) {
          if (firstCandidateAt < 0) firstCandidateAt = t;
          freshCandidates = snap.fresh;
          stableChecks = snap.fresh.length === previousCount ? stableChecks + 1 : 0;
          previousCount = snap.fresh.length;
          // 보통 4장 그리드가 순차 렌더되므로 4장이 모이면 생성 종료+안정을 확인해 종료한다.
          // UI가 4장보다 적게 내는 경우도 있어, 첫 후보 후 30초간 개수가 안정되고 생성 표시가 끝나면 종료한다.
          // 1장 출력으로 설정했다면 첫 이미지가 안정된 즉시 종료한다.
          const gridComplete = outputCountIsOne ? snap.fresh.length >= 1 : snap.fresh.length >= 4;
          const fallbackSettled = t - firstCandidateAt >= 10;
          if (!snap.generating && stableChecks >= 2 && (gridComplete || fallbackSettled)) break;
        }
      }

      // 최종 후보 재수집. DOM 중복은 제거하고 실제 해상도가 큰 순서로 선택한다.
      freshCandidates = await page.evaluate((beforeArr: string[]) => {
        const before = new Set(beforeArr);
        const bySrc = new Map<string, { src: string; width: number; height: number }>();
        document.querySelectorAll('img[src*="media.getMediaUrlRedirect"]').forEach(im => {
          const el = im as HTMLImageElement;
          if (el.naturalWidth >= 500 && !before.has(el.src)) {
            const old = bySrc.get(el.src);
            if (!old || el.naturalWidth * el.naturalHeight > old.width * old.height) {
              bySrc.set(el.src, { src: el.src, width: el.naturalWidth, height: el.naturalHeight });
            }
          }
        });
        return [...bySrc.values()].sort((a, b) => b.width * b.height - a.width * a.height);
      }, beforeSrcs);

      if (freshCandidates.length === 0) {
        if (policyBlocked) {
          // 구글이 이 프롬프트를 정책 위반으로 거부함. 같은 프롬프트론 계속 거부되므로,
          //   딱 한 번만 "안전하고 무난한 프롬프트"로 바꿔 다시 시도하고, 그래도 막히면 건너뛴다.
          if (!softened[i]) {
            const subject = (captions[i] || "").replace(/[^\w가-힣\s]/g, " ").trim().slice(0, 40);
            prompts[i] = `A clean, bright, friendly everyday photo${subject ? ` about ${subject}` : ""}, simple and safe for all audiences, soft natural light, no text, no letters`;
            softened[i] = true;
            log(`[Flow] ⚠️ ${i + 1}번째 그림은 구글이 막았어요(정책). 더 무난한 그림으로 한 번 더 해볼게요`);
            queue.push(i);   // 순화 프롬프트로 재시도
          } else {
            log(`[Flow] ⛔ ${i + 1}번째 그림은 구글 정책 때문에 만들 수 없어 건너뛸게요 (이 그림만 빠집니다)`);
          }
          continue;
        }
        log(`[Flow] ⚠️ ${i + 1}번째 그림이 잘 안 나왔어요. 다시 만들어 볼게요`); requeue(); continue;
      }
      log(`[Flow]    🖼️ 나온 그림 ${freshCandidates.length}장 중에서 제일 예쁜 걸 고르는 중이에요...`);

      // 가장 큰 후보부터 다운로드하되 URL 일시 실패 시 다음 후보로 폴백한다.
      let dataUrl = "ERR:no candidate downloaded";
      let chosen: { src: string; width: number; height: number } | undefined;
      for (const candidate of freshCandidates) {
        dataUrl = await page.evaluate(async (src) => {
          try {
            const res = await fetch(src);
            if (!res.ok) return "ERR:" + res.status;
            const blob = await res.blob();
            return await new Promise<string>(r => { const rd = new FileReader(); rd.onloadend = () => r(rd.result as string); rd.readAsDataURL(blob); });
          } catch (e: any) { return "ERR:" + e.message; }
        }, candidate.src);
        if (dataUrl.startsWith("data:image")) { chosen = candidate; break; }
      }

      if (dataUrl.startsWith("data:image")) {
        results.push({ src: dataUrl, alt: captions[i] || "", promptIndex: i });
        if (chosen) log(`[Flow]    ✅ 제일 예쁜 그림을 골랐어요`);
        // 바탕화면 날짜 폴더에 자동 백업
        if (backupDir) {
          try {
            const safeName = (captions[i] || prompts[i] || `flow_${i + 1}`).slice(0, 30).replace(/[\/\\:*?"<>|]/g, "_").trim();
            const ts = new Date().toISOString().replace(/[:T]/g, "-").slice(0, 19);
            const file = path.join(backupDir, `${safeName}_${ts}.png`);
            fs.writeFileSync(file, Buffer.from(dataUrl.split(",")[1], "base64"));
            log(`[Flow]    💾 그림을 컴퓨터 바탕화면에도 저장해 뒀어요`);
          } catch {}
        }
        log(`[Flow] ✅ ${i + 1}번째 그림 완성! (총 ${prompts.length}장 중 ${results.length}장 다 만들었어요)`);
      } else {
        log(`[Flow] ⚠️ ${i + 1}번째 그림을 가져오지 못했어요. 다시 만들어 볼게요`);
        requeue();
      }
      await page.waitForTimeout(1000);
    }
    if (results.length < target) log(`[Flow] ⚠️ 목표 ${target}장 중 ${results.length}장만 확보 (일부 프롬프트 3회 실패)`);

    // CDP는 연결만 끊고 사용자 크롬은 유지
    await browser.close().catch(() => {});
    log(`🎉 [Flow] 그림 ${results.length}장을 모두 완성했어요! 이제 퍼블리로 가져오는 중이에요...`);
    return results
      .sort((a, b) => a.promptIndex - b.promptIndex)
      .map(({ src, alt }) => ({ src, alt }));
  } catch (e: any) {
    await browser.close().catch(() => {});
    if (results.length > 0) {
      log(`[Flow] ⚠️ 작업 중 예외가 발생했지만 확보한 ${results.length}/${prompts.length}장을 부분 반환합니다: ${String(e?.message || e).split("\n")[0]}`);
      return results
        .sort((a, b) => a.promptIndex - b.promptIndex)
        .map(({ src, alt }) => ({ src, alt }));
    }
    log(`[Flow] ❌ 확보 이미지 없이 중단: ${String(e?.message || e).split("\n")[0]}`);
    throw e;
  }
}
