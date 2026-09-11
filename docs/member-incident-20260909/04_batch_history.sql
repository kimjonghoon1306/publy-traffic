-- 삭제 timeout이 publy_history 대량 삭제/FK 비용임을 확인했을 때만 사용.
-- 대상별 백업/복원 방법 확보 + 해당 회원의 퍼블리/트래픽 봇 작업 중단 후 실행.
-- 이 파일은 '한 배치=한 트랜잭션'으로 최대 500행을 삭제한다. 반복 DO 루프 아님.
-- 각 COMMIT 이후 삭제는 영구적. 회원 최종 삭제가 실패해도 이전 배치는 복구되지 않음.
-- 01에서 publy_history를 참조하는 하위 FK/트리거 확인, 03 인덱스 먼저 보완.
-- 다른 테이블은 FK 하위부터 순서를 확정한 뒤 별도 배치 작성. 모든 user_id 테이블 자동 삭제 금지.
begin;
set local lock_timeout='3s';
set local statement_timeout='20s';
do $$
declare
 v_confirm boolean := false; -- 백업/중단/대상/삭제 승인 확인 후 true
 v_id uuid := '00000000-0000-0000-0000-000000000000';
 v_email text := 'REPLACE_WITH_EXACT_EMAIL';
 v_rows integer;
begin
 if not v_confirm or v_id='00000000-0000-0000-0000-000000000000'::uuid then
  raise exception 'STOP: confirm backup, stopped jobs and target';
 end if;
 perform 1 from public.publy_users where id=v_id and email=v_email for update;
 if not found then raise exception 'STOP: target mismatch'; end if;
 -- tableoid까지 비교하여 상속/파티션 간 ctid 중복으로 타 회원이 삭제되는 것을 방지.
 with batch as (
  select tableoid,ctid from public.publy_history where user_id=v_id limit 500 for update
 ), removed as (
  delete from public.publy_history h using batch b
  where h.tableoid=b.tableoid and h.ctid=b.ctid and h.user_id=v_id returning 1
 ) select count(*) into v_rows from removed;
 raise notice 'deleted history rows: %',v_rows;
end $$;
commit;
-- 매 실행 성공/삭제 건수 기록. 0행이 될 때까지 수동 반복. SKIP LOCKED를 쓰지 않아 0을 완료로 오인하지 않음.
-- 0행이어도 하위 데이터/비FK 이메일 데이터가 모두 정리됐다는 뜻은 아님.
-- 백링크 order/게시물은 실제 RPC/FK 확인 후 하위부터 별도 정리한다.
-- 최종 회원 삭제는 06 원자적 RPC를 사용하며, 유효 관리자 토큰/시크릿은 소스에 저장하지 않는다.
-- 실패 시 중단하고 SQL Editor 세션이 aborted이면 ROLLBACK; 후 원인 확인.
