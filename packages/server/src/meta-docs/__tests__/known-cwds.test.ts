/**
 * known-cwds.test.ts — discoverKnownCwds 특성화 테스트 (T05).
 *
 * @description
 *   현재 프로덕션 동작을 그대로 고정하는 characterization test.
 *   패키지 추출(T06) 전 안전망 확보가 목적이므로, 버그처럼 보여도 동작을 바꾸지
 *   않고 현재 출력을 기대값으로 못박는다.
 *
 *   discoverKnownCwds는 두 소스에서 cwd 후보를 모은다:
 *     1) meta_doc_resolutions.cwd (in-memory sqlite로 제어)
 *     2) ~/.claude/projects/<encoded> 디렉토리 (tmp home으로 제어)
 *
 *   내부 함수 generateMergeVariants(2^k 하이픈 디코딩) / decodeProjectsDir /
 *   addIfValid(home 경계 보안 가드)는 export되지 않으므로, 공개 표면
 *   discoverKnownCwds를 통해 디스크 레이아웃을 구성해 간접 특성화한다.
 *
 *   격리 전략:
 *     - node:os.homedir()는 bun에서 $HOME를 무시하므로 mock.module로 교체.
 *     - tmp home은 realpathSync로 정규화(macOS /tmp → /private/tmp 심볼릭 링크).
 *       known-cwds의 realpathSafe도 동일 정규화를 하므로 기대값을 realpath로 맞춘다.
 *
 * @see packages/server/src/meta-docs/known-cwds.ts
 */

import { afterAll, afterEach, beforeEach, describe, expect, it, mock } from 'bun:test';
import * as realOs from 'node:os';

// homedir()만 교체하고 나머지 node:os API는 그대로 통과시킨다.
// FAKE_HOME은 각 테스트가 setHome()으로 갱신한다(closure가 호출 시점 값을 읽음).
let FAKE_HOME = realOs.homedir();
mock.module('node:os', () => ({ ...realOs, homedir: () => FAKE_HOME }));

// mock.module 이후 동적 import — 모듈 내부 homedir 바인딩이 mock을 가리키도록.
const { discoverKnownCwds } = await import('../known-cwds');
import { SpyglassDatabase, closeDatabase } from '@spyglass/storage';

const fs = require('fs') as typeof import('fs');
const path = require('path') as typeof import('path');

const TEST_DB_PATH = `/tmp/spyglass-known-cwds-${Date.now()}.db`;
// 모든 tmp 디렉토리는 이 베이스 아래에 만들고 afterEach에서 통째로 지운다.
// realpathSync로 정규화(여기서 만든 dir이 실제 존재하도록 먼저 생성).
//
// 중요(현재 동작 고정): generateMergeVariants는 경로의 "마지막 5개 segment"만
// 하이픈 머지 후보로 만들고, 그 앞(head) segment의 '-'는 영구적으로 '/'로 분해된다.
// 따라서 tmp home 경로에 '-'가 들어가면 head 디코딩이 깨져 워크스페이스를 못 찾는다.
// 실제 home(`/Users/<user>`)은 보통 하이픈이 없으므로 프로덕션에서는 동작한다.
// 테스트도 이를 모사하기 위해 '-' 없는 mkdtemp prefix(camelCase)를 쓴다.
let HOME_BASE: string;
let db: SpyglassDatabase;

/** tmp home을 새로 만들고 mock homedir가 그 realpath를 가리키도록 설정. */
function setHome(dir: string): string {
  fs.mkdirSync(dir, { recursive: true });
  const real = fs.realpathSync(dir);
  FAKE_HOME = real;
  return real;
}

/** ~/.claude/projects/<encoded> 디렉토리 생성. */
function makeProjectsEntry(home: string, encoded: string): void {
  fs.mkdirSync(path.join(home, '.claude', 'projects', encoded), { recursive: true });
}

/** <dir>/.claude 디렉토리 생성(워크스페이스로 인정받기 위한 조건). */
function makeWorkspaceWithClaude(dir: string): void {
  fs.mkdirSync(path.join(dir, '.claude'), { recursive: true });
}

beforeEach(() => {
  db = new SpyglassDatabase({ dbPath: TEST_DB_PATH, autoInit: true });
  // 하이픈 없는 prefix — generateMergeVariants head 디코딩 보존(위 주석 참고).
  HOME_BASE = fs.mkdtempSync('/tmp/spyglassKcHome');
});

afterEach(() => {
  closeDatabase();
  for (const ext of ['', '-wal', '-shm']) {
    try { fs.unlinkSync(TEST_DB_PATH + ext); } catch {}
  }
  try { fs.rmSync(HOME_BASE, { recursive: true, force: true }); } catch {}
});

afterAll(() => {
  FAKE_HOME = realOs.homedir();
});

