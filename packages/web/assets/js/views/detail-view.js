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
import { bloatedSysBadgeFullHtml, contextSaturationBadgeFullHtml } from '../render/badges.js';
import { setBloatedSysFor } from '../state/anomaly-cache.js';

let _abortController = null;

// 세션 단위 anomaly 캐시는 별도 모듈(state/anomaly-cache.js)로 분리되어
// render/rows.js·context-chart.js 등이 순환 의존성 없이 참조할 수 있다.

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
  //   서버 응답이 아직 없거나 stage='normal'이면 빈 문자열 → DOM에서 자연 미노출.
  //   hover 시 context-chart baseline 동기화 — `ctx-baseline-glow` 커스텀 이벤트 디스패치.
  // /api/sessions 목록 응답에는 anomalies가 없으므로(서버 SSoT는 단건 /api/sessions/:id),
  //   단건 API를 비동기로 fetch해 헤더 뱃지를 보강한다 — 부수효과 분리.
  applyBloatedSysHeader(session?.bloated_sys);
  // context-saturation·turn_count는 목록 응답에 없으므로 단건 fetch 도착 전까지 빈 상태.
  applyContextSaturationHeader(null, null);
  // 세션 전환 시 차트·사이드바·헤더의 이전 bloated_sys 잔재 제거 — 단건 fetch 응답 도착 전까지 빈 상태.
  document.dispatchEvent(new CustomEvent('session-anomalies-loaded', {
    detail: { sessionId: id, bloatedSys: null, contextSaturation: null, turnCount: null },
  }));
  (async () => {
    try {
      const res = await fetch(`/api/sessions/${encodeURIComponent(id)}`, { signal });
      if (!res.ok) return;
      const json = await res.json();
      const bs = json?.data?.anomalies?.bloated_sys ?? json?.data?.bloated_sys ?? null;
      const ctxSat = json?.data?.anomalies?.context_saturation ?? null;
      const turnCount = Number.isFinite(json?.data?.turn_count) ? json.data.turn_count : null;
      if (signal.aborted) return;
      // SSoT 캐시에 저장 → 사이드바·차트·헤더가 동일 데이터 참조.
      setBloatedSysFor(id, bs);
      applyBloatedSysHeader(bs);
      // context-saturation 헤더 뱃지 — bloated-sys와 같은 detailBadges 영역.
      applyContextSaturationHeader(ctxSat, turnCount);
      // 사이드바·context-chart 동기 — 동일 응답을 받아 자기 영역만 갱신한다.
      document.dispatchEvent(new CustomEvent('session-anomalies-loaded', {
        detail: { sessionId: id, bloatedSys: bs, contextSaturation: ctxSat, turnCount },
      }));
    } catch (e) {
      if (e?.name === 'AbortError') return;
    }
  })();

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
/**
 * 세션 헤더 detail-agg-badges 영역에 context-saturation full 뱃지를 부착한다.
 *
 *  - SSoT: 서버 응답 `anomalies.context_saturation` 객체. stage가 warn/critical 일 때만 노출.
 *  - 동시에 turnCount(>=20)면 가벼운 가이드 힌트 뱃지(title 한 줄)를 함께 부착.
 *    Lost-in-middle 가이드: 한도 사용률(stage)이 진짜 트리거이고, turn count는 보조 신호.
 *
 * @param {{ stage, context_tokens, window_max, pct, threshold_warn, threshold_critical } | null} ctxSat
 * @param {number | null} turnCount
 */
export function applyContextSaturationHeader(ctxSat, turnCount) {
  const host = document.getElementById('detailBadges');
  if (!host) return;
  // 기존 잔재 제거 — 세션 전환 시 이전 값 박힌 채로 남지 않도록.
  host.querySelectorAll('.badge-context-saturation--full, .badge-turn-count--hint').forEach((el) => el.remove());

  const html = contextSaturationBadgeFullHtml(ctxSat);
  if (html) {
    host.insertAdjacentHTML('beforeend', html);
    host.classList.remove('detail-agg-badges--hidden');
  }

  // turn count 가이드 힌트 — 20턴 이상이면 가벼운 ⟲ 표지(stage 없이 톤 정보만).
  if (Number.isFinite(turnCount) && turnCount >= 20) {
    const tip = `세션 ${turnCount}턴 누적 — /clear 또는 새 세션 권장`;
    host.insertAdjacentHTML(
      'beforeend',
      `<span class="badge-turn-count--hint ds-badge" data-tone="muted"
         data-turn-count="${turnCount}"
         title="${tip}" aria-label="${tip}">⟲ ${turnCount}t</span>`,
    );
    host.classList.remove('detail-agg-badges--hidden');
  }
}

export function applyBloatedSysHeader(bloatedSys) {
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
