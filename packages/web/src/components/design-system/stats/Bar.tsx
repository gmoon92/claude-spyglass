/**
 * design-system/stats/Bar.tsx — 진행 바(progress bar) (P2-03)
 *
 * 원본: assets/js/design-system/stats/bar.js renderBar.
 *  - value/max 비율을 수평 바로 표현; tone 별 그라데이션·글로우, role="progressbar" ARIA 포함.
 *  - 출력 HTML(track div + fill span, class·role·aria-*·data-tone·data-glow·style 속성/순서)을
 *    원본 문자열과 **동치**로 유지.
 *
 * SSoT 준수:
 *  - hex 직접 지정 금지. 색/그라데이션/글로우는 data-tone·data-glow → design-tokens.css 의 grad/glow 토큰.
 *
 * 동치 비교 주의:
 *  - widthPct = clamp(0, 100, value/max*100) 을 원본과 동일 산식으로 계산하고
 *    `width:{pct}%` 문자열을 그대로 출력(부동소수 문자열화도 JS 기본 동작 동일).
 *  - aria-valuenow/aria-valuemax 는 원본의 원시 number 보간과 동일하게 number 그대로 전달.
 *  - ariaLabel 은 truthy 일 때만, glow 는 true 일 때만 속성 출력(원본 동일).
 *  - React inline style 직렬화는 `width:78%`(콜론 뒤 공백 없음) — 원본 문자열과 정규화 후 동치.
 *
 * @module design-system/stats/Bar
 */

/** 진행 바 색조 — 원본 BarTone 과 동일. */
export type BarTone = 'success' | 'info' | 'warn' | 'error' | 'brand' | 'neutral';

/** Bar 컴포넌트 props — 원본 renderBar opts 와 1:1. */
export interface BarProps {
  /** 현재 값. */
  value: number;
  /** 최대 값. 기본 100(원본 동일). */
  max?: number;
  /** 색조. 미지정/비유효 → 'neutral'(원본 fallback 동일). */
  tone?: BarTone;
  /** 글로우 강제 활성(brand/neutral). 기본 false; true 일 때만 data-glow="on" 출력. */
  glow?: boolean;
  /** aria-label. 생략 시 aria-label 속성 미출력(원본 동일). */
  ariaLabel?: string;
}

const VALID_TONES: readonly BarTone[] = ['success', 'info', 'warn', 'error', 'brand', 'neutral'];

/**
 * 진행 바 — 원본 renderBar 의 track/fill 구조·속성/순서를 그대로 재현.
 *
 * track: class → role → aria-valuenow → aria-valuemax → aria-label?.
 * fill : class → data-tone → data-glow? → style(width).
 */
export function Bar({ value, max = 100, tone = 'neutral', glow = false, ariaLabel }: BarProps) {
  const safeTone: BarTone = VALID_TONES.includes(tone) ? tone : 'neutral';
  const widthPct = Math.max(0, Math.min(100, (value / max) * 100));
  return (
    <div
      className="ds-bar-track"
      role="progressbar"
      aria-valuenow={value}
      aria-valuemax={max}
      {...(ariaLabel ? { 'aria-label': ariaLabel } : {})}
    >
      <span
        className="ds-bar-fill"
        data-tone={safeTone}
        {...(glow ? { 'data-glow': 'on' } : {})}
        style={{ width: `${widthPct}%` }}
      />
    </div>
  );
}
