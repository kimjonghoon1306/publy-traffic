// ─────────────────────────────────────────────────────────────
// rentry.co 어댑터 (API형, 무인증) — 실게시 검증 완료(2026-09-05)
//   GET로 csrftoken 쿠키 → POST /api/new(text) → 실제 URL + edit_code(수정/삭제용).
//   로그: apistart → post. 프록시 불필요(API형).
// ─────────────────────────────────────────────────────────────
import { Adapter, PublishInput, PublishResult, ev } from "./types";

function parseCookie(setCookie: string | null, name: string): string {
  if (!setCookie) return "";
  const m = new RegExp(name + "=([^;]+)").exec(setCookie);
  return m ? m[1] : "";
}

export const rentryAdapter: Adapter = {
  key: "rentry.co",
  method: "api",
  needsProxy: false,
  async publish(input: PublishInput): Promise<PublishResult> {
    const events = [ev("apistart", "rentry.co 소스에 연결하는 중…")];
    try {
      // 1) csrftoken 쿠키 획득
      const home = await fetch("https://rentry.co/", { headers: { "User-Agent": "Mozilla/5.0" } });
      const csrf = parseCookie(home.headers.get("set-cookie"), "csrftoken");
      if (!csrf) {
        events.push(ev("fail", "CSRF 토큰 획득 실패"));
        return { ok: false, evidence: { step: "csrf" }, events, error: "no csrf" };
      }
      events.push(ev("botstart", "소스 인증 완료 · 게시 자리 준비됨"));
      events.push(ev("ai", "소개 글과 자연스러운 백링크 앵커를 배치하는 중…"));
      // 2) 페이지 생성 (본문에 백링크)
      const text = `${input.title}\n\n${input.body}\n\n▶ ${input.anchor}: ${input.targetUrl}`;
      const body = new URLSearchParams({ csrfmiddlewaretoken: csrf, text }).toString();
      const res = await fetch("https://rentry.co/api/new", {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "Referer": "https://rentry.co",
          "Cookie": `csrftoken=${csrf}`,
          "User-Agent": "Mozilla/5.0",
        },
        body,
      });
      const json: any = await res.json().catch(() => ({}));
      if (json?.status !== "200" || !json?.url) {
        events.push(ev("fail", "게시 실패: " + (json?.content || res.status)));
        return { ok: false, evidence: { http_code: res.status, step: "new" }, events, error: json?.content || "failed" };
      }
      events.push(ev("post", "rentry.co 게시 완료 · 백링크 앵커 삽입 · 응답 200 · A급 소스"));
      return {
        ok: true,
        postUrl: json.url,
        evidence: { http_code: 200, source: "rentry.co", posted_at: new Date().toISOString(), edit_code: json.edit_code },
        events,
      };
    } catch (e: any) {
      events.push(ev("fail", "네트워크 오류: " + (e?.message || e)));
      return { ok: false, evidence: { step: "exception" }, events, error: String(e?.message || e) };
    }
  },
};
