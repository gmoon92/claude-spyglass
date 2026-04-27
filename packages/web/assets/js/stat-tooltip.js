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
    title: 'Active Sessions',
    desc:  '현재 실시간으로 실행 중인 세션 수.\n최근 60초 내 요청이 있는 세션 기준.',
  },
  'avg-duration': {
    title: 'Avg Response Time',
    desc:  'prompt 타입 요청의 평균 응답시간.\nLLM 추론 + 네트워크 지연 포함.',
  },
  // ADR-015: 가격 정책 옵션 2 — cost / saved 카드 제거됨. 토큰 기반 지표만 남김.
  // 아래 정의는 하위 호환을 위해 유지하되, 텍스트는 토큰 기반으로 변경.
  cost: {
    title: 'API Tokens',
    desc:  'input + output + cache_create + cache_read 토큰 합산.\n가격 환산은 모델 단가에 따라 다르므로 화면에 표시하지 않습니다.',
  },
  saved: {
    title: 'Cache Saved Tokens',
    desc:  '프롬프트 캐시로 재사용되어 절약된 입력 토큰.\ncache_read 토큰만큼 LLM 재처리를 회피합니다.',
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

  function hide() {
    tooltip.style.display = 'none';
  }

  function showCtx(e, key) {
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
    if (ctxEl) { showCtx(e, ctxEl.dataset.ctxTooltip); return; }
    const badge = e.target.closest('[data-mini-badge-tooltip]');
    if (badge) { showBadge(e, badge.dataset.miniBadgeTooltip); return; }
    const card = e.target.closest('[data-stat-tooltip]');
    if (!card) return;
    show(e, card.dataset.statTooltip);
  });

  document.addEventListener('mousemove', e => {
    if (tooltip.style.display === 'none') return;
    if (!e.target.closest('[data-stat-tooltip]') && !e.target.closest('[data-ctx-tooltip]') && !e.target.closest('[data-mini-badge-tooltip]')) { hide(); return; }
    position(e);
  });

  document.addEventListener('mouseout', e => {
    if (!e.target.closest('[data-stat-tooltip]') && !e.target.closest('[data-ctx-tooltip]') && !e.target.closest('[data-mini-badge-tooltip]')) return;
    hide();
  });
}
