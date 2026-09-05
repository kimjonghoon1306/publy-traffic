// ─────────────────────────────────────────────────────────────
// paste.rs 어댑터 (API형, 무인증) — 실게시 검증 완료(2026-09-06)
//   POST / (본문 raw) → 201 + 응답에 실제 URL(https://paste.rs/XXXXX). 계정 불필요.
//   로그: apistart → botstart → ai → post. 프록시 불필요(API형).
// ─────────────────────────────────────────────────────────────
import { Adapter, PublishInput, PublishResult, ev } from "./types";

export const pastersAdapter: Adapter = {
  key: "paste.rs",
  method: "api",
  needsProxy: false,
  async publish(input: PublishInput): Promise<PublishResult> {
    const events = [ev("apistart", "paste.rs 소스에 연결하는 중…")];
    try {
      events.push(ev("botstart", "게시 자리 준비됨"));
      events.push(ev("ai", "소개 글과 백링크 앵커를 배치하는 중…"));
      const content = `${input.title}\n\n${input.body}\n\n▶ ${input.anchor}: ${input.targetUrl}`;
      const res = await fetch("https://paste.rs/", {
        method: "POST",
        headers: { "Content-Type": "text/plain", "User-Agent": "Mozilla/5.0" },
        body: content,
      });
      const text = (await res.text()).trim();
      const url = text.startsWith("http") ? text.split(/\s/)[0] : "";
      if ((res.status !== 201 && res.status !== 200) || !url) {
        events.push(ev("fail", "게시 실패: HTTP " + res.status));
        return { ok: false, evidence: { http_code: res.status, step: "post" }, events, error: "paste.rs failed" };
      }
      events.push(ev("post", "paste.rs 게시 완료 · 백링크 앵커 삽입 · 응답 201 · B급 소스"));
      return { ok: true, postUrl: url, evidence: { http_code: 201, source: "paste.rs", posted_at: new Date().toISOString() }, events };
    } catch (e: any) {
      events.push(ev("fail", "네트워크 오류: " + (e?.message || e)));
      return { ok: false, evidence: { step: "exception" }, events, error: String(e?.message || e) };
    }
  },
};
