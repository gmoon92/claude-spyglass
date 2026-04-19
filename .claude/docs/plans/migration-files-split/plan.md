# 마이그레이션 파일 분리

## 목표

`packages/storage/src/schema.ts`에 하드코딩된 `MIGRATION_V2` ~ `MIGRATION_V12` 상수들을 `packages/storage/migrations/*.sql` 개별 파일로 분리한다. 마이그레이션 로더는 디렉토리를 스캔하여 순차 실행한다.

## 배경

`.claude/docs/evaluation/final-evaluation.md`의 P1(4.2 마이그레이션 시스템 비일관성).

- 현재: SQL 문자열이 TypeScript 상수로 코드에 박혀 있음 → 마이그레이션 리뷰·diff·실험이 어려움
- V1~V8은 `PRAGMA table_info` 방식, V9~V12는 `user_version` 방식 혼재
- 롤백 전략 부재 (이번 작업 범위 밖, 후속)

## 작업 범위

### 1. 디렉토리 구조

```
packages/storage/
├── migrations/
│   ├── 001-init.sql
│   ├── 002-add-project-to-sessions.sql
│   ├── 003-add-tool-stats.sql
│   ├── 004-add-notification-threshold.sql
│   ├── 005-add-duration-ms.sql
│   ├── 006-...
│   ├── ...
│   ├── 011-token-confidence-and-hook-events.sql
│   └── 012-timestamp-index-and-visible-requests-view.sql
└── src/
    ├── schema.ts        # 상수 제거 (또는 SCHEMA_VERSION만 유지)
    ├── connection.ts    # 마이그레이션 로더 리팩토링
    └── migrator.ts      # (신규) 파일 기반 로더
```

### 2. 파일 네이밍

`NNN-kebab-case-description.sql` — `NNN`은 3자리 zero-padded version number.

내용 규칙:
- 파일 하나 = `user_version` N → N+1의 한 단계
- 파일 끝부분에 `PRAGMA user_version = N;` 포함 (로더가 자동 설정하지 않음 — 명시적)
- SQL 주석으로 목적·날짜 기재

### 3. 로더 구현

`packages/storage/src/migrator.ts` (신규):

```typescript
import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import type { Database } from 'bun:sqlite';

const MIGRATIONS_DIR = join(import.meta.dir, '..', 'migrations');

export function runMigrations(db: Database): void {
  const current = db.query('PRAGMA user_version').get() as { user_version: number };
  const currentVersion = current.user_version;

  const files = readdirSync(MIGRATIONS_DIR)
    .filter(f => f.endsWith('.sql'))
    .sort();

  for (const file of files) {
    const version = parseInt(file.slice(0, 3), 10);
    if (version <= currentVersion) continue;

    const sql = readFileSync(join(MIGRATIONS_DIR, file), 'utf8');
    db.transaction(() => {
      db.exec(sql);
    })();
    console.log(`[migration] applied ${file}`);
  }
}
```

`connection.ts`의 `runMigrations`는 새 로더로 위임.

### 4. 기존 상수 제거

`schema.ts`에서 `MIGRATION_V2` ~ `MIGRATION_V12` 상수 삭제.
`INIT_SCHEMA`는 `001-init.sql`로 이동.
`SCHEMA_VERSION` 상수는 유지 (최신 버전 참조용).

### 5. 기존 DB 호환성

- 기존 사용자는 이미 `user_version=12`에 도달한 상태
- 새 로더는 `version <= currentVersion`인 파일은 스킵 → 무해
- V12까지 적용된 DB는 변경 없음

### 6. 초기화 흐름

새 DB 생성 시:
1. `001-init.sql` 실행 → 기본 테이블
2. `002-*.sql` ~ `012-*.sql` 순차 실행

각 파일이 idempotent이므로 (`IF NOT EXISTS`, `IF NOT COLUMN EXISTS` 등) 중복 실행 안전.

## 변경 파일

- `packages/storage/migrations/*.sql` (신규 12개 파일)
- `packages/storage/src/migrator.ts` (신규)
- `packages/storage/src/schema.ts` (상수 제거)
- `packages/storage/src/connection.ts` (로더 위임)

## 검증

- 빈 DB에서 시작 → 최종 `user_version = 12` 확인
- 기존 DB(v12)에서 기동 → 아무 마이그레이션 실행되지 않음
- `bun x tsc --noEmit` 통과
- `bun run doctor` 정상 동작 (스키마 체크 포함)

## 주의사항

- Bun은 `import.meta.dir`로 번들 경로 접근 가능. 배포 시 `migrations/` 디렉토리가 포함되어야 함 (package.json의 `files` 또는 `workspaces` 설정 확인)
- 각 SQL 파일 끝의 `PRAGMA user_version = N`은 **생략 가능** — 로더가 파일 이름에서 버전 파싱 후 자동 설정하도록 구현해도 됨. 이 경우 파일은 순수 DDL만 포함.
- 로더에서 자동 설정 방식을 권장 (더 깔끔)
