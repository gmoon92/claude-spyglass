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
const META_FLOW_STORAGE_KEY = 'spyglass:meta-docs-flow-split'; // flow ↔ 카탈로그 (원본 STORAGE_KEY_METADOCS)
const PROJECTS_HEIGHT_VAR = '--projects-panel-height';
const SESSIONS_HEIGHT_VAR = '--sessions-panel-height';
const META_FLOW_HEIGHT_VAR = '--meta-docs-flow-height';
const META_FLOW_REGION_ID = 'metaDocsFlowRegion'; // MetaDocsFlow 가 소유하는 ego-graph 컨테이너 id(셀렉터 계약)
const META_SUMMARY_ID = 'metaDocsSummaryCards'; // MetaDocsSummaryCards 가 소유하는 요약카드 컨테이너 id(셀렉터 계약)
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

/**
 * 수평 너비 핸들 1개 결선(원본 initPanelResize 1:1) — browse·metadocs 좌측 패널 공용 SSoT.
 *  - 저장 너비 복원(localStorage 'spyglass:panel-width', index.html preinit 이후 idempotent).
 *  - mousedown→mousemove/mouseup 드래그로 --left-panel-width 갱신 + mouseup 시 저장.
 *  - dblclick Auto-fit — 패널 내 가장 긴 콘텐츠(td/.sess-row-preview/.tool-main/.panel-label) + 28px 여유.
 *  - 반환된 cleanup 으로 mousedown/dblclick 리스너 해제.
 *
 * browse 와 metadocs 가 동일 핸들 동작·동일 storage 키를 공유하므로 좌측 패널 너비가 모드 간 일관된다
 * (layout.css grid-template-columns 가 --left-panel-width 를 모드 무관 적용).
 */
function wireWidthHandle(panel: HTMLElement, handle: HTMLElement): () => void {
  // 저장된 너비 복원(원본: localStorage → setPanelWidth).
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
}

/**
 * 두 섹션 가용 높이(원본 computeAvailable 1:1).
 *  - normal path(browse, 그리고 metadocs flow↔카탈로그): topEl + bottomEl 합.
 *  - metadocs 좌측 패널(프로젝트 ↔ 요약카드): 하단 요약카드(~50px)가 너무 작아 available-MIN_PX<MIN_PX
 *    가 되어 clamp 범위가 무너진다 → topEl 의 .left-panel 조상 전체 높이를 가용 공간으로 사용(원본 동치).
 *    이 분기는 body[data-app-mode='metadocs'] 이고 topEl 이 .left-panel 자손일 때만 발동하므로
 *    browse 동작·metadocs flow 핸들(topEl 이 .left-panel 자손이 아님)에는 영향이 없다.
 */
