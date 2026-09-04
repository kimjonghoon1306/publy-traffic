begin;

create table if not exists public.publy_recovery_attempts (
  identity_hash text primary key,
  attempts integer not null default 0,
  window_started_at timestamptz not null default now()
);
alter table public.publy_recovery_attempts enable row level security;
revoke all on public.publy_recovery_attempts from anon, authenticated;

create or replace function public.publy_recover_password(
  p_email text,
  p_name text,
  p_phone text
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_identity text := encode(extensions.digest(lower(trim(coalesce(p_email, ''))) || '|' || regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g'), 'sha256'), 'hex');
  v_attempt public.publy_recovery_attempts%rowtype;
  v_user_id uuid;
  v_temp text;
begin
  select * into v_attempt from public.publy_recovery_attempts where identity_hash = v_identity for update;
  if v_attempt.identity_hash is not null and v_attempt.window_started_at > now() - interval '15 minutes' and v_attempt.attempts >= 5 then
    raise exception using errcode = 'P0001', message = 'TRY_LATER';
  end if;
  insert into public.publy_recovery_attempts(identity_hash, attempts, window_started_at)
  values (v_identity, 1, now())
  on conflict (identity_hash) do update set
    attempts = case when public.publy_recovery_attempts.window_started_at <= now() - interval '15 minutes' then 1 else public.publy_recovery_attempts.attempts + 1 end,
    window_started_at = case when public.publy_recovery_attempts.window_started_at <= now() - interval '15 minutes' then now() else public.publy_recovery_attempts.window_started_at end;

  select id into v_user_id from public.publy_users
  where lower(email) = lower(trim(p_email))
    and trim(coalesce(name, '')) = trim(p_name)
    and regexp_replace(coalesce(phone, ''), '[^0-9]', '', 'g') = regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g')
    and is_active is true
  limit 1;
  if v_user_id is null then raise exception using errcode = 'P0001', message = 'MEMBER_NOT_FOUND'; end if;

  v_temp := upper(substr(encode(extensions.gen_random_bytes(8), 'hex'), 1, 10));
  update public.publy_users
  set password_hash = extensions.crypt(v_temp, extensions.gen_salt('bf', 10)), updated_at = now()
  where id = v_user_id;
  delete from public.publy_sessions where user_id = v_user_id;
  delete from public.publy_recovery_attempts where identity_hash = v_identity;
  return v_temp;
end;
$$;

revoke all on function public.publy_recover_password(text, text, text) from public;
grant execute on function public.publy_recover_password(text, text, text) to anon, authenticated;

commit;
