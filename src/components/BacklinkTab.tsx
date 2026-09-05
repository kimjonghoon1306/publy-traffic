import React, { useState, useEffect, useCallback, useRef } from "react";
import { supabase, getMemberSessionToken } from "../lib/supabase";

// 🔗 회원 백링크 탭 — 트래픽 앱 안의 4번째 기능(플레이스/블로그/스토어/백링크).
//   회원이 본인 도메인 입력 → 자동 게시·색인 → 상세 로그·현황. 빙키(색인)는 관리자가 넣어주거나 본인이 넣음.
//   ★ 탭 이동해도 안 꺼지게: 이 컴포넌트는 display:none으로 숨김(부모가 언마운트 안 함).

type Sub = { id: string; target_domain: string; plan: string; daily_limit: number; status: string; today_posted: number; total_posted: number; indexed: number; failed: number };
type LogRow = { kind: string; msg: string; at: string };

// 로그 8단계 색상(다크/라이트 대비) — 메모리 규격 그대로
const LOGC = (dark: boolean): Record<string, { bg: string; fg: string; label: string }> => ({
  apistart: dark ? { bg: "#0c3a52", fg: "#7dd3fc", label: "연결" } : { bg: "#e0f2fe", fg: "#0369a1", label: "연결" },
  proxy:    dark ? { bg: "#3d1a63", fg: "#d8b4fe", label: "안전연결" } : { bg: "#f3e8ff", fg: "#7e22ce", label: "안전연결" },
  botstart: dark ? { bg: "#173a34", fg: "#5eead4", label: "게시준비" } : { bg: "#e6f6f1", fg: "#0e7c66", label: "게시준비" },
  ai:       dark ? { bg: "#4a1533", fg: "#f9a8d4", label: "소개글작성" } : { bg: "#fce7f3", fg: "#be185d", label: "소개글작성" },
  post:     dark ? { bg: "#0f3d24", fg: "#86efac", label: "게시완료" } : { bg: "#dcfce7", fg: "#15803d", label: "게시완료" },
  index:    dark ? { bg: "#12306b", fg: "#93c5fd", label: "색인요청" } : { bg: "#dbeafe", fg: "#1d4ed8", label: "색인요청" },
  done:     dark ? { bg: "#26235c", fg: "#c7d2fe", label: "색인반영" } : { bg: "#e0e7ff", fg: "#4338ca", label: "색인반영" },
  wait:     dark ? { bg: "#2a2735", fg: "#a5adba", label: "대기" } : { bg: "#eef0f4", fg: "#64748b", label: "대기" },
  warn:     dark ? { bg: "#4a3410", fg: "#fcd34d", label: "주의" } : { bg: "#fef3c7", fg: "#b45309", label: "주의" },
  fail:     dark ? { bg: "#4a1518", fg: "#fca5a5", label: "재시도" } : { bg: "#fee2e2", fg: "#b91c1c", label: "재시도" },
});
const PLAN_LABEL: Record<string, string> = { basic: "베이직", pro: "프로", premium: "프리미엄" };

