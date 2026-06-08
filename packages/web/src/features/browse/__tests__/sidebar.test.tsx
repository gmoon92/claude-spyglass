/**
 * sidebar.test.tsx — Sidebar TSX 동작 동치 + 마운트/언마운트 cleanup 검증 (P3-02)
 *
 * 원본: assets/js/left-panel.js (renderBrowserProjects/renderBrowserSessions/GLOBAL_PROJECT_KEY/
 *   top-level session-anomalies-loaded 리스너).
 *
 * 전략(P2-08 filter-bar.test 선례 + 무 DOM 하네스):
 *  - 마크업/셀렉터 계약: renderToStaticMarkup 으로 검증.
 *  - 선택/콜백 배선: 트리에서 노드 onClick 직접 invoke → onSelect 콜백/store end-to-end.
 *  - 구독 생명주기: createAnomalySubscription 을 직접 호출해 anomaly-store 구독 등록/해제(누수 가드)와
 *    bloated_sys 변경 통지를 검증. A-2 에서 원본 document 'session-anomalies-loaded' CustomEvent 구독을
 *    stores/anomaly-store(Zustand) 구독으로 전환했다(전역 이벤트버스 폐기 — React 채널 일원화).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { act, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { ensureDom } from '../../../test-support/ensure-dom';
import {
  Sidebar,
  ProjectList,
  SessionList,
  GLOBAL_PROJECT_KEY,
  sortSessions,
  createAnomalySubscription,
} from '../Sidebar';
import { useAppStore } from '../../../stores/app-store';
import { useAnomalyStore } from '../../../stores/anomaly-store';

ensureDom();
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// i18n 은 각 행/리스트 컴포넌트가 useTranslation 으로 직접 구독한다(무전역 labeler 폐기).
//   SessionRow(P2-04)/fmtRelative 는 i18next.t 직접 참조 → 테스트 t 주입(vitest.setup __setTestT).
//   afterEach 자동 복원 대응으로 각 테스트 전 커스텀 t 재주입(ProjectList/SessionList 의 ui.* 키는
//   맵에 없어 passthrough → 단언은 구조 셀렉터 위주, 라벨 텍스트 비의존).
beforeEach(() => {
  globalThis.__setTestT?.((key, vars) => {
    const map: Record<string, string> = {
      'common:formatters.just-now': '방금',
      'common:formatters.minutes-ago': `${vars?.n}분 전`,
      'common:formatters.hours-ago': `${vars?.n}시간 전`,
      'common:formatters.days-ago': `${vars?.n}일 전`,
      'session:rows.status.ended': '종료된 세션',
      'session:rows.status.live': '라이브 세션',
      'session:rows.status.stale': 'stale',
    };
    return map[key] ?? key;
  });
});

const PROJECTS = [
  { project_name: 'alpha', total_tokens: 1000, active_count: 2 },
  { project_name: 'beta', total_tokens: 500, active_count: 0 },
];

beforeEach(() => {
  useAppStore.setState({ selectedProject: null, selectedSession: null });
});

/** 라이브 마운트 헬퍼 — 컴포넌트가 useTranslation(hook)을 쓰므로 함수 직접 호출 불가, createRoot 렌더.
 *  <tr> 루트 컴포넌트는 유효한 table 컨텍스트(table>tbody) 안에서 렌더한다. */
function renderLive(root: Root, node: ReactElement): void {
  act(() => root.render(<table><tbody>{node}</tbody></table>));
}

// ── GLOBAL_PROJECT_KEY 동치 (원본 left-panel.js:17) ──────────────────────────
describe('GLOBAL_PROJECT_KEY — 원본 상수 동치', () => {
  it("'__global__' 을 유지한다", () => {
    expect(GLOBAL_PROJECT_KEY).toBe('__global__');
  });
});

