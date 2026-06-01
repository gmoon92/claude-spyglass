/**
 * project-filter.test.ts — 메타 문서 카탈로그 프로젝트(source_root) 필터 순수 함수 검증.
 *
 * 버그 회귀 가드: 좌측에서 claude-spyglass 선택 시 rv-iso/rview 등 다른 경로의 동명 문서(commit)가
 *   카탈로그에 섞여 노출되던 문제 — source_root basename 기준으로 좁혀 해소한다.
 */
import { describe, it, expect } from 'vitest';
import { filterMetaDocsByProject, isGlobalMetaDoc, metaDocProjectKey } from '../project-filter';
import type { MetaDocRow } from '../meta-docs-sort';

const GLOBAL = '__global__';

const rows: MetaDocRow[] = [
  { id: 1, type: 'skill', name: 'commit', source: 'projectSettings', source_root: '/Users/x/IdeaProjects/claude-spyglass', invocations: 4 },
  { id: 2, type: 'skill', name: 'commit', source: 'projectSettings', source_root: '/Users/x/IdeaProjects/rv-iso', invocations: 4 },
  { id: 3, type: 'skill', name: 'commit', source: 'projectSettings', source_root: '/Users/x/IdeaProjects/rview/rview', invocations: 4 },
  { id: 4, type: 'agent', name: 'general-purpose', source: 'userSettings', source_root: null, invocations: 30 }, // 전역, 호출됨
  { id: 5, type: 'agent', name: 'architect', source: 'projectSettings', source_root: '/Users/x/IdeaProjects/rv-iso', invocations: 0 }, // 타프로젝트 미사용
  { id: 6, type: 'skill', name: 'unused-global', source: 'userSettings', source_root: null, invocations: 0 }, // 전역, 미사용
];

describe('isGlobalMetaDoc', () => {
  it('userSettings 또는 source_root==null 이면 전역', () => {
    expect(isGlobalMetaDoc({ source: 'userSettings', source_root: '/Users/x/.claude' })).toBe(true);
    expect(isGlobalMetaDoc({ source: 'projectSettings', source_root: null })).toBe(true);
    expect(isGlobalMetaDoc({ source: 'projectSettings', source_root: '/p/claude-spyglass' })).toBe(false);
  });
});

describe('metaDocProjectKey', () => {
  it('source_root basename, 전역이면 null', () => {
    expect(metaDocProjectKey({ source: 'projectSettings', source_root: '/Users/x/IdeaProjects/claude-spyglass' })).toBe('claude-spyglass');
    expect(metaDocProjectKey({ source: 'projectSettings', source_root: '/Users/x/IdeaProjects/rview/rview' })).toBe('rview');
    expect(metaDocProjectKey({ source: 'userSettings', source_root: null })).toBeNull();
  });
});

describe('filterMetaDocsByProject', () => {
  it('전체/전역키/null 선택 → 전체 통과(복사본)', () => {
    expect(filterMetaDocsByProject(rows, GLOBAL, GLOBAL)).toHaveLength(rows.length);
    expect(filterMetaDocsByProject(rows, null, GLOBAL)).toHaveLength(rows.length);
    // 복사본(원본 불변)
    expect(filterMetaDocsByProject(rows, GLOBAL, GLOBAL)).not.toBe(rows);
  });

  it('특정 프로젝트 → 그 경로 문서 + 호출된 전역 문서만', () => {
    const out = filterMetaDocsByProject(rows, 'claude-spyglass', GLOBAL);
    const names = out.map((r) => `${r.name}@${r.source_root ?? 'global'}`);
    // claude-spyglass commit + 호출된 전역 general-purpose 포함
    expect(names).toContain('commit@/Users/x/IdeaProjects/claude-spyglass');
    expect(names).toContain('general-purpose@global');
    // rv-iso/rview commit, 타프로젝트 architect, 미사용 전역 제외
    expect(names).not.toContain('commit@/Users/x/IdeaProjects/rv-iso');
    expect(names).not.toContain('commit@/Users/x/IdeaProjects/rview/rview');
    expect(out.find((r) => r.name === 'architect')).toBeUndefined();
    expect(out.find((r) => r.name === 'unused-global')).toBeUndefined();
  });

  it('rv-iso 선택 → rv-iso 경로 문서(architect 포함, 미사용이어도 경로 소속) + 호출 전역', () => {
    const out = filterMetaDocsByProject(rows, 'rv-iso', GLOBAL);
    const names = out.map((r) => r.name);
    expect(names).toContain('commit'); // rv-iso commit
    expect(names).toContain('architect'); // rv-iso 소속(미사용이어도 경로 일치)
    expect(names).toContain('general-purpose'); // 호출된 전역
    // claude-spyglass commit 은 1개만 남아야(rv-iso commit) — 경로로 구분
    expect(out.filter((r) => r.name === 'commit')).toHaveLength(1);
    expect(out.find((r) => r.name === 'commit')!.source_root).toContain('rv-iso');
  });
});
