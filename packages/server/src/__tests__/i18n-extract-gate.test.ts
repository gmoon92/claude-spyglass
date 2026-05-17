/**
 * i18n-extract CI gate — 한글 raw 회귀 방지의 마지막 안전망.
 *
 * 시나리오:
 *  - 누군가 새 코드에 `t('...')` 대신 한글 string literal을 박는다.
 *  - bun test가 즉시 fail되어 PR이 막힌다.
 *
 * scripts/i18n-extract.ts를 dry-run으로 실행하고 `Total extracted: 0`을 확인.
 * 실제 파일은 변경하지 않으며 (`--dry-run`), 약 0.45초 소요.
 *
 * 추가 한 라인이라도 한글이 들어가면:
 *   Total extracted: 1   ← test fail
 * 이 됨. CI/local 모두 동일 게이트로 작동.
 */

import { describe, it, expect } from 'bun:test';
import { spawnSync } from 'child_process';
import { resolve } from 'path';
import { readdirSync, readFileSync, statSync } from 'fs';
import { join } from 'path';

const PROJECT_ROOT = resolve(__dirname, '../../../..');

/**
 * 디렉터리를 재귀 순회하며 .ts 파일을 수집 (테스트/dist/node_modules 제외).
 */
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
    const st = statSync(p);
    if (st.isDirectory()) collectTsFiles(p, out);
    else if (name.endsWith('.ts')) out.push(p);
  }
  return out;
}

/**
 * server src 사용자 노출 패턴에서 한글 string literal 검출.
 * 사용자에게 닿을 수 있는 모든 출력 채널을 망라:
 *   - console.<log|warn|error|info>('...' 내부에 한글  (CLI / stdout)
 *   - throw new Error('...' 내부에 한글               (에러 상위로 전파)
 *   - process.std<out|err>.write('...' 내부에 한글    (raw 출력)
 *   - Response.json({...'한글'...})                   (HTTP API JSON 응답)
 *   - new Response('...한글...', {...})               (HTTP 본문)
 *   - res.json({...'한글'...}) / res.send('한글')      (express-style 응답)
 * runtime 변수 보간(`${err.message}` 등)은 잡지 않음 — string literal 한정.
 */
// Pattern A — 함수 호출 인자의 한글 string literal.
const USER_FACING_KOREAN_CALL =
  /(console\.(?:log|warn|error|info)|throw\s+new\s+Error|process\.std(?:out|err)\.write|Response\.json|new\s+Response|res\.(?:json|send|write))\s*\([^)]*["'`][^"'`]*[가-힣]/;

// Pattern B — 객체 리터럴 키:값의 한글 (return { error: '한글' }, MESSAGES = { x: '한글' } 등).
//   {`key:` `값` 형태} 또는 {`key:` 멀티라인 다음 줄} — 같은 라인 한정으로 단순화.
const USER_FACING_KOREAN_OBJ =
  /(?:error|message|msg|hint|reason|detail|description|title|label|note|name)\s*:\s*["'`][^"'`]*[가-힣]/i;

// Pattern C — assignment: foo.message = '한글' / foo.error = '한글'
const USER_FACING_KOREAN_ASSIGN =
  /\.(?:error|message|msg|hint|reason|detail|description|title|label|note|name)\s*=\s*["'`][^"'`]*[가-힣]/i;

function lineHasUserFacingKorean(line: string): boolean {
  return (
    USER_FACING_KOREAN_CALL.test(line) ||
    USER_FACING_KOREAN_OBJ.test(line) ||
    USER_FACING_KOREAN_ASSIGN.test(line)
  );
}

describe('i18n-extract CI gate (브랜드 위험 회귀 방지)', () => {
  it('web + tui 패키지에서 한글 raw 0건 (사용자 노출 문자열)', () => {
    const result = spawnSync(
      'bun',
      ['run', 'scripts/i18n-extract.ts', '--target=both', '--dry-run'],
      {
        cwd: PROJECT_ROOT,
        encoding: 'utf-8',
        timeout: 30_000,
      },
    );

    // 실행 자체 실패 시 즉시 fail (스크립트 깨짐 등).
    expect(result.status).toBe(0);

    // 출력에서 'Total extracted' 라인을 파싱.
    // i18n-extract.ts의 영문 출력: `Total extracted: <N>`
    const m = result.stdout.match(/Total extracted:\s+(\d+)/);
    expect(m).not.toBeNull();
    const extracted = Number(m![1]);

    // 0이 아니면, 어느 파일에서 한글이 추가되었는지 디버깅 메시지를 함께 노출.
    if (extracted !== 0) {
      const reportPath = resolve(PROJECT_ROOT, 'scripts/.i18n-report.json');
      // eslint-disable-next-line no-console
      console.error(
        `\n[i18n-gate] FAIL: ${extracted}건 한글 raw 검출. 상세는 ${reportPath} 확인.\n` +
          `다국어 처리 필요 — t('namespace.key')로 치환하고 ko/en/ja/zh JSON에 키 추가하세요.\n`,
      );
    }
    expect(extracted).toBe(0);
  }, 30_000);

  it('server src에 사용자 노출 한글 string literal 0건 (console.*, throw Error, process.std*.write)', () => {
    // i18n-extract.ts는 web+tui만 스캔하므로 server 영역은 별도 grep 기반 검증.
    // 미래에 누가 `console.error('새 한글')` 같이 추가하면 즉시 fail.
    const serverSrc = resolve(PROJECT_ROOT, 'packages/server/src');
    const files = collectTsFiles(serverSrc);
    expect(files.length).toBeGreaterThan(10); // sanity: 최소한의 파일을 찾았는지

    const offenders: string[] = [];
    for (const file of files) {
      const content = readFileSync(file, 'utf-8');
      const lines = content.split('\n');
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        // 주석은 스킵 — JSDoc/inline comment의 한글은 개발자 노트.
        const trimmed = line.trimStart();
        if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) continue;
        if (lineHasUserFacingKorean(line)) {
          offenders.push(`${file.replace(PROJECT_ROOT + '/', '')}:${i + 1}: ${line.trim().slice(0, 120)}`);
        }
      }
    }

    if (offenders.length > 0) {
      // eslint-disable-next-line no-console
      console.error(
        `\n[i18n-gate] server src에 사용자 노출 한글 ${offenders.length}건:\n` +
          offenders.map((l) => `  ${l}`).join('\n') +
          `\n→ t('cli.X') 또는 t('doctor.X') 같은 i18n 키로 치환하고 server/locales/{ko,en,ja,zh}.json에 키 추가하세요.\n`,
      );
    }
    expect(offenders).toEqual([]);
  });
});
