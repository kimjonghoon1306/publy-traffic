type StoreTarget = { storeId?: string; productId?: string; storeUrl: string };

// 검색 링크와 도착 URL 모두 같은 host/path 경계로 확인한다. 홈도 유효한 진입이다.
export function isStoreLanding(href: string, target: StoreTarget): boolean {
  try {
    const url = new URL(href);
    if (!/^https?:$/.test(url.protocol) || !/^(m\.)?smartstore\.naver\.com$/.test(url.hostname)) return false;
    const parts = url.pathname.split("/").filter(Boolean);
    const sid = target.storeId || new URL(target.storeUrl).pathname.split("/").filter(Boolean)[0];
    if (sid) return parts[0] === sid && (parts.length === 1 || !target.productId || (parts[1] === "products" && parts[2] === target.productId));
    return !!target.productId && parts[1] === "products" && parts[2] === target.productId;
  } catch { return false; }
}

export function extractStoreUrl(href: string, target: StoreTarget): string | null {
  // 기존 decodeURIComponent 방식 재사용. 중첩 인코딩 광고·로그인 링크도 클릭 전에 제외.
  let decoded = href;
  for (let i = 0; i < 4; i++) {
    try { const next = decodeURIComponent(decoded); if (next === decoded) break; decoded = next; } catch { break; }
  }
  if (/nid\.naver\.com|nidlogin|nl-ts-pid/i.test(decoded)) return null;
  const visit = (value: string, depth: number): string | null => {
    if (depth > 4) return null;
    if (isStoreLanding(value, target)) return value;
    try {
      const url = new URL(value);
      if (!/^https?:$/.test(url.protocol)) return null;
      if (!(url.hostname === "inflow.pay.naver.com" && url.pathname === "/rd") &&
          !/^(cr|msearch)\.shopping\.naver\.com$/.test(url.hostname)) return null;
      for (const key of ["retUrl", "url", "u"]) {
        let nested = url.searchParams.get(key);
        if (!nested) continue;
        for (let i = 0; i < 4; i++) {
          const cleanUrl = visit(nested, depth + 1);
          if (cleanUrl) return cleanUrl;
          try { const next = decodeURIComponent(nested); if (next === nested) break; nested = next; } catch { break; }
        }
      }
    } catch { /* 잘못된 href는 제외 */ }
    return null;
  };
  return visit(href, 0);
}

export function isStoreResult(href: string, target: StoreTarget): boolean {
  return extractStoreUrl(href, target) !== null;
}
