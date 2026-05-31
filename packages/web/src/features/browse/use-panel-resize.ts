// features/browse/use-panel-resize.ts — 좌측 패널 리사이저 훅 (vanilla→React 마이그레이션)
//
// 원본 2종을 React-idiomatic 으로 이식(레거시 핸들 3개 1:1):
//   - assets/js/panel-resize.js initPanelResize — 수평 너비 드래그 + 더블클릭 Auto-fit.
//       CSS var '--left-panel-width', localStorage 'spyglass:panel-width', clamp(min/max).
//       min/max 는 design-tokens.css 의 --panel-resize-min/max(144/384). 기본 폴백 180/480.
//   - assets/js/left-panel-vertical-resize.js — 수직 분할 핸들 두 개:
//       initPanelVerticalResize(#panelVerticalHandle)        — 프로젝트 ↔ 세션,
//         CSS var '--projects-panel-height', localStorage 'spyglass:panel-split'.
//       initPanelBottomResize(#panelVerticalHandleBottom)    — 세션 ↔ obs(panelTools),
//         CSS var '--sessions-panel-height', localStorage 'spyglass:panel-split-bottom'.
//       두 핸들 모두 비율(0..1) 저장 + 각 섹션 최소 80px clamp.
//
// React 이식 원칙:
//   - DOM 직접조작 최소화. 핸들/패널/섹션은 ref 로 받고, 불가피한 CSS var 세팅은
//     document.documentElement.style.setProperty(원본과 동일 — 전역 CSS var 갱신은 inline 불가).
//   - mousedown 시 document 에 mousemove/mouseup 리스너 부착, mouseup·언마운트 시 철저 cleanup.
//   - 저장된 값 복원은 useEffect 마운트 1회(수평은 즉시 px, 수직은 rAF 후 비율→px — 원본 동치).
//
// FOUC: 수평 너비 preinit 은 index.html 인라인 스크립트가 이미 첫 paint 전 --left-panel-width 세팅.
//   본 훅의 복원은 그 이후 React 마운트 시 idempotent 재적용.

import { useEffect, useRef } from 'react';
import type { RefObject } from 'react';

const WIDTH_STORAGE_KEY = 'spyglass:panel-width';
const SPLIT_TOP_STORAGE_KEY = 'spyglass:panel-split'; // 프로젝트 ↔ 세션 (원본 STORAGE_KEY)
const SPLIT_BOTTOM_STORAGE_KEY = 'spyglass:panel-split-bottom'; // 세션 ↔ obs (원본 STORAGE_KEY_BOTTOM)
const PROJECTS_HEIGHT_VAR = '--projects-panel-height';
const SESSIONS_HEIGHT_VAR = '--sessions-panel-height';
const SECTION_MIN_PX = 80; // 각 상하 섹션 최소 높이(원본 left-panel-vertical-resize.js MIN_PX)

/** design-tokens.css --panel-resize-min/max 읽기(원본 getMinMax, 폴백 180/480). */
function getWidthMinMax(): { min: number; max: number } {
  const style = getComputedStyle(document.documentElement);
  return {
    min: parseInt(style.getPropertyValue('--panel-resize-min'), 10) || 180,
    max: parseInt(style.getPropertyValue('--panel-resize-max'), 10) || 480,
  };
}

/** px 를 clamp 후 --left-panel-width 에 적용. clamp 결과 반환(원본 setPanelWidth). */
function setLeftPanelWidth(px: number): number {
  const { min, max } = getWidthMinMax();
  const clamped = Math.max(min, Math.min(max, px));
  document.documentElement.style.setProperty('--left-panel-width', `${clamped}px`);
  return clamped;
}

/** 두 섹션 가용 높이(원본 computeAvailable 의 normal path — browse 모드). */
function computeAvailable(topEl: HTMLElement, bottomEl: HTMLElement): number {
  return topEl.getBoundingClientRect().height + bottomEl.getBoundingClientRect().height;
}

