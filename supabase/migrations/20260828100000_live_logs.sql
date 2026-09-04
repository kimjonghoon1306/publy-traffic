-- 📡 실시간 라이브 로그: 회원이 신고 안 해도 관리자가 회원 검색해 현재 진행 로그를 본다.
-- 회원당 1행(user_id PK)에 현재 작업 로그 스냅샷. 회원 앱이 throttle upsert, 관리자가 조회.
-- ★ 외래키(publy_users 참조)는 넣지 않는다: 앱은 익명키+RLS로 동작해 FK 불필요하고,
--   일부 환경에서 FK 참조가 "relation does not exist"로 막히는 것을 피하기 위함.
create table if not exists public.publy_live_logs (
  user_id uuid primary key,
  user_name text default '',
  user_email text default '',
  context text default '',        -- 어떤 작업인지(발행/이미지/서이추/크롤링 등)
  log_text text default '',       -- 현재 진행 로그(최근 8KB)
  is_running boolean not null default false,
  updated_at timestamptz not null default now()
);

create index if not exists publy_live_logs_updated_idx on public.publy_live_logs(updated_at desc);
create index if not exists publy_live_logs_running_idx on public.publy_live_logs(is_running, updated_at desc);

-- 앱은 익명키로 동작(기존 패턴). 회원 앱 upsert + 관리자 조회 허용.
alter table public.publy_live_logs enable row level security;
drop policy if exists publy_live_logs_all on public.publy_live_logs;
create policy publy_live_logs_all on public.publy_live_logs for all to anon, authenticated using (true) with check (true);
