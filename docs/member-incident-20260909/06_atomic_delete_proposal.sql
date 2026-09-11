-- 컨트롤타워 두 요청을 한 DB 트랜잭션으로 묶는 신규 RPC 제안.
-- timeout의 실행 비용 자체는 03/04/잠금 진단으로 해결해야 함.
-- 전제: 01에서 아래 기존 함수의 서명/본문/권한 및 삭제 범위 검토.
-- admin_delete_user가 공유 계정 완전삭제를 수행하고 백링크/비FK 데이터를 어떻게 처리하는지 확인.
-- 기존 함수에 외부 HTTP/비트랜잭션 부작용이 있으면 이 래퍼만으로 롤백 보장 불가.
-- 실제 검토 완료 시 아래 false를 true로 변경. 기존 함수는 교체하지 않음.
begin;
set local lock_timeout='3s';
set local statement_timeout='20s';
do $$
begin
 if not false then raise exception 'STOP: review live delete/auth RPCs before installing'; end if;
 if to_regprocedure('public.admin_delete_user(text,uuid)') is null
 or to_regprocedure('public.admin_delete_licenses(text,text,text)') is null
 or to_regprocedure('public.publy_admin_session_get(text)') is null then
  raise exception 'STOP: unexpected live RPC signatures';
 end if;
end $$;
create function public.admin_delete_user_atomic(p_token text,p_secret text,p_user_id uuid)
returns boolean language plpgsql security definer set search_path=''
as $$
declare v_email text; v_deleted boolean;
begin
 if public.publy_admin_session_get(p_token) is distinct from true then
  raise exception 'INVALID_ADMIN_SESSION';
 end if;
 select email into v_email from public.publy_users where id=p_user_id for update;
 if not found then return false; end if;
 -- 기존 시크릿 검증을 그대로 호출. false/no-op 반환도 아래 잔존 검사로 감지.
 perform public.admin_delete_licenses(p_secret,v_email,null::text);
 if exists(select 1 from public.tool_licenses where customer=v_email) then
  raise exception 'LICENSE_DELETE_INCOMPLETE';
 end if;
 v_deleted := public.admin_delete_user(p_token,p_user_id);
 if v_deleted is distinct from true or exists(select 1 from public.publy_users where id=p_user_id) then
  raise exception 'USER_DELETE_INCOMPLETE';
 end if;
 return true;
 -- 예외/timeout을 잡아 false로 바꾸지 않는다: 전체 트랜잭션 롤백.
end $$;
revoke all on function public.admin_delete_user_atomic(text,text,uuid) from public,anon,authenticated;
grant execute on function public.admin_delete_user_atomic(text,text,uuid) to anon,authenticated;
notify pgrst,'reload schema';
commit;
-- 기존 admin_delete_user/admin_delete_licenses의 ACL은 유지.
-- 관리자 외 호출, 잘못된 secret, 삭제 실패 시 대여 보존, 성공 시 잔존 데이터 검증 필수.
-- 이메일 기반 대여 신규 발급은 회원 행 잠금과 연동되지 않을 수 있음: 삭제 중 봇/발급 작업 중단 필요.
-- 되돌리기: 호출부를 먼저 되돌린 뒤 DROP FUNCTION public.admin_delete_user_atomic(text,text,uuid);
