import express from "express";
import cors from "cors";
import { saveSession, sessionExists, removeSession, crawlBlogIds, crawlBuddyPosts, analyzeBuddyKeywords, addNeighbors, NeighborResult, donePath, engageBlogs, EngageResult, engageDonePath, crawlMyPosts, crawlPublicPosts, replyToComments, crawlPlaceReviews, generatePlaceReviewReply, replyToPlaceReviews, crawlBlogStats, checkSelectedBlogExposure, pumasiEngage, crawlPumasiReport, pumasiPreview, updatePostTitle, checkProxy, analyzeBlogAuthenticity, fetchPostBody, crawlPostViews, sendWebmail, sendBlogComments, crawlPlaces, crawlPlaceBloggers, crawlPlaceDetail, crawlPlaceByUrl, suggestPlaceKeywords, parsePlaceUrl, resolvePlaceUrl, searchInflow, diagnosePlace, diagnoseStore, measurePlaceRank, measureBlogRank, collectPlaceReviews, InflowTarget } from "./naver";
import { checkNeighborQuota, incrementNeighborQuota, getNeighborDailyUsage, incrementEngageQuota, getEngageDailyUsage, getUserPlan, checkMembershipAccess, NEIGHBOR_DAILY_LIMIT, ENGAGE_DAILY_LIMIT, REPLY_DAILY_LIMIT, getReplyDailyUsage, incrementReplyQuota, PLACE_REPLY_DAILY_LIMIT, getPlaceReplyDailyUsage, incrementPlaceReplyQuota, addNeighborHistory, addReplyHistory, addPlaceReplyHistory, addBlogscoreHistory, incrementPumasiQuota, TITLE_EDIT_DAILY_LIMIT, getTitleEditDailyUsage, incrementTitleEditQuota, getProxyForAccount, supabase, getOutreachSender, getOutreachSentToday, addOutreachLog, checkPlaceDetailQuota, incrementPlaceDetailQuota, checkInflowQuota, incrementInflowQuota, incrementInflowStat, inflowReviewAllowed, verifyInflowSession, verifyAdminSession, consumeInflowQuota, INFLOW_DAILY_LIMIT, getTrafficLicenseForTool } from "./supabase";
import nodemailer from "nodemailer";
import fs from "fs";
import { acquireAccountLock } from "./account-lock";

const app = express();
const PORT = Number(process.env.PUBLY_BOT_PORT) || 3364;
const AUTH_TOKEN = process.env.BOT_AUTH_TOKEN || "";

app.use(cors({ origin: ["http://localhost:5173", "http://127.0.0.1:5173", "null"] }));
app.use(express.json({ limit: "50mb" }));
app.use((req, res, next) => {
  if (!AUTH_TOKEN) return next();
  if (req.get("Authorization") === `Bearer ${AUTH_TOKEN}`) return next();
  res.status(401).json({ error: "Unauthorized" });
});

/* ── 헬스체크 ── */
app.get("/health", (_req, res) => {
  res.json({ ok: true, version: "1.0.0", service: "neighbor-bot" });
});

/* ── 세션 상태 ── */
app.get("/api/session/:accountId", (req, res) => {
  const { accountId } = req.params;
  res.json({ exists: sessionExists(accountId) });
});

/* ── 세션 삭제 (계정 삭제) ── */
app.delete("/api/session/:accountId", (req, res) => {
  try { removeSession(req.params.accountId); res.json({ ok: true }); }
  catch (e: any) { res.status(500).json({ ok: false, error: e.message }); }
});

