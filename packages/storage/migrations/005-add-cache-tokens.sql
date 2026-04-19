-- Migration 005: 캐시 토큰 컬럼 추가
-- requests 테이블에 캐시 생성/읽기 토큰 카운트 컬럼 추가

ALTER TABLE requests ADD COLUMN cache_creation_tokens INTEGER DEFAULT 0;
ALTER TABLE requests ADD COLUMN cache_read_tokens INTEGER DEFAULT 0;
