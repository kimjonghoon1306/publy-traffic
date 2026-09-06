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

export function listAdapterDomains(): string[] {
  return Object.keys(registry);
}

export * from "./types";
