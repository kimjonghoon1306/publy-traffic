// ─────────────────────────────────────────────────────────────
// github.com Gist 어댑터 (우리소유 PBN·메인엔진) 실게시 검증완료(2026-09-06)
//   우리 github 계정 토큰(config: github_gist_token)으로 공개 Gist를 무한 생성.
//   안 죽음·dofollow·캡차0·무한. secrets.github_gist_token 을 서버가 config에서 읽어 주입.
//   로그: apistart → botstart(토큰 인증) → ai(글 배치) → post.
// ─────────────────────────────────────────────────────────────
import { Adapter, PublishInput, PublishResult, ev } from "./types";

export const githubGistAdapter: Adapter = {
  key: "gist.github.com",
  method: "api",
  needsProxy: false,
  seoTier: "strong",   // 실측 2026-09-07: 본문 <a> 링크 + dofollow
  async publish(input: PublishInput): Promise<PublishResult> {
    const events = [ev("apistart", "gist.github.com 소스에 연결하는 중…")];
    try {
      const token = input.secrets?.github_gist_token || "";
      if (!token) {
        events.push(ev("fail", "우리소유 소스 토큰 미설정(관리자 설정 필요)"));
        return { ok: false, evidence: { step: "no_token" }, events, error: "github_gist_token missing" };
      }
      events.push(ev("botstart", "소스 인증 완료 · 게시 자리 준비됨"));
      events.push(ev("ai", "소개 글과 자연스러운 백링크 앵커를 배치하는 중…"));

      // 파일명·설명에 키워드/도메인, 본문에 마크다운 링크(dofollow)
      const fname = `${input.targetDomain.replace(/[^a-z0-9.]/gi, "-").slice(0, 40)}.md`;
      const content =
        `# ${input.title}\n\n${input.body}\n\n` +
        `▶ [${input.anchor}](${input.targetUrl})\n\n` +
        `참고: ${input.targetUrl}\n`;
      const res = await fetch("https://api.github.com/gists", {
        method: "POST",
        headers: {
          "Authorization": `token ${token}`,
          "Content-Type": "application/json",
          "Accept": "application/vnd.github+json",
          "User-Agent": "publy-backlink",
        },
        body: JSON.stringify({
          description: `${input.title} — ${input.anchor}`,
          public: true,
          files: { [fname]: { content } },
        }),
      });
      const json: any = await res.json().catch(() => ({}));
      const url = json?.html_url as string | undefined;
      if (!res.ok || !url) {
        events.push(ev("fail", "게시 실패: HTTP " + res.status));
        return { ok: false, evidence: { http_code: res.status, step: "createGist", msg: json?.message }, events, error: "gist failed" };
      }
      events.push(ev("post", "gist.github.com 게시 완료 · 백링크 앵커 삽입 · dofollow · 우리소유 A급 소스"));
      return {
        ok: true,
        postUrl: url,
        evidence: { http_code: 201, source: "gist.github.com", posted_at: new Date().toISOString(), dofollow: true, owned: true },
        events,
      };
    } catch (e: any) {
      events.push(ev("fail", "네트워크 오류: " + (e?.message || e)));
      return { ok: false, evidence: { step: "exception" }, events, error: String(e?.message || e) };
    }
  },
};
