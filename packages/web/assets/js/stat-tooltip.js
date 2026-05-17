// Command Center Strip 지표 hover 툴팁 — cache-tooltip.js 패턴 동일
const CTX_TOOLTIP_CONTENT = {
  'context-growth': {
    get title() { return window.I18n.t('ui.stat-tooltip.context-growth.title'); },
    get desc()  { return window.I18n.t('ui.stat-tooltip.context-growth.desc'); },
  },
};

const MINI_BADGE_TOOLTIP = {
  get spike() { return window.I18n.t('ui.stat-tooltip.badge.spike'); },
  get loop()  { return window.I18n.t('ui.stat-tooltip.badge.loop'); },
  get slow()  { return window.I18n.t('ui.stat-tooltip.badge.slow'); },
  get error() { return window.I18n.t('ui.stat-tooltip.badge.error'); },
  get cache() { return window.I18n.t('ui.stat-tooltip.badge.cache'); },
};

const STAT_TOOLTIP_CONTENT = {
  sessions: {
    get title() { return window.I18n.t('ui.stat-tooltip.sessions.title'); },
    get desc()  { return window.I18n.t('ui.stat-tooltip.sessions.desc'); },
  },
  requests: {
    get title() { return window.I18n.t('ui.stat-tooltip.requests.title'); },
    get desc()  { return window.I18n.t('ui.stat-tooltip.requests.desc'); },
  },
  tokens: {
    get title() { return window.I18n.t('ui.stat-tooltip.tokens.title'); },
    get desc()  { return window.I18n.t('ui.stat-tooltip.tokens.desc'); },
  },
  active: {
    get title() { return window.I18n.t('ui.stat-tooltip.active.title'); },
    get desc()  { return window.I18n.t('ui.stat-tooltip.active.desc'); },
  },
  'avg-duration': {
    get title() { return window.I18n.t('ui.stat-tooltip.avg-duration.title'); },
    get desc()  { return window.I18n.t('ui.stat-tooltip.avg-duration.desc'); },
  },
  p95: {
    get title() { return window.I18n.t('ui.stat-tooltip.p95.title'); },
    get desc()  { return window.I18n.t('ui.stat-tooltip.p95.desc'); },
  },
  err: {
    get title() { return window.I18n.t('ui.stat-tooltip.err.title'); },
    get desc()  { return window.I18n.t('ui.stat-tooltip.err.desc'); },
  },
};

