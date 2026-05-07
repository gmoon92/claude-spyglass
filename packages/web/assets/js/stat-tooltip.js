// Command Center Strip 지표 hover 툴팁 — cache-tooltip.js 패턴 동일
const CTX_TOOLTIP_CONTENT = {
  'context-growth': {
    title: 'Accumulated Tokens',
    desc:  '세션 동안 누적된 input_tokens 흐름을 보여줍니다.\n• 200K는 참고 스케일로, Claude 모델별 실제 Context Window 한도와는 다를 수 있습니다.\n• 이 차트는 Claude 런타임의 실제 Context Window 사용률이 아닙니다.\n• 실제 한도 관리는 Claude가 자동으로 수행합니다.',
  },
};

const MINI_BADGE_TOOLTIP = {
  spike: '토큰이 세션 평균의 2배 초과',
  loop:  '동일 도구 연속 3회 이상 호출',
  slow:  '실행 시간 상위 5% 초과',
  error: '도구 실행 실패',
  cache: '프롬프트 캐시 히트',
};

const STAT_TOOLTIP_CONTENT = {
  sessions: {
    title: 'Total Sessions',
    desc:  '현재 필터 기간 내 생성된 Claude Code 세션 수.\n세션은 claude 명령 실행 시 시작됩니다.',
  },
  requests: {
    title: 'Total Requests',
    desc:  'prompt · tool_call · system 타입 요청의 총합.\n훅 이벤트 수신 기준.',
  },
  tokens: {
    title: 'Total Tokens',
    desc:  '입력 + 출력 토큰의 합산.\ncache_creation · cache_read 토큰 포함.',
  },
  active: {
    title: 'LIVE Sessions',
    desc:  '지금 실시간으로 실행 중인 세션 수.\nended_at NULL + 직전 30분 이내 활동 기준 (storage/_shared.LIVE_STALE_THRESHOLD_MS).\n도트 색: 녹색=SSE 연결됨, 빨강=끊김.',
  },
  'avg-duration': {
    title: 'Avg Response Time',
    desc:  'prompt 타입 요청의 평균 응답시간.\nLLM 추론 + 네트워크 지연 포함.',
  },
  p95: {
    title: 'P95 Response Time',
    desc:  'tool_call 응답시간의 95번째 백분위.\n상위 5% 느린 요청을 제외한 기준값.',
  },
  err: {
    title: 'Tool Error Rate',
    desc:  'tool_call 중 오류 응답 비율.\n5% 초과 시 빨간색 경고로 표시.',
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
      const deltaLine = detail.formattedDelta
        ? `<br><span style="opacity:0.6">전 턴 대비 ${detail.formattedDelta} tokens</span>`
        : '';
      tooltip.innerHTML = `
        <div class="stat-tooltip-title">Turn ${detail.turnIndex}</div>
        <div class="stat-tooltip-desc">누적 ${detail.formattedValue} tokens${deltaLine}</div>
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