// ── sortSessions 동치 (원본 renderBrowserSessions 정렬 :165-173) ──────────────
describe('sortSessions — 활성 우선 → 최근 활동 desc 정렬', () => {
  it('활성(ended_at=null) 세션을 종료 세션보다 앞에 둔다', () => {
    const list = [
      { id: 'ended1', project_name: 'p', ended_at: '2026-01-01', last_activity_at: 100 },
      { id: 'live1', project_name: 'p', ended_at: null, last_activity_at: 50 },
    ];
    const sorted = sortSessions(list);
    expect(sorted[0].id).toBe('live1'); // 활성이 앞
    expect(sorted[1].id).toBe('ended1');
  });

  it('동일 활성 상태면 last_activity_at 내림차순', () => {
    const list = [
      { id: 'old', project_name: 'p', ended_at: null, last_activity_at: 10 },
      { id: 'new', project_name: 'p', ended_at: null, last_activity_at: 99 },
    ];
    expect(sortSessions(list)[0].id).toBe('new');
  });

  it('입력 배열을 변형하지 않는다(순수 함수)', () => {
    const list = [
      { id: 'a', project_name: 'p', ended_at: null, last_activity_at: 1 },
      { id: 'b', project_name: 'p', ended_at: null, last_activity_at: 2 },
    ];
    const ref = list;
    sortSessions(list);
    expect(ref[0].id).toBe('a'); // 원본 순서 보존
  });
});

// ── createAnomalySubscription — anomaly-store 구독/해제 (A-2: CustomEvent → Zustand) ──
describe('createAnomalySubscription — store 구독 등록/해제 + 변경 통지', () => {
  beforeEach(() => {
    // 각 케이스 격리 — anomaly-store 초기화.
    useAnomalyStore.setState({ bloatedBySession: {} });
  });

  it('cleanup 함수를 반환하고, 호출 시 구독 해제 후 추가 통지가 없다(누수 차단)', () => {
    const seen: Array<[string, unknown]> = [];
    const cleanup = createAnomalySubscription((id, b) => seen.push([id, b]), useAnomalyStore);
    expect(typeof cleanup).toBe('function');
    cleanup(); // 해제
    useAnomalyStore.getState().setBloatedSysFor('s1', { stage: 'critical' });
    expect(seen).toEqual([]); // 해제 후엔 통지 없음
  });

  it('store.setBloatedSysFor 변경 시 (sessionId, bloatedSys) 를 onUpdate 로 통지', () => {
    const seen: Array<[string, unknown]> = [];
    createAnomalySubscription((id, bloated) => seen.push([id, bloated]), useAnomalyStore);
    useAnomalyStore.getState().setBloatedSysFor('s1', { stage: 'critical' });
    expect(seen).toEqual([['s1', { stage: 'critical' }]]);
  });

  it('변경된 세션만 diff 통지(무관 세션은 흔들지 않음)', () => {
    useAnomalyStore.setState({ bloatedBySession: { a: { stage: 'warn' } as never } });
    const seen: string[] = [];
    createAnomalySubscription((id) => seen.push(id), useAnomalyStore);
    useAnomalyStore.getState().setBloatedSysFor('b', { stage: 'critical' });
    expect(seen).toEqual(['b']); // a 는 미변경 → 미통지
  });

  it('bloatedSys falsy 는 store 가 null 로 정규화해 통지(원본 `bloatedSys || null` 동치)', () => {
    // 실제 변경을 만들기 위해 critical → falsy(null 정규화) 전이를 본다(이전 세션 잔재 제거 경로).
    useAnomalyStore.setState({ bloatedBySession: { s2: { stage: 'critical' } as never } });
    const seen: Array<[string, unknown]> = [];
    createAnomalySubscription((id, bloated) => seen.push([id, bloated]), useAnomalyStore);
    useAnomalyStore.getState().setBloatedSysFor('s2', undefined);
    expect(seen).toEqual([['s2', null]]);
  });

  it('동일 값 재설정(null→null 등)은 변경이 없어 통지하지 않는다(idempotent)', () => {
    const seen: unknown[] = [];
    createAnomalySubscription((id) => seen.push(id), useAnomalyStore);
    useAnomalyStore.getState().setBloatedSysFor('s3', undefined); // 키 부재(null) → null: no-op
    expect(seen).toEqual([]);
  });
});

