-- 🔒 기기 잠금 완화: 데스크탑 슬롯 1개(같은 PC의 웹+앱 공존) + 모바일 슬롯 1개를 동시 허용.
-- 기존 active_device_id = 데스크탑(PC 웹/앱) 활성 기기.
-- 신규 active_mobile_device_id = 모바일(설치 앱/모바일 웹) 활성 기기.
-- → PC와 모바일이 서로의 자리를 뺏지 않아 "다른 곳에서 로그인" 튕김이 사라짐.
--   같은 플랫폼(예: 다른 PC)에서 새로 로그인하면 그 플랫폼 슬롯만 교체되어 이전 기기는 튕김(계정 공유 방지 유지).
alter table public.publy_users add column if not exists active_mobile_device_id text;
