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
 * 보조 탭 데이터 결선(레거시 동작 복원):
 *  - LLMInput payload(messages/system)·SystemPromptLibrary rows 는 colocated fetcher
 *    (detail-aux-fetcher.ts) + 오케스트레이션 훅(use-detail-aux.ts)으로 결선한다. 탭이 활성일
 *    때만 lazy fetch(원본 setDetailView('llm')/('syslib') 진입 시 showLatestLlmInput/
 *    loadSystemPromptLibrary 와 동치). 공유 api/fetchers.ts 는 수정 금지라 보조 탭 전용 fetcher 는
 *    features/session-detail 안에 colocate 한다.
 *  - 탭 본문 컨테이너는 원본 index.html:668/725/744 구조(#detailTurnView/#detailLlmInputView/
 *    #detailSysLibView + inner #llmInputBody.llm-input-body / #sysLibBody.syslib-body)를 복원한다
 *    — CSS 스크롤/레이아웃 SSoT 가 이 셀렉터에 걸려 있다.
 *
 * 셀렉터 계약: 탭바는 레거시 detail-view.css 클래스(.view-tab-bar/.view-tab-group/.view-tab/
 *   .view-tab-bar-controls, index.html:646-657) + design-system Tab(ds-tab) 을 재사용.
 *
 * @module features/session-detail/SessionDetailContainer
 * @see packages/web/assets/js/session-detail/turn-views.js#initDetailTabBar (원본 탭바, :529-547)
 * @see packages/web/assets/js/session-detail/turn-views.js#setDetailView (원본 탭 스위치, :569-585)
 * @see packages/web/assets/js/views/detail-view.js#loadSession (원본 세션 로드)
 */
import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type ReactElement, type RefObject } from 'react';
import { useTranslation } from 'react-i18next';
import { useAppStore } from '../../stores/app-store';
import { LLMInput } from '../llm-input/LLMInput';
import { SystemPromptLibrary } from '../dashboard/SystemPromptLibrary';
import { SystemPromptDetailModal } from '../dashboard/SystemPromptDetailModal';
import type { SysLibSortKey, SortDir, SysLibRow } from '../dashboard/syslib-sort';
import { Tab } from '../../components/design-system/primitives/Tab';
import { useColResize } from '../../components/use-col-resize';
import { DetailView } from './DetailView';
import { useSessionDetail } from './use-session-detail';
import type { TurnRow } from './turns-fetcher';
import { useSessionLoad, type SessionAnomalies } from './detail-view';
import { useLlmInput, useSystemPromptLibrary, useSysLibDetail } from './use-detail-aux';

/**
 * System 프롬프트 라이브러리 표 + 컬럼 리사이즈 결선(원본 system-prompt-library.js:107 initColResize 동치).
 *  - SystemPromptLibrary(dashboard 소유)는 tableRef 를 받지 않으므로 #sysLibBody 안의 `.syslib-table` 를
 *    셀렉터로 resolve 하는 RefObject 를 useColResize 에 전달한다(SystemPromptLibrary 마크업 .syslib-table 계약).
 *  - 표는 rows>0 일 때만 렌더되므로(빈 상태 분기), 본 래퍼는 rows 가 있을 때만 마운트해 핸들이 thead 에 붙게 한다.
 *    storageKey='syslib' 로 피드('feed')·metadocs('metadocs') 와 영속 분리.
 */
function SysLibPane({
  rows,
  sort,
  onSort,
  onOpenRow,
}: {
  rows: SysLibRow[] | null;
  sort: { key: SysLibSortKey; dir: SortDir };
  onSort: (key: SysLibSortKey) => void;
  /** 행 클릭 → 본문 상세 모달(원본 .syslib-row 클릭 → showDetailModal). */
  onOpenRow: (hash: string) => void;
}): ReactElement {
  const bodyRef = useRef<HTMLDivElement>(null);
  // useColResize 가 effect 안에서 1회 읽는 tableRef.current 를 #sysLibBody 내부 .syslib-table 로 lazy resolve.
  const tableRef = useMemo<RefObject<HTMLTableElement>>(
    () => ({
      get current(): HTMLTableElement | null {
        return bodyRef.current?.querySelector<HTMLTableElement>('.syslib-table') ?? null;
      },
    }),
    [],
  );
  const hasRows = !!rows && rows.length > 0;
  return (
    <div id="sysLibBody" className="syslib-body" role="region" aria-label="System prompt library" ref={bodyRef}>
      <SystemPromptLibrary rows={rows} sort={sort} onSort={onSort} onOpenRow={onOpenRow} />
      {hasRows ? <SysLibColResize key={`syslib-colresize-${String(hasRows)}`} tableRef={tableRef} /> : null}
    </div>
  );
}

/** useColResize(`[]` deps)를 표 존재 시점에 마운트하기 위한 얇은 결선기(MetaCatalogColResize 선례). */
function SysLibColResize({ tableRef }: { tableRef: RefObject<HTMLTableElement> }): null {
  useColResize(tableRef, { storageKey: 'syslib' });
  return null;
}

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
  /**
   * 로드된 turns 상향 보고(성능 — turns API 중복 fetch 제거).
   *   BrowseLayout 은 detail 모드 차트(ContextChart/cache 도넛)에 turns 가 필요하나, 본 컨테이너가
   *   이미 useSessionDetail 로 fetch 한다. 별도로 useSessionDetail 을 또 호출하면 같은 세션 turns 를
   *   2회 fetch 하게 되므로(주의 3), 본 컨테이너가 유일한 fetch 소유자로서 결과를 콜백으로 올려준다.
   *   미주입이면 무동작(직접 SSR 렌더 등 단독 사용 시 안전) — 옵셔널 계약.
   */
  onDetailData?: (data: { turns: TurnRow[]; loading: boolean }) => void;
}

