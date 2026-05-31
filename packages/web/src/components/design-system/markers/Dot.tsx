/**
 * design-system/markers/Dot.tsx — 작은 원형 상태 마커 (P2-03)
 *
 * 원본: assets/js/design-system/markers/dot.js renderDot.
 *  - tone/size 조합으로 세션 상태·트렌드·이상 신호·범례 컬러 점(dot)을 통일 생성.
 *  - 출력 HTML 마크업(class·data-tone·data-size·aria·title 속성/순서)을 원본 문자열과 **동치**로 유지.
 *
 * SSoT 준수:
 *  - hex 색상 직접 지정 금지. 색은 data-tone → dot.css + design-tokens.css 가 처리.
 *  - 점 크기는 data-size 토큰(sm/md/lg)으로만 표현(원본 동일).
 *
 * 동치 검증:
 *  - markers/__tests__/components-equivalence.test.tsx 가 renderToStaticMarkup 결과를
 *    원본 renderDot 문자열과 정규화 비교한다.
 *
 * @module design-system/markers/Dot
 */

/** 색상 톤(상태 의미) — 원본 DotTone 과 동일. */
export type DotTone =
  | 'active'
  | 'stale'
  | 'ended'
  | 'info'
  | 'success'
  | 'warn'
  | 'error'
  | 'pulse';

/** 점 크기 — 원본 DotSize 와 동일. */
export type DotSize = 'sm' | 'md' | 'lg';

/** Dot 컴포넌트 props — 원본 renderDot opts 와 1:1. */
export interface DotProps {
  /** 색상 톤(상태 의미). 미지정/비유효 → 'info'(원본 fallback 동일). */
  tone?: DotTone;
  /** 점 크기. 미지정/비유효 → 'md'(원본 fallback 동일). */
  size?: DotSize;
  /** 스크린리더용 title 속성 텍스트(옵션). 지정 시에만 title 속성 출력. */
  label?: string;
  /** aria-hidden 여부. 기본 true(원본 동일). */
  ariaHidden?: boolean;
}

const VALID_TONES = new Set<DotTone>([
  'active',
  'stale',
  'ended',
  'info',
  'success',
  'warn',
  'error',
  'pulse',
]);
const VALID_SIZES = new Set<DotSize>(['sm', 'md', 'lg']);

/**
 * 작은 원형 상태 마커(dot) — 원본 renderDot 의 속성/순서를 그대로 재현.
 *
 * 속성 순서(원본 문자열과 동치 핵심):
 *   class → data-tone → data-size → aria-hidden → title?.
 */
export function Dot({ tone = 'info', size = 'md', label, ariaHidden = true }: DotProps = {}) {
  const safeTone: DotTone = VALID_TONES.has(tone) ? tone : 'info';
  const safeSize: DotSize = VALID_SIZES.has(size) ? size : 'md';
  return (
    <span
      className="ds-dot"
      data-tone={safeTone}
      data-size={safeSize}
      aria-hidden={ariaHidden ? 'true' : 'false'}
      {...(label ? { title: label } : {})}
    />
  );
}
