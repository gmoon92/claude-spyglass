/**
 * hook 모듈 — 요청 데이터 저장 (Upsert + 일반 INSERT + 서브에이전트 자식 INSERT)
 *
 * 책임:
 *  1. tool_call의 Pre/Post Upsert 패턴 처리:
 *     - PreToolUse → INSERT (event_type='pre_tool')
 *     - PostToolUse → 동일 tool_use_id의 pre_tool을 UPDATE (event_type='tool')
 *     - pre_tool 없으면 일반 INSERT
 *  2. prompt/response/system 등 그 외 타입은 단순 INSERT
 *  3. Agent tool 종료 후 서브 transcript에서 추출한 자식 tool_use 일괄 INSERT (Migration 017)
 *
 * 외부 노출 (collect/ 내부 사용 위주):
 *  - saveRequest(db, payload)                                      : 단일 요청 저장 (Upsert 분기 포함)
 *  - persistSubagentChildren(db, children, context)                : 서브에이전트 자식 일괄 저장
 *  - persistAssistantTextResponses(db, entries, context)            : v22 — 중간 assistant text 응답 저장
 *    (PostToolUse 시 transcript에서 추출, message_id 기반 idempotent INSERT OR IGNORE)
 *
 * 호출자:
 *  - handler.ts (processHookEvent): 모든 hook 이벤트의 저장 단계
 *  - raw-handler.ts (PostToolUse + Agent 분기): persistSubagentChildren
 *
 * 의존성:
 *  - @spyglass/storage: createRequest, Request 타입
 *  - turn.ts: assignTurnId, getLastTurnId
 *  - preview.ts: extractPreview, extractToolUseId
 *  - tool-detail.ts: extractToolDetail (서브 자식 저장 시)
 */

import { randomUUID } from 'node:crypto';
import type { Database } from 'bun:sqlite';
import { createRequest, getProxyToolUseById } from '@spyglass/storage';
import type { Request as DbRequest } from '@spyglass/storage';
import type { NormalizedHookPayload, SubagentChildToolCall } from './types';
import type { AssistantTextEntry } from './transcript';
import { assignTurnId, getLastTurnId, getTurnIdAt } from './turn';
import { extractPreview, extractToolUseId } from './preview';
import { extractToolDetail } from './tool-detail';

/**
 * tool_use_id 기준으로 pre_tool 레코드 조회.
 * 호출 시점: PostToolUse 처리 직전, Upsert 매칭 검사용.
 */
function findPreToolRecord(
  db: Database,
  sessionId: string,
  toolUseId: string,
): DbRequest | null {
  return db.query(
    "SELECT * FROM requests WHERE session_id = ? AND tool_use_id = ? AND event_type = 'pre_tool' LIMIT 1",
  ).get(sessionId, toolUseId) as DbRequest | null;
}

/**
 * pre_tool 레코드를 post_tool 데이터로 UPDATE (Upsert merge).
 *
 * - 토큰/소요 시간/payload/event_type을 'tool'로 갱신
 * - tool_name, tool_detail은 pre_tool에서 이미 저장된 값 유지 (PreToolUse 시점에 받은 값이 정답)
 * - model은 COALESCE: post에 없으면 pre 값 유지 (서브에이전트 케이스)
 *
 * @returns 행이 실제로 갱신됐는지 여부
 */
function mergePostToolIntoPreTool(
  db: Database,
  preToolId: string,
  payload: NormalizedHookPayload,
  apiRequestId: string | null,
): boolean {
  // ADR-001 P1-E: api_request_id를 COALESCE로 채워 기존 값 보존(동시 backfill 회피).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const result = (db as any).run(
    `UPDATE requests
     SET duration_ms = ?,
         tokens_input = ?,
         tokens_output = ?,
         tokens_total = ?,
         cache_creation_tokens = ?,
         cache_read_tokens = ?,
         model = COALESCE(?, model),
         payload = ?,
         event_type = 'tool',
         api_request_id = COALESCE(api_request_id, ?)
     WHERE id = ?`,
    payload.duration_ms || 0,
    payload.tokens_input,
    payload.tokens_output,
    payload.tokens_total,
    payload.cache_creation_tokens ?? 0,
    payload.cache_read_tokens ?? 0,
    payload.model ?? null,
    payload.payload ?? null,
    apiRequestId,
    preToolId,
  );
  return result.changes > 0;
}

