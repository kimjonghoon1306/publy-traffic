// ─────────────────────────────────────────────────────────────
// 어댑터 자동 생성기 — 클릭+수량 → 실제 생성 → 분류(우리/API/봇) → A/B/C 등급 → 배치.
//  지금 확실히 되는 것 = 우리소유 무한생성(gist·telegra·graph). 수량만큼 실제 페이지/계정 생성.
//  ★우리소유만 쓰면 도배 → 소스를 다양하게(gist·telegra·graph 순환) 섞어 생성.
//  등급 자동: 우리소유 dofollow = A, 무인증 API = B, 그 외 = C.
//  에너지바(진행률)·완료 분류 리포트는 server가 SSE로 전송.
// ─────────────────────────────────────────────────────────────

export type GenItem = { domain: string; scale: "owned" | "api" | "bot"; grade: string; detailUrl?: string; ok: boolean; note: string };

// telegra.ph / graph.org 계정+페이지 무한생성(무인증). B급(남의 사이트지만 안정).
async function makeTelegraphLike(api: string, domain: string): Promise<GenItem> {
  try {
    const acc = await fetch(`${api}/createAccount`, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ short_name: "src", author_name: "src" }).toString() });
    const aj: any = await acc.json().catch(() => ({}));
    if (!aj?.ok) return { domain, scale: "api", grade: "B", ok: false, note: "계정 생성 실패" };
    return { domain, scale: "api", grade: "B", detailUrl: `https://${domain}`, ok: true, note: "계정 발급됨(페이지 무한생성 가능)" };
  } catch (e: any) { return { domain, scale: "api", grade: "B", ok: false, note: `오류: ${e?.message || e}` }; }
}

// github gist — 우리 토큰으로 무한. A급(우리소유·dofollow). 실제 gist 1개 만들어 검증.
async function makeGist(token: string): Promise<GenItem> {
  if (!token) return { domain: "gist.github.com", scale: "owned", grade: "A", ok: false, note: "github 토큰 미설정" };
  try {
    const res = await fetch("https://api.github.com/gists", {
      method: "POST",
      headers: { "Authorization": `token ${token}`, "Content-Type": "application/json", "Accept": "application/vnd.github+json", "User-Agent": "publy-backlink" },
      body: JSON.stringify({ description: "source seed", public: true, files: { [`seed_${Date.now()}.md`]: { content: "# seed\n소스 준비용 페이지입니다." } } }),
    });
    const j: any = await res.json().catch(() => ({}));
    if (!res.ok || !j?.html_url) return { domain: "gist.github.com", scale: "owned", grade: "A", ok: false, note: `HTTP ${res.status}` };
    return { domain: "gist.github.com", scale: "owned", grade: "A", detailUrl: j.html_url, ok: true, note: "우리소유 dofollow 페이지 생성됨" };
  } catch (e: any) { return { domain: "gist.github.com", scale: "owned", grade: "A", ok: false, note: `오류: ${e?.message || e}` }; }
}

// 수량만큼 생성 — 도배 방지 위해 소스를 순환(우리소유40% : API 60% 비율로 섞기).
export async function runGenerate(count: number, gistToken: string, send: (o: any) => void, recordFn: (g: GenItem) => Promise<void>) {
  const n = Math.max(1, Math.min(500, count));
  send({ type: "log", kind: "wait", msg: `⚙️ 어댑터 생성 시작 — ${n}개 (우리소유·API 섞어서 도배 방지)` });
  let ok = 0, fail = 0;
  const owned: GenItem[] = [], apis: GenItem[] = [];

  for (let i = 0; i < n; i++) {
    let g: GenItem;
    // 순환: 5개마다 2개는 우리소유(gist), 3개는 API(telegra/graph 번갈아) → 약 40:60
    const slot = i % 5;
    if (slot < 2) g = await makeGist(gistToken);
    else if (slot % 2 === 0) g = await makeTelegraphLike("https://api.telegra.ph", "telegra.ph");
    else g = await makeTelegraphLike("https://api.graph.org", "graph.org");

    await recordFn(g);
    if (g.ok) { ok++; (g.scale === "owned" ? owned : apis).push(g); send({ type: "log", kind: "post", msg: `✅ [${g.grade}급·${g.scale === "owned" ? "우리소유" : "API"}] ${g.domain} 생성 (${ok}/${n})` }); }
    else { fail++; send({ type: "log", kind: "warn", msg: `✖ ${g.domain} 실패 — ${g.note}` }); }
    // 에너지바 진행률
    send({ type: "progress", done: i + 1, total: n, ok, fail });
    await new Promise(r => setTimeout(r, 300)); // 과속 방지
  }

  send({ type: "log", kind: "done", msg: `🎉 생성 완료 — 성공 ${ok} · 실패 ${fail} (우리소유 ${owned.length} · API ${apis.length})` });
  send({ type: "done", ok, fail, owned: owned.length, api: apis.length });
}
