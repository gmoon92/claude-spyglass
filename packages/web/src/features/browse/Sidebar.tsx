/**
 * features/browse/Sidebar.tsx — 좌측 패널(프로젝트/세션) React 이식 (P3-02)
 *
 * 원본: assets/js/left-panel.js (renderBrowserProjects/renderBrowserSessions/GLOBAL_PROJECT_KEY/
 *   top-level `session-anomalies-loaded` 리스너 + _allProjects/_allSessions 모듈 상태).
 *
 * A-2(CustomEvent 제거): 원본 'session-anomalies-loaded' document CustomEvent 구독은 stores/anomaly-store
 *   (Zustand) 구독으로 전환됐다. createAnomalySubscription 은 store.subscribe 로 bloated_sys 변경을 받아
 *   onUpdate 로 통지한다(전역 document 이벤트버스 폐기 — React 채널 일원화).
 *
 * 이식 전략(P2-08 FilterBar/SearchBox controlled 선례 계승):
 *  - 모듈 상태 _allProjects/_allSessions → props(controlled). 호출처(features/app)가 데이터 소스/
 *    app-store 에서 주입. 선택 상태(selectedProject/selectedSession)도 prop + onSelect* 콜백 통지.
 *  - renderBrowserProjects/renderBrowserSessions(innerHTML) → <ProjectList>/<SessionList> JSX.
 *  - escHtml 불필요: React 텍스트 노드 자동 이스케이프(원본 escHtml 호출과 동치 안전).
 *  - 세션 행은 P2-04 SessionRow.tsx 재사용. onClick 은 cloneElement 로 비침습 주입(SessionRow 무변경).
 *  - 전역 window.I18n 직접 의존 제거 → labeler prop 주입(FilterBar 선례, 컴포넌트 무전역).
 *    단, SessionRow(P2-04)/fmtRelative 의 window.I18n 의존은 원본 SSoT 라 그대로 둔다.
 *
 * 신규 계약(Gap — 원본 미보장):
 *  - createAnomalySubscription: 원본 top-level addEventListener(left-panel.js:36-50)는 모듈
 *    평가 시 영구 등록되고 해제 경로가 없다. 컴포넌트 마운트 시 구독·언마운트 시 해제로 전환해
 *    SPA 재마운트 누수를 차단한다. document 부재 환경(bun test) noop 가드는 원본과 동일.
 *
 * 병존: assets/js/left-panel.js 는 유지된다(소비처 전환은 후속 페이즈). 본 파일은 추가만.
 *
 * @module features/browse/Sidebar
 */
import { cloneElement, memo, useEffect } from 'react';
import type { ReactElement } from 'react';
import { fmt, fmtToken } from '../../lib/formatters';
import { SessionRow } from '../../components/render/SessionRow';
import { Skeleton } from '../../components/Skeleton';
import { useAnomalyStore } from '../../stores/anomaly-store';

/** 가상 'user (global)' 행 식별자 — 원본 left-panel.js:17 GLOBAL_PROJECT_KEY 1:1. metadocs 전용. */
export const GLOBAL_PROJECT_KEY = '__global__';

/** 프로젝트 행 데이터(원본 _allProjects 항목 형태 — browse: token/active, meta: name). */
export interface ProjectLike {
  project_name: string;
  total_tokens?: number;
  active_count?: number | null;
}

/** 세션 행 데이터(원본 _allSessions 항목 — renderBrowserSessions 필터/정렬 기준 필드). */
export interface SessionLike {
  id: string;
  project_name: string;
  started_at?: string | number | null;
  ended_at?: string | number | null;
  last_activity_at?: string | number | null;
  live_state?: string | null;
  first_prompt_payload?: string | null;
  total_tokens?: number;
  bloated_sys?: unknown;
}

/** metadocs 카운트(원본 _metaCounts — setMetaDocsCounts 주입 형태). */
export interface MetaCounts {
  projects: Record<string, number>;
  global: number;
  total: number;
}

