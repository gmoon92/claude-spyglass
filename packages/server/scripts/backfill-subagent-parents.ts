#!/usr/bin/env bun
/**
 * backfill-subagent-parents.ts — 작업 B 백필 (사용자 명시 2026-05-26)
 *
 * 책임:
 *   메인 hook 경로 (source='claude-code-hook') 로 들어와 SQLite 에 적재된
 *   서브에이전트 자식 도구 호출들 중 `parent_tool_use_id IS NULL` 인 행들에 대해
 *   *같은 agent_id 그룹 안의 부모 Agent ToolCall* 을 추적해 parent 를 복원한다.
 *   UPDATE 직후 kuzu_outbox 에 op='update' row 를 발행해 그래프 sync 워커가 재동기.
 *
 * 근본 원인 (확인된 사실):
 *   Claude Code 는 서브에이전트 내부 도구 호출도 메인 세션 PreToolUse/PostToolUse hook
 *   으로 발사. hook payload 에 agent_id/agent_type 라벨은 있지만 parent_tool_use_id 는
 *   없음 → SQLite NULL. Agent('xx') PostToolUse 시점에 transcript 파싱하는
 *   persistSubagentChildren 이 자식들을 다시 INSERT 하려 해도 *이미 존재* 라 skip.
 *   결과: 그래프 enrich 가 PARENT_OF 엣지 생성 못 함 → flow chart ancestor 단절.
 *
 * 백필 휴리스틱 (정확성 ≥ 95% 목표):
 *   - 매칭 후보: parent_tool_use_id IS NULL AND agent_id IS NOT NULL AND tool_use_id IS NOT NULL
 *   - 부모 ToolCall 후보: tool_name='Agent' AND tool_detail = 자식의 agent_type
 *                          AND session_id 동일
 *                          AND timestamp 가 자식의 timestamp *이전*
 *                          AND (agent_id IS NULL OR agent_id != 자식의 agent_id) — 메인 세션 호출
 *     → 그 중 timestamp 차이가 가장 작은 (= 가장 가까운 직전) Agent 호출을 부모로 매핑.
 *
 *   휴리스틱 한계:
 *     - 같은 session 안에 같은 agent_type 의 Agent 호출이 *없는* 경우 (예: 사용자가 직접
 *       /slash 로 호출) → skip. 진짜 부모가 없는 케이스라 정상.
 *     - 같은 session 안에 같은 agent_type Agent 호출이 *여러 인스턴스* 있고 자식
 *       agent_id 가 다른 인스턴스에 속하면 오매핑 가능. agent_id 가 동일한 자식들이
 *       *같은 부모* 에서 spawn 됐다고 가정 — 일반적으로 안전.
 *
 * 사용:
 *   bun run packages/server/scripts/backfill-subagent-parents.ts --dry-run  # 변경 없이 카운트
 *   bun run packages/server/scripts/backfill-subagent-parents.ts            # 실제 UPDATE + outbox 발행
 *   bun run packages/server/scripts/backfill-subagent-parents.ts --limit N  # 첫 N건만
 *
 * 안전:
 *   - idempotent: 두 번 실행해도 결과 동일 (이미 채워진 행은 다시 안 건드림).
 *   - 트랜잭션: 한 batch (200행) 단위로 commit — 중간 실패 시 직전 batch 보존.
 *   - outbox INSERT 는 enrich 단계의 idempotent MERGE 와 결합해 그래프 중복 무해.
 */

import { getDatabase } from '@spyglass/storage';

interface CandidateRow {
  id: string;
  tool_use_id: string;
  agent_id: string;
  agent_type: string | null;
  session_id: string;
  timestamp: number;
}

interface ParentMatch {
  parent_tool_use_id: string;
  parent_timestamp: number;
}

const BATCH_SIZE = 200;

function parseArgs(): { dryRun: boolean; limit: number | null } {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  let limit: number | null = null;
  const li = args.indexOf('--limit');
  if (li >= 0 && args[li + 1]) {
    const n = parseInt(args[li + 1], 10);
    if (Number.isFinite(n) && n > 0) limit = n;
  }
  return { dryRun, limit };
}

