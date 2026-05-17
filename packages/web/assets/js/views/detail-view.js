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
import { bloatedSysBadgeFullHtml } from '../render/badges.js';

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

  // anomaly-bloated-sys T-12: 세션 헤더에 `▤ sys {pct}%` full 뱃지 부착.
  //   서버 응답이 아직 없거나 status='normal'이면 빈 문자열 → DOM에서 자연 미노출.
  //   hover 시 context-chart baseline 동기화 — `ctx-baseline-glow` 커스텀 이벤트 디스패치.
  applyBloatedSysHeader(session?.bloated_sys);

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

/**
 * 세션 헤더 detail-agg-badges 영역에 bloated-sys full 뱃지를 부착한다.
 *  - 응답 필드 부재(트랙 A 진행 중) → 헬퍼가 빈 문자열 반환, DOM 자연 미노출.
 *  - hover 시 context-chart baseline glow 동기화 (T-17 수신).
 *  - 마우스 이벤트 위임은 한 번만 등록되도록 dataset 플래그로 보호.
 *
 * @param {{ status, system_tokens, pct, threshold_warn, threshold_critical } | null} bloatedSys
 */
function applyBloatedSysHeader(bloatedSys) {
  const host = document.getElementById('detailBadges');
  if (!host) return;
  // 기존 bloated-sys 뱃지 제거 (세션 전환 시)
  const old = host.querySelector('.badge-bloated-sys--full');
  if (old) old.remove();
  const html = bloatedSysBadgeFullHtml(bloatedSys);
  if (!html) return;
  host.insertAdjacentHTML('beforeend', html);
  // hidden 상태였으면 노출 (다른 detail-agg-badges 로직과 호환 — badgesEl.classList 토글)
  host.classList.remove('detail-agg-badges--hidden');

  // hover → context-chart baseline 강조 (T-17이 수신).
  // 한 번만 위임 등록 (host에 이벤트 위임).
  if (!host.dataset.bloatedHoverWired) {
    host.dataset.bloatedHoverWired = '1';
    host.addEventListener('mouseenter', (e) => {
      const t = e.target?.closest?.('.badge-bloated-sys--full');
      if (!t) return;
      document.dispatchEvent(new CustomEvent('ctx-baseline-glow', { detail: { active: true } }));
    }, true);
    host.addEventListener('mouseleave', (e) => {
      const t = e.target?.closest?.('.badge-bloated-sys--full');
      if (!t) return;
      document.dispatchEvent(new CustomEvent('ctx-baseline-glow', { detail: { active: false } }));
    }, true);
  }
}
