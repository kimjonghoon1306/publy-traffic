// ★배포 전 실검증 스크립트(재사용) — 실제 저장 세션으로 네이버 라이브 검증.
//   민감정보(쿠키값·비번)는 절대 출력하지 않고 결과 요약만.
//   사용: node scripts/verify-live.mjs [naver_acc_1]
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

function readSession(name) {
  const key = fs.readFileSync(KEY_PATH);
  const raw = fs.readFileSync(path.join(SESSION_DIR, `${name}.session`), "utf8");
  const env = JSON.parse(raw.slice(MAGIC.length + 1));
  const d = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(env.iv, "base64"));
  d.setAuthTag(Buffer.from(env.tag, "base64"));
  return JSON.parse(Buffer.concat([d.update(Buffer.from(env.data, "base64")), d.final()]).toString("utf8"));
}

const RESOLVE_INVALID = ["PostList","BlogHome","FeedList","neighborPostList","TagList","GoBlogWrite","RedirectWriteView","PostWriteForm","MyBlog","section","m","manage","admin","GoMyblog"];
const pickFrom = (s) => { const m = s.match(/[?&]blogId=([a-zA-Z0-9_-]+)/) || s.match(/blog\.naver\.com\/([a-zA-Z0-9_-]+)/); return (m && m[1] && !RESOLVE_INVALID.includes(m[1])) ? m[1] : ""; };

const s = readSession(NAME);
console.log(`\n=== 세션: ${NAME} ===`);
console.log(`blogId(저장)= ${s.blogId} | 비번저장= ${!!s.pw} | 쿠키수= ${(s.cookies||[]).length}`);
const cookieHeader = (s.cookies||[]).map(c => `${c.name}=${c.value}`).join("; ");

// ── 실검증 1: isSessionAlive / resolveBlogIdFast (GoBlogWrite 302 Location) ──
console.log(`\n[검증1] GoBlogWrite 302 리다이렉트 → 세션유효성 + 진짜 blogId 파싱`);
let alive = false, realBlogId = "";
try {
  const r = await fetch("https://blog.naver.com/GoBlogWrite.naver", { headers: { cookie: cookieHeader, "user-agent": UA }, redirect: "manual" });
  const loc = r.headers.get("location") || "";
  console.log(`  status=${r.status}  location=${loc.slice(0,70)}`);
  if (/nidlogin|nid\.naver\.com|\/login/i.test(loc)) { alive = false; console.log("  → 세션 만료(로그인 페이지로 리다이렉트) ⚠️ isSessionAlive=false 정상동작"); }
  else if (/PostWriteForm|RedirectWriteView|blogId=/i.test(loc)) { alive = true; console.log("  → 세션 유효 ✅ isSessionAlive=true 정상동작"); }
  else { alive = (r.status>=200&&r.status<400); console.log(`  → 애매(status기반 alive=${alive})`); }
  realBlogId = pickFrom(loc);
  console.log(`  resolveBlogIdFast 파싱 blogId= "${realBlogId}" ${realBlogId? "✅":"(못뽑음, 폴백대상)"}`);
} catch (e) { console.log("  fetch 오류:", e.message); }

if (!alive) { console.log("\n세션이 만료돼 라이브 DOM 검증은 불가. (isSessionAlive=false 로직은 정상 확인됨)\n테리가 '연결하기' 재로그인하면 그 세션으로 DOM 검증 가능."); process.exit(0); }

// ── 실검증 2: 제목수정 페이지 실제 열어서 셀렉터 확인 ──
const bid = realBlogId || s.blogId;
console.log(`\n[검증2] 제목수정 에디터 셀렉터 라이브 확인 (blogId=${bid})`);
const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ userAgent: UA, locale: "ko-KR" });
await ctx.addCookies(s.cookies);
const page = await ctx.newPage();
try {
  // 최근 글 하나 찾기
  const listUrl = `https://blog.naver.com/PostTitleListAsync.naver?blogId=${bid}&viewdate=&currentPage=1&categoryNo=&parentCategoryNo=&countPerPage=5`;
  const lr = await ctx.request.get(listUrl, { headers: { referer: `https://blog.naver.com/${bid}` } });
  const txt = await lr.text();
  const m = txt.match(/"logNo":"?(\d{6,})"?/);
  const logNo = m ? m[1] : "";
  console.log(`  최근 글 logNo= ${logNo || "(목록 파싱 실패)"}`);
  if (logNo) {
    const editUrl = `https://blog.naver.com/PostWriteForm.naver?blogId=${bid}&logNo=${logNo}&Redirect=Update`;
    await page.goto(editUrl, { waitUntil: "domcontentloaded", timeout: 30000 }).catch(()=>{});
    await page.waitForTimeout(4000);
    console.log(`  착지 URL= ${page.url().slice(0,70)}`);
    const getFrame = () => { const fr = page.frames(); return fr.find(f=>f.name()==="mainFrame") ?? fr.find(f=>f.url().includes("blog.naver.com")&&f!==page.mainFrame()) ?? null; };
    const hasEditor = async (c) => { try { return !!(await c.$(".se-section-documentTitle, .se-editor, .se-container")); } catch { return false; } };
    let editor = null, where = "";
    for (let i=0;i<12 && !editor;i++){ const fr=getFrame(); if(fr && await hasEditor(fr)){editor=fr;where="iframe(mainFrame)";break;} if(await hasEditor(page)){editor=page;where="페이지 직접";break;} await page.waitForTimeout(800); }
    if (editor) {
      console.log(`  ✅ 에디터 발견 위치= ${where}  (v2.1.8 '페이지 직접' 폴백 로직 검증 포인트)`);
      const titleFound = await editor.$(".se-section-documentTitle");
      const curTitle = await editor.evaluate(()=>(document.querySelector(".se-section-documentTitle")?.textContent||"").trim().slice(0,30)).catch(()=>"");
      console.log(`  ✅ 제목칸(.se-section-documentTitle) 존재= ${!!titleFound}  현재제목="${curTitle}"`);
      const pubBtn = await editor.$("button[class*='publish_btn']") || await page.$("button[class*='publish_btn']");
      console.log(`  발행버튼(publish_btn) 존재= ${!!pubBtn}`);
    } else {
      console.log(`  ⚠️ 에디터를 못 찾음 — 실제로 확인 필요(셀렉터/구조 재점검)`);
    }
  }
} catch (e) { console.log("  DOM 검증 오류:", e.message); }
await browser.close();
console.log("\n=== 실검증 종료 ===");
