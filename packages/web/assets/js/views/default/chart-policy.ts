// views/default/chart-policy.js — 차트 모드/라벨 정책 (A축)
//
// 변경 이유: 차트(타임라인·도넛) 모드 전환 정책, timeline-meta 라벨 갱신,
// 차트 컨테이너 ResizeObserver 정책. DOM/캔버스 렌더 자체는 chart.js가
// 책임지고, 여기서는 "언제 어떤 모드를 적용/재그릴지"만 결정한다.

import { getActiveRange, getMetricRangeParams } from '../../api.js';
import {
  drawTimeline, drawDonut, setSourceData, setDonutMode, hasSourceData, renderTypeLegend,
} from '../../chart.js';
import { fetchModelUsage } from '../../metrics-api.js';
import {
  RANGE_LABELS, TIMELINE_META_PREFIXES, TIMELINE_META_ARIA_PREFIXES,
} from './constants.js';

/**
 * date-range-filter ADR-007: range 인자가 문자열(legacy) / ActiveRange 객체 모두 흡수.
 * 호출자 인터페이스 불변 — main.js의 setActiveRange 이벤트 핸들러도 label key 전달 가능.
 */
export function applyRangeLabels(rangeArg = getActiveRange()) {
  const key = typeof rangeArg === 'string'
    ? rangeArg
    : ((rangeArg && (rangeArg as any).type === 'custom') ? 'custom' : ((rangeArg as any)?.value ?? 'all'));
  const rangeText = (RANGE_LABELS as Record<string, string>)[key] || RANGE_LABELS.all;
  const groups = document.querySelectorAll('#timelineMeta .timeline-meta-group');
  groups.forEach((group, i) => {
    const label = group.querySelector('.timeline-meta-group-label');
    if (label) label.textContent = `${(TIMELINE_META_PREFIXES as Record<number, string>)[i]} · ${rangeText}`;
    group.setAttribute('aria-label', `${(TIMELINE_META_ARIA_PREFIXES as Record<number, string>)[i]} (${rangeText})`);
  });
}

// ── 차트 모드 ─────────────────────────────────────────────────────────────────
export async function setChartMode(mode: string) {
  const chartSection = document.getElementById('chartSection');
  const rightPanel  = document.querySelector('.right-panel');
  if (!chartSection) return;
  if (mode === 'detail') {
    chartSection.classList.add('chart-mode-detail');
    chartSection.querySelector('.chart-detail-meta')?.removeAttribute('hidden');
    chartSection.querySelectorAll('.chart-detail-only').forEach(el => el.removeAttribute('hidden'));
    rightPanel?.classList.add('is-detail-mode');
    setDonutMode('cache');
  } else {
    chartSection.classList.remove('chart-mode-detail');
    chartSection.querySelector('.chart-detail-meta')?.setAttribute('hidden', '');
    chartSection.querySelectorAll('.chart-detail-only').forEach(el => el.setAttribute('hidden', ''));
    rightPanel?.classList.remove('is-detail-mode');
    setDonutMode('model');
    if (!hasSourceData('model')) {
      try {
        // date-filter-propagation pass: 활성 range 반영 (24h 하드코딩 제거)
        const data = await fetchModelUsage(getMetricRangeParams());
        setSourceData('model', data || []);
      } catch { /* silent */ }
    }
    drawDonut();
    renderTypeLegend();
  }
}

// timeline 캔버스 컨테이너의 크기 변화에 반응해 다시 그린다.
// rAF로 디바운스 — ResizeObserver가 한 프레임에 여러 번 발화해도 1회만 redraw.
export function observeTimelineResize() {
  const timelineWrap = document.querySelector('#timelineChart')?.parentElement;
  if (!timelineWrap) return;
  if ('ResizeObserver' in window) {
    let _rafId: number = 0;
    new ResizeObserver(() => {
      cancelAnimationFrame(_rafId);
      _rafId = requestAnimationFrame(() => drawTimeline());
    }).observe(timelineWrap);
  } else {
    (window as Window).addEventListener('resize', drawTimeline);
  }
}
