/**
 * design-system/chips/Chip.tsx — 도구·모델·서브타입 분류/식별 칩 (P2-03)
 *
 * 원본: assets/js/design-system/chips/chip.js renderChip.
 *  - chip 은 "무엇인가(분류·소속)"를 표현; badge("상태가 어떤가")와 의미론적으로 구분.
 *  - dot=true → currentColor 6×6 원(<span class="ds-dot">) prefix(모델 칩 강조).
 *  - 출력 HTML(class·data-tone·임의 data-* 속성/순서, prefix + label)을 원본 문자열과 **동치**로 유지.
 *
 * SSoT 준수:
 *  - hex/글리프 직접 지정 금지. 색은 data-tone → CSS 변수(--sub-type-*, --model-*-color).
 *
 * 동치 비교 주의:
 *  - 원본 dataAttrs 는 Object.entries 삽입 순서로 data-{k}="{v}"(k·v 모두 escHtml) 보간.
 *    → React 도 객체 prop 삽입 순서를 보존하므로 동일 순서로 출력된다.
 *  - prefix 우선순위: icon(노드) > dot(<span class="ds-dot"></span>) > 없음(원본 동일).
 *  - 원본 dot span 은 클래스만 있는 빈 요소(`<span class="ds-dot"></span>`) — markers/Dot 의
 *    data-tone/data-size/aria-hidden 가 붙은 점과 다르다. 칩 dot 은 원본 그대로 클래스만 출력한다.
 *
 * @module design-system/chips/Chip
 */
import type { ReactNode } from 'react';

/** 칩 분류 톤 — 원본 tone 유니온과 동일(서브타입 + 모델 패밀리). */
export type ChipTone =
  | 'mcp'
  | 'agent'
  | 'skill'
  | 'task'
  | 'haiku'
  | 'sonnet'
  | 'opus'
  | 'external'
  | 'unknown';

/** Chip 컴포넌트 props — 원본 renderChip opts 와 1:1. */
export interface ChipProps {
  /** 분류 톤. 미지정 → 'unknown'(원본 fallback 동일). */
  tone?: ChipTone;
  /** 표시 텍스트. 텍스트 children 으로 전달돼 React 가 이스케이프(원본 escHtml 대응). */
  label?: string;
  /** true 면 6×6 currentColor 원(ds-dot) prefix(원본 동일). */
  dot?: boolean;
  /** SVG 아이콘 노드. dot 보다 우선(원본 동일). */
  icon?: ReactNode;
  /**
   * 임의 data-* 속성 맵. 예: { 'meta-doc-type': 'skill' } → data-meta-doc-type="skill".
   * 삽입 순서대로 출력(원본 Object.entries 순서와 동치).
   */
  dataAttrs?: Record<string, string>;
}

/**
 * 분류·식별 칩 — 원본 renderChip 의 속성/순서/구조를 그대로 재현.
 *
 * 속성 순서(동치 핵심): class → data-tone → (dataAttrs 삽입 순서).
 * 내부 구조: `{prefix}{label}` (icon|dot prefix + label).
 */
export function Chip({ tone, label, dot = false, icon, dataAttrs = {} }: ChipProps) {
  const safeLabel = label ?? '';
  const safeTone: ChipTone = tone ?? 'unknown';
  // 임의 data-* 속성을 삽입 순서대로 prop 객체로 전개(원본 보간 순서 보존).
  const dataProps: Record<string, string> = {};
  for (const [k, v] of Object.entries(dataAttrs)) {
    dataProps[`data-${k}`] = String(v);
  }
  // prefix 우선순위: icon > dot > 없음. dot 은 원본과 동일하게 클래스만 가진 ds-dot 빈 span
  // (markers/Dot 의 data-tone/size/aria 와 의도적으로 다름 — 원본 renderChip 출력 보존).
  const prefixFragment: ReactNode = icon ? icon : dot ? <span className="ds-dot" /> : null;
  return (
    <span className="ds-chip" data-tone={safeTone} {...dataProps}>
      {prefixFragment}
      {safeLabel}
    </span>
  );
}
