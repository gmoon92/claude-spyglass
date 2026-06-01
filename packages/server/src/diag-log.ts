/**
 * 진단(Diagnostic) 로그 — 파일 전용 + 기능 플래그
 *
 * 책임:
 *  - hook/proxy의 raw payload와 model 추적 정보를 카테고리별 파일에 append.
 *  - 운영 시에는 비활성(기본값) — 데이터 분석/스키마 고도화 작업 시에만 환경변수로 켠다.
 *
 * 기본 동작 (운영):
 *  - SPYGLASS_DIAG_ENABLED 환경변수가 '1' 또는 'true' 일 때만 로그 작동.
 *  - 그 외(기본 포함)에는 diagLog/diagJson 모두 no-op → 디스크 사용량 0.
 *
 * 활성화 방법 (개발/디버깅):
 *  ```bash
 *  SPYGLASS_DIAG_ENABLED=1 bun run packages/server/src/index.ts restart
 *  # 선택: 위치 override
 *  SPYGLASS_DIAG_ENABLED=1 SPYGLASS_DIAG_LOG_DIR=/tmp/spyglass-diag bun run ...
 *  ```
 *
 * 환경변수:
 *  - SPYGLASS_DIAG_ENABLED  : '1'|'true' → 로그 활성. 그 외 → no-op (기본).
 *  - SPYGLASS_DIAG_LOG_DIR  : 로그 디렉토리 override (기본: <cwd>/.claude/.tmp/logs).
 *  - SPYGLASS_DIAG_RAW_SSE  : '1' → proxy SSE 응답 본문 raw도 jsonl에 포함 (사이즈 비대 주의).
 *
 * 출력 카테고리 (활성 시):
 *  - model-trace.log     : model 추출/분기 추적 (사람-읽기 한 줄)
 *  - hook-payload.jsonl  : 훅 진입 시 raw payload 1줄/이벤트
 *  - proxy-payload.jsonl : 프록시 진입+종료 시 raw 본문/헤더 1줄/단계
 *
 * 외부 노출:
 *  - diagLog(category, message)   : 한 줄 trace 기록
 *  - diagJson(category, payload)  : jsonl 객체 기록 (ts 자동)
 *  - isDiagEnabled()              : 플래그 상태 조회 (호출자가 비싼 페이로드 직렬화 전 가드용)
 *  - getDiagLogDir()              : 현재 로그 디렉토리 경로
 *
 * 호출자:
 *  - hook/raw-handler / hook/transcript / hook/transcript-context (model 추적)
 *  - proxy/handler (요청·응답 raw payload 기록)
 *  - events.ts (Stop 등 비-collect hook 통합)
 */
import {
  existsSync,
  mkdirSync,
  appendFileSync,
  readdirSync,
  truncateSync,
} from 'node:fs';
import { join, resolve } from 'node:path';
import { shouldSuppressNonEssentialWrites } from '@spyglass/storage';

/**
 * 플래그 평가 — '1' 또는 'true'(대소문자 무관)면 활성.
 * 모듈 로드 시점에 한 번만 평가해 호출 시 환경변수 lookup 비용을 없앤다.
 * 즉 서버 재시작해야 플래그 변경 반영됨.
 */
const ENABLED = (() => {
  const v = (process.env.SPYGLASS_DIAG_ENABLED || '').trim().toLowerCase();
  return v === '1' || v === 'true';
})();

const HOME = process.env.HOME || process.env.USERPROFILE || process.cwd();
const DEFAULT_LOG_DIR = resolve(HOME, '.spyglass', 'logs');
const LOG_DIR = process.env.SPYGLASS_DIAG_LOG_DIR || DEFAULT_LOG_DIR;

let initialized = false;

/**
 * 디스크 critical(기본 <200MB) 이면 진단 기록을 중단한다 — raw payload 폭주가 디스크 풀 →
 * write I/O hang 의 주범이므로 여기서 차단. statfs 비용을 줄이려 5초 throttle 캐시.
 */
let lastDiskCheckTs = 0;
let lastDiskSuppress = false;
function diskSuppressed(): boolean {
  const now = Date.now();
  if (now - lastDiskCheckTs > 5000) {
    lastDiskSuppress = shouldSuppressNonEssentialWrites(LOG_DIR);
    lastDiskCheckTs = now;
  }
  return lastDiskSuppress;
}

function ensureDir(): void {
  if (initialized) return;
  if (!existsSync(LOG_DIR)) {
    // 0o700 — 진단 로그(hook/proxy payload 평문)는 민감하므로 소유자 전용 권한.
    //   RDB/그래프 DB 파일(connection.ts/client.ts)의 0o600/0o700 방어선과 일관.
    mkdirSync(LOG_DIR, { recursive: true, mode: 0o700 });
  }
  console.log(
    `[Diag] Diagnostic logs ENABLED at ${LOG_DIR}\n`
      + `       - model-trace.log\n`
      + `       - hook-payload.jsonl\n`
      + `       - proxy-payload.jsonl\n`
      + `       ⚠ SECURITY: raw hook/proxy payloads (대화 본문 평문)가 디스크에 평문으로 기록됩니다.\n`
      + `         파일은 0o600으로 생성되며 재시작 시 truncate됩니다. 백업/공유에서 제외하세요.\n`
      + `       (To disable: unset SPYGLASS_DIAG_ENABLED and restart)`,
  );
  initialized = true;
}

