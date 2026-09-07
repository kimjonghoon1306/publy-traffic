import { useState, useEffect, useCallback, useMemo } from "react";
import { supabase } from "../lib/supabase";

// 🏠 회원 홈(주문·신청) — 로그인 후 첫 화면.
//   프로그램 설명 + 4툴 신청 카드(행동/등급/기간) + 주문하기(submit_tool_request) + 내 신청 상태(my_tool_request).
//   결제는 없음(등급만). 관리자가 "회원 결제요청" 탭에서 승인하면 tool_licenses 자동 발급 → 대시보드 오픈.

type ToolKey = "place" | "blog" | "store" | "backlink";
const TOOLS: { key: ToolKey; label: string; desc: string; actions: [string, string, boolean][] }[] = [
  { key: "place", label: "🗺️ 플레이스", desc: "네이버 지도·플레이스를 검색 유입으로 상위 노출시켜요.", actions: [["dir", "길찾기", false], ["call", "전화", false], ["book", "예약", false], ["talk", "톡톡", false], ["share", "공유", false], ["save", "저장", true], ["review", "리뷰", true]] },
  { key: "blog", label: "📝 블로그", desc: "블로그 글을 검색 유입·공감·이웃으로 노출을 키워요.", actions: [["share", "공유", false], ["funnel", "다른글읽기", false], ["like", "공감", true], ["neighbor", "이웃추가", true]] },
  { key: "store", label: "🛒 스마트스토어", desc: "쇼핑 검색 유입·찜·장바구니로 상품 순위를 올려요.", actions: [["option", "옵션보기", false], ["share", "공유", false], ["wish", "찜", true], ["cart", "장바구니", true]] },
  // ★2026-09-07 테리 지시: 주문하기 화면에서 백링크만 제외(다른 기능·백링크 탭 자체·승인로직은 그대로 유지). TOOLS에서 backlink 카드만 뺌.
];
const PLANS: [string, string][] = [["basic", "베이직"], ["pro", "프로"], ["premium", "프리미엄"], ["unlimited", "무제한"]];
const PERIODS: [number, string][] = [[7, "7일"], [30, "30일"], [90, "90일"], [365, "1년"]];

