-- 🔒 한 기기 로그인 강제(단일 세션). 다른 기기 로그인 시 이전 기기는 하트비트에서 자동 로그아웃.
-- allow_multi_device=true 인 회원만 여러 기기 동시 로그인 허용(관리자가 회원관리에서 열어줌).
alter table public.publy_users add column if not exists active_device_id text;
alter table public.publy_users add column if not exists allow_multi_device boolean not null default false;
