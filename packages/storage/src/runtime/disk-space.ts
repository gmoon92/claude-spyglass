/**
 * disk-space.ts — 디스크 여유 공간 측정 + 임계치 단일 SSoT.
 *
 * 책임:
 *   디스크 풀로 인한 write I/O hang(프로세스 uninterruptible → 좀비 → 포트/락 미회수)을
 *   예방하기 위해, 여유 공간을 측정하고 임계 상태(ok/warn/critical)를 한 곳에서 판정한다.
 *   서버(diag-log·maintenance)와 hook(df 기반)이 *동일 임계치*를 보도록 본 모듈이 SoT.
 *
 * 정책:
 *   - critical (기본 200MB 미만): raw/diag 같은 *비필수* 기록을 중단. DB 본체 write 는
 *     막지 않는다(핵심 데이터 손실 방지) — 폭주 원인(raw 로깅)만 차단해 풀 진입을 늦춘다.
 *   - warn (기본 1GB 미만): 경고만.
 *   - 측정 실패(statfs 예외)는 'unknown' — 차단하지 않는다(가드가 정상 흐름을 막지 않도록).
 *
 * env (잘못된 값 = 0/음수/non-numeric 은 default 폴백):
 *   - SPYGLASS_DISK_MIN_FREE_MB   — critical 임계 (기본 200)
 *   - SPYGLASS_DISK_WARN_FREE_MB  — warn 임계 (기본 1024)
 */

import { statfsSync } from 'node:fs';

/** critical 기본 임계 — 이 미만이면 raw/diag 기록 중단. */
export const DEFAULT_DISK_MIN_FREE_MB = 200;

/** warn 기본 임계 — 이 미만이면 경고. */
export const DEFAULT_DISK_WARN_FREE_MB = 1024;

const MB = 1024 * 1024;

function envMb(name: string, def: number): number {
  const raw = parseInt(process.env[name] ?? '', 10);
  return Number.isFinite(raw) && raw > 0 ? raw : def;
}

/** critical 임계 바이트. */
export function getDiskMinFreeBytes(): number {
  return envMb('SPYGLASS_DISK_MIN_FREE_MB', DEFAULT_DISK_MIN_FREE_MB) * MB;
}

/** warn 임계 바이트. */
export function getDiskWarnFreeBytes(): number {
  return envMb('SPYGLASS_DISK_WARN_FREE_MB', DEFAULT_DISK_WARN_FREE_MB) * MB;
}

/**
 * 주어진 경로가 속한 파일시스템의 가용 바이트(비특권 사용자 기준 `bavail`).
 * 측정 실패 시 null.
 */
export function getDiskFreeBytes(path: string): number | null {
  try {
    const s = statfsSync(path);
    return Number(s.bavail) * Number(s.bsize);
  } catch {
    return null;
  }
}

export type DiskStatus = 'ok' | 'warn' | 'critical' | 'unknown';

export interface DiskSpaceReport {
  status: DiskStatus;
  freeBytes: number | null;
}

/**
 * 경로의 디스크 상태를 임계치와 비교해 분류. 측정 불가는 'unknown'(차단 안 함).
 */
export function getDiskStatus(path: string): DiskSpaceReport {
  const freeBytes = getDiskFreeBytes(path);
  if (freeBytes === null) return { status: 'unknown', freeBytes: null };
  if (freeBytes < getDiskMinFreeBytes()) return { status: 'critical', freeBytes };
  if (freeBytes < getDiskWarnFreeBytes()) return { status: 'warn', freeBytes };
  return { status: 'ok', freeBytes };
}

/**
 * 비필수 기록(raw/diag)을 중단해야 하는가. critical 일 때만 true.
 * 'unknown'(측정 실패)은 정상 흐름을 막지 않도록 false.
 */
export function shouldSuppressNonEssentialWrites(path: string): boolean {
  return getDiskStatus(path).status === 'critical';
}