function findParentAgentToolUseId(
  db: ReturnType<ReturnType<typeof getDatabase>['getDb']>,
  child: CandidateRow,
): ParentMatch | null {
  // 같은 session 안에서, 시점이 이전이고, agent 도구 호출이며 detail 이 자식의 agent_type 인
  // 호출 중 가장 가까운(timestamp DESC 첫 행) 행을 부모로 채택.
  // 또한 그 부모는 자식과 *다른 agent_id* (= 메인 세션 발급) 여야 한다 — 같은 인스턴스 안에서
  // 자기 자신을 spawn 하는 케이스 회피.
  if (!child.agent_type) return null;
  const row = db.query(
    `SELECT tool_use_id, timestamp
       FROM requests
      WHERE session_id = ?
        AND tool_name = 'Agent'
        AND tool_detail = ?
        AND timestamp <= ?
        AND tool_use_id IS NOT NULL
        AND (agent_id IS NULL OR agent_id = '' OR agent_id != ?)
      ORDER BY timestamp DESC
      LIMIT 1`,
  ).get(child.session_id, child.agent_type, child.timestamp, child.agent_id) as
    | { tool_use_id: string; timestamp: number }
    | undefined;
  if (!row) return null;
  return { parent_tool_use_id: row.tool_use_id, parent_timestamp: row.timestamp };
}

function main(): void {
  const { dryRun, limit } = parseArgs();
  const wrapper = getDatabase();
  const db = wrapper.getDb();

  console.log(`[backfill-subagent-parents] dryRun=${dryRun} limit=${limit ?? 'none'}`);

  // 후보 수집.
  const limitClause = limit ? `LIMIT ${limit}` : '';
  const candidates = db.query(
    `SELECT id, tool_use_id, agent_id, agent_type, session_id, timestamp
       FROM requests
      WHERE (parent_tool_use_id IS NULL OR parent_tool_use_id = '')
        AND agent_id IS NOT NULL AND agent_id != ''
        AND agent_type IS NOT NULL AND agent_type != ''
        AND tool_use_id IS NOT NULL AND tool_use_id != ''
        AND source = 'claude-code-hook'
      ORDER BY timestamp ASC
      ${limitClause}`,
  ).all() as CandidateRow[];

  console.log(`[backfill-subagent-parents] candidates=${candidates.length}`);

  // session+agent_id 그룹별로 캐싱 — 같은 그룹은 같은 부모.
  const cache = new Map<string, ParentMatch | null>();

  let matched = 0;
  let skippedNoParent = 0;
  let updated = 0;
  let batchOpened = false;

  function commitBatchIfNeeded(force: boolean): void {
    if (!batchOpened) return;
    if (force || (updated > 0 && updated % BATCH_SIZE === 0)) {
      db.run('COMMIT');
      batchOpened = false;
    }
  }

  for (const c of candidates) {
    const cacheKey = `${c.session_id}::${c.agent_id}::${c.agent_type}`;
    let match = cache.get(cacheKey);
    if (match === undefined) {
      match = findParentAgentToolUseId(db, c);
      cache.set(cacheKey, match);
    }
    if (!match) {
      skippedNoParent++;
      continue;
    }
    matched++;
    if (dryRun) continue;

    if (!batchOpened) {
      db.run('BEGIN');
      batchOpened = true;
    }
    try {
      db.run(
        'UPDATE requests SET parent_tool_use_id = ? WHERE id = ?',
        [match.parent_tool_use_id, c.id],
      );
      // 그래프 sync 가 PARENT_OF 엣지 새로 생성하도록 outbox 발행.
      db.run(
        "INSERT INTO kuzu_outbox(source, event_id, op) VALUES ('requests', ?, 'update')",
        [c.id],
      );
      updated++;
      commitBatchIfNeeded(false);
    } catch (e) {
      console.error('[backfill-subagent-parents] UPDATE failed:', c.id, e);
    }
  }
  commitBatchIfNeeded(true);

  console.log(`[backfill-subagent-parents] matched=${matched} updated=${updated} skipped_no_parent=${skippedNoParent}`);
  // agent_type 별 매칭 통계.
  const byType = new Map<string, { matched: number; skipped: number }>();
  for (const c of candidates) {
    const cacheKey = `${c.session_id}::${c.agent_id}::${c.agent_type}`;
    const m = cache.get(cacheKey);
    const t = c.agent_type ?? '(null)';
    const slot = byType.get(t) ?? { matched: 0, skipped: 0 };
    if (m) slot.matched++; else slot.skipped++;
    byType.set(t, slot);
  }
  const rows = [...byType.entries()].sort((a, b) => (b[1].matched + b[1].skipped) - (a[1].matched + a[1].skipped));
  console.log('[backfill-subagent-parents] agent_type breakdown:');
  for (const [t, s] of rows.slice(0, 20)) {
    console.log(`  ${t.padEnd(24)} matched=${s.matched} skipped=${s.skipped}`);
  }
}

main();
