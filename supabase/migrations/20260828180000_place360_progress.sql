begin;

create table if not exists public.publy_place360_progress (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  store_key text not null,
  completed_missions jsonb not null default '[]'::jsonb check (jsonb_typeof(completed_missions) = 'array'),
  reviewer_handoff_count integer not null default 0 check (reviewer_handoff_count >= 0),
  reviewer_handoff_at timestamptz,
  updated_at timestamptz not null default now(),
  unique(user_id, store_key)
);
create index if not exists publy_place360_progress_user_idx on public.publy_place360_progress(user_id, updated_at desc);
alter table public.publy_place360_progress enable row level security;
revoke all on public.publy_place360_progress from anon, authenticated;

create or replace function public.publy_place360_progress_user(p_token text)
returns uuid language sql stable security definer set search_path='' as $$
  select s.user_id from public.publy_sessions s
  join public.publy_users u on u.id=s.user_id
  where s.token_hash=encode(extensions.digest(coalesce(p_token,''),'sha256'),'hex')
    and s.is_admin is false and s.expires_at>now() and u.is_active is true and u.place360_enabled is true
  limit 1
$$;

create or replace function public.publy_place360_get_progress(p_token text,p_store_key text)
returns setof public.publy_place360_progress language plpgsql security definer set search_path='' as $$
declare v_user_id uuid;
begin
  v_user_id := public.publy_place360_progress_user(p_token);
  if v_user_id is null then raise exception using errcode='P0001',message='INVALID_SESSION'; end if;
  return query select * from public.publy_place360_progress where user_id=v_user_id and store_key=left(trim(coalesce(p_store_key,'')),180);
end; $$;

create or replace function public.publy_place360_save_missions(p_token text,p_store_key text,p_completed_missions jsonb)
returns public.publy_place360_progress language plpgsql security definer set search_path='' as $$
declare v_user_id uuid; v_missions jsonb; v_row public.publy_place360_progress;
begin
  v_user_id := public.publy_place360_progress_user(p_token);
  if v_user_id is null then raise exception using errcode='P0001',message='INVALID_SESSION'; end if;
  if not exists(select 1 from public.publy_place360_stores where user_id=v_user_id and store_key=left(trim(coalesce(p_store_key,'')),180)) then raise exception using errcode='P0001',message='INVALID_STORE'; end if;
  if jsonb_typeof(coalesce(p_completed_missions,'[]'::jsonb)) <> 'array' then raise exception using errcode='P0001',message='INVALID_MISSIONS'; end if;
  select coalesce(jsonb_agg(value order by value),'[]'::jsonb) into v_missions from (
    select distinct left(trim(value),80) value from jsonb_array_elements_text(coalesce(p_completed_missions,'[]'::jsonb)) where length(trim(value)) between 1 and 80 limit 30
  ) safe;
  insert into public.publy_place360_progress(user_id,store_key,completed_missions)
  values(v_user_id,left(trim(p_store_key),180),v_missions)
  on conflict(user_id,store_key) do update set completed_missions=excluded.completed_missions,updated_at=now()
  returning * into v_row;
  return v_row;
end; $$;

create or replace function public.publy_place360_record_reviewer_handoff(p_token text,p_store_key text,p_count integer)
returns public.publy_place360_progress language plpgsql security definer set search_path='' as $$
declare v_user_id uuid; v_row public.publy_place360_progress;
begin
  v_user_id := public.publy_place360_progress_user(p_token);
  if v_user_id is null then raise exception using errcode='P0001',message='INVALID_SESSION'; end if;
  if not exists(select 1 from public.publy_place360_stores where user_id=v_user_id and store_key=left(trim(coalesce(p_store_key,'')),180)) then raise exception using errcode='P0001',message='INVALID_STORE'; end if;
  if coalesce(p_count,0)<1 or p_count>10000 then raise exception using errcode='P0001',message='INVALID_HANDOFF_COUNT'; end if;
  insert into public.publy_place360_progress(user_id,store_key,reviewer_handoff_count,reviewer_handoff_at)
  values(v_user_id,left(trim(p_store_key),180),p_count,now())
  on conflict(user_id,store_key) do update set reviewer_handoff_count=public.publy_place360_progress.reviewer_handoff_count+excluded.reviewer_handoff_count,reviewer_handoff_at=now(),updated_at=now()
  returning * into v_row;
  return v_row;
end; $$;

