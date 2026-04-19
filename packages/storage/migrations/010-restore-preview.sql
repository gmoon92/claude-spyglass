-- Migration 010: preview 컬럼 재추출
-- v7에서 preview가 100자로 제한되어 저장됨. 이 마이그레이션은 payload에서
-- 최대 2000자까지 재추출하여 미리보기 복원
-- 조건: type='prompt' AND payload NOT NULL AND json_valid(payload)
-- 멱등성: json_extract(...) IS NOT NULL 조건으로 payload 없는 행 제외

UPDATE requests
SET preview = substr(json_extract(payload, '$.prompt'), 1, 2000)
WHERE type = 'prompt'
  AND payload IS NOT NULL
  AND json_valid(payload)
  AND json_extract(payload, '$.prompt') IS NOT NULL;
