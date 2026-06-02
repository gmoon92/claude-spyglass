/**
 * hooks/use-chart-reveal.ts — canvas 차트 reveal 애니메이션 구동기 (hooks leaf)
 *
 * 동기: 도넛/라인 같은 canvas 차트는 세션·프로젝트 전환 시 즉시 다시 그려져 "딱딱"하게 점프한다.
 *   obs-panel .obs-cat-bar-fill 이 width transition(var(--dur-drawer) var(--ease))으로 자연스럽게
 *   보간되는 것과 동일한 결을, canvas 에는 rAF 로 progress 0→1 을 ease-out 보간해 부여한다.
 *
 * 계약:
 *  - deps 변경 시 progress 를 0→1 로 durationMs 동안 ease-out(cubic) 보간하며 매 프레임 draw(progress) 호출.
 *  - redrawDeps 변경 시(reveal 미진행 중) 최종 프레임 draw(1) 만 — reveal 재시작 없이 새 값 즉시 반영.
 *    → 동일 컨텍스트의 데이터 갱신(예: SSE 로 같은 세션 turns 증가)이 매번 0→1 reveal 을 재생하던 회귀 차단.
 *      reveal 트리거(세션/모드 전환)는 deps 에, 단순 값 갱신은 redrawDeps 에 둔다.
 *  - prefers-reduced-motion: reduce 또는 rAF 부재(SSR/test) 시 draw(1) 1회만(즉시 최종 상태) — 접근성/안전.
 *  - cleanup 으로 진행 중 rAF 취소(deps 재변경·언마운트 시 누수/경쟁 방지).
 *  - draw 는 최신 클로저를 ref 로 고정 — deps 에 draw 를 넣지 않아도 항상 최신 turns/tokens 를 본다.
 *
 * 레이어(architecture §1.3): hooks leaf. 차트 컴포넌트(Chart/ContextChart)가 소비.
 *
 * @module hooks/use-chart-reveal
 */
import { useEffect, useRef, type DependencyList } from 'react';

/** ease-out cubic — 시작은 빠르고 끝에서 부드럽게 정착(은은한 전환). */
function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

/** prefers-reduced-motion: reduce 여부(SSR/matchMedia 부재 시 false). */
function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/**
 * deps 변경마다 progress 0→1 reveal 을 구동한다.
 * @param draw progress(0..1)를 받아 canvas 를 1프레임 그리는 콜백. progress=1 은 최종 상태.
 * @param deps 변경 시 reveal(0→1)을 재시작할 의존성 — "전환" 트리거(예: [donutMode], 세션키).
 * @param durationMs 전체 reveal 길이(기본 600ms — 은은하게).
 * @param redrawDeps 변경 시 reveal 없이 최종 프레임만 즉시 다시 그릴 의존성 — "값 갱신" 트리거
 *   (예: [dataByKind, tokens]). 미지정 시 redraw 비활성(기존 호출처 동작 보존).
 */
export function useChartReveal(
  draw: (progress: number) => void,
  deps: DependencyList,
  durationMs = 600,
  redrawDeps?: DependencyList,
): void {
  const drawRef = useRef(draw);
  drawRef.current = draw;
  // reveal 진행 중 여부 — redraw effect 가 진행 중인 reveal 을 덮어써 0→1 을 끊지 않도록 가드.
  const revealingRef = useRef(false);

  useEffect(() => {
    if (typeof window === 'undefined' || typeof requestAnimationFrame !== 'function') {
      drawRef.current(1);
      return undefined;
    }
    if (prefersReducedMotion() || durationMs <= 0) {
      drawRef.current(1);
      return undefined;
    }
    revealingRef.current = true;
    let raf = 0;
    let start = 0;
    const tick = (now: number): void => {
      if (!start) start = now;
      const t = Math.min(1, (now - start) / durationMs);
      drawRef.current(easeOutCubic(t));
      if (t < 1) raf = requestAnimationFrame(tick);
      else revealingRef.current = false;
    };
    raf = requestAnimationFrame(tick);
    return () => { cancelAnimationFrame(raf); revealingRef.current = false; };
    // deps 는 호출처가 의도한 reveal 트리거 — draw 는 ref 로 최신 유지하므로 deps 에서 제외.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  // 값 갱신 즉시 반영 — redrawDeps 변경 시 reveal 재시작 없이 최종 프레임만 그린다.
  //   reveal 진행 중이면 그 rAF 가 매 프레임 최신 데이터(drawRef)를 그리므로 생략(중복/경쟁 방지).
  //   마운트 시점엔 위 reveal effect 가 먼저 실행돼 revealingRef=true → 여기선 skip(기존 reveal 보존).
  //   redrawDeps 미지정 호출처는 []로 평가돼 마운트 1회뿐이고 그때도 reveal 가 담당하므로 무영향.
  useEffect(() => {
    if (revealingRef.current) return;
    drawRef.current(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, redrawDeps ?? []);
}