/** i18n 라벨러 — 컴포넌트 무전역(FilterBar 선례). 호출처가 window.I18n 을 감싸 주입. */
export interface SidebarLabeler {
  /** 빈 데이터 행 라벨(ui.left-panel.no-data). */
  noData: () => string;
  /** 활성 세션 수 title(ui.left-panel.live-count). */
  liveCount: (count: number) => string;
  /** 프로젝트 미선택 힌트(ui.left-panel.select-project). */
  selectProject: () => string;
  /** 세션 수 힌트(ui.left-panel.session-count). */
  sessionCount: (project: string, count: number) => string;
  /** 가상 global 행 라벨(ui.left-panel.global-row-label). */
  globalRowLabel: () => string;
  /** 가상 global 행 title(ui.left-panel.global-row-title). */
  globalRowTitle: () => string;
}

/**
 * 세션 정렬 — 원본 renderBrowserSessions(:165-173) 비교자 1:1.
 *  - 1순위: 활성(ended_at == null) 우선.
 *  - 2순위: last_activity_at || started_at 내림차순.
 *  - 3순위: started_at 내림차순.
 * 순수 함수: 입력을 변형하지 않도록 복사 후 정렬(원본은 .filter 결과를 정렬해 부수효과 없음 — 동치).
 */
export function sortSessions<T extends SessionLike>(list: readonly T[]): T[] {
  return [...list].sort((a, b) => {
    const aActive = a.ended_at == null ? 1 : 0;
    const bActive = b.ended_at == null ? 1 : 0;
    if (bActive !== aActive) return bActive - aActive;
    const aLast = (a.last_activity_at as number) || (a.started_at as number) || 0;
    const bLast = (b.last_activity_at as number) || (b.started_at as number) || 0;
    if (bLast !== aLast) return (bLast as number) - (aLast as number);
    return ((b.started_at as number) || 0) - ((a.started_at as number) || 0);
  });
}

/**
 * anomaly(bloated_sys) 변경 구독 — 원본 left-panel.js:36-50 'session-anomalies-loaded' 핸들러를
 *   stores/anomaly-store(Zustand) 구독으로 전환(A-2: 전역 document CustomEvent 폐기).
 *  - store.subscribe 로 bloatedBySession 변경을 받아, 직전 스냅샷과 diff 한 세션만 onUpdate 통지한다.
 *    (원본은 _allSessions 직접 변이 + 조건부 renderBrowserSessions — React 에선 onUpdate 콜백으로
 *     상위 상태 갱신을 위임. bloatedSys falsy 는 store 가 이미 null 로 정규화해 둔다.)
 *  - SSR/단위테스트(store 미구독 불필요)에서도 안전: zustand subscribe 는 환경 비의존.
 *
 * @param onUpdate (sessionId, bloatedSys|null) 통지
 * @param store 주입 가능한 anomaly-store(테스트). 기본 전역 useAnomalyStore.
 * @returns 구독 해제 cleanup(useEffect 반환값으로 사용).
 */
export function createAnomalySubscription(
  onUpdate: (sessionId: string, bloatedSys: unknown) => void,
  store: typeof useAnomalyStore = useAnomalyStore,
): () => void {
  let prev = store.getState().bloatedBySession;
  return store.subscribe((state) => {
    const next = state.bloatedBySession;
    if (next === prev) return;
    // 변경/추가된 세션만 통지(다른 세션 갱신이 무관 행을 흔들지 않도록 diff).
    for (const sessionId of Object.keys(next)) {
      if (next[sessionId] !== prev[sessionId]) onUpdate(sessionId, next[sessionId] ?? null);
    }
    prev = next;
  });
}

/** 가상 'user (global)' 행 — 원본 renderMetaGlobalRow(:141-152). metadocs 모드 최상단. */
function GlobalRow({
  selected,
  total,
  labeler,
  onSelect,
}: {
  selected: boolean;
  total: number;
  labeler: SidebarLabeler;
  onSelect?: (p: string) => void;
}): ReactElement {
  return (
    <tr
      className={`clickable cell-proj-global${selected ? ' row-selected' : ''}`}
      data-project={GLOBAL_PROJECT_KEY}
      title={labeler.globalRowTitle()}
      onClick={() => onSelect?.(GLOBAL_PROJECT_KEY)}
    >
      <td className="cell-proj-name" title={labeler.globalRowLabel()}>
        {labeler.globalRowLabel()}
      </td>
      <td className="num cell-proj-meta-count" style={{ textAlign: 'right' }}>
        {fmt(total)}
      </td>
      <td className="cell-proj-meta-spacer" />
    </tr>
  );
}

