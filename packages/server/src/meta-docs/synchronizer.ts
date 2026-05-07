/**
 * meta-docs 모듈 — 카탈로그 동기화 (scanner + resolver + storage 결합)
 *
 * 책임:
 *  - 주어진 cwd의 project chain + 글로벌(`~/.claude`)을 스캔하여 meta_documents 테이블에 upsert.
 *  - 스캔에 등장하지 않은 기존 행을 deleted_at으로 soft delete (해당 source/source_root 한정).
 *  - cwd별 호출 매핑(meta_doc_resolutions)을 chain 우선순위에 맞춰 다시 계산해 일괄 교체.
 *
 * 호출 트리거:
 *  - SessionStart hook (events.ts)        → syncCwd(cwd)
 *  - 데몬 부팅 (runtime/lifecycle.ts)      → syncGlobalOnce()
 *  - lazy resolve (aggregator/routes)     → syncCwd(cwd) — 호출 등장한 이름이 카탈로그에 없을 때
 *  - 수동 refresh API                      → syncCwd / syncGlobalOnce
 *
 * 동시 호출 방지:
 *  - 단일 사용자 로컬 데몬 가정. cwd별 in-memory mutex로 충분.
 *  - 같은 cwd에 대해 5초 이내 중복 호출은 즉시 skip (SessionStart 폭주 보호).
 *
 * 외부 노출:
 *  - syncCwd(db, cwd): SyncResult
 *  - syncGlobalOnce(db): SyncResult
 *  - bootstrapSync(db, options?): 데몬 부팅 시 호출 — 글로벌 1회 + 최근 활성 cwd들 best-effort
 *
 * 의존성: storage 카탈로그 함수, scanner, resolver.
 */

import type { Database } from 'bun:sqlite';
import {
  upsertMetaDocument,
  markMissingAsDeleted,
  replaceResolutionsForCwd,
  type MetaDocSource,
  type MetaDocType,
  type UpsertMetaDocParams,
} from '@spyglass/storage';
import { scanGlobalUserDir, scanRoot, type MetaDocCandidate } from './scanner';
import { normalizeCwd, resolveProjectChain } from './resolver';

export interface SyncResult {
  scanned: number;
  upserted: number;
  softDeleted: number;
  resolutions: number;
  durationMs: number;
}

interface SyncMetadata {
  upserted: number;
  softDeleted: number;
}

/** SessionStart 폭주 방지용 throttle (cwd 단위). */
const RECENT_SYNC_TTL_MS = 5_000;
const recentSyncByCwd = new Map<string, number>();

/** 글로벌 동기화 throttle — 같은 데몬 안에서 너무 자주 돌지 않도록 보호. */
const GLOBAL_SYNC_TTL_MS = 60_000;
let lastGlobalSyncAt = 0;

/**
 * 특정 cwd 기준으로 동기화.
 *  1) project chain 모든 root 스캔
 *  2) 발견된 모든 candidate를 upsert
 *  3) 해당 source(=projectSettings) + 각 source_root 단위로 soft delete (이번 스캔에 없는 행)
 *  4) chain 우선순위에 따라 resolutions 재계산 (deepest project > user > built-in)
 *
 * 글로벌(`~/.claude`)은 별도 트리거를 통해 갱신한다 — 이 함수는 user 카탈로그를 건드리지 않고
 * "현재 카탈로그 그대로" resolution 후보로 끌어와 매핑만 만든다.
 */
export function syncCwd(db: Database, cwd: string): SyncResult {
  const t0 = Date.now();
  const normalized = normalizeCwd(cwd);

  const last = recentSyncByCwd.get(normalized) ?? 0;
  if (t0 - last < RECENT_SYNC_TTL_MS) {
    return { scanned: 0, upserted: 0, softDeleted: 0, resolutions: 0, durationMs: 0 };
  }
  recentSyncByCwd.set(normalized, t0);

  const chain = resolveProjectChain(normalized);
  const seenAt = t0;

  // 1) chain 스캔 — root별로 따로 모아 둠 (resolution 우선순위 계산을 위해)
  const candidatesByRoot: Array<{ root: string; rows: MetaDocCandidate[] }> = [];
  let totalScanned = 0;
  for (const root of chain.source_roots) {
    const rows = scanRoot(root, 'projectSettings', root);
    candidatesByRoot.push({ root, rows });
    totalScanned += rows.length;
  }

  // 2) upsert
  const meta: SyncMetadata = { upserted: 0, softDeleted: 0 };
  const upsertedIds = new Map<string, number>(); // key="type:name:source:source_root"

  const tx = db.transaction(() => {
    for (const group of candidatesByRoot) {
      for (const c of group.rows) {
        const id = upsertOne(db, c, seenAt);
        meta.upserted++;
        upsertedIds.set(catalogKey(c), id);
      }
      // 3) 이번 스캔에서 해당 root의 candidate에 포함되지 않은 기존 행 soft-delete
      meta.softDeleted += markMissingAsDeleted(db, {
        source: 'projectSettings',
        source_root: group.root,
        before: seenAt,
      });
    }
  });
  tx();

  // 4) resolutions 재계산: chain 우선순위에 따라 (type,name) → meta_document_id 결정
  const resolutionRows = computeResolutions(db, candidatesByRoot, chain.user_root);
  replaceResolutionsForCwd(db, normalized, resolutionRows);

  return {
    scanned: totalScanned,
    upserted: meta.upserted,
    softDeleted: meta.softDeleted,
    resolutions: resolutionRows.length,
    durationMs: Date.now() - t0,
  };
}

