// components/use-col-resize.ts — 테이블 컬럼 너비 드래그 리사이즈 훅 (vanilla→React 마이그레이션)
//
// 원본: assets/js/col-resize.js initColResize(tableEl) + assets/js/resize-utils.js measureMaxWidth.
//   - 각 thead th 우측에 `.col-resize-handle`(width:5px, position:absolute) 삽입.
//   - mousedown→드래그: col[i].style.width 직접 조정, 최소 32px clamp, 핸들에 `.dragging` 클래스.
//   - dblclick Auto-fit: 해당 컬럼 셀(th + tbody[0].rows[i])의 최대 scrollWidth + 16px(셀 좌우 패딩 여유),
//     최소 32px clamp. (resize-utils.js measureMaxWidth — scrollWidth 가 overflow:hidden 잘린 폭 포함.)
//
// React 이식 원칙(use-panel-resize.ts 선례 1:1):
//   - tableRef 로 <table> 을 받고, 불가피한 DOM 조작(핸들 삽입 / col width 세팅)은 useEffect 내부 한정.
//   - mousedown 시 document 에 mousemove/mouseup 리스너 부착, mouseup·언마운트 시 철저 cleanup.
//   - 셀렉터 계약(`.col-resize-handle`, `.dragging`) 보존 — table.css 가 동일 셀렉터로 스타일.
//
// 영속(원본 col-resize.js 에는 없던 신규 계약):
//   - opts.storageKey 로 테이블별 영속 분리. localStorage 'spyglass:col-width:<storageKey>' 에
//     col index→px JSON 맵 저장(panel-resize.js 의 'spyglass:' prefix 규약 1:1).
//   - 마운트 시 저장값 복원(col[i].style.width 재적용), 드래그/Auto-fit 종료 시 저장.
//   - storageKey 미지정 시 영속 비활성(복원·저장 모두 no-op) — 원본 동작과 동치.
//
// 원본 col-resize.js 가 `cols[i]`(<col>) 없으면 너비 미적용(no-op)인 동작을 그대로 보존한다.
// → 호출처는 <table> 에 <colgroup><col/>…</colgroup> 을 두어야 한다(원본 system-prompt-library.js 동일 전제).

import { useEffect } from 'react';
import type { RefObject } from 'react';

/** col-resize.js Math.max(32, …) — 컬럼 최소 너비(px). */
const MIN_COL_WIDTH = 32;

/** col-resize.js dblclick Auto-fit 셀 좌우 패딩(8px*2) 여유. */
const AUTOFIT_PADDING = 16;

/** localStorage 키 prefix — panel-resize.js 'spyglass:' 규약 1:1. */
const STORAGE_PREFIX = 'spyglass:col-width:';

export interface UseColResizeOptions {
  /**
   * 테이블별 영속 분리 키. 지정 시 localStorage 'spyglass:col-width:<storageKey>' 에
   * { [colIndex]: widthPx } 맵으로 저장/복원. 미지정 시 영속 비활성(원본 동작과 동치).
   */
  storageKey?: string;
}

/**
 * 가장 넓은 콘텐츠 너비(px) 반환 — resize-utils.js measureMaxWidth 1:1.
 * scrollWidth 는 overflow:hidden 으로 잘린 폭까지 포함하므로 별도 DOM 조작 불필요.
 */
function measureMaxWidth(elements: Iterable<HTMLElement>): number {
  let max = 0;
  for (const el of elements) max = Math.max(max, el.scrollWidth);
  return max;
}

/** localStorage 에서 col index→px 맵 복원(JSON 깨짐/부재 시 빈 맵). */
function loadWidths(storageKey: string | undefined): Record<number, number> {
  if (!storageKey) return {};
  try {
    const raw = localStorage.getItem(STORAGE_PREFIX + storageKey);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? (parsed as Record<number, number>) : {};
  } catch {
    return {};
  }
}

/** col index→px 맵을 localStorage 에 저장(storageKey 없으면 no-op). */
function saveWidths(storageKey: string | undefined, widths: Record<number, number>): void {
  if (!storageKey) return;
  try {
    localStorage.setItem(STORAGE_PREFIX + storageKey, JSON.stringify(widths));
  } catch {
    // quota/직렬화 실패는 무시(영속은 best-effort — 원본도 영속 없음).
  }
}

/**
 * 테이블 컬럼 너비 드래그 리사이즈 훅 — col-resize.js initColResize 1:1 이식.
 *
 * 사용:
 *   const tableRef = useRef<HTMLTableElement>(null);
 *   useColResize(tableRef, { storageKey: 'feed' });
 *   return (
 *     <table ref={tableRef}>
 *       <colgroup><col /><col /><col /></colgroup>
 *       <thead><tr><th>…</th>…</tr></thead>
 *       <tbody>…</tbody>
 *     </table>
 *   );
 *
 * - 마운트 시 각 thead th 우측에 `.col-resize-handle` 삽입 + 저장값 복원.
 * - 드래그(mousedown→mousemove)로 col[i] 너비 조절(최소 32px), 핸들 `.dragging` 토글.
 * - dblclick 으로 해당 컬럼 Auto-fit(최대 콘텐츠 너비 + 16px, 최소 32px).
 * - 언마운트 시 삽입한 핸들 제거 + 모든 리스너 해제(철저 cleanup).
 *
 * @param tableRef 대상 <table> 의 ref(또는 콜백 ref 로 동일 요소를 가리키는 RefObject)
 * @param opts     storageKey(테이블별 영속 분리). 미지정 시 영속 비활성.
 */
