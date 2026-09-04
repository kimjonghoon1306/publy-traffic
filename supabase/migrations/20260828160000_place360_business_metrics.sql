begin;

create table if not exists public.publy_place360_business_metrics (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  store_key text not null,
  store_name text not null,
  current_new_customers integer not null default 0 check (current_new_customers >= 0),
  previous_new_customers integer not null default 0 check (previous_new_customers >= 0),
  current_repeat_customers integer not null default 0 check (current_repeat_customers >= 0),
  previous_repeat_customers integer not null default 0 check (previous_repeat_customers >= 0),
  current_ad_spend integer not null default 0 check (current_ad_spend >= 0),
  previous_ad_spend integer not null default 0 check (previous_ad_spend >= 0),
  current_ad_actions integer not null default 0 check (current_ad_actions >= 0),
  previous_ad_actions integer not null default 0 check (previous_ad_actions >= 0),
  current_sales integer not null default 0 check (current_sales >= 0),
  previous_sales integer not null default 0 check (previous_sales >= 0),
  measured_on date not null default (timezone('Asia/Seoul', now()))::date,
  updated_at timestamptz not null default now(),
  unique (user_id, store_key)
);

create index if not exists publy_place360_business_metrics_lookup_idx
  on public.publy_place360_business_metrics(user_id, updated_at desc);
alter table public.publy_place360_business_metrics enable row level security;
revoke all on public.publy_place360_business_metrics from anon, authenticated;

create or replace function public.publy_place360_enforce_store_limit()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_plan text; v_limit integer; v_count integer;
begin
  if exists(select 1 from public.publy_place360_snapshots where user_id=new.user_id and store_key=new.store_key)
     or exists(select 1 from public.publy_place360_business_metrics where user_id=new.user_id and store_key=new.store_key) then return new; end if;
  select plan into v_plan from public.publy_users where id=new.user_id and is_active is true and place360_enabled is true;
  if v_plan is null then raise exception using errcode='P0001', message='PLACE360_DISABLED'; end if;
  v_limit := case v_plan when 'basic' then 2 when 'pro' then 5 when 'unlimited' then 999999 else 1 end;
  select count(*) into v_count from (
    select store_key from public.publy_place360_snapshots where user_id=new.user_id
    union select store_key from public.publy_place360_business_metrics where user_id=new.user_id
  ) stores;
  if v_count >= v_limit then raise exception using errcode='P0001', message='PLACE360_STORE_LIMIT'; end if;
  return new;
end; $$;

drop trigger if exists publy_place360_snapshot_store_limit on public.publy_place360_snapshots;
create trigger publy_place360_snapshot_store_limit before insert on public.publy_place360_snapshots
for each row execute function public.publy_place360_enforce_store_limit();

