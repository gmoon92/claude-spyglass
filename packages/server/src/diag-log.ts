/**
 * 진단(Diagnostic) 로그 — 파일 전용
 *
 * stdout을 깨끗하게 유지하면서 hook/proxy의 raw payload와 model 추적 정보를
 * 카테고리별 파일에 append한다. 사용자/Claude가 사후 비교 분석할 수 있도록
 * `${PROJECT}/.claude/.tmp/logs/` 아래에 누적한다.
 *
 * 환경변수 SPYGLASS_DIAG_LOG_DIR로 위치 override 가능.
 */
import { existsSync, mkdirSync, appendFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const DEFAULT_LOG_DIR = resolve(process.cwd(), '.claude', '.tmp', 'logs');
const LOG_DIR = process.env.SPYGLASS_DIAG_LOG_DIR || DEFAULT_LOG_DIR;

let initialized = false;

function ensureDir(): void {
  if (initialized) return;
  if (!existsSync(LOG_DIR)) {
    mkdirSync(LOG_DIR, { recursive: true });
  }
  console.log(
    `[Diag] Diagnostic logs at ${LOG_DIR}\n`
      + `       - model-trace.log\n`
      + `       - hook-payload.jsonl\n`
      + `       - proxy-payload.jsonl`,
  );
  initialized = true;
}

/** 사람이 읽는 단일 라인 trace */
export function diagLog(category: string, message: string): void {
  try {
    ensureDir();
    const ts = new Date().toISOString();
    appendFileSync(join(LOG_DIR, `${category}.log`), `${ts} ${message}\n`);
  } catch {
    // 진단 로그 실패는 본 흐름을 막지 않음
  }
}

/** 1줄 = 1 JSON 객체 (jsonl). 자동으로 ts 필드 추가 */
export function diagJson(category: string, payload: Record<string, unknown>): void {
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
