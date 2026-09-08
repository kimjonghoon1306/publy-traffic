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
function genContent(domain: string, i: number, keyword?: string) {
  const name = domain.replace(/\.(com|co\.kr|kr|net|shop)$/, "");
  const kw = (keyword || "").trim();
  const titles = kw
    ? [`${kw} — ${name} 안내`, `${kw} 찾는다면 ${name}`, `${name}에서 만나는 ${kw}`]
    : [`${name} 신선 상품 산지직송 안내`, `${name} 추천 이유와 이용 방법`, `${name}에서 만나는 믿을 수 있는 상품`];
  const bodies = [
    `${domain}은(는) 검증된 품질과 빠른 배송으로 많은 분들이 찾는 곳입니다.${kw ? ` 특히 ${kw} 관련해 신뢰를 받고 있습니다.` : ""} 합리적인 가격과 정직한 운영이 강점입니다.`,
    `${domain}의 상품과 서비스를 소개합니다.${kw ? ` ${kw}를 찾는 분들께 추천합니다.` : ""} 꼼꼼한 관리로 재구매율이 높습니다.`,
  ];
  // 키워드 있으면 앵커에도 섞음(구글이 "이 도메인=이 키워드" 학습 — 아임마케터 방식). 그래도 다양화.
  const anchors = kw ? [kw, "자세히 보기", kw + " 바로가기", "공식 사이트", "더 알아보기"] : ANCHORS;
  return { title: titles[i % titles.length], body: bodies[i % bodies.length], anchor: anchors[i % anchors.length] };
}

