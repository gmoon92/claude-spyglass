/**
 * session-detail/index.js — 세션 상세 뷰 모듈의 facade.
 *
 * 책임:
 *  - 데이터 로드(loadSessionDetail/refreshDetailSession)와 검색 박스(initDetailSearch).
 *  - 외부에서 사용하던 모든 export 인터페이스를 동일한 이름으로 re-export 하여
 *    호출자(main.js, default-view.js, detail-view.js 등) 변경을 0으로 유지한다.
 *
 * 호출자: main.js, views/default-view.js, views/detail-view.js
 * 의존성:
 *  - state, flat-view, turn-views : 분리된 내부 모듈
 *  - components/search-box        : 검색 박스 생성
 *  - context-chart, tool-stats    : 세션 전환 시 초기화 호출
 *
 * 부가 효과:
 *  - flat-view import 시 DETAIL_FILTER_CHANGED 리스너가 1회 등록된다 (모듈 부수효과).
 */

import { createSearchBox } from '../components/search-box.js';
import { clearContextChart } from '../context-chart.js';
import { clearToolStats } from '../tool-stats.js';
import {
  setCurrentSessionId, setDetailRequests, setDetailTurns,
  setSearchQuery, clearExpandedTurnIds, getSearchBox, setSearchBox,
  setSystemHashCount,
} from './state.js';
import { applyDetailFilter } from './flat-view.js';

// 외부 호환 — 동일 이름으로 re-export (호출자에 영향 없음)
export {
  getDetailFilter, setDetailFilter, getDetailRequests, getDetailTurns,
} from './state.js';
export { renderDetailRequests, applyDetailFilter } from './flat-view.js';
export {
  setDetailView, toggleTurn, toggleCardExpand, setTurnViewMode,
  renderTurnView, renderTurnCards,
} from './turn-views.js';

/** API base URL — 동일 출처 사용. */
export const API = '';

/**
 * detailSearchBox — createSearchBox로 만든 인스턴스 한 개를 모듈 수준에서 공유.
 * 외부(main.js)가 인스턴스를 직접 참조해 .clear() 등을 호출하므로 mutable export 유지.
 */
export let detailSearchBox = null;

/**
 * 진행 중 세션을 다시 fetch해 갱신한다 (SSE 업데이트 후 등).
 * 실패는 silent — 사용자 경험 차단 방지.
 */
export async function refreshDetailSession(sessionId) {
  if (!sessionId) return;
  try {
    const [reqRes, turnRes, sysRes] = await Promise.all([
      fetch(`${API}/api/sessions/${encodeURIComponent(sessionId)}/requests?limit=200`),
      fetch(`${API}/api/sessions/${encodeURIComponent(sessionId)}/turns`),
      // v22 (T-11): system_prompts 카탈로그 크기로 system 필터 라벨 표시
      fetch(`${API}/api/system-prompts?limit=500`),
    ]);
    const [reqJson, turnJson, sysJson] = await Promise.all([reqRes.json(), turnRes.json(), sysRes.json()]);
    setDetailRequests(reqJson.data  || []);
    setDetailTurns(turnJson.data || []);
    setSystemHashCount(Array.isArray(sysJson?.data) ? sysJson.data.length : 0);
    applyDetailFilter();
  } catch { /* silent */ }
}

/**
 * 세션 진입 시 호출. 차트/도구 통계/검색어/펼침 상태를 초기화하고 데이터를 fetch한다.
 * @param {string} sessionId
 * @param {{ signal?: AbortSignal }} opts — 사용자가 빠르게 다른 세션으로 전환할 때 abort용
 */
export async function loadSessionDetail(sessionId, opts = {}) {
  clearContextChart();
  clearToolStats();
  setCurrentSessionId(sessionId);
  setSearchQuery('');
  clearExpandedTurnIds(); // 세션 전환 시 accordion 펼침 상태 초기화
  getSearchBox()?.clear();
  const { signal } = opts;
  const fetchOpts = signal ? { signal } : {};
  const [reqRes, turnRes, sysRes] = await Promise.all([
    fetch(`${API}/api/sessions/${encodeURIComponent(sessionId)}/requests?limit=200`, fetchOpts),
    fetch(`${API}/api/sessions/${encodeURIComponent(sessionId)}/turns`, fetchOpts),
    // v22 (T-11): system_prompts 카탈로그 크기 — system 필터 라벨용
    fetch(`${API}/api/system-prompts?limit=500`, fetchOpts),
  ]);
  const [reqJson, turnJson, sysJson] = await Promise.all([reqRes.json(), turnRes.json(), sysRes.json()]);
  setDetailRequests(reqJson.data  || []);
  setDetailTurns(turnJson.data || []);
  setSystemHashCount(Array.isArray(sysJson?.data) ? sysJson.data.length : 0);
  applyDetailFilter();
}

/**
 * 검색 박스 초기화. 입력 변경 시 검색어를 state에 저장하고 필터 재적용.
 * 인스턴스를 mutable export(detailSearchBox)와 state 양쪽에 보관한다.
 */
export function initDetailSearch() {
  const box = createSearchBox('detailSearchContainer', {
    placeholder: 'tool / message',
    onSearch(q) {
      setSearchQuery(q);
      applyDetailFilter();
    },
  });
  detailSearchBox = box;
  setSearchBox(box);
}
