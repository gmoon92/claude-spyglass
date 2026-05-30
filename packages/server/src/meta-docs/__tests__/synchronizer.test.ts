/**
 * synchronizer.test.ts — syncCwd / syncGlobalOnce / bootstrapSync / syncAllKnownCwds /
 *                         pruneDeadSourceRoots + computeResolutions 우선순위 특성화 테스트 (T05).
 *
 * @description
 *   현재 프로덕션 동작을 그대로 고정하는 characterization test.
 *   패키지 추출(T06) 전 안전망 확보가 목적이므로, 버그처럼 보여도 동작을 바꾸지
 *   않고 현재 출력을 기대값으로 못박는다.
 *
 *   동기화는 scanner + resolver + storage(meta_documents / meta_doc_resolutions)를 결합한다.
 *   모듈 전역 throttle 상태(lastGlobalSyncAt, recentSyncByCwd)의 동작도 고정한다.
 *
 *   격리/결정성 전략:
 *     - node:os.homedir()를 mock.module로 tmp home으로 교체(resolver/scanner 공통).
 *     - 각 테스트는 beforeEach에서 새 tmp home을 만들어 recentSyncByCwd 키 충돌을 피한다
 *       (tmp 경로가 매번 달라 cwd throttle 키가 겹치지 않음).
 *     - lastGlobalSyncAt은 모듈 전역 단일값 — 파일 내 테스트 순서에 의존하지 않도록
 *       "force=true는 항상 동작, 직후 non-force는 항상 skip" 형태로만 throttle을 검증한다.
 *     - DB는 file sqlite(T01 패턴) 사용.
 *
 * @see packages/server/src/meta-docs/synchronizer.ts
 */

import { afterAll, afterEach, beforeEach, describe, expect, it, mock } from 'bun:test';
import * as realOs from 'node:os';

let FAKE_HOME = realOs.homedir();
mock.module('node:os', () => ({ ...realOs, homedir: () => FAKE_HOME }));

const {
  syncCwd,
  syncGlobalOnce,
  bootstrapSync,
  syncAllKnownCwds,
  pruneDeadSourceRoots,
} = await import('../synchronizer');
import { SpyglassDatabase, closeDatabase, countMetaDocs } from '@spyglass/storage';

const fs = require('fs') as typeof import('fs');
const path = require('path') as typeof import('path');

const TEST_DB_PATH = `/tmp/spyglass-sync-${Date.now()}.db`;
let db: SpyglassDatabase;
let HOME: string;       // realpath 정규화된 mock home
let HOME_BASE: string;  // tmp 베이스(정리용)

function mkClaudeDoc(root: string, sub: 'agents' | 'skills' | 'commands', name: string, body = '---\nname: ' + name + '\n---\n'): void {
  if (sub === 'skills') {
    const dir = path.join(root, '.claude', 'skills', name);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'SKILL.md'), body);
  } else {
    const dir = path.join(root, '.claude', sub);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, `${name}.md`), body);
  }
}

function mkGit(dir: string): void { fs.mkdirSync(path.join(dir, '.git'), { recursive: true }); }

/** meta_doc_resolutions에서 특정 cwd의 (type,name)→meta_document_id 매핑 조회. */
function resolutionsFor(cwd: string): Array<{ type: string; name: string; meta_document_id: number }> {
  return db.instance.query(
    'SELECT type, name, meta_document_id FROM meta_doc_resolutions WHERE cwd = ? ORDER BY type, name',
  ).all(cwd) as Array<{ type: string; name: string; meta_document_id: number }>;
}

beforeEach(() => {
  db = new SpyglassDatabase({ dbPath: TEST_DB_PATH, autoInit: true });
  HOME_BASE = fs.mkdtempSync('/tmp/spyglassSyncHome');
  HOME = fs.realpathSync(fs.mkdirSync(path.join(HOME_BASE, 'home'), { recursive: true })!);
  // mkdirSync recursive는 첫 생성 경로를 반환하지만 환경에 따라 undefined일 수 있어 보정.
  HOME = fs.realpathSync(path.join(HOME_BASE, 'home'));
  FAKE_HOME = HOME;
});

