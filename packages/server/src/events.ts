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
import { getLastTurnId, parseTranscript } from './hook';
import { broadcastNewRequest, broadcastSessionUpdate } from './sse';
import { normalizeRequest } from './domain/request-normalizer';
import { invalidateDashboardCache } from './api';
import { diagJson } from './diag-log';

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

    // 1차: Stop 훅 payload에서 last_assistant_message 추출
    let message = typeof payload.last_assistant_message === 'string'
      ? payload.last_assistant_message
      : null;
    let proxyFallback: ReturnType<typeof getLatestProxyResponseBefore> = null;

    // 2차: 비어 있으면 proxy_requests의 최근 response_preview로 fallback
    if (!message || !message.trim()) {
      proxyFallback = getLatestProxyResponseBefore(db, timestamp, 30_000);
      if (proxyFallback?.response_preview && proxyFallback.response_preview.trim()) {
        message = proxyFallback.response_preview;
      } else {
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

    // turn_id 매핑: 직전 prompt의 turn_id 재사용 (없으면 NULL)
    const turnId = getLastTurnId(db, sessionId) ?? undefined;

    // v19: 응답 행에 같은 session의 가장 최근 proxy_requests의 api_request_id를 cross-link.
    // Stop 시점엔 해당 turn의 proxy 응답이 모두 끝나 있어 신뢰 가능.
    const apiReqIdRow = db.query<{ api_request_id: string }, [string, number]>(
      `SELECT api_request_id FROM proxy_requests
       WHERE session_id = ? AND api_request_id IS NOT NULL
         AND timestamp <= ?
       ORDER BY timestamp DESC LIMIT 1`,
    ).get(sessionId, timestamp);

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
      api_request_id: apiReqIdRow?.api_request_id ?? null,
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
