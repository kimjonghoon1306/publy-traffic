import { chromium, BrowserContext } from "playwright";
import fs from "fs";
import path from "path";
import { deleteSession, hasSession, readSession, writeSession } from "./session-store";

const LEGACY_SESSION_DIRS = [path.join(__dirname, "../sessions")];
const sessionName = (userId: string) => `tistory_${userId}`;

export function tistorySessionExists(userId: string): boolean {
  return hasSession(sessionName(userId), LEGACY_SESSION_DIRS);
}
export function deleteTistorySession(userId: string): void { deleteSession(sessionName(userId), LEGACY_SESSION_DIRS); }

const ANTI_DETECTION_SCRIPT = `
  Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
  if (!window.chrome) window.chrome = { runtime: {}, loadTimes: () => {}, csi: () => {} };
  Object.defineProperty(navigator, 'languages', { get: () => ['ko-KR','ko','en-US','en'] });
`;

const LAUNCH_ARGS = [
  "--no-sandbox",
  "--disable-blink-features=AutomationControlled",
  "--no-first-run",
];

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

async function applyAntiDetection(context: BrowserContext) {
  await context.addInitScript(ANTI_DETECTION_SCRIPT);
}

/* ── 티스토리 로그인 (카카오 OAuth) ── */
export async function saveTistorySession(userId: string, id: string, pw: string, blogName: string): Promise<void> {
  const browser = await chromium.launch({ headless: true, args: LAUNCH_ARGS, slowMo: 50 });
  const context = await browser.newContext({ userAgent: UA, viewport: { width: 1280, height: 800 }, locale: "ko-KR", timezoneId: "Asia/Seoul" });
  await applyAntiDetection(context);
  const page = await context.newPage();

  try {
    await page.goto("https://www.tistory.com/auth/login", { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForTimeout(1500);

    await page.click(".btn_login.link_kakao_id, a:has-text('카카오')").catch(() => {});
    await page.waitForTimeout(2500);

    await page.fill("#loginId--1", id).catch(async () => {
      await page.fill("input[name='loginId']", id);
    });
    await page.waitForTimeout(400);
    await page.fill("#password--2", pw).catch(async () => {
      await page.fill("input[name='password']", pw);
    });
    await page.waitForTimeout(400);

    await page.click(".btn_confirm.btn_login, button.submit").catch(() => {});

    console.log("[tistory] 로그인 대기 중...");
    try {
      await page.waitForURL("**tistory.com/**", { timeout: 90000 });
    } catch {
      throw new Error("티스토리 로그인 시간 초과");
    }

    await page.waitForTimeout(2000);
    if (page.url().includes("login") || page.url().includes("accounts.kakao.com")) {
      throw new Error("티스토리 로그인 실패");
    }

    const cookies = await context.cookies();
    writeSession(sessionName(userId), { blogName, cookies });
    await browser.close();
    console.log(`[tistory] ✅ 세션 저장 완료: ${blogName}`);
  } catch (e) {
    await browser.close().catch(() => {});
    throw e;
  }
}

/* ── 티스토리 자동발행 (헤드리스) ── */
export async function publishTistory(params: {
  userId: string;
  title: string;
  content: string;
  tags: string[];
  categoryId?: string;
  visibility?: "public" | "private";
}): Promise<string> {
  const { userId, title, content, tags, categoryId, visibility = "public" } = params;
  if (!tistorySessionExists(userId)) throw new Error("티스토리 세션 없음. 계정 재연결 필요");
  const { blogName, cookies } = readSession<any>(sessionName(userId), LEGACY_SESSION_DIRS);
  const browser = await chromium.launch({ headless: true, args: LAUNCH_ARGS });
  const context = await browser.newContext({ userAgent: UA, viewport: { width: 1280, height: 800 }, locale: "ko-KR", timezoneId: "Asia/Seoul" });
  await applyAntiDetection(context);
  await context.addCookies(cookies);
  const page = await context.newPage();

  try {
    const writeUrl = `https://${blogName}.tistory.com/manage/newpost/`;
    console.log(`[tistory] 글쓰기 진입: ${writeUrl}`);
    await page.goto(writeUrl, { waitUntil: "domcontentloaded", timeout: 60000 });

    if (page.url().includes("kakao.com") || page.url().includes("login")) {
      deleteSession(sessionName(userId), LEGACY_SESSION_DIRS);
      throw new Error("티스토리 세션 만료. 계정 재연결 필요");
    }

    await page.waitForTimeout(3000);

    // 임시저장 팝업 닫기
    try {
      const popup = page.locator(".btn-cancel:has-text('취소'), button:has-text('새로 작성')").first();
      if (await popup.isVisible({ timeout: 3000 })) await popup.click();
    } catch {}

    // 제목 입력
    console.log("[tistory] 제목 입력...");
    const titleInput = page.locator("#post-title-inp, input[name='title'], textarea[name='title']").first();
    await titleInput.waitFor({ timeout: 15000 });
    await titleInput.click();
    await titleInput.fill(title);
    await page.waitForTimeout(500);

    // HTML 모드 전환
    console.log("[tistory] HTML 모드 전환...");
    try {
      await page.click("#editor-mode-layer-btn-open, .btn-edit-mode", { timeout: 5000 });
      await page.waitForTimeout(800);
      await page.click("#editor-mode-html, [data-mode='html']", { timeout: 5000 });
      await page.waitForTimeout(800);
      await page.click(".btn-default.btn-confirm, button:has-text('확인')", { timeout: 3000 }).catch(() => {});
      await page.waitForTimeout(1500);
    } catch {
      console.warn("[tistory] HTML 모드 전환 실패, 기본 모드로 진행");
    }

    // 본문 입력
    console.log("[tistory] 본문 입력...");
    const htmlContent = content.replace(/\n/g, "<br>");
    try {
      await page.evaluate((html) => {
        const editor = document.querySelector(".CodeMirror") as any;
        if (editor && editor.CodeMirror) { editor.CodeMirror.setValue(html); return true; }
        const ta = document.querySelector("textarea#html-editor, textarea.html-source") as HTMLTextAreaElement;
        if (ta) { ta.value = html; ta.dispatchEvent(new Event("input", { bubbles: true })); return true; }
        return false;
      }, htmlContent);
      await page.waitForTimeout(800);
    } catch {
      try {
        const editorFrame = page.frameLocator(".tox-edit-area iframe, iframe.tx_canvas_iframe").first();
        await editorFrame.locator("body").click({ timeout: 5000 });
        await page.keyboard.type(content, { delay: 5 });
      } catch {}
    }

    // 태그 입력
    if (tags.length > 0) {
      try {
        const tagInput = page.locator("#tagText, input[name='tag'], input.tagText").first();
        await tagInput.click({ timeout: 5000 });
        for (const tag of tags.slice(0, 30)) {
          await tagInput.fill(tag);
          await page.keyboard.press("Enter");
          await page.waitForTimeout(150);
        }
      } catch {}
    }

    // 카테고리 선택
    if (categoryId) {
      console.log(`[tistory] 카테고리 선택: ${categoryId}`);
      try {
        const catSels = [
          `select#category option[value='${categoryId}']`,
          "select#category",
          "select[name='category']",
          ".category-select select",
        ];
        for (const sel of catSels) {
          try {
            const el = await page.$(sel);
            if (el) {
              await page.selectOption("select#category, select[name='category']", categoryId);
              await page.waitForTimeout(400);
              console.log("[tistory] ✅ 카테고리 선택 완료");
              break;
            }
          } catch {}
        }
      } catch (e) { console.log("[tistory] 카테고리 선택 실패 (무시):", e); }
    }

    // 발행
    console.log("[tistory] 발행...");
    await page.click("#publish-layer-btn, button.btn-publish, button:has-text('완료'), button:has-text('발행')", { timeout: 10000 });
    await page.waitForTimeout(2000);

    // 공개 설정
    try {
      if (visibility === "private") {
        // 비공개
        const privateSels = ["#open0, label[for='open0']", "input[value='0'] + label", "label:has-text('비공개')"];
        for (const sel of privateSels) {
          try {
            const el = await page.$(sel);
            if (el) { await page.click(sel, { timeout: 3000 }); break; }
          } catch {}
        }
      } else {
        // 전체공개 (기본)
        await page.click("#open20, label[for='open20']", { timeout: 5000 }).catch(() => {});
      }
      await page.waitForTimeout(500);
      await page.click("#publish-btn, button.btn-publish-confirm, .layer-btn-publish button:has-text('공개 발행')", { timeout: 10000 });
    } catch {
      await page.locator("button:has-text('공개 발행'), button:has-text('발행')").last().click({ timeout: 10000 });
    }

    await page.waitForTimeout(5000);

    let postUrl = `https://${blogName}.tistory.com`;
    const m = page.url().match(/\/(\d+)(?:\?|$)/);
    if (m) postUrl = `https://${blogName}.tistory.com/${m[1]}`;

    // 쿠키 갱신
    const newCookies = await context.cookies();
    writeSession(sessionName(userId), { blogName, cookies: newCookies });

    await browser.close();
    console.log(`[tistory] ✅ 발행 완료: ${postUrl}`);
    return postUrl;
  } catch (e: any) {
    try {
      const debugDir = path.join(__dirname, "../debug");
      if (!fs.existsSync(debugDir)) fs.mkdirSync(debugDir, { recursive: true });
      await page.screenshot({ path: path.join(debugDir, `tistory_error_${Date.now()}.png`), fullPage: true });
    } catch {}
    await browser.close().catch(() => {});
    throw e;
  }
}
