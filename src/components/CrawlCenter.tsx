import { useState, useRef, useEffect } from "react";
import { createPortal } from "react-dom";
import { BotEventStream, botFetch } from "../lib/botApi";
import { PLAN_CONFIG, CRAWL_DAILY_LIMIT, EMAIL_DAILY_LIMIT, COMMENT_DAILY_LIMIT, getCrawlDailyUsage, incrementCrawlQuota, getEmailDailyUsage, incrementEmailQuota, pushLiveLog } from "../lib/supabase";
import { takePlaceBloggerCandidates } from "../lib/discoveryBridge";
import UsageGuide from "./UsageGuide";
import boriImg from "../assets/bori.png";
import dodoImg from "../assets/dodo.png";
import monggeulImg from "../assets/monggeul.png";
import pumiImg from "../assets/pumi.png";

const BOT = "http://127.0.0.1:3334";   // neighbor-bot (발굴·발송)

/* ── 커스텀 라인 아이콘(이모지 대신 — 색다르고 담백하게). 24 viewBox, currentColor stroke ── */
const Ico = ({ d, s = 20, sw = 1.6, fill = "none", extra }: { d: string; s?: number; sw?: number; fill?: string; extra?: React.ReactNode }) => (
  <svg width={s} height={s} viewBox="0 0 24 24" fill={fill} stroke="currentColor" strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round">
    <path d={d} />{extra}
  </svg>
);
// 단계별 아이콘 path (발굴=레이더 / 연락처=명함 / 보냄=종이비행기 / 회신=되돌림 화살표 / 배송=상자 / 완료=깃발)
const IC_RADAR = ({ s = 20, col = "currentColor" }) => <span style={{ color: col, display: "inline-flex" }}><Ico s={s} d="M12 12 4.2 6.8" extra={<><circle cx="12" cy="12" r="9" /><circle cx="12" cy="12" r="4.5" /><circle cx="12" cy="12" r="1" fill="currentColor" stroke="none" /></>} /></span>;
const IC_CARD  = ({ s = 20, col = "currentColor" }) => <span style={{ color: col, display: "inline-flex" }}><Ico s={s} d="M7 15h4M15 10.5h2M15 13.5h2" extra={<><rect x="3" y="5.5" width="18" height="13" rx="2" /><circle cx="9" cy="11" r="2" /></>} /></span>;
const IC_PLANE = ({ s = 20, col = "currentColor" }) => <span style={{ color: col, display: "inline-flex" }}><Ico s={s} d="M21 3 10.5 13.5M21 3l-7 18-4-7.5L2.5 9.5 21 3Z" /></span>;
const IC_REPLY = ({ s = 20, col = "currentColor" }) => <span style={{ color: col, display: "inline-flex" }}><Ico s={s} d="M9 7 4 12l5 5M4 12h11a5 5 0 0 1 5 5v1" /></span>;
const IC_BOX   = ({ s = 20, col = "currentColor" }) => <span style={{ color: col, display: "inline-flex" }}><Ico s={s} d="M3.5 7.5 12 3l8.5 4.5v9L12 21l-8.5-4.5v-9ZM3.5 7.5 12 12m0 0 8.5-4.5M12 12v9" /></span>;
const IC_FLAG  = ({ s = 20, col = "currentColor" }) => <span style={{ color: col, display: "inline-flex" }}><Ico s={s} d="M5 21V4M5 4c3-2 6 2 9 0s5-1 5-1v9s-2 1-5 1-6-2-9 0" /></span>;
const IC_BOLT  = ({ s = 16, col = "currentColor" }) => <span style={{ color: col, display: "inline-flex" }}><Ico s={s} d="M13 2 4 14h6l-1 8 9-12h-6l1-8Z" /></span>;
const IC_HAND  = ({ s = 16, col = "currentColor" }) => <span style={{ color: col, display: "inline-flex" }}><Ico s={s} d="M8 11V5.5a1.5 1.5 0 0 1 3 0V10m0-.5V4.5a1.5 1.5 0 0 1 3 0V10m0-1V6a1.5 1.5 0 0 1 3 0v7a6 6 0 0 1-6 6h-1a6 6 0 0 1-5.2-3L4 17l1.2-1a2 2 0 0 1 2.8.4L8 11Z" /></span>;

/* ═══════════════════════════════════════════════════════════════
   블로거 발굴 · 아웃리치 컨트롤 센터 — PUBLY DISCOVERY
   오브제 에디토리얼 감성 · 다크/라이트 토글(부드러운 다크)
   ⚖️ 공개된 정보만. 비공개는 건드리지 않음.
   ═══════════════════════════════════════════════════════════════ */

// ★ Electron 설치앱(file://)에서는 절대경로 "/characters/..."가 파일시스템 루트를 가리켜 404 → 이미지 깨짐.
//   vite base:"./" + SPA(경로 안 바뀜)라 상대경로 "characters/..."가 dist/characters/ 로 정상 로드됨.
const CH = {
  bori: boriImg,
  dodo: dodoImg,
  monggeul: monggeulImg,
  pumi: pumiImg,
};
// 혹시라도 로드 실패 시 마스코트별 이모지로 대체(깨진 아이콘 노출 방지)
const chErr = (emoji: string) => (e: any) => {
  const s = document.createElement("span");
  s.textContent = emoji;
  s.style.cssText = "font-size:1.4em;line-height:1;display:inline-block";
  e.currentTarget.replaceWith(s);
};

// 테마: light = 웜 페이퍼 / dark = 부드러운 웜 차콜(너무 어둡지 않게)
const THEMES = {
  light: { bg: "#eee9df", surf: "#faf7f1", surf2: "#f3eee4", ink: "#2b2620", sub: "#8c8377", line: "#e0d7c9", line2: "#d5c9b7", accent: "#a8593a", accentSoft: "#efe2d6", logBg: "#fbf9f4", logInk: "#5c554a" },
  dark: { bg: "#221f1b", surf: "#2e2b26", surf2: "#39352f", ink: "#f7f3ec", sub: "#cabeae", line: "#4a443c", line2: "#5a5349", accent: "#f0a074", accentSoft: "#4a3d33", logBg: "#1c1a16", logInk: "#d6ccbc" },
};

type Blogger = {
  id: string; nick: string; url: string; topic: string;
  thumbnail?: string;      // 프로필/썸네일 이미지(네이버 검색 API 제공)
  neighbors: number; postsPerWeek: number; visitors: number; score: number;
  email?: string; kakao?: string; openchat?: string; instagram?: string; youtube?: string; proposed?: boolean;
  keywords: string[];      // 자주 쓰는 키워드
  categories: string[];    // 주력 품목/카테고리
  lastActive: string;      // 마지막 활동
  engageRate: number;      // 참여율(%)
  authenticity?: number;   // 🩺 AI 진정성 점수(0~100) — 봇 로직 역이용, 가짜/품앗이 감별
  adRatio?: number;        // 📊 상업성(0~1) — 최근 글 제목의 협찬·체험단 표시 비율
  mainTopic?: string;      // 🏷️ 실제 주력 주제(최근 글 제목 자동분류)
  avgComments?: number;    // 💬 글당 평균 댓글 수(진짜 독자 반응)
  avgSympathy?: number;    // ❤️ 글당 평균 공감 수(최근 3개 표본)
  source?: "place";       // 플레이스 역추적에서 전달된 후보
  sourcePlaces?: string[];
  ship?: ShipState;        // 배송 단계(체험단 제품 발송)
};
// 체험단 배송 단계: 제안함(내가 연락) → 수락(블로거가 OK 회신 → 운영자가 확인 눌러 확정) → 발송대기 → 배송중 → 배송완료
type ShipStatus = "none" | "proposed" | "accepted" | "ready" | "shipped" | "delivered";
type ShipState = { status: ShipStatus; address?: string; product?: string; courier?: string; tracking?: string };
const SHIP_LABEL: Record<ShipStatus, string> = { none: "미제안", proposed: "제안함·회신대기", accepted: "수락", ready: "발송대기", shipped: "배송중", delivered: "배송완료" };
// 각 단계가 무슨 뜻인지(운영자용 쉬운 설명)
const SHIP_DESC: Record<ShipStatus, string> = { none: "아직 제안 안 함", proposed: "내가 이메일·댓글로 연락했고, 블로거의 OK 회신을 기다리는 중이에요", accepted: "블로거가 하겠다고 회신해서 운영자가 수락 처리한 상태예요", ready: "수락돼서 이제 제품을 보낼 준비를 하는 단계예요", shipped: "제품을 택배로 보냈어요(송장 등록됨)", delivered: "블로거가 제품을 받았어요" };

// "ALL"=전체 주제 다 포함(모든 카테고리를 돌아가며 발굴)
const TOPICS = ["ALL", "DELIVERY", "FOOD", "TRAVEL", "BEAUTY", "PARENTING", "FASHION", "CAFE", "LIVING", "PET", "FITNESS", "TECH", "HEALTH", "DIGITAL", "INTERIOR", "CULTURE", "EDU", "AUTO", "WEDDING", "FLOWER", "HOBBY"];
const TOPIC_KR: Record<string, string> = { ALL: "전체", DELIVERY: "배송·택배", FOOD: "맛집", TRAVEL: "여행", BEAUTY: "뷰티", PARENTING: "육아", FASHION: "패션", CAFE: "카페", LIVING: "리빙", PET: "펫", FITNESS: "운동", TECH: "IT", HEALTH: "건강", DIGITAL: "디지털", INTERIOR: "인테리어", CULTURE: "문화·공연", EDU: "교육", AUTO: "자동차", WEDDING: "웨딩", FLOWER: "플라워", HOBBY: "취미" };
// 전체 발굴 시 실제로 검색에 넣을 대표 키워드들(협찬 친화적 주제 우선 — 이메일 공개율 높은 순)
const ALL_TOPIC_KEYWORDS = ["맛집", "뷰티", "육아", "카페", "패션", "여행", "펫", "인테리어", "운동", "건강"];
const REGIONS = ["전국", "서울", "경기", "부산", "제주", "강원", "인천", "대구", "광주", "대전"];

// (목업 mockFind 제거 — 실제 네이버 발굴 API(/api/crawl)로 교체됨)