/**
 * tool_use_id로 proxy_tool_uses에서 정확한 api_request_id 조회 (ADR-001 P1-E).
 * 미수신/타사 client 발행 등으로 미스 시 null — 호출자는 시간 기반 fallback으로 진행.
 */
function resolveApiRequestId(db: Database, toolUseId: string | null): string | null {
  if (!toolUseId) return null;
  const row = getProxyToolUseById(db, toolUseId);
  return row?.api_request_id ?? null;
}

/**
 * 요청 데이터 저장 — Upsert 분기 포함.
 *
 * 흐름:
 *  1. event_type='tool' + tool_use_id 존재 → pre_tool 매칭 검사
 *     - 매칭 OK → mergePostToolIntoPreTool (UPDATE)
 *     - 매칭 NG → fallthrough to 일반 INSERT
 *  2. 일반 INSERT:
 *     - prompt 타입은 새 turn_id 채번 (assignTurnId)
 *     - 그 외는 직전 prompt의 turn_id 재사용 (getLastTurnId)
 *
 * @returns
 *   saved      : INSERT 또는 UPDATE 성공 여부
 *   wasUpsert  : true=pre_tool을 덮어씀 → handler에서 세션 토큰 갱신 필요
 *   savedId    : Upsert 시 DB의 실제 id(pre-xxx) — SSE 브로드캐스트 일관성 위해 호출자가 사용
 */
