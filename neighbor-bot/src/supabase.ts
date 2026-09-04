import { createClient } from "@supabase/supabase-js";
import WebSocket from "ws";

// Node 20 등 native WebSocket 없는 런타임 폴리필 (Supabase Realtime 초기화 크래시 방지)
if (typeof (globalThis as any).WebSocket === "undefined") {
  (globalThis as any).WebSocket = WebSocket;
}

const SUPABASE_URL = "https://qhhoyxexxlimbjrbwrgq.supabase.co";
const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFoaG95eGV4eGxpbWJqcmJ3cmdxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzczMTMzOTQsImV4cCI6MjA5Mjg4OTM5NH0.pw_qUR0oOxgt82S_DA6GTka3WP0JBu2vmWuKZ9VvTKM";

export const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

export const koreaDateKey = () => new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit",
}).format(new Date());

/* ── 등급별 서이추 일일 한도 (프론트 src/lib/supabase.ts와 동일하게 유지!) ── */
//  ★unlimited 누락 주의: 이 키가 없으면 무제한 회원이 free(10)로 폴백돼 "오늘 한도(10명) 모두 사용"으로 막힌다(실측 버그).
export const NEIGHBOR_DAILY_LIMIT: Record<string, number> = {
  free: 10,
  basic: 50,
  pro: 100,
  unlimited: 999999,
  admin: 9999,
};
export const ENGAGE_DAILY_LIMIT: Record<string, number> = { ...NEIGHBOR_DAILY_LIMIT };
export const REPLY_DAILY_LIMIT: Record<string, number> = { ...NEIGHBOR_DAILY_LIMIT };
export const PLACE_DETAIL_DAILY_LIMIT: Record<string, number> = {
  free: 2, basic: 5, pro: 20, unlimited: 999999, admin: 999999,
};

function neighborQuotaKey(userId: string): string {
  const today = koreaDateKey();
  return `neighbor_daily_${userId}_${today}`;
}

/* ── 서이추 히스토리 저장 ── */
export async function addNeighborHistory(data: {
  user_id: string;
  keyword: string;
  target_blog_id: string;
  status: "success" | "fail" | "skip";
  message: string;
}): Promise<void> {
  try {
    await supabase.from("publy_neighbor_history").insert({
      user_id: data.user_id,
      keyword: data.keyword,
      target_blog_id: data.target_blog_id,
      target_url: `https://blog.naver.com/${data.target_blog_id}`,
      status: data.status,
      message: data.message,
    });
  } catch (e) {
    console.error("[neighbor] 히스토리 저장 오류:", e);
  }
}

// 답방 이력 저장
export async function addReplyHistory(data: {
  user_id: string;
  post_title: string;
  status: "success" | "fail" | "skip";
  message: string;
}): Promise<void> {
  try {
    await supabase.from("publy_reply_history").insert({
      user_id: data.user_id,
      post_title: data.post_title,
      status: data.status,
      message: data.message,
    });
  } catch (e) {
    console.error("[reply] 히스토리 저장 오류:", e);
  }
}

// 🗣️ 플레이스 리뷰답글 이력 저장
export async function addPlaceReplyHistory(data: {
  user_id: string;
  store_name: string;
  review_author?: string;
  rating?: number | null;
  status: "success" | "fail" | "skip";
  message: string;
}): Promise<void> {
  try {
    await supabase.from("publy_place_reply_history").insert({
      user_id: data.user_id,
      store_name: data.store_name,
      review_author: data.review_author || "",
      rating: data.rating ?? null,
      status: data.status,
      message: data.message,
    });
  } catch (e) {
    console.error("[place-reply] 히스토리 저장 오류:", e);
  }
}

