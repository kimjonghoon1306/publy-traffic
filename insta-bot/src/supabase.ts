import { createClient } from "@supabase/supabase-js";
import WebSocket from "ws";

// Node 20 등 native WebSocket 없는 런타임 폴리필 (Supabase Realtime 초기화 크래시 방지)
if (typeof (globalThis as any).WebSocket === "undefined") {
  (globalThis as any).WebSocket = WebSocket;
}

const SUPABASE_URL = "https://qhhoyxexxlimbjrbwrgq.supabase.co";
// anon 키 (공개용 — RLS 미사용, 접근제어는 앱/봇단 user_id 필터)
const SUPABASE_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFoaG95eGV4eGxpbWJqcmJ3cmdxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzczMTMzOTQsImV4cCI6MjA5Mjg4OTM5NH0.pw_qUR0oOxgt82S_DA6GTka3WP0JBu2vmWuKZ9VvTKM";

export const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// 프론트(src/lib/supabase.ts)와 동일하게 유지
export const INSTA_DM_DAILY_LIMIT: Record<string, number> = {
  free: 5,
  basic: 10,
  pro: 30,
  unlimited: 999999,
  admin: 9999,
};

const todayStr = () => new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit",
}).format(new Date());

export async function getUserPlan(userId: string): Promise<string> {
  if (userId === "admin-publy") return "admin";
  try {
    const { data } = await supabase
      .from("publy_users")
      .select("plan")
      .eq("id", userId)
      .maybeSingle();
    return data?.plan || "free";
  } catch {
    return "free";
  }
}

export async function checkMembershipAccess(userId: string): Promise<{ ok: boolean; plan: string; reason?: string }> {
  if (userId === "admin-publy") return { ok: true, plan: "admin" };
  try {
    const [{ data: user }, { data: quota }] = await Promise.all([
      supabase.from("publy_users").select("plan,is_active").eq("id", userId).maybeSingle(),
      supabase.from("publy_quotas").select("reset_date").eq("user_id", userId).maybeSingle(),
    ]);
    const plan = user?.plan || "free";
    if (!user || user.is_active === false) return { ok: false, plan, reason: "비활성 회원" };
    if (!quota?.reset_date || new Date(quota.reset_date).getTime() <= Date.now()) return { ok: false, plan, reason: "이용기간 만료" };
    return { ok: true, plan };
  } catch {
    return { ok: false, plan: "free", reason: "회원정보 확인 실패" };
  }
}

// 오늘 사용량 (insta_dm_quota.used_today, 날짜 바뀌면 리셋)
export async function getInstaDmUsage(userId: string): Promise<number> {
  try {
    const { data } = await supabase
      .from("insta_dm_quota")
      .select("used_today, reset_date")
      .eq("user_id", userId)
      .maybeSingle();
    if (!data) return 0;
    if (data.reset_date !== todayStr()) return 0; // 날짜 바뀜 → 0
    return data.used_today || 0;
  } catch {
    return 0;
  }
}

export async function checkInstaDmQuota(
  userId: string,
  plan: string
): Promise<{ ok: boolean; used: number; limit: number }> {
  const limit = INSTA_DM_DAILY_LIMIT[plan] ?? INSTA_DM_DAILY_LIMIT.free;
  const used = await getInstaDmUsage(userId);
  return { ok: used < limit, used, limit };
}

// 발송 성공 1건마다 used_today +1 (upsert, 날짜 리셋 처리 포함)
export async function incrementInstaDmUsage(userId: string): Promise<void> {
  try {
    const { data } = await supabase
      .from("insta_dm_quota")
      .select("used_today, reset_date, daily_limit")
      .eq("user_id", userId)
      .maybeSingle();
    const today = todayStr();
    if (!data) {
      await supabase.from("insta_dm_quota").insert([
        { user_id: userId, used_today: 1, reset_date: today, daily_limit: 60, is_enabled: true },
      ]);
      return;
    }
    const base = data.reset_date === today ? data.used_today || 0 : 0;
    await supabase
      .from("insta_dm_quota")
      .update({ used_today: base + 1, reset_date: today })
      .eq("user_id", userId);
  } catch {}
}

export async function addInstaDmHistory(params: {
  user_id: string;
  target_username: string;
  message: string;
  instagram_account: string;
  status: "sent" | "fail";
}): Promise<void> {
  try {
    await supabase.from("insta_dm_history").insert([params]);
  } catch {}
}

export async function updateInstaTargetStatus(
  id: string,
  status: "pending" | "sent" | "fail" | "skip"
): Promise<void> {
  try {
    await supabase.from("insta_dm_targets").update({ status }).eq("id", id);
  } catch {}
}

export async function updateInstaTargetFollowers(
  id: string,
  followers: number
): Promise<void> {
  try {
    await supabase.from("insta_dm_targets").update({ followers }).eq("id", id);
  } catch {}
}
