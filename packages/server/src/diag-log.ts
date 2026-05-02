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
import { existsSync, mkdirSync, appendFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

/**
 * 플래그 평가 — '1' 또는 'true'(대소문자 무관)면 활성.
 * 모듈 로드 시점에 한 번만 평가해 호출 시 환경변수 lookup 비용을 없앤다.
 * 즉 서버 재시작해야 플래그 변경 반영됨.
 */
const ENABLED = (() => {
  const v = (process.env.SPYGLASS_DIAG_ENABLED || '').trim().toLowerCase();
  return v === '1' || v === 'true';
})();

const DEFAULT_LOG_DIR = resolve(process.cwd(), '.claude', '.tmp', 'logs');
const LOG_DIR = process.env.SPYGLASS_DIAG_LOG_DIR || DEFAULT_LOG_DIR;

let initialized = false;

function ensureDir(): void {
  if (initialized) return;
  if (!existsSync(LOG_DIR)) {
    mkdirSync(LOG_DIR, { recursive: true });
  }
  console.log(
    `[Diag] Diagnostic logs ENABLED at ${LOG_DIR}\n`
      + `       - model-trace.log\n`
      + `       - hook-payload.jsonl\n`
      + `       - proxy-payload.jsonl\n`
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
  if (!ENABLED) return;
  try {
    ensureDir();
    const ts = new Date().toISOString();
    appendFileSync(join(LOG_DIR, `${category}.log`), `${ts} ${message}\n`);
  } catch {
    // 진단 로그 실패는 본 흐름을 막지 않음
  }
}

/** 1줄 = 1 JSON 객체 (jsonl). 자동으로 ts 필드 추가. 플래그 OFF면 no-op. */
export function diagJson(category: string, payload: Record<string, unknown>): void {
  if (!ENABLED) return;
  try {
    ensureDir();
    const line = JSON.stringify({ ts: new Date().toISOString(), ...payload }) + '\n';
    appendFileSync(join(LOG_DIR, `${category}.jsonl`), line);
  } catch {
    // 진단 로그 실패는 본 흐름을 막지 않음
  }
}

export function getDiagLogDir(): string {
  return LOG_DIR;
}
