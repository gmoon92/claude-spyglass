/**
 * project_aliases — 프로젝트 이름 변경 시 이력 합산 (Migration 070).
 *
 * 시나리오: 저장소 이름이 old-name → new-name 으로 바뀌었다.
 *  - 개명 전 세션(project_name='old-name')과 개명 후 세션('new-name')이 따로 쌓여 있다.
 *  - 별칭 old-name → new-name 을 등록하면 어느 이름으로 조회해도 두 세션의 이력이 합쳐진다.
 *  - 별칭을 지우면 바로 원래대로 돌아간다(sessions 행은 건드리지 않는다).
 *
 * 필터를 쓰는 조회 지점(메타 문서 사용 집계·세션 목록·프로젝트 통계·도구 통계·모델 사용량·대화)을 모두 확인한다.
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { Database } from 'bun:sqlite';
import { runMigrations } from '../migrator';
import {
  createSession,
  createRequest,
  getSessionsByProject,
  getProjectStats,
  getProjectToolStats,
  getModelUsageStats,
  getConversationRows,
  listMetaDocsWithUsage,
  upsertMetaDocument,
  resolveProjectNames,
  projectNameIn,
  listProjectAliases,
  upsertProjectAlias,
  deleteProjectAlias,
} from '../index';

let db: Database;
const T0 = 1_700_000_000_000;

beforeEach(() => {
  db = new Database(':memory:');
  runMigrations(db);

  createSession(db, { id: 's-old', project_name: 'old-name', started_at: T0 });
  createSession(db, { id: 's-new', project_name: 'new-name', started_at: T0 + 1000 });
  createSession(db, { id: 's-other', project_name: 'other', started_at: T0 + 2000 });

  upsertMetaDocument(db, {
    type: 'skill', name: 'commit', source: 'projectSettings', source_root: '/repo',
    file_path: '/repo/.claude/skills/commit/SKILL.md', description: null,
    user_invocable: true, frontmatter_json: null, seen_at: T0,
  });

  // 세션마다 prompt 1 + Skill 호출 1 (commit) — 모델은 서로 다르게
  const seed = (session: string, ts: number, model: string) => {
    createRequest(db, {
      id: `p-${session}`, session_id: session, timestamp: ts, type: 'prompt', turn_id: `T-${session}`,
      model, tokens_input: 10, tokens_output: 0, tokens_total: 10, preview: `프롬프트 ${session}`,
    });
    createRequest(db, {
      id: `t-${session}`, session_id: session, timestamp: ts + 10, type: 'tool_call', turn_id: `T-${session}`,
      tool_name: 'Skill', tool_detail: 'commit', event_type: 'tool', tool_use_id: `tu-${session}`,
      tokens_input: 0, tokens_output: 0, tokens_total: 5, duration_ms: 100,
    });
    createRequest(db, {
      id: `r-${session}`, session_id: session, timestamp: ts + 20, type: 'response', turn_id: `T-${session}`,
      model, tokens_input: 0, tokens_output: 20, tokens_total: 20, preview: `응답 ${session}`,
    });
  };
  seed('s-old', T0 + 100, 'model-a');
  seed('s-new', T0 + 1100, 'model-b');
  seed('s-other', T0 + 2100, 'model-c');
});
afterEach(() => db.close());

const commitCalls = (project: string): number =>
  listMetaDocsWithUsage(db, { project }).find((r) => r.name === 'commit')?.invocations ?? 0;

describe('별칭 관리', () => {
  it('등록·조회·삭제', () => {
    expect(upsertProjectAlias(db, { alias: 'old-name', project_name: 'new-name', note: '2026-11-23 개명' })).toEqual({ ok: true });
    expect(listProjectAliases(db)).toEqual([
      expect.objectContaining({ alias: 'old-name', project_name: 'new-name', note: '2026-11-23 개명' }),
    ]);
    expect(deleteProjectAlias(db, 'old-name')).toBe(true);
    expect(deleteProjectAlias(db, 'old-name')).toBe(false);
    expect(listProjectAliases(db)).toEqual([]);
  });

  it('같은 alias 를 다시 등록하면 덮어쓴다', () => {
    upsertProjectAlias(db, { alias: 'old-name', project_name: 'new-name' });
    upsertProjectAlias(db, { alias: 'old-name', project_name: 'newer-name', note: '재지정' });
    expect(listProjectAliases(db)).toEqual([
      expect.objectContaining({ alias: 'old-name', project_name: 'newer-name', note: '재지정' }),
    ]);
  });

  it.each([
    ['빈 alias', { alias: '', project_name: 'x' }],
    ['빈 project_name', { alias: 'x', project_name: '  ' }],
    ['같은 이름', { alias: 'x', project_name: 'x' }],
    ['너무 긴 이름', { alias: 'a'.repeat(257), project_name: 'x' }],
  ])('검증 실패 — %s', (_name, input) => {
    const r = upsertProjectAlias(db, input);
    expect(r.ok).toBe(false);
    expect(listProjectAliases(db)).toEqual([]);
  });

  it('체인 금지 — 대표 이름이 이미 별칭이면, 별칭이 이미 대표 이름이면 거부', () => {
    upsertProjectAlias(db, { alias: 'a', project_name: 'b' });
    expect(upsertProjectAlias(db, { alias: 'c', project_name: 'a' }).ok).toBe(false); // a 는 별칭
    expect(upsertProjectAlias(db, { alias: 'b', project_name: 'z' }).ok).toBe(false); // b 는 이미 대표 이름
    expect(listProjectAliases(db)).toHaveLength(1);
  });
});

describe('resolveProjectNames / projectNameIn', () => {
  it('별칭이 없으면 이름 그대로', () => {
    expect(resolveProjectNames(db, 'new-name')).toEqual(['new-name']);
    expect(projectNameIn(db, 'project_name', 'new-name')).toEqual({ sql: 'project_name IN (?)', params: ['new-name'] });
  });

  it('어느 쪽 이름으로 풀어도 같은 집합, 첫 원소는 대표 이름', () => {
    upsertProjectAlias(db, { alias: 'old-name', project_name: 'new-name' });
    upsertProjectAlias(db, { alias: 'older-name', project_name: 'new-name' });
    expect(resolveProjectNames(db, 'new-name')).toEqual(['new-name', 'old-name', 'older-name']);
    expect(resolveProjectNames(db, 'old-name')).toEqual(['new-name', 'old-name', 'older-name']);
  });

  it('project_aliases 테이블이 없는 최소 스키마 DB 에서는 별칭 없음으로 동작한다', () => {
    const bare = new Database(':memory:');
    expect(resolveProjectNames(bare, 'x')).toEqual(['x']);
    expect(listProjectAliases(bare)).toEqual([]);
    expect(upsertProjectAlias(bare, { alias: 'a', project_name: 'b' }).ok).toBe(false);
    bare.close();
  });
});

describe('조회 지점 — 별칭 등록 전/후/삭제 후', () => {
  it('메타 문서 호출 집계 (project 필터)', () => {
    expect(commitCalls('new-name')).toBe(1); // 등록 전: 새 이름 세션만
    expect(commitCalls('old-name')).toBe(1);
    upsertProjectAlias(db, { alias: 'old-name', project_name: 'new-name' });
    expect(commitCalls('new-name')).toBe(2); // 이력 합산
    expect(commitCalls('old-name')).toBe(2); // 옛 이름으로 물어도 같은 묶음
    expect(commitCalls('other')).toBe(1);    // 무관한 프로젝트는 그대로
    deleteProjectAlias(db, 'old-name');
    expect(commitCalls('new-name')).toBe(1); // 삭제하면 원복
  });

  it('메타 문서 호출 집계 — 기간 필터와 함께', () => {
    upsertProjectAlias(db, { alias: 'old-name', project_name: 'new-name' });
    const rows = listMetaDocsWithUsage(db, { project: 'new-name', fromTs: T0, toTs: T0 + 5000 });
    expect(rows.find((r) => r.name === 'commit')?.invocations).toBe(2);
    const narrow = listMetaDocsWithUsage(db, { project: 'new-name', fromTs: T0 + 1000, toTs: T0 + 5000 });
    expect(narrow.find((r) => r.name === 'commit')?.invocations).toBe(1); // s-new 만 기간 안
  });

  it('세션 목록 (getSessionsByProject)', () => {
    const ids = () => getSessionsByProject(db, 'new-name', 50).map((s) => s.id).sort();
    expect(ids()).toEqual(['s-new']);
    upsertProjectAlias(db, { alias: 'old-name', project_name: 'new-name' });
    expect(ids()).toEqual(['s-new', 's-old']);
    // 각 세션의 project_name 값 자체는 바뀌지 않는다(읽을 때 풀어쓰기)
    const names = getSessionsByProject(db, 'new-name', 50).map((s) => s.project_name).sort();
    expect(names).toEqual(['new-name', 'old-name']);
  });

  it('프로젝트 통계 (getProjectStats) — 별칭은 대표 이름 그룹으로 합쳐진다', () => {
    const byName = () => Object.fromEntries(getProjectStats(db, 10).map((p) => [p.project_name, p.session_count]));
    expect(byName()).toEqual({ 'old-name': 1, 'new-name': 1, other: 1 });
    upsertProjectAlias(db, { alias: 'old-name', project_name: 'new-name' });
    expect(byName()).toEqual({ 'new-name': 2, other: 1 });
    deleteProjectAlias(db, 'old-name');
    expect(byName()).toEqual({ 'old-name': 1, 'new-name': 1, other: 1 });
  });

  it('도구 통계 (getProjectToolStats)', () => {
    const skillCalls = (project: string) =>
      getProjectToolStats(db, project).reduce((n, r) => n + (r.call_count ?? 0), 0);
    const before = skillCalls('new-name');
    expect(before).toBeGreaterThan(0); // 공허한 통과 방지
    upsertProjectAlias(db, { alias: 'old-name', project_name: 'new-name' });
    expect(skillCalls('new-name')).toBe(before * 2);
    expect(skillCalls('old-name')).toBe(before * 2);
  });

  it('모델 사용량 (getModelUsageStats, project 스코프)', () => {
    const models = (project: string) => getModelUsageStats(db, undefined, undefined, project).map((m) => m.model).sort();
    expect(models('new-name')).toEqual(['model-b']);
    upsertProjectAlias(db, { alias: 'old-name', project_name: 'new-name' });
    expect(models('new-name')).toEqual(['model-a', 'model-b']);
  });

  it('대화 (getConversationRows, project 필터)', () => {
    const sessions = (project: string) =>
      [...new Set(getConversationRows(db, T0, T0 + 10_000, project, 100).map((r) => r.session_id))].sort();
    expect(sessions('new-name')).toEqual(['s-new']);
    upsertProjectAlias(db, { alias: 'old-name', project_name: 'new-name' });
    expect(sessions('new-name')).toEqual(['s-new', 's-old']);
    expect(sessions('other')).toEqual(['s-other']);
  });
});
