// view-types.ts — 웹 렌더 계층의 "wire row 뷰" 타입 (P5-03).
//
// 목적: assets/js 렌더 함수들이 소비하는 행 객체는 @spyglass/types 의 SSoT
//   (NormalizedRequest / Session / *Field) 를 **그대로** 받되, 서버가 wire 단계에서
//   덧붙이는 소수의 추가 필드를 포함한다. SSoT 를 재선언하지 않고 import + 합성한다.
//   (src/schema 의 .passthrough() 와 동일 의도 — 알려진 핵심 필드 + 후방호환 여분.)
//
// 추가 필드 근거(소스에서 실제 접근하는 것만):
//   - RequestView.project_name : /api/requests 응답이 세션 join 으로 덧붙이는 표시용 컬럼
//     (render/rows.ts:56 data-goto-project, api.ts fetchRequests 행).
//   - *Field.status            : anomaly 필드의 legacy 별칭. 서버 컨트랙트는 `stage`(ADR-003)
//     이나 과거 `status` 응답 호환을 위해 `stage ?? status` 로 읽는다
//     (render/badges.ts:180/187/263/291, rows.ts:77). 별칭은 optional 로만 둔다.

import type {
  NormalizedRequest,
  BloatedSysField,
  AgentSpikeField,
  Session,
} from '@spyglass/types';

/** anomaly 필드 legacy 별칭(`status`)을 optional 로 덧댄 뷰. 서버는 `stage` 를 SSoT 로 보낸다. */
export type BloatedSysView = BloatedSysField & { status?: BloatedSysField['stage'] };
export type AgentSpikeView = AgentSpikeField & { status?: AgentSpikeField['stage'] };

/**
 * 렌더 계층이 받는 요청 행 뷰.
 * NormalizedRequest(SSoT) + wire 표시 필드(project_name) + anomaly 별칭 뷰.
 * 모든 추가 필드는 optional — prompt 외 행/구버전 응답에서 누락 가능.
 */
export interface RequestView extends Omit<NormalizedRequest, 'bloated_sys' | 'agent_spike'> {
  project_name?: string | null;
  bloated_sys?: BloatedSysView | null;
  agent_spike?: AgentSpikeView | null;
  /**
   * wire 편의 필드 — payload.tool_input 의 파싱본을 서버가 풀어 둘 수 있다(예: subagent_type/skill).
   * raw 는 payload 문자열 안에 있으나 일부 응답은 tool_input 을 풀어 보낸다 → optional unknown.
   */
  tool_input?: Record<string, unknown> | null;
  /** SSE new_request 메타 — 첫 노출('created') vs in-place 갱신('updated'). 라이브 upsert 분기용. */
  event_phase?: 'created' | 'updated';
}

/**
 * context-saturation anomaly 뷰 — @spyglass/types 에 SSoT 가 없는 web 전용 표지 데이터.
 * 서버 detectContextSaturation 응답을 stage/pct 두 필드만 소비(render/badges.ts).
 */
export interface ContextSaturationView {
  stage?: 'warn' | 'critical' | null;
  pct?: number | null;
}

/** 사이드바/세션 행 뷰 — Session SSoT 그대로. bloated_sys 캐시 주입분만 optional 추가. */
export interface SessionView extends Session {
  bloated_sys?: BloatedSysView | null;
}

/**
 * 좌측 패널 프로젝트 집계 행 — /api/dashboard projects[] 의 표시용 형태.
 * @spyglass/types 에 도메인 SSoT 가 없는 web 집계(project_name + 누적 토큰 + 활성 수).
 */
export interface ProjectRow {
  project_name?: string;
  total_tokens?: number;
  active_count?: number;
}

// =============================================================================
// 구조적 reader 계약 — 렌더/판별 함수의 "읽는 표면" 최소 계약
//
// render/badges·request-types 등의 함수는 assets/js 렌더 경로(RequestView)와
// src React 경로(각 컴포넌트의 로컬 RowLike: 느슨한 optional 필드 + index signature)
// 양쪽에서 호출된다. NormalizedRequest 파생 Pick 은 src 의 느슨한 형태와 구조 불일치를
// 일으키므로(예: type?: string vs RequestType), 함수 인자는 "실제로 읽는 필드만" 담은
// 느슨한 구조 계약으로 받는다. RequestView 와 src RowLike 가 모두 이 계약을 만족한다.
// =============================================================================

/**
 * subTypeOf / isAnchorTool 등 tool_name·type 만 읽는 판별 함수의 입력 계약.
 * 필드를 unknown 으로 두고 index signature 를 포함해, strict RequestView 와
 * 느슨한 src RowLike(`[k]:unknown` 만 가진 형태) 양쪽을 모두 수용한다(TS2559 회피).
 * 함수 내부에서 문자열로 좁힌다(런타임 동일).
 */
export interface RowKindReader {
  type?: unknown;
  tool_name?: unknown;
}

/** payload·tool_name 으로 tool_response 를 읽는 함수(toolStatusBadge/toolResponseHint)의 입력 계약. */
export interface RowResponseReader {
  payload?: unknown;
  tool_name?: string | null;
}

/** subTypeBadgeHtml 의 입력 계약 — 칩 라벨/딥링크에 쓰는 필드. */
export interface RowChipReader {
  tool_name?: string | null;
  tool_detail?: string | null;
  tool_input?: Record<string, unknown> | null;
  [k: string]: unknown;
}

/**
 * render/cells.ts 의 셀 빌더 입력 계약 — type, tool_name/tool_detail, model, event_type, cache 토큰, agent_spike 를 읽는다.
 * strict RequestView 와 느슨한 src 행(turn-views RequestRowLike) 양쪽을 수용하도록 모두 optional.
 * 인덱스 시그니처는 두지 않는다(concrete RequestView 비할당 회피).
 */
export interface RowCellReader {
  type?: unknown;
  tool_name?: string | null;
  tool_detail?: string | null;
  model?: string | null;
  event_type?: string | null;
  payload?: unknown;
  agent_spike?: unknown;
  cache_read_tokens?: number;
  cache_creation_tokens?: number;
}

/**
 * render/extract.ts 의 텍스트 추출 함수 입력 계약 — payload/preview/tool_* 를 읽는다.
 * 필드를 모두 optional + unknown 으로 두어 strict RequestView 와 느슨한 src 객체 리터럴
 * (turn-haystack 의 `{payload: unknown, ...}`) 양쪽을 모두 수용한다. 내부에서 좁힌다.
 * 인덱스 시그니처는 두지 않는다(concrete RequestView 비할당 회피 — TS strict).
 */
export interface RowTextReader {
  id?: string | null;
  type?: unknown;
  tool_name?: string | null;
  tool_detail?: string | null;
  payload?: unknown;
  preview?: unknown;
}

/** anomaly stage 만 읽는 loose 필드 뷰(서버 응답 필드). */
export interface StageField { stage?: string | null }

/**
 * getAnomalyFlagsForRow 입력 계약 — 행의 anomaly 필드(stage)만 읽는다.
 * 모두 optional 로 두어 RequestView 와 src 의 느슨한 RowLike 양쪽을 수용한다.
 */
export interface RowAnomalyReader {
  bloated_sys?: StageField | null;
  agent_spike?: StageField | null;
  spike?: StageField | null;
  loop?: StageField | null;
  slow?: StageField | null;
}
