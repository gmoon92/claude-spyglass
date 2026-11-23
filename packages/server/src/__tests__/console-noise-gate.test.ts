/**
 * 콘솔 잡음 회귀 가드 — 서버 런타임 경로의 무조건 `console.log` 금지.
 *
 * 시나리오:
 *  - 누군가 부팅·주기 작업·SSE 연결 같은 정보성 라인을 `console.log` 로 새로 추가한다.
 *  - `bun run dev` 콘솔이 다시 정보성 로그로 뒤덮인다.
 *  - 이 테스트가 즉시 실패해 `logVerbose`(@spyglass/storage) 사용을 강제한다.
 *
 * 원칙:
 *  - 정보성 라인 → `logVerbose` (SPYGLASS_DIAG_ENABLED 켠 사람에게만 보인다)
 *  - 경고·에러  → `console.warn` / `console.error` (항상 보인다, 게이트 대상 아님)
 *  - 명령 결과 UX·부팅 확인 한 줄 → 아래 ALLOWED 에 명시된 라인만 예외
 *
 * 검사 대상은 "서버가 백그라운드로 계속 도는 동안 실행되는 코드"다. CLI 명령 구현
 * (`cli/`, `runtime/daemon.ts`)은 출력 자체가 명령의 결과이므로 대상에서 제외한다.
 */

import { describe, it, expect } from 'bun:test';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

const SERVER_SRC = resolve(__dirname, '..');

/** 서버가 상시 실행 중 사용하는 경로. */
const SCANNED_DIRS = ['runtime', 'proxy', 'routes', 'hook'];
const SCANNED_FILES = ['sse.ts', 'version-checker.ts'];

/** 출력이 곧 명령의 결과 UX인 파일 — 전체 면제. */
const EXEMPT_FILES = new Set(['runtime/daemon.ts']);

/**
 * 파일별로 허용되는 무조건 출력. 값은 해당 라인에 포함돼야 하는 문자열이다.
 * 드물게 발생하며, 정지·지연·기동처럼 사용자가 지금 알아야 하는 사실만 남긴다.
 */
const ALLOWED: Record<string, string[]> = {
  'runtime/lifecycle.ts': [
    '[Server] Already running',
    '[Server] Running on',
    '[Server] Stopped',
    'in-flight background task(s)',
  ],
  'runtime/boot-prereqs.ts': ['web/dist missing'],
  'routes/version.ts': ['Self-restart scheduled'],
  // `if (import.meta.main)` 자체 점검 블록 — 서버 런타임이 아니라 수동 실행 경로.
  'hook/http-entry.ts': ['Testing hook processor', 'Result:', 'Hook processor test passed'],
};

function collectTsFiles(dir: string, out: string[] = []): string[] {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const name of entries) {
    if (name === 'node_modules' || name === 'dist' || name === '__tests__') continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) collectTsFiles(p, out);
    else if (name.endsWith('.ts') && !name.endsWith('.test.ts')) out.push(p);
  }
  return out;
}

function scannedFiles(): string[] {
  const files = SCANNED_DIRS.flatMap((d) => collectTsFiles(join(SERVER_SRC, d)));
  return [...files, ...SCANNED_FILES.map((f) => join(SERVER_SRC, f))];
}

function findViolations(): string[] {
  const violations: string[] = [];
  for (const file of scannedFiles()) {
    const rel = relative(SERVER_SRC, file);
    if (EXEMPT_FILES.has(rel)) continue;
    const allowed = ALLOWED[rel] ?? [];
    readFileSync(file, 'utf-8')
      .split('\n')
      .forEach((line, i) => {
        const trimmed = line.trimStart();
        if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) return;
        if (!/\bconsole\.log\s*\(/.test(line)) return;
        if (allowed.some((a) => line.includes(a))) return;
        violations.push(`${rel}:${i + 1}  ${line.trim()}`);
      });
  }
  return violations;
}

describe('서버 런타임 콘솔 잡음 가드', () => {
  it('스캔 대상 파일을 실제로 찾는다', () => {
    expect(scannedFiles().length).toBeGreaterThan(10);
  });

  it('정보성 라인은 console.log 대신 logVerbose 를 거친다', () => {
    const violations = findViolations();
    if (violations.length > 0) {
      console.error(
        `\n[console-noise-gate] 허용되지 않은 console.log ${violations.length}건:\n`
          + violations.map((v) => `  ${v}`).join('\n')
          + `\n→ 정보성이면 @spyglass/storage 의 logVerbose 로, 경고/에러면 console.warn|error 로 바꾸세요.`
          + `\n  명령 결과 UX·부팅 확인 라인이면 이 테스트의 ALLOWED 에 근거와 함께 추가하세요.\n`,
      );
    }
    expect(violations).toEqual([]);
  });
});