// ── 사이트 읽기: 도메인 페이지에서 제목·설명·본문 텍스트 추출(정적/SSR 대응 + OG/메타 보강) ──
async function readSite(targetUrl: string): Promise<string> {
  try {
    const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), 10000);
    const res = await fetch(targetUrl, { redirect: "follow", headers: { "User-Agent": "Mozilla/5.0" }, signal: ctrl.signal });
    clearTimeout(t);
    if (!res.ok) return "";
    let html = await res.text();
    const pick = (re: RegExp) => { const m = re.exec(html); return m ? m[1].trim() : ""; };
    const title = pick(/<title[^>]*>([^<]+)<\/title>/i);
    const desc = pick(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i) || pick(/<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)["']/i);
    const ogTitle = pick(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i);
    const ogSite = pick(/<meta[^>]+property=["']og:site_name["'][^>]+content=["']([^"']+)["']/i);
    const keywords = pick(/<meta[^>]+name=["']keywords["'][^>]+content=["']([^"']+)["']/i);
    // 헤딩(h1~h3)·상호 후보 추출 — 회사명/브랜드를 정확히 파악(AI가 이름 지어내는 것 방지)
    const heads = (html.match(/<h[1-3][^>]*>([\s\S]*?)<\/h[1-3]>/gi) || []).map(h => h.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim()).filter(Boolean).slice(0, 8).join(" · ");
    // 본문 텍스트(태그 제거) — 넉넉히
    html = html.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<nav[\s\S]*?<\/nav>/gi, " ").replace(/<footer[\s\S]*?<\/footer>/gi, " ");
    const bodyText = html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 3000);
    const parts = [
      ogSite ? `사이트/상호명: ${ogSite}` : "",
      title ? `제목: ${title}` : "",
      ogTitle && ogTitle !== title ? `대표문구: ${ogTitle}` : "",
      desc ? `소개: ${desc}` : "",
      keywords ? `키워드: ${keywords}` : "",
      heads ? `주요 항목: ${heads}` : "",
      bodyText ? `본문: ${bodyText}` : "",
    ].filter(Boolean);
    return parts.join("\n").slice(0, 4000);
  } catch { return ""; }
}

// ── Gemini 글 생성 (퍼블리 검증 패턴 그대로 — 모델 폴백 + thinkingBudget:0) ──
//   ★토시 하나라도 틀리면 "토큰 없다/한도 초과" 오탐 → 퍼블리 AdminPage 방식 복제.
const GEMINI_MODELS = ["gemini-2.5-flash", "gemini-2.5-flash-lite", "gemini-flash-latest", "gemini-flash-lite-latest"];
type AiOut = { ok: boolean; title?: string; body?: string; anchor?: string; quota?: boolean; error?: string };
async function genContentAI(key: string, domain: string, siteText: string, keyword: string, i: number): Promise<AiOut> {
  const kw = (keyword || "").trim();
  const prompt =
    `너는 12년차 SEO·AEO 카피라이터다. 아래 실제 웹사이트 내용을 바탕으로, 이 사이트를 소개하는 자연스럽고 구체적인 한국어 정보성 글을 써라. 광고 티 내지 말고 진짜 추천글처럼.\n` +
    `도메인: ${domain}\n` + (kw ? `핵심 키워드(반드시 제목·본문에 자연스럽게 포함): ${kw}\n` : "") +
    `━━━ 실제 사이트 내용(이것만 근거로 써라) ━━━\n${siteText || "(사이트 내용을 못 읽음)"}\n━━━━━━━━━━━━━━━━━━━\n\n` +
    `🔴 매우 중요(반드시 지켜라):\n` +
    `1. 사이트에 나온 정확한 상호·회사명·브랜드명을 그대로 써라. 이름을 절대 줄이거나 바꾸거나 지어내지 마라(예: '유안에프앤비'를 '원앤비'처럼 바꾸면 안 됨).\n` +
    `2. 사이트에 없는 상품·서비스·정보를 지어내지 마라. 근거 있는 내용만 구체적으로.\n` +
    `3. 사이트 내용을 못 읽었으면(위가 비었으면) 억지로 지어내지 말고, 도메인과 키워드만으로 일반적이고 무난하게 써라.\n\n` +
    `조건: ①매번 다른 문장·구성(중복 금지) ②제목 20~30자, 상호나 키워드 포함 ③본문 300~450자, 구체적·정보성·신뢰감(실제 취급 품목/특징을 사이트에서 뽑아 언급) ④과장/허위 금지 ⑤글자만(이모지·해시태그 금지).\n` +
    `JSON만 출력: {"title":"제목","body":"본문","anchor":"${kw || "링크 앵커 텍스트(4~10자)"}"}`;
  for (const model of GEMINI_MODELS) {
    try {
      const gc: any = { temperature: 0.9, maxOutputTokens: 1200, responseMimeType: "application/json" };
      if (model.includes("2.5")) gc.thinkingConfig = { thinkingBudget: 0 };   // ★필수: 안 주면 thinking에 토큰 다 써 빈 응답
      const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: gc }),
        signal: AbortSignal.timeout(40000),
      });
      if (!r.ok) {
        const j = await r.json().catch(() => null);
        const em = (j?.error?.message || "").toLowerCase();
        if (em.includes("quota") || em.includes("429") || r.status === 429 || em.includes("exhausted")) return { ok: false, quota: true };
        if (r.status === 400 || r.status === 403) return { ok: false, error: `키 오류(${r.status})` };   // 키 자체 문제면 다음 모델 무의미
        continue;   // 그 외는 다음 모델
      }
      const d: any = await r.json();
      let txt = (d?.candidates?.[0]?.content?.parts?.[0]?.text || "").trim().replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/```\s*$/i, "").trim();
      const s = txt.indexOf("{"), e = txt.lastIndexOf("}");
      if (s >= 0 && e > s) txt = txt.slice(s, e + 1);
      const x = JSON.parse(txt);
      if (x?.title && x?.body) return { ok: true, title: String(x.title).slice(0, 60), body: String(x.body).slice(0, 800), anchor: String(x.anchor || kw || ANCHORS[i % ANCHORS.length]).slice(0, 20) };
    } catch { /* 다음 모델 */ }
  }
  return { ok: false, error: "생성 실패" };
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

// ★2026-09-07 우리소유 블로그(tarryguide·tarryblog 등) 어댑터: POST {apiUrl} + X-API-Key(owned_blog_api_key).
function ownedBlog(domain: string, apiUrl: string) {
  return async (input: PubInput): Promise<PubResult> => {
    const events = [ev("apistart", `${domain} 소스에 연결하는 중…`)];
    try {
      const apiKey = input.secrets?.owned_blog_api_key || "";
      if (!apiKey) { events.push(ev("fail", "우리소유 블로그 발행 키 미설정")); return { ok: false, evidence: { step: "no_key" }, events, error: "no_key" }; }
      events.push(ev("botstart", "소스 인증 완료 · 게시 자리 준비됨"));
      events.push(ev("ai", "소개 글과 자연스러운 백링크 앵커를 배치하는 중…"));
      const esc = (s: string) => (s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
      const html = `<p>${esc(input.body)}</p><p>▶ <a href="${input.targetUrl}" rel="dofollow">${esc(input.anchor)}</a></p><p>참고: <a href="${input.targetUrl}">${esc(input.targetUrl)}</a></p>`;
      const res = await fetch(apiUrl, { method: "POST", headers: { "Content-Type": "application/json", "X-API-Key": apiKey }, body: JSON.stringify({ title: input.title, content: html, category: "정보", status: "published" }) });
      const json: any = await res.json().catch(() => ({}));
      const slug = json?.slug || json?.id || "";
      const url = json?.url || json?.link || (slug ? `https://${domain}/posts/${slug}` : undefined);
      if (!res.ok || !url) { events.push(ev("fail", "게시 실패: HTTP " + res.status)); return { ok: false, evidence: { http_code: res.status, msg: json?.error || json?.message }, events, error: "owned" }; }
      events.push(ev("post", `${domain} 게시 완료 · dofollow · 우리소유 A급 소스`));
      return { ok: true, postUrl: url, evidence: { http_code: res.status, source: domain, posted_at: nowISO(), dofollow: true, owned: true }, events };
    } catch (e) { events.push(ev("fail", "네트워크 오류: " + (e as any)?.message)); return { ok: false, evidence: { step: "exception" }, events, error: String(e) }; }
  };
}

const ADAPTERS: Record<string, (i: PubInput) => Promise<PubResult>> = {
  "telegra.ph": (i) => telegraphLike("https://api.telegra.ph", "telegra.ph", i),
  "graph.org": (i) => telegraphLike("https://api.graph.org", "graph.org", i),
  "rentry.co": rentry,
  "dpaste.com": dpaste,
  "paste.rs": pasters,
  "gist.github.com": githubGist,
};
// 우리소유 블로그를 DB에서 읽어 ADAPTERS에 동적 등록(스케줄러 실행 전 1회).
async function registerOwnedBlogs(sb: any, token: string): Promise<void> {
  try {
    const { data } = await sb.rpc("backlink_bot_owned_domains", { p_token: token });
    for (const d of (data || [])) {
      if (d?.domain && d?.api_url && !ADAPTERS[d.domain]) ADAPTERS[d.domain] = ownedBlog(d.domain, d.api_url);
    }
  } catch { /* skip */ }
}
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

