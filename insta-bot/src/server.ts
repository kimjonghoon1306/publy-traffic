import express from "express";
import cors from "cors";
import {
  saveInstaSession, instaSessionExists, crawlByKeyword, sendDMs,
  CrawlTarget, SendResult,
} from "./instagram";
import {
  getUserPlan, checkMembershipAccess, checkInstaDmQuota, getInstaDmUsage, incrementInstaDmUsage,
  addInstaDmHistory, updateInstaTargetStatus, INSTA_DM_DAILY_LIMIT,
} from "./supabase";

const app = express();
const PORT = Number(process.env.PUBLY_BOT_PORT) || 3365;
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
  res.json({ ok: true, version: "1.0.0", service: "insta-bot" });
});

/* ── 세션 상태 ── */
app.get("/api/session/:accountId", (req, res) => {
  res.json({ exists: instaSessionExists(req.params.accountId) });
});

/* ── 로그인 (세션 저장) ── */
app.post("/api/login", async (req, res) => {
  const { accountId, id, pw } = req.body;
  if (!accountId || !id || !pw)
    return res.status(400).json({ success: false, error: "accountId, id, pw 필요" });
  try {
    const r = await saveInstaSession(accountId, id, pw);
    res.json({ success: true, username: r.username });
  } catch (e: any) {
    res.status(500).json({ success: false, error: e.message });
  }
});

/* ── 쿼타 조회 ── */
app.get("/api/quota/:userId", async (req, res) => {
  try {
    const plan = await getUserPlan(req.params.userId);
    const used = await getInstaDmUsage(req.params.userId);
    const limit = INSTA_DM_DAILY_LIMIT[plan] ?? INSTA_DM_DAILY_LIMIT.free;
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

/* ── 작업 중단 신호 ── */
const stopMap = new Map<string, boolean>();
app.post("/api/stop/:jobId", (req, res) => {
  stopMap.set(req.params.jobId, true);
  res.json({ ok: true });
});

/* ── 키워드 크롤링 (SSE) ── */
app.get("/api/crawl", async (req, res) => {
  const { accountId, keyword, limit, minFollowers, maxFollowers, jobId } = req.query as Record<string, string>;
  if (!accountId || !keyword)
    return res.status(400).json({ error: "accountId, keyword 필요" });

  sseSetup(res);
  const jid = jobId || Date.now().toString();
  stopMap.set(jid, false);
  try {
    if (!instaSessionExists(accountId)) {
      sseSend(res, { type: "error", msg: "먼저 인스타 계정을 연결(로그인)해주세요." });
      return res.end();
    }
    const results = await crawlByKeyword({
      accountId,
      keyword: keyword.trim(),
      limit: parseInt(limit || "30", 10),
      minFollowers: parseInt(minFollowers || "0", 10),
      maxFollowers: parseInt(maxFollowers || "0", 10),
      onLog: (msg) => sseSend(res, { type: "log", msg }),
      onResult: (t: CrawlTarget) => sseSend(res, { type: "result", ...t }),
      stopSignal: () => stopMap.get(jid) === true,
    });
    sseSend(res, { type: "crawl_done", results });
  } catch (e: any) {
    sseSend(res, { type: "error", msg: e.message });
  }
  stopMap.delete(jid);
  res.end();
});

/* ── DM 발송 (SSE) ── */
app.get("/api/send", async (req, res) => {
  const {
    userId, accountId, targets: targetsRaw, message,
    delayMin, delayMax, jobId,
  } = req.query as Record<string, string>;

  if (!accountId || !targetsRaw || !message)
    return res.status(400).json({ error: "accountId, targets, message 필요" });

  sseSetup(res);
  const jid = jobId || Date.now().toString();
  stopMap.set(jid, false);

  try {
    if (!instaSessionExists(accountId)) {
      sseSend(res, { type: "error", msg: "먼저 인스타 계정을 연결(로그인)해주세요." });
      return res.end();
    }
    const targets = JSON.parse(decodeURIComponent(targetsRaw));

    // 쿼타: 오늘 남은 한도만큼만 발송
    let dailyLimit = 9999;
    if (userId) {
      const access = await checkMembershipAccess(userId);
      if (!access.ok) {
        sseSend(res, { type: "error", msg: access.reason || "회원 이용권을 확인해주세요", membershipBlocked: true });
        return res.end();
      }
      const plan = access.plan;
      const quota = await checkInstaDmQuota(userId, plan);
      dailyLimit = quota.limit - quota.used;
      if (dailyLimit <= 0) {
        sseSend(res, { type: "quota_exceeded", used: quota.used, limit: quota.limit });
        return res.end();
      }
      sseSend(res, { type: "quota_info", used: quota.used, limit: quota.limit, remaining: dailyLimit });
    }

    await sendDMs({
      accountId,
      targets,
      message,
      delayMin: parseFloat(delayMin || "40"),
      delayMax: parseFloat(delayMax || "90"),
      dailyLimit,
      onLog: (msg) => sseSend(res, { type: "log", msg }),
      onResult: async (r: SendResult) => {
        sseSend(res, { type: "result", ...r });
        if (r.targetId) await updateInstaTargetStatus(r.targetId, r.status === "sent" ? "sent" : "fail");
        if (userId) {
          await addInstaDmHistory({
            user_id: userId, target_username: r.username, message,
            instagram_account: accountId, status: r.status,
          });
          if (r.status === "sent") await incrementInstaDmUsage(userId);
        }
      },
      onProgress: (done, fail) => sseSend(res, { type: "progress", done, fail }),
      stopSignal: () => stopMap.get(jid) === true,
    });

    sseSend(res, { type: "done" });
  } catch (e: any) {
    sseSend(res, { type: "error", msg: e.message });
  }
  stopMap.delete(jid);
  res.end();
});

app.listen(PORT, "127.0.0.1", () => {
  console.log(`[insta-bot] 서버 시작 → http://localhost:${PORT}`);
});

export default app;
