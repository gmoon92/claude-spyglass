/**
 * server stdout/stderr 미러링 — DIAG 활성 시에만 일자 버킷 파일에 기록 (server-logging pass).
 *
 * 배경:
 *   백그라운드로 띄운 spyglass 서버의 stdout/stderr가 어디로 빠지는지 호출 환경에 의존했다.
 *   서버가 비정상 종료해도 추적 흔적이 남지 않아 사후 분석 불가.
 *
 * 정책 (collect.sh·hook-raw 와 통일된 DIAG 게이트):
 *   - `SPYGLASS_DIAG_ENABLED` OFF(기본): **no-op** — console.log/warn/error 는 원본 그대로
 *     stdout/stderr 로만 출력(콘솔만, 영구 파일 적재 없음).
 *   - ON: 기존 console 출력은 유지하고 동시에 `logs/server/YYYY-MM-DD.log` 일자 버킷에 append.
 *     uncaughtException / unhandledRejection 은 별도 FATAL 라인으로 기록.
 *   - 버킷 경로는 매 write 마다 재계산 → 장기 실행 프로세스도 자정에 자연 롤오버.
 *   - `SPYGLASS_SERVER_LOG` 가 있으면 그 고정 경로를 사용(버킷 미적용 — 명시 override).
 *   - 이미 install된 경우 재호출은 no-op (test 중복 install 방지).
 *
 * 의존성: diag-log.ts#isDiagEnabled (게이트 SSoT), log-paths.ts#serverLogBucketForToday (경로 SSoT).
 * 호출자: runtime/lifecycle.ts#startServer 진입부 1회.
 */
import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { isDiagEnabled } from '../diag-log';
import { serverLogBucketForToday } from './log-paths';

let _installed = false;

/**
 * 이번 write 의 대상 로그 파일 경로. override 우선, 없으면 오늘자 버킷(자정 롤오버).
 */
function currentLogPath(): string {
  if (process.env.SPYGLASS_SERVER_LOG) return process.env.SPYGLASS_SERVER_LOG;
  return serverLogBucketForToday();
}

function safeFormat(arg: unknown): string {
  if (typeof arg === 'string') return arg;
  if (arg instanceof Error) return arg.stack ?? arg.message;
  try { return JSON.stringify(arg); } catch { return String(arg); }
}

export function installServerStdioMirror(): void {
  if (_installed) return;
  // DIAG OFF(기본): 파일 미러링 미설치 — console 은 원본 stdout/stderr 로만 출력된다.
  if (!isDiagEnabled()) return;
  _installed = true;

  const writeLine = (level: 'INFO' | 'WARN' | 'ERROR' | 'FATAL', args: unknown[]): void => {
    const ts = new Date().toISOString();
    const body = args.map(safeFormat).join(' ');
    const line = `[${ts}] [${level}] ${body}\n`;
    try {
      const logFile = currentLogPath();
      // 디렉토리는 매 write 보장 — 자정 롤오버로 새 일자 디렉토리/파일이 필요할 수 있다.
      mkdirSync(dirname(logFile), { recursive: true });
      appendFileSync(logFile, line);
    } catch {
      // 파일 쓰기 실패는 silent — stdout으로는 이미 출력됨, 무한 재귀 회피.
    }
  };

  const origLog   = console.log.bind(console);
  const origWarn  = console.warn.bind(console);
  const origError = console.error.bind(console);

  console.log   = (...args: unknown[]) => { origLog(...args);   writeLine('INFO',  args); };
  console.warn  = (...args: unknown[]) => { origWarn(...args);  writeLine('WARN',  args); };
  console.error = (...args: unknown[]) => { origError(...args); writeLine('ERROR', args); };

  // crash 추적의 핵심 — uncaughtException / unhandledRejection을 FATAL 라인으로 영구 기록.
  process.on('uncaughtException', (err) => {
    writeLine('FATAL', ['uncaughtException', err]);
  });
  process.on('unhandledRejection', (reason) => {
    writeLine('FATAL', ['unhandledRejection', reason]);
  });

  // 부팅 배너 — 첫 라인 식별자. (DIAG ON 경로에서만 도달)
  writeLine('INFO', [`[stdio-mirror] dir=${dirname(currentLogPath())} pid=${process.pid}`]);
}
