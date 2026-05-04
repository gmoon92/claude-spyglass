// views/default/feed-live.js — 피드 라이브 upsert (B축)
//
// 변경 이유: SSE로 들어온 단일 request를 피드 테이블에 prepend / in-place 업데이트
// 하는 정책. 행 cap, flash 지속시간 같은 매직 넘버는 이 파일 상단에서만 의미가
// 있으므로 여기 const로 둔다 (constants.js 로 끌어올리지 않음).

import { makeRequestRow } from '../../renderers.js';
import {
  addScrollLockCount, updateScrollLockBanner, resetScrollLockCount,
} from '../../infra.js';
import { FEED_UPDATED } from '../../events.js';

// 피드 테이블에 유지할 최대 행 수. 초과 시 가장 오래된 행부터 제거.
const FEED_ROW_CAP = 200;
// 같은 id 행이 'updated' phase 로 갱신될 때 잠깐 입히는 펄스 지속시간(ms).
const ROW_FLASH_DURATION_MS = 600;

/**
 * 전체 피드 행 upsert (ADR-002/007).
 *
 * 같은 `r.id`의 행이 이미 있으면 셀 단위 outerHTML 교체로 in-place 갱신
 * (행 통째 교체는 expand row 형제를 유실시키기 때문).
 *
 * - `event_phase: 'updated'`인 경우(backfill 등): 위치·expand row 그대로 보존하고 셀만 교체
 * - 신규 행: 최상단에 prepend
 *
 * 셀 갱신 범위: `data-cell="time|action|target|model|msg|in|out|cache|duration|sess"`
 * 모든 셀을 다시 만들어 교체. 셀 빌더는 SSoT(`makeRequestRow` 내부와 동일).
 */
export function prependRequest(r) {
  const body      = document.getElementById('requestsBody');
  const feedBody  = document.getElementById('feedBody');
  const isNearTop = !feedBody || feedBody.scrollTop < 80;

  const prevScrollTop    = feedBody ? feedBody.scrollTop    : 0;
  const prevScrollHeight = feedBody ? feedBody.scrollHeight : 0;

  // 같은 request ID의 기존 행이 있으면 셀 단위 in-place 갱신 (ADR-007)
  if (r.id) {
    const existing = body.querySelector(`tr[data-request-id="${CSS.escape(r.id)}"]`);
    if (existing) {
      replaceRowCells(existing, r);
      // event_phase: 'updated'면 시각 hint를 위해 잠깐 펄스
      if (r.event_phase === 'updated') {
        existing.classList.add('row-flash-update');
        setTimeout(() => existing.classList.remove('row-flash-update'), ROW_FLASH_DURATION_MS);
      }
      // ADR-011: 인플레이스 업데이트 후 anomaly 재적용
      reapplyFeedAnomalies();
      document.dispatchEvent(new CustomEvent(FEED_UPDATED));
      return;
    }
  }
  while (body.rows.length >= FEED_ROW_CAP) body.deleteRow(body.rows.length - 1);
  const tmp = document.createElement('tbody');
  tmp.innerHTML = makeRequestRow(r, { showSession: true });
  body.insertBefore(tmp.firstElementChild, body.firstChild);

  if (!isNearTop && feedBody) {
    const addedHeight = feedBody.scrollHeight - prevScrollHeight;
    feedBody.scrollTop = prevScrollTop + addedHeight;
    addScrollLockCount();
    updateScrollLockBanner();
  } else {
    resetScrollLockCount();
    updateScrollLockBanner();
  }
  // ADR-011: 새 행에 anomaly 즉시 반영
  reapplyFeedAnomalies();
  // 스크롤 조정 완료 후 검색·유형 필터 재적용
  document.dispatchEvent(new CustomEvent(FEED_UPDATED));
}

/**
 * 기존 `<tr>` 안의 셀들을 새 데이터로 갱신.
 *
 * outerHTML 통째 교체 대신 새 행을 만들어 셀을 한 개씩 교체한다 (expand row 형제 보존, ADR-007).
 * 셀 매칭 키는 `data-cell="time|action|target|model|msg|in|out|cache|duration|sess"`.
 *
 * 옵션 `showSession`은 컨테이너에 따라 유추 — 기존 행에 .cell-sess가 있으면 true.
 */
function replaceRowCells(existing, r) {
  const showSession = !!existing.querySelector('.cell-sess');
  const tmp = document.createElement('tbody');
  tmp.innerHTML = makeRequestRow(r, { showSession });
  const fresh = tmp.firstElementChild;
  if (!fresh) return;

  // 행 자체 속성 갱신 (data-type, data-trust 등)
  for (const attr of ['data-type', 'data-sub-type', 'data-trust', 'class']) {
    const v = fresh.getAttribute(attr);
    if (v != null) existing.setAttribute(attr, v);
  }

  // 셀 단위 교체 — fresh의 각 [data-cell]을 existing의 동일 키 셀과 swap.
  fresh.querySelectorAll('[data-cell]').forEach((newCell) => {
    const key = newCell.getAttribute('data-cell');
    const oldCell = existing.querySelector(`[data-cell="${CSS.escape(key)}"]`);
    if (oldCell) oldCell.outerHTML = newCell.outerHTML;
  });
}

export function reapplyFeedAnomalies() {
  // 별도 작업 없음. 실제 anomaly는 다음 fetchRequests 응답 시 적용된다.
}
