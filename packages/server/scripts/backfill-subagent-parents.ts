#!/usr/bin/env bun
/**
 * backfill-subagent-parents.ts — T9 transcript 권위 재도출 마이그레이션
 *
 * 책임:
 *   메인 hook 경로 (source='claude-code-hook') 로 들어와 SQLite 에 적재된 서브에이전트 자식
 *   도구 호출들의 parent_tool_use_id 를 *그 자식이 속한 Agent 인스턴스의 sub-transcript* 에서
 *   재도출한 권위값으로 교정한다. parent 가 NULL 인 행뿐 아니라 *틀린 non-NULL*(라이브 추측이
 *   넣은 형제 Agent 오귀속) 행도 권위값과 다르면 교정한다.
 *   UPDATE 직후 kuzu_outbox 에 op='update' row 를 발행해 그래프 sync 워커가 PARENT_OF 재동기.
 *
 * 권위 근거 (라이브 persistSubagentChildren 과 동일한 ground truth):
 *   자식 row 의 agent_id 로 sub-transcript 경로(agent-<agent_id>.jsonl)를 구해
 *   extractSubagentToolCalls 로 그 tool_use_id 의 직속 부모를 재도출한다.
 *     - transcript 가 Skill/Task 직속 부모를 알면(rolling parent) 그 값.
 *     - null(=Agent 직속) 이면 그 sub-transcript 를 spawn 한 부모 Agent 의 tool_use_id 로 폴백.
 *       (메인 requests 의 Agent 행 payload 안 tool_response.agentId == 자식 agent_id 매칭.)
 *
 * 구(舊) 방식과의 차이 (격상):
 *   - 구: SQL 휴리스틱(같은 agent_type 의 직전 Agent). 같은 agent_type 여러 인스턴스 시 오매핑,
 *         NULL 만 처리. → 폐기(findParentAgentToolUseId 제거).
 *   - 신: transcript 권위 재도출. 동일타입 다중 인스턴스도 agent_id 로 정확 분간, non-NULL 교정.
 *
 * 안전:
 *   - graceful skip: 메인 transcript_path 미확보 / sub-transcript 파일 부재·파싱 실패 / 그
 *     transcript 에 해당 tool_use_id 없음 / 폴백 Agent 미발견 → 그 행은 *건드리지 않고* 카운트만.
 *   - idempotent: 권위값 == 기존값이면 no-op. 두 번 실행해도 결과 동일.
 *   - 트랜잭션: BATCH_SIZE(200) 단위 commit — 중간 실패 시 직전 batch 보존.
 *   - 라이브 DB 미변경 보장은 호출자 책임(배포 단계). 본 스크립트는 주어진 db 핸들만 다룬다.
 *
 * 사용:
 *   bun run packages/server/scripts/backfill-subagent-parents.ts --dry-run  # 변경 없이 카운트
 *   bun run packages/server/scripts/backfill-subagent-parents.ts            # 실제 UPDATE + outbox
 *   bun run packages/server/scripts/backfill-subagent-parents.ts --limit N  # 첫 N건만
 */

import type { Database } from 'bun:sqlite';
import { getDatabase, decodeText, getActiveKey } from '@spyglass/storage';
import { resolveSubagentTranscriptPath, extractSubagentToolCalls } from '../src/hook/transcript';

interface CandidateRow {
  id: string;
  tool_use_id: string;
  agent_id: string;
  agent_type: string | null;
  session_id: string;
  timestamp: number;
  parent_tool_use_id: string | null;
}

export interface BackfillOptions {
  dryRun: boolean;
  limit: number | null;
}

export interface BackfillResult {
  candidates: number;
  /** dry-run 에서 교정 대상으로 집계된 수(실제 UPDATE 미수행). */
  wouldUpdate: number;
  /** 실제 UPDATE 된 행 수(dry-run 시 0). */
  updated: number;
  /** 권위값이 기존값과 같아 no-op 인 행. */
  alreadyCorrect: number;
  /** 메인/서브 transcript 미확보·파싱 실패·해당 tool_use 없음으로 건너뛴 행. */
  skippedNoTranscript: number;
  /** Agent 폴백이 필요한데 부모 Agent 를 못 찾아 건너뛴 행. */
  skippedNoParentAgent: number;
}

