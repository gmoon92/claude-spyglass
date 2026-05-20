/**
 * session-detail/flat-view.js — 필터 처리 + 이벤트 발행/구독.
 *
 * 책임:
 *  - applyDetailFilter   : 현재 필터/검색어 기준으로 1차 데이터를 필터링·집계한 뒤
 *                          DETAIL_FILTER_CHANGED 이벤트로 결과를 발행한다.
 *  - 이벤트 리스너       : 통합 "로그" 탭 (turn-spine + flow-head + log-pane) 과
 *                          차트 패널을 함께 갱신한다.
 *
 * 이벤트 디커플링 사유:
 *  - 차트(donut/cache panel)를 직접 import 하지 않고 CustomEvent로 분리해
 *    "데이터 처리"와 "여러 패널 렌더"의 책임을 나눔.
 *
 * ADR-turn-view-revamp-004 (turn-view-tab fix):
 *  - 레거시 평면 요청 표(#detailRequestsView) 제거 — renderDetailRequests 함수 삭제.
 *  - 필터 chip 카운트는 "활성 턴 기준" 으로 재계산 (사용자 선택: 활성 턴 좁힘).
 *    활성 턴 미지정 시(초기 진입) 전체 세션 기준으로 카운트.
 *
 * 호출자: index.js (facade), turn-views (간접 — 자체 호출 없음)
 * 의존성:
 *  - state         : 모든 상태 getter/setter
 *  - turn-views    : renderTurnCards (이벤트 리스너 안에서 호출), getActiveTurnId
 *  - 외부 모듈     : request-types, anomaly, chart, cache-panel, events
 */

import { subTypeOf, SUB_TYPES } from '../request-types.js';
// anomaly-bloated-sys ADR-003: 클라이언트 계산 폐기.
//  서버가 응답 행에 `bloated_sys`/`agent_spike` 필드를 채워 보낸다.
//  packages/web/assets/js/anomaly.js 는 표시 매핑 헬퍼만 유지.
import { getAnomalyFlagsForRow } from '../anomaly.js';
import { setSourceData, drawDonut, renderTypeLegend } from '../chart.js';
import { renderCachePanel, computeSessionCacheStats } from '../cache-panel.js';
import { DETAIL_FILTER_CHANGED } from '../events.js';
import {
  getDetailFilter, getDetailRequests, getDetailTurns, getSearchQuery,
  setFlatFiltered, setFlatAnomalyMap, setTurnFiltered, setTurnAnomalyMap,
  getSystemHashCount,
} from './state.js';
import { renderTurnCards, applyTurnCardSearch, getActiveTurnId } from './turn-views.js';

/**
 * 현재 detailFilter 기준으로 요청/턴 1차 데이터를 필터링하고 집계해 state에 저장한 뒤
 * DETAIL_FILTER_CHANGED 이벤트로 결과를 발행한다.
 * 리스너는 통합 "로그" 뷰(turn-spine + log-pane) / 차트 패널을 모두 갱신한다.
 *
 * 필터 chip 카운트 — ADR-turn-view-revamp-004 (turn-view-tab fix):
 *   활성 턴(getActiveTurnId)이 있으면 그 턴에 속한 요청만으로 카운트를 집계한다.
 *   초기 진입(활성 턴 미정)이거나 활성 턴에 속한 요청이 0건이면 세션 전체 기준으로
 *   폴백한다 — chip이 의미를 잃는 빈 상태(All (0))를 회피.
 */
