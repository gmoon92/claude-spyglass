/**
 * features/session-detail/SessionDetailContainer.tsx — 세션 상세 데이터 배선 컨테이너 (P3-07)
 *
 * 책임(vanilla→React 마이그레이션의 누락된 "데이터 배선"):
 *  - turns fetch + 활성 턴 + 파생 메타(useSessionDetail) → DetailView 에 주입.
 *  - 단건 anomaly fetch(detail-view.ts#useSessionLoad) → 헤더 뱃지(bloatedSys/contextSaturation/turnCount).
 *  - 상세 탭바(로그/API 페이로드/System 라이브러리) — 원본 turn-views.js#initDetailTabBar/setDetailView
 *    (turn-views.js:529-585) 의 view-tab 3종 + 탭별 본문 스위치를 선언적으로 재현.
 *      · log    → DetailView(턴뷰)
 *      · llm    → LLMInput(API 페이로드)
 *      · syslib → SystemPromptLibrary(System 프롬프트 라이브러리)
 *    탭 상태는 app-store 의 detailTab(기본 'log', state.js:23) + setDetailTab(기존 action) 재사용.
 *
 * 비책임(후속 데이터흐름 역전 페이즈):
 *  - LLMInput payload(messages/system)·SystemPromptLibrary rows 의 fetch 오케스트레이션은 본 컨테이너
 *    소유 아님(architecture.md §1.3 features↛api). 레거시 .js 병존 — 본 배선은 turns(로그 탭)만 결선,
 *    보조 탭은 골격 마운트(빈 상태)로 두어 탭 전환 UX 만 복원한다.
 *
 * 셀렉터 계약: 탭바는 레거시 detail-view.css 클래스(.view-tab-bar/.view-tab-group/.view-tab/
 *   .view-tab-bar-controls, index.html:646-657) + design-system Tab(ds-tab) 을 재사용.
 *
 * @module features/session-detail/SessionDetailContainer
 * @see packages/web/assets/js/session-detail/turn-views.js#initDetailTabBar (원본 탭바, :529-547)
 * @see packages/web/assets/js/session-detail/turn-views.js#setDetailView (원본 탭 스위치, :569-585)
 * @see packages/web/assets/js/views/detail-view.js#loadSession (원본 세션 로드)
 */
import { Fragment, useCallback, type ReactElement } from 'react';
import { useAppStore } from '../../stores/app-store';
import { LLMInput } from '../llm-input/LLMInput';
import { SystemPromptLibrary } from '../dashboard/SystemPromptLibrary';
import { Tab } from '../../components/design-system/primitives/Tab';
import { DetailView } from './DetailView';
import { useSessionDetail } from './use-session-detail';
import { useSessionLoad, type SessionAnomalies } from './detail-view';

declare const window: { I18n: { t: (key: string, vars?: Record<string, unknown>) => string } };

/** 탭 정의 — 원본 initDetailTabBar TABS(turn-views.js:534-538) 1:1(value/i18n 키/title). */
interface TabDef {
  value: string;
  labelKey: string;
  titleKey?: string;
}
const TABS: TabDef[] = [
  { value: 'log', labelKey: 'session.session-detail.turn-views.tab-log' },
  {
    value: 'llm',
    labelKey: 'session.session-detail.turn-views.tab-llm',
    titleKey: 'session.session-detail.turn-views.tab-llm-title',
  },
  { value: 'syslib', labelKey: 'session.session-detail.turn-views.tab-syslib' },
];

export interface SessionDetailContainerProps {
  /** 선택 세션 id(falsy 면 빈 상태). */
  sessionId: string;
  /** 헤더 project 라벨. */
  projectName?: string | null;
  /** 헤더 total-tokens 라벨(세션 목록 메타). */
  totalTokens?: number | null;
  /** 헤더 ended-at 라벨. */
  endedAt?: string | number | null;
}

/**
 * 세션 상세 조립 컨테이너 — 탭바 + 탭별 본문(로그/LLM/SysLib).
 *  - turns 는 useSessionDetail 로 fetch·파생, anomaly 는 useSessionLoad 로 헤더 뱃지 보강.
 *  - 헤더 뱃지(bloatedSys/contextSaturation/turnCount)는 useSessionLoad onAnomalies 콜백으로 수신해
 *    로컬 store(detailAnomalies)에 보관 — 본 컨테이너는 store 수정 없이 기존 action 만 사용한다.
 */
