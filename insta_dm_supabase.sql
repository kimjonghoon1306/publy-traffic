-- ══════════════════════════════════════════════
-- 인스타 DM 관련 Supabase 테이블 생성 SQL
-- ══════════════════════════════════════════════

-- 1. 타겟 계정 테이블 (크롤링 or 직접 입력)
CREATE TABLE IF NOT EXISTS insta_dm_targets (
  id            UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id       TEXT NOT NULL,
  username      TEXT NOT NULL,
  followers     INTEGER DEFAULT 0,
  bio           TEXT DEFAULT '',
  keywords      TEXT DEFAULT '',
  status        TEXT DEFAULT 'pending' CHECK (status IN ('pending','sent','fail','skip')),
  instagram_account TEXT DEFAULT '',
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_insta_dm_targets_user_id ON insta_dm_targets(user_id);
CREATE INDEX IF NOT EXISTS idx_insta_dm_targets_status  ON insta_dm_targets(status);

-- 2. 발송 이력 테이블
CREATE TABLE IF NOT EXISTS insta_dm_history (
  id                UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id           TEXT NOT NULL,
  target_username   TEXT NOT NULL,
  message           TEXT DEFAULT '',
  instagram_account TEXT DEFAULT '',
  status            TEXT DEFAULT 'sent' CHECK (status IN ('sent','fail')),
  created_at        TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_insta_dm_history_user_id    ON insta_dm_history(user_id);
CREATE INDEX IF NOT EXISTS idx_insta_dm_history_created_at ON insta_dm_history(created_at DESC);

-- 3. 회원별 한도 테이블
CREATE TABLE IF NOT EXISTS insta_dm_quota (
  id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id     TEXT NOT NULL UNIQUE,
  daily_limit INTEGER DEFAULT 60,
  used_today  INTEGER DEFAULT 0,
  is_enabled  BOOLEAN DEFAULT true,
  reset_date  TEXT DEFAULT '',
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_insta_dm_quota_user_id ON insta_dm_quota(user_id);

-- ══════════════════════════════════════════════
-- RLS
--   ⚠️ 이 앱은 Supabase Auth를 사용하지 않습니다.
--   anon 키 + 자체 publy_users(email/password_hash) 인증이라 auth.uid()는 항상 NULL.
--   따라서 auth.uid() 기반 정책을 켜면 일반 사용자가 본인 데이터까지 전부 차단됩니다
--   (admin-publy만 동작). 접근 제어는 기존 테이블과 동일하게 앱단(.eq("user_id", ...))에서 처리합니다.
--   → RLS는 끄고 둡니다.
-- ══════════════════════════════════════════════

-- 이전 버전에서 잘못 생성된 정책 제거 (있으면)
DROP POLICY IF EXISTS "insta_dm_targets_own" ON insta_dm_targets;
DROP POLICY IF EXISTS "insta_dm_history_own" ON insta_dm_history;
DROP POLICY IF EXISTS "insta_dm_quota_own"   ON insta_dm_quota;

ALTER TABLE insta_dm_targets DISABLE ROW LEVEL SECURITY;
ALTER TABLE insta_dm_history  DISABLE ROW LEVEL SECURITY;
ALTER TABLE insta_dm_quota    DISABLE ROW LEVEL SECURITY;