function computeAvailable(topEl: HTMLElement, bottomEl: HTMLElement): number {
  if (document.body.dataset.appMode === 'metadocs') {
    const panel = topEl.closest('.left-panel');
    if (panel) return panel.getBoundingClientRect().height;
  }
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

  // ── 수평 너비 드래그 + 더블클릭 Auto-fit(원본 initPanelResize) — wireWidthHandle SSoT. ──
  useEffect(() => {
    const panel = panelRef.current;
    const handle = widthHandleRef.current;
    if (!panel || !handle) return;
    return wireWidthHandle(panel, handle);
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

export interface UseMetaDocsPanelResizeRefs {
  /** .left-panel aside — 수평 드래그 기준 너비 측정 + Auto-fit 콘텐츠 측정 대상. */
  panelRef: RefObject<HTMLElement>;
  /** .panel-resize-handle — 수평 너비 드래그 핸들(browse 와 동일 동작·storage 키). */
  widthHandleRef: RefObject<HTMLDivElement>;
  /** #panelVerticalHandle(metadocs) — 프로젝트 섹션 ↔ 요약카드 상하 분할 핸들. */
  vTopHandleRef: RefObject<HTMLDivElement>;
  /** #browserProjectsSection — 프로젝트 섹션(top 핸들의 위쪽). */
  vProjectsRef: RefObject<HTMLDivElement>;
  /** #metaDocsFlowHandle — flow-region ↔ 카탈로그 상하 분할 핸들. */
  flowHandleRef: RefObject<HTMLDivElement>;
  /** .meta-docs-catalog-area — flow 핸들의 아래쪽(카탈로그 영역). */
  catalogAreaRef: RefObject<HTMLDivElement>;
}

/**
 * metadocs 모드 좌측 패널·flow 리사이저 훅 — 레거시 미결선 2핸들을 browse 와 동일 메커니즘으로 결선.
 *  - #panelVerticalHandle: 프로젝트 섹션 ↔ 요약카드(원본 initPanelVerticalResize, --projects-panel-height /
 *    spyglass:panel-split). computeAvailable 의 metadocs 분기가 .left-panel 전체 높이로 clamp 범위를 확보한다.
 *  - #metaDocsFlowHandle: flow-region ↔ 카탈로그(원본 initMetaDocsFlowResize, --meta-docs-flow-height /
 *    spyglass:meta-docs-flow-split). topEl(#metaDocsFlowRegion)은 MetaDocsFlow 소유라 id 셀렉터로 resolve.
 *
 * browse 의 usePanelResize 와 동일한 wireVerticalHandle 을 재사용하므로 시그니처/동작은 변하지 않는다.
 */
export function useMetaDocsPanelResize(): UseMetaDocsPanelResizeRefs {
  const panelRef = useRef<HTMLElement>(null);
  const widthHandleRef = useRef<HTMLDivElement>(null);
  const vTopHandleRef = useRef<HTMLDivElement>(null);
  const vProjectsRef = useRef<HTMLDivElement>(null);
  const flowHandleRef = useRef<HTMLDivElement>(null);
  const catalogAreaRef = useRef<HTMLDivElement>(null);

  // ── 수평 너비 드래그 + 더블클릭 Auto-fit(원본 initPanelResize) — browse 와 동일 wireWidthHandle SSoT.
  //   metadocs 좌측 패널 너비 resize 회귀(핸들 미렌더) 복원: layout.css 가 --left-panel-width 를 모드 무관
  //   적용하므로 browse 와 동일 메커니즘으로 결선된다. ──
  useEffect(() => {
    const panel = panelRef.current;
    const handle = widthHandleRef.current;
    if (!panel || !handle) return;
    return wireWidthHandle(panel, handle);
  }, []);

  // ── 프로젝트 섹션 ↔ 요약카드(원본 initPanelVerticalResize, metadocs 좌측). ──
  //   bottomEl(요약카드)은 MetaDocsSummaryCards 소유(#metaDocsSummaryCards)라 id 로 resolve.
  //   metadocs 모드에서는 computeAvailable 이 .left-panel 전체 높이를 쓰므로 bottomEl 은 null-check 용.
  useEffect(() => {
    const handle = vTopHandleRef.current;
    const topEl = vProjectsRef.current;
    const bottomEl = document.getElementById(META_SUMMARY_ID) as HTMLElement | null;
    if (!handle || !topEl || !bottomEl) return;
    return wireVerticalHandle(handle, topEl, bottomEl, PROJECTS_HEIGHT_VAR, SPLIT_TOP_STORAGE_KEY);
  }, []);

  // ── flow-region ↔ 카탈로그(원본 initMetaDocsFlowResize). topEl 은 MetaDocsFlow 소유라 id 로 resolve. ──
  //   카탈로그(catalogArea) 마운트 후에 발화. flow region 이 아직 없으면(미발화) no-op 후 정리.
  useEffect(() => {
    const handle = flowHandleRef.current;
    const bottomEl = catalogAreaRef.current;
    const topEl = document.getElementById(META_FLOW_REGION_ID) as HTMLElement | null;
    if (!handle || !topEl || !bottomEl) return;
    return wireVerticalHandle(handle, topEl, bottomEl, META_FLOW_HEIGHT_VAR, META_FLOW_STORAGE_KEY);
  }, []);

  return { panelRef, widthHandleRef, vTopHandleRef, vProjectsRef, flowHandleRef, catalogAreaRef };
}
