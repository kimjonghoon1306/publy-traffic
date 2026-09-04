import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { PLACE_REPLY_DAILY_LIMIT, getPlaceReplyDailyUsage, getAccounts, PublyAccount } from "../lib/supabase";

/* ═══════════════════════════════════════════════════════════════
   🗣️ 플레이스 리뷰답글
   - 플레이스365에서 등록한 매장을 그대로 불러와, 그 매장 리뷰에 사장 자격으로 답글을 단다.
   - AI가 답글 초안을 쓰고(비용 거의 0=Gemini), 봇이 스마트플레이스에 직접 등록.
   - 안전장치: 좋은 리뷰(별점 높음)만 자동 등록, 저점/악플은 '승인 대기'로 빼서 사장이 확인.
   - 봇(neighbor-bot :3334) 엔드포인트: /api/place-review-fetch(리뷰 수집), /api/place-review-reply(답글 등록, SSE).
   ═══════════════════════════════════════════════════════════════ */

const BOT = "http://127.0.0.1:3334";

type ReviewStatus = "idle" | "approved" | "hold" | "done" | "fail" | "skip";
type PlaceReviewItem = {
  reviewId: string;
  author: string;
  rating: number;          // 별점(0=영수증 등 별점없음)
  text: string;
  date?: string;
  hasReply: boolean;       // 이미 사장 답글이 달린 리뷰
  draft: string;           // AI/고정 답글 초안
  status: ReviewStatus;
};

type Profile = { name?: string; region?: string; placeUrl?: string };

const TONES = ["다정", "담백", "짧게"] as const;

