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
import { makeOwnedBlogAdapter } from "./ownedBlog";
// ⚠️ paste.c-net.org 제거(2026-09-06): 반복 게시로 Blacklisted 차단됨 → 가짜성공 방지 위해 registry에서 뺌.

const registry: Record<string, Adapter> = {
  "telegra.ph": telegraphAdapter,
  "rentry.co": rentryAdapter,
  "dpaste.com": dpasteAdapter,
  "paste.rs": pastersAdapter,
  "graph.org": graphorgAdapter,
  "gist.github.com": githubGistAdapter,
};

// ★2026-09-07 우리소유 블로그(tarryguide·tarryblog 등)는 DB(backlink_owned_domains)에서 동적 등록.
//   서버가 backlink_bot_owned_domains RPC로 목록 받아 registerOwnedBlog로 registry에 추가.
const ownedBlogSet = new Set<string>();
export function registerOwnedBlog(domain: string, apiUrl: string): void {
  registry[domain] = makeOwnedBlogAdapter(domain, apiUrl);
  ownedBlogSet.add(domain);
}
// 우리소유 소스 전체(gist + 동적 등록된 우리 블로그).
export function isOwnedSource(domain: string): boolean {
  return domain === "gist.github.com" || ownedBlogSet.has(domain);
}
// 회원 직접발송에서 '제외할' 소스 = gist만(개인 GitHub 토큰 필요).
//   우리 블로그(tarryguide 등)는 서버가 공용키(owned_blog_api_key)를 주입하므로 회원도 사용 OK → 소스 늘어 "0개 게시" 완화.
export function isMemberExcluded(domain: string): boolean {
  return domain === "gist.github.com";
}
export function listOwnedDomains(): string[] {
  return Array.from(ownedBlogSet);
}
// 우리소유 '블로그'(gist 제외). 발행키(owned_blog_api_key) 없으면 게시 불가 → 키 없을 때 소스목록에서 제외.
export function isOwnedBlog(domain: string): boolean {
  return ownedBlogSet.has(domain);
}
// ★2026-09-08 라운드로빈 발송용 소스 목록 빌더 — "소스당 1회" 모델 폐기.
//   백링크 물량 모델(하루 여러개, 같은 소스에 새 URL 반복)에 맞춰 사용 가능한 소스만 strong 먼저 정렬해 돌린다.
//   opts.hasOwnedKey=owned_blog_api_key 보유(없으면 우리블로그 제외).
//   opts.hasGithubKey=이 회원의 GitHub 키(관리자 공용키 or 본인키) 존재 → 있으면 회원 직접발송도 gist 사용(테리: 관리자가 키 넣어주면 일반발행도 됨).
export function buildSourceList(opts: { forMember?: boolean; hasOwnedKey?: boolean; hasGithubKey?: boolean }): string[] {
  return listAdapterDomains().filter((d) => {
    if (opts.forMember && d === "gist.github.com" && !opts.hasGithubKey) return false;  // 회원 gist=GitHub 키 있을 때만
    if (isOwnedBlog(d) && !opts.hasOwnedKey) return false;                              // 우리블로그=발행키 없으면 제외
    return true;
  });
}

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