// 블로그지수 진단 이력 저장
export async function addBlogscoreHistory(data: {
  user_id: string;
  blog_id: string;
  total_posts: number;
  neighbors: number;
  low_quality_suspected: boolean | null;
}): Promise<void> {
  try {
    await supabase.from("publy_blogscore_history").insert({
      user_id: data.user_id,
      blog_id: data.blog_id,
      total_posts: data.total_posts,
      neighbors: data.neighbors,
      low_quality_suspected: data.low_quality_suspected,
    });
  } catch (e) {
    console.error("[blogscore] 히스토리 저장 오류:", e);
  }
}
export async function getNeighborDailyUsage(userId: string): Promise<number> {
  try {
    const { data } = await supabase
      .from("publy_settings")
      .select("value")
      .eq("key", neighborQuotaKey(userId))
      .maybeSingle();
    return data?.value ? parseInt(data.value) || 0 : 0;
  } catch { return 0; }
}

/* ── 쿼타 체크 ── */
export async function checkNeighborQuota(userId: string, plan: string): Promise<{ ok: boolean; used: number; limit: number }> {
  const limit = NEIGHBOR_DAILY_LIMIT[plan] ?? NEIGHBOR_DAILY_LIMIT.free;
  const used = await getNeighborDailyUsage(userId);
  return { ok: used < limit, used, limit };
}

function placeDetailQuotaKey(userId: string): string {
  return `place_detail_daily_${userId}_${koreaDateKey()}`;
}
export async function checkPlaceDetailQuota(userId: string, plan: string): Promise<{ ok: boolean; used: number; limit: number }> {
  const limit = PLACE_DETAIL_DAILY_LIMIT[plan] ?? PLACE_DETAIL_DAILY_LIMIT.free;
  const { data } = await supabase.from("publy_settings").select("value").eq("key", placeDetailQuotaKey(userId)).maybeSingle();
  const used = Number.parseInt(data?.value || "0", 10) || 0;
  return { ok: used < limit, used, limit };
}
export async function incrementPlaceDetailQuota(userId: string): Promise<void> {
  const key = placeDetailQuotaKey(userId);
  const { data } = await supabase.from("publy_settings").select("value").eq("key", key).maybeSingle();
  const used = Number.parseInt(data?.value || "0", 10) || 0;
  const { error } = await supabase.from("publy_settings").upsert({ key, value: String(used + 1) }, { onConflict: "key" });
  if (error) throw new Error(`고객 화면 사용량 저장 실패: ${error.message}`);
}

/* ══ 검색유입(트래픽) 하루 한도 — 관리자/무제한만 락 해제(999999) ══ */
export const INFLOW_DAILY_LIMIT: Record<string, number> = { free: 20, basic: 50, pro: 100, unlimited: 999999, admin: 999999 };
function inflowQuotaKey(userId: string): string { return `inflow_daily_${userId}_${koreaDateKey()}`; }
export async function checkInflowQuota(userId: string, plan: string): Promise<{ ok: boolean; used: number; limit: number }> {
  const limit = INFLOW_DAILY_LIMIT[plan] ?? INFLOW_DAILY_LIMIT.free;
  const { data } = await supabase.from("publy_settings").select("value").eq("key", inflowQuotaKey(userId)).maybeSingle();
  const used = Number.parseInt(data?.value || "0", 10) || 0;
  return { ok: used < limit, used, limit };
}
export async function incrementInflowQuota(userId: string): Promise<void> {
  const key = inflowQuotaKey(userId);
  const { data } = await supabase.from("publy_settings").select("value").eq("key", key).maybeSingle();
  const used = Number.parseInt(data?.value || "0", 10) || 0;
  const { error } = await supabase.from("publy_settings").upsert({ key, value: String(used + 1) }, { onConflict: "key" });
  if (error) throw new Error(`검색유입 사용량 저장 실패: ${error.message}`);
}
// 🎯 대상(매장/블로그/상품)별 유입 통계 — 대상별 그래프·누적·리포트가 서로 섞이지 않게 분리 기록
export async function incrementInflowStat(userId: string, scope: string): Promise<void> {
  if (!scope) return;
  const key = `inflow_stat_${userId}_${scope}_${koreaDateKey()}`;
  const { data } = await supabase.from("publy_settings").select("value").eq("key", key).maybeSingle();
  const n = Number.parseInt(data?.value || "0", 10) || 0;
  await supabase.from("publy_settings").upsert({ key, value: String(n + 1) }, { onConflict: "key" }).then(({ error }) => { if (error) console.error("[inflow-stat]", error.message); });
}

