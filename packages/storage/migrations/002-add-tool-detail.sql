-- Migration 002: tool_detail 컬럼 추가
-- requests 테이블에 도구 상세 정보 저장 컬럼 추가

ALTER TABLE requests ADD COLUMN tool_detail TEXT;
