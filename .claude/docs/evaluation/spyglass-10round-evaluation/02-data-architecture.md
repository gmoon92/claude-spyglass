# 라운드 1: 데이터 아키텍처 평가

> 평가자: 데이터 엔지니어링 전문가
> 점수: **6.5/10**

---

## 검토 대상 파일

- `packages/storage/src/schema.ts` - 테이블 스키마
- `packages/storage/src/queries/*.ts` - 쿼리 로직
- `packages/storage/src/connection.ts` - 연결 및 마이그레이션

---

## 강점

### 1. WAL 모드 설정의 적절성
```sql
PRAGMA journal_mode = WAL;
PRAGMA synchronous = NORMAL;
PRAGMA cache_size = -64000;  -- 64MB cache
PRAGMA busy_timeout = 5000;
```
- WAL+NOMRAL+64MB 캐시 조합이 읽기 성능과 데이터 내구성의 적절한 균형점
- `busy_timeout=5000`으로 동시성 충돌 시 적절한 대기 시간 제공

### 2. 외래 키 CASCADE 정책
```sql
FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
```
- 세션 삭제 시 연관 requests 자동 정리
- 데이터 일관성 유지하면서 삭제 로직 단순화

### 3. 부분 인덱스 활용
```sql
CREATE INDEX idx_requests_tool_use_id ON requests(tool_use_id) 
WHERE tool_use_id IS NOT NULL;
```
- NULL 행을 제외하여 불필요한 인덱스 항목 감소

---

## 약점/문제점

### 1. 마이그레이션 시스템의 비체계성 (심각) 🔴

```typescript
// V1~V8: table_info 체크 방식
const tableInfo = db.query("PRAGMA table_info(requests)");
const hasColumn = tableInfo.some(col => col.name === 'tool_detail');

// V9~V10: user_version 기반 실행
const currentVersion = db.query("PRAGMA user_version").value() as number;
for (let v = currentVersion + 1; v <= SCHEMA_VERSION; v++) {
  // 마이그레이션 실행
}
```

**문제:**
- 하이브리드 방식으로 마이그레이션 실행 순서 보장 어려움
- 롤백 전략 없음
- 마이그레이션 실패 시 복구 메커니즘 부재
- V6이 V7보다 코드 상 뒤에 정의됨 (순서 혼란)

### 2. 심각한 N+1 쿼리 문제 🔴

```typescript
// getAllSessions() - 각 세션마다 2개 서브쿼리 실행
export function getAllSessions(db: Database) {
  const sessions = db.query("SELECT * FROM sessions ORDER BY started_at DESC");
  
  return sessions.map(s => ({
    ...s,
    // 세션당 1회 쿼리
    first_prompt_payload: getFirstPromptPayload(db, s.id),
    // 세션당 1회 쿼리
    last_activity_at: getLastActivity(db, s.id),
  }));
  // 100세션 = 200회 추가 쿼리
}
```

**영향:**
- 세션 수가 증가하면 성능이 선형적으로 저하
- 1000개 세션 시 2000회 추가 쿼리

### 3. 메모리 내 그룹화

```typescript
// getTurnsBySession() - 모든 행을 메모리에 로드 후 JS에서 그룹화
const rows = db.query("SELECT * FROM requests WHERE session_id = ?").all(sessionId);
const turns = groupByTurn(rows); // O(n) 메모리 사용
```

**문제:**
- 턴이 많은 세션에서 O(n) 메모리 사용과 CPU 부하
- 대용량 세션 시 페이지네이션 불가능

### 4. 하드코딩된 비즈니스 로직

```typescript
// request.ts
const MODEL_PRICING = [
  { prefix: 'claude-opus-4-', pricing: { input: 15, output: 75, ... } },
  { prefix: 'claude-sonnet-4-', pricing: { input: 3, output: 15, ... } },
  // Anthropic이 가격을 바꾸면 코드 수정 필요
];
```