// ── ProjectList — browse 모드 행 계약 (원본 renderBrowseProjectRow :95-115) ────
describe('ProjectList — browse 모드 DOM/선택 계약', () => {
  let container: HTMLElement;
  let root: Root;
  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });
  afterEach(() => {
    act(() => root.unmount());
    document.body.innerHTML = '';
  });

  it('프로젝트마다 data-project + clickable 행을 렌더', () => {
    const html = renderToStaticMarkup(
      <ProjectList projects={PROJECTS} selectedProject={null} isMetaMode={false} metaCounts={null} />
    );
    expect(html).toContain('data-project="alpha"');
    expect(html).toContain('data-project="beta"');
    expect(html).toContain('clickable');
  });

  it('selectedProject 행만 row-selected', () => {
    const html = renderToStaticMarkup(
      <ProjectList projects={PROJECTS} selectedProject="alpha" isMetaMode={false} metaCounts={null} />
    );
    // alpha 행에 row-selected, beta 행엔 없음
    expect(html).toMatch(/data-project="alpha"[^>]*class="[^"]*row-selected|class="[^"]*row-selected[^"]*"[^>]*data-project="alpha"/);
  });

  it('active_count>0 은 활성 수 노출, 0 은 dash(—)', () => {
    const html = renderToStaticMarkup(
      <ProjectList projects={PROJECTS} selectedProject={null} isMetaMode={false} metaCounts={null} />
    );
    expect(html).toContain('proj-sess-active'); // alpha active=2
    expect(html).toContain('—'); // beta active=0
  });

  it('프로젝트가 없고 browse 모드면 table-empty 행(colspan 3)', () => {
    const html = renderToStaticMarkup(
      <ProjectList projects={[]} selectedProject={null} isMetaMode={false} metaCounts={null} />
    );
    expect(html).toContain('table-empty');
    expect(html).toContain('colSpan="3"'); // renderToStaticMarkup 은 colSpan 을 그대로 직렬화
  });

  it('행 클릭 → onSelectProject(project_name)', () => {
    let picked: string | null = null;
    renderLive(
      root,
      <ProjectList
        projects={PROJECTS}
        selectedProject={null}
        isMetaMode={false}
        metaCounts={null}
        onSelectProject={(p) => { picked = p; }}
      />,
    );
    const row = container.querySelector<HTMLElement>('[data-project="beta"]')!;
    expect(row).not.toBeNull();
    act(() => row.click());
    expect(picked!).toBe('beta');
  });
});

// ── ProjectList — metadocs 모드 (원본 renderMetaProjectRow/renderMetaGlobalRow) ──
describe('ProjectList — metadocs 모드 가상 global 행 + 항목 수', () => {
  const metaCounts = { projects: { alpha: 7 } as Record<string, number>, global: 3, total: 10 };
  let container: HTMLElement;
  let root: Root;
  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });
  afterEach(() => {
    act(() => root.unmount());
    document.body.innerHTML = '';
  });

  it('최상단 가상 global 행(data-project=__global__) 을 노출', () => {
    const html = renderToStaticMarkup(
      <ProjectList projects={PROJECTS} selectedProject={null} isMetaMode metaCounts={metaCounts} />
    );
    expect(html).toContain(`data-project="${GLOBAL_PROJECT_KEY}"`);
    expect(html).toContain('cell-proj-global');
  });

  it('프로젝트별 항목 수를 _metaCounts.projects 에서 조회(미주입 0)', () => {
    const html = renderToStaticMarkup(
      <ProjectList projects={PROJECTS} selectedProject={null} isMetaMode metaCounts={metaCounts} />
    );
    expect(html).toContain('cell-proj-meta-count');
    expect(html).toContain('>7<'); // alpha = 7
    expect(html).toContain('>10<'); // global total
  });

  it('global 행 클릭 → onSelectProject(GLOBAL_PROJECT_KEY)', () => {
    let picked: string | null = null;
    renderLive(
      root,
      <ProjectList
        projects={PROJECTS}
        selectedProject={null}
        isMetaMode
        metaCounts={metaCounts}
        onSelectProject={(p) => { picked = p; }}
      />,
    );
    const row = container.querySelector<HTMLElement>(`[data-project="${GLOBAL_PROJECT_KEY}"]`)!;
    expect(row).not.toBeNull();
    act(() => row.click());
    expect(picked!).toBe(GLOBAL_PROJECT_KEY);
  });
});

