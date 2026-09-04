import { useEffect, useMemo, useRef, useState } from "react";
import { BotEventStream, botFetch } from "../lib/botApi";
import { PLAN_CONFIG, CRAWL_DAILY_LIMIT, PLACE_BLOGGER_LIMIT, PLACE_DETAIL_DAILY_LIMIT } from "../lib/supabase";
import { savePlaceBloggerCandidates } from "../lib/discoveryBridge";
import UsageGuide from "./UsageGuide";

const BOT = "http://127.0.0.1:3334";

const THEMES = {
  // 플레이스365(민트)와 배색 통일
  light: { bg: "#eefbf6", surf: "#ffffff", surf2: "#effaf4", ink: "#0f2b23", sub: "#5c8478", line: "#d6ede3", line2: "#c3e3d6", accent: "#00c896", accentSoft: "#d6f5ec", logBg: "#050a0f", logInk: "#8fb3c9" },
  dark: { bg: "#20302b", surf: "#2a3d37", surf2: "#324841", ink: "#eafff7", sub: "#a9d0c3", line: "#3f5850", line2: "#4a6157", accent: "#1fe0b0", accentSoft: "#20463b", logBg: "#0a1512", logInk: "#8fb3c9" },
};

type Place = { placeId: string; name: string; category?: string; address?: string; visitorReviewCount?: number; blogReviewCount?: number; placeUrl: string };
type PlaceDetail = Place & { imageUrls: string[]; businessHours?: string; phone?: string; menus: { name: string; price?: string }[]; conveniences: string[]; bookingAvailable?: boolean; collectedAt: string };
type Blogger = { blogId: string; nick?: string; title?: string; fromPlace?: string; fromPlaces: string[] };
type PlaceAcct = { accountId: string; id: string; pw: string; blogId: string; sessionOk: boolean; loginLoading?: boolean };
type PlaceCollectionMeta = { query: string; domain: string; measuredAt: string; surface: "네이버 지도 PC" };
type Props = { showToast?: (m: string, t?: any) => void; theme?: "dark" | "light"; userId?: string; plan?: string; onOpenCrawl?: () => void; initialRegion?: string; ownStoreName?: string; onPlacesCollected?: (places: Place[], meta: PlaceCollectionMeta) => void; onReviewerHandoff?: (count: number) => void | Promise<void>; onOwnStoreDetailViewed?: () => void | Promise<void>; onLog?: (msg: string) => void; hideLog?: boolean };

const PLACE_LS_KEY = "publy_accounts_place";
const PLACE_DETAIL_CACHE_TTL = 6 * 60 * 60 * 1000;
const detailCacheKey = (userId?: string) => `publy_place_detail_cache_v1:${userId || "guest"}`;
const CATEGORIES = [
  { label: "전체", value: "place" }, { label: "맛집", value: "restaurant" },
  { label: "카페", value: "cafe" }, { label: "미용실", value: "hairshop" }, { label: "병원", value: "hospital" },
];

function placeScore(p: Place): number {
  const visitors = p.visitorReviewCount || 0;
  const blogs = p.blogReviewCount || 0;
  const gap = Math.max(0, visitors - blogs * 8);
  return gap + Math.min(visitors, 1000) * .2;
}

function needsMarketing(p: Place): boolean {
  const visitors = p.visitorReviewCount || 0;
  const blogs = p.blogReviewCount || 0;
  return visitors >= 30 && blogs <= Math.max(10, Math.round(visitors * .08));
}

