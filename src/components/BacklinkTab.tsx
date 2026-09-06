import React, { useState, useEffect, useCallback, useRef } from "react";
import { supabase, getMemberSessionToken, sendTrafficLog } from "../lib/supabase";

// 🔗 회원 백링크 탭 — 트래픽 앱 4번째 기능. 블로그(InflowCenter) 방식 그대로:
//   도메인(계정) 여러 개 추가/삭제/선택 · 무제한도 오늘 사용량 카운트 · 수량 지정 · [시작하기] · 실시간 로그(0.1단계) · 로그 3버튼.
//   ★ 탭 이동해도 안 꺼지게: 부모가 display:none으로 숨김(언마운트 안 함).

const BOT = "http://127.0.0.1:3374"; // backlink-bot

type Sub = { id: string; target_domain: string; plan: string; daily_limit: number; status: string; today_posted: number; total_posted: number; indexed: number; failed: number };
type LogRow = { kind: string; msg: string; at: string };

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
const PLAN_LABEL: Record<string, string> = { basic: "베이직", pro: "프로", premium: "프리미엄", unlimited: "무제한" };

export default function BacklinkTab({ theme, memberEmail, memberName }: { theme: "dark" | "light"; memberEmail?: string; memberName?: string }) {
  const dark = theme === "dark";
  const C = dark
    ? { bg: "#14121c", win: "#1c1a26", ink: "#e8e6f0", sub: "#9a95ad", line: "#2a2735", panel: "#232030", accent: "#a78bfa", soft: "#2e1065" }
    : { bg: "#eef0f4", win: "#fff", ink: "#1f2430", sub: "#7b8394", line: "#e6e8ee", panel: "#f7f8fb", accent: "#6d28d9", soft: "#f2edfd" };
  const logC = LOGC(dark);
  const token = getMemberSessionToken();

  const [subs, setSubs] = useState<Sub[]>([]);
  const [sel, setSel] = useState<string>("");
  const [loading, setLoading] = useState(true);

  // 도메인(계정) 추가 입력
  const [domainInput, setDomainInput] = useState("");
  const [domainMsg, setDomainMsg] = useState("");

  // 실행(시작하기)
  const [running, setRunning] = useState(false);
  const [qty, setQty] = useState<number>(5);                 // 이번에 발송할 수량
  const [logs, setLogs] = useState<LogRow[]>([]);            // 실시간 로그
  const [logZoom, setLogZoom] = useState(false);
  const esRef = useRef<EventSource | null>(null);
  const logBoxRef = useRef<HTMLDivElement | null>(null);

  // 색인키
  const [keyMasked, setKeyMasked] = useState<string | null>(null);
  const [isAdminKey, setIsAdminKey] = useState(false);
  const [keyWaiting, setKeyWaiting] = useState(false);
  const [keyInput, setKeyInput] = useState("");
  const [keyMsg, setKeyMsg] = useState("");
  const [keyOpen, setKeyOpen] = useState(false);
  const [sending, setSending] = useState(false);
  const [sentMsg, setSentMsg] = useState("");

  const pushLog = useCallback((kind: string, msg: string) => {
    setLogs(l => [...l, { kind, msg, at: new Date().toISOString() }]);
  }, []);

  const loadSubs = useCallback(async () => {
    try {
      const { data } = await supabase.rpc("backlink_my_subscription", { p_token: token });
      const rows = (data || []) as Sub[];
      setSubs(rows); setSel(prev => prev || (rows[0]?.id ?? "")); setLoading(false);
    } catch { setLoading(false); }
  }, [token]);

  const loadMyKey = useCallback(async () => {
    try {
      const { data } = await supabase.rpc("backlink_my_indexnow", { p_token: token });
      const r = (data && data[0]) || null;
      setKeyMasked(r?.key_masked || null); setIsAdminKey(!!r?.is_admin_key); setKeyWaiting(!!r?.waiting);
    } catch {}
  }, [token]);

  useEffect(() => { loadSubs(); loadMyKey(); const iv = setInterval(loadSubs, 20000); return () => clearInterval(iv); }, [loadSubs, loadMyKey]);
  useEffect(() => { if (logBoxRef.current) logBoxRef.current.scrollTop = logBoxRef.current.scrollHeight; }, [logs]);
  useEffect(() => () => { esRef.current?.close(); }, []);

  const cur = subs.find(s => s.id === sel);
  const unlimited = (cur?.plan === "unlimited") || (cur?.daily_limit === 0);
  const remainToday = unlimited ? 999 : Math.max(0, (cur?.daily_limit ?? 0) - (cur?.today_posted ?? 0));

  // ➕ 도메인(계정) 추가
  const addDomain = useCallback(async () => {
    const d = domainInput.trim().replace(/^https?:\/\//, "").replace(/\/.*$/, "");
    if (!d) { setDomainMsg("도메인을 입력하세요 (예: onjongilfarm.com)"); return; }
    const { error } = await supabase.rpc("backlink_set_my_domain", { p_token: token, p_domain: d });
    if (error) { setDomainMsg("추가 실패: " + error.message); return; }
    setDomainMsg("✅ 추가 완료"); setDomainInput(""); await loadSubs(); setTimeout(() => setDomainMsg(""), 2500);
  }, [domainInput, token, loadSubs]);

  // ❌ 도메인(계정) 삭제
  const removeDomain = useCallback(async (orderId: string, dom: string) => {
    if (!window.confirm(`[${dom}] 도메인을 삭제할까요?\n(이 도메인의 백링크 기록도 함께 정리됩니다)`)) return;
    const { error } = await supabase.rpc("backlink_delete_my_domain", { p_token: token, p_order_id: orderId });
    if (error) { setDomainMsg("삭제 실패: " + error.message); return; }
    if (sel === orderId) setSel("");
    await loadSubs();
  }, [token, sel, loadSubs]);

  // 🚀 시작하기 — 봇 SSE 스트림으로 실시간 게시
  const startPublish = useCallback(() => {
    if (!cur) return;
    if (running) return;
    const want = unlimited ? Math.max(1, qty) : Math.min(qty, remainToday);
    if (!unlimited && remainToday <= 0) { pushLog("warn", "오늘 발송 한도를 다 썼어요 — 자정에 초기화돼요."); return; }
    setRunning(true); setLogs([]);
    pushLog("wait", `준비 중… ${cur.target_domain}에 ${want}개 발송을 시작합니다`);
    const url = `${BOT}/member-publish-stream?token=${encodeURIComponent(token)}&orderId=${encodeURIComponent(cur.id)}&targetDomain=${encodeURIComponent(cur.target_domain)}&count=${want}`;
    const es = new EventSource(url);
    esRef.current = es;
    es.onmessage = (e) => {
      try {
        const d = JSON.parse(e.data);
        if (d.type === "log") pushLog(d.kind || "wait", d.msg);
        else if (d.type === "error") { pushLog("fail", "❌ " + d.msg); es.close(); setRunning(false); }
        else if (d.type === "done") { pushLog("done", `🎉 발송 완료 — 이번에 ${d.posted}개 게시됐어요`); es.close(); setRunning(false); loadSubs(); }
      } catch {}
    };
    es.onerror = () => { pushLog("fail", "❌ 연결 오류 — 봇 서버(3374)를 확인해주세요"); es.close(); setRunning(false); };
  }, [cur, running, unlimited, qty, remainToday, token, pushLog, loadSubs]);

  const stopPublish = useCallback(() => { esRef.current?.close(); setRunning(false); pushLog("warn", "발송을 멈췄어요"); }, [pushLog]);

  const saveMyKey = useCallback(async () => {
    const v = keyInput.trim();
    const { error } = await supabase.rpc("backlink_set_my_indexnow", { p_token: token, p_key: v });
    if (error) { setKeyMsg("저장 실패: " + error.message); return; }
    setKeyMsg(v ? "✅ 색인 키 저장 완료" : "✅ 키를 비웠어요"); setKeyInput(""); loadMyKey(); setTimeout(() => setKeyMsg(""), 4000);
  }, [keyInput, token, loadMyKey]);

  const clearMyKey = useCallback(async () => {
    await supabase.rpc("backlink_set_my_indexnow", { p_token: token, p_key: "" });
    setKeyMasked(null); setKeyMsg("키를 삭제했어요"); loadMyKey();
  }, [token, loadMyKey]);

  const copyLogs = useCallback(() => {
    navigator.clipboard.writeText(logs.map(l => `[${l.kind}] ${l.msg}`).join("\n")).then(() => setSentMsg("📋 로그를 복사했어요")).catch(() => {});
    setTimeout(() => setSentMsg(""), 2500);
  }, [logs]);

  const sendLogToAdmin = useCallback(async () => {
    setSending(true); setSentMsg("");
    try {
      const head = `[🔗 백링크] 도메인: ${cur?.target_domain || "-"} · 등급: ${PLAN_LABEL[cur?.plan || ""] || cur?.plan || "-"} · 누적 ${cur?.total_posted ?? 0} · 색인 ${cur?.indexed ?? 0}`;
      const body = logs.map(l => `[${l.kind}] ${l.msg}`).join("\n");
      await sendTrafficLog(memberEmail || "", memberName || "", (head + "\n\n" + body).slice(0, 20000), "백링크");
      setSentMsg("✅ 관리자에게 로그를 보냈어요");
    } catch (e: any) { setSentMsg("전송 실패: " + (e?.message || e)); }
    setSending(false); setTimeout(() => setSentMsg(""), 5000);
  }, [cur, logs, memberEmail, memberName]);

  const card = (extra: React.CSSProperties = {}): React.CSSProperties => ({ background: C.win, border: `1px solid ${C.line}`, borderRadius: 14, padding: 16, ...extra });
  const chip = (bg: string, fg: string): React.CSSProperties => ({ padding: "3px 11px", borderRadius: 99, fontSize: 11.5, fontWeight: 800, background: bg, color: fg });
  const inputStyle: React.CSSProperties = { padding: "12px 13px", border: `1px solid ${C.line}`, borderRadius: 10, background: C.panel, color: C.ink, fontSize: 14, fontFamily: "inherit" };

  const logView = (big: boolean) => (
    <div ref={big ? undefined : logBoxRef} style={{ background: dark ? "#0d0b14" : "#0f1117", borderRadius: 10, padding: 12, height: big ? "60vh" : 220, overflowY: "auto", display: "flex", flexDirection: "column", gap: 5 }}>
      {logs.length === 0 ? (
        <div style={{ color: "#6b7280", fontSize: 12.5, textAlign: "center", padding: 20 }}>[시작하기]를 누르면 여기에 게시 과정이 실시간으로 보여요</div>
      ) : logs.map((l, i) => {
        const c = logC[l.kind] || logC.wait;
        const ts = new Date(l.at).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
        return (
          <div key={i} style={{ display: "flex", alignItems: "flex-start", gap: 8, fontSize: 12.5, lineHeight: 1.5 }}>
            <span style={{ ...chip(c.bg, c.fg), flexShrink: 0 }}>{c.label}</span>
            <span style={{ color: "#d1d5db", fontWeight: 600, flex: 1 }}>{l.msg}</span>
            <span style={{ color: "#6b7280", fontSize: 10, flexShrink: 0 }}>{ts}</span>
          </div>
        );
      })}
    </div>
  );

  if (loading) return <div style={{ textAlign: "center", color: C.sub, padding: 40 }}>불러오는 중…</div>;

  return (
    <div>
      {/* ── 내 도메인(계정) 관리 ── */}
      <div style={card({ marginBottom: 12 })}>
        <div style={{ fontWeight: 900, fontSize: 14, marginBottom: 4, display: "flex", alignItems: "center", gap: 8, color: C.ink }}>
          <span style={{ width: 4, height: 15, borderRadius: 2, background: C.accent }} />내 도메인(계정)
          <span style={{ fontSize: 11, color: C.sub, fontWeight: 600 }}>· 백링크를 걸 내 사이트. 여러 개 추가·선택·삭제 가능</span>
        </div>
        {/* 도메인 목록 = 선택 버튼 + 삭제 */}
        {subs.length > 0 && (
          <div style={{ display: "flex", flexDirection: "column", gap: 6, margin: "10px 0" }}>
            {subs.map(s => {
              const on = s.id === sel;
              const unl = s.plan === "unlimited" || s.daily_limit === 0;
              return (
                <div key={s.id} onClick={() => setSel(s.id)} style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 12px", borderRadius: 10, border: `1.5px solid ${on ? C.accent : C.line}`, background: on ? C.soft : C.panel, cursor: "pointer" }}>
                  <span style={{ width: 8, height: 8, borderRadius: "50%", background: on ? C.accent : C.sub, flexShrink: 0 }} />
                  <b style={{ fontSize: 13.5, color: on ? C.accent : C.ink, flex: 1 }}>{s.target_domain}</b>
                  <span style={chip(C.soft, C.accent)}>{PLAN_LABEL[s.plan] || s.plan}{unl ? "" : ` · 하루 ${s.daily_limit}`}</span>
                  <button onClick={(e) => { e.stopPropagation(); removeDomain(s.id, s.target_domain); }} title="삭제" style={{ border: `1px solid ${C.line}`, background: C.win, color: "#dc2626", borderRadius: 8, width: 28, height: 28, fontSize: 16, fontWeight: 900, cursor: "pointer", flexShrink: 0 }}>×</button>
                </div>
              );
            })}
          </div>
        )}
        {/* 새 도메인 추가 */}
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <input value={domainInput} onChange={e => setDomainInput(e.target.value)} onKeyDown={e => { if (e.key === "Enter") addDomain(); }} placeholder="예: onjongilfarm.com" style={{ ...inputStyle, flex: 1, minWidth: 170 }} />
          <button onClick={addDomain} style={{ padding: "12px 18px", borderRadius: 10, border: `1.5px dashed ${C.accent}`, background: "transparent", color: C.accent, fontWeight: 800, fontSize: 14, cursor: "pointer", fontFamily: "inherit" }}>＋ 도메인 추가</button>
        </div>
        {domainMsg && <div style={{ fontSize: 12.5, color: logC.post.fg, fontWeight: 700, marginTop: 8 }}>{domainMsg}</div>}
        {subs.length === 0 && <div style={{ fontSize: 12.5, color: C.sub, marginTop: 8, lineHeight: 1.6 }}>순위를 올리고 싶은 사이트 주소를 넣으면, 여러 곳에 자동으로 백링크를 걸어 <b style={{ color: C.accent }}>구글·AI 검색 노출</b>을 키워요.</div>}
      </div>

      {cur && (<>
        {/* ── 현황 + 시작하기 ── */}
        <div style={card({ marginBottom: 12 })}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
            <b style={{ fontSize: 16, color: C.ink }}>{cur.target_domain}</b>
            <span style={chip(C.soft, C.accent)}>{PLAN_LABEL[cur.plan] || cur.plan}{unlimited ? " · 무제한" : ` · 하루 ${cur.daily_limit}개`}</span>
            {running && <span style={chip(logC.post.bg, logC.post.fg)}>발송 중…</span>}
          </div>
          {/* 오늘 사용량 — 무제한도 카운트 표시 */}
          <div style={{ fontSize: 12.5, color: C.sub, fontWeight: 600, marginBottom: 6 }}>
            오늘 <b style={{ color: C.ink }}>{cur.today_posted}개</b> 게시 {unlimited ? <span>· 무제한</span> : <span>/ 하루 {cur.daily_limit}개 (남은 {remainToday}개)</span>} <span>· 자정 리셋</span>
          </div>
          {!unlimited && (
            <div style={{ height: 8, borderRadius: 99, background: C.line, overflow: "hidden", marginBottom: 14 }}>
              <div style={{ height: "100%", width: `${cur.daily_limit ? Math.min(100, Math.round(cur.today_posted / cur.daily_limit * 100)) : 0}%`, background: `linear-gradient(90deg,${C.accent},#c4b5fd)`, borderRadius: 99 }} />
            </div>
          )}
          {/* KPI */}
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 14 }}>
            {[["누적 게시", cur.total_posted, logC.post], ["색인 반영", cur.indexed, logC.done], ["재시도", cur.failed, logC.fail]].map(([l, n, c]: any) => (
              <div key={l} style={{ flex: 1, minWidth: 90, textAlign: "center", padding: 12, borderRadius: 12, background: c.bg }}>
                <div style={{ fontSize: 22, fontWeight: 900, color: c.fg }}>{n}</div>
                <div style={{ fontSize: 11, fontWeight: 700, color: c.fg, opacity: .85 }}>{l}</div>
              </div>
            ))}
          </div>
          {/* 수량 지정 + 시작 */}
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", padding: 12, borderRadius: 12, background: C.panel, border: `1px solid ${C.line}` }}>
            <span style={{ fontSize: 13, fontWeight: 800, color: C.ink }}>이 도메인에 백링크</span>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <button onClick={() => setQty(q => Math.max(1, q - 1))} disabled={running} style={{ width: 32, height: 32, borderRadius: 8, border: `1px solid ${C.line}`, background: C.win, color: C.ink, fontSize: 18, fontWeight: 900, cursor: "pointer" }}>−</button>
              <input type="number" value={qty} min={1} max={unlimited ? 50 : remainToday || 1} onChange={e => setQty(Math.max(1, Number(e.target.value) || 1))} disabled={running} style={{ width: 60, textAlign: "center", ...inputStyle, padding: "8px" }} />
              <button onClick={() => setQty(q => q + 1)} disabled={running || (!unlimited && qty >= remainToday)} style={{ width: 32, height: 32, borderRadius: 8, border: `1px solid ${C.line}`, background: C.win, color: C.ink, fontSize: 18, fontWeight: 900, cursor: "pointer" }}>＋</button>
              <span style={{ fontSize: 13, fontWeight: 700, color: C.sub }}>개</span>
            </div>
            {!unlimited && <button onClick={() => setQty(remainToday)} disabled={running || remainToday <= 0} style={{ padding: "6px 10px", borderRadius: 8, border: `1px solid ${C.line}`, background: C.win, color: C.accent, fontSize: 12, fontWeight: 800, cursor: "pointer" }}>남은 만큼 ({remainToday})</button>}
            <div style={{ flex: 1 }} />
            {running
              ? <button onClick={stopPublish} style={{ padding: "12px 22px", borderRadius: 10, border: "none", background: "#dc2626", color: "#fff", fontWeight: 900, fontSize: 14, cursor: "pointer", fontFamily: "inherit" }}>■ 멈추기</button>
              : <button onClick={startPublish} disabled={!unlimited && remainToday <= 0} style={{ padding: "12px 24px", borderRadius: 10, border: "none", background: (!unlimited && remainToday <= 0) ? C.line : `linear-gradient(135deg,${C.accent},#8b5cf6)`, color: "#fff", fontWeight: 900, fontSize: 14, cursor: (!unlimited && remainToday <= 0) ? "default" : "pointer", fontFamily: "inherit" }}>🚀 백링크 시작하기</button>}
          </div>
        </div>

        {/* ── 색인 키 ── */}
        <div style={card({ marginBottom: 12, border: `1px solid ${keyMasked ? "#16a34a55" : (keyWaiting ? "#f59e0b55" : C.line)}` })}>
          <div onClick={() => setKeyOpen(o => !o)} style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", flexWrap: "wrap" }}>
            <b style={{ fontSize: 14, color: C.ink }}>🔑 색인 키 <span style={{ fontSize: 11, color: C.sub, fontWeight: 600 }}>· 검색·AI가 더 빨리 읽게</span></b>
            <span style={{ marginLeft: "auto", ...chip(keyMasked ? logC.post.bg : (keyWaiting ? logC.warn.bg : C.panel), keyMasked ? logC.post.fg : (keyWaiting ? logC.warn.fg : C.sub)) }}>
              {keyMasked ? (isAdminKey ? "관리자가 넣어줌 🟢" : "내 키 등록됨 🟢") : (keyWaiting ? "색인 대기 🟡" : "키 없음")}
            </span>
            <span style={{ color: C.sub, fontSize: 13 }}>{keyOpen ? "▲" : "▼"}</span>
          </div>
          {keyOpen && (
            <div style={{ marginTop: 12 }}>
              {isAdminKey ? (
                <div style={{ fontSize: 12.5, color: C.ink, lineHeight: 1.8, marginBottom: 10, padding: "11px 13px", borderRadius: 10, background: logC.post.bg }}>
                  <b style={{ color: logC.post.fg }}>🟢 관리자가 색인키를 넣어줬어요</b> <span style={{ color: logC.post.fg }}>({keyMasked})</span><br />
                  <span style={{ color: C.sub }}>아무것도 안 해도 돼요. <b style={{ color: C.ink }}>내 키로 바꾸려면</b> 아래에서 발급받아 넣으세요.</span>
                </div>
              ) : keyMasked ? (
                <div style={{ fontSize: 12.5, color: C.ink, lineHeight: 1.8, marginBottom: 10, padding: "11px 13px", borderRadius: 10, background: logC.post.bg }}>
                  <b style={{ color: logC.post.fg }}>🟢 내 색인키가 등록돼 있어요</b> <span style={{ color: logC.post.fg }}>({keyMasked})</span>
                </div>
              ) : (
                <div style={{ fontSize: 12.5, color: logC.warn.fg, lineHeight: 1.8, marginBottom: 10, padding: "11px 13px", borderRadius: 10, background: logC.warn.bg, fontWeight: 600 }}>
                  🟡 <b>색인 요청 대기 중</b> — 아래에서 <b>내 키를 발급·등록</b>하면 검색엔진에 “지금 읽어줘” 신호를 보내 <b>더 빨리(약 3일)</b> 반영돼요. <span style={{ color: C.sub }}>(백링크 게시는 키 없이도 계속돼요)</span>
                </div>
              )}
              {/* 발급받기 버튼 */}
              <button onClick={() => { try { window.open("https://www.bing.com/webmasters", "_blank"); } catch {} }}
                style={{ width: "100%", padding: "12px", borderRadius: 10, border: `1.5px solid ${C.accent}`, background: C.soft, color: C.accent, fontWeight: 900, fontSize: 13.5, cursor: "pointer", marginBottom: 10 }}>
                🔷 빙 색인키 발급받으러 가기 (빙 웹마스터도구 열기) ↗
              </button>
              <div style={{ fontSize: 12, color: C.ink, lineHeight: 2, marginBottom: 10, padding: "11px 13px", borderRadius: 10, background: C.panel, border: `1px solid ${C.line}` }}>
                <b>📋 내 키 발급 — 3단계</b><br />
                <b style={{ color: C.accent }}>1.</b> 위 버튼으로 <b>빙 웹마스터도구</b> 접속 → 내 사이트 등록<br />
                <b style={{ color: C.accent }}>2.</b> ⚙️설정 → <b>API 액세스 → IndexNow 키</b> 복사(32자리)<br />
                <b style={{ color: C.accent }}>3.</b> 아래에 붙여넣고 저장
              </div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <input value={keyInput} onChange={e => setKeyInput(e.target.value)} placeholder={keyMasked && !isAdminKey ? "본인 키로 바꾸려면 붙여넣기" : "발급받은 색인 키 붙여넣기"} style={{ ...inputStyle, flex: 1, minWidth: 160, fontSize: 13.5 }} />
                <button onClick={saveMyKey} style={{ padding: "12px 18px", borderRadius: 10, border: "none", background: C.accent, color: "#fff", fontWeight: 800, fontSize: 13.5, cursor: "pointer" }}>내 키 넣기</button>
                {keyMasked && !isAdminKey && <button onClick={clearMyKey} style={{ padding: "12px 16px", borderRadius: 10, border: `1px solid ${logC.fail.fg}`, background: C.win, color: logC.fail.fg, fontWeight: 800, fontSize: 13.5, cursor: "pointer" }}>삭제</button>}
              </div>
              {keyMsg && <div style={{ fontSize: 12, color: logC.post.fg, fontWeight: 700, marginTop: 8 }}>{keyMsg}</div>}
            </div>
          )}
        </div>

        {/* ── 실시간 로그 + 3버튼 ── */}
        <div style={card()}>
          <div style={{ fontWeight: 900, fontSize: 14, marginBottom: 10, display: "flex", alignItems: "center", gap: 8, color: C.ink, flexWrap: "wrap" }}>
            <span style={{ width: 4, height: 15, borderRadius: 2, background: C.accent }} />📜 실시간 로그
            <span style={{ fontSize: 11, color: C.sub, fontWeight: 600 }}>· 단계별 상세 (안전상 게시 주소는 비공개)</span>
            <div style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
              <button onClick={() => setLogZoom(true)} disabled={!logs.length} style={{ padding: "6px 12px", borderRadius: 8, border: `1.5px solid ${C.line}`, background: C.panel, color: logs.length ? C.accent : C.sub, fontSize: 12, fontWeight: 800, cursor: logs.length ? "pointer" : "default", fontFamily: "inherit" }}>🔍 크게 보기</button>
              <button onClick={copyLogs} disabled={!logs.length} style={{ padding: "6px 12px", borderRadius: 8, border: `1.5px solid ${C.line}`, background: C.panel, color: logs.length ? C.accent : C.sub, fontSize: 12, fontWeight: 800, cursor: logs.length ? "pointer" : "default", fontFamily: "inherit" }}>📋 복사</button>
              <button onClick={sendLogToAdmin} disabled={!logs.length || sending} style={{ padding: "6px 12px", borderRadius: 8, border: "none", background: logs.length ? `linear-gradient(135deg,${C.accent},#8b5cf6)` : C.line, color: "#fff", fontSize: 12, fontWeight: 800, cursor: logs.length && !sending ? "pointer" : "default", fontFamily: "inherit" }}>{sending ? "보내는 중…" : "📨 관리자에게 보내기"}</button>
            </div>
          </div>
          {sentMsg && <div style={{ fontSize: 12, color: logC.post.fg, fontWeight: 700, marginBottom: 8 }}>{sentMsg}</div>}
          {logView(false)}
        </div>
      </>)}

      {/* 🔍 로그 크게 보기 모달 */}
      {logZoom && (
        <div onClick={() => setLogZoom(false)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.6)", zIndex: 9999, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
          <div onClick={e => e.stopPropagation()} style={{ width: "min(760px,96vw)", background: C.win, borderRadius: 16, padding: 16 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
              <b style={{ color: C.ink, fontSize: 15 }}>📜 실시간 로그 — 크게 보기</b>
              <button onClick={copyLogs} style={{ marginLeft: "auto", padding: "7px 14px", borderRadius: 9, border: "none", background: C.panel, color: C.accent, fontWeight: 800, cursor: "pointer", fontFamily: "inherit" }}>📋 복사</button>
              <button onClick={() => setLogZoom(false)} style={{ padding: "7px 14px", borderRadius: 9, border: `1px solid ${C.line}`, background: C.win, color: C.sub, fontWeight: 800, cursor: "pointer", fontFamily: "inherit" }}>닫기</button>
            </div>
            {logView(true)}
          </div>
        </div>
      )}
    </div>
  );
}
