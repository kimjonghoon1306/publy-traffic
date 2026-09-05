// ─────────────────────────────────────────────────────────────
// telegra.ph 어댑터 (API형, 무인증) — 실게시 검증 완료(2026-09-05)
//   계정생성 → 페이지생성(본문에 백링크 앵커) → 실제 URL 반환.
//   로그: apistart(API 시작) → post(게시 성공). 프록시 불필요(API형).
// ─────────────────────────────────────────────────────────────
import { Adapter, PublishInput, PublishResult, ev } from "./types";

const API = "https://api.telegra.ph";

async function form(url: string, params: Record<string, string>): Promise<any> {
  const body = new URLSearchParams(params).toString();
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  return { status: res.status, json: await res.json().catch(() => ({})) };
}

export const telegraphAdapter: Adapter = {
  key: "telegra.ph",
  method: "api",
  needsProxy: false,
  async publish(input: PublishInput): Promise<PublishResult> {
    const events = [ev("apistart", "telegra.ph 소스에 연결하는 중…")];
    try {
      // 1) 계정 생성 (author_url = 백링크 대상)
      const acc = await form(`${API}/createAccount`, {
        short_name: input.targetDomain.slice(0, 30),
        author_name: input.title.slice(0, 40),
        author_url: input.targetUrl,
      });
      if (!acc.json?.ok) {
        events.push(ev("fail", "계정 생성 실패"));
        return { ok: false, evidence: { http_code: acc.status, step: "createAccount" }, events, error: "createAccount failed" };
      }
      const token = acc.json.result.access_token;
      events.push(ev("botstart", "소스 인증 완료 · 게시 자리 준비됨"));
      events.push(ev("ai", "소개 글과 자연스러운 백링크 앵커를 배치하는 중…"));

      // 2) 페이지 생성 (본문 + 백링크 앵커)
      const content = [
        { tag: "p", children: [input.body] },
        { tag: "p", children: ["▶ ", { tag: "a", attrs: { href: input.targetUrl }, children: [input.anchor] }] },
      ];
      const page = await form(`${API}/createPage`, {
        access_token: token,
        title: input.title.slice(0, 200),
        author_name: input.title.slice(0, 40),
        author_url: input.targetUrl,
        content: JSON.stringify(content),
        return_content: "false",
      });
      if (!page.json?.ok) {
        events.push(ev("fail", "페이지 게시 실패"));
        return { ok: false, evidence: { http_code: page.status, step: "createPage" }, events, error: "createPage failed" };
      }
      const url = page.json.result.url as string;
      events.push(ev("post", "telegra.ph 게시 완료 · 백링크 앵커 삽입 · 응답 200 · A급 소스"));
      return {
        ok: true,
        postUrl: url,
        evidence: { http_code: 200, source: "telegra.ph", posted_at: new Date().toISOString(), views: page.json.result.views ?? 0 },
        events,
      };
    } catch (e: any) {
      events.push(ev("fail", "네트워크 오류: " + (e?.message || e)));
      return { ok: false, evidence: { step: "exception" }, events, error: String(e?.message || e) };
    }
  },
};