afterEach(() => {
  closeDatabase();
  for (const ext of ['', '-wal', '-shm']) {
    try { fs.unlinkSync(TEST_DB_PATH + ext); } catch {}
  }
  try { fs.rmSync(HOME_BASE, { recursive: true, force: true }); } catch {}
});

afterAll(() => { FAKE_HOME = realOs.homedir(); });

// =============================================================================
// syncGlobalOnce
// =============================================================================

describe('syncGlobalOnce', () => {
  it('~/.claude 비어있음 → scanned 0', () => {
    const r = syncGlobalOnce(db.instance, { force: true });
    expect(r.scanned).toBe(0);
    expect(r.upserted).toBe(0);
  });

  it('~/.claude 정의 존재 → userSettings로 upsert', () => {
    mkClaudeDoc(HOME, 'skills', 'userskill', '---\nname: userskill\ndescription: u\n---\n');
    mkClaudeDoc(HOME, 'agents', 'useragent');
    const r = syncGlobalOnce(db.instance, { force: true });
    expect(r.scanned).toBe(2);
    expect(r.upserted).toBe(2);
    const c = countMetaDocs(db.instance);
    expect(c.active).toBe(2);
  });

  it('throttle — force 직후 non-force 호출은 skip (scanned 0)', () => {
    mkClaudeDoc(HOME, 'agents', 'a1');
    // force는 항상 동작 → lastGlobalSyncAt 갱신
    const forced = syncGlobalOnce(db.instance, { force: true });
    expect(forced.scanned).toBe(1);
    // 직후 non-force는 60s throttle에 걸려 skip (현재 동작 고정)
    const throttled = syncGlobalOnce(db.instance);
    expect(throttled).toEqual({ scanned: 0, upserted: 0, softDeleted: 0, resolutions: 0, durationMs: 0 });
  });

  it('재스캔에서 사라진 user 정의는 soft-delete (최소 1개 잔존 시)', () => {
    mkClaudeDoc(HOME, 'agents', 'willvanish');
    mkClaudeDoc(HOME, 'agents', 'survivor');
    syncGlobalOnce(db.instance, { force: true });
    expect(countMetaDocs(db.instance).active).toBe(2);
    // willvanish만 삭제 후 재동기화 → soft-delete (survivor가 남아 candidates>0 → delete 경로 실행)
    fs.rmSync(path.join(HOME, '.claude', 'agents', 'willvanish.md'));
    const r = syncGlobalOnce(db.instance, { force: true });
    expect(r.scanned).toBe(1);
    expect(r.softDeleted).toBe(1);
    const c = countMetaDocs(db.instance);
    expect(c.active).toBe(1);
    expect(c.deleted).toBe(1);
  });

  it('user 정의 전부 사라지면 soft-delete 스킵 (현재 동작 고정 — 추후 검토)', () => {
    mkClaudeDoc(HOME, 'agents', 'lonely');
    syncGlobalOnce(db.instance, { force: true });
    expect(countMetaDocs(db.instance).active).toBe(1);
    // 모든 user 정의 삭제 → scanGlobalUserDir() 빈 배열 → 이른 return으로 markMissingAsDeleted 미호출.
    // 현재 동작 고정 — 추후 검토: candidates.length===0 분기(synchronizer.ts:153-155)가
    //   soft-delete를 건너뛰므로, 기존 행이 active로 남는다(ghost로 잔존).
    fs.rmSync(path.join(HOME, '.claude', 'agents', 'lonely.md'));
    const r = syncGlobalOnce(db.instance, { force: true });
    expect(r.scanned).toBe(0);
    expect(r.softDeleted).toBe(0);
    expect(countMetaDocs(db.instance).active).toBe(1); // 삭제되지 않고 그대로 active
  });
});

// =============================================================================
// syncCwd — chain 스캔 + upsert + resolution
// =============================================================================