/**
 * 글로벌 `~/.claude` 단독 동기화.
 *  - 부팅 시 1회 + 60초 throttle.
 *  - userSettings + source_root=~/.claude 절대경로로 upsert.
 *  - resolution은 cwd가 없으니 따로 안 만든다 — 그건 syncCwd가 cwd마다 user_root를 끌어와 처리.
 */
export function syncGlobalOnce(db: Database, options: { force?: boolean } = {}): SyncResult {
  const t0 = Date.now();
  if (!options.force && t0 - lastGlobalSyncAt < GLOBAL_SYNC_TTL_MS) {
    return { scanned: 0, upserted: 0, softDeleted: 0, resolutions: 0, durationMs: 0 };
  }
  lastGlobalSyncAt = t0;

  const candidates = scanGlobalUserDir();
  if (candidates.length === 0) {
    return { scanned: 0, upserted: 0, softDeleted: 0, resolutions: 0, durationMs: Date.now() - t0 };
  }
  const sourceRoot = candidates[0].source_root; // 모두 같은 ~/.claude

  const seenAt = t0;
  let upserted = 0;
  const tx = db.transaction(() => {
    for (const c of candidates) {
      upsertOne(db, c, seenAt);
      upserted++;
    }
  });
  tx();

  const softDeleted = markMissingAsDeleted(db, {
    source: 'userSettings',
    source_root: sourceRoot,
    before: seenAt,
  });

  return {
    scanned: candidates.length,
    upserted,
    softDeleted,
    resolutions: 0,
    durationMs: Date.now() - t0,
  };
}

/**
 * 데몬 부팅 시 호출되는 진입점.
 *  - 글로벌 1회 동기화.
 *  - (옵션) 추가 cwd들이 주어지면 best-effort로 syncCwd 호출 — 실패해도 부팅은 성공해야 함.
 */
export function bootstrapSync(db: Database, options: { activeCwds?: string[] } = {}): void {
  try {
    syncGlobalOnce(db, { force: true });
  } catch (e) {
    console.error('[meta-docs] bootstrap global sync failed:', e);
  }
  for (const cwd of options.activeCwds ?? []) {
    try {
      syncCwd(db, cwd);
    } catch (e) {
      console.error(`[meta-docs] bootstrap syncCwd failed for ${cwd}:`, e);
    }
  }
}

// =============================================================================
// 내부 — upsert 한 줄, 우선순위 기반 resolution 계산
// =============================================================================

function upsertOne(db: Database, c: MetaDocCandidate, seenAt: number): number {
  const params: UpsertMetaDocParams = {
    type: c.type,
    name: c.name,
    source: c.source,
    source_root: c.source_root,
    file_path: c.file_path,
    description: c.description,
    user_invocable: c.user_invocable,
    frontmatter_json: c.frontmatter_json,
    seen_at: seenAt,
  };
  return upsertMetaDocument(db, params);
}

function catalogKey(c: { type: MetaDocType; name: string; source: MetaDocSource; source_root: string | null }): string {
  return `${c.type}:${c.name}:${c.source}:${c.source_root ?? ''}`;
}

/**
 * chain 우선순위에 따라 (type,name) → meta_document_id를 결정.
 *
 * 우선순위 (높음 → 낮음):
 *  1) project chain의 deepest root (resolveProjectChain이 cwd→git root 순으로 정렬해 줌)
 *  2) project chain의 더 상위 root
 *  3) user (~/.claude)
 *
 * candidatesByRoot[0]가 deepest이므로 순회 순서대로 우선이 자연스럽게 부여된다.
 * user 후보는 별도로 DB에서 조회 (이미 syncGlobalOnce에서 upsert 되어 있음).
 */
function computeResolutions(
  db: Database,
  candidatesByRoot: Array<{ root: string; rows: MetaDocCandidate[] }>,
  user_root: string | null,
): Array<{ type: MetaDocType; name: string; meta_document_id: number }> {
  const out: Array<{ type: MetaDocType; name: string; meta_document_id: number }> = [];
  const seen = new Set<string>(); // "type:name"

  // 1~2: project chain 우선
  for (const { rows } of candidatesByRoot) {
    for (const c of rows) {
      const key = `${c.type}:${c.name}`;
      if (seen.has(key)) continue;
      const id = lookupId(db, c.type, c.name, c.source, c.source_root);
      if (id != null) {
        out.push({ type: c.type, name: c.name, meta_document_id: id });
        seen.add(key);
      }
    }
  }

  // 3: user — DB에서 직접 조회 (디스크 스캔 안 하고 이전 글로벌 동기화 결과 재사용)
  if (user_root) {
    const userRows = db.query(
      `SELECT id, type, name FROM meta_documents
        WHERE source = 'userSettings'
          AND source_root = ?
          AND deleted_at IS NULL`,
    ).all(user_root) as Array<{ id: number; type: MetaDocType; name: string }>;
    for (const r of userRows) {
      const key = `${r.type}:${r.name}`;
      if (seen.has(key)) continue;
      out.push({ type: r.type, name: r.name, meta_document_id: r.id });
      seen.add(key);
    }
  }

  return out;
}

function lookupId(
  db: Database,
  type: MetaDocType,
  name: string,
  source: MetaDocSource,
  source_root: string | null,
): number | null {
  const sql = source_root === null
    ? `SELECT id FROM meta_documents WHERE type=? AND name=? AND source=? AND source_root IS NULL AND deleted_at IS NULL LIMIT 1`
    : `SELECT id FROM meta_documents WHERE type=? AND name=? AND source=? AND source_root=? AND deleted_at IS NULL LIMIT 1`;
  const row = source_root === null
    ? db.query(sql).get(type, name, source) as { id: number } | null
    : db.query(sql).get(type, name, source, source_root) as { id: number } | null;
  return row?.id ?? null;
}
