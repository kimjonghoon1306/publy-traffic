// ─────────────────────────────────────────────────────────────
// backlink-bot — 백링크/색인 게시 봇 (포트 3374, 퍼블리 3333·트래픽 3363과 분리)
// 실제 게시는 어댑터가 담당: apiAdapter(REST/git)·botAdapter(Playwright)·manualAdapter.
// ─────────────────────────────────────────────────────────────
import express from "express";
import cors from "cors";
import WebSocket from "ws";
// Node 20 등 native WebSocket 없는 런타임 폴리필 (Supabase Realtime 초기화 크래시 방지)
if (typeof (globalThis as any).WebSocket === "undefined") {
  (globalThis as any).WebSocket = WebSocket;
}
import { createClient } from "@supabase/supabase-js";
import { getAdapter, listAdapterDomains, registerOwnedBlog, buildSourceList } from "./adapters";
import { runDiscovery } from "./discover";
import { runGenerate } from "./generate";
import { PublishInput } from "./adapters/types";
import { isIndexedBing } from "./indexCheck";
import { submitIndexNow, groupByHost, INDEXNOW_ENGINES } from "./indexnow";
import { isIndexedGoogle } from "./googleIndex";

const app = express();
const PORT = Number(process.env.PUBLY_BOT_PORT) || 3374;
const AUTH_TOKEN = process.env.BOT_AUTH_TOKEN || "";

// 퍼블리 Supabase 재사용(백링크는 backlink_* 테이블만 씀). 봇=관리자 권한 → RPC에 admin 토큰 전달.
const SB_URL = "https://qhhoyxexxlimbjrbwrgq.supabase.co";
const SB_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFoaG95eGV4eGxpbWJqcmJ3cmdxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzczMTMzOTQsImV4cCI6MjA5Mjg4OTM5NH0.pw_qUR0oOxgt82S_DA6GTka3WP0JBu2vmWuKZ9VvTKM";
const sb = createClient(SB_URL, SB_KEY);

// config(gist 토큰 등) 읽기 — Edge의 getConfig와 동일 폴백.
//   admin_backlink_get_config는 관리자 "세션 토큰"만 통과. secret("456789")으론 거부됨 → backlink_config_get(secret)으로 폴백.
async function getConfigBot(token: string, key: string): Promise<string> {
  try { const { data, error } = await sb.rpc("admin_backlink_get_config", { p_token: token, p_key: key }); if (!error && data) return String(data); } catch { /* 다음 */ }
  try { const { data, error } = await sb.rpc("backlink_config_get", { p_token: token, p_key: key }); if (!error && data) return String(data); } catch { /* 없음 */ }
  return "";
}

app.use(cors({ origin: ["http://localhost:5173", "http://127.0.0.1:5173", "null"] }));
app.use(express.json({ limit: "50mb" }));
app.use((req, res, next) => {
  if (!AUTH_TOKEN) return next(); // 로컬 개발 폴백(토큰 미설정 시)
  // 🔗 회원 실시간 게시 스트림은 브라우저 EventSource(SSE)라 커스텀 헤더(Authorization: Bearer)를 못 붙인다.
  //   → 이 경로만 Bearer 면제. 쿼리스트링 token(회원 세션)을 핸들러 RPC가 자체 검증(세션 무효면 게시 차단). 봇은 127.0.0.1 로컬바인딩.
  if (req.path === "/member-publish-stream") return next();
  if (req.path === "/admin-publish-stream") return next();   // 관리자 실행탭도 EventSource(SSE)라 Bearer 못붙임. adminToken은 핸들러 RPC가 자체검증.
  if (req.path === "/discover-stream") return next();        // 어댑터 발굴(SSE)도 Bearer 못붙임. secret은 핸들러가 검증.
  if (req.path === "/generate-stream") return next();        // 어댑터 생성(SSE)도 Bearer 못붙임. secret은 핸들러가 검증.
  // /health 포함 그 외 전부 인증. ★ naver-bot과 동일 패턴 = 401 응답을 "Unauthorized"(대문자)로 통일해야
  //   앱(main.ts killPort)이 '토큰 다른 옛 우리 봇'으로 인식해 재시작 시 좀비를 정리한다(예전엔 /health 예외+소문자라 좀비가 안 죽어 옛 봇이 계속 3374를 물었음).
  if (req.get("Authorization") === `Bearer ${AUTH_TOKEN}`) return next();
  res.status(401).json({ error: "Unauthorized" });
});

app.get("/health", (_req, res) => res.json({ ok: true, bot: "backlink-bot", port: PORT, adapters: listAdapterDomains() }));

