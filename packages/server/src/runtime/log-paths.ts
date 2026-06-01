/**
 * log-paths.ts — 운영 로그 파일 경로 SSoT
 *
 * 책임:
 *   `~/.spyglass/logs/` 하위 운영 로그(server·collect)와 hook-raw 원장의 *날짜 버킷*
 *   경로/디렉토리/파일명 규칙을 단일 진실 소스로 관리한다. writer(stdio-mirror·daemon)와
 *   pruner(maintenance)는 직접 경로를 합성하지 말고 본 모듈의 상수·함수만 사용한다.
 *
 * 의존성:
 *   - process(HOME) via `node:os` homedir — 사용자 홈.
 *   - `node:path` join — OS 독립 경로 합성.
 *
 * 호출 흐름:
 *   1) stdio-mirror.ts  : DIAG ON 시 `serverLogBucketForToday()` 로 서버 로그를 일자 버킷에 append.
 *   2) daemon.ts        : start 모드 detached child stdout/stderr 를 `serverLogBucketForToday()` 로 redirect.
 *   3) maintenance.ts   : `PRUNE_TARGETS` 를 순회하며 보존 기간 초과 버킷을 삭제, `LEGACY_FLAT_LOGS` 1회성 정리.
 *
 * 디자인 결정:
 *   - 날짜 포맷은 bash `hooks/spyglass-collect.sh` 의 `date '+%Y-%m-%d'`(로컬 타임존)와 **반드시 일치**.
 *     bash 는 TS 코드를 import 할 수 없으므로 규약(디렉토리명·날짜포맷·확장자)을 양쪽이 공유하며,
 *     본 모듈이 TS 측 SSoT, collect.sh 가 bash 측 미러(주석 교차참조)다.
 *   - server/collect 운영 로그는 `.log`, hook-raw 원장은 `.jsonl` 확장자로 버킷 정규식을 분리한다.
 *   - 버킷 경로 헬퍼는 호출 시마다 오늘 날짜를 재계산한다 → 장기 실행 프로세스도 자정에 자연 롤오버.
 */

import { homedir } from 'node:os';
import { join } from 'node:path';

// =============================================================================
// 상수 — 경로 SSoT
// =============================================================================

/** `~/.spyglass/logs` 루트. */
export const LOGS_ROOT = join(homedir(), '.spyglass', 'logs');

/** 서버 stdout/stderr 미러 버킷 디렉토리. */
export const SERVER_LOG_DIR = join(LOGS_ROOT, 'server');
/** collect 훅 운영 로그 버킷 디렉토리. */
export const COLLECT_LOG_DIR = join(LOGS_ROOT, 'collect');
/** hook raw 원장 버킷 디렉토리. */
export const HOOK_RAW_DIR = join(LOGS_ROOT, 'hook-raw');

/** 운영 로그(`.log`) 버킷 파일명 — collect.sh 의 `YYYY-MM-DD` 포맷과 일치. */
export const LOG_BUCKET_RE = /^(\d{4})-(\d{2})-(\d{2})\.log$/;
/** hook raw 원장(`.jsonl`) 버킷 파일명. */
export const RAW_LOG_BUCKET_RE = /^(\d{4})-(\d{2})-(\d{2})\.jsonl$/;

// =============================================================================
// 오늘자 버킷 경로 — 호출 시마다 재계산(자정 롤오버)
// =============================================================================

/**
 * 오늘 로컬 날짜를 `YYYY-MM-DD` 로 만든다. collect.sh 의 `date '+%Y-%m-%d'` 와 동일하게
 * **로컬 타임존** 기준 — maintenance prune 의 버킷 날짜 해석(로컬 자정)과도 일치한다.
 */
function todayBucketDate(now: Date = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** 오늘자 서버 로그 버킷 풀 경로 (`logs/server/YYYY-MM-DD.log`). */
export function serverLogBucketForToday(): string {
  return join(SERVER_LOG_DIR, `${todayBucketDate()}.log`);
}

/** 오늘자 collect 로그 버킷 풀 경로 (`logs/collect/YYYY-MM-DD.log`). */
export function collectLogBucketForToday(): string {
  return join(COLLECT_LOG_DIR, `${todayBucketDate()}.log`);
}

// =============================================================================
// prune / 마이그레이션 대상
// =============================================================================

/** 보존 기간 prune 대상 버킷 디렉토리 + 파일명 정규식. */
export interface PruneTarget {
  dir: string;
  re: RegExp;
}

/** maintenance 가 일괄 prune 하는 버킷 목록 (server·collect·hook-raw). */
export const PRUNE_TARGETS: readonly PruneTarget[] = [
  { dir: SERVER_LOG_DIR, re: LOG_BUCKET_RE },
  { dir: COLLECT_LOG_DIR, re: LOG_BUCKET_RE },
  { dir: HOOK_RAW_DIR, re: RAW_LOG_BUCKET_RE },
];

/**
 * 버킷화 이전의 단일 누적 파일 — 더는 writer 가 기록하지 않는 고아.
 * maintenance 가 1회성 best-effort 로 제거해 디렉토리를 깨끗이 유지한다.
 */
export const LEGACY_FLAT_LOGS: readonly string[] = [
  join(LOGS_ROOT, 'server.log'),
  join(LOGS_ROOT, 'collect.log'),
];