export function saveRequest(
  db: Database,
  payload: NormalizedHookPayload,
): { saved: boolean; wasUpsert: boolean; savedId?: string } {
  try {
    const toolUseId = extractToolUseId(payload.payload);
    const isPostTool = payload.event_type === 'tool' && payload.request_type === 'tool_call';

    // ADR-001 P1-E: PostToolUse일 때 tool_use_id로 정확한 api_request_id 조회.
    // PreToolUse 시점엔 아직 응답 도착 전이라 null. 응답이 늦게 도착해도 PostToolUse 시점엔
    // proxy_tool_uses에 INSERT 완료된 상태이므로 조회 가능.
    const resolvedApiRequestId = isPostTool ? resolveApiRequestId(db, toolUseId) : null;

    // PostToolUse: 기존 pre_tool 레코드 Upsert 시도
    if (isPostTool && toolUseId) {
      const preToolRecord = findPreToolRecord(db, payload.session_id, toolUseId);
      if (preToolRecord) {
        const merged = mergePostToolIntoPreTool(db, preToolRecord.id, payload, resolvedApiRequestId);
        if (merged) {
          // savedId: DB의 실제 id(pre-xxx) — fetchRequests/SSE와 id 일치 보장
          return { saved: true, wasUpsert: true, savedId: preToolRecord.id };
        }
      }
    }

    // 일반 INSERT (pre_tool 또는 매칭 실패한 post_tool, 또는 prompt/system 등)
    let turnId: string | undefined;
    if (payload.request_type === 'prompt') {
      turnId = assignTurnId(db, payload.session_id);
    } else {
      turnId = getLastTurnId(db, payload.session_id) ?? undefined;
    }

    // meta-flow tree (Migration 037): 슬래시 커맨드 행은 가상 tool_use_id를 부여해
    // 같은 turn의 root-level 호출 자식들과 parent_tool_use_id로 연결 가능하게 만든다.
    let resolvedToolUseId: string | null = toolUseId;
    let resolvedParentToolUseId: string | null = null;
    if (payload.request_type === 'prompt' && payload.slash_command && turnId) {
      resolvedToolUseId = `slash:${turnId}`;
    } else if (
      payload.request_type === 'tool_call'
      && turnId
      && toolUseId
      && !toolUseId.startsWith('slash:')
    ) {
      // root-level 호출(payload상 부모 없음)이 같은 turn의 슬래시 가상 ID를 부모로 갖도록 연결.
      // pre_tool 매 행마다 1회 조회 — turn당 최대 1건이므로 비용 미미. 슬래시 행이 없으면 NULL 유지.
      const slashVirtualId = `slash:${turnId}`;
      const slashExists = db.query(
        "SELECT 1 FROM requests WHERE tool_use_id = ? AND slash_command IS NOT NULL LIMIT 1",
      ).get(slashVirtualId);
      if (slashExists) {
        resolvedParentToolUseId = slashVirtualId;
      }
    }

    // meta-flow tree (Migration 038/039): 서브에이전트 자식 행은 agent_type=<부모 Agent 이름> 만
    // 채워질 뿐 parent_tool_use_id 는 비어 있다 (subagent 측 hook 페이로드에 부모 toolUseId 없음).
    // rolling-parent 규칙(transcript.ts L184~):
    //   - Skill/Task 행은 매칭 Agent 를 부모로 (Skill 끼리는 형제).
    //   - 그 외 도구는 같은 (session,turn,agent_type) 안의 직전 Skill/Task 를 부모로, 없으면 Agent.
    if (!resolvedParentToolUseId
      && payload.agent_type
      && turnId
      && payload.session_id) {
      const isSkillOrTask = payload.tool_name === 'Skill'
        || payload.tool_name === 'Task'
        || payload.tool_name?.startsWith('Skill')
        || payload.tool_name?.startsWith('Task');

      // 1순위: Skill/Task 가 아닐 때 — 직전 Skill/Task 의 tool_use_id.
      if (!isSkillOrTask) {
        const rollingSkill = db.query(
          `SELECT tool_use_id FROM requests
           WHERE agent_type = ?
             AND session_id = ?
             AND turn_id = ?
             AND (tool_name IN ('Skill','Task')
                  OR tool_name LIKE 'Skill%'
                  OR tool_name LIKE 'Task%')
             AND tool_use_id IS NOT NULL
             AND timestamp < ?
           ORDER BY timestamp DESC
           LIMIT 1`,
        ).get(payload.agent_type, payload.session_id, turnId, payload.timestamp) as
          | { tool_use_id: string }
          | null;
        if (rollingSkill?.tool_use_id) {
          resolvedParentToolUseId = rollingSkill.tool_use_id;
        }
      }

      // 2순위: Skill/Task 가 없거나 self 가 Skill/Task 인 경우 — 매칭 Agent.
      if (!resolvedParentToolUseId) {
        const parentRow = db.query(
          `SELECT tool_use_id FROM requests
           WHERE tool_name = 'Agent'
             AND tool_detail = ?
             AND session_id = ?
             AND turn_id = ?
             AND tool_use_id IS NOT NULL
             AND (event_type IS NULL OR event_type = 'tool')
             AND timestamp <= ?
           ORDER BY timestamp DESC
           LIMIT 1`,
        ).get(payload.agent_type, payload.session_id, turnId, payload.timestamp) as
          | { tool_use_id: string }
          | null;
        if (parentRow?.tool_use_id) {
          resolvedParentToolUseId = parentRow.tool_use_id;
        }
      }
    }

    createRequest(db, {
      id: payload.id,
      session_id: payload.session_id,
      timestamp: payload.timestamp,
      type: payload.request_type,
      tool_name: payload.tool_name,
      tool_detail: payload.tool_detail,
      turn_id: turnId,
      model: payload.model,
      tokens_input: payload.tokens_input,
      tokens_output: payload.tokens_output,
      tokens_total: payload.tokens_total,
      duration_ms: payload.duration_ms || 0,
      payload: payload.payload,
      source: payload.source || null,
      cache_creation_tokens: payload.cache_creation_tokens ?? 0,
      cache_read_tokens: payload.cache_read_tokens ?? 0,
      preview: extractPreview(payload) ?? undefined,
      tool_use_id: resolvedToolUseId,
      parent_tool_use_id: resolvedParentToolUseId,
      event_type: payload.event_type || null,
      tokens_confidence: payload.tokens_confidence,
      tokens_source: payload.tokens_source,
      // ADR-001 P1-E: PostToolUse는 proxy_tool_uses에서 직접 매칭, 그 외는 NULL
      // (events.ts/proxy backfill의 시간 기반 cross-link이 후속 채움 담당).
      api_request_id: resolvedApiRequestId,
      // v20: hook raw 페이로드 감사 메타
      permission_mode: payload.permission_mode ?? null,
      agent_id: payload.agent_id ?? null,
      agent_type: payload.agent_type ?? null,
      tool_interrupted: payload.tool_interrupted ?? null,
      tool_user_modified: payload.tool_user_modified ?? null,
      // v24: Behavior Definitions 카탈로그 매칭용 슬래시 커맨드 이름
      slash_command: payload.slash_command ?? null,
    });
    return { saved: true, wasUpsert: false };
  } catch (error) {
    console.error('[Collect] Failed to save request:', error);
    return { saved: false, wasUpsert: false };
  }
}

