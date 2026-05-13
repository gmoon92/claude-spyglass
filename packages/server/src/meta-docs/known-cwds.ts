/**
 * meta-docs 모듈 — 알려진 cwd 발견기
 *
 * 책임:
 *  - 카탈로그 모집단 확장을 위해 "이 사용자가 사용 중인 워크스페이스 cwd 목록"을 모은다.
 *  - 다른 워크스페이스(rv-iso, squadliterv 등)에 정의된 Behavior Definitions가 호출되었지만
 *    카탈로그에 들어오지 않는 orphan 문제를 해결.
 *
 * cwd 후보 소스:
 *  1) meta_doc_resolutions.cwd        — 이미 등록된 cwd (현재 1개)
 *  2) ~/.claude/projects/<encoded>    — claude-code가 세션마다 만드는 디렉토리.
 *                                       encoded 규약: 절대경로의 `/` → `-`, 선두에도 `-` 추가.
 *                                       예) `-Users-moongyeom-IdeaProjects-rv-iso`
 *                                           → `/Users/moongyeom/IdeaProjects/rv-iso`
 *                                       하이픈이 디렉토리명에 들어간 경우 디코딩이 모호하므로
 *                                       후보를 여러 개 만든 뒤 "디스크에 실제 존재하고 `.claude/`도 있는"
 *                                       경로만 채택 (단순 알고리즘).
 *
 * 안전 가드 (모든 후보에 공통):
 *  - realpathSync 정규화 — 심볼릭 링크 중복 차단.
 *  - `.claude/` 디렉토리 실존 — Behavior Definitions가 있는 워크스페이스만 채택.
 *  - home 위로 절대 안 올라감 — `/Users/moongyeom/.claude` 같은 home root 자체는 별도로 글로벌 처리.
 *
 * 외부 노출:
 *  - discoverKnownCwds(db, options?): string[]
 *
 * 의존성: bun:sqlite Database (1번 소스 조회), 표준 fs/path/os.
 */

import type { Database } from 'bun:sqlite';
import { existsSync, readdirSync, realpathSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { resolve } from 'node:path';

/** ~/.claude/projects 안의 encoded 디렉토리 prefix. */
const PROJECTS_DIR_NAME = 'projects';

/**
 * 알려진 cwd 후보를 모은 목록 (정규화 + dedupe + `.claude/` 존재 검증).
 *
 * @param db storage Database (meta_doc_resolutions 조회용)
 * @returns realpath 정규화된 절대경로 배열 (정렬: 사전순). home 자체는 포함하지 않음.
 */
export function discoverKnownCwds(db: Database): string[] {
  const home = realpathSafe(homedir());
  const acc = new Set<string>();

  // 1) 이미 등록된 cwd (resolutions 테이블)
  for (const c of fetchResolutionCwds(db)) {
    addIfValid(acc, c, home);
  }

  // 2) ~/.claude/projects/<encoded>
  for (const c of decodeProjectsDir(home)) {
    addIfValid(acc, c, home);
  }

  return Array.from(acc).sort();
}

// =============================================================================
// 내부 — 소스별 추출
// =============================================================================

function fetchResolutionCwds(db: Database): string[] {
  try {
    const rows = db.query('SELECT DISTINCT cwd FROM meta_doc_resolutions WHERE cwd IS NOT NULL').all() as Array<{ cwd: string }>;
    return rows.map(r => r.cwd).filter(Boolean);
  } catch {
    // 테이블이 아직 없을 수 있음 (마이그레이션 직전 등) — best-effort.
    return [];
  }
}

/**
 * `~/.claude/projects/<encoded>` 디렉토리 이름을 절대경로로 디코드.
 *
 * 인코딩 규약: 절대경로의 모든 `/`를 `-`로 치환하고 선두에 `-`를 둔다.
 *   예) `/Users/moongyeom/IdeaProjects/rv-iso` → `-Users-moongyeom-IdeaProjects-rv-iso`
 *
 * 모호성 처리:
 *   원본 디렉토리명에 `-`가 있으면 디코드 결과가 여러 가지일 수 있다.
 *   (`rv-iso` → `rv-iso` 또는 `rv/iso`)
 *   본 함수는 **모든 가능한 후보**를 만든 뒤, 호출자(`addIfValid`)에서
 *   실제 디스크 존재 + `.claude/` 존재로만 필터링한다.
 *
 *   복잡한 BFS 대신, 흔한 1단계 분할(마지막 `-` 한 개를 `/`로 바꾸는 변형)까지만
 *   생성한다. 더 깊은 모호성은 사용자가 옵트인 walk를 쓰도록 유도.
 */
function decodeProjectsDir(home: string): string[] {
  const dir = `${home}/.claude/${PROJECTS_DIR_NAME}`;
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return [];
  }

  const out: string[] = [];
  for (const entry of entries) {
    if (!entry.startsWith('-')) continue;
    // 기본 디코드: 모든 `-` → `/` (선두 `-`는 split 시 빈 문자열로 자연스럽게 leading `/` 됨)
    const baseDecoded = entry.replace(/-/g, '/');

    // 모든 가능한 segment 머지 후보를 생성.
    // 단순 알고리즘: split된 segment들을 끝에서부터 점진적으로 `-`로 합쳐 본다.
    //   `/Users/moongyeom/IdeaProjects/claude/code/system`
    //   → 후보: ".../claude/code/system",
    //          ".../claude/code-system",
    //          ".../claude-code/system",
    //          ".../claude-code-system"
    // 호출자가 디스크 존재 검사로 정답을 1개 골라낸다.
    out.push(...generateMergeVariants(baseDecoded));
  }
  return out;
}

