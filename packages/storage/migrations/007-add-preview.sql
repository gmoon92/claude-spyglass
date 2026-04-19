-- Migration 007: preview 컬럼 추가
-- requests 테이블에 프롬프트 내용 미리보기 컬럼 추가

ALTER TABLE requests ADD COLUMN preview TEXT;
