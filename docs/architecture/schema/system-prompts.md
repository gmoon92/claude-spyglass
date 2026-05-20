# system_prompts 테이블

LLM 요청에 함께 전송되는 system 본문을 hash 기반 정규화 dedup 저장하는 카탈로그 테이블입니다.

## 개요

| 항목 | 내용 |
|------|------|
| 목적 | body.system 본문 content-addressable dedup 저장 |
| 정규화 방식 | billing-header 제거 → 텍스트 블록 결합 → BOM/CRLF 정규화 |
| 해시 알고리즘 | SHA-256(UTF-8 정규화 본문), hex 64자 |
| 주요 참조 소스 | `packages/server/src/proxy/system-hash.ts: normalizeSystem()` |

## 컬럼 정의

| 컬럼명 | 타입 | 제약조건 | 설명 |
|--------|------|----------|------|
| `hash` | TEXT | PRIMARY KEY NOT NULL | SHA-256(정규화 본문) hex 64자, content-addressable PK |
| `content` | TEXT | NOT NULL | 정규화된 system 본문 (billing-header idx[0] 제외, idx[1]+ 결합) |
| `byte_size` | INTEGER | NOT NULL | UTF-8 byte 길이 — UI 'X KB' 라벨 표시용 캐시 |
| `segment_count` | INTEGER | NOT NULL DEFAULT 1 | 정규화에 사용된 text 항목 수 (string 입력이면 1, 배열이면 billing-header 제외 후 개수) |
| `first_seen_at` | INTEGER | NOT NULL | 최초 INSERT 시각 (Unix timestamp, milliseconds) |
| `last_seen_at` | INTEGER | NOT NULL | 마지막 사용 시각 (Unix timestamp, milliseconds) — UPSERT마다 갱신 |
| `ref_count` | INTEGER | NOT NULL DEFAULT 1 | 참조된 proxy_requests 수 — UPSERT마다 +1 |
| `created_at` | INTEGER | NOT NULL DEFAULT (strftime('%s','now') * 1000) | 레코드 생성 시각 (Unix timestamp, milliseconds) |

## 인덱스

| 인덱스명 | 컬럼 | 용도 |
|----------|------|------|
| `idx_system_prompts_last_seen` | `last_seen_at DESC` | 라이브러리 패널 최근 사용 순 정렬 |
| `idx_system_prompts_ref_count` | `ref_count DESC` | 빈도 높은 페르소나 순 정렬 |
| `idx_proxy_requests_system_hash` | `proxy_requests.system_hash` | system_hash 역참조 조회 |

## 데이터 샘플

```sql
-- 가장 자주 사용된 system prompt 조회
SELECT hash, byte_size, segment_count, ref_count, last_seen_at
FROM system_prompts
ORDER BY ref_count DESC
LIMIT 10;

-- 특정 hash의 본문 lazy-fetch
SELECT content FROM system_prompts WHERE hash = ?;

-- 최근 등장한 신규 system prompt
SELECT hash, byte_size, first_seen_at
FROM system_prompts
ORDER BY first_seen_at DESC
LIMIT 20;
```

## 관계

- **N:1** ← `proxy_requests.system_hash` (실제 FK 제약 없음 — backfill 옵션으로 NULL 허용)
- `proxy_requests`에는 `system_hash`(참조 키)와 `system_byte_size`(UI 라벨 캐시) 컬럼이 함께 추가됨

## 참고사항

- 정규화 로직 상세: `packages/server/src/proxy/system-hash.ts: normalizeSystem()` 참조
- UPSERT 전략: 동일 hash 재등장 시 `last_seen_at` 갱신 + `ref_count + 1`, `content`·`first_seen_at`은 변경 없음
- `proxy_requests.system_hash → system_prompts(hash)` 참조는 인덱스만 존재하며 FK 제약은 없음. `system_prompts` 행은 삭제하지 않는 정책이므로 참조 무결성 위반 가능성 없음
- v21 `system_reminder`(user 메시지 내 `<system-reminder>` 블록)와 책임이 완전히 분리됨 — 두 채널은 데이터를 공유하지 않음
- CRUD 인터페이스: `packages/storage/src/queries/system-prompt.ts` 참조
