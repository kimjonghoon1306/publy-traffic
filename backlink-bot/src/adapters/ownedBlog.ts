// ─────────────────────────────────────────────────────────────
// 우리소유 블로그 어댑터 (tarryguide·tarryblog 등, 2026-09-07)
//   우리가 소유한 블로그 도메인에 POST {api_url} + X-API-Key 로 글 발행.
//   키 불필요(전화인증X)·통제100%·dofollow·AI글. 1차(Tier1) 소스.
//   도메인이 여러 개라 makeOwnedBlogAdapter(domain, apiUrl)로 도메인마다 어댑터 생성.
//   API 키는 서버가 config/env(owned_blog_api_key)에서 읽어 secrets.owned_blog_api_key 로 주입.
//   응답: tarryguide/tarryblog는 {url|link} 또는 slug 반환 → post 주소 구성.
// ─────────────────────────────────────────────────────────────
import { Adapter, PublishInput, PublishResult, ev } from "./types";

export function makeOwnedBlogAdapter(domain: string, apiUrl: string): Adapter {
  return {
    key: domain,
    method: "api",
    needsProxy: false,
    seoTier: "strong",   // 우리소유 = 본문 dofollow 링크, 1차 진짜 힘
    async publish(input: PublishInput): Promise<PublishResult> {
      const events = [ev("apistart", `${domain} 소스에 연결하는 중…`)];
      try {
        const apiKey = input.secrets?.owned_blog_api_key || "";
        if (!apiKey) {
          events.push(ev("fail", "우리소유 블로그 발행 키 미설정(관리자 설정 필요)"));
          return { ok: false, evidence: { step: "no_key" }, events, error: "owned_blog_api_key missing" };
        }
        events.push(ev("botstart", "소스 인증 완료 · 게시 자리 준비됨"));
        events.push(ev("ai", "소개 글과 자연스러운 백링크 앵커를 배치하는 중…"));

        // 본문: AI 글 + dofollow 앵커 링크(회원 도메인). HTML(사이트가 HTML 본문 받음).
        const htmlBody =
          `<p>${escapeHtml(input.body)}</p>` +
          `<p>▶ <a href="${input.targetUrl}" rel="dofollow">${escapeHtml(input.anchor)}</a></p>` +
          `<p>참고: <a href="${input.targetUrl}">${escapeHtml(input.targetUrl)}</a></p>`;

        const res = await fetch(apiUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json", "X-API-Key": apiKey },
          body: JSON.stringify({
            title: input.title,
            content: htmlBody,
            category: "정보",
            status: "published",
          }),
        });
        const json: any = await res.json().catch(() => ({}));
        // 응답에서 글 주소 뽑기: url|link 우선, 없으면 slug/id로 구성
        const slug = json?.slug || json?.id || "";
        const url: string | undefined =
          json?.url || json?.link ||
          (slug ? `https://${domain}/posts/${slug}` : undefined);
        if (!res.ok || !url) {
          events.push(ev("fail", "게시 실패: HTTP " + res.status));
          return { ok: false, evidence: { http_code: res.status, step: "post", msg: json?.error || json?.message }, events, error: "owned blog failed" };
        }
        events.push(ev("post", `${domain} 게시 완료 · 백링크 앵커 삽입 · dofollow · 우리소유 A급 소스`));
        return {
          ok: true,
          postUrl: url,
          evidence: { http_code: res.status, source: domain, posted_at: new Date().toISOString(), dofollow: true, owned: true },
          events,
        };
      } catch (e: any) {
        events.push(ev("fail", "네트워크 오류: " + (e?.message || e)));
        return { ok: false, evidence: { step: "exception" }, events, error: String(e?.message || e) };
      }
    },
  };
}

function escapeHtml(s: string): string {
  return (s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
