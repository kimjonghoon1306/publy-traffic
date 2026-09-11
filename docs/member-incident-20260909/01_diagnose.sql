-- qhhoyxexxlimbjrbwrgq / Supabase SQL Editor / postgres 관리자 전용.
-- 읽기 전용. 해시 원문, 토큰, 비밀번호를 조회하지 않는다. 블록별 실행 가능.
-- 1. 실제 RPC 정의/권한/함수별 설정: 로컬 SQL과 비교, 결과는 관리자만 보관.
select p.oid::regprocedure as signature, p.prosecdef, p.proconfig, p.proacl,
       pg_get_functiondef(p.oid) as definition
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public' and p.proname in
 ('publy_login','publy_signup','publy_change_password','publy_recover_password',
  'publy_admin_session_get','admin_delete_user','admin_delete_licenses','license_status');

-- 2. 해시 형식만 분류. hex는 형식 추정일 뿐 알고리즘 확정 아님.
select id,email,created_at,is_active,plan,
 email <> btrim(email) as email_has_spaces,
 case when password_hash is null then 'NULL'
      when password_hash='' then 'EMPTY'
      when password_hash ~ '^\$2[aby]\$[0-9]{2}\$[./A-Za-z0-9]{53}$' then 'bcrypt-shaped'
      when password_hash ~ '^[0-9a-fA-F]{64}$' then '64-hex (possibly SHA256)'
      when password_hash ~ '^[0-9a-fA-F]{32}$' then '32-hex (possibly MD5)'
      else 'other/unsupported-or-legacy' end as hash_format,
 length(password_hash) as hash_length,
 nullif(btrim(name),'') is not null as has_name,
 nullif(btrim(phone),'') is not null as has_phone
from public.publy_users order by created_at;

select lower(btrim(email)) as normalized_email, count(*) as count, array_agg(id) as ids
from public.publy_users group by lower(btrim(email)) having count(*)>1;

-- 3. 대여: exact_match=false이면 앱 .eq(customer,user.email)에서 읽히지 않음.
select u.id,u.email,u.plan as publy_plan,l.customer,l.tool,l.plan as traffic_plan,
 l.expire_at, l.customer=u.email as exact_match,
 (l.expire_at is null or l.expire_at>now()) as unexpired,
 to_jsonb(l)->>'status' as license_status
from public.publy_users u left join public.tool_licenses l
 on lower(btrim(l.customer))=lower(btrim(u.email))
where lower(btrim(u.email)) in ('s9653@naver.com','bb9653@naver.com','ojy8404@naver.com')
order by u.email,l.tool;

-- 4. publy_users 및 이메일 연결 테이블에서 출발하는 하위 FK를 재귀적으로 조회.
with recursive roots as (
 select c.oid from pg_class c join pg_namespace n on n.oid=c.relnamespace
 where n.nspname='public' and c.relkind in ('r','p') and
 (c.relname='publy_users' or exists(select 1 from pg_attribute a
  where a.attrelid=c.oid and a.attnum>0 and not a.attisdropped
    and a.attname in ('user_id','customer','email')))
), graph(oid) as (
 select oid from roots union
 select c.conrelid from pg_constraint c join graph g on g.oid=c.confrelid where c.contype='f'
)
select c.conrelid::regclass as child,c.confrelid::regclass as parent,
 c.conname,pg_get_constraintdef(c.oid) as definition
from pg_constraint c where c.contype='f' and c.confrelid in (select oid from graph)
order by c.confrelid::regclass::text,c.conrelid::regclass::text;

-- 5. FK가 없는 데이터도 존재. 실제 컬럼·인덱스·트리거 전체 목록(데이터 값 없음).
select table_name,column_name,data_type from information_schema.columns
where table_schema='public' and (column_name in ('user_id','customer','email','order_id','account_id')
 or table_name in ('publy_users','publy_sessions','tool_licenses')) order by table_name,ordinal_position;
select tablename,indexname,indexdef from pg_indexes where schemaname='public' order by tablename,indexname;
select t.tgrelid::regclass as relation,t.tgname,pg_get_triggerdef(t.oid) as definition
from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace
where n.nspname='public' and not t.tgisinternal;

-- 6. 삭제 요청이 대기 중일 때 다른 SQL Editor 탭에서 실행. 쿼리 원문은 비밀값 때문에 제외.
select pid,usename,state,wait_event_type,wait_event,now()-query_start as elapsed,
 pg_blocking_pids(pid) as blockers
from pg_stat_activity where datname=current_database() and pid<>pg_backend_pid() and state<>'idle';
select rolname,rolconfig from pg_roles where rolname in ('anon','authenticated','authenticator','postgres');
select setdatabase,setrole,setconfig from pg_db_role_setting;
show statement_timeout;
-- 위 SHOW는 SQL Editor 세션 값이며 anon RPC의 실효 timeout과 같다고 단정하지 말 것.

-- 7. UUID 타입 user_id 테이블별 대상 건수 쿼리 생성(자동 실행하지 않음).
select format('SELECT %L AS relation, count(*) FROM %I.%I WHERE user_id = %L::uuid;',
 table_name,table_schema,table_name,'REPLACE_WITH_TARGET_UUID') as count_sql
from information_schema.columns where table_schema='public' and column_name='user_id' and udt_name='uuid';