const BATCH_SIZE = 200;

function parseArgs(argv: string[]): BackfillOptions {
  const dryRun = argv.includes('--dry-run');
  let limit: number | null = null;
  const li = argv.indexOf('--limit');
  if (li >= 0 && argv[li + 1]) {
    const n = parseInt(argv[li + 1], 10);
    if (Number.isFinite(n) && n > 0) limit = n;
  }
  return { dryRun, limit };
}

/**
 * 세션의 메인 transcript_path 를 claude_events 에서 1건 해석.
 * 세션 단위 캐싱 권장(호출자) — 같은 세션의 자식들은 동일 경로.
 */
function resolveMainTranscriptPath(db: Database, sessionId: string): string | null {
  const row = db.query(
    `SELECT transcript_path FROM claude_events
      WHERE session_id = ? AND transcript_path IS NOT NULL AND transcript_path != ''
      ORDER BY timestamp DESC LIMIT 1`,
  ).get(sessionId) as { transcript_path: string } | undefined;
  return row?.transcript_path ?? null;
}

/**
 * Agent 직속 자식의 폴백 부모 — sub-transcript 를 spawn 한 Agent 의 tool_use_id.
 * 메인 requests 의 Agent 행 payload(복호) 안 tool_response.agentId == 자식 agent_id 매칭.
 */
function resolveParentAgentToolUseId(
  db: Database,
  sessionId: string,
  agentId: string,
  agentType: string | null,
): string | null {
  const key = getActiveKey();
  // 같은 session 의 Agent 행만 후보(있으면 agent_type 으로 1차 좁힘 — 비용 절감).
  // storage-payload-detach 단계 C(Migration 063): payload·payload_algo 는 requests 에서 DROP →
  //   request_payloads off-row 테이블이 단일 소스. tool_response.agentId 매칭을 위해 LEFT JOIN 으로 회수.
  const rows = db.query(
    `SELECT r.tool_use_id, p.payload, p.payload_algo
       FROM requests r
       LEFT JOIN request_payloads p ON p.request_id = r.id
      WHERE r.tool_name = 'Agent'
        AND r.session_id = ?
        AND r.tool_use_id IS NOT NULL
        ${agentType ? 'AND r.tool_detail = ?' : ''}`,
  ).all(...(agentType ? [sessionId, agentType] : [sessionId])) as Array<{
    tool_use_id: string;
    payload: string | null;
    payload_algo: string | null;
  }>;
  for (const r of rows) {
    if (!r.payload) continue;
    let decoded: string | null;
    try {
      decoded = decodeText(r.payload, r.payload_algo, key);
    } catch {
      continue; // 복호 실패(키 부재 등) → 이 후보 skip.
    }
    if (!decoded) continue;
    let obj: { tool_response?: { agentId?: string } };
    try {
      obj = JSON.parse(decoded) as { tool_response?: { agentId?: string } };
    } catch {
      continue;
    }
    if (obj?.tool_response?.agentId === agentId) {
      return r.tool_use_id;
    }
  }
  return null;
}

/**
 * 자식 1건의 권위 부모 tool_use_id 를 sub-transcript 에서 재도출.
 * @returns 권위값(string) | null(=transcript/매핑 부재로 도출 불가).
 *          호출자는 reason 으로 skip 카운트를 분류한다.
 */
function deriveAuthoritativeParent(
  db: Database,
  child: CandidateRow,
  mainPathCache: Map<string, string | null>,
): { parent: string | null; reason: 'ok' | 'no_transcript' | 'no_parent_agent' } {
  let mainPath = mainPathCache.get(child.session_id);
  if (mainPath === undefined) {
    mainPath = resolveMainTranscriptPath(db, child.session_id);
    mainPathCache.set(child.session_id, mainPath);
  }
  if (!mainPath) return { parent: null, reason: 'no_transcript' };

  const subPath = resolveSubagentTranscriptPath(mainPath, child.session_id, child.agent_id);
  const calls = extractSubagentToolCalls(subPath); // 파일 부재/파싱 실패 → []
  const found = calls.find((c) => c.toolUseId === child.tool_use_id);
  if (!found) return { parent: null, reason: 'no_transcript' };

  // Skill/Task 직속 부모가 transcript 에 있으면 그 값이 권위.
  if (found.parentToolUseId) {
    return { parent: found.parentToolUseId, reason: 'ok' };
  }
  // Agent 직속 → 부모 Agent tool_use_id 폴백.
  const parentAgent = resolveParentAgentToolUseId(
    db, child.session_id, child.agent_id, child.agent_type,
  );
  if (!parentAgent) return { parent: null, reason: 'no_parent_agent' };
  return { parent: parentAgent, reason: 'ok' };
}

