/**
 * features/meta-docs/flow-types.ts — Flow 공유 타입 + activeRow→args 순수 변환 (xyflow 재작성)
 *
 * MetaDocsFlow(본체) / FlowNodeCard(노드 컴포넌트) / MetaDocsLayout(소비처)이 공유하는 경량 계약을
 *   순환 import 없이 두기 위한 leaf 모듈. 과거 MetaDocsFlow.tsx 에 있던 정의를 이관(계약 동일).
 *
 * @module features/meta-docs/flow-types
 */

/** 활성 flow 행(카탈로그가 통지하는 단방향 계약값). */
export interface FlowActiveRow {
  type: string | null | undefined;
  name: string;
  id?: number | null;
}

/** loadFlow 인자(원본 flow.js:146 args). */
export interface FlowArgs {
  centerKind: string;
  centerName: string;
  project: string | null;
  depth: number;
}

/**
 * 활성 행 → loadFlow args 변환(순수, catalog→flow 계약 SSoT).
 * name/type 만 필요 — orphan(id null) 무시는 catalog 책임(arch §2.2).
 */
export function activeRowToFlowArgs(row: FlowActiveRow | null, project: string | null, depth = 3): FlowArgs | null {
  if (!row || !row.name || !row.type) return null;
  return { centerKind: String(row.type), centerName: String(row.name), project: project ?? null, depth };
}
