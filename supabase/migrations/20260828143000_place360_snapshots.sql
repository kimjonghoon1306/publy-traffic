begin;

alter table public.publy_users add column if not exists place360_enabled boolean not null default true;

create table if not exists public.publy_place360_snapshots (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  store_key text not null,
  store_name text not null,
  region text not null default '',
  category text not null default '',
  visitor_reviews integer not null default 0 check (visitor_reviews >= 0),
  blog_reviews integer not null default 0 check (blog_reviews >= 0),
  competitor_count integer not null default 0 check (competitor_count >= 0),
  competitor_avg_visitor integer not null default 0 check (competitor_avg_visitor >= 0),
  competitor_avg_blog integer not null default 0 check (competitor_avg_blog >= 0),
  collected_count integer not null default 0 check (collected_count >= 0),
  measured_on date not null default (timezone('Asia/Seoul', now()))::date,
  created_at timestamptz not null default now(),
  unique (user_id, store_key, measured_on)
);

create index if not exists publy_place360_snapshots_lookup_idx
  on public.publy_place360_snapshots(user_id, store_key, measured_on desc);

alter table public.publy_place360_snapshots enable row level security;
revoke all on public.publy_place360_snapshots from anon, authenticated;

create table if not exists public.publy_place360_ranks (
  id uuid primary key default gen_random_uuid(), user_id uuid not null, store_key text not null,
  keyword text not null, rank integer check (rank is null or rank > 0), checked_count integer not null default 0,
  surface text not null default '네이버 지도 PC', device text not null default 'PC', measured_at timestamptz not null default now()
);
create index if not exists publy_place360_ranks_lookup_idx on public.publy_place360_ranks(user_id, store_key, keyword, measured_at desc);
alter table public.publy_place360_ranks enable row level security;
revoke all on public.publy_place360_ranks from anon, authenticated;

create or replace function public.publy_place360_save_snapshot(
  p_token text, p_store_key text, p_store_name text, p_region text, p_category text,
  p_visitor_reviews integer, p_blog_reviews integer, p_competitor_count integer,
  p_competitor_avg_visitor integer, p_competitor_avg_blog integer, p_collected_count integer
) returns public.publy_place360_snapshots
language plpgsql security definer set search_path = '' as $$
declare
  v_user_id uuid;
  v_plan text;
  v_store_limit integer;
  v_daily_limit integer;
  v_history_days integer;
  v_store_count integer;
  v_today_count integer;
  v_row public.publy_place360_snapshots;
begin
  select user_id into v_user_id from public.publy_sessions
  where token_hash = encode(extensions.digest(coalesce(p_token, ''), 'sha256'), 'hex')
    and is_admin is false and expires_at > now() limit 1;
  if v_user_id is null then raise exception using errcode = 'P0001', message = 'INVALID_SESSION'; end if;
  if length(trim(coalesce(p_store_key, ''))) < 2 then raise exception using errcode = 'P0001', message = 'INVALID_STORE'; end if;

  select plan into v_plan from public.publy_users where id = v_user_id and is_active is true and place360_enabled is true;
  if v_plan is null then raise exception using errcode = 'P0001', message = 'PLACE360_DISABLED'; end if;
  v_store_limit := case v_plan when 'basic' then 2 when 'pro' then 5 when 'unlimited' then 999999 else 1 end;
  v_daily_limit := case v_plan when 'basic' then 3 when 'pro' then 10 when 'unlimited' then 999999 else 1 end;
  v_history_days := case v_plan when 'basic' then 90 when 'pro' then 180 when 'unlimited' then 3650 else 30 end;
  select count(distinct store_key) into v_store_count from public.publy_place360_snapshots where user_id = v_user_id;
  if not exists(select 1 from public.publy_place360_snapshots where user_id = v_user_id and store_key = p_store_key) and v_store_count >= v_store_limit then
    raise exception using errcode = 'P0001', message = 'PLACE360_STORE_LIMIT';
  end if;
  select count(*) into v_today_count from public.publy_place360_snapshots where user_id = v_user_id and measured_on = (timezone('Asia/Seoul', now()))::date;
  if not exists(select 1 from public.publy_place360_snapshots where user_id = v_user_id and store_key = p_store_key and measured_on = (timezone('Asia/Seoul', now()))::date) and v_today_count >= v_daily_limit then
    raise exception using errcode = 'P0001', message = 'PLACE360_DAILY_LIMIT';
  end if;

  insert into public.publy_place360_snapshots(
    user_id, store_key, store_name, region, category, visitor_reviews, blog_reviews,
    competitor_count, competitor_avg_visitor, competitor_avg_blog, collected_count
  ) values (
    v_user_id, left(trim(p_store_key), 180), left(trim(p_store_name), 180), left(coalesce(p_region, ''), 120), left(coalesce(p_category, ''), 120),
    greatest(coalesce(p_visitor_reviews, 0), 0), greatest(coalesce(p_blog_reviews, 0), 0), greatest(coalesce(p_competitor_count, 0), 0),
    greatest(coalesce(p_competitor_avg_visitor, 0), 0), greatest(coalesce(p_competitor_avg_blog, 0), 0), greatest(coalesce(p_collected_count, 0), 0)
  ) on conflict (user_id, store_key, measured_on) do update set
    store_name = excluded.store_name, region = excluded.region, category = excluded.category,
    visitor_reviews = excluded.visitor_reviews, blog_reviews = excluded.blog_reviews,
    competitor_count = excluded.competitor_count, competitor_avg_visitor = excluded.competitor_avg_visitor,
    competitor_avg_blog = excluded.competitor_avg_blog, collected_count = excluded.collected_count,
    created_at = now()
  returning * into v_row;
  delete from public.publy_place360_snapshots where user_id = v_user_id and measured_on < (timezone('Asia/Seoul', now()))::date - v_history_days;
  return v_row;
