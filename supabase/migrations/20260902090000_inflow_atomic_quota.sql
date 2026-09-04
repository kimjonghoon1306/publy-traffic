create or replace function public.publy_inflow_consume_quota(p_token text, p_limit integer)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid;
  v_key text;
  v_used integer;
  v_limit integer := greatest(0, coalesce(p_limit, 0));
begin
  select s.user_id into v_user_id
  from public.publy_sessions s
  where s.token_hash = encode(extensions.digest(coalesce(p_token, ''), 'sha256'), 'hex')
    and s.expires_at > now()
  limit 1;
  if v_user_id is null then raise exception using errcode='P0001', message='INVALID_SESSION'; end if;
  if v_limit <= 0 then return jsonb_build_object('ok', false, 'used', 0, 'limit', v_limit); end if;

  v_key := 'inflow_daily_' || v_user_id::text || '_' || to_char(timezone('Asia/Seoul', now()), 'YYYY-MM-DD');
  insert into public.publy_settings(key, value)
  values (v_key, to_jsonb(1))
  on conflict (key) do update
    set value = to_jsonb(coalesce(nullif(public.publy_settings.value #>> '{}', ''), '0')::integer + 1)
    where coalesce(nullif(public.publy_settings.value #>> '{}', ''), '0')::integer < v_limit
  returning coalesce(nullif(value #>> '{}', ''), '0')::integer into v_used;

  if v_used is null then
    select coalesce(nullif(value #>> '{}', ''), '0')::integer into v_used from public.publy_settings where key = v_key;
    return jsonb_build_object('ok', false, 'used', coalesce(v_used, 0), 'limit', v_limit);
  end if;
  return jsonb_build_object('ok', true, 'used', v_used, 'limit', v_limit);
end;
$$;

revoke all on function public.publy_inflow_consume_quota(text, integer) from public;
grant execute on function public.publy_inflow_consume_quota(text, integer) to anon, authenticated;
