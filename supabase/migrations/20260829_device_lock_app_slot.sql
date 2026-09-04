-- 🔒 기기 잠금 슬롯 3분리: 같은 PC의 웹·앱이 한 슬롯을 두고 서로 뺏어 튕기던 문제 근본 해결.
-- active_device_id        = PC 웹(브라우저)
-- active_app_device_id    = 설치형 앱(Electron)  ← 신규
-- active_mobile_device_id = 모바일(설치 PWA/모바일 웹)
-- → 앱1 + 웹1 + 모바일1 동시 로그인 허용. 각 슬롯은 같은 종류끼리만 경쟁(다른 PC 앱이 이 앱을 밀어냄).
alter table public.publy_users add column if not exists active_app_device_id text;
