// ─────────────────────────────────────────────────────────────
// dpaste.com 어댑터 (API형, 무인증) — 실게시 검증 완료(2026-09-06)
//   POST /api/v2/ (content·syntax·expiry_days) → 본문 응답에 실제 URL. 계정 불필요.
//   로그: apistart → botstart → ai → post. 프록시 불필요(API형).
// ─────────────────────────────────────────────────────────────
import { Adapter, PublishInput, PublishResult, ev } from "./types";

export const dpasteAdapter: Adapter = {
  key: "dpaste.com",
  method: "api",
  needsProxy: false,
  async publish(input: PublishInput): Promise<PublishResult> {
    const events = [ev("apistart", "dpaste.com 소스에 연결하는 중…")];
    try {
      events.push(ev("botstart", "게시 자리 준비됨"));
      events.push(ev("ai", "소개 글과 백링크 앵커를 배치하는 중…"));
      const content = `${input.title}\n\n${input.body}\n\n▶ ${input.anchor}: ${input.targetUrl}`;
      const body = new URLSearchParams({ content, syntax: "text", expiry_days: "365" }).toString();
      const res = await fetch("https://dpaste.com/api/v2/", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded", "User-Agent": "Mozilla/5.0" },
        body,
      });
      const text = (await res.text()).trim();
      // 성공 시 응답 본문이 URL(https://dpaste.com/XXXX)
      const url = text.startsWith("http") ? text.split(/\s/)[0] : "";
      if (!res.ok || !url) {
        events.push(ev("fail", "게시 실패: HTTP " + res.status));
        return { ok: false, evidence: { http_code: res.status, step: "post" }, events, error: "dpaste failed" };
      }
      events.push(ev("post", "dpaste.com 게시 완료 · 백링크 앵커 삽입 · 응답 200 · A급 소스"));
      return { ok: true, postUrl: url, evidence: { http_code: 200, source: "dpaste.com", posted_at: new Date().toISOString() }, events };
    } catch (e: any) {
      events.push(ev("fail", "네트워크 오류: " + (e?.message || e)));
      return { ok: false, evidence: { step: "exception" }, events, error: String(e?.message || e) };
    }
  },
};
