# 회원 시스템 장애 분석 및 운영 적용 제안 — 2026-09-09

운영 변경/DB 호출/커밋/푸시/배포 없음. 코드와 로컬 SQL만 분석했다. 사용자 제공 실측(11명 모두 활성 등)은 이번 작업에서 재측정하지 않았다. SQL은 수동 실행 제안이며 운영 검증 완료된 마이그레이션이 아니다.

## 1. 원인: 확인된 사실과 미확정 사항

### 기존 회원 로그인/사용 불능

- `src/pages/LoginPage.tsx:447`부터 이메일 trim, 비밀번호 원문을 `signIn`/`signUp`에 전달하고 예외 메시지를 표시한다. 기존 코드 `src/lib/supabase.ts:334`는 RPC 오류, 응답 token/user 누락을 모두 “이메일 또는 비밀번호” 오류로 표시했다. **실제 자격증명 오류인지 DB 오류인지 UI만으로 구별 불가능**했다.
- 배경과 달리 **과거 RPC 정의는 로컬에 존재**한다: `supabase/migrations/20260828000000_server_sessions.sql`, `20260828001000_server_signup.sql`, `20260828002000_server_passwords.sql`, `20260828003000_secure_recovery.sql`. 운영 배포 일치 여부는 알 수 없다. 현재 publy-BAP 호출부도 `publy_login`을 사용하므로 현재 두 앱이 서로 다른 해싱을 한다는 증거는 없다.
- 로컬 signup은 `extensions.crypt(password, extensions.gen_salt('bf',10))`로 bcrypt 생성. login은 활성 회원을 `lower(email)=lower(trim(p_email))`로 조회 후 crypt 비교, **전체 만료 세션 DELETE**, 신규 세션 INSERT, 회원 last_login/last_seen UPDATE 후 token/user 반환. 해시 불일치뿐 아니라 crypt 오류, 세션 정리 timeout, 회원 UPDATE 잠금/트리거/스키마 오류도 실패 후보다. `claimActiveDevice`의 DB 오류는 무시하므로 해당 함수의 권한 오류만으로 이 로그인 실패 문구가 발생하지는 않는다.
- 중요한 반례: 로컬 login의 `crypt(...) <> password_hash`는 hash가 NULL이면 NULL. PL/pgSQL IF가 TRUE가 아니어서 활성 회원은 검증을 통과할 수 있다. **NULL 누락이 로그인 실패 원인이라고 단정하면 잘못**이다. 운영에도 같은 식이 있다면 별도의 인증 결함이다. 05는 이 조건만 fail-closed로 바꾸는 보호된 제안이다. 기존 `publy_change_password`에도 유사 비교가 있어 후속 확인 필요.
- SHA256/MD5/타 시스템 해시 혼재는 가설이다. 01은 원문 해시를 노출하지 않고 NULL/빈값/bcrypt 형태/hex 형태를 분류한다. hex 길이만으로 알고리즘을 확정하지 않는다. 원래 비밀번호는 해시에서 복원할 수 없고 기존 해시를 다시 bcrypt해도 사용자 비밀번호가 복구되지 않는다. 본인 확인 후 02로 새 비밀번호를 발급하는 경로를 제안한다.
- 저장 이메일에 앞뒤 공백이 있으면 login의 비교에서 실패할 수 있다. 정규화 중복도 LIMIT 1 때문에 잘못된 회원을 고를 수 있다. 01에서 확인하고 실제 중복/주문 소유권을 정리하기 전 이메일 일괄 UPDATE는 하지 않는다.
- **로그인과 대여는 별도다.** `getTrafficLicenses`는 `tool_licenses.customer = user.email` 정확 일치로 조회한다. `publy_users.plan=unlimited`나 `is_active=true`가 트래픽 사용 권한을 주지 않는다. `src/TrafficApp.tsx:52`는 `remain_sec > 0`인 기능만 허용. 라이선스 누락/만료/대소문자·공백 차이/조회 권한 오류를 각각 확인해야 한다. 조회 오류도 현재 []로 숨긴다.
- 추가로 **expire_at=NULL 해석이 불일치**한다. 컨트롤타워 `index.html:867`은 유효 대여로 표시하지만 트래픽은 remain_sec=0으로 숨긴다. 대상 회원에게 NULL 대여가 있는지는 미확인. 실제 `license_status` 및 봇 만료 정책 확인 후, 무기한 의미를 클라이언트/서버 모두 일치시키거나 관리자가 계약상 만료일로 재발급해야 한다. 임의로 전 회원 기간/등급을 늘리지 않는다.
- 기존 비밀번호 찾기는 이름/전화번호를 대조하는 `publy_recover_password`이며 이메일 소유 확인 경로는 아니다. 마이그레이션 연락처 누락이면 실패 가능. 로컬 함수의 실패 EXCEPTION은 시도 횟수 갱신도 롤백할 수 있어 제한을 믿고 복구 경로를 확대하지 않았다. 이번 안내는 관리자 본인 확인 경로로 연결한다.