/** meta_doc_resolutions에 cwd 행 1개 삽입(meta_document_id FK 필요 → 더미 doc 먼저). */
function insertResolutionCwd(cwd: string): void {
  const docId = db.instance.query(
    `INSERT INTO meta_documents (type, name, source, source_root, file_path, description, user_invocable, frontmatter_json, first_seen_at, last_seen_at)
     VALUES ('skill','dummy','projectSettings',?,?,NULL,0,NULL,0,0) RETURNING id`,
  ).get(cwd, `${cwd}/.claude/skills/dummy/SKILL.md`) as { id: number };
  db.instance.query(
    `INSERT INTO meta_doc_resolutions (cwd, type, name, meta_document_id) VALUES (?, 'skill', 'dummy', ?)`,
  ).run(cwd, docId.id);
}

// =============================================================================
// 엣지 / 경계 / 보안 — 실패 케이스 먼저 (red 확인 후 현재 출력으로 고정)
// =============================================================================

describe('discoverKnownCwds — 빈/없음 케이스', () => {
  it('resolutions 0건 + projects 디렉토리 없음 → 빈 배열', () => {
    const home = setHome(path.join(HOME_BASE, 'home-empty'));
    // .claude/projects 자체가 없음 → readdirSync catch → []
    expect(fs.existsSync(path.join(home, '.claude', 'projects'))).toBe(false);
    const r = discoverKnownCwds(db.instance);
    expect(r).toEqual([]);
  });

  it('projects 디렉토리는 있으나 엔트리 0개 → 빈 배열', () => {
    const home = setHome(path.join(HOME_BASE, 'home-noentry'));
    fs.mkdirSync(path.join(home, '.claude', 'projects'), { recursive: true });
    const r = discoverKnownCwds(db.instance);
    expect(r).toEqual([]);
  });

  it("'-'로 시작하지 않는 엔트리는 무시", () => {
    const home = setHome(path.join(HOME_BASE, 'home-nodash'));
    // encoded 규약상 선두 '-'가 없는 디렉토리는 skip (known-cwds.ts:101)
    fs.mkdirSync(path.join(home, '.claude', 'projects', 'plain-no-leading-dash'), { recursive: true });
    fs.mkdirSync(path.join(home, 'IdeaProjects', 'x', '.claude'), { recursive: true });
    const r = discoverKnownCwds(db.instance);
    expect(r).toEqual([]);
  });
});

describe('discoverKnownCwds — addIfValid 보안 가드', () => {
  it('home 자체는 글로벌 영역 → 제외 (resolution이 home을 가리켜도 거부)', () => {
    const home = setHome(path.join(HOME_BASE, 'home-self'));
    // home 자체에 .claude를 둬도, normalized === home 이면 거부 (known-cwds.ts:174)
    fs.mkdirSync(path.join(home, '.claude'), { recursive: true });
    insertResolutionCwd(home);
    const r = discoverKnownCwds(db.instance);
    expect(r).toEqual([]);
  });

  it('home 외부 경로는 거부 (보안: startsWith(home + "/") 아님)', () => {
    setHome(path.join(HOME_BASE, 'home-outside'));
    // home 밖의 실제 워크스페이스를 resolution으로 주입 → home 경계에서 거부
    const outside = fs.mkdtempSync('/tmp/spyglass-kc-outside-');
    try {
      fs.mkdirSync(path.join(outside, '.claude'), { recursive: true });
      insertResolutionCwd(fs.realpathSync(outside));
      const r = discoverKnownCwds(db.instance);
      expect(r).toEqual([]);
    } finally {
      fs.rmSync(outside, { recursive: true, force: true });
    }
  });

  it('home prefix를 공유하지만 형제 디렉토리인 경로 거부 (home + "/" 경계 정확성)', () => {
    // home = /tmp/.../home-prefix, sibling = /tmp/.../home-prefix-evil
    // sibling은 home 문자열로 시작하지만 home + '/' 로는 시작하지 않음 → 거부.
    const home = setHome(path.join(HOME_BASE, 'home-prefix'));
    const sibling = home + '-evil';
    fs.mkdirSync(path.join(sibling, '.claude'), { recursive: true });
    insertResolutionCwd(fs.realpathSync(sibling));
    const r = discoverKnownCwds(db.instance);
    // 현재 동작 고정: prefix 공유 형제는 home + '/' 가드로 거부됨
    expect(r).toEqual([]);
    fs.rmSync(sibling, { recursive: true, force: true });
  });

  it('home 하위지만 .claude 디렉토리가 없으면 거부', () => {
    const home = setHome(path.join(HOME_BASE, 'home-noclaude'));
    const ws = path.join(home, 'IdeaProjects', 'plain');
    fs.mkdirSync(ws, { recursive: true }); // .claude 없음
    insertResolutionCwd(ws);
    const r = discoverKnownCwds(db.instance);
    expect(r).toEqual([]);
  });

  it('home 하위 + .claude 존재 → 채택 (resolution 소스 경유)', () => {
    const home = setHome(path.join(HOME_BASE, 'home-valid'));
    const ws = path.join(home, 'IdeaProjects', 'good');
    makeWorkspaceWithClaude(ws);
    insertResolutionCwd(ws);
    const r = discoverKnownCwds(db.instance);
    expect(r).toEqual([fs.realpathSync(ws)]);
  });

  it('candidate가 디스크에 없으면 realpath 폴백 후 .claude 검사에서 거부', () => {
    const home = setHome(path.join(HOME_BASE, 'home-ghost'));
    // 존재하지 않는 경로를 resolution으로 주입 — realpathSafe가 resolve로 폴백하지만
    // 이후 .claude 디렉토리 검사에서 탈락(현재 동작 고정).
    insertResolutionCwd(path.join(home, 'IdeaProjects', 'ghost'));
    const r = discoverKnownCwds(db.instance);
    expect(r).toEqual([]);
  });
});