// ── 🔍 어댑터 발굴(SSE): 후보 사이트 자동 조사 → 무료로 되는 것만 추림 → backlink_discovery에 저장 ──
//   GET /discover-stream?secret=456789
app.get("/discover-stream", async (req, res) => {
  const secret = String(req.query.secret || "");
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  const send = (obj: any) => res.write(`data: ${JSON.stringify(obj)}\n\n`);
  if (secret !== "456789") { send({ type: "error", msg: "unauthorized" }); return res.end(); }
  try {
    await runDiscovery(send, async (r) => {
      try { await sb.rpc("backlink_discovery_record", { p_token: secret, p_domain: r.domain, p_kind: r.kind, p_verdict: r.verdict, p_test_url: r.testUrl || "", p_note: r.note }); } catch { /* 저장 실패 무시 */ }
    });
  } catch (e: any) { send({ type: "error", msg: e?.message || String(e) }); }
  res.end();
});

// ── ⚙️ 어댑터 생성(SSE): 수량만큼 실제 생성 → 분류·등급 → backlink_sources 배치 ──
//   GET /generate-stream?secret=456789&count=N
app.get("/generate-stream", async (req, res) => {
  const secret = String(req.query.secret || "");
  const count = Math.max(1, Math.min(500, Number(req.query.count) || 10));
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  const send = (obj: any) => res.write(`data: ${JSON.stringify(obj)}\n\n`);
  if (secret !== "456789") { send({ type: "error", msg: "unauthorized" }); return res.end(); }
  const runId = crypto.randomUUID();
  // gist 토큰(우리소유 A급 생성용) — ★secret은 세션토큰이 아니므로 admin_backlink_get_config가 거부함.
  //   Edge와 동일하게 getConfigBot 폴백(admin RPC 실패 시 backlink_config_get(secret))으로 읽는다. (전수적용)
  let gistToken = await getConfigBot(secret, "github_gist_token");
  try {
    await runGenerate(count, gistToken, (o) => { if (o.type === "done") o.runId = runId; send(o); }, async (g) => {
      try { await sb.rpc("backlink_gen_record", { p_token: secret, p_run_id: runId, p_domain: g.domain, p_scale: g.scale, p_grade: g.grade, p_detail_url: g.detailUrl || "", p_ok: g.ok, p_note: g.note }); } catch { /* 저장 실패 무시 */ }
    });
  } catch (e: any) { send({ type: "error", msg: e?.message || String(e) }); }
  res.end();
});

// ── AI 콘텐츠 생성(파일럿: 템플릿 다양화. 추후 블로그오토프로 Gemini 연동) ──
const ANCHORS = ["자세히 보기", "바로가기", "홈페이지 방문", "더 알아보기", "공식 사이트", "여기서 확인", "상세 정보"];
// ★2026-09-08 라운드로빈 물량 발행으로 같은 도메인에 여러 글이 나감 → 변형 풀을 넓히고 소소한 표현차를 섞어
//   바이트 동일 페이지(구글 중복 스팸 위험)를 피한다. (진짜 해결=AI글, 블로그오토프로 연동은 별도 과제.)
function genContent(domain: string, i: number): { title: string; body: string; anchor: string } {
  const name = domain.replace(/\.(com|co\.kr|kr|net|shop)$/, "");
  const titles = [
    `${name} 신선 상품 산지직송 안내`,
    `${name} 추천 이유와 이용 방법`,
    `${name}에서 만나는 믿을 수 있는 상품`,
    `${name} 이용 후기와 구매 가이드`,
    `${name} 정직한 운영, 꼼꼼한 품질관리`,
    `${name} 자주 찾는 이유 정리`,
    `${name} 합리적인 가격의 비결`,
  ];
  const bodies = [
    `${domain}은(는) 검증된 품질과 빠른 배송으로 많은 분들이 찾는 곳입니다. 합리적인 가격과 신뢰를 바탕으로 서비스를 제공합니다.`,
    `${domain}의 상품과 서비스를 소개합니다. 꼼꼼한 관리와 정직한 운영으로 재구매율이 높습니다.`,
    `${domain}은(는) 산지에서 바로 받는 신선함과 세심한 포장으로 좋은 평가를 받고 있습니다. 처음 이용하는 분도 믿고 주문할 수 있습니다.`,
    `${domain}에서는 품질 좋은 상품을 합리적인 가격에 만나볼 수 있습니다. 빠른 배송과 친절한 상담으로 만족도가 높습니다.`,
    `${domain}을(를) 이용해 본 분들은 신선도와 가격, 그리고 정직한 운영을 공통적으로 꼽습니다. 자세한 내용은 공식 사이트에서 확인하세요.`,
  ];
  const intros = ["", "요즘 관심이 높은 ", "믿을 만한 곳을 찾는다면 ", "많은 분들이 추천하는 "];
  const t = titles[i % titles.length];
  const b = intros[i % intros.length] + bodies[i % bodies.length];
  return {
    title: t,
    body: b,
    anchor: ANCHORS[i % ANCHORS.length],
  };
}

