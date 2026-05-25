/**
 * ddl.test.ts — 스키마 DDL 구조 검증
 *
 * 본 테스트는 native Ladybug 모듈에 의존하지 않는다 — DDL 은 문자열 상수일 뿐이고,
 * 호출자(client.ts) 가 실행하는 부분만 추가 검증이 필요하다. 본 파일은 다음만 확인:
 *
 *   1. NODE_TABLES 가 정확히 8개 (7 도메인 + _SchemaMeta 메타)
 *   2. REL_TABLES 가 정확히 8개
 *   3. 모든 DDL 이 IF NOT EXISTS 포함 — idempotent 보장
 *   4. PRIMARY KEY 필수 노드 7개 모두 명시
 *   5. SCHEMA_VERSION 이 양의 정수
 */

import { describe, test, expect } from 'bun:test';
import { NODE_TABLES, REL_TABLES, SCHEMA_VERSION } from '../schema/ddl';

describe('Graph DDL', () => {
  test('NODE_TABLES = 7 도메인 노드 + _SchemaMeta = 8 개', () => {
    expect(NODE_TABLES.length).toBe(8);
  });

  test('REL_TABLES = 8 개 엣지 정의', () => {
    expect(REL_TABLES.length).toBe(8);
  });

  test('모든 DDL 은 IF NOT EXISTS 포함', () => {
    for (const ddl of [...NODE_TABLES, ...REL_TABLES]) {
      expect(ddl).toContain('IF NOT EXISTS');
    }
  });

  test('7 도메인 노드는 모두 PRIMARY KEY 보유', () => {
    const domainNodes = NODE_TABLES.filter((d) => !d.includes('_SchemaMeta'));
    for (const ddl of domainNodes) {
      expect(ddl).toContain('PRIMARY KEY');
    }
  });

  test('REL TABLE 정의는 FROM/TO 명시', () => {
    for (const ddl of REL_TABLES) {
      expect(ddl).toContain('FROM');
      expect(ddl).toContain('TO');
    }
  });

  test('SCHEMA_VERSION 은 양의 정수', () => {
    expect(Number.isInteger(SCHEMA_VERSION)).toBe(true);
    expect(SCHEMA_VERSION).toBeGreaterThan(0);
  });

  test('주요 엣지 타입 8종 모두 정의되어 있음', () => {
    const expectedEdges = [
      'CONTAINS',
      'NEXT',
      'SPAWNED',
      'CALLED',
      'PARENT_OF',
      'PRODUCED',
      'USES',
      'CARRIES',
    ];
    for (const t of expectedEdges) {
      const found = REL_TABLES.some((d) => d.includes(t));
      expect(found).toBe(true);
    }
  });

  test('주요 노드 라벨 7종 모두 정의되어 있음', () => {
    const expectedNodes = ['Session', 'Turn', 'Agent', 'ToolCall', 'Event', 'MetaDocument', 'Badge'];
    for (const t of expectedNodes) {
      const found = NODE_TABLES.some((d) => d.includes(`NODE TABLE IF NOT EXISTS ${t} `));
      expect(found).toBe(true);
    }
  });
});