end;
$$;

create or replace function public.publy_place360_get_snapshots(p_token text, p_store_key text)
returns setof public.publy_place360_snapshots
language plpgsql security definer set search_path = '' as $$
declare v_user_id uuid;
begin
  select user_id into v_user_id from public.publy_sessions
  where token_hash = encode(extensions.digest(coalesce(p_token, ''), 'sha256'), 'hex')
    and is_admin is false and expires_at > now() limit 1;
  if v_user_id is null then raise exception using errcode = 'P0001', message = 'INVALID_SESSION'; end if;
  return query select * from public.publy_place360_snapshots
    where user_id = v_user_id and store_key = p_store_key
    order by measured_on desc limit 120;
end;
$$;

create or replace function public.publy_place360_save_rank(p_token text, p_store_key text, p_keyword text, p_rank integer, p_checked_count integer, p_surface text, p_device text)
returns public.publy_place360_ranks language plpgsql security definer set search_path = '' as $$
declare v_user_id uuid; v_plan text; v_limit integer; v_used integer; v_row public.publy_place360_ranks;
begin
  select s.user_id into v_user_id from public.publy_sessions s where s.token_hash = encode(extensions.digest(coalesce(p_token, ''), 'sha256'), 'hex') and s.is_admin is false and s.expires_at > now() limit 1;
  if v_user_id is null then raise exception using errcode='P0001', message='INVALID_SESSION'; end if;
  select plan into v_plan from public.publy_users where id=v_user_id and is_active is true and place360_enabled is true;
  if v_plan is null then raise exception using errcode='P0001', message='PLACE360_DISABLED'; end if;
  v_limit := case v_plan when 'basic' then 10 when 'pro' then 30 when 'unlimited' then 999999 else 3 end;
  select count(*) into v_used from public.publy_place360_ranks where user_id=v_user_id and measured_at >= timezone('Asia/Seoul', now())::date;
  if v_used >= v_limit then raise exception using errcode='P0001', message='PLACE360_RANK_DAILY_LIMIT'; end if;
  insert into public.publy_place360_ranks(user_id,store_key,keyword,rank,checked_count,surface,device) values(v_user_id,left(p_store_key,180),left(trim(p_keyword),180),p_rank,greatest(p_checked_count,0),left(p_surface,80),left(p_device,30)) returning * into v_row;
  return v_row;
end; $$;

create or replace function public.publy_place360_get_ranks(p_token text, p_store_key text)
returns setof public.publy_place360_ranks language plpgsql security definer set search_path = '' as $$
declare v_user_id uuid;
begin
  select s.user_id into v_user_id from public.publy_sessions s where s.token_hash=encode(extensions.digest(coalesce(p_token,''),'sha256'),'hex') and s.is_admin is false and s.expires_at>now() limit 1;
  if v_user_id is null then raise exception using errcode='P0001', message='INVALID_SESSION'; end if;
  return query select * from public.publy_place360_ranks where user_id=v_user_id and store_key=p_store_key order by measured_at desc limit 300;
end; $$;

create or replace function public.publy_place360_admin_list(p_token text, p_search text default '')
returns setof public.publy_place360_snapshots
language plpgsql security definer set search_path = '' as $$
begin
  if not exists(select 1 from public.publy_sessions where token_hash = encode(extensions.digest(coalesce(p_token, ''), 'sha256'), 'hex') and is_admin is true and expires_at > now()) then
    raise exception using errcode = 'P0001', message = 'INVALID_ADMIN_SESSION';
  end if;
  return query select s.* from public.publy_place360_snapshots s
    join public.publy_users u on u.id = s.user_id
    where coalesce(p_search, '') = '' or s.store_name ilike '%' || p_search || '%' or u.name ilike '%' || p_search || '%' or u.email ilike '%' || p_search || '%'
    order by s.created_at desc limit 500;
end;
$$;

create or replace function public.publy_place360_admin_delete(p_token text, p_id uuid)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  if not exists(select 1 from public.publy_sessions where token_hash = encode(extensions.digest(coalesce(p_token, ''), 'sha256'), 'hex') and is_admin is true and expires_at > now()) then
    raise exception using errcode = 'P0001', message = 'INVALID_ADMIN_SESSION';
  end if;
  delete from public.publy_place360_snapshots where id = p_id;
  return found;
end;
$$;

revoke all on function public.publy_place360_save_snapshot(text,text,text,text,text,integer,integer,integer,integer,integer,integer) from public;
revoke all on function public.publy_place360_get_snapshots(text,text) from public;
grant execute on function public.publy_place360_save_snapshot(text,text,text,text,text,integer,integer,integer,integer,integer,integer) to anon, authenticated;
grant execute on function public.publy_place360_get_snapshots(text,text) to anon, authenticated;
revoke all on function public.publy_place360_save_rank(text,text,text,integer,integer,text,text) from public;
revoke all on function public.publy_place360_get_ranks(text,text) from public;
grant execute on function public.publy_place360_save_rank(text,text,text,integer,integer,text,text) to anon, authenticated;
grant execute on function public.publy_place360_get_ranks(text,text) to anon, authenticated;
revoke all on function public.publy_place360_admin_list(text,text) from public;
revoke all on function public.publy_place360_admin_delete(text,uuid) from public;
grant execute on function public.publy_place360_admin_list(text,text) to anon, authenticated;
grant execute on function public.publy_place360_admin_delete(text,uuid) to anon, authenticated;

commit;
