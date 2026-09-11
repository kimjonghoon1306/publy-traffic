-- 선택적 보안 수정. 로그인 불능의 확정 원인 수정이라고 주장하지 않음.
-- 로컬 20260828000000_server_sessions.sql의 NULL 비교 결함을 운영에도 있을 때만 교체.
-- 운영 전체 함수 덮어쓰기 대신 정확한 조건 한 군데만 수정, 다른 정의면 중단.
-- 01에서 운영 정의/ACL을 백업하고 검토한 뒤 v_reviewed=true로 변경.
begin;
set local lock_timeout='3s';
set local statement_timeout='20s';
do $patch$
declare
 v_reviewed boolean := false;
 v_oid regprocedure := to_regprocedure('public.publy_login(text,text)');
 v_def text;
 v_old text := 'if v_user.id is null or extensions.crypt(p_password, v_user.password_hash) <> v_user.password_hash then';
 v_new text := 'if v_user.id is null or p_password is null or nullif(v_user.password_hash, '''') is null then
    raise exception using errcode = ''P0001'', message = ''INVALID_CREDENTIALS'';
  end if;
  if extensions.crypt(p_password, v_user.password_hash) is distinct from v_user.password_hash then';
begin
 if not v_reviewed then raise exception 'STOP: review and save live definition first'; end if;
 if v_oid is null then raise exception 'STOP: live login signature not found'; end if;
 v_def := pg_get_functiondef(v_oid);
 if (length(v_def)-length(replace(v_def,v_old,'')))/length(v_old) <> 1 then
  raise exception 'STOP: live body differs; no automatic replacement';
 end if;
 execute replace(v_def,v_old,v_new);
end $patch$;
commit;
-- 잘못된 비번/NULL 입력/NULL 해시 => INVALID_CREDENTIALS 및 세션 생성 없음 검증 필요.
-- 실제 회원 해시를 NULL로 바꾸며 시험하지 말 것. 별도 테스트 DB/테스트 회원 사용.
-- publy_change_password의 유사 NULL 비교도 01 결과로 확인 후 같은 fail-closed 원칙 적용.
