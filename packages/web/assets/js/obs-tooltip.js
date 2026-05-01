/**
 * Observability Panel hover 툴팁
 *
 * left-panel-observability-revamp ADR-008 (후속):
 *   카드 라벨/패널 타이틀을 제거한 대신 KPI의 의미를 hover 툴팁으로 노출.
 *   기존 stat-tooltip / cache-panel-tooltip 의 디자인·동작 패턴을 그대로 차용
 *   (`.stat-tooltip` 클래스 재사용으로 시각 일관성 유지).
 *
 * 트리거: `data-obs-tooltip="<key>"` 속성. 카드 / Anomaly Badge / 카테고리 행에 부여.
 */

const OBS_TOOLTIP_CONTENT = {
  // ── 카드 4종 ──────────────────────────────────────────────────────────
  'burn-rate': {
    title: 'Burn Rate · 24시간',
    desc:
      '최근 24시간 동안 prompt 요청의 누적 토큰 합계.\n' +
      '· 큰 숫자: 24시간 누적 input+output 토큰\n' +
      '· ▲/▼ %  : 어제 동시각(24h 이전 같은 윈도우) 대비 변화율\n' +
      '· sparkline: 1시간 단위 토큰 사용량 24개 막대',
  },
  'cache-health': {
    title: 'Cache Health · 프롬프트 캐시',
    desc:
      '프롬프트 캐시의 현재 hit ratio와 24시간 추세.\n' +
      '· 큰 숫자: cache_read / (input + cache_read)\n' +
      '· 등급(●): ≥70% green / 30~69% blue / <30% amber\n' +
      '· 절감: 캐시 히트로 재사용된 input 토큰 누적',
  },
  'live-pulse': {
    title: 'Live Pulse · 실시간 활동',
    desc:
      '현재 세션 활동 상태.\n' +
      '· 큰 텍스트: 가장 최근 이벤트 발생 시각 (relative)\n' +
      '· ● n  : 활성 세션 수 (최근 60초 내 활동)\n' +
      '· sparkline: 5분창 도구 호출 수 (Phase 2)',
  },
  'tool-categories': {
    title: 'Tool Categories · 도구 분류',
    desc:
      '최근 24시간 도구 호출의 카테고리별 분포.\n' +
      '· Agent : 서브에이전트 호출 (Task)\n' +
      '· Skill : 스킬 실행\n' +
      '· MCP   : MCP 서버 도구 호출\n' +
      '· Native: 내장 도구 (Read/Write/Bash/Edit 등)',
  },

  // ── 카테고리 행별 ───────────────────────────────────────────────────
  'cat-Agent': {
    title: 'Agent',
    desc: 'Task 도구를 통한 서브에이전트 호출 비중.\n자식 도구 호출이 많을수록 깊이가 깊어집니다.',
  },
  'cat-Skill': {
    title: 'Skill',
    desc: '스킬(SKILL.md) 호출 비중.\n도메인 지식·워크플로우 캡슐화에 활용됩니다.',
  },
  'cat-MCP': {
    title: 'MCP',
    desc: 'MCP 서버를 통한 외부 도구 호출 비중.\n예: playwright, context7, sequential-thinking.',
  },
  'cat-Native': {
    title: 'Native',
    desc: 'Claude Code 내장 도구 비중.\nRead / Write / Edit / Bash / Grep / Glob 등.',
  },

  // ── Anomaly Badge ───────────────────────────────────────────────────
  anomaly: {
    title: 'Anomaly · 이상 감지',
    desc:
      '최근 24시간 내 비정상 패턴 발생 건수.\n' +
      '· 도구 실패율 ≥5% (30분 윈도우)\n' +
      '· 동일 도구 ≥3회 연속 실패\n' +
      '· 서브에이전트 깊이 ≥3 또는 팬아웃 ≥5\n' +
      '· turn 토큰 ≥ p95×2',
  },
};

export function initObsTooltip() {
  // stat-tooltip.js 와 동일한 .stat-tooltip 클래스를 재사용해 시각 일관성 유지
  const tooltip = document.createElement('div');
  tooltip.className = 'stat-tooltip';
  tooltip.style.display = 'none';
  document.body.appendChild(tooltip);

  function show(e, key) {
    const content = OBS_TOOLTIP_CONTENT[key];
    if (!content) return;
    tooltip.innerHTML = `
      <div class="stat-tooltip-title">${content.title}</div>
      <div class="stat-tooltip-desc">${content.desc.replace(/\n/g, '<br>')}</div>
    `;
    tooltip.style.display = 'block';
    position(e);
  }

  function position(e) {
    const tw = tooltip.offsetWidth  || 240;
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

  document.addEventListener('mouseover', e => {
    const el = e.target.closest('[data-obs-tooltip]');
    if (!el) return;
    show(e, el.dataset.obsTooltip);
  });

  document.addEventListener('mousemove', e => {
    if (tooltip.style.display === 'none') return;
    if (!e.target.closest('[data-obs-tooltip]')) { hide(); return; }
    position(e);
  });

  document.addEventListener('mouseout', e => {
    if (!e.target.closest('[data-obs-tooltip]')) return;
    hide();
  });
}
