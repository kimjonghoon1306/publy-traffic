// ─────────────────────────────────────────────────────────────
// Edge Function: backlink-run
//   관리자 웹(폰/태블릿 포함)에서 로컬 봇 없이 백링크를 실행한다.
//   어댑터가 전부 순수 fetch(HTTP)라 서버(Deno)에서 그대로 돈다.
//   GET /functions/v1/backlink-run?adminToken=..&orderId=..&targetDomain=..&count=N
//   → SSE(text/event-stream)로 실시간 로그 + 실제 발송 링크(관리자용) 전송.
//   게시검증(실URL 링크삽입 확인) + 색인 자동(IndexNow) + record_post 기록까지 서버에서.
//   ★ --no-verify-jwt 로 배포(EventSource가 헤더 못 붙임). adminToken은 RPC가 자체검증.
// ─────────────────────────────────────────────────────────────
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};

const nowISO = () => new Date().toISOString();
type Ev = { kind: string; msg: string; at: string };
const ev = (kind: string, msg: string): Ev => ({ kind, msg, at: nowISO() });

// ── 콘텐츠 생성(앵커 다양화) ──
const ANCHORS = ["자세히 보기", "바로가기", "홈페이지 방문", "더 알아보기", "공식 사이트"];
function genContent(domain: string, i: number) {
  const name = domain.replace(/\.(com|co\.kr|kr|net|shop)$/, "");
  const titles = [`${name} 신선 상품 산지직송 안내`, `${name} 추천 이유와 이용 방법`, `${name}에서 만나는 믿을 수 있는 상품`];
  const bodies = [
    `${domain}은(는) 검증된 품질과 빠른 배송으로 많은 분들이 찾는 곳입니다. 합리적인 가격과 신뢰를 바탕으로 서비스를 제공합니다.`,
    `${domain}의 상품과 서비스를 소개합니다. 꼼꼼한 관리와 정직한 운영으로 재구매율이 높습니다.`,
  ];
  return { title: titles[i % titles.length], body: bodies[i % bodies.length], anchor: ANCHORS[i % ANCHORS.length] };
}

type PubInput = { targetDomain: string; targetUrl: string; title: string; body: string; anchor: string; secrets: Record<string, string> };
type PubResult = { ok: boolean; postUrl?: string; evidence: Record<string, any>; events: Ev[]; error?: string };

async function form(url: string, params: Record<string, string>) {
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(params).toString() });
  return { status: res.status, json: await res.json().catch(() => ({})) };
}

// ── 어댑터 6개 ──
async function telegraphLike(api: string, key: string, input: PubInput): Promise<PubResult> {
  const events = [ev("apistart", `${key} 소스에 연결하는 중…`)];
  try {
    const acc = await form(`${api}/createAccount`, { short_name: input.targetDomain.slice(0, 30), author_name: input.title.slice(0, 40), author_url: input.targetUrl });
    if (!acc.json?.ok) { events.push(ev("fail", "계정 생성 실패")); return { ok: false, evidence: { http_code: acc.status, step: "createAccount" }, events, error: "createAccount" }; }
    const token = acc.json.result.access_token;
    events.push(ev("botstart", "소스 인증 완료 · 게시 자리 준비됨"));
    events.push(ev("ai", "소개 글과 자연스러운 백링크 앵커를 배치하는 중…"));
    const content = [{ tag: "p", children: [input.body] }, { tag: "p", children: ["▶ ", { tag: "a", attrs: { href: input.targetUrl }, children: [input.anchor] }] }];
    const page = await form(`${api}/createPage`, { access_token: token, title: input.title.slice(0, 200), author_name: input.title.slice(0, 40), author_url: input.targetUrl, content: JSON.stringify(content), return_content: "false" });
    if (!page.json?.ok) { events.push(ev("fail", "페이지 게시 실패")); return { ok: false, evidence: { http_code: page.status, step: "createPage" }, events, error: "createPage" }; }
    events.push(ev("post", `${key} 게시 완료 · 백링크 앵커 삽입 · 응답 200 · A급 소스`));
    return { ok: true, postUrl: page.json.result.url, evidence: { http_code: 200, source: key, posted_at: nowISO() }, events };
  } catch (e) { events.push(ev("fail", "네트워크 오류: " + (e as any)?.message)); return { ok: false, evidence: { step: "exception" }, events, error: String(e) }; }
}