describe('discoverKnownCwds — resolutions 테이블 폴백', () => {
  it('meta_doc_resolutions 테이블이 없으면 best-effort 빈 결과(throw 안 함)', () => {
    setHome(path.join(HOME_BASE, 'home-notable'));
    // 테이블 드롭 후에도 fetchResolutionCwds가 catch로 []를 반환해야 함.
    db.instance.query('DROP TABLE meta_doc_resolutions').run();
    const r = discoverKnownCwds(db.instance);
    expect(r).toEqual([]);
  });
});

// =============================================================================
// generateMergeVariants — 2^k 하이픈 디코딩 (가장 회귀 위험 큼)
// =============================================================================

describe('discoverKnownCwds — 하이픈 디코딩(merge variants)', () => {
  // 주의: 아래 테스트들은 home/중간 segment에 '-'가 없어야 한다.
  // generateMergeVariants가 마지막 5개 segment만 머지하므로 head의 '-'는 복원 불가.
  it('하이픈 없는 단순 경로 — 정확 디코드', () => {
    const home = setHome(path.join(HOME_BASE, 'homeSimple'));
    const ws = path.join(home, 'IdeaProjects', 'plainproj');
    makeWorkspaceWithClaude(ws);
    // encoded = home의 절대경로 segment + IdeaProjects + plainproj 를 '/'→'-'
    const encoded = ws.replace(/\//g, '-');
    makeProjectsEntry(home, encoded);
    const r = discoverKnownCwds(db.instance);
    expect(r).toEqual([fs.realpathSync(ws)]);
  });

  it('다중 하이픈 워크스페이스명(claude-code-system) — 머지 변형 중 정답 1개 채택', () => {
    const home = setHome(path.join(HOME_BASE, 'homeMulti'));
    const ws = path.join(home, 'proj', 'claude-code-system');
    makeWorkspaceWithClaude(ws);
    // claude-code-system이 '/'→'-' 인코딩되면 claude/code/system 와 구분 불가.
    // 2^k 변형 중 실제 디스크 + .claude 존재하는 후보만 addIfValid 통과.
    // (워크스페이스명이 마지막 5 segment tail window 안에 있어야 머지로 복원됨 — 현재 동작 고정)
    const encoded = ws.replace(/\//g, '-');
    makeProjectsEntry(home, encoded);
    const r = discoverKnownCwds(db.instance);
    expect(r).toEqual([fs.realpathSync(ws)]);
  });

  it('동일 인코딩에서 슬래시 분할/하이픈 머지 둘 다 존재 시 둘 다 채택(set dedupe)', () => {
    const home = setHome(path.join(HOME_BASE, 'homeBoth'));
    // aa/bb/cc-dd 와 aa/bb/cc/dd 가 모두 디스크에 .claude로 존재하면
    // 인코딩 '...-aa-bb-cc-dd'는 두 후보를 모두 만들고 둘 다 valid → 둘 다 포함(정렬).
    const wsHyphen = path.join(home, 'aa', 'bb', 'cc-dd');
    const wsSlash = path.join(home, 'aa', 'bb', 'cc', 'dd');
    makeWorkspaceWithClaude(wsHyphen);
    makeWorkspaceWithClaude(wsSlash);
    makeProjectsEntry(home, wsHyphen.replace(/\//g, '-'));
    const r = discoverKnownCwds(db.instance);
    // 현재 동작 고정: 두 해석 모두 valid → 둘 다 발견(사전순 정렬)
    const expected = [fs.realpathSync(wsHyphen), fs.realpathSync(wsSlash)].sort();
    expect(r.slice().sort()).toEqual(expected);
  });

  it('결과는 사전순 정렬 + dedupe (Set)', () => {
    const home = setHome(path.join(HOME_BASE, 'homeSort'));
    const wsZ = path.join(home, 'proj', 'zeta');
    const wsA = path.join(home, 'proj', 'alpha');
    makeWorkspaceWithClaude(wsZ);
    makeWorkspaceWithClaude(wsA);
    // 같은 cwd를 resolution + projects 양쪽에서 주입 → dedupe 확인
    insertResolutionCwd(wsZ);
    makeProjectsEntry(home, wsZ.replace(/\//g, '-'));
    makeProjectsEntry(home, wsA.replace(/\//g, '-'));
    const r = discoverKnownCwds(db.instance);
    expect(r).toEqual([fs.realpathSync(wsA), fs.realpathSync(wsZ)]);
  });
});
