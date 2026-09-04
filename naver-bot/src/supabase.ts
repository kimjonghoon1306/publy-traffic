import { createClient } from "@supabase/supabase-js";
import WebSocket from "ws";

if (typeof (globalThis as any).WebSocket === "undefined") {
  (globalThis as any).WebSocket = WebSocket;
}

const SUPABASE_URL = "https://qhhoyxexxlimbjrbwrgq.supabase.co";
const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFoaG95eGV4eGxpbWJqcmJ3cmdxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzczMTMzOTQsImV4cCI6MjA5Mjg4OTM5NH0.pw_qUR0oOxgt82S_DA6GTka3WP0JBu2vmWuKZ9VvTKM";

export const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

export interface PublyJob {
  id: string;
  user_id: string;
  platform: "naver" | "tistory";
  title: string;
  content: string;
  tags: string[];
  image_url?: string | null;
  image_prompt?: string;
  schedule_time?: string | null;
  status: "pending" | "running" | "success" | "fail";
  result_url?: string;
  error?: string;
  created_at: string;
  category_id?: string | null;
  visibility?: string | null;
  // ★ 예약/큐 발행의 전체 발행 데이터(blocks=이미지 포함). 있으면 이걸로 발행, 없으면 옛 방식(텍스트만).
  payload?: PublyJobPayload | null;
}

export interface PublyJobPayload {
  title?: string;
  content?: string;
  pubScope?: "body" | "faq" | "full";
  tags?: string[];
  imageUrl?: string;
  categoryId?: string;
  visibility?: "public" | "neighbor" | "private";
  videoUrl?: string;
  videoPosition?: "top" | "middle" | "bottom";
  naverId?: string;   // v2.1.79: 계정별 세션 선택(사진글쓰기 오발송 방지). 발행 직전 이 계정을 활성 슬롯으로 복사.
  blocks?: Array<{ type: string; content?: string; src?: string; alt?: string; link?: string; images?: {src:string;alt:string}[] }>;
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
  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from("publy_jobs")
    .select("*")
    .in("user_id", userIds)
    .eq("status", "pending")
    .or(`schedule_time.is.null,schedule_time.lte.${now}`)
    .order("created_at", { ascending: true })
    .limit(10);
  if (error) return [];
  return data || [];
}

export async function updateJob(id: string, update: Partial<PublyJob>) {
  await supabase.from("publy_jobs").update(update).eq("id", id);
}

/** 여러 앱이 같은 대기 작업을 보더라도 한 프로세스만 running으로 선점한다. */
export async function claimPendingJob(id: string): Promise<boolean> {
  const { data, error } = await supabase
    .from("publy_jobs")
    .update({ status: "running" })
    .eq("id", id)
    .eq("status", "pending")
    .select("id");
  return !error && !!data?.length;
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

export async function finishQueuedHistory(params: {
  user_id: string;
  platform: string;
  title: string;
  post_url?: string;
  status: "success" | "fail";
  error_message?: string;
}) {
  const { data: pending } = await supabase
    .from("publy_history")
    .select("id")
    .eq("user_id", params.user_id)
    .eq("platform", params.platform)
    .eq("title", params.title)
    .eq("status", "pending")
    .order("published_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (pending?.id) {
    const { error } = await supabase.from("publy_history").update({
      status: params.status,
      post_url: params.post_url,
      error_message: params.error_message,
      published_at: new Date().toISOString(),
    }).eq("id", pending.id);
    if (!error) return;
  }
  await addHistory(params);
}

const koreaDateKey = () => new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit",
}).format(new Date());

const PUBLISH_DAILY_LIMIT: Record<string, number> = {
  free: 2, basic: 6, pro: 15, unlimited: 999999, admin: 9999,
};

export async function checkPublishEntitlement(userId: string): Promise<{ ok: boolean; reason?: string }> {
  const [{ data: user }, { data: quota }] = await Promise.all([
    supabase.from("publy_users").select("plan,is_active").eq("id", userId).maybeSingle(),
    supabase.from("publy_quotas").select("reset_date").eq("user_id", userId).maybeSingle(),
  ]);
  if (!user || user.is_active === false) return { ok: false, reason: "비활성 회원" };
  if (!quota?.reset_date || new Date(quota.reset_date).getTime() <= Date.now()) return { ok: false, reason: "이용기간 만료" };
  const limit = PUBLISH_DAILY_LIMIT[user.plan] ?? PUBLISH_DAILY_LIMIT.free;
  const key = `publish_daily_${userId}_${koreaDateKey()}`;
  const { data: row } = await supabase.from("publy_settings").select("value").eq("key", key).maybeSingle();
  const used = Number.parseInt(row?.value || "0", 10) || 0;
  return used < limit ? { ok: true } : { ok: false, reason: `오늘 발행 한도(${limit}건) 초과` };
}

export async function incrementDailyPublish(userId: string): Promise<void> {
  const key = `publish_daily_${userId}_${koreaDateKey()}`;
  const { data } = await supabase.from("publy_settings").select("value").eq("key", key).maybeSingle();
  const used = Number.parseInt(data?.value || "0", 10) || 0;
  await supabase.from("publy_settings").upsert({ key, value: String(used + 1) }, { onConflict: "key" });
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

export async function refundQuota(userId: string): Promise<void> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const { data } = await supabase.from("publy_quotas").select("used_quota").eq("user_id", userId).maybeSingle();
    const used = data?.used_quota || 0;
    if (used <= 0) return;
    const { data: updated, error } = await supabase.from("publy_quotas")
      .update({ used_quota: used - 1 }).eq("user_id", userId).eq("used_quota", used).select("id");
    if (!error && updated?.length) return;
  }
}
