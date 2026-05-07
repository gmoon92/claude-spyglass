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
  const llmViewEl    = document.getElementById('detailLlmInputView');
  const sysLibViewEl = document.getElementById('detailSysLibView');
  const toolsViewEl  = document.getElementById('detailToolsView');
  if (llmViewEl)    llmViewEl.style.display    = 'none';
  if (sysLibViewEl) sysLibViewEl.style.display = 'none';
  if (toolsViewEl)  toolsViewEl.style.display  = 'none';

  const session = getAllSessions().find(s => s.id === id);
  const detailIdEl = document.getElementById('detailSessionId');
  detailIdEl.textContent = id.slice(0, 8) + '…';
  detailIdEl.title = id;
  document.getElementById('detailProject').textContent = session ? session.project_name : '';
  document.getElementById('detailTokens').textContent = session ? `총 ${fmtToken(session.total_tokens)} 토큰` : '';
  document.getElementById('detailEndedAt').textContent = session?.ended_at ? `종료: ${fmtDate(session.ended_at)}` : '';

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
