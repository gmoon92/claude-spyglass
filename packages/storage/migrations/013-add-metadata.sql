-- Migration 013: metadata 테이블 생성
-- 서버 운영 메타데이터(마지막 cleanup 실행 시각 등) 저장용 key-value 테이블

CREATE TABLE IF NOT EXISTS metadata (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
