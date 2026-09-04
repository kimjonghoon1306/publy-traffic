import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import PlaceCenter from "./PlaceCenter";
import { botFetch, BotEventStream } from "../lib/botApi";
import { deletePlace360Store, getPlace360BusinessMetrics, getPlace360Progress, getPlace360Ranks, getPlace360Snapshots, getPlace360StoreProfiles, PLACE360_DAILY_DIAGNOSIS_LIMIT, PLACE360_HISTORY_DAYS, PLACE360_RANK_DAILY_LIMIT, PLACE360_STORE_LIMIT, place360StoreKey, Place360BusinessMetrics, Place360RankMeasurement, Place360Snapshot, recordPlace360ReviewerHandoff, renamePlace360Store, savePlace360BusinessMetrics, savePlace360MissionProgress, savePlace360Rank, savePlace360Snapshot, savePlace360StoreProfile } from "../lib/supabase";
import { koreaDateKey } from "../lib/date";
import UsageGuide, { Pearly } from "./UsageGuide";   // 블로그지수와 동일한 온보딩 카드 + 마스코트 SVG
import pearlyImg from "../assets/pearly.png";   // 🏪 플레이스 닥터 캐릭터(펄리)

type Props = {
  showToast?: (message: string, type?: any) => void;
  theme?: "dark" | "light";
  userId?: string;
  plan?: string;
  onOpenCrawl?: () => void;
  onOpenReview?: () => void;   // 🗣️ 플레이스 리뷰답글 탭으로 이동
};

type Place360Tab = "overview" | "rank" | "diagnosis" | "data" | "mission" | "discovery";
type StoreProfile = {
  name: string;
  placeUrl: string;
  category: string;
  region: string;
  goal: "visitors" | "reviews" | "exposure" | "repeat";
};
type CollectedPlace = { placeId: string; name: string; category?: string; address?: string; visitorReviewCount?: number; blogReviewCount?: number; placeUrl: string };
// 링크 하나로 한 번에 끌어오는 플레이스 전체 현황(공개 데이터 전부)
type LivePlaceDetail = { placeId?: string; name?: string; category?: string; address?: string; phone?: string; businessHours?: string; visitorReviewCount?: number; blogReviewCount?: number; imageUrls?: string[]; menus?: { name: string; price?: string }[]; conveniences?: string[]; bookingAvailable?: boolean; placeUrl?: string; collectedAt?: string; savedCount?: number; visitorReviewScore?: number; description?: string; keywords?: string[]; hasTalktalk?: boolean; homepage?: string; newsCount?: number; photoCount?: number };
type RankMeasurement = { query: string; rank: number | null; checkedCount: number; measuredAt: string; surface: string };

const EMPTY_PROFILE: StoreProfile = { name: "", placeUrl: "", category: "", region: "", goal: "visitors" };
type BusinessMetricDraft = Pick<Place360BusinessMetrics, "current_new_customers" | "previous_new_customers" | "current_repeat_customers" | "previous_repeat_customers" | "current_ad_spend" | "previous_ad_spend" | "current_ad_actions" | "previous_ad_actions" | "current_sales" | "previous_sales">;
const EMPTY_BUSINESS_METRICS: BusinessMetricDraft = { current_new_customers: 0, previous_new_customers: 0, current_repeat_customers: 0, previous_repeat_customers: 0, current_ad_spend: 0, previous_ad_spend: 0, current_ad_actions: 0, previous_ad_actions: 0, current_sales: 0, previous_sales: 0 };

const DIAGNOSIS_ITEMS = [
  { icon: "🧲", title: "신규 고객", state: "진단 준비", desc: "검색 노출과 최근 리뷰 증가를 경쟁업체와 비교해요." },
  { icon: "📍", title: "플레이스 노출", state: "진단 준비", desc: "지역·업종 키워드에서 매장이 얼마나 잘 보이는지 확인해요." },
  { icon: "⭐", title: "리뷰 활동", state: "진단 준비", desc: "방문자 리뷰와 블로그 리뷰가 꾸준히 늘고 있는지 살펴봐요." },
  { icon: "🔁", title: "재방문 가능성", state: "자료 필요", desc: "반복 방문 표현을 분석하고, 계산대·예약장부 숫자를 넣으면 실제 재방문율도 확인해요." },
  { icon: "📣", title: "광고 효율", state: "자료 필요", desc: "광고 보고서를 연결하면 비용 대비 클릭·전화·예약을 진단해요." },
  { icon: "🏙️", title: "상권 관심도", state: "추정 진단", desc: "주변 업체와 지역 검색 변화를 이용해 상권 흐름을 추정해요." },
] as const;

const BOT = "http://127.0.0.1:3364";

/* 붙여넣은 플레이스 주소에서 매장 번호(placeId)만 뽑아낸다.
   pcmap.place / m.place / place.naver.com/{domain}/{id}, map.naver.com/p/entry/place/{id}, 순수 숫자 지원.
   naver.me 단축주소는 여기선 못 뽑으므로(""), '주소로 불러오기'가 봇을 통해 최종 URL로 판별한다. */
