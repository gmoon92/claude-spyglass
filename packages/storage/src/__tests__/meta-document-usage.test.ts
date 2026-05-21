/**
 * listMetaDocsWithUsage — date-range 필터 회귀 테스트
 *
 * 검증 목적 (meta-docs-date-range-filter 2026-05-21):
 *  - fromTs/toTs 미지정: 전체 기간 invocations/last_used_at가 계산 (VIEW 사용)
 *  - fromTs/toTs 지정 : 윈도우 내 requests만 GROUP BY되어 카운트가 좁혀짐
 *  - 좁혀진 윈도우에서 호출 0이면 invocations=0, last_used_at=null로 떨어짐
 *  - orphan(=카탈로그 미등록) 행도 동일 윈도우 필터를 받음
 *
 * 테스트 셋업:
 *  - meta_documents: 'reviewer'(skill), 'analyst'(agent)
 *  - requests: skill 호출 — 최근 1건 + 100일 전 1건, agent 호출 — 100일 전 1건
 *  - orphan용: 카탈로그 미등록 skill 'phantom' 호출 1건(최근)
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import {
  SpyglassDatabase,
  closeDatabase,
  createSession,
  createRequest,
  listMetaDocsWithUsage,
  upsertMetaDocument,
} from '../index';

const TEST_DB_PATH = `/tmp/spyglass-meta-usage-test-${Date.now()}.db`;

describe('listMetaDocsWithUsage — fromTs/toTs date range', () => {
  let db: SpyglassDatabase;
  const now = Date.now();
  const ancient = now - 100 * 24 * 60 * 60 * 1000; // 100일 전
  const sessionId = 'sess-meta-usage';

  beforeEach(() => {
    db = new SpyglassDatabase({ dbPath: TEST_DB_PATH, autoInit: true });
    createSession(db.instance, {
      id: sessionId,
      project_name: 'usage-test',
      started_at: ancient,
    });

    upsertMetaDocument(db.instance, {
      type: 'skill',
      name: 'reviewer',
      source: 'userSettings',
      source_root: '/home/user/.claude',
      file_path: '/home/user/.claude/skills/reviewer/SKILL.md',
      description: null,
      user_invocable: true,
      frontmatter_json: null,
      seen_at: now,
    });
    upsertMetaDocument(db.instance, {
      type: 'agent',
      name: 'analyst',
      source: 'projectSettings',
      source_root: '/repo/project',
      file_path: '/repo/project/.claude/agents/analyst.md',
      description: null,
      user_invocable: false,
      frontmatter_json: null,
      seen_at: now,
    });

    // skill reviewer — 최근 1건 + 100일 전 1건
    createRequest(db.instance, {
      id: 'req-skill-recent',
      session_id: sessionId,
      timestamp: now - 60_000,
      type: 'tool_call',
      tool_name: 'Skill',
      tool_detail: 'reviewer',
      turn_id: 'turn-recent',
      event_type: 'tool',
      tokens_total: 100,
      duration_ms: 50,
    });
    createRequest(db.instance, {
      id: 'req-skill-ancient',
      session_id: sessionId,
      timestamp: ancient,
      type: 'tool_call',
      tool_name: 'Skill',
      tool_detail: 'reviewer',
      turn_id: 'turn-ancient',
      event_type: 'tool',
      tokens_total: 999,
      duration_ms: 999,
    });

    // agent analyst — 100일 전 1건만
    createRequest(db.instance, {
      id: 'req-agent-ancient',
      session_id: sessionId,
      timestamp: ancient,
      type: 'tool_call',
      tool_name: 'Agent',
      tool_detail: 'analyst',
      turn_id: 'turn-ancient-2',
      event_type: 'tool',
      tokens_total: 500,
      duration_ms: 100,
    });

    // orphan용 — 카탈로그 미등록 skill 'phantom' 최근 호출
    createRequest(db.instance, {
      id: 'req-orphan-recent',
      session_id: sessionId,
      timestamp: now - 30_000,
      type: 'tool_call',
      tool_name: 'Skill',
      tool_detail: 'phantom',
      turn_id: 'turn-orphan',
      event_type: 'tool',
      tokens_total: 10,
      duration_ms: 5,
    });
  });

  afterEach(() => {
    closeDatabase();
    try {
      require('fs').unlinkSync(TEST_DB_PATH);
    } catch {}
  });

  it('fromTs/toTs 미지정: 전체 기간 — 모든 호출이 invocations에 합산', () => {
    const rows = listMetaDocsWithUsage(db.instance, {});
    const reviewer = rows.find(r => r.type === 'skill' && r.name === 'reviewer');
    expect(reviewer).toBeTruthy();
    expect(reviewer!.invocations).toBe(2);          // recent + ancient
    expect(reviewer!.total_tokens).toBe(100 + 999); // 1099
    expect(reviewer!.last_used_at).toBe(now - 60_000);

    const analyst = rows.find(r => r.type === 'agent' && r.name === 'analyst');
    expect(analyst).toBeTruthy();
    expect(analyst!.invocations).toBe(1); // ancient only
  });

  it('최근 24h 윈도우: ancient 호출은 제외, recent만 잡힘', () => {
    const dayAgo = now - 24 * 60 * 60 * 1000;
    const rows = listMetaDocsWithUsage(db.instance, { fromTs: dayAgo, toTs: now });
    const reviewer = rows.find(r => r.type === 'skill' && r.name === 'reviewer');
    expect(reviewer).toBeTruthy();
    expect(reviewer!.invocations).toBe(1);          // recent만
    expect(reviewer!.total_tokens).toBe(100);
    expect(reviewer!.last_used_at).toBe(now - 60_000);

    // analyst는 ancient 호출뿐 → 윈도우 밖이므로 invocations=0, last_used_at=null
    const analyst = rows.find(r => r.type === 'agent' && r.name === 'analyst');
    expect(analyst).toBeTruthy();
    expect(analyst!.invocations).toBe(0);
    expect(analyst!.last_used_at).toBeNull();
  });

  it('orphan(=카탈로그 미등록) 호출도 같은 윈도우 필터를 받음', () => {
    const dayAgo = now - 24 * 60 * 60 * 1000;
    const rows = listMetaDocsWithUsage(db.instance, { fromTs: dayAgo, toTs: now });
    // phantom은 최근 호출 1건 — 카탈로그 미등록이라 id=null orphan 행으로 등장
    const phantom = rows.find(r => r.type === 'skill' && r.name === 'phantom');
    expect(phantom).toBeTruthy();
    expect(phantom!.id).toBeNull();
    expect(phantom!.invocations).toBe(1);
  });

  it('윈도우 밖만 있는 orphan은 결과에 나타나지 않음', () => {
    // 1초 단위 windowTuple — ancient 한참 이전 ~ ancient-1
    const from = ancient - 60 * 60 * 1000;
    const to   = ancient - 1;
    const rows = listMetaDocsWithUsage(db.instance, { fromTs: from, toTs: to });
    // phantom(=recent), reviewer(=recent) 모두 빠지고, ancient skill/agent도 윈도우 밖이라 빠진다.
    // orphan은 invocations=0이 되면 NOT EXISTS 분기에서 행 자체가 노출되지 않는다.
    const phantom = rows.find(r => r.type === 'skill' && r.name === 'phantom');
    expect(phantom).toBeFalsy();
    // 단, 카탈로그 행은 invocations=0으로라도 노출되어야 한다 (LEFT JOIN 결과).
    const reviewer = rows.find(r => r.type === 'skill' && r.name === 'reviewer');
    expect(reviewer).toBeTruthy();
    expect(reviewer!.invocations).toBe(0);
  });
});

/**
 * listMetaDocsWithUsage — project 필터 (meta-docs-project-filter-parity 2026-05-21)
 *
 * 사이드바 project 필터가 켜진 상태에서 카탈로그 invocations 가 ego-graph 의 centerTurns
 * 와 어긋나던 모순을 해결하기 위해, listMetaDocsWithUsage 에 project 파라미터를 추가했다.
 * 본 회귀 테스트는 다음 케이스를 보장한다:
 *  - project 미지정: sessions JOIN 없이 전체 호출이 합산(기존 동작).
 *  - project 지정 : sessions(project_name=?) 에 매칭되는 호출만 합산.
 *  - orphan session(=sessions 테이블에 없는 session_id) 호출은 project 지정 시 제외.
 *  - orphan 카탈로그 미등록 호출도 동일 필터를 받는다.
 */
