/**
 * Events Collector - POST /events
 *
 * @description 와일드카드 훅에서 전달되는 raw hook payload를 claude_events 테이블에 저장
 *              + Stop 이벤트의 last_assistant_message를 requests 테이블에 'response' 타입으로 저장
 */

import { randomUUID } from 'node:crypto';
import type { Database } from 'bun:sqlite';
import {
  createEvent,
  createRequest,
  endSession,
  getLatestProxyResponseBefore,
  getRequestById,
  getSessionById,
  reactivateSession,
  type ClaudeEvent,
} from '@spyglass/storage';
import { getLastTurnId, getTurnIdAt, parseTranscript } from './hook';
import { extractAssistantTextEntries } from './hook/transcript';
import { persistAssistantTextResponses } from './hook/persist';
import { broadcastNewRequest, broadcastSessionUpdate } from './sse';
import { normalizeRequest } from './domain/request-normalizer';
import { invalidateDashboardCache } from './api';
import { diagJson } from './diag-log';
import { syncCwd as syncMetaDocsCwd } from './meta-docs';

export interface RawHookPayload {
  hook_event_name: string;
  session_id: string;
  transcript_path?: string;
  cwd?: string;
  agent_id?: string;
  agent_type?: string;
  /** Stop 이벤트에서 Claude의 마지막 assistant 메시지 본문 */
  last_assistant_message?: string;
  [key: string]: unknown;
}

export async function eventsCollectHandler(req: Request, db: Database): Promise<Response> {
  if (req.method !== 'POST') {
    return json({ error: 'Method not allowed' }, 405);
  }

  let payload: RawHookPayload;
  try {
    payload = await req.json();
  } catch {
    return json({ error: 'Invalid JSON' }, 400);
  }

  if (!payload.hook_event_name || !payload.session_id) {
    return json({ error: 'Missing required fields: hook_event_name, session_id' }, 400);
  }

  // /collect와 동일하게 hook-payload.jsonl로 raw 보존 (SessionStart/End/Stop/Notification 등)
  diagJson('hook-payload', {
    hook_event_name: payload.hook_event_name,
    session_id: payload.session_id,
    tool_name: null,
    tool_use_id: null,
    cwd: payload.cwd ?? null,
    raw: payload,
  });

  const p = payload as Record<string, unknown>;
  const stopHookActive = typeof p.stop_hook_active === 'boolean'
    ? (p.stop_hook_active ? 1 : 0)
    : null;

  const event: ClaudeEvent = {
    event_id: crypto.randomUUID(),
    event_type: payload.hook_event_name,
    session_id: payload.session_id,
    transcript_path: payload.transcript_path ?? null,
    cwd: payload.cwd ?? null,
    agent_id: payload.agent_id ?? null,
    agent_type: payload.agent_type ?? null,
    timestamp: Date.now(),
    payload: JSON.stringify(payload),
    schema_version: 1,
    permission_mode: (p.permission_mode as string) ?? null,
    source: (p.source as string) ?? null,
    end_reason: (p.reason as string) ?? null,
    model: (p.model as string) ?? null,
    stop_hook_active: stopHookActive,
    task_id: (p.tool_use_id as string) ?? (p.task_id as string) ?? null,
    task_subject: (p.description as string) ?? (p.subject as string) ?? null,
    notification_type: (p.notification_type as string) ?? (p.type as string) ?? null,
  };

  try {
    createEvent(db, event);

    if (event.event_type === 'SessionEnd') {
      endSession(db, event.session_id, event.timestamp);
      // v22: 활성 → 비활성 전환 실시간 브로드캐스트 (sidebar 마커 즉시 갱신)
      broadcastSessionUpdate({
        session_id: event.session_id,
        action: 'ended',
        ended_at: event.timestamp,
      });
    } else if (event.event_type === 'SessionStart') {
      // compact/resume: 동일 session_id로 SessionStart 재발생 시 ended_at 클리어
      reactivateSession(db, event.session_id);
      broadcastSessionUpdate({
        session_id: event.session_id,
        action: 'started',
        started_at: event.timestamp,
        ended_at: null,
      });
      // v24: 메타 문서 카탈로그 동기화 — 해당 cwd의 project chain 스캔.
      //  - 5초 in-memory throttle 보호 (synchronizer 내부)
      //  - 실패해도 SessionStart 처리 200 유지: try/catch로 격리
      if (event.cwd) {
        try {
          syncMetaDocsCwd(db, event.cwd);
        } catch (e) {
          console.error('[meta-docs] syncCwd failed on SessionStart:', e);
        }
      }
    } else if (event.event_type === 'Stop') {
      // Stop: 사용자가 본 Claude 응답 텍스트를 requests 테이블에 'response' 타입으로 저장
      saveAssistantResponse(db, payload, event.timestamp);
    }

    return json({ success: true, event_id: event.event_id });
  } catch (error) {
    console.error('[Events] Failed to save event:', error);
    return json({ error: 'Failed to save event' }, 500);
  }
}