create or replace function public.publy_place360_save_business_metrics(
  p_token text, p_store_key text, p_store_name text,
  p_current_new_customers integer, p_previous_new_customers integer,
  p_current_repeat_customers integer, p_previous_repeat_customers integer,
  p_current_ad_spend integer, p_previous_ad_spend integer,
  p_current_ad_actions integer, p_previous_ad_actions integer,
  p_current_sales integer, p_previous_sales integer
) returns public.publy_place360_business_metrics
language plpgsql security definer set search_path = '' as $$
declare v_user_id uuid; v_plan text; v_store_limit integer; v_store_count integer; v_row public.publy_place360_business_metrics;
begin
  select s.user_id into v_user_id from public.publy_sessions s
  where s.token_hash = encode(extensions.digest(coalesce(p_token, ''), 'sha256'), 'hex') and s.is_admin is false and s.expires_at > now() limit 1;
  if v_user_id is null then raise exception using errcode='P0001', message='INVALID_SESSION'; end if;
  if length(trim(coalesce(p_store_key, ''))) < 2 then raise exception using errcode='P0001', message='INVALID_STORE'; end if;
  select u.plan into v_plan from public.publy_users u where u.id=v_user_id and u.is_active is true and u.place360_enabled is true;
  if v_plan is null then raise exception using errcode='P0001', message='PLACE360_DISABLED'; end if;
  v_store_limit := case v_plan when 'basic' then 2 when 'pro' then 5 when 'unlimited' then 999999 else 1 end;
  select count(*) into v_store_count from (
    select store_key from public.publy_place360_snapshots where user_id=v_user_id
    union select store_key from public.publy_place360_business_metrics where user_id=v_user_id
  ) stores;
  if not exists(select 1 from public.publy_place360_business_metrics where user_id=v_user_id and store_key=p_store_key)
     and not exists(select 1 from public.publy_place360_snapshots where user_id=v_user_id and store_key=p_store_key)
     and v_store_count >= v_store_limit then
    raise exception using errcode='P0001', message='PLACE360_STORE_LIMIT';
  end if;
  insert into public.publy_place360_business_metrics(
    user_id,store_key,store_name,current_new_customers,previous_new_customers,current_repeat_customers,previous_repeat_customers,
    current_ad_spend,previous_ad_spend,current_ad_actions,previous_ad_actions,current_sales,previous_sales,measured_on,updated_at
  ) values (
    v_user_id,left(trim(p_store_key),180),left(trim(p_store_name),180),
    least(greatest(coalesce(p_current_new_customers,0),0),1000000000),least(greatest(coalesce(p_previous_new_customers,0),0),1000000000),
    least(greatest(coalesce(p_current_repeat_customers,0),0),1000000000),least(greatest(coalesce(p_previous_repeat_customers,0),0),1000000000),
    least(greatest(coalesce(p_current_ad_spend,0),0),1000000000),least(greatest(coalesce(p_previous_ad_spend,0),0),1000000000),
    least(greatest(coalesce(p_current_ad_actions,0),0),1000000000),least(greatest(coalesce(p_previous_ad_actions,0),0),1000000000),
    least(greatest(coalesce(p_current_sales,0),0),1000000000),least(greatest(coalesce(p_previous_sales,0),0),1000000000),
    (timezone('Asia/Seoul', now()))::date,now()
  ) on conflict (user_id,store_key) do update set
    store_name=excluded.store_name,current_new_customers=excluded.current_new_customers,previous_new_customers=excluded.previous_new_customers,
    current_repeat_customers=excluded.current_repeat_customers,previous_repeat_customers=excluded.previous_repeat_customers,
    current_ad_spend=excluded.current_ad_spend,previous_ad_spend=excluded.previous_ad_spend,
    current_ad_actions=excluded.current_ad_actions,previous_ad_actions=excluded.previous_ad_actions,
    current_sales=excluded.current_sales,previous_sales=excluded.previous_sales,measured_on=excluded.measured_on,updated_at=now()
  returning * into v_row;
  return v_row;
end; $$;

create or replace function public.publy_place360_get_business_metrics(p_token text, p_store_key text)
returns setof public.publy_place360_business_metrics language plpgsql security definer set search_path = '' as $$
declare v_user_id uuid;
begin
  select s.user_id into v_user_id from public.publy_sessions s
  where s.token_hash=encode(extensions.digest(coalesce(p_token,''),'sha256'),'hex') and s.is_admin is false and s.expires_at>now() limit 1;
  if v_user_id is null then raise exception using errcode='P0001', message='INVALID_SESSION'; end if;
  return query select * from public.publy_place360_business_metrics where user_id=v_user_id and store_key=p_store_key limit 1;
end; $$;

create or replace function public.publy_place360_admin_business_metrics(p_token text)
returns table(
  id uuid,user_id uuid,store_key text,store_name text,current_new_customers integer,previous_new_customers integer,
  current_repeat_customers integer,previous_repeat_customers integer,current_ad_spend integer,previous_ad_spend integer,
  current_ad_actions integer,previous_ad_actions integer,current_sales integer,previous_sales integer,measured_on date,updated_at timestamptz,
  member_name text,email text,plan text
) language plpgsql security definer set search_path = '' as $$
begin
  if not exists(select 1 from public.publy_sessions where token_hash=encode(extensions.digest(coalesce(p_token,''),'sha256'),'hex') and is_admin is true and expires_at>now()) then
    raise exception using errcode='P0001', message='INVALID_ADMIN_SESSION';
  end if;
  return query select m.id,m.user_id,m.store_key,m.store_name,m.current_new_customers,m.previous_new_customers,
    m.current_repeat_customers,m.previous_repeat_customers,m.current_ad_spend,m.previous_ad_spend,
    m.current_ad_actions,m.previous_ad_actions,m.current_sales,m.previous_sales,m.measured_on,m.updated_at,
    coalesce(u.name,''),coalesce(u.email,''),coalesce(u.plan,'free')
  from public.publy_place360_business_metrics m join public.publy_users u on u.id=m.user_id
  order by m.updated_at desc limit 500;
