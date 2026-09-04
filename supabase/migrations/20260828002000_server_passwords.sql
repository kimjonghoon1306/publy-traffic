begin;

create or replace function public.publy_change_password(p_token text, p_current_password text, p_new_password text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user public.publy_users%rowtype;
begin
  select u.* into v_user
  from public.publy_sessions s
  join public.publy_users u on u.id = s.user_id
  where s.token_hash = encode(extensions.digest(coalesce(p_token, ''), 'sha256'), 'hex')
    and s.expires_at > now() and u.is_active is true
  limit 1;
  if v_user.id is null then raise exception using errcode = 'P0001', message = 'INVALID_SESSION'; end if;
  if extensions.crypt(p_current_password, v_user.password_hash) <> v_user.password_hash then
    raise exception using errcode = 'P0001', message = 'INVALID_CURRENT_PASSWORD';
  end if;
  if length(coalesce(p_new_password, '')) < 6 then
    raise exception using errcode = 'P0001', message = 'WEAK_PASSWORD';
  end if;
  update public.publy_users
  set password_hash = extensions.crypt(p_new_password, extensions.gen_salt('bf', 10)), updated_at = now()
  where id = v_user.id;
  delete from public.publy_sessions where user_id = v_user.id and token_hash <> encode(extensions.digest(p_token, 'sha256'), 'hex');
  return true;
end;
$$;

create or replace function public.publy_admin_change_password(p_token text, p_new_password text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.publy_admin_session_get(p_token) then
    raise exception using errcode = 'P0001', message = 'INVALID_ADMIN_SESSION';
  end if;
  if length(coalesce(p_new_password, '')) < 6 then
    raise exception using errcode = 'P0001', message = 'WEAK_PASSWORD';
  end if;
  insert into public.publy_settings(key, value)
  values ('admin_pw_hash', to_jsonb(extensions.crypt(p_new_password, extensions.gen_salt('bf', 10))))
  on conflict (key) do update set value = excluded.value, updated_at = now();
  delete from public.publy_sessions where is_admin is true;
  return true;
end;
$$;

revoke all on function public.publy_change_password(text, text, text) from public;
revoke all on function public.publy_admin_change_password(text, text) from public;
grant execute on function public.publy_change_password(text, text, text) to anon, authenticated;
grant execute on function public.publy_admin_change_password(text, text) to anon, authenticated;

commit;