export async function verifyInflowSession(token: string, claimedUserId: string): Promise<boolean> {
  if (!token || !claimedUserId) return false;
  const { data, error } = await supabase.rpc("publy_session_get", { p_token: token });
  return !error && String(data?.user?.id || "") === claimedUserId;
}

// 🔐 관리자 세션 검증 — 관리자는 회원 세션토큰이 없고 별도 관리자 토큰(publy_admin_session_get)을 쓴다.
//   body의 userId 자기신고를 믿지 않고, 검증된 관리자 토큰이 있을 때만 관리자 권한을 부여한다.
export async function verifyAdminSession(token: string): Promise<boolean> {
  if (!token) return false;
  try {
    const { data, error } = await supabase.rpc("publy_admin_session_get", { p_token: token });
    return !error && data === true;
  } catch { return false; }
}

// DB 함수가 배포된 환경에서는 검증과 한도 차감을 한 트랜잭션으로 처리한다.
const inflowQuotaLocks = new Map<string, Promise<void>>();
export async function consumeInflowQuota(token: string, userId: string, limit: number): Promise<{ ok: boolean; used: number; limit: number }> {
  const { data, error } = await supabase.rpc("publy_inflow_consume_quota", { p_token: token, p_limit: limit });
  if (error) {
    // 새 DB 함수 적용 전 구버전 서버도 중단되지 않게 하되, 한 프로세스 안에서는 반드시 직렬 차감한다.
    if (!/function.*does not exist|schema cache|PGRST202/i.test(`${error.code || ""} ${error.message || ""}`)) throw new Error(`검색유입 원자 한도 차감 실패: ${error.message}`);
    const previous = inflowQuotaLocks.get(userId) || Promise.resolve();
    let unlock = () => {};
    const current = new Promise<void>((resolve) => { unlock = resolve; });
    const queued = previous.then(() => current);
    inflowQuotaLocks.set(userId, queued);
    await previous;
    try {
      const q = await checkInflowQuota(userId, limit >= 999999 ? "unlimited" : limit >= 100 ? "pro" : limit >= 50 ? "basic" : "free");
      if (!q.ok) return q;
      await incrementInflowQuota(userId);
      return { ok: true, used: q.used + 1, limit: q.limit };
    } finally {
      unlock();
      if (inflowQuotaLocks.get(userId) === queued) inflowQuotaLocks.delete(userId);
    }
  }
  return { ok: data?.ok === true, used: Number(data?.used || 0), limit: Number(data?.limit || limit) };
}

// ✍️ 리뷰 자동작성 권한 — 기본 잠금. 관리자·무제한 플랜은 항상 허용, 그 외엔 inflow_review_enabled=true인 회원만.
export async function inflowReviewAllowed(userId?: string | null): Promise<boolean> {
  if (!userId) return false;
  if (userId === "admin-publy") return true;
  try {
    const { data } = await supabase.from("publy_users").select("plan,inflow_review_enabled").eq("id", userId).maybeSingle();
    const plan = (data as any)?.plan;
    if (plan === "admin" || plan === "unlimited") return true;   // 관리자·무제한은 락 없음
    return (data as any)?.inflow_review_enabled === true;
  } catch { return false; }
}