export function SessionDetailContainer({
  sessionId,
  projectName = '',
  totalTokens = null,
  endedAt = null,
}: SessionDetailContainerProps): ReactElement {
  const detailTab = useAppStore((s) => s.detailTab);
  const setDetailTab = useAppStore((s) => s.setDetailTab);

  const {
    turns,
    prologue,
    activeTurnId,
    activeTurn,
    activeReminders,
    agentSpike,
    spikeSamples,
  } = useSessionDetail(sessionId);

  // 단건 anomaly fetch — 헤더 뱃지. detail-view.ts#useSessionLoad(AbortController) 재사용.
  //   콜백은 setBloatedSysFor 캐시 + session-anomalies-loaded 디스패치를 내부에서 수행하므로
  //   본 컨테이너는 store 수정 없이 캐시/이벤트 경로로 헤더 뱃지를 흐른다.
  const onAnomalies = useCallback((_a: SessionAnomalies) => {
    // detail-view.ts#useSessionLoad 가 setBloatedSysFor + CustomEvent 디스패치를 이미 수행.
    // 헤더 뱃지 추가 결선은 store(detailAnomalies) 소유로, 본 데이터 배선 범위 밖(no-op).
    void _a;
  }, []);
  useSessionLoad(sessionId, { onAnomalies });

  const renderBody = (): ReactElement => {
    if (detailTab === 'llm') {
      // API 페이로드 — payload fetch 오케스트레이션은 후속 페이즈(레거시 .js 병존). 골격 마운트.
      return (
        <div id="detailLlmInputView" className="detail-content">
          <LLMInput requestId="" messages={[]} />
        </div>
      );
    }
    if (detailTab === 'syslib') {
      // System 라이브러리 — rows fetch 는 후속 페이즈. 빈 상태(rows=null) 마운트.
      return (
        <div id="detailSysLibView" className="detail-content">
          <SystemPromptLibrary rows={null} />
        </div>
      );
    }
    // log(턴뷰) — 본 데이터 배선의 1급 결선.
    return (
      <DetailView
        sessionId={sessionId}
        projectName={projectName}
        totalTokens={totalTokens}
        endedAt={endedAt}
        turns={turns as never}
        activeTurnId={activeTurnId}
        activeTurn={activeTurn as never}
        prologue={prologue as never}
        activeReminders={activeReminders}
        agentSpike={agentSpike}
        spikeSamples={spikeSamples}
      />
    );
  };

  // ★빈 본문 회귀 수정★: BrowseLayout 이 이미 switcher 슬롯
  //   `<div id="detailView" className="right-view card active">` 를 소유한다(BrowseLayout:404).
  //   여기서 다시 `.right-view card #detailView` 로 감싸면 안쪽 .right-view 는 `.active` 가 없어
  //   default-view.css `.right-view { opacity:0; pointer-events:none; position:absolute }` 에 걸려
  //   탭바·로그 행이 DOM 엔 있으나 화면엔 안 보인다(레거시는 #detailView 가 단일 .right-view).
  //   따라서 본 컨테이너는 switcher 직계 자식(tab-bar + body)만 Fragment 로 렌더한다.
  return (
    <Fragment>
      <div className="view-tab-bar" id="detailTabBar">
        <div className="view-tab-group" id="viewTabGroup" role="tablist">
          {TABS.map(({ value, labelKey, titleKey }) => {
            const selected = detailTab === value;
            return (
              <Tab
                key={value}
                label={window.I18n.t(labelKey)}
                value={value}
                selected={selected}
                className={selected ? 'ds-tab view-tab active' : 'ds-tab view-tab'}
                title={titleKey ? window.I18n.t(titleKey) : undefined}
                onClick={() => setDetailTab(value)}
              />
            );
          })}
        </div>
        <div className="view-tab-bar-controls feed-controls">
          {/* 검색박스 슬롯(원본 #detailSearchContainer) — 결선은 후속(우선순위 낮음). */}
          <div id="detailSearchContainer" className="feed-search" />
        </div>
      </div>
      {renderBody()}
    </Fragment>
  );
}
