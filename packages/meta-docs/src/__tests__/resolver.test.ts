/**
 * resolver.test.ts — resolveProjectChain / normalizeCwd 특성화 테스트 (T05).
 *
 * @description
 *   현재 프로덕션 동작을 그대로 고정하는 characterization test.
 *   패키지 추출(T06) 전 안전망 확보가 목적이므로, 버그처럼 보여도 동작을 바꾸지
 *   않고 현재 출력을 기대값으로 못박는다.
 *
 *   resolveProjectChain: cwd → git root까지 거슬러 올라가며 `.claude/`가 있는 root를
 *   "cwd에 가까운 것부터" 수집. home 이상으로 올라가지 않음(보안). git root에 닿거나
 *   home에 닿으면 멈춤.
 *   normalizeCwd: realpathSync(resolve(cwd)). 실패 시 resolve(cwd) 폴백.
 *
 *   격리 전략:
 *     - node:os.homedir()는 bun에서 $HOME를 무시하므로 mock.module로 교체.
 *     - tmp 디렉토리는 realpathSync로 정규화(macOS /tmp → /private/tmp).
 *
 * @see packages/server/src/meta-docs/resolver.ts
 */

import { afterAll, afterEach, beforeEach, describe, expect, it, mock } from 'bun:test';
import * as realOs from 'node:os';

let FAKE_HOME = realOs.homedir();
mock.module('node:os', () => ({ ...realOs, homedir: () => FAKE_HOME }));

const { resolveProjectChain, normalizeCwd } = await import('../resolver');

const fs = require('fs') as typeof import('fs');
const path = require('path') as typeof import('path');

let BASE: string;   // realpath 정규화된 tmp 작업 베이스
let HOME: string;   // mock home (BASE 아래)

function mkdir(p: string): string { fs.mkdirSync(p, { recursive: true }); return p; }
function mkClaude(dir: string): void { fs.mkdirSync(path.join(dir, '.claude'), { recursive: true }); }
function mkGit(dir: string): void { fs.mkdirSync(path.join(dir, '.git'), { recursive: true }); }

beforeEach(() => {
  BASE = fs.realpathSync(fs.mkdtempSync('/tmp/spyglassResolver'));
  HOME = mkdir(path.join(BASE, 'home'));
  FAKE_HOME = HOME;
});

afterEach(() => {
  try { fs.rmSync(BASE, { recursive: true, force: true }); } catch {}
});

afterAll(() => { FAKE_HOME = realOs.homedir(); });

// =============================================================================
// normalizeCwd
// =============================================================================

describe('normalizeCwd', () => {
  it('실존 디렉토리 — realpath 정규화', () => {
    const dir = mkdir(path.join(HOME, 'proj'));
    expect(normalizeCwd(dir)).toBe(fs.realpathSync(dir));
  });

  it('심볼릭 링크 — 타깃 realpath로 정규화', () => {
    const target = mkdir(path.join(HOME, 'realproj'));
    const link = path.join(HOME, 'linkproj');
    fs.symlinkSync(target, link);
    // 현재 동작 고정: realpathSync가 링크를 타깃으로 해소
    expect(normalizeCwd(link)).toBe(fs.realpathSync(target));
  });

  it('존재하지 않는 경로 — realpath 실패 → resolve 폴백(절대경로 그대로)', () => {
    const ghost = path.join(HOME, 'does', 'not', 'exist');
    // 현재 동작 고정: realpath 실패 시 resolve(cwd) 반환 (정규화 없음)
    expect(normalizeCwd(ghost)).toBe(path.resolve(ghost));
  });

  it('상대경로 — resolve로 절대화', () => {
    // resolve는 process.cwd() 기준. 결과가 절대경로이기만 하면 됨(현재 동작 고정).
    const r = normalizeCwd('some/rel/path');
    expect(path.isAbsolute(r)).toBe(true);
  });
});

// =============================================================================
// resolveProjectChain — 엣지/경계 먼저
// =============================================================================

