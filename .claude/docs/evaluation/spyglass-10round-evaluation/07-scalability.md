# 라운드 6: 확장성 및 유지보수성 평가

> 평가자: 데이터 엔지니어링 전문가
> 점수: **5/10**

---

## 검토 대상 파일

- `packages/storage/src/schema.ts` - 마이그레이션 정의
- `packages/storage/src/connection.ts` - 연결 및 마이그레이션 실행
- `packages/storage/src/queries/*.ts` - 쿼리 로직

---

## 마이그레이션 시스템 분석

```typescript
// schema.ts에 하드코딩된 마이그레이션
export const MIGRATION_V2 = `
ALTER TABLE requests ADD COLUMN tool_detail TEXT;
`;

export const MIGRATION_V3 = `
ALTER TABLE requests ADD COLUMN turn_id TEXT;
CREATE INDEX IF NOT EXISTS idx_requests_turn ON requests(turn_id);

-- 대량 UPDATE (성능 문제!)
UPDATE requests SET turn_id = ...
WHERE type = 'prompt';
`;

export const MIGRATION_V6 = `...`;  // v6
export const MIGRATION_V7 = `...`;  // v7 <- v6보다 앞에 정의됨!
```

**발견된 문제:** 코드 상 V6이 V7보다 뒤에 정의됨 (순서 혼란)

---

## 강점

### 1. 버전 관리
```typescript
export const SCHEMA_VERSION = 10;
```
- SCHEMA_VERSION 상수로 버전 관리

### 2. 멱등성 고려
```sql
-- MIGRATION_V9
UPDATE requests SET tool_detail = ...
WHERE tool_name = 'Skill'
  AND (
    tool_detail IS NULL
    OR tool_detail != json_extract(payload, '$.tool_input.skill')
  );
```
- `IF NOT EXISTS`, `IF NULL` 등으로 중복 실행 방지

---

## 약점/문제점

### 1. 마이그레이션 실행 순서 문제 (심각) 🔴

```typescript
// connection.ts
for (let v = currentVersion + 1; v <= SCHEMA_VERSION; v++) {
  const migration = (SCHEMA_META as Record<string, string>)[`MIGRATION_V${v}`];
  // MIGRATION_V6, V7이 순서대로 실행되지 않을 수 있음
}
```

**문제:**
- V1~V8: `PRAGMA table_info`로 컬럼 존재 여부 체크
- V9~V10: `PRAGMA user_version` 기반 실행
- 하이브리드 방식으로 인해 마이그레이션 실행 순서 보장 어려움
- V6이 V7보다 코드 상 뒤에 정의됨

### 2. 롤백 전략 부재 🔴

```typescript
// 마이그레이션 실행
export function runMigrations(db: Database) {
  const currentVersion = getUserVersion(db);
  
  for (let v = currentVersion + 1; v <= SCHEMA_VERSION; v++) {
    const migration = getMigration(v);
    db.exec(migration);  // 실패 시?
    setUserVersion(db, v);
  }
}

// 문제: 마이그레이션 실패 시 복구 메커니즘 없음
// 문제: 롤백 불가능
```

### 3. 마이그레이션 하드코딩

```typescript
// schema.ts에 모든 마이그레이션 하드코딩
// 파일이 커지고 복잡해짐
// 팀 협업 시 충돌 발생 가능
```

### 4. 대용량 데이터 처리 미흡

```sql
-- MIGRATION_V3: 대량 UPDATE
UPDATE requests
SET turn_id = session_id || '-T' || ((
  SELECT COUNT(*)
  FROM requests r2
  WHERE r2.session_id = requests.session_id
    AND r2.type = 'prompt'
    AND r2.timestamp < requests.timestamp
) + 1)
WHERE type = 'prompt';
```

**문제:**
- 100만+ 행 테이블에서 전체 스캔
- 트랜잭션 롤백 가능성
- SQLite 단일 쓰기 잠금으로 다른 작업 블록

### 5. 대용량 세션 처리 미흡

```typescript
// getTurnsBySession
export function getTurnsBySession(db: Database, sessionId: string): Turn[] {
  const rows = db.query(`
    SELECT * FROM requests 
    WHERE session_id = ? 
    ORDER BY timestamp
  `).all(sessionId);
  
  // 메모리 내 그룹화
  return groupByTurn(rows);  // O(n) 메모리 사용
}
```

**문제:**
- 1만+ 턴 세션에서 메모리 부족 가능성
- 페이지네이션 없음

### 6. 동시성 제한