create or replace function public.publy_place360_admin_progress(p_token text)
returns table(user_id uuid,member_name text,email text,plan text,store_key text,store_name text,completed_missions jsonb,reviewer_handoff_count integer,reviewer_handoff_at timestamptz,updated_at timestamptz)
language plpgsql security definer set search_path='' as $$
begin
  if not exists(select 1 from public.publy_sessions where token_hash=encode(extensions.digest(coalesce(p_token,''),'sha256'),'hex') and is_admin is true and expires_at>now()) then raise exception using errcode='P0001',message='INVALID_ADMIN_SESSION'; end if;
  return query select p.user_id,u.name,u.email,u.plan,p.store_key,s.store_name,p.completed_missions,p.reviewer_handoff_count,p.reviewer_handoff_at,p.updated_at
  from public.publy_place360_progress p join public.publy_users u on u.id=p.user_id left join public.publy_place360_stores s on s.user_id=p.user_id and s.store_key=p.store_key order by p.updated_at desc;
end; $$;

create or replace function public.publy_place360_admin_reset_progress(p_token text,p_user_id uuid,p_store_key text)
returns boolean language plpgsql security definer set search_path='' as $$
begin
  if not exists(select 1 from public.publy_sessions where token_hash=encode(extensions.digest(coalesce(p_token,''),'sha256'),'hex') and is_admin is true and expires_at>now()) then raise exception using errcode='P0001',message='INVALID_ADMIN_SESSION'; end if;
  delete from public.publy_place360_progress where user_id=p_user_id and store_key=p_store_key;
  return true;
end; $$;

create or replace function public.publy_place360_delete_store(p_token text,p_store_key text)
returns boolean language plpgsql security definer set search_path='' as $$
declare v_user_id uuid;
begin
  select s.user_id into v_user_id from public.publy_sessions s where s.token_hash=encode(extensions.digest(coalesce(p_token,''),'sha256'),'hex') and s.is_admin is false and s.expires_at>now() limit 1;
  if v_user_id is null then raise exception using errcode='P0001',message='INVALID_SESSION'; end if;
  delete from public.publy_place360_progress where user_id=v_user_id and store_key=p_store_key;
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
  if exists(select 1 from public.publy_place360_stores where user_id=v_user_id and store_key=p_new_store_key) or exists(select 1 from public.publy_place360_snapshots where user_id=v_user_id and store_key=p_new_store_key) or exists(select 1 from public.publy_place360_business_metrics where user_id=v_user_id and store_key=p_new_store_key) or exists(select 1 from public.publy_place360_progress where user_id=v_user_id and store_key=p_new_store_key) then raise exception using errcode='P0001',message='PLACE360_STORE_EXISTS'; end if;
  update public.publy_place360_progress set store_key=left(p_new_store_key,180),updated_at=now() where user_id=v_user_id and store_key=p_old_store_key;
  update public.publy_place360_ranks set store_key=left(p_new_store_key,180) where user_id=v_user_id and store_key=p_old_store_key;
  update public.publy_place360_snapshots set store_key=left(p_new_store_key,180),store_name=left(trim(p_store_name),180),region=left(coalesce(p_region,''),120) where user_id=v_user_id and store_key=p_old_store_key;
  update public.publy_place360_business_metrics set store_key=left(p_new_store_key,180),store_name=left(trim(p_store_name),180),updated_at=now() where user_id=v_user_id and store_key=p_old_store_key;
  update public.publy_place360_stores set store_key=left(p_new_store_key,180),store_name=left(trim(p_store_name),180),region=left(coalesce(p_region,''),120),updated_at=now() where user_id=v_user_id and store_key=p_old_store_key;
  return true;
end; $$;

revoke all on function public.publy_place360_progress_user(text) from public;
revoke all on function public.publy_place360_get_progress(text,text) from public;
revoke all on function public.publy_place360_save_missions(text,text,jsonb) from public;
revoke all on function public.publy_place360_record_reviewer_handoff(text,text,integer) from public;
revoke all on function public.publy_place360_admin_progress(text) from public;
revoke all on function public.publy_place360_admin_reset_progress(text,uuid,text) from public;
grant execute on function public.publy_place360_get_progress(text,text) to anon,authenticated;
grant execute on function public.publy_place360_save_missions(text,text,jsonb) to anon,authenticated;
grant execute on function public.publy_place360_record_reviewer_handoff(text,text,integer) to anon,authenticated;
grant execute on function public.publy_place360_admin_progress(text) to anon,authenticated;
grant execute on function public.publy_place360_admin_reset_progress(text,uuid,text) to anon,authenticated;

commit;