/** browse 모드 프로젝트 행 — 원본 renderBrowseProjectRow(:95-115): [이름|활성세션|토큰바]. */
function BrowseProjectRow({
  p,
  maxT,
  selected,
  labeler,
  onSelect,
}: {
  p: ProjectLike;
  maxT: number;
  selected: boolean;
  labeler: SidebarLabeler;
  onSelect?: (p: string) => void;
}): ReactElement {
  const pct = Math.max(1, Math.round(((p.total_tokens || 0) / maxT) * 100));
  const active = p.active_count ?? 0;
  const sessCls = active > 0 ? ' proj-active' : '';
  return (
    <tr
      className={`clickable${selected ? ' row-selected' : ''}`}
      data-project={p.project_name}
      onClick={() => onSelect?.(p.project_name)}
    >
      <td className="cell-proj-name" title={p.project_name || ''}>
        {p.project_name || '—'}
      </td>
      <td className={`num cell-proj-sess${sessCls}`} style={{ textAlign: 'right' }} title={labeler.liveCount(active)}>
        {active === 0 ? '—' : <span className="proj-sess-active">{fmt(active)}</span>}
      </td>
      <td>
        <div className="bar-cell" style={{ justifyContent: 'flex-end', gap: '4px' }}>
          <div className="bar-track" style={{ minWidth: '36px' }}>
            <div className="bar-fill" style={{ width: `${pct}%` }} />
          </div>
          <span className="bar-label num-hi" style={{ minWidth: '30px' }}>
            {fmtToken(p.total_tokens)}
          </span>
        </div>
      </td>
    </tr>
  );
}

/** metadocs 모드 프로젝트 행 — 원본 renderMetaProjectRow(:123-131): [이름|항목수|빈셀]. */
function MetaProjectRow({
  p,
  selected,
  count,
  onSelect,
}: {
  p: ProjectLike;
  selected: boolean;
  count: number;
  onSelect?: (p: string) => void;
}): ReactElement {
  return (
    <tr
      className={`clickable${selected ? ' row-selected' : ''}`}
      data-project={p.project_name}
      onClick={() => onSelect?.(p.project_name)}
    >
      <td className="cell-proj-name" title={p.project_name || ''}>
        {p.project_name || '—'}
      </td>
      <td className="num cell-proj-meta-count" style={{ textAlign: 'right' }}>
        {fmt(count)}
      </td>
      <td className="cell-proj-meta-spacer" />
    </tr>
  );
}

export interface ProjectListProps {
  /** 프로젝트 목록(원본 _allProjects) — 호출처 주입(controlled). */
  projects: readonly ProjectLike[];
  /** 선택 프로젝트(원본 getSelectedProject()). null = 미선택. */
  selectedProject: string | null;
  /** metadocs 모드 여부(원본 getAppMode()==='metadocs'). */
  isMetaMode: boolean;
  /** metadocs 항목 수(원본 _metaCounts). browse 모드면 null 허용. */
  metaCounts: MetaCounts | null;
  labeler: SidebarLabeler;
  /** 행 클릭 통지(원본 main.js data-project 위임 대체). */
  onSelectProject?: (project: string) => void;
}

/**
 * 프로젝트 리스트 — 원본 renderBrowserProjects(:68-88) JSX 대응물.
 *  - browse 모드 + 빈 목록 → table-empty 행(colspan 3).
 *  - metadocs 모드 → 최상단 가상 global 행 + 프로젝트별 meta 행.
 *  - browse 모드 → token bar 행(maxT 정규화는 원본 :83 동일).
 *
 * 직접 호출(white-box) 테스트 계약 유지: 본 함수는 plain 함수로 보존한다(sidebar.test.tsx 가
 *   `ProjectList({...})` 로 직접 호출해 element tree 를 walk). 메모화는 Sidebar 의 렌더 경로에만
 *   적용한다(아래 MemoProjectList) — public API/타입/출력 불변, 메모는 호출처 결합으로 격리.
 */
