/**
 * features/browse/Sidebar.tsx — 좌측 패널(프로젝트/세션) React 이식 (P3-02)
 *
 * 원본: assets/js/left-panel.js (renderBrowserProjects/renderBrowserSessions/GLOBAL_PROJECT_KEY/
 *   top-level `session-anomalies-loaded` 리스너 + _allProjects/_allSessions 모듈 상태).
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
import { cloneElement, useEffect } from 'react';
import type { ReactElement } from 'react';
import { fmt, fmtToken } from '../../../assets/js/formatters.js';
import { SessionRow } from '../../components/render/SessionRow';

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
 * 'session-anomalies-loaded' 구독 — 원본 left-panel.js:36-50 핸들러 동치 + 해제 경로 추가(신규 계약).
 *  - document 부재(bun test) 시 noop cleanup 반환(원본 가드 동일 — api.js TDZ 연쇄 차단 계승).
 *  - 핸들러: detail.sessionId 부재면 무시, bloatedSys falsy 는 null 정규화 후 onUpdate 통지.
 *    (원본은 _allSessions 직접 변이 + 조건부 renderBrowserSessions — React 에선 onUpdate 콜백으로
 *     상위 상태 갱신을 위임. critical-only 노출 정책/stale dot 캐시 의미는 호출처가 보존.)
 *
 * @param onUpdate (sessionId, bloatedSys|null) 통지
 * @param doc 주입 가능한 document(테스트). 기본 globalThis.document.
 * @returns 구독 해제 cleanup(useEffect 반환값으로 사용).
 */
export function createAnomalySubscription(
  onUpdate: (sessionId: string, bloatedSys: unknown) => void,
  doc: Document | undefined = typeof document !== 'undefined' ? document : undefined,
): () => void {
  if (!doc) return () => {};
  const handler = (e: Event) => {
    const { sessionId, bloatedSys } = ((e as CustomEvent).detail as { sessionId?: string; bloatedSys?: unknown }) || {};
    if (!sessionId) return;
    onUpdate(sessionId, bloatedSys || null);
  };
  doc.addEventListener('session-anomalies-loaded', handler);
  return () => doc.removeEventListener('session-anomalies-loaded', handler);
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
}: SidebarProps): ReactElement {
  useEffect(() => {
    if (!onAnomalyUpdate) return;
    return createAnomalySubscription(onAnomalyUpdate);
  }, [onAnomalyUpdate]);

  return (
    <>
      <ProjectList
        projects={projects}
        selectedProject={selectedProject}
        isMetaMode={isMetaMode}
        metaCounts={metaCounts}
        labeler={labeler}
        onSelectProject={onSelectProject}
      />
      <SessionList
        sessions={sessions}
        selectedProject={selectedProject}
        selectedSession={selectedSession}
        labeler={labeler}
        onSelectSession={onSelectSession}
      />
    </>
  );
}