export default function CrawlCenter({ showToast, theme: extTheme, userId, plan = "free" }: { showToast?: (m: string, t?: any) => void; theme?: "dark" | "light"; userId?: string; plan?: string }) {
  const toast = (m: string, t?: string) => showToast?.(m, t);
  // 테마는 메인 헤더 토글(부모 prop)을 그대로 따른다 — 크롤링 자체 토글 제거(테리: 토글 공용화).
  // 다크 색상(THEMES.dark 웜 차콜)은 그대로. 다크면 로그 배경·글씨(logBg/logInk)도 함께 바뀜.
  const theme: "dark" | "light" = extTheme === "dark" ? "dark" : "light";
  const C = THEMES[theme];

  const [topic, setTopic] = useState("FOOD");
  const [region, setRegion] = useState("전국");
  const [keyword, setKeyword] = useState("");   // 사용자 추가 검색어(선택)
  const [count, setCount] = useState(30);
  const [minNeighbors, setMinNeighbors] = useState(500);
  const [minPosts, setMinPosts] = useState(2);
  const [activeOnly, setActiveOnly] = useState(true);
  // ✉️ 이메일 발송 속도 조절 — 회원이 직접(간격 초·오늘 보낼 최대 통수). 계정 안전.
  const [sendGapSec, setSendGapSec] = useState(() => Number(localStorage.getItem("publy_send_gap")) || 4);   // 통당 간격(초)
  const [sendCapToday, setSendCapToday] = useState(() => Number(localStorage.getItem("publy_send_cap")) || 0); // 오늘 최대(0=등급한도까지)
  useEffect(() => { localStorage.setItem("publy_send_gap", String(sendGapSec)); }, [sendGapSec]);
  useEffect(() => { localStorage.setItem("publy_send_cap", String(sendCapToday)); }, [sendCapToday]);
  const [topicMatch, setTopicMatch] = useState(true);
  const [fields, setFields] = useState<Record<string, boolean>>({ email: true, kakao: true, openchat: true, url: true, nick: true, keywords: true, categories: true });
  const toggleField = (k: string) => setFields((f) => ({ ...f, [k]: !f[k] }));
  const [advOpen, setAdvOpen] = useState(false);
  const [speed, setSpeed] = useState("보통");
  const [dailyLimit, setDailyLimit] = useState(200);
  const [excludeKw, setExcludeKw] = useState("");

  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState(0);
  const [logs, setLogs] = useState<string[]>([]);
  const [logExpand, setLogExpand] = useState(false);
  const [results, setResults] = useState<Blogger[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [sortBy, setSortBy] = useState<"score" | "neighbors" | "posts">("score");
  const [onlyContact, setOnlyContact] = useState(false);
  const [hideDormant, setHideDormant] = useState(false);   // 활성도: 휴면(최근글 없음) 제외
  const [commFilter, setCommFilter] = useState<"all" | "pure" | "ad">("all");   // 상업성: 전체/순수후기 위주/협찬 많은
  const [detail, setDetail] = useState<Blogger | null>(null);
  const [outreach, setOutreach] = useState<null | "email" | "comment">(null);
  // ★회사명 하드코딩 금지 — 모든 회원이 쓰므로 중립 템플릿 + {업체명} 변수. 회원이 자기 걸로 쓰면 localStorage에 저장돼 유지.
  //   {업체명}은 아래 outreachBrand에 회원이 한 번 넣으면 발송 시 자동 치환.
  // ★기본 내용 하드코딩 금지 — 처음엔 빈칸(사용자마다 다름). 예시 선택 또는 AI 작성 또는 직접 입력.
  //   키 버전업(v2)으로 옛날 하드코딩 저장값도 안 뜨게.
  const [emailSubject, setEmailSubject] = useState(() => localStorage.getItem("publy_outreach_subject2") || "");
  const [emailBody, setEmailBody] = useState(() => localStorage.getItem("publy_outreach_body2") || "");
  const [commentBody, setCommentBody] = useState(() => localStorage.getItem("publy_outreach_comment2") || "");
  const [outreachBrand, setOutreachBrand] = useState(() => localStorage.getItem("publy_outreach_brand") || "");   // 회원 본인 업체명({업체명} 치환)
  // 회원이 수정하면 저장(다음에 다시 안 써도 됨)
  useEffect(() => { localStorage.setItem("publy_outreach_subject2", emailSubject); }, [emailSubject]);
  useEffect(() => { localStorage.setItem("publy_outreach_body2", emailBody); }, [emailBody]);
  useEffect(() => { localStorage.setItem("publy_outreach_comment2", commentBody); }, [commentBody]);
  useEffect(() => { localStorage.setItem("publy_outreach_brand", outreachBrand); }, [outreachBrand]);
  // 📝 본문 작성 모드(일반=예시 선택 / AI=제목 기반 자동작성) + 예시 펼치기
  const [bodyMode, setBodyMode] = useState<"normal" | "ai">("normal");
  const [exampleOpen, setExampleOpen] = useState(false);
  const [aiWriting, setAiWriting] = useState(false);
  // 예시 인사말 5종 — 변수({닉네임}·{관심품목}·{업체명}) 사용, 줄바꿈으로 가독성 좋게
  const BODY_EXAMPLES: { label: string; text: string }[] = [
    { label: "친근한 인사형", text: "{닉네임}님, 안녕하세요!\n\n{관심품목} 관련 글을 즐겨 쓰시는 걸 보고 반가운 마음에 연락드려요.\n\n{업체명}에서 함께해 주실 분을 찾고 있는데, {닉네임}님 블로그와 잘 어울릴 것 같아요.\n\n관심 있으시면 편하게 회신 주세요. 감사합니다!" },
    { label: "정중한 제안형", text: "안녕하세요, {닉네임}님.\n\n{업체명} 담당자입니다.\n\n{관심품목} 분야에서 꾸준히 활동하시는 모습이 인상 깊어 제안드리고자 연락드렸습니다.\n\n자세한 내용은 회신 주시면 안내해 드리겠습니다.\n\n좋은 하루 보내세요." },
    { label: "간결한 형", text: "{닉네임}님, 안녕하세요!\n\n{업체명}에서 {관심품목} 관련 협업을 제안드려요.\n\n관심 있으시면 회신 부탁드립니다. 감사합니다." },
    { label: "혜택 강조형", text: "{닉네임}님, 안녕하세요!\n\n{관심품목} 콘텐츠를 즐겨 보고 있어요.\n\n{업체명}에서 준비한 제품을 직접 경험해 보실 수 있는 기회를 드리려고 해요.\n\n부담 없이 살펴보시고, 관심 있으시면 회신 주세요!" },
    { label: "진솔한 형", text: "{닉네임}님, 안녕하세요.\n\n{닉네임}님의 {관심품목} 글을 인상 깊게 봤어요.\n\n{업체명}과 함께 솔직한 이야기를 나눠 주실 수 있을까 해서 조심스레 연락드립니다.\n\n편하게 회신 주시면 감사하겠습니다." },
  ];
  // AI로 본문 작성 — 제목·업체명·주제를 바탕으로 Gemini가 초안 생성
  const writeBodyWithAI = async () => {
    const key = localStorage.getItem("publy_gemini_key") || "";
    if (!key) { toast("AI 작성은 무료 Gemini 키가 필요해요. 설정 → 글쓰기 AI에서 등록해주세요.", "info"); return; }
    setAiWriting(true);
    try {
      const brand = outreachBrand || "저희";
      const subj = emailSubject || "블로그 협업 제안";
      const prompt = `너는 블로그 체험단·협업 제안 이메일을 쓰는 마케터야. 아래 조건으로 블로거에게 보낼 정중하고 자연스러운 제안 이메일 본문을 한국어로 써줘.\n\n- 업체명: ${brand}\n- 메일 제목: ${subj}\n- 반드시 {닉네임}, {관심품목} 변수를 자연스럽게 포함(발송 시 블로거별로 자동 치환됨)\n- 3~5문단, 각 문단은 1~2문장으로 짧게, 문단 사이에 빈 줄을 넣어 가독성 좋게\n- 과장·스팸 느낌 없이 진솔하게, 마지막에 회신 요청\n- 본문만 출력(제목·설명·따옴표 없이)`;
      const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${encodeURIComponent(key)}`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { temperature: 0.9, maxOutputTokens: 2048, thinkingConfig: { thinkingBudget: 0 } } }),
      });
      const d = await r.json();
      const txt = (d?.candidates?.[0]?.content?.parts || []).map((p: any) => p.text || "").join("").trim();
      if (!txt) throw new Error(d?.error?.message || "생성 실패");
      setEmailBody(txt);
      toast("✨ AI가 본문을 작성했어요! 필요하면 수정하세요.", "success");
    } catch (e: any) { toast("AI 작성 실패: " + (e?.message || e), "error"); }
    finally { setAiWriting(false); }
  };
  const [sending, setSending] = useState(false);
  // ✉️ 웹메일 방식: SMTP·앱비밀번호 없이, 로그인된 네이버 계정 창을 열어 메일을 쓴다(서이추처럼).
  //    ★크롤링은 다른 탭과 완전 별개(테리 원칙: 탭별 계정 격리). 크롤링 전용으로 로그인한 계정만 쓴다.
  //    저장소 `publy_accounts_crawl` — 서이추(neighbor)·공감(engage) 등과 절대 안 섞임.
  const CRAWL_LS_KEY = "publy_accounts_crawl";
  type CrawlAcct = { accountId: string; id: string; pw: string; blogId: string; sessionOk: boolean; loginLoading?: boolean };
  const [mailAccounts, setMailAccounts] = useState<CrawlAcct[]>(() => {
    try { const s = JSON.parse(localStorage.getItem(CRAWL_LS_KEY) || "[]"); if (Array.isArray(s) && s.length) return s.map((a: any) => ({ accountId: a.accountId, id: a.id || "", pw: a.pw || "", blogId: a.blogId || "", sessionOk: !!a.sessionOk })); } catch {}
    return [{ accountId: "crawl_acc_1", id: "", pw: "", blogId: "", sessionOk: false }];
  });
  const [mailAcctId, setMailAcctId] = useState("");   // 선택된 발송 계정(연결된 것 중)
  const [showMailPw, setShowMailPw] = useState<Record<string, boolean>>({});   // 계정별 비밀번호 미리보기 토글
  const saveCrawlAccts = (list: CrawlAcct[]) => { try { localStorage.setItem(CRAWL_LS_KEY, JSON.stringify(list.map(a => ({ accountId: a.accountId, id: a.id, pw: a.pw, blogId: a.blogId, sessionOk: a.sessionOk })))); } catch {} };
  const connectedMail = mailAccounts.filter(a => a.sessionOk && a.blogId);   // 실제 로그인된 것만 발송 후보
  // 크롤링 계정 로그인(서이추와 동일한 /api/login, tabKey=crawl로 격리)
  const connectCrawlAccount = async (accountId: string) => {
    const acc = mailAccounts.find(a => a.accountId === accountId);
    if (!acc || !acc.id || !acc.pw) { toast("아이디와 비밀번호를 입력하세요", "info"); return; }
    setMailAccounts(list => list.map(a => a.accountId === accountId ? { ...a, loginLoading: true } : a));
    try {
      const r = await botFetch(`${BOT}/api/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ accountId, id: acc.id, pw: acc.pw }) });
      const d = await r.json();
      if (d.ok || d.success) {
        const blogId = d.blogId || acc.blogId || acc.id;
        setMailAccounts(list => { const nx = list.map(a => a.accountId === accountId ? { ...a, sessionOk: true, blogId, loginLoading: false } : a); saveCrawlAccts(nx); return nx; });
        setMailAcctId(accountId);
        toast(`✅ ${blogId} 연결됨`, "success");
      } else {
        setMailAccounts(list => list.map(a => a.accountId === accountId ? { ...a, sessionOk: false, loginLoading: false } : a));
        toast(d.error || "로그인 실패 — 아이디/비밀번호를 확인하세요", "error");
      }
    } catch (e: any) {
      setMailAccounts(list => list.map(a => a.accountId === accountId ? { ...a, loginLoading: false } : a));
      toast(/Failed to fetch|봇/i.test(e?.message || "") ? "봇 서버에 연결할 수 없어요(앱을 껐다 켜보세요)" : (e?.message || "연결 실패"), "error");
    } finally {
      try { (window as any).electron?.focusApp?.(); } catch {}
    }
  };
  const addCrawlAccount = () => setMailAccounts(list => [...list, { accountId: `crawl_acc_${Date.now()}`, id: "", pw: "", blogId: "", sessionOk: false }]);
  const removeCrawlAccount = (accountId: string) => setMailAccounts(list => { const nx = list.filter(a => a.accountId !== accountId); const f = nx.length ? nx : [{ accountId: "crawl_acc_1", id: "", pw: "", blogId: "", sessionOk: false }]; saveCrawlAccts(f); return f; });
  const changeCrawlAccount = (accountId: string, patch: Partial<CrawlAcct>) => setMailAccounts(list => list.map(a => a.accountId === accountId ? { ...a, ...patch } : a));
  useEffect(() => { setMailAcctId(prev => (connectedMail.some(o => o.accountId === prev) ? prev : (connectedMail[0]?.accountId || ""))); /* eslint-disable-next-line */ }, [mailAccounts]);
  // 보낸글 이력 + 🎛️ 아웃리치 컨트롤 대시보드
  const [historyOpen, setHistoryOpen] = useState(false);
  const [outHistory, setOutHistory] = useState<any[]>([]);
  const loadOutHistory = async () => {
    if (!userId) return;
    try { const r = await botFetch(`${BOT}/api/outreach/history/${userId}`); const d = await r.json(); if (d.ok) setOutHistory(d.history || []); } catch {}
  };
  const esOutRef = useRef<BotEventStream | null>(null);
  // 📬 팔로우업(자동/수동 공존 — 테리 원칙). 자동=봇이 알아서, 수동=할일 팝업으로 알려주고 회원이 버튼.
  const [followupAuto, setFollowupAuto] = useState(() => localStorage.getItem("publy_followup_auto") === "1");
  const [followupDays, setFollowupDays] = useState(() => Number(localStorage.getItem("publy_followup_days")) || 3);
  const [followTargets, setFollowTargets] = useState<any[]>([]);   // N일+ 무응답 = 할 일
  const [todoOpen, setTodoOpen] = useState(false);                 // "할 일 N건" 큰 팝업
  const [followSending, setFollowSending] = useState(false);
  const [outPage, setOutPage] = useState(0);                       // 아웃리치 목록 페이지(20개씩)
  // 🗑️ 아웃리치 기록 삭제
  const deleteOutreach = async (id: string) => {
    if (!window.confirm("이 기록을 목록에서 지울까요?")) return;
    try {
      await botFetch(`${BOT}/api/outreach/delete`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id }) });
      setOutHistory(h => h.filter(x => x.id !== id));
      setFollowTargets(t => t.filter(x => x.id !== id));
      toast("🗑️ 기록을 지웠어요", "success");
    } catch { toast("삭제 실패", "error"); }
  };
  const esFollowRef = useRef<BotEventStream | null>(null);
  useEffect(() => { localStorage.setItem("publy_followup_auto", followupAuto ? "1" : "0"); }, [followupAuto]);
  useEffect(() => { localStorage.setItem("publy_followup_days", String(followupDays)); }, [followupDays]);
  const loadFollowTargets = async () => {
    if (!userId) return;
    try { const r = await botFetch(`${BOT}/api/outreach/followup-targets/${userId}?days=${followupDays}`); const d = await r.json(); if (d.ok) setFollowTargets(d.targets || []); } catch {}
  };
  // 회신 상태 수동 기록(회신옴/거절)
  const setReplyStatus = async (id: string, reply_status: "replied" | "no_reply") => {
    try {
      await botFetch(`${BOT}/api/outreach/reply-status`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, reply_status }) });
      setOutHistory(h => h.map(x => x.id === id ? { ...x, reply_status } : x));
      setFollowTargets(t => t.filter(x => x.id !== id));
      toast(reply_status === "replied" ? "✅ 회신 옴으로 표시했어요" : "🚫 거절/무응답으로 표시했어요", "success");
    } catch { toast("상태 변경 실패", "error"); }
  };
  // 팔로우업 발송(자동/수동 공용) — 선택한 id들에 리마인드
  const sendFollowup = (ids: string[]) => {
    if (!userId) { toast("로그인 정보가 없어요", "error"); return; }
    if (!mailAcctId || !connectedMail.some(a => a.accountId === mailAcctId)) { toast("발송할 네이버 계정을 먼저 연결하세요", "info"); return; }
    if (!ids.length) { toast("팔로우업할 대상이 없어요", "info"); return; }
    setFollowSending(true); pushLog(`📬 팔로우업 ${ids.length}건 발송 시작…`);
    const url = `${BOT}/api/outreach/send-followup?userId=${encodeURIComponent(userId)}&accountId=${encodeURIComponent(mailAcctId)}&ids=${encodeURIComponent(JSON.stringify(ids))}`;
    const es = new BotEventStream(url); esFollowRef.current = es;
    es.onmessage = (e: MessageEvent) => {
      let d: any; try { d = JSON.parse(e.data); } catch { return; }
      if (d.type === "log") pushLog(d.msg);
      else if (d.type === "sent") { setFollowTargets(t => t.filter(x => x.id !== d.id)); }
      else if (d.type === "done") { pushLog(`✅ 팔로우업 완료 — 성공 ${d.ok} · 실패 ${d.fail}`); toast(`팔로우업 ${d.ok}건 발송`, "success"); setFollowSending(false); es.close(); esFollowRef.current = null; loadOutHistory(); loadFollowTargets(); try { (window as any).electron?.focusApp?.(); } catch {} }
      else if (d.type === "error") { pushLog(`🔴 ${d.msg}`); toast(d.msg, "error"); setFollowSending(false); es.close(); esFollowRef.current = null; }
    };
    es.onerror = () => { pushLog("🔴 봇 연결 오류"); setFollowSending(false); es.close(); esFollowRef.current = null; };
  };
  // 대시보드 진입 시 이력·팔로우업 대상 로드. 자동 모드면 대상 있을 때 자동 발송, 수동이면 할일 팝업.
  const autoFollowRanRef = useRef(false);
  useEffect(() => {
    if (!userId) return;
    loadOutHistory(); loadFollowTargets();
    /* eslint-disable-next-line */
  }, [userId, followupDays]);
  useEffect(() => {
    if (!followTargets.length || autoFollowRanRef.current) return;
    if (followupAuto && mailAcctId) { autoFollowRanRef.current = true; pushLog(`🤖 자동 팔로우업 ON — ${followTargets.length}건 자동 발송`); sendFollowup(followTargets.map(t => t.id)); }
    else if (!followupAuto) { setTodoOpen(true); }   // 수동: 할 일 팝업 자동 오픈
    /* eslint-disable-next-line */
  }, [followTargets, followupAuto, mailAcctId]);
  const [manualEmails, setManualEmails] = useState("");   // 직접 입력/붙여넣기한 이메일(발굴 결과에 없는 사람)
  // 📊 등급별 하루 한도(자정 초기화) — 다른 탭과 동일한 에너지바
  const crawlLimit = CRAWL_DAILY_LIMIT[plan] ?? CRAWL_DAILY_LIMIT.free;
  const emailLimit = EMAIL_DAILY_LIMIT[plan] ?? EMAIL_DAILY_LIMIT.free;
  const commentLimit = COMMENT_DAILY_LIMIT[plan] ?? COMMENT_DAILY_LIMIT.free;
  const unlimitedPlan = plan === "unlimited" || plan === "admin";
  const [crawlUsed, setCrawlUsed] = useState(0);
  const [emailUsed, setEmailUsed] = useState(0);
  const loadUsage = async () => {
    if (!userId) return;
    try { setCrawlUsed(await getCrawlDailyUsage(userId)); setEmailUsed(await getEmailDailyUsage(userId)); } catch {}
  };
  useEffect(() => { loadUsage(); const iv = setInterval(loadUsage, 20000); return () => clearInterval(iv); /* eslint-disable-next-line */ }, [userId]);
  useEffect(() => {
    const imported = takePlaceBloggerCandidates(userId);
    if (!imported.length) return;
    const mapped: Blogger[] = imported.map((item) => ({
      id: item.blogId,
      nick: item.nick || item.blogId,
      url: `https://blog.naver.com/${item.blogId}`,
      topic: "ALL",
      neighbors: 0,
      postsPerWeek: 0,
      visitors: 0,
      score: 50,
      keywords: item.fromPlaces,
      categories: ["플레이스 리뷰어"],
      lastActive: "플레이스에서 가져옴",
      engageRate: 0,
      source: "place",
      sourcePlaces: item.fromPlaces,
    }));
    setResults(current => {
      const byId = new Map(current.map(blogger => [blogger.id, blogger]));
      mapped.forEach(blogger => { if (!byId.has(blogger.id)) byId.set(blogger.id, blogger); });
      return [...byId.values()];
    });
    setSelected(new Set(mapped.map(blogger => blogger.id)));
    toast(`플레이스에서 찾은 블로거 ${mapped.length}명을 가져왔어요`, "success");
    pushLog(`🗺️ 플레이스 리뷰 블로거 ${mapped.length}명 가져오기 완료`);
    // 플레이스 전달 목록은 한 번만 소비한다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // 이메일 텍스트에서 주소만 추출(쉼표·공백·줄바꿈·세미콜론 구분, 형식 검증, 중복 제거)
  const parseEmails = (raw: string): string[] => {
    const found = (raw.match(/[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g) || []);
    return Array.from(new Set(found.map(e => e.trim().toLowerCase())));
  };
  // 🎉 크롤링 웰컴 팝업(진입 시 팡!) — 7일 보지않기
  const [welcome, setWelcome] = useState(() => Date.now() > Number(localStorage.getItem("publy_crawl_welcome_until") || "0"));
  const closeWelcome = (week?: boolean) => { if (week) localStorage.setItem("publy_crawl_welcome_until", String(Date.now() + 7 * 86400000)); setWelcome(false); };
  const timerRef = useRef<any>(null);
  const esRef = useRef<BotEventStream | null>(null);
  const [scanned, setScanned] = useState(0);   // 지금까지 스캔(수집)한 블로거 수 — 실시간 표시

  const pushLog = (m: string) => setLogs((l) => { const next = [...l, `${new Date().toLocaleTimeString("ko-KR")}  ${m}`]; if (userId) pushLiveLog(userId, { context: "크롤링", text: next.slice(-80).join("\n"), running: true }); return next; });

  // 🩺 AI 진정성 점수(0~100): 봇 로직 역이용 — 참여율 대비 이웃수로 "진짜 영향력 vs 품앗이·봇 부풀림" 감별.
  // 이웃만 많고 참여율 낮으면(도배·품앗이 의심) 낮게, 참여율이 이웃 규모 대비 건강하면 높게.
  const calcAuthenticity = (neighbors: number, engageRate: number, postsPerWeek: number): number => {
    if (!neighbors) return 50;
    const expected = Math.max(2, Math.min(14, 900 / Math.sqrt(neighbors)));  // 이웃 많을수록 기대 참여율 자연 감소
    const ratio = engageRate / expected;              // 1 이상이면 건강
    let s = 50 + Math.round(Math.min(45, (ratio - 1) * 45));
    if (postsPerWeek >= 3) s += 6;                    // 꾸준한 활동 가점
    if (postsPerWeek === 0) s -= 15;                  // 휴면 감점
    return Math.max(5, Math.min(99, s));
  };

  const startFind = () => {
    if (running) return;
    // 📊 등급 한도 체크 — 오늘 남은 발굴 수보다 목표가 크면 막고 업그레이드 유도(무제한 제외)
    if (!unlimitedPlan) {
      const remain = Math.max(0, crawlLimit - crawlUsed);
      if (remain <= 0) { toast(`오늘 크롤링 발굴 한도(${crawlLimit}명)를 다 썼어요. 자정에 초기화되거나, 등급을 올리면 더 발굴할 수 있어요.`, "error"); return; }
      if (count > remain) { toast(`오늘 남은 발굴이 ${remain}명이에요. 인원을 ${remain}명 이하로 줄이거나, 등급을 올려주세요.`, "info"); return; }
    }
    if (esRef.current) { esRef.current.close(); esRef.current = null; }
    setRunning(true); setProgress(0); setLogs([]); setResults([]); setSelected(new Set()); setScanned(0);
    // ★"전체(ALL)"=모든 주제 대표 키워드로 폭넓게 발굴. 단일 주제=그 주제 키워드.
    const isAll = topic === "ALL";
    let kwList = isAll
      ? (keyword.trim() ? keyword.split(/[,\s]+/).filter(Boolean) : ALL_TOPIC_KEYWORDS.slice())
      : [TOPIC_KR[topic] || topic, ...(keyword.trim() ? keyword.split(/[,\s]+/).filter(Boolean) : [])];
    if (region && region !== "전국") kwList = isAll ? kwList.map(k => `${region} ${k}`) : [`${region} ${kwList[0]}`, ...kwList.slice(1)];
    // 총 목표(count)를 키워드로 나눠 과다 발굴 방지. 전체면 키워드당 소량씩 합쳐 count 근처.
    const perKw = isAll ? Math.max(3, Math.ceil(count / kwList.length)) : count;
    pushLog(`🔎 발굴 시작 — ${isAll ? `전체(${kwList.length}개 주제)` : `"${kwList.join(", ")}"`} · 목표 ${count}명`);
    pushLog(`필터 — 이웃 ${minNeighbors.toLocaleString()}+ · 주 ${minPosts}글+ ${activeOnly ? "· 최근 활동중만" : ""}`);
    // 실제 네이버 검색 발굴 API(neighbor-bot /api/crawl, SSE) — 목업 아님. thumbnail=프로필 이미지 제공.
    // ★발굴도 '선택한 작업 계정'으로 — 그 계정에 배정된 프록시(IP)로 접속(발송 계정과 동일 선택 공유). 미선택이면 회원 기본 프록시.
    const scanAcct = (mailAcctId && connectedMail.some(a => a.accountId === mailAcctId)) ? mailAcctId : "";
    const url = `${BOT}/api/crawl?keywords=${encodeURIComponent(kwList.join(","))}&countPerKeyword=${perKw}&orderBy=${topicMatch ? "sim" : "recentdate"}&activeDays=${activeOnly ? 30 : 0}&excludeMarket=true${userId ? `&userId=${userId}` : ""}${scanAcct ? `&accountId=${encodeURIComponent(scanAcct)}` : ""}`;
    const es = new BotEventStream(url);
    esRef.current = es;
    es.onmessage = (e: MessageEvent) => {
      let d: any; try { d = JSON.parse(e.data); } catch { return; }
      if (d.type === "log") { pushLog(d.msg); const m = String(d.msg).match(/(\d+)\s*명/); if (m) { setScanned(Number(m[1])); setProgress(Math.min(95, Number(m[1]))); } }
      else if (d.type === "quota_exceeded") { pushLog("🛑 오늘 발굴 한도를 다 썼어요"); toast("오늘 발굴 한도 초과", "error"); setRunning(false); es.close(); }
      else if (d.type === "crawl_done") {
        const raw: any[] = d.results || [];
        // 실제 발굴 결과 → 카드 매핑. 이웃수/참여율은 네이버 검색 API가 안 주므로 추정치(추후 blog-stats로 정밀화 가능)
        const seen = new Set<string>();
        const mapped: Blogger[] = raw.filter(r => r.blogId && !seen.has(r.blogId) && seen.add(r.blogId)).map((r, i) => {
          const daysAgo = r.addDate ? Math.floor((Date.now() - r.addDate) / 86400000) : null;
          const lastActive = daysAgo == null ? "-" : daysAgo <= 0 ? "오늘" : daysAgo === 1 ? "어제" : `${daysAgo}일 전`;
          const postsPerWeek = daysAgo == null ? 2 : daysAgo <= 2 ? 5 : daysAgo <= 7 ? 3 : daysAgo <= 30 ? 1 : 0;
          const neighbors = 0;   // 정확값은 상세(blog-stats)에서 — 목록에선 미상(0=미확인)
          const engageRate = 0;
          return {
            id: r.blogId, nick: r.nickName || r.blogName || r.blogId, url: `blog.naver.com/${r.blogId}`,
            topic, thumbnail: r.thumbnail || undefined,
            email: r.email || undefined, kakao: r.kakao || undefined,
            openchat: r.openchat || undefined, instagram: r.instagram || undefined,
            youtube: r.youtube || undefined,
            neighbors, postsPerWeek, visitors: 0, score: 0,
            keywords: r.keyword ? [String(r.keyword)] : [], categories: [],
            lastActive, engageRate, authenticity: undefined,
          } as Blogger;
        });
        setResults(mapped);
        setProgress(100); setScanned(mapped.length);
        // ★한도는 '연락처(이메일·카톡·오픈채팅) 있는 사람'만 차감 — 연락처 없는 블로거로 한도가 새지 않게(테리 정책)
        const withContact = mapped.filter(b => b.email || b.kakao || b.openchat);
        pushLog(`✅ 발굴 완료 — 실제 블로거 ${mapped.length}명 중 📇 연락처 있는 사람 ${withContact.length}명 (한도는 연락처 있는 ${withContact.length}명만 차감)`);
        toast(`${mapped.length}명 발굴 · 연락처 ${withContact.length}명 (한도 ${withContact.length}명 차감)`, "success");
        setRunning(false); es.close(); esRef.current = null;
        if (mapped.length) analyzeAuthenticity(mapped);   // 🩺 발굴 직후 진정성 자동 분석(실제 이웃·방문자)
        // 📊 연락처 있는 인원만큼만 하루 사용량 차감(자정 초기화). 연락처 없는 사람은 공짜.
        if (userId && withContact.length && !unlimitedPlan) { incrementCrawlQuota(userId, withContact.length).then(() => setCrawlUsed(u => u + withContact.length)); }
      }
      else if (d.type === "error") { pushLog(`❌ 발굴 실패: ${d.msg}`); toast(`발굴 실패: ${d.msg}`, "error"); setRunning(false); es.close(); esRef.current = null; }
    };
    es.onerror = () => { pushLog("❌ 봇 연결 오류 — 서버가 켜져 있는지 확인해주세요"); toast("봇 연결 오류", "error"); setRunning(false); es.close(); esRef.current = null; };
  };
  const stopFind = () => { if (esRef.current) { esRef.current.close(); esRef.current = null; } if (timerRef.current) clearInterval(timerRef.current); setRunning(false); pushLog("⏹ 사용자가 중단했어요"); };


  // 🩺 진정성 정밀 분석 — 발굴된 블로거들의 실제 이웃수·방문자를 공개 API로 읽어 진정성 점수 채움(세션 불필요)
  const [analyzing, setAnalyzing] = useState(false);
  const esAuthRef = useRef<BotEventStream | null>(null);
  const analyzeAuthenticity = (list?: Blogger[]) => {
    const src = list || results;
    const ids = src.map(b => b.id).filter(Boolean);
    if (!ids.length) return;
    setAnalyzing(true); pushLog(`🩺 진정성 분석 시작 — ${ids.length}명 (공개 이웃·방문자)`);
    const es = new BotEventStream(`${BOT}/api/outreach/authenticity?blogIds=${encodeURIComponent(JSON.stringify(ids))}`);
    esAuthRef.current = es;
    es.onmessage = (e: MessageEvent) => {
      let d: any; try { d = JSON.parse(e.data); } catch { return; }
      if (d.type === "auth") {
        // 📇 진정성 분석하며 긁어온 공개 연락처(이메일·카톡·오픈채팅)도 카드에 반영
        setResults(prev => prev.map(b => b.id === d.blogId ? { ...b, neighbors: d.neighbors || b.neighbors, visitors: d.visitors || b.visitors, authenticity: d.authenticity ?? b.authenticity, score: d.authenticity ?? b.score, email: d.email || b.email, kakao: d.kakao || b.kakao, openchat: d.openchat || b.openchat, instagram: d.instagram || b.instagram, youtube: d.youtube || b.youtube, mainTopic: d.mainTopic || b.mainTopic, postsPerWeek: d.postsPerWeek ?? b.postsPerWeek, adRatio: d.adRatio ?? b.adRatio, avgComments: d.avgComments ?? b.avgComments, avgSympathy: d.avgSympathy ?? b.avgSympathy, lastActive: (d.lastPostDaysAgo != null ? (d.lastPostDaysAgo === 0 ? "오늘" : `${d.lastPostDaysAgo}일 전`) : b.lastActive) } : b));
      } else if (d.type === "done") {
        setAnalyzing(false); es.close(); esAuthRef.current = null;
        // ★"연락처 있는 것만" 체크했으면 = 분석 끝나고 연락처 없는 사람을 목록에서 실제 제거(수집=체크에 맞게)
        setResults(prev => {
          const withC = prev.filter(b => b.email || b.kakao || b.openchat);
          if (onlyContact) {
            const removed = prev.length - withC.length;
            setSelected(s => new Set([...s].filter(id => withC.some(b => b.id === id))));
            pushLog(`✅ 분석 완료 — 📇 연락처 있는 ${withC.length}명만 남김(연락처 없는 ${removed}명 제외 · '연락처 있는 것만' 켜짐)`);
            return withC;
          }
          pushLog(`✅ 진정성·연락처 분석 완료 — 📇 공개 연락처 있는 블로거 ${withC.length}명`);
          return prev;
        });
      }
      else if (d.type === "error") { pushLog(`❌ 진정성 분석 실패: ${d.msg}`); setAnalyzing(false); es.close(); esAuthRef.current = null; }
    };
    es.onerror = () => { setAnalyzing(false); es.close(); esAuthRef.current = null; };
  };

  // 📧 이메일 실발송(SSE) — 웹메일 방식: 로그인된 네이버 창을 열어 사람처럼 메일을 쓴다(SMTP·앱비번 불필요).
  const sendEmails = () => {
    if (!userId) { toast("로그인 정보가 없어요", "error"); return; }
    if (!mailAcctId || !connectedMail.some(a => a.accountId === mailAcctId)) { toast("발송할 네이버 계정을 먼저 연결하세요(아래에서 아이디·비밀번호로 로그인)", "info"); return; }
    // ① 발굴 결과에서 고른 사람 + ② 직접 입력/붙여넣은 이메일 = 합쳐서 발송(중복 제거)
    const picks = shown.filter(b => selected.has(b.id) && b.email);
    const pickedEmails = new Set(picks.map(b => (b.email || "").toLowerCase()));
    const manual = parseEmails(manualEmails).filter(e => !pickedEmails.has(e));
    const total = picks.length + manual.length;
    if (!total) { toast("보낼 대상이 없어요 — 블로거를 선택하거나 이메일을 직접 입력하세요", "info"); return; }
    // 📊 등급 한도 체크(무제한 제외) — 오늘 남은 발송 수 초과 시 막고 업그레이드 유도
    if (!unlimitedPlan) {
      const remain = Math.max(0, emailLimit - emailUsed);
      if (remain <= 0) { toast(`오늘 이메일 발송 한도(${emailLimit}통)를 다 썼어요. 자정에 초기화되거나, 등급을 올리면 더 보낼 수 있어요.`, "error"); return; }
      if (total > remain) { toast(`오늘 남은 발송이 ${remain}통이에요. 대상을 ${remain}명 이하로 줄이거나, 등급을 올려주세요.`, "info"); return; }
    }
    setSending(true); pushLog(`📧 이메일 발송 시작 — 발굴 ${picks.length}명 + 직접입력 ${manual.length}명 = ${total}명`);
    const targets = [
      ...picks.map(b => ({ id: b.id, nick: b.nick, email: b.email, keywords: b.keywords, categories: b.categories })),
      ...manual.map((e, i) => ({ id: `manual-${i}-${e}`, nick: "", email: e, keywords: [] as string[], categories: [] as string[] })),
    ];
    // 회원이 정한 오늘 상한(0=등급한도까지) + 통당 간격(초) 반영
    const capLimit = sendCapToday > 0 ? Math.min(emailLimit || 999999, sendCapToday) : (emailLimit || 50);
    const url = `${BOT}/api/outreach/send-email?userId=${encodeURIComponent(userId)}&accountId=${encodeURIComponent(mailAcctId)}&brand=${encodeURIComponent(outreachBrand)}&dailyLimit=${encodeURIComponent(String(capLimit))}&gapSec=${encodeURIComponent(String(sendGapSec))}&subject=${encodeURIComponent(emailSubject)}&message=${encodeURIComponent(emailBody)}&targets=${encodeURIComponent(JSON.stringify(targets))}`;
    const es = new BotEventStream(url); esOutRef.current = es;
    es.onmessage = (e: MessageEvent) => {
      let d: any; try { d = JSON.parse(e.data); } catch { return; }
      if (d.type === "log") pushLog(d.msg);
      // 보낸 기록은 아웃리치 대시보드(outHistory)에서 관리 — 카드 배지 안 씀
      else if (d.type === "done") { pushLog(`✅ 발송 완료 — 성공 ${d.ok} · 실패 ${d.fail}`); toast(`이메일 ${d.ok}명 발송 완료`, "success"); if (userId && d.ok > 0 && !unlimitedPlan) { incrementEmailQuota(userId, d.ok).then(() => setEmailUsed(u => u + d.ok)); } setSending(false); setOutreach(null); es.close(); esOutRef.current = null; loadOutHistory(); try { (window as any).electron?.focusApp?.(); } catch {} }
      else if (d.type === "error") { pushLog(`❌ ${d.msg}`); toast(d.msg, "error"); setSending(false); es.close(); esOutRef.current = null; }
    };
    es.onerror = () => { pushLog("❌ 봇 연결 오류"); toast("봇 연결 오류", "error"); setSending(false); es.close(); esOutRef.current = null; };
  };

  // 💬 블로그 댓글 제안 실발송 (러프·계정 안전 최우선 — 텀 길게, 소량만)
  const sendComments = () => {
    if (!userId) { toast("로그인 정보가 없어요", "error"); return; }
    if (!mailAcctId || !connectedMail.some(a => a.accountId === mailAcctId)) { toast("발송할 네이버 계정을 먼저 연결하세요(위 오늘의 사용량)", "info"); return; }
    if (!commentBody.trim()) { toast("댓글 내용을 적으세요", "info"); return; }
    const picks = shown.filter(b => selected.has(b.id));
    if (!picks.length) { toast("먼저 블로거를 선택하세요", "info"); return; }
    // ⚠️ 계정 안전 경고 — 관리자·무제한이라도 경고문은 그대로(위험하니 적당히!). 카운트만 무제한.
    const unlimitedComment = commentLimit >= 9999;
    const capN = unlimitedComment ? picks.length : Math.min(commentLimit, picks.length);
    const limitLine = unlimitedComment
      ? "· 등급 한도: 무제한 (단, 계정 보호를 위해 하루 20개 이하를 강력히 권해요!)"
      : `· 오늘 최대 ${commentLimit}명까지(내 등급)`;
    if (!window.confirm(`⚠️ 계정 안전 주의\n\n모르는 블로거 글에 홍보 댓글을 다는 건 네이버가 스팸·도배로 감지해 계정이 제한될 수 있어요.\n\n안전을 위해:\n${limitLine}\n· 40~90초 간격으로 아주 천천히\n· 자연스러운 댓글 권장(홍보 티 최소화)\n\n그래도 ${capN}명에게 댓글을 달까요?`)) return;
    setSending(true); pushLog(`💬 댓글 제안 시작 — ${capN}명 (계정 보호: 천천히)`);
    const targets = picks.map(b => ({ id: b.id, blogId: b.id, nick: b.nick, keywords: b.keywords, categories: b.categories }));
    const url = `${BOT}/api/outreach/send-comment?userId=${encodeURIComponent(userId)}&accountId=${encodeURIComponent(mailAcctId)}&dailyLimit=${commentLimit}&message=${encodeURIComponent(commentBody)}&targets=${encodeURIComponent(JSON.stringify(targets))}`;
    const es = new BotEventStream(url); esOutRef.current = es;
    es.onmessage = (e: MessageEvent) => {
      let d: any; try { d = JSON.parse(e.data); } catch { return; }
      if (d.type === "log") pushLog(d.msg);
      else if (d.type === "done") { pushLog(`✅ 댓글 완료 — 성공 ${d.ok} · 실패 ${d.fail}`); toast(`댓글 ${d.ok}건 발송`, "success"); setSending(false); setOutreach(null); es.close(); esOutRef.current = null; loadOutHistory(); try { (window as any).electron?.focusApp?.(); } catch {} }
      else if (d.type === "error") { pushLog(`🔴 ${d.msg}`); toast(d.msg, "error"); setSending(false); es.close(); esOutRef.current = null; }
    };
    es.onerror = () => { pushLog("🔴 봇 연결 오류"); toast("봇 연결 오류", "error"); setSending(false); es.close(); esOutRef.current = null; };
  };


  const shown = results
    .filter((b) => !onlyContact || b.email || b.kakao || b.openchat)
    .filter((b) => !hideDormant || (b.postsPerWeek ?? 1) > 0)                        // 활성도: 휴면 제외(주간 글 0 = 휴면)
    .filter((b) => commFilter === "all" || b.adRatio == null                        //  상업성 미분석은 통과(분석 후 적용)
      || (commFilter === "pure" ? b.adRatio <= 0.3 : b.adRatio >= 0.5))              //  순수후기 위주(≤30%) / 협찬 많은(≥50%)
    .sort((a, b) => sortBy === "score" ? b.score - a.score : sortBy === "neighbors" ? b.neighbors - a.neighbors : b.postsPerWeek - a.postsPerWeek);
  const toggleSel = (id: string) => setSelected((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });

  const downloadCsv = () => {
    const rows = shown.filter((b) => selected.size === 0 || selected.has(b.id));
    if (!rows.length) { toast("내보낼 블로거가 없어요", "info"); return; }
    const H = ["닉네임", "블로그", "주제", "실제주제", "이웃수", "주간글수", "평균댓글", "평균공감", "방문자", "참여율", "점수", "관심키워드", "주력품목", "이메일", "카톡", "오픈채팅", "인스타", "유튜브"];
    const esc = (v: any) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const csv = [H.map(esc).join(","), ...rows.map((b) => [b.nick, b.url, TOPIC_KR[b.topic], b.mainTopic || "", b.neighbors, b.postsPerWeek, b.avgComments ?? "", b.avgSympathy ?? "", b.visitors, b.engageRate + "%", b.score, b.keywords.join(" "), b.categories.join(" "), b.email || "", b.kakao || "", b.openchat || "", b.instagram ? `@${b.instagram}` : "", b.youtube || ""].map(esc).join(","))].join("\r\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" }));
    a.download = `blogger_${topic}_${rows.length}.csv`; a.click();
    toast(`${rows.length}명 CSV 저장`, "success");
  };

  // ── 스타일 토큰 ──
  const serif = "'Fraunces','Playfair Display',Georgia,'Noto Serif KR',serif";
  const card = { background: C.surf, border: `1px solid ${C.line}`, borderRadius: 4 } as const;
  const eyebrow = { fontSize: 10.5, fontWeight: 800, letterSpacing: ".22em", color: C.sub, textTransform: "uppercase" as const };
  const label = { fontSize: 10.5, fontWeight: 800, letterSpacing: ".14em", color: C.sub, textTransform: "uppercase" as const, marginBottom: 9 };
  const chip = (on: boolean) => ({ padding: "8px 15px", borderRadius: 2, fontSize: 12.5, fontWeight: 700, cursor: "pointer", whiteSpace: "nowrap" as const, border: `1px solid ${on ? C.ink : C.line2}`, background: on ? C.ink : "transparent", color: on ? C.surf : C.sub, transition: "all .16s", letterSpacing: on ? ".08em" : "0" } as const);
  const sChip = (on: boolean) => ({ ...chip(on), padding: "6px 12px", fontSize: 12 } as const);
  const inp = { background: theme === "dark" ? C.surf2 : "#fff", border: `1px solid ${C.line2}`, borderRadius: 3, padding: "10px 12px", fontSize: 13, fontWeight: 600, color: C.ink, width: "100%", outline: "none", fontFamily: "'Noto Sans KR',sans-serif", boxSizing: "border-box" as const };
  const btnSolid = { border: `1px solid ${C.ink}`, borderRadius: 3, padding: "11px 18px", fontSize: 12.5, fontWeight: 800, cursor: "pointer", color: C.surf, fontFamily: "inherit" as const, background: C.ink, letterSpacing: ".06em" };
  const btnGhost = { border: `1px solid ${C.line2}`, borderRadius: 3, padding: "11px 16px", fontSize: 12.5, fontWeight: 800, cursor: "pointer", color: C.ink, fontFamily: "inherit" as const, background: "transparent", letterSpacing: ".04em" };
  // ✉️ 크롤링 전용 발송 계정 로그인 UI(헤더·발송패널 두 곳에서 재사용). 아이디/비번으로 로그인 → 그 계정으로만 발송.
  const renderMailAccounts = () => (
    <div style={{ padding: "12px 13px", borderRadius: 6, background: "rgba(47,158,94,.06)", border: `1px solid ${C.line2}` }}>
      <div style={{ fontSize: 11.5, fontWeight: 800, color: C.ink, marginBottom: 8 }}>👤 작업 네이버 계정 <span style={{ fontSize: 10, fontWeight: 700, color: C.sub }}>· 계정 추가 후 <b style={{ color: "#2f9e5e" }}>◉ 라디오로 선택</b> — 이 계정으로 발굴·발송(다른 탭과 안 섞여요)</span></div>
      <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
        {mailAccounts.map(a => (
          <div key={a.accountId} style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap", padding: "7px 9px", borderRadius: 6, background: a.sessionOk ? "rgba(47,158,94,.1)" : C.surf, border: `1px solid ${a.sessionOk ? "rgba(47,158,94,.35)" : C.line2}` }}>
            {a.sessionOk ? (
              <>
                <input type="radio" name="mailAcct" checked={mailAcctId === a.accountId} onChange={() => setMailAcctId(a.accountId)} style={{ accentColor: "#2f9e5e" }} />
                <span style={{ color: "#2f9e5e", fontWeight: 800, fontSize: 12 }}>✅ {a.blogId}</span>
                <span style={{ fontSize: 10, color: C.sub }}>연결됨 (이 계정으로 발굴·발송)</span>
                {/* 재연결 — 세션 만료 시 저장된 아이디·비번으로 다시 로그인(발송이 안 되면 눌러요) */}
                <button onClick={() => connectCrawlAccount(a.accountId)} disabled={a.loginLoading} title="발송이 안 되면 세션이 만료된 거예요. 다시 로그인합니다." style={{ ...btnGhost, marginLeft: "auto", padding: "2px 9px", fontSize: 10.5, color: "#2f9e5e", borderColor: "rgba(47,158,94,.4)" }}>{a.loginLoading ? "재연결 중…" : "🔄 재연결"}</button>
                <button onClick={() => removeCrawlAccount(a.accountId)} style={{ ...btnGhost, padding: "2px 8px", fontSize: 10.5 }}>삭제</button>
              </>
            ) : (
              <>
                <input value={a.id} onChange={e => changeCrawlAccount(a.accountId, { id: e.target.value })} placeholder="네이버 아이디" style={{ flex: 1, minWidth: 90, padding: "6px 9px", borderRadius: 6, border: `1px solid ${C.line2}`, background: C.surf, color: C.ink, fontFamily: "inherit", fontSize: 12 }} />
                <div style={{ position: "relative", flex: 1, minWidth: 90, display: "flex" }}>
                  <input type={showMailPw[a.accountId] ? "text" : "password"} value={a.pw} onChange={e => changeCrawlAccount(a.accountId, { pw: e.target.value })} onKeyDown={e => { if (e.key === "Enter" && a.id && a.pw) connectCrawlAccount(a.accountId); }} placeholder="비밀번호" style={{ width: "100%", boxSizing: "border-box", padding: "6px 32px 6px 9px", borderRadius: 6, border: `1px solid ${C.line2}`, background: C.surf, color: C.ink, fontFamily: "inherit", fontSize: 12 }} />
                  <button type="button" onClick={() => setShowMailPw(s => ({ ...s, [a.accountId]: !s[a.accountId] }))} title={showMailPw[a.accountId] ? "숨기기" : "보기"} style={{ position: "absolute", right: 4, top: "50%", transform: "translateY(-50%)", background: "transparent", border: "none", cursor: "pointer", fontSize: 15, lineHeight: 1, padding: 3 }}>{showMailPw[a.accountId] ? "🙈" : "👁️"}</button>
                </div>
                <button onClick={() => connectCrawlAccount(a.accountId)} disabled={a.loginLoading || !a.id || !a.pw} style={{ ...btnSolid, padding: "6px 12px", fontSize: 11, opacity: (a.loginLoading || !a.id || !a.pw) ? .6 : 1 }}>{a.loginLoading ? "연결 중..." : "🔗 연결"}</button>
                {mailAccounts.length > 1 && <button onClick={() => removeCrawlAccount(a.accountId)} style={{ ...btnGhost, padding: "6px 8px", fontSize: 10.5 }}>✕</button>}
              </>
            )}
          </div>
        ))}
        <button onClick={addCrawlAccount} style={{ ...btnGhost, padding: "6px 10px", fontSize: 11, alignSelf: "flex-start" }}>+ 계정 추가</button>
      </div>
      <div style={{ fontSize: 10.5, color: C.sub, marginTop: 8, lineHeight: 1.5 }}>💡 서이추처럼 <b>로그인된 네이버 창을 열어</b> 메일을 써요. 앱 비밀번호·SMTP 설정 필요 없어요.</div>
    </div>
  );
  // 📖 기능 설명 — 각 섹션에 "이게 뭐예요" 한 줄(어르신도 알게, 문의 방지)
  const Help = ({ children }: { children: React.ReactNode }) => (
    <div style={{ fontSize: 11.5, color: C.sub, lineHeight: 1.6, marginBottom: 14, display: "flex", gap: 6, alignItems: "flex-start" }}><span style={{ flexShrink: 0 }}>💬</span><span>{children}</span></div>
  );

  return (
    <div className="ob-root" style={{ position: "relative", borderRadius: 6, padding: "26px 26px", overflow: "hidden", fontFamily: "'Noto Sans KR',sans-serif", color: C.ink, background: C.bg, minHeight: 420, transition: "background .3s,color .3s" }}>
      <style>{`
        @keyframes obBob{0%,100%{transform:translateY(0)}50%{transform:translateY(-6px)}}
        @keyframes obUp{0%{opacity:0;transform:translateY(12px)}100%{opacity:1;transform:translateY(0)}}
        @keyframes obBar{0%{background-position:0 0}100%{background-position:26px 0}}
        @keyframes obPulse{0%,100%{transform:scale(1);box-shadow:0 0 0 0 rgba(217,138,31,.5)}50%{transform:scale(1.06);box-shadow:0 0 0 6px rgba(217,138,31,0)}}
        @keyframes obTodoPop{0%{transform:scale(.85) translateY(20px);opacity:0}60%{transform:scale(1.02)}100%{transform:scale(1) translateY(0);opacity:1}}
        .ob-sec{animation:obUp .5s cubic-bezier(.22,1,.36,1) both}
        .ob-bob{animation:obBob 4s ease-in-out infinite}
        .ob-card:hover{box-shadow:0 14px 30px -20px rgba(0,0,0,.4)!important;transition:all .25s}
        .ob-stat:hover{transform:translateY(-3px);box-shadow:0 12px 24px -14px rgba(0,0,0,.35)}
        .ob-scroll::-webkit-scrollbar{height:6px;width:6px}.ob-scroll::-webkit-scrollbar-thumb{background:${C.line2};border-radius:0}
        @media(max-width:700px){
          .ob-root{padding:14px 8px 120px!important}
          .ob-card{padding:16px 12px!important}
          .ob-stats-grid{grid-template-columns:repeat(2,minmax(0,1fr))!important}
          .ob-search-grid,.ob-filter-grid,.ob-detail-grid{grid-template-columns:1fr!important}
          .ob-plan-table{overflow-x:auto!important;-webkit-overflow-scrolling:touch}
          .ob-plan-table>div{min-width:620px}
          .ob-root button{min-height:44px}
          .ob-root input,.ob-root textarea,.ob-root select{max-width:100%;box-sizing:border-box;font-size:16px!important}
        }
      `}</style>

      <UsageGuide theme={theme} accent={C.accent}
        subtitle="펄리예요! 체험단·홍보할 블로거를 키워드로 찾아 이메일·댓글로 제안할 수 있어요."
        steps={[
          { ico: "👤", title: "작업 네이버 계정 연결·선택", desc: "‘작업 네이버 계정’에서 아이디·비번으로 연결하고 ◉ 동그라미로 골라요(발굴·발송에 이 계정을 써요)." },
          { ico: "🔍", title: "블로거 발굴", desc: "주제·지역·키워드와 인원을 정하고 START SCAN을 누르면 진짜 블로거를 찾아와요." },
          { ico: "🩺", title: "고르고 → 제안", desc: "카드를 골라 진정성·연락처를 확인하고, 이메일 보내기(또는 댓글)로 체험단을 제안해요." },
          { ico: "📮", title: "보낸 뒤 관리", desc: "‘보낸 글 이력·아웃리치 추적’에서 회신 여부를 보고 팔로우업(리마인드)까지 해요." },
        ]} />

      {/* 🎉 크롤링 웰컴 팝업 — 몽글(탐험)이 팡! 사용법+재미있는 멘트. [닫기][일주일 보지않기] */}
      {welcome && createPortal(
        <div onClick={() => closeWelcome(false)} style={{ position: "fixed", inset: 0, zIndex: 100000, background: "rgba(20,16,12,.6)", backdropFilter: "blur(4px)", display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
          <style>{`
            @keyframes cwPop{0%{transform:scale(.6) translateY(30px);opacity:0}55%{transform:scale(1.04)}100%{transform:scale(1) translateY(0);opacity:1}}
            @keyframes cwBob{0%,100%{transform:translateY(0) rotate(-3deg)}50%{transform:translateY(-11px) rotate(3deg)}}
            @keyframes cwRow{0%{opacity:0;transform:translateX(-10px)}100%{opacity:1;transform:translateX(0)}}
            @keyframes cwGlow{0%,100%{transform:scale(1);opacity:.85}50%{transform:scale(1.12);opacity:1}}
            @keyframes cwShadow{0%,100%{transform:translateX(-50%) scale(1);opacity:.85}50%{transform:translateX(-50%) scale(.8);opacity:.5}}
            @keyframes cwHeroPop{0%{transform:scale(.2) translateY(60px) rotate(-18deg);opacity:0}45%{transform:scale(1.28) translateY(-10px) rotate(8deg);opacity:1}65%{transform:scale(.94) rotate(-4deg)}82%{transform:scale(1.06) rotate(2deg)}100%{transform:scale(1) translateY(0) rotate(0);opacity:1}}
            @keyframes cwRays{0%{transform:rotate(0);opacity:0}30%{opacity:.9}100%{transform:rotate(360deg);opacity:.9}}
            @keyframes cwRing{0%{transform:scale(.3);opacity:.9}100%{transform:scale(2.4);opacity:0}}
            @keyframes cwSpark{0%,100%{transform:scale(0) rotate(0);opacity:0}50%{transform:scale(1) rotate(90deg);opacity:1}}
            @keyframes cwConfetti{0%{transform:translateY(-40px) rotate(0);opacity:0}12%{opacity:1}100%{transform:translateY(150px) rotate(540deg);opacity:0}}
          `}</style>
          <div onClick={e => e.stopPropagation()} style={{ position: "relative", background: C.surf, borderRadius: 22, padding: "34px 30px 26px", maxWidth: 440, width: "100%", boxShadow: "0 30px 90px -20px rgba(0,0,0,.55)", border: `1px solid ${C.line2}`, animation: "cwPop .5s cubic-bezier(.22,1.4,.4,1) both", maxHeight: "90vh", overflowY: "auto", color: C.ink }}>
            <div style={{ textAlign: "center", marginBottom: 18 }}>
              {/* 🧭 주인공 캐릭터 — 화려하게 팡! 광선+링파동+색종이+반짝이+오버슈트 등장 */}
              <div style={{ position: "relative", width: 190, height: 178, margin: "0 auto 2px", overflow: "visible" }}>
                <div style={{ position: "absolute", left: "50%", top: "46%", width: 200, height: 200, transform: "translate(-50%,-50%)", background: `conic-gradient(from 0deg, transparent 0 12deg, ${C.accent}28 12deg 24deg, transparent 24deg 36deg, ${C.accent}20 36deg 48deg)`, borderRadius: "50%", animation: "cwRays 9s linear infinite", pointerEvents: "none" }} />
                <div style={{ position: "absolute", left: "50%", top: "46%", width: 120, height: 120, transform: "translate(-50%,-50%)", borderRadius: "50%", border: `2.5px solid ${C.accent}88`, animation: "cwRing 2.2s ease-out infinite", pointerEvents: "none" }} />
                <div style={{ position: "absolute", left: "50%", top: "46%", width: 120, height: 120, transform: "translate(-50%,-50%)", borderRadius: "50%", border: `2.5px solid ${C.accent}55`, animation: "cwRing 2.2s ease-out 1.1s infinite", pointerEvents: "none" }} />
                <div style={{ position: "absolute", left: "50%", top: "46%", width: 150, height: 150, transform: "translate(-50%,-50%)", borderRadius: "50%", background: `radial-gradient(circle, ${C.accent}44, ${C.accent}18 55%, transparent 72%)`, animation: "cwGlow 2.6s ease-in-out infinite" }} />
                {[["12%","14%",".2s","#ffd23f",16],["82%","10%",".7s",C.accent,13],["6%","62%","1.1s","#8b5cf6",12],["88%","58%",".45s","#ff5fa2",15],["50%","2%","1.4s","#00c8ff",14]].map(([l,t,d,col,sz],k)=>(
                  <div key={k} style={{ position: "absolute", left: l as string, top: t as string, fontSize: sz as number, color: col as string, animation: `cwSpark 1.8s ease-in-out ${d as string} infinite`, pointerEvents: "none", textShadow: `0 0 8px ${col}` }}>✦</div>
                ))}
                {[["20%","#ff5fa2",".1s"],["38%","#ffd23f",".5s"],["56%",C.accent,".3s"],["72%","#8b5cf6",".7s"],["30%","#00c8ff",".9s"],["64%","#ff922e",".2s"]].map(([l,col,d],k)=>(
                  <div key={"c"+k} style={{ position: "absolute", left: l as string, top: -8, width: 7, height: 11, background: col as string, borderRadius: 2, animation: `cwConfetti 2.6s linear ${d as string} infinite`, pointerEvents: "none" }} />
                ))}
                <div style={{ position: "absolute", left: "50%", bottom: 6, transform: "translateX(-50%)", width: 90, height: 15, borderRadius: "50%", background: "rgba(0,0,0,.22)", filter: "blur(6px)", animation: "cwShadow 2.4s ease-in-out infinite" }} />
                <div style={{ position: "absolute", left: "50%", top: "44%", transform: "translate(-50%,-50%)", animation: "cwHeroPop .9s cubic-bezier(.18,1.5,.5,1) both" }}>
                  <img src={CH.monggeul} alt="탐험가 몽글" onError={e => { const s = document.createElement("div"); s.textContent = "🧭"; s.style.cssText = "font-size:124px;line-height:1"; e.currentTarget.replaceWith(s); }} style={{ display: "block", width: 156, height: 156, objectFit: "contain", animation: "cwBob 2.4s ease-in-out .9s infinite", filter: `drop-shadow(0 14px 26px ${C.accent}66)` }} />
                </div>
              </div>
              <div style={{ fontFamily: serif, fontSize: 24, fontWeight: 600, color: C.ink, marginTop: 4 }}>탐험 준비 완료! 🧭</div>
              <div style={{ fontSize: 12.5, color: C.sub, marginTop: 7, lineHeight: 1.6 }}>안녕하세요, 발굴 탐험가 <b style={{ color: C.accent }}>몽글</b>이에요!<br />체험단에 딱 맞는 <b style={{ color: C.ink }}>진짜 블로거</b>를 공개 정보로 찾아드릴게요.</div>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 9, marginBottom: 20 }}>
              {[
                { n: "1", ic: "🎯", t: "주제·지역·키워드 고르기", d: "어떤 블로거를 찾을지 정해요.", },
                { n: "2", ic: "📡", t: "START SCAN", d: "네이버에서 진짜 블로거를 실시간으로 발굴해요.", },
                { n: "3", ic: "🩺", t: "진정성 자동 분석", d: "가짜·품앗이 블로거를 걸러내요. 이게 제 특기!", },
                { n: "4", ic: "✉️", t: "정중히 제안", d: "공개 이메일로 체험단을 제안해요. (발신계정 등록 후)", },
              ].map((s, i) => (
                <div key={s.n} style={{ display: "flex", alignItems: "center", gap: 12, padding: "11px 13px", borderRadius: 12, background: C.bg, border: `1px solid ${C.line}`, animation: "cwRow .4s ease both", animationDelay: `${.15 + i * .1}s` }}>
                  <div style={{ width: 30, height: 30, borderRadius: "50%", background: C.accent, color: C.surf, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14, fontWeight: 900, flexShrink: 0 }}>{s.n}</div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 800, color: C.ink }}>{s.ic} {s.t}</div>
                    <div style={{ fontSize: 11, color: C.sub, marginTop: 2, lineHeight: 1.4 }}>{s.d}</div>
                  </div>
                </div>
              ))}
            </div>
            <div style={{ fontSize: 11.5, color: C.sub, textAlign: "center", marginBottom: 16, lineHeight: 1.55, padding: "10px 12px", borderRadius: 10, background: C.accentSoft }}>⚖️ <b style={{ color: C.ink }}>공개된 정보만</b> 봐요. "협찬 문의 환영"처럼 열어둔 곳에 정중히 제안하는 거예요. 무차별 스팸 아니에요!</div>
            <div style={{ display: "flex", gap: 8 }}>
              <button onClick={() => closeWelcome(true)} style={{ flex: 1, padding: "12px", borderRadius: 12, border: `1px solid ${C.line2}`, background: "transparent", color: C.sub, cursor: "pointer", fontSize: 12.5, fontWeight: 700, fontFamily: "inherit" }}>일주일간 보지 않기</button>
              <button onClick={() => closeWelcome(false)} style={{ flex: 1.4, padding: "12px", borderRadius: 12, border: "none", background: C.accent, color: C.surf, cursor: "pointer", fontSize: 13.5, fontWeight: 800, fontFamily: "inherit", boxShadow: `0 8px 20px -8px ${C.accent}` }}>탐험 시작 →</button>
            </div>
          </div>
        </div>, document.body)}

      {/* ── 헤더 ── */}
      <div className="ob-sec" style={{ position: "relative", overflow: "hidden", display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 16, padding: "26px 28px", marginBottom: 22, borderRadius: 14, background: theme === "dark" ? `linear-gradient(135deg, ${C.surf2} 0%, ${C.surf} 60%, ${C.accentSoft} 130%)` : `linear-gradient(135deg, #fff 0%, ${C.surf} 55%, ${C.accentSoft} 130%)`, border: `1px solid ${C.line2}`, boxShadow: theme === "dark" ? "0 12px 40px -18px rgba(0,0,0,.6)" : "0 12px 40px -20px rgba(168,89,58,.28)" }}>
        {/* 은은한 장식 원 */}
        <div style={{ position: "absolute", right: -40, top: -50, width: 200, height: 200, borderRadius: "50%", background: `radial-gradient(circle, ${C.accent}22, transparent 70%)`, pointerEvents: "none" }} />
        <div style={{ position: "relative", zIndex: 1 }}>
          <div style={{ ...eyebrow, color: C.accent }}>✦ Blogger Discovery · Outreach</div>
          <div style={{ fontFamily: serif, fontSize: 40, fontWeight: 600, letterSpacing: "-.015em", lineHeight: 1, marginTop: 8, color: C.ink }}>PUBLY<span style={{ background: `linear-gradient(90deg, ${C.accent}, ${theme === "dark" ? "#f0b088" : "#c9724a"})`, WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent", backgroundClip: "text" }}> Discovery</span></div>
          <div style={{ fontSize: 12.5, color: C.sub, fontWeight: 600, marginTop: 10, maxWidth: 620, lineHeight: 1.6, wordBreak: "keep-all" }}>체험단에 어울리는 블로거를 <b style={{ color: C.ink }}>공개 정보로</b> 발굴하고, <b style={{ color: C.accent }}>🩺 진정성</b>까지 분석해 정중히 제안합니다.</div>
        </div>
        <div style={{ position: "relative", zIndex: 1, display: "flex", alignItems: "flex-end", gap: 10 }}>
          {/* 발굴 없이도 이메일을 직접 입력해 캠페인 보내기(2번) — 선택 없이 모달 열림. ★크고 진하게(작아서 안 보인다는 지적) */}
          <button onClick={() => { setSelected(new Set()); setManualEmails(""); setOutreach("email"); }} title="블로거 발굴 없이, 내가 가진 이메일 명단으로 바로 보낼 수 있어요"
            onMouseDown={e => (e.currentTarget.style.transform = "scale(.96)")} onMouseUp={e => (e.currentTarget.style.transform = "scale(1)")} onMouseLeave={e => (e.currentTarget.style.transform = "scale(1)")}
            style={{ fontSize: 14, fontWeight: 900, color: "#fff", background: "#2f9e5e", border: "2px solid #fff", padding: "12px 20px", borderRadius: 12, whiteSpace: "nowrap", cursor: "pointer", fontFamily: "inherit", boxShadow: "0 6px 18px rgba(47,158,94,.45)", transition: "transform .12s" }}>✉ 이메일 직접 보내기</button>
          <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: ".12em", color: C.accent, border: `1px solid ${C.accent}`, background: theme === "dark" ? "transparent" : "#fff", padding: "6px 11px", borderRadius: 20, whiteSpace: "nowrap" }}>⚖ 공개 정보만</span>
          <img src={CH.monggeul} onError={chErr("🧭")} className="ob-bob" style={{ width: 68, height: 68, objectFit: "contain", filter: "saturate(1) drop-shadow(0 10px 18px rgba(0,0,0,.28))" }} />
        </div>
      </div>

      {/* ── 🎛️ 아웃리치 컨트롤 대시보드: 단계별 현황(발굴→연락처→이메일→댓글→회신) ── */}
      {(() => {
        // 단계 집계: 발송 이력(outHistory)에서 — 이메일/댓글 채널별 + 회신
        const emailCnt = outHistory.filter(h => h.channel === "email" && h.status === "sent").length;
        const commentCnt = outHistory.filter(h => h.channel === "comment" && h.status === "sent").length;
        const repliedCnt = outHistory.filter(h => h.reply_status === "replied").length;
        const contactCnt = results.filter(b => b.email || b.kakao || b.openchat).length;
        const stages = [
          { lab: "발굴", en: "Discovered", val: results.length, Ic: IC_RADAR, col: C.accent },
          { lab: "연락처", en: "Reachable", val: contactCnt, Ic: IC_CARD, col: "#0e9f6e" },
          { lab: "이메일", en: "Email", val: emailCnt, Ic: IC_PLANE, col: "#6d5dd3" },
          { lab: "댓글", en: "Comment", val: commentCnt, Ic: IC_BOX, col: "#d98a1f" },
          { lab: "회신", en: "Replied", val: repliedCnt, Ic: IC_REPLY, col: "#0ea5e9" },
        ];
        return (
          <div className="ob-sec ob-stats-grid" style={{ display: "grid", gridTemplateColumns: "repeat(5,1fr)", gap: 10, marginBottom: 14 }}>
            {stages.map((k, i) => (
              <div key={i} className="ob-stat" onMouseEnter={e => { e.currentTarget.style.transform = "translateY(-4px)"; e.currentTarget.style.boxShadow = `0 14px 28px -12px ${k.col}88`; }} onMouseLeave={e => { e.currentTarget.style.transform = "translateY(0)"; e.currentTarget.style.boxShadow = `0 4px 10px -6px ${C.ink}22`; }}
                style={{ padding: "15px 14px 14px", background: C.surf, border: `1px solid ${C.line2}`, borderRadius: 14, position: "relative", overflow: "hidden", transition: "transform .2s cubic-bezier(.22,1,.36,1), box-shadow .2s", boxShadow: `0 4px 10px -6px ${C.ink}22`, cursor: "default" }}>
                {/* 3D 상단 컬러 리본 + 은은한 코너 글로우 */}
                <div style={{ position: "absolute", inset: "0 0 auto 0", height: 4, background: `linear-gradient(90deg, ${k.col}, ${k.col}55)` }} />
                <div style={{ position: "absolute", right: -18, top: -18, width: 64, height: 64, borderRadius: "50%", background: `radial-gradient(circle, ${k.col}22, transparent 70%)` }} />
                <div style={{ position: "relative", zIndex: 1 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <k.Ic s={17} col={k.col} />
                    <span style={{ fontSize: 9.5, fontWeight: 800, letterSpacing: ".1em", color: k.col, textTransform: "uppercase" }}>{k.en}</span>
                  </div>
                  <div style={{ fontFamily: serif, fontSize: 30, fontWeight: 600, color: C.ink, lineHeight: 1, marginTop: 8, fontVariantNumeric: "tabular-nums" }}>{k.val}</div>
                  <div style={{ fontSize: 11, fontWeight: 700, color: C.sub, marginTop: 3 }}>{k.lab}</div>
                </div>
              </div>
            ))}
          </div>
        );
      })()}

      {/* ── 📬 아웃리치 추적 대시보드 — 보낸 이메일 관리·회신·팔로우업 한곳에 ── */}
      {(() => {
        // 이메일 + 댓글 둘 다 추적 목록에 (채널 무관)
        const sent = outHistory.filter(h => (h.channel === "email" || h.channel === "comment") && h.status === "sent");
        const stageOf = (h: any) => {
          const isComment = h.channel === "comment";
          if (h.reply_status === "replied") return { t: "회신옴", c: "#0ea5e9", Ic: IC_REPLY };
          if (h.reply_status === "no_reply") return { t: "무응답", c: C.sub, Ic: IC_PLANE };
          return isComment ? { t: "댓글 담", c: "#d98a1f", Ic: IC_BOX } : { t: "회신대기", c: "#6d5dd3", Ic: IC_PLANE };
        };
        const daysAgo = (iso: string) => Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
        const fmt = (iso: string) => { const d = new Date(iso); return `${d.getMonth() + 1}/${d.getDate()}`; };
        return (
          <div className="ob-sec ob-card" style={{ ...card, padding: 0, marginBottom: 16, overflow: "hidden" }}>
            {/* 헤더 — 3D 딥 배경 + 타이틀 + 자동/수동 토글 */}
            <div style={{ padding: "18px 20px", position: "relative", overflow: "hidden", background: `linear-gradient(135deg, ${C.ink}, ${C.ink}dd)`, color: C.surf }}>
              <div style={{ position: "absolute", right: -30, top: -40, width: 160, height: 160, borderRadius: "50%", background: `radial-gradient(circle, ${C.accent}44, transparent 65%)` }} />
              <div style={{ position: "relative", zIndex: 1, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 11 }}>
                  <span style={{ display: "inline-flex", width: 38, height: 38, borderRadius: 11, background: C.accent, color: C.surf, alignItems: "center", justifyContent: "center", boxShadow: `0 6px 16px -6px ${C.accent}` }}><IC_PLANE s={20} col={C.surf} /></span>
                  <div>
                    <div style={{ fontFamily: serif, fontSize: 18, fontWeight: 600, letterSpacing: ".01em" }}>아웃리치 추적</div>
                    <div style={{ fontSize: 11, opacity: .78, marginTop: 1 }}>보낸 이메일 · 회신 · 팔로우업을 한곳에서</div>
                  </div>
                </div>
                {/* 자동/수동 토글 — 모든 기능 자동+수동 공존 원칙 */}
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ fontSize: 11, fontWeight: 700, opacity: .85 }}>팔로우업</span>
                  <button onClick={() => setFollowupAuto(v => !v)} title={followupAuto ? "자동: 무응답 대상에게 봇이 알아서 리마인드 발송" : "수동: 할 일로 알려주고 내가 눌러서 발송"}
                    style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "6px 12px", borderRadius: 20, border: "none", cursor: "pointer", fontFamily: "inherit", fontSize: 11.5, fontWeight: 800, background: followupAuto ? C.accent : "rgba(255,255,255,.16)", color: C.surf, transition: "all .2s" }}>
                    {followupAuto ? <IC_BOLT s={13} col={C.surf} /> : <IC_HAND s={13} col={C.surf} />}
                    {followupAuto ? "자동" : "수동"}
                  </button>
                </div>
              </div>
            </div>
            {/* 할 일 배너 — N일+ 무응답 있으면 눈에 띄게 */}
            {followTargets.length > 0 && (
              <div onClick={() => setTodoOpen(true)} style={{ cursor: "pointer", display: "flex", alignItems: "center", gap: 10, padding: "12px 20px", background: "rgba(217,138,31,.12)", borderBottom: `1px solid ${C.line}` }}>
                <span style={{ display: "inline-flex", width: 30, height: 30, borderRadius: 9, background: "#d98a1f", color: "#fff", alignItems: "center", justifyContent: "center", flexShrink: 0, animation: "obPulse 1.6s ease-in-out infinite" }}><IC_HAND s={16} col="#fff" /></span>
                <div style={{ flex: 1, fontSize: 12.5, fontWeight: 700, color: C.ink }}>
                  <b style={{ color: "#d98a1f", fontSize: 14 }}>할 일 {followTargets.length}건</b> — {followupDays}일 넘게 회신 없는 분들이에요. {followupAuto ? "자동 발송 대기 중." : "리마인드를 보내면 회신율이 올라가요."}
                </div>
                <span style={{ fontSize: 11.5, fontWeight: 800, color: "#d98a1f", whiteSpace: "nowrap" }}>열기 →</span>
              </div>
            )}
            {/* 보낸 목록 — 20개씩 페이지네이션 */}
            {(() => {
              const PER = 20; const totalPages = Math.max(1, Math.ceil(sent.length / PER));
              const pg = Math.min(outPage, totalPages - 1);
              const pageItems = sent.slice(pg * PER, pg * PER + PER);
              return (
                <>
                  <div style={{ padding: "6px 8px 4px" }}>
                    {sent.length === 0 ? (
                      <div style={{ padding: "34px 20px", textAlign: "center", color: C.sub }}>
                        <div style={{ display: "inline-flex", marginBottom: 8, opacity: .5 }}><IC_PLANE s={30} col={C.sub} /></div>
                        <div style={{ fontSize: 13, fontWeight: 700 }}>아직 보낸 이메일이 없어요</div>
                        <div style={{ fontSize: 11.5, marginTop: 3 }}>블로거를 발굴해 제안 메일을 보내면 여기서 추적할 수 있어요.</div>
                      </div>
                    ) : pageItems.map((h, i) => {
                      const st = stageOf(h); const dA = daysAgo(h.sent_at); const isComment = h.channel === "comment";
                      const needFollow = h.reply_status !== "replied" && h.reply_status !== "no_reply" && !h.followup_at && dA >= followupDays;
                      return (
                        <div key={h.id || i} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 12px", borderRadius: 10, transition: "background .15s", borderBottom: i < pageItems.length - 1 ? `1px solid ${C.line}` : "none" }}
                          onMouseEnter={e => e.currentTarget.style.background = C.surf2} onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
                          <span style={{ display: "inline-flex", width: 32, height: 32, borderRadius: 9, background: `${st.c}18`, color: st.c, alignItems: "center", justifyContent: "center", flexShrink: 0 }}><st.Ic s={17} col={st.c} /></span>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontSize: 12.5, fontWeight: 800, color: C.ink, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                              <span style={{ fontSize: 9, fontWeight: 800, color: isComment ? "#d98a1f" : "#6d5dd3", background: isComment ? "rgba(217,138,31,.14)" : "rgba(109,93,211,.14)", padding: "1px 6px", borderRadius: 10, marginRight: 5 }}>{isComment ? "💬 댓글" : "✉️ 이메일"}</span>
                              {h.nickname || h.blog_id || "블로거"} {h.followup_at && <span style={{ fontSize: 9.5, fontWeight: 700, color: "#6d5dd3", marginLeft: 4 }}>· 리마인드함</span>}
                            </div>
                            <div style={{ fontSize: 10.5, color: C.sub, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{isComment ? (h.blog_id ? `blog.naver.com/${h.blog_id}` : "") : h.to_email} · {fmt(h.sent_at)} {isComment ? "댓글" : "보냄"} ({dA === 0 ? "오늘" : `${dA}일 전`})</div>
                          </div>
                          <span style={{ fontSize: 10.5, fontWeight: 800, color: st.c, background: `${st.c}14`, border: `1px solid ${st.c}44`, padding: "3px 9px", borderRadius: 20, whiteSpace: "nowrap", flexShrink: 0 }}>{st.t}{needFollow ? " ·촉진" : ""}</span>
                          <div style={{ display: "flex", gap: 5, flexShrink: 0 }}>
                            {h.reply_status !== "replied" && <button onClick={() => setReplyStatus(h.id, "replied")} title={isComment ? "블로거가 답댓글·회신했어요" : "이 블로거가 회신했어요"} style={{ padding: "5px 9px", borderRadius: 7, border: `1px solid ${C.line2}`, background: C.surf, color: "#0ea5e9", cursor: "pointer", fontSize: 10.5, fontWeight: 800, fontFamily: "inherit", whiteSpace: "nowrap" }}>회신옴</button>}
                            {needFollow && !isComment && <button onClick={() => sendFollowup([h.id])} disabled={followSending} title="리마인드 이메일을 보내요" style={{ padding: "5px 9px", borderRadius: 7, border: "none", background: "#d98a1f", color: "#fff", cursor: "pointer", fontSize: 10.5, fontWeight: 800, fontFamily: "inherit", whiteSpace: "nowrap" }}>팔로우업</button>}
                            {/* 댓글=단 글로 바로가기(답댓글 확인) / 이메일=블로그 홈 */}
                            {(isComment && h.to_email ? h.to_email : h.blog_id ? `https://blog.naver.com/${h.blog_id}` : "") && <a href={isComment && h.to_email ? h.to_email : `https://blog.naver.com/${h.blog_id}`} target="_blank" rel="noopener noreferrer" title={isComment ? "댓글 단 글 보러가기(답댓글 확인)" : "블로그 열기"} style={{ display: "inline-flex", alignItems: "center", gap: 4, padding: "5px 8px", borderRadius: 7, border: `1px solid ${isComment ? "#d98a1f" : C.line2}`, background: C.surf, color: isComment ? "#d98a1f" : C.sub, textDecoration: "none", fontSize: 10, fontWeight: 800 }}>{isComment ? "🔗 보러가기" : <IC_CARD s={14} col={C.sub} />}</a>}
                            <button onClick={() => deleteOutreach(h.id)} title="이 기록 삭제" style={{ display: "inline-flex", alignItems: "center", padding: "5px 7px", borderRadius: 7, border: `1px solid ${C.line2}`, background: C.surf, color: "#d64545", cursor: "pointer", fontSize: 12, fontWeight: 800 }}>🗑</button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  {/* 페이지네이션 */}
                  {totalPages > 1 && (
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8, padding: "10px 0 12px", borderTop: `1px solid ${C.line}` }}>
                      <button onClick={() => setOutPage(Math.max(0, pg - 1))} disabled={pg === 0} style={{ padding: "6px 12px", borderRadius: 8, border: `1px solid ${C.line2}`, background: C.surf, color: pg === 0 ? C.sub : C.ink, cursor: pg === 0 ? "default" : "pointer", fontSize: 12, fontWeight: 700, fontFamily: "inherit", opacity: pg === 0 ? .5 : 1 }}>← 이전</button>
                      <span style={{ fontSize: 12, color: C.sub, fontWeight: 700 }}>{pg + 1} / {totalPages} <span style={{ fontWeight: 500 }}>(총 {sent.length}건)</span></span>
                      <button onClick={() => setOutPage(Math.min(totalPages - 1, pg + 1))} disabled={pg >= totalPages - 1} style={{ padding: "6px 12px", borderRadius: 8, border: `1px solid ${C.line2}`, background: C.surf, color: pg >= totalPages - 1 ? C.sub : C.ink, cursor: pg >= totalPages - 1 ? "default" : "pointer", fontSize: 12, fontWeight: 700, fontFamily: "inherit", opacity: pg >= totalPages - 1 ? .5 : 1 }}>다음 →</button>
                    </div>
                  )}
                </>
              );
            })()}
          </div>
        );
      })()}

      {/* ── 📊 오늘의 사용량(에너지바) + 발신계정 + 등급표 ── */}
      <div className="ob-sec ob-card" style={{ ...card, padding: 20, marginBottom: 16 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap", marginBottom: 14 }}>
          <div style={{ fontFamily: serif, fontSize: 16, fontWeight: 600, color: C.ink }}>📊 오늘의 사용량 <span style={{ fontSize: 11, fontWeight: 700, color: C.sub, fontFamily: "'Noto Sans KR'" }}>· 자정에 초기화</span></div>
          {/* 계정 상태 요약(자세한 연결 UI는 아래에 항상 표시) */}
          <span style={{ fontSize: 12, fontWeight: 800, padding: "8px 14px", borderRadius: 10, border: `1.5px solid ${connectedMail.length ? "#2f9e5e" : C.line2}`, background: connectedMail.length ? "rgba(47,158,94,.1)" : "transparent", color: connectedMail.length ? "#2f9e5e" : C.sub, whiteSpace: "nowrap" }}>{connectedMail.length ? `✅ 발송 계정 ${connectedMail.length}개 연결됨` : "아래에서 발송 계정을 연결하세요 ↓"}</span>
        </div>
        {/* ✉️ 발송 네이버 계정 연결 — 서이추처럼 항상 눈에 보이게(발송과 별개). 크롤링 전용. */}
        <div style={{ marginBottom: 14 }}>{renderMailAccounts()}</div>
        {(() => {
          const bar = (label: string, ic: string, used: number, limit: number, col: string) => {
            const pct = unlimitedPlan ? 100 : Math.min(100, limit ? (used / limit) * 100 : 0);
            const remain = Math.max(0, limit - used);
            return (
              <div style={{ marginBottom: 12 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 5 }}>
                  <span style={{ fontSize: 12.5, fontWeight: 700, color: C.ink }}>{ic} {label}</span>
                  <span style={{ fontSize: 12, fontWeight: 800, color: unlimitedPlan ? "#8b5cf6" : remain <= 0 ? "#d64545" : col }}>{unlimitedPlan ? "무제한 ∞" : `${used} / ${limit}통 · ${remain}통 남음`}</span>
                </div>
                <div style={{ height: 9, borderRadius: 99, background: C.surf2, overflow: "hidden", border: `1px solid ${C.line}` }}>
                  <div style={{ height: "100%", width: `${pct}%`, borderRadius: 99, background: unlimitedPlan ? "linear-gradient(90deg,#8b5cf6,#00c8ff)" : remain <= 0 ? "#d64545" : `linear-gradient(90deg,${col},${col}bb)`, transition: "width .5s ease" }} />
                </div>
              </div>
            );
          };
          return <>
            {/* 🔴 민감(과금) 안내 — 아주 잘 보이게. 연락처 있는 사람만 한도 차감 */}
            <div style={{ marginBottom: 12, padding: "12px 14px", borderRadius: 10, background: "rgba(47,158,94,.12)", border: "2px solid #2f9e5e", display: "flex", gap: 10, alignItems: "flex-start" }}>
              <span style={{ fontSize: 20, flexShrink: 0, lineHeight: 1.2 }}>📇</span>
              <div style={{ fontSize: 12.5, color: C.ink, fontWeight: 700, lineHeight: 1.6 }}>
                <b style={{ color: "#2f9e5e", fontSize: 13.5 }}>연락처(이메일·카톡·오픈채팅) 있는 사람만 한도에서 차감돼요.</b><br />
                <span style={{ fontWeight: 600, color: C.sub }}>발굴은 많이 돼도, <b style={{ color: C.ink }}>연락할 수 있는 사람만</b> 오늘 한도를 써요. 연락처 없는 블로거는 <b style={{ color: "#2f9e5e" }}>공짜</b>예요 — 한도가 헛되이 닳지 않아요.</span>
              </div>
            </div>
            {bar("크롤링 발굴", "🔍", crawlUsed, crawlLimit, C.accent)}
            {bar("이메일 발송", "✉️", emailUsed, emailLimit, "#2f9e5e")}
          </>;
        })()}
        {/* 회원 대시보드에는 무료·베이직·프로 비교표를 항상 표시한다.
            무제한 회원도 비교표는 볼 수 있지만 무제한 행은 노출하지 않고, 관리자 화면에서만 표를 숨긴다. */}
        {plan !== "admin" && <div className="ob-plan-table" style={{ marginTop: 14, borderRadius: 10, overflow: "hidden", border: `1px solid ${C.line}` }}>
          <div style={{ padding: "9px 12px", fontSize: 12, fontWeight: 800, color: C.ink, background: C.surf2 }}>📋 등급별 크롤링 한도 <span style={{ fontSize: 10.5, fontWeight: 600, color: C.sub }}>· 내 등급에서 하루에 얼마나 발굴·발송할 수 있는지</span></div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr .7fr .9fr .9fr .9fr", background: C.surf2, borderTop: `1px solid ${C.line}` }}>
            {["등급", "👤 계정", "🔍 발굴/일", "✉️ 발송/일", "💬 댓글/일"].map((h, i) => <div key={h} style={{ padding: "8px 10px", fontSize: 10.5, fontWeight: 800, color: C.sub, borderLeft: i ? `1px solid ${C.line}` : "none" }}>{h}</div>)}
          </div>
          {/* ★무제한(관리자 권한)은 회원 등급표에서 제외 — 무료/베이직/프로만 */}
          {(["free", "basic", "pro"] as const).map(pl => {
            const cur = plan === pl;
            const c = PLAN_CONFIG[pl];
            return (
              <div key={pl} style={{ display: "grid", gridTemplateColumns: "1fr .7fr .9fr .9fr .9fr", borderTop: `1px solid ${C.line}`, background: cur ? C.accentSoft : "transparent" }}>
                <div style={{ padding: "9px 10px", fontSize: 12, fontWeight: cur ? 900 : 700, color: cur ? C.accent : C.ink }}>{c.label}{cur ? " (내 등급)" : ""}</div>
                <div style={{ padding: "9px 10px", fontSize: 12, fontWeight: 700, color: C.ink, borderLeft: `1px solid ${C.line}` }}>{c.maxAccounts}개</div>
                <div style={{ padding: "9px 10px", fontSize: 12, fontWeight: 700, color: C.ink, borderLeft: `1px solid ${C.line}` }}>{c.dailyCrawl}명</div>
                <div style={{ padding: "9px 10px", fontSize: 12, fontWeight: 700, color: C.ink, borderLeft: `1px solid ${C.line}` }}>{c.dailyEmail}통</div>
                <div style={{ padding: "9px 10px", fontSize: 12, fontWeight: 700, color: "#d98a1f", borderLeft: `1px solid ${C.line}` }}>{c.dailyComment}개</div>
              </div>
            );
          })}
          <div style={{ padding: "8px 12px", fontSize: 10.5, color: C.sub, background: C.surf2, borderTop: `1px solid ${C.line}` }}>💡 계정=연결 가능한 네이버 계정 수, 크롤링=하루 발굴 인원(<b style={{ color: "#2f9e5e" }}>연락처 있는 사람만 차감</b>), 이메일=하루 발송 통수. 발굴·발송은 자정에 초기화돼요. 이메일은 계정 안전상 하루 100통 이하 권장.</div>
        </div>}
      </div>

      {/* ── 검색 설정 ── */}
      <div className="ob-sec ob-card" style={{ ...card, padding: 22, marginBottom: 16 }}>
        <div style={{ fontFamily: serif, fontSize: 19, fontWeight: 600, marginBottom: 6 }}>Search — 무엇을 찾을까요</div>
        <Help>어떤 블로거를 찾을지 정하는 곳이에요. <b style={{ color: C.ink }}>주제·지역·키워드</b>를 고르고 <b style={{ color: C.ink }}>몇 명</b> 찾을지 정한 뒤, 맨 아래 <b style={{ color: C.accent }}>START SCAN</b>을 누르면 네이버에서 진짜 블로거를 찾아와요.</Help>
        <div style={{ marginBottom: 18 }}>
          <div style={label}>Topic · 주제</div>
          <div className="ob-scroll" style={{ display: "flex", gap: 7, flexWrap: "wrap" }}>{TOPICS.map((t) => t === "ALL"
            ? <span key={t} onClick={() => setTopic(t)} style={{ ...chip(topic === t), fontWeight: 900, ...(topic === t ? {} : { borderColor: C.accent, color: C.accent }) }}>🌐 전체</span>
            : <span key={t} onClick={() => setTopic(t)} style={chip(topic === t)}>{t} <span style={{ opacity: .6, fontSize: 11 }}>{TOPIC_KR[t]}</span></span>)}</div>
          {topic === "ALL" && <div style={{ fontSize: 11, color: C.sub, marginTop: 6, lineHeight: 1.5 }}>🌐 <b>전체</b>: 맛집·뷰티·육아·카페·패션·여행·펫·인테리어·운동·건강 등 <b>모든 주제를 골고루</b> 발굴해요(협찬 친화 주제 우선 = 이메일 공개율 높음).</div>}
        </div>
        <div className="ob-search-grid" style={{ display: "grid", gridTemplateColumns: "1fr 1.4fr 110px", gap: 14, alignItems: "end" }}>
          <div><div style={label}>Region · 지역</div><select value={region} onChange={(e) => setRegion(e.target.value)} style={inp}>{REGIONS.map((r) => <option key={r}>{r}</option>)}</select></div>
          <div><div style={label}>Keyword · 세부 검색어(선택)</div><input value={keyword} onChange={e => setKeyword(e.target.value)} placeholder="예: 감성카페, 아이랑 갈만한곳" style={inp} /></div>
          <div><div style={label}>Count · 인원</div><select value={count} onChange={(e) => setCount(Number(e.target.value))} style={inp}>{[10, 20, 30, 50, 100].map((n) => <option key={n} value={n}>{n}명</option>)}</select></div>
        </div>
        {/* A안: 다른 주제 키워드를 단일 주제 밑에 넣으면 두 주제가 섞임 → '전체'로 두라고 안내 */}
        {keyword.trim() && topic !== "ALL" && <div style={{ fontSize: 11.5, color: C.sub, marginTop: 8, lineHeight: 1.55, background: `${C.accent}0e`, border: `1px solid ${C.accent}44`, borderRadius: 8, padding: "9px 12px" }}>💬 입력한 키워드 <b style={{ color: C.ink }}>“{keyword.trim()}”</b>가 위에서 고른 주제 <b style={{ color: C.ink }}>{TOPIC_KR[topic] || topic}</b>와 <b style={{ color: C.accent }}>다른 주제</b>라면, 주제를 <b onClick={() => setTopic("ALL")} style={{ color: C.accent, cursor: "pointer", textDecoration: "underline" }}>🌐 전체</b>로 두세요. 그래야 <b style={{ color: C.ink }}>그 키워드만</b>으로 정확히 찾아요. (지금은 “{TOPIC_KR[topic] || topic} + {keyword.trim()}” 둘이 섞여 검색돼요)</div>}
        <hr style={{ border: 0, borderTop: `1px solid ${C.line2}`, margin: "20px 0 18px" }} />
        <div style={{ display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
          {!running
            ? <button onClick={startFind} style={{ ...btnSolid, padding: "13px 26px", fontSize: 14, textTransform: "uppercase" }}>Start Scan →</button>
            : <button onClick={stopFind} style={{ border: `1px solid ${C.accent}`, borderRadius: 3, padding: "13px 26px", fontSize: 14, fontWeight: 800, letterSpacing: ".08em", cursor: "pointer", color: C.accent, fontFamily: "inherit", background: "transparent", textTransform: "uppercase" }}>■ Stop</button>}
          {/* 📇 연락처 있는 것만 수집 — 켜면 분석 후 연락처 없는 블로거를 자동으로 빼고 남김 */}
          <label style={{ display: "flex", alignItems: "center", gap: 7, cursor: "pointer", fontSize: 12.5, fontWeight: 700, color: onlyContact ? "#2f9e5e" : C.sub, padding: "8px 12px", borderRadius: 8, border: `1.5px solid ${onlyContact ? "#2f9e5e" : C.line2}`, background: onlyContact ? "rgba(47,158,94,.08)" : "transparent" }}>
            <input type="checkbox" checked={onlyContact} onChange={e => setOnlyContact(e.target.checked)} style={{ accentColor: "#2f9e5e", width: 16, height: 16 }} />
            📇 연락처 있는 사람만 수집
          </label>
          <div style={{ fontSize: 12, color: C.sub, fontWeight: 600 }}>비공개 블로그는 <b style={{ color: C.ink }}>자동으로 건너뜁니다</b></div>
        </div>
        {onlyContact && <div style={{ fontSize: 11, color: C.sub, marginTop: 10, lineHeight: 1.5 }}>💬 발굴 시점엔 연락처를 알 수 없어서(프로필을 방문해야 나와요), <b>먼저 발굴 → 프로필에서 연락처 확인 → 연락처 없는 사람 자동 제외</b> 순으로 처리돼요. 그래서 최종 목록엔 <b style={{ color: "#2f9e5e" }}>연락처 있는 사람만</b> 남아요.</div>}
      </div>

      {/* ── 필터 · 수집항목 ── */}
      <div className="ob-sec ob-filter-grid" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 16 }}>
        <div className="ob-card" style={{ ...card, padding: 22 }}>
          <div style={{ fontFamily: serif, fontSize: 16, fontWeight: 600, marginBottom: 6 }}>Activity Filter · 활동성 거르기</div>
          <Help>죽은 블로그(이웃 적고 글 안 씀)를 <b style={{ color: C.ink }}>걸러내는</b> 조건이에요. 활발한 블로거만 남겨야 체험단 효과가 좋아요.</Help>
          {/* 이웃수 = 직접 입력 */}
          <div style={{ marginBottom: 16 }}>
            <div style={label}>최소 이웃 수 (직접 입력)</div>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <input type="number" min={0} step={100} value={minNeighbors} onChange={(e) => setMinNeighbors(Math.max(0, Number(e.target.value) || 0))} style={{ ...inp, width: 130 }} />
              <span style={{ fontSize: 12, color: C.sub, fontWeight: 700 }}>명 이상</span>
              <div style={{ display: "flex", gap: 5, marginLeft: "auto" }}>{[500, 1000, 3000].map((v) => <span key={v} onClick={() => setMinNeighbors(v)} style={{ ...sChip(false), padding: "5px 9px", fontSize: 11 }}>{v >= 1000 ? v / 1000 + "k" : v}</span>)}</div>
            </div>
          </div>
          {/* 주간 글수 = 직접 입력 */}
          <div style={{ marginBottom: 18 }}>
            <div style={label}>주간 최소 글 수 (직접 입력)</div>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <input type="number" min={0} max={50} value={minPosts} onChange={(e) => setMinPosts(Math.max(0, Number(e.target.value) || 0))} style={{ ...inp, width: 90 }} />
              <span style={{ fontSize: 12, color: C.sub, fontWeight: 700 }}>글 이상 / 주</span>
            </div>
          </div>
          <div style={{ display: "flex", gap: 8 }}><span onClick={() => setActiveOnly((v) => !v)} title="최근 30일 안에 글을 쓴 블로거만 찾아요(휴면 블로그 제외)" style={sChip(activeOnly)}>최근 활동중만</span><span onClick={() => setTopicMatch((v) => !v)} title="정확도순으로 검색해 주제에 더 딱 맞는 블로거를 우선 찾아요" style={sChip(topicMatch)}>주제 일치</span></div>
        </div>
        <div className="ob-card" style={{ ...card, padding: 22 }}>
          <div style={{ display: "flex", alignItems: "center", marginBottom: 6 }}><div style={{ fontFamily: serif, fontSize: 16, fontWeight: 600 }}>Collect — 무엇을 모을까요</div><img src={CH.dodo} onError={chErr("✅")} style={{ width: 30, height: 30, marginLeft: "auto", filter: "saturate(.9)" }} /></div>
          <Help>발굴한 블로거의 <b style={{ color: C.ink }}>어떤 정보를 결과에 담을지</b> 골라요. 켠 항목만 카드·CSV에 나와요.</Help>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 7, marginBottom: 16 }}>{[["email", "이메일"], ["kakao", "카톡 ID"], ["openchat", "오픈채팅"], ["url", "블로그 주소"], ["nick", "닉네임"], ["keywords", "관심 키워드"], ["categories", "주력 품목"]].map(([k, l]) => <span key={k} onClick={() => toggleField(k)} style={sChip(!!fields[k])}>{l}</span>)}</div>
          <div style={{ fontSize: 12, color: C.sub, fontWeight: 600, background: C.surf2, border: `1px solid ${C.line}`, borderRadius: 3, padding: "12px 14px", lineHeight: 1.6 }}>블로그에 <b style={{ color: C.accent }}>공개해 둔 정보</b>만 모읍니다. "협찬·체험단 문의 환영"처럼 열어둔 곳에 정중히 제안하는 건 정당합니다.</div>
        </div>
      </div>

      {/* ── 진행 로그 (넓은 창) ── */}
      {(running || logs.length > 0) && (
        <div className="ob-sec ob-card" style={{ ...card, padding: 22, marginBottom: 16 }}>
          <div style={{ display: "flex", alignItems: "center", marginBottom: 14 }}>
            <div style={{ fontFamily: serif, fontSize: 16, fontWeight: 600 }}>Live Log <span style={{ fontSize: 11, color: C.sub, fontWeight: 600, marginLeft: 4 }}>{logs.length}줄</span></div>
            <button onClick={() => setLogExpand(true)} style={{ ...btnGhost, marginLeft: "auto", padding: "6px 12px", fontSize: 11.5 }}>⤢ 크게 보기</button>
          </div>
          <div style={{ height: 8, background: C.surf2, border: `1px solid ${C.line}`, overflow: "hidden", marginBottom: 12 }}>
            <div style={{ height: "100%", width: `${progress}%`, background: running ? `repeating-linear-gradient(45deg,${C.ink},${C.ink} 8px,${C.accent} 8px,${C.accent} 16px)` : C.ink, backgroundSize: "26px 26px", animation: running ? "obBar .7s linear infinite" : "none", transition: "width .4s" }} />
          </div>
          {/* 적당히 보이는 기본 로그 (260px) */}
          <div className="ob-scroll" style={{ height: 260, overflowY: "auto", background: C.logBg, border: `1px solid ${C.line}`, borderRadius: 3, padding: "12px 16px", fontFamily: "'JetBrains Mono',monospace", fontSize: 12, lineHeight: 1.95, color: C.logInk, whiteSpace: "pre-wrap" }}>
            {logs.length === 0 ? <span style={{ color: C.sub }}>대기 중…</span> : logs.map((l, i) => <div key={i}>{l}</div>)}
          </div>
        </div>
      )}

      {/* ── 결과 ── */}
      {results.length > 0 && (
        <div className="ob-sec ob-card" style={{ ...card, padding: 22, marginBottom: 16 }}>
          <div style={{ display: "flex", alignItems: "flex-end", gap: 12, flexWrap: "wrap", marginBottom: 0, paddingBottom: 16, borderBottom: `1px solid ${C.line}` }}>
            <div><div style={eyebrow}>Curated</div><div style={{ fontFamily: serif, fontSize: 20, fontWeight: 600, marginTop: 5 }}>발굴된 블로거 {shown.length}명</div></div>
            <div style={{ marginLeft: "auto", display: "flex", gap: 7, alignItems: "center", flexWrap: "wrap" }}>
              <span onClick={() => { loadOutHistory(); setHistoryOpen(true); }} title="지금까지 누구에게 이메일을 보냈는지 기록을 봐요" style={sChip(false)}>📮 보낸 글 이력</span>
              <span onClick={() => setOnlyContact((v) => !v)} title="공개 연락처(이메일·카톡·오픈채팅)가 있는 블로거만 화면에 보여줘요" style={sChip(onlyContact)}>연락처 있는 것만</span>
              <span onClick={() => setHideDormant((v) => !v)} title="최근 글이 없는 휴면 블로거를 숨겨요(진정성 분석 후 활성도가 채워져요)" style={sChip(hideDormant)}>🔥 활동중만</span>
              <select value={commFilter} onChange={(e) => setCommFilter(e.target.value as any)} title="상업성(최근 글 제목의 협찬·체험단 표시 비율)으로 걸러요 — 진정성 분석 후 채워져요" style={{ ...inp, width: "auto", padding: "7px 10px", fontSize: 12 }}><option value="all">상업성 전체</option><option value="pure">순수후기 위주(협찬↓)</option><option value="ad">협찬 많은(협찬↑)</option></select>
              <select value={sortBy} onChange={(e) => setSortBy(e.target.value as any)} title="블로거 정렬 기준" style={{ ...inp, width: "auto", padding: "7px 10px", fontSize: 12 }}><option value="score">진정성순</option><option value="neighbors">이웃순</option><option value="posts">글 많은순</option></select>
              <span onClick={() => setSelected(new Set(shown.map((b) => b.id)))} style={sChip(false)}>전체선택</span>
              {selected.size > 0 && <span onClick={() => setSelected(new Set())} style={{ ...sChip(false), color: C.accent, borderColor: C.accent }}>해제 {selected.size}</span>}
              {/* 🗑️ 수집 데이터 삭제 — 선택 / 선택 외 / 연락처 없는 것 / 전체 */}
              {selected.size > 0 && <span onClick={() => { setResults(prev => prev.filter(b => !selected.has(b.id))); const n = selected.size; setSelected(new Set()); toast(`🗑️ 선택한 ${n}명 삭제`, "success"); }} title="선택한 블로거를 지워요" style={{ ...sChip(false), color: "#d64545", borderColor: "#d64545" }}>🗑 선택 삭제 {selected.size}</span>}
              {selected.size > 0 && <span onClick={() => { const keep = results.filter(b => selected.has(b.id)); const removed = results.length - keep.length; setResults(keep); toast(`🗑️ 선택 안 한 ${removed}명 삭제(선택 ${keep.length}명만 남김)`, "success"); }} title="선택한 블로거만 남기고 나머지는 다 지워요(안 쓸 블로거 정리)" style={{ ...sChip(false), color: "#d64545", borderColor: "#d64545" }}>🗑 선택 외 삭제</span>}
              {results.some(b => !(b.email || b.kakao || b.openchat)) && <span onClick={() => { const keep = results.filter(b => b.email || b.kakao || b.openchat); const removed = results.length - keep.length; if (window.confirm(`연락처 없는 ${removed}명을 지울까요? (연락처 있는 ${keep.length}명만 남겨요)`)) { setResults(keep); setSelected(s => new Set([...s].filter(id => keep.some(b => b.id === id)))); toast(`🗑️ 연락처 없는 ${removed}명 삭제`, "success"); } }} title="공개 연락처가 없는 블로거를 전부 지워요(제안 못 하는 사람 정리)" style={{ ...sChip(false), color: "#d64545", borderColor: "#d64545" }}>🗑 연락처 없는 것 삭제</span>}
              {shown.length > 0 && <span onClick={() => { if (window.confirm(`발굴한 ${results.length}명을 전부 지울까요?`)) { setResults([]); setSelected(new Set()); toast("🗑️ 발굴 목록을 비웠어요", "success"); } }} title="발굴한 목록을 전부 지워요" style={{ ...sChip(false), color: "#d64545", borderColor: "#d64545" }}>🗑 전체 삭제</span>}
            </div>
          </div>
          <Help>발굴된 블로거예요. <b style={{ color: C.ink }}>🩺 진정성</b>은 가짜·품앗이인지 감별한 점수(<b style={{ color: "#2f9e5e" }}>초록=진짜</b>/<b style={{ color: "#d98a1f" }}>주황=주의</b>/<b style={{ color: "#d64545" }}>빨강=의심</b>). 카드를 <b style={{ color: C.ink }}>골라서</b> 아래 <b style={{ color: C.accent }}>이메일 보내기</b>로 체험단을 제안해요. <b style={{ color: C.ink }}>상세 →</b>를 누르면 그 블로그를 직접 열어볼 수 있어요.</Help>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(250px,1fr))", borderLeft: `1px solid ${C.line}`, borderTop: `1px solid ${C.line}` }}>
            {shown.map((b) => {
              const on = selected.has(b.id);
              const gr = b.score >= 75 ? "S" : b.score >= 55 ? "A" : "B";
              return (
                <div key={b.id} style={{ padding: 16, borderRight: `1px solid ${C.line}`, borderBottom: `1px solid ${C.line}`, background: on ? C.accentSoft : "transparent", position: "relative", transition: "background .15s" }}>
                  <div onClick={() => toggleSel(b.id)} style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 9, cursor: "pointer" }}>
                    {/* 프로필 이미지(네이버 검색 API 제공) — 실패 시 등급 문자로 폴백 */}
                    {b.thumbnail
                      ? <img src={b.thumbnail} alt={b.nick} referrerPolicy="no-referrer" onError={e => { const d = document.createElement("div"); d.textContent = gr; d.style.cssText = `font-family:${serif};font-size:20px;font-weight:600;width:38px;height:38px;display:flex;align-items:center;justify-content:center;border-radius:50%;background:${C.surf2};color:${C.sub};flex-shrink:0`; e.currentTarget.replaceWith(d); }} style={{ width: 38, height: 38, borderRadius: "50%", objectFit: "cover", flexShrink: 0, border: `1px solid ${C.line2}` }} />
                      : <div style={{ width: 38, height: 38, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", background: C.surf2, fontFamily: serif, fontSize: 20, fontWeight: 600, color: on ? C.accent : C.sub, flexShrink: 0 }}>{gr}</div>}
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div style={{ fontSize: 14, fontWeight: 800, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{b.nick}</div>
                      <div style={{ fontSize: 10.5, color: C.sub, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{b.url}</div>
                    </div>
                    <div style={{ width: 18, height: 18, borderRadius: 2, border: `1px solid ${on ? C.accent : C.line2}`, background: on ? C.accent : "transparent", color: C.surf, fontSize: 12, fontWeight: 900, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>{on ? "✓" : ""}</div>
                  </div>
                  <div style={{ display: "flex", gap: 8, marginBottom: 8, fontSize: 11, color: C.sub, fontWeight: 700, flexWrap: "wrap", alignItems: "center" }}>
                    <span>🕒 {b.lastActive}</span>
                    {b.source === "place" && <span title="플레이스에서 업체 리뷰를 확인해 가져온 블로거예요" style={{ color: "#16856b", background: "rgba(22,133,107,.12)", padding: "2px 8px", borderRadius: 20, fontWeight: 900 }}>🗺️ 플레이스 리뷰어{b.sourcePlaces?.length ? ` · ${b.sourcePlaces.length}곳` : ""}</span>}
                    {b.neighbors > 0 && <span>이웃 {b.neighbors.toLocaleString()}</span>}
                    {/* 🏷️ 실제 주력 주제(최근 글 제목 자동분류) — 검색 키워드보다 정확 */}
                    {b.mainTopic && <span title="최근 글 제목으로 자동 분류한 실제 주력 주제" style={{ fontWeight: 800, color: C.accent, background: `${C.accent}14`, padding: "2px 8px", borderRadius: 20 }}>🏷️ {b.mainTopic}</span>}
                    {/* 🔥 활성도: 진정성 분석 후 채워지는 주간 포스팅 수(활발할수록 체험단에 좋음) */}
                    {b.postsPerWeek != null && b.postsPerWeek > 0 && <span title="최근 글 기준 주당 포스팅 수(활동성)" style={{ color: b.postsPerWeek >= 3 ? "#2f9e5e" : C.sub }}>🔥 주 {b.postsPerWeek}글</span>}
                    {/* 📊 상업성: 최근 글 제목의 협찬·체험단 표시 비율(순수후기↔협찬多) */}
                    {b.adRatio != null && <span title="최근 글 제목의 협찬·체험단 표시 비율 — 낮을수록 순수후기 위주, 높을수록 협찬글 많음" style={{ fontWeight: 800, color: b.adRatio <= 0.3 ? "#2f9e5e" : b.adRatio >= 0.5 ? "#d64545" : "#d98a1f", background: b.adRatio <= 0.3 ? "rgba(47,158,94,.12)" : b.adRatio >= 0.5 ? "rgba(214,69,69,.12)" : "rgba(217,138,31,.12)", padding: "2px 8px", borderRadius: 20 }}>📊 협찬 {Math.round(b.adRatio * 100)}%</span>}
                    {/* 💬❤️ 인게이지먼트: 글당 평균 댓글·공감(진짜 독자 반응). 이웃 수는 많은데 반응이 적으면 '껍데기 이웃' 의심 */}
                    {(b.avgComments != null || b.avgSympathy != null) && <span title="글당 평균 댓글·공감 수 — 진짜 독자가 반응하는지 보는 지표(이웃 수 대비 반응이 적으면 품앗이·죽은 이웃 의심). 댓글=최근 글, 공감=최근 3개 표본" style={{ fontWeight: 800, color: "#7b5cff", background: "rgba(123,92,255,.12)", padding: "2px 8px", borderRadius: 20 }}>💬 댓글 {b.avgComments ?? "–"}{b.avgSympathy != null ? ` · ❤️ 공감 ${b.avgSympathy}` : ""}</span>}
                    {/* 🩺 진정성 점수: 상세에서 이웃·참여율 정밀 분석 후 채워짐. 색상=신뢰도(초록=진짜/주황=주의/빨강=의심) */}
                    {b.authenticity != null
                      ? <span title="AI 진정성 점수 — 참여율 대비 이웃수로 가짜·품앗이 감별(높을수록 진짜 영향력)" style={{ fontWeight: 800, color: b.authenticity >= 70 ? "#2f9e5e" : b.authenticity >= 45 ? "#d98a1f" : "#d64545", background: b.authenticity >= 70 ? "rgba(47,158,94,.12)" : b.authenticity >= 45 ? "rgba(217,138,31,.12)" : "rgba(214,69,69,.12)", padding: "2px 8px", borderRadius: 20 }}>🩺 진정성 {b.authenticity}</span>
                      : <span style={{ color: C.sub, fontWeight: 600, fontStyle: "italic" }}>상세로 진정성 분석</span>}
                  </div>
                  {/* 관심 키워드 미리보기 */}
                  <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginBottom: 8 }}>
                    {b.keywords.slice(0, 3).map((k) => <span key={k} style={{ fontSize: 10, fontWeight: 700, color: C.sub, background: C.surf2, padding: "2px 6px", borderRadius: 2 }}>#{k}</span>)}
                  </div>
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
                    {b.email && <span style={{ fontSize: 10, fontWeight: 700, color: C.ink, border: `1px solid ${C.line2}`, padding: "2px 7px", borderRadius: 2 }}>이메일</span>}
                    {b.kakao && <span style={{ fontSize: 10, fontWeight: 700, color: C.ink, border: `1px solid ${C.line2}`, padding: "2px 7px", borderRadius: 2 }}>카톡</span>}
                    {b.instagram && <a href={`https://instagram.com/${b.instagram}`} target="_blank" rel="noopener noreferrer" onClick={e => e.stopPropagation()} title={`인스타 @${b.instagram}`} style={{ fontSize: 10, fontWeight: 700, color: "#c13584", border: "1px solid #c1358455", padding: "2px 7px", borderRadius: 2, textDecoration: "none" }}>📷 인스타</a>}
                    {b.youtube && <a href={`https://${b.youtube}`} target="_blank" rel="noopener noreferrer" onClick={e => e.stopPropagation()} title={b.youtube} style={{ fontSize: 10, fontWeight: 700, color: "#ff0000", border: "1px solid #ff000044", padding: "2px 7px", borderRadius: 2, textDecoration: "none" }}>▶ 유튜브</a>}
                    {!b.email && !b.kakao && !b.openchat && !b.instagram && !b.youtube && <span style={{ fontSize: 10, color: C.sub }}>공개 연락처 없음</span>}
                    {/* 발송 여부는 위쪽 '아웃리치 추적 대시보드'에서 한곳에서 관리 (카드엔 배지 안 둠) */}
                    <button onClick={() => setDetail(b)} style={{ marginLeft: "auto", ...btnGhost, padding: "4px 9px", fontSize: 10.5 }}>상세 →</button>
                  </div>
                </div>
              );
            })}
          </div>
          {/* 아웃리치 */}
          <div style={{ display: "flex", alignItems: "center", gap: 14, marginTop: 18, paddingTop: 18, borderTop: `1px solid ${C.line}`, flexWrap: "wrap" }}>
            <img src={CH.bori} onError={chErr("🌱")} className="ob-bob" style={{ width: 44, height: 44, filter: "saturate(.9)" }} />
            <div style={{ flex: 1, minWidth: 150 }}>
              <div style={{ fontSize: 13.5, fontWeight: 800 }}>{selected.size > 0 ? `${selected.size}명 선택됨` : "체험단 제안 보내기"}</div>
              <div style={{ fontSize: 11.5, color: C.sub, fontWeight: 600 }}>이메일 발송 · 블로그 댓글 제안 · 공개 문의처로만</div>
            </div>
            <button onClick={() => { if (!selected.size) { toast("먼저 블로거를 선택하세요", "info"); return; } setOutreach("email"); }} style={btnGhost}>✉ 이메일 보내기</button>
            <button onClick={() => { if (!selected.size) { toast("먼저 블로거를 선택하세요", "info"); return; } setOutreach("comment"); }} style={btnGhost}>💬 댓글 달기</button>
            <button onClick={downloadCsv} style={btnSolid}>명단 CSV ↓</button>
          </div>
        </div>
      )}

      {/* ── 고급 설정 ── */}
      <div className="ob-sec ob-card" style={{ ...card, padding: 22 }}>
        <div onClick={() => setAdvOpen((v) => !v)} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", cursor: "pointer", marginBottom: advOpen ? 18 : 0 }}>
          <span style={{ fontFamily: serif, fontSize: 16, fontWeight: 600, display: "flex", alignItems: "center", gap: 8 }}>Advanced <img src={CH.pumi} onError={chErr("💬")} style={{ width: 26, height: 26, filter: "saturate(.9)" }} /></span>
          <span style={{ fontSize: 11.5, fontWeight: 800, letterSpacing: ".1em", color: C.sub, textTransform: "uppercase" }}>{advOpen ? "− 닫기" : "+ 열기"}</span>
        </div>
        {advOpen && (<>
          <Help><b style={{ color: C.ink }}>수집 속도</b>=천천히 모을수록 계정이 안전해요(빠르면 네이버가 의심할 수 있어요). <b style={{ color: C.ink }}>하루 최대</b>=하루에 몇 명까지 모을지 한도. <b style={{ color: C.ink }}>제외 키워드</b>=이 말이 프로필에 있으면 건너뛰어요(예: "협찬거부").</Help>
          <div className="ob-detail-grid" style={{ display: "grid", gridTemplateColumns: "1.2fr 1fr 1.5fr", gap: 16 }}>
            <div><div style={label}>수집 속도 (계정 안전)</div><div style={{ display: "flex", gap: 7 }}>{["느림", "보통", "빠름"].map((s) => <span key={s} onClick={() => setSpeed(s)} style={{ ...sChip(speed === s), flex: 1, textAlign: "center" }}>{s}</span>)}</div></div>
            <div><div style={label}>하루 최대</div><select value={dailyLimit} onChange={(e) => setDailyLimit(Number(e.target.value))} style={inp}>{[100, 200, 500, 1000].map((n) => <option key={n} value={n}>{n}명</option>)}</select></div>
            <div><div style={label}>제외 키워드</div><input value={excludeKw} onChange={(e) => setExcludeKw(e.target.value)} placeholder="예: 협찬거부, 홍보사절" style={inp} /></div>
          </div>
        </>)}
      </div>

      {/* ═══ 블로거 상세 분석 모달 ═══ */}
      {detail && createPortal((
        <div onClick={() => setDetail(null)} style={{ position: "fixed", inset: 0, background: "rgba(20,16,12,.55)", backdropFilter: "blur(3px)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 99999, padding: 20 }}>
          <div onClick={(e) => e.stopPropagation()} style={{ background: C.surf, border: `1px solid ${C.line2}`, borderRadius: 6, maxWidth: 480, width: "100%", maxHeight: "86vh", overflowY: "auto", boxShadow: "0 30px 80px rgba(0,0,0,.5)" }}>
            <div style={{ padding: "22px 24px", borderBottom: `1px solid ${C.line}`, display: "flex", alignItems: "flex-start", gap: 12 }}>
              {detail.thumbnail
                ? <img src={detail.thumbnail} alt={detail.nick} referrerPolicy="no-referrer" onError={e => { const d = document.createElement("div"); d.textContent = "B"; d.style.cssText = `font-family:${serif};font-size:24px;font-weight:600;width:48px;height:48px;display:flex;align-items:center;justify-content:center;border-radius:50%;background:${C.surf2};color:${C.sub}`; e.currentTarget.replaceWith(d); }} style={{ width: 48, height: 48, borderRadius: "50%", objectFit: "cover", border: `1px solid ${C.line2}` }} />
                : <div style={{ width: 48, height: 48, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", background: C.surf2, fontFamily: serif, fontSize: 24, fontWeight: 600, color: C.accent }}>B</div>}
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 18, fontWeight: 900 }}>{detail.nick}</div>
                <div style={{ fontSize: 11.5, color: C.sub }}>{detail.url}</div>
              </div>
              <button onClick={() => setDetail(null)} style={{ ...btnGhost, padding: "5px 10px" }}>✕</button>
            </div>
            <div style={{ padding: "20px 24px" }}>
              {/* 지표 그리드 — 이웃/방문자/참여율은 남의 블로그라 로그인 세션 없이 못 읽음 → 미확인 정직 표시 */}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 0, border: `1px solid ${C.line}`, marginBottom: 14 }}>
                {[["이웃 수", detail.neighbors > 0 ? detail.neighbors.toLocaleString() : "—"], ["최근 활동", detail.lastActive], ["관심 키워드", (detail.keywords[0] || "—")]].map(([l, v], i) => (
                  <div key={i} style={{ padding: "12px 14px", borderLeft: i % 3 ? `1px solid ${C.line}` : "none" }}>
                    <div style={{ ...label, marginBottom: 5 }}>{l}</div>
                    <div style={{ fontFamily: serif, fontSize: 16, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{v}</div>
                  </div>
                ))}
              </div>
              {/* 실제 블로그 방문(공개 정보 직접 확인) */}
              <a href={`https://${detail.url}`} target="_blank" rel="noopener noreferrer" style={{ display: "block", textAlign: "center", padding: "10px", marginBottom: 20, borderRadius: 4, border: `1px solid ${C.accent}`, color: C.accent, fontSize: 13, fontWeight: 800, textDecoration: "none" }}>🔗 블로그 열어서 직접 확인하기 →</a>
              {/* 관심 키워드 */}
              <div style={{ marginBottom: 18 }}>
                <div style={label}>자주 쓰는 키워드</div>
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>{detail.keywords.map((k) => <span key={k} style={{ fontSize: 12, fontWeight: 700, color: C.ink, border: `1px solid ${C.line2}`, padding: "5px 10px", borderRadius: 2 }}>#{k}</span>)}</div>
              </div>
              {/* 주력 품목 */}
              <div style={{ marginBottom: 18 }}>
                <div style={label}>주력 품목 · 카테고리</div>
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>{detail.categories.map((c) => <span key={c} style={{ fontSize: 12, fontWeight: 700, color: C.surf, background: C.ink, padding: "5px 10px", borderRadius: 2 }}>{c}</span>)}</div>
              </div>
              {/* 연락처 */}
              <div style={{ marginBottom: 20 }}>
                <div style={label}>공개 연락처</div>
                <div style={{ fontSize: 13, color: C.ink, fontWeight: 600, lineHeight: 1.8 }}>
                  {detail.email ? <div>✉ {detail.email}</div> : null}
                  {detail.kakao ? <div>💬 카톡 {detail.kakao}</div> : null}
                  {detail.openchat ? <div>🔗 {detail.openchat}</div> : null}
                  {!detail.email && !detail.kakao && !detail.openchat ? <span style={{ color: C.sub }}>공개된 연락처가 없어요 (블로그 댓글로만 제안 가능)</span> : null}
                </div>
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <button onClick={() => { setSelected(new Set([detail.id])); setDetail(null); setOutreach("email"); }} style={{ ...btnGhost, flex: 1 }}>✉ 이메일 제안</button>
                <button onClick={() => { setSelected(new Set([detail.id])); setDetail(null); setOutreach("comment"); }} style={{ ...btnSolid, flex: 1 }}>💬 댓글 제안</button>
              </div>
            </div>
          </div>
        </div>
      ), document.body)}

      {/* ═══ 아웃리치 모달 (이메일 / 댓글) ═══ */}
      {outreach && createPortal((
        <div onClick={() => setOutreach(null)} style={{ position: "fixed", inset: 0, background: "rgba(20,16,12,.55)", backdropFilter: "blur(3px)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 99999, padding: 20 }}>
          <div onClick={(e) => e.stopPropagation()} style={{ background: C.surf, border: `1px solid ${C.line2}`, borderRadius: 6, maxWidth: 520, width: "100%", maxHeight: "90vh", display: "flex", flexDirection: "column", boxShadow: "0 30px 80px rgba(0,0,0,.5)" }}>
            <div style={{ padding: "20px 24px", borderBottom: `1px solid ${C.line}`, display: "flex", alignItems: "center", gap: 10, flexShrink: 0 }}>
              <img src={CH.bori} onError={chErr("🌱")} style={{ width: 40, height: 40 }} />
              <div style={{ flex: 1 }}>
                <div style={{ fontFamily: serif, fontSize: 18, fontWeight: 600 }}>{outreach === "email" ? "이메일 제안 보내기" : "블로그 댓글 제안"}</div>
                <div style={{ fontSize: 11.5, color: C.sub }}>{outreach === "email" ? "선택한 블로거 + 직접 입력한 이메일로 발송" : `${selected.size}명 대상 · 각 블로그에 정중한 댓글`}</div>
              </div>
              <button onClick={() => setOutreach(null)} style={{ ...btnGhost, padding: "5px 10px" }}>✕</button>
            </div>
            <div style={{ padding: "20px 24px", overflowY: "auto", flex: 1 }}>
              {/* 이메일: 크롤링 전용 발송 계정 연결(다른 탭과 별개) + 선택 + 제목 */}
              {outreach === "email" && (
                <div style={{ marginBottom: 14 }}>
                  {/* 발송 계정은 위(오늘의 사용량)에서 이미 연결 — 여기선 어느 계정으로 보낼지 확인만 */}
                  <div style={{ fontSize: 11.5, fontWeight: 700, color: connectedMail.length ? "#2f9e5e" : "#d98a1f", marginBottom: 8, padding: "8px 11px", borderRadius: 6, background: connectedMail.length ? "rgba(47,158,94,.08)" : "rgba(217,138,31,.1)", border: `1px solid ${connectedMail.length ? "rgba(47,158,94,.3)" : "rgba(217,138,31,.35)"}` }}>
                    {connectedMail.length
                      ? <>✉️ 발송 계정: <b>{connectedMail.find(a => a.accountId === mailAcctId)?.blogId || connectedMail[0].blogId}</b>{connectedMail.length > 1 ? ` 외 ${connectedMail.length - 1}개 (위에서 선택)` : ""}</>
                      : <>⚠️ 위 <b>‘오늘의 사용량’</b>에서 발송할 네이버 계정을 먼저 연결하세요.</>}
                  </div>
                  {/* 내 업체명 — {업체명} 자동 치환. 회원 각자 자기 걸로. 한 번 넣으면 저장됨 */}
                  <span style={{ color: C.sub, whiteSpace: "nowrap", display: "block", marginBottom: 4, fontSize: 11.5, fontWeight: 600 }}>내 업체/브랜드명 <span style={{ fontWeight: 500 }}>(제목·본문의 <b>{"{업체명}"}</b>에 자동으로 들어가요)</span>:</span>
                  <input value={outreachBrand} onChange={e => setOutreachBrand(e.target.value)} placeholder="예: OO체험단, OO마케팅, 내 가게 이름 등" style={{ width: "100%", boxSizing: "border-box", padding: "8px 11px", borderRadius: 6, border: `1px solid ${outreachBrand ? C.line2 : "#d98a1f"}`, background: C.surf, color: C.ink, fontFamily: "inherit", fontSize: 13, marginBottom: 10 }} />
                  {/* 메일 제목 */}
                  <span style={{ color: C.sub, whiteSpace: "nowrap", display: "block", marginBottom: 4, fontSize: 11.5, fontWeight: 600 }}>메일 제목:</span>
                  <input value={emailSubject} onChange={e => setEmailSubject(e.target.value)} placeholder="제목을 입력하세요" style={{ width: "100%", boxSizing: "border-box", padding: "8px 11px", borderRadius: 6, border: `1px solid ${C.line2}`, background: C.surf, color: C.ink, fontFamily: "inherit", fontSize: 13 }} />
                  <div style={{ fontSize: 10.5, color: C.sub, marginTop: 4, lineHeight: 1.5 }}>💬 여기 적은 그대로 메일 제목이 돼요. 제목·본문에 <b>{"{업체명}"}·{"{닉네임}"}·{"{관심품목}"}</b>을 쓰면 자동으로 채워져요.</div>
                  {/* ⏱️ 발송 속도 조절 — 계정 안전(천천히 보낼수록 안전) */}
                  <div style={{ marginTop: 12, padding: "11px 13px", borderRadius: 8, background: C.surf2, border: `1px solid ${C.line2}` }}>
                    <div style={{ fontSize: 11.5, fontWeight: 800, color: C.ink, marginBottom: 8 }}>⏱️ 발송 속도 · 계정 안전 <span style={{ fontSize: 10, fontWeight: 600, color: C.sub }}>· 천천히 보낼수록 안전해요</span></div>
                    <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 9 }}>
                      <span style={{ fontSize: 11, fontWeight: 700, color: C.sub, width: 80, flexShrink: 0 }}>한 통 간격</span>
                      <input type="range" min={2} max={30} step={1} value={sendGapSec} onChange={e => setSendGapSec(Number(e.target.value))} style={{ flex: 1, accentColor: "#2f9e5e" }} />
                      <span style={{ fontSize: 12, fontWeight: 800, color: "#2f9e5e", width: 52, textAlign: "right" }}>{sendGapSec}초</span>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                      <span style={{ fontSize: 11, fontWeight: 700, color: C.sub, width: 80, flexShrink: 0 }}>오늘 최대</span>
                      <input type="range" min={0} max={unlimitedPlan ? 200 : emailLimit} step={unlimitedPlan ? 10 : 1} value={sendCapToday} onChange={e => setSendCapToday(Number(e.target.value))} style={{ flex: 1, accentColor: "#2f9e5e" }} />
                      <span style={{ fontSize: 12, fontWeight: 800, color: "#2f9e5e", width: 52, textAlign: "right" }}>{sendCapToday === 0 ? "한도껏" : `${sendCapToday}통`}</span>
                    </div>
                    <div style={{ fontSize: 10, color: C.sub, marginTop: 7, lineHeight: 1.5 }}>💡 간격 <b>{sendGapSec}초</b>(±3초 랜덤) · 오늘 <b>{sendCapToday === 0 ? (unlimitedPlan ? "무제한" : `${emailLimit}통(등급 한도)`) : `${sendCapToday}통까지만`}</b>. 처음엔 <b>천천히·소량</b>으로 계정을 길들이는 걸 권해요.</div>
                  </div>
                </div>
              )}
              <div style={{ marginBottom: 14 }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, flexWrap: "wrap", marginBottom: 8 }}>
                  <div style={label}>메시지 (개인화 변수 사용 가능)</div>
                  {/* 일반/AI 작성 모드 토글 (이메일만) */}
                  {outreach === "email" && (
                    <div style={{ display: "flex", gap: 0, borderRadius: 8, overflow: "hidden", border: `1px solid ${C.line2}` }}>
                      <button onClick={() => setBodyMode("normal")} style={{ padding: "5px 12px", fontSize: 11, fontWeight: 800, border: "none", cursor: "pointer", fontFamily: "inherit", background: bodyMode === "normal" ? C.accent : "transparent", color: bodyMode === "normal" ? C.surf : C.sub }}>✍️ 일반</button>
                      <button onClick={() => setBodyMode("ai")} style={{ padding: "5px 12px", fontSize: 11, fontWeight: 800, border: "none", cursor: "pointer", fontFamily: "inherit", background: bodyMode === "ai" ? "#6d5dd3" : "transparent", color: bodyMode === "ai" ? "#fff" : C.sub }}>✨ AI</button>
                    </div>
                  )}
                </div>

                {/* 일반 모드: 예시 인사말 펼치기/접기 */}
                {outreach === "email" && bodyMode === "normal" && (
                  <div style={{ marginBottom: 8 }}>
                    <button onClick={() => setExampleOpen(o => !o)} style={{ display: "flex", alignItems: "center", gap: 6, width: "100%", padding: "9px 12px", borderRadius: 8, border: `1px solid ${C.line2}`, background: C.surf2, color: C.ink, cursor: "pointer", fontFamily: "inherit", fontSize: 12, fontWeight: 700 }}>
                      <span style={{ transition: "transform .2s", transform: exampleOpen ? "rotate(90deg)" : "none" }}>▶</span>
                      예시 인사말에서 고르기 <span style={{ color: C.sub, fontWeight: 600 }}>· 클릭하면 본문에 채워져요</span>
                    </button>
                    {exampleOpen && (
                      <div style={{ marginTop: 6, display: "flex", flexDirection: "column", gap: 6 }}>
                        {BODY_EXAMPLES.map((ex, i) => (
                          <button key={i} onClick={() => { setEmailBody(ex.text); setExampleOpen(false); toast(`"${ex.label}" 예시를 넣었어요`, "success"); }}
                            style={{ textAlign: "left", padding: "10px 12px", borderRadius: 8, border: `1px solid ${C.line2}`, background: C.surf, cursor: "pointer", fontFamily: "inherit", transition: "border .15s" }}
                            onMouseEnter={e => e.currentTarget.style.borderColor = C.accent} onMouseLeave={e => e.currentTarget.style.borderColor = C.line2}>
                            <div style={{ fontSize: 11.5, fontWeight: 800, color: C.accent, marginBottom: 3 }}>{ex.label}</div>
                            <div style={{ fontSize: 11, color: C.sub, lineHeight: 1.5, whiteSpace: "pre-wrap", maxHeight: 44, overflow: "hidden" }}>{ex.text.replace(/\n\n/g, " ").slice(0, 60)}…</div>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {/* AI 모드: 제목 기반 자동 작성 버튼 */}
                {outreach === "email" && bodyMode === "ai" && (
                  <div style={{ marginBottom: 8, padding: "11px 13px", borderRadius: 8, background: "rgba(109,93,211,.08)", border: "1px solid rgba(109,93,211,.28)" }}>
                    <div style={{ fontSize: 11.5, color: C.sub, marginBottom: 8, lineHeight: 1.5 }}>💬 <b>메일 제목</b>과 <b>내 업체명</b>을 바탕으로 AI가 자연스러운 제안 본문을 써줘요. (제목을 먼저 적어주세요)</div>
                    <button onClick={writeBodyWithAI} disabled={aiWriting} style={{ display: "inline-flex", alignItems: "center", gap: 7, padding: "9px 16px", borderRadius: 9, border: "none", background: "linear-gradient(135deg,#6d5dd3,#9d7bff)", color: "#fff", cursor: "pointer", fontFamily: "inherit", fontSize: 12.5, fontWeight: 800, opacity: aiWriting ? .6 : 1 }}>
                      {aiWriting ? "✨ 작성 중…" : "✨ AI로 본문 작성하기"}
                    </button>
                  </div>
                )}

                <textarea rows={outreach === "email" ? 8 : 4}
                  value={outreach === "email" ? emailBody : commentBody}
                  onChange={e => outreach === "email" ? setEmailBody(e.target.value) : setCommentBody(e.target.value)}
                  placeholder={outreach === "email" ? "여기에 보낼 내용을 적으세요.\n\n위에서 예시를 고르거나, AI로 작성할 수도 있어요.\n{닉네임}·{관심품목}·{업체명}을 넣으면 블로거마다 자동으로 채워져요." : "댓글 내용을 적으세요"}
                  style={{ ...inp, resize: "vertical", lineHeight: 1.8 }} />
              </div>
              {/* ✍️ 이메일 직접 추가 — 발굴 결과에 없는 사람에게도 보내기 / 내 명단만으로 캠페인(발굴 0명이어도 됨) */}
              {outreach === "email" && (() => {
                const manualList = parseEmails(manualEmails);
                const pickedN = shown.filter(b => selected.has(b.id) && b.email).length;
                const pickedSet = new Set(shown.filter(b => selected.has(b.id) && b.email).map(b => (b.email || "").toLowerCase()));
                const manualN = manualList.filter(e => !pickedSet.has(e)).length;
                return (
                  <div style={{ marginBottom: 14 }}>
                    <div style={label}>✍️ 이메일 직접 추가 <span style={{ fontWeight: 600, textTransform: "none", letterSpacing: 0, color: C.sub }}>· 발굴에 없는 사람도, 내 명단만으로도</span></div>
                    <textarea rows={2} value={manualEmails} onChange={e => setManualEmails(e.target.value)} placeholder="이메일을 붙여넣거나 입력하세요 (쉼표·줄바꿈 구분)&#10;예: hong@naver.com, kim@daum.net" style={{ ...inp, resize: "vertical", lineHeight: 1.6, fontFamily: "'Noto Sans KR',monospace" }} />
                    {manualList.length > 0 && <div style={{ fontSize: 11, color: C.accent, fontWeight: 700, marginTop: 5 }}>✓ 유효한 이메일 {manualList.length}개 인식됨{manualN < manualList.length ? ` (선택과 중복 ${manualList.length - manualN}개 제외)` : ""}</div>}
                    {pickedN === 0 && manualN > 0 && <div style={{ fontSize: 11, color: C.sub, marginTop: 3 }}>💡 발굴 없이 <b>내 명단만으로 발송</b>돼요. (닉네임 자동채움은 발굴한 블로거만 적용)</div>}
                  </div>
                );
              })()}
              <div style={{ fontSize: 11.5, color: C.sub, fontWeight: 600, background: C.surf2, border: `1px solid ${C.line}`, borderRadius: 3, padding: "10px 13px", lineHeight: 1.6, marginBottom: 18 }}>
                💡 <b>{"{업체명}"}·{"{닉네임}"}·{"{관심키워드}"}·{"{관심품목}"}</b>는 자동으로 채워져요({"{업체명}"}=위에 적은 내 업체명). {outreach === "comment" ? "" : `발송은 로그인된 네이버 창을 열어 서이추처럼 보내요(앱 비밀번호 불필요). 계정 안전을 위해 하루 ${emailLimit || 50}통까지, 3~6초 간격으로 보내요. 발송 중엔 창을 닫지 마세요.`}
                {outreach === "comment" && <span style={{ display: "block", marginTop: 8, padding: "10px 12px", borderRadius: 8, background: "rgba(214,69,69,.1)", border: "1px solid rgba(214,69,69,.35)", color: "#d64545", fontWeight: 700, lineHeight: 1.6 }}>⚠️ <b>계정 안전 주의</b> — 모르는 블로거 글에 홍보 댓글은 네이버가 <b>스팸·도배로 감지</b>해 계정이 제한될 수 있어요. 그래서 <b>오늘 5명까지·40~90초 간격</b>으로만 아주 천천히 답니다. 되도록 <b>자연스러운 댓글</b>(홍보 티 최소화)을 권해요. 이메일이 더 안전해요.</span>}
              </div>
            </div>
            {/* 하단 고정 버튼 바(스크롤 밖) — 내용이 길어도 발송 버튼이 항상 보이게 */}
            <div style={{ display: "flex", gap: 8, padding: "14px 24px", borderTop: `1px solid ${C.line}`, flexShrink: 0, background: C.surf }}>
              <button onClick={() => setOutreach(null)} disabled={sending} style={{ ...btnGhost, flex: 1 }}>취소</button>
              {outreach === "email"
                ? (() => { const pickedN = shown.filter(b => selected.has(b.id) && b.email).length; const pickedSet = new Set(shown.filter(b => selected.has(b.id) && b.email).map(b => (b.email || "").toLowerCase())); const manualN = parseEmails(manualEmails).filter(e => !pickedSet.has(e)).length; const totalN = pickedN + manualN; return <button onClick={sendEmails} disabled={sending || totalN === 0} style={{ ...btnSolid, flex: 2, opacity: (sending || totalN === 0) ? .6 : 1 }}>{sending ? "발송 중..." : `${totalN}명에게 실제 발송 →`}</button>; })()
                : <button onClick={sendComments} disabled={sending || selected.size === 0} style={{ ...btnSolid, flex: 2, opacity: (sending || selected.size === 0) ? .6 : 1 }}>{sending ? "댓글 다는 중..." : `${Math.min(5, selected.size)}명에게 댓글 달기 →`}</button>}
            </div>
          </div>
        </div>
      ), document.body)}

      {/* ═══ 보낸 글 이력 모달 (CRM) ═══ */}
      {historyOpen && createPortal((
        <div onClick={() => setHistoryOpen(false)} style={{ position: "fixed", inset: 0, background: "rgba(20,16,12,.55)", backdropFilter: "blur(3px)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100000, padding: 20 }}>
          <div onClick={e => e.stopPropagation()} style={{ background: C.surf, border: `1px solid ${C.line2}`, borderRadius: 6, maxWidth: 620, width: "100%", maxHeight: "86vh", display: "flex", flexDirection: "column", boxShadow: "0 30px 80px rgba(0,0,0,.5)" }}>
            <div style={{ padding: "20px 24px", borderBottom: `1px solid ${C.line}`, display: "flex", alignItems: "center", gap: 10 }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontFamily: serif, fontSize: 18, fontWeight: 600 }}>보낸 글 이력</div>
                <div style={{ fontSize: 11.5, color: C.sub }}>누구에게 언제 무엇을 보냈는지 · 총 {outHistory.length}건</div>
              </div>
              <button onClick={() => setHistoryOpen(false)} style={{ ...btnGhost, padding: "5px 10px" }}>✕</button>
            </div>
            <div className="ob-scroll" style={{ padding: "12px 20px", overflowY: "auto", flex: 1 }}>
              {outHistory.length === 0 ? <div style={{ textAlign: "center", padding: "40px 20px", color: C.sub, fontSize: 13 }}>아직 보낸 글이 없어요.<br />블로거를 선택해 이메일을 보내면 여기에 기록돼요.</div>
                : outHistory.map((h, i) => (
                  <div key={i} style={{ padding: "11px 0", borderBottom: `1px solid ${C.line}`, display: "flex", alignItems: "center", gap: 10 }}>
                    <span style={{ fontSize: 14 }}>{h.channel === "email" ? "✉️" : "💬"}</span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 12.5, fontWeight: 700, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{h.nickname || h.blog_id} {h.to_email && <span style={{ color: C.sub, fontWeight: 400 }}>· {h.to_email}</span>}</div>
                      <div style={{ fontSize: 10.5, color: C.sub, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{h.subject || h.message?.slice(0, 40)}</div>
                    </div>
                    <div style={{ textAlign: "right", flexShrink: 0 }}>
                      <div style={{ fontSize: 10, fontWeight: 800, color: h.status === "failed" ? "#d64545" : h.status === "sent" ? "#2f9e5e" : C.accent }}>{h.status === "sent" ? "발송됨" : h.status === "failed" ? "실패" : h.status}</div>
                      <div style={{ fontSize: 9.5, color: C.sub }}>{new Date(h.sent_at).toLocaleString("ko-KR", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })}</div>
                    </div>
                  </div>
                ))}
            </div>
          </div>
        </div>
      ), document.body)}

      {/* ═══ 📬 "할 일 N건" 큰 팝업 (수동 모드 — 무응답 대상에게 팔로우업) ═══ */}
      {todoOpen && createPortal((
        <div onClick={() => setTodoOpen(false)} style={{ position: "fixed", inset: 0, background: "rgba(20,16,12,.6)", backdropFilter: "blur(4px)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100000, padding: 20 }}>
          <div onClick={e => e.stopPropagation()} style={{ background: C.surf, borderRadius: 18, maxWidth: 560, width: "100%", maxHeight: "88vh", display: "flex", flexDirection: "column", boxShadow: "0 40px 100px -20px rgba(0,0,0,.6)", border: `1px solid ${C.line2}`, overflow: "hidden", animation: "obTodoPop .45s cubic-bezier(.22,1.2,.4,1) both" }}>
            {/* 헤더 */}
            <div style={{ padding: "20px 24px", background: `linear-gradient(135deg, #d98a1f, #c2761a)`, color: "#fff", position: "relative", overflow: "hidden", flexShrink: 0 }}>
              <div style={{ position: "absolute", right: -30, top: -40, width: 150, height: 150, borderRadius: "50%", background: "radial-gradient(circle, rgba(255,255,255,.22), transparent 65%)" }} />
              <div style={{ position: "relative", zIndex: 1, display: "flex", alignItems: "center", gap: 12 }}>
                <span style={{ display: "inline-flex", width: 44, height: 44, borderRadius: 13, background: "rgba(255,255,255,.2)", alignItems: "center", justifyContent: "center", flexShrink: 0 }}><IC_HAND s={24} col="#fff" /></span>
                <div style={{ flex: 1 }}>
                  <div style={{ fontFamily: serif, fontSize: 21, fontWeight: 600 }}>오늘의 할 일 · {followTargets.length}건</div>
                  <div style={{ fontSize: 12, opacity: .9, marginTop: 2 }}>{followupDays}일 넘게 회신이 없는 분들이에요. 리마인드를 보내면 회신율이 확 올라가요.</div>
                </div>
                <button onClick={() => setTodoOpen(false)} style={{ background: "rgba(255,255,255,.2)", border: "none", color: "#fff", width: 32, height: 32, borderRadius: 9, cursor: "pointer", fontSize: 17, fontWeight: 900, flexShrink: 0 }}>✕</button>
              </div>
            </div>
            {/* 기간 조절 */}
            <div style={{ padding: "12px 24px", borderBottom: `1px solid ${C.line}`, display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", flexShrink: 0 }}>
              <span style={{ fontSize: 11.5, fontWeight: 700, color: C.sub }}>회신 없이</span>
              {[2, 3, 5, 7].map(d => (
                <button key={d} onClick={() => setFollowupDays(d)} style={{ padding: "5px 11px", borderRadius: 8, border: `1.5px solid ${followupDays === d ? "#d98a1f" : C.line2}`, background: followupDays === d ? "rgba(217,138,31,.14)" : "transparent", color: followupDays === d ? "#d98a1f" : C.sub, cursor: "pointer", fontSize: 11.5, fontWeight: 800, fontFamily: "inherit" }}>{d}일+</button>
              ))}
              <span style={{ fontSize: 11.5, fontWeight: 700, color: C.sub }}>지난 사람</span>
            </div>
            {/* 대상 목록 */}
            <div style={{ padding: "8px 14px", overflowY: "auto", flex: 1 }}>
              {followTargets.length === 0 ? (
                <div style={{ padding: "34px 20px", textAlign: "center", color: C.sub }}>
                  <div style={{ display: "inline-flex", marginBottom: 8, color: "#2f9e5e" }}><IC_FLAG s={30} col="#2f9e5e" /></div>
                  <div style={{ fontSize: 13.5, fontWeight: 700, color: C.ink }}>할 일이 없어요 — 다 챙기셨네요!</div>
                </div>
              ) : followTargets.map((t, i) => {
                const dA = Math.floor((Date.now() - new Date(t.sent_at).getTime()) / 86400000);
                return (
                  <div key={t.id || i} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 8px", borderBottom: i < followTargets.length - 1 ? `1px solid ${C.line}` : "none" }}>
                    <span style={{ display: "inline-flex", width: 30, height: 30, borderRadius: 8, background: "rgba(109,93,211,.14)", color: "#6d5dd3", alignItems: "center", justifyContent: "center", flexShrink: 0 }}><IC_PLANE s={15} col="#6d5dd3" /></span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 12.5, fontWeight: 800, color: C.ink, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{t.nickname || t.blog_id || "블로거"}</div>
                      <div style={{ fontSize: 10.5, color: C.sub }}>{t.to_email} · {dA}일 전 보냄, 무응답</div>
                    </div>
                    <button onClick={() => setReplyStatus(t.id, "replied")} style={{ padding: "5px 9px", borderRadius: 7, border: `1px solid ${C.line2}`, background: C.surf, color: "#0ea5e9", cursor: "pointer", fontSize: 10.5, fontWeight: 800, fontFamily: "inherit" }}>회신옴</button>
                    <button onClick={() => setReplyStatus(t.id, "no_reply")} style={{ padding: "5px 9px", borderRadius: 7, border: `1px solid ${C.line2}`, background: C.surf, color: C.sub, cursor: "pointer", fontSize: 10.5, fontWeight: 800, fontFamily: "inherit" }}>제외</button>
                    <button onClick={() => sendFollowup([t.id])} disabled={followSending} style={{ padding: "5px 11px", borderRadius: 7, border: "none", background: "#d98a1f", color: "#fff", cursor: "pointer", fontSize: 10.5, fontWeight: 800, fontFamily: "inherit" }}>보내기</button>
                  </div>
                );
              })}
            </div>
            {/* 하단 일괄 발송 */}
            {followTargets.length > 0 && (
              <div style={{ padding: "14px 24px", borderTop: `1px solid ${C.line}`, display: "flex", gap: 8, flexShrink: 0 }}>
                <button onClick={() => setTodoOpen(false)} style={{ ...btnGhost, flex: 1 }}>나중에</button>
                <button onClick={() => { sendFollowup(followTargets.map(t => t.id)); }} disabled={followSending} style={{ ...btnSolid, flex: 2, background: "#d98a1f", borderColor: "#d98a1f", color: "#fff", opacity: followSending ? .6 : 1 }}>{followSending ? "보내는 중…" : `${followTargets.length}명 모두에게 리마인드 보내기 →`}</button>
              </div>
            )}
          </div>
        </div>
      ), document.body)}

      {/* ═══ 로그 크게 보기 모달 (전체화면 확대) ═══ */}
      {logExpand && createPortal((
        <div onClick={() => setLogExpand(false)} style={{ position: "fixed", inset: 0, background: "rgba(20,16,12,.6)", backdropFilter: "blur(3px)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 99999, padding: 24 }}>
          <div onClick={(e) => e.stopPropagation()} style={{ background: C.surf, border: `1px solid ${C.line2}`, borderRadius: 6, width: "min(1000px,96vw)", height: "min(88vh,900px)", display: "flex", flexDirection: "column", boxShadow: "0 30px 80px rgba(0,0,0,.55)" }}>
            <div style={{ padding: "18px 22px", borderBottom: `1px solid ${C.line}`, display: "flex", alignItems: "center", gap: 10 }}>
              <div style={{ fontFamily: serif, fontSize: 18, fontWeight: 600 }}>Live Log</div>
              <span style={{ fontSize: 11.5, color: C.sub, fontWeight: 600 }}>{logs.length}줄 {running ? "· 진행 중" : ""}</span>
              <button onClick={() => { navigator.clipboard?.writeText(logs.join("\n")); toast("로그를 복사했어요", "success"); }} style={{ ...btnGhost, marginLeft: "auto", padding: "6px 12px", fontSize: 11.5 }}>복사</button>
              <button onClick={() => setLogExpand(false)} style={{ ...btnGhost, padding: "6px 12px", fontSize: 11.5 }}>✕ 닫기</button>
            </div>
            <div className="ob-scroll" style={{ flex: 1, overflowY: "auto", background: C.logBg, padding: "16px 22px", fontFamily: "'JetBrains Mono',monospace", fontSize: 13, lineHeight: 2, color: C.logInk, whiteSpace: "pre-wrap" }}>
              {logs.length === 0 ? <span style={{ color: C.sub }}>대기 중…</span> : logs.map((l, i) => <div key={i}>{l}</div>)}
            </div>
          </div>
        </div>
      ), document.body)}
    </div>
  );
}