export function initStatTooltip() {
  const tooltip = document.createElement('div');
  tooltip.className = 'stat-tooltip';
  tooltip.style.display = 'none';
  document.body.appendChild(tooltip);

  // ctx-point-hover 활성 시 일반 ctx-tooltip 표시 억제
  let _pointHoverActive = false;
  let _currentCtxKey    = null;

  function show(e, key) {
    const content = STAT_TOOLTIP_CONTENT[key];
    if (!content) return;
    tooltip.innerHTML = `
      <div class="stat-tooltip-title">${content.title}</div>
      <div class="stat-tooltip-desc">${content.desc.replace(/\n/g, '<br>')}</div>
    `;
    tooltip.style.display = 'block';
    position(e);
  }

  function position(e) {
    const tw = tooltip.offsetWidth  || 220;
    const th = tooltip.offsetHeight || 60;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    let x = e.clientX + 8;
    let y = e.clientY + 12;
    if (x + tw > vw) x = e.clientX - tw - 8;
    if (y + th > vh) y = e.clientY - th - 8;
    tooltip.style.left = `${x}px`;
    tooltip.style.top  = `${y}px`;
  }

  function positionAt(clientX, clientY) {
    const tw = tooltip.offsetWidth  || 220;
    const th = tooltip.offsetHeight || 60;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    let x = clientX + 12;
    let y = clientY - th - 10;
    if (x + tw > vw) x = clientX - tw - 12;
    if (y < 4)        y = clientY + 12;
    if (y + th > vh)  y = vh - th - 4;
    tooltip.style.left = `${x}px`;
    tooltip.style.top  = `${y}px`;
  }

  function hide() {
    tooltip.style.display = 'none';
  }

  function showCtx(e, key) {
    if (_pointHoverActive) return; // 포인트 호버 중에는 설명 툴팁 억제
    const content = CTX_TOOLTIP_CONTENT[key];
    if (!content) return;
    tooltip.innerHTML = `
      <div class="stat-tooltip-title">${content.title}</div>
      <div class="stat-tooltip-desc">${content.desc.replace(/\n/g, '<br>')}</div>
    `;
    tooltip.style.display = 'block';
    position(e);
  }

  function showBadge(e, key) {
    const desc = MINI_BADGE_TOOLTIP[key];
    if (!desc) return;
    tooltip.innerHTML = `<div class="stat-tooltip-desc">${desc}</div>`;
    tooltip.style.display = 'block';
    position(e);
  }

  document.addEventListener('mouseover', e => {
    const ctxEl = e.target.closest('[data-ctx-tooltip]');
    if (ctxEl) {
      _currentCtxKey = ctxEl.dataset.ctxTooltip;
      showCtx(e, _currentCtxKey);
      return;
    }
    const badge = e.target.closest('[data-mini-badge-tooltip]');
    if (badge) { showBadge(e, badge.dataset.miniBadgeTooltip); return; }
    const card = e.target.closest('[data-stat-tooltip]');
    if (!card) return;
    show(e, card.dataset.statTooltip);
  });

  document.addEventListener('mousemove', e => {
    if (tooltip.style.display === 'none') return;
    if (_pointHoverActive) { position(e); return; } // 포인트 호버 중엔 위치만 갱신
    if (!e.target.closest('[data-stat-tooltip]') && !e.target.closest('[data-ctx-tooltip]') && !e.target.closest('[data-mini-badge-tooltip]')) {
      _currentCtxKey = null;
      hide();
      return;
    }
    position(e);
  });

  document.addEventListener('mouseout', e => {
    if (!e.target.closest('[data-stat-tooltip]') && !e.target.closest('[data-ctx-tooltip]') && !e.target.closest('[data-mini-badge-tooltip]')) return;
    if (_pointHoverActive) return;
    hide();
  });

  // 차트 데이터 포인트 hover — 실제 수치 툴팁으로 전환
  document.addEventListener('ctx-point-hover', e => {
    const detail = e.detail;
    if (detail && detail.turnIndex !== undefined) {
      _pointHoverActive = true;
      // 누적 라인 — 모델 한도가 있으면 "X / Y tokens (Z%)" 풀 표기
      const accumulatedLine = detail.windowLabel
        ? window.I18n.t('ui.stat-tooltip.point-hover.accumulated-with-limit', {
            value:   detail.formattedValue,
            limit:   detail.windowLabel,
            percent: detail.usagePercent ?? '0.0',
          })
        : window.I18n.t('ui.stat-tooltip.point-hover.accumulated', { value: detail.formattedValue });
      const deltaLine = detail.formattedDelta
        ? `<br><span style="opacity:0.6">${window.I18n.t('ui.stat-tooltip.point-hover.delta', { delta: detail.formattedDelta })}</span>`
        : '';
      const modelLine = detail.windowModel
        ? `<br><span style="opacity:0.45">${window.I18n.t('ui.stat-tooltip.point-hover.model', { model: detail.windowModel })}</span>`
        : '';
      tooltip.innerHTML = `
        <div class="stat-tooltip-title">Turn ${detail.turnIndex}</div>
        <div class="stat-tooltip-desc">${accumulatedLine}${deltaLine}${modelLine}</div>
      `;
      tooltip.style.display = 'block';
      positionAt(detail.clientX, detail.clientY);
    } else {
      _pointHoverActive = false;
      // 차트 영역 위에 있을 경우 설명 툴팁으로 복원
      if (_currentCtxKey && tooltip.style.display !== 'none') {
        const content = CTX_TOOLTIP_CONTENT[_currentCtxKey];
        if (content) {
          tooltip.innerHTML = `
            <div class="stat-tooltip-title">${content.title}</div>
            <div class="stat-tooltip-desc">${content.desc.replace(/\n/g, '<br>')}</div>
          `;
        }
      }
    }
  });
}