end; $$;

create or replace function public.publy_place360_admin_delete_business_metrics(p_token text, p_id uuid)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  if not exists(select 1 from public.publy_sessions where token_hash=encode(extensions.digest(coalesce(p_token,''),'sha256'),'hex') and is_admin is true and expires_at>now()) then
    raise exception using errcode='P0001', message='INVALID_ADMIN_SESSION';
  end if;
  delete from public.publy_place360_business_metrics where id=p_id;
  return found;
end; $$;

create or replace function public.publy_place360_delete_store(p_token text, p_store_key text)
returns boolean language plpgsql security definer set search_path = '' as $$
declare v_user_id uuid;
begin
  select s.user_id into v_user_id from public.publy_sessions s
  where s.token_hash=encode(extensions.digest(coalesce(p_token,''),'sha256'),'hex') and s.is_admin is false and s.expires_at>now() limit 1;
  if v_user_id is null then raise exception using errcode='P0001', message='INVALID_SESSION'; end if;
  delete from public.publy_place360_ranks where user_id=v_user_id and store_key=p_store_key;
  delete from public.publy_place360_snapshots where user_id=v_user_id and store_key=p_store_key;
  delete from public.publy_place360_business_metrics where user_id=v_user_id and store_key=p_store_key;
  return true;
end; $$;

create or replace function public.publy_place360_rename_store(p_token text, p_old_store_key text, p_new_store_key text, p_store_name text, p_region text)
returns boolean language plpgsql security definer set search_path = '' as $$
declare v_user_id uuid;
begin
  select s.user_id into v_user_id from public.publy_sessions s
  where s.token_hash=encode(extensions.digest(coalesce(p_token,''),'sha256'),'hex') and s.is_admin is false and s.expires_at>now() limit 1;
  if v_user_id is null then raise exception using errcode='P0001', message='INVALID_SESSION'; end if;
  if p_old_store_key=p_new_store_key then return true; end if;
  if length(trim(coalesce(p_new_store_key,'')))<2 then raise exception using errcode='P0001', message='INVALID_STORE'; end if;
  if exists(select 1 from public.publy_place360_snapshots where user_id=v_user_id and store_key=p_new_store_key)
     or exists(select 1 from public.publy_place360_business_metrics where user_id=v_user_id and store_key=p_new_store_key) then
    raise exception using errcode='P0001', message='PLACE360_STORE_EXISTS';
  end if;
  update public.publy_place360_ranks set store_key=left(p_new_store_key,180) where user_id=v_user_id and store_key=p_old_store_key;
  update public.publy_place360_snapshots set store_key=left(p_new_store_key,180),store_name=left(trim(p_store_name),180),region=left(coalesce(p_region,''),120) where user_id=v_user_id and store_key=p_old_store_key;
  update public.publy_place360_business_metrics set store_key=left(p_new_store_key,180),store_name=left(trim(p_store_name),180),updated_at=now() where user_id=v_user_id and store_key=p_old_store_key;
  return true;
end; $$;

revoke all on function public.publy_place360_save_business_metrics(text,text,text,integer,integer,integer,integer,integer,integer,integer,integer,integer,integer) from public;
revoke all on function public.publy_place360_get_business_metrics(text,text) from public;
revoke all on function public.publy_place360_admin_business_metrics(text) from public;
revoke all on function public.publy_place360_admin_delete_business_metrics(text,uuid) from public;
revoke all on function public.publy_place360_delete_store(text,text) from public;
revoke all on function public.publy_place360_rename_store(text,text,text,text,text) from public;
grant execute on function public.publy_place360_save_business_metrics(text,text,text,integer,integer,integer,integer,integer,integer,integer,integer,integer,integer) to anon, authenticated;
grant execute on function public.publy_place360_get_business_metrics(text,text) to anon, authenticated;
grant execute on function public.publy_place360_admin_business_metrics(text) to anon, authenticated;
grant execute on function public.publy_place360_admin_delete_business_metrics(text,uuid) to anon, authenticated;
grant execute on function public.publy_place360_delete_store(text,text) to anon, authenticated;
grant execute on function public.publy_place360_rename_store(text,text,text,text,text) to anon, authenticated;

commit;
