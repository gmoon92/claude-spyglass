// views/default/bootstrap.js — initDefaultView 컴포지션 루트 (G축)
//
// 변경 이유: DefaultView 가 부팅될 때 어떤 모듈을 어떤 순서로 조립할지를
// 결정. 클로저 상태(`feedSearchBox`)는 여기서만 보유하고, 다른 모듈은
// getter / 콜백으로만 접근한다. 단일 FEED_UPDATED 리스너를 등록해 피드
// 인터랙션 모듈에 위임 — 리스너가 두 군데에서 따로 붙어 순서가 꼬이는
// 사고를 막는다.

import { fetchRequests } from '../../api.js';
import { createSearchBox } from '../../components/search-box.js';
import { FEED_UPDATED } from '../../events.js';
import { observeTimelineResize } from './chart-policy.js';
import {
  applyFeedSearch, createFeedFilterBar, handleFeedUpdated, wireDefaultViewClicks,
} from './feed-interactions.js';
import { wireKeyboard } from './keyboard.js';

/**
 * @param {{
 *   onSelectSession: (id: string) => void,
 *   onCloseDetail: () => void,
 *   onGoHome: () => void,
 * }} opts
 */
export function initDefaultView({ onSelectSession, onCloseDetail, onGoHome }) {
  // 클로저 상태 — 검색 박스 핸들. 필터 바 onChange 가 박스 생성 전에 호출될
  // 수 있으므로 getter 로 감싸서 다른 모듈에 넘긴다.
  let feedSearchBox = null;
  const getFeedSearchBox  = () => feedSearchBox;
  const getSearchValue    = () => feedSearchBox?.getValue() ?? '';

  // C축: 필터 바 + 클릭 위임
  createFeedFilterBar({ getSearchValue });
  wireDefaultViewClicks({ onSelectSession });

  // Load more 버튼
  document.getElementById('loadMoreBtn').addEventListener('click', () => fetchRequests(true));

  // C축: 피드 검색 박스
  feedSearchBox = createSearchBox('feedSearchContainer', {
    placeholder: 'model / tool / message',
    onSearch: () => applyFeedSearch(getSearchValue),
  });

  // 단일 FEED_UPDATED 리스너 — 인터랙션 모듈에 위임
  document.addEventListener(FEED_UPDATED, (e) => handleFeedUpdated(e, getSearchValue));

  // D축: 키보드 단축키 + KBD 도움말 모달
  wireKeyboard({ getFeedSearchBox, onCloseDetail });

  // 로고 → 홈 (단일 hookup; D축 키보드와 별개라 여기 둔다)
  const logo = document.querySelector('.logo');
  if (logo) {
    logo.setAttribute('role', 'button');
    logo.setAttribute('tabindex', '0');
    logo.setAttribute('aria-label', '홈으로 이동');
    logo.style.cursor = 'pointer';
    logo.addEventListener('click', onGoHome);
    logo.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onGoHome(); }
    });
  }

  // A축: 차트 컨테이너 ResizeObserver
  observeTimelineResize();
}
