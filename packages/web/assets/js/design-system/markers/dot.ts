/**
 * @module markers/dot
 *
 * 책임: 작은 원형 상태 마커 단일 컴포넌트.
 *       tone/size 속성 조합으로 세션 상태, 트렌드, 이상 신호, 범례 등
 *       다양한 문맥의 컬러 점(dot)을 통일된 방식으로 생성한다.
 *
 * 흡수 대상:
 *   - sess-row-status (left-panel.css) — 세션 활성도 점 (active/stale/ended)
 *   - obs-card-trend-icon (obs-panel.css) — 옵저버빌리티 카드 트렌드 아이콘
 *   - anomaly-badge-dot (obs-panel.css) — 부동 Anomaly 뱃지 펄스 점
 *   - legend-dot (default-view.css) — 차트 도넛 범례 점
 *   - meta-docs-toast-icon (meta-docs.css) — 메타 문서 토스트 좌측 컬러 점
 *   (호출처 치환은 다음 wave에서 진행)
 *
 * 의존:
 *   - packages/web/assets/css/design-system/markers/dot.css
 *
 * 호출처: 다음 wave에서 left-panel.js, obs-panel.js, meta-docs-view.js, chart.js 교체 예정
 */

/** @typedef {'active' | 'stale' | 'ended' | 'info' | 'success' | 'warn' | 'error' | 'pulse'} DotTone */
/** @typedef {'sm' | 'md' | 'lg'} DotSize */

const VALID_TONES = new Set(['active', 'stale', 'ended', 'info', 'success', 'warn', 'error', 'pulse']);
const VALID_SIZES = new Set(['sm', 'md', 'lg']);

/**
 * 작은 원형 상태 마커(dot) HTML 문자열을 생성한다.
 *
 * @param {object} opts
 * @param {DotTone} [opts.tone='info']       - 색상 톤 (상태 의미)
 * @param {DotSize} [opts.size='md']         - 점 크기
 * @param {string}  [opts.label]             - 스크린리더용 title 속성 텍스트 (옵션)
 * @param {boolean} [opts.ariaHidden=true]   - aria-hidden 여부
 * @returns {string} HTML 문자열
 *
 * @example
 * renderDot({ tone: 'active', size: 'sm', label: '활성 세션' })
 * // => '<span class="ds-dot" data-tone="active" data-size="sm" aria-hidden="true" title="활성 세션"></span>'
 *
 * @example
 * renderDot({ tone: 'pulse' })
 * // => '<span class="ds-dot" data-tone="pulse" data-size="md" aria-hidden="true"></span>'
 */
export function renderDot({ tone = 'info', size = 'md', label, ariaHidden = true }: { tone?: string; size?: string; label?: string; ariaHidden?: boolean } = {}) {
  const safeTone = VALID_TONES.has(tone) ? tone : 'info';
  const safeSize = VALID_SIZES.has(size) ? size : 'md';
  const ariaAttr = ariaHidden ? 'aria-hidden="true"' : 'aria-hidden="false"';
  const titleAttr = label ? ` title="${String(label).replace(/"/g, '&quot;')}"` : '';

  return `<span class="ds-dot" data-tone="${safeTone}" data-size="${safeSize}" ${ariaAttr}${titleAttr}></span>`;
}
