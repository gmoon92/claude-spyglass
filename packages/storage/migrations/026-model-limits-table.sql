-- =============================================================================
-- 026 — model_limits 테이블 + 모델별 context window 시드 (SSoT 이관)
-- =============================================================================
-- 배경:
--   기존에 모델별 context-window 한도는 server/src/model-limits.ts의 정적 배열에
--   하드코딩되어 있었다. spyglass는 단일 사용자가 아니라 운영 환경 전반에서 쓰이며,
--   Anthropic(Opus/Sonnet/Haiku 4.x) 외 Kimi 같은 비-Anthropic 모델도 프록시한다.
--   따라서 모델별 한도 정책을 코드 밖, DB의 데이터 영역으로 끌어낸다.
--
-- 정책:
--   - `pattern`: 모델명에 포함되면 매칭 (substring/prefix). 결정 우선순위는 추론 코드 책임.
--   - `max_tokens`: 토큰 단위 context window 한도.
--   - `notes`: 출처/근거(예: GA 발표일, 메이커 발표값).
--   - 운영자는 신규 모델이 등장하면 migration 추가 또는 직접 INSERT/UPDATE로 갱신.
--   - INSERT OR IGNORE — 멱등 보장. 마이그레이터 재실행 안전.
--
-- 추론 우선순위 (server/src/model-limits.ts):
--   1) 모델명 `[1m]` suffix          → EXTENDED (1M)
--   2) anthropic-beta `context-1m-2025-08-07` 포함 → EXTENDED (1M)
--   3) 이 테이블의 pattern 매칭(최장 매칭 우선) → max_tokens 그대로
--   4) 위 모두 미매칭                → 200K 폴백
--
-- 변경 영향:
--   - server model-limits.ts가 모듈 로드 시 SELECT로 시드 로드 → 인메모리 캐시.
--   - /api/metrics/context-usage 등의 사용률 계산 정확도가 모델 확장과 함께 자동 진화.
-- =============================================================================

CREATE TABLE IF NOT EXISTS model_limits (
  pattern    TEXT    PRIMARY KEY,
  max_tokens INTEGER NOT NULL,
  notes      TEXT
);

-- 추론 시 prefix 길이가 긴 것이 먼저 매칭되도록 정책을 부여하기 위해, GA 1M (구체) 항목을
-- 표준 200K (상위 family) 보다 더 길고 구체적인 패턴으로 둔다. 매칭은 코드에서 최장 우선.

-- Anthropic Claude — GA 1M context (beta 헤더 없이도 1M 기본)
INSERT OR IGNORE INTO model_limits (pattern, max_tokens, notes) VALUES
  ('claude-opus-4-7',   1000000, 'Anthropic Opus 4.7 — GA 1M context'),
  ('claude-opus-4-6',   1000000, 'Anthropic Opus 4.6 — GA 1M context'),
  ('claude-sonnet-4-6', 1000000, 'Anthropic Sonnet 4.6 — GA 1M context');

-- Anthropic Claude — 표준 200K (family 폴백)
INSERT OR IGNORE INTO model_limits (pattern, max_tokens, notes) VALUES
  ('claude-opus-4',     200000, 'Anthropic Opus 4.x 표준 200K (GA 1M 미포함 베이스)'),
  ('claude-sonnet-4',   200000, 'Anthropic Sonnet 4.x 표준 200K (GA 1M 미포함 베이스)'),
  ('claude-haiku-4',    200000, 'Anthropic Haiku 4.x 표준 200K'),
  ('claude-3-5-sonnet', 200000, 'Anthropic Sonnet 3.5 — 표준 200K'),
  ('claude-3-5-haiku',  200000, 'Anthropic Haiku 3.5 — 표준 200K'),
  ('claude-3-opus',     200000, 'Anthropic Opus 3 — 표준 200K');

-- Moonshot Kimi — 운영자가 실제값으로 조정 가능 (UPDATE model_limits SET max_tokens=... WHERE pattern='kimi-k2';)
INSERT OR IGNORE INTO model_limits (pattern, max_tokens, notes) VALUES
  ('kimi-k2', 128000, 'Moonshot Kimi K2 series — 기본 128K (운영자가 UPDATE로 보정 가능)');