// ── 게시검증: 게시된 URL을 실제로 열어 타겟 도메인 링크가 진짜 삽입됐는지 확인 ──
//   테리 "한치 오차도 없어야": 어댑터 성공응답만 믿지 않고 실제 페이지를 검증해 가짜성공/누락을 잡는다.
async function verifyBacklink(postUrl: string, targetDomain: string): Promise<{ ok: boolean; count: number; note: string }> {
  const bare = targetDomain.replace(/^https?:\/\//, "").replace(/\/.*$/, "").toLowerCase();
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 12000);
    const res = await fetch(postUrl, { redirect: "follow", headers: { "User-Agent": "Mozilla/5.0" }, signal: ctrl.signal as any });
    clearTimeout(t);
    if (!res.ok) return { ok: false, count: 0, note: `게시물 접근 불가(HTTP ${res.status})` };
    const html = (await res.text()).toLowerCase();
    // 파킹/차단/빈페이지 방어
    if (/blacklist|banned|not found|파킹|domain for sale/.test(html) && !html.includes(bare)) {
      return { ok: false, count: 0, note: "차단/빈 페이지" };
    }
    const count = html.split(bare).length - 1;
    if (count <= 0) return { ok: false, count: 0, note: "링크 미삽입" };
    return { ok: true, count, note: "확인됨" };
  } catch (e: any) {
    return { ok: false, count: 0, note: `검증 실패: ${e?.name === "AbortError" ? "시간초과" : (e?.message || e)}` };
  }
}

// ── 주문 게시(파일럿): 어댑터 있는 소스에 실제 게시 → 결과 기록 ──
//   body: { adminToken, orderId, targetDomain }
//   ※ 봇=관리자 권한. adminToken(관리자 세션)으로 record_post RPC 호출.
app.post("/publish-order", async (req, res) => {
  const { adminToken, orderId, targetDomain } = req.body || {};
  if (!adminToken || !orderId || !targetDomain) return res.status(400).json({ error: "adminToken, orderId, targetDomain 필요" });
  const targetUrl = targetDomain.startsWith("http") ? targetDomain : `https://${targetDomain}`;
  // 우리소유 소스용 토큰(github) — ★2026-09-07: 회원 본인키 우선(빙키 방식), 없으면 관리자 공용키.
  const secrets: Record<string, string> = {};
  try {
    const { data: gk } = await sb.rpc("backlink_bot_github_key", { p_token: adminToken, p_order_id: orderId });
    const row = (gk && gk[0]) || null;
    if (row && row.effective_key) secrets.github_gist_token = row.effective_key as string;
  } catch { /* 폴백 */ }
  if (!secrets.github_gist_token) { const ght = await getConfigBot(adminToken, "github_gist_token"); if (ght) secrets.github_gist_token = ght; }
  // ★2026-09-07 우리소유 블로그(tarryguide·tarryblog) 발행 키 주입(config owned_blog_api_key).
  { const obk = await getConfigBot(adminToken, "owned_blog_api_key"); if (obk) secrets.owned_blog_api_key = obk; }
  // ★2026-09-08 "소스당 1회" 폐기: 키 있는 소스만(우리블로그=키없으면 제외), 한 바퀴 게시(파일럿·레거시 엔드포인트).
  const domains = buildSourceList({ hasOwnedKey: !!secrets.owned_blog_api_key });
  const results: any[] = [];
  for (let i = 0; i < domains.length; i++) {
    const dom = domains[i];
    const adapter = getAdapter(dom)!;
    const c = genContent(targetDomain, i);
    const input: PublishInput = { targetDomain, targetUrl, title: c.title, body: c.body, anchor: c.anchor, proxy: null, secrets };
    const r = await adapter.publish(input);
    // 게시결과 기록 — evidence에 단계 events(API시작·게시성공) 포함해 저장
    const evidence = { ...r.evidence, events: r.events, trigger: "manual", article: { title: c.title, body: c.body, anchor: c.anchor } };
    const { data: postId, error } = await sb.rpc("backlink_bot_record_post", {
      p_token: adminToken, p_order_id: orderId, p_source_domain: dom, p_grade: "A",
      p_status: r.ok ? "posted" : "failed", p_post_url: r.postUrl || null, p_anchor: c.anchor,
      p_evidence: evidence, p_proxy_used: false,
    });
    results.push({ source: dom, ok: r.ok, postId: postId || null, recordError: error?.message || null, events: r.events });
  }
  // ★ 게시 직후 자동 색인 푸시(IndexNow) — 테리 지시. 실패해도 게시 응답은 정상 반환.
  let indexnow: any = null;
  try { indexnow = await pushOrderIndex(adminToken, orderId); } catch (e: any) { indexnow = { error: e?.message || String(e) }; }
  res.json({ ok: true, posted: results.filter(x => x.ok).length, total: results.length, results, indexnow });
});

