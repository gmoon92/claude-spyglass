// @ts-check
// 테이블 셀 빌더 — Action / Target / Cache / Skeleton.
//
// 변경 이유: 셀 구조(td 클래스·data-cell·placeholder) 변경 시 묶여서 손이 가는 묶음.
// Wave 2: target-role-badge (targetInnerHtml) 는 Wave 3에서 ds-* 위임 예정 — 형식이 달라 별도 처리 필요.

import { escHtml, fmtToken, shortModelName } from '../formatters.js';
import { typeBadge, toolIconHtml, toolStatusBadge, agentSpikeBadgeHtml } from './badges.js';
import { skTableRows } from './skeleton.js';
import { svgToolDot } from '../design-system/icons/_index.js';
import type { RowCellReader } from '../view-types.js';

/**
 * 호환 wrapper — skeleton-loading T-03 (ADR-003).
 * 시그니처는 보존(cols: number, count: number)하고 본문은 skeleton.js 의
 * skTableRows 로 위임한다. 신규 호출은 가능한 skTableRows(colSpecs, count) 의
 * Array<%> 모드를 사용해 컬럼별 폭을 흉내내는 것을 권장.
 */
export function makeSkeletonRows(cols: number | Array<string | number>, count = 2) {
  return skTableRows(cols, count);
}

export function makeActionCell(r: RowCellReader) {
  return typeBadge(typeof r.type === 'string' ? r.type : '');
}

/**
 * Target 컬럼 내부 HTML (td 래퍼 없음) — 테이블/그리드 공용 재사용.
 *
 * 반환값: { html, empty } — empty=true면 호출자가 "—" 같은 빈 placeholder를 자유롭게 감쌈.
 *
 * 마크업 일관화 (#45 TG-A):
 *   prompt/response/system 행도 tool_call 과 동일하게 `target-cell-inner > action-name`
 *   구조로 통일. 이전엔 `target-role-badge.ds-chip` (padding 2px 7px) 을 사용해
 *   inner 컨텐츠 시작점이 td 좌측 padding 끝에서 +8px 안쪽으로 들어갔고, tool_call
 *   행(target-cell-inner, padding 0)과 좌측 정렬이 어긋났다.
 *
 *   색상 시그널은 보존: target-cell-inner.target-role-{user,assistant,system}
 *   modifier 가 .action-name 색상을 type-{prompt,response,system}-color 로 덮어쓴다
 *   (badges.css :: TARGET ROLE BADGE 섹션 참조).
 *
 * 호출자: rows.js :: makeTargetCellWithBadges, cells.js :: makeTargetCell
 */
export function targetInnerHtml(r: RowCellReader) {
  if (r.type === 'prompt') {
    return { html: `<span class="target-cell-inner target-role-user"><span class="action-name">${svgToolDot({ size: 12 })}user</span></span>`, empty: false };
  }
  if (r.type === 'response') {
    return { html: `<span class="target-cell-inner target-role-assistant"><span class="action-name">${svgToolDot({ size: 12 })}assistant</span></span>`, empty: false };
  }
  if (r.type === 'system') {
    return { html: `<span class="target-cell-inner target-role-system"><span class="action-name">${svgToolDot({ size: 12 })}system</span></span>`, empty: false };
  }
  if (r.type !== 'tool_call' || !r.tool_name) {
    return { html: '—', empty: true };
  }
  const inProgress = r.event_type === 'pre_tool';
  const icon = toolIconHtml(r.tool_name, r.event_type); // event_type 직접 전달
  let nameHtml;
  if ((r.tool_name === 'Skill' || r.tool_name === 'Agent') && r.tool_detail) {
    const ms = shortModelName(r.model);
    const modelBadge = ms ? ` <span class="action-model">${escHtml(ms)}</span>` : '';
    nameHtml = `<span class="action-name">${icon}${escHtml(r.tool_name)}(<span class="action-sub-name">${escHtml(r.tool_detail)}</span>)${modelBadge}</span>`;
  } else {
    nameHtml = `<span class="action-name">${icon}${escHtml(r.tool_name)}</span>`;
  }
  const statusBadge = inProgress ? '' : toolStatusBadge(r);
  // anomaly-bloated-sys T-15: Agent/Skill 부모 Target 셀 `↑×N` (N≥3) 표지.
  //   N<3은 기존 spike(↑) 유지 — 헬퍼가 '' 반환 시 자연 미적용.
  //   agent_spike 응답 필드가 없으면(트랙 A 진행 중) 빈 문자열 — 회귀 0.
  const agentSpike = agentSpikeBadgeHtml(r.agent_spike);
  return { html: `<span class="target-cell-inner">${nameHtml}${statusBadge}${agentSpike}</span>`, empty: false };
}

export function makeTargetCell(r: RowCellReader) {
  const { html, empty } = targetInnerHtml(r);
  return empty
    ? `<td class="cell-target cell-empty" data-cell="target">${html}</td>`
    : `<td class="cell-target" data-cell="target">${html}</td>`;
}

export function makeCacheCell(r: RowCellReader) {
  if (r.type !== 'prompt' || !r.cache_read_tokens || r.cache_read_tokens <= 0) {
    return `<td class="cell-token num cell-empty" data-cell="cache">—</td>`;
  }
  const readVal  = r.cache_read_tokens;
  const writeVal = r.cache_creation_tokens || 0;
  return `<td class="cell-token num cache-cell" data-cell="cache" data-cache-read="${readVal}" data-cache-write="${writeVal}">${fmtToken(readVal)}</td>`;
}
