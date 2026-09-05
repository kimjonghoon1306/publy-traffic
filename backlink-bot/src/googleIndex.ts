// ─────────────────────────────────────────────────────────────
// 색인 확인 — 구글 Custom Search API (테리 확정 2026-09-05)
//   · 빙 검색 API 종료(2025.8)·빙 스크래핑은 site: 무시로 신뢰불가 → 구글 Custom Search로 확정.
//   · 무료 하루 100건. 키/cx 는 관리자 공용(backlink_config: google_api_key·google_cx).
//   · 회원에겐 키/색인/API 용어 노출 금지 → 이 확인은 100% 관리자·시스템 뒤에서.
//   확인가능: ①색인여부(site:URL 검색결과 있으면 색인) ②내도메인 순위(별도).
// ─────────────────────────────────────────────────────────────

export type IndexCheck = { indexed: boolean; ok: boolean; reason?: string };

// site:URL 로 구글 색인 여부 확인. ok=API호출성공, indexed=색인됨.
export async function isIndexedGoogle(postUrl: string, apiKey: string, cx: string): Promise<IndexCheck> {
  if (!apiKey || !cx) return { indexed: false, ok: false, reason: "no_key_or_cx" };
  const clean = postUrl.replace(/^https?:\/\//, "");
  const q = encodeURIComponent(`site:${clean}`);
  const url = `https://www.googleapis.com/customsearch/v1?key=${apiKey}&cx=${cx}&q=${q}&num=1`;
  try {
    const res = await fetch(url);
    if (res.status === 429) return { indexed: false, ok: false, reason: "quota_exceeded" };
    if (!res.ok) return { indexed: false, ok: false, reason: `http_${res.status}` };
    const j: any = await res.json();
    const total = Number(j?.searchInformation?.totalResults || 0);
    const hasItems = Array.isArray(j?.items) && j.items.length > 0;
    return { indexed: total > 0 && hasItems, ok: true };
  } catch (e: any) {
    return { indexed: false, ok: false, reason: e?.message || "fetch_error" };
  }
}

// 내 도메인 순위 확인: 키워드 검색 → 결과 상위 N에서 내 도메인이 몇 위인지(없으면 0).
export async function checkRankGoogle(keyword: string, domain: string, apiKey: string, cx: string, topN = 20): Promise<{ rank: number; ok: boolean; reason?: string }> {
  if (!apiKey || !cx) return { rank: 0, ok: false, reason: "no_key_or_cx" };
  const host = domain.replace(/^https?:\/\//, "").replace(/\/.*$/, "");
  const q = encodeURIComponent(keyword);
  let start = 1, rank = 0;
  try {
    while (start <= topN) {
      const url = `https://www.googleapis.com/customsearch/v1?key=${apiKey}&cx=${cx}&q=${q}&num=10&start=${start}`;
      const res = await fetch(url);
      if (!res.ok) return { rank: 0, ok: false, reason: `http_${res.status}` };
      const j: any = await res.json();
      const items: any[] = j?.items || [];
      for (let i = 0; i < items.length; i++) {
        const link: string = items[i]?.link || "";
        if (link.includes(host)) { rank = start + i; return { rank, ok: true }; }
      }
      if (items.length < 10) break;
      start += 10;
    }
    return { rank: 0, ok: true };
  } catch (e: any) {
    return { rank: 0, ok: false, reason: e?.message || "fetch_error" };
  }
}
