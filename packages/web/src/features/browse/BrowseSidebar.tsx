// features/browse/BrowseSidebar.tsx — 브라우즈 좌측 패널 전체 캡슐화 (레거시 left-panel 1:1 정합)
//
// 원본: spyglass-legacy-ref index.html <aside class="left-panel">(:167~376) 골격 +
//   left-panel.js renderBrowserProjects/renderBrowserSessions +
//   obs-panel.js 하단 통계카드 3종(Burn Rate / Cache Health / Live Pulse) +
//   panel-resize.js / left-panel-vertical-resize.js 리사이저(수평 1 + 수직 2) +
//   version-check.js #updateBadge(footer).
//
// 레거시 grid 트랙 순서(left-panel.css :26-32 — 6 row, browse 모드):
//   1) #browserProjectsSection (panel-section flex-section) — 프로젝트 테이블
//   2) #panelVerticalHandle              — 프로젝트 ↔ 세션 상하 분할
//   3) #browserSessionsSection (panel-section flex-section) — panel-header + 세션 테이블
//   4) #panelVerticalHandleBottom        — 세션 ↔ obs 상하 분할
//   5) #panelTools (panel-section tool-stats-section) — obs-panel 카드 3종
//   6) .left-panel-footer                — update-badge
//   (.panel-resize-handle / #anomalyBadge 는 absolute/floating — grid 트랙 비대상.)
//
// 규칙 준수:
//   - Sidebar(public) 시그니처 불변. 프로젝트/세션을 별도 섹션 두 벌로 쪼개야 하므로
//     합성 Sidebar 대신 그 내부 ProjectList / SessionList 를 직접 조합(둘 다 Sidebar.tsx export).
//     SessionRow 재사용 경로는 SessionList 내부에 그대로 보존.
//   - 통계카드(BurnRateCard/CacheHealthCard/LivePulseCard)는 features/dashboard import 만, payload 는
//     use-obs-cards SoT. UpdateBadge/UpdateModal 도 features/dashboard import 만.
//   - 사이드이펙트(fetch/리사이저/버전폴링)는 전부 훅 내부(use-obs-cards / use-panel-resize / useVersionCheck).
//   - data-testid / 셀렉터 계약(panel-resize-handle, panel-vertical-handle, panel-section, obs-panel,
//     left-panel-footer, update-badge, browser-projects-table) 보존.

import { useState, type ReactElement } from 'react';
import {
  ProjectList,
  SessionList,
  type ProjectLike,
  type SessionLike,
  type SidebarLabeler,
} from './Sidebar';
import {
  BurnRateCard,
  CacheHealthCard,
  LivePulseCard,
  UpdateBadge,
  UpdateModal,
  useVersionCheck,
} from '../dashboard';
import { useObsCards } from './use-obs-cards';
import { usePanelResize } from './use-panel-resize';

/** 패널 크롬 라벨(thead/세션 panel-label) — 레거시 정적 i18n(ui.html.left-panel / session-panel.label).
 *  SidebarLabeler(공유)에는 없는 chrome-only 라벨이라 별도 옵셔널 prop 으로 주입(미지정 시 레거시 영문 폴백). */
export interface BrowseSidebarChromeLabels {
  thProject?: string;
  thSession?: string;
  thToken?: string;
  sessionPanelLabel?: string;
}

/** UpdateBadge/Modal i18n 라벨러 — 미지정 시 컴포넌트 내장 영문 폴백 사용. */
export type BrowseSidebarVersionT = (key: string, vars?: Record<string, unknown>) => string;

export interface BrowseSidebarProps {
  projects: readonly ProjectLike[];
  sessions: readonly SessionLike[];
  selectedProject: string | null;
  selectedSession: string | null;
  labeler: SidebarLabeler;
  onSelectProject?: (project: string) => void;
  onSelectSession?: (id: string) => void;
  /** 통계카드 폴링 주기(ms) — 미지정 시 30s(use-obs-cards 기본). 테스트에서 0(폴링 없음) 주입 가능. */
  obsIntervalMs?: number;
  /** 패널 크롬 라벨(thead/세션 헤더) — 미지정 시 레거시 영문 폴백. */
  chromeLabels?: BrowseSidebarChromeLabels;
  /** UpdateBadge/Modal i18n 라벨러 — 미지정 시 컴포넌트 영문 폴백(key passthrough 호환). */
  versionT?: BrowseSidebarVersionT;
  /** 버전 폴링 주기(ms) — 미지정 시 useVersionCheck 기본(10분). 테스트에서 주입 가능. */
  versionIntervalMs?: number;
}

const DEFAULT_T: BrowseSidebarVersionT = (key) => key;

/**
 * 브라우즈 좌측 패널 전체 — 프로젝트 섹션 / 수직핸들 / 세션 섹션(panel-header) / 수직핸들2 /
 *   obs 통계카드 3종 / update-badge footer. 레거시 left-panel 구조 1:1.
 */
