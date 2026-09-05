// ─────────────────────────────────────────────────────────────
// 색인 확인 — 빙 site: 검색으로 게시물 URL이 실제 색인됐는지 확인.
// 구글은 캡차로 막지만 빙은 스크래핑 관대(실측 확인). 가짜 아님 — 진짜 검색 결과 기반.
// ─────────────────────────────────────────────────────────────

// URL을 빙 site: 검색으로 색인 여부 확인 → true=색인됨
export async function isIndexedBing(postUrl: string): Promise<boolean> {
  try {
    // site:도메인/경로 로 정확 조회. URL에서 https:// 제거.
    const clean = postUrl.replace(/^https?:\/\//, "");
    const q = encodeURIComponent(`site:${clean}`);
    const res = await fetch(`https://www.bing.com/search?q=${q}&setlang=ko`, {
      headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" },
    });
    const html = await res.text();
    if (/There are no results|검색 결과가 없습니다|결과 없음/.test(html)) return false;
    // 🔑 검색창 에코(쿼리 문자열)를 피하려면 실제 결과 블록(b_algo) 내부만 검사한다.
    const algoBlocks = html.match(/class="b_algo"[\s\S]*?(?=class="b_algo"|<\/ol>|id="b_context")/g) || [];
    if (!algoBlocks.length) return false;
    const joined = algoBlocks.join(" ");
    const pathPart = (clean.replace(/\/$/, "").split("/").slice(1).join("/")).trim();
    // 도메인 루트(경로 없음)면 결과 블록에 도메인이 있으면 색인.
    const domain = clean.split("/")[0];
    if (!pathPart) return joined.includes(domain);
    // 경로가 있으면 그 슬러그가 결과 링크에 실제 나타나야 색인(한글=인코딩/디코딩 모두 확인).
    let dec = pathPart; try { dec = decodeURIComponent(pathPart); } catch {}
    const enc = encodeURIComponent(pathPart);
    return joined.includes(pathPart) || joined.includes(enc) || joined.includes(dec);
  } catch {
    return false;
  }
}
