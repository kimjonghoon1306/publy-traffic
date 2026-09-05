// ─────────────────────────────────────────────────────────────
// 어댑터 레지스트리 — 소스 도메인 → 어댑터 매핑
// 실게시 검증된 것만 등록(2026-09-05: telegra.ph·rentry.co / 2026-09-06: dpaste.com·paste.rs). 나머지는 검증 후 추가.
// ─────────────────────────────────────────────────────────────
import { Adapter } from "./types";
import { telegraphAdapter } from "./telegraph";
import { rentryAdapter } from "./rentry";
import { dpasteAdapter } from "./dpaste";
import { pastersAdapter } from "./pasters";

const registry: Record<string, Adapter> = {
  "telegra.ph": telegraphAdapter,
  "rentry.co": rentryAdapter,
  "dpaste.com": dpasteAdapter,
  "paste.rs": pastersAdapter,
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
