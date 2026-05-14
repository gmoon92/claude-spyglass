/**
 * session-detail/flat-view.js — 평면 요청 뷰(테이블) 렌더 + 필터 처리 + 이벤트 발행/구독.
 *
 * 책임:
 *  - renderDetailRequests: 요청 리스트(평면)를 detailRequestsBody에 그린다.
 *  - applyDetailFilter   : 현재 필터/검색어 기준으로 1차 데이터를 필터링·집계한 뒤
 *                          DETAIL_FILTER_CHANGED 이벤트로 결과를 발행한다.
 *  - 이벤트 리스너       : flat/turn 뷰 + 차트 패널을 함께 갱신한다.
 *
 * 이벤트 디커플링 사유:
 *  - 차트(donut/cache panel)를 직접 import 하지 않고 CustomEvent로 분리해
 *    "데이터 처리"와 "여러 패널 렌더"의 책임을 나눔.
 *
 * 호출자: index.js (facade), turn-views (간접 — 자체 호출 없음)
 * 의존성:
 *  - state         : 모든 상태 getter/setter
 *  - turn-views    : renderTurnCards (이벤트 리스너 안에서 호출)
 *  - 외부 모듈     : request-types, anomaly, formatters, renderers, chart, cache-panel, events
 */

import { subTypeOf, SUB_TYPES } from '../request-types.js';
import { fmtDate } from '../formatters.js';
import {
  makeRequestRow, typeBadge, FLAT_VIEW_COLS, togglePromptExpand, _promptCache,
} from '../renderers.js';
import { captureInteraction, restoreInteraction } from '../dom-preserve.js';
import { detectAnomalies } from '../anomaly.js';
import { setSourceData, drawDonut, renderTypeLegend } from '../chart.js';
import { renderCachePanel, computeSessionCacheStats } from '../cache-panel.js';
import { DETAIL_FILTER_CHANGED } from '../events.js';
import {
  getDetailFilter, getDetailRequests, getDetailTurns, getSearchQuery,
  setFlatFiltered, setFlatAnomalyMap, setTurnFiltered, setTurnAnomalyMap,
  getSystemHashCount,
} from './state.js';
import { renderTurnCards, applyTurnCardSearch } from './turn-views.js';

/**
 * 평면 요청 리스트(필터링된 결과)를 detailRequestsBody에 렌더한다.
 * 행 단위 anomaly 배지 적용(ADR-011).
 * SSE 갱신으로 다시 그릴 때 열린 프롬프트 확장 행은 캐시로 복원.
 *
 * ADR-007: scrollTop·expand row 보존을 dom-preserve.js 유틸로 통합.
 *   기존엔 본 함수에 inline으로 흩어져 있던 보존 로직을 captureInteraction/restoreInteraction으로 이전.
 */
export function renderDetailRequests(list, anomalyMap = new Map()) {
  const body     = document.getElementById('detailRequestsBody');
  const scrollEl = document.getElementById('detailRequestsView');

  // ADR-007: scrollTop + 펼침 상태 캡처
  const preserved = captureInteraction(scrollEl);
  // body는 별도 컨테이너이므로 expand row 캡처는 body 기준으로 보강
  const bodyExpanded = captureInteraction(body);

  if (!list.length) {
    body.innerHTML = `<tr><td colspan="${FLAT_VIEW_COLS}" class="state-empty-cell">데이터가 없습니다</td></tr>`;
    restoreInteraction(scrollEl, preserved);
    return;
  }
  const rows = list.map(r => makeRequestRow(r, {
    showSession: false,
    fmtTime: fmtDate,
    anomalyFlags: anomalyMap.get(r.id) || null,
  })).join('');
  const typeCounts = {};
  list.forEach(r => { typeCounts[r.type] = (typeCounts[r.type] || 0) + 1; });
  const subtotalParts = Object.entries(typeCounts)
    .sort((a, b) => b[1] - a[1])
    .map(([type, count]) => `${typeBadge(type)}&nbsp;${count}건`)
    .join('&ensp;');
  const subtotalRow = `<tr class="flat-subtotal"><td colspan="${FLAT_VIEW_COLS}" style="text-align:right">${subtotalParts}</td></tr>`;
  body.innerHTML = rows + subtotalRow;

  // ADR-007: scrollTop 자동 복원
  restoreInteraction(scrollEl, preserved);

  // expand row는 컨테이너 외부 함수(togglePromptExpand) 의존이라 호출자가 직접 복원
  for (const expandedId of bodyExpanded.expandedRequestIds) {
    if (!_promptCache.has(expandedId)) continue;
    const previewEl = body.querySelector(`[data-expand-id="${CSS.escape(expandedId)}"]`);
    const tr = previewEl?.closest('tr') ?? null;
    if (tr) togglePromptExpand(expandedId, tr, FLAT_VIEW_COLS);
  }
}