// ── 빙 색인 확인(무료·진짜 검색 기반) — site: 검색 결과에 그 URL이 실제 있으면 색인됨. 구글 캡차와 달리 빙은 관대.
//   ★유료 API(구글 Custom Search)는 나중. 지금은 빙 무료 검색만으로 신뢰 근거 확보(테리 지시).
async function isIndexedBing(postUrl: string): Promise<boolean> {
  try {
    const clean = postUrl.replace(/^https?:\/\//, "");
    const q = encodeURIComponent(`site:${clean}`);
    const res = await fetch(`https://www.bing.com/search?q=${q}&setlang=ko`, { headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" } });
    const html = await res.text();
    if (/There are no results|검색 결과가 없습니다|결과 없음/.test(html)) return false;
    const algoBlocks = html.match(/class="b_algo"[\s\S]*?(?=class="b_algo"|<\/ol>|id="b_context")/g) || [];
    if (!algoBlocks.length) return false;
    const joined = algoBlocks.join(" ");
    const pathPart = (clean.replace(/\/$/, "").split("/").slice(1).join("/")).trim();
    const domain = clean.split("/")[0];
    if (!pathPart) return joined.includes(domain);
    let dec = pathPart; try { dec = decodeURIComponent(pathPart); } catch { /* keep */ }
    const enc = encodeURIComponent(pathPart);
    return joined.includes(pathPart) || joined.includes(enc) || joined.includes(dec);
  } catch { return false; }
}

// ── config 조회: 세션토큰(admin_backlink_get_config) 실패하면 시크릿(backlink_config_get)으로 재시도 ──
//   ★gist 토큰/gemini 키가 "미설정"으로 오탐되던 버그 수정(시크릿 기반 흐름은 세션RPC가 거부함).
async function getConfig(sb: any, token: string, key: string): Promise<string> {
  try { const { data, error } = await sb.rpc("admin_backlink_get_config", { p_token: token, p_key: key }); if (!error && data) return String(data); } catch { /* 다음 */ }
  try { const { data, error } = await sb.rpc("backlink_config_get", { p_token: token, p_key: key }); if (!error && data) return String(data); } catch { /* 없음 */ }
  return "";
}

// ── ⚙️ 어댑터 생성(웹/폰 가능, 순수 fetch) — 우리소유 gist(A) + telegra/graph(B) 수량만큼 생성·배치 ──
async function genOne(slot: number, gistToken: string): Promise<{ domain: string; scale: string; grade: string; detailUrl?: string; ok: boolean; note: string }> {
  try {
    if (slot < 2) {   // 우리소유 gist (A급)
      if (!gistToken) return { domain: "gist.github.com", scale: "owned", grade: "A", ok: false, note: "github 토큰 미설정" };
      const res = await fetch("https://api.github.com/gists", { method: "POST", headers: { "Authorization": `token ${gistToken}`, "Content-Type": "application/json", "Accept": "application/vnd.github+json", "User-Agent": "publy-backlink" }, body: JSON.stringify({ description: "source seed", public: true, files: { [`seed_${Date.now()}.md`]: { content: "# seed" } } }) });
      const j: any = await res.json().catch(() => ({}));
      if (!res.ok || !j?.html_url) return { domain: "gist.github.com", scale: "owned", grade: "A", ok: false, note: `HTTP ${res.status}` };
      return { domain: "gist.github.com", scale: "owned", grade: "A", detailUrl: j.html_url, ok: true, note: "우리소유 dofollow 생성" };
    }
    const api = (slot % 2 === 0) ? "https://api.telegra.ph" : "https://api.graph.org";
    const dom = (slot % 2 === 0) ? "telegra.ph" : "graph.org";
    const acc = await fetch(`${api}/createAccount`, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ short_name: "src", author_name: "src" }).toString() });
    const aj: any = await acc.json().catch(() => ({}));
    if (!aj?.ok) return { domain: dom, scale: "api", grade: "B", ok: false, note: "계정 생성 실패" };
    return { domain: dom, scale: "api", grade: "B", detailUrl: `https://${dom}`, ok: true, note: "계정 발급(무한생성 가능)" };
  } catch (e) { return { domain: "?", scale: "api", grade: "C", ok: false, note: `오류: ${(e as any)?.message || e}` }; }
}

