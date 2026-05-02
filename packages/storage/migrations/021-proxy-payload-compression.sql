-- Migration v21: proxy_requests payload compression + system_reminder
-- 압축된 원문 payload 저장 및 system-reminder 원문 보관

-- proxy_requests: 압축 payload 저장용 컬럼
ALTER TABLE proxy_requests ADD COLUMN payload BLOB;
ALTER TABLE proxy_requests ADD COLUMN payload_raw_size INTEGER;
ALTER TABLE proxy_requests ADD COLUMN payload_algo TEXT DEFAULT 'zstd';

-- proxy_requests: system-reminder 원문 (압축 전)
ALTER TABLE proxy_requests ADD COLUMN system_reminder TEXT;

-- requests: payload 압축 컬럼 (hook 측 페이로드도 동일 방식)
ALTER TABLE requests ADD COLUMN payload BLOB;
ALTER TABLE requests ADD COLUMN payload_raw_size INTEGER;
ALTER TABLE requests ADD COLUMN payload_algo TEXT DEFAULT 'zstd';