### 회원 삭제 timeout

- `publy-tools-admin/index.html:889` 삭제 버튼 → confirm → `admin_delete_licenses(secret,email,NULL)` → `admin_delete_user(token,id)` → true 확인 → 화면 갱신.
- **확정된 코드 결함:** 첫 RPC의 오류/결과를 무시하고 두 번째 RPC 실행. 두 요청은 독립 트랜잭션이다. 첫 요청이 성공한 뒤 두 번째가 timeout되면 **회원만 남고 대여는 이미 삭제될 수 있다**. 이전 실패 대상 회원의 대여부터 확인해야 한다. 버튼 중복 클릭 방지도 없다.
- statement timeout은 DB 문장 취소 증거이지 cascade/인덱스 부족의 확정 증거는 아니다. admin_delete_user 본문은 두 저장소에서 확인하지 못했다. 대량 삭제/FK 검사/트리거/잠금 대기/낮은 RPC timeout 모두 후보. 01에서 실제 함수·FK·인덱스·잠금·설정을 확인한다.
- 관계: publy_sessions는 로컬 SQL에서 user_id FK ON DELETE CASCADE + 인덱스 확인. publy_history/publy_accounts/publy_quotas는 코드에서 user_id 관계 확인, 실제 FK/삭제 규칙 미확인. publy_live_logs 및 place360 snapshots/ranks/business_metrics/stores/progress는 로컬에 user_id가 있어도 FK 없이 생성된 것들이 있다. **FK 조회만으로 삭제 대상을 다 찾을 수 없다.** tool_licenses는 user_id가 아니라 customer 이메일 관계다. 백링크 주문/발행 하위 데이터는 실제 테이블·order_id FK와 admin_delete_user/admin_backlink_cancel_order 동작을 확인해야 하며, 이름만 추측해 DELETE하지 않는다.

## 2. 작성한 수정안