/**
 * 서브에이전트 자식 도구 호출들을 requests에 일괄 INSERT (Migration 017).
 *
 * - turn_id는 부모 Agent와 동일 (메인 세션의 같은 turn에 묶임)
 * - parent_tool_use_id 정책 (anomaly-bloated-sys T-07):
 *   - child.parentToolUseId 가 있으면 그 값(직속 Skill/Task 부모)
 *   - 없으면 context.parentToolUseId (Agent 자체) 로 폴백
 *   ⇒ Agent → Skill → Tool 깊이 2~3 트리가 정확히 구성되어
 *     metrics/calculators/anomaly.ts 의 WITH RECURSIVE(깊이 3) 가 작동.
 * - source='subagent-transcript', event_type='tool'
 * - 중복 방지: 동일 tool_use_id가 이미 존재하면 *NULL parent 백필 후* skip.
 *
 * Race 방어 (2026-05-26 사용자 명세, 작업 A):
 *   Claude Code 는 서브에이전트 *내부* 의 도구 호출도 메인 세션 PreToolUse/PostToolUse hook
 *   으로 발사한다 (source='claude-code-hook'). 그 hook payload 에는 agent_id/agent_type
 *   라벨만 있고 parent_tool_use_id 는 *없다* — 그래서 메인 hook 경로로 들어온 행은
 *   parent_tool_use_id=NULL 상태로 SQLite 에 적재된다.
 *
 *   나중에 Agent('pm') PostToolUse 시점에 본 함수가 transcript 파싱 결과로 같은 child
 *   를 다시 INSERT 하려 하지만 *이미 존재* 하므로 단순 skip 하면 parent NULL 이 영원히
 *   잔존 → 그래프 PARENT_OF 엣지 미생성 → flow chart 의 ancestor 단절.
 *
 *   해결: exists 체크 시 *parent_tool_use_id 가 NULL/empty* 이고 우리에게 resolved 가
 *   있으면 UPDATE 로 채워준다. UPDATE 직후 kuzu_outbox 에 op='update' row 를 직접 발행
 *   해 그래프 sync 워커가 재동기. (Migration 051 트리거는 event_type 변경에만 발동하므로
 *   parent_tool_use_id 만 채우는 UPDATE 는 본 함수가 명시적으로 outbox INSERT 한다.)
 *
 * 호출 시점: handlers/post-tool-use.handler.ts의 PostToolUse + tool_name='Agent' 처리 끝 직후.
 *
 * @returns { inserted, backfilled } — 신규 INSERT 수 + 기존 행 parent 백필 수
 */
