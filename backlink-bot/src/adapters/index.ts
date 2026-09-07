// ─────────────────────────────────────────────────────────────
// 어댑터 레지스트리 — 소스 도메인 → 어댑터 매핑
// 실게시 검증된 것만 등록(2026-09-05: telegra.ph·rentry.co / 2026-09-06: dpaste.com·paste.rs). 나머지는 검증 후 추가.
// ─────────────────────────────────────────────────────────────
import { Adapter } from "./types";
import { telegraphAdapter } from "./telegraph";
import { rentryAdapter } from "./rentry";
import { dpasteAdapter } from "./dpaste";
import { pastersAdapter } from "./pasters";
import { graphorgAdapter } from "./graphorg";
import { githubGistAdapter } from "./githubgist";
// ⚠️ paste.c-net.org 제거(2026-09-06): 반복 게시로 Blacklisted 차단됨 → 가짜성공 방지 위해 registry에서 뺌.

const registry: Record<string, Adapter> = {
  "telegra.ph": telegraphAdapter,
  "rentry.co": rentryAdapter,
  "dpaste.com": dpasteAdapter,
  "paste.rs": pastersAdapter,
  "graph.org": graphorgAdapter,
  "gist.github.com": githubGistAdapter,
};

export function getAdapter(domain: string): Adapter | null {
  return registry[domain] || null;
}

export function hasAdapter(domain: string): boolean {
  return domain in registry;
}

// ★2026-09-07 상위노출 우선: strong(dofollow+본문링크) 소스를 먼저 소진하고 weak를 뒤에.
//   회원 하루 한도가 적으면 strong만으로 채워져 순위 효과가 실제로 나게 한다(개수보다 질).
export function listAdapterDomains(): string[] {
  const keys = Object.keys(registry);
  return keys.sort((a, b) => {
    const ta = registry[a].seoTier === "strong" ? 0 : 1;
    const tb = registry[b].seoTier === "strong" ? 0 : 1;
    return ta - tb;
  });
}

// 상위노출용(strong)만 — 스케줄러/우선 게시에서 사용
export function listStrongAdapterDomains(): string[] {
  return Object.keys(registry).filter((k) => registry[k].seoTier === "strong");
}

export * from "./types";