export default function PlaceReview({
  showToast, theme, userId, plan, onOpenPlace,
}: {
  showToast: (msg: string, type?: "success" | "error" | "info") => void;
  theme: "dark" | "light";
  userId?: string;
  plan: string;
  onOpenPlace?: () => void;
}) {
  const isDark = theme === "dark";
  const ACC = isDark ? "#f0a074" : "#a8593a";       // 플레이스365 테라코타 톤
  const isUnlimited = plan === "unlimited" || plan === "admin";
  const limit = PLACE_REPLY_DAILY_LIMIT[plan] ?? PLACE_REPLY_DAILY_LIMIT.free;

  // ── 플레이스365에서 등록한 매장 그대로 불러오기 ──
  const profile = useMemo<Profile | null>(() => {
    try { return JSON.parse(localStorage.getItem(`publy_place360_profile_v1:${userId || "guest"}`) || "null"); }
    catch { return null; }
  }, [userId]);
  const storeName = (profile?.name || "").trim();
  const placeUrl = (profile?.placeUrl || "").trim();
  const hasStore = Boolean(storeName || placeUrl);

  // ── 상태 ──
  const [used, setUsed] = useState(0);
  const [accounts, setAccounts] = useState<PublyAccount[]>([]);
  const [accountId, setAccountId] = useState("");   // 스마트플레이스 로그인에 쓸 네이버 아이디(=봇 세션 키)
  const [reviews, setReviews] = useState<PlaceReviewItem[]>([]);
  const [logs, setLogs] = useState<string[]>([]);
  const [fetching, setFetching] = useState(false);
  const [running, setRunning] = useState(false);
  const [mode, setMode] = useState<"ai" | "fixed">("ai");
  const [tone, setTone] = useState<(typeof TONES)[number]>("다정");
  const [fixedText, setFixedText] = useState("방문해 주셔서 진심으로 감사합니다 😊\n소중한 후기 남겨주셔서 감사해요! 또 뵙겠습니다\n좋게 봐주셔서 감사합니다 🙏 더 노력하는 매장이 될게요");
  const [onlyNew, setOnlyNew] = useState(true);           // 아직 답글 없는 리뷰만
  const [autoMode, setAutoMode] = useState(false);        // false=수동(하나씩 확인), true=자동(봇이 알아서). [[feedback_auto_manual_coexist]]
  const [autoApprove, setAutoApprove] = useState(false);  // (수동 모드) 좋은 리뷰 자동 승인 토글
  const [minAutoRating, setMinAutoRating] = useState(4);  // 이 별점 이상만 자동 대상, 미만은 승인 대기(악플 보호)
  const logRef = useRef<HTMLDivElement>(null);
  const esRef = useRef<EventSource | null>(null);

  useEffect(() => { if (userId) getPlaceReplyDailyUsage(userId).then(setUsed); }, [userId]);
  useEffect(() => {
    if (!userId) return;
    getAccounts(userId).then(list => {
      const naver = list.filter(a => a.platform === "naver");
      setAccounts(naver);
      setAccountId(prev => prev || naver.find(a => a.is_connected)?.username || naver[0]?.username || "");
    }).catch(() => {});
  }, [userId]);
  useEffect(() => { if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight; }, [logs]);
  useEffect(() => () => { esRef.current?.close(); }, []);

  const addLog = useCallback((m: string) => setLogs(l => [...l.slice(-400), `${new Date().toLocaleTimeString("ko-KR", { hour12: false })}  ${m}`]), []);

  // ── 리뷰 불러오기(봇 크롤) — 수집한 배열을 반환(자동 파이프라인 재사용) ──
  async function apiFetch(): Promise<PlaceReviewItem[]> {
    if (!hasStore) { showToast("먼저 플레이스365에서 매장을 등록하세요", "info"); return []; }
    if (!accountId) { showToast("스마트플레이스에 로그인할 네이버 계정을 먼저 연결/선택하세요", "info"); return []; }
    setFetching(true); setReviews([]);
    addLog(`📥 "${storeName || placeUrl}" 리뷰 불러오는 중... (계정 ${accountId})`);
    try {
      const r = await fetch(`${BOT}/api/place-review-fetch`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accountId, placeUrl, storeName, onlyNew, ...(userId ? { userId } : {}) }),
      });
      if (!r.ok) throw new Error(`서버 응답 ${r.status}`);
      const d = await r.json();
      const items: PlaceReviewItem[] = (d.reviews || []).map((x: any, i: number) => ({
        reviewId: String(x.reviewId ?? x.id ?? i),
        author: x.author || "익명",
        rating: Number(x.rating) || 0,
        text: (x.text || "").trim(),
        date: x.date,
        hasReply: !!x.hasReply,
        draft: "",
        status: "idle" as ReviewStatus,
      }));
      setReviews(items);
      addLog(`✅ 리뷰 ${items.length}건 수집 (답글 없는 리뷰 ${items.filter(x => !x.hasReply).length}건)`);
      if (!items.length) showToast("가져올 리뷰가 없어요", "info");
      return items;
    } catch (e: any) {
      addLog(`❌ 리뷰 불러오기 실패: ${e.message}`);
      addLog(`   → 앱(PC)에서 실행 중인지, 스마트플레이스 계정이 연결됐는지 확인하세요.`);
      showToast("리뷰 불러오기 실패 — 로그 확인", "error");
      return [];
    } finally { setFetching(false); }
  }
  const fetchReviews = () => { void apiFetch(); };

  // ── AI 답글 초안 생성 — 초안 채운 배열 반환. forceAuto=true면 좋은 리뷰 자동 승인(자동 모드용) ──
  async function apiDrafts(items: PlaceReviewItem[], forceAuto = false): Promise<PlaceReviewItem[]> {
    const targets = items.filter(r => (!onlyNew || !r.hasReply) && r.text);
    if (!targets.length) { showToast("초안 만들 리뷰가 없어요", "info"); return items; }
    addLog(`✍️ 답글 초안 ${targets.length}건 생성 중... (${mode === "ai" ? "AI" : "고정문구"})`);
    try {
      const r = await fetch(`${BOT}/api/place-review-drafts`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode, tone, fixedText,
          geminiKey: mode === "ai" ? (localStorage.getItem("publy_gemini_key") || "") : "",
          reviews: targets.map(t => ({ reviewId: t.reviewId, author: t.author, rating: t.rating, text: t.text })),
          ...(userId ? { userId } : {}),
        }),
      });
      if (!r.ok) throw new Error(`서버 응답 ${r.status}`);
      const d = await r.json();
      const map: Record<string, string> = {};
      (d.drafts || []).forEach((x: any) => { map[String(x.reviewId)] = x.reply || ""; });
      const useAuto = forceAuto || autoApprove;   // 자동 모드거나 자동승인 토글이면 좋은 리뷰 자동 승인
      const updated = items.map(rv => {
        if (map[rv.reviewId] === undefined) return rv;
        const draft = map[rv.reviewId];
        // 별점 기준 이상 → approved(자동), 미만·악플 → hold(승인 대기)
        const auto = useAuto && rv.rating >= minAutoRating && !!draft;
        return { ...rv, draft, status: (draft ? (auto ? "approved" : "hold") : rv.status) as ReviewStatus };
      });
      setReviews(updated);
      addLog(`✅ 초안 생성 완료. 저점(별 ${minAutoRating} 미만)·악플은 '승인 대기'로 분류됐어요.`);
      return updated;
    } catch (e: any) {
      addLog(`❌ 초안 생성 실패: ${e.message}`);
      showToast("초안 생성 실패 — 로그 확인", "error");
      return items;
    }
  }
  const generateDrafts = () => { void apiDrafts(reviews); };

  // ── 자동 모드: 수집 → 초안 → 좋은 리뷰 자동 등록까지 봇이 한 번에 ──
  async function runAuto() {
    if (!isUnlimited && used >= limit) { showToast(`오늘 리뷰답글 한도(${limit}건)를 다 썼어요. 자정에 초기화됩니다.`, "error"); return; }
    addLog(`🪄 자동 모드 시작 — 수집 → 초안 → 좋은 리뷰 자동 등록`);
    const items = await apiFetch();
    if (!items.length) { addLog("자동 모드 종료: 처리할 리뷰가 없어요."); return; }
    const drafted = await apiDrafts(items, true);
    const approved = drafted.filter(r => r.status === "approved" && r.draft.trim());
    const hold = drafted.filter(r => r.status === "hold").length;
    if (hold > 0) addLog(`⚠️ 저점·악플 ${hold}건은 자동 등록하지 않고 '승인 대기'로 남겼어요(사장님 확인 필요).`);
    if (!approved.length) { addLog("자동 등록 대상(좋은 리뷰)이 없어요. 승인 대기만 남았어요."); return; }
    apiRegister(approved);
  }

  // ── 승인된 답글을 봇이 실제 등록(SSE) ──
  function runRegister() { apiRegister(reviews.filter(r => r.status === "approved" && r.draft.trim())); }
  function apiRegister(approved: PlaceReviewItem[]) {
    if (!approved.length) { showToast("등록할(승인된) 답글이 없어요. 리뷰 옆 '승인'을 눌러주세요", "info"); return; }
    if (!accountId) { showToast("스마트플레이스에 로그인할 네이버 계정을 먼저 연결/선택하세요", "info"); return; }
    if (!isUnlimited && used >= limit) { showToast(`오늘 리뷰답글 한도(${limit}건)를 다 썼어요. 자정에 초기화됩니다.`, "error"); return; }
    setRunning(true);
    addLog(`🚀 승인된 답글 ${approved.length}건 등록 시작... (계정 ${accountId})`);
    const body = JSON.stringify({
      accountId, placeUrl, storeName,
      replies: approved.map(a => ({ reviewId: a.reviewId, reply: a.draft.trim() })),
      ...(userId ? { userId } : {}),
    });
    fetch(`${BOT}/api/place-review-reply`, { method: "POST", headers: { "Content-Type": "application/json" }, body })
      .then(res => {
        if (!res.body) throw new Error("스트림 없음");
        const reader = res.body.getReader();
        const dec = new TextDecoder();
        let buf = "";
        const pump = (): any => reader.read().then(({ done, value }) => {
          if (done) { setRunning(false); return; }
          buf += dec.decode(value, { stream: true });
          const parts = buf.split("\n\n"); buf = parts.pop() || "";
          for (const p of parts) {
            const line = p.split("\n").find(l => l.startsWith("data:"));
            if (!line) continue;
            try {
              const d = JSON.parse(line.slice(5).trim());
              if (d.type === "log") addLog(d.msg);
              else if (d.type === "result") {
                setReviews(prev => prev.map(rv => rv.reviewId === String(d.reviewId) ? { ...rv, status: d.status === "success" ? "done" : "fail", hasReply: d.status === "success" ? true : rv.hasReply } : rv));
                if (d.status === "success") setUsed(u => u + 1);
              } else if (d.type === "done") { addLog("🎉 리뷰답글 등록 완료!"); setRunning(false); }
              else if (d.type === "quota_exceeded") { addLog("🛑 오늘 한도 초과"); setRunning(false); }
            } catch { /* ignore */ }
          }
          return pump();
        });
        return pump();
      })
      .catch(e => { addLog(`❌ 등록 오류: ${e.message}`); setRunning(false); showToast("등록 실패 — 로그 확인", "error"); });
  }

  const setStatus = (id: string, status: ReviewStatus) => setReviews(prev => prev.map(r => r.reviewId === id ? { ...r, status } : r));
  const setDraft = (id: string, draft: string) => setReviews(prev => prev.map(r => r.reviewId === id ? { ...r, draft } : r));

  const approvedCount = reviews.filter(r => r.status === "approved").length;
  const holdCount = reviews.filter(r => r.status === "hold").length;

  // ── 스타일 ──
  const card: React.CSSProperties = { background: "var(--card)", border: "1px solid var(--border)", borderRadius: 16, padding: 18, marginBottom: 14 };
  const chip = (on: boolean): React.CSSProperties => ({ padding: "8px 14px", borderRadius: 99, border: `1.5px solid ${on ? ACC : "var(--border)"}`, background: on ? (isDark ? "rgba(240,160,116,.14)" : "rgba(168,89,58,.1)") : "transparent", color: on ? ACC : "var(--text2)", cursor: "pointer", fontSize: 13, fontWeight: 700, fontFamily: "inherit" });

  return (
    <div style={{ maxWidth: 920, margin: "0 auto", padding: "4px 2px 40px" }}>
      {/* 헤더 */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 6 }}>
        <div style={{ fontSize: 34 }}>🗣️</div>
        <div>
          <div style={{ fontSize: 20, fontWeight: 900, color: "var(--text)" }}>플레이스 리뷰답글</div>
          <div style={{ fontSize: 12.5, color: "var(--text2)", marginTop: 2 }}>내 매장 리뷰에 <b style={{ color: ACC }}>사장님 답글</b>을 자동으로 달아요. 답글은 <b style={{ color: ACC }}>플레이스 순위</b>에도 도움이 돼요.</div>
        </div>
      </div>

      {/* 등급 사용표 */}
      <div style={{ ...card, background: isDark ? "linear-gradient(180deg,rgba(240,160,116,.08),transparent)" : "linear-gradient(180deg,rgba(168,89,58,.06),transparent)" }}>
        <div style={{ fontSize: 13, fontWeight: 800, color: "var(--text)", marginBottom: 10 }}>💎 등급별 하루 리뷰답글 한도</div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(88px,1fr))", gap: 8 }}>
          {([["무료", "free"], ["베이직", "basic"], ["프로", "pro"]] as const).map(([label, key]) => {
            const v = PLACE_REPLY_DAILY_LIMIT[key];
            const mine = plan === key;
            return (
              <div key={key} style={{ textAlign: "center", padding: "10px 6px", borderRadius: 12, border: `1.5px solid ${mine ? ACC : "var(--border)"}`, background: mine ? (isDark ? "rgba(240,160,116,.12)" : "rgba(168,89,58,.08)") : "transparent" }}>
                <div style={{ fontSize: 11, color: "var(--text3)", fontWeight: 700 }}>{label}{mine ? " (나)" : ""}</div>
                <div style={{ fontSize: 15, fontWeight: 900, color: mine ? ACC : "var(--text)" }}>{v}건</div>
              </div>
            );
          })}
        </div>
        {/* 오늘 사용량 게이지 */}
        <div style={{ marginTop: 12 }}>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11.5, color: "var(--text2)", marginBottom: 4 }}>
            <span>오늘 등록한 답글</span>
            <span style={{ fontWeight: 800, color: ACC }}>{isUnlimited ? `${used} · 무제한` : `${used} / ${limit}`}</span>
          </div>
          {!isUnlimited && (
            <div style={{ height: 8, borderRadius: 99, background: "var(--border)", overflow: "hidden" }}>
              <div style={{ height: "100%", width: `${Math.min(100, (used / Math.max(1, limit)) * 100)}%`, background: `linear-gradient(90deg,${ACC},${isDark ? "#ffbf9a" : "#c8724f"})`, transition: "width .3s" }} />
            </div>
          )}
        </div>
      </div>

      {/* 매장 카드 */}
      {!hasStore ? (
        <div style={{ ...card, textAlign: "center", padding: "34px 18px" }}>
          <div style={{ fontSize: 15, fontWeight: 800, color: "var(--text)", marginBottom: 6 }}>먼저 매장을 등록해 주세요</div>
          <div style={{ fontSize: 13, color: "var(--text2)", marginBottom: 16 }}>플레이스365에서 매장을 등록하면, 여기서 그 매장 리뷰를 그대로 불러와 답글을 달 수 있어요.</div>
          <button onClick={onOpenPlace} style={{ padding: "11px 22px", borderRadius: 12, border: "none", background: `linear-gradient(135deg,${ACC},${isDark ? "#ffbf9a" : "#c8724f"})`, color: "#fff", fontWeight: 800, fontSize: 14, cursor: "pointer", fontFamily: "inherit" }}>🏪 플레이스365에서 매장 등록하기</button>
        </div>
      ) : (
        <div style={{ ...card, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <div style={{ width: 44, height: 44, borderRadius: 12, background: isDark ? "rgba(240,160,116,.14)" : "rgba(168,89,58,.1)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 22 }}>🏪</div>
            <div>
              <div style={{ fontSize: 15, fontWeight: 800, color: "var(--text)" }}>{storeName || "내 매장"}</div>
              <div style={{ fontSize: 11.5, color: "var(--text3)", maxWidth: 380, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{placeUrl || "플레이스 주소 없음"}</div>
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <select value={accountId} onChange={e => setAccountId(e.target.value)} style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid var(--border)", background: "var(--bg2)", color: "var(--text)", fontFamily: "inherit", fontSize: 13, maxWidth: 200 }}>
              {accounts.length === 0 && <option value="">연결된 네이버 계정 없음</option>}
              {accounts.map(a => <option key={a.id} value={a.username}>{a.is_connected ? "🟢" : "⚪"} {a.username}{a.blog_name ? ` (${a.blog_name})` : ""}</option>)}
            </select>
            <button onClick={fetchReviews} disabled={fetching} style={{ padding: "11px 20px", borderRadius: 12, border: "none", background: fetching ? "var(--border)" : `linear-gradient(135deg,${ACC},${isDark ? "#ffbf9a" : "#c8724f"})`, color: "#fff", fontWeight: 800, fontSize: 14, cursor: fetching ? "default" : "pointer", fontFamily: "inherit" }}>{fetching ? "불러오는 중..." : "📥 리뷰 불러오기"}</button>
          </div>
        </div>
      )}
      {hasStore && accounts.length === 0 && (
        <div style={{ ...card, background: isDark ? "rgba(224,149,47,.1)" : "rgba(224,149,47,.08)", borderColor: "#e0952f", fontSize: 12.5, color: "var(--text2)" }}>
          ⚠️ 연결된 네이버 계정이 없어요. <b>계정 관리</b> 탭에서 스마트플레이스(사장님)용 네이버 계정을 먼저 연결해 주세요.
        </div>
      )}

      {/* 답글 설정 */}
      {hasStore && (
        <div style={card}>
          <div style={{ fontSize: 13, fontWeight: 800, color: "var(--text)", marginBottom: 10 }}>⚙️ 답글 설정</div>

          {/* 자동/수동 모드 토글 (회원이 선택) */}
          <div style={{ display: "flex", gap: 8, marginBottom: 6 }}>
            <button onClick={() => setAutoMode(false)} style={{ flex: 1, padding: "12px", borderRadius: 12, border: `1.5px solid ${!autoMode ? ACC : "var(--border)"}`, background: !autoMode ? (isDark ? "rgba(240,160,116,.14)" : "rgba(168,89,58,.1)") : "transparent", color: !autoMode ? ACC : "var(--text2)", cursor: "pointer", fontSize: 13.5, fontWeight: 800, fontFamily: "inherit" }}>✋ 수동 (하나씩 확인)</button>
            <button onClick={() => setAutoMode(true)} style={{ flex: 1, padding: "12px", borderRadius: 12, border: `1.5px solid ${autoMode ? ACC : "var(--border)"}`, background: autoMode ? (isDark ? "rgba(240,160,116,.14)" : "rgba(168,89,58,.1)") : "transparent", color: autoMode ? ACC : "var(--text2)", cursor: "pointer", fontSize: 13.5, fontWeight: 800, fontFamily: "inherit" }}>🪄 자동 (알아서)</button>
          </div>
          <div style={{ fontSize: 11.5, color: "var(--text3)", marginBottom: 14, lineHeight: 1.5 }}>{autoMode ? "봇이 리뷰를 모아 좋은 리뷰에 자동으로 답글을 달아요. 악플·저점은 자동 등록하지 않고 승인 대기로 남겨요." : "리뷰를 불러와 하나씩 확인하고, 승인한 답글만 등록해요."}</div>

          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
            <button onClick={() => setMode("ai")} style={chip(mode === "ai")}>✨ AI 자동 답글</button>
            <button onClick={() => setMode("fixed")} style={chip(mode === "fixed")}>📝 고정 문구</button>
          </div>
          {mode === "ai" ? (
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 4 }}>
              {TONES.map(t => <button key={t} onClick={() => setTone(t)} style={chip(tone === t)}>{t}</button>)}
              <span style={{ fontSize: 11.5, color: "var(--text3)", alignSelf: "center" }}>리뷰 내용을 읽고 말투에 맞춰 답글을 만들어요</span>
            </div>
          ) : (
            <textarea value={fixedText} onChange={e => setFixedText(e.target.value)} rows={3} placeholder="한 줄에 하나씩 — 리뷰마다 랜덤으로 골라 답해요" style={{ width: "100%", borderRadius: 10, border: "1px solid var(--border)", background: "var(--bg2)", color: "var(--text)", padding: "10px 12px", fontSize: 13, fontFamily: "inherit", resize: "vertical" }} />
          )}

          <div style={{ borderTop: "1px solid var(--border)", marginTop: 14, paddingTop: 12, display: "flex", flexDirection: "column", gap: 10 }}>
            <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", fontSize: 13, color: "var(--text)" }}>
              <input type="checkbox" checked={onlyNew} onChange={e => setOnlyNew(e.target.checked)} /> 아직 답글 없는 리뷰만 (중복 방지)
            </label>
            {/* 자동 승인 토글은 수동 모드에서만. 자동 모드는 항상 좋은 리뷰 자동 승인 */}
            {!autoMode && (
              <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", fontSize: 13, color: "var(--text)" }}>
                <input type="checkbox" checked={autoApprove} onChange={e => setAutoApprove(e.target.checked)} /> 좋은 리뷰는 <b style={{ color: ACC }}>자동 승인</b> (아래 별점 이상만)
              </label>
            )}
            <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: (autoMode || autoApprove) ? "var(--text)" : "var(--text3)", paddingLeft: autoMode ? 0 : 24 }}>
              <span>{autoMode ? "🪄 자동 등록 최소 별점" : "자동 승인 최소 별점"}</span>
              <select value={minAutoRating} disabled={!autoMode && !autoApprove} onChange={e => setMinAutoRating(Number(e.target.value))} style={{ padding: "5px 8px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--bg2)", color: "var(--text)", fontFamily: "inherit" }}>
                {[3, 4, 5].map(n => <option key={n} value={n}>⭐{n}점 이상</option>)}
              </select>
              <span style={{ fontSize: 11, color: "var(--text3)" }}>그 미만·악플은 <b>승인 대기</b>로 빠져요</span>
            </div>
          </div>

          {/* 실행 버튼 — 자동/수동 분기 */}
          {autoMode ? (
            <button onClick={runAuto} disabled={fetching || running} style={{ width: "100%", marginTop: 14, padding: "13px", borderRadius: 12, border: "none", background: (fetching || running) ? "var(--border)" : `linear-gradient(135deg,${ACC},${isDark ? "#ffbf9a" : "#c8724f"})`, color: (fetching || running) ? "var(--text3)" : "#fff", fontWeight: 800, fontSize: 14.5, cursor: (fetching || running) ? "default" : "pointer", fontFamily: "inherit" }}>{fetching ? "리뷰 수집 중..." : running ? "답글 등록 중..." : "🪄 자동 답글 실행 (수집 → 초안 → 등록)"}</button>
          ) : (
            <div style={{ display: "flex", gap: 8, marginTop: 14, flexWrap: "wrap" }}>
              <button onClick={generateDrafts} disabled={!reviews.length} style={{ flex: 1, minWidth: 160, padding: "12px", borderRadius: 12, border: `1.5px solid ${ACC}`, background: "transparent", color: ACC, fontWeight: 800, fontSize: 14, cursor: reviews.length ? "pointer" : "default", fontFamily: "inherit", opacity: reviews.length ? 1 : .5 }}>✍️ 답글 초안 만들기</button>
              <button onClick={runRegister} disabled={running || !approvedCount} style={{ flex: 1, minWidth: 160, padding: "12px", borderRadius: 12, border: "none", background: running || !approvedCount ? "var(--border)" : `linear-gradient(135deg,${ACC},${isDark ? "#ffbf9a" : "#c8724f"})`, color: running || !approvedCount ? "var(--text3)" : "#fff", fontWeight: 800, fontSize: 14, cursor: running || !approvedCount ? "default" : "pointer", fontFamily: "inherit" }}>{running ? "등록 중..." : `🚀 승인된 답글 등록 (${approvedCount})`}</button>
            </div>
          )}
          {holdCount > 0 && <div style={{ fontSize: 11.5, color: "#e0952f", marginTop: 8 }}>⚠️ 승인 대기 {holdCount}건 — 저점/악플이에요. 내용 확인 후 '승인'을 눌러야 등록돼요.</div>}
        </div>
      )}

      {/* 리뷰 목록 */}
      {reviews.length > 0 && (
        <div style={card}>
          <div style={{ fontSize: 13, fontWeight: 800, color: "var(--text)", marginBottom: 12 }}>📋 리뷰 {reviews.length}건</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {reviews.map(rv => (
              <div key={rv.reviewId} style={{ border: "1px solid var(--border)", borderRadius: 12, padding: 12, background: "var(--bg2)", opacity: (onlyNew && rv.hasReply) ? .5 : 1 }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginBottom: 6 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
                    <span style={{ fontSize: 13, fontWeight: 800, color: "var(--text)" }}>{rv.author}</span>
                    <span style={{ fontSize: 12, color: "#f5a623" }}>{rv.rating > 0 ? "★".repeat(rv.rating) + "☆".repeat(Math.max(0, 5 - rv.rating)) : "별점없음"}</span>
                    {rv.date && <span style={{ fontSize: 10.5, color: "var(--text3)" }}>{rv.date}</span>}
                  </div>
                  <StatusBadge status={rv.status} hasReply={rv.hasReply} acc={ACC} />
                </div>
                <div style={{ fontSize: 12.5, color: "var(--text2)", lineHeight: 1.55, marginBottom: rv.draft ? 8 : 0 }}>{rv.text}</div>
                {rv.draft && (
                  <div style={{ marginTop: 6, paddingLeft: 10, borderLeft: `2px solid ${ACC}` }}>
                    <div style={{ fontSize: 10.5, color: ACC, fontWeight: 700, marginBottom: 3 }}>↩ 답글 초안 (수정 가능)</div>
                    <textarea value={rv.draft} onChange={e => setDraft(rv.reviewId, e.target.value)} rows={2} style={{ width: "100%", borderRadius: 8, border: "1px solid var(--border)", background: "var(--card)", color: "var(--text)", padding: "7px 9px", fontSize: 12.5, fontFamily: "inherit", resize: "vertical" }} />
                    {rv.status !== "done" && (
                      <div style={{ display: "flex", gap: 6, marginTop: 6 }}>
                        <button onClick={() => setStatus(rv.reviewId, rv.status === "approved" ? "hold" : "approved")} style={{ padding: "5px 12px", borderRadius: 8, border: `1.5px solid ${rv.status === "approved" ? ACC : "var(--border)"}`, background: rv.status === "approved" ? ACC : "transparent", color: rv.status === "approved" ? "#fff" : "var(--text2)", fontSize: 11.5, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}>{rv.status === "approved" ? "✓ 승인됨" : "승인"}</button>
                        <button onClick={() => setStatus(rv.reviewId, "skip")} style={{ padding: "5px 12px", borderRadius: 8, border: "1px solid var(--border)", background: "transparent", color: "var(--text3)", fontSize: 11.5, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}>건너뛰기</button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 실시간 로그 (테리 강조: 다 찍혀야 됨) */}
      <div style={card}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
          <div style={{ fontSize: 13, fontWeight: 800, color: "var(--text)" }}>📡 실시간 로그</div>
          {logs.length > 0 && <button onClick={() => setLogs([])} style={{ fontSize: 11, color: "var(--text3)", background: "none", border: "none", cursor: "pointer", fontFamily: "inherit" }}>지우기</button>}
        </div>
        <div ref={logRef} style={{ height: 220, overflowY: "auto", background: isDark ? "#0e0e12" : "#1a1a1f", borderRadius: 10, padding: "10px 12px", fontFamily: "ui-monospace,SFMono-Regular,Menlo,monospace", fontSize: 12, lineHeight: 1.7, color: "#c8f5d8" }}>
          {logs.length === 0
            ? <div style={{ color: "#7a8a80" }}>리뷰를 불러오고 답글을 등록하면 여기에 한 줄씩 상세히 찍혀요.</div>
            : logs.map((l, i) => <div key={i} style={{ whiteSpace: "pre-wrap", wordBreak: "break-all", color: l.includes("❌") ? "#ff9d9d" : l.includes("⚠️") ? "#ffd48a" : l.includes("✅") || l.includes("🎉") ? "#a8f0c0" : "#cfe8d8" }}>{l}</div>)}
        </div>
      </div>

      <div style={{ fontSize: 11, color: "var(--text3)", textAlign: "center", lineHeight: 1.6 }}>
        💡 리뷰답글은 <b>PC 앱</b>에서 실행돼요(봇). 스마트플레이스(사장님) 계정 로그인이 필요할 수 있어요.<br />
        악플·저점 리뷰는 자동 등록하지 않고 <b>승인 대기</b>로 빠져요 — 내용을 꼭 확인하고 등록하세요.
      </div>
    </div>
  );
}

function StatusBadge({ status, hasReply, acc }: { status: ReviewStatus; hasReply: boolean; acc: string }) {
  const map: Record<string, { t: string; c: string; bg: string }> = {
    done: { t: "✅ 등록됨", c: "#22a880", bg: "rgba(34,168,128,.14)" },
    approved: { t: "승인됨", c: acc, bg: "rgba(168,89,58,.12)" },
    hold: { t: "⏳ 승인 대기", c: "#e0952f", bg: "rgba(224,149,47,.14)" },
    fail: { t: "❌ 실패", c: "#e05555", bg: "rgba(224,85,85,.14)" },
    skip: { t: "건너뜀", c: "#8a8a8a", bg: "rgba(138,138,138,.12)" },
  };
  if (status === "idle") {
    if (hasReply) return <span style={{ fontSize: 10.5, color: "#22a880", fontWeight: 700 }}>답글 있음</span>;
    return <span style={{ fontSize: 10.5, color: "var(--text3)" }}>대기</span>;
  }
  const m = map[status]; if (!m) return null;
  return <span style={{ fontSize: 10.5, fontWeight: 700, color: m.c, background: m.bg, padding: "2px 8px", borderRadius: 99 }}>{m.t}</span>;
}
