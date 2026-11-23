-- =============================================================================
-- 068 — Claude 5 계열 모델 context window 시드 추가
-- =============================================================================
-- 배경:
--   026 시드는 4.x 이하 패턴만 갖고 있어 claude-opus-5-5 · claude-sonnet-5-5 ·
--   claude-haiku-5-5 · claude-fable-5-2 같은 5 계열 모델이 어떤 패턴에도 맞지 않았다.
--   미매칭 시 getModelMaxTokens() 는 200K 시드에 "그 모델로 관측된 최대 컨텍스트" 를
--   max() 로 묶어 한도로 삼으므로, window_max 가 관측 최대치와 같아지고
--   context_saturation 이 가장 큰 세션을 항상 100%(critical) 로 판정했다.
--
-- 근거 (공식 문서 — Models overview, 2026-11-23 조회):
--   https://platform.claude.com/docs/en/about-claude/models/overview
--   "All models" 표에서 아래 모델의 Context window 가 전부 1M tokens 이다.
--     Fable 5 / 5.1 / 5.2, Mythos 5 / 5.1 / 5.2(제한 공개),
--     Opus 5 / 5.5, Sonnet 5 / 5.5, Haiku 5.5, 그리고 Opus 4.8.
--   (Opus 4.8 은 026 의 `claude-opus-4` 200K 패턴에 가려지던 4.x 누락분이다.)
--
-- 패턴 설계:
--   - 매칭은 substring + 최장 우선(queries/model-limits.ts getAllModelLimits).
--   - 5 계열은 family 접두(`claude-<family>-5`)로 두어 5 / 5-1 / 5-2 / 5-5 를 한 행으로 받는다.
--   - `claude-opus-4-8` 은 더 긴 패턴이라 `claude-opus-4`(200K) 보다 먼저 매칭된다.
--   - 문서에 한도가 적히지 않은 모델은 넣지 않는다.
--
-- 멱등: INSERT OR IGNORE. 기존 행은 건드리지 않는다.
-- 반영: model-limits 시드는 프로세스 캐시라 서버 재시작 후 적용된다.
-- =============================================================================

INSERT OR IGNORE INTO model_limits (pattern, max_tokens, notes) VALUES
  ('claude-fable-5',   1000000, 'Anthropic Fable 5.x (5 / 5.1 / 5.2) — 1M context, Models overview 2026-11-23'),
  ('claude-mythos-5',  1000000, 'Anthropic Mythos 5.x (제한 공개) — 1M context, Models overview 2026-11-23'),
  ('claude-opus-5',    1000000, 'Anthropic Opus 5 / 5.5 — 1M context, Models overview 2026-11-23'),
  ('claude-sonnet-5',  1000000, 'Anthropic Sonnet 5 / 5.5 — 1M context, Models overview 2026-11-23'),
  ('claude-haiku-5',   1000000, 'Anthropic Haiku 5.5 — 1M context, Models overview 2026-11-23'),
  ('claude-opus-4-8',  1000000, 'Anthropic Opus 4.8 — 1M context, Models overview 2026-11-23');