export function BrowseSidebar({
  projects,
  sessions,
  selectedProject,
  selectedSession,
  labeler,
  onSelectProject,
  onSelectSession,
  obsIntervalMs,
  chromeLabels,
  versionT,
  versionIntervalMs,
}: BrowseSidebarProps): ReactElement {
  const obs = useObsCards(obsIntervalMs != null ? { intervalMs: obsIntervalMs } : {});
  const { panelRef, widthHandleRef, vTopHandleRef, vBottomHandleRef, vProjectsRef, vSessionsRef, vToolsRef } =
    usePanelResize();
  const version = useVersionCheck(versionIntervalMs != null ? { intervalMs: versionIntervalMs } : {});
  const [modalOpen, setModalOpen] = useState(false);
  const t = versionT ?? DEFAULT_T;

  // 세션 패널 hint — renderBrowserSessions(:155/169) 1:1: 미선택 → select-project, 선택 → session-count.
  const sessionHint = selectedProject
    ? labeler.sessionCount(selectedProject, sessions.filter((s) => s.project_name === selectedProject).length)
    : labeler.selectProject();

  const thProject = chromeLabels?.thProject ?? 'Project';
  const thSession = chromeLabels?.thSession ?? 'Sessions';
  const thToken = chromeLabels?.thToken ?? 'Tokens';
  const sessionPanelLabel = chromeLabels?.sessionPanelLabel ?? 'Sessions';

  return (
    <aside className="left-panel" data-testid="browse-sidebar" ref={panelRef}>
      {/* 수평 너비 드래그 핸들(absolute) — use-panel-resize 가 mousedown/dblclick 결선. */}
      <div
        className="panel-resize-handle"
        title="Drag to resize · Double-click to fit content"
        ref={widthHandleRef}
      />

      {/* floating anomaly badge — 현재 hidden(원본 ADR-006, Phase 2 결선 전). */}
      <button
        className="anomaly-badge"
        id="anomalyBadge"
        hidden
        type="button"
        aria-label="Anomaly detected"
      />

      {/* ── 1) 프로젝트 섹션 — 레거시 #browserProjectsSection(panel-body > table[colgroup3+thead+tbody]). ── */}
      <div className="panel-section flex-section" id="browserProjectsSection" ref={vProjectsRef}>
        <div className="panel-body">
          <table className="browser-projects-table">
            <colgroup>
              <col />
              <col style={{ width: '52px' }} />
              <col style={{ width: '92px' }} />
            </colgroup>
            <thead>
              <tr className="thead-browse">
                <th>{thProject}</th>
                <th style={{ textAlign: 'right' }}>{thSession}</th>
                <th style={{ textAlign: 'right' }}>{thToken}</th>
              </tr>
            </thead>
            <tbody id="browserProjectsBody">
              <ProjectList
                projects={projects}
                selectedProject={selectedProject}
                isMetaMode={false}
                metaCounts={null}
                labeler={labeler}
                onSelectProject={onSelectProject}
              />
            </tbody>
          </table>
        </div>
      </div>

      {/* ── 2) 프로젝트 ↔ 세션 상하 분할 핸들(레거시 #panelVerticalHandle). ── */}
      <div
        className="panel-vertical-handle"
        id="panelVerticalHandle"
        title="Drag to resize height"
        ref={vTopHandleRef}
      />

      {/* ── 3) 세션 섹션 — 레거시 #browserSessionsSection(panel-header + panel-body > table > tbody). ── */}
      <div className="panel-section flex-section" id="browserSessionsSection" ref={vSessionsRef}>
        <div className="panel-header">
          <span className="panel-label">{sessionPanelLabel}</span>
          <span className="panel-hint" id="sessionPaneHint">
            {sessionHint}
          </span>
        </div>
        <div className="panel-body">
          <table>
            <tbody id="browserSessionsBody">
              <SessionList
                sessions={sessions}
                selectedProject={selectedProject}
                selectedSession={selectedSession}
                labeler={labeler}
                onSelectSession={onSelectSession}
              />
            </tbody>
          </table>
        </div>
      </div>

      {/* ── 4) 세션 ↔ obs 상하 분할 핸들(레거시 #panelVerticalHandleBottom). ── */}
      <div
        className="panel-vertical-handle"
        id="panelVerticalHandleBottom"
        title="Drag to resize height"
        ref={vBottomHandleRef}
      />

      {/* ── 5) obs 통계카드 3종 — 레거시 #panelTools(panel-body > obs-panel). payload 는 use-obs-cards SoT. ── */}
      <div className="panel-section tool-stats-section" id="panelTools" ref={vToolsRef}>
        <div className="panel-body">
          <div className="obs-panel" id="obsPanel">
            <BurnRateCard payload={obs.burnRate} />
            <CacheHealthCard payload={obs.cacheHealth} />
            <LivePulseCard payload={obs.livePulse} />
          </div>
        </div>
      </div>

      {/* ── 6) footer — update-badge(available 클릭 시 UpdateModal). 레거시 .left-panel-footer. ── */}
      <div className="left-panel-footer">
        <UpdateBadge
          state={version.view.badge}
          currentVersion={version.view.currentVersion}
          latestTag={version.view.latestTag}
          onOpen={() => setModalOpen(true)}
          t={t}
        />
      </div>

      {/* UpdateModal — footer 와 동거(overlay 는 fixed). available 배지 클릭 시 open. */}
      <UpdateModal
        open={modalOpen}
        currentVersion={version.cache?.currentVersion ?? version.view.currentVersion}
        latestTag={version.cache?.latestTag ?? version.view.latestTag}
        onConfirm={() => setModalOpen(false)}
        onCancel={() => setModalOpen(false)}
        onClose={() => setModalOpen(false)}
        t={t}
      />
    </aside>
  );
}
