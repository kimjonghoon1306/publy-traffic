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
import { getAdapter, listAdapterDomains } from "./adapters";
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

app.use(cors({ origin: ["http://localhost:5173", "http://127.0.0.1:5173", "null"] }));
app.use(express.json({ limit: "50mb" }));
app.use((req, res, next) => {
  if (req.path === "/health") return next();
  if (AUTH_TOKEN) {
    const h = req.headers.authorization || "";
    if (h !== `Bearer ${AUTH_TOKEN}`) return res.status(401).json({ error: "unauthorized" });
  }
  next();
});

app.get("/health", (_req, res) => res.json({ ok: true, bot: "backlink-bot", port: PORT, adapters: listAdapterDomains() }));

// ── AI 콘텐츠 생성(파일럿: 템플릿 다양화. 추후 블로그오토프로 Gemini 연동) ──
const ANCHORS = ["자세히 보기", "바로가기", "홈페이지 방문", "더 알아보기", "공식 사이트"];
function genContent(domain: string, i: number): { title: string; body: string; anchor: string } {
  const name = domain.replace(/\.(com|co\.kr|kr|net|shop)$/, "");
  const titles = [
    `${name} 신선 상품 산지직송 안내`,
    `${name} 추천 이유와 이용 방법`,
    `${name}에서 만나는 믿을 수 있는 상품`,
  ];
  const bodies = [
    `${domain}은(는) 검증된 품질과 빠른 배송으로 많은 분들이 찾는 곳입니다. 합리적인 가격과 신뢰를 바탕으로 서비스를 제공합니다.`,
    `${domain}의 상품과 서비스를 소개합니다. 꼼꼼한 관리와 정직한 운영으로 재구매율이 높습니다.`,
  ];
  return {
    title: titles[i % titles.length],
    body: bodies[i % bodies.length],
    anchor: ANCHORS[i % ANCHORS.length],
  };
}

// ── 주문 게시(파일럿): 어댑터 있는 소스에 실제 게시 → 결과 기록 ──
//   body: { adminToken, orderId, targetDomain }
//   ※ 봇=관리자 권한. adminToken(관리자 세션)으로 record_post RPC 호출.
app.post("/publish-order", async (req, res) => {
  const { adminToken, orderId, targetDomain } = req.body || {};
  if (!adminToken || !orderId || !targetDomain) return res.status(400).json({ error: "adminToken, orderId, targetDomain 필요" });
  const targetUrl = targetDomain.startsWith("http") ? targetDomain : `https://${targetDomain}`;
  const domains = listAdapterDomains(); // 검증된 어댑터 소스(telegra.ph·rentry.co)
  // ★ 한 회원(주문)=한 소스=한 백링크(유니크, 체크리스트#47): 이미 성공한 소스는 스킵 → 중복 백링크 방지.
  const { data: doneSrc } = await sb.rpc("backlink_bot_posted_sources", { p_token: adminToken, p_order_id: orderId });
  const doneSet = new Set<string>((doneSrc as string[] | null) || []);
  const results: any[] = [];
  for (let i = 0; i < domains.length; i++) {
    const dom = domains[i];
    if (doneSet.has(dom)) { results.push({ source: dom, ok: false, skipped: "already_posted(유니크)" }); continue; }
    const adapter = getAdapter(dom)!;
    const c = genContent(targetDomain, i);
    const input: PublishInput = { targetDomain, targetUrl, title: c.title, body: c.body, anchor: c.anchor, proxy: null };
    const r = await adapter.publish(input);
    // 게시결과 기록 — evidence에 단계 events(API시작·게시성공) 포함해 저장
    const evidence = { ...r.evidence, events: r.events };
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

app.listen(PORT, "127.0.0.1", () => {
  console.log(`[backlink-bot] listening on 127.0.0.1:${PORT} (auth=${AUTH_TOKEN ? "on" : "off"}) adapters=${listAdapterDomains().join(",")}`);
});