// ── 회원 게시(회원 시작버튼) : SSE 실시간 로그 스트림 ──
//   회원 세션토큰으로 소유·하루한도 검증(admin 시크릿 봇 보관 안 함). 수량지정(count) 만큼 어댑터 게시.
//   블로그(InflowCenter)처럼 단계별 로그를 실시간(text/event-stream)으로 흘려보낸다.
//   GET /member-publish-stream?token=회원세션&orderId=..&targetDomain=..&count=N
app.get("/member-publish-stream", async (req, res) => {
  const token = String(req.query.token || "");
  const orderId = String(req.query.orderId || "");
  const targetDomain = String(req.query.targetDomain || "");
  const count = Math.max(1, Math.min(50, Number(req.query.count) || 1));
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  const send = (obj: any) => res.write(`data: ${JSON.stringify(obj)}\n\n`);
  if (!token || !orderId || !targetDomain) { send({ type: "error", msg: "token, orderId, targetDomain 필요" }); return res.end(); }
  const targetUrl = targetDomain.startsWith("http") ? targetDomain : `https://${targetDomain}`;

  try {
    // 남은 하루 한도(회원 RPC) — 초과 요청은 남은 만큼으로 자름
    const { data: remain, error: remErr } = await sb.rpc("backlink_my_today_remaining", { p_token: token, p_order_id: orderId });
    if (remErr) { send({ type: "error", msg: remErr.message }); return res.end(); }
    const left = Number(remain ?? 0);
    if (left <= 0) { send({ type: "log", kind: "warn", msg: "오늘 발송 한도를 다 썼어요 — 자정에 초기화돼요." }); send({ type: "done", posted: 0 }); return res.end(); }
    const want = Math.min(count, left);
    send({ type: "log", kind: "wait", msg: `🚀 백링크 발송 시작 — ${targetDomain}에 ${want}개 (오늘 남은 한도 ${left}개)` });

    // ★2026-09-08 근본수정: "소스당 1회" 모델 폐기 → 라운드로빈 물량 발행.
    //   백링크는 같은 소스에 매번 새 URL로 여러 개 올리는 게 정상(1차 하루 10~20개). 예전엔 이미 올린 소스를 스킵해서
    //   소스가 소진되면 무제한 회원도 0개가 됐다 → doneSet 스킵 제거하고 want개를 채울 때까지 소스를 돌려 쓴다.
    const secrets: Record<string, string> = {};
    // gist(개인키)만 회원 직접발송 제외. 우리 블로그(tarryguide 등)는 서버 공용키가 있을 때만 사용.
    //   config는 회원 세션토큰으론 못 읽음 → 봇 시크릿(456789)로 읽어 주입(키는 서버에만, 회원앱 비노출).
    { const obk = await getConfigBot("456789", "owned_blog_api_key"); if (obk) secrets.owned_blog_api_key = obk; }
    // ★2026-09-08 회원 직접발송도 GitHub 키(관리자 공용/본인) 있으면 gist 사용(테리: 관리자가 키 넣어주면 일반발행도 적용).
    //   effective_key = 회원 본인키 우선, 없으면 관리자 공용키. 키 조회는 admin 세션 필요 → 봇 시크릿으로 로그인해 세션토큰 발급.
    try {
      const { data: at } = await sb.rpc("publy_admin_login", { p_password: "456789" });
      if (at) {
        const { data: gk } = await sb.rpc("backlink_bot_github_key", { p_token: String(at), p_order_id: orderId });
        const row = (gk && gk[0]) || null;
        if (row && row.effective_key) secrets.github_gist_token = row.effective_key as string;
      }
    } catch { /* 키 없으면 gist 제외 그대로 */ }
    const sources = buildSourceList({ forMember: true, hasOwnedKey: !!secrets.owned_blog_api_key, hasGithubKey: !!secrets.github_gist_token });
    if (sources.length === 0) {
      send({ type: "log", kind: "wait", msg: "지금 올릴 수 있는 소스가 없어요 — 시스템이 자동으로 채워드려요." });
      send({ type: "done", posted: 0 });
      return res.end();
    }
    let posted = 0;
    const tier1Urls: string[] = [];   // 성공한 1차 URL(2차 부스팅 대상)
    const dead = new Set<string>();   // 이번 실행에서 계속 실패하는 소스(로테이션에서 제외)
    let n = 0;                        // 라운드로빈 인덱스(글 변형에도 사용)
    let guard = 0;                    // 무한루프 방지(want의 3배 + 소스수 만큼만 시도)
    const maxTries = want * 3 + sources.length;
    while (posted < want && guard < maxTries) {
      guard++;
      const live = sources.filter(d => !dead.has(d));
      if (live.length === 0) break;   // 살아있는 소스가 없으면 종료
      const dom = live[n % live.length];
      n++;
      const c = genContent(targetDomain, n);
      const input: PublishInput = { targetDomain, targetUrl, title: c.title, body: c.body, anchor: c.anchor, proxy: null, secrets };
      // 어댑터 실행 — events를 실시간 전송(주소 노출 없이 신뢰지표만)
      const r = await getAdapter(dom)!.publish(input);
      for (const e of r.events) send({ type: "log", kind: e.kind, msg: `[${dom}] ${e.msg}` });
      if (!r.ok) { dead.add(dom); continue; }   // 어댑터가 실패한 소스는 이번 실행에서 제외(재시도 낭비 방지, failed 레코드도 안 남김)
      // ★ 게시검증(테리 "한치 오차도 없어야"): 어댑터가 ok여도 실제 URL을 열어 타겟 링크가 진짜 있는지 확인.
      //   진짜 있으면 성공(카운트), 없으면 가짜성공→실패로 재판정(카운트 안 함). 진짜성공 누락도 방지(실제 검증이 기준).
      let realOk: boolean = r.ok;
      let verifyNote = "";
      if (r.ok && r.postUrl) {
        const v = await verifyBacklink(r.postUrl, targetDomain);
        realOk = v.ok;
        verifyNote = v.note;
        if (v.ok) send({ type: "log", kind: "post", msg: `[${dom}] 🔎 게시 확인됨 · 링크 ${v.count}개 실제 삽입` });
        else send({ type: "log", kind: "fail", msg: `[${dom}] ⚠️ 게시 실패(가짜) — ${v.note}` });
      }
      const evidence = { ...r.evidence, events: r.events, verified: realOk, verify_note: verifyNote, trigger: "manual", article: { title: c.title, body: c.body, anchor: c.anchor } };
      const { data: postId, error } = await sb.rpc("backlink_my_record_post", {
        p_token: token, p_order_id: orderId, p_source_domain: dom, p_grade: "A",
        p_status: realOk ? "posted" : "failed", p_post_url: realOk ? (r.postUrl || null) : null, p_anchor: c.anchor, p_evidence: evidence,
      });
      if (error) { send({ type: "log", kind: "warn", msg: `[${dom}] 기록 실패: ${error.message}` }); }
      else if (realOk) { posted++; if (r.postUrl) tier1Urls.push(r.postUrl); send({ type: "log", kind: "post", msg: `[${dom}] ✅ 게시 완료 (${posted}/${want})` }); }
      void postId;
    }
    // ★2026-09-07 티어2 부스팅(회원 실시간 발송): 성공한 1차 URL을 weak 소스로 밀어줌(회원 사이트 아니라 1차 URL 가리킴).
    try {
      const okUrls = tier1Urls.filter(Boolean);
      if (okUrls.length) {
        const TIER2_SOURCES = ["telegra.ph", "dpaste.com", "paste.rs"].filter(d => getAdapter(d));
        const TIER2_PER = 3;
        send({ type: "log", kind: "wait", msg: `🔁 2차 부스팅 시작 — 올린 글 ${okUrls.length}개를 여러 곳에서 밀어줍니다` });
        let t2ok = 0;
        for (const p1 of okUrls) {
          for (let k = 0; k < TIER2_PER; k++) {
            const src = TIER2_SOURCES[t2ok % (TIER2_SOURCES.length || 1)];
            if (!src) break;
            let host = p1; try { host = new URL(p1).host; } catch { /* keep */ }
            const t2c = genContent(host, t2ok);
            const t2input: PublishInput = { targetDomain: host, targetUrl: p1, title: t2c.title, body: t2c.body, anchor: "관련 글 보기", proxy: null, secrets };
            const rr = await getAdapter(src)!.publish(t2input);
            if (rr.ok) {
              t2ok++;
              await sb.rpc("backlink_my_record_post", {
                p_token: token, p_order_id: orderId, p_source_domain: src, p_grade: "B",
                p_status: "posted", p_post_url: rr.postUrl || null, p_anchor: "관련 글 보기",
                p_evidence: { ...rr.evidence, tier: 2, parent_url: p1 },
              });
            }
          }
        }
        send({ type: "log", kind: "post", msg: `🔁 2차 부스팅 완료 — ${t2ok}개로 밀어줬어요(순위·색인에 도움)` });
      }
    } catch (e: any) { send({ type: "log", kind: "warn", msg: `2차 부스팅 일부 실패: ${e?.message || e}` }); }
    // 색인 푸시(회원 키/관리자지정 정책은 backlink_bot_indexnow_plan이 처리 — 회원 세션 아님이므로 스킵, 스케줄러/관리자 흐름서 처리)
    send({ type: "log", kind: "index", msg: `색인 요청은 잠시 후 자동으로 진행돼요(회원 키 설정 시 더 빨라져요).` });
    send({ type: "done", posted });
    res.end();
  } catch (e: any) {
    send({ type: "error", msg: e?.message || String(e) });
    res.end();
  }
});