export async function checkMembershipAccess(userId: string, feature?: "crawl" | "place360" | "inflow"): Promise<{ ok: boolean; plan: string; reason?: string }> {
  if (userId === "admin-publy") return { ok: true, plan: "admin" };
  try {
    const [{ data: user }, { data: quota }] = await Promise.all([
      supabase.from("publy_users").select("plan,is_active,crawl_enabled,place360_enabled,inflow_enabled,inflow_review_enabled").eq("id", userId).maybeSingle(),
      supabase.from("publy_quotas").select("reset_date").eq("user_id", userId).maybeSingle(),
    ]);
    const plan = user?.plan || "free";
    if (!user || user.is_active === false) return { ok: false, plan, reason: "비활성 회원" };
    if (!quota?.reset_date || new Date(quota.reset_date).getTime() <= Date.now()) return { ok: false, plan, reason: "이용기간 만료" };
    // ★관리자·무제한은 모든 기능 잠금 예외(기본 안 잠김). 아래 개별 잠금은 일반 회원에게만 적용.
    if (plan === "admin" || plan === "unlimited") return { ok: true, plan };
    if (feature === "crawl" && user.crawl_enabled === false) return { ok: false, plan, reason: "관리자가 크롤링 사용을 잠시 중지했어요" };
    if (feature === "place360" && user.place360_enabled === false) return { ok: false, plan, reason: "관리자가 플레이스 360 사용을 잠시 중지했어요" };
    // 🔒 검색유입은 기본 잠금 — 관리자가 켠(inflow_enabled=true) 회원만
    if (feature === "inflow" && user.inflow_enabled !== true) return { ok: false, plan, reason: "검색유입은 관리자 승인 후 사용할 수 있어요" };
    return { ok: true, plan };
  } catch {
    return { ok: false, plan: "free", reason: "회원정보 확인 실패" };
  }
}

/* ── 쿼타 증가 (신청 성공 시) ── */
export async function incrementNeighborQuota(userId: string): Promise<void> {
  const key = neighborQuotaKey(userId);
  const used = await getNeighborDailyUsage(userId);
  await supabase
    .from("publy_settings")
    .upsert({ key, value: String(used + 1) }, { onConflict: "key" });
}

/* ── 공감·댓글 일일 한도(서이추와 동일 등급 한도) + 사용량/증가 ── */
function engageQuotaKey(userId: string): string {
  const today = koreaDateKey();
  return `engage_daily_${userId}_${today}`;
}
export async function getEngageDailyUsage(userId: string): Promise<number> {
  try {
    const { data } = await supabase.from("publy_settings").select("value").eq("key", engageQuotaKey(userId)).maybeSingle();
    return data?.value ? parseInt(data.value) || 0 : 0;
  } catch { return 0; }
}
export async function incrementEngageQuota(userId: string): Promise<void> {
  const key = engageQuotaKey(userId);
  const used = await getEngageDailyUsage(userId);
  await supabase.from("publy_settings").upsert({ key, value: String(used + 1) }, { onConflict: "key" });
}

function replyQuotaKey(userId: string): string {
  return `reply_daily_${userId}_${koreaDateKey()}`;
}
export async function getReplyDailyUsage(userId: string): Promise<number> {
  const { data } = await supabase.from("publy_settings").select("value").eq("key", replyQuotaKey(userId)).maybeSingle();
  return Number.parseInt(data?.value || "0", 10) || 0;
}
export async function incrementReplyQuota(userId: string): Promise<void> {
  const key = replyQuotaKey(userId);
  const used = await getReplyDailyUsage(userId);
  await supabase.from("publy_settings").upsert({ key, value: String(used + 1) }, { onConflict: "key" });
}

// 🗣️ 플레이스 리뷰답글 일일 한도(자정 리셋)
export const PLACE_REPLY_DAILY_LIMIT: Record<string, number> = {
  free: 3, basic: 10, pro: 20, unlimited: 999999, admin: 9999,
};
function placeReplyQuotaKey(userId: string): string {
  return `place_reply_daily_${userId}_${koreaDateKey()}`;
}
export async function getPlaceReplyDailyUsage(userId: string): Promise<number> {
  const { data } = await supabase.from("publy_settings").select("value").eq("key", placeReplyQuotaKey(userId)).maybeSingle();
  return Number.parseInt(data?.value || "0", 10) || 0;
}
export async function incrementPlaceReplyQuota(userId: string): Promise<void> {
  const key = placeReplyQuotaKey(userId);
  const used = await getPlaceReplyDailyUsage(userId);
  await supabase.from("publy_settings").upsert({ key, value: String(used + 1) }, { onConflict: "key" });
}

