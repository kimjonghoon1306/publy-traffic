-- 관리자 전용: 회원 순위 측정 히스토리 조회(+삭제). 스냅샷 admin RPC와 동일 패턴.
create or replace function public.publy_place360_admin_ranks(p_token text, p_search text default '')
returns table(id uuid, user_id uuid, store_key text, keyword text, rank integer, checked_count integer, surface text, device text, measured_at timestamptz, member_name text, email text, plan text)
language plpgsql security definer set search_path = '' as $$
begin
  if not exists(select 1 from public.publy_sessions where token_hash = encode(extensions.digest(coalesce(p_token, ''), 'sha256'), 'hex') and is_admin is true and expires_at > now()) then
    raise exception using errcode = 'P0001', message = 'INVALID_ADMIN_SESSION';
  end if;
  return query select r.id, r.user_id, r.store_key, r.keyword, r.rank, r.checked_count, r.surface, r.device, r.measured_at,
    coalesce(u.name,'') as member_name, coalesce(u.email,'') as email, coalesce(u.plan,'') as plan
    from public.publy_place360_ranks r
    join public.publy_users u on u.id = r.user_id
    where coalesce(p_search,'') = '' or r.keyword ilike '%'||p_search||'%' or r.store_key ilike '%'||p_search||'%' or u.name ilike '%'||p_search||'%' or u.email ilike '%'||p_search||'%'
    order by r.measured_at desc limit 500;
end;
$$;

revoke all on function public.publy_place360_admin_ranks(text,text) from public;
grant execute on function public.publy_place360_admin_ranks(text,text) to anon, authenticated;
