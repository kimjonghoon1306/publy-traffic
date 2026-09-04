import React, { useState, useEffect, useRef, useCallback } from "react";
import { createPortal } from "react-dom";
import { botFetch, BotEventStream } from "../lib/botApi";
import { diagnoseAeo } from "../lib/aeo";
import { getReplyDailyUsage, REPLY_DAILY_LIMIT, getBlogscoreDailyUsage, incrementBlogscoreQuota, BLOGSCORE_DAILY_LIMIT, REVIVE_DAILY_LIMIT, getReviveDailyUsage, PUMASI_ACCOUNT_LIMIT, PUMASI_POSTS_LIMIT, TAB_ACCOUNT_LIMIT, getPumasiDailyUsage, savePostCareChecks, markPrescribed, markTitleChanged, getPostCare, computeCareStatus, PostCare, OBSERVE_DAYS, INDEX_GRACE_DAYS, savePostViews, latestViews, reportError, pushLiveLog } from "../lib/supabase";
import UsageGuide from "../components/UsageGuide";
import dodoImg from "../assets/dodo.png";   // 🩺 블로그 주치의 캐릭터(검수자 도도)
import boriImg from "../assets/bori.png";   // 🌱 응원단 보리

const BOT = "http://127.0.0.1:3334";

// ★LogBox는 컴포넌트 밖에 고정 정의(테리 요청: 로그 스크롤이 위로 튀는 버그).
//   NeighborPage 안에 정의하면 부모 리렌더마다 새 컴포넌트로 취급→통째 리마운트→스크롤 위치가 맨 위로 리셋됐다.
//   밖으로 빼면 같은 컴포넌트로 유지돼 사용자가 스크롤한 위치가 그대로 남는다.
const LogBox = ({ logs, logRef, onClear }: { logs: string[]; logRef: React.RefObject<HTMLDivElement>; onClear: () => void }) => {
  const [copied, setCopied] = useState(false);
  // ★로그 자동 따라가기: 맨 아래에 붙어 있으면 새 로그가 와도 항상 최신(하단)을 보여준다.
  //   사용자가 위로 스크롤하면(과거 보기) 고정, 다시 맨 아래로 내리면 자동 추적 재개.
  const stick = useRef(true);
  useEffect(() => {
    const el = logRef.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [logs, logRef]);
  const onScroll = () => {
    const el = logRef.current;
    if (!el) return;
    stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 48;   // 하단 48px 이내면 '따라가기' 켜짐
  };
  const copyAll = async () => {
    const text = logs.join("\n");
    if (!text) return;
    try {
      if (!navigator.clipboard) throw new Error("clipboard unavailable");
      await navigator.clipboard.writeText(text);
    } catch {
      // 클립보드 API 실패 시 폴백(구형/권한): 임시 textarea로 복사
      try { const ta = document.createElement("textarea"); ta.value = text; document.body.appendChild(ta); ta.select(); const ok = document.execCommand("copy"); document.body.removeChild(ta); if (!ok) throw new Error("copy failed"); }
      catch { alert("로그 복사에 실패했어요. 로그를 드래그해 직접 복사해주세요."); return; }
    }
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  };
  return (
  <div className="card" style={{ padding: 0, overflow: "hidden" }}>
    <div style={{ padding: "14px 18px", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
      <div className="card-title" style={{ margin: 0 }}>📟 작업 로그</div>
      <div style={{ display: "flex", gap: 6 }}>
        <button onClick={copyAll} style={{ padding: "5px 12px", borderRadius: 8, border: "1px solid var(--border)", background: copied ? "rgba(0,200,150,.12)" : "transparent", color: copied ? "#00c896" : "var(--text2)", cursor: "pointer", fontSize: 12, fontFamily: "inherit", fontWeight: 700 }}>{copied ? "✅ 복사되었습니다" : "📋 전체 복사"}</button>
        <button onClick={onClear} style={{ padding: "5px 12px", borderRadius: 8, border: "1px solid var(--border)", background: "transparent", color: "var(--text3)", cursor: "pointer", fontSize: 12, fontFamily: "inherit" }}>지우기</button>
      </div>
    </div>
    {/* userSelect:text + WebkitUserSelect:text → Electron에서도 드래그로 로그 직접 복사 가능 */}
    <div ref={logRef} onScroll={onScroll} style={{ height: "min(90vh, 1400px)", minHeight: 680, overflowY: "auto", padding: "14px 18px", fontFamily: "'JetBrains Mono', monospace", fontSize: 12.5, lineHeight: 1.85, background: "#050a0f", userSelect: "text", WebkitUserSelect: "text", cursor: "text" }}>
      {logs.length === 0 ? <span style={{ color: "#3a5a7a" }}>대기 중...</span> : logs.map((l, i) => (
        <div key={i} style={{ color: l.includes("✅")||l.includes("🎉")||l.includes("❤️")||l.includes("💬") ? "#00d68f" : l.includes("❌")||l.includes("🚫")||l.includes("🔴") ? "#ff5363" : l.includes("⏭️") ? "#7a9ab5" : "#00c8ff", fontWeight: l.includes("🔴") ? 800 : 400, userSelect: "text", WebkitUserSelect: "text" }}>{l}</div>
      ))}
    </div>
  </div>
  );
};

/* ── 숫자 입력 헬퍼: 앞자리 0 고정/첫 숫자 안지워짐 버그 방지 (빈 값 허용, blur 시 기본값 복원) ── */
// ★숫자 입력: 타이핑 중엔 clamp하지 않고(값이 튀는 것 방지), 입력을 끝낼 때(blur)에만 [min,max]로 정리.
//   type="text" + inputMode="numeric"로 브라우저 기본 화살표(스피너)를 없애 오작동(흔들림)을 막고 직접 입력에 집중.
function numProps(val: number, set: (n: number) => void, min: number, max: number, def: number) {
  return {
    type: "text" as const,
    inputMode: "numeric" as const,
    value: val === 0 ? "" : String(val),
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => {
      const v = e.target.value.replace(/[^0-9]/g, "");
      set(v === "" ? 0 : Number(v));   // 입력 중엔 그대로 저장(즉시 clamp 안 함)
    },
    onBlur: (e: React.FocusEvent<HTMLInputElement>) => {
      const n = Number(e.target.value.replace(/[^0-9]/g, ""));
      if (!e.target.value || !Number.isFinite(n) || n < min) set(def);
      else if (n > max) set(max);
    },
  };
}

/* ── 타입 ── */
interface Account { accountId: string; id: string; pw: string; blogId: string; sessionOk: boolean; loginLoading: boolean; showPw: boolean; }
interface Target { keyword: string; blogId: string; nickName?: string; blogName?: string; addDate?: number; postUrl?: string; thumbnail?: string; }
interface WorkResult { keyword: string; blogId: string; nickName?: string; blogName?: string; addDate?: number; postUrl?: string; thumbnail?: string; status: "success"|"fail"|"skip"|"limit"|"pending"|"running"; message: string; }

// 최근 글 작성일 → 상대시간 (활동성 한눈에)
function relTime(ms?: number): string {
  if (!ms) return "";
  const d = Math.floor((Date.now() - ms) / 86400000);
  if (d <= 0) return "오늘";
  if (d === 1) return "어제";
  if (d < 30) return `${d}일 전`;
  if (d < 365) return `${Math.floor(d / 30)}개월 전`;
  return `${Math.floor(d / 365)}년 전`;
}

// 체험단 모집용 서이추 멘트 프리셋 — 순환 사용으로 도배·스팸 탐지 회피. pick.온종일.com = 온종일체험단
const CAMPAIGN_LINK = "pick.온종일.com";
const CAMPAIGN_PRESETS = [
  `안녕하세요 😊 블로그 글 잘 보고 있어요! 서로이웃 신청드려요~ 혹시 무료 체험단·협찬에 관심 있으시면 '온종일체험단'(${CAMPAIGN_LINK}) 한번 놀러오세요 🎁`,
  `포스팅에 정성이 가득하네요 👍 서이추 해요! 맛집·뷰티·생활용품 무료 체험 원하시면 ${CAMPAIGN_LINK} 에서 신청할 수 있어요 :)`,
  `좋은 글 잘 읽었습니다 ✨ 이웃 신청드려요! 체험단 활동 좋아하시면 온종일체험단(${CAMPAIGN_LINK})도 추천드려요~`,
  `반가워요~ 글 잘 보고 갑니다 😊 서로이웃해요! 무료 체험단 관심 있으시면 ${CAMPAIGN_LINK} 놀러오세요~`,
  `블로그 분위기가 참 좋네요 🌿 이웃 신청할게요! 협찬·체험단 활동은 온종일체험단(${CAMPAIGN_LINK})에서 만나요 :)`,
  `유익한 정보 감사합니다 🙌 서이추 신청드려요! 무료 체험 제품 받아보고 싶으시면 ${CAMPAIGN_LINK} 확인해보세요~`,
  `꾸준한 포스팅 멋져요 👏 서로이웃 해요! 맛집·뷰티 체험단 찾으시면 온종일체험단(${CAMPAIGN_LINK}) 추천해요 🎁`,
  `글 잘 보고 이웃 신청드려요 😄 혹시 체험단·협찬에 관심 있으신가요? ${CAMPAIGN_LINK} 에서 무료로 신청 가능해요!`,
  `안녕하세요! 자주 들를게요 ☺️ 서이추 신청드립니다~ 무료 체험단 소식은 온종일체험단(${CAMPAIGN_LINK})에서 받아보세요`,
  `포스팅 잘 봤어요 💕 서로이웃 신청해요! 협찬 제품 무료로 받고 싶으시면 ${CAMPAIGN_LINK} 놀러오세요~`,
  `좋은 이웃이 되고 싶어 신청드려요 🤝 체험단 활동 관심 있으시면 온종일체험단(${CAMPAIGN_LINK})도 함께해요!`,
];
// 기본 멘트(복원용) — 사용자가 수정해도 이 값으로 되돌릴 수 있게 상수로 보관
const DEFAULT_SINGLE_MSG = "안녕하세요! 좋은 글 잘 읽고 갑니다. 서이추 신청드려요 😊";
// ★다중 멘트 = 순서대로 돌아가며 사용(도배·스팸 탐지 회피). 자연스러운 서이추 인사 다양하게.
const DEFAULT_MULTI_MSGS = [
  // 짧고 담백
  "안녕하세요, 서로이웃해요!",
  "좋은 글 잘 봤어요, 이웃해요~",
  "반가워요, 서이추 신청드려요 😊",
  "글 잘 보고 갑니다, 이웃해요!",
  "소통해요~ 서로이웃 신청합니다.",
  // 정성·분위기 칭찬
  "블로그 분위기가 참 좋네요 🌿 서이추 신청할게요!",
  "포스팅에 정성이 느껴져요 👍 서로이웃 해요~",
  "글이 참 깔끔하네요, 이웃 신청드려요!",
  "사진이랑 글이 잘 어울려요, 서로이웃해요 :)",
  "정성스러운 포스팅 잘 봤어요, 이웃할게요!",
  // 정보·유익
  "유익한 글 감사합니다 🙌 서로이웃 신청드려요!",
  "좋은 정보 잘 보고 갑니다. 이웃 신청드려요^^",
  "도움되는 글이 많네요, 자주 올게요! 서이추해요~",
  "필요한 정보 얻어가요, 이웃 신청합니다!",
  // 공감·소통
  "공감 가는 글이 많네요. 서로이웃해요!",
  "글 잘 보고 갑니다 😄 자주 소통해요, 이웃 신청드려요!",
  "비슷한 관심사라 반가워요, 서로이웃해요~",
  "자주 소통하고 싶어요, 이웃 신청드립니다 :)",
  "글 보고 공감 많이 했어요, 이웃해요!",
  // 인사·친근
  "안녕하세요! 좋은 글 잘 읽고 갑니다. 서이추 신청드려요 😊",
  "반가워요~ 좋은 이웃이 되고 싶어 신청드려요 🤝",
  "앞으로 자주 들를게요 ☺️ 서이추 신청합니다~",
  "따뜻한 글 잘 읽었어요 💕 이웃해요!",
  "우연히 들렀는데 글이 좋네요, 서로이웃해요!",
  "지나가다 글 보고 반해서 이웃 신청해요 😊",
  // 응원·기대
  "좋은 글 잘 봤어요, 다음 글도 기대할게요! 이웃해요~",
  "꾸준한 포스팅 멋져요 👏 서로이웃 신청드려요!",
  "응원하며 이웃 신청드려요, 자주 뵈어요!",
  "글 잘 읽었어요, 앞으로도 좋은 글 부탁드려요! 서이추요~",
  "블로그 잘 키워가시는 것 같아요, 이웃해요 🌸",
].join("\n");
interface EngageResult { keyword: string; blogId: string; postUrl: string; liked: boolean; commented: boolean; status: "success"|"fail"|"skip"|"pending"|"running"; message: string; }
// 상단·사이드바 배지와 동일한 플랜별 하루 한도 (lib/supabase.ts의 NEIGHBOR/ENGAGE_DAILY_LIMIT와 일치)
const DAILY_LIMIT_BY_PLAN: Record<string, number> = { free: 10, basic: 50, pro: 100, unlimited: 999999, admin: 9999 };
interface Props { theme: "dark"|"light"; userId?: string; plan?: string; initialTab?: "neighbor"|"engage"|"reply"|"score"|"pumasi"; singleTab?: boolean; isActive?: boolean; onEngageUsageChange?: (used:number)=>void; initialNeighborUsed?: number; initialEngageUsed?: number; onBusyChange?: (busy:boolean)=>void; }

/* ── 내 이웃 키워드 분석 카드 (서이추·공감댓글 공용) ── */
const KeywordAnalyzer = ({ keywords, loading, onAnalyze, onPick }: {
  keywords: { word: string; count: number }[];
  loading: boolean;
  onAnalyze: () => void;
  onPick: (word: string) => void;
}) => {
  const maxC = keywords[0]?.count || 1;
  return (
    <div style={{ marginBottom: 14, padding: "12px 14px", borderRadius: 12, background: "var(--bg2)", border: "1px solid var(--border)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: keywords.length ? 10 : 0 }}>
        <span style={{ fontSize: 13, fontWeight: 700, color: "var(--text2)" }}>🔎 내 이웃 관심 키워드</span>
        <button onClick={onAnalyze} disabled={loading}
          style={{ marginLeft: "auto", padding: "5px 12px", borderRadius: 8, border: "1px solid var(--accent)", background: loading ? "var(--card2)" : "var(--accent-bg)", color: "var(--accent-text)", cursor: loading ? "default" : "pointer", fontSize: 12, fontWeight: 700, fontFamily: "inherit" }}>
          {loading ? "분석 중..." : "분석하기"}
        </button>
      </div>
      {keywords.length > 0 && (
        <>
          <div style={{ fontSize: 11, color: "var(--text3)", marginBottom: 8 }}>이웃들이 자주 쓰는 주제예요. 클릭하면 키워드에 추가됩니다.</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {keywords.map(k => (
              <button key={k.word} onClick={() => onPick(k.word)}
                style={{ padding: "5px 10px", borderRadius: 99, border: "1px solid var(--border)", background: `rgba(255,107,157,${0.06 + 0.18 * (k.count / maxC)})`, color: "var(--text)", cursor: "pointer", fontSize: 12, fontWeight: 600, fontFamily: "inherit" }}>
                {k.word} <span style={{ color: "var(--text3)", fontSize: 10 }}>{k.count}</span>
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
};

/* ── 계정 카드 (외부 컴포넌트 — 렌더마다 재생성 방지) ── */
const AccountCard = React.memo(({ accounts, onLogin, onAdd, onRemove, onChange, onConnectAll, connectingAll }: {
  accounts: Account[];
  onLogin: (id: string) => void;
  onAdd: () => void;
  onRemove: (id: string) => void;
  onChange: (accountId: string, field: keyof Account, value: any) => void;
  onConnectAll?: () => void;          // 있으면 '전체 연결' 버튼 표시(품앗이용)
  connectingAll?: boolean;
}) => {
  const pendingCount = accounts.filter(a => a.id && a.pw && !a.sessionOk).length;
  // ★전체 연결은 '아이디·비번이 입력된 계정'이 하나라도 있으면 언제든 활성화(연결됨 표시여도 세션이 풀릴 수 있어 재연결 필요).
  const credCount = accounts.filter(a => a.id && a.pw).length;
  const allDisabled = connectingAll || credCount === 0;
  return (
  <div className="card" style={{ padding: "18px 20px" }}>
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginBottom: 14 }}>
      <div className="card-title" style={{ margin: 0, fontSize: 15 }}>👤 작업 계정</div>
      {onConnectAll && accounts.length >= 2 && (
        <button onClick={onConnectAll} disabled={allDisabled}
          style={{ padding: "7px 14px", borderRadius: 9, border: "none", background: allDisabled ? "var(--card2)" : "linear-gradient(135deg,#ec4899,#a855f7)", color: allDisabled ? "var(--text3)" : "#fff", cursor: allDisabled ? "default" : "pointer", fontSize: 12, fontWeight: 800, fontFamily: "inherit", whiteSpace: "nowrap" }}
          title={pendingCount ? `아직 연결 안 된 ${pendingCount}개 계정을 로그인해요` : "연결됨 상태여도 세션이 풀릴 수 있어요 — 눌러서 전체 재연결"}>
          {connectingAll ? "🔄 연결 중..." : pendingCount ? `🔗 전체 연결 (${pendingCount})` : "🔗 전체 재연결"}
        </button>
      )}
    </div>
    {onConnectAll && accounts.length >= 2 && (
      <div style={{ fontSize: 11.5, color: "var(--text2)", lineHeight: 1.55, marginBottom: 14, padding: "9px 12px", borderRadius: 9, background: "var(--card2)", border: "1px solid var(--border)" }}>
        💡 계정마다 <b>아이디·비밀번호를 미리 입력</b>해두면, <b style={{ color: "#c026d3" }}>전체 연결</b> 버튼 하나로 <b>아직 연결 안 된 계정을 순서대로 한 번에 로그인</b>해요. 계정을 하나씩만 연결하려면 각 계정의 <b>계정 연결하기</b>를 누르세요. <span style={{ color: "var(--text3)" }}>(연결은 처음 한 번만 — 이후엔 저장된 로그인으로 봇이 자동 진행해요)</span>
      </div>
    )}
    {accounts.map((acc, i) => (
      <div key={acc.accountId} style={{ marginBottom: 12, padding: "14px 16px", borderRadius: 14, border: `2px solid ${acc.sessionOk ? "rgba(0,214,143,.5)" : "var(--border)"}`, background: acc.sessionOk ? "rgba(0,214,143,.06)" : "var(--bg)", transition: "border .2s" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
          <div style={{ width: 10, height: 10, borderRadius: "50%", background: acc.sessionOk ? "var(--success)" : "var(--border)", flexShrink: 0, boxShadow: acc.sessionOk ? "0 0 8px var(--success)" : "none", transition: "all .3s" }} />
          <span style={{ fontSize: 13, fontWeight: 700, color: "var(--text2)" }}>계정 {i + 1}</span>
          {acc.blogId && <span style={{ fontSize: 12, color: "var(--success)", fontWeight: 600 }}>• {acc.blogId}</span>}
          {acc.sessionOk && <span style={{ fontSize: 11, color: "var(--success)", marginLeft: 2 }}>연결됨 ✓</span>}
          <button onClick={() => { if (window.confirm("이 계정을 삭제할까요? (저장된 로그인도 함께 삭제됩니다)")) onRemove(acc.accountId); }}
            style={{ marginLeft: "auto", padding: "4px 10px", borderRadius: 7, border: "1px solid rgba(255,71,87,.4)", background: "rgba(255,71,87,.08)", color: "var(--danger)", cursor: "pointer", fontSize: 12, fontWeight: 700, display: "flex", alignItems: "center", gap: 3 }}>
            🗑 삭제
          </button>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 10 }}>
          <input className="inp" placeholder="네이버 아이디" value={acc.id}
            onChange={e => onChange(acc.accountId, "id", e.target.value)}
            onKeyDown={e => { if (e.key === "Enter" && acc.id && acc.pw && !acc.loginLoading) onLogin(acc.accountId); }}
            style={{ fontSize: 13, padding: "10px 12px" }} />
          <div style={{ position: "relative" }}>
            <input className="inp" type={acc.showPw ? "text" : "password"} placeholder="비밀번호" value={acc.pw}
              onChange={e => onChange(acc.accountId, "pw", e.target.value)}
              onKeyDown={e => { if (e.key === "Enter" && acc.id && acc.pw && !acc.loginLoading) onLogin(acc.accountId); }}
              style={{ fontSize: 13, padding: "10px 36px 10px 12px", width: "100%" }} />
            <button onClick={() => onChange(acc.accountId, "showPw", !acc.showPw)}
              style={{ position: "absolute", right: 8, top: "50%", transform: "translateY(-50%)", background: "transparent", border: "none", cursor: "pointer", fontSize: 15, color: "var(--text3)", padding: 2 }}>
              {acc.showPw ? "🙈" : "👁️"}
            </button>
          </div>
        </div>
        <button onClick={() => onLogin(acc.accountId)} disabled={acc.loginLoading || !acc.id || !acc.pw}
          style={{ width: "100%", padding: "11px", borderRadius: 10, border: "none", background: acc.sessionOk ? "rgba(0,214,143,.18)" : "var(--accent)", color: acc.sessionOk ? "var(--success)" : "#000", cursor: acc.loginLoading || !acc.id || !acc.pw ? "not-allowed" : "pointer", fontSize: 13, fontWeight: 800, fontFamily: "inherit", transition: "all .2s", opacity: acc.loginLoading || !acc.id || !acc.pw ? 0.6 : 1 }}>
          {acc.loginLoading ? "🔄 로그인 중..." : acc.sessionOk ? "✅ 연결됨 (재연결)" : "🔗 계정 연결하기"}
        </button>
      </div>
    ))}
    <button onClick={onAdd} style={{ width: "100%", padding: "11px", borderRadius: 10, border: "2px dashed var(--border)", background: "transparent", color: "var(--text3)", cursor: "pointer", fontSize: 13, fontWeight: 700, fontFamily: "inherit", transition: "border-color .2s" }}>
      + 계정 추가
    </button>
  </div>
  );
});

/* ── 계정 선택기: 단탭(서이추·공감댓글·답방·지수)에서 연결된 계정이 2개 이상일 때 작업할 계정 하나를 고른다 ── */
const AccountSelector = ({ accounts, selectedId, onSelect }: {
  accounts: Account[]; selectedId: string; onSelect: (id: string) => void;
}) => {
  const connected = accounts.filter(a => a.sessionOk);
  if (connected.length < 2) return null;   // 연결 계정이 1개뿐이면 고를 필요 없음
  return (
    <div className="card" style={{ padding: "14px 16px" }}>
      <div style={{ fontSize: 13, fontWeight: 800, color: "var(--text)", marginBottom: 3 }}>👤 이 작업에 쓸 계정</div>
      <div style={{ fontSize: 11, color: "var(--text3)", marginBottom: 10, lineHeight: 1.5 }}>연결된 계정 중 <b>이번 작업에 사용할 계정</b>을 골라주세요. (탭마다 계정은 따로 관리돼요)</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
        {connected.map(a => {
          const on = selectedId === a.accountId;
          return (
            <button key={a.accountId} onClick={() => onSelect(a.accountId)} style={{ display: "flex", alignItems: "center", gap: 9, padding: "11px 13px", borderRadius: 10, border: `2px solid ${on ? "var(--accent)" : "var(--border)"}`, background: on ? "var(--accent-bg)" : "var(--bg)", color: on ? "var(--accent-text)" : "var(--text)", cursor: "pointer", fontFamily: "inherit", textAlign: "left", transition: "all .15s" }}>
              <span style={{ fontSize: 15 }}>{on ? "🟢" : "⚪"}</span>
              <span style={{ fontSize: 13.5, fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{a.blogId || a.id || a.accountId}</span>
              {on && <span style={{ marginLeft: "auto", fontSize: 11, fontWeight: 800 }}>선택됨</span>}
            </button>
          );
        })}
      </div>
    </div>
  );
};

/* ── 계정 영역 아코디언: 계정이 여러 개면 접어서 아래 기능이 안 밀리게(헤더 클릭 시 펼침/접힘) ── */
const AccountAccordion = ({ accounts, open, setOpen, tabName, accountLimit, isUnlimited, children }: {
  accounts: Account[]; open: boolean; setOpen: (v: boolean) => void; tabName: string; accountLimit: number; isUnlimited: boolean; children: React.ReactNode;
}) => {
  const connected = accounts.filter(a => a.sessionOk).length;
  // 계정이 적으면(2개 이하) 그냥 펼쳐 보여줌. 3개 이상이면 접이식.
  const collapsible = accounts.length >= 3;
  const expanded = collapsible ? open : true;
  return (
    <div className="card" style={{ padding: collapsible ? "0" : "0", overflow: "hidden" }}>
      {collapsible && (
        <button onClick={() => setOpen(!open)} style={{ width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, padding: "14px 16px", background: "transparent", border: "none", cursor: "pointer", fontFamily: "inherit" }}>
          <span style={{ fontSize: 13.5, fontWeight: 800, color: "var(--text)" }}>👤 {tabName} 계정 <span style={{ color: "#00c896" }}>{accounts.length}</span>개 <span style={{ fontSize: 11, color: "var(--text3)", fontWeight: 600 }}>· 연결됨 {connected}개</span></span>
          <span style={{ fontSize: 13, color: "var(--accent-text)", fontWeight: 800, transform: expanded ? "rotate(180deg)" : "none", transition: "transform .2s" }}>▾</span>
        </button>
      )}
      <div style={{ display: expanded ? "flex" : "none", flexDirection: "column", gap: 14, padding: collapsible ? "0 12px 14px" : "0" }}>
        {children}
      </div>
    </div>
  );
};

/* ── 방문자 수 필터: 서이추·공감댓글에서 대상 블로그를 방문자 규모로 거른다(공개 API 기반) ── */
const VisitorFilter = ({ min, max, setMin, setMax }: { min: number; max: number; setMin: (n: number) => void; setMax: (n: number) => void }) => {
  const presets = [{ v: 0, t: "전체" }, { v: 1000, t: "1천↑" }, { v: 3000, t: "3천↑" }, { v: 5000, t: "5천↑" }, { v: 10000, t: "1만↑" }];
  return (
    <div className="card" style={{ padding: "14px 16px" }}>
      <div style={{ fontSize: 13, fontWeight: 800, color: "var(--text)", marginBottom: 3 }}>👥 방문자 수로 대상 고르기</div>
      <div style={{ fontSize: 11, color: "var(--text3)", marginBottom: 10, lineHeight: 1.5 }}>최근 방문자가 <b>이 범위인 블로그에만</b> 작업해요. 활발한 블로그를 고르면 효과가 좋아요. <b>(0 = 제한 없음)</b></div>
      <div style={{ display: "flex", gap: 5, flexWrap: "wrap", marginBottom: 8 }}>
        {presets.map(o => (
          <button key={o.v} onClick={() => setMin(o.v)} style={{ flex: "1 1 auto", padding: "8px 4px", borderRadius: 9, border: `2px solid ${min === o.v ? "var(--accent)" : "var(--border)"}`, background: min === o.v ? "var(--accent-bg)" : "transparent", color: min === o.v ? "var(--accent-text)" : "var(--text2)", cursor: "pointer", fontSize: 11.5, fontWeight: 800, fontFamily: "inherit", minWidth: 0 }}>{o.t}</button>
        ))}
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "var(--text2)", flexWrap: "wrap" }}>
        <span style={{ fontWeight: 700 }}>직접</span>
        <input className="inp" type="number" min={0} value={min} onChange={e => setMin(Math.max(0, parseInt(e.target.value) || 0))} style={{ width: 78, fontSize: 13, padding: "7px 8px", textAlign: "center" }} placeholder="최소" />
        <span>명 이상 ~</span>
        <input className="inp" type="number" min={0} value={max} onChange={e => setMax(Math.max(0, parseInt(e.target.value) || 0))} style={{ width: 78, fontSize: 13, padding: "7px 8px", textAlign: "center" }} placeholder="최대" />
        <span style={{ fontSize: 11, color: "var(--text3)" }}>명 이하 (0=무제한)</span>
      </div>
      <div style={{ fontSize: 10.5, color: "var(--text3)", lineHeight: 1.5, marginTop: 7 }}>💡 방문자 수를 못 읽는 블로그는 그냥 진행해요(놓치지 않게). 방문자는 공개 정보라 계정 연결 없이도 확인해요.</div>
    </div>
  );
};

/* ── 검색 경유 진입 토글: URL 직행 대신 네이버 검색→클릭으로 들어가 "검색 유입"을 만든다(홈판·지수에 유리) ── */
const SearchEntryToggle = ({ on, set, extra }: { on: boolean; set: (v: boolean) => void; extra?: React.ReactNode }) => (
  <div className="card" style={{ padding: "14px 16px", border: `1.5px solid ${on ? "rgba(59,130,246,.4)" : "var(--border)"}`, background: on ? "rgba(59,130,246,.06)" : "var(--card)" }}>
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 800, color: "var(--text)" }}>🔎 검색으로 들어가기 <span style={{ fontSize: 10, color: "#3b82f6", fontWeight: 700 }}>추천</span></div>
        <div style={{ fontSize: 11, color: "var(--text3)", marginTop: 3, lineHeight: 1.5 }}>바로 주소로 가지 않고 <b>네이버 검색을 거쳐</b> 들어가요. 상대 블로그에 <b style={{ color: "#3b82f6" }}>검색 유입</b>이 남아 더 자연스럽고 노출에 도움돼요.</div>
      </div>
      <button onClick={() => set(!on)} style={{ flexShrink: 0, width: 52, height: 30, borderRadius: 99, border: "none", background: on ? "#3b82f6" : "var(--border)", cursor: "pointer", position: "relative", transition: "background .2s" }}>
        <span style={{ position: "absolute", top: 3, left: on ? 25 : 3, width: 24, height: 24, borderRadius: "50%", background: "#fff", transition: "left .2s" }} />
      </button>
    </div>
    {on && extra}
    {on && <div style={{ fontSize: 10.5, color: "var(--text3)", lineHeight: 1.5, marginTop: 8 }}>💡 검색 결과에 그 글이 없으면(아직 노출 전) 자동으로 주소로 들어가요 — 놓치지 않아요. 검색을 거치니 조금 더 느려요.</div>}
  </div>
);

/* ── 등급별 한도표(재사용) — 각 탭에 맞는 컬럼·행을 받아 내 등급 행을 강조해서 보여준다 ── */
const TierTable = ({ title, desc, cols, rows, myPlan, note, accent = "#ec4899" }: {
  title: string; desc: string; cols: string[]; rows: { key: string; name: string; vals: string[] }[]; myPlan: string; note?: string; accent?: string;
}) => {
  const grid = { display: "grid", gridTemplateColumns: `1.1fr ${cols.slice(1).map(() => "1fr").join(" ")}`, alignItems: "center", gap: 4 } as const;
  return (
    <div className="card" style={{ padding: "14px 16px" }}>
      <div style={{ fontSize: 13, fontWeight: 800, color: "var(--text)", marginBottom: 3 }}>📋 {title}</div>
      <div style={{ fontSize: 11, color: "var(--text3)", marginBottom: 10, lineHeight: 1.5 }}>{desc}</div>
      <div style={{ ...grid, padding: "0 8px 6px", fontSize: 10.5, color: "var(--text3)", fontWeight: 700 }}>
        {cols.map((c, i) => <span key={i} style={i === 0 ? {} : { textAlign: "center" }}>{c}</span>)}
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
        {rows.map(r => {
          const mine = r.key === myPlan;
          return (
            <div key={r.key} style={{ ...grid, padding: "9px 8px", borderRadius: 9, background: mine ? `${accent}1f` : "var(--bg)", border: `1.5px solid ${mine ? accent : "var(--border)"}`, fontSize: 12.5 }}>
              <span style={{ fontWeight: 800, color: mine ? accent : "var(--text2)" }}>{r.name}{mine && <span style={{ fontSize: 9.5, marginLeft: 4, color: accent, fontWeight: 700 }}>내 등급</span>}</span>
              {r.vals.map((v, i) => <span key={i} style={{ textAlign: "center", fontWeight: mine ? 800 : 600, color: mine ? "var(--text)" : "var(--text2)" }}>{v}</span>)}
            </div>
          );
        })}
      </div>
      {note && <div style={{ fontSize: 10.5, color: "var(--text3)", lineHeight: 1.5, marginTop: 9 }}>💡 {note}</div>}
    </div>
  );
};

/* ── 사용설명서 내용 ── */
const GUIDE = {
  neighbor: [
    { step: "1", title: "계정 연결", desc: "네이버 아이디/비밀번호 입력 후 '계정 연결' 클릭 → 브라우저 창이 열리며 자동 로그인됩니다." },
    { step: "2", title: "키워드 입력", desc: "서이추할 블로그를 찾을 키워드를 쉼표로 구분해 입력하세요.\n예) 원주맛집, 강원도여행, 육아일기" },
    { step: "3", title: "추출 시작", desc: "'🔍 추출 시작' 클릭 → 키워드로 블로그를 검색해 대상 목록을 자동으로 만듭니다." },
    { step: "4", title: "서이추 멘트 설정", desc: "신청할 때 보낼 메시지를 작성하세요. 다중 멘트는 순서대로 돌아가며 사용됩니다." },
    { step: "5", title: "작업 시작", desc: "'🚀 작업 시작' 클릭 → 수집된 블로그에 자동으로 서이추 신청합니다.\n딜레이를 5~10초로 설정하면 봇 탐지를 피할 수 있어요." },
    { step: "팁", title: "재사용", desc: "📂 리스트 불러오기로 저장해둔 CSV 파일을 불러올 수 있어요.\n'완료된 블로그 스킵' 켜두면 중복 신청이 방지됩니다." },
  ],
  engage: [
    { step: "1", title: "계정 연결", desc: "이 탭(공감·댓글)에서 쓸 네이버 계정을 연결하세요. 탭마다 계정은 따로 관리돼요(서이추·답방과 별도)." },
    { step: "2", title: "키워드 입력", desc: "공감·댓글을 남길 블로그를 찾을 키워드를 입력하세요.\n서이추 탭과 별도로 관리됩니다." },
    { step: "3", title: "기간 설정", desc: "최근 7일 / 14일 / 30일 / 직접 입력 중 선택하세요.\n선택한 기간 내에 작성된 글에만 공감·댓글을 달아줍니다." },
    { step: "4", title: "작업 종류 선택", desc: "❤️ 공감 / 💬 댓글 각각 켜고 끌 수 있어요.\n댓글을 켜면 아래에 내용 입력란이 나타납니다." },
    { step: "5", title: "댓글 내용 작성", desc: "단일 댓글이나 여러 댓글을 줄바꿈으로 구분해 입력하면 순서대로 사용됩니다.\n예) 좋은 글 감사해요 😊\n자주 놀러올게요! ✨" },
    { step: "6", title: "추출 후 작업", desc: "'🔍 추출 시작' → '🚀 작업 시작' 순서로 진행하거나\n'추출 완료 후 바로 작업 시작' 옵션을 켜면 자동으로 이어집니다." },
  ],
  reply: [
    { step: "1", title: "계정 연결", desc: "답방할 내 네이버 블로그 계정을 이 탭에 연결하세요. 탭마다 계정은 따로 관리돼요." },
    { step: "2", title: "확인할 글 수 설정", desc: "내 블로그 최근 글 몇 개까지 댓글을 확인할지 정하세요.\n예) 10개 → 최근 글 10개에 달린 댓글을 훑어봅니다." },
    { step: "3", title: "답글 방식 선택", desc: "✨ AI 자동: 댓글 내용을 읽고 맞춤 답글을 매번 다르게 생성해요.\n✍️ 고정 답글: 미리 써둔 문구로 답합니다." },
    { step: "4", title: "미답변만 / 전체", desc: "'아직 답글 없는 댓글만' 켜면 이미 답한 댓글은 건너뛰어 중복 답글을 막아요." },
    { step: "5", title: "답방 시작", desc: "'🚀 답방 시작' 클릭 → 내 글 댓글에 순서대로 대댓글을 자동으로 답니다.\n딜레이를 5~10초로 두면 자연스러워요." },
    { step: "팁", title: "왜 답방이 중요한가요?", desc: "댓글에 답글을 달면 이웃과 소통이 활발해지고, 블로그 체류·재방문이 늘어 블로그 지수에 좋아요." },
  ],
  score: [
    { step: "1", title: "계정 연결", desc: "진단할 내 네이버 블로그 계정을 이 탭에 연결하세요. 탭마다 계정은 따로 관리돼요." },
    { step: "2", title: "진단 시작", desc: "'📈 블로그 진단 시작'을 누르면 봇이 내 블로그의 실제 지표를 읽어와 건강 리포트를 만들어요.\n(등급에 따라 하루 진단 횟수가 정해져 있고, 자정에 초기화돼요.)" },
    { step: "3", title: "🔴 검색 노출 진단 (핵심)", desc: "내 최근 글 제목을 실제로 네이버에 검색해 '내 글이 뜨는지'를 확인해요.\n안 뜨는 글(누락)이 많으면 '저품질 의심'으로 알려드려요. 저품질 조기경보예요." },
    { step: "4", title: "✏️ 제목·키워드 살리기", desc: "두 갈래로 나뉘어요. ①미노출(100위 밖) 글은 '오래된 글 재발행'에서 살리고, ②이미 100위 안에 뜬 글은 '제목·키워드 솔루션'에서 더 위로 올려요. 서로 안 겹쳐요. (무료 Gemini 키 필요)" },
    { step: "5", title: "👥 방문자·유입 확인", desc: "최근 방문자 추이(급감 여부)와 사람들이 어떤 키워드로 들어오는지 볼 수 있어요.\n내가 뭘로 노출되는지 알면 그 주제를 더 키울 수 있어요." },
    { step: "팁", title: "등급별 검사 개수", desc: "검색 노출 검사는 하루 검사 글 수가 등급별로 달라요(무료 5·베이직 10·프로 20개, 무제한은 전체).\n이미 검사한 글은 건너뛰고 새 글부터 검사하니, 매일 진단하면 전체 글을 골고루 살펴봐요." },
    { step: "팁", title: "네이버 공식 지수가 아니에요", desc: "네이버는 공식 '지수'를 공개하지 않아요. 이 진단은 실제 검색 결과·방문 데이터를 바탕으로 한 퍼블리 자체 건강검진으로, 블로그 관리 방향을 잡는 용도예요." },
  ],
  pumasi: [
    { step: "1", title: "계정 2개 이상 연결", desc: "품앗이에 사용할 내 네이버 계정을 등록하고 한 번씩 연결해 세션을 저장하세요." },
    { step: "2", title: "계정별 글 수·받을 수 설정", desc: "대상 글 수는 계정마다 최근 몇 개 글을 돌지, 받을 수는 최대 몇 개의 다른 계정에게 방문·공감·댓글을 받을지 정해요. 기본은 각각 3이에요." },
    { step: "3", title: "공감·댓글 방식 설정", desc: "공감과 댓글을 켜고, 고정·순환·AI 맞춤 댓글 중 원하는 방식을 고르세요." },
    { step: "4", title: "자연스러운 방문 강화(선택)", desc: "체류시간 엔진은 글 분량을 읽어 짧은 글은 빨리·긴 글은 오래 머물러요(자동). 관련 글 1편 더 읽기를 켜면 댓글 뒤 다른 글도 읽어 진짜 방문자처럼 보여요. 시간 분산은 전체 방문을 정한 시간(분 단위)에 고르게 나눠 투데이 폭증을 막아 더 안전해요. (계정당이 아니라 전체를 합친 시간이에요)" },
    { step: "5", title: "품앗이 시작", desc: "봇이 계정을 자동 전환하며 상대 계정의 실제 글을 읽고 공감·댓글을 남겨요. 받을 수에 도달한 계정은 더 방문하지 않고, 최근 안 간 계정부터 골고루 순환해요." },
    { step: "6", title: "효과 리포트로 확인", desc: "우측 '품앗이 효과 리포트'에서 방문자 추이 위에 품앗이한 날을 표시해요. 실제로 도움이 됐는지 보고 과도하게 하지 않도록 조절하세요." },
    { step: "팁", title: "과도한 집중을 피하세요", desc: "받을 수를 낮게 유지하고 딜레이를 넉넉히, 시간 분산을 활용하세요. 많은 계정이 한 글에 한꺼번에 몰리는 패턴은 피하는 게 안전해요." },
  ],
};

/* ── 사용설명서 모달 ── */
const GuideModal = ({ tab, onClose }: { tab: "neighbor"|"engage"|"reply"|"score"|"pumasi"; onClose: () => void }) => {
  const steps = (GUIDE as any)[tab] ?? [];
  const title = tab === "neighbor" ? "🤝 서이추 사용방법" : tab === "engage" ? "❤️ 공감·댓글 사용방법" : tab === "reply" ? "💬 답방 사용방법" : tab === "pumasi" ? "💞 품앗이 사용방법" : "📈 블로그 건강검진";
  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.6)", zIndex: 9999, display: "flex", alignItems: "flex-start", justifyContent: "center", padding: "60px 20px 20px", overflowY: "auto" }}>
      <div onClick={e => e.stopPropagation()} style={{ background: "var(--card)", borderRadius: 20, padding: "28px 32px", maxWidth: 560, width: "100%", boxShadow: "0 20px 60px rgba(0,0,0,.4)" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 24 }}>
          <div style={{ fontSize: 18, fontWeight: 900, color: "var(--text)" }}>{title}</div>
          <button onClick={onClose} style={{ width: 32, height: 32, borderRadius: 10, border: "1px solid var(--border)", background: "transparent", color: "var(--text3)", cursor: "pointer", fontSize: 16, display: "flex", alignItems: "center", justifyContent: "center" }}>×</button>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          {steps.map(({ step, title, desc }: { step: string; title: string; desc: string }) => (
            <div key={step} style={{ display: "flex", gap: 14, padding: "16px", borderRadius: 14, background: "var(--bg2)", border: "1px solid var(--border)" }}>
              <div style={{ width: 36, height: 36, borderRadius: 10, background: step === "팁" ? "rgba(255,183,0,.15)" : "var(--accent-bg)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 900, color: step === "팁" ? "#ffb700" : "var(--accent-text)", flexShrink: 0, border: `1px solid ${step === "팁" ? "rgba(255,183,0,.3)" : "var(--accent)"}` }}>
                {step === "팁" ? "💡" : `0${step}`}
              </div>
              <div>
                <div style={{ fontSize: 14, fontWeight: 800, color: "var(--text)", marginBottom: 6 }}>{title}</div>
                <div style={{ fontSize: 13, color: "var(--text2)", lineHeight: 1.7, whiteSpace: "pre-line" }}>{desc}</div>
              </div>
            </div>
          ))}
        </div>
        <button onClick={onClose} style={{ width: "100%", marginTop: 20, padding: "13px", borderRadius: 12, border: "none", background: "var(--accent)", color: "#000", cursor: "pointer", fontSize: 14, fontWeight: 800, fontFamily: "inherit" }}>
          확인했어요!
        </button>
      </div>
    </div>
  );
};

/* ♻️ 재발행 기간 '구간' — 누적(이내)이 아니라 겹치지 않는 구간이라 버튼마다 다른 글이 뜬다.
   min은 포함, max는 미포함. 발행 14일 이내(INDEX_GRACE_DAYS)는 색인 대기라 어느 구간에도 안 넣는다. */
const REPUBLISH_BANDS: { k: string; label: string; min: number; max: number }[] = [
  { k: "15_30", label: "15~30일", min: INDEX_GRACE_DAYS, max: 30 },
  { k: "30_60", label: "30~60일", min: 30, max: 60 },
  { k: "60_90", label: "60~90일", min: 60, max: 90 },
  { k: "90plus", label: "90일 이상", min: 90, max: Infinity },
];

/* ── 메인 컴포넌트 ── */
export default function NeighborPage({ theme, userId, plan = "free", initialTab, singleTab, isActive = true, onEngageUsageChange, initialNeighborUsed = 0, initialEngageUsed = 0, onBusyChange }: Props) {
  const [tab, setTab] = useState<"neighbor"|"engage"|"reply"|"score"|"pumasi">(initialTab || "neighbor");
  // ★탭별 계정·세션 완전 격리(2026-08-23): 서이추·공감댓글·답방·품앗이·지수가 각각 자기 계정 목록과 세션을 따로 갖는다.
  //   한 탭에서 연결해도 다른 탭엔 공유되지 않음. accountId에 tabKey를 붙여 봇 세션(naver_{accountId})까지 자동 격리.
  const tabKey = initialTab || "neighbor";
  const ACCTS_LS_KEY = `publy_accounts_${tabKey}`;
  const mkAccId = () => `${tabKey}_acc_${Date.now()}`;
  // ── 답방(내 블로그 댓글에 대댓글) 상태 ──
  const [rTargetPosts, setRTargetPosts] = useState(10);   // '최근 개수' 방식일 때 글 수
  const [rSelectMode, setRSelectMode] = useState<"count"|"all"|"period">("count"); // 대상 글 선택 방식
  const [rPeriod, setRPeriod] = useState<7|14|30|"custom">(7);   // '기간' 방식일 때 최근 N일
  const [rCustomDays, setRCustomDays] = useState(3);            // 직접 기간설정(일)
  const [rMyPosts, setRMyPosts] = useState<{url:string;title:string;date:string;comments?:number}[]>([]); // 불러온 내 글 목록
  const [rLoadingPosts, setRLoadingPosts] = useState(false);
  const [rMode, setRMode] = useState<"ai"|"fixed">("ai");
  const [rComment, setRComment] = useState(
    "댓글 감사합니다 😊 자주 놀러오세요!\n" +
    "방문해주셔서 감사해요, 좋은 하루 보내세요!\n" +
    "따뜻한 댓글 남겨주셔서 고맙습니다 🙏\n" +
    "들러주셔서 감사해요, 또 뵈어요~\n" +
    "소중한 댓글 감사합니다, 힘이 나네요!\n" +
    "읽어주시고 댓글까지 정말 감사해요 😊\n" +
    "공감해주셔서 감사합니다, 반가웠어요!\n" +
    "관심 가져주셔서 고마워요, 또 들러주세요!\n" +
    "응원 감사합니다, 더 좋은 글로 보답할게요!\n" +
    "댓글 보고 미소 지었어요, 고맙습니다 😊\n" +
    "함께해주셔서 감사해요, 자주 소통해요!\n" +
    "오늘도 좋은 하루 보내세요, 댓글 고마워요!\n" +
    "덕분에 기운이 나네요, 감사합니다!\n" +
    "정성스러운 댓글 감사해요, 행복한 하루 되세요!\n" +
    "이렇게 와주시니 반갑네요, 종종 놀러오세요!\n" +
    "댓글 하나하나 큰 힘이 돼요, 고맙습니다 🙏\n" +
    "방문 감사드려요, 좋은 인연 이어가요~\n" +
    "따뜻한 한마디에 하루가 밝아지네요, 감사해요!\n" +
    "잘 보고 가신다니 저도 기뻐요, 고맙습니다 😊\n" +
    "바쁘실 텐데 들러주셔서 감사해요!\n" +
    "좋게 봐주셔서 감사합니다, 자주 뵐게요!\n" +
    "댓글 남겨주셔서 감사해요, 편안한 하루 보내세요!\n" +
    "반가운 댓글 고맙습니다, 또 소통해요~\n" +
    "관심과 응원 감사해요, 늘 건강하세요!\n" +
    "덕분에 블로그 하는 재미가 나요, 고맙습니다 😊\n" +
    "방문해주신 것만으로 감사한데 댓글까지, 감동이에요!\n" +
    "좋은 하루 보내시고 또 놀러오세요, 감사합니다!\n" +
    "따뜻한 관심 감사드려요, 행복 가득한 하루 되세요!\n" +
    "댓글 정말 감사해요, 다음 글도 기대해주세요!\n" +
    "함께 소통할 수 있어 기뻐요, 고맙습니다 🙏"
  );
  const [rTone, setRTone] = useState<"담백"|"다정"|"짧게">("다정");
  const [rOnlyNew, setROnlyNew] = useState(true);          // 아직 답글 없는 댓글만
  const [rReplyToReplies, setRReplyToReplies] = useState(false);   // 대대댓글에도 딱 1번만 더 답하기
  const [rDelayMin, setRDelayMin] = useState(5);
  const [rDelayMax, setRDelayMax] = useState(10);
  const [rWorking, setRWorking] = useState(false);
  const [rLogs, setRLogs] = useState<string[]>([]);
  const [rDoneCnt, setRDoneCnt] = useState(0);
  const [rFailCnt, setRFailCnt] = useState(0);
  const rJobIdRef = useRef<string>("");
  const rEsRef = useRef<BotEventStream|null>(null);
  const rLogRef = useRef<HTMLDivElement>(null);
  const addRLog = (m: string) => setRLogs(p => [...p, `${new Date().toLocaleTimeString("ko-KR",{hour12:false})}  ${m}`]);
  // ── 블로그 건강검진 상태 ──
  const [scLoading, setScLoading] = useState(false);
  const [scResult, setScResult] = useState<null | {
    blogId: string; totalPosts: number; neighbors: number; recentDates: string[];
    exposureChecks?: { title: string; exposed: boolean | null; rank: number | null; indexed?: boolean; status?: "exposed" | "low" | "missing"; postUrl?: string; logNo?: string; date?: string }[];
    lowQualitySuspected?: boolean | null;
    visitorDays?: { date: string; visitors: number }[];
    inflowKeywords?: { keyword: string; count?: number }[];
    visitorDrop?: { detected: boolean; rate: number | null; message: string } | null;
    activity?: { level: "active" | "normal" | "inactive"; daysSinceLast: number | null; postsIn7d: number; postsIn30d: number; message: string } | null;
    totalPostsForExposure?: number;
    checkedTodayCount?: number;
    exposureCompletedCount?: number;
    exposureLimit?: number | null;
  }>(null);
  const [scLogs, setScLogs] = useState<string[]>([]);
  const scLogRef = useRef<HTMLDivElement>(null);
  const addScLog = (m: string) => setScLogs(p => [...p, `${new Date().toLocaleTimeString("ko-KR",{hour12:false})}  ${m}`]);
  // ── 저품질/누락 글 제목·키워드 개선 솔루션(AI) ──
  const [scSolLoading, setScSolLoading] = useState(false);
  const [scSolutions, setScSolutions] = useState<null | { original: string; logNo: string; diagnosis: string; newTitle: string; newTitle2: string; keywords: string[]; bodyTip: string; expectedEffect: string; reason: string }[]>(null);
  // ★제목 자동수정 상태
  const [titleEditUsed, setTitleEditUsed] = useState(0);
  const [titleEditLimit, setTitleEditLimit] = useState(3);
  const [titleEditingKey, setTitleEditingKey] = useState<string>("");   // 지금 수정 중인 "logNo|번호"
  // ★재발행 알림: 기간을 '구간'으로 선택(누적 아님 → 15~30/30~60/60~90/90+ 가 서로 안 겹쳐 구분됨). 발행 14일 이내는 색인 대기라 제외.
  const [republishBand, setRepublishBand] = useState<string>(() => localStorage.getItem("publy_republish_band") || "15_30");
  // 🚀 전체 제목 자동 변경(관찰중 제외 · 제목1·2 랜덤 · 한도 걸리면 업그레이드 팝업)
  const [bulkRunning, setBulkRunning] = useState(false);
  const [bulkProgress, setBulkProgress] = useState({ done: 0, total: 0 });
  const [bulkUpgrade, setBulkUpgrade] = useState<{ done: number; left: number } | null>(null);   // 한도 도달 업그레이드 팝업
  const bulkStopRef = useRef(false);
  const [rpChecked, setRpChecked] = useState<Set<string>>(new Set());   // 재발행 목록 체크박스로 고른 logNo
  // 🩺 수정추적에서 '제목 변경' → 개선안 받아 별도 모달로 제목1·2 보여주고 거기서 변경(관찰중 글은 재발행 목록에 없어 펼칠 곳이 없음)
  const [trackSol, setTrackSol] = useState<{ item: { title: string; logNo?: string; blogId?: string }; loading: boolean; sol: { diagnosis: string; newTitle: string; newTitle2: string; keywords: string[]; bodyTip: string; expectedEffect: string } | null } | null>(null);
  const [rpBusyLog, setRpBusyLog] = useState<string>("");   // 재발행 목록에서 지금 제목 바꾸는 중인 글의 logNo
  // 재발행 목록에서 글별로 받은 개선안(제목1·2+진단·키워드·팁) — logNo → 솔루션
  const [rpSolutions, setRpSolutions] = useState<Record<string, { original: string; logNo: string; diagnosis: string; newTitle: string; newTitle2: string; keywords: string[]; bodyTip: string; expectedEffect: string }>>({});
  const [rpTick, setRpTick] = useState(0);                   // 재발행 목록 새로고침 트리거
  const [rpSpin, setRpSpin] = useState(false);               // 재발행 새로고침 버튼 회전 애니(눌린 느낌)
  const [republishShow, setRepublishShow] = useState(12);   // 재발행 목록 몇 개까지 보이기(더 보기)
  // 🩺 주치의 진료차트: logNo → PostCare (검사·개선안·수정 이력). 관찰중 글을 "기다리세요"로 표시해 무한루프 차단.
  const [careMap, setCareMap] = useState<Record<string, PostCare>>({});
  const [celebrate, setCelebrate] = useState<PostCare[] | null>(null);   // 🎉 완치(노출) 축포 세리머니 대상
  // 🆕 수정 추적 대시보드
  const [trackOpen, setTrackOpen] = useState(false);        // 리스트 펼침
  const [trackPage, setTrackPage] = useState(0);
  const [rankChecking, setRankChecking] = useState<string>("");   // 지금 순위 검사 중인 postKey
  const [liveRanks, setLiveRanks] = useState<Record<string, { rank: number | null; at: number }>>({});   // postKey → 방금 검사한 실시간 순위
  const [autoTrackLoading, setAutoTrackLoading] = useState(false);   // 🩺 추적글 순위 자동 일괄검사 중(회원이 버튼 안 눌러도 알아서)
  const [autoViewsLoading, setAutoViewsLoading] = useState(false);   // 🩺 P4: 글별 조회수 자동 수집 중
  const autoViewsStartedRef = useRef<string>("");   // 조회수 자동수집도 계정당 하루 1회
  const [careListOpen, setCareListOpen] = useState<""|"todo"|"indexing"|"observing"|"cured">("");   // 🩺 회진 칩 클릭 → 해당 글 리스트 펼침
  const autoTrackStartedRef = useRef<string>("");   // `${accountId}:${today}` — 계정당 하루 1회만 자동검사(중복·무한루프 차단)
  const TRACK_PAGE_SIZE = 8;
  // 🎉 블로그지수 웰컴 팝업(진입 시 팡!) — 7일 보지않기(localStorage until)
  const [welcome, setWelcome] = useState(false);
  useEffect(() => {
    if (!isActive || tab !== "score") return;
    const until = Number(localStorage.getItem("publy_blogscore_welcome_until") || "0");
    if (Date.now() > until) setWelcome(true);
  }, [isActive, tab]);
  const closeWelcome = (week?: boolean) => {
    if (week) localStorage.setItem("publy_blogscore_welcome_until", String(Date.now() + 7 * 86400000));
    setWelcome(false);
  };
  const [scSolPage, setScSolPage] = useState(0);   // AI 팁 페이지네이션(5개 단위)
  const [scSolSearch, setScSolSearch] = useState(""); // AI 팁 원래 제목 검색
  const [scExpPage, setScExpPage] = useState(0);   // 검색노출 결과 페이지네이션(30개 단위)
  const [scExpSearch, setScExpSearch] = useState(""); // 검색노출 결과 제목 검색
  const [scRankFilter, setScRankFilter] = useState<"all"|"t10"|"t20"|"t50"|"t100"|"out"|"missing">("all");   // 순위 구간 필터(10/20/50/100위 이내·100위 밖·색인 누락)
  const [scPostPage, setScPostPage] = useState(0);    // 검사할 글 목록 페이지네이션(30개 단위)
  const [scPostSearch, setScPostSearch] = useState(""); // 검사할 글 제목 검색
  const [scPostMode, setScPostMode] = useState<"period"|"all">("period");
  const [scPeriod, setScPeriod] = useState<7|14|30|"custom">(7);
  const [scCustomDays, setScCustomDays] = useState(7);
  // 🩺 AEO 형식 진단: 최근 글 본문을 읽어 도입요약·FAQ·구조화를 갖췄는지 체크(logNo→결과)
  const [aeoResults, setAeoResults] = useState<{ logNo: string; title: string; passed: number; checks: { key:string; label:string; ok:boolean; hint:string }[]; error?: string }[]>([]);
  const [aeoLoading, setAeoLoading] = useState(false);
  const [reviveChecked, setReviveChecked] = useState<Set<string>>(new Set());
  const [reviveBulk, setReviveBulk] = useState<{running:boolean;done:number;total:number;success:number;failed:number;current?:string}>({running:false,done:0,total:0,success:0,failed:0});
  const reviveBulkStopRef = useRef(false);
  const [scPosts, setScPosts] = useState<{url:string;title:string;date:string}[]>([]);
  const [scSelectedLogNos, setScSelectedLogNos] = useState<string[]>([]);
  const [scPostsLoading, setScPostsLoading] = useState(false);
  const [scExposureLoading, setScExposureLoading] = useState(false);
  // ── 등급별 일일 사용량 (답방·블로그진단) ──
  const isUnlimitedPlan = plan === "unlimited" || plan === "admin";
  const [replyUsed, setReplyUsed] = useState(0);
  const replyLimit = REPLY_DAILY_LIMIT[plan] ?? REPLY_DAILY_LIMIT.free;
  const [scUsed, setScUsed] = useState(0);
  const scLimit = BLOGSCORE_DAILY_LIMIT[plan] ?? BLOGSCORE_DAILY_LIMIT.free;
  const [reviveUsed, setReviveUsed] = useState(0);
  const reviveLimit = REVIVE_DAILY_LIMIT[plan] ?? REVIVE_DAILY_LIMIT.free;
  // ── 품앗이 상태 ──
  const pumasiAccountLimit = PUMASI_ACCOUNT_LIMIT[plan] ?? PUMASI_ACCOUNT_LIMIT.free;  // 등록 가능한 계정 수
  // ★이 탭에 연결 가능한 계정 수 한도(품앗이는 넉넉, 단탭은 무료1·베2·프3·무∞)
  const accountLimit = tabKey === "pumasi" ? pumasiAccountLimit : (TAB_ACCOUNT_LIMIT[plan] ?? TAB_ACCOUNT_LIMIT.free);
  const planLabel = plan === "free" ? "무료" : plan === "basic" ? "베이직" : plan === "pro" ? "프로" : plan === "unlimited" ? "무제한" : plan;
  const tabName = tabKey === "neighbor" ? "서이추" : tabKey === "engage" ? "공감·댓글" : tabKey === "reply" ? "답방" : tabKey === "score" ? "지수" : "품앗이";
  // ★탭별 등급 한도표 데이터 — 각 탭의 모든 등급 제한을 빠짐없이 담는다(무료/베이직/프로).
  const tierTableNode = (() => {
    const myKey = plan;
    if (tabKey === "neighbor") return (
      <TierTable myPlan={myKey} accent="#00b8d4" title="등급별 서이추 한도" desc="내 등급에서 연결 계정 수와 하루 서이추 신청 수를 얼마나 쓸 수 있는지 보여줘요."
        cols={["등급", "연결 계정", "하루 서이추"]}
        rows={[{ key: "free", name: "무료", vals: ["1개", "10건"] }, { key: "basic", name: "베이직", vals: ["2개", "50건"] }, { key: "pro", name: "프로", vals: ["3개", "100건"] }]}
        note="하루 신청 수는 자정에 초기화돼요. 딜레이를 넉넉히 두면 계정이 안전해요." />
    );
    if (tabKey === "engage") return (
      <TierTable myPlan={myKey} accent="#e5397f" title="등급별 공감·댓글 한도" desc="내 등급에서 연결 계정 수와 하루 공감·댓글 수를 얼마나 쓸 수 있는지 보여줘요."
        cols={["등급", "연결 계정", "하루 공감·댓글"]}
        rows={[{ key: "free", name: "무료", vals: ["1개", "10건"] }, { key: "basic", name: "베이직", vals: ["2개", "50건"] }, { key: "pro", name: "프로", vals: ["3개", "100건"] }]}
        note="하루 건수는 자정에 초기화돼요." />
    );
    if (tabKey === "reply") return (
      <TierTable myPlan={myKey} accent="#8b5cf6" title="등급별 답방 한도" desc="내 등급에서 연결 계정 수와 하루 답방(답글) 수를 얼마나 쓸 수 있는지 보여줘요."
        cols={["등급", "연결 계정", "하루 답방"]}
        rows={[{ key: "free", name: "무료", vals: ["1개", "10건"] }, { key: "basic", name: "베이직", vals: ["2개", "50건"] }, { key: "pro", name: "프로", vals: ["3개", "100건"] }]}
        note="하루 답글 수는 자정에 초기화돼요." />
    );
    if (tabKey === "score") return (
      <TierTable myPlan={myKey} accent="#00c896" title="등급별 지수 한도" desc="내 등급에서 진단·검색노출 검사·제목 수정을 하루에 얼마나 쓸 수 있는지 보여줘요."
        cols={["등급", "연결 계정", "하루 진단", "검색노출", "제목 수정", "이 글 살리기"]}
        rows={[{ key: "free", name: "무료", vals: ["1개", "1회", "5개", "3회", "1회"] }, { key: "basic", name: "베이직", vals: ["2개", "5회", "10개", "10회", "3회"] }, { key: "pro", name: "프로", vals: ["3개", "20회", "20개", "30회", "5회"] }]}
        note="진단·검색노출·제목 수정·이 글 살리기는 각각 별도 한도이며 모두 자정에 초기화돼요." />
    );
    return null;
  })();
  const pumasiPostsLimit = PUMASI_POSTS_LIMIT[plan] ?? PUMASI_POSTS_LIMIT.free;        // 계정당 대상 글 수 상한
  const [pumUsed, setPumUsed] = useState(0);                                            // 오늘 품앗이 공감·댓글 건수
  const [pumPostsByAcc, setPumPostsByAcc] = useState<Record<string, number>>({});       // 계정별 남 방문 시 상대 글에 댓글 달 수(주는 양)
  const [pumReceiveByAcc, setPumReceiveByAcc] = useState<Record<string, number>>({});   // 계정별 방문 받을 수
  const [pumNoGive, setPumNoGive] = useState<Record<string, boolean>>({});               // 안 가기(남 방문 안 함, 받기만)
  const [pumNoReceive, setPumNoReceive] = useState<Record<string, boolean>>({});         // 안 받기(방문 안 받음, 가기만)
  const [pumDoLike, setPumDoLike] = useState(true);
  const [pumDoComment, setPumDoComment] = useState(true);
  const [pumCommentMode, setPumCommentMode] = useState<"single"|"multi"|"ai">("ai");
  const [pumComment, setPumComment] = useState("좋은 글 잘 보고 가요 😊");
  const [pumMultiComments, setPumMultiComments] = useState(
    "좋은 글 잘 보고 가요 😊\n" +
    "오늘도 좋은 하루 보내세요!\n" +
    "잘 보고 갑니다 ✨\n" +
    "포스팅 잘 봤어요, 자주 들를게요!\n" +
    "정성이 느껴지는 글이네요 😊\n" +
    "유익한 내용 감사합니다 👍\n" +
    "사진이 참 예쁘네요, 잘 보고 가요!\n" +
    "덕분에 좋은 정보 얻어갑니다~\n" +
    "글이 깔끔해서 읽기 편했어요 😊\n" +
    "공감하며 읽었어요, 응원합니다!\n" +
    "잘 정리된 글이라 도움됐어요 ✨\n" +
    "오늘도 좋은 포스팅 감사해요!\n" +
    "내용이 알차네요, 잘 봤습니다 👍\n" +
    "따뜻한 글 잘 읽고 가요 😊\n" +
    "자주 소통해요, 좋은 하루 되세요!\n" +
    "정보가 유용하네요, 참고할게요~\n" +
    "글 솜씨가 좋으시네요 ✨\n" +
    "잘 보고 갑니다, 다음 글도 기대해요!\n" +
    "읽으면서 많이 배웠어요 😊\n" +
    "구성이 좋아서 보기 편했어요 👍\n" +
    "좋은 정보 나눠주셔서 감사해요!\n" +
    "정성스러운 글 잘 봤습니다 ✨\n" +
    "덕분에 기분 좋아지네요, 고마워요 😊\n" +
    "알찬 포스팅 감사합니다, 응원해요!\n" +
    "핵심이 잘 담겨 있어 좋았어요 👍\n" +
    "편안하게 읽고 갑니다 😊\n" +
    "사진이랑 글이 잘 어울리네요!\n" +
    "다음에 또 놀러올게요 ✨\n" +
    "좋은 하루 보내시고 또 뵈어요 😊\n" +
    "잘 읽었어요, 늘 건강하세요!"
  );
  const [pumTone, setPumTone] = useState<"담백"|"다정"|"짧게">("다정");
  const [pumDelayMin, setPumDelayMin] = useState(8);
  const [pumDelayMax, setPumDelayMax] = useState(15);
  const [pumReadRelated, setPumReadRelated] = useState(true);   // 관련 글 1편 더 읽기(체류·투데이↑)
  const [pumReadRelatedMode, setPumReadRelatedMode] = useState<"always" | "random">("random");  // 매번=각 대상 글마다 / 가끔=확률 60%
  const [pumSpread, setPumSpread] = useState(0);                // 시간 분산(분, 0=즉시 연속). 서버엔 시간으로 변환해 전달
  const [pumWorking, setPumWorking] = useState(false);
  // ★계정 영역 아코디언: 계정 많으면 접어서 아래 기능이 안 밀리게(계정 목록+선택기 함께 접힘)
  const [acctOpen, setAcctOpen] = useState(false);
  const [pumLogs, setPumLogs] = useState<string[]>([]);
  const [pumDone, setPumDone] = useState(0);
  const [pumSkip, setPumSkip] = useState(0);
  const [pumFail, setPumFail] = useState(0);
  const [pumReport, setPumReport] = useState<{ blogId: string; days: { date: string; visitors: number; pumasiVisits: number }[]; totalReceived7d: number; avgWithPumasi: number|null; avgWithoutPumasi: number|null } | null>(null);
  const [pumReportBlog, setPumReportBlog] = useState<string>("");
  const [pumReportLoading, setPumReportLoading] = useState(false);
  const [pumReadSpeed, setPumReadSpeed] = useState<"fast"|"normal"|"natural">("natural");   // 체류 속도(빠름/보통/자연)
  const [pumPeriodDays, setPumPeriodDays] = useState(0);                                      // 대상 글 기간(0=전체 무제한, 30/90/180/365)
  const [pumPreview, setPumPreview] = useState<{ blogId: string; total: number; commented: number; remaining: number }[] | null>(null);
  const [pumPreviewLoading, setPumPreviewLoading] = useState(false);
  // ★서이추·공감댓글 대상 블로그 방문자 수 필터(0=제한없음). 탭 격리라 각 탭 인스턴스가 자기 값을 가짐.
  const [visMin, setVisMin] = useState(0);
  const [visMax, setVisMax] = useState(0);
  // ★검색 경유 진입: URL 직행 대신 네이버 검색→클릭(검색 유입 발생). 기본 ON.
  const [searchEntry, setSearchEntry] = useState(true);
  const [pumSearchKeyword, setPumSearchKeyword] = useState("");   // 품앗이 검색 진입용 목표 키워드
  const pumJobIdRef = useRef<string>("");
  const pumEsRef = useRef<BotEventStream|null>(null);
  const pumLogRef = useRef<HTMLDivElement>(null);
  const addPumLog = (m: string) => setPumLogs(p => [...p, `${new Date().toLocaleTimeString("ko-KR",{hour12:false})}  ${m}`]);
  useEffect(() => {
    if (!userId) return;
    if (tab === "reply") getReplyDailyUsage(userId).then(setReplyUsed);
    if (tab === "score") getBlogscoreDailyUsage(userId).then(setScUsed);
    if (tab === "pumasi") getPumasiDailyUsage(userId).then(setPumUsed);
  }, [userId, tab]);
  const [showGuide, setShowGuide] = useState(false);

  /* 공통: 계정 */
  const [accounts, setAccounts] = useState<Account[]>(() => {
    // 저장된 계정 복원 (한 번 연결하면 매번 안 넣게)
    try {
      const saved = JSON.parse(localStorage.getItem(ACCTS_LS_KEY) || "null");
      if (Array.isArray(saved) && saved.length) return saved.map((a: any) => ({ accountId: a.accountId, id: a.id || "", pw: a.pw || "", blogId: a.blogId || "", sessionOk: !!a.sessionOk, loginLoading: false, showPw: false }));
    } catch {}
    return [{ accountId: `${tabKey}_acc_1`, id: "", pw: "", blogId: "", sessionOk: false, loginLoading: false, showPw: false }];
  });
  const [botOnline, setBotOnline] = useState(false);
  // ★단탭(서이추·공감댓글·답방·지수) 작업에 쓸 계정 선택. 여러 계정을 연결해두고 이 중 하나를 골라 작업한다.
  //   미선택/무효면 첫 연결 계정으로 폴백. 품앗이는 연결된 계정 전체를 쓰므로 이 선택과 무관.
  const [selectedAcctId, setSelectedAcctId] = useState<string>("");
  const activeAccount = accounts.find(a => a.accountId === selectedAcctId && a.sessionOk) || accounts.find(a => a.sessionOk);
  // 🩺 진료차트 로드(activeAccount 확정 후 정의) — 검사/개선안/수정 이력을 careMap에 담아 관찰중 표시에 사용
  const loadCare = async () => {
    if (!userId || !activeAccount) return;
    try { const rows = await getPostCare(userId, activeAccount.accountId); const m: Record<string, PostCare> = {}; rows.forEach(r => { m[r.post_key] = r; }); setCareMap(m); } catch {}
  };
  // 🩺 AEO 형식 진단: 최근 글 본문을 실제로 읽어 도입요약·FAQ·구조화를 갖췄는지 체크(AI 호출 0, 무료). 최대 10개.
  const runAeoCheck = async () => {
    const bid = (activeAccount?.blogId || "").trim();
    if (!bid) { alert("먼저 이 탭에 네이버 계정을 연결하고 글 목록을 불러오세요."); return; }
    const targets = (scPosts.length ? scPosts : []).slice(0, 10).map(p => ({ logNo: scLogNo(p.url), title: p.title })).filter(t => t.logNo);
    if (!targets.length) { alert("검사할 글이 없어요. 위에서 '글 불러오기'를 먼저 눌러주세요."); return; }
    setAeoLoading(true); setAeoResults([]);
    const out: typeof aeoResults = [];
    for (const t of targets) {
      try {
        const r = await botFetch(`${BOT}/api/post-body?blogId=${encodeURIComponent(bid)}&logNo=${encodeURIComponent(t.logNo)}`, { signal: AbortSignal.timeout(20000) } as any);
        const d = await r.json();
        if (!r.ok || !d.ok || !String(d.body || "").trim()) throw new Error(d.error || "본문 조회 실패");
        const body = String(d.body || "");
        const dg = diagnoseAeo(body);
        out.push({ logNo: t.logNo, title: t.title, passed: dg.passed, checks: dg.checks });
        setAeoResults([...out]);   // 진행되는 대로 갱신
      } catch (e) { out.push({ logNo: t.logNo, title: t.title, passed: 0, checks: [], error: e instanceof Error ? e.message : "본문 조회 실패" }); setAeoResults([...out]); }
      await new Promise(res => setTimeout(res, 300));
    }
    setAeoLoading(false);
  };
  const runBulkRevive = async () => {
    const targets = aeoResults.filter(r => reviveChecked.has(r.logNo) && !r.error && r.passed < 3);
    if (!targets.length) return alert("살릴 글을 먼저 선택해 주세요.");
    const remaining = isUnlimitedPlan ? targets.length : Math.max(0, reviveLimit - reviveUsed);
    if (remaining <= 0) return alert(`오늘 이 글 살리기 한도(${reviveLimit}회)를 모두 사용했어요. 자정에 다시 사용할 수 있어요.`);
    const queue = targets.slice(0, remaining);
    if (!window.confirm(`선택한 글 ${queue.length}개를 차례대로 자동 살릴까요?\n\n제목·본문·이미지를 새로 만들어 기존 글에 덮어써요. 주소와 좋아요는 유지됩니다.${queue.length < targets.length ? `\n\n※ 오늘 남은 한도 때문에 ${queue.length}개만 진행합니다.` : ""}`)) return;
    reviveBulkStopRef.current = false;
    setReviveBulk({running:true,done:0,total:queue.length,success:0,failed:0});
    let success = 0; let failed = 0;
    for (let i=0;i<queue.length;i++) {
      if (reviveBulkStopRef.current) break;
      const item = queue[i];
      setReviveBulk({running:true,done:i,total:queue.length,success,failed,current:item.title});
      const requestId = `bulk-revive-${Date.now()}-${i}-${item.logNo}`;
      const ok = await new Promise<boolean>(resolve => {
        let tracked = false;
        const onSucceeded = (e:Event) => { if (String((e as CustomEvent).detail?.logNo||"") === item.logNo) tracked = true; };
        const onFinished = (e:Event) => {
          const d=(e as CustomEvent).detail||{};
          if(d.requestId!==requestId)return;
          cleanup(); resolve(Boolean(d.accepted)&&tracked);
        };
        const timer=window.setTimeout(()=>{cleanup();resolve(false);},2*60*60*1000);
        const cleanup=()=>{window.clearTimeout(timer);window.removeEventListener("publy-revive-succeeded",onSucceeded);window.removeEventListener("publy-revive-request-finished",onFinished);};
        window.addEventListener("publy-revive-succeeded",onSucceeded);
        window.addEventListener("publy-revive-request-finished",onFinished);
        const accepted=window.dispatchEvent(new CustomEvent("publy-revive-post",{cancelable:true,detail:{requestId,logNo:item.logNo,title:item.title,blogId:activeAccount?.blogId,naverId:activeAccount?.id,careAccountId:activeAccount?.accountId}}));
        if(!accepted){cleanup();resolve(false);}
      });
      if(ok)success++;else failed++;
      setReviveChecked(prev=>{const next=new Set(prev);next.delete(item.logNo);return next;});
      setReviveBulk({running:true,done:i+1,total:queue.length,success,failed,current:item.title});
    }
    setReviveBulk(p=>({...p,running:false,current:undefined}));
  };
  useEffect(() => { loadCare(); /* eslint-disable-next-line */ }, [activeAccount?.accountId, userId, rpTick]);
  // 원터치 글 살리기 성공 후 같은 글이 즉시 '수정 추적'에 보이도록 진료차트를 다시 읽는다.
  // 원터치 발행 계정 id와 블로그지수 탭 계정 id가 다르므로 careAccountId가 같은 경우만 갱신한다.
  useEffect(() => {
    const onReviveTracked = (e: Event) => {
      const detail = (e as CustomEvent).detail || {};
      if (String(detail.careAccountId || "") !== String(activeAccount?.accountId || "")) return;
      void loadCare();
      if (userId) void getReviveDailyUsage(userId).then(setReviveUsed).catch(() => {});
    };
    window.addEventListener("publy-revive-tracked", onReviveTracked);
    return () => window.removeEventListener("publy-revive-tracked", onReviveTracked);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeAccount?.accountId, userId]);
  // 🩺 P1: 블로그지수 탭에서 추적글(제목 바꾼 글)이 로드되면, 계정당 하루 1회 자동으로 순위를 채운다.
  //    (careMap이 loadCare로 갱신될 때마다 돌지만, 계정+날짜 key로 1회만 실행 → 무한루프 없음)
  useEffect(() => {
    if (tab !== "score") return;
    const acc = activeAccount;
    if (!acc || !userId) return;
    if (!Object.values(careMap).some(c => c.title_changed_at)) return;   // 추적글 아직 없음 → 대기
    const key = `${acc.accountId}:${new Date().toISOString().slice(0, 10)}`;
    if (autoTrackStartedRef.current === key) return;   // 이 계정 오늘 이미 자동검사함
    autoTrackStartedRef.current = key;
    autoCheckTrackedRanks();
    /* eslint-disable-next-line */
  }, [careMap, activeAccount?.accountId, userId, tab]);
  // 🩺 P4: 카르테가 로드되면 계정당 하루 1회 글별 조회수 자동 수집(봇이 통계 긁어옴)
  useEffect(() => {
    if (tab !== "score") return;
    const acc = activeAccount;
    if (!acc || !userId) return;
    if (!Object.keys(careMap).length) return;   // 매칭할 카르테가 있어야 함
    const key = `${acc.accountId}:${new Date().toISOString().slice(0, 10)}`;
    if (autoViewsStartedRef.current === key) return;
    autoViewsStartedRef.current = key;
    autoCollectViews();
    /* eslint-disable-next-line */
  }, [careMap, activeAccount?.accountId, userId, tab]);

  // 🆕 수정 추적: 그 글 하나만 실시간으로 현재 검색 순위 검사(exposure-check 단건). 결과를 카르테에도 누적.
  const checkOneRank = async (postKey: string) => {
    const acc = activeAccount;
    if (!acc) { alert("먼저 계정을 연결하세요"); return; }
    setRankChecking(postKey);
    try {
      const r = await botFetch(`${BOT}/api/exposure-check`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ accountId: acc.accountId, plan, logNos: [postKey] }) });
      const d = await r.json();
      const chk = (d.checks || [])[0];
      const rank = chk?.rank ?? null;
      setLiveRanks(p => ({ ...p, [postKey]: { rank, at: Date.now() } }));
      // 카르테에 이 순위도 저장(회복 그래프·완치 감지에 반영)
      // ★발행일(date)도 같이 저장 → 색인 유예 판정에 필요(안 넣으면 published_at null → 하루된 글도 치료필요로 뜸)
      const careDate = scPosts.find(p => scLogNo(p.url) === postKey)?.date || careMap[postKey]?.published_at || undefined;
      if (userId && chk) { try { const { newlyCured } = await savePostCareChecks(userId, acc.accountId, [{ logNo: postKey, title: chk.title || careMap[postKey]?.title || "", rank, exposed: chk.exposed ?? null, date: careDate }]); if (newlyCured.length) setCelebrate(newlyCured); await loadCare(); } catch {} }
    } catch (e: any) {
      setLiveRanks(p => ({ ...p, [postKey]: { rank: null, at: Date.now() } }));
      addScLog(`🔴 순위 검사 실패 (글 ${postKey}): ${e?.message || e}`);
      reportError({ userId, blogId: acc.blogId, stage: "순위검사", message: e?.message || String(e), detail: `logNo=${postKey}` });
    }
    setRankChecking("");
  };

  // 🩺 P1: 추적하기(제목 바꾼 글)를 실시간으로 — 회원이 글마다 [순위검사]를 누르지 않아도,
  //    추적하기가 열릴 때 '오늘 아직 안 본' 관찰중 글들의 순위를 한 번에 자동으로 채워 카르테에 반영한다.
  //    (팝업 완치 수 ↔ 추적하기 순위가 어긋나던 문제 해결. 계정당 하루 1회만.)
  const autoCheckTrackedRanks = async () => {
    const acc = activeAccount;
    if (!acc || !userId) return;
    const today = new Date().toISOString().slice(0, 10);
    // 제목 바꾼 글(추적 대상) 중 오늘 순위를 아직 기록 안 한 것만
    const targets = Object.values(careMap).filter(c => c.title_changed_at && !(c.rank_history || []).some(h => h.date === today));
    if (!targets.length) return;
    const logNos = targets.map(c => c.post_key).filter(Boolean);
    if (!logNos.length) return;
    setAutoTrackLoading(true);
    addScLog(`🔄 제목 바꾼 글 ${logNos.length}개의 순위를 자동 확인 중...`);
    try {
      // 서버·네이버 부하를 줄이려 10개씩 나눠서(가볍게) 순차 검사
      const CHUNK = 10;
      for (let i = 0; i < logNos.length; i += CHUNK) {
        const slice = logNos.slice(i, i + CHUNK);
        try {
          const r = await botFetch(`${BOT}/api/exposure-check`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ accountId: acc.accountId, plan, logNos: slice }) });
          const d = await r.json();
          if (!r.ok || d.ok === false) throw new Error(d.error || `HTTP ${r.status}`);
          const checks = (d.checks || []).map((c: any) => ({ logNo: c.logNo, title: c.title || careMap[c.logNo]?.title || "", rank: c.rank ?? null, exposed: c.exposed ?? null }));
          if (checks.length) {
            setLiveRanks(p => { const n = { ...p }; checks.forEach((c: any) => { if (c.logNo) n[c.logNo] = { rank: c.rank ?? null, at: Date.now() }; }); return n; });
            const { newlyCured } = await savePostCareChecks(userId, acc.accountId, checks);
            if (newlyCured.length) setCelebrate(newlyCured);   // 자동검사 중 완치 발견되면 축포도
          }
        } catch (e: any) {
          addScLog(`🔴 추적글 순위 자동검사 실패 (${slice.length}개): ${e?.message || e} — 봇이 켜져 있는지 확인해주세요`);
          reportError({ userId, blogId: acc.blogId, stage: "추적글 자동순위검사", message: e?.message || String(e), detail: `logNos=${slice.join(",")}` });
        }
      }
      await loadCare();   // 채워진 순위를 화면(추적하기·회진)에 반영
    } catch (e: any) {
      addScLog(`🔴 순위 자동검사 오류: ${e?.message || e}`);
      reportError({ userId, blogId: acc.blogId, stage: "추적글 자동순위검사(전체)", message: e?.message || String(e) });
    } finally { setAutoTrackLoading(false); }
  };

  // 🩺 P4: 글별 조회수 자동 수집 — 봇이 로그인 세션으로 통계(조회수 순위)를 긁어 카르테에 누적.
  //    회원은 아무것도 안 함. 계정당 하루 1회. "100위 노출됐는데 조회수 미비" 같은 걸 회진이 보게 해준다.
  const autoCollectViews = async () => {
    const acc = activeAccount;
    if (!acc || !userId) { addScLog(`🔴 조회수 수집 건너뜀 — 계정/로그인 정보 없음(acc=${!!acc}, userId=${!!userId})`); return; }
    setAutoViewsLoading(true);
    addScLog(`👁 조회수 자동 수집 시작 — 네이버 통계(조회수 순위)를 읽는 중(최대 1분 걸려요)...`);
    try {
      const r = await botFetch(`${BOT}/api/post-views`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ accountId: acc.accountId }) });
      const d = await r.json();
      if (!r.ok || d.ok === false) { throw new Error(d.error || `HTTP ${r.status}`); }
      const views = Array.isArray(d.views) ? d.views : [];
      if (views.length === 0) {
        // 봇은 정상 응답했는데 0개 = 통계(조회수 순위) 페이지를 못 읽은 것(로그인 만료 or rank_pv 주소/구조 변경)
        addScLog(`🔴 조회수 수집: 0개 — 네이버 통계(조회수 순위) 페이지를 못 읽었어요. 로그인 세션 만료 또는 통계 페이지 주소 변경일 수 있어요`);
        reportError({ userId, blogId: acc.blogId, stage: "조회수 수집(빈결과)", message: "rank_pv에서 0개 수집 — URL/셀렉터/세션 점검 필요" });
      } else {
        const matched = views.filter((v: any) => v.logNo).length;
        await savePostViews(userId, acc.accountId, views.map((v: any) => ({ logNo: v.logNo, views: v.views })));
        await loadCare();
        addScLog(`👁 조회수 자동 수집 완료: ${views.length}개(글번호 매칭 ${matched}개)`);
        if (matched === 0) {   // 조회수는 읽었는데 글번호(logNo)를 못 붙임 = 진료차트에 반영 안 됨
          addScLog(`🔴 조회수는 읽었지만 글번호 매칭 0개 — 통계 표에 글 링크가 없어 카르테에 반영 못 했어요(셀렉터 조정 필요)`);
          reportError({ userId, blogId: acc.blogId, stage: "조회수 매칭실패", message: `${views.length}개 읽었으나 logNo 매칭 0` });
        }
      }
    } catch (e: any) {
      addScLog(`🔴 조회수 수집 오류: ${e?.message || e} — 봇이 켜져 있는지 확인해주세요`);
      reportError({ userId, blogId: acc.blogId, stage: "조회수 수집", message: e?.message || String(e) });
    } finally { setAutoViewsLoading(false); }
  };

  // 🩺 수정 추적에서 '제목 변경' 클릭 → 멘토가 관찰기간을 보고 판단하는 팝업. 무시하고 강행 OR 지휘 따라 기다리기.
  const handleTrackedRepublish = (item: { title: string; logNo?: string; blogId?: string }, changedDays: number, st: { status: string; daysLeft?: number }) => {
    let msg: string;
    if (st.status === "observing") {
      msg = `🌱 멘토의 조언\n\n이 글은 제목을 바꾼 지 ${changedDays}일밖에 안 됐어요.\n네이버가 이 글을 다시 읽고 순위를 매기는 데 보통 30일쯤 걸려요. (앞으로 ${st.daysLeft}일 더)\n\n지금 또 바꾸면 그동안의 관찰이 초기화돼서 오히려 손해예요.\n\n👉 조금만 더 기다리는 걸 권해요.\n\n그래도 지금 바로 제목을 다시 바꾸시겠어요?`;
    } else if (st.status === "relapse") {
      msg = `🔴 멘토의 조언\n\n이 글은 제목을 바꾼 지 ${changedDays}일이 지났는데 아직 검색에 안 떴어요.\n충분히 기다렸으니, 이제 제목·키워드를 다시 손볼 때예요.\n\n👉 개선안을 받아 다시 바꿔보는 걸 권해요.\n\n지금 개선안을 받으시겠어요?`;
    } else if (st.status === "needs" || st.status === "new" || st.status === "prescribed") {
      msg = `🚑 멘토의 조언\n\n이 글은 아직 검색에 안 떠요(미노출).\n제목·키워드를 더 잘 고치면 노출될 기회가 생겨요.\n\n👉 개선안(새 제목 2개)을 받아 바꿔보세요.\n\n지금 개선안을 받으시겠어요?`;
    } else {
      msg = `이 글의 제목을 다시 바꾸시겠어요?\n\n제목을 바꾼 지 ${changedDays}일 됐어요.`;
    }
    if (!window.confirm(msg)) { addScLog(`🌱 "${item.title.slice(0, 18)}" — 멘토 지휘에 따라 기다리기로 했어요`); return; }
    if (!item.logNo) { alert("이 글의 번호를 못 찾았어요. '순위 검사'를 다시 해주세요."); return; }
    if (!localStorage.getItem("publy_gemini_key")) { alert("AI 제목 추천은 무료 Gemini 키가 필요해요. 설정 → 글쓰기 AI에서 등록해주세요."); return; }
    // 개선안을 별도 모달로 — 관찰중 글은 재발행 목록에 없어 펼칠 곳이 없으므로
    addScLog(`✏️ "${item.title.slice(0, 18)}" 개선안 받는 중...`);
    setTrackSol({ item, loading: true, sol: null });
    getSolutionQuiet(item.title, item.logNo).then(s => {
      if (!s) { setTrackSol(null); addScLog("❌ 개선안 생성 실패"); alert("개선안 생성에 실패했어요. 잠시 후 다시 시도해주세요."); return; }
      setTrackSol({ item, loading: false, sol: { diagnosis: (s as any).diagnosis || "", newTitle: s.newTitle, newTitle2: s.newTitle2, keywords: (s as any).keywords || [], bodyTip: (s as any).bodyTip || "", expectedEffect: (s as any).expectedEffect || "" } });
      addScLog(`✅ "${item.title.slice(0, 16)}" 개선안 완성 — 제목 2개`);
    });
  };
  // 📖 기능 설명 — 각 기능 헤더 밑에 "이게 뭐예요" 한 줄. 어르신도 알게(문의 방지). 항상 보이는 인라인 텍스트.
  const HelpLine = ({ children }: { children: React.ReactNode }) => (
    <div style={{ fontSize: 11.5, color: "var(--text3)", lineHeight: 1.6, marginTop: 4, marginBottom: 12, display: "flex", gap: 6, alignItems: "flex-start" }}>
      <span style={{ flexShrink: 0, marginTop: 1 }}>💬</span><span>{children}</span>
    </div>
  );
  // 선택된 계정이 사라지거나 아직 없으면 첫 연결 계정으로 자동 보정
  useEffect(() => {
    const stillOk = accounts.some(a => a.accountId === selectedAcctId && a.sessionOk);
    if (!stillOk) {
      const first = accounts.find(a => a.sessionOk);
      setSelectedAcctId(first ? first.accountId : "");
    }
  }, [accounts, selectedAcctId]);

  /* 서이추 state */
  const [quotaUsed, setQuotaUsed] = useState(initialNeighborUsed);
  const [quotaLimit, setQuotaLimit] = useState(DAILY_LIMIT_BY_PLAN[plan] ?? 10);
  // 공감·댓글 사용량 (상단 배지 engageUsed와 동일 소스)
  const [eUsed, setEUsed] = useState(initialEngageUsed);
  const eLimit = DAILY_LIMIT_BY_PLAN[plan] ?? 10;
  const [keywords, setKeywords] = useState("");
  const [countPerKw, setCountPerKw] = useState(34);
  const [dailyLimit, setDailyLimit] = useState(100);
  const [delayMin, setDelayMin] = useState(5);
  const [delayMax, setDelayMax] = useState(10);
  const [skipDone, setSkipDone] = useState(true);
  const [qualityFilter, setQualityFilter] = useState(true);   // 죽은/광고 블로그 자동 스킵
  const [retryDays, setRetryDays] = useState(30);             // 실패/무응답 재신청 대기일
  const [autoStart, setAutoStart] = useState(false);
  // 예약·분산 실행 (기존 '한번에'와 별개 모드)
  const [spreadMode, setSpreadMode] = useState(false);      // 분산 실행 켜기
  const [spreadBatches, setSpreadBatches] = useState(3);    // 몇 번에 나눠서
  const [spreadGapMin, setSpreadGapMin] = useState(90);     // 배치 사이 간격(분)
  const [spreadRunning, setSpreadRunning] = useState(false);
  const [spreadInfo, setSpreadInfo] = useState<{ total: number; cur: number; nextAt: number | null }>({ total: 0, cur: 0, nextAt: null });
  const spreadTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const spreadRunningRef = useRef(false);
  // 내 이웃 키워드 분석 (서이추·공감댓글 공용)
  const [buddyKw, setBuddyKw] = useState<{ word: string; count: number }[]>([]);
  const [buddyKwLoading, setBuddyKwLoading] = useState(false);
  // 체험단 모집 최적화 옵션
  const [orderBy, setOrderBy] = useState<"recentdate"|"sim">("recentdate");
  const [activeDays, setActiveDays] = useState<number>(30);
  const [excludeMarket, setExcludeMarket] = useState(true);
  const [msgMode, setMsgMode] = useState<"single"|"multi">("single");
  const [singleMsg, setSingleMsg] = useState(DEFAULT_SINGLE_MSG);
  const [multiMsgs, setMultiMsgs] = useState(DEFAULT_MULTI_MSGS);
  const [msgIndex, setMsgIndex] = useState(0);
  const [targets, setTargets] = useState<Target[]>([]);
  const [results, setResults] = useState<WorkResult[]>([]);
  const [logs, setLogs] = useState<string[]>([]);
  const [crawling, setCrawling] = useState(false);
  const [working, setWorking] = useState(false);
  const [doneCnt, setDoneCnt] = useState(0);
  const [failCnt, setFailCnt] = useState(0);
  const logRef = useRef<HTMLDivElement>(null);
  const jobIdRef = useRef<string>(Date.now().toString());
  const esRef = useRef<BotEventStream|null>(null);

  /* 공감·댓글 state */
  const [eKeywords, setEKeywords] = useState("");
  const [eSource, setESource] = useState<"keyword" | "buddy">("keyword");  // 수집 소스: 키워드 검색 vs 내 이웃새글
  const [eCountPerKw, setECountPerKw] = useState(20);
  const [ePeriod, setEPeriod] = useState<7|14|30|"custom">(7);
  const [eCustomDays, setECustomDays] = useState(3);
  const [ePostsPerBlog, setEPostsPerBlog] = useState(1);
  const [eDoLike, setEDoLike] = useState(true);
  const [eDoComment, setEDoComment] = useState(true);
  const [eLikeRate, setELikeRate] = useState(100);      // 공감 확률 %
  const [eCommentRate, setECommentRate] = useState(40); // 댓글 확률 % (도배 회피 기본 40)
  const [eComment, setEComment] = useState("좋은 글 잘 읽고 갑니다 😊 자주 놀러올게요!");
  const [eCommentMode, setECommentMode] = useState<"single"|"multi"|"ai">("single");
  const [eCommentTone, setECommentTone] = useState<"담백"|"다정"|"짧게">("다정"); // AI 댓글 말투
  const [eMultiComments, setEMultiComments] = useState(
    "좋은 글 잘 읽고 갑니다 😊 자주 놀러올게요!\n" +
    "유익한 정보 감사해요! 구독하고 갑니다 🙌\n" +
    "정말 도움이 됐어요! 앞으로도 좋은 글 부탁드려요 ✨\n" +
    "포스팅 정성이 느껴지네요, 잘 보고 가요!\n" +
    "필요했던 내용인데 딱이에요, 감사합니다 😊\n" +
    "사진도 예쁘고 글도 알차네요, 잘 봤어요!\n" +
    "덕분에 좋은 정보 얻어갑니다, 고마워요~\n" +
    "설명이 자세해서 이해가 쏙쏙 되네요 👍\n" +
    "공감하며 읽었어요, 좋은 하루 보내세요!\n" +
    "꼼꼼하게 정리해주셔서 감사해요 😊\n" +
    "이런 글 찾고 있었는데 반갑네요!\n" +
    "잘 읽었습니다, 다음 글도 기대할게요 ✨\n" +
    "정보가 알차서 저장해두고 갑니다!\n" +
    "글 솜씨가 좋으시네요, 잘 보고 가요~\n" +
    "따뜻한 글 감사해요, 자주 소통해요 😊\n" +
    "도움 많이 됐어요, 좋은 정보 고맙습니다!\n" +
    "읽는 내내 고개 끄덕이며 봤네요 👍\n" +
    "핵심만 딱딱 짚어주셔서 좋았어요!\n" +
    "구성이 깔끔해서 보기 편했어요 😊\n" +
    "유용한 팁이네요, 참고할게요~\n" +
    "좋은 하루 되세요, 잘 보고 갑니다!\n" +
    "실질적으로 도움되는 글이라 반가워요 ✨\n" +
    "정성스러운 포스팅 잘 봤습니다 😊\n" +
    "덕분에 궁금했던 게 풀렸어요, 감사해요!\n" +
    "내용이 알차서 끝까지 읽었네요 👍\n" +
    "잘 정리된 글이라 도움이 많이 됐어요!\n" +
    "사진이랑 설명이 딱 좋네요, 잘 봤어요 😊\n" +
    "마음이 편안해지는 글이에요, 감사합니다~\n" +
    "좋은 정보 나눠주셔서 고마워요 ✨\n" +
    "다음에 또 들를게요, 좋은 글 감사해요 😊"
  );
  const [eCommentIndex, setECommentIndex] = useState(0);
  const [eDelayMin, setEDelayMin] = useState(5);
  const [eDelayMax, setEDelayMax] = useState(12);
  const [eDailyLimit, setEDailyLimit] = useState(50);
  const [eSkipDone, setESkipDone] = useState(true);
  const [eAutoStart, setEAutoStart] = useState(false);
  const [eTargets, setETargets] = useState<Target[]>([]);
  const [eResults, setEResults] = useState<EngageResult[]>([]);
  const [eLogs, setELogs] = useState<string[]>([]);
  const [eCrawling, setECrawling] = useState(false);
  const [eWorking, setEWorking] = useState(false);
  const [eDoneCnt, setEDoneCnt] = useState(0);
  const [eFailCnt, setEFailCnt] = useState(0);
  const eLogRef = useRef<HTMLDivElement>(null);
  const eJobIdRef = useRef<string>(Date.now().toString());
  const eEsRef = useRef<BotEventStream|null>(null);

  /* 품앗이 탭 진입/계정 변화 시 미리보기 자동 조회 */
  useEffect(() => {
    if (tab === "pumasi" && botOnline) handlePumasiPreview();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, botOnline, accounts.filter(a => a.sessionOk && a.blogId).map(a => a.accountId).join(",")]);

  /* 봇 상태 체크 */
  useEffect(() => {
    const check = async () => {
      try { const r = await botFetch(`${BOT}/health`, { signal: AbortSignal.timeout(2000) }); setBotOnline(r.ok); }
      catch { setBotOnline(false); }
    };
    check();
    const t = setInterval(check, 5000);
    return () => clearInterval(t);
  }, []);

  /* 쿼타 로드 */
  useEffect(() => {
    if (!userId) return;
    botFetch(`${BOT}/api/quota/${userId}`).then(r => r.json())
      .then(d => { if (d.ok) { setQuotaUsed(d.used); setQuotaLimit(d.limit); } }).catch(() => {});
  }, [userId, botOnline]);

  /* 로그 스크롤: 자동 이동 없음(테리 요청). 새 로그가 와도 화면을 강제로 옮기지 않고,
     사용자가 스크롤한 위치에 그대로 멈춰 있게 둔다. 아래를 보려면 직접 내리면 됨. */
  // 계정 목록 자동 저장 (id/pw/연결상태 유지 → 매번 재입력 불필요)
  useEffect(() => {
    try { localStorage.setItem(ACCTS_LS_KEY, JSON.stringify(accounts.map(a => ({ accountId: a.accountId, id: a.id, pw: a.pw, blogId: a.blogId, sessionOk: a.sessionOk })))); } catch {}
  }, [accounts, ACCTS_LS_KEY]);

  const addLog = useCallback((msg: string) => {
    const t = new Date().toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
    setLogs(p => { const next = [...p.slice(-200), `${t} :: ${msg}`]; if (userId) pushLiveLog(userId, { context: tabName, text: next.slice(-80).join("\n"), running: true }); return next; });
  }, [userId, tabName]);

  const addELog = useCallback((msg: string) => {
    const t = new Date().toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
    setELogs(p => [...p.slice(-200), `${t} :: ${msg}`]);
  }, []);

  /* 세션 상태 확인 + 오늘 서이추 안전 한도 현황 로드 */
  useEffect(() => {
    accounts.forEach(acc => {
      if (!acc.id) return;
      botFetch(`${BOT}/api/session/${acc.accountId}`).then(r => r.json())
        // ★봇의 실제 세션 상태로 sessionOk를 정확히 맞춘다. 봇에 세션이 없으면(exists=false) '연결됨'을 내려
        //   재연결을 유도한다. (예전엔 exists일 때만 true로 올리고 false로 안 내려서 "연결됨인데 봇엔 세션 없음"
        //   → 시작해도 크롬이 안 뜨는 불일치가 있었음)
        .then(d => setAccounts(p => p.map(a => a.accountId === acc.accountId ? { ...a, sessionOk: !!d.exists } : a)))
        .catch(() => {});
    });
    // 상단·사이드바와 같은 원래 서이추 한도(플랜별)를 초기 로드 → 게이지 연동
    if (userId) botFetch(`${BOT}/api/quota/${userId}`).then(r => r.json())
      .then(d => { if (d.ok) { setQuotaUsed(d.used); setQuotaLimit(d.limit); } }).catch(() => {});
  }, []);

  /* 계정 핸들러 */
  //  silent=true면 개별 alert 없이 조용히(전체 연결에서 사용). 성공 여부를 boolean으로 반환.
  const handleLogin = async (accountId: string, silent = false): Promise<boolean> => {
    const acc = accounts.find(a => a.accountId === accountId);
    if (!acc || !acc.id || !acc.pw) { if (!silent) alert("아이디와 비밀번호를 입력하세요"); return false; }
    setAccounts(p => p.map(a => a.accountId === accountId ? { ...a, loginLoading: true } : a));
    try {
      const r = await botFetch(`${BOT}/api/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ accountId, id: acc.id, pw: acc.pw }) });
      const d = await r.json();
      if (d.success) {
        setAccounts(p => p.map(a => a.accountId === accountId ? { ...a, sessionOk: true, blogId: d.blogId, loginLoading: false } : a));
        addLog(`✅ [${acc.id}] 로그인 성공 (blogId: ${d.blogId})`);
        addELog(`✅ [${acc.id}] 로그인 성공`);
        return true;
      } else throw new Error(d.error || "로그인 실패");
    } catch (e: any) {
      setAccounts(p => p.map(a => a.accountId === accountId ? { ...a, loginLoading: false } : a));
      addLog(`❌ [${acc.id}] 로그인 오류: ${e.message}`);
      if (!silent) alert(`로그인 오류: ${e.message}`);
      return false;
    } finally {
      // 봇 로그인 브라우저가 닫히며 앱이 뒤로 숨는 현상 방지 — 앱을 다시 앞으로
      try { (window as any).electron?.focusApp?.(); } catch {}
    }
  };

  /* 전체 계정 연결: 아이디·비번 입력된 계정을 순서대로 자동 로그인(개별 연결과 별개, 둘 다 사용 가능) */
  const [connectingAll, setConnectingAll] = useState(false);
  const handleConnectAll = async () => {
    const withCreds = accounts.filter(a => a.id && a.pw);
    if (!withCreds.length) return alert("연결할 계정이 없어요. 먼저 아이디·비밀번호를 입력해 주세요.");
    // 미연결이 있으면 그것만, 다 '연결됨'이면 전체 재연결(세션이 풀렸을 수 있어 언제든 재연결 가능)
    const pending = withCreds.filter(a => !a.sessionOk);
    const targets = pending.length ? pending : withCreds;
    setConnectingAll(true);
    addLog(`🔗 전체 연결 시작 — ${targets.length}개 계정을 순서대로 ${pending.length ? "로그인" : "재연결"}합니다`);
    let ok = 0, fail = 0;
    for (const a of targets) {
      const success = await handleLogin(a.accountId, true);   // 조용히(개별 alert 없이)
      if (success) ok++; else fail++;
      await new Promise(res => setTimeout(res, 800));          // 계정 사이 약간 텀
    }
    setConnectingAll(false);
    addLog(`🔗 전체 연결 완료 — 성공 ${ok} / 실패 ${fail}`);
    alert(`전체 연결 완료!\n성공 ${ok}개${fail ? ` · 실패 ${fail}개(아이디·비번 확인)` : ""}`);
  };

  const handleAddAccount = useCallback(() => {
    if (!isUnlimitedPlan && accounts.length >= accountLimit) {
      alert(`${planLabel} 등급에서는 이 탭에 계정을 최대 ${accountLimit}개까지 연결할 수 있어요.\n더 많은 계정을 쓰려면 상위 등급이 필요해요.`);
      return;
    }
    setAccounts(p => [...p, { accountId: mkAccId(), id: "", pw: "", blogId: "", sessionOk: false, loginLoading: false, showPw: false }]);
  }, [tabKey, accountLimit, isUnlimitedPlan, planLabel, accounts.length]);

  // 이 탭의 모든 계정 삭제(+봇 세션까지) — 품앗이 등에서 한 번에 정리
  const handleRemoveAllAccounts = useCallback(() => {
    if (!window.confirm("이 탭의 모든 계정을 삭제할까요?\n저장된 로그인(세션)도 함께 삭제됩니다.")) return;
    accounts.forEach(a => { botFetch(`${BOT}/api/session/${encodeURIComponent(a.accountId)}`, { method: "DELETE" }).catch(() => {}); });
    setAccounts([{ accountId: mkAccId(), id: "", pw: "", blogId: "", sessionOk: false, loginLoading: false, showPw: false }]);
  }, [accounts, tabKey]);

  const handleRemoveAccount = useCallback((id: string) => {
    // 봇에 저장된 로그인 세션도 함께 삭제
    botFetch(`${BOT}/api/session/${encodeURIComponent(id)}`, { method: "DELETE" }).catch(() => {});
    setAccounts(p => {
      const next = p.filter(a => a.accountId !== id);
      return next.length ? next : [{ accountId: mkAccId(), id: "", pw: "", blogId: "", sessionOk: false, loginLoading: false, showPw: false }];
    });
  }
  , [tabKey]);

  const handleAccountChange = useCallback((accountId: string, field: keyof Account, value: any) =>
    setAccounts(p => p.map(a => a.accountId === accountId ? { ...a, [field]: value, ...(field === "id" || field === "pw" ? { sessionOk: false } : {}) } : a))
  , []);

  /* 내 이웃 키워드 분석 — 이웃들이 자주 쓰는 주제 TOP (서이추·공감댓글 공용) */
  const analyzeBuddyKeywords = async () => {
    const acc = activeAccount;
    if (!acc) return alert("먼저 계정을 연결하세요 (내 이웃 분석은 로그인 필요)");
    setBuddyKwLoading(true); setBuddyKw([]);
    try {
      const r = await botFetch(`${BOT}/api/buddy-keywords/${encodeURIComponent(acc.accountId)}`, { signal: AbortSignal.timeout(60000) } as any);
      const d = await r.json();
      if (d.ok && Array.isArray(d.keywords)) setBuddyKw(d.keywords);
      else alert("키워드 분석 실패: " + (d.error || "이웃새글이 없어요"));
    } catch (e: any) { alert("키워드 분석 오류: " + e.message); }
    finally { setBuddyKwLoading(false); }
  };

  /* 서이추 수집 */
  // 체험단 멘트 채우기 — 매번 무작위로 섞어 채움 (도배 회피)
  //  단일 멘트 모드: 랜덤 1개를 넣음 / 여러 멘트 모드: count개를 넣음
  const applyCampaignPreset = (count = 5) => {
    const shuffled = [...CAMPAIGN_PRESETS].sort(() => Math.random() - 0.5);
    if (msgMode === "single") setSingleMsg(shuffled[0]);
    else setMultiMsgs(shuffled.slice(0, count).join("\n"));
  };
  // 기본 멘트로 되돌리기 (수정한 걸 원래대로)
  const restoreDefaultMsg = () => {
    if (msgMode === "single") setSingleMsg(DEFAULT_SINGLE_MSG);
    else setMultiMsgs(DEFAULT_MULTI_MSGS);
  };

  const handleCrawl = async () => {
    const kwList = keywords.split(",").map(k => k.trim()).filter(Boolean);
    if (!kwList.length) return alert("키워드를 입력하세요");
    setCrawling(true); setTargets([]); setResults([]); setDoneCnt(0); setFailCnt(0);
    addLog(`🔍 수집 시작 — 키워드: ${kwList.join(", ")} / 키워드당 ${countPerKw}개`);
    const es = new BotEventStream(`${BOT}/api/crawl?keywords=${encodeURIComponent(kwList.join(","))}&countPerKeyword=${countPerKw}&orderBy=${orderBy}&activeDays=${activeDays}&excludeMarket=${excludeMarket}${userId ? `&userId=${userId}` : ""}`);
    esRef.current = es;
    es.onmessage = e => {
      const d = JSON.parse(e.data);
      if (d.type === "log") addLog(d.msg);
      if (d.type === "quota_info") { setQuotaUsed(d.used); setQuotaLimit(d.limit); addLog(`📊 오늘 서이추 현황: ${d.used}/${d.limit} (남은 ${d.remaining}명)`); }
      if (d.type === "quota_exceeded") { addLog(`🚫 오늘 한도(${d.limit}명) 모두 사용!`); setCrawling(false); es.close(); return; }
      if (d.type === "crawl_done") {
        const t: Target[] = d.results; setTargets(t); setResults(t.map(x => ({ ...x, status: "pending" as const, message: "대기중" })));
        addLog(`✅ 수집 완료: 총 ${t.length}개`); setCrawling(false); es.close();
        if (autoStart && t.length > 0) setTimeout(() => startWork(t), 500);
      }
      if (d.type === "error") { addLog(`❌ 오류: ${d.msg}`); setCrawling(false); es.close(); }
    };
    es.onerror = () => { addLog("❌ 수집 연결 오류"); setCrawling(false); es.close(); };
  };

  /* 서이추 작업 — 완료(done/error/한도)시 resolve하는 Promise 반환(분산 실행에서 배치 대기용) */
  const startWork = (targetList?: Target[]): Promise<"done" | "limit" | "error"> => {
    const list = targetList || targets;
    if (!list.length) { alert("수집된 블로그가 없습니다"); return Promise.resolve("error"); }
    const acc = activeAccount;
    if (!acc) { alert("먼저 계정을 연결하세요"); return Promise.resolve("error"); }
    setWorking(true); setDoneCnt(0); setFailCnt(0);
    jobIdRef.current = Date.now().toString();
    addLog(`🚀 작업 시작 — ${list.length}개 대상 / 한도 ${dailyLimit}개 / 딜레이 ${delayMin}~${delayMax}초`);
    const msg = msgMode === "single" ? singleMsg : multiMsgs.split("\n").filter(l => l.trim()).join("|||");
    // ★ targets(수십~수백개)를 GET URL에 실으면 길이 초과로 연결 실패 → POST body로 전송
    const body = JSON.stringify({ accountId: acc.accountId, targets: list, message: msg, delayMin, delayMax, skipDone, qualityFilter, retryDays, minVisitors: visMin, maxVisitors: visMax, searchEntry, jobId: jobIdRef.current, ...(userId ? { userId } : {}) });
    return new Promise<"done" | "limit" | "error">((resolve) => {
      let outcome: "done" | "limit" | "error" = "done";
      const es = new BotEventStream(`${BOT}/api/add-neighbor`, { method: "POST", headers: { "Content-Type": "application/json" }, body }); esRef.current = es;
      es.onmessage = e => {
        const d = JSON.parse(e.data);
        if (d.type === "log") addLog(d.msg);
        if (d.type === "quota_info") { setQuotaUsed(d.used); setQuotaLimit(d.limit); }
        if (d.type === "quota_exceeded") { addLog("🚫 오늘 한도 초과!"); outcome = "limit"; setWorking(false); es.close(); return; }
        if (d.type === "result") { setResults(p => p.map(r => r.blogId === d.blogId ? { ...r, status: d.status, message: d.message } : r)); if (d.status === "success") setQuotaUsed(q => q + 1); }
        if (d.type === "progress") { setDoneCnt(d.done); setFailCnt(d.fail); }
        if (d.type === "done") { addLog("🎉 작업 완료!"); setWorking(false); es.close(); }
        if (d.type === "error") { addLog(`❌ 오류: ${d.msg}`); outcome = "error"; setWorking(false); es.close(); }
      };
      es.onerror = () => { addLog("❌ 작업 연결 오류 (다시 '서이추 시작'을 누르면 재시도합니다)"); outcome = "error"; setWorking(false); es.close(); };
      es.onclose = () => { setWorking(false); resolve(outcome); };  // 어떤 식으로 끝나도 해제+배치 resolve
    });
  };

  /* 예약·분산 실행 — 대상을 여러 배치로 나눠 간격을 두고 자동 실행 (앱 켜둔 상태) */
  const startSpread = async () => {
    if (spreadRunningRef.current) return;   // 이미 분산 실행 중이면 중복 시작 방지(로그 반복·다중 루프 차단)
    const list = targets;
    if (!list.length) return alert("수집된 블로그가 없습니다");
    const acc = activeAccount;
    if (!acc) return alert("먼저 계정을 연결하세요");
    const n = Math.max(2, Math.min(10, spreadBatches));
    const gapMs = Math.max(1, spreadGapMin) * 60 * 1000;
    // 대상을 n개 배치로 균등 분할
    const batches: Target[][] = Array.from({ length: n }, () => []);
    list.forEach((t, i) => batches[i % n].push(t));
    const nonEmpty = batches.filter(b => b.length);
    spreadRunningRef.current = true;   // useEffect 갱신을 기다리지 않고 즉시 동기 설정(루프 첫 체크 오작동 방지)
    setSpreadRunning(true);
    setSpreadInfo({ total: nonEmpty.length, cur: 0, nextAt: null });
    addLog(`📅 분산 실행 시작 — ${list.length}개를 ${nonEmpty.length}회로 나눠 ${spreadGapMin}분 간격으로 진행합니다.`);
    for (let i = 0; i < nonEmpty.length; i++) {
      if (!spreadRunningRef.current) { addLog("⏹ 분산 실행 중단됨"); break; }
      setSpreadInfo({ total: nonEmpty.length, cur: i + 1, nextAt: null });
      addLog(`📦 [${i + 1}/${nonEmpty.length}회차] ${nonEmpty[i].length}개 신청 시작`);
      const r = await startWork(nonEmpty[i]);
      if (r === "limit") { addLog("🛑 한도 도달로 분산 실행을 멈춥니다. 자정 이후 다시 시작해 주세요."); break; }
      // 마지막 배치가 아니면 다음 회차까지 대기
      if (i < nonEmpty.length - 1) {
        const nextAt = Date.now() + gapMs;
        setSpreadInfo({ total: nonEmpty.length, cur: i + 1, nextAt });
        addLog(`⏳ 다음 회차까지 ${spreadGapMin}분 대기 (예정: ${new Date(nextAt).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" })})`);
        await new Promise<void>(res => { spreadTimerRef.current = setTimeout(res, gapMs); });
      }
    }
    setSpreadRunning(false);
    setSpreadInfo({ total: 0, cur: 0, nextAt: null });
    addLog("✅ 분산 실행 종료");
  };
  useEffect(() => { spreadRunningRef.current = spreadRunning; }, [spreadRunning]);

  // ★절전 방지(테리 요청): 서이추·공감댓글 자동작업(추출·실행·분산 자동실행) 중이면 부모(DashboardPage)에 알림.
  //   실제 keepAwake는 항상 떠있는 DashboardPage가 통합 관리 → 작업 중 다른 탭 이동/언마운트돼도 화면 안 꺼짐.
  useEffect(() => {
    // ★bulkRunning(전체 제목변경)·titleEditingKey(제목변경)·scExposureLoading(검색노출검사)도 절전방지 — 오래 걸리는 동안 화면 안 꺼지게
    const busy = crawling || working || spreadRunning || eCrawling || eWorking || rWorking || rLoadingPosts || scLoading || pumWorking || bulkRunning || !!titleEditingKey || scExposureLoading;
    onBusyChange?.(busy);
    return () => { onBusyChange?.(false); };
  }, [crawling, working, spreadRunning, eCrawling, eWorking, rWorking, rLoadingPosts, scLoading, pumWorking, bulkRunning, titleEditingKey, scExposureLoading, onBusyChange]);

  const stopSpread = () => {
    spreadRunningRef.current = false;
    setSpreadRunning(false);
    if (spreadTimerRef.current) clearTimeout(spreadTimerRef.current);
    esRef.current?.close();
    addLog("⏹ 분산 실행을 중단했습니다.");
  };

  const handleStop = async () => {
    if (esRef.current) { esRef.current.close(); esRef.current = null; }
    try { await botFetch(`${BOT}/api/stop/${jobIdRef.current}`, { method: "POST" }); } catch {}
    addLog("⛔ 중단"); setCrawling(false); setWorking(false);
  };

  /* 공감·댓글 수집 */
  const handleEngageCrawl = async () => {
    let crawlUrl: string;
    if (eSource === "buddy") {
      // 내 이웃새글 모드 — 연결된 계정 세션으로 내 서로이웃 최근글 수집 (키워드 불필요)
      const acc = activeAccount;
      if (!acc) return alert("먼저 계정을 연결하세요 (내 이웃 목록을 불러오려면 로그인 필요)");
      setECrawling(true); setETargets([]); setEResults([]); setEDoneCnt(0); setEFailCnt(0);
      addELog(`👥 내 이웃새글 수집 시작 — 최대 ${eCountPerKw}명`);
      crawlUrl = `${BOT}/api/engage-crawl?source=buddy&accountId=${encodeURIComponent(acc.accountId)}&countPerKeyword=${eCountPerKw}${userId ? `&userId=${userId}` : ""}`;
    } else {
      const kwList = eKeywords.split(",").map(k => k.trim()).filter(Boolean);
      if (!kwList.length) return alert("키워드를 입력하세요");
      setECrawling(true); setETargets([]); setEResults([]); setEDoneCnt(0); setEFailCnt(0);
      addELog(`🔍 수집 시작 — 키워드: ${kwList.join(", ")} / 키워드당 ${eCountPerKw}개`);
      crawlUrl = `${BOT}/api/engage-crawl?keywords=${encodeURIComponent(kwList.join(","))}&countPerKeyword=${eCountPerKw}${userId ? `&userId=${userId}` : ""}`;
    }
    const es = new BotEventStream(crawlUrl);
    eEsRef.current = es;
    es.onmessage = e => {
      const d = JSON.parse(e.data);
      if (d.type === "log") addELog(d.msg);
      if (d.type === "crawl_done") {
        const t: Target[] = d.results; setETargets(t);
        setEResults(t.map(x => ({ ...x, postUrl: "", liked: false, commented: false, status: "pending" as const, message: "대기중" })));
        addELog(`✅ 수집 완료: 총 ${t.length}개`); setECrawling(false); es.close();
        if (eAutoStart && t.length > 0) setTimeout(() => startEngageWork(t), 500);
      }
      if (d.type === "error") { addELog(`❌ 오류: ${d.msg}`); setECrawling(false); es.close(); }
    };
    es.onerror = () => { addELog("❌ 수집 연결 오류"); setECrawling(false); es.close(); };
  };

  /* 공감·댓글 작업 */
  const startEngageWork = async (targetList?: Target[]) => {
    const list = targetList || eTargets;
    if (!list.length) return alert("수집된 블로그가 없습니다");
    const acc = activeAccount;
    if (!acc) return alert("먼저 계정을 연결하세요");
    setEWorking(true); setEDoneCnt(0); setEFailCnt(0);
    eJobIdRef.current = Date.now().toString();
    const days = ePeriod === "custom" ? eCustomDays : ePeriod;
    addELog(`🚀 작업 시작 — ${list.length}개 / 최근 ${days}일 / ${eDoLike ? "공감" : ""}${eDoLike && eDoComment ? "+" : ""}${eDoComment ? "댓글" : ""}`);
    const commentText = eCommentMode === "single" ? eComment : eCommentMode === "multi" ? eMultiComments.split("\n").filter(l => l.trim()).join("|||") : "";
    const aiComment = eCommentMode === "ai";
    const geminiKey = aiComment ? ((localStorage.getItem("publy_gemini_key") || "")) : "";
    // ★ targets를 POST body로 (URL 길이 초과 방지)
    const body = JSON.stringify({ accountId: acc.accountId, targets: list, comment: commentText, doLike: eDoLike, doComment: eDoComment, likeRate: eLikeRate, commentRate: eCommentRate, periodDays: days, postsPerBlog: ePostsPerBlog, delayMin: eDelayMin, delayMax: eDelayMax, dailyLimit: eDailyLimit, skipDone: eSkipDone, aiComment, commentTone: eCommentTone, geminiKey, minVisitors: visMin, maxVisitors: visMax, searchEntry, jobId: eJobIdRef.current, ...(userId ? { userId } : {}) });
    const es = new BotEventStream(`${BOT}/api/engage`, { method: "POST", headers: { "Content-Type": "application/json" }, body }); eEsRef.current = es;
    let aiFbShown = false;
    es.onmessage = e => {
      const d = JSON.parse(e.data);
      if (d.type === "log") {
        // ★AI 한도 소진 → 순환 댓글 자동 전환: 팝업 한 번 + 로그엔 보기 좋게 표시
        if (typeof d.msg === "string" && d.msg.startsWith("AI_FALLBACK::")) {
          const clean = d.msg.replace("AI_FALLBACK::", "");
          addELog(clean);
          if (!aiFbShown) { aiFbShown = true; alert("⚠️ Gemini 무료 한도를 다 써서\nAI 댓글 대신 '순환 댓글'로 자동 전환했어요.\n\n작업은 계속 진행돼요. (한도는 내일 초기화)"); }
        } else addELog(d.msg);
      }
      if (d.type === "quota_info" && Number.isFinite(Number(d.used))) { setEUsed(Number(d.used)); onEngageUsageChange?.(Number(d.used)); }
      if (d.type === "result") setEResults(p => p.map(r => r.blogId === d.blogId ? { ...r, status: d.status, postUrl: d.postUrl || "", liked: d.liked, commented: d.commented, message: d.message } : r));
      if (d.type === "progress") { setEDoneCnt(d.done); setEFailCnt(d.fail); }
      if (d.type === "done") { addELog("🎉 작업 완료!"); setEWorking(false); es.close(); }
      if (d.type === "error") { addELog(`❌ 오류: ${d.msg}`); setEWorking(false); es.close(); }
    };
    es.onerror = () => { addELog("❌ 작업 연결 오류 (다시 '작업 시작'을 누르면 재시도합니다)"); setEWorking(false); es.close(); };
    es.onclose = () => setEWorking(false);
  };

  const handleEngageStop = async () => {
    if (eEsRef.current) { eEsRef.current.close(); eEsRef.current = null; }
    try { await botFetch(`${BOT}/api/stop/${eJobIdRef.current}`, { method: "POST" }); } catch {}
    addELog("⛔ 중단"); setECrawling(false); setEWorking(false);
  };

  /* 답방 1단계: 내 블로그 글 목록 불러오기(추출) */
  const handleLoadMyPosts = () => {
    const acc = activeAccount;
    if (!acc) return alert("먼저 내 블로그 계정을 연결하세요");
    setRLoadingPosts(true); setRMyPosts([]); addRLog("📥 내 블로그 글 불러오는 중...");
    const periodDays = rPeriod === "custom" ? rCustomDays : rPeriod;   // 직접설정이면 입력 일수 사용
    const q = new URLSearchParams({ accountId: acc.accountId, selectMode: rSelectMode, count: String(rTargetPosts), period: String(periodDays), ...(userId ? { userId } : {}) });
    const es = new BotEventStream(`${BOT}/api/my-posts?${q.toString()}`);
    es.onmessage = e => {
      const d = JSON.parse(e.data);
      if (d.type === "log") addRLog(d.msg);
      if (d.type === "posts") { setRMyPosts(d.posts || []); addRLog(`✅ 내 글 ${d.posts?.length || 0}개 불러왔어요`); setRLoadingPosts(false); es.close(); }
      if (d.type === "error") { addRLog(`❌ ${d.msg}`); setRLoadingPosts(false); es.close(); }
    };
    es.onerror = () => { addRLog("❌ 불러오기 연결 오류 (다시 시도해주세요)"); setRLoadingPosts(false); es.close(); };
  };

  /* 답방 2단계: 불러온 글의 댓글에 대댓글 실행 */
  const handleReplyStart = () => {
    const acc = activeAccount;
    if (!acc) return alert("먼저 답방할 내 블로그 계정을 연결하세요");
    if (!rMyPosts.length) return alert("먼저 '📥 내 글 불러오기'로 대상 글을 불러오세요");
    if (!isUnlimitedPlan && replyUsed >= replyLimit) return alert(`오늘 답방 한도(${replyLimit}건)를 모두 사용했어요. 자정에 초기화됩니다.`);
    if (rMode === "ai" && !(localStorage.getItem("publy_gemini_key") || "")) {
      if (!confirm("AI 답글은 Gemini(무료) 키가 필요해요. 키가 없으면 답글이 건너뛰어집니다. 그래도 시작할까요?")) return;
    }
    setRDoneCnt(0); setRFailCnt(0); setRWorking(true);
    rJobIdRef.current = Date.now().toString();
    const geminiKey = rMode === "ai" ? ((localStorage.getItem("publy_gemini_key") || "")) : "";
    addRLog(`🚀 답방 시작 — 글 ${rMyPosts.length}개 / ${rMode === "ai" ? `AI 답글(${rTone})` : "고정 답글"}${rOnlyNew ? " / 미답변만" : ""}${rReplyToReplies ? " / 대대댓글 1회 답" : ""}`);
    const body = JSON.stringify({ accountId: acc.accountId, posts: rMyPosts.map(p => p.url), mode: rMode, comment: rComment, tone: rTone, onlyNew: rOnlyNew, replyToReplies: rReplyToReplies, delayMin: rDelayMin, delayMax: rDelayMax, geminiKey, jobId: rJobIdRef.current, ...(userId ? { userId } : {}) });
    const es = new BotEventStream(`${BOT}/api/reply`, { method: "POST", headers: { "Content-Type": "application/json" }, body }); rEsRef.current = es;
    es.onmessage = e => {
      const d = JSON.parse(e.data);
      if (d.type === "log") addRLog(d.msg);
      if (d.type === "result") {
        addRLog(`${d.status === "success" ? "✅" : d.status === "skip" ? "⏭️" : "❌"} ${d.postTitle || d.blogId || ""} ${d.message || ""}`);
        if (d.status === "success" && userId) setReplyUsed(u => u + 1);
      }
      if (d.type === "progress") { setRDoneCnt(d.done); setRFailCnt(d.fail); }
      if (d.type === "done") { addRLog("🎉 답방 완료!"); setRWorking(false); es.close(); }
      if (d.type === "error") { addRLog(`❌ 오류: ${d.msg}`); setRWorking(false); es.close(); }
    };
    es.onerror = () => { addRLog("❌ 연결 오류 (다시 '답방 시작'을 누르면 재시도합니다)"); setRWorking(false); es.close(); };
    es.onclose = () => setRWorking(false);
  };
  const handleReplyStop = async () => {
    if (rEsRef.current) { rEsRef.current.close(); rEsRef.current = null; }
    try { await botFetch(`${BOT}/api/stop/${rJobIdRef.current}`, { method: "POST" }); } catch {}
    addRLog("⛔ 중단"); setRWorking(false);
  };

  /* 품앗이 실행: 연결된 계정들끼리 서로 공감·댓글 */
  const handlePumasiStart = () => {
    const connected = accounts.filter(a => a.sessionOk && a.blogId);
    if (connected.length < 2) return alert("품앗이는 연결된(비번 확인된) 계정이 2개 이상 필요해요.\n계정을 추가하고 '계정 연결하기'로 먼저 연결해주세요.");
    if (pumDoComment && pumCommentMode === "ai" && !localStorage.getItem("publy_gemini_key")) {
      if (!confirm("AI 자동 댓글은 Gemini(무료) 키가 필요해요. 키가 없으면 댓글이 건너뛰어져요. 그래도 시작할까요?")) return;
    }
    setPumLogs([]); setPumDone(0); setPumSkip(0); setPumFail(0); setPumWorking(true);
    pumJobIdRef.current = Date.now().toString();
    const comment = pumCommentMode === "single" ? pumComment
      : pumCommentMode === "multi" ? pumMultiComments.split("\n").filter(l => l.trim()).join("|||") : "";
    const geminiKey = pumCommentMode === "ai" ? (localStorage.getItem("publy_gemini_key") || "") : "";
    // ★받을 수 상한 = 등급 기준(무료2·베3·프5·무제한999). 연결 계정 수가 적으면 봇·서버가 자연스럽게 실제 방문 수로 제한(초과 설정해도 손해 없음).
    const maxReceivers = isUnlimitedPlan ? 999 : pumasiAccountLimit;
    const accs = connected.map(a => ({
      accountId: a.accountId, blogId: a.blogId,
      posts: Math.min(isUnlimitedPlan ? 999 : pumasiPostsLimit, Math.max(1, pumPostsByAcc[a.accountId] || 3)),
      receiveLimit: pumNoReceive[a.accountId] ? 0 : Math.min(maxReceivers, Math.max(0, pumReceiveByAcc[a.accountId] ?? 3)),   // 안 받기면 0
      noGive: !!pumNoGive[a.accountId],   // 안 가기면 남 방문 안 함
    }));
    addPumLog(`🤝 품앗이 시작 — 계정 ${accs.length}개 (${accs.map(a => `${a.blogId}:${a.noGive ? "안감" : `줄글${a.posts}`}·${a.receiveLimit === 0 ? "안받음" : `받기${a.receiveLimit}`}`).join(", ")})`);
    const body = JSON.stringify({ accounts: accs, comment, doLike: pumDoLike, doComment: pumDoComment, aiComment: pumCommentMode === "ai", commentTone: pumTone, geminiKey, delayMin: pumDelayMin, delayMax: pumDelayMax, readRelated: pumReadRelated, readRelatedMode: pumReadRelatedMode, readSpeed: pumReadSpeed, periodDays: pumPeriodDays, searchEntry, searchKeyword: pumSearchKeyword, spreadHours: pumSpread / 60, jobId: pumJobIdRef.current, ...(userId ? { userId } : {}) });
    const es = new BotEventStream(`${BOT}/api/pumasi`, { method: "POST", headers: { "Content-Type": "application/json" }, body }); pumEsRef.current = es;
    let pumAiFbShown = false;
    es.onmessage = e => {
      const d = JSON.parse(e.data);
      if (d.type === "log") {
        if (typeof d.msg === "string" && d.msg.startsWith("AI_FALLBACK::")) {
          addPumLog(d.msg.replace("AI_FALLBACK::", ""));
          if (!pumAiFbShown) { pumAiFbShown = true; alert("⚠️ Gemini 무료 한도를 다 써서\nAI 댓글 대신 '순환 댓글'로 자동 전환했어요.\n\n품앗이는 계속 진행돼요. (한도는 내일 초기화)"); }
        } else addPumLog(d.msg);
      }
      if (d.type === "result" && userId) { getPumasiDailyUsage(userId).then(setPumUsed); }
      if (d.type === "progress") { setPumDone(d.done); setPumFail(d.fail); setPumSkip(d.skip ?? 0); }
      if (d.type === "done") { addPumLog("🎉 품앗이 완료!"); setPumWorking(false); es.close(); }
      if (d.type === "error") { addPumLog(`❌ 오류: ${d.msg}`); setPumWorking(false); es.close(); }
    };
    es.onerror = () => { addPumLog("❌ 연결 오류 (다시 시작을 누르면 재시도)"); setPumWorking(false); es.close(); };
    es.onclose = () => setPumWorking(false);
  };
  const handlePumasiStop = async () => {
    if (pumEsRef.current) { pumEsRef.current.close(); pumEsRef.current = null; }
    try { await botFetch(`${BOT}/api/stop/${pumJobIdRef.current}`, { method: "POST" }); } catch {}
    addPumLog("⛔ 중단"); setPumWorking(false);
  };
  // 품앗이 미리보기: 각 대상 계정의 총 글 / 이미 댓글 단 글 / 남은 글(시작 전에 눈으로 확인)
  const handlePumasiPreview = async () => {
    const conn = accounts.filter(a => a.sessionOk && a.blogId);
    if (conn.length < 2) { setPumPreview(null); return; }
    setPumPreviewLoading(true);
    try {
      const r = await botFetch(`${BOT}/api/pumasi-preview`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ accounts: conn.map(a => ({ accountId: a.accountId, blogId: a.blogId })) }) });
      const d = await r.json();
      setPumPreview(d.rows || []);
    } catch { setPumPreview(null); }
    setPumPreviewLoading(false);
  };

  const handlePumasiReport = async (blogId: string) => {
    if (!blogId) return;
    setPumReportLoading(true); setPumReport(null); setPumReportBlog(blogId);
    try {
      const r = await botFetch(`${BOT}/api/pumasi-report?blogId=${encodeURIComponent(blogId)}`);
      const d = await r.json();
      if (d.error) { alert(`리포트를 불러오지 못했어요: ${d.error}`); }
      else setPumReport(d);
    } catch (e: any) { alert(`리포트 오류: ${e.message}`); }
    setPumReportLoading(false);
  };

  /* 블로그 건강검진 실행 */
  const handleBlogDiagnose = () => {
    const acc = activeAccount;
    if (!acc) return alert("먼저 진단할 내 블로그 계정을 연결하세요");
    if (!isUnlimitedPlan && scUsed >= scLimit) return alert(`오늘 블로그 진단 횟수(${scLimit}회)를 모두 사용했어요. 자정에 초기화됩니다.`);
    setScLoading(true); setScResult(null); setScLogs([]); setScSolutions(null); addScLog("📈 블로그 지표를 수집하는 중...");
    if (userId) { incrementBlogscoreQuota(userId).catch(() => {}); setScUsed(u => u + 1); }  // 진단 시작 시 1회 차감
    const q = new URLSearchParams({ accountId: acc.accountId, plan, ...(userId ? { userId } : {}) });
    const es = new BotEventStream(`${BOT}/api/blog-stats?${q.toString()}`);
    es.onmessage = e => {
      const d = JSON.parse(e.data);
      if (d.type === "log") addScLog(d.msg);
      if (d.type === "stats") { setScResult(d.stats); addScLog("✅ 진단 완료!"); setScLoading(false); es.close(); }
      if (d.type === "error") { addScLog(`🔴 ${d.msg}`); reportError({ userId, blogId: activeAccount?.blogId, stage: "블로그 진단", message: d.msg || "" }); setScLoading(false); es.close(); }
    };
    es.onerror = () => { addScLog("❌ 연결 오류 (다시 시도해주세요)"); setScLoading(false); es.close(); };
  };

  /* 📄 블로그 진단 보고서 PDF — 진단 결과를 제출용 새 창(인쇄→PDF 저장)으로. 소상공인·대행사 미팅 제출용. */
  const downloadBlogReport = () => {
    if (!scResult) { alert("먼저 '블로그 진단 시작'으로 건강 리포트를 만들어 주세요"); return; }
    const s = scResult;
    const esc = (v: any) => String(v ?? "").replace(/[&<>]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c] || c));
    // 점수·등급 재계산(화면과 동일 로직)
    const kstDayNum = (ms: number) => Math.floor((ms + 9 * 3600000) / 86400000);
    const todayNum = kstDayNum(Date.now());
    const dayNumOf = (d: string) => { const t = new Date(`${d}T00:00:00+09:00`).getTime(); return Number.isFinite(t) ? kstDayNum(t) : NaN; };
    const dayNums = (s.recentDates || []).map(dayNumOf).filter(n => Number.isFinite(n)).sort((a, b) => b - a);
    const recent30 = dayNums.filter(n => (todayNum - n) <= 30).length;
    const lastDaysAgo = dayNums.length ? (todayNum - dayNums[0]) : 999;
    const score = Math.round(Math.min(30, (s.totalPosts / 100) * 30) + Math.min(25, (s.neighbors / 1000) * 25) + Math.min(30, (recent30 / 12) * 30) + (lastDaysAgo <= 3 ? 15 : lastDaysAgo <= 7 ? 10 : lastDaysAgo <= 14 ? 5 : 0));
    const grade = score >= 80 ? { label: "최적화", color: "#8b5cf6" } : score >= 60 ? { label: "우수", color: "#3b82f6" } : score >= 40 ? { label: "성장중", color: "#00c896" } : score >= 20 ? { label: "초기", color: "#f59e0b" } : { label: "휴면", color: "#ef4444" };
    // 진단·처방
    const tips: string[] = [];
    if (recent30 < 8) tips.push("발행이 뜸해요. 네이버는 꾸준한 발행을 선호합니다 — 최소 주 2~3회 이상 권장.");
    if (lastDaysAgo > 7) tips.push(`마지막 글이 ${lastDaysAgo}일 전입니다. 방치되면 노출이 줄어요 — 새 글 발행 필요.`);
    if (s.neighbors < 300) tips.push("이웃이 적어요. 서이추로 이웃을 늘리면 방문·소통이 커집니다.");
    if (s.totalPosts < 30) tips.push("글이 아직 적어요. 주제를 정해 꾸준히 쌓아야 블로그 힘이 붙습니다.");
    if (s.lowQualitySuspected === true) tips.push("검사한 글 다수가 제목 검색 100위 밖에서 누락됐어요. 제목·본문의 반복 키워드·상업성 표현 점검 필요.");
    if (s.visitorDrop?.detected) tips.push(`${s.visitorDrop.message}. 유입 검색어 순위 변화와 최근 수정·삭제 글을 확인하세요.`);
    if (!tips.length) tips.push("전반적으로 건강합니다. 공감·댓글·답방으로 소통을 더 키우세요.");
    // 노출 검사
    const checks = (s.exposureChecks || []).filter(c => c.exposed !== null);
    const exposed = checks.filter(c => c.exposed).length;
    const exposeRows = checks.slice(0, 12).map(c => `<tr><td>${esc(c.title)}</td><td class="${c.exposed ? "up" : "dn"}">${c.exposed ? (c.rank ? c.rank + "위" : "노출") : "누락"}</td></tr>`).join("");
    // 방문자 추이(SVG)
    const vd = s.visitorDays || [];
    let chartSvg = "";
    if (vd.length >= 2) {
      const vals = vd.map(d => d.visitors); const W = 640, H = 130, pad = 22;
      const mx = Math.max(...vals), mn = Math.min(...vals), sp = Math.max(1, mx - mn);
      const pts = vals.map((v, i) => `${(pad + i * (W - pad * 2) / (vals.length - 1)).toFixed(1)},${(H - pad - (v - mn) / sp * (H - pad * 2)).toFixed(1)}`);
      chartSvg = `<div class="chart"><b>📈 방문자 추이 (최근 ${vd.length}일)</b><svg viewBox="0 0 ${W} ${H}" width="100%" height="150" preserveAspectRatio="none"><polyline points="${pts.join(" ")}" fill="none" stroke="#00c896" stroke-width="3" stroke-linejoin="round"/>${pts.map(p => { const [x, y] = p.split(","); return `<circle cx="${x}" cy="${y}" r="3.5" fill="#00c896"/>`; }).join("")}</svg></div>`;
    }
    // 유입 키워드
    const kw = (s.inflowKeywords || []).slice(0, 10);
    const kwBlock = kw.length ? `<h2>🔑 유입 검색어 TOP ${kw.length}</h2><div class="kw">${kw.map(k => `<span>${esc(k.keyword)}${k.count ? ` <b>${k.count}</b>` : ""}</span>`).join("")}</div>` : "";
    const activityLabel = s.activity ? (s.activity.level === "active" ? "🟢 활성" : s.activity.level === "normal" ? "🟡 보통" : "🔴 비활성") : "-";
    const html = `<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>${esc(s.blogId)} 블로그 건강 진단 보고서</title>
    <style>body{font-family:'Noto Sans KR',-apple-system,sans-serif;color:#141821;max-width:760px;margin:32px auto;padding:0 22px;line-height:1.65}
    h1{font-size:24px}h2{font-size:16px;margin:26px 0 10px}
    .brand{display:flex;align-items:center;gap:10px;padding-bottom:12px;border-bottom:3px solid ${grade.color};margin-bottom:4px}
    .logo{width:34px;height:34px;border-radius:9px;background:linear-gradient(135deg,#8b5cf6,#ec4899);color:#fff;font-weight:900;font-size:18px;display:flex;align-items:center;justify-content:center}
    .btag{font-size:11px;font-weight:900;letter-spacing:.12em;color:${grade.color}}.bttl{font-size:20px;font-weight:900}
    .top{background:linear-gradient(120deg,#f5f3ff,#fdf2f8);border:1px solid #e9e4f5;border-radius:14px;padding:18px;margin:16px 0;display:flex;align-items:center;gap:18px}
    .scorec{width:88px;height:88px;border-radius:50%;border:8px solid ${grade.color};display:flex;flex-direction:column;align-items:center;justify-content:center;flex-shrink:0}
    .scorec b{font-size:26px;color:${grade.color};line-height:1}.scorec span{font-size:10px;color:#6b7280}
    .gl{font-size:22px;font-weight:900;color:${grade.color}}
    .mgrid{display:flex;gap:10px;margin:10px 0}.mc{flex:1;border:1px solid #e5e7eb;border-radius:10px;padding:11px;text-align:center}.mc span{font-size:11px;color:#6b7280;display:block}.mc b{font-size:19px}
    .todo{margin:8px 0;padding-left:20px}.todo li{margin:6px 0;font-size:13px}
    .rtbl{width:100%;border-collapse:collapse;margin:8px 0;font-size:12.5px}.rtbl th,.rtbl td{border:1px solid #e5e7eb;padding:7px 9px;text-align:left}.rtbl th{background:#f5f3ff}
    .up{color:#059669;font-weight:700}.dn{color:#dc2626;font-weight:700}
    .chart{border:1px solid #e5e7eb;border-radius:12px;padding:14px;margin:14px 0;background:#fafafa}
    .kw{display:flex;flex-wrap:wrap;gap:6px}.kw span{background:#f5f3ff;border:1px solid #e9e4f5;border-radius:99px;padding:5px 11px;font-size:12px}.kw b{color:#8b5cf6}
    .foot{margin-top:26px;color:#6b7280;font-size:11px;border-top:1px solid #e5e7eb;padding-top:12px}
    @media print{body{margin:0}}</style></head><body>
    <div class="brand"><div class="logo">P</div><div><div class="btag">PUBLY · 블로그 건강 진단 보고서</div><div class="bttl">📊 ${esc(s.blogId)}</div></div><div style="margin-left:auto;text-align:right;font-size:11px;color:#6b7280">발행일<br/><b style="color:#141821;font-size:13px">${new Date().toLocaleDateString("ko-KR")}</b></div></div>
    <div class="top"><div class="scorec"><b>${score}</b><span>점 / 100</span></div><div><div class="gl">${grade.label}</div><div style="font-size:12px;color:#4b5563;margin-top:4px">발행 활성도 ${activityLabel} · 최근 30일 ${recent30}회 발행 · 마지막 ${lastDaysAgo === 0 ? "오늘" : lastDaysAgo >= 999 ? "-" : lastDaysAgo + "일 전"}</div></div></div>
    <div class="mgrid"><div class="mc"><span>총 글 수</span><b>${s.totalPosts.toLocaleString()}</b></div><div class="mc"><span>이웃 수</span><b>${s.neighbors.toLocaleString()}</b></div><div class="mc"><span>최근 30일 발행</span><b>${recent30}회</b></div><div class="mc"><span>검색 노출</span><b>${checks.length ? `${exposed}/${checks.length}` : "-"}</b></div></div>
    <h2>🎯 지금 해야 할 것</h2><ol class="todo">${tips.map(t => `<li>${esc(t)}</li>`).join("")}</ol>
    ${chartSvg}
    ${kwBlock}
    ${exposeRows ? `<h2>🔎 글 검색 노출 진단</h2><table class="rtbl"><thead><tr><th>글 제목</th><th>검색 순위</th></tr></thead><tbody>${exposeRows}</tbody></table>` : ""}
    <div class="foot">본 보고서는 네이버 블로그 공개 지표(글 수·이웃·발행 활동·검색 노출)를 기준으로 <b>퍼블리</b>가 자동 생성했습니다. 부족 항목은 퍼블리 글쓰기·제목 최적화·서이추·품앗이로 개선할 수 있습니다. · publy.blogautopro.com</div>
    <script>window.onload=()=>{setTimeout(()=>window.print(),400)}</script></body></html>`;
    const w = window.open("", "_blank");
    if (!w) { alert("팝업이 차단됐어요. 팝업을 허용한 뒤 다시 시도해 주세요."); return; }
    w.document.write(html); w.document.close();
  };

  /* 제목 수정 한도 로드 (지수 탭 진입 시) */
  useEffect(() => {
    if (tab === "score" && userId) botFetch(`${BOT}/api/title-edit-quota/${userId}`).then(r => r.json())
      .then(d => { if (d.ok) { setTitleEditUsed(d.used); setTitleEditLimit(d.limit); } }).catch(() => {});
    if (tab === "score" && userId) getReviveDailyUsage(userId).then(setReviveUsed).catch(() => {});
  }, [tab, userId]);

  /* 재발행 목록에서 '지금 바로' 개선안 받기 — 그 글 하나만 AI로 제목1·2 + 진단·키워드·본문팁 생성 →
     글 아래에 펼쳐 보여주고, 둘 중 골라 '제목 변경하러 가기'로 변경. (재발행 흐름 + 개선안 풍부함을 합침) */
  const handleRepublishOne = async (item: { title: string; logNo?: string; blogId?: string }) => {
    if (!activeAccount) return alert("먼저 계정을 연결하세요");
    if (!item.logNo) return alert("이 글의 번호를 못 찾았어요. '검색노출 검사'를 다시 한 번 해주세요.");
    const key = localStorage.getItem("publy_gemini_key") || "";
    if (!key) return alert("AI 제목 추천은 무료 Gemini 키가 필요해요. 설정 → 글쓰기 AI에서 등록해주세요.");
    setRpBusyLog(item.logNo);
    addScLog(`✏️ "${item.title.slice(0, 22)}" 개선안 만드는 중...`);
    // ★★글 본문을 실제로 읽어 AI에 준다 — 제목만 보고 내용과 다른 엉뚱한 제목을 제안하는 문제 방지(테리 지적)
    let bodyBlock = "";
    try {
      const bid = item.blogId || activeAccount?.blogId || "";
      if (bid) {
        addScLog(`📄 글 내용 읽는 중...`);
        const br = await botFetch(`${BOT}/api/post-body?blogId=${encodeURIComponent(bid)}&logNo=${encodeURIComponent(item.logNo)}`);
        const bd = await br.json();
        if (bd.ok && bd.body) bodyBlock = `\n\n[⚠️이 글의 실제 본문 내용 — 반드시 이 내용에 맞는 제목을 제안하라. 내용과 동떨어진 제목 금지]\n${String(bd.body).slice(0, 1200)}`;
      }
    } catch {}
    // ★내 블로그에서 실제로 검색 상위에 잡힌 성공 제목 = AI가 학습할 실전 패턴(개선안 섹션과 동일 방식)
    const winners = (scResult?.exposureChecks || []).filter(c => c.exposed === true && (c as any).rank != null)
      .sort((a: any, b: any) => a.rank - b.rank).slice(0, 8).map((c: any) => `${c.title} (검색 약 ${c.rank}위)`);
    const winnerBlock = winners.length ? `\n\n[⭐이 블로그에서 실제로 검색 상위에 잡힌 '성공 제목'들 — 이 패턴을 학습해 반영]\n${winners.join("\n")}` : "";
    const models = ["gemini-2.5-flash", "gemini-2.5-flash-lite", "gemini-flash-latest", "gemini-flash-lite-latest"];
    const prompt = `너는 네이버 블로그 상위노출(SEO) 전문가야. 아래 글은 검색에 안 뜨고 있어(누락). 이 글의 실제 본문 내용을 읽고, 그 내용에 딱 맞으면서 검색에 잘 잡히는 제목으로 고쳐줘.${bodyBlock}${winnerBlock}\n\n아래 JSON 형식으로만 답해. 다른 말 절대 금지. 순수 JSON만:\n{"diagnosis":"이 제목이 왜 검색 안 되는지 핵심 원인 1문장","newTitle":"개선안1 (본문 내용과 일치 + 실제 검색어를 앞에 배치, 25~35자, 구체적)","newTitle2":"개선안2 (newTitle과 검색어·각도·타겟을 확실히 다르게 한 대안, 반드시 채워라)","keywords":["본문에 실제로 나오는 검색 키워드5개"],"bodyTip":"본문/태그를 어떻게 손보면 좋은지 실전 팁 1문장","expectedEffect":"이렇게 바꾸면 기대되는 효과 1문장"}\n[규칙] ★제목은 반드시 위 본문 내용과 일치해야 한다(내용에 없는 소재로 낚시 금지). 과장·감탄사(대박/충격/완벽/진짜/1등) 금지. 사람들이 진짜 네이버에 치는 검색어(지명+대상+상황) 형태. newTitle2는 절대 비우지 마라(항상 제목 2개).\n\n[원래 제목]\n${item.title}`;
    let sol: any = null;
    for (const model of models) {
      try {
        const gc: any = { maxOutputTokens: 2000, temperature: 0.8, responseMimeType: "application/json" };
        if (model.includes("2.5")) gc.thinkingConfig = { thinkingBudget: 0 };
        const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: gc }) });
        const d: any = await r.json();
        if (!r.ok) continue;
        let txt = (d?.candidates?.[0]?.content?.parts?.[0]?.text || "").trim().replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/```\s*$/i, "").trim();
        const s = txt.indexOf("{"), e = txt.lastIndexOf("}");
        if (s >= 0 && e > s) txt = txt.slice(s, e + 1);
        const x = JSON.parse(txt);
        if (x?.newTitle) { sol = { original: item.title, logNo: item.logNo, diagnosis: String(x.diagnosis || ""), newTitle: String(x.newTitle || ""), newTitle2: String(x.newTitle2 || ""), keywords: Array.isArray(x.keywords) ? x.keywords.map(String) : [], bodyTip: String(x.bodyTip || ""), expectedEffect: String(x.expectedEffect || "") }; break; }
      } catch {}
    }
    setRpBusyLog("");
    if (!sol) { addScLog("❌ 개선안 생성 실패 (잠시 후 다시 시도)"); return alert("개선안 생성에 실패했어요. 잠시 후 다시 시도해주세요."); }
    addScLog(`✅ "${item.title.slice(0, 16)}" 개선안 완성 — 제목 2개 제안`);
    setRpSolutions(prev => ({ ...prev, [item.logNo!]: sol }));   // 이 글 아래에 펼쳐 보여줌
    if (userId && activeAccount) markPrescribed(userId, activeAccount.accountId, item.logNo!);   // 🩺 처방(개선안 받은 날) 기록 → 무한루프 차단
  };

  /* 개선 제목 → 실제 글 제목 자동 변경(재발행) */
  const handleApplyTitle = async (originalTitle: string, newTitle: string, key: string, logNoArg?: string) => {
    const acc = activeAccount;
    if (!acc) return alert("먼저 계정을 연결하세요");
    // logNo: 솔루션에 직접 붙여둔 값 우선, 없으면 원제목 매칭으로 폴백
    const match = (scResult?.exposureChecks || []).find(c => c.title === originalTitle);
    const logNo = logNoArg || match?.logNo || "";
    if (!logNo) return alert("이 글의 번호를 못 찾았어요. '검색노출 검사'를 다시 실행한 뒤 시도해주세요.");
    if (!isUnlimitedPlan && titleEditUsed >= titleEditLimit) return alert(`오늘 제목 수정 한도(${titleEditLimit}회)를 모두 사용했어요. 자정에 초기화됩니다.`);
    if (!window.confirm(`이 글의 제목을 아래로 바꿀까요?\n\n"${newTitle}"\n\n※ 네이버 블로그에서 실제로 수정·재발행돼요. 이미 노출 중인 글은 순위가 바뀔 수 있어요.`)) return;
    setTitleEditingKey(key);
    addScLog(`✏️ 제목 변경 시작 — "${originalTitle.slice(0, 20)}" → "${newTitle.slice(0, 20)}"`);
    // ★SSE로 모든 단계를 지수 로그창에 실시간 표시(어디서 멈추는지 다 보이게)
    const body = JSON.stringify({ accountId: acc.accountId, logNo, newTitle, ...(userId ? { userId } : {}) });
    const es = new BotEventStream(`${BOT}/api/update-title`, { method: "POST", headers: { "Content-Type": "application/json" }, body });
    es.onmessage = e => {
      const d = JSON.parse(e.data);
      if (d.type === "log") addScLog(d.msg);
      if (d.type === "done") {
        if (d.ok) { setTitleEditUsed(u => u + 1); addScLog(`✅ 제목 변경 완료!`); if (userId) markTitleChanged(userId, acc.accountId, logNo, newTitle); /* 🩺 수정한 날 기록 → 30일 관찰 시작(무한루프 차단) */ setTrackSol(null); loadCare(); alert(`✅ 제목을 변경했어요!\n"${newTitle}"\n\n검색 반영에는 시간이 걸릴 수 있어요.`); }
        else { addScLog(`❌ 제목 변경 실패: ${d.message || "알 수 없는 오류"}`); alert(`제목 변경 실패: ${d.message || "알 수 없는 오류"}`); }
        setTitleEditingKey(""); es.close();
      }
    };
    es.onerror = () => { addScLog("❌ 제목 변경 연결 오류 (다시 시도해주세요)"); setTitleEditingKey(""); es.close(); };
  };

  // ── 🚀 전체 제목 자동 변경(조합) — 개선안 받기 + 제목변경(alert/confirm 없는 조용한 버전) ──
  // AI 개선안 1개 받기(제목1·2 + 진단·키워드·팁 반환). 실패 시 null.
  const getSolutionQuiet = async (title: string, logNo: string): Promise<{ newTitle: string; newTitle2: string; diagnosis?: string; keywords?: string[]; bodyTip?: string; expectedEffect?: string } | null> => {
    const key = localStorage.getItem("publy_gemini_key") || "";
    if (!key) return null;
    let bodyBlock = "";
    try {
      const bid = activeAccount?.blogId || "";
      if (bid) { const br = await botFetch(`${BOT}/api/post-body?blogId=${encodeURIComponent(bid)}&logNo=${encodeURIComponent(logNo)}`, { signal: AbortSignal.timeout(25000) } as any); const bd = await br.json(); if (bd.ok && bd.body) bodyBlock = `\n\n[⚠️이 글의 실제 본문 — 반드시 이 내용에 맞는 제목. 내용과 동떨어진 제목 금지]\n${String(bd.body).slice(0, 1000)}`; }
    } catch {}
    const prompt = `너는 네이버 블로그 상위노출(SEO) 전문가야. 아래 글은 검색에 안 뜨고 있어(누락). 이 글의 본문 내용에 맞으면서 검색에 잘 잡히는 제목으로 고쳐줘.${bodyBlock}\n\n순수 JSON만: {"diagnosis":"이 제목이 왜 검색 안 되는지 1문장","newTitle":"개선안1(본문내용 일치+실제 검색어 앞배치, 25~35자)","newTitle2":"개선안2(다른 각도, 반드시 채워라)","keywords":["본문 검색 키워드5개"],"bodyTip":"본문/태그 실전팁 1문장","expectedEffect":"기대효과 1문장"}\n[규칙] 내용에 없는 소재로 낚시 금지. 과장·감탄사 금지. newTitle2 절대 비우지 마라.\n\n[원래 제목]\n${title}`;
    for (const model of ["gemini-2.5-flash", "gemini-2.5-flash-lite", "gemini-flash-latest", "gemini-flash-lite-latest"]) {
      try {
        const gc: any = { maxOutputTokens: 1200, temperature: 0.8, responseMimeType: "application/json" };
        if (model.includes("2.5")) gc.thinkingConfig = { thinkingBudget: 0 };
        // ★타임아웃 40초 — 긴 글도 제대로 처리하게 넉넉히(멈춤 방지용 안전장치일 뿐, 건너뛰기용 아님)
        const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: gc }), signal: AbortSignal.timeout(40000) } as any);
        if (!r.ok) continue;
        const d: any = await r.json();
        let txt = (d?.candidates?.[0]?.content?.parts?.[0]?.text || "").trim().replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/```\s*$/i, "").trim();
        const s = txt.indexOf("{"), e = txt.lastIndexOf("}");
        if (s >= 0 && e > s) txt = txt.slice(s, e + 1);
        const x = JSON.parse(txt);
        if (x?.newTitle) return { newTitle: String(x.newTitle), newTitle2: String(x.newTitle2 || x.newTitle), diagnosis: String(x.diagnosis || ""), keywords: Array.isArray(x.keywords) ? x.keywords.map(String) : [], bodyTip: String(x.bodyTip || ""), expectedEffect: String(x.expectedEffect || "") };
      } catch {}
    }
    return null;
  };
  // 제목 1개 변경(조용히 실행, Promise<성공여부>). 자동변경 실행 로직(update-title)은 불가침 — 그대로 호출.
  const applyTitleQuiet = (logNo: string, newTitle: string): Promise<boolean> => new Promise(resolve => {
    const acc = activeAccount;
    if (!acc) return resolve(false);
    let done = false;
    const finish = (ok: boolean) => { if (done) return; done = true; try { es.close(); } catch {} resolve(ok); };
    const body = JSON.stringify({ accountId: acc.accountId, logNo, newTitle, ...(userId ? { userId } : {}) });
    const es = new BotEventStream(`${BOT}/api/update-title`, { method: "POST", headers: { "Content-Type": "application/json" }, body });
    // ★90초 안전 타임아웃 — 봇이 응답 안 해도 멈추지 않고 다음 글로 넘어가게
    const to = setTimeout(() => { addScLog(`   → ⏱ 응답 지연으로 건너뜀`); finish(false); }, 90000);
    es.onmessage = e => {
      const d = JSON.parse(e.data);
      if (d.type === "log") addScLog(d.msg);
      if (d.type === "done") {
        if (d.ok && userId) markTitleChanged(userId, acc.accountId, logNo, newTitle);
        clearTimeout(to); finish(!!d.ok);
      }
    };
    es.onerror = () => { clearTimeout(to); finish(false); };
  });

  // 🚀 지금 목록(list)의 미노출 글 전체를 자동으로: 관찰중 제외 → 개선안 → 제목1·2 랜덤 → 변경. 한도 걸리면 멈추고 업그레이드 팝업.
  const runBulkRetitle = async (targets: { title: string; logNo?: string; blogId?: string }[]) => {
    // 관찰중(이미 제목 바꿔 지켜보는) 글 제외 — 무한루프 차단
    const todo = targets.filter(t => t.logNo).filter(t => {
      const care = careMap[t.logNo!];
      return !(care && computeCareStatus(care).status === "observing");
    });
    if (!todo.length) { alert("변경할 글을 먼저 체크해주세요."); return; }
    if (!localStorage.getItem("publy_gemini_key")) { alert("AI 제목 추천은 무료 Gemini 키가 필요해요. 설정 → 글쓰기 AI에서 등록해주세요."); return; }
    if (!window.confirm(`선택한 글 ${todo.length}개의 제목을 AI가 추천안(2개 중 랜덤)으로 자동 변경할까요?\n\n· AI가 글 내용을 하나하나 읽고 제목을 추천해요\n· ⏱ 글이 많으면 오래 걸려요(1개당 약 10~30초, ${todo.length}개면 대략 ${Math.ceil(todo.length * 20 / 60)}분)\n· ✅ 작업 중 화면·컴퓨터는 꺼지지 않아요 — 창 켜두고 두시면 알아서 끝나요\n· 오늘 제목 수정 한도까지만 진행돼요\n· 실제 네이버 블로그에 반영돼요`)) return;
    setBulkRunning(true); bulkStopRef.current = false; setBulkProgress({ done: 0, total: todo.length });
    addScLog(`🚀 전체 제목 변경 시작 — ${todo.length}개 (관찰중 제외)`);
    let done = 0;
    for (let i = 0; i < todo.length; i++) {
      if (bulkStopRef.current) { addScLog("⏹ 사용자가 중단했어요"); break; }
      // 한도 체크(무제한 제외) — 걸리면 멈추고 업그레이드 팝업
      if (!isUnlimitedPlan && (titleEditUsed + done) >= titleEditLimit) {
        addScLog(`🛑 오늘 제목 수정 한도(${titleEditLimit}회) 도달 — ${done}개 변경, 나머지 ${todo.length - i}개 남음`);
        setBulkUpgrade({ done, left: todo.length - i });
        break;
      }
      const t = todo[i];
      setBulkProgress({ done: i, total: todo.length });
      addScLog(`✏️ (${i + 1}/${todo.length}) "${t.title.slice(0, 20)}" 개선안 받는 중...`);
      // ★"완벽하게 다 바꾸기"(테리): 개선안 실패(Gemini 한도 429)면 건너뛰지 말고 최대 5회까지 끈질기게 재시도.
      //   한도는 시간 지나면 회복되므로 대기(10·20·30·40초)하며 재시도 → 시간 걸려도 결국 성공시킴.
      let sol = await getSolutionQuiet(t.title, t.logNo!);
      for (let retry = 1; retry <= 4 && !sol && !bulkStopRef.current; retry++) {
        const wait = retry * 10;
        addScLog(`   → ⏳ AI 한도로 잠시 대기 후 재시도 (${retry}/4 · ${wait}초 — 시간 걸려도 끝까지 해요)`);
        await new Promise(r => setTimeout(r, wait * 1000));
        if (bulkStopRef.current) break;
        sol = await getSolutionQuiet(t.title, t.logNo!);
      }
      if (bulkStopRef.current) { addScLog("⏹ 사용자가 중단했어요"); break; }   // 개선안 받은 뒤 중단 체크
      if (!sol) { addScLog(`   → ⚠️ "${t.title.slice(0, 16)}" 5번 시도해도 AI 응답 없음 — 남겨둠(나중에 다시 눌러주세요)`); continue; }
      const pick = Math.random() < 0.5 ? sol.newTitle : sol.newTitle2;   // 제목1·2 랜덤
      addScLog(`   → 새 제목(랜덤): "${pick.slice(0, 24)}" 변경 중...`);
      const ok = await applyTitleQuiet(t.logNo!, pick);
      if (ok) { done++; setTitleEditUsed(u => u + 1); addScLog(`   → ✅ 변경 완료 (오늘 ${titleEditUsed + done}/${isUnlimitedPlan ? "∞" : titleEditLimit})`); }
      else addScLog(`   → ❌ 변경 실패, 건너뜀`);
      if (bulkStopRef.current) { addScLog("⏹ 사용자가 중단했어요"); break; }   // 제목변경 뒤 중단 체크
      await new Promise(r => setTimeout(r, 1500));   // 계정 안전 간격
    }
    setBulkProgress({ done, total: todo.length });
    const failed = todo.length - done;
    addScLog(`🎉 전체 제목 변경 마무리 — ${done}개 성공${failed > 0 ? ` · ${failed}개는 못 바꿔 목록에 남겨뒀어요(나중에 다시 눌러주세요)` : ""}`);
    if (done > 0 && failed > 0) alert(`✅ ${done}개 변경 완료!\n\n${failed}개는 AI 한도 등으로 못 바꿔서 재발행 목록에 그대로 남겨뒀어요. 잠시 후(또는 내일) '전체 변경'을 다시 누르면 그 글들부터 이어서 바꿔요.`);
    setBulkRunning(false);
    setRpChecked(new Set());   // 체크 해제
    await loadCare();   // 방금 바꾼 글 = 관찰중으로 → 재발행 목록에서 빠짐, 실패한 글은 그대로 남음
    setRpTick(t => t + 1);
  };

  const scLogNo = (url: string) => url.match(/(?:logNo=|\/)(\d{6,})(?:[/?&]|$)/)?.[1] || "";

  /* 블로그 지수 1단계: 기간에 맞는 내 글 불러오기 */
  const handleLoadScorePosts = () => {
    const acc = activeAccount;
    if (!acc) return alert("먼저 검사할 내 블로그 계정을 연결하세요");
    setScPostsLoading(true); setScPosts([]); setScSelectedLogNos([]); setScSolutions(null);
    const periodDays = scPeriod === "custom" ? scCustomDays : scPeriod;
    const q = new URLSearchParams({ accountId: acc.accountId, selectMode: scPostMode, count: "100", period: String(periodDays) });
    addScLog(`📥 검색노출 검사 글 불러오는 중 (${scPostMode === "all" ? "전체" : `최근 ${periodDays}일`})...`);
    const es = new BotEventStream(`${BOT}/api/my-posts?${q.toString()}`);
    es.onmessage = e => {
      const d = JSON.parse(e.data);
      if (d.type === "log") addScLog(d.msg);
      if (d.type === "posts") {
        const posts = (d.posts || []) as {url:string;title:string;date:string}[];
        const ids = posts.map(post => scLogNo(post.url)).filter(Boolean);
        setScPosts(posts); setScSelectedLogNos(ids); setScPostsLoading(false);
        addScLog(`✅ 검사 후보 ${posts.length}개를 불러왔어요`); es.close();
      }
      if (d.type === "error") { addScLog(`🔴 ${d.msg}`); reportError({ userId, blogId: activeAccount?.blogId, stage: "글 목록 불러오기", message: d.msg || "" }); setScPostsLoading(false); es.close(); }
    };
    es.onerror = () => { addScLog("❌ 글 목록 연결 오류"); setScPostsLoading(false); es.close(); };
  };

  /* 블로그 지수 2단계: 체크한 글만 검색 노출 검사 */
  const handleCheckSelectedExposure = async () => {
    const acc = activeAccount;
    if (!acc) return alert("먼저 검사할 내 블로그 계정을 연결하세요");
    if (!scResult) return alert("먼저 '블로그 진단 시작'으로 기본 건강 리포트를 만들어주세요");
    if (!scSelectedLogNos.length) return alert("검색노출을 확인할 글을 하나 이상 선택하세요");
    setScExposureLoading(true); setScSolutions(null);
    addScLog(`🔎 선택한 글 ${scSelectedLogNos.length}개의 검색노출을 확인하는 중...`);
    try {
      const response = await botFetch(`${BOT}/api/exposure-check`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ accountId: acc.accountId, plan, logNos: scSelectedLogNos }) });
      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error(data.error || `HTTP ${response.status}`);
      // ★재발행 알림용: 각 글의 발행 날짜(scPosts)를 logNo로 매칭해 checks에 붙인다(30일+노출안됨 판별).
      const dateByLog: Record<string,string> = {};
      scPosts.forEach(p => { const ln = scLogNo(p.url); if (ln) dateByLog[ln] = p.date; });
      const checksWithDate = (data.checks || []).map((c: any) => ({ ...c, date: c.logNo ? dateByLog[String(c.logNo)] : undefined }));
      setScResult(prev => prev ? { ...prev, exposureChecks: checksWithDate, lowQualitySuspected: data.lowQualitySuspected, checkedTodayCount: data.checkedTodayCount, exposureCompletedCount: data.completedCount, totalPostsForExposure: data.totalPostsForExposure, exposureLimit: data.limit } : prev);
      // ★재발행 대상 누적 저장(순환 검사로 며칠에 걸쳐 전체 커버): 30일+ 미노출 글을 localStorage에 쌓고, 노출되면 제거.
      try {
        const KEY = "publy_republish_targets";
        const store: Record<string, any> = JSON.parse(localStorage.getItem(KEY) || "{}");
        const now = Date.now();
        for (const c of checksWithDate) {
          if (!c.logNo) continue;
          // ★미노출(100위 밖) 글은 날짜 상관없이 전부 저장 → 기간 필터는 '표시'에서 적용(15일 이내/90일 이후 등)
          if (c.exposed === false) {
            store[c.logNo] = { logNo: c.logNo, title: c.title, date: c.date, blogId: acc.blogId || "", at: now };
          } else if (c.exposed === true) {
            delete store[c.logNo];   // 이제 노출되면 대상에서 제거
          }
        }
        localStorage.setItem(KEY, JSON.stringify(store));
        window.dispatchEvent(new Event("publy-republish-updated"));   // 홈 배너·뱃지 갱신 신호
      } catch {}
      addScLog(`✅ 검색노출 ${data.checks?.length || 0}개 검사 완료`);
      // 🩺 주치의: 검사 결과를 글별 진료차트(publy_post_care)에 기록 — 순위 누적 + 완치(100위 진입) 감지. 죽은 데이터를 살린다.
      if (userId) {
        try {
          const { newlyCured } = await savePostCareChecks(userId, acc.accountId, checksWithDate);
          if (newlyCured.length) { addScLog(`🎉 노출 성공(완치) ${newlyCured.length}개! 축하드려요`); setCelebrate(newlyCured); }
          await loadCare();   // 재발행 목록에 관찰중/처방 상태 즉시 반영
          // 🩺 검사 끝났으니 곧바로 조회수·(제목 바꾼 글)순위도 이어서 자동 수집 — useEffect 타이밍에 의존하지 않게 확실히 실행
          try { await autoCollectViews(); } catch {}
          try { await autoCheckTrackedRanks(); } catch {}
        } catch {}
      }
    } catch (e: any) { addScLog(`🔴 검색노출 검사 실패: ${e.message}`); reportError({ userId, blogId: activeAccount?.blogId, stage: "검색노출 검사", message: e?.message || String(e) }); }
    finally { setScExposureLoading(false); }
  };

  /* 저품질/누락 글 제목·키워드 개선 솔루션 (AI) */
  const handleGetSolutions = async (append = false, silent = false): Promise<number> => {
    const key = (localStorage.getItem("publy_gemini_key") || "");
    if (!key) { if (!silent) alert("제목·키워드 개선 솔루션은 무료 Gemini 키가 필요해요.\n설정 → 글쓰기 AI에서 Gemini 키를 먼저 등록해주세요."); return 0; }
    const checks = scResult?.exposureChecks || [];
    // ★★재발행과 기준 분리(테리 확정): 제목·키워드 솔루션 = 이미 검색 100위 "안"에 뜨는 글(exposed===true & rank≤100)을 '더 위로' 끌어올리는 대상.
    //    (100위 밖 미노출 글은 위쪽 '재발행'이 담당 → 겹치지 않음 → 방금 수정한 글을 또 수정하는 사고 방지.)
    const allInRank = checks.filter(c => c.exposed === true && c.rank != null && c.rank <= 100)
      .sort((a, b) => (b.rank! - a.rank!));   // 순위 낮은(뒤쪽) 글부터 = 개선 여지 큰 순
    const start = append ? (scSolutions?.length || 0) : 0;
    const missingChecks = allInRank.slice(start, start + 10);
    const missing = missingChecks.map(c => c.title);
    if (!missing.length) { if (!silent) alert(append ? "더 받을 글이 없어요 — 100위 안에 뜬 글의 개선안을 모두 받았어요! 👍" : "검색 100위 안에 뜬 글이 없어요.\n(먼저 검색노출 검사를 하거나, 미노출 글은 위쪽 '오래된 글 재발행'에서 살려주세요.)"); return 0; }
    // ★상위(1~10위권) 성공 제목 = AI가 학습할 실전 성공 패턴
    const winners = checks.filter(c => c.exposed === true && c.rank != null).sort((a, b) => (a.rank! - b.rank!)).slice(0, 12).map(c => `${c.title} (검색 약 ${c.rank}위)`);
    setScSolLoading(true); if (!append) { setScSolutions(null); setScSolPage(0); }
    // ★★각 글 본문을 병렬로 읽어 AI에 준다(제목만 보고 내용과 다른 제목 제안 방지). blogId=현재 계정.
    const bid = activeAccount?.blogId || "";
    let bodyMap: Record<string, string> = {};
    if (bid) {
      addScLog(`📄 ${missing.length}개 글 내용 읽는 중...`);
      const bodies = await Promise.all(missingChecks.map(async c => {
        try { const r = await botFetch(`${BOT}/api/post-body?blogId=${encodeURIComponent(bid)}&logNo=${encodeURIComponent(String(c.logNo || ""))}`); const d = await r.json(); return { title: c.title, body: d.ok ? String(d.body || "").slice(0, 700) : "" }; } catch { return { title: c.title, body: "" }; }
      }));
      bodies.forEach(b => { if (b.body) bodyMap[b.title] = b.body; });
    }
    addScLog(`✏️ AI 개선안 생성 중 — ${append ? "다음 " : ""}글 ${missing.length}개${winners.length ? ` (성공 제목 ${winners.length}개 패턴 학습)` : ""}...`);
    const winnerBlock = winners.length
      ? `\n\n[⭐이 블로그에서 실제로 검색 상위에 잡힌 '성공 제목'들 — 반드시 이 패턴을 학습해서 반영]\n${winners.join("\n")}\n→ 위 성공 제목들의 공통 패턴(구체적 지명·제품명·상황·숫자·검색어 배치)을 분석해서, 아래 누락 제목을 '같은 블로그에서 통한 방식'으로 고쳐라. 일반론 말고 이 블로그에 실제로 통한 스타일로.`
      : "";
    const hasBody = Object.keys(bodyMap).length > 0;
    const prompt = `너는 네이버 블로그 상위노출(SEO) 전문가야. 이 블로그의 아래 글들은 이미 네이버 검색 100위 안에 노출은 되고 있지만 순위가 아쉬워(더 위로 올릴 여지가 큼). ${hasBody ? "각 글의 실제 본문 내용을 읽고, 그 내용에 딱 맞으면서 " : ""}각 제목·키워드를 다듬어 검색 순위를 더 끌어올려줘.${winnerBlock}\n\n각 제목마다 아래 JSON 형식으로만 답해. 다른 말 절대 금지. 순수 JSON 배열만:\n[{"original":"원래제목","diagnosis":"이 제목이 왜 순위가 아쉬운지 핵심 원인 1문장(과장/낚시/검색어없음/너무추상 등)","newTitle":"개선안1 (본문 내용과 일치 + 실제 검색어를 앞에 배치, 25~35자, 구체적)","newTitle2":"개선안2 (다른 각도의 대안)","keywords":["이 글 본문에 실제로 나오는 검색 키워드5개"],"bodyTip":"본문/태그를 어떻게 손보면 좋은지 실전 팁 1문장","expectedEffect":"이렇게 바꾸면 기대되는 효과 1문장"}]\n\n[핵심 규칙]\n- ★제목은 반드시 각 글의 본문 내용과 일치해야 한다(내용에 없는 소재로 낚시 절대 금지).\n- newTitle: 사람들이 진짜 네이버에 치는 검색어(지명+대상+상황) 형태. 과장·감탄사(대박/진짜/1등/충격) 절대 금지.\n- ★newTitle2는 반드시 채워라(절대 비우지 마라). newTitle과 검색어·각도·타겟을 확실히 다르게 한 두 번째 대안을 꼭 제시해서, 항상 제목 2개를 준다.\n- 위 '성공 제목' 패턴이 있으면 그 스타일을 최대한 따라라.\n- keywords: 검색량 있을 법한 구체 키워드 5개(롱테일 포함).\n- 모든 답변은 실행 가능하고 구체적으로. 뻔한 일반론 금지.\n\n[대상 글${hasBody ? " (제목 + 실제 본문 발췌)" : ""}]\n${missing.map((t, i) => `${i + 1}. 제목: ${t}${bodyMap[t] ? `\n   본문: ${bodyMap[t]}` : ""}`).join("\n\n")}`;
    // 2.0-flash 우선(thinking 토큰 안 먹어 JSON 안정적). 토큰 넉넉히(8000)+JSON 강제로 응답 잘림·설명 섞임 방지.
    // ★실검증(2026-08-24): gemini-2.0-flash·2.0-flash-lite·1.5-flash는 구글이 폐기(404). 살아있는 모델만 사용.
    //   각 모델은 한도가 별도라, 2.5-flash가 한도 차도 다음 모델(2.5-flash-lite 등, 한도 남음)로 넘어가 성공한다.
    const models = ["gemini-2.5-flash", "gemini-2.5-flash-lite", "gemini-flash-latest", "gemini-flash-lite-latest"];
    let lastErr = "";
    for (const model of models) {
      try {
        const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { maxOutputTokens: 8000, temperature: 0.8, responseMimeType: "application/json" } }),
        });
        const d: any = await r.json();
        if (!r.ok) { lastErr = d?.error?.message || `API ${r.status}`; if (r.status === 404 || r.status === 400) continue; continue; }
        let txt: string = d?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || "";
        txt = txt.replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/```\s*$/i, "").trim();
        // 배열 부분만 안전하게 추출(앞뒤에 설명이 붙어도 파싱되게)
        const s = txt.indexOf("["), e2 = txt.lastIndexOf("]");
        if (s >= 0 && e2 > s) txt = txt.slice(s, e2 + 1);
        const arr = JSON.parse(txt);
        if (Array.isArray(arr) && arr.length) {
          // ★AI가 돌려준 original이 실제 제목과 미세하게 달라도(공백·재작성) logNo를 확실히 붙인다: 정확→정규화→순서 폴백
          const norm = (t: string) => t.replace(/\s+/g, "").toLowerCase();
          const mapped = arr.map((x: any, idx: number) => {
            const aiOrig = String(x.original || "");
            const mc = missingChecks.find(c => c.title === aiOrig)
              || missingChecks.find(c => norm(c.title) === norm(aiOrig))
              || missingChecks[idx];   // 같은 순서로 생성되므로 마지막 폴백
            return { original: mc?.title || aiOrig, logNo: mc?.logNo || "", diagnosis: String(x.diagnosis || ""), newTitle: String(x.newTitle || ""), newTitle2: String(x.newTitle2 || ""), keywords: Array.isArray(x.keywords) ? x.keywords.map(String) : [], bodyTip: String(x.bodyTip || ""), expectedEffect: String(x.expectedEffect || ""), reason: String(x.reason || "") };
          });
          setScSolutions(prev => append && prev ? [...prev, ...mapped] : mapped);   // ★'더 받기'면 기존에 누적
          setScSolLoading(false);
          addScLog(`✅ AI 개선안 ${arr.length}개 생성 완료 (${model})`);
          return arr.length;   // 성공: 생성 개수 반환(전체받기가 이어서 판단)
        }
      } catch (e: any) { lastErr = e.message; }
    }
    setScSolLoading(false);
    addScLog(`❌ AI 개선안 생성 실패: ${lastErr || "응답 형식 오류"}`);
    if (!silent) alert("솔루션 생성에 실패했어요. 잠시 후 다시 시도해주세요.\n(" + (lastErr || "응답 형식 오류") + ")");
    return 0;   // 실패
  };

  /* 전체 개선안 한 번에 받기 — 누락 글 전부를 10개씩 자동 반복 호출해 모두 채운다(C안). */
  const [scSolAll, setScSolAll] = useState(false);   // 전체받기 진행중
  const handleGetAllSolutions = async () => {
    const key = (localStorage.getItem("publy_gemini_key") || "");
    if (!key) return alert("제목·키워드 개선 솔루션은 무료 Gemini 키가 필요해요.\n설정 → 글쓰기 AI에서 Gemini 키를 먼저 등록해주세요.");
    const total = (scResult?.exposureChecks || []).filter(c => c.exposed === true && c.rank != null && c.rank <= 100).length;
    if (!total) return alert("검색 100위 안에 뜬 글이 없어요.\n(미노출 글은 위쪽 '오래된 글 재발행'에서 살려주세요.)");
    setScSolAll(true);
    addScLog(`🚀 전체 개선안 받기 시작 — 100위 안 글 ${total}개 (10개씩 자동 진행)`);
    // 첫 배치는 새로, 이후는 append. 안전장치: 최대 total/10 + 2회
    let done = false;
    for (let i = 0; i < Math.ceil(total / 10) + 2 && !done; i++) {
      const got = await handleGetSolutions(i > 0, true);   // silent=true(중간 팝업 없음)
      // 현재까지 받은 개수를 함수형으로 확인
      await new Promise<void>(res => setScSolutions(prev => { if ((prev?.length || 0) >= total || !got) done = true; res(); return prev; }));
      if (!got) { addScLog("⚠️ 한도·오류로 잠시 멈췄어요. 잠시 후 '더 받기'로 이어서 받을 수 있어요."); break; }
      await new Promise(r => setTimeout(r, 400));   // API 부담 완화
    }
    setScSolAll(false);
    addScLog(`✅ 전체 개선안 받기 완료`);
  };

  /* CSV 저장 */
  const handleSaveHistory = () => {
    const csv = ["키워드,블로그ID,결과,메시지", ...results.map(r => `${r.keyword},${r.blogId},${r.status},${r.message}`)].join("\n");
    const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob(["\uFEFF" + csv], { type: "text/csv" }));
    a.download = `서이추_${new Date().toLocaleDateString("ko-KR").replace(/\. /g, "-").replace(".", "")}.csv`; a.click();
  };

  const handleEngageSaveHistory = () => {
    const csv = ["키워드,블로그ID,포스트URL,공감,댓글,결과,메시지", ...eResults.map(r => `${r.keyword},${r.blogId},${r.postUrl},${r.liked},${r.commented},${r.status},${r.message}`)].join("\n");
    const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob(["\uFEFF" + csv], { type: "text/csv" }));
    a.download = `공감댓글_${new Date().toLocaleDateString("ko-KR").replace(/\. /g, "-").replace(".", "")}.csv`; a.click();
  };

  const handleLoadList = (isEngage = false) => {
    const input = document.createElement("input"); input.type = "file"; input.accept = ".csv,.txt";
    input.onchange = async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0]; if (!file) return;
      const text = await file.text();
      const lines = text.split("\n").map(l => l.trim()).filter(Boolean);
      const newTargets: Target[] = lines.map(line => {
        const parts = line.split(",");
        return parts.length >= 2 ? { keyword: parts[0].trim(), blogId: parts[1].trim() } : { keyword: "직접입력", blogId: parts[0].trim() };
      }).filter(t => t.blogId);
      if (isEngage) {
        setETargets(newTargets);
        setEResults(newTargets.map(t => ({ ...t, postUrl: "", liked: false, commented: false, status: "pending" as const, message: "대기중" })));
        addELog(`📂 ${newTargets.length}개 불러오기 완료`);
      } else {
        setTargets(newTargets);
        setResults(newTargets.map(t => ({ ...t, status: "pending" as const, message: "대기중" })));
        addLog(`📂 ${newTargets.length}개 불러오기 완료`);
      }
    };
    input.click();
  };

  /* 헬퍼 */
  const statusColor = (s: WorkResult["status"]) => s === "success" ? "var(--success)" : s === "fail" ? "var(--danger)" : s === "skip" ? "var(--text3)" : s === "running" ? "var(--info)" : "var(--text3)";
  const statusLabel = (s: WorkResult["status"]) => s === "success" ? "신청 완료" : s === "fail" ? "실패" : s === "skip" ? "스킵" : s === "running" ? "진행중..." : "대기중";
  const eStatusColor = (s: EngageResult["status"]) => s === "success" ? "var(--success)" : s === "fail" ? "var(--danger)" : s === "skip" ? "var(--text3)" : s === "running" ? "var(--info)" : "var(--text3)";
  const eStatusLabel = (s: EngageResult["status"]) => s === "success" ? "완료" : s === "fail" ? "실패" : s === "skip" ? "스킵" : s === "running" ? "진행중..." : "대기중";

  const Toggle = ({ val, set, label }: { val: boolean; set: (v: boolean) => void; label: string }) => (
    <label style={{ display: "flex", alignItems: "center", gap: 10, cursor: "pointer", fontSize: 13, color: "var(--text)", padding: "6px 0" }}>
      <div onClick={() => set(!val)} style={{ width: 42, height: 24, borderRadius: 99, background: val ? "var(--accent)" : "var(--border)", position: "relative", transition: "background .2s", cursor: "pointer", flexShrink: 0 }}>
        <div style={{ position: "absolute", top: 3, left: val ? 21 : 3, width: 18, height: 18, borderRadius: "50%", background: "#fff", transition: "left .2s", boxShadow: "0 1px 4px rgba(0,0,0,.2)" }} />
      </div>
      {label}
    </label>
  );

  /* ── 공통 레이아웃 헬퍼 ── */
  // 등급별 일일 사용량 게이지 (답방·블로그진단 공용)
  const UsageGauge = ({ label, used, limit, unit, color }: { label: string; used: number; limit: number; unit: string; color: string }) => {
    const pct = isUnlimitedPlan ? 0 : Math.min(100, (used / Math.max(1, limit)) * 100);
    const danger = !isUnlimitedPlan && used >= limit;
    const remain = Math.max(0, limit - used);
    return (
      <div className="card" style={{ padding: "14px 18px" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 9 }}>
          <span style={{ fontSize: 12.5, fontWeight: 700, color: "var(--text2)" }}>{label} <span style={{ fontSize: 10.5, color: "var(--text3)", fontWeight: 600 }}>(자정 초기화)</span></span>
          <span style={{ fontSize: 13, fontWeight: 800, color: danger ? "var(--danger)" : color }}>
            {isUnlimitedPlan ? "∞ 무제한" : <>{used} / {limit}{unit} · <span style={{ color: danger ? "var(--danger)" : "#00c896" }}>{danger ? "한도 도달" : `${remain}${unit} 남음`}</span></>}
          </span>
        </div>
        <div style={{ height: 8, borderRadius: 99, background: "var(--card2)", overflow: "hidden" }}>
          <div style={{ height: "100%", borderRadius: 99, width: isUnlimitedPlan ? "100%" : `${pct}%`, background: danger ? "var(--danger)" : color, opacity: isUnlimitedPlan ? .4 : 1, transition: "width .5s ease" }} />
        </div>
        <div style={{ fontSize: 11, color: "var(--text3)", marginTop: 7, fontWeight: 500 }}>
          {isUnlimitedPlan ? "무제한 회원이라 한도 없이 사용할 수 있어요" : `내 등급(${plan==="free"?"무료":plan==="basic"?"베이직":plan==="pro"?"프로":plan}) 하루 ${limit}${unit} · 자정에 다시 채워져요`}
        </div>
      </div>
    );
  };


  return (
    <div>
      <style>{`
        .npg-2col{display:grid;grid-template-columns:400px 1fr;gap:20px;align-items:start;}
        @media(max-width:820px){
          .npg-2col{grid-template-columns:1fr;}
          .npg-2col .card,.npg-2col button,.npg-2col input,.npg-2col textarea{max-width:100%;box-sizing:border-box;}
        }
      `}</style>

      {tabKey === "neighbor" ? (
        <UsageGuide theme={theme} subtitle="서로이웃을 자동으로 신청해 이웃을 늘려요." steps={[{ico:"👤",title:"계정 연결",desc:"작업할 네이버 계정을 연결해요."},{ico:"🎯",title:"대상·개수 설정",desc:"어떤 블로거에게 몇 명 신청할지 정해요."},{ico:"▶️",title:"시작",desc:"시작을 누르면 천천히 서로이웃을 신청해요."}]} />
      ) : tabKey === "engage" ? (
        <UsageGuide theme={theme} subtitle="다른 블로그에 공감·댓글을 자동으로 남겨요." steps={[{ico:"👤",title:"계정 연결",desc:"작업할 네이버 계정을 연결해요."},{ico:"🎯",title:"키워드·개수",desc:"어떤 글에 몇 개 남길지 정해요."},{ico:"▶️",title:"시작",desc:"시작을 누르면 안전하게 공감·댓글을 남겨요."}]} />
      ) : tabKey === "reply" ? (
        <UsageGuide theme={theme} subtitle="내 글에 달린 댓글에 답글을 자동으로 달아요." steps={[{ico:"👤",title:"계정 연결",desc:"내 블로그 계정을 연결해요."},{ico:"📥",title:"내 글 불러오기",desc:"답글 달 내 글 목록을 불러와요."},{ico:"▶️",title:"시작",desc:"시작을 누르면 미답변 댓글에 답글을 달아요."}]} />
      ) : tabKey === "pumasi" ? (
        <UsageGuide theme={theme} subtitle="내 여러 계정끼리 서로 공감·댓글을 주고받아요." steps={[{ico:"👥",title:"내 계정 등록",desc:"품앗이할 내 계정들을 등록해요."},{ico:"📄",title:"대상 확인",desc:"서로 방문할 글을 확인해요."},{ico:"▶️",title:"시작",desc:"시작을 누르면 계정을 바꿔가며 서로 공감·댓글해요."}]} />
      ) : (
        <UsageGuide theme={theme} subtitle="내 블로그 건강(지수)을 검사하고 고쳐가요." steps={[{ico:"👤",title:"계정 연결",desc:"검사할 블로그 계정을 연결해요."},{ico:"🩺",title:"검사 시작",desc:"검색 노출·저품질·방문자 등을 검사해요."},{ico:"📈",title:"진단·회진",desc:"결과와 오늘의 회진으로 부족한 점을 고쳐가요."}]} />
      )}

      {/* 봇 오프라인 배너 */}
      {!botOnline && (
        <div style={{ marginBottom: 16, padding: "14px 18px", borderRadius: 14, background: "rgba(255,83,99,.08)", border: "1.5px solid rgba(255,83,99,.3)", color: "var(--danger)", fontSize: 13, fontWeight: 600, display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ fontSize: 18 }}>⚠️</span>
          <span>봇 서버가 오프라인입니다. <code style={{ background: "var(--card2)", padding: "2px 7px", borderRadius: 5, fontSize: 12 }}>neighbor-bot</code> 폴더에서 <code style={{ background: "var(--card2)", padding: "2px 7px", borderRadius: 5, fontSize: 12 }}>npm start</code> 를 실행해주세요.</span>
        </div>
      )}

      {/* 탭 + 사용방법 버튼 */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 18 }}>
        {!singleTab && ([{ key: "neighbor", label: "🤝 서이추" }, { key: "engage", label: "❤️ 공감·댓글" }] as const).map(({ key, label }) => (
          <button key={key} onClick={() => setTab(key)} style={{ padding: "11px 26px", borderRadius: 12, border: `2px solid ${tab === key ? "var(--accent)" : "var(--border)"}`, background: tab === key ? "var(--accent-bg)" : "transparent", color: tab === key ? "var(--accent-text)" : "var(--text2)", cursor: "pointer", fontSize: 14, fontWeight: 800, fontFamily: "inherit", transition: "all .2s" }}>
            {label}
          </button>
        ))}
        <button onClick={() => setShowGuide(true)} style={{ marginLeft: singleTab ? 0 : "auto", padding: "11px 20px", borderRadius: 12, border: "1.5px solid var(--border)", background: "var(--card2)", color: "var(--text2)", cursor: "pointer", fontSize: 13, fontWeight: 700, fontFamily: "inherit", display: "flex", alignItems: "center", gap: 6, transition: "all .2s" }}>
          📖 사용방법
        </button>
      </div>

      {/* 사용설명서 모달 */}
      {showGuide && <GuideModal tab={tab} onClose={() => setShowGuide(false)} />}

      {/* 기능 설명 배너 (탭별로 항상 표시) */}
      {tab === "neighbor" ? (
        <div style={{ marginBottom: 18, padding: "16px 20px", borderRadius: 16, background: "var(--card)", border: "1.5px solid var(--border)", boxShadow: "0 2px 12px rgba(0,0,0,.04)" }}>
          <div style={{ fontSize: 15, fontWeight: 800, color: "var(--text)", marginBottom: 6, display: "flex", alignItems: "center", gap: 7 }}>🤝 서이추(서로이웃 신청) 자동화</div>
          <div style={{ fontSize: 12.5, color: "var(--text2)", fontWeight: 600, lineHeight: 1.65 }}>
            키워드로 블로그를 모아 <b>서로이웃 신청</b>을 자동으로 보내요. 새 이웃을 늘려 방문·소통을 키우는 기능이에요.<br />
            <span style={{ color: "#c88010", fontWeight: 700 }}>💡 네이버 하루 한도는 100건.</span> 계정 보호를 위해 <b>하루 50건 정도로 분산</b>하고, 딜레이(5~10초)와 예약 분산을 함께 쓰는 걸 권장해요.
          </div>
        </div>
      ) : tab === "engage" ? (
        <div style={{ marginBottom: 18, padding: "16px 20px", borderRadius: 16, background: "var(--card)", border: "1.5px solid var(--border)", boxShadow: "0 2px 12px rgba(0,0,0,.04)" }}>
          <div style={{ fontSize: 15, fontWeight: 800, color: "var(--text)", marginBottom: 6, display: "flex", alignItems: "center", gap: 7 }}>❤️ 공감·댓글 자동화</div>
          <div style={{ fontSize: 12.5, color: "var(--text2)", fontWeight: 600, lineHeight: 1.65 }}>
            키워드로 찾은 블로그 글에 <b>공감(하트)과 댓글</b>을 자동으로 남겨요. 이웃과 꾸준히 소통해 블로그 지수를 올리는 기능이에요.<br />
            <span style={{ color: "#c88010", fontWeight: 700 }}>💡 권장: 공감은 하루 100개, 댓글은 하루 50개 미만.</span> 강제 제한은 없지만, 계정 보호를 위해 간격을 넉넉히 두고 이 범위 안에서 쓰는 걸 추천해요. (댓글이 공감보다 스팸 판정 위험이 큽니다)
          </div>
        </div>
      ) : tab === "reply" ? (
        <div style={{ marginBottom: 18, padding: "16px 20px", borderRadius: 16, background: "var(--card)", border: "1.5px solid var(--border)", boxShadow: "0 2px 12px rgba(0,0,0,.04)" }}>
          <div style={{ fontSize: 15, fontWeight: 800, color: "var(--text)", marginBottom: 6, display: "flex", alignItems: "center", gap: 7 }}>💬 답방(내 블로그 댓글에 대댓글) 자동화</div>
          <div style={{ fontSize: 12.5, color: "var(--text2)", fontWeight: 600, lineHeight: 1.65 }}>
            내 블로그 글에 <b>이웃들이 남긴 댓글</b>을 찾아, 하나하나 <b>답글(대댓글)</b>을 자동으로 달아줘요. 답방을 부지런히 하면 이웃과의 소통이 살아나고 <b>재방문·체류시간이 늘어 블로그 지수에 도움</b>이 됩니다.<br />
            <span style={{ color: "#c88010", fontWeight: 700 }}>💡 AI 답글을 켜면</span> 댓글 내용을 읽고 <b>매번 다른 자연스러운 답글</b>을 만들어, 똑같은 답글 반복으로 인한 어색함과 스팸 위험을 줄여줘요.
          </div>
        </div>
      ) : (
        <div style={{ marginBottom: 18, padding: "16px 20px", borderRadius: 16, background: "var(--card)", border: "1.5px solid var(--border)", boxShadow: "0 2px 12px rgba(0,0,0,.04)" }}>
          <div style={{ fontSize: 15, fontWeight: 800, color: "var(--text)", marginBottom: 6, display: "flex", alignItems: "center", gap: 7 }}>📈 블로그 건강검진</div>
          <div style={{ fontSize: 12.5, color: "var(--text2)", fontWeight: 600, lineHeight: 1.65 }}>
            내 블로그의 <b>총 글 수·이웃 수·최근 발행 활동</b>을 실제로 읽어와 <b style={{color:"#00c896"}}>건강 상태를 진단</b>하고, 지금 뭘 하면 좋을지 <b style={{color:"#ff5fa2"}}>맞춤 조언</b>을 드려요.<br />
            <span style={{ color: "#c88010", fontWeight: 700 }}>💡 참고:</span> 네이버는 공식 '지수'를 공개하지 않아요. 이 진단은 <b>실제 지표를 바탕으로 한 퍼블리 자체 건강검진</b>으로, 블로그 관리 방향을 잡는 용도예요.
          </div>
        </div>
      )}

      {/* ═══════════ 서이추 탭 ═══════════ */}
      {tab === "neighbor" && (
        <div className="npg-2col">
          {/* 왼쪽 */}
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            {tierTableNode}
            <div style={{ fontSize: 12, color: "var(--text2)", background: "var(--card2)", borderRadius: 10, padding: "10px 13px", lineHeight: 1.5, fontWeight: 600 }}>
              🔒 <b>{tabName}</b> 전용 계정 <b style={{ color: "#00c896" }}>{accounts.length}</b>/{isUnlimitedPlan ? "∞" : accountLimit}개 · 다른 탭과 <b>완전히 분리</b>돼요(한 곳에서 문제가 생겨도 다른 탭엔 영향 없어요).
            </div>
            <AccountAccordion accounts={accounts} open={acctOpen} setOpen={setAcctOpen} tabName={tabName} accountLimit={accountLimit} isUnlimited={isUnlimitedPlan}>
              <AccountCard accounts={accounts} onLogin={handleLogin} onAdd={handleAddAccount} onRemove={handleRemoveAccount} onChange={handleAccountChange} onConnectAll={handleConnectAll} connectingAll={connectingAll} />
              <AccountSelector accounts={accounts} selectedId={selectedAcctId} onSelect={setSelectedAcctId} />
            </AccountAccordion>

            <div className="card" style={{ padding: "18px 20px" }}>
              <div className="card-title" style={{ marginBottom: 14, fontSize: 15 }}>🔍 추출 설정</div>
              <KeywordAnalyzer keywords={buddyKw} loading={buddyKwLoading} onAnalyze={analyzeBuddyKeywords}
                onPick={w => setKeywords(prev => { const list = prev.split(",").map(s => s.trim()).filter(Boolean); if (!list.includes(w)) list.push(w); return list.join(", "); })} />
              <div style={{ marginBottom: 14 }}><VisitorFilter min={visMin} max={visMax} setMin={setVisMin} setMax={setVisMax} /></div>
              <div style={{ marginBottom: 14 }}><SearchEntryToggle on={searchEntry} set={setSearchEntry} /></div>
              <div style={{ marginBottom: 14 }}>
                <label className="inp-label" style={{ fontSize: 12, marginBottom: 6, display: "block" }}>키워드 (쉼표로 구분)</label>
                <input className="inp" placeholder="예: 원주맛집, 강원도여행, 육아일기" value={keywords} onChange={e => setKeywords(e.target.value)} style={{ fontSize: 13, padding: "11px 14px" }} />
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 10 }}>
                <div>
                  <label className="inp-label" style={{ fontSize: 12, marginBottom: 6, display: "block" }}>키워드당 추출 수</label>
                  <input className="inp" {...numProps(countPerKw, setCountPerKw, 1, 300, 34)} style={{ fontSize: 13, padding: "11px 14px" }} />
                  <div style={{ fontSize: 12, color: "var(--text2)", marginTop: 6, lineHeight: 1.55, fontWeight: 500 }}>
                    💡 키워드 하나당 서이추 신청할 블로거를 <b style={{color:"#00c896"}}>몇 명 불러올지</b> 정해요. (숫자가 클수록 더 많은 대상을 모읍니다)
                  </div>
                </div>
                <div>
                  <label className="inp-label" style={{ fontSize: 12, marginBottom: 6, display: "block" }}>하루 신청 한도</label>
                  <input className="inp" {...numProps(dailyLimit, setDailyLimit, 1, 100, 100)} style={{ fontSize: 13, padding: "11px 14px" }} />
                  <div style={{ fontSize: 12, color: "var(--text2)", marginTop: 6, lineHeight: 1.55, fontWeight: 500 }}>
                    💡 오늘 실제로 서로이웃 신청을 보낼 <b style={{color:"#ff5fa2"}}>최대 건수</b>예요. <b style={{color:"#00c896"}}>계정 안전</b>을 위해 이 수까지만 신청하고 멈춥니다.
                  </div>
                </div>
              </div>

              {/* ── 체험단 모집 최적화 ── */}
              <div style={{ marginBottom: 12, padding: "14px", borderRadius: 12, background: "var(--accent-bg)", border: "1px solid var(--accent)" }}>
                <div style={{ fontSize: 12.5, fontWeight: 800, color: "var(--accent-text)", marginBottom: 12, display: "flex", alignItems: "center", gap: 6 }}>
                  🎯 체험단 모집 최적화
                </div>
                <label className="inp-label" style={{ fontSize: 11.5, marginBottom: 6, display: "block", color: "var(--text3)", fontWeight: 600 }}>수집 정렬</label>
                <div style={{ display: "flex", gap: 6, marginBottom: 14 }}>
                  {([["recentdate", "최신 활동순"], ["sim", "정확도순"]] as const).map(([v, l]) => (
                    <button key={v} onClick={() => setOrderBy(v)} style={{ flex: 1, padding: "10px", borderRadius: 9, border: `2px solid ${orderBy === v ? "var(--accent)" : "var(--border)"}`, background: orderBy === v ? "var(--card)" : "transparent", color: orderBy === v ? "var(--accent-text)" : "var(--text2)", cursor: "pointer", fontSize: 12.5, fontWeight: 700, fontFamily: "inherit", transition: "all .15s" }}
                      onMouseEnter={e => (e.currentTarget.style.transform = "translateY(-1px)")} onMouseLeave={e => (e.currentTarget.style.transform = "")}>{l}</button>
                  ))}
                </div>
                <label className="inp-label" style={{ fontSize: 11.5, marginBottom: 6, display: "block", color: "var(--text3)", fontWeight: 600 }}>최근 글 쓴 블로거만 <span style={{ color: "var(--text3)", fontWeight: 400 }}>(죽은 블로그 제외)</span></label>
                <div style={{ display: "flex", gap: 6, marginBottom: 14 }}>
                  {([[0, "전체"], [7, "7일"], [30, "30일"], [90, "90일"]] as const).map(([v, l]) => (
                    <button key={v} onClick={() => setActiveDays(v)} style={{ flex: 1, padding: "10px", borderRadius: 9, border: `2px solid ${activeDays === v ? "var(--accent)" : "var(--border)"}`, background: activeDays === v ? "var(--card)" : "transparent", color: activeDays === v ? "var(--accent-text)" : "var(--text2)", cursor: "pointer", fontSize: 12.5, fontWeight: 700, fontFamily: "inherit", transition: "all .15s" }}
                      onMouseEnter={e => (e.currentTarget.style.transform = "translateY(-1px)")} onMouseLeave={e => (e.currentTarget.style.transform = "")}>{l}</button>
                  ))}
                </div>
                <Toggle val={excludeMarket} set={setExcludeMarket} label="판매·마켓 블로거 제외" />
              </div>

              <div style={{ padding: "10px 14px", borderRadius: 10, background: "var(--bg2)", border: "1px solid var(--border)", fontSize: 12, color: "var(--text3)" }}>
                총 수집 예정: <strong style={{ color: "var(--accent-text)" }}>{keywords.split(",").filter(k => k.trim()).length * countPerKw}개</strong>
              </div>
            </div>

            <div className="card" style={{ padding: "18px 20px" }}>
              <div className="card-title" style={{ marginBottom: 14, fontSize: 15 }}>⚙️ 작업 옵션</div>
              <div style={{ marginBottom: 12 }}>
                <label className="inp-label" style={{ fontSize: 12, marginBottom: 6, display: "block" }}>딜레이 (초) — 너무 짧으면 봇 탐지될 수 있어요</label>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <input className="inp" {...numProps(delayMin, setDelayMin, 1, 60, 5)} style={{ flex: 1, fontSize: 13, padding: "11px 14px" }} />
                  <span style={{ color: "var(--text3)", fontSize: 14, fontWeight: 700 }}>~</span>
                  <input className="inp" {...numProps(delayMax, setDelayMax, 1, 120, 10)} style={{ flex: 1, fontSize: 13, padding: "11px 14px" }} />
                  <span style={{ color: "var(--text3)", fontSize: 13 }}>초</span>
                </div>
              </div>
              <Toggle val={skipDone} set={setSkipDone} label="이미 처리된 블로그 건너뛰기" />
              <div style={{ fontSize: 12, color: "var(--text2)", margin: "2px 2px 6px", lineHeight: 1.55, fontWeight: 500 }}>
                💡 오늘 이미 서이추한 블로거는 이 설정과 상관없이 <b style={{color:"#ff5fa2"}}>자동으로 제외</b>돼요. (<b style={{color:"#00c896"}}>같은 날 중복 신청 방지</b>)
              </div>
              <Toggle val={qualityFilter} set={setQualityFilter} label="죽은·광고 블로그 자동 거르기 (헛신청 방지)" />
              {skipDone && (
                <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "6px 2px 2px", flexWrap: "wrap" }}>
                  <span style={{ fontSize: 13, color: "var(--text2)", fontWeight: 600 }}>거절·무응답은</span>
                  <input className="inp" {...numProps(retryDays, setRetryDays, 0, 365, 30)} style={{ width: 74, fontSize: 13, padding: "9px 12px", textAlign: "center" }} />
                  <span style={{ fontSize: 13, color: "var(--text2)", fontWeight: 600 }}>일 뒤 다시 신청</span>
                  <span style={{ fontSize: 11.5, color: "var(--text3)" }}>{retryDays === 0 ? "(0=영구 제외)" : "(성공한 곳은 계속 제외)"}</span>
                </div>
              )}
              <Toggle val={autoStart} set={setAutoStart} label="추출 완료 후 바로 신청 시작" />
            </div>

            <div className="card" style={{ padding: "18px 20px" }}>
              <div className="card-title" style={{ marginBottom: 14, fontSize: 15, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
                <span>💬 서이추 멘트</span>
                <button onClick={restoreDefaultMsg} title="수정한 멘트를 처음 기본 멘트로 되돌립니다"
                  style={{ padding: "6px 12px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--card2)", color: "var(--text2)", cursor: "pointer", fontSize: 11.5, fontWeight: 700, fontFamily: "inherit", display: "flex", alignItems: "center", gap: 4, transition: "all .15s" }}
                  onMouseEnter={e => (e.currentTarget.style.borderColor = "var(--accent)")}
                  onMouseLeave={e => (e.currentTarget.style.borderColor = "var(--border)")}
                  onMouseDown={e => (e.currentTarget.style.transform = "scale(.96)")}
                  onMouseUp={e => (e.currentTarget.style.transform = "")}>↩︎ 기본값 복원</button>
              </div>
              <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
                {(["single", "multi"] as const).map(m => (
                  <button key={m} onClick={() => setMsgMode(m)} style={{ flex: 1, padding: "10px", borderRadius: 10, border: `2px solid ${msgMode === m ? "var(--accent)" : "var(--border)"}`, background: msgMode === m ? "var(--accent-bg)" : "transparent", color: msgMode === m ? "var(--accent-text)" : "var(--text2)", cursor: "pointer", fontSize: 12, fontWeight: 700, fontFamily: "inherit" }}>
                    {m === "single" ? "단일 멘트" : "여러 멘트 순환"}
                  </button>
                ))}
              </div>
              {/* 체험단 멘트 채우기 — 색상 강조 박스. 단일=1개 넣기/다른문구, 여러=개수선택+섞기 */}
              <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 10, flexWrap: "wrap", padding: "10px 12px", borderRadius: 12, background: "var(--accent-bg)", border: "1px solid var(--accent-border)" }}>
                <span style={{ fontSize: 12, color: "var(--accent-text)", fontWeight: 800, marginRight: 2, display: "flex", alignItems: "center", gap: 4 }}>🎁 체험단 멘트</span>
                {msgMode === "single" ? (
                  <>
                    <button onClick={() => applyCampaignPreset()} title="체험단 홍보 멘트를 넣습니다"
                      style={{ padding: "6px 14px", borderRadius: 8, border: "none", background: "var(--accent)", color: "#000", cursor: "pointer", fontSize: 11.5, fontWeight: 800, fontFamily: "inherit", transition: "all .15s" }}
                      onMouseDown={e => (e.currentTarget.style.transform = "scale(.94)")} onMouseUp={e => (e.currentTarget.style.transform = "")} onMouseLeave={e => (e.currentTarget.style.transform = "")}>넣기</button>
                    <button onClick={() => applyCampaignPreset()} title="다른 문구로 바꾸기"
                      style={{ padding: "6px 12px", borderRadius: 8, border: "1px solid var(--accent)", background: "transparent", color: "var(--accent-text)", cursor: "pointer", fontSize: 11.5, fontWeight: 700, fontFamily: "inherit" }}>🔀 다른 문구</button>
                  </>
                ) : (
                  <>
                    {[3, 5, 8].map(n => (
                      <button key={n} onClick={() => applyCampaignPreset(n)} title={`체험단 멘트 ${n}개를 무작위로 골라 채웁니다`}
                        style={{ padding: "6px 13px", borderRadius: 8, border: "none", background: "var(--accent)", color: "#000", cursor: "pointer", fontSize: 11.5, fontWeight: 800, fontFamily: "inherit", transition: "all .15s" }}
                        onMouseDown={e => (e.currentTarget.style.transform = "scale(.94)")} onMouseUp={e => (e.currentTarget.style.transform = "")} onMouseLeave={e => (e.currentTarget.style.transform = "")}>{n}개</button>
                    ))}
                    <button onClick={() => applyCampaignPreset(5)} title="다른 조합으로 다시 섞기"
                      style={{ padding: "6px 12px", borderRadius: 8, border: "1px solid var(--accent)", background: "transparent", color: "var(--accent-text)", cursor: "pointer", fontSize: 11.5, fontWeight: 700, fontFamily: "inherit" }}>🔀 섞기</button>
                  </>
                )}
              </div>
              {msgMode === "single" ? (
                <textarea className="inp" rows={3} value={singleMsg} onChange={e => setSingleMsg(e.target.value)} style={{ resize: "vertical", fontSize: 13, lineHeight: 1.7, padding: "12px 14px" }} />
              ) : (
                <>
                  <textarea className="inp" rows={6} value={multiMsgs} onChange={e => setMultiMsgs(e.target.value)} style={{ resize: "vertical", fontSize: 13, lineHeight: 1.7, padding: "12px 14px" }} placeholder="줄바꿈으로 구분 → 순서대로 사용됩니다" />
                  <div style={{ fontSize: 11, color: "var(--text3)", marginTop: 6 }}>총 {multiMsgs.split("\n").filter(l => l.trim()).length}개 멘트 등록됨 · 전체 체험단 멘트 {CAMPAIGN_PRESETS.length}종</div>
                </>
              )}
            </div>

            {/* 예약·분산 실행 (기존 '한번에'와 별개) */}
            <div className="card" style={{ padding: "16px 18px" }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: spreadMode ? 12 : 0 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ fontSize: 15 }}>📅</span>
                  <span style={{ fontSize: 14, fontWeight: 800, color: "var(--text)" }}>예약 분산 실행</span>
                  <span style={{ fontSize: 11, color: "var(--text3)" }}>사람처럼 나눠서</span>
                </div>
                <Toggle val={spreadMode} set={setSpreadMode} label="" />
              </div>
              {spreadMode && (
                <>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", fontSize: 13, color: "var(--text2)", fontWeight: 600 }}>
                    <input className="inp" {...numProps(spreadBatches, setSpreadBatches, 2, 10, 3)} style={{ width: 60, fontSize: 13, padding: "9px 10px", textAlign: "center" }} />
                    <span>회로 나눠서</span>
                    <input className="inp" {...numProps(spreadGapMin, setSpreadGapMin, 1, 720, 90)} style={{ width: 72, fontSize: 13, padding: "9px 10px", textAlign: "center" }} />
                    <span>분 간격으로</span>
                  </div>
                  {spreadRunning && (
                    <div style={{ marginTop: 12, padding: "10px 14px", borderRadius: 12, background: "var(--accent-bg)", border: "1px solid var(--accent)", fontSize: 12.5, color: "var(--accent-text)", fontWeight: 700 }}>
                      진행 {spreadInfo.cur}/{spreadInfo.total}회차
                      {spreadInfo.nextAt && <span> · 다음 {new Date(spreadInfo.nextAt).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" })} 예정</span>}
                      <div style={{ fontSize: 11, fontWeight: 500, color: "var(--text3)", marginTop: 3 }}>앱을 켜둔 채로 기다려 주세요.</div>
                    </div>
                  )}
                </>
              )}
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <button className="btn btn-primary btn-full" onClick={handleCrawl} disabled={crawling || working || spreadRunning || !botOnline} style={{ padding: "14px", fontSize: 14, borderRadius: 12 }}>
                {crawling ? <><span className="spinner" />블로그 추출 중...</> : "🔍 블로그 추출 시작"}
              </button>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                <button className="btn btn-secondary" onClick={() => spreadMode ? startSpread() : startWork()} disabled={crawling || working || spreadRunning || !targets.length || !botOnline} style={{ padding: "13px", fontSize: 13, borderRadius: 12 }}>
                  {working || spreadRunning ? <><span className="spinner" />작업 중...</> : spreadMode ? "📅 분산 실행 시작" : "🚀 서이추 시작"}
                </button>
                <button className="btn btn-secondary" onClick={() => handleLoadList(false)} disabled={crawling || working || spreadRunning} style={{ padding: "13px", fontSize: 13, borderRadius: 12 }}>
                  📂 리스트 불러오기
                </button>
              </div>
              {(crawling || working) && !spreadRunning && (
                <button className="btn-stop" onClick={handleStop} style={{ width: "100%", justifyContent: "center", padding: "13px", borderRadius: 12, fontSize: 13 }}>⛔ 작업 중단</button>
              )}
              {spreadRunning && (
                <button className="btn-stop" onClick={stopSpread} style={{ width: "100%", justifyContent: "center", padding: "13px", borderRadius: 12, fontSize: 13 }}>⛔ 분산 실행 중단</button>
              )}
            </div>
          </div>

          {/* 오른쪽 */}
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            {/* 오늘 서이추 사용량 — 본인 플랜 한도 기준. 무제한은 네이버 권장(100) 안내 */}
            {userId && (() => {
              const NAVER_REC = 100;                          // 네이버 권장 상한(강제 아님)
              const unlimited = plan === "unlimited" || plan === "admin";  // 무제한: 플랜 한도 없음
              const limit = quotaLimit;                       // 본인 플랜 한도(무료10/베이직50/프로100)
              const pct = unlimited ? Math.min(100, (quotaUsed / NAVER_REC) * 100) : Math.min(100, (quotaUsed / limit) * 100);
              const danger = !unlimited && quotaUsed >= limit;             // 본인 한도 도달(무제한 제외)
              const warn = unlimited ? quotaUsed >= NAVER_REC : quotaUsed >= limit * 0.8;
              const bar = danger ? "#ff5363" : warn ? "#ffb020" : "#00d68f";
              return (
                <div style={{ padding: "20px 24px", borderRadius: 20, background: "var(--card)", border: `1.5px solid ${danger ? "rgba(255,83,99,.45)" : warn ? "rgba(255,176,32,.4)" : "var(--border)"}`, boxShadow: "0 2px 14px rgba(0,0,0,.04)" }}>
                  <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", marginBottom: 14 }}>
                    <div>
                      <div style={{ fontSize: 13, color: "var(--text3)", fontWeight: 700, marginBottom: 6, display: "flex", alignItems: "center", gap: 6 }}>
                        🛡️ 오늘 서이추 사용량 <span style={{ fontSize: 11, fontWeight: 600, color: "var(--text3)", opacity: .8 }}>(자정 자동 리셋)</span>
                      </div>
                      <div style={{ fontSize: 40, fontWeight: 900, color: bar, fontFamily: "'Space Grotesk',sans-serif", lineHeight: 1 }}>
                        {quotaUsed}<span style={{ fontSize: 20, color: "var(--text3)", fontWeight: 600 }}> {unlimited ? "건 · 무제한" : `/ ${limit}건`}</span>
                      </div>
                    </div>
                    <div style={{ textAlign: "right" }}>
                      <div style={{ fontSize: 26, fontWeight: 900, color: bar, fontFamily: "'Space Grotesk',sans-serif", lineHeight: 1 }}>{unlimited ? "∞" : danger ? "마감" : `${limit - quotaUsed}건`}</div>
                      <div style={{ fontSize: 12, color: "var(--text3)", fontWeight: 600, marginTop: 4 }}>{unlimited ? "한도 없음" : danger ? "자정까지 대기" : "남음"}</div>
                    </div>
                  </div>
                  <div style={{ position: "relative", height: 12, borderRadius: 99, background: "var(--border)", overflow: "hidden" }}>
                    <div style={{ height: "100%", borderRadius: 99, width: `${pct}%`, background: `linear-gradient(90deg, ${bar}, ${bar}cc)`, transition: "width .5s ease" }} />
                  </div>
                  {danger
                    ? <div style={{ fontSize: 12.5, color: "var(--danger)", fontWeight: 700, marginTop: 10 }}>오늘 플랜 한도에 도달했어요. 계정 보호를 위해 자정 이후 다시 돌려주세요.</div>
                    : <div style={{ fontSize: 12.5, color: warn ? "#c88010" : "var(--text3)", fontWeight: 600, marginTop: 10 }}>💡 네이버 권장은 <b>하루 100건 미만</b>이에요. 간격을 넉넉히 두고 나눠서 진행하는 걸 추천해요.</div>}
                </div>
              );
            })()}

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
              {[{ label: "수집된 블로그", val: targets.length, color: "var(--info)" }, { label: "신청 완료", val: doneCnt, color: "var(--success)" }, { label: "실패", val: failCnt, color: "var(--danger)" }].map(({ label, val, color }) => (
                <div key={label} style={{ padding: "24px 18px", borderRadius: 18, background: "var(--card)", border: "1px solid var(--border)", textAlign: "center", boxShadow: "0 2px 10px rgba(0,0,0,.03)" }}>
                  <div style={{ fontSize: 40, fontWeight: 900, color, fontFamily: "'Space Grotesk',sans-serif", lineHeight: 1 }}>{val}</div>
                  <div style={{ fontSize: 12.5, color: "var(--text3)", marginTop: 8, fontWeight: 600 }}>{label}</div>
                </div>
              ))}
            </div>

            <div className="card" style={{ padding: 0, overflow: "hidden" }}>
              <div style={{ padding: "14px 18px", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <div className="card-title" style={{ margin: 0 }}>📋 작업 현황 {results.length > 0 && <span style={{ fontSize: 12, fontWeight: 500, color: "var(--text3)" }}>({results.length}개)</span>}</div>
                {results.length > 0 && <button onClick={handleSaveHistory} style={{ padding: "6px 14px", borderRadius: 9, border: "1px solid var(--border)", background: "var(--card2)", color: "var(--text2)", cursor: "pointer", fontSize: 12, fontWeight: 700, fontFamily: "inherit" }}>💾 저장</button>}
              </div>
              {results.length === 0 ? (
                <div style={{ padding: "72px 20px", textAlign: "center", color: "var(--text3)" }}>
                  <div style={{ fontSize: 44, marginBottom: 12, opacity: .5 }}>📋</div>
                  <div style={{ fontSize: 15, fontWeight: 600, color: "var(--text2)" }}>아직 작업 내역이 없어요</div>
                  <div style={{ fontSize: 13, marginTop: 6 }}>블로그를 추출하고 서이추를 시작하면 여기에 실시간으로 표시됩니다</div>
                </div>
              ) : (
                <div style={{ overflowX: "auto", maxHeight: 520, overflowY: "auto" }}>
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                    <thead><tr style={{ background: "var(--bg2)", position: "sticky", top: 0 }}>
                      {["키워드", "블로거", "결과"].map(h => <th key={h} style={{ padding: "10px 14px", textAlign: "left", fontWeight: 700, color: "var(--text3)", borderBottom: "1px solid var(--border)", whiteSpace: "nowrap" }}>{h}</th>)}
                    </tr></thead>
                    <tbody>{results.map((r, i) => (
                      <tr key={i} style={{ borderBottom: "1px solid var(--border)" }} onMouseEnter={e => (e.currentTarget.style.background = "var(--card-hover)")} onMouseLeave={e => (e.currentTarget.style.background = "")}>
                        <td style={{ padding: "10px 14px", color: "var(--accent-text)", fontWeight: 700 }}>{r.keyword}</td>
                        <td style={{ padding: "10px 14px" }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
                            {r.thumbnail && <img src={r.thumbnail} alt="" style={{ width: 34, height: 34, borderRadius: 8, objectFit: "cover", flexShrink: 0, border: "1px solid var(--border)" }} onError={e => (e.currentTarget.style.display = "none")} />}
                            <div style={{ minWidth: 0 }}>
                              <div style={{ fontWeight: 700, color: "var(--text)", fontSize: 12.5, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: 170 }}>{r.nickName || r.blogName || r.blogId}</div>
                              <a href={r.postUrl || `https://blog.naver.com/${r.blogId}`} target="_blank" rel="noreferrer" style={{ color: "var(--info)", textDecoration: "none", fontSize: 11 }}>
                                {r.blogId}{r.addDate ? <span style={{ color: "var(--text3)" }}> · {relTime(r.addDate)}</span> : null}
                              </a>
                            </div>
                          </div>
                        </td>
                        <td style={{ padding: "10px 14px" }}>
                          <span style={{ fontSize: 12, padding: "4px 10px", borderRadius: 99, background: `${statusColor(r.status)}18`, color: statusColor(r.status), border: `1px solid ${statusColor(r.status)}40`, fontWeight: 700 }}>{statusLabel(r.status)}</span>
                          {(r.status === "fail" || r.status === "skip") && r.message && <span style={{ fontSize: 11, color: "var(--text3)", marginLeft: 8 }}>{r.message}</span>}
                        </td>
                      </tr>
                    ))}</tbody>
                  </table>
                </div>
              )}
            </div>
            <LogBox logs={logs} logRef={logRef} onClear={() => setLogs([])} />
          </div>
        </div>
      )}

      {/* ═══════════ 공감·댓글 탭 ═══════════ */}
      {tab === "engage" && (
        <div className="npg-2col">
          {/* 왼쪽 */}
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            {tierTableNode}
            <div style={{ fontSize: 12, color: "var(--text2)", background: "var(--card2)", borderRadius: 10, padding: "10px 13px", lineHeight: 1.5, fontWeight: 600 }}>
              🔒 <b>{tabName}</b> 전용 계정 <b style={{ color: "#00c896" }}>{accounts.length}</b>/{isUnlimitedPlan ? "∞" : accountLimit}개 · 다른 탭과 <b>완전히 분리</b>돼요(한 곳에서 문제가 생겨도 다른 탭엔 영향 없어요).
            </div>
            <AccountAccordion accounts={accounts} open={acctOpen} setOpen={setAcctOpen} tabName={tabName} accountLimit={accountLimit} isUnlimited={isUnlimitedPlan}>
              <AccountCard accounts={accounts} onLogin={handleLogin} onAdd={handleAddAccount} onRemove={handleRemoveAccount} onChange={handleAccountChange} onConnectAll={handleConnectAll} connectingAll={connectingAll} />
              <AccountSelector accounts={accounts} selectedId={selectedAcctId} onSelect={setSelectedAcctId} />
            </AccountAccordion>

            <div className="card" style={{ padding: "18px 20px" }}>
              <div className="card-title" style={{ marginBottom: 14, fontSize: 15 }}>🔍 추출 설정</div>
              {/* 수집 소스 선택: 키워드 검색 vs 내 이웃새글 */}
              <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
                <button onClick={() => setESource("keyword")}
                  style={{ flex: 1, padding: "10px", borderRadius: 10, border: `1.5px solid ${eSource === "keyword" ? "var(--accent)" : "var(--border)"}`, background: eSource === "keyword" ? "var(--accent-bg)" : "transparent", color: eSource === "keyword" ? "var(--accent-text)" : "var(--text2)", cursor: "pointer", fontSize: 12.5, fontWeight: 700, fontFamily: "inherit" }}>
                  🔍 키워드로 찾기
                </button>
                <button onClick={() => setESource("buddy")}
                  style={{ flex: 1, padding: "10px", borderRadius: 10, border: `1.5px solid ${eSource === "buddy" ? "var(--accent)" : "var(--border)"}`, background: eSource === "buddy" ? "var(--accent-bg)" : "transparent", color: eSource === "buddy" ? "var(--accent-text)" : "var(--text2)", cursor: "pointer", fontSize: 12.5, fontWeight: 700, fontFamily: "inherit" }}>
                  👥 내 이웃새글
                </button>
              </div>
              {eSource === "keyword" ? (
                <>
                  <KeywordAnalyzer keywords={buddyKw} loading={buddyKwLoading} onAnalyze={analyzeBuddyKeywords}
                    onPick={w => setEKeywords(prev => { const list = prev.split(",").map(s => s.trim()).filter(Boolean); if (!list.includes(w)) list.push(w); return list.join(", "); })} />
                  <div style={{ marginBottom: 14 }}><VisitorFilter min={visMin} max={visMax} setMin={setVisMin} setMax={setVisMax} /></div>
              <div style={{ marginBottom: 14 }}><SearchEntryToggle on={searchEntry} set={setSearchEntry} /></div>
                  <div style={{ marginBottom: 14 }}>
                    <label className="inp-label" style={{ fontSize: 12, marginBottom: 6, display: "block" }}>키워드 (쉼표로 구분)</label>
                    <input className="inp" placeholder="예: 맛집, 육아, 인테리어" value={eKeywords} onChange={e => setEKeywords(e.target.value)} style={{ fontSize: 13, padding: "11px 14px" }} />
                  </div>
                </>
              ) : (
                <div style={{ marginBottom: 14, padding: "12px 14px", borderRadius: 10, background: "var(--accent-bg)", border: "1px solid var(--border)", fontSize: 12.5, color: "var(--text2)", lineHeight: 1.6 }}>
                  👥 연결된 계정의 <b>내 서로이웃들 최근 글</b>을 자동으로 불러와 공감·댓글을 남깁니다. 키워드 없이 아래 <b>추출 시작</b>만 누르세요.
                </div>
              )}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <div>
                  <label className="inp-label" style={{ fontSize: 12, marginBottom: 6, display: "block" }}>{eSource === "buddy" ? "가져올 이웃 수 (최대)" : "키워드당 추출 수"}</label>
                  <input className="inp" {...numProps(eCountPerKw, setECountPerKw, 1, 200, 20)} style={{ fontSize: 13, padding: "11px 14px" }} />
                  <div style={{ fontSize: 12, color: "var(--text2)", marginTop: 6, lineHeight: 1.55, fontWeight: 500 }}>
                    {eSource === "buddy"
                      ? "💡 내 서로이웃 중 최근 글을 쓴 사람을 최대 몇 명 불러올지 정해요. (숫자가 클수록 더 많은 이웃 글을 가져옵니다)"
                      : "💡 키워드 하나당 블로그 글을 몇 개 불러올지 정해요."}
                  </div>
                </div>
                <div>
                  <label className="inp-label" style={{ fontSize: 12, marginBottom: 6, display: "block" }}>하루 작업 한도</label>
                  <input className="inp" {...numProps(eDailyLimit, setEDailyLimit, 1, 200, 50)} style={{ fontSize: 13, padding: "11px 14px" }} />
                  <div style={{ fontSize: 12, color: "var(--text2)", marginTop: 6, lineHeight: 1.55, fontWeight: 500 }}>
                    💡 오늘 실제로 공감·댓글을 남길 <b style={{color:"#ff5fa2"}}>최대 건수</b>예요. <b style={{color:"#00c896"}}>계정 안전</b>을 위해 이 수까지만 작업하고 멈춥니다.
                  </div>
                </div>
              </div>
            </div>

            <div className="card" style={{ padding: "18px 20px" }}>
              <div className="card-title" style={{ marginBottom: 14, fontSize: 15 }}>📅 대상 글 기간</div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 12 }}>
                {([7, 14, 30, "custom"] as const).map(p => (
                  <button key={p} onClick={() => setEPeriod(p)} style={{ padding: "11px", borderRadius: 10, border: `2px solid ${ePeriod === p ? "var(--accent)" : "var(--border)"}`, background: ePeriod === p ? "var(--accent-bg)" : "transparent", color: ePeriod === p ? "var(--accent-text)" : "var(--text2)", cursor: "pointer", fontSize: 13, fontWeight: 700, fontFamily: "inherit" }}>
                    {p === "custom" ? "직접 입력" : `최근 ${p}일`}
                  </button>
                ))}
              </div>
              {ePeriod === "custom" && (
                <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
                  <input className="inp" {...numProps(eCustomDays, setECustomDays, 1, 365, 7)} style={{ flex: 1, fontSize: 13, padding: "11px 14px" }} />
                  <span style={{ fontSize: 13, color: "var(--text3)" }}>일 이내 글</span>
                </div>
              )}
              <div>
                <label className="inp-label" style={{ fontSize: 12, marginBottom: 6, display: "block" }}>블로그당 작업할 글 수 (최대 5개)</label>
                <input className="inp" {...numProps(ePostsPerBlog, setEPostsPerBlog, 1, 5, 1)} style={{ fontSize: 13, padding: "11px 14px" }} />
              </div>
            </div>

            <div className="card" style={{ padding: "18px 20px" }}>
              <div className="card-title" style={{ marginBottom: 14, fontSize: 15 }}>⚙️ 작업 설정</div>
              <div style={{ padding: "12px 16px", borderRadius: 12, background: "var(--bg2)", border: "1px solid var(--border)", marginBottom: 12 }}>
                <div style={{ fontSize: 12, color: "var(--text3)", marginBottom: 8, fontWeight: 600 }}>작업 종류 선택</div>
                <Toggle val={eDoLike} set={setEDoLike} label="❤️ 공감 클릭하기" />
                {eDoLike && (
                  <div style={{ display: "flex", alignItems: "center", gap: 8, margin: "2px 0 8px 6px" }}>
                    <span style={{ fontSize: 12.5, color: "var(--text2)", fontWeight: 600 }}>글마다 공감 확률</span>
                    <input className="inp" {...numProps(eLikeRate, setELikeRate, 10, 100, 100)} style={{ width: 64, fontSize: 13, padding: "8px 10px", textAlign: "center" }} />
                    <span style={{ fontSize: 12.5, color: "var(--text2)", fontWeight: 600 }}>%</span>
                  </div>
                )}
                <Toggle val={eDoComment} set={setEDoComment} label="💬 댓글 작성하기" />
                {eDoComment && (
                  <div style={{ display: "flex", alignItems: "center", gap: 8, margin: "2px 0 0 6px", flexWrap: "wrap" }}>
                    <span style={{ fontSize: 12.5, color: "var(--text2)", fontWeight: 600 }}>글마다 댓글 확률</span>
                    <input className="inp" {...numProps(eCommentRate, setECommentRate, 10, 100, 40)} style={{ width: 64, fontSize: 13, padding: "8px 10px", textAlign: "center" }} />
                    <span style={{ fontSize: 12.5, color: "var(--text2)", fontWeight: 600 }}>%</span>
                    <span style={{ fontSize: 11, color: "var(--text3)" }}>낮출수록 자연스러움(도배 방지)</span>
                  </div>
                )}
              </div>
              <div style={{ marginBottom: 12 }}>
                <label className="inp-label" style={{ fontSize: 12, marginBottom: 6, display: "block" }}>딜레이 (초)</label>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <input className="inp" {...numProps(eDelayMin, setEDelayMin, 1, 60, 5)} style={{ flex: 1, fontSize: 13, padding: "11px 14px" }} />
                  <span style={{ color: "var(--text3)", fontSize: 14, fontWeight: 700 }}>~</span>
                  <input className="inp" {...numProps(eDelayMax, setEDelayMax, 1, 120, 10)} style={{ flex: 1, fontSize: 13, padding: "11px 14px" }} />
                  <span style={{ color: "var(--text3)", fontSize: 13 }}>초</span>
                </div>
              </div>
              <Toggle val={eSkipDone} set={setESkipDone} label="완료된 블로그 건너뛰기" />
              <div style={{ fontSize: 12, color: "var(--text2)", margin: "2px 2px 6px", lineHeight: 1.55, fontWeight: 500 }}>
                💡 오늘 이미 공감·댓글한 이웃은 이 설정과 상관없이 <b style={{color:"#ff5fa2"}}>자동으로 제외</b>돼요. (<b style={{color:"#00c896"}}>같은 날 중복 방지</b> · 내일은 새 글에 다시 작업)
              </div>
              <Toggle val={eAutoStart} set={setEAutoStart} label="추출 완료 후 바로 작업 시작" />
            </div>

            {eDoComment && (
              <div className="card" style={{ padding: "18px 20px" }}>
                <div className="card-title" style={{ marginBottom: 14, fontSize: 15 }}>💬 댓글 내용</div>
                <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
                  {([["single","단일 댓글"],["multi","여러 댓글 순환"],["ai","✨ AI 자동"]] as const).map(([m,lbl]) => {
                    const on = eCommentMode === m; const isAi = m === "ai";
                    return (
                      <button key={m} onClick={() => setECommentMode(m)} style={{ flex: 1, padding: "10px 8px", borderRadius: 10, border: `2px solid ${on ? (isAi?"#8b5cf6":"var(--accent)") : "var(--border)"}`, background: on ? (isAi?"rgba(139,92,246,.12)":"var(--accent-bg)") : "transparent", color: on ? (isAi?"#8b5cf6":"var(--accent-text)") : (isAi?"#8b5cf6":"var(--text2)"), cursor: "pointer", fontSize: 12, fontWeight: 700, fontFamily: "inherit" }}>
                        {lbl}
                      </button>
                    );
                  })}
                </div>
                {eCommentMode === "single" ? (
                  <textarea className="inp" rows={3} value={eComment} onChange={e => setEComment(e.target.value)} style={{ resize: "vertical", fontSize: 13, lineHeight: 1.7, padding: "12px 14px" }} />
                ) : eCommentMode === "multi" ? (
                  <>
                    <textarea className="inp" rows={5} value={eMultiComments} onChange={e => setEMultiComments(e.target.value)} style={{ resize: "vertical", fontSize: 13, lineHeight: 1.7, padding: "12px 14px" }} placeholder="줄바꿈으로 구분 → 순서대로 사용됩니다" />
                    <div style={{ fontSize: 11, color: "var(--text3)", marginTop: 6 }}>총 {eMultiComments.split("\n").filter(l => l.trim()).length}개 댓글 등록됨</div>
                  </>
                ) : (
                  <div>
                    <div style={{ display:"flex", gap:9, alignItems:"flex-start", padding:"12px 14px", borderRadius:11, background:"rgba(139,92,246,.08)", border:"1px solid rgba(139,92,246,.25)", fontSize:12.5, color:"var(--text2)", lineHeight:1.65 }}>
                      <span style={{fontSize:17,flexShrink:0}}>✨</span>
                      <div><b style={{color:"#8b5cf6"}}>AI가 상대방 글을 읽고</b> 매번 다른 자연스러운 댓글을 자동으로 써줘요. 똑같은 댓글 도배로 인한 <b>스팸 위험을 줄여</b> 계정을 지켜줍니다. 아래에서 <b>말투</b>만 골라주세요.</div>
                    </div>
                    <div style={{ fontSize:12, fontWeight:700, color:"var(--text2)", margin:"13px 0 7px" }}>댓글 말투</div>
                    <div style={{ display:"flex", gap:8 }}>
                      {([["담백","깔끔·담백하게"],["다정","다정·따뜻하게"],["짧게","짧고 간결하게"]] as const).map(([t,desc])=>(
                        <button key={t} onClick={()=>setECommentTone(t)} style={{ flex:1, padding:"11px 8px", borderRadius:10, border:`2px solid ${eCommentTone===t?"#8b5cf6":"var(--border)"}`, background:eCommentTone===t?"rgba(139,92,246,.1)":"transparent", color:eCommentTone===t?"#8b5cf6":"var(--text2)", cursor:"pointer", fontFamily:"inherit", textAlign:"center" }}>
                          <div style={{ fontSize:13.5, fontWeight:800 }}>{t}</div>
                          <div style={{ fontSize:10.5, marginTop:3, opacity:.85 }}>{desc}</div>
                        </button>
                      ))}
                    </div>
                    <div style={{ fontSize:11, color:"var(--text3)", marginTop:11, lineHeight:1.55 }}>⚠️ AI 댓글은 <b>설정 → 글쓰기 AI의 Gemini(무료)</b> API 키가 필요해요. 키가 없으면 위 '단일·여러 댓글'을 사용하세요.</div>
                  </div>
                )}
              </div>
            )}

            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <button className="btn btn-primary btn-full" onClick={handleEngageCrawl} disabled={eCrawling || eWorking || !botOnline} style={{ padding: "14px", fontSize: 14, borderRadius: 12 }}>
                {eCrawling ? <><span className="spinner" />블로그 추출 중...</> : "🔍 블로그 추출 시작"}
              </button>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                <button className="btn btn-secondary" onClick={() => startEngageWork()} disabled={eCrawling || eWorking || !eTargets.length || !botOnline} style={{ padding: "13px", fontSize: 13, borderRadius: 12 }}>
                  {eWorking ? <><span className="spinner" />작업 중...</> : "🚀 작업 시작"}
                </button>
                <button className="btn btn-secondary" onClick={() => handleLoadList(true)} disabled={eCrawling || eWorking} style={{ padding: "13px", fontSize: 13, borderRadius: 12 }}>
                  📂 리스트 불러오기
                </button>
              </div>
              {(eCrawling || eWorking) && (
                <button className="btn-stop" onClick={handleEngageStop} style={{ width: "100%", justifyContent: "center", padding: "13px", borderRadius: 12, fontSize: 13 }}>⛔ 작업 중단</button>
              )}
            </div>
          </div>

          {/* 오른쪽 */}
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            {/* 오늘 공감·댓글 사용량 — 본인 플랜 한도 기준. 무제한은 네이버 권장 안내(공감100·댓글50미만) */}
            {userId && (() => {
              const unlimited = plan === "unlimited" || plan === "admin";
              const limit = eLimit;
              const REC = 100;  // 공감 권장 상한(참고)
              const pct = unlimited ? Math.min(100, (eUsed / REC) * 100) : Math.min(100, (eUsed / limit) * 100);
              const danger = !unlimited && eUsed >= limit;
              const warn = unlimited ? eUsed >= REC : eUsed >= limit * 0.8;
              const bar = danger ? "#ff5363" : warn ? "#ffb020" : "#00d68f";
              return (
                <div style={{ padding: "20px 24px", borderRadius: 20, background: "var(--card)", border: `1.5px solid ${danger ? "rgba(255,83,99,.45)" : warn ? "rgba(255,176,32,.4)" : "var(--border)"}`, boxShadow: "0 2px 14px rgba(0,0,0,.04)" }}>
                  <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", marginBottom: 14 }}>
                    <div>
                      <div style={{ fontSize: 13, color: "var(--text3)", fontWeight: 700, marginBottom: 6, display: "flex", alignItems: "center", gap: 6 }}>
                        ❤️ 오늘 공감·댓글 사용량 <span style={{ fontSize: 11, fontWeight: 600, color: "var(--text3)", opacity: .8 }}>(자정 자동 리셋)</span>
                      </div>
                      <div style={{ fontSize: 40, fontWeight: 900, color: bar, fontFamily: "'Space Grotesk',sans-serif", lineHeight: 1 }}>
                        {eUsed}<span style={{ fontSize: 20, color: "var(--text3)", fontWeight: 600 }}> {unlimited ? "건 · 무제한" : `/ ${limit}건`}</span>
                      </div>
                    </div>
                    <div style={{ textAlign: "right" }}>
                      <div style={{ fontSize: 26, fontWeight: 900, color: bar, fontFamily: "'Space Grotesk',sans-serif", lineHeight: 1 }}>{unlimited ? "∞" : danger ? "마감" : `${limit - eUsed}건`}</div>
                      <div style={{ fontSize: 12, color: "var(--text3)", fontWeight: 600, marginTop: 4 }}>{unlimited ? "한도 없음" : danger ? "자정까지 대기" : "남음"}</div>
                    </div>
                  </div>
                  <div style={{ height: 12, borderRadius: 99, background: "var(--border)", overflow: "hidden" }}>
                    <div style={{ height: "100%", borderRadius: 99, width: `${pct}%`, background: `linear-gradient(90deg, ${bar}, ${bar}cc)`, transition: "width .5s ease" }} />
                  </div>
                  {danger
                    ? <div style={{ fontSize: 12.5, color: "var(--danger)", fontWeight: 700, marginTop: 10 }}>오늘 플랜 한도에 도달했어요. 계정 보호를 위해 자정 이후 다시 돌려주세요.</div>
                    : <div style={{ fontSize: 12.5, color: warn ? "#c88010" : "var(--text3)", fontWeight: 600, marginTop: 10 }}>💡 네이버 권장은 <b>공감 하루 100개, 댓글 50개 미만</b>이에요. 댓글은 더 보수적으로 쓰는 걸 추천해요.</div>}
                </div>
              );
            })()}

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
              {[{ label: "수집된 블로그", val: eTargets.length, color: "var(--info)" }, { label: "작업 완료", val: eDoneCnt, color: "var(--success)" }, { label: "실패", val: eFailCnt, color: "var(--danger)" }].map(({ label, val, color }) => (
                <div key={label} style={{ padding: "24px 18px", borderRadius: 18, background: "var(--card)", border: "1px solid var(--border)", textAlign: "center", boxShadow: "0 2px 10px rgba(0,0,0,.03)" }}>
                  <div style={{ fontSize: 40, fontWeight: 900, color, fontFamily: "'Space Grotesk',sans-serif", lineHeight: 1 }}>{val}</div>
                  <div style={{ fontSize: 12.5, color: "var(--text3)", marginTop: 8, fontWeight: 600 }}>{label}</div>
                </div>
              ))}
            </div>

            <div className="card" style={{ padding: 0, overflow: "hidden" }}>
              <div style={{ padding: "14px 18px", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <div className="card-title" style={{ margin: 0 }}>📋 작업 현황 {eResults.length > 0 && <span style={{ fontSize: 12, fontWeight: 500, color: "var(--text3)" }}>({eResults.length}개)</span>}</div>
                {eResults.length > 0 && <button onClick={handleEngageSaveHistory} style={{ padding: "6px 14px", borderRadius: 9, border: "1px solid var(--border)", background: "var(--card2)", color: "var(--text2)", cursor: "pointer", fontSize: 12, fontWeight: 700, fontFamily: "inherit" }}>💾 저장</button>}
              </div>
              {eResults.length === 0 ? (
                <div style={{ padding: "72px 20px", textAlign: "center", color: "var(--text3)" }}>
                  <div style={{ fontSize: 44, marginBottom: 12, opacity: .5 }}>❤️</div>
                  <div style={{ fontSize: 15, fontWeight: 600, color: "var(--text2)" }}>아직 작업 내역이 없어요</div>
                  <div style={{ fontSize: 13, marginTop: 6 }}>블로그를 추출하고 공감·댓글을 시작하면 여기에 실시간으로 표시됩니다</div>
                </div>
              ) : (
                <div style={{ overflowX: "auto", maxHeight: 520, overflowY: "auto" }}>
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                    <thead><tr style={{ background: "var(--bg2)", position: "sticky", top: 0 }}>
                      {["키워드", "블로그 ID", "공감", "댓글", "결과"].map(h => <th key={h} style={{ padding: "10px 14px", textAlign: "left", fontWeight: 700, color: "var(--text3)", borderBottom: "1px solid var(--border)", whiteSpace: "nowrap" }}>{h}</th>)}
                    </tr></thead>
                    <tbody>{eResults.map((r, i) => (
                      <tr key={i} style={{ borderBottom: "1px solid var(--border)" }} onMouseEnter={e => (e.currentTarget.style.background = "var(--card-hover)")} onMouseLeave={e => (e.currentTarget.style.background = "")}>
                        <td style={{ padding: "10px 14px", color: "var(--accent-text)", fontWeight: 700 }}>{r.keyword}</td>
                        <td style={{ padding: "10px 14px" }}><a href={r.postUrl || `https://blog.naver.com/${r.blogId}`} target="_blank" rel="noreferrer" style={{ color: "var(--info)", textDecoration: "none" }}>{r.blogId}</a></td>
                        <td style={{ padding: "10px 14px", textAlign: "center", fontSize: 16 }}>{r.status === "pending" || r.status === "running" ? <span style={{ color: "var(--text3)" }}>—</span> : r.liked ? "❤️" : <span style={{ color: "var(--text3)" }}>✗</span>}</td>
                        <td style={{ padding: "10px 14px", textAlign: "center", fontSize: 16 }}>{r.status === "pending" || r.status === "running" ? <span style={{ color: "var(--text3)" }}>—</span> : r.commented ? "💬" : <span style={{ color: "var(--text3)" }}>✗</span>}</td>
                        <td style={{ padding: "10px 14px" }}>
                          <span style={{ fontSize: 12, padding: "4px 10px", borderRadius: 99, background: `${eStatusColor(r.status)}18`, color: eStatusColor(r.status), border: `1px solid ${eStatusColor(r.status)}40`, fontWeight: 700 }}>{eStatusLabel(r.status)}</span>
                          {r.status !== "pending" && r.status !== "running" && r.message && <span style={{ fontSize: 11, color: r.status === "success" ? "var(--success)" : "var(--text3)", marginLeft: 8 }}>{r.message}</span>}
                        </td>
                      </tr>
                    ))}</tbody>
                  </table>
                </div>
              )}
            </div>
            <LogBox logs={eLogs} logRef={eLogRef} onClear={() => setELogs([])} />
          </div>
        </div>
      )}

      {/* ═══════════ 답방 탭 ═══════════ */}
      {tab === "reply" && (
        <div className="npg-2col">
          {/* 왼쪽: 설정 */}
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            {tierTableNode}
            <div style={{ fontSize: 12, color: "var(--text2)", background: "var(--card2)", borderRadius: 10, padding: "10px 13px", lineHeight: 1.5, fontWeight: 600 }}>
              🔒 <b>{tabName}</b> 전용 계정 <b style={{ color: "#00c896" }}>{accounts.length}</b>/{isUnlimitedPlan ? "∞" : accountLimit}개 · 다른 탭과 <b>완전히 분리</b>돼요(한 곳에서 문제가 생겨도 다른 탭엔 영향 없어요).
            </div>
            <AccountAccordion accounts={accounts} open={acctOpen} setOpen={setAcctOpen} tabName={tabName} accountLimit={accountLimit} isUnlimited={isUnlimitedPlan}>
              <AccountCard accounts={accounts} onLogin={handleLogin} onAdd={handleAddAccount} onRemove={handleRemoveAccount} onChange={handleAccountChange} onConnectAll={handleConnectAll} connectingAll={connectingAll} />
              <AccountSelector accounts={accounts} selectedId={selectedAcctId} onSelect={setSelectedAcctId} />
            </AccountAccordion>

            <div className="card" style={{ padding: "18px 20px" }}>
              <div className="card-title" style={{ marginBottom: 14, fontSize: 15 }}>💬 답방 설정</div>

              <div style={{ marginBottom: 14 }}>
                <label className="inp-label" style={{ fontSize: 12, marginBottom: 6, display: "block" }}>답방할 내 글 선택</label>
                <div style={{ display: "flex", gap: 6, marginBottom: 10 }}>
                  {([["count","최근 개수"],["all","전체"],["period","기간"]] as const).map(([m,lbl]) => (
                    <button key={m} onClick={() => setRSelectMode(m)} style={{ flex: 1, padding: "9px 6px", borderRadius: 9, border: `2px solid ${rSelectMode===m?"var(--accent)":"var(--border)"}`, background: rSelectMode===m?"var(--accent-bg)":"transparent", color: rSelectMode===m?"var(--accent-text)":"var(--text2)", cursor: "pointer", fontSize: 12, fontWeight: 700, fontFamily: "inherit" }}>{lbl}</button>
                  ))}
                </div>
                {rSelectMode === "count" && (
                  <input className="inp" {...numProps(rTargetPosts, setRTargetPosts, 1, 100, 10)} style={{ fontSize: 13, padding: "11px 14px" }} placeholder="최근 몇 개" />
                )}
                {rSelectMode === "period" && (
                  <>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
                      {([7,14,30,"custom"] as const).map(p => (
                        <button key={p} onClick={() => setRPeriod(p)} style={{ padding: "10px", borderRadius: 9, border: `2px solid ${rPeriod===p?"var(--accent)":"var(--border)"}`, background: rPeriod===p?"var(--accent-bg)":"transparent", color: rPeriod===p?"var(--accent-text)":"var(--text2)", cursor: "pointer", fontSize: 12.5, fontWeight: 700, fontFamily: "inherit" }}>{p==="custom"?"직접 설정":`최근 ${p}일`}</button>
                      ))}
                    </div>
                    {rPeriod === "custom" && (
                      <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 8 }}>
                        <input className="inp" {...numProps(rCustomDays, setRCustomDays, 1, 365, 7)} style={{ flex: 1, fontSize: 13, padding: "11px 14px" }} />
                        <span style={{ fontSize: 13, color: "var(--text3)" }}>일 이내 글</span>
                      </div>
                    )}
                  </>
                )}
                {rSelectMode === "all" && (
                  <div style={{ fontSize: 12.5, color: "var(--text2)", padding: "9px 12px", borderRadius: 9, background: "var(--bg)", border: "1px solid var(--border)" }}>내 블로그의 <b style={{color:"#ff5fa2"}}>모든 글</b>을 대상으로 불러와요.</div>
                )}
                <div style={{ fontSize: 12, color: "var(--text2)", marginTop: 8, lineHeight: 1.55, fontWeight: 500 }}>💡 <b style={{color:"#00c896"}}>최근 개수·전체·기간</b> 중 골라 아래 <b style={{color:"#ff5fa2"}}>📥 내 글 불러오기</b>를 누르면, 대상 글이 오른쪽에 리스트로 떠요. 그 글들에 달린 댓글에 답방합니다.</div>
              </div>

              <label className="inp-label" style={{ fontSize: 12, marginBottom: 6, display: "block" }}>답글 방식</label>
              <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
                {([["ai","✨ AI 자동"],["fixed","✍️ 고정 답글"]] as const).map(([m,lbl]) => {
                  const on = rMode === m; const isAi = m === "ai";
                  return (
                    <button key={m} onClick={() => setRMode(m)} style={{ flex: 1, padding: "11px 8px", borderRadius: 10, border: `2px solid ${on ? (isAi?"#8b5cf6":"var(--accent)") : "var(--border)"}`, background: on ? (isAi?"rgba(139,92,246,.12)":"var(--accent-bg)") : "transparent", color: on ? (isAi?"#8b5cf6":"var(--accent-text)") : (isAi?"#8b5cf6":"var(--text2)"), cursor: "pointer", fontSize: 12.5, fontWeight: 700, fontFamily: "inherit" }}>{lbl}</button>
                  );
                })}
              </div>

              {rMode === "ai" ? (
                <div style={{ marginBottom: 12 }}>
                  <div style={{ display:"flex", gap:9, alignItems:"flex-start", padding:"12px 14px", borderRadius:11, background:"rgba(139,92,246,.08)", border:"1px solid rgba(139,92,246,.25)", fontSize:12.5, color:"var(--text2)", lineHeight:1.65, marginBottom:12 }}>
                    <span style={{fontSize:17,flexShrink:0}}>✨</span>
                    <div><b style={{color:"#8b5cf6"}}>AI가 이웃의 댓글을 읽고</b> 그에 맞는 자연스러운 답글을 매번 다르게 만들어줘요. 말투만 골라주세요. <b>(설정 → 글쓰기 AI의 Gemini 무료 키 필요)</b></div>
                  </div>
                  <div style={{ display:"flex", gap:8 }}>
                    {([["담백","깔끔·담백"],["다정","다정·따뜻"],["짧게","짧고 간결"]] as const).map(([t,desc])=>(
                      <button key={t} onClick={()=>setRTone(t)} style={{ flex:1, padding:"11px 8px", borderRadius:10, border:`2px solid ${rTone===t?"#8b5cf6":"var(--border)"}`, background:rTone===t?"rgba(139,92,246,.1)":"transparent", color:rTone===t?"#8b5cf6":"var(--text2)", cursor:"pointer", fontFamily:"inherit", textAlign:"center" }}>
                        <div style={{ fontSize:13, fontWeight:800 }}>{t}</div>
                        <div style={{ fontSize:10, marginTop:2, opacity:.85 }}>{desc}</div>
                      </button>
                    ))}
                  </div>
                </div>
              ) : (
                <div style={{ marginBottom: 12 }}>
                  <textarea className="inp" rows={8} value={rComment} onChange={e => setRComment(e.target.value)} style={{ resize: "vertical", fontSize: 13, lineHeight: 1.7, padding: "12px 14px" }} placeholder="한 줄에 하나씩 인사말을 적어주세요 (여러 개면 랜덤으로 번갈아 답해요)" />
                  <div style={{ fontSize: 12, color: "var(--text2)", marginTop: 6, lineHeight: 1.55, fontWeight: 500 }}>💡 <b>한 줄에 하나씩</b> 여러 개(기본 30개) 넣으면, 댓글마다 <b style={{color:"#00c896"}}>랜덤으로 골라</b> 답해서 똑같은 답글 반복을 피해요. 필요없는 줄은 지우고 원하는 문구로 바꿔도 돼요. (더 정교한 맞춤 답글은 위 <b style={{color:"#ff5fa2"}}>'✨ AI 자동'</b>)</div>
                </div>
              )}

              <Toggle val={rOnlyNew} set={setROnlyNew} label="아직 답글 없는 댓글만 (중복 답글 방지)" />
              <Toggle val={rReplyToReplies} set={setRReplyToReplies} label="상대가 내 답글에 또 답하면 1번만 더 답하기 (대대댓글)" />
              <div style={{ fontSize: 11, color: "var(--text3)", marginTop: 4, marginBottom: 2, lineHeight: 1.5 }}>💬 내 답글에 이웃이 다시 댓글을 달면, 딱 <b>한 번만 더</b> 답해서 대화를 마무리해요. (무한 반복은 자동으로 막아요)</div>

              <div style={{ marginTop: 12 }}>
                <label className="inp-label" style={{ fontSize: 12, marginBottom: 6, display: "block" }}>딜레이 (초)</label>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <input className="inp" {...numProps(rDelayMin, setRDelayMin, 1, 60, 5)} style={{ flex: 1, fontSize: 13, padding: "11px 14px" }} />
                  <span style={{ color: "var(--text3)" }}>~</span>
                  <input className="inp" {...numProps(rDelayMax, setRDelayMax, 1, 120, 10)} style={{ flex: 1, fontSize: 13, padding: "11px 14px" }} />
                </div>
                <div style={{ fontSize: 12, color: "var(--text2)", marginTop: 6, lineHeight: 1.55, fontWeight: 500 }}>💡 답글 사이 대기 시간이에요. <b style={{color:"#00c896"}}>넉넉히 둘수록</b> 사람이 쓰는 것처럼 자연스러워 <b style={{color:"#ff5fa2"}}>계정이 안전</b>해요.</div>
              </div>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <button className="btn btn-primary btn-full" onClick={handleLoadMyPosts} disabled={rLoadingPosts || rWorking || !botOnline} style={{ padding: "14px", fontSize: 14, borderRadius: 12 }}>
                {rLoadingPosts ? <><span className="spinner" />내 글 불러오는 중...</> : "📥 내 글 불러오기"}
              </button>
              <button className="btn btn-secondary" onClick={handleReplyStart} disabled={rWorking || rLoadingPosts || !rMyPosts.length || !botOnline || (!isUnlimitedPlan && replyUsed >= replyLimit)} style={{ padding: "13px", fontSize: 13, borderRadius: 12 }}>
                {rWorking ? <><span className="spinner" />답방 중...</> : (!isUnlimitedPlan && replyUsed >= replyLimit) ? "오늘 한도 도달 (자정 초기화)" : `🚀 답방 시작${rMyPosts.length ? ` (${rMyPosts.length}개 글)` : ""}`}
              </button>
              {rWorking && (
                <button className="btn-stop" onClick={handleReplyStop} style={{ width: "100%", justifyContent: "center", padding: "13px", borderRadius: 12, fontSize: 13 }}>⛔ 중단</button>
              )}
            </div>
          </div>

          {/* 오른쪽: 게이지 + 결과 + 로그 */}
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <UsageGauge label="💬 오늘 답방" used={replyUsed} limit={replyLimit} unit="건" color="#8b5cf6" />
            <div className="card" style={{ padding: "20px 24px" }}>
              <div style={{ fontSize: 13, color: "var(--text3)", fontWeight: 700, marginBottom: 14 }}>💬 답방 결과</div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <div style={{ textAlign: "center", padding: "14px", borderRadius: 12, background: "var(--bg)", border: "1px solid var(--border)" }}>
                  <div style={{ fontSize: 30, fontWeight: 900, color: "var(--success)" }}>{rDoneCnt}</div>
                  <div style={{ fontSize: 12, color: "var(--text3)", marginTop: 4 }}>답글 완료</div>
                </div>
                <div style={{ textAlign: "center", padding: "14px", borderRadius: 12, background: "var(--bg)", border: "1px solid var(--border)" }}>
                  <div style={{ fontSize: 30, fontWeight: 900, color: "var(--danger)" }}>{rFailCnt}</div>
                  <div style={{ fontSize: 12, color: "var(--text3)", marginTop: 4 }}>실패</div>
                </div>
              </div>
            </div>
            {/* 불러온 내 글 리스트 (로그 위) */}
            <div className="card" style={{ padding: "18px 20px" }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: "var(--text3)", marginBottom: 12 }}>📄 불러온 내 글 <b style={{ color: "var(--accent-text)" }}>{rMyPosts.length}</b>개</div>
              {rMyPosts.length === 0 ? (
                <div style={{ padding: "22px", textAlign: "center", color: "var(--text2)", fontSize: 12.5, lineHeight: 1.6 }}>왼쪽에서 대상을 고르고<br /><b style={{color:"#ff5fa2"}}>📥 내 글 불러오기</b>를 누르면 여기에 목록이 떠요.</div>
              ) : (
                <div style={{ maxHeight: 280, overflowY: "auto", display: "flex", flexDirection: "column", gap: 6 }}>
                  {rMyPosts.map((p, i) => (
                    <div key={i} style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 11px", borderRadius: 9, background: "var(--bg)", border: "1px solid var(--border)" }}>
                      <span style={{ flex: 1, minWidth: 0, fontSize: 12.5, color: "var(--text)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{p.title || "(제목 없음)"}</span>
                      {typeof p.comments === "number" && <span style={{ fontSize: 11, color: "var(--accent-text)", fontWeight: 700, flexShrink: 0 }}>💬 {p.comments}</span>}
                      {p.date && <span style={{ fontSize: 11, color: "var(--text3)", flexShrink: 0 }}>{p.date}</span>}
                    </div>
                  ))}
                </div>
              )}
            </div>
            <LogBox logs={rLogs} logRef={rLogRef} onClear={() => setRLogs([])} />
          </div>
        </div>
      )}

      {/* ═══════════ 블로그 건강검진 탭 ═══════════ */}
      {tab === "score" && (
        <div className="npg-2col">
          {/* 왼쪽: 계정 + 진단 버튼 */}
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            {/* 📖 아주 쉬운 안내 (누구나 이해) */}
            <div style={{ background: "linear-gradient(135deg,rgba(0,200,150,.1),rgba(0,165,255,.06))", border: "1.5px solid rgba(0,200,150,.3)", borderRadius: 14, padding: "15px 17px" }}>
              <div style={{ fontSize: 14.5, fontWeight: 900, color: "#00c896", marginBottom: 8 }}>📈 블로그 지수가 뭐예요?</div>
              <div style={{ fontSize: 13, color: "var(--text2)", lineHeight: 1.75, fontWeight: 500 }}>
                내 블로그가 <b>얼마나 건강한지, 검색에 잘 나오는지</b> 알려주는 곳이에요.<br/><br/>
                <b style={{ color: "#00c896" }}>① 진단하기</b> — 버튼 하나 누르면 내 블로그 상태(글 수·이웃·방문자·발행 습관)를 검사해요.<br/>
                <b style={{ color: "#00c896" }}>② 검색 순위 확인</b> — 내 글이 네이버 검색에서 <b>몇 위인지</b> 알려줘요.<br/>
                <b style={{ color: "#00c896" }}>③ 안 뜨는 글 살리기</b> — 검색에 안 나오는 글은 <b>AI가 새 제목을 추천</b>하고, 버튼 한 번으로 <b>제목을 바꿔 다시 발행</b>해줘요.<br/>
                <b style={{ color: "#f59e0b" }}>④ ♻️ 오래된 글 알림</b> — 발행한 지 오래됐는데 검색에 안 뜨는 글을 모아서 <b>"이 글 살려보세요"</b>라고 알려줘요.
              </div>
              <div style={{ fontSize: 11.5, color: "var(--text3)", marginTop: 10, lineHeight: 1.6 }}>💡 순서대로 하면 돼요: <b>진단하기 → 글 선택 → 검색 순위 확인 → 안 뜨는 글은 제목 바꾸기</b>. 어려우면 그냥 위에서부터 하나씩 눌러보세요.</div>
            </div>
            {tierTableNode}
            <div style={{ fontSize: 12, color: "var(--text2)", background: "var(--card2)", borderRadius: 10, padding: "10px 13px", lineHeight: 1.5, fontWeight: 600 }}>
              🔒 <b>{tabName}</b> 전용 계정 <b style={{ color: "#00c896" }}>{accounts.length}</b>/{isUnlimitedPlan ? "∞" : accountLimit}개 · 다른 탭과 <b>완전히 분리</b>돼요(한 곳에서 문제가 생겨도 다른 탭엔 영향 없어요).
            </div>
            <AccountAccordion accounts={accounts} open={acctOpen} setOpen={setAcctOpen} tabName={tabName} accountLimit={accountLimit} isUnlimited={isUnlimitedPlan}>
              <AccountCard accounts={accounts} onLogin={handleLogin} onAdd={handleAddAccount} onRemove={handleRemoveAccount} onChange={handleAccountChange} onConnectAll={handleConnectAll} connectingAll={connectingAll} />
              <AccountSelector accounts={accounts} selectedId={selectedAcctId} onSelect={setSelectedAcctId} />
            </AccountAccordion>
            <div className="card" style={{ padding: "18px 20px" }}>
              <div className="card-title" style={{ marginBottom: 10, fontSize: 15 }}>📈 진단 방법</div>
              <div style={{ fontSize: 12.5, color: "var(--text2)", lineHeight: 1.7, fontWeight: 500 }}>
                <b style={{color:"#00c896"}}>① 진단 시작</b>으로 점수·방문자·이웃 지표를 확인하고, <b style={{color:"#ff5fa2"}}>② 글 불러오기 → 선택 글 검사</b>로 검색 노출을 따로 확인해요.<br /><br />
                건강진단과 검색노출 검사는 분리되어 있어 원하는 글만 검사할 수 있어요.
              </div>
            </div>
            <button className="btn btn-primary btn-full" onClick={handleBlogDiagnose} disabled={scLoading || !botOnline || (!isUnlimitedPlan && scUsed >= scLimit)} style={{ padding: "14px", fontSize: 14, borderRadius: 12 }}>
              {scLoading ? <><span className="spinner" />진단 중...</> : (!isUnlimitedPlan && scUsed >= scLimit) ? "오늘 한도 도달 (자정 초기화)" : "📈 블로그 진단 시작"}
            </button>
            <div className="card" style={{ padding: "18px 20px" }}>
              <div className="card-title" style={{ marginBottom: 12, fontSize: 15 }}>🔎 검색노출 글 선택</div>
              <div style={{ display: "flex", gap: 6, marginBottom: 10 }}>
                <button onClick={() => setScPostMode("period")} style={{ flex: 1, padding: 9, borderRadius: 9, border: `2px solid ${scPostMode==="period"?"var(--accent)":"var(--border)"}`, background: scPostMode==="period"?"var(--accent-bg)":"transparent", color: "var(--text2)", fontWeight: 700, cursor: "pointer" }}>기간</button>
                <button onClick={() => setScPostMode("all")} style={{ flex: 1, padding: 9, borderRadius: 9, border: `2px solid ${scPostMode==="all"?"var(--accent)":"var(--border)"}`, background: scPostMode==="all"?"var(--accent-bg)":"transparent", color: "var(--text2)", fontWeight: 700, cursor: "pointer" }}>전체</button>
              </div>
              {scPostMode === "period" && <>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
                  {([7,14,30,"custom"] as const).map(value => <button key={value} onClick={() => setScPeriod(value)} style={{ padding: 9, borderRadius: 9, border: `2px solid ${scPeriod===value?"var(--accent)":"var(--border)"}`, background: scPeriod===value?"var(--accent-bg)":"transparent", color: "var(--text2)", fontWeight: 700, cursor: "pointer" }}>{value === "custom" ? "직접 설정" : `최근 ${value}일`}</button>)}
                </div>
                {scPeriod === "custom" && <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 8 }}><input className="inp" {...numProps(scCustomDays, setScCustomDays, 1, 3650, 7)} /><span style={{ fontSize: 12, color: "var(--text3)" }}>일 이내</span></div>}
              </>}
              <button className="btn btn-full" onClick={handleLoadScorePosts} disabled={scPostsLoading || !botOnline} style={{ marginTop: 10 }}>{scPostsLoading ? <><span className="spinner" />불러오는 중...</> : "📥 검사할 글 불러오기"}</button>
            </div>
          </div>

          {/* 오른쪽: 게이지 + 리포트 + 로그 */}
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <UsageGauge label="📈 오늘 진단" used={scUsed} limit={scLimit} unit="회" color="#00b8d4" />
            <UsageGauge label="⚡ 오늘 제목 수정" used={titleEditUsed} limit={titleEditLimit} unit="회" color="#00c896" />
            {scPosts.length > 0 && (() => {
              const q = scPostSearch.trim().toLowerCase();
              const filtered = q ? scPosts.filter(p => (p.title || "").toLowerCase().includes(q)) : scPosts;
              const PER = 30; const totalPages = Math.max(1, Math.ceil(filtered.length / PER));
              const page = Math.min(scPostPage, totalPages - 1);
              const shown = filtered.slice(page * PER, page * PER + PER);
              const filteredLogNos = filtered.map(p => scLogNo(p.url)).filter(Boolean);
              const allFilteredSelected = filteredLogNos.length > 0 && filteredLogNos.every(id => scSelectedLogNos.includes(id));
              return (
              <div className="card" style={{ padding: "18px 20px" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, marginBottom: 10 }}>
                  <div style={{ fontSize: 14, fontWeight: 800 }}>📄 검사할 글 <b style={{ color: "var(--accent-text)" }}>{scSelectedLogNos.length}/{scPosts.length}</b></div>
                  <button onClick={() => setScSelectedLogNos(prev => allFilteredSelected ? prev.filter(id => !filteredLogNos.includes(id)) : Array.from(new Set([...prev, ...filteredLogNos])))} style={{ padding: "6px 10px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--bg)", color: "var(--text2)", cursor: "pointer", fontSize: 11.5, fontWeight: 700 }}>{allFilteredSelected ? "전체 해제" : (q ? "검색결과 전체선택" : "전체 선택")}</button>
                </div>
                <div style={{ marginBottom: 10 }}>
                  <input className="inp" value={scPostSearch} onChange={e => { setScPostSearch(e.target.value); setScPostPage(0); }} placeholder="🔍 제목으로 검색..." style={{ fontSize: 12.5, padding: "9px 12px" }} />
                </div>
                {filtered.length === 0 ? <div style={{ fontSize: 12, color: "var(--text3)", padding: "16px 0", textAlign: "center" }}>검색 결과가 없어요.</div> : (
                  <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                    {shown.map(post => { const logNo = scLogNo(post.url); const checked = scSelectedLogNos.includes(logNo); return <label key={post.url} style={{ display: "flex", alignItems: "center", gap: 9, padding: "9px 10px", borderRadius: 9, background: checked ? "var(--accent-bg)" : "var(--bg)", border: "1px solid var(--border)", cursor: "pointer" }}>
                      <input type="checkbox" checked={checked} onChange={() => setScSelectedLogNos(prev => checked ? prev.filter(id => id !== logNo) : [...prev, logNo])} />
                      <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 12.5 }}>{post.title || "(제목 없음)"}</span>
                      <span style={{ flexShrink: 0, fontSize: 11, color: "var(--text3)" }}>{post.date}</span>
                    </label>; })}
                  </div>
                )}
                {totalPages > 1 && (
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8, marginTop: 10 }}>
                    <button onClick={() => setScPostPage(Math.max(0, page - 1))} disabled={page === 0} style={{ padding: "7px 14px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--bg)", color: page === 0 ? "var(--text3)" : "var(--text2)", cursor: page === 0 ? "default" : "pointer", fontSize: 12, fontWeight: 700, fontFamily: "inherit" }}>← 이전</button>
                    <span style={{ fontSize: 12, color: "var(--text2)", fontWeight: 700 }}>{page + 1} / {totalPages} <span style={{ color: "var(--text3)", fontWeight: 500 }}>({filtered.length}개)</span></span>
                    <button onClick={() => setScPostPage(Math.min(totalPages - 1, page + 1))} disabled={page >= totalPages - 1} style={{ padding: "7px 14px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--bg)", color: page >= totalPages - 1 ? "var(--text3)" : "var(--text2)", cursor: page >= totalPages - 1 ? "default" : "pointer", fontSize: 12, fontWeight: 700, fontFamily: "inherit" }}>다음 →</button>
                  </div>
                )}
                <button className="btn btn-primary btn-full" onClick={handleCheckSelectedExposure} disabled={scExposureLoading || !scSelectedLogNos.length} style={{ marginTop: 12 }}>{scExposureLoading ? <><span className="spinner" />검사 중...</> : `🔎 선택한 ${scSelectedLogNos.length}개 검색노출 확인`}</button>
              </div>
              );
            })()}
            {!scResult ? (
              <div className="card" style={{ padding: "48px 24px", textAlign: "center", color: "var(--text2)", fontSize: 13.5, lineHeight: 1.7 }}>
                왼쪽에서 계정을 연결하고 <b style={{color:"#ff5fa2"}}>📈 블로그 진단 시작</b>을 누르면<br />내 블로그의 건강 리포트가 여기에 나타나요.
              </div>
            ) : (() => {
              const now = Date.now();
              // ★KST 달력 날짜 기준 경과일(자정 넘으면 바로 +1일). 경과 '시간'이 아니라 '날짜 차이'로 계산.
              const kstDayNum = (ms: number) => Math.floor((ms + 9 * 3600000) / 86400000);
              const todayNum = kstDayNum(now);
              // ★파싱 안 되는 날짜(상대시간 등)가 섞이면 NaN → 봇(crawlBlogStats)과 동일하게 유효 날짜만 거른다.
              const dayNumOf = (d: string) => { const t = new Date(`${d}T00:00:00+09:00`).getTime(); return Number.isFinite(t) ? kstDayNum(t) : NaN; };
              const dayNums = (scResult.recentDates || []).map(dayNumOf).filter(n => Number.isFinite(n)).sort((a, b) => b - a);
              const recent30 = dayNums.filter(n => (todayNum - n) <= 30).length;
              const lastDaysAgo = dayNums.length ? (todayNum - dayNums[0]) : 999;
              // 점수(0~100): 글수·이웃·최근발행·활동성 가중
              const sPost = Math.min(30, (scResult.totalPosts / 100) * 30);
              const sNbr = Math.min(25, (scResult.neighbors / 1000) * 25);
              const sFreq = Math.min(30, (recent30 / 12) * 30);      // 월 12회면 만점
              const sActive = lastDaysAgo <= 3 ? 15 : lastDaysAgo <= 7 ? 10 : lastDaysAgo <= 14 ? 5 : 0;
              const score = Math.round(sPost + sNbr + sFreq + sActive);
              const grade = score >= 80 ? { label: "최적화", emoji: "🏆", color: "#8b5cf6" } : score >= 60 ? { label: "우수", emoji: "⭐", color: "#3b82f6" } : score >= 40 ? { label: "성장중", emoji: "🌿", color: "#00c896" } : score >= 20 ? { label: "초기", emoji: "🌱", color: "#f59e0b" } : { label: "휴면", emoji: "😴", color: "#ef4444" };
              const tips: string[] = [];
              if (recent30 < 8) tips.push("발행이 뜸해요. 네이버는 꾸준한 발행을 좋아해요 — 최소 주 2~3회 이상을 권장해요.");
              if (lastDaysAgo > 7) tips.push(`마지막 글이 ${lastDaysAgo}일 전이에요. 방치되면 노출이 줄어요 — 새 글을 올려보세요.`);
              if (scResult.neighbors < 300) tips.push("이웃이 적어요. '서이추' 기능으로 이웃을 늘리면 방문·소통이 커져요.");
              if (scResult.totalPosts < 30) tips.push("글이 아직 적어요. 주제를 정해 꾸준히 쌓으면 블로그 힘이 붙어요.");
              if (scResult.lowQualitySuspected === true) tips.push("선택해 검사한 글 대부분이 제목 검색 100위 안에서 누락됐어요. 제목·본문의 반복 키워드와 과도한 상업성 표현을 점검하고 며칠 간격으로 다시 검사해보세요.");
              if (scResult.visitorDrop?.detected) tips.push(`${scResult.visitorDrop.message}했어요. 유입 검색어 순위 변화와 최근 수정·삭제한 글이 있는지 확인해보세요.`);
              if (recent30 >= 8 && lastDaysAgo <= 3) tips.push("발행 습관이 아주 좋아요! 지금처럼 꾸준히 유지하세요. 👍");
              if (tips.length === 0) tips.push("전반적으로 건강해요. 공감·댓글과 답방으로 소통을 더 키워보세요!");
              const metrics = [
                { label: "총 글 수", value: scResult.totalPosts.toLocaleString(), icon: "📝", color: "#00c896" },
                { label: "이웃 수", value: scResult.neighbors.toLocaleString(), icon: "🤝", color: "#00b8d4" },
                { label: "최근 30일 발행", value: `${recent30}회`, icon: "🔥", color: "#ff5fa2" },
                { label: "마지막 활동", value: lastDaysAgo >= 999 ? "-" : lastDaysAgo === 0 ? "오늘" : `${lastDaysAgo}일 전`, icon: "⏱️", color: "#f59e0b" },
              ];
              const exposureChecks = scResult.exposureChecks || [];
              const checkedExposure = exposureChecks.filter(item => item.exposed !== null);
              const exposedCount = checkedExposure.filter(item => item.exposed).length;
              const visitorDays = scResult.visitorDays || [];
              const maxVisitors = Math.max(1, ...visitorDays.map(day => day.visitors));
              return (
                <div className="card" style={{ padding: "24px 26px" }}>
                  {/* 📄 진단 보고서 PDF — 눈에 잘 띄는 자리(제출용). 소상공인·대행사 미팅용 */}
                  <button onClick={downloadBlogReport} style={{ width: "100%", marginBottom: 16, padding: "13px", borderRadius: 12, border: "none", background: "linear-gradient(135deg,#8b5cf6,#ec4899)", color: "#fff", fontWeight: 800, fontSize: 14.5, cursor: "pointer", fontFamily: "inherit", boxShadow: "0 4px 14px rgba(139,92,246,.3)", display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}>📄 이 진단을 보고서(PDF)로 저장 · 고객 제출용</button>
                  {/* 종합 등급 */}
                  <div style={{ display: "flex", alignItems: "center", gap: 18, paddingBottom: 20, marginBottom: 20, borderBottom: "1px solid var(--border)" }}>
                    <div style={{ position: "relative", width: 92, height: 92, flexShrink: 0 }}>
                      <svg width="92" height="92" style={{ transform: "rotate(-90deg)" }}>
                        <circle cx="46" cy="46" r="40" fill="none" stroke="var(--border)" strokeWidth="8" />
                        <circle cx="46" cy="46" r="40" fill="none" stroke={grade.color} strokeWidth="8" strokeLinecap="round" strokeDasharray={`${(score / 100) * 251} 251`} style={{ transition: "stroke-dasharray .8s ease" }} />
                      </svg>
                      <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
                        <div style={{ fontSize: 26, fontWeight: 900, color: grade.color, lineHeight: 1 }}>{score}</div>
                        <div style={{ fontSize: 10, color: "var(--text3)", fontWeight: 600 }}>점</div>
                      </div>
                    </div>
                    <div>
                      <div style={{ fontSize: 13, color: "var(--text3)", fontWeight: 700, marginBottom: 4 }}>내 블로그 <b style={{color:"var(--text2)"}}>{scResult.blogId}</b></div>
                      <div style={{ fontSize: 24, fontWeight: 900, color: grade.color }}>{grade.emoji} {grade.label}</div>
                      <div style={{ fontSize: 12, color: "var(--text2)", marginTop: 4, fontWeight: 500 }}>실제 지표로 계산한 퍼블리 건강 점수예요</div>
                      <div style={{ fontSize: 11, color: "var(--text3)", marginTop: 5, lineHeight: 1.55 }}>💬 <b>글 수·이웃 수·발행 활동·검색 노출</b>을 종합한 0~100점이에요. 네이버 공식 지수는 아니고, 블로그 관리 방향을 잡는 <b>퍼블리 자체 건강검진</b>이에요.</div>
                    </div>
                  </div>
                  {/* ★발행 활성도 (상위노출 핵심) */}
                  {scResult.activity && (() => {
                    const a = scResult.activity!;
                    const c = a.level === "active" ? "#00c896" : a.level === "normal" ? "#f59e0b" : "#ef4444";
                    const label = a.level === "active" ? "🟢 활성 블로그" : a.level === "normal" ? "🟡 보통" : "🔴 비활성 (관리 필요)";
                    return (
                      <div style={{ marginBottom: 20, padding: "16px 18px", borderRadius: 14, background: `${c}14`, border: `1.5px solid ${c}55` }}>
                        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
                          <div style={{ fontSize: 15, fontWeight: 900, color: c }}>{label}</div>
                          <div style={{ fontSize: 12, color: "var(--text2)", fontWeight: 700 }}>최근 7일 {a.postsIn7d}개 · 30일 {a.postsIn30d}개 · 마지막 {a.daysSinceLast === 0 ? "오늘" : `${a.daysSinceLast}일 전`}</div>
                        </div>
                        <div style={{ fontSize: 12.5, color: "var(--text)", marginTop: 7, lineHeight: 1.5, fontWeight: 500 }}>{a.message}</div>
                      </div>
                    );
                  })()}
                  {/* 지표 카드 */}
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 20 }}>
                    {metrics.map(m => (
                      <div key={m.label} style={{ padding: "14px 16px", borderRadius: 13, background: "var(--bg)", border: "1px solid var(--border)", borderLeft: `4px solid ${m.color}` }}>
                        <div style={{ fontSize: 11.5, color: "var(--text2)", fontWeight: 600, marginBottom: 6 }}>{m.icon} {m.label}</div>
                        <div style={{ fontSize: 22, fontWeight: 900, color: "var(--text)" }}>{m.value}</div>
                      </div>
                    ))}
                  </div>
                  {/* 🆕 수정 추적 대시보드 — 제목 바꾼 글을 완치까지 데려가는 관제탑 (title_changed_at 있는 글) */}
                  {(() => {
                    const tracked = Object.values(careMap).filter(c => c.title_changed_at)
                      .sort((a, b) => new Date(a.title_changed_at!).getTime() - new Date(b.title_changed_at!).getTime());   // 수정 오래된 순
                    if (!tracked.length) return null;
                    const totalPages = Math.max(1, Math.ceil(tracked.length / TRACK_PAGE_SIZE));
                    const page = Math.min(trackPage, totalPages - 1);
                    const pageItems = tracked.slice(page * TRACK_PAGE_SIZE, page * TRACK_PAGE_SIZE + TRACK_PAGE_SIZE);
                    const observingN = tracked.filter(c => computeCareStatus(c).status === "observing").length;
                    const relapseN = tracked.filter(c => computeCareStatus(c).status === "relapse").length;
                    const curedN = tracked.filter(c => computeCareStatus(c).status === "cured").length;
                    return (
                      <div style={{ marginBottom: 20, borderRadius: 16, background: "linear-gradient(135deg, rgba(0,200,150,.07), rgba(139,92,246,.05))", border: "1.5px solid rgba(0,200,150,.28)", overflow: "hidden" }}>
                        <div style={{ padding: "16px 18px", display: "flex", alignItems: "center", gap: 12 }}>
                          <img src={boriImg} alt="응원단 보리" onError={e => { const s = document.createElement("div"); s.textContent = "🌱"; s.style.cssText = "font-size:34px;line-height:1"; e.currentTarget.replaceWith(s); }} style={{ width: 44, height: 44, objectFit: "contain", flexShrink: 0, filter: "drop-shadow(0 4px 8px rgba(139,92,246,.3))" }} />
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontSize: 14.5, fontWeight: 850, color: "var(--text)" }}>🌱 수정 추적 <span style={{ fontSize: 11.5, fontWeight: 800, color: "#00c896", background: "rgba(0,200,150,.14)", padding: "2px 9px", borderRadius: 20, marginLeft: 4 }}>{tracked.length}개 관리 중</span>{autoTrackLoading && <span style={{ fontSize: 11, fontWeight: 800, color: "#8b5cf6", background: "rgba(139,92,246,.12)", padding: "2px 9px", borderRadius: 20, marginLeft: 6 }}>🔄 순위 자동 확인 중…</span>}</div>
                            <div style={{ fontSize: 11.5, color: "var(--text2)", marginTop: 3, lineHeight: 1.5 }}>제목을 바꾼 글이에요. 주치의가 <b style={{ color: "#8b5cf6" }}>완치(검색 노출)될 때까지</b> 함께 지켜봐요. <b style={{ color: "#00c896" }}>순위는 자동으로 채워져요</b> — 직접 안 눌러도 돼요.</div>
                          </div>
                          <button onClick={() => { setTrackOpen(o => !o); setTrackPage(0); }} style={{ flexShrink: 0, padding: "8px 14px", borderRadius: 10, border: "none", background: trackOpen ? "var(--card2)" : "linear-gradient(135deg,#00c896,#00a878)", color: trackOpen ? "var(--text2)" : "#fff", cursor: "pointer", fontSize: 12, fontWeight: 800, fontFamily: "inherit" }}>{trackOpen ? "접기 ▲" : "리스트 보기 ▼"}</button>
                        </div>
                        {/* 상태 요약 칩 */}
                        <div style={{ display: "flex", gap: 7, flexWrap: "wrap", padding: "0 18px 14px" }}>
                          {observingN > 0 && <span style={{ fontSize: 11, fontWeight: 800, color: "#8b5cf6", background: "rgba(139,92,246,.12)", padding: "4px 11px", borderRadius: 20 }}>🌱 관찰 중 {observingN}</span>}
                          {relapseN > 0 && <span style={{ fontSize: 11, fontWeight: 800, color: "#f59e0b", background: "rgba(245,158,11,.12)", padding: "4px 11px", borderRadius: 20 }}>🔴 재점검 필요 {relapseN}</span>}
                          {curedN > 0 && <span style={{ fontSize: 11, fontWeight: 800, color: "#00c896", background: "rgba(0,200,150,.12)", padding: "4px 11px", borderRadius: 20 }}>✅ 완치 {curedN}</span>}
                        </div>
                        {/* 🔴 재점검 필요(관찰 끝났는데도 안 뜬) 글 전체 제목 다시 바꾸기 — 기존 전체변경 로직 재사용 */}
                        {relapseN > 0 && (
                          <div style={{ padding: "0 18px 14px" }}>
                            <button onClick={() => runBulkRetitle(tracked.filter(c => computeCareStatus(c).status === "relapse").map(c => ({ title: c.title || "", logNo: c.post_key, blogId: activeAccount?.blogId })))}
                              disabled={bulkRunning}
                              style={{ width: "100%", padding: "11px", borderRadius: 11, border: "none", background: bulkRunning ? "var(--card2)" : "linear-gradient(135deg,#f59e0b,#ef4444)", color: bulkRunning ? "var(--text3)" : "#fff", cursor: bulkRunning ? "default" : "pointer", fontSize: 13, fontWeight: 800, fontFamily: "inherit" }}>
                              {bulkRunning ? `🔄 제목 바꾸는 중… (${bulkProgress.done}/${bulkProgress.total})` : `🔴 재점검 ${relapseN}개 제목 전체 다시 바꾸기 (AI가 글 읽고 새 제목)`}
                            </button>
                            <div style={{ fontSize: 10.5, color: "var(--text3)", marginTop: 5, lineHeight: 1.5 }}>충분히 기다렸는데도 검색에 안 뜬 글이에요. AI가 본문을 읽고 새 제목으로 한 번에 바꿔 다시 도전해요.</div>
                          </div>
                        )}
                        {/* 펼침 리스트 */}
                        {trackOpen && (
                          <div style={{ background: "var(--bg)", borderTop: "1px solid var(--border)", padding: "12px 14px" }}>
                            {pageItems.map((c, i) => {
                              const st = computeCareStatus(c);
                              const changedDays = c.title_changed_at ? Math.floor((Date.now() - new Date(c.title_changed_at).getTime()) / 86400000) : 0;
                              const live = liveRanks[c.post_key];
                              const lastHist = c.rank_history?.[c.rank_history.length - 1];
                              const shownRank = live ? live.rank : (lastHist?.rank ?? null);
                              const stColor = st.status === "cured" ? "#00c896" : st.status === "observing" ? "#8b5cf6" : st.status === "relapse" ? "#f59e0b" : "var(--text3)";
                              const stLabel = st.status === "cured" ? "✅ 완치" : st.status === "observing" ? `🌱 관찰 중 (${st.daysLeft}일 남음)` : st.status === "relapse" ? "🔴 재점검 필요" : "진행 중";
                              return (
                                <div key={c.post_key} style={{ padding: "12px 4px", borderBottom: i < pageItems.length - 1 ? "1px solid var(--border)" : "none" }}>
                                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                                    <div style={{ flex: 1, minWidth: 0 }}>
                                      <div style={{ fontSize: 13, fontWeight: 700, color: "var(--text)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{c.title || c.post_key}</div>
                                      <div style={{ fontSize: 10.5, color: "var(--text3)", marginTop: 3, display: "flex", gap: 8, flexWrap: "wrap" }}>
                                        <span>✍️ 수정 {changedDays === 0 ? "오늘" : `${changedDays}일 전`}</span>
                                        <span style={{ color: stColor, fontWeight: 800 }}>{stLabel}</span>
                                        <span>📊 순위 {shownRank == null ? "미노출" : `${shownRank}위`}{live && <span style={{ color: "#00c896" }}> ·방금</span>}</span>
                                        {(() => { const vw = latestViews(c); return vw != null ? <span style={{ color: vw === 0 ? "#ef4444" : "#0ea5e9", fontWeight: 800 }}>👁 조회 {vw.toLocaleString()}</span> : null; })()}
                                      </div>
                                    </div>
                                    <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
                                      <button onClick={() => checkOneRank(c.post_key)} disabled={rankChecking === c.post_key} title="지금 검색해서 현재 순위를 실시간으로 확인해요" style={{ padding: "6px 10px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--card)", color: "var(--text2)", cursor: "pointer", fontSize: 10.5, fontWeight: 800, fontFamily: "inherit", whiteSpace: "nowrap" }}>{rankChecking === c.post_key ? "검사 중..." : "🔍 순위 검사"}</button>
                                      <a href={`https://blog.naver.com/${activeAccount?.blogId || ""}/${c.post_key}`} target="_blank" rel="noopener noreferrer" style={{ padding: "6px 10px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--card)", color: "var(--text2)", textDecoration: "none", fontSize: 10.5, fontWeight: 800, whiteSpace: "nowrap" }}>👁 보기</a>
                                      <button onClick={() => { const item = { title: c.title || c.post_key, logNo: c.post_key, blogId: activeAccount?.blogId }; handleTrackedRepublish(item, changedDays, st); }} style={{ padding: "6px 10px", borderRadius: 8, border: "none", background: "linear-gradient(135deg,#8b5cf6,#a855f7)", color: "#fff", cursor: "pointer", fontSize: 10.5, fontWeight: 800, fontFamily: "inherit", whiteSpace: "nowrap" }}>✏️ 제목 변경</button>
                                    </div>
                                  </div>
                                </div>
                              );
                            })}
                            {totalPages > 1 && (
                              <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 5, marginTop: 12 }}>
                                <button onClick={() => setTrackPage(Math.max(0, page - 1))} disabled={page === 0} style={{ padding: "5px 10px", borderRadius: 7, border: "1px solid var(--border)", background: "var(--card)", color: "var(--text2)", cursor: page === 0 ? "default" : "pointer", fontSize: 11, fontWeight: 700, opacity: page === 0 ? .4 : 1, fontFamily: "inherit" }}>‹ 이전</button>
                                <span style={{ fontSize: 11, color: "var(--text2)", fontWeight: 700 }}>{page + 1} / {totalPages}</span>
                                <button onClick={() => setTrackPage(Math.min(totalPages - 1, page + 1))} disabled={page === totalPages - 1} style={{ padding: "5px 10px", borderRadius: 7, border: "1px solid var(--border)", background: "var(--card)", color: "var(--text2)", cursor: page === totalPages - 1 ? "default" : "pointer", fontSize: 11, fontWeight: 700, opacity: page === totalPages - 1 ? .4 : 1, fontFamily: "inherit" }}>다음 ›</button>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })()}
                  {/* 검색 노출/저품질 진단 */}
                  <div style={{ marginBottom: 20, padding: "16px", borderRadius: 14, background: scResult.lowQualitySuspected ? "rgba(239,68,68,.08)" : "var(--bg)", border: `1px solid ${scResult.lowQualitySuspected ? "rgba(239,68,68,.35)" : "var(--border)"}` }}>
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center", marginBottom: 4 }}>
                      <div style={{ fontSize: 14, fontWeight: 850 }}>🔎 검색 노출 진단</div>
                      <div style={{ fontSize: 13, fontWeight: 850, color: scResult.lowQualitySuspected ? "#ef4444" : checkedExposure.length ? "#00c896" : "var(--text3)" }}>
                        {scResult.lowQualitySuspected === true ? "🔴 저품질 의심" : checkedExposure.length ? `${exposedCount}/${checkedExposure.length}개 노출` : "확인 불가"}
                      </div>
                    </div>
                    <HelpLine>내 글 제목으로 네이버 통합검색(블로그탭)을 실제로 돌려서 <b>내 글이 100위 안에 뜨는지</b> 확인해요. <b style={{ color: "#00c896" }}>노출</b>=100위 안 / <b style={{ color: "#f59e0b" }}>미노출</b>=색인은 됐지만 100위 밖 / <b style={{ color: "#ef4444" }}>색인 누락</b>=검색 데이터베이스에 글 자체가 없음이에요.</HelpLine>
                    <div style={{ marginBottom: 10, padding: "8px 10px", borderRadius: 9, background: "rgba(0,184,212,.08)", color: "var(--text2)", fontSize: 11.5, fontWeight: 650, lineHeight: 1.5 }}>
                      오늘 {(scResult.checkedTodayCount || 0).toLocaleString()}개 검사 · 전체 {(scResult.totalPostsForExposure || 0).toLocaleString()}개 중 {(scResult.exposureCompletedCount || 0).toLocaleString()}개 완료
                      {scResult.exposureLimit == null ? " (무제한 등급)" : ` (등급 한도 ${scResult.exposureLimit.toLocaleString()}개/일)`}
                    </div>
                    {exposureChecks.length ? (() => {
                      const q = scExpSearch.trim().toLowerCase();
                      const base = q ? exposureChecks.filter(item => item.title.toLowerCase().includes(q)) : exposureChecks;
                      // 순위 구간 필터: 노출(exposed) 글은 rank로, '100위 밖'은 미노출(exposed===false)
                      const inRank = (item: any, max: number) => item.exposed === true && item.rank != null && item.rank <= max;
                      const rankMatch = (item: any) =>
                        scRankFilter === "all" ? true :
                        scRankFilter === "out" ? item.exposed === false :
                        scRankFilter === "missing" ? item.status === "missing" :
                        scRankFilter === "t10" ? inRank(item, 10) :
                        scRankFilter === "t20" ? inRank(item, 20) :
                        scRankFilter === "t50" ? inRank(item, 50) :
                        scRankFilter === "t100" ? inRank(item, 100) : true;
                      const filtered = base.filter(rankMatch);
                      // 🕐 색인 유예: 발행 14일 이내 미노출은 '누락'에서 빼서(색인 대기) 실제 살릴 글만 카운트 — 회진과 기준 통일.
                      const isIndexing = (x: any) => { if (x.exposed !== false || !x.date) return false; const a = Math.floor((Date.now() - new Date(x.date).getTime()) / 86400000); return Number.isFinite(a) && a >= 0 && a < INDEX_GRACE_DAYS; };
                      // 각 구간 개수(전체 기준 — 버튼에 숫자 표시)
                      const rc = {
                        all: exposureChecks.length,
                        t10: exposureChecks.filter(x => inRank(x, 10)).length,
                        t20: exposureChecks.filter(x => inRank(x, 20)).length,
                        t50: exposureChecks.filter(x => inRank(x, 50)).length,
                        t100: exposureChecks.filter(x => inRank(x, 100)).length,
                        out: exposureChecks.filter(x => x.exposed === false && !isIndexing(x)).length,
                        missing: exposureChecks.filter(x => x.status === "missing").length,
                        indexing: exposureChecks.filter(isIndexing).length,
                      };
                      const rankTabs: { k: typeof scRankFilter; label: string; n: number; col: string }[] = [
                        { k: "all", label: "전체", n: rc.all, col: "#6b7280" },
                        { k: "t10", label: "10위 이내", n: rc.t10, col: "#00a878" },
                        { k: "t20", label: "20위 이내", n: rc.t20, col: "#0ea5e9" },
                        { k: "t50", label: "50위 이내", n: rc.t50, col: "#8b5cf6" },
                        { k: "t100", label: "100위 이내", n: rc.t100, col: "#f59e0b" },
                        { k: "out", label: "100위 밖", n: rc.out, col: "#f59e0b" },
                        { k: "missing", label: "🔴 색인 누락", n: rc.missing, col: "#dc2626" },
                      ];
                      const PER = 30; const totalPages = Math.max(1, Math.ceil(filtered.length / PER));
                      const page = Math.min(scExpPage, totalPages - 1);
                      const shown = filtered.slice(page * PER, page * PER + PER);
                      return (
                        <>
                          {/* 순위 구간 필터 — 클릭하면 분류(테리 요청) */}
                          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 10 }}>
                            {rankTabs.map(t => {
                              const on = scRankFilter === t.k;
                              return (
                                <button key={t.k} onClick={() => { setScRankFilter(t.k); setScExpPage(0); }}
                                  style={{ padding: "6px 11px", borderRadius: 20, border: `1.5px solid ${on ? t.col : "var(--border)"}`, background: on ? t.col : "transparent", color: on ? "#fff" : "var(--text2)", cursor: "pointer", fontSize: 11.5, fontWeight: 800, fontFamily: "inherit", transition: "all .15s", whiteSpace: "nowrap" }}>
                                  {t.label} <span style={{ opacity: on ? .9 : .6 }}>{t.n}</span>
                                </button>
                              );
                            })}
                          </div>
                          {/* 제목 검색 */}
                          <div style={{ marginBottom: 10 }}>
                            <input className="inp" value={scExpSearch} onChange={e => { setScExpSearch(e.target.value); setScExpPage(0); }} placeholder="🔍 제목으로 검색..." style={{ fontSize: 12.5, padding: "9px 12px" }} />
                          </div>
                          {filtered.length === 0 ? <div style={{ fontSize: 12, color: "var(--text3)", padding: "16px 0", textAlign: "center" }}>검색 결과가 없어요.</div> : (
                            <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
                              {shown.map((item, i) => {
                                // 🕐 색인 유예: 발행 14일 이내 미노출은 '누락'이 아니라 '색인 대기'(네이버가 아직 읽는 중). 회진과 동일 기준으로 통일.
                                const ageDays = (item as any).date ? Math.floor((Date.now() - new Date((item as any).date).getTime()) / 86400000) : NaN;
                                const indexing = item.exposed === false && Number.isFinite(ageDays) && ageDays >= 0 && ageDays < INDEX_GRACE_DAYS;
                                const indexMissing = !indexing && item.status === "missing";
                                return (
                                <div key={`${item.title}-${page}-${i}`} title={indexMissing ? "이 글은 네이버 검색 데이터베이스에 아예 없어요. 저품질·누락 의심이라 제목만 바꿔선 안 뜰 수 있어요. 아래 '살리기'로 글을 통째로 새로 써서 덮어쓰면 회복 기회가 생겨요." : undefined} style={{ display: "grid", gridTemplateColumns: "22px minmax(0,1fr) auto", gap: 7, alignItems: "center", fontSize: 12, padding: indexMissing ? "8px 9px" : undefined, borderRadius: indexMissing ? 9 : undefined, background: indexMissing ? "rgba(220,38,38,.08)" : undefined, border: indexMissing ? "1px solid rgba(220,38,38,.28)" : undefined }}>
                                <span>{item.exposed === true ? "✅" : indexing ? "🕐" : indexMissing ? "🔴" : item.exposed === false ? "❌" : "➖"}</span>
                                <span title={item.title} style={{ overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis", color: "var(--text2)" }}>{item.title}</span>
                                <div style={{ display: "flex", alignItems: "center", gap: 7, justifyContent: "flex-end" }}>
                                  <b style={{ color: indexing ? "#0ea5e9" : indexMissing ? "#dc2626" : item.exposed === false ? "#f59e0b" : "var(--text2)", whiteSpace: "nowrap" }}>{item.exposed === true ? `약 ${item.rank}위` : indexing ? "색인 대기" : indexMissing ? "🔴 심각 — 색인 누락(검색에 아예 없음)" : item.exposed === false ? (item.indexed === true ? "100위 밖(색인됨)" : "100위 밖(미노출)") : "확인 불가"}</b>
                                  {/* 미노출 글은 살리기 — 단, 색인 대기(발행 14일 이내)는 아직 판단 이르니 버튼 대신 안내 */}
                                  {indexing ? (
                                    <span title={`발행한 지 ${ageDays}일 — 네이버가 아직 색인·순위를 매기는 중이에요. ${INDEX_GRACE_DAYS}일쯤 기다려 주세요.`} style={{ flexShrink: 0, fontSize: 10.5, color: "#0ea5e9", fontWeight: 700, whiteSpace: "nowrap" }}>{INDEX_GRACE_DAYS - ageDays}일 뒤 판단</span>
                                  ) : item.exposed === false && item.logNo && (
                                    <button onClick={() => handleTrackedRepublish({ title: item.title, logNo: item.logNo, blogId: activeAccount?.blogId }, 0, { status: "needs" })}
                                      style={{ flexShrink: 0, padding: "4px 10px", borderRadius: 7, border: "none", background: "linear-gradient(135deg,#f59e0b,#ef4444)", color: "#fff", fontSize: 11, fontWeight: 800, cursor: "pointer", fontFamily: "inherit" }}>✏️ 살리기</button>
                                  )}
                                </div>
                              </div>);
                              })}
                            </div>
                          )}
                          {totalPages > 1 && (
                            <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8, marginTop: 12 }}>
                              <button onClick={() => setScExpPage(Math.max(0, page - 1))} disabled={page === 0} style={{ padding: "7px 14px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--bg)", color: page === 0 ? "var(--text3)" : "var(--text2)", cursor: page === 0 ? "default" : "pointer", fontSize: 12, fontWeight: 700, fontFamily: "inherit" }}>← 이전</button>
                              <span style={{ fontSize: 12, color: "var(--text2)", fontWeight: 700 }}>{page + 1} / {totalPages} <span style={{ color: "var(--text3)", fontWeight: 500 }}>({filtered.length}개)</span></span>
                              <button onClick={() => setScExpPage(Math.min(totalPages - 1, page + 1))} disabled={page >= totalPages - 1} style={{ padding: "7px 14px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--bg)", color: page >= totalPages - 1 ? "var(--text3)" : "var(--text2)", cursor: page >= totalPages - 1 ? "default" : "pointer", fontSize: 12, fontWeight: 700, fontFamily: "inherit" }}>다음 →</button>
                            </div>
                          )}
                        </>
                      );
                    })() : <div style={{ fontSize: 12, color: "var(--text3)" }}>위에서 글을 불러와 선택한 뒤 검색노출 확인을 실행하세요.</div>}
                    <div style={{ marginTop: 10, fontSize: 11, color: "var(--text3)", lineHeight: 1.5 }}>🔴 <b style={{ color: "#dc2626" }}>색인 누락</b>=네이버 검색 데이터베이스에 글 자체가 없어 제목만 바꿔선 안 뜰 수 있어요. <b>살리기</b>로 글을 통째로 새로 써서 덮어쓰면 회복 기회가 생겨요. / 🕐 <b style={{ color: "#0ea5e9" }}>색인 대기</b>=발행한 지 {INDEX_GRACE_DAYS}일이 안 된 글이라 지금 안 떠도 정상이니 살리지 말고 기다리면 돼요. / 네이버 공식 지수가 아닌 퍼블리 자체 진단이에요.</div>
                  </div>

                  {/* 🩺 오늘의 회진 — 제목을 아직 안 바꾼 글만(바꾼 글은 위 '수정 추적'이 담당). 도도가 오늘 뭘 할지 지휘 */}
                  {(() => {
                    const notChanged = Object.values(careMap).filter(c => !c.title_changed_at);
                    if (notChanged.length === 0) return null;
                    const cnt: Record<string, number> = { new: 0, indexing: 0, needs: 0, prescribed: 0, observing: 0, relapse: 0, cured: 0 };
                    // 상태별로 글을 실제로 모아둔다(칩 클릭 시 어떤 글인지 리스트로 보여주려고)
                    const byStatus: { todo: PostCare[]; indexing: PostCare[]; observing: PostCare[]; cured: PostCare[] } = { todo: [], indexing: [], observing: [], cured: [] };
                    notChanged.forEach(c => {
                      const s = computeCareStatus(c).status; cnt[s]++;
                      if (s === "needs" || s === "relapse") byStatus.todo.push(c);
                      else if (s === "indexing") byStatus.indexing.push(c);
                      else if (s === "observing") byStatus.observing.push(c);
                      else if (s === "cured") byStatus.cured.push(c);
                    });
                    const todo = cnt.needs + cnt.relapse;   // 지금 손볼 것
                    const total = notChanged.length;
                    const rate = total ? Math.round(cnt.cured / total * 100) : 0;   // 노출률(검색에 뜨는 글 비율)
                    // 글의 현재 순위(자동검사로 채워진 실시간값 우선, 없으면 마지막 기록)
                    const rankOf = (c: PostCare) => { const live = liveRanks[c.post_key]; const last = c.rank_history?.[c.rank_history.length - 1]; return live ? live.rank : (last?.rank ?? null); };
                    // 클릭 가능한 칩(누르면 아래에 해당 글 리스트가 열림)
                    const clickChip = (key: "todo"|"indexing"|"observing"|"cured", bg: string, col: string, txt: string) => (
                      <button onClick={() => setCareListOpen(o => o === key ? "" : key)}
                        style={{ padding: "5px 12px", borderRadius: 20, background: careListOpen === key ? col : bg, color: careListOpen === key ? "#fff" : col, fontSize: 11.5, fontWeight: 800, whiteSpace: "nowrap", border: `1.5px solid ${col}`, cursor: "pointer", fontFamily: "inherit", transition: "all .15s" }}>
                        {txt} <span style={{ opacity: .8 }}>{careListOpen === key ? "▲" : "▾"}</span>
                      </button>
                    );
                    // 상태별 글 리스트(제목·순위·보기)
                    const careList = (items: PostCare[], emptyMsg: string, showFix = false) => (
                      <div style={{ marginTop: 10, background: "var(--bg)", borderRadius: 10, border: "1px solid var(--border)", padding: "8px 10px", maxHeight: 320, overflowY: "auto" }}>
                        {items.length === 0 ? <div style={{ fontSize: 11.5, color: "var(--text3)", padding: "8px 2px", textAlign: "center" }}>{emptyMsg}</div> :
                          items.slice(0, 50).map((c, i) => { const rk = rankOf(c); const vw = latestViews(c); return (
                            <div key={c.post_key} style={{ display: "flex", alignItems: "center", gap: 8, padding: "7px 2px", borderBottom: i < Math.min(items.length, 50) - 1 ? "1px solid var(--border)" : "none" }}>
                              <span style={{ flex: 1, minWidth: 0, fontSize: 12, color: "var(--text2)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{c.title || c.post_key}</span>
                              {vw != null && <span title="일 조회수(통계에서 자동 수집)" style={{ flexShrink: 0, fontSize: 10.5, fontWeight: 800, color: vw === 0 ? "#ef4444" : "#0ea5e9" }}>조회 {vw.toLocaleString()}</span>}
                              <b style={{ fontSize: 11, color: rk == null ? "#ef4444" : rk <= 10 ? "#00a878" : rk <= 100 ? "var(--text2)" : "#ef4444", flexShrink: 0 }}>{rk == null ? "미노출" : `${rk}위`}</b>
                              <a href={`https://blog.naver.com/${activeAccount?.blogId || ""}/${c.post_key}`} target="_blank" rel="noopener noreferrer" style={{ flexShrink: 0, fontSize: 10.5, fontWeight: 800, color: "var(--text3)", textDecoration: "none", padding: "3px 8px", borderRadius: 7, border: "1px solid var(--border)" }}>👁 보기</a>
                              {showFix && <button onClick={() => { const st = computeCareStatus(c); const cd = c.title_changed_at ? Math.floor((Date.now() - new Date(c.title_changed_at).getTime()) / 86400000) : 0; handleTrackedRepublish({ title: c.title || c.post_key, logNo: c.post_key, blogId: activeAccount?.blogId }, cd, st); }} style={{ flexShrink: 0, fontSize: 10.5, fontWeight: 800, color: "#fff", background: "linear-gradient(135deg,#8b5cf6,#a855f7)", border: "none", cursor: "pointer", padding: "4px 10px", borderRadius: 7, fontFamily: "inherit" }}>✏️ 고치기</button>}
                            </div>
                          ); })}
                        {items.length > 50 && <div style={{ fontSize: 10.5, color: "var(--text3)", textAlign: "center", paddingTop: 6 }}>+ {items.length - 50}개 더</div>}
                      </div>
                    );
                    return (
                      <div style={{ marginBottom: 14, padding: "16px 18px", borderRadius: 14, background: "linear-gradient(135deg, rgba(0,200,150,.08), rgba(139,92,246,.05))", border: "1px solid rgba(0,200,150,.25)" }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                          {/* ★ 상대경로 + onError 폴백(Electron file://에서 절대경로면 깨짐 — 크롤링서 겪은 이슈 반복 방지) */}
                          <img src={dodoImg} alt="주치의 도도" onError={e => { const s = document.createElement("div"); s.textContent = "🩺"; s.style.cssText = "font-size:38px;line-height:1"; e.currentTarget.replaceWith(s); }} style={{ width: 46, height: 46, objectFit: "contain", flexShrink: 0, filter: "drop-shadow(0 4px 8px rgba(0,200,150,.3))" }} />
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontSize: 14, fontWeight: 850, color: "var(--text)", marginBottom: 3 }}>🩺 오늘의 회진</div>
                            <div style={{ fontSize: 12.5, color: "var(--text2)", lineHeight: 1.55 }}>
                              {todo > 0
                                ? <>지금 손볼 글이 <b style={{ color: "#f59e0b" }}>{todo}개</b> 있어요{cnt.indexing > 0 && <> · <b style={{ color: "#0ea5e9" }}>{cnt.indexing}개</b>는 색인 대기라 기다리면 돼요</>}{cnt.observing > 0 && <> · <b style={{ color: "#8b5cf6" }}>{cnt.observing}개</b>는 관찰 중</>}. 하나씩 개선안을 받아보세요.</>
                                : cnt.indexing > 0
                                  ? <><b style={{ color: "#0ea5e9" }}>{cnt.indexing}개</b>가 색인 대기 중이에요. 발행한 지 얼마 안 된 글은 네이버가 아직 읽는 중이라, {INDEX_GRACE_DAYS}일쯤 기다리면 돼요 🕐{cnt.observing > 0 && <> · <b style={{ color: "#8b5cf6" }}>{cnt.observing}개</b>는 관찰 중</>}</>
                                  : cnt.observing > 0
                                    ? <><b style={{ color: "#8b5cf6" }}>{cnt.observing}개</b>가 관찰 중이에요. 지금은 손대지 말고 기다리면 돼요 🌱</>
                                    : <>지금 손볼 글이 없어요. 아주 잘 관리되고 있어요 👍</>}
                            </div>
                          </div>
                        </div>
                        {(todo > 0 || cnt.indexing > 0 || cnt.observing > 0 || cnt.cured > 0) && (
                          <>
                            <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
                              {todo > 0 && clickChip("todo", "rgba(245,158,11,.14)", "#f59e0b", `🚑 치료 필요 ${todo}`)}
                              {cnt.indexing > 0 && clickChip("indexing", "rgba(14,165,233,.14)", "#0ea5e9", `🕐 색인 대기 ${cnt.indexing}`)}
                              {cnt.observing > 0 && clickChip("observing", "rgba(139,92,246,.14)", "#8b5cf6", `🌱 관찰 중 ${cnt.observing}`)}
                              {cnt.cured > 0 && clickChip("cured", "rgba(0,200,150,.14)", "#00c896", `✅ 완치 ${cnt.cured}`)}
                            </div>
                            <div style={{ fontSize: 10.5, color: "var(--text3)", marginTop: 6 }}>👆 눌러서 어떤 글인지 확인하세요{autoViewsLoading && <span style={{ color: "#0ea5e9", fontWeight: 700 }}> · 🔄 조회수 자동 수집 중…</span>}</div>
                            {/* 클릭한 칩의 글 리스트 */}
                            {careListOpen === "todo" && careList(byStatus.todo, "치료할 글이 없어요 👍", true)}
                            {careListOpen === "indexing" && <>
                              <div style={{ fontSize: 10.5, color: "var(--text2)", marginTop: 8, padding: "8px 10px", borderRadius: 9, background: "rgba(14,165,233,.08)", border: "1px solid rgba(14,165,233,.25)", lineHeight: 1.55 }}>🕐 발행한 지 <b>{INDEX_GRACE_DAYS}일이 안 된</b> 글이에요. 네이버가 아직 <b>색인·순위를 매기는 중</b>이라 지금 미노출인 건 정상이에요. <b style={{ color: "#0ea5e9" }}>제목을 바꾸지 말고</b> 조금만 기다려 주세요 — {INDEX_GRACE_DAYS}일이 지나도 안 뜨면 그때 '치료 필요'로 올라와요.</div>
                              {careList(byStatus.indexing, "색인 대기 중인 글이 없어요")}
                            </>}
                            {careListOpen === "observing" && careList(byStatus.observing, "관찰 중인 글이 없어요")}
                            {careListOpen === "cured" && <>
                              <div style={{ fontSize: 10.5, color: "var(--text2)", marginTop: 8, padding: "8px 10px", borderRadius: 9, background: "rgba(14,165,233,.08)", border: "1px solid rgba(14,165,233,.25)", lineHeight: 1.55 }}>✅ 완치=검색 100위 안에 뜬다는 뜻이에요. 하지만 <b style={{ color: "#ef4444" }}>조회 0</b>이면 노출돼도 안 읽히는 거예요 — <b>제목·썸네일을 더 끌리게</b> 바꾸면 조회수가 올라요. (100위 진입이 끝이 아니에요!)</div>
                              {careList(byStatus.cured, "아직 완치된 글이 없어요")}
                            </>}
                          </>
                        )}
                        {total > 1 && (
                          <div style={{ marginTop: 14 }}>
                            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", fontSize: 11.5, marginBottom: 5 }}>
                              <span style={{ color: "var(--text2)", fontWeight: 700 }}>🔎 검색 노출률</span>
                              <span style={{ color: "#00c896", fontWeight: 800 }}>{rate}%</span>
                            </div>
                            <div style={{ height: 8, borderRadius: 99, background: "var(--bg)", overflow: "hidden", border: "1px solid var(--border)" }}>
                              <div style={{ height: "100%", width: `${rate}%`, borderRadius: 99, background: "linear-gradient(90deg,#00c896,#8b5cf6)", transition: "width .6s ease" }} />
                            </div>
                            <div style={{ fontSize: 10.5, color: "var(--text3)", marginTop: 5, lineHeight: 1.5 }}>제목 안 바꾼 글 <b>{total}개</b> 중 <b style={{ color: "#00c896" }}>{cnt.cured}개</b>가 검색 100위 안에 떠요. 나머지 <b style={{ color: "#f59e0b" }}>{todo}개</b>는 손보면 노출될 수 있어요.</div>
                          </div>
                        )}
                      </div>
                    );
                  })()}

                  {/* 📋 AEO 형식 진단 — 내 글이 'AI가 인용하기 좋은 형식'인지 체크(도입요약·Q&A·구조화) */}
                  <div style={{ marginBottom: 20, padding: "16px", borderRadius: 14, background: "linear-gradient(135deg,rgba(124,58,237,.08),rgba(14,165,233,.06))", border: "1.5px solid rgba(124,58,237,.3)" }}>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, flexWrap: "wrap", marginBottom: 6 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <span style={{ fontSize: 18 }}>📋</span>
                        <div style={{ fontSize: 14, fontWeight: 850, color: "#7c3aed" }}>AI 검색 최적화(AEO) 형식 진단</div>
                      </div>
                      <button onClick={runAeoCheck} disabled={aeoLoading}
                        style={{ padding: "6px 13px", borderRadius: 9, border: "none", background: aeoLoading ? "#8a8a99" : "linear-gradient(135deg,#7c3aed,#0ea5e9)", color: "#fff", fontSize: 12, fontWeight: 800, cursor: aeoLoading ? "default" : "pointer", fontFamily: "inherit" }}>
                        {aeoLoading ? "진단 중..." : aeoResults.length ? "다시 진단" : "내 글 진단하기"}
                      </button>
                    </div>
                    <div style={{ fontSize: 12, color: "var(--text2)", lineHeight: 1.65, marginBottom: 10, fontWeight: 500 }}>
                      네이버 <b>AI 브리핑·Cue:</b>가 답변에 <b>내 글을 인용</b>하려면 글이 특정 형식이어야 해요. 최근 글이 <b style={{ color: "#7c3aed" }}>①도입부 핵심요약 ②자주 묻는 질문(Q&amp;A) ③목록·구조화</b> 3가지를 갖췄는지 실제 본문을 읽어 체크해요. <span style={{ color: "var(--text3)" }}>(앞으로 퍼블리로 쓰는 글은 이 형식이 자동 적용돼요)</span>
                    </div>
                    {aeoResults.length > 0 && (() => {
                      const diagnosed = aeoResults.filter(r => !r.error);
                      const avg = diagnosed.length ? Math.round(diagnosed.reduce((s, r) => s + r.passed, 0) / diagnosed.length / 3 * 100) : 0;
                      return (
                      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                        <div style={{ fontSize: 12, fontWeight: 800, color: avg >= 67 ? "#00a878" : avg >= 34 ? "#f59e0b" : "#ef4444" }}>
                          {diagnosed.length ? <>평균 AEO 점수 {avg}점 · {diagnosed.length}개 글 진단 {avg < 67 && <span style={{ color: "var(--text3)", fontWeight: 600 }}>— 형식만 손보면 AI 노출 기회가 커져요</span>}</> : "진단할 본문을 읽지 못했어요"}
                        </div>
                        {(() => {
                          const eligible=aeoResults.filter(r=>!r.error&&r.passed<3);
                          const allOn=eligible.length>0&&eligible.every(r=>reviveChecked.has(r.logNo));
                          return eligible.length>0&&(
                            <div style={{display:"flex",alignItems:"center",gap:8,flexWrap:"wrap",padding:"10px 12px",borderRadius:10,background:"rgba(124,58,237,.07)",border:"1px solid rgba(124,58,237,.22)"}}>
                              <label style={{display:"flex",alignItems:"center",gap:6,fontSize:12,fontWeight:800,color:"var(--text2)",cursor:reviveBulk.running?"default":"pointer"}}>
                                <input type="checkbox" checked={allOn} disabled={reviveBulk.running} onChange={()=>setReviveChecked(allOn?new Set():new Set(eligible.map(r=>r.logNo)))} />
                                전체 선택 ({eligible.length}개)
                              </label>
                              <span style={{fontSize:11,color:"var(--text3)"}}>선택 {reviveChecked.size}개</span>
                              <button onClick={runBulkRevive} disabled={reviveBulk.running||reviveChecked.size===0}
                                style={{marginLeft:"auto",padding:"7px 13px",borderRadius:8,border:"none",background:reviveBulk.running||reviveChecked.size===0?"#8a8a99":"linear-gradient(135deg,#7c3aed,#a855f7)",color:"#fff",fontSize:11.5,fontWeight:850,cursor:reviveBulk.running||reviveChecked.size===0?"default":"pointer",fontFamily:"inherit"}}>
                                {reviveBulk.running?`자동 살리기 ${reviveBulk.done}/${reviveBulk.total}`:`✨ 선택 글 자동 살리기`}
                              </button>
                              {reviveBulk.running&&<button onClick={()=>{reviveBulkStopRef.current=true;window.dispatchEvent(new CustomEvent("publy-stop-revive-bulk"));}} style={{padding:"7px 11px",borderRadius:8,border:"1px solid #ef4444",background:"transparent",color:"#ef4444",fontSize:11.5,fontWeight:800,cursor:"pointer",fontFamily:"inherit"}}>현재 글 후 중단</button>}
                            </div>
                          );
                        })()}
                        {(reviveBulk.total>0)&&(
                          <div style={{padding:"9px 12px",borderRadius:9,background:reviveBulk.running?"rgba(14,165,233,.08)":reviveBulk.failed?"rgba(245,158,11,.08)":"rgba(0,168,120,.08)",fontSize:11.5,color:"var(--text2)",lineHeight:1.55}}>
                            <b>{reviveBulk.running?"🔄 자동 살리기 진행 중":"✅ 자동 살리기 작업 종료"}</b> · 처리 {reviveBulk.done}/{reviveBulk.total} · 성공 {reviveBulk.success} · 실패 {reviveBulk.failed}
                            {reviveBulk.current&&<div style={{marginTop:3,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>현재: {reviveBulk.current}</div>}
                          </div>
                        )}
                        {aeoResults.map((r, i) => (
                          <div key={i} style={{ padding: "10px 12px", borderRadius: 10, background: "var(--bg)", border: "1px solid var(--border)" }}>
                            <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:6}}>
                              {!r.error&&r.passed<3&&<input type="checkbox" aria-label={`${r.title} 선택`} checked={reviveChecked.has(r.logNo)} disabled={reviveBulk.running} onChange={()=>setReviveChecked(prev=>{const next=new Set(prev);next.has(r.logNo)?next.delete(r.logNo):next.add(r.logNo);return next;})} />}
                              <div style={{ minWidth:0,fontSize: 12.5, fontWeight: 700, color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.title}</div>
                            </div>
                            {r.error ? <div style={{ fontSize: 11, fontWeight: 700, color: "#f59e0b" }}>⚠️ 본문 조회 실패 — 잠시 후 다시 진단해주세요.</div> :
                            <div style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center" }}>
                              {r.checks.map(c => (
                                <span key={c.key} title={c.hint} style={{ fontSize: 11, fontWeight: 700, padding: "4px 9px", borderRadius: 8, background: c.ok ? "rgba(0,168,120,.12)" : "rgba(239,68,68,.1)", color: c.ok ? "#00a878" : "#ef4444", cursor: "help" }}>
                                  {c.ok ? "✅" : "❌"} {c.label}
                                </span>
                              ))}
                              {r.passed < 3 && (
                                <button disabled={!isUnlimitedPlan && reviveUsed >= reviveLimit} onClick={() => {
                                    if (!isUnlimitedPlan && reviveUsed >= reviveLimit) return alert(`오늘 이 글 살리기 한도(${reviveLimit}회)를 모두 사용했어요. 자정에 다시 사용할 수 있어요.`);
                                    if (!window.confirm(`"${r.title}"\n\n이 글을 AI가 좋은 품질로 새로 써서 그 글에 덮어쓸까요?\n(제목·본문·이미지가 모두 새로 교체돼요. 좋아요·주소는 유지)\n\n※ 새로 만든 품질이 낮으면 자동으로 덮어쓰기를 멈춰 원본을 지켜요.`)) return;
                                    // 블로그지수/제목수정에서 실제로 사용 중인 정확한 로그인 계정도 함께 넘긴다.
                                    // 네이버 로그인ID(bb9653)와 블로그ID(system-b)가 달라도 글살리기가 같은 계정 세션을 그대로 사용한다.
                                    const accepted = window.dispatchEvent(new CustomEvent("publy-revive-post", { cancelable: true, detail: { logNo: r.logNo, title: r.title, blogId: activeAccount?.blogId, naverId: activeAccount?.id, careAccountId: activeAccount?.accountId } }));
                                    if (accepted) alert("원터치 탭에서 '글 살리기'가 진행돼요. 창을 닫지 말고 기다려 주세요.");
                                  }}
                                  style={{ marginLeft: "auto", flexShrink: 0, fontSize: 11, fontWeight: 800, color: "#fff", background: !isUnlimitedPlan && reviveUsed >= reviveLimit ? "#8a8a99" : "linear-gradient(135deg,#7c3aed,#a855f7)", border: "none", cursor: !isUnlimitedPlan && reviveUsed >= reviveLimit ? "not-allowed" : "pointer", padding: "5px 11px", borderRadius: 8, fontFamily: "inherit", opacity: !isUnlimitedPlan && reviveUsed >= reviveLimit ? .65 : 1 }}>
                                  {!isUnlimitedPlan && reviveUsed >= reviveLimit ? `🔒 오늘 ${reviveLimit}회 사용` : `✨ 이 글 살리기 (${isUnlimitedPlan ? "무제한" : `${reviveUsed}/${reviveLimit}`})`}
                                </button>
                              )}
                            </div>
                            }
                          </div>
                        ))}
                        <div style={{ fontSize: 11, color: "var(--text3)", lineHeight: 1.6, marginTop: 2 }}>❌ 항목에 마우스를 올리면 어떻게 고치는지 알려줘요. <b style={{ color: "#7c3aed" }}>✨ 이 글 살리기</b>를 누르면 AI가 좋은 품질로 새로 써서 그 글에 덮어써요(제목·본문·이미지 교체, 좋아요·주소 유지). 제목만 손보려면 위 <b>재발행</b>을 쓰세요.</div>
                      </div>
                      );
                    })()}
                  </div>

                  {/* ♻️ 오래된 글 재발행 알림 — 누적 저장분(순환 검사로 며칠에 걸쳐 전체 커버) + 기간 설정 */}
                  {(() => {
                    const now = Date.now();
                    void rpTick;   // 🔄 새로고침 트리거(계정 바꾸거나 새로고침 누르면 다시 계산)
                    let store: Record<string, any> = {};
                    try { store = JSON.parse(localStorage.getItem("publy_republish_targets") || "{}"); } catch {}
                    // ★★소스 = 방금 검사한 결과(exposureChecks)의 미노출 글 + store(예전 누적 캐시) 합침.
                    //   방금 검사한 미노출 글은 blogId 매칭 안 따지고 무조건 포함(같은 계정으로 검사한 거니까) → "일자 지정하면 다 나온다".
                    const abid = (activeAccount?.blogId || "").toLowerCase();
                    const merged: Record<string, any> = {};
                    // 1) store(누적) — 현재 계정 것만(다른 계정 글 섞임 방지)
                    for (const t of Object.values(store) as any[]) {
                      if (!t.logNo) continue;
                      if (abid && t.blogId && String(t.blogId).toLowerCase() !== abid) continue;
                      merged[t.logNo] = t;
                    }
                    // 2) 방금 검사 결과의 미노출 글 — 발행날짜(scPosts)까지 붙여 무조건 포함
                    const dateByLogNow: Record<string,string> = {};
                    scPosts.forEach(p => { const ln = scLogNo(p.url); if (ln) dateByLogNow[ln] = p.date; });
                    for (const c of (scResult?.exposureChecks || [])) {
                      if (!c.logNo) continue;
                      if (c.exposed === false) merged[c.logNo] = { logNo: c.logNo, title: c.title, date: (c as any).date || dateByLogNow[String(c.logNo)] || "", blogId: activeAccount?.blogId || "", at: now };
                      else if (c.exposed === true) delete merged[c.logNo];
                    }
                    // 기간 필터: '구간'(겹치지 않음) — 선택한 밴드 [min, max)에 든 글만. 15~30/30~60/60~90/90+ 가 서로 다른 글을 보여줌.
                    const band = REPUBLISH_BANDS.find(b => b.k === republishBand) || REPUBLISH_BANDS[0];
                    // 🕐 색인 대기(발행 14일 이내) 글 수 — 안내용. 아직 판단하지 않는 갓 쓴 글(제목변경 재촉 금지).
                    const indexingCount = Object.values(merged).filter((t: any) => {
                      if (!t.date) return false;
                      const a = (now - new Date(t.date).getTime()) / 86400000;
                      return Number.isFinite(a) && a >= 0 && a < INDEX_GRACE_DAYS;
                    }).length;
                    const list = Object.values(merged).filter((t: any) => {
                        const ageDays = t.date ? (now - new Date(t.date).getTime()) / 86400000 : NaN;
                        if (!Number.isFinite(ageDays)) return band.k === "90plus";   // 날짜 모르는 옛 글 = '90일 이상' 구간에만(오래된 걸로 간주)
                        if (ageDays < INDEX_GRACE_DAYS) return false;                 // 🕐 색인 대기는 재발행 목록에서 제외
                        return ageDays >= band.min && ageDays < band.max;
                      })
                      // ★관찰중(이미 제목 바꿔 지켜보는) 글은 재발행 목록에 안 뜸 → '수정 추적'에서만 다시 변경(테리 확정)
                      .filter((t: any) => { const care = t.logNo ? careMap[t.logNo] : null; return !(care && computeCareStatus(care).status === "observing"); })
                      .sort((a: any, b: any) => new Date(a.date || 0).getTime() - new Date(b.date || 0).getTime());
                    return (
                      <div style={{ marginBottom: 20, padding: "16px", borderRadius: 14, background: "rgba(245,158,11,.08)", border: "1.5px solid rgba(245,158,11,.4)" }}>
                        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, flexWrap: "wrap", marginBottom: 6 }}>
                          <div style={{ fontSize: 14, fontWeight: 850, color: "#f59e0b" }}>♻️ 오래된 글 재발행 추천 <span style={{ fontSize: 11, fontWeight: 700, color: "var(--text3)" }}>{list.length}개</span></div>
                          {/* 새로고침 + 기간 설정 */}
                          <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
                            <button onClick={() => {
                                setRpTick(t => t + 1);
                                setRpSpin(true); setTimeout(() => setRpSpin(false), 600);   // 눌린 느낌(회전)
                                addScLog(`🔄 재발행 목록 새로고침 — ${list.length}개`);        // 눌린 확인(로그)
                              }}
                              title="목록 새로고침(계정 바꾼 뒤 눌러요)"
                              style={{ padding: "3px 9px", borderRadius: 7, border: "1.5px solid var(--border)", background: rpSpin ? "rgba(245,158,11,.15)" : "transparent", color: rpSpin ? "#f59e0b" : "var(--text3)", cursor: "pointer", fontSize: 10.5, fontWeight: 800, fontFamily: "inherit", transition: "all .15s" }}
                              onMouseDown={e => (e.currentTarget.style.transform = "scale(.92)")}
                              onMouseUp={e => (e.currentTarget.style.transform = "scale(1)")}
                              onMouseLeave={e => (e.currentTarget.style.transform = "scale(1)")}>
                              <span style={{ display: "inline-block", transition: "transform .6s", transform: rpSpin ? "rotate(360deg)" : "none" }}>🔄</span> 새로고침
                            </button>
                            <span style={{ fontSize: 10.5, color: "var(--text3)", fontWeight: 700, marginLeft: 4 }}>쓴 지</span>
                            {/* 구간 버튼(누적 아님) — 각 버튼이 서로 안 겹치는 구간이라 눌러보면 다른 글이 떠요. */}
                            {REPUBLISH_BANDS.map(b => {
                              const on = republishBand === b.k;
                              return (
                              <button key={b.k} onClick={() => { setRepublishBand(b.k); localStorage.setItem("publy_republish_band", b.k); }}
                                title={`발행한 지 ${b.label} 된(그 구간의) 미노출 글만 — 다른 구간과 안 겹쳐요`}
                                style={{ padding: "3px 9px", borderRadius: 7, border: `1.5px solid ${on?"#f59e0b":"var(--border)"}`, background: on?"rgba(245,158,11,.15)":"transparent", color: on?"#f59e0b":"var(--text3)", cursor: "pointer", fontSize: 10.5, fontWeight: 800, fontFamily: "inherit" }}>{b.label}</button>
                            );})}
                          </div>
                        </div>
                        <div style={{ fontSize: 12, color: "var(--text2)", lineHeight: 1.7, marginBottom: 10, fontWeight: 500 }}>발행한 지 <b>{band.label}</b> 됐는데도 네이버 검색에 안 나오는 글이에요. 이런 글은 <b style={{ color: "#f59e0b" }}>제목만 바꿔서 다시 올리면</b> 검색에 뜰 기회가 다시 생겨요.<br/>아래에서 <b>AI가 추천한 새 제목</b>을 받아서 <b>제목 변경하러 가기</b>만 누르면, 알아서 제목을 바꿔 다시 발행해줘요.</div>
                        {/* 🕐 색인 대기 안내 — 갓 쓴 글은 여기 안 뜨고 기다린다고 알림(제목변경 재촉 오해 방지) */}
                        {indexingCount > 0 && (
                          <div style={{ fontSize: 11.5, color: "#0ea5e9", lineHeight: 1.6, marginBottom: 10, padding: "9px 12px", borderRadius: 8, background: "rgba(14,165,233,.08)", border: "1px solid rgba(14,165,233,.25)", fontWeight: 600 }}>
                            🕐 발행한 지 <b>{INDEX_GRACE_DAYS}일이 안 된 글 {indexingCount}개</b>는 여기 안 넣었어요. 네이버가 아직 <b>색인·순위를 매기는 중</b>이라 지금 미노출인 건 정상이에요 — <b>제목 바꾸지 말고</b> 조금만 기다려 주세요.
                          </div>
                        )}
                        {/* ★ 미노출 기준 — 디테일 설명(테리 요청) */}
                        <div style={{ fontSize: 11, color: "var(--text3)", lineHeight: 1.65, marginBottom: 12, padding: "9px 12px", borderRadius: 8, background: "rgba(245,158,11,.06)", border: "1px solid rgba(245,158,11,.2)" }}>
                          <b style={{ color: "#f59e0b" }}>🔎 '미노출'이 뭔가요?</b> 이 글의 제목으로 네이버 통합검색(블로그탭)을 돌렸을 때 <b>상위 100위 안에 내 글이 안 나오는</b> 상태예요. 100위 밖이면 사실상 <b>검색 유입이 거의 0</b> — 저품질·누락이 의심돼요. 그래서 여기 모인 글은 <b>제목·키워드를 바꿔 다시 검색 기회를 주는</b> 대상이에요. <span style={{ color: "var(--text2)" }}>(이미 100위 안에 뜨는 글은 여기 안 나와요 — 그건 아래 '제목·키워드 살리기 솔루션'에서 더 위로 올려요.)</span>
                        </div>
                        {/* 🚀 체크해서 선택한 글만 한 번에 제목 변경 — 전체선택 or 개별 체크 */}
                        {(list as any[]).length > 0 && (() => {
                          const pageLogNos = (list as any[]).slice(0, republishShow).map(t => t.logNo).filter(Boolean);
                          const allChecked = pageLogNos.length > 0 && pageLogNos.every(ln => rpChecked.has(ln));
                          const pickedItems = (list as any[]).filter(t => t.logNo && rpChecked.has(t.logNo));
                          return (
                            <div style={{ marginBottom: 12, padding: "12px 14px", borderRadius: 10, background: "rgba(139,92,246,.08)", border: "1px solid rgba(139,92,246,.3)", display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                              <label style={{ display: "flex", alignItems: "center", gap: 7, cursor: "pointer", flexShrink: 0 }}>
                                <input type="checkbox" checked={allChecked} onChange={e => { setRpChecked(prev => { const n = new Set(prev); if (e.target.checked) pageLogNos.forEach(ln => n.add(ln)); else pageLogNos.forEach(ln => n.delete(ln)); return n; }); }} style={{ width: 17, height: 17, cursor: "pointer", accentColor: "#8b5cf6" }} />
                                <span style={{ fontSize: 12.5, fontWeight: 800, color: "#8b5cf6" }}>전체 선택</span>
                              </label>
                              <div style={{ flex: 1, minWidth: 140, fontSize: 11, color: "var(--text3)", lineHeight: 1.5 }}>
                                체크한 글의 제목을 <b>한 번에</b> — AI가 <b>글 내용을 읽고</b> 추천한 제목(2개 중 랜덤)으로 변경해요. 오늘 한도까지만 진행돼요.
                                {bulkRunning && <div style={{ color: "#8b5cf6", fontWeight: 700, marginTop: 3 }}>진행 {bulkProgress.done}/{bulkProgress.total}…</div>}
                              </div>
                              {bulkRunning
                                ? <button onClick={() => { bulkStopRef.current = true; addScLog("⏹ 중단 요청 — 지금 글까지만 끝내고 멈춰요..."); }} style={{ flexShrink: 0, padding: "9px 16px", borderRadius: 10, border: "none", background: bulkStopRef.current ? "#8a8a99" : "#d64545", color: "#fff", cursor: "pointer", fontSize: 12, fontWeight: 800, fontFamily: "inherit" }}>{bulkStopRef.current ? "멈추는 중..." : "⏹ 중단"}</button>
                                : <button onClick={() => runBulkRetitle(pickedItems as any)} disabled={!!titleEditingKey || pickedItems.length === 0} style={{ flexShrink: 0, padding: "9px 18px", borderRadius: 10, border: "none", background: pickedItems.length === 0 ? "var(--card2)" : "linear-gradient(135deg,#8b5cf6,#a855f7)", color: pickedItems.length === 0 ? "var(--text3)" : "#fff", cursor: pickedItems.length === 0 ? "default" : "pointer", fontSize: 12.5, fontWeight: 800, fontFamily: "inherit", boxShadow: pickedItems.length === 0 ? "none" : "0 4px 12px -4px rgba(139,92,246,.5)" }}>🚀 선택한 {pickedItems.length}개 제목 변경</button>}
                              {/* ⏱ 소요시간 안내 — 글 많으면 오래 걸림을 미리 알림(문의 방지) */}
                              <div style={{ flexBasis: "100%", fontSize: 11, color: "var(--text2)", lineHeight: 1.6, marginTop: 4, padding: "9px 12px", borderRadius: 8, background: "rgba(139,92,246,.08)", border: "1px solid rgba(139,92,246,.22)" }}>
                                ⏱ <b style={{ color: "#8b5cf6" }}>글이 많으면 시간이 오래 걸려요.</b> AI가 <b>글 내용을 하나하나 제대로 읽고</b> 제목을 만든 뒤, 계정 안전을 위해 <b>천천히</b> 바꾸기 때문이에요(글 1개당 대략 10~30초). 100개면 30분 넘게 걸릴 수 있어요.<br />✅ <b>작업 중에는 화면·컴퓨터가 꺼지지 않아요.</b> 창을 켜둔 채 그냥 두시면 알아서 끝까지 진행돼요. 중간에 멈추려면 <b>중단</b>을 누르세요(그때까지 바꾼 글은 저장돼요).
                              </div>
                            </div>
                          );
                        })()}
                        {list.length === 0
                          ? <div style={{ fontSize: 12, color: "var(--text3)" }}>발행한 지 <b>{band.label}</b> 된 미노출 글이 없어요. 위에서 <b>검색노출 검사</b>를 하면 미노출 글이 여기 모여요. (<b>다른 기간 버튼</b>도 눌러보세요 — 구간마다 다른 글이 떠요)</div>
                          : <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
                              {list.slice(0, republishShow).map((c: any, i) => {
                                const days = Math.floor((now - new Date(c.date).getTime())/86400000);
                                const busy = rpBusyLog === c.logNo;
                                const overLimit = !isUnlimitedPlan && titleEditUsed >= titleEditLimit;
                                const rpSol = c.logNo ? rpSolutions[c.logNo] : null;
                                // 🩺 이 글을 최근에 수정했나? 그렇다면 관찰기간(30일) 동안은 "기다리세요"로 무한루프 차단
                                const care = c.logNo ? careMap[c.logNo] : null;
                                const careSt = care ? computeCareStatus(care) : null;
                                const observing = careSt?.status === "observing";
                                return (
                                  <div key={i} style={{ background: "var(--bg)", border: `1px solid ${c.logNo && rpChecked.has(c.logNo) ? "rgba(139,92,246,.5)" : "var(--border)"}`, borderRadius: 10, overflow: "hidden" }}>
                                    <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "9px 12px" }}>
                                      {c.logNo && <input type="checkbox" checked={rpChecked.has(c.logNo)} onChange={e => setRpChecked(prev => { const n = new Set(prev); e.target.checked ? n.add(c.logNo) : n.delete(c.logNo); return n; })} title="이 글을 전체 변경 대상에 넣기" style={{ width: 16, height: 16, flexShrink: 0, cursor: "pointer", accentColor: "#8b5cf6" }} />}
                                      <span style={{ fontSize: 13 }}>{observing ? "🌱" : "⏳"}</span>
                                      <span style={{ flex: 1, minWidth: 0, fontSize: 12.5, color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.title}</span>
                                      {observing
                                        ? <span title="제목을 바꾼 지 얼마 안 됐어요. 네이버가 다시 읽고 순위를 매기는 데 보통 30일쯤 걸려요. 지금 또 바꾸면 오히려 손해예요 — 조금만 기다려주세요." style={{ flexShrink: 0, padding: "6px 11px", borderRadius: 8, background: "rgba(139,92,246,.12)", color: "#8b5cf6", fontSize: 11, fontWeight: 800, whiteSpace: "nowrap" }}>🌱 수정함 · {careSt!.daysLeft}일 뒤 재검사</span>
                                        : <>
                                            <span style={{ fontSize: 10.5, color: "#f59e0b", fontWeight: 800, whiteSpace: "nowrap" }}>{days}일째 미노출</span>
                                            <button onClick={() => handleRepublishOne(c)} disabled={busy || !!titleEditingKey || !c.logNo}
                                              style={{ flexShrink: 0, padding: "6px 11px", borderRadius: 8, border: "none", background: (busy || !c.logNo) ? "#8a8a99" : "#f59e0b", color: "#fff", fontSize: 11, fontWeight: 800, cursor: (busy || titleEditingKey || !c.logNo) ? "not-allowed" : "pointer", fontFamily: "inherit", whiteSpace: "nowrap", opacity: (busy || !c.logNo) ? .6 : 1 }}>
                                              {busy ? "개선안 만드는 중..." : rpSol ? "🔄 다시 받기" : "✏️ 개선안 받기"}
                                            </button>
                                          </>}
                                    </div>
                                    {/* 🩺 진료 이력 + 회복 그래프(순위 추이 스파크라인) — 검사가 쌓이면 나타남 */}
                                    {care && ((care.rank_history?.length || 0) > 1 || care.prescribed_at || care.title_changed_at) && (
                                      <div style={{ padding: "0 12px 9px", display: "flex", alignItems: "center", gap: 7, fontSize: 10.5, color: "var(--text3)", flexWrap: "wrap" }}>
                                        <span>🔍 검사 {care.rank_history?.length || 0}회</span>
                                        {care.prescribed_at && <span>· 💊 개선안</span>}
                                        {care.title_changed_at && <span>· ✍️ 수정함</span>}
                                        {(() => {
                                          const pts = (care.rank_history || []).filter(h => h.rank != null) as { date: string; rank: number }[];
                                          if (pts.length < 2) return null;
                                          const rs = pts.map(p => p.rank), mn = Math.min(...rs), mx = Math.max(...rs), W = 56, H = 16;
                                          const d = pts.map((p, i) => `${i ? "L" : "M"}${(pts.length > 1 ? i / (pts.length - 1) : 0) * W},${mx === mn ? H / 2 : ((p.rank - mn) / (mx - mn)) * H}`).join(" ");
                                          const improved = pts[pts.length - 1].rank <= pts[0].rank;   // 순위 숫자 작아짐 = 개선
                                          return <svg width={W} height={H} style={{ marginLeft: 4 }} aria-label="순위 추이"><path d={d} fill="none" stroke={improved ? "#00c896" : "#f59e0b"} strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" /></svg>;
                                        })()}
                                      </div>
                                    )}
                                    {rpSol && (() => {
                                      const ApplyBtn = ({ nt, k }: { nt: string; k: string }) => (
                                        <button onClick={() => handleApplyTitle(rpSol.original, nt, k, rpSol.logNo)} disabled={overLimit || !!titleEditingKey}
                                          style={{ flexShrink: 0, padding: "7px 12px", borderRadius: 8, border: "none", background: overLimit ? "#8a8a99" : "#00c896", color: "#fff", fontSize: 11.5, fontWeight: 800, cursor: (overLimit || titleEditingKey) ? "not-allowed" : "pointer", fontFamily: "inherit", whiteSpace: "nowrap", opacity: overLimit ? .6 : 1 }}>
                                          {titleEditingKey === k ? "변경 중..." : "제목 변경하러 가기"}
                                        </button>
                                      );
                                      return (
                                        <div style={{ padding: "12px", borderTop: "1px solid var(--border)", background: "rgba(139,92,246,.05)" }}>
                                          {rpSol.diagnosis && <div style={{ fontSize: 11.5, color: "#ff5fa2", fontWeight: 600, marginBottom: 10, lineHeight: 1.5 }}>🔍 {rpSol.diagnosis}</div>}
                                          <div style={{ fontSize: 11, color: "#00c896", fontWeight: 800, marginBottom: 4 }}>✅ 개선 제목 1</div>
                                          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: rpSol.newTitle2 ? 10 : 11, flexWrap: "wrap" }}>
                                            <div style={{ flex: "1 1 180px", minWidth: 0, fontSize: 14, fontWeight: 800, color: "var(--text)", lineHeight: 1.4 }}>{rpSol.newTitle}</div>
                                            <ApplyBtn nt={rpSol.newTitle} k={`rp-${rpSol.logNo}-1`} />
                                          </div>
                                          {rpSol.newTitle2 && <>
                                            <div style={{ fontSize: 11, color: "#00c896", fontWeight: 800, marginBottom: 4 }}>✅ 개선 제목 2</div>
                                            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 11, flexWrap: "wrap" }}>
                                              <div style={{ flex: "1 1 180px", minWidth: 0, fontSize: 13.5, fontWeight: 700, color: "var(--text2)", lineHeight: 1.4 }}>{rpSol.newTitle2}</div>
                                              <ApplyBtn nt={rpSol.newTitle2} k={`rp-${rpSol.logNo}-2`} />
                                            </div>
                                          </>}
                                          {rpSol.keywords.length > 0 && <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 8 }}>
                                            {rpSol.keywords.map((k, j) => <span key={j} style={{ padding: "3px 9px", borderRadius: 20, background: "rgba(139,92,246,.12)", color: "#a855f7", fontSize: 11, fontWeight: 700 }}># {k}</span>)}
                                          </div>}
                                          {rpSol.bodyTip && <div style={{ fontSize: 11.5, color: "var(--text2)", lineHeight: 1.5, fontWeight: 500, marginBottom: 4 }}>✏️ <b>본문 팁</b> · {rpSol.bodyTip}</div>}
                                          {rpSol.expectedEffect && <div style={{ fontSize: 11.5, color: "var(--text2)", lineHeight: 1.5, fontWeight: 500, padding: "7px 10px", borderRadius: 8, background: "rgba(0,200,150,.08)" }}>📈 <b style={{color:"#00c896"}}>기대 효과</b> · {rpSol.expectedEffect}</div>}
                                          {overLimit && <div style={{ fontSize: 11, color: "#f59e0b", fontWeight: 700, marginTop: 8 }}>⚠️ 오늘 제목 수정 한도를 다 썼어요. 자정에 초기화돼요.</div>}
                                        </div>
                                      );
                                    })()}
                                  </div>
                                );
                              })}
                              {list.length > republishShow && (
                                <button onClick={() => setRepublishShow(v => v + 12)} style={{ padding: "9px", borderRadius: 10, border: "1px dashed var(--border)", background: "transparent", color: "var(--text2)", cursor: "pointer", fontSize: 12, fontWeight: 700, fontFamily: "inherit" }}>
                                  ⬇️ {Math.min(12, list.length - republishShow)}개 더 보기 (남은 {list.length - republishShow}개)
                                </button>
                              )}
                            </div>}
                      </div>
                    );
                  })()}

                  {/* ✏️ 제목·키워드 살리기 솔루션 (AI 처방) — 이미 100위 안에 뜬 글을 '더 위로'(재발행과 기준 분리) */}
                  {exposureChecks.some(c => c.exposed === true && c.rank != null && c.rank <= 100) && (
                    <div style={{ marginBottom: 20, padding: "16px", borderRadius: 14, background: "linear-gradient(135deg,rgba(139,92,246,.1),rgba(255,95,162,.06))", border: "1.5px solid rgba(139,92,246,.3)" }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: scSolutions ? 14 : 0 }}>
                        <div>
                          <div style={{ fontSize: 14, fontWeight: 850, color: "#a855f7" }}>✏️ 제목·키워드 살리기 솔루션 <span style={{ fontSize: 10.5, fontWeight: 800, color: "#a855f7", background: "rgba(168,85,247,.14)", padding: "2px 8px", borderRadius: 20, marginLeft: 4 }}>100위 안</span></div>
                          <div style={{ fontSize: 11.5, color: "var(--text2)", marginTop: 3, fontWeight: 500, lineHeight: 1.55 }}><b style={{ color: "#a855f7" }}>이미 검색 100위 안에 뜨는 글</b>을 <b style={{color:"#ff5fa2"}}>AI가 더 위로 끌어올려</b>드려요. <span style={{ color: "var(--text3)" }}>(100위 밖 미노출 글은 위쪽 <b>'오래된 글 재발행'</b>에서 살려요 — 서로 안 겹쳐요.)</span></div>
                        </div>
                        <div style={{ display: "flex", gap: 8, flexShrink: 0, flexWrap: "wrap" }}>
                          <button onClick={() => handleGetSolutions(false)} disabled={scSolLoading || scSolAll} style={{ padding: "10px 16px", borderRadius: 10, border: "none", background: (scSolLoading||scSolAll) ? "var(--card2)" : "linear-gradient(135deg,#8b5cf6,#a855f7)", color: (scSolLoading||scSolAll) ? "var(--text2)" : "#fff", cursor: (scSolLoading||scSolAll) ? "default" : "pointer", fontSize: 12.5, fontWeight: 800, fontFamily: "inherit" }}>
                            {scSolLoading && !scSolAll ? "AI 분석 중..." : "✨ 10개 받기"}
                          </button>
                          <button onClick={handleGetAllSolutions} disabled={scSolLoading || scSolAll} style={{ padding: "10px 16px", borderRadius: 10, border: "none", background: (scSolLoading||scSolAll) ? "var(--card2)" : "linear-gradient(135deg,#f59e0b,#ff5fa2)", color: (scSolLoading||scSolAll) ? "var(--text2)" : "#fff", cursor: (scSolLoading||scSolAll) ? "default" : "pointer", fontSize: 12.5, fontWeight: 800, fontFamily: "inherit", boxShadow: (scSolLoading||scSolAll) ? "none" : "0 3px 10px rgba(245,158,11,.35)" }}>
                            {scSolAll ? "🚀 전체 받는 중..." : "🚀 전체 받기"}
                          </button>
                        </div>
                      </div>
                      {scSolutions && (() => {
                        const sq = scSolSearch.trim().toLowerCase();
                        const solFiltered = sq ? scSolutions.filter(s => (s.original || "").toLowerCase().includes(sq)) : scSolutions;
                        const PER = 5; const totalPages = Math.max(1, Math.ceil(solFiltered.length / PER));
                        const page = Math.min(scSolPage, totalPages - 1);
                        const shown = solFiltered.slice(page * PER, page * PER + PER);
                        return (
                        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                          <div style={{ fontSize: 11.5, color: "var(--text3)", fontWeight: 600 }}>총 {scSolutions.length}개 글의 개선안 · {page + 1}/{totalPages} 페이지</div>
                          <input className="inp" value={scSolSearch} onChange={e => { setScSolSearch(e.target.value); setScSolPage(0); }} placeholder="🔍 원래 제목으로 검색..." style={{ fontSize: 12.5, padding: "9px 12px" }} />
                          {solFiltered.length === 0 && <div style={{ fontSize: 12, color: "var(--text3)", padding: "16px 0", textAlign: "center" }}>검색 결과가 없어요.</div>}
                          {shown.map((s, i) => {
                            // 카드마다 색을 순환시켜 눈에 잘 띄게(왼쪽 컬러 바 + 살짝 톤)
                            const palette = ["#8b5cf6", "#f59e0b", "#00c896", "#00b8d4", "#ff5fa2"];
                            const accent = palette[(page * PER + i) % palette.length];
                            return (
                            <div key={i} style={{ padding: "15px 16px", borderRadius: 13, background: "var(--card)", border: "1px solid var(--border)", borderLeft: `4px solid ${accent}` }}>
                              <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6 }}>
                                <span style={{ fontSize: 10.5, fontWeight: 900, color: "#fff", background: accent, borderRadius: 6, padding: "2px 7px" }}>{page * PER + i + 1}</span>
                                <div style={{ flex: 1, minWidth: 0, fontSize: 12.5, color: "var(--text3)", textDecoration: "line-through", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s.original}</div>
                              </div>
                              {s.diagnosis && <div style={{ fontSize: 11.5, color: "#ff5fa2", fontWeight: 600, marginBottom: 11, lineHeight: 1.5 }}>🔍 {s.diagnosis}</div>}
                              {(() => {
                                const hasLogNo = !!s.logNo || !!(scResult?.exposureChecks || []).find(c => c.title === s.original)?.logNo;
                                const overLimit = !isUnlimitedPlan && titleEditUsed >= titleEditLimit;
                                const ApplyBtn = ({ nt, k }: { nt: string; k: string }) => (
                                  <button onClick={() => handleApplyTitle(s.original, nt, k, s.logNo)} disabled={!hasLogNo || overLimit || !!titleEditingKey}
                                    style={{ flexShrink: 0, padding: "7px 12px", borderRadius: 8, border: "none", background: (!hasLogNo || overLimit) ? "#8a8a99" : "#00c896", color: "#fff", fontSize: 11.5, fontWeight: 800, cursor: (!hasLogNo || overLimit || titleEditingKey) ? "not-allowed" : "pointer", fontFamily: "inherit", whiteSpace: "nowrap", opacity: (!hasLogNo || overLimit) ? 0.6 : 1 }}>
                                    {titleEditingKey === k ? "변경 중..." : (!hasLogNo ? "글 번호 없음" : "제목 변경하러 가기")}
                                  </button>
                                );
                                return (<>
                                  <div style={{ fontSize: 11, color: "#00c896", fontWeight: 800, marginBottom: 4 }}>✅ 개선 제목 1</div>
                                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: s.newTitle2 ? 10 : 11, flexWrap: "wrap" }}>
                                    <div style={{ flex: "1 1 180px", minWidth: 0, fontSize: 14.5, fontWeight: 800, color: "var(--text)", lineHeight: 1.4 }}>{s.newTitle}</div>
                                    <ApplyBtn nt={s.newTitle} k={`${i}-1`} />
                                  </div>
                                  {s.newTitle2 && <>
                                    <div style={{ fontSize: 11, color: "#00c896", fontWeight: 800, marginBottom: 4 }}>✅ 개선 제목 2</div>
                                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 11, flexWrap: "wrap" }}>
                                      <div style={{ flex: "1 1 180px", minWidth: 0, fontSize: 14, fontWeight: 700, color: "var(--text2)", lineHeight: 1.4 }}>{s.newTitle2}</div>
                                      <ApplyBtn nt={s.newTitle2} k={`${i}-2`} />
                                    </div>
                                  </>}
                                </>);
                              })()}
                              {s.keywords.length > 0 && (
                                <><div style={{ fontSize: 11, color: "var(--text3)", fontWeight: 700, marginBottom: 5 }}>넣으면 좋은 키워드</div>
                                <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 11 }}>
                                  {s.keywords.map((k, j) => <span key={j} style={{ padding: "4px 10px", borderRadius: 20, background: "rgba(139,92,246,.12)", color: "#a855f7", fontSize: 11.5, fontWeight: 700 }}># {k}</span>)}
                                </div></>
                              )}
                              {s.bodyTip && <div style={{ fontSize: 12, color: "var(--text2)", lineHeight: 1.55, fontWeight: 500, marginBottom: 6 }}>✏️ <b>본문 팁</b> · {s.bodyTip}</div>}
                              {s.expectedEffect && <div style={{ fontSize: 12, color: "var(--text2)", lineHeight: 1.55, fontWeight: 500, padding: "8px 11px", borderRadius: 9, background: "rgba(0,200,150,.08)" }}>📈 <b style={{color:"#00c896"}}>기대 효과</b> · {s.expectedEffect}</div>}
                            </div>
                          );})}
                          {totalPages > 1 && (
                            <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8, marginTop: 4 }}>
                              <button onClick={() => setScSolPage(Math.max(0, page - 1))} disabled={page === 0} style={{ padding: "7px 14px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--bg)", color: page === 0 ? "var(--text3)" : "var(--text2)", cursor: page === 0 ? "default" : "pointer", fontSize: 12, fontWeight: 700, fontFamily: "inherit" }}>← 이전</button>
                              <span style={{ fontSize: 12, color: "var(--text2)", fontWeight: 700 }}>{page + 1} / {totalPages}</span>
                              <button onClick={() => setScSolPage(Math.min(totalPages - 1, page + 1))} disabled={page >= totalPages - 1} style={{ padding: "7px 14px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--bg)", color: page >= totalPages - 1 ? "var(--text3)" : "var(--text2)", cursor: page >= totalPages - 1 ? "default" : "pointer", fontSize: 12, fontWeight: 700, fontFamily: "inherit" }}>다음 →</button>
                            </div>
                          )}
                          {(() => {
                            const totalMissing = (scResult?.exposureChecks || []).filter(c => c.exposed === false).length;
                            const remain = totalMissing - scSolutions.length;
                            const pct = totalMissing ? Math.round((scSolutions.length / totalMissing) * 100) : 0;
                            return remain > 0 ? (
                              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                                {/* 진행률 바 — 전체 대비 얼마나 받았나 눈에 띄게 */}
                                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                                  <div style={{ flex: 1, height: 8, borderRadius: 99, background: "rgba(139,92,246,.15)", overflow: "hidden" }}>
                                    <div style={{ width: `${pct}%`, height: "100%", borderRadius: 99, background: "linear-gradient(90deg,#8b5cf6,#f59e0b,#ff5fa2)", transition: "width .4s" }} />
                                  </div>
                                  <span style={{ fontSize: 11, fontWeight: 800, color: "#a855f7", whiteSpace: "nowrap" }}>{scSolutions.length}/{totalMissing} ({pct}%)</span>
                                </div>
                                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                                  <button onClick={() => handleGetSolutions(true)} disabled={scSolLoading || scSolAll}
                                    style={{ flex: "1 1 140px", padding: "11px", borderRadius: 10, border: "1.5px dashed #a855f7", background: "rgba(139,92,246,.08)", color: "#a855f7", cursor: (scSolLoading||scSolAll) ? "default" : "pointer", fontSize: 12.5, fontWeight: 800, fontFamily: "inherit" }}>
                                    {scSolLoading && !scSolAll ? "만드는 중..." : `➕ ${Math.min(10, remain)}개 더 받기`}
                                  </button>
                                  <button onClick={handleGetAllSolutions} disabled={scSolLoading || scSolAll}
                                    style={{ flex: "1 1 140px", padding: "11px", borderRadius: 10, border: "none", background: (scSolLoading||scSolAll) ? "var(--card2)" : "linear-gradient(135deg,#f59e0b,#ff5fa2)", color: (scSolLoading||scSolAll) ? "var(--text2)" : "#fff", cursor: (scSolLoading||scSolAll) ? "default" : "pointer", fontSize: 12.5, fontWeight: 800, fontFamily: "inherit", boxShadow: (scSolLoading||scSolAll) ? "none" : "0 3px 10px rgba(245,158,11,.35)" }}>
                                    {scSolAll ? "🚀 전체 받는 중..." : `🚀 남은 ${remain}개 전체 받기`}
                                  </button>
                                </div>
                              </div>
                            ) : (
                              <div style={{ fontSize: 12, fontWeight: 800, color: "#00c896", textAlign: "center", padding: "6px" }}>✅ 누락된 글 {totalMissing}개 개선안을 모두 받았어요!</div>
                            );
                          })()}
                          <div style={{ fontSize: 10.5, color: "var(--text3)", lineHeight: 1.5 }}>AI 제안이에요. 내 블로그에서 실제로 검색 상위에 오른 제목 패턴을 학습해 만든 처방이라, 참고해서 제목·본문을 다듬으면 노출에 도움이 돼요.</div>
                        </div>
                        );
                      })()}
                    </div>
                  )}

                  {/* 방문자 통계 */}
                  <div style={{ marginBottom: 20, padding: "16px", borderRadius: 14, background: "var(--bg)", border: "1px solid var(--border)" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                      <div style={{ fontSize: 14, fontWeight: 850 }}>👥 최근 방문자</div>
                      {scResult.visitorDrop && <b style={{ fontSize: 12, color: scResult.visitorDrop.detected ? "#ef4444" : "var(--text2)" }}>{scResult.visitorDrop.detected ? "⚠️ " : ""}{scResult.visitorDrop.message}</b>}
                    </div>
                    <HelpLine>네이버 공개 방문자 통계로 <b>최근 며칠간 일별 방문자 수</b>를 보여줘요. 갑자기 <b style={{ color: "#ef4444" }}>확 줄면(급감)</b> 저품질·검색 순위 하락 신호일 수 있어요.</HelpLine>
                    {visitorDays.length ? <div style={{ display: "flex", height: 92, alignItems: "flex-end", gap: 7, marginBottom: 14 }}>
                      {visitorDays.map(day => <div key={day.date} style={{ flex: 1, minWidth: 0, textAlign: "center" }}>
                        <div style={{ fontSize: 10, fontWeight: 800, marginBottom: 4 }}>{day.visitors.toLocaleString()}</div>
                        <div title={`${day.date} ${day.visitors.toLocaleString()}명`} style={{ height: Math.max(4, (day.visitors / maxVisitors) * 55), borderRadius: "5px 5px 2px 2px", background: scResult.visitorDrop?.detected && day === visitorDays[visitorDays.length - 1] ? "#ef4444" : "#00b8d4" }} />
                        <div style={{ fontSize: 9.5, color: "var(--text3)", marginTop: 4 }}>{day.date.slice(5).replace("-", "/")}</div>
                      </div>)}
                    </div> : <div style={{ fontSize: 12, color: "var(--text3)", marginBottom: 12 }}>관리자 통계에서 일별 방문자를 읽지 못했어요.</div>}
                    <div style={{ fontSize: 12, fontWeight: 800, marginBottom: 2 }}>유입 검색어 TOP</div>
                    <HelpLine>사람들이 <b>어떤 검색어로 내 블로그에 들어왔는지</b> 순위예요. 내가 실제로 뭘로 노출되는지 알면, <b>그 주제를 더 키워서</b> 방문자를 늘릴 수 있어요.</HelpLine>
                    {(scResult.inflowKeywords || []).length ? <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>{(scResult.inflowKeywords || []).map((item, i) => <span key={`${item.keyword}-${i}`} style={{ padding: "5px 9px", borderRadius: 20, background: "rgba(0,184,212,.1)", color: "var(--text2)", fontSize: 11.5, fontWeight: 650 }}>{i + 1}. {item.keyword}{item.count !== undefined ? ` · ${item.count}` : ""}</span>)}</div> : <div style={{ fontSize: 12, color: "var(--text3)" }}>유입 검색어를 읽지 못했거나 데이터가 없어요.</div>}
                  </div>
                  {/* 맞춤 조언 */}
                  <div>
                    <div style={{ fontSize: 14, fontWeight: 800, color: "var(--text)", marginBottom: 10 }}>💡 맞춤 조언</div>
                    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                      {tips.map((t, i) => (
                        <div key={i} style={{ display: "flex", gap: 9, alignItems: "flex-start", padding: "11px 14px", borderRadius: 11, background: "rgba(0,200,150,.08)", border: "1px solid rgba(0,200,150,.2)", fontSize: 12.5, color: "var(--text2)", lineHeight: 1.6, fontWeight: 500 }}>
                          <span style={{ color: "#00c896", flexShrink: 0, fontWeight: 900 }}>✓</span><span>{t}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              );
            })()}
            <LogBox logs={scLogs} logRef={scLogRef} onClear={() => setScLogs([])} />
          </div>
        </div>
      )}

      {/* ═══════════ 💞 품앗이 탭 ═══════════ */}
      {tab === "pumasi" && (() => {
        const connected = accounts.filter(a => a.sessionOk && a.blogId);
        const overAccountLimit = !isUnlimitedPlan && accounts.length > pumasiAccountLimit;
        return (
        <div className="npg-2col">
          {/* 왼쪽: 계정 + 설정 */}
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            {/* 기능설명 배너 */}
            <div style={{ padding: "16px 18px", borderRadius: 14, background: "linear-gradient(135deg,rgba(236,72,153,.1),rgba(139,92,246,.08))", border: "1.5px solid rgba(236,72,153,.3)" }}>
              <div style={{ fontSize: 15, fontWeight: 800, color: "#ec4899", marginBottom: 6 }}>💞 품앗이(내 계정끼리 서로 공감·댓글)</div>
              <div style={{ fontSize: 12.5, color: "var(--text2)", lineHeight: 1.65, fontWeight: 500 }}>
                내 <b style={{color:"#ec4899"}}>여러 계정</b>을 등록해두면, 봇이 <b>계정을 자동으로 전환</b>하며 서로의 글을 읽고 공감·댓글을 남겨줘요. 계정별 <b>받을 수</b>를 정해 한 계정에 방문이 과하게 몰리는 것도 막을 수 있어요.<br />
                <span style={{ color: "#c88010", fontWeight: 700 }}>💡 한 번만 계정 연결</span>해두면, 다음부턴 <b>'품앗이 시작'</b>만 눌러도 자동 로그인·전환하며 알아서 돌아가요. 딜레이를 넉넉히 두면 계정이 안전해요.
              </div>
            </div>

            {/* 내 등급 안내 — 몇 개 연결 가능 / 지금 몇 개 */}
            <div style={{ padding: "13px 16px", borderRadius: 12, background: "var(--card)", border: "1px solid var(--border)", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
              <div style={{ fontSize: 12.5, color: "var(--text2)", fontWeight: 600 }}>
                내 등급 <b style={{color:"#ec4899"}}>{plan === "free" ? "무료" : plan === "basic" ? "베이직" : plan === "pro" ? "프로" : plan === "unlimited" ? "무제한" : plan}</b> · 계정 <b style={{color: overAccountLimit ? "var(--danger)" : "#00c896"}}>{accounts.length}</b>{isUnlimitedPlan ? "" : `/${pumasiAccountLimit}`}개 등록 · 연결됨 <b style={{color:"#00c896"}}>{connected.length}</b>개
              </div>
              <div style={{ fontSize: 11.5, color: "var(--text3)" }}>계정당 대상 글 최대 {isUnlimitedPlan ? "무제한" : `${pumasiPostsLimit}개`}</div>
            </div>
            {overAccountLimit && <div style={{ fontSize: 12, color: "var(--danger)", fontWeight: 700, padding: "2px 4px" }}>⚠️ 등록 계정이 등급 한도({pumasiAccountLimit}개)를 넘었어요. 초과분은 품앗이에서 제외돼요. 더 많이 쓰려면 상위 등급이나 추가 결제가 필요해요.</div>}

            {/* ★등급별 한도표 — 내가 몇 개까지 쓸 수 있는지 한눈에(내 등급 행 강조). 회원·관리자 공용 */}
            <div className="card" style={{ padding: "14px 16px" }}>
              <div style={{ fontSize: 13, fontWeight: 800, color: "var(--text)", marginBottom: 3 }}>📋 등급별 품앗이 한도</div>
              <div style={{ fontSize: 11, color: "var(--text3)", marginBottom: 10, lineHeight: 1.5 }}>내 등급에서 <b>연결 계정 수 · 계정당 대상 글 · 받을 수</b>를 얼마나 쓸 수 있는지 보여줘요.</div>
              {(() => {
                const cols = { display: "grid", gridTemplateColumns: "1.1fr 1fr 1fr 1fr", alignItems: "center", gap: 4 } as const;
                // 무제한은 관리자·특별 승인자 전용이라 일반 등급표에는 노출하지 않음(기능은 그대로).
                const rows = [
                  { key: "free", name: "무료", acc: "2개", posts: "3개", recv: "2명" },
                  { key: "basic", name: "베이직", acc: "3개", posts: "5개", recv: "3명" },
                  { key: "pro", name: "프로", acc: "5개", posts: "10개", recv: "5명" },
                ];
                const myKey = plan;
                return (<>
                  <div style={{ ...cols, padding: "0 8px 6px", fontSize: 10.5, color: "var(--text3)", fontWeight: 700 }}>
                    <span>등급</span>
                    <span style={{ textAlign: "center" }}>연결 계정</span>
                    <span style={{ textAlign: "center" }}>대상 글</span>
                    <span style={{ textAlign: "center" }}>받을 수</span>
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                    {rows.map(r => {
                      const mine = r.key === myKey;
                      return (
                        <div key={r.key} style={{ ...cols, padding: "9px 8px", borderRadius: 9, background: mine ? "rgba(236,72,153,.12)" : "var(--bg)", border: `1.5px solid ${mine ? "#ec4899" : "var(--border)"}`, fontSize: 12.5 }}>
                          <span style={{ fontWeight: 800, color: mine ? "#ec4899" : "var(--text2)" }}>{r.name}{mine && <span style={{ fontSize: 9.5, marginLeft: 4, color: "#ec4899", fontWeight: 700 }}>내 등급</span>}</span>
                          <span style={{ textAlign: "center", fontWeight: mine ? 800 : 600, color: mine ? "var(--text)" : "var(--text2)" }}>{r.acc}</span>
                          <span style={{ textAlign: "center", fontWeight: mine ? 800 : 600, color: mine ? "var(--text)" : "var(--text2)" }}>{r.posts}</span>
                          <span style={{ textAlign: "center", fontWeight: mine ? 800 : 600, color: mine ? "var(--text)" : "var(--text2)" }}>{r.recv}</span>
                        </div>
                      );
                    })}
                  </div>
                  <div style={{ fontSize: 10.5, color: "var(--text3)", lineHeight: 1.5, marginTop: 9 }}>💡 <b>받을 수</b>는 내 글에 몇 개의 다른 계정이 방문할지, <b>대상 글</b>은 각 계정이 상대 글 몇 개를 돌지예요(곱하기 관계). 하루 총 건수 제한은 없어요 — 딜레이로 자연 조절돼요.</div>
                </>);
              })()}
            </div>

            <AccountAccordion accounts={accounts} open={acctOpen} setOpen={setAcctOpen} tabName="품앗이" accountLimit={accountLimit} isUnlimited={isUnlimitedPlan}>
              <AccountCard accounts={accounts} onLogin={handleLogin} onAdd={handleAddAccount} onRemove={handleRemoveAccount} onChange={handleAccountChange} onConnectAll={handleConnectAll} connectingAll={connectingAll} />
              {accounts.length > 1 && (
                <button onClick={handleRemoveAllAccounts} style={{ width: "100%", padding: "10px", borderRadius: 10, border: "1.5px solid var(--danger)", background: "transparent", color: "var(--danger)", cursor: "pointer", fontSize: 12.5, fontWeight: 700, fontFamily: "inherit" }}>
                  🗑 계정 전체 삭제 (저장된 로그인도 함께)
                </button>
              )}
            </AccountAccordion>

            {/* ★진행 현황 미리보기: 각 대상별 총 글 / 이미 댓글 단 글 / 남은 글(시작 전 확인) */}
            {connected.length >= 2 && (
              <div className="card" style={{ padding: "16px 18px" }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 3 }}>
                  <div style={{ fontSize: 14, fontWeight: 800, color: "var(--text)" }}>📊 계정별 진행 현황</div>
                  <button onClick={handlePumasiPreview} disabled={pumPreviewLoading} style={{ fontSize: 11, padding: "5px 10px", borderRadius: 8, border: "1px solid var(--border)", background: "transparent", color: "var(--text2)", cursor: "pointer", fontFamily: "inherit", fontWeight: 700 }}>{pumPreviewLoading ? "확인 중..." : "🔄 새로고침"}</button>
                </div>
                <div style={{ fontSize: 11, color: "var(--text3)", lineHeight: 1.5, marginBottom: 10 }}>계정마다 <b>전체 글(총)</b> 중 <b>댓글 단 글(완료)</b>과 <b style={{ color: "#ec4899" }}>아직 안 단 글(남음)</b>을 보여줘요. 이미 단 글은 다시 안 달고, <b>최신 글부터</b> 남은 글에 달아요.</div>
                {!pumPreview && pumPreviewLoading && <div style={{ fontSize: 12, color: "var(--text3)" }}><span className="spinner" /> 글 수를 확인하는 중...</div>}
                {pumPreview && pumPreview.length > 0 ? (
                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    {pumPreview.map(r => {
                      const pct = r.total > 0 ? Math.min(100, (r.commented / r.total) * 100) : 0;
                      const allDone = r.total > 0 && r.remaining === 0;
                      return (
                        <div key={r.blogId} style={{ padding: "10px 12px", borderRadius: 10, background: "var(--bg)", border: "1px solid var(--border)" }}>
                          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6, gap: 8 }}>
                            <span style={{ fontSize: 13, fontWeight: 700, color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>🔗 {r.blogId}</span>
                            <span style={{ fontSize: 11.5, fontWeight: 700, color: allDone ? "#00c896" : "var(--text2)", whiteSpace: "nowrap" }}>
                              {allDone ? "✅ 모두 완료" : <>남음 <b style={{ color: "#ec4899" }}>{r.remaining}</b> · 완료 {r.commented} / 총 {r.total}</>}
                            </span>
                          </div>
                          <div style={{ height: 6, borderRadius: 99, background: "var(--card2)", overflow: "hidden" }}>
                            <div style={{ height: "100%", borderRadius: 99, width: `${pct}%`, background: allDone ? "#00c896" : "#8b5cf6", transition: "width .4s ease" }} />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : pumPreview && !pumPreviewLoading ? (
                  <div style={{ fontSize: 12, color: "var(--text3)" }}>표시할 계정이 없어요. 계정을 연결하면 진행 현황이 나와요.</div>
                ) : null}
              </div>
            )}

            {/* 계정별 대상 글 수 + 받을 계정 수 */}
            {connected.length >= 2 && (
              <div className="card" style={{ padding: "16px 18px" }}>
                <div className="card-title" style={{ marginBottom: 6, fontSize: 15 }}>📝 계정별 글 수 · 받을 수</div>
                <div style={{ fontSize: 11.5, color: "var(--text2)", marginBottom: 12, lineHeight: 1.5, fontWeight: 500 }}>💡 <b>대상 글</b>은 최근 몇 개 글을 돌지, <b>받을 수</b>는 최대 몇 개의 다른 계정에게 방문·공감·댓글을 받을지 정해요. 기본은 3명이에요.</div>
                {(() => {
                  // ★받을 수 상한 = 등급 기준(무료2·베3·프5·무제한999). 대상 글과 같은 방식(정답 모델).
                  const maxReceive = isUnlimitedPlan ? 999 : pumasiAccountLimit;
                  // 실제 방문 가능한 계정 수(나 제외) — 이보다 크게 설정해도 봇이 자연스럽게 이 수로 제한(손해 없음)
                  const physMax = Math.max(1, connected.length - 1);
                  const anyOverPhys = connected.some(a => Math.min(maxReceive, pumReceiveByAcc[a.accountId] ?? Math.min(3, maxReceive)) > physMax);
                  const postsMaxN = isUnlimitedPlan ? 999 : pumasiPostsLimit;
                  return (<>
                    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                      {connected.map(a => {
                        const noGive = !!pumNoGive[a.accountId];
                        const noReceive = !!pumNoReceive[a.accountId];
                        const toggleBtn = (on: boolean, onLabel: string, offLabel: string, onClick: () => void) => (
                          <button onClick={onClick} style={{ padding: "5px 11px", borderRadius: 99, border: `1.5px solid ${on ? "#ef4444" : "var(--border)"}`, background: on ? "rgba(239,68,68,.12)" : "transparent", color: on ? "#ef4444" : "var(--text3)", fontSize: 11, fontWeight: 800, cursor: "pointer", fontFamily: "inherit", whiteSpace: "nowrap" }}>{on ? onLabel : offLabel}</button>
                        );
                        return (
                        <div key={a.accountId} style={{ padding: "10px 12px", borderRadius: 10, background: "var(--bg)", border: "1px solid var(--border)", display: "flex", flexDirection: "column", gap: 9 }}>
                          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
                            <span style={{ minWidth: 0, fontSize: 13, fontWeight: 800, color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>🔗 {a.blogId || a.accountId}</span>
                            <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
                              {toggleBtn(noGive, "🚫 안 가기", "가기", () => setPumNoGive(p => ({ ...p, [a.accountId]: !noGive })))}
                              {toggleBtn(noReceive, "🚫 안 받기", "받기", () => setPumNoReceive(p => ({ ...p, [a.accountId]: !noReceive })))}
                            </div>
                          </div>
                          <div style={{ display: "flex", gap: 10 }}>
                            <label style={{ flex: 1, display: "flex", alignItems: "center", gap: 6, fontSize: 11.5, color: "var(--text3)", fontWeight: 700, opacity: noGive ? 0.4 : 1 }}>
                              줄 글수
                              <input className="inp" type="text" inputMode="numeric" disabled={noGive}
                                value={noGive ? "—" : String(pumPostsByAcc[a.accountId] ?? 3)}
                                onChange={e => { const raw = e.target.value.replace(/[^0-9]/g, ""); setPumPostsByAcc(prev => ({ ...prev, [a.accountId]: raw === "" ? 0 : parseInt(raw) })); }}
                                onBlur={e => { const v = Math.max(1, Math.min(postsMaxN, parseInt(e.target.value) || 1)); setPumPostsByAcc(prev => ({ ...prev, [a.accountId]: v })); }}
                                style={{ flex: 1, fontSize: 13, padding: "8px 6px", textAlign: "center", minWidth: 0 }} />
                            </label>
                            <label style={{ flex: 1, display: "flex", alignItems: "center", gap: 6, fontSize: 11.5, color: "var(--text3)", fontWeight: 700, opacity: noReceive ? 0.4 : 1 }}>
                              받을수
                              <input className="inp" type="text" inputMode="numeric" disabled={noReceive}
                                value={noReceive ? "0" : String(pumReceiveByAcc[a.accountId] ?? 3)}
                                onChange={e => { const raw = e.target.value.replace(/[^0-9]/g, ""); setPumReceiveByAcc(prev => ({ ...prev, [a.accountId]: raw === "" ? 0 : parseInt(raw) })); }}
                                onBlur={e => { const v = Math.max(0, Math.min(maxReceive, parseInt(e.target.value) || 0)); setPumReceiveByAcc(prev => ({ ...prev, [a.accountId]: v })); }}
                                style={{ flex: 1, fontSize: 13, padding: "8px 6px", textAlign: "center", minWidth: 0 }} />
                            </label>
                          </div>
                        </div>
                        );
                      })}
                    </div>
                    <div style={{ fontSize: 11, color: "var(--text3)", marginTop: 9, lineHeight: 1.5, background: "var(--card2)", borderRadius: 8, padding: "8px 11px" }}>
                      ℹ️ <b>받을 수</b>는 내 등급 한도(<b style={{ color: "#ec4899" }}>{isUnlimitedPlan ? "무제한" : `${maxReceive}명`}</b>)까지 설정할 수 있어요.
                      {anyOverPhys && <> 지금은 연결된 계정이 <b>{connected.length}개</b>라 실제로는 최대 <b>{physMax}명</b>까지 방문해요(더 설정해도 손해 없어요). 계정을 더 연결하면 그만큼 늘어나요.</>}
                    </div>
                  </>);
                })()}
              </div>
            )}

            {/* 작업 종류 (공감/댓글 둘 다) */}
            <div className="card" style={{ padding: "16px 18px" }}>
              <div className="card-title" style={{ marginBottom: 10, fontSize: 15 }}>⚙️ 작업 설정</div>
              <Toggle val={pumDoLike} set={setPumDoLike} label="❤️ 공감 클릭하기" />
              <Toggle val={pumDoComment} set={setPumDoComment} label="💬 댓글 작성하기" />

              {pumDoComment && (
                <div style={{ marginTop: 12 }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: "var(--text2)", marginBottom: 7 }}>댓글 방식</div>
                  <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
                    {([["single","단일"],["multi","여러개 순환"],["ai","✨ AI 자동"]] as const).map(([m,lbl]) => {
                      const on = pumCommentMode === m; const isAi = m === "ai";
                      return <button key={m} onClick={() => setPumCommentMode(m)} style={{ flex: 1, padding: "10px 6px", borderRadius: 10, border: `2px solid ${on ? (isAi?"#8b5cf6":"var(--accent)") : "var(--border)"}`, background: on ? (isAi?"rgba(139,92,246,.12)":"var(--accent-bg)") : "transparent", color: on ? (isAi?"#8b5cf6":"var(--accent-text)") : (isAi?"#8b5cf6":"var(--text2)"), cursor: "pointer", fontSize: 12, fontWeight: 700, fontFamily: "inherit" }}>{lbl}</button>;
                    })}
                  </div>
                  {pumCommentMode === "single" && <textarea className="inp" rows={2} value={pumComment} onChange={e => setPumComment(e.target.value)} style={{ resize: "vertical", fontSize: 13, lineHeight: 1.6, padding: "11px 13px" }} />}
                  {pumCommentMode === "multi" && <>
                    <textarea className="inp" rows={4} value={pumMultiComments} onChange={e => setPumMultiComments(e.target.value)} style={{ resize: "vertical", fontSize: 13, lineHeight: 1.6, padding: "11px 13px" }} placeholder="줄바꿈으로 구분 → 순서대로 사용" />
                    <div style={{ fontSize: 11, color: "var(--text3)", marginTop: 6 }}>총 {pumMultiComments.split("\n").filter(l => l.trim()).length}개 댓글 등록됨</div>
                  </>}
                  {pumCommentMode === "ai" && <>
                    <div style={{ fontSize: 12, color: "var(--text2)", lineHeight: 1.6, fontWeight: 500, marginBottom: 9, padding: "10px 12px", borderRadius: 10, background: "rgba(139,92,246,.08)", border: "1px solid rgba(139,92,246,.2)" }}>✨ <b style={{color:"#8b5cf6"}}>AI가 글을 읽고</b> 매번 다른 자연스러운 댓글을 써요. 말투만 골라주세요. <b>(설정→글쓰기AI의 Gemini 무료키 필요)</b></div>
                    <div style={{ display: "flex", gap: 8 }}>
                      {(["담백","다정","짧게"] as const).map(t => <button key={t} onClick={() => setPumTone(t)} style={{ flex: 1, padding: "9px", borderRadius: 9, border: `2px solid ${pumTone===t?"#8b5cf6":"var(--border)"}`, background: pumTone===t?"rgba(139,92,246,.1)":"transparent", color: pumTone===t?"#8b5cf6":"var(--text2)", cursor: "pointer", fontSize: 12.5, fontWeight: 800, fontFamily: "inherit" }}>{t}</button>)}
                    </div>
                  </>}
                </div>
              )}

              <div style={{ marginTop: 14 }}>
                <label className="inp-label" style={{ fontSize: 12, marginBottom: 6, display: "block" }}>딜레이 (초)</label>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <input className="inp" {...numProps(pumDelayMin, setPumDelayMin, 1, 120, 8)} style={{ flex: 1, fontSize: 13, padding: "11px 14px" }} />
                  <span style={{ color: "var(--text3)" }}>~</span>
                  <input className="inp" {...numProps(pumDelayMax, setPumDelayMax, 1, 300, 15)} style={{ flex: 1, fontSize: 13, padding: "11px 14px" }} />
                </div>
                <div style={{ fontSize: 11.5, color: "var(--text2)", marginTop: 6, lineHeight: 1.5, fontWeight: 500 }}>💡 댓글 사이 대기 시간이에요. <b style={{color:"#00c896"}}>넉넉히 둘수록</b> 사람처럼 자연스러워 <b style={{color:"#ff5fa2"}}>계정이 안전</b>해요.</div>
              </div>

              {/* ★자연스러운 방문 강화 (체류시간·관련글·시간분산) */}
              <div style={{ marginTop: 16, padding: "14px 16px", borderRadius: 12, border: "1px solid rgba(139,92,246,.25)", background: "rgba(139,92,246,.06)" }}>
                <div style={{ fontSize: 13, fontWeight: 900, color: "#8b5cf6", marginBottom: 4 }}>🌿 자연스러운 방문 강화</div>
                <div style={{ fontSize: 11.5, color: "var(--text2)", lineHeight: 1.6, fontWeight: 500, marginBottom: 12 }}>
                  똑같이 빨리 처리하는 매크로가 아니라 <b>실제 사람처럼 읽고 머물게</b> 만들어요.
                  <b style={{color:"#ec4899"}}> 체류시간·투데이가 자연스럽게 늘어</b> 블로그 지수에 도움되고, 오히려 <b style={{color:"#00c896"}}>더 안전</b>해요.
                </div>

                {/* 체류시간 엔진 + 속도 모드 */}
                <div style={{ padding: "8px 0", borderTop: "1px dashed var(--border)" }}>
                  <div style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
                    <span style={{ fontSize: 15 }}>⏱️</span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 12.5, fontWeight: 800, color: "var(--text)" }}>체류시간 엔진 <span style={{ fontSize: 10.5, color: "#00c896", fontWeight: 700 }}>자동 적용</span></div>
                      <div style={{ fontSize: 11, color: "var(--text3)", lineHeight: 1.5, marginTop: 2 }}>글의 <b>글자·이미지 수를 읽어</b> 짧은 글은 빨리, 긴 글은 오래 스크롤하며 머물러요. 즉시 이탈 패턴을 줄여요.</div>
                    </div>
                  </div>
                  {/* 속도 모드: 글 많은 블로그를 자주 돌릴 때 시간 단축 */}
                  <div style={{ marginTop: 9, paddingLeft: 2 }}>
                    <div style={{ fontSize: 11, color: "var(--text2)", fontWeight: 700, marginBottom: 6 }}>읽는 속도 (한 글에 머무는 시간)</div>
                    <div style={{ display: "flex", gap: 8 }}>
                      {([["fast", "빠르게", "최대 10초 · 시간 절약"], ["normal", "보통", "최대 22초"], ["natural", "자연스럽게", "최대 40초 · 가장 안전"]] as const).map(([m, lbl, desc]) => {
                        const on = pumReadSpeed === m;
                        return (
                          <button key={m} onClick={() => setPumReadSpeed(m)} style={{ flex: 1, padding: "9px 6px", borderRadius: 10, border: `2px solid ${on ? "#8b5cf6" : "var(--border)"}`, background: on ? "rgba(139,92,246,.12)" : "transparent", color: on ? "#8b5cf6" : "var(--text2)", cursor: "pointer", fontFamily: "inherit", textAlign: "center" }}>
                            <div style={{ fontSize: 12, fontWeight: 800 }}>{lbl}</div>
                            <div style={{ fontSize: 9.5, color: on ? "#8b5cf6" : "var(--text3)", marginTop: 2, fontWeight: 500, lineHeight: 1.3 }}>{desc}</div>
                          </button>
                        );
                      })}
                    </div>
                    <div style={{ fontSize: 10.5, color: "var(--text3)", lineHeight: 1.5, marginTop: 6 }}>💡 글이 많은 블로그를 <b>자주</b> 돌릴 땐 <b>빠르게</b>가 편해요. 급하지 않으면 <b>자연스럽게</b>가 가장 사람처럼 보여 안전해요.</div>
                  </div>
                </div>

                {/* 검색 경유 진입 (품앗이: 목표 키워드로 검색해 유입) */}
                <div style={{ padding: "8px 0", borderTop: "1px dashed var(--border)" }}>
                  <SearchEntryToggle on={searchEntry} set={setSearchEntry} extra={
                    <div style={{ marginTop: 10 }}>
                      <label style={{ fontSize: 11.5, fontWeight: 700, color: "var(--text2)", display: "block", marginBottom: 5 }}>검색할 키워드 (내 글이 노리는 주제)</label>
                      <input className="inp" value={pumSearchKeyword} onChange={e => setPumSearchKeyword(e.target.value)} placeholder="예: 온종일팜 굴비" style={{ width: "100%", fontSize: 13, padding: "9px 11px" }} />
                      <div style={{ fontSize: 10.5, color: "var(--text3)", marginTop: 5, lineHeight: 1.5 }}>이 키워드로 검색해 내 글을 찾아 들어가요(검색 유입↑). 비우면 블로그ID로 검색해요.</div>
                    </div>
                  } />
                </div>

                {/* 대상 글 기간 제한 */}
                <div style={{ padding: "8px 0", borderTop: "1px dashed var(--border)" }}>
                  <div style={{ fontSize: 12.5, fontWeight: 800, color: "var(--text)", marginBottom: 2 }}>📆 어디까지의 글에 댓글 달까요?</div>
                  <div style={{ fontSize: 11, color: "var(--text3)", lineHeight: 1.5, marginBottom: 8 }}>최신 글부터 과거로 내려가며 <b>안 단 글</b>에만 달아요. 너무 오래된 글까지 가는 게 부담되면 <b>기간</b>을 정할 수 있어요.</div>
                  <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
                    {[{ v: 0, t: "전체" }, { v: 30, t: "최근 1개월" }, { v: 90, t: "3개월" }, { v: 180, t: "6개월" }, { v: 365, t: "1년" }].map(o => (
                      <button key={o.v} onClick={() => setPumPeriodDays(o.v)} style={{ flex: "1 1 auto", padding: "8px 4px", borderRadius: 9, border: `2px solid ${pumPeriodDays === o.v ? "#8b5cf6" : "var(--border)"}`, background: pumPeriodDays === o.v ? "rgba(139,92,246,.12)" : "transparent", color: pumPeriodDays === o.v ? "#8b5cf6" : "var(--text2)", cursor: "pointer", fontSize: 11.5, fontWeight: 800, fontFamily: "inherit", minWidth: 0 }}>{o.t}</button>
                    ))}
                  </div>
                  <div style={{ fontSize: 10.5, color: "var(--text3)", lineHeight: 1.5, marginTop: 6 }}>💡 <b>전체</b>는 과거 글까지 전부 대상(글을 다 돌 때까지 매번 다른 글로 진행). 기간을 정하면 그 안의 글만 돌고 다 달면 멈춰요.</div>
                </div>

                {/* 관련 글 1편 더 읽기 토글 + 매번/가끔 모드 */}
                <div style={{ padding: "8px 0", borderTop: "1px dashed var(--border)" }}>
                  <Toggle val={pumReadRelated} set={setPumReadRelated} label="📖 관련 글 1편 더 읽기" />
                  <div style={{ fontSize: 11, color: "var(--text3)", lineHeight: 1.5, marginTop: 4, paddingLeft: 2 }}>각 <b>대상 글에 공감·댓글을 단 직후</b> 같은 블로그의 <b>다른 글 1편</b>을 공감·댓글 없이 더 읽어요(1사이클 = 댓글+공감+관련글). 댓글 달자마자 나가는 패턴을 줄여 <b style={{color:"#ec4899"}}>진짜 방문자처럼</b> 보이게 해요.</div>
                  {pumReadRelated && (
                    <div style={{ marginTop: 9, paddingLeft: 2 }}>
                      <div style={{ fontSize: 11, color: "var(--text2)", fontWeight: 700, marginBottom: 6 }}>언제 읽을까요?</div>
                      <div style={{ display: "flex", gap: 8 }}>
                        {([["always", "매번", "각 대상 글마다 항상 1편"], ["random", "가끔", "확률 60%로 가끔만"]] as const).map(([m, lbl, desc]) => {
                          const on = pumReadRelatedMode === m;
                          return (
                            <button key={m} onClick={() => setPumReadRelatedMode(m)} style={{ flex: 1, padding: "9px 8px", borderRadius: 10, border: `2px solid ${on ? "#8b5cf6" : "var(--border)"}`, background: on ? "rgba(139,92,246,.12)" : "transparent", color: on ? "#8b5cf6" : "var(--text2)", cursor: "pointer", fontFamily: "inherit", textAlign: "center" }}>
                              <div style={{ fontSize: 12.5, fontWeight: 800 }}>{lbl}</div>
                              <div style={{ fontSize: 10, color: on ? "#8b5cf6" : "var(--text3)", marginTop: 2, fontWeight: 500 }}>{desc}</div>
                            </button>
                          );
                        })}
                      </div>
                      <div style={{ fontSize: 10.5, color: "var(--text3)", lineHeight: 1.5, marginTop: 6 }}>💡 <b>매번</b>은 체류·투데이가 더 많이 늘지만 시간이 더 걸려요. 여분 글이 부족하면 그때만 건너뛰어요.
                        {pumReadRelatedMode === "always" && <span style={{ color: "var(--danger)", fontWeight: 700 }}> ⚠️ 대상 글이 많으면 시간이 크게 늘어요 — 읽는 속도를 <b>빠르게</b>로 두거나 <b>가끔</b>을 쓰는 걸 추천해요.</span>}
                      </div>
                    </div>
                  )}
                </div>

                {/* 시간 분산 큐 (분 단위) */}
                {(() => {
                  // ★실제 설정과 연동: 받을 수는 연결 계정 수(나 제외)로 제한되고, 각 방문마다 그 계정의 '대상 글 수'만큼 댓글을 단다.
                  //   → 총 방문(블로그 진입 수)과 실제 댓글 수를 둘 다 계산해 보여준다(받을 수·대상 글 수 바꾸면 즉시 반영).
                  // ★품앗이 = 각 계정이 '받기 M'만큼 방문받고(0이면 안 받음), 방문자는 자기 '글 N개'만큼 상대 글에 댓글(주는 양).
                  const N = connected.length;
                  const postsMax = isUnlimitedPlan ? 999 : pumasiPostsLimit;
                  const per = connected.map(a => ({
                    recv: Math.max(0, pumReceiveByAcc[a.accountId] ?? 3),                               // 받기(0=안 받음), 실제 최대 N-1
                    posts: Math.min(postsMax, Math.max(1, pumPostsByAcc[a.accountId] ?? 3)),           // 남 방문 시 상대 글에 댓글 달 수(주는 양)
                  }));
                  const totalVisits = per.reduce((s, x) => s + Math.min(x.recv, Math.max(0, N - 1)), 0) || 0;   // 총 방문 = Σ 받기(최대 N-1)
                  const avgPosts = per.length ? per.reduce((s, x) => s + x.posts, 0) / per.length : 1;
                  const totalComments = Math.round(totalVisits * avgPosts) || 0;                        // 방문마다 방문자 글수(평균)만큼 댓글
                  const gapMin = pumSpread > 0 ? pumSpread / totalVisits : 0;   // 방문 사이 평균 간격(분)
                  const fmtGap = gapMin >= 1 ? `약 ${Math.round(gapMin)}분` : `약 ${Math.round(gapMin * 60)}초`;
                  const fmtTotal = pumSpread >= 60 ? `${Math.floor(pumSpread/60)}시간 ${pumSpread%60 ? `${pumSpread%60}분` : ""}`.trim() : `${pumSpread}분`;
                  return (
                <div style={{ padding: "8px 0 2px", borderTop: "1px dashed var(--border)" }}>
                  <label className="inp-label" style={{ fontSize: 12, marginBottom: 4, display: "block", fontWeight: 800 }}>⏰ 시간 분산 (방문을 이 시간 안에 고르게 나눔)</label>
                  <div style={{ fontSize: 11, color: "var(--text3)", lineHeight: 1.5, marginBottom: 8 }}>모든 방문을 <b>합쳐서 정한 시간 안에</b> 나눠 진행해요(전체 시간이지 계정당 시간이 아니에요). 짧은 시간에 방문이 몰리는 걸 막아 <b style={{color:"#00c896"}}>안전</b>해요.</div>
                  <div style={{ display: "flex", gap: 5, flexWrap: "wrap", marginBottom: 8 }}>
                    {[{v:0,t:"즉시"},{v:10,t:"10분"},{v:20,t:"20분"},{v:30,t:"30분"},{v:60,t:"1시간"},{v:120,t:"2시간"}].map(o => (
                      <button key={o.v} onClick={() => setPumSpread(o.v)} style={{ flex: "1 1 auto", padding: "8px 4px", borderRadius: 9, border: `2px solid ${pumSpread===o.v?"#8b5cf6":"var(--border)"}`, background: pumSpread===o.v?"rgba(139,92,246,.12)":"transparent", color: pumSpread===o.v?"#8b5cf6":"var(--text2)", cursor: "pointer", fontSize: 11.5, fontWeight: 800, fontFamily: "inherit", minWidth: 0 }}>{o.t}</button>
                    ))}
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{ fontSize: 11.5, color: "var(--text2)", fontWeight: 700, whiteSpace: "nowrap" }}>직접 입력</span>
                    <input className="inp" type="number" min={0} max={720} value={pumSpread} onChange={e => setPumSpread(Math.max(0, Math.min(720, parseInt(e.target.value) || 0)))} style={{ width: 90, fontSize: 13, padding: "8px 10px", textAlign: "center" }} />
                    <span style={{ fontSize: 11.5, color: "var(--text2)", fontWeight: 700 }}>분</span>
                    <span style={{ fontSize: 10.5, color: "var(--text3)" }}>(0=즉시, 최대 720분=12시간)</span>
                  </div>
                  <div style={{ fontSize: 11, marginTop: 8, lineHeight: 1.5, background: "var(--card2)", borderRadius: 8, padding: "8px 11px", color: "var(--text2)" }}>
                    {pumSpread === 0
                      ? <>지금은 <b>즉시 연속</b>이에요 — 딜레이만 두고 쉬지 않고 이어서 방문해요. (이번 설정: 총 방문 <b style={{color:"#8b5cf6"}}>{totalVisits}회</b> · 댓글 약 <b style={{color:"#ec4899"}}>{totalComments}개</b>)</>
                      : <>이번 설정: 총 방문 <b style={{color:"#8b5cf6"}}>{totalVisits}회</b>(댓글 약 <b style={{color:"#ec4899"}}>{totalComments}개</b>)를 <b style={{color:"#8b5cf6"}}>{fmtTotal}</b>에 걸쳐 → 방문 사이 <b style={{color:"#ec4899"}}>{fmtGap}</b> 간격. <span style={{color:"var(--text3)"}}>그동안 앱이 켜져 있어야 해요.</span></>}
                    <div style={{ marginTop: 6, color: "var(--text3)", fontSize: 10.5 }}>각 계정은 <b>받기</b> 수만큼 방문받고(0이면 안 받음, 최대 {Math.max(0, N - 1)}회), 방문한 계정은 자기 <b>글 개수</b>만큼 상대 글에 공감·댓글을 남겨요. 상대 글이 부족하면 그만큼만 하고 넘어가요.</div>
                  </div>
                </div>
                  );
                })()}
              </div>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <button className="btn btn-primary btn-full" onClick={handlePumasiStart} disabled={pumWorking || !botOnline || connected.length < 2} style={{ padding: "14px", fontSize: 14, borderRadius: 12 }}>
                {pumWorking ? <><span className="spinner" />품앗이 진행 중...</> : `🤝 품앗이 시작${connected.length >= 2 ? ` (${connected.length}개 계정)` : ""}`}
              </button>
              {connected.length < 2 && <div style={{ fontSize: 12, color: "var(--text3)", textAlign: "center" }}>계정을 <b>2개 이상 연결</b>하면 시작할 수 있어요.</div>}
              {pumWorking && <button className="btn-stop" onClick={handlePumasiStop} style={{ width: "100%", justifyContent: "center", padding: "13px", borderRadius: 12, fontSize: 13 }}>⛔ 중단</button>}
            </div>
          </div>

          {/* 오른쪽: 게이지 + 결과 + 로그 */}
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <div className="card" style={{ padding: "14px 18px" }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 9 }}>
                <span style={{ fontSize: 12.5, fontWeight: 700, color: "var(--text2)" }}>💞 오늘 품앗이 <span style={{ fontSize: 10.5, color: "var(--text3)", fontWeight: 600 }}>(자정 초기화)</span></span>
                <span style={{ fontSize: 13, fontWeight: 800, color: pumUsed>=100?"#f59e0b":"#ec4899" }}>오늘 {pumUsed}건 · 권장 100</span>
              </div>
              <div style={{ height: 8, borderRadius: 99, background: "var(--card2)", overflow: "hidden" }}>
                <div style={{ height: "100%", borderRadius: 99, width: `${Math.min(100, pumUsed)}%`, background: pumUsed>=100?"#f59e0b":"#ec4899", transition: "width .5s ease" }} />
              </div>
              <div style={{ fontSize: 11, color: pumUsed>=100?"#f59e0b":"var(--text3)", marginTop: 7, fontWeight: 500 }}>{pumUsed>=100?"⚠️ 네이버 안전 권장(100건)을 넘었어요 — 계정 보호 위해 잠시 쉬어가는 걸 권해요.":<>오늘 품앗이로 남긴 공감·댓글 수예요. 하루 <b>100건 이내</b>를 권장해요(강제는 아니에요).</>}</div>
            </div>
            <div className="card" style={{ padding: "20px 24px" }}>
              <div style={{ fontSize: 13, color: "var(--text3)", fontWeight: 700, marginBottom: 14 }}>🤝 품앗이 결과</div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
                <div style={{ textAlign: "center", padding: "14px 8px", borderRadius: 12, background: "var(--bg)", border: "1px solid var(--border)" }}>
                  <div style={{ fontSize: 28, fontWeight: 900, color: "var(--success)" }}>{pumDone}</div>
                  <div style={{ fontSize: 12, color: "var(--text3)", marginTop: 4 }}>완료</div>
                </div>
                <div style={{ textAlign: "center", padding: "14px 8px", borderRadius: 12, background: "var(--bg)", border: "1px solid var(--border)" }}>
                  <div style={{ fontSize: 28, fontWeight: 900, color: "#f59e0b" }}>{pumSkip}</div>
                  <div style={{ fontSize: 12, color: "var(--text3)", marginTop: 4 }}>스킵</div>
                </div>
                <div style={{ textAlign: "center", padding: "14px 8px", borderRadius: 12, background: "var(--bg)", border: "1px solid var(--border)" }}>
                  <div style={{ fontSize: 28, fontWeight: 900, color: "var(--danger)" }}>{pumFail}</div>
                  <div style={{ fontSize: 12, color: "var(--text3)", marginTop: 4 }}>실패</div>
                </div>
              </div>
              <div style={{ fontSize: 11, color: "var(--text3)", marginTop: 9, lineHeight: 1.5 }}>💡 <b>스킵</b>은 실패가 아니에요 — 이미 처리했거나 공감·댓글이 막힌 글, 본문 로딩이 늦은 글을 자연스럽게 건너뛴 거예요.</div>
            </div>

            {/* ★품앗이 효과 리포트 */}
            <div className="card" style={{ padding: "18px 20px" }}>
              <div style={{ fontSize: 14, fontWeight: 900, color: "#ec4899", marginBottom: 4 }}>📊 품앗이 효과 리포트</div>
              <div style={{ fontSize: 11.5, color: "var(--text2)", lineHeight: 1.6, fontWeight: 500, marginBottom: 12 }}>
                품앗이가 <b>실제로 방문자(투데이)에 도움이 됐는지</b> 확인해요. 최근 방문자 추이 위에 <b style={{color:"#8b5cf6"}}>품앗이한 날</b>을 표시해 비교하니, 효과 없이 과하게 하는 걸 줄일 수 있어요.
                <br/><span style={{ color: "var(--text3)" }}>※ 방문자 증가를 품앗이 효과라고 단정할 순 없어요. 발행·검색·계절 등 다른 요인과 함께 참고하세요.</span>
              </div>
              {connected.length === 0 ? (
                <div style={{ fontSize: 12, color: "var(--text3)" }}>계정을 연결하면 블로그별 리포트를 볼 수 있어요.</div>
              ) : (
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
                  {connected.map(a => (
                    <button key={a.accountId} onClick={() => handlePumasiReport(a.blogId)} disabled={pumReportLoading}
                      style={{ padding: "8px 12px", borderRadius: 9, border: `2px solid ${pumReportBlog===a.blogId?"#ec4899":"var(--border)"}`, background: pumReportBlog===a.blogId?"rgba(236,72,153,.1)":"transparent", color: pumReportBlog===a.blogId?"#ec4899":"var(--text2)", cursor: "pointer", fontSize: 12, fontWeight: 800, fontFamily: "inherit" }}>
                      {a.blogId}
                    </button>
                  ))}
                </div>
              )}
              {pumReportLoading && <div style={{ fontSize: 12.5, color: "var(--text2)" }}><span className="spinner" /> 방문자·품앗이 이력 집계 중...</div>}
              {pumReport && !pumReportLoading && (() => {
                const days = pumReport.days;
                if (days.length === 0) return <div style={{ fontSize: 12, color: "var(--text3)" }}>아직 방문자 데이터가 없어요. 하루 이상 지난 뒤 다시 확인해주세요.</div>;
                const maxV = Math.max(1, ...days.map(d => d.visitors));
                return (
                  <div>
                    {/* 요약 */}
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8, marginBottom: 14 }}>
                      <div style={{ textAlign: "center", padding: "10px 6px", borderRadius: 10, background: "var(--bg)", border: "1px solid var(--border)" }}>
                        <div style={{ fontSize: 20, fontWeight: 900, color: "#ec4899" }}>{pumReport.totalReceived7d}</div>
                        <div style={{ fontSize: 10.5, color: "var(--text3)", marginTop: 2 }}>최근 받은 품앗이</div>
                      </div>
                      <div style={{ textAlign: "center", padding: "10px 6px", borderRadius: 10, background: "var(--bg)", border: "1px solid var(--border)" }}>
                        <div style={{ fontSize: 20, fontWeight: 900, color: "#8b5cf6" }}>{pumReport.avgWithPumasi ?? "–"}</div>
                        <div style={{ fontSize: 10.5, color: "var(--text3)", marginTop: 2 }}>품앗이한 날<br/>평균 방문자</div>
                      </div>
                      <div style={{ textAlign: "center", padding: "10px 6px", borderRadius: 10, background: "var(--bg)", border: "1px solid var(--border)" }}>
                        <div style={{ fontSize: 20, fontWeight: 900, color: "var(--text2)" }}>{pumReport.avgWithoutPumasi ?? "–"}</div>
                        <div style={{ fontSize: 10.5, color: "var(--text3)", marginTop: 2 }}>안 한 날<br/>평균 방문자</div>
                      </div>
                    </div>
                    {/* 막대 그래프 */}
                    <div style={{ display: "flex", alignItems: "flex-end", gap: 6, height: 120, padding: "0 2px" }}>
                      {days.map(d => (
                        <div key={d.date} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 4, minWidth: 0 }}>
                          <div style={{ fontSize: 10, fontWeight: 800, color: d.pumasiVisits>0?"#8b5cf6":"var(--text3)" }}>{d.visitors}</div>
                          <div style={{ width: "100%", height: `${Math.round((d.visitors/maxV)*80)}px`, minHeight: 3, borderRadius: "5px 5px 0 0", background: d.pumasiVisits>0 ? "linear-gradient(180deg,#ec4899,#8b5cf6)" : "var(--border)", transition: "height .4s ease" }} title={`${d.date} · 방문자 ${d.visitors} · 품앗이 ${d.pumasiVisits}회`} />
                          <div style={{ fontSize: 9.5, color: "var(--text3)" }}>{d.date.slice(5)}</div>
                          {d.pumasiVisits>0 && <div style={{ fontSize: 9, color: "#8b5cf6", fontWeight: 800 }}>💞{d.pumasiVisits}</div>}
                        </div>
                      ))}
                    </div>
                    <div style={{ fontSize: 10.5, color: "var(--text3)", marginTop: 10, textAlign: "center" }}><span style={{color:"#8b5cf6"}}>■</span> 품앗이한 날 · <span style={{color:"var(--text3)"}}>■</span> 안 한 날</div>
                  </div>
                );
              })()}
            </div>

            <LogBox logs={pumLogs} logRef={pumLogRef} onClear={() => setPumLogs([])} />
          </div>
        </div>
        );
      })()}
    {/* 🎉 블로그지수 웰컴 팝업 — 진입 시 팡! 캐릭터+사용순서+멘토 멘트. [닫기][일주일 보지않기] */}
    {/* 🛑 전체 제목 변경 중 한도 도달 → 업그레이드 안내 팝업 */}
    {/* 🩺 수정추적 '제목 변경' → 개선안 제목1·2 모달(관찰중 글은 재발행 목록에 없어 여기서 보여줌) */}
    {isActive && trackSol && createPortal(
      <div className={theme === "dark" ? "app dark" : "app light"} style={{ display: "contents" }}>
      <div onClick={() => !titleEditingKey && setTrackSol(null)} style={{ position: "fixed", inset: 0, zIndex: 100001, background: "rgba(12,10,20,.6)", backdropFilter: "blur(4px)", display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
        <div onClick={e => e.stopPropagation()} style={{ background: "var(--card)", borderRadius: 20, padding: "24px 24px 20px", maxWidth: 460, width: "100%", maxHeight: "88vh", overflowY: "auto", boxShadow: "0 30px 90px -20px rgba(0,0,0,.55)", border: "1px solid var(--border)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 15, fontWeight: 900, color: "var(--text)" }}>✏️ 제목 개선안</div>
              <div style={{ fontSize: 11.5, color: "var(--text3)", marginTop: 2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>원래: {trackSol.item.title}</div>
            </div>
            <button onClick={() => !titleEditingKey && setTrackSol(null)} style={{ border: "1px solid var(--border)", background: "transparent", color: "var(--text3)", borderRadius: 8, padding: "5px 10px", cursor: "pointer", fontSize: 13 }}>✕</button>
          </div>
          {trackSol.loading || !trackSol.sol
            ? <div style={{ padding: "30px 0", textAlign: "center", color: "var(--text3)", fontSize: 13 }}><span className="spinner" /> AI가 글 내용을 읽고 제목을 만드는 중...</div>
            : (() => { const sol = trackSol.sol!; const ln = trackSol.item.logNo!; return (
              <>
                {sol.diagnosis && <div style={{ fontSize: 11.5, color: "#ff5fa2", fontWeight: 600, marginBottom: 12, lineHeight: 1.5 }}>🔍 {sol.diagnosis}</div>}
                {[[sol.newTitle, "1"], [sol.newTitle2, "2"]].filter(([t]) => t).map(([nt, n]) => (
                  <div key={n} style={{ marginBottom: 12 }}>
                    <div style={{ fontSize: 11, color: "#00c896", fontWeight: 800, marginBottom: 4 }}>✅ 개선 제목 {n}</div>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                      <div style={{ flex: "1 1 180px", minWidth: 0, fontSize: 14, fontWeight: 800, color: "var(--text)", lineHeight: 1.4 }}>{nt}</div>
                      <button onClick={() => handleApplyTitle(trackSol.item.title, nt as string, `track-${ln}-${n}`, ln)} disabled={!!titleEditingKey}
                        style={{ flexShrink: 0, padding: "8px 14px", borderRadius: 9, border: "none", background: titleEditingKey ? "var(--card2)" : "#00c896", color: titleEditingKey ? "var(--text3)" : "#fff", fontSize: 12, fontWeight: 800, fontFamily: "inherit", cursor: titleEditingKey ? "default" : "pointer" }}>{titleEditingKey === `track-${ln}-${n}` ? "변경 중..." : "이 제목으로 변경"}</button>
                    </div>
                  </div>
                ))}
                {sol.keywords.length > 0 && <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 10 }}>{sol.keywords.map((k, j) => <span key={j} style={{ padding: "3px 9px", borderRadius: 20, background: "rgba(139,92,246,.12)", color: "#a855f7", fontSize: 11, fontWeight: 700 }}># {k}</span>)}</div>}
                {sol.bodyTip && <div style={{ fontSize: 11.5, color: "var(--text2)", lineHeight: 1.5, marginBottom: 4 }}>✏️ <b>본문 팁</b> · {sol.bodyTip}</div>}
                {sol.expectedEffect && <div style={{ fontSize: 11.5, color: "var(--text2)", lineHeight: 1.5, padding: "7px 10px", borderRadius: 8, background: "rgba(0,200,150,.08)" }}>📈 <b style={{ color: "#00c896" }}>기대 효과</b> · {sol.expectedEffect}</div>}
              </>
            ); })()}
        </div>
      </div>
      </div>, document.body)}

    {isActive && bulkUpgrade && createPortal(
      <div className={theme === "dark" ? "app dark" : "app light"} style={{ display: "contents" }}>
      <div onClick={() => setBulkUpgrade(null)} style={{ position: "fixed", inset: 0, zIndex: 100001, background: "rgba(12,10,20,.62)", backdropFilter: "blur(4px)", display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
        <div onClick={e => e.stopPropagation()} style={{ background: "var(--card)", borderRadius: 22, padding: "32px 28px 24px", maxWidth: 400, width: "100%", textAlign: "center", boxShadow: "0 30px 90px -20px rgba(0,0,0,.55)", border: "1px solid var(--border)" }}>
          <div style={{ fontSize: 46, marginBottom: 8 }}>🚀</div>
          <div style={{ fontSize: 20, fontWeight: 900, color: "var(--text)", marginBottom: 10 }}>오늘 한도까지 다 바꿨어요!</div>
          <div style={{ fontSize: 13, color: "var(--text2)", lineHeight: 1.65, marginBottom: 20 }}>오늘 <b style={{ color: "#8b5cf6" }}>{bulkUpgrade.done}개</b>의 제목을 바꿨어요.<br />아직 <b style={{ color: "#f59e0b" }}>{bulkUpgrade.left}개</b>가 남았는데, 오늘 제목 수정 한도({titleEditLimit}회)를 다 썼어요.<br /><span style={{ fontSize: 12, color: "var(--text3)" }}>자정이 지나면 다시 할 수 있어요. 더 많이 하려면 등급을 올려보세요!</span></div>
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={() => setBulkUpgrade(null)} style={{ flex: 1, padding: "12px", borderRadius: 12, border: "1px solid var(--border)", background: "transparent", color: "var(--text3)", cursor: "pointer", fontSize: 12.5, fontWeight: 700, fontFamily: "inherit" }}>나중에</button>
            <button onClick={() => setBulkUpgrade(null)} style={{ flex: 1.4, padding: "12px", borderRadius: 12, border: "none", background: "linear-gradient(135deg,#8b5cf6,#a855f7)", color: "#fff", cursor: "pointer", fontSize: 13.5, fontWeight: 800, fontFamily: "inherit", boxShadow: "0 8px 20px -8px rgba(139,92,246,.6)" }}>등급 올리기 →</button>
          </div>
        </div>
      </div>
      </div>, document.body)}

    {isActive && welcome && createPortal(
      /* ★ body로 포탈되면 .app.dark/.light의 CSS변수(--card 등)가 안 먹혀 팝업이 투명해짐 → 테마 클래스로 변수 범위 복원(display:contents=레이아웃 영향 0) */
      <div className={theme === "dark" ? "app dark" : "app light"} style={{ display: "contents" }}>
      <div onClick={() => closeWelcome(false)} style={{ position: "fixed", inset: 0, zIndex: 100000, background: "rgba(12,10,20,.6)", backdropFilter: "blur(4px)", display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
        <style>{`
          @keyframes wcPop{0%{transform:scale(.6) translateY(30px);opacity:0}55%{transform:scale(1.04)}100%{transform:scale(1) translateY(0);opacity:1}}
          @keyframes wcBob{0%,100%{transform:translateY(0)}50%{transform:translateY(-11px)}}
          @keyframes wcRow{0%{opacity:0;transform:translateX(-10px)}100%{opacity:1;transform:translateX(0)}}
          @keyframes wcGlow{0%,100%{transform:scale(1);opacity:.85}50%{transform:scale(1.12);opacity:1}}
          @keyframes wcShadow{0%,100%{transform:translateX(-50%) scale(1);opacity:.85}50%{transform:translateX(-50%) scale(.8);opacity:.5}}
          /* ★ 캐릭터 팡! — 작게 아래서 튀어올라 크게 오버슈트 후 안착 */
          @keyframes wcHeroPop{0%{transform:scale(.2) translateY(60px) rotate(-18deg);opacity:0}45%{transform:scale(1.28) translateY(-10px) rotate(6deg);opacity:1}65%{transform:scale(.94) rotate(-3deg)}82%{transform:scale(1.06) rotate(1deg)}100%{transform:scale(1) translateY(0) rotate(0);opacity:1}}
          /* 뒤에서 회전하는 광선(sunburst) */
          @keyframes wcRays{0%{transform:rotate(0);opacity:0}30%{opacity:.9}100%{transform:rotate(360deg);opacity:.9}}
          /* 퍼져나가는 링 파동 */
          @keyframes wcRing{0%{transform:scale(.3);opacity:.9}100%{transform:scale(2.4);opacity:0}}
          /* 반짝이 별 */
          @keyframes wcSpark{0%,100%{transform:scale(0) rotate(0);opacity:0}50%{transform:scale(1) rotate(90deg);opacity:1}}
          /* 색종이 낙하 */
          @keyframes wcConfetti{0%{transform:translateY(-40px) rotate(0);opacity:0}12%{opacity:1}100%{transform:translateY(150px) rotate(540deg);opacity:0}}
        `}</style>
        <div onClick={e => e.stopPropagation()} style={{ position: "relative", background: "var(--card)", borderRadius: 24, padding: "34px 30px 26px", maxWidth: 440, width: "100%", boxShadow: "0 30px 90px -20px rgba(0,0,0,.55)", border: "1px solid var(--border)", animation: "wcPop .5s cubic-bezier(.22,1.4,.4,1) both", maxHeight: "90vh", overflowY: "auto" }}>
          <div style={{ textAlign: "center", marginBottom: 18 }}>
            {/* 🌱 주인공 캐릭터 — 화려하게 팡! 광선+링파동+색종이+반짝이+오버슈트 등장 */}
            <div style={{ position: "relative", width: 190, height: 178, margin: "0 auto 2px", overflow: "visible" }}>
              {/* 회전 광선(sunburst) */}
              <div style={{ position: "absolute", left: "50%", top: "46%", width: 200, height: 200, transform: "translate(-50%,-50%)", background: "conic-gradient(from 0deg, transparent 0 12deg, rgba(0,200,150,.16) 12deg 24deg, transparent 24deg 36deg, rgba(139,92,246,.14) 36deg 48deg)", borderRadius: "50%", animation: "wcRays 9s linear infinite", pointerEvents: "none" }} />
              {/* 퍼지는 링 파동 2개 */}
              <div style={{ position: "absolute", left: "50%", top: "46%", width: 120, height: 120, transform: "translate(-50%,-50%)", borderRadius: "50%", border: "2.5px solid rgba(0,200,150,.5)", animation: "wcRing 2.2s ease-out infinite", pointerEvents: "none" }} />
              <div style={{ position: "absolute", left: "50%", top: "46%", width: 120, height: 120, transform: "translate(-50%,-50%)", borderRadius: "50%", border: "2.5px solid rgba(139,92,246,.45)", animation: "wcRing 2.2s ease-out 1.1s infinite", pointerEvents: "none" }} />
              {/* 후광 */}
              <div style={{ position: "absolute", left: "50%", top: "46%", width: 150, height: 150, transform: "translate(-50%,-50%)", borderRadius: "50%", background: "radial-gradient(circle, rgba(0,200,150,.32), rgba(139,92,246,.12) 55%, transparent 72%)", animation: "wcGlow 2.6s ease-in-out infinite" }} />
              {/* 반짝이 별들 */}
              {[["12%","14%",".2s","#ffd23f",16],["82%","10%",".7s","#00c896",13],["6%","62%","1.1s","#8b5cf6",12],["88%","58%",".45s","#ff5fa2",15],["50%","2%","1.4s","#00c8ff",14]].map(([l,t,d,col,sz],k)=>(
                <div key={k} style={{ position: "absolute", left: l as string, top: t as string, fontSize: sz as number, color: col as string, animation: `wcSpark 1.8s ease-in-out ${d as string} infinite`, pointerEvents: "none", textShadow: `0 0 8px ${col}` }}>✦</div>
              ))}
              {/* 색종이 */}
              {[["20%","#ff5fa2",".1s"],["38%","#ffd23f",".5s"],["56%","#00c896",".3s"],["72%","#8b5cf6",".7s"],["30%","#00c8ff",".9s"],["64%","#ff922e",".2s"]].map(([l,col,d],k)=>(
                <div key={"c"+k} style={{ position: "absolute", left: l as string, top: -8, width: 7, height: 11, background: col as string, borderRadius: 2, animation: `wcConfetti 2.6s linear ${d as string} infinite`, pointerEvents: "none" }} />
              ))}
              {/* 바닥 그림자 */}
              <div style={{ position: "absolute", left: "50%", bottom: 6, transform: "translateX(-50%)", width: 88, height: 15, borderRadius: "50%", background: "rgba(0,0,0,.2)", filter: "blur(6px)", animation: "wcShadow 2.2s ease-in-out infinite" }} />
              {/* 캐릭터 본체 — 크게 + 팡 등장 + bob */}
              <div style={{ position: "absolute", left: "50%", top: "44%", transform: "translate(-50%,-50%)", animation: "wcHeroPop .9s cubic-bezier(.18,1.5,.5,1) both" }}>
                <img src={dodoImg} alt="주치의 도도" onError={e => { const s = document.createElement("div"); s.textContent = "🧑‍⚕️"; s.style.cssText = "font-size:120px;line-height:1"; e.currentTarget.replaceWith(s); }} style={{ display: "block", width: 150, height: 150, objectFit: "contain", animation: "wcBob 2.2s ease-in-out .9s infinite", filter: "drop-shadow(0 14px 26px rgba(0,200,150,.4))" }} />
              </div>
            </div>
            <div style={{ fontSize: 22, fontWeight: 900, color: "var(--text)", marginTop: 4, letterSpacing: "-.02em" }}>블로그 주치의에 오신 걸 환영해요! 🩺</div>
            <div style={{ fontSize: 12.5, color: "var(--text2)", marginTop: 7, lineHeight: 1.6 }}>글 하나하나를 <b style={{ color: "#00c896" }}>검색에 뜰 때까지</b> 제가 끝까지 데려갈게요.<br />이 순서대로만 하면 돼요 👇</div>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 9, marginBottom: 22 }}>
            {[
              { n: "1", ic: "📈", t: "블로그 진단 시작", d: "총 글·이웃·활동을 읽어 건강 점수를 내요.", c: "#00c896" },
              { n: "2", ic: "🔎", t: "검색 노출 검사", d: "내 글이 검색 몇 위인지 확인해요.", c: "#00b8d4" },
              { n: "3", ic: "♻️", t: "안 뜨는 글 살리기", d: "100위 밖 글은 제목을 바꿔 다시 올려요.", c: "#f59e0b" },
              { n: "4", ic: "🩺", t: "수정 추적 · 회진", d: "바꾼 글은 제가 완치까지 지켜봐요. 재촉 안 해요!", c: "#8b5cf6" },
            ].map((s, i) => (
              <div key={s.n} style={{ display: "flex", alignItems: "center", gap: 12, padding: "11px 13px", borderRadius: 12, background: "var(--bg)", border: "1px solid var(--border)", animation: `wcRow .4s ease both`, animationDelay: `${.15 + i * .1}s` }}>
                <div style={{ width: 30, height: 30, borderRadius: "50%", background: s.c, color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14, fontWeight: 900, flexShrink: 0 }}>{s.n}</div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 800, color: "var(--text)" }}>{s.ic} {s.t}</div>
                  <div style={{ fontSize: 11, color: "var(--text3)", marginTop: 2, lineHeight: 1.4 }}>{s.d}</div>
                </div>
              </div>
            ))}
          </div>
          <div style={{ fontSize: 11.5, color: "var(--text2)", textAlign: "center", marginBottom: 16, lineHeight: 1.55, padding: "10px 12px", borderRadius: 10, background: "rgba(139,92,246,.08)" }}>💜 <b>제 조언을 따르든, 무시하고 바로 바꾸든 자유예요.</b><br />다만 방금 바꾼 글은 30일은 기다려야 효과가 나와요 🌱</div>
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={() => closeWelcome(true)} style={{ flex: 1, padding: "12px", borderRadius: 12, border: "1px solid var(--border)", background: "transparent", color: "var(--text3)", cursor: "pointer", fontSize: 12.5, fontWeight: 700, fontFamily: "inherit" }}>일주일간 보지 않기</button>
            <button onClick={() => closeWelcome(false)} style={{ flex: 1.4, padding: "12px", borderRadius: 12, border: "none", background: "linear-gradient(135deg,#00c896,#00a878)", color: "#fff", cursor: "pointer", fontSize: 13.5, fontWeight: 800, fontFamily: "inherit", boxShadow: "0 8px 20px -8px rgba(0,200,150,.6)" }}>시작할게요 →</button>
          </div>
        </div>
      </div>
      </div>, document.body)}

    {/* 🎉 완치(노출) 축포 세리머니 — createPortal로 body에(transform 조상 무관), 하늘에서 색종이 낙하 */}
    {isActive && celebrate && createPortal(
      <div className={theme === "dark" ? "app dark" : "app light"} style={{ display: "contents" }}>
      <div onClick={() => setCelebrate(null)} style={{ position: "fixed", inset: 0, zIndex: 100000, background: "rgba(12,10,20,.62)", backdropFilter: "blur(4px)", display: "flex", alignItems: "center", justifyContent: "center", padding: 20, overflow: "hidden" }}>
        <style>{`@keyframes bdConfetti{0%{transform:translateY(-15vh) rotate(0);opacity:1}100%{transform:translateY(110vh) rotate(720deg);opacity:.85}}@keyframes bdPop{0%{transform:scale(.7);opacity:0}60%{transform:scale(1.05)}100%{transform:scale(1);opacity:1}}@keyframes bdBob{0%,100%{transform:translateY(0)}50%{transform:translateY(-10px)}}`}</style>
        {Array.from({ length: 70 }).map((_, i) => {
          const cols = ["#ff5fa2", "#ffd23f", "#00c896", "#8b5cf6", "#00c8ff", "#ff922e", "#ff4d6d"];
          const left = Math.random() * 100, dur = 2.2 + Math.random() * 2.3, delay = Math.random() * 1.6, w = 6 + Math.random() * 8;
          return <div key={i} style={{ position: "absolute", top: 0, left: `${left}%`, width: w, height: w * 1.7, background: cols[i % cols.length], borderRadius: 2, animation: `bdConfetti ${dur}s linear ${delay}s infinite` }} />;
        })}
        <div onClick={e => e.stopPropagation()} style={{ position: "relative", zIndex: 2, background: "var(--card)", borderRadius: 24, padding: "38px 42px", textAlign: "center", maxWidth: 460, width: "100%", boxShadow: "0 30px 90px -20px rgba(0,0,0,.55)", border: "1px solid var(--border)", animation: "bdPop .5s ease both" }}>
          {/* 🩺 주치의 도도가 크게 등장해 축하 — 주인공답게 */}
          <div style={{ position: "relative", width: 150, height: 150, margin: "0 auto 4px" }}>
            <div style={{ position: "absolute", inset: 0, borderRadius: "50%", background: "radial-gradient(circle at 50% 42%, rgba(0,200,150,.32), rgba(255,210,63,.12) 55%, transparent 72%)", animation: "wcGlow 2s ease-in-out infinite" }} />
            <div style={{ position: "absolute", left: "50%", top: 4, fontSize: 30, animation: "bdBob 1.2s ease-in-out infinite" }}>🎉</div>
            <img src={dodoImg} alt="주치의 도도" onError={e => { const s = document.createElement("div"); s.textContent = "🩺"; s.style.cssText = "font-size:104px;line-height:150px"; e.currentTarget.replaceWith(s); }} style={{ position: "relative", width: 130, height: 130, marginTop: 12, objectFit: "contain", animation: "bdBob 1.4s ease-in-out infinite", filter: "drop-shadow(0 12px 22px rgba(0,200,150,.4))" }} />
          </div>
          <div style={{ fontSize: 25, fontWeight: 900, color: "var(--text)", marginBottom: 8, letterSpacing: "-.02em" }}>노출 축하드립니다!</div>
          <div style={{ fontSize: 14, color: "var(--text2)", lineHeight: 1.65, marginBottom: 22 }}>
            {celebrate.length === 1
              ? <>«{(celebrate[0].title || "이 글").slice(0, 26)}» 글이<br />드디어 <b style={{ color: "#00c896" }}>네이버 검색에 떴어요!</b><br /><span style={{ fontSize: 12.5, color: "var(--text3)" }}>주치의가 끝까지 함께했어요 🩺</span></>
              : <><b style={{ color: "#00c896", fontSize: 18 }}>{celebrate.length}개</b>의 글이 한 번에 검색에 떴어요! 🔥<br /><span style={{ fontSize: 12.5, color: "var(--text3)" }}>대단한 회복이에요, 주치의도 뿌듯해요 🩺</span></>}
          </div>
          <button onClick={() => setCelebrate(null)} style={{ padding: "13px 34px", borderRadius: 13, border: "none", background: "linear-gradient(135deg,#00c896,#00a878)", color: "#fff", fontSize: 15, fontWeight: 800, cursor: "pointer", fontFamily: "inherit", boxShadow: "0 10px 24px -8px rgba(0,200,150,.6)" }}>고마워요 🩺</button>
        </div>
      </div>
      </div>, document.body)}
    </div>
  );
}
