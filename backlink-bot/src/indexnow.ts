// ─────────────────────────────────────────────────────────────
// IndexNow 색인 푸시 — 빙·네이버·얀덱스 동시 색인요청(무료·즉시)
//   · 표준 엔드포인트 api.indexnow.org 하나로 참여 검색엔진 전체에 전파.
//   · 키 검증: 제출 URL 호스트 루트에 {key}.txt 파일이 있어야 함
//     → 우리 소유 소스(github pages·vercel·netlify)엔 관리자 공용키 파일을 올려둠,
//        회원 도메인엔 회원이 본인키 파일을 올림.
//   · 로그는 신뢰지표만(주소 노출 금지): index(요청)→done(반영)/warn(거부).
// ─────────────────────────────────────────────────────────────
const INDEXNOW_ENDPOINT = "https://api.indexnow.org/indexnow";
export const INDEXNOW_ENGINES = "빙·네이버·얀덱스";

function hostOf(url: string): string | null {
  try { return new URL(url).host; } catch { return null; }
}

export type PushResult = { result: "accepted" | "pending" | "rejected" | "error"; status: number };

// 한 호스트의 URL 묶음을 IndexNow로 제출
export async function submitIndexNow(host: string, key: string, urls: string[]): Promise<PushResult> {
  if (!key || urls.length === 0) return { result: "error", status: 0 };
  const body = {
    host,
    key,
    keyLocation: `https://${host}/${key}.txt`,
    urlList: urls.slice(0, 10000), // IndexNow 1회 최대 10,000
  };
  try {
    const res = await fetch(INDEXNOW_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json; charset=utf-8" },
      body: JSON.stringify(body),
    });
    // 200=수락 / 202=수락(검증대기) / 403=키무효 / 422=호스트불일치 / 429=과다
    if (res.status === 200) return { result: "accepted", status: 200 };
    if (res.status === 202) return { result: "pending", status: 202 };
    if (res.status === 403 || res.status === 422) return { result: "rejected", status: res.status };
    return { result: "error", status: res.status };
  } catch {
    return { result: "error", status: 0 };
  }
}

// URL 목록을 호스트별로 그룹핑(호스트마다 별도 제출)
export function groupByHost(urls: string[]): Map<string, string[]> {
  const m = new Map<string, string[]>();
  for (const u of urls) {
    const h = hostOf(u);
    if (!h) continue;
    if (!m.has(h)) m.set(h, []);
    m.get(h)!.push(u);
  }
  return m;
}