/**
 * 권위 재도출 백필 본체 — 테스트/CLI 공용.
 * 주어진 db 핸들에 대해서만 동작(라이브 DB 보호는 호출자 책임).
 */
export function runBackfill(db: Database, opts: BackfillOptions): BackfillResult {
  const limitClause = opts.limit ? `LIMIT ${opts.limit}` : '';
  // 후보: 메인 hook 으로 적재된 서브에이전트 자식. parent 가 NULL 이든 non-NULL 이든
  // 모두 후보로 잡아 권위값과 비교한다(틀린 형제 오귀속 교정 포함).
  const candidates = db.query(
    `SELECT id, tool_use_id, agent_id, agent_type, session_id, timestamp, parent_tool_use_id
       FROM requests
      WHERE agent_id IS NOT NULL AND agent_id != ''
        AND tool_use_id IS NOT NULL AND tool_use_id != ''
        AND source = 'claude-code-hook'
      ORDER BY timestamp ASC
      ${limitClause}`,
  ).all() as CandidateRow[];

  const result: BackfillResult = {
    candidates: candidates.length,
    wouldUpdate: 0,
    updated: 0,
    alreadyCorrect: 0,
    skippedNoTranscript: 0,
    skippedNoParentAgent: 0,
  };

  const mainPathCache = new Map<string, string | null>();
  let batchOpened = false;

  const commitIfNeeded = (force: boolean): void => {
    if (!batchOpened) return;
    if (force || result.updated % BATCH_SIZE === 0) {
      db.run('COMMIT');
      batchOpened = false;
    }
  };

  for (const c of candidates) {
    const { parent, reason } = deriveAuthoritativeParent(db, c, mainPathCache);
    if (reason === 'no_transcript') { result.skippedNoTranscript++; continue; }
    if (reason === 'no_parent_agent') { result.skippedNoParentAgent++; continue; }
    if (!parent) { result.skippedNoTranscript++; continue; }

    // 권위값 == 기존값 → no-op (idempotent).
    if (parent === c.parent_tool_use_id) { result.alreadyCorrect++; continue; }

    if (opts.dryRun) { result.wouldUpdate++; continue; }

    if (!batchOpened) { db.run('BEGIN'); batchOpened = true; }
    try {
      db.run('UPDATE requests SET parent_tool_use_id = ? WHERE id = ?', [parent, c.id]);
      // Migration 051 트리거는 event_type 전환만 capture → parent 만 바꾸는 UPDATE 는
      // 본 스크립트가 명시적으로 outbox 발행(enrich 의 idempotent MERGE 와 결합해 중복 무해).
      db.run(
        "INSERT INTO kuzu_outbox(source, event_id, op) VALUES ('requests', ?, 'update')",
        [c.id],
      );
      result.updated++;
      commitIfNeeded(false);
    } catch (e) {
      console.error('[backfill-subagent-parents] UPDATE failed:', c.id, e);
    }
  }
  commitIfNeeded(true);

  return result;
}

function main(): void {
  const opts = parseArgs(process.argv.slice(2));
  const wrapper = getDatabase();
  const db = wrapper.getDb();
  console.log(`[backfill-subagent-parents] dryRun=${opts.dryRun} limit=${opts.limit ?? 'none'}`);
  const r = runBackfill(db, opts);
  console.log(
    `[backfill-subagent-parents] candidates=${r.candidates} `
      + `${opts.dryRun ? `would_update=${r.wouldUpdate}` : `updated=${r.updated}`} `
      + `already_correct=${r.alreadyCorrect} `
      + `skipped_no_transcript=${r.skippedNoTranscript} `
      + `skipped_no_parent_agent=${r.skippedNoParentAgent}`,
  );
}

if (import.meta.main) {
  main();
}
