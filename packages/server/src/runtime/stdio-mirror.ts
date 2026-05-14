/**
 * server stdout/stderr 미러링 — `~/.spyglass/logs/server.log` 파일에 기록 (server-logging pass).
 *
 * 배경:
 *   백그라운드로 띄운 spyglass 서버의 stdout/stderr가 어디로 빠지는지 호출 환경에 의존했다.
 *   서버가 비정상 종료해도 추적 흔적이 남지 않아 사후 분석 불가.
 *
 * 정책:
 *   - 기존 console.log/warn/error는 그대로 stdout/stderr로 흘려보내고, 동시에 파일에도 append.
 *   - uncaughtException / unhandledRejection은 별도 FATAL 라인으로 기록.
 *   - 경로는 SPYGLASS_SERVER_LOG 환경변수로 오버라이드 가능.
 *   - 이미 install된 경우 재호출은 no-op (test 중복 install 방지).
 *
 * 호출자: runtime/lifecycle.ts#startServer 진입부 1회.
 */
import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

let _installed = false;

function defaultLogPath(): string {
  if (process.env.SPYGLASS_SERVER_LOG) return process.env.SPYGLASS_SERVER_LOG;
  const home = process.env.HOME || '.';
  return `${home}/.spyglass/logs/server.log`;
}

function safeFormat(arg: unknown): string {
  if (typeof arg === 'string') return arg;
  if (arg instanceof Error) return arg.stack ?? arg.message;
  try { return JSON.stringify(arg); } catch { return String(arg); }
}

export function installServerStdioMirror(): void {
  if (_installed) return;
  _installed = true;

  const logFile = defaultLogPath();
  try {
    mkdirSync(dirname(logFile), { recursive: true });
  } catch { /* silent — append 시도 시 다시 실패하면 throw 잡힘 */ }

  const writeLine = (level: 'INFO' | 'WARN' | 'ERROR' | 'FATAL', args: unknown[]): void => {
    const ts = new Date().toISOString();
    const body = args.map(safeFormat).join(' ');
    const line = `[${ts}] [${level}] ${body}\n`;
    try {
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

  // 부팅 배너 — 첫 라인 식별자.
  writeLine('INFO', [`[stdio-mirror] file=${logFile} pid=${process.pid}`]);
}
