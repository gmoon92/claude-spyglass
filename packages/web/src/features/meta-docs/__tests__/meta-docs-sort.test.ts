/**
 * meta-docs-sort.test.ts — 카탈로그 정렬/표시필터/검색가시성/카운트 순수 로직 (P4-02)
 *
 * §7 보강계획의 P4-02 선행 특성화 테스트 — 원본 meta-docs-view.js 의
 * applySort/COMPARATORS/applyDisplayFilter/computeRowCounts/applySearchFilter(DOM hidden)
 * 동치를 순수 함수로 고정한다. window.I18n 스텁(getCollator 의존).
 *
 * 회귀 게이트: null/orphan 끝자리 정책(view.js:1289,1309), type 동률 invocations desc 보조(view.js:1285),
 *   검색 부분일치 소문자(view.js:1014) — "검색 필터 회귀 0" done_criteria 직접 근거.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import {
  applySort,
  nextSort,
  applyDisplayFilter,
  computeRowCounts,
  visibleBySearch,
  shortenPath,
  formatTokens,
  SORTABLE_KEYS,
  DEFAULT_DIR,
  DEFAULT_SORT,
  type MetaDocRow,
} from '../meta-docs-sort';

beforeAll(() => {
  (globalThis as { window?: { I18n?: unknown } }).window ??= {};
  (globalThis as { window: { I18n?: unknown } }).window.I18n = { t: (k: string) => k, getLang: () => 'en' };
});

// id=null → orphan, invocations=0 + id!=null → unused.
const ROWS: MetaDocRow[] = [
  { id: 1, type: 'skill',   name: 'bravo',   source: 'projectSettings', source_root: '/p/x', invocations: 5,  last_used_at: 300, total_tokens: 1500 },
  { id: 2, type: 'agent',   name: 'alpha',   source: 'userSettings',    source_root: null,   invocations: 0,  last_used_at: null, total_tokens: 0 },
  { id: 3, type: 'agent',   name: 'charlie', source: 'projectSettings', source_root: '/p/y', invocations: 9,  last_used_at: 100, total_tokens: 999 },
  { id: null, type: 'skill', name: 'orphan-z', source: null,            source_root: null,   invocations: 7,  last_used_at: 200, total_tokens: 50 },
];

describe('meta-docs-sort — 상수/기본값 (view.js:1247-1259)', () => {
  it('SORTABLE_KEYS 6컬럼', () => {
    expect(([...SORTABLE_KEYS] as string[]).sort()).toEqual(
      ['invocations', 'last_used_at', 'name', 'source', 'total_tokens', 'type'].sort(),
    );
  });
  it('DEFAULT_DIR: 텍스트 asc / 숫자·시간 desc', () => {
    expect(DEFAULT_DIR.type).toBe('asc');
    expect(DEFAULT_DIR.name).toBe('asc');
    expect(DEFAULT_DIR.source).toBe('asc');
    expect(DEFAULT_DIR.invocations).toBe('desc');
    expect(DEFAULT_DIR.last_used_at).toBe('desc');
    expect(DEFAULT_DIR.total_tokens).toBe('desc');
  });
  it('DEFAULT_SORT = invocations desc (view.js:56-57)', () => {
    expect(DEFAULT_SORT).toEqual({ key: 'invocations', dir: 'desc' });
  });
});

describe('applySort — dispatcher + 불변성', () => {
  it('원본 불변(slice)', () => {
    const before = ROWS.map((r) => r.name);
    applySort(ROWS, 'name', 'asc');
    expect(ROWS.map((r) => r.name)).toEqual(before);
  });
  it('name asc → collator 정렬(alpha,bravo,charlie,orphan-z)', () => {
    const out = applySort(ROWS, 'name', 'asc').map((r) => r.name);
    expect(out).toEqual(['alpha', 'bravo', 'charlie', 'orphan-z']);
  });
  it('invocations desc → 9,7,5,0', () => {
    const out = applySort(ROWS, 'invocations', 'desc').map((r) => r.invocations);
    expect(out).toEqual([9, 7, 5, 0]);
  });
  it('미존재 키 → invocations 폴백(view.js:1331)', () => {
    const out = applySort(ROWS, 'invocations', 'desc').map((r) => r.invocations);
    const fallback = applySort(ROWS, 'nope', 'desc').map((r) => r.invocations);
    expect(fallback).toEqual(out);
  });
});

describe('applySort — null/orphan 끝자리 정책 (회귀 게이트)', () => {
  it('source: orphan(source null) 은 asc/desc 모두 마지막 (view.js:1289)', () => {
    const asc = applySort(ROWS, 'source', 'asc');
    const desc = applySort(ROWS, 'source', 'desc');
    expect(asc[asc.length - 1].source).toBeNull();
    expect(desc[desc.length - 1].source).toBeNull();
  });
  it('last_used_at: null 은 asc/desc 모두 마지막 (view.js:1309)', () => {
    const asc = applySort(ROWS, 'last_used_at', 'asc');
    const desc = applySort(ROWS, 'last_used_at', 'desc');
    expect(asc[asc.length - 1].last_used_at).toBeNull();
    expect(desc[desc.length - 1].last_used_at).toBeNull();
  });
  it('last_used_at desc → 비-null 중 최신 먼저(300,200,100), null 끝', () => {
    const out = applySort(ROWS, 'last_used_at', 'desc').map((r) => r.last_used_at);
    expect(out).toEqual([300, 200, 100, null]);
  });
});

describe('applySort — 동률 보조키 (view.js:1285,1306)', () => {
  it('type 동률 → invocations desc 보조 (agent charlie(9) before alpha(0))', () => {
    // 두 agent: charlie(inv9) / alpha(inv0). type asc 면 둘 다 agent → 보조 inv desc.
    const out = applySort(ROWS, 'type', 'asc');
    const agents = out.filter((r) => r.type === 'agent').map((r) => r.name);
    expect(agents).toEqual(['charlie', 'alpha']);
  });
  it('invocations 동률 → last_used_at 보조 (view.js:1307)', () => {
    const tie: MetaDocRow[] = [
      { id: 1, type: 'skill', name: 'a', source: 's', source_root: null, invocations: 3, last_used_at: 100, total_tokens: 0 },
      { id: 2, type: 'skill', name: 'b', source: 's', source_root: null, invocations: 3, last_used_at: 500, total_tokens: 0 },
    ];
    const out = applySort(tie, 'invocations', 'desc').map((r) => r.name);
    expect(out).toEqual(['b', 'a']); // 더 최근(500) 위
  });
});

describe('nextSort — 토글 전이 (view.js:1049-1058)', () => {
  it('같은 키 재클릭 → 방향 토글', () => {
    expect(nextSort({ key: 'invocations', dir: 'desc' }, 'invocations')).toEqual({ key: 'invocations', dir: 'asc' });
  });
  it('다른 키 → 컬럼 기본방향(name=asc)', () => {
    expect(nextSort({ key: 'invocations', dir: 'desc' }, 'name')).toEqual({ key: 'name', dir: 'asc' });
  });
  it('무효 키 → 현재 유지(SORTABLE_KEYS 가드, view.js:1050)', () => {
    const cur = { key: 'invocations' as const, dir: 'desc' as const };
    expect(nextSort(cur, 'bogus')).toEqual(cur);
  });
});

describe('applyDisplayFilter — 행 부분집합 (view.js:1223)', () => {
  it('all → 전체', () => {
    expect(applyDisplayFilter(ROWS, 'all')).toHaveLength(4);
  });
  it('unused → id!=null && invocations===0 (alpha 만)', () => {
    const out = applyDisplayFilter(ROWS, 'unused').map((r) => r.name);
    expect(out).toEqual(['alpha']);
  });
  it('orphan → id==null (orphan-z 만)', () => {
    const out = applyDisplayFilter(ROWS, 'orphan').map((r) => r.name);
    expect(out).toEqual(['orphan-z']);
  });
});

describe('computeRowCounts — summary 카드 SSoT (view.js:437)', () => {
  it('used/unused/orphan 카운트 (used 는 invocations>0 이면 orphan 포함, view.js:439)', () => {
    // used: bravo(5), charlie(9), orphan-z(7) = 3 (orphan 도 inv>0 이면 used 집계)
    // unused: alpha(id!=null, inv0) = 1 / orphan: orphan-z(id null) = 1
    expect(computeRowCounts(ROWS)).toEqual({ used: 3, unused: 1, orphan: 1 });
  });
});

describe('visibleBySearch — 검색 가시성 (view.js:1014 DOM hidden 동치)', () => {
  it('빈 term → 모두 표시', () => {
    expect(ROWS.filter((r) => visibleBySearch(r.name, '')).map((r) => r.name)).toHaveLength(4);
  });
  it('부분일치 소문자 (term="AL" → alpha)', () => {
    const out = ROWS.filter((r) => visibleBySearch(r.name, 'AL')).map((r) => r.name);
    expect(out).toEqual(['alpha']);
  });
  it('공백 trim 후 매칭', () => {
    expect(visibleBySearch('alpha', '  alp  ')).toBe(true);
    expect(visibleBySearch('bravo', '  alp  ')).toBe(false);
  });
});

describe('포맷 헬퍼 (view.js:1339,1354)', () => {
  it('formatTokens: 0/k/M', () => {
    expect(formatTokens(0)).toBe('0');
    expect(formatTokens(1500)).toBe('1.5k');
    expect(formatTokens(2_000_000)).toBe('2.0M');
    expect(formatTokens(999)).toBe('999');
  });
  it('shortenPath: 빈/짧은 경로 그대로', () => {
    expect(shortenPath('')).toBe('');
    expect(shortenPath('/a/b')).toBe('/a/b');
  });
  it('shortenPath: 60자 초과 가운데 …', () => {
    const long = '/x'.repeat(40);
    expect(shortenPath(long)).toContain('…');
  });
});