// ── 핵심 게시 로직(SSE 실행·스케줄러 공유). send 콜백으로 로그 전송(SSE는 스트림, 스케줄러는 무시). posted 반환. ──
async function runPublish(sb: any, send: (o: any) => void, adminToken: string, orderId: string, targetDomain: string, count: number, kwOverride: string, triggerType: string = "manual"): Promise<number> {
  const targetUrl = targetDomain.startsWith("http") ? targetDomain : `https://${targetDomain}`;
  send({ type: "log", kind: "wait", msg: `🚀 [서버 실행] ${targetDomain}에 최대 ${count}개` });

        // gist 토큰 — ★2026-09-07: 회원 본인키 우선(빙키 방식). 본인키(scope=own) 있으면 그걸로, 없으면 관리자 공용키.
        const secrets: Record<string, string> = {};
        let ghKeySource = "관리자 공용키";
        try {
          const { data: gk } = await sb.rpc("backlink_bot_github_key", { p_token: adminToken, p_order_id: orderId });
          const row = (gk && gk[0]) || null;
          if (row && row.effective_key) {
            secrets.github_gist_token = row.effective_key;
            ghKeySource = row.scope === "own" ? "회원 본인 GitHub 키" : "관리자 공용키";
          }
        } catch { /* 폴백: 관리자 공용키 */ }
        if (!secrets.github_gist_token) { const ght = await getConfig(sb, adminToken, "github_gist_token"); if (ght) secrets.github_gist_token = ght; }
        send({ type: "log", kind: "index", msg: `🔑 GitHub 키 활성화 — ${ghKeySource}로 게시합니다` });
        // ★2026-09-07 우리소유 블로그(tarryguide·tarryblog) 등록 + 발행키 주입.
        await registerOwnedBlogs(sb, adminToken);
        { const obk = await getConfig(sb, adminToken, "owned_blog_api_key"); if (obk) secrets.owned_blog_api_key = obk; }

        // 🤖 AI 글생성 설정: order의 회원 Gemini 키·키워드, 없으면 관리자 공용키(config).
        let geminiKey = ""; let keyword = ""; let keySource = "";
        try {
          const { data: aiCfg } = await sb.rpc("backlink_order_ai_config", { p_token: adminToken, p_order_id: orderId });
          const row = (aiCfg && aiCfg[0]) || null;
          if (row) { geminiKey = (row.gemini_key || "").trim(); keyword = (row.keyword || "").trim(); }
          if (kwOverride) keyword = kwOverride;   // 관리자 실행 URL 키워드 우선
          if (!geminiKey) { const adm = await getConfig(sb, adminToken, "gemini_admin_key"); if (adm) { geminiKey = adm.trim(); keySource = "관리자 공용키"; } }
          else keySource = "회원 키";
        } catch { /* 키 없으면 템플릿 폴백 */ }
        let quotaHit = false;   // 한도 소진되면 이후 게시는 템플릿으로(멈추지 않음)
        if (geminiKey) {
          send({ type: "log", kind: "ai", msg: `🤖 제미나이 키가 적용됩니다 (${keySource})${keyword ? ` · 키워드 "${keyword}"` : ""} — 사이트를 읽고 글을 씁니다` });
        } else {
          send({ type: "log", kind: "warn", msg: `ℹ️ 제미나이 키 미설정 — 기본 글로 진행(키를 넣으면 사이트 기반 고품질 글로 써요)` });
        }
        // 사이트 1회 읽어 재사용
        let siteText = "";
        if (geminiKey) { siteText = await readSite(targetUrl); send({ type: "log", kind: "ai", msg: siteText ? `📖 사이트 내용을 읽었습니다 (${siteText.length}자 분석)` : `📖 사이트 내용을 못 읽어 도메인·키워드로 유추합니다` }); }

        // 🔄 토큰 절약: AI 글을 최대 POOL_SIZE(5)개만 생성해 돌려쓴다(100개든 500개든 AI는 5번만 호출).
        //   ★재사용 시 변형=제목 표현·앵커·문장 순서만. 도메인·상호·소개(사실)는 절대 안 바꿈(틀리면 AI 인용 안 됨).
        const POOL_SIZE = 5;
        const pool: { title: string; body: string; anchor: string }[] = [];
        if (geminiKey && !quotaHit) {
          const need = Math.min(POOL_SIZE, count);
          send({ type: "log", kind: "ai", msg: `✍️ 제미나이로 글 ${need}개를 만들어 돌려씁니다(토큰 절약 · 재사용 시 표현만 변형, 사실은 그대로)` });
          for (let k = 0; k < need; k++) {
            const ai = await genContentAI(geminiKey, targetDomain, siteText, keyword, k);
            if (ai.ok) pool.push({ title: ai.title!, body: ai.body!, anchor: ai.anchor! });
            else if (ai.quota) { quotaHit = true; send({ type: "log", kind: "warn", msg: `🛑 토큰 사용이 끝났습니다 — 자정이 지나거나 새로운 제미나이 키를 발급받으세요. (만든 글 ${pool.length}개로 돌려씁니다)` }); break; }
            else if (ai.error) { send({ type: "log", kind: "warn", msg: `제미나이 생성 실패(${ai.error})` }); }
          }
          if (pool.length) send({ type: "log", kind: "ai", msg: `✅ 글 ${pool.length}개 준비 완료 — 소스마다 돌려쓰며 표현을 변형합니다` });
        }
        // 재사용 변형: 사실(본문 문장)은 그대로, 앵커·제목 접미만 로테이션(구글 중복스팸 회피). 도메인/상호 불변.
        const ANCH_VARIANTS = ["자세히 보기", "바로가기", "홈페이지 방문", "더 알아보기", "공식 사이트", "여기서 확인"];
        const applyVariant = (base: { title: string; body: string; anchor: string }, reuse: number): { title: string; body: string; anchor: string } => {
          if (reuse === 0) return base;   // 첫 사용은 원본 그대로
          const anchor = keyword ? [keyword, keyword + " 바로가기", keyword + " 자세히", "공식 사이트", "홈페이지"][reuse % 5] : ANCH_VARIANTS[reuse % ANCH_VARIANTS.length];
          const suffixes = ["", " 안내", " 소개", " 정보", " 살펴보기"];
          const title = base.title + suffixes[reuse % suffixes.length];   // 제목 접미만 변형(상호·키워드 그대로)
          return { title, body: base.body, anchor };   // ★body(사실)는 절대 안 바꿈
        };

        // ★2026-09-08 근본수정: "소스당 1회"(doneSet 스킵) 폐기 → 라운드로빈으로 count개를 채운다.
        //   백링크는 같은 소스에 새 URL로 여러 개 올리는 게 정상 → 소스가 소진돼도 0개가 안 나게 소스를 돌려 쓴다.
        //   strong(rentry·gist·graph) 먼저 정렬. 우리블로그는 발행키 있을 때만. 실패 소스는 이번 실행에서 제외.
        const STRONG = new Set(["rentry.co", "gist.github.com", "graph.org"]);
        const hasOwnedKey = !!secrets.owned_blog_api_key;
        const ownedBlogs = new Set(Object.keys(ADAPTERS).filter((d) => !ADAPTER_DOMAINS.includes(d)));
        const sources = Object.keys(ADAPTERS)
          .filter((d) => hasOwnedKey || !ownedBlogs.has(d))
          .sort((a, b) => (STRONG.has(a) ? 0 : 1) - (STRONG.has(b) ? 0 : 1));
        let posted = 0;
        const tier1Urls: string[] = [];   // 성공한 1차 URL(2차 부스팅 대상)
        const useCount: Record<number, number> = {};   // 각 글이 몇 번째로 재사용되는지
        const dead = new Set<string>();   // 이번 실행에서 실패하는 소스(로테이션 제외)
        let n = 0, guard = 0;
        const maxTries = count * 3 + sources.length;
        while (posted < count && guard < maxTries) {
          guard++;
          const live = sources.filter((d) => !dead.has(d));
          if (live.length === 0) break;
          const dom = live[n % live.length];
          n++;
          let c = genContent(targetDomain, n, keyword);
          if (pool.length) {
            const idx = n % pool.length;
            const reuse = (useCount[idx] = (useCount[idx] || 0));
            c = applyVariant(pool[idx], reuse);
            useCount[idx] = reuse + 1;
            send({ type: "log", kind: "ai", msg: `[${dom}] ✍️ 글 ${idx + 1}번${reuse > 0 ? ` (재사용·표현변형 ${reuse})` : ""}` });
          }
          const input: PubInput = { targetDomain, targetUrl, title: c.title, body: c.body, anchor: c.anchor, secrets };
          // 📄 완성본 글(제목·본문·앵커)을 관리자 화면에 그대로 — 테리가 품질 확인·수정하려면 필수(회원 화면은 이 이벤트 무시).
          send({ type: "content", source: dom, title: c.title, body: c.body, anchor: c.anchor });
          const r = await ADAPTERS[dom](input);
          for (const e of r.events) send({ type: "log", kind: e.kind, msg: `[${dom}] ${e.msg}` });
          if (!r.ok) { dead.add(dom); continue; }   // 어댑터 실패 소스는 제외(재시도 낭비·failed 레코드 방지)
          let realOk: boolean = r.ok; let verifyNote = "";
          if (r.ok && r.postUrl) {
            const v = await verifyBacklink(r.postUrl, targetDomain);
            realOk = v.ok; verifyNote = v.note;
            if (v.ok) send({ type: "log", kind: "post", msg: `[${dom}] 🔎 게시 확인 · 링크 ${v.count}개 삽입` });
            else send({ type: "log", kind: "fail", msg: `[${dom}] ⚠️ 게시 실패(가짜) — ${v.note}` });
          }
          // ★V(테리): 어떤 글이었는지 영구 저장 — evidence에 제목·본문·앵커. 감사탭에서 나중에 시분초와 함께 다시 봄.
          const evidence = { ...r.evidence, events: r.events, verified: realOk, verify_note: verifyNote, trigger: triggerType, article: { title: c.title, body: c.body, anchor: c.anchor } };
          const { error } = await sb.rpc("backlink_bot_record_post", {
            p_token: adminToken, p_order_id: orderId, p_source_domain: dom, p_grade: "A",
            p_status: realOk ? "posted" : "failed", p_post_url: realOk ? (r.postUrl || null) : null, p_anchor: c.anchor, p_evidence: evidence, p_proxy_used: false,
          });
          if (error) send({ type: "log", kind: "warn", msg: `[${dom}] 기록 실패: ${error.message}` });
          else if (realOk) { posted++; tier1Urls.push(r.postUrl || ""); send({ type: "post", kind: "post", source: dom, postUrl: r.postUrl || "", msg: `[${dom}] ✅ 게시 완료 (${posted}/${count})` }); }
        }

        // ★2026-09-07 티어2 부스팅: 성공한 1차 URL을 weak 소스(telegra·dpaste·paste.rs)로 밀어준다.
        //   회원 사이트 아니라 1차 URL을 가리킴(parent_url). 스팸OK. 1차당 TIER2_PER개.
        try {
          const okUrls = tier1Urls.filter(Boolean);
          if (okUrls.length) {
            const TIER2_SOURCES = ["telegra.ph", "dpaste.com", "paste.rs"].filter(d => ADAPTERS[d]);
            const TIER2_PER = 3;   // 1차 1개당 2차 몇 개(안전: 소량부터. 나중 상향)
            send({ type: "log", kind: "wait", msg: `🔁 2차 부스팅 시작 — 1차 ${okUrls.length}개를 여러 소스로 밀어줍니다` });
            let t2ok = 0;
            for (const p1 of okUrls) {
              for (let k = 0; k < TIER2_PER; k++) {
                const src = TIER2_SOURCES[(t2ok) % TIER2_SOURCES.length];
                if (!src) break;
                // 2차 글: 1차 URL을 타겟으로(회원 사이트 아님). 앵커는 일반적(브랜드 아님).
                const t2c = genContent(new URL(p1).host, t2ok, "");
                const t2input: PubInput = { targetDomain: new URL(p1).host, targetUrl: p1, title: t2c.title, body: t2c.body, anchor: "관련 글 보기", secrets };
                const rr = await ADAPTERS[src](t2input);
                if (rr.ok) {
                  t2ok++;
                  try {
                    await sb.rpc("backlink_bot_record_post", {
                      p_token: adminToken, p_order_id: orderId, p_source_domain: src, p_grade: "B",
                      p_status: "posted", p_post_url: rr.postUrl || null, p_anchor: "관련 글 보기",
                      p_evidence: { ...rr.evidence, tier: 2, parent_url: p1, trigger: triggerType }, p_proxy_used: false,
                    });
                  } catch { /* 2차 기록 실패는 무시(1차는 이미 성공) */ }
                }
              }
            }
            send({ type: "log", kind: "post", msg: `🔁 2차 부스팅 완료 — ${t2ok}개로 1차를 강화했어요(순위·색인 촉진)` });
          }
        } catch (e) { send({ type: "log", kind: "warn", msg: `2차 부스팅 일부 실패: ${(e as any)?.message}` }); }

        // 색인 자동
        let indexedAcc = 0;   // 이번 실행 색인 수락 건수(자동발송 로그에 기록)
        send({ type: "log", kind: "index", msg: `🔎 색인(IndexNow) 요청 중…` });
        try {
          const { data: planData } = await sb.rpc("backlink_bot_indexnow_plan", { p_token: adminToken, p_order_id: orderId });
          const plan = (planData && planData[0]) || null;
          if (plan && plan.effective_key && plan.scope !== "off") {
            // ★색인키가 설정돼 있을 때만 "빙 연결됨" 표시(테리: 그냥 쓰지 말고 설정됐을 때). 회원 화면엔 키·사이트 노출 안 함.
            send({ type: "log", kind: "index", msg: `🔗 빙(IndexNow) 색인 연결됨 — 게시 즉시 빙에 색인 요청을 보냅니다` });
            const posts: Array<{ id: string; url: string }> = plan.posts || [];
            const jobs = posts.map((p) => p.url).filter(Boolean);
            if (plan.scope === "own" && plan.target_url) jobs.push(plan.target_url);
            const groups = new Map<string, string[]>();
            for (const u of jobs) { try { const h = new URL(u).host; if (!groups.has(h)) groups.set(h, []); groups.get(h)!.push(u); } catch { /* skip */ } }
            let acc = 0, rej = 0;
            for (const [host, urls] of groups) { const rr = await submitIndexNow(host, plan.effective_key, urls); if (rr.result === "accepted" || rr.result === "pending") acc += urls.length; else rej += urls.length; }
            indexedAcc = acc;
            send({ type: "log", kind: "done", msg: `색인 요청 완료 · 빙 수락 ${acc}건 · 거부 ${rej}건 (실제 색인 반영은 빙 확인에서 ✅로 떠요)` });
          } else {
            send({ type: "log", kind: "warn", msg: `색인 키 미설정(색인키 탭에서 지정) — 게시는 완료됨` });
          }
        } catch (e) { send({ type: "log", kind: "warn", msg: `색인 요청 실패: ${(e as any)?.message}` }); }

  // ★2026-09-08 자동발송(스케줄러)일 때만 실행 로그 기록 → 회원/관리자가 "언제 몇 개 자동발송됐는지" 확인.
  //   색인은 이번 실행 발송분(posted)만큼만 기록(indexedAcc는 밀린 백로그 전체라 "색인 132" 오해 유발 → min으로 이번분만).
  if (triggerType === "auto") {
    const runIndexed = Math.min(indexedAcc, posted);
    try { await sb.rpc("backlink_scheduler_log_run", { p_token: adminToken, p_order_id: orderId, p_posted: posted, p_indexed: runIndexed }); } catch { /* 로그 실패는 무시 */ }
  }
  return posted;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  const url = new URL(req.url);
  const mode = url.searchParams.get("mode") || "";
  const adminToken = url.searchParams.get("adminToken") || "";
  const orderId = url.searchParams.get("orderId") || "";
  const targetDomain = (url.searchParams.get("targetDomain") || "").trim();
  const count = Math.max(1, Math.min(50, Number(url.searchParams.get("count")) || 1));
  const kwOverride = (url.searchParams.get("keyword") || "").trim();
  const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  const enc = new TextEncoder();

  // ── 🕒 스케줄러 모드(pg_cron이 호출): 활성 order 전부 순회, 각자 오늘 남은 한도만큼 게시. JSON 응답. ──
  if (mode === "scheduler") {
    const schedSecret = url.searchParams.get("secret") || "";
    if (schedSecret !== "456789") return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401, headers: { ...CORS, "Content-Type": "application/json" } });
    const noop = () => {};   // 스케줄러는 로그 스트림 없음(DB에 기록됨)
    // ★2026-09-07 근본수정: 봇 기록 RPC(record_post·posted_sources·indexnow_plan·ai_config·get_config)는 admin
    //   '세션토큰'(publy_admin_session_get)을 요구한다. scheduler가 평문 secret(456789)로 호출하면 거부되어
    //   게시돼도 기록이 안 돼 posted:0이 됐다. 여기서 세션토큰을 발급받아 runPublish/봇RPC에 넘긴다.
    //   (대상 조회 admin_backlink_scheduler_targets 만 평문 secret로 인증하게 설계돼 있어 그대로 schedSecret 사용)
    let adminToken = schedSecret;
    try { const { data: tok } = await sb.rpc("publy_admin_login", { p_password: schedSecret }); if (tok) adminToken = String(tok); } catch { /* 실패 시 평문 폴백 */ }
    const results: any[] = [];
    try {
      const { data: orders } = await sb.rpc("admin_backlink_scheduler_targets", { p_token: schedSecret });
      // ★2026-09-08 틱당 소량(BATCH)으로 나눠 발송 — ①Edge 150초 타임아웃 회피(끝의 실행로그 기록까지 도달) ②구글 footprint 안전(1차 하루 2~5개 권장).
      //   6시간마다 4틱 → 하루 최대 BATCH×4개. 하루 한도가 더 작으면 remain으로 자름.
      const SCHED_BATCH = 5;
      for (const o of (orders || [])) {
        const remain = Number(o.remain_today ?? 0);
        if (remain <= 0) { results.push({ order: o.id, skipped: "오늘 한도 소진/완료" }); continue; }
        try {
          const posted = await runPublish(sb, noop, adminToken, o.id, o.target_domain, Math.min(remain, SCHED_BATCH), o.keyword || "", "auto");
          results.push({ order: o.id, domain: o.target_domain, posted });
        } catch (e) { results.push({ order: o.id, error: (e as any)?.message || String(e) }); }
      }
      return new Response(JSON.stringify({ ok: true, ran: results.length, results }), { headers: { ...CORS, "Content-Type": "application/json" } });
    } catch (e) {
      return new Response(JSON.stringify({ error: (e as any)?.message || String(e) }), { status: 500, headers: { ...CORS, "Content-Type": "application/json" } });
    }
  }

  // ── 🔍 발굴 모드(무인증 API형만, 웹/폰 가능): 후보 API에 실제 POST 테스트 → 무료 확정만. 계정형(가입폼)은 봇 필요. ──
  if (mode === "discover") {
    const dscSecret = url.searchParams.get("secret") || "";
    const stream3 = new ReadableStream({
      async start(controller) {
        const send = (obj: any) => controller.enqueue(enc.encode(`data: ${JSON.stringify(obj)}\n\n`));
        if (dscSecret !== "456789") { send({ type: "error", msg: "unauthorized" }); controller.close(); return; }
        // 무인증 API 후보(브라우저 불필요) — 실제 게시 테스트
        const cands: { domain: string; run: () => Promise<{ ok: boolean; url?: string; note: string }> }[] = [
          { domain: "pastebin.pl", run: async () => { try { const r = await fetch("https://pastebin.pl/api", { method: "POST", headers: { "Content-Type": "text/plain" }, body: "테스트 https://example.com" }); const t = (await r.text()).trim(); const u = t.match(/https?:\/\/[^\s"']+/)?.[0] || ""; return (r.ok && u) ? { ok: true, url: u, note: `HTTP ${r.status}` } : { ok: false, note: `HTTP ${r.status}` }; } catch (e) { return { ok: false, note: String((e as any)?.message || e) }; } } },
          { domain: "0paste.com", run: async () => { try { const r = await fetch("https://0paste.com/pastes", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ "paste[body]": "테스트 https://example.com", "paste[language]": "text" }).toString(), redirect: "follow" }); const u = r.url; return (r.ok && u && u !== "https://0paste.com/pastes") ? { ok: true, url: u, note: `HTTP ${r.status}` } : { ok: false, note: `HTTP ${r.status}` }; } catch (e) { return { ok: false, note: String((e as any)?.message || e) }; } } },
          { domain: "textbin.net", run: async () => { try { const r = await fetch("https://textbin.net/save", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ code: "테스트 https://example.com", lang: "text" }).toString(), redirect: "follow" }); const u = r.url; return (r.ok && u && u.includes("textbin")) ? { ok: true, url: u, note: `HTTP ${r.status}` } : { ok: false, note: `HTTP ${r.status}` }; } catch (e) { return { ok: false, note: String((e as any)?.message || e) }; } } },
          { domain: "dpaste.org", run: async () => { try { const r = await fetch("https://dpaste.org/api/", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ content: "테스트 https://example.com", lexer: "text", format: "url" }).toString() }); const t = (await r.text()).trim(); const u = t.match(/https?:\/\/[^\s"']+/)?.[0] || ""; return (r.ok && u) ? { ok: true, url: u, note: `HTTP ${r.status}` } : { ok: false, note: `HTTP ${r.status}` }; } catch (e) { return { ok: false, note: String((e as any)?.message || e) }; } } },
          { domain: "paste.mozilla.org", run: async () => ({ ok: false, note: "가입/토큰 필요" }) },
        ];
        send({ type: "log", kind: "wait", msg: `🔍 발굴(서버) 시작 — 무인증 API 후보 ${cands.length}개 실제 게시 테스트 (계정형은 PC 봇에서)` });
        let free = 0, dead = 0;
        for (const c of cands) {
          const r = await c.run();
          const verdict = r.ok ? "free" : "dead";
          try { await sb.rpc("backlink_discovery_record", { p_token: dscSecret, p_domain: c.domain, p_kind: "api", p_verdict: verdict, p_test_url: r.url || "", p_note: r.note }); } catch { /* skip */ }
          if (r.ok) { free++; send({ type: "log", kind: "post", msg: `✅ [무료] ${c.domain} — 실제 게시됨! ${r.url}` }); }
          else { dead++; send({ type: "log", kind: "skip", msg: `⊝ [제외] ${c.domain} — 안 되는 후보라 그냥 버립니다(우리 시스템엔 영향 없음 · ${r.note})` }); }
        }
        send({ type: "log", kind: "done", msg: `🎉 발굴 완료 — 무료 ${free}개 발견 (계정형·캡차형은 🖥️PC 방식으로 더 찾을 수 있어요)` });
        send({ type: "done", free, captcha: 0, paid: 0, dead });
        controller.close();
      },
    });
    return new Response(stream3, { headers: { ...CORS, "Content-Type": "text/event-stream", "Cache-Control": "no-cache", "Connection": "keep-alive" } });
  }

  // ── ⚙️ 어댑터 생성 모드(웹/폰 가능): 수량만큼 생성 → 분류·등급 → backlink_sources 배치. SSE 에너지바. ──
  if (mode === "generate") {
    const genSecret = url.searchParams.get("secret") || "";
    const genCount = Math.max(1, Math.min(500, Number(url.searchParams.get("count")) || 10));
    const stream2 = new ReadableStream({
      async start(controller) {
        const send = (obj: any) => controller.enqueue(enc.encode(`data: ${JSON.stringify(obj)}\n\n`));
        if (genSecret !== "456789") { send({ type: "error", msg: "unauthorized" }); controller.close(); return; }
        const runId = crypto.randomUUID();
        let gistToken = "";
        gistToken = await getConfig(sb, genSecret, "github_gist_token");
        send({ type: "log", kind: "wait", msg: `⚙️ 어댑터 생성 시작 — ${genCount}개 (우리소유·API 섞어 도배 방지)` });
        let ok = 0, fail = 0, owned = 0, api = 0;
        for (let i = 0; i < genCount; i++) {
          const g = await genOne(i % 5, gistToken);
          try { await sb.rpc("backlink_gen_record", { p_token: genSecret, p_run_id: runId, p_domain: g.domain, p_scale: g.scale, p_grade: g.grade, p_detail_url: g.detailUrl || "", p_ok: g.ok, p_note: g.note }); } catch { /* 저장실패 무시 */ }
          if (g.ok) { ok++; if (g.scale === "owned") owned++; else api++; send({ type: "log", kind: "post", msg: `✅ [${g.grade}급·${g.scale === "owned" ? "우리소유" : "API"}] ${g.domain} 생성 (${ok}/${genCount})` }); }
          else { fail++; send({ type: "log", kind: "warn", msg: `✖ ${g.domain} 실패 — ${g.note}` }); }
          send({ type: "progress", done: i + 1, total: genCount, ok, fail });
          await new Promise(r => setTimeout(r, 250));
        }
        send({ type: "log", kind: "done", msg: `🎉 생성 완료 — 성공 ${ok} · 실패 ${fail} (우리소유 ${owned} · API ${api})` });
        send({ type: "done", ok, fail, owned, api, runId });
        controller.close();
      },
    });
    return new Response(stream2, { headers: { ...CORS, "Content-Type": "text/event-stream", "Cache-Control": "no-cache", "Connection": "keep-alive" } });
  }

  // ── 🔎 빙 색인 확인 모드(무료·폰가능): 게시된 백링크가 빙에 실제 색인됐는지 확인 → status '색인' 승격 + 시각 기록 ──
  //   확인 성공분은 감사·대시보드에서 '색인반영'으로 뜨고, 회원은 URL 없이 '색인 반영 N건'만 본다.
  if (mode === "verify") {
    const vSecret = url.searchParams.get("secret") || "";
    const vLimit = Math.max(1, Math.min(200, Number(url.searchParams.get("limit")) || 40));
    const stream4 = new ReadableStream({
      async start(controller) {
        const send = (obj: any) => controller.enqueue(enc.encode(`data: ${JSON.stringify(obj)}\n\n`));
        if (vSecret !== "456789") { send({ type: "error", msg: "unauthorized" }); controller.close(); return; }
        try {
          const { data: q } = await sb.rpc("backlink_index_check_queue", { p_secret: vSecret, p_limit: vLimit });
          const rows: Array<{ id: string; post_url: string }> = q || [];
          send({ type: "log", kind: "wait", msg: `🔎 빙 색인 확인 시작 — 대상 ${rows.length}건 (게시됐지만 아직 색인확인 안 된 링크)` });
          if (!rows.length) { send({ type: "log", kind: "done", msg: `확인할 신규 링크가 없어요 (모두 확인 완료 상태)` }); send({ type: "done", checked: 0, indexed: 0 }); controller.close(); return; }
          let checked = 0, indexed = 0;
          for (const r of rows) {
            const ok = await isIndexedBing(r.post_url);
            try { await sb.rpc("backlink_index_check_record", { p_secret: vSecret, p_post_id: r.id, p_ok: ok }); } catch { /* 기록 실패 무시 */ }
            checked++; if (ok) indexed++;
            send({ type: "log", kind: ok ? "post" : "skip", msg: ok ? `✅ 빙 색인 확인됨 (${indexed}건째)` : `⊝ 아직 빙 색인 전 — 다음에 다시 확인` });
            send({ type: "progress", done: checked, total: rows.length, ok: indexed, fail: checked - indexed });
            await new Promise(r => setTimeout(r, 400));   // 빙 과속 차단
          }
          send({ type: "log", kind: "done", msg: `🎉 빙 색인 확인 완료 — ${checked}건 확인 · ${indexed}건 색인 반영됨` });
          send({ type: "done", checked, indexed });
        } catch (e) { send({ type: "error", msg: (e as any)?.message || String(e) }); }
        controller.close();
      },
    });
    return new Response(stream4, { headers: { ...CORS, "Content-Type": "text/event-stream", "Cache-Control": "no-cache", "Connection": "keep-alive" } });
  }

  // ── SSE 실행 모드(관리자/회원 수동 실행) ──
  const stream = new ReadableStream({
    async start(controller) {
      const send = (obj: any) => controller.enqueue(enc.encode(`data: ${JSON.stringify(obj)}\n\n`));
      try {
        if (!adminToken || !orderId || !targetDomain) { send({ type: "error", msg: "adminToken, orderId, targetDomain 필요" }); controller.close(); return; }
        const posted = await runPublish(sb, send, adminToken, orderId, targetDomain, count, kwOverride, "manual");
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