function parseCookie(setCookie: string | null, name: string): string {
  if (!setCookie) return ""; const m = new RegExp(name + "=([^;]+)").exec(setCookie); return m ? m[1] : "";
}
async function rentry(input: PubInput): Promise<PubResult> {
  const events = [ev("apistart", "rentry.co 소스에 연결하는 중…")];
  try {
    const home = await fetch("https://rentry.co/", { headers: { "User-Agent": "Mozilla/5.0" } });
    const csrf = parseCookie(home.headers.get("set-cookie"), "csrftoken");
    if (!csrf) { events.push(ev("fail", "CSRF 획득 실패")); return { ok: false, evidence: { step: "csrf" }, events, error: "csrf" }; }
    events.push(ev("botstart", "소스 인증 완료 · 게시 자리 준비됨"));
    events.push(ev("ai", "소개 글과 자연스러운 백링크 앵커를 배치하는 중…"));
    const text = `${input.title}\n\n${input.body}\n\n▶ ${input.anchor}: ${input.targetUrl}`;
    const res = await fetch("https://rentry.co/api/new", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", "Referer": "https://rentry.co", "Cookie": `csrftoken=${csrf}`, "User-Agent": "Mozilla/5.0" }, body: new URLSearchParams({ csrfmiddlewaretoken: csrf, text }).toString() });
    const json: any = await res.json().catch(() => ({}));
    if (json?.status !== "200" || !json?.url) { events.push(ev("fail", "게시 실패: " + (json?.content || res.status))); return { ok: false, evidence: { http_code: res.status, step: "new" }, events, error: "rentry" }; }
    events.push(ev("post", "rentry.co 게시 완료 · 백링크 앵커 삽입 · 응답 200 · A급 소스"));
    return { ok: true, postUrl: json.url, evidence: { http_code: 200, source: "rentry.co", posted_at: nowISO() }, events };
  } catch (e) { events.push(ev("fail", "네트워크 오류: " + (e as any)?.message)); return { ok: false, evidence: { step: "exception" }, events, error: String(e) }; }
}
async function dpaste(input: PubInput): Promise<PubResult> {
  const events = [ev("apistart", "dpaste.com 소스에 연결하는 중…"), ev("botstart", "게시 자리 준비됨"), ev("ai", "소개 글과 백링크 앵커를 배치하는 중…")];
  try {
    const content = `${input.title}\n\n${input.body}\n\n▶ ${input.anchor}: ${input.targetUrl}`;
    const res = await fetch("https://dpaste.com/api/v2/", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", "User-Agent": "Mozilla/5.0" }, body: new URLSearchParams({ content, syntax: "text", expiry_days: "365" }).toString() });
    const text = (await res.text()).trim(); const url = text.startsWith("http") ? text.split(/\s/)[0] : "";
    if (!res.ok || !url) { events.push(ev("fail", "게시 실패: HTTP " + res.status)); return { ok: false, evidence: { http_code: res.status }, events, error: "dpaste" }; }
    events.push(ev("post", "dpaste.com 게시 완료 · 백링크 앵커 삽입 · 응답 200 · A급 소스"));
    return { ok: true, postUrl: url, evidence: { http_code: 200, source: "dpaste.com", posted_at: nowISO() }, events };
  } catch (e) { events.push(ev("fail", "네트워크 오류: " + (e as any)?.message)); return { ok: false, evidence: { step: "exception" }, events, error: String(e) }; }
}
async function pasters(input: PubInput): Promise<PubResult> {
  const events = [ev("apistart", "paste.rs 소스에 연결하는 중…"), ev("botstart", "게시 자리 준비됨"), ev("ai", "소개 글과 백링크 앵커를 배치하는 중…")];
  try {
    const content = `${input.title}\n\n${input.body}\n\n▶ ${input.anchor}: ${input.targetUrl}`;
    const res = await fetch("https://paste.rs/", { method: "POST", headers: { "Content-Type": "text/plain", "User-Agent": "Mozilla/5.0" }, body: content });
    const text = (await res.text()).trim(); const url = text.startsWith("http") ? text.split(/\s/)[0] : "";
    if ((res.status !== 201 && res.status !== 200) || !url) { events.push(ev("fail", "게시 실패: HTTP " + res.status)); return { ok: false, evidence: { http_code: res.status }, events, error: "pasters" }; }
    events.push(ev("post", "paste.rs 게시 완료 · 백링크 앵커 삽입 · 응답 201 · B급 소스"));
    return { ok: true, postUrl: url, evidence: { http_code: 201, source: "paste.rs", posted_at: nowISO() }, events };
  } catch (e) { events.push(ev("fail", "네트워크 오류: " + (e as any)?.message)); return { ok: false, evidence: { step: "exception" }, events, error: String(e) }; }
}
async function githubGist(input: PubInput): Promise<PubResult> {
  const events = [ev("apistart", "gist.github.com 소스에 연결하는 중…")];
  try {
    const token = input.secrets?.github_gist_token || "";
    if (!token) { events.push(ev("fail", "우리소유 소스 토큰 미설정")); return { ok: false, evidence: { step: "no_token" }, events, error: "no_token" }; }
    events.push(ev("botstart", "소스 인증 완료 · 게시 자리 준비됨"));
    events.push(ev("ai", "소개 글과 자연스러운 백링크 앵커를 배치하는 중…"));
    const fname = `${input.targetDomain.replace(/[^a-z0-9.]/gi, "-").slice(0, 40)}.md`;
    const content = `# ${input.title}\n\n${input.body}\n\n▶ [${input.anchor}](${input.targetUrl})\n\n참고: ${input.targetUrl}\n`;
    const res = await fetch("https://api.github.com/gists", { method: "POST", headers: { "Authorization": `token ${token}`, "Content-Type": "application/json", "Accept": "application/vnd.github+json", "User-Agent": "publy-backlink" }, body: JSON.stringify({ description: `${input.title} — ${input.anchor}`, public: true, files: { [fname]: { content } } }) });
    const json: any = await res.json().catch(() => ({}));
    if (!res.ok || !json?.html_url) { events.push(ev("fail", "게시 실패: HTTP " + res.status)); return { ok: false, evidence: { http_code: res.status, msg: json?.message }, events, error: "gist" }; }
    events.push(ev("post", "gist.github.com 게시 완료 · dofollow · 우리소유 A급 소스"));
    return { ok: true, postUrl: json.html_url, evidence: { http_code: 201, source: "gist.github.com", posted_at: nowISO(), dofollow: true, owned: true }, events };
  } catch (e) { events.push(ev("fail", "네트워크 오류: " + (e as any)?.message)); return { ok: false, evidence: { step: "exception" }, events, error: String(e) }; }
}

const ADAPTERS: Record<string, (i: PubInput) => Promise<PubResult>> = {
  "telegra.ph": (i) => telegraphLike("https://api.telegra.ph", "telegra.ph", i),
  "graph.org": (i) => telegraphLike("https://api.graph.org", "graph.org", i),
  "rentry.co": rentry,
  "dpaste.com": dpaste,
  "paste.rs": pasters,
  "gist.github.com": githubGist,
};
const ADAPTER_DOMAINS = Object.keys(ADAPTERS);

// ── 게시검증(실 URL 열어 타겟 링크 삽입 확인) ──
async function verifyBacklink(postUrl: string, targetDomain: string): Promise<{ ok: boolean; count: number; note: string }> {
  const bare = targetDomain.replace(/^https?:\/\//, "").replace(/\/.*$/, "").toLowerCase();
  try {
    const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), 12000);
    const res = await fetch(postUrl, { redirect: "follow", headers: { "User-Agent": "Mozilla/5.0" }, signal: ctrl.signal });
    clearTimeout(t);
    if (!res.ok) return { ok: false, count: 0, note: `게시물 접근 불가(HTTP ${res.status})` };
    const html = (await res.text()).toLowerCase();
    if (/blacklist|banned|not found|파킹|domain for sale/.test(html) && !html.includes(bare)) return { ok: false, count: 0, note: "차단/빈 페이지" };
    const count = html.split(bare).length - 1;
    if (count <= 0) return { ok: false, count: 0, note: "링크 미삽입" };
    return { ok: true, count, note: "확인됨" };
  } catch (e) { return { ok: false, count: 0, note: `검증 실패: ${(e as any)?.name === "AbortError" ? "시간초과" : (e as any)?.message}` }; }
}

// ── IndexNow 색인 ──
async function submitIndexNow(host: string, key: string, urls: string[]) {
  if (!key || urls.length === 0) return { result: "error", status: 0 };
  try {
    const res = await fetch("https://api.indexnow.org/indexnow", { method: "POST", headers: { "Content-Type": "application/json; charset=utf-8" }, body: JSON.stringify({ host, key, keyLocation: `https://${host}/${key}.txt`, urlList: urls.slice(0, 10000) }) });
    if (res.status === 200) return { result: "accepted", status: 200 };
    if (res.status === 202) return { result: "pending", status: 202 };
    if (res.status === 403 || res.status === 422) return { result: "rejected", status: res.status };
    return { result: "error", status: res.status };
  } catch { return { result: "error", status: 0 }; }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  const url = new URL(req.url);
  const adminToken = url.searchParams.get("adminToken") || "";
  const orderId = url.searchParams.get("orderId") || "";
  const targetDomain = (url.searchParams.get("targetDomain") || "").trim();
  const count = Math.max(1, Math.min(50, Number(url.searchParams.get("count")) || 1));

  const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  const enc = new TextEncoder();
  const targetUrl = targetDomain.startsWith("http") ? targetDomain : `https://${targetDomain}`;

  const stream = new ReadableStream({
    async start(controller) {
      const send = (obj: any) => controller.enqueue(enc.encode(`data: ${JSON.stringify(obj)}\n\n`));
      try {
        if (!adminToken || !orderId || !targetDomain) { send({ type: "error", msg: "adminToken, orderId, targetDomain 필요" }); controller.close(); return; }
        send({ type: "log", kind: "wait", msg: `🚀 [서버 실행] ${targetDomain}에 최대 ${count}개 · 폰/PC 어디서나` });

        // 유니크 스킵
        const { data: doneSrc } = await sb.rpc("backlink_bot_posted_sources", { p_token: adminToken, p_order_id: orderId });
        const doneSet = new Set<string>((doneSrc as string[] | null) || []);
        // gist 토큰
        const secrets: Record<string, string> = {};
        try { const { data: ght } = await sb.rpc("admin_backlink_get_config", { p_token: adminToken, p_key: "github_gist_token" }); if (ght) secrets.github_gist_token = ght as string; } catch { /* 없으면 gist 스킵 */ }

        const domains = ADAPTER_DOMAINS.filter((d) => !doneSet.has(d));
        let posted = 0;
        for (let i = 0; i < domains.length && posted < count; i++) {
          const dom = domains[i];
          const c = genContent(targetDomain, i);
          const input: PubInput = { targetDomain, targetUrl, title: c.title, body: c.body, anchor: c.anchor, secrets };
          const r = await ADAPTERS[dom](input);
          for (const e of r.events) send({ type: "log", kind: e.kind, msg: `[${dom}] ${e.msg}` });
          let realOk = r.ok; let verifyNote = "";
          if (r.ok && r.postUrl) {
            const v = await verifyBacklink(r.postUrl, targetDomain);
            realOk = v.ok; verifyNote = v.note;
            if (v.ok) send({ type: "log", kind: "post", msg: `[${dom}] 🔎 게시 확인 · 링크 ${v.count}개 삽입` });
            else send({ type: "log", kind: "fail", msg: `[${dom}] ⚠️ 게시 실패(가짜) — ${v.note}` });
          }
          const evidence = { ...r.evidence, events: r.events, verified: realOk, verify_note: verifyNote };
          const { error } = await sb.rpc("backlink_bot_record_post", {
            p_token: adminToken, p_order_id: orderId, p_source_domain: dom, p_grade: "A",
            p_status: realOk ? "posted" : "failed", p_post_url: realOk ? (r.postUrl || null) : null, p_anchor: c.anchor, p_evidence: evidence, p_proxy_used: false,
          });
          if (error) send({ type: "log", kind: "warn", msg: `[${dom}] 기록 실패: ${error.message}` });
          else if (realOk) { posted++; send({ type: "post", kind: "post", source: dom, postUrl: r.postUrl || "", msg: `[${dom}] ✅ 게시 완료 (${posted}/${count})` }); }
        }

        // 색인 자동
        send({ type: "log", kind: "index", msg: `🔎 색인(IndexNow) 요청 중…` });
        try {
          const { data: planData } = await sb.rpc("backlink_bot_indexnow_plan", { p_token: adminToken, p_order_id: orderId });
          const plan = (planData && planData[0]) || null;
          if (plan && plan.effective_key && plan.scope !== "off") {
            const posts: Array<{ id: string; url: string }> = plan.posts || [];
            const jobs = posts.map((p) => p.url).filter(Boolean);
            if (plan.scope === "own" && plan.target_url) jobs.push(plan.target_url);
            const groups = new Map<string, string[]>();
            for (const u of jobs) { try { const h = new URL(u).host; if (!groups.has(h)) groups.set(h, []); groups.get(h)!.push(u); } catch { /* skip */ } }
            let acc = 0, rej = 0;
            for (const [host, urls] of groups) { const rr = await submitIndexNow(host, plan.effective_key, urls); if (rr.result === "accepted" || rr.result === "pending") acc += urls.length; else rej += urls.length; }
            send({ type: "log", kind: "done", msg: `색인 요청 완료 · 수락 ${acc} · 거부 ${rej}` });
          } else {
            send({ type: "log", kind: "warn", msg: `색인 키 미설정(색인키 탭에서 지정) — 게시는 완료됨` });
          }
        } catch (e) { send({ type: "log", kind: "warn", msg: `색인 요청 실패: ${(e as any)?.message}` }); }

        send({ type: "done", posted });
        controller.close();
      } catch (e) {
        send({ type: "error", msg: (e as any)?.message || String(e) });
        controller.close();
      }
    },
  });

  return new Response(stream, { headers: { ...CORS, "Content-Type": "text/event-stream", "Cache-Control": "no-cache", "Connection": "keep-alive" } });
});