export function ProjectList({
  projects,
  selectedProject,
  isMetaMode,
  metaCounts,
  labeler,
  onSelectProject,
}: ProjectListProps): ReactElement {
  if (!projects.length && !isMetaMode) {
    return (
      <tr>
        <td colSpan={3} className="table-empty">
          {labeler.noData()}
        </td>
      </tr>
    );
  }
  const maxT = Math.max(...projects.map((p) => p.total_tokens || 0), 1);
  return (
    <>
      {isMetaMode && (
        <GlobalRow
          selected={selectedProject === GLOBAL_PROJECT_KEY}
          total={metaCounts?.total ?? 0}
          labeler={labeler}
          onSelect={onSelectProject}
        />
      )}
      {projects.map((p) =>
        isMetaMode ? (
          <MetaProjectRow
            key={p.project_name}
            p={p}
            selected={selectedProject === p.project_name}
            count={metaCounts?.projects?.[p.project_name] ?? 0}
            onSelect={onSelectProject}
          />
        ) : (
          <BrowseProjectRow
            key={p.project_name}
            p={p}
            maxT={maxT}
            selected={selectedProject === p.project_name}
            labeler={labeler}
            onSelect={onSelectProject}
          />
        )
      )}
    </>
  );
}

/**
 * 메모화 프로젝트 리스트 — Sidebar 렌더 경로 전용(P5-04 성능).
 *
 * BrowseLayout 이 고주기 SSE(new_request 5-20/s)로 `sessions` 만 갱신해 Sidebar 가 re-render 될 때,
 *   ProjectList 의 입력(projects 는 마운트 1회 fetch 후 불변 ref · selectedProject 원시값 ·
 *   isMetaMode/metaCounts 리터럴 · labeler useMemo · onSelectProject 미지정)이 불변이면 shallow
 *   비교로 프로젝트 행 재계산(maxT 정규화 등)을 건너뛴다. SessionList 도 동일 이유로 메모화한다
 *   (아래 MemoSessionList — feed-only 재렌더 시 sortSessions 재계산 차단, onSelectSession 안정화 전제).
 * 출력은 ProjectList 와 동일(메모는 re-render 회피일 뿐 동작 무변경).
 *
 * export 근거: 합성 `Sidebar` 는 프로젝트+세션을 한 <tbody> 에 묶지만, BrowseSidebar 는 레거시 grid
 *   구조상 프로젝트/세션을 별도 <table> 두 벌로 쪼개야 해 합성 Sidebar 를 쓸 수 없다. 따라서 memo
 *   버전을 직접 조합하도록 export 한다(비메모 ProjectList/SessionList 를 쓰면 BrowseLayout 의
 *   고주기 SSE 재렌더가 매번 프로젝트 행 maxT 재계산을 유발).
 */
export const MemoProjectList = memo(ProjectList);

export interface MetaProjectListProps {
  /** 프로젝트 목록(원본 _allProjects) — 호출처 주입(controlled). */
  projects: readonly ProjectLike[];
  /** 선택 프로젝트(원본 getSelectedProject()). null = 미선택. */
  selectedProject: string | null;
  /** metadocs 항목 수(원본 _metaCounts). */
  metaCounts: MetaCounts | null;
  labeler: SidebarLabeler;
  /** 행 클릭 통지(원본 main.js data-project 위임 대체). */
  onSelectProject?: (project: string) => void;
}

