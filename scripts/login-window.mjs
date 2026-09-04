// 테리가 직접 로그인하는 창을 띄운다. '로그인 상태 유지'(nvlong) 자동 체크 → 세션 오래 유지.
// 로그인 성공 시 쿠키+blogId+비번(테리가 입력한 값 캡처)을 암호화 저장(봇이 읽는 형식과 동일).
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { chromium } = require("/Users/apple/Downloads/oncatch/node_modules/playwright");

const NAME = process.argv[2] || "naver_acc_1";
const SESSION_DIR = path.join(os.homedir(), ".publy", "sessions");
const KEY_PATH = path.join(path.dirname(SESSION_DIR), "session.key");
const MAGIC = "PUBLY_SESSION_V1";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
const INVALID = ["PostList","BlogHome","FeedList","neighborPostList","TagList","GoBlogWrite","RedirectWriteView","PostWriteForm","MyBlog","section","m"];

function writeSession(name, value) {
  const key = fs.readFileSync(KEY_PATH);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([cipher.update(JSON.stringify(value), "utf8"), cipher.final()]);
  const env = JSON.stringify({ v:1, alg:"aes-256-gcm", iv: iv.toString("base64"), tag: cipher.getAuthTag().toString("base64"), data: ct.toString("base64") });
  const target = path.join(SESSION_DIR, `${name}.session`);
  fs.writeFileSync(target, `${MAGIC}\n${env}`, { mode: 0o600 });
}

const browser = await chromium.launch({ headless: false, args: ["--start-maximized"] });
const context = await browser.newContext({ userAgent: UA, viewport: { width: 1280, height: 860 }, locale: "ko-KR", timezoneId: "Asia/Seoul" });
const page = await context.newPage();
console.log("🌐 로그인 창을 띄웠어요. 이 창에서 아이디·비밀번호를 입력하고 로그인하세요(보안문자 있으면 그것도).");
await page.goto("https://nid.naver.com/nidlogin.login", { waitUntil: "domcontentloaded", timeout: 30000 });
await page.bringToFront().catch(() => {});
await page.waitForTimeout(1200);
// ★로그인 상태 유지 자동 체크 → 세션 오래 유지
try {
  await page.evaluate(() => {
    const cb = document.querySelector("input[name='nvlong']");
    if (cb && !cb.checked) { cb.click(); }
  });
  console.log("✅ '로그인 상태 유지'를 자동으로 켰어요.");
} catch {}

// 테리가 입력하는 비번 캡처(자동 재로그인용). 로그인 페이지 벗어나기 전까지 마지막 값 저장.
let capturedPw = "";
const poll = setInterval(async () => {
  try { const v = await page.$eval("#pw", el => el.value); if (v) capturedPw = v; } catch {}
}, 500);

console.log("⏳ 로그인 완료를 기다려요 (최대 9분, 천천히 하세요)...");
let ok = false;
const start = Date.now();
while (Date.now() - start < 540000) {
  // 완료 감지 1) NID_AUT 쿠키 생성  2) 로그인 페이지 URL 벗어남
  try {
    const cks = await context.cookies();
    if (cks.find(c => c.name === "NID_AUT" && c.value)) { ok = true; break; }
  } catch {}
  try {
    const u = page.url();
    if (u && !/nid\.naver\.com\/(nidlogin|login)/.test(u) && !u.includes("about:blank")) { ok = true; break; }
  } catch {}
  const el = Math.round((Date.now() - start) / 1000);
  if (el > 0 && el % 30 === 0) console.log(`  ...대기 중 (${el}초, 로그인하시면 자동 감지)`);
  await new Promise(r => setTimeout(r, 2000));
}
if (!ok) console.log("⚠️ 시간 안에 로그인이 안 끝났어요.");
clearInterval(poll);

if (ok) {
  await page.waitForTimeout(2500);
  // blogId 추출(GoBlogWrite 리다이렉트)
  let blogId = "";
  const pick = (u) => { const m = u.match(/[?&]blogId=([a-zA-Z0-9_-]+)/) || u.match(/(?:m\.)?blog\.naver\.com\/([a-zA-Z0-9_-]+)/); return (m && m[1] && !INVALID.includes(m[1])) ? m[1] : ""; };
  try {
    await page.goto("https://blog.naver.com/GoBlogWrite.naver", { waitUntil: "domcontentloaded", timeout: 20000 });
    await page.waitForTimeout(2500);
    blogId = pick(page.url());   // ★경로형(blog.naver.com/{blogId}?Redirect=Write)도 파싱
    if (!blogId) { await page.goto("https://m.blog.naver.com", { waitUntil: "domcontentloaded", timeout: 15000 }).catch(()=>{}); await page.waitForTimeout(1500); blogId = pick(page.url()); }
  } catch {}
  const cookies = await context.cookies();
  const session = { loginId: undefined, blogId, cookies };
  if (capturedPw) session.pw = Buffer.from(capturedPw, "utf-8").toString("base64");
  writeSession(NAME, session);
  const nidAut = cookies.find(c => c.name === "NID_AUT");
  console.log(`\n✅ 저장 완료: ${NAME}`);
  console.log(`   blogId=${blogId || "(못 뽑음)"} | 비번캡처=${!!capturedPw} | 쿠키수=${cookies.length}`);
  console.log(`   NID_AUT 만료=${nidAut && nidAut.expires>0 ? new Date(nidAut.expires*1000).toLocaleString() : "세션(브라우저 종료시)"}`);
}
await browser.close();
console.log("창을 닫았어요.");