```sql
-- SQLite WAL 모드도 단일 쓰기 잠금
-- 대량 INSERT 시 다른 읽기/쓰기 대기
```

---

## 개선 제안

### 1. 마이그레이션 파일 분리

```
migrations/
├── 001-init.sql
├── 002-add-tool-detail.sql
├── 003-add-turn-id.sql
├── 004-add-source.sql
├── 005-add-cache-tokens.sql
├── 006-add-claude-events.sql
├── 007-add-preview.sql
├── 008-add-tool-use-id.sql
├── 009-fix-skill-detail.sql
└── 010-expand-preview.sql
```

```typescript
// migration-runner.ts
export async function runMigrations(db: Database) {
  const currentVersion = getUserVersion(db);
  const files = await readdir('./migrations');
  
  for (const file of files.sort()) {
    const version = parseInt(file.split('-')[0]);
    if (version > currentVersion) {
      const sql = await readFile(`./migrations/${file}`, 'utf-8');
      
      // 트랜잭션으로 실행
      db.transaction(() => {
        db.exec(sql);
        setUserVersion(db, version);
      })();
      
      console.log(`Migration ${version} applied`);
    }
  }
}
```

### 2. 청크 단위 마이그레이션

```typescript
// 대량 UPDATE 청크 처리
export function migrateTurnIdsChunked(db: Database) {
  const BATCH_SIZE = 1000;
  let offset = 0;
  
  while (true) {
    const batch = db.query(`
      SELECT id FROM requests 
      WHERE type = 'prompt' AND turn_id IS NULL
      LIMIT ? OFFSET ?
    `).all(BATCH_SIZE, offset);
    
    if (batch.length === 0) break;
    
    db.transaction(() => {
      for (const row of batch) {
        const turnId = calculateTurnId(db, row.id);
        db.run('UPDATE requests SET turn_id = ? WHERE id = ?', turnId, row.id);
      }
    })();
    
    offset += BATCH_SIZE;
    console.log(`Migrated ${offset} rows...`);
  }
}
```

### 3. 롤백 지원

```sql
-- migrations/003-add-turn-id.sql
-- @up
ALTER TABLE requests ADD COLUMN turn_id TEXT;
CREATE INDEX idx_requests_turn ON requests(turn_id);

-- @down
DROP INDEX idx_requests_turn;
ALTER TABLE requests DROP COLUMN turn_id;
```

```typescript
// 롤백 실행
export function rollbackMigration(db: Database, targetVersion: number) {
  const currentVersion = getUserVersion(db);
  
  for (let v = currentVersion; v > targetVersion; v--) {
    const downSql = getDownMigration(v);
    db.transaction(() => {
      db.exec(downSql);
      setUserVersion(db, v - 1);
    })();
  }
}
```

### 4. 쿼리 페이지네이션

```typescript
// getTurnsBySession 개선
export function getTurnsBySession(
  db: Database, 
  sessionId: string,
  options: { limit?: number; offset?: number } = {}
): PaginatedResult<Turn> {
  const { limit = 100, offset = 0 } = options;
  
  const rows = db.query(`
    SELECT * FROM requests 
    WHERE session_id = ? 
    ORDER BY timestamp
    LIMIT ? OFFSET ?
  `).all(sessionId, limit, offset);
  
  const total = db.query('SELECT COUNT(*) FROM requests WHERE session_id = ?')
    .get(sessionId) as number;
  
  return {
    data: groupByTurn(rows),
    pagination: {
      total,
      limit,
      offset,
      hasMore: offset + limit < total
    }
  };
}
```

---

## 실용성 점수: 5/10

**근거:**
- ✅ 버전 관리는 기본적으로 되어 있음
- ✅ 멱등성 고려는 잘 되어 있음
- ⚠️ 마이그레이션 시스템 불일치는 장기적 리스크
- ⚠️ 대용량 데이터 처리는 미흡
- ❌ 롤백 전략 없음
- ❌ 팀 협업 시 schema.ts 충돌 가능성

**데이터 전문가 의견:**
> "마이그레이션 파일을 별도로 분리하지 않고 schema.ts에 하드코딩하면, 팀 협업 시 충돌이 발생합니다. v6이 v7보다 뒤에 정의된 것도 보니 순서 관리에 문제가 있습니다. Flyway나 dbmate 같은 도구 도입을 고려해야 합니다."
>
> **권장:** 마이그레이션을 개별 파일로 분리하고, 청크 단위 처리 및 롤백 기능을 추가하세요.