// 품앗이 하루 사용량(공감·댓글 총건수) — 자정 자동 리셋
function pumasiQuotaKey(userId: string): string {
  const today = koreaDateKey();
  return `pumasi_daily_${userId}_${today}`;
}
export async function getPumasiDailyUsage(userId: string): Promise<number> {
  try {
    const { data } = await supabase.from("publy_settings").select("value").eq("key", pumasiQuotaKey(userId)).maybeSingle();
    return data?.value ? parseInt(data.value) || 0 : 0;
  } catch { return 0; }
}
export async function incrementPumasiQuota(userId: string): Promise<void> {
  const key = pumasiQuotaKey(userId);
  const used = await getPumasiDailyUsage(userId);
  await supabase.from("publy_settings").upsert({ key, value: String(used + 1) }, { onConflict: "key" });
}

// ── 제목 수정 하루 한도(쓰기 작업이라 지수 검사와 별도) — 무료3·베10·프30·무제한∞ ──
export const TITLE_EDIT_DAILY_LIMIT: Record<string, number> = {
  free: 3, basic: 10, pro: 30, unlimited: 999999, admin: 999999,
};
function titleEditQuotaKey(userId: string): string {
  const today = koreaDateKey();
  return `titleedit_daily_${userId}_${today}`;
}
export async function getTitleEditDailyUsage(userId: string): Promise<number> {
  try {
    const { data } = await supabase.from("publy_settings").select("value").eq("key", titleEditQuotaKey(userId)).maybeSingle();
    return data?.value ? parseInt(data.value) || 0 : 0;
  } catch { return 0; }
}
export async function incrementTitleEditQuota(userId: string): Promise<void> {
  const key = titleEditQuotaKey(userId);
  const used = await getTitleEditDailyUsage(userId);
  await supabase.from("publy_settings").upsert({ key, value: String(used + 1) }, { onConflict: "key" });
}

/* ── 회원 플랜 조회 ── */
export async function getUserPlan(userId: string): Promise<string> {
  return (await checkMembershipAccess(userId)).plan;
}

/* ── 관리자 블로그 검색 API 키 조회 ── */
export async function getAdminBlogSearchKeys(): Promise<{ clientId: string; clientSecret: string } | null> {
  try {
    const { data: idRow } = await supabase
      .from("publy_settings")
      .select("value")
      .eq("key", "admin_naver_datalab_client_id")
      .maybeSingle();
    const { data: secRow } = await supabase
      .from("publy_settings")
      .select("value")
      .eq("key", "admin_naver_datalab_client_secret")
      .maybeSingle();
    if (!idRow?.value || !secRow?.value) return null;
    return { clientId: idRow.value, clientSecret: secRow.value };
  } catch {
    return null;
  }
}

export interface PublyJob {
  id: string;
  user_id: string;
  platform: "naver" | "tistory";
  title: string;
  content: string;
  tags: string[];
  image_prompt?: string;
  status: "pending" | "running" | "success" | "fail";
  result_url?: string;
  error?: string;
  created_at: string;
}

export async function fetchPendingJobs(userId: string): Promise<PublyJob[]> {
  const { data, error } = await supabase
    .from("publy_jobs")
    .select("*")
    .eq("user_id", userId)
    .eq("status", "pending")
    .order("created_at", { ascending: true })
    .limit(5);
  if (error) return [];
  return data || [];
}

export async function fetchAllPendingJobs(userIds: string[]): Promise<PublyJob[]> {
  if (!userIds.length) return [];
  const { data, error } = await supabase
    .from("publy_jobs")
    .select("*")
    .in("user_id", userIds)
    .eq("status", "pending")
    .order("created_at", { ascending: true })
    .limit(10);
  if (error) return [];
  return data || [];
}

export async function updateJob(id: string, update: Partial<PublyJob>) {
  await supabase.from("publy_jobs").update(update).eq("id", id);
}

