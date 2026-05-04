// 행/리스트 빌더 — request row, session row, 리스트 렌더/append.
//
// 변경 이유: 행 컬럼 구성·순서·뷰 변형(전체 피드 vs 세션 flat) 변경 시 묶여서 손이 가는 묶음.

import { escHtml, fmtToken, fmtRelative, formatDuration, fmtTimestamp } from '../formatters.js';
import { subTypeOf } from '../request-types.js';
import { anomalyBadgesHtml } from './badges.js';
import { trustOf, rowTrustClass, makeModelCell } from './model.js';
import { makeActionCell, makeTargetCell, makeCacheCell } from './cells.js';
import { contextPreview, extractFirstPrompt } from './extract.js';
import { RECENT_REQ_COLS } from './expand.js';

/**
 * 단일 행 진입점 (table 변형) — 전체 피드 + 세션 flat 뷰 공용 (ADR-005).
 *
 * 모든 td에 `data-cell` 속성을 부여해 SSE in-place 갱신 시 셀 단위로 교체할 수 있도록 한다 (ADR-007).
 * 셀 빌더(`makeActionCell`/`makeTargetCell`/`makeModelCell`/`makeCacheCell`)는 SSoT —
 * turn 변형(`makeTurnRow`)도 동일 빌더를 호출하여 분기 일치 보장.
 */
export function makeRequestRow(r, opts = {}) {
  const fmtTs  = opts.fmtTime || fmtTimestamp;
  const flags  = opts.anomalyFlags || null;
  const sessTd = opts.showSession
    ? `<td class="cell-sess" data-cell="sess"><span class="sess-id sess-id-link" data-goto-session="${escHtml(r.session_id||'')}" data-goto-project="${escHtml(r.project_name||'')}" title="${escHtml(r.session_id||'')}">${r.session_id ? r.session_id.slice(0,12)+'…' : '—'}</span></td>`
    : '';
  // ADR-row-empty-msg-001: 메시지가 없는 행(예: TaskList, 인자 없는 도구 등)은
  // dash('—') 대신 빈 셀로 노출. 사용자 피드백: dash가 시각 노이즈만 만들고 정보 가치 0.
  // 다만 빈 span은 a11y용으로 유지 (스크린리더/aria 라벨 보존).
  const msgPreview = contextPreview(r);
  const msgHtml    = msgPreview
    ? msgPreview
    : `<span class="cell-msg-empty" aria-label="메시지 없음"></span>`;

  const spikeLoopBadges = flags ? anomalyBadgesHtml(new Set([...flags].filter(f => f !== 'slow'))) : '';
  const slowBadge       = flags && flags.has('slow') ? `<span class="mini-badge badge-slow" data-mini-badge-tooltip="slow">slow</span>` : '';

  const trustCls = rowTrustClass(r);
  return `<tr class="${trustCls.trim()}" data-type="${escHtml(r.type||'')}" data-sub-type="${subTypeOf(r)}" data-trust="${trustOf(r)}" data-request-id="${escHtml(r.id||'')}">
    <td class="cell-time num" data-cell="time">${fmtTs(r.timestamp)}</td>
    <td class="cell-action" data-cell="action">${makeActionCell(r)}</td>
    ${makeTargetCellWithBadges(r, spikeLoopBadges)}
    ${makeModelCell(r)}
    <td class="cell-msg" data-cell="msg">${msgHtml}</td>
    <td class="cell-token num" data-cell="in">${r.tokens_input  > 0 ? fmtToken(r.tokens_input)  : '—'}</td>
    <td class="cell-token num" data-cell="out">${r.tokens_output > 0 ? fmtToken(r.tokens_output) : '—'}</td>
    ${makeCacheCell(r)}
    <td class="cell-token num" data-cell="duration">${formatDuration(r.duration_ms)}${slowBadge}</td>
    ${sessTd}
  </tr>`;
}

function makeTargetCellWithBadges(r, extraBadges) {
  if (!extraBadges) return makeTargetCell(r);
  const base = makeTargetCell(r);
  // </td> 직전에 배지 삽입
  return base.replace(/<\/td>$/, `${extraBadges}</td>`);
}

// LIVE 술어 stale 임계값 — storage/_shared.ts의 LIVE_STALE_THRESHOLD_MS와 동일 값.
// (web은 storage 패키지를 직접 import 하지 않으므로 클라 측 상수로 미러. 변경 시 양쪽 함께 수정.)
const LIVE_STALE_THRESHOLD_MS = 30 * 60 * 1000;

export function makeSessionRow(s, isSelected) {
  // 사이드바 활성도 마커 — 헤더 LIVE 카운트와 동일 정의 공유.
  //   ● active : ended_at 없음 + 직전 30분 이내 activity 있음
  //   ◐ stale  : ended_at 없음 + 직전 30분 이상 activity 없음 (SessionEnd 누락 의심)
  //   ○ ended  : ended_at 있음 (정상 종료)
  // stale은 reactivateSession 흐름에서 새 hook 도달 시 자동 ●로 복귀한다 (DB UPDATE 없음).
  const lastAct = s.last_activity_at || s.started_at || 0;
  const sinceLastMs = Date.now() - lastAct;
  let statusGlyph;
  let statusCls;
  let statusTitle;
  if (s.ended_at) {
    statusGlyph = '○';
    statusCls = '';
    statusTitle = '종료된 세션';
  } else if (sinceLastMs > LIVE_STALE_THRESHOLD_MS) {
    statusGlyph = '◐';
    statusCls = ' stale';
    statusTitle = `stale — 30분 이상 활동 없음 (SessionEnd 누락 의심)`;
  } else {
    statusGlyph = '●';
    statusCls = ' active';
    statusTitle = '라이브 세션';
  }
  const shortId  = s.id.slice(0, 8);
  const preview  = extractFirstPrompt(s.first_prompt_payload);
  const rel      = fmtRelative(s.started_at);
  return `<tr class="clickable${isSelected ? ' row-selected' : ''}" data-session-id="${escHtml(s.id)}">
    <td colspan="4" class="sess-row-cell" style="padding:5px 10px">
      <div class="sess-row-header">
        <span class="sess-id" title="${escHtml(s.id)}">${escHtml(shortId)}</span>
        <span class="sess-row-time">${rel}</span>
        <span class="sess-row-tokens">${fmtToken(s.total_tokens)}</span>
        <span class="sess-row-status${statusCls}" title="${statusTitle}">${statusGlyph}</span>
      </div>
      ${preview ? `<div class="sess-row-preview" title="${escHtml(preview)}">${escHtml(preview)}</div>` : ''}
    </td>
  </tr>`;
}

export function renderRequests(container, list, anomalyMap = new Map()) {
  if (!list.length) {
    container.innerHTML = `<tr><td colspan="${RECENT_REQ_COLS}" class="table-empty">데이터가 없습니다</td></tr>`;
    return;
  }
  container.innerHTML = list.map(r => makeRequestRow(r, { showSession: true, anomalyFlags: anomalyMap.get(r.id) || null })).join('');
}

export function appendRequests(container, list, anomalyMap = new Map()) {
  if (!list.length) return;
  container.insertAdjacentHTML('beforeend', list.map(r => makeRequestRow(r, { showSession: true, anomalyFlags: anomalyMap.get(r.id) || null })).join(''));
}