export function persistSubagentChildren(
  db: Database,
  children: SubagentChildToolCall[],
  context: { parentToolUseId: string; sessionId: string; turnId?: string },
): { inserted: number; backfilled: number } {
  let inserted = 0;
  let backfilled = 0;
  for (const child of children) {
    // 직속 부모 우선, 없으면 Agent 폴백 (T-07 정책).
    const resolvedParentToolUseId = child.parentToolUseId ?? context.parentToolUseId;

    // 이미 동일 tool_use_id가 존재하면 — *NULL parent 만 백필* 후 skip.
    const existing = db.query(
      'SELECT id, parent_tool_use_id FROM requests WHERE tool_use_id = ? LIMIT 1',
    ).get(child.toolUseId) as { id: string; parent_tool_use_id: string | null } | null;
    if (existing) {
      const existingParent = existing.parent_tool_use_id;
      const isEmpty = !existingParent || existingParent === '';
      if (isEmpty && resolvedParentToolUseId) {
        try {
          db.run(
            'UPDATE requests SET parent_tool_use_id = ? WHERE id = ?',
            [resolvedParentToolUseId, existing.id],
          );
          // 그래프 sync 가 PARENT_OF 엣지를 새로 만들도록 outbox 에 직접 발행.
          //   Migration 051 트리거는 event_type 'pre_tool'→'tool' 전환만 capture 하므로
          //   parent_tool_use_id 만 채우는 UPDATE 는 트리거가 발동 안 한다 — 명시적으로
          //   본 위치에서 INSERT 한다. enrich 단계의 idempotent MERGE 가 중복 무해.
          db.run(
            "INSERT INTO kuzu_outbox(source, event_id, op) VALUES ('requests', ?, 'update')",
            [existing.id],
          );
          backfilled++;
        } catch (e) {
          console.error('[Collect] Failed to backfill parent_tool_use_id:', e);
        }
      }
      continue;
    }

    const tokensTotal = child.tokensInput + child.tokensOutput;
    const toolDetail = extractToolDetail(child.toolName, child.toolInput);
    const id = `sub-${child.timestampMs}-${randomUUID().slice(0, 8)}`;
    // ADR-001 P1-E (polish): subagent 자식 도구도 부모 Agent 응답에서 발행된 tool_use_id를
    // 가지므로, proxy_tool_uses에서 정확한 api_request_id 조회 가능. 미스 시 NULL 유지.
    const childApiRequestId = resolveApiRequestId(db, child.toolUseId);

    try {
      createRequest(db, {
        id,
        session_id: context.sessionId,
        timestamp: child.timestampMs,
        type: 'tool_call',
        tool_name: child.toolName,
        tool_detail: toolDetail ?? undefined,
        turn_id: context.turnId,
        model: child.model || undefined,
        tokens_input: child.tokensInput,
        tokens_output: child.tokensOutput,
        tokens_total: tokensTotal,
        duration_ms: 0,
        payload: JSON.stringify({ tool_input: child.toolInput, source: 'subagent-transcript' }),
        source: 'subagent-transcript',
        cache_creation_tokens: child.cacheCreationTokens,
        cache_read_tokens: child.cacheReadTokens,
        tool_use_id: child.toolUseId,
        event_type: 'tool',
        tokens_confidence: 'high',
        tokens_source: 'transcript',
        parent_tool_use_id: resolvedParentToolUseId,
        api_request_id: childApiRequestId,
      });
      inserted++;
    } catch (e) {
      console.error('[Collect] Failed to insert subagent child:', e);
    }
  }
  return { inserted, backfilled };
}

