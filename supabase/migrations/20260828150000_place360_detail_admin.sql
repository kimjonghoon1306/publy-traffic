begin;

create or replace function public.publy_place360_admin_detail_usage(p_token text)
returns table(user_id uuid, member_name text, email text, plan text, used integer, daily_limit integer)
language plpgsql security definer set search_path = '' as $$
begin
  if not exists(select 1 from public.publy_sessions where token_hash = encode(extensions.digest(coalesce(p_token, ''), 'sha256'), 'hex') and is_admin is true and expires_at > now()) then
    raise exception using errcode = 'P0001', message = 'INVALID_ADMIN_SESSION';
  end if;
  return query
  select u.id, coalesce(u.name, ''), coalesce(u.email, ''), coalesce(u.plan, 'free'),
    coalesce(nullif(s.value, '')::integer, 0),
    case u.plan when 'basic' then 5 when 'pro' then 20 when 'unlimited' then 999999 else 2 end
  from public.publy_users u
  left join public.publy_settings s on s.key = 'place_detail_daily_' || u.id::text || '_' || to_char(timezone('Asia/Seoul', now()), 'YYYY-MM-DD')
  where u.is_active is true
  order by coalesce(nullif(s.value, '')::integer, 0) desc, u.created_at desc
  limit 1000;
end;
$$;

create or replace function public.publy_place360_admin_reset_detail_usage(p_token text, p_user_id uuid)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  if not exists(select 1 from public.publy_sessions where token_hash = encode(extensions.digest(coalesce(p_token, ''), 'sha256'), 'hex') and is_admin is true and expires_at > now()) then
    raise exception using errcode = 'P0001', message = 'INVALID_ADMIN_SESSION';
  end if;
  delete from public.publy_settings
  where key = 'place_detail_daily_' || p_user_id::text || '_' || to_char(timezone('Asia/Seoul', now()), 'YYYY-MM-DD');
  return true;
end;
$$;

revoke all on function public.publy_place360_admin_detail_usage(text) from public;
revoke all on function public.publy_place360_admin_reset_detail_usage(text,uuid) from public;
grant execute on function public.publy_place360_admin_detail_usage(text) to anon, authenticated;
grant execute on function public.publy_place360_admin_reset_detail_usage(text,uuid) to anon, authenticated;

commit;