// ── SessionList — 필터/정렬/상태 (원본 renderBrowserSessions :154-180) ──────────
describe('SessionList — selectedProject 필터 + 세션 행 렌더', () => {
  const SESSIONS = [
    { id: 'aaaaaaaa-1', project_name: 'alpha', ended_at: null, started_at: '2026-05-31', last_activity_at: 100 },
    { id: 'bbbbbbbb-2', project_name: 'beta', ended_at: null, started_at: '2026-05-31', last_activity_at: 90 },
  ];
  let container: HTMLElement;
  let root: Root;
  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });
  afterEach(() => {
    act(() => root.unmount());
    document.body.innerHTML = '';
  });

  it('selectedProject 미선택 시 select-project 힌트 + 빈 행', () => {
    const html = renderToStaticMarkup(
      <SessionList sessions={SESSIONS} selectedProject={null} selectedSession={null} />
    );
    expect(html).toContain('table-empty');
  });

  it('selectedProject 의 세션만 SessionRow 로 렌더(타 프로젝트 제외)', () => {
    const html = renderToStaticMarkup(
      <SessionList sessions={SESSIONS} selectedProject="alpha" selectedSession={null} />
    );
    expect(html).toContain('sess-row-cell'); // SessionRow(P2-04) 마크업
    expect(html).toContain('data-session-id="aaaaaaaa-1"');
    expect(html).not.toContain('data-session-id="bbbbbbbb-2"'); // beta 제외
  });

  it('선택 프로젝트에 세션이 없으면 no-data 행', () => {
    const html = renderToStaticMarkup(
      <SessionList sessions={SESSIONS} selectedProject="gamma" selectedSession={null} />
    );
    expect(html).toContain('table-empty');
  });

  it('세션 행 클릭 → onSelectSession(id) (cloneElement 로 onClick 주입)', () => {
    let picked: string | null = null;
    renderLive(
      root,
      <SessionList
        sessions={SESSIONS}
        selectedProject="alpha"
        selectedSession={null}
        onSelectSession={(id) => { picked = id; }}
      />,
    );
    const row = container.querySelector<HTMLElement>('[data-session-id="aaaaaaaa-1"]')!;
    expect(row).not.toBeNull();
    act(() => row.click());
    expect(picked!).toBe('aaaaaaaa-1');
  });
});

// ── 스토어 연동 (selectedProject ↔ app-store) — filter-bar.test 선례 ───────────
describe('Sidebar — 스토어 연동(selectedProject ↔ app-store)', () => {
  it('store.selectedProject 를 ProjectList selectedProject 로 주입하면 해당 행이 row-selected', () => {
    useAppStore.getState().setSelectedProject('alpha');
    const html = renderToStaticMarkup(
      <ProjectList
        projects={PROJECTS}
        selectedProject={useAppStore.getState().selectedProject}
        isMetaMode={false}
        metaCounts={null}
       
      />
    );
    expect(html).toContain('row-selected');
  });

  it('Sidebar(컨테이너) 가 projects/sessions props 로 ProjectList+SessionList 를 합성', () => {
    const html = renderToStaticMarkup(
      <Sidebar
        projects={PROJECTS}
        sessions={[]}
        selectedProject="alpha"
        selectedSession={null}
        isMetaMode={false}
        metaCounts={null}
       
      />
    );
    expect(html).toContain('data-project="alpha"');
    expect(html).toContain('table-empty'); // sessions 비어있음
  });
});
