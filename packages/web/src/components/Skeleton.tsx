/**
 * components/Skeleton.tsx — 로딩 스켈레톤 (components leaf)
 *
 * 기존 assets/css/skeleton.css 의 .sk / .sk-line / .sk-block / .sk-bar / .sk-row 시스템을
 *   선언적으로 노출한다(신규 CSS 무도입, --sk-delay 80ms 로 빠른 응답 시 깜빡임 0).
 *   fetch 대기 중 "데이터 없음" 빈 상태가 뜨는 오해를 막기 위해, 호출처가 loading 일 때 이 컴포넌트를
 *   빈 상태 대신 렌더한다(컴포넌트별 로딩 표시 SSoT).
 *
 * 접근성: aria-hidden(스크린리더 무시) + 호출처가 컨테이너에 aria-busy 부여 권장.
 *   prefers-reduced-motion 은 skeleton.css 의 미디어쿼리가 shimmer 를 정적 톤으로 무력화.
 *
 * @module components/Skeleton
 */
import type { CSSProperties, ReactElement } from 'react';

export type SkeletonVariant =
  | 'line'
  | 'line-sm'
  | 'line-lg'
  | 'block'
  | 'block-sm'
  | 'block-lg'
  | 'bar'
  | 'circle';

const VARIANT_CLASS: Record<SkeletonVariant, string> = {
  line: 'sk-line',
  'line-sm': 'sk-line sk-line--sm',
  'line-lg': 'sk-line sk-line--lg',
  block: 'sk-block',
  'block-sm': 'sk-block sk-block--sm',
  'block-lg': 'sk-block sk-block--lg',
  bar: 'sk-bar',
  circle: 'sk-circle',
};

/** 단일 스켈레톤 조각(skeleton.css .sk + variant). */
export function Skeleton({
  variant = 'line',
  width,
  className,
  style,
}: {
  variant?: SkeletonVariant;
  width?: number | string;
  className?: string;
  style?: CSSProperties;
}): ReactElement {
  const cls = `sk ${VARIANT_CLASS[variant]}${className ? ` ${className}` : ''}`;
  return <span className={cls} style={width != null ? { width, ...style } : style} aria-hidden="true" />;
}

/**
 * 테이블/리스트 로딩 스켈레톤 — n행의 .sk-row(각 행에 .sk-line). 빈 상태(no-data) 자리에 대체 렌더.
 * 컨테이너에 role=status + aria-busy 로 "불러오는 중"을 보조기술에 알린다.
 */
export function SkeletonRows({
  rows = 6,
  className,
}: {
  rows?: number;
  className?: string;
}): ReactElement {
  return (
    <div className={`sk-list${className ? ` ${className}` : ''}`} role="status" aria-busy="true" aria-live="polite">
      {Array.from({ length: rows }).map((_, i) => (
        <div className="sk-row" key={i} style={{ gridTemplateColumns: '1fr' }}>
          <Skeleton variant="line" />
        </div>
      ))}
    </div>
  );
}
