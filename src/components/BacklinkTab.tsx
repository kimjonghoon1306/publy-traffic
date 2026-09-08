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
  // ★2026-09-07 테리: '이어하기' 제거 — 그만두면 완전 취소, 다시 시작하면 처음부터(유니크 스킵은 서버가 이미 처리)
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
  // 🔑 GitHub 키 (본인키/관리자 공용키) — 빙키와 동일 개념. 본인키 넣으면 내 GitHub 계정에 게시(관리자키 대신).
  const [ghScope, setGhScope] = useState<string>("admin");   // admin=공용키 / own=본인키
  const [ghHasKey, setGhHasKey] = useState(false);
  const [ghInput, setGhInput] = useState("");
  const [ghMsg, setGhMsg] = useState("");
  const [ghOpen, setGhOpen] = useState(false);
  // 🎛️ 컨트롤타워 탭 (2026-09-07: 카드 세로나열 → 탭 분리로 시원하게)
  const [ctTab, setCtTab] = useState<"run" | "report" | "keys" | "domains">("run");
  // 🖥️📱 뷰 토글 — PC에서 모바일 미리보기(모바일폭으로 좁힘). 기본 auto(반응형).
  const [viewMode, setViewMode] = useState<"auto" | "mobile">("auto");
  // 🤖 제미나이 키 + 키워드 (사이트 읽고 고품질 글 생성)
  const [gemMasked, setGemMasked] = useState<string | null>(null);
  const [gemInput, setGemInput] = useState("");
  const [gemMsg, setGemMsg] = useState("");
  const [gemOpen, setGemOpen] = useState(false);
  const [kwInput, setKwInput] = useState("");
  const [kwMsg, setKwMsg] = useState("");
  // 📊 내 백링크 기록(기간설정) — 언제 몇 건 배포·색인됐는지(소스·URL 비노출, 집계만)
  const [histOpen, setHistOpen] = useState(false);
  const [histFrom, setHistFrom] = useState("");
  const [histTo, setHistTo] = useState("");
  const [histRows, setHistRows] = useState<{ day: string; posted: number; indexed: number }[] | null>(null);
  const [histLoading, setHistLoading] = useState(false);

  // 🕒 자동 발송(스케줄러 옵트인) — 도메인별 ON/OFF + 발송 내역(링크 없이 발송여부만)
  const [autoOn, setAutoOn] = useState(false);
  const [autoBusy, setAutoBusy] = useState(false);
  const [autoStat, setAutoStat] = useState<{ last_run_at: string | null; today: number; week: number; runs: { at: string; posted: number; indexed: number }[] } | null>(null);

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

  // 🔑 GitHub 키 상태 로드(있는지/scope만, 원문 비노출)
  const loadMyGithub = useCallback(async () => {
    try {
      const { data, error } = await supabase.rpc("backlink_my_github", { p_token: token });
      if (error) return;   // 조회 실패 시 기존 상태 유지(관리자키로 위장 금지)
      const r = (data && data[0]) || null;
      setGhScope(r?.scope || "admin"); setGhHasKey(!!r?.has_key);
    } catch {}
  }, [token]);

  // 🔑 GitHub 본인키 저장/삭제 (넣으면 own, 비우면 관리자 공용키)
  const saveMyGithub = useCallback(async () => {
    const v = ghInput.trim();
    if (!v) { setGhMsg("GitHub 토큰(ghp_로 시작)을 붙여넣으세요"); setTimeout(() => setGhMsg(""), 3500); return; }
    const { error } = await supabase.rpc("backlink_set_my_github", { p_token: token, p_key: v });
    if (error) { setGhMsg("저장 실패: " + error.message); return; }
    setGhMsg("✅ 내 GitHub 키로 전환했어요 — 이제 내 계정에 게시해요"); setGhInput(""); loadMyGithub(); setTimeout(() => setGhMsg(""), 4000);
  }, [ghInput, token, loadMyGithub]);

  const clearMyGithub = useCallback(async () => {
    const { error } = await supabase.rpc("backlink_set_my_github", { p_token: token, p_key: "" });
    if (error) { setGhMsg("실패: " + error.message); setTimeout(() => setGhMsg(""), 3500); return; }
    setGhMsg("관리자 공용 키로 돌아갔어요"); loadMyGithub(); setTimeout(() => setGhMsg(""), 3500);
  }, [token, loadMyGithub]);

  // 🤖 제미나이 키 상태 로드
  const loadGemKey = useCallback(async () => {
    try {
      const { data } = await supabase.rpc("backlink_my_gemini", { p_token: token });
      const r = (data && data[0]) || null;
      setGemMasked(r?.key_masked || null);
    } catch {}
  }, [token]);
  const saveGemKey = useCallback(async () => {
    const v = gemInput.trim();
    if (!v) { setGemMsg("발급받은 제미나이 키를 붙여넣으세요"); setTimeout(() => setGemMsg(""), 3500); return; }
    const { error } = await supabase.rpc("backlink_set_my_gemini", { p_token: token, p_key: v });
    if (error) { setGemMsg("저장 실패: " + error.message); return; }
    setGemMsg("✅ 제미나이 키 저장 완료 — 이제 사이트를 읽고 고품질 글로 백링크해요"); setGemInput(""); loadGemKey(); setTimeout(() => setGemMsg(""), 4000);
  }, [gemInput, token, loadGemKey]);
  const clearGemKey = useCallback(async () => {
    await supabase.rpc("backlink_set_my_gemini", { p_token: token, p_key: "" });
    setGemMasked(null); setGemMsg("제미나이 키를 삭제했어요(기본 글로 게시)"); loadGemKey(); setTimeout(() => setGemMsg(""), 4000);
  }, [token, loadGemKey]);
  const loadHist = useCallback(async () => {
    setHistLoading(true);
    try {
      const p_from = histFrom ? new Date(histFrom).toISOString() : null;
      const p_to = histTo ? new Date(new Date(histTo).getTime() + 86400000).toISOString() : null;   // 종료일 포함(+1일)
      const { data, error } = await supabase.rpc("backlink_my_history", { p_token: token, p_from, p_to });
      if (error) { setHistRows([]); }
      else setHistRows((data || []).map((r: any) => ({ day: r.day, posted: Number(r.posted || 0), indexed: Number(r.indexed || 0) })));
    } catch { setHistRows([]); }
    finally { setHistLoading(false); }
  }, [token, histFrom, histTo]);

  const saveKeyword = useCallback(async () => {
    const { error } = await supabase.rpc("backlink_set_my_keyword", { p_token: token, p_keyword: kwInput.trim() });
    if (error) { setKwMsg("저장 실패: " + error.message); return; }
    setKwMsg(kwInput.trim() ? "✅ 키워드 저장 — 제목·본문·앵커에 자연스럽게 반영돼요" : "✅ 키워드를 비웠어요"); setTimeout(() => setKwMsg(""), 4000);
  }, [kwInput, token]);

  // 🕒 자동 발송 현황 로드(선택 도메인 기준) + 토글
  const loadAuto = useCallback(async () => {
    if (!token || !sel) { setAutoStat(null); return; }
    try {
      const { data } = await supabase.rpc("backlink_my_auto_status", { p_token: token, p_order_id: sel });
      if (data) { setAutoOn(!!data.auto_send); setAutoStat({ last_run_at: data.last_run_at ?? null, today: Number(data.today || 0), week: Number(data.week || 0), runs: Array.isArray(data.runs) ? data.runs : [] }); }
    } catch { /* 무시 */ }
  }, [token, sel]);
  const toggleAuto = useCallback(async (on: boolean) => {
    if (!token || !sel || autoBusy) return;
    setAutoBusy(true);
    const { error } = await supabase.rpc("backlink_my_set_auto_send", { p_token: token, p_order_id: sel, p_on: on });
    setAutoBusy(false);
    if (!error) {
      setAutoOn(on); loadAuto();
      // 🕒 켜고 끌 때 로그에 명확히 안내(테리: "켜짐이라는 안내도 6시간마다 5개 설명도 안 뜬다")
      const dom = subs.find(s => s.id === sel)?.target_domain || "이 도메인";
      if (on) pushLog("index", `🕒 자동 발송 켜짐 — 지금부터 [${dom}]은(는) 앱을 안 켜도 6시간마다 5개씩 자동으로 발송돼요(하루 최대 20개). 끄면 즉시 멈춰요.`);
      else pushLog("warn", `⏸ 자동 발송 꺼짐 — [${dom}] 자동 발송을 멈췄어요. 필요하면 언제든 다시 켤 수 있어요.`);
    } else {
      pushLog("fail", `자동 발송 변경 실패: ${error.message}`);
    }
  }, [token, sel, autoBusy, loadAuto, subs, pushLog]);

  useEffect(() => { loadSubs(); loadMyKey(); loadGemKey(); loadMyGithub(); const iv = setInterval(loadSubs, 20000); return () => clearInterval(iv); }, [loadSubs, loadMyKey, loadGemKey, loadMyGithub]);
  useEffect(() => { if (logBoxRef.current) logBoxRef.current.scrollTop = logBoxRef.current.scrollHeight; }, [logs]);
  useEffect(() => () => { esRef.current?.close(); }, []);
  // 📊 성과 탭 처음 열면 자동으로 기록 로드(빈 화면 방지)
  useEffect(() => { if (ctTab === "report" && histRows == null) loadHist(); }, [ctTab, histRows, loadHist]);
  // 🕒 발송 탭 열리거나 도메인 바뀌면 자동발송 현황 로드(탭 이동해도 재조회)
  useEffect(() => { if (ctTab === "run" && sel) loadAuto(); }, [ctTab, sel, loadAuto]);

  const cur = subs.find(s => s.id === sel);
  const unlimited = (cur?.plan === "unlimited") || (cur?.daily_limit === 0);
  const remainToday = unlimited ? 999 : Math.max(0, (cur?.daily_limit ?? 0) - (cur?.today_posted ?? 0));
  const QTY_MAX = 50;                                                     // 한 번에 발송 상한(락) — 초과 입력 차단
  const qtyMax = unlimited ? QTY_MAX : Math.min(QTY_MAX, remainToday);    // 무제한=50, 제한=min(50, 남은한도)

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
    const want = Math.min(QTY_MAX, unlimited ? Math.max(1, qty) : Math.min(qty, remainToday));  // 한 번에 최대 50(락)
    if (!unlimited && remainToday <= 0) { pushLog("warn", "오늘 발송 한도를 다 썼어요 — 자정에 초기화돼요."); return; }
    setRunning(true); setLogs([]);   // 항상 새로 시작(로그 초기화)
    pushLog("wait", `준비 중… ${cur.target_domain}에 ${want}개 발송을 시작합니다 (지금 바로 = 수동 발송)`);
    // 🕒 자동 발송이 켜져 있으면, 이 수동 발송과 별개로 6시간마다도 계속 나간다는 걸 알려준다(테리: 헷갈리지 않게 디테일하게)
    if (autoOn) pushLog("index", `🕒 이 도메인은 자동 발송도 켜져 있어요 — 이 수동 발송과 별개로 6시간마다 5개씩 자동으로도 나가요.`);
    // 🔑 색인키 출처를 로그에 명확히(테리: 본인키/관리자키 구분 이쁘게). 소스·주소는 비노출, 키 출처만.
    if (isAdminKey) pushLog("index", "🔑 관리자 빙(색인)키가 입력되어 있어요 — 관리자 키로 색인합니다");
    else if (keyMasked) pushLog("index", "🔑 본인 빙(색인)키를 입력하셨어요 — 내 키로 색인합니다");
    else if (keyWaiting) pushLog("wait", "🔑 색인키 대기 중 — 게시는 진행되고, 키를 넣으면 색인이 시작돼요");
    else pushLog("wait", "🔑 아직 색인키가 없어요 — [🔑 색인 키]에 넣으면 빙 검색 반영이 빨라져요");
    const url = `${BOT}/member-publish-stream?token=${encodeURIComponent(token)}&orderId=${encodeURIComponent(cur.id)}&targetDomain=${encodeURIComponent(cur.target_domain)}&count=${want}`;
    const es = new EventSource(url);
    esRef.current = es;
    es.onmessage = (e) => {
      try {
        const d = JSON.parse(e.data);
        if (d.type === "log") pushLog(d.kind || "wait", d.msg);
        else if (d.type === "error") { pushLog("fail", "❌ " + d.msg); es.close(); setRunning(false); }
        else if (d.type === "done") { pushLog("done", `🎉 발송 완료 — 이번에 ${d.posted}개 게시됐어요`); if (autoOn) pushLog("index", `🕒 자동 발송이 켜져 있어 앞으로도 6시간마다 5개씩 계속 나가요.`); es.close(); setRunning(false); loadSubs(); loadAuto(); }
      } catch {}
    };
    es.onerror = () => { pushLog("fail", "❌ 연결 오류 — 봇 서버(3374)를 확인해주세요"); es.close(); setRunning(false); };
  }, [cur, running, unlimited, qty, remainToday, token, pushLog, loadSubs, isAdminKey, keyMasked, keyWaiting, autoOn, loadAuto]);

  const stopPublish = useCallback(() => { esRef.current?.close(); setRunning(false); pushLog("warn", "⏹ 그만뒀어요 — 설정을 바꾼 뒤 다시 시작하면 처음부터 진행돼요"); }, [pushLog]);

  const saveMyKey = useCallback(async () => {
    const v = keyInput.trim();
    // 내 키로 전환/저장은 키가 있어야. 관리자키 상태서 빈 값으로 누르면 안내(해제는 아래 별도 버튼).
    if (!v) { setKeyMsg(isAdminKey ? "내 키로 바꾸려면 발급받은 키(32자리)를 붙여넣으세요" : "색인 키를 붙여넣으세요"); setTimeout(() => setKeyMsg(""), 3500); return; }
    const { error } = await supabase.rpc("backlink_set_my_indexnow", { p_token: token, p_key: v });
    if (error) { setKeyMsg("저장 실패: " + error.message); return; }
    setKeyMsg(isAdminKey ? "✅ 내 키로 전환했어요 — 이제 내 키로 색인해요" : "✅ 색인 키 저장 완료"); setKeyInput(""); loadMyKey(); setTimeout(() => setKeyMsg(""), 4000);
    pushLog("index", "🔑 본인 빙(색인)키를 입력하셨어요 — 이제 내 키로 색인합니다");
  }, [keyInput, token, loadMyKey, isAdminKey]);

  // 본인키 삭제(대기) / 관리자키 해제(내가 직접) — 둘 다 scope='own'+키비움(=색인 대기). 관리자는 필요시 공용키 재지정 가능.
  const clearMyKey = useCallback(async () => {
    const wasAdmin = isAdminKey;
    await supabase.rpc("backlink_set_my_indexnow", { p_token: token, p_key: "" });
    setKeyMasked(null); setKeyMsg(wasAdmin ? "관리자키를 해제했어요 — 내 키를 넣거나 대기로 둘 수 있어요" : "키를 삭제했어요"); loadMyKey(); setTimeout(() => setKeyMsg(""), 4000);
  }, [token, loadMyKey, isAdminKey]);

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

  // 🎛️ 컨트롤타워 탭 네비 (모바일 퍼스트: 가로 스크롤 칩)
  const CT_TABS: { k: typeof ctTab; label: string }[] = [
    { k: "run", label: "🚀 발송" },
    { k: "report", label: "📊 성과" },
    { k: "keys", label: "🔑 키 설정" },
    { k: "domains", label: "🌐 도메인" },
  ];
  const tabBtn = (active: boolean): React.CSSProperties => ({
    flex: "1 1 auto", minWidth: 76, padding: "11px 10px", borderRadius: 10, border: "none",
    background: active ? C.accent : C.panel, color: active ? "#fff" : C.sub,
    fontSize: 13.5, fontWeight: 800, cursor: "pointer", fontFamily: "inherit", whiteSpace: "nowrap",
  });

  return (
    <div style={{ maxWidth: viewMode === "mobile" ? 460 : "none", margin: viewMode === "mobile" ? "0 auto" : undefined, transition: "max-width .2s" }}>
      {/* ── 🖥️📱 뷰 토글 (PC에서 모바일 미리보기) ── */}
      <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 8, gap: 6 }}>
        <button onClick={() => setViewMode(v => v === "auto" ? "mobile" : "auto")} title="PC에서 모바일 화면으로 미리보기" style={{ padding: "6px 12px", borderRadius: 8, border: `1.5px solid ${C.line}`, background: C.panel, color: C.sub, fontSize: 12, fontWeight: 800, cursor: "pointer", fontFamily: "inherit" }}>
          {viewMode === "mobile" ? "📱 모바일 보기" : "🖥️ 넓게 보기"}
        </button>
      </div>
      {/* ── 🎛️ 상단: 대상 도메인 요약 (항상 보임) ── */}
      {cur && (
        <div style={card({ marginBottom: 10 })}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <span style={{ width: 4, height: 18, borderRadius: 2, background: C.accent }} />
            <b style={{ fontSize: 15, color: C.ink }}>{cur.target_domain}</b>
            <span style={chip(C.soft, C.accent)}>{PLAN_LABEL[cur.plan] || cur.plan}{unlimited ? " · 무제한" : ` · 하루 ${cur.daily_limit}`}</span>
            {running && <span style={chip(logC.post.bg, logC.post.fg)}>발송 중…</span>}
            <div style={{ marginLeft: "auto", display: "flex", gap: 12, fontSize: 12, fontWeight: 700, color: C.sub }}>
              <span>누적 <b style={{ color: logC.post.fg }}>{cur.total_posted}</b></span>
              <span>색인 <b style={{ color: logC.done.fg }}>{cur.indexed}</b></span>
            </div>
          </div>
          {/* 🔀 도메인 전환 — 여러 도메인이면 여기서 바로 바꿔요(발송·성과 화면이 통째로 그 도메인 걸로 갱신) */}
          {subs.length > 1 && (
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 10, alignItems: "center" }}>
              <span style={{ fontSize: 11.5, fontWeight: 800, color: C.sub }}>🔀 도메인 선택:</span>
              {subs.map(s => {
                const on = s.id === sel;
                return (
                  <button key={s.id} onClick={() => { if (running) return; setSel(s.id); }} disabled={running} title={running ? "발송 중엔 바꿀 수 없어요" : "이 도메인으로 전환"}
                    style={{ padding: "5px 12px", borderRadius: 99, border: `1.5px solid ${on ? C.accent : C.line}`, background: on ? C.accent : C.panel, color: on ? "#fff" : C.sub, fontSize: 12, fontWeight: 800, cursor: running ? "default" : "pointer", fontFamily: "inherit", opacity: running && !on ? 0.5 : 1 }}>
                    {on ? "✓ " : ""}{s.target_domain}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ── 🎛️ 탭 네비 ── */}
      <div style={{ display: "flex", gap: 6, marginBottom: 12, overflowX: "auto" }}>
        {CT_TABS.map(t => <button key={t.k} onClick={() => setCtTab(t.k)} style={tabBtn(ctTab === t.k)}>{t.label}</button>)}
      </div>

      {/* ── 🌐 도메인 탭 ── */}
      <div style={{ display: ctTab === "domains" ? "block" : "none" }}>
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
      </div>{/* /🌐 도메인 탭 */}

      {cur && (<>
        {/* ── 🚀 발송 탭 (현황+시작하기 + 로그) ── */}
        <div style={{ display: ctTab === "run" ? "block" : "none" }}>
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
          {/* 신뢰 캡션 — '색인 반영'이 빙 실측임을 회원에게(소스·주소는 비공개). */}
          <div style={{ fontSize: 11.5, fontWeight: 700, color: logC.done.fg, background: logC.done.bg, borderRadius: 10, padding: "8px 11px", marginBottom: 14, lineHeight: 1.5 }}>
            🔗 <b>색인 반영</b> = 발행된 백링크가 <b>빙(Bing)에서 실제로 검색·색인된 게 확인된</b> 건수예요. (검색엔진 반영엔 며칠 걸릴 수 있어요)
          </div>
          {/* 수량 지정 + 시작 */}
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", padding: 12, borderRadius: 12, background: C.panel, border: `1px solid ${C.line}` }}>
            <span style={{ fontSize: 13, fontWeight: 800, color: C.ink }}>이 도메인에 백링크</span>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <button onClick={() => setQty(q => Math.max(1, q - 1))} disabled={running} style={{ width: 32, height: 32, borderRadius: 8, border: `1px solid ${C.line}`, background: C.win, color: C.ink, fontSize: 18, fontWeight: 900, cursor: "pointer" }}>−</button>
              <input type="number" value={qty} min={1} max={qtyMax || 1} onChange={e => setQty(Math.max(1, Math.min(qtyMax || 1, Number(e.target.value) || 1)))} disabled={running} style={{ width: 60, textAlign: "center", ...inputStyle, padding: "8px" }} />
              <button onClick={() => setQty(q => Math.min(qtyMax || 1, q + 1))} disabled={running || qty >= (qtyMax || 1)} style={{ width: 32, height: 32, borderRadius: 8, border: `1px solid ${C.line}`, background: C.win, color: C.ink, fontSize: 18, fontWeight: 900, cursor: "pointer" }}>＋</button>
              <span style={{ fontSize: 13, fontWeight: 700, color: C.sub }}>개</span>
            </div>
            {!unlimited && <button onClick={() => setQty(remainToday)} disabled={running || remainToday <= 0} style={{ padding: "6px 10px", borderRadius: 8, border: `1px solid ${C.line}`, background: C.win, color: C.accent, fontSize: 12, fontWeight: 800, cursor: "pointer" }}>남은 만큼 ({remainToday})</button>}
            <div style={{ flex: 1 }} />
            {running
              ? <button onClick={stopPublish} style={{ padding: "12px 22px", borderRadius: 10, border: "none", background: "#dc2626", color: "#fff", fontWeight: 900, fontSize: 14, cursor: "pointer", fontFamily: "inherit" }}>⏹ 그만두기</button>
              : <button onClick={startPublish} disabled={!unlimited && remainToday <= 0} style={{ padding: "12px 24px", borderRadius: 10, border: "none", background: (!unlimited && remainToday <= 0) ? C.line : `linear-gradient(135deg,${C.accent},#8b5cf6)`, color: "#fff", fontWeight: 900, fontSize: 14, cursor: (!unlimited && remainToday <= 0) ? "default" : "pointer", fontFamily: "inherit" }}>🚀 백링크 시작하기</button>}
          </div>
        </div>

        {/* ── 🕒 자동 발송(스케줄러 옵트인) ── */}
        <div style={card({ marginBottom: 12 })}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
            <b style={{ fontSize: 15, color: C.ink }}>🕒 자동 발송</b>
            <div style={{ flex: 1 }} />
            <label style={{ display: "inline-flex", alignItems: "center", cursor: autoBusy ? "default" : "pointer" }} title="6시간마다 자동으로 발송">
              <input type="checkbox" checked={autoOn} disabled={autoBusy} onChange={e => toggleAuto(e.target.checked)} style={{ display: "none" }} />
              <span style={{ width: 52, height: 30, borderRadius: 99, background: autoOn ? C.accent : C.line, position: "relative", transition: "background .2s", display: "inline-block" }}>
                <span style={{ position: "absolute", top: 3, left: autoOn ? 25 : 3, width: 24, height: 24, borderRadius: "50%", background: "#fff", transition: "left .2s", boxShadow: "0 1px 3px rgba(0,0,0,.3)" }} />
              </span>
              <span style={{ marginLeft: 8, fontSize: 13, fontWeight: 800, color: autoOn ? C.accent : C.sub }}>{autoOn ? "켜짐" : "꺼짐"}</span>
            </label>
          </div>
          <div style={{ fontSize: 12, color: C.sub, fontWeight: 600, lineHeight: 1.6, background: C.panel, border: `1px solid ${C.line}`, borderRadius: 10, padding: "9px 11px", marginBottom: 10 }}>
켜두면 앱을 안 켜도 <b style={{ color: C.accent }}>자동발송은 6시간마다 5개씩 진행됩니다.</b> 하루 4번(최대 20개) 자동으로 쌓이고, 끄면 즉시 멈춰요. (도메인마다 따로 켤 수 있어요)
          </div>
          {/* 자동발송 내역 — 링크 없이 발송 여부·시각·개수만 */}
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: (autoStat && autoStat.runs.length) ? 10 : 0 }}>
            <span style={chip(C.soft, C.accent)}>마지막 자동발송: {autoStat?.last_run_at ? new Date(autoStat.last_run_at).toLocaleString("ko-KR", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }) : "아직 없음"}</span>
            <span style={chip(C.soft, C.ink)}>오늘 {autoStat?.today ?? 0}개</span>
            <span style={chip(C.soft, C.ink)}>이번주 {autoStat?.week ?? 0}개</span>
          </div>
          {autoStat && autoStat.runs.length > 0 && (
            <div style={{ maxHeight: 170, overflowY: "auto", display: "flex", flexDirection: "column", gap: 6 }}>
              {autoStat.runs.map((r, i) => (
                <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, fontWeight: 700, color: C.sub, padding: "7px 10px", borderRadius: 8, background: C.panel }}>
                  <span>🕒</span>
                  <span style={{ color: C.ink }}>{new Date(r.at).toLocaleString("ko-KR", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })}</span>
                  <span style={{ flex: 1 }} />
                  <span style={{ color: logC.post.fg }}>{r.posted}개 발송</span>
                  {r.indexed > 0 && <span style={{ color: logC.done.fg }}>· 색인 {r.indexed}</span>}
                  <span>✅</span>
                </div>
              ))}
            </div>
          )}
          {autoOn && autoStat && autoStat.runs.length === 0 && (
            <div style={{ fontSize: 12, color: C.sub, fontWeight: 600 }}>아직 자동발송 기록이 없어요 — 다음 자동 실행(6시간마다) 때부터 여기 쌓여요.</div>
          )}
        </div>
        </div>{/* /🚀 발송 탭(현황+시작) */}

        {/* ── 🔑 키 설정 탭 (제미나이·GitHub·색인) ── */}
        <div style={{ display: ctTab === "keys" ? "block" : "none" }}>
        {/* ── 🤖 제미나이 키(AI 글생성) ── */}
        <div style={card({ marginBottom: 12, border: `1px solid ${gemMasked ? "#16a34a55" : C.line}` })}>
          <div onClick={() => setGemOpen(o => !o)} style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", flexWrap: "wrap" }}>
            <b style={{ fontSize: 14, color: C.ink }}>🤖 제미나이(AI) 키 <span style={{ fontSize: 11, color: C.sub, fontWeight: 600 }}>· 내 사이트를 읽고 좋은 글로 백링크</span></b>
            <span style={{ marginLeft: "auto", ...chip(gemMasked ? logC.post.bg : C.panel, gemMasked ? logC.post.fg : C.sub) }}>{gemMasked ? "키 등록됨 🟢" : "키 없음(기본 글)"}</span>
            <span style={{ color: C.sub, fontSize: 13 }}>{gemOpen ? "▲" : "▼"}</span>
          </div>
          {gemOpen && (
            <div style={{ marginTop: 12 }}>
              <div style={{ fontSize: 12.5, color: C.ink, lineHeight: 1.8, marginBottom: 10, padding: "11px 13px", borderRadius: 10, background: gemMasked ? logC.post.bg : C.panel, border: `1px solid ${C.line}` }}>
                {gemMasked
                  ? <><b style={{ color: logC.post.fg }}>🟢 제미나이 키가 등록돼 있어요</b> <span style={{ color: logC.post.fg }}>({gemMasked})</span><br /><span style={{ color: C.sub }}>도메인을 넣으면 AI가 <b>내 사이트를 읽고</b> 소스마다 다른 자연스러운 글을 써서 백링크해요(상위노출·AI 인용에 유리).</span></>
                  : <><b>💡 왜 필요한가요?</b> 상위노출·AI 인용은 <b style={{ color: C.ink }}>글 내용이 좋아야</b> 돼요. 제미나이 키를 넣으면 AI가 <b>내 사이트를 읽고</b> 진짜 추천글처럼 써줘요. <b>무료</b>로 발급받을 수 있어요.</>}
              </div>
              <button onClick={() => { try { window.open("https://aistudio.google.com/apikey", "_blank"); } catch {} }}
                style={{ width: "100%", padding: "12px", borderRadius: 10, border: `1.5px solid ${C.accent}`, background: C.soft, color: C.accent, fontWeight: 900, fontSize: 13.5, cursor: "pointer", marginBottom: 10 }}>
                🔷 제미나이 키 무료 발급받기 (Google AI Studio 열기) ↗
              </button>
              <div style={{ fontSize: 12, color: C.ink, lineHeight: 2, marginBottom: 10, padding: "11px 13px", borderRadius: 10, background: C.panel, border: `1px solid ${C.line}` }}>
                <b>📋 발급 3단계</b><br />
                <b style={{ color: C.accent }}>1.</b> 위 버튼으로 <b>Google AI Studio</b> 접속(구글 로그인)<br />
                <b style={{ color: C.accent }}>2.</b> <b>Create API key</b> → 키 복사<br />
                <b style={{ color: C.accent }}>3.</b> 아래에 붙여넣고 저장
              </div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
                <input value={gemInput} onChange={e => setGemInput(e.target.value)} placeholder={gemMasked ? "새 키로 바꾸려면 여기에 붙여넣기(덮어쓰기)" : "발급받은 제미나이 키 붙여넣기"} style={{ ...inputStyle, flex: 1, minWidth: 160, fontSize: 13.5 }} />
                <button onClick={saveGemKey} style={{ padding: "12px 18px", borderRadius: 10, border: "none", background: C.accent, color: "#fff", fontWeight: 800, fontSize: 13.5, cursor: "pointer" }}>{gemMasked ? "변경(덮어쓰기)" : "저장"}</button>
                {gemMasked && <button onClick={clearGemKey} style={{ padding: "12px 16px", borderRadius: 10, border: `1px solid ${logC.fail.fg}`, background: C.win, color: logC.fail.fg, fontWeight: 800, fontSize: 13.5, cursor: "pointer" }}>삭제</button>}
              </div>
              {gemMasked && <div style={{ fontSize: 11.5, color: C.sub, fontWeight: 600, marginBottom: 10, marginTop: -4 }}>🔁 키를 <b>바꾸려면</b> 새 키를 붙여넣고 <b>변경(덮어쓰기)</b>, <b>지우려면</b> <b style={{ color: logC.fail.fg }}>삭제</b>를 누르세요.</div>}
              {gemMsg && <div style={{ fontSize: 12, color: logC.post.fg, fontWeight: 700, marginBottom: 10 }}>{gemMsg}</div>}
              {/* 키워드(선택) */}
              <div style={{ fontSize: 12.5, color: C.ink, fontWeight: 700, marginBottom: 6 }}>🎯 상위노출 키워드 <span style={{ color: C.sub, fontWeight: 600 }}>(선택 · 뜨고 싶은 검색어)</span></div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <input value={kwInput} onChange={e => setKwInput(e.target.value)} placeholder="예: 산지직송 굴비, 강원도 특산물" style={{ ...inputStyle, flex: 1, minWidth: 160, fontSize: 13.5 }} />
                <button onClick={saveKeyword} style={{ padding: "12px 18px", borderRadius: 10, border: `1.5px solid ${C.accent}`, background: C.soft, color: C.accent, fontWeight: 800, fontSize: 13.5, cursor: "pointer" }}>저장</button>
              </div>
              <div style={{ fontSize: 11, color: C.sub, marginTop: 6 }}>키워드를 넣으면 글 제목·본문·링크 앵커에 자연스럽게 반영돼 구글이 "이 도메인 = 이 키워드"로 학습해요.</div>
              {kwMsg && <div style={{ fontSize: 12, color: logC.post.fg, fontWeight: 700, marginTop: 8 }}>{kwMsg}</div>}
            </div>
          )}
        </div>

        {/* ── 🔑 GitHub 키 (본인키 / 관리자 공용키) ── */}
        <div style={card({ marginBottom: 12, border: `1px solid ${ghScope === "own" && ghHasKey ? "#16a34a55" : C.line}` })}>
          <div onClick={() => setGhOpen(o => !o)} style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", flexWrap: "wrap" }}>
            <b style={{ fontSize: 14, color: C.ink }}>🔑 GitHub 키 <span style={{ fontSize: 11, color: C.sub, fontWeight: 600 }}>· 내 계정에 백링크 게시(더 자연스러움)</span></b>
            <span style={{ marginLeft: "auto", ...chip(ghScope === "own" && ghHasKey ? logC.post.bg : (ghScope === "own" && !ghHasKey ? logC.warn.bg : C.panel), ghScope === "own" && ghHasKey ? logC.post.fg : (ghScope === "own" && !ghHasKey ? logC.warn.fg : C.sub)) }}>
              {ghScope === "own" && ghHasKey ? "내 키 등록됨 🟢" : (ghScope === "own" && !ghHasKey ? "본인키 대기 🟡" : "관리자 공용 키 사용 중")}
            </span>
            <span style={{ color: C.sub, fontSize: 13 }}>{ghOpen ? "▲" : "▼"}</span>
          </div>
          {ghOpen && (
            <div style={{ marginTop: 12 }}>
              <div style={{ fontSize: 12.5, color: C.ink, lineHeight: 1.8, marginBottom: 10, padding: "11px 13px", borderRadius: 10, background: ghScope === "own" && ghHasKey ? logC.post.bg : C.panel, border: `1px solid ${C.line}` }}>
                {ghScope === "own" && ghHasKey
                  ? <><b style={{ color: logC.post.fg }}>🟢 내 GitHub 키로 게시 중</b><br /><span style={{ color: C.sub }}>백링크가 <b>내 GitHub 계정</b>에 올라가요. 계정마다 링크가 달라 구글이 더 자연스럽게 봐요.</span></>
                  : <><b>💡 지금은 관리자 공용 키로 게시돼요.</b> 내 GitHub 키를 넣으면 <b>내 계정</b>에 올라가서 더 자연스럽고, 게시 한도도 내 것으로 늘어나요. <b>무료</b>예요(선택).</>}
              </div>
              <button onClick={() => { try { window.open("https://github.com/settings/tokens", "_blank"); } catch {} }}
                style={{ width: "100%", padding: "12px", borderRadius: 10, border: `1.5px solid ${C.accent}`, background: C.soft, color: C.accent, fontWeight: 900, fontSize: 13.5, cursor: "pointer", marginBottom: 10 }}>
                🔷 GitHub 키 발급받기 (설정 → 토큰 열기) ↗
              </button>
              <div style={{ fontSize: 12, color: C.ink, lineHeight: 2, marginBottom: 10, padding: "11px 13px", borderRadius: 10, background: C.panel, border: `1px solid ${C.line}` }}>
                <b>📋 발급 방법</b><br />
                <b style={{ color: C.accent }}>1.</b> GitHub 로그인 → 위 버튼(설정→토큰)<br />
                <b style={{ color: C.accent }}>2.</b> <b>Generate new token (classic)</b><br />
                <b style={{ color: C.accent }}>3.</b> 권한은 <b>gist</b>만 체크, 만료 <b>No expiration</b><br />
                <b style={{ color: C.accent }}>4.</b> 생성된 <b>ghp_…</b> 키 복사 → 아래 붙여넣기
              </div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 8 }}>
                <input value={ghInput} onChange={e => setGhInput(e.target.value)} placeholder={ghScope === "own" && ghHasKey ? "새 키로 바꾸려면 붙여넣기(덮어쓰기)" : "발급받은 ghp_… 키 붙여넣기"} style={{ ...inputStyle, flex: 1, minWidth: 160, fontSize: 13.5 }} />
                <button onClick={saveMyGithub} style={{ padding: "12px 18px", borderRadius: 10, border: "none", background: C.accent, color: "#fff", fontWeight: 800, fontSize: 13.5, cursor: "pointer" }}>{ghScope === "own" && ghHasKey ? "변경" : "저장"}</button>
                {ghScope === "own" && ghHasKey && <button onClick={clearMyGithub} style={{ padding: "12px 16px", borderRadius: 10, border: `1px solid ${logC.fail.fg}`, background: C.win, color: logC.fail.fg, fontWeight: 800, fontSize: 13.5, cursor: "pointer" }}>공용키로</button>}
              </div>
              {ghMsg && <div style={{ fontSize: 12, color: logC.post.fg, fontWeight: 700 }}>{ghMsg}</div>}
            </div>
          )}
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
                  <span style={{ color: C.sub }}>아무것도 안 해도 돼요. <b style={{ color: C.ink }}>내 키를 쓰고 싶으면</b> 아래에 발급받은 키를 붙여넣고 <b style={{ color: C.ink }}>[내 키로 전환]</b> — 관리자키 대신 내 키가 쓰여요. 관리자키만 빼고 직접 관리하려면 <b style={{ color: C.ink }}>[관리자키 해제]</b>.</span>
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
                <input value={keyInput} onChange={e => setKeyInput(e.target.value)} placeholder={isAdminKey ? "내 키로 바꾸려면 여기에 붙여넣기(32자리)" : (keyMasked ? "본인 키로 바꾸려면 붙여넣기" : "발급받은 색인 키 붙여넣기")} style={{ ...inputStyle, flex: 1, minWidth: 160, fontSize: 13.5 }} />
                <button onClick={saveMyKey} style={{ padding: "12px 18px", borderRadius: 10, border: "none", background: C.accent, color: "#fff", fontWeight: 800, fontSize: 13.5, cursor: "pointer" }}>{isAdminKey ? "내 키로 전환" : "내 키 넣기"}</button>
                {keyMasked && <button onClick={clearMyKey} style={{ padding: "12px 16px", borderRadius: 10, border: `1px solid ${logC.fail.fg}`, background: C.win, color: logC.fail.fg, fontWeight: 800, fontSize: 13.5, cursor: "pointer" }}>{isAdminKey ? "관리자키 해제" : "삭제"}</button>}
              </div>
              {keyMsg && <div style={{ fontSize: 12, color: logC.post.fg, fontWeight: 700, marginTop: 8 }}>{keyMsg}</div>}
            </div>
          )}
        </div>
        </div>{/* /🔑 키 설정 탭 */}

        {/* ── 📊 성과 탭 (기간별 기록) ── */}
        <div style={{ display: ctTab === "report" ? "block" : "none" }}>
        <div style={card({ marginBottom: 12 })}>
          <div style={{ fontWeight: 900, fontSize: 14, marginBottom: 4, display: "flex", alignItems: "center", gap: 8, color: C.ink }}>
            <span style={{ width: 4, height: 15, borderRadius: 2, background: C.accent }} />📊 내 백링크 기록
            <span style={{ fontSize: 11, color: C.sub, fontWeight: 600 }}>· 언제 몇 건 배포·색인됐는지(기간설정)</span>
          </div>
          {(() => {
            const rows = histRows || [];
            const tot = rows.reduce((a, r) => ({ p: a.p + r.posted, i: a.i + r.indexed }), { p: 0, i: 0 });
            const maxP = Math.max(1, ...rows.map(r => r.posted));
            return <div style={{ marginTop: 12 }}>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginBottom: 12 }}>
                <input type="date" value={histFrom} onChange={e => setHistFrom(e.target.value)} style={{ ...inputStyle, fontSize: 12.5, padding: "9px 10px" }} />
                <span style={{ color: C.sub }}>~</span>
                <input type="date" value={histTo} onChange={e => setHistTo(e.target.value)} style={{ ...inputStyle, fontSize: 12.5, padding: "9px 10px" }} />
                <button onClick={loadHist} disabled={histLoading} style={{ padding: "9px 16px", borderRadius: 10, border: "none", background: C.accent, color: "#fff", fontWeight: 800, fontSize: 13, cursor: histLoading ? "default" : "pointer", opacity: histLoading ? .6 : 1 }}>{histLoading ? "조회 중…" : "↻ 조회"}</button>
                <button onClick={() => { setHistFrom(""); setHistTo(""); loadHist(); }} style={{ padding: "9px 12px", borderRadius: 10, border: `1px solid ${C.line}`, background: C.win, color: C.sub, fontWeight: 700, fontSize: 12, cursor: "pointer" }}>전체</button>
              </div>
              <div style={{ display: "flex", gap: 10, marginBottom: 12 }}>
                <div style={{ flex: 1, textAlign: "center", padding: 11, borderRadius: 11, background: logC.post.bg }}><div style={{ fontSize: 20, fontWeight: 900, color: logC.post.fg }}>{tot.p}</div><div style={{ fontSize: 11, color: logC.post.fg, opacity: .85 }}>기간 내 게시</div></div>
                <div style={{ flex: 1, textAlign: "center", padding: 11, borderRadius: 11, background: logC.done.bg }}><div style={{ fontSize: 20, fontWeight: 900, color: logC.done.fg }}>{tot.i}</div><div style={{ fontSize: 11, color: logC.done.fg, opacity: .85 }}>기간 내 색인</div></div>
                <div style={{ flex: 1, textAlign: "center", padding: 11, borderRadius: 11, background: C.panel }}><div style={{ fontSize: 20, fontWeight: 900, color: C.ink }}>{rows.length}</div><div style={{ fontSize: 11, color: C.sub }}>활동한 날</div></div>
              </div>
              {histLoading ? <div style={{ textAlign: "center", color: C.sub, fontSize: 12.5, padding: 16 }}>불러오는 중…</div>
                : rows.length === 0 ? <div style={{ textAlign: "center", color: C.sub, fontSize: 12.5, padding: 16 }}>이 기간엔 배포 기록이 없어요. 백링크를 돌리면 여기에 날짜별로 쌓여요.</div>
                : <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
                  {rows.map(r => <div key={r.day} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 11px", borderRadius: 10, background: C.panel, border: `1px solid ${C.line}` }}>
                    <span style={{ fontSize: 12.5, fontWeight: 800, color: C.ink, minWidth: 92 }}>{new Date(r.day).toLocaleDateString("ko-KR", { year: "2-digit", month: "2-digit", day: "2-digit" })}</span>
                    <div style={{ flex: 1, height: 8, borderRadius: 99, background: C.line, overflow: "hidden", minWidth: 40 }}><div style={{ height: "100%", width: `${Math.round(r.posted / maxP * 100)}%`, background: logC.post.fg, borderRadius: 99 }} /></div>
                    <span style={{ fontSize: 12, fontWeight: 800, color: logC.post.fg, minWidth: 48, textAlign: "right" }}>게시 {r.posted}</span>
                    <span style={{ fontSize: 12, fontWeight: 800, color: logC.done.fg, minWidth: 48, textAlign: "right" }}>색인 {r.indexed}</span>
                  </div>)}
                </div>}
            </div>;
          })()}
        </div>
        </div>{/* /📊 성과 탭 */}

        {/* ── 🚀 발송 탭(이어서): 실시간 로그 ── */}
        <div style={{ display: ctTab === "run" ? "block" : "none" }}>
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
        </div>{/* /🚀 발송 탭(로그) */}
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