export function applyDetailFilter() {
  const filter   = getDetailFilter();
  const requests = getDetailRequests();
  const turns    = getDetailTurns();

  // 카운트 집계 + 라벨 갱신 — "활성 턴 좁힘" 정책.
  //   getActiveTurnId() 가 null/매칭 0건이면 requests 전체로 폴백.
  // v22 (ADR-004 옵션 D, T-11): system 카운트는 hook의 requests.type='system'(항상 0) 대신
  //   proxy_requests의 distinct system_hash 수(= /api/system-prompts 카탈로그 크기)를 사용.
  //   hash가 새로 등장한 첫 요청 = 신규 페르소나 등장 시점이라는 의미 부여.
  const activeTurnId = getActiveTurnId?.() || null;
  const activeScope = activeTurnId ? requests.filter(r => r.turn_id === activeTurnId) : [];
  const countSource = activeScope.length ? activeScope : requests;
  const countMap = { all: countSource.length, prompt: 0, tool_call: 0, system: getSystemHashCount(), agent: 0, skill: 0, mcp: 0 };
  countSource.forEach(r => {
    if (r.type in countMap && r.type !== 'system') countMap[r.type]++;
    const sub = subTypeOf(r);
    if (sub) countMap[sub]++;
  });
  const labelMap = {
    all:      `All (${countMap.all})`,
    prompt:   `prompt (${countMap.prompt})`,
    tool_call:`tool_call (${countMap.tool_call})`,
    system:   `system (${countMap.system})`,
    agent:    `Agent (${countMap.agent})`,
    skill:    `Skill (${countMap.skill})`,
    mcp:      `MCP (${countMap.mcp})`,
  };
  document.querySelectorAll('#detailTypeFilterBtns .type-filter-btn').forEach(b => {
    if (labelMap[b.dataset.detailFilter]) b.textContent = labelMap[b.dataset.detailFilter];
  });

  // 평면 / 턴 필터링 결과
  const flatFiltered = filter === 'all' ? requests
    : SUB_TYPES.includes(filter)         ? requests.filter(r => subTypeOf(r) === filter)
    : requests.filter(r => r.type === filter);
  // anomaly-bloated-sys ADR-003: 서버가 채운 필드를 row.id → Set 로 단순 매핑.
  //  - 클라이언트 계산 0건.
  //  - 향후 spike/loop/slow 가 응답 필드로 추가되면 getAnomalyFlagsForRow 가 자동 흡수.
  const flatAnomalyMap = new Map();
  for (const r of requests) {
    const flags = getAnomalyFlagsForRow(r);
    if (flags.size > 0) flatAnomalyMap.set(r.id, flags);
  }

  const turnFiltered = filter === 'all'           ? turns
    : filter === 'tool_call'                       ? turns.filter(t => t.tool_calls.length > 0)
    : filter === 'prompt'                          ? turns.filter(t => !!t.prompt)
    : SUB_TYPES.includes(filter)                   ? turns.filter(t => t.tool_calls.length > 0)
    : [];

  // 턴 단위 anomaly 집계 (turn_id로 묶어서 OR)
  const reqById = new Map(requests.map(r => [r.id, r]));
  const turnAnomalyMap = new Map();
  for (const [reqId, flags] of flatAnomalyMap) {
    const req = reqById.get(reqId);
    if (req?.turn_id) {
      const existing = turnAnomalyMap.get(req.turn_id) || new Set();
      for (const f of flags) existing.add(f);
      turnAnomalyMap.set(req.turn_id, existing);
    }
  }

  // 결과를 state에 보관 (다른 모듈도 참조 가능)
  setFlatFiltered(flatFiltered);
  setFlatAnomalyMap(flatAnomalyMap);
  setTurnFiltered(turnFiltered);
  setTurnAnomalyMap(turnAnomalyMap);

  // CustomEvent로 결과 발행 — 차트 등이 import 없이 데이터에 접근
  document.dispatchEvent(new CustomEvent(DETAIL_FILTER_CHANGED, {
    detail: {
      flatFiltered,
      flatAnomalyMap,
      turnFiltered,
      allTurns:        turns,
      turnAnomalyMap,
      allRequests:     requests,
    },
  }));
}

/**
 * DETAIL_FILTER_CHANGED 자체 구독 — 통합 "로그" 뷰 + 차트/캐시 패널 + 검색어 행 토글.
 * 모듈 import 시 1회 등록되어 세션 라이프사이클 동안 유지된다.
 *
 * ADR-turn-view-revamp-004 (turn-view-tab fix): 레거시 평면 표(#detailRequestsView)
 * 렌더링 호출 제거. 단일 SSoT는 turn-views.js#renderTurnCards (turn-spine + log-pane).
 */