/** 비율(0..1) → topEl 높이(px) 를 지정 CSS var 에 적용(원본 applyRatioCssVar). */
function applyRatioCssVar(ratio: number, topEl: HTMLElement, bottomEl: HTMLElement, cssVar: string): void {
  const available = computeAvailable(topEl, bottomEl);
  if (available <= 0) return;
  const clamped = Math.max(SECTION_MIN_PX, Math.min(available - SECTION_MIN_PX, ratio * available));
  document.documentElement.style.setProperty(cssVar, `${clamped}px`);
}

/**
 * 수직 분할 핸들 1개 결선(원본 initResize 의 normal-path 1:1).
 *  - 저장 비율 복원(rAF) + mousedown→mousemove/mouseup 드래그 + mouseup 시 비율 저장.
 *  - 반환된 cleanup 으로 rAF 취소 + mousedown 리스너 해제.
 */
function wireVerticalHandle(
  handle: HTMLElement,
  topEl: HTMLElement,
  bottomEl: HTMLElement,
  cssVar: string,
  storageKey: string,
): () => void {
  let raf = 0;
  const saved = localStorage.getItem(storageKey);
  if (saved != null) {
    const ratio = parseFloat(saved);
    if (Number.isFinite(ratio) && ratio > 0 && ratio < 1) {
      raf = requestAnimationFrame(() => applyRatioCssVar(ratio, topEl, bottomEl, cssVar));
    }
  }

  const onMouseDown = (e: MouseEvent): void => {
    e.preventDefault();
    const startY = e.clientY;
    const startTopH = topEl.getBoundingClientRect().height;
    const available = computeAvailable(topEl, bottomEl);
    document.body.style.userSelect = 'none';
    handle.classList.add('dragging');

    const onMove = (ev: MouseEvent): void => {
      const newTopH = startTopH + (ev.clientY - startY);
      applyRatioCssVar(available > 0 ? newTopH / available : 0.35, topEl, bottomEl, cssVar);
    };
    const onUp = (): void => {
      document.body.style.userSelect = '';
      handle.classList.remove('dragging');
      const total = computeAvailable(topEl, bottomEl);
      const ratio = total > 0 ? topEl.getBoundingClientRect().height / total : 0.35;
      localStorage.setItem(storageKey, String(ratio));
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  };

  handle.addEventListener('mousedown', onMouseDown);
  return () => {
    if (raf) cancelAnimationFrame(raf);
    handle.removeEventListener('mousedown', onMouseDown);
  };
}

export interface UsePanelResizeRefs {
  /** .left-panel aside — 수평 드래그 기준 너비 측정 + Auto-fit 콘텐츠 측정 대상. */
  panelRef: RefObject<HTMLElement>;
  /** .panel-resize-handle — 수평 너비 드래그 핸들. */
  widthHandleRef: RefObject<HTMLDivElement>;
  /** #panelVerticalHandle — 프로젝트 ↔ 세션 상하 분할 핸들. */
  vTopHandleRef: RefObject<HTMLDivElement>;
  /** #panelVerticalHandleBottom — 세션 ↔ obs(panelTools) 상하 분할 핸들. */
  vBottomHandleRef: RefObject<HTMLDivElement>;
  /** #browserProjectsSection — 프로젝트 섹션(top 핸들의 위쪽). */
  vProjectsRef: RefObject<HTMLDivElement>;
  /** #browserSessionsSection — 세션 섹션(top 핸들의 아래·bottom 핸들의 위쪽). */
  vSessionsRef: RefObject<HTMLDivElement>;
  /** #panelTools — obs 섹션(bottom 핸들의 아래쪽). */
  vToolsRef: RefObject<HTMLDivElement>;
}

/**
 * 좌측 패널 리사이저 훅 — 수평 너비 1 + 수직 분할 2(레거시 3핸들 1:1).
 *  - 반환된 ref 를 핸들/패널/섹션 요소에 붙이면 드래그 동작이 결선된다.
 *  - 저장값 복원·리스너 부착/해제는 훅 내부 useEffect 가 전담(호출처 무사이드이펙트).
 */
export function usePanelResize(): UsePanelResizeRefs {
  const panelRef = useRef<HTMLElement>(null);
  const widthHandleRef = useRef<HTMLDivElement>(null);
  const vTopHandleRef = useRef<HTMLDivElement>(null);
  const vBottomHandleRef = useRef<HTMLDivElement>(null);
  const vProjectsRef = useRef<HTMLDivElement>(null);
  const vSessionsRef = useRef<HTMLDivElement>(null);
  const vToolsRef = useRef<HTMLDivElement>(null);

  // ── 수평 너비 드래그 + 더블클릭 Auto-fit(원본 initPanelResize). ──
  useEffect(() => {
    const panel = panelRef.current;
    const handle = widthHandleRef.current;
    if (!panel || !handle) return;

    // 저장된 너비 복원(원본: localStorage → setPanelWidth). index.html preinit 이후 idempotent.
    const saved = localStorage.getItem(WIDTH_STORAGE_KEY);
    if (saved) setLeftPanelWidth(parseInt(saved, 10));

    const onMouseDown = (e: MouseEvent): void => {
      e.preventDefault();
      const startX = e.clientX;
      const startW = panel.getBoundingClientRect().width;
      document.body.style.userSelect = 'none';
      handle.classList.add('dragging');

      const onMove = (ev: MouseEvent): void => {
        setLeftPanelWidth(startW + (ev.clientX - startX));
      };
      const onUp = (): void => {
        document.body.style.userSelect = '';
        handle.classList.remove('dragging');
        localStorage.setItem(WIDTH_STORAGE_KEY, String(Math.round(panel.getBoundingClientRect().width)));
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
      };
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    };

    // 더블클릭 Auto-fit — 패널 내 가장 긴 콘텐츠 너비에 맞춤(원본 measureMaxWidth + 28 여유).
    const onDblClick = (e: MouseEvent): void => {
      e.preventDefault();
      const targets = panel.querySelectorAll('td, .sess-row-preview, .tool-main, .panel-label');
      let maxW = 0;
      targets.forEach((el) => {
        maxW = Math.max(maxW, (el as HTMLElement).scrollWidth);
      });
      const fitted = setLeftPanelWidth(maxW + 28);
      localStorage.setItem(WIDTH_STORAGE_KEY, String(Math.round(fitted)));
    };

    handle.addEventListener('mousedown', onMouseDown);
    handle.addEventListener('dblclick', onDblClick);
    return () => {
      handle.removeEventListener('mousedown', onMouseDown);
      handle.removeEventListener('dblclick', onDblClick);
    };
  }, []);

  // ── 수직 분할 #1: 프로젝트 ↔ 세션(원본 initPanelVerticalResize). ──
  useEffect(() => {
    const handle = vTopHandleRef.current;
    const topEl = vProjectsRef.current;
    const bottomEl = vSessionsRef.current;
    if (!handle || !topEl || !bottomEl) return;
    return wireVerticalHandle(handle, topEl, bottomEl, PROJECTS_HEIGHT_VAR, SPLIT_TOP_STORAGE_KEY);
  }, []);

  // ── 수직 분할 #2: 세션 ↔ obs(panelTools)(원본 initPanelBottomResize). ──
  useEffect(() => {
    const handle = vBottomHandleRef.current;
    const topEl = vSessionsRef.current;
    const bottomEl = vToolsRef.current;
    if (!handle || !topEl || !bottomEl) return;
    return wireVerticalHandle(handle, topEl, bottomEl, SESSIONS_HEIGHT_VAR, SPLIT_BOTTOM_STORAGE_KEY);
  }, []);

  return { panelRef, widthHandleRef, vTopHandleRef, vBottomHandleRef, vProjectsRef, vSessionsRef, vToolsRef };
}