/* ── 내 이웃 키워드 분석 (이웃들이 자주 쓰는 주제) ── */
app.get("/api/buddy-keywords/:accountId", async (req, res) => {
  const { accountId } = req.params;
  if (!sessionExists(accountId)) return res.status(400).json({ error: "계정 연결 필요" });
  try {
    const keywords = await analyzeBuddyKeywords({ accountId, scanCount: 120 });
    res.json({ ok: true, keywords });
  } catch (e: any) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

/* ── 로그인 (세션 저장) ── */
app.post("/api/login", async (req, res) => {
  const { accountId, id, pw } = req.body;
  if (!accountId || !id || !pw)
    return res.status(400).json({ success: false, error: "accountId, id, pw 필요" });
  try {
    const result = await saveSession(accountId, id, pw);
    res.json({ success: true, blogId: result.blogId });
  } catch (e: any) {
    res.status(500).json({ success: false, error: e.message });
  }
});

/* ── 쿼타 조회 ── */
app.get("/api/quota/:userId", async (req, res) => {
  const { userId } = req.params;
  try {
    const plan = await getUserPlan(userId);
    const used = await getNeighborDailyUsage(userId);
    const limit = NEIGHBOR_DAILY_LIMIT[plan] ?? NEIGHBOR_DAILY_LIMIT.free;
    res.json({ ok: true, used, limit, plan, remaining: Math.max(0, limit - used) });
  } catch (e: any) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

/* ── SSE 헬퍼 ── */
function sseSetup(res: express.Response) {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();
}
function sseSend(res: express.Response, data: object) {
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

async function ensureActiveMember(userId: string | undefined, res: express.Response, feature?: "crawl" | "place360" | "inflow"): Promise<boolean> {
  if (!userId) return true;
  const access = await checkMembershipAccess(userId, feature);
  if (access.ok) return true;
  sseSend(res, { type: "error", msg: access.reason || "회원 이용권을 확인해주세요", membershipBlocked: true });
  res.end();
  return false;
}

function acquireAccountsOrReport(accountIds: string[], owner: string, res: express.Response): (() => void) | null {
  const releases: Array<() => void> = [];
  for (const accountId of [...new Set(accountIds.filter(Boolean))].sort()) {
    const lock = acquireAccountLock(accountId, owner);
    if (!lock.ok) {
      releases.reverse().forEach(release => release());
      sseSend(res, { type: "error", msg: `같은 네이버 계정에서 '${lock.owner}' 작업이 진행 중이에요. 완료 후 다시 시도해주세요.`, accountBusy: true });
      res.end();
      return null;
    }
    releases.push(lock.release);
  }
  return () => releases.reverse().forEach(release => release());
}

/* ── 작업 중단 신호 맵 ── */
const stopMap = new Map<string, boolean>();

/* ── 기능별 작업 정리: 같은 탭의 이전 작업만 중단하고 다른 탭 작업은 보존한다. ── */
const activeJobs = new Map<string, string>();
function stopActiveLane(lane: string, exceptJid?: string) {
  for (const [j, activeLane] of activeJobs) {
    if (activeLane === lane && j !== exceptJid) {
      stopMap.set(j, true);
      activeJobs.delete(j);
    }
  }
}
// SSE 작업 시작 등록: 이전 작업 자동 중단 + 클라이언트 연결 끊기면 자동 중단(기능 전환/탭이동에도 안전)
//   ★ req.on("close")는 POST body 수신 완료 시점에도 발동 → 자기 작업을 즉시 중단시키는 버그.
//     실제 "연결 끊김"은 res.on("close")로 감지해야 함.
function beginJob(jid: string, lane: string, res: express.Response) {
  stopActiveLane(lane);
  stopMap.set(jid, false);
  activeJobs.set(jid, lane);
  res.on("close", () => { stopMap.set(jid, true); activeJobs.delete(jid); }); // 화면 벗어남/전환 시 자동 중단
}
function endJob(jid: string) {
  activeJobs.delete(jid);
  stopMap.delete(jid);
}

app.post("/api/stop/:jobId", (req, res) => {
  stopMap.set(req.params.jobId, true);
  res.json({ ok: true });
});

/* ── 블로그 수집 (SSE) ── */
app.get("/api/crawl", async (req, res) => {
  const { userId, accountId, keywords, countPerKeyword, orderBy, activeDays, excludeMarket } = req.query as Record<string, string>;
  if (!keywords)
    return res.status(400).json({ error: "keywords 필요" });

  sseSetup(res);

  try {
    if (!await ensureActiveMember(userId, res, "crawl")) return;
    // 쿼타 체크 (userId 있을 때만)
    if (userId) {
      const plan = await getUserPlan(userId);
      const quota = await checkNeighborQuota(userId, plan);
      if (!quota.ok) {
        sseSend(res, { type: "quota_exceeded", used: quota.used, limit: quota.limit });
        res.end();
        return;
      }
      sseSend(res, { type: "quota_info", used: quota.used, limit: quota.limit, remaining: quota.limit - quota.used });
    }

    const kwList = keywords.split(/[,\n]/).map((k) => k.trim()).filter(Boolean);
    const count = parseInt(countPerKeyword || "30", 10);

    const results = await crawlBlogIds({
      accountId: accountId || "",   // ★선택한 작업 계정 → 그 계정 배정 프록시로 접속(미선택이면 익명+회원 프록시)
      keywords: kwList,
      countPerKeyword: count,
      orderBy: orderBy === "sim" ? "sim" : "recentdate",
      activeDays: activeDays ? parseInt(activeDays, 10) : 0,
      excludeMarket: excludeMarket !== "false",
      ownerUserId: userId || null,   // 🔒 크롤링 프록시: 이 회원에 crawl 토글이 켜져 있으면 그 IP로 접속
      onLog: (msg) => sseSend(res, { type: "log", msg }),
    });

    sseSend(res, { type: "crawl_done", results });
  } catch (e: any) {
    sseSend(res, { type: "error", msg: e.message });
  }
  res.end();
});

/* ── 🗺️ 플레이스 업체 발굴 (SSE) ── */
app.get("/api/place/search", async (req, res) => {
  const { userId, accountId, query, domain, count } = req.query as Record<string, string>;
  if (!query) return res.status(400).json({ error: "query 필요" });
  sseSetup(res);
  let releaseAccount = () => {};
  try {
    if (!await ensureActiveMember(userId, res, "place360")) return;
    const release = acquireAccountsOrReport([accountId || ""], "플레이스 업체 발굴", res);
    if (!release) return;
    releaseAccount = release;
    // 크롤링과 같은 발굴 쿼타 사용(플레이스도 발굴이므로)
    if (userId) {
      const plan = await getUserPlan(userId);
      const quota = await checkNeighborQuota(userId, plan);
      if (!quota.ok) { sseSend(res, { type: "quota_exceeded", used: quota.used, limit: quota.limit }); res.end(); return; }
      sseSend(res, { type: "quota_info", used: quota.used, limit: quota.limit, remaining: quota.limit - quota.used });
    }
    const results = await crawlPlaces({
      accountId: accountId || "",
      query,
      domain: domain || "place",
      count: parseInt(count || "30", 10),
      ownerUserId: userId || null,
      onLog: (msg) => sseSend(res, { type: "log", msg }),
    });
    sseSend(res, { type: "place_done", results });
  } catch (e: any) {
    sseSend(res, { type: "error", msg: e.message });
  } finally {
    releaseAccount();
  }
  res.end();
});

/* ── 🏪 플레이스 고객화면 상세정보 (기존 발굴 쿼타와 별도, 계정 동시사용 방지) ── */
app.get("/api/place/detail", async (req, res) => {
  const { userId, accountId, placeId, domain } = req.query as Record<string, string>;
  if (!placeId || !accountId) return res.status(400).json({ ok: false, error: "매장과 작업 계정을 먼저 선택하세요" });
  if (userId) {
    const access = await checkMembershipAccess(userId, "place360");
    if (!access.ok) return res.status(403).json({ ok: false, error: access.reason || "플레이스 360 이용권을 확인해주세요", membershipBlocked: true });
  }
  const plan = userId ? await getUserPlan(userId) : "free";
  const quota = userId ? await checkPlaceDetailQuota(userId, plan) : { ok: true, used: 0, limit: 999999 };
  if (!quota.ok) return res.status(429).json({ ok: false, error: `오늘 고객 화면 확인 ${quota.limit}회를 모두 사용했어요`, quota });
  const release = acquireAccountsOrReport([accountId], "플레이스 상세 확인", res);
  if (!release) return;
  try {
    const detail = await crawlPlaceDetail({ accountId, placeId, domain: domain || "place", ownerUserId: userId || null });
    if (userId) await incrementPlaceDetailQuota(userId);
    res.json({ ok: true, detail, quota: { used: quota.used + 1, limit: quota.limit, remaining: Math.max(0, quota.limit - quota.used - 1) } });
  } catch (e: any) {
    res.status(500).json({ ok: false, error: e.message || "매장 상세정보를 확인하지 못했어요" });
  } finally {
    release();
  }
});

/* ── 🔎 주소만 붙여넣어도 내 매장 바로 불러오기(플레이스 360 매장 등록용) ──
   공개 페이지만 읽으므로 로그인 계정·상세확인 쿼타·계정 잠금 불필요.
   주소 → 이름·업종·주소를 자동으로 당겨와 매장 등록칸을 채운다. */
app.get("/api/place/resolve", async (req, res) => {
  const { userId, placeUrl } = req.query as Record<string, string>;
  if (!placeUrl) return res.status(400).json({ ok: false, error: "플레이스 주소를 입력하세요" });
  try {
    if (userId) {
      const access = await checkMembershipAccess(userId, "place360");
      if (!access.ok) return res.status(403).json({ ok: false, error: access.reason || "플레이스 360 이용권을 확인해주세요", membershipBlocked: true });
    }
    const detail = await crawlPlaceByUrl({ placeUrl, ownerUserId: userId || null });
    res.json({ ok: true, detail });
  } catch (e: any) {
    res.status(500).json({ ok: false, error: e.message || "매장 정보를 불러오지 못했어요" });
  }
});

/* ── 🎯 플레이스 키워드 발굴(자동완성+연관검색) — 계정 불필요 공개 소스 ── */
app.get("/api/place/keywords", async (req, res) => {
  const { userId, seeds } = req.query as Record<string, string>;
  try {
    if (userId) {
      const access = await checkMembershipAccess(userId, "place360");
      if (!access.ok) return res.status(403).json({ ok: false, error: access.reason || "플레이스 360 이용권을 확인해주세요", membershipBlocked: true });
    }
    let seedList: string[] = [];
    try { seedList = JSON.parse(seeds || "[]"); } catch {}
    if (!Array.isArray(seedList) || !seedList.length) return res.status(400).json({ ok: false, error: "키워드 시드가 필요해요" });
    const keywords = await suggestPlaceKeywords({ seeds: seedList });
    res.json({ ok: true, keywords });
  } catch (e: any) {
    res.status(500).json({ ok: false, error: e.message || "키워드 발굴 실패" });
  }
});

/* ── 🗺️ 플레이스 업체 → 블로그 리뷰어 역추적 (SSE) ── */
app.get("/api/place/bloggers", async (req, res) => {
  const { userId, accountId, places, domain, perPlace } = req.query as Record<string, string>;
  sseSetup(res);
  let releaseAccount = () => {};
  try {
    if (!await ensureActiveMember(userId, res, "place360")) return;
    const release = acquireAccountsOrReport([accountId || ""], "플레이스 리뷰어 역추적", res);
    if (!release) return;
    releaseAccount = release;
    let list: { placeId: string; name?: string }[] = [];
    try { list = JSON.parse(places || "[]"); } catch {}
    list = list.filter(p => p && p.placeId).slice(0, 40);   // 과부하 방지
    const maxPerPlace = parseInt(perPlace || "0", 10) || 0;   // 등급 상한(0=무제한)
    const seen = new Set<string>();
    for (const p of list) {
      const hits = await crawlPlaceBloggers({ accountId: accountId || "", placeId: p.placeId, domain: domain || "place", maxPerPlace, ownerUserId: userId || null, onLog: (msg) => sseSend(res, { type: "log", msg }) });
      for (const h of hits) {
        const duplicate = seen.has(h.blogId);
        if (!duplicate) seen.add(h.blogId);
        // 최종 명단은 기존처럼 blogId 기준 한 명으로 유지하되,
        // 다른 업체에서도 발견됐다는 정보는 UI가 합칠 수 있도록 전달한다.
        sseSend(res, { type: "blogger", ...h, fromPlace: p.name || p.placeId, duplicate });
      }
      await new Promise(rs => setTimeout(rs, 300));
    }
    sseSend(res, { type: "bloggers_done", count: seen.size });
  } catch (e: any) {
    sseSend(res, { type: "error", msg: e.message });
  } finally {
    releaseAccount();
  }
  res.end();
});

/* ── 서이추 신청 (SSE) ── */
app.post("/api/add-neighbor", async (req, res) => {
  const {
    userId, accountId, targets: targetsRaw, message,
    delayMin, delayMax, skipDone, qualityFilter, retryDays, minVisitors, maxVisitors, searchEntry, jobId,
  } = req.body as Record<string, any>;

  if (!accountId || !targetsRaw)
    return res.status(400).json({ error: "accountId, targets 필요" });

  sseSetup(res);

  const jid = jobId || Date.now().toString();
  beginJob(jid, "neighbor", res);
  let releaseAccounts = () => {};

  try {
    if (!await ensureActiveMember(userId, res)) { endJob(jid); return; }
    // targets는 이제 body로 배열째 옴 (문자열이면 파싱 폴백)
    const targets = Array.isArray(targetsRaw) ? targetsRaw : JSON.parse(decodeURIComponent(targetsRaw));

    // 쿼타 체크 (userId 있을 때)
    let dailyLimit = 100;
    if (userId) {
      const plan = await getUserPlan(userId);
      const quota = await checkNeighborQuota(userId, plan);
      dailyLimit = quota.limit - quota.used; // 오늘 남은 한도만큼
      if (dailyLimit <= 0) {
        sseSend(res, { type: "quota_exceeded", used: quota.used, limit: quota.limit });
        res.end();
        return;
      }
      sseSend(res, { type: "quota_info", used: quota.used, limit: quota.limit, remaining: dailyLimit });
    }

    const release = acquireAccountsOrReport([accountId], "서이추", res);
    if (!release) { endJob(jid); return; }
    releaseAccounts = release;

    await addNeighbors({
      accountId,
      ownerUserId: userId,
      targets,
      message: message || "안녕하세요! 좋은 글 잘 읽고 갑니다. 서이추 신청드려요 😊",
      delayMin: parseFloat(String(delayMin ?? "5")),
      delayMax: parseFloat(String(delayMax ?? "10")),
      dailyLimit,
      skipDone: skipDone === true || skipDone === "true",
      qualityFilter: qualityFilter !== false && qualityFilter !== "false",   // 기본 ON
      retryDays: retryDays === undefined ? 30 : parseInt(String(retryDays), 10),
      minVisitors: Math.max(0, parseInt(String(minVisitors ?? "0"), 10) || 0),
      maxVisitors: Math.max(0, parseInt(String(maxVisitors ?? "0"), 10) || 0),
      searchEntry: searchEntry === true || searchEntry === "true",
      onLog: (msg) => sseSend(res, { type: "log", msg }),
      onResult: async (r: NeighborResult) => {
        sseSend(res, { type: "result", ...r });
        // 신청 성공 시 쿼타 증가 + 히스토리 저장
        if (r.status === "success" && userId) {
          await incrementNeighborQuota(userId);
          await addNeighborHistory({ user_id: userId, keyword: r.keyword, target_blog_id: r.blogId, status: "success", message: r.message });
        } else if ((r.status === "fail" || r.status === "skip") && userId) {
          await addNeighborHistory({ user_id: userId, keyword: r.keyword, target_blog_id: r.blogId, status: r.status === "fail" ? "fail" : "skip", message: r.message });
        }
      },
      onProgress: (done, fail) => sseSend(res, { type: "progress", done, fail }),
      stopSignal: () => stopMap.get(jid) === true,
    });

    sseSend(res, { type: "done" });
  } catch (e: any) {
    sseSend(res, { type: "error", msg: e.message });
  }
  releaseAccounts();
  endJob(jid);
  res.end();
});

/* ── 완료 목록 조회 ── */
app.get("/api/done/:accountId", (req, res) => {
  const dp = donePath(req.params.accountId);
  try {
    const raw = fs.existsSync(dp) ? JSON.parse(fs.readFileSync(dp, "utf-8")) : [];
    const list = Array.isArray(raw) ? raw : Object.keys(raw);   // 신형식({blogId:date})도 blogId 목록으로 반환
    res.json({ list });
  } catch {
    res.json({ list: [] });
  }
});

/* ── 완료 목록 초기화 ── */
app.delete("/api/done/:accountId", (req, res) => {
  const dp = donePath(req.params.accountId);
  try { if (fs.existsSync(dp)) fs.unlinkSync(dp); } catch {}
  res.json({ ok: true });
});

/* ── 공감·댓글용 수집 (SSE) — source=keyword(기본) | buddy(내 이웃새글) ── */
app.get("/api/engage-crawl", async (req, res) => {
  const { keywords, countPerKeyword, source, accountId } = req.query as Record<string, string>;
  const isBuddy = source === "buddy";
  if (!isBuddy && !keywords) return res.status(400).json({ error: "keywords 필요" });
  if (isBuddy && !accountId) return res.status(400).json({ error: "accountId 필요(이웃새글)" });

  sseSetup(res);
  try {
    const count = parseInt(countPerKeyword || "20", 10);
    let results;
    if (isBuddy) {
      // 내 서로이웃들의 최근 글 → 이웃 블로거 수집 (키워드 불필요)
      results = await crawlBuddyPosts({
        accountId,
        maxCount: Math.max(count, 30),
        onLog: (msg) => sseSend(res, { type: "log", msg }),
      });
    } else {
      const kwList = keywords.split(/[,\n]/).map((k) => k.trim()).filter(Boolean);
      results = await crawlBlogIds({
        accountId: "",
        keywords: kwList,
        countPerKeyword: count,
        onLog: (msg) => sseSend(res, { type: "log", msg }),
      });
    }
    sseSend(res, { type: "crawl_done", results });
  } catch (e: any) {
    sseSend(res, { type: "error", msg: e.message });
  }
  res.end();
});

/* ── 블로그 건강검진: 내 블로그 지표 크롤 (SSE) ── */
app.get("/api/blog-stats", async (req, res) => {
  const { accountId, plan, userId } = req.query as Record<string, string>;
  if (!accountId) return res.status(400).json({ error: "accountId 필요" });
  sseSetup(res);
  try {
    const stats = await crawlBlogStats({ accountId, plan, onLog: (msg) => sseSend(res, { type: "log", msg }) });
    sseSend(res, { type: "stats", stats });
    if (userId) await addBlogscoreHistory({ user_id: userId, blog_id: stats.blogId, total_posts: stats.totalPosts, neighbors: stats.neighbors, low_quality_suspected: stats.lowQualitySuspected });
  } catch (e: any) {
    sseSend(res, { type: "error", msg: e.message });
  }
  res.end();
});

/* ── 🛒 스마트스토어 상품 진단 (SSE) — 리뷰수·찜·평점·가격. 프록시+브라우저로 안전 접근 ── */
app.get("/api/store-info", async (req, res) => {
  const { storeUrl } = req.query as Record<string, string>;
  if (!storeUrl) return res.status(400).json({ error: "storeUrl 필요" });
  sseSetup(res);
  try {
    const info = await diagnoseStore({ storeUrl, onLog: (msg) => sseSend(res, { type: "log", msg }) });
    sseSend(res, { type: "store", info });
  } catch (e: any) {
    sseSend(res, { type: "error", msg: e.message });
  }
  res.end();
});

/* ── 🩺 P4: 글별 조회수 수집 (통계 조회수 순위 페이지 파싱) ── */
app.post("/api/post-views", async (req, res) => {
  const { accountId } = req.body || {};
  if (!accountId) return res.status(400).json({ ok: false, error: "accountId 필요" });
  try {
    const views = await crawlPostViews({ accountId, onLog: (msg) => console.log(msg) });
    res.json({ ok: true, views });
  } catch (e: any) {
    console.error(`[post-views] 실패: ${e.message || e}`);
    res.status(400).json({ ok: false, error: e.message || "조회수 수집 실패" });
  }
});

/* ── 블로그 건강검진 2단계: 사용자가 선택한 글만 검색 노출 검사 ── */
app.post("/api/exposure-check", async (req, res) => {
  const { accountId, plan, logNos } = req.body as { accountId?: string; plan?: string; logNos?: string[] };
  if (!accountId) return res.status(400).json({ error: "accountId 필요" });
  if (!Array.isArray(logNos) || !logNos.length) return res.status(400).json({ error: "검사할 logNos 필요" });
  try {
    const result = await checkSelectedBlogExposure({ accountId, plan, logNos });
    res.json({ ok: true, ...result });
  } catch (e: any) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

/* ── 답방 ①: 내 블로그 글 목록 불러오기 (SSE) ── */
app.get("/api/my-posts", async (req, res) => {
  const { accountId, selectMode, count, period, blogId, fromMs, toMs } = req.query as Record<string, string>;
  const from = parseInt(fromMs || "0", 10) || 0;   // 날짜 지정 시작(epoch ms, 0=제한없음)
  const to = parseInt(toMs || "0", 10) || 0;       // 날짜 지정 종료
  sseSetup(res);
  try {
    // 🌐 blogId만 오면 로그인 없이 공개 API로 수집(계정 불필요). accountId 있으면 로그인 방식(정확).
    let posts;
    if (blogId && !accountId) {
      posts = await crawlPublicPosts({ blogId, count: parseInt(count || "100", 10), fromMs: from, toMs: to, onLog: (msg) => sseSend(res, { type: "log", msg }) });
    } else if (accountId) {
      posts = await crawlMyPosts({
        accountId,
        selectMode: (selectMode === "all" || selectMode === "period") ? selectMode : "count",
        count: parseInt(count || "10", 10),
        period: parseInt(period || "7", 10),
        fromMs: from,
        toMs: to,
        onLog: (msg) => sseSend(res, { type: "log", msg }),
      });
    } else { sseSend(res, { type: "error", msg: "accountId 또는 blogId 필요" }); res.end(); return; }
    sseSend(res, { type: "posts", posts });
  } catch (e: any) {
    sseSend(res, { type: "error", msg: e.message });
  }
  res.end();
});

/* ── 공감·댓글 작업 (SSE) ── */
app.post("/api/engage", async (req, res) => {
  const {
    userId, accountId, targets: targetsRaw, comment,
    doLike, doComment, periodDays, postsPerBlog,
    delayMin, delayMax, dailyLimit, skipDone, commentRate, likeRate, jobId,
    aiComment, commentTone, geminiKey, minVisitors, maxVisitors, searchEntry,
  } = req.body as Record<string, any>;
  const isAiComment = aiComment === true || aiComment === "true";

  if (!accountId || !targetsRaw)
    return res.status(400).json({ error: "accountId, targets 필요" });

  sseSetup(res);
  const jid = jobId || Date.now().toString();
  beginJob(jid, "engage", res);
  let releaseAccounts = () => {};

  try {
    if (!await ensureActiveMember(userId, res)) { endJob(jid); return; }
    const targets = Array.isArray(targetsRaw) ? targetsRaw : JSON.parse(decodeURIComponent(targetsRaw));
    let serverDailyLimit = Math.max(1, parseInt(String(dailyLimit ?? "50"), 10));
    if (userId) {
      const plan = await getUserPlan(userId);
      const used = await getEngageDailyUsage(userId);
      const limit = ENGAGE_DAILY_LIMIT[plan] ?? ENGAGE_DAILY_LIMIT.free;
      serverDailyLimit = Math.max(0, Math.min(serverDailyLimit, limit - used));
      if (serverDailyLimit <= 0) { sseSend(res, { type: "quota_exceeded", used, limit }); endJob(jid); return res.end(); }
      sseSend(res, { type: "quota_info", used, limit, remaining: serverDailyLimit });
    }
    const release = acquireAccountsOrReport([accountId], "공감·댓글", res);
    if (!release) { endJob(jid); return; }
    releaseAccounts = release;
    sseSend(res, { type: "start", total: targets.length });

    await engageBlogs({
      accountId,
      ownerUserId: userId,
      targets,
      comment: comment || "",
      doLike: doLike !== false && doLike !== "false",
      doComment: doComment !== false && doComment !== "false" && (isAiComment || !!(comment?.trim())),
      aiComment: isAiComment,
      commentTone: commentTone || "다정",
      geminiKey: geminiKey || "",
      periodDays: parseInt(String(periodDays ?? "7"), 10),
      postsPerBlog: parseInt(String(postsPerBlog ?? "1"), 10),
      delayMin: parseFloat(String(delayMin ?? "5")),
      delayMax: parseFloat(String(delayMax ?? "10")),
      dailyLimit: serverDailyLimit,
      skipDone: skipDone === true || skipDone === "true",
      commentRate: commentRate === undefined ? 100 : parseInt(String(commentRate), 10),
      likeRate: likeRate === undefined ? 100 : parseInt(String(likeRate), 10),
      minVisitors: Math.max(0, parseInt(String(minVisitors ?? "0"), 10) || 0),
      maxVisitors: Math.max(0, parseInt(String(maxVisitors ?? "0"), 10) || 0),
      searchEntry: searchEntry === true || searchEntry === "true",
      onLog: (msg) => sseSend(res, { type: "log", msg }),
      onResult: async (r: EngageResult) => {
        sseSend(res, { type: "result", ...r });
        // ★ 통과(성공)한 것만 상단 하루 카운트 증가
        if (r.status === "success" && userId) {
          await incrementEngageQuota(userId);
          const used = await getEngageDailyUsage(userId);
          sseSend(res, { type: "quota_info", used });
        }
      },
      onProgress: (done, fail) => sseSend(res, { type: "progress", done, fail }),
      stopSignal: () => stopMap.get(jid) === true,
    });

    sseSend(res, { type: "done" });
  } catch (e: any) {
    sseSend(res, { type: "error", msg: e.message });
  }
  releaseAccounts();
  endJob(jid);
  res.end();
});

/* ── 답방 ②: 내 글 댓글에 대댓글(답글) 작업 (SSE) ── */
app.post("/api/reply", async (req, res) => {
  const { userId, accountId, posts, mode, comment, tone, onlyNew, replyToReplies, delayMin, delayMax, geminiKey, jobId } = req.body as Record<string, any>;
  if (!accountId || !Array.isArray(posts) || posts.length === 0)
    return res.status(400).json({ error: "accountId, posts 필요" });
  sseSetup(res);
  const jid = jobId || Date.now().toString();
  beginJob(jid, "reply", res);
  let releaseAccounts = () => {};
  try {
    if (!await ensureActiveMember(userId, res)) { endJob(jid); return; }
    let replyRemaining = Number.MAX_SAFE_INTEGER;
    if (userId) {
      const plan = await getUserPlan(userId);
      const used = await getReplyDailyUsage(userId);
      const limit = REPLY_DAILY_LIMIT[plan] ?? REPLY_DAILY_LIMIT.free;
      replyRemaining = Math.max(0, limit - used);
      if (!replyRemaining) { sseSend(res, { type: "quota_exceeded", used, limit }); endJob(jid); return res.end(); }
      sseSend(res, { type: "quota_info", used, limit, remaining: replyRemaining });
    }
    const release = acquireAccountsOrReport([accountId], "답방", res);
    if (!release) { endJob(jid); return; }
    releaseAccounts = release;
    sseSend(res, { type: "start", total: posts.length });
    await replyToComments({
      accountId,
      ownerUserId: userId,
      posts,
      mode: mode === "fixed" ? "fixed" : "ai",
      comment: comment || "댓글 감사합니다 😊",
      tone: tone || "다정",
      onlyNew: onlyNew !== false && onlyNew !== "false",
      replyToReplies: replyToReplies === true || replyToReplies === "true",
      delayMin: parseFloat(String(delayMin ?? "5")),
      delayMax: parseFloat(String(delayMax ?? "10")),
      geminiKey: geminiKey || "",
      onLog: (msg) => sseSend(res, { type: "log", msg }),
      onResult: async (r) => {
        sseSend(res, { type: "result", ...r });
        if (userId) {
          if (r.status === "success" && replyRemaining > 0) { await incrementReplyQuota(userId); replyRemaining -= 1; }
          await addReplyHistory({ user_id: userId, post_title: r.postTitle || "", status: r.status, message: r.message || "" });
        }
      },
      onProgress: (done, fail) => sseSend(res, { type: "progress", done, fail }),
      stopSignal: () => stopMap.get(jid) === true || replyRemaining <= 0,
    });
    sseSend(res, { type: "done" });
  } catch (e: any) {
    sseSend(res, { type: "error", msg: e.message });
  }
  releaseAccounts();
  endJob(jid);
  res.end();
});

/* ── 🗣️ 플레이스 리뷰답글 ① 리뷰 수집 (JSON) ── */
app.post("/api/place-review-fetch", async (req, res) => {
  const { userId, accountId, placeUrl, storeName, onlyNew } = req.body as Record<string, any>;
  if (!accountId) return res.status(400).json({ error: "accountId 필요" });
  try {
    const reviews = await crawlPlaceReviews({
      accountId, placeUrl, storeName,
      onlyNew: onlyNew !== false && onlyNew !== "false",
      ownerUserId: userId,
      onLog: (m) => console.log(m),
    });
    res.json({ reviews });
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

/* ── 🗣️ 플레이스 리뷰답글 ② AI/고정 답글 초안 (JSON) ── */
app.post("/api/place-review-drafts", async (req, res) => {
  const { mode, tone, fixedText, geminiKey, reviews } = req.body as Record<string, any>;
  if (!Array.isArray(reviews)) return res.status(400).json({ error: "reviews 필요" });
  try {
    const lines = String(fixedText || "").split(/\r?\n/).map((s: string) => s.trim()).filter(Boolean);
    const drafts: { reviewId: string; reply: string }[] = [];
    for (const rv of reviews) {
      let reply = "";
      if (mode === "fixed") {
        reply = lines.length ? lines[Math.floor(Math.random() * lines.length)] : "방문해 주셔서 감사합니다 😊";
      } else {
        reply = await generatePlaceReviewReply(geminiKey || "", tone || "다정", Number(rv.rating) || 0, rv.text || "", rv.author || "", (m) => console.log(m));
        if (!reply) reply = (Number(rv.rating) || 5) <= 3 ? "불편을 드려 죄송합니다. 더 나아지겠습니다 🙏" : "소중한 후기 남겨주셔서 감사합니다 😊";
      }
      drafts.push({ reviewId: String(rv.reviewId), reply });
    }
    res.json({ drafts });
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

/* ── 🗣️ 플레이스 리뷰답글 ③ 답글 등록 (SSE) ── */
app.post("/api/place-review-reply", async (req, res) => {
  const { userId, accountId, placeUrl, storeName, replies, jobId } = req.body as Record<string, any>;
  if (!accountId || !Array.isArray(replies) || !replies.length) return res.status(400).json({ error: "accountId, replies 필요" });
  sseSetup(res);
  const jid = jobId || Date.now().toString();
  beginJob(jid, "place_reply", res);
  let releaseAccounts = () => {};
  try {
    if (!await ensureActiveMember(userId, res)) { endJob(jid); return; }
    let remaining = Number.MAX_SAFE_INTEGER;
    if (userId) {
      const plan = await getUserPlan(userId);
      const used = await getPlaceReplyDailyUsage(userId);
      const limit = PLACE_REPLY_DAILY_LIMIT[plan] ?? PLACE_REPLY_DAILY_LIMIT.free;
      remaining = Math.max(0, limit - used);
      if (!remaining) { sseSend(res, { type: "quota_exceeded", used, limit }); endJob(jid); return res.end(); }
      sseSend(res, { type: "quota_info", used, limit, remaining });
    }
    const release = acquireAccountsOrReport([accountId], "리뷰답글", res);
    if (!release) { endJob(jid); return; }
    releaseAccounts = release;
    sseSend(res, { type: "start", total: replies.length });
    await replyToPlaceReviews({
      accountId, placeUrl, storeName, replies, ownerUserId: userId,
      onLog: (msg) => sseSend(res, { type: "log", msg }),
      onResult: async (r) => {
        sseSend(res, { type: "result", ...r });
        if (userId && r.status === "success" && remaining > 0) { await incrementPlaceReplyQuota(userId); remaining -= 1; }
        if (userId) await addPlaceReplyHistory({ user_id: userId, store_name: storeName || "", status: r.status === "success" ? "success" : "fail", message: r.message || "" });
      },
      onProgress: (done, fail) => sseSend(res, { type: "progress", done, fail }),
      stopSignal: () => stopMap.get(jid) === true || remaining <= 0,
    });
    sseSend(res, { type: "done" });
  } catch (e: any) {
    sseSend(res, { type: "error", msg: e.message });
  }
  releaseAccounts();
  endJob(jid);
  res.end();
});

/* ── 품앗이: 내 계정들끼리 서로 공감·댓글 (SSE) ── */
app.post("/api/pumasi", async (req, res) => {
  const { userId, accounts, comment, doLike, doComment, aiComment, commentTone, geminiKey, delayMin, delayMax, readRelated, readRelatedMode, readSpeed, periodDays, searchEntry, searchKeyword, spreadHours, jobId } = req.body as Record<string, any>;
  if (!Array.isArray(accounts) || accounts.length < 2)
    return res.status(400).json({ error: "품앗이는 계정 2개 이상 필요" });
  sseSetup(res);
  const jid = jobId || Date.now().toString();
  beginJob(jid, "pumasi", res);
  let releaseAccounts = () => {};
  try {
    if (!await ensureActiveMember(userId, res)) { endJob(jid); return; }
    const release = acquireAccountsOrReport(accounts.map((a: any) => String(a.accountId || "")), "품앗이", res);
    if (!release) { endJob(jid); return; }
    releaseAccounts = release;
    sseSend(res, { type: "start", total: accounts.length });
    await pumasiEngage({
      ownerUserId: userId,
      accounts: accounts.map((a: any) => ({ accountId: String(a.accountId), blogId: String(a.blogId), posts: parseInt(String(a.posts ?? "3"), 10) || 3, receiveLimit: Math.max(0, parseInt(String(a.receiveLimit ?? "3"), 10) || 0), noGive: !!a.noGive })),   // 받기 0=안받기, noGive=안가기
      comment: comment || "",
      doLike: doLike !== false && doLike !== "false",
      doComment: doComment !== false && doComment !== "false",
      aiComment: aiComment === true || aiComment === "true",
      commentTone: commentTone || "다정",
      geminiKey: geminiKey || "",
      delayMin: parseFloat(String(delayMin ?? "8")),
      delayMax: parseFloat(String(delayMax ?? "15")),
      readRelated: readRelated !== false && readRelated !== "false",
      readRelatedMode: readRelatedMode === "always" ? "always" : "random",
      readSpeed: readSpeed === "fast" ? "fast" : readSpeed === "normal" ? "normal" : "natural",
      periodDays: Math.max(0, parseInt(String(periodDays ?? "0"), 10) || 0),
      searchEntry: searchEntry === true || searchEntry === "true",
      searchKeyword: String(searchKeyword ?? "").slice(0, 80),
      spreadHours: Math.max(0, parseFloat(String(spreadHours ?? "0")) || 0),
      onLog: (msg) => sseSend(res, { type: "log", msg }),
      onResult: async (r) => { sseSend(res, { type: "result", ...r }); if (userId && r.status === "success") await incrementPumasiQuota(userId); },
      onProgress: (done, fail, skip) => sseSend(res, { type: "progress", done, fail, skip }),
      stopSignal: () => stopMap.get(jid) === true,
    });
    sseSend(res, { type: "done" });
  } catch (e: any) {
    sseSend(res, { type: "error", msg: e.message });
  }
  releaseAccounts();
  endJob(jid);
  res.end();
});

/* ── 품앗이 효과 리포트: 방문자 추이 + 품앗이 실행일 상관 ── */
app.get("/api/pumasi-report", async (req, res) => {
  const blogId = String(req.query.blogId || "").trim();
  if (!blogId) return res.status(400).json({ error: "blogId 필요" });
  try {
    const report = await crawlPumasiReport(blogId, (m) => console.log(m));
    res.json(report);
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

/* ── 품앗이 시작 전 미리보기: 대상별 총 글 / 이미 댓글 단 글 / 남은 글 ── */
app.post("/api/pumasi-preview", async (req, res) => {
  const { accounts } = req.body as Record<string, any>;
  if (!Array.isArray(accounts)) return res.status(400).json({ error: "accounts 필요" });
  try {
    const rows = await pumasiPreview(accounts.map((a: any) => ({ accountId: String(a.accountId), blogId: String(a.blogId) })), (m) => console.log(m));
    res.json({ rows });
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

/* ── 제목 수정 한도 조회 ── */
app.get("/api/title-edit-quota/:userId", async (req, res) => {
  try {
    const plan = await getUserPlan(req.params.userId);
    const limit = TITLE_EDIT_DAILY_LIMIT[plan] ?? TITLE_EDIT_DAILY_LIMIT.free;
    const used = await getTitleEditDailyUsage(req.params.userId);
    res.json({ ok: true, used, limit, plan, remaining: Math.max(0, limit - used) });
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

/* ── 글 제목 자동 수정(재발행) — SSE로 모든 단계 로그를 실시간 전송 ── */
app.post("/api/update-title", async (req, res) => {
  const { userId, accountId, logNo, newTitle } = req.body as Record<string, any>;
  if (!accountId || !logNo || !newTitle) return res.status(400).json({ error: "accountId, logNo, newTitle 필요" });
  sseSetup(res);
  try {
    if (!await ensureActiveMember(userId, res)) return;
    sseSend(res, { type: "log", msg: `✏️ 제목 수정 시작 — 글 ${logNo}` });
    // 등급 한도 체크
    if (userId) {
      const plan = await getUserPlan(userId);
      const limit = TITLE_EDIT_DAILY_LIMIT[plan] ?? TITLE_EDIT_DAILY_LIMIT.free;
      const used = await getTitleEditDailyUsage(userId);
      if (used >= limit) {
        sseSend(res, { type: "log", msg: `⛔ 오늘 제목 수정 한도(${limit}회)를 모두 사용했어요` });
        sseSend(res, { type: "done", ok: false, message: `오늘 제목 수정 한도(${limit}회)를 모두 사용했어요. 자정에 초기화됩니다.`, quotaExceeded: true });
        return res.end();
      }
    }
    const release = acquireAccountsOrReport([String(accountId)], "글 제목 수정", res);
    if (!release) return;
    try {
      const result = await updatePostTitle({ accountId: String(accountId), logNo: String(logNo), newTitle: String(newTitle), onLog: (m) => sseSend(res, { type: "log", msg: m }) });
      if (result.ok && userId) await incrementTitleEditQuota(userId);
      sseSend(res, { type: "done", ok: result.ok, message: result.message });
    } finally {
      release();
    }
  } catch (e: any) {
    sseSend(res, { type: "log", msg: `❌ 제목 수정 오류: ${e.message}` });
    sseSend(res, { type: "done", ok: false, message: e.message });
  }
  res.end();
});

/* ── 공감·댓글 완료 목록 조회/초기화 ── */
app.get("/api/engage-done/:accountId", (req, res) => {
  const dp = engageDonePath(req.params.accountId);
  try {
    const raw = fs.existsSync(dp) ? JSON.parse(fs.readFileSync(dp, "utf-8")) : [];
    const list = Array.isArray(raw) ? raw : Object.keys(raw);   // 신형식({blogId:date})도 blogId 목록으로 반환
    res.json({ list });
  } catch { res.json({ list: [] }); }
});

app.delete("/api/engage-done/:accountId", (req, res) => {
  const dp = engageDonePath(req.params.accountId);
  try { if (fs.existsSync(dp)) fs.unlinkSync(dp); } catch {}
  res.json({ ok: true });
});

// ── 회원 프록시 상태: 이 회원(user_id)에게 배정된 프록시가 있는지 (대시보드 노란불용) ──
app.get("/api/my-proxy/:userId", async (req, res) => {
  try {
    // ①회원 본인 id에 배정됐는지 ②없으면 회원의 연결 계정(accts=accountId 목록) 중 하나라도
    //   배정됐는지 확인 → 봇이 실제로 프록시를 쓰는 조건과 노란불을 일치시킨다.
    let px = await getProxyForAccount(req.params.userId);
    if (!px && req.query.accts) {
      const accts = String(req.query.accts).split(",").map(s => s.trim()).filter(Boolean);
      for (const aid of accts) { px = await getProxyForAccount(aid); if (px) break; }
    }
    res.json({ active: !!px });
  } catch { res.json({ active: false }); }
});

// ── 프록시 헬스체크: 주어진 프록시로 실제 나가는 IP·응답속도 확인(관리자 상태판용) ──
app.post("/api/proxy-check", async (req, res) => {
  try {
    const { server, username, password } = req.body || {};
    if (!server) return res.status(400).json({ ok: false, error: "server(주소:포트)가 필요해요" });
    const r = await checkProxy({ server, username, password });
    res.json(r);
  } catch (e: any) {
    res.status(500).json({ ok: false, error: e?.message || "검사 실패" });
  }
});

/* ═══ 📧 아웃리치(체험단 제안) — 발신계정 + 이메일 실발송 + 이력 ═══ */

// 발신 계정 조회(비번은 등록여부만, 값은 숨김)
app.get("/api/outreach/sender/:userId", async (req, res) => {
  try {
    const s = await getOutreachSender(req.params.userId);
    if (!s) return res.json({ ok: true, sender: null });
    res.json({ ok: true, sender: { from_name: s.from_name, from_email: s.from_email, smtp_host: s.smtp_host, smtp_port: s.smtp_port, smtp_user: s.smtp_user, daily_limit: s.daily_limit, has_pass: !!s.smtp_pass } });
  } catch (e: any) { res.status(500).json({ ok: false, error: e.message }); }
});

// 발신 계정 저장(회원별). SMTP 연결 검증 후 저장.
app.post("/api/outreach/sender", async (req, res) => {
  const { userId, from_name, from_email, smtp_host, smtp_port, smtp_user, smtp_pass, daily_limit } = req.body || {};
  if (!userId || !from_email || !smtp_user || !smtp_pass) return res.status(400).json({ ok: false, error: "필수 항목(발신 이메일·아이디·비밀번호)을 채워주세요" });
  const host = smtp_host || "smtp.naver.com";
  const port = Number(smtp_port) || 465;
  console.log(`[sender] 발신계정 저장 시도 user=${userId} host=${host}:${port} user=${smtp_user} from=${from_email}`);
  try {
    // 실제 연결 검증(잘못된 비번이면 여기서 실패 → 저장 안 함)
    const tx = nodemailer.createTransport({ host, port, secure: port === 465, auth: { user: smtp_user, pass: smtp_pass } });
    await tx.verify();
    console.log(`[sender] ✅ SMTP 연결/로그인 성공 (${smtp_user}@${host})`);
    const { error } = await supabase.from("publy_outreach_sender").upsert({
      user_id: userId, from_name: from_name || null, from_email, smtp_host: host, smtp_port: port,
      smtp_user, smtp_pass, daily_limit: Number(daily_limit) || 50, updated_at: new Date().toISOString(),
    }, { onConflict: "user_id" });
    if (error) throw new Error(error.message);
    console.log(`[sender] ✅ 저장 완료 user=${userId}`);
    res.json({ ok: true });
  } catch (e: any) {
    // 실패 원인을 로그에 그대로 남김(535/응답코드·서버 응답 전문 포함)
    const code = e.responseCode || e.code || "";
    console.error(`[sender] ❌ 저장 실패 user=${userId} host=${host}:${port} smtp_user=${smtp_user} code=${code} :: ${e.message || e}`);
    if (e.response) console.error(`[sender]    ↳ 서버 응답: ${e.response}`);
    const msg = /auth|credential|password|535/i.test(e.message || "") ? "로그인 실패 — 네이버 메일 '환경설정 → POP3/IMAP → IMAP/SMTP 사용'을 먼저 켜세요. 2단계 인증 쓰면 '앱 비밀번호 16자리'가 필요해요(로그인 비번 불가)." : e.message;
    res.status(400).json({ ok: false, error: msg });
  }
});

// 이메일 실발송(SSE) — 선택한 블로거들에게 개인화 발송. 블로그 창 안 열고 SMTP로 바로.
// 💬 블로그 댓글 제안 발송 (러프·계정 안전 최우선) — 로그인 계정으로 발굴 블로거 최근 글에 댓글
app.get("/api/outreach/send-comment", async (req, res) => {
  const { userId, accountId, message, targets, dailyLimit } = req.query as Record<string, string>;
  sseSetup(res);
  const L = (msg: string) => sseSend(res, { type: "log", msg });
  try {
    if (!userId || !accountId) throw new Error("userId·accountId 필요");
    let list: any[] = [];
    try { list = JSON.parse(targets || "[]"); } catch {}
    const withBlog = list.filter(t => t.blogId);
    if (!withBlog.length) { sseSend(res, { type: "error", msg: "댓글 달 블로거가 없어요" }); return res.end(); }
    // ★계정 안전: 하루 상한을 아주 낮게(기본 5, 최대 10). 도배 감지 회피.
    const cap = Math.min(10, Math.max(1, Number(dailyLimit) || 5));
    const todo = withBlog.slice(0, cap).map(t => ({ id: t.id, blogId: t.blogId, nick: t.nick, body: String(message || "").replace(/\{닉네임\}/g, t.nick || "블로거").replace(/\{관심키워드\}/g, (t.keywords?.[0] || "")).replace(/\{관심품목\}/g, (t.categories?.[0] || "")) }));
    if (withBlog.length > cap) L(`⚠️ 계정 안전을 위해 오늘은 ${cap}명까지만 답니다(나머지는 다음에).`);
    const { ok, fail } = await sendBlogComments({
      accountId, ownerUserId: userId, targets: todo, onLog: L,
      onSent: async (id, success, error, postUrl) => {
        const t = todo.find(x => x.id === id) || todo[0];
        // 댓글은 이메일 안 쓰므로 to_email 필드에 '댓글 단 글 URL'을 저장(보러가기용)
        await addOutreachLog({ user_id: userId, blog_id: t?.blogId || "", nickname: t?.nick, channel: "comment", to_email: postUrl || "", subject: "블로그 댓글 제안", message: t?.body || "", status: success ? "sent" : "failed", error });
        if (success) sseSend(res, { type: "sent", id });
      },
    });
    L(`🎉 댓글 마무리 — 성공 ${ok} · 실패 ${fail}`);
    sseSend(res, { type: "done", ok, fail });
  } catch (e: any) { sseSend(res, { type: "error", msg: e.message }); }
  res.end();
});

app.get("/api/outreach/send-email", async (req, res) => {
  // ✉️ 웹메일 방식: 로그인된 네이버 창을 열어 사람처럼 메일을 쓴다. SMTP·앱비밀번호 불필요(회원 설정 0).
  const { userId, accountId, subject, message, fromName, targets, dailyLimit, brand, gapSec } = req.query as Record<string, string>;
  const brandName = (brand || "").trim();   // 회원 본인 업체명({업체명} 치환). 비면 자연스럽게 제거.
  // 회원이 정한 통당 간격(초). 계정 안전 위해 최소 2초. 기본 4초. ±1.5초 랜덤 폭으로 사람같이.
  const gap = Math.max(2, Number(gapSec) || 4) * 1000;
  sseSetup(res);
  const L = (msg: string) => sseSend(res, { type: "log", msg });
  try {
    L("📧 이메일 발송을 준비해요…");
    if (!userId) throw new Error("userId 필요");
    if (!accountId) { sseSend(res, { type: "error", msg: "발송할 네이버 계정을 선택하세요(서이추처럼 로그인된 계정으로 메일을 씁니다)" }); return res.end(); }
    let list: any[] = [];
    try { list = JSON.parse(targets || "[]"); } catch {}
    const withEmail = list.filter(t => t.email);
    L(`① 받는 사람 정리 — 이메일 있는 대상 ${withEmail.length}명`);
    if (!withEmail.length) { sseSend(res, { type: "error", msg: "공개 이메일이 있는 대상이 없어요" }); return res.end(); }

    const limit = Math.max(1, Number(dailyLimit) || 50);
    const sentToday = await getOutreachSentToday(userId);
    const remain = Math.max(0, limit - sentToday);
    L(`② 오늘 발송 현황 — 이미 ${sentToday}통 · 남은 한도 ${remain}통 (하루 ${limit}통)`);
    if (remain <= 0) { sseSend(res, { type: "error", msg: `오늘 발송 한도(${limit}통)를 다 썼어요. 내일 다시 해주세요.` }); return res.end(); }

    const todo = withEmail.slice(0, remain).map(t => {
      const nick = t.nick || "블로거";
      // {업체명}=회원 본인 업체명(비면 "저희"로 자연스럽게). {닉네임}·{관심키워드}·{관심품목} 개인화.
      const subj = String(subject || "체험단 제안").replace(/\{업체명\}/g, brandName || "저희").replace(/\{닉네임\}/g, t.nick || "").replace(/\{관심키워드\}/g, (t.keywords?.[0] || "")).replace(/\{관심품목\}/g, (t.categories?.[0] || ""));
      const body = String(message || "").replace(/\{업체명\}/g, brandName || "저희").replace(/\{닉네임\}/g, nick).replace(/\{관심키워드\}/g, (t.keywords?.[0] || "관심 있으신 분야")).replace(/\{관심품목\}/g, (t.categories?.[0] || "관심 품목"));
      return { id: t.id, email: t.email, nick: t.nick, subject: subj, body, blogId: t.blogId };
    });
    if (withEmail.length > remain) L(`⚠️ 하루 한도 때문에 ${remain}명만 보냅니다(계정 안전). 나머지는 내일.`);
    L(`③ 로그인된 네이버 창을 열어 메일을 씁니다(서이추처럼) — 설정·앱비밀번호 필요 없어요`);

    const { ok, fail } = await sendWebmail({
      accountId, ownerUserId: userId, fromName,
      delayMinMs: gap, delayMaxMs: gap + 3000,   // 회원이 정한 간격 ~ +3초 랜덤
      targets: todo.map(t => ({ id: t.id, email: t.email, nick: t.nick, subject: t.subject, body: t.body })),
      onLog: L,
      onSent: async (id, success, error) => {
        const t = todo.find(x => x.id === id) || todo[0];
        await addOutreachLog({ user_id: userId, blog_id: t?.blogId || "", nickname: t?.nick, channel: "email", to_email: t?.email || "", subject: t?.subject || "", message: t?.body || "", status: success ? "sent" : "failed", error });
        if (success) sseSend(res, { type: "sent", id });
      },
    });
    L(`🎉 발송 마무리 — 성공 ${ok}통 · 실패 ${fail}통`);
    sseSend(res, { type: "done", ok, fail });
  } catch (e: any) {
    console.error(`[send-email] ❌ ${e.message || e}`);
    sseSend(res, { type: "error", msg: e.message });
  }
  res.end();
});

// 보낸글 이력 조회
app.get("/api/outreach/history/:userId", async (req, res) => {
  try {
    const { data, error } = await supabase.from("publy_outreach").select("*").eq("user_id", req.params.userId).order("sent_at", { ascending: false }).limit(200);
    if (error) throw new Error(error.message);
    res.json({ ok: true, history: data || [] });
  } catch (e: any) { res.status(500).json({ ok: false, error: e.message }); }
});

// ✅ 회신 상태 변경(수동: 회원이 "회신 왔어요"/"거절"을 눌러 기록) — reply_status: waiting|replied|no_reply
app.post("/api/outreach/reply-status", async (req, res) => {
  const { id, reply_status } = req.body || {};
  if (!id || !reply_status) return res.status(400).json({ ok: false, error: "id, reply_status 필요" });
  try {
    const { error } = await supabase.from("publy_outreach").update({ reply_status }).eq("id", id);
    if (error) throw new Error(error.message);
    res.json({ ok: true });
  } catch (e: any) { res.status(500).json({ ok: false, error: e.message }); }
});

// 🗑️ 아웃리치 기록 삭제(회원이 추적 목록에서 지움)
app.post("/api/outreach/delete", async (req, res) => {
  const { id } = req.body || {};
  if (!id) return res.status(400).json({ ok: false, error: "id 필요" });
  try {
    const { error } = await supabase.from("publy_outreach").delete().eq("id", id);
    if (error) throw new Error(error.message);
    res.json({ ok: true });
  } catch (e: any) { res.status(500).json({ ok: false, error: e.message }); }
});

// 📬 팔로우업 대상 조회 — 보낸 지 N일(기본 3) 넘도록 회신(replied) 없는 이메일 건. "할 일" 팝업용.
app.get("/api/outreach/followup-targets/:userId", async (req, res) => {
  const days = Math.max(1, Number(req.query.days) || 3);
  try {
    const cutoff = new Date(Date.now() - days * 86400000).toISOString();
    const { data, error } = await supabase.from("publy_outreach").select("*")
      .eq("user_id", req.params.userId).eq("channel", "email").eq("status", "sent")
      .neq("reply_status", "replied").neq("reply_status", "no_reply")
      .is("followup_at", null)                       // 아직 팔로우업 안 보낸 것만
      .lte("sent_at", cutoff)                        // N일 이상 지난 것
      .order("sent_at", { ascending: true }).limit(100);
    if (error) throw new Error(error.message);
    res.json({ ok: true, targets: (data || []).filter((r: any) => r.to_email) });
  } catch (e: any) { res.status(500).json({ ok: false, error: e.message }); }
});

// 📬 팔로우업 발송(자동/수동 공용) — 선택한 아웃리치 건들에 리마인드 메일을 웹메일로 보낸다.
app.get("/api/outreach/send-followup", async (req, res) => {
  const { userId, accountId, ids, message } = req.query as Record<string, string>;
  sseSetup(res);
  const L = (msg: string) => sseSend(res, { type: "log", msg });
  try {
    if (!userId || !accountId) throw new Error("userId·accountId 필요");
    let idList: string[] = [];
    try { idList = JSON.parse(ids || "[]"); } catch {}
    if (!idList.length) { sseSend(res, { type: "error", msg: "팔로우업할 대상을 선택하세요" }); return res.end(); }
    const { data: rows } = await supabase.from("publy_outreach").select("*").in("id", idList);
    const targets = (rows || []).filter((r: any) => r.to_email).map((r: any) => ({
      id: r.id, email: r.to_email, nick: r.nickname, blogId: r.blog_id,
      subject: `[리마인드] ${r.subject || "체험단 제안"}`,
      body: String(message || "").replace(/\{닉네임\}/g, r.nickname || "블로거") ||
        `${r.nickname || "블로거"}님, 지난번 보내드린 제안 혹시 확인하셨을까요? 관심 있으시면 편하게 회신 주세요 :)`,
    }));
    if (!targets.length) { sseSend(res, { type: "error", msg: "보낼 대상이 없어요" }); return res.end(); }
    L(`📬 팔로우업 ${targets.length}건을 로그인된 네이버 창으로 보냅니다…`);
    const { ok, fail } = await sendWebmail({
      accountId, ownerUserId: userId, targets, onLog: L,
      onSent: async (id, success) => {
        if (success && id) { await supabase.from("publy_outreach").update({ followup_at: new Date().toISOString() }).eq("id", id); sseSend(res, { type: "sent", id }); }
      },
    });
    L(`🎉 팔로우업 완료 — 성공 ${ok} · 실패 ${fail}`);
    sseSend(res, { type: "done", ok, fail });
  } catch (e: any) { sseSend(res, { type: "error", msg: e.message }); }
  res.end();
});

// 🩺 진정성 정밀 분석(공개 정보, 세션 불필요) — blogIds 배치. SSE로 하나씩 결과 스트림.
app.get("/api/outreach/authenticity", async (req, res) => {
  const { blogIds } = req.query as Record<string, string>;
  sseSetup(res);
  try {
    let ids: string[] = [];
    try { ids = JSON.parse(blogIds || "[]"); } catch {}
    ids = ids.filter(Boolean).slice(0, 60);   // 과부하 방지
    for (const id of ids) {
      const r = await analyzeBlogAuthenticity(id);
      sseSend(res, { type: "auth", ...r });
      await new Promise(rs => setTimeout(rs, 250));   // 네이버 예의상 간격
    }
    sseSend(res, { type: "done", count: ids.length });
  } catch (e: any) {
    sseSend(res, { type: "error", msg: e.message });
  }
  res.end();
});

// 📄 글 본문 읽기 — 개선안 제안 시 제목만 보지 않게 실제 내용을 읽어 AI에 준다(공개, 세션 불필요)
app.get("/api/post-body", async (req, res) => {
  const { blogId, logNo } = req.query as Record<string, string>;
  if (!blogId || !logNo) return res.status(400).json({ ok: false, error: "blogId·logNo 필요" });
  try {
    const r = await fetchPostBody(blogId, logNo);
    res.json({ ok: true, ...r });
  } catch (e: any) { res.status(500).json({ ok: false, error: e.message }); }
});

/* ── 🆕 NEW 트래픽 유입 (검색유입, SSE) — 기본 잠금(관리자가 켠 회원만), 관리자=락 해제 ── */
app.post("/api/inflow", async (req, res) => {
  const { userId, accountId, accountIds, keywords, targetType, placeUrl, blogId, logNo, rounds, termMin, termMax, doSave, doLike, doShare, doDir, doCall, doBook, doTalk, doWish, doCart, doOption, device, fullFunnel, spreadHours, doReview, reviewText, visible, actionRate, dwellBaseSec, dwellCustomSec, dataSaver, extraTargets, keywordWeights } = req.body as Record<string, string>;
  if (!keywords || !targetType) return res.status(400).json({ error: "keywords·targetType 필요" });
  const memberToken = String(req.get("X-Publy-Session") || "");
  const adminToken = String(req.get("X-Publy-Admin-Session") || "");
  // 🔐 권한은 반드시 "검증된 세션"에서만 도출한다(body의 userId 자기신고를 신뢰하지 않음).
  //   - 관리자: 별도 관리자 세션토큰(publy_admin_session_get)으로 검증돼야 세션검증을 건너뛴다.
  //   - 일반/무제한 회원: verifyInflowSession으로 본인 세션임을 확인(무제한이어도 사칭 불가).
  //   plan만 보고 우회하면 회원이 admin/unlimited userId를 사칭해 권한상승할 수 있어 금지.
  const isVerifiedAdmin = adminToken ? await verifyAdminSession(adminToken) : false;
  if (!isVerifiedAdmin && (!userId || !await verifyInflowSession(memberToken, userId))) return res.status(401).json({ error: "회원 세션이 올바르지 않습니다" });
  const authToken = isVerifiedAdmin ? adminToken : memberToken;
  const inflowPlan = isVerifiedAdmin ? "admin" : (userId ? await getUserPlan(userId, authToken) : "free");
  // 🔐 트래픽 라이선스 서버검증 — 회원(비관리자)은 승인된 대상만·승인된 행동만(로컬 요청 조작 우회 차단).
  let licActionSet: Set<string> | null = null;
  let licPlan: string | null = null;   // 트래픽 등급/한도의 소스오브트루스 = tool_licenses(컨트롤타워 발급). publy_users.plan 무시.
  if (!isVerifiedAdmin && userId) {
    const lic = await getTrafficLicenseForTool(userId, String(targetType), authToken);
    if (!lic || !lic.ok) return res.status(403).json({ error: "승인되지 않았거나 만료된 트래픽 대상입니다. 관리자에게 문의하세요." });
    licActionSet = new Set(lic.actions);
    licPlan = lic.plan || "basic";     // 무제한(테리 테스트 발급 등)은 여기서 unlimited로 잡혀 한도 스킵된다.
  }
  const licAllow = (k: string) => isVerifiedAdmin || !licActionSet || licActionSet.has(k);
  sseSetup(res);
  let releaseAccount = () => {};
  try {
    // 🔒 트래픽 권한은 tool_licenses(위 getTrafficLicenseForTool)가 유일 소스오브트루스다.
    //    퍼블리의 옛 inflow_enabled 게이트(ensureActiveMember(...,"inflow"))는 트래픽 회원을 오차단하므로 쓰지 않는다.
    //    (컨트롤타워에서 대상 승인/만료로 제어 → 미승인·만료는 이미 위 1147~1148에서 403 차단됨. 관리자는 isVerifiedAdmin으로 통과.)
    // 🔄 다계정 로테이션 — 저장·찜·공감에 쓸 계정 전체를 락(나머지 계정이 다른 작업과 충돌·세션깨짐 방지)
    let acctIdsArr: string[] | undefined;
    if (accountIds) { try { const a = JSON.parse(accountIds); if (Array.isArray(a) && a.length) acctIdsArr = Array.from(new Set(a.map(String).filter(Boolean))); } catch { acctIdsArr = undefined; } }
    const lockList = (acctIdsArr && acctIdsArr.length) ? acctIdsArr : [accountId || ""];
    const release = acquireAccountsOrReport(lockList, "NEW 트래픽 유입", res);
    if (!release) return;
    releaseAccount = release;

    // 트래픽 등급/한도 = tool_licenses(licPlan) 우선. 관리자는 inflowPlan(admin). 회원은 컨트롤타워 발급 등급(basic/pro/premium/unlimited).
    let plan = isVerifiedAdmin ? inflowPlan : (licPlan || inflowPlan);
    // 한도 체크는 대상(statScope)이 정해진 뒤에 아래에서 — 대상별 각각 카운트

    let target: InflowTarget;
    if (targetType === "place") {
      const parsed = await resolvePlaceUrl(placeUrl || "");   // naver.me 단축주소도 펼쳐서 인식
      if (!parsed) { sseSend(res, { type: "error", msg: "플레이스 주소를 인식하지 못했어요(m.place/지도/naver.me 링크를 붙여주세요)" }); res.end(); return; }
      target = { type: "place", placeId: parsed.placeId, domain: parsed.domain, placeUrl };
    } else if (targetType === "store") {
      // 🛒 스마트스토어 상품 URL: smartstore.naver.com/{store}/products/{id} 등에서 스토어명·상품ID 추출
      const su = String((req.body as any).storeUrl || "").trim();
      if (!su) { sseSend(res, { type: "error", msg: "스마트스토어 상품 주소를 입력해주세요" }); res.end(); return; }
      const sid = su.match(/smartstore\.naver\.com\/([A-Za-z0-9_-]+)/i)?.[1] || "";
      const pid = su.match(/products\/(\d+)/i)?.[1] || su.match(/\/(\d{6,})/)?.[1] || "";
      target = { type: "store", storeUrl: su, storeId: sid, productId: pid };
    } else {
      if (!blogId) { sseSend(res, { type: "error", msg: "블로그 아이디가 필요해요" }); res.end(); return; }
      target = { type: "blog", blogId, logNo: logNo || undefined };
    }

    // ➕ 추가 대상 해석 — 주소 문자열을 스토어/블로그/플레이스로 자동 판별해 targets 배열 구성(첫 대상=위 target)
    const targetsArr: InflowTarget[] = [target];
    if (extraTargets) {
      try {
        const arr: string[] = JSON.parse(extraTargets);
        for (const raw of arr) {
          const s = String(raw || "").trim(); if (!s) continue;
          if (/smartstore\.naver|shopping\.naver|brand\.naver/i.test(s)) {
            // 🛒 스마트스토어 상품 — store 대상으로 생성(플레이스로 잘못 파싱되지 않게)
            const sid = s.match(/(?:smartstore|brand)\.naver\.com\/([A-Za-z0-9_-]+)/i)?.[1] || "";
            const pid = s.match(/products\/(\d+)/i)?.[1] || s.match(/\/(\d{6,})/)?.[1] || "";
            targetsArr.push({ type: "store", storeUrl: s, storeId: sid, productId: pid });
          } else if (/blog\.naver|blogId=|\/PostView/i.test(s)) {
            const m = s.match(/blog\.naver\.com\/([A-Za-z0-9_-]+)(?:\/(\d+))?/i) || s.match(/blogId=([A-Za-z0-9_-]+)/i);
            if (m) targetsArr.push({ type: "blog", blogId: m[1], logNo: (m[2] || (s.match(/logNo=(\d+)/i)?.[1])) || undefined });
          } else {
            const p = await resolvePlaceUrl(s);
            if (p) targetsArr.push({ type: "place", placeId: p.placeId, domain: p.domain, placeUrl: s });
          }
        }
        if (targetsArr.length > 1) sseSend(res, { type: "log", msg: `➕ 대상 ${targetsArr.length}곳을 번갈아 유입해요` });
      } catch { /* ignore */ }
    }
    // 🎯 키워드 비중
    let kwWeightsArr: number[] | undefined;
    if (keywordWeights) { try { kwWeightsArr = JSON.parse(keywordWeights); } catch { kwWeightsArr = undefined; } }

    const kwList = keywords.split(/[,\n]/).map((k) => k.trim()).filter(Boolean);
    const n = Math.max(1, parseInt(rounds || "10", 10));
    const tmin = Math.max(5, parseInt(termMin || "30", 10));
    const tmax = Math.max(tmin, parseInt(termMax || "90", 10));
    const unlimited = plan === "admin" || plan === "unlimited";

    // 🎯 대상별 통계 scope(프론트 inflowScope와 동일 규칙) — 대상마다 유입·순위·리포트 분리 저장
    const scopeOf = (t: InflowTarget): string => {
      const ref = t.type === "place" ? t.placeId : t.type === "blog" ? t.blogId : ((t as any).productId || (t as any).storeId || "");
      return ref ? `${t.type === "place" ? "p" : t.type === "blog" ? "b" : "s"}_${String(ref).replace(/[^A-Za-z0-9_-]/g, "").slice(0, 40)}` : "";
    };
    const statScope = scopeOf(target);
    // 🎯 대상별 한도 체크 — place/blog/store 각각 카운트(사용료 대상별). scope별 카운터.
    if (userId) {
      const quota = await checkInflowQuota(userId, plan, statScope);
      if (!quota.ok) { sseSend(res, { type: "quota_exceeded", used: quota.used, limit: quota.limit }); releaseAccount(); res.end(); return; }
      sseSend(res, { type: "quota_info", used: quota.used, limit: quota.limit, remaining: quota.limit - quota.used });
    }

    let stopped = false;
    res.on("close", () => { stopped = true; });

    // ✍️ 리뷰 자동작성은 관리자 락(기본 잠금) — 권한 없으면 안내 후 리뷰만 건너뜀
    const reviewOk = doReview === "true" ? await inflowReviewAllowed(userId, authToken) : false;
    if (doReview === "true" && !reviewOk) sseSend(res, { type: "log", msg: "🔒 리뷰 자동작성은 관리자 승인이 필요해요 — 리뷰는 건너뛰고 진행합니다" });

    // 🔄 다계정 로테이션 — 위에서 파싱·락한 acctIdsArr를 그대로 사용(저장·찜·공감을 여러 계정 번갈아)
    const result = await searchInflow({
      accountId: accountId || "",
      accountIds: acctIdsArr,
      ownerUserId: userId || undefined,
      authToken,
      keywords: kwList,
      keywordWeights: kwWeightsArr,
      target,
      targets: targetsArr.length > 1 ? targetsArr : undefined,
      rounds: n,
      device: (device === "pc" || device === "mix") ? device : "mobile",
      intervalSec: [tmin, tmax],
      actions: { save: doSave === "true" && licAllow("save"), like: doLike === "true" && licAllow("like"), share: doShare === "true" && licAllow("share"), directions: doDir === "true" && licAllow("dir"), call: doCall === "true" && licAllow("call"), booking: doBook === "true" && licAllow("book"), talk: doTalk === "true" && licAllow("talk"), wish: doWish === "true" && licAllow("wish"), cart: doCart === "true" && licAllow("cart"), optionView: doOption === "true" && licAllow("option"), review: doReview === "true" && reviewOk && licAllow("review"), reviewText: reviewText || "" },
      fullFunnel: fullFunnel === "true" && licAllow("funnel"),
      spreadHours: spreadHours ? Math.max(0, parseFloat(spreadHours)) : 0,
      visible: visible === "true",
      actionRate: actionRate ? Math.max(0, Math.min(1, parseFloat(actionRate))) : 1,
      dwellBaseSec: dwellBaseSec ? Math.max(5, parseFloat(dwellBaseSec)) : 60,
      dwellCustomSec: dwellCustomSec ? Math.max(0, parseFloat(dwellCustomSec)) : 0,
      dataSaver: (dataSaver === "save" || dataSaver === "max") ? dataSaver : "normal",
      requireLogin: doSave === "true" || doLike === "true" || doWish === "true" || doCart === "true" || reviewOk,   // 저장·공감·찜·장바구니·리뷰는 로그인 필요(예약·톡톡·공유·옵션탐색은 로그인 없이)
      onLog: (msg) => sseSend(res, { type: "log", msg }),
      onProgress: (done, total) => sseSend(res, { type: "progress", done, total }),
      onShot: (caption, dataUrl) => sseSend(res, { type: "shot", caption, dataUrl }),   // 📸 화면 캡처 전송
      shouldStop: () => stopped,
      onQuota: async () => {
        // 한도 체크·차감만(통계는 성공 시점 onSuccess에서 기록 → 시도만 하고 실패한 방문이 유입수 부풀리지 않게)
        if (!userId) return true;
        if (unlimited) { await incrementInflowQuota(userId, statScope).catch(() => {}); return true; }  // 무제한(관리자)은 한도만 스킵
        const limit = INFLOW_DAILY_LIMIT[plan] ?? INFLOW_DAILY_LIMIT.free;
        const q = await consumeInflowQuota(memberToken, userId, limit, statScope);
        if (!q.ok) return false;
        sseSend(res, { type: "quota_info", used: q.used, limit: q.limit, remaining: Math.max(0, q.limit - q.used) });
        return q.ok;
      },
      onSuccess: async (t) => { if (userId) await incrementInflowStat(userId, scopeOf(t) || statScope).catch(() => {}); },  // ✅ 성공한 그 대상(다중 로테이션 시 각 대상)별 통계에 반영
    });
    sseSend(res, { type: "inflow_done", ...result });
  } catch (e: any) {
    sseSend(res, { type: "error", msg: e.message });
  } finally {
    releaseAccount();
  }
  res.end();
});

/* ── 💬 공개 리뷰 수집 (감정분석용) ── */
app.get("/api/place-reviews", async (req, res) => {
  const { placeUrl } = req.query as Record<string, string>;
  if (!placeUrl) return res.status(400).json({ error: "placeUrl 필요" });
  try {
    const r = await collectPlaceReviews({ placeUrl, limit: 30 });
    res.json(r);
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

/* ── 📍 플레이스 순위 측정 (내 키워드에서 몇 위인지) ── */
app.get("/api/place-rank", async (req, res) => {
  const { keyword, placeUrl, userId, accountId } = req.query as Record<string, string>;
  if (!keyword || !placeUrl) return res.status(400).json({ error: "keyword·placeUrl 필요" });
  try {
    const r = await measurePlaceRank({ keyword, placeUrl, accountId: accountId || "", ownerUserId: userId || null });
    res.json(r);
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

/* ── 📝 블로그 글 순위 측정 (오토파일럿용) — 키워드로 통합검색 블로그탭에서 내 글 순위 ── */
app.get("/api/blog-rank", async (req, res) => {
  const { keyword, blogId, logNo, accountId } = req.query as Record<string, string>;
  if (!keyword || !blogId || !logNo) return res.status(400).json({ error: "keyword·blogId·logNo 필요" });
  try {
    const r = await measureBlogRank({ keyword, blogId, logNo, accountId: accountId || "" });
    res.json(r);
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

/* ── 🥊 경쟁사 추적 (내 키워드 상위 경쟁사 vs 나 비교) ── */
app.get("/api/competitors", async (req, res) => {
  const { query, myPlaceUrl, userId, accountId } = req.query as Record<string, string>;
  if (!query) return res.status(400).json({ error: "query(키워드) 필요" });
  try {
    const list = await crawlPlaces({ accountId: accountId || "", query, count: 8, ownerUserId: userId || null });
    const myId = myPlaceUrl ? (parsePlaceUrl(myPlaceUrl)?.placeId || (await resolvePlaceUrl(myPlaceUrl))?.placeId || "") : "";
    // 상위 5곳 + 내 매장 위치 표시
    const top = list.slice(0, 5).map((p, i) => ({
      rank: i + 1, placeId: p.placeId, name: p.name, category: p.category || "",
      review: p.visitorReviewCount || 0, blog: p.blogReviewCount || 0,
      isMine: !!myId && String(p.placeId) === String(myId),
    }));
    const myIndex = list.findIndex((p) => !!myId && String(p.placeId) === String(myId));
    const mine = myIndex >= 0 ? { rank: myIndex + 1, name: list[myIndex].name, review: list[myIndex].visitorReviewCount || 0, blog: list[myIndex].blogReviewCount || 0 } : null;
    res.json({ top, mine, myRank: myIndex >= 0 ? myIndex + 1 : null, total: list.length });
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

/* ── 🩺 플레이스 최적화 진단 (순위 오르려면 뭘 채워야 하나) ── */
app.get("/api/place-diagnose", async (req, res) => {
  const { placeUrl } = req.query as Record<string, string>;
  if (!placeUrl) return res.status(400).json({ error: "placeUrl 필요" });
  try {
    const r = await diagnosePlace({ placeUrl });
    res.json(r);
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

const server = app.listen(PORT, "127.0.0.1", () => {
  console.log(`[neighbor-bot] 서버 시작 → http://localhost:${PORT}`);
});
server.on("error", (error: NodeJS.ErrnoException) => {
  if (error.code === "EADDRINUSE") {
    console.warn(`[neighbor-bot] 포트 ${PORT}가 이미 사용 중입니다. 실행 중인 앱 봇을 유지하고 새 서버 시작을 건너뜁니다.`);
    return;
  }
  throw error;
});

export default app;