export async function addHistory(params: {
  user_id: string;
  platform: string;
  title: string;
  post_url?: string;
  status: "success" | "fail";
  error_message?: string;
}) {
  await supabase.from("publy_history").insert({
    ...params,
    published_at: new Date().toISOString(),
  });
}

/* ── 프록시(계정별 IP) ──
   IP가 계속 같은 곳에서 나가면 네이버가 여러 계정을 한 사람으로 묶어 차단한다.
   계정마다 배정된 프록시로 브라우저를 띄우기 위한 조회 헬퍼.
   업체와 무관: server(host:port)·username·password 4개만 있으면 Playwright가 그대로 사용. */
export interface ProxyConfig { server: string; username?: string; password?: string }
const _proxyCache = new Map<string, { proxy: ProxyConfig | null; ts: number }>();
const PROXY_CACHE_MS = 60000;

// server 문자열에 스킴이 없으면 http:// 를 붙여 Playwright가 인식하게 정규화
function normalizeProxyServer(server: string): string {
  const s = (server || "").trim();
  if (!s) return s;
  return /^(https?|socks[45]?):\/\//i.test(s) ? s : `http://${s}`;
}

// 특정 user_id(계정 또는 회원)에 배정된 프록시를 조회. feature 토글 반영.
async function _lookupProxy(userId: string, feature?: string): Promise<ProxyConfig | null> {
  const key = `${userId}::${feature || ""}`;
  const cached = _proxyCache.get(key);
  if (cached && Date.now() - cached.ts < PROXY_CACHE_MS) return cached.proxy;
  try {
    const { data: map } = await supabase
      .from("publy_account_proxy")
      .select("proxy_id, features")
      .eq("user_id", userId)
      .maybeSingle();
    let proxy: ProxyConfig | null = null;
    // 기능 토글: feature가 주어졌는데 그 계정의 프록시 사용 기능 목록에 없으면 프록시 미적용(내 IP로).
    const features: string[] = Array.isArray((map as any)?.features) ? (map as any).features : [];
    const featureOk = !feature || features.includes(feature);
    if (map?.proxy_id && featureOk) {
      const { data: px } = await supabase
        .from("publy_proxies")
        .select("server, username, password, active")
        .eq("id", map.proxy_id)
        .maybeSingle();
      if (px?.server && px.active !== false) {
        // ★복붙 공백·개행 제거(인증 조용히 실패 방지). id는 내부 공백까지, pw는 앞뒤만.
        proxy = {
          server: normalizeProxyServer(px.server),
          username: (px.username || "").replace(/[\s]+/g, "") || undefined,
          password: (px.password || "").trim() || undefined,
        };
      }
    }
    _proxyCache.set(key, { proxy, ts: Date.now() });
    return proxy;
  } catch {
    return null;
  }
}

// 계정(accountId)에 직접 배정된 프록시 우선, 없으면 그 계정을 쓰는 회원(ownerUserId)에 배정된 프록시를 쓴다.
//   → 관리자가 "회원"에게 프록시를 배정하면, 그 회원이 어느 계정으로 돌리든 프록시가 적용된다.
export async function getProxyForAccount(userId?: string | null, feature?: string, ownerUserId?: string | null): Promise<ProxyConfig | null> {
  // ★크롤링은 accountId=""(공개검색)이라 userId가 비어도 ownerUserId(회원 배정)로 프록시를 찾아야 한다.
  let proxy: ProxyConfig | null = null;
  if (userId) proxy = await _lookupProxy(userId, feature);
  if (!proxy && ownerUserId && ownerUserId !== userId) proxy = await _lookupProxy(ownerUserId, feature);
  // 🔒 프록시는 기본 — 배정이 없어도 기본 프록시로 항상 연결(테리: 프록시 항상 ON).
  //    크레덴셜은 코드가 아니라 DB(publy_settings.default_inflow_proxy)에서 읽어 공개레포 노출 방지.
  if (!proxy) proxy = await getDefaultProxy();
  if (proxy) incrementProxyUsage().catch(() => {});   // 🌐 프록시 접속 카운트(B, 사용량 실시간 체크)
  return proxy;
}