/**
 * 경로 segment 일부를 `-`로 다시 합치는 모든 가능한 변형 생성.
 *
 * 보수적: 마지막 N개 segment 한정으로 머지 (전역 조합 폭발 방지).
 * 흔한 케이스(`claude-code-system`, `rv-agent` 등)를 다 커버하면서도 깊이 N=5 까지만.
 */
function generateMergeVariants(decoded: string): string[] {
  // 선두 `/`는 보존하고 segment만 처리.
  const leading = decoded.startsWith('/') ? '/' : '';
  const parts = decoded.replace(/^\//, '').split('/');

  // 너무 짧은 경로(home 위)는 무의미 — 그대로만 반환.
  if (parts.length < 3) return [leading + parts.join('/')];

  // 끝에서부터 최대 5개 segment 범위에서 모든 머지 패턴(2^k) 생성.
  const tailWindow = Math.min(5, parts.length - 2); // 머지 후보가 될 segment 개수
  const head = parts.slice(0, parts.length - tailWindow);
  const tail = parts.slice(parts.length - tailWindow);

  const results: string[] = [];
  const total = 1 << (tail.length - 1); // 인접 segment 사이 boundary 수
  for (let mask = 0; mask < total; mask++) {
    const merged: string[] = [tail[0]];
    for (let i = 1; i < tail.length; i++) {
      const join = (mask >> (i - 1)) & 1; // 1 → `-`로 합침, 0 → 새 segment
      if (join) {
        merged[merged.length - 1] = merged[merged.length - 1] + '-' + tail[i];
      } else {
        merged.push(tail[i]);
      }
    }
    results.push(leading + [...head, ...merged].join('/'));
  }
  return results;
}

// =============================================================================
// 내부 — 검증/정규화
// =============================================================================

/**
 * 후보 cwd를 검증해 acc에 추가.
 *
 * 검증 항목:
 *  - 절대경로 형태 (resolve 후 `/`로 시작)
 *  - realpath 성공 (디스크에 실제 존재)
 *  - home 자체 또는 home 외부가 아님 (보안)
 *  - `<cwd>/.claude/` 디렉토리 존재 (Behavior Definitions가 있는 워크스페이스만)
 */
function addIfValid(acc: Set<string>, candidate: string, home: string): void {
  if (!candidate || !candidate.startsWith('/')) return;

  const normalized = realpathSafe(resolve(candidate));
  if (!normalized.startsWith('/')) return;

  // home 자체는 글로벌 처리 영역 — 여기선 제외.
  if (normalized === home) return;

  // home 하위가 아닌 경로는 거부 (보안: 임의 디렉토리 스캔 방지).
  if (!normalized.startsWith(home + '/')) return;

  // 실제 .claude/ 디렉토리가 있는 곳만 채택.
  if (!isDirectory(`${normalized}/.claude`)) return;

  acc.add(normalized);
}

function realpathSafe(p: string): string {
  try { return realpathSync(p); } catch { return resolve(p); }
}

function isDirectory(p: string): boolean {
  try { return existsSync(p) && statSync(p).isDirectory(); } catch { return false; }
}
