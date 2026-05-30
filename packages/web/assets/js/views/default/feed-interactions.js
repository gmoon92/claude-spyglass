// views/default/feed-interactions.js — 피드 검색·클릭 위임·필터 바 (C축)
//
// 변경 이유: 사용자 인풋 → 피드 표시 상태 매핑. 라이브 데이터 도착(B축)이나
// 영속 상태(E축)와 분리.  bootstrap.js 가 클로저(검색 박스 핸들 등)를 보유하고
// 여기 팩토리에 콜백/getter 로 주입한다.

import { renderRequests, appendRequests, togglePromptExpand, resolveExpandTarget } from '../../renderers.js';
import { asEl } from '../../dom.js';
import { fetchRequests, setReqFilter, getReqFilter } from '../../api.js';
import { SUB_TYPES } from '../../request-types.js';
import { createFilterBar } from '../../components/filter-bar.js';
import { setFeedFilterBar, getSelectedProject, setSelectedProject } from '../../state.js';
import { renderBrowserProjects } from '../../left-panel.js';
import { FEED_UPDATED } from '../../events.js';
import { STORAGE_KEY } from './constants.js';

/**
 * 피드 검색 + 타입 필터 결합 적용.
 *
 * `getSearchValue()` 는 bootstrap 의 검색 박스 클로저를 읽는 getter — 박스가
 * 아직 만들어지기 전(필터 바 onChange 가 첫 호출되는 시점)에도 안전.
 *
 * 검색 SSoT: 행에 박힌 `data-search-haystack` 속성(rows.js의 buildSearchHaystack).
 *   model / tool / Skill / Agent / MCP / role / payload 본문(8KB 상한)을 모두 포함하므로
 *   추가 textContent 수집 없이 substring 매칭만으로 일관 검색이 가능.
 */
export function applyFeedSearch(getSearchValue) {
  const q = (getSearchValue?.() ?? '').toLowerCase();
  const rows = document.querySelectorAll('#requestsBody tr[data-type]');
  const typeFilter = getReqFilter();
  rows.forEach(node => {
    const tr = asEl(node);
    const typeFiltered = typeFilter !== 'all' && (
      SUB_TYPES.includes(typeFilter)
        ? tr.dataset.subType !== typeFilter
        : tr.dataset.type !== typeFilter
    );
    if (!q) { tr.style.display = typeFiltered ? 'none' : ''; return; }
    const haystack = tr.dataset.searchHaystack || '';
    tr.style.display = (!haystack.includes(q) || typeFiltered) ? 'none' : '';
  });
}

/**
 * 타입 필터 바 생성. SUB_TYPES 클릭 시 fetch 없이 클라이언트 필터만 재적용,
 * 그 외 메인 타입 클릭 시 서버 재요청.
 */
export function createFeedFilterBar({ getSearchValue }) {
  const feedFilterBar = createFilterBar('typeFilterBtns', {
    dataAttr: 'filter',
    onChange(filter) {
      setReqFilter(filter);
      if (SUB_TYPES.includes(filter)) {
        applyFeedSearch(getSearchValue);
      } else {
        fetchRequests(false);
      }
    },
  });
  setFeedFilterBar(feedFilterBar);
  return feedFilterBar;
}

/**
 * FEED_UPDATED 이벤트 핸들러 — 풀 리스트 렌더 + 검색 재적용.
 *
 * 단일 prepend 케이스(detail 없음)는 feed-live.js 에서 직접 dispatch 하고
 * 여기서는 list 가 들어왔을 때만 컨테이너 갱신을 한다.
 */
export function handleFeedUpdated(e, getSearchValue) {
  const detail = e.detail;
  if (detail && detail.list !== undefined) {
    const container = document.getElementById('requestsBody');
    if (detail.append) {
      appendRequests(container, detail.list, detail.anomalyMap);
    } else {
      renderRequests(container, detail.list, detail.anomalyMap);
    }
  }
  applyFeedSearch(getSearchValue);
}

/**
 * #defaultView 의 클릭 위임 — 세션 점프 + prompt expand toggle.
 */
export function wireDefaultViewClicks({ onSelectSession }) {
  document.getElementById('defaultView').addEventListener('click', e => {
    const sessEl = asEl(asEl(e.target).closest('[data-goto-session]'));
    if (sessEl && sessEl.dataset.gotoSession) {
      const proj = sessEl.dataset.gotoProject;
      if (proj && proj !== getSelectedProject()) {
        localStorage.setItem(STORAGE_KEY, proj);
        setSelectedProject(proj);
        renderBrowserProjects();
      }
      onSelectSession(sessEl.dataset.gotoSession);
      return;
    }
    const promptEl = asEl(resolveExpandTarget(asEl(e.target)));
    if (promptEl) {
      const tr = promptEl.closest('tr');
      if (tr) togglePromptExpand(promptEl.dataset.expandId, asEl(tr));
    }
  });
}

// FEED_UPDATED 이벤트 이름은 외부 모듈에서도 자주 import 하므로 re-export 하지
// 않는다 — 직접 ../../events.js 에서 가져가면 된다.
export { FEED_UPDATED };
