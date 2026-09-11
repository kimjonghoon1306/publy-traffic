-- 읽기 전용: 실제 존재하는 단일 FK 열 및 user_id/customer/order_id/account_id의
-- 선두 btree 인덱스가 없는 경우 DDL 후보를 생성. 자동 실행하지 않음.
-- 01의 느린 삭제 대상/하위 FK와 대조해 필요한 것만 선택.
-- 복합 FK는 01 결과로 별도 검토. 파티션 테이블은 이 생성기에서 제외.
with candidates as (
 select c.oid,n.nspname,c.relname,a.attnum,a.attname
 from pg_class c join pg_namespace n on n.oid=c.relnamespace
 join pg_attribute a on a.attrelid=c.oid
 where n.nspname='public' and c.relkind='r' and a.attnum>0 and not a.attisdropped
 and (a.attname in ('user_id','customer','order_id','account_id') or exists (
  select 1 from pg_constraint f where f.contype='f' and f.conrelid=c.oid
  and cardinality(f.conkey)=1 and a.attnum=any(f.conkey)))
)
select relname,attname,format('CREATE INDEX CONCURRENTLY %I ON %I.%I (%I);',
 'incident_'||substr(md5(oid::text||':'||attnum::text),1,20)||'_idx',nspname,relname,attname) as proposed_sql
from candidates c where not exists (
 select 1 from pg_index i join pg_class ic on ic.oid=i.indexrelid join pg_am am on am.oid=ic.relam
 where i.indrelid=c.oid and i.indisvalid and i.indisready and i.indpred is null
 and i.indkey[0]=c.attnum and am.amname='btree'
) order by relname,attname;
-- 생성된 CREATE INDEX CONCURRENTLY는 BEGIN/DO 없이 한 문장씩 별도 실행.
-- SQL Editor가 transaction block 오류를 내면 직접 DB 연결의 autocommit 세션에서 실행.
-- timeout/취소 후 pg_index.indisvalid 확인: 실패한 동일 이름 인덱스가 있으면 먼저 상태 조사.
-- IF NOT EXISTS는 invalid 인덱스를 정상으로 오인할 수 있어 의도적으로 사용하지 않음.
-- 전역 anon/database timeout 변경은 하지 않음. 인덱스는 삭제의 행 탐색/FK 확인 비용을 줄이지만
-- 잠금 대기, 트리거, 외부 호출, 실제 대량 데이터 비용은 별도 해결해야 함.
