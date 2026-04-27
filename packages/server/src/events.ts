/**
 * Events Collector - POST /events
 *
 * @description 와일드카드 훅에서 전달되는 raw hook payload를 claude_events 테이블에 저장
 */

import type { Database } from 'bun:sqlite';
import { createEvent, endSession, reactivateSession, type ClaudeEvent } from '@spyglass/storage';

export interface RawHookPayload {
  hook_event_name: string;
  session_id: string;
  transcript_path?: string;
  cwd?: string;
  agent_id?: string;
  agent_type?: string;
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
    } else if (event.event_type === 'SessionStart') {
      // compact/resume: 동일 session_id로 SessionStart 재발생 시 ended_at 클리어
      reactivateSession(db, event.session_id);
    }

    return json({ success: true, event_id: event.event_id });
  } catch (error) {
    console.error('[Events] Failed to save event:', error);
    return json({ error: 'Failed to save event' }, 500);
  }
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
  });
}
