// views/detail-view.js — DetailView 세션 선택 + AbortController 캡슐화

import { getAllSessions, renderBrowserSessions } from '../left-panel.js';
import {
  getSelectedSession, setSelectedSession,
  setRightView, getDetailTab,
  getDetailFilterBar,
} from '../state.js';
import {
  setDetailFilter, applyDetailFilter, setDetailView, loadSessionDetail,
} from '../session-detail.js';
import { fmtToken, fmtDate } from '../formatters.js';
import { setChartMode, renderRightPanel } from './default-view.js';
import { skTurnCardList } from '../render/skeleton.js';

let _abortController = null;

export async function loadSession(id) {
  if (id === getSelectedSession()) return;

  _abortController?.abort();
  const controller = new AbortController();
  _abortController = controller;
  const { signal } = controller;

  setSelectedSession(id);
  renderBrowserSessions();
  setRightView('detail');
  // 세션 전환 시 마지막에 보던 탭을 유지한다(getDetailTab()는 모듈 수준 _detailTab을 그대로 반환).
  // setDetailView(getDetailTab())이 finally에서 새 세션의 데이터로 lazy 갱신해 준다.
  document.getElementById('detailView').classList.remove('detail-collapsed');
  setChartMode('detail');
  renderRightPanel();

  document.getElementById('detailLoading').style.display = 'block';
  // 로딩 중에는 모든 탭 뷰를 숨겨 이전 세션 데이터의 깜빡임을 방지한다.
  // 데이터 fetch 완료 후 setDetailView(getDetailTab())이 현재 탭만 다시 표시한다.
  document.getElementById('detailRequestsView').style.display = 'none';
  document.getElementById('detailTurnView').style.display = 'none';

  // skeleton-loading T-07: 이전 세션 turn 뷰의 잔여 콘텐츠를 skeleton 으로 리셋.
  // 탭 자체는 display:none 이지만 fetch 완료 후 setDetailView('turn')으로 노출되는
  // 짧은 순간 이전 데이터가 보이지 않도록 본문을 placeholder로 미리 채움.
  // turn-views.js 가 정상 렌더 시 innerHTML 교체로 자연 제거.
  const turnBody = document.getElementById('turnUnifiedBody');
  if (turnBody) turnBody.innerHTML = skTurnCardList(5);
  const llmViewEl    = document.getElementById('detailLlmInputView');
  const sysLibViewEl = document.getElementById('detailSysLibView');
  if (llmViewEl)    llmViewEl.style.display    = 'none';
  if (sysLibViewEl) sysLibViewEl.style.display = 'none';

  const session = getAllSessions().find(s => s.id === id);
  const detailIdEl = document.getElementById('detailSessionId');
  detailIdEl.textContent = id.slice(0, 8) + '…';
  detailIdEl.title = id;
  document.getElementById('detailProject').textContent = session ? session.project_name : '';
  document.getElementById('detailTokens').textContent = session ? window.I18n.t('ui.detail-view.total-tokens', { tokens: fmtToken(session.total_tokens) }) : '';
  document.getElementById('detailEndedAt').textContent = session?.ended_at ? window.I18n.t('ui.detail-view.ended-at', { time: fmtDate(session.ended_at) }) : '';

  setDetailFilter('all');
  getDetailFilterBar()?.setActive('all');

  try {
    await loadSessionDetail(id, { signal });
  } catch (e) {
    if (e.name === 'AbortError') return;
    applyDetailFilter();
  } finally {
    if (!signal.aborted) {
      document.getElementById('detailLoading').style.display = 'none';
      setDetailView(getDetailTab());
    }
    if (_abortController === controller) _abortController = null;
  }
}

export function abortCurrentSession() {
  _abortController?.abort();
  _abortController = null;
}
