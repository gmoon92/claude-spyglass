/**
 * meta-docs 모듈 — cwd → 메타 문서 source chain 해석
 *
 * 책임:
 *  - claude-code의 markdownConfigLoader.ts:getProjectDirsUpToHome 동작을 spyglass에 맞춰 단순 재현.
 *  - 주어진 cwd를 realpath 정규화하고, git root까지 거슬러 올라가며 각 단계의 `.claude/<sub>` 후보를 수집.
 *  - 결과는 synchronizer가 scanner.scanRoot에 넘긴다.
 *
 * 우선순위 (호출 매핑 시):
 *   policySettings(managed) > projectSettings(deepest) > ... > projectSettings(git root) > userSettings > built-in
 *  - 본 MVP는 managed/built-in/plugin/bundled를 무시하고 project + user만 다룬다.
 *  - 동일 (type, name)이 chain 안 여러 곳에 있으면 가장 cwd에 가까운 것이 이긴다 (project deepest first).
 *
 * 외부 노출:
 *  - resolveProjectChain(cwd): { source_roots: string[]; user_root: string | null }
 *  - normalizeCwd(cwd): realpath 정규화 결과 (실패하면 입력값을 그대로 반환)
 *
 * 호출자: synchronizer.ts
 *
 * 의존성: 표준 fs/path/os만.
 */

import { existsSync, realpathSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

export interface ProjectChain {
  /**
   * 가장 cwd에 가까운 디렉토리부터 git root 방향으로 정렬된 project root 절대경로 목록.
   * 각 root는 .claude/ 가 존재하는 곳만 포함한다.
   */
  source_roots: string[];
  /** 글로벌(`~/.claude`) 절대경로. 항상 동일 값(또는 디렉토리 없으면 null). */
  user_root: string | null;
}

/**
 * 입력 cwd를 realpath 정규화.
 *
 * - 심볼릭 링크/워크트리 중복을 막기 위함.
 * - realpath 실패 시(파일 없음 등) 입력값을 그대로 반환 (lazy resolve의 best-effort).
 */
export function normalizeCwd(cwd: string): string {
  try {
    return realpathSync(resolve(cwd));
  } catch {
    return resolve(cwd);
  }
}

/**
 * cwd → git root까지 올라가며 `.claude/`가 존재하는 root 목록 반환.
 *
 * git root 탐지:
 *  - `.git/` 디렉토리 또는 `.git` 파일(워크트리)을 가진 첫 부모.
 *  - 못 찾으면 home 직전까지 탐색하다가 멈춘다.
 *
 * 안전:
 *  - home 이상으로는 절대 올라가지 않음 (`~/projects/.claude` 같은 부모 디렉토리 leak 방지).
 *  - 무한 루프 방지: parent === current 시 break.
 */
export function resolveProjectChain(cwd: string): ProjectChain {
  const home = realpathSafe(homedir());
  const start = normalizeCwd(cwd);

  const roots: string[] = [];
  let current = start;
  const gitRoot = findGitRoot(current);

  while (true) {
    if (current === home) break;
    if (hasClaudeDir(current)) roots.push(current);

    if (gitRoot && current === gitRoot) break;

    const parent = dirname(current);
    if (!parent || parent === current) break;
    current = parent;
  }

  const userClaude = join(home, '.claude');
  const user_root = isDirectory(userClaude) ? userClaude : null;

  return { source_roots: roots, user_root };
}

// =============================================================================
// 내부 헬퍼
// =============================================================================

function findGitRoot(start: string): string | null {
  let current = start;
  for (let i = 0; i < 64; i++) {
    if (existsSync(join(current, '.git'))) return current;
    const parent = dirname(current);
    if (!parent || parent === current) return null;
    current = parent;
  }
  return null;
}

function hasClaudeDir(p: string): boolean {
  return isDirectory(join(p, '.claude'));
}

function isDirectory(p: string): boolean {
  try { return statSync(p).isDirectory(); } catch { return false; }
}

function realpathSafe(p: string): string {
  try { return realpathSync(p); } catch { return resolve(p); }
}