function placeIdFromUrl(url?: string): string {
  const s = String(url || "");
  let m = s.match(/(?:pcmap\.place|m\.place|place)\.naver\.com\/[a-z]+\/(\d{5,})/i);
  if (m) return m[1];
  m = s.match(/entry\/place\/(\d{5,})/i) || s.match(/[?&]placeId=(\d{5,})/i) || s.match(/\/(\d{6,})(?:[/?#]|$)/) || s.match(/^\s*(\d{6,})\s*$/);
  return m ? m[1] : "";
}

/* 🎯 대행사 키워드 리서치: 매장 이름·업종·지역으로 '노려야 할 검색 키워드' 후보를 만든다.
   예) 이름="꽃피는 산골", 업종="한식", 지역="횡성" → [횡성 맛집, 횡성 한식, 횡성 한우, 횡성 꽃피는산골, 꽃피는산골 …] */
function suggestKeywords(name: string, category: string, region: string): string[] {
  const reg = String(region || "").trim().split(/\s+/)[0] || "";
  const nm = String(name || "").trim();
  const nmTight = nm.replace(/\s+/g, "");
  const cats = String(category || "").split(/[,·/]/).map(s => s.trim()).filter(Boolean).slice(0, 3);
  const foodish = /식|맛집|카페|음식|고기|한우|횟집|족발|치킨|국밥|분식|베이커리|디저트|술집|포차|호프|바|dining/i.test(category + nm);
  const out: string[] = [];
  const push = (v: string) => { const t = v.trim().replace(/\s+/g, " "); if (t && !out.includes(t)) out.push(t); };
  if (reg) {
    if (foodish || !cats.length) push(`${reg} 맛집`);
    for (const c of cats) push(`${reg} ${c}`);
    if (nmTight) push(`${reg} ${nm}`);
  }
  if (nmTight) push(nm);
  for (const c of cats) if (!reg) push(c);
  return out.slice(0, 8);
}

function trackedKwKey(userId: string | undefined, storeKey: string) {
  return `publy_place360_keywords_v1:${userId || "guest"}:${storeKey}`;
}

function profileKey(userId?: string) {
  return `publy_place360_profile_v1:${userId || "guest"}`;
}

function profilesKey(userId?: string) {
  return `publy_place360_profiles_v2:${userId || "guest"}`;
}

function missionKey(userId: string | undefined, storeKey: string) {
  return `publy_place360_missions_v1:${userId || "guest"}:${storeKey}:${koreaDateKey()}`;
}

function adminSnapKey(storeKey: string) { return `publy_place360_admin_snap_v1:${storeKey}`; }
function adminRankKey(storeKey: string) { return `publy_place360_admin_rank_v1:${storeKey}`; }
function adminMetricsKey(storeKey: string) {
  return `publy_place360_admin_metrics_v1:${storeKey}`;
}
function ratingHistoryKey(userId: string | undefined, storeKey: string) {
  return `publy_place360_rating_history_v1:${userId || "guest"}:${storeKey}`;
}

function loadCompletedMissions(userId: string | undefined, storeKey: string): string[] {
  if (!storeKey) return [];
  try {
    const saved = JSON.parse(localStorage.getItem(missionKey(userId, storeKey)) || "[]");
    return Array.isArray(saved) ? saved.filter(item => typeof item === "string") : [];
  } catch {
    return [];
  }
}

function loadProfile(userId?: string): StoreProfile {
  try {
    const saved = JSON.parse(localStorage.getItem(profileKey(userId)) || "null");
    return saved && typeof saved.name === "string" ? { ...EMPTY_PROFILE, ...saved } : EMPTY_PROFILE;
  } catch {
    return EMPTY_PROFILE;
  }
}

function loadProfiles(userId?: string): StoreProfile[] {
  try {
    const saved = JSON.parse(localStorage.getItem(profilesKey(userId)) || "[]");
    if (Array.isArray(saved) && saved.length) return saved.filter(item => item && typeof item.name === "string" && item.name.trim()).map(item => ({ ...EMPTY_PROFILE, ...item }));
  } catch {}
  const legacy = loadProfile(userId);
  return legacy.name.trim() ? [legacy] : [];
}

function loadSelectedProfile(userId?: string): StoreProfile {
  const profiles = loadProfiles(userId);
  const selected = loadProfile(userId);
  const selectedKey = place360StoreKey(selected.name, selected.region);
  return profiles.find(item => place360StoreKey(item.name, item.region) === selectedKey) || profiles[0] || EMPTY_PROFILE;
}

function persistProfiles(userId: string | undefined, profiles: StoreProfile[], selected: StoreProfile) {
  localStorage.setItem(profilesKey(userId), JSON.stringify(profiles));
  localStorage.setItem(profileKey(userId), JSON.stringify(selected));
}

function parseCsvLine(line: string): string[] {
  const cells: string[] = [];
  let value = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === '"') {
      if (quoted && line[index + 1] === '"') { value += '"'; index += 1; }
      else quoted = !quoted;
    } else if (char === "," && !quoted) { cells.push(value.trim()); value = ""; }
    else value += char;
  }
  cells.push(value.trim());
  return cells;
}

function normalizeCsvHeader(value: string) {
  return value.replace(/^\ufeff/, "").trim().toLocaleLowerCase("ko-KR").replace(/[\s_·/()-]/g, "");
}

export default function Place360({ showToast, theme = "light", userId, plan = "free", onOpenCrawl, onOpenReview }: Props) {
  // 단일 흐름: 기존 setTab(x) 호출은 해당 섹션으로 스크롤하는 점프로 동작(탭 없음).
  const [tab, setTabState] = useState<Place360Tab>("overview");
  const setTab = useCallback((t: Place360Tab) => {
    setTabState(t);
    const map: Record<string, string> = { rank: "p360-rank", data: "p360-pos", diagnosis: "p360-rank", discovery: "p360-discovery" };
    const id = map[t]; if (id && typeof document !== "undefined") setTimeout(() => document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" }), 40);
  }, []);
  const [profiles, setProfiles] = useState<StoreProfile[]>(() => loadProfiles(userId));
  const [profile, setProfile] = useState<StoreProfile>(() => loadSelectedProfile(userId));
  const [draft, setDraft] = useState<StoreProfile>(() => loadSelectedProfile(userId));
  const [editingStoreKey, setEditingStoreKey] = useState<string | null>(() => {
    const selected = loadSelectedProfile(userId);
    return selected.name ? place360StoreKey(selected.name, selected.region) : null;
  });
  const [storeFormOpen, setStoreFormOpen] = useState(() => loadProfiles(userId).length === 0);
  const [resolving, setResolving] = useState(false);
  const [ratingRefreshing, setRatingRefreshing] = useState(false);
  const [livePlace, setLivePlace] = useState<LivePlaceDetail | null>(null);
  // 엔터 한 번 = 통째로 수집. 진행 로그 1→100% 빠짐없이 표시
  const [scanPct, setScanPct] = useState(0);
  const [scanLog, setScanLog] = useState<string[]>([]);
  const [oneClickPending, setOneClickPending] = useState(false);
  const [posOpen, setPosOpen] = useState(false);   // 포스 자료 입력 접이식
  const [discoveryOpen, setDiscoveryOpen] = useState(false);   // 역추적·업체찾기 탭(기본 닫힘)
  const [tileModal, setTileModal] = useState<{ i: string; l: string; c: string; key: string; act: string } | null>(null);   // 타일 클릭 팝업(행위→이유→성과)
  const [autoKeywords, setAutoKeywords] = useState<{ keyword: string; source: string }[]>([]);   // 자동 발굴 키워드(자동완성·연관검색)
  const [kwLoading, setKwLoading] = useState(false);
  const [reportRange, setReportRange] = useState<1 | 7 | 30 | "custom">(7);   // 리포트 기간: 일간(1)/주간(7)/월간(30)/기간설정
  const [reportCustom, setReportCustom] = useState(14);
  const [autoRankKw, setAutoRankKw] = useState("");   // 링크 등록 직후 자동 순위측정할 키워드(프로필 반영 후 실행)
  useEffect(() => {
    if (plan === "admin") return;
    let active = true;
    getPlace360StoreProfiles().then(rows => {
      if (!active || !rows.length) return;
      const serverProfiles = rows.map(row => ({ name: row.store_name, placeUrl: row.place_url, category: row.category, region: row.region, goal: row.goal }));
      const selectedKey = place360StoreKey(profile.name, profile.region);
      const selected = serverProfiles.find(item => place360StoreKey(item.name, item.region) === selectedKey) || serverProfiles[0];
      setProfiles(serverProfiles); setProfile(selected); setDraft(selected); setEditingStoreKey(place360StoreKey(selected.name, selected.region)); setStoreFormOpen(false);
      persistProfiles(userId, serverProfiles, selected);
    }).catch(() => {});
    return () => { active = false; };
  }, [plan, userId]);
  const [collectedPlaces, setCollectedPlaces] = useState<CollectedPlace[]>([]);
  const [snapshots, setSnapshots] = useState<Place360Snapshot[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [latestRank, setLatestRank] = useState<RankMeasurement | null>(null);
  const [rankHistory, setRankHistory] = useState<Place360RankMeasurement[]>([]);
  const [trackedKeywords, setTrackedKeywords] = useState<string[]>([]);
  const [newKeyword, setNewKeyword] = useState("");
  const [checkingKeyword, setCheckingKeyword] = useState("");
  const kwStreamRef = useRef<BotEventStream | null>(null);
  const hasStore = Boolean(profile.name.trim());
  const ownPlace = useMemo(() => {
    // 1순위: 등록한 플레이스 주소의 매장 번호로 정확히 매칭(상호명 띄어쓰기·지점명 달라도 100% 일치)
    const myId = placeIdFromUrl(profile.placeUrl);
    if (myId) {
      const byId = collectedPlaces.find(place => place.placeId === myId);
      if (byId) return byId;
    }
    // 2순위: 이름 정규화(공백·괄호·지점표기 제거) 후 포함 매칭
    const norm = (s: string) => s.replace(/\(.*?\)/g, "").replace(/[\s·・,]/g, "").toLowerCase();
    const needle = norm(profile.name);
    if (!needle) return undefined;
    return collectedPlaces.find(place => {
      const name = norm(place.name);
      return name.includes(needle) || needle.includes(name);
    });
  }, [collectedPlaces, profile.name, profile.placeUrl]);
  const comparison = useMemo(() => {
    const competitors = collectedPlaces.filter(place => place.placeId !== ownPlace?.placeId);
    if (!competitors.length) return null;
    const avgVisitor = Math.round(competitors.reduce((sum, place) => sum + (place.visitorReviewCount || 0), 0) / competitors.length);
    const avgBlog = Math.round(competitors.reduce((sum, place) => sum + (place.blogReviewCount || 0), 0) / competitors.length);
    return { count: competitors.length, avgVisitor, avgBlog };
  }, [collectedPlaces, ownPlace?.placeId]);

  // 🩺 진짜 진단: 수집된 업체를 블로그리뷰 많은 순으로 줄세워 '내 매장' 위치·경쟁사 갭을 실제 비교표로
  const competitorTable = useMemo(() => {
    if (collectedPlaces.length < 2 || !ownPlace) return null;
    const rows = [...collectedPlaces].sort((a, b) => (b.blogReviewCount || 0) - (a.blogReviewCount || 0));
    const myIdx = rows.findIndex(p => p.placeId === ownPlace.placeId);
    const top = rows.slice(0, 5);
    const leader = rows[0];
    const my = ownPlace;
    // 항목별 갭(리더 대비)
    const gaps = [
      { label: "블로그 리뷰", mine: my.blogReviewCount || 0, top: leader.blogReviewCount || 0, avg: comparison?.avgBlog || 0, icon: "📝", good: (my.blogReviewCount || 0) >= (comparison?.avgBlog || 0) },
      { label: "방문자 리뷰", mine: my.visitorReviewCount || 0, top: leader.visitorReviewCount || 0, avg: comparison?.avgVisitor || 0, icon: "🧾", good: (my.visitorReviewCount || 0) >= (comparison?.avgVisitor || 0) },
    ];
    return { rows, top, myIdx, myRank: myIdx >= 0 ? myIdx + 1 : null, total: rows.length, leader, gaps };
  }, [collectedPlaces, ownPlace, comparison]);

  // 📊 성과 리포트: 선택 기간(일/주/월/커스텀) 내 순위·리뷰 변화를 집계
  const reportDays = reportRange === "custom" ? Math.max(1, reportCustom) : reportRange;
  const report = useMemo(() => {
    const cutoff = Date.now() - reportDays * 86400000;
    const ranks = rankHistory.filter(r => new Date(r.measured_at).getTime() >= cutoff);
    const snaps = snapshots.filter(s => new Date(s.created_at || s.measured_on).getTime() >= cutoff);
    // 키워드별 순위 변화(기간 내 최신 vs 최오래)
    const byKw = new Map<string, Place360RankMeasurement[]>();
    ranks.forEach(r => { const a = byKw.get(r.keyword) || []; a.push(r); byKw.set(r.keyword, a); });
    const kwRows = Array.from(byKw, ([keyword, list]) => {
      const sorted = [...list].sort((a, b) => new Date(a.measured_at).getTime() - new Date(b.measured_at).getTime());
      const first = sorted[0]?.rank ?? null, last = sorted[sorted.length - 1]?.rank ?? null;
      const change = (first != null && last != null) ? first - last : null;   // +면 상승
      return { keyword, first, last, change, series: sorted.map(s => s.rank), measures: sorted.length };
    }).sort((a, b) => (a.last ?? 999) - (b.last ?? 999));
    // 리뷰 증감(기간 내 최신-최오래 스냅샷)
    const snapSorted = [...snaps].sort((a, b) => new Date(a.measured_on).getTime() - new Date(b.measured_on).getTime());
    const sf = snapSorted[0], sl = snapSorted[snapSorted.length - 1];
    const reviewDelta = sf && sl ? { blog: sl.blog_reviews - sf.blog_reviews, visitor: sl.visitor_reviews - sf.visitor_reviews } : null;
    return { days: reportDays, measures: ranks.length, kwRows, reviewDelta, hasData: ranks.length > 0 || snaps.length > 1 };
  }, [rankHistory, snapshots, reportDays]);
  // 📅 측정 기록 보관함 — 보관 기간 내 전체 순위 측정 이력을 날짜별로(기간 필터 없이 전부)
  const archive = useMemo(() => {
    const rows = [...rankHistory].sort((a, b) => new Date(b.measured_at).getTime() - new Date(a.measured_at).getTime());
    const days = new Set(rows.map(r => new Date(r.measured_at).toLocaleDateString("ko-KR")));
    const kws = new Set(rows.map(r => r.keyword));
    const oldest = rows.length ? rows[rows.length - 1].measured_at : null;
    return { rows, dayCount: days.size, kwCount: kws.size, total: rows.length, oldest };
  }, [rankHistory]);
  // 🔬 키워드 처방전: 순위 잰 키워드별로 '왜 이 순위인지 + 올리는 법'을 자동 분석
  //   A) 키워드가 소개글·대표키워드·메뉴·상호에 들어있나(관련도) B) 경쟁사 대비 부족 C) 상위밖 여부
  const keywordRx = useMemo(() => {
    const measured = trackedKeywords.map(kw => rankHistory.find(r => r.keyword === kw)).filter(Boolean) as Place360RankMeasurement[];
    if (!measured.length || !livePlace) return [];
    const desc = (livePlace.description || "").toLowerCase();
    const kwText = (livePlace.keywords || []).join(" ").toLowerCase();
    const menuText = (livePlace.menus || []).map(m => m.name).join(" ").toLowerCase();
    const nameText = (livePlace.name || profile.name || "").toLowerCase();
    // 검색어의 핵심 토큰(2글자↑)이 각 영역에 있나
    return measured.map(m => {
      const rank = m.rank; const kw = m.keyword;
      const tokens = kw.toLowerCase().split(/\s+/).filter(t => t.length >= 2);
      const inField = (text: string) => tokens.some(t => text.includes(t));
      const isBrand = nameText && tokens.some(t => nameText.includes(t) && t.length >= 2);
      const checks = [
        { ok: inField(desc), label: "소개글", how: "스마트플레이스 소개글에 이 검색어를 자연스럽게 넣으세요." },
        { ok: inField(kwText) || (livePlace.keywords || []).length >= 3, label: "대표 키워드", how: "대표 키워드에 이 검색어를 추가하세요." },
        { ok: inField(menuText), label: "메뉴", how: "관련 메뉴명을 등록하면 관련도가 올라가요." },
      ];
      const missing = checks.filter(c => !c.ok);
      const blogGap = comparison ? Math.max(0, (comparison.avgBlog) - (ownPlace?.blogReviewCount || 0)) : 0;
      return { kw, rank, isBrand, checks, missing, blogGap, out: rank == null };
    }).sort((a, b) => (a.rank ?? 999) - (b.rank ?? 999));
  }, [trackedKeywords, rankHistory, livePlace, comparison, ownPlace, profile.name]);
  const keywordOpportunities = useMemo(() => {
    const regionTokens = (profile.region || "").split(/\s+/).filter(t => t.length >= 2);
    const categoryTokens = `${profile.category || ""} ${(livePlace?.menus || []).map(m => m.name).join(" ")}`.split(/[\s,·/]+/).filter(t => t.length >= 2);
    const brand = (profile.name || livePlace?.name || "").replace(/\s+/g, "").toLowerCase();
    return autoKeywords.map(item => {
      const tight = item.keyword.replace(/\s+/g, "").toLowerCase();
      const local = regionTokens.some(t => item.keyword.includes(t));
      const relevant = categoryTokens.some(t => item.keyword.includes(t));
      const isBrand = Boolean(brand && (tight.includes(brand) || brand.includes(tight)));
      const specific = item.keyword.trim().split(/\s+/).length >= 3;
      const sourceSignal = item.source === "연관검색" || item.source === "자동완성";
      const score = (local ? 30 : 0) + (relevant ? 25 : 0) + (specific ? 20 : 0) + (sourceSignal ? 15 : 0) + (isBrand ? 5 : 10);
      const tier = isBrand ? "브랜드 방어" : score >= 70 ? "우선 공략" : score >= 45 ? "확장 후보" : "탐색 후보";
      const reasons = [local && "지역 포함", relevant && "업종·메뉴 일치", specific && "구체 검색", sourceSignal && item.source, isBrand && "상호 검색"].filter(Boolean) as string[];
      return { ...item, score, tier, reasons };
    }).sort((a, b) => b.score - a.score || a.keyword.localeCompare(b.keyword, "ko"));
  }, [autoKeywords, livePlace?.menus, livePlace?.name, profile.category, profile.name, profile.region]);
  const storeKey = place360StoreKey(profile.name, profile.region);
  const [ratingHistory, setRatingHistory] = useState<Array<{ score: number; reviewCount: number; measuredAt: string }>>([]);
  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(ratingHistoryKey(userId, storeKey)) || "[]");
      setRatingHistory(Array.isArray(saved) ? saved : []);
    } catch { setRatingHistory([]); }
  }, [storeKey, userId]);
  const ratingTrend = useMemo(() => {
    const latest = ratingHistory[0];
    const previous = ratingHistory.find((item, index) => index > 0 && item.score !== latest?.score);
    return { latest, previous, change: latest && previous ? Number((latest.score - previous.score).toFixed(2)) : null };
  }, [ratingHistory]);
  const [completedMissions, setCompletedMissions] = useState<string[]>(() => loadCompletedMissions(userId, storeKey));
  const [reviewerHandoffCount, setReviewerHandoffCount] = useState(0);
  const [businessMetrics, setBusinessMetrics] = useState<BusinessMetricDraft>(EMPTY_BUSINESS_METRICS);
  // 🏪 손님 행동 신호 입력(저장·길찾기) — 공개 화면에 없어 사장님이 스마트플레이스 통계에서 확인해 넣는 값. DB 없이 매장별 localStorage에 보관.
  const [behaviorInput, setBehaviorInput] = useState<{ saves: number; directions: number; shares: number }>({ saves: 0, directions: 0, shares: 0 });
  const [metricsSavedAt, setMetricsSavedAt] = useState("");
  const [metricsLoading, setMetricsLoading] = useState(false);
  const diagnosisCoverage = useMemo(() => {
    const checks = [
      { label: "매장 공개정보", ok: Boolean(livePlace?.placeId), kind: "자동 수집" },
      { label: "실제 검색 경쟁업체", ok: collectedPlaces.length >= 5, kind: "자동 수집" },
      { label: "키워드 순위", ok: rankHistory.length > 0, kind: "실측" },
      { label: "기간별 변화", ok: snapshots.length >= 2, kind: "실측" },
      { label: "신규·재방문·광고", ok: Boolean(metricsSavedAt), kind: "직접 입력" },
    ];
    const done = checks.filter(item => item.ok).length;
    return { checks, done, percent: Math.round(done / checks.length * 100) };
  }, [collectedPlaces.length, livePlace?.placeId, metricsSavedAt, rankHistory.length, snapshots.length]);
  const oneClickKit = useMemo(() => {
    if (!livePlace) return null;
    const region = profile.region || draft.region;
    const category = profile.category || draft.category || livePlace.category || "매장";
    const menus = (livePlace.menus || []).slice(0, 3).map(m => m.name).filter(Boolean);
    const priority = keywordOpportunities.filter(k => k.tier === "우선 공략");
    const keywords = (priority.length ? priority : keywordOpportunities).slice(0, 5).map(k => k.keyword);
    const intro = `${region ? `${region}에서 ` : ""}${menus.length ? menus.join("·") : category}을 찾는 분을 위한 ${livePlace.name || profile.name}입니다. ${livePlace.bookingAvailable ? "네이버 예약으로 편하게 방문할 수 있고, " : ""}영업시간·메뉴·방문 전 필요한 정보를 정확하게 안내합니다.`;
    const photos = ["외관·찾아오는 길", "입구·주차 위치", menus[0] ? `${menus[0]} 대표 사진` : "대표 상품·서비스", menus[1] ? `${menus[1]} 가격 포함 사진` : "가격표·메뉴판", "내부 공간·좌석", "최근 분위기·계절 사진"];
    const actions = [
      (!livePlace.description || livePlace.description.length < 20) && "오늘: 자동 소개글 초안을 스마트플레이스에 반영",
      (livePlace.imageUrls?.length || 0) < 10 && "1일차: 사진 등록 순서대로 최신 사진 10장 보강",
      (livePlace.menus?.length || 0) < 5 && "2일차: 대표 메뉴·가격·사진을 5개 이상 등록",
      !livePlace.bookingAvailable && "3일차: 네이버 예약·주문 또는 톡톡 연결 검토",
      "7일차: 같은 키워드·같은 검색 화면으로 순위 재측정",
      "30일차: 순위·리뷰 증가·예약·길찾기 변화를 함께 판정",
    ].filter(Boolean) as string[];
    return { keywords, intro, photos, actions };
  }, [draft.category, draft.region, keywordOpportunities, livePlace, profile.category, profile.name, profile.region]);
  const csvInputRef = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    const localMissions = loadCompletedMissions(userId, storeKey);
    setCompletedMissions(localMissions);
    setReviewerHandoffCount(Number(localStorage.getItem(`${missionKey(userId, storeKey)}:reviewers`) || 0));
    // 🏪 손님 행동 입력(저장·길찾기) 매장별 복원
    try { const b = JSON.parse(localStorage.getItem(`${missionKey(userId, storeKey)}:behavior`) || "null"); setBehaviorInput(b && typeof b === "object" ? { saves: Number(b.saves) || 0, directions: Number(b.directions) || 0, shares: Number(b.shares) || 0 } : { saves: 0, directions: 0, shares: 0 }); } catch { setBehaviorInput({ saves: 0, directions: 0, shares: 0 }); }
    if (!storeKey || plan === "admin") return;
    let active = true;
    getPlace360Progress(storeKey).then(async row => {
      if (!active) return;
      if (row) {
        const todayMissions = row.mission_date === koreaDateKey() ? (row.completed_missions || []) : [];
        setCompletedMissions(todayMissions);
        setReviewerHandoffCount(row.reviewer_handoff_count || 0);
        localStorage.setItem(missionKey(userId, storeKey), JSON.stringify(todayMissions));
        localStorage.setItem(`${missionKey(userId, storeKey)}:reviewers`, String(row.reviewer_handoff_count || 0));
      } else if (localMissions.length) {
        await savePlace360MissionProgress(storeKey, localMissions);
      }
    }).catch(() => {});
    return () => { active = false; };
  }, [plan, storeKey, userId]);
  useEffect(() => {
    if (!storeKey) { setBusinessMetrics(EMPTY_BUSINESS_METRICS); setMetricsSavedAt(""); return; }
    let active = true;
    setMetricsLoading(true);
    const load = plan === "admin"
      ? Promise.resolve((() => { try { return JSON.parse(localStorage.getItem(adminMetricsKey(storeKey)) || "null") as Place360BusinessMetrics | null; } catch { return null; } })())
      : getPlace360BusinessMetrics(storeKey);
    load.then(row => { if (!active) return; setBusinessMetrics(row ? { current_new_customers: row.current_new_customers, previous_new_customers: row.previous_new_customers, current_repeat_customers: row.current_repeat_customers, previous_repeat_customers: row.previous_repeat_customers, current_ad_spend: row.current_ad_spend, previous_ad_spend: row.previous_ad_spend, current_ad_actions: row.current_ad_actions, previous_ad_actions: row.previous_ad_actions, current_sales: row.current_sales, previous_sales: row.previous_sales } : EMPTY_BUSINESS_METRICS); setMetricsSavedAt(row?.updated_at || ""); }).catch(() => { if (active) setBusinessMetrics(EMPTY_BUSINESS_METRICS); }).finally(() => { if (active) setMetricsLoading(false); });
    return () => { active = false; };
  }, [plan, storeKey]);
  useEffect(() => {
    if (!storeKey) { setSnapshots([]); return; }
    // 관리자는 회원과 동일 기능을 쓰되 기록은 서버 대신 로컬에 유지(회원 데이터와 안 섞이게)
    if (plan === "admin") { try { setSnapshots(JSON.parse(localStorage.getItem(adminSnapKey(storeKey)) || "[]")); } catch { setSnapshots([]); } return; }
    let active = true;
    setHistoryLoading(true);
    getPlace360Snapshots(storeKey).then(rows => { if (active) setSnapshots(rows); }).catch(() => { if (active) setSnapshots([]); }).finally(() => { if (active) setHistoryLoading(false); });
    return () => { active = false; };
  }, [plan, storeKey]);
  useEffect(() => {
    if (!storeKey) { setRankHistory([]); return; }
    if (plan === "admin") { try { setRankHistory(JSON.parse(localStorage.getItem(adminRankKey(storeKey)) || "[]")); } catch { setRankHistory([]); } return; }
    let active = true;
    getPlace360Ranks(storeKey).then(rows => { if (active) setRankHistory(rows); }).catch(() => { if (active) setRankHistory([]); });
    return () => { active = false; };
  }, [plan, storeKey]);
  // 매장이 바뀌면 저장된 추적 키워드를 불러오고, 없으면 이름·업종·지역으로 추천 키워드를 채워 시작한다.
  useEffect(() => {
    if (!hasStore) { setTrackedKeywords([]); return; }
    let saved: string[] = [];
    try { const raw = JSON.parse(localStorage.getItem(trackedKwKey(userId, storeKey)) || "[]"); if (Array.isArray(raw)) saved = raw.filter(x => typeof x === "string" && x.trim()); } catch {}
    setTrackedKeywords(saved.length ? saved : suggestKeywords(profile.name, profile.category, profile.region));
  }, [userId, storeKey, hasStore, profile.name, profile.category, profile.region]);
  const persistKeywords = (list: string[]) => {
    setTrackedKeywords(list);
    if (storeKey) { try { localStorage.setItem(trackedKwKey(userId, storeKey), JSON.stringify(list)); } catch {} }
  };

  const onPlacesCollected = async (rows: CollectedPlace[], meta: { query: string; measuredAt: string; surface: string }) => {
    setCollectedPlaces(rows);
    const myId = placeIdFromUrl(profile.placeUrl);
    const norm = (s: string) => s.replace(/\(.*?\)/g, "").replace(/[\s·・,]/g, "").toLowerCase();
    const needle = norm(profile.name);
    const own = (myId ? rows.find(place => place.placeId === myId) : undefined)
      || (needle ? rows.find(place => {
        const name = norm(place.name);
        return name.includes(needle) || needle.includes(name);
      }) : undefined);
    const rankIndex = own ? rows.findIndex(place => place.placeId === own.placeId) : -1;
    setLatestRank({ query: meta.query, rank: rankIndex >= 0 ? rankIndex + 1 : null, checkedCount: rows.length, measuredAt: meta.measuredAt, surface: meta.surface });
    if (plan === "admin") {
      // 관리자: 회원과 동일하게 순위 히스토리를 쌓되 로컬에 저장(서버 미저장)
      const row: Place360RankMeasurement = { id: `admin-${Date.now()}`, user_id: "admin", store_key: storeKey, keyword: meta.query, rank: rankIndex >= 0 ? rankIndex + 1 : null, checked_count: rows.length, surface: meta.surface, device: "PC", measured_at: meta.measuredAt } as Place360RankMeasurement;
      setRankHistory(cur => { const next = [row, ...cur].slice(0, 200); try { localStorage.setItem(adminRankKey(storeKey), JSON.stringify(next)); } catch {} return next; });
    } else if (plan !== "admin") {
      try {
        await savePlace360Rank({ store_key: storeKey, keyword: meta.query, rank: rankIndex >= 0 ? rankIndex + 1 : null, checked_count: rows.length, surface: meta.surface, device: "PC" });
        const nextRankHistory = await getPlace360Ranks(storeKey);
        setRankHistory(nextRankHistory);
        if (nextRankHistory.length >= 2) void completeMissionAutomatically("remeasure");
      } catch (error: any) {
        if (String(error?.message || "").includes("PLACE360_RANK_DAILY_LIMIT")) showToast?.("오늘 사용할 수 있는 순위 측정 횟수를 모두 사용했어요", "info");
      }
    }
    if (!own) return;
    const competitors = rows.filter(place => place.placeId !== own.placeId);
    if (!competitors.length) return;
    const avgVisitor = Math.round(competitors.reduce((sum, place) => sum + (place.visitorReviewCount || 0), 0) / competitors.length);
    const avgBlog = Math.round(competitors.reduce((sum, place) => sum + (place.blogReviewCount || 0), 0) / competitors.length);
    if (plan === "admin") {
      const now = new Date().toISOString();
      setSnapshots(current => { const next = [{ id: `admin-${Date.now()}`, user_id: "admin", store_key: storeKey, store_name: own.name, region: profile.region, category: profile.category, visitor_reviews: own.visitorReviewCount || 0, blog_reviews: own.blogReviewCount || 0, competitor_count: competitors.length, competitor_avg_visitor: avgVisitor, competitor_avg_blog: avgBlog, collected_count: rows.length, measured_on: now.slice(0, 10), created_at: now }, ...current].slice(0, 120); try { localStorage.setItem(adminSnapKey(storeKey), JSON.stringify(next)); } catch {} return next; });
      showToast?.("관리자 무제한 진단이 완료됐어요", "success");
      return;
    }
    try {
      await savePlace360Snapshot({ store_key: storeKey, store_name: own.name, region: profile.region, category: profile.category, visitor_reviews: own.visitorReviewCount || 0, blog_reviews: own.blogReviewCount || 0, competitor_count: competitors.length, competitor_avg_visitor: avgVisitor, competitor_avg_blog: avgBlog, collected_count: rows.length });
      setSnapshots(await getPlace360Snapshots(storeKey));
      showToast?.("오늘의 플레이스 365 측정 기록을 안전하게 저장했어요", "success");
    } catch (error: any) {
      const message = String(error?.message || "");
      showToast?.(message.includes("PLACE360_STORE_LIMIT") ? "내 등급에서 등록할 수 있는 매장 수를 모두 사용했어요" : message.includes("PLACE360_DAILY_LIMIT") ? "오늘 사용할 수 있는 매장 진단 횟수를 모두 사용했어요" : "비교는 완료됐지만 측정 기록 서버가 아직 준비되지 않았어요", "info");
    }
  };

  // 🎯 키워드 하나로 공개 지도 검색을 돌려 '내 매장이 몇 위인지' 바로 확인한다(로그인 계정 불필요).
  //    결과를 기존 onPlacesCollected에 그대로 물려 순위 저장·경쟁사 비교·진단 미션까지 한 번에 갱신한다.
  const checkKeywordRank = (kw: string) => {
    const query = kw.trim();
    if (!query) return;
    if (checkingKeyword) { showToast?.("이전 키워드 확인이 끝난 뒤 다시 눌러 주세요", "info"); return; }
    if (!placeIdFromUrl(profile.placeUrl)) showToast?.("플레이스 주소를 등록하면 상호명이 달라도 순위를 정확히 잡아요", "info");
    kwStreamRef.current?.close();
    setCheckingKeyword(query);
    setTab("rank");
    const url = `${BOT}/api/place/search?userId=${encodeURIComponent(userId || "")}&accountId=&query=${encodeURIComponent(query)}&domain=place&count=100`;
    const es = new BotEventStream(url);
    kwStreamRef.current = es;
    let done = false;
    const finish = () => { done = true; setCheckingKeyword(""); es.close(); kwStreamRef.current = null; };
    es.onmessage = (event: MessageEvent) => {
      let d: any; try { d = JSON.parse(event.data); } catch { return; }
      if (d.type === "quota_exceeded") { showToast?.("오늘 플레이스 검색 한도를 모두 사용했어요", "error"); finish(); }
      else if (d.type === "place_done") {
        const rows = (d.results || []) as CollectedPlace[];
        void onPlacesCollected(rows, { query, measuredAt: new Date().toISOString(), surface: "네이버 지도 PC" });
        if (!trackedKeywords.includes(query)) persistKeywords([...trackedKeywords, query]);
        finish();
      } else if (d.type === "error") { showToast?.(d.msg || "순위 확인 중 문제가 생겼어요", "error"); finish(); }
    };
    es.onerror = () => { if (!done) { showToast?.("봇 서버에 연결하지 못했어요. 퍼블리 앱이 켜져 있는지 확인해 주세요", "error"); finish(); } };
  };
  useEffect(() => () => { kwStreamRef.current?.close(); }, []);
  // 링크 등록 직후, 프로필이 반영된 뒤 추천 키워드로 순위·경쟁사를 자동 측정(1회) → 링크 하나로 다 끌어오기
  useEffect(() => {
    if (!autoRankKw) return;
    const kw = autoRankKw;
    setAutoRankKw("");
    void checkKeywordRank(kw);
    // checkKeywordRank는 매 렌더 새로 생성되므로 deps에서 제외(무한 재실행 방지)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoRankKw]);
  // 🎯 자동 순위 측정 큐: 키워드가 비어 있으면 하나 꺼내 측정, 끝나면(checkingKeyword=="") 다음 것
  const [rankQueue, setRankQueue] = useState<string[]>([]);
  useEffect(() => {
    if (checkingKeyword || rankQueue.length === 0) return;
    const [next, ...rest] = rankQueue;
    setRankQueue(rest);
    if (next) { if (!trackedKeywords.includes(next)) persistKeywords([...trackedKeywords, next]); void checkKeywordRank(next); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [checkingKeyword, rankQueue]);

  const trend = useMemo(() => {
    if (snapshots.length < 2) return null;
    const latest = snapshots[0];
    const latestTime = new Date(latest.measured_on).getTime();
    const prior = snapshots.find(row => latestTime - new Date(row.measured_on).getTime() >= 6 * 86400000) || snapshots[snapshots.length - 1];
    return { days: Math.max(1, Math.round((latestTime - new Date(prior.measured_on).getTime()) / 86400000)), visitor: latest.visitor_reviews - prior.visitor_reviews, blog: latest.blog_reviews - prior.blog_reviews };
  }, [snapshots]);
  const prescriptions = useMemo(() => {
    const items: Array<{ level: "danger" | "warning" | "ready"; title: string; reason: string; action: string; go: Place360Tab }> = [];
    if (!ownPlace || !comparison) {
      items.push({ level: "ready", title: "먼저 내 매장과 주변 업체를 찾아주세요", reason: "첫 수집 결과가 앞으로 변화를 판단하는 기준선이 됩니다.", action: "업체 찾기 시작", go: "discovery" });
      return items;
    }
    if (metricsSavedAt && businessMetrics.previous_new_customers > 0 && businessMetrics.current_new_customers < businessMetrics.previous_new_customers) items.push({ level: "danger", title: "신규 고객 감소를 먼저 확인하세요", reason: `신규 고객이 ${businessMetrics.previous_new_customers.toLocaleString()}명에서 ${businessMetrics.current_new_customers.toLocaleString()}명으로 줄었어요.`, action: "운영자료 원인 보기", go: "data" });
    if ((ownPlace.blogReviewCount || 0) < comparison.avgBlog) items.push({ level: "danger", title: "블로그 리뷰 보강이 먼저예요", reason: `내 매장은 ${(ownPlace.blogReviewCount || 0).toLocaleString()}개, 주변 평균은 ${comparison.avgBlog.toLocaleString()}개로 차이가 있어요.`, action: "경쟁업체 리뷰어 찾기", go: "discovery" });
    if ((ownPlace.visitorReviewCount || 0) < comparison.avgVisitor) items.push({ level: "warning", title: "방문 고객의 리뷰 참여를 점검하세요", reason: `방문자 리뷰가 주변 평균보다 ${(comparison.avgVisitor - (ownPlace.visitorReviewCount || 0)).toLocaleString()}개 적어요.`, action: "업체 비교 근거 보기", go: "diagnosis" });
    if (trend && trend.blog <= 0) items.push({ level: "warning", title: `최근 ${trend.days}일 블로그 리뷰가 정체됐어요`, reason: "새로운 지역형 리뷰어를 찾고 협업 후보로 보내는 작업을 추천해요.", action: "리뷰어 역추적", go: "discovery" });
    if (!metricsSavedAt) items.push({ level: "ready", title: "실제 운영자료를 연결하면 원인이 더 정확해져요", reason: "계산대·예약장부·광고 숫자가 있어야 신규·재방문·광고 문제를 서로 구분할 수 있어요.", action: "30일 자료 입력", go: "data" });
    if (!items.length) items.push({ level: "ready", title: "현재 리뷰 기준은 주변 평균 이상이에요", reason: "지금 상태를 유지하면서 다음 측정에서 증가 속도를 비교해 보세요.", action: "다음 측정 준비", go: "discovery" });
    return items.slice(0, 3);
  }, [businessMetrics.current_new_customers, businessMetrics.previous_new_customers, comparison, metricsSavedAt, ownPlace, trend]);
  const growthMissions = useMemo(() => {
    if (!hasStore) return [{ id: "register", icon: "🏪", title: "내 매장 먼저 등록하기", why: "매장 이름을 알아야 순위와 경쟁업체를 정확히 비교할 수 있어요.", how: "한눈에 보기에서 매장 이름·지역·업종을 입력하고 저장하세요.", action: "매장 등록하기", go: "overview" as Place360Tab }];
    if (!ownPlace || !comparison) return [{ id: "baseline", icon: "📍", title: "오늘 기준 순위 만들기", why: "첫 측정값이 있어야 다음 측정에서 상승·하락을 판단할 수 있어요.", how: "업체·리뷰어 찾기에서 지역과 업종을 입력하고 업체 찾기를 한 번 실행하세요.", action: "지금 측정하기", go: "discovery" as Place360Tab }];
    const missions: Array<{ id: string; icon: string; title: string; why: string; how: string; action: string; go: Place360Tab }> = [];
    if ((ownPlace.blogReviewCount || 0) < comparison.avgBlog) missions.push({ id: "blogger", icon: "🤝", title: "지역 리뷰어 후보 찾기", why: `블로그 리뷰가 주변 평균보다 ${Math.max(0, comparison.avgBlog - (ownPlace.blogReviewCount || 0)).toLocaleString()}개 적어요.`, how: "경쟁업체 2~3곳을 체크하고 리뷰어 역추적을 실행한 뒤 크롤링 협업 제안으로 보내세요.", action: "리뷰어 찾기", go: "discovery" });
    if ((ownPlace.visitorReviewCount || 0) < comparison.avgVisitor) missions.push({ id: "visitor", icon: "🧾", title: "방문 고객 리뷰 동선 점검하기", why: `방문자 리뷰가 주변 평균보다 ${Math.max(0, comparison.avgVisitor - (ownPlace.visitorReviewCount || 0)).toLocaleString()}개 적어요.`, how: "결제 후 영수증 리뷰 안내가 고객 눈높이에 보이는지 확인하고, 과도한 보상 없이 정직하게 참여를 안내하세요.", action: "비교 근거 보기", go: "diagnosis" });
    if (!metricsSavedAt) missions.push({ id: "owner-data", icon: "📊", title: "신규·재방문·광고 숫자 넣기", why: "공개 플레이스 자료만으로는 손님이 줄어든 실제 원인을 알 수 없어요.", how: "계산대(카드단말기)·예약장부·광고 보고서에서 최근 30일과 이전 30일 숫자를 입력하세요.", action: "운영자료 입력", go: "data" });
    if (metricsSavedAt && businessMetrics.previous_new_customers > 0 && businessMetrics.current_new_customers < businessMetrics.previous_new_customers) missions.push({ id: "new-customer", icon: "🧲", title: "신규 고객 감소 원인 좁히기", why: `신규 고객이 ${businessMetrics.previous_new_customers.toLocaleString()}명에서 ${businessMetrics.current_new_customers.toLocaleString()}명으로 줄었어요.`, how: "같은 기간의 순위가 함께 하락했는지 확인하고, 순위가 유지됐다면 고객 화면·광고 유입을 차례로 점검하세요.", action: "원인표 다시 보기", go: "data" });
    const currentTotal = businessMetrics.current_new_customers + businessMetrics.current_repeat_customers;
    const previousTotal = businessMetrics.previous_new_customers + businessMetrics.previous_repeat_customers;
    const currentRepeatRate = currentTotal > 0 ? businessMetrics.current_repeat_customers / currentTotal : null;
    const previousRepeatRate = previousTotal > 0 ? businessMetrics.previous_repeat_customers / previousTotal : null;
    if (metricsSavedAt && currentRepeatRate !== null && previousRepeatRate !== null && currentRepeatRate < previousRepeatRate) missions.push({ id: "repeat-customer", icon: "🔁", title: "재방문 고객 회복하기", why: `재방문 비율이 ${Math.round(previousRepeatRate * 100)}%에서 ${Math.round(currentRepeatRate * 100)}%로 낮아졌어요.`, how: "최근 불만·대기시간·품절·서비스 변화를 확인하고, 기존 고객에게 다시 올 이유가 되는 새 소식이나 혜택을 준비하세요.", action: "재방문 진단 보기", go: "data" });
    const currentCpa = businessMetrics.current_ad_actions > 0 ? businessMetrics.current_ad_spend / businessMetrics.current_ad_actions : null;
    const previousCpa = businessMetrics.previous_ad_actions > 0 ? businessMetrics.previous_ad_spend / businessMetrics.previous_ad_actions : null;
    if (metricsSavedAt && currentCpa !== null && previousCpa !== null && currentCpa > previousCpa) missions.push({ id: "ad-efficiency", icon: "📣", title: "비싸진 광고부터 정리하기", why: `광고 행동 1건당 비용이 ${Math.round(previousCpa).toLocaleString()}원에서 ${Math.round(currentCpa).toLocaleString()}원으로 올랐어요.`, how: "비용은 쓰지만 전화·예약·길찾기가 적은 키워드와 광고 소재를 먼저 중지하거나 수정하세요.", action: "광고 진단 보기", go: "data" });
    missions.push({ id: "customer", icon: "👀", title: "고객 화면 빠진 정보 확인하기", why: "사진·영업시간·메뉴·예약 정보가 비어 있으면 방문 전 이탈할 수 있어요.", how: "내 매장의 ‘고객 화면 보기’를 눌러 정보 완성도와 먼저 고칠 순서를 확인하세요.", action: "고객 화면 보기", go: "discovery" });
    missions.push({ id: "remeasure", icon: "📈", title: "같은 조건으로 다시 측정하기", why: "위치와 검색어가 달라지면 순위를 정확히 비교할 수 없어요.", how: "오늘 작업을 마친 뒤 다음 측정일에 같은 지역·업종·계정으로 다시 확인하세요.", action: "순위 기록 보기", go: "rank" });
    return missions.slice(0, 4);
  }, [businessMetrics, comparison, hasStore, metricsSavedAt, ownPlace]);
  // 🏪 네이버 상위노출 종합 진단 리포트 — 링크로 가져온 플레이스 전 항목을 상위노출 기준(손님 행동 신호·리뷰·정보 완성도·키워드)으로 하나씩 짚어준다.
  // 근거: 네이버 플레이스는 '손님이 실제로 한 행동'(저장·예약·길찾기·리뷰·재방문)을 사장님 입력값보다 크게 반영. 조작은 즉시 감지되므로 '정직한 유도'만 안내.
  type ReportStatus = "good" | "warn" | "bad" | "input";
  type ReportItem = { key: string; icon: string; label: string; status: ReportStatus; value: string; why: string; how: string; action?: string; go?: Place360Tab; openCrawl?: boolean };
  type ReportGroup = { title: string; subtitle: string; weight: string; items: ReportItem[] };
  const placeReport = useMemo<{ groups: ReportGroup[]; score: number; goodCount: number; totalCount: number; overallStars: number; itemStar: (i: ReportItem) => number } | null>(() => {
    const src = livePlace || (ownPlace ? { visitorReviewCount: ownPlace.visitorReviewCount, blogReviewCount: ownPlace.blogReviewCount } as LivePlaceDetail : null);
    if (!src) return null;
    const blog = src.blogReviewCount || 0;
    const visitor = src.visitorReviewCount || 0;
    const photos = src.imageUrls?.length || 0;
    const menus = src.menus?.length || 0;
    const conv = src.conveniences?.length || 0;
    const avgBlog = comparison?.avgBlog ?? 0;
    const avgVisitor = comparison?.avgVisitor ?? 0;
    const kwCount = trackedKeywords.length;

    // A. 손님 행동 신호 — 공개 화면에 안 나오는 값은 사장님이 입력(가장 중요)
    const behavior: ReportItem[] = [
      (() => { const saves = src.savedCount ?? behaviorInput.saves; const auto = src.savedCount != null; return { key: "save", icon: "💾", label: "저장하기(찜) 수", status: saves > 0 ? "good" : "input", value: saves > 0 ? `${saves.toLocaleString()}회${auto ? " (자동)" : ""}` : "직접 입력 필요", why: "저장은 고객 관심을 보여주는 운영 지표예요. 단독으로 순위를 보장하지 않으므로 순위·예약·방문 변화와 함께 봐야 해요.", how: auto ? "링크에서 자동으로 가져왔어요. 재방문 고객에게 '저장해두면 편해요'라고 정직하게 안내하면 더 늘어요." : "네이버 스마트플레이스 앱 → 통계에서 최근 저장수를 확인해 아래 손님 행동 입력칸에 넣으세요.", action: "손님 행동 입력하기", go: "data" as Place360Tab }; })(),
      { key: "reserve", icon: "📅", label: "예약·주문·톡톡", status: (src.bookingAvailable || src.hasTalktalk) ? "good" : "bad", value: [src.bookingAvailable ? "예약/주문" : "", src.hasTalktalk ? "톡톡" : ""].filter(Boolean).join(" · ") || "미연결", why: "예약·주문·톡톡은 방문으로 바로 이어지는 행동이라 순위에 크게 반영돼요. 연결만 해도 노출·전환이 같이 올라가요.", how: (src.bookingAvailable || src.hasTalktalk) ? "이미 연결됐어요. 예약 화면 사진·안내 문구를 최신으로 유지하세요." : "스마트플레이스에서 네이버 예약/주문 또는 톡톡을 켜서 손님이 앱에서 바로 예약하게 하세요.", action: "고객 화면 보기", go: "discovery" },
      { key: "directions", icon: "🧭", label: "길찾기·재방문", status: behaviorInput.directions > 0 ? "good" : "input", value: behaviorInput.directions > 0 ? `${behaviorInput.directions.toLocaleString()}회` : "직접 입력 필요", why: "길찾기와 재방문은 '진짜 가는 손님' 신호예요. 반복될수록 충성도 높은 매장으로 읽혀 순위가 올라가요.", how: "스마트플레이스 통계의 길찾기 수를 아래 입력칸에 넣으세요. 재방문은 단골 혜택·새 소식으로 다시 올 이유를 만들어요.", action: "손님 행동 입력하기", go: "data" },
      { key: "share", icon: "🔗", label: "공유 수", status: behaviorInput.shares > 0 ? "good" : "input", value: behaviorInput.shares > 0 ? `${behaviorInput.shares.toLocaleString()}회` : "직접 입력 필요", why: "공유는 입소문 확산 신호예요. 손님이 친구에게 보낼수록 도달이 넓어져 노출에 도움돼요.", how: "스마트플레이스 통계의 공유 수를 아래 입력칸에 넣으세요. 이벤트·특별메뉴는 공유를 자연스럽게 유도해요.", action: "손님 행동 입력하기", go: "data" },
    ];

    // B. 리뷰 — 퍼블리가 직접 채우는 핵심 지렛대
    const reviews: ReportItem[] = [
      { key: "blog", icon: "📝", label: "블로그 리뷰", status: avgBlog > 0 ? (blog >= avgBlog ? "good" : blog >= avgBlog * 0.6 ? "warn" : "bad") : (blog >= 30 ? "good" : blog >= 10 ? "warn" : "bad"), value: `${blog.toLocaleString()}개${avgBlog ? ` (주변 평균 ${avgBlog.toLocaleString()})` : ""}`, why: "블로그 리뷰는 고객이 매장을 비교할 때 보는 외부 콘텐츠예요. 개수만이 아니라 관련성·최신성·진정성을 함께 관리해야 해요.", how: avgBlog && blog < avgBlog ? `주변보다 ${Math.max(0, avgBlog - blog).toLocaleString()}개 적어요. 퍼블리 글쓰기로 리뷰 글을 발행하고, 리뷰어 찾기로 블로거를 섭외하세요.` : "지금 수준을 유지하되, 최근 30일 새 리뷰가 꾸준한지 확인하세요.", action: "리뷰어 찾기 →", go: "discovery" },
      { key: "visitor", icon: "🧾", label: "방문자(영수증) 리뷰", status: avgVisitor > 0 ? (visitor >= avgVisitor ? "good" : visitor >= avgVisitor * 0.6 ? "warn" : "bad") : (visitor >= 50 ? "good" : visitor >= 15 ? "warn" : "bad"), value: `${visitor.toLocaleString()}개${avgVisitor ? ` (주변 평균 ${avgVisitor.toLocaleString()})` : ""}${src.visitorReviewScore ? ` · ⭐${src.visitorReviewScore}` : ""}`, why: "방문자 리뷰의 '양+최신성'이 중요해요. 오래된 리뷰만 있으면 '식은 가게'로 읽혀 순위가 내려가요.", how: "결제 후 영수증 리뷰 안내가 손님 눈높이에 보이는지 확인하세요. 과한 보상 없이 정직하게 유도해야 안전해요(조작은 즉시 적발).", action: "고객 화면 보기", go: "discovery" },
      { key: "freshness", icon: "🕒", label: "리뷰 최신성", status: "warn", value: "직접 확인", why: "네이버는 '최근 리뷰'를 크게 봐요. 3년 전 리뷰 100개보다 최근 한 달 리뷰 10개가 더 무겁게 평가돼요. 오래된 리뷰만 있으면 '식은 가게'로 밀려요.", how: "고객 화면에서 최근 30일 안에 새 리뷰가 있는지 보세요. 없으면 재방문 고객에게 영수증 리뷰를 정직하게 유도하세요.", action: "고객 화면 보기", go: "discovery" },
      { key: "reply", icon: "💬", label: "리뷰 답변", status: "warn", value: "직접 확인", why: "사장님이 리뷰에 답변을 달면 네이버가 '활발히 관리하는 가게'로 봐서 노출에 도움돼요. 불만 리뷰에 정중히 답하면 신뢰도 올라가요.", how: "스마트플레이스에서 최근 리뷰에 답변이 달렸는지 확인하고, 안 단 리뷰에 감사·안내 답변을 남기세요.", action: "고객 화면 보기", go: "discovery" },
    ];

    // C. 정보 완성도 — 필수조건(경쟁사 이상으로)
    const info: ReportItem[] = [
      { key: "photo", icon: "📸", label: "사진", status: photos >= 10 ? "good" : photos >= 4 ? "warn" : "bad", value: `${photos}장`, why: "사진이 부실하면 방문 전 이탈해요. 외관·입구·내부·대표메뉴·가격표가 다 있어야 신뢰가 올라가요.", how: photos < 10 ? "외관/입구/내부/대표메뉴/가격표 위주로 10장 이상 채우고, 저화질·중복은 지우세요." : "충분해요. 계절·신메뉴 사진을 최신으로 갱신하세요.", action: "고객 화면 보기", go: "discovery" },
      { key: "menu", icon: "🍽️", label: "메뉴·가격", status: menus >= 5 ? "good" : menus >= 1 ? "warn" : "bad", value: `${menus}개`, why: "메뉴·가격이 있어야 검색·AI가 '무엇을 파는 집'인지 이해하고 관련 검색에 노출해요.", how: menus < 5 ? "대표 메뉴와 가격을 5개 이상 등록하세요. 시그니처 메뉴는 사진과 함께." : "잘 채워졌어요. 가격 변동 시 바로 갱신하세요.", action: "고객 화면 보기", go: "discovery" },
      { key: "hours", icon: "🕒", label: "영업시간·전화", status: (src.businessHours && src.phone) ? "good" : (src.businessHours || src.phone) ? "warn" : "bad", value: `${src.businessHours ? "영업시간 O" : "영업시간 X"} · ${src.phone ? "전화 O" : "전화 X"}`, why: "영업시간·휴무·전화가 정확해야 헛걸음이 없고, 정보 신뢰도가 순위에도 반영돼요.", how: (!src.businessHours || !src.phone) ? "영업시간·휴무·브레이크타임·전화를 빠짐없이 채우세요." : "정확해요. 명절·임시휴무는 그때그때 반영하세요.", action: "고객 화면 보기", go: "discovery" },
      { key: "conv", icon: "🅿️", label: "편의시설", status: conv >= 4 ? "good" : conv >= 1 ? "warn" : "bad", value: `${conv}개`, why: "주차·예약·포장·와이파이·반려동물 등은 '상황 검색'(주차되는 맛집 등)에 걸리게 해줘요.", how: conv < 4 ? "해당되는 편의시설을 모두 체크하세요. 특히 주차·포장·예약은 검색에 자주 쓰여요." : "잘 돼 있어요.", action: "고객 화면 보기", go: "discovery" },
      { key: "news", icon: "📢", label: "소식·공지", status: (src.newsCount || 0) >= 1 ? "good" : "warn", value: src.newsCount != null ? `${src.newsCount}건` : "확인 필요", why: "새 소식(이벤트·신메뉴)을 꾸준히 올리면 '살아있는 가게'로 읽혀 노출과 재방문에 도움돼요.", how: (src.newsCount || 0) < 1 ? "스마트플레이스 '소식'에 이벤트·신메뉴·휴무 공지를 주기적으로 올리세요." : "잘하고 있어요. 최소 2주에 한 번은 새 소식을 올리세요.", action: "고객 화면 보기", go: "discovery" },
      { key: "desc", icon: "📖", label: "매장 소개글", status: (src.description && src.description.length >= 20) ? "good" : "bad", value: src.description ? `${src.description.length}자` : "비어 있음", why: "소개글은 검색·네이버 AI가 '어떤 집인지' 이해하는 근거예요. 대표 키워드가 들어가면 관련 검색에 더 잘 걸려요.", how: (!src.description || src.description.length < 20) ? "누가·무엇을·어떤 특징인지 2~3문장으로 쓰고, 노리는 지역 키워드를 자연스럽게 넣으세요." : "잘 작성됐어요. 노리는 키워드가 들어갔는지 확인하세요.", action: "고객 화면 보기", go: "discovery" },
      { key: "ai_briefing", icon: "✨", label: "AI 브리핑 참여", status: "input", value: "직접 확인", why: "2025년부터 AI 브리핑 참여 업체는 리뷰 기반 요약 등 새로운 탐색 화면에 노출될 기회가 생겼어요.", how: "스마트플레이스에서 AI 브리핑 참여 설정과 요약 내용이 실제 매장과 맞는지 확인하세요.", action: "고객 화면 보기", go: "discovery" },
      { key: "category_photo", icon: "🖼️", label: "업종별 대표 사진", status: photos >= 10 ? "good" : "warn", value: photos ? `${photos}장 수집` : "확인 필요", why: "2026년 검색 화면은 업종에 맞는 업체·방문자 리뷰 사진을 더 적극적으로 보여줘요.", how: "최근 1년 사진 중 외관·공간·대표 메뉴처럼 업종을 분명히 보여주는 고화질 사진을 우선 보강하세요.", action: "고객 화면 보기", go: "discovery" },
      { key: "special_info", icon: "🧩", label: "2026 업종 특화정보", status: conv >= 4 ? "good" : "input", value: "직접 확인", why: "콜키지·대관·좌석·키즈메뉴·반려동물·인근 주차장 같은 상세정보가 검색과 상세 화면에 새로 강조돼요.", how: "내 업종에 해당하는 특화정보를 빠짐없이 켜고 조건·가격까지 정확히 적으세요.", action: "고객 화면 보기", go: "discovery" },
      { key: "place_plus", icon: "➕", label: "Place+·시간대 노출", status: "input", value: "대상 업종 확인", why: "2026년에는 Place+ 전용 필터와 평일 점심·금요일 저녁 등 요일·시간대 추천 영역이 생겼어요.", how: "식당이라면 POS 연동·Place+ 대상 여부를 확인하고, 점심·저녁별 인기 메뉴와 영업정보를 최신으로 유지하세요.", action: "고객 화면 보기", go: "discovery" },
    ];

    // D. 키워드
    const autoKw = src.keywords || [];
    const keyword: ReportItem[] = [
      { key: "kw", icon: "🎯", label: "노릴 키워드", status: kwCount >= 3 ? "good" : kwCount >= 1 ? "warn" : "bad", value: `${kwCount}개 설정`, why: "'역명+메뉴+상황' 같은 좁은 키워드 3~5개를 정해 집중해야 상위노출이 현실적이에요. 넓은 키워드는 경쟁이 너무 세요.", how: (autoKw.length ? `손님이 많이 남긴 키워드: ${autoKw.slice(0, 6).join(", ")}. ` : "") + (kwCount < 3 ? "이 중 좁은 키워드 3~5개를 골라 순위를 측정하세요." : "좋아요. 키워드별 순위를 주기적으로 재측정하세요."), action: "키워드·순위 보기", go: "rank" },
      { key: "review_keyword_order", icon: "🏷️", label: "리뷰 키워드 상위 5개", status: "input", value: "직접 확인", why: "2026년부터 사장님이 리뷰 키워드 노출 순서를 조정할 수 있고 상위 5개가 먼저 보여요.", how: "매장의 실제 강점과 노리는 검색 의도에 맞는 리뷰 키워드 5개를 맨 앞으로 정렬하세요.", action: "키워드·순위 보기", go: "rank" },
    ];

    // E. 순위 하락·페널티 자가진단 (안내형: 조작·어뷰징이 순위를 떨어뜨림)
    const penalty: ReportItem[] = [
      { key: "pen_traffic", icon: "🚫", label: "허위 트래픽·저장 조작", status: "warn", value: "확인 필요", why: "몇 초마다 방문·특정 검색어로만 방문·체류 0초 같은 인위적 패턴은 네이버가 즉시 감지해 순위를 급락시켜요. 대행사 '리워드 트래픽'도 위험해요.", how: "트래픽·저장수를 돈 주고 늘리는 업체를 쓰고 있다면 중단하세요. 실제 손님 행동만 순위에 안전하게 반영돼요.", action: undefined, go: undefined },
      { key: "pen_review", icon: "⚠️", label: "리뷰 이벤트·대가성 리뷰", status: "warn", value: "확인 필요", why: "과한 보상을 걸고 리뷰를 몰아 받으면 어뷰징으로 걸려 노출에서 빠질 수 있어요. 짧은 시간에 비슷한 리뷰가 쏟아지는 것도 위험 신호예요.", how: "리뷰는 자연스럽게·꾸준히 받으세요. '리뷰 쓰면 서비스' 정도의 가벼운 안내는 괜찮지만 현금·상품권 남발은 피하세요.", action: undefined, go: undefined },
      { key: "pen_info", icon: "🔀", label: "정보 불일치·잦은 변경", status: "warn", value: "확인 필요", why: "상호·주소·업종이 실제와 다르거나 대표 키워드를 자주 바꾸면 신뢰도가 떨어져 순위가 흔들려요.", how: "간판·사업자등록과 일치하게 맞추고, 대표 키워드는 정한 뒤 자주 바꾸지 마세요.", action: "고객 화면 보기", go: "discovery" },
    ];

    const groups: ReportGroup[] = [
      { title: "① 손님 행동 지표", subtitle: "저장·예약·길찾기 — 운영 성과와 함께 비교", weight: "관심·전환", items: behavior },
      { title: "② 리뷰", subtitle: "블로그·방문자 리뷰 (퍼블리로 채우는 핵심)", weight: "매우 중요", items: reviews },
      { title: "③ 정보 완성도", subtitle: "사진·메뉴·영업시간·편의시설 (필수 기본)", weight: "기본 필수", items: info },
      { title: "④ 키워드 전략", subtitle: "좁은 지역 키워드 3~5개 집중", weight: "방향 설정", items: keyword },
      { title: "⑤ 순위 하락·페널티 자가진단", subtitle: "조작·어뷰징이 순위를 떨어뜨려요", weight: "주의", items: penalty },
    ];
    const all = groups.flatMap(g => g.items);
    // ★ 별점: 항목 상태→별(good 5·warn 3·bad 1·input 2) × 서치 근거 가중치(영수증리뷰·저장 최고). 종합=가중평균(5점)
    const itemStar = (i: ReportItem): number => i.status === "good" ? 5 : i.status === "warn" ? 3 : i.status === "input" ? 2 : 1;
    const WEIGHT: Record<string, number> = { visitor: 5, save: 5, blog: 4, directions: 4, kw: 4, reserve: 3, photo: 3, menu: 3, share: 3, hours: 2, conv: 2, news: 2, desc: 3 };
    // 안내형(페널티·최신성·답변)은 점수에서 제외 — WEIGHT에 있는 항목만 채점
    const scored = all.filter(i => WEIGHT[i.key] != null);
    const goodCountScored = scored.filter(i => i.status === "good").length;
    const score = scored.length ? Math.round(goodCountScored / scored.length * 100) : 0;
    let ws = 0, wsum = 0;
    for (const i of scored) { const w = WEIGHT[i.key]; ws += itemStar(i) * w; wsum += 5 * w; }
    const overallStars = wsum ? Math.round((ws / wsum) * 5 * 10) / 10 : 0;   // 0.0~5.0
    return { groups, score, goodCount: goodCountScored, totalCount: scored.length, overallStars, itemStar };
  }, [livePlace, ownPlace, comparison, trackedKeywords, behaviorInput]);

  const updateBehavior = (patch: Partial<{ saves: number; directions: number; shares: number }>) => {
    setBehaviorInput(prev => {
      const next = { ...prev, ...patch };
      if (storeKey) { try { localStorage.setItem(`${missionKey(userId, storeKey)}:behavior`, JSON.stringify(next)); } catch {} }
      return next;
    });
  };
  const toggleMission = async (id: string) => {
    const next = completedMissions.includes(id) ? completedMissions.filter(item => item !== id) : [...completedMissions, id];
    setCompletedMissions(next);
    if (storeKey) localStorage.setItem(missionKey(userId, storeKey), JSON.stringify(next));
    if (storeKey && plan !== "admin") {
      try { await savePlace360MissionProgress(storeKey, next); }
      catch { showToast?.("완료 표시는 저장했지만 서버 동기화는 잠시 후 다시 시도해 주세요", "info"); }
    }
  };
  const completeMissionAutomatically = async (id: string) => {
    if (completedMissions.includes(id)) return;
    const next = [...completedMissions, id];
    setCompletedMissions(next);
    if (storeKey) localStorage.setItem(missionKey(userId, storeKey), JSON.stringify(next));
    if (storeKey && plan !== "admin") {
      try { await savePlace360MissionProgress(storeKey, next); } catch {}
    }
  };
  const onReviewerHandoff = async (count: number) => {
    if (!storeKey) return;
    const next = reviewerHandoffCount + count;
    setReviewerHandoffCount(next);
    localStorage.setItem(`${missionKey(userId, storeKey)}:reviewers`, String(next));
    if (plan !== "admin") {
      try {
        const row = await recordPlace360ReviewerHandoff(storeKey, count);
        if (row) setReviewerHandoffCount(row.reviewer_handoff_count);
      } catch { showToast?.("협업 후보는 전달했지만 완료 기록 동기화는 잠시 후 다시 시도해 주세요", "info"); }
    }
    await completeMissionAutomatically("blogger");
  };
  const updateBusinessMetric = (key: keyof BusinessMetricDraft, raw: string) => {
    const value = Math.min(1000000000, Math.max(0, Math.round(Number(raw) || 0)));
    setBusinessMetrics(current => ({ ...current, [key]: value }));
  };
  const downloadMetricsTemplate = () => {
    const csv = "\ufeff기간,신규고객수,재방문고객수,광고비,광고행동수,매출\r\n최근30일,0,0,0,0,0\r\n이전30일,0,0,0,0,0\r\n";
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const anchor = document.createElement("a"); anchor.href = url; anchor.download = "퍼블리-플레이스 365-운영자료.csv"; anchor.click(); URL.revokeObjectURL(url);
    showToast?.("CSV 양식을 저장했어요. 숫자를 채운 뒤 다시 불러오세요", "success");
  };
  const importMetricsCsv = async (file?: File) => {
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) { showToast?.("CSV 파일은 2MB보다 작아야 해요", "error"); return; }
    try {
      const bytes = await file.arrayBuffer();
      let decoded = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
      if (decoded.includes("�")) {
        try { decoded = new TextDecoder("euc-kr", { fatal: false }).decode(bytes); } catch {}
      }
      const text = decoded.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
      const lines = text.split("\n").filter(line => line.trim()).slice(0, 1002);
      if (lines.length < 3) throw new Error("최근 30일과 이전 30일, 두 줄이 필요해요");
      const headers = parseCsvLine(lines[0]).map(normalizeCsvHeader);
      const aliases: Record<string, string[]> = {
        period: ["기간", "period", "구분"], newCustomers: ["신규고객수", "신규고객", "newcustomers", "newcustomer"],
        repeatCustomers: ["재방문고객수", "재방문고객", "repeatcustomers", "returningcustomers"], adSpend: ["광고비", "광고비용", "adspend", "adcost"],
        adActions: ["광고행동수", "광고전환수", "전화예약길찾기", "adactions", "conversions"], sales: ["매출", "총매출", "sales", "revenue"],
      };
      const column = (name: keyof typeof aliases) => headers.findIndex(header => aliases[name].includes(header));
      const indexes = { period: column("period"), newCustomers: column("newCustomers"), repeatCustomers: column("repeatCustomers"), adSpend: column("adSpend"), adActions: column("adActions"), sales: column("sales") };
      if (Object.values(indexes).some(index => index < 0)) throw new Error("양식의 열 이름이 달라요. ‘CSV 양식 받기’ 파일을 사용해 주세요");
      const rows = lines.slice(1).map(parseCsvLine);
      const recent = rows.find(row => /최근|current|이번/.test(normalizeCsvHeader(row[indexes.period] || "")));
      const previous = rows.find(row => /이전|previous|직전/.test(normalizeCsvHeader(row[indexes.period] || "")));
      if (!recent || !previous) throw new Error("기간 칸에 ‘최근30일’과 ‘이전30일’이 모두 필요해요");
      const numberAt = (row: string[], index: number) => Math.min(1000000000, Math.max(0, Math.round(Number((row[index] || "0").replace(/[^0-9.-]/g, "")) || 0)));
      setBusinessMetrics({
        current_new_customers: numberAt(recent, indexes.newCustomers), previous_new_customers: numberAt(previous, indexes.newCustomers),
        current_repeat_customers: numberAt(recent, indexes.repeatCustomers), previous_repeat_customers: numberAt(previous, indexes.repeatCustomers),
        current_ad_spend: numberAt(recent, indexes.adSpend), previous_ad_spend: numberAt(previous, indexes.adSpend),
        current_ad_actions: numberAt(recent, indexes.adActions), previous_ad_actions: numberAt(previous, indexes.adActions),
        current_sales: numberAt(recent, indexes.sales), previous_sales: numberAt(previous, indexes.sales),
      });
      showToast?.("CSV 숫자를 불러왔어요. 내용을 확인하고 진단 버튼을 눌러주세요", "success");
    } catch (error: any) { showToast?.(error?.message || "CSV 파일을 읽지 못했어요", "error"); }
    finally { if (csvInputRef.current) csvInputRef.current.value = ""; }
  };
  const saveBusinessMetrics = async () => {
    if (!hasStore || !storeKey) { showToast?.("먼저 내 매장을 등록해 주세요", "info"); setTab("overview"); return; }
    setMetricsLoading(true);
    try {
      const input = { store_key: storeKey, store_name: profile.name, ...businessMetrics };
      if (plan === "admin") {
        const local = { id: `admin-${storeKey}`, user_id: "admin", ...input, measured_on: new Date().toISOString().slice(0, 10), updated_at: new Date().toISOString() };
        localStorage.setItem(adminMetricsKey(storeKey), JSON.stringify(local));
        setMetricsSavedAt(local.updated_at);
      } else {
        const saved = await savePlace360BusinessMetrics(input);
        setMetricsSavedAt(saved?.updated_at || new Date().toISOString());
      }
      await completeMissionAutomatically("owner-data");
      showToast?.("최근 30일 운영자료를 안전하게 저장하고 진단했어요", "success");
    } catch (error: any) {
      const message = String(error?.message || "");
      showToast?.(message.includes("PLACE360_STORE_LIMIT") ? "내 등급의 등록 매장 수를 모두 사용했어요" : "운영자료를 저장하지 못했어요. 잠시 후 다시 시도해 주세요", "error");
    } finally { setMetricsLoading(false); }
  };
  const operationalDiagnosis = useMemo(() => {
    const percent = (current: number, previous: number) => previous > 0 ? Math.round((current - previous) / previous * 100) : null;
    const newChange = percent(businessMetrics.current_new_customers, businessMetrics.previous_new_customers);
    const currentTotal = businessMetrics.current_new_customers + businessMetrics.current_repeat_customers;
    const previousTotal = businessMetrics.previous_new_customers + businessMetrics.previous_repeat_customers;
    const repeatRate = currentTotal > 0 ? Math.round(businessMetrics.current_repeat_customers / currentTotal * 100) : null;
    const previousRepeatRate = previousTotal > 0 ? Math.round(businessMetrics.previous_repeat_customers / previousTotal * 100) : null;
    const currentCpa = businessMetrics.current_ad_actions > 0 ? Math.round(businessMetrics.current_ad_spend / businessMetrics.current_ad_actions) : null;
    const previousCpa = businessMetrics.previous_ad_actions > 0 ? Math.round(businessMetrics.previous_ad_spend / businessMetrics.previous_ad_actions) : null;
    const salesChange = percent(businessMetrics.current_sales, businessMetrics.previous_sales);
    return { newChange, repeatRate, previousRepeatRate, currentCpa, previousCpa, salesChange };
  }, [businessMetrics]);
  const currentRank = useMemo<RankMeasurement | null>(() => {
    if (latestRank) return latestRank;
    const saved = rankHistory[0];
    return saved ? { query: saved.keyword, rank: saved.rank, checkedCount: saved.checked_count, measuredAt: saved.measured_at, surface: saved.surface } : null;
  }, [latestRank, rankHistory]);
  const rankTimeline = useMemo(() => currentRank ? rankHistory.filter(row => row.keyword === currentRank.query).slice(0, 12) : [], [currentRank, rankHistory]);
  const previousRank = useMemo(() => {
    if (!currentRank) return undefined;
    const currentTime = new Date(currentRank.measuredAt).getTime();
    return rankTimeline.find(row => new Date(row.measured_at).getTime() < currentTime - 1000);
  }, [currentRank, rankTimeline]);
  // 🔔 순위 급변 감지: 키워드별 최근 2개 측정 비교(3계단 이상). 축하(상승)·경고(하락) 알림용
  const rankAlerts = useMemo(() => {
    const byKw = new Map<string, Place360RankMeasurement[]>();
    rankHistory.forEach(r => { const a = byKw.get(r.keyword) || []; a.push(r); byKw.set(r.keyword, a); });
    const alerts: { keyword: string; from: number | null; to: number | null; delta: number; up: boolean; entered: boolean }[] = [];
    byKw.forEach((list, keyword) => {
      const s = [...list].sort((a, b) => new Date(b.measured_at).getTime() - new Date(a.measured_at).getTime());
      const to = s[0]?.rank ?? null, from = s[1]?.rank ?? null;
      if (from == null && to != null) { alerts.push({ keyword, from, to, delta: 0, up: true, entered: true }); return; }   // 새로 진입
      if (from != null && to != null && from !== to) { const delta = from - to; if (Math.abs(delta) >= 3) alerts.push({ keyword, from, to, delta, up: delta > 0, entered: false }); }
    });
    return alerts.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta)).slice(0, 3);
  }, [rankHistory]);
  const weeklySummary = useMemo(() => {
    const cutoff = Date.now() - 7 * 86400000;
    const ranks = rankHistory.filter(row => (!currentRank || row.keyword === currentRank.query) && new Date(row.measured_at).getTime() >= cutoff);
    const ranked = ranks.filter(row => row.rank !== null);
    const newest = ranked[0]?.rank ?? null;
    const oldest = ranked[ranked.length - 1]?.rank ?? null;
    const rankChange = newest !== null && oldest !== null ? oldest - newest : null;
    const recentSnapshots = snapshots.filter(row => new Date(row.created_at || row.measured_on).getTime() >= cutoff);
    const missionDone = growthMissions.filter(item => completedMissions.includes(item.id)).length;
    return { measurements: ranks.length, bestRank: ranked.length ? Math.min(...ranked.map(row => row.rank as number)) : null, rankChange, diagnoses: recentSnapshots.length, missionDone };
  }, [completedMissions, currentRank, growthMissions, rankHistory, snapshots]);
  const dark = theme === "dark";

  // 색감=크롤링(CrawlCenter)과 통일: 따뜻한 테라코타/크림 톤. accent(rose 키 유지)=크롤 accent
  // 색감=블로그지수(주치의)와 통일. 메인=민트그린 #00c896, 강조=핑크 #ff5fa2, 특별=퍼플 #8b5cf6, 경고=앰버 #f59e0b.
  // rose 키=메인 민트(기존 코드 호환 위해 키 이름 유지), green=서브 민트, amber=경고, pink/purple 추가.
  const colors = useMemo(() => dark ? {
    bg: "#20302b", card: "#2a3d37", soft: "#324841", line: "#3f5850", text: "#eafff7", sub: "#a9d0c3", rose: "#1fe0b0", green: "#4ae8c2", amber: "#ffce5c", pink: "#ff8fbc", purple: "#b4a0fb",
  } : {
    bg: "#eefbf6", card: "#ffffff", soft: "#effaf4", line: "#d6ede3", text: "#0f2b23", sub: "#5c8478", rose: "#00c896", green: "#12a594", amber: "#e59214", pink: "#ff5fa2", purple: "#8b5cf6",
  }, [dark]);

  // 🔎 플레이스 주소만 붙여넣으면 이름·업종·지역을 봇이 공개 페이지에서 바로 당겨온다(로그인 불필요).
  const pushLog = (pct: number, msg: string) => { setScanPct(pct); setScanLog(prev => [...prev, `${pct}% · ${msg}`]); };
  // 🎯 자동 키워드 발굴(자동완성+연관검색) — 지역·업종·상호를 시드로 봇 공개 엔드포인트 호출
  const loadAutoKeywords = async (override?: Partial<StoreProfile>) => {
    const reg = (override?.region || profile.region || draft.region || "").trim();
    const cat = (override?.category || profile.category || draft.category || "").trim();
    const nm = (override?.name || profile.name || draft.name || "").trim();
    // 업종별 '상황어'를 붙여 롱테일 시드 확장(대행사식: 역명+메뉴+상황). 감지 안 되면 범용어.
    const blob = `${cat} ${nm}`;
    const situ = /식당|맛집|고기|한우|횟집|족발|치킨|국밥|분식|밥집|중식|일식|한식|양식|해산물|음식/.test(blob) ? ["맛집", "회식", "데이트", "가족모임", "혼밥", "포장", "예약"]
      : /카페|커피|디저트|베이커리|브런치|빵/.test(blob) ? ["카페", "감성카페", "디저트", "브런치", "데이트", "공부"]
      : /미용|헤어|네일|피부|왁싱|에스테틱|살롱|뷰티/.test(blob) ? ["잘하는곳", "예약", "가격", "남자", "여자"]
      : /병원|의원|치과|한의원|clinic|정형|피부과|성형/.test(blob) ? ["잘하는곳", "야간", "주말", "예약", "후기"]
      : /헬스|피트|필라테스|요가|pt|운동/.test(blob) ? ["가격", "PT", "1일권", "여성", "24시"]
      : /펜션|숙박|호텔|모텔|게스트|캠핑|글램핑/.test(blob) ? ["가족", "커플", "바베큐", "오션뷰", "예약"]
      : ["잘하는곳", "추천", "가격", "예약"];
    const seedSet = new Set<string>();
    if (reg && cat) seedSet.add(`${reg} ${cat}`);
    if (reg) situ.slice(0, 5).forEach(s => seedSet.add(`${reg} ${s}`));   // 지역+상황
    if (nm) seedSet.add(nm);
    if (reg && nm) seedSet.add(`${reg} ${nm}`);
    if (cat) seedSet.add(cat);
    const seeds = Array.from(seedSet).filter(Boolean).slice(0, 6);
    if (!seeds.length) { showToast?.("먼저 매장 정보(지역·업종)를 넣어주세요", "info"); return; }
    setKwLoading(true); pushLog(scanPct, "🎯 키워드 발굴 중(자동완성·연관검색)…");
    try {
      const res = await botFetch(`${BOT}/api/place/keywords?userId=${encodeURIComponent(userId || "")}&seeds=${encodeURIComponent(JSON.stringify(seeds))}`);
      const data = await res.json().catch(() => ({}));
      if (res.ok && data?.ok && Array.isArray(data.keywords)) {
        const list = (data.keywords as { keyword: string; source: string }[]).filter(k => !trackedKeywords.includes(k.keyword));
        setAutoKeywords(list);
        pushLog(scanPct, `🎯 키워드 ${list.length}개 발굴 완료 — 우선 후보 5개 자동 순위 측정`);
        const auto5 = list.slice(0, 5).map(k => k.keyword).filter(k => !rankHistory.some(r => r.keyword === k));
        if (auto5.length) setRankQueue(q => Array.from(new Set([...q, ...auto5])));
      } else { showToast?.(data?.error || "키워드 발굴에 실패했어요", "error"); }
    } catch { showToast?.("봇 연결 실패 — 앱 실행 확인", "error"); }
    finally { setKwLoading(false); }
  };
  const resolveFromUrl = async () => {
    const url = draft.placeUrl.trim();
    if (!url) { showToast?.("먼저 네이버 플레이스 주소를 붙여넣어 주세요", "info"); return; }
    setResolving(true); setOneClickPending(true); setScanLog([]); setScanPct(0);
    try {
      pushLog(8, "플레이스 주소 확인 중…");
      pushLog(20, "매장 기본정보·사진·메뉴 수집 중…");
      const res = await botFetch(`${BOT}/api/place/resolve?userId=${encodeURIComponent(userId || "")}&placeUrl=${encodeURIComponent(url)}`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.ok || !data?.detail) {
        pushLog(100, "실패 — 주소를 확인해 주세요");
        showToast?.(data?.error || "매장 정보를 불러오지 못했어요. 주소를 확인해 주세요", "error");
        setOneClickPending(false); return;
      }
      const d = data.detail as LivePlaceDetail;
      pushLog(50, `저장·리뷰·평점 수집 완료 (방문자 ${(d.visitorReviewCount||0).toLocaleString()} · 블로그 ${(d.blogReviewCount||0).toLocaleString()})`);
      setLivePlace(d);   // ★리뷰·영업시간·전화·메뉴·편의시설·사진·저장수·평점·키워드까지 전체를 한 번에 보관
      const regionHint = String(d.address || "").match(/([가-힣]+(?:동|읍|면|리|가|로|구|시))/)?.[1] || "";
      const resolved = { ...draft, name: d.name?.trim() || draft.name, category: d.category?.trim() || draft.category, region: draft.region.trim() || regionHint, placeUrl: d.placeUrl?.trim() || url };
      setDraft(resolved);
      if (typeof d.visitorReviewScore === "number" && d.visitorReviewScore > 0) {
        const nextStoreKey = place360StoreKey(resolved.name, resolved.region);
        const point = { score: d.visitorReviewScore, reviewCount: d.visitorReviewCount || 0, measuredAt: new Date().toISOString() };
        let history: Array<{ score: number; reviewCount: number; measuredAt: string }> = [];
        try { history = JSON.parse(localStorage.getItem(ratingHistoryKey(userId, nextStoreKey)) || "[]"); } catch {}
        const nextHistory = [point, ...(Array.isArray(history) ? history : [])].slice(0, 365);
        localStorage.setItem(ratingHistoryKey(userId, nextStoreKey), JSON.stringify(nextHistory));
        setRatingHistory(nextHistory);
      }
      pushLog(75, "🎯 노릴 키워드 자동 발굴 중…");
      void loadAutoKeywords(resolved);   // 방금 수집한 값으로 자동완성·연관검색 키워드 병행 수집
      pushLog(90, "종합 별점 산출 중…");
      pushLog(100, "완료 — 상위노출 진단표가 준비됐어요");
      showToast?.(`'${d.name || "매장"}' 전체 분석 완료`, "success");
    } catch {
      setOneClickPending(false);
      pushLog(100, "봇 연결 실패 — 앱 실행 확인");
      showToast?.("봇 서버에 연결하지 못했어요. 퍼블리 앱이 실행 중인지 확인해 주세요", "error");
    } finally {
      setResolving(false);
    }
  };

  const refreshRatingNow = async () => {
    const url = (profile.placeUrl || draft.placeUrl).trim();
    if (!url) { showToast?.("먼저 플레이스 주소를 등록해 주세요", "info"); return; }
    setRatingRefreshing(true);
    try {
      const res = await botFetch(`${BOT}/api/place/resolve?userId=${encodeURIComponent(userId || "")}&placeUrl=${encodeURIComponent(url)}&fresh=${Date.now()}`);
      const data = await res.json().catch(() => ({}));
      const d = data?.detail as LivePlaceDetail | undefined;
      if (!res.ok || !data?.ok || !d) throw new Error(data?.error || "별점을 가져오지 못했어요");
      setLivePlace(prev => ({ ...(prev || {}), ...d }));
      if (typeof d.visitorReviewScore === "number" && d.visitorReviewScore > 0) {
        const point = { score: d.visitorReviewScore, reviewCount: d.visitorReviewCount || 0, measuredAt: new Date().toISOString() };
        const nextHistory = [point, ...ratingHistory].slice(0, 365);
        localStorage.setItem(ratingHistoryKey(userId, storeKey), JSON.stringify(nextHistory));
        setRatingHistory(nextHistory);
        showToast?.(`네이버 최신 공개 별점 ${d.visitorReviewScore}점을 기록했어요`, "success");
      } else showToast?.("평균 별점이 미노출 상태이거나 아직 공개되지 않았어요", "info");
    } catch (error: any) { showToast?.(error?.message || "별점 재측정에 실패했어요", "error"); }
    finally { setRatingRefreshing(false); }
  };

  const saveStore = async () => {
    if (!draft.name.trim()) {
      showToast?.("먼저 내 매장 이름을 입력해 주세요", "info");
      return;
    }
    const next = { ...draft, name: draft.name.trim(), placeUrl: draft.placeUrl.trim() };
    const nextKey = place360StoreKey(next.name, next.region);
    const existingIndex = profiles.findIndex(item => place360StoreKey(item.name, item.region) === (editingStoreKey || nextKey));
    const duplicateIndex = profiles.findIndex(item => place360StoreKey(item.name, item.region) === nextKey);
    const isNew = existingIndex < 0 && duplicateIndex < 0;
    const storeLimit = PLACE360_STORE_LIMIT[plan] ?? PLACE360_STORE_LIMIT.free;
    if (isNew && profiles.length >= storeLimit) {
      showToast?.(`내 등급은 매장을 ${storeLimit}개까지 등록할 수 있어요`, "info");
      return;
    }
    if (editingStoreKey && editingStoreKey !== nextKey && duplicateIndex >= 0 && duplicateIndex !== existingIndex) {
      showToast?.("같은 이름과 지역으로 등록된 매장이 이미 있어요", "info");
      return;
    }
    if (editingStoreKey && editingStoreKey !== nextKey && plan !== "admin") {
      try { await renamePlace360Store(editingStoreKey, nextKey, next.name, next.region); }
      catch (error: any) { showToast?.(String(error?.message || "").includes("PLACE360_STORE_EXISTS") ? "같은 이름과 지역으로 등록된 매장이 이미 있어요" : "저장된 측정 기록의 매장 정보를 바꾸지 못했어요", "error"); return; }
    }
    if (plan !== "admin") {
      try { await savePlace360StoreProfile({ store_key: nextKey, store_name: next.name, place_url: next.placeUrl, category: next.category, region: next.region, goal: next.goal }); }
      catch (error: any) { const message = String(error?.message || ""); showToast?.(message.includes("PLACE360_STORE_LIMIT") ? `내 등급은 매장을 ${storeLimit}개까지 등록할 수 있어요` : "매장 정보를 서버에 저장하지 못했어요", "error"); return; }
    }
    const updated = existingIndex >= 0
      ? profiles.map((item, index) => index === existingIndex ? next : item)
      : duplicateIndex >= 0
        ? profiles.map((item, index) => index === duplicateIndex ? next : item)
        : [...profiles, next];
    persistProfiles(userId, updated, next);
    setProfiles(updated);
    setProfile(next);
    setDraft(next);
    setEditingStoreKey(nextKey);
    setStoreFormOpen(false);
    // ★링크로 불러온 현황(리뷰수)을 오늘 기준 스냅샷으로 기록 → 다음에 다시 불러올 때 증감 추적 시작(블로그지수식)
    if (livePlace && plan !== "admin" && ((livePlace.visitorReviewCount || 0) > 0 || (livePlace.blogReviewCount || 0) > 0)) {
      try {
        await savePlace360Snapshot({ store_key: nextKey, store_name: next.name, region: next.region, category: next.category, visitor_reviews: livePlace.visitorReviewCount || 0, blog_reviews: livePlace.blogReviewCount || 0, competitor_count: 0, competitor_avg_visitor: 0, competitor_avg_blog: 0, collected_count: 0 });
        setSnapshots(await getPlace360Snapshots(nextKey));
      } catch { /* 스냅샷 실패해도 등록은 유지 */ }
    }
    // ★링크로 등록했으면(livePlace) 추천 키워드 1개로 순위·경쟁사까지 자동 측정 → 링크 하나로 다 끌어오기 완성
    const autoKw = livePlace ? (suggestKeywords(next.name, next.category, next.region)[0] || "") : "";
    if (autoKw) {
      showToast?.("현황을 기록했어요. 이제 순위·경쟁사를 자동으로 측정할게요…", "success");
      setAutoRankKw(autoKw);   // useEffect가 프로필 반영 후 실행(순위탭 자동 이동)
    } else {
      showToast?.("내 매장을 저장하고 오늘 현황을 기록했어요. 이제 추적이 시작돼요", "success");
      setTab("diagnosis");
    }
  };
  // 링크를 한 번 검사하면 별도 저장 버튼 없이 매장 저장→스냅샷→첫 순위 측정까지 이어간다.
  useEffect(() => {
    if (!oneClickPending || resolving || !livePlace || !draft.name.trim()) return;
    setOneClickPending(false);
    pushLog(100, "💾 매장 저장·기준선 기록·100위권 측정을 자동 시작해요");
    void saveStore();
    // saveStore는 상태 기반 원클릭 파이프라인의 마지막 단계이며 이 조건에서 한 번만 실행된다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [oneClickPending, resolving, livePlace, draft.name]);
  const selectStore = (next: StoreProfile) => {
    setProfile(next); setDraft(next); setEditingStoreKey(place360StoreKey(next.name, next.region));
    localStorage.setItem(profileKey(userId), JSON.stringify(next));
    setCollectedPlaces([]); setLatestRank(null); setStoreFormOpen(false);
  };
  const startAddingStore = () => {
    const storeLimit = PLACE360_STORE_LIMIT[plan] ?? PLACE360_STORE_LIMIT.free;
    if (profiles.length >= storeLimit) { showToast?.(`내 등급은 매장을 ${storeLimit}개까지 등록할 수 있어요`, "info"); return; }
    setProfile(EMPTY_PROFILE); setDraft(EMPTY_PROFILE); setEditingStoreKey(null); setCollectedPlaces([]); setLatestRank(null); setStoreFormOpen(true); setTab("overview");
  };
  const removeCurrentStore = async () => {
    if (!hasStore || !window.confirm(`${profile.name} 매장을 삭제할까요? 이 매장의 저장된 순위·진단·운영자료가 함께 삭제되며 되돌릴 수 없습니다.`)) return;
    try {
      if (plan !== "admin") await deletePlace360Store(storeKey);
      else localStorage.removeItem(adminMetricsKey(storeKey));
      const remaining = profiles.filter(item => place360StoreKey(item.name, item.region) !== storeKey);
      const next = remaining[0] || EMPTY_PROFILE;
      setProfiles(remaining); setProfile(next); setDraft(next); setEditingStoreKey(next.name ? place360StoreKey(next.name, next.region) : null);
      persistProfiles(userId, remaining, next); setCollectedPlaces([]); setLatestRank(null); setStoreFormOpen(!next.name);
      showToast?.("매장과 저장된 진단 기록을 삭제했어요", "success");
    } catch (error: any) { showToast?.(error?.message || "매장을 삭제하지 못했어요", "error"); }
  };

  const tabs: Array<{ id: Place360Tab; icon: string; label: string; desc: string }> = [
    { id: "overview", icon: "🏠", label: "한눈에 보기", desc: "현재 상태와 다음 할 일" },
    { id: "rank", icon: "📍", label: "지금 내 순위", desc: "누르는 순간 최신 위치 확인" },
    { id: "diagnosis", icon: "🩺", label: "내 매장 진단", desc: "손님이 줄어든 이유 찾기" },
    { id: "data", icon: "📊", label: "포스 자료 입력", desc: "신규·재방문·광고 넣는 곳" },
    { id: "mission", icon: "✅", label: "오늘 할 일", desc: "그대로 따라 하는 성장 미션" },
    { id: "discovery", icon: "🕵️", label: "업체·리뷰어 찾기", desc: "업체 발굴과 리뷰어 역추적" },
  ];

  const guideStepStates: Array<{ id: Place360Tab; label: string; done: boolean }> = [
    { id: "overview", label: "매장 등록", done: hasStore },
    { id: "rank", label: "순위 확인", done: Boolean(currentRank) },
    { id: "diagnosis", label: "원인 진단", done: Boolean(comparison || snapshots.length) },
    { id: "data", label: "포스자료", done: Boolean(metricsSavedAt) },
    { id: "mission", label: "오늘 미션", done: growthMissions.length > 0 && growthMissions.every(item => completedMissions.includes(item.id)) },
    { id: "discovery", label: "리뷰어 제안", done: reviewerHandoffCount > 0 },
  ];
  // 진료차트 헤더용: 핵심 5단계(등록·순위·진단·운영·미션) 중 완료 개수
  const doneStepCount = guideStepStates.slice(0, 5).filter(s => s.done).length;

  const growthGuide: Record<Place360Tab, { step: number; title: string; instruction: string; nextLabel: string; nextTab?: Place360Tab; openCrawl?: boolean; scrollToStore?: boolean }> = {
    overview: hasStore
      ? { step: 1, title: "내 매장 등록 완료", instruction: "이제 고객이 검색할 때 내 매장이 어디에 보이는지 확인하세요.", nextLabel: "2단계 · 내 순위 확인", nextTab: "rank" }
      : { step: 1, title: "먼저 내 매장을 등록하세요", instruction: "매장 이름을 입력하고 저장하면 나머지 진단이 내 가게 기준으로 연결돼요.", nextLabel: "아래에서 매장 등록하기", scrollToStore: true },
    rank: currentRank
      ? { step: 2, title: `현재 ${currentRank.rank ? `${currentRank.rank}위` : "확인 범위 밖"}`, instruction: "순위를 확인했어요. 다음은 경쟁업체와 비교해 이유를 찾을 차례예요.", nextLabel: "3단계 · 원인 진단", nextTab: "diagnosis" }
      : { step: 2, title: "내 순위를 먼저 측정하세요", instruction: "업체 찾기에서 지역과 업종을 검색하면 내 매장의 현재 순위가 함께 기록돼요.", nextLabel: "업체 찾기에서 측정", nextTab: "discovery" },
    diagnosis: { step: 3, title: "공개자료로 원인을 좁히는 단계", instruction: "리뷰·노출·정보 완성도를 확인한 뒤 실제 매출 자료와 함께 비교하세요.", nextLabel: "4단계 · 운영자료 입력", nextTab: "data" },
    data: { step: 4, title: "신규·재방문·광고를 나눠보는 단계", instruction: "최근 30일과 이전 30일을 입력하면 무엇이 줄었는지 구분해 드려요.", nextLabel: "5단계 · 오늘 할 일 받기", nextTab: "mission" },
    mission: { step: 5, title: "오늘 할 일을 실행하는 단계", instruction: "위에서부터 하나씩 실행하고 완료 체크를 누르면 오늘 진행률을 기억해요.", nextLabel: "6단계 · 리뷰어 찾기", nextTab: "discovery" },
    discovery: { step: 6, title: "업체와 리뷰어를 찾아 제안하는 단계", instruction: "업체 선택 → 리뷰어 역추적 → 분홍색 협업 제안 준비 버튼 순서로 진행하세요.", nextLabel: "선택을 보냈다면 크롤링 열기", openCrawl: true },
  };
  const activeGuide = growthGuide[tab];

  const fieldStyle: React.CSSProperties = { width: "100%", minHeight: 48, borderRadius: 12, border: `1px solid ${colors.line}`, background: dark ? colors.soft : "#fff", color: colors.text, padding: "11px 13px", fontFamily: "inherit", fontSize: 16, outline: "none" };
  const cardStyle: React.CSSProperties = { border: `1px solid ${colors.line}`, borderRadius: 20, background: colors.card };
  // ★ 별 렌더 헬퍼(0~5, 반개 반영)
  const starStr = (n: number) => { const full = Math.floor(n); const half = n - full >= 0.5; return "★".repeat(full) + (half ? "⯪" : "") + "☆".repeat(Math.max(0, 5 - full - (half ? 1 : 0))); };
  // 진단 항목 실행 버튼: '고객 화면 보기'=네이버 플레이스 실제 페이지 열기, 나머지는 해당 섹션으로.
  const runItemAction = (item: { action?: string; go?: Place360Tab }) => {
    if (item.action && item.action.includes("고객 화면")) {
      const url = livePlace?.placeUrl || profile.placeUrl || draft.placeUrl;
      if (url) { window.open(url, "_blank", "noopener,noreferrer"); return; }
      showToast?.("먼저 플레이스 주소를 등록해 주세요", "info"); return;
    }
    if (item.go === "discovery") setDiscoveryOpen(true);
    else if (item.go === "data") { setPosOpen(true); setTimeout(() => document.getElementById("p360-pos")?.scrollIntoView({ behavior: "smooth" }), 60); }
    else if (item.go) setTab(item.go as Place360Tab);
  };
  // 키워드별 미니 순위 스파크라인(오래된→최신). 위로 갈수록 상위. 2개 미만이면 null.
  const kwSpark = (kw: string) => {
    const series = rankHistory.filter(r => r.keyword === kw).sort((a, b) => new Date(a.measured_at).getTime() - new Date(b.measured_at).getTime()).slice(-8).map(r => r.rank);
    if (series.length < 2) return null;
    const vals = series.map(v => v == null ? 101 : v); const W = 56, H = 18;
    const mx = Math.max(...vals), mn = Math.min(...vals), sp = Math.max(1, mx - mn);
    const pts = vals.map((v, i) => `${(i * W / (vals.length - 1)).toFixed(1)},${(2 + (v - mn) / sp * (H - 4)).toFixed(1)}`).join(" ");
    const up = vals[vals.length - 1] <= vals[0];
    return <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} style={{ flexShrink: 0 }}><polyline points={pts} fill="none" stroke={up ? colors.green : colors.pink} strokeWidth={1.6} strokeLinejoin="round" strokeLinecap="round" /></svg>;
  };
  // 📄 PDF 보고서 — 진단 전체를 깔끔한 새 창으로 열어 인쇄(PDF로 저장). 앱 크롬 없이 보고서만.
  const downloadReport = async () => {
    if (!placeReport) { showToast?.("먼저 매장 링크로 분석을 실행해 주세요", "info"); return; }
    const esc = (s: string) => String(s).replace(/[&<>]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c] || c));
    const rows = placeReport.groups.map(g => `<h3>${esc(g.title)} <small>${esc(g.subtitle)}</small></h3>` + g.items.map(it => {
      const st = placeReport.itemStar(it); const badge = it.status === "good" ? "양호" : it.status === "warn" ? "보완" : it.status === "input" ? "입력필요" : "시급";
      return `<div class="it"><b>${esc(it.icon + " " + it.label)}</b> <span class="v">${esc(it.value)}</span> <span class="s">${"★".repeat(st)}${"☆".repeat(5 - st)} ${badge}</span><div class="d"><b>왜?</b> ${esc(it.why)}</div><div class="d"><b>이렇게:</b> ${esc(it.how)}</div></div>`;
    }).join("")).join("");
    // 📈 순위 추이 그래프(SVG) — 리포트 기간 내 측정값
    const gseries = rankHistory.filter(r => !currentRank || r.keyword === currentRank.query).slice(0, 12).reverse().map(r => r.rank);
    let chartSvg = "";
    if (gseries.length >= 2) {
      const vals = gseries.map(v => v == null ? 101 : v); const W = 640, H = 130, pad = 22;
      const mx = Math.max(...vals), mn = Math.min(...vals), sp = Math.max(1, mx - mn);
      const pts = vals.map((v, i) => `${(pad + i * (W - pad * 2) / (vals.length - 1)).toFixed(1)},${(pad + (v - mn) / sp * (H - pad * 2)).toFixed(1)}`);
      const up = vals[vals.length - 1] <= vals[0]; const col = up ? "#00c896" : "#ff5fa2";
      chartSvg = `<div class="chart"><b>📈 순위 추이 (${esc(currentRank?.query || "")}) · ${up ? "▲ 상승세" : "▼ 하락·정체"}</b>
        <svg viewBox="0 0 ${W} ${H}" width="100%" height="150" preserveAspectRatio="none">
        <polyline points="${pts.join(" ")}" fill="none" stroke="${col}" stroke-width="3" stroke-linejoin="round"/>
        ${pts.map(p => { const [x, y] = p.split(","); return `<circle cx="${x}" cy="${y}" r="4" fill="${col}"/>`; }).join("")}
        </svg><div class="csub">위로 갈수록 상위 · 최근 ${gseries.length}회 측정</div></div>`;
    }
    // 📊 기간 리포트 요약(선택 기간)
    const rangeLabel = reportRange === 1 ? "일간" : reportRange === 7 ? "주간" : reportRange === 30 ? "월간" : `최근 ${reportDays}일`;
    // 🎯 다음 액션 — 시급/보완 항목 상위 3개를 '이렇게 하세요'로
    const todo = placeReport.groups.flatMap(g => g.items).filter(it => it.status === "bad" || it.status === "warn").slice(0, 3);
    const todoBlock = todo.length ? `<h2>🎯 지금 해야 할 3가지</h2><ol class="todo">${todo.map(it => `<li><b>${esc(it.icon + " " + it.label)}</b> — ${esc(it.how)}</li>`).join("")}</ol>` : "";
    const measuredAt = currentRank?.measuredAt || livePlace?.collectedAt || new Date().toISOString();
    const nextCheck = new Date(new Date(measuredAt).getTime() + 7 * 86400000);
    const nextCheckText = nextCheck.toLocaleDateString("ko-KR", { year: "numeric", month: "long", day: "numeric" });
    const primaryAction = todo[0]?.how || "현재 정보를 유지하고 같은 조건으로 7일 뒤 다시 측정하세요.";
    const decisionBlock = `<section class="decision"><h2>사장님이 궁금한 세 가지 결론</h2>
      <div><b>1. 상위노출은 어떻게?</b><p>${esc(primaryAction)}</p></div>
      <div><b>2. 성과는 언제?</b><p><strong>${esc(nextCheckText)}</strong> 첫 재측정 · 14일 추세 판정 · 30일 종합 판정</p></div>
      <div><b>3. 그래서 오늘 뭘 해야 하나?</b><p>${esc(todo[0]?.label || "같은 조건 재측정")}부터 하나만 완료하세요.</p></div></section>`;
    const evidenceBlock = `<section class="evidence"><h2>데이터 출처와 측정 증거</h2><table class="rtbl"><tbody>
      <tr><th>데이터 출처</th><td>네이버 플레이스 공개정보 · 네이버 지도 PC 검색결과</td></tr>
      <tr><th>측정 키워드</th><td>${esc(currentRank?.query || "대표 키워드 미측정")}</td></tr>
      <tr><th>측정 시각</th><td>${new Date(measuredAt).toLocaleString("ko-KR")}</td></tr>
      <tr><th>검색 조건</th><td>${esc(currentRank?.surface || "네이버 지도 PC")} · 비로그인 자동 측정</td></tr>
      <tr><th>확인 범위</th><td>상위 ${currentRank?.checkedCount || 0}곳</td></tr>
      <tr><th>네이버 평균 별점</th><td>${livePlace?.visitorReviewScore ? `${livePlace.visitorReviewScore}점 · 방문자 리뷰 ${(livePlace.visitorReviewCount || 0).toLocaleString()}개${ratingTrend.change != null ? ` · 이전 대비 ${ratingTrend.change > 0 ? "+" : ""}${ratingTrend.change}` : ""}` : "미노출 또는 수집되지 않음"}</td></tr>
      <tr><th>진단 근거 충족도</th><td>${diagnosisCoverage.percent}% · 자동수집/실측/직접입력 구분</td></tr>
      </tbody></table><p class="notice">검색 위치·시간·로그인·개인화에 따라 순서는 달라질 수 있습니다. 퍼블리는 동일한 측정 환경의 반복 결과로 상승·하락 추이를 판정합니다. 평균 별점은 과거 별점과 2026년 재수집 별점의 평균이며 새 별점 리뷰 추가·검토·미노출에 따라 변할 수 있습니다. 별점과 퍼블리 진단점수는 네이버 공식 검색 순위 점수가 아닙니다.</p></section>`;
    let reportBlock = "";
    if (report.hasData) {
      const kwr = report.kwRows.slice(0, 8).map(k => `<tr><td>${esc(k.keyword)}</td><td>${k.last != null ? k.last + "위" : "상위밖"}</td><td class="${k.change == null ? "" : k.change > 0 ? "up" : k.change < 0 ? "dn" : ""}">${k.change == null ? "기준" : k.change > 0 ? "▲ " + k.change : k.change < 0 ? "▼ " + Math.abs(k.change) : "— 유지"}</td></tr>`).join("");
      reportBlock = `<h2>📊 ${rangeLabel} 성과 리포트</h2>
        <div class="rgrid"><div class="rc"><span>측정 횟수</span><b>${report.measures}회</b></div>
        <div class="rc"><span>블로그 리뷰 증감</span><b class="${(report.reviewDelta?.blog ?? 0) >= 0 ? "up" : "dn"}">${report.reviewDelta ? (report.reviewDelta.blog >= 0 ? "+" : "") + report.reviewDelta.blog : "-"}</b></div>
        <div class="rc"><span>방문자 리뷰 증감</span><b class="${(report.reviewDelta?.visitor ?? 0) >= 0 ? "up" : "dn"}">${report.reviewDelta ? (report.reviewDelta.visitor >= 0 ? "+" : "") + report.reviewDelta.visitor : "-"}</b></div></div>
        ${kwr ? `<table class="rtbl"><thead><tr><th>키워드</th><th>현재 순위</th><th>변화</th></tr></thead><tbody>${kwr}</tbody></table>` : ""}`;
    }
    // 🩺 경쟁사 비교 블록
    let compBlock = "";
    if (competitorTable) {
      const tr = competitorTable.top.map((p, i) => `<tr class="${p.placeId === ownPlace?.placeId ? "me" : ""}"><td>${i + 1}</td><td>${esc(p.name)}${p.placeId === ownPlace?.placeId ? " (내 매장)" : ""}</td><td>📝${(p.blogReviewCount || 0).toLocaleString()}</td><td>🧾${(p.visitorReviewCount || 0).toLocaleString()}</td></tr>`).join("");
      compBlock = `<h2>🩺 경쟁사 비교 (수집 ${competitorTable.total}곳)</h2>${competitorTable.myRank ? `<p>내 매장은 블로그 리뷰 기준 <b>${competitorTable.myRank}위 / ${competitorTable.total}</b>이며, 1위와 <b>${Math.max(0, (competitorTable.leader.blogReviewCount || 0) - (ownPlace?.blogReviewCount || 0)).toLocaleString()}개</b> 차이입니다.</p>` : ""}<table class="rtbl"><thead><tr><th>순위</th><th>업체</th><th>블로그</th><th>방문자</th></tr></thead><tbody>${tr}</tbody></table>`;
    }
    const html = `<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>${esc(profile.name || "내 매장")} 상위노출 성과·진단 보고서</title>
    <style>body{font-family:'Noto Sans KR',-apple-system,sans-serif;color:#0f2b23;max-width:760px;margin:32px auto;padding:0 22px;line-height:1.65}
    h1{font-size:24px;border-bottom:3px solid #00c896;padding-bottom:10px}h2{font-size:16px;margin:26px 0 10px;color:#0f2b23}
    .top{background:linear-gradient(120deg,#eefbf6,#fff0f6);border:1px solid #d6ede3;border-radius:14px;padding:18px;margin:16px 0}
    .stars{font-size:28px;color:#e59214}h3{margin:20px 0 8px;font-size:14px}h3 small{color:#5c8478;font-weight:400;font-size:12px}
    .it{border:1px solid #d6ede3;border-radius:10px;padding:12px;margin:8px 0}.it .v{color:#00a884;font-weight:700;margin-left:6px}.it .s{float:right;color:#e59214;font-size:13px}
    .d{font-size:12.5px;color:#5c8478;margin-top:5px}.foot{margin-top:26px;color:#5c8478;font-size:11px;border-top:1px solid #d6ede3;padding-top:12px}
    .chart{border:1px solid #d6ede3;border-radius:12px;padding:14px;margin:14px 0;background:#fafffd}.csub{font-size:11px;color:#5c8478;margin-top:4px}
    .rgrid{display:flex;gap:10px;margin:10px 0}.rc{flex:1;border:1px solid #d6ede3;border-radius:10px;padding:11px;text-align:center}.rc span{font-size:11px;color:#5c8478;display:block}.rc b{font-size:20px}
    .rtbl{width:100%;border-collapse:collapse;margin:8px 0;font-size:12.5px}.rtbl th,.rtbl td{border:1px solid #d6ede3;padding:7px 9px;text-align:left}.rtbl th{background:#effaf4}.rtbl tr.me{background:#eafff5;font-weight:700}
    .up{color:#00a884;font-weight:700}.dn{color:#e5397f;font-weight:700}
    .brand{display:flex;align-items:center;gap:10px;padding-bottom:12px;border-bottom:3px solid #00c896;margin-bottom:4px}
    .logo{width:34px;height:34px;border-radius:9px;background:linear-gradient(135deg,#00c896,#ff5fa2);color:#fff;font-weight:900;font-size:18px;display:flex;align-items:center;justify-content:center}
    .btag{font-size:11px;font-weight:900;letter-spacing:.12em;color:#00a884}.bttl{font-size:20px;font-weight:900}
    .todo{margin:8px 0;padding-left:20px}.todo li{margin:6px 0;font-size:13px}
    .decision{border:3px solid #00c896;border-radius:14px;padding:14px 17px;margin:16px 0;background:#f5fffb}.decision h2{margin:0 0 8px}.decision div{border-top:1px solid #d6ede3;padding:8px 0}.decision p{margin:2px 0;font-size:13px}.decision strong{color:#00a884}.evidence{break-inside:avoid}.notice{font-size:10.5px;color:#5c8478;background:#f5f7f6;padding:9px;border-radius:8px}
    @media print{body{margin:0}}</style></head><body>
    <div class="brand"><div class="logo">P</div><div><div class="btag">PUBLY PLACE 365 · 상위노출 성과·진단 보고서</div><div class="bttl">🏪 ${esc(profile.name || "내 매장")}</div></div><div style="margin-left:auto;text-align:right;font-size:11px;color:#5c8478">발행일<br/><b style="color:#0f2b23;font-size:13px">${new Date().toLocaleDateString("ko-KR")}</b></div></div>
    <div class="top"><div class="stars">${"★".repeat(Math.round(placeReport.overallStars))}${"☆".repeat(5 - Math.round(placeReport.overallStars))} ${placeReport.overallStars} / 5.0</div>
    <div>${esc([profile.region, profile.category].filter(Boolean).join(" · "))} · ${placeReport.totalCount}개 항목 중 ${placeReport.goodCount}개 양호${currentRank ? ` · 대표 키워드 “${esc(currentRank.query)}” ${currentRank.rank ? currentRank.rank + "위" : "상위 밖"}` : ""}</div></div>
    ${decisionBlock}
    ${evidenceBlock}
    ${todoBlock}
    ${chartSvg}
    ${reportBlock}
    ${compBlock}
    <h2>🔎 항목별 진단</h2>
    ${rows}
    <div class="foot">본 보고서는 네이버 플레이스 공개 데이터·동일 환경 검색 측정·사장님 입력자료를 구분해 <b>퍼블리 플레이스 365</b>가 자동 생성했습니다. 네이버의 공식 순위 점수나 상위노출 보증이 아니며, 반복 측정한 변화와 실제 예약·방문 성과를 함께 판단해야 합니다. · publy.blogautopro.com</div>
    <script>window.onload=()=>{setTimeout(()=>window.print(),400)}</script></body></html>`;
    const electron = (window as any).electron;
    if (electron?.saveReportPdf) {
      const saved = await electron.saveReportPdf(html, `퍼블리-플레이스365-${profile.name || "매장"}-${new Date().toISOString().slice(0, 10)}.pdf`);
      if (saved?.ok) showToast?.("PDF 보고서를 저장했어요", "success");
      else if (!saved?.canceled) showToast?.(saved?.error || "PDF를 저장하지 못했어요", "error");
      return;
    }
    // 웹 실행에서도 팝업 권한을 요구하지 않도록 숨은 iframe에서 인쇄한다.
    const frame = document.createElement("iframe");
    frame.style.cssText = "position:fixed;width:1px;height:1px;right:0;bottom:0;border:0;opacity:0;pointer-events:none";
    frame.srcdoc = html;
    frame.onload = () => { setTimeout(() => frame.remove(), 3000); };
    document.body.appendChild(frame);
  };

  // 컨트롤타워 정보 타일 — 플레이스에서 가져온 모든 항목 + 각 기능 설명(왜 중요한지). 자동 못 오는 값(공유·길찾기)은 입력값 표시.
  // 타일: key=진단 항목 매칭(팝업에서 왜?/이렇게/성과 표시), act=클릭 동작
  const numTiles = livePlace ? [
    { i: "💾", l: "저장(찜)", v: livePlace.savedCount != null ? livePlace.savedCount.toLocaleString() : (behaviorInput.saves || "입력"), c: colors.rose, d: "고객 관심 지표. 순위·예약·방문 변화와 함께 비교해요.", key: "save", act: "behavior" as const },
    { i: "🧾", l: "방문자 리뷰", v: (livePlace.visitorReviewCount || 0).toLocaleString(), c: colors.green, d: "실방문 인증 리뷰. 최신성이 중요해요(식은 가게 방지).", key: "visitor", act: "customer" as const },
    { i: "📝", l: "블로그 리뷰", v: (livePlace.blogReviewCount || 0).toLocaleString(), c: colors.pink, d: "외부 언급. 퍼블리로 채우는 핵심 지렛대.", key: "blog", act: "discovery" as const },
    { i: "⭐", l: "평점", v: livePlace.visitorReviewScore ? `${livePlace.visitorReviewScore}` : "-", c: colors.amber, d: "방문자 평균 별점. 4점 이상 꾸준하면 검증된 가게.", key: "visitor", act: "customer" as const },
    { i: "📸", l: "사진", v: `${livePlace.photoCount ?? livePlace.imageUrls?.length ?? 0}`, c: colors.green, d: "외관·메뉴·가격표 사진이 많을수록 방문 전 이탈↓.", key: "photo", act: "customer" as const },
    { i: "🍽️", l: "메뉴", v: `${livePlace.menus?.length || 0}`, c: colors.rose, d: "메뉴·가격이 있어야 관련 검색·AI가 이해해요.", key: "menu", act: "customer" as const },
    { i: "🅿️", l: "편의시설", v: `${livePlace.conveniences?.length || 0}`, c: colors.green, d: "주차·포장·예약 등. ‘상황 검색’에 걸려요.", key: "conv", act: "customer" as const },
    { i: "📢", l: "소식", v: livePlace.newsCount != null ? `${livePlace.newsCount}` : "-", c: colors.amber, d: "새 소식이 꾸준하면 ‘살아있는 가게’로 읽혀요.", key: "news", act: "customer" as const },
    { i: "📅", l: "예약·톡톡", v: (livePlace.bookingAvailable || livePlace.hasTalktalk) ? "연결" : "미연결", c: (livePlace.bookingAvailable || livePlace.hasTalktalk) ? colors.green : colors.sub, d: "방문으로 바로 잇는 행동. 켜면 노출·전환↑.", key: "reserve", act: "customer" as const },
    { i: "📖", l: "소개글", v: livePlace.description ? `${livePlace.description.length}자` : "없음", c: livePlace.description ? colors.green : colors.pink, d: "검색·AI가 ‘어떤 집인지’ 이해하는 근거.", key: "desc", act: "customer" as const },
    { i: "📞", l: "전화", v: livePlace.phone ? "있음" : "없음", c: livePlace.phone ? colors.green : colors.pink, d: "정보 신뢰도. 없으면 헛걸음·이탈.", key: "hours", act: "customer" as const },
    { i: "🎯", l: "대표 키워드", v: `${livePlace.keywords?.length || 0}`, c: colors.purple, d: "손님이 많이 남긴 키워드. 노릴 검색어 힌트.", key: "kw", act: "rank" as const },
    { i: "🔗", l: "공유", v: behaviorInput.shares || "입력", c: colors.sub, d: "공개 화면에 없어 통계에서 직접 입력. 확산 신호.", key: "share", act: "behavior" as const },
    { i: "🧭", l: "길찾기", v: behaviorInput.directions || "입력", c: colors.sub, d: "공개 화면에 없어 통계에서 직접 입력. 실방문 신호.", key: "directions", act: "behavior" as const },
  ] : [];

  // 자동 키워드 제안(실데이터 기반): 손님이 남긴 대표키워드 + 지역·업종 조합
  const kwSuggestions = Array.from(new Set([
    ...(livePlace?.keywords || []),
    ...(profile.region && profile.category ? [`${profile.region} ${profile.category}`, `${profile.region} 맛집`, `${profile.region} ${profile.name}`] : []),
  ].filter(Boolean))).filter(k => !trackedKeywords.includes(k)).slice(0, 8);

  const M = colors;   // mint 팔레트 별칭
  return <div className="p360" style={{ position: "relative", minHeight: 600, padding: "clamp(12px,2vw,22px)", borderRadius: 14, background: M.bg, color: M.text, overflow: "hidden", fontFamily: "'Noto Sans KR',sans-serif" }}>
    <style>{`
      .p360 *{box-sizing:border-box}
      .p360-btn{border:0;border-radius:12px;padding:11px 16px;font-family:inherit;font-weight:800;cursor:pointer;transition:transform .12s,filter .12s;min-height:44px}
      .p360-btn:hover{filter:brightness(1.05);transform:translateY(-1px)}
      .p360-card{background:${M.card};border:1px solid ${M.line};border-radius:18px}
      .p360-2col{display:grid;grid-template-columns:360px 1fr;gap:16px;align-items:start}
      .p360-col{display:flex;flex-direction:column;gap:14px;min-width:0}
      .p360-tiles{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:9px}
      .p360-steps{display:grid;grid-template-columns:repeat(3,1fr);gap:10px}
      .p360-in{width:100%;min-height:46px;border-radius:12px;border:1px solid ${M.line};background:${dark ? M.soft : "#fff"};color:${M.text};padding:11px 13px;font-family:inherit;font-size:15px;outline:none}
      @keyframes p360rays{to{transform:rotate(360deg)}}
      @keyframes p360bob{0%,100%{transform:translateY(0)}50%{transform:translateY(-6px)}}
      @keyframes p360slide{0%{opacity:0;transform:translateY(-8px)}100%{opacity:1;transform:translateY(0)}}
      @keyframes p360fade{0%{opacity:0;transform:translateY(10px)}100%{opacity:1;transform:translateY(0)}}
      @keyframes p360pop{0%{opacity:0;transform:scale(.94) translateY(16px)}100%{opacity:1;transform:scale(1) translateY(0)}}
      @keyframes p360pulse{0%,100%{box-shadow:0 0 0 0 ${M.rose}55}50%{box-shadow:0 0 0 7px ${M.rose}00}}
      @keyframes p360blink{0%,100%{opacity:1}50%{opacity:.35}}
      .p360-card{animation:p360fade .4s ease both}
      .p360-btn:active{transform:scale(.96)}
      .p360-live{display:inline-block;width:7px;height:7px;border-radius:50%;background:#34e0b8;animation:p360blink 1s ease-in-out infinite;margin-right:5px}
      .p360-help{font-size:11px;color:${M.sub};line-height:1.6;margin:5px 0 11px;display:flex;gap:6px;align-items:flex-start}.p360-help>span:first-child{flex-shrink:0}.p360-help b{color:${M.text}}
      @media(max-width:1000px){.p360-2col{grid-template-columns:1fr}}
      @media(max-width:640px){.p360-tiles{grid-template-columns:repeat(2,minmax(0,1fr))}.p360-steps{grid-template-columns:1fr}}
    `}</style>

    {/* ── 본바탕 오브제 ── */}
    <div aria-hidden style={{ position: "absolute", inset: 0, pointerEvents: "none", zIndex: 0, overflow: "hidden" }}>
      <div style={{ position: "absolute", right: -140, top: -160, width: 460, height: 460, borderRadius: "50%", background: `conic-gradient(from 0deg, transparent 0 20deg, ${M.rose}12 20deg 32deg, transparent 32deg 46deg, ${M.pink}0e 46deg 58deg)`, animation: "p360rays 30s linear infinite" }} />
      <div style={{ position: "absolute", left: -110, bottom: -130, width: 340, height: 340, borderRadius: "50%", background: `radial-gradient(circle, ${M.green}16, transparent 66%)` }} />
      <div style={{ position: "absolute", left: "46%", top: -70, width: 220, height: 220, borderRadius: "50%", background: `radial-gradient(circle, ${M.purple}0e, transparent 68%)` }} />
    </div>

    <div style={{ position: "relative", zIndex: 1, display: "flex", flexDirection: "column", gap: 14 }}>
      {/* ── 온보딩 히어로: 캐릭터 + 인사 + 가로 3스텝 ── */}
      <section className="p360-card" style={{ padding: "20px 22px", background: `linear-gradient(135deg, ${M.rose}12, ${M.pink}0c)`, borderColor: `${M.rose}30` }}>
        <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 14 }}>
          <img src={pearlyImg} alt="펄리" onError={e => { const s = document.createElement("div"); s.textContent = "🐤"; s.style.cssText = "font-size:44px"; e.currentTarget.replaceWith(s); }} style={{ width: 58, height: 58, objectFit: "contain", flexShrink: 0, animation: "p360bob 2.6s ease-in-out infinite", filter: `drop-shadow(0 6px 12px ${M.rose}44)` }} />
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 11, fontWeight: 950, color: M.rose, letterSpacing: ".14em" }}>PUBLY PLACE 365</div>
            <h1 style={{ margin: "3px 0 3px", fontSize: 22, fontWeight: 900, letterSpacing: "-.03em" }}>사장님은 플레이스 주소만 넣으세요 🩺</h1>
            <p style={{ margin: 0, fontSize: 12.5, color: M.sub, lineHeight: 1.55 }}>수집·진단·키워드·순위·경쟁사 비교·실행안은 <b style={{ color: M.text }}>퍼블리가 자동으로 끝냅니다.</b></p>
          </div>
        </div>
        <div className="p360-steps">
          {[["🔗", "① 주소 넣기", "네이버 플레이스 주소 하나만 붙여넣기"], ["🤖", "② 퍼블리가 자동 실행", "정보수집부터 100위권 측정까지 자동"], ["✅", "③ 결과만 적용", "완성된 문구·키워드·사진 순서를 한 번에 복사"]].map(([ic, t, d], i) => (
            <div key={i} style={{ display: "flex", gap: 10, padding: "12px 13px", borderRadius: 13, background: M.card, border: `1px solid ${M.line}` }}>
              <div style={{ width: 30, height: 30, borderRadius: 9, flexShrink: 0, display: "grid", placeItems: "center", background: `${M.rose}18`, fontSize: 16 }}>{ic}</div>
              <div style={{ minWidth: 0 }}><b style={{ fontSize: 13 }}>{t}</b><div style={{ fontSize: 10.5, color: M.sub, lineHeight: 1.45, marginTop: 2 }}>{d}</div></div>
            </div>
          ))}
        </div>
      </section>

      {/* 초보 사장님용 단 하나의 다음 행동 */}
      <section className="p360-card" style={{ padding: "18px 20px", border: `3px solid ${M.rose}`, background: `linear-gradient(135deg,${M.card},${M.rose}0d)` }}>
        {!livePlace ? <>
          <div style={{ fontSize: 11, fontWeight: 950, color: M.rose }}>사장님이 지금 할 일 · 1개</div>
          <h2 style={{ margin: "5px 0", fontSize: 20 }}>플레이스 주소를 붙여넣고 원클릭 버튼만 누르세요.</h2>
          <p style={{ margin: "0 0 11px", color: M.sub, fontSize: 12 }}>나머지는 퍼블리가 자동으로 검사하고 순위를 올리기 위한 작업물까지 준비해요.</p>
          <button className="p360-btn" onClick={() => document.querySelector<HTMLInputElement>('.p360-in[placeholder="https://naver.me/xxxx"]')?.focus()} style={{ width: "100%", background: `linear-gradient(135deg,${M.rose},${M.purple})`, color: "#fff", fontSize: 15 }}>🚀 주소 넣고 시작하기</button>
        </> : (resolving || oneClickPending || checkingKeyword || rankQueue.length > 0 || kwLoading) ? <>
          <div style={{ fontSize: 11, fontWeight: 950, color: M.purple }}>퍼블리가 자동으로 일하는 중</div>
          <h2 style={{ margin: "5px 0", fontSize: 20 }}>사장님은 기다리기만 하세요.</h2>
          <p style={{ margin: 0, color: M.sub, fontSize: 12 }}>매장 수집 → 키워드 발굴 → 100위권 순위 → 경쟁사 비교 → 실행안 생성 중이에요.</p>
          <div style={{ height: 9, borderRadius: 99, background: M.soft, overflow: "hidden", marginTop: 12 }}><div style={{ width: `${Math.max(scanPct, 12)}%`, height: "100%", background: `linear-gradient(90deg,${M.rose},${M.purple})`, transition: "width .3s" }} /></div>
        </> : <>
          <div style={{ fontSize: 11, fontWeight: 950, color: M.green }}>자동 분석 완료 · 사장님이 지금 할 일 1개</div>
          <h2 style={{ margin: "5px 0", fontSize: 20 }}>{latestRank?.rank ? `현재 ${latestRank.rank}위 — 준비된 개선안을 적용하세요.` : "상위권 밖 — 준비된 우선 개선안부터 적용하세요."}</h2>
          <p style={{ margin: "0 0 11px", color: M.sub, fontSize: 12 }}>긴 진단표를 공부할 필요 없어요. 퍼블리가 만든 소개글·키워드·사진 순서·실행 일정을 확인하면 됩니다.</p>
          <button className="p360-btn" onClick={() => document.getElementById("p360-kit")?.scrollIntoView({ behavior: "smooth", block: "center" })} style={{ width: "100%", background: `linear-gradient(135deg,${M.green},${M.purple})`, color: "#fff", fontSize: 15 }}>✅ 퍼블리가 준비한 것 적용하기</button>
        </>}
      </section>

      {livePlace && <section className="p360-card" style={{ padding: "16px 18px", borderLeft: `6px solid ${M.amber}` }}>
        <div style={{ display: "flex", alignItems: "center", gap: 9, flexWrap: "wrap" }}>
          <b style={{ fontSize: 14 }}>⭐ 네이버 가게 평균 별점</b>
          <strong style={{ fontSize: 25, color: M.amber }}>{livePlace.visitorReviewScore ? livePlace.visitorReviewScore.toFixed(2).replace(/0$/, "") : "미노출·미수집"}</strong>
          {ratingTrend.change != null && <span style={{ fontSize: 12, fontWeight: 900, color: ratingTrend.change > 0 ? M.green : ratingTrend.change < 0 ? M.pink : M.sub }}>{ratingTrend.change > 0 ? "▲" : ratingTrend.change < 0 ? "▼" : "—"} {Math.abs(ratingTrend.change).toFixed(2)}</span>}
          <span style={{ marginLeft: "auto", fontSize: 10.5, color: M.sub }}>방문자 리뷰 {(livePlace.visitorReviewCount || 0).toLocaleString()}개 · {ratingTrend.latest ? new Date(ratingTrend.latest.measuredAt).toLocaleString("ko-KR") : "이번 측정"}</span>
          <button className="p360-btn" disabled={ratingRefreshing} onClick={() => void refreshRatingNow()} style={{ minHeight: 32, padding: "5px 10px", fontSize: 10.5, background: M.amber, color: "#fff", opacity: ratingRefreshing ? .6 : 1 }}>{ratingRefreshing ? "네이버 확인 중…" : "🔄 지금 별점 재측정"}</button>
        </div>
        <p style={{ margin: "6px 0 0", color: M.sub, fontSize: 11, lineHeight: 1.6 }}>고객이 방문 만족도를 빠르게 이해하는 <b style={{ color: M.text }}>보조 지표</b>예요. 퍼블리 순위 점수와 다르며 별점만으로 검색순위 상승을 보장하지 않아요. 새 별점 리뷰가 추가되거나 리뷰가 검토·미노출되면 평균이 오르내릴 수 있으므로 리뷰 수와 함께 추적합니다.</p>
        <div style={{ marginTop: 8, padding: "10px 11px", borderRadius: 10, background: `${M.amber}12`, fontSize: 11, lineHeight: 1.65 }}><b style={{ color: M.amber }}>별점 올리는 우선 행동</b><div style={{ color: M.text, marginTop: 3 }}>{!livePlace.visitorReviewScore ? "스마트플레이스에서 평균 별점 노출 설정을 확인하고, 실제 방문 고객의 새 별점 리뷰가 쌓이는지 측정하세요." : livePlace.visitorReviewScore < 4 ? "낮은 별점 리뷰의 반복 불만 1가지를 먼저 고치고, 해결 뒤 실제 방문 고객에게 솔직한 리뷰를 요청하세요." : livePlace.visitorReviewScore < 4.5 ? "최근 낮은 별점의 공통 원인을 고친 뒤 결제·예약 완료 고객에게 부담 없이 별점과 구체적인 경험을 남겨달라고 안내하세요." : "높은 만족도를 유지하면서 최근 방문 고객의 사진·구체 경험 리뷰가 꾸준히 이어지게 안내하세요."}</div><div style={{ color: M.sub, marginTop: 3 }}>금지: 별점 대가 지급·허위 영수증·리뷰 구매. 평균을 올리는 정확한 필요 리뷰 수는 네이버가 별점 산정 대상 리뷰 수를 공개하지 않아 임의 계산하지 않아요.</div></div>
        {ratingTrend.previous && <div style={{ marginTop: 8, padding: "8px 10px", borderRadius: 9, background: M.soft, fontSize: 10.8, color: M.sub }}>이전 변화 기준: ⭐ {ratingTrend.previous.score} / 리뷰 {ratingTrend.previous.reviewCount.toLocaleString()}개 → 현재 ⭐ {ratingTrend.latest?.score} / 리뷰 {ratingTrend.latest?.reviewCount.toLocaleString()}개</div>}
      </section>}

      {/* ── 진행 스트립: 지금 어디까지 왔는지(회진 칩) ── */}
      {(() => {
        const steps = [
          { k: "매장 등록", done: hasStore },
          { k: "매장 검사", done: !!placeReport },
          { k: "키워드·순위", done: rankHistory.length > 0 },
          { k: "경쟁사 비교", done: !!competitorTable },
          { k: "리뷰어 섭외", done: reviewerHandoffCount > 0 },
        ];
        const doneN = steps.filter(s => s.done).length;
        return <section className="p360-card" style={{ padding: "12px 16px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}><b style={{ fontSize: 12.5 }}>🧭 진행 단계</b><span style={{ fontSize: 10.5, color: M.sub }}>{doneN}/{steps.length} 완료</span><div style={{ marginLeft: "auto", flex: "0 0 120px", height: 6, borderRadius: 99, background: M.soft, overflow: "hidden" }}><div style={{ width: `${doneN / steps.length * 100}%`, height: "100%", background: `linear-gradient(90deg,${M.rose},${M.green})`, transition: "width .4s" }} /></div></div>
          <div className="p360-help" style={{ margin: "0 0 9px" }}><span>💬</span><span>상위노출까지 <b>지금 어느 단계</b>인지 보여줘요. 왼쪽부터 순서대로 하면 돼요.</span></div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>{steps.map((s, i) => <span key={s.k} style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "6px 11px", borderRadius: 99, fontSize: 11, fontWeight: 800, background: s.done ? `${M.green}14` : M.soft, color: s.done ? M.green : M.sub, border: `1px solid ${s.done ? M.green : M.line}` }}>{s.done ? "✓" : i + 1} {s.k}</span>)}</div>
        </section>;
      })()}

      {/* ── 메인 2단: 왼쪽 콘솔 / 오른쪽 대시보드 ── */}
      <div className="p360-2col">
        {/* ===== 왼쪽 콘솔 ===== */}
        <div className="p360-col">
          {/* 매장 콘솔 */}
          <section className="p360-card" style={{ padding: 18 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
              <b style={{ fontSize: 14 }}>🏪 매장 콘솔</b>
              <span style={{ fontSize: 11, fontWeight: 800, color: M.sub }}>{plan === "admin" || plan === "unlimited" ? `${profiles.length}개` : `${profiles.length}/${PLACE360_STORE_LIMIT[plan] ?? PLACE360_STORE_LIMIT.free}개`}</span>
            </div>
            <div className="p360-help"><span>💬</span><span>진단할 매장을 <b>등록·선택·수정·삭제</b>하는 곳이에요. 네이버 플레이스 주소를 붙여넣고 <b>불러오기·검사</b>를 누르면 매장 정보를 통째로 가져와 진단해요.</span></div>
            {profiles.length > 0 && <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 12 }}>
              {profiles.map(item => { const k = place360StoreKey(item.name, item.region); const on = k === storeKey && hasStore; return <button key={k} className="p360-btn" onClick={() => selectStore(item)} style={{ minHeight: 38, padding: "7px 12px", fontSize: 12, background: on ? M.rose : M.soft, color: on ? "#fff" : M.text, border: `1px solid ${on ? M.rose : M.line}` }}>🏷️ {item.name}{item.region ? `·${item.region}` : ""}</button>; })}
              <button className="p360-btn" onClick={startAddingStore} style={{ minHeight: 38, padding: "7px 12px", fontSize: 12, background: "transparent", color: M.rose, border: `1px dashed ${M.rose}` }}>＋ 매장 추가</button>
            </div>}
            <label style={{ display: "block", fontSize: 11.5, fontWeight: 800, marginBottom: 6, color: M.sub }}>네이버 플레이스 주소</label>
            <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 7, marginBottom: 8 }}>
              <input value={draft.placeUrl} onChange={e => setDraft(v => ({ ...v, placeUrl: e.target.value }))} onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); void resolveFromUrl(); } }} placeholder="https://naver.me/xxxx" className="p360-in" />
              <button className="p360-btn" disabled={resolving || oneClickPending} onClick={() => void resolveFromUrl()} style={{ background: `linear-gradient(135deg,${M.rose},${M.purple})`, color: "#fff", whiteSpace: "nowrap", opacity: (resolving || oneClickPending) ? .6 : 1 }}>{resolving || oneClickPending ? "자동 실행 중…" : "🚀 원클릭 전체 솔루션"}</button>
            </div>
            {(!hasStore || storeFormOpen) && <div style={{ display: "grid", gap: 7, marginBottom: 8 }}>
              <input value={draft.name} onChange={e => setDraft(v => ({ ...v, name: e.target.value }))} placeholder="매장 이름(필수)" className="p360-in" />
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 7 }}>
                <input value={draft.category} onChange={e => setDraft(v => ({ ...v, category: e.target.value }))} placeholder="업종" className="p360-in" />
                <input value={draft.region} onChange={e => setDraft(v => ({ ...v, region: e.target.value }))} placeholder="지역" className="p360-in" />
              </div>
              <button className="p360-btn" onClick={() => void saveStore()} style={{ background: M.green, color: "#fff" }}>💾 매장 저장</button>
            </div>}
            {hasStore && !storeFormOpen && <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              <button className="p360-btn" onClick={() => { setDraft(profile); setEditingStoreKey(storeKey); setStoreFormOpen(true); }} style={{ minHeight: 36, padding: "6px 11px", fontSize: 11.5, background: M.soft, color: M.text, border: `1px solid ${M.line}` }}>✏️ 수정</button>
              <button className="p360-btn" disabled={resolving || !draft.placeUrl} onClick={() => void resolveFromUrl()} style={{ minHeight: 36, padding: "6px 11px", fontSize: 11.5, background: M.rose, color: "#fff", opacity: (resolving || !draft.placeUrl) ? .5 : 1 }}>🔄 전체 재조회</button>
              <button className="p360-btn" onClick={() => void removeCurrentStore()} style={{ minHeight: 36, padding: "6px 11px", fontSize: 11.5, background: "transparent", color: M.pink, border: `1px solid ${M.pink}` }}>🗑️ 삭제</button>
            </div>}
          </section>

          {/* 등급 사용 한도표 */}
          {plan !== "admin" && <section className="p360-card" style={{ padding: 16 }}>
            <b style={{ fontSize: 13 }}>📋 등급별 사용 한도</b>
            <div className="p360-help"><span>💬</span><span>등급마다 등록 매장 수·하루 진단 횟수·<b>기록 보관 기간</b>이 달라요. 아래 표에서 내 등급을 확인하세요.</span></div>
            <div style={{ marginTop: 9, border: `1px solid ${M.line}`, borderRadius: 11, overflow: "hidden" }}>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", background: M.soft }}>{["등급", "매장", "진단/일", "보관"].map(t => <b key={t} style={{ padding: 8, fontSize: 10.5 }}>{t}</b>)}</div>
              {(["free", "basic", "pro"] as const).map(lv => <div key={lv} style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", borderTop: `1px solid ${M.line}`, background: plan === lv ? `${M.rose}10` : M.card }}><b style={{ padding: 8, fontSize: 11, color: plan === lv ? M.rose : M.text }}>{lv.toUpperCase()}</b><span style={{ padding: 8, fontSize: 11 }}>{PLACE360_STORE_LIMIT[lv]}개</span><span style={{ padding: 8, fontSize: 11 }}>{PLACE360_DAILY_DIAGNOSIS_LIMIT[lv]}회</span><span style={{ padding: 8, fontSize: 11 }}>{PLACE360_HISTORY_DAYS[lv]}일</span></div>)}
            </div>
          </section>}

          {/* 🎮 게임형 컨트롤보드 — 점수를 레벨·게이지·배지로, 순위 추이 미니그래프 */}
          {placeReport && (() => {
            const score = Math.round(placeReport.overallStars / 5 * 100);
            const level = score >= 80 ? 5 : score >= 60 ? 4 : score >= 40 ? 3 : score >= 20 ? 2 : 1;
            const levelName = ["", "🌱 새싹 매장", "🌿 성장 매장", "⭐ 인기 매장", "🔥 상위 매장", "👑 지역 챔피언"][level];
            const levelColor = [M.sub, M.sub, M.green, M.amber, M.rose, M.purple][level];
            const nextGoal = [20, 20, 40, 60, 80, 100][level];
            // 배지: 각 그룹 all-good 여부로 획득
            const badges = [
              { i: "💾", n: "손님행동", got: placeReport.groups[0]?.items.every(x => x.status === "good") },
              { i: "📝", n: "리뷰왕", got: placeReport.groups[1]?.items.every(x => x.status === "good") },
              { i: "📸", n: "정보완성", got: placeReport.groups[2]?.items.every(x => x.status === "good") },
              { i: "🎯", n: "키워드", got: (placeReport.groups[3]?.items || []).every(x => x.status === "good") },
            ];
            const series = rankHistory.filter(r => !currentRank || r.keyword === currentRank.query).slice(0, 10).reverse().map(r => r.rank);
            return <section className="p360-card" style={{ padding: 0, overflow: "hidden", border: `2px solid ${levelColor}44` }}>
              <div style={{ padding: "14px 16px", background: `linear-gradient(120deg,${levelColor}18,${M.rose}0a)` }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <div style={{ width: 48, height: 48, borderRadius: 14, flexShrink: 0, display: "grid", placeItems: "center", background: `${levelColor}1e`, fontSize: 24, boxShadow: `0 0 0 3px ${levelColor}22` }}>{levelName.split(" ")[0]}</div>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{ fontSize: 10, fontWeight: 950, color: levelColor, letterSpacing: ".06em" }}>LV.{level} · {levelName.split(" ").slice(1).join(" ")}</div>
                    <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}><b style={{ fontSize: 22, color: levelColor }}>{score}</b><span style={{ fontSize: 11, color: M.sub, fontWeight: 800 }}>/ 100점</span></div>
                  </div>
                </div>
                {/* 다음 레벨 게이지 */}
                <div style={{ marginTop: 10 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: 9.5, color: M.sub, marginBottom: 3 }}><span>다음 레벨까지</span><span>{Math.max(0, nextGoal - score)}점</span></div>
                  <div style={{ height: 9, borderRadius: 99, background: M.soft, overflow: "hidden" }}><div style={{ width: `${Math.min(100, score / nextGoal * 100)}%`, height: "100%", background: `linear-gradient(90deg,${levelColor},${M.rose})`, transition: "width .5s", borderRadius: 99 }} /></div>
                </div>
              </div>
              {/* 획득 배지 */}
              <div style={{ display: "flex", gap: 6, padding: "11px 14px", flexWrap: "wrap" }}>{badges.map(b => <div key={b.n} title={b.got ? `${b.n} 달성!` : `${b.n} 미달성`} style={{ display: "flex", alignItems: "center", gap: 4, padding: "5px 9px", borderRadius: 99, fontSize: 10.5, fontWeight: 800, background: b.got ? `${M.green}14` : M.soft, color: b.got ? M.green : M.sub, border: `1px solid ${b.got ? M.green : M.line}`, opacity: b.got ? 1 : .6 }}>{b.got ? b.i : "🔒"} {b.n}</div>)}</div>
              {/* 순위 추이 미니그래프 */}
              {series.length >= 2 && (() => {
                const vals = series.map(v => v == null ? 101 : v); const W = 300, H = 54, pad = 6;
                const mx = Math.max(...vals), mn = Math.min(...vals), sp = Math.max(1, mx - mn);
                const pts = vals.map((v, i) => `${(pad + i * (W - pad * 2) / (vals.length - 1)).toFixed(1)},${(pad + (v - mn) / sp * (H - pad * 2)).toFixed(1)}`);
                const up = vals[vals.length - 1] <= vals[0]; const col = up ? M.green : M.pink;
                return <div style={{ padding: "0 14px 14px" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 5, marginBottom: 3 }}><b style={{ fontSize: 10.5 }}>📈 순위 추이</b><span style={{ marginLeft: "auto", fontSize: 10, fontWeight: 900, color: col }}>{up ? "▲ 상승세" : "▼ 하락·정체"}</span></div>
                  <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: 54, display: "block" }} preserveAspectRatio="none"><polyline points={pts.join(" ")} fill="none" stroke={col} strokeWidth={2.2} strokeLinejoin="round" strokeLinecap="round" />{pts.map((p, i) => { const [x, y] = p.split(","); return <circle key={i} cx={x} cy={y} r={2.6} fill={col} />; })}</svg>
                </div>;
              })()}
            </section>;
          })()}

          {/* 🔬 키워드 처방전 — 순위 잰 키워드별 '왜 이 순위인지 + 올리는 법' */}
          {keywordRx.length > 0 && <section className="p360-card" style={{ padding: 16 }}>
            <b style={{ fontSize: 13 }}>🔬 키워드 처방전</b>
            <div className="p360-help"><span>💬</span><span>같은 매장인데 <b>키워드마다 순위가 다른 이유</b>를 짚어드려요. 상호명 검색은 원래 1위고, 일반 검색어는 <b>소개글·대표키워드·메뉴에 그 단어가 있는지</b>와 리뷰 양이 순위를 갈라요. 아래 부족한 곳을 채우면 올라가요.</span></div>
            <div style={{ display: "grid", gap: 9, marginTop: 4 }}>{keywordRx.map(r => {
              const rc = r.rank == null ? M.pink : r.rank <= 3 ? M.green : r.rank <= 10 ? M.amber : M.pink;
              return <div key={r.kw} style={{ padding: 12, borderRadius: 12, background: M.soft, borderLeft: `5px solid ${rc}` }}>
                <div style={{ display: "flex", alignItems: "center", gap: 7, flexWrap: "wrap" }}>
                  <b style={{ fontSize: 12.5 }}>🔍 {r.kw}</b>
                  <span style={{ fontSize: 12, fontWeight: 900, color: rc }}>{r.rank == null ? "상위 밖" : `${r.rank}위`}</span>
                  {r.isBrand && <span style={{ fontSize: 9.5, fontWeight: 800, color: M.green, background: `${M.green}16`, borderRadius: 99, padding: "2px 7px" }}>내 상호 검색</span>}
                </div>
                {r.isBrand ? <p style={{ margin: "6px 0 0", fontSize: 11, color: M.sub, lineHeight: 1.5 }}>내 가게 이름 검색이라 경쟁자가 없어요. 1위가 정상이에요 👍</p> : <>
                  <div style={{ display: "flex", gap: 5, flexWrap: "wrap", margin: "7px 0 6px" }}>{r.checks.map(c => <span key={c.label} style={{ fontSize: 9.5, fontWeight: 800, padding: "2px 8px", borderRadius: 99, background: c.ok ? `${M.green}14` : `${M.pink}14`, color: c.ok ? M.green : M.pink, border: `1px solid ${c.ok ? M.green : M.pink}44` }}>{c.ok ? "✓" : "✗"} {c.label}</span>)}</div>
                  <div style={{ fontSize: 11, color: M.text, lineHeight: 1.55 }}>👉 {r.missing.length ? <>이 검색어가 <b style={{ color: M.pink }}>{r.missing.map(c => c.label).join("·")}</b>에 없어요. {r.missing[0].how} </> : "정보엔 잘 반영됐어요. "}{r.blogGap > 0 ? <>블로그 리뷰가 주변보다 <b>{r.blogGap}개</b> 적으니 <button onClick={() => setDiscoveryOpen(true)} style={{ border: "none", background: "transparent", color: M.rose, fontWeight: 800, cursor: "pointer", padding: 0, fontSize: 11 }}>리뷰어 찾기</button>로 채우세요.</> : "리뷰도 충분해요."}</div>
                </>}
              </div>;
            })}</div>
          </section>}

          {/* 검은 작업 로그 */}
          <section className="p360-card" style={{ overflow: "hidden" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "9px 13px", background: M.soft }}><b style={{ fontSize: 12.5 }}>{resolving && <span className="p360-live" />}📟 작업 로그</b><span style={{ fontSize: 11, fontWeight: 900, color: M.rose }}>{resolving ? "진행 중" : `${scanPct}%`}</span></div>
            <div className="p360-help" style={{ margin: "8px 13px 0" }}><span>💬</span><span>매장 검사·순위 측정·업체 발굴이 <b>지금 어디까지 됐는지</b> 실시간으로 보여줘요. 문제가 생기면 여기 마지막 줄을 확인하세요.</span></div>
            <div style={{ height: 5, background: "#0b1220" }}><div style={{ width: `${scanPct}%`, height: "100%", background: `linear-gradient(90deg,${M.rose},${M.amber})`, transition: "width .3s" }} /></div>
            <div style={{ minHeight: "min(68vh, 620px)", maxHeight: "82vh", overflowY: "auto", padding: "14px 16px", background: "#050a0f", fontFamily: "'JetBrains Mono',monospace", fontSize: 12.5, lineHeight: 1.9 }}>
              {scanLog.length === 0 ? <span style={{ color: "#3a5a7a" }}>대기 중... 링크를 넣고 불러오기를 누르면 진행 상황이 여기 나와요.</span> : scanLog.map((l, i) => <div key={i} style={{ color: i === scanLog.length - 1 ? "#34e0b8" : "#8fb3c9" }}>{l}</div>)}
            </div>
          </section>
        </div>

        {/* ===== 오른쪽 대시보드 ===== */}
        <div className="p360-col">
          {!placeReport ? (
            <section className="p360-card" style={{ padding: "48px 24px", textAlign: "center", background: `linear-gradient(135deg,${M.rose}0a,${M.pink}06)` }}>
              <img src={pearlyImg} alt="" onError={e => { const s = document.createElement("div"); s.textContent = "🏪"; s.style.cssText = "font-size:56px"; e.currentTarget.replaceWith(s); }} style={{ width: 78, height: 78, objectFit: "contain", margin: "0 auto 14px", display: "block", animation: "p360bob 2.6s ease-in-out infinite", filter: `drop-shadow(0 8px 16px ${M.rose}33)` }} />
              <b style={{ fontSize: 16 }}>왼쪽에 <span style={{ color: M.rose }}>플레이스 주소</span>를 붙여넣고 <span style={{ color: M.rose }}>불러오기·검사</span>를 눌러주세요</b>
              <p style={{ color: M.sub, fontSize: 12.5, marginTop: 7, lineHeight: 1.6 }}>매장을 통째로 진단해 <b style={{ color: M.text }}>별점·순위·경쟁사·솔루션</b>을 여기에 펼쳐드려요.<br/>먼저 <b style={{ color: M.text }}>업체·리뷰 블로거 찾기</b>부터 써보고 싶다면 아래 카드를 열어보세요.</p>
              <button className="p360-btn" onClick={() => setDiscoveryOpen(true)} style={{ marginTop: 14, background: M.rose, color: "#fff" }}>🕵️ 먼저 업체·블로거 찾아보기 →</button>
            </section>
          ) : <>
            {/* 컨트롤타워 헤더: 점수 + 순위 */}
            <section className="p360-card" style={{ padding: 0, overflow: "hidden", borderColor: `${M.rose}40`, borderWidth: 2 }}>
              <div style={{ padding: "18px 20px", background: `linear-gradient(120deg,${M.rose}14,${M.amber}0e)` }}>
                <div style={{ fontSize: 10.5, fontWeight: 950, color: M.rose, letterSpacing: ".08em" }}>상위노출 종합 건강검진표</div>
                <b style={{ display: "block", fontSize: 18, margin: "4px 0 8px" }}>{profile.name || "내 매장"}</b>
                <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
                  <span style={{ fontSize: 24, color: M.amber, letterSpacing: 2 }}>{starStr(placeReport.overallStars)}</span>
                  <b style={{ fontSize: 20, color: M.rose }}>{placeReport.overallStars} / 5.0</b>
                  <span style={{ fontSize: 11.5, color: M.sub, fontWeight: 800 }}>{placeReport.totalCount}개 중 {placeReport.goodCount}개 양호</span>
                  {currentRank && <span style={{ marginLeft: "auto", fontSize: 13, fontWeight: 900, color: M.rose }}>“{currentRank.query}” {currentRank.rank ? `${currentRank.rank}위` : "상위 밖"}</span>}
                </div>
                <div className="p360-help" style={{ margin: "8px 0 0" }}><span>💬</span><span>매장의 <b>상위노출 준비 상태를 별점</b>으로 요약했어요. 저장·리뷰·정보 완성도 등을 종합한 점수예요. 아래에서 항목별로 자세히 볼 수 있어요.</span></div>
              </div>
              {/* 🔔 순위 급변 알림 */}
              {rankAlerts.length > 0 && <div style={{ display: "grid", gap: 6, padding: "10px 16px 0" }}>{rankAlerts.map(a => { const good = a.up; const c = good ? M.green : M.pink; return <div key={a.keyword} style={{ display: "flex", alignItems: "center", gap: 8, padding: "9px 12px", borderRadius: 11, background: `${c}12`, border: `1px solid ${c}44`, animation: "p360slide .3s ease both" }}><span style={{ fontSize: 16 }}>{a.entered ? "🎉" : good ? "🚀" : "⚠️"}</span><b style={{ fontSize: 12, color: M.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{a.keyword}</b><span style={{ marginLeft: "auto", fontSize: 12, fontWeight: 900, color: c }}>{a.entered ? `검색 진입 · ${a.to}위` : good ? `▲ ${a.delta}계단 상승 (${a.from}→${a.to}위)` : `▼ ${Math.abs(a.delta)}계단 하락 (${a.from}→${a.to}위)`}</span></div>; })}</div>}
              {(() => {
                const series = rankHistory.filter(r => !currentRank || r.keyword === currentRank.query).slice(0, 12).reverse().map(r => r.rank);
                if (series.length < 2) return null;
                const vals = series.map(v => v == null ? 101 : v); const W = 560, H = 78, pad = 8;
                const mx = Math.max(...vals), mn = Math.min(...vals), sp = Math.max(1, mx - mn);
                const pts = vals.map((v, i) => `${(pad + i * (W - pad * 2) / (vals.length - 1)).toFixed(1)},${(pad + (v - mn) / sp * (H - pad * 2)).toFixed(1)}`);
                const up = vals[vals.length - 1] <= vals[0]; const col = up ? M.green : M.pink;
                return <div style={{ padding: "12px 16px 4px" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}><b style={{ fontSize: 12 }}>📈 순위 추이</b><span style={{ fontSize: 10, color: M.sub }}>위로 갈수록 상위</span><span style={{ marginLeft: "auto", fontSize: 11.5, fontWeight: 900, color: col }}>{up ? "▲ 상승세" : "▼ 하락·정체"}</span></div>
                  <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: 78, display: "block" }} preserveAspectRatio="none"><polyline points={pts.join(" ")} fill="none" stroke={col} strokeWidth={2.5} strokeLinejoin="round" strokeLinecap="round" />{pts.map((p, i) => { const [x, y] = p.split(","); return <circle key={i} cx={x} cy={y} r={3} fill={col} />; })}</svg>
                </div>;
              })()}
              {livePlace?.imageUrls && livePlace.imageUrls.length > 0 && <div style={{ display: "flex", gap: 6, padding: "10px 16px 0", overflowX: "auto" }}>{livePlace.imageUrls.slice(0, 10).map((u, i) => <img key={i} src={u} alt="" style={{ width: 66, height: 66, objectFit: "cover", borderRadius: 10, flex: "none", border: `1px solid ${M.line}` }} />)}</div>}
              <div className="p360-tiles" style={{ padding: 16 }}>{numTiles.map(t => <button key={t.l} className="p360-tile" title="눌러서 자세히 보기" onClick={() => setTileModal(t)} style={{ padding: "10px 11px", borderRadius: 12, background: M.soft, border: `1px solid ${M.line}`, textAlign: "left", cursor: "pointer", fontFamily: "inherit", position: "relative" }}><div style={{ fontSize: 10, color: M.sub, display: "flex", alignItems: "center", gap: 4 }}><span>{t.i}</span>{t.l}<span style={{ marginLeft: "auto", fontSize: 9, color: M.rose }}>ⓘ</span></div><b style={{ fontSize: 17, color: t.c, display: "block", margin: "2px 0 3px" }}>{t.v}</b><div style={{ fontSize: 9, color: M.sub, lineHeight: 1.35 }}>{t.d}</div></button>)}</div>
              <div style={{ padding: "0 16px 16px" }}><button className="p360-btn" onClick={downloadReport} style={{ width: "100%", background: `linear-gradient(135deg,${M.rose},${M.text})`, color: "#fff", fontWeight: 800, fontSize: 14.5, boxShadow: `0 4px 14px ${M.rose}44`, display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}>📄 이 진단을 보고서(PDF)로 저장 · 고객 제출용</button></div>
            </section>

            {/* 🩺 오늘의 처방 — 가장 시급한 딱 한 가지(멘토가 리딩) */}
            {(() => {
              const items = placeReport.groups.flatMap(g => g.items);
              const rx = items.find(i => i.status === "bad") || items.find(i => i.status === "warn");
              if (!rx) return <section className="p360-card" style={{ padding: 16, borderLeft: `6px solid ${M.green}` }}><div style={{ display: "flex", alignItems: "center", gap: 10 }}><span style={{ fontSize: 24 }}>🎉</span><div><b style={{ fontSize: 14 }}>지금은 시급한 게 없어요!</b><p style={{ margin: "3px 0 0", color: M.sub, fontSize: 11.5 }}>잘 관리되고 있어요. 순위를 주기적으로 재며 유지하세요.</p></div></div></section>;
              return <section className="p360-card" style={{ padding: 0, overflow: "hidden", borderColor: `${M.pink}44`, borderWidth: 2 }}>
                <div style={{ padding: "14px 16px", background: `linear-gradient(120deg,${M.pink}14,${M.rose}0c)`, display: "flex", alignItems: "center", gap: 11 }}>
                  <img src={pearlyImg} alt="" onError={e => { const s = document.createElement("div"); s.textContent = "🩺"; s.style.cssText = "font-size:30px"; e.currentTarget.replaceWith(s); }} style={{ width: 40, height: 40, objectFit: "contain", flexShrink: 0, animation: "p360bob 2.6s ease-in-out infinite" }} />
                  <div style={{ minWidth: 0 }}><div style={{ fontSize: 10, fontWeight: 950, color: M.pink, letterSpacing: ".08em" }}>오늘의 처방 · 딱 한 가지만</div><b style={{ fontSize: 14.5 }}>{rx.icon} {rx.label}부터 손보세요</b></div>
                </div>
                <div style={{ padding: 16 }}>
                  <p style={{ margin: 0, color: M.sub, fontSize: 12, lineHeight: 1.6 }}><b style={{ color: M.text }}>왜?</b> {rx.why}</p>
                  <p style={{ margin: "7px 0 0", color: M.text, fontSize: 12.5, lineHeight: 1.6 }}><b>👉 이렇게:</b> {rx.how}</p>
                  {rx.action && rx.go && <button className="p360-btn" onClick={() => runItemAction(rx)} style={{ marginTop: 12, background: M.rose, color: "#fff" }}>{rx.action} →</button>}
                </div>
              </section>;
            })()}

            {/* 🩺 경쟁사 비교 진단표(실데이터: 수집된 업체 줄세우기 + 내 위치 + 갭) */}
            {competitorTable ? <section className="p360-card" style={{ padding: 16 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 4 }}>
                <b style={{ fontSize: 13.5 }}>🩺 경쟁사 비교 진단</b>
                <span style={{ fontSize: 10, color: M.sub }}>수집한 {competitorTable.total}곳을 블로그 리뷰 순으로 줄세웠어요</span>
                {competitorTable.myRank && <span style={{ marginLeft: "auto", fontSize: 12, fontWeight: 900, color: competitorTable.myRank <= 3 ? M.green : M.pink }}>내 매장 {competitorTable.myRank}위 / {competitorTable.total}</span>}
              </div>
              {/* 항목별 갭 바 */}
              <div style={{ display: "grid", gap: 9, margin: "10px 0 12px" }}>{competitorTable.gaps.map(g => { const max = Math.max(g.top, g.mine, 1); return <div key={g.label}>
                <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11.5, marginBottom: 4 }}><span>{g.icon}</span><b>{g.label}</b><span style={{ color: g.good ? M.green : M.pink, fontWeight: 800 }}>내 {g.mine.toLocaleString()}</span><span style={{ color: M.sub }}>· 평균 {g.avg.toLocaleString()} · 1위 {g.top.toLocaleString()}</span>{!g.good && <span style={{ marginLeft: "auto", fontSize: 10.5, fontWeight: 900, color: M.pink }}>▼ {Math.max(0, g.avg - g.mine).toLocaleString()} 부족</span>}</div>
                <div style={{ position: "relative", height: 16, borderRadius: 8, background: M.soft, overflow: "hidden" }}>
                  <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: `${g.top ? Math.min(100, g.top / max * 100) : 0}%`, background: `${M.sub}22` }} />
                  <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: `${Math.min(100, g.mine / max * 100)}%`, background: g.good ? M.green : M.pink, borderRadius: 8, transition: "width .4s" }} />
                  {g.avg > 0 && <div title="주변 평균" style={{ position: "absolute", left: `${Math.min(100, g.avg / max * 100)}%`, top: -2, bottom: -2, width: 2, background: M.amber }} />}
                </div>
              </div>; })}</div>
              {/* 상위 5곳 랭킹 */}
              <div style={{ display: "grid", gap: 5 }}>{competitorTable.top.map((p, i) => { const mine = p.placeId === ownPlace?.placeId; return <div key={p.placeId} style={{ display: "grid", gridTemplateColumns: "26px 1fr auto auto", alignItems: "center", gap: 8, padding: "7px 10px", borderRadius: 10, background: mine ? `${M.rose}12` : M.soft, border: `1px solid ${mine ? M.rose : M.line}` }}><b style={{ fontSize: 12, color: i === 0 ? M.amber : M.sub }}>{i + 1}</b><span style={{ fontSize: 12, fontWeight: mine ? 900 : 600, color: mine ? M.rose : M.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.name}{mine ? " (내 매장)" : ""}</span><span style={{ fontSize: 10.5, color: M.sub }}>📝{(p.blogReviewCount || 0).toLocaleString()}</span><span style={{ fontSize: 10.5, color: M.sub }}>🧾{(p.visitorReviewCount || 0).toLocaleString()}</span></div>; })}</div>
              <p style={{ margin: "10px 0 0", color: M.sub, fontSize: 10.5, lineHeight: 1.5 }}>💡 1위와 <b style={{ color: M.text }}>블로그 리뷰 {Math.max(0, (competitorTable.leader.blogReviewCount || 0) - (ownPlace?.blogReviewCount || 0)).toLocaleString()}개</b> 차이예요. 아래 솔루션에서 리뷰 블로거를 찾아 이 격차를 좁히세요.</p>
            </section> : <section className="p360-card" style={{ padding: 16, textAlign: "center" }}>
              <b style={{ fontSize: 13 }}>🩺 경쟁사와 비교하려면</b>
              <p style={{ color: M.sub, fontSize: 11.5, margin: "6px 0 10px", lineHeight: 1.5 }}>아래 <b style={{ color: M.text }}>업체 발굴</b>로 주변 경쟁업체를 수집하면, 내 매장이 몇 위인지·리뷰가 얼마나 부족한지 실제 비교표가 나와요.</p>
              <button className="p360-btn" onClick={() => setDiscoveryOpen(true)} style={{ background: M.rose, color: "#fff" }}>🕵️ 경쟁업체 발굴하기 →</button>
            </section>}

            {/* 진단(항목별 별점) */}
            <section className="p360-card" style={{ padding: 16 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}><b style={{ fontSize: 13.5 }}>🧪 진단 신뢰도</b><b style={{ marginLeft: "auto", color: diagnosisCoverage.percent >= 80 ? M.green : M.amber }}>{diagnosisCoverage.percent}%</b></div>
              <p style={{ color: M.sub, fontSize: 10.8, lineHeight: 1.55, margin: "5px 0 10px" }}>이 값은 네이버 순위 점수가 아니라 <b style={{ color: M.text }}>진단에 실제 근거가 얼마나 채워졌는지</b>예요. 검색 위치·시간·개인화에 따라 노출 순서는 달라질 수 있어요.</p>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(145px,1fr))", gap: 6 }}>{diagnosisCoverage.checks.map(item => <div key={item.label} style={{ padding: "8px 9px", borderRadius: 9, background: M.soft, border: `1px solid ${item.ok ? `${M.green}55` : M.line}`, fontSize: 10.5 }}><b style={{ color: item.ok ? M.green : M.sub }}>{item.ok ? "✓" : "○"} {item.label}</b><div style={{ color: M.sub, marginTop: 2 }}>{item.ok ? item.kind : "아직 미측정"}</div></div>)}</div>
            </section>
            {oneClickKit && <section id="p360-kit" className="p360-card" style={{ padding: 16, border: `2px solid ${M.purple}55`, background: `linear-gradient(135deg,${M.card},${M.purple}08)` }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}><b style={{ fontSize: 14 }}>🚀 원클릭 적용 꾸러미</b><span style={{ marginLeft: "auto", fontSize: 10, fontWeight: 900, color: M.purple }}>자동 완성</span></div>
              <p style={{ color: M.sub, fontSize: 10.8, lineHeight: 1.55, margin: "0 0 10px" }}>진단만 보여주지 않고 스마트플레이스에 바로 옮길 수 있는 문구·키워드·사진 순서를 만들었어요.</p>
              <div style={{ display: "grid", gap: 8 }}>
                <div style={{ padding: 10, borderRadius: 10, background: M.soft }}><b style={{ fontSize: 11.5 }}>소개글 초안</b><p style={{ margin: "5px 0", fontSize: 11, lineHeight: 1.55 }}>{oneClickKit.intro}</p><button className="p360-btn" onClick={() => { void navigator.clipboard.writeText(oneClickKit.intro); showToast?.("소개글을 복사했어요", "success"); }} style={{ minHeight: 30, padding: "4px 9px", fontSize: 10.5, background: M.purple, color: "#fff" }}>복사</button></div>
                <div style={{ padding: 10, borderRadius: 10, background: M.soft }}><b style={{ fontSize: 11.5 }}>우선 공략 키워드</b><div style={{ display: "flex", gap: 5, flexWrap: "wrap", marginTop: 6 }}>{oneClickKit.keywords.length ? oneClickKit.keywords.map(k => <span key={k} style={{ padding: "4px 7px", borderRadius: 99, background: `${M.green}16`, color: M.green, fontSize: 10.5, fontWeight: 800 }}>{k}</span>) : <span style={{ color: M.sub, fontSize: 10.5 }}>키워드 수집이 끝나면 자동으로 채워져요</span>}</div></div>
                <div style={{ padding: 10, borderRadius: 10, background: M.soft }}><b style={{ fontSize: 11.5 }}>사진 등록 순서</b><div style={{ marginTop: 6, fontSize: 10.8, lineHeight: 1.7, color: M.sub }}>{oneClickKit.photos.map((p, i) => <span key={p} style={{ marginRight: 8 }}><b style={{ color: M.text }}>{i + 1}.</b> {p}</span>)}</div></div>
                <div style={{ padding: 10, borderRadius: 10, background: M.soft }}><b style={{ fontSize: 11.5 }}>자동 실행 일정</b><div style={{ marginTop: 6, display: "grid", gap: 4 }}>{oneClickKit.actions.map(a => <span key={a} style={{ fontSize: 10.8, color: M.sub }}>✓ {a}</span>)}</div></div>
                <button className="p360-btn" onClick={() => { const all = [`[소개글]`, oneClickKit.intro, ``, `[우선 키워드]`, oneClickKit.keywords.join(", "), ``, `[사진 순서]`, oneClickKit.photos.map((p, i) => `${i + 1}. ${p}`).join("\n"), ``, `[실행 일정]`, oneClickKit.actions.join("\n")].join("\n"); void navigator.clipboard.writeText(all); showToast?.("원클릭 적용 꾸러미 전체를 복사했어요", "success"); }} style={{ background: `linear-gradient(135deg,${M.purple},${M.rose})`, color: "#fff" }}>📋 적용 꾸러미 전체 복사</button>
              </div>
            </section>}
            {placeReport.groups.map(g => <section key={g.title} className="p360-card" style={{ padding: 16 }}>
              <div style={{ display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap", marginBottom: 9 }}><b style={{ fontSize: 13.5 }}>{g.title}</b><span style={{ fontSize: 10, color: M.sub }}>{g.subtitle}</span><span style={{ marginLeft: "auto", fontSize: 9.5, fontWeight: 900, color: M.rose, background: `${M.rose}12`, borderRadius: 99, padding: "2px 8px" }}>{g.weight}</span></div>
              <div style={{ display: "grid", gap: 8 }}>{g.items.map(it => { const st = placeReport.itemStar(it); const sc = it.status === "good" ? M.green : it.status === "warn" ? M.amber : it.status === "input" ? M.sub : M.pink; return <article key={it.key} style={{ padding: 12, borderRadius: 12, background: M.soft, borderLeft: `5px solid ${sc}` }}><div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}><span style={{ fontSize: 18 }}>{it.icon}</span><b style={{ fontSize: 13 }}>{it.label}</b><span style={{ fontSize: 11, color: M.text, fontWeight: 800 }}>{it.value}</span><span style={{ marginLeft: "auto", fontSize: 12.5, color: M.amber }}>{"★".repeat(st)}{"☆".repeat(5 - st)}</span></div><p style={{ margin: "7px 0 0", color: M.sub, fontSize: 11, lineHeight: 1.55 }}><b style={{ color: M.text }}>왜?</b> {it.why}</p><p style={{ margin: "4px 0 0", color: M.text, fontSize: 11, lineHeight: 1.55 }}><b>👉</b> {it.how}</p></article>; })}</div>
            </section>)}

            {/* 자동 키워드 제안 + 순위 */}
            <section id="p360-rank" className="p360-card" style={{ padding: 16 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                <b style={{ fontSize: 13.5 }}>🎯 노릴 키워드 & 순위</b>
                <button className="p360-btn" disabled={kwLoading} onClick={() => void loadAutoKeywords()} style={{ marginLeft: "auto", minHeight: 32, padding: "6px 11px", fontSize: 11, background: `${M.purple}16`, color: M.purple, border: `1px solid ${M.purple}44` }}>{kwLoading ? "발굴 중…" : "🔄 키워드 자동 발굴"}</button>
              </div>
              <p style={{ color: M.sub, fontSize: 11, lineHeight: 1.5, margin: "5px 0 10px" }}>네이버 <b style={{ color: M.text }}>자동완성·연관검색</b>에서 실제 사람들이 치는 검색어를 긁어와요. 누르면 바로 순위를 재요.{(checkingKeyword || rankQueue.length > 0) && <b style={{ color: M.purple }}> · 🎯 자동 순위 측정 중{rankQueue.length > 0 ? ` (${rankQueue.length}개 대기)` : ""}…</b>}</p>
              {(autoKeywords.length > 0 || kwSuggestions.length > 0) && <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 10 }}>
                {keywordOpportunities.slice(0, 18).map(k => <button key={k.keyword} className="p360-btn" title={`${k.tier} ${k.score}점 · ${k.reasons.join(" · ")}`} onClick={() => { persistKeywords([...trackedKeywords, k.keyword]); checkKeywordRank(k.keyword); setAutoKeywords(a => a.filter(x => x.keyword !== k.keyword)); }} style={{ minHeight: 38, padding: "6px 11px", fontSize: 11.5, background: `${k.tier === "우선 공략" ? M.green : M.purple}14`, color: k.tier === "우선 공략" ? M.green : M.purple, border: `1px solid ${k.tier === "우선 공략" ? M.green : M.purple}44`, display: "inline-flex", alignItems: "center", gap: 4 }}>＋ {k.keyword} <span style={{ fontSize: 8.5, opacity: .8, background: `${M.purple}16`, borderRadius: 5, padding: "1px 4px" }}>{k.tier} {k.score}</span></button>)}
                {autoKeywords.length === 0 && kwSuggestions.map(k => <button key={k} className="p360-btn" onClick={() => { persistKeywords([...trackedKeywords, k]); checkKeywordRank(k); }} style={{ minHeight: 34, padding: "6px 11px", fontSize: 11.5, background: `${M.purple}10`, color: M.purple, border: `1px solid ${M.purple}33` }}>＋ {k}</button>)}
              </div>}
              <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 7, marginBottom: 10 }}>
                <input value={newKeyword} onChange={e => setNewKeyword(e.target.value)} onKeyDown={e => { if (e.key === "Enter" && newKeyword.trim()) { const v = newKeyword.trim(); if (!trackedKeywords.includes(v)) persistKeywords([...trackedKeywords, v]); setNewKeyword(""); checkKeywordRank(v); } }} placeholder="예: 횡성 한우 맛집" className="p360-in" />
                <button className="p360-btn" onClick={() => { const v = newKeyword.trim(); if (!v) return; if (!trackedKeywords.includes(v)) persistKeywords([...trackedKeywords, v]); setNewKeyword(""); checkKeywordRank(v); }} style={{ background: M.soft, color: M.text, border: `1px solid ${M.line}`, whiteSpace: "nowrap" }}>+ 추가</button>
              </div>
              {trackedKeywords.length > 0 && <div style={{ display: "flex", alignItems: "center", gap: 7, flexWrap: "wrap", marginBottom: 9 }}>
                <button className="p360-btn" disabled={Boolean(checkingKeyword) || rankQueue.length > 0} onClick={() => setRankQueue(q => Array.from(new Set([...q, ...trackedKeywords])))} style={{ minHeight: 34, padding: "7px 13px", fontSize: 12, background: M.rose, color: "#fff", opacity: (checkingKeyword || rankQueue.length) ? .6 : 1 }}>📊 전체 순위 확인 ({trackedKeywords.length})</button>
                {(checkingKeyword || rankQueue.length > 0) && <span style={{ fontSize: 11, fontWeight: 800, color: M.purple }}>측정 중… {rankQueue.length > 0 ? `${rankQueue.length}개 대기` : "마무리"}</span>}
                <button className="p360-btn" onClick={() => { if (window.confirm(`추적 키워드 ${trackedKeywords.length}개를 모두 지울까요?`)) persistKeywords([]); }} style={{ marginLeft: "auto", minHeight: 34, padding: "7px 12px", fontSize: 11.5, background: "transparent", color: M.sub, border: `1px solid ${M.line}` }}>전체 삭제</button>
              </div>}
              <div style={{ display: "grid", gap: 7 }}>{trackedKeywords.length === 0 ? <p style={{ color: M.sub, fontSize: 11.5 }}>추천 키워드를 누르거나 검색어를 추가하세요.</p> : trackedKeywords.map(kw => { const last = rankHistory.find(r => r.keyword === kw); const chk = checkingKeyword === kw; const spark = kwSpark(kw); return <div key={kw} style={{ display: "grid", gridTemplateColumns: "1fr auto auto auto", alignItems: "center", gap: 8, padding: "9px 11px", borderRadius: 11, background: M.soft, border: `1px solid ${M.line}` }}><div style={{ minWidth: 0 }}><b style={{ fontSize: 12.5, overflowWrap: "anywhere" }}>{kw}</b>{last ? <span style={{ marginLeft: 6, fontSize: 11, fontWeight: 900, color: last.rank ? M.green : M.amber }}>{last.rank ? `${last.rank}위` : "상위 밖"}</span> : <span style={{ marginLeft: 6, fontSize: 10.5, color: M.sub }}>미확인</span>}</div>{spark || <span style={{ width: 56 }} />}<button className="p360-btn" disabled={Boolean(checkingKeyword)} onClick={() => checkKeywordRank(kw)} style={{ minHeight: 34, padding: "6px 11px", fontSize: 11.5, background: chk ? M.card : M.rose, color: chk ? M.sub : "#fff", border: chk ? `1px solid ${M.line}` : "none" }}>{chk ? "확인 중…" : "순위 확인"}</button><button onClick={() => persistKeywords(trackedKeywords.filter(x => x !== kw))} style={{ border: "none", background: "transparent", color: M.sub, cursor: "pointer", fontSize: 15 }}>×</button></div>; })}</div>
              {/* 🏅 이 검색의 상위 업체(경쟁사 순위 노출) — 순위 확인하면 함께 수집된 업체 목록 */}
              {collectedPlaces.length > 1 && (() => {
                const ranked = collectedPlaces.slice(0, 8);
                return <div style={{ marginTop: 12, paddingTop: 12, borderTop: `1px solid ${M.line}` }}>
                  <div className="p360-help" style={{ margin: "0 0 8px" }}><span>🏅</span><span><b>측정 시점의 실제 검색 노출 순서</b>예요. 리뷰 수로 재정렬하지 않으며, 같은 키워드·화면에서 반복 측정해 변화를 확인하세요.</span></div>
                  <div style={{ display: "grid", gap: 5 }}>{ranked.map((p, i) => { const mine = p.placeId === ownPlace?.placeId; return <div key={p.placeId} style={{ display: "grid", gridTemplateColumns: "24px 1fr auto auto", alignItems: "center", gap: 8, padding: "7px 10px", borderRadius: 9, background: mine ? `${M.rose}12` : M.soft, border: `1px solid ${mine ? M.rose : M.line}` }}><b style={{ fontSize: 11.5, color: i === 0 ? M.amber : M.sub }}>{i + 1}</b><span style={{ fontSize: 11.5, fontWeight: mine ? 900 : 600, color: mine ? M.rose : M.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.name}{mine ? " (내 매장)" : ""}</span><span style={{ fontSize: 10, color: M.sub }}>🧾{(p.visitorReviewCount || 0).toLocaleString()}</span><span style={{ fontSize: 10, color: M.sub }}>📝{(p.blogReviewCount || 0).toLocaleString()}</span></div>; })}</div>
                </div>;
              })()}
            </section>

            {/* 📊 성과 리포트: 일/주/월/기간설정 */}
            <section className="p360-card" style={{ padding: 16 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
                <b style={{ fontSize: 13.5 }}>📊 성과 리포트</b>
                <div style={{ marginLeft: "auto", display: "flex", gap: 5, flexWrap: "wrap" }}>
                  {([[1, "일간"], [7, "주간"], [30, "월간"], ["custom", "기간설정"]] as const).map(([v, l]) => <button key={String(v)} className="p360-btn" onClick={() => setReportRange(v)} style={{ minHeight: 32, padding: "6px 11px", fontSize: 11, background: reportRange === v ? M.rose : M.soft, color: reportRange === v ? "#fff" : M.text, border: `1px solid ${reportRange === v ? M.rose : M.line}` }}>{l}</button>)}
                </div>
              </div>
              {reportRange === "custom" && <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}><span style={{ fontSize: 11.5, color: M.sub }}>최근</span><input inputMode="numeric" type="number" min={1} max={365} value={reportCustom} onChange={e => setReportCustom(Math.max(1, Math.min(365, Number(e.target.value) || 1)))} className="p360-in" style={{ minHeight: 38, width: 90, fontSize: 13 }} /><span style={{ fontSize: 11.5, color: M.sub }}>일</span></div>}
              {!report.hasData ? <p style={{ color: M.sub, fontSize: 11.5, lineHeight: 1.6, padding: "8px 0" }}>이 기간엔 측정 기록이 없어요. 순위를 재거나 경쟁사를 수집하면 변화가 여기에 쌓여요.</p> : <>
                {/* 요약 타일 */}
                <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 8, marginBottom: 12 }}>
                  <div style={{ padding: "10px 12px", borderRadius: 11, background: M.soft }}><div style={{ fontSize: 10, color: M.sub }}>측정 횟수</div><b style={{ fontSize: 17, color: M.rose }}>{report.measures}회</b></div>
                  <div style={{ padding: "10px 12px", borderRadius: 11, background: M.soft }}><div style={{ fontSize: 10, color: M.sub }}>블로그 리뷰 증감</div><b style={{ fontSize: 17, color: (report.reviewDelta?.blog ?? 0) >= 0 ? M.green : M.pink }}>{report.reviewDelta ? `${report.reviewDelta.blog >= 0 ? "+" : ""}${report.reviewDelta.blog}` : "-"}</b></div>
                  <div style={{ padding: "10px 12px", borderRadius: 11, background: M.soft }}><div style={{ fontSize: 10, color: M.sub }}>방문자 리뷰 증감</div><b style={{ fontSize: 17, color: (report.reviewDelta?.visitor ?? 0) >= 0 ? M.green : M.pink }}>{report.reviewDelta ? `${report.reviewDelta.visitor >= 0 ? "+" : ""}${report.reviewDelta.visitor}` : "-"}</b></div>
                </div>
                {/* 키워드별 순위 변화 */}
                {report.kwRows.length > 0 && <div style={{ display: "grid", gap: 6 }}>{report.kwRows.slice(0, 8).map(k => <div key={k.keyword} style={{ display: "grid", gridTemplateColumns: "1fr auto auto", alignItems: "center", gap: 8, padding: "8px 11px", borderRadius: 10, background: M.soft }}><b style={{ fontSize: 12, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{k.keyword}</b><span style={{ fontSize: 12, fontWeight: 800, color: k.last != null ? M.text : M.amber }}>{k.last != null ? `${k.last}위` : "상위밖"}</span><span style={{ fontSize: 11, fontWeight: 900, minWidth: 60, textAlign: "right", color: k.change == null ? M.sub : k.change > 0 ? M.green : k.change < 0 ? M.pink : M.sub }}>{k.change == null ? "기준" : k.change > 0 ? `▲ ${k.change}` : k.change < 0 ? `▼ ${Math.abs(k.change)}` : "— 유지"}</span></div>)}</div>}
                <button className="p360-btn" onClick={downloadReport} style={{ width: "100%", marginTop: 12, background: M.text, color: M.bg }}>📄 이 리포트 PDF로 저장</button>
              </>}
            </section>

            {/* 📅 측정 기록 보관함 — 보관 기간 내 전체 순위 이력 */}
            <section className="p360-card" style={{ padding: 16 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                <b style={{ fontSize: 13.5 }}>📅 측정 기록 보관함</b>
                <span style={{ marginLeft: "auto", fontSize: 10.5, fontWeight: 900, color: M.purple, background: `${M.purple}14`, borderRadius: 99, padding: "3px 9px" }}>보관 {PLACE360_HISTORY_DAYS[plan] >= 3650 ? "무제한" : `${PLACE360_HISTORY_DAYS[plan] ?? 30}일`}</span>
              </div>
              <div style={{ fontSize: 11, color: M.sub, lineHeight: 1.6, margin: "5px 0 11px", display: "flex", gap: 6 }}><span>💬</span><span>여기서 <b style={{ color: M.text }}>지금까지 잰 순위를 전부</b> 날짜별로 다시 볼 수 있어요. 등급 보관 기간(무료 30·베이직 90·<b style={{ color: M.text }}>프로 180</b>일)이 지난 기록은 자동으로 정리돼요.</span></div>
              {archive.total === 0 ? <p style={{ color: M.sub, fontSize: 11.5, padding: "8px 0" }}>아직 저장된 측정 기록이 없어요. 키워드 순위를 재면 여기에 날짜별로 쌓여요.</p> : <>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 8, marginBottom: 11 }}>
                  <div style={{ padding: "9px 11px", borderRadius: 10, background: M.soft, textAlign: "center" }}><div style={{ fontSize: 10, color: M.sub }}>측정한 날</div><b style={{ fontSize: 16, color: M.rose }}>{archive.dayCount}일</b></div>
                  <div style={{ padding: "9px 11px", borderRadius: 10, background: M.soft, textAlign: "center" }}><div style={{ fontSize: 10, color: M.sub }}>추적 키워드</div><b style={{ fontSize: 16, color: M.green }}>{archive.kwCount}개</b></div>
                  <div style={{ padding: "9px 11px", borderRadius: 10, background: M.soft, textAlign: "center" }}><div style={{ fontSize: 10, color: M.sub }}>총 측정</div><b style={{ fontSize: 16, color: M.purple }}>{archive.total}회</b></div>
                </div>
                <div style={{ maxHeight: 280, overflowY: "auto", border: `1px solid ${M.line}`, borderRadius: 11 }}>
                  <div style={{ display: "grid", gridTemplateColumns: "1.4fr auto 1fr", gap: 8, padding: "8px 12px", background: M.soft, position: "sticky", top: 0, fontSize: 10, fontWeight: 900, color: M.sub }}><span>날짜·키워드</span><span>순위</span><span>확인 범위</span></div>
                  {archive.rows.slice(0, 100).map((r, i) => <div key={r.id || i} style={{ display: "grid", gridTemplateColumns: "1.4fr auto 1fr", gap: 8, alignItems: "center", padding: "8px 12px", borderTop: `1px solid ${M.line}`, fontSize: 11.5 }}>
                    <span style={{ minWidth: 0 }}><b style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", display: "block" }}>{r.keyword}</b><small style={{ color: M.sub }}>{new Date(r.measured_at).toLocaleString("ko-KR", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })}</small></span>
                    <b style={{ color: r.rank ? (r.rank <= 10 ? M.green : M.text) : M.amber }}>{r.rank ? `${r.rank}위` : "상위 밖"}</b>
                    <small style={{ color: M.sub }}>상위 {r.checked_count}곳</small>
                  </div>)}
                  {archive.rows.length > 100 && <div style={{ padding: 8, textAlign: "center", fontSize: 10.5, color: M.sub }}>+ {archive.rows.length - 100}건 더 (PDF로 전체 저장)</div>}
                </div>
              </>}
            </section>

            {/* 손님 행동 입력(저장·길찾기) */}
            <section data-behavior-input className="p360-card" style={{ padding: 16, borderColor: `${M.amber}44`, borderWidth: 2 }}>
              <div style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "4px 10px", borderRadius: 99, background: M.amber, color: dark ? "#2b2620" : "#fff", fontSize: 11, fontWeight: 950 }}>✏️ 손님 행동 직접 입력</div>
              <p style={{ margin: "8px 0 10px", color: M.sub, fontSize: 11, lineHeight: 1.55 }}>저장·길찾기 수는 공개 화면에 없어요. 스마트플레이스 앱 → 통계에서 확인해 넣으면 위 별점에 반영돼요.</p>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
                <label><b style={{ display: "block", fontSize: 11.5, marginBottom: 5 }}>💾 저장하기</b><input inputMode="numeric" type="number" min={0} value={behaviorInput.saves || ""} onChange={e => updateBehavior({ saves: Number(e.target.value) || 0 })} placeholder="예: 128" className="p360-in" /></label>
                <label><b style={{ display: "block", fontSize: 11.5, marginBottom: 5 }}>🧭 길찾기</b><input inputMode="numeric" type="number" min={0} value={behaviorInput.directions || ""} onChange={e => updateBehavior({ directions: Number(e.target.value) || 0 })} placeholder="예: 64" className="p360-in" /></label>
                <label><b style={{ display: "block", fontSize: 11.5, marginBottom: 5 }}>🔗 공유</b><input inputMode="numeric" type="number" min={0} value={behaviorInput.shares || ""} onChange={e => updateBehavior({ shares: Number(e.target.value) || 0 })} placeholder="예: 20" className="p360-in" /></label>
              </div>
            </section>

            {/* 퍼블리 순위상승 솔루션 */}
            <section className="p360-card" style={{ padding: 16, borderLeft: `6px solid ${M.rose}` }}>
              <b style={{ fontSize: 13.5 }}>🚀 순위 올리는 퍼블리 솔루션</b>
              <p style={{ color: M.sub, fontSize: 11, lineHeight: 1.55, margin: "5px 0 10px" }}>블로그 리뷰는 고객이 비교할 때 보는 <b style={{ color: M.text }}>외부 콘텐츠 격차</b>예요{comparison ? ` (내 ${(ownPlace?.blogReviewCount || 0).toLocaleString()} · 주변 평균 ${comparison.avgBlog.toLocaleString()})` : ""}. 개수만 늘리기보다 지역·메뉴 관련성과 최신성을 갖춘 진짜 방문 콘텐츠를 확보하세요.</p>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                <button className="p360-btn" onClick={() => setDiscoveryOpen(true)} style={{ background: M.rose, color: "#fff" }}>🕵️ 리뷰 블로거 찾기 →</button>
                <button className="p360-btn" onClick={() => onOpenCrawl?.()} style={{ background: M.soft, color: M.text, border: `1px solid ${M.line}` }}>🔍 크롤링으로 섭외 →</button>
              </div>
              {onOpenReview && (
                <>
                  <p style={{ color: M.sub, fontSize: 11, lineHeight: 1.55, margin: "12px 0 8px" }}>내 매장에 달린 <b style={{ color: M.text }}>손님 리뷰에 사장님 답글</b>을 달면 소통 점수가 올라 순위에 도움돼요. 악플·저점은 자동 등록하지 않고 확인 후 승인해요.</p>
                  <button className="p360-btn" onClick={() => onOpenReview()} style={{ width: "100%", background: M.rose, color: "#fff", fontWeight: 800 }}>🗣️ 리뷰에 사장님 답글 달기 →</button>
                </>
              )}
            </section>

            {/* 포스 자료(접이식) */}
            {hasStore && <section id="p360-pos" className="p360-card" style={{ padding: 16, borderColor: `${M.amber}44`, borderWidth: 2 }}>
              <button onClick={() => setPosOpen(o => !o)} style={{ width: "100%", display: "flex", alignItems: "center", gap: 8, background: "transparent", border: "none", cursor: "pointer", fontFamily: "inherit", padding: 0 }}>
                <span style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "4px 10px", borderRadius: 99, background: M.amber, color: dark ? "#2b2620" : "#fff", fontSize: 11, fontWeight: 950 }}>📊 포스 자료 입력</span>
                <b style={{ fontSize: 12.5, color: M.text }}>신규·재방문·광고·매출 (선택)</b>
                <span style={{ marginLeft: "auto", fontSize: 15, color: M.sub }}>{posOpen ? "▲" : "▼"}</span>
              </button>
              {posOpen && <div style={{ marginTop: 12 }}>
                <div className="p360-help"><span>💬</span><span>매장 <b>포스기(계산대)·네이버 광고 관리자</b>에서 본 숫자를 넣는 곳이에요. <b>최근 30일</b>과 <b>그 전 30일(31~60일 전)</b>을 각각 넣으면, 손님이 왜 줄었는지(신규가 준 건지·광고가 비싼 건지)를 진단해드려요. <b>모르는 칸은 0으로 두면</b> 그 항목만 빼고 계산해요. (선택 사항)</span></div>
                <div style={{ display: "flex", gap: 7, flexWrap: "wrap", margin: "4px 0 12px", alignItems: "center" }}><button className="p360-btn" onClick={downloadMetricsTemplate} style={{ minHeight: 36, fontSize: 11.5, background: M.soft, color: M.text, border: `1px solid ${M.line}` }}>⬇️ 엑셀 양식 받기</button><button className="p360-btn" onClick={() => csvInputRef.current?.click()} style={{ minHeight: 36, fontSize: 11.5, background: M.amber, color: dark ? "#2b2620" : "#fff" }}>📂 작성한 파일 올리기</button><input ref={csvInputRef} type="file" accept=".csv,text/csv" onChange={ev => void importMetricsCsv(ev.target.files?.[0])} style={{ display: "none" }} /><span style={{ fontSize: 10.5, color: M.sub }}>양식으로 한 번에 넣거나, 아래에 직접 입력</span></div>
                {/* 열 헤더 */}
                <div style={{ display: "grid", gridTemplateColumns: "1.2fr 1fr 1fr", gap: 7, marginBottom: 6, padding: "0 2px" }}><span style={{ fontSize: 10.5, fontWeight: 900, color: M.sub }}>항목</span><span style={{ fontSize: 10.5, fontWeight: 900, color: M.rose, textAlign: "center" }}>📅 최근 30일</span><span style={{ fontSize: 10.5, fontWeight: 900, color: M.sub, textAlign: "center" }}>📅 이전 30일</span></div>
                <div style={{ display: "grid", gap: 7 }}>{([["신규 고객", "처음 온 손님 수(명)", "current_new_customers", "previous_new_customers"], ["재방문 고객", "다시 온 손님 수(명)", "current_repeat_customers", "previous_repeat_customers"], ["광고비", "네이버 등 광고에 쓴 돈(원)", "current_ad_spend", "previous_ad_spend"], ["광고 행동", "광고로 생긴 전화·예약·클릭(건)", "current_ad_actions", "previous_ad_actions"], ["매출", "총 매출(원)", "current_sales", "previous_sales"]] as const).map(([t, d, ck, pk]) => <div key={ck} style={{ display: "grid", gridTemplateColumns: "1.2fr 1fr 1fr", gap: 7, alignItems: "center" }}><div style={{ minWidth: 0 }}><b style={{ fontSize: 12, display: "block" }}>{t}</b><small style={{ fontSize: 9.5, color: M.sub, lineHeight: 1.3 }}>{d}</small></div><input inputMode="numeric" type="number" value={businessMetrics[ck]} onChange={e => updateBusinessMetric(ck, e.target.value)} className="p360-in" style={{ minHeight: 40, fontSize: 13, textAlign: "center" }} /><input inputMode="numeric" type="number" value={businessMetrics[pk]} onChange={e => updateBusinessMetric(pk, e.target.value)} className="p360-in" style={{ minHeight: 40, fontSize: 13, textAlign: "center" }} /></div>)}</div>
                <button className="p360-btn" disabled={metricsLoading} onClick={() => void saveBusinessMetrics()} style={{ width: "100%", marginTop: 12, background: M.green, color: "#fff", opacity: metricsLoading ? .6 : 1 }}>{metricsLoading ? "저장 중…" : "이 숫자로 원인 진단하기 →"}</button>
                {metricsSavedAt && <p style={{ margin: "7px 0 0", textAlign: "center", color: M.sub, fontSize: 10 }}>마지막 저장 · {new Date(metricsSavedAt).toLocaleString("ko-KR")}</p>}
              </div>}
            </section>}
          </>}

          {/* 🕵️ 업체 발굴·리뷰 블로거 역추적 — 클릭 시 모달로 열림(세로로 안 늘어남). 로그는 왼쪽 공용 터미널로 */}
          <button onClick={() => setDiscoveryOpen(true)} className="p360-card" style={{ display: "flex", alignItems: "center", gap: 11, padding: "16px 18px", cursor: "pointer", textAlign: "left", width: "100%", fontFamily: "inherit" }}>
            <span style={{ width: 42, height: 42, borderRadius: 12, flexShrink: 0, display: "grid", placeItems: "center", background: `${M.rose}16`, fontSize: 21 }}>🕵️</span>
            <div style={{ minWidth: 0 }}>
              <b style={{ fontSize: 13.5, color: M.text }}>업체 발굴 · 리뷰 블로거 역추적</b>
              <div style={{ fontSize: 10.5, color: M.sub, lineHeight: 1.45, marginTop: 2 }}>경쟁업체 → <b style={{ color: M.text }}>리뷰 쓴 블로거</b> 찾기 → 섭외 → 내 리뷰↑ → 상위노출. 진행상황은 왼쪽 작업 로그에 실시간으로.</div>
            </div>
            <span className="p360-btn" style={{ marginLeft: "auto", flexShrink: 0, background: M.rose, color: "#fff", fontSize: 12.5, padding: "9px 15px", pointerEvents: "none" }}>열기 →</span>
          </button>
        </div>
      </div>

      {/* 역추적·업체찾기 모달 — createPortal로 body에 붙여 조상 transform 함정 회피(뷰포트 정중앙) */}
      {discoveryOpen && createPortal(
        <div onMouseDown={e => { if (e.target === e.currentTarget) setDiscoveryOpen(false); }} style={{ position: "fixed", inset: 0, zIndex: 2147483000, background: "rgba(6,20,16,.55)", backdropFilter: "blur(3px)", display: "flex", alignItems: "flex-start", justifyContent: "center", padding: "clamp(10px,4vh,40px) 14px", overflowY: "auto", fontFamily: "'Noto Sans KR',sans-serif" }}>
          <div style={{ width: "100%", maxWidth: 920, background: M.bg, borderRadius: 18, border: `1px solid ${M.line}`, boxShadow: "0 30px 80px -20px rgba(0,0,0,.6)", overflow: "hidden", animation: "p360pop .32s cubic-bezier(.2,1.3,.4,1) both" }}>
            <div style={{ position: "sticky", top: 0, zIndex: 2, display: "flex", alignItems: "center", gap: 11, padding: "14px 18px", background: dark ? M.card : "#fff", borderBottom: `1px solid ${M.line}` }}>
              <span style={{ fontSize: 20 }}>🕵️</span>
              <div style={{ minWidth: 0 }}><b style={{ fontSize: 14.5, color: M.text }}>업체 발굴 · 리뷰 블로거 역추적</b><div style={{ fontSize: 10.5, color: M.sub }}>진행상황은 뒤 왼쪽 작업 로그에 실시간으로 찍혀요.</div></div>
              <button onClick={() => setDiscoveryOpen(false)} className="p360-btn" style={{ marginLeft: "auto", background: M.soft, color: M.text, border: `1px solid ${M.line}`, fontSize: 13, padding: "8px 13px" }}>✕ 닫기</button>
            </div>
            <PlaceCenter showToast={showToast} theme={theme} userId={userId} plan={plan} initialRegion={profile.region} ownStoreName={profile.name} onPlacesCollected={onPlacesCollected} onReviewerHandoff={onReviewerHandoff} onOwnStoreDetailViewed={() => completeMissionAutomatically("customer")} onOpenCrawl={onOpenCrawl} onLog={(m) => pushLog(scanPct, m)} hideLog />
          </div>
        </div>, document.body)}

      {/* 🔍 타일 클릭 팝업 — 행위 → 이유 → 성과 → 실행 */}
      {tileModal && createPortal(
        <div onMouseDown={e => { if (e.target === e.currentTarget) setTileModal(null); }} style={{ position: "fixed", inset: 0, zIndex: 2147483000, background: "rgba(6,20,16,.5)", backdropFilter: "blur(3px)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16, fontFamily: "'Noto Sans KR',sans-serif" }}>
          {(() => {
            const item = placeReport?.groups.flatMap(g => g.items).find(x => x.key === tileModal.key);
            const done = item?.status === "good";
            const sc = done ? M.green : item?.status === "warn" ? M.amber : tileModal.c;
            // 성과 예측: 이 항목을 good으로 만들면 별점/점수 얼마 오르나
            let gain = "";
            if (placeReport && item && !done) {
              const WEIGHT: Record<string, number> = { visitor: 5, save: 5, blog: 4, directions: 4, kw: 4, reserve: 3, photo: 3, menu: 3, share: 3, hours: 2, conv: 2, news: 2, desc: 3 };
              const w = WEIGHT[item.key];
              if (w) {
                const cur = item.status === "warn" ? 3 : item.status === "input" ? 2 : 1;
                const deltaStar = (5 - cur) * w;   // 별 상승분 × 가중치
                gain = `이 항목을 채우면 종합 별점이 약 +${(deltaStar / (placeReport.totalCount * 5) * 5).toFixed(1)}점 올라요`;
              }
            }
            const actLabel = tileModal.act === "behavior" ? "✏️ 손님 행동 입력하기" : tileModal.act === "discovery" ? "🕵️ 리뷰 블로거 찾기" : tileModal.act === "rank" ? "🎯 키워드·순위 보기" : "🔗 네이버 플레이스에서 고치기";
            const runAct = () => {
              setTileModal(null);
              if (tileModal.act === "behavior") { setPosOpen(false); setTimeout(() => { const el = document.querySelector('[data-behavior-input]'); el?.scrollIntoView({ behavior: "smooth", block: "center" }); }, 60); }
              else if (tileModal.act === "discovery") setDiscoveryOpen(true);
              else if (tileModal.act === "rank") document.getElementById("p360-rank")?.scrollIntoView({ behavior: "smooth" });
              else { const url = livePlace?.placeUrl || profile.placeUrl; if (url) window.open(url, "_blank", "noopener,noreferrer"); else showToast?.("먼저 플레이스 주소를 등록해 주세요", "info"); }
            };
            return <div style={{ width: "100%", maxWidth: 420, background: M.bg, borderRadius: 18, border: `2px solid ${sc}55`, boxShadow: "0 30px 80px -20px rgba(0,0,0,.6)", overflow: "hidden", animation: "p360pop .3s cubic-bezier(.2,1.3,.4,1) both" }}>
              <div style={{ padding: "16px 18px", background: `linear-gradient(120deg,${sc}18,${M.rose}0a)`, display: "flex", alignItems: "center", gap: 10 }}>
                <span style={{ fontSize: 26 }}>{tileModal.i}</span>
                <div><b style={{ fontSize: 15 }}>{tileModal.l}</b><div style={{ fontSize: 11, fontWeight: 800, color: sc }}>{done ? "✅ 양호" : item?.status === "warn" ? "🟡 보완 필요" : item?.status === "input" ? "✏️ 입력 필요" : "🔴 시급"}</div></div>
                <button onClick={() => setTileModal(null)} style={{ marginLeft: "auto", background: "transparent", border: "none", fontSize: 18, color: M.sub, cursor: "pointer" }}>✕</button>
              </div>
              <div style={{ padding: 18 }}>
                <div style={{ marginBottom: 12 }}><div style={{ fontSize: 10.5, fontWeight: 900, color: M.sub, marginBottom: 3 }}>왜 중요한가요?</div><p style={{ margin: 0, fontSize: 12.5, color: M.text, lineHeight: 1.6 }}>{item?.why || tileModal.act === "behavior" ? (item?.why || "손님 행동은 순위에 크게 반영돼요.") : (item?.why || "")}</p></div>
                <div style={{ marginBottom: 12 }}><div style={{ fontSize: 10.5, fontWeight: 900, color: M.sub, marginBottom: 3 }}>어떻게 하나요?</div><p style={{ margin: 0, fontSize: 12.5, color: M.text, lineHeight: 1.6 }}>👉 {item?.how || "아래 버튼으로 이어서 처리하세요."}</p></div>
                {gain && <div style={{ padding: "10px 12px", borderRadius: 11, background: `${M.green}12`, border: `1px solid ${M.green}33`, marginBottom: 14 }}><div style={{ fontSize: 10.5, fontWeight: 900, color: M.green, marginBottom: 2 }}>🎁 하면 이만큼 좋아져요</div><p style={{ margin: 0, fontSize: 12, color: M.text, lineHeight: 1.5 }}>{gain} → 별점이 오르면 <b>레벨·순위 상승</b>으로 이어져요.</p></div>}
                {done && <div style={{ padding: "10px 12px", borderRadius: 11, background: `${M.green}12`, marginBottom: 14, fontSize: 12, color: M.green, fontWeight: 700 }}>✅ 이미 잘 하고 있어요! 이 상태를 유지하세요.</div>}
                <button className="p360-btn" onClick={runAct} style={{ width: "100%", background: sc, color: "#fff" }}>{actLabel} →</button>
              </div>
            </div>;
          })()}
        </div>, document.body)}

    </div>
  </div>;
}
