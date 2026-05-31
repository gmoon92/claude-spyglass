// @ts-check
// 행/리스트 빌더 — request row, session row, 리스트 렌더/append.
//
// 변경 이유: 행 컬럼 구성·순서·뷰 변형(전체 피드 vs 세션 flat) 변경 시 묶여서 손이 가는 묶음.

import { escHtml, fmtToken, fmtRelative, formatDuration, fmtTimestamp } from '../formatters.js';
import { subTypeOf } from '../request-types.js';
import { anomalyBadgesHtml, bloatedSysBadgeDotHtml, bloatedSysBadgeMiniHtml } from './badges.js';
import { getBloatedSysFor } from '../state/anomaly-cache.js';
import { trustOf, rowTrustClass, makeModelCell } from './model.js';
import { makeActionCell, makeTargetCell, makeCacheCell } from './cells.js';
import { contextPreview, extractFirstPrompt, extractPromptText, extractAssistantText } from './extract.js';
import { RECENT_REQ_COLS } from './expand.js';
import { svgStatusActive, svgStatusStale, svgStatusEnded } from '../design-system/icons/_index.js';

/**
 * 검색 haystack SSoT — 행에 박을 `data-search-haystack` 속성용 문자열을 만든다.
 *
 * 포함 범위 (사용자 요구):
 *  - r.tool_name / r.tool_detail  — tool / Skill(...) / Agent(...) / MCP `mcp__server__tool`
 *  - r.model                       — Sonnet 4.6 등
 *  - r.type                        — prompt/tool_call/response/system (역할 검색)
 *  - body                          — extractPromptText / extractAssistantText 결과(payload 본문 전체)
 *  - r.preview                     — payload 파싱 실패 시 DB preview fallback
 *
 * 정책:
 *  - 모두 소문자로 normalize — 검색 측에서 소문자 substring 매칭만 하면 됨.
 *  - 길이 8KB 상한 — 매우 긴 payload는 검색 비용 보호 차원. 본문 앞부분(prompt 입력)이 검색의 99%.
 *
 * 외부에서 별도 검색용 인덱스를 두지 않는 이유: 행 자체가 SSoT이므로 SSE in-place 업데이트나
 * append 같은 비동기 렌더에도 row dataset이 자연스럽게 따라간다.
 */
function buildSearchHaystack(r: any) {
  const parts = [];
  if (r.tool_name)   parts.push(r.tool_name);
  if (r.tool_detail) parts.push(r.tool_detail);
  if (r.model)       parts.push(r.model);
  if (r.type)        parts.push(r.type);
  const body = r.type === 'response' ? extractAssistantText(r) : extractPromptText(r);
  if (body)          parts.push(body);
  if (r.preview && body !== r.preview) parts.push(r.preview);
  return parts.join(' ').toLowerCase().slice(0, 8000);
}

/**
 * 단일 행 진입점 (table 변형) — 전체 피드 + 세션 flat 뷰 공용 (ADR-005).
 *
 * 모든 td에 `data-cell` 속성을 부여해 SSE in-place 갱신 시 셀 단위로 교체할 수 있도록 한다 (ADR-007).
 * 셀 빌더(`makeActionCell`/`makeTargetCell`/`makeModelCell`/`makeCacheCell`)는 SSoT —
 * turn 변형(`makeTurnRow`)도 동일 빌더를 호출하여 분기 일치 보장.
 */
export function makeRequestRow(r: any, opts: { fmtTime?: any; anomalyFlags?: any; showSession?: boolean } = {}) {
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
    : `<span class="cell-msg-empty" aria-label="${window.I18n.t('session.rows.empty-message')}"></span>`;

  const spikeLoopBadges = flags ? anomalyBadgesHtml(new Set([...flags].filter(f => f !== 'slow'))) : '';
  const slowBadge       = flags && flags.has('slow') ? `<span class="mini-badge badge-slow" data-mini-badge-tooltip="slow">slow</span>` : '';

  // anomaly-bloated-sys T-14: 첫 prompt 행 mini 뱃지 + 행 단계 클래스.
  //   서버는 첫 prompt(또는 단일 prompt 세션의 유일 prompt)에 r.bloated_sys를 부착한다.
  //   prompt 외 행에는 응답 필드가 없거나 status='normal'이라 헬퍼가 빈 문자열 반환.
  const bloatedMini = bloatedSysBadgeMiniHtml(r.bloated_sys);
  // 행 시각 단계: warn → row-bloated-warn / critical → row-bloated-critical.
  // CSS에서 inset box-shadow 또는 border-left를 부여 (badges.css 참조).
  // 서버 컨트랙트는 `stage` (anomaly-bloated-sys ADR-003). 과거 `status` 별칭도 호환.
  let bloatedRowCls = '';
  const bsStage = r.bloated_sys?.stage ?? r.bloated_sys?.status;
  if (bsStage === 'warn')      bloatedRowCls = ' row-bloated-warn';
  else if (bsStage === 'critical') bloatedRowCls = ' row-bloated-critical';

  const trustCls = rowTrustClass(r);
  const haystack = buildSearchHaystack(r);
  const rowCls   = (trustCls + bloatedRowCls).trim();
  // mini 뱃지는 spike/loop 뱃지와 같이 Target 셀에 합류 (시각 위계 일관)
  const targetExtraBadges = spikeLoopBadges + bloatedMini;
  return `<tr class="${rowCls}" data-type="${escHtml(r.type||'')}" data-sub-type="${subTypeOf(r)}" data-trust="${trustOf(r)}" data-request-id="${escHtml(r.id||'')}" data-search-haystack="${escHtml(haystack)}">
    <td class="cell-time num" data-cell="time">${fmtTs(r.timestamp)}</td>
    <td class="cell-action" data-cell="action">${makeActionCell(r)}</td>
    ${makeTargetCellWithBadges(r, targetExtraBadges)}
    ${makeModelCell(r)}
    <td class="cell-msg" data-cell="msg">${msgHtml}</td>
    <td class="cell-token num" data-cell="in">${r.tokens_input  > 0 ? fmtToken(r.tokens_input)  : '—'}</td>
    <td class="cell-token num" data-cell="out">${r.tokens_output > 0 ? fmtToken(r.tokens_output) : '—'}</td>
    ${makeCacheCell(r)}
    <td class="cell-token num" data-cell="duration">${formatDuration(r.duration_ms)}${slowBadge}</td>
    ${sessTd}
  </tr>`;
}

