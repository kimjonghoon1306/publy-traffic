import React, { useState, useEffect, useCallback, useRef } from "react";
import { PublyUser, PublyAccount, getAccounts, upsertAccount, deleteTrafficAccount, getTrafficLicenses, TRAFFIC_PLAN_LIMIT, ToolLicense } from "./lib/supabase";
import { botFetch } from "./lib/botApi";
import InflowCenter from "./components/InflowCenter";

const BOT = "http://127.0.0.1:3363";

// 💜 트래픽 전용 컴팩트 화면 — 로그인 후 퍼블리 대시보드 대신 이 화면만 뜬다.
//    목업 ~/Desktop/퍼블리_트래픽_목업.html 레이아웃: 보라 헤더 + InflowCenter(유입 엔진) + 하단 대여 카운트다운.
type Props = { user: PublyUser; onLogout: () => void; onAdminLogin: () => void; theme: "light" | "dark"; onThemeToggle: () => void };

const GRADE_LABEL: Record<string, string> = { basic: "베이직", pro: "프로", premium: "프리미엄", unlimited: "무제한" };

export default function TrafficApp({ user, onLogout, onAdminLogin, theme, onThemeToggle }: Props) {
  const dark = theme === "dark";
  const C = dark
    ? { bg: "#0d0a14", win: "#1a1526", ink: "#efeafb", sub: "#a89fbd", line: "#332b42", line2: "#413650", panel: "#221b30", accent: "#a78bfa", accent2: "#c4b5fd", soft: "rgba(167,139,250,.14)", ring: "#1a1526" }
    : { bg: "#f1eef9", win: "#ffffff", ink: "#1a1426", sub: "#6b6480", line: "#e8e3f2", line2: "#dcd4ec", panel: "#f7f4fc", accent: "#6d28d9", accent2: "#8b5cf6", soft: "#f2edfd", ring: "#fff" };

  // ── 서버(봇) 온라인 감지 ──
  const [botOnline, setBotOnline] = useState(false);
  useEffect(() => {
    let alive = true;
    const ping = async () => {
      try { const r = await botFetch(`${BOT}/health`, { signal: AbortSignal.timeout(3000) }); if (alive) setBotOnline(r.ok); }
      catch { if (alive) setBotOnline(false); }
    };
    void ping();
    const iv = window.setInterval(ping, 4000);
    return () => { alive = false; window.clearInterval(iv); };
  }, []);

  // ── 앱 버전 ──
  const [appVersion, setAppVersion] = useState("");
  useEffect(() => { window.electron?.getAppVersion?.().then((v: string) => setAppVersion(v)).catch(() => {}); }, []);

  // ── 🎫 트래픽 라이선스 — 로그인 이메일로 컨트롤타워 승인 기능 조회(2초 폴링, 서버시간 기준) ──
  const [lics, setLics] = useState<ToolLicense[]>([]);
  const [licFetchedAt, setLicFetchedAt] = useState(0);
  const [allowedFeatures, setAllowedFeatures] = useState<("place" | "blog" | "store")[]>([]);
  const [licenseSaver, setLicenseSaver] = useState<string>("");
  const [licenseByFeat, setLicenseByFeat] = useState<Record<string, { limit: number; actions: string[]; plan: string }>>({});
  const licSigRef = useRef<string>("");
  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const all = await getTrafficLicenses(user.email);
        if (!alive) return;
        const ok = all.filter(l => (l.remain_sec ?? 0) > 0);
        const feats = ok.map(l => l.tool);
        const order: Record<string, number> = { normal: 0, save: 1, ultra: 2 };
        const strongest = ok.map(l => l.data_saver || "ultra").sort((a, b) => (order[b] ?? 2) - (order[a] ?? 2))[0] || "";
        const byFeat: Record<string, { limit: number; actions: string[]; plan: string }> = {};
        ok.forEach(l => {
          const plan = l.plan || "basic";
          const base = TRAFFIC_PLAN_LIMIT[plan] ?? 30;
          const limit = base === 0 ? 0 : base + (l.bonus_quota || 0);
          byFeat[l.tool] = { limit, actions: Array.isArray(l.allowed_actions) ? l.allowed_actions : [], plan };
        });
        const sig = JSON.stringify([feats.slice().sort(), strongest, byFeat, ok.map(l => Math.round((l.remain_sec ?? 0) / 60))]);
        if (sig !== licSigRef.current) { licSigRef.current = sig; setLics(ok); setAllowedFeatures(feats); setLicenseSaver(strongest); setLicenseByFeat(byFeat); setLicFetchedAt(Date.now()); }
      } catch {}
    };
    void load();
    const iv = window.setInterval(load, 2000);
    return () => { alive = false; window.clearInterval(iv); };
  }, [user.email]);

  // ── ⏱ 하단 대여 카운트다운(서버시간 기준 remain_sec + 경과초로 표시, 시계조작 방지) ──
  const [nowTick, setNowTick] = useState(Date.now());
  useEffect(() => { const iv = window.setInterval(() => setNowTick(Date.now()), 1000); return () => window.clearInterval(iv); }, []);
  const elapsed = Math.floor((nowTick - licFetchedAt) / 1000);
  // 가장 먼저 만료되는 활성 라이선스를 하단 바에 표시(그게 실질 대여 기간)
  const soonest = lics.slice().sort((a, b) => (a.remain_sec ?? 0) - (b.remain_sec ?? 0))[0];
  const remainSec = soonest ? Math.max(0, (soonest.remain_sec ?? 0) - elapsed) : 0;
  const dDay = Math.floor(remainSec / 86400);
  const hh = String(Math.floor((remainSec % 86400) / 3600)).padStart(2, "0");
  const mm = String(Math.floor((remainSec % 3600) / 60)).padStart(2, "0");
  const ss = String(remainSec % 60).padStart(2, "0");
  const gradePlan = soonest?.plan || "";
  const gradeLimit = TRAFFIC_PLAN_LIMIT[gradePlan] ?? 0;
  // 최장 대여기간(진행률 링) — 만료일까지의 총 기간을 정확히 알 수 없으니 30일 기준 게이지로 표시
  const pct = soonest ? Math.min(100, Math.round((remainSec / (30 * 86400)) * 100)) : 0;

  // ── 💤 절전 방지(유입/예약/오토파일럿 실행 중) ──
  const [inflowBusy, setInflowBusy] = useState(false);
  useEffect(() => { window.electron?.keepAwake?.(inflowBusy).catch(() => {}); return () => { if (inflowBusy) window.electron?.keepAwake?.(false).catch(() => {}); }; }, [inflowBusy]);

  // ── 🍞 토스트 ──
  const [toasts, setToasts] = useState<{ id: number; msg: string; type: string }[]>([]);
  const showToast = useCallback((msg: string, type: "success" | "error" | "info" = "success") => {
    const id = Date.now() + Math.random();
    setToasts(p => [...p, { id, msg, type }]);
    setTimeout(() => setToasts(p => p.filter(t => t.id !== id)), 3200);
  }, []);

  // ── 🔗 계정 연결(저장·찜·공감엔 네이버 로그인 필요) ──
  const [accounts, setAccounts] = useState<PublyAccount[]>([]);
  const reloadAccounts = useCallback(() => { getAccounts(user.id, "traffic").then(setAccounts).catch(() => {}); }, [user.id]);
  useEffect(() => { reloadAccounts(); }, [reloadAccounts]);
  const [showAcc, setShowAcc] = useState(false);
  const [accId, setAccId] = useState("");
  const [accPw, setAccPw] = useState("");
  const [accBlog, setAccBlog] = useState("");
  const [accBusy, setAccBusy] = useState(false);
  const [showPw, setShowPw] = useState(false);  // 👁️ 비번 미리보기
  const naverAccs = accounts.filter(a => a.platform === "naver");
  async function connectAccount() {
    if (!accId.trim() || !accPw.trim()) { showToast("아이디·비밀번호를 입력하세요", "error"); return; }
    if (!botOnline) { showToast("PC에서 트래픽 앱을 먼저 실행해주세요", "error"); return; }
    setAccBusy(true);
    try {
      const r = await botFetch(`${BOT}/api/naver/save-session`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ userId: user.id, id: accId.trim(), pw: accPw, blogName: accBlog.trim() || undefined }), signal: AbortSignal.timeout(120000) });
      const d = await r.json(); if (!d.success) throw new Error(d.error || "연결 실패");
      const existing = accounts.find(a => a.platform === "naver" && a.username === accId.trim());
      await upsertAccount({ ...(existing ? { id: existing.id } : {}), user_id: user.id, platform: "naver", username: accId.trim(), blog_name: accBlog.trim() || undefined, is_connected: true, connected_at: new Date().toISOString(), app: "traffic" });
      reloadAccounts(); setAccId(""); setAccPw(""); setAccBlog("");
      showToast("✅ 네이버 계정을 연결했어요", "success");
    } catch (e: any) { showToast("연결 실패: " + (e?.message || "오류"), "error"); }
    finally { setAccBusy(false); }
  }
  // 삭제 확인 — Electron은 window.confirm 안 뜨므로 "한 번 더 누르면 삭제" 방식
  const [delArm, setDelArm] = useState<string>("");
  async function deleteAccount(a: PublyAccount) {
    if (delArm !== a.id) { setDelArm(a.id); showToast("한 번 더 '삭제'를 누르면 삭제돼요", "info"); setTimeout(() => setDelArm(""), 3000); return; }
    setDelArm("");
    try { await deleteTrafficAccount(a.id); reloadAccounts(); showToast("계정을 삭제했어요", "success"); }
    catch (e: any) { showToast("삭제 실패: " + (e?.message || "오류"), "error"); }
  }

  // 5회 탭 → 관리자 로그인(숨김 진입)
  const logoTap = useRef(0);
  const logoTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onLogoTap = () => {
    logoTap.current += 1;
    if (logoTimer.current) clearTimeout(logoTimer.current);
    if (logoTap.current >= 5) { logoTap.current = 0; onAdminLogin(); return; }
    logoTimer.current = setTimeout(() => { logoTap.current = 0; }, 1400);
  };

  const btn = (bg: string, color: string): React.CSSProperties => ({ padding: "7px 14px", borderRadius: 9, border: "none", background: bg, color, fontSize: 12.5, fontWeight: 800, cursor: "pointer", fontFamily: "inherit", whiteSpace: "nowrap" });

  return (
    <div style={{ height: "100vh", display: "flex", flexDirection: "column", background: C.bg, color: C.ink, fontFamily: "'Noto Sans KR','Apple SD Gothic Neo',sans-serif", overflow: "hidden" }}>
      <style>{`@keyframes pulsePink{0%{box-shadow:0 0 0 0 rgba(240,65,122,.7)}70%{box-shadow:0 0 0 6px rgba(240,65,122,0)}100%{box-shadow:0 0 0 0 rgba(240,65,122,0)}}`}</style>
      {/* 상단 액센트 스트립 */}
      <div style={{ height: 3, flexShrink: 0, background: `linear-gradient(90deg,${C.accent},${C.accent2} 60%,#c4b5fd)` }} />

      {/* 헤더 — 이 영역 드래그로 창 이동(맥 hiddenInset). 좌측 78px 여백=신호등 버튼 자리. 버튼·로고는 no-drag */}
      <div style={{ height: 48, flexShrink: 0, display: "flex", alignItems: "center", gap: 10, padding: "0 12px 0 78px", borderBottom: `1px solid ${C.line}`, background: `linear-gradient(180deg,${C.soft},transparent)`, ["WebkitAppRegion" as any]: "drag" }}>
        <div onClick={onLogoTap} style={{ width: 30, height: 30, borderRadius: 9, background: `linear-gradient(135deg,${C.accent},${C.accent2})`, display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontWeight: 900, fontSize: 16, boxShadow: "0 4px 14px rgba(109,40,217,.4)", cursor: "pointer", userSelect: "none", ["WebkitAppRegion" as any]: "no-drag" }}>T</div>
        <div style={{ fontSize: 14, fontWeight: 900, letterSpacing: ".02em" }}>퍼블리 트래픽 <small style={{ color: C.sub, fontWeight: 600, marginLeft: 5, fontSize: 11 }}>· TRAFFIC{appVersion ? ` v${appVersion}` : ""}</small></div>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "3px 9px", borderRadius: 99, background: C.soft, border: `1px solid ${C.line2}`, fontSize: 10.5, fontWeight: 800, color: botOnline ? "#f0417a" : C.sub }}>
          <span style={{ width: 7, height: 7, borderRadius: "50%", background: botOnline ? "#f0417a" : "#dc2626", boxShadow: botOnline ? "0 0 0 0 rgba(240,65,122,.7)" : "none", animation: botOnline ? "pulsePink 1.4s infinite" : "none" }} />{botOnline ? "온라인" : "오프라인"}
        </span>
        <div style={{ marginLeft: "auto", display: "flex", gap: 8, alignItems: "center", ["WebkitAppRegion" as any]: "no-drag" }}>
          {/* 🎫 내 트래픽 등급 배지 — 대여 있으면 등급, 없으면 미결제(업그레이드 유도) */}
          {soonest
            ? <span style={{ fontSize: 10.5, fontWeight: 900, color: C.accent, background: C.soft, border: `1px solid ${C.line2}`, padding: "3px 9px", borderRadius: 99 }}>{GRADE_LABEL[gradePlan] || gradePlan}</span>
            : <span style={{ fontSize: 10.5, fontWeight: 900, color: "#dc2626", background: "rgba(220,38,38,.1)", border: "1px solid rgba(220,38,38,.35)", padding: "3px 9px", borderRadius: 99 }}>미결제</span>}
          <span style={{ fontSize: 11.5, color: C.sub, fontWeight: 700 }}>{user.name || user.email}</span>
          <button onClick={onThemeToggle} style={{ width: 30, height: 30, borderRadius: 8, border: `1px solid ${C.line2}`, background: C.win, color: C.ink, cursor: "pointer", fontSize: 13 }}>{dark ? "☀️" : "🌙"}</button>
          <button onClick={() => setShowAcc(true)} style={btn(C.panel, C.accent)}>🔗 계정</button>
          <button onClick={onLogout} style={btn(C.panel, C.sub)}>로그아웃</button>
        </div>
      </div>

      {/* 본문 = 유입 엔진(InflowCenter) */}
      <div style={{ flex: 1, overflowY: "auto", padding: "14px 16px 18px" }}>
        <InflowCenter memberMode showToast={showToast} theme={theme} userId={user.id} plan={user.plan} allowedFeatures={allowedFeatures} licenseSaver={licenseSaver} licenseByFeat={licenseByFeat} onBusyChange={setInflowBusy} externalAccounts={accounts} />
      </div>

      {/* 하단 대여 카운트다운 */}
      <div style={{ flexShrink: 0, borderTop: `1px solid ${C.line}`, background: `linear-gradient(90deg,${C.soft},transparent 60%)`, padding: "9px 14px", display: "flex", alignItems: "center", gap: 13 }}>
        <div style={{ width: 40, height: 40, borderRadius: "50%", flexShrink: 0, position: "relative", display: "flex", alignItems: "center", justifyContent: "center", background: `conic-gradient(${C.accent} ${pct}%,${C.line2} 0)` }}>
          <div style={{ position: "absolute", inset: 4, borderRadius: "50%", background: C.ring }} />
          <span style={{ position: "relative", fontSize: 10, fontWeight: 900, color: C.accent }}>{pct}%</span>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          <span style={{ fontSize: 10.5, fontWeight: 700, color: C.sub }}>대여 남은 기간</span>
          {soonest ? (
            <span style={{ fontSize: 14, fontWeight: 900 }}>
              <span style={{ background: C.accent, color: "#fff", padding: "1px 8px", borderRadius: 99, fontSize: 12 }}>D-{dDay}</span>{" "}
              <span style={{ fontVariantNumeric: "tabular-nums" }}>{hh}:{mm}:{ss}</span>
            </span>
          ) : <span style={{ fontSize: 13, fontWeight: 800, color: "#dc2626" }}>대여 없음 — 연장 문의</span>}
        </div>
        <div style={{ flex: 1, height: 7, borderRadius: 5, background: C.line2, overflow: "hidden" }}>
          <div style={{ height: "100%", width: `${pct}%`, background: `linear-gradient(90deg,${C.accent},${C.accent2})` }} />
        </div>
        {soonest && <span style={{ fontSize: 10.5, fontWeight: 900, color: C.accent, background: C.soft, border: `1px solid ${C.line2}`, padding: "3px 9px", borderRadius: 99 }}>{GRADE_LABEL[gradePlan] || gradePlan} · {gradeLimit === 0 ? "무제한" : `하루 ${gradeLimit}회`}</span>}
      </div>

      {/* 🔗 계정 연결 모달 */}
      {showAcc && (
        <div onClick={(e) => { if (e.target === e.currentTarget) setShowAcc(false); }} style={{ position: "fixed", inset: 0, zIndex: 1000, background: "rgba(10,7,19,.6)", display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
          <div style={{ width: "100%", maxWidth: 420, background: C.win, borderRadius: 16, border: `1px solid ${C.line2}`, boxShadow: "0 24px 70px rgba(30,20,50,.3)", overflow: "hidden" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "14px 18px", borderBottom: `1px solid ${C.line}` }}>
              <b style={{ fontSize: 15 }}>🔗 네이버 계정 연결</b>
              <button onClick={() => setShowAcc(false)} style={{ border: "none", background: "transparent", fontSize: 18, cursor: "pointer", color: C.sub }}>✕</button>
            </div>
            <div style={{ padding: "14px 18px 18px" }}>
              <div style={{ fontSize: 12, color: C.sub, lineHeight: 1.6, marginBottom: 12 }}>저장·찜·공감 액션에는 네이버 로그인이 필요해요. 길찾기·공유·전화 등은 로그인 없이도 됩니다. {!botOnline && <b style={{ color: "#dc2626" }}>(PC에서 트래픽 앱 실행 필요)</b>}</div>
              {naverAccs.length > 0 && (
                <div style={{ marginBottom: 12 }}>
                  {naverAccs.map(a => (
                    <div key={a.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 10px", borderRadius: 8, background: C.panel, border: `1px solid ${C.line}`, marginBottom: 6, fontSize: 12.5, flexWrap: "wrap" }}>
                      <span style={{ width: 7, height: 7, borderRadius: "50%", background: a.is_connected ? "#16a34a" : "#dc2626" }} />
                      <b>{a.username}</b>{a.blog_name ? <span style={{ color: C.sub }}>· {a.blog_name}</span> : null}
                      <span style={{ color: a.is_connected ? C.accent : C.sub, fontWeight: 700 }}>{a.is_connected ? "연결됨" : "미연결"}</span>
                      <div style={{ marginLeft: "auto", display: "flex", gap: 5 }}>
                        <button onClick={() => { setAccId(a.username); setAccBlog(a.blog_name || ""); setAccPw(""); showToast("비밀번호를 넣고 계정 연결을 누르면 재연결돼요", "info"); }} style={{ padding: "5px 9px", borderRadius: 7, border: `1px solid ${C.accent}`, background: C.win, color: C.accent, fontSize: 11, fontWeight: 800, cursor: "pointer", fontFamily: "inherit" }}>재연결</button>
                        <button onClick={() => deleteAccount(a)} style={{ padding: "5px 9px", borderRadius: 7, border: "1px solid #dc2626", background: delArm === a.id ? "#dc2626" : C.win, color: delArm === a.id ? "#fff" : "#dc2626", fontSize: 11, fontWeight: 800, cursor: "pointer", fontFamily: "inherit" }}>{delArm === a.id ? "정말 삭제" : "삭제"}</button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
              <input placeholder="네이버 아이디" value={accId} onChange={e => setAccId(e.target.value)} style={{ width: "100%", padding: "10px 12px", border: `1px solid ${C.line2}`, borderRadius: 8, background: C.panel, color: C.ink, fontSize: 13, fontFamily: "inherit", marginBottom: 8, boxSizing: "border-box" }} />
              <div style={{ position: "relative", marginBottom: 8 }}>
                <input type={showPw ? "text" : "password"} placeholder="네이버 비밀번호" value={accPw} onChange={e => setAccPw(e.target.value)} style={{ width: "100%", padding: "10px 40px 10px 12px", border: `1px solid ${C.line2}`, borderRadius: 8, background: C.panel, color: C.ink, fontSize: 13, fontFamily: "inherit", boxSizing: "border-box" }} />
                <span onClick={() => setShowPw(v => !v)} style={{ position: "absolute", right: 11, top: "50%", transform: "translateY(-50%)", cursor: "pointer", fontSize: 16, userSelect: "none" }}>{showPw ? "🙈" : "👁️"}</span>
              </div>
              <input placeholder="블로그 주소/이름 (선택)" value={accBlog} onChange={e => setAccBlog(e.target.value)} style={{ width: "100%", padding: "10px 12px", border: `1px solid ${C.line2}`, borderRadius: 8, background: C.panel, color: C.ink, fontSize: 13, fontFamily: "inherit", marginBottom: 12, boxSizing: "border-box" }} />
              <button onClick={connectAccount} disabled={accBusy || !botOnline} style={{ width: "100%", padding: 13, borderRadius: 11, border: "none", background: accBusy || !botOnline ? C.line2 : `linear-gradient(135deg,${C.accent},${C.accent2})`, color: "#fff", fontSize: 14, fontWeight: 900, cursor: accBusy || !botOnline ? "default" : "pointer", fontFamily: "inherit" }}>{accBusy ? "연결 중…" : "계정 연결"}</button>
            </div>
          </div>
        </div>
      )}

      {/* 토스트 */}
      <div style={{ position: "fixed", bottom: 70, right: 20, zIndex: 2000, display: "flex", flexDirection: "column", gap: 8, pointerEvents: "none" }}>
        {toasts.map(t => (
          <div key={t.id} style={{ padding: "11px 16px", borderRadius: 10, fontSize: 13, fontWeight: 700, boxShadow: "0 8px 24px rgba(0,0,0,.25)", background: t.type === "error" ? "#2e1a1a" : t.type === "info" ? "#1a1f2e" : "#1a2e1a", color: t.type === "error" ? "#f87171" : t.type === "info" ? "#93c5fd" : "#4ade80", border: `1px solid ${t.type === "error" ? "rgba(248,113,113,.25)" : t.type === "info" ? "rgba(147,197,253,.25)" : "rgba(74,222,128,.25)"}` }}>{t.msg}</div>
        ))}
      </div>
    </div>
  );
}