describe('syncCwd', () => {
  it('.claude 없는 cwd → scanned 0, resolutions 0', () => {
    const proj = path.join(HOME, 'empty');
    fs.mkdirSync(proj, { recursive: true });
    const r = syncCwd(db.instance, proj, { force: true });
    expect(r.scanned).toBe(0);
    expect(r.resolutions).toBe(0);
  });

  it('단일 repo(.git+.claude) — upsert + projectSettings resolution', () => {
    const repo = path.join(HOME, 'repo');
    fs.mkdirSync(repo, { recursive: true });
    mkGit(repo);
    mkClaudeDoc(repo, 'agents', 'builder', '---\nname: builder\ndescription: b\n---\n');
    mkClaudeDoc(repo, 'commands', 'ship');
    const r = syncCwd(db.instance, repo, { force: true });
    expect(r.scanned).toBe(2);
    expect(r.upserted).toBe(2);
    expect(r.resolutions).toBe(2);
    const real = fs.realpathSync(repo);
    const res = resolutionsFor(real);
    expect(res.map(x => `${x.type}:${x.name}`).sort()).toEqual(['agent:builder', 'command:ship']);
  });

  it('throttle — force 없이 같은 cwd 5초 내 재호출은 skip', () => {
    const repo = path.join(HOME, 'repo');
    fs.mkdirSync(repo, { recursive: true });
    mkGit(repo);
    mkClaudeDoc(repo, 'agents', 'a');
    // 첫 호출(force 없이) — 실제 동작
    const first = syncCwd(db.instance, repo);
    expect(first.scanned).toBe(1);
    // 직후 같은 cwd 재호출 — 5s throttle skip (현재 동작 고정)
    const second = syncCwd(db.instance, repo);
    expect(second).toEqual({ scanned: 0, upserted: 0, softDeleted: 0, resolutions: 0, durationMs: 0 });
  });

  it('force=true는 throttle 우회', () => {
    const repo = path.join(HOME, 'repo');
    fs.mkdirSync(repo, { recursive: true });
    mkGit(repo);
    mkClaudeDoc(repo, 'agents', 'a');
    const first = syncCwd(db.instance, repo, { force: true });
    expect(first.scanned).toBe(1);
    const second = syncCwd(db.instance, repo, { force: true });
    // 현재 동작 고정: force면 다시 스캔 (upsert는 동일 행 갱신)
    expect(second.scanned).toBe(1);
  });

  it('재스캔에서 사라진 project 정의는 해당 source_root에서 soft-delete', () => {
    const repo = path.join(HOME, 'repo');
    fs.mkdirSync(repo, { recursive: true });
    mkGit(repo);
    mkClaudeDoc(repo, 'agents', 'keep');
    mkClaudeDoc(repo, 'agents', 'drop');
    syncCwd(db.instance, repo, { force: true });
    expect(countMetaDocs(db.instance).active).toBe(2);
    fs.rmSync(path.join(repo, '.claude', 'agents', 'drop.md'));
    const r = syncCwd(db.instance, repo, { force: true });
    expect(r.softDeleted).toBe(1);
    expect(countMetaDocs(db.instance).active).toBe(1);
  });
});

// =============================================================================
// computeResolutions — 우선순위 (deepest project > user)
// =============================================================================

