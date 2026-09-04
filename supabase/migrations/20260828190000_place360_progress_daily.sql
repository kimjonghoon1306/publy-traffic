begin;

alter table public.publy_place360_progress add column if not exists mission_date date not null default (timezone('Asia/Seoul',now()))::date;
update public.publy_place360_progress set mission_date=(timezone('Asia/Seoul',updated_at))::date;

create or replace function public.publy_place360_save_missions(p_token text,p_store_key text,p_completed_missions jsonb)
returns public.publy_place360_progress language plpgsql security definer set search_path='' as $$
declare v_user_id uuid; v_missions jsonb; v_row public.publy_place360_progress; v_today date := (timezone('Asia/Seoul',now()))::date;
begin
  v_user_id := public.publy_place360_progress_user(p_token);
  if v_user_id is null then raise exception using errcode='P0001',message='INVALID_SESSION'; end if;
  if not exists(select 1 from public.publy_place360_stores where user_id=v_user_id and store_key=left(trim(coalesce(p_store_key,'')),180)) then raise exception using errcode='P0001',message='INVALID_STORE'; end if;
  if jsonb_typeof(coalesce(p_completed_missions,'[]'::jsonb)) <> 'array' then raise exception using errcode='P0001',message='INVALID_MISSIONS'; end if;
  select coalesce(jsonb_agg(value order by value),'[]'::jsonb) into v_missions from (
    select distinct left(trim(value),80) value from jsonb_array_elements_text(coalesce(p_completed_missions,'[]'::jsonb)) where length(trim(value)) between 1 and 80 limit 30
  ) safe;
  insert into public.publy_place360_progress(user_id,store_key,completed_missions,mission_date)
  values(v_user_id,left(trim(p_store_key),180),v_missions,v_today)
  on conflict(user_id,store_key) do update set completed_missions=excluded.completed_missions,mission_date=v_today,updated_at=now()
  returning * into v_row;
  return v_row;
end; $$;

commit;