export default function PlaceCenter({ showToast, theme: extTheme, userId, plan = "free", onOpenCrawl, initialRegion = "", ownStoreName = "", onPlacesCollected, onReviewerHandoff, onOwnStoreDetailViewed, onLog, hideLog }: Props) {
  const toast = (m: string, t?: string) => showToast?.(m, t);
  const theme: "dark" | "light" = extTheme === "dark" ? "dark" : "light";
  const C = THEMES[theme];
  const [mode, setMode] = useState<"places" | "bloggers">("places");
  const [region, setRegion] = useState(initialRegion);
  const [domain, setDomain] = useState("restaurant");
  const [keyword, setKeyword] = useState("");
  const [count, setCount] = useState(20);
  // 🗺️ 역추적 업체당 인원 상한(등급별). 무제한이면 클램프 없음.
  const bloggerLimit = PLACE_BLOGGER_LIMIT[plan] ?? PLACE_BLOGGER_LIMIT.free;
  const unlimitedBloggers = bloggerLimit >= 9999;
  const [bloggerTarget, setBloggerTarget] = useState(() => (unlimitedBloggers ? 50 : bloggerLimit));
  const [places, setPlaces] = useState<Place[]>([]);
  const [placeFilter, setPlaceFilter] = useState<"all" | "marketing" | "blogActive">("all");
  const [placeSort, setPlaceSort] = useState<"recommended" | "visitors" | "blogs">("recommended");
  const [selectedPlaces, setSelectedPlaces] = useState<Set<string>>(new Set());
  const [bloggers, setBloggers] = useState<Blogger[]>([]);
  const [selectedBloggers, setSelectedBloggers] = useState<Set<string>>(new Set());
  const [running, setRunning] = useState(false);
  const [bloggerRunning, setBloggerRunning] = useState(false);
  const [logs, setLogs] = useState<string[]>([]);
  const [quota, setQuota] = useState<{ used: number; limit: number; remaining: number } | null>(null);
  const [detailPlace, setDetailPlace] = useState<Place | null>(null);
  const [placeDetails, setPlaceDetails] = useState<Record<string, PlaceDetail>>(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(detailCacheKey(userId)) || "{}") as Record<string, PlaceDetail>;
      return Object.fromEntries(Object.entries(saved).filter(([, value]) => Date.now() - new Date(value.collectedAt).getTime() < PLACE_DETAIL_CACHE_TTL)) as Record<string, PlaceDetail>;
    } catch { return {}; }
  });
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailQuota, setDetailQuota] = useState<{ used: number; limit: number; remaining: number } | null>(null);
  const searchRef = useRef<BotEventStream | null>(null);
  const bloggersRef = useRef<BotEventStream | null>(null);
  const isOwnStore = (name: string) => {
    const own = ownStoreName.replace(/\s+/g, "").toLowerCase();
    const target = name.replace(/\s+/g, "").toLowerCase();
    return Boolean(own && (own.includes(target) || target.includes(own)));
  };

  const [mailAccounts, setMailAccounts] = useState<PlaceAcct[]>(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(PLACE_LS_KEY) || "[]");
      if (Array.isArray(saved) && saved.length) return saved.map((a: any) => ({ accountId: a.accountId, id: a.id || "", pw: a.pw || "", blogId: a.blogId || "", sessionOk: !!a.sessionOk }));
    } catch {}
    return [{ accountId: "place_acc_1", id: "", pw: "", blogId: "", sessionOk: false }];
  });
  const [mailAcctId, setMailAcctId] = useState("");
  const [showMailPw, setShowMailPw] = useState<Record<string, boolean>>({});
  const connectedMail = mailAccounts.filter(a => a.sessionOk && a.blogId);
  const savePlaceAccts = (list: PlaceAcct[]) => {
    try { localStorage.setItem(PLACE_LS_KEY, JSON.stringify(list.map(a => ({ accountId: a.accountId, id: a.id, pw: a.pw, blogId: a.blogId, sessionOk: a.sessionOk })))); } catch {}
  };
  const changeCrawlAccount = (accountId: string, patch: Partial<PlaceAcct>) => setMailAccounts(list => {
    const next = list.map(a => a.accountId === accountId ? { ...a, ...patch, ...(patch.id || patch.pw ? { sessionOk: false, blogId: "" } : {}) } : a);
    savePlaceAccts(next); return next;
  });
  const connectCrawlAccount = async (accountId: string) => {
    const acc = mailAccounts.find(a => a.accountId === accountId);
    if (!acc?.id || !acc.pw) { toast("아이디와 비밀번호를 입력하세요", "info"); return; }
    setMailAccounts(list => list.map(a => a.accountId === accountId ? { ...a, loginLoading: true } : a));
    try {
      const response = await botFetch(`${BOT}/api/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ accountId, id: acc.id, pw: acc.pw }) });
      const data = await response.json();
      if (data.ok || data.success) {
        const blogId = data.blogId || acc.blogId || acc.id;
        setMailAccounts(list => { const next = list.map(a => a.accountId === accountId ? { ...a, sessionOk: true, blogId, loginLoading: false } : a); savePlaceAccts(next); return next; });
        setMailAcctId(accountId); toast(`✅ ${blogId} 연결됨`, "success");
      } else {
        setMailAccounts(list => list.map(a => a.accountId === accountId ? { ...a, sessionOk: false, loginLoading: false } : a));
        toast(data.error || "로그인 실패 — 아이디/비밀번호를 확인하세요", "error");
      }
    } catch (e: any) {
      setMailAccounts(list => list.map(a => a.accountId === accountId ? { ...a, loginLoading: false } : a));
      toast(/Failed to fetch|봇/i.test(e?.message || "") ? "봇 서버에 연결할 수 없어요(앱을 껐다 켜보세요)" : (e?.message || "연결 실패"), "error");
    } finally { try { (window as any).electron?.focusApp?.(); } catch {} }
  };
  const addCrawlAccount = () => setMailAccounts(list => [...list, { accountId: `place_acc_${Date.now()}`, id: "", pw: "", blogId: "", sessionOk: false }]);
  const removeCrawlAccount = (accountId: string) => setMailAccounts(list => {
    const next = list.filter(a => a.accountId !== accountId);
    const safe = next.length ? next : [{ accountId: "place_acc_1", id: "", pw: "", blogId: "", sessionOk: false }];
    savePlaceAccts(safe); if (mailAcctId === accountId) setMailAcctId(""); return safe;
  });

  useEffect(() => () => { searchRef.current?.close(); bloggersRef.current?.close(); }, []);
  const pushLog = (msg: string) => { onLog?.(msg); setLogs(l => [...l, `${new Date().toLocaleTimeString("ko-KR")}  ${msg}`]); };
  const requireAccount = () => {
    if (!mailAcctId || !connectedMail.some(a => a.accountId === mailAcctId)) { toast("먼저 네이버 계정을 연결하고 ◉ 라디오로 작업 계정을 선택하세요", "info"); return false; }
    return true;
  };
  const handleQuota = (d: any) => {
    if (d.type === "quota_info" || d.type === "quota_exceeded") setQuota({ used: Number(d.used) || 0, limit: Number(d.limit) || 0, remaining: Number(d.remaining) || 0 });
    if (d.type === "quota_exceeded") toast("오늘 플레이스 발굴 한도를 다 썼어요", "error");
  };
  const startSearch = () => {
    const kw = keyword.trim();
    if (!kw && !region.trim()) { toast("검색 키워드나 지역 중 하나는 입력하세요. 예: 강남 맛집", "info"); return; }
    if (!requireAccount()) return;
    searchRef.current?.close(); setRunning(true); setLogs([]); setPlaces([]); setSelectedPlaces(new Set());
    const category = CATEGORIES.find(c => c.value === domain)?.label || "";
    // 키워드를 직접 넣었으면 그대로 검색(내가 노리는 정확한 검색어의 순위 확인용).
    // 비어 있으면 기존처럼 지역+업종을 합쳐 검색.
    const query = kw || `${region.trim()}${domain === "place" ? "" : ` ${category}`}`.trim();
    pushLog(`📍 “${query}” 업체 ${count}곳을 찾기 시작해요`);
    const url = `${BOT}/api/place/search?userId=${encodeURIComponent(userId || "")}&accountId=${encodeURIComponent(mailAcctId)}&query=${encodeURIComponent(query)}&domain=${encodeURIComponent(domain)}&count=${count}`;
    const es = new BotEventStream(url); searchRef.current = es;
    es.onmessage = (event: MessageEvent) => {
      let d: any; try { d = JSON.parse(event.data); } catch { return; }
      if (d.type === "log") pushLog(d.msg);
      else if (d.type === "quota_info" || d.type === "quota_exceeded") { handleQuota(d); if (d.type === "quota_exceeded") { setRunning(false); es.close(); searchRef.current = null; } }
      else if (d.type === "place_done") { const result = (d.results || []) as Place[]; setPlaces(result); onPlacesCollected?.(result, { query, domain, measuredAt: new Date().toISOString(), surface: "네이버 지도 PC" }); setRunning(false); pushLog(`✅ 업체 ${result.length}곳을 찾았어요`); toast(`업체 ${result.length}곳 발굴 완료`, "success"); es.close(); searchRef.current = null; }
      else if (d.type === "error") { pushLog(`❌ ${d.msg || "검색 실패"}`); toast(d.msg || "검색 실패", "error"); setRunning(false); es.close(); searchRef.current = null; }
    };
    es.onerror = () => { pushLog("❌ 봇 연결 오류 — 앱을 껐다 켜보세요"); toast("봇 연결 오류", "error"); setRunning(false); es.close(); searchRef.current = null; };
  };
  const startBloggers = () => {
    if (!requireAccount()) return;
    const picked = places.filter(p => selectedPlaces.has(p.placeId)).map(p => ({ placeId: p.placeId, name: p.name }));
    if (!picked.length) { toast("먼저 업체 카드에서 한 곳 이상 체크하세요", "info"); return; }
    bloggersRef.current?.close(); setMode("bloggers"); setBloggerRunning(true); setBloggers([]); setSelectedBloggers(new Set());
    pushLog(`🧭 선택한 업체 ${picked.length}곳의 리뷰 블로거를 찾기 시작해요`);
    const perPlace = unlimitedBloggers ? 0 : bloggerTarget;   // 0 = 무제한
    const url = `${BOT}/api/place/bloggers?userId=${encodeURIComponent(userId || "")}&accountId=${encodeURIComponent(mailAcctId)}&places=${encodeURIComponent(JSON.stringify(picked))}&domain=${encodeURIComponent(domain)}&perPlace=${perPlace}`;
    const es = new BotEventStream(url); bloggersRef.current = es;
    es.onmessage = (event: MessageEvent) => {
      let d: any; try { d = JSON.parse(event.data); } catch { return; }
      if (d.type === "log") pushLog(d.msg);
      else if (d.type === "blogger" && d.blogId) setBloggers(list => {
        const fromPlace = String(d.fromPlace || "선택 업체");
        const existing = list.find(b => b.blogId === d.blogId);
        if (!existing) return [...list, { blogId: d.blogId, nick: d.nick, title: d.title, fromPlace, fromPlaces: [fromPlace] }];
        if (existing.fromPlaces.includes(fromPlace)) return list;
        return list.map(b => b.blogId === d.blogId ? { ...b, fromPlaces: [...b.fromPlaces, fromPlace] } : b);
      });
      else if (d.type === "bloggers_done") { setBloggerRunning(false); pushLog(`✅ 블로거 ${d.count ?? ""}명을 찾았어요`); toast(`블로거 ${d.count ?? ""}명 역추적 완료`, "success"); es.close(); bloggersRef.current = null; }
      else if (d.type === "error") { pushLog(`❌ ${d.msg || "역추적 실패"}`); toast(d.msg || "역추적 실패", "error"); setBloggerRunning(false); es.close(); bloggersRef.current = null; }
    };
    es.onerror = () => { pushLog("❌ 봇 연결 오류 — 앱을 껐다 켜보세요"); toast("봇 연결 오류", "error"); setBloggerRunning(false); es.close(); bloggersRef.current = null; };
  };
  const stop = (kind: "places" | "bloggers") => { const ref = kind === "places" ? searchRef : bloggersRef; ref.current?.close(); ref.current = null; kind === "places" ? setRunning(false) : setBloggerRunning(false); pushLog("⏹ 사용자가 중단했어요"); };
  const loadPlaceDetail = async (place: Place, force = false) => {
    setDetailPlace(place);
    if (!force && placeDetails[place.placeId]) return;
    if (!requireAccount()) return;
    setDetailLoading(true);
    try {
      const response = await botFetch(`${BOT}/api/place/detail?userId=${encodeURIComponent(userId || "")}&accountId=${encodeURIComponent(mailAcctId)}&placeId=${encodeURIComponent(place.placeId)}&domain=${encodeURIComponent(domain)}`);
      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error(data.error || "상세정보 확인 실패");
      setPlaceDetails(current => {
        const next = { ...current, [place.placeId]: data.detail as PlaceDetail };
        try { localStorage.setItem(detailCacheKey(userId), JSON.stringify(next)); } catch {}
        return next;
      });
      if (data.quota) setDetailQuota(data.quota);
      if (isOwnStore(place.name)) await onOwnStoreDetailViewed?.();
      toast("고객이 보는 매장 정보를 확인했어요", "success");
    } catch (e: any) { toast(e?.message || "매장 상세정보를 확인하지 못했어요", "error"); }
    finally { setDetailLoading(false); }
  };
  const csvCell = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const exportCsv = (kind: "places" | "bloggers") => {
    const placeRows = places.filter(p => !selectedPlaces.size || selectedPlaces.has(p.placeId));
    const bloggerRows = bloggers.filter(b => !selectedBloggers.size || selectedBloggers.has(b.blogId));
    const rows = kind === "places"
      ? [["업체ID", "업체명", "카테고리", "주소", "방문자리뷰", "블로그리뷰", "지도URL"], ...placeRows.map(p => [p.placeId, p.name, p.category, p.address, p.visitorReviewCount, p.blogReviewCount, p.placeUrl])]
      : [["블로그ID", "닉네임", "리뷰제목", "발견업체", "리뷰업체수", "블로그URL"], ...bloggerRows.map(b => [b.blogId, b.nick, b.title, b.fromPlaces.join(" · "), b.fromPlaces.length, `https://blog.naver.com/${b.blogId}`])];
    if (rows.length === 1) { toast("내보낼 결과가 없어요", "info"); return; }
    const blob = new Blob(["\ufeff" + rows.map(row => row.map(csvCell).join(",")).join("\r\n")], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = `publy-${kind}-${new Date().toISOString().slice(0, 10)}.csv`; a.click(); URL.revokeObjectURL(a.href);
    toast("CSV 파일을 저장했어요", "success");
  };

  const shownPlaces = useMemo(() => places
    .filter(p => placeFilter === "all" || (placeFilter === "marketing" ? needsMarketing(p) : (p.blogReviewCount || 0) >= 30))
    .sort((a, b) => placeSort === "visitors"
      ? (b.visitorReviewCount || 0) - (a.visitorReviewCount || 0)
      : placeSort === "blogs"
        ? (b.blogReviewCount || 0) - (a.blogReviewCount || 0)
        : placeScore(b) - placeScore(a)), [places, placeFilter, placeSort]);
  const multiPlaceBloggers = bloggers.filter(b => b.fromPlaces.length >= 2).length;
  const sendToCrawl = async () => {
    const rows = bloggers.filter(b => !selectedBloggers.size || selectedBloggers.has(b.blogId));
    if (!rows.length) { toast("크롤링으로 보낼 블로거를 먼저 선택하세요", "info"); return; }
    savePlaceBloggerCandidates(rows.map(b => ({ blogId: b.blogId, nick: b.nick, title: b.title, fromPlaces: b.fromPlaces })), userId);
    await onReviewerHandoff?.(rows.length);
    toast(`${rows.length}명을 크롤링 협업 제안으로 보냈어요`, "success");
    onOpenCrawl?.();
  };

  const inp = { background: theme === "dark" ? C.surf2 : "#fff", border: `1px solid ${C.line2}`, borderRadius: 11, padding: "11px 12px", fontSize: 13, fontWeight: 600, color: C.ink, width: "100%", outline: "none", fontFamily: "inherit", boxSizing: "border-box" as const };
  const card = { background: C.surf, border: `1px solid ${C.line}`, borderRadius: 18 } as const;
  const label = { fontSize: 10.5, fontWeight: 800, letterSpacing: ".12em", color: C.sub, textTransform: "uppercase" as const, marginBottom: 7 };
  const btn = { border: "none", borderRadius: 12, padding: "11px 16px", fontSize: 12.5, fontWeight: 800, cursor: "pointer", color: theme === "dark" ? "#16342c" : "#fff", fontFamily: "inherit", background: C.accent, transition: "transform .14s,filter .14s" } as const;
  const ghost = { ...btn, color: C.ink, background: "transparent", border: `1px solid ${C.line2}` } as const;
  const Help = ({ children }: { children: React.ReactNode }) => <div style={{ fontSize: 11.5, color: C.sub, lineHeight: 1.6, marginBottom: 14, display: "flex", gap: 6, alignItems: "flex-start" }}><span>💬</span><span>{children}</span></div>;
  const ActionButton = ({ children, onClick, disabled, style }: { children: React.ReactNode; onClick: () => void; disabled?: boolean; style?: React.CSSProperties }) => <button className="pc-action" onClick={onClick} disabled={disabled} style={{ ...btn, opacity: disabled ? .55 : 1, ...style }}>{children}</button>;
  // 🔢 인원/개수 입력 = 버튼 프리셋 + 직접 숫자 입력 칸(둘 다). max 지정 시 그 값으로 클램프(무제한이면 max 생략).
  const CountPicker = ({ value, onChange, presets, max, unit = "" }: { value: number; onChange: (n: number) => void; presets: number[]; max?: number; unit?: string }) => {
    const clamp = (n: number) => Math.max(1, max ? Math.min(max, n) : n);
    return (
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
        {presets.filter(p => !max || p <= max).map(p => (
          <button key={p} type="button" className="pc-action" onClick={() => onChange(clamp(p))} style={{ border: `1px solid ${value === p ? C.accent : C.line2}`, background: value === p ? C.accent : "transparent", color: value === p ? (theme === "dark" ? "#17382f" : "#fff") : C.ink, borderRadius: 10, padding: "8px 12px", fontSize: 12.5, fontWeight: 800, cursor: "pointer", fontFamily: "inherit" }}>{p}{unit}</button>
        ))}
        {max && <button key="max" type="button" className="pc-action" onClick={() => onChange(max)} title="내 등급 최대" style={{ border: `1px solid ${value === max ? C.accent : C.line2}`, background: value === max ? C.accent : "transparent", color: value === max ? (theme === "dark" ? "#17382f" : "#fff") : C.ink, borderRadius: 10, padding: "8px 12px", fontSize: 12.5, fontWeight: 800, cursor: "pointer", fontFamily: "inherit" }}>최대 {max}{unit}</button>}
        <input type="number" min={1} max={max || undefined} value={value} onChange={e => onChange(clamp(Number(e.target.value) || 1))} title="직접 숫자를 입력하세요" style={{ ...inp, width: 92, padding: "8px 10px", textAlign: "center" }} />
        {max ? <span style={{ fontSize: 11, color: C.sub }}>최대 {max}{unit}</span> : <span style={{ fontSize: 11, color: C.accent, fontWeight: 800 }}>무제한 ∞</span>}
      </div>
    );
  };

  const renderMailAccounts = () => <div style={{ padding: 14, borderRadius: 15, background: `${C.accent}0d`, border: `1px solid ${C.line2}` }}>
    <div style={{ fontSize: 12.5, fontWeight: 900, color: C.ink, marginBottom: 5 }}>👤 플레이스 작업 네이버 계정</div>
    <Help>계정을 연결한 뒤 <b style={{ color: C.accent }}>◉ 동그라미</b>를 눌러 작업 계정을 고르세요. 플레이스 전용으로 저장되어 다른 탭 계정과 섞이지 않아요.</Help>
    <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>{mailAccounts.map(a => <div key={a.accountId} style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap", padding: "8px 9px", borderRadius: 12, background: a.sessionOk ? `${C.accent}16` : C.surf, border: `1px solid ${a.sessionOk ? C.accent : C.line2}` }}>
      {a.sessionOk ? <>
        <input type="radio" name="placeAcct" checked={mailAcctId === a.accountId} onChange={() => setMailAcctId(a.accountId)} style={{ accentColor: C.accent }} />
        <span style={{ color: C.accent, fontWeight: 900, fontSize: 12 }}>✅ {a.blogId}</span><span style={{ fontSize: 10, color: C.sub }}>연결됨</span>
        <button className="pc-action" onClick={() => connectCrawlAccount(a.accountId)} disabled={a.loginLoading} title="로그인이 풀렸을 때 다시 연결해요" style={{ ...ghost, marginLeft: "auto", padding: "4px 9px", fontSize: 10.5 }}>{a.loginLoading ? "재연결 중…" : "🔄 재연결"}</button>
        <button className="pc-action" onClick={() => removeCrawlAccount(a.accountId)} title="이 계정을 목록에서 지워요" style={{ ...ghost, padding: "4px 9px", fontSize: 10.5 }}>삭제</button>
      </> : <>
        <input value={a.id} onChange={e => changeCrawlAccount(a.accountId, { id: e.target.value })} placeholder="네이버 아이디" style={{ ...inp, flex: 1, minWidth: 100, padding: "7px 9px" }} />
        <div style={{ position: "relative", flex: 1, minWidth: 100 }}><input type={showMailPw[a.accountId] ? "text" : "password"} value={a.pw} onChange={e => changeCrawlAccount(a.accountId, { pw: e.target.value })} onKeyDown={e => { if (e.key === "Enter") connectCrawlAccount(a.accountId); }} placeholder="비밀번호" style={{ ...inp, padding: "7px 34px 7px 9px" }} /><button type="button" onClick={() => setShowMailPw(s => ({ ...s, [a.accountId]: !s[a.accountId] }))} style={{ position: "absolute", right: 5, top: 6, border: 0, background: "transparent", cursor: "pointer" }}>{showMailPw[a.accountId] ? "🙈" : "👁️"}</button></div>
        <ActionButton onClick={() => connectCrawlAccount(a.accountId)} disabled={a.loginLoading || !a.id || !a.pw} style={{ padding: "8px 12px", fontSize: 11 }}>{a.loginLoading ? "연결 중…" : "🔗 연결"}</ActionButton>
        {mailAccounts.length > 1 && <button className="pc-action" onClick={() => removeCrawlAccount(a.accountId)} style={{ ...ghost, padding: "7px 9px" }}>✕</button>}
      </>}
    </div>)}<button className="pc-action" onClick={addCrawlAccount} title="플레이스 작업에 쓸 네이버 계정을 하나 더 등록해요" style={{ ...ghost, padding: "7px 11px", fontSize: 11, alignSelf: "flex-start" }}>+ 계정 추가</button></div>
  </div>;

  const activeDetail = detailPlace ? placeDetails[detailPlace.placeId] : undefined;
  const detailChecks = detailPlace ? [
    { title: "상호·업종", ok: Boolean((activeDetail || detailPlace).name && (activeDetail || detailPlace).category), action: "정확한 대표 업종을 등록하세요." },
    { title: "주소", ok: Boolean((activeDetail || detailPlace).address), action: "도로명 주소와 지도 위치를 확인하세요." },
    { title: "리뷰 현황", ok: true, action: "방문 고객에게 정직한 리뷰 참여를 안내하세요." },
    { title: "대표 사진", ok: Boolean(activeDetail?.imageUrls?.length), action: "밝고 선명한 대표 사진을 먼저 보강하세요." },
    { title: "영업시간", ok: Boolean(activeDetail?.businessHours), action: "휴무일과 주문 마감시간까지 입력하세요." },
    { title: "메뉴·가격", ok: Boolean(activeDetail?.menus?.length), action: "대표 메뉴와 실제 가격을 최신 상태로 맞추세요." },
    { title: "예약·전화·주차", ok: Boolean(activeDetail?.bookingAvailable || activeDetail?.phone || activeDetail?.conveniences?.length), action: "예약·전화·주차 가능 여부를 고객이 바로 알게 하세요." },
  ] : [];
  const detailScore = detailChecks.length ? Math.round(detailChecks.filter(item => item.ok).length / detailChecks.length * 100) : 0;

  return <div className="pc-root" style={{ background: C.bg, color: C.ink, minHeight: 500, borderRadius: 8, padding: "clamp(14px,3vw,28px)", fontFamily: "'Noto Sans KR',sans-serif", overflow: "hidden" }}>
    <style>{`@keyframes pcUp{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:none}}.pc-action:hover:not(:disabled){filter:brightness(1.08);transform:translateY(-1px)}.pc-action:active:not(:disabled){transform:translateY(1px) scale(.985)}.pc-card{animation:pcUp .35s ease both}.pc-card:hover{transform:translateY(-2px);box-shadow:0 14px 28px -22px rgba(0,0,0,.65)}@media(max-width:620px){.pc-root{padding:12px 8px 120px!important}.pc-wide{grid-column:1/-1}.pc-search-grid{grid-template-columns:1fr!important}.pc-toolbar{display:grid!important;grid-template-columns:1fr!important}.pc-toolbar>.pc-action{width:100%;min-height:48px}.pc-filter-select{width:100%!important;margin-left:0!important}.pc-card{padding:14px!important}.pc-root section:last-of-type>div[style*="overflow: hidden"]{overflow-x:auto!important;-webkit-overflow-scrolling:touch}.pc-root section:last-of-type>div[style*="overflow: hidden"]>div{min-width:520px}}`}</style>
    <div style={{ ...card, position: "relative", overflow: "hidden", padding: "22px clamp(16px,3vw,28px)", marginBottom: 15 }}>
      <div style={{ position: "absolute", width: 180, height: 180, borderRadius: "50%", right: -60, top: -80, border: `28px solid ${C.accent}12` }} />
      <div style={{ fontSize: 11, color: C.accent, fontWeight: 900, letterSpacing: ".18em", marginBottom: 7 }}>PUBLY PLACE MAP</div>
      <div style={{ fontSize: "clamp(21px,4vw,31px)", fontWeight: 900, letterSpacing: "-.04em" }}>🗺️ 동네 업체에서 블로거까지</div>
      <div style={{ color: C.sub, fontSize: 12.5, marginTop: 7, lineHeight: 1.6 }}>지역 업체를 지도처럼 모으고, 실제 리뷰를 쓴 블로거를 이어서 찾아요.</div>
    </div>

    <UsageGuide theme={theme} accent={C.accent}
      subtitle="펄리예요! 동네 업체를 찾고, 그 가게에 후기 쓴 블로거까지 찾아줄게요. 순서대로만 하면 돼요."
      steps={[
        { ico: "👤", title: "네이버 계정 연결·선택", desc: "아래 ‘작업 네이버 계정’에서 아이디·비번으로 연결하고 ◉ 동그라미로 골라요." },
        { ico: "📍", title: "① 업체 발굴", desc: "지역(예: 강남)과 업종(예: 맛집)을 고르고 START를 누르면 동네 업체가 쭉 나와요." },
        { ico: "🧭", title: "업체 고르고 → ② 블로거 역추적", desc: "마음에 드는 업체를 체크한 뒤 ‘리뷰 쓴 블로거 찾기’를 누르면 그 가게 후기 블로거가 나와요. CSV로 저장도!" },
      ]} />

    <section style={{ ...card, padding: "18px", marginBottom: 15 }}>{renderMailAccounts()}</section>

    <div style={{ display: "grid", gridTemplateColumns: "repeat(2,minmax(0,1fr))", gap: 7, background: C.surf2, borderRadius: 15, padding: 5, marginBottom: 15 }}>
      {(["places", "bloggers"] as const).map((m, i) => <button key={m} className="pc-action" onClick={() => setMode(m)} title={i ? "선택한 업체의 리뷰를 쓴 블로거 목록을 봐요" : "지역과 업종으로 업체를 찾아요"} style={{ border: 0, borderRadius: 11, padding: "11px 8px", cursor: "pointer", fontFamily: "inherit", fontWeight: 900, color: mode === m ? (theme === "dark" ? "#17382f" : "#fff") : C.sub, background: mode === m ? C.accent : "transparent" }}>{i ? `② 블로거 역추적 ${bloggers.length ? `(${bloggers.length})` : ""}` : `① 업체 발굴 ${places.length ? `(${places.length})` : ""}`}</button>)}
    </div>

    {mode === "places" ? <>
      <section style={{ ...card, padding: 19, marginBottom: 15 }}>
        <div style={{ fontSize: 17, fontWeight: 900, marginBottom: 5 }}>📍 업체 발굴</div>
        <Help><b style={{ color: C.accent }}>검색 키워드</b>에 노리는 검색어를 직접 넣으면 그 키워드로 검색해 <b style={{ color: C.ink }}>내 매장 순위</b>를 확인해요(예: “성수 브런치”, “강남역 파스타”). 비워 두면 아래 <b style={{ color: C.ink }}>지역+업종</b>을 합쳐 찾아요.</Help>
        <div style={{ marginBottom: 12 }}>
          <div style={label}>🔎 검색 키워드 · 직접 입력 <span style={{ textTransform: "none", letterSpacing: 0, fontWeight: 600 }}>(순위 확인용, 선택)</span></div>
          <input value={keyword} onChange={e => setKeyword(e.target.value)} onKeyDown={e => { if (e.key === "Enter") startSearch(); }} placeholder="예: 성수 브런치, 강남역 파스타, 부산 서면 미용실" style={{ ...inp, borderColor: keyword.trim() ? C.accent : (inp as any).borderColor }} />
        </div>
        <div className="pc-search-grid" style={{ display: "grid", gridTemplateColumns: "minmax(0,1.5fr) minmax(110px,.7fr)", gap: 10, alignItems: "end", opacity: keyword.trim() ? 0.55 : 1 }}>
          <div className="pc-wide"><div style={label}>지역</div><input value={region} onChange={e => setRegion(e.target.value)} onKeyDown={e => { if (e.key === "Enter") startSearch(); }} placeholder="예: 강남, 성수, 부산 해운대" style={inp} /></div>
          <div><div style={label}>업종</div><select value={domain} onChange={e => setDomain(e.target.value)} style={inp}>{CATEGORIES.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}</select></div>
        </div>
        <div style={{ marginTop: 12 }}><div style={label}>업체 개수 <span style={{ textTransform: "none", letterSpacing: 0, fontWeight: 600 }}>· 버튼으로 고르거나 직접 입력</span></div><CountPicker value={count} onChange={setCount} presets={[10, 20, 30, 50, 100]} unit="곳" /></div>
        <Help><b style={{ color: C.accent }}>START</b>는 위 조건으로 업체 찾기를 시작해요. 작업 계정이 선택되어 있어야 해요.</Help>
        <div className="pc-toolbar" style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>{running ? <ActionButton onClick={() => stop("places")} style={{ background: "#d45b50" }}>■ 찾기 중단</ActionButton> : <ActionButton onClick={startSearch}>📌 START · 업체 찾기</ActionButton>}<button className="pc-action" onClick={() => exportCsv("places")} title="체크한 업체만, 체크가 없으면 전체 업체를 엑셀용 파일로 저장해요" style={ghost}>CSV 내보내기</button></div>
      </section>
      <section style={{ ...card, padding: 19, marginBottom: 15 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 9, flexWrap: "wrap" }}><b style={{ fontSize: 16 }}>업체 목록 · {places.length}곳</b><span style={{ color: C.accent, fontSize: 12, fontWeight: 800 }}>현재 보기 {shownPlaces.length}곳 · 선택 {selectedPlaces.size}곳</span><button className="pc-action" onClick={() => setSelectedPlaces(selectedPlaces.size === shownPlaces.length ? new Set() : new Set(shownPlaces.map(p => p.placeId)))} title="현재 화면에 보이는 업체를 한 번에 모두 선택하거나 해제해요" style={{ ...ghost, padding: "6px 10px", marginLeft: "auto", fontSize: 11 }}>현재 목록 전체 선택/해제</button></div>
        <Help>어려운 계산은 하지 않아도 돼요. <b style={{ color: C.accent }}>홍보가 필요한 업체</b>는 방문자리뷰에 비해 블로그리뷰가 적은 곳을 자동으로 골라 보여줘요. 이것은 영업 후보를 찾기 위한 참고 추천이며 업체의 실제 사정을 단정하지 않아요.</Help>
        {places.length > 0 && <div style={{ display: "flex", gap: 7, flexWrap: "wrap", alignItems: "center", marginBottom: 13, padding: 11, borderRadius: 13, background: C.surf2, border: `1px solid ${C.line}` }}>
          {([['all','전체 업체'],['marketing','🔥 홍보가 필요한 업체'],['blogActive','✍️ 블로그 리뷰가 활발한 업체']] as const).map(([value, text]) => <button key={value} type="button" className="pc-action" onClick={() => setPlaceFilter(value)} style={{ ...ghost, padding: "7px 11px", fontSize: 11.5, background: placeFilter === value ? C.accent : "transparent", color: placeFilter === value ? (theme === "dark" ? "#17382f" : "#fff") : C.ink }}>{text}</button>)}
          <select className="pc-filter-select" value={placeSort} onChange={e => setPlaceSort(e.target.value as typeof placeSort)} aria-label="업체 정렬 기준" style={{ ...inp, width: "auto", minWidth: 150, padding: "8px 10px", marginLeft: "auto" }}><option value="recommended">추천 순서</option><option value="visitors">방문자리뷰 많은 순</option><option value="blogs">블로그리뷰 많은 순</option></select>
        </div>}
        {!places.length ? <div style={{ textAlign: "center", padding: 35, color: C.sub, fontSize: 13 }}>아직 찾은 업체가 없어요. 위에서 지역과 업종을 정해 시작하세요.</div> : !shownPlaces.length ? <div style={{ textAlign: "center", padding: 35, color: C.sub, fontSize: 13 }}>이 조건에 맞는 업체가 없어요. ‘전체 업체’를 눌러 다시 확인하세요.</div> : <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(min(100%,245px),1fr))", gap: 11 }}>{shownPlaces.map(p => <article className="pc-card" key={p.placeId} onClick={() => setSelectedPlaces(s => { const n = new Set(s); n.has(p.placeId) ? n.delete(p.placeId) : n.add(p.placeId); return n; })} style={{ minWidth: 0, padding: 15, borderRadius: 16, border: `1.5px solid ${selectedPlaces.has(p.placeId) ? C.accent : C.line}`, background: selectedPlaces.has(p.placeId) ? `${C.accent}0e` : C.surf2, cursor: "pointer", transition: "all .18s" }}>
          <div style={{ display: "flex", gap: 9, alignItems: "flex-start" }}><input type="checkbox" checked={selectedPlaces.has(p.placeId)} onChange={() => {}} style={{ accentColor: C.accent, marginTop: 4 }} /><div style={{ minWidth: 0, flex: 1 }}><div style={{ fontSize: 14.5, fontWeight: 900, overflowWrap: "anywhere" }}>{p.name}</div><div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>{isOwnStore(p.name) && <span style={{ display: "inline-block", fontSize: 10, color: "#fff", background: "#d94f8a", borderRadius: 99, padding: "3px 8px", marginTop: 6, fontWeight: 900 }}>내 가게</span>}{p.category && <span style={{ display: "inline-block", fontSize: 10, color: C.accent, background: C.accentSoft, borderRadius: 99, padding: "3px 8px", marginTop: 6, fontWeight: 800 }}>{p.category}</span>}</div></div></div>
          <div style={{ color: C.sub, fontSize: 11.5, margin: "10px 0", minHeight: 34, lineHeight: 1.5 }}>📌 {p.address || "주소 정보 없음"}</div>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", fontSize: 11, color: C.ink, fontWeight: 700 }}><span>👥 방문자리뷰 {(p.visitorReviewCount || 0).toLocaleString()}</span><span>✍️ 블로그리뷰 {(p.blogReviewCount || 0).toLocaleString()}</span></div>
          {needsMarketing(p) && <div style={{ marginTop: 9, padding: "7px 9px", borderRadius: 9, color: "#b35b00", background: "rgba(255,170,0,.13)", fontSize: 10.5, fontWeight: 900, lineHeight: 1.45 }}>🔥 홍보 제안 후보<br/><span style={{ fontWeight: 600 }}>방문자리뷰에 비해 블로그리뷰가 적어요.</span></div>}
          <div style={{ display: "flex", gap: 7, marginTop: 12, flexWrap: "wrap" }}><button type="button" className="pc-action" onClick={e => { e.stopPropagation(); loadPlaceDetail(p); }} style={{ ...ghost, padding: "7px 10px", fontSize: 11.5 }}>👀 고객 화면 보기</button><a href={p.placeUrl} target="_blank" rel="noopener noreferrer" onClick={e => e.stopPropagation()} style={{ display: "inline-flex", alignItems: "center", color: C.accent, fontSize: 11.5, fontWeight: 900 }}>실제 플레이스 ↗</a></div>
        </article>)}</div>}
        <div style={{ marginTop: 14 }}>
          <Help><b style={{ color: C.accent }}>이 업체 리뷰 쓴 블로거 찾기</b>는 체크한 업체의 리뷰 작성자를 이어서 찾아요. 업체를 먼저 골라야 해요.</Help>
          <div style={{ marginBottom: 10 }}><div style={label}>업체당 역추적 인원 <span style={{ textTransform: "none", letterSpacing: 0, fontWeight: 600 }}>· 버튼으로 고르거나 직접 입력{unlimitedBloggers ? " (무제한)" : ` (내 등급 최대 ${bloggerLimit}명)`}</span></div><CountPicker value={bloggerTarget} onChange={setBloggerTarget} presets={[5, 10, 20, 30, 50]} max={unlimitedBloggers ? undefined : bloggerLimit} unit="명" /></div>
          <ActionButton onClick={startBloggers} disabled={!selectedPlaces.size || bloggerRunning}>🧭 이 업체 리뷰 쓴 블로거 찾기 ({selectedPlaces.size})</ActionButton>
        </div>
      </section>
    </> : <section style={{ ...card, padding: 19, marginBottom: 15 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 9, flexWrap: "wrap" }}><b style={{ fontSize: 17 }}>🧭 블로거 역추적 · 중복 제거 후 {bloggers.length}명</b><span style={{ color: C.accent, fontSize: 12, fontWeight: 800 }}>여러 업체를 리뷰한 지역형 블로거 {multiPlaceBloggers}명 · 선택 {selectedBloggers.size}명</span></div>
      <Help>같은 블로거가 여러 업체에서 발견되면 한 명으로 합쳐요. <b style={{ color: C.accent }}>여러 업체 리뷰</b> 표시는 선택한 지역이나 업종을 자주 다룬 후보라는 뜻이에요. 필요한 사람을 선택한 뒤 크롤링으로 보내면 협업 제안을 이어서 준비할 수 있어요.</Help>
      <div className="pc-toolbar" style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 14 }}>{bloggerRunning ? <ActionButton onClick={() => stop("bloggers")} style={{ background: "#d45b50" }}>■ 역추적 중단</ActionButton> : <ActionButton onClick={startBloggers} disabled={!selectedPlaces.size}>다시 역추적</ActionButton>}<button className="pc-action" onClick={() => void sendToCrawl()} title="선택한 블로거를 크롤링의 협업 제안 목록으로 보내요" style={{ ...btn, background: "#d94f8a" }}>✉ 선택한 블로거 협업 제안 준비</button><button className="pc-action" onClick={() => exportCsv("bloggers")} title="체크한 블로거만, 체크가 없으면 전체 블로거를 저장해요" style={ghost}>CSV 내보내기</button><button className="pc-action" onClick={() => setSelectedBloggers(selectedBloggers.size === bloggers.length ? new Set() : new Set(bloggers.map(b => b.blogId)))} title="블로거를 모두 선택하거나 해제해요" style={ghost}>전체 선택/해제</button></div>
      {!bloggers.length ? <div style={{ textAlign: "center", padding: 40, color: C.sub }}>① 업체 발굴에서 업체를 체크한 뒤 역추적 버튼을 눌러주세요.</div> : <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(min(100%,235px),1fr))", gap: 11 }}>{bloggers.map(b => <article className="pc-card" key={b.blogId} onClick={() => setSelectedBloggers(s => { const n = new Set(s); n.has(b.blogId) ? n.delete(b.blogId) : n.add(b.blogId); return n; })} style={{ minWidth: 0, padding: 15, borderRadius: "16px 16px 16px 4px", border: `1.5px solid ${selectedBloggers.has(b.blogId) ? C.accent : C.line}`, background: selectedBloggers.has(b.blogId) ? `${C.accent}0e` : C.surf2, cursor: "pointer", transition: "all .18s" }}>
        <div style={{ display: "flex", gap: 8 }}><input type="checkbox" checked={selectedBloggers.has(b.blogId)} onChange={() => {}} style={{ accentColor: C.accent }} /><div style={{ minWidth: 0 }}><b style={{ fontSize: 14 }}>{b.nick || b.blogId}</b><div style={{ color: C.sub, fontSize: 10.5, marginTop: 2 }}>@{b.blogId}</div></div></div>
        <div style={{ fontSize: 11.5, lineHeight: 1.55, marginTop: 11, overflowWrap: "anywhere" }}>{b.title || "리뷰 제목 없음"}</div><div style={{ marginTop: 9, fontSize: 10.5, color: C.accent, fontWeight: 800 }}>📍 {b.fromPlaces.join(" · ")}에서 발견</div>{b.fromPlaces.length >= 2 && <div style={{ marginTop: 7, padding: "5px 8px", borderRadius: 8, color: "#745400", background: "rgba(255,200,0,.15)", fontSize: 10.5, fontWeight: 900 }}>⭐ 여러 업체 리뷰 · 지역형 후보</div>}
        <a href={`https://blog.naver.com/${b.blogId}`} target="_blank" rel="noopener noreferrer" onClick={e => e.stopPropagation()} style={{ display: "inline-block", marginTop: 11, color: C.accent, fontSize: 11.5, fontWeight: 900 }}>블로그 열기 ↗</a>
      </article>)}</div>}
    </section>}

    {detailPlace && <div role="dialog" aria-modal="true" aria-label={`${detailPlace.name} 매장 미리보기`} onClick={() => setDetailPlace(null)} style={{ position: "fixed", inset: 0, zIndex: 10020, display: "grid", placeItems: "center", padding: 14, background: "rgba(22,18,14,.72)", backdropFilter: "blur(7px)" }}><div onClick={e => e.stopPropagation()} style={{ width: "min(760px,100%)", maxHeight: "90vh", overflowY: "auto", borderRadius: 24, border: `1px solid ${C.line2}`, background: C.surf, boxShadow: "0 28px 90px rgba(0,0,0,.45)" }}>
      <div style={{ minHeight: 180, position: "relative", display: "grid", placeItems: "center", background: `linear-gradient(145deg,${C.accentSoft},${C.surf2})`, borderRadius: "24px 24px 0 0", overflow: "hidden" }}>{activeDetail?.imageUrls?.[0] ? <img src={activeDetail.imageUrls[0]} alt={`${activeDetail.name} 대표 공개 사진`} referrerPolicy="no-referrer" style={{ width: "100%", height: 220, objectFit: "cover" }} /> : <span style={{ fontSize: 62 }}>🏪</span>}<span style={{ position: "absolute", left: 16, bottom: 14, padding: "5px 10px", borderRadius: 99, background: "rgba(0,0,0,.65)", color: "#fff", fontSize: 10.5, fontWeight: 800 }}>{detailLoading ? "공개 정보를 확인하는 중…" : activeDetail?.imageUrls?.length ? `공개 사진 ${activeDetail.imageUrls.length}장 확인` : "대표 사진 · 아직 확인하지 않음"}</span><button type="button" onClick={() => setDetailPlace(null)} aria-label="닫기" style={{ position: "absolute", right: 13, top: 12, width: 40, height: 40, border: 0, borderRadius: "50%", background: "rgba(0,0,0,.55)", color: "#fff", cursor: "pointer", fontSize: 20 }}>×</button></div>
      <div style={{ padding: "20px clamp(15px,4vw,26px) 26px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 7, flexWrap: "wrap" }}>{isOwnStore(detailPlace.name) && <span style={{ padding: "4px 9px", borderRadius: 99, background: "#d94f8a", color: "#fff", fontSize: 10.5, fontWeight: 900 }}>내 가게</span>}<span style={{ color: C.sub, fontSize: 11 }}>{detailPlace.category || "업종 확인 필요"}</span></div>
        <h2 style={{ margin: "7px 0 6px", fontSize: 25 }}>{detailPlace.name}</h2><p style={{ margin: 0, color: C.sub, fontSize: 12.5 }}>📌 {detailPlace.address || "공개 화면에서 주소를 확인하지 못했습니다."}</p>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(2,minmax(0,1fr))", gap: 9, marginTop: 15 }}><div style={{ padding: 14, borderRadius: 14, background: C.surf2 }}><span style={{ color: C.sub, fontSize: 10.5 }}>방문자 리뷰</span><b style={{ display: "block", marginTop: 4, fontSize: 19 }}>{(detailPlace.visitorReviewCount || 0).toLocaleString()}개</b></div><div style={{ padding: 14, borderRadius: 14, background: C.surf2 }}><span style={{ color: C.sub, fontSize: 10.5 }}>블로그 리뷰</span><b style={{ display: "block", marginTop: 4, fontSize: 19 }}>{(detailPlace.blogReviewCount || 0).toLocaleString()}개</b></div></div>
        {detailLoading && <div style={{ marginTop: 15, padding: 14, borderRadius: 14, background: C.accentSoft, color: C.accent, fontWeight: 900, fontSize: 12 }}>⏳ 고객에게 보이는 사진·시간·메뉴를 확인하고 있어요. 창을 닫지 말고 잠시 기다려주세요.</div>}
        {activeDetail && <div style={{ display: "grid", gap: 8, marginTop: 14 }}>
          {activeDetail.businessHours && <div style={{ padding: 13, borderRadius: 13, background: C.surf2, fontSize: 12 }}><b>🕒 영업시간</b><div style={{ marginTop: 5, color: C.sub, whiteSpace: "pre-wrap" }}>{activeDetail.businessHours}</div></div>}
          {activeDetail.phone && <div style={{ padding: 13, borderRadius: 13, background: C.surf2, fontSize: 12 }}><b>📞 전화</b><div style={{ marginTop: 5, color: C.sub }}>{activeDetail.phone}</div></div>}
          {activeDetail.menus.length > 0 && <div style={{ padding: 13, borderRadius: 13, background: C.surf2, fontSize: 12 }}><b>🍽️ 대표 메뉴·가격</b><div style={{ display: "grid", gap: 5, marginTop: 7 }}>{activeDetail.menus.slice(0, 8).map(menu => <div key={`${menu.name}-${menu.price}`} style={{ display: "flex", justifyContent: "space-between", gap: 10 }}><span>{menu.name}</span><b>{menu.price || "가격 확인 필요"}</b></div>)}</div></div>}
          {activeDetail.conveniences.length > 0 && <div style={{ padding: 13, borderRadius: 13, background: C.surf2, fontSize: 12 }}><b>🅿️ 편의정보</b><div style={{ marginTop: 6, color: C.sub }}>{activeDetail.conveniences.join(" · ")}</div></div>}
        </div>}
        <div style={{ marginTop: 16, padding: 15, borderRadius: 15, border: `1px solid ${C.line}`, background: C.logBg }}><div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap" }}><b style={{ fontSize: 14 }}>🩺 고객 화면 정보 완성도</b><strong style={{ color: detailScore >= 80 ? C.accent : detailScore >= 55 ? "#b47b13" : "#d45b50", fontSize: 24 }}>{activeDetail ? `${detailScore}점` : "측정 전"}</strong></div><div style={{ height: 8, borderRadius: 99, background: C.surf2, overflow: "hidden", marginTop: 10 }}><div style={{ width: `${activeDetail ? detailScore : 0}%`, height: "100%", background: detailScore >= 80 ? C.accent : detailScore >= 55 ? "#e3a11a" : "#d45b50", transition: "width .35s" }} /></div><div style={{ display: "grid", gap: 7, marginTop: 11 }}>{detailChecks.map(item => <div key={item.title} style={{ display: "flex", justifyContent: "space-between", gap: 10, fontSize: 12 }}><span>{item.title}</span><b style={{ color: item.ok ? C.accent : "#b47b13", textAlign: "right" }}>{item.ok ? "공개 화면에서 확인" : activeDetail ? "확인 필요" : "아직 확인하지 않음"}</b></div>)}</div><p style={{ margin: "11px 0 0", color: C.sub, fontSize: 10.5, lineHeight: 1.6 }}>확인되지 않은 정보는 없다고 단정하지 않아요. 네이버 공개 화면에서 읽힌 항목만 표시합니다.</p></div>
        {activeDetail && detailChecks.some(item => !item.ok) && <div style={{ marginTop: 12, padding: 15, borderRadius: 15, background: "rgba(255,170,0,.10)", border: "1px solid rgba(227,161,26,.35)" }}><b style={{ fontSize: 14 }}>🚀 먼저 고칠 순서</b><div style={{ display: "grid", gap: 8, marginTop: 10 }}>{detailChecks.filter(item => !item.ok).slice(0, 3).map((item, index) => <div key={item.title} style={{ display: "grid", gridTemplateColumns: "24px 1fr", gap: 8, fontSize: 11.5, lineHeight: 1.55 }}><b style={{ color: "#b47b13" }}>{index + 1}</b><span><b>{item.title}</b> — {item.action}</span></div>)}</div><p style={{ margin: "10px 0 0", color: C.sub, fontSize: 10.5 }}>수정은 네이버 스마트플레이스에서 진행하고, 이후 다시 확인하면 달라진 공개 화면을 비교할 수 있어요.</p></div>}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(2,minmax(0,1fr))", gap: 8, marginTop: 14 }}><a href={detailPlace.placeUrl} target="_blank" rel="noopener noreferrer" className="pc-action" style={{ ...btn, textAlign: "center", textDecoration: "none" }}>네이버에서 실제 화면 보기 ↗</a><button type="button" className="pc-action" onClick={() => { setDetailPlace(null); if (!selectedPlaces.has(detailPlace.placeId)) setSelectedPlaces(s => new Set(s).add(detailPlace.placeId)); }} style={{ ...ghost }}>이 업체 분석 대상으로 선택</button></div>{activeDetail && <button type="button" className="pc-action" disabled={detailLoading} onClick={() => loadPlaceDetail(detailPlace, true)} style={{ ...ghost, width: "100%", marginTop: 8 }}>🔄 지금 공개 화면으로 다시 확인 · 1회 사용</button>}
      </div>
    </div></div>}

    {!hideLog && <section style={{ ...card, padding: 18, marginBottom: 15 }}><div style={{ fontSize: 15, fontWeight: 900, marginBottom: 5 }}>📟 진행 안내</div><Help>찾는 동안 봇이 무엇을 하고 있는지 보여줘요. 문제가 생기면 마지막 빨간 안내를 확인하세요.</Help>{quota && <div style={{ fontSize: 12, color: quota.remaining <= 0 ? "#d45b50" : C.accent, fontWeight: 900, marginBottom: 8 }}>{plan === "admin" || plan === "unlimited" ? "관리자 무제한 ∞" : `오늘 발굴 ${quota.used} / ${quota.limit} · ${quota.remaining} 남음`}</div>}<div style={{ background: C.logBg, color: C.logInk, borderRadius: 13, padding: 13, maxHeight: 150, overflowY: "auto", fontFamily: "monospace", fontSize: 11, lineHeight: 1.7, whiteSpace: "pre-wrap" }}>{logs.length ? logs.join("\n") : "작업을 시작하면 진행 내용이 여기에 나와요."}</div></section>}
    {quota && hideLog && <div style={{ fontSize: 12, color: quota.remaining <= 0 ? "#d45b50" : C.accent, fontWeight: 900, marginBottom: 12 }}>{plan === "admin" || plan === "unlimited" ? "관리자 무제한 ∞" : `오늘 발굴 ${quota.used} / ${quota.limit} · ${quota.remaining} 남음`}</div>}

    {(plan === "admin" || plan === "unlimited") ? <section style={{ ...card, padding: 18 }}><b style={{ color: C.accent }}>👑 관리자 플레이스 365 — 모든 기능 무제한</b></section> : <section style={{ ...card, padding: 18 }}><div style={{ fontSize: 15, fontWeight: 900, marginBottom: 5 }}>📋 등급별 플레이스 기능 한도</div><Help>플레이스 발굴은 크롤링 발굴과 <b style={{ color: C.ink }}>같은 하루 한도</b>를 함께 써요. 고객 화면 확인은 사진·영업시간·메뉴를 새로 읽는 작업이라 별도 횟수를 사용해요. 매일 자정에 다시 채워져요.</Help>{detailQuota && <div style={{ marginBottom: 10, padding: "8px 11px", borderRadius: 10, background: C.accentSoft, color: C.accent, fontSize: 11.5, fontWeight: 900 }}>오늘 고객 화면 확인 {detailQuota.used}/{detailQuota.limit}회 · {detailQuota.remaining}회 남음</div>}<div style={{ border: `1px solid ${C.line}`, borderRadius: 13, overflowX: "auto" }}><div style={{ minWidth: 610 }}><div style={{ display: "grid", gridTemplateColumns: "1fr .7fr .9fr 1fr 1fr", background: C.surf2 }}>{["등급", "계정", "발굴/일", "역추적/업체", "고객화면/일"].map((h, i) => <div key={h} style={{ padding: "9px 10px", fontSize: 10.5, color: C.sub, fontWeight: 900, borderLeft: i ? `1px solid ${C.line}` : "none" }}>{h}</div>)}</div>{(["free", "basic", "pro"] as const).map(pl => { const conf = PLAN_CONFIG[pl]; const current = plan === pl; const crawl = CRAWL_DAILY_LIMIT[pl] ?? conf.dailyCrawl; const blog = PLACE_BLOGGER_LIMIT[pl]; const detail = PLACE_DETAIL_DAILY_LIMIT[pl]; return <div key={pl} style={{ display: "grid", gridTemplateColumns: "1fr .7fr .9fr 1fr 1fr", borderTop: `1px solid ${C.line}`, background: current ? C.accentSoft : "transparent" }}><div style={{ padding: 10, fontSize: 12, color: current ? C.accent : C.ink, fontWeight: 900 }}>{conf.label}{current ? " (내 등급)" : ""}</div><div style={{ padding: 10, fontSize: 12, borderLeft: `1px solid ${C.line}` }}>{conf.maxAccounts}개</div><div style={{ padding: 10, fontSize: 12, borderLeft: `1px solid ${C.line}`, fontWeight: 800 }}>{crawl}곳</div><div style={{ padding: 10, fontSize: 12, borderLeft: `1px solid ${C.line}`, fontWeight: 800, color: C.accent }}>{blog}명</div><div style={{ padding: 10, fontSize: 12, borderLeft: `1px solid ${C.line}`, fontWeight: 800 }}>{detail}회</div></div>; })}</div></div><div style={{ fontSize: 10.5, color: C.sub, marginTop: 9 }}>💡 이미 확인한 매장을 다시 여는 것은 앱을 끄기 전까지 횟수를 차감하지 않아요.</div></section>}
  </div>;
}
