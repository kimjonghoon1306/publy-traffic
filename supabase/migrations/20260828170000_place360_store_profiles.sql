begin;

create table if not exists public.publy_place360_stores (
  id uuid primary key default gen_random_uuid(), user_id uuid not null, store_key text not null,
  store_name text not null, place_url text not null default '', category text not null default '', region text not null default '',
  goal text not null default 'visitors' check (goal in ('visitors','reviews','exposure','repeat')),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique(user_id,store_key)
);
create index if not exists publy_place360_stores_user_idx on public.publy_place360_stores(user_id,updated_at desc);
alter table public.publy_place360_stores enable row level security;
revoke all on public.publy_place360_stores from anon,authenticated;

insert into public.publy_place360_stores(user_id,store_key,store_name,category,region)
select distinct on (s.user_id,s.store_key) s.user_id,s.store_key,s.store_name,s.category,s.region
from public.publy_place360_snapshots s order by s.user_id,s.store_key,s.created_at desc
on conflict(user_id,store_key) do nothing;
insert into public.publy_place360_stores(user_id,store_key,store_name)
select m.user_id,m.store_key,m.store_name from public.publy_place360_business_metrics m
on conflict(user_id,store_key) do nothing;

create or replace function public.publy_place360_enforce_store_limit()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_plan text; v_limit integer; v_count integer;
begin
  if exists(select 1 from public.publy_place360_stores where user_id=new.user_id and store_key=new.store_key)
     or exists(select 1 from public.publy_place360_snapshots where user_id=new.user_id and store_key=new.store_key)
     or exists(select 1 from public.publy_place360_business_metrics where user_id=new.user_id and store_key=new.store_key) then return new; end if;
  select plan into v_plan from public.publy_users where id=new.user_id and is_active is true and place360_enabled is true;
  if v_plan is null then raise exception using errcode='P0001', message='PLACE360_DISABLED'; end if;
  v_limit := case v_plan when 'basic' then 2 when 'pro' then 5 when 'unlimited' then 999999 else 1 end;
  select count(*) into v_count from (
    select store_key from public.publy_place360_stores where user_id=new.user_id
    union select store_key from public.publy_place360_snapshots where user_id=new.user_id
    union select store_key from public.publy_place360_business_metrics where user_id=new.user_id
  ) stores;
  if v_count>=v_limit then raise exception using errcode='P0001',message='PLACE360_STORE_LIMIT'; end if;
  return new;
end; $$;

drop trigger if exists publy_place360_store_profile_limit on public.publy_place360_stores;
create trigger publy_place360_store_profile_limit before insert on public.publy_place360_stores for each row execute function public.publy_place360_enforce_store_limit();
drop trigger if exists publy_place360_business_store_limit on public.publy_place360_business_metrics;
create trigger publy_place360_business_store_limit before insert on public.publy_place360_business_metrics for each row execute function public.publy_place360_enforce_store_limit();

create or replace function public.publy_place360_save_store(
  p_token text,p_store_key text,p_store_name text,p_place_url text,p_category text,p_region text,p_goal text
) returns public.publy_place360_stores language plpgsql security definer set search_path='' as $$
declare v_user_id uuid; v_row public.publy_place360_stores;
begin
  select s.user_id into v_user_id from public.publy_sessions s where s.token_hash=encode(extensions.digest(coalesce(p_token,''),'sha256'),'hex') and s.is_admin is false and s.expires_at>now() limit 1;
  if v_user_id is null then raise exception using errcode='P0001',message='INVALID_SESSION'; end if;
  if not exists(select 1 from public.publy_users where id=v_user_id and is_active is true and place360_enabled is true) then raise exception using errcode='P0001',message='PLACE360_DISABLED'; end if;
  if length(trim(coalesce(p_store_key,'')))<2 or length(trim(coalesce(p_store_name,'')))<1 then raise exception using errcode='P0001',message='INVALID_STORE'; end if;
  insert into public.publy_place360_stores(user_id,store_key,store_name,place_url,category,region,goal)
  values(v_user_id,left(trim(p_store_key),180),left(trim(p_store_name),180),left(coalesce(p_place_url,''),500),left(coalesce(p_category,''),120),left(coalesce(p_region,''),120),case when p_goal in ('visitors','reviews','exposure','repeat') then p_goal else 'visitors' end)
  on conflict(user_id,store_key) do update set store_name=excluded.store_name,place_url=excluded.place_url,category=excluded.category,region=excluded.region,goal=excluded.goal,updated_at=now()
  returning * into v_row;
  return v_row;