document.addEventListener(DETAIL_FILTER_CHANGED, (e) => {
  const { turnFiltered, allTurns, allRequests } = e.detail;

  // anomaly-bloated-sys T-16: turn 카드 sparkline은 requests 응답의 agent_spike 객체에 의존.
  //   turns 응답엔 agent_spike 메타데이터가 없어 turn-views는 allRequests를 한 번 더 받는다.
  //   클라이언트 재계산이 아니라 서버 SSoT(agent_spike)의 다른 경로 노출 — ADR-003 준수.
  renderTurnCards(turnFiltered, allTurns, allRequests);

  // chartSection이 detail 모드일 때 donut/cache panel 갱신 (ADR-017, ADR-WDO-010)
  //
  // 캐시 도넛 SSoT 정책 — 도넛/패널/서버 hit rate가 어긋나지 않도록 한 곳에서 집계.
  //   - 집계 함수: cache-panel.js#computeSessionCacheStats (type='prompt' 한정)
  //   - 도넛 분모: Cached + Uncached (= cache_read + tokens_input). cache_creation은
  //     "캐시 등록"이라 히트도 미스도 아니므로 분모에서 제외 — 서버
  //     storage/queries/request/aggregate-cache.ts#getCacheStats와 동일 공식.
  //   - Cache Write(=cache_creation)는 cache-panel.js의 Creation/Read 비율 바에서
  //     별도 노출되므로 도넛 슬라이스에서는 생략한다(중복·의미 혼선 방지).
  //
  // 이전 구현은 reduce를 다시 돌려 모든 type을 합산했고 cache_creation까지 hitRate
  // 분모에 넣어 도구 호출 cache_read까지 부풀어진 비율을 보여줬다 — flat-view와
  // cache-panel/서버의 % 가 동시에 어긋나는 원인이었다.
  const chartSection = document.getElementById('chartSection');
  if (chartSection?.classList.contains('chart-mode-detail')) {
    const sessionCache = computeSessionCacheStats(allRequests);
    // cache-donut-2slice pass: 슬라이스 = '캐시'(creation) / '그 외'(read + input).
    //   - 분모 = read + creation + input (전체 토큰 비용).
    //   - 슬라이스 합 = 분모. 도넛 시각 비율과 범례 %는 보색 관계(예: 2% + 98% = 100%)로
    //     일치시켜 "2 + 100 = 102" 같은 산술 혼선 제거.
    //   - 도넛 가운데 '캐시 적용 비율' = creation/분모 — 분자 값은 _cacheCreation 메타로
    //     chart.js drawDonut에 전달(슬라이스 합 = 분모이므로 별도 분모 메타 불필요).
    //   - 전체 토큰(분모) 절대값은 도넛 아래 #typeTotal '…건' 라인이 이미 노출.
    const cacheDenom = sessionCache.cacheReadTokens
                     + sessionCache.cacheCreationTokens
                     + sessionCache.totalInputTokens;
    const cacheCreation = sessionCache.cacheCreationTokens;
    const cacheData = [
      {
        id: 'cache',                             // 안정 id — chart.js 색상·라벨 lookup 키
        label: window.I18n.t('ui.chart.label.cache'),
        tokens: cacheCreation,                  // 도넛 슬라이스 = 분자
        _cacheCreation: cacheCreation,          // 가운데 % 계산용 (denom = 슬라이스 합)
      },
      {
        id: 'others',
        label: window.I18n.t('ui.chart.label.others'),
        tokens: Math.max(0, cacheDenom - cacheCreation), // 도넛 슬라이스 = 분모 - 분자
      },
    ].filter(d => d.tokens > 0);
    setSourceData('cache', cacheData);
    drawDonut();
    renderTypeLegend();
    renderCachePanel(sessionCache);
  }

  // 통합 "로그" 뷰 검색어 적용 — turn-views.js#applyTurnCardSearch 가 SSoT.
  //   turn-spine 마커 가시성 + log-pane 행 가시성을 한 번에 처리한다.
  //   (ADR-turn-view-revamp-004: 레거시 #detailRequestsBody 행 토글 폐기)
  const query = (getSearchQuery() || '').toLowerCase();
  applyTurnCardSearch(query);
});
