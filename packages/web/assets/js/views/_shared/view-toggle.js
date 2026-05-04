// views/_shared/view-toggle.js — 좌(default) ↔ 우(detail) 패널 토글 (F축)
//
// default-view 와 detail-view 가 동시에 의존하는 공통 토글. 두 뷰 모두
// 자기 자신의 active 클래스를 직접 만지지 않고 이 함수만 호출한다.

import { getRightView } from '../../state.js';

export function renderRightPanel() {
  const isDetail = getRightView() === 'detail';
  document.getElementById('defaultView').classList.toggle('active', !isDetail);
  document.getElementById('detailView').classList.toggle('active', isDetail);
}