// ── 관리자 게시(관리자 웹 "백링크 실행" 탭) : SSE 실시간 로그 스트림 ──
//   member-publish-stream과 동일 흐름 + 차이: ①관리자 세션 인증(adminToken) ②실제 게시 URL 노출(관리자는 링크 봄)
//   ③gist 등 우리소유 소스 토큰 주입 ④게시 직후 색인 자동(IndexNow) 실행까지 스트림으로.
//   GET /admin-publish-stream?adminToken=..&orderId=..&targetDomain=..&count=N
app.get("/admin-publish-stream", async (req, res) => {
  const adminToken = String(req.query.adminToken || "");
  const orderId = String(req.query.orderId || "");
  const targetDomain = String(req.query.targetDomain || "");
  const count = Math.max(1, Math.min(50, Number(req.query.count) || 1));
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  const send = (obj: any) => res.write(`data: ${JSON.stringify(obj)}\n\n`);
  if (!adminToken || !orderId || !targetDomain) { send({ type: "error", msg: "adminToken, orderId, targetDomain 필요" }); return res.end(); }
  const targetUrl = targetDomain.startsWith("http") ? targetDomain : `https://${targetDomain}`;

  try {
    send({ type: "log", kind: "wait", msg: `🚀 [관리자] 백링크 실행 — ${targetDomain}에 최대 ${count}개` });
    // 우리소유 소스 토큰(gist·우리블로그) 주입 — 관리자 흐름은 우리소유 포함 전 어댑터 사용
    const secrets: Record<string, string> = {};
    { const ght = await getConfigBot(adminToken, "github_gist_token"); if (ght) secrets.github_gist_token = ght; }
    { const obk = await getConfigBot(adminToken, "owned_blog_api_key"); if (obk) secrets.owned_blog_api_key = obk; }
    // ★2026-09-08 근본수정: "소스당 1회" 폐기 → 라운드로빈으로 count개를 채운다(회원 흐름과 동일 모델).
    //   gist는 토큰 있으면 포함, 우리블로그는 키 있을 때만 포함. 실패 소스는 이번 실행에서 제외.
    const sources = buildSourceList({ hasOwnedKey: !!secrets.owned_blog_api_key });
    if (sources.length === 0) { send({ type: "log", kind: "warn", msg: "사용 가능한 소스가 없습니다(키 확인)." }); send({ type: "done", posted: 0 }); return res.end(); }
    let posted = 0;
    const dead = new Set<string>();
    let n = 0, guard = 0;
    const maxTries = count * 3 + sources.length;
    while (posted < count && guard < maxTries) {
      guard++;
      const live = sources.filter(d => !dead.has(d));
      if (live.length === 0) break;
      const dom = live[n % live.length];
      n++;
      const c = genContent(targetDomain, n);
      const input: PublishInput = { targetDomain, targetUrl, title: c.title, body: c.body, anchor: c.anchor, proxy: null, secrets };
      const r = await getAdapter(dom)!.publish(input);
      for (const e of r.events) send({ type: "log", kind: e.kind, msg: `[${dom}] ${e.msg}` });
      if (!r.ok) { dead.add(dom); continue; }
      let realOk: boolean = r.ok; let verifyNote = "";
      if (r.ok && r.postUrl) {
        const v = await verifyBacklink(r.postUrl, targetDomain);
        realOk = v.ok; verifyNote = v.note;
        if (v.ok) send({ type: "log", kind: "post", msg: `[${dom}] 🔎 게시 확인 · 링크 ${v.count}개 삽입` });
        else send({ type: "log", kind: "fail", msg: `[${dom}] ⚠️ 게시 실패(가짜) — ${v.note}` });
      }
      const evidence = { ...r.evidence, events: r.events, verified: realOk, verify_note: verifyNote, trigger: "manual", article: { title: c.title, body: c.body, anchor: c.anchor } };
      const { data: postId, error } = await sb.rpc("backlink_bot_record_post", {
        p_token: adminToken, p_order_id: orderId, p_source_domain: dom, p_grade: "A",
        p_status: realOk ? "posted" : "failed", p_post_url: realOk ? (r.postUrl || null) : null, p_anchor: c.anchor,
        p_evidence: evidence, p_proxy_used: false,
      });
      if (error) { send({ type: "log", kind: "warn", msg: `[${dom}] 기록 실패: ${error.message}` }); }
      else if (realOk) { posted++; send({ type: "post", kind: "post", source: dom, url: r.postUrl || "", msg: `[${dom}] ✅ 게시 완료 (${posted}/${count})`, postUrl: r.postUrl || "" }); }
      void postId;
    }
    // ★ 색인 자동(IndexNow) — 관리자 실행탭은 항상 색인 자동(테리 지시).
    send({ type: "log", kind: "index", msg: `🔎 색인(IndexNow) 요청 중…` });
    try {
      const ix = await pushOrderIndex(adminToken, orderId);
      // 색인키가 설정돼 실제 전송된 경우만 "빙 연결됨" 표시(테리: 그냥 쓰지 말고 설정됐을 때)
      if ((ix as any)?.ok) { send({ type: "log", kind: "index", msg: `🔗 빙(IndexNow) 색인 연결됨 — 빙에 색인 요청 전송` }); send({ type: "log", kind: "done", msg: `색인 요청 완료 · 빙 수락 ${(ix as any).accepted || 0}건 (실제 반영은 빙 확인에서 ✅)` }); }
      else { send({ type: "log", kind: "warn", msg: `색인 키 미설정 — 게시는 완료됨 (색인키 탭에서 지정)` }); }
    } catch (e: any) { send({ type: "log", kind: "warn", msg: `색인 요청 실패: ${e?.message || e}` }); }
    send({ type: "done", posted });
    res.end();
  } catch (e: any) {
    send({ type: "error", msg: e?.message || String(e) });
    res.end();
  }
});