/**
 * 진단 로그가 활성 상태인지 반환.
 * 호출자가 비싼 페이로드 직렬화/추출을 건너뛰고 싶을 때 가드로 사용.
 */
export function isDiagEnabled(): boolean {
  return ENABLED;
}

/** 사람이 읽는 단일 라인 trace. 플래그 OFF면 no-op. */
export function diagLog(category: string, message: string): void {
  if (!ENABLED || diskSuppressed()) return;
  try {
    ensureDir();
    const ts = new Date().toISOString();
    // R10: 진단 파일은 평문 payload를 담으므로 생성 시 소유자 전용(0o600)으로 강제.
    appendFileSync(join(LOG_DIR, `${category}.log`), `${ts} ${message}\n`, { mode: 0o600 });
  } catch {
    // 진단 로그 실패는 본 흐름을 막지 않음
  }
}

/** 1줄 = 1 JSON 객체 (jsonl). 자동으로 ts 필드 추가. 플래그 OFF면 no-op. */
export function diagJson(category: string, payload: Record<string, unknown>): void {
  if (!ENABLED || diskSuppressed()) return;
  try {
    ensureDir();
    const line = JSON.stringify({ ts: new Date().toISOString(), ...payload }) + '\n';
    // R10: 진단 파일은 평문 raw payload를 담으므로 생성 시 소유자 전용(0o600)으로 강제.
    appendFileSync(join(LOG_DIR, `${category}.jsonl`), line, { mode: 0o600 });
  } catch {
    // 진단 로그 실패는 본 흐름을 막지 않음
  }
}

export function getDiagLogDir(): string {
  return LOG_DIR;
}

/**
 * 서버 부팅 배너에 진단 로그 모드 안내를 출력.
 *
 * 책임:
 *  - 현재 SPYGLASS_DIAG_ENABLED 상태(ON/OFF)와 활성화 방법을 한 블록으로 표시.
 *  - 사용자가 "어떻게 켜더라" 묻지 않게 하기 위한 self-documenting 부팅 메시지.
 *
 * 호출 시점:
 *  - runtime/lifecycle.ts의 startServer()에서 서버 listen 직후 1회.
 *
 * 의존성: console (no-op safe — 항상 출력).
 */
export function logDiagStatus(): void {
  if (ENABLED) {
    console.log(
      `[Diag] SPYGLASS_DIAG_ENABLED=1 → diagnostic logs ON at ${LOG_DIR}\n`
        + `       categories: model-trace.log, hook-payload.jsonl, proxy-payload.jsonl\n`
        + `       ⚠ SECURITY: 대화 본문 등 raw payload가 평문으로 디스크에 기록됩니다(0o600, 재시작 시 truncate).\n`
        + `         백업/공유에서 제외하세요. (To disable: unset SPYGLASS_DIAG_ENABLED and restart)`,
    );
  } else {
    console.log(
      `[Diag] Diagnostic logs OFF (default). To enable raw hook/proxy payload capture, restart with one of:\n`
        + `       1) inline prefix : SPYGLASS_DIAG_ENABLED=1 bun run dev    # space, no '&'\n`
        + `       2) env wrapper   : env SPYGLASS_DIAG_ENABLED=1 bun run dev\n`
        + `       3) export (shell): export SPYGLASS_DIAG_ENABLED=1 && bun run dev\n`
        + `       NOTE: 'SPYGLASS_DIAG_ENABLED=1 && bun run dev' is WRONG — '&' backgrounds the\n`
        + `             assignment as a separate process; the var won't reach 'bun run dev'.\n`
        + `       optional flags : SPYGLASS_DIAG_LOG_DIR=<path>  SPYGLASS_DIAG_RAW_SSE=1\n`
        + `       categories ON  : model-trace.log, hook-payload.jsonl, proxy-payload.jsonl\n`
        + `       default log dir: ${DEFAULT_LOG_DIR}`,
    );
  }
}

/**
 * LOG_DIR 안의 진단 로그 파일을 모두 0바이트로 truncate.
 *
 * 책임:
 *  - `*.log`, `*.jsonl` 확장자만 정리 (다른 파일은 보존).
 *  - 디렉토리 자체는 유지 — 다음 ensureDir() 호출 비용 회피.
 *
 * 호출 시점:
 *  - 서버 시작(startServer) 진입 시 1회 — DIAG ON/OFF와 무관하게 호출.
 *    "ON → 재현 → 분석 → OFF로 재시작" 라이프사이클 종료점이 곧 다음 분석의 시작점이므로,
 *    재시작 시 깨끗한 상태로 리셋해 누적 로그가 디스크를 점유하지 않게 한다.
 *
 * 의존성: 파일 시스템(node:fs). 디렉토리 부재/권한 오류는 본 흐름을 막지 않는다.
 *
 * @returns 정리한 파일 개수. 디렉토리가 없으면 0.
 */
export function clearDiagLogs(): number {
  if (!existsSync(LOG_DIR)) return 0;
  let cleared = 0;
  try {
    const entries = readdirSync(LOG_DIR);
    for (const name of entries) {
      if (!name.endsWith('.log') && !name.endsWith('.jsonl')) continue;
      try {
        truncateSync(join(LOG_DIR, name), 0);
        cleared++;
      } catch {
        // 개별 파일 실패는 무시 — 다음 파일 계속 처리
      }
    }
  } catch {
    // 디렉토리 read 실패 시 0 반환
  }
  return cleared;
}