function makeTargetCellWithBadges(r: any, extraBadges: any) {
  if (!extraBadges) return makeTargetCell(r);
  const base = makeTargetCell(r);
  // </td> 직전에 배지 삽입
  return base.replace(/<\/td>$/, `${extraBadges}</td>`);
}

export function makeSessionRow(s: any, isSelected: boolean) {
  // 사이드바 활성도 마커 — 서버가 결정한 live_state 단일 분기.
  //   ● live   : 라이브 세션 (storage._shared.buildLiveStateColumn에서 산출)
  //   ◐ stale  : SessionEnd 누락 의심 — reactivateSession 흐름에서 새 hook 도달 시 자동 ●로 복귀
  //   ○ ended  : 정상 종료 (ended_at IS NOT NULL)
  // 클라가 자체 시각으로 stale 판정하면 서버 권위와 어긋나므로 금지.
  // 구버전 응답(live_state 없음) 호환: ended_at만 보고 ●/○로 폴백.
  const liveState = s.live_state || (s.ended_at ? 'ended' : 'live');
  let statusGlyph, statusCls, statusTitle, statusTone;
  if (liveState === 'ended') {
    statusGlyph = svgStatusEnded({ size: 12 }); statusCls = ''; statusTitle = window.I18n.t('session.rows.status.ended'); statusTone = 'ended';
  } else if (liveState === 'stale') {
    statusGlyph = svgStatusStale({ size: 12 }); statusCls = ' stale'; statusTitle = window.I18n.t('session.rows.status.stale'); statusTone = 'stale';
  } else {
    statusGlyph = svgStatusActive({ size: 12 }); statusCls = ' active'; statusTitle = window.I18n.t('session.rows.status.live'); statusTone = 'active';
  }
  const shortId  = s.id.slice(0, 8);
  const preview  = extractFirstPrompt(s.first_prompt_payload);
  const rel      = fmtRelative(s.started_at);
  // anomaly-bloated-sys T-13: 사이드바 dot — critical만 노출 (ADR-005).
  //   서버 응답에 bloated_sys 필드가 없거나 status='normal'/'warn'이면 빈 문자열.
  //   warn 단계는 정책상 사이드바 노이즈 회피를 위해 미노출.
  //   /api/sessions 목록 응답엔 bloated_sys가 없으므로 detail-view.js의 단건 fetch 캐시를 우선 참조.
  //   `_allSessions` 리로드(SSE/refresh)로 s.bloated_sys 주입이 사라져도 dot이 유지된다.
  const bloatedDot = bloatedSysBadgeDotHtml(s.bloated_sys || getBloatedSysFor(s.id));
  return `<tr class="clickable${isSelected ? ' row-selected' : ''}" data-session-id="${escHtml(s.id)}">
    <td colspan="4" class="sess-row-cell" style="padding:5px 10px">
      <div class="sess-row-header">
        <span class="sess-id" title="${escHtml(s.id)}">${escHtml(shortId)}</span>
        <span class="sess-row-time">${rel}</span>
        <span class="sess-row-tokens">${fmtToken(s.total_tokens)}</span>
        <span class="sess-row-status${statusCls} ds-dot" data-tone="${statusTone}" data-size="md" title="${statusTitle}">${statusGlyph}</span>
        ${bloatedDot}
      </div>
      ${preview ? `<div class="sess-row-preview" title="${escHtml(preview)}">${escHtml(preview)}</div>` : ''}
    </td>
  </tr>`;
}

export function renderRequests(container: HTMLElement, list: any[], anomalyMap = new Map()) {
  if (!list.length) {
    container.innerHTML = `<tr><td colspan="${RECENT_REQ_COLS}" class="table-empty">${window.I18n.t('session.rows.no-data')}</td></tr>`;
    return;
  }
  container.innerHTML = list.map((r: any) => makeRequestRow(r, { showSession: true, anomalyFlags: anomalyMap.get(r.id) || null })).join('');
}

export function appendRequests(container: HTMLElement, list: any[], anomalyMap = new Map()) {
  if (!list.length) return;
  container.insertAdjacentHTML('beforeend', list.map((r: any) => makeRequestRow(r, { showSession: true, anomalyFlags: anomalyMap.get(r.id) || null })).join(''));
}
