import { useState, useRef, useEffect } from "react";
import { BotEventStream, botFetch } from "../lib/botApi";
import UsageGuide from "./UsageGuide";
import SproutAssistant from "./SproutAssistant";
import BacklinkTab from "./BacklinkTab";
import { INFLOW_DAILY_LIMIT, PLAN_CONFIG, getInflowDailyUsage, getInflowUsageHistory, getAccounts, PublyAccount, getAutopilot, saveAutopilot, getRankHistory, AutopilotConfig, getInflowSchedule, saveInflowSchedule, inflowScheduleRanToday, markInflowScheduleRan, getPerfReport, PerfReport, recordRankPoint, getMemberSessionToken, getAdminSessionToken, getInflowTargets, saveInflowTargets, inflowScope, getInflowStatToday, migrateLegacyInflowToScope, sendTrafficLog } from "../lib/supabase";

const BOT = "http://127.0.0.1:3364"; // neighbor-bot

/* ═══════════════════════════════════════════════════════════════
   🆕 NEW 트래픽 유입 — CONTROL TOWER
   키워드 검색 → 클릭 → 글 전체 읽는 체류 → 저장/공감/공유/길찾기/전화/예약/톡톡 → 이탈
   방문마다 프록시 IP 자동 로테이션 · 안전 한도 안에서만. 회원=관리자 동일.
   관제탑형 대시보드: KPI 지표 + 7일 유입 그래프 + 실행패널 + 라이브 로그.
   ═══════════════════════════════════════════════════════════════ */

const THEMES = {
  light: { bg: "#f1eef9", panel: "#ffffff", panel2: "#f7f4fc", ink: "#1a1426", sub: "#6b6480", line: "#e8e3f2", line2: "#dcd4ec", accent: "#6d28d9", cyan: "#8b5cf6", glow: "rgba(109,40,217,.14)", kpiBg: "linear-gradient(135deg,#ffffff,#f6f2fc)", logBg: "#160f22", logInk: "#d6ccea" },
  dark: { bg: "#0d0a14", panel: "#1a1526", panel2: "#221b30", ink: "#efeafb", sub: "#a89fbd", line: "#332b42", line2: "#413650", accent: "#a78bfa", cyan: "#c4b5fd", glow: "rgba(167,139,250,.20)", kpiBg: "linear-gradient(135deg,#1e1830,#150f24)", logBg: "#0a0713", logInk: "#c8bce0" },
};

const PLAN_ORDER = ["free", "basic", "pro"] as const; // ⚖️ 무제한은 관리자 고유 — 표엔 안 넣음

// 블로그 글 주소 → { blogId, logNo } 자동 인식.
function parseBlogUrl(input: string): { blogId: string; logNo: string } | null {
  const s = (input || "").trim();
  if (!s) return null;
  if (/blogId=/i.test(s)) { const b = s.match(/blogId=([A-Za-z0-9_-]+)/i)?.[1]; const l = s.match(/logNo=(\d+)/i)?.[1]; if (b) return { blogId: b, logNo: l || "" }; }
  const m = s.match(/blog\.naver\.com\/([A-Za-z0-9_-]+)(?:\/(\d+))?/i);
  if (m) return { blogId: m[1], logNo: m[2] || "" };
  const plain = s.match(/^([A-Za-z0-9_-]+)(?:\/(\d+))?$/);
  if (plain) return { blogId: plain[1], logNo: plain[2] || "" };
  return null;
}

// 플레이스 주소에서 가게 번호(placeId) 추출 — 인식 확인 배지용. 단축주소(naver.me)는 서버가 펼치므로 여기선 "확인예정".
function extractPlaceId(input: string): string | null {
  const s = String(input || "");
  const m = s.match(/(?:pcmap\.place|m\.place|place)\.naver\.com\/[a-z]+\/(\d{5,})/i)
    || s.match(/entry\/place\/(\d{5,})/i)
    || s.match(/\/place\/(\d{5,})/i)
    || s.match(/[?&]placeId=(\d{5,})/i)
    || s.match(/^\s*(\d{6,})\s*$/);
  return m ? m[1] : null;
}
const isShortUrl = (s: string) => /naver\.me\/|me2\.do\//i.test(String(s || ""));

// 🛒 스마트스토어 상품 주소 → { storeId, productId } 인식
function parseStoreUrl(input: string): { storeId: string; productId: string } | null {
  const s = (input || "").trim();
  if (!s) return null;
  if (!/smartstore\.naver\.com|shopping\.naver\.com|brand\.naver\.com/i.test(s)) return null;
  const storeId = s.match(/(?:smartstore|brand)\.naver\.com\/([A-Za-z0-9_-]+)/i)?.[1] || "";
  const productId = s.match(/products\/(\d+)/i)?.[1] || s.match(/\/(\d{6,})/)?.[1] || "";
  if (!storeId && !productId) return null;
  return { storeId, productId };
}

// 🔎 주소만 보고 플레이스/블로그/스토어 자동 감지(탭 안 바꿔도 되게)
function detectTargetType(input: string): "place" | "blog" | "store" | null {
  const s = (input || "").toLowerCase();
  if (/smartstore\.naver|shopping\.naver|brand\.naver/.test(s)) return "store";
  if (/place\.naver|map\.naver|naver\.me|pcmap|entry\/place/.test(s)) return "place";
  if (/blog\.naver|blogid=|\/postview/.test(s)) return "blog";
  return null;
}

