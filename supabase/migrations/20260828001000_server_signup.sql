begin;

create or replace function public.publy_signup(
  p_email text,
  p_password text,
  p_name text,
  p_phone text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user public.publy_users%rowtype;
  v_quota public.publy_quotas%rowtype;
  v_token text;
begin
  if length(trim(coalesce(p_email, ''))) < 5 or position('@' in p_email) = 0 then
    raise exception using errcode = 'P0001', message = 'INVALID_EMAIL';
  end if;
  if length(coalesce(p_password, '')) < 6 then
    raise exception using errcode = 'P0001', message = 'WEAK_PASSWORD';
  end if;
  if exists (select 1 from public.publy_users where lower(email) = lower(trim(p_email))) then
    raise exception using errcode = '23505', message = 'EMAIL_EXISTS';
  end if;

  insert into public.publy_users(email, password_hash, name, phone, plan, app_type, is_active)
  values (
    lower(trim(p_email)),
    extensions.crypt(p_password, extensions.gen_salt('bf', 10)),
    nullif(trim(p_name), ''), nullif(trim(coalesce(p_phone, '')), ''),
    'free', 'app', true
  ) returning * into v_user;

  insert into public.publy_quotas(user_id, total_quota, used_quota, reset_date)
  values (v_user.id, 2, 0, now() + interval '7 days')
  returning * into v_quota;

  v_token := encode(extensions.gen_random_bytes(32), 'hex');
  insert into public.publy_sessions(user_id, token_hash, expires_at)
  values (v_user.id, encode(extensions.digest(v_token, 'sha256'), 'hex'), now() + interval '30 days');

  return jsonb_build_object(
    'token', v_token,
    'user', jsonb_build_object(
      'id', v_user.id, 'email', v_user.email, 'name', v_user.name,
      'plan', v_user.plan, 'app_type', v_user.app_type,
      'is_active', v_user.is_active, 'created_at', v_user.created_at,
      'last_seen', v_user.last_seen
    )
  );
end;
$$;

revoke all on function public.publy_signup(text, text, text, text) from public;
grant execute on function public.publy_signup(text, text, text, text) to anon, authenticated;

commit;
