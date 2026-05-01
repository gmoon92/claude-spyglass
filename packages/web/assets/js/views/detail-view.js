// views/detail-view.js — DetailView 세션 선택 + AbortController 캡슐화

import { getAllSessions, renderBrowserSessions } from '../left-panel.js';
import {
  getSelectedSession, setSelectedSession,
  setRightView, getDetailTab, setDetailTab,
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
  setDetailTab('requests');
  document.getElementById('detailView').classList.remove('detail-collapsed');
  setChartMode('detail');
  renderRightPanel();

  document.getElementById('detailLoading').style.display = 'block';
  document.getElementById('detailRequestsView').style.display = 'none';
  document.getElementById('detailTurnView').style.display = 'none';

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
