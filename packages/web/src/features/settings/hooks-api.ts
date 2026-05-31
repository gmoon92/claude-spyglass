/**
 * features/settings/hooks-api.ts — /api/settings/* fetch 핸들러 (P2-06)
 *
 * 원본: settings-view.js 의 diag fetch(:181) + onHookPreview(:522) + onHookApply(:536) +
 *   bindUndoButton restore(:621) 의 *네트워크 부* 만 추출. UI 렌더(innerHTML)와 분리해
 *   apiFetch mock 으로 단위 테스트 가능하게 한다(tasks.json:323).
 *
 * 계약(원본 1:1):
 *   - 응답 envelope `{ success, data?, error? }`. success=false → Error(error||기본메시지) throw.
 *   - fetchDiag 는 AbortSignal 수용 — sub-tab 전환/언마운트 시 in-flight 무시(§5.1 신계약).
 *     (원본은 _generation 카운터로 stale setState 가드 :177,186 — React 에선 AbortController.)
 */

import type { DiagData, HookApplyData, HookPreviewData, HookProfile, HookRestoreData } from './types';

/** 응답 envelope 공통 형태(api.js 전반과 동일 — success/data/error). */
interface Envelope<T> {
  success: boolean;
  data?: T;
  error?: string;
}

/** envelope 검사 후 data 추출 — success=false 면 throw(원본 :183,524,542,627). */
async function unwrap<T>(res: Response, fallbackMsg: string): Promise<T> {
  const json = (await res.json()) as Envelope<T>;
  if (!json.success) throw new Error(json.error || fallbackMsg);
  return json.data as T;
}

/**
 * GET /api/settings/diag — 전체 진단(diag/hooks/server 공유 소스, 원본 :181).
 * @param signal AbortSignal — 전환/언마운트 cleanup(§5.1).
 */
export async function fetchDiag(signal?: AbortSignal): Promise<DiagData> {
  const res = await fetch('/api/settings/diag', signal ? { signal } : undefined);
  return unwrap<DiagData>(res, 'diag fetch failed');
}

/** GET /api/settings/hooks/preview?profile= — diff 미리보기(원본 :522). */
export async function hookPreview(profile: HookProfile, signal?: AbortSignal): Promise<HookPreviewData> {
  const res = await fetch(
    `/api/settings/hooks/preview?profile=${encodeURIComponent(profile)}`,
    signal ? { signal } : undefined,
  );
  return unwrap<HookPreviewData>(res, 'preview failed');
}

/** POST /api/settings/hooks/apply — 프로필 적용(원본 :536). body { profile }. */
export async function hookApply(profile: HookProfile): Promise<HookApplyData> {
  const res = await fetch('/api/settings/hooks/apply', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ profile }),
  });
  return unwrap<HookApplyData>(res, 'apply failed');
}

/** POST /api/settings/hooks/restore — 백업 복구(원본 :621). body { backupPath }. */
export async function hookRestore(backupPath: string): Promise<HookRestoreData> {
  const res = await fetch('/api/settings/hooks/restore', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ backupPath }),
  });
  return unwrap<HookRestoreData>(res, 'restore failed');
}

/** GET /api/settings/logs — 로그 파일 목록(ServerPanel, 원본 :1467). */
export async function fetchLogs(signal?: AbortSignal): Promise<import('./types').LogsData> {
  const res = await fetch('/api/settings/logs', signal ? { signal } : undefined);
  return unwrap<import('./types').LogsData>(res, 'logs failed');
}
