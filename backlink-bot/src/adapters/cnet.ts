// ─────────────────────────────────────────────────────────────
// paste.c-net.org 어댑터 (API형, 무인증) — 실게시 검증 완료(2026-09-06)
//   POST / (본문 raw) → 200 + 응답에 실제 URL(https://paste.c-net.org/XXXX). 계정 불필요.
//   로그: apistart → botstart → ai → post. 프록시 불필요(API형).
// ─────────────────────────────────────────────────────────────
import { Adapter, PublishInput, PublishResult, ev } from "./types";

export const cnetAdapter: Adapter = {
  key: "paste.c-net.org",
  method: "api",
  needsProxy: false,
  seoTier: "weak",   // registry 미등록(Blacklisted). 타입 충족용.
  async publish(input: PublishInput): Promise<PublishResult> {
    const events = [ev("apistart", "paste.c-net.org 소스에 연결하는 중…")];
    try {
      events.push(ev("botstart", "게시 자리 준비됨"));
      events.push(ev("ai", "소개 글과 백링크 앵커를 배치하는 중…"));
      const content = `${input.title}\n\n${input.body}\n\n▶ ${input.anchor}: ${input.targetUrl}`;
      const res = await fetch("https://paste.c-net.org/", {
        method: "POST",
        headers: { "Content-Type": "text/plain", "User-Agent": "Mozilla/5.0" },
        body: content,
      });
      const text = (await res.text()).trim();
      const url = text.startsWith("http") ? text.split(/\s/)[0] : "";
      if (!res.ok || !url) {
        events.push(ev("fail", "게시 실패: HTTP " + res.status));
        return { ok: false, evidence: { http_code: res.status, step: "post" }, events, error: "c-net failed" };
      }
      events.push(ev("post", "paste.c-net.org 게시 완료 · 백링크 앵커 삽입 · 응답 200 · B급 소스"));
      return { ok: true, postUrl: url, evidence: { http_code: 200, source: "paste.c-net.org", posted_at: new Date().toISOString() }, events };
    } catch (e: any) {
      events.push(ev("fail", "네트워크 오류: " + (e?.message || e)));
      return { ok: false, evidence: { step: "exception" }, events, error: String(e?.message || e) };
    }
  },
};