- 트래픽 작업트리 `src/lib/supabase.ts`: 중복 가입에 기존 계정/관리자 비밀번호 재설정 안내. INVALID_CREDENTIALS와 서버/통신 오류 및 응답 누락 구분. DB 원문이나 입력 비밀번호/토큰은 새 오류 메시지에 노출하지 않음. 자격 검증/대여 권한은 우회하지 않음.
- `01_diagnose.sql`: 관리자 읽기 전용 진단. 02~06 실행 전 필수. 함수 정의 출력에는 내부 정보가 있을 수 있으므로 관리자만 보관.
- `02_reset_one_member.sql`: UUID+원문 이메일+활성 여부 확인 및 행 잠금, bcrypt 임시 비밀번호 재발급, 기존 publy_sessions 폐기. 전부 한 트랜잭션. 공유 ID/대여/결제/plan 유지. 명시적 확인 flag 기본 false. 새 비밀번호는 결과에서 본인에게 안전하게 전달하고 로그인 후 변경 안내. 강제 변경 플래그는 확인되지 않아 구현하지 않음.
- `03_index_candidates.sql`: 실제 컬럼/FK/선두 btree 인덱스를 조사해 CREATE INDEX CONCURRENTLY 후보 출력. **출력 SQL만 필요한 것 골라 별도 실행**. 복합 FK/파티션/트리거는 별도 검토. FK가 있다고 참조측 인덱스가 자동 생성되지는 않는다. [PostgreSQL 제약조건 문서](https://www.postgresql.org/docs/current/ddl-constraints.html)
- `04_batch_history.sql`: 원인이 대량 history인 경우에만, 대상 UUID+이메일 검증 후 최대 500행씩 한 번 실행/COMMIT. 긴 DO 반복문이 아니어서 요청별 작업량을 제한한다. **배치마다 영구 삭제되며 후속 실패 시 자동 복구 안 됨**. 백업과 대상 봇 중단이 전제. 다른 테이블은 실제 하위 FK 순서를 확인한 후 작성해야 한다.
- `05_login_null_guard.sql`: 운영 함수의 기존 조건이 로컬 문자열과 정확히 한 번 일치할 때만 NULL/빈 해시/NULL 입력 거부 조건을 추가. 기존 함수의 나머지 본문을 보존. 다른 본문이면 중단하고 수동 재검토.
- `06_atomic_delete_proposal.sql`: 기존 관리자 인증/대여 삭제/회원 삭제 함수를 호출하는 신규 원자적 RPC. 대여 잔존, false 반환, 회원 잔존 시 예외로 전체 롤백. **timeout 성능 개선 자체가 아니라 부분 삭제 방지**다. 실제 기존 RPC의 서명/본문/삭제 범위/외부 부작용 확인 전 설치 못 하게 막았다. 라이선스 이메일 정확 일치 범위는 기존과 같다. 비FK 백링크 정리 완전성은 이 래퍼로 새로 보장하지 않는다.
- `07_admin_atomic_delete.patch`: 새 RPC를 한 번 호출, 삭제 버튼 중복 방지, 실패 후 명단/대여 갱신. **06 설치·검증 후에만 적용**. 현재 샌드박스 쓰기 범위에 publy-tools-admin이 없어 원본 대신 patch와 `/tmp/publy-tools-admin-member-fix.html` 작성. 별도 허가 요청은 하지 않았다.

전역 timeout은 변경하지 않는다. SQL Editor용 배치에는 요청 시작 전에 SET LOCAL statement_timeout=20s, lock_timeout=3s를 둔다. 함수 내부 SET만으로 이미 시작된 RPC/게이트웨이 제한까지 해결된다고 보지 않는다. SQL Editor와 RPC의 제한이 다르므로 실행 경로를 구분해야 한다. [Supabase timeout 문서](https://supabase.com/docs/guides/database/postgres/timeouts)

## 3. 테리가 할 것 — 실행 순서

1. Supabase 프로젝트 ref가 **qhhoyxexxlimbjrbwrgq**인지 확인하고 SQL Editor 관리자 권한으로 **01만** 블록별 실행. 실제 함수 정의/ACL 저장. 대상 해시 형식, 실제 로그인 실패 code, 이메일 중복, license의 exact_match/expire_at 확인. 실패 원인이 INVALID_CREDENTIALS인지 서버 오류인지 구분한다.
2. 비밀번호 문제라면 본인 확인한 기존 회원 **1명**에 02의 UUID/email/flag를 채워 실행. 임시 비밀번호 발급과 COMMIT 성공 확인 후 트래픽 및 퍼블리 로그인/새로고침 세션 복원 확인. 원래 UUID, plan, 주문, 결제, 대여가 그대로인지 확인. 잘못된 비밀번호가 거절되는지도 확인. 운영 NULL 비교 결함이 확인되면 05를 검토·적용하고 테스트 계정에서 NULL/빈 값 거부 검증.
3. 로그인 성공 후 기능이 없으면 동일 이메일 라이선스/만료/상태/allowed_actions 및 봇 검증까지 확인. 계약상 정상 대여만 컨트롤타워에서 복구·발급. 기존 plan만 보고 무료로 대여를 자동 생성하지 않는다. NULL 만료 불일치가 원인이면 서버와 UI의 정책을 먼저 정한다.
4. 삭제 실패 대상은 먼저 대여가 이미 해지됐는지 확인. 01의 잠금/실제 delete 함수/FK/건수 결과로 원인을 좁히고 03 후보 중 필요한 인덱스만 추가. 대량 history가 원인일 때만 백업/봇 중단 후 04를 배치별 실행. 중단되면 재시도 전에 잔존 건수를 확인한다.
5. 06은 별도 테스트 환경에서 기존 RPC와 함께 검증: 관리자 아닌 token 거부, 잘못된 secret 거부 여부, 후반 회원 삭제 강제 실패/timeout 시 대여 보존, 정상 삭제 시 회원/대여/백링크/비FK 기록 잔존 여부. 삭제 트리거 외부 호출이 있으면 DB rollback으로 외부 작업은 복원되지 않을 수 있다. 테스트에 실회원 삭제를 쓰지 않는다.
6. 06 검증 후 설치 → 컨트롤타워에서 `git apply --check <07의 절대경로>` → `git apply <07의 절대경로>`. 이 작업에서는 적용/배포하지 않았다. 실제 운영 적용은 테리가 진행. 트래픽 메시지 수정 배포도 아직 하지 않았다.
7. 최종 검증은 기존 회원과 신규 회원을 각각 로그인→대여 확인→허용 기능 최소 사용까지 비교. 주문/결제/쿼터를 포함한 실사용 성공을 확인하기 전 장애 해결 완료로 판정하지 않는다.

## 4. 검증 결과/한계

- `npx tsc --noEmit -p tsconfig.json`: 통과.
- `git diff --check`: 통과.
- 수정된 signIn/signUp 코드를 TypeScript transpile 후 mock RPC로 8개 경로 확인: 자격 오류/timeout/권한/통신/응답 누락/로그인 성공/중복 가입/가입 성공. 오류 경로에서 토큰 저장·기기 등록 안 함, 성공 경로에서 수행 확인. `/tmp/test-publy-member-auth.cjs`.
- 컨트롤타워 후보 HTML 인라인 JavaScript 2개 구문 검사 통과. 브라우저 클릭·실제 RPC 통합 검증 미실행.
- PostgreSQL 서버/파서가 로컬에 없어 SQL 실제 구문/권한/데이터 실행 검증 미실행. 운영 정의 미확인에 맞춰 위험 작업은 검토 flag와 대상 placeholder로 중단된다. **SQL Editor에서 01 결과에 맞춘 검토와 테스트가 남아 있다.**
- 원래 있던 미추적 파일 `scripts/test-inflow-store.mjs`는 수정하지 않았다. 커밋/푸시 없음.