/**
 * 현재 detailFilter 기준으로 요청/턴 1차 데이터를 필터링하고 집계해 state에 저장한 뒤
 * DETAIL_FILTER_CHANGED 이벤트로 결과를 발행한다.
 * 리스너는 flat 뷰/turn 뷰/차트 패널을 모두 갱신한다.
 */
export function applyDetailFilter() {
  const filter   = getDetailFilter();
  const requests = getDetailRequests();
  const turns    = getDetailTurns();

  // 카운트 집계 + 라벨 갱신.
  // v22 (ADR-004 옵션 D, T-11): system 카운트는 hook의 requests.type='system'(항상 0) 대신
  // proxy_requests의 distinct system_hash 수(= /api/system-prompts 카탈로그 크기)를 사용.
  // hash가 새로 등장한 첫 요청 = 신규 페르소나 등장 시점이라는 의미 부여.
  const countMap = { all: requests.length, prompt: 0, tool_call: 0, system: getSystemHashCount(), agent: 0, skill: 0, mcp: 0 };
  requests.forEach(r => {
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
  const flatAnomalyMap = detectAnomalies(requests);

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
 * DETAIL_FILTER_CHANGED 자체 구독 — flat 뷰 + turn 카드 + 차트/캐시 패널 + 검색어 행 토글.
 * 모듈 import 시 1회 등록되어 세션 라이프사이클 동안 유지된다.
 */
document.addEventListener(DETAIL_FILTER_CHANGED, (e) => {
  const { flatFiltered, flatAnomalyMap, turnFiltered, allTurns, allRequests } = e.detail;

  renderDetailRequests(flatFiltered, flatAnomalyMap);
  renderTurnCards(turnFiltered, allTurns);

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
    // cache-donut-2slice pass: 슬라이스를 2개로 단순화 — '캐시'(cache_read + cache_creation)
    // vs '입력'(tokens_input). 도넛 가운데 '캐시 적용 비율' = cache_creation / 전체는 유지하되,
    // cache_creation 값은 캐시 슬라이스의 _cacheCreation 메타로 chart.js drawDonut에 전달.
    // 합 = 분모 = '전체 토큰 비용'.
    const cacheData = [
      {
        label: '캐시',
        tokens: sessionCache.cacheReadTokens + sessionCache.cacheCreationTokens,
        _cacheCreation: sessionCache.cacheCreationTokens, // 도넛 가운데 % 계산용 분자
      },
      { label: '전체', tokens: sessionCache.totalInputTokens },
    ].filter(d => d.tokens > 0);
    setSourceData('cache', cacheData);
    drawDonut();
    renderTypeLegend();
    renderCachePanel(sessionCache);
  }

  // 검색어로 평면 행 토글.
  // 검색 SSoT는 행 `data-search-haystack` 속성 (rows.js의 buildSearchHaystack).
  //   model / tool / Skill / Agent / MCP / role / payload 본문(8KB 상한)을 모두 포함하므로
  //   상세 검색에서도 로그 페이지와 동일한 범위로 substring 매칭.
  const query = (getSearchQuery() || '').toLowerCase();
  const detailRows = document.querySelectorAll('#detailRequestsBody tr[data-type]');
  detailRows.forEach(tr => {
    if (!query) { tr.style.display = ''; return; }
    const haystack = tr.dataset.searchHaystack || '';
    tr.style.display = haystack.includes(query) ? '' : 'none';
  });

  // 턴 카드 뷰에도 동일 검색어 적용(검색 확장 — search-expand-payload).
  applyTurnCardSearch(query);
});