export default function OrderHome({ token, theme, memberName, approvedFeats, onGoDashboard }: {
  token: string; theme: "dark" | "light"; memberName?: string; approvedFeats: string[]; onGoDashboard: () => void;
}) {
  const dark = theme === "dark";
  const C = useMemo(() => dark
    ? { bg: "#140f22", panel: "#1c1630", panel2: "#241c3d", ink: "#f3effb", sub: "#a99fc4", line: "#2f2748", line2: "#3a3157", accent: "#a78bfa", accent2: "#8b5cf6", glow: "rgba(167,139,250,.14)", soft: "rgba(167,139,250,.10)", good: "#34d399", warn: "#fbbf24", danger: "#f87171" }
    : { bg: "#f7f5fc", panel: "#ffffff", panel2: "#f4f1fb", ink: "#1c1530", sub: "#6b6386", line: "#e7e2f2", line2: "#d9d2ec", accent: "#7c3aed", accent2: "#6d28d9", glow: "rgba(124,58,237,.10)", soft: "rgba(124,58,237,.07)", good: "#059669", warn: "#d97706", danger: "#dc2626" }, [dark]);

  // 신청 상태(툴별)
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [acts, setActs] = useState<Record<string, Set<string>>>({ place: new Set(), blog: new Set(), store: new Set(), backlink: new Set() });
  const [plan, setPlan] = useState<Record<string, string>>({ place: "basic", blog: "basic", store: "basic", backlink: "basic" });
  const [days, setDays] = useState<Record<string, number>>({ place: 30, blog: 30, store: 30, backlink: 30 });
  const [msg, setMsg] = useState("");
  const [sending, setSending] = useState(false);

  // 내 신청 상태
  const [myReq, setMyReq] = useState<{ status: string; payload: any[]; created_at: string } | null>(null);
  const loadMyReq = useCallback(async () => {
    try {
      const { data } = await supabase.rpc("my_tool_request", { p_token: token });
      const r = (data && data[0]) || null;
      setMyReq(r ? { status: r.status, payload: Array.isArray(r.payload) ? r.payload : [], created_at: r.created_at } : null);
    } catch { /* 신청 없음 */ }
  }, [token]);
  useEffect(() => { void loadMyReq(); const iv = window.setInterval(loadMyReq, 5000); return () => window.clearInterval(iv); }, [loadMyReq]);

  const toggleTool = (k: string) => setSelected(s => ({ ...s, [k]: !s[k] }));
  const toggleAct = (tool: string, key: string) => setActs(m => { const n = new Set(m[tool]); n.has(key) ? n.delete(key) : n.add(key); return { ...m, [tool]: n }; });

  const chosen = TOOLS.filter(t => selected[t.key]);
  const submit = useCallback(async () => {
    if (!chosen.length) { setMsg("신청할 기능을 1개 이상 선택하세요"); setTimeout(() => setMsg(""), 3000); return; }
    const payload = chosen.map(t => ({ tool: t.key, actions: Array.from(acts[t.key] || []), plan: plan[t.key] || "basic", days: days[t.key] || 30 }));
    setSending(true);
    const { error } = await supabase.rpc("submit_tool_request", { p_token: token, p_payload: payload });
    setSending(false);
    if (error) { setMsg("주문 실패: " + error.message); return; }
    setMsg("✅ 주문 완료 — 관리자 승인을 기다려 주세요"); setSelected({}); void loadMyReq(); setTimeout(() => setMsg(""), 5000);
  }, [chosen, acts, plan, days, token, loadMyReq]);

  const btn = (bg: string, fg: string, bd?: string): React.CSSProperties => ({ padding: "8px 14px", borderRadius: 9, border: bd ? `1.5px solid ${bd}` : "none", background: bg, color: fg, fontWeight: 800, fontSize: 13, cursor: "pointer", fontFamily: "inherit" });
  const statusPill = (st: string) => st === "approved" ? { t: "승인됨 ✅", c: C.good } : st === "rejected" ? { t: "거절됨", c: C.danger } : { t: "승인 대기 중 ⏳", c: C.warn };

  return (
    <div style={{ fontFamily: "'Pretendard','Apple SD Gothic Neo',sans-serif", color: C.ink, maxWidth: 860, margin: "0 auto" }}>
      {/* 프로그램 설명 */}
      <div style={{ background: `linear-gradient(135deg,${C.glow},transparent)`, border: `1px solid ${C.line2}`, borderRadius: 16, padding: "20px 22px", marginBottom: 16 }}>
        <div style={{ fontSize: 19, fontWeight: 900, marginBottom: 6 }}>{memberName ? `${memberName}님, ` : ""}필요한 기능을 골라 신청하세요</div>
        <div style={{ fontSize: 13, color: C.sub, fontWeight: 600, lineHeight: 1.7 }}>
          퍼블리 트래픽은 <b style={{ color: C.accent }}>플레이스·블로그·스마트스토어</b>를 진짜 손님처럼 검색·방문해 순위를 올리고, <b style={{ color: C.accent }}>백링크</b>로 구글·AI 노출까지 키우는 프로그램이에요.<br />
          아래에서 <b style={{ color: C.ink }}>원하는 기능만 골라</b> 등급·기간을 정해 <b style={{ color: C.ink }}>주문</b>하면, 관리자 승인 후 바로 쓸 수 있어요. (결제 안내는 승인 과정에서 따로 드려요)
        </div>
      </div>

      {/* 이미 승인된 기능이 있으면 대시보드 이동 */}
      {approvedFeats.length > 0 && (
        <button onClick={onGoDashboard} style={{ ...btn(`linear-gradient(135deg,${C.accent},${C.accent2})`, "#fff"), width: "100%", padding: "14px", fontSize: 15, marginBottom: 16, borderRadius: 12 }}>
          ▶ 내 대시보드로 가기 (승인된 기능 {approvedFeats.length}개 사용)
        </button>
      )}

      {/* 내 신청 상태 */}
      {myReq && (
        <div style={{ background: C.panel, border: `1px solid ${C.line2}`, borderRadius: 12, padding: "12px 15px", marginBottom: 16, display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <span style={{ fontSize: 13, fontWeight: 800 }}>내 신청</span>
          <span style={{ fontSize: 12.5, fontWeight: 900, color: statusPill(myReq.status).c }}>{statusPill(myReq.status).t}</span>
          <span style={{ fontSize: 11.5, color: C.sub, fontWeight: 600 }}>
            {myReq.payload.map((p: any) => (TOOLS.find(t => t.key === p.tool)?.label || p.tool)).join(" · ")}
          </span>
        </div>
      )}

      {/* 툴 신청 카드 */}
      {TOOLS.map(t => {
        const on = !!selected[t.key];
        const free = t.actions.filter(a => !a[2]);
        const login = t.actions.filter(a => a[2]);
        return (
          <div key={t.key} style={{ background: on ? C.panel2 : C.panel, border: `2px solid ${on ? C.accent : C.line}`, borderRadius: 14, padding: "16px 18px", marginBottom: 12, transition: "border-color .15s" }}>
            <div onClick={() => toggleTool(t.key)} style={{ display: "flex", alignItems: "center", gap: 10, cursor: "pointer" }}>
              <span style={{ width: 22, height: 22, borderRadius: 6, border: `2px solid ${on ? C.accent : C.line2}`, background: on ? C.accent : "transparent", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14, fontWeight: 900, flexShrink: 0 }}>{on ? "✓" : ""}</span>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 15.5, fontWeight: 900 }}>{t.label}</div>
                <div style={{ fontSize: 12, color: C.sub, fontWeight: 600, marginTop: 2 }}>{t.desc}</div>
              </div>
            </div>

            {on && (
              <div style={{ marginTop: 14, paddingTop: 14, borderTop: `1px solid ${C.line2}`, display: "flex", flexDirection: "column", gap: 14 }}>
                {/* 행동(백링크 제외) */}
                {t.actions.length > 0 && (
                  <div>
                    <div style={{ fontSize: 12, fontWeight: 800, color: C.sub, marginBottom: 7 }}>원하는 행동 선택</div>
                    <div style={{ fontSize: 11, fontWeight: 700, color: C.good, marginBottom: 5 }}>로그인 없이 가능</div>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 7, marginBottom: 10 }}>
                      {free.map(([k, lb]) => {
                        const sel = acts[t.key]?.has(k);
                        return <button key={k} onClick={() => toggleAct(t.key, k)} style={btn(sel ? C.accent : C.panel, sel ? "#fff" : C.sub, sel ? C.accent : C.line2)}>{sel ? "✓ " : ""}{lb}</button>;
                      })}
                    </div>
                    {login.length > 0 && <>
                      <div style={{ fontSize: 11, fontWeight: 700, color: C.warn, marginBottom: 5 }}>🔑 로그인 필요 (승인 후 계정 연결)</div>
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 7 }}>
                        {login.map(([k, lb]) => {
                          const sel = acts[t.key]?.has(k);
                          return <button key={k} onClick={() => toggleAct(t.key, k)} style={btn(sel ? C.accent : C.panel, sel ? "#fff" : C.sub, sel ? C.accent : C.line2)}>{sel ? "✓ " : ""}{lb}</button>;
                        })}
                      </div>
                    </>}
                  </div>
                )}

                {/* 등급 */}
                <div>
                  <div style={{ fontSize: 12, fontWeight: 800, color: C.sub, marginBottom: 7 }}>등급</div>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 7 }}>
                    {PLANS.map(([k, lb]) => {
                      const sel = plan[t.key] === k;
                      return <button key={k} onClick={() => setPlan(m => ({ ...m, [t.key]: k }))} style={btn(sel ? C.accent : C.panel, sel ? "#fff" : C.sub, sel ? C.accent : C.line2)}>{sel ? "✓ " : ""}{lb}</button>;
                    })}
                  </div>
                </div>

                {/* 기간 */}
                <div>
                  <div style={{ fontSize: 12, fontWeight: 800, color: C.sub, marginBottom: 7 }}>기간</div>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 7 }}>
                    {PERIODS.map(([d, lb]) => {
                      const sel = days[t.key] === d;
                      return <button key={d} onClick={() => setDays(m => ({ ...m, [t.key]: d }))} style={btn(sel ? C.accent : C.panel, sel ? "#fff" : C.sub, sel ? C.accent : C.line2)}>{sel ? "✓ " : ""}{lb}</button>;
                    })}
                  </div>
                </div>
              </div>
            )}
          </div>
        );
      })}

      {/* 주문하기 */}
      <div style={{ position: "sticky", bottom: 0, paddingTop: 8, paddingBottom: 8, background: `linear-gradient(0deg,${C.bg} 70%,transparent)` }}>
        {msg && <div style={{ fontSize: 12.5, fontWeight: 800, color: msg.startsWith("✅") ? C.good : C.danger, marginBottom: 8, textAlign: "center" }}>{msg}</div>}
        <button onClick={submit} disabled={sending || !chosen.length} style={{ width: "100%", padding: "16px", borderRadius: 13, border: "none", background: chosen.length ? `linear-gradient(135deg,${C.accent},${C.accent2})` : C.line2, color: "#fff", fontSize: 16, fontWeight: 900, cursor: chosen.length && !sending ? "pointer" : "default", fontFamily: "inherit" }}>
          {sending ? "주문 중…" : chosen.length ? `🚀 ${chosen.length}개 기능 주문하기` : "기능을 선택하세요"}
        </button>
      </div>
    </div>
  );
}