/**
 * v22 — transcript에서 추출한 assistant text 응답들을 requests에 응답 행으로 INSERT.
 *
 * 배경:
 *  - Stop 훅은 turn 종료 시 1회만 발생 + last_assistant_message는 마지막 1건만 보존
 *  - 한 turn 안의 도구 호출 사이사이 출력된 어시스턴트 텍스트는 완전히 누락되던 문제
 *
 * 동작:
 *  - extractAssistantTextEntries로 transcript의 모든 text 응답 entry 확보
 *  - 각 entry의 message_id를 idempotent 키로 사용 → id=`resp-msg-<message_id>`
 *  - INSERT OR IGNORE로 중복 시 silent skip → 매 PostToolUse마다 호출해도 중복 행 없음
 *  - turn_id는 호출자가 결정 (현재 PostToolUse 시점의 turn — getLastTurnId 결과)
 *
 * 호출 시점: PostToolUseHandler 매 호출. 비용은 transcript 크기에 비례하지만 PostToolUse가
 *  이미 transcript를 읽고 있어 추가 부담 미미.
 *
 * @returns 새로 INSERT된 응답 행 수
 */
export function persistAssistantTextResponses(
  db: Database,
  entries: AssistantTextEntry[],
  context: { sessionId: string; turnId?: string; projectName: string },
): number {
  if (entries.length === 0) return 0;

  // INSERT OR IGNORE — id가 PRIMARY KEY라 중복 시 silent skip
  // requests 테이블의 모든 컬럼을 채워야 하므로 raw SQL 사용 (createRequest는 일반 INSERT)
  // ADR-001 P1-E (polish): api_request_id를 entry.messageId로 채움 — id에 포함된 msgid와
  //   동일하지만 컬럼을 채워두면 응답 행 단독 SELECT만으로 cross-link이 즉시 가능.
  const stmt = db.prepare(`
    INSERT OR IGNORE INTO requests (
      id, session_id, timestamp, type, tool_name, tool_detail, turn_id, model,
      tokens_input, tokens_output, tokens_total, duration_ms, payload, source,
      cache_creation_tokens, cache_read_tokens, preview, tool_use_id, event_type,
      tokens_confidence, tokens_source, parent_tool_use_id, api_request_id,
      permission_mode, agent_id, agent_type, tool_interrupted, tool_user_modified
    ) VALUES (
      ?, ?, ?, 'response', NULL, NULL, ?, ?,
      ?, ?, ?, 0, ?, 'transcript-assistant-text',
      ?, ?, ?, NULL, 'assistant_response',
      'high', 'transcript', NULL, ?,
      NULL, NULL, NULL, NULL, NULL
    )
  `);

  // ADR-001 P1: entry별 turn_id를 메시지 시각 기준으로 결정해 transcript backfill의
  // turn 잘못 태깅 회귀를 차단. context.turnId는 fallback으로만 사용 (호출자가 단일 turn임을
  // 명시한 경우 — 일반적으로 인자 생략).
  let inserted = 0;
  for (const entry of entries) {
    const id = `resp-msg-${entry.messageId}`;
    const previewText = entry.text.slice(0, 2000);
    const tokensTotal = entry.tokensInput + entry.tokensOutput;
    const entryTurnId = getTurnIdAt(db, context.sessionId, entry.timestampMs)
      ?? context.turnId
      ?? null;
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const result = (stmt as any).run(
        id,
        context.sessionId,
        entry.timestampMs,
        entryTurnId,
        entry.model || null,
        entry.tokensInput,
        entry.tokensOutput,
        tokensTotal,
        JSON.stringify({ message_id: entry.messageId, text: entry.text, source: 'transcript' }),
        entry.cacheCreationTokens,
        entry.cacheReadTokens,
        previewText,
        entry.messageId, // api_request_id — entry.messageId가 곧 Anthropic msg_xxx
      );
      if (result.changes > 0) inserted++;
    } catch (e) {
      console.error('[Hook] Failed to insert assistant text response:', e);
    }
  }
  return inserted;
}