end; $$;

create or replace function public.publy_place360_get_stores(p_token text)
returns setof public.publy_place360_stores language plpgsql security definer set search_path='' as $$
declare v_user_id uuid;
begin
  select s.user_id into v_user_id from public.publy_sessions s where s.token_hash=encode(extensions.digest(coalesce(p_token,''),'sha256'),'hex') and s.is_admin is false and s.expires_at>now() limit 1;
  if v_user_id is null then raise exception using errcode='P0001',message='INVALID_SESSION'; end if;
  return query select * from public.publy_place360_stores where user_id=v_user_id order by updated_at desc;
end; $$;

create or replace function public.publy_place360_delete_store(p_token text,p_store_key text)
returns boolean language plpgsql security definer set search_path='' as $$
declare v_user_id uuid;
begin
  select s.user_id into v_user_id from public.publy_sessions s where s.token_hash=encode(extensions.digest(coalesce(p_token,''),'sha256'),'hex') and s.is_admin is false and s.expires_at>now() limit 1;
  if v_user_id is null then raise exception using errcode='P0001',message='INVALID_SESSION'; end if;
  delete from public.publy_place360_ranks where user_id=v_user_id and store_key=p_store_key;
  delete from public.publy_place360_snapshots where user_id=v_user_id and store_key=p_store_key;
  delete from public.publy_place360_business_metrics where user_id=v_user_id and store_key=p_store_key;
  delete from public.publy_place360_stores where user_id=v_user_id and store_key=p_store_key;
  return true;
end; $$;

create or replace function public.publy_place360_rename_store(p_token text,p_old_store_key text,p_new_store_key text,p_store_name text,p_region text)
returns boolean language plpgsql security definer set search_path='' as $$
declare v_user_id uuid;
begin
  select s.user_id into v_user_id from public.publy_sessions s where s.token_hash=encode(extensions.digest(coalesce(p_token,''),'sha256'),'hex') and s.is_admin is false and s.expires_at>now() limit 1;
  if v_user_id is null then raise exception using errcode='P0001',message='INVALID_SESSION'; end if;
  if p_old_store_key=p_new_store_key then return true; end if;
  if length(trim(coalesce(p_new_store_key,'')))<2 then raise exception using errcode='P0001',message='INVALID_STORE'; end if;
  if exists(select 1 from public.publy_place360_stores where user_id=v_user_id and store_key=p_new_store_key)
     or exists(select 1 from public.publy_place360_snapshots where user_id=v_user_id and store_key=p_new_store_key)
     or exists(select 1 from public.publy_place360_business_metrics where user_id=v_user_id and store_key=p_new_store_key) then raise exception using errcode='P0001',message='PLACE360_STORE_EXISTS'; end if;
  update public.publy_place360_ranks set store_key=left(p_new_store_key,180) where user_id=v_user_id and store_key=p_old_store_key;
  update public.publy_place360_snapshots set store_key=left(p_new_store_key,180),store_name=left(trim(p_store_name),180),region=left(coalesce(p_region,''),120) where user_id=v_user_id and store_key=p_old_store_key;
  update public.publy_place360_business_metrics set store_key=left(p_new_store_key,180),store_name=left(trim(p_store_name),180),updated_at=now() where user_id=v_user_id and store_key=p_old_store_key;
  update public.publy_place360_stores set store_key=left(p_new_store_key,180),store_name=left(trim(p_store_name),180),region=left(coalesce(p_region,''),120),updated_at=now() where user_id=v_user_id and store_key=p_old_store_key;
  return true;
end; $$;

revoke all on function public.publy_place360_save_store(text,text,text,text,text,text,text) from public;
revoke all on function public.publy_place360_get_stores(text) from public;
grant execute on function public.publy_place360_save_store(text,text,text,text,text,text,text) to anon,authenticated;
grant execute on function public.publy_place360_get_stores(text) to anon,authenticated;

commit;
