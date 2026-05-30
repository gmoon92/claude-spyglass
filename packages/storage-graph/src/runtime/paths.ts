/**
 * paths.ts — Graph projection 파일 경로 SSoT
 *
 * 책임:
 *   LadybugDB 데이터 파일과 sync cursor 메타 파일의 위치를 단일 진실 소스로
 *   관리한다. 다른 모듈은 직접 경로를 합성하지 말고 본 모듈의 함수만 호출.
 *
 * 의존성:
 *   - process.env.HOME (또는 USERPROFILE) — 사용자 홈 디렉토리.
 *   - Node fs — 디렉토리 생성/존재 확인.
 *
 * 호출 흐름:
 *   1) `client.ts::connect()` 가 `getGraphDir()` 로 디렉토리 보장 후 Ladybug DB open.
 *   2) `sync/cursor.ts` 가 `getSyncStatePath()` 의 JSON 파일을 read/write.
 *   3) `schema/apply.ts` 가 throw-away 재구축 시 디렉토리 rename 후 새로 만든다.
 *
 * 디자인 결정:
 *   - SQLite SSoT(`~/.spyglass/spyglass.db`)와 같은 부모 디렉토리 `~/.spyglass/` 아래
 *     `graph/` 서브를 분리한다. 사용자가 "spyglass.db만 백업"하면 그래프는 자동 재구축.
 *   - 환경변수 `SPYGLASS_HOME` 으로 override 가능 — 테스트/사용자 정의 위치 지원.
 *   - 경로 separator 는 `path.join` 으로 OS 독립 유지 (현재는 macOS-only지만 향후 대비).
 */

import { existsSync, mkdirSync, writeFileSync, chmodSync } from 'node:fs';
import { join } from 'node:path';

// =============================================================================
// 상수 — 경로 SSoT
// =============================================================================

const SPYGLASS_HOME_DIRNAME = '.spyglass';
const GRAPH_SUBDIR = 'graph';
const DB_FILENAME = 'spyglass.lbug';
const SYNC_STATE_FILENAME = 'sync_state.json';
const README_FILENAME = 'KUZU_README.txt';

/**
 * "이 폴더는 throw-away cache" 라는 사용자 안내. 그래프 폴더가 처음 생성될 때 함께
 * 기록되며, 사용자가 무엇을 백업해야 할지 (정답: SQLite 파일만) 명확히 한다.
 */
const README_BODY = [
  'This folder is a throw-away cache for the LadybugDB graph projection.',
  '',
  'It is safe to delete this entire folder at any time:',
  '    rm -rf ~/.spyglass/graph',
  'The next time Spyglass starts, the projection will be rebuilt automatically',
  'from the SQLite source of truth (~/.spyglass/spyglass.db).',
  '',
  'When backing up your Spyglass data, copy spyglass.db ONLY.',
  'Copying this folder is unnecessary and may cause schema mismatch on restore.',
  '',
].join('\n');

// =============================================================================
// 디렉토리 / 파일 경로 계산
// =============================================================================

/**
 * 사용자 홈 디렉토리. SPYGLASS_HOME 환경변수가 있으면 그 값을 그대로 사용 — 테스트 환경에서
 * tmpdir 으로 override 가능하도록 한다. 없으면 OS 표준 home.
 */
function getUserHome(): string {
  const override = process.env.SPYGLASS_HOME;
  if (override && override.length > 0) return override;
  // macOS/Linux: HOME, Windows: USERPROFILE — connection.ts와 동일한 fallback 순서 유지.
  return process.env.HOME || process.env.USERPROFILE || '/tmp';
}

/**
 * `~/.spyglass/graph/` 디렉토리 경로. 디렉토리가 없으면 자동 생성하고 README도 함께
 * 만든다 (idempotent — 이미 있으면 아무 일도 안 함).
 */
export function getGraphDir(): string {
  const home = getUserHome();
  // SPYGLASS_HOME 이 직접 `.spyglass` 까지 가리키는 경우와 부모 home 인 경우 모두 지원.
  const isAlreadySpyglassRoot = home.endsWith(`/${SPYGLASS_HOME_DIRNAME}`);
  const spyglassRoot = isAlreadySpyglassRoot ? home : join(home, SPYGLASS_HOME_DIRNAME);
  const graphDir = join(spyglassRoot, GRAPH_SUBDIR);

  if (!existsSync(graphDir)) {
    mkdirSync(graphDir, { recursive: true });
    // README 는 폴더와 같이 만들어 두면 사용자가 폴더를 들여다볼 때 즉시 안내가 보인다.
    try {
      writeFileSync(join(graphDir, README_FILENAME), README_BODY, 'utf8');
    } catch {
      // README 쓰기 실패는 치명 아님 — 무시.
    }
  }
  // 보안 (consistency-hardening P2.2): RDB(connection.ts)와 동일하게 소유자 전용 권한.
  //   그래프 DB 도 평문 at-rest 이므로 디렉토리를 0o700 으로 강제(매 호출 best-effort —
  //   기존 폴더의 권한도 교정). 실패해도 치명 아님(권한 없는 FS 등) — 무시.
  try {
    chmodSync(graphDir, 0o700);
  } catch {
    // chmod 실패는 무시 — 일부 파일시스템/권한 환경에서 불가할 수 있음.
  }
  return graphDir;
}

/** LadybugDB 데이터 파일 풀 경로. (단일 파일 또는 디렉토리 — Ladybug fork의 포맷에 따름) */
export function getGraphDbPath(): string {
  return join(getGraphDir(), DB_FILENAME);
}

/** sync cursor 상태 JSON 풀 경로. */
export function getSyncStatePath(): string {
  return join(getGraphDir(), SYNC_STATE_FILENAME);
}

/** 사용자 안내 README 풀 경로 (테스트/문서 인용용). */
export function getGraphReadmePath(): string {
  return join(getGraphDir(), README_FILENAME);
}