export function useColResize(
  tableRef: RefObject<HTMLTableElement>,
  opts?: UseColResizeOptions,
): void {
  const storageKey = opts?.storageKey;

  useEffect(() => {
    const tableEl = tableRef.current;
    if (!tableEl) return;

    const ths = Array.from(tableEl.querySelectorAll<HTMLTableCellElement>('thead th'));
    const cols = Array.from(tableEl.querySelectorAll<HTMLTableColElement>('col'));

    // 저장값 복원 — col[i].style.width 재적용(원본에는 없는 영속 신계약). idempotent.
    const widths = loadWidths(storageKey);
    for (const [idx, px] of Object.entries(widths)) {
      const i = Number(idx);
      if (cols[i] && Number.isFinite(px)) {
        cols[i].style.width = `${Math.max(MIN_COL_WIDTH, px)}px`;
      }
    }

    /** 변경된 col 너비를 widths 맵에 반영 후 저장(영속 SSoT 갱신). */
    const persist = (i: number, px: number): void => {
      widths[i] = px;
      saveWidths(storageKey, widths);
    };

    // 마운트 시 부착한 (handle, mousedown, dblclick) 들을 cleanup 에서 일괄 해제하기 위해 추적.
    const attached: Array<{
      handle: HTMLDivElement;
      th: HTMLTableCellElement;
      onMouseDown: (e: MouseEvent) => void;
      onDblClick: (e: MouseEvent) => void;
    }> = [];
    // 드래그 중 document 에 부착되어 mouseup 전에 언마운트될 수 있는 리스너 추적(cleanup 안전).
    const docListeners: Array<{ type: 'mousemove' | 'mouseup'; fn: (e: MouseEvent) => void }> = [];

    const addDocListener = (type: 'mousemove' | 'mouseup', fn: (e: MouseEvent) => void): void => {
      document.addEventListener(type, fn);
      docListeners.push({ type, fn });
    };
    const removeDocListeners = (): void => {
      for (const { type, fn } of docListeners) document.removeEventListener(type, fn);
      docListeners.length = 0;
    };

    ths.forEach((th, i) => {
      const handle = document.createElement('div');
      handle.className = 'col-resize-handle';
      th.appendChild(handle);

      // 드래그 리사이즈 — col-resize.js mousedown 1:1(최소 32px clamp).
      const onMouseDown = (e: MouseEvent): void => {
        e.preventDefault();
        e.stopPropagation();
        const startX = e.clientX;
        const startW = th.getBoundingClientRect().width;
        handle.classList.add('dragging');

        const onMove = (ev: MouseEvent): void => {
          const newW = Math.max(MIN_COL_WIDTH, startW + (ev.clientX - startX));
          if (cols[i]) cols[i].style.width = `${newW}px`;
        };
        const onUp = (): void => {
          handle.classList.remove('dragging');
          removeDocListeners();
          // 드래그 종료 시점의 실제 col 너비를 영속(없으면 미저장).
          if (cols[i]) persist(i, parseFloat(cols[i].style.width) || cols[i].getBoundingClientRect().width);
        };

        addDocListener('mousemove', onMove);
        addDocListener('mouseup', onUp);
      };

      // 더블클릭 Auto-fit — col-resize.js dblclick 1:1(최대 콘텐츠 너비 + 16px, 최소 32px).
      const onDblClick = (e: MouseEvent): void => {
        e.preventDefault();
        e.stopPropagation();
        if (!cols[i] || !tableEl.tBodies[0]) return;
        const cells = [
          th,
          ...Array.from(tableEl.tBodies[0].rows).map((row) => row.cells[i]),
        ].filter(Boolean) as HTMLElement[];
        const maxW = measureMaxWidth(cells);
        const fitted = Math.max(MIN_COL_WIDTH, maxW + AUTOFIT_PADDING);
        cols[i].style.width = `${fitted}px`;
        persist(i, fitted);
      };

      handle.addEventListener('mousedown', onMouseDown);
      handle.addEventListener('dblclick', onDblClick);
      attached.push({ handle, th, onMouseDown, onDblClick });
    });

    return () => {
      removeDocListeners();
      for (const { handle, th, onMouseDown, onDblClick } of attached) {
        handle.removeEventListener('mousedown', onMouseDown);
        handle.removeEventListener('dblclick', onDblClick);
        if (handle.parentNode === th) th.removeChild(handle);
      }
    };
    // 빈 의존성: 마운트 1회 부착/복원, 언마운트 1회 cleanup. storageKey 는 마운트 시점 캡처.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
