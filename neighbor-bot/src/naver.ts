import { chromium, BrowserContext } from "playwright";
import fs from "fs";
import https from "https";
import http from "http";
import os from "os";
import path from "path";
import { deleteSession, hasSession, readSession, writeSession, SESSION_DIR } from "./session-store";
import { getAdminBlogSearchKeys, getProxyForAccount } from "./supabase";

const LEGACY_SESSION_DIRS = [path.join(__dirname, "../sessions"), path.join(__dirname, "../../naver-bot/sessions")];
const sessionName = (userId: string) => `naver_${userId}`;
const loadSession = (userId: string) => readSession<any>(sessionName(userId), LEGACY_SESSION_DIRS);

export function naverSessionExists(userId: string): boolean {
  return hasSession(sessionName(userId), LEGACY_SESSION_DIRS);
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
  try { Object.defineProperty(navigator, 'hardwareConcurrency', { get: () => 8 }); } catch (e) {}
  try { Object.defineProperty(navigator, 'deviceMemory', { get: () => 8 }); } catch (e) {}
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

/* ── 계정별 프록시로 브라우저 실행 (모든 chromium.launch를 이걸로 통일) ──
   userId가 있으면 그 계정에 배정된 프록시로, 없거나 미배정이면 프록시 없이(기존 동작 그대로) 실행.
   업체 미선정 상태여도 안전: 배정된 프록시가 없으면 그냥 로컬 IP로 뜬다. */
async function launchBrowser(
  userId: string | null | undefined,
  opts: { headless?: boolean; maximized?: boolean; slowMo?: number; log?: (s: string) => void; feature?: string; ownerUserId?: string | null; authToken?: string } = {}
) {
  const args = opts.maximized ? [...LAUNCH_ARGS, "--start-maximized"] : LAUNCH_ARGS;
  const proxy = await getProxyForAccount(userId, opts.feature, opts.ownerUserId, opts.authToken);
  if (proxy) {
    const masked = (() => {
      try {
        const raw = String(proxy.server);
        const parsed = new URL(raw.includes("://") ? raw : `http://${raw}`);
        const head = parsed.hostname.slice(0, Math.min(3, parsed.hostname.length));
        return `${parsed.protocol}//${head}•••${parsed.port ? `:${parsed.port}` : ""}`;
      } catch { return "설정됨(주소 보호)"; }
    })();
    opts.log?.(`🔒 프록시 사용: ${masked}`);
  }
  return chromium.launch({
    headless: opts.headless ?? true,
    args,
    ...(opts.slowMo ? { slowMo: opts.slowMo } : {}),
    ...(proxy ? { proxy } : {}),
  });
}

/* ── 프록시 헬스체크 (관리자 "프록시 상태판"용) ──
   주어진 프록시로 실제 브라우저를 띄워 바깥으로 나가는 IP·응답속도를 확인한다.
   ok=false면 그 프록시로는 접속이 안 되는 것(죽었거나 인증 틀림). */
export async function checkProxy(proxy: { server: string; username?: string; password?: string }): Promise<{ ok: boolean; ip?: string; ms?: number; error?: string }> {
  const t0 = Date.now();
  // ★값 정리: 복붙 시 앞뒤 공백·개행이 딸려오면 인증/연결이 조용히 실패(407 무한→타임아웃).
  //   server/username/password 모두 trim. 내부 공백은 남기지 않도록 개행/탭도 제거.
  const rawServer = (proxy.server || "").trim();
  const username = (proxy.username || "").replace(/[\s]+/g, "") || undefined;
  const password = (proxy.password || "").trim() || undefined;
  if (!rawServer) return { ok: false, ms: Date.now() - t0, error: "프록시 주소가 비어 있습니다" };
  const server = /^(https?|socks[45]?):\/\//i.test(rawServer) ? rawServer : `http://${rawServer}`;
  // 포트 누락 감지(host:port 형태여야 함) — 포트 없으면 80으로 연결 시도돼 타임아웃 나는 대표 원인
  const hostPort = server.replace(/^[a-z0-9]+:\/\//i, "");
  if (!/:\d{2,5}$/.test(hostPort)) {
    return { ok: false, ms: Date.now() - t0, error: `주소에 포트(:숫자)가 없습니다 → "${hostPort}". 예: gw.dataimpulse.com:823` };
  }
  let browser: any = null;
  try {
    try {
      browser = await chromium.launch({
        headless: true,
        args: LAUNCH_ARGS,
        proxy: { server, username, password },
      });
    } catch (le: any) {
      return { ok: false, ms: Date.now() - t0, error: `브라우저 실행 실패: ${(le?.message || le).toString().slice(0, 150)}` };
    }
    const ctx = await browser.newContext({ locale: "ko-KR" });
    const page = await ctx.newPage();
    // 타임아웃을 15초로 줄여 빠르게 실패 판정(정상이면 1~2초).
    await page.goto("https://api.ipify.org?format=json", { timeout: 15000, waitUntil: "domcontentloaded" });
    const body = await page.evaluate(() => document.body.innerText).catch(() => "");
    let ip = "";
    try { ip = JSON.parse(body).ip || ""; } catch {}
    if (!ip) return { ok: false, ms: Date.now() - t0, error: "IP 확인 실패(응답 이상)" };
    return { ok: true, ip, ms: Date.now() - t0 };
  } catch (e: any) {
    const msg = (e?.message || "연결 실패").toString();
    // 타임아웃이면 = 프록시 응답 없음(주소·포트 틀림) 또는 인증 무한(아이디·비번 틀림)
    const hint = /Timeout/i.test(msg)
      ? `프록시 응답 없음 — 주소/포트 또는 아이디/비밀번호를 확인하세요 (server=${hostPort}${username ? `, id=${username}` : ", id 없음"})`
      : msg.slice(0, 180);
    return { ok: false, ms: Date.now() - t0, error: hint };
  } finally {
    await browser?.close().catch(() => {});
  }
}

/* ★Gemini 표준 모델 리스트 — 글쓰기(callAI)와 동일. 한 모델이 429(한도)여도 다음 모델은 별도 한도라
   끝까지 폴백해야 '한도 부족'으로 헛되이 포기하지 않는다. flash-lite 포함(무료 한도 넉넉). */
const GEMINI_MODELS = ["gemini-2.5-flash", "gemini-2.5-flash-lite", "gemini-flash-latest", "gemini-flash-lite-latest"];

/* ── 멘트 자연 변형 헬퍼 ── */
// ★ 네이버 서이추/댓글 메시지 필드는 4바이트 이모지(😊)를 "?"로 저장함 → 텍스트 이모티콘으로 치환
function emojiToSafeText(s: string): string {
  const map: Record<string, string> = {
    "😊":"^^", "🙂":"^^", "😄":"^^", "😍":"^^", "🤗":"^^", "😆":"^^", "☺️":"^^", "☺":"^^",
    "👍":" 👍", "🙌":"~", "✨":"~", "🌟":"~", "💕":" ♥", "❤️":" ♥", "❤":" ♥", "🎁":"", "🙏":"",
  };
  let out = s;
  for (const [e, t] of Object.entries(map)) out = out.split(e).join(t);
  // 👍/♥ 같은 BMP·이미 안전한 기호는 두되, 남은 4바이트 이모지(😀류)는 제거
  out = out.replace(/[\u{1F000}-\u{1FAFF}\u{1F300}-\u{1F9FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{FE00}-\u{FE0F}\u{200D}]/gu, "");
  return out.replace(/ {2,}/g, " ").trim();
}

// ★AI 한도 소진 시 자동 전환용 순환 댓글 풀(다양한 시작·자연스러운 표현, "와~" 편중 없음).
//   Gemini 무료 한도(하루 제한)를 넘겨도 댓글이 끊기지 않도록 이 중에서 랜덤으로 단다.
const FALLBACK_COMMENTS = [
  // ── 정보·유익 ──
  "좋은 정보 얻어가요, 잘 보고 갑니다!",
  "필요했던 내용인데 도움 많이 됐어요.",
  "꼼꼼하게 정리해주셔서 감사합니다.",
  "유용한 팁 감사해요, 참고할게요!",
  "이런 정보 찾고 있었는데 딱이네요.",
  "설명이 자세해서 이해가 쏙쏙 돼요.",
  "핵심만 딱딱 짚어주셔서 좋았어요.",
  "덕분에 궁금했던 게 풀렸어요, 감사해요.",
  "정리가 잘 되어 있어서 저장해둡니다!",
  "실질적으로 도움되는 글이라 반갑네요.",
  // ── 정성·글솜씨 ──
  "정성스러운 글이네요, 잘 읽었어요.",
  "글이 깔끔해서 읽기 편했어요!",
  "사진이랑 설명이 딱 좋네요, 잘 봤어요.",
  "문장이 술술 읽혀서 끝까지 봤어요.",
  "정성이 느껴지는 포스팅이에요, 최고!",
  "사진도 예쁘고 내용도 알차네요.",
  "구성이 깔끔해서 보기 좋았습니다.",
  // ── 공감·일상 ──
  "공감하며 읽었어요, 좋은 하루 보내세요.",
  "저도 비슷한 경험이 있어서 반가웠어요.",
  "읽는 내내 고개 끄덕이며 봤네요.",
  "마음이 따뜻해지는 글이에요, 잘 봤어요.",
  "괜히 기분 좋아지는 포스팅이네요!",
  "오늘 하루도 힘내시길 바라요, 잘 봤어요.",
  "글에서 진심이 느껴져서 좋았어요.",
  // ── 감탄·리액션 ──
  "우아 이거 완전 꿀팁이네요!",
  "생각지도 못한 방법인데 신기해요.",
  "이렇게 정리된 글은 처음 봐요, 대단해요.",
  "보자마자 감탄했어요, 잘 봤습니다!",
  "역시 전문가는 다르네요, 배우고 가요.",
  // ── 응원·소통 ──
  "잘 보고 갑니다, 다음 글도 기대할게요!",
  "정보 감사합니다, 자주 들를게요.",
  "오늘도 유익한 글 감사합니다.",
  "덕분에 많이 배우고 가요, 감사해요.",
  "다음 포스팅도 기다리고 있을게요!",
  "좋은 글 자주 올려주세요, 응원합니다.",
  "앞으로도 좋은 글 부탁드려요!",
  "잘 보고 가요, 소통해요 우리~",
  "글 보고 힘 얻고 갑니다, 감사해요.",
  "덕분에 좋은 하루 시작하네요, 고마워요.",
];
function pickFallbackComment(): string {
  return FALLBACK_COMMENTS[Math.floor(Math.random() * FALLBACK_COMMENTS.length)];
}
/* ★답방(내 글에 온 댓글에 대한 답글) 전용 순환 문구 — 공감댓글과 성격이 달라 별도 풀. */
const FALLBACK_REPLIES = [
  // 짧고 담백
  "댓글 감사해요!",
  "고맙습니다 :)",
  "반가워요~",
  "들러주셔서 감사해요.",
  "고마워요, 힘이 나네요!",
  // 고마움
  "댓글 남겨주셔서 감사해요, 힘이 나네요!",
  "찾아와 주셔서 고맙습니다, 좋은 하루 보내세요.",
  "읽어주시고 댓글까지, 정말 감사합니다.",
  "소중한 댓글 감사합니다, 좋은 하루 되세요.",
  "응원 감사합니다, 더 좋은 글로 보답할게요.",
  "관심 가져주셔서 감사해요, 또 들러주세요!",
  // 소통 지향
  "따뜻한 댓글 감사해요, 자주 소통해요!",
  "함께해주셔서 감사해요, 자주 뵈어요!",
  "앞으로도 자주 소통해요~ 고맙습니다.",
  "이렇게 와주시니 반갑네요, 종종 놀러오세요!",
  "덕분에 블로그 하는 재미가 나요, 감사해요.",
  // 감정·리액션
  "댓글 보고 미소 지었어요, 고마워요.",
  "덕분에 기운이 나네요, 고맙습니다.",
  "공감해주셔서 감사해요, 반가웠어요!",
  "이런 댓글 정말 큰 힘이 돼요, 감사합니다 😊",
  "따뜻한 한마디에 하루가 밝아지네요!",
  "읽어주신 것만으로도 감사한데 댓글까지, 감동이에요.",
  // 일상·인사
  "방문해주셔서 감사해요, 행복한 하루 보내세요!",
  "오늘도 좋은 하루 보내세요, 고맙습니다.",
  "날씨 좋은데 기분 좋은 하루 되세요 :)",
  "바쁘실 텐데 들러주셔서 감사해요.",
  "편안한 저녁 보내세요, 댓글 고마워요!",
  // 되물음·친근
  "혹시 도움이 되셨을까요? 댓글 감사해요!",
  "재밌게 보셨다니 저도 기뻐요, 고맙습니다.",
  "말씀 남겨주셔서 감사해요, 다음 글도 기대해주세요!",
  "공감해주시니 글 쓴 보람이 있네요, 감사합니다.",
];
function pickFallbackReply(): string {
  return FALLBACK_REPLIES[Math.floor(Math.random() * FALLBACK_REPLIES.length)];
}

function naturalizeMsg(msg: string): string {
  let result = msg;

  // 1) 끝 이모티콘 랜덤 교체/추가 (네이버 안전한 텍스트 이모티콘)
  const emojiPool = ["^^", "~", " :)", " ^^*", "^^~", "!"];
  result = result.replace(/[😊🙂😄👍✨🌟💕🤗😍🙌]$/u, () =>
    emojiPool[Math.floor(Math.random() * emojiPool.length)]
  );

  // 2) 인삿말 미세 변형
  const greetings: Record<string, string[]> = {
    "안녕하세요!": ["안녕하세요~", "안녕하세요 :)", "안녕하세요^^", "안녕하세요!"],
    "안녕하세요": ["안녕하세요~", "안녕하세요^^", "안녕하세요!"],
    "좋은 글": ["좋은 글", "유익한 글", "좋은 내용"],
    "잘 읽고 갑니다": ["잘 읽었습니다", "잘 보고 갑니다", "잘 읽고 갑니다"],
  };
  for (const [key, variants] of Object.entries(greetings)) {
    if (result.includes(key)) {
      const pick = variants[Math.floor(Math.random() * variants.length)];
      result = result.replace(key, pick);
      break;
    }
  }

  // 3) 가끔 앞에 감탄사 추가 (15% 확률)
  const interjections = ["오, ", "와~ ", "정말 ", ""];
  if (Math.random() < 0.15) {
    const interj = interjections[Math.floor(Math.random() * (interjections.length - 1))];
    result = interj + result.charAt(0).toLowerCase() + result.slice(1);
  }

  // 4) 문장 끝 느낌표 ↔ ~ 랜덤 교체 (20% 확률)
  if (Math.random() < 0.2) {
    result = result.replace(/!$/, "~").replace(/~$/, "!");
  }

  // 5) ★ 유니코드 이모지 → 네이버 안전 텍스트 (메시지 어디에 있든 "?" 방지)
  return emojiToSafeText(result);
}

/* ── 휴먼 딜레이 헬퍼 (정규분포) ── */
function humanDelay(minSec: number, maxSec: number): number {
  // 균등 랜덤 대신 정규분포 (중간값에 몰리는 사람 패턴)
  const mean = (minSec + maxSec) / 2;
  const std = (maxSec - minSec) / 4;
  const u = 1 - Math.random();
  const v = Math.random();
  const normal = mean + std * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  return Math.min(maxSec, Math.max(minSec, normal)) * 1000;
}

/* ── 휴먼 타이핑 헬퍼 ── */
async function humanType(page: any, text: string, opts?: { typoRate?: number }) {
  const typoRate = opts?.typoRate ?? 0.04; // 4% 확률로 오타

  // 정규분포 난수 (Box-Muller)
  const randNorm = (mean: number, std: number) => {
    const u = 1 - Math.random();
    const v = Math.random();
    return Math.max(0, mean + std * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v));
  };

  const PUNCTUATION = new Set([".", ",", "!", "?", "~", " ", "\n"]);
  const NEARBY: Record<string, string[]> = {
    "ㄱ":["ㅂ","ㄴ"],"ㄴ":["ㄱ","ㅇ"],"ㄷ":["ㄹ","ㅅ"],"ㄹ":["ㄷ","ㅎ"],
    "a":["s","q"],"s":["a","d"],"d":["s","f"],"e":["w","r"],
  };

  // ★ 스프레드로 순회 = 코드포인트 단위 → 이모지(😊)가 반토막 안 남
  for (const ch of text) {
    // 오타 삽입 (영문/숫자만)
    if (typoRate > 0 && Math.random() < typoRate && /[a-zA-Z]/.test(ch)) {
      const typoPool = NEARBY[ch.toLowerCase()] || ["x"];
      const typo = typoPool[Math.floor(Math.random() * typoPool.length)];
      await page.keyboard.type(typo);
      await page.waitForTimeout(randNorm(120, 40));
      await page.keyboard.press("Backspace");
      await page.waitForTimeout(randNorm(80, 20));
    }

    // 이모지 등 BMP 밖 문자는 keyboard.type이 "?"로 깨짐 → insertText로 직접 삽입
    if ((ch.codePointAt(0) || 0) > 0xFFFF) {
      await page.keyboard.insertText(ch);
    } else {
      await page.keyboard.type(ch);
    }

    // 글자마다 랜덤 딜레이
    if (PUNCTUATION.has(ch)) {
      // 구두점/공백 뒤: 더 긴 멈춤
      await page.waitForTimeout(randNorm(220, 60));
    } else {
      await page.waitForTimeout(randNorm(75, 30));
    }

    // 가끔 생각하는 척 멈춤 (7% 확률, 300~700ms)
    if (Math.random() < 0.07) {
      await page.waitForTimeout(randNorm(500, 120));
    }
  }
}

async function applyAntiDetection(context: BrowserContext) {
  await context.addInitScript(ANTI_DETECTION_SCRIPT);
}

/* ── 이미지 다운로드 (썸네일용) ── */
async function downloadImageToTemp(url: string): Promise<string | null> {
  try {
    const ext = url.includes(".png") ? ".png" : ".jpg";
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
  const browser = await launchBrowser(userId, { headless: false, slowMo: 50 });
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

    // 로그인 버튼 클릭 (네이버 개편: #loginBtn_row/#loginBtn_column, 옛 .btn_login 사라짐)
    let _loginClicked = false;
    for (const _sel of ["#loginBtn_row", "#loginBtn_column"]) {
      try { const _el = await page.$(_sel); if (_el && await _el.isVisible()) { await _el.click(); _loginClicked = true; break; } } catch {}
    }
    if (!_loginClicked) { try { await page.click(".btn_login", { timeout: 2000 }); _loginClicked = true; } catch {} }
    if (!_loginClicked) { try { await page.click("button[type='submit']", { timeout: 2000 }); _loginClicked = true; } catch {} }
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

    // ★★근본해결(네이버ID≠블로그주소): GoBlogWrite 리다이렉트 최종 URL은 `blog.naver.com/{blogId}?Redirect=Write`(경로형)
    //   → 경로형+쿼리형 둘 다 파싱해야 진짜 blogId(예: system-b)를 뽑는다. 기존엔 못 뽑아 네이버ID로 저장→제목변경 등 실패.
    let blogId: string | null = null;
    const pickBlogId = (u: string): string => {
      const mm = u.match(/[?&]blogId=([a-zA-Z0-9_-]+)/) || u.match(/(?:m\.)?blog\.naver\.com\/([a-zA-Z0-9_-]+)/);
      return (mm && mm[1] && !RESOLVE_INVALID.includes(mm[1])) ? mm[1] : "";
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
    // ★비밀번호 저장 (자동 재로그인용, base64) — 재진입 시 세션 만료돼도 저장된 정보로 원터치 재연결되게 함
    writeSession(sessionName(userId), {
      loginId: id,
      blogId,
      cookies,
      pw: Buffer.from(pw, "utf-8").toString("base64"),
    });
    await browser.close();
    return { blogId };
  } catch (e) {
    await browser.close().catch(() => {});
    throw e;
  }
}

/* ── 자동 재로그인 (세션 만료 시) ──
   visible=false: 창 없이 조용히(캡차 안 뜨면 성공). visible=true: 창 띄워 아이디·비번 자동입력 후
   캡차만 사용자가 풀도록 넉넉히 대기(반자동). ★캡차 회피 3종: 실제 브라우저 모드+기존 쿠키/기기신뢰 재사용+사람같은 타이핑. */
export async function reloginNaverSilent(userId: string, visible = false): Promise<boolean> {
  if (!naverSessionExists(userId)) return false;
  const session = loadSession(userId);
  const loginId: string = session.loginId;
  let pw: string | null = null;
  if (session.pw) { try { pw = Buffer.from(session.pw, "base64").toString("utf-8"); } catch {} }
  if (!pw) { console.log("[naver] 자동재로그인 실패: 비밀번호 없음"); return false; }

  const browser = await launchBrowser(userId, { headless: !visible, maximized: visible });
  const context = await browser.newContext({
    userAgent: UA, viewport: { width: 1280, height: 800 },
    locale: "ko-KR", timezoneId: "Asia/Seoul",
  });
  await applyAntiDetection(context);
  // ★캡차 회피: 이전 로그인 쿠키(기기 신뢰 정보)를 미리 넣고 로그인 → 네이버가 '알던 기기'로 인식해 보안문자 빈도↓
  try { if (Array.isArray(session.cookies) && session.cookies.length) await context.addCookies(session.cookies); } catch {}
  const page = await context.newPage();
  if (visible) await page.bringToFront().catch(() => {});

  const hasCaptcha = async (): Promise<boolean> => {
    try {
      return await page.evaluate(() => {
        const sel = "#captcha, .captcha, #chptcha, img[src*='captcha'], #captchaimg, [id*='captcha' i], [class*='captcha' i]";
        const el = document.querySelector(sel) as HTMLElement | null;
        return !!(el && el.offsetParent !== null);
      });
    } catch { return false; }
  };

  try {
    await page.goto("https://nid.naver.com/nidlogin.login", { waitUntil: "domcontentloaded", timeout: 20000 });
    await page.waitForTimeout(600);
    // 사람같은 타이핑(봇 탐지·캡차 유발 감소)
    try { await page.click("#id"); await page.type("#id", loginId, { delay: 60 }); } catch {
      await page.evaluate((v) => { const el = document.querySelector("#id") as HTMLInputElement; if (el) { el.focus(); el.value = v; el.dispatchEvent(new Event("input", { bubbles: true })); } }, loginId);
    }
    await page.waitForTimeout(250);
    try { await page.click("#pw"); await page.type("#pw", pw, { delay: 55 }); } catch {
      await page.evaluate((v) => { const el = document.querySelector("#pw") as HTMLInputElement; if (el) { el.focus(); el.value = v; el.dispatchEvent(new Event("input", { bubbles: true })); } }, pw);
    }
    await page.waitForTimeout(300);
    {
      let _c = false;
      for (const _s of ["#loginBtn_row", "#loginBtn_column"]) { try { const _e = await page.$(_s); if (_e && await _e.isVisible()) { await _e.click(); _c = true; break; } } catch {} }
      if (!_c) { try { await page.click(".btn_login", { timeout: 2000 }); _c = true; } catch {} }
      if (!_c) { try { await page.click("button[type='submit']", { timeout: 2000 }); _c = true; } catch {} }
      if (!_c) { await page.keyboard.press("Enter"); }
    }

    // 로그인 완료(=nidlogin 벗어남) 대기. visible이면 캡차를 직접 풀 시간을 넉넉히(2분).
    const timeout = visible ? 120000 : 15000;
    try {
      await page.waitForFunction(() => !location.href.includes("nid.naver.com/nidlogin"), { timeout });
    } catch {
      // 아직 로그인 페이지 = 캡차/2단계 등으로 막힘
      if (!visible && await hasCaptcha()) console.log("[naver] 자동재로그인: 보안문자(캡차) 감지 — 창 모드로 재시도 필요");
      await browser.close().catch(() => {});
      return false;
    }
    await page.waitForTimeout(1500);
    if (page.url().includes("nidlogin")) { await browser.close(); return false; }

    const cookies = await context.cookies();
    const oldSession = loadSession(userId);
    writeSession(sessionName(userId), { ...oldSession, cookies });   // ★비번 유지, 쿠키만 갱신
    await browser.close();
    console.log(`[naver] ✅ 자동 재로그인 성공${visible ? " (창 모드)" : ""}`);
    return true;
  } catch {
    await browser.close().catch(() => {});
    return false;
  }
}

/* ★쿠키로 로그인이 실제로 살아있는지 확인(가벼운 fetch). 만료 시 nidlogin으로 리다이렉트됨. */
async function isSessionAlive(cookies: any[]): Promise<boolean> {
  try {
    const cookieHeader = (cookies || []).map((c: any) => `${c.name}=${c.value}`).join("; ");
    if (!cookieHeader) return false;
    const r = await fetch("https://blog.naver.com/GoBlogWrite.naver", { headers: { cookie: cookieHeader, "user-agent": UA } as any, redirect: "manual" as any });
    const loc = r.headers.get("location") || "";
    if (/nidlogin|nid\.naver\.com|\/login/i.test(loc)) return false;       // 만료 = 로그인 페이지로 튕김
    if (/PostWriteForm|RedirectWriteView|blogId=|Redirect=Write|blog\.naver\.com\/[a-zA-Z0-9_-]+/i.test(loc)) return true;  // 유효 = 글쓰기 폼/내 블로그로
    return r.status >= 200 && r.status < 400;                                // 애매하면 유효로 가정(실작업서 재확인)
  } catch { return true; }   // 네트워크 오류는 만료로 오판하지 않는다
}

/* ★★세션 원터치 재연결: 실행 시작 시 세션이 살아있으면 그대로, 만료면 저장된 비번으로 자동 재로그인.
   성공하면 최신 쿠키 반환, 실패(비번없음·캡차)면 명확한 재연결 안내를 throw → 프론트가 "재연결 필요"로 표시. */
export async function ensureLiveSession(accountId: string, log: (m: string) => void = console.log): Promise<any[]> {
  if (!naverSessionExists(accountId)) throw new Error("세션 없음 — 먼저 로그인하세요");
  const cookies = loadSession(accountId).cookies;
  if (await isSessionAlive(cookies)) return cookies;
  log("[세션] 로그인이 만료돼 저장된 정보로 자동 재연결을 시도해요...");
  // 1차: 조용히(창 없이) 재로그인 — 캡차 안 뜨면 바로 성공
  if (await reloginNaverSilent(accountId, false)) { log("[세션] ✅ 자동 재연결 성공 (계속 진행해요)"); return loadSession(accountId).cookies; }
  // 2차: 창을 띄워 아이디·비번 자동입력 → 보안문자(캡차)만 직접 풀면 이어서 진행(반자동)
  log("[세션] 🔐 보안문자(캡차)가 필요해요. 로그인 창을 띄웠어요 — 아이디·비번은 자동으로 채웠으니 보안문자만 입력해주세요(최대 2분 대기).");
  if (await reloginNaverSilent(accountId, true)) { log("[세션] ✅ 재연결 성공 (계속 진행해요)"); return loadSession(accountId).cookies; }
  throw new Error("로그인 재연결에 실패했어요. 계정 관리에서 '연결하기'를 한 번 눌러 직접 로그인해주세요.");
}

/* ── 카테고리 목록 조회 ── */
export async function getNaverCategories(
  userId: string
): Promise<{ id: string; name: string }[]> {
  if (!naverSessionExists(userId)) throw new Error("네이버 세션 없음");
  const _s = loadSession(userId); const cookies = _s.cookies;
  const blogId = await resolveBlogIdFast(_s.blogId, cookies, userId, console.log);  // ★네이버ID≠blogId 대비
  const browser = await launchBrowser(userId, { headless: true });
  const context = await browser.newContext({
    userAgent: UA, viewport: { width: 1280, height: 800 },
    locale: "ko-KR", timezoneId: "Asia/Seoul",
  });
  await applyAntiDetection(context);
  await context.addCookies(cookies);
  const page = await context.newPage();

  try {
    await page.goto(
      `https://blog.naver.com/PostWriteForm.naver?blogId=${blogId}`,
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
      frame = getFrame();
    }
    if (!frame) { await browser.close(); return []; }

    // 발행 패널 열기
    const publishSels = [
      "button.publish_btn__Y8C4q",
      "button[class*='publish_btn']",
      "button:has-text('발행')",
    ];
    for (const sel of publishSels) {
      try {
        const el = await frame.$(sel);
        if (el) { await frame.click(sel, { timeout: 5000 }); break; }
      } catch {}
    }
    await page.waitForTimeout(2500);

    // 카테고리 select 옵션 추출
    const categories: { id: string; name: string }[] = [];
    const catSels = [
      "select.category_select__YWKIP",
      "select[class*='category_select']",
      "select[class*='category']",
      ".publish_panel select",
      "select[name='categoryNo']",
    ];
    for (const sel of catSels) {
      try {
        const opts = await frame.$$(sel + " option");
        if (opts.length > 0) {
          for (const opt of opts) {
            const value = await opt.getAttribute("value");
            const text = await opt.textContent();
            if (value && value !== "0" && value !== "-1" && text?.trim()) {
              categories.push({ id: value, name: text.trim() });
            }
          }
          break;
        }
      } catch {}
    }
    await browser.close();
    return categories;
  } catch (e) {
    await browser.close().catch(() => {});
    console.error("[naver] 카테고리 조회 실패:", e);
    return [];
  }
}

/* ── 네이버 블로그 자동발행 ── */
export async function publishNaver(params: {
  userId: string;
  title: string;
  content: string;
  tags: string[];
  imageUrl?: string;
  categoryId?: string;
  visibility?: "public" | "neighbor" | "private";
  scheduleTime?: string;
  blocks?: Array<{type: string; content?: string; src?: string; alt?: string}>;
}): Promise<string> {
  const { userId, title, content, tags, imageUrl, categoryId, visibility = "public", scheduleTime, blocks } = params;
  if (!naverSessionExists(userId)) throw new Error("네이버 세션 없음. 계정 재연결 필요");
  const _ps = loadSession(userId); const cookies = _ps.cookies;
  const blogId = await resolveBlogIdFast(_ps.blogId, cookies, userId, console.log);  // ★네이버ID≠blogId 대비(모든 탭 공용)

  const browser = await launchBrowser(userId, { headless: false });
  const context = await browser.newContext({
    userAgent: UA, viewport: { width: 1280, height: 800 },
    locale: "ko-KR", timezoneId: "Asia/Seoul",
  });
  await applyAntiDetection(context);
  await context.addCookies(cookies);
  const page = await context.newPage();

  try {
    const writeUrl = `https://blog.naver.com/PostWriteForm.naver?blogId=${blogId}`;
    console.log(`[naver] 글쓰기 진입: ${writeUrl}`);
    await page.goto(writeUrl, { waitUntil: "domcontentloaded", timeout: 60000 });

    if (page.url().includes("nidlogin") || page.url().includes("login.naver")) {
      deleteSession(sessionName(userId), LEGACY_SESSION_DIRS);
      throw new Error("네이버 세션 만료. 재연결 필요");
    }

    console.log("[naver] SE4 로드 대기...");
    await page.waitForLoadState("networkidle", { timeout: 30000 }).catch(() => {});
    await page.waitForTimeout(5000);

    const getFrame = () => {
      const frames = page.frames();
      return frames.find(f => f.name() === "mainFrame")
        ?? frames.find(f => f.url().includes("blog.naver.com"))
        ?? frames[1] ?? null;
    };

    let frame = getFrame();
    for (let i = 0; i < 10; i++) {
      await page.waitForTimeout(1000);
      frame = getFrame();
      if (frame) break;
    }
    if (!frame) throw new Error("mainFrame을 찾을 수 없습니다");
    console.log("[naver] mainFrame 획득!");

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

    // SE4 로드 완료 대기
    try {
      await frame.waitForSelector(".se-section-documentTitle, .se-editor, .se-container", { timeout: 40000 });
    } catch {}
    await page.waitForTimeout(3000);

    // ── 제목 입력 ──
    console.log("[naver] 제목 입력...");
    const titleSels = [
      ".se-section-documentTitle .se-text-paragraph span[contenteditable='true']",
      ".se-section-documentTitle [contenteditable='true']",
      ".se-section-documentTitle .se-text-paragraph",
    ];
    let titleInserted = false;
    for (const sel of titleSels) {
      try {
        const el = await frame.$(sel);
        if (el) {
          await frame.click(sel, { timeout: 5000 });
          await page.waitForTimeout(400);
          await frame.evaluate((t) => {
            document.execCommand("selectAll", false);
            document.execCommand("insertText", false, t);
          }, title);
          await page.waitForTimeout(600);
          titleInserted = true;
          break;
        }
      } catch {}
    }
    if (!titleInserted) {
      await frame.click(".se-section-documentTitle", { timeout: 5000 });
      await page.waitForTimeout(500);
      await page.keyboard.type(title, { delay: 40 });
    }

    // ── 이미지 삽입 (썸네일) ──
    if (imageUrl) {
      console.log("[naver] 이미지 삽입 시도...");
      const tmpFile = await downloadImageToTemp(imageUrl);
      if (tmpFile) {
        try {
          // SE4 툴바 이미지 버튼
          const imgBtnSels = [
            "button[data-type='image']",
            ".se-toolbar-item-imageUpload button",
            "button[title='이미지']",
            "button[class*='image']",
          ];
          let imgBtnClicked = false;
          for (const sel of imgBtnSels) {
            try {
              const el = await frame.$(sel);
              if (el) { await frame.click(sel, { timeout: 3000 }); imgBtnClicked = true; break; }
            } catch {}
          }
          if (imgBtnClicked) {
            await page.waitForTimeout(1500);
            // 파일 업로드 input 찾기
            const fileInput = await page.$("input[type='file']");
            if (fileInput) {
              await fileInput.setInputFiles(tmpFile);
              await page.waitForTimeout(3000);
              console.log("[naver] ✅ 이미지 업로드 완료");
            }
          }
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

    // 텍스트 블록 입력 헬퍼
    async function insertText(text: string) {
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

      await clickEditor();
      await page.waitForTimeout(300);
      const lines = plain.split("\n");
      for (let i = 0; i < lines.length; i++) {
        if (lines[i].trim()) {
          await frame.evaluate((t) => { document.execCommand("insertText", false, t); }, lines[i]);
        }
        if (i < lines.length - 1) {
          await page.keyboard.press("Enter");
          await page.waitForTimeout(20);
        }
      }
    }

    // 이미지 업로드 헬퍼
    async function uploadImage(imgUrl: string) {
      const tmpFile = await downloadImageToTemp(imgUrl);
      if (!tmpFile) { console.log("[naver] 이미지 다운로드 실패:", imgUrl.slice(0,60)); return; }
      try {
        // 에디터 포커스
        await clickEditor();
        await page.waitForTimeout(500);
        await page.keyboard.press("End");
        await page.keyboard.press("Enter");
        await page.waitForTimeout(500);

        // 이미지 버튼 클릭 - page 레벨과 frame 레벨 모두 시도
        const imgBtnSels = [
          "button[data-type='image']",
          ".se-toolbar-item-imageUpload button",
          "button[title='이미지']",
          "button[aria-label='이미지']",
          ".se-toolbar button[class*='image']",
        ];
        let clicked = false;

        // frame에서 먼저 시도
        for (const sel of imgBtnSels) {
          try {
            await frame.waitForSelector(sel, { timeout: 1000 });
            await frame.click(sel, { timeout: 2000 });
            clicked = true;
            console.log("[naver] 이미지 버튼 클릭:", sel);
            break;
          } catch {}
        }

        // page 전체에서도 시도
        if (!clicked) {
          for (const sel of imgBtnSels) {
            try {
              await page.waitForSelector(sel, { timeout: 1000 });
              await page.click(sel, { timeout: 2000 });
              clicked = true;
              break;
            } catch {}
          }
        }

        if (clicked) {
          await page.waitForTimeout(2000);
          // file input 찾기 - page 전체에서
          const fileInput = await page.$("input[type='file']") || await frame.$("input[type='file']");
          if (fileInput) {
            await fileInput.setInputFiles(tmpFile);
            await page.waitForTimeout(4000);
            console.log("[naver] ✅ 이미지 업로드 완료");
          } else {
            console.log("[naver] file input 못 찾음");
          }
        } else {
          console.log("[naver] 이미지 버튼 못 찾음 - 이미지 스킵");
        }
      } catch (e) {
        console.log("[naver] 이미지 업로드 실패:", e);
      } finally {
        try { fs.unlinkSync(tmpFile); } catch {}
      }
      await page.waitForTimeout(1000);
    }

    // blocks가 있으면 블록 순서대로, 없으면 기존 방식
    if (blocks && blocks.length > 0) {
      for (const block of blocks) {
        if (block.type === "text" && block.content) {
          await insertText(block.content);
          await page.waitForTimeout(200);
        } else if (block.type === "image-pair" && (block as any).images?.length >= 2) {
          // 2장 동시 업로드 → 한 줄 나란히 배치
          const pairImages = (block as any).images as {src:string;alt:string}[];
          const tmp1 = await downloadImageToTemp(pairImages[0].src);
          const tmp2 = await downloadImageToTemp(pairImages[1].src);
          if (tmp1 && tmp2) {
            try {
              await clickEditor();
              await page.waitForTimeout(500);
              await page.keyboard.press("End");
              await page.keyboard.press("Enter");
              await page.waitForTimeout(500);
              const imgBtnSels = [
                "button[data-type='image']",
                ".se-toolbar-item-imageUpload button",
                "button[title='이미지']",
                "button[aria-label='이미지']",
              ];
              let clicked = false;
              for (const sel of imgBtnSels) {
                try { await frame.waitForSelector(sel,{timeout:1000}); await frame.click(sel,{timeout:2000}); clicked=true; break; } catch {}
              }
              if (!clicked) {
                for (const sel of imgBtnSels) {
                  try { await page.waitForSelector(sel,{timeout:1000}); await page.click(sel,{timeout:2000}); clicked=true; break; } catch {}
                }
              }
              if (clicked) {
                await page.waitForTimeout(2000);
                const fileInput = await page.$("input[type='file']") || await frame.$("input[type='file']");
                if (fileInput) {
                  // 2장 동시 선택
                  await fileInput.setInputFiles([tmp1, tmp2]);
                  await page.waitForTimeout(5000);
                  console.log("[naver] ✅ 이미지 페어 업로드 완료");
                }
              }
            } catch(e) { console.log("[naver] 페어 이미지 업로드 실패:", e); }
            finally {
              try { fs.unlinkSync(tmp1); } catch {}
              try { fs.unlinkSync(tmp2); } catch {}
            }
          }
        } else if (block.type === "image" && block.src) {
          // 썸네일(imageUrl)과 같은 이미지는 이미 상단에 올라가 있으므로 스킵
          if (block.src !== imageUrl) {
            await uploadImage(block.src);
          }
        }
      }
    } else {
      // fallback: blocks 없으면 기존 텍스트 입력 방식
      await insertText(content);
    }

    await page.waitForTimeout(1000);

    // ── 발행 패널 열기 ──
    console.log("[naver] 발행 패널 열기...");
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

    // ── 카테고리 선택 ──
    if (categoryId) {
      console.log(`[naver] 카테고리 선택: ${categoryId}`);
      try {
        const catSels = [
          "select.category_select__YWKIP",
          "select[class*='category_select']",
          "select[class*='category']",
          "select[name='categoryNo']",
        ];
        for (const sel of catSels) {
          try {
            const el = await frame.$(sel);
            if (el) {
              await frame.selectOption(sel, categoryId);
              await page.waitForTimeout(500);
              console.log("[naver] ✅ 카테고리 선택 완료");
              break;
            }
          } catch {}
        }
      } catch (e) { console.log("[naver] 카테고리 선택 실패 (무시):", e); }
    }

    // ── 공개 설정 ──
    console.log(`[naver] 공개 설정: ${visibility}`);
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

    // ── 예약 발행 ──
    if (scheduleTime) {
      console.log(`[naver] 예약 발행 설정: ${scheduleTime}`);
      try {
        // "예약" 옵션 선택
        const scheduleSels = [
          "label:has-text('예약')",
          "button:has-text('예약')",
          "input[value='schedule'] + label",
          ".se-schedule-button",
          "[class*='schedule']",
        ];
        let scheduleToggled = false;
        for (const sel of scheduleSels) {
          try {
            const el = await frame.$(sel);
            if (el) { await frame.click(sel, { timeout: 3000 }); scheduleToggled = true; break; }
          } catch {}
        }
        if (scheduleToggled) {
          await page.waitForTimeout(1000);
          // 날짜/시간 입력
          // scheduleTime format: "2025-03-15T10:00"
          const dt = new Date(scheduleTime);
          const year  = dt.getFullYear().toString();
          const month = String(dt.getMonth() + 1).padStart(2, "0");
          const day   = String(dt.getDate()).padStart(2, "0");
          const hour  = String(dt.getHours()).padStart(2, "0");
          const min   = String(dt.getMinutes()).padStart(2, "0");

          // 날짜 입력
          const dateSels = [
            "input[class*='date']",
            "input[name='publishDate']",
            "input[placeholder*='날짜']",
            "input[type='date']",
          ];
          for (const sel of dateSels) {
            try {
              const el = await frame.$(sel);
              if (el) {
                await frame.click(sel, { clickCount: 3 }).catch(() => frame.click(sel));
                await frame.fill(sel, `${year}-${month}-${day}`);
                await page.waitForTimeout(300);
                break;
              }
            } catch {}
          }
          // 시간 입력
          const timeSels = [
            "input[class*='time']",
            "input[name='publishTime']",
            "input[placeholder*='시간']",
            "input[type='time']",
          ];
          for (const sel of timeSels) {
            try {
              const el = await frame.$(sel);
              if (el) {
                await frame.click(sel, { clickCount: 3 }).catch(() => frame.click(sel));
                await frame.fill(sel, `${hour}:${min}`);
                await page.waitForTimeout(300);
                break;
              }
            } catch {}
          }
          await page.waitForTimeout(500);
          console.log(`[naver] ✅ 예약 날짜 설정: ${year}-${month}-${day} ${hour}:${min}`);
        }
      } catch (e) { console.log("[naver] 예약 발행 설정 실패 (무시):", e); }
    }

    // ── 최종 발행 또는 예약 확정 ──
    console.log("[naver] 최종 발행...");
    const finalLabel = scheduleTime ? "예약" : "발행";
    const finalSels = scheduleTime
      ? [
          "button[class*='confirm']:has-text('예약')",
          "button:has-text('예약 발행')",
          "button:has-text('예약')",
          "button.confirm_btn__xiHQQ",
          "button[class*='confirm_btn']",
        ]
      : [
          "button.confirm_btn__xiHQQ",
          "button[class*='confirm_btn']",
          "button:has-text('발행')",
        ];

    let finalDone = false;
    for (const sel of finalSels) {
      try {
        const el = await frame.$(sel);
        if (el) { await frame.click(sel, { timeout: 8000 }); finalDone = true; break; }
      } catch {}
    }
    if (!finalDone) {
      const btns = await frame.$$("button");
      for (const btn of btns.reverse()) {
        const txt = await btn.textContent();
        if (txt?.includes(finalLabel)) { await btn.click(); finalDone = true; break; }
      }
    }

    await page.waitForTimeout(scheduleTime ? 3000 : 5000);

    // URL 추출
    let postUrl = page.url();
    const viewMatch = postUrl.match(/blog\.naver\.com\/[^/]+\/(\d+)/) || postUrl.match(/logNo=(\d+)/);
    if (viewMatch) postUrl = `https://blog.naver.com/${blogId}/${viewMatch[1]}`;
    if (scheduleTime) postUrl = `https://blog.naver.com/${blogId}`;

    // 쿠키 갱신
    const newCookies = await context.cookies();
    const session = loadSession(userId);
    session.cookies = newCookies;
    writeSession(sessionName(userId), session);

    await browser.close();
    console.log(`[naver] ✅ ${scheduleTime ? "예약 완료" : "발행 완료"}: ${postUrl}`);
    return postUrl;
  } catch (e: any) {
    console.error("[naver] ❌ 에러:", e.message);
    try {
      const debugDir = path.join(__dirname, "../debug");
      if (!fs.existsSync(debugDir)) fs.mkdirSync(debugDir, { recursive: true });
      await page.screenshot({ path: path.join(debugDir, `naver_error_${Date.now()}.png`), fullPage: true });
    } catch {}
    await browser.close().catch(() => {});
    throw e;
  }
}

/* ── 서이추 전용 함수들 ──────────────────────────────────── */

export interface NeighborResult {
  keyword: string;
  blogId: string;
  status: "success" | "fail" | "skip";
  message: string;
}

// server.ts가 사용하는 이름으로 re-export
export function sessionExists(accountId: string): boolean {
  return naverSessionExists(accountId);
}

// 계정 로그인 세션 삭제 (계정 삭제 시)
export function removeSession(accountId: string): void {
  try { deleteSession(sessionName(accountId), LEGACY_SESSION_DIRS); } catch {}
}

export async function saveSession(
  accountId: string, id: string, pw: string
): Promise<{ blogId: string }> {
  return saveNaverSession(accountId, id, pw);
}

export function donePath(accountId: string): string {
  return path.join(SESSION_DIR, `done_${accountId}.json`);
}

/* ── 당일 중복방지 공용 유틸 ──
   done 기록에 처리 날짜(KST)를 함께 저장 → "오늘 이미 작업한 대상"은 skipDone 토글과 무관하게 항상 스킵.
   기존 배열([blogId,...]) 파일은 자동 하위호환(과거 처리분=legacy로 취급, 당일 아님). */
export function todayKST(): string {
  return new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10); // YYYY-MM-DD (Asia/Seoul)
}
export function loadDoneMap(fp: string): Record<string, string> {
  try {
    if (!fs.existsSync(fp)) return {};
    const raw = JSON.parse(fs.readFileSync(fp, "utf-8"));
    if (Array.isArray(raw)) { const m: Record<string, string> = {}; for (const id of raw) m[String(id)] = "legacy"; return m; }
    if (raw && typeof raw === "object") return raw as Record<string, string>;
    return {};
  } catch { return {}; }
}

/* ── 재신청 방지 기간: 실패/무응답 건은 마지막 시도일 기록 → N일 지나면 재시도 허용 ── */
function attemptsPath(accountId: string): string {
  return path.join(SESSION_DIR, `attempts_${accountId}.json`);
}
export function loadAttempts(accountId: string): Record<string, number> {
  try { return JSON.parse(fs.readFileSync(attemptsPath(accountId), "utf-8")) || {}; } catch { return {}; }
}
export function saveAttempt(accountId: string, blogId: string, map: Record<string, number>): void {
  map[blogId] = Date.now();
  try { fs.writeFileSync(attemptsPath(accountId), JSON.stringify(map)); } catch {}
}

/* ── 키워드로 블로그 수집 (체험단 최적화판) ──
   네이버 검색이 SPA로 바뀌어 HTML 스크레이핑이 죽음 → ajax JSON API로 전환.
   추가로 체험단 모집에 맞게: 최신활동 우선 정렬 / 판매·마켓글 제외 / 활동 블로거 필터 / 메타데이터 수집. */
const INVALID_BLOG_IDS = ["PostList","BlogHome","FeedList","neighborPostList","TagList","GoBlogWrite","search","Search","blogpeople","people","section","recommend","ThemePost","BlogTop"];

export interface BlogTarget {
  keyword: string;
  blogId: string;
  nickName?: string;
  blogName?: string;
  addDate?: number;   // 최근 글 작성일(ms) — 활동성 판단용
  postUrl?: string;
  thumbnail?: string;
}

export async function crawlBlogIds(params: {
  accountId: string;
  keywords: string[];
  countPerKeyword: number;
  orderBy?: "sim" | "recentdate";   // 정렬: 정확도 vs 최신(기본 최신 = 활동중 블로거 우선)
  activeDays?: number;              // 최근 N일 내 글쓴 블로거만 (0/미지정 = 무제한)
  excludeMarket?: boolean;          // 판매·마켓 블로거 제외 (기본 true)
  ownerUserId?: string | null;      // 프록시 회원 배정 fallback용(크롤링 기능 토글)
  onLog?: (msg: string) => void;
}): Promise<BlogTarget[]> {
  const { keywords, countPerKeyword, onLog } = params;
  const orderBy = params.orderBy || "recentdate";
  const activeDays = params.activeDays ?? 0;
  const excludeMarket = params.excludeMarket !== false;
  const log = onLog || console.log;
  const activeCutoff = activeDays > 0 ? Date.now() - activeDays * 86400000 : 0;

  const results: BlogTarget[] = [];
  const seen = new Set<string>();   // ★ 키워드 전체에 걸쳐 중복 블로그 제거(루프 밖에서 유지)
  // 🔒 크롤링 기능 프록시: 관리자가 프록시탭에서 'crawl' 토글을 켠 계정/회원이면 그 IP로 접속
  const browser = await launchBrowser(params.accountId, { headless: true, log, feature: "crawl", ownerUserId: params.ownerUserId });
  const context = await browser.newContext({ userAgent: UA, locale: "ko-KR" });
  await applyAntiDetection(context);
  const page = await context.newPage();

  try {
    for (const kw of keywords) {
      log(`[수집] "${kw}" 검색 중... (정렬: ${orderBy === "recentdate" ? "최신활동" : "정확도"}${excludeMarket ? ", 판매글 제외" : ""})`);
      // Referer/쿠키 세팅 위해 검색 페이지 먼저 방문
      await page.goto(`https://section.blog.naver.com/Search/Post.naver?term=${encodeURIComponent(kw)}`,
        { waitUntil: "domcontentloaded", timeout: 20000 }).catch(() => {});
      await page.waitForTimeout(500);

      let got = 0, skippedMarket = 0, skippedStale = 0;
      const perPage = 10, maxPages = 20;

      for (let pageNum = 1; pageNum <= maxPages && got < countPerKeyword; pageNum++) {
        const apiUrl = `https://section.blog.naver.com/ajax/SearchList.naver?countPerPage=${perPage}&currentPage=${pageNum}&endDate=&keyword=${encodeURIComponent(kw)}&orderBy=${orderBy}&startDate=&type=post`;
        let list: any[] = [];
        try {
          const raw = await page.evaluate(async (u) => {
            const r = await fetch(u, { headers: { Referer: location.href } });
            return await r.text();
          }, apiUrl);
          const data = JSON.parse(raw.replace(/^\)\]\}',?\s*/, ""));
          list = data?.result?.searchList || [];
        } catch { list = []; }

        if (!list.length) break;

        for (const item of list) {
          const blogId = item.domainIdOrBlogId || item.blogId;
          if (!blogId || INVALID_BLOG_IDS.includes(blogId) || seen.has(blogId)) continue;
          if (excludeMarket && (item.marketPost || item.product)) { skippedMarket++; continue; }
          if (activeCutoff && item.addDate && item.addDate < activeCutoff) { skippedStale++; continue; }
          seen.add(blogId);
          results.push({
            keyword: kw,
            blogId,
            nickName: item.nickName || undefined,
            blogName: item.blogName || undefined,
            addDate: item.addDate || undefined,
            postUrl: item.postUrl || undefined,
            thumbnail: item.thumbnails?.[0]?.url || item.profileImgUrl || undefined,
          });
          got++;
          if (got >= countPerKeyword) break;
        }
        await page.waitForTimeout(250);
      }

      log(`[수집] "${kw}" → ${got}개 수집` +
        (skippedMarket ? ` (판매글 ${skippedMarket}개 제외)` : "") +
        (skippedStale ? ` (오래된 블로그 ${skippedStale}개 제외)` : ""));

      // 폴백: JSON에서 하나도 못 얻으면 모바일 검색 스크레이핑
      if (got === 0) {
        log(`[수집] "${kw}" API 0건 → 모바일 검색 폴백...`);
        try {
          const fb = await crawlMobileFallback(context, kw, countPerKeyword);
          for (const b of fb) { if (!seen.has(b.blogId)) { seen.add(b.blogId); results.push(b); } }
          log(`[수집] "${kw}" 폴백 → ${fb.length}개`);
        } catch (e: any) { log(`[수집] 폴백 실패: ${e.message}`); }
      }
    }
  } finally {
    await browser.close().catch(() => {});
  }

  return results;
}

/* ── 🗺️ 네이버 플레이스 업체 발굴 ──
   지역+업종으로 네이버 지도의 업체를 수집(사장님 대상 영업 / 블로거 역추적의 출발점).
   ★검증(2026-08-28): pcmap.place.naver.com/{도메인}/list?query=... 페이지의 window.__APOLLO_STATE__에
     업체(이름·카테고리·주소·방문자리뷰수·블로그리뷰수)가 들어있음. raw curl은 ncaptcha로 막히지만
     anti-detection 브라우저 컨텍스트 안에선 통과(블로그 발굴과 동일 원리). 프록시는 계정 배정 IP 사용. */
export interface PlaceTarget {
  placeId: string;
  name: string;
  category?: string;
  address?: string;
  visitorReviewCount?: number;
  blogReviewCount?: number;
  placeUrl: string;
}

export interface PlaceDetail extends PlaceTarget {
  imageUrls: string[];
  businessHours?: string;
  phone?: string;
  menus: { name: string; price?: string }[];
  conveniences: string[];
  bookingAvailable?: boolean;
  collectedAt: string;
  // ── 상위노출 종합진단용 확장 필드(같은 __APOLLO_STATE__에서 추가 추출) ──
  savedCount?: number;         // 저장(찜) 수 — 상위노출 핵심 신호
  visitorReviewScore?: number; // 방문자 평점
  description?: string;        // 매장 소개/한줄평
  keywords?: string[];         // 방문자가 많이 남긴 대표 키워드
  hasTalktalk?: boolean;       // 네이버 톡톡 연결 여부
  homepage?: string;          // 홈페이지/SNS 링크
  newsCount?: number;          // 소식/공지 개수
  photoCount?: number;         // 등록 사진 총 개수
  imageCount?: number;         // (photoCount 별칭 원본)
}

/** 공개 플레이스 홈에서 고객에게 실제로 보이는 상세정보만 읽는다.
 * 필드가 확인되지 않으면 추측하거나 "없음"으로 바꾸지 않고 비워 둔다. */
export async function crawlPlaceDetail(params: {
  accountId: string;
  placeId: string;
  domain?: string;
  ownerUserId?: string | null;
  onLog?: (msg: string) => void;
}): Promise<PlaceDetail> {
  const domain = params.domain || "place";
  const log = params.onLog || console.log;
  const browser = await launchBrowser(params.accountId, { headless: true, log, feature: "crawl", ownerUserId: params.ownerUserId });
  const context = await browser.newContext({ userAgent: UA, locale: "ko-KR", viewport: { width: 1280, height: 900 } });
  await applyAntiDetection(context);
  const page = await context.newPage();
  try {
    const url = `https://pcmap.place.naver.com/${domain}/${params.placeId}/home`;
    log(`[플레이스 360] 매장 상세정보 확인 중...`);
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 25000 });
    await page.waitForTimeout(2200);
    const detail = await page.evaluate(({ placeId, domain }) => {
      const st: Record<string, any> = (window as any).__APOLLO_STATE__ || {};
      const values = Object.values(st).filter(v => v && typeof v === "object");
      const root = values.find((v: any) => String(v.id || "") === placeId && v.name) || values.find((v: any) => v.name && (v.roadAddress || v.address));
      if (!root) throw new Error("공개 매장 정보를 찾지 못했어요");
      const clean = (value: unknown) => typeof value === "string" ? value.trim() : "";
      // 여러 후보 키에서 처음 발견되는 값을 취한다(네이버 스키마가 타입마다 키가 달라서). 없으면 undefined로 비워 둔다.
      const numFrom = (obj: any, keys: string[]): number | undefined => { for (const k of keys) { const n = Number(obj?.[k]); if (Number.isFinite(n) && n > 0) return n; } return undefined; };
      const strFrom = (obj: any, keys: string[]): string => { for (const k of keys) { const s = clean(obj?.[k]); if (s) return s; } return ""; };
      const images = new Set<string>();
      const menus = new Map<string, string>();
      const conveniences = new Set<string>();
      const keywords = new Set<string>();
      let hours = clean(root.businessHours || root.openingHours || root.businessHoursInfo);
      let phone = clean(root.phone || root.virtualPhone || root.phoneNumber);
      let booking: boolean | undefined = typeof root.bookingBusinessId === "string" || root.bookingAvailable === true ? true : undefined;
      // ── 확장 지표: 루트에서 우선 추출 ──
      let savedCount = numFrom(root, ["keptCount", "savedCount", "keepCount", "favoriteCount", "bookmarkCount"]);
      let reviewScore = numFrom(root, ["visitorReviewsScore", "visitorReviewScore", "reviewScore", "totalScore", "score"]);
      let description = strFrom(root, ["microReview", "description", "shortDescription", "introduction", "placeDescription"]);
      let talktalk: boolean | undefined = (root.talktalkUrl || root.talktalkId || root.nchatUrl) ? true : undefined;
      let homepage = strFrom(root, ["homepage", "homePage"]);
      let photoCount = numFrom(root, ["imageCount", "photoCount", "totalPhotoCount"]);
      let newsCount = numFrom(root, ["newsCount", "announcementCount", "feedCount"]);
      for (const value of values) {
        const v = value as any;
        for (const key of ["imageUrl", "image", "thumbnail", "photoUrl", "originalUrl"]) {
          const candidate = clean(v[key]);
          if (/^https?:\/\//.test(candidate) && /naver|pstatic/.test(candidate)) images.add(candidate);
        }
        const menuName = clean(v.name || v.menuName);
        const price = clean(v.price || v.priceText);
        if (menuName && price && (/menu/i.test(String(v.__typename || "")) || v.menuName)) menus.set(menuName, price);
        const facility = clean(v.name || v.label);
        if (facility && /주차|예약|포장|배달|무선 인터넷|반려동물|남녀 화장실|유아/.test(facility)) conveniences.add(facility);
        if (!hours) hours = clean(v.businessHours || v.openingHours);
        if (!phone) phone = clean(v.phone || v.virtualPhone);
        if (booking === undefined && (v.bookingAvailable === true || v.bookingUrl)) booking = true;
        // 확장 지표: 어느 값 객체에든 있으면 채운다
        if (savedCount === undefined) savedCount = numFrom(v, ["keptCount", "savedCount", "keepCount", "favoriteCount", "bookmarkCount"]);
        if (reviewScore === undefined) reviewScore = numFrom(v, ["visitorReviewsScore", "visitorReviewScore", "reviewScore", "totalScore"]);
        if (!description) description = strFrom(v, ["microReview", "description", "shortDescription", "introduction"]);
        if (talktalk === undefined && (v.talktalkUrl || v.talktalkId || v.nchatUrl)) talktalk = true;
        if (!homepage) { const h = strFrom(v, ["homepage", "homePage"]); if (/^https?:\/\//.test(h)) homepage = h; }
        if (photoCount === undefined) photoCount = numFrom(v, ["imageCount", "photoCount", "totalPhotoCount"]);
        if (newsCount === undefined) newsCount = numFrom(v, ["newsCount", "announcementCount", "feedCount"]);
        // 대표 키워드: 방문자 리뷰 키워드 배열({ keyword|name|displayName, count })
        const kwArr = v.reviewKeywords || v.keywordList || v.representativeKeywords || v.visitorReviewKeywords || v.keywords;
        if (Array.isArray(kwArr)) for (const k of kwArr) { const s = typeof k === "string" ? clean(k) : clean(k?.keyword || k?.name || k?.displayName); if (s && s.length <= 25) keywords.add(s); }
      }
      const text = document.body?.innerText || "";
      if (!hours) hours = text.match(/(?:영업 중|영업 종료|오늘 휴무)[^\n]{0,80}/)?.[0]?.trim() || "";
      return {
        placeId,
        name: clean(root.name),
        category: clean(root.category || root.businessCategory) || undefined,
        address: clean(root.roadAddress || root.address || root.fullAddress) || undefined,
        visitorReviewCount: Number(root.visitorReviewCount ?? root.visitorReviewsTotal ?? 0) || undefined,
        blogReviewCount: Number(root.blogCafeReviewCount ?? root.blogReviewCount ?? 0) || undefined,
        placeUrl: `https://m.place.naver.com/${domain}/${placeId}/home`,
        imageUrls: Array.from(images).slice(0, 12),
        businessHours: hours || undefined,
        phone: phone || undefined,
        menus: Array.from(menus, ([name, price]) => ({ name, price })).slice(0, 20),
        conveniences: Array.from(conveniences).slice(0, 20),
        bookingAvailable: booking,
        collectedAt: new Date().toISOString(),
        savedCount,
        visitorReviewScore: reviewScore,
        description: description || undefined,
        keywords: Array.from(keywords).slice(0, 15),
        hasTalktalk: talktalk,
        homepage: homepage || undefined,
        newsCount,
        photoCount: photoCount ?? (images.size || undefined),
        imageCount: photoCount,
      };
    }, { placeId: params.placeId, domain });
    log(`[플레이스 360] 상세정보 확인 완료`);
    return detail;
  } finally {
    await browser.close().catch(() => {});
  }
}

/* ── 붙여넣은 플레이스 주소에서 domain·placeId 뽑기 ──
   지원 형태: pcmap.place / m.place / place.naver.com/{domain}/{id},
   map.naver.com/p/entry/place/{id}, 순수 숫자 ID. 단축주소(naver.me)는 못 뽑으므로 null. */
// 🔗 naver.me 등 단축주소 → 실제 URL로 펼친 뒤 파싱. 단축이 아니면 그대로 파싱.
export async function resolvePlaceUrl(input: string): Promise<{ domain: string; placeId: string } | null> {
  const direct = parsePlaceUrl(input);
  if (direct) return direct;
  const s = String(input || "").trim();
  // 단축주소(naver.me, me2.do 등)면 리다이렉트를 따라가 최종 URL을 얻는다.
  if (/naver\.me\/|me2\.do\/|url\.kr\//i.test(s)) {
    try {
      const r = await fetch(s, { redirect: "follow", headers: { "User-Agent": INFLOW_MOBILE_UA } });
      const finalUrl = r.url || "";
      const parsed = parsePlaceUrl(finalUrl);
      if (parsed) return parsed;
    } catch { /* ignore */ }
  }
  return null;
}

export function parsePlaceUrl(input: string): { domain: string; placeId: string } | null {
  const s = String(input || "");
  let m = s.match(/(?:pcmap\.place|m\.place|place)\.naver\.com\/([a-z]+)\/(\d{5,})/i);
  if (m) return { domain: m[1], placeId: m[2] };
  m = s.match(/entry\/place\/(\d{5,})/i);
  if (m) return { domain: "place", placeId: m[1] };
  // 단축주소가 앱링크로 풀리는 형태: m.map.naver.com/appLink.naver?...id=1381173387 또는 pinId=...
  m = s.match(/[?&]placeId=(\d{5,})/i) || s.match(/[?&]pinId=(\d{5,})/i) || s.match(/[?&]id=(\d{5,})/i)
    || s.match(/\/(\d{6,})(?:[/?#]|$)/) || s.match(/^\s*(\d{6,})\s*$/);
  if (m) return { domain: "place", placeId: m[1] };
  return null;
}

/* ── 🔎 주소만 붙여넣어도 내 매장 정보를 바로 당겨오기(플레이스 360 매장 등록용) ──
   어떤 형태의 링크든 최종 placeId·domain을 찾아 공개 상세정보를 가져온다.
   공개 페이지만 읽으므로 로그인 계정 불필요. naver.me 단축주소는 실제로 열어 리다이렉트된 최종 URL로 판별. */
/** 🎯 플레이스 키워드 발굴 — 대행사식으로 여러 소스에서 실제 검색 키워드를 싹 긁어온다.
 * 계정 불필요(공개 엔드포인트). 소스: ①네이버 자동완성 ②연관검색어 ③각 후보의 자동완성 확장.
 * seed(지역+업종/상호)로 시작해 실제 사람들이 치는 검색어를 모은다. */
export async function suggestPlaceKeywords(params: {
  seeds: string[];              // 예: ["횡성 한식", "횡성 맛집", "꽃피는산골"]
  region?: string;
  onLog?: (msg: string) => void;
}): Promise<{ keyword: string; source: string }[]> {
  const log = params.onLog || console.log;
  const seen = new Map<string, string>();   // keyword -> source
  const add = (kw: string, source: string) => { const t = String(kw || "").trim().replace(/\s+/g, " "); if (t && t.length <= 25 && !seen.has(t)) seen.set(t, source); };
  const H = { "User-Agent": UA, "Referer": "https://search.naver.com/" };

  // ① 네이버 자동완성(ac.search.naver.com) — 실제 검색창 추천어
  const autocomplete = async (q: string) => {
    try {
      const url = `https://ac.search.naver.com/nx/ac?q=${encodeURIComponent(q)}&con=1&frm=nv&ans=2&r_format=json&r_enc=UTF-8&r_unicode=0&t_koreng=1&run=2&rev=4&q_enc=UTF-8&st=100`;
      const r = await fetch(url, { headers: H });
      const j: any = await r.json();
      const items: any[] = j?.items?.[0] || [];
      for (const it of items) add(String(it?.[0] || ""), "자동완성");
    } catch { /* skip */ }
  };
  // ② 연관검색어 — 통합검색 결과 페이지의 related HTML에서 추출
  const related = async (q: string) => {
    try {
      const r = await fetch(`https://search.naver.com/search.naver?query=${encodeURIComponent(q)}`, { headers: H });
      const html = await r.text();
      // 연관검색어 앵커(related_srch / lst_related_srch) 텍스트 추출
      const block = html.match(/related[_-]?srch[\s\S]{0,4000}?<\/(?:ul|div)>/i)?.[0] || "";
      const rx = /query=([^"&]+)"/g; let m: RegExpExecArray | null;
      while ((m = rx.exec(block))) { try { add(decodeURIComponent(m[1]), "연관검색"); } catch {} }
    } catch { /* skip */ }
  };

  const baseSeeds = Array.from(new Set(params.seeds.map(s => s.trim()).filter(Boolean))).slice(0, 10);
  log(`[키워드] ${baseSeeds.length}개 시드로 발굴 시작…`);
  for (const s of baseSeeds) { add(s, "기본"); await autocomplete(s); await related(s); }
  // ③ 자동완성·연관검색 후보를 한 번 더 확장해 지역+업종+상황 롱테일을 확보한다.
  const expand = Array.from(seen.keys()).filter(k => !baseSeeds.includes(k)).slice(0, 10);
  for (const k of expand) { await autocomplete(k); await related(k); }
  const out = Array.from(seen, ([keyword, source]) => ({ keyword, source }));
  log(`[키워드] ${out.length}개 발굴 완료`);
  return out.slice(0, 80);
}

export async function crawlPlaceByUrl(params: {
  placeUrl: string;
  ownerUserId?: string | null;
  onLog?: (msg: string) => void;
}): Promise<PlaceDetail> {
  const log = params.onLog || console.log;
  const raw = (params.placeUrl || "").trim();
  if (!raw) throw new Error("플레이스 주소를 입력하세요");
  let parsed = parsePlaceUrl(raw);
  // 문자열에서 못 뽑으면(naver.me 단축주소 등) 실제로 열어 리다이렉트된 최종 URL로 판별
  if (!parsed) {
    log(`[플레이스 360] 단축주소 확인 중...`);
    const browser = await launchBrowser(null, { headless: true, log, feature: "crawl", ownerUserId: params.ownerUserId });
    try {
      const context = await browser.newContext({ userAgent: UA, locale: "ko-KR" });
      const page = await context.newPage();
      await page.goto(raw, { waitUntil: "domcontentloaded", timeout: 25000 });
      await page.waitForTimeout(1500);
      parsed = parsePlaceUrl(page.url());
      if (!parsed) { try { parsed = parsePlaceUrl(await page.content()); } catch {} }
    } finally {
      await browser.close().catch(() => {});
    }
  }
  if (!parsed) throw new Error("주소에서 매장 번호를 찾지 못했어요. 네이버 플레이스의 '공유' 주소를 붙여넣어 주세요");
  return crawlPlaceDetail({ accountId: "", placeId: parsed.placeId, domain: parsed.domain, ownerUserId: params.ownerUserId, onLog: log });
}

export async function crawlPlaces(params: {
  accountId: string;
  query: string;                    // "강남 맛집" 처럼 지역+업종을 이미 합친 검색어
  domain?: string;                  // pcmap 도메인(restaurant/hairshop/hospital/place 등). 기본 place(통합)
  count: number;
  ownerUserId?: string | null;
  onLog?: (msg: string) => void;
}): Promise<PlaceTarget[]> {
  const { query, count, onLog } = params;
  const domain = params.domain || "place";
  const log = onLog || console.log;
  const results: PlaceTarget[] = [];
  const seen = new Set<string>();
  const browser = await launchBrowser(params.accountId, { headless: true, log, feature: "crawl", ownerUserId: params.ownerUserId });
  const context = await browser.newContext({ userAgent: UA, locale: "ko-KR", viewport: { width: 1280, height: 900 } });
  await applyAntiDetection(context);
  const page = await context.newPage();
  try {
    for (let pageNo = 1; pageNo <= 5 && results.length < count; pageNo++) {
      const url = `https://pcmap.place.naver.com/${domain}/list?query=${encodeURIComponent(query)}&page=${pageNo}`;
      log(`[플레이스] "${query}" ${pageNo}페이지 수집 중...`);
      try {
        await page.goto(url, { waitUntil: "domcontentloaded", timeout: 25000 });
        await page.waitForTimeout(2200);
      } catch { log(`[플레이스] ${pageNo}페이지 로드 지연 — 스킵`); continue; }
      const items: PlaceTarget[] = await page.evaluate(() => {
        const st: any = (window as any).__APOLLO_STATE__ || {};
        const out: any[] = [];
        for (const k in st) {
          const v = st[k];
          if (!v || typeof v !== "object" || !v.name) continue;
          // 업체 노드만: 이름 + (카테고리 또는 주소) 보유. 리뷰수 필드는 있으면 담고 없으면 생략.
          const hasBiz = v.category || v.businessCategory || v.roadAddress || v.address || v.fullAddress;
          if (!hasBiz) continue;
          const id = String(v.id || (k.includes(":") ? k.split(":").pop() : "") || "");
          if (!id) continue;
          out.push({
            placeId: id,
            name: String(v.name),
            category: v.category || v.businessCategory || undefined,
            address: v.roadAddress || v.address || v.fullAddress || undefined,
            visitorReviewCount: Number(v.visitorReviewCount ?? v.visitorReviewsTotal ?? 0) || undefined,
            blogReviewCount: Number(v.blogCafeReviewCount ?? v.blogReviewCount ?? 0) || undefined,
            placeUrl: `https://m.place.naver.com/${(window as any).__PLACE_DOMAIN__ || "place"}/${id}/home`,
          });
        }
        return out;
      }).catch(() => [] as PlaceTarget[]);
      let added = 0;
      for (const it of items) {
        if (!it.placeId || seen.has(it.placeId)) continue;
        seen.add(it.placeId);
        it.placeUrl = `https://m.place.naver.com/${domain}/${it.placeId}/home`;
        results.push(it);
        added++;
        if (results.length >= count) break;
      }
      log(`[플레이스] ${pageNo}페이지 → ${added}개 (누적 ${results.length})`);
      if (added === 0) break;   // 더 없음
      await page.waitForTimeout(400);
    }
  } finally {
    await browser.close().catch(() => {});
  }
  log(`[플레이스] 총 ${results.length}개 업체 수집 완료`);
  return results;
}

/* ── 🗺️ 플레이스 업체 → 블로그 리뷰 작성자(블로거) 역추적 ──
   업체의 블로그 리뷰 탭에서 blog.naver.com/{blogId} 링크를 긁어 실제 방문 리뷰를 쓰는 블로거를 발굴.
   (영수증 리뷰어는 익명이라 제외 — 블로그 리뷰어만 블로그로 넘어가 연락처 확보 가능) */
export interface PlaceBloggerHit { blogId: string; nick?: string; title?: string; }
export async function crawlPlaceBloggers(params: {
  accountId: string;
  placeId: string;
  domain?: string;
  maxPerPlace?: number;          // 업체당 최대 몇 명까지(등급 상한). 미지정/0=무제한.
  ownerUserId?: string | null;
  onLog?: (msg: string) => void;
}): Promise<PlaceBloggerHit[]> {
  const { placeId, onLog } = params;
  const domain = params.domain || "place";
  const cap = (params.maxPerPlace && params.maxPerPlace > 0) ? params.maxPerPlace : Number.MAX_SAFE_INTEGER;
  const log = onLog || console.log;
  const browser = await launchBrowser(params.accountId, { headless: true, log, feature: "crawl", ownerUserId: params.ownerUserId });
  const context = await browser.newContext({ userAgent: UA, locale: "ko-KR", viewport: { width: 1280, height: 900 } });
  await applyAntiDetection(context);
  const page = await context.newPage();
  // ★실측(2026-08-28): 블로그 리뷰는 <a>가 아니라 __APOLLO_STATE__의 FsasReview:blog_* 노드에 있음
  //   (url=m.blog.naver.com/{blogId}/{logNo}, name=닉네임, title=글제목). 앵커 스크레이핑은 0건이라 APOLLO 파싱해야 함.
  const parseFromApollo = () => page.evaluate(() => {
    const st: any = (window as any).__APOLLO_STATE__ || {};
    const bad = ["PostList", "BlogHome", "GoBlogWrite", "section", "m", "PostView"];
    const seen = new Set<string>();
    const out: { blogId: string; nick?: string; title?: string }[] = [];
    for (const k in st) {
      const v = st[k];
      if (!v || typeof v !== "object") continue;
      const isBlog = v.type === "blog" || /blog/i.test(String(v.typeName || "")) || (typeof k === "string" && k.includes("blog_"));
      const u = String(v.url || v.home || "");
      if ((!isBlog && !/blog\.naver\.com/.test(u)) || !/blog\.naver\.com/.test(u)) continue;
      const m = u.match(/(?:m\.)?blog\.naver\.com\/([a-zA-Z0-9_-]+)/);
      if (!m || !m[1] || bad.includes(m[1]) || seen.has(m[1])) continue;
      seen.add(m[1]);
      out.push({ blogId: m[1], nick: String(v.name || "").trim() || undefined, title: String(v.title || "").trim() || undefined });
    }
    return out;
  }).catch(() => [] as PlaceBloggerHit[]);

  const merged = new Map<string, PlaceBloggerHit>();
  try {
    const url = `https://pcmap.place.naver.com/${domain}/${placeId}/review/blog`;
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 25000 });
    await page.waitForTimeout(2500);
    // ★페이징: '더보기' 버튼을 눌러가며(없으면 스크롤) 상한(cap)까지 계속 로드. 늘어나지 않으면 중단.
    let stagnant = 0;
    for (let round = 0; round < 40 && merged.size < cap && stagnant < 2; round++) {
      for (const h of await parseFromApollo()) if (!merged.has(h.blogId)) merged.set(h.blogId, h);
      if (merged.size >= cap) break;
      // 리뷰 목록의 '더보기'(a.fvwqf 등 텍스트 '더보기') 클릭 시도 → 없으면 맨 아래로 스크롤
      const before = merged.size;
      const clicked = await page.evaluate(() => {
        const el = Array.from(document.querySelectorAll("a,button")).find(e => /더보기/.test(e.textContent || "") && (e as HTMLElement).offsetParent !== null);
        if (el) { (el as HTMLElement).click(); return true; }
        return false;
      }).catch(() => false);
      if (!clicked) { await page.mouse.wheel(0, 6000); await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight)).catch(() => {}); }
      await page.waitForTimeout(1600);
      for (const h of await parseFromApollo()) if (!merged.has(h.blogId)) merged.set(h.blogId, h);
      stagnant = merged.size > before ? 0 : stagnant + 1;   // 두 번 연속 안 늘면 끝(더보기 없음)
    }
  } finally {
    await browser.close().catch(() => {});
  }
  const hits = Array.from(merged.values()).slice(0, cap === Number.MAX_SAFE_INTEGER ? undefined : cap);
  log(`[플레이스] 업체 ${placeId} 블로그 리뷰어 ${hits.length}명 발굴${cap !== Number.MAX_SAFE_INTEGER ? ` (상한 ${cap})` : ""}`);
  return hits;
}

/* ── 내 이웃새글 수집 (키워드 대신 "내 서로이웃들의 최근 글") ──
   네이버 이웃새글 API(BuddyPostList.naver)를 세션으로 호출 → 이웃 블로거 중복제거해 반환.
   실측: blogId/nickName/postUrl/addDate/sympathyEnable/commentEnable 제공. */
export async function crawlBuddyPosts(params: {
  accountId: string;
  maxCount: number;
  onLog?: (msg: string) => void;
}): Promise<BlogTarget[]> {
  const { accountId, maxCount, onLog } = params;
  const log = onLog || console.log;
  // ★세션 만료 시 저장된 비번으로 자동 재연결(다른 기능과 동일). 이게 없어서 세션 풀리면 '글 없음'으로 나왔음.
  const cookies = await ensureLiveSession(accountId, log);

  const results: BlogTarget[] = [];
  const seen = new Set<string>();
  const browser = await launchBrowser(accountId, { headless: true, log });
  const context = await browser.newContext({ userAgent: UA, locale: "ko-KR" });
  await applyAntiDetection(context);
  await context.addCookies(cookies);
  const page = await context.newPage();
  try {
    await page.goto("https://section.blog.naver.com/BlogHome.naver", { waitUntil: "domcontentloaded", timeout: 20000 }).catch(() => {});
    await page.waitForTimeout(800);
    // 로그인 페이지로 튕겼는지 확인(세션 문제 조기 감지)
    if (/nid\.naver\.com|nidlogin/.test(page.url())) { log("[이웃새글] ❌ 로그인이 풀렸어요 — 계정관리에서 다시 연결해 주세요"); return results; }
    log("[이웃새글] 내 서로이웃 최근 글 수집 중...");

    const maxPages = 30;
    let firstPageDiag = "";
    for (let pageNum = 1; pageNum <= maxPages && results.length < maxCount; pageNum++) {
      const apiUrl = `https://section.blog.naver.com/ajax/BuddyPostList.naver?page=${pageNum}&groupId=0&currentPage=${pageNum}&countPerPage=30`;
      let list: any[] = [];
      let rawSnippet = "";
      try {
        const raw = await page.evaluate(async (u) => {
          const r = await fetch(u, { headers: { Referer: "https://section.blog.naver.com/BlogHome.naver", "X-Requested-With": "XMLHttpRequest" }, credentials: "include" });
          return await r.text();
        }, apiUrl);
        rawSnippet = (raw || "").slice(0, 120);
        // 로그인 HTML이 오면(JSON 아님) 세션 문제
        if (/^\s*</.test(raw) || /nidlogin|로그인/.test(rawSnippet)) { if (pageNum === 1) firstPageDiag = "로그인 필요 응답(HTML)"; break; }
        const data = JSON.parse(raw.replace(/^\)\]\}',?\s*/, ""));
        list = data?.result?.buddyPostList || data?.result?.postList || data?.result?.list || data?.buddyPostList || [];
        if (pageNum === 1 && !list.length) firstPageDiag = `응답은 왔으나 글 0개 (키: ${Object.keys(data?.result || data || {}).join(",").slice(0,80)})`;
      } catch (e: any) { if (pageNum === 1) firstPageDiag = `파싱 실패: ${rawSnippet}`; list = []; }
      if (!list.length) break;

      for (const item of list) {
        const blogId = item.domainIdOrBlogId || item.blogId;
        if (!blogId || INVALID_BLOG_IDS.includes(blogId) || seen.has(blogId)) continue;
        // 공감/댓글 둘 다 막힌 글은 스킵
        if (item.sympathyEnable === false && item.commentEnable === false) continue;
        seen.add(blogId);
        results.push({
          keyword: "이웃새글",
          blogId,
          nickName: item.nickName || undefined,
          blogName: item.blogName || item.nickName || undefined,
          addDate: item.addDate || undefined,
          postUrl: item.postUrl || undefined,
          thumbnail: item.thumbnails?.[0]?.url || item.profileUrl || undefined,
        });
        if (results.length >= maxCount) break;
      }
      await page.waitForTimeout(250);
    }
    if (!results.length) {
      log(`[이웃새글] ⚠️ 수집된 이웃 글이 0개예요. ${firstPageDiag || "서로이웃이 없거나, 이웃들이 최근 글을 안 썼거나, 공감·댓글이 모두 막힌 글일 수 있어요"}`);
      log(`[이웃새글] 💡 확인: ①이 계정에 서로이웃이 있나요? ②최근 이웃들이 글을 올렸나요? ③안 되면 계정관리에서 재연결 후 다시 시도해 주세요.`);
    } else {
      log(`[이웃새글] ✅ 이웃 블로거 ${results.length}명 수집 완료`);
    }
  } finally {
    await browser.close().catch(() => {});
  }
  return results;
}

/* ── 내 이웃새글 제목·내용에서 "자주 나오는 키워드" 추출 (이웃들이 뭘 쓰는지 분석) ── */
export async function analyzeBuddyKeywords(params: {
  accountId: string;
  scanCount?: number;   // 스캔할 이웃글 수(기본 100)
  onLog?: (msg: string) => void;
}): Promise<{ word: string; count: number }[]> {
  const { accountId, scanCount = 100, onLog } = params;
  const log = onLog || console.log;
  if (!sessionExists(accountId)) throw new Error("세션 없음 — 먼저 계정을 연결하세요");
  const { cookies } = loadSession(accountId);
  const browser = await launchBrowser(accountId, { headless: true, log });
  const context = await browser.newContext({ userAgent: UA, locale: "ko-KR" });
  await applyAntiDetection(context);
  await context.addCookies(cookies);
  const page = await context.newPage();
  const texts: string[] = [];
  try {
    await page.goto("https://section.blog.naver.com/BlogHome.naver", { waitUntil: "domcontentloaded", timeout: 20000 }).catch(() => {});
    await page.waitForTimeout(800);
    log("[키워드분석] 내 이웃새글 스캔 중...");
    for (let pageNum = 1; pageNum <= 30 && texts.length < scanCount; pageNum++) {
      const apiUrl = `https://section.blog.naver.com/ajax/BuddyPostList.naver?page=${pageNum}&groupId=0`;
      let list: any[] = [];
      try {
        const raw = await page.evaluate(async (u) => {
          const r = await fetch(u, { headers: { Referer: "https://section.blog.naver.com/BlogHome.naver" } });
          return await r.text();
        }, apiUrl);
        list = JSON.parse(raw.replace(/^\)\]\}',?\s*/, ""))?.result?.buddyPostList || [];
      } catch { list = []; }
      if (!list.length) break;
      for (const it of list) texts.push(`${it.title || ""} ${it.briefContents || ""}`);
      await page.waitForTimeout(200);
    }
  } finally {
    await browser.close().catch(() => {});
  }
  // 한글 2글자+ 단어 빈도 (조사·인삿말·불용어·활용형 제거 → 실제 '주제 명사'만 남김)
  const STOP = new Set([
    // 인삿말·기본 불용어
    "안녕하세요","있는","합니다","입니다","그리고","하는","이번","오늘","저는","제가","너무","정말","진짜","우리","그것","이것","해서","에서","으로","까지","부터","했습니다","같은","위해","통해","대한","관련","경우","때문","많이","다시","바로","여기","거기","하지만","그런","이런","저런","하고","했어요","합니다만","입니다만","보고","보다","되는","되어","있어요","없이도","없는","위한","때는","면서",
    // 부사·정도어
    "요즘","오늘은","지금","이제","아주","매우","제일","가장","자주","계속","먼저","이렇게","그렇게","저렇게","크게","작게","조금","함께","특히","역시","물론","그냥","점점","훨씬","완전","엄청","살짝","드디어","이미","아직","항상","가끔","보통","대부분","무려","각종","다양","여러",
    // 흔한 동사·형용사 활용(주제 아님)
    "보면","하면","되면","있다","없다","한다","된다","같다","보는","하기","되기","위해서","대해","라는","이라는","싶은","싶어","좋은","좋아","많은","적은","해요","돼요","네요","거예요","거에요","나눠서","갈래로","다녀","다녀왔","봤어요","였어요","이었",
    // 주제성 낮은 흔한 명사
    "추천","후기","이유","방법","경우","사람","생각","시간","하루","정도","이번주","다음","부분","모습","느낌","마음","사실","여러분","블로그","포스팅","글쓰기","시작","마지막","전체","기본","정보","내용","이야기","얘기","자신","본인","우리집","여기저기","최근","오늘","내일","어제","요새","최고","완전","진행","사용","경험","선택","고민","준비","확인","소개",
  ]);
  // 활용형 어미로 끝나는 단어(동사·형용사·부사) 제거: ~습니다/~해서/~하면/~네요/~게 등
  const CONJ = /(습니다|었습니다|였습니다|해요|아요|어요|에요|예요|이에요|이예요|네요|더라|겠다|었다|였다|린다|긴다|한다|된다|간다|온다|왔다|갔다|봤다|해서|아서|어서|하고|하며|하니|하는|되는|있는|없는|같은|으면|하면|되면|려고|면서|어도|아도|처럼|만큼|보다|라고|다고|든지|거나|지만|는데|은데|으로|에서|까지|부터|에게|한테)$/;
  // 뒤에 붙은 조사 제거(자신"의"·활동"의"·수수료"를"·포스팅"은" → 자신·활동·수수료·포스팅). 남는 어간이 2자 이상일 때만.
  const stripJosa = (w: string): string => {
    const s = w.replace(/(으로서|으로써|이라는|라는|으로|로서|로써|에서|에게|한테|께서|부터|까지|보다|처럼|만큼|이나|이란|라도|든지|은|는|이|가|을|를|의|에|도|만|로|과|와|나)$/, "");
    return s.length >= 2 ? s : w;
  };
  const EXTRA_STOP = new Set(["그런데","그래서","그러나","그리하여","지난","이번","다음","발생","총정리","직접","활동","구간","커넥트","포스팅","자신","수수료","공개","진행","포함","관심","여기","저기","우리","서로","이웃","방문","댓글","공감","이웃님","블로거","일상","기록","하루하루"]);
  const freq: Record<string, number> = {};
  const joined = texts.join(" ");
  for (const raw of joined.match(/[가-힣]{2,}/g) || []) {
    const w = stripJosa(raw);
    if (w.length < 2) continue;
    if (STOP.has(w) || EXTRA_STOP.has(w)) continue;
    if (CONJ.test(w)) continue;                 // 활용형 어미로 끝나면 제외(동사·형용사·부사)
    freq[w] = (freq[w] || 0) + 1;
  }
  const top = Object.entries(freq)
    .filter(([, c]) => c >= 2)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 25)
    .map(([word, count]) => ({ word, count }));
  return top;
}

/* 모바일 통합검색 블로그탭 폴백 (ajax API가 막혔을 때) */
async function crawlMobileFallback(context: BrowserContext, keyword: string, limit: number): Promise<BlogTarget[]> {
  const MUA = "Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1";
  const page = await context.newPage();
  const out: BlogTarget[] = [];
  const seen = new Set<string>();
  try {
    await page.setExtraHTTPHeaders({ "User-Agent": MUA });
    await page.goto(`https://m.search.naver.com/search.naver?ssc=tab.m_blog.all&query=${encodeURIComponent(keyword)}`,
      { waitUntil: "domcontentloaded", timeout: 20000 });
    await page.waitForTimeout(1200);
    const hrefs: string[] = await page.$$eval('a[href*="blog.naver.com"]', els => els.map(e => (e as HTMLAnchorElement).href));
    for (const h of hrefs) {
      const m = h.match(/blog\.naver\.com\/([a-zA-Z0-9_-]+)/);
      if (m && m[1] && !INVALID_BLOG_IDS.includes(m[1]) && !seen.has(m[1])) {
        seen.add(m[1]);
        out.push({ keyword, blogId: m[1] });
        if (out.length >= limit) break;
      }
    }
  } finally { await page.close().catch(() => {}); }
  return out;
}

/* ★★내 실제 blogId 확정(모든 기능·탭 공용) — 발행(글쓰기)이 쓰는 검증된 방식 그대로, 단 가볍게 fetch로.
   GoBlogWrite.naver를 쿠키로 요청하면 네이버가 '로그인 계정 기준' 진짜 blogId가 담긴 URL로 302 리다이렉트한다.
   → 네이버 아이디와 blogId가 다른 계정(예: bb9653)이어도 정확한 blogId를 얻는다. 창을 안 띄워 가볍고 계정에도 안전.
   저장값이 틀리면 실제 값으로 교정+세션 저장 → 이후 발행·카테고리·진단·검색노출·제목수정 등 모든 탭이 정확한 blogId 공유. */
const RESOLVE_INVALID = ["PostList", "BlogHome", "FeedList", "neighborPostList", "TagList", "GoBlogWrite", "RedirectWriteView", "PostWriteForm", "MyBlog", "section", "m", "manage", "admin", "GoMyblog"];
async function resolveBlogIdFast(storedBlogId: string, cookies: any[], accountId: string, log: (m: string) => void): Promise<string> {
  storedBlogId = (storedBlogId || "").split("@")[0].trim();   // ★이메일(id@naver.com)이 blogId로 들어오면 아이디만 (PostTitleListAsync 404 방지)
  const pickFrom = (s: string): string => {
    let m = s.match(/[?&]blogId=([a-zA-Z0-9_-]+)/) || s.match(/blog\.naver\.com\/([a-zA-Z0-9_-]+)/);
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
      log(`[blogId교정] '${storedBlogId}' → '${real}' (네이버 아이디와 블로그 주소가 달라 자동으로 맞췄어요)`);
      try { const s = loadSession(accountId); s.blogId = real; writeSession(sessionName(accountId), s); } catch {}
      return real;
    }
  } catch {}
  return storedBlogId;
}

/* ── 글 제목 수정(기존 글 편집·재발행) ──
   실측(2026-08-23): 수정 URL = PostWriteForm.naver?blogId=&logNo=&Redirect=Update (자기 글만).
   스마트에디터라 발행과 동일: 제목칸 .se-section-documentTitle 교체 → publish_btn → confirm_btn 재발행. */
export async function updatePostTitle(params: {
  accountId: string; logNo: string; newTitle: string; onLog?: (m: string) => void;
}): Promise<{ ok: boolean; message: string }> {
  const { accountId, logNo, newTitle, onLog } = params;
  const log = onLog || console.log;
  const blogId = loadSession(accountId).blogId;
  const cookies = await ensureLiveSession(accountId, log);   // ★세션 만료면 저장된 비번으로 자동 재연결
  if (!blogId) throw new Error("내 블로그 ID를 찾을 수 없어요 — 계정을 다시 연결해주세요");
  if (!/^\d+$/.test(String(logNo))) throw new Error("글 번호(logNo)가 올바르지 않아요");
  if (!newTitle || !newTitle.trim()) throw new Error("새 제목이 비어 있어요");
  const title = newTitle.trim().slice(0, 100);

  const browser = await launchBrowser(accountId, { headless: false, maximized: true, log });
  const context = await browser.newContext({ userAgent: UA, viewport: { width: 1280, height: 900 }, locale: "ko-KR" });
  await applyAntiDetection(context);
  await context.addCookies(cookies);
  const page = await context.newPage();
  await page.bringToFront().catch(() => {});
  try {
    // ★★다중계정 튕김 방지(테리 지적: bb9653은 네이버ID≠blogId): 발행과 동일 방식으로 실제 blogId 확정(가벼운 fetch).
    const realBlogId = await resolveBlogIdFast(blogId, cookies, accountId, log);
    log(`[제목수정] 로그인 blogId 확인: ${realBlogId}`);
    // ★수정 페이지 URL(RedirectWriteView는 에러페이지 나서 제외 — 실측). PostWriteForm Redirect=Update 형태만.
    const editUrls = [
      `https://blog.naver.com/PostWriteForm.naver?blogId=${realBlogId}&logNo=${logNo}&Redirect=Update`,
      `https://blog.naver.com/PostWriteForm.naver?blogId=${realBlogId}&Redirect=Update&logNo=${logNo}&categoryNo=0`,
    ];
    // ★에디터 컨텍스트 찾기 = iframe(mainFrame)이 있으면 그걸, 없으면 '페이지 자체'를 에디터로 사용.
    //   (최신 스마트에디터 편집모드는 iframe 없이 페이지에 직접 에디터가 뜬다 — 실측: 프레임만 찾으면 계속 실패)
    const getFrame = (): import("playwright").Frame | null => {
      const frames = page.frames();
      return frames.find(f => f.name() === "mainFrame")
        ?? frames.find(f => f.url().includes("blog.naver.com") && f !== page.mainFrame())
        ?? null;
    };
    const hasEditor = async (ctx: any): Promise<boolean> => {
      try { return !!(await ctx.$(".se-section-documentTitle, .se-editor, .se-container")); } catch { return false; }
    };
    let editor: any = null;   // Frame 또는 Page
    let landed = "";
    for (let u = 0; u < editUrls.length && !editor; u++) {
      log(`[제목수정] ① 수정 페이지 여는 중... (${realBlogId}/${logNo}) [시도 ${u + 1}/${editUrls.length}]`);
      await page.goto(editUrls[u], { waitUntil: "domcontentloaded", timeout: 30000 }).catch(() => {});
      await page.waitForTimeout(3500);
      landed = page.url();
      log(`[제목수정] 페이지 도착: ${landed.slice(0, 80)}`);
      if (/nid\.naver\.com|nidlogin|\/login/i.test(landed)) {
        throw new Error("네이버 로그인이 풀렸어요. 계정을 다시 연결(로그인)한 뒤 시도해주세요.");
      }
      if (/error|PageNotFound/i.test(landed)) { log(`[제목수정] 에러페이지 → 다음 형태로 재시도`); continue; }
      log(`[제목수정] ② 에디터 찾는 중(프레임/페이지 모두 확인)...`);
      for (let i = 0; i < 14 && !editor; i++) {
        const fr = getFrame();
        if (fr && await hasEditor(fr)) { editor = fr; log(`[제목수정] 에디터=iframe(mainFrame)`); break; }
        if (await hasEditor(page)) { editor = page; log(`[제목수정] 에디터=페이지 직접(iframe 없음)`); break; }
        await page.waitForTimeout(800);
      }
      if (!editor) log(`[제목수정] 이 URL로는 에디터가 안 떠서 다음 형태로 재시도`);
    }
    if (!editor) {
      throw new Error(`수정 페이지를 열 수 없어요 (마지막 착지: ${landed.slice(0, 50)}). 내 글이 아니거나 로그인이 풀렸을 수 있어요. 계정을 다시 연결한 뒤, 그래도 안 되면 알려주세요.`);
    }
    log(`[제목수정] ③ 에디터 로드됨`);
    await page.waitForTimeout(1500);
    // '작성 중 글 이어쓰기'·도움말(What's New)·온보딩 등 방해 팝업/패널 닫기 — 발행 버튼을 가리는 문제 방지.
    let popupClosed = false;
    for (const ctx of [editor, page as any]) {
      for (const cancelSel of ["button:has-text('취소')", "button:has-text('아니오')", "button:has-text('닫기')", "button:has-text('나중에')", "button[class*='cancel']", "button[class*='close']", ".se-help-panel-close-button", "button[class*='_close']", "[class*='help'] button[class*='close']", "[aria-label='닫기']"]) {
        try { const c = await ctx.$(cancelSel); if (c && await c.isVisible().catch(() => false)) { await c.click({ timeout: 2000 }).catch(() => {}); await page.waitForTimeout(500); popupClosed = true; } } catch {}
      }
    }
    await page.keyboard.press("Escape").catch(() => {});   // 도움말/What's New 패널 닫아 발행 버튼 노출
    await page.waitForTimeout(400);
    if (popupClosed) log(`[제목수정] 방해 팝업/패널 닫음`);

    const before = await editor.evaluate(() => (document.querySelector(".se-section-documentTitle")?.textContent || "").trim().slice(0, 40)).catch(() => "");
    log(`[제목수정] ④ 현재 제목: "${before}" → 바꿀 제목: "${title}"`);

    // ── 제목 교체 = 발행(글쓰기)과 동일 방식: 제목칸 클릭 → 전체선택·삭제 → keyboard.type(사람같은 타이핑).
    //   ★execCommand insertText는 이 에디터에서 멈추는 문제가 있어 제거. 발행이 쓰는 keyboard 입력으로 통일.
    const SEL_A = process.platform === "darwin" ? "Meta+A" : "Control+A";
    const titleOk = async () => { const cur = await editor.evaluate(() => (document.querySelector(".se-section-documentTitle")?.textContent || "").trim()).catch(() => ""); return { ok: cur.includes(title.slice(0, 6)), cur }; };
    const clearTitle = async () => { await page.keyboard.press(SEL_A); await page.waitForTimeout(150); await page.keyboard.press("Backspace"); await page.waitForTimeout(200); };
    let replaced = false;
    for (const clickSel of [".se-section-documentTitle .se-text-paragraph", ".se-section-documentTitle [contenteditable='true']", ".se-section-documentTitle", ".se-placeholder__buttons"]) {
      try {
        const el = await editor.$(clickSel);
        if (!el) continue;
        await editor.click(clickSel, { timeout: 5000 });
        await page.waitForTimeout(400);
        // 방식 1: keyboard.type (맥에서 잘 됨)
        await clearTitle();
        await page.keyboard.type(title, { delay: 30 });
        await page.waitForTimeout(500);
        let r = await titleOk();
        if (r.ok) { replaced = true; break; }
        // 방식 2: keyboard.insertText — ★윈도우 한글 IME 우회(맥에서 type이 씹히던 게 아니라 윈도우 IME가 원인). 텍스트 직접 삽입.
        log(`[제목수정] type 방식 안 먹힘(현재:"${r.cur.slice(0, 16)}") → insertText 재시도(IME 우회)`);
        await editor.click(clickSel, { timeout: 5000 }).catch(() => {});
        await page.waitForTimeout(300);
        await clearTitle();
        await page.keyboard.insertText(title);
        await page.waitForTimeout(500);
        r = await titleOk();
        if (r.ok) { replaced = true; break; }
        log(`[제목수정] 입력 확인 실패(현재:"${r.cur.slice(0, 20)}") → 다음 요소 재시도`);
      } catch (e: any) { log(`[제목수정] 제목칸 시도 오류: ${(e?.message || "").slice(0, 40)}`); }
    }
    if (!replaced) throw new Error("제목 입력칸을 찾지 못했어요(에디터 구조 변경 가능)");
    log(`[제목수정] ⑤ 새 제목 입력 완료: "${title}"`);

    // ── 발행(재발행) ──
    await page.waitForTimeout(500);
    log(`[제목수정] ⑥ 발행 버튼 누르는 중...`);
    let panelOpened = false;
    for (const ctx of [editor, page as any]) {
      for (const sel of ["button.publish_btn__m9KHH", "button[class*='publish_btn']", "button:has-text('발행')"]) {
        try { const el = await ctx.$(sel); if (el && await el.isVisible().catch(() => false)) { await ctx.click(sel, { timeout: 6000 }); panelOpened = true; break; } } catch {}
      }
      if (panelOpened) break;
    }
    if (!panelOpened) throw new Error("발행 버튼을 찾지 못했어요");
    log(`[제목수정] 발행 패널 열림, 최종 확인 누르는 중...`);
    await page.waitForTimeout(2000).catch(() => {});
    // 발행 패널의 최종 확인 버튼 (누르면 네이버가 완성된 글로 이동 → 이 창이 닫히거나 URL이 바뀔 수 있음)
    let finalDone = false;
    for (const ctx of [editor, page as any]) {
      for (const sel of ["button.confirm_btn__xiHQQ", "button[class*='confirm_btn']", "button:has-text('발행')"]) {
        try { const el = await ctx.$(sel); if (el && await el.isVisible().catch(() => false)) { await ctx.click(sel, { timeout: 8000 }); finalDone = true; break; } } catch (err: any) { if (/closed/i.test(err?.message || "")) { finalDone = true; break; } }
      }
      if (finalDone) break;
    }
    if (!finalDone) {
      try {
        const btns = await editor.$$("button");
        for (const btn of btns.reverse()) { const t = await btn.textContent().catch(() => ""); if (t && t.includes("발행")) { await btn.click().catch(() => {}); finalDone = true; break; } }
      } catch (err: any) { if (/closed/i.test(err?.message || "")) finalDone = true; }
    }
    // ★발행 성공 신호: 완성된 글(PostView/logNo)로 이동하거나 창이 닫히면 성공으로 간주(닫힘=성공)
    let published = false;
    try {
      await page.waitForURL(u => /blog\.naver\.com\/.*(logNo=|\/\d{6,})/.test(String(u)) && !/PostWriteForm|RedirectWriteView/.test(String(u)), { timeout: 12000 });
      published = true;
    } catch (err: any) {
      if (page.isClosed() || /closed/i.test(err?.message || "")) published = true;
    }
    // 세션 쿠키 갱신(창이 아직 살아있을 때만)
    try { if (!page.isClosed()) { const nc = await context.cookies(); const s = loadSession(accountId); s.cookies = nc; writeSession(sessionName(accountId), s); } } catch {}
    if (!finalDone && !published) throw new Error("발행 확인 버튼을 누르지 못했어요");
    log(`[제목수정] ✅ ${blogId}/${logNo} 제목 변경 완료${published ? " (발행 후 글로 이동 확인)" : ""}`);
    return { ok: true, message: `제목을 "${title}"로 변경했어요` };
  } catch (e: any) {
    log(`[제목수정] ❌ 실패: ${e.message}`);
    return { ok: false, message: e.message };
  } finally {
    await browser.close().catch(() => {});
  }
}

/* ── 서이추 신청 ── */
export async function addNeighbors(params: {
  accountId: string;
  ownerUserId?: string;   // 이 계정을 쓰는 회원 user_id (프록시 회원 배정 fallback용)
  targets: { keyword: string; blogId: string }[];
  message: string;
  delayMin: number;
  delayMax: number;
  dailyLimit: number;
  skipDone: boolean;
  qualityFilter?: boolean;   // 죽은/광고/서이추불가 블로그 자동 스킵 (기본 ON)
  retryDays?: number;        // 실패/무응답 건 재시도까지 대기일 (기본 30, 0=영구 스킵)
  minVisitors?: number;      // ★대상 블로그 최근 방문자 하한(0=제한없음) — 범위 밖이면 스킵
  maxVisitors?: number;      // ★대상 블로그 최근 방문자 상한(0=제한없음)
  searchEntry?: boolean;     // ★검색 경유 진입(검색 유입): 블로그 방문을 검색→클릭으로. 못 찾으면 URL 폴백
  onLog?: (msg: string) => void;
  onResult?: (r: NeighborResult) => Promise<void>;
  onProgress?: (done: number, fail: number) => void;
  stopSignal?: () => boolean;
}): Promise<void> {
  const { accountId, ownerUserId, targets, message, delayMin, delayMax, dailyLimit, skipDone, qualityFilter = true, retryDays = 30, minVisitors = 0, maxVisitors = 0, searchEntry = false, onLog, onResult, onProgress, stopSignal } = params;
  const log = onLog || console.log;

  // 다중 멘트 파싱 (|||로 구분된 경우 순환 사용)
  const msgs = message.split("|||").map(m => m.trim()).filter(Boolean);
  if (msgs.length === 0) msgs.push(message);
  let msgIdx = 0;

  const cookies = await ensureLiveSession(accountId, log);   // ★세션 만료면 저장된 비번으로 자동 재연결

  const dp = donePath(accountId);
  const doneMap = loadDoneMap(dp);   // { blogId: "YYYY-MM-DD" | "legacy" }
  const today = todayKST();
  // 재신청 방지: 실패/무응답 시도 이력 (blogId → 마지막 시도 ms)
  const attempts = loadAttempts(accountId);
  const retryMs = (retryDays > 0 ? retryDays : 0) * 86400 * 1000;
  const attemptedRecently = (blogId: string) =>
    retryMs > 0 && attempts[blogId] && (Date.now() - attempts[blogId]) < retryMs;

  // 서이추 신청 페이지가 모바일(m.blog.naver.com)만 작동 → 모바일 UA/뷰포트로 실행
  const MOBILE_UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1";
  const browser = await launchBrowser(accountId, { headless: false, maximized: true, log, feature: "neighbor", ownerUserId });
  const context = await browser.newContext({
    userAgent: MOBILE_UA, viewport: { width: 390, height: 844 }, locale: "ko-KR", isMobile: true, hasTouch: true,
  });
  await applyAntiDetection(context);
  await context.addCookies(cookies);
  const page = await context.newPage();
  await page.bringToFront().catch(() => {});   // ★크롬 창을 화면 앞으로

  let done = 0;
  let fail = 0;
  const runSeen = new Set<string>();   // 이번 실행에서 이미 처리한 blogId (중복 신청 방지)

  try {
    // 키워드 교차 셔플 — A키워드1→B키워드1→A키워드2... 패턴으로 자연스럽게
    const kwMap = new Map<string, typeof targets>();
    for (const t of targets) {
      if (!kwMap.has(t.keyword)) kwMap.set(t.keyword, []);
      kwMap.get(t.keyword)!.push(t);
    }
    const shuffled: typeof targets = [];
    const kwArrays = [...kwMap.values()];
    const maxLen = Math.max(...kwArrays.map(a => a.length));
    for (let i = 0; i < maxLen; i++) {
      for (const arr of kwArrays) {
        if (i < arr.length) shuffled.push(arr[i]);
      }
    }
    // 같은 키워드 내에서도 순서 랜덤화
    for (const arr of kwArrays) {
      for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
      }
    }
    log(`[서이추] 🔀 작업 순서 셔플 완료 — ${shuffled.length}개`);

    for (const target of shuffled) {
      // dailyLimit = 서버가 넘겨준 '오늘 남은 한도'(플랜별 quota). 도달 시 자동 정지.
      if (done >= dailyLimit) { log(`[서이추] 오늘 한도 도달 (${dailyLimit}건) — 자동 정지`); break; }
      if (stopSignal?.()) { log("[서이추] 중단 신호 수신"); break; }

      const { keyword, blogId } = target;

      const doneToday = doneMap[blogId] === today;                 // 오늘 이미 처리 → 항상 스킵(당일 중복방지)
      const donePerm = skipDone && (blogId in doneMap);            // 완료 스킵 ON → 과거 처리분도 스킵
      if (doneToday || donePerm || runSeen.has(blogId)) {
        await onResult?.({ keyword, blogId, status: "skip", message: doneToday ? "오늘 이미 처리됨(당일 중복방지)" : donePerm ? "이미 처리됨" : "중복(이번 목록)" });
        onProgress?.(done, fail);
        continue;
      }
      // 최근 실패/무응답 → 재신청 대기기간(retryDays) 안이면 스킵
      if (skipDone && attemptedRecently(blogId)) {
        const daysAgo = Math.floor((Date.now() - attempts[blogId]) / 86400000);
        await onResult?.({ keyword, blogId, status: "skip", message: `최근 시도(${daysAgo}일 전) — ${retryDays}일 후 재시도` });
        onProgress?.(done, fail);
        continue;
      }
      runSeen.add(blogId);   // 이번 실행 내 중복 방지

      try {
        log(`[서이추] ${blogId} 신청 시도...`);

        // ★방문자 수 필터: 최근 방문자가 범위 밖이면 신청하지 않고 스킵(공개 API, 세션 불필요). 못 읽으면 통과.
        if (minVisitors > 0 || maxVisitors > 0) {
          const v = await fetchRecentVisitors(blogId);
          if (v >= 0 && ((minVisitors > 0 && v < minVisitors) || (maxVisitors > 0 && v > maxVisitors))) {
            const msg = `방문자 ${v}명 (범위 ${minVisitors || 0}~${maxVisitors || "∞"} 밖) — 스킵`;
            log(`[서이추] ⏭ ${blogId} ${msg}`);
            await onResult?.({ keyword, blogId, status: "skip", message: msg });
            onProgress?.(done, fail);
            await page.waitForTimeout(humanDelay(1, 2));
            continue;
          }
        }

        // ── 서이추 전 블로그 먼저 방문 (읽는 척) ──
        log(`[서이추] 👀 ${blogId} 블로그 방문 중...`);
        // ★검색 경유 진입(켜진 경우): ①그 키워드(주제)로 검색 → ②안 되면 아이디로 검색 → ③다 못 찾으면 URL 직행.
        let nbEntered = false;
        if (searchEntry) nbEntered = await enterViaSearch(page, [keyword, blogId], blogId, null, log);
        if (!nbEntered) {
          await page.goto(`https://blog.naver.com/${blogId}`, { waitUntil: "domcontentloaded", timeout: 20000 });
        }
        await page.waitForTimeout(humanDelay(2, 5));

        // ── ★품질 필터: 죽은/광고/마켓 블로그 자동 스킵(헛신청 방지, 한도 절약) ──
        if (qualityFilter) {
          const q = await page.evaluate(() => {
            const txt = document.body.innerText || "";
            const title = document.title || "";
            // 최근 글 날짜 흔적 (모바일/PC 공통 상대·절대 시간 표기)
            const hasRecent = /방금 전|분 전|시간 전|일 전|어제|오늘|20\d\d\.\s?\d{1,2}\.\s?\d{1,2}/.test(txt);
            // 마켓/광고/판매 블로그 신호
            const isMarket = /블로그마켓|마켓 바로가기|스토어 바로가기|공동구매|공구 진행|판매중|구매하기|장바구니|가격문의|DM문의|비즈니스/.test(txt + title);
            return { hasRecent, isMarket, len: txt.length };
          }).catch(() => ({ hasRecent: true, isMarket: false, len: 999 }));

          if (q.isMarket) {
            await onResult?.({ keyword, blogId, status: "skip", message: "마켓·광고 블로그(자동 스킵)" });
            log(`[서이추] ⏭ ${blogId} 마켓·광고 블로그 → 스킵`);
            onProgress?.(done, fail);
            await page.waitForTimeout(humanDelay(1, 2));
            continue;
          }
          if (!q.hasRecent && q.len < 4000) {
            await onResult?.({ keyword, blogId, status: "skip", message: "최근 글 없는 휴면 블로그(자동 스킵)" });
            log(`[서이추] ⏭ ${blogId} 휴면(최근 글 없음) → 스킵`);
            onProgress?.(done, fail);
            await page.waitForTimeout(humanDelay(1, 2));
            continue;
          }
        }

        // 스크롤 (3~7초에 걸쳐 천천히 읽는 척)
        const scrollCount = 2 + Math.floor(Math.random() * 3);
        for (let s = 0; s < scrollCount; s++) {
          await page.mouse.wheel(0, 200 + Math.random() * 300);
          await page.waitForTimeout(humanDelay(0.8, 2.5));
        }

        // 가끔 뒤로가기 후 재진입 (15% 확률)
        if (Math.random() < 0.15) {
          log(`[서이추] 🔄 ${blogId} 재방문 중...`);
          await page.goBack({ waitUntil: "domcontentloaded", timeout: 10000 }).catch(() => {});
          await page.waitForTimeout(humanDelay(1, 3));
          await page.goto(
            `https://blog.naver.com/${blogId}`,
            { waitUntil: "domcontentloaded", timeout: 20000 }
          );
          await page.waitForTimeout(humanDelay(1, 3));
        }

        // 서이추 신청 페이지로 이동
        //  ⚠️ 네이버가 PC용 BlogAddNeighbor.naver URL 폐기 → 모바일 BuddyAddForm.naver만 작동(2026-08 실측)
        await page.goto(
          `https://m.blog.naver.com/BuddyAddForm.naver?blogId=${blogId}`,
          { waitUntil: "domcontentloaded", timeout: 20000 }
        );
        await page.waitForTimeout(1500);

        // 페이지 유효성 확인 (폐기/에러/로그인 튕김)
        const bodyTxt = await page.evaluate(() => document.body.innerText).catch(() => "");
        const curUrl = page.url();
        if (curUrl.includes("login") || /사라졌거나|주소를 확인|페이지를 찾을/.test(bodyTxt)) {
          throw new Error("신청 페이지 접근 불가(비공개 블로그이거나 세션 만료)");
        }
        if (/이미 이웃|이웃입니다|나와의 관계/.test(bodyTxt)) {
          throw new Error("이미 이웃이거나 신청 불가");
        }
        // ★상대가 서로이웃을 막아놓은 경우 — 폼이 없고 안내문만 떠서 봇이 멈춘다(테리 신고).
        //   이런 블로그는 즉시 건너뛰어 다음으로. (라디오·메시지칸이 없는 것도 함께 판단)
        const BLOCKED_RE = /서로이웃.{0,6}(신청|받지|허용|거부).{0,6}(받지\s*않|않는|불가|거부|제한)|서로이웃을\s*허용하지|이웃\s*신청을\s*받지\s*않|비공개\s*블로그|서로이웃\s*맺기를\s*원하지/;
        const hasForm = await page.$("#bothBuddyRadio, input[name='relation'], textarea.textarea_t1, textarea[name='message'], textarea").then(el => !!el).catch(() => false);
        if (BLOCKED_RE.test(bodyTxt) || !hasForm) {
          await onResult?.({ keyword, blogId, status: "skip", message: "서로이웃을 받지 않는 블로그" });
          log(`[서이추] ⏭ ${blogId} 서로이웃 신청을 받지 않음 — 건너뜀`);
          if (skipDone && retryMs > 0) { attempts[blogId] = Date.now(); saveAttempt(accountId, blogId, attempts); }  // 재시도 대기 등록(헛시도 방지)
          onProgress?.(done, fail);
          await page.waitForTimeout(humanDelay(delayMin, delayMax));
          continue;
        }

        // 서로이웃 라디오 선택 (#bothBuddyRadio = relation 1). 없으면 이웃추가로 진행.
        try {
          const bothRadio = await page.$("#bothBuddyRadio, input[name='relation'][value='1']");
          if (bothRadio) {
            await bothRadio.click({ timeout: 2000 }).catch(() => page.evaluate(() => {
              const r = document.querySelector("#bothBuddyRadio, input[name='relation'][value='1']") as HTMLInputElement;
              if (r) { r.checked = true; r.click(); }
            }));
            await page.waitForTimeout(400);
          }
        } catch {}

        // 메시지 입력 (모바일: textarea.textarea_t1)
        const msgSels = ["textarea.textarea_t1", "textarea[name='message']", "textarea#sendMessage", "textarea"];
        let msgFilled = false;
        for (const sel of msgSels) {
          try {
            const el = await page.$(sel);
            if (el) {
              await page.click(sel);
              await page.waitForTimeout(300);
              await page.fill(sel, "");
              const currentMsg = msgs[msgIdx % msgs.length];
              msgIdx++;
              const naturalMsg = naturalizeMsg(currentMsg);
              log(`[서이추] 💬 멘트 [${((msgIdx-1) % msgs.length)+1}/${msgs.length}]: "${naturalMsg.slice(0, 30)}..."`);
              await humanType(page, naturalMsg);
              msgFilled = true;
              break;
            }
          } catch {}
        }
        await page.waitForTimeout(400);

        // 확인 버튼 (모바일: a.btn_ok)
        const confirmSels = [
          "a.btn_ok", "button.btn_ok", "a:has-text('확인')", "button:has-text('확인')", "button:has-text('신청')", "input[type='submit']",
        ];
        const clickConfirm = async () => {
          for (const sel of confirmSels) {
            try { const el = await page.$(sel); if (el) { await page.click(sel, { timeout: 3000 }); return true; } } catch {}
          }
          return false;
        };
        const readBody = async () => (await page.evaluate(() => document.body.innerText).catch(() => ""));
        // 팝업(레이어) 안의 '확인' 버튼을 눌러 닫기(폼 헤더의 '확인'과 구분). 눌렀으면 true.
        const clickPopupConfirm = async () => await page.evaluate(() => {
          const els = Array.from(document.querySelectorAll("a,button,span")) as HTMLElement[];
          const vis = (el: HTMLElement) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
          const b = [...els].reverse().find(el => (el.textContent || "").replace(/\s+/g, "") === "확인" && vis(el) &&
            el.closest('[class*="pop"],[class*="layer"],[class*="lyr"],[class*="alert"],[class*="modal"],[role="dialog"]'));
          if (b) { ((b.closest("a,button") as HTMLElement) || b).click(); return true; }
          return false;
        }).catch(() => false);

        let submitted = await clickConfirm();
        await page.waitForTimeout(1200);
        let afterTxt = await readBody();

        // ★"이미 추가한 이웃입니다" 팝업 → 확인 눌러 닫고 이 블로그는 건너뜀(이미 이웃)
        const ALREADY_RE = /이미\s*추가한?\s*이웃|이미\s*(서로)?이웃|이미\s*신청/;
        if (ALREADY_RE.test(afterTxt)) {
          await clickPopupConfirm();
          doneMap[blogId] = today;
          fs.writeFileSync(dp, JSON.stringify(doneMap, null, 2));
          await onResult?.({ keyword, blogId, status: "skip", message: "이미 추가한 이웃" });
          log(`[서이추] ⏭ ${blogId} 이미 이웃 — 건너뜀`);
          onProgress?.(done, fail);
          await page.waitForTimeout(humanDelay(delayMin, delayMax));
          continue;
        }

        // 신청 후 결과 확인
        const LIMIT_RE = /하루 최대|신청 한도|초과하여|더 이상 신청/;
        //  ★"선택 그룹의 이웃수가 초과되어 … 다른 그룹을 선택해주세요" 팝업 = 그룹당 500명 한도.
        //   기존 코드는 이 팝업을 못 잡아 '확인 클릭=성공'으로 잘못 카운트했음 → 아래에서 감지·재시도.
        const GROUP_FULL_RE = /이웃\s*수가\s*초과|다른\s*그룹을?\s*선택|그룹의\s*이웃/;
        // 실제 '신청 완료'를 나타내는 문구(폼 라벨 "서로이웃을 신청합니다"와 구분 — 완료/되었/했만 매칭)
        const SUCCESS_RE = /신청.{0,4}(완료|되었습니다|하였습니다|했습니다)|이웃.{0,4}(추가되었|추가하였|추가\s*완료)/;

        if (GROUP_FULL_RE.test(afterTxt)) {
          //  ★네이버는 수동: 팝업 '확인'만 눌러선 그룹이 안 넘어감(무한반복). 팝업 닫고 → 그룹 목록에서
          //   '다른 그룹'을 직접 선택 → 재신청 을 반복해야 함. 빈 그룹 만나면 신청완료, 다 차면 건너뜀.
          log(`[서이추] ⚠️ ${blogId} 그룹 가득참 → 다른 그룹 선택 후 재신청 반복`);

          // 경고 팝업(레이어)의 '확인'을 눌러 닫기(폼의 '확인'과 구분)
          const dismissPopup = async () => {
            await page.evaluate(() => {
              const els = Array.from(document.querySelectorAll("a,button,span")) as HTMLElement[];
              const vis = (el: HTMLElement) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
              const b = [...els].reverse().find(el => (el.textContent || "").replace(/\s+/g, "") === "확인" && vis(el) &&
                el.closest('[class*="pop"],[class*="layer"],[class*="lyr"],[class*="alert"],[class*="modal"],[role="dialog"]'));
              if (b) ((b.closest("a,button") as HTMLElement) || b).click();
            }).catch(() => {});
          };

          //  ★실측(테리 로그): 폼 그룹 드롭다운 id="buddyGroupSelect", 옵션=기존 그룹뿐("새 그룹","new"…).
          //   '새 그룹 만들기' 항목은 폼에 없음 → 폼 안에선 그룹 신규 생성 불가. 안 찬 기존 그룹을 골라 재신청.
          const sel: any = await page.evaluate(() => {
            const s: any = document.querySelector("#buddyGroupSelect") || document.querySelector("select");
            if (!s) return null;
            return { id: s.id, name: s.name, opts: Array.from(s.options).map((o: any) => ({ t: (o.text || "").trim(), v: o.value, sel: o.selected })) };
          }).catch(() => null);

          let recovered = false;
          if (sel && sel.opts.length > 1) {
            const selSelector = sel.id ? `#${sel.id}` : (sel.name ? `select[name="${sel.name}"]` : "select");
            //  마지막(최근 생성) 그룹이 가장 여유 있을 확률이 높아 뒤에서부터 시도
            const cands = [...sel.opts].reverse().filter((o: any) => o.v && !o.sel && !/^\s*(그룹\s*선택|선택하세요|선택)$/.test(o.t));
            for (const o of cands) {
              try {
                await dismissPopup(); await page.waitForTimeout(400);
                await page.selectOption(selSelector, o.v).catch(() => {});   // 다른 그룹 선택
                await page.waitForTimeout(400);
                await page.click("a.btn_ok").catch(() => clickConfirm());     // 폼 재신청
                await page.waitForTimeout(1500);
                afterTxt = await readBody();
                if (SUCCESS_RE.test(afterTxt)) { log(`[서이추] ✅ '${o.t}' 그룹으로 신청`); recovered = true; break; }
              } catch {}
            }
            if (!recovered) log(`[서이추] ⛔ ${blogId} 모든 그룹(${cands.length}개) 가득참`);
          } else {
            log(`[서이추] ⛔ ${blogId} 그룹 목록을 못 읽음`);
          }
          submitted = recovered;
          if (!recovered) throw new Error("모든 이웃 그룹이 가득 참 — 건너뜀(네이버 블로그에서 빈 이웃 그룹을 하나 만들어 주세요)");
        }

        if (LIMIT_RE.test(afterTxt)) {
          throw new Error("네이버 일일 서이추 한도 도달");
        }

        if (submitted) {
          doneMap[blogId] = today;
          fs.writeFileSync(dp, JSON.stringify(doneMap, null, 2));
          done++;
          await onResult?.({ keyword, blogId, status: "success", message: "서이추 신청 완료" });
          log(`[서이추] ✅ ${blogId} 완료 (${done}/${dailyLimit})`);
        } else {
          throw new Error("신청 버튼을 찾을 수 없음");
        }
      } catch (e: any) {
        fail++;
        // 실패/무응답 시도일 기록 → retryDays 동안 재신청 안 함(무한 헛시도 방지)
        if (skipDone && retryMs > 0) saveAttempt(accountId, blogId, attempts);
        await onResult?.({ keyword, blogId, status: "fail", message: e.message });
        log(`[서이추] ❌ ${blogId} 실패: ${e.message}`);
      }

      onProgress?.(done, fail);
      const delay = humanDelay(delayMin, delayMax);
      log(`[서이추] ⏱ 다음 작업까지 ${(delay/1000).toFixed(1)}초 대기...`);
      await page.waitForTimeout(delay);
      if ((done + fail) % 10 === 0 && (done + fail) > 0) {
        const longRest = humanDelay(30, 90);
        log(`[서이추] ☕ ${(longRest/1000).toFixed(0)}초 긴 휴식 중...`);
        await page.waitForTimeout(longRest);
      }
    }
  } finally {
    await browser.close().catch(() => {});
  }
}


export interface EngageResult {
  keyword: string;
  blogId: string;
  postUrl: string;
  liked: boolean;
  commented: boolean;
  status: "success" | "fail" | "skip";
  message: string;
}

/* ── AI 자동 댓글: 블로그 글을 읽고 Gemini로 자연스러운 댓글 1개 생성 ── */
async function extractPostText(ctx: any): Promise<string> {
  try {
    return await ctx.evaluate(() => {
      const pick = (sel: string) => (document.querySelector(sel) as HTMLElement | null)?.innerText || "";
      const title = pick(".se-title-text") || pick(".htitle") || pick(".pcol1") || document.title || "";
      const body = pick(".se-main-container") || pick("#postViewArea") || pick(".post_ct") || pick(".se_component_wrap") || "";
      return (title + "\n" + body).replace(/\s+/g, " ").trim().slice(0, 1200);
    });
  } catch { return ""; }
}
// ── 체류시간 엔진: 글 분량(글자·이미지 수)을 읽어 실제 독서처럼 스크롤·머무름 ──
//   짧은 글은 빨리, 긴 글은 오래(단 상한 있음). 즉시 이탈 패턴을 줄여 체류시간을 자연스럽게 높인다.
// ★체류 속도 모드: 글 많은 블로그를 자주 돌릴 때 시간을 줄일 수 있게 3단계.
//   fast=빠르게(최대 10초)·normal=보통(최대 22초)·natural=자연스럽게(최대 40초, 기본). 딜레이로 안전은 별도 유지.
type ReadSpeed = "fast" | "normal" | "natural";
async function readPostNaturally(page: any, ctx: any, log?: (m: string) => void, speed: ReadSpeed = "natural"): Promise<void> {
  let chars = 0, imgs = 0;
  try {
    const info = await ctx.evaluate(() => {
      const body = (document.querySelector(".se-main-container") as HTMLElement) || (document.querySelector("#postViewArea") as HTMLElement) || document.body;
      const text = (body?.innerText || "").replace(/\s+/g, "").length;
      const images = body?.querySelectorAll("img").length || 0;
      return { text, images };
    });
    chars = info.text || 0; imgs = info.images || 0;
  } catch {}
  // 목표 체류시간(초): 글자 500자당 약 2.5초 + 이미지 1장당 1.2초. 속도 모드에 따라 배율·상한·하한을 다르게.
  const mul = speed === "fast" ? 0.25 : speed === "normal" ? 0.55 : 1;
  const cap = speed === "fast" ? 10 : speed === "normal" ? 22 : 40;
  const floor = speed === "fast" ? 2 : speed === "normal" ? 3 : 4;
  const target = Math.min(cap, Math.max(floor, ((chars / 500) * 2.5 + imgs * 1.2) * mul));
  const scrolls = Math.min(14, Math.max(2, Math.round(target / 2.2)));   // 체류시간에 비례한 스크롤 횟수
  log?.(`[체류] 글 약 ${chars}자·이미지 ${imgs}장 → ${Math.round(target)}초 정독(스크롤 ${scrolls}회, ${speed === "fast" ? "빠르게" : speed === "normal" ? "보통" : "자연스럽게"})`);
  const per = (target * 1000) / scrolls;
  for (let s = 0; s < scrolls; s++) {
    await page.mouse.wheel(0, 140 + Math.random() * 260);
    await page.waitForTimeout(per * (0.7 + Math.random() * 0.6));       // 스크롤 간 텀 편차
    if (Math.random() < 0.18) { await page.mouse.wheel(0, -(180 + Math.random() * 260)); await page.waitForTimeout(per * 0.5); } // 가끔 위로(다시 읽는 척)
  }
}
// ★한도 초과 여부를 밖으로 알리기 위한 플래그(모델 로직은 그대로, 반환만 유지). true면 순환 댓글로 자동 전환.
let __aiQuotaExhausted = false;
async function generateAiComment(key: string, tone: string, postText: string, log: (m: string) => void): Promise<string> {
  __aiQuotaExhausted = false;
  if (!key) { log("[AI댓글] ⚠️ Gemini 키가 없어 건너뜁니다 (설정 → 글쓰기 AI에서 Gemini 키 입력)"); return ""; }
  if (!postText || postText.length < 10) { log("[AI댓글] 글 내용을 못 읽어 건너뜀"); return ""; }
  const toneGuide = tone === "담백" ? "깔끔하고 담백한" : tone === "짧게" ? "짧고 간결한" : "다정하고 따뜻한";
  // ★시작 표현 다양화: 매번 "와~"로 시작해 다 비슷해지는 문제 방지. 랜덤 힌트로 첫 단어를 흩뿌린다.
  const starters = ["글 내용에 바로 반응하며", "질문을 던지듯", "공감하는 어투로", "가볍게 감탄하며", "정보에 고마움을 표하며", "담담하게 한마디로", "본문의 한 부분을 콕 집어", "내 경험을 살짝 곁들여"];
  const starterHint = starters[Math.floor(Math.random() * starters.length)];
  const prompt = `너는 네이버 블로그 이웃이야. 아래 블로그 글을 읽고 ${toneGuide} 말투의 자연스러운 한국어 공감 댓글을 딱 1개만 써줘.\n규칙: 1~2문장, 45자 이내, 글 내용에 구체적으로 반응, 이모지 1개 정도만, 광고·링크·해시태그 금지, 따옴표 없이 댓글 문장만 출력.\n★중요(시작 표현 다양화): 이번 댓글은 "${starterHint}" 시작해줘. "와", "우와", "와아" 같은 감탄사로 시작하지 마. 매번 다른 첫 단어로 시작해서 다른 댓글들과 겹치지 않게 해.\n\n[블로그 글]\n${postText}`;
  let sawQuota = false;   // 429/quota를 본 모델이 있었는지(모든 모델 소진 후에만 한도소진 처리)
  for (const model of GEMINI_MODELS) {
    try {
      // ★2.5계열은 thinking 토큰을 먼저 소비 → maxOutputTokens가 작으면 실제 댓글이 잘려나옴.
      //   그래서 thinking 끄고(thinkingBudget 0), 토큰도 넉넉히(800) 준다.
      const generationConfig: any = { maxOutputTokens: 800, temperature: 1.0 };
      if (model.startsWith("gemini-2.5")) generationConfig.thinkingConfig = { thinkingBudget: 0 };
      const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig }),
      });
      const d: any = await r.json();
      // ★글쓰기(callAI)와 동일: 어떤 실패든(429 한도 포함) 다음 모델로 폴백. 한 모델 429여도 다른 모델은 한도가 남아있음.
      if (!r.ok) { if (r.status === 429 || /quota|exceeded|rate.?limit/i.test(d?.error?.message || "")) sawQuota = true; log(`[AI댓글] ${model} 실패(${r.status}) → 다음 모델`); continue; }
      const cand = d?.candidates?.[0];
      const raw = cand?.content?.parts?.[0]?.text?.trim();
      const finish = cand?.finishReason;
      // ★응답이 토큰 상한에 걸려 잘렸거나(MAX_TOKENS) 비어있으면 → 잘린 댓글을 등록하지 말고 다음 모델 재시도
      if (!raw) { log(`[AI댓글] ${model} 빈 응답(${finish || "?"}) → 다음 모델 시도`); continue; }
      if (finish === "MAX_TOKENS") { log(`[AI댓글] ${model} 응답이 잘림(MAX_TOKENS) → 다음 모델 시도`); continue; }
      // 줄바꿈은 첫 줄만 자르지 말고 공백으로 합쳐 전체 문장을 살린다.
      const cleaned = raw.replace(/^["'\s]+|["'\s]+$/g, "").replace(/\s*[\r\n]+\s*/g, " ").replace(/\s{2,}/g, " ").trim().slice(0, 120);
      if (cleaned.length < 4) { log(`[AI댓글] ${model} 응답이 너무 짧음("${cleaned}") → 다음 모델 시도`); continue; }
      return cleaned;
    } catch (e: any) { log(`[AI댓글] 오류(${model}): ${e.message}`); }
  }
  // ★모든 모델이 429/한도였을 때만 소진으로 판정 → 순환 폴백 댓글로 전환. (한 모델 429로 섣불리 포기하지 않음)
  if (sawQuota) { __aiQuotaExhausted = true; log("[AI댓글] 모든 모델 한도 소진 → 순환 댓글로 전환"); }
  else log("[AI댓글] 모든 모델 생성 실패");
  return "";
}

/* ── 블로그 건강검진: 내 블로그 실제 지표 크롤 ──
   네이버는 공식 '지수'를 공개하지 않으므로, 실제로 읽을 수 있는 지표만 수집한다:
   총 게시글 수, 이웃 수, 최근 글 날짜들(→발행 빈도/마지막 활동). 점수·등급은 이 지표로 산출. */
export type BlogExposureCheck = {
  logNo: string;
  title: string;
  exposed: boolean | null;
  rank: number | null;
  indexed?: boolean;
  status?: "exposed" | "low" | "missing";
  postUrl?: string;
};

export type BlogVisitorDay = { date: string; visitors: number };

type NaverPostItem = { logNo: string; title: string; date: string; dateMs: number; url: string };

function koreanDate(date: Date): string {
  try { return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit" }).format(date); }
  catch { return date.toISOString().slice(0, 10); }
}

function decodeNaverText(value: unknown): string {
  let text = String(value ?? "").replace(/\+/g, " ");
  try { text = decodeURIComponent(text); } catch {}
  return text
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&").replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'").replace(/&lt;/gi, "<").replace(/&gt;/gi, ">")
    .replace(/&#(\d+);/g, (_m, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_m, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/\s+/g, " ").trim();
}

function parseRelativePostDate(value: string, nowMs = Date.now()): { date: string; dateMs: number } | null {
  const raw = value.trim();
  let elapsedMs: number | null = null;

  if (raw === "방금 전") elapsedMs = 0;
  else if (raw === "어제") elapsedMs = 24 * 60 * 60 * 1000;
  else if (raw === "그제" || raw === "그저께") elapsedMs = 2 * 24 * 60 * 60 * 1000;
  else {
    const match = raw.match(/^(\d+)\s*(초|분|시간|일)\s*전$/);
    if (!match) return null;
    const amount = Number(match[1]);
    const unitMs = match[2] === "초" ? 1000
      : match[2] === "분" ? 60 * 1000
      : match[2] === "시간" ? 60 * 60 * 1000
      : 24 * 60 * 60 * 1000;
    elapsedMs = amount * unitMs;
  }

  const d = new Date(nowMs - elapsedMs);
  return { date: koreanDate(d), dateMs: d.getTime() };
}

/* ── 블로그 방문자 수 조회 (공개 위젯 API, 세션 불필요) ──
   NVisitorgp4Ajax는 최근 5일 정도의 일별 방문자를 XML로 준다. 오늘은 진행 중이라 최근 며칠의 최댓값을 대표값으로 쓴다.
   못 읽으면 -1 반환(필터에서 '통과'로 처리 → 조회 실패로 억울하게 스킵되지 않게). */
async function fetchRecentVisitors(blogId: string): Promise<number> {
  try {
    const r = await fetch(`https://blog.naver.com/NVisitorgp4Ajax.naver?blogId=${encodeURIComponent(blogId)}`, {
      headers: { "User-Agent": UA, Referer: `https://blog.naver.com/${blogId}` },
    });
    if (!r.ok) return -1;
    const t = await r.text();
    const nums = [...t.matchAll(/cnt="(\d+)"/g)].map(m => Number(m[1])).filter(n => Number.isFinite(n));
    if (!nums.length) return -1;
    return Math.max(...nums);   // 최근 며칠 중 최대(대표 방문자 규모)
  } catch { return -1; }
}

function normalizePostDate(value: unknown): { date: string; dateMs: number } {
  const raw = String(value ?? "").trim();
  const relative = parseRelativePostDate(raw);
  if (relative) return relative;
  if (/^\d{10,13}$/.test(raw)) {
    const numeric = Number(raw) * (raw.length === 10 ? 1000 : 1);
    const d = new Date(numeric);
    if (!Number.isNaN(d.getTime())) return { date: koreanDate(d), dateMs: d.getTime() };
  }
  const match = raw.match(/(\d{4})[^\d]+(\d{1,2})[^\d]+(\d{1,2})/);
  if (match) {
    const date = `${match[1]}-${match[2].padStart(2, "0")}-${match[3].padStart(2, "0")}`;
    return { date, dateMs: new Date(`${date}T00:00:00+09:00`).getTime() };
  }
  const parsed = Date.parse(raw);
  return Number.isNaN(parsed) ? { date: raw.slice(0, 20), dateMs: 0 } : { date: koreanDate(new Date(parsed)), dateMs: parsed };
}

function cookieHeader(cookies: any[]): string {
  return (Array.isArray(cookies) ? cookies : []).filter(cookie => cookie?.name).map(cookie => `${cookie.name}=${cookie.value}`).join("; ");
}

async function fetchNaverPostList(params: {
  blogId: string; cookies: any[]; maxCount?: number | null; log?: (msg: string) => void;
}): Promise<{ posts: NaverPostItem[]; source: "api" | "rss" | "none"; totalCount: number }> {
  const { blogId, cookies, maxCount = null } = params;
  const log = params.log || console.log;
  const posts: NaverPostItem[] = [];
  const seen = new Set<string>();
  let totalCount = 0;
  try {
    // ★공개 요청(쿠키 없이). 세션 쿠키를 넣으면 네이버가 막아 빈 응답을 주는 것을 실측 확인(2026-08-23).
    //   PostTitleListAsync/RSS는 공개 데이터라 쿠키 불필요. review-check(체험단 심사)의 검증된 방식과 동일.
    const headers = { "User-Agent": UA, Referer: `https://blog.naver.com/${blogId}`, Accept: "application/json,text/plain,*/*" };
    for (let pageNo = 1; pageNo <= 1000 && (maxCount === null || posts.length < maxCount); pageNo++) {
      const url = `https://blog.naver.com/PostTitleListAsync.naver?blogId=${encodeURIComponent(blogId)}&viewdate=&currentPage=${pageNo}&categoryNo=&parentCategoryNo=&countPerPage=30`;
      const response = await fetch(url, { headers });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const raw = await response.text();
      const start = raw.indexOf("{");
      const end = raw.lastIndexOf("}");
      if (start < 0 || end < start) throw new Error("JSON 본문 없음");
      // ★네이버 PostTitleListAsync 응답의 pagingHtml에 잘못된 이스케이프(\')가 있어 JSON.parse가 죽는다(실측 2026-08-23).
      //   JSON에서 작은따옴표는 이스케이프 불필요 → \' 를 ' 로 정리한 뒤 파싱. (이게 posts 0개의 진짜 원인이었음)
      const jsonText = raw.slice(start, end + 1).replace(/\\'/g, "'");
      const json: any = JSON.parse(jsonText);
      const list: any[] = Array.isArray(json?.postList) ? json.postList : Array.isArray(json?.result?.postList) ? json.result.postList : [];
      const countCandidate = Number(json?.totalCount ?? json?.totalPostCount ?? json?.result?.totalCount ?? json?.result?.totalPostCount ?? json?.count ?? 0);
      if (Number.isFinite(countCandidate) && countCandidate > totalCount) totalCount = countCandidate;
      if (!list.length) break;
      let added = 0;
      for (const item of list) {
        const logNo = String(item?.logNo ?? item?.logno ?? item?.postNo ?? "").trim();
        const title = decodeNaverText(item?.title ?? item?.postTitle);
        if (!/^\d+$/.test(logNo) || !title || seen.has(logNo)) continue;
        const normalized = normalizePostDate(item?.addDate ?? item?.writeDate ?? item?.regDate ?? item?.date);
        seen.add(logNo); added++;
        posts.push({ logNo, title, ...normalized, url: `https://blog.naver.com/${blogId}/${logNo}` });
        if (maxCount !== null && posts.length >= maxCount) break;
      }
      if (!added || (totalCount > 0 ? posts.length >= totalCount : list.length < 30)) break;
    }
    if (posts.length) {
      log(`[글목록] PostTitleListAsync API에서 ${posts.length}개 수집`);
      return { posts, source: "api", totalCount: Math.max(totalCount, posts.length) };
    }
  } catch (e: any) { log(`[글목록] PostTitleListAsync 실패 (${e.message}) · 모바일 API로 재시도`); }

  // ★모바일 블로그 API 폴백 (실측 2026-08-23): PostTitleListAsync가 막힌 블로그(에러 페이지)도
  //   m.blog.naver.com/api 는 JSON으로 전체 글(logNo·제목·작성일 epoch)을 안정적으로 준다. RSS(최근 몇 개)보다 정확.
  if (posts.length === 0) {
    try {
      const MUA = "Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1";
      for (let pageNo = 1; pageNo <= 1000 && (maxCount === null || posts.length < maxCount); pageNo++) {
        const u = `https://m.blog.naver.com/api/blogs/${encodeURIComponent(blogId)}/post-list?categoryNo=0&itemCount=30&page=${pageNo}`;
        const resp = await fetch(u, { headers: { "User-Agent": MUA, Referer: `https://m.blog.naver.com/${blogId}` } });
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const jt = (await resp.text()).replace(/^\)\]\}',?\s*/, "");
        const j: any = JSON.parse(jt);
        const items: any[] = j?.result?.items || [];
        const tc = Number(j?.result?.totalCount ?? 0);
        if (Number.isFinite(tc) && tc > totalCount) totalCount = tc;
        if (!items.length) break;
        let added = 0;
        for (const it of items) {
          const logNo = String(it?.logNo ?? "").trim();
          const title = decodeNaverText(it?.titleWithInspectMessage ?? it?.title);
          if (!/^\d+$/.test(logNo) || !title || seen.has(logNo)) continue;
          const ms = Number(it?.addDate) || 0;
          seen.add(logNo); added++;
          posts.push({ logNo, title, date: ms > 0 ? koreanDate(new Date(ms)) : "", dateMs: ms > 0 ? ms : 0, url: `https://blog.naver.com/${blogId}/${logNo}` });
          if (maxCount !== null && posts.length >= maxCount) break;
        }
        if (!added || items.length < 30) break;
      }
      if (posts.length) {
        log(`[글목록] 모바일 API에서 ${posts.length}개 수집`);
        return { posts, source: "api", totalCount: Math.max(totalCount, posts.length) };
      }
    } catch (e: any) { log(`[글목록] 모바일 API 실패 (${e.message}) · RSS로 재시도`); }
  }

  try {
    const response = await fetch(`https://rss.blog.naver.com/${encodeURIComponent(blogId)}.xml`, { headers: { "User-Agent": UA, Accept: "application/rss+xml,application/xml,text/xml" } });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const xml = await response.text();
    const items = xml.match(/<item\b[\s\S]*?<\/item>/gi) || [];
    for (const item of items) {
      const title = decodeNaverText(item.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]);
      const link = decodeNaverText(item.match(/<link[^>]*>([\s\S]*?)<\/link>/i)?.[1]);
      const logNo = link.match(/(?:logNo=|\/)(\d{6,})(?:[/?&]|$)/)?.[1] || "";
      if (!logNo || !title || seen.has(logNo)) continue;
      const normalized = normalizePostDate(decodeNaverText(item.match(/<pubDate[^>]*>([\s\S]*?)<\/pubDate>/i)?.[1]));
      seen.add(logNo);
      posts.push({ logNo, title, ...normalized, url: `https://blog.naver.com/${blogId}/${logNo}` });
      if (maxCount !== null && posts.length >= maxCount) break;
    }
    if (posts.length) { log(`[글목록] RSS 폴백에서 최근 글 ${posts.length}개 수집`); return { posts, source: "rss", totalCount: posts.length }; }
  } catch (e: any) { log(`[글목록] RSS 폴백 실패 (${e.message})`); }
  return { posts: [], source: "none", totalCount: 0 };
}

export type BlogStats = {
  blogId: string;
  totalPosts: number;
  neighbors: number;
  recentDates: string[];
  exposureChecks: BlogExposureCheck[];
  lowQualitySuspected: boolean | null;
  visitorDays: BlogVisitorDay[];
  inflowKeywords: { keyword: string; count?: number }[];
  visitorDrop: { detected: boolean; rate: number | null; message: string } | null;
  // ★발행 활성도(상위노출 핵심): 최근 발행 간격으로 활성/보통/비활성 판정
  activity: { level: "active" | "normal" | "inactive"; daysSinceLast: number | null; postsIn7d: number; postsIn30d: number; message: string } | null;
  totalPostsForExposure: number;
  checkedTodayCount: number;
  exposureCompletedCount: number;
  exposureLimit: number | null;
};

type ExposurePost = { logNo: string; title: string; date?: string; dateMs?: number };
type ExposureHistory = { dailyDate: string; dailyCount: number; lastChecked: Record<string, number> };
type ExposureProgress = { checks: BlogExposureCheck[]; checkedTodayCount: number; completedCount: number; limit: number | null };

const EXPOSURE_DAILY_LIMIT: Record<string, number | null> = { free: 5, basic: 10, pro: 20, unlimited: null, admin: null };
const INDEX_GRACE_DAYS = 14;

function exposureToday(): string {
  try { return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date()); }
  catch { return new Date().toISOString().slice(0, 10); }
}

function exposureHistoryPath(blogId: string): string {
  const safeBlogId = blogId.replace(/[^a-zA-Z0-9_-]/g, "_");
  return path.join(SESSION_DIR, `exposure_checked_${safeBlogId}.json`);
}

function readExposureHistory(blogId: string): ExposureHistory {
  const today = exposureToday();
  try {
    const parsed = JSON.parse(fs.readFileSync(exposureHistoryPath(blogId), "utf8"));
    return {
      dailyDate: today,
      dailyCount: parsed?.dailyDate === today && Number.isFinite(parsed?.dailyCount) ? Math.max(0, parsed.dailyCount) : 0,
      lastChecked: parsed?.lastChecked && typeof parsed.lastChecked === "object" ? parsed.lastChecked : {},
    };
  } catch { return { dailyDate: today, dailyCount: 0, lastChecked: {} }; }
}

function writeExposureHistory(blogId: string, history: ExposureHistory): void {
  try {
    fs.mkdirSync(SESSION_DIR, { recursive: true, mode: 0o700 });
    const target = exposureHistoryPath(blogId);
    const temp = `${target}.${process.pid}.tmp`;
    fs.writeFileSync(temp, JSON.stringify(history, null, 2), { mode: 0o600 });
    fs.renameSync(temp, target);
  } catch (e: any) { console.warn(`[검색노출] 검사 기록 저장 실패: ${e.message}`); }
}

/* ── 검색 경유 진입: 네이버 통합검색(블로그탭)에서 대상 글/블로그를 찾아 클릭해 들어간다 ──
   URL 직행 대신 검색을 거쳐 방문하면 상대 블로그에 "검색 유입"으로 잡혀 자연스럽고 지수(홈판)에 유리.
   찾아서 클릭 진입하면 true, 검색 결과에 없으면 false(호출부에서 URL로 폴백). keyword로 검색.
   targetLogNo가 있으면 그 글을, 없으면 그 블로그의 아무 글이나 클릭. */
// ★검색 유입: 여러 검색어를 순서대로 시도해 대상 글(blogId+logNo)을 검색 결과에서 찾아 클릭.
//   테리 확정 순서: ①주제(제목 키워드) → ②안 되면 아이디 → (다 못 찾으면 false 반환 → 호출부가 최종 URL 직행).
//   ①주제 검색이 자연스럽고 노출에 유리. 단 그 글이 검색에 노출돼야 찾힘 → 안 뜨면 아이디/URL 폴백.
async function enterViaSearch(page: any, queries: (string | null | undefined)[], blogId: string, targetLogNo: string | null, log: (m: string) => void): Promise<boolean> {
  const wanted = blogId.toLowerCase();
  const tried = new Set<string>();
  for (const raw of queries) {
    const kw = (raw || "").trim();
    if (!kw || tried.has(kw.toLowerCase())) continue;
    tried.add(kw.toLowerCase());
    try {
      await page.goto(`https://m.search.naver.com/search.naver?ssc=tab.m_blog.all&query=${encodeURIComponent(kw)}`, { waitUntil: "domcontentloaded", timeout: 20000 });
      await page.waitForTimeout(1000);
      for (let i = 0; i < 4; i++) { await page.mouse.wheel(0, 3000); await page.waitForTimeout(500); }
      const sel = await page.evaluate((args: { wanted: string; logNo: string | null }) => {
        const as = Array.from(document.querySelectorAll('a[href*="blog.naver.com"]')) as HTMLAnchorElement[];
        for (let i = 0; i < as.length; i++) {
          const h = as[i].href || "";
          const m = h.match(/blog\.naver\.com\/([a-zA-Z0-9_-]+)\/(\d{6,})/) || h.match(/blog\.naver\.com\/([a-zA-Z0-9_-]+)[?].*logNo=(\d{6,})/);
          if (!m) continue;
          if (m[1].toLowerCase() !== args.wanted) continue;
          if (args.logNo && m[2] !== args.logNo) continue;
          as[i].setAttribute("data-publy-hit", "1");
          return true;
        }
        return false;
      }, { wanted, logNo: targetLogNo });
      if (!sel) { log(`[검색유입] "${kw.slice(0, 20)}" 검색결과에 대상 글이 없어요 → 다음 방법`); continue; }
      const el = await page.$('a[data-publy-hit="1"]');
      if (!el) continue;
      await el.scrollIntoViewIfNeeded().catch(() => {});
      await page.waitForTimeout(400 + Math.random() * 600);   // 사람처럼 잠깐
      await Promise.all([
        page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 20000 }).catch(() => {}),
        el.click({ timeout: 5000 }).catch(() => {}),
      ]);
      await page.waitForTimeout(800);
      log(`[검색유입] 🔎 "${kw.slice(0, 20)}" 검색에서 ${blogId} 글 찾아 클릭 진입`);
      return true;
    } catch (e: any) {
      log(`[검색유입] "${kw.slice(0, 15)}" 검색 실패(${(e.message || "").slice(0, 20)}) → 다음 방법`);
      continue;
    }
  }
  log(`[검색유입] 검색으로 못 찾음 → 주소로 직접 진입`);
  return false;
}

/* ── 제목에서 검색용 핵심 키워드 뽑기 ──
   제목 전체로 검색하면 실제 노출 순위와 안 맞는다(네이버가 여러 단어 조합으로 처리).
   장식·조사·흔한 단어를 걷어내고 의미 있는 명사 위주로 6단어 이내로 줄인다. */
function extractSearchQuery(title: string): string {
  const cleaned = title.replace(/[^\p{L}\p{N}\s]/gu, " ").replace(/\s+/g, " ").trim();
  const drop = new Set(["그리고","하는","한","및","의","가","이","은","는","을","를","에","에서","으로","와","과","도","만","best","BEST","top","TOP","추천","후기","방법","정리","총정리","완벽","꿀팁","리뷰"]);
  const words = cleaned.split(" ").filter(w => w.length >= 2 && !drop.has(w));
  const q = (words.length ? words : cleaned.split(" ")).slice(0, 6).join(" ").trim();
  return q.slice(0, 80) || title.slice(0, 80);
}

/* ── 실제 통합검색(모바일 블로그탭) 순위 크롤 ──
   개발자 API(openapi, sort=sim)는 실제 노출 순위와 다르다. 실제 사용자가 보는 순서를 그대로 읽으려면
   m.search.naver.com 블로그탭 결과의 blog링크 순서에서 내 (blogId + logNo) 위치를 찾는다. 세션 쿠키 사용. */
async function searchRealRank(context: BrowserContext, blogId: string, logNo: string, query: string, log: (m: string) => void): Promise<{ rank: number | null; total: number }> {
  const MUA = "Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1";
  const page = await context.newPage();
  try {
    await page.setExtraHTTPHeaders({ "User-Agent": MUA });
    await page.goto(`https://m.search.naver.com/search.naver?ssc=tab.m_blog.all&query=${encodeURIComponent(query)}`, { waitUntil: "domcontentloaded", timeout: 20000 });
    await page.waitForTimeout(1200);
    // 더 많은 결과 로드(스크롤)
    for (let i = 0; i < 4; i++) { await page.mouse.wheel(0, 3000); await page.waitForTimeout(600); }
    const links: string[] = await page.$$eval('a[href*="blog.naver.com"]', els => els.map(e => (e as HTMLAnchorElement).href));
    // 블로그 글 링크만 순서대로(중복 제거). 각 링크에서 blogId/logNo 추출.
    const seq: { blogId: string; logNo: string }[] = [];
    const seen = new Set<string>();
    for (const h of links) {
      const m = h.match(/blog\.naver\.com\/([a-zA-Z0-9_-]+)\/(\d{6,})/) || h.match(/blog\.naver\.com\/([a-zA-Z0-9_-]+)[?].*logNo=(\d{6,})/);
      if (!m) continue;
      const key = `${m[1]}/${m[2]}`;
      if (seen.has(key)) continue;
      seen.add(key); seq.push({ blogId: m[1].toLowerCase(), logNo: m[2] });
    }
    const idx = seq.findIndex(s => s.blogId === blogId.toLowerCase() && s.logNo === String(logNo));
    return { rank: idx >= 0 ? idx + 1 : null, total: seq.length };
  } catch (e: any) {
    log(`[검색노출] 실검색 실패(${(e.message || "").slice(0, 30)})`);
    return { rank: null, total: 0 };
  } finally { await page.close().catch(() => {}); }
}

function isTargetBlogSearchItem(item: any, blogId: string, logNo: string): boolean {
  const wanted = blogId.toLowerCase();
  const link = String(item?.link || "").replace(/&amp;/gi, "&").toLowerCase();
  const bloggerLink = String(item?.bloggerlink || "").toLowerCase();
  try {
    const parsed = new URL(link);
    const linkBlogId = (parsed.searchParams.get("blogId") || "").toLowerCase();
    const linkLogNo = parsed.searchParams.get("logNo") || parsed.pathname.match(/\/(\d{6,})(?:\/)?$/)?.[1] || "";
    const pathOwner = parsed.pathname.split("/").filter(Boolean)[0]?.toLowerCase() || "";
    const profileOwner = bloggerLink.replace(/\/$/, "").split("/").pop() || "";
    return (linkBlogId === wanted || pathOwner === wanted || profileOwner === wanted) && linkLogNo === String(logNo);
  } catch {
    return link.includes(`blog.naver.com/${wanted}/${logNo}`)
      || (link.includes(`blogid=${wanted}`) && link.includes(`logno=${logNo}`));
  }
}

async function searchBlogApiItems(query: string, keys: { clientId: string; clientSecret: string }): Promise<any[] | null> {
  const url = `https://openapi.naver.com/v1/search/blog.json?query=${encodeURIComponent(query)}&display=100&start=1&sort=sim`;
  const response = await fetch(url, { headers: { "X-Naver-Client-Id": keys.clientId, "X-Naver-Client-Secret": keys.clientSecret } });
  if (!response.ok) return null;
  const json: any = await response.json();
  return Array.isArray(json?.items) ? json.items : [];
}

/* 순위 검색에서 못 찾은 오래된 글만 보수적으로 색인 여부를 재확인한다.
   제목 전체와 site 한정 검색이 모두 정상 응답한 경우에만 '없음'을 확정한다. */
async function checkBlogPostIndexed(blogId: string, logNo: string, title: string, keys: { clientId: string; clientSecret: string }): Promise<boolean | undefined> {
  const exactTitle = title.replace(/\s+/g, " ").trim().slice(0, 200);
  if (!exactTitle) return undefined;
  const queries = [exactTitle, `site:blog.naver.com/${blogId} ${exactTitle}`];
  const results = await Promise.all(queries.map(query => searchBlogApiItems(query, keys)));
  if (results.some(items => items?.some(item => isTargetBlogSearchItem(item, blogId, logNo)))) return true;
  return results.every(items => items !== null) ? false : undefined;
}

async function checkBlogExposure(blogId: string, posts: ExposurePost[], plan: string, log: (msg: string) => void, searchContext?: BrowserContext): Promise<ExposureProgress> {
  const normalizedPlan = Object.prototype.hasOwnProperty.call(EXPOSURE_DAILY_LIMIT, plan) ? plan : "free";
  const limit = EXPOSURE_DAILY_LIMIT[normalizedPlan];
  if (!posts.length) return { checks: [], checkedTodayCount: 0, completedCount: 0, limit };
  const unlimited = limit === null;
  const history = unlimited ? { dailyDate: exposureToday(), dailyCount: 0, lastChecked: {} } : readExposureHistory(blogId);
  const remaining = unlimited ? posts.length : Math.max(0, limit - history.dailyCount);
  const selected = unlimited ? posts : [...posts]
    .sort((a, b) => (history.lastChecked[a.logNo] || 0) - (history.lastChecked[b.logNo] || 0))
    .slice(0, remaining);
  if (!unlimited && remaining === 0) log(`[검색노출] 오늘 등급 한도 ${limit}개를 모두 검사했어요`);
  const keys = await getAdminBlogSearchKeys();
  if (!keys) {
    log("[검색노출] 검색 API 키를 읽지 못해 노출 검사를 건너뜁니다");
    return { checks: selected.map(post => ({ ...post, exposed: null, rank: null })), checkedTodayCount: history.dailyCount, completedCount: posts.filter(post => history.lastChecked[post.logNo]).length, limit };
  }
  const checks: BlogExposureCheck[] = [];
  for (const post of selected) {
    const { logNo, title } = post;
    try {
      // ★핵심 키워드로 검색(제목 전체X). 실제 노출 순위와 맞추기 위해 의미 단어만 추린다.
      const query = extractSearchQuery(title);
      let rank: number | null = null;
      let exposed = false;
      let via = "";
      // ① 실제 통합검색(모바일 블로그탭) 순위 우선 — 사용자가 실제 보는 순서. 세션 context 있을 때.
      if (searchContext) {
        const real = await searchRealRank(searchContext, blogId, logNo, query, log);
        if (real.rank !== null) { rank = real.rank; exposed = true; via = "실검색"; }
        else if (real.total > 0) { exposed = false; via = `실검색 ${real.total}개 중 없음`; }
      }
      // ② 실검색에서 못 찾았고 개발자 API 키 있으면 보조 확인(참고용)
      if (rank === null && keys) {
        const url = `https://openapi.naver.com/v1/search/blog.json?query=${encodeURIComponent(query)}&display=100&start=1&sort=sim`;
        const response = await fetch(url, { headers: { "X-Naver-Client-Id": keys.clientId, "X-Naver-Client-Secret": keys.clientSecret } });
        if (response.ok) {
          const json: any = await response.json();
          const items: any[] = Array.isArray(json?.items) ? json.items : [];
          const index = items.findIndex(item => isTargetBlogSearchItem(item, blogId, logNo));
          if (index >= 0 && !via) { rank = index + 1; exposed = true; via = "API참고"; }
        }
      }
      let indexed: boolean | undefined = exposed ? true : undefined;
      let status: BlogExposureCheck["status"] = exposed ? "exposed" : undefined;
      const publishedMs = post.dateMs || (post.date ? new Date(`${post.date}T00:00:00+09:00`).getTime() : 0);
      const ageDays = publishedMs > 0 ? Math.floor((Date.now() - publishedMs) / 86400000) : NaN;
      if (!exposed && Number.isFinite(ageDays) && ageDays >= INDEX_GRACE_DAYS) {
        indexed = await checkBlogPostIndexed(blogId, logNo, title, keys);
        if (indexed === true) status = "low";
        else if (indexed === false) status = "missing";
        log(`[검색노출] 색인 2차 확인 · ${indexed === true ? "색인됨(순위 낮음)" : indexed === false ? "색인 누락" : "확인 불가"} · ${title.slice(0, 24)}`);
      }
      checks.push({ logNo, title, exposed, rank, indexed, status, postUrl: undefined });
      log(`[검색노출] "${query}" → ${rank !== null ? `${rank}위(${via})` : `노출 안됨(${via || "확인불가"})`} · ${title.slice(0, 24)}`);
    } catch (e: any) {
      log(`[검색노출] 확인 실패 · ${title.slice(0, 28)} (${e.message})`);
      checks.push({ logNo, title, exposed: null, rank: null });
    } finally {
      if (!unlimited) {
        history.dailyCount += 1;
        history.lastChecked[logNo] = Date.now();
        writeExposureHistory(blogId, history);
      }
    }
  }
  return { checks, checkedTodayCount: unlimited ? checks.length : history.dailyCount, completedCount: unlimited ? posts.length : posts.filter(post => history.lastChecked[post.logNo]).length, limit };
}

export async function checkSelectedBlogExposure(params: {
  accountId: string; plan?: string; logNos: string[]; onLog?: (msg: string) => void;
}): Promise<ExposureProgress & { totalPostsForExposure: number; lowQualitySuspected: boolean | null }> {
  const { accountId, plan = "free", onLog } = params;
  const log = onLog || console.log;
  let blogId = loadSession(accountId).blogId;
  const cookies = await ensureLiveSession(accountId, log);   // ★세션 만료면 저장된 비번으로 자동 재연결
  if (!blogId) throw new Error("내 블로그 ID를 찾을 수 없어요 — 계정을 다시 연결해주세요");
  // ★실제 blogId 확정(네이버ID≠blogId 대비) — 가벼운 fetch(창 안 뜸)
  blogId = await resolveBlogIdFast(blogId, cookies, accountId, log);
  const wanted = new Set((Array.isArray(params.logNos) ? params.logNos : []).map(String).filter(value => /^\d+$/.test(value)));
  if (!wanted.size) throw new Error("검색노출을 확인할 글을 선택해주세요");
  const list = await fetchNaverPostList({ blogId, cookies, maxCount: null, log });
  const selected = list.posts.filter(post => wanted.has(post.logNo)).map(post => ({ logNo: post.logNo, title: post.title, date: post.date, dateMs: post.dateMs }));
  if (!selected.length) throw new Error("선택한 글 정보를 다시 찾지 못했어요. 글 목록을 새로 불러와주세요");
  log(`[검색노출] 선택 ${selected.length}개 · ${plan} 등급 한도 적용 · 실제 통합검색 순위 확인`);
  // ★실제 통합검색 순위 확인용 browser context(세션 쿠키). 개발자 API보다 실제 노출 순위에 맞다.
  const exBrowser = await launchBrowser(accountId, { headless: true, log });
  const exContext = await exBrowser.newContext({ locale: "ko-KR" });
  await exContext.addCookies(cookies).catch(() => {});
  let progress;
  try {
    progress = await checkBlogExposure(blogId, selected, plan, log, exContext);
  } finally {
    await exBrowser.close().catch(() => {});
  }
  const known = progress.checks.filter(check => check.exposed !== null);
  const missing = known.filter(check => check.exposed === false).length;
  return { ...progress, totalPostsForExposure: list.totalCount || list.posts.length, lowQualitySuspected: known.length >= 3 ? missing / known.length > 0.5 : null };
}

/* ── 💬 블로그 댓글 제안 발송 (러프 버전 · 계정 안전 최우선) ──
   ⚠️ 모르는 블로거 글에 홍보 댓글 = 네이버 스팸/도배 감지 위험이 큼. 그래서:
   - 텀을 아주 길게(기본 40~90초), 하루 소량만(호출 측에서 제한)
   - 로그인 세션으로 각 블로거 최근 글을 열어 댓글창에 자연스럽게 작성
   - 실패해도 조용히 다음으로(도배로 오해받지 않게 무리한 재시도 안 함) */
export type CommentTarget = { id?: string; blogId: string; nick?: string; body: string };
export async function sendBlogComments(params: {
  accountId: string; ownerUserId?: string | null; targets: CommentTarget[];
  delayMinMs?: number; delayMaxMs?: number;
  onLog?: (m: string) => void; onSent?: (id: string | undefined, ok: boolean, error?: string, postUrl?: string) => Promise<void> | void; stopSignal?: () => boolean;
}): Promise<{ ok: number; fail: number }> {
  const { accountId, ownerUserId, targets, delayMinMs = 40000, delayMaxMs = 90000, onLog, onSent, stopSignal } = params;
  const log = onLog || console.log;
  const cookies = await ensureLiveSession(accountId, log);
  const MUA = "Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1";
  const browser = await launchBrowser(accountId, { headless: false, maximized: true, log, feature: "neighbor", ownerUserId });
  const context = await browser.newContext({ userAgent: MUA, viewport: { width: 390, height: 844 }, locale: "ko-KR", isMobile: true, hasTouch: true });
  await applyAntiDetection(context);
  await context.addCookies(cookies);
  const page = await context.newPage();
  let ok = 0, fail = 0;
  try {
    log("⚠️ 계정 안전을 위해 아주 천천히(40~90초 간격) 소량만 답니다. 창을 닫지 마세요.");
    for (let i = 0; i < targets.length; i++) {
      if (stopSignal?.()) { log("⏹️ 중단 요청 — 멈춰요"); break; }
      const t = targets[i];
      log(`💬 (${i + 1}/${targets.length}) ${t.nick || t.blogId} 블로그에 댓글 다는 중…`);
      try {
        const postUrl = await commentOnLatestPost(page, t.blogId, t.body, log);
        ok++; log(`   → ✅ 완료 (성공 ${ok} · 실패 ${fail})`);
        await onSent?.(t.id, true, undefined, postUrl);
      } catch (e: any) {
        fail++; const msg = (e?.message || String(e)).slice(0, 100);
        log(`   → ❌ 실패: ${msg}`); await onSent?.(t.id, false, msg);
      }
      if (i < targets.length - 1 && !stopSignal?.()) {
        const wait = delayMinMs + Math.random() * (delayMaxMs - delayMinMs);
        log(`   ⏳ 계정 보호를 위해 ${Math.round(wait / 1000)}초 대기…`);
        await page.waitForTimeout(wait);
      }
    }
  } finally { await browser.close().catch(() => {}); }
  return { ok, fail };
}
// 한 블로거의 최근 글을 열어 댓글 작성. 실패 시 throw.
async function commentOnLatestPost(page: import("playwright").Page, blogId: string, body: string, log: (m: string) => void): Promise<string> {
  // 최근 글 logNo 확보 — ★블로그 모바일 홈을 실제로 열어 렌더된 글 링크에서 추출(API 파싱보다 견고).
  let logNo = "";
  try {
    await page.goto(`https://m.blog.naver.com/${blogId}`, { waitUntil: "domcontentloaded", timeout: 25000 });
    await page.waitForTimeout(2200);
    logNo = await page.evaluate((id: string) => {
      const links = Array.from(document.querySelectorAll("a[href]")).map(a => (a as HTMLAnchorElement).href);
      for (const h of links) { const m = h.match(new RegExp(`(?:m\\.)?blog\\.naver\\.com/${id}/(\\d{9,})`)) || h.match(/[?&]logNo=(\d{9,})/); if (m) return m[1]; }
      return "";
    }, blogId).catch(() => "");
  } catch {}
  // 폴백: 공개 목록 API(구조 여러 형태 대응)
  if (!logNo) {
    try {
      logNo = await page.evaluate(async (id: string) => {
        try { const res = await fetch(`https://m.blog.naver.com/api/blogs/${id}/posts?categoryNo=0&itemCount=5&page=1`, { headers: { Referer: `https://m.blog.naver.com/${id}` } }); const raw = (await res.text()).replace(/^\)\]\}',?\s*/, ""); const j: any = JSON.parse(raw); const arr = j?.result?.items || j?.result?.postList || j?.items || j?.postList || []; const it = arr[0]; return it ? String(it.logNo || it.logno || it.postId || "") : ""; } catch { return ""; }
      }, blogId).catch(() => "");
    } catch {}
  }
  if (!logNo) throw new Error("최근 글을 찾지 못했어요(비공개이거나 글이 없을 수 있어요)");
  // 모바일 글 페이지 열기
  await page.goto(`https://m.blog.naver.com/${blogId}/${logNo}`, { waitUntil: "domcontentloaded", timeout: 25000 });
  await page.waitForTimeout(2500);
  // 댓글 영역으로 이동(댓글 버튼 클릭)
  for (const sel of ["a[href*='comment']", "button:has-text('댓글')", "[class*='comment'] a", ".btn_comment"]) {
    try { const b = page.locator(sel).first(); if (await b.count() && await b.isVisible()) { await b.click({ timeout: 3000 }); await page.waitForTimeout(1500); break; } } catch {}
  }
  // 댓글 입력창 찾기(에디터/텍스트영역)
  let wrote = false;
  const deadline = Date.now() + 8000;
  while (!wrote && Date.now() < deadline) {
    for (const sel of ["textarea[placeholder*='댓글']", "div[contenteditable='true'][class*='comment' i]", "textarea[class*='comment' i]", "div[contenteditable='true']", "textarea"]) {
      try {
        const el = page.locator(sel).first();
        if (await el.count() && await el.isVisible()) {
          await el.click(); await page.waitForTimeout(400);
          await el.type(body, { delay: 30 });
          wrote = true; break;
        }
      } catch {}
    }
    if (!wrote) await page.waitForTimeout(700);
  }
  if (!wrote) throw new Error("댓글 입력창을 찾지 못했어요(블로그가 댓글을 막았을 수 있어요)");
  await page.waitForTimeout(800);
  // 등록 버튼
  let submitted = false;
  for (const sel of ["button:has-text('등록')", "a:has-text('등록')", "button[class*='register' i]", "button[class*='submit' i]", "button[class*='comment'][class*='btn' i]"]) {
    try { const b = page.locator(sel).first(); if (await b.count() && await b.isVisible()) { await b.click({ timeout: 3000 }); submitted = true; await page.waitForTimeout(2000); break; } } catch {}
  }
  if (!submitted) throw new Error("댓글 등록 버튼을 찾지 못했어요");
  return `https://m.blog.naver.com/${blogId}/${logNo}`;   // 댓글 단 글 URL(보러가기용)
}

/* ── ✉️ 네이버 웹메일로 제안 메일 발송 (SMTP·앱비밀번호 불필요) ──
   서이추·공감처럼 로그인된 브라우저 창을 열어 사람처럼 메일을 쓴다.
   네이버가 SMTP를 막았어도(2단계+앱비번 강제) 웹메일 쓰기는 그대로 되므로, 회원은 아무 설정도 안 한다.
   ★UI가 바뀔 수 있어 받는사람/제목/본문 입력은 다중 셀렉터 폴백으로 견고하게. */
export type MailTarget = { id?: string; email: string; nick?: string; subject: string; body: string };
export async function sendWebmail(params: {
  accountId: string;
  ownerUserId?: string | null;
  fromName?: string;
  targets: MailTarget[];
  delayMinMs?: number;
  delayMaxMs?: number;
  onLog?: (msg: string) => void;
  onSent?: (id: string | undefined, ok: boolean, error?: string) => Promise<void> | void;
  stopSignal?: () => boolean;
}): Promise<{ ok: number; fail: number }> {
  const { accountId, ownerUserId, targets, delayMinMs = 3000, delayMaxMs = 6000, onLog, onSent, stopSignal } = params;
  const log = onLog || console.log;
  const cookies = await ensureLiveSession(accountId, log);   // 세션 만료면 자동 재연결(서이추와 동일)
  const browser = await launchBrowser(accountId, { headless: false, maximized: true, log, feature: "neighbor", ownerUserId });
  const context = await browser.newContext({ userAgent: UA, viewport: { width: 1280, height: 900 }, locale: "ko-KR" });
  await applyAntiDetection(context);
  await context.addCookies(cookies);
  const page = await context.newPage();
  let ok = 0, fail = 0;
  try {
    for (let i = 0; i < targets.length; i++) {
      if (stopSignal?.()) { log("⏹️ 중단 요청 — 발송을 멈춰요"); break; }
      const t = targets[i];
      log(`✉️ (${i + 1}/${targets.length}) ${t.nick || t.email} <${t.email}> 에게 쓰는 중…`);
      try {
        await sendOneWebmail(page, t);
        ok++;
        log(`   → ✅ 발송 완료 (성공 ${ok} · 실패 ${fail})`);
        await onSent?.(t.id, true);
      } catch (e: any) {
        fail++;
        const msg = (e?.message || String(e)).slice(0, 120);
        log(`   → ❌ 실패: ${msg}`);
        await onSent?.(t.id, false, msg);
      }
      if (i < targets.length - 1 && !stopSignal?.()) {
        const wait = delayMinMs + Math.random() * (delayMaxMs - delayMinMs);
        log(`   ⏳ 다음 발송까지 ${(wait / 1000).toFixed(1)}초 대기(계정 보호)…`);
        await page.waitForTimeout(wait);
      }
    }
  } finally {
    await browser.close().catch(() => {});
  }
  return { ok, fail };
}

// 메일 한 통을 네이버 웹메일 쓰기 화면에서 작성·전송. 실패 시 throw.
async function sendOneWebmail(page: import("playwright").Page, t: MailTarget): Promise<void> {
  // 새 편지 쓰기 화면으로. (여러 후보 URL — 네이버가 라우팅을 바꿔도 하나는 뜨게)
  const writeUrls = [
    "https://mail.naver.com/v2/new",
    "https://mail.naver.com/write",
    "https://mail.naver.com/#/write",
  ];
  let loaded = false;
  for (const u of writeUrls) {
    try {
      await page.goto(u, { waitUntil: "domcontentloaded", timeout: 20000 });
      await page.waitForTimeout(1800);
      // 받는사람 입력칸이 보이면 로드 성공
      const hasRecipient = await findFirst(page, RECIPIENT_SELECTORS, 4000);
      if (hasRecipient) { loaded = true; break; }
    } catch {}
  }
  if (!loaded) throw new Error("메일 쓰기 화면을 열지 못했어요(네이버 로그인 만료 또는 화면 변경)");

  // 1) 받는사람 — ★기존에 남아있던 수신자(이전 작성 잔재 등)를 먼저 다 지우고, 정확히 이 주소만 넣는다.
  const recip = await findFirst(page, RECIPIENT_SELECTORS, 5000);
  if (!recip) throw new Error("받는사람 입력칸을 찾지 못했어요");
  await recip.click();
  await page.waitForTimeout(200);
  // ① 기존 수신자 태그 제거: × 버튼이 있으면 다 클릭(최대 12개), 안 되면 키보드로 정리
  for (let g = 0; g < 12; g++) {
    const del = await page.$('[class*="recipient" i] button[class*="delete" i], [class*="recipient" i] button[class*="remove" i], [class*="recipient" i] [class*="btn_delete" i], [class*="to" i] button[aria-label*="삭제"]');
    if (!del) break;
    try { await del.click({ timeout: 800 }); await page.waitForTimeout(150); } catch { break; }
  }
  // ② 남은 텍스트/태그를 키보드로도 정리(맨 뒤로 가서 backspace 반복 — 남은 태그·글자 제거)
  try { await recip.click(); await page.keyboard.press("End"); for (let k = 0; k < 12; k++) await page.keyboard.press("Backspace"); } catch {}
  await page.waitForTimeout(200);
  // ③ 정확한 주소 입력 후, 자동완성 목록(같은 주소가 여러 개 떠도)에서 엉뚱한 항목이 선택되지 않게
  //    Enter(하이라이트 선택) 대신 쉼표로 '입력한 텍스트 그대로' 태그화한다.
  await recip.type(t.email, { delay: 25 });
  await page.waitForTimeout(500);
  await page.keyboard.press("Escape");   // 자동완성 드롭다운 닫기(잘못 선택 방지)
  await page.waitForTimeout(120);
  await page.keyboard.type(",");          // 쉼표 = 입력한 주소 그대로 확정(자동완성 무시)
  await page.waitForTimeout(300);
  // ④ 검증: 실제로 이 주소가 받는사람에 들어갔는지 확인(엉뚱한 주소면 실패 처리)
  const recipOk = await page.evaluate((email: string) => document.body.innerText.includes(email), t.email).catch(() => true);
  if (!recipOk) throw new Error(`받는사람에 ${t.email}이(가) 안 들어갔어요(자동완성 오선택 의심)`);

  // 2) 제목
  const subj = await findFirst(page, SUBJECT_SELECTORS, 4000);
  if (!subj) throw new Error("제목 입력칸을 찾지 못했어요");
  await subj.click();
  await subj.fill("");
  await subj.type(t.subject, { delay: 10 });
  await page.waitForTimeout(300);

  // 3) 본문 — 에디터가 iframe(SmartEditor)이거나 contenteditable일 수 있어 둘 다 시도
  const bodyWritten = await writeMailBody(page, t.body);
  if (!bodyWritten) throw new Error("본문 입력 영역을 찾지 못했어요");
  await page.waitForTimeout(400);

  // 4) 보내기 버튼
  const sendBtn = await findFirst(page, SEND_SELECTORS, 5000);
  if (!sendBtn) throw new Error("보내기 버튼을 찾지 못했어요");
  await sendBtn.click();
  // 전송 완료 대기: '보내기' 버튼이 사라지거나 완료 문구가 뜰 때까지
  await page.waitForTimeout(2500);
}

// 여러 셀렉터 후보 중 먼저 보이는 요소를 반환(없으면 null). 프레임 안까지 훑는다.
async function findFirst(page: import("playwright").Page, selectors: string[], timeoutMs: number) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    for (const sel of selectors) {
      // 메인 페이지
      const el = page.locator(sel).first();
      try { if (await el.isVisible({ timeout: 200 })) return el; } catch {}
    }
    // 프레임들도 확인(에디터가 iframe인 경우)
    for (const fr of page.frames()) {
      for (const sel of selectors) {
        try { const el = fr.locator(sel).first(); if (await el.isVisible({ timeout: 150 })) return el; } catch {}
      }
    }
    await page.waitForTimeout(250);
  }
  return null;
}

// 본문 입력: SmartEditor iframe(body[contenteditable]) 우선, 없으면 페이지 내 contenteditable/textarea
async function writeMailBody(page: import("playwright").Page, body: string): Promise<boolean> {
  // 1) iframe 에디터
  for (const fr of page.frames()) {
    for (const sel of BODY_SELECTORS) {
      try {
        const el = fr.locator(sel).first();
        if (await el.isVisible({ timeout: 200 })) { await el.click(); await el.type(body, { delay: 4 }); return true; }
      } catch {}
    }
  }
  // 2) 메인 페이지 에디터
  for (const sel of BODY_SELECTORS) {
    try {
      const el = page.locator(sel).first();
      if (await el.isVisible({ timeout: 200 })) { await el.click(); await el.type(body, { delay: 4 }); return true; }
    } catch {}
  }
  return false;
}

// 네이버 메일 UI 변화 대비 셀렉터 후보(넓게)
const RECIPIENT_SELECTORS = [
  "input[placeholder*='받는사람']", "input[placeholder*='이메일']", "input[name='to']",
  "input[id*='recipient' i]", "input[class*='recipient' i]", "input[aria-label*='받는사람']",
  "div[class*='recipient'] input", "input[type='text'][class*='to' i]",
];
const SUBJECT_SELECTORS = [
  "input[placeholder*='제목']", "input[name='subject']", "input[id*='subject' i]",
  "input[class*='subject' i]", "input[aria-label*='제목']", "input[title*='제목']",
];
const BODY_SELECTORS = [
  "body[contenteditable='true']", "div[contenteditable='true']", ".se-content [contenteditable='true']",
  "textarea[name='content']", "textarea[class*='body' i]", "[class*='editor'] [contenteditable='true']",
];
const SEND_SELECTORS = [
  "button:has-text('보내기')", "a:has-text('보내기')", "button[class*='send' i]",
  "button[id*='send' i]", "[role='button']:has-text('보내기')", "button[title*='보내기']",
];

// 🩺 P4: 글별 조회수 수집 — 네이버 블로그통계 '조회수 순위(PV)' 페이지(admin.blog.naver.com/{blogId}/stat/rank_pv)를
//   로그인 세션으로 열어 [순위·제목·조회수] 표를 읽는다. (크롬확장과 동일한 DOM 파싱 방식, 회원은 아무것도 안 함)
export type PostView = { logNo: string | null; title: string; views: number; rank: number | null };
export async function crawlPostViews(params: { accountId: string; onLog?: (m: string) => void }): Promise<PostView[]> {
  const { accountId, onLog } = params;
  const log = onLog || console.log;
  let blogId = loadSession(accountId).blogId;
  const cookies = await ensureLiveSession(accountId, log);   // 세션 만료면 자동 재연결
  if (!blogId) throw new Error("내 블로그 ID를 찾을 수 없어요 — 계정을 다시 연결해주세요");
  const browser = await launchBrowser(accountId, { headless: true, log });
  const context = await browser.newContext({ userAgent: UA, viewport: { width: 1280, height: 900 }, locale: "ko-KR" });
  await applyAntiDetection(context);
  await context.addCookies(cookies);
  const page = await context.newPage();
  blogId = await resolveBlogIdFast(blogId, cookies, accountId, log);
  let rows: PostView[] = [];
  try {
    log(`[조회수] 통계(조회수 순위) 수집 중... blogId=${blogId}`);
    // ★실제 통계 조회수 순위 페이지 = admin.blog.naver.com/{blogId}/stat/rank_pv (blog.stat.naver.com은 내부 iframe 도메인).
    //   유입검색어 수집에서 쓰던 admin 도메인과 동일 → 로그인 세션 그대로 통함.
    const urls = [
      `https://admin.blog.naver.com/${encodeURIComponent(blogId)}/stat/rank_pv`,
      `https://admin.blog.naver.com/${encodeURIComponent(blogId)}/stat/rank_pv.naver`,
      `https://blog.stat.naver.com/stat/rank_pv?blogId=${encodeURIComponent(blogId)}`,
    ];
    for (const u of urls) {
      try {
        await page.goto(u, { waitUntil: "domcontentloaded", timeout: 20000 }).catch(() => {});
        await page.waitForTimeout(3000);   // SPA(통계 위젯) 렌더 대기 — 표가 늦게 그려짐
        // 페이지의 모든 프레임에서 [순위/제목/조회수] 헤더를 가진 표를 찾아 파싱
        for (const fr of page.frames()) {
          const parsed: PostView[] = await fr.evaluate(() => {
            const clean = (t: string) => (t || "").replace(/ /g, " ").replace(/\s+/g, " ").trim();
            const headerKey = (txt: string) => {
              const s = clean(txt).toLowerCase();
              if (/^(순위|랭킹)$/.test(s)) return "rank";
              if (/^(제목|게시물|포스트)$/.test(s)) return "title";
              if (/^(조회수|pv)$/.test(s)) return "views";
              return "";
            };
            const tables = Array.from(document.querySelectorAll("table"));
            for (const table of tables) {
              const ths = Array.from(table.querySelectorAll("thead th, tr th")).map(th => clean((th as HTMLElement).textContent || ""));
              const map: Record<string, number> = {};
              ths.forEach((h, i) => { const k = headerKey(h); if (k && map[k] === undefined) map[k] = i; });
              if (map.title === undefined || map.views === undefined) continue;
              const out: { logNo: string | null; title: string; views: number; rank: number | null }[] = [];
              const trs = Array.from(table.querySelectorAll("tbody tr"));
              for (const tr of trs) {
                const tds = Array.from(tr.querySelectorAll("td, th")) as HTMLElement[];
                if (!tds.length) continue;
                const cellText = (i: number) => (i != null && tds[i] ? clean(tds[i].textContent || "") : "");
                const title = cellText(map.title);
                if (!title) continue;
                const views = Number(cellText(map.views).replace(/[^\d]/g, "")) || 0;
                const rankStr = map.rank != null ? cellText(map.rank).replace(/[^\d]/g, "") : "";
                let logNo: string | null = null;
                const a = map.title != null && tds[map.title] ? tds[map.title].querySelector("a[href]") : null;
                if (a) { const h = a.getAttribute("href") || ""; const m = h.match(/logNo=(\d+)/) || h.match(/\/(\d{9,})/); if (m) logNo = m[1]; }
                out.push({ logNo, title, views, rank: rankStr ? Number(rankStr) : null });
              }
              if (out.length) return out;
            }
            return [];
          }).catch(() => [] as PostView[]);
          if (Array.isArray(parsed) && parsed.length) { rows = parsed; break; }
        }
        if (rows.length) { log(`[조회수] ✅ ${u.split("?")[0]} 에서 ${rows.length}개 표 발견`); break; }
        // 이 URL에선 표를 못 찾음 — 진단: 현재 URL·표 개수·본문 앞부분을 남긴다(다음에 0개면 원인 바로 파악)
        const diag = await page.evaluate(() => ({ url: location.href, tables: document.querySelectorAll("table").length, frames: window.frames.length, snippet: (document.body?.innerText || "").replace(/\s+/g, " ").slice(0, 120) })).catch(() => null);
        if (diag) log(`[조회수] ⚠️ ${u.split("?")[0]} 표 못 찾음 → 실제URL=${diag.url} 표${diag.tables}개 프레임${diag.frames}개 · "${diag.snippet}"`);
      } catch (e: any) { log(`[조회수] ⚠️ ${u.split("?")[0]} 접근 오류: ${String(e?.message || e).slice(0, 80)}`); }
    }
    log(`[조회수] ${rows.length}개 글 조회수 수집 완료`);
  } finally {
    await browser.close().catch(() => {});
  }
  return rows;
}

export async function crawlBlogStats(params: {
  accountId: string;
  plan?: string;
  onLog?: (msg: string) => void;
}): Promise<BlogStats> {
  const { accountId, plan = "free", onLog } = params;
  const log = onLog || console.log;
  let blogId = loadSession(accountId).blogId;
  const cookies = await ensureLiveSession(accountId, log);   // ★세션 만료면 저장된 비번으로 자동 재연결
  if (!blogId) throw new Error("내 블로그 ID를 찾을 수 없어요 — 계정을 다시 연결해주세요");

  const browser = await launchBrowser(accountId, { headless: true, log });
  const context = await browser.newContext({ userAgent: UA, viewport: { width: 1280, height: 900 }, locale: "ko-KR" });
  await applyAntiDetection(context);
  await context.addCookies(cookies);
  const page = await context.newPage();
  // ★진단 시작 시 실제 blogId 확정(네이버ID≠blogId 대비). 교정되면 세션에 저장돼 이후 모든 탭이 정확한 값 공유.
  blogId = await resolveBlogIdFast(blogId, cookies, accountId, log);
  let totalPosts = 0, neighbors = 0;
  const recentDates: string[] = [];
  let exposurePosts: ExposurePost[] = [];
  let postListSource: "api" | "rss" | "none" = "none";
  let exposureChecks: BlogExposureCheck[] = [];
  let visitorDays: BlogVisitorDay[] = [];
  let inflowKeywords: { keyword: string; count?: number }[] = [];
  let checkedTodayCount = 0, exposureCompletedCount = 0;
  let exposureLimit: number | null = EXPOSURE_DAILY_LIMIT[Object.prototype.hasOwnProperty.call(EXPOSURE_DAILY_LIMIT, plan) ? plan : "free"];
  try {
    log(`[건강검진] 내 블로그(${blogId}) 지표 수집 중...`);
    // 1) 이웃 수 — 프로필/버디 위젯 Ajax
    try {
      await page.goto(`https://blog.naver.com/BuddyMe.naver?blogId=${blogId}`, { waitUntil: "domcontentloaded", timeout: 15000 }).catch(() => {});
      const body = await page.content();
      const m = body.match(/이웃[^\d]{0,6}([\d,]+)\s*명/) || body.match(/buddyCnt["'\s:]+([\d,]+)/);
      if (m) neighbors = parseInt(m[1].replace(/,/g, ""), 10) || 0;
    } catch {}
    // 2) 총 게시글 수 + 최근 글 날짜 — 글 목록 페이지
    await page.goto(`https://blog.naver.com/PostList.naver?blogId=${blogId}&categoryNo=0&currentPage=1&widgetTypeCall=true`, { waitUntil: "domcontentloaded", timeout: 20000 }).catch(() => {});
    await page.waitForTimeout(1200);
    const frame = page.frames().find(f => f.name() === "mainFrame") ?? page.frames().find(f => f.url().includes("blog.naver.com")) ?? null;
    const ctx: any = frame ?? page;
    const data = await ctx.evaluate((bid: string) => {
      const txt = document.body.innerText || "";
      // "전체보기 (1,234)" 형태에서 총 글 수
      let total = 0;
      const tm = txt.match(/전체\s*보기?\s*\(?\s*([\d,]+)\s*\)?/) || txt.match(/전체글\s*([\d,]+)/);
      if (tm) total = parseInt(tm[1].replace(/,/g, ""), 10) || 0;
      // 최근 글 날짜들
      const dates: string[] = [];
      document.querySelectorAll("[class*='date'],[class*='se_date'],[class*='time']").forEach(el => {
        const t = (el.textContent || "").trim();
        const dm = t.match(/(\d{4})[.\-\s]+(\d{1,2})[.\-\s]+(\d{1,2})/);
        if (dm && dates.length < 30) dates.push(`${dm[1]}-${dm[2].padStart(2, "0")}-${dm[3].padStart(2, "0")}`);
      });
      const posts: { logNo: string; title: string }[] = [], seenPosts = new Set<string>();
      const links = Array.from(document.querySelectorAll("a[href*='logNo='],a[href*='/PostView'],a[href*='" + bid + "/']"));
      for (const el of links) {
        const href = (el as HTMLAnchorElement).href || "";
        const post = href.match(/logNo=(\d+)/) || href.match(new RegExp(bid + "\\/(\\d{6,})"));
        const t = (el.textContent || "").replace(/\s+/g, " ").trim();
        if (post && !seenPosts.has(post[1]) && t.length >= 4 && t.length <= 200) {
          seenPosts.add(post[1]); posts.push({ logNo: post[1], title: t });
        }
      }
      return { total, dates, posts };
    }, blogId).catch(() => ({ total: 0, dates: [], posts: [] }));
    totalPosts = data.total;
    recentDates.push(...data.dates);
    exposurePosts = data.posts;
    // 공식 비동기 글목록 API가 1순위. 실패하면 헬퍼 내부 RSS, 그마저 실패하면 위 HTML 결과를 유지한다.
    try {
      const postList = await fetchNaverPostList({ blogId, cookies, maxCount: null, log });
      postListSource = postList.source;
      if (postList.posts.length) {
        exposurePosts = postList.posts.map(post => ({ logNo: post.logNo, title: post.title }));
        recentDates.splice(0, recentDates.length, ...postList.posts.map(post => post.date).filter(Boolean).slice(0, 30));
        totalPosts = Math.max(totalPosts, postList.totalCount, postList.posts.length);
      }
    } catch (e: any) { log(`[글목록] API/RSS 처리 실패 (${e.message}) · HTML 결과 유지`); }
    log(`[건강검진] 총 글 ${totalPosts}개 · 최근 날짜 ${recentDates.length}개 수집`);

    try {
      // API/RSS가 모두 막힌 경우에만 기존 HTML 페이지 파싱을 최종 폴백으로 사용한다.
      const seenExposure = new Set(exposurePosts.map(post => post.logNo));
      const expectedPages = totalPosts > 0 ? Math.ceil(totalPosts / Math.max(1, exposurePosts.length || 5)) + 2 : 100;
      for (let pg = 2; postListSource === "none" && pg <= expectedPages && (totalPosts <= 0 || exposurePosts.length < totalPosts); pg++) {
        try {
          await page.goto(`https://blog.naver.com/PostList.naver?blogId=${blogId}&categoryNo=0&currentPage=${pg}&widgetTypeCall=true`, { waitUntil: "domcontentloaded", timeout: 15000 });
          await page.waitForTimeout(500);
          const listFrame = page.frames().find(f => f.name() === "mainFrame") ?? page.frames().find(f => f.url().includes("blog.naver.com")) ?? null;
          const listCtx: any = listFrame ?? page;
          const pagePosts: ExposurePost[] = await listCtx.evaluate((bid: string) => {
            const out: { logNo: string; title: string }[] = [], seen = new Set<string>();
            const links = Array.from(document.querySelectorAll("a[href*='logNo='],a[href*='/PostView'],a[href*='" + bid + "/']"));
            for (const el of links) {
              const href = (el as HTMLAnchorElement).href || "";
              const match = href.match(/logNo=(\d+)/) || href.match(new RegExp(bid + "\\/(\\d{6,})"));
              const title = (el.textContent || "").replace(/\s+/g, " ").trim();
              if (match && !seen.has(match[1]) && title.length >= 4 && title.length <= 200) { seen.add(match[1]); out.push({ logNo: match[1], title }); }
            }
            return out;
          }, blogId).catch(() => []);
          let added = 0;
          for (const post of pagePosts) if (!seenExposure.has(post.logNo)) { seenExposure.add(post.logNo); exposurePosts.push(post); added++; }
          if (!pagePosts.length || added === 0) break;
        } catch { break; }
      }
      // 검색 API 호출은 별도 2단계(사용자가 글 선택 후)에만 수행한다.
      const normalizedPlan = Object.prototype.hasOwnProperty.call(EXPOSURE_DAILY_LIMIT, plan) ? plan : "free";
      exposureLimit = EXPOSURE_DAILY_LIMIT[normalizedPlan];
      if (exposureLimit !== null) {
        const history = readExposureHistory(blogId);
        checkedTodayCount = history.dailyCount;
        exposureCompletedCount = exposurePosts.filter(post => history.lastChecked[post.logNo]).length;
      }
      log(`[검색노출] 선택용 글 ${exposurePosts.length}개 확보 · 글 선택 후 별도로 검사하세요`);
    } catch (e: any) { log(`[검색노출] 검사 실패: ${e.message}`); }

    // ★방문자 수: 네이버 공개 방문자 위젯 API(NVisitorgp4Ajax) — 쿠키 없이 일별 방문자 XML을 준다(실측 2026-08-23).
    try {
      log("[방문자] 방문자 위젯에서 일별 방문자 수집 중...");
      const vres = await fetch(`https://blog.naver.com/NVisitorgp4Ajax.naver?blogId=${encodeURIComponent(blogId)}`, {
        headers: { "User-Agent": UA, Referer: `https://blog.naver.com/${blogId}` },
      });
      const vxml = await vres.text();
      const vdays: { date: string; visitors: number }[] = [];
      const vre = /<visitorcnt\s+id="(\d{8})"\s+cnt="(\d+)"/gi;
      let vm: RegExpExecArray | null;
      while ((vm = vre.exec(vxml))) {
        vdays.push({ date: `${vm[1].slice(0,4)}-${vm[1].slice(4,6)}-${vm[1].slice(6,8)}`, visitors: Number(vm[2]) || 0 });
      }
      if (vdays.length) visitorDays = vdays.sort((a, b) => a.date.localeCompare(b.date)).slice(-7);
      log(`[방문자] 일별 ${visitorDays.length}일 수집 완료`);
    } catch (e: any) { log(`[방문자] 위젯 확인 실패: ${e.message}`); }

    // ★이웃 수 1순위: 모바일 공개 API의 subscriberCount(=이웃/구독자 수, 실측 정확). 세션 불필요.
    //   (예전 BuddyPostList totalCount는 '최근 글 쓴 이웃'만 세어 실제와 크게 달랐음 — bb9653 실제 97인데 8로 뜸)
    try {
      const MUA = "Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1";
      const r = await fetch(`https://m.blog.naver.com/api/blogs/${encodeURIComponent(blogId)}`, { headers: { "User-Agent": MUA, Referer: `https://m.blog.naver.com/${blogId}` } });
      const j: any = JSON.parse((await r.text()).replace(/^\)\]\}',?\s*/, ""));
      const sub = Number(j?.result?.subscriberCount ?? j?.subscriberCount ?? 0);
      if (Number.isFinite(sub) && sub > 0) { neighbors = sub; log(`[이웃수] ${sub}명 (공개 API subscriberCount)`); }
    } catch (e: any) { log(`[이웃수] 공개 API 실패(${(e.message || "").slice(0, 25)}) · 세션 방식으로 재시도`); }

    // 폴백: 공개 API 실패 시 세션 방식(section.blog.naver.com 이웃API).
    if (neighbors <= 0) try {
      await page.goto("https://section.blog.naver.com/BlogHome.naver", { waitUntil: "domcontentloaded", timeout: 20000 }).catch(() => {});
      await page.waitForTimeout(800);
      const buddyInfo = await page.evaluate(async () => {
        try {
          const r = await fetch("https://section.blog.naver.com/ajax/BuddyPostList.naver?page=1&groupId=0", { headers: { Referer: "https://section.blog.naver.com/BlogHome.naver" } });
          const raw = await r.text();
          const d = JSON.parse(raw.replace(/^\)\]\}',?\s*/, ""));
          const result = d?.result || {};
          const total = Number(result.totalCount ?? result.buddyCount ?? result.totalBuddyCount ?? result.buddyTotalCount ?? result.pagination?.totalCount ?? d?.totalCount ?? 0) || 0;
          const list = result.buddyPostList || result.postList || result.list || [];
          const unique = Array.isArray(list) ? new Set(list.map((item: any) => item?.domainIdOrBlogId || item?.blogId).filter(Boolean)).size : 0;
          return { total, unique };
        } catch { return { total: 0, unique: 0 }; }
      }).catch(() => ({ total: 0, unique: 0 }));
      // ★buddyInfo.total(응답의 진짜 총 이웃수)만 신뢰한다. unique(최근 글 쓴 이웃 수)는 총수와 전혀 달라 쓰지 않는다.
      //   (예전엔 unique=7을 이웃수로 써서 실제 200+인데 7로 잘못 표시됐다 — 그래서 폴백도 안 탔음)
      if (buddyInfo.total > 0) neighbors = buddyInfo.total;

      // 총수를 못 얻으면 이웃 관리/프로필 페이지에서 총 이웃수를 직접 읽는다(세션 필요).
      if (neighbors <= 0) {
        const manageUrls = [
          `https://admin.blog.naver.com/${blogId}/buddy/BuddyListManage.naver`,
          `https://blog.naver.com/BuddyListManage.naver?blogId=${blogId}`,
          `https://m.blog.naver.com/BuddyList.naver?blogId=${blogId}`,
          `https://blog.naver.com/BuddyMe.naver?blogId=${blogId}`,
          `https://m.blog.naver.com/${blogId}`,
        ];
        for (const url of manageUrls) {
          try {
            await page.goto(url, { waitUntil: "domcontentloaded", timeout: 15000 });
            await page.waitForTimeout(500);
            const text = `${await page.locator("body").innerText().catch(() => "")}\n${await page.content()}`;
            const match = text.match(/(?:전체\s*이웃|서로이웃|이웃\s*수|이웃)[^\d]{0,20}([\d,]{1,7})\s*명/)
              || text.match(/"?(?:buddyCnt|buddyCount|totalBuddyCount|buddyAllCount|totalCount)"?\s*[:=]\s*"?([\d,]{1,7})/i);
            if (match) { const n = Number(match[1].replace(/,/g, "")) || 0; if (n > 0) { neighbors = n; break; } }
          } catch {}
        }
      }
      // 그래도 총수를 못 구하면 최소한 "확인된 최근활동 이웃 N명 이상"으로 참고값 제공(0보다 낫게)
      if (neighbors <= 0 && buddyInfo.unique > 0) neighbors = buddyInfo.unique;
      log(`[이웃수] ${neighbors > 0 ? `${neighbors}명 수집` : "확인 실패(진단은 계속)"}`);
    } catch {}

    // ★유입 검색어: 세션 필요(공개 불가). 이웃수처럼 로그인된 browser context 안에서 통계 유입분석 API를 fetch.
    try {
      log("[유입검색어] 통계 유입분석 수집 중...");
      await page.goto(`https://admin.blog.naver.com/${blogId}`, { waitUntil: "domcontentloaded", timeout: 15000 }).catch(() => {});
      const kws = await page.evaluate(async (bid: string) => {
        const urls = [
          `https://admin.blog.naver.com/api/blogs/${bid}/stats/inflow-search-keyword?range=DAILY`,
          `https://admin.blog.naver.com/api/blogs/${bid}/stats/keyword`,
          `https://blog.naver.com/RabbitAsync.naver?blogId=${bid}&countPerPage=10&type=inflow`,
        ];
        for (const u of urls) {
          try {
            const r = await fetch(u, { headers: { Referer: `https://admin.blog.naver.com/${bid}` } });
            const raw = await r.text();
            const j = JSON.parse(raw.replace(/^\)\]\}',?\s*/, ""));
            const arr = j?.result?.searchKeywordList || j?.result?.keywordList || j?.searchKeywords || (Array.isArray(j?.result) ? j.result : []);
            if (Array.isArray(arr) && arr.length) {
              return arr.slice(0, 5).map((x: any) => ({ keyword: String(x.keyword ?? x.searchKeyword ?? x.query ?? x.name ?? "").trim(), count: Number(x.count ?? x.cnt ?? x.pv ?? x.value ?? 0) || undefined })).filter((k: any) => k.keyword);
            }
          } catch {}
        }
        return [] as { keyword: string; count?: number }[];
      }, blogId).catch(() => [] as { keyword: string; count?: number }[]);
      if (Array.isArray(kws) && kws.length) inflowKeywords = kws;
      log(`[유입검색어] ${inflowKeywords.length}개 수집`);
    } catch (e: any) { log(`[유입검색어] 확인 실패: ${e.message}`); }

    if (false) {
      const statUrls = [`https://admin.blog.naver.com/${blogId}`];
      for (const statUrl of statUrls) {
        try {
          await page.goto(statUrl, { waitUntil: "domcontentloaded", timeout: 15000 });
          await page.waitForTimeout(900);
          const parsed = await page.evaluate(() => {
            const text = (document.body?.innerText || "").replace(/\u00a0/g, " ");
            const days: { date: string; visitors: number }[] = [];
            const seen = new Set<string>();
            const dateNumber = /(\d{4})[.\/-](\d{1,2})[.\/-](\d{1,2})[^\d]{0,20}([\d,]+)\s*(?:명|회)?/g;
            let m: RegExpExecArray | null;
            while ((m = dateNumber.exec(text)) && days.length < 14) {
              const date = `${m[1]}-${m[2].padStart(2,"0")}-${m[3].padStart(2,"0")}`;
              const visitors = Number(m[4].replace(/,/g, ""));
              if (!seen.has(date) && Number.isFinite(visitors)) { seen.add(date); days.push({ date, visitors }); }
            }
            const keywords: { keyword: string; count?: number }[] = [];
            const keywordRoots = Array.from(document.querySelectorAll("[class*='keyword'],[class*='searchword'],[class*='referer']"));
            for (const root of keywordRoots) {
              for (const row of Array.from(root.querySelectorAll("li,tr"))) {
                const t = (row.textContent || "").replace(/\s+/g, " ").trim();
                const km = t.match(/^(?:\d+[.)]?\s*)?(.{2,50}?)(?:\s+([\d,]+)(?:회|명|건)?)?$/);
                if (km && !keywords.some(k => k.keyword === km[1])) keywords.push({ keyword: km[1], ...(km[2] ? { count: Number(km[2].replace(/,/g,"")) } : {}) });
                if (keywords.length >= 5) break;
              }
              if (keywords.length >= 5) break;
            }
            return { days, keywords };
          });
          if (parsed.days.length > visitorDays.length) visitorDays = parsed.days;
          if (parsed.keywords.length > inflowKeywords.length) inflowKeywords = parsed.keywords;
          if (visitorDays.length >= 7 && inflowKeywords.length >= 3) break;
        } catch {}
      }
      visitorDays = visitorDays.sort((a, b) => a.date.localeCompare(b.date)).slice(-7);
      inflowKeywords = inflowKeywords.slice(0, 5);
    }
  } finally {
    await browser.close().catch(() => {});
  }
  const knownChecks = exposureChecks.filter(c => c.exposed !== null);
  const missing = knownChecks.filter(c => c.exposed === false).length;
  const lowQualitySuspected = knownChecks.length >= 3 ? missing / knownChecks.length > 0.5 : null;
  let visitorDrop: BlogStats["visitorDrop"] = null;
  if (visitorDays.length >= 2) {
    const prev = visitorDays[visitorDays.length - 2].visitors;
    const curr = visitorDays[visitorDays.length - 1].visitors;
    const rate = prev > 0 ? Math.round(((curr - prev) / prev) * 100) : null;
    visitorDrop = { detected: rate !== null && rate <= -30, rate, message: rate === null ? "전일 비교 불가" : rate <= -30 ? `전일 대비 ${Math.abs(rate)}% 급감` : `전일 대비 ${rate >= 0 ? "+" : ""}${rate}%` };
  }
  // ★발행 활성도: 최근 글 날짜로 마지막 발행 경과일 + 7일/30일 발행 수 → 활성/보통/비활성 판정(상위노출 핵심 지표)
  let activity: BlogStats["activity"] = null;
  {
    const now = Date.now();
    // ★KST 달력 날짜 기준(자정 넘으면 바로 +1일). 경과 '시간'이 아니라 '날짜 차이'로.
    const kstDayNum = (ms: number) => Math.floor((ms + 9 * 3600000) / 86400000);
    const todayNum = kstDayNum(now);
    const dayNums = recentDates.map(d => new Date(`${d}T00:00:00+09:00`).getTime()).filter(t => Number.isFinite(t) && t > 0).map(kstDayNum).sort((a, b) => b - a);
    if (dayNums.length) {
      const daysSinceLast = todayNum - dayNums[0];
      const postsIn7d = dayNums.filter(n => todayNum - n <= 7).length;
      const postsIn30d = dayNums.filter(n => todayNum - n <= 30).length;
      let level: "active" | "normal" | "inactive"; let message: string;
      if (daysSinceLast >= 14) { level = "inactive"; message = `${daysSinceLast}일째 새 글이 없어요 — 지수가 떨어지는 중. 지금 발행이 가장 급해요.`; }
      else if (postsIn7d >= 3) { level = "active"; message = `최근 7일 ${postsIn7d}개 발행 중 — 좋은 페이스예요. 이 꾸준함을 유지하세요.`; }
      else if (postsIn30d >= 4) { level = "normal"; message = `최근 30일 ${postsIn30d}개 — 나쁘지 않지만, 주 3회 이상이면 지수에 더 유리해요.`; }
      else { level = "inactive"; message = `발행이 뜸해요(30일 ${postsIn30d}개) — 꾸준히 올릴수록 상위노출에 유리해요.`; }
      activity = { level, daysSinceLast, postsIn7d, postsIn30d, message };
    }
  }
  return { blogId, totalPosts, neighbors, recentDates, exposureChecks, lowQualitySuspected, visitorDays, inflowKeywords, visitorDrop, activity, totalPostsForExposure: exposurePosts.length, checkedTodayCount, exposureCompletedCount, exposureLimit };
}

/* ── 답방 ①: 내 블로그 글 목록 불러오기 ──
   세션에 저장된 내 blogId로 최근 글을 수집. selectMode=count(최근 N개)/period(최근 N일)/all(전체). */
// 🌐 로그인 없이 블로그 아이디만으로 공개 글 목록 수집(PostTitleListAsync 공개 API).
//   내 글이든 남의 글이든 공개 글이면 아이디만으로 가져온다(계정 로그인 불필요·빠름).
export async function crawlPublicPosts(params: {
  blogId: string;
  count?: number;
  fromMs?: number;   // 시작일(epoch ms, 0=제한없음)
  toMs?: number;     // 종료일(epoch ms, 0=제한없음)
  onLog?: (msg: string) => void;
}): Promise<{ url: string; title: string; date: string }[]> {
  const { blogId, fromMs = 0, toMs = 0, onLog } = params;
  const log = onLog || console.log;
  const want = Math.max(1, params.count || 100);
  const ranged = !!(fromMs || toMs);
  log(`🌐 "${blogId}" 공개 글 목록 불러오는 중…(로그인 불필요)`);
  try {
    // ★검증본 재사용(reusable_assets 원칙): \' 이스케이프 처리·모바일 API 폴백·정확한 작성일(dateMs) 포함.
    //   따로 구현하다 \' 미처리로 JSON.parse가 죽어 0개 나오던 버그를 근본 제거(2026-09-04).
    const { posts } = await fetchNaverPostList({ blogId, cookies: [], maxCount: ranged ? null : want, log });
    let filtered = posts;
    if (fromMs) filtered = filtered.filter((p) => !p.dateMs || p.dateMs >= fromMs);
    if (toMs) filtered = filtered.filter((p) => !p.dateMs || p.dateMs <= toMs);
    const sliced = filtered.slice(0, want);
    log(`🌐 공개 글 ${sliced.length}개 수집 완료${ranged ? " (기간 필터 적용)" : ""}`);
    return sliced.map((p) => ({ url: p.url, title: p.title, date: p.date }));
  } catch (e: any) { log(`⚠️ 공개 글 수집 실패: ${e?.message || e}`); return []; }
}

export async function crawlMyPosts(params: {
  accountId: string;
  selectMode: "count" | "all" | "period";
  count: number;
  period: number;
  fromMs?: number;   // 시작일(epoch ms, 0=제한없음) — 날짜 지정 필터
  toMs?: number;     // 종료일(epoch ms, 0=제한없음)
  onLog?: (msg: string) => void;
}): Promise<{ url: string; title: string; date: string }[]> {
  const { accountId, selectMode, count, period, fromMs = 0, toMs = 0, onLog } = params;
  const log = onLog || console.log;
  if (!naverSessionExists(accountId)) throw new Error("세션 없음 — 먼저 로그인하세요");
  const { blogId: storedBlogId, cookies } = loadSession(accountId);
  if (!storedBlogId) throw new Error("내 블로그 ID를 찾을 수 없어요 — 계정을 다시 연결해주세요");
  // ★답방 글목록도 다른 기능처럼 진짜 blogId로 확정(이메일/네이버ID≠blogId 대비) — 이게 빠져서 ojy8404@naver.com로 404났음
  const blogId = await resolveBlogIdFast(storedBlogId, cookies, accountId, log);

  const limit = selectMode === "count" ? Math.max(1, count) : Number.MAX_SAFE_INTEGER;
  const cutoff = selectMode === "period" ? Date.now() - period * 86400000 : 0;

  const browser = await launchBrowser(accountId, { headless: true, log });
  const context = await browser.newContext({ userAgent: UA, viewport: { width: 1280, height: 900 }, locale: "ko-KR" });
  await applyAntiDetection(context);
  await context.addCookies(cookies);
  const page = await context.newPage();
  const out: { url: string; title: string; date: string; dateMs: number }[] = [];
  const seen = new Set<string>();
  try {
    log(`[답방] 내 블로그(${blogId}) 글 목록 불러오는 중...`);
    let sharedSource: "api" | "rss" | "none" = "none";
    try {
      const shared = await fetchNaverPostList({ blogId, cookies, maxCount: selectMode === "count" ? limit : null, log });
      sharedSource = shared.source;
      for (const post of shared.posts) {
        if (selectMode === "period" && post.dateMs && post.dateMs < cutoff) continue;
        out.push(post);
      }
    } catch (e: any) { log(`[답방] API/RSS 글목록 처리 실패 (${e.message}) · HTML로 재시도`); }
    for (let pg = 1; sharedSource === "none" && pg <= 15 && out.length < limit; pg++) {
      await page.goto(`https://blog.naver.com/PostList.naver?blogId=${blogId}&categoryNo=0&currentPage=${pg}&widgetTypeCall=true&topReferer=`, { waitUntil: "domcontentloaded", timeout: 20000 }).catch(() => {});
      await page.waitForTimeout(1000);
      const frame = page.frames().find(f => f.name() === "mainFrame") ?? page.frames().find(f => f.url().includes("blog.naver.com")) ?? null;
      const ctx: any = frame ?? page;
      const posts: { logNo: string; title: string; date: string }[] = await ctx.evaluate((bid: string) => {
        const res: { logNo: string; title: string; date: string }[] = [];
        const seenIds = new Set<string>();
        const links = Array.from(document.querySelectorAll("a[href*='logNo='], a[href*='/PostView'], a[href*='" + bid + "/']"));
        for (const a of links) {
          const href = (a as HTMLAnchorElement).href || "";
          const m = href.match(/logNo=(\d+)/) || href.match(new RegExp(bid + "\\/(\\d{6,})"));
          if (!m) continue;
          const logNo = m[1];
          if (seenIds.has(logNo)) continue;
          const title = (a.textContent || "").replace(/\s+/g, " ").trim();
          if (!title || title.length < 2 || title.length > 100) continue;
          seenIds.add(logNo);
          const container = a.closest("li,div[class*='post'],div[class*='item'],div[class*='list']");
          let date = "";
          const dEl = container?.querySelector("[class*='date'],[class*='time'],[class*='se_date']");
          if (dEl) date = (dEl.textContent || "").replace(/\s+/g, " ").trim().slice(0, 12);
          res.push({ logNo, title, date });
        }
        return res;
      }, blogId);
      if (!posts.length) break;
      let added = 0;
      for (const p of posts) {
        if (seen.has(p.logNo)) continue;
        seen.add(p.logNo);
        let dateMs = 0;
        const dm = p.date.match(/(\d{4})[.\-\s]+(\d{1,2})[.\-\s]+(\d{1,2})/);
        if (dm) dateMs = new Date(`${dm[1]}-${dm[2].padStart(2, "0")}-${dm[3].padStart(2, "0")}`).getTime();
        if (selectMode === "period" && dateMs && dateMs < cutoff) continue;
        out.push({ url: `https://blog.naver.com/${blogId}/${p.logNo}`, title: p.title, date: p.date, dateMs });
        added++;
        if (out.length >= limit) break;
      }
      if (added === 0 && pg > 1) break; // 더 없음
    }
    log(`[답방] 글 ${out.length}개 수집 완료`);
  } finally {
    await browser.close().catch(() => {});
  }
  let ranged = out;
  if (fromMs) ranged = ranged.filter((p) => !p.dateMs || p.dateMs >= fromMs);
  if (toMs) ranged = ranged.filter((p) => !p.dateMs || p.dateMs <= toMs);
  if (fromMs || toMs) log(`[답방] 기간 필터 후 ${ranged.length}개`);
  const sliced = selectMode === "count" ? ranged.slice(0, count) : ranged;
  return sliced.map(p => ({ url: p.url, title: p.title, date: p.date }));
}

/* ── 🛒 스마트스토어 상품 진단 ──
   스토어는 검증된 분석 자산이 없어 신설. 스마트스토어가 직접 fetch(429)를 막으므로 프록시+브라우저로 접근하고,
   네이버가 페이지에 심는 상태 객체(__PRELOADED_STATE__ 등)를 읽어 리뷰수·찜·평점·가격을 뽑는다(CSS 추측 대신 JSON).
   못 찾으면 상태 최상위 키를 진단 로그로 덤프해 첫 실행에서 실제 키를 확정한다(공유 버튼과 동일 자가교정 패턴). */
export async function diagnoseStore(params: { storeUrl: string; onLog?: (m: string) => void }): Promise<{ name: string; price: number; reviewCount: number | null; wishCount: number | null; rating: number | null; url: string }> {
  const { storeUrl, onLog } = params;
  const log = onLog || console.log;
  const url = storeUrl.trim();
  log(`🛒 스마트스토어 상품 정보 수집 중… (프록시+브라우저로 안전 접근)`);
  const browser = await launchBrowser(null, { headless: true, feature: "inflow", log });
  const context = await browser.newContext({ userAgent: INFLOW_MOBILE_UA, viewport: { width: 420, height: 900 }, locale: "ko-KR" });
  await applyAntiDetection(context);
  const page = await context.newPage();
  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 25000 }).catch(() => {});
    await page.waitForTimeout(2600);
    const data: any = await page.evaluate(() => {
      const out: any = { name: "", price: 0, reviewCount: null, wishCount: null, rating: null, keys: [] };
      const og = (p: string) => ((document.querySelector(`meta[property="${p}"]`) as any)?.content) || "";
      out.name = og("og:title") || document.title || "";
      const pa = (document.querySelector('meta[property="product:price:amount"]') as any)?.content;
      if (pa) out.price = Number(String(pa).replace(/[^\d]/g, "")) || 0;
      const st: any = (window as any).__PRELOADED_STATE__ || (window as any).__NEXT_DATA__ || null;
      if (st && typeof st === "object") { try { out.keys = Object.keys(st).slice(0, 30); } catch {} }
      const walk = (o: any, d: number) => {
        if (!o || d > 9 || typeof o !== "object") return;
        for (const k in o) {
          let v: any; try { v = o[k]; } catch { continue; }
          const lk = k.toLowerCase();
          if (typeof v === "number") {
            if (out.reviewCount == null && /(review).*(count|amount|total)|totalreview|reviewcnt/.test(lk)) out.reviewCount = v;
            if (out.wishCount == null && /(wish|interest|zzim).*count|wishcnt|interestcount/.test(lk)) out.wishCount = v;
            if (out.rating == null && v > 0 && v <= 5 && /(average|avg).*(score|rating)|reviewscore|scoreavg|ratingaverage/.test(lk)) out.rating = v;
            if (!out.price && /(disc|disp)?saleprice|salepriceamount|dispsaleprice/.test(lk)) out.price = v;
          } else if (v && typeof v === "object") walk(v, d + 1);
        }
      };
      try { walk(st, 0); } catch {}
      if (out.reviewCount == null) { const t = document.body.innerText || ""; const m = t.match(/(?:리뷰|구매평)\s*\(?\s*([\d,]+)/); if (m) out.reviewCount = Number(m[1].replace(/,/g, "")) || null; }
      return out;
    }).catch(() => ({ name: "", price: 0, reviewCount: null, wishCount: null, rating: null, keys: [] }));
    if (data.reviewCount == null) log(`  ⚙️ [진단] 리뷰수 위치 못 찾음 — 상태 최상위 키: ${(data.keys || []).join(", ") || "없음"}(개발자 확인)`);
    log(`🛒 수집 완료 — 리뷰 ${data.reviewCount ?? "?"} · 찜 ${data.wishCount ?? "?"} · 평점 ${data.rating ?? "?"} · 가격 ${data.price || "?"}`);
    return { name: data.name || "", price: data.price || 0, reviewCount: data.reviewCount, wishCount: data.wishCount, rating: data.rating, url };
  } finally {
    await browser.close().catch(() => {});
  }
}

/* ── 답방 ②: 내 글 댓글에 대댓글(답글) 달기 ──
   posts: 내 글 URL 배열. 각 글의 댓글을 훑어 (onlyNew면 아직 답글 없는 것만) 답글 작성.
   mode=ai면 댓글 내용을 읽고 Gemini로 답글 생성, fixed면 고정 문구. */
export async function replyToComments(params: {
  accountId: string;
  ownerUserId?: string;   // 프록시 회원 배정 fallback용
  posts: string[];
  mode: "ai" | "fixed";
  comment: string;
  tone: string;
  onlyNew: boolean;
  replyToReplies?: boolean;   // ★상대가 내 답글에 '대대댓글'로 또 말 걸면 딱 1번만 더 답한다(대대대답). 무한 사슬 방지 위해 원댓글당 내 답 2개면 정지.
  delayMin: number;
  delayMax: number;
  geminiKey?: string;
  onLog?: (msg: string) => void;
  onResult?: (r: { blogId?: string; postTitle?: string; status: "success" | "skip" | "fail"; message?: string }) => Promise<void>;
  onProgress?: (done: number, fail: number) => void;
  stopSignal?: () => boolean;
}): Promise<void> {
  const { accountId, ownerUserId, posts, mode, comment, tone, onlyNew, replyToReplies = false, delayMin, delayMax, geminiKey = "", onLog, onResult, onProgress, stopSignal } = params;
  const log = onLog || console.log;
  const cookies = await ensureLiveSession(accountId, log);   // ★세션 만료면 저장된 비번으로 자동 재연결(테리: "연결됨"인데 로그인풀림 방지)

  const browser = await launchBrowser(accountId, { headless: false, maximized: true, log, feature: "reply", ownerUserId });
  const context = await browser.newContext({ userAgent: UA, viewport: { width: 1280, height: 900 }, locale: "ko-KR" });
  await applyAntiDetection(context);
  await context.addCookies(cookies);
  const page = await context.newPage();
  await page.bringToFront().catch(() => {});   // ★크롬 창을 화면 앞으로
  let done = 0, fail = 0;

  // ── 답글 문구 만들기(원댓글·대대댓글 공용) ──
  const makeReplyText = async (commentText: string, author: string): Promise<string> => {
    if (mode === "ai") {
      let t = await generateAiReply(geminiKey, tone, commentText, author || "", log);
      if (!t) { t = pickFallbackReply(); log(`[답방] AI 답글 실패 → 순환 답글 사용: "${t}"`); }
      return t;
    }
    // 고정 답글: 여러 줄이면 줄마다 랜덤으로 번갈아(반복 방지). 비었으면 기본 인사.
    const lines = String(comment || "").split(/\r?\n/).map(s => s.trim()).filter(Boolean);
    return lines.length ? lines[Math.floor(Math.random() * lines.length)] : pickFallbackReply();
  };

  // ── 특정 댓글(원댓글이든 대댓글이든)에 답글 1개 달기. commentNo로 정확히 타겟. 성공 true ──
  //    ★네이버 댓글 위젯은 원댓글·대댓글 모두 같은 셀렉터 패턴을 씀(답글버튼 a.u_cbox_btn_reply[data-param],
  //      입력창 [id$=reply_textarea_{no}], 등록 [data-ui-selector=replyButton_{no}]) → 대대댓글에도 그대로 재사용.
  const postReply = async (ctx: any, commentNo: string, replyText: string, tag: string): Promise<boolean> => {
    // ① 답글 버튼 클릭(commentNo로 타겟) → 입력 영역 펼침
    const opened = await ctx.evaluate((cno: string) => {
      const btns = Array.from(document.querySelectorAll(`a.u_cbox_btn_reply[data-param='${cno}']`)) as HTMLElement[];
      const btn = btns.find(b => !b.classList.contains("u_cbox_btn_reply_on") && b.style.display !== "none") || btns[0];
      if (!btn) return false;
      btn.click();
      return true;
    }, commentNo).catch(() => false);
    if (!opened) { log(`[답방] ${tag} 답글 버튼 못찾음 — 스킵`); return false; }
    await page.waitForTimeout(1000);

    // ② 펼쳐진 답글 입력창(contenteditable, id가 …reply_textarea_{commentNo})에 타이핑
    const inputSel = `[id$='reply_textarea_${commentNo}']`;
    const inputEl = await ctx.$(inputSel);
    if (!inputEl) { log(`[답방] ${tag} 답글 입력창 못찾음 — 스킵`); return false; }
    try { await inputEl.scrollIntoViewIfNeeded({ timeout: 2000 }); } catch {}
    try { await inputEl.click({ force: true, timeout: 3000 }); }
    catch { const b = await inputEl.boundingBox(); if (b) await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2); }
    await page.waitForTimeout(400);
    await page.keyboard.press(process.platform === "darwin" ? "Meta+A" : "Control+A").catch(() => {});
    await page.keyboard.press("Backspace").catch(() => {});
    await humanType(page, naturalizeMsg(replyText));
    await page.waitForTimeout(500);
    const typedOk = await ctx.evaluate((sel: string) => {
      const el = document.querySelector(sel) as HTMLElement | null;
      return !!el && (el.textContent || "").trim().length > 0;
    }, inputSel).catch(() => false);
    if (!typedOk) { log(`[답방] ${tag} 답글 입력 실패 — 스킵`); return false; }

    // ③ 등록 버튼
    const submitted = await ctx.evaluate((cno: string) => {
      const btn = (document.querySelector(`[data-ui-selector='replyButton_${cno}']`)
        || document.querySelector(`button.u_cbox_btn_upload[data-action*='reply']`)) as HTMLElement | null;
      if (btn) { btn.click(); return true; }
      return false;
    }, commentNo).catch(() => false);
    await page.waitForTimeout(1500);
    return submitted;
  };

  try {
    for (const postUrl of posts) {
      if (stopSignal?.()) { log("[답방] 중단 신호 수신"); break; }
      try {
        log(`[답방] 글 진입: ${postUrl}`);
        // ★blog.naver.com은 무거운 iframe SPA — 느린 프록시에선 outer 'domcontentloaded'가 안 떠 매번 타임아웃(실측: 초반 성공 후 연속 실패).
        //   'commit'(응답 수신 즉시 진행)로 바꾸고, 실패 시 1회 재시도. 이후 스크롤·waitForSelector가 실제 준비를 확인한다.
        let navOk = false;
        for (let attempt = 0; attempt < 2 && !navOk; attempt++) {
          try { await page.goto(postUrl, { waitUntil: "commit", timeout: 30000 }); navOk = true; }
          catch (navErr: any) {
            if (attempt === 0) { log(`[답방] 진입 지연 — 재시도`); await page.waitForTimeout(1500); }
            else throw navErr;
          }
        }
        await page.waitForTimeout(1800);
        // commit 직후엔 iframe(mainFrame)이 아직 안 붙었을 수 있어 잠깐 대기(최대 ~5초)
        for (let i = 0; i < 10 && !page.frames().some(f => f.name() === "mainFrame" || f.url().includes("blog.naver.com")); i++) await page.waitForTimeout(500);
        const frame = page.frames().find(f => f.name() === "mainFrame") ?? page.frames().find(f => f.url().includes("blog.naver.com")) ?? null;
        const ctx: any = frame ?? page;
        const scrollInto = async (el: any) => { try { await el.evaluate((n: Element) => { const s = document.scrollingElement || document.documentElement; const r = n.getBoundingClientRect(); s.scrollTop = Math.max(0, s.scrollTop + r.top - window.innerHeight * 0.4); }); await page.waitForTimeout(300); } catch {} };

        // 댓글 위젯 로드
        for (let s = 0; s < 4; s++) { await page.mouse.wheel(0, 2500); await page.waitForTimeout(400); }
        for (const os of ["a.btn_comment._cmtList", "a._cmtList", "a.btn_comment", "a._floating_bottom_btn_comment"]) {
          const ob = await ctx.$(os); if (ob) { await scrollInto(ob); await ob.click({ timeout: 4000 }).catch(() => {}); await page.waitForTimeout(1500); break; }
        }
        await ctx.waitForSelector(".u_cbox_comment, li.u_cbox_comment, .u_cbox_list", { timeout: 6000 }).catch(() => {});

        // 이 글의 댓글 목록 파악 (작성자·내용·commentNo·이미 답글있는지)
        //  ★2026-08 실측: 답글 버튼 a.u_cbox_btn_reply[data-param='{commentNo}'], 입력창 id는 …__reply_textarea_{commentNo}(contenteditable),
        //    답글 등록 버튼 [data-ui-selector='replyButton_{commentNo}']. commentNo로 타겟해야 순번 어긋남이 없다(기존 idx 매칭 버그 제거).
        type ReplyItem = { commentNo: string; author: string; text: string; isMine: boolean };
        type CommentInfo = { commentNo: string; author: string; text: string; hasReply: boolean; replies: ReplyItem[] };
        const commentInfos: CommentInfo[] = await ctx.evaluate(() => {
          // 한 원댓글의 답글영역(u_cbox_reply_area) 안 대댓글들을 순서대로 수집.
          //  isMine=내가 쓴 답글(네이버는 본인 댓글에만 '삭제' 버튼을 노출 → 그걸로 판별).
          const parseReplies = (li: Element): { commentNo: string; author: string; text: string; isMine: boolean }[] => {
            const area = li.querySelector(".u_cbox_reply_area");
            if (!area) return [];
            return Array.from(area.querySelectorAll("li.u_cbox_comment")).map((r) => {
              const author = (r.querySelector(".u_cbox_nick")?.textContent || "").trim();
              const text = (r.querySelector(".u_cbox_contents")?.textContent || "").trim();
              const rBtn = r.querySelector("a.u_cbox_btn_reply[data-action='reply#toggle'], a.u_cbox_btn_reply");
              const commentNo = rBtn?.getAttribute("data-param") || "";
              const isMine = !!r.querySelector("a.u_cbox_btn_delete, a[data-action='comment#delete'], .u_cbox_btn_delete");
              return { commentNo, author, text, isMine };
            }).filter(x => x.text);
          };
          // 원댓글만: 대댓글(u_cbox_reply_area 안)은 제외
          const items = Array.from(document.querySelectorAll("li.u_cbox_comment")).filter(li => !li.closest(".u_cbox_reply_area"));
          const res: { commentNo: string; author: string; text: string; hasReply: boolean; replies: { commentNo: string; author: string; text: string; isMine: boolean }[] }[] = [];
          items.forEach((li) => {
            const author = (li.querySelector(".u_cbox_nick")?.textContent || "").trim();
            const text = (li.querySelector(".u_cbox_contents")?.textContent || "").trim();
            const replyBtn = li.querySelector("a.u_cbox_btn_reply[data-action='reply#toggle'], a.u_cbox_btn_reply");
            const commentNo = replyBtn?.getAttribute("data-param") || "";
            const hasReply = !!li.querySelector(".u_cbox_reply_area .u_cbox_comment, .u_cbox_reply_cnt");
            if (text && commentNo) res.push({ commentNo, author, text, hasReply, replies: parseReplies(li) });
          });
          return res;
        }).catch(() => []);

        if (!commentInfos.length) { log(`[답방] 댓글 없음, 스킵`); await onResult?.({ postTitle: postUrl, status: "skip", message: "댓글 없음" }); onProgress?.(done, fail); continue; }

        const targets = onlyNew ? commentInfos.filter(c => !c.hasReply) : commentInfos;
        log(`[답방] 댓글 ${commentInfos.length}개 중 답방 대상 ${targets.length}개${replyToReplies ? " (+ 대대댓글 1회 답)" : ""}`);

        // ── Phase 1: 원댓글에 답글 달기 ──
        for (const c of targets) {
          if (stopSignal?.()) break;
          const replyText = await makeReplyText(c.text, c.author);
          const submitted = await postReply(ctx, c.commentNo, replyText, `${c.author}님 원댓글`);
          if (submitted) { done++; log(`[답방] ✅ ${c.author}님 댓글에 답글: "${replyText}"`); await onResult?.({ postTitle: c.author, status: "success", message: replyText.slice(0, 30) }); }
          else { fail++; log(`[답방] ❌ ${c.author}님 원댓글 답글 실패`); await onResult?.({ postTitle: c.author, status: "fail", message: "등록 실패" }); }
          onProgress?.(done, fail);
          await page.waitForTimeout(humanDelay(delayMin, delayMax));
        }

        // ── Phase 2: 대대댓글 1왕복 답(옵션) ──
        //   상대가 내 답글에 다시 '대대댓글'을 달았으면 딱 1번만 더 답한다(대대대답).
        //   무한 사슬 방지: 한 원댓글의 답글영역에 '내 답글'이 이미 2개면(원답1 + 대대대답1) 더 안 함.
        //   판별: 답글영역 마지막 댓글이 '상대'(isMine=false)이고, 내 답글 수 < 2 → 그 대대댓글에 1회 답.
        if (replyToReplies) {
          for (const c of commentInfos) {
            if (stopSignal?.()) break;
            const replies = c.replies || [];
            if (!replies.length) continue;
            const myCount = replies.filter(r => r.isMine).length;
            const last = replies[replies.length - 1];
            // 답글영역에 내 답글이 하나라도 있어야(=내가 답방한 흐름) + 마지막이 상대 + 아직 2번 미만 + 타겟 번호 존재
            if (myCount >= 1 && myCount < 2 && !last.isMine && last.commentNo && last.text) {
              const replyText = await makeReplyText(last.text, last.author);
              const submitted = await postReply(ctx, last.commentNo, replyText, `${last.author}님 대대댓글`);
              if (submitted) { done++; log(`[답방] ✅ ${last.author}님 대대댓글에 1회 추가 답글: "${replyText}"`); await onResult?.({ postTitle: last.author, status: "success", message: "↩ " + replyText.slice(0, 28) }); }
              else { fail++; log(`[답방] ❌ ${last.author}님 대대댓글 답글 실패`); await onResult?.({ postTitle: last.author, status: "fail", message: "대대댓글 답글 실패" }); }
              onProgress?.(done, fail);
              await page.waitForTimeout(humanDelay(delayMin, delayMax));
            }
          }
        }
      } catch (e: any) {
        fail++; log(`[답방] 글 처리 오류: ${e.message}`); onProgress?.(done, fail);
      }
    }
    log(`[답방] 완료 — 답글 ${done}개 / 실패 ${fail}개`);
  } finally {
    await browser.close().catch(() => {});
  }
}
async function generateAiReply(key: string, tone: string, commentText: string, authorName: string, log: (m: string) => void): Promise<string> {
  if (!key) { log("[답방] Gemini 키 없음 — AI 답글 건너뜀"); return ""; }
  const toneGuide = tone === "담백" ? "깔끔하고 담백한" : tone === "짧게" ? "짧고 간결한" : "다정하고 따뜻한";
  // ★이름 오타 방지: 작성자 닉네임을 정확히 주고, 부를 거면 한 글자도 바꾸지 말라고 강하게 지시(테리→타리 같은 변형 방지).
  const nameRule = authorName
    ? `상대 닉네임은 정확히 "${authorName}" 야. 답글에서 상대를 부를 때는 반드시 "${authorName}"를 한 글자도 바꾸지 말고 그대로 써. 이름을 임의로 줄이거나 바꾸거나 새로 지어내지 마. 닉네임이 부르기 어색하면 차라리 이름을 부르지 말고 내용에만 반응해.`
    : `상대 닉네임을 모르니, 답글에 사람 이름·호칭을 지어내서 쓰지 말고 내용에만 반응해.`;
  const rStarters = ["고마움을 먼저 표하며", "상대 댓글에 되물으며", "공감하며", "가볍게 인사하며", "댓글 내용을 콕 집어", "반가움을 담아", "담담하게 한마디로"];
  const rHint = rStarters[Math.floor(Math.random() * rStarters.length)];
  const prompt = `너는 네이버 블로그 주인이야. 내 글에 아래 댓글이 달렸어. 이 댓글에 ${toneGuide} 말투로 고마움을 담은 자연스러운 한국어 답글을 딱 1개만 써줘.\n${nameRule}\n규칙: 1문장, 35자 이내, 댓글 내용에 구체적으로 반응, 이모지 1개 정도, 광고·링크 금지, 따옴표 없이 답글만 출력.\n★시작 표현 다양화: 이번 답글은 "${rHint}" 시작해줘. "와", "우와", "감사합니다"로만 매번 시작하지 말고 첫 단어를 다르게.\n\n[받은 댓글]\n${commentText}`;
  for (const model of GEMINI_MODELS) {
    try {
      // ★2.5계열 thinking 끄고 토큰 넉넉히 — 답글이 중간에 잘리는 것 방지
      const generationConfig: any = { maxOutputTokens: 800, temperature: 1.0 };
      if (model.startsWith("gemini-2.5")) generationConfig.thinkingConfig = { thinkingBudget: 0 };
      const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig }),
        signal: AbortSignal.timeout(12000),   // ★12초 넘게 응답 없으면 끊고 다음 모델/고정댓글로(무한 hang 방지)
      });
      const d: any = await r.json();
      // ★글쓰기와 동일: 429 한도 포함 어떤 실패든 다음 모델로 폴백(섣불리 포기 금지)
      if (!r.ok) { log(`[답방] ${model} 실패(${r.status}) → 다음 모델`); continue; }
      const cand = d?.candidates?.[0];
      const raw = cand?.content?.parts?.[0]?.text?.trim();
      if (!raw || cand?.finishReason === "MAX_TOKENS") { log(`[답방] ${model} 답글 잘림/빈응답 → 다음 모델`); continue; }
      const cleaned = raw.replace(/^["'\s]+|["'\s]+$/g, "").replace(/\s*[\r\n]+\s*/g, " ").replace(/\s{2,}/g, " ").trim().slice(0, 100);
      if (cleaned.length >= 3) return cleaned;
    } catch { log(`[답방] ${model} 응답 지연/오류 → 다음 모델`); }
  }
  log(`[답방] AI 모두 실패 → 고정 인사로 답글`);
  return "";
}

/* ── 품앗이 순환 매칭 이력: 같은 actor→target 조합 최근 방문시각 기록 ── */
const PUMASI_PAIRS_PATH = path.join(SESSION_DIR, "pumasi_pairs.json");
function loadPumasiPairs(): Record<string, number> {
  try { return fs.existsSync(PUMASI_PAIRS_PATH) ? JSON.parse(fs.readFileSync(PUMASI_PAIRS_PATH, "utf-8")) : {}; }
  catch { return {}; }
}
function savePumasiPairs(m: Record<string, number>) {
  try { fs.writeFileSync(PUMASI_PAIRS_PATH, JSON.stringify(m)); } catch {}
}
const PUMASI_PAIR_COOLDOWN_MS = 2 * 24 * 3600 * 1000; // 같은 조합 2일 쿨다운

/* ── 품앗이 댓글 이력: (actor→target) 조합마다 이미 댓글 단 글(logNo)을 저장 ──
   같은 글에 두 번 댓글 달지 않게(도배 방지). 최신→과거로 거슬러 올라가며 안 단 글에만 단다.
   파일 하나에 { "actorId>targetId": ["logNo", …] } 로 모아 관리. */
const PUMASI_COMMENTED_PATH = path.join(SESSION_DIR, "pumasi_commented.json");
function loadPumasiCommented(): Record<string, string[]> {
  try { return fs.existsSync(PUMASI_COMMENTED_PATH) ? JSON.parse(fs.readFileSync(PUMASI_COMMENTED_PATH, "utf-8")) : {}; }
  catch { return {}; }
}
function savePumasiCommented(m: Record<string, string[]>) {
  try { fs.writeFileSync(PUMASI_COMMENTED_PATH, JSON.stringify(m)); } catch {}
}

/* ── 품앗이 실행 로그: 효과 리포트용(대상 blogId가 언제 품앗이 방문을 받았는지 기록) ── */
const PUMASI_RUNS_PATH = path.join(SESSION_DIR, "pumasi_runs.json");
function appendPumasiRun(targetBlogId: string, actorBlogId: string) {
  try {
    const arr: { target: string; actor: string; ts: number }[] = fs.existsSync(PUMASI_RUNS_PATH) ? JSON.parse(fs.readFileSync(PUMASI_RUNS_PATH, "utf-8")) : [];
    arr.push({ target: targetBlogId, actor: actorBlogId, ts: Date.now() });
    // 90일 이전 로그는 정리(파일 비대 방지)
    const cutoff = Date.now() - 90 * 24 * 3600 * 1000;
    fs.writeFileSync(PUMASI_RUNS_PATH, JSON.stringify(arr.filter(r => r.ts >= cutoff)));
  } catch {}
}
// ★품앗이 시작 전 미리보기: 각 대상 계정의 총 글 수와, 이 계정을 향한 조합들이 이미 댓글 단 글 수를 요약해 반환.
//   (누가 얼마나 남았는지 눈으로 확인 → "이미 단 글은 건너뛴다"를 시작 전에 보여줌). 공개 API로 빠르게 총 글 수만 조회.
export async function pumasiPreview(accounts: { accountId: string; blogId: string }[], log: (m: string) => void = console.log): Promise<{ blogId: string; total: number; commented: number; remaining: number }[]> {
  const commentedAll = loadPumasiCommented();
  const res: { blogId: string; total: number; commented: number; remaining: number }[] = [];
  for (const target of accounts) {
    if (!target.blogId) continue;
    // 이 target을 향한 모든 (actor→target) 조합에서 이미 댓글 단 글(logNo) 합집합
    const doneSet = new Set<string>();
    for (const actor of accounts) {
      if (actor.accountId === target.accountId) continue;
      (commentedAll[`${actor.accountId}>${target.accountId}`] || []).forEach(l => doneSet.add(String(l)));
    }
    let total = 0;
    // maxCount=null(전체) → PostTitleListAsync는 첫 응답의 totalCount가 정확하고, 모바일 API/RSS 폴백 블로그는
    //   실제 글을 다 세어 정확한 총 글 수를 얻는다(1개만 가져와 "총 1"로 잘못 나오던 문제 해결).
    try { const list = await fetchNaverPostList({ blogId: target.blogId, cookies: [], maxCount: null, log }); total = Math.max(list.totalCount || 0, list.posts.length); }
    catch { total = 0; }
    const commented = doneSet.size;
    res.push({ blogId: target.blogId, total, commented, remaining: Math.max(0, total - commented) });
  }
  return res;
}

function pumasiRunsFor(targetBlogId: string): { actor: string; ts: number }[] {
  try {
    const arr: { target: string; actor: string; ts: number }[] = fs.existsSync(PUMASI_RUNS_PATH) ? JSON.parse(fs.readFileSync(PUMASI_RUNS_PATH, "utf-8")) : [];
    return arr.filter(r => r.target === targetBlogId).map(r => ({ actor: r.actor, ts: r.ts }));
  } catch { return []; }
}

// ── 품앗이 효과 리포트: 방문자 추이(위젯) + 일별 품앗이 방문 횟수 상관 ──
//   순위 상승을 품앗이 효과라고 단정하지 않고, 방문자·품앗이 실행일을 함께 보여줘 스스로 판단하게 함.
export async function crawlPumasiReport(blogId: string, log: (m: string) => void = console.log): Promise<{
  blogId: string;
  days: { date: string; visitors: number; pumasiVisits: number }[];
  totalReceived7d: number;
  avgWithPumasi: number | null;
  avgWithoutPumasi: number | null;
}> {
  const koDate = (ms: number) => new Date(ms + 9 * 3600 * 1000).toISOString().slice(0, 10);
  // 1) 방문자 위젯(최근 ~7일)
  const visitor: Record<string, number> = {};
  try {
    const vres = await fetch(`https://blog.naver.com/NVisitorgp4Ajax.naver?blogId=${encodeURIComponent(blogId)}`, { headers: { "User-Agent": UA, Referer: `https://blog.naver.com/${blogId}` } });
    const vxml = await vres.text();
    const vre = /<visitorcnt\s+id="(\d{8})"\s+cnt="(\d+)"/gi; let vm: RegExpExecArray | null;
    while ((vm = vre.exec(vxml))) visitor[`${vm[1].slice(0,4)}-${vm[1].slice(4,6)}-${vm[1].slice(6,8)}`] = Number(vm[2]) || 0;
  } catch (e: any) { log(`[리포트] 방문자 위젯 실패: ${e.message}`); }
  // 2) 일별 품앗이 방문 횟수
  const runs = pumasiRunsFor(blogId);
  const runsByDay: Record<string, number> = {};
  for (const r of runs) { const d = koDate(r.ts); runsByDay[d] = (runsByDay[d] || 0) + 1; }
  // 3) 최근 7일 병합
  const dates = Object.keys(visitor).sort();
  const days = dates.map(date => ({ date, visitors: visitor[date] || 0, pumasiVisits: runsByDay[date] || 0 }));
  const withP = days.filter(d => d.pumasiVisits > 0);
  const withoutP = days.filter(d => d.pumasiVisits === 0);
  const avg = (arr: typeof days) => arr.length ? Math.round(arr.reduce((s, d) => s + d.visitors, 0) / arr.length) : null;
  const totalReceived7d = days.reduce((s, d) => s + d.pumasiVisits, 0);
  log(`[리포트] ${blogId} — ${days.length}일 방문자·품앗이 상관 집계 완료`);
  return { blogId, days, totalReceived7d, avgWithPumasi: avg(withP), avgWithoutPumasi: avg(withoutP) };
}

/* ── 공감·댓글 작업 ── */
// ── 품앗이: 내 여러 계정끼리 서로 글에 공감·댓글 ──
//   각 계정(작성자)의 세션으로 로그인 상태에서, 나머지 계정(대상)의 blogId 글에 engageBlogs 호출.
//   계정별 postsPerBlog(대상 글 수)를 다르게 지정 가능. 세션은 이미 저장돼 있어 재로그인 불필요.
export async function pumasiEngage(params: {
  accounts: { accountId: string; blogId: string; posts: number; receiveLimit: number; noGive?: boolean }[];  // posts=줄 글 수(actor), receiveLimit=받을 수(0=안받기), noGive=안가기(남 방문 안 함)
  ownerUserId?: string;   // 품앗이 실행 회원 user_id (프록시 회원 배정 fallback용)
  comment: string;                 // 고정/순환(|||) 멘트
  doLike: boolean;
  doComment: boolean;
  aiComment: boolean;
  commentTone: string;
  geminiKey: string;
  delayMin: number;
  delayMax: number;
  readRelated?: boolean;   // ★관련 글 1편 더 읽기(체류·투데이↑)
  readRelatedMode?: "always" | "random";  // ★매번=각 대상 글마다 항상 / 가끔=확률 60%
  readSpeed?: ReadSpeed;   // ★체류 속도(fast/normal/natural)
  periodDays?: number;     // ★대상 글 기간 제한(최근 N일 이내 글만, 0/미지정=전체 무제한)
  searchEntry?: boolean;   // ★검색 경유 진입(검색 유입)
  searchKeyword?: string;  // ★검색 경유 시 사용할 키워드(내 글 목표 키워드). 없으면 blogId로 검색
  spreadHours?: number;    // ★시간 분산 큐: 방문을 N시간에 걸쳐 분산(0=즉시 연속)
  onLog?: (msg: string) => void;
  onResult?: (r: EngageResult & { actor?: string }) => Promise<void>;
  onProgress?: (done: number, fail: number, skip?: number) => void;
  stopSignal?: () => boolean;
}): Promise<void> {
  const { accounts, ownerUserId, comment, doLike, doComment, aiComment, commentTone, geminiKey, delayMin, delayMax, readRelated = true, readRelatedMode = "random", readSpeed = "natural", periodDays = 0, searchEntry = false, searchKeyword = "", spreadHours = 0, onLog, onResult, onProgress, stopSignal } = params;
  const log = onLog || console.log;
  let done = 0, fail = 0, skip = 0;
  // ★세션 상태를 계정별로 로그에 남긴다(크롬이 안 뜰 때 어느 계정이 문제인지 즉시 파악).
  const sessionState = accounts.map(a => ({ blogId: a.blogId || a.accountId, ok: !!(a.accountId && naverSessionExists(a.accountId)), hasBlog: !!a.blogId }));
  log(`[품앗이] 세션 확인 — ${sessionState.map(s => `${s.blogId}:${s.ok ? "세션OK" : "세션없음"}${s.hasBlog ? "" : "·blogId없음"}`).join(", ")}`);
  const valid = accounts.filter(a => a.accountId && a.blogId && naverSessionExists(a.accountId));
  if (valid.length < 2) {
    const bad = sessionState.filter(s => !s.ok).map(s => s.blogId).join(", ");
    throw new Error(`품앗이는 세션 연결된 계정이 2개 이상 필요해요. 연결이 풀린 계정을 다시 연결해주세요${bad ? ` (${bad})` : ""}.`);
  }
  // ★대상 글 주소가 네이버ID로 만들어져 '본문 못 읽음'이 나던 문제(네이버ID≠blogId, 예 bb9653≠system-b) 방지:
  //   각 계정의 진짜 blogId를 세션으로 확정해 둔다(품앗이는 내 계정끼리라 세션이 있어 확정 가능).
  for (const a of valid) {
    try { const ck = loadSession(a.accountId).cookies; const real = await resolveBlogIdFast(a.blogId, ck, a.accountId, log); if (real) a.blogId = real; } catch {}
  }
  log(`[품앗이] 시작 — 계정 ${valid.length}개가 서로 글에 공감·댓글`);
  // ★계정 순환 매칭: 이력을 보고 '아직 안 갔거나 가장 오래된' 조합을 우선 배정
  //   (고정된 계정끼리만 반복 소통하는 패턴↓). 같은 actor→target 조합은 2일 쿨다운.
  const pairs = loadPumasiPairs();
  const commentedAll = loadPumasiCommented();   // (actor→target)별 이미 댓글 단 글 이력(도배 방지·최신→과거)
  const now = Date.now();
  const pairKey = (a: string, t: string) => `${a}>${t}`;
  // ★★품앗이 로직(테리 확정):
  //   · 받기 M (receiveLimit) = 이 계정이 '몇 번 받을지'. 0이면 안 받음(방문 대상에서 제외).
  //   · 글 N (posts, actor 기준) = 방문한 계정이 상대 글 몇 개에 공감·댓글 남길지(주는 양).
  //   각 대상은 받기 수만큼 방문받고(최근 안 온 계정 우선), 방문자는 자기 글수(posts)만큼 준다.
  const visitPlan: { actor: typeof valid[number]; target: typeof valid[number] }[] = [];
  for (const target of valid) {
    const receiveLimit = target.receiveLimit ?? 3;   // 0이면 안 받음
    if (receiveLimit <= 0) { log(`[품앗이] ${target.blogId} — 받기 0으로 설정돼 방문받지 않음(건너뜀)`); continue; }
    // 후보 방문자(자기 제외, '안 가기' 계정 제외)를 '최근 안 온 순'으로 정렬 → 받기 수만큼 선정(고정 조합 반복↓)
    const cands = valid.filter(a => a.accountId !== target.accountId && !a.noGive)
      .map(a => ({ a, last: pairs[pairKey(a.accountId, target.accountId)] || 0 }))
      .sort((x, y) => x.last - y.last);
    for (const c of cands.slice(0, receiveLimit)) visitPlan.push({ actor: c.a, target });
  }
  // 같은 대상·같은 방문자가 연달아 오지 않도록 방문자별로 흩뿌림
  visitPlan.sort((p, q) => valid.indexOf(p.actor) - valid.indexOf(q.actor));

  // ★시간 분산 큐: 전체 방문을 spreadHours 시간에 걸쳐 고르게 분산(투데이·댓글 폭증 방지)
  const totalCombos = visitPlan.length;
  const spreadGapMs = spreadHours > 0 && totalCombos > 1 ? (spreadHours * 3600 * 1000) / totalCombos : 0;
  if (spreadGapMs > 0) log(`[품앗이] ⏰ 시간 분산: 총 ${totalCombos}회 방문을 약 ${spreadHours}시간에 걸쳐(방문 간 평균 ${Math.round(spreadGapMs/60000)}분) 진행`);
  log(`[품앗이] 순환 매칭 완료 — 이번엔 총 ${totalCombos}회 방문 예정(받을 수·쿨다운 반영)`);
  let comboIdx = 0;

  // ★프록시 격리: 참여 계정 중 하나라도 프록시가 배정돼 있으면 방문마다 그 계정 IP로 따로 브라우저를 띄운다.
  //   (공유 브라우저 하나로 돌면 모든 계정이 같은 IP로 나가 네이버가 한 사람으로 묶어 차단 — 프록시가 무의미).
  //   배정된 프록시가 전혀 없으면 기존처럼 공유 브라우저 하나로 돌린다(업체 연결 전 동작 그대로).
  const proxied = (await Promise.all(valid.map(a => getProxyForAccount(a.accountId, "pumasi", ownerUserId)))).some(Boolean);
  if (proxied) log("[품앗이] 🔒 프록시 격리 모드 — 방문마다 해당 계정의 IP로 접속합니다.");

  // ★안내 창: 대기 중에도 "진행 중"을 보여주는 창(방문 사이 대기에도 안 닫혀 "멈춘 것처럼" 안 보임).
  //   격리 모드에선 이 창은 안내 전용이고, 실제 방문은 계정별 브라우저가 따로 담당한다.
  const holdBrowser = await chromium.launch({ headless: false, args: [...LAUNCH_ARGS, "--start-maximized"] });
  const holdPage = await holdBrowser.newPage().catch(() => null);
  // 방문에 재사용할 공유 브라우저: 격리 모드가 아니면 안내 창과 같은 브라우저를 그대로 씀(기존 동작).
  const sharedBrowser: any = proxied ? null : holdBrowser;
  const showHold = async (msg: string) => {
    if (!holdPage) return;
    try {
      await holdPage.setContent(`<html><head><meta charset="utf-8"><style>body{margin:0;height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;font-family:-apple-system,'Malgun Gothic',sans-serif;background:linear-gradient(135deg,#fdf2f8,#fce7f3);color:#831843}h1{font-size:26px;margin:0 0 10px}p{font-size:15px;color:#9d174d;margin:4px}</style></head><body><h1>💞 품앗이 진행 중…</h1><p>${msg}</p><p style="color:#be185d;font-size:13px">이 창은 작업이 끝날 때까지 켜져 있어요. 닫지 마세요.</p></body></html>`);
      await holdPage.bringToFront().catch(() => {});
    } catch {}
  };
  await showHold("계정을 전환하며 서로의 글에 공감·댓글을 남기고 있어요.");

  try {
  for (const { actor, target } of visitPlan) {
    if (stopSignal?.()) { log("[품앗이] 중단 신호 수신"); break; }
    log(`[품앗이] ${actor.blogId} → ${target.blogId} 글 ${actor.posts}개에 ${doLike ? "공감" : ""}${doLike && doComment ? "+" : ""}${doComment ? "댓글" : ""}`);
    pairs[pairKey(actor.accountId, target.accountId)] = Date.now(); // 조합 방문시각 기록(쿨다운·순환용)
    savePumasiPairs(pairs);
    appendPumasiRun(target.blogId, actor.blogId);                   // 효과 리포트용 실행 로그
    try {
      // ★도배 방지: 이 (actor→target) 조합에서 이미 댓글 단 글은 제외 → 최신부터 안 단 글에만 단다(과거로 자동 진행)
      const ckey = `${actor.accountId}>${target.accountId}`;
      const commentedSet = new Set<string>(commentedAll[ckey] || []);
      await engageBlogs({
        accountId: actor.accountId,
        // 검색 경유 진입 시 목표 키워드로 검색(없으면 대상 blogId로 검색). 아니면 기존처럼 "품앗이"(URL 직행)
        targets: [{ keyword: searchEntry ? (searchKeyword.trim() || target.blogId) : "품앗이", blogId: target.blogId }],
        comment, doLike, doComment,
        periodDays: periodDays > 0 ? periodDays : 3650,   // 0=전체(무제한), 값 있으면 최근 N일 글만
        postsPerBlog: Math.max(1, actor.posts),   // ★주는 쪽(actor) 기준 — actor가 상대 글 이 개수만큼 댓글
        delayMin, delayMax,
        dailyLimit: 999999,
        skipDone: false,                // 서로 계속 달 수 있게(당일 중복방지는 아래 excludeLogNos가 담당)
        commentRate: 100, likeRate: 100,
        aiComment, commentTone, geminiKey, readRelated, readRelatedMode, readSpeed, searchEntry,
        sharedBrowser,   // ★공유 크롬 재사용(방문 사이에도 창 유지)
        proxyFeature: "pumasi",   // 품앗이 기능 토글 확인용(격리 모드일 때 actor 계정 프록시 적용)
        ownerUserId,   // 회원 프록시 배정 fallback 전달
        excludeLogNos: commentedSet,
        onCommented: (logNo) => { commentedSet.add(logNo); commentedAll[ckey] = [...commentedSet]; savePumasiCommented(commentedAll); },
        onLog: (m) => log(m),
        onResult: async (r) => { if (r.status === "success") done++; else if (r.status === "fail") fail++; else if (r.status === "skip") skip++; await onResult?.({ ...r, actor: actor.blogId }); onProgress?.(done, fail, skip); },
        stopSignal,
      });
    } catch (e: any) { fail++; log(`[품앗이] ${actor.blogId}→${target.blogId} 오류: ${e.message}`); onProgress?.(done, fail, skip); }

    // ★시간 분산: 다음 방문까지 계산된 간격만큼 대기(±30% 편차). 마지막 방문 뒤엔 대기 안 함.
    comboIdx++;
    if (spreadGapMs > 0 && comboIdx < totalCombos && !stopSignal?.()) {
      const wait = Math.round(spreadGapMs * (0.7 + Math.random() * 0.6));
      log(`[품앗이] ⏰ 다음 방문까지 ${Math.round(wait/60000)}분 ${Math.round((wait%60000)/1000)}초 대기(시간 분산)...`);
      await showHold(`다음 방문까지 잠시 쉬는 중이에요 (약 ${Math.round(wait/60000)}분). 자연스럽게 시간을 나눠 방문하고 있어요.`);
      const until = Date.now() + wait;
      while (Date.now() < until) { if (stopSignal?.()) break; await new Promise(r => setTimeout(r, Math.min(5000, until - Date.now()))); }
      await showHold("계정을 전환하며 서로의 글에 공감·댓글을 남기고 있어요.");
    }
  }
  } finally {
    // 격리 모드에선 방문 브라우저는 각 방문 종료 시 스스로 닫히므로 안내 창(holdBrowser)만 닫는다.
    // 비격리 모드에선 sharedBrowser === holdBrowser 이라 이 한 줄로 함께 닫힌다.
    await holdBrowser.close().catch(() => {});
  }
  log(`[품앗이] 완료 — 성공 ${done} / 스킵 ${skip} / 실패 ${fail}`);
}

export async function engageBlogs(params: {
  accountId: string;
  ownerUserId?: string;   // 프록시 회원 배정 fallback용
  targets: { keyword: string; blogId: string }[];
  comment: string;
  doLike: boolean;
  doComment: boolean;
  periodDays: number;        // 최근 N일 이내 글만
  postsPerBlog: number;      // 블로그당 최대 글 수
  delayMin: number;
  delayMax: number;
  dailyLimit: number;
  skipDone: boolean;
  commentRate?: number;   // 댓글 확률 % (0~100, 기본 100). 도배 감지 회피용
  likeRate?: number;      // 공감 확률 % (0~100, 기본 100)
  aiComment?: boolean;    // ★AI 자동 댓글: 글 내용을 읽고 Gemini로 매번 다른 댓글 생성
  commentTone?: string;   // AI 댓글 말투(담백/다정/짧게)
  geminiKey?: string;     // 사용자 Gemini API 키
  readRelated?: boolean;  // ★관련 글 1편 더 읽기: 각 대상 글 처리 직후 같은 블로그 다른 글 1편 정독(공감·댓글 없음)
  readRelatedMode?: "always" | "random";  // ★매번=각 대상 글마다 항상 1편 / 가끔=확률 60%
  excludeLogNos?: Set<string>;   // ★이미 댓글 단 글(logNo) 제외 → 최신→과거로 안 단 글에만 단다(품앗이 도배 방지)
  onCommented?: (logNo: string) => void;   // ★댓글 성공 시 그 글 logNo 통보(이력 저장용)
  readSpeed?: ReadSpeed;         // ★체류 속도(fast/normal/natural)
  sharedBrowser?: any;           // ★품앗이: 여러 방문이 크롬 창 하나를 공유(대기 중에도 창 유지). 있으면 이 browser 재사용·안 닫음
  proxyFeature?: string;         // 프록시 기능 토글용(engage=공감·댓글, pumasi=품앗이). 그 계정의 해당 기능이 켜져 있을 때만 프록시 적용
  minVisitors?: number;          // ★대상 블로그 최근 방문자 하한(0=제한없음) — 범위 밖이면 스킵
  maxVisitors?: number;          // ★대상 블로그 최근 방문자 상한(0=제한없음)
  searchEntry?: boolean;         // ★검색 경유 진입: 글에 URL직행 대신 네이버 검색→클릭(검색 유입 발생). 못 찾으면 URL 폴백
  onLog?: (msg: string) => void;
  onResult?: (r: EngageResult) => Promise<void>;
  onProgress?: (done: number, fail: number) => void;
  stopSignal?: () => boolean;
}): Promise<void> {
  const {
    accountId, targets, comment, doLike, doComment,
    periodDays, postsPerBlog, delayMin, delayMax,
    dailyLimit, skipDone, commentRate = 100, likeRate = 100,
    // ★readRelated 기본 false: 일반 공감·댓글(여러 블로그 순회)은 관련글 더 읽기를 켜지 않음(시간 급증 방지).
    //   품앗이(pumasiEngage)만 명시적으로 true를 넘겨 켠다.
    aiComment = false, commentTone = "다정", geminiKey = "", readRelated = false, readRelatedMode = "random", excludeLogNos, onCommented, readSpeed = "natural", sharedBrowser, proxyFeature, ownerUserId, minVisitors = 0, maxVisitors = 0, searchEntry = false, onLog, onResult, onProgress, stopSignal,
  } = params;
  const log = onLog || console.log;

  // 다중 댓글 파싱 (|||로 구분된 경우 순환 사용)
  const comments = comment.split("|||").map(c => c.trim()).filter(Boolean);
  if (comments.length === 0 && comment.trim()) comments.push(comment);
  let commentIdx = 0;

  const cookies = await ensureLiveSession(accountId, log);   // ★세션 만료면 저장된 비번으로 자동 재연결

  // 완료 기록 (서이추와 별도 파일)
  const engageDonePath = path.join(SESSION_DIR, `engage_done_${accountId}.json`);
  const doneMap = loadDoneMap(engageDonePath);   // { blogId: "YYYY-MM-DD" | "legacy" }
  const today = todayKST();

  const cutoff = Date.now() - periodDays * 24 * 60 * 60 * 1000;

  // ★품앗이는 sharedBrowser(공유 크롬)를 재사용 → 방문 사이 대기에도 창이 안 닫힌다. 없으면(공감·댓글 단독) 자체 생성.
  const ownBrowser = !sharedBrowser;
  const browser = sharedBrowser || await launchBrowser(accountId, { headless: false, maximized: true, log, feature: proxyFeature || "engage", ownerUserId });
  const context = await browser.newContext({
    userAgent: UA, viewport: { width: 1280, height: 800 }, locale: "ko-KR",
  });
  await applyAntiDetection(context);
  await context.addCookies(cookies);
  const page = await context.newPage();
  await page.bringToFront().catch(() => {});   // ★크롬 창을 화면 앞으로(백그라운드로 뜨는 것 방지)
  if (ownBrowser) log(`[공감·댓글] 🌐 작업용 크롬 창을 띄웠어요 (화면에 안 보이면 작업표시줄/독을 확인하세요)`);

  let done = 0;
  let fail = 0;
  let aiFallbackActive = false;   // ★AI 한도 소진 → 순환 댓글로 자동 전환된 상태(한 번 전환하면 이번 실행 내내 유지)

  try {
    // 키워드 교차 셔플
    const kwMap2 = new Map<string, typeof targets>();
    for (const t of targets) {
      if (!kwMap2.has(t.keyword)) kwMap2.set(t.keyword, []);
      kwMap2.get(t.keyword)!.push(t);
    }
    const shuffled2: typeof targets = [];
    const kwArrays2 = [...kwMap2.values()];
    for (const arr of kwArrays2) {
      for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
      }
    }
    const maxLen2 = Math.max(...kwArrays2.map(a => a.length));
    for (let i = 0; i < maxLen2; i++) {
      for (const arr of kwArrays2) {
        if (i < arr.length) shuffled2.push(arr[i]);
      }
    }
    log(`[공감·댓글] 🔀 작업 순서 셔플 완료 — ${shuffled2.length}개`);

    for (const target of shuffled2) {
      if (done >= dailyLimit) { log("[공감·댓글] 일일 한도 도달"); break; }
      if (stopSignal?.()) { log("[공감·댓글] 중단 신호 수신"); break; }

      const { keyword, blogId } = target;

      // ★품앗이(excludeLogNos 사용)는 글 단위 이력으로 중복을 관리하므로 blogId 단위 당일 스킵을 건너뛴다.
      //   (같은 계정이 하루에 여러 번 돌려도 과거 글로 계속 내려갈 수 있게)
      const doneToday = !excludeLogNos && doneMap[blogId] === today;   // 오늘 이미 처리 → 스킵(당일 중복방지)
      const donePerm = skipDone && (blogId in doneMap);               // 완료 스킵 ON → 과거 처리분도 스킵
      if (doneToday || donePerm) {
        await onResult?.({ keyword, blogId, postUrl: "", liked: false, commented: false, status: "skip", message: doneToday ? "오늘 이미 처리됨(당일 중복방지)" : "이미 처리됨" });
        onProgress?.(done, fail);
        continue;
      }

      try {
        // ★방문자 수 필터: 대상 블로그 최근 방문자가 범위 밖이면 건너뛴다(공개 API, 세션 불필요). 못 읽으면 통과.
        if (minVisitors > 0 || maxVisitors > 0) {
          const v = await fetchRecentVisitors(blogId);
          if (v >= 0 && ((minVisitors > 0 && v < minVisitors) || (maxVisitors > 0 && v > maxVisitors))) {
            const msg = `방문자 ${v}명 (범위 ${minVisitors || 0}~${maxVisitors || "∞"} 밖) — 스킵`;
            log(`[공감·댓글] ⏭ ${blogId} ${msg}`);
            await onResult?.({ keyword, blogId, postUrl: "", liked: false, commented: false, status: "skip", message: msg });
            onProgress?.(done, fail);
            continue;
          }
        }
        log(`[공감·댓글] ${blogId} 방문 중...`);

        // 검증된 PostTitleListAsync 기반 목록만 사용 — target blogId 소유 글 외 링크가 섞이지 않는다.
        // ★관련 글 읽기용 여분 풀 + 품앗이 이력 제외(excludeLogNos) 시엔 과거 글까지 전부(무제한) 훑는다.
        const wantCount = Math.max(1, postsPerBlog);
        const fetchCount = excludeLogNos ? null : wantCount * 2 + 3;   // null=전체(무제한). 품앗이는 과거 글까지 다 확보
        const postList = await fetchNaverPostList({ blogId, cookies, maxCount: fetchCount, log });
        const inPeriod = postList.posts.filter(post => post.dateMs === 0 || post.dateMs >= cutoff);
        // ★품앗이: 이미 댓글 단 글은 제외 → 최신부터 훑어 아직 안 단 글에만 단다(같은 글 도배 방지, 자동으로 과거로 내려감)
        const alreadyDone = excludeLogNos ? inPeriod.filter(post => excludeLogNos.has(String(post.logNo))).length : 0;
        const periodOk = excludeLogNos ? inPeriod.filter(post => !excludeLogNos.has(String(post.logNo))) : inPeriod;
        if (excludeLogNos) log(`[품앗이] ${blogId} — 기간 내 글 ${inPeriod.length}개 중 이미 댓글 단 글 ${alreadyDone}개 건너뜀, 새로 달 수 있는 글 ${periodOk.length}개`);
        const filtered = periodOk.slice(0, wantCount);
        // 댓글 안 다는 여분 글(관련 글 1편 더 읽기용): 대상 글 이후의 글들
        const extraPool = periodOk.slice(filtered.length);
        const relRead = new Set<string>();   // ★이미 관련글로 읽은 URL(사이클마다 다른 글 고르기 위한 중복 방지)

        if (filtered.length === 0) {
          const msg = excludeLogNos ? "댓글 달 새 글이 없어요(모든 글에 이미 댓글 완료)" : `최근 ${periodDays}일 내 글 없음`;
          log(`[공감·댓글] ${blogId} — ${msg}, 스킵`);
          await onResult?.({ keyword, blogId, postUrl: "", liked: false, commented: false, status: "skip", message: msg });
          onProgress?.(done, fail);
          continue;
        }

        for (let postIndex = 0; postIndex < filtered.length; postIndex++) {
        if (done >= dailyLimit || stopSignal?.()) break;
        const targetPost = filtered[postIndex];
        let liked = false;
        let commented = false;
        let likeReason = "";     // 공감 못한 이유 (결과 표시용)
        let commentReason = "";  // 댓글 못단 이유 (결과 표시용)

        log(`[공감·댓글] ${blogId} → 글 진입: ${targetPost.url}`);
        // ★검색 경유 진입(켜진 경우): ①글 제목의 주제 키워드로 검색(가장 자연스러움) → ②안 되면 아이디로 검색 → ③다 못 찾으면 URL 직행.
        let entered = false;
        if (searchEntry) {
          const subject = extractSearchQuery(targetPost.title || "");   // 제목 → 검색용 핵심 주제
          entered = await enterViaSearch(page, [subject, keyword, blogId], blogId, targetPost.logNo, log);
        }
        // ★검색 유입은 '클릭'으로 이미 발생(referrer=검색). 그런데 검색 도착지는 모바일(m.blog)이라 PC 댓글 UI(.u_cbox_text)가 없다.
        //   → 유입 발생 후 반드시 PC 글 URL로 이동해서 공감·댓글해야 입력창을 찾는다. (검색유입 글에서만 '댓글 입력창 못 찾음' 나던 원인)
        if (entered) { await page.waitForTimeout(1200); await page.goto(targetPost.url, { waitUntil: "domcontentloaded", timeout: 20000 }).catch(() => {}); }
        else { await page.goto(targetPost.url, { waitUntil: "domcontentloaded", timeout: 20000 }); }
        await page.waitForTimeout(2000);

        // iframe 처리 (네이버 블로그는 mainFrame 안에 있음)
        const getFrame = () => {
          const frames = page.frames();
          return frames.find((f: any) => f.name() === "mainFrame")
            ?? frames.find((f: any) => f.url().includes("blog.naver.com"))
            ?? null;
        };
        let frame = getFrame();
        for (let i = 0; i < 5; i++) {
          await page.waitForTimeout(800);
          frame = getFrame();
          if (frame) break;
        }
        let ctx = frame ?? page as any;

        // ★본문 로딩 확인(재시도): iframe이 덜 로딩되면 본문·공감·댓글 버튼을 못 잡아 글이 통째로 스킵된다.
        //   본문이 비어 있으면 2.5초씩 최대 2번 더 기다렸다 frame 재취득 후 재확인(순간 로딩 지연 대응).
        let bodyLen = (await extractPostText(ctx).catch(() => "")).length;
        for (let rtry = 0; rtry < 2 && bodyLen < 10; rtry++) {
          log(`[공감·댓글] ${blogId} 본문 로딩 대기 후 재확인 ${rtry + 1}/2...`);
          await page.waitForTimeout(2500);
          frame = getFrame();
          ctx = frame ?? page as any;
          bodyLen = (await extractPostText(ctx).catch(() => "")).length;
        }
        // 그래도 본문을 못 읽으면 이 글만 건너뛰고 다음 글로(그 글 하나 때문에 방문 전체가 막히는 것 방지).
        if (bodyLen < 10) {
          await onResult?.({ keyword, blogId, postUrl: targetPost.url, liked: false, commented: false, status: "skip", message: "본문을 못 읽음(로딩 지연) — 다음 글로" });
          log(`[공감·댓글] ⏭ ${blogId} 본문 못 읽어 이 글 건너뜀`);
          onProgress?.(done, fail);
          if (postIndex < filtered.length - 1 && !stopSignal?.()) await page.waitForTimeout(humanDelay(delayMin, delayMax));
          continue;
        }

        // ★체류시간 엔진: 글 분량 읽어 실제 독서처럼 스크롤·머무름(즉시 이탈 방지). 속도 모드 반영.
        await readPostNaturally(page, ctx, log, readSpeed);

        // mainFrame은 높이 800px인 iframe 안에서 자체 문서를 스크롤한다.
        // frame locator의 scrollIntoViewIfNeeded()는 네이버의 스크롤 동기화와 충돌해
        // 요소가 y=800 아래에 남을 수 있으므로 내부 scrollingElement를 명시적으로 이동한다.
        const scrollFrameElementIntoView = async (el: any) => {
          if (!frame) {
            await el.scrollIntoViewIfNeeded();
            return;
          }
          await el.evaluate((node: Element) => {
            const scroller = document.scrollingElement || document.documentElement;
            const rect = node.getBoundingClientRect();
            const target = scroller.scrollTop + rect.top - Math.max(120, window.innerHeight * 0.35);
            scroller.scrollTop = Math.max(0, target);
            window.scrollTo(0, Math.max(0, target));
          });
          await page.waitForTimeout(350);
        };

        // 확률 게이트: 이 글에 공감/댓글을 실제로 할지 매번 주사위 (도배 감지 회피)
        const rollLike = doLike && (likeRate >= 100 || Math.random() * 100 < likeRate);
        let rollComment = doComment && (commentRate >= 100 || Math.random() * 100 < commentRate);
        // ★AI 자동 댓글: 이 글 내용을 읽고 Gemini로 생성 → comments에 반영(실패 시 이 글 댓글만 건너뜀)
        if (rollComment && aiComment) {
          if (aiFallbackActive) {
            // 이미 한도 소진으로 전환됨 → 순환 댓글 사용(AI 호출 안 함)
            const fb = pickFallbackComment(); comments.length = 0; comments.push(fb); commentIdx = 0;
            log(`[AI댓글] (순환 댓글) ${blogId}: "${fb}"`);
          } else {
            const postText = await extractPostText(ctx);
            const gen = await generateAiComment(geminiKey, commentTone, postText, log);
            if (gen) { comments.length = 0; comments.push(gen); commentIdx = 0; log(`[AI댓글] ${blogId}: "${gen}"`); }
            else if (__aiQuotaExhausted) {
              // ★한도 소진 → 지금부터 순환 댓글로 자동 전환(댓글이 끊기지 않게). 프론트가 감지할 특수 로그 + 안내.
              aiFallbackActive = true;
              log(`AI_FALLBACK::⚠️ Gemini 무료 한도 소진 — 지금부터 순환 댓글로 자동 전환합니다`);
              const fb = pickFallbackComment(); comments.length = 0; comments.push(fb); commentIdx = 0;
              log(`[AI댓글] (순환 댓글) ${blogId}: "${fb}"`);
            }
            else { rollComment = false; }
          }
        } else if (rollComment && comments.length === 0) {
          rollComment = false;
        }
        if (doLike && !rollLike) log(`[공감·댓글] ${blogId} 공감 건너뜀(확률 ${likeRate}%)`);
        if (doComment && !aiComment && comment.trim() && !rollComment) log(`[공감·댓글] ${blogId} 댓글 건너뜀(확률 ${commentRate}%)`);

        // ── 공감 클릭 ──
        //  ★실측(2026-08-23): 메인 공감버튼 = a.u_likeit_button._face. 안 눌렸으면 class에 'off', 누르면 'on'으로 바뀐다.
        //   (기존 "on 있고 off 없으면 눌림" 판정이 이 버튼과 안 맞아 공감이 안 눌렸음)
        if (rollLike) {
          try {
            const likeSels = [
              "a.u_likeit_button._face",   // 메인 공감 버튼(실측)
              "a.u_likeit_button",
              "a[data-clk*='like']",
              ".sympathy_toggle_btn",      // 구버전 폴백
              "a[class*='sympathy']",
            ];
            // off/on/aria-pressed로 현재 공감 상태 판정
            const likedState = (cls: string, pressed: string | null) => {
              if (pressed === "true") return true;
              if (/\boff\b/.test(cls)) return false;        // off 클래스 = 아직 공감 안 함
              return /\bon\b/.test(cls);                    // on 클래스 = 공감함
            };
            for (const sel of likeSels) {
              try {
                const el = await ctx.$(sel);
                if (!el) continue;
                const before = await ctx.evaluate((s: string) => {
                  const b = document.querySelector(s); if (!b) return null;
                  return { cls: b.className || "", pressed: b.getAttribute("aria-pressed") };
                }, sel);
                if (!before) continue;
                if (likedState(before.cls, before.pressed)) { liked = true; log(`[공감·댓글] ${blogId} 이미 공감됨`); break; }
                await scrollFrameElementIntoView(el);
                // force 클릭 + 좌표 폴백(오버레이·0x0 대응)
                try { await el.click({ force: true, timeout: 5000 }); }
                catch { const b = await el.boundingBox(); if (b) await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2); }
                await page.waitForTimeout(1500);
                // off→on 전환(또는 aria-pressed=true) 확인. 안 바뀌면 한 번 더 클릭 시도.
                let after = await ctx.evaluate((s: string) => {
                  const b = document.querySelector(s); if (!b) return null;
                  return { cls: b.className || "", pressed: b.getAttribute("aria-pressed") };
                }, sel).catch(() => null);
                if (after && !likedState(after.cls, after.pressed)) {
                  try { await el.click({ force: true, timeout: 3000 }); } catch {}
                  await page.waitForTimeout(1200);
                  after = await ctx.evaluate((s: string) => { const b = document.querySelector(s); return b ? { cls: b.className || "", pressed: b.getAttribute("aria-pressed") } : null; }, sel).catch(() => null);
                }
                const ok = after ? likedState(after.cls, after.pressed) : false;
                if (ok) { liked = true; log(`[공감·댓글] ❤️ ${blogId} 공감 완료 (off→on 확인) · ${sel}`); break; }
                else { log(`[공감·댓글] ${blogId} 공감 클릭했으나 상태 전환 미확인(${sel}) — 다음 셀렉터 시도`); }
              } catch {}
            }
            if (!liked) {
              // ★진단: 실제 페이지에 어떤 공감 관련 버튼이 있는지 로그로 남긴다(실계정 실행 시 정확한 셀렉터 파악용)
              const diag = await ctx.evaluate(() => {
                const els = Array.from(document.querySelectorAll("a,button")).filter(e => {
                  const c = typeof e.className === "string" ? e.className : "";
                  const t = (e.textContent || "").replace(/\s+/g, "");
                  return /like|sympath|recomm|reaction/i.test(c) || /^공감/.test(t);
                });
                return els.slice(0, 6).map(e => `${e.tagName.toLowerCase()}.${(typeof e.className === "string" ? e.className : "").split(/\s+/).slice(0, 2).join(".")}[${(e.textContent || "").replace(/\s+/g, "").slice(0, 6)}]`).join(" / ");
              }).catch(() => "");
              likeReason = "공감 버튼 없음(막힘/비공개)";
              log(`[공감·댓글] ${blogId} 공감 버튼 못 찾음 · 페이지 내 공감 후보: ${diag || "(없음)"}`);
            }
          } catch (e: any) {
            log(`[공감·댓글] ${blogId} 공감 실패: ${e.message}`);
          }
        }

        // ── 댓글 작성 ──
        if (rollComment) {
          try {
            await page.waitForTimeout(1000);

            // ★ 실측(2026-08): 댓글 입력창은 lazy-load. 순서=①끝까지 스크롤 ②'댓글 쓰기'(_cmtList) 클릭해 위젯 로드
            //    ③'댓글쓰기' 화살표버튼(a.btn_write_comment._naverCommentWriteBtn) 클릭해야 u_cbox_text 입력칸이 펼쳐짐
            try {
              // 여러 단계로 끝까지 스크롤(긴 글도 댓글 위젯 로드되게)
              for (let s = 0; s < 4; s++) { await page.mouse.wheel(0, 2500); await page.waitForTimeout(500); }
              await ctx.evaluate(() => { const sc = document.scrollingElement || document.documentElement; sc.scrollTop = sc.scrollHeight; }).catch(() => {});
              await page.waitForTimeout(1200);
              // ① 댓글 영역 열기(위젯 로드) — btn_comment/_cmtList/플로팅
              for (const os of ["a.btn_comment._cmtList", "a._cmtList", "a.btn_comment", "a._floating_bottom_btn_comment"]) {
                const ob = await ctx.$(os);
                if (ob) { await scrollFrameElementIntoView(ob); await ob.click({ timeout: 4000 }).catch(() => {}); await page.waitForTimeout(1500); break; }
              }
              // ② ★'댓글쓰기' 버튼(화살표) 클릭 → 입력칸 펼쳐짐 (실측 클래스 _naverCommentWriteBtn)
              for (const ws of ["a.btn_write_comment._naverCommentWriteBtn", "a._naverCommentWriteBtn", "a.btn_write_comment"]) {
                const wb = await ctx.$(ws);
                if (wb) { await scrollFrameElementIntoView(wb); await wb.click({ force: true, timeout: 3000 }).catch(() => {}); await page.waitForTimeout(1500); break; }
              }
              // ③ u_cbox 입력칸이 뜰 때까지 대기(최대 6초)
              await ctx.waitForSelector(".u_cbox_text, .u_cbox_write_wrap textarea", { timeout: 6000 }).catch(() => {});
              // 접힌 작성영역(beforeClickWriteBox) 한 번 더 클릭해 포커스
              const writeArea = await ctx.$(".u_cbox_write, .u_cbox_write_wrap");
              if (writeArea) { await scrollFrameElementIntoView(writeArea); await writeArea.click({ timeout: 2000 }).catch(() => {}); await page.waitForTimeout(600); }
            } catch {}

            // 댓글 입력창 셀렉터 (u_cbox = 네이버 공용 댓글 위젯)
            //  ★2026-08 실측: 메인 댓글 입력창은 contenteditable div(.u_cbox_text). 옛 textarea 셀렉터는 죽었지만 폴백으로 남겨둠.
            //   contenteditable엔 value 대입 불가 → 아래 humanType(키보드 입력)으로 처리.
            const commentSels = [
              ".u_cbox_text[contenteditable='true']",
              ".u_cbox_text",
              "textarea.u_cbox_text",
              ".u_cbox_write_wrap textarea",
              "textarea#commentArea",
              "textarea[name='comment']",
              "textarea[placeholder*='댓글']",
              "textarea[class*='comment']",
              "#naverComment textarea",
              "iframe#naverComment",
            ];

            let commentDone = false;

            // 댓글은 보통 mainFrame(ctx) 안에 있음. iframe도 대비.
            const commentFrame = page.frames().find((f: any) =>
              f.url().includes("comment") || f.name().includes("comment")
            );
            const commentCtx = commentFrame ?? ctx;

            for (const sel of commentSels) {
              try {
                // iframe 안 textarea 처리
                if (sel === "iframe#naverComment") {
                  const cf = page.frames().find((f: any) => f.url().includes("comment"));
                  if (cf) {
                    const ta = await cf.$("textarea");
                    if (ta) {
                      await ta.click();
                      await page.waitForTimeout(500);
                      await cf.fill("textarea", "");
                      const currentComment = comments[commentIdx % comments.length];
                      commentIdx++;
                      const naturalComment = naturalizeMsg(currentComment);
                      await humanType(page, naturalComment);
                      await page.waitForTimeout(500);
                      const submitSels = ["button[type='submit']","button:has-text('등록')","button[class*='submit']"];
                      for (const ss of submitSels) {
                        try {
                          const sb = await cf.$(ss);
                          if (sb) { await cf.click(ss, { timeout: 3000 }); commentDone = true; break; }
                        } catch {}
                      }
                      if (commentDone) break;
                    }
                  }
                  continue;
                }

                const el = await commentCtx.$(sel);
                if (el) {
                  // ★ 안내문(.u_cbox_guide placeholder)이 입력칸 클릭을 가로챔 → 안내문 먼저 클릭해 활성화
                  const guide = await commentCtx.$(".u_cbox_guide");
                  if (guide) { await guide.click({ timeout: 3000 }).catch(() => {}); await page.waitForTimeout(400); }
                  // force 클릭(오버레이 무시) + 좌표 폴백
                  try { await el.click({ force: true, timeout: 3000 }); }
                  catch { const b = await el.boundingBox(); if (b) await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2); }
                  await page.waitForTimeout(400);
                  // contenteditable(.u_cbox_text)은 fill 안됨 → 전체선택 후 삭제로 비우기
                  await page.keyboard.press(process.platform === "darwin" ? "Meta+A" : "Control+A").catch(() => {});
                  await page.keyboard.press("Backspace").catch(() => {});
                  const currentComment2 = comments[commentIdx % comments.length];
                  const naturalComment2 = naturalizeMsg(currentComment2);
                  await humanType(page, naturalComment2);
                  await page.waitForTimeout(600);
                  // ★ 실제로 입력됐는지 확인 (안됐으면 다음 셀렉터 시도, commentIdx는 성공시에만 증가)
                  const typedOk = await commentCtx.evaluate((s: string) => {
                    const t = document.querySelector(s) as any;
                    return !!t && (t.value || t.textContent || "").trim().length > 0;
                  }, sel).catch(() => false);
                  if (!typedOk) { continue; }
                  commentIdx++;
                  // 등록 버튼 (u_cbox_btn_upload = 네이버 댓글 등록)
                  const submitSels = [
                    ".u_cbox_btn_upload",
                    "button.u_cbox_btn_upload",
                    "a.u_cbox_btn_upload",
                    "button[type='submit']",
                    "button[class*='submit']",
                    "button.btn_ok",
                  ];
                  for (const ss of submitSels) {
                    try {
                      const sb = await commentCtx.$(ss);
                      if (sb) { await sb.click({ force: true, timeout: 3000 }); commentDone = true; break; }
                    } catch {}
                  }
                  if (commentDone) { log(`[공감·댓글] 💬 ${blogId} 댓글 등록`); break; }
                }
              } catch {}
            }

            if (commentDone) {
              commented = true;
              await page.waitForTimeout(1000);
              log(`[공감·댓글] 💬 ${blogId} 댓글 완료`);
            } else {
              commentReason = "댓글 입력창 못 찾음(댓글 막힘 가능)";
              log(`[공감·댓글] ${blogId} 댓글 입력창 못 찾음`);
            }
          } catch (e: any) {
            commentReason = `댓글 오류(${(e.message || "").slice(0, 20)})`;
            log(`[공감·댓글] ${blogId} 댓글 실패: ${e.message}`);
          }
        }

        // ★ 목표 달성 기준: 댓글 작업이면 "댓글이 실제로 써졌는가"가 핵심(공감만 된 건 완료 아님 → 다음에 댓글 재시도)
        const goalMet = doComment ? commented : liked;
        if (goalMet) {
          // 목표 달성한 것만 "완료 목록"에 기록(다음번 '이미 처리됨' 대상)
          doneMap[blogId] = today;
          fs.writeFileSync(engageDonePath, JSON.stringify(doneMap, null, 2));
          done++;
          // ★품앗이 도배 방지: 댓글 단 글은 이력에 기록 → 다음엔 이 글 건너뛰고 과거 글로
          if (commented && onCommented && targetPost.logNo) onCommented(String(targetPost.logNo));
          const msg = commented ? "통과 (댓글 작성)" : "공감 완료";
          await onResult?.({ keyword, blogId, postUrl: targetPost.url, liked, commented, status: "success", message: msg });
          log(`[공감·댓글] ✅ ${blogId} ${msg} (${done}/${dailyLimit})`);
        } else {
          // 목표 미달 → 완료기록 안 함(재시도 가능) + 결과에 "사실" 그대로 표시
          const parts: string[] = [];
          if (doLike) parts.push(liked ? "공감됨" : `공감 ${likeReason || "실패"}`);
          if (doComment) parts.push(commented ? "댓글됨" : `댓글 ${commentReason || "실패"}`);
          const msg = parts.join(" / ") || "대상 아님";
          await onResult?.({ keyword, blogId, postUrl: targetPost.url, liked, commented, status: "skip", message: msg });
          log(`[공감·댓글] ⏭ ${blogId} 스킵: ${msg}`);
        }

        onProgress?.(done, fail);

        // ★관련 글 1편 더 읽기(1사이클 = 이 대상 글 공감·댓글 + 같은 블로그 다른 글 1편 정독).
        //   각 대상 글 처리 직후 실행 → 대상 글 3개면 관련글도 최대 3번(테리 정의). 관련글엔 공감·댓글 안 함.
        //   매번=항상 1편 / 가끔=확률 60%. 이미 읽은 글은 빼고 골라 사이클마다 다른 글을 읽는다(여분 부족 시에만 스킵).
        if (readRelated && extraPool.length > 0 && !stopSignal?.() && (readRelatedMode === "always" || Math.random() < 0.6)) {
          const unread = extraPool.filter(p => !relRead.has(p.url));
          const pool = unread.length ? unread : extraPool;
          const relPost = pool[Math.floor(Math.random() * pool.length)];
          relRead.add(relPost.url);
          try {
            await page.waitForTimeout(humanDelay(delayMin, delayMax));
            log(`[관련글] 📖 ${blogId} — 다른 글 1편 더 읽기(공감·댓글 없음): ${relPost.url}`);
            await page.goto(relPost.url, { waitUntil: "domcontentloaded", timeout: 20000 });
            await page.waitForTimeout(1500);
            const relFrame = page.frames().find((f: any) => f.name() === "mainFrame")
              ?? page.frames().find((f: any) => f.url().includes("blog.naver.com")) ?? page;
            await readPostNaturally(page, relFrame as any, log, readSpeed);
          } catch (e: any) {
            log(`[관련글] ⏭ 추가 읽기 건너뜀 (${(e.message || "").slice(0, 30)})`);
          }
        }

        if (postIndex < filtered.length - 1 && done < dailyLimit && !stopSignal?.()) {
          const postDelay = humanDelay(delayMin, delayMax);
          log(`[공감·댓글] ⏱ 다음 글까지 ${(postDelay / 1000).toFixed(1)}초 대기...`);
          await page.waitForTimeout(postDelay);
        }
        }

      } catch (e: any) {
        fail++;
        await onResult?.({ keyword, blogId, postUrl: "", liked: false, commented: false, status: "fail", message: e.message });
        log(`[공감·댓글] ❌ ${blogId} 실패: ${e.message}`);
      }

      onProgress?.(done, fail);
      const delay = humanDelay(delayMin, delayMax);
      log(`[공감·댓글] ⏱ 다음 작업까지 ${(delay/1000).toFixed(1)}초 대기...`);
      await page.waitForTimeout(delay);
      if ((done + fail) % 10 === 0 && (done + fail) > 0) {
        const longRest = humanDelay(30, 90);
        log(`[공감·댓글] ☕ ${(longRest/1000).toFixed(0)}초 긴 휴식 중...`);
        await page.waitForTimeout(longRest);
      }
    }
  } finally {
    // 공유 크롬(품앗이)이면 context만 닫아 창을 유지하고, 단독 실행이면 browser까지 닫는다.
    await context.close().catch(() => {});
    if (ownBrowser) await browser.close().catch(() => {});
  }
}

/* ── 공감·댓글용 완료 목록 경로 ── */
export function engageDonePath(accountId: string): string {
  return path.join(SESSION_DIR, `engage_done_${accountId}.json`);
}

/* ── 🩺 공개 정보로 남의 블로그 진정성 분석 (세션 불필요) ──
   m.blog.naver.com 공개 API의 이웃수(subscriberCount) + NVisitorgp4Ajax 공개 방문자 XML.
   참여율(방문자/이웃) 대비로 "진짜 영향력 vs 품앗이·봇 부풀림"을 추정한다. */
export async function analyzeBlogAuthenticity(blogId: string): Promise<{ blogId: string; neighbors: number; visitors: number; authenticity: number | null; email?: string; kakao?: string; openchat?: string; instagram?: string; youtube?: string; postsPerWeek?: number; lastPostDaysAgo?: number; adRatio?: number; mainTopic?: string; avgComments?: number; avgSympathy?: number; engSampleN?: number }> {
  const MUA = "Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1";
  const WUA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36";
  let neighbors = 0, visitors = 0;
  let email: string | undefined, kakao: string | undefined, openchat: string | undefined;
  let instagram: string | undefined, youtube: string | undefined;   // 📱 타 SNS(추가 수집) — 연락 채널 확대
  // 📇 공개 연락처 추출 — 블로그 소개글/프로필에 공개한 이메일·카톡·오픈채팅·SNS를 정규식으로. (공개정보만)
  const pickContacts = (text: string) => {
    if (!text) return;
    const t = text.replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n))).replace(/\[at\]|\(at\)|＠/gi, "@").replace(/\[dot\]|\(dot\)/gi, ".");
    if (!email) { const m = t.match(/[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/); if (m && !/example\.com|naver\.com\/|\.png|\.jpg/i.test(m[0])) email = m[0]; }
    if (!openchat) { const m = t.match(/open\.kakao\.com\/[a-zA-Z0-9/_-]+/); if (m) openchat = "https://" + m[0].replace(/^https?:\/\//, ""); }
    if (!kakao) { const m = t.match(/(?:카톡|카카오톡|kakao\s*id|오픈채팅)\s*[:：]?\s*([a-zA-Z0-9_.\-]{3,20})/i); if (m && !/open\.kakao/i.test(m[0])) kakao = m[1]; }
    // 📱 인스타그램 핸들(게시물·릴스 링크 제외, 프로필만)
    if (!instagram) { const m = t.match(/instagram\.com\/([a-zA-Z0-9_.]{2,30})/i); if (m && m[1] && !/^(p|reel|reels|explore|stories|accounts)$/i.test(m[1])) instagram = m[1]; }
    // 📺 유튜브 채널(@핸들 / channel / c/)
    if (!youtube) { const m = t.match(/youtube\.com\/(@[a-zA-Z0-9_.\-]{2,40}|channel\/[a-zA-Z0-9_\-]+|c\/[a-zA-Z0-9_.\-]+)/i) || t.match(/youtu\.be\/[a-zA-Z0-9_\-]+/i); if (m) youtube = m[0].replace(/^https?:\/\//, ""); }
  };
  try {
    const r = await fetch(`https://m.blog.naver.com/api/blogs/${encodeURIComponent(blogId)}`, { headers: { "User-Agent": MUA, Referer: `https://m.blog.naver.com/${blogId}` } });
    const raw = (await r.text()).replace(/^\)\]\}',?\s*/, "");
    const j: any = JSON.parse(raw);
    neighbors = Number(j?.result?.subscriberCount ?? j?.subscriberCount ?? 0) || 0;
    // 소개글(introduction/blogIntroduction 등)에서 연락처
    const intro = String(j?.result?.blogIntroduction ?? j?.result?.introduction ?? j?.blogIntroduction ?? j?.introduction ?? "");
    pickContacts(intro);
  } catch {}
  // 프로필 페이지 HTML에서도 한 번 더(소개글 API가 비어있는 경우가 많음 → description 메타·프로필 desc·HTML 전체).
  //   연락처 또는 SNS가 아직 없으면 실행(SNS 링크는 프로필 상단 위젯에 있는 경우가 많음).
  if (!email && !kakao && !openchat || !instagram && !youtube) {
    try {
      const pr = await fetch(`https://m.blog.naver.com/${encodeURIComponent(blogId)}`, { headers: { "User-Agent": MUA } });
      const html = await pr.text();
      const meta = html.match(/<meta[^>]+(?:name|property)=["'](?:description|og:description)["'][^>]+content=["']([^"']+)["']/i);
      if (meta) pickContacts(meta[1]);                                   // 소개 = description 메타(실측: 여기 있음)
      const introM = html.match(/"blogIntroduction"\s*:\s*"([^"]*)"/) || html.match(/class="[^"]*desc[^"]*"[^>]*>([^<]+)</i);
      if (introM) pickContacts(introM[1]);
      pickContacts(html.slice(0, 40000));                               // 프로필 상단 HTML 전체에서 한 번 더(SNS 위젯 포함)
    } catch {}
    // 프로필 인트로(외부채널 위젯 소스) — 인스타·유튜브 등 외부 링크를 여기 걸어두는 블로거가 많음
    try {
      const ir = await fetch(`https://blog.naver.com/profile/intro.naver?blogId=${encodeURIComponent(blogId)}`, { headers: { "User-Agent": MUA, Referer: `https://blog.naver.com/${blogId}` } });
      pickContacts((await ir.text()).slice(0, 40000));
    } catch {}
  }
  // 최근 게시글 목록 — ①활성도(포스팅 주기·최근성) ②상업성(제목의 협찬 표시 비율) ③연락처(본문)
  //   한 번의 목록 호출을 세 용도로 재활용(추가 네트워크 최소화).
  let postsPerWeek: number | undefined, lastPostDaysAgo: number | undefined, adRatio: number | undefined, mainTopic: string | undefined;
  try {
    const lr = await fetch(`https://m.blog.naver.com/api/blogs/${encodeURIComponent(blogId)}/posts?categoryNo=0&itemCount=12&page=1`, { headers: { "User-Agent": MUA, Referer: `https://m.blog.naver.com/${blogId}` } });
    const lraw = (await lr.text()).replace(/^\)\]\}',?\s*/, "");
    const lj: any = JSON.parse(lraw);
    const items: any[] = (lj?.result?.items || lj?.result?.postList || lj?.items || []);
    if (items.length) {
      // ① 활성도: 최근 글 날짜(ms)들로 최근성 + 주간 포스팅 수 추정
      const dates = items.map(it => Number(it.addDate ?? it.addDateMs ?? it.date ?? 0)).filter(n => Number.isFinite(n) && n > 0).sort((a, b) => b - a);
      if (dates.length) {
        lastPostDaysAgo = Math.floor((Date.now() - dates[0]) / 86400000);
        if (dates.length >= 2) {
          const spanDays = Math.max(1, (dates[0] - dates[dates.length - 1]) / 86400000);
          postsPerWeek = Math.round((dates.length / spanDays) * 7 * 10) / 10;   // 최근 표본 기준 주당 글 수
        }
      }
      // ② 상업성: 최근 글 제목의 협찬·체험단 표시 비율(0~1). 순수후기↔협찬多 감별.
      const AD = /협찬|체험단|무상\s*제공|제공\s*받아|제공받아|소정의|원고료|유료\s*광고|서포터[즈스]|앰버서더|앰배서더|파트너스|서포터스|sponsored|\bad\b/i;
      const titles = items.map(it => String(it.title || it.titleWithInspectMessage || "")).filter(Boolean);
      if (titles.length) adRatio = Math.round((titles.filter(t => AD.test(t)).length / titles.length) * 100) / 100;
      // ④ 주제 자동분류(추가수집): 실제 최근 글 제목에서 가장 자주 다루는 분야를 판별(검색 키워드보다 정확).
      if (titles.length) {
        const TOPICS: [string, RegExp][] = [
          ["맛집·음식", /맛집|먹방|음식|점심|저녁|메뉴|식당|국밥|고기|파스타|초밥|디저트\b/],
          ["카페·디저트", /카페|커피|디저트|베이커리|빵집|브런치|케이크/],
          ["뷰티·화장품", /뷰티|화장품|스킨케어|메이크업|립스틱|파운데이션|향수|피부/],
          ["패션", /패션|코디|옷|아우터|원피스|신발|가방|룩북|데일리룩/],
          ["육아·아이", /육아|아기|아이|유아|기저귀|이유식|장난감|어린이집|출산/],
          ["여행", /여행|호텔|리조트|펜션|여행지|국내여행|해외여행|관광|숙소/],
          ["인테리어·집", /인테리어|집꾸미기|셀프인테리어|가구|홈|정리|살림|주방/],
          ["운동·건강", /운동|헬스|필라테스|요가|다이어트|홈트|근력|러닝|건강/],
          ["반려동물", /강아지|고양이|반려|펫|멍멍|냥|사료|동물병원/],
          ["IT·전자", /아이폰|갤럭시|노트북|태블릿|이어폰|가전|전자|앱\b|스마트/],
          ["자동차", /자동차|차량|시승|suv|전기차|국산차|수입차|타이어/],
          ["재테크·금융", /재테크|주식|부동산|투자|적금|대출|보험|연금|절세/],
          ["교육·공부", /공부|교육|학습|입시|자격증|영어|수학|강의|시험/],
        ];
        const score = TOPICS.map(([label, re]) => [label, titles.filter(t => re.test(t)).length] as [string, number]).filter(x => x[1] > 0).sort((a, b) => b[1] - a[1]);
        if (score.length && score[0][1] >= 2) mainTopic = score[0][0];   // 2건 이상 겹칠 때만(오분류 방지)
      }
      // ③ 연락처: 아직 못 찾았으면 상위 2개 본문에서(협찬·제휴 문의 이메일이 글 하단에 많음)
      if (!email && !kakao && !openchat) {
        for (const it of items.slice(0, 2)) {
          const logNo = String(it.logNo || it.logno || it.postId || "");
          if (!logNo) continue;
          try { const pv = await fetch(`https://m.blog.naver.com/${encodeURIComponent(blogId)}/${logNo}`, { headers: { "User-Agent": MUA } }); pickContacts((await pv.text()).slice(0, 50000)); } catch {}
          if (email || kakao || openchat) break;
        }
      }
    }
  } catch {}
  try {
    const vres = await fetch(`https://blog.naver.com/NVisitorgp4Ajax.naver?blogId=${encodeURIComponent(blogId)}`, { headers: { "User-Agent": MUA, Referer: `https://blog.naver.com/${blogId}` } });
    const xml = await vres.text();
    const nums = Array.from(xml.matchAll(/cnt="(\d+)"/g)).map((m) => Number(m[1])).filter((n) => Number.isFinite(n));
    if (nums.length) visitors = Math.max(...nums);   // 최근 며칠 중 대표값
  } catch {}
  // ⑤ 인게이지먼트(진짜 독자 반응) — 글당 평균 댓글·공감. '껍데기 이웃 많은 블로그' vs '진짜 독자가 반응하는 블로그' 감별.
  //   댓글=PostTitleListAsync(공개·쿠키불필요·IP제약 적음)가 글별 commentCount를 한 번에 준다 → 최근 글 평균.
  //   공감(좋아요)=likeIt API가 글당 1콜이라 최근 3개만 표본 조회(크롤링 과부하·차단 회피). 실패는 조용히 건너뜀.
  let avgComments: number | undefined, avgSympathy: number | undefined, engSampleN: number | undefined;
  try {
    const pr = await fetch(`https://blog.naver.com/PostTitleListAsync.naver?blogId=${encodeURIComponent(blogId)}&currentPage=1&countPerPage=10`, { headers: { "User-Agent": WUA, Referer: `https://blog.naver.com/${blogId}` } });
    const praw = (await pr.text()).replace(/\\'/g, "'");   // 네이버 응답의 잘못된 \' 이스케이프 교정(필수)
    const pj: any = JSON.parse(praw);
    const posts: any[] = Array.isArray(pj?.postList) ? pj.postList : [];
    const cc = posts.map(p => Number(p.commentCount)).filter(n => Number.isFinite(n));
    if (cc.length) { avgComments = Math.round((cc.reduce((a, b) => a + b, 0) / cc.length) * 10) / 10; engSampleN = cc.length; }
    // 공감: 최근 최대 3개 글 표본 평균(글당 1콜 → 표본만)
    const logs = posts.map(p => String(p.logNo || "")).filter(Boolean).slice(0, 3);
    let symSum = 0, symN = 0;
    for (const lg of logs) {
      try {
        const lr = await fetch(`https://blog.like.naver.com/v1/search/contents?suffix=&q=${encodeURIComponent(`BLOG[${blogId}_${lg}]`)}`, { headers: { "User-Agent": WUA, Referer: `https://blog.naver.com/${blogId}/${lg}` } });
        const lj: any = await lr.json();
        const c0 = lj?.contents?.[0];
        if (c0 && Array.isArray(c0.reactions)) { symSum += c0.reactions.reduce((a: number, r: any) => a + (Number(r.count) || 0), 0); symN++; }
      } catch {}
    }
    if (symN) avgSympathy = Math.round((symSum / symN) * 10) / 10;
  } catch {}

  let authenticity: number | null = null;
  if (neighbors > 0) {
    // 이웃 대비 일방문자 비율(방문/이웃). 건강한 블로그는 이웃 규모 대비 방문이 어느 정도 나온다.
    const ratio = visitors / neighbors;               // 0.1~0.5면 건강, 극히 낮으면 품앗이·죽은 이웃 의심
    const expected = 0.18;                            // 경험적 기대 비율
    let s = 50 + Math.round(Math.max(-45, Math.min(45, (ratio / expected - 1) * 40)));
    if (visitors === 0) s = Math.min(s, 30);          // 방문자 0 = 죽은 블로그 의심
    authenticity = Math.max(5, Math.min(99, s));
  }
  return { blogId, neighbors, visitors, authenticity, email, kakao, openchat, instagram, youtube, postsPerWeek, lastPostDaysAgo, adRatio, mainTopic, avgComments, avgSympathy, engSampleN };
}

/* ── 📄 글 본문 읽기 (세션 불필요, 공개) ──
   개선안 제안 시 "제목만 보고 엉뚱하게 고치는" 문제 방지 → 실제 본문을 읽어 AI에 준다.
   네이버 모바일 공개 페이지(m.blog.naver.com/{blogId}/{logNo})에서 본문 텍스트 추출. */
export async function fetchPostBody(blogId: string, logNo: string): Promise<{ title: string; body: string; imageCount: number }> {
  const MUA = "Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1";
  try {
    const r = await fetch(`https://m.blog.naver.com/${encodeURIComponent(blogId)}/${encodeURIComponent(logNo)}`, { headers: { "User-Agent": MUA } });
    if (!r.ok) throw new Error(`네이버 공개 글 조회 실패(HTTP ${r.status})`);
    const html = await r.text();
    // 제목
    let title = "";
    const tm = html.match(/<meta property="og:title" content="([^"]*)"/) || html.match(/<title>([^<]*)<\/title>/);
    if (tm) title = tm[1].replace(/&[a-z]+;/g, " ").trim();
    // 본문: se-main-container 또는 postViewArea 영역의 텍스트만 러프하게 추출
    let seg = html;
    const bi = html.indexOf("se-main-container");
    if (bi > 0) seg = html.slice(bi, bi + 60000);
    // 스마트에디터 이미지 컴포넌트 기준. 동일 이미지 안의 하위 태그(img 등)는 중복 집계하지 않는다.
    const imageCount = (seg.match(/class=["'][^"']*\bse-(?:component\s+se-)?image\b[^"']*["']/gi) || []).length;
    const body = seg
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      // AEO 진단은 문단·Q&A·번호 목록의 줄 경계를 사용한다. 태그 제거 전에
      // 블록 경계를 줄바꿈으로 바꿔야 공개 글의 실제 구조가 보존된다.
      .replace(/<br\s*\/?\s*>/gi, "\n")
      .replace(/<\/(?:p|div|li|ul|ol|h[1-6]|blockquote|section)>/gi, "\n")
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/gi, " ")
      .replace(/&amp;/gi, "&")
      .replace(/&quot;/gi, '"')
      .replace(/&#39;/gi, "'")
      .replace(/&lt;/gi, "<")
      .replace(/&gt;/gi, ">")
      .replace(/[ \t\r\f\v]+/g, " ")
      .replace(/ *\n */g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim()
      .slice(0, 8000);   // 글 아래쪽 FAQ까지 진단할 수 있게 충분히 읽는다
    if (body.length < 20) throw new Error("네이버 공개 글 본문을 읽지 못했어요");
    return { title, body, imageCount };
  } catch (e) {
    throw e instanceof Error ? e : new Error("네이버 공개 글 조회 실패");
  }
}

/* ═══════════════════════════════════════════════════════════════════════════
   🗣️ 플레이스 리뷰답글 봇
   ★★ 정직 고지: 스마트플레이스(사장님) 리뷰관리 페이지의 실제 DOM/URL은 아직 실기기로
      검증하지 못했다. 아래 URL·셀렉터는 "최선의 추정"이며, 실제 화면에서 교정이 필요하다.
      - 모든 단계에 상세 로그(현재 URL, 발견 개수, 실패 사유)를 남겨 실측 시 바로 고칠 수 있게 함.
      - 안전장치: 요소를 못 찾으면 조용히 skip → 엉뚱한 클릭/오답글을 절대 만들지 않는다.
   ═══════════════════════════════════════════════════════════════════════════ */

export type PlaceReviewRaw = { reviewId: string; author: string; rating: number; text: string; date?: string; hasReply: boolean };

// ── AI 리뷰 답글 초안(별점 맥락 반영) ──
export async function generatePlaceReviewReply(key: string, tone: string, rating: number, reviewText: string, author: string, log: (m: string) => void): Promise<string> {
  if (!key) { log("[리뷰답글] Gemini 키 없음 — AI 초안 건너뜀"); return ""; }
  const toneGuide = tone === "담백" ? "깔끔하고 담백한" : tone === "짧게" ? "짧고 간결한" : "다정하고 따뜻한";
  const lowStar = rating > 0 && rating <= 3;
  const stance = lowStar
    ? "낮은 평점(불만) 리뷰야. 변명하지 말고 진심으로 사과하고, 개선하겠다는 의지를 짧게 전해. 감정적으로 맞받아치지 마."
    : "만족스러운 리뷰야. 구체적으로 고마움을 표하고 재방문을 부드럽게 권해.";
  const nameRule = author
    ? `상대 닉네임은 정확히 "${author}"야. 부를 거면 한 글자도 바꾸지 말고 그대로 쓰고, 어색하면 부르지 말고 내용에만 반응해.`
    : `닉네임을 모르니 사람 이름·호칭을 지어내지 말고 내용에만 반응해.`;
  const prompt = `너는 네이버 플레이스에 등록된 매장의 사장이야. 손님이 남긴 아래 리뷰에 ${toneGuide} 말투로 사장님 답글을 딱 1개만 써줘.\n${stance}\n${nameRule}\n규칙: 1~2문장, 60자 이내, 리뷰 내용에 구체적으로 반응, 이모지 1개 정도, 광고·링크·전화번호 금지, 따옴표 없이 답글만 출력.\n\n[손님 리뷰(별점 ${rating || "없음"})]\n${reviewText}`;
  for (const model of GEMINI_MODELS) {
    try {
      const generationConfig: any = { maxOutputTokens: 800, temperature: 0.95 };
      if (model.startsWith("gemini-2.5")) generationConfig.thinkingConfig = { thinkingBudget: 0 };
      const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig }),
        signal: AbortSignal.timeout(12000),
      });
      const d: any = await r.json();
      if (!r.ok) { log(`[리뷰답글] ${model} 실패(${r.status}) → 다음 모델`); continue; }
      const cand = d?.candidates?.[0];
      const raw = cand?.content?.parts?.[0]?.text?.trim();
      if (!raw || cand?.finishReason === "MAX_TOKENS") { log(`[리뷰답글] ${model} 잘림/빈응답 → 다음 모델`); continue; }
      const cleaned = raw.replace(/^["'\s]+|["'\s]+$/g, "").replace(/\s*[\r\n]+\s*/g, " ").replace(/\s{2,}/g, " ").trim().slice(0, 140);
      if (cleaned.length >= 3) return cleaned;
    } catch { log(`[리뷰답글] ${model} 응답 지연/오류 → 다음 모델`); }
  }
  return "";
}

// 스마트플레이스 리뷰관리 페이지로 진입(로그인 세션 활용). 성공 시 page가 리뷰 목록 화면에 있음.
async function gotoSmartplaceReviews(page: any, storeName: string, log: (m: string) => void): Promise<boolean> {
  // ★미검증: 스마트플레이스 진입 URL 후보. 실제 경로는 실기기에서 확인해 교정.
  await page.goto("https://new.smartplace.naver.com/", { waitUntil: "domcontentloaded", timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(2500);
  // 로그인 필요하면 뜬 창에서 사장이 직접 통과(최대 ~90초)
  if (/nid\.naver\.com\/nidlogin|nidlogin\.login/.test(page.url())) {
    log("[리뷰답글] ⚠️ 로그인 필요 — 열린 창에서 직접 로그인/2차인증을 통과해 주세요(최대 90초 대기)");
    for (let i = 0; i < 45 && /nidlogin/.test(page.url()); i++) await page.waitForTimeout(2000);
    if (/nidlogin/.test(page.url())) { log("[리뷰답글] ❌ 로그인 대기 시간 초과"); return false; }
    await page.goto("https://new.smartplace.naver.com/", { waitUntil: "domcontentloaded", timeout: 30000 }).catch(() => {});
    await page.waitForTimeout(2500);
  }
  log(`[리뷰답글] 스마트플레이스 진입 (URL: ${page.url()})`);
  // 업체가 여러 개면 storeName으로 선택 시도(있으면). 없으면 현재 업체 그대로.
  if (storeName) {
    const picked = await page.evaluate((name: string) => {
      const els = Array.from(document.querySelectorAll("a,button,li,div")) as HTMLElement[];
      const t = els.find(e => (e.textContent || "").trim() === name || (e.textContent || "").includes(name));
      if (t) { t.click(); return true; }
      return false;
    }, storeName).catch(() => false);
    if (picked) { await page.waitForTimeout(2000); log(`[리뷰답글] 업체 "${storeName}" 선택 시도`); }
  }
  // 리뷰 메뉴로 이동(텍스트가 '리뷰'인 링크/버튼 클릭 후보)
  const toReview = await page.evaluate(() => {
    const els = Array.from(document.querySelectorAll("a,button")) as HTMLElement[];
    const t = els.find(e => /리뷰/.test((e.textContent || "").trim()) && (e.textContent || "").trim().length <= 6);
    if (t) { t.click(); return true; }
    return false;
  }).catch(() => false);
  await page.waitForTimeout(2500);
  log(`[리뷰답글] 리뷰 메뉴 이동 ${toReview ? "클릭됨" : "(리뷰 링크 못찾음 — 실측 교정 필요)"} · 현재 URL: ${page.url()}`);
  return true;
}

// 현재 리뷰 화면에서 리뷰들을 파싱(여러 후보 셀렉터). 못 찾으면 빈 배열 + 로그.
async function parseSmartplaceReviews(page: any, log: (m: string) => void): Promise<PlaceReviewRaw[]> {
  // 리뷰 리스트가 지연 로드될 수 있어 스크롤
  for (let s = 0; s < 3; s++) { await page.mouse.wheel(0, 2000); await page.waitForTimeout(600); }
  const reviews: PlaceReviewRaw[] = await page.evaluate(() => {
    // ★미검증: 리뷰 카드 셀렉터 후보. 실제 클래스는 실기기에서 확인해 교정.
    const cardSel = ["li[class*='review']", "div[class*='review_item']", "div[class*='ReviewItem']", "li[class*='item']", "[data-review-id]"];
    let cards: Element[] = [];
    for (const sel of cardSel) { const found = Array.from(document.querySelectorAll(sel)); if (found.length > cards.length) cards = found; }
    const pickText = (el: Element, sels: string[]): string => { for (const s of sels) { const n = el.querySelector(s); const t = (n?.textContent || "").trim(); if (t) return t; } return ""; };
    const out: { reviewId: string; author: string; rating: number; text: string; date?: string; hasReply: boolean }[] = [];
    cards.forEach((c, i) => {
      const author = pickText(c, ["[class*='nick']", "[class*='name']", "strong", "[class*='author']"]);
      const text = pickText(c, ["[class*='content']", "[class*='text']", "p", "[class*='body']"]);
      // 별점: 텍스트에서 숫자/별 추출
      const ratingText = pickText(c, ["[class*='star']", "[class*='score']", "[class*='rating']"]);
      let rating = 0; const m = ratingText.match(/([1-5])(\.\d)?/); if (m) rating = Math.round(Number(m[1]));
      const date = pickText(c, ["[class*='date']", "time", "[class*='day']"]);
      // 이미 사장 답글이 달렸는지(답글 영역 존재)
      const hasReply = !!c.querySelector("[class*='reply'],[class*='owner'],[class*='answer']");
      const reviewId = (c.getAttribute("data-review-id") || c.getAttribute("data-id") || String(i));
      if (text) out.push({ reviewId, author: author || "익명", rating, text, date, hasReply });
    });
    return out;
  }).catch(() => []);
  log(`[리뷰답글] 리뷰 파싱 ${reviews.length}건 (현재 URL: ${page.url()})`);
  if (!reviews.length) log("[리뷰답글] ⚠️ 리뷰를 못 찾았어요 — 스마트플레이스 화면 구조가 코드 추정과 다릅니다(실기기 셀렉터 교정 필요).");
  return reviews;
}

// ── 리뷰 수집 ──
export async function crawlPlaceReviews(params: {
  accountId: string; placeUrl?: string; storeName?: string; onlyNew?: boolean;
  ownerUserId?: string | null; onLog?: (m: string) => void;
}): Promise<PlaceReviewRaw[]> {
  const log = params.onLog || console.log;
  const cookies = await ensureLiveSession(params.accountId, log);
  const browser = await launchBrowser(params.accountId, { headless: false, maximized: true, log, feature: "reply", ownerUserId: params.ownerUserId });
  const context = await browser.newContext({ userAgent: UA, viewport: { width: 1280, height: 900 }, locale: "ko-KR" });
  await applyAntiDetection(context);
  await context.addCookies(cookies);
  const page = await context.newPage();
  await page.bringToFront().catch(() => {});
  try {
    const ok = await gotoSmartplaceReviews(page, params.storeName || "", log);
    if (!ok) return [];
    let reviews = await parseSmartplaceReviews(page, log);
    if (params.onlyNew) reviews = reviews.filter(r => !r.hasReply);
    return reviews;
  } finally { await browser.close().catch(() => {}); }
}

// ── 답글 등록(SSE 콜백) ──
export async function replyToPlaceReviews(params: {
  accountId: string; placeUrl?: string; storeName?: string;
  replies: { reviewId: string; reply: string }[];
  ownerUserId?: string | null;
  onLog?: (m: string) => void;
  onResult?: (r: { reviewId: string; status: "success" | "fail"; message?: string }) => Promise<void> | void;
  onProgress?: (done: number, fail: number) => void;
  stopSignal?: () => boolean;
}): Promise<void> {
  const log = params.onLog || console.log;
  const cookies = await ensureLiveSession(params.accountId, log);
  const browser = await launchBrowser(params.accountId, { headless: false, maximized: true, log, feature: "reply", ownerUserId: params.ownerUserId });
  const context = await browser.newContext({ userAgent: UA, viewport: { width: 1280, height: 900 }, locale: "ko-KR" });
  await applyAntiDetection(context);
  await context.addCookies(cookies);
  const page = await context.newPage();
  await page.bringToFront().catch(() => {});
  let done = 0, fail = 0;
  try {
    const ok = await gotoSmartplaceReviews(page, params.storeName || "", log);
    if (!ok) { log("[리뷰답글] 리뷰 페이지 진입 실패 — 중단"); return; }
    await parseSmartplaceReviews(page, log); // 화면 로드 보장
    for (const item of params.replies) {
      if (params.stopSignal?.()) { log("[리뷰답글] 중단 신호 수신"); break; }
      // ★미검증: reviewId로 해당 리뷰 카드의 '답글' 버튼 → 입력창 → 등록. 셀렉터는 실기기 교정 필요.
      const posted = await page.evaluate(({ rid, text }: { rid: string; text: string }) => {
        const card = document.querySelector(`[data-review-id='${rid}'],[data-id='${rid}']`)
          || Array.from(document.querySelectorAll("li,div")).find(c => (c as HTMLElement).innerText && false); // id 매칭 우선
        if (!card) return "no-card";
        const btn = card.querySelector("button,a");
        // 답글 쓰기 버튼(텍스트에 '답글') 클릭
        const replyBtn = Array.from(card.querySelectorAll("button,a")).find(b => /답글|답변/.test((b.textContent || ""))) as HTMLElement | undefined;
        (replyBtn || (btn as HTMLElement))?.click();
        const ta = card.querySelector("textarea,[contenteditable='true']") as HTMLElement | null;
        if (!ta) return "no-input";
        if (ta.tagName === "TEXTAREA") { (ta as HTMLTextAreaElement).value = text; ta.dispatchEvent(new Event("input", { bubbles: true })); }
        else { ta.textContent = text; ta.dispatchEvent(new Event("input", { bubbles: true })); }
        const submit = Array.from(card.querySelectorAll("button")).find(b => /등록|저장|완료/.test((b.textContent || ""))) as HTMLElement | undefined;
        if (!submit) return "no-submit";
        submit.click();
        return "ok";
      }, { rid: item.reviewId, text: item.reply }).catch(() => "error");
      await page.waitForTimeout(1800);
      if (posted === "ok") { done++; log(`[리뷰답글] ✅ 리뷰(${item.reviewId})에 답글 등록: "${item.reply.slice(0, 30)}"`); await params.onResult?.({ reviewId: item.reviewId, status: "success" }); }
      else { fail++; log(`[리뷰답글] ❌ 리뷰(${item.reviewId}) 답글 실패: ${posted} (실기기 셀렉터 교정 필요)`); await params.onResult?.({ reviewId: item.reviewId, status: "fail", message: String(posted) }); }
      params.onProgress?.(done, fail);
      await page.waitForTimeout(humanDelay(2, 4));
    }
    log(`[리뷰답글] 완료 — 등록 ${done} / 실패 ${fail}`);
  } finally { await browser.close().catch(() => {}); }
}

/* ══════════════════════════════════════════════════════════════════════
   🚀 검색유입(트래픽) 엔진 — "키워드 검색 → 결과 탐색 → 클릭 진입 → 체류(글 전체
   읽기) → 액션(저장/공감) → 이탈" 을 사람처럼. 플레이스·블로그 공용.
   ★ launchBrowser(feature:"inflow")로 방문마다 프록시 IP 로테이션.
   ★ 안전 리밋: 방문 텀 사용자 임의 지정(랜덤), 글 분량 기반 체류, 회차 한도(onQuota).
   ⚠️ 네이버 모바일 DOM은 자주 바뀜 → 셀렉터 방어적. 실기기 검증 필요.
   ══════════════════════════════════════════════════════════════════════ */
export type InflowTarget =
  | { type: "place"; placeId: string; domain?: string; placeUrl?: string }
  | { type: "blog"; blogId: string; logNo?: string }
  | { type: "store"; storeUrl: string; storeId?: string; productId?: string }; // 🛒 스마트스토어(네이버쇼핑) 상품

const INFLOW_MOBILE_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.1 Mobile/15E148 Safari/604.1";
const INFLOW_PC_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
const inflowSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const inflowRnd = (a: number, b: number) => a + Math.random() * (b - a);
const inflowRndInt = (a: number, b: number) => Math.floor(inflowRnd(a, b + 1));
const inflowInterruptibleWait = async (ms: number, shouldStop?: () => boolean): Promise<boolean> => {
  let remaining = Math.max(0, ms);
  while (remaining > 0) {
    if (shouldStop?.()) return false;
    const slice = Math.min(1000, remaining);
    await inflowSleep(slice);
    remaining -= slice;
  }
  return !shouldStop?.();
};

// 체류시간(초) 결정 — 강도별 정해진 시간(빠르게20/보통60/꼼꼼히180)에서 방문마다 ±오차.
//   customSec>0이면 강도 대신 사용자가 직접 지정한 시간을 쓴다(3분 이상도 자유). 오차로 봇 티를 줄인다.
function decideDwellSec(baseSec: number, customSec: number): number {
  const target = customSec > 0 ? customSec : baseSec;
  return Math.max(3, Math.round(target * inflowRnd(0.8, 1.2))); // ±20% 랜덤 오차
}

// 🩺 실패 원인 정밀 진단 — 페이지 상태를 읽어 "왜 안 됐는지" 정확히 로그로.
//   네이버가 나중에 뭘 바꿔도 이 로그만 보면 원인 즉시 파악(차단/로그인/노출없음/구조변경 등).
async function inflowDiagnose(page: any, target: InflowTarget, log: (m: string) => void): Promise<void> {
  try {
    const body = await page.evaluate(() => (document.body?.innerText || "").slice(0, 500)).catch(() => "");
    const url = (() => { try { return page.url(); } catch { return ""; } })();
    if (/접속이 일시적으로 제한|shopping_stop|비정상적인 접근|abusing/i.test(body)) {
      log("  🚫 [진단] 네이버 봇 감지 차단 — 자동화 접속으로 막혔어요. 속도를 늦추거나(텀↑) 잠시 후 다시. 반복되면 이 IP를 잠시 쉬게 하세요.");
    } else if (/로그인|nidlogin|아이디 또는 전화번호/i.test(body) && /nid\.naver\.com|login/i.test(url)) {
      log("  🔑 [진단] 로그인 필요 — 계정을 선택하거나 로그인 세션이 필요해요(저장·찜 등 액션).");
    } else if (/일시적인 오류|잠시 후 다시|서비스 점검/i.test(body)) {
      log("  🌐 [진단] 네이버 일시 오류/점검 — 잠시 후 재시도하세요.");
    } else {
      log("  🔍 [진단] 검색결과에 대상이 노출되지 않았어요(현재 순위가 낮음). 홈 폴백으로 시도하거나 키워드를 바꿔보세요.");
    }
  } catch { log("  ⚠️ [진단] 페이지 상태를 읽지 못했어요(네트워크/타임아웃 가능)."); }
}

// 검색결과를 스크롤하며 대상(플레이스/블로그) 링크를 찾아 클릭 진입. 성공 시 진입한 page 반환.
//  ★플레이스는 지도(map)로 새지 않게 "플레이스 상세" 링크를 우선 클릭한다.
async function inflowFindAndEnter(page: any, target: InflowTarget, log: (m: string) => void): Promise<any | null> {
  const needle = target.type === "place" ? String(target.placeId) : target.type === "blog" ? String(target.blogId) : String((target as any).productId || (target as any).storeId || "");
  const enterVia = async (link: any, s: number) => {
    log(`  🎯 검색결과에서 대상 발견(약 ${s + 1}스크롤 지점) → 클릭 진입`);
    const ctx = page.context();
    const before = ctx.pages().length;
    await Promise.all([
      page.waitForNavigation({ timeout: 15000 }).catch(() => {}),
      link.click({ timeout: 8000 }).catch(() => {}),
    ]);
    await page.waitForTimeout(inflowRndInt(1200, 2400));
    const pages = ctx.pages();
    return pages.length > before ? pages[pages.length - 1] : page;
  };
  // 🧑 실사용자 패턴 — 바로 첫 결과를 누르지 않고 검색결과를 먼저 훑어본다(비교 탐색 후 선택)
  try {
    log("  🧑 검색결과 훑어보는 중…(바로 안 누르고 비교)");
    for (let i = 0; i < inflowRndInt(2, 4); i++) {
      await page.mouse.wheel(0, inflowRndInt(500, 1100)).catch(() => {});
      await page.waitForTimeout(inflowRndInt(700, 1700));
    }
    await page.mouse.wheel(0, -inflowRndInt(600, 1400)).catch(() => {}); // 위로 다시 올려 재확인
    await page.waitForTimeout(inflowRndInt(500, 1200));
  } catch { /* 비교 탐색 실패는 무시하고 바로 대상 탐색 */ }
  // 🛒 스마트스토어는 '쇼핑 검색'에서 찾아야 한다 → 일반 검색창을 쇼핑검색으로 전환
  if (target.type === "store") {
    const kw = (() => { try { return decodeURIComponent(new URL(page.url()).searchParams.get("query") || ""); } catch { return ""; } })();
    const shopUrl = `https://search.shopping.naver.com/search/all?query=${encodeURIComponent(kw)}`;
    log(`  🛒 쇼핑 검색으로 상품 찾는 중… "${kw}"`);
    await page.goto(shopUrl, { waitUntil: "domcontentloaded", timeout: 25000 }).catch(() => {});
    await page.waitForTimeout(inflowRndInt(1400, 2800));
  }
  for (let s = 0; s < 8; s++) {
    if (target.type === "place") {
      // 1순위: 플레이스 상세 링크(place.naver.com/.../{id} 또는 /place/{id}) — 지도 링크 제외
      const placeLink = await page.evaluateHandle((id: string) => {
        const as = Array.from(document.querySelectorAll("a")) as HTMLAnchorElement[];
        const detail = as.find(a => a.href.includes(id) && /place\.naver\.com|\/place\/|m\.place/.test(a.href) && !/map\.naver\.com\/p\/search/.test(a.href));
        return detail || as.find(a => a.href.includes(id)) || null;
      }, needle).catch(() => null);
      const el = placeLink && placeLink.asElement ? placeLink.asElement() : null;
      if (el) return await enterVia(el, s);
    } else if (target.type === "store") {
      // 🛒 상품ID 또는 스토어명이 들어간 상품 링크를 검색결과에서 찾아 클릭
      const sid = String((target as any).storeId || "");
      const link = await page.evaluateHandle((args: { pid: string; sid: string }) => {
        const as = Array.from(document.querySelectorAll("a")) as HTMLAnchorElement[];
        return as.find(a => (args.pid && a.href.includes(args.pid)) || (args.sid && a.href.includes("smartstore.naver.com/" + args.sid))) || null;
      }, { pid: String((target as any).productId || ""), sid }).catch(() => null);
      const el = link && link.asElement ? link.asElement() : null;
      if (el) return await enterVia(el, s);
    } else {
      const link = await page.$(`a[href*="${needle}"]`).catch(() => null);
      if (link) return await enterVia(link, s);
    }
    // 사람처럼 스크롤하며 lazy 로드된 결과 더 탐색
    await page.mouse.wheel(0, inflowRndInt(700, 1300));
    await page.waitForTimeout(inflowRndInt(700, 1600));
  }
  // 🛒 스토어 폴백 — 검색결과서 못 찾으면 상품 URL로 직접 진입(방문·체류는 유효)
  if (target.type === "store") {
    const url = (target as any).storeUrl;
    log(`  🛒 검색결과에 상품이 안 보여 상품 페이지로 직접 진입 → ${url}`);
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 20000 }).catch(() => {});
    await page.waitForTimeout(inflowRndInt(1200, 2400));
    return page;
  }
  // 🏢 플레이스 폴백(B) — 검색결과에서 못 찾으면(또는 지도로만 뜨면) 플레이스 상세로 직접 진입
  if (target.type === "place") {
    const dom = (target as any).domain || "place";
    const url = `https://m.place.naver.com/${dom}/${needle}/home`;
    log(`  🏢 검색결과에 플레이스 카드가 안 보여 상세로 직접 진입 → ${url}`);
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 20000 }).catch(() => {});
    await page.waitForTimeout(inflowRndInt(1200, 2400));
    return page;
  }
  // 🏠 홈 폴백(블로그) — 검색결과서 못 찾으면 블로그 홈으로 직접 진입해 최신 글 중 랜덤으로 읽는다.
  if (target.type === "blog") {
    try {
      log(`  🏠 검색결과에 없어 블로그 홈(${target.blogId})으로 직접 진입 → 랜덤 글 읽기`);
      let pick = "";
      // ★1차: 검증본 글목록 API 재사용(reusable_assets 원칙) — 홈 DOM을 긁으면 네이버 레이아웃 변경 시
      //   "글 목록 못 찾음"으로 들쭉날쭉했음. PostTitleListAsync/모바일 API로 실제 글 URL을 받아 바로 진입 → 안정.
      try {
        const { posts } = await fetchNaverPostList({ blogId: target.blogId, cookies: [], maxCount: 20, log: () => {} });
        if (posts.length) {
          const n = Math.min(posts.length, 20);
          pick = posts[inflowRndInt(0, n - 1)].url;
          log(`  📄 최신 글 ${n}개 중 랜덤 1개 진입 (검증 글목록 API)`);
        }
      } catch { /* API 실패 → DOM 폴백 */ }
      // ★2차 폴백: 홈 DOM 긁기(구버전 방식)
      if (!pick) {
        await page.goto(`https://m.blog.naver.com/${target.blogId}`, { waitUntil: "domcontentloaded", timeout: 20000 }).catch(() => {});
        await page.waitForTimeout(inflowRndInt(1400, 2600));
        const postLinks: string[] = await page.$$eval(
          'a[href*="logNo"], a[href*="/PostView"], a[href*="blog.naver.com"]',
          (as: any[], b: string) => Array.from(new Set(as.map((a: any) => a.href).filter((h: string) => h.includes(b) && /logNo=\d+|\/\d{6,}/.test(h)))).slice(0, 20),
          target.blogId
        ).catch(() => []);
        if (postLinks.length) {
          pick = postLinks[inflowRndInt(0, postLinks.length - 1)];
          log(`  📄 최신 글 ${postLinks.length}개 중 랜덤 1개 진입`);
        }
      }
      if (pick) {
        await page.goto(pick, { waitUntil: "domcontentloaded", timeout: 20000 }).catch(() => {});
        await page.waitForTimeout(inflowRndInt(1000, 2000));
        return page;
      }
      // 최후: 글을 못 찾아도 홈 방문은 유효
      await page.goto(`https://m.blog.naver.com/${target.blogId}`, { waitUntil: "domcontentloaded", timeout: 20000 }).catch(() => {});
      log("  🏠 홈 진입은 했으나 글 목록을 못 찾음 — 홈에서 체류");
      return page;
    } catch { /* fallthrough */ }
  }
  return null;
}

// 진입한 페이지에서 글 전체를 읽는 것처럼 체류(끝까지 스크롤).
//   baseSec=강도별 기준시간(빠르게20/보통60/꼼꼼히180), customSec>0이면 직접지정 시간을 우선 사용.
async function inflowDwellRead(page: any, log: (m: string) => void, shouldStop?: () => boolean, baseSec = 60, customSec = 0, targetType: "place" | "blog" | "store" = "blog"): Promise<void> {
  const sec = decideDwellSec(baseSec, customSec);
  const dwellVerb = targetType === "place" ? "📖 플레이스 둘러보는 중…" : targetType === "store" ? "📖 상품 상세 보는 중…" : "📖 글 읽는 중…";
  log(`  ${dwellVerb} (약 ${sec}초 체류${customSec > 0 ? " · 직접지정" : ""})`);
  const steps = Math.max(6, Math.round(sec / inflowRnd(2, 4)));
  const per = (sec * 1000) / steps;
  // 🧑 실사용자 패턴 — 균등 스크롤이 아니라 완급(빨리 훑다 관심구간 정독)+가끔 위로 재확인
  for (let s = 0; s < steps; s++) {
    if (shouldStop?.()) break;
    const r = Math.random();
    if (r < 0.2) {
      // 관심 구간 — 천천히 정독(작게 스크롤 + 길게 멈춤)
      await page.mouse.wheel(0, inflowRndInt(120, 300)).catch(() => {});
      if (!await inflowInterruptibleWait(Math.round(per * inflowRnd(1.4, 2.2)), shouldStop)) break;
    } else if (r < 0.35) {
      // 위로 다시 올려 재확인(사람처럼)
      await page.mouse.wheel(0, -inflowRndInt(200, 500)).catch(() => {});
      if (!await inflowInterruptibleWait(Math.round(per * inflowRnd(0.6, 1.0)), shouldStop)) break;
    } else {
      // 보통 속도로 훑기
      await page.mouse.wheel(0, inflowRndInt(350, 780)).catch(() => {});
      if (!await inflowInterruptibleWait(Math.round(per * inflowRnd(0.7, 1.3)), shouldStop)) break;
    }
  }
  if (shouldStop?.()) return;
  // 다 읽고 살짝 위로(사람처럼)
  await page.mouse.wheel(0, -inflowRndInt(300, 800)).catch(() => {});
  await inflowInterruptibleWait(inflowRndInt(800, 1800), shouldStop);
}

// 저장/공감 등 액션(로그인 필요). 셀렉터는 방어적 — 실패해도 유입 자체는 유효.
type InflowActions = { save?: boolean; like?: boolean; share?: boolean; directions?: boolean; call?: boolean; booking?: boolean; talk?: boolean; review?: boolean; reviewText?: string; wish?: boolean; cart?: boolean; optionView?: boolean; rate?: number; loginAvailable?: boolean };
// 🔎 공유/더보기 버튼 못 찾을 때 실제 DOM의 후보 요소(text·class·aria)를 로그로 덤프 → 셀렉터 교정용
async function dumpShareCandidates(page: any, log: (m: string) => void): Promise<void> {
  try {
    const items = await page.$$eval('a,button,[role="button"]', (els: any[]) => els.slice(0, 120).map((e: any) => ({
      t: (e.textContent || "").trim().slice(0, 24), c: String(e.className || "").slice(0, 50), a: e.getAttribute("aria-label") || ""
    })).filter((x: any) => /공유|share|더보기|more|etc|복사|copy|스크랩|보내기|sns/i.test(x.t + " " + x.c + " " + x.a)));
    log("  🔎 [DOM진단] 공유/더보기 후보 " + items.length + "개: " + JSON.stringify(items.slice(0, 18)));
  } catch (e: any) { log("  🔎 [DOM진단] 후보 수집 실패: " + (e?.message || "")); }
}

async function inflowActions(page: any, target: InflowTarget, actions: InflowActions, log: (m: string) => void): Promise<void> {
  // 🎲 액션 확률 — rate(0~1)면 그 확률만큼만 발동(진짜 사람처럼 매번 안 함). 리뷰는 명시 액션이라 확률 제외.
  const rate = typeof actions.rate === "number" ? actions.rate : 1;
  const roll = (on?: boolean) => !!on && (rate >= 1 || Math.random() < rate);
  const clickFirst = async (sels: string[], label: string) => {
    for (const sl of sels) {
      const b = await page.$(sl).catch(() => null);
      if (b) {
        try {
          await b.click();
          await page.waitForTimeout(inflowRndInt(800, 1900));
          const currentUrl = String(page.url?.() || "");
          if (/nid\.naver\.com|nidlogin|\/login/i.test(currentUrl)) return false;
          log(label);
          return true;
        } catch { return false; }
      }
    }
    return false;
  };
  const skipLoginAction = (enabled?: boolean) => !!enabled && !actions.loginAvailable;
  // 방문의도 신호(길찾기·전화·예약·톡톡)는 플레이스 순위에 가장 강해 확률 하한(85%)을 둬 강하게 준다(약간 랜덤=봇 티 방지).
  const rollStrong = (on?: boolean) => !!on && (rate >= 1 || Math.random() < Math.max(rate, 0.85));
  try {
    if (target.type === "place") {
      // 방문의도 신호(길찾기·전화·예약)가 플레이스 순위에 가장 강함.
      //   ★셀렉터는 m.place.naver.com 실측 기준(2026-09): 텍스트가 정확히 일치하는 a/button을 우선.
      if (skipLoginAction(actions.save)) log("  🔑 저장: 로그인 필요 — 건너뜀");
      else if (roll(actions.save))  { if (!await clickFirst(['a:text-is("저장")', 'button:text-is("저장")', 'a:has-text("저장")', '[class*="save"]'], "  💾 저장")) log("  ⚙️ [진단] 저장 버튼 못 찾음 — 로그인 필요하거나 네이버가 화면을 바꿨을 수 있어요(개발자 확인)."); }
      if (rollStrong(actions.directions)) { if (!await clickFirst(['a[href*="route"]', 'a[href*="launchApp/route"]', 'a:text-is("길찾기")', 'a:has-text("길찾기")'], "  🧭 길찾기")) log("  ⚙️ [진단] 길찾기 버튼 못 찾음 — 화면 구조 변경 의심(개발자 확인)."); }
      if (rollStrong(actions.call)) {
        // 전화는 tel: 링크 — 실제 통화 앱을 띄우지 않게 클릭 대신 '표시/포커스'로 관심 신호만.
        const telSel = ['a[href^="tel:"]', 'a:text-is("전화")', 'a:has-text("전화")'];
        let hit = false;
        for (const sl of telSel) {
          const b = await page.$(sl).catch(() => null);
          if (b) { await b.scrollIntoViewIfNeeded().catch(() => {}); await b.hover().catch(() => {}); log("  📞 전화(번호 노출)"); hit = true; await page.waitForTimeout(inflowRndInt(700, 1500)); break; }
        }
        if (!hit) log("  ⚠️ 전화 버튼 없음(이 가게 미설정)");
      }
      // 예약·톡톡은 링크를 눌러 '살짝 진입(관심 신호)'만 준다 → 로그인 없이도 실행(실제 예약완료·메시지전송이 아님)
      if (rollStrong(actions.booking)) { const ok = await clickFirst(['a[href*="booking.naver"]', 'a:text-is("예약")', 'a:has-text("예약")', 'a:has-text("네이버 예약")'], "  📅 예약 진입"); if (ok) { await page.waitForTimeout(inflowRndInt(2000, 3500)); log("  📅 예약 페이지 잠시 둘러봄(관심 신호↑)"); } else log("  ⚙️ [진단] 예약 버튼 못 찾음 — 예약 미설정이거나 네이버 화면 변경 의심."); }
      if (rollStrong(actions.talk)) { const ok = await clickFirst(['a[href*="talk.naver"]', 'a[href*="talk"]', 'a:text-is("톡톡")', 'a:has-text("톡톡")', 'a:has-text("문의")'], "  💬 톡톡 진입"); if (ok) { await page.waitForTimeout(inflowRndInt(2000, 3500)); log("  💬 톡톡 화면 잠시 머묾(관심 신호↑)"); } else log("  ⚙️ [진단] 톡톡 버튼 못 찾음 — 톡톡 미설정이거나 네이버 화면 변경 의심."); }
      // ✍️ 리뷰 작성(관리자 락 기본잠금 — 가짜리뷰 밴 위험). 리뷰탭→작성 진입 후 텍스트 입력·등록.
      if (actions.review && actions.reviewText && !actions.loginAvailable) log("  🔑 리뷰 작성: 로그인 필요 — 건너뜀");
      else if (actions.review && actions.reviewText) {
        try {
          await clickFirst(['a:has-text("리뷰")', '[class*="review"] a', 'a:has-text("리뷰쓰기")', 'button:has-text("리뷰")'], "  ✍️ 리뷰 탭 진입");
          await page.waitForTimeout(inflowRndInt(1200, 2400));
          const box = await page.$('textarea, [contenteditable="true"]').catch(() => null);
          if (box) {
            await box.click().catch(() => {});
            await page.keyboard.type(actions.reviewText, { delay: inflowRndInt(40, 110) }).catch(() => {});
            await page.waitForTimeout(inflowRndInt(600, 1400));
            await clickFirst(['button:has-text("등록")', 'button:has-text("완료")', 'button[type="submit"]'], "  ✍️ 리뷰 등록");
          } else { log("  ⚠️ 리뷰 작성 실패(로그인·화면구조 확인)"); }
        } catch { log("  ⚠️ 리뷰 작성 실패(로그인·화면구조 확인)"); }
      }
    }
    // 🛒 스마트스토어 — 옵션·이미지 탐색(로그인 불필요, 관심 신호) + 찜·장바구니(로그인 필요)
    if (target.type === "store") {
      if (rollStrong(actions.optionView)) {
        // 옵션 선택 UI·상세 이미지를 눌러보며 둘러본다(구매 고민하는 손님처럼)
        const ok = await clickFirst(['a:has-text("상세정보")', 'a:has-text("리뷰")', 'button:has-text("옵션")', '[class*="option"] button', 'a:has-text("상품정보")'], "  🔍 옵션·상세 탐색");
        if (ok) { await page.waitForTimeout(inflowRndInt(1500, 3000)); await page.mouse.wheel(0, inflowRndInt(600, 1400)).catch(() => {}); }
      }
      if (skipLoginAction(actions.wish)) log("  🔑 찜: 로그인 필요 — 건너뜀");
      else if (roll(actions.wish)) { if (!await clickFirst(['a:has-text("찜")', 'button:has-text("찜")', '[class*="wish"] button', 'button[class*="wish"]', 'a[class*="wish"]'], "  💚 찜(관심상품)")) log("  ⚙️ [진단] 찜 버튼 못 찾음 — 로그인 필요하거나 네이버 화면 변경 의심."); }
      if (skipLoginAction(actions.cart)) log("  🔑 장바구니: 로그인 필요 — 건너뜀");
      else if (roll(actions.cart)) { if (!await clickFirst(['button:has-text("장바구니")', 'a:has-text("장바구니")', '[class*="cart"] button', 'button[class*="cart"]'], "  🛒 장바구니 담기")) log("  ⚙️ [진단] 장바구니 버튼 못 찾음 — 로그인 필요하거나 네이버 화면 변경 의심."); }
    }
    if (target.type === "blog" && skipLoginAction(actions.like)) log("  🔑 블로그 공감: 로그인 필요 — 건너뜀");
    else if (target.type === "blog" && roll(actions.like)) {
      if (!await clickFirst(['a.u_likeit_list_btn', 'a[class*="like"]', 'button[class*="sympathy"]', 'a:has-text("공감")'], "  💚 블로그 공감")) log("  ⚙️ [진단] 공감 버튼 못 찾음 — 로그인 필요하거나 네이버 화면 변경 의심.");
    }
    // 🔗 공유
    if (roll(actions.share)) {
      if (target.type === "blog") {
        // 블로그(PC/모바일 새 뷰)는 공유가 '더보기(⋯/⋮)' 메뉴 안에 있음(실측 스샷 2026-09-04).
        //   ① 더보기·공유 트리거 클릭 → ② 공유 레이어에서 'URL 복사'만(카톡·밴드 등 외부이동/새창 방지) → ③ Esc로 닫기.
        //   ★플레이스용 [class*="share"] a 를 블로그에 쓰면 카카오톡·밴드 공유 링크를 눌러 창이 튀므로 분리한다.
        // 실측 DOM(2026-09-05 진단): 공유 트리거=<a class="naver-splugin">공유하기</a>, 복사=<a class="_copy_url">URL복사</a>(띄어쓰기 없음).
        //   ① URL복사(_copy_url)가 이미 보이면 그것만 눌러 URL 복사 = 안전한 공유 신호(외부창 X). ② 없으면 공유하기(naver-splugin) 열고 복사.
        let copied = await clickFirst([
          'a._copy_url', '._copy_url', '[class*="_copy_url"]', 'a:has-text("URL복사")', 'button:has-text("URL복사")',
        ], "  🔗 URL 복사(공유 신호)");
        if (!copied) {
          const opened = await clickFirst([
            'a.naver-splugin', '.naver-splugin', '[class*="naver-splugin"]',
            'a:has-text("공유하기")', 'button:has-text("공유하기")',
            'button[aria-label*="공유"]', 'a[aria-label*="공유"]',
            'button.btn_share', 'a.btn_share', 'button[class*="share"]',
            'button[aria-label*="더보기"]', 'button.btn_more', 'a.btn_more', '.btn_etc', '[class*="MoreMenu"]',
          ], "  🔗 공유 메뉴 열기");
          if (opened) {
            await page.waitForTimeout(inflowRndInt(700, 1500));
            copied = await clickFirst([
              'a._copy_url', '._copy_url', 'a:has-text("URL복사")', 'button:has-text("URL복사")',
              'button:has-text("URL 복사")', 'a:has-text("URL 복사")', 'button:text-is("복사")', 'a:text-is("복사")', 'a:has-text("링크 복사")',
            ], "  🔗 링크 복사(공유 신호)");
            if (!copied) log("  🔗 공유 레이어 열림 — 복사 버튼은 못 찾아 열람 신호만");
            await page.keyboard.press("Escape").catch(() => {});
          } else {
            log("  ⚙️ [진단] 블로그 공유 버튼 못 찾음 — 더보기(⋯) 메뉴 셀렉터 확인 필요."); await dumpShareCandidates(page, log);
          }
        }
      } else {
        if (!await clickFirst(['a.spi_sns_share', 'a[class*="spi_sns_share"]', 'a:text-is("공유")', 'a:has-text("공유")', 'button:has-text("공유")', '[class*="share"] a'], "  🔗 공유")) { log("  ⚙️ [진단] 공유 버튼 못 찾음 — 네이버 화면 변경 의심."); await dumpShareCandidates(page, log); }
      }
    }
  } catch (e: any) {
    log(`  ⚠️ 액션 실패(무시): ${e?.message || e} (실기기 셀렉터 교정 필요)`);
  }
}

// 🌀 풀퍼널 — 단순 방문을 넘어 "진짜 팬" 행동(여러 글·탭 둘러보기 + 이웃). 체류·페이지뷰·이웃 극대화.
async function inflowFullFunnel(page: any, target: InflowTarget, log: (m: string) => void, shouldStop?: () => boolean): Promise<void> {
  try {
    if (target.type === "blog") {
      log("  🌀 풀퍼널 — 이 블로그의 다른 글도 둘러봐요");
      const bid = target.blogId;
      const links: string[] = await page.$$eval(
        'a[href*="blog.naver.com"], a[href*="PostView"], a[href*="logNo"]',
        (as: any[], b: string) => Array.from(new Set(as.map((a: any) => a.href).filter((h: string) => h.includes(b) && /logNo|\/\d{6,}/.test(h)))).slice(0, 12),
        bid
      ).catch(() => []);
      const visits = Math.min(links.length, inflowRndInt(2, 3));
      for (let j = 0; j < visits; j++) {
        if (shouldStop?.()) break;
        const url = links[inflowRndInt(0, links.length - 1)];
        if (!url) continue;
        await page.goto(url, { waitUntil: "domcontentloaded", timeout: 20000 }).catch(() => {});
        log(`    📖 다른 글 읽는 중 (${j + 1}/${visits})`);
        await inflowDwellRead(page, log, shouldStop);
      }
      // 이웃추가 시도(진짜 팬 신호)
      for (const sl of ['a:has-text("이웃추가")', 'button:has-text("이웃추가")', 'a:has-text("서로이웃")', '[class*="buddy"] a']) {
        const b = await page.$(sl).catch(() => null);
        if (b) { await b.click().catch(() => {}); log("    🤝 이웃추가"); await page.waitForTimeout(inflowRndInt(1000, 2200)); break; }
      }
    } else {
      const isStore = target.type === "store";
      log(isStore ? "  🌀 풀퍼널 — 상세정보·리뷰·연관상품을 둘러봐요" : "  🌀 풀퍼널 — 메뉴·사진·리뷰를 둘러봐요");
      const tabs: [string, string[]][] = isStore ? [
        ["상세정보", ['a:has-text("상세정보")', 'a:has-text("상품정보")', '[class*="detail"] a']],
        ["리뷰", ['a:has-text("리뷰")', '[class*="review"] a']],
        ["연관상품", ['a:has-text("연관")', 'a:has-text("함께")', '[class*="related"] a']],
      ] : [
        ["메뉴", ['a:has-text("메뉴")', '[class*="menu"] a']],
        ["사진", ['a:has-text("사진")', '[class*="photo"] a']],
        ["리뷰", ['a:has-text("리뷰")', '[class*="review"] a']],
      ];
      for (const [name, sels] of tabs) {
        if (shouldStop?.()) break;
        for (const sl of sels) {
          const b = await page.$(sl).catch(() => null);
          if (b) {
            await b.click().catch(() => {});
            log(`    📑 ${name} 둘러보는 중`);
            for (let s = 0; s < inflowRndInt(2, 4); s++) { await page.mouse.wheel(0, inflowRndInt(300, 700)).catch(() => {}); await page.waitForTimeout(inflowRndInt(700, 1600)).catch(() => {}); }
            break;
          }
        }
      }
    }
  } catch (e: any) {
    log(`  ⚠️ 풀퍼널 일부 건너뜀: ${e?.message || e}`);
  }
}

/* 💬 공개 방문자 리뷰 수집 — 로그인 없이 플레이스 리뷰탭에서 리뷰 문장만 긁는다(감정분석용).
   반환: 리뷰 텍스트 배열(노이즈 필터). AI 분석은 앱(기존 키)에서. */
export async function collectPlaceReviews(params: { placeUrl: string; limit?: number; onLog?: (m: string) => void }): Promise<{ reviews: string[] } | { error: string }> {
  const parsed = await resolvePlaceUrl(params.placeUrl);
  if (!parsed) return { error: "플레이스 주소를 인식하지 못했어요" };
  const limit = params.limit || 30;
  let browser: any = null;
  try {
    browser = await launchBrowser("", { headless: true, feature: "inflow", log: params.onLog });
    const ctx = await browser.newContext({ userAgent: INFLOW_MOBILE_UA, viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, locale: "ko-KR" });
    await ctx.addInitScript(ANTI_DETECTION_SCRIPT);
    const page = await ctx.newPage();
    await page.goto(`https://m.place.naver.com/${parsed.domain}/${parsed.placeId}/review/visitor`, { waitUntil: "domcontentloaded", timeout: 25000 });
    await page.waitForTimeout(inflowRndInt(2500, 4000));
    // 스크롤로 리뷰 더 로드
    for (let i = 0; i < 3; i++) { await page.mouse.wheel(0, 1500).catch(() => {}); await page.waitForTimeout(1200); }
    const reviews: string[] = await page.evaluate(() => {
      const nodes = Array.from(document.querySelectorAll("div,span,p"));
      const out: string[] = [];
      for (const n of nodes) {
        const t = (n.textContent || "").trim();
        if (t.length >= 15 && t.length <= 300 && (n as any).children.length <= 1 && /[가-힣]/.test(t)
          && !/영업|메뉴|예약|길찾기|전화|방문일|인증 수단|더보기|리뷰 쓰기|동영상|숏리뷰|영수증|\d{4}년|키워드를 선택한 인원|명이 선택|이 키워드|팔로워|팔로우|사장님|답글|블로그|\d+명$/.test(t)
          && /[.!?요다임음죠네까]$|맛|친절|분위기|서비스|추천|만족|재방문/.test(t)) {  // 리뷰스러운 종결·감정 단어 있는 것만
          out.push(t);
        }
      }
      return Array.from(new Set(out));
    }).catch(() => []);
    return { reviews: reviews.slice(0, limit) };
  } catch (e: any) {
    return { error: e?.message || "리뷰 수집 실패" };
  } finally {
    if (browser) await browser.close().catch(() => {});
  }
}

/* 📍 플레이스 순위 측정 — 키워드로 검색해 내 placeId가 몇 위인지. crawlPlaces 재사용.
   반환: rank(1~N, 없으면 null) + 총 스캔 수. 리포트/오토파일럿이 이걸 저장해 추이로 씀. */
export async function measurePlaceRank(params: { keyword: string; placeUrl: string; accountId?: string; ownerUserId?: string | null; onLog?: (m: string) => void }): Promise<{ rank: number | null; scanned: number } | { error: string }> {
  const parsed = await resolvePlaceUrl(params.placeUrl);
  if (!parsed) return { error: "플레이스 주소를 인식하지 못했어요" };
  try {
    const list = await crawlPlaces({ accountId: params.accountId || "", query: params.keyword, count: 30, ownerUserId: params.ownerUserId || null, onLog: params.onLog });
    const idx = list.findIndex((p) => String(p.placeId) === String(parsed.placeId));
    return { rank: idx >= 0 ? idx + 1 : null, scanned: list.length };
  } catch (e: any) { return { error: e?.message || "순위 측정 실패" }; }
}

/* 📝 블로그 글 순위 측정 — 키워드로 통합검색(모바일 블로그탭)해서 내 (blogId/logNo)가 몇 위인지.
   measurePlaceRank의 블로그 짝. 익명 브라우저(로그인 불필요)로 searchRealRank 재사용. 오토파일럿이 사용. */
export async function measureBlogRank(params: { keyword: string; blogId: string; logNo: string; accountId?: string; onLog?: (m: string) => void }): Promise<{ rank: number | null; scanned: number } | { error: string }> {
  const log = params.onLog || (() => {});
  const blogId = (params.blogId || "").trim();
  const logNo = (params.logNo || "").trim();
  if (!blogId || !logNo) return { error: "블로그 글 주소를 인식하지 못했어요" };
  let browser: any = null;
  try {
    browser = await launchBrowser(params.accountId || "", { headless: true, feature: "inflow", log });
    const ctx = await browser.newContext({ userAgent: INFLOW_MOBILE_UA, viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, locale: "ko-KR" });
    await ctx.addInitScript(ANTI_DETECTION_SCRIPT);
    try {
      const r = await searchRealRank(ctx, blogId, logNo, params.keyword, log);
      return { rank: r.rank, scanned: r.total };
    } finally { await ctx.close().catch(() => {}); }
  } catch (e: any) { return { error: e?.message || "순위 측정 실패" }; }
  finally { if (browser) await browser.close().catch(() => {}); }
}

/* 🩺 플레이스 최적화 진단 — 상세페이지를 읽어 "순위 오르려면 뭘 채워야 하는지" 항목별 점검.
   ★순위는 트래픽만으로 안 오름: 리뷰·정보완성·사진·소식·방문의도수단이 종합 점수. 이걸 실측해 처방.
   반환: 항목별 ok/값 + 100점 만점 점수 + 부족항목(처방). */
export async function diagnosePlace(params: { placeUrl: string; onLog?: (m: string) => void }): Promise<{
  score: number; items: { key: string; label: string; ok: boolean; value: string; tip: string }[];
} | { error: string }> {
  const log = params.onLog || (() => {});
  const parsed = await resolvePlaceUrl(params.placeUrl);
  if (!parsed) return { error: "플레이스 주소를 인식하지 못했어요" };
  let browser: any = null;
  try {
    browser = await launchBrowser("", { headless: true, feature: "inflow", log });
    const ctx = await browser.newContext({ userAgent: INFLOW_MOBILE_UA, viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, locale: "ko-KR" });
    await ctx.addInitScript(ANTI_DETECTION_SCRIPT);
    const page = await ctx.newPage();
    await page.goto(`https://m.place.naver.com/${parsed.domain}/${parsed.placeId}/home`, { waitUntil: "domcontentloaded", timeout: 25000 });
    await page.waitForTimeout(inflowRndInt(2000, 3200));
    const raw = await page.evaluate(() => {
      const t = document.body.innerText || "";
      const num = (re: RegExp) => { const m = t.match(re); return m ? parseInt(m[1].replace(/,/g, "")) : 0; };
      return {
        review: num(/리뷰\s*([\d,]+)/),
        blogReview: num(/블로그리뷰\s*([\d,]+)/),
        hasHours: /영업시간|영업 중|영업종료|영업 종료/.test(t),
        photos: document.querySelectorAll("img").length,
        hasNews: /소식|공지/.test(t),
        hasBooking: /예약/.test(t),
        hasTalk: /톡톡|문의/.test(t),
        hasDir: /길찾기/.test(t),
      };
    });
    // 항목별 점검(각 배점) — 리뷰가 순위에 가장 강함
    const items = [
      { key: "review", label: "방문자 리뷰", ok: raw.review >= 50, value: `${raw.review}개`, tip: raw.review >= 50 ? "충분해요" : "리뷰가 적어요 — 방문 손님께 리뷰를 부탁하거나 리뷰 이벤트를 여세요(순위에 가장 큼).", w: 30 },
      { key: "info", label: "영업정보", ok: raw.hasHours, value: raw.hasHours ? "등록됨" : "미흡", tip: raw.hasHours ? "잘 채워졌어요" : "영업시간·주소 등 기본정보를 채우세요.", w: 15 },
      { key: "photo", label: "사진", ok: raw.photos >= 15, value: `${raw.photos}장 노출`, tip: raw.photos >= 15 ? "풍부해요" : "대표사진·메뉴사진을 더 올리세요(첫인상=클릭률).", w: 15 },
      { key: "news", label: "소식", ok: raw.hasNews, value: raw.hasNews ? "있음" : "없음", tip: raw.hasNews ? "최신 소식 좋아요" : "소식을 주기적으로 올리면 활성 매장으로 평가돼요.", w: 15 },
      { key: "booking", label: "예약", ok: raw.hasBooking, value: raw.hasBooking ? "가능" : "미설정", tip: raw.hasBooking ? "방문의도 신호 확보" : "네이버 예약을 켜면 예약 클릭이 순위 신호가 돼요.", w: 10 },
      { key: "talk", label: "톡톡", ok: raw.hasTalk, value: raw.hasTalk ? "가능" : "미설정", tip: raw.hasTalk ? "문의 채널 확보" : "톡톡을 켜면 문의가 순위 신호가 돼요.", w: 8 },
      { key: "dir", label: "위치/길찾기", ok: raw.hasDir, value: raw.hasDir ? "정상" : "확인필요", tip: raw.hasDir ? "정상" : "주소를 정확히 등록하세요.", w: 7 },
    ];
    const score = items.reduce((s, it) => s + (it.ok ? it.w : 0), 0);
    log(`🩺 진단 완료 — 최적화 점수 ${score}/100`);
    return { score, items: items.map(({ w, ...rest }) => rest) };
  } catch (e: any) {
    return { error: e?.message || "진단 실패" };
  } finally {
    if (browser) await browser.close().catch(() => {});
  }
}

export async function searchInflow(params: {
  accountId: string;
  ownerUserId?: string;
  authToken?: string;               // 검증된 회원 또는 관리자 세션 — 민감 프록시 RPC용
  keywords: string[];              // 여러 키워드 로테이션
  keywordWeights?: number[];       // 키워드별 비중(가중치). 없으면 균등
  target: InflowTarget;            // 플레이스 or 블로그(단일)
  targets?: InflowTarget[];        // 여러 대상(있으면 방문마다 로테이션)
  rounds: number;                  // 이번 실행 방문 횟수(한도 내)
  dwellBaseSec?: number;           // 체류 강도별 기준시간(초): 빠르게20/보통60/꼼꼼히180
  dwellCustomSec?: number;         // 직접지정 체류시간(초). 0이면 강도 기준시간 사용(3분↑ 자유)
  dataSaver?: "normal" | "save" | "max"; // 💾 데이터 절약: normal=다받음/save=영상·광고·폰트차단/max=이미지까지
  actionRate?: number;             // 액션 발동 확률(0~1). 1=매번
  device?: "mobile" | "pc" | "mix"; // 접속 기기(기본 모바일, mix=방문마다 랜덤)
  intervalSec?: [number, number];  // 방문 사이 텀(사용자 임의 지정, 랜덤)
  spreadHours?: number;            // ⏱️ 이 시간에 걸쳐 자연 분산(0=텀 그대로). 설정 시 텀 자동계산
  visible?: boolean;               // 🪟 브라우저 창 띄우기(테스트용, 기본 백그라운드)
  actions?: InflowActions;         // 저장·공감·공유·길찾기·전화·예약·톡톡·리뷰
  fullFunnel?: boolean;            // 🌀 풀퍼널(여러 글·탭 둘러보기 + 이웃)
  requireLogin?: boolean;          // 저장/공감 등 로그인 필요 액션 시
  accountIds?: string[];           // 🔄 다계정 로테이션 — 방문마다 다른 계정으로 로그인해 저장·찜·공감(계정 수만큼 증가). 각 계정 자기 프록시.
  onLog?: (m: string) => void;
  onProgress?: (done: number, total: number) => void;
  onShot?: (caption: string, dataUrl: string) => void; // 📸 단계별 화면 캡처(실제 뭘 하는지 눈으로)
  shouldStop?: () => boolean;
  onQuota?: () => Promise<boolean>; // 회차마다 한도 체크(false면 중단)
  onSuccess?: (target: InflowTarget) => Promise<void> | void; // ✅ 실제 유입 '성공' 시점에만 호출. 성공한 대상을 넘겨 대상별 통계 정확히(다중 대상 로테이션 대응)
}): Promise<{ done: number; success: number }> {
  const log = params.onLog || (() => {});
  const { keywords, target, rounds } = params;
  const targets = (params.targets && params.targets.length) ? params.targets : [target]; // 여러 대상(없으면 단일)
  const actionRate = typeof params.actionRate === "number" ? Math.max(0, Math.min(1, params.actionRate)) : 1;
  // 🎯 키워드 가중 선택 — weights 있으면 비중대로, 없으면 순차 로테이션
  const weights = params.keywordWeights && params.keywordWeights.length === keywords.length ? params.keywordWeights : null;
  const pickKeyword = (i: number): string => {
    if (!weights) return keywords[i % keywords.length];
    const total = weights.reduce((a, b) => a + Math.max(0, b), 0) || 1;
    let r = Math.random() * total;
    for (let k = 0; k < keywords.length; k++) { r -= Math.max(0, weights[k]); if (r <= 0) return keywords[k]; }
    return keywords[i % keywords.length];
  };
  let [tmin, tmax] = params.intervalSec || [30, 90];
  // ⏱️ 시간 분산 — spreadHours에 걸쳐 rounds회를 자연스럽게 흘려보냄(평균 텀=총시간/횟수, ±40% 랜덤)
  if (params.spreadHours && params.spreadHours > 0 && rounds > 1) {
    const avg = (params.spreadHours * 3600) / rounds;
    tmin = Math.max(20, Math.round(avg * 0.6));
    tmax = Math.round(avg * 1.4);
    log(`⏱️ 시간 분산 ON — ${params.spreadHours}시간에 걸쳐 자연스럽게(평균 텀 ~${Math.round(avg)}초)`);
  }
  let done = 0, success = 0, failStreak = 0;
  const FAIL_BRAKE = 5; // 🛡️ 연속 실패 임계 — 초과 시 자동 정지(계정 보호)

  // 🔄 로그인 액션에 쓸 계정 목록(다계정 로테이션). 없으면 단일 계정.
  const loginAccts = (params.accountIds && params.accountIds.length) ? params.accountIds.filter(Boolean) : (params.accountId ? [params.accountId] : []);
  const multiAcct = loginAccts.length > 1;
  // 계정별 로그인 쿠키를 lazy 캐시(방문마다 다시 로그인하지 않게)
  const cookieCache = new Map<string, any[] | null>();
  const getCookiesFor = async (acct: string): Promise<any[] | null> => {
    if (!params.requireLogin || !acct) return null;
    if (cookieCache.has(acct)) return cookieCache.get(acct) ?? null;
    let ck: any[] | null = null;
    try { ck = await ensureLiveSession(acct, log); }
    catch { log(`⚠️ 계정(${acct}) 로그인 세션 없음 — 이 계정의 저장·찜·공감은 건너뛰어요(체류·공유는 진행)`); }
    cookieCache.set(acct, ck); return ck;
  };

  if (multiAcct && params.requireLogin) log(`🔄 다계정 로테이션 — ${loginAccts.length}개 계정을 번갈아 로그인해 저장·찜·공감을 계정마다 실행해요(각 계정 자기 IP)`);
  const typeLabel = (t: InflowTarget) => t.type === "place" ? "플레이스" : t.type === "store" ? "스마트스토어" : "블로그";
  log(`🚀 검색유입 시작 — 대상 ${typeLabel(target)}, 키워드 ${keywords.length}개, 총 ${rounds}회 방문, 텀 ${tmin}~${tmax}초`);

  for (let i = 0; i < rounds; i++) {
    if (params.shouldStop?.()) { log("⏹️ 정지 요청 — 중단"); break; }
    if (params.onQuota && !(await params.onQuota())) { log("🛑 오늘 유입 한도 초과 — 중단(자정 초기화 또는 등급 상향)"); break; }

    const kw = pickKeyword(i);
    const curTarget = targets[i % targets.length];   // 여러 대상 로테이션
    const curLabel = curTarget.type === "place" ? "플레이스" : curTarget.type === "store" ? "스마트스토어 " + ((curTarget as any).storeId || "") : "블로그 " + (curTarget as any).blogId;
    log(`\n[${i + 1}/${rounds}] 🔍 "${kw}" → ${curLabel} 유입`);

    // 🔄 이번 방문에 쓸 로그인 계정(다계정이면 번갈아). 각 계정은 자기 배정 프록시로 접속.
    const acct = loginAccts.length ? loginAccts[i % loginAccts.length] : params.accountId;
    if (multiAcct && params.requireLogin) log(`  🔄 이번 방문 계정: ${acct}`);

    let browser: any = null;
    let proxyUnavailable = false;
    try {
      browser = await launchBrowser(acct, { headless: !params.visible, feature: "inflow", ownerUserId: params.ownerUserId, authToken: params.authToken, log });
      // 접속 기기 결정 — mix면 방문마다 랜덤(사람처럼 모바일/PC 섞임)
      const dev = params.device === "mix" ? (Math.random() < 0.5 ? "pc" : "mobile") : (params.device === "pc" ? "pc" : "mobile");
      const context = await browser.newContext(
        dev === "pc"
          ? { userAgent: INFLOW_PC_UA, viewport: { width: 1280, height: 800 }, locale: "ko-KR" }
          : { userAgent: INFLOW_MOBILE_UA, viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 3, locale: "ko-KR" }
      );
      await context.addInitScript(ANTI_DETECTION_SCRIPT);   // 🥷 봇 감지 회피(쇼핑·플레이스 안정성↑)
      // 💾 데이터 절약 — 프록시(GB) 아끼기. normal=다 받음 / save=영상·광고·폰트 차단 / max=이미지까지 차단.
      //    CSS·JS는 절대 안 막는다(막으면 버튼을 못 찾아 기능이 깨짐). 순위 신호(클릭·체류·저장)는 그대로 유지.
      const dataSaver = params.dataSaver || "normal";
      if (dataSaver !== "normal") {
        const AD_HOSTS = /doubleclick|googlesyndication|google-analytics|googletagmanager|adservice|criteo|taboola|scorecardresearch|facebook\.net|analytics|adsystem|ad\.naver|adcr\.naver|wcs\.naver|siape\.veta/i;
        await context.route("**/*", (route: any) => {
          try {
            const req = route.request();
            const type = req.resourceType();
            const url = req.url();
            if (AD_HOSTS.test(url)) return route.abort();               // 광고·트래킹(둘 다 차단)
            if (type === "media" || type === "font") return route.abort(); // 영상·폰트(둘 다 차단)
            if (dataSaver === "max" && type === "image") return route.abort(); // 초절약만 이미지 차단
            return route.continue();
          } catch { try { return route.continue(); } catch { return; } }
        });
        log(`  💾 데이터 절약 모드: ${dataSaver === "max" ? "초절약(이미지까지 차단)" : "절약(영상·광고·폰트 차단)"} — 프록시 GB 아껴요`);
      }
      const cookies = await getCookiesFor(acct);   // 🔄 이 방문 계정의 로그인 쿠키(다계정이면 계정별)
      if (cookies) await context.addCookies(cookies).catch(() => {});
      const page = await context.newPage();

      // 📸 화면 캡처 헬퍼 — onShot 있을 때만(용량 위해 축소·jpeg). 실패해도 유입 안 막게 삼킴.
      const shot = async (pg: any, caption: string) => {
        if (!params.onShot) return;
        try {
          const buf = await pg.screenshot({ type: "jpeg", quality: 45 });
          params.onShot(caption, `data:image/jpeg;base64,${buf.toString("base64")}`);
        } catch {}
      };

      const searchBase = dev === "pc" ? "https://search.naver.com/search.naver" : "https://m.search.naver.com/search.naver";
      await page.goto(`${searchBase}?query=${encodeURIComponent(kw)}`, { waitUntil: "domcontentloaded", timeout: 25000 });
      log(`  ${dev === "pc" ? "🖥️ PC" : "📱 모바일"} 검색결과 로드 완료 — 결과 탐색 중…`);
      await page.waitForTimeout(inflowRndInt(1200, 2600));
      await shot(page, `🔍 "${kw}" 검색결과`);

      const entered = await inflowFindAndEnter(page, curTarget, log);
      if (!entered) {
        await inflowDiagnose(page, curTarget, log);   // 🩺 왜 안 됐는지 정확히 로그로
        await shot(page, "⚠️ 대상 못 찾음");
        done++; failStreak++; params.onProgress?.(done, rounds);
      } else {
        await shot(entered, "🎯 대상 진입");
        await inflowDwellRead(entered, log, params.shouldStop, params.dwellBaseSec ?? 60, params.dwellCustomSec ?? 0, curTarget.type);
        if (params.shouldStop?.()) { log("⏹️ 정지 요청 — 액션 전 중단"); break; }
        await inflowActions(entered, curTarget, { ...(params.actions || {}), rate: actionRate, loginAvailable: !!cookies }, log);
        if (params.shouldStop?.()) { log("⏹️ 정지 요청 — 풀퍼널 전 중단"); break; }
        if (params.fullFunnel) await inflowFullFunnel(entered, curTarget, log, params.shouldStop);
        if (params.shouldStop?.()) { log("⏹️ 정지 요청 — 방문 종료"); break; }
        await shot(entered, "✅ 체류·액션 완료");
        success++; done++; failStreak = 0;
        await Promise.resolve(params.onSuccess?.(curTarget)).catch(() => {}); // 성공한 그 대상(curTarget)으로 통계 기록
        log(`  ✅ 유입 완료 (${kw}) — 누적 성공 ${success}회`);
        params.onProgress?.(done, rounds);
      }
    } catch (e: any) {
      const errorText = String(e?.message || e);
      proxyUnavailable = /proxy|ERR_TUNNEL|ERR_NO_SUPPORTED_PROXIES|407|dataimpulse|balance|quota|traffic limit/i.test(errorText);
      if (proxyUnavailable) log("⚠️ 프록시 사용량 초과/부족 — 중단합니다");
      else log(`  ❌ 방문 오류: ${errorText}`);
      done++; failStreak++; params.onProgress?.(done, rounds);
    } finally {
      if (browser) await browser.close().catch(() => {});
    }
    if (proxyUnavailable || params.shouldStop?.()) break;

    // 🛡️ 안전 브레이크 — 연속 실패가 임계를 넘으면 계정 보호를 위해 자동 정지
    if (failStreak >= FAIL_BRAKE) {
      log(`\n🛡️ 안전 브레이크 — ${FAIL_BRAKE}회 연속 실패(대상 못 찾음/차단 의심). 계정 보호를 위해 자동 정지합니다.`);
      break;
    }

    // 방문 텀(사용자 지정 랜덤) — 마지막 회차 뒤엔 생략, 정지 반응 위해 1초 단위 분할
    if (i < rounds - 1 && !params.shouldStop?.()) {
      const wait = Math.round(inflowRnd(tmin, tmax));
      log(`  ⏳ 다음 방문까지 ${wait}초 대기…`);
      if (!await inflowInterruptibleWait(wait * 1000, params.shouldStop)) { log("⏹️ 정지 요청 — 대기 중단"); break; }
    }
  }

  log(`\n🏁 검색유입 종료 — 총 ${done}회 방문, 성공 ${success}회`);
  return { done, success };
}