describe('listMetaDocsWithUsage — project 필터', () => {
  const dbPath = `/tmp/spyglass-meta-project-test-${Date.now()}.db`;
  let db: SpyglassDatabase;
  const now = Date.now();
  const t0  = now - 60_000;

  beforeEach(() => {
    db = new SpyglassDatabase({ dbPath, autoInit: true });

    // 두 개의 정상 세션 — 서로 다른 project_name.
    createSession(db.instance, { id: 'sess-A', project_name: 'project-A', started_at: t0 });
    createSession(db.instance, { id: 'sess-B', project_name: 'project-B', started_at: t0 });

    // 카탈로그 — 'reviewer' skill, 'analyst' agent
    upsertMetaDocument(db.instance, {
      type: 'skill', name: 'reviewer', source: 'userSettings', source_root: '/home/user/.claude',
      file_path: '/home/user/.claude/skills/reviewer/SKILL.md',
      description: null, user_invocable: true, frontmatter_json: null, seen_at: now,
    });
    upsertMetaDocument(db.instance, {
      type: 'agent', name: 'analyst', source: 'projectSettings', source_root: '/repo/project',
      file_path: '/repo/project/.claude/agents/analyst.md',
      description: null, user_invocable: false, frontmatter_json: null, seen_at: now,
    });

    // reviewer: project-A 1건, project-B 1건, orphan session 1건
    createRequest(db.instance, {
      id: 'req-rev-A', session_id: 'sess-A', timestamp: t0, type: 'tool_call',
      tool_name: 'Skill', tool_detail: 'reviewer', turn_id: 'turn-A', event_type: 'tool',
      tokens_total: 10, duration_ms: 5,
    });
    createRequest(db.instance, {
      id: 'req-rev-B', session_id: 'sess-B', timestamp: t0, type: 'tool_call',
      tool_name: 'Skill', tool_detail: 'reviewer', turn_id: 'turn-B', event_type: 'tool',
      tokens_total: 20, duration_ms: 7,
    });
    // orphan: requests에 session_id 가 있지만 sessions 테이블에는 없음.
    // FK 무시를 위해 raw INSERT (createRequest 는 FK 체크 경로를 통과해야 하므로 직접 SQL).
    db.instance.run("PRAGMA foreign_keys = OFF");
    db.instance
      .query(`
        INSERT INTO requests (id, session_id, timestamp, type, tool_name, tool_detail, turn_id, event_type, tokens_total, duration_ms)
        VALUES ('req-rev-orphan', 'sess-ORPHAN', ?, 'tool_call', 'Skill', 'reviewer', 'turn-O', 'tool', 99, 9)
      `).run(t0);
    // analyst: project-A 에만 1건
    createRequest(db.instance, {
      id: 'req-ana-A', session_id: 'sess-A', timestamp: t0, type: 'tool_call',
      tool_name: 'Agent', tool_detail: 'analyst', turn_id: 'turn-AA', event_type: 'tool',
      tokens_total: 50, duration_ms: 10,
    });
    // orphan 카탈로그 미등록 skill 'phantom' — sess-A 와 orphan 세션에서 각 1건
    createRequest(db.instance, {
      id: 'req-phantom-A', session_id: 'sess-A', timestamp: t0, type: 'tool_call',
      tool_name: 'Skill', tool_detail: 'phantom', turn_id: 'turn-PA', event_type: 'tool',
      tokens_total: 1, duration_ms: 1,
    });
    db.instance
      .query(`
        INSERT INTO requests (id, session_id, timestamp, type, tool_name, tool_detail, turn_id, event_type, tokens_total, duration_ms)
        VALUES ('req-phantom-orphan', 'sess-ORPHAN', ?, 'tool_call', 'Skill', 'phantom', 'turn-PO', 'tool', 2, 2)
      `).run(t0);
    db.instance.run("PRAGMA foreign_keys = ON");
  });

  afterEach(() => {
    closeDatabase();
    try { require('fs').unlinkSync(dbPath); } catch {}
  });

  it('project 미지정: 모든 세션(orphan 포함) 호출이 합산된다', () => {
    const rows = listMetaDocsWithUsage(db.instance, {});
    const reviewer = rows.find(r => r.type === 'skill' && r.name === 'reviewer');
    expect(reviewer!.invocations).toBe(3); // A + B + orphan
    const analyst  = rows.find(r => r.type === 'agent' && r.name === 'analyst');
    expect(analyst!.invocations).toBe(1);
    const phantom  = rows.find(r => r.type === 'skill' && r.name === 'phantom');
    expect(phantom!.invocations).toBe(2); // A + orphan
  });

  it('project="project-A": 해당 project session 호출만 합산, orphan/B는 제외', () => {
    const rows = listMetaDocsWithUsage(db.instance, { project: 'project-A' });
    const reviewer = rows.find(r => r.type === 'skill' && r.name === 'reviewer');
    expect(reviewer!.invocations).toBe(1); // A 만
    const analyst  = rows.find(r => r.type === 'agent' && r.name === 'analyst');
    expect(analyst!.invocations).toBe(1);
    // orphan 호출은 카탈로그 미등록 phantom 도 동일하게 제외 — A 호출 1건만 남아야 한다.
    const phantom  = rows.find(r => r.type === 'skill' && r.name === 'phantom');
    expect(phantom!.invocations).toBe(1);
  });

  it('project="project-B": A 와 orphan 모두 제외, B 호출만 남는다', () => {
    const rows = listMetaDocsWithUsage(db.instance, { project: 'project-B' });
    const reviewer = rows.find(r => r.type === 'skill' && r.name === 'reviewer');
    expect(reviewer!.invocations).toBe(1); // B 만
    // analyst 는 B 세션에 호출이 없으므로 0건 — LEFT JOIN 으로 카탈로그 행은 노출되지만 invocations=0.
    const analyst  = rows.find(r => r.type === 'agent' && r.name === 'analyst');
    expect(analyst!.invocations).toBe(0);
    // phantom 은 A/orphan 호출만 있고 B 세션에는 없음 → orphan 분기에서도 빠진다.
    const phantom  = rows.find(r => r.type === 'skill' && r.name === 'phantom');
    expect(phantom).toBeFalsy();
  });

  it('project 필터는 fromTs/toTs 와 조합 가능 — 두 조건의 교집합으로 좁힘', () => {
    const futureFrom = now + 60_000; // 모든 호출이 윈도우 밖
    const rows = listMetaDocsWithUsage(db.instance, {
      project: 'project-A',
      fromTs: futureFrom,
      toTs:   futureFrom + 1000,
    });
    const reviewer = rows.find(r => r.type === 'skill' && r.name === 'reviewer');
    expect(reviewer!.invocations).toBe(0);
  });
});