// 🔒 기본 프록시(모든 회원 공통 폴백) — publy_settings.default_inflow_proxy 의 JSON
//    { "server":"gw.dataimpulse.com:823", "username":"...", "password":"..." }
let _defaultProxyCache: { proxy: ProxyConfig | null; ts: number } | null = null;
async function getDefaultProxy(): Promise<ProxyConfig | null> {
  if (_defaultProxyCache && Date.now() - _defaultProxyCache.ts < PROXY_CACHE_MS) return _defaultProxyCache.proxy;
  let proxy: ProxyConfig | null = null;
  try {
    const { data } = await supabase.from("publy_settings").select("value").eq("key", "default_inflow_proxy").maybeSingle();
    if (data?.value) {
      // value가 jsonb면 이미 객체, text면 문자열 → 둘 다 안전 처리
      const p = typeof data.value === "string" ? JSON.parse(data.value) : data.value;
      if (p && p.server) proxy = { server: normalizeProxyServer(p.server), username: p.username || undefined, password: p.password || undefined };
    }
  } catch {}
  _defaultProxyCache = { proxy, ts: Date.now() };
  return proxy;
}

// 🌐 프록시 사용량 카운트 — 오늘 접속 횟수(관리자 프록시 탭에서 표시). 로깅 실패가 본 로직 안 막게 삼킴.
export async function incrementProxyUsage(): Promise<void> {
  try {
    const key = `proxy_usage_${koreaDateKey()}`;
    const { data } = await supabase.from("publy_settings").select("value").eq("key", key).maybeSingle();
    const used = Number.parseInt(data?.value || "0", 10) || 0;
    await supabase.from("publy_settings").upsert({ key, value: String(used + 1) }, { onConflict: "key" });
  } catch { /* ignore */ }
}

export function clearProxyCache(userId?: string): void {
  if (userId) { for (const k of Array.from(_proxyCache.keys())) if (k.startsWith(`${userId}::`)) _proxyCache.delete(k); }
  else _proxyCache.clear();
}

export async function useQuota(userId: string): Promise<boolean> {
  const { data } = await supabase
    .from("publy_quotas")
    .select("*")
    .eq("user_id", userId)
    .single();
  if (!data || data.remaining_quota <= 0) return false;

  const { data: updated } = await supabase
    .from("publy_quotas")
    .update({ used_quota: data.used_quota + 1 })
    .eq("user_id", userId)
    .eq("used_quota", data.used_quota)
    .select("id");

  return !!(updated && updated.length > 0);
}

// ═══════════════════════════════════════════════════════════════════
// 📧 아웃리치(체험단 제안) — 발신 계정 + 보낸글 이력
// ═══════════════════════════════════════════════════════════════════
export interface OutreachSender {
  user_id: string; from_name?: string; from_email: string;
  smtp_host: string; smtp_port: number; smtp_user: string; smtp_pass: string; daily_limit: number;
}
export async function getOutreachSender(userId: string): Promise<OutreachSender | null> {
  const { data } = await supabase.from("publy_outreach_sender").select("*").eq("user_id", userId).maybeSingle();
  return (data as OutreachSender) || null;
}
// 오늘 이 회원이 보낸 이메일 수(하루 제한 체크용)
export async function getOutreachSentToday(userId: string): Promise<number> {
  const start = new Date(); start.setHours(0, 0, 0, 0);
  const { count } = await supabase.from("publy_outreach")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId).eq("channel", "email").eq("status", "sent")
    .gte("sent_at", start.toISOString());
  return count || 0;
}
export async function addOutreachLog(row: {
  user_id: string; blog_id: string; nickname?: string; channel: string;
  to_email?: string; subject?: string; message?: string; status: string; error?: string;
}): Promise<void> {
  const { error } = await supabase.from("publy_outreach").insert(row);
  if (error) console.warn("[outreach] 이력 저장 실패:", error.message);
}