// 📈 7일 유입 추이 — 부드러운 area 라인 SVG(라이브러리 없이)
function AreaChart({ data, C }: { data: { label: string; count: number }[]; C: any }) {
  const W = 100, H = 44, pad = 3;
  const max = Math.max(1, ...data.map((d) => d.count));
  const n = data.length;
  const step = n > 1 ? (W - pad * 2) / (n - 1) : 0;
  const pts = data.map((d, i) => [pad + i * step, H - pad - (d.count / max) * (H - pad * 2)]);
  const line = pts.map((p) => `${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(" ");
  const area = `${pad},${H - pad} ${line} ${(pad + (n - 1) * step).toFixed(1)},${H - pad}`;
  const [hover, setHover] = useState<number | null>(null);
  const onMove = (e: any) => {
    const r = e.currentTarget.getBoundingClientRect(); const rel = (e.clientX - r.left) / r.width;
    setHover(Math.max(0, Math.min(n - 1, Math.round(rel * (n - 1)))));
  };
  return (
    <div style={{ position: "relative" }} onMouseMove={onMove} onMouseLeave={() => setHover(null)}>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" style={{ width: "100%", height: 120, display: "block" }}>
        <defs>
          <linearGradient id="inflowArea" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={C.accent} stopOpacity="0.35" />
            <stop offset="100%" stopColor={C.accent} stopOpacity="0" />
          </linearGradient>
        </defs>
        <polygon points={area} fill="url(#inflowArea)" />
        <polyline points={line} fill="none" stroke={C.accent} strokeWidth="1.3" strokeLinejoin="round" strokeLinecap="round" />
        {hover != null && <line x1={pts[hover][0]} y1="0" x2={pts[hover][0]} y2={H} stroke={C.accent} strokeWidth="0.5" opacity="0.5" />}
        {pts.map((p, i) => <circle key={i} cx={p[0]} cy={p[1]} r={hover === i ? 2.2 : 1.1} fill={C.cyan} />)}
      </svg>
      {hover != null && data[hover] && (
        <div style={{ position: "absolute", top: 4, left: `${(pts[hover][0] / W) * 100}%`, transform: "translateX(-50%)", background: C.ink, color: C.panel, fontSize: 11, fontWeight: 800, padding: "3px 8px", borderRadius: 6, whiteSpace: "nowrap", pointerEvents: "none" }}>{data[hover].label} · {data[hover].count}회</div>
      )}
    </div>
  );
}

// 📉 순위 변동 그래프 — 위로 갈수록 상위(순위는 작을수록 좋음, y축 반전). 결측(null)은 이어붙임.
function RankChart({ data, goal, C }: { data: { label: string; rank: number | null }[]; goal: number; C: any }) {
  const W = 100, H = 44, pad = 4;
  const vals = data.map((d) => d.rank).filter((r): r is number => r != null);
  if (vals.length === 0) return <div style={{ height: 120, display: "flex", alignItems: "center", justifyContent: "center", color: C.sub, fontSize: 12.5, fontWeight: 600 }}>순위가 측정되면 그래프가 그려져요</div>;
  const maxR = Math.max(goal + 2, ...vals), minR = Math.min(1, ...vals);
  const n = data.length, step = n > 1 ? (W - pad * 2) / (n - 1) : 0;
  const y = (r: number) => pad + ((r - minR) / Math.max(1, maxR - minR)) * (H - pad * 2); // 순위 클수록 아래
  const pts = data.map((d, i) => d.rank == null ? null : [pad + i * step, y(d.rank)] as [number, number]).filter(Boolean) as [number, number][];
  const line = pts.map((p) => `${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(" ");
  const goalY = y(goal);
  // 툴팁 — 측정값 있는 지점만
  const measured = data.map((d, i) => d.rank != null ? { i, rank: d.rank, label: d.label, x: pad + i * step, yy: y(d.rank) } : null).filter(Boolean) as { i: number; rank: number; label: string; x: number; yy: number }[];
  const [hover, setHover] = useState<number | null>(null);
  const onMove = (e: any) => {
    const r = e.currentTarget.getBoundingClientRect(); const relX = ((e.clientX - r.left) / r.width) * W;
    let best = 0, bd = Infinity; measured.forEach((m, idx) => { const d = Math.abs(m.x - relX); if (d < bd) { bd = d; best = idx; } });
    setHover(measured.length ? best : null);
  };
  return (
    <div style={{ position: "relative" }} onMouseMove={onMove} onMouseLeave={() => setHover(null)}>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" style={{ width: "100%", height: 120, display: "block" }}>
        <line x1="0" y1={goalY} x2={W} y2={goalY} stroke={C.cyan} strokeWidth="0.6" strokeDasharray="2 2" opacity="0.7" />
        <polyline points={line} fill="none" stroke="#16a34a" strokeWidth="1.4" strokeLinejoin="round" strokeLinecap="round" />
        {pts.map((p, i) => <circle key={i} cx={p[0]} cy={p[1]} r="1.3" fill="#16a34a" />)}
        {hover != null && measured[hover] && <circle cx={measured[hover].x} cy={measured[hover].yy} r="2.4" fill="#16a34a" stroke="#fff" strokeWidth="0.6" />}
      </svg>
      {hover != null && measured[hover] && (
        <div style={{ position: "absolute", top: 4, left: `${(measured[hover].x / W) * 100}%`, transform: "translateX(-50%)", background: C.ink, color: C.panel, fontSize: 11, fontWeight: 800, padding: "3px 8px", borderRadius: 6, whiteSpace: "nowrap", pointerEvents: "none" }}>{measured[hover].label} · {measured[hover].rank}위</div>
      )}
    </div>
  );
}

export default function InflowCenter({ showToast, theme: extTheme, userId, plan = "free", allowedFeatures, licenseSaver, licenseByFeat, licenseRemainByFeat, onActiveToolChange, onManageAccounts, onBusyChange, memberMode, externalAccounts, memberEmail, memberName }: { showToast?: (m: string, t?: any) => void; theme?: "dark" | "light"; userId?: string; plan?: string; allowedFeatures?: ("place" | "blog" | "store" | "backlink")[]; licenseSaver?: string; licenseByFeat?: Record<string,{limit:number;actions:string[];plan:string}>; licenseRemainByFeat?: Record<string, number>; onActiveToolChange?: (tool: "place" | "blog" | "store" | "backlink") => void; onManageAccounts?: () => void; onBusyChange?: (busy: boolean) => void; memberMode?: boolean; externalAccounts?: PublyAccount[]; memberEmail?: string; memberName?: string }) {
  const toast = (m: string, t?: string) => showToast?.(m, t);
  // 🎫 승인된 기능만 노출 — 컨트롤타워에서 이 고객에게 켜준 대상만 탭으로 보인다.
  //   회원앱(memberMode)=엄격: 승인된 것만(승인 없으면 아무것도 안 보임=잠금).
  //   관리자앱(memberMode 아님)=미지정이면 전부 허용(관리자는 다 봐야 함).
  const FEATS: ("place" | "blog" | "store" | "backlink")[] = ["place", "blog", "store", "backlink"];
  const allowFeat = (f: "place" | "blog" | "store" | "backlink") => memberMode
    ? (!!allowedFeatures && allowedFeatures.includes(f))
    : (!allowedFeatures || allowedFeatures.length === 0 || allowedFeatures.includes(f));
  const visibleFeats = FEATS.filter(allowFeat);
  const backlinkAllowed = allowFeat("backlink");
  const inflowFeats = visibleFeats.filter((f): f is "place" | "blog" | "store" => f !== "backlink");  // 유입 대상만(백링크 제외)
  const theme: "dark" | "light" = extTheme === "dark" ? "dark" : "light";
  const C = THEMES[theme];

  // 🔁 탭을 옮겨도·앱을 껐다 켜도 입력값이 유지되게 — 고정 키(userId 무관, 로그인 로딩중 초기화 방지)
  //   ★2026-09-09(테리, git비교): 관리자페이지(AdminPage)와 회원앱(TrafficApp)이 이 키를 '공유'했다.
  //   회원앱은 licenseSaver=ultra가 dataSaver를 매번 초절약(max)으로 강제해 이 키에 저장 → 관리자가 절약으로
  //   바꿔도 재설치·새로고침하면 회원앱이 오염시킨 초절약을 다시 읽어 되돌아갔다(v2.10.188 userTouchedSaverRef로도
  //   못 잡던 진짜 원인). 테리 지시대로 '관리자↔회원 각각 분리' → memberMode로 키를 나눈다.
  const formKey = memberMode ? "publy_inflow_form" : "publy_inflow_form_admin";
  const saved0: any = (() => { try { return JSON.parse(localStorage.getItem(formKey) || "{}"); } catch { return {}; } })();
  const [targetType, setTargetType] = useState<"place" | "blog" | "store">(saved0.targetType ?? "place");
  const [blTab, setBlTab] = useState(false);  // 🔗 백링크 탭 활성(유입 targetType과 분리 — 유입 로직 안 건드림)
  // 🎫 현재 대상이 미승인이면 승인된 첫 대상으로 자동 전환(미승인 화면에 갇히지 않게)
  useEffect(() => { if (inflowFeats.length && !allowFeat(targetType)) setTargetType(inflowFeats[0]); }, [allowedFeatures, targetType]);
  // 🎫 현재 선택 탭을 부모(TrafficApp)에 알림 → 하단 대여 그래프가 그 탭 만료 기준으로 바뀜(탭마다 만료 다름).
  useEffect(() => { onActiveToolChange?.(blTab ? "backlink" : targetType); }, [blTab, targetType, onActiveToolChange]);
  // 🎫 현재 대상의 라이선스 등급 한도.
  //   ★트래픽은 결제 별도 → 회원앱(memberMode)은 퍼블리 등급(user.plan)을 절대 안 탄다.
  //     오직 컨트롤타워 발급(featLic)만으로 한도·무제한 결정(featLic 없으면 0=차단, 어차피 승인없으면 잠금화면).
  //   관리자앱(memberMode 아님)은 종전대로 user.plan도 반영.
  const featLic = licenseByFeat?.[targetType];
  const unlimited = memberMode
    ? (featLic?.plan === "unlimited" || featLic?.limit === 0)
    : (plan === "admin" || plan === "unlimited" || featLic?.plan === "unlimited" || featLic?.limit === 0);
  const limit = memberMode
    ? (featLic ? (featLic.limit || 0) : 0)
    : (featLic ? (featLic.limit || 0) : (INFLOW_DAILY_LIMIT[plan] ?? INFLOW_DAILY_LIMIT.free));
  // 관리자가 허용한 행동만(없으면 전체 허용 — 라이선스 미설정 하위호환). actionAllowed(key)로 게이팅.
  const actionAllowed = (key: string) => !featLic || !featLic.actions ? true : featLic.actions.includes(key);
  const privateKey = `publy_inflow_private_${userId || "guest"}`;
  const private0: any = (() => { try { return JSON.parse(localStorage.getItem(privateKey) || "{}"); } catch { return {}; } })();
  const [placeUrl, setPlaceUrl] = useState<string>(private0.placeUrl ?? saved0.placeUrl ?? "");
  const [blogUrl, setBlogUrl] = useState<string>(private0.blogUrl ?? saved0.blogUrl ?? "");
  const [storeUrl, setStoreUrl] = useState<string>(private0.storeUrl ?? saved0.storeUrl ?? "");
  // 📚 블로그 글 지정 유입 — 팝업(글주소 직접 / 로그인해서 내 글 불러오기)
  const [myPosts, setMyPosts] = useState<{ url: string; title: string; date: string }[]>([]);
  const [selectedPosts, setSelectedPosts] = useState<Set<string>>(new Set());
  const [myPostsLoading, setMyPostsLoading] = useState(false);
  const [postPopup, setPostPopup] = useState<null | "manual" | "login">(null); // 어떤 팝업이 열렸나
  const [manualPostUrls, setManualPostUrls] = useState<string>("");             // 글주소 직접 입력(줄바꿈 여러 개)
  const [popupAccountId, setPopupAccountId] = useState<string>("");             // 로그인 팝업에서 고른 계정
  const [pickedPostCount, setPickedPostCount] = useState<number>(0);            // 지정된 글 개수(요약 표시)
  // 📅 글 불러올 때 기간 필터: 전체 / 최근 N일 / 날짜 지정(시작~종료)
  const [postDateMode, setPostDateMode] = useState<"all" | "recent" | "range">("all");
  const [postRecentDays, setPostRecentDays] = useState<number>(30);
  const [postFrom, setPostFrom] = useState<string>("");                          // yyyy-mm-dd
  const [postTo, setPostTo] = useState<string>("");                             // yyyy-mm-dd
  // 🔑 키워드는 플레이스/블로그가 완전히 별개(서로 섞이면 안 됨). 각각 저장하고, 현재 대상 것만 표시·수정.
  const [keywordsPlace, setKeywordsPlace] = useState<string>(saved0.keywordsPlace ?? (saved0.targetType !== "blog" ? saved0.keywords : "") ?? "");
  const [keywordsBlog, setKeywordsBlog] = useState<string>(saved0.keywordsBlog ?? (saved0.targetType === "blog" ? saved0.keywords : "") ?? "");
  const [keywordsStore, setKeywordsStore] = useState<string>(saved0.keywordsStore ?? ""); // 🛒 스토어 키워드 격리(블로그·플레이스와 안 섞임)
  const keywords = targetType === "place" ? keywordsPlace : targetType === "store" ? keywordsStore : keywordsBlog;
  const setKeywords = targetType === "place" ? setKeywordsPlace : targetType === "store" ? setKeywordsStore : setKeywordsBlog;
  const [rounds, setRounds] = useState<number>(saved0.rounds ?? 10);
  const [termMin, setTermMin] = useState<number>(saved0.termMin ?? 30);
  const [termMax, setTermMax] = useState<number>(saved0.termMax ?? 90);
  const [device, setDevice] = useState<"mobile" | "pc" | "mix">(saved0.device ?? "mobile");
  // 액션
  const [doSave, setDoSave] = useState(saved0.doSave ?? true);
  const [doShare, setDoShare] = useState(saved0.doShare ?? false);
  const [doDir, setDoDir] = useState(saved0.doDir ?? true);
  const [doCall, setDoCall] = useState(saved0.doCall ?? false);
  const [doBook, setDoBook] = useState(saved0.doBook ?? false);
  const [doTalk, setDoTalk] = useState(saved0.doTalk ?? false);
  const [doLike, setDoLike] = useState(saved0.doLike ?? true);
  // 🛒 스마트스토어 액션
  const [doWish, setDoWish] = useState(saved0.doWish ?? true);      // 💚 찜(로그인 필요)
  const [doCart, setDoCart] = useState(saved0.doCart ?? false);     // 🛒 장바구니(로그인 필요)
  const [doOption, setDoOption] = useState(saved0.doOption ?? true); // 🔍 옵션·상세 탐색(로그인 불필요)
  const [funnel, setFunnel] = useState(saved0.funnel ?? false);
  const [spread, setSpread] = useState(saved0.spread ?? false);   // ⏱️ 시간 분산
  const [spreadHours, setSpreadHours] = useState<number>(saved0.spreadHours ?? 3);
  const [doReview, setDoReview] = useState<boolean>(saved0.doReview ?? false); // ✍️ 리뷰(관리자 락)
  const [doNeighbor, setDoNeighbor] = useState<boolean>(saved0.doNeighbor ?? false); // 👥 이웃추가(블로그·로그인 필요)
  const [reviewText, setReviewText] = useState<string>(saved0.reviewText ?? "");
  const [auto, setAuto] = useState(saved0.auto ?? false);
  const [actionRate, setActionRate] = useState<number>(saved0.actionRate ?? 100); // 🎲 액션 발동 확률(%)
  const [intensity, setIntensity] = useState<"fast" | "normal" | "deep">(saved0.intensity ?? "normal"); // 📖 체류 강도
  const [maxDwellSec, setMaxDwellSec] = useState<number>(saved0.maxDwellSec ?? 0); // 0=강도 사용, >0=직접지정 확정값
  const [dwellDraft, setDwellDraft] = useState<string>(String(saved0.maxDwellSec ?? 30)); // 직접지정 입력 임시값(설정 버튼 눌러야 확정)
  const [dataSaver, setDataSaver] = useState<"normal" | "save" | "max">(saved0.dataSaver ?? "save"); // 💾 데이터(프록시) 절약 모드
  const [dataSaverInfo, setDataSaverInfo] = useState(false); // ⓘ 설명 팝업
  // ★2026-09-08(테리): 예전엔 관리자 licenseSaver를 매 폴링마다 강제 적용 → 회원이 '절약'으로 바꿔도 20초 뒤 초절약으로
  //   되돌아감(백링크 무제한 튐과 동일 버그). 이제 licenseSaver는 '기본값'으로만 쓰고, 회원이 직접 바꾸면 그 선택을 존중한다.
  const userTouchedSaverRef = useRef(false);   // 회원이 데이터절약을 직접 눌렀나
  const licenseSaverLocked = false;             // 회원이 항상 바꿀 수 있게(스토어는 이미지 필요 → 절약 선택 필수)
  useEffect(() => {
    if (!licenseSaver || userTouchedSaverRef.current) return;   // 회원이 손댔으면 폴링이 안 덮음
    const m = licenseSaver === "ultra" ? "max" : licenseSaver === "save" ? "save" : "normal";
    setDataSaver(m as any);
  }, [licenseSaver]);
  const chooseDataSaver = (m: "normal" | "save" | "max") => { userTouchedSaverRef.current = true; setDataSaver(m); };
  // ➕ 추가 대상(주소 목록) — 대상(플레이스/블로그/스토어)별로 격리(서로 섞이지 않게)
  const [extraByType, setExtraByType] = useState<{ place: string[]; blog: string[]; store: string[] }>(() => {
    const legacy = private0.extraTargets ?? saved0.extraTargets ?? [];
    const seed = private0.extraByType ?? { place: [], blog: [], store: [] };
    // 기존 단일 목록은 그때 대상 타입에 귀속(이전 데이터 보존)
    if (legacy.length && !private0.extraByType) { const t = (saved0.targetType ?? "place") as "place" | "blog" | "store"; seed[t] = legacy; }
    return { place: seed.place || [], blog: seed.blog || [], store: seed.store || [] };
  });
  const extraTargets = extraByType[targetType];
  const setExtraTargets = (updater: string[] | ((arr: string[]) => string[])) => setExtraByType((prev) => ({ ...prev, [targetType]: typeof updater === "function" ? (updater as any)(prev[targetType]) : updater }));
  // 🏪 내 플레이스/블로그 저장 목록(이름+주소) — 여러 개 저장해두고 골라 쓰기
  type SavedTarget = { id: string; name: string; url: string; type: "place" | "blog" | "store" };
  const savedTargetsKey = `publy_inflow_saved_targets_${userId || "guest"}`;
  const [savedTargets, setSavedTargets] = useState<SavedTarget[]>(() => { try { return JSON.parse(localStorage.getItem(savedTargetsKey) || localStorage.getItem("publy_inflow_saved_targets") || "[]"); } catch { return []; } });
  const [savingName, setSavingName] = useState("");
  const persistSavedTargets = (list: SavedTarget[]) => {
    setSavedTargets(list);
    try { localStorage.setItem(savedTargetsKey, JSON.stringify(list)); } catch {}
    // 🏪 서버 영구저장 — 앱 재설치·다른 기기에서도 유지(회원 데이터 보존)
    if (userId) saveInflowTargets(userId, list).catch(() => {});
  };
  const [advOpen, setAdvOpen] = useState(false);       // ⚙️ 고급 설정 펼침
  const [kwWeights, setKwWeights] = useState<Record<string, number>>(saved0.kwWeights ?? {}); // 키워드별 비중
  const [visible, setVisible] = useState(false); // 🪟 창 보기(테스트) — 저장 안 함(안전상 매번 꺼짐)
  const [accountId, setAccountId] = useState("");
  const [selectedAccts, setSelectedAccts] = useState<Set<string>>(new Set()); // 🔄 다계정 로테이션(저장·찜·공감을 여러 계정으로)
  const [accountsInternal, setAccounts] = useState<PublyAccount[]>([]);
  // 🔗 부모(TrafficApp)가 계정을 넘기면 그걸 우선 사용 → 헤더에서 연결하면 팝업에도 즉시 반영(계정 안 뜨는 버그 해결)
  const accounts = externalAccounts ?? accountsInternal;
  // 🔀 탭(플레이스/블로그/스토어)별 독립 실행 — 봇(3363)은 동시 3개 처리 가능. 상태를 대상별로 분리해 각자 돌린다.
  //   화면에는 현재 탭 것을 파생값으로 보여준다(running/logs/progress/sessOk). backlink는 blTab로 이미 별개.
  type RunTT = "place" | "blog" | "store";
  const [runningTypes, setRunningTypes] = useState<Record<RunTT, boolean>>({ place: false, blog: false, store: false });
  const setRunningFor = (t: RunTT, v: boolean) => setRunningTypes((p) => ({ ...p, [t]: v }));
  // ★2026-09-07 테리: '이어하기' 개념 제거 — 그만두면 완전 취소, 다시 시작하면 항상 새 설정으로 처음부터
  //   (이어하기가 최초 설정을 물고 가서 수정한 설정이 무시되던 버그 근본해결).
  const anyRunning = runningTypes.place || runningTypes.blog || runningTypes.store;
  const running = runningTypes[(targetType as RunTT)] ?? false;   // 현재 탭 실행 여부(렌더·기존 로직 호환)
  type InflowLogEntry = { type: "text"; text: string } | { type: "shot"; caption: string; dataUrl: string };
  const [logsByType, setLogsByType] = useState<Record<RunTT, InflowLogEntry[]>>({ place: [], blog: [], store: [] });
  const logs = logsByType[(targetType as RunTT)] ?? [];
  const [logZoom, setLogZoom] = useState(false);   // 🔍 로그 크게 보기(앱 내 모달)
  const [used, setUsed] = useState(0);            // 전체 하루 한도 사용량(한도 계산용)
  const [todayScoped, setTodayScoped] = useState(0); // 현재 대상의 오늘 유입(KPI 표시용, 대상별 분리)
  const [progressByType, setProgressByType] = useState<Record<RunTT, number>>({ place: 0, blog: 0, store: 0 });
  const progress = progressByType[(targetType as RunTT)] ?? 0;
  const setProgressFor = (t: RunTT, v: number) => setProgressByType((p) => ({ ...p, [t]: v }));
  const [sessOkByType, setSessOkByType] = useState<Record<RunTT, number>>({ place: 0, blog: 0, store: 0 }); // 이번 실행 성공 수(탭별)
  const sessOk = sessOkByType[(targetType as RunTT)] ?? 0;
  const setSessOkFor = (t: RunTT, v: number) => setSessOkByType((p) => ({ ...p, [t]: v }));
  const [history, setHistory] = useState<{ label: string; count: number }[]>([]);
  // 🎯 오토파일럿
  const [apEnabled, setApEnabled] = useState(false);
  const [apGoal, setApGoal] = useState(5);
  const [apKeyword, setApKeyword] = useState("");
  const [apLastRank, setApLastRank] = useState<number | null>(null);
  const [apRankOut, setApRankOut] = useState(false); // 최근 측정에서 30위 밖이었나(현재순위 '30+' 표시용)
  const [rankHist, setRankHist] = useState<{ label: string; rank: number | null }[]>([]);
  // 📊 성과 리포트(주간/월간)
  const [reportPeriod, setReportPeriod] = useState<"week" | "month">("week");
  const [chartDays, setChartDays] = useState<number>(7); // 📅 그래프·누적 기간(7/30/90일·365=전체)
  const [report, setReport] = useState<PerfReport | null>(null);
  // 🩺 플레이스 최적화 진단
  const [diagLoading, setDiagLoading] = useState(false);
  const [diag, setDiag] = useState<{ score: number; items: { key: string; label: string; ok: boolean; value: string; tip: string }[] } | null>(null);
  // 🥊 경쟁사 추적
  const [compLoading, setCompLoading] = useState(false);
  const [comp, setComp] = useState<{ top: { rank: number; name: string; category: string; review: number; blog: number; isMine: boolean }[]; myRank: number | null } | null>(null);
  // 🔎 키워드 발굴
  const [kwLoading, setKwLoading] = useState(false);
  // 🎯 키워드 도우미 — 추천 결과에 출처(자동완성=실검색어/연관=함께찾음)+검색량(vol, 검색광고 API 연동 시)
  const [kwSuggest, setKwSuggest] = useState<{ keyword: string; source: string; vol?: number; comp?: string }[]>([]);
  // 🧩 조합 생성기 입력(지역·업종·메뉴/목적) — "고객이 치는 말"로 메인+세부 키워드 자동 조합
  const [cbRegion, setCbRegion] = useState("");
  const [cbType, setCbType] = useState("");
  const [cbExtra, setCbExtra] = useState("");
  // 💬 리뷰 감정분석
  const [revLoading, setRevLoading] = useState(false);
  const [revResult, setRevResult] = useState<{ total: number; likes: { word: string; n: number }[]; dislikes: { word: string; n: number }[] } | null>(null);
  // 📘 블로그 진단(blog 전용) — 기존 자산 crawlBlogStats / /api/blog-stats 재사용
  const [blogDiagLoading, setBlogDiagLoading] = useState(false);
  const [blogDiag, setBlogDiag] = useState<any>(null);
  const [blogDiagAcctId, setBlogDiagAcctId] = useState<string>("");
  // 🛒 스토어 상품 진단(store 전용) — /api/store-info(리뷰수·찜·평점·가격)
  const [storeInfoLoading, setStoreInfoLoading] = useState(false);
  const [storeInfo, setStoreInfo] = useState<any>(null);
  // ⏰ 예약 실행
  const [schedEnabled, setSchedEnabled] = useState(false);
  const [schedTime, setSchedTime] = useState("10:00");
  const [schedRounds, setSchedRounds] = useState(10);
  // 💤 화면·시스템 절전 방지 — 유입 실행중(텀 대기 포함) OR 예약 대기 OR 오토파일럿 가동 중이면 안 꺼지게(부모 keepAwake).
  useEffect(() => { onBusyChange?.(anyRunning || schedEnabled || apEnabled); }, [anyRunning, schedEnabled, apEnabled]);
  // 🔴 관리자가 승인을 취소하면(허용 대상이 줄면) — 실행 중이면 즉시 정지 + 화면 새로고침(회원앱만)
  const prevFeatsRef = useRef<("place"|"blog"|"store"|"backlink")[] | undefined>(undefined);
  useEffect(() => {
    if (!memberMode) { prevFeatsRef.current = allowedFeatures; return; }
    const prev = prevFeatsRef.current;
    const now = allowedFeatures || [];
    if (prev !== undefined) {
      const removed = prev.filter((f) => !now.includes(f));
      if (removed.length) {
        (["place", "blog", "store"] as RunTT[]).forEach((t) => { try { esRefByType.current[t]?.close(); } catch {} esRefByType.current[t] = null; });
        setRunningTypes({ place: false, blog: false, store: false });
        toast("관리자가 일부 승인을 취소했어요. 실행을 멈추고 새로고침합니다.", "info");
        setTimeout(() => { try { window.location.reload(); } catch {} }, 1400);
      }
    }
    prevFeatsRef.current = now;
  }, [allowedFeatures, memberMode]);
  type InflowNotification = { id: string; message: string; createdAt: string };
  const notificationKey = `publy_inflow_notifications_${userId || "guest"}`;
  const [notifications, setNotifications] = useState<InflowNotification[]>(() => {
    try { return JSON.parse(localStorage.getItem(`publy_inflow_notifications_${userId || "guest"}`) || "[]"); }
    catch { return []; }
  });
  const automationRunningRef = useRef(false);
  const scheduledRunPendingRef = useRef(false);
  const scheduledRunScopeRef = useRef(""); // 예약 실행 시작 시점의 대상 scope 고정(실행 중 대상 변경 대비)
  const skipPrivateSaveRef = useRef(false);
  const esRefByType = useRef<Record<RunTT, BotEventStream | null>>({ place: null, blog: null, store: null });
  const startRef = useRef<() => void>(() => {});
  // 🎯 오토파일럿 자동 순위 체크(목표 달성 여부) — 최신 값 참조용 ref
  const autopilotCheckRef = useRef<() => Promise<{ measured: boolean; reached: boolean }>>(async () => ({ measured: false, reached: false }));
  const logBoxRef = useRef<HTMLDivElement | null>(null);

  // 로그는 대상(탭)별 배열에 쌓는다. appendLog=현재 탭, appendLogFor(t)=특정 탭(실행 콜백은 시작 시점 탭 runType에 명시적으로 쌓아 탭 이동해도 안 섞임).
  const appendLogFor = (t: RunTT, entry: InflowLogEntry) => setLogsByType((cur) => {
    let next = [...(cur[t] || []), entry].slice(-300);
    const shots = next.reduce((count, item) => count + (item.type === "shot" ? 1 : 0), 0);
    if (shots > 8) { const firstShot = next.findIndex((item) => item.type === "shot"); if (firstShot >= 0) next = next.filter((_, index) => index !== firstShot); }
    return { ...cur, [t]: next };
  });
  const clearLogsFor = (t: RunTT) => setLogsByType((cur) => ({ ...cur, [t]: [] }));
  const appendLog = (entry: InflowLogEntry) => appendLogFor((targetType as RunTT), entry);
  const pushLog = (m: string) => appendLog({ type: "text", text: m });
  const pushLogFor = (t: RunTT, m: string) => appendLogFor(t, { type: "text", text: m });
  const pushShot = (caption: string, dataUrl: string) => appendLog({ type: "shot", caption, dataUrl });
  const pushShotFor = (t: RunTT, caption: string, dataUrl: string) => appendLogFor(t, { type: "shot", caption, dataUrl });
  // 🎯 현재 선택된 대상의 데이터 scope(대상별 통계 분리 키). 대상이 인식되면 그 대상 기준으로 조회.
  const currentScope = (() => {
    try {
      if (targetType === "place") { const id = extractPlaceId(placeUrl); return id ? inflowScope("place", id) : ""; }
      if (targetType === "blog") { const b = parseBlogUrl(blogUrl); return b ? inflowScope("blog", b.blogId) : ""; }
      if (targetType === "store") { const s = parseStoreUrl(storeUrl); return s ? inflowScope("store", s.productId || s.storeId) : ""; }
    } catch {}
    return "";
  })();
  // ★2026-09-08(테리): 유입 도중 '오늘 유입' 카운트가 안 오르고 새로고침해야 반영됨 → 실시간 갱신용으로 현재 scope를 ref로 미러링.
  const currentScopeRef = useRef(currentScope);
  useEffect(() => { currentScopeRef.current = currentScope; }, [currentScope]);
  // 🔁 대상별 격리 도입 전 과거 기록을 최초 1회 현재 대상으로 이관(업데이트해도 기록 유지)
  const legacyMigratedRef = useRef(false);
  useEffect(() => {
    if (!userId || !currentScope || legacyMigratedRef.current) return;
    // 성공(true)했을 때만 ref를 세워 실패 시(조회/저장 오류) 다음 로드에서 재시도되게 한다(마커로 멱등이라 중복 안전)
    migrateLegacyInflowToScope(userId, currentScope).then((ok) => { if (ok) { legacyMigratedRef.current = true; refreshStats(); } }).catch(() => {});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, currentScope]);
  const refreshStats = () => {
    if (!userId) return;
    getInflowDailyUsage(userId).then(setUsed).catch(() => {});                    // 전체 한도 사용량
    getInflowStatToday(userId, currentScope).then(setTodayScoped).catch(() => {}); // 이 대상 오늘 유입
    getInflowUsageHistory(userId, chartDays, currentScope).then(setHistory).catch(() => {});
    getRankHistory(userId, chartDays, currentScope).then(setRankHist).catch(() => {});
    getPerfReport(userId, reportPeriod, currentScope).then(setReport).catch(() => {});
  };
  useEffect(() => {
    refreshStats();
    if (!userId) return;
    getAccounts(userId, "traffic").then((a) => setAccounts(a.filter((x) => x.platform === "naver"))).catch(() => {});
  }, [userId]);
  // 🔒 오토파일럿·예약은 대상별로 격리 로드 — 대상 바꾸면 그 대상 설정으로 갱신(없으면 OFF로 리셋해 다른 대상 설정이 안 남게)
  useEffect(() => {
    if (!userId) return;
    // 대상 바뀌면 이전 대상 설정으로 오작동하지 않게 먼저 OFF로 리셋한 뒤, 그 대상 설정을 비동기 로드한다.
    setApEnabled(false); setSchedEnabled(false);
    if (!currentScope) return;
    let alive = true; const loadScope = currentScope;
    getAutopilot(userId, loadScope).then((ap) => { if (!alive || currentScope !== loadScope) return; if (ap) { setApEnabled(ap.enabled); setApGoal(ap.goal_rank); setApKeyword(ap.keyword || ""); setApLastRank(ap.last_rank ?? null); } }).catch(() => {});
    getInflowSchedule(userId, loadScope).then((s) => { if (!alive || currentScope !== loadScope) return; if (s) { setSchedEnabled(s.enabled); setSchedTime(s.time); setSchedRounds(s.rounds); } }).catch(() => {});
    return () => { alive = false; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, currentScope]);
  // 로그인 사용자별 민감한 주소를 격리하고, 기존 고정 키 데이터는 최초 1회 안전하게 이전한다.
  useEffect(() => {
    if (!userId) return;
    try {
      skipPrivateSaveRef.current = true;
      const scopedPrivate = JSON.parse(localStorage.getItem(privateKey) || "null");
      const legacyForm = JSON.parse(localStorage.getItem("publy_inflow_form") || "{}");
      // 구형 extraTargets는 그 당시 대상 타입(saved0.targetType)에 귀속(무조건 place로 넣지 않게)
      const legacySeedType: "place" | "blog" | "store" = saved0.targetType === "blog" ? "blog" : saved0.targetType === "store" ? "store" : "place";
      const legacyExtra: string[] = legacyForm.extraTargets || [];
      const nextPrivate = scopedPrivate || { placeUrl: legacyForm.placeUrl || "", blogUrl: legacyForm.blogUrl || "", storeUrl: legacyForm.storeUrl || "", extraByType: { place: legacySeedType === "place" ? legacyExtra : [], blog: legacySeedType === "blog" ? legacyExtra : [], store: legacySeedType === "store" ? legacyExtra : [] } };
      localStorage.setItem(privateKey, JSON.stringify(nextPrivate));
      setPlaceUrl(nextPrivate.placeUrl || ""); setBlogUrl(nextPrivate.blogUrl || ""); setStoreUrl(nextPrivate.storeUrl || "");
      // 구형(extraTargets 단일)·신형(extraByType) 모두 대응해 대상별로 복원
      const eb = nextPrivate.extraByType || (nextPrivate.extraTargets ? { place: nextPrivate.extraTargets, blog: [], store: [] } : { place: [], blog: [], store: [] });
      setExtraByType({ place: eb.place || [], blog: eb.blog || [], store: eb.store || [] });

      const scopedTargets = localStorage.getItem(savedTargetsKey);
      const legacyTargets = localStorage.getItem("publy_inflow_saved_targets");
      const migratedTargets = JSON.parse(scopedTargets || legacyTargets || "[]");
      localStorage.setItem(savedTargetsKey, JSON.stringify(migratedTargets)); setSavedTargets(migratedTargets);
      // 🏪 서버가 소스오브트루스: 서버에 저장된 매장이 있으면 그걸 사용(재설치·다른 기기에서도 복원),
      //    서버가 비었고 로컬에만 있으면 서버로 백필(기존 회원 데이터 자동 이전)
      getInflowTargets(userId).then((server) => {
        if (server && server.length) {
          setSavedTargets(server as SavedTarget[]);
          try { localStorage.setItem(savedTargetsKey, JSON.stringify(server)); } catch {}
        } else if (migratedTargets.length) {
          saveInflowTargets(userId, migratedTargets).catch(() => {});
        }
      }).catch(() => {});

      delete legacyForm.placeUrl; delete legacyForm.blogUrl; delete legacyForm.storeUrl; delete legacyForm.extraTargets;
      localStorage.setItem("publy_inflow_form", JSON.stringify(legacyForm));
      localStorage.removeItem("publy_inflow_saved_targets");
    } catch {}
  }, [privateKey, savedTargetsKey, userId]);
  // 주간/월간 토글·대상 바뀌면 리포트 다시 로드(대상별)
  useEffect(() => { if (userId) getPerfReport(userId, reportPeriod, currentScope).then(setReport).catch(() => {}); }, [userId, reportPeriod, currentScope]);
  // 📅 기간·대상 바뀌면 유입·순위·오늘유입 다시 로드(과거 데이터·대상별 조회) → 대상 변경 시 화면 전체 갱신
  useEffect(() => { if (!userId) return; getInflowStatToday(userId, currentScope).then(setTodayScoped).catch(() => {}); getInflowUsageHistory(userId, chartDays, currentScope).then(setHistory).catch(() => {}); getRankHistory(userId, chartDays, currentScope).then((h) => { setRankHist(h); const last = [...h].reverse().find((x) => x.rank != null); setApLastRank(last ? last.rank : null); setApRankOut(false); }).catch(() => {}); }, [userId, chartDays, currentScope]);

  // 📅 현재 기간 필터 → epoch ms 범위(0=제한없음). 쿼리스트링으로 봇에 전달.
  const postRangeQuery = (): string => {
    let fromMs = 0, toMs = 0;
    if (postDateMode === "recent") fromMs = Date.now() - Math.max(1, postRecentDays) * 86400000;
    else if (postDateMode === "range") {
      if (postFrom) fromMs = new Date(postFrom + "T00:00:00").getTime();
      if (postTo) toMs = new Date(postTo + "T23:59:59").getTime();
    }
    return `&fromMs=${fromMs || 0}&toMs=${toMs || 0}`;
  };

  // 🌐 공개 API로 글 불러오기(로그인 세션 없이 아이디만) — 로그인 방식 실패 시 폴백. 모든 과정 라이브 로그에 기록.
  const collectPublicPosts = (bid: string, reason: string) => {
    if (!bid) { pushLog(`❌ 공개 수집 실패 — 블로그 주소(아이디)를 먼저 입력하세요`); toast("블로그 주소(아이디)를 먼저 입력하세요", "error"); setMyPostsLoading(false); return; }
    pushLog(`🌐 ${reason} → 로그인 없이 공개 글 목록으로 불러올게요 (아이디: ${bid})`);
    const es = new BotEventStream(`${BOT}/api/my-posts?blogId=${encodeURIComponent(bid)}&count=100${postRangeQuery()}`, { method: "GET" });
    es.onmessage = (e: MessageEvent) => {
      let d: any; try { d = JSON.parse(e.data); } catch { return; }
      if (d.type === "log") pushLog(`  ${d.msg}`);
      else if (d.type === "posts") { const arr = (d.posts || []) as { url: string; title: string; date: string }[]; setMyPosts(arr); setSelectedPosts(new Set(arr.map((p) => p.url))); pushLog(`✅ 공개 글 ${arr.length}개 불러옴`); toast(`📚 공개 글 ${arr.length}개를 불러왔어요`, "success"); setMyPostsLoading(false); es.close(); }
      else if (d.type === "error") { pushLog(`❌ 공개 글 수집 실패 — ${d.msg}`); toast(d.msg, "error"); setMyPostsLoading(false); es.close(); }
    };
    es.onerror = () => { pushLog(`❌ 공개 글 수집 연결 오류 — 봇 서버(3364)를 확인해주세요`); toast("공개 글 수집 실패 — 봇 서버(3364) 확인", "error"); setMyPostsLoading(false); es.close(); };
  };

  // 🔐 로그인해서 내 글 불러오기 — 계정 관리에서 연결한 계정으로 내 글 목록 수집(SSE). 모든 과정 라이브 로그.
  const collectMyPosts = (acctId: string) => {
    if (!acctId) { toast("먼저 불러올 네이버 계정을 선택하세요", "error"); return; }
    const acct = accounts.find((a) => a.id === acctId);
    const acctName = acct?.username || acctId;
    // 폴백용 blogId — 주소칸이 비어도 계정의 블로그명/아이디로 공개수집(주소 입력 강요 X)
    const fallbackBid = parseBlogUrl(blogUrl)?.blogId || parseBlogUrl(acct?.blog_name || "")?.blogId || (acct?.username || "").replace(/@.*/, "");
    setMyPostsLoading(true); setMyPosts([]); setSelectedPosts(new Set());
    pushLog(`━━━━━ 📚 내 글 불러오기 시작 ━━━━━`);
    pushLog(`🔐 로그인 계정 '${acctName}'로 내 글 목록 요청 중…`);
    let gotPosts = false;
    const es = new BotEventStream(`${BOT}/api/my-posts?accountId=${encodeURIComponent(acctId)}&selectMode=all${postRangeQuery()}`, { method: "GET" });
    es.onmessage = (e: MessageEvent) => {
      let d: any; try { d = JSON.parse(e.data); } catch { return; }
      if (d.type === "log") pushLog(`  ${d.msg}`);
      else if (d.type === "posts") { gotPosts = true; const arr = (d.posts || []) as { url: string; title: string; date: string }[]; setMyPosts(arr); setSelectedPosts(new Set(arr.map((p) => p.url))); pushLog(`✅ 내 글 ${arr.length}개 불러옴 (로그인 방식)`); toast(`📚 내 글 ${arr.length}개를 불러왔어요`, "success"); setMyPostsLoading(false); es.close(); }
      else if (d.type === "error") {
        pushLog(`⚠️ 로그인 방식 실패 — ${d.msg}`);
        es.close();
        // 세션 만료/없음이면 공개 API로 자동 폴백(로그인 없이 공개 글이라도 보여줌)
        collectPublicPosts(fallbackBid, "로그인 세션이 없거나 만료됨");
      }
    };
    es.onerror = () => { if (gotPosts) return; pushLog(`⚠️ 로그인 방식 연결 오류 — 공개 방식으로 재시도해요`); es.close(); collectPublicPosts(fallbackBid, "봇 응답 오류"); };
  };
  const togglePost = (url: string) => setSelectedPosts((prev) => { const n = new Set(prev); n.has(url) ? n.delete(url) : n.add(url); return n; });
  const selectAllPosts = () => setSelectedPosts(new Set(myPosts.map((p) => p.url)));
  const clearSelectedPosts = () => setSelectedPosts(new Set());
  // 여러 글을 유입 대상으로 확정(첫 글=기본 대상, 나머지=추가 대상 로테이션) — 팝업 공통
  const applyPostsAsTargets = (urls: string[]) => {
    const clean = urls.map((u) => u.trim()).filter(Boolean);
    if (!clean.length) { toast("먼저 유입할 글을 선택하세요", "error"); return; }
    // 블로그 글 지정이므로 blog 버킷에 명시적으로 넣는다(setExtraTargets는 현재 렌더 targetType 클로저를 써서 오분류될 수 있음)
    setTargetType("blog"); setBlogUrl(clean[0]); setExtraByType((prev) => ({ ...prev, blog: clean.slice(1) })); setPickedPostCount(clean.length);
    toast(`✅ ${clean.length}개 글이 유입 대상으로 설정됐어요 — '유입 시작'을 누르세요`, "success");
    setPostPopup(null);
  };
  const applySelectedPostsAsTargets = () => applyPostsAsTargets(myPosts.filter((p) => selectedPosts.has(p.url)).map((p) => p.url));

  // 🩺 플레이스 최적화 진단 실행(현재 입력된 플레이스 주소 기준)
  const runDiagnose = async () => {
    if (targetType !== "place" || !placeUrl.trim()) { toast("먼저 플레이스 주소를 입력하세요", "error"); return; }
    setDiagLoading(true); setDiag(null);
    try {
      const r = await botFetch(`${BOT}/api/place-diagnose?placeUrl=${encodeURIComponent(placeUrl.trim())}`);
      const j = await r.json();
      if (j.error) { toast(j.error, "error"); }
      else { setDiag(j); toast(`최적화 점수 ${j.score}점`, "success"); }
    } catch { toast("진단 실패 — 봇 서버(3364)를 확인하세요", "error"); }
    finally { setDiagLoading(false); }
  };

  // 🛒 스토어 쇼핑 순위 확인 — 키워드로 쇼핑탭 1페이지에 내 상품이 드는지(될 키워드 고르기)
  const [storeRankLoading, setStoreRankLoading] = useState(false);
  const [storeRankText, setStoreRankText] = useState("아직 확인 안 함");
  const [storeRankStatus, setStoreRankStatus] = useState<"none" | "in" | "out">("none");
  const runStoreRank = async () => {
    const kw = (keywords.split(/[,\n]/)[0] || "").trim();
    if (!kw) { toast("먼저 확인할 키워드를 입력하세요", "error"); return; }
    const s = parseStoreUrl(storeUrl.trim());
    if (!s) { toast("먼저 스마트스토어 상품 주소를 입력하세요", "error"); return; }
    setStoreRankLoading(true); setStoreRankText("확인 중…");
    pushLog(`🛒 "${kw}" 쇼핑 순위 확인 중…`);
    try {
      const url = `${BOT}/api/store-rank?keyword=${encodeURIComponent(kw)}&storeUrl=${encodeURIComponent(storeUrl.trim())}${s.storeId?`&storeId=${encodeURIComponent(s.storeId)}`:""}${s.productId?`&productId=${encodeURIComponent(s.productId)}`:""}`;
      const r = await botFetch(url);
      const j = await r.json();
      if (j.error) { setStoreRankText("확인 실패"); setStoreRankStatus("none"); pushLog(`❌ 순위 확인 실패 — ${j.error}`); toast(j.error, "error"); return; }
      if (j.onFirstPage && j.rank) {
        setStoreRankText(`✅ 1페이지 ${j.rank}위`); setStoreRankStatus("in");
        pushLog(`🛒 "${kw}" → 1페이지 ${j.rank}위 (트래픽 돌릴만한 키워드!)`);
        toast(`"${kw}" 1페이지 ${j.rank}위 — 이 키워드로 트래픽 돌리면 효과 있어요!`, "success");
      } else {
        setStoreRankText("⚠️ 1페이지 밖"); setStoreRankStatus("out");
        pushLog(`🛒 "${kw}" → 1페이지 밖(노출 낮음) — 더 세부 키워드로 시도하세요.`);
        toast(`"${kw}" 1페이지 밖이에요. 더 세부(롱테일) 키워드로 시도해보세요.`, "info");
      }
    } catch { setStoreRankText("확인 실패"); setStoreRankStatus("none"); pushLog("❌ 순위 확인 실패 — 봇 서버 확인"); toast("순위 확인 실패 — 봇 서버 확인", "error"); }
    finally { setStoreRankLoading(false); }
  };

  // 📍 순위 측정 — 대표 키워드로 내 플레이스 순위 측정 후 저장(리포트·그래프에 자동 반영)
  const [rankLoading, setRankLoading] = useState(false);
  const runMeasureRank = async () => {
    const kw = (apKeyword || keywords.split(/[,\n]/)[0] || "").trim();
    if (!kw) { toast("순위를 측정할 키워드를 입력하세요(오토파일럿 키워드 또는 첫 키워드)", "error"); return; }
    let url = "";
    if (targetType === "place") {
      if (!placeUrl.trim()) { toast("먼저 플레이스 주소를 입력하세요", "error"); return; }
      url = `${BOT}/api/place-rank?keyword=${encodeURIComponent(kw)}&placeUrl=${encodeURIComponent(placeUrl.trim())}`;
    } else if (targetType === "blog") {
      const p = parseBlogUrl(blogUrl.trim());
      if (!p) { toast("먼저 블로그 글 주소를 입력하세요", "error"); return; }
      url = `${BOT}/api/blog-rank?keyword=${encodeURIComponent(kw)}&blogId=${encodeURIComponent(p.blogId)}&logNo=${encodeURIComponent(p.logNo)}`;
    } else if (targetType === "store") {
      // 🛒 스토어 순위 측정 — 쇼핑탭 1페이지에 내 상품이 몇 위인지(될 키워드 고르기용)
      const s = parseStoreUrl(storeUrl.trim());
      if (!s) { toast("먼저 스마트스토어 상품 주소를 입력하세요", "error"); return; }
      url = `${BOT}/api/store-rank?keyword=${encodeURIComponent(kw)}&storeUrl=${encodeURIComponent(storeUrl.trim())}${s.storeId?`&storeId=${encodeURIComponent(s.storeId)}`:""}${s.productId?`&productId=${encodeURIComponent(s.productId)}`:""}`;
    } else { toast("순위 측정 대상을 인식하지 못했어요", "error"); return; }
    setRankLoading(true);
    pushLog(`📍 "${kw}" 현재 순위 측정 중…`);
    try {
      const r = await botFetch(url);
      const j = await r.json();
      if (j.error) { pushLog(`❌ 순위 측정 실패 — ${j.error}`); toast(j.error, "error"); return; }
      if (j.rank == null) {
        setApRankOut(true); // 현재순위 카드에 '30+' 표시
        pushLog(`📍 "${kw}" 30위 밖 — 노출 순위가 낮아요. 유입·리뷰로 끌어올리세요.`);
        toast(`"${kw}"에서 30위 밖이에요(노출 순위 낮음). 유입·리뷰로 끌어올리세요.`, "info");
      } else {
        setApLastRank(j.rank); setApRankOut(false);
        if (userId) { await recordRankPoint(userId, j.rank, currentScope); getPerfReport(userId, reportPeriod, currentScope).then(setReport).catch(()=>{}); getRankHistory(userId, chartDays, currentScope).then(setRankHist).catch(()=>{}); }
        pushLog(`📍 현재 "${kw}" ${j.rank}위${apEnabled ? ` (목표 ${apGoal}위)` : ""} — 기록했어요`);
        toast(`현재 "${kw}" ${j.rank}위 — 기록했어요`, "success");
      }
    } catch { pushLog("❌ 순위 측정 실패 — 봇 서버(3364)를 확인해주세요"); toast("순위 측정 실패 — 봇 서버(3364) 확인", "error"); }
    finally { setRankLoading(false); }
  };

  // 🎯 오토파일럿 판단 — 현재 순위를 재고 {측정됨, 목표달성}을 반환.
  //   measured=false(측정 실패/미지원)면 호출부는 자동 유입을 보류한다(잘못된 순위로 오조절 방지).
  //   플레이스=/api/place-rank, 블로그=/api/blog-rank. 스토어(쇼핑)는 순위 자동측정 미지원.
  autopilotCheckRef.current = async () => {
    const fail = { measured: false, reached: false };
    if (!userId) return fail;
    const kw = (apKeyword || keywords.split(/[,\n]/)[0] || "").trim();
    if (!kw) return fail;
    let url = "";
    if (targetType === "place") {
      if (!placeUrl.trim()) return fail;
      url = `${BOT}/api/place-rank?keyword=${encodeURIComponent(kw)}&placeUrl=${encodeURIComponent(placeUrl.trim())}`;
    } else if (targetType === "blog") {
      const p = parseBlogUrl(blogUrl.trim());
      if (!p) return fail;
      url = `${BOT}/api/blog-rank?keyword=${encodeURIComponent(kw)}&blogId=${encodeURIComponent(p.blogId)}&logNo=${encodeURIComponent(p.logNo)}`;
    } else {
      pushLog("🎯 스토어(쇼핑)는 순위 자동측정을 지원하지 않아 자동 유입을 보류해요.");
      return fail;
    }
    try {
      const r = await botFetch(url);
      const j = await r.json();
      if (j.error) { pushLog(`📍 순위 측정 실패 — ${j.error}`); return fail; }
      if (j.rank != null) {
        setApLastRank(j.rank);
        await recordRankPoint(userId, j.rank, currentScope);
        getPerfReport(userId, reportPeriod, currentScope).then(setReport).catch(()=>{});
        pushLog(`📍 현재 순위 ${j.rank}위 (목표 ${apGoal}위)`);
        return { measured: true, reached: j.rank <= apGoal };   // 목표 이내면 달성
      }
      // 순위 못 찾음(에러 없음) = 30위 밖 → 측정은 됨, 목표 미달로 보고 유입
      pushLog("📍 순위 30위 밖 — 유입으로 끌어올려요.");
      return { measured: true, reached: false };
    } catch { pushLog("📍 순위 측정 실패 — 봇 서버(3364) 확인"); return fail; }
  };

  // 🔎 키워드 발굴 — 입력한 키워드 seed로 숨은 키워드 추천
  const runKeywordSuggest = async () => {
    const seeds = keywords.split(/[,\n]/).map(k=>k.trim()).filter(Boolean).slice(0, 5);
    if (!seeds.length) { toast("먼저 키워드를 1개 이상 입력하세요(예: 횡성한우)", "error"); return; }
    setKwLoading(true); setKwSuggest([]);
    try {
      const r = await botFetch(`${BOT}/api/place/keywords?seeds=${encodeURIComponent(JSON.stringify(seeds))}`);
      const j = await r.json();
      if (!j.ok) { toast(j.error || "추천 실패", "error"); return; }
      const already = new Set(keywords.split(/[,\n]/).map(k=>k.trim()));
      const list = (j.keywords || [])
        .filter((k: any)=>k?.keyword && !already.has(k.keyword))
        .map((k: any)=>({ keyword: String(k.keyword), source: String(k.source||"추천"), vol: typeof k.vol==="number"?k.vol:undefined, comp: k.comp?String(k.comp):undefined }))
        .slice(0, 30);
      if (!list.length) { toast("새로운 추천 키워드가 없어요", "info"); }
      setKwSuggest(list);
    } catch { toast("키워드 추천 실패 — 봇 서버(3364) 확인", "error"); }
    finally { setKwLoading(false); }
  };
  // 🧩 조합 생성기 — 지역·업종·메뉴/목적으로 메인(지역+업종)+세부(지역+메뉴/목적) 키워드 자동 생성
  const genCombos = () => {
    const region = cbRegion.trim(), type = cbType.trim();
    const extras = cbExtra.split(/[,\n]/).map(s=>s.trim()).filter(Boolean);
    if (!region && !type && !extras.length) { toast("지역·업종·메뉴 중 하나 이상 넣어주세요", "error"); return; }
    const out: { keyword: string; source: string }[] = [];
    const push = (kw: string, src: string) => { const t = kw.replace(/\s+/g," ").trim(); if (t && !out.some(o=>o.keyword===t)) out.push({ keyword: t, source: src }); };
    if (region && type) push(`${region} ${type}`, "조합·메인");
    for (const e of extras) {
      if (region) push(`${region} ${e}`, "조합·세부");
      if (region && type) push(`${region} ${e} ${type}`, "조합·세부");
      if (type) push(`${e} ${type}`, "조합·세부");
    }
    const already = new Set(keywords.split(/[,\n]/).map(k=>k.trim()));
    const fresh = out.filter(o=>!already.has(o.keyword));
    if (!fresh.length) { toast("생성된 키워드가 이미 다 들어있어요", "info"); return; }
    setKwSuggest(prev => { const seen = new Set(prev.map(p=>p.keyword)); return [...fresh.filter(f=>!seen.has(f.keyword)), ...prev]; });
    toast(`🧩 키워드 ${fresh.length}개 생성 — 아래에서 눌러 추가하세요`, "success");
  };
  const addSuggestedKeyword = (k: string) => {
    setKeywords(prev => { const list = prev.split(/[,\n]/).map(x=>x.trim()).filter(Boolean); if (list.includes(k)) return prev; return [...list, k].join(", "); });
    setKwSuggest(prev => prev.filter(x => x.keyword !== k));
  };

  // 🎯 대상 내용 기반 키워드 추천 — 지금 입력한 대상(글/블로그/플레이스/스토어)을 읽어 관련 키워드를 추천.
  //   "쌩뚱맞은 키워드 유입은 무의미"(네이버 정밀매칭) → 대상과 관련된 키워드만 뽑아준다. 직접 입력과 공존.
  const runTargetKeywordSuggest = async () => {
    const url = (targetType === "place" ? placeUrl : targetType === "store" ? storeUrl : blogUrl).trim();
    if (!url) { toast(`먼저 ${targetType === "place" ? "플레이스" : targetType === "store" ? "상품" : "블로그"} 주소를 입력하세요 — 그 내용을 읽어 딱 맞는 키워드를 추천해요`, "error"); return; }
    const qs = new URLSearchParams({ targetType });
    if (targetType === "blog") {
      const b = parseBlogUrl(url);
      if (b?.blogId) qs.set("blogId", b.blogId);
      if (b?.logNo) qs.set("logNo", b.logNo);
      if (!b?.blogId) { qs.set("blogId", url.replace(/@.*/, "").trim()); }   // 아이디만 넣은 경우
    } else if (targetType === "store") {
      // 🛒 스토어는 씨앗 키워드(첫 키워드) 필요 — 상품 직접읽기는 429라, 씨앗으로 쇼핑검색해 관련 상품명에서 키워드 추출.
      const seed = (keywords.split(/[,\n]/)[0] || "").trim();
      if (!seed) { toast('상품과 관련된 단어 1개를 먼저 입력하세요(예: "굴비") — 그걸로 관련 키워드를 찾아드려요', "info"); return; }
      const s = parseStoreUrl(url); qs.set("url", url); qs.set("seedKeyword", seed);
      if (s?.storeId) qs.set("storeId", s.storeId);
      if (s?.productId) qs.set("productId", s.productId);
    } else {
      const pid = extractPlaceId(url); qs.set("url", url);
      if (pid) qs.set("placeId", pid);
    }
    setKwLoading(true); setKwSuggest([]);
    try {
      const r = await botFetch(`${BOT}/api/inflow/keyword-suggest?${qs.toString()}`);
      const j = await r.json();
      if (!j.ok) { toast(j.error || "추천 실패", "error"); return; }
      const already = new Set(keywords.split(/[,\n]/).map(k => k.trim()));
      const list = (j.keywords || [])
        .filter((k: any) => k?.keyword && !already.has(k.keyword))
        .map((k: any) => ({ keyword: String(k.keyword), source: String(k.source || j.source || "추천"), vol: typeof k.vol === "number" ? k.vol : undefined, comp: k.comp ? String(k.comp) : undefined }))
        .slice(0, 30);
      if (!list.length) { toast(j.note || "대상에서 새 키워드를 못 찾았어요 — 직접 입력해도 돼요", "info"); }
      else { toast(`🎯 "${j.source || "대상"}"에서 관련 키워드 ${list.length}개 추천 — 눌러서 추가하세요`, "success"); }
      setKwSuggest(list);
    } catch { toast("키워드 추천 실패 — 봇 서버 확인", "error"); }
    finally { setKwLoading(false); }
  };

  // 🏪 현재 입력한 대상을 이름 붙여 저장 — 플레이스/블로그/스토어 각각 격리
  const saveCurrentTarget = () => {
    const url = (targetType === "place" ? placeUrl : targetType === "store" ? storeUrl : blogUrl).trim();
    if (!url) { toast("먼저 주소를 입력하세요", "error"); return; }
    const ok = targetType === "place" ? (!!extractPlaceId(url) || isShortUrl(url)) : targetType === "store" ? !!parseStoreUrl(url) : !!parseBlogUrl(url);
    if (!ok) { toast("주소를 인식하지 못했어요 — 올바른 링크를 넣어주세요", "error"); return; }
    const name = savingName.trim() || (targetType === "place" ? (extractPlaceId(url) ? "플레이스 " + extractPlaceId(url) : "내 플레이스") : targetType === "store" ? (parseStoreUrl(url)?.storeId ? "스토어 " + parseStoreUrl(url)!.storeId : "내 상품") : "내 블로그");
    const exists = savedTargets.find(t => t.url === url);
    if (exists) { toast("이미 저장된 주소예요", "info"); return; }
    const item: SavedTarget = { id: Date.now().toString(36), name, url, type: targetType };
    persistSavedTargets([item, ...savedTargets]);
    setSavingName("");
    toast(`"${name}" 저장되었습니다 ✅`, "success");
  };
  const pickSavedTarget = (t: SavedTarget) => {
    setTargetType(t.type);
    if (t.type === "place") setPlaceUrl(t.url); else if (t.type === "store") setStoreUrl(t.url); else setBlogUrl(t.url);
    toast(`"${t.name}" 불러왔어요`, "success");
  };
  const removeSavedTarget = (id: string) => persistSavedTargets(savedTargets.filter(t => t.id !== id));

  // 💬 리뷰 감정분석 — 리뷰 수집 후 칭찬·불만 키워드 빈도(AI 키 불필요)
  const runReviewAnalysis = async () => {
    if (targetType !== "place" || !placeUrl.trim()) { toast("먼저 플레이스 주소를 입력하세요", "error"); return; }
    setRevLoading(true); setRevResult(null);
    try {
      const r = await botFetch(`${BOT}/api/place-reviews?placeUrl=${encodeURIComponent(placeUrl.trim())}`);
      const j = await r.json();
      if (j.error) { toast(j.error, "error"); return; }
      const reviews: string[] = j.reviews || [];
      if (!reviews.length) { toast("리뷰를 읽지 못했어요", "info"); return; }
      // 칭찬/불만 사전(자주 쓰는 표현) — 빈도 카운트
      const LIKE = ["맛있", "친절", "신선", "분위기", "깨끗", "양이 많", "가성비", "재방문", "추천", "정갈", "든든", "빠르", "편안", "만족"];
      const BAD = ["불친절", "비싸", "느리", "오래 기다", "대기", "주차", "좁", "위생", "별로", "실망", "짜", "불만", "아쉬"];
      const count = (words: string[]) => words.map(w => ({ word: w, n: reviews.filter(rv => rv.includes(w)).length })).filter(x => x.n > 0).sort((a, b) => b.n - a.n);
      setRevResult({ total: reviews.length, likes: count(LIKE).slice(0, 6), dislikes: count(BAD).slice(0, 6) });
    } catch { toast("리뷰 분석 실패 — 봇 서버(3364) 확인", "error"); }
    finally { setRevLoading(false); }
  };

  // 📘 블로그 진단(blog 전용) — 검증본 crawlBlogStats(/api/blog-stats) 재사용. 방문자·글수·이웃·활성도·저품질·유입키워드.
  const runBlogDiagnose = () => {
    if (targetType !== "blog") return;
    const acctId = blogDiagAcctId || accounts[0]?.id || "";
    if (!acctId) { toast("먼저 왼쪽 '계정 관리'에서 네이버 블로그 계정을 연결하세요", "error"); return; }
    setBlogDiagLoading(true); setBlogDiag(null);
    pushLog("📘 블로그 지표 수집 중… (방문자·글수·이웃·활성도)");
    const q = new URLSearchParams({ accountId: acctId, plan, ...(userId ? { userId } : {}) });
    const es = new BotEventStream(`${BOT}/api/blog-stats?${q.toString()}`);
    es.onmessage = (e: MessageEvent) => {
      let d: any; try { d = JSON.parse(e.data); } catch { return; }
      if (d.type === "log") pushLog(`  ${d.msg}`);
      else if (d.type === "stats") { setBlogDiag(d.stats); pushLog("✅ 블로그 진단 완료"); toast("블로그 진단 완료", "success"); setBlogDiagLoading(false); es.close(); }
      else if (d.type === "error") { pushLog(`❌ 블로그 진단 실패 — ${d.msg}`); toast(d.msg, "error"); setBlogDiagLoading(false); es.close(); }
    };
    es.onerror = () => { pushLog("❌ 블로그 진단 연결 오류 — 봇 서버(3364) 확인"); toast("블로그 진단 실패 — 봇 서버(3364) 확인", "error"); setBlogDiagLoading(false); es.close(); };
  };

  // 🛒 스토어 상품 진단(store 전용) — /api/store-info. 프록시+브라우저로 상품 페이지 읽어 리뷰수·찜·평점·가격.
  const runStoreDiagnose = () => {
    if (targetType !== "store" || !storeUrl.trim()) { toast("먼저 스마트스토어 상품 주소를 입력하세요", "error"); return; }
    setStoreInfoLoading(true); setStoreInfo(null);
    pushLog("🛒 스마트스토어 상품 정보 수집 중… (리뷰·찜·평점·가격)");
    const es = new BotEventStream(`${BOT}/api/store-info?storeUrl=${encodeURIComponent(storeUrl.trim())}`);
    es.onmessage = (e: MessageEvent) => {
      let d: any; try { d = JSON.parse(e.data); } catch { return; }
      if (d.type === "log") pushLog(`  ${d.msg}`);
      else if (d.type === "store") { setStoreInfo(d.info); pushLog("✅ 상품 진단 완료"); toast("상품 진단 완료", "success"); setStoreInfoLoading(false); es.close(); }
      else if (d.type === "error") { pushLog(`❌ 상품 진단 실패 — ${d.msg}`); toast(d.msg, "error"); setStoreInfoLoading(false); es.close(); }
    };
    es.onerror = () => { pushLog("❌ 상품 진단 연결 오류 — 봇 서버(3364) 확인"); toast("상품 진단 실패 — 봇 서버(3364) 확인", "error"); setStoreInfoLoading(false); es.close(); };
  };

  // 🥊 경쟁사 추적 — 내 키워드 상위 경쟁사 vs 나
  const runCompetitors = async () => {
    const kw = (keywords.split(/[,\n]/).map(k=>k.trim()).filter(Boolean)[0] || "").trim();
    if (!kw) { toast("먼저 검색 키워드를 입력하세요", "error"); return; }
    setCompLoading(true); setComp(null);
    try {
      const r = await botFetch(`${BOT}/api/competitors?query=${encodeURIComponent(kw)}${placeUrl.trim()?`&myPlaceUrl=${encodeURIComponent(placeUrl.trim())}`:""}`);
      const j = await r.json();
      if (j.error) toast(j.error, "error");
      else setComp(j);
    } catch { toast("경쟁사 조회 실패 — 봇 서버(3364) 확인", "error"); }
    finally { setCompLoading(false); }
  };

  // 📄 성과 리포트를 PDF로 저장(플레이스365와 동일한 electron.saveReportPdf 재사용)
  const downloadReportPdf = async () => {
    if (!report) return;
    const el = (window as any).electron;
    const per = reportPeriod === "week" ? "주간" : "월간";
    const rankTxt = report.rankNow != null ? `${report.rankNow}위` : "-";
    const rankDelta = (report.rankPrev != null && report.rankNow != null) ? (report.rankPrev - report.rankNow) : null;
    const infDelta = report.inflowPrev > 0 ? Math.round(((report.inflowNow - report.inflowPrev) / report.inflowPrev) * 100) : null;
    const bars = report.daily.map(d => `<td style="text-align:center;padding:2px 4px;font-size:11px;color:#555">${d.count}<br><span style="color:#999">${d.label}</span></td>`).join("");
    const html = `<html><head><meta charset="utf-8"><style>body{font-family:'Apple SD Gothic Neo',sans-serif;padding:40px;color:#1a2332}h1{font-size:24px}.kpi{display:inline-block;border:1px solid #e2e8f1;border-radius:14px;padding:18px 26px;margin:8px 12px 8px 0}.big{font-size:32px;font-weight:900;color:#2563eb}.sub{color:#647084;font-size:13px}</style></head><body>
      <h1>📊 ${per} 성과 리포트</h1><p class="sub">발행일 ${new Date().toLocaleDateString("ko-KR")} · 퍼블리 트래픽 유입</p>
      <div><div class="kpi"><div class="sub">현재 순위</div><div class="big">${rankTxt}</div><div class="sub">${rankDelta!=null?(rankDelta>0?`▲ ${rankDelta}계단 상승`:rankDelta<0?`▼ ${-rankDelta}계단 하락`:"변동 없음"):""}</div></div>
      <div class="kpi"><div class="sub">${per} 유입</div><div class="big">${report.inflowNow.toLocaleString()}명</div><div class="sub">${infDelta!=null?(infDelta>=0?`▲ ${infDelta}% 증가`:`▼ ${-infDelta}% 감소`):"지난 기간 대비"}</div></div>
      <div class="kpi"><div class="sub">지난 ${per}</div><div class="big" style="color:#94a3b8">${report.inflowPrev.toLocaleString()}명</div></div></div>
      <h3 style="margin-top:26px">${per} 유입 추이</h3><table style="border-collapse:collapse;margin-top:8px"><tr>${bars}</tr></table>
      <p class="sub" style="margin-top:30px">본 리포트는 퍼블리가 측정한 유입·순위 데이터입니다. 검색 위치·시간·개인화에 따라 순위는 달라질 수 있습니다.</p>
      </body></html>`;
    if (el?.saveReportPdf) {
      const r = await el.saveReportPdf(html, `퍼블리-성과리포트-${per}-${new Date().toISOString().slice(0,10)}.pdf`);
      if (r?.ok) toast("성과 리포트 PDF를 저장했어요", "success");
      else if (!r?.canceled) toast(r?.error || "PDF 저장 실패", "error");
    } else {
      const w = window.open("", "_blank"); if (w) { w.document.write(html); w.document.close(); w.print(); }
    }
  };

  // ⏰ 예약 실행 감시 — 앱이 켜져 있을 때 지정 시각 도달 시 자동 1회 실행(하루 1번)
  useEffect(() => {
    if (!schedEnabled || !userId) return;
    const tick = async () => {
      if (running) return;
      const tickScope = currentScope;              // 이번 tick의 대상 고정(대기 중 대상 바뀌면 중단)
      if (!tickScope) return;                       // 대상이 인식돼야만 예약 실행(전역 폴백·엉뚱한 대상 실행 방지)
      const now = new Date();
      const hhmm = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Seoul", hour: "2-digit", minute: "2-digit", hour12: false }).format(now);
      if (hhmm !== schedTime) return;
      if (await inflowScheduleRanToday(userId, tickScope)) return;
      if (currentScope !== tickScope || running) return; // DB 대기 중 대상 전환/실행 시작됐으면 중단
      pushLog(`⏰ 예약 시각(${schedTime}) 도달`);
      // 🎯 오토파일럿 켜져 있으면: 순위 먼저 재고 목표 달성이면 유입 스킵(한도 절약). 플레이스+블로그.
      if (apEnabled && (targetType === "place" || targetType === "blog")) {
        const chk = await autopilotCheckRef.current();
        if (currentScope !== tickScope || running) return; // 순위 조회 대기 중 전환됐으면 중단
        if (!chk.measured) { pushLog("🎯 순위 측정 실패 — 오늘 자동 유입은 보류해요(잘못된 순위로 오조절 방지)."); await markInflowScheduleRan(userId, tickScope); return; }
        if (chk.reached) { pushLog("🎯 목표 순위 유지 중 — 오늘 유입은 건너뜁니다(한도 절약)."); await markInflowScheduleRan(userId, tickScope); return; }
        pushLog("🎯 목표보다 낮아요 — 순위를 끌어올리기 위해 유입 실행.");
      }
      pushLog("⏰ 자동 유입 시작");
      if (!auto) setRounds(schedRounds);
      scheduledRunScopeRef.current = tickScope;   // 실행 시작 시점 대상 고정(마커는 이 대상에)
      scheduledRunPendingRef.current = true;
      startRef.current();
    };
    const id = setInterval(tick, 30000); // 30초마다 시각 확인
    tick();
    return () => clearInterval(id);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [schedEnabled, schedTime, schedRounds, userId, running, currentScope]);

  // 🎯 오토파일럿 독립 실행(A) — 예약(스케줄)을 안 켰어도 오토파일럿만 ON이면, 앱이 켜져 있는 동안
  //   하루 1회 스스로 "순위 측정→목표 판단→낮으면 유입"을 실행한다. 예약이 켜져 있으면 예약 루프가
  //   오토파일럿을 담당하므로(중복 방지) 여기선 쉰다. 하루 1회 마커는 예약과 공유(둘은 상호배타).
  //   측정 실패면 유입을 보류(잘못된 순위로 오조절 방지). 스토어(쇼핑)는 순위 자동측정 미지원이라 제외.
  useEffect(() => {
    if (!apEnabled || schedEnabled || !userId) return;
    if (targetType !== "place" && targetType !== "blog") return;
    const tick = async () => {
      if (running) return;
      const tickScope = currentScope;
      if (!tickScope) return;
      if (await inflowScheduleRanToday(userId, tickScope)) return;   // 오늘 이미 자동 실행함
      if (currentScope !== tickScope || running) return;
      pushLog("🎯 오토파일럿 — 오늘 자동 점검 시작");
      const chk = await autopilotCheckRef.current();
      if (currentScope !== tickScope || running) return;
      if (!chk.measured) { pushLog("🎯 순위 측정 실패 — 오늘 자동 유입은 보류해요(오조절 방지)."); await markInflowScheduleRan(userId, tickScope); return; }
      if (chk.reached) { pushLog("🎯 목표 순위 유지 중 — 오늘 유입은 건너뜁니다(한도 절약)."); await markInflowScheduleRan(userId, tickScope); return; }
      pushLog("🎯 목표보다 낮아요 — 순위를 끌어올리기 위해 유입 실행.");
      if (!auto) setRounds(schedRounds);
      scheduledRunScopeRef.current = tickScope;
      scheduledRunPendingRef.current = true;
      startRef.current();
    };
    const id = setInterval(tick, 30000);
    const t0 = setTimeout(tick, 6000);   // 앱 켜고 6초 뒤 첫 자동 점검
    return () => { clearInterval(id); clearTimeout(t0); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apEnabled, schedEnabled, userId, running, currentScope, targetType]);

  const saveSched = async (nextEnabled: boolean) => {
    if (!userId) return;
    // 대상 미인식(빈 scope)이면 전역키에 저장하지 않는다(ON은 안내, OFF는 화면 상태만 끔)
    if (!currentScope) { if (nextEnabled) toast("먼저 대상 주소를 정확히 입력해 인식시켜 주세요(예약은 대상별로 저장돼요)", "error"); else setSchedEnabled(false); return; }
    try { await saveInflowSchedule(userId, { enabled: nextEnabled, time: schedTime, rounds: schedRounds }, currentScope); setSchedEnabled(nextEnabled); toast(nextEnabled ? `⏰ 매일 ${schedTime}에 자동 유입 ${schedRounds}회 예약됨` : "예약 해제", "success"); }
    catch (e: any) { toast(e.message, "error"); }
  };

  const saveAp = async (nextEnabled: boolean) => {
    if (!userId) return;
    // 대상 미인식(빈 scope)이면 테이블 전역 저장 금지(ON은 안내, OFF는 화면 상태만 끔)
    if (!currentScope) { if (nextEnabled) toast("먼저 대상 주소를 정확히 입력해 인식시켜 주세요(오토파일럿은 대상별로 저장돼요)", "error"); else setApEnabled(false); return; }
    if (nextEnabled && !apKeyword.trim()) { toast("순위를 추적할 키워드를 입력하세요", "error"); return; }
    if (nextEnabled && targetType === "place" && !placeUrl.trim()) { toast("먼저 플레이스 주소를 입력하세요", "error"); return; }
    if (nextEnabled && targetType === "blog" && !blogUrl.trim()) { toast("먼저 블로그 글 주소를 입력하세요", "error"); return; }
    const cfg: AutopilotConfig = { user_id: userId, target_type: targetType, target_ref: targetType === "place" ? placeUrl.trim() : targetType === "store" ? storeUrl.trim() : blogUrl.trim(), keyword: apKeyword.trim(), goal_rank: apGoal, enabled: nextEnabled, last_rank: apLastRank };
    try { await saveAutopilot(cfg, currentScope); setApEnabled(nextEnabled); toast(nextEnabled ? `🎯 오토파일럿 ON — ${apKeyword} ${apGoal}위 목표로 자동 관리` : "오토파일럿 OFF", "success"); }
    catch (e: any) { toast(e.message, "error"); }
  };
  useEffect(() => { logBoxRef.current?.scrollTo({ top: logBoxRef.current.scrollHeight, behavior: "smooth" }); }, [logs]);
  useEffect(() => () => {
    (["place", "blog", "store"] as RunTT[]).forEach((t) => { esRefByType.current[t]?.close(); esRefByType.current[t] = null; });
  }, []);
  useEffect(() => {
    if (!anyRunning) return;
    let lock: any = null;
    let cancelled = false;
    // 🖥️ 화면(모니터)이 꺼지지 않게 Wake Lock 유지. 화면이 잠깐 숨겨졌다 돌아오거나
    //    브라우저가 lock을 해제하면 실행 중인 한 다시 획득한다(모니터 꺼져도 작업 유지).
    const acquire = async () => {
      try {
        if (cancelled || document.visibilityState !== "visible") return;
        lock = await (navigator as any).wakeLock?.request("screen");
        if (cancelled) { await lock?.release(); return; }
        lock?.addEventListener?.("release", () => { if (!cancelled && anyRunning) void acquire(); });
      } catch {}
    };
    const onVis = () => { if (document.visibilityState === "visible" && !cancelled) void acquire(); };
    document.addEventListener("visibilitychange", onVis);
    void acquire();
    return () => { cancelled = true; document.removeEventListener("visibilitychange", onVis); void lock?.release?.().catch(() => {}); };
  }, [anyRunning]);

  // 🔁 폼 입력값 저장(탭 이동해도 유지). 무거운 것(로그·계정목록)은 제외.
  useEffect(() => {
    if (skipPrivateSaveRef.current) { skipPrivateSaveRef.current = false; return; }
    try {
      localStorage.setItem(formKey, JSON.stringify({
        targetType, keywordsPlace, keywordsBlog, keywordsStore, rounds, termMin, termMax, device,
        doSave, doShare, doDir, doCall, doBook, doTalk, doLike, doNeighbor, doWish, doCart, doOption, funnel, spread, spreadHours, doReview, reviewText, auto, actionRate, intensity, maxDwellSec, dataSaver, kwWeights,
      }));
      // 추가대상은 대상별 전체(extraByType)를 저장해야 다른 탭 것이 안 사라진다
      localStorage.setItem(privateKey, JSON.stringify({ placeUrl, blogUrl, storeUrl, extraByType }));
    } catch {}
  }, [formKey, privateKey, targetType, placeUrl, blogUrl, storeUrl, keywordsPlace, keywordsBlog, keywordsStore, rounds, termMin, termMax, device, doSave, doShare, doDir, doCall, doBook, doTalk, doLike, doNeighbor, doWish, doCart, doOption, funnel, spread, spreadHours, doReview, reviewText, auto, actionRate, intensity, maxDwellSec, dataSaver, extraByType, kwWeights]);

  // 🔔 앱 내 자동 알림 — 날짜/주차 마커로 중복을 막고, 다음 실행 때 놓친 알림도 알림함에 쌓는다.
  useEffect(() => {
    try { setNotifications(JSON.parse(localStorage.getItem(notificationKey) || "[]")); }
    catch { setNotifications([]); }
  }, [notificationKey]);

  useEffect(() => {
    if (!userId) return;
    const markerPrefix = `publy_inflow_auto_${userId}`;
    const addNotification = (message: string) => {
      const item: InflowNotification = { id: `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`, message, createdAt: new Date().toISOString() };
      setNotifications((current) => {
        const next = [item, ...current].slice(0, 50);
        try { localStorage.setItem(notificationKey, JSON.stringify(next)); } catch {}
        return next;
      });
      showToast?.(message, "info");
    };
    const hasRun = (kind: string, period: string) => localStorage.getItem(`${markerPrefix}_${kind}`) === period;
    const markRun = (kind: string, period: string) => localStorage.setItem(`${markerPrefix}_${kind}`, period);
    const tick = async () => {
      if (automationRunningRef.current) return;
      automationRunningRef.current = true;
      try {
        const now = new Date();
        const day = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
        const hhmm = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Seoul", hour: "2-digit", minute: "2-digit", hour12: false }).format(now);
        const monday = new Date(now); monday.setHours(0, 0, 0, 0); monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
        const week = monday.toISOString().slice(0, 10);
        const keyword = (apKeyword || keywords.split(/[,\n]/)[0] || "").trim();
        const place = placeUrl.trim();

        if (hhmm >= "09:00" && !hasRun("report", day)) {
          const dailyReport = await getPerfReport(userId, "week");
          const yesterdayInflow = dailyReport.daily.at(-2)?.count ?? 0;
          addNotification(`매일 리포트 · 어제 순위 ${dailyReport.rankNow != null ? `${dailyReport.rankNow}위` : "미측정"} · 유입 ${yesterdayInflow}명`);
          markRun("report", day);
        }
        if (targetType === "place" && place && keyword && !hasRun("rank", day)) {
          const response = await botFetch(`${BOT}/api/place-rank?keyword=${encodeURIComponent(keyword)}&placeUrl=${encodeURIComponent(place)}`);
          const result = await response.json();
          if (!result.error && result.rank != null) {
            const previous = Number(localStorage.getItem(`${markerPrefix}_last_rank`));
            if (previous > 0 && result.rank > previous) addNotification(`${keyword} 순위 ${previous}위→${result.rank}위 하락, 유입 보강 권장`);
            localStorage.setItem(`${markerPrefix}_last_rank`, String(result.rank));
            setApLastRank(result.rank);
            await recordRankPoint(userId, result.rank, currentScope);
          }
          markRun("rank", day);
        }
        if (targetType === "place" && place && keyword && !hasRun("competitor", day)) {
          const response = await botFetch(`${BOT}/api/competitors?query=${encodeURIComponent(keyword)}&myPlaceUrl=${encodeURIComponent(place)}`);
          const result = await response.json();
          const mine = result.mine as { rank: number; review: number } | null | undefined;
          const leader = mine && result.top?.find((entry: any) => !entry.isMine && entry.rank < mine.rank);
          if (mine && leader) addNotification(`${leader.name}이 앞질렀어요, 리뷰 ${Math.abs((leader.review || 0) - (mine.review || 0)).toLocaleString()}개 차이`);
          markRun("competitor", day);
        }
        if (targetType === "place" && place && !hasRun("diagnose", week)) {
          const response = await botFetch(`${BOT}/api/place-diagnose?placeUrl=${encodeURIComponent(place)}`);
          const result = await response.json();
          if (!result.error) {
            setDiag(result);
            const weak = result.items?.find((item: any) => !item.ok);
            if (weak) addNotification(`${weak.label} 아직 미설정 · 플레이스 진단에서 확인해 주세요`);
          }
          markRun("diagnose", week);
        }
      } catch {
        // 자동 점검 실패는 기존 기능을 방해하지 않고 다음 폴링/앱 실행 때 다시 시도한다.
      } finally { automationRunningRef.current = false; }
    };
    tick();
    const id = window.setInterval(tick, 60_000);
    return () => window.clearInterval(id);
  }, [apKeyword, keywords, notificationKey, placeUrl, showToast, targetType, userId]);

  const copyLogs = () => {
    if (!logs.length) return;
    navigator.clipboard.writeText(logs.map((entry) => entry.type === "text" ? entry.text : `📸 ${entry.caption}`).join("\n")).then(() => toast("로그 전체를 복사했어요", "success")).catch(() => toast("복사 실패", "error"));
  };
  // 📨 관리자에게 로그 전송 — 문제 생기면 회원이 바로 관리자에게 로그를 보냄
  const [sendingLog, setSendingLog] = useState(false);
  const sendLogToAdmin = async () => {
    if (!logs.length) { toast("보낼 로그가 없어요", "error"); return; }
    setSendingLog(true);
    try {
      const text = logs.map((e) => e.type === "text" ? e.text : `📸 ${e.caption}`).join("\n");
      await sendTrafficLog(memberEmail || userId || "", memberName || "", text.slice(0, 20000));
      toast("관리자에게 로그를 보냈어요 ✅", "success");
    } catch (e: any) { toast("전송 실패: " + (e?.message || "오류"), "error"); }
    finally { setSendingLog(false); }
  };

  const start = () => {
    const runType = (targetType as RunTT);   // ★ 이 실행을 이 탭에 고정 — 탭을 옮기거나 다른 탭을 시작해도 각자 독립으로 돈다.
    if (runningTypes[runType]) return;        // 이 탭이 이미 실행 중이면 무시(다른 탭은 상관없이 시작 가능)
    const kwList = keywords.split(/[,\n]/).map((k) => k.trim()).filter(Boolean);
    if (!kwList.length) { toast("검색 키워드를 1개 이상 입력하세요", "error"); return; }
    if (targetType === "place" && !placeUrl.trim()) { toast("플레이스 주소(지도/플레이스 링크)를 입력하세요", "error"); return; }
    const parsedBlog = targetType === "blog" ? parseBlogUrl(blogUrl) : null;
    if (targetType === "blog" && !parsedBlog) { toast("블로그 글 주소를 붙여넣어 주세요", "error"); return; }
    const parsedStore = targetType === "store" ? parseStoreUrl(storeUrl) : null;
    if (targetType === "store" && !parsedStore) { toast("스마트스토어 상품 주소를 붙여넣어 주세요", "error"); return; }
    if (!unlimited && used >= limit) { toast(`오늘 유입 한도(${limit}회)를 다 썼어요. 자정에 초기화돼요.`, "error"); return; }
    const n = auto ? (unlimited ? 999 : Math.max(1, limit - used)) : Math.max(1, rounds);

    // 항상 새 설정으로 처음부터 시작 — 로그·진행률·성공수 초기화(이어하기 없음)
    setRunningFor(runType, true); clearLogsFor(runType); setProgressFor(runType, 0); setSessOkFor(runType, 0);
    const params = new URLSearchParams({
      targetType, keywords: kwList.join(","), rounds: String(n),
      termMin: String(termMin), termMax: String(termMax),
      doSave: String(doSave), doLike: String(doLike), doNeighbor: String(doNeighbor), doShare: String(doShare),
      doDir: String(doDir), doCall: String(doCall), doBook: String(doBook), doTalk: String(doTalk),
      doWish: String(doWish), doCart: String(doCart), doOption: String(doOption), device,
      fullFunnel: String(funnel),
      spreadHours: spread ? String(spreadHours) : "0",
      doReview: String(doReview), reviewText: doReview ? reviewText : "",
      visible: String(visible),
      actionRate: String(Math.max(0, Math.min(1, actionRate / 100))),
      dwellBaseSec: intensity === "fast" ? "20" : intensity === "deep" ? "180" : "60",
      dwellCustomSec: String(Math.max(0, maxDwellSec)),
      dataSaver,
    });
    if (userId) params.set("userId", userId);
    // ★2026-09-08 중단 확실하게: 프론트가 jobId를 만들어 보내고, 중단 시 이 id로 봇에 명시적 stop 요청(res.on close 전파 실패 대비)
    const inflowJobId = `inflow_${runType}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    params.set("jobId", inflowJobId);
    // 🔄 다계정 로테이션 — 선택된 계정들을 저장·찜·공감에 번갈아. 첫 계정을 기본 accountId로.
    const acctList = accounts.filter((a) => selectedAccts.has(a.id)).map((a) => a.id);
    if (acctList.length) { params.set("accountIds", JSON.stringify(acctList)); params.set("accountId", acctList[0]); }
    else if (accountId) params.set("accountId", accountId);
    if (targetType === "place") params.set("placeUrl", placeUrl.trim());
    else if (targetType === "store") params.set("storeUrl", storeUrl.trim());
    else if (parsedBlog) { params.set("blogId", parsedBlog.blogId); if (parsedBlog.logNo) params.set("logNo", parsedBlog.logNo); }
    // ➕ 추가 대상들(있으면 방문마다 로테이션) — 서버가 targets JSON을 받아 처리
    const extras = extraTargets.map((s) => s.trim()).filter(Boolean);
    if (extras.length) params.set("extraTargets", JSON.stringify(extras));
    // 🎯 키워드 비중(고급) — {키워드:가중치}
    const weights = kwList.map((k) => Number(kwWeights[k]) || 1);
    if (weights.some((w) => w !== 1)) params.set("keywordWeights", JSON.stringify(weights));

    // ── 시작 시 '적용된 설정'을 항목별로 로그에 남긴다(정말 이대로 시작되는지 눈으로 확인) ──
    const deviceLabel = device === "pc" ? "🖥️ PC" : device === "mix" ? "🔀 혼합(랜덤)" : "📱 모바일";
    const intensityLabel = intensity === "fast" ? "빠르게(~20초)" : intensity === "deep" ? "꼼꼼히(~3분)" : "보통(~60초)";
    const baseSecMap: Record<string, number> = { fast: 20, normal: 60, deep: 180 };
    const dwellSec = maxDwellSec > 0 ? maxDwellSec : (baseSecMap[intensity] ?? 60);
    const actionLabels = (targetType === "place"
      ? [doSave && "💾저장", doDir && "🧭길찾기", doCall && "📞전화", doBook && "📅예약", doTalk && "💬톡톡", doShare && "🔗공유"]
      : targetType === "store"
      ? [doOption && "🔍옵션탐색", doWish && "💚찜", doCart && "🛒장바구니", doShare && "🔗공유"]
      : [doLike && "💚공감", doShare && "🔗공유"]).filter(Boolean) as string[];
    const targetLabel = targetType === "place" ? "플레이스" : targetType === "store" ? "스마트스토어" : "블로그";
    const targetUrl = (targetType === "place" ? placeUrl : targetType === "store" ? storeUrl : blogUrl).trim();
    const acctNames = accounts.filter((a) => selectedAccts.has(a.id)).map((a) => a.username);
    pushLog(`━━━━━ 🚀 트래픽 유입 시작 · 적용된 설정(전체) ━━━━━`);
    pushLog(`📍 대상: ${targetLabel}  ·  주소: ${targetUrl || "(없음)"}`);
    if (extras.length) pushLog(`➕ 추가 대상 ${extras.length}개(방문마다 로테이션)`);
    pushLog(`🔎 키워드(${kwList.length}개): ${kwList.join(", ")}`);
    pushLog(`🔁 방문 횟수: ${n}회${auto ? "(자동=오늘 한도까지)" : ""}`);
    pushLog(`👤 로그인 계정: ${acctNames.length ? acctNames.join(", ") : "(선택 안 함 — 저장·찜·공감은 건너뜀)"}`);
    pushLog(`📶 접속패턴(기기): ${deviceLabel}`);
    const actionSec = Math.round(actionLabels.length * 2.5);
    const totalSec = Math.round(dwellSec + actionSec);
    pushLog(`📖 체류시간: ${maxDwellSec > 0 ? `직접지정 약 ${maxDwellSec}초` : `${intensityLabel} 약 ${dwellSec}초`} (방문마다 ±오차)`);
    pushLog(`🎬 방문해서 할 행동: ${actionLabels.length ? `${actionLabels.join("  ")} — 약 ${actionSec}초 추가` : "없음(체류만)"}`);
    if (acctList.length > 1) pushLog(`🔄 다계정 로테이션: ${acctList.length}개 계정을 번갈아 로그인 — 저장·찜·공감이 계정마다 실행돼요`);
    else if (acctList.length === 1) pushLog(`👤 로그인 계정 1개 사용 (저장·찜·공감)`);
    pushLog(`⏳ 방문 텀: ${termMin}~${termMax}초 랜덤${spread ? ` · ${spreadHours}시간 분산` : ""}  ·  🎲 액션확률 ${actionRate}%`);
    pushLog(`⏱️ 예상 방문시간: 약 ${totalSec}초 (체류 ${dwellSec}초 + 행동 ${actionSec}초)`);
    pushLog(`💾 데이터 사용: ${dataSaver === "normal" ? "일반(다 받음 · 가장 자연스러움)" : dataSaver === "save" ? "절약(영상·광고·폰트 차단 · GB 40~50%↓)" : "초절약(이미지까지 차단 · GB 80~90%↓)"}`);
    if (funnel) pushLog(`🌀 풀퍼널 모드 ON — 여러 글·탭까지 둘러봐요`);
    if (auto) pushLog(`⚙️ 자동 모드 — 오늘 한도까지 실행`);
    if (apEnabled) pushLog(`🎯 오토파일럿 ON — "${apKeyword}" ${apGoal}위 목표`);
    // 🔒 프록시(IP) 사용 여부 — 서버 배정 상태를 조회해 로그로 확실히 알려준다
    (async () => {
      try {
        const acctList = accountId ? [accountId] : accounts.map((a) => a.id);
        const q = acctList.length ? `?accts=${encodeURIComponent(acctList.join(","))}` : "";
        const r = await botFetch(`${BOT}/api/my-proxy/${userId || "guest"}${q}`);
        const j = await r.json();
        pushLog(j.active
          ? `🔒 프록시 IP 사용 — 내 실제 IP를 가려서 안전하게 접속해요`
          : `🌐 프록시 미배정 — 내 IP 그대로 접속해요(관리자에게 프록시 배정 요청 가능)`);
      } catch { pushLog(`🌐 프록시 상태 확인 실패 — 봇 서버(3364)를 확인해주세요`); }
    })();
    pushLog(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    const es = new BotEventStream(`${BOT}/api/inflow`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Publy-Session": getMemberSessionToken(), "X-Publy-Admin-Session": getAdminSessionToken() },
      body: JSON.stringify(Object.fromEntries(params.entries())),
    });
    es.jobId = inflowJobId;   // 명시적 중단(/api/stop)용
    esRefByType.current[runType] = es;
    es.onmessage = (e: MessageEvent) => {
      let d: any; try { d = JSON.parse(e.data); } catch { return; }
      if (d.type === "log") pushLogFor(runType, d.msg);
      else if (d.type === "shot" && d.dataUrl) pushShotFor(runType, d.caption || "단계별 화면", d.dataUrl);
      else if (d.type === "progress") {
        setProgressFor(runType, Math.round((d.done / Math.max(1, d.total)) * 100));
        // ★방문마다 '오늘 유입' 실시간 갱신(봇이 성공 시 DB에 저장 → 여기서 재조회). 새로고침 없이 카운트 오르게.
        const sc = currentScopeRef.current;
        if (userId && sc) { getInflowStatToday(userId, sc).then(setTodayScoped).catch(() => {}); getInflowDailyUsage(userId).then(setUsed).catch(() => {}); }
      }
      else if (d.type === "quota_info") setUsed(d.used);
      else if (d.type === "quota_exceeded") { pushLogFor(runType, "🛑 오늘 유입 한도를 다 썼어요"); toast("오늘 유입 한도 초과", "error"); setRunningFor(runType, false); es.close(); esRefByType.current[runType] = null; }
      else if (d.type === "inflow_done") { setSessOkFor(runType, d.success || 0); pushLogFor(runType, `🏁 완료 — 총 ${d.done}회 방문, 성공 ${d.success}회`); toast(`유입 완료 · 성공 ${d.success}회`, "success"); setRunningFor(runType, false); es.close(); esRefByType.current[runType] = null; if (scheduledRunPendingRef.current) { scheduledRunPendingRef.current = false; if (userId && Number(d.success) > 0) void markInflowScheduleRan(userId, scheduledRunScopeRef.current || currentScope); } refreshStats(); if (apEnabled && (runType === "place" || runType === "blog")) { pushLogFor(runType, "📍 순위 자동 측정 중…"); autopilotCheckRef.current().then(() => { if (userId) getRankHistory(userId, chartDays, currentScope).then(setRankHist).catch(() => {}); }); } }
      else if (d.type === "error") { scheduledRunPendingRef.current = false; pushLogFor(runType, `❌ ${d.msg}`); toast(d.msg, "error"); setRunningFor(runType, false); es.close(); esRefByType.current[runType] = null; }
    };
    es.onerror = (detail?: string) => { scheduledRunPendingRef.current = false; const why = detail ? ` — ${detail}` : " — 봇 서버(포트 3364)가 켜져 있는지 확인해주세요(앱을 완전히 껐다 켜기)"; pushLogFor(runType, `❌ 유입 시작 실패${why}`); toast(`유입 시작 실패${detail ? " · " + detail : " · 봇 연결 확인"}`, "error"); setRunningFor(runType, false); es.close(); esRefByType.current[runType] = null; };
    es.onclose = () => setRunningFor(runType, false);
  };
  startRef.current = start;
  // 그만두면 완전 취소(이어하기 없음). 현재 보고 있는 탭만 정지.
  // ★2026-09-08 중단 확실하게: SSE abort만으론 봇에 전파 안 될 수 있어(계속 실행 버그) → 봇에 명시적 stop 요청도 보낸다.
  const stop = () => {
    const t = (targetType as RunTT);
    const es = esRefByType.current[t];
    const jid = es?.jobId || "";
    es?.close();                              // ① SSE(fetch) 중단
    esRefByType.current[t] = null;
    setRunningFor(t, false);
    if (jid) botFetch(`${BOT}/api/stop/${encodeURIComponent(jid)}`, { method: "POST" }).catch(() => {});  // ② 봇에 명시적 중단(확실)
    pushLogFor(t, "⏹ 그만뒀어요 — 봇에 중단 신호를 보냈어요. 진행 중인 방문 하나를 마치면 완전히 멈춰요(설정을 바꿔 다시 시작하면 처음부터).");
  };

  const pct = unlimited ? 0 : Math.min(100, (used / Math.max(1, limit)) * 100);
  const weekTotal = history.reduce((s, d) => s + d.count, 0);

  // 🌱 새싹 비서 — 지금 데이터 상태를 보고 "오늘 뭐 하세요" 한마디(우선순위 규칙, AI 키 불필요)
  const sproutAdvice = (() => {
    const hasTarget = targetType === "place" ? !!placeUrl.trim() : targetType === "store" ? !!storeUrl.trim() : !!blogUrl.trim();
    if (!hasTarget) return { tone: "start", msg: `먼저 내 ${targetType === "place" ? "플레이스" : targetType === "store" ? "스마트스토어 상품" : "블로그 글"} 주소를 넣어주세요. 그럼 순위·유입까지 제가 챙겨드릴게요!` };
    if (!keywords.trim()) return { tone: "start", msg: "검색 키워드를 넣어주세요. ‘🔎 키워드 추천’을 누르면 숨은 키워드도 찾아드려요." };
    // 진단 결과 있으면 부족 항목 우선
    if (diag) { const weak = diag.items.find(it => !it.ok); if (weak && diag.score < 90) return { tone: "fix", msg: `진단 점수 ${diag.score}점! ‘${weak.label}’만 채우면 순위가 더 잘 올라요 — ${weak.tip}` }; }
    // 순위 목표 대비
    if (apLastRank != null) {
      if (apLastRank <= apGoal) return { tone: "good", msg: `현재 ${apLastRank}위로 목표(${apGoal}위)를 지키고 있어요. 이 강점을 소식·홍보에 계속 노출하세요!` };
      return { tone: "push", msg: `현재 ${apLastRank}위 — 목표 ${apGoal}위까지 유입을 조금 더 채우면 좋아요. ‘유입 시작’을 눌러보세요.` };
    }
    // 리뷰 분석 있으면 강점 홍보 제안
    if (revResult && revResult.likes[0]) return { tone: "tip", msg: `손님들이 ‘${revResult.likes[0].word}’을(를) 가장 좋아해요. 이 강점을 대표 사진·소식에 내세우면 클릭률이 올라가요.` };
    if (weekTotal > 0) return { tone: "good", msg: `이번 주 유입 ${weekTotal}명이 쌓였어요. ‘📍 순위 측정’으로 지금 순위를 확인해볼까요?` };
    return { tone: "start", msg: "준비 완료! ‘유입 시작’을 누르면 진짜 손님처럼 방문이 쌓이기 시작해요. 무리하지 않게 안전 한도 안에서요." };
  })();
  const inputStyle: React.CSSProperties = { width: "100%", padding: "13px 14px", borderRadius: 12, border: `1.5px solid ${C.line2}`, background: C.panel2, color: C.ink, fontSize: 15, fontWeight: 600, fontFamily: "inherit", boxSizing: "border-box" };
  const labelStyle: React.CSSProperties = { fontSize: 13.5, fontWeight: 800, color: C.ink, marginBottom: 8, display: "block" };
  const chk: React.CSSProperties = { display: "flex", alignItems: "center", gap: 7, cursor: "pointer", fontSize: 14, fontWeight: 700, color: C.ink, padding: "8px 12px", borderRadius: 10, border: `1px solid ${C.line}`, background: C.panel2 };

  const ActionChk = ({ v, set, label, desc }: { v: boolean; set: (b: boolean) => void; label: string; desc?: string }) => (
    <label style={{ display: "flex", alignItems: "flex-start", gap: 8, cursor: "pointer", padding: "10px 12px", borderRadius: 10, border: `1.5px solid ${v ? C.accent : C.line}`, background: v ? C.glow : C.panel2, minWidth: 150, flex: "1 1 160px" }}>
      <input type="checkbox" checked={v} onChange={(e) => set(e.target.checked)} style={{ width: 17, height: 17, accentColor: C.accent, marginTop: 1, flexShrink: 0 }} />
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 13.5, fontWeight: 800, color: v ? C.accent : C.ink }}>{label}</div>
        {desc && <div style={{ fontSize: 10.5, fontWeight: 600, color: C.sub, marginTop: 1, lineHeight: 1.4 }}>{desc}</div>}
      </div>
    </label>
  );
  // 🎨 실행패널 그룹 구분 헤더 — 묶이는 기능을 색으로 나눠 한눈에 구분(밋밋함 제거)
  const GroupHeader = ({ n, title, desc, color }: { n: string; title: string; desc: string; color: string }) => (
    <div style={{ display: "flex", alignItems: "center", gap: 11, padding: "11px 14px", borderRadius: 12, background: `${color}14`, borderLeft: `5px solid ${color}`, marginTop: 4 }}>
      <span style={{ width: 26, height: 26, borderRadius: 8, background: color, color: "#fff", fontSize: 14, fontWeight: 900, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>{n}</span>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 14, fontWeight: 900, color }}>{title}</div>
        <div style={{ fontSize: 11.5, fontWeight: 600, color: C.sub, marginTop: 1 }}>{desc}</div>
      </div>
    </div>
  );

  // 📚 글 불러오기 팝업(글주소 직접 / 로그인해 내 글) — 관리자·회원 공용 렌더 변수
  const postPopupUI = (<>
    {postPopup === "manual" && (
      <div onClick={() => setPostPopup(null)} style={{ position: "fixed", inset: 0, zIndex: 10000, background: "rgba(0,0,0,.6)", display: "flex", alignItems: "center", justifyContent: "center", padding: 18 }}>
        <div onClick={(e) => e.stopPropagation()} style={{ width: "100%", maxWidth: 460, background: C.panel, borderRadius: 18, border: `2px solid ${C.accent}`, overflow: "hidden", boxShadow: "0 24px 60px rgba(0,0,0,.45)" }}>
          <div style={{ padding: "16px 18px", background: `linear-gradient(135deg,${C.accent},${C.cyan})`, color: "#fff" }}>
            <div style={{ fontSize: 16, fontWeight: 900 }}>📝 글 주소 직접 넣기</div>
            <div style={{ fontSize: 12, fontWeight: 600, opacity: .92, marginTop: 2 }}>로그인 없이 · 원하는 글 링크를 넣어 그 글에 트래픽을 걸어요</div>
          </div>
          <div style={{ padding: 18 }}>
            <div style={{ fontSize: 12.5, fontWeight: 700, color: C.ink, lineHeight: 1.6, marginBottom: 9, background: "rgba(16,133,107,.08)", border: "1.5px solid #16a34a", borderRadius: 10, padding: "9px 12px" }}>
              <b style={{ color: "#16a34a" }}>✅ 로그인 필요 없어요.</b> 글 주소만 있으면 방문·체류·읽기·공유가 돼요. <b>한 줄에 하나씩</b> 여러 개 넣으면 방문마다 번갈아 방문해요(로테이션).
            </div>
            <textarea value={manualPostUrls} onChange={(e) => setManualPostUrls(e.target.value)} rows={5}
              placeholder={"blog.naver.com/아이디/글번호\nblog.naver.com/아이디/글번호2\n... (한 줄에 하나씩)"}
              style={{ ...inputStyle, resize: "vertical", fontSize: 13, lineHeight: 1.6 }} />
            <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
              <button onClick={() => setPostPopup(null)} style={{ flex: 1, padding: "12px", borderRadius: 11, border: `1.5px solid ${C.line2}`, background: C.panel2, color: C.sub, fontSize: 13.5, fontWeight: 800, cursor: "pointer", fontFamily: "inherit" }}>취소</button>
              <button onClick={() => { const urls = manualPostUrls.split(/[\n,]/).map((s) => s.trim()).filter((s) => parseBlogUrl(s)); if (!urls.length) { toast("올바른 블로그 글 주소를 넣어주세요", "error"); return; } applyPostsAsTargets(urls); }} style={{ flex: 2, padding: "12px", borderRadius: 11, border: "none", background: `linear-gradient(135deg,${C.accent},${C.cyan})`, color: "#fff", fontSize: 13.5, fontWeight: 900, cursor: "pointer", fontFamily: "inherit" }}>🎯 이 글들을 유입 대상으로</button>
            </div>
          </div>
        </div>
      </div>
    )}
    {postPopup === "login" && (
      <div onClick={() => setPostPopup(null)} style={{ position: "fixed", inset: 0, zIndex: 10000, background: "rgba(0,0,0,.6)", display: "flex", alignItems: "center", justifyContent: "center", padding: 18 }}>
        <div onClick={(e) => e.stopPropagation()} style={{ width: "100%", maxWidth: 480, maxHeight: "88vh", overflowY: "auto", background: C.panel, borderRadius: 18, border: "2px solid #d97706", boxShadow: "0 24px 60px rgba(0,0,0,.45)" }}>
          <div style={{ padding: "16px 18px", background: "linear-gradient(135deg,#f59e0b,#d97706)", color: "#fff" }}>
            <div style={{ fontSize: 16, fontWeight: 900 }}>🔐 로그인해서 내 글 불러오기</div>
            <div style={{ fontSize: 12, fontWeight: 600, opacity: .92, marginTop: 2 }}>연결한 계정으로 내 글 목록을 불러와 골라서 트래픽을 걸어요</div>
          </div>
          <div style={{ padding: 18 }}>
            <div style={{ fontSize: 12.5, fontWeight: 700, color: C.ink, lineHeight: 1.7, marginBottom: 11, background: "rgba(245,158,11,.10)", border: "1.5px solid #d97706", borderRadius: 10, padding: "10px 13px" }}>
              <b style={{ color: "#d97706" }}>🔑 로그인이 필요해요.</b> 내 글 목록은 로그인해야 볼 수 있어요.<br />
              <b>① 오른쪽 위 ‘🔗 계정’</b>에서 네이버 아이디·비밀번호로 연결한 뒤<br />
              <b>② 여기서 그 계정을 선택</b>하면 목록이 나와요. <span style={{ color: C.sub }}>(한 번 연결하면 다음부턴 비번 없이 바로)</span>
            </div>
            <div style={{ fontSize: 12, fontWeight: 800, color: C.sub, marginBottom: 6 }}>불러올 계정 (계정 연결한 것)</div>
            {accounts.length === 0 ? (
              <div style={{ fontSize: 12.5, fontWeight: 700, color: "#dc2626", padding: "11px 13px", borderRadius: 10, background: "rgba(220,38,38,.06)", border: "1px solid rgba(220,38,38,.3)", lineHeight: 1.6 }}>⚠️ 아직 연결된 네이버 계정이 없어요.<br /><b>오른쪽 위 ‘🔗 계정’으로 연결</b>한 뒤 다시 오세요.</div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {accounts.map((a) => { const on = popupAccountId === a.id; return (
                  <button key={a.id} onClick={() => setPopupAccountId(a.id)} style={{ display: "flex", alignItems: "center", gap: 9, padding: "10px 12px", borderRadius: 10, background: on ? C.glow : C.panel2, border: `1.5px solid ${on ? C.accent : C.line}`, cursor: "pointer", fontFamily: "inherit", textAlign: "left" }}>
                    <span style={{ width: 9, height: 9, borderRadius: "50%", background: on ? C.accent : C.line2, flexShrink: 0 }} />
                    <span style={{ fontSize: 13.5, fontWeight: 800, color: on ? C.accent : C.ink }}>{on ? "✓ " : ""}{a.username}</span>
                    {a.blog_name && <span style={{ fontSize: 11, color: C.sub, fontWeight: 600 }}>· {a.blog_name}</span>}
                  </button>
                ); })}
              </div>
            )}
            <div style={{ marginTop: 12, padding: "11px 13px", borderRadius: 11, background: C.panel2, border: `1px solid ${C.line}` }}>
              <div style={{ fontSize: 12, fontWeight: 800, color: C.sub, marginBottom: 7 }}>📅 어느 기간 글을 불러올까요</div>
              <div style={{ display: "flex", gap: 6, marginBottom: postDateMode === "all" ? 0 : 9 }}>
                {([["all", "전체"], ["recent", "최근 N일"], ["range", "날짜 지정"]] as const).map(([k, lb]) => (
                  <button key={k} onClick={() => setPostDateMode(k)} style={{ flex: 1, padding: "8px 6px", borderRadius: 9, border: `1.5px solid ${postDateMode === k ? C.accent : C.line2}`, background: postDateMode === k ? C.glow : C.panel, color: postDateMode === k ? C.accent : C.sub, fontSize: 12.5, fontWeight: 800, cursor: "pointer", fontFamily: "inherit" }}>{postDateMode === k ? "✓ " : ""}{lb}</button>
                ))}
              </div>
              {postDateMode === "recent" && (
                <div style={{ display: "flex", gap: 6 }}>
                  {[7, 30, 90, 180].map((d) => (
                    <button key={d} onClick={() => setPostRecentDays(d)} style={{ flex: 1, padding: "7px 4px", borderRadius: 8, border: `1.5px solid ${postRecentDays === d ? C.accent : C.line2}`, background: postRecentDays === d ? C.glow : C.panel, color: postRecentDays === d ? C.accent : C.sub, fontSize: 12, fontWeight: 800, cursor: "pointer", fontFamily: "inherit" }}>{d}일</button>
                  ))}
                </div>
              )}
              {postDateMode === "range" && (
                <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
                  <input type="date" value={postFrom} max={postTo || undefined} onChange={(e) => setPostFrom(e.target.value)} style={{ ...inputStyle, flex: 1, padding: "8px 10px", fontSize: 12.5 }} />
                  <span style={{ fontSize: 12, fontWeight: 800, color: C.sub }}>~</span>
                  <input type="date" value={postTo} min={postFrom || undefined} onChange={(e) => setPostTo(e.target.value)} style={{ ...inputStyle, flex: 1, padding: "8px 10px", fontSize: 12.5 }} />
                </div>
              )}
            </div>
            <button onClick={() => collectMyPosts(popupAccountId)} disabled={!popupAccountId || myPostsLoading} style={{ width: "100%", marginTop: 11, padding: "12px", borderRadius: 11, border: "none", background: (popupAccountId && !myPostsLoading) ? "linear-gradient(135deg,#f59e0b,#d97706)" : C.line2, color: "#fff", fontSize: 13.5, fontWeight: 900, cursor: (popupAccountId && !myPostsLoading) ? "pointer" : "default", fontFamily: "inherit" }}>{myPostsLoading ? "불러오는 중…" : "📚 내 글 불러오기"}</button>
            {myPosts.length > 0 && (<div style={{ marginTop: 14, paddingTop: 12, borderTop: `1px solid ${C.line}` }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 8 }}>
                <button onClick={selectAllPosts} style={{ padding: "6px 12px", borderRadius: 8, border: `1.5px solid ${C.accent}`, background: C.glow, color: C.accent, fontSize: 12, fontWeight: 800, cursor: "pointer", fontFamily: "inherit" }}>✅ 전체 선택</button>
                <button onClick={clearSelectedPosts} style={{ padding: "6px 12px", borderRadius: 8, border: `1.5px solid ${C.line2}`, background: C.panel2, color: C.sub, fontSize: 12, fontWeight: 800, cursor: "pointer", fontFamily: "inherit" }}>◻️ 전체 해제</button>
                <span style={{ fontSize: 12, fontWeight: 800, color: C.ink }}>선택 {selectedPosts.size}/{myPosts.length}개</span>
              </div>
              <div style={{ maxHeight: 240, overflowY: "auto", display: "flex", flexDirection: "column", gap: 5 }}>
                {myPosts.map((p) => { const on = selectedPosts.has(p.url); return (
                  <label key={p.url} style={{ display: "flex", alignItems: "center", gap: 9, padding: "8px 10px", borderRadius: 9, background: on ? C.glow : C.panel2, border: `1px solid ${on ? C.accent : C.line}`, cursor: "pointer" }}>
                    <input type="checkbox" checked={on} onChange={() => togglePost(p.url)} style={{ width: 16, height: 16, accentColor: C.accent, flexShrink: 0 }} />
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div style={{ fontSize: 13, fontWeight: 700, color: C.ink, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{p.title || "(제목 없음)"}</div>
                      {p.date && <div style={{ fontSize: 10.5, color: C.sub, fontWeight: 600 }}>{p.date}</div>}
                    </div>
                  </label>
                ); })}
              </div>
              <button onClick={applySelectedPostsAsTargets} disabled={!selectedPosts.size} style={{ width: "100%", marginTop: 10, padding: "12px", borderRadius: 11, border: "none", background: selectedPosts.size ? `linear-gradient(135deg,${C.accent},${C.cyan})` : C.line2, color: "#fff", fontSize: 13.5, fontWeight: 900, cursor: selectedPosts.size ? "pointer" : "default", fontFamily: "inherit" }}>🎯 선택한 {selectedPosts.size}개 글을 유입 대상으로</button>
            </div>)}
            <button onClick={() => setPostPopup(null)} style={{ width: "100%", marginTop: 8, padding: "10px", borderRadius: 11, border: `1.5px solid ${C.line2}`, background: C.panel2, color: C.sub, fontSize: 13, fontWeight: 800, cursor: "pointer", fontFamily: "inherit" }}>닫기</button>
          </div>
        </div>
      </div>
    )}
  </>);

  // ═══════════════════════════════════════════════════════════════════
  // 🚦 회원 트래픽 앱 = 목업 화면(퍼블리_트래픽_목업.html)만.
  //    관리자 컨트롤타워에서 승인한 것만 보임: 대상(visibleFeats)·행동(actionAllowed)·등급/한도·데이터모드(관리자지정, 화면엔 안 보임).
  //    엔진(start/한도/SSE)·순위측정(runMeasureRank)·기록그래프는 그대로 재사용. 기존 관리자 렌더는 아래(memberMode=false).
  if (memberMode) {
    const GRADE = { basic: "베이직", pro: "프로", premium: "프리미엄", unlimited: "무제한" } as const;
    const gradeLabel = featLic ? ((GRADE as any)[featLic.plan] || featLic.plan) : "";
    const addr = targetType === "place" ? placeUrl : targetType === "store" ? storeUrl : blogUrl;
    const setAddr = targetType === "place" ? setPlaceUrl : targetType === "store" ? setStoreUrl : setBlogUrl;
    const addrPlaceholder = targetType === "place" ? "지도/플레이스 링크 붙여넣기" : targetType === "store" ? "스마트스토어 상품 주소 붙여넣기" : "블로그 글 주소 붙여넣기";
    const rankText = targetType === "store" ? "미지원" : apLastRank != null ? `${apLastRank}위` : apRankOut ? "30위 밖" : "미측정";
    const mInput: React.CSSProperties = { width: "100%", padding: "9px 11px", border: `1px solid ${C.line2}`, borderRadius: 8, background: C.panel2, color: C.ink, fontSize: 13, fontFamily: "inherit", boxSizing: "border-box" };
    const mCard: React.CSSProperties = { background: C.panel2, border: `1px solid ${C.line}`, borderRadius: 11, padding: "12px 13px" };
    const mH: React.CSSProperties = { margin: "0 0 8px", fontSize: 12.5, fontWeight: 800, display: "flex", alignItems: "center" };
    const mNum: React.CSSProperties = { width: 17, height: 17, borderRadius: 5, background: C.accent, color: "#fff", fontSize: 10.5, fontWeight: 900, display: "inline-flex", alignItems: "center", justifyContent: "center", marginRight: 6 };
    const mFl: React.CSSProperties = { fontSize: 10.5, fontWeight: 700, color: C.sub, margin: "9px 0 4px" };
    // 승인된 행동만 노출(로그인 없이 / 로그인 필요) — 관리자 allowed_actions 기준
    const placeFree: [string, boolean, (b: boolean) => void, string][] = [["dir", doDir, setDoDir, "🧭 길찾기"], ["call", doCall, setDoCall, "📞 전화"], ["book", doBook, setDoBook, "📅 예약"], ["talk", doTalk, setDoTalk, "💬 톡톡"], ["share", doShare, setDoShare, "🔗 공유"]];
    const placeLogin: [string, boolean, (b: boolean) => void, string][] = [["save", doSave, setDoSave, "💾 저장"], ["review", doReview, setDoReview, "✍️ 리뷰"]];
    const blogFree: [string, boolean, (b: boolean) => void, string][] = [["share", doShare, setDoShare, "🔗 공유"], ["funnel", funnel, setFunnel, "🌀 퍼널유입(다른글·이웃)"]];
    const blogLogin: [string, boolean, (b: boolean) => void, string][] = [["like", doLike, setDoLike, "💚 공감"], ["neighbor", doNeighbor, setDoNeighbor, "👥 이웃추가"]];
    const storeFree: [string, boolean, (b: boolean) => void, string][] = [["option", doOption, setDoOption, "🔍 옵션보기"], ["share", doShare, setDoShare, "🔗 공유"]];
    const storeLogin: [string, boolean, (b: boolean) => void, string][] = [["wish", doWish, setDoWish, "💚 찜"], ["cart", doCart, setDoCart, "🛒 장바구니"]];
    const freeActs = targetType === "place" ? placeFree : targetType === "store" ? storeFree : blogFree;
    const loginActs = targetType === "place" ? placeLogin : targetType === "store" ? storeLogin : blogLogin;
    const Pill = ([key, v, set, label]: [string, boolean, (b: boolean) => void, string]) => actionAllowed(key)
      ? <span key={key + label} onClick={() => set(!v)} style={{ padding: "6px 11px", borderRadius: 8, border: `1.5px solid ${v ? C.accent : C.line2}`, background: v ? C.glow : C.panel, color: v ? C.accent : C.sub, fontSize: 12, fontWeight: 700, cursor: "pointer", userSelect: "none" }}>{label}</span>
      : null;
    const anyFree = freeActs.some(([k]) => actionAllowed(k));
    const anyLogin = loginActs.some(([k]) => actionAllowed(k));

    return (
      <div style={{ fontFamily: "'Pretendard','Apple SD Gothic Neo',sans-serif", color: C.ink, display: "flex", flexDirection: "column" }}>
        {/* 라이선스 없음 = 잠금(실행은 막되, 과거 유입 기록은 읽기전용으로 보여줌) */}
        {visibleFeats.length === 0 ? (
          <div>
            <div style={{ background: C.panel2, border: `1.5px dashed ${C.line2}`, borderRadius: 14, padding: "34px 24px", textAlign: "center" }}>
              <div style={{ fontSize: 40, marginBottom: 10 }}>🔒</div>
              <div style={{ fontSize: 15, fontWeight: 900, marginBottom: 6 }}>대여 기간이 아니에요</div>
              <div style={{ fontSize: 12.5, color: C.sub, fontWeight: 600, lineHeight: 1.6 }}>지금은 유입을 실행할 수 없어요. 아래에서 <b style={{ color: C.accent }}>그동안 사용 기록</b>은 확인할 수 있어요.<br />다시 쓰려면 결제·연장 문의를 해주세요.</div>
              <button onClick={() => { try { window.open("https://open.kakao.com/o/s5wAJ1Li", "_blank"); } catch {} }} style={{ marginTop: 12, padding: "11px 20px", borderRadius: 10, border: "none", background: `linear-gradient(135deg,${C.accent},${C.cyan})`, color: "#fff", fontSize: 13, fontWeight: 900, cursor: "pointer", fontFamily: "inherit" }}>💬 결제 · 연장 문의(카카오톡)</button>
            </div>
            <div style={{ marginTop: 14, ...mCard }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 8, marginBottom: 10 }}>
                <span style={{ fontSize: 13, fontWeight: 800 }}>📊 그동안 유입 기록</span>
                <div style={{ display: "flex", gap: 6 }}>
                  {[[7, "7일"], [30, "30일"], [90, "90일"], [365, "전체"]].map(([d, lb]) => (
                    <button key={d as number} onClick={() => setChartDays(d as number)} style={{ padding: "5px 11px", borderRadius: 8, border: `1.5px solid ${chartDays === d ? C.accent : C.line2}`, background: chartDays === d ? C.glow : C.panel, color: chartDays === d ? C.accent : C.sub, fontSize: 12, fontWeight: 800, cursor: "pointer", fontFamily: "inherit" }}>{chartDays === d ? "✓ " : ""}{lb as string}</button>
                  ))}
                </div>
              </div>
              <div style={{ fontSize: 11, fontWeight: 700, color: C.sub, marginBottom: 4 }}>{chartDays >= 365 ? "전체" : `최근 ${chartDays}일`} 유입 추이 · 총 {weekTotal}회</div>
              {history.length > 0 ? <AreaChart data={history} C={C} /> : <div style={{ height: 120, display: "flex", alignItems: "center", justifyContent: "center", color: C.sub, fontSize: 12.5, fontWeight: 600 }}>기록이 없어요</div>}
            </div>
          </div>
        ) : (<>
          {/* hint */}
          <div style={{ fontSize: 12, color: C.sub, fontWeight: 600, lineHeight: 1.6, background: C.glow, border: `1px solid ${C.line2}`, borderRadius: 9, padding: "9px 12px", marginBottom: 12 }}>
            🔎 <b style={{ color: C.accent }}>트래픽 유입</b> — 키워드로 검색 → 진입 → 체류 → 액션까지 진짜 손님처럼. 관리자가 승인한 <b style={{ color: C.accent }}>대상·행동</b>만 보여요.
          </div>

          {/* 대상 탭 — 관리자가 승인한 것만 보임(미승인은 아예 렌더 안 함). 1개만 승인이면 탭 1개만. */}
          <style>{`@keyframes pulsePink{0%{box-shadow:0 0 0 0 rgba(34,197,94,.7)}70%{box-shadow:0 0 0 5px rgba(34,197,94,0)}100%{box-shadow:0 0 0 0 rgba(34,197,94,0)}}`}</style>
          <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
            {([["place", "🗺️ 플레이스"], ["blog", "📝 블로그"], ["store", "🛒 스마트스토어"], ["backlink", "🔗 백링크"]] as [("place" | "blog" | "store" | "backlink"), string][]).filter(([k]) => allowFeat(k)).map(([k, lb]) => {
              // 백링크 탭은 blTab으로 분리(유입 targetType과 별개). 유입탭은 targetType.
              const on = k === "backlink" ? blTab : (targetType === k && !blTab);
              const onClick = k === "backlink" ? () => setBlTab(true) : () => { setTargetType(k as "place" | "blog" | "store"); setBlTab(false); };
              // 🎫 이 탭(툴)의 등급·남은기간 — 한 회원도 탭마다 등급·만료가 다르다(테리 강조). 각 탭에 개별 표시.
              const GL: Record<string, string> = { basic: "베이직", pro: "프로", premium: "프리미엄", unlimited: "무제한" };
              const tPlan = licenseByFeat?.[k]?.plan;
              const tRem = licenseRemainByFeat?.[k];
              const tDday = (tRem != null) ? Math.floor(tRem / 86400) : null;
              const expiring = (tRem != null) && tRem <= 3 * 86400;   // D-3 이하 임박=빨강
              // 🟢 이 유입 탭이 지금 돌고 있는지(동시 실행) — 탭마다 초록 점으로 표시. 백링크는 해당 없음.
              const tRunning = k !== "backlink" && (runningTypes[k as RunTT] ?? false);
              return <div key={k} onClick={onClick} style={{ flex: 1, padding: "9px 8px", borderRadius: 11, border: `2px solid ${on ? C.accent : C.line2}`, background: on ? C.glow : C.panel2, color: on ? C.accent : C.sub, cursor: "pointer", textAlign: "center", display: "flex", flexDirection: "column", alignItems: "center", gap: 4, position: "relative" }}>
                {tRunning && <span title="실행 중" style={{ position: "absolute", top: 6, right: 6, width: 8, height: 8, borderRadius: "50%", background: "#22c55e", boxShadow: "0 0 8px #22c55e", animation: "pulsePink 1.4s infinite" }} />}
                <span style={{ fontSize: 13.5, fontWeight: 800 }}>{lb}{tRunning ? " ▶" : ""}</span>
                {tPlan && <span style={{ display: "inline-flex", gap: 4, alignItems: "center", fontSize: 10, fontWeight: 900 }}>
                  <span style={{ padding: "1px 6px", borderRadius: 99, background: on ? C.accent : C.line2, color: on ? "#fff" : C.sub }}>{GL[tPlan] || tPlan}</span>
                  {tDday != null && <span style={{ padding: "1px 6px", borderRadius: 99, background: expiring ? "rgba(220,38,38,.12)" : "transparent", color: expiring ? "#dc2626" : (on ? C.accent : C.sub), border: `1px solid ${expiring ? "rgba(220,38,38,.35)" : (on ? C.accent : C.line2)}` }}>{(tRem ?? 0) <= 0 ? "만료" : `D-${tDday}`}</span>}
                </span>}
              </div>;
            })}
          </div>

          {/* 🔗 백링크 탭이면 백링크 화면(도메인·현황·로그·색인키). 유입 본체는 아래 !blTab로 숨김(탭이동 초기화 방지 위해 언마운트 아님). */}
          <div style={{ display: blTab ? "block" : "none" }}>
            <BacklinkTab theme={theme} memberEmail={memberEmail} memberName={memberName} />
          </div>

          {/* 유입 본체 — 백링크 탭일 땐 숨김 */}
          <div style={{ display: blTab ? "none" : "block" }}>
          {/* 대상별 기능설명 — 라벨('스마트스토어')만으론 뭘 하는지 헷갈려서 명확히(테리 지시) */}
          <div style={{ fontSize: 12, color: C.sub, fontWeight: 700, lineHeight: 1.6, background: C.glow, border: `1px solid ${C.line2}`, borderRadius: 9, padding: "9px 12px", marginBottom: 12 }}>
            {targetType === "place"
              ? <>🗺️ <b style={{ color: C.accent }}>플레이스</b> — 내 가게를 <b>네이버 지도·검색에서 상위</b>로 끌어올려요. 키워드 검색→방문→체류로 노출 순위를 높여요.</>
              : targetType === "store"
              ? <>🛒 <b style={{ color: C.accent }}>스마트스토어</b> — 내 상품을 <b style={{ color: C.accent }}>네이버쇼핑 검색에서 순위를 끌어올리는</b> 기능이에요. 진짜 손님처럼 <b>검색 → 경쟁상품 비교 → 내 상품 클릭 → 상세·리뷰·옵션 꼼꼼히 보고 → 다른 상품도 구경</b>하고, 연관 검색어로도 다양하게 들어와요. (찜·리뷰는 로그인이 필요해 하지 않아요)</>
              : <>📝 <b style={{ color: C.accent }}>블로그</b> — 내 글을 <b>네이버 검색에서 상위</b>로 끌어올려요. 키워드 검색→조회→체류로 노출을 높여요.</>}
          </div>
          {/* 🛒 스토어 안전 사용법 — 큰 글씨(무리하면 네이버가 어뷰징으로 봄). 락은 안 걸고 조언만. 상품 무관 문구. */}
          {targetType === "store" && (() => {
            const tips = [
              { i: "📊", t: "하루 100~200회", d: "너무 많으면 네이버가 이상하게 봐서 오히려 손해예요." },
              { i: "🎯", t: "키워드 3~5개로 나눠서", d: "한 키워드에 몰빵하지 말고 여러 개로 골고루 나눠 돌리세요." },
              { i: "📅", t: "며칠에 걸쳐 꾸준히", d: "하루 몰아치기보다 매일 조금씩이 안전하고 효과도 좋아요." },
              { i: "🔝", t: "상위 드는 키워드로", d: "아래 순위 확인으로 상위에 드는 키워드를 찾아 거기에 집중하세요." },
            ];
            return (
              <div style={{ background: `linear-gradient(135deg,${C.glow},transparent)`, border: `1.5px solid ${C.line2}`, borderRadius: 14, padding: "14px 15px", marginBottom: 12 }}>
                <div style={{ fontSize: 15, fontWeight: 900, color: C.accent, marginBottom: 12, display: "flex", alignItems: "center", gap: 7 }}><span style={{ fontSize: 18 }}>🛡️</span> 스토어 안전 사용법 <span style={{ fontSize: 11, fontWeight: 700, color: C.sub }}>(꼭 지켜주세요)</span></div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                  {tips.map((t, i) => (
                    <div key={i} style={{ background: C.panel, borderRadius: 11, padding: "11px 12px", border: `1px solid ${C.line}` }}>
                      <div style={{ fontSize: 14, fontWeight: 900, color: C.ink, marginBottom: 4, display: "flex", alignItems: "center", gap: 6 }}><span style={{ fontSize: 17 }}>{t.i}</span>{t.t}</div>
                      <div style={{ fontSize: 12, fontWeight: 600, color: C.sub, lineHeight: 1.55 }}>{t.d}</div>
                    </div>
                  ))}
                </div>
              </div>
            );
          })()}
          {/* 4패널 */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 12 }}>
            <div style={mCard}>
              <h3 style={mH}><span style={mNum}>1</span> 대상 · 키워드</h3>
              <div style={mFl}>{targetType === "place" ? "내 플레이스 주소" : targetType === "store" ? "내 상품 주소" : "내 블로그 글 주소 / 아이디"}</div>
              <input style={mInput} value={addr} onChange={(e) => setAddr(e.target.value)} placeholder={addrPlaceholder} />
              {/* 블로그: 글 불러오기(글주소 직접 / 로그인해서 내 글) */}
              {targetType === "blog" && (
                <div style={{ display: "flex", gap: 6, marginTop: 6 }}>
                  <button onClick={() => setPostPopup("manual")} style={{ flex: 1, padding: "8px", borderRadius: 8, border: `1.5px solid ${C.accent}`, background: C.panel, color: C.accent, fontSize: 11.5, fontWeight: 800, cursor: "pointer", fontFamily: "inherit" }}>📝 글주소 직접</button>
                  <button onClick={() => setPostPopup("login")} style={{ flex: 1, padding: "8px", borderRadius: 8, border: `1.5px solid #d97706`, background: C.panel, color: "#d97706", fontSize: 11.5, fontWeight: 800, cursor: "pointer", fontFamily: "inherit" }}>📚 로그인해 내 글</button>
                </div>
              )}
              {/* 🎯 지정된 대상(글) 전체목록 — '내 글 불러오기'로 여러 글을 지정하면 첫 글만 위 칸에 보이고 나머지는 여기서 전부 확인·삭제 */}
              {(() => {
                const pickedList = [addr, ...extraTargets].map((u) => (u || "").trim()).filter(Boolean);
                if (pickedList.length < 2) return null;
                const removeAt = (i: number) => { const all = [...pickedList]; all.splice(i, 1); setAddr(all[0] || ""); setExtraTargets(all.slice(1)); setPickedPostCount(all.length); };
                return (
                  <div style={{ marginTop: 8, padding: "9px 11px", borderRadius: 9, background: C.glow, border: `1px solid ${C.accent}` }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6 }}>
                      <span style={{ fontSize: 12, fontWeight: 800, color: C.accent }}>🎯 지정된 {targetType === "blog" ? "글" : "대상"} {pickedList.length}개 <span style={{ color: C.sub, fontWeight: 700 }}>· 방문마다 번갈아</span></span>
                      <button onClick={() => { setExtraTargets([]); setPickedPostCount(addr.trim() ? 1 : 0); toast("지정 목록 해제 — 첫 주소만 남겼어요", "info"); }} style={{ marginLeft: "auto", padding: "3px 9px", borderRadius: 7, border: `1px solid ${C.line2}`, background: C.panel, color: C.sub, fontSize: 10.5, fontWeight: 800, cursor: "pointer", fontFamily: "inherit" }}>전체 해제</button>
                    </div>
                    <div style={{ maxHeight: 150, overflowY: "auto", display: "flex", flexDirection: "column", gap: 4 }}>
                      {pickedList.map((u, i) => (
                        <div key={i} style={{ display: "flex", alignItems: "center", gap: 7, padding: "6px 8px", borderRadius: 7, background: C.panel, border: `1px solid ${C.line}` }}>
                          <span style={{ fontSize: 10.5, fontWeight: 800, color: C.sub, flexShrink: 0, minWidth: 14 }}>{i + 1}</span>
                          <span style={{ fontSize: 11.5, color: C.ink, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", flex: 1 }} title={u}>{u}</span>
                          <span onClick={() => removeAt(i)} style={{ cursor: "pointer", color: "#dc2626", fontSize: 15, fontWeight: 900, flexShrink: 0, lineHeight: 1 }}>×</span>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })()}
              {/* 💾 대상 저장(설정됐는지 확인용) + 저장 목록 골라쓰기 */}
              <div style={{ display: "flex", gap: 6, marginTop: 6 }}>
                <input style={{ ...mInput, flex: 1 }} value={savingName} onChange={(e) => setSavingName(e.target.value)} placeholder={targetType === "place" ? "이 매장 이름(예: 강남점)" : targetType === "store" ? "이 상품 이름" : "이 블로그 이름"} />
                <button onClick={saveCurrentTarget} style={{ padding: "8px 12px", borderRadius: 8, border: "none", background: `linear-gradient(135deg,${C.accent},${C.cyan})`, color: "#fff", fontSize: 12, fontWeight: 800, cursor: "pointer", fontFamily: "inherit", whiteSpace: "nowrap" }}>💾 저장</button>
              </div>
              {savedTargets.filter((t) => t.type === targetType).length > 0 && (
                <div style={{ display: "flex", flexWrap: "wrap", gap: 5, marginTop: 6 }}>
                  {savedTargets.filter((t) => t.type === targetType).map((t) => (
                    <span key={t.id} style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "4px 8px", borderRadius: 7, border: `1px solid ${C.line2}`, background: C.panel, fontSize: 11, fontWeight: 700 }}>
                      <span onClick={() => pickSavedTarget(t)} style={{ cursor: "pointer", color: C.accent }}>{t.name}</span>
                      <span onClick={() => removeSavedTarget(t.id)} style={{ cursor: "pointer", color: C.sub }}>✕</span>
                    </span>
                  ))}
                </div>
              )}
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 6 }}>
                <div style={{ ...mFl, margin: 0 }}>검색 키워드 (여러 개는 , 로 구분)</div>
                <button onClick={runTargetKeywordSuggest} disabled={kwLoading} title="위에 넣은 대상의 내용을 읽어 딱 맞는 키워드를 추천해요" style={{ marginLeft: "auto", padding: "5px 10px", borderRadius: 8, border: `1.5px solid ${C.accent}`, background: kwLoading ? C.panel2 : C.glow, color: C.accent, fontSize: 11.5, fontWeight: 800, cursor: kwLoading ? "default" : "pointer", fontFamily: "inherit", whiteSpace: "nowrap", display: "inline-flex", alignItems: "center", gap: 5 }}>{kwLoading ? <><span style={{ width: 10, height: 10, border: `2px solid ${C.accent}`, borderTopColor: "transparent", borderRadius: "50%", display: "inline-block", animation: "spin 0.7s linear infinite" }} />읽는 중…</> : "🎯 추천 키워드 받기"}</button>
              </div>
              <input style={mInput} value={keywords} onChange={(e) => setKeywords(e.target.value)} placeholder="예: 횡성시장맛집, 횡성한우" />
              <div style={{ fontSize: 10.5, color: C.sub, fontWeight: 600, marginTop: 4, lineHeight: 1.5 }}>💡 직접 입력하거나, <b style={{ color: C.accent }}>🎯 추천 키워드 받기</b>를 누르면 위 대상 내용에 맞는 키워드를 찾아줘요. <b>대상과 관련된 키워드로 유입해야</b> 네이버가 관련성을 인정해 순위가 올라요(엉뚱한 키워드는 효과 없음).</div>
              {kwSuggest.length > 0 && (
                <div style={{ display: "flex", flexWrap: "wrap", gap: 5, marginTop: 7 }}>
                  {kwSuggest.map((k) => (
                    <button key={k.keyword} onClick={() => addSuggestedKeyword(k.keyword)} style={{ display: "inline-flex", alignItems: "center", gap: 4, padding: "4px 9px", borderRadius: 7, border: `1px solid ${C.accent}`, background: C.panel, color: C.ink, fontSize: 11, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}>
                      <span style={{ color: C.accent, fontWeight: 900 }}>＋</span>{k.keyword}{typeof k.vol === "number" && <span style={{ fontSize: 9.5, color: C.sub, fontWeight: 600 }}>·{k.vol >= 10000 ? (k.vol / 10000).toFixed(1) + "만" : k.vol.toLocaleString()}</span>}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <div style={mCard}>
              <h3 style={mH}><span style={mNum}>2</span> 방문 설정</h3>
              <div style={mFl}>방문 횟수</div>
              <input type="number" min={1} style={mInput} value={rounds} onChange={(e) => setRounds(Math.max(1, Number(e.target.value) || 1))} />
              <div style={mFl}>방문 텀(초) · 기기</div>
              <div style={{ display: "flex", gap: 6 }}>
                <input type="number" min={1} style={{ ...mInput, flex: 1 }} value={termMin} onChange={(e) => setTermMin(Math.max(1, Number(e.target.value) || 1))} />
                <span style={{ alignSelf: "center", color: C.sub }}>~</span>
                <input type="number" min={1} style={{ ...mInput, flex: 1 }} value={termMax} onChange={(e) => setTermMax(Math.max(1, Number(e.target.value) || 1))} />
                <select style={{ ...mInput, flex: 1.2 }} value={device} onChange={(e) => setDevice(e.target.value as any)}>
                  <option value="mobile">📱 모바일</option><option value="pc">🖥️ PC</option><option value="mix">🔀 혼합</option>
                </select>
              </div>
            </div>
            <div style={mCard}>
              <h3 style={mH}><span style={mNum}>3</span> 방문해서 할 행동 <span style={{ marginLeft: 6, fontSize: 10, color: C.sub, fontWeight: 600 }}>(관리자 승인만)</span></h3>
              {anyFree && <><div style={mFl}>🔓 로그인 없이</div><div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>{freeActs.map(Pill)}</div></>}
              {anyLogin && <><div style={mFl}>🔑 로그인 필요</div><div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>{loginActs.map(Pill)}</div></>}
              {!anyFree && !anyLogin && <div style={{ fontSize: 11.5, color: C.sub, fontWeight: 600, marginTop: 6 }}>승인된 행동이 없어요(체류만).</div>}
            </div>
            <div style={mCard}>
              {targetType === "place" ? (<>
                {/* 플레이스만 순위 측정 — 블로그/스토어는 순위 개념이 없어 오류 방지로 제외 */}
                <h3 style={mH}><span style={mNum}>4</span> 현재 순위</h3>
                <div style={mFl}>추적 키워드</div>
                <div style={{ fontSize: 12.5, fontWeight: 700, color: keywords ? C.ink : C.sub }}>{keywords.split(",")[0]?.trim() || "키워드를 입력하세요"}</div>
                <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 8 }}>
                  <div style={{ fontSize: 22, fontWeight: 900, color: C.accent }}>{rankText} <span style={{ fontSize: 11, color: C.sub, fontWeight: 700 }}>현재</span></div>
                  <button onClick={runMeasureRank} disabled={rankLoading} style={{ marginLeft: "auto", padding: "7px 12px", borderRadius: 9, border: `1.5px solid ${C.accent}`, background: rankLoading ? C.panel2 : C.glow, color: C.accent, fontSize: 12, fontWeight: 800, cursor: rankLoading ? "default" : "pointer", fontFamily: "inherit", opacity: rankLoading ? 0.7 : 1, display: "inline-flex", alignItems: "center", gap: 6 }}>{rankLoading ? <><span style={{ width: 11, height: 11, border: `2px solid ${C.accent}`, borderTopColor: "transparent", borderRadius: "50%", display: "inline-block", animation: "spin 0.7s linear infinite" }} />측정 중…</> : "📍 순위 측정"}</button>
                </div>
              </>) : targetType === "store" ? (<>
                {/* 🛒 스토어 순위 확인 — 살아있는 카드 UI */}
                <h3 style={mH}><span style={mNum}>4</span> 쇼핑 순위 확인</h3>
                {/* 결과 히어로 — 확인 전/성공/실패에 따라 색·아이콘이 살아 움직임 */}
                <div style={{
                  borderRadius: 14, padding: "16px 16px 14px", marginBottom: 10,
                  background: storeRankStatus === "in" ? "linear-gradient(135deg,rgba(22,163,74,.14),rgba(22,163,74,.04))" : storeRankStatus === "out" ? "linear-gradient(135deg,rgba(245,158,11,.14),rgba(245,158,11,.04))" : C.panel2,
                  border: `1.5px solid ${storeRankStatus === "in" ? "rgba(22,163,74,.45)" : storeRankStatus === "out" ? "rgba(245,158,11,.45)" : C.line2}`,
                  transition: "all .3s ease",
                }}>
                  <div style={{ fontSize: 11.5, fontWeight: 700, color: C.sub, marginBottom: 4 }}>확인 키워드</div>
                  <div style={{ fontSize: 15, fontWeight: 800, color: keywords ? C.ink : C.sub, marginBottom: 10, wordBreak: "keep-all" }}>{keywords.split(",")[0]?.trim() || "위 검색 키워드를 먼저 넣어주세요"}</div>
                  <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                    <div style={{ fontSize: 26, fontWeight: 900, lineHeight: 1.1, color: storeRankStatus === "in" ? "#16a34a" : storeRankStatus === "out" ? "#d97706" : C.sub }}>
                      {storeRankStatus === "in" ? "🎯" : storeRankStatus === "out" ? "📉" : "🔍"}<span style={{ fontSize: 17, marginLeft: 6 }}>{storeRankText}</span>
                    </div>
                    <button onClick={runStoreRank} disabled={storeRankLoading} style={{ marginLeft: "auto", padding: "10px 16px", borderRadius: 11, border: "none", background: storeRankLoading ? C.line2 : `linear-gradient(135deg,${C.accent},${C.cyan})`, color: "#fff", fontSize: 13.5, fontWeight: 800, cursor: storeRankLoading ? "default" : "pointer", fontFamily: "inherit", boxShadow: storeRankLoading ? "none" : `0 4px 14px ${C.glow}`, display: "inline-flex", alignItems: "center", gap: 6, whiteSpace: "nowrap" }}>{storeRankLoading ? <><span style={{ width: 12, height: 12, border: "2px solid #fff", borderTopColor: "transparent", borderRadius: "50%", display: "inline-block", animation: "spin 0.7s linear infinite" }} />확인 중…</> : "🛒 순위 확인"}</button>
                  </div>
                </div>
                <div style={{ fontSize: 12, color: C.sub, fontWeight: 600, lineHeight: 1.6, marginBottom: 2 }}>
                  키워드를 넣고 눌러보세요. <b style={{ color: C.accent }}>상위(1페이지)에 드는 키워드</b>로 트래픽을 돌려야 효과가 있어요.
                </div>
                {/* 🧭 순위 밖 가이드 — 상품 무관, 단계별 번호 뱃지 카드 */}
                {storeRankStatus === "out" && (() => {
                  const steps = [
                    { n: 1, t: "더 구체적인 키워드로 바꾸기", d: "대표 키워드(2~3글자)는 경쟁이 세서 상위가 어려워요. 종류·용도·지역을 붙여 길게 만들어보세요." },
                    { n: 2, t: "롱테일로 상위 노려보기", d: "길고 구체적인 키워드일수록 경쟁이 약해 상위(1페이지)에 들 확률이 높아요." },
                    { n: 3, t: "상위 드는 키워드에 트래픽", d: "여기서 '상위'로 뜨는 키워드를 찾으면 → 그 키워드로 유입을 돌리세요. 효과가 있어요." },
                    { n: 4, t: "상품이 아예 안 나오면", d: "스마트스토어 상품관리 → 상품명·검색 태그에 그 키워드를 넣으세요. 검색에 걸려야 순위가 생겨요." },
                    { n: 5, t: "결국 실제 구매·리뷰", d: "트래픽은 시작을 돕는 마중물이에요. 실제 판매·리뷰가 쌓여야 대표 키워드로 올라가요." },
                  ];
                  return (
                    <div style={{ marginTop: 10, padding: 14, borderRadius: 14, background: C.panel2, border: `1.5px solid ${C.line2}` }}>
                      <div style={{ fontSize: 14.5, fontWeight: 900, color: "#d97706", marginBottom: 12, display: "flex", alignItems: "center", gap: 7 }}><span>🧭</span> 상위 밖이에요 — 이렇게 올려요</div>
                      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                        {steps.map(s => (
                          <div key={s.n} style={{ display: "flex", gap: 11, alignItems: "flex-start" }}>
                            <div style={{ flexShrink: 0, width: 26, height: 26, borderRadius: "50%", background: `linear-gradient(135deg,${C.accent},${C.cyan})`, color: "#fff", fontSize: 13, fontWeight: 900, display: "flex", alignItems: "center", justifyContent: "center", boxShadow: `0 2px 8px ${C.glow}` }}>{s.n}</div>
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div style={{ fontSize: 14, fontWeight: 800, color: C.ink, lineHeight: 1.4 }}>{s.t}</div>
                              <div style={{ fontSize: 12.5, fontWeight: 600, color: C.sub, lineHeight: 1.6, marginTop: 2 }}>{s.d}</div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })()}
                {storeRankStatus === "in" && (
                  <div style={{ marginTop: 10, padding: 16, borderRadius: 14, background: "linear-gradient(135deg,rgba(22,163,74,.12),rgba(22,163,74,.03))", border: "1.5px solid rgba(22,163,74,.4)" }}>
                    <div style={{ fontSize: 15, fontWeight: 900, color: "#15803d", marginBottom: 7, display: "flex", alignItems: "center", gap: 7 }}><span style={{ fontSize: 20 }}>🎉</span> 상위에 들었어요 — 트래픽 돌릴 키워드!</div>
                    <div style={{ fontSize: 13.5, fontWeight: 700, color: C.ink, lineHeight: 1.8 }}>
                      이 키워드로 <b style={{ color: "#16a34a" }}>유입을 돌리면 효과</b>가 있어요.<br/>여러 키워드를 확인해 <b>상위에 드는 것들만 모아</b> 돌리면 더 좋아요.
                    </div>
                  </div>
                )}
              </>) : (<>
                <h3 style={mH}><span style={mNum}>4</span> 안내</h3>
                <div style={{ fontSize: 12, color: C.sub, fontWeight: 600, lineHeight: 1.6, marginTop: 4 }}>
                  블로그는 순위 측정을 쓰지 않아요. 키워드 검색 유입으로 조회수·체류·공감·이웃을 쌓아요.
                </div>
              </>)}
            </div>
          </div>

          {/* 유입 시작 / 정지 */}
          {!running ? (
            <button onClick={start} style={{ width: "100%", padding: 15, borderRadius: 12, border: "none", background: `linear-gradient(135deg,${C.accent},${C.cyan})`, color: "#fff", fontSize: 16, fontWeight: 900, cursor: "pointer", fontFamily: "inherit", boxShadow: "0 8px 20px rgba(109,40,217,.3)" }}>🚀 유입 시작</button>
          ) : (
            <button onClick={stop} style={{ width: "100%", padding: 15, borderRadius: 12, border: `2px solid ${C.accent}`, background: C.panel2, color: C.accent, fontSize: 16, fontWeight: 900, cursor: "pointer", fontFamily: "inherit" }}>⏹ 그만두기 ({progress}%)</button>
          )}
          {/* 📊 오늘/누적 유입 수치 — 무제한 회원도 보이게(회원이 헷갈리지 않게 큰 숫자로) */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginTop: 10 }}>
            <div style={{ ...mCard, textAlign: "center", padding: "12px 10px" }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: C.sub }}>오늘 유입 <span style={{ color: C.sub }}>({targetType === "place" ? "플레이스" : targetType === "blog" ? "블로그" : "스토어"})</span></div>
              <div style={{ fontSize: 24, fontWeight: 900, color: C.accent, marginTop: 2 }}>{todayScoped}<span style={{ fontSize: 12, fontWeight: 700, color: C.sub }}>회{!unlimited && limit ? ` / ${limit}` : ""}</span></div>
              <div style={{ fontSize: 10, fontWeight: 700, color: C.sub }}>{unlimited ? "무제한" : gradeLabel || ""}</div>
            </div>
            <div style={{ ...mCard, textAlign: "center", padding: "12px 10px" }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: C.sub }}>{chartDays >= 365 ? "전체 누적" : `최근 ${chartDays}일`}</div>
              <div style={{ fontSize: 24, fontWeight: 900, color: C.ink, marginTop: 2 }}>{weekTotal}<span style={{ fontSize: 12, fontWeight: 700, color: C.sub }}>회</span></div>
              <div style={{ fontSize: 10, fontWeight: 700, color: C.sub }}>누적 방문</div>
            </div>
          </div>

          {/* 🎫 등급별 사용 한도표 — 베이직/프로/프리미엄(무제한은 관리자 고유라 제외). 내 등급 강조 */}
          <div style={{ marginTop: 14, ...mCard }}>
            <div style={{ fontSize: 12.5, fontWeight: 800, marginBottom: 8 }}>🎫 등급별 하루 유입 한도 <span style={{ fontSize: 11, color: C.sub, fontWeight: 600 }}>· {targetType === "place" ? "플레이스" : targetType === "blog" ? "블로그" : "스마트스토어"} 기준</span></div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
              {([["basic", "베이직", 30], ["pro", "프로", 60], ["premium", "프리미엄", 120]] as [string, string, number][]).map(([k, lb, n]) => {
                const mine = featLic?.plan === k;
                return (
                  <div key={k} style={{ padding: "12px 10px", borderRadius: 10, textAlign: "center", border: `2px solid ${mine ? C.accent : C.line2}`, background: mine ? C.glow : C.panel }}>
                    <div style={{ fontSize: 12, fontWeight: 800, color: mine ? C.accent : C.sub }}>{lb}{mine ? " ✓" : ""}</div>
                    <div style={{ fontSize: 20, fontWeight: 900, color: mine ? C.accent : C.ink, marginTop: 3 }}>{n}<span style={{ fontSize: 11, fontWeight: 700, color: C.sub }}>회</span></div>
                  </div>
                );
              })}
            </div>
            {/* 결제·사용 문의 안내 박스 — 버튼만 있으면 뭔지 모르니 설명을 눈에 띄게 */}
            <div style={{ marginTop: 10, padding: "11px 13px", borderRadius: 11, background: C.glow, border: `1.5px solid ${C.accent}` }}>
              <div style={{ fontSize: 12.5, fontWeight: 800, color: C.accent, marginBottom: 3 }}>💳 결제 · 사용 문의</div>
              <div style={{ fontSize: 11.5, color: C.sub, fontWeight: 600, lineHeight: 1.55 }}>이 프로그램은 <b style={{ color: C.ink }}>무료 없이 대여 기간</b> 동안만 쓸 수 있어요. <b style={{ color: C.ink }}>처음 사용·기간 연장·등급 업그레이드·한도 상향</b>이 필요하면 아래로 문의하세요. 관리자가 확인 후 열어드려요.</div>
              <button onClick={() => { try { window.open("https://open.kakao.com/o/s5wAJ1Li", "_blank"); } catch {} }} style={{ width: "100%", marginTop: 9, padding: "12px", borderRadius: 10, border: "none", background: `linear-gradient(135deg,${C.accent},${C.cyan})`, color: "#fff", fontSize: 13.5, fontWeight: 900, cursor: "pointer", fontFamily: "inherit" }}>💬 카카오톡으로 결제·사용 문의하기</button>
            </div>
          </div>

          {/* 기록 그래프 + 기간 설정 (주단위·기간별 과거 데이터) */}
          <div style={{ marginTop: 16, ...mCard }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 8, marginBottom: 10 }}>
              <span style={{ fontSize: 13, fontWeight: 800 }}>📈 유입 기록</span>
              <div style={{ display: "flex", gap: 6 }}>
                {[[7, "7일"], [30, "30일"], [90, "90일"], [365, "전체"]].map(([d, lb]) => (
                  <button key={d as number} onClick={() => setChartDays(d as number)} style={{ padding: "5px 11px", borderRadius: 8, border: `1.5px solid ${chartDays === d ? C.accent : C.line2}`, background: chartDays === d ? C.glow : C.panel, color: chartDays === d ? C.accent : C.sub, fontSize: 12, fontWeight: 800, cursor: "pointer", fontFamily: "inherit" }}>{chartDays === d ? "✓ " : ""}{lb as string}</button>
                ))}
              </div>
            </div>
            <div style={{ fontSize: 11, fontWeight: 700, color: C.sub, marginBottom: 4 }}>{chartDays >= 365 ? "전체" : `최근 ${chartDays}일`} 유입 추이 · 총 {weekTotal}회</div>
            {history.length > 0 ? <AreaChart data={history} C={C} /> : <div style={{ height: 120, display: "flex", alignItems: "center", justifyContent: "center", color: C.sub, fontSize: 12.5, fontWeight: 600 }}>데이터가 쌓이면 그래프가 그려져요</div>}
            {targetType !== "store" && <>
              <div style={{ fontSize: 11, fontWeight: 700, color: C.sub, margin: "12px 0 4px" }}>순위 변동(위=상위)</div>
              <RankChart data={rankHist} goal={apGoal} C={C} />
            </>}
          </div>

          {/* 실시간 로그 */}
          <div style={{ marginTop: 16 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
              <span style={{ fontSize: 13, fontWeight: 800 }}>📜 실시간 로그</span>
              <div style={{ display: "flex", gap: 6 }}>
                {/* 🪟 창 보기 토글 — 기존 유입 로직 무관(visible만 토글). 켜면 다음 실행부터 봇의 실제 크롬 창이 뜸. */}
                <button onClick={() => setVisible(v => !v)} title="봇이 실제로 움직이는 크롬 창을 띄워 눈으로 봅니다" style={{ padding: "6px 12px", borderRadius: 8, border: `1.5px solid ${visible ? C.accent : C.line2}`, background: visible ? C.accent : C.panel, color: visible ? "#fff" : C.sub, fontSize: 12, fontWeight: 800, cursor: "pointer", fontFamily: "inherit" }}>🪟 창 보기 {visible ? "ON" : "OFF"}</button>
                <button onClick={() => setLogZoom(true)} disabled={!logs.length} style={{ padding: "6px 12px", borderRadius: 8, border: `1.5px solid ${C.line2}`, background: C.panel, color: logs.length ? C.accent : C.sub, fontSize: 12, fontWeight: 800, cursor: logs.length ? "pointer" : "default", fontFamily: "inherit" }}>🔍 크게 보기</button>
                <button onClick={copyLogs} disabled={!logs.length} style={{ padding: "6px 12px", borderRadius: 8, border: `1.5px solid ${C.line2}`, background: C.panel, color: logs.length ? C.accent : C.sub, fontSize: 12, fontWeight: 800, cursor: logs.length ? "pointer" : "default", fontFamily: "inherit" }}>📋 복사</button>
                <button onClick={sendLogToAdmin} disabled={!logs.length || sendingLog} style={{ padding: "6px 12px", borderRadius: 8, border: "none", background: logs.length ? `linear-gradient(135deg,${C.accent},${C.cyan})` : C.line2, color: "#fff", fontSize: 12, fontWeight: 800, cursor: logs.length && !sendingLog ? "pointer" : "default", fontFamily: "inherit" }}>{sendingLog ? "보내는 중…" : "📨 관리자에게 보내기"}</button>
              </div>
            </div>
            {/* 🪟 창 보기 설명 — 무엇인지 한눈에(어르신 배려). 켜짐/꺼짐에 따라 안내 톤 변경. */}
            <div style={{ fontSize: 11.5, color: C.sub, fontWeight: 600, marginBottom: 8, lineHeight: 1.65, padding: "9px 12px", borderRadius: 9, background: visible ? C.glow : C.panel, border: `1px solid ${visible ? C.accent : C.line2}` }}>
              🪟 <b style={{ color: C.accent }}>창 보기</b> — 켜면 봇이 <b>실제 크롬 창</b>을 띄워서 <b>검색 → 클릭 → 체류 → 액션</b>하는 움직임을 두 눈으로 직접 봐요. 평소엔 창 없이 조용히(백그라운드) 돌아가고, <b>버튼을 켠 뒤 다음 실행부터</b> 창이 떠요. 확인·테스트용이라 창을 닫아도 유입은 계속되고, 안전상 앱을 껐다 켜면 자동으로 꺼져요. {visible ? <b style={{ color: C.accent }}>지금 ON — 다음 시작부터 창이 떠요.</b> : "지금 OFF — 창 없이 백그라운드로 돌아가요."}
            </div>
            <div ref={logBoxRef} style={{ background: C.logBg, color: C.logInk, borderRadius: 12, padding: "14px 16px", height: 240, overflowY: "auto", fontSize: 13.5, lineHeight: 1.75, fontFamily: "'SF Mono','D2Coding',ui-monospace,monospace", whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
              {logs.length ? logs.map((entry, i) => entry.type === "text"
                ? <div key={i}>{entry.text}</div>
                : <div key={i} style={{ margin: "8px 0 12px" }}><div style={{ marginBottom: 5, fontWeight: 800 }}>📸 {entry.caption}</div><img src={entry.dataUrl} alt={entry.caption} style={{ display: "block", width: "min(280px,100%)", maxHeight: 190, objectFit: "contain", borderRadius: 9, border: "1px solid rgba(255,255,255,.18)" }} /></div>
              ) : <div style={{ opacity: 0.5 }}>키워드 검색 → 진입 → 체류 → 액션 전 과정이 여기 실시간으로 표시돼요.</div>}
            </div>
          </div>
          </div>{/* 유입 본체(!blTab) 닫음 */}
        </>)}

        {postPopupUI}

        {/* 🔍 로그 크게 보기 모달 */}
        {logZoom && (
          <div onClick={(e) => { if (e.target === e.currentTarget) setLogZoom(false); }} style={{ position: "fixed", inset: 0, zIndex: 1000, background: "rgba(10,7,19,.78)", display: "flex", alignItems: "center", justifyContent: "center", padding: 30 }}>
            <div style={{ width: "100%", maxWidth: 1000, height: "86vh", background: C.logBg, borderRadius: 16, display: "flex", flexDirection: "column", overflow: "hidden", boxShadow: "0 30px 80px rgba(0,0,0,.5)" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "14px 18px", borderBottom: `1px solid ${C.line2}` }}>
                <b style={{ color: C.logInk, fontSize: 15 }}>📜 실시간 로그 — 크게 보기</b>
                <div style={{ display: "flex", gap: 8 }}>
                  <button onClick={copyLogs} disabled={!logs.length} style={{ padding: "7px 16px", borderRadius: 9, border: "none", background: C.panel, color: C.accent, fontWeight: 800, cursor: "pointer", fontFamily: "inherit" }}>📋 복사</button>
                  <button onClick={() => setLogZoom(false)} style={{ padding: "7px 16px", borderRadius: 9, border: "none", background: C.accent, color: "#fff", fontWeight: 800, cursor: "pointer", fontFamily: "inherit" }}>닫기</button>
                </div>
              </div>
              <div style={{ flex: 1, overflowY: "auto", padding: "18px 22px", color: C.logInk, fontFamily: "'SF Mono','D2Coding',ui-monospace,monospace", fontSize: 15, lineHeight: 1.85, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
                {logs.length ? logs.map((entry, i) => entry.type === "text" ? <div key={i}>{entry.text}</div> : <div key={i} style={{ margin: "8px 0 12px" }}><div style={{ marginBottom: 5, fontWeight: 800 }}>📸 {entry.caption}</div><img src={entry.dataUrl} alt={entry.caption} style={{ display: "block", width: "min(420px,100%)", maxHeight: 280, objectFit: "contain", borderRadius: 9 }} /></div>) : <div style={{ opacity: 0.5 }}>아직 로그가 없어요.</div>}
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="inflow-center" style={{ fontFamily: "'Pretendard','Apple SD Gothic Neo',sans-serif", color: C.ink, display: "flex", flexDirection: "column" }}>
      <style>{`
        @keyframes inflowResultIn { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: translateY(0); } }
        .inflow-card { transition: transform .18s ease, box-shadow .18s ease, border-color .18s ease; }
        .inflow-card:hover { transform: translateY(-2px); box-shadow: 0 10px 24px rgba(15,23,42,.10); }
        .inflow-result { animation: inflowResultIn .32s ease-out both; }
        @media (prefers-reduced-motion: reduce) { .inflow-card, .inflow-result { transition: none; animation: none; } }
      `}</style>

      {/* ═══ 💾 데이터(프록시) 사용 설명 팝업 ═══ */}
      {dataSaverInfo && (
        <div onClick={() => setDataSaverInfo(false)} style={{ position: "fixed", inset: 0, zIndex: 10000, background: "rgba(0,0,0,.6)", display: "flex", alignItems: "center", justifyContent: "center", padding: 18 }}>
          <div onClick={(e) => e.stopPropagation()} style={{ width: "100%", maxWidth: 500, maxHeight: "88vh", overflowY: "auto", background: C.panel, borderRadius: 18, border: `2px solid ${C.accent}`, boxShadow: "0 24px 60px rgba(0,0,0,.45)" }}>
            <div style={{ padding: "16px 18px", background: `linear-gradient(135deg,${C.accent},${C.cyan})`, color: "#fff" }}>
              <div style={{ fontSize: 16, fontWeight: 900 }}>💾 데이터(프록시)는 이렇게 써요</div>
              <div style={{ fontSize: 12, fontWeight: 600, opacity: .92, marginTop: 2 }}>프록시는 GB(데이터)를 쓸수록 비용이 나가요. 3가지 모드로 아낄 수 있어요.</div>
            </div>
            <div style={{ padding: 18, fontSize: 13, lineHeight: 1.7, color: C.ink }}>
              <div style={{ background: C.panel2, border: `1px solid ${C.line}`, borderRadius: 10, padding: "10px 13px", marginBottom: 12, fontWeight: 600, color: C.sub }}>
                방문 1번마다 네이버 페이지를 <b style={{ color: C.ink }}>프록시(다른 IP)</b>로 열어요. 이때 사진·영상·광고까지 다 받으면 <b style={{ color: C.ink }}>데이터(GB)</b>를 많이 써요. 안 받아도 <b style={{ color: "#16a34a" }}>클릭·체류·저장·순위 신호는 그대로</b> 작동해요(버튼은 글자·구조로 있으니까요).
              </div>
              {[
                { t: "🟢 일반", d: "사진·영상·광고 다 받음. 진짜 사람과 가장 똑같아 제일 자연스러워요.", g: "방문당 약 5MB · 50GB로 약 1만 방문", c: C.ink },
                { t: "💾 절약 (추천)", d: "영상·광고·폰트만 차단. 사진은 그대로 받아서 자연스러움 유지. 순위 신호 100%.", g: "방문당 약 2.5MB · 50GB로 약 2만 방문 (데이터 반절↓)", c: C.accent },
                { t: "🔋 초절약", d: "사진까지 차단. 데이터 최대 절약. 기능은 100% 정상이나, 이미지를 안 받는 게 아주 미세하게 덜 자연스러울 수 있어요(실사용엔 거의 영향 없음).", g: "방문당 약 0.5~1MB · 50GB로 약 5만~10만 방문 (데이터 1/10)", c: "#d97706" },
              ].map((m) => (
                <div key={m.t} style={{ marginBottom: 12, padding: "11px 13px", borderRadius: 12, border: `1.5px solid ${m.c === C.ink ? C.line2 : m.c}`, background: C.panel2 }}>
                  <div style={{ fontSize: 14, fontWeight: 900, color: m.c === C.ink ? C.ink : m.c }}>{m.t}</div>
                  <div style={{ fontSize: 12.5, fontWeight: 600, color: C.sub, marginTop: 3 }}>{m.d}</div>
                  {unlimited && <div style={{ fontSize: 12, fontWeight: 800, color: m.c === C.ink ? C.sub : m.c, marginTop: 5 }}>📊 {m.g}</div>}
                </div>
              ))}
              <div style={{ fontSize: 12, fontWeight: 700, color: C.sub, lineHeight: 1.6, background: "rgba(16,133,107,.06)", border: "1px solid #16a34a", borderRadius: 10, padding: "10px 13px" }}>
                🔒 <b style={{ color: "#16a34a" }}>어느 모드든 기능은 안전해요.</b> 저장·찜·길찾기·체류 같은 순위 신호는 다 유지돼요. CSS·화면 구조는 절대 막지 않아서 버튼을 못 찾는 일도 없어요.
              </div>
              <button onClick={() => setDataSaverInfo(false)} style={{ width: "100%", marginTop: 14, padding: "12px", borderRadius: 11, border: "none", background: `linear-gradient(135deg,${C.accent},${C.cyan})`, color: "#fff", fontSize: 14, fontWeight: 900, cursor: "pointer", fontFamily: "inherit" }}>이해했어요 · 닫기</button>
            </div>
          </div>
        </div>
      )}

      {postPopupUI}
      {/* ═══ 📝 (구) 팝업 A — 공통 변수 postPopupUI로 이동됨(관리자·회원 공용). 아래는 미사용 ═══ */}
      {false && postPopup === "manual" && (
        <div onClick={() => setPostPopup(null)} style={{ position: "fixed", inset: 0, zIndex: 10000, background: "rgba(0,0,0,.6)", display: "flex", alignItems: "center", justifyContent: "center", padding: 18 }}>
          <div onClick={(e) => e.stopPropagation()} style={{ width: "100%", maxWidth: 460, background: C.panel, borderRadius: 18, border: `2px solid ${C.accent}`, overflow: "hidden", boxShadow: "0 24px 60px rgba(0,0,0,.45)" }}>
            <div style={{ padding: "16px 18px", background: `linear-gradient(135deg,${C.accent},${C.cyan})`, color: "#fff" }}>
              <div style={{ fontSize: 16, fontWeight: 900 }}>📝 글 주소 직접 넣기</div>
              <div style={{ fontSize: 12, fontWeight: 600, opacity: .92, marginTop: 2 }}>로그인 없이 · 원하는 글 링크를 넣어 그 글에 트래픽을 걸어요</div>
            </div>
            <div style={{ padding: 18 }}>
              <div style={{ fontSize: 12.5, fontWeight: 700, color: C.ink, lineHeight: 1.6, marginBottom: 9, background: "rgba(16,133,107,.08)", border: "1.5px solid #16a34a", borderRadius: 10, padding: "9px 12px" }}>
                <b style={{ color: "#16a34a" }}>✅ 로그인 필요 없어요.</b> 글 주소만 있으면 방문·체류·읽기·공유가 돼요. <b>한 줄에 하나씩</b> 여러 개 넣으면 방문마다 번갈아 방문해요(로테이션).
              </div>
              <textarea value={manualPostUrls} onChange={(e) => setManualPostUrls(e.target.value)} rows={5}
                placeholder={"blog.naver.com/아이디/글번호\nblog.naver.com/아이디/글번호2\n... (한 줄에 하나씩)"}
                style={{ ...inputStyle, resize: "vertical", fontSize: 13, lineHeight: 1.6 }} />
              <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
                <button onClick={() => setPostPopup(null)} style={{ flex: 1, padding: "12px", borderRadius: 11, border: `1.5px solid ${C.line2}`, background: C.panel2, color: C.sub, fontSize: 13.5, fontWeight: 800, cursor: "pointer", fontFamily: "inherit" }}>취소</button>
                <button onClick={() => { const urls = manualPostUrls.split(/[\n,]/).map((s) => s.trim()).filter((s) => parseBlogUrl(s)); if (!urls.length) { toast("올바른 블로그 글 주소를 넣어주세요", "error"); return; } applyPostsAsTargets(urls); }} style={{ flex: 2, padding: "12px", borderRadius: 11, border: "none", background: `linear-gradient(135deg,${C.accent},${C.cyan})`, color: "#fff", fontSize: 13.5, fontWeight: 900, cursor: "pointer", fontFamily: "inherit" }}>🎯 이 글들을 유입 대상으로</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ═══ 🔐 (구) 팝업 B — 공통 변수 postPopupUI로 이동됨. 아래는 미사용 ═══ */}
      {false && postPopup === "login" && (
        <div onClick={() => setPostPopup(null)} style={{ position: "fixed", inset: 0, zIndex: 10000, background: "rgba(0,0,0,.6)", display: "flex", alignItems: "center", justifyContent: "center", padding: 18 }}>
          <div onClick={(e) => e.stopPropagation()} style={{ width: "100%", maxWidth: 480, maxHeight: "88vh", overflowY: "auto", background: C.panel, borderRadius: 18, border: "2px solid #d97706", boxShadow: "0 24px 60px rgba(0,0,0,.45)" }}>
            <div style={{ padding: "16px 18px", background: "linear-gradient(135deg,#f59e0b,#d97706)", color: "#fff" }}>
              <div style={{ fontSize: 16, fontWeight: 900 }}>🔐 로그인해서 내 글 불러오기</div>
              <div style={{ fontSize: 12, fontWeight: 600, opacity: .92, marginTop: 2 }}>연결한 계정으로 내 글 목록을 불러와 골라서 트래픽을 걸어요</div>
            </div>
            <div style={{ padding: 18 }}>
              <div style={{ fontSize: 12.5, fontWeight: 700, color: C.ink, lineHeight: 1.7, marginBottom: 11, background: "rgba(245,158,11,.10)", border: "1.5px solid #d97706", borderRadius: 10, padding: "10px 13px" }}>
                <b style={{ color: "#d97706" }}>🔑 로그인이 필요해요.</b> 내 글 목록은 로그인해야 볼 수 있어요.<br />
                <b>① 왼쪽 메뉴 맨 아래 ‘계정 관리’ 탭</b>으로 가서<br />
                <b>② 네이버 아이디·비밀번호로 계정을 연결(로그인)</b>한 뒤<br />
                <b>③ 다시 여기 와서 그 계정을 선택</b>하면 목록이 나와요. <span style={{ color: C.sub }}>(한 번 연결하면 다음부턴 비번 없이 바로)</span>
              </div>
              {/* 계정 선택 */}
              <div style={{ fontSize: 12, fontWeight: 800, color: C.sub, marginBottom: 6 }}>불러올 계정 (계정 관리에서 연결한 계정)</div>
              {accounts.length === 0 ? (
                <div style={{ fontSize: 12.5, fontWeight: 700, color: "#dc2626", padding: "11px 13px", borderRadius: 10, background: "rgba(220,38,38,.06)", border: "1px solid rgba(220,38,38,.3)", lineHeight: 1.6 }}>⚠️ 아직 연결된 네이버 계정이 없어요.<br /><b>왼쪽 메뉴 ‘계정 관리’ 탭 → 네이버 아이디·비밀번호로 연결</b>한 뒤 다시 오세요.</div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  {accounts.map((a) => { const on = popupAccountId === a.id; return (
                    <button key={a.id} onClick={() => setPopupAccountId(a.id)} style={{ display: "flex", alignItems: "center", gap: 9, padding: "10px 12px", borderRadius: 10, background: on ? C.glow : C.panel2, border: `1.5px solid ${on ? C.accent : C.line}`, cursor: "pointer", fontFamily: "inherit", textAlign: "left" }}>
                      <span style={{ width: 9, height: 9, borderRadius: "50%", background: on ? C.accent : C.line2, flexShrink: 0 }} />
                      <span style={{ fontSize: 13.5, fontWeight: 800, color: on ? C.accent : C.ink }}>{on ? "✓ " : ""}{a.username}</span>
                      {a.blog_name && <span style={{ fontSize: 11, color: C.sub, fontWeight: 600 }}>· {a.blog_name}</span>}
                    </button>
                  ); })}
                </div>
              )}
              {/* 📅 기간 필터 — 전체 / 최근 N일 / 날짜 지정 */}
              <div style={{ marginTop: 12, padding: "11px 13px", borderRadius: 11, background: C.panel2, border: `1px solid ${C.line}` }}>
                <div style={{ fontSize: 12, fontWeight: 800, color: C.sub, marginBottom: 7 }}>📅 어느 기간 글을 불러올까요</div>
                <div style={{ display: "flex", gap: 6, marginBottom: postDateMode === "all" ? 0 : 9 }}>
                  {([["all", "전체"], ["recent", "최근 N일"], ["range", "날짜 지정"]] as const).map(([k, lb]) => (
                    <button key={k} onClick={() => setPostDateMode(k)} style={{ flex: 1, padding: "8px 6px", borderRadius: 9, border: `1.5px solid ${postDateMode === k ? C.accent : C.line2}`, background: postDateMode === k ? C.glow : C.panel, color: postDateMode === k ? C.accent : C.sub, fontSize: 12.5, fontWeight: 800, cursor: "pointer", fontFamily: "inherit" }}>{postDateMode === k ? "✓ " : ""}{lb}</button>
                  ))}
                </div>
                {postDateMode === "recent" && (
                  <div style={{ display: "flex", gap: 6 }}>
                    {[7, 30, 90, 180].map((d) => (
                      <button key={d} onClick={() => setPostRecentDays(d)} style={{ flex: 1, padding: "7px 4px", borderRadius: 8, border: `1.5px solid ${postRecentDays === d ? C.accent : C.line2}`, background: postRecentDays === d ? C.glow : C.panel, color: postRecentDays === d ? C.accent : C.sub, fontSize: 12, fontWeight: 800, cursor: "pointer", fontFamily: "inherit" }}>{d}일</button>
                    ))}
                  </div>
                )}
                {postDateMode === "range" && (
                  <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
                    <input type="date" value={postFrom} max={postTo || undefined} onChange={(e) => setPostFrom(e.target.value)} style={{ ...inputStyle, flex: 1, padding: "8px 10px", fontSize: 12.5 }} />
                    <span style={{ fontSize: 12, fontWeight: 800, color: C.sub }}>~</span>
                    <input type="date" value={postTo} min={postFrom || undefined} onChange={(e) => setPostTo(e.target.value)} style={{ ...inputStyle, flex: 1, padding: "8px 10px", fontSize: 12.5 }} />
                  </div>
                )}
              </div>

              <button onClick={() => collectMyPosts(popupAccountId)} disabled={!popupAccountId || myPostsLoading} style={{ width: "100%", marginTop: 11, padding: "12px", borderRadius: 11, border: "none", background: (popupAccountId && !myPostsLoading) ? "linear-gradient(135deg,#f59e0b,#d97706)" : C.line2, color: "#fff", fontSize: 13.5, fontWeight: 900, cursor: (popupAccountId && !myPostsLoading) ? "pointer" : "default", fontFamily: "inherit" }}>{myPostsLoading ? "불러오는 중…" : "📚 내 글 불러오기"}</button>

              {myPosts.length > 0 && (<div style={{ marginTop: 14, paddingTop: 12, borderTop: `1px solid ${C.line}` }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 8 }}>
                  <button onClick={selectAllPosts} style={{ padding: "6px 12px", borderRadius: 8, border: `1.5px solid ${C.accent}`, background: C.glow, color: C.accent, fontSize: 12, fontWeight: 800, cursor: "pointer", fontFamily: "inherit" }}>✅ 전체 선택</button>
                  <button onClick={clearSelectedPosts} style={{ padding: "6px 12px", borderRadius: 8, border: `1.5px solid ${C.line2}`, background: C.panel2, color: C.sub, fontSize: 12, fontWeight: 800, cursor: "pointer", fontFamily: "inherit" }}>◻️ 전체 해제</button>
                  <span style={{ fontSize: 12, fontWeight: 800, color: C.ink }}>선택 {selectedPosts.size}/{myPosts.length}개</span>
                </div>
                <div style={{ maxHeight: 240, overflowY: "auto", display: "flex", flexDirection: "column", gap: 5 }}>
                  {myPosts.map((p) => { const on = selectedPosts.has(p.url); return (
                    <label key={p.url} style={{ display: "flex", alignItems: "center", gap: 9, padding: "8px 10px", borderRadius: 9, background: on ? C.glow : C.panel2, border: `1px solid ${on ? C.accent : C.line}`, cursor: "pointer" }}>
                      <input type="checkbox" checked={on} onChange={() => togglePost(p.url)} style={{ width: 16, height: 16, accentColor: C.accent, flexShrink: 0 }} />
                      <div style={{ minWidth: 0, flex: 1 }}>
                        <div style={{ fontSize: 13, fontWeight: 700, color: C.ink, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{p.title || "(제목 없음)"}</div>
                        {p.date && <div style={{ fontSize: 10.5, color: C.sub, fontWeight: 600 }}>{p.date}</div>}
                      </div>
                    </label>
                  ); })}
                </div>
                <button onClick={applySelectedPostsAsTargets} disabled={!selectedPosts.size} style={{ width: "100%", marginTop: 10, padding: "12px", borderRadius: 11, border: "none", background: selectedPosts.size ? `linear-gradient(135deg,${C.accent},${C.cyan})` : C.line2, color: "#fff", fontSize: 13.5, fontWeight: 900, cursor: selectedPosts.size ? "pointer" : "default", fontFamily: "inherit" }}>🎯 선택한 {selectedPosts.size}개 글을 유입 대상으로</button>
              </div>)}
              <button onClick={() => setPostPopup(null)} style={{ width: "100%", marginTop: 8, padding: "10px", borderRadius: 11, border: `1.5px solid ${C.line2}`, background: C.panel2, color: C.sub, fontSize: 13, fontWeight: 800, cursor: "pointer", fontFamily: "inherit" }}>닫기</button>
            </div>
          </div>
        </div>
      )}

      {/* ── 헤더 ── */}
      <div style={{ order: -2, display: "flex", alignItems: "center", gap: 12, marginBottom: 4, flexWrap: "wrap" }}>
        <span style={{ background: `linear-gradient(135deg,${C.accent},${C.cyan})`, color: "#fff", fontSize: 12, fontWeight: 900, padding: "5px 10px", borderRadius: 8, letterSpacing: 0.5 }}>NEW</span>
        <h2 style={{ margin: 0, fontSize: 24, fontWeight: 900 }}>트래픽 유입</h2>
        <span style={{ fontSize: 11, fontWeight: 800, letterSpacing: 2, color: C.sub, border: `1px solid ${C.line2}`, padding: "3px 9px", borderRadius: 6 }}>CONTROL TOWER</span>
        <span style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 6, fontSize: 12.5, fontWeight: 800, color: running ? "#16a34a" : C.sub }}>
          <span style={{ width: 8, height: 8, borderRadius: "50%", background: running ? "#22c55e" : C.sub, boxShadow: running ? "0 0 8px #22c55e" : "none" }} />{running ? "가동 중" : "대기"}
        </span>
      </div>
      <p style={{ order: -1, margin: "0 0 16px", fontSize: 13.5, color: C.sub, fontWeight: 600, lineHeight: 1.6 }}>
        설정한 유입을 실행하고 자동 측정된 <b style={{color:C.accent}}>순위·방문 추이</b>로 변화를 확인해요.
      </p>

      {/* 🌱 새싹 비서 — 오늘의 브리핑 */}
      <div style={{ order: 1, display: "flex", alignItems: "center", gap: 14, background: `linear-gradient(135deg,${C.glow},transparent)`, border: `1.5px solid ${C.accent}`, borderRadius: 16, padding: "14px 18px", marginBottom: 16 }}>
        <div style={{ width: 46, height: 46, borderRadius: 14, background: C.panel, border: `1px solid ${C.line}`, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, color: "#16a34a" }}>
          <SproutAssistant size={30} />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 12, fontWeight: 800, color: "#16a34a", marginBottom: 2 }}>새싹 비서 · 오늘의 브리핑</div>
          <div style={{ fontSize: 14, fontWeight: 700, color: C.ink, lineHeight: 1.5 }}>{sproutAdvice.msg}</div>
        </div>
      </div>

      {/* 👣 사용방법 안내 */}
      <div style={{ order: 2 }}><UsageGuide theme={theme} accent={C.accent}
        subtitle="펄리예요! 키워드로 검색해 내 플레이스·블로그·스마트스토어로 진짜 손님처럼 유입시키고, 순위가 오르려면 뭘 채워야 하는지 진단까지 해드려요."
        steps={[
          { ico: "📍", title: "대상·키워드 넣기", desc: "내 플레이스(지도/naver.me)·블로그 글·스마트스토어 상품 주소를 붙여넣고, 검색 키워드를 여러 개 적어요(자동으로 인식돼요)." },
          { ico: "🎛️", title: "옵션 고르기", desc: "방문 횟수·텀·기기(모바일/PC)·할 행동(저장·길찾기·전화 등)을 정해요. 시간분산·액션확률로 더 자연스럽게." },
          { ico: "🚀", title: "유입 시작", desc: "‘유입 시작’을 누르면 방문마다 IP를 바꿔 안전 한도 안에서 돌아요. 진짜 손님처럼 검색결과를 먼저 비교하고, 완급을 두어 읽고(관심 구간 정독·위로 재확인) 자연스럽게 행동해요. 라이브 로그로 전 과정을 볼 수 있어요." },
          { ico: "🩺", title: "성과·진단 확인", desc: "성과 리포트(주간/월간)로 순위·유입 변화를 보고, ‘플레이스 진단’으로 부족한 곳을 찾아 채우면 순위가 더 잘 올라요." },
        ]} /></div>

      {notifications.length > 0 && (
        <div className="inflow-card inflow-result" style={{ order: 3, background: C.panel, border: "1.5px solid #0ea5e9", borderRadius: 16, padding: "13px 16px", marginBottom: 14 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
            <span style={{ fontSize: 14, fontWeight: 900 }}>🔔 자동 알림함</span>
            <span style={{ fontSize: 11, color: C.sub }}>{notifications.length}개</span>
            <button onClick={() => { setNotifications([]); try { localStorage.setItem(notificationKey, "[]"); } catch {} }} style={{ marginLeft: "auto", border: 0, background: "transparent", color: C.sub, cursor: "pointer", fontWeight: 700 }}>모두 확인</button>
          </div>
          {notifications.slice(0, 3).map((item) => <div key={item.id} style={{ fontSize: 12.5, lineHeight: 1.55, color: C.ink, padding: "5px 0", borderTop: `1px solid ${C.line}` }}>{item.message}</div>)}
        </div>
      )}

      {/* ── 실행 패널 ── */}
      <div className="inflow-card" style={{ order: 4, background: C.panel, border: "1.5px solid #2563eb", borderRadius: 16, padding: 18, marginBottom: 14, display: "flex", flexDirection: "column", gap: 16 }}>
        <GroupHeader n="1" color="#2563eb" title="어디에 · 무엇으로 검색" desc="유입할 대상(플레이스·블로그·스토어)과 검색 키워드를 정해요" />
        {/* 대상 */}
        <div>
          <label style={labelStyle}>어디로 유입시킬까요?</label>
          <div style={{ display: "flex", gap: 8 }}>
            {([["place", "🗺️ 플레이스"], ["blog", "📝 블로그"], ["store", "🛒 스마트스토어"]] as const).filter(([k]) => allowFeat(k)).map(([k, lb]) => (
              <button key={k} onClick={() => setTargetType(k)} style={{ flex: 1, padding: "13px", borderRadius: 12, border: `2px solid ${targetType === k ? C.accent : C.line2}`, background: targetType === k ? C.glow : C.panel2, color: targetType === k ? C.accent : C.sub, fontSize: 14.5, fontWeight: 800, cursor: "pointer", fontFamily: "inherit" }}>{lb}</button>
            ))}
          </div>
        </div>

        {/* 대상 입력 + 이름 붙여 저장 */}
        <div>
          <label style={labelStyle}>{targetType === "place" ? "내 플레이스 주소" : targetType === "store" ? "내 스마트스토어 상품 주소" : "내 블로그 글 주소"}</label>
          <input
            value={targetType === "place" ? placeUrl : targetType === "store" ? storeUrl : blogUrl}
            onChange={(e) => { const v = e.target.value; const det = detectTargetType(v);
              if (targetType === "place") { setPlaceUrl(v); if (det === "blog") { setBlogUrl(v); setTargetType("blog"); toast("블로그 주소로 인식했어요", "info"); } else if (det === "store") { setStoreUrl(v); setTargetType("store"); toast("스마트스토어 주소로 인식했어요", "info"); } }
              else if (targetType === "store") { setStoreUrl(v); if (det === "place") { setPlaceUrl(v); setTargetType("place"); toast("플레이스 주소로 인식했어요", "info"); } else if (det === "blog") { setBlogUrl(v); setTargetType("blog"); toast("블로그 주소로 인식했어요", "info"); } }
              else { setBlogUrl(v); if (det === "place") { setPlaceUrl(v); setTargetType("place"); toast("플레이스 주소로 인식했어요", "info"); } else if (det === "store") { setStoreUrl(v); setTargetType("store"); toast("스마트스토어 주소로 인식했어요", "info"); } } }}
            placeholder={targetType === "place" ? "지도/플레이스/naver.me 링크 붙여넣기" : targetType === "store" ? "smartstore.naver.com/스토어/products/상품번호" : "글 주소/아이디 (blog.naver.com/아이디/글번호)"}
            style={inputStyle} />
          {/* 인식 배지 */}
          {targetType === "place" && placeUrl.trim() && (extractPlaceId(placeUrl)
            ? <div style={{ marginTop: 6, fontSize: 12.5, fontWeight: 700, color: "#16a34a" }}>✅ 인식됨 — 가게번호 {extractPlaceId(placeUrl)}</div>
            : isShortUrl(placeUrl)
              ? <div style={{ marginTop: 6, fontSize: 12.5, fontWeight: 700, color: C.accent }}>🔗 단축주소 — 실행할 때 자동으로 풀려요</div>
              : <div style={{ marginTop: 6, fontSize: 12.5, fontWeight: 700, color: "#dc2626" }}>⚠️ 주소를 못 읽었어요 — 지도 링크(map.naver.com/…/place/숫자)를 붙여넣어 주세요</div>)}
          {targetType === "blog" && blogUrl.trim() && (parseBlogUrl(blogUrl)
            ? <div style={{ marginTop: 6, fontSize: 12.5, fontWeight: 700, color: "#16a34a" }}>✅ 인식됨 — {parseBlogUrl(blogUrl)!.blogId}{parseBlogUrl(blogUrl)!.logNo ? " / 글 " + parseBlogUrl(blogUrl)!.logNo : ""}</div>
            : <div style={{ marginTop: 6, fontSize: 12.5, fontWeight: 700, color: "#dc2626" }}>⚠️ 주소를 못 읽었어요 — blog.naver.com/아이디/글번호 형태로 붙여넣어 주세요</div>)}
          {targetType === "store" && storeUrl.trim() && (parseStoreUrl(storeUrl)
            ? <div style={{ marginTop: 6, fontSize: 12.5, fontWeight: 700, color: "#16a34a" }}>✅ 인식됨 — 스토어 {parseStoreUrl(storeUrl)!.storeId || "?"}{parseStoreUrl(storeUrl)!.productId ? " / 상품 " + parseStoreUrl(storeUrl)!.productId : ""}</div>
            : <div style={{ marginTop: 6, fontSize: 12.5, fontWeight: 700, color: "#dc2626" }}>⚠️ 주소를 못 읽었어요 — smartstore.naver.com/스토어/products/상품번호 형태로 붙여넣어 주세요</div>)}

          {/* 📚 블로그 글 지정 유입 — 3가지 방법(주소만=랜덤 / 글주소 직접 / 로그인해서 내 글) 컬러 그룹 */}
          {targetType === "blog" && (
            <div style={{ marginTop: 12, padding: 14, borderRadius: 16, background: "linear-gradient(135deg,rgba(16,133,107,.06),transparent)", border: "2px solid #16a34a" }}>
              <div style={{ fontSize: 13.5, fontWeight: 900, color: "#16a34a", marginBottom: 4 }}>📚 어느 글에 트래픽을 넣을까요?</div>
              <div style={{ fontSize: 12, fontWeight: 600, color: C.sub, lineHeight: 1.6, marginBottom: 11 }}>
                • <b style={{ color: C.ink }}>위 주소만</b> 넣으면 → 그 블로그의 <b>여러 글에 랜덤</b>으로 방문해요 <span style={{ color: "#16a34a", fontWeight: 800 }}>(로그인 X)</span><br />
                • <b style={{ color: C.ink }}>특정 글</b>만 노리려면 아래 두 방법으로 골라요 👇
              </div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <button onClick={() => setPostPopup("manual")} style={{ flex: 1, minWidth: 180, padding: "13px", borderRadius: 12, border: `2px solid ${C.accent}`, background: C.panel, cursor: "pointer", fontFamily: "inherit", textAlign: "left" }}>
                  <div style={{ fontSize: 13.5, fontWeight: 900, color: C.accent }}>📝 글 주소 직접 넣기</div>
                  <div style={{ fontSize: 11, fontWeight: 600, color: C.sub, marginTop: 2 }}>로그인 없이 · 글 링크를 붙여넣기</div>
                </button>
                <button onClick={() => setPostPopup("login")} style={{ flex: 1, minWidth: 180, padding: "13px", borderRadius: 12, border: `2px solid #d97706`, background: C.panel, cursor: "pointer", fontFamily: "inherit", textAlign: "left" }}>
                  <div style={{ fontSize: 13.5, fontWeight: 900, color: "#d97706" }}>🔐 로그인해서 내 글 불러오기</div>
                  <div style={{ fontSize: 11, fontWeight: 600, color: C.sub, marginTop: 2 }}>연결한 계정으로 · 내 글 목록에서 선택</div>
                </button>
              </div>
              {pickedPostCount > 0 && (
                <div style={{ marginTop: 10, padding: "9px 13px", borderRadius: 10, background: C.glow, border: `1.5px solid ${C.accent}`, fontSize: 12.5, fontWeight: 800, color: C.accent, display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                  ✅ 지정된 글 <b>{pickedPostCount}개</b>에 유입 예정 — 아래 '유입 시작'을 누르세요
                  <button onClick={() => { setExtraTargets([]); setPickedPostCount(0); toast("지정 글 해제 — 주소의 랜덤 글로 돌아갔어요", "info"); }} style={{ marginLeft: "auto", padding: "4px 10px", borderRadius: 7, border: `1px solid ${C.line2}`, background: C.panel, color: C.sub, fontSize: 11, fontWeight: 800, cursor: "pointer", fontFamily: "inherit" }}>해제</button>
                </div>
              )}
            </div>
          )}

          {/* 이름 + 저장 버튼 */}
          <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
            <input value={savingName} onChange={(e) => setSavingName(e.target.value)} placeholder={targetType === "place" ? "이 플레이스 이름 (예: 강남점)" : targetType === "store" ? "이 상품 이름 (예: 홍삼 세트)" : "이 블로그 이름"} style={{ ...inputStyle, flex: 1 }} />
            <button onClick={saveCurrentTarget} style={{ padding: "0 22px", borderRadius: 12, border: "none", background: `linear-gradient(135deg,${C.accent},${C.cyan})`, color: "#fff", fontSize: 14.5, fontWeight: 900, cursor: "pointer", fontFamily: "inherit", whiteSpace: "nowrap" }}>💾 저장</button>
          </div>
          {/* 저장된 목록 — 골라 쓰기 */}
          {savedTargets.filter((t) => t.type === targetType).length > 0 && (
            <div style={{ marginTop: 10, padding: 12, borderRadius: 12, background: C.panel2, border: `1px solid ${C.line}` }}>
              <div style={{ fontSize: 12, fontWeight: 800, color: C.sub, marginBottom: 8 }}>🏪 저장한 대상 (눌러서 불러오기)</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {savedTargets.filter((t) => t.type === targetType).map((t) => {
                  const active = (t.type === "place" ? placeUrl : t.type === "store" ? storeUrl : blogUrl).trim() === t.url && targetType === t.type;
                  return (
                    <div key={t.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "9px 12px", borderRadius: 10, background: active ? C.glow : C.panel, border: `1px solid ${active ? C.accent : C.line}` }}>
                      <button onClick={() => pickSavedTarget(t)} style={{ flex: 1, textAlign: "left", background: "transparent", border: "none", cursor: "pointer", fontFamily: "inherit", padding: 0, minWidth: 0 }}>
                        <div style={{ fontSize: 13.5, fontWeight: 800, color: active ? C.accent : C.ink, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{t.type === "place" ? "🗺️" : "📝"} {t.name} {active && "· 사용 중"}</div>
                        <div style={{ fontSize: 11, color: C.sub, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{t.url}</div>
                      </button>
                      <button onClick={() => removeSavedTarget(t.id)} style={{ padding: "4px 10px", borderRadius: 8, border: `1px solid ${C.line2}`, background: C.panel2, color: "#dc2626", fontSize: 16, fontWeight: 900, cursor: "pointer", flexShrink: 0 }}>×</button>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {/* ➕ 추가 대상(여러 곳 번갈아 유입) */}
        <div>
          <label style={labelStyle}>➕ 추가 대상 <span style={{ color: C.sub, fontWeight: 600 }}>(선택 — 위 대상 말고 더 유입할 곳)</span></label>
          <div style={{ fontSize: 11.5, fontWeight: 600, color: C.sub, lineHeight: 1.6, marginBottom: 8, background: C.panel2, border: `1px solid ${C.line}`, borderRadius: 10, padding: "8px 11px" }}>
            💡 여러 곳을 <b>한 번에</b> 유입하고 싶을 때 써요. 여기에 넣은 주소들을 <b>위 대상과 번갈아(로테이션)</b> 방문해요. {targetType === "store" ? "예: 상품 여러 개를 동시에" : targetType === "blog" ? "예: 글 여러 개를 동시에" : "예: 매장 여러 곳을 동시에"} 올리고 싶을 때. <b>안 넣어도 돼요.</b>
          </div>
          {extraTargets.map((t, i) => (
            <div key={i} style={{ display: "flex", gap: 8, marginBottom: 6 }}>
              <input value={t} onChange={(e) => setExtraTargets((arr) => arr.map((x, j) => j === i ? e.target.value : x))} placeholder={targetType === "store" ? "스마트스토어 상품 주소" : targetType === "blog" ? "블로그 글 주소" : "플레이스 주소"} style={{ ...inputStyle, flex: 1 }} />
              <button onClick={() => setExtraTargets((arr) => arr.filter((_, j) => j !== i))} style={{ padding: "0 14px", borderRadius: 10, border: `1.5px solid ${C.line2}`, background: C.panel2, color: "#dc2626", fontSize: 18, fontWeight: 900, cursor: "pointer" }}>×</button>
            </div>
          ))}
          <button onClick={() => setExtraTargets((arr) => [...arr, ""])} style={{ padding: "9px 14px", borderRadius: 10, border: `1.5px dashed ${C.line2}`, background: "transparent", color: C.accent, fontSize: 13.5, fontWeight: 800, cursor: "pointer", fontFamily: "inherit" }}>＋ 대상 추가</button>
        </div>

        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8, flexWrap: "wrap" }}>
            <label style={{ ...labelStyle, margin: 0 }}>검색 키워드 <span style={{ color: C.sub, fontWeight: 600 }}>(여러 개 — 돌아가며 검색)</span></label>
            <button onClick={runKeywordSuggest} disabled={kwLoading} style={{ marginLeft: "auto", padding: "6px 12px", borderRadius: 8, border: `1.5px solid ${C.accent}`, background: C.panel2, color: C.accent, fontSize: 12.5, fontWeight: 800, cursor: kwLoading?"default":"pointer", fontFamily: "inherit", opacity: kwLoading?0.6:1 }}>{kwLoading ? "찾는 중…" : "🔎 키워드 추천"}</button>
          </div>
          <textarea value={keywords} onChange={(e) => setKeywords(e.target.value)} placeholder={targetType === "store" ? "예) 홍삼 스틱, 산양삼 선물세트, 6년근 홍삼" : targetType === "blog" ? "예) 강남 맛집 후기, 부업 추천, 블로그 체험단" : "예) 강남 맛집, 강남역 삼겹살, 역삼동 고깃집"} rows={2} style={{ ...inputStyle, resize: "vertical", lineHeight: 1.6 }} />
          <div style={{ fontSize: 11, fontWeight: 600, color: C.sub, marginTop: 4 }}>🔒 키워드는 {targetType === "store" ? "스마트스토어" : targetType === "blog" ? "블로그" : "플레이스"} 전용으로 따로 저장돼요 — 대상을 바꿔도 서로 섞이지 않아요.</div>

          {/* 🧩 키워드 조합 생성기 — "고객이 치는 말"로 메인+세부 자동 조합 */}
          <div style={{ marginTop: 10, padding: 12, borderRadius: 12, background: C.glow, border: `1.5px solid ${C.line2}` }}>
            <div style={{ fontSize: 12.5, fontWeight: 800, color: C.ink, marginBottom: 3 }}>🧩 키워드 조합 만들기 <span style={{ color: C.sub, fontWeight: 600, fontSize: 11 }}>· 고객이 검색창에 치는 말로</span></div>
            <div style={{ fontSize: 11, color: C.sub, fontWeight: 600, lineHeight: 1.5, marginBottom: 8 }}>
              {targetType === "store"
                ? <>대표 카테고리 + 용도/대상/특징을 넣으면 <b>메인·세부 키워드</b>를 자동으로 만들어요. (예: 홍삼스틱 / 부모님선물·6년근)</>
                : <>지역 + 업종 + 메뉴/목적을 넣으면 <b>메인(지역+업종)·세부(지역+메뉴)</b> 키워드를 자동으로 만들어요. 신규 매장은 <b>세부부터</b> 노려요.</>}
            </div>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              <input value={cbRegion} onChange={e=>setCbRegion(e.target.value)} placeholder={targetType==="store"?"대표 카테고리 (예: 홍삼스틱)":"지역 (예: 역삼동)"} style={{ ...inputStyle, flex: "1 1 130px", minWidth: 110 }} />
              <input value={cbType} onChange={e=>setCbType(e.target.value)} placeholder={targetType==="store"?"핵심 특징 (예: 6년근)":"업종 (예: 삼겹살)"} style={{ ...inputStyle, flex: "1 1 130px", minWidth: 110 }} />
              <input value={cbExtra} onChange={e=>setCbExtra(e.target.value)} placeholder={targetType==="store"?"용도·대상 (쉼표: 선물, 면역력)":"메뉴·목적 (쉼표: 회식, 데이트)"} style={{ ...inputStyle, flex: "1 1 100%" }} />
            </div>
            <button onClick={genCombos} style={{ marginTop: 8, padding: "9px 16px", borderRadius: 9, border: "none", background: `linear-gradient(135deg,${C.accent},#8b5cf6)`, color: "#fff", fontSize: 12.5, fontWeight: 800, cursor: "pointer", fontFamily: "inherit" }}>🧩 조합 키워드 만들기</button>
          </div>

          {kwSuggest.length > 0 && (()=>{
            // 메인(어절 2 이하=지역+업종 대장) / 세부(롱테일) 분류. 검색량(vol) 있으면 큰 순 정렬.
            const isMain = (kw: string) => kw.trim().split(/\s+/).length <= 2;
            const sortVol = (a:any,b:any)=> (b.vol??-1)-(a.vol??-1);
            const mains = kwSuggest.filter(k=>isMain(k.keyword)).sort(sortVol);
            const subs  = kwSuggest.filter(k=>!isMain(k.keyword)).sort(sortVol);
            const srcBadge = (s:string)=> s.includes("자동완성")?"실검색어": s.includes("연관")?"함께찾음": s.includes("조합")?"내조합": "추천";
            const compColor = (c?:string)=> c==="높음"?"#dc2626": c==="중간"?"#d97706": c==="낮음"?"#059669": C.sub;
            const chip = (k:{keyword:string;source:string;vol?:number;comp?:string}, main:boolean)=>(
              <button key={k.keyword} onClick={()=>addSuggestedKeyword(k.keyword)} title={`출처: ${srcBadge(k.source)}${k.vol!=null?` · 월 검색량 ${k.vol.toLocaleString()}`:""}${k.comp?` · 경쟁 ${k.comp}`:""}`}
                style={{ display:"inline-flex", alignItems:"center", gap:5, padding:"6px 11px", borderRadius:999, border:`1.5px solid ${main?C.accent:C.line2}`, background: main?C.glow:C.panel, color:C.ink, fontSize:12.5, fontWeight:700, cursor:"pointer", fontFamily:"inherit" }}>
                + {k.keyword}
                {k.vol!=null && <span style={{ fontSize:10, fontWeight:800, color:C.accent }}>🔍{k.vol>=10000?`${Math.round(k.vol/1000)}천`:k.vol.toLocaleString()}</span>}
                {k.comp && <span style={{ fontSize:9.5, fontWeight:800, color:compColor(k.comp) }}>{k.comp}</span>}
                {!k.comp && <span style={{ fontSize:9.5, fontWeight:700, color:C.sub, opacity:.8 }}>{srcBadge(k.source)}</span>}
              </button>
            );
            return (
              <div style={{ marginTop: 8, padding: 12, borderRadius: 12, background: C.panel2, border: `1px solid ${C.line}` }}>
                {mains.length>0 && <>
                  <div style={{ fontSize: 11.5, fontWeight: 800, color: C.accent, marginBottom: 6 }}>🔵 메인 키워드 <span style={{ color: C.sub, fontWeight: 600 }}>· 검색량 많음·경쟁 심함 (기둥 1개)</span></div>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 10 }}>{mains.map(k=>chip(k,true))}</div>
                </>}
                {subs.length>0 && <>
                  <div style={{ fontSize: 11.5, fontWeight: 800, color: "#059669", marginBottom: 6 }}>🟢 세부 키워드 <span style={{ color: C.sub, fontWeight: 600 }}>· 경쟁 낮음·전환 높음 (신규는 여기부터!)</span></div>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>{subs.map(k=>chip(k,false))}</div>
                </>}
                <div style={{ fontSize: 10.5, color: C.sub, fontWeight: 600, marginTop: 8, lineHeight: 1.5 }}>{kwSuggest.some(k=>k.vol!=null) ? <>💡 <b>🔍=월 검색량</b>(네이버 실측) · <b style={{color:"#dc2626"}}>높음</b>/<b style={{color:"#d97706"}}>중간</b>/<b style={{color:"#059669"}}>낮음</b>=경쟁도. 신규는 <b>검색량 있고 경쟁 낮은 세부</b>부터 노리세요.</> : <>💡 <b>실검색어</b>=사람들이 실제로 치는 말 · <b>함께찾음</b>=연관검색어. 메인 1 + 세부 4~5개로 채우세요.</>}</div>
              </div>
            );
          })()}
        </div>

        <GroupHeader n="2" color="#7c3aed" title="어떻게 방문할까 (자연스럽게)" desc="접속 기기·방문 텀·횟수·체류시간·액션 확률 — 진짜 손님처럼" />
        {/* 기기 */}
        <div>
          <label style={labelStyle}>접속 기기 <span style={{ color: C.sub, fontWeight: 600 }}>(기본 모바일 — 안 바꿔도 돼요)</span></label>
          <div style={{ display: "flex", gap: 8 }}>
            {([["mobile", "📱 모바일"], ["pc", "🖥️ PC"], ["mix", "🔀 혼합(랜덤)"]] as const).map(([k, lb]) => (
              <button key={k} onClick={() => { setDevice(k); toast(`📶 접속패턴 '${lb}' 선택됨`, "success"); }} style={{ flex: 1, padding: "11px", borderRadius: 12, border: `2px solid ${device === k ? C.accent : C.line2}`, background: device === k ? C.glow : C.panel2, color: device === k ? C.accent : C.sub, fontSize: 14, fontWeight: 800, cursor: "pointer", fontFamily: "inherit" }}>{device === k ? "✓ " : ""}{lb}</button>
            ))}
          </div>
        </div>

        {/* 💾 데이터(프록시) 사용 모드 — 플레이스·블로그·스마트스토어 공통. 관리자 지정(licenseSaver) 시 숨김. */}
        {!licenseSaverLocked && (
        <div>
          <label style={{ ...labelStyle, display: "flex", alignItems: "center", gap: 7 }}>
            💾 데이터(프록시) 사용
            <span style={{ color: C.sub, fontWeight: 600 }}>— 프록시 GB를 얼마나 아낄지</span>
            <button onClick={() => setDataSaverInfo(true)} title="이 기능이 프록시를 어떻게 쓰는지" style={{ width: 20, height: 20, borderRadius: "50%", border: `1.5px solid ${C.accent}`, background: C.panel2, color: C.accent, fontSize: 12, fontWeight: 900, cursor: "pointer", fontFamily: "inherit", lineHeight: 1, flexShrink: 0 }}>ⓘ</button>
          </label>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {([["normal", "🟢 일반", "다 받음 · 가장 자연스러움", "약 1만 회"], ["save", "💾 절약", "영상·광고·폰트 차단 · GB 반절", "약 2만 회"], ["max", "🔋 초절약", "이미지까지 차단 · GB 1/10", "약 7만 회"]] as const).map(([k, lb, desc, cnt]) => {
              const on = dataSaver === k;
              return (
                <button key={k} onClick={() => {
                  chooseDataSaver(k);
                  const label = k === "normal" ? "일반(다 받음)" : k === "save" ? "절약(영상·광고·폰트 차단)" : "초절약(이미지까지 차단)";
                  toast(`💾 데이터 '${lb.replace(/^[^ ]+ /, "")}' 모드 선택됨 — 이 선택이 유지돼요`, "success");
                  // ★2026-09-08(테리): 데이터모드 바꾸면 로그에 명확히 찍는다. 실행 중이면 지금 도는 건 처음 설정대로라 '다음 유입부터' 안내.
                  const rt = (targetType as RunTT);
                  pushLogFor(rt, `💾 데이터 모드를 '${label}'로 바꿨어요.${runningTypes[rt] ? " (지금 도는 유입은 시작 설정대로 진행 · 다음 '유입 시작'부터 적용)" : ""}`);
                }} style={{ flex: "1 1 150px", minWidth: 140, padding: "11px", borderRadius: 10, border: `2px solid ${on ? C.accent : C.line2}`, background: on ? C.glow : C.panel2, cursor: "pointer", fontFamily: "inherit", textAlign: "left" }}>
                  <div style={{ fontSize: 13.5, fontWeight: 900, color: on ? C.accent : C.ink }}>{on ? "✓ " : ""}{lb}</div>
                  <div style={{ fontSize: 10.5, fontWeight: 600, color: C.sub, marginTop: 1 }}>{desc}</div>
                  {unlimited && <div style={{ fontSize: 10.5, fontWeight: 800, color: on ? C.accent : C.cyan, marginTop: 3 }}>📊 50GB로 {cnt}</div>}
                </button>
              );
            })}
          </div>
          <div style={{ fontSize: 11, color: C.sub, fontWeight: 600, marginTop: 4 }}>
            💡 <b style={{ color: C.ink }}>절약</b> 추천 — 순위 신호(클릭·체류·저장)는 100% 유지하면서 프록시 데이터를 아껴요. ⓘ를 눌러 자세히 보세요.
          </div>
        </div>
        )}

        {/* 텀 + 횟수 */}
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
          <div style={{ flex: 1, minWidth: 200 }}>
            <label style={labelStyle}>방문 텀(초) — 임의 범위로 랜덤</label>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <input type="number" min={5} value={termMin} onChange={(e) => setTermMin(Math.max(5, Number(e.target.value)))} style={{ ...inputStyle, textAlign: "center" }} />
              <span style={{ fontWeight: 800, color: C.sub }}>~</span>
              <input type="number" min={termMin} value={termMax} onChange={(e) => setTermMax(Math.max(termMin, Number(e.target.value)))} style={{ ...inputStyle, textAlign: "center" }} />
            </div>
          </div>
          <div style={{ flex: 1, minWidth: 200 }}>
            <label style={labelStyle}>방문 횟수</label>
            <input type="number" min={1} value={rounds} disabled={auto} onChange={(e) => setRounds(Math.max(1, Number(e.target.value)))} style={{ ...inputStyle, textAlign: "center", opacity: auto ? 0.5 : 1 }} />
          </div>
        </div>

        {/* 체류 강도 + 액션 확률 */}
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
          <div style={{ flex: 1, minWidth: 220 }}>
            <label style={labelStyle}>📖 체류 강도 <span style={{ color: C.sub, fontWeight: 600 }}>(글 읽는 시간)</span></label>
            <div style={{ display: "flex", gap: 6 }}>
              {([["fast", "빠르게 ~20초"], ["normal", "보통 ~60초"], ["deep", "꼼꼼히 ~3분"]] as const).map(([k, lb]) => {
                const on = intensity === k && maxDwellSec === 0; // 직접지정 중이면 강도 버튼은 꺼진 표시
                return (
                <button key={k} onClick={() => { setIntensity(k); setMaxDwellSec(0); setDwellDraft("30"); toast(`📖 체류강도 '${lb}' 선택됨`, "success"); }} style={{ flex: 1, padding: "11px", borderRadius: 10, border: `2px solid ${on ? C.accent : C.line2}`, background: on ? C.glow : C.panel2, color: on ? C.accent : C.sub, fontSize: 13.5, fontWeight: 800, cursor: "pointer", fontFamily: "inherit" }}>{on ? "✓ " : ""}{lb}</button>
                );
              })}
            </div>
          </div>
          <div style={{ flex: 1, minWidth: 220 }}>
            <label style={labelStyle}>⏱️ 체류시간 직접지정(초) {maxDwellSec > 0 ? <span style={{ color: C.accent, fontWeight: 800 }}>✓ {maxDwellSec}초 사용 중</span> : <span style={{ color: C.sub, fontWeight: 600 }}>(강도 대신 직접)</span>}</label>
            <div style={{ display: "flex", gap: 6 }}>
              <input type="number" min={0} value={dwellDraft}
                onChange={(e) => setDwellDraft(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") { const v = Math.max(0, Number(dwellDraft) || 0); setMaxDwellSec(v); toast(v > 0 ? `⏱️ 체류시간 ${v}초로 설정됨 (강도 해제)` : "체류강도 선택으로 돌아왔어요", v > 0 ? "success" : "info"); } }}
                placeholder="예: 300 = 5분" style={{ ...inputStyle, flex: 1, textAlign: "center", border: `2px solid ${maxDwellSec > 0 ? C.accent : C.line2}`, background: maxDwellSec > 0 ? C.glow : C.panel2 }} />
              <button onClick={() => { const v = Math.max(0, Number(dwellDraft) || 0); setMaxDwellSec(v); toast(v > 0 ? `⏱️ 체류시간 ${v}초로 설정됨 (강도 해제)` : "체류강도 선택으로 돌아왔어요", v > 0 ? "success" : "info"); }}
                style={{ padding: "0 16px", borderRadius: 10, border: "none", background: `linear-gradient(135deg,${C.accent},${C.cyan})`, color: "#fff", fontSize: 13.5, fontWeight: 900, cursor: "pointer", fontFamily: "inherit", whiteSpace: "nowrap" }}>설정</button>
            </div>
            <div style={{ fontSize: 11, color: maxDwellSec > 0 ? C.accent : C.sub, fontWeight: 700, marginTop: 3 }}>{maxDwellSec > 0 ? `이 시간(약 ${maxDwellSec}초)으로 체류 · 강도 버튼은 꺼짐` : "값을 넣으면 강도 무시하고 그 시간으로(3분↑ 가능)"}</div>
          </div>
          <div style={{ flex: 1, minWidth: 220 }}>
            <label style={labelStyle}>🎲 액션 확률 <span style={{ color: C.sub, fontWeight: 600 }}>(방문 중 저장·공감 등 실행 비율)</span></label>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <input type="range" min={0} max={100} step={10} value={actionRate} onChange={(e) => setActionRate(Number(e.target.value))} style={{ flex: 1, accentColor: C.accent }} />
              <span style={{ minWidth: 44, textAlign: "right", fontSize: 15, fontWeight: 900, color: C.accent }}>{actionRate}%</span>
            </div>
            <div style={{ fontSize: 11, color: C.sub, fontWeight: 600, marginTop: 3 }}>낮출수록 자연스러워요(진짜 손님처럼 일부만 저장)</div>
          </div>
        </div>

        {/* 💡 체류·행동 시간 계산법 — 사용자가 머리 안 굴려도 알게 눈에 잘 보이게 */}
        <div style={{ background: `linear-gradient(135deg,${C.glow},transparent)`, border: `1.5px solid ${C.accent}`, borderRadius: 14, padding: "13px 16px" }}>
          <div style={{ fontSize: 13.5, fontWeight: 900, color: C.accent, marginBottom: 7 }}>💡 방문시간은 이렇게 정해져요</div>
          <div style={{ fontSize: 12.5, fontWeight: 600, color: C.ink, lineHeight: 1.75 }}>
            • <b>체류시간</b> = 빠르게 <b>20초</b> · 보통 <b>60초</b> · 꼼꼼히 <b>180초</b> <span style={{ color: C.sub }}>(방문마다 ±오차로 자연스럽게)</span><br />
            • 더 오래 보게 하려면 <b>체류시간 직접지정</b>에 초 입력 <span style={{ color: C.sub }}>(예: 300 = 5분, 강도 무시)</span><br />
            • <b>방문행동</b>(저장·길찾기 등)은 <b>행동당 약 2~3초</b>씩 체류시간 위에 더해져요
          </div>
          <div style={{ marginTop: 8, padding: "8px 12px", borderRadius: 10, background: C.panel2, border: `1px solid ${C.line}`, fontSize: 13, fontWeight: 800, color: C.ink }}>
            👉 총 방문시간 = 체류시간 + 행동시간(행동 수 × 2~3초)
          </div>
        </div>

        <GroupHeader n="3" color="#16a34a" title="방문해서 할 행동" desc="저장·길찾기·전화·찜 등 — 🔑 표시는 로그인 필요, 나머지는 계정 없이 OK" />
        {/* 액션 */}
        <div>
          <label style={labelStyle}>방문해서 할 행동 <span style={{ color: C.sub, fontWeight: 600 }}>{targetType === "place" ? "(길찾기·전화·예약이 순위에 가장 강해요)" : ""}</span></label>
          {/* 🔑 로그인 필요 액션 안내 — 버튼 바로 위에 잘 보이게 */}
          <div style={{ display: "flex", gap: 9, alignItems: "flex-start", background: "rgba(245,158,11,.10)", border: "1.5px solid #f59e0b", borderRadius: 12, padding: "10px 13px", marginBottom: 10 }}>
            <span style={{ fontSize: 16, lineHeight: 1.2, flexShrink: 0 }}>🔑</span>
            <div style={{ fontSize: 12.5, fontWeight: 700, color: C.ink, lineHeight: 1.6 }}>
              {targetType === "place" ? (
                <>
                  <b style={{ color: "#16a34a" }}>✅ 로그인 없이 가능(주소만):</b> 검색→클릭→체류·스크롤(방문 트래픽) · 🧭 길찾기 · 📞 전화 · 📅 예약 · 💬 톡톡 · 🔗 공유. <b>여기까지가 순위에 강한 방문·관심 신호</b>라 계정 없이도 순위를 올릴 수 있어요.<br />
                  <b style={{ color: "#d97706" }}>🔑 로그인 필요(저장 💾만):</b> 저장은 <b>내 네이버 계정의 저장목록(MY플레이스)</b>에 넣는 거라 로그인이 꼭 필요해요. 저장까지 원하면 <b>계정 관리</b>에서 계정 연결 후 유입 시작 때 <b>그 계정을 선택</b>하세요. (저장 안 켜면 계정 없이 진행)
                </>
              ) : targetType === "store" ? (
                <>
                  <b style={{ color: "#16a34a" }}>✅ 로그인 없이 가능(상품 주소만):</b> 쇼핑 검색→클릭→상품 상세 체류·스크롤 · 🔍 옵션·상세 탐색 · 🔗 공유. <b>여기까지가 쇼핑 순위에 도움되는 방문·관심 신호</b>라 계정 없이도 순위 작업이 돼요.<br />
                  <b style={{ color: "#d97706" }}>🔑 로그인 필요(찜 💚·장바구니 🛒):</b> 찜·장바구니는 <b>내 네이버 계정</b>에 담는 거라 로그인이 필요해요. 원하면 <b>계정 관리</b>에서 계정 연결 후 <b>그 계정을 선택</b>하세요. (안 켜면 계정 없이 진행)
                </>
              ) : (
                <>
                  <b style={{ color: "#16a34a" }}>✅ 로그인 없이 가능(글 주소·아이디만):</b> 검색→클릭→글 전체 읽기 체류·다른 글 둘러보기(풀퍼널) · 🔗 공유 · <b>📚 내 글 수집</b>도 로그인 없이 아이디만으로 돼요. <b>여기까지가 블로그 지수·순위에 도움되는 신호</b>예요.<br />
                  <b style={{ color: "#d97706" }}>🔑 로그인 필요(공감 💚만):</b> 공감(좋아요)은 <b>내 네이버 계정으로 누르는 것</b>이라 로그인이 필요해요. 원하면 <b>계정 관리</b>에서 계정 연결 후 <b>그 계정을 선택</b>하세요. (공감 안 켜면 계정 없이 진행)
                </>
              )}
            </div>
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {/* 🎫 관리자가 허용한 행동만 노출(actionAllowed). 라이선스 미설정이면 전체 허용(하위호환). */}
            {targetType === "place" ? (<>
              {actionAllowed("save") && <ActionChk v={doSave} set={setDoSave} label="💾 저장 🔑" />}
              {actionAllowed("dir") && <ActionChk v={doDir} set={setDoDir} label="🧭 길찾기" />}
              {actionAllowed("call") && <ActionChk v={doCall} set={setDoCall} label="📞 전화" />}
              {actionAllowed("book") && <ActionChk v={doBook} set={setDoBook} label="📅 예약" />}
              {actionAllowed("talk") && <ActionChk v={doTalk} set={setDoTalk} label="💬 톡톡" />}
              {actionAllowed("share") && <ActionChk v={doShare} set={setDoShare} label="🔗 공유" />}
            </>) : targetType === "store" ? (<>
              {actionAllowed("option") && <ActionChk v={doOption} set={setDoOption} label="🔍 옵션·상세 탐색" />}
              {actionAllowed("wish") && <ActionChk v={doWish} set={setDoWish} label="💚 찜 🔑" />}
              {actionAllowed("cart") && <ActionChk v={doCart} set={setDoCart} label="🛒 장바구니 🔑" />}
              {actionAllowed("share") && <ActionChk v={doShare} set={setDoShare} label="🔗 공유" />}
            </>) : (<>
              {actionAllowed("like") && <ActionChk v={doLike} set={setDoLike} label="💚 공감 🔑" />}
              {actionAllowed("neighbor") && <ActionChk v={doNeighbor} set={setDoNeighbor} label="👥 이웃추가 🔑" />}
              {actionAllowed("share") && <ActionChk v={doShare} set={setDoShare} label="🔗 공유" />}
            </>)}
            <ActionChk v={auto} set={setAuto} label="⚙️ 자동(오늘 한도까지)" />
            <ActionChk v={visible} set={setVisible} label="🪟 창 보기(테스트)" />
          </div>
        </div>

        <GroupHeader n="⚙️" color="#64748b" title="고급 · 더 자연스럽게 (선택)" desc="키워드 비중·시간 분산·풀퍼널 — 몰라도 되지만 켜면 봇 티가 줄어요" />
        {/* ⚙️ 고급 설정 — 키워드별 비중(자주 안 쓰는 건 접어둠) */}
        <div>
          <button onClick={() => setAdvOpen((v) => !v)} style={{ padding: "10px 14px", borderRadius: 10, border: `1.5px solid ${C.line2}`, background: C.panel2, color: C.ink, fontSize: 13.5, fontWeight: 800, cursor: "pointer", fontFamily: "inherit", width: "100%", textAlign: "left" }}>
            {advOpen ? "▾" : "▸"} ⚙️ 고급 설정 — 키워드별 비중
          </button>
          {advOpen && (
            <div style={{ marginTop: 10, padding: 14, borderRadius: 12, border: `1px solid ${C.line}`, background: C.panel2 }}>
              <div style={{ fontSize: 12, color: C.sub, fontWeight: 600, marginBottom: 8 }}>키워드마다 방문 비중을 정해요(숫자가 클수록 자주). 비워두면 균등.</div>
              {keywords.split(/[,\n]/).map((k) => k.trim()).filter(Boolean).map((k) => (
                <div key={k} style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
                  <span style={{ flex: 1, fontSize: 13.5, fontWeight: 700 }}>{k}</span>
                  <input type="range" min={1} max={10} value={kwWeights[k] ?? 1} onChange={(e) => setKwWeights((w) => ({ ...w, [k]: Number(e.target.value) }))} style={{ width: 120, accentColor: C.accent }} />
                  <span style={{ minWidth: 24, textAlign: "right", fontSize: 14, fontWeight: 900, color: C.accent }}>{kwWeights[k] ?? 1}</span>
                </div>
              ))}
              {!keywords.trim() && <div style={{ fontSize: 12.5, color: C.sub, fontWeight: 600 }}>먼저 위에 키워드를 입력하세요.</div>}
            </div>
          )}
        </div>

        {/* ⏱️ 시간 분산 */}
        <label style={{ display: "flex", alignItems: "center", gap: 12, cursor: "pointer", padding: "12px 16px", borderRadius: 14, border: `2px solid ${spread ? C.accent : C.line2}`, background: spread ? C.glow : C.panel2, flexWrap: "wrap" }}>
          <input type="checkbox" checked={spread} onChange={(e) => setSpread(e.target.checked)} style={{ width: 19, height: 19, accentColor: C.accent, flexShrink: 0 }} />
          <div style={{ flex: 1, minWidth: 160 }}>
            <div style={{ fontSize: 14.5, fontWeight: 900, color: spread ? C.accent : C.ink }}>⏱️ 시간 분산 <span style={{ fontSize: 10, background: "#16a34a", color: "#fff", padding: "2px 6px", borderRadius: 6, marginLeft: 4 }}>봇 티 제거</span></div>
            <div style={{ fontSize: 12, fontWeight: 600, color: C.sub, marginTop: 3 }}>한 번에 몰지 않고 여러 시간에 걸쳐 자연스럽게 흘려보내요(진짜 손님 곡선)</div>
          </div>
          {spread && <div style={{ display: "flex", alignItems: "center", gap: 6 }} onClick={(e) => e.preventDefault()}>
            <input type="number" min={1} max={24} value={spreadHours} onChange={(e) => setSpreadHours(Math.min(24, Math.max(1, Number(e.target.value))))} style={{ width: 64, padding: "9px", borderRadius: 10, border: `1.5px solid ${C.line2}`, background: C.panel, color: C.ink, fontSize: 15, fontWeight: 800, textAlign: "center", fontFamily: "inherit" }} />
            <span style={{ fontSize: 13, fontWeight: 700, color: C.sub }}>시간에 걸쳐</span>
          </div>}
        </label>

        {/* ✍️ 리뷰 자동작성 — 관리자 락(플레이스 전용) */}
        {targetType === "place" && (
          <div style={{ padding: "12px 16px", borderRadius: 14, border: `2px solid ${doReview ? "#dc2626" : C.line2}`, background: doReview ? "rgba(220,38,38,.06)" : C.panel2 }}>
            <label style={{ display: "flex", alignItems: "center", gap: 12, cursor: "pointer" }}>
              <input type="checkbox" checked={doReview} onChange={(e) => setDoReview(e.target.checked)} style={{ width: 19, height: 19, accentColor: "#dc2626", flexShrink: 0 }} />
              <div>
                <div style={{ fontSize: 14.5, fontWeight: 900, color: doReview ? "#dc2626" : C.ink }}>✍️ 리뷰 자동작성 <span style={{ fontSize: 10, background: "#dc2626", color: "#fff", padding: "2px 6px", borderRadius: 6, marginLeft: 4 }}>🔒 관리자 승인</span></div>
                <div style={{ fontSize: 12, fontWeight: 600, color: C.sub, marginTop: 3, lineHeight: 1.5 }}>계정 밴 위험이 있어 관리자 승인을 받은 계정만 작동해요. 신중히 사용하세요.</div>
              </div>
            </label>
            {doReview && <textarea value={reviewText} onChange={(e) => setReviewText(e.target.value)} placeholder="등록할 리뷰 내용을 입력하세요" rows={2} style={{ ...inputStyle, marginTop: 10, resize: "vertical" }} />}
          </div>
        )}

        {/* 🌀 풀퍼널 모드 — 킬러 */}
        <label style={{ display: "flex", alignItems: "center", gap: 12, cursor: "pointer", padding: "14px 16px", borderRadius: 14, border: `2px solid ${funnel ? C.accent : C.line2}`, background: funnel ? C.glow : C.panel2 }}>
          <input type="checkbox" checked={funnel} onChange={(e) => setFunnel(e.target.checked)} style={{ width: 20, height: 20, accentColor: C.accent, flexShrink: 0 }} />
          <div>
            <div style={{ fontSize: 15, fontWeight: 900, color: funnel ? C.accent : C.ink }}>🌀 풀퍼널 모드 <span style={{ fontSize: 10, verticalAlign: "middle", background: C.accent, color: "#fff", padding: "2px 6px", borderRadius: 6, marginLeft: 4 }}>강력</span></div>
            <div style={{ fontSize: 12, fontWeight: 600, color: C.sub, marginTop: 3, lineHeight: 1.5 }}>{targetType === "place" ? "메뉴·사진·리뷰까지 둘러봐 체류·조회를 극대화 (진짜 손님처럼)" : targetType === "store" ? "상세정보·리뷰·연관상품까지 둘러봐 체류·조회를 극대화 (진짜 구매 고민 손님처럼)" : "이 블로그 다른 글도 2~3개 읽고 이웃까지 — 체류·페이지뷰·이웃 폭발"}</div>
          </div>
        </label>

        {/* 🔄 다계정 로테이션 — 저장·찜·공감을 여러 계정으로 번갈아(계정 수만큼 증가). 로그인 액션 켤 때만 의미 */}
        {/*    ★ 계정 추가·삭제·선택을 이 탭 안에서 바로(백링크 뺀 전 기능 공용). 추가/삭제는 헤더 계정 모달을 연다(기존 로직 재사용). */}
        <div style={{ padding: 13, borderRadius: 14, background: "linear-gradient(135deg,rgba(245,158,11,.07),transparent)", border: "2px solid #f59e0b" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 3 }}>
            <div style={{ fontSize: 13.5, fontWeight: 900, color: "#d97706" }}>🔄 저장·찜·공감에 쓸 계정 (로그인 필요)</div>
            {onManageAccounts && <button onClick={onManageAccounts} style={{ marginLeft: "auto", padding: "6px 12px", borderRadius: 8, border: `1.5px solid ${C.accent}`, background: C.glow, color: C.accent, fontSize: 12, fontWeight: 800, cursor: "pointer", fontFamily: "inherit" }}>➕ 계정 추가·관리</button>}
          </div>
          <div style={{ fontSize: 11.5, fontWeight: 600, color: C.sub, lineHeight: 1.6, marginBottom: 10 }}>
            선택한 계정을 <b>방문마다 번갈아 로그인</b>해서 저장·찜·공감을 눌러요. <b style={{ color: "#d97706" }}>계정 수만큼 저장·찜 수가 올라가요</b>(같은 계정은 1번만 유효). 각 계정은 자기 IP(프록시)로 접속해 안전해요. <span style={{ color: C.sub }}>※ 저장·찜·공감을 안 켜면 계정 없이도 방문 트래픽은 돼요.</span>
          </div>
          {accounts.length === 0 ? (
            <div style={{ fontSize: 12.5, fontWeight: 700, color: C.sub, textAlign: "center", padding: "16px 10px", borderRadius: 10, background: C.panel2, border: `1px dashed ${C.line2}`, lineHeight: 1.6 }}>
              연결된 계정이 없어요. <b style={{ color: "#d97706" }}>저장·찜·공감(로그인 행동)</b>을 쓰려면<br /><b style={{ color: C.accent }}>[➕ 계정 추가·관리]</b>로 네이버 계정을 먼저 연결하세요.
            </div>
          ) : (<>
            <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 8 }}>
              <button onClick={() => setSelectedAccts(new Set(accounts.map((a) => a.id)))} style={{ padding: "6px 12px", borderRadius: 8, border: `1.5px solid ${C.accent}`, background: C.glow, color: C.accent, fontSize: 12, fontWeight: 800, cursor: "pointer", fontFamily: "inherit" }}>✅ 전체 설정</button>
              <button onClick={() => setSelectedAccts(new Set())} style={{ padding: "6px 12px", borderRadius: 8, border: `1.5px solid ${C.line2}`, background: C.panel, color: C.sub, fontSize: 12, fontWeight: 800, cursor: "pointer", fontFamily: "inherit" }}>◻️ 전체 해제</button>
              <span style={{ fontSize: 12, fontWeight: 800, color: C.ink }}>선택 {selectedAccts.size}/{accounts.length}개</span>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 5, maxHeight: 180, overflowY: "auto" }}>
              {accounts.map((a) => { const on = selectedAccts.has(a.id); return (
                <label key={a.id} style={{ display: "flex", alignItems: "center", gap: 9, padding: "8px 11px", borderRadius: 9, background: on ? C.glow : C.panel2, border: `1px solid ${on ? C.accent : C.line}`, cursor: "pointer" }}>
                  <input type="checkbox" checked={on} onChange={() => setSelectedAccts((prev) => { const n = new Set(prev); n.has(a.id) ? n.delete(a.id) : n.add(a.id); return n; })} style={{ width: 16, height: 16, accentColor: C.accent, flexShrink: 0 }} />
                  <span style={{ fontSize: 13.5, fontWeight: 800, color: on ? C.accent : C.ink }}>{on ? "✓ " : ""}{a.blog_name || a.username}</span>
                </label>
              ); })}
            </div>
          </>)}
        </div>

        {/* 실행 */}
        {!running ? (
          <button onClick={start} style={{ padding: "16px", borderRadius: 14, border: "none", background: `linear-gradient(135deg,${C.accent},${C.cyan})`, color: "#fff", fontSize: 17, fontWeight: 900, cursor: "pointer", fontFamily: "inherit", boxShadow: `0 8px 20px ${C.glow}` }}>🚀 유입 시작</button>
        ) : (
          <button onClick={stop} style={{ padding: "16px", borderRadius: 14, border: `2px solid ${C.accent}`, background: C.panel2, color: C.accent, fontSize: 17, fontWeight: 900, cursor: "pointer", fontFamily: "inherit" }}>⏹️ 정지</button>
        )}
        {running && (
          <div style={{ height: 8, borderRadius: 5, background: C.panel2, overflow: "hidden", border: `1px solid ${C.line}` }}>
            <div style={{ height: "100%", width: `${progress}%`, background: `linear-gradient(90deg,${C.accent},${C.cyan})`, transition: "width .3s" }} />
          </div>
        )}
      </div>

      {/* ── 등급 사용표 + 한도 게이지 ── */}
      <div style={{ order: 5, background: C.panel, border: `1px solid ${C.line}`, borderRadius: 16, padding: 16, marginBottom: 14 }}>
        <div style={{ fontSize: 13.5, fontWeight: 800, marginBottom: 10 }}>📊 등급별 하루 유입 한도</div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 8 }}>
          {PLAN_ORDER.map((pk) => {
            const cfg = PLAN_CONFIG[pk]; const cur = pk === plan;
            return (
              <div key={pk} style={{ textAlign: "center", padding: "12px 6px", borderRadius: 12, border: `2px solid ${cur ? C.accent : C.line}`, background: cur ? C.glow : C.panel2 }}>
                <div style={{ fontSize: 12, fontWeight: 800, color: cur ? C.accent : C.sub }}>{cfg.label}</div>
                <div style={{ fontSize: 17, fontWeight: 900, marginTop: 4 }}>{cfg.dailyInflow.toLocaleString()}회</div>
                {cur && <div style={{ fontSize: 10, fontWeight: 800, color: C.accent, marginTop: 3 }}>내 등급</div>}
              </div>
            );
          })}
        </div>
        {!unlimited && (
          <div style={{ marginTop: 12 }}>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12.5, fontWeight: 700, color: C.sub, marginBottom: 5 }}>
              <span>오늘 사용</span><span><b style={{ color: C.accent }}>{used}</b> / {limit}회</span>
            </div>
            <div style={{ height: 9, borderRadius: 6, background: C.panel2, overflow: "hidden", border: `1px solid ${C.line}` }}>
              <div style={{ height: "100%", width: `${pct}%`, background: `linear-gradient(90deg,${C.accent},${C.cyan})`, transition: "width .3s" }} />
            </div>
          </div>
        )}
        <p style={{ margin: "10px 0 0", fontSize: 11, color: C.sub, fontWeight: 600 }}>※ 한도는 계정 안전 장치. 락 해제(무제한)는 관리자만.</p>
      </div>


      {/* ── KPI 카드 ── */}
      <div style={{ order: 6, display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(140px,1fr))", gap: 12, marginBottom: 14 }}>
        {[
          { k: "오늘 유입", v: `${used}`, sub: unlimited ? "무제한" : `/ ${limit}회`, col: C.accent },
          // 🛒 스토어는 순위 자동측정 미지원 → '현재 순위' 대신 '이번 성공'으로(죽은 순위 값 노출 방지)
          targetType === "store"
            ? { k: "이번 성공", v: `${sessOk}`, sub: "회", col: "#16a34a" }
            : { k: "현재 순위", v: apLastRank != null ? `${apLastRank}` : apRankOut ? "30+" : "—", sub: apEnabled ? `목표 ${apGoal}위` : "위", col: "#16a34a" },
          { k: chartDays >= 365 ? "전체 누적" : `최근 ${chartDays}일`, v: `${weekTotal}`, sub: "누적 방문", col: C.cyan },
          { k: "남은 한도", v: unlimited ? "∞" : `${Math.max(0, limit - used)}`, sub: unlimited ? "무제한" : "회", col: "#f59e0b" },
        ].map((kp) => (
          <div key={kp.k} style={{ background: C.kpiBg, border: `1px solid ${C.line}`, borderRadius: 16, padding: "14px 16px", boxShadow: `0 4px 14px ${C.glow}` }}>
            <div style={{ fontSize: 12, fontWeight: 800, color: C.sub, marginBottom: 6 }}>{kp.k}</div>
            <div style={{ display: "flex", alignItems: "baseline", gap: 5 }}>
              <span style={{ fontSize: 28, fontWeight: 900, color: kp.col, lineHeight: 1 }}>{kp.v}</span>
              <span style={{ fontSize: 12, fontWeight: 700, color: C.sub }}>{kp.sub}</span>
            </div>
          </div>
        ))}
      </div>

      {/* ── 📊 성과 리포트 (주간/월간, 이번 vs 지난 비교) ── */}
      {report && (()=>{
        const rankDelta = (report.rankPrev != null && report.rankNow != null) ? (report.rankPrev - report.rankNow) : null;
        const infDelta = report.inflowPrev > 0 ? Math.round(((report.inflowNow - report.inflowPrev) / report.inflowPrev) * 100) : null;
        const per = reportPeriod === "week" ? "주간" : "월간";
        const mx = Math.max(1, ...report.daily.map(d=>d.count));
        return (
        <div className="inflow-card inflow-result" style={{ order: 7, background: `linear-gradient(135deg,${C.glow},transparent)`, border: `2px solid ${C.accent}`, borderRadius: 18, padding: 18, marginBottom: 14 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14, flexWrap: "wrap" }}>
            <span style={{ fontSize: 17, fontWeight: 900 }}>📊 성과 리포트</span>
            <div style={{ display: "flex", gap: 4, background: C.panel2, borderRadius: 10, padding: 3 }}>
              {([["week","주간"],["month","월간"]] as const).map(([k,lb])=>(
                <button key={k} onClick={()=>setReportPeriod(k)} style={{ padding: "6px 16px", borderRadius: 8, border: "none", background: reportPeriod===k?C.accent:"transparent", color: reportPeriod===k?"#fff":C.sub, fontSize: 13.5, fontWeight: 800, cursor: "pointer", fontFamily: "inherit" }}>{lb}</button>
              ))}
            </div>
            <button onClick={downloadReportPdf} style={{ marginLeft: "auto", padding: "8px 16px", borderRadius: 10, border: `1.5px solid ${C.accent}`, background: C.panel, color: C.accent, fontSize: 13, fontWeight: 800, cursor: "pointer", fontFamily: "inherit" }}>📄 PDF로 저장 · 고객 제출용</button>
          </div>
          {/* 비교 KPI — 스토어는 순위 미측정이라 '현재 순위' 칸을 빼고 유입 지표만 보여줌 */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))", gap: 12, marginBottom: 14 }}>
            {targetType !== "store" && (
            <div style={{ background: C.panel, border: `1px solid ${C.line}`, borderRadius: 14, padding: "14px 16px" }}>
              <div style={{ fontSize: 12, fontWeight: 800, color: C.sub, marginBottom: 5 }}>현재 순위</div>
              <div style={{ fontSize: 28, fontWeight: 900, color: "#16a34a" }}>{report.rankNow!=null?`${report.rankNow}위`:"—"}</div>
              {rankDelta!=null && <div style={{ fontSize: 12.5, fontWeight: 800, color: rankDelta>0?"#16a34a":rankDelta<0?"#dc2626":C.sub, marginTop: 3 }}>{rankDelta>0?`▲ ${rankDelta}계단 상승 🎉`:rankDelta<0?`▼ ${-rankDelta}계단`:"변동 없음"}</div>}
            </div>
            )}
            <div style={{ background: C.panel, border: `1px solid ${C.line}`, borderRadius: 14, padding: "14px 16px" }}>
              <div style={{ fontSize: 12, fontWeight: 800, color: C.sub, marginBottom: 5 }}>{per} 유입</div>
              <div style={{ fontSize: 28, fontWeight: 900, color: C.accent }}>{report.inflowNow.toLocaleString()}<span style={{fontSize:14,color:C.sub}}> 명</span></div>
              {infDelta!=null && <div style={{ fontSize: 12.5, fontWeight: 800, color: infDelta>=0?"#16a34a":"#dc2626", marginTop: 3 }}>{infDelta>=0?`▲ ${infDelta}% 증가`:`▼ ${-infDelta}% 감소`}</div>}
            </div>
            <div style={{ background: C.panel, border: `1px solid ${C.line}`, borderRadius: 14, padding: "14px 16px" }}>
              <div style={{ fontSize: 12, fontWeight: 800, color: C.sub, marginBottom: 5 }}>지난 {per}</div>
              <div style={{ fontSize: 28, fontWeight: 900, color: C.sub }}>{report.inflowPrev.toLocaleString()}<span style={{fontSize:14}}> 명</span></div>
              <div style={{ fontSize: 11.5, fontWeight: 600, color: C.sub, marginTop: 3 }}>비교 기준</div>
            </div>
          </div>
          {/* 미니 막대 그래프 */}
          <div style={{ display: "flex", alignItems: "flex-end", gap: 3, height: 56 }}>
            {report.daily.map((d,i)=>(
              <div key={i} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 2 }}>
                <div title={`${d.label}: ${d.count}명`} style={{ width: "100%", height: `${Math.max(3,(d.count/mx)*42)}px`, background: `linear-gradient(180deg,${C.accent},${C.cyan})`, borderRadius: 3 }} />
                {reportPeriod==="week" && <span style={{ fontSize: 9, color: C.sub }}>{d.label}</span>}
              </div>
            ))}
          </div>
          {/* ✅ 체크포인트 */}
          <div style={{ marginTop: 14, padding: "12px 14px", borderRadius: 12, background: C.panel, border: `1px solid ${C.line}` }}>
            <div style={{ fontSize: 12.5, fontWeight: 800, color: C.sub, marginBottom: 6 }}>✅ 이번 {per} 체크포인트</div>
            {rankDelta!=null && rankDelta>0 && <div style={{ fontSize: 13.5, fontWeight: 700, marginTop: 3 }}>🎉 순위가 <b style={{color:"#16a34a"}}>{rankDelta}계단</b> 올랐어요!</div>}
            {infDelta!=null && infDelta>0 && <div style={{ fontSize: 13.5, fontWeight: 700, marginTop: 3 }}>📈 유입이 지난 {per}보다 <b style={{color:C.accent}}>{infDelta}%</b> 늘었어요.</div>}
            {(rankDelta==null && report.rankNow==null) && <div style={{ fontSize: 13, fontWeight: 600, color: C.sub, marginTop: 3 }}>순위는 오토파일럿·순위 측정을 켜면 자동으로 기록돼요.</div>}
            {(infDelta==null || infDelta<=0) && rankDelta==null && report.inflowNow>0 && <div style={{ fontSize: 13, fontWeight: 600, color: C.sub, marginTop: 3 }}>이번 {per} 유입 {report.inflowNow}명 — 꾸준히 쌓이고 있어요.</div>}
          </div>
        </div>
        );
      })()}

      {/* ── 🩺 플레이스 최적화 진단 (순위 오르려면 뭘 채워야 하나) ── */}
      {targetType === "place" && (
        <div className="inflow-card" style={{ order: 8, background: C.panel, border: "1.5px solid #14b8a6", borderRadius: 16, padding: 18, marginBottom: 14 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4, flexWrap: "wrap" }}>
            <span style={{ fontSize: 16, fontWeight: 900 }}>🩺 플레이스 최적화 진단</span>
            <button onClick={runDiagnose} disabled={diagLoading} style={{ marginLeft: "auto", padding: "9px 18px", borderRadius: 10, border: "none", background: `linear-gradient(135deg,${C.accent},${C.cyan})`, color: "#fff", fontSize: 13.5, fontWeight: 800, cursor: diagLoading?"default":"pointer", fontFamily: "inherit", opacity: diagLoading?0.6:1 }}>{diagLoading ? "진단 중…" : "🩺 내 플레이스 진단하기"}</button>
          </div>
          <p style={{ margin: "0 0 14px", fontSize: 12.5, color: C.sub, fontWeight: 600, lineHeight: 1.6 }}>순위는 트래픽만으로 오르지 않아요. 리뷰·정보·사진·소식·예약이 <b style={{color:C.ink}}>종합 점수</b>예요. 지금 내 플레이스의 부족한 곳을 찾아 처방해 드려요.</p>
          {diag ? (
            <div className="inflow-result">
              {/* 점수 게이지 */}
              <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 14 }}>
                <div style={{ fontSize: 40, fontWeight: 900, color: diag.score>=80?"#16a34a":diag.score>=60?"#f59e0b":"#dc2626" }}>{diag.score}<span style={{fontSize:18,color:C.sub}}>/100</span></div>
                <div style={{ flex: 1 }}>
                  <div style={{ height: 12, borderRadius: 7, background: C.panel2, overflow: "hidden", border: `1px solid ${C.line}` }}>
                    <div style={{ height: "100%", width: `${diag.score}%`, background: `linear-gradient(90deg,${diag.score>=80?"#16a34a":diag.score>=60?"#f59e0b":"#dc2626"},${C.cyan})`, transition: "width .5s" }} />
                  </div>
                  <div style={{ fontSize: 12.5, fontWeight: 700, color: C.sub, marginTop: 5 }}>{diag.score>=80?"최적화가 잘 돼 있어요 👍":diag.score>=60?"조금만 더 채우면 순위가 올라요":"부족한 항목이 많아요 — 아래부터 채우세요"}</div>
                </div>
              </div>
              {/* 항목별 체크리스트 */}
              <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
                {diag.items.map((it) => (
                  <div key={it.key} style={{ display: "flex", alignItems: "flex-start", gap: 10, padding: "10px 12px", borderRadius: 10, background: it.ok?C.panel2:"rgba(220,38,38,.06)", border: `1px solid ${it.ok?C.line:"#dc262633"}` }}>
                    <span style={{ fontSize: 16, flexShrink: 0 }}>{it.ok?"✅":"⚠️"}</span>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 13.5, fontWeight: 800 }}>{it.label} <span style={{ color: C.sub, fontWeight: 600 }}>· {it.value}</span></div>
                      {!it.ok && <div style={{ fontSize: 12.5, fontWeight: 600, color: "#dc2626", marginTop: 2, lineHeight: 1.5 }}>{it.tip}</div>}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : !diagLoading && (
            <div style={{ padding: "20px", textAlign: "center", color: C.sub, fontSize: 13, fontWeight: 600 }}>위 버튼을 눌러 내 플레이스가 순위 오르기에 뭐가 부족한지 확인하세요.</div>
          )}
        </div>
      )}

      {/* ── 💬 리뷰 감정분석 (손님이 뭘 좋아하고 뭘 불만하나) ── */}
      {targetType === "place" && (
        <div className="inflow-card" style={{ order: 9, background: C.panel, border: "1.5px solid #a855f7", borderRadius: 16, padding: 18, marginBottom: 14 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4, flexWrap: "wrap" }}>
            <span style={{ fontSize: 16, fontWeight: 900 }}>💬 리뷰 감정분석</span>
            <button onClick={runReviewAnalysis} disabled={revLoading} style={{ marginLeft: "auto", padding: "9px 18px", borderRadius: 10, border: "none", background: `linear-gradient(135deg,#8b5cf6,#ec4899)`, color: "#fff", fontSize: 13.5, fontWeight: 800, cursor: revLoading?"default":"pointer", fontFamily: "inherit", opacity: revLoading?0.6:1 }}>{revLoading ? "분석 중…" : "💬 손님 마음 읽기"}</button>
          </div>
          <p style={{ margin: "0 0 14px", fontSize: 12.5, color: C.sub, fontWeight: 600, lineHeight: 1.6 }}>손님 리뷰를 읽어 <b style={{color:C.ink}}>뭘 좋아하고 뭘 불만하는지</b> 알려드려요. 칭찬은 소식·홍보에 쓰고, 불만은 바로 개선하세요.</p>
          {revResult ? (
            <div className="inflow-result">
              <div style={{ fontSize: 12.5, fontWeight: 700, color: C.sub, marginBottom: 10 }}>리뷰 {revResult.total}개 분석</div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))", gap: 12 }}>
                <div style={{ background: "rgba(22,163,74,.07)", border: "1px solid #16a34a33", borderRadius: 12, padding: 14 }}>
                  <div style={{ fontSize: 13.5, fontWeight: 900, color: "#16a34a", marginBottom: 8 }}>👍 손님이 좋아하는 것</div>
                  {revResult.likes.length ? revResult.likes.map(l => (
                    <div key={l.word} style={{ display: "flex", justifyContent: "space-between", fontSize: 13, fontWeight: 700, padding: "3px 0" }}><span>{l.word}</span><span style={{ color: "#16a34a" }}>{l.n}회</span></div>
                  )) : <div style={{ fontSize: 12.5, color: C.sub }}>뚜렷한 칭찬 키워드가 적어요.</div>}
                </div>
                <div style={{ background: "rgba(220,38,38,.06)", border: "1px solid #dc262633", borderRadius: 12, padding: 14 }}>
                  <div style={{ fontSize: 13.5, fontWeight: 900, color: "#dc2626", marginBottom: 8 }}>⚠️ 개선하면 좋을 것</div>
                  {revResult.dislikes.length ? revResult.dislikes.map(l => (
                    <div key={l.word} style={{ display: "flex", justifyContent: "space-between", fontSize: 13, fontWeight: 700, padding: "3px 0" }}><span>{l.word}</span><span style={{ color: "#dc2626" }}>{l.n}회</span></div>
                  )) : <div style={{ fontSize: 12.5, color: C.sub }}>불만 표현이 거의 없어요 — 아주 좋아요! 🎉</div>}
                </div>
              </div>
              {revResult.likes[0] && <p style={{ margin: "12px 0 0", fontSize: 12.5, color: C.sub, fontWeight: 600, lineHeight: 1.5 }}>💡 <b style={{color:C.ink}}>"{revResult.likes[0].word}"</b>을(를) 가장 많이 칭찬해요 — 이 강점을 소식·대표 사진·홍보 문구에 내세우세요.</p>}
            </div>
          ) : !revLoading && (
            <div style={{ padding: "20px", textAlign: "center", color: C.sub, fontSize: 13, fontWeight: 600 }}>버튼을 눌러 손님들이 뭘 좋아하고 뭘 아쉬워하는지 확인하세요.</div>
          )}
        </div>
      )}

      {/* ── 🥊 경쟁사 추적 (내 키워드 상위 경쟁사 vs 나) ── */}
      {targetType === "place" && (
        <div className="inflow-card" style={{ order: 10, background: C.panel, border: "1.5px solid #f59e0b", borderRadius: 16, padding: 18, marginBottom: 14 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4, flexWrap: "wrap" }}>
            <span style={{ fontSize: 16, fontWeight: 900 }}>🥊 경쟁사 추적</span>
            <button onClick={runCompetitors} disabled={compLoading} style={{ marginLeft: "auto", padding: "9px 18px", borderRadius: 10, border: "none", background: `linear-gradient(135deg,#f59e0b,#f97316)`, color: "#fff", fontSize: 13.5, fontWeight: 800, cursor: compLoading?"default":"pointer", fontFamily: "inherit", opacity: compLoading?0.6:1 }}>{compLoading ? "조회 중…" : "🥊 옆집 확인하기"}</button>
          </div>
          <p style={{ margin: "0 0 14px", fontSize: 12.5, color: C.sub, fontWeight: 600, lineHeight: 1.6 }}>내 대표 키워드로 검색했을 때 <b style={{color:C.ink}}>위에 뜨는 경쟁사</b>들의 리뷰 수를 비교해요. 옆집이 뭘로 앞서는지 보고 따라잡으세요.</p>
          {comp ? (
            <div className="inflow-result">
              {comp.myRank && <div style={{ marginBottom: 10, padding: "10px 14px", borderRadius: 10, background: C.glow, border: `1px solid ${C.accent}`, fontSize: 13.5, fontWeight: 800, color: C.accent }}>내 매장은 현재 이 키워드에서 <b>{comp.myRank}위</b> 근처예요.</div>}
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {comp.top.map((c) => (
                  <div key={c.rank} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 12px", borderRadius: 10, background: c.isMine?C.glow:C.panel2, border: `1px solid ${c.isMine?C.accent:C.line}` }}>
                    <span style={{ fontSize: 15, fontWeight: 900, color: c.rank<=3?"#f59e0b":C.sub, minWidth: 28 }}>{c.rank}위</span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13.5, fontWeight: 800, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{c.name} {c.isMine && <span style={{color:C.accent}}>· 내 매장</span>}</div>
                      <div style={{ fontSize: 11.5, color: C.sub, fontWeight: 600 }}>{c.category}</div>
                    </div>
                    <div style={{ textAlign: "right", fontSize: 12, fontWeight: 700, color: C.sub, whiteSpace: "nowrap" }}>
                      방문자리뷰 <b style={{color:C.ink}}>{c.review.toLocaleString()}</b> · 블로그리뷰 <b style={{color:C.ink}}>{c.blog.toLocaleString()}</b>
                    </div>
                  </div>
                ))}
              </div>
              <p style={{ margin: "10px 0 0", fontSize: 11.5, color: C.sub, fontWeight: 600, lineHeight: 1.5 }}>※ 상위 경쟁사보다 리뷰가 적으면, 방문 손님 리뷰·블로그 리뷰를 늘리는 게 순위에 가장 효과적이에요.</p>
            </div>
          ) : !compLoading && (
            <div style={{ padding: "20px", textAlign: "center", color: C.sub, fontSize: 13, fontWeight: 600 }}>키워드를 넣고 버튼을 누르면 상위 경쟁사와 내 위치를 비교해요.</div>
          )}
        </div>
      )}

      {/* ── 📘 블로그 진단 (blog 전용) — 순위 오르려면 뭘 채워야 하나. crawlBlogStats 재사용 ── */}
      {targetType === "blog" && (
        <div className="inflow-card" style={{ order: 8, background: C.panel, border: "1.5px solid #3b82f6", borderRadius: 16, padding: 18, marginBottom: 14 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4, flexWrap: "wrap" }}>
            <span style={{ fontSize: 16, fontWeight: 900 }}>📘 블로그 진단</span>
            <button onClick={runBlogDiagnose} disabled={blogDiagLoading} style={{ marginLeft: "auto", padding: "9px 18px", borderRadius: 10, border: "none", background: `linear-gradient(135deg,#3b82f6,${C.cyan})`, color: "#fff", fontSize: 13.5, fontWeight: 800, cursor: blogDiagLoading ? "default" : "pointer", fontFamily: "inherit", opacity: blogDiagLoading ? 0.6 : 1 }}>{blogDiagLoading ? "진단 중…" : "📘 내 블로그 진단하기"}</button>
          </div>
          <p style={{ margin: "0 0 12px", fontSize: 12.5, color: C.sub, fontWeight: 600, lineHeight: 1.6 }}>블로그 순위는 <b style={{ color: C.ink }}>방문자·발행 활성도·이웃·글 품질</b>이 종합 점수예요. 지금 내 블로그 상태를 진단해 부족한 곳을 알려드려요. <span style={{ color: "#3b82f6" }}>(연결한 계정으로 로그인 진단)</span></p>
          {/* 계정 선택(여러 개면) */}
          {accounts.length > 1 && (
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 10 }}>
              {accounts.map((a) => { const on = (blogDiagAcctId || accounts[0]?.id) === a.id; return (
                <button key={a.id} onClick={() => setBlogDiagAcctId(a.id)} style={{ padding: "6px 12px", borderRadius: 8, border: `1.5px solid ${on ? "#3b82f6" : C.line2}`, background: on ? C.glow : C.panel2, color: on ? "#3b82f6" : C.sub, fontSize: 12, fontWeight: 800, cursor: "pointer", fontFamily: "inherit" }}>{on ? "✓ " : ""}{a.blog_name || a.username}</button>
              ); })}
            </div>
          )}
          {blogDiag ? (()=>{ const s = blogDiag; const vlast = Array.isArray(s.visitorDays) && s.visitorDays.length ? s.visitorDays[s.visitorDays.length - 1].visitors : null; const act = s.activity; const actCol = act?.level === "active" ? "#16a34a" : act?.level === "inactive" ? "#dc2626" : "#f59e0b"; const actTxt = act?.level === "active" ? "활발 👍" : act?.level === "inactive" ? "비활성 ⚠️" : "보통"; return (
            <div className="inflow-result">
              {/* KPI 4 */}
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(130px,1fr))", gap: 10, marginBottom: 12 }}>
                {[
                  { k: "최근 방문자", v: vlast != null ? `${vlast}` : "—", sub: "명/일", col: "#3b82f6" },
                  { k: "총 글 수", v: `${s.totalPosts ?? "—"}`, sub: "개", col: C.ink },
                  { k: "이웃 수", v: `${s.neighbors ?? "—"}`, sub: "명", col: C.cyan },
                  { k: "발행 활성도", v: actTxt, sub: act?.daysSinceLast != null ? `최근 ${act.daysSinceLast}일 전` : "", col: actCol },
                ].map((kp) => (
                  <div key={kp.k} style={{ background: C.panel2, border: `1px solid ${C.line}`, borderRadius: 12, padding: "12px 14px" }}>
                    <div style={{ fontSize: 11.5, fontWeight: 800, color: C.sub, marginBottom: 5 }}>{kp.k}</div>
                    <div style={{ display: "flex", alignItems: "baseline", gap: 4 }}>
                      <span style={{ fontSize: 20, fontWeight: 900, color: kp.col }}>{kp.v}</span>
                      <span style={{ fontSize: 11, fontWeight: 700, color: C.sub }}>{kp.sub}</span>
                    </div>
                  </div>
                ))}
              </div>
              {/* 발행 활성도 처방 */}
              {act?.message && <div style={{ fontSize: 13, fontWeight: 700, padding: "10px 12px", borderRadius: 10, background: C.panel2, border: `1px solid ${C.line}`, marginBottom: 8, lineHeight: 1.5 }}>📌 {act.message}</div>}
              {/* 저품질 의심 */}
              {s.lowQualitySuspected === true && <div style={{ fontSize: 13, fontWeight: 800, padding: "10px 12px", borderRadius: 10, background: "rgba(220,38,38,.06)", border: "1px solid #dc262633", color: "#dc2626", marginBottom: 8, lineHeight: 1.5 }}>⚠️ 저품질(누락) 의심 — 검색 노출이 약해요. 글 품질·발행 주기를 점검하세요.</div>}
              {/* 방문자 급감 */}
              {s.visitorDrop?.detected && <div style={{ fontSize: 13, fontWeight: 700, padding: "10px 12px", borderRadius: 10, background: "rgba(245,158,11,.08)", border: "1px solid #f59e0b33", color: "#b45309", marginBottom: 8, lineHeight: 1.5 }}>📉 {s.visitorDrop.message}</div>}
              {/* 유입 키워드 */}
              {Array.isArray(s.inflowKeywords) && s.inflowKeywords.length > 0 && (
                <div>
                  <div style={{ fontSize: 12.5, fontWeight: 800, color: C.sub, margin: "6px 0 7px" }}>🔑 방문자가 검색해 들어온 키워드</div>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                    {s.inflowKeywords.slice(0, 12).map((k: any, i: number) => (
                      <span key={i} style={{ fontSize: 12, fontWeight: 700, padding: "5px 11px", borderRadius: 99, background: C.glow, color: "#3b82f6", border: `1px solid ${C.line}` }}>{k.keyword}{k.count ? ` ${k.count}` : ""}</span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ); })() : !blogDiagLoading && (
            <div style={{ padding: "20px", textAlign: "center", color: C.sub, fontSize: 13, fontWeight: 600 }}>위 버튼을 눌러 내 블로그가 순위 오르기에 뭐가 부족한지 확인하세요.</div>
          )}
        </div>
      )}

      {/* ── 🛒 스토어 상품 진단 (store 전용) — 리뷰·찜·평점·가격 ── */}
      {targetType === "store" && (
        <div className="inflow-card" style={{ order: 8, background: C.panel, border: "1.5px solid #10b981", borderRadius: 16, padding: 18, marginBottom: 14 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4, flexWrap: "wrap" }}>
            <span style={{ fontSize: 16, fontWeight: 900 }}>🛒 상품 진단</span>
            <button onClick={runStoreDiagnose} disabled={storeInfoLoading} style={{ marginLeft: "auto", padding: "9px 18px", borderRadius: 10, border: "none", background: "linear-gradient(135deg,#10b981,#059669)", color: "#fff", fontSize: 13.5, fontWeight: 800, cursor: storeInfoLoading ? "default" : "pointer", fontFamily: "inherit", opacity: storeInfoLoading ? 0.6 : 1 }}>{storeInfoLoading ? "진단 중…" : "🛒 내 상품 진단하기"}</button>
          </div>
          <p style={{ margin: "0 0 12px", fontSize: 12.5, color: C.sub, fontWeight: 600, lineHeight: 1.6 }}>상품 노출은 <b style={{ color: C.ink }}>리뷰·찜·유입</b>이 함께 밀어줘요. 지금 내 상품의 리뷰·찜·평점을 확인하고, 유입으로 노출을 키우세요. <span style={{ color: "#059669" }}>(리뷰·찜 자동생성은 밴 위험이라 미지원 — 유입만 안전)</span></p>
          {storeInfo ? (()=>{ const s = storeInfo; return (
            <div className="inflow-result">
              {s.name && <div style={{ fontSize: 13.5, fontWeight: 800, color: C.ink, marginBottom: 10, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>📦 {s.name}</div>}
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(120px,1fr))", gap: 10 }}>
                {[
                  { k: "리뷰 수", v: s.reviewCount != null ? `${s.reviewCount.toLocaleString()}` : "—", sub: "개", col: "#10b981" },
                  { k: "찜(관심)", v: s.wishCount != null ? `${s.wishCount.toLocaleString()}` : "—", sub: "명", col: "#ec4899" },
                  { k: "평점", v: s.rating != null ? `${s.rating}` : "—", sub: "/5", col: "#f59e0b" },
                  { k: "판매가", v: s.price ? `${s.price.toLocaleString()}` : "—", sub: "원", col: C.ink },
                ].map((kp) => (
                  <div key={kp.k} style={{ background: C.panel2, border: `1px solid ${C.line}`, borderRadius: 12, padding: "12px 14px" }}>
                    <div style={{ fontSize: 11.5, fontWeight: 800, color: C.sub, marginBottom: 5 }}>{kp.k}</div>
                    <div style={{ display: "flex", alignItems: "baseline", gap: 4 }}>
                      <span style={{ fontSize: 19, fontWeight: 900, color: kp.col }}>{kp.v}</span>
                      <span style={{ fontSize: 11, fontWeight: 700, color: C.sub }}>{kp.sub}</span>
                    </div>
                  </div>
                ))}
              </div>
              <p style={{ margin: "10px 0 0", fontSize: 11.5, color: C.sub, fontWeight: 600, lineHeight: 1.5 }}>💡 경쟁 상품보다 리뷰·찜이 적으면 유입(클릭·체류)으로 노출 기회를 늘리고, 리뷰는 실제 구매 고객에게 유도하세요.</p>
              {/* 🔤 상품명 SEO 진단 — 내가 노리는 키워드가 상품명에 담겼는지(검색 노출의 기본). 안 막히는 정공법. */}
              {s.name && keywords.trim() && (()=>{
                const kws = keywords.split(/[,\n]/).map(k => k.trim()).filter(Boolean);
                const nmeLC = s.name.toLowerCase();
                const hit = kws.filter(k => nmeLC.includes(k.toLowerCase()));
                const miss = kws.filter(k => !nmeLC.includes(k.toLowerCase()));
                const nameLen = s.name.length;
                return (
                  <div style={{ marginTop: 12, padding: "11px 13px", borderRadius: 12, background: C.panel2, border: `1px solid ${C.line}` }}>
                    <div style={{ fontSize: 12.5, fontWeight: 800, color: C.ink, marginBottom: 7 }}>🔤 상품명 SEO 진단 <span style={{ fontSize: 11, color: C.sub, fontWeight: 600 }}>· 검색 노출의 기본</span></div>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 8 }}>
                      {hit.map(k => <span key={k} style={{ fontSize: 11.5, fontWeight: 800, color: "#059669", background: "rgba(16,185,129,.12)", borderRadius: 99, padding: "3px 10px" }}>✓ {k}</span>)}
                      {miss.map(k => <span key={k} style={{ fontSize: 11.5, fontWeight: 800, color: "#dc2626", background: "rgba(220,38,38,.1)", borderRadius: 99, padding: "3px 10px" }}>✗ {k}</span>)}
                    </div>
                    <div style={{ fontSize: 11.5, color: C.sub, fontWeight: 600, lineHeight: 1.6 }}>
                      {miss.length === 0
                        ? <>✅ 노리는 키워드가 상품명에 모두 들어있어요. 이제 <b style={{ color: C.ink }}>유입(클릭·체류)</b>으로 순위를 밀어주세요.</>
                        : <>⚠️ <b style={{ color: "#dc2626" }}>{miss.join(", ")}</b> 이(가) 상품명에 없어요. 스마트스토어 상품명에 자연스럽게 넣으면 검색 노출이 올라가요.</>}
                      {nameLen > 50 && <><br/>ℹ️ 상품명이 길어요({nameLen}자). 너무 길면 핵심 키워드가 묻혀요 — 50자 안쪽 권장.</>}
                    </div>
                  </div>
                );
              })()}
            </div>
          ); })() : !storeInfoLoading && (
            <div style={{ padding: "20px", textAlign: "center", color: C.sub, fontSize: 13, fontWeight: 600 }}>위 상품 주소를 넣고 버튼을 누르면 리뷰·찜·평점·가격을 확인해요.</div>
          )}
        </div>
      )}

      {/* 📅 기간 선택 — 유입·순위·누적을 원하는 기간으로(과거 기록까지). 플레이스·블로그 공통 */}
      <div style={{ order: 10, display: "flex", alignItems: "center", gap: 8, marginBottom: 8, flexWrap: "wrap" }}>
        <span style={{ fontSize: 12.5, fontWeight: 800, color: C.sub }}>📅 기간</span>
        {([[7, "7일"], [30, "30일"], [90, "90일"], [365, "전체"]] as const).map(([d, lb]) => (
          <button key={d} onClick={() => { setChartDays(d); toast(`📅 ${lb} 데이터로 봐요`, "success"); }} style={{ padding: "6px 14px", borderRadius: 8, border: `1.5px solid ${chartDays === d ? C.accent : C.line2}`, background: chartDays === d ? C.glow : C.panel2, color: chartDays === d ? C.accent : C.sub, fontSize: 12.5, fontWeight: 800, cursor: "pointer", fontFamily: "inherit" }}>{chartDays === d ? "✓ " : ""}{lb}</button>
        ))}
        <span style={{ fontSize: 11, color: C.sub, fontWeight: 600, marginLeft: 4 }}>과거 기록까지 조회 · 앱을 껐다 켜도 유지돼요</span>
      </div>

      {/* ── 그래프 2단: 유입 추이 + 순위 변동 ── */}
      <div style={{ order: 11, display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(280px,1fr))", gap: 12, marginBottom: 14 }}>
      <div style={{ background: C.panel, border: `1px solid ${C.line}`, borderRadius: 16, padding: "14px 16px 8px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
          <span style={{ fontSize: 13.5, fontWeight: 800 }}>📈 {chartDays >= 365 ? "전체" : `최근 ${chartDays}일`} 유입 추이</span>
          <span style={{ fontSize: 11.5, fontWeight: 700, color: C.sub }}>총 {weekTotal}회</span>
        </div>
        {history.length > 0 ? <AreaChart data={history} C={C} /> : <div style={{ height: 120, display: "flex", alignItems: "center", justifyContent: "center", color: C.sub, fontSize: 12.5, fontWeight: 600 }}>데이터가 쌓이면 그래프가 그려져요</div>}
        {chartDays <= 31 && <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, color: C.sub, fontWeight: 700, padding: "0 2px" }}>
          {history.map((d) => <span key={d.label}>{d.label}</span>)}
        </div>}
      </div>
      {/* 순위 변동 — 스토어는 순위 자동측정 미지원이라 그래프 대신 안내 */}
      <div style={{ background: C.panel, border: `1px solid ${C.line}`, borderRadius: 16, padding: "14px 16px 8px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
          <span style={{ fontSize: 13.5, fontWeight: 800 }}>📉 순위 변동 <span style={{ color: C.sub, fontWeight: 600, fontSize: 11 }}>(위=상위)</span></span>
          {apEnabled && targetType !== "store" && <span style={{ fontSize: 11.5, fontWeight: 800, color: C.cyan }}>목표 {apGoal}위 ---</span>}
        </div>
        {targetType === "store" ? (
          <div style={{ height: 120, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 6, color: C.sub, fontSize: 12.5, fontWeight: 600, textAlign: "center", lineHeight: 1.6 }}>
            <span style={{ fontSize: 22 }}>🛒</span>
            스마트스토어는 순위 자동측정을 지원하지 않아요.<br />유입·체류 신호로 상품 노출을 높이는 데 집중해요.
          </div>
        ) : (<>
        <RankChart data={rankHist} goal={apGoal} C={C} />
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, color: C.sub, fontWeight: 700, padding: "0 2px" }}>
          {rankHist.map((d) => <span key={d.label}>{d.label}</span>)}
        </div>
        </>)}
      </div>
      </div>

      {/* ── 🎯 오토파일럿 (플레이스+블로그) ── */}
      {(targetType === "place" || targetType === "blog") && (<div className="inflow-card" style={{ order: 12, background: apEnabled ? `linear-gradient(135deg,${C.glow},transparent)` : C.panel, border: `2px solid ${apEnabled ? C.accent : "#3b82f6"}`, borderRadius: 16, padding: 16, marginBottom: 14 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: apEnabled || true ? 12 : 0, flexWrap: "wrap" }}>
          <span style={{ fontSize: 15, fontWeight: 900 }}>🎯 순위 오토파일럿</span>
          <span style={{ fontSize: 10, fontWeight: 800, background: apEnabled ? "#16a34a" : C.sub, color: "#fff", padding: "2px 8px", borderRadius: 6 }}>{apEnabled ? "가동 중" : "꺼짐"}</span>
          <span style={{ fontSize: 12, color: C.sub, fontWeight: 600, flex: 1, minWidth: 180 }}>목표 순위만 정해두면, <b style={{color:C.ink}}>예약을 안 켜도</b> 앱이 켜져 있는 동안 하루 1회 스스로 순위를 재고, 떨어졌으면 자동으로 유입을 채워 지켜줘요.</span>
        </div>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end" }}>
          <div style={{ flex: 2, minWidth: 180 }}>
            <label style={labelStyle}>추적 키워드</label>
            <input value={apKeyword} onChange={(e) => setApKeyword(e.target.value)} placeholder="순위를 지킬 대표 키워드" style={inputStyle} />
          </div>
          <div style={{ flex: 1, minWidth: 110 }}>
            <label style={labelStyle}>목표 순위</label>
            <input type="number" min={1} value={apGoal} onChange={(e) => setApGoal(Math.max(1, Number(e.target.value)))} style={{ ...inputStyle, textAlign: "center" }} />
          </div>
          <button onClick={runMeasureRank} disabled={rankLoading} style={{ padding: "13px 18px", borderRadius: 12, border: `1.5px solid ${C.accent}`, background: C.panel2, color: C.accent, fontSize: 14, fontWeight: 800, cursor: rankLoading?"default":"pointer", fontFamily: "inherit", whiteSpace: "nowrap", opacity: rankLoading?0.6:1 }}>{rankLoading ? "측정 중…" : "📍 지금 순위 측정"}</button>
          <button onClick={() => saveAp(!apEnabled)} style={{ padding: "13px 20px", borderRadius: 12, border: apEnabled ? `2px solid ${C.accent}` : "none", background: apEnabled ? C.panel2 : `linear-gradient(135deg,${C.accent},${C.cyan})`, color: apEnabled ? C.accent : "#fff", fontSize: 15, fontWeight: 900, cursor: "pointer", fontFamily: "inherit", whiteSpace: "nowrap" }}>{apEnabled ? "끄기" : "🎯 켜기"}</button>
        </div>
        <p style={{ margin: "10px 0 0", fontSize: 11, color: C.sub, fontWeight: 600, lineHeight: 1.5 }}>※ 위 실행 패널의 대상(<b style={{color:C.ink}}>플레이스·블로그</b> 주소)을 기준으로 추적해요. <b style={{color:C.ink}}>📍 지금 순위 측정</b>을 누르면 현재 순위를 기록해 리포트·그래프에 반영돼요. 켜두면 <b style={{color:C.ink}}>예약과 상관없이</b> 하루 1회 자동으로 순위를 재서 — 달성했으면 유입을 줄여 한도를 아끼고, 떨어졌으면 다시 밀어 올려요. (순위 측정이 실패한 날은 잘못된 판단을 막으려 유입을 보류해요. 스토어(쇼핑)는 순위 자동측정 미지원.)</p>
      </div>)}

      {/* ── ⏰ 예약 실행 ── */}
      <div className="inflow-card" style={{ order: 13, background: schedEnabled ? `linear-gradient(135deg,${C.glow},transparent)` : C.panel, border: `2px solid ${schedEnabled ? C.accent : "#06b6d4"}`, borderRadius: 16, padding: 16, marginBottom: 14 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12, flexWrap: "wrap" }}>
          <span style={{ fontSize: 15, fontWeight: 900 }}>⏰ 예약 실행</span>
          <span style={{ fontSize: 10, fontWeight: 800, background: schedEnabled ? "#16a34a" : C.sub, color: "#fff", padding: "2px 8px", borderRadius: 6 }}>{schedEnabled ? "예약됨" : "꺼짐"}</span>
          <span style={{ fontSize: 12, color: C.sub, fontWeight: 600, flex: 1, minWidth: 180 }}>매일 지정 시각에 위 설정으로 자동 유입해요(앱이 켜져 있을 때).</span>
        </div>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end" }}>
          <div style={{ flex: "1 1 190px", minWidth: 190 }}>
            <label style={labelStyle}>매일 실행 시각</label>
            <input type="time" value={schedTime} onChange={(e) => setSchedTime(e.target.value)} style={{ ...inputStyle, textAlign: "center", minWidth: 0, width: "100%" }} />
          </div>
          <div style={{ flex: "0 1 120px", minWidth: 100 }}>
            <label style={labelStyle}>방문 횟수</label>
            <input type="number" min={1} value={schedRounds} onChange={(e) => setSchedRounds(Math.max(1, Number(e.target.value)))} style={{ ...inputStyle, textAlign: "center", minWidth: 0, width: "100%" }} />
          </div>
          <button onClick={() => saveSched(!schedEnabled)} style={{ padding: "13px 20px", borderRadius: 12, border: schedEnabled ? `2px solid ${C.accent}` : "none", background: schedEnabled ? C.panel2 : `linear-gradient(135deg,${C.accent},${C.cyan})`, color: schedEnabled ? C.accent : "#fff", fontSize: 15, fontWeight: 900, cursor: "pointer", fontFamily: "inherit", whiteSpace: "nowrap" }}>{schedEnabled ? "예약 해제" : "⏰ 예약"}</button>
        </div>
      </div>

      {/* ── 라이브 로그 ── */}
      <div style={{ order: 14 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
          <span style={{ fontSize: 13.5, fontWeight: 800 }}>📜 전체 진행 로그</span>
          <div style={{ display: "flex", gap: 6 }}>
            <button onClick={() => setLogZoom(true)} disabled={!logs.length} style={{ padding: "7px 14px", borderRadius: 9, border: `1.5px solid ${C.line2}`, background: C.panel, color: logs.length ? C.accent : C.sub, fontSize: 13, fontWeight: 800, cursor: logs.length ? "pointer" : "default", fontFamily: "inherit" }}>🔍 크게 보기</button>
            <button onClick={copyLogs} disabled={!logs.length} style={{ padding: "7px 14px", borderRadius: 9, border: `1.5px solid ${C.line2}`, background: C.panel, color: logs.length ? C.accent : C.sub, fontSize: 13, fontWeight: 800, cursor: logs.length ? "pointer" : "default", fontFamily: "inherit" }}>📋 로그 전체복사</button>
          </div>
        </div>
        <div ref={logBoxRef} style={{ background: C.logBg, color: C.logInk, borderRadius: 14, padding: "16px 18px", height: 520, overflowY: "auto", fontSize: 15, lineHeight: 1.8, fontFamily: "'SF Mono','D2Coding',ui-monospace,monospace", whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
          {logs.length ? logs.map((entry, i) => entry.type === "text"
            ? <div key={i}>{entry.text}</div>
            : <div key={i} style={{ margin: "8px 0 12px" }}>
                <div style={{ marginBottom: 5, fontWeight: 800 }}>📸 {entry.caption}</div>
                <img src={entry.dataUrl} alt={entry.caption} style={{ display: "block", width: "min(280px,100%)", maxHeight: 190, objectFit: "contain", borderRadius: 9, border: "1px solid rgba(255,255,255,.18)" }} />
              </div>
          ) : <div style={{ opacity: 0.5 }}>여기에 검색 → 진입 → 체류 → 액션 전 과정이 실시간으로 표시돼요.</div>}
        </div>
      </div>

      {/* 🔍 로그 크게 보기 — 앱 내 모달(별도 창 아님) */}
      {logZoom && (
        <div onClick={(e) => { if (e.target === e.currentTarget) setLogZoom(false); }}
          style={{ position: "fixed", inset: 0, zIndex: 1000, background: "rgba(10,7,19,.78)", display: "flex", alignItems: "center", justifyContent: "center", padding: 30 }}>
          <div style={{ width: "100%", maxWidth: 1000, height: "86vh", background: C.logBg, borderRadius: 16, display: "flex", flexDirection: "column", overflow: "hidden", boxShadow: "0 30px 80px rgba(0,0,0,.5)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "14px 18px", borderBottom: `1px solid ${C.line2}` }}>
              <b style={{ color: C.logInk, fontSize: 15 }}>📜 실시간 로그 — 크게 보기</b>
              <div style={{ display: "flex", gap: 8 }}>
                <button onClick={copyLogs} disabled={!logs.length} style={{ padding: "7px 16px", borderRadius: 9, border: "none", background: C.panel, color: C.accent, fontWeight: 800, cursor: "pointer", fontFamily: "inherit" }}>📋 복사</button>
                <button onClick={() => setLogZoom(false)} style={{ padding: "7px 16px", borderRadius: 9, border: "none", background: C.accent, color: "#fff", fontWeight: 800, cursor: "pointer", fontFamily: "inherit" }}>닫기</button>
              </div>
            </div>
            <div style={{ flex: 1, overflowY: "auto", padding: "18px 22px", color: C.logInk, fontFamily: "'SF Mono','D2Coding',ui-monospace,monospace", fontSize: 15, lineHeight: 1.85, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
              {logs.length ? logs.map((entry, i) => entry.type === "text"
                ? <div key={i}>{entry.text}</div>
                : <div key={i} style={{ margin: "8px 0 12px" }}>
                    <div style={{ marginBottom: 5, fontWeight: 800 }}>📸 {entry.caption}</div>
                    <img src={entry.dataUrl} alt={entry.caption} style={{ display: "block", width: "min(420px,100%)", maxHeight: 280, objectFit: "contain", borderRadius: 9, border: "1px solid rgba(255,255,255,.18)" }} />
                  </div>
              ) : <div style={{ opacity: 0.5 }}>아직 로그가 없어요.</div>}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
