/**
 * @module design-system/chips/chip
 *
 * 책임:
 *   도구·모델·서브타입 등 식별/분류 라벨을 일관된 시각 어휘로 렌더링한다.
 *   chip은 "이것이 무엇인가(분류·소속)"를 나타내며,
 *   badge("이 상태가 어떤가")와 의미론적으로 구분된다.
 *   dot=true 옵션으로 currentColor 6×6 원 prefix를 붙여 모델 칩처럼 시각 강조할 수 있다.
 *
 * 흡수 대상 (향후 wave에서 호출처 치환):
 *   - badges.css :: .sub-type-chip .sub-type-chip-{mcp,agent,skill,task}
 *     → render/badges.js :: subTypeBadgeHtml
 *   - badges.css :: .model-chip .model-chip-{haiku,sonnet,opus,external,unknown}
 *     → render/model.js :: modelChipHtml
 *   - badges.css :: .tool-chip .tool-chip-{mcp,agent,skill,task}  (향후 통합 예정)
 *   - badges.css :: .target-role-badge                            (향후 통합 예정)
 *   - badges.css :: .agent-chip                                   (향후 통합 예정)
 *
 * 의존:
 *   - formatters.js#escHtml — XSS 방어용 HTML 이스케이프
 *   - chip.css / design-tokens.css — .ds-chip[data-tone] 스타일
 *
 * 향후 위임 호출처:
 *   - render/badges.js :: subTypeBadgeHtml → renderChip({ tone: 'mcp'|'agent'|'skill'|'task', … })
 *   - render/model.js  :: modelChipHtml    → renderChip({ tone: 'haiku'|'sonnet'|'opus'|'external'|'unknown', dot: true, … })
 */

import { escHtml } from '../../formatters.js';

/**
 * 분류·식별 칩 HTML 문자열을 반환한다.
 *
 * @param {object}  opts
 * @param {'mcp'|'agent'|'skill'|'task'|'haiku'|'sonnet'|'opus'|'external'|'unknown'} opts.tone
 *   칩의 분류 톤. CSS 변수 패밀리(--sub-type-*, --model-*-color)와 매핑된다.
 * @param {string}  opts.label       표시할 텍스트. escHtml로 자동 이스케이프된다.
 * @param {boolean} [opts.dot=false] true이면 6×6 currentColor 원 prefix를 붙인다 (모델 칩 스타일).
 * @param {string}  [opts.icon]      SVG HTML 문자열. dot보다 우선 적용된다.
 * @param {object}  [opts.dataAttrs={}]
 *   임의 data-* 속성 맵. 예: { 'meta-doc-type': 'skill', 'meta-doc-id': 'foo' }
 *   → data-meta-doc-type="skill" data-meta-doc-id="foo"
 *   기존 sub-type-chip의 data-meta-doc-type / data-meta-doc-id 호환을 위해 제공.
 * @returns {string} .ds-chip span HTML 문자열
 *
 * @example
 * // 서브타입 MCP 칩 (딥링크 없음)
 * renderChip({ tone: 'mcp', label: 'MCP' })
 * // → '<span class="ds-chip" data-tone="mcp">MCP</span>'
 *
 * @example
 * // 모델 Sonnet 칩 (dot 포함)
 * renderChip({ tone: 'sonnet', label: 'sonnet', dot: true })
 * // → '<span class="ds-chip" data-tone="sonnet"><span class="ds-dot"></span>sonnet</span>'
 *
 * @example
 * // Skill 칩 + 딥링크 data 속성
 * renderChip({ tone: 'skill', label: 'Skill', dataAttrs: { 'meta-doc-type': 'skill', 'meta-doc-id': 'foo-skill' } })
 */
export function renderChip({ tone, label, dot = false, icon, dataAttrs = {} }) {
  const safeLabel = escHtml(label ?? '');
  const safeTone  = escHtml(tone ?? 'unknown');

  // data-* 속성 문자열 조합
  const dataAttrStr = Object.entries(dataAttrs)
    .map(([k, v]) => ` data-${escHtml(k)}="${escHtml(String(v))}"`)
    .join('');

  // prefix: icon > dot > 없음
  const prefixFragment = icon
    ? icon
    : dot
      ? '<span class="ds-dot"></span>'
      : '';

  return `<span class="ds-chip" data-tone="${safeTone}"${dataAttrStr}>${prefixFragment}${safeLabel}</span>`;
}