// ── 색인 푸시(IndexNow): 게시된 URL을 빙·네이버·얀덱스에 색인요청 ──
//   scope: 'admin'(우리소유 소스에 올린 백링크 = 관리자 공용키) | 'own'(회원 본인키 = 본인 도메인 재크롤) | 'off'
//   ★ 단계 로그(테리 지시): index(요청)→done(반영)/warn(거부). 주소는 신뢰지표로만 남김(posts.indexnow_*).
async function pushOrderIndex(adminToken: string, orderId: string) {
  const { data, error } = await sb.rpc("backlink_bot_indexnow_plan", { p_token: adminToken, p_order_id: orderId });
  if (error) throw new Error(error.message);
  const plan = (data && data[0]) || null;
  if (!plan) return { skipped: "order_not_found" };
  const scope: string = plan.scope || "admin";
  const key: string | null = plan.effective_key || null;
  if (scope === "off") return { skipped: "scope_off" };
  if (!key) return { skipped: "no_key", note: scope === "own" ? "회원 본인키 미설정" : "관리자 공용키 미설정(설정 탭에서 입력)" };

  const posts: Array<{ id: string; url: string }> = plan.posts || [];
  // scope=own → 회원 도메인(target_url)도 함께 재크롤 요청(본인키는 본인 도메인에서만 검증됨)
  const jobs: string[] = posts.map(p => p.url).filter(Boolean);
  if (scope === "own" && plan.target_url) jobs.push(plan.target_url);

  const groups = groupByHost(jobs);
  let accepted = 0, rejected = 0, pushedPosts = 0;
  for (const [host, urls] of groups) {
    const r = await submitIndexNow(host, key, urls);
    if (r.result === "accepted" || r.result === "pending") accepted += urls.length; else rejected += urls.length;
    // 이 호스트에 속한 게시물들 색인상태 기록
    for (const p of posts) {
      let h = ""; try { h = new URL(p.url).host; } catch {}
      if (h !== host) continue;
      await sb.rpc("backlink_bot_mark_indexnow", {
        p_token: adminToken, p_post_id: p.id,
        p_engines: INDEXNOW_ENGINES,
        p_result: r.result === "accepted" ? "accepted" : r.result === "pending" ? "pending" : "rejected",
      });
      pushedPosts++;
    }
    await new Promise(rs => setTimeout(rs, 300));
  }
  return { ok: true, scope, hosts: groups.size, accepted, rejected, pushedPosts };
}