describe('computeResolutions 우선순위 (via syncCwd)', () => {
  it('deepest project가 user보다 우선 (동일 type:name)', () => {
    // user(~/.claude)와 deepest repo 양쪽에 skill 'shared'.
    mkClaudeDoc(HOME, 'skills', 'shared', '---\nname: shared\ndescription: user-version\n---\n');
    syncGlobalOnce(db.instance, { force: true }); // user 카탈로그 채움 (resolution은 user 단계에서 참조)

    const repo = path.join(HOME, 'repo');
    fs.mkdirSync(repo, { recursive: true });
    mkGit(repo);
    mkClaudeDoc(repo, 'skills', 'shared', '---\nname: shared\ndescription: project-version\n---\n');

    syncCwd(db.instance, repo, { force: true });

    const real = fs.realpathSync(repo);
    const res = resolutionsFor(real);
    const shared = res.find(x => x.type === 'skill' && x.name === 'shared')!;
    // shared가 가리키는 doc은 PROJECT 행이어야 함 (deepest project 우선 — synchronizer.ts:319-330)
    const projectDocId = db.instance.query(
      `SELECT id FROM meta_documents WHERE type='skill' AND name='shared' AND source='projectSettings' AND source_root=? AND deleted_at IS NULL`,
    ).get(real) as { id: number };
    expect(shared.meta_document_id).toBe(projectDocId.id);
  });

  it('project에 없고 user에만 있는 정의 → user 행으로 resolution', () => {
    mkClaudeDoc(HOME, 'agents', 'useronly', '---\nname: useronly\n---\n');
    syncGlobalOnce(db.instance, { force: true });

    const repo = path.join(HOME, 'repo');
    fs.mkdirSync(repo, { recursive: true });
    mkGit(repo);
    mkClaudeDoc(repo, 'agents', 'projonly');

    syncCwd(db.instance, repo, { force: true });
    const real = fs.realpathSync(repo);
    const res = resolutionsFor(real);
    // 현재 동작 고정: projonly(project) + useronly(user) 둘 다 resolution에 포함
    expect(res.map(x => x.name).sort()).toEqual(['projonly', 'useronly']);
    const userDoc = db.instance.query(
      `SELECT id FROM meta_documents WHERE type='agent' AND name='useronly' AND source='userSettings' AND deleted_at IS NULL`,
    ).get() as { id: number };
    const useronly = res.find(x => x.name === 'useronly')!;
    expect(useronly.meta_document_id).toBe(userDoc.id);
  });

  it('chain의 더 얕은 root는 deepest와 같은 이름이면 resolution에서 밀림(seen dedup)', () => {
    // repo(.git,.claude:skill X) / repo/sub(.claude:skill X) ← cwd=sub
    const repo = path.join(HOME, 'repo');
    fs.mkdirSync(repo, { recursive: true });
    mkGit(repo);
    mkClaudeDoc(repo, 'skills', 'dup', '---\nname: dup\ndescription: outer\n---\n');
    const sub = path.join(repo, 'sub');
    fs.mkdirSync(sub, { recursive: true });
    mkClaudeDoc(sub, 'skills', 'dup', '---\nname: dup\ndescription: inner\n---\n');

    syncCwd(db.instance, sub, { force: true });
    const real = fs.realpathSync(sub);
    const res = resolutionsFor(real);
    // dup은 1개만 (deepest=sub 우선). 두 행 모두 upsert되지만 resolution은 1개.
    expect(res.filter(x => x.name === 'dup')).toHaveLength(1);
    const subDoc = db.instance.query(
      `SELECT id FROM meta_documents WHERE type='skill' AND name='dup' AND source='projectSettings' AND source_root=? AND deleted_at IS NULL`,
    ).get(real) as { id: number };
    expect(res.find(x => x.name === 'dup')!.meta_document_id).toBe(subDoc.id);
  });
});

// =============================================================================
// pruneDeadSourceRoots
// =============================================================================

