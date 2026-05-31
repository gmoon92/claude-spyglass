/**
 * design-system/icons/Svg.tsx — 아이콘 패밀리 공통 SVG 래퍼 (P2-01)
 *
 * 책임:
 *  - 구 assets/js/design-system/icons/*.js 의 각 파일에 복제돼 있던 `wrapSvg(paths, opts)`
 *    헬퍼를 단일 React 컴포넌트로 통합한다.
 *  - 출력 SVG 마크업(속성·순서·기본값)을 원본 문자열과 **동치**로 유지한다:
 *      viewBox="0 0 16 16", fill="none", stroke="currentColor", stroke-width="1.5",
 *      stroke-linecap="round", stroke-linejoin="round".
 *  - ariaLabel 유무에 따라 role="img" aria-label / aria-hidden="true" 분기(원본 동일).
 *
 * SSoT 준수:
 *  - hex 색상·글리프 직접 지정 금지. 색은 호출 컨텍스트의 `color` 가 currentColor 로 상속.
 *  - 각 아이콘의 path/도형은 해당 컴포넌트가 children 으로 전달(원본 paths 문자열 1:1 대응).
 *
 * 동치 검증:
 *  - icons/__tests__/icons-equivalence.test.tsx 가 renderToStaticMarkup 결과를
 *    원본 svg* 함수 문자열과 정규화 비교한다.
 *
 * @module design-system/icons/Svg
 */
import type { ReactNode } from 'react';

/** 아이콘 공통 옵션 — 원본 wrapSvg opts 와 동일 시그니처. */
export interface IconProps {
  /** SVG width/height(px). 아이콘별 기본값은 각 컴포넌트가 결정(원본 default 계승). */
  size?: number;
  /** SVG class 속성. 미지정 시 class 속성 자체를 출력하지 않음(원본 동일). */
  className?: string;
  /** 지정 시 role="img" + aria-label, 미지정 시 aria-hidden="true"(원본 동일). */
  ariaLabel?: string | null;
}

/** 16x16 viewBox stroke-only 패밀리의 기본 래퍼 속성(원본 wrapSvg 와 1:1). */
export interface SvgProps extends IconProps {
  /** SVG 내부 도형(path/circle/line/rect 등). */
  children: ReactNode;
  /** viewBox(기본 "0 0 16 16"). chevron/note/quote 등은 "0 0 12 12" 사용. */
  viewBox?: string;
  /** stroke-width(기본 1.5). chevron 은 1.6. */
  strokeWidth?: number;
  /**
   * stroke/fill 래퍼 속성 출력 여부.
   * - true(기본): stroke="currentColor" 등 stroke 패밀리 속성 출력.
   * - false: diamond/quote 처럼 fill-only — 래퍼는 fill="none" 만, stroke 속성 없음.
   */
  stroke?: boolean;
  /**
   * stroke-linecap/linejoin 출력 여부(stroke=true 일 때만 유효).
   * - true(기본): stroke-linecap="round" stroke-linejoin="round" 출력.
   * - false: radio 처럼 stroke-width 까지만 출력하고 cap/join 생략(원본 동일).
   */
  strokeCaps?: boolean;
  /** chevron 전용: inline transform rotate 스타일. */
  style?: { transform: string };
  /** chevron 전용: data-dir 속성. */
  dataDir?: string;
  /** note/quote 전용: xmlns 속성 출력. */
  xmlns?: boolean;
}

/**
 * 공통 SVG 래퍼 — 원본 wrapSvg 의 속성/순서를 그대로 재현.
 *
 * 속성 순서(원본 문자열과 동치 핵심): class? → role/aria → style? → data-dir? →
 * viewBox → width → height → fill → (stroke 패밀리) → xmlns?.
 */
export function Svg({
  children,
  size = 12,
  className,
  ariaLabel = null,
  viewBox = '0 0 16 16',
  strokeWidth = 1.5,
  stroke = true,
  strokeCaps = true,
  style,
  dataDir,
  xmlns = false,
}: SvgProps) {
  // 원본은 ariaLabel 이 truthy 일 때만 role/aria-label, 아니면 aria-hidden.
  const ariaProps = ariaLabel
    ? { role: 'img' as const, 'aria-label': ariaLabel }
    : { 'aria-hidden': true as const };
  const strokeProps = stroke
    ? {
        stroke: 'currentColor',
        strokeWidth,
        ...(strokeCaps
          ? { strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const }
          : {}),
      }
    : {};
  return (
    <svg
      {...(className ? { className } : {})}
      {...ariaProps}
      {...(style ? { style } : {})}
      {...(dataDir ? { 'data-dir': dataDir } : {})}
      viewBox={viewBox}
      width={size}
      height={size}
      fill="none"
      {...strokeProps}
      {...(xmlns ? { xmlns: 'http://www.w3.org/2000/svg' } : {})}
    >
      {children}
    </svg>
  );
}
