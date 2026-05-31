/**
 * @module stats/bar
 *
 * 책임: 진행 바 단일 컴포넌트.
 *       value/max 비율을 시각적 수평 바로 표현하는 HTML 문자열을 생성한다.
 *       tone 별 그라데이션·글로우, role="progressbar" ARIA 속성을 포함한다.
 *
 * 흡수 대상:
 *   - cache-panel.css: .cache-bar-fill (is-high/is-mid/is-low 클래스 기반 바)
 *   - cache-panel.css: .cache-ratio-creation, .cache-ratio-read (비율 분할 바)
 *   - obs-panel.css:   .obs-cat-bar-fill--agent/--skill/--mcp/--native (카테고리 바)
 *   - tool-stats.css:  .ts-mx-bar-fill--avg/--calls/--tokens (도구 통계 매트릭스 바)
 *   (호출처 치환은 다음 wave에서 진행)
 *
 * 의존:
 *   - packages/web/assets/css/design-tokens.css: --grad-*, --glow-*, --badge-grad-neutral 변수
 *   - packages/web/assets/css/design-system/stats/bar.css
 *
 * 호출처: 다음 wave에서 cache-panel.js, obs-panel.js, tool-stats.js 교체 예정
 */

/** @typedef {'success' | 'info' | 'warn' | 'error' | 'brand' | 'neutral'} BarTone */

/**
 * 진행 바 HTML 문자열을 반환한다.
 *
 * @param {object} opts
 * @param {number}   opts.value             - 현재 값
 * @param {number}   [opts.max=100]         - 최대 값 (기본 100)
 * @param {BarTone}  [opts.tone='neutral']  - 색조 (success|info|warn|error|brand|neutral)
 * @param {boolean}  [opts.glow=false]      - 글로우 강제 활성 (brand/neutral에 적용)
 * @param {string}   [opts.ariaLabel]       - aria-label (생략 시 aria-label 속성 없음)
 * @returns {string} HTML 문자열
 *
 * @example
 * renderBar({ value: 78, max: 100, tone: 'success' })
 * // => '<div class="ds-bar-track" role="progressbar" aria-valuenow="78" aria-valuemax="100"><span class="ds-bar-fill" data-tone="success" style="width:78%"></span></div>'
 *
 * @example
 * renderBar({ value: 3, max: 5, tone: 'info', ariaLabel: '캐시 히트율' })
 * // => '<div class="ds-bar-track" role="progressbar" aria-valuenow="3" aria-valuemax="5" aria-label="캐시 히트율"><span class="ds-bar-fill" data-tone="info" style="width:60%"></span></div>'
 */
export function renderBar({ value, max = 100, tone = 'neutral', glow = false, ariaLabel }: { value: number; max?: number; tone?: string; glow?: boolean; ariaLabel?: string }) {
  const VALID_TONES = ['success', 'info', 'warn', 'error', 'brand', 'neutral'];
  const safeTone    = VALID_TONES.includes(tone) ? tone : 'neutral';
  const widthPct    = Math.max(0, Math.min(100, (value / max) * 100));

  const ariaLabelAttr = ariaLabel ? ` aria-label="${ariaLabel}"` : '';
  const glowAttr      = glow ? ' data-glow="on"' : '';

  return `<div class="ds-bar-track" role="progressbar" aria-valuenow="${value}" aria-valuemax="${max}"${ariaLabelAttr}><span class="ds-bar-fill" data-tone="${safeTone}"${glowAttr} style="width:${widthPct}%"></span></div>`;
}