### 5. 일관성 없는 필터 패턴

```typescript
// 쿼리마다 약간씩 다른 event_type 필터링

// getAllRequests
WHERE event_type IS NULL OR event_type != 'pre_tool' OR tool_name = 'Agent'

// getRequestStats  
WHERE event_type IS NULL OR event_type = 'tool'

// getToolStats
WHERE event_type IS NULL OR event_type != 'pre_tool'
```

**문제:**
- 변경 시 모든 쿼리를 개별 수정해야 함
- 뷰로 캡슐화되지 않음

### 6. 불필요한 비정규화

```sql
-- tokens_total은 계산 가능함에도 저장
ALTER TABLE requests ADD COLUMN tokens_total INTEGER DEFAULT 0;
-- tokens_input + tokens_output으로 계산 가능
```

**문제:**
- 동기화 누락 시 데이터 불일치 가능성
- 저장 공간 낭비

### 7. 부재하는 인덱스

- `timestamp` 단독 인덱스 없음
- 시간 범위 조회 시 풀 스캔 가능성

---

## 개선 제안

### 1. 마이그레이션 프레임워크 도입

```typescript
// migrations/ 디렉토리 분리
// migrations/001-init.sql
// migrations/002-add-tool-detail.sql
// migrations/003-add-turn-id.sql

// user_version 기반 순차 실행으로 통일
export function runMigrations(db: Database) {
  const currentVersion = getUserVersion(db);
  const migrations = loadMigrationFiles();
  
  for (const migration of migrations) {
    if (migration.version > currentVersion) {
      db.transaction(() => {
        db.exec(migration.sql);
        setUserVersion(db, migration.version);
      });
    }
  }
}
```

### 2. N+1 쿼리 제거

```sql
-- LEFT JOIN + 윈도우 함수로 개선
SELECT s.*, 
       first_payload.payload as first_prompt_payload,
       last_activity.max_ts as last_activity_at
FROM sessions s
LEFT JOIN (
  SELECT session_id, payload, 
         ROW_NUMBER() OVER (PARTITION BY session_id ORDER BY timestamp) as rn
  FROM requests WHERE type = 'prompt'
) first_payload ON s.id = first_payload.session_id AND first_payload.rn = 1
LEFT JOIN (
  SELECT session_id, MAX(timestamp) as max_ts
  FROM requests GROUP BY session_id
) last_activity ON s.id = last_activity.session_id;
```

### 3. event_type 필터 뷰 캡슐화

```sql
CREATE VIEW visible_requests AS
SELECT * FROM requests 
WHERE event_type IS NULL OR event_type != 'pre_tool' OR tool_name = 'Agent';

-- 모든 쿼리에서 뷰 사용
SELECT * FROM visible_requests WHERE session_id = ?;
```

### 4. 설정 외부화

```sql
-- pricing 테이블 생성
CREATE TABLE pricing (
  model_prefix TEXT PRIMARY KEY,
  input_price DECIMAL(10,6),
  output_price DECIMAL(10,6),
  cache_create_price DECIMAL(10,6),
  cache_read_price DECIMAL(10,6),
  effective_date INTEGER,
  is_active BOOLEAN DEFAULT 1
);
```

---

## 실용성 점수: 6.5/10

**근거:**
- ✅ 소규모 로컬 도구로서 기능적으로는 충분함
- ✅ WAL 모드와 부분 인덱스 등 SQLite 특화 최적화는 잘 활용
- ⚠️ 마이그레이션 시스템의 일관성 부재는 장기적인 유지보수에 심각한 리스크
- ⚠️ N+1 쿼리는 데이터 양 증가 시 급격한 성능 저하를 유발
- ⚠️ 하드코딩된 비즈니스 로직은 변경 대응력을 떨어뜨림
- ❌ 쿼리 설계의 기본 원칙(N+1 회피, 필터 일관성)이 지켜지지 않은 점이 아쉬움