describe('resolveProjectChain — 경계/엣지', () => {
  it('cwd === home — source_roots 비어있고 home은 chain에 안 들어감', () => {
    // home 자체에 .claude가 있어도 while 루프 진입 즉시 break (resolver.ts:71)
    mkClaude(HOME);
    const chain = resolveProjectChain(HOME);
    expect(chain.source_roots).toEqual([]);
    // user_root는 home/.claude 가 존재하므로 채워짐
    expect(chain.user_root).toBe(path.join(HOME, '.claude'));
  });

  it('home/.claude 없음 → user_root=null', () => {
    const proj = mkdir(path.join(HOME, 'proj'));
    const chain = resolveProjectChain(proj);
    expect(chain.user_root).toBeNull();
  });

  it('.claude 없는 cwd (git root도 없음) → source_roots 빈 배열', () => {
    const proj = mkdir(path.join(HOME, 'plain', 'nested'));
    const chain = resolveProjectChain(proj);
    expect(chain.source_roots).toEqual([]);
  });

  it('home 위로는 절대 올라가지 않음 — home 밖 .claude는 수집 안 함', () => {
    // BASE(=home의 부모)에 .claude를 둬도 home 경계에서 break → 수집 안 됨
    mkClaude(BASE);
    const proj = mkdir(path.join(HOME, 'proj'));
    const chain = resolveProjectChain(proj);
    expect(chain.source_roots).toEqual([]);
  });
});

// =============================================================================
// resolveProjectChain — git root 탐지 + chain 정렬
// =============================================================================

describe('resolveProjectChain — git root + 정렬', () => {
  it('cwd 자체가 .claude+.git 보유 → 자기 자신 1개', () => {
    const repo = mkdir(path.join(HOME, 'repo'));
    mkClaude(repo);
    mkGit(repo);
    const chain = resolveProjectChain(repo);
    expect(chain.source_roots).toEqual([fs.realpathSync(repo)]);
  });

  it('git root까지 올라가며 .claude 보유 root만 수집 (deepest first 정렬)', () => {
    // repo(.git, .claude) / sub(.claude) / deep(.claude 없음) ← cwd=deep
    const repo = mkdir(path.join(HOME, 'repo'));
    mkGit(repo);
    mkClaude(repo);
    const sub = mkdir(path.join(repo, 'sub'));
    mkClaude(sub);
    const deep = mkdir(path.join(sub, 'deep')); // .claude 없음
    const chain = resolveProjectChain(deep);
    // 현재 동작 고정: cwd에 가까운 sub가 먼저, 그 다음 repo (git root). deep은 .claude 없어 제외.
    expect(chain.source_roots).toEqual([fs.realpathSync(sub), fs.realpathSync(repo)]);
  });

  it('git root에 도달하면 멈춤 — git root 위 .claude는 수집 안 함', () => {
    // home/outer(.claude) / home/outer/repo(.git, .claude) ← cwd=repo
    const outer = mkdir(path.join(HOME, 'outer'));
    mkClaude(outer);
    const repo = mkdir(path.join(outer, 'repo'));
    mkGit(repo);
    mkClaude(repo);
    const chain = resolveProjectChain(repo);
    // 현재 동작 고정: repo가 git root이므로 push 후 break → outer는 포함 안 됨
    expect(chain.source_roots).toEqual([fs.realpathSync(repo)]);
  });

  it('git root 없음 → home 직전까지 탐색하며 .claude 수집', () => {
    // home/a(.claude) / home/a/b(.claude) ← cwd=b, git 없음
    const a = mkdir(path.join(HOME, 'a'));
    mkClaude(a);
    const b = mkdir(path.join(a, 'b'));
    mkClaude(b);
    const chain = resolveProjectChain(b);
    // 현재 동작 고정: b, a 순(deepest first). home에서 break.
    expect(chain.source_roots).toEqual([fs.realpathSync(b), fs.realpathSync(a)]);
  });

  it('.git이 파일(워크트리)이어도 git root로 인정', () => {
    // findGitRoot는 existsSync(join(p,'.git'))만 검사 → 파일/디렉토리 무관 (resolver.ts:94)
    const repo = mkdir(path.join(HOME, 'wt'));
    fs.writeFileSync(path.join(repo, '.git'), 'gitdir: /somewhere/.git/worktrees/wt\n');
    mkClaude(repo);
    const sub = mkdir(path.join(repo, 'sub'));
    mkClaude(sub);
    const chain = resolveProjectChain(sub);
    expect(chain.source_roots).toEqual([fs.realpathSync(sub), fs.realpathSync(repo)]);
  });

  it('git root가 cwd보다 깊은 경우는 없음 — findGitRoot는 cwd부터 위로만 탐색', () => {
    // home/repo(.git,.claude)/sub(.claude 없음, 자식에 .git) — 자식 .git은 무시
    const repo = mkdir(path.join(HOME, 'repo'));
    mkGit(repo);
    mkClaude(repo);
    const child = mkdir(path.join(repo, 'child'));
    mkGit(child); // cwd가 repo면 child의 .git은 안 봄
    const chain = resolveProjectChain(repo);
    expect(chain.source_roots).toEqual([fs.realpathSync(repo)]);
  });
});
