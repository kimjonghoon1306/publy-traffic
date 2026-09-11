-- 관리자 본인 확인 후 대상 1명만 실행. ID/email/plan/대여/기록 유지.
-- 전제: 01에서 운영 signup/login이 extensions.crypt + bf 해시를 사용하는지 확인.
-- 해시에서 원래 비밀번호를 복원하는 SQL이 아님. 새 비밀번호를 재발급함.
-- 퍼블리와 트래픽의 공유 비밀번호가 동시에 바뀌며 기존 세션은 모두 만료됨.
-- 본인에게 결과를 안전하게 전달하고 로그인 후 개인 비밀번호로 변경하도록 안내.
-- 결과 임시 비밀번호를 채팅/저장소/공개 로그에 붙이지 말 것.
begin;
set local lock_timeout='3s';
set local statement_timeout='20s';
create temporary table incident_reset_result(email text, temporary_password text) on commit drop;
do $$
declare
 v_confirm boolean := false; -- 운영 함수/대상/본인 확인 완료 후 true
 v_id uuid := '00000000-0000-0000-0000-000000000000'; -- 실제 대상 UUID
 v_email text := 'REPLACE_WITH_EXACT_EMAIL'; -- 01 결과의 원문 이메일
 v_password text;
 v_rows integer;
begin
 if not v_confirm or v_id='00000000-0000-0000-0000-000000000000'::uuid then
  raise exception 'STOP: confirm identity and replace target UUID/email';
 end if;
 perform 1 from public.publy_users where id=v_id and email=v_email and is_active is true for update;
 if not found then raise exception 'STOP: target mismatch or inactive'; end if;
 v_password := encode(extensions.gen_random_bytes(16),'hex');
 update public.publy_users set password_hash=extensions.crypt(v_password,extensions.gen_salt('bf',10))
 where id=v_id and email=v_email;
 get diagnostics v_rows=row_count;
 if v_rows<>1 then raise exception 'STOP: expected exactly one user'; end if;
 delete from public.publy_sessions where user_id=v_id;
 insert into incident_reset_result values(v_email,v_password);
end $$;
select * from incident_reset_result;
commit;
-- COMMIT 성공까지 확인. 이 스키마에는 강제 비밀번호 변경 플래그가 확인되지 않아 강제 변경은 구현하지 않음.
-- 로그인/세션 복원/기존 대여 조회를 확인. NULL/잘못된 해시의 로그인 검증은 05도 검토.