// 수동/배치 색인 푸시 트리거
//   body: { adminToken, orderId }
app.post("/index-push", async (req, res) => {
  const { adminToken, orderId } = req.body || {};
  if (!adminToken || !orderId) return res.status(400).json({ error: "adminToken, orderId 필요" });
  try { res.json(await pushOrderIndex(adminToken, orderId)); }
  catch (e: any) { res.status(400).json({ error: e?.message || String(e) }); }
});

// ── 색인 확인: 게시물 URL을 빙 site: 검색 → 색인됐으면 indexed 마킹 ──
//   body: { adminToken, orderId?, minAgeHours? }  (회원 "지금 확인"=즉시, 자동배치=72시간)
app.post("/check-index", async (req, res) => {
  const { adminToken, orderId, minAgeHours } = req.body || {};
  if (!adminToken) return res.status(400).json({ error: "adminToken 필요" });
  const { data: pend, error } = await sb.rpc("backlink_bot_pending_index", {
    p_token: adminToken, p_order_id: orderId || null, p_min_age_hours: minAgeHours ?? 0, p_limit: 100,
  });
  if (error) return res.status(400).json({ error: error.message });
  // ★ 색인 확인 = 구글 Custom Search 우선(테리 확정). key/cx 없으면 빙 스크래핑 폴백.
  const [{ data: gKey }, { data: gCx }] = await Promise.all([
    sb.rpc("admin_backlink_get_config", { p_token: adminToken, p_key: "google_api_key" }),
    sb.rpc("admin_backlink_get_config", { p_token: adminToken, p_key: "google_cx" }),
  ]);
  const useGoogle = !!(gKey && gCx);
  let checked = 0, indexed = 0, engine = useGoogle ? "google" : "bing";
  for (const p of (pend || []) as any[]) {
    checked++;
    let ok = false;
    if (useGoogle) {
      const r = await isIndexedGoogle(p.post_url, gKey as string, gCx as string);
      if (!r.ok && r.reason === "quota_exceeded") break; // 하루 100건 한도 → 중단
      ok = r.indexed;
    } else {
      ok = await isIndexedBing(p.post_url);
    }
    if (ok) {
      await sb.rpc("backlink_bot_mark_indexed", { p_token: adminToken, p_post_id: p.id, p_engine: engine });
      indexed++;
    }
    await new Promise(r => setTimeout(r, useGoogle ? 300 : 800));
  }
  res.json({ ok: true, checked, indexed, engine });
});

// ★2026-09-07 우리소유 블로그(tarryguide·tarryblog 등)를 DB에서 읽어 어댑터 registry에 등록.
//   관리자가 도메인 추가하면 반영되게 시작 시 + 5분마다 갱신.
async function loadOwnedDomains(): Promise<void> {
  try {
    const { data } = await sb.rpc("backlink_bot_owned_domains", { p_token: "456789" });
    for (const d of (data || [])) {
      if (d?.domain && d?.api_url) registerOwnedBlog(d.domain as string, d.api_url as string);
    }
    console.log(`[backlink-bot] 우리소유 블로그 ${(data || []).length}개 등록: ${(data || []).map((x: any) => x.domain).join(", ")}`);
  } catch (e: any) { console.log(`[backlink-bot] 우리소유 도메인 로드 실패: ${e?.message || e}`); }
}

app.listen(PORT, "127.0.0.1", async () => {
  await loadOwnedDomains();
  setInterval(loadOwnedDomains, 5 * 60 * 1000);   // 5분마다 갱신
  console.log(`[backlink-bot] listening on 127.0.0.1:${PORT} (auth=${AUTH_TOKEN ? "on" : "off"}) adapters=${listAdapterDomains().join(",")}`);
});