/**
 * metadocs 전용 프로젝트 리스트 — 가상 global 행 + MetaProjectRow 만 노출.
 *
 * 분리 근거(meta-docs 좌측 패널 truncate 회귀):
 *  - 기존 MetaDocsLayout 은 공유 `Sidebar`(ProjectList + SessionList)를 좌측 프로젝트 테이블의
 *    <tbody> 에 통째로 주입했다. metadocs 모드에서 SessionList 는 selectedProject 가 metadocs
 *    가상 키일 때 `<td colSpan={4}>` 빈 행을 내보내는데, 이 4-span 셀이 3-col colgroup
 *    (이름 가변 | 52px | 92px) 의 table-layout:fixed 계산에 4번째 phantom 컬럼을 끼워 넣어
 *    이름 col 폭을 절반(legacy 64px → 32px)으로 깎았다. 결과적으로 'claude-code-system' 이
 *    'claud…' 로 잘림.
 *  - 본 컴포넌트는 SessionList 를 포함하지 않으므로 colspan=4 누수가 사라지고, 이름 col 이
 *    원래대로 가변 폭(나머지 폭 전부)을 차지한다 — 레거시 metadocs 좌측과 1:1.
 *  - browse 경로(`Sidebar`/`ProjectList`/`SessionList`)는 일절 건드리지 않는다(공유 회귀 금지).
 *  - GlobalRow/MetaProjectRow 렌더 함수를 그대로 재사용(직접 마크업 작성 금지 — 캡슐화 원칙).
 *
 * 출력은 ProjectList(isMetaMode=true) 의 프로젝트 부분과 동일하되 SessionList 가 빠진 것.
 */
export function MetaProjectList({
  projects,
  selectedProject,
  metaCounts,
  labeler,
  onSelectProject,
}: MetaProjectListProps): ReactElement {
  return (
    <>
      <GlobalRow
        selected={selectedProject === GLOBAL_PROJECT_KEY}
        total={metaCounts?.total ?? 0}
        labeler={labeler}
        onSelect={onSelectProject}
      />
      {projects.map((p) => (
        <MetaProjectRow
          key={p.project_name}
          p={p}
          selected={selectedProject === p.project_name}
          count={metaCounts?.projects?.[p.project_name] ?? 0}
          onSelect={onSelectProject}
        />
      ))}
    </>
  );
}

export interface SessionListProps {
  /** 세션 목록(원본 _allSessions) — 호출처 주입(controlled). */
  sessions: readonly SessionLike[];
  /** 선택 프로젝트(원본 getSelectedProject()). null이면 빈/힌트. */
  selectedProject: string | null;
  /** 선택 세션(원본 getSelectedSession()) — row-selected 강조. */
  selectedSession: string | null;
  labeler: SidebarLabeler;
  /** 세션 행 클릭 통지(원본 main.js data-session-id 위임 대체). */
  onSelectSession?: (id: string) => void;
  /** 초기/전환 fetch 대기 중 여부 — 빈 목록을 no-data 대신 스켈레톤 행으로(로딩 오해 방지). */
  loading?: boolean;
}

/**
 * 세션 리스트 — 원본 renderBrowserSessions(:154-180) JSX 대응물.
 *  - 미선택 → 빈 행(colspan 4) + select-project 힌트.
 *  - 선택 프로젝트 필터 + sortSessions 정렬 후 SessionRow(P2-04) 재사용.
 *  - 세션 0 → no-data 행. onSelectSession 은 cloneElement 로 각 행 onClick 주입(SessionRow 무변경).
 */
export function SessionList({
  sessions,
  selectedProject,
  selectedSession,
  labeler,
  onSelectSession,
  loading = false,
}: SessionListProps): ReactElement {
  if (!selectedProject) {
    return (
      <tr>
        <td colSpan={4} className="table-empty" title={labeler.selectProject()}>
          —
        </td>
      </tr>
    );
  }
  const list = sortSessions(sessions.filter((s) => s.project_name === selectedProject));
  if (!list.length) {
    // 로딩 중 → 스켈레톤 행(테이블 구조 유지). "데이터 없음"이 fetch 대기 중 뜨는 오해를 막는다.
    if (loading) {
      return (
        <>
          {Array.from({ length: 4 }).map((_, i) => (
            <tr key={i} className="sk-session-row" aria-busy="true">
              <td colSpan={4}>
                <Skeleton variant="line" />
              </td>
            </tr>
          ))}
        </>
      );
    }
    return (
      <tr>
        <td colSpan={4} className="table-empty" title={labeler.sessionCount(selectedProject, 0)}>
          {labeler.noData()}
        </td>
      </tr>
    );
  }
  return (
    <>
      {list.map((s) => {
        // SessionRow(P2-04)는 onClick 미보유 — cloneElement 로 <tr> 루트에 비침습 주입.
        const row = SessionRow({ s, isSelected: selectedSession === s.id });
        return cloneElement(row, { key: s.id, onClick: () => onSelectSession?.(s.id) });
      })}
    </>
  );
}