/**
 * 세션 상세 조립 컨테이너 — 탭바 + 탭별 본문(로그/LLM/SysLib).
 *  - turns 는 useSessionDetail 로 fetch·파생, anomaly 는 useSessionLoad 로 헤더 뱃지 보강.
 *  - 헤더 뱃지(bloatedSys/contextSaturation/turnCount)는 useSessionLoad onAnomalies 콜백으로 수신해
 *    로컬 store(detailAnomalies)에 보관 — 본 컨테이너는 store 수정 없이 기존 action 만 사용한다.
 */
export function SessionDetailContainer({
  sessionId,
  totalTokens = null,
  onDetailData,
}: SessionDetailContainerProps): ReactElement {
  const { t } = useTranslation();
  const detailTab = useAppStore((s) => s.detailTab);
  const setDetailTab = useAppStore((s) => s.setDetailTab);

  const {
    turns,
    prologue,
    activeTurnId,
    setActiveTurnId,
    activeTurn,
    activeReminders,
    agentSpike,
    spikeSamples,
    loading,
  } = useSessionDetail(sessionId);

  // 로드된 turns 상향 보고 — BrowseLayout 차트가 동일 turns 를 재fetch 하지 않도록(중복 제거).
  //   turns/loading 변화 시에만 통지. onDetailData 는 호출처가 useCallback 으로 안정화(루프 방지).
  useEffect(() => {
    onDetailData?.({ turns, loading });
  }, [turns, loading, onDetailData]);

  // 보조 탭 데이터(원본 setDetailView lazy 로드 대응) — 탭 활성일 때만 fetch.
  const llm = useLlmInput(sessionId, detailTab === 'llm');
  const syslib = useSystemPromptLibrary(detailTab === 'syslib');
  // System 라이브러리 행 클릭 → 본문 상세 모달(원본 showDetailModal). hash 로 lazy-fetch.
  const sysDetail = useSysLibDetail();
  // System 라이브러리 정렬(컨트롤드) — 원본 system-prompt-library.js 헤더 클릭 정렬.
  const [sysSort, setSysSort] = useState<{ key: SysLibSortKey; dir: SortDir }>({
    key: 'last_seen_at',
    dir: 'desc',
  });
  const onSysSort = useCallback((key: SysLibSortKey) => {
    setSysSort((prev) =>
      prev.key === key ? { key, dir: prev.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'desc' },
    );
  }, []);

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
      // API 페이로드 — 원본 #detailLlmInputView.detail-content > #llmInputBody.llm-input-body 구조 복원.
      //   inner wrapper(llm-input-body)는 llm-input.css 스크롤/레이아웃 SSoT 라 반드시 유지한다.
      return (
        <div id="detailLlmInputView" className="detail-content">
          <div id="llmInputBody" className="llm-input-body" role="region" aria-label="API payload">
            <LLMInput
              requestId={llm.requestId}
              systemHash={llm.systemHash}
              systemSize={llm.systemSize}
              systemContent={llm.systemContent}
              systemMeta={llm.systemMeta}
              messages={llm.messages as never}
              decodeError={llm.decodeError}
              proxyList={llm.proxyList as never}
              onSelectProxy={llm.selectProxy}
            />
          </div>
        </div>
      );
    }
    if (detailTab === 'syslib') {
      // System 라이브러리 — 원본 #detailSysLibView.detail-content > #sysLibBody.syslib-body 구조 복원.
      return (
        <div id="detailSysLibView" className="detail-content">
          <SysLibPane
            rows={syslib.rows as never}
            sort={sysSort}
            onSort={onSysSort}
            onOpenRow={sysDetail.open}
          />
          {/* 본문 상세 모달 — hash 활성일 때만 렌더(원본 #sysLibDetailModal). */}
          <SystemPromptDetailModal
            hash={sysDetail.openHash}
            loading={sysDetail.loading}
            detail={sysDetail.detail}
            error={sysDetail.error}
            onClose={sysDetail.close}
          />
        </div>
      );
    }
    // log(턴뷰) — 본 데이터 배선의 1급 결선. 원본 #detailTurnView.detail-content 래퍼 복원
    //   (탭 본문 컨테이너 SSoT — detail-view.css `.detail-content{flex:1;overflow-y:auto}`).
    return (
      <div id="detailTurnView" className="detail-content">
        <DetailView
          sessionId={sessionId}
          totalTokens={totalTokens}
          turns={turns as never}
          activeTurnId={activeTurnId}
          activeTurn={activeTurn as never}
          prologue={prologue as never}
          activeReminders={activeReminders}
          agentSpike={agentSpike}
          spikeSamples={spikeSamples}
          onMarkerClick={setActiveTurnId}
        />
      </div>
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
                label={t(labelKey)}
                value={value}
                selected={selected}
                className={selected ? 'ds-tab view-tab active' : 'ds-tab view-tab'}
                title={titleKey ? t(titleKey) : undefined}
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