/**
 * Stop 이벤트의 last_assistant_message를 requests 테이블에 'response' 타입으로 INSERT 후 SSE 브로드캐스트.
 *
 * 동작 원칙:
 *  - last_assistant_message 부재 시 no-op (조용히 종료)
 *  - turn_id는 직전 prompt의 turn_id와 동일하게 매핑 → Turn 탭에서 같은 카드에 표시
 *  - tokens/model은 transcript 마지막 assistant 라인에서 best-effort로 추출
 *  - 실패해도 /events 응답 200 유지 (claude_events 저장은 이미 성공)
 */
function saveAssistantResponse(
  db: Database,
  payload: RawHookPayload,
  timestamp: number,
): void {
  try {
    const sessionId = payload.session_id;
    const transcriptPath = payload.transcript_path ?? '';

    // ADR-001 P1: turn 마지막 어시스턴트 메시지를 transcript 백필로 먼저 INSERT.
    // 이렇게 하면 같은 메시지가 다음 turn의 PostToolUse 백필에서 중복 INSERT 되는 일이 없고,
    // entry별 자체 timestamp로 turn_id가 정확히 매핑된다.
    // (PostToolUse가 더 발생하지 않는 turn 종료 직전 메시지는 여기서만 살릴 수 있다.)
    let lastEntryMessageId: string | null = null;
    if (transcriptPath) {
      try {
        const entries = extractAssistantTextEntries(transcriptPath);
        if (entries.length > 0) {
          persistAssistantTextResponses(db, entries, {
            sessionId,
            projectName: '',
          });
          lastEntryMessageId = entries[entries.length - 1].messageId;
        }
      } catch (e) {
        console.error('[Events] transcript backfill on Stop failed:', e);
      }
    }

    // 1차: Stop 훅 payload에서 last_assistant_message 추출
    let message = typeof payload.last_assistant_message === 'string'
      ? payload.last_assistant_message
      : null;
    let proxyFallback: ReturnType<typeof getLatestProxyResponseBefore> = null;

    // 2차: 비어 있으면 같은 session의 최근 proxy 응답으로 fallback (ADR-001 P0).
    // 윈도우 120s — 운영 평균 응답 ~60s, 최대 ~224s를 고려한 절충값.
    if (!message || !message.trim()) {
      proxyFallback = getLatestProxyResponseBefore(db, sessionId, timestamp, 120_000);
      if (proxyFallback?.response_preview && proxyFallback.response_preview.trim()) {
        message = proxyFallback.response_preview;
      } else {
        return;
      }
    }

    // ADR-001 P1: 마지막 메시지가 transcript 백필로 이미 저장됐다면 자체 INSERT 생략.
    // 백필 행이 토큰/모델 메타를 더 정확히 보유하므로 그대로 SSoT로 채택.
    if (lastEntryMessageId) {
      const existsRow = db.query<{ 1: number }, [string]>(
        'SELECT 1 FROM requests WHERE id = ? LIMIT 1',
      ).get(`resp-msg-${lastEntryMessageId}`);
      if (existsRow) {
        invalidateDashboardCache();
        return;
      }
    }

    // tokens/model: transcript 파싱 best-effort, 실패 시 proxy fallback
    const usage = transcriptPath ? parseTranscript(transcriptPath) : null;
    const transcriptOk = usage !== null
      && usage.inputTokens.confidence !== 'error'
      && usage.outputTokens.confidence !== 'error';

    let tokensInput = 0;
    let tokensOutput = 0;
    let cacheCreate = 0;
    let cacheRead = 0;
    let model: string | null = null;
    let tokensConfidence: 'high' | 'low' | 'error';
    let tokensSource: 'transcript' | 'proxy' | 'unavailable';

    if (transcriptOk && usage) {
      tokensInput = usage.inputTokens.value ?? 0;
      tokensOutput = usage.outputTokens.value ?? 0;
      cacheCreate = usage.cacheCreationTokens.value ?? 0;
      cacheRead = usage.cacheReadTokens.value ?? 0;
      model = usage.model || null;
      tokensConfidence = 'high';
      tokensSource = 'transcript';
    } else if (proxyFallback) {
      tokensInput = proxyFallback.tokens_input;
      tokensOutput = proxyFallback.tokens_output;
      cacheCreate = proxyFallback.cache_creation_tokens;
      cacheRead = proxyFallback.cache_read_tokens;
      model = proxyFallback.model;
      tokensConfidence = (tokensInput > 0 || tokensOutput > 0) ? 'low' : 'error';
      tokensSource = (tokensInput > 0 || tokensOutput > 0) ? 'proxy' : 'unavailable';
    } else {
      tokensConfidence = 'error';
      tokensSource = 'unavailable';
    }

    // turn_id 매핑: Stop 시각 기준 가장 가까운 prompt의 turn_id (ADR-001 P1).
    // 단순히 getLastTurnId를 쓰면 다음 turn이 시작된 직후 도착한 Stop 처리 시
    // 새 turn에 잘못 묶일 수 있어 시각 기반 조회를 우선한다.
    const turnId = getTurnIdAt(db, sessionId, timestamp)
      ?? getLastTurnId(db, sessionId)
      ?? undefined;

    // ADR-001 P1-E: transcript 마지막 entry의 message_id가 곧 proxy의 api_request_id.
    // 이 매칭은 시간 윈도우 의존이 0초이며 Anthropic 외부 ID 동일성으로 확정적이다.
    // 미스 시(transcript 미존재 등) 기존 v19 시간 기반 cross-link로 폴백.
    let resolvedApiRequestId: string | null = lastEntryMessageId ?? null;
    if (!resolvedApiRequestId) {
      const apiReqIdRow = db.query<{ api_request_id: string }, [string, number]>(
        `SELECT api_request_id FROM proxy_requests
         WHERE session_id = ? AND api_request_id IS NOT NULL
           AND timestamp <= ?
         ORDER BY timestamp DESC LIMIT 1`,
      ).get(sessionId, timestamp);
      resolvedApiRequestId = apiReqIdRow?.api_request_id ?? null;
    }

    const id = `resp-${timestamp}-${randomUUID().slice(0, 8)}`;
    const previewText = message.slice(0, 2000);

    createRequest(db, {
      id,
      session_id: sessionId,
      timestamp,
      type: 'response',
      tool_name: undefined,
      tool_detail: undefined,
      turn_id: turnId,
      model: model ?? undefined,
      tokens_input: tokensInput,
      tokens_output: tokensOutput,
      tokens_total: tokensInput + tokensOutput,
      duration_ms: 0,
      payload: JSON.stringify(payload),
      source: 'claude-code-hook',
      cache_creation_tokens: cacheCreate,
      cache_read_tokens: cacheRead,
      preview: previewText,
      tool_use_id: null,
      event_type: 'assistant_response',
      tokens_confidence: tokensConfidence,
      tokens_source: tokensSource,
      api_request_id: resolvedApiRequestId,
    });

    invalidateDashboardCache();

    const session = getSessionById(db, sessionId);
    // ADR-001/002: 저장된 raw 행을 다시 SELECT → 정규화 → 송출 (페이로드 SSoT 단일화)
    const rawRow = getRequestById(db, id);
    if (rawRow) {
      const normalized = normalizeRequest(rawRow);
      broadcastNewRequest(normalized, {
        session_total_tokens: session?.total_tokens ?? (tokensInput + tokensOutput),
        event_phase: 'created',
      });
    }
  } catch (error) {
    console.error('[Events] Failed to save assistant response:', error);
  }
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
  });
}