describe('pruneDeadSourceRoots', () => {
  it('디렉토리 미존재 source_root는 soft-delete, 존재하면 유지', () => {
    // 존재하는 repo 동기화
    const repo = path.join(HOME, 'liverepo');
    fs.mkdirSync(repo, { recursive: true });
    mkGit(repo);
    mkClaudeDoc(repo, 'agents', 'live');
    syncCwd(db.instance, repo, { force: true });
    const liveRoot = fs.realpathSync(repo);

    // ghost source_root를 가진 projectSettings 행 직접 주입(디렉토리 없음)
    const ghostRoot = path.join(HOME, 'ghostrepo');
    db.instance.query(
      `INSERT INTO meta_documents (type, name, source, source_root, file_path, description, user_invocable, frontmatter_json, first_seen_at, last_seen_at)
       VALUES ('agent','ghost','projectSettings',?,?,NULL,0,NULL,0,0)`,
    ).run(ghostRoot, `${ghostRoot}/.claude/agents/ghost.md`);

    const pruned = pruneDeadSourceRoots(db.instance);
    expect(pruned).toContain(ghostRoot);
    expect(pruned).not.toContain(liveRoot);

    // ghost 행은 soft-delete, live 행은 유지
    const ghostRow = db.instance.query(
      `SELECT deleted_at FROM meta_documents WHERE source_root=?`,
    ).get(ghostRoot) as { deleted_at: number | null };
    expect(ghostRow.deleted_at).not.toBeNull();
    const liveRow = db.instance.query(
      `SELECT deleted_at FROM meta_documents WHERE source_root=?`,
    ).get(liveRoot) as { deleted_at: number | null };
    expect(liveRow.deleted_at).toBeNull();
  });

  it('정리할 ghost 없으면 빈 배열', () => {
    const repo = path.join(HOME, 'repo');
    fs.mkdirSync(repo, { recursive: true });
    mkGit(repo);
    mkClaudeDoc(repo, 'agents', 'a');
    syncCwd(db.instance, repo, { force: true });
    expect(pruneDeadSourceRoots(db.instance)).toEqual([]);
  });
});

// =============================================================================
// bootstrapSync / syncAllKnownCwds
// =============================================================================

describe('bootstrapSync', () => {
  it('throw 없이 prune + global + activeCwds 동기화', () => {
    mkClaudeDoc(HOME, 'agents', 'globalagent');
    const repo = path.join(HOME, 'repo');
    fs.mkdirSync(repo, { recursive: true });
    mkGit(repo);
    mkClaudeDoc(repo, 'agents', 'projagent');

    // 예외 없이 완료되어야 함 (반환값 void)
    expect(() => bootstrapSync(db.instance, { activeCwds: [repo] })).not.toThrow();

    // global(userSettings) + project(projectSettings) 모두 카탈로그에 존재
    const c = countMetaDocs(db.instance);
    expect(c.active).toBeGreaterThanOrEqual(2);
  });

  it('activeCwds 없이 호출해도 안전', () => {
    expect(() => bootstrapSync(db.instance)).not.toThrow();
  });
});

describe('syncAllKnownCwds', () => {
  it('discoverKnownCwds 결과 각각에 syncCwd — per-cwd 결과 격리', () => {
    // resolution 소스로 알려진 cwd 1개 만들기: repo를 먼저 syncCwd해 resolution 등록
    const repo = path.join(HOME, 'repo');
    fs.mkdirSync(repo, { recursive: true });
    mkGit(repo);
    mkClaudeDoc(repo, 'agents', 'known');
    syncCwd(db.instance, repo, { force: true }); // meta_doc_resolutions.cwd에 repo 등록됨

    const r = syncAllKnownCwds(db.instance, { force: true });
    // discoverKnownCwds가 repo를 찾아 다시 sync — scanned는 발견 cwd 수
    expect(r.scanned).toBeGreaterThanOrEqual(1);
    // 각 항목은 result 또는 error 중 하나를 가짐(에러 격리 구조 — synchronizer.ts:259-268)
    for (const item of r.cwds) {
      expect(item.cwd).toBeTruthy();
      const hasResultXorError = (item.result !== undefined) !== (item.error !== undefined);
      expect(hasResultXorError).toBe(true);
    }
    const real = fs.realpathSync(repo);
    expect(r.cwds.some(x => x.cwd === real)).toBe(true);
  });

  it('알려진 cwd 0개 → scanned 0, 빈 결과', () => {
    // resolution 없음 + ~/.claude/projects 없음
    const r = syncAllKnownCwds(db.instance, { force: true });
    expect(r.scanned).toBe(0);
    expect(r.cwds).toEqual([]);
  });
});
