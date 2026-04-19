-- Migration 004: source 컬럼 추가
-- requests 테이블에 요청 출처 정보 저장 컬럼 추가

ALTER TABLE requests ADD COLUMN source TEXT;