export default function BacklinkTab({ theme }: { theme: "dark" | "light" }) {
  const dark = theme === "dark";
  const C = dark
    ? { bg: "#14121c", win: "#1c1a26", ink: "#e8e6f0", sub: "#9a95ad", line: "#2a2735", panel: "#232030", accent: "#a78bfa", soft: "#2e1065" }
    : { bg: "#eef0f4", win: "#fff", ink: "#1f2430", sub: "#7b8394", line: "#e6e8ee", panel: "#f7f8fb", accent: "#6d28d9", soft: "#f2edfd" };
  const logC = LOGC(dark);
  const token = getMemberSessionToken();

  const [subs, setSubs] = useState<Sub[]>([]);
  const [sel, setSel] = useState<string>("");
  const [logs, setLogs] = useState<LogRow[]>([]);
  const [loading, setLoading] = useState(true);
  // 도메인 입력(구독 없을 때 본인이 등록)
  const [domainInput, setDomainInput] = useState("");
  const [domainMsg, setDomainMsg] = useState("");
  // 빙키(색인 키) — 값 있으면 켜진 것. 관리자가 넣어줬든 본인이 넣었든 이 칸에 보임.
  const [keyMasked, setKeyMasked] = useState<string | null>(null);
  const [keyInput, setKeyInput] = useState("");
  const [keyMsg, setKeyMsg] = useState("");
  const [keyOpen, setKeyOpen] = useState(false);

  const loadSubs = useCallback(async () => {
    try {
      const { data } = await supabase.rpc("backlink_my_subscription", { p_token: token });
      const rows = (data || []) as Sub[];
      setSubs(rows); setSel(prev => prev || (rows[0]?.id ?? "")); setLoading(false);
    } catch { setLoading(false); }
  }, [token]);

  const loadLog = useCallback(async (orderId: string) => {
    if (!orderId) return;
    try { const { data } = await supabase.rpc("backlink_my_log", { p_token: token, p_order_id: orderId }); setLogs((data || []) as LogRow[]); } catch { setLogs([]); }
  }, [token]);

  const loadMyKey = useCallback(async () => {
    try { const { data } = await supabase.rpc("backlink_my_indexnow", { p_token: token }); const r = (data && data[0]) || null; setKeyMasked(r?.key_masked || null); } catch {}
  }, [token]);

  useEffect(() => { loadSubs(); loadMyKey(); const iv = setInterval(loadSubs, 20000); return () => clearInterval(iv); }, [loadSubs, loadMyKey]);
  useEffect(() => { if (sel) { loadLog(sel); const iv = setInterval(() => loadLog(sel), 15000); return () => clearInterval(iv); } }, [sel, loadLog]);

  const cur = subs.find(s => s.id === sel);

  // 도메인 등록 — 승인은 됐는데 아직 도메인 없을 때 회원이 본인 도메인 입력
  const registerDomain = useCallback(async () => {
    const d = domainInput.trim().replace(/^https?:\/\//, "").replace(/\/.*$/, "");
    if (!d) { setDomainMsg("도메인을 입력하세요 (예: onjongilfarm.com)"); return; }
    const { error } = await supabase.rpc("backlink_set_my_domain", { p_token: token, p_domain: d });
    if (error) { setDomainMsg("등록 실패: " + error.message); return; }
    setDomainMsg("✅ 등록 완료 — 곧 자동으로 백링크가 시작돼요"); setDomainInput(""); loadSubs();
  }, [domainInput, token, loadSubs]);

  const saveMyKey = useCallback(async () => {
    const v = keyInput.trim();
    const { error } = await supabase.rpc("backlink_set_my_indexnow", { p_token: token, p_key: v });
    if (error) { setKeyMsg("저장 실패: " + error.message); return; }
    setKeyMsg(v ? "✅ 색인 키 저장 완료 — 검색·AI가 내 사이트를 더 빨리 읽어가요" : "✅ 키를 비웠어요");
    setKeyInput(""); loadMyKey(); setTimeout(() => setKeyMsg(""), 4000);
  }, [keyInput, token, loadMyKey]);

  const clearMyKey = useCallback(async () => {
    await supabase.rpc("backlink_set_my_indexnow", { p_token: token, p_key: "" });
    setKeyMasked(null); setKeyMsg("키를 삭제했어요 — 본인 키를 새로 넣으세요"); loadMyKey();
  }, [token, loadMyKey]);

  const card = (extra: React.CSSProperties = {}): React.CSSProperties => ({ background: C.win, border: `1px solid ${C.line}`, borderRadius: 14, padding: 16, ...extra });
  const chip = (bg: string, fg: string): React.CSSProperties => ({ padding: "3px 11px", borderRadius: 99, fontSize: 11.5, fontWeight: 800, background: bg, color: fg });

  if (loading) return <div style={{ textAlign: "center", color: C.sub, padding: 40 }}>불러오는 중…</div>;

  // 승인은 됐는데 구독(도메인)이 아직 없음 → 도메인 입력
  if (subs.length === 0) {
    return (
      <div style={card({ padding: 22 })}>
        <div style={{ fontSize: 30, marginBottom: 8 }}>🔗</div>
        <div style={{ fontWeight: 900, fontSize: 16, marginBottom: 6 }}>백링크를 걸 내 사이트 주소를 넣어주세요</div>
        <div style={{ color: C.sub, fontSize: 13, lineHeight: 1.7, marginBottom: 12 }}>
          내 홈페이지·블로그·스토어 등 <b style={{ color: C.ink }}>순위를 올리고 싶은 사이트 주소</b>를 넣으면,
          여러 곳에 자동으로 백링크를 걸어 <b style={{ color: C.accent }}>구글·AI 검색 노출</b>을 키워요.
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <input value={domainInput} onChange={e => setDomainInput(e.target.value)} placeholder="예: onjongilfarm.com"
            style={{ flex: 1, minWidth: 180, padding: "12px 13px", border: `1px solid ${C.line}`, borderRadius: 10, background: C.panel, color: C.ink, fontSize: 14 }} />
          <button onClick={registerDomain} style={{ padding: "12px 20px", borderRadius: 10, border: "none", background: C.accent, color: "#fff", fontWeight: 800, fontSize: 14, cursor: "pointer" }}>등록</button>
        </div>
        {domainMsg && <div style={{ fontSize: 12.5, color: logC.post.fg, fontWeight: 700, marginTop: 8 }}>{domainMsg}</div>}
      </div>
    );
  }

  const keyOn = !!keyMasked;
  return (
    <div>
      {/* 도메인 여러 개면 선택 */}
      {subs.length > 1 && (
        <div style={{ display: "flex", gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
          {subs.map(s => (
            <button key={s.id} onClick={() => setSel(s.id)} style={{ padding: "8px 13px", borderRadius: 99, border: `1.5px solid ${sel === s.id ? C.accent : C.line}`, background: sel === s.id ? C.soft : C.win, color: sel === s.id ? C.accent : C.sub, fontWeight: 800, fontSize: 12.5, cursor: "pointer" }}>{s.target_domain}</button>
          ))}
        </div>
      )}

      {cur && (<>
        {/* 현황 */}
        <div style={card({ marginBottom: 12 })}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
            <b style={{ fontSize: 16, color: C.ink }}>{cur.target_domain}</b>
            <span style={chip(C.soft, C.accent)}>{PLAN_LABEL[cur.plan] || cur.plan} · 하루 {cur.daily_limit}개</span>
            <span style={chip(logC.post.bg, logC.post.fg)}>{cur.status === "active" ? "자동 진행 중" : cur.status}</span>
          </div>
          <div style={{ fontSize: 12.5, color: C.sub, fontWeight: 600, marginBottom: 6 }}>오늘 {cur.today_posted}/{cur.daily_limit}개 게시 <span>(매일 자정 리셋)</span></div>
          <div style={{ height: 10, borderRadius: 99, background: C.line, overflow: "hidden", marginBottom: 14 }}>
            <div style={{ height: "100%", width: `${cur.daily_limit ? Math.min(100, Math.round(cur.today_posted / cur.daily_limit * 100)) : 0}%`, background: `linear-gradient(90deg,${C.accent},#c4b5fd)`, borderRadius: 99, transition: "width .4s" }} />
          </div>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            {[["누적 게시", cur.total_posted, logC.post], ["색인 반영", cur.indexed, logC.done], ["재시도", cur.failed, logC.fail]].map(([l, n, c]: any) => (
              <div key={l} style={{ flex: 1, minWidth: 90, textAlign: "center", padding: 12, borderRadius: 12, background: c.bg }}>
                <div style={{ fontSize: 22, fontWeight: 900, color: c.fg }}>{n}</div>
                <div style={{ fontSize: 11, fontWeight: 700, color: c.fg, opacity: .85 }}>{l}</div>
              </div>
            ))}
          </div>
        </div>

        {/* 🔑 색인 키 — 값 있으면 켜진 것. 관리자가 넣어줬든 본인이 넣었든 이 칸에 보임(테리 방식) */}
        <div style={card({ marginBottom: 12, border: `1px solid ${keyOn ? "#16a34a55" : C.line}` })}>
          <div onClick={() => setKeyOpen(o => !o)} style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", flexWrap: "wrap" }}>
            <b style={{ fontSize: 14, color: C.ink }}>🔑 색인 키 <span style={{ fontSize: 11, color: C.sub, fontWeight: 600 }}>· 검색·AI가 더 빨리 읽게</span></b>
            <span style={{ marginLeft: "auto", display: "inline-flex", alignItems: "center", gap: 6, ...chip(keyOn ? logC.post.bg : C.panel, keyOn ? logC.post.fg : C.sub) }}>
              <span style={{ width: 9, height: 9, borderRadius: "50%", background: keyOn ? "#16a34a" : C.sub, boxShadow: keyOn ? "0 0 7px #16a34a" : "none" }} />
              {keyOn ? "키 등록됨 🟢" : "키 없음"}
            </span>
            <span style={{ color: C.sub, fontSize: 13 }}>{keyOpen ? "▲" : "▼"}</span>
          </div>
          {keyOn && !keyOpen && <div style={{ marginTop: 8, fontSize: 12.5, color: C.sub }}>등록된 키: <b style={{ color: logC.post.fg }}>🟢 {keyMasked}</b> <span style={{ color: C.sub }}>(관리자 또는 본인이 넣은 키)</span></div>}
          {keyOpen && (
            <div style={{ marginTop: 12 }}>
              <div style={{ fontSize: 12.5, color: C.sub, lineHeight: 1.8, marginBottom: 10 }}>
                색인 키가 있으면 검색엔진에 <b style={{ color: C.ink }}>“지금 읽어줘”</b> 신호를 보내 <b style={{ color: C.ink }}>더 빨리(약 3일)</b> 반영돼요.
                {keyMasked ? <><br />지금 등록된 키: <b style={{ color: logC.post.fg }}>🟢 {keyMasked}</b> — 본인 키로 바꾸려면 <b>삭제</b> 후 새로 넣으세요.</> : <><br />없어도 자동으로 처리돼요(선택).</>}
              </div>
              <div style={{ fontSize: 12, color: C.ink, lineHeight: 2, marginBottom: 10, padding: "11px 13px", borderRadius: 10, background: C.soft }}>
                <b>📋 본인 키 발급 — 3단계</b><br />
                <b style={{ color: C.accent }}>1.</b> <span style={{ textDecoration: "underline" }}>빙 웹마스터도구(bing.com/webmasters)</span> 접속 → 사이트 등록<br />
                <b style={{ color: C.accent }}>2.</b> 오른쪽 위 ⚙️설정 → API 액세스 → API 키 → <b>키(32자리)</b> 복사<br />
                <b style={{ color: C.accent }}>3.</b> 아래에 붙여넣고 저장
              </div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <input value={keyInput} onChange={e => setKeyInput(e.target.value)} placeholder={keyMasked ? "본인 키로 바꾸려면 붙여넣기" : "발급받은 색인 키 붙여넣기"}
                  style={{ flex: 1, minWidth: 160, padding: "12px 13px", border: `1px solid ${C.line}`, borderRadius: 10, background: C.panel, color: C.ink, fontSize: 13.5 }} />
                <button onClick={saveMyKey} style={{ padding: "12px 18px", borderRadius: 10, border: "none", background: C.accent, color: "#fff", fontWeight: 800, fontSize: 13.5, cursor: "pointer" }}>저장</button>
                {keyMasked && <button onClick={clearMyKey} style={{ padding: "12px 16px", borderRadius: 10, border: `1px solid ${logC.fail.fg}`, background: C.win, color: logC.fail.fg, fontWeight: 800, fontSize: 13.5, cursor: "pointer" }}>삭제</button>}
              </div>
              {keyMsg && <div style={{ fontSize: 12, color: logC.post.fg, fontWeight: 700, marginTop: 8 }}>{keyMsg}</div>}
            </div>
          )}
        </div>

        {/* 진행 보고서 — 8단계 상세 로그(주소 비공개, 신뢰지표만) */}
        <div style={card()}>
          <div style={{ fontWeight: 900, fontSize: 14, marginBottom: 4, display: "flex", alignItems: "center", gap: 8, color: C.ink }}>
            <span style={{ width: 4, height: 15, borderRadius: 2, background: C.accent }} />진행 보고서
            <span style={{ fontSize: 11, color: C.sub, fontWeight: 600 }}>· 단계별 상세 (안전상 게시 주소는 비공개)</span>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 12 }}>
            {logs.length === 0 ? (
              <div style={{ textAlign: "center", color: C.sub, padding: 20, fontSize: 13 }}>곧 자동으로 게시가 시작됩니다 (예약 대기 중)</div>
            ) : logs.map((l, i) => {
              const c = logC[l.kind] || logC.wait;
              const ts = l.at ? new Date(l.at).toLocaleString("ko-KR", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }) : "";
              return (
                <div key={i} style={{ display: "flex", alignItems: "flex-start", gap: 9, padding: "9px 11px", borderRadius: 9, background: C.panel, border: `1px solid ${C.line}` }}>
                  <span style={{ ...chip(c.bg, c.fg), flexShrink: 0 }}>{c.label}</span>
                  <span style={{ color: C.ink, fontWeight: 600, fontSize: 12.5, lineHeight: 1.5, flex: 1 }}>{l.msg}</span>
                  <span style={{ fontSize: 10.5, color: C.sub, fontWeight: 600, flexShrink: 0 }}>{ts}</span>
                </div>
              );
            })}
          </div>
        </div>
      </>)}
    </div>
  );
}
