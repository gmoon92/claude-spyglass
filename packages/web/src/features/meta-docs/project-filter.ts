/**
 * features/meta-docs/project-filter.ts — 메타 문서 카탈로그 프로젝트 필터 (순수)
 *
 * 동기: 서버 /api/meta-docs 의 `project` 파라미터는 usage(invocations) 집계만 sessions JOIN 으로
 *   좁히고, 카탈로그 "행 목록" 자체는 모든 source_root 를 그대로 반환한다(meta-docs-project-filter-parity).
 *   그래서 좌측에서 특정 프로젝트(예: claude-spyglass)를 선택해도 다른 프로젝트 경로(rv-iso/rview)의
 *   동명 문서(commit 등)가 카탈로그에 섞여 노출됐다. 본 모듈이 source_root 경로 기준으로 행을 좁힌다.
 *
 * 규칙(특정 프로젝트 선택 시):
 *  - 프로젝트 소속 문서: source_root basename === selectedProject 인 행.
 *  - 전역 문서(userSettings/built-in, source_root==null): 그 프로젝트에서 실제 호출된(invocations>0) 것만.
 *    (invocations 는 서버가 이미 project 로 좁혀 집계하므로, >0 이면 "이 프로젝트에서 쓰인 전역 도구".)
 *  - 다른 프로젝트 경로 문서(basename 불일치) / 미사용 전역 문서는 제외.
 *  전체/전역키(globalKey)·미선택(null) 이면 필터 없이 통과.
 *
 * isGlobalMetaDoc 판정은 MetaDocsLayout.computeMetaCounts 의 좌측 카운트 그룹핑과 동일 SSoT 여야
 *   카운트(좌측)와 노출 행(우측)이 어긋나지 않는다 — 본 모듈이 단일 출처.
 *
 * @module features/meta-docs/project-filter
 */
import type { MetaDocRow } from './meta-docs-sort';

/** 전역 문서(userSettings/built-in) 여부 — source==='userSettings' || source_root==null. */
export function isGlobalMetaDoc(row: Pick<MetaDocRow, 'source' | 'source_root'>): boolean {
  return row.source === 'userSettings' || row.source_root == null;
}

/** 행의 프로젝트 키(source_root basename). 전역 문서면 null. */
export function metaDocProjectKey(row: Pick<MetaDocRow, 'source' | 'source_root'>): string | null {
  if (isGlobalMetaDoc(row)) return null;
  const base = String(row.source_root).split('/').filter(Boolean).pop();
  return base || null;
}

/**
 * 선택 프로젝트로 카탈로그 행을 좁힌다. 전체/전역키/미선택이면 원본 그대로(복사본).
 * @param rows 서버 응답 카탈로그 행(전체 source_root).
 * @param selectedProject 좌측에서 선택한 프로젝트 basename(전체 보기면 globalKey/null).
 * @param globalKey 전체 보기를 뜻하는 키(GLOBAL_PROJECT_KEY).
 */
export function filterMetaDocsByProject(
  rows: ReadonlyArray<MetaDocRow>,
  selectedProject: string | null | undefined,
  globalKey: string,
): MetaDocRow[] {
  if (!selectedProject || selectedProject === globalKey) return rows.slice();
  return rows.filter((r) => {
    if (isGlobalMetaDoc(r)) return (r.invocations ?? 0) > 0;
    return metaDocProjectKey(r) === selectedProject;
  });
}
