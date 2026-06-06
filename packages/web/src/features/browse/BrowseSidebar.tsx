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

import { type ReactElement } from 'react';
import {
  MemoProjectList,
  MemoSessionList,
  type ProjectLike,
  type SessionLike,
  type SidebarLabeler,
} from './Sidebar';
import {
  BurnRateCard,
  CacheHealthCard,
  LivePulseCard,
  SidebarVersionFooter,
} from '../dashboard';
import { useObsCards } from './use-obs-cards';
import { usePanelResize } from './use-panel-resize';
import { useTranslation } from 'react-i18next';

/** 패널 크롬 라벨(thead/세션 panel-label) — 레거시 정적 i18n(ui.html.left-panel / session-panel.label).
 *  SidebarLabeler(공유)에는 없는 chrome-only 라벨이라 별도 옵셔널 prop 으로 주입(미지정 시 레거시 영문 폴백). */
export interface BrowseSidebarChromeLabels {
  thProject?: string;
  thSession?: string;
  thToken?: string;
  sessionPanelLabel?: string;
}

export interface BrowseSidebarProps {
  projects: readonly ProjectLike[];
  sessions: readonly SessionLike[];
  selectedProject: string | null;
  selectedSession: string | null;
  labeler: SidebarLabeler;
  onSelectProject?: (project: string) => void;
  onSelectSession?: (id: string) => void;
  /** 세션 목록 초기/전환 fetch 대기 — 빈 목록을 스켈레톤으로(SessionList 로 위임). */
  sessionsLoading?: boolean;
  /** 통계카드 폴링 주기(ms) — 미지정 시 30s(use-obs-cards 기본). 테스트에서 0(폴링 없음) 주입 가능. */
  obsIntervalMs?: number;
  /** 패널 크롬 라벨(thead/세션 헤더) — 미지정 시 레거시 영문 폴백. */
  chromeLabels?: BrowseSidebarChromeLabels;
}

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
  sessionsLoading,
  obsIntervalMs,
  chromeLabels,
}: BrowseSidebarProps): ReactElement {
  // i18n — react-i18next 단일 경로. 언어 변경 시 useTranslation 구독으로 재렌더 → tr() 재평가.
  const { t: tr } = useTranslation();
  const obs = useObsCards(obsIntervalMs != null ? { intervalMs: obsIntervalMs } : {});
  const { panelRef, widthHandleRef, vTopHandleRef, vBottomHandleRef, vProjectsRef, vSessionsRef, vToolsRef } =
    usePanelResize();
  // 버전 배지 footer — version-store 구독·모달 결선·i18n 해석을 SidebarVersionFooter(단일 출처)가
  //   캡슐화한다(버그 #6 + update-badge-position/i18n 회귀). 호출처는 라벨러를 주입하지 않는다.

  // 세션 패널 hint — renderBrowserSessions(:155/169) 1:1: 미선택 → select-project, 선택 → session-count.
  const sessionHint = selectedProject
    ? labeler.sessionCount(selectedProject, sessions.filter((s) => s.project_name === selectedProject).length)
    : labeler.selectProject();

  // 패널 크롬 라벨(thead/세션 panel-label) — 레거시 정적 i18n 1:1 (index.html data-i18n).
  //   chromeLabels prop 으로 명시 주입되면 그것을 우선(테스트·호출처 override), 미지정 시 i18n 어댑터
  //   t() 로 해석(react-i18next, 키 부재 시 key passthrough — 레거시 data-i18n 미해석 폴백과 동치).
  const thProject = chromeLabels?.thProject ?? tr('ui.html.left-panel.th-project');
  const thSession = chromeLabels?.thSession ?? tr('ui.html.left-panel.th-session');
  const thToken = chromeLabels?.thToken ?? tr('ui.html.left-panel.th-token');
  const sessionPanelLabel = chromeLabels?.sessionPanelLabel ?? tr('ui.html.session-panel.label');

  return (
    <aside className="left-panel" data-testid="browse-sidebar" ref={panelRef}>
      {/* 수평 너비 드래그 핸들(absolute) — use-panel-resize 가 mousedown/dblclick 결선. */}
      <div
        className="panel-resize-handle"
        data-tip="Drag to resize · Double-click to fit content"
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
              <MemoProjectList
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
        data-tip="Drag to resize height"
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
              <MemoSessionList
                sessions={sessions}
                selectedProject={selectedProject}
                selectedSession={selectedSession}
                labeler={labeler}
                onSelectSession={onSelectSession}
                loading={sessionsLoading}
              />
            </tbody>
          </table>
        </div>
      </div>

      {/* ── 4) 세션 ↔ obs 상하 분할 핸들(레거시 #panelVerticalHandleBottom). ── */}
      <div
        className="panel-vertical-handle"
        id="panelVerticalHandleBottom"
        data-tip="Drag to resize height"
        ref={vBottomHandleRef}
      />

      {/* ── 5) obs 통계카드 3종 — 레거시 #panelTools(panel-body > obs-panel). payload 는 use-obs-cards SoT. ── */}
      <div className="panel-section tool-stats-section" id="panelTools" ref={vToolsRef}>
        <div className="panel-body">
          <div className="obs-panel" id="obsPanel">
            <BurnRateCard payload={obs.burnRate} t={tr} />
            <CacheHealthCard payload={obs.cacheHealth} t={tr} />
            <LivePulseCard payload={obs.livePulse} t={tr} />
          </div>
        </div>
      </div>

      {/* ── 6) footer — update-badge(available 클릭 시 store.openModal → AppShell 모달). 레거시 .left-panel-footer.
          browse·metadocs 공통 출처(SidebarVersionFooter)로 위치/스타일/로케일 정합(update-badge-position/i18n 회귀 해소).
          모달(UpdateModal)은 AppShell 이 단일 소유(버그 #6) — 사이드바는 트리거 배지만 렌더한다. ── */}
      <SidebarVersionFooter />
    </aside>
  );
}