/**
 * 메모화 세션 리스트 — Sidebar 렌더 경로 전용(Chunk-3 성능).
 *
 * BrowseLayout 이 고주기 SSE feed(new_request 5-20/s)로 re-render 될 때, sessions 자체는
 *   불변(store selector ref 안정)인데도 부모 재렌더가 Sidebar→SessionList 까지 전파돼
 *   sortSessions(filter+sort) 가 매번 재실행됐다. onSelectSession 이 호출처(BrowseLayout)에서
 *   useCallback 으로 안정화됐고 labeler 는 useMemo, selectedProject/Session 은 원시값이라
 *   sessions 불변 시 shallow 비교로 목록 재계산을 건너뛴다(feed-only 재렌더 차단).
 *   sessions 가 실제로 갱신되면 ref 가 바뀌어 정상 재렌더된다(데이터 갱신은 그대로 반영).
 * 출력은 SessionList 와 동일(메모는 re-render 회피일 뿐 동작 무변경).
 *
 * export 근거: MemoProjectList 와 동일 — BrowseSidebar 의 분리된 세션 <table> 가 직접 사용.
 *   sessions ref 가 SSE token patch 로 바뀔 때만 재렌더되고, BrowseLayout 의 무관한 로컬 state
 *   변경(chartCollapsed/dateOpen 등)으로는 sortSessions 재계산을 건너뛴다.
 */
export const MemoSessionList = memo(SessionList);

export interface SidebarProps {
  projects: readonly ProjectLike[];
  sessions: readonly SessionLike[];
  selectedProject: string | null;
  selectedSession: string | null;
  isMetaMode: boolean;
  metaCounts: MetaCounts | null;
  labeler: SidebarLabeler;
  onSelectProject?: (project: string) => void;
  onSelectSession?: (id: string) => void;
  /** anomaly 구독 통지(원본 left-panel.js 핸들러의 _allSessions 변이 → 상위 상태 위임). */
  onAnomalyUpdate?: (sessionId: string, bloatedSys: unknown) => void;
  /** 세션 목록 초기/전환 fetch 대기 — 빈 목록을 스켈레톤으로(SessionList 로 위임). */
  sessionsLoading?: boolean;
}

/**
 * 좌측 패널 컨테이너 — ProjectList + SessionList 합성 + anomaly 구독 생명주기.
 *  - 마운트 시 createAnomalySubscription 구독, 언마운트 시 해제(신규 누수 가드).
 *  - tbody 래퍼 없이 행 fragment 만 노출(원본 innerHTML 이 <tbody> 내부를 채운 것과 동치 —
 *    호출처가 browserProjectsBody/browserSessionsBody <tbody> 안에 배치).
 */
export function Sidebar({
  projects,
  sessions,
  selectedProject,
  selectedSession,
  isMetaMode,
  metaCounts,
  labeler,
  onSelectProject,
  onSelectSession,
  onAnomalyUpdate,
  sessionsLoading = false,
}: SidebarProps): ReactElement {
  useEffect(() => {
    if (!onAnomalyUpdate) return;
    return createAnomalySubscription(onAnomalyUpdate);
  }, [onAnomalyUpdate]);

  return (
    <>
      <MemoProjectList
        projects={projects}
        selectedProject={selectedProject}
        isMetaMode={isMetaMode}
        metaCounts={metaCounts}
        labeler={labeler}
        onSelectProject={onSelectProject}
      />
      <MemoSessionList
        sessions={sessions}
        selectedProject={selectedProject}
        selectedSession={selectedSession}
        labeler={labeler}
        onSelectSession={onSelectSession}
        loading={sessionsLoading}
      />
    </>
  );
}
