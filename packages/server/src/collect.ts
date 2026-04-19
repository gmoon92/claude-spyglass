/**
 * Collector API - /collect 엔드포인트
 *
 * @description 훅에서 전송된 raw payload를 수신하여 정제 후 SQLite에 저장
 *
 * 변경 이력:
 *  - v1: CollectPayload(가공된 데이터) 수신
 *  - v2: ClaudeHookPayload(raw hook payload) 수신 → 서버에서 정제
 */

import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import type { Database } from 'bun:sqlite';
import {
  createSession,
  getSessionById,
  createRequest,
  SpyglassDatabase,
  getDatabase,
} from '@spyglass/storage';
import type { Request as DbRequest } from '@spyglass/storage';
import { broadcastNewRequest } from './sse';

// =============================================================================
// 타입 정의
// =============================================================================

/**
 * Claude Code 훅이 stdin으로 전달하는 raw payload 구조
 * hook_event_name 기반으로 필드가 달라짐
 */
export interface ClaudeHookPayload {
  hook_event_name: string;   // UserPromptSubmit | PreToolUse | PostToolUse | ...
  session_id: string;
  transcript_path?: string;
  cwd?: string;
  tool_name?: string;
  tool_input?: Record<string, unknown>;
  tool_response?: unknown;
  tool_use_id?: string;
  permission_mode?: string;
  agent_id?: string;
  agent_type?: string;
  // UserPromptSubmit 전용
  prompt?: string;
}

/**
 * handleCollect() 내부에서 사용하는 가공된 데이터 형식
 * (기존 CollectPayload 유지 — 저장 로직과의 인터페이스)
 */
export interface CollectPayload {
  id: string;
  session_id: string;
  project_name: string;
  timestamp: number;
  event_type: string;
  request_type: 'prompt' | 'tool_call' | 'system';
  tool_name?: string;
  tool_detail?: string;
  model?: string;
  tokens_input: number;
  tokens_output: number;
  tokens_total: number;
  duration_ms?: number;
  payload?: string;
  source: string;
  cache_creation_tokens?: number;
  cache_read_tokens?: number;
  preview?: string;
}

/**
 * 수집 결과
 */
export interface CollectResult {
  success: boolean;
  request_id: string;
  session_id: string;
  saved: boolean;
  error?: string;
}

// =============================================================================
// 인메모리 타이밍 맵
// =============================================================================

/**
 * PreToolUse → PostToolUse duration_ms 측정용 인메모리 맵
 * 키: tool_use_id (Claude Code가 보장하는 Pre/Post 쌍 고유 식별자)
 * 값: PreToolUse 수신 timestamp (ms)
 *
 * ADR-002: 파일 기반(~/.spyglass/timing/{session_id}) → 인메모리 Map으로 교체
 * - tool_use_id 키 사용으로 병렬 도구 실행 시 충돌 없음
 */
export const toolTimingMap = new Map<string, number>();

// =============================================================================
// transcript 파싱
// =============================================================================

interface TranscriptUsage {
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
  model: string;
}

/**
 * transcript JSONL 파일에서 마지막 assistant 메시지의 usage + model 추출
 *
 * transcript_path의 JSONL은 각 라인이 독립적인 JSON 객체.
 * 마지막 type='assistant' 라인에서 message.usage, message.model 추출.
 *
 * bash의 extract_usage_from_transcript() + extract_model() 대체.
 */
export function parseTranscript(transcriptPath: string): TranscriptUsage {
  const defaultResult: TranscriptUsage = {
    inputTokens: 0,
    outputTokens: 0,
    cacheCreationTokens: 0,
    cacheReadTokens: 0,
    model: '',
  };

  if (!transcriptPath) return defaultResult;

  try {
    const content = readFileSync(transcriptPath, 'utf-8');
    const lines = content.split('\n').filter(line => line.trim());

    // 마지막 assistant 메시지 탐색 (뒤에서 앞으로)
    for (let i = lines.length - 1; i >= 0; i--) {
      try {
        const entry = JSON.parse(lines[i]) as Record<string, unknown>;
        if (entry.type !== 'assistant') continue;

        const message = entry.message as Record<string, unknown> | undefined;
        if (!message) continue;

        const usage = message.usage as Record<string, unknown> | undefined;
        return {
          inputTokens: (usage?.input_tokens as number) ?? 0,
          outputTokens: (usage?.output_tokens as number) ?? 0,
          cacheCreationTokens: (usage?.cache_creation_input_tokens as number) ?? 0,
          cacheReadTokens: (usage?.cache_read_input_tokens as number) ?? 0,
          model: (message.model as string) ?? '',
        };
      } catch {
        // 개별 라인 파싱 실패 → 다음 라인으로
        continue;
      }
    }
  } catch {
    // 파일 읽기 실패 (파일 없음 등) → 기본값 반환
  }

  return defaultResult;
}

// =============================================================================
// tool_detail 추출
// =============================================================================

/**
 * 도구별 파라미터 요약 문자열 반환
 *
 * bash의 extract_tool_detail() 대체.
 * tool_input은 ClaudeHookPayload.tool_input 필드.
 */
export function extractToolDetail(
  toolName: string,
  toolInput: Record<string, unknown>
): string | null {
  if (!toolInput) return null;

  switch (toolName) {
    case 'Read':
    case 'Edit':
    case 'MultiEdit':
    case 'Write': {
      const fp = toolInput.file_path as string | undefined;
      return fp || null;
    }

    case 'Bash': {
      const cmd = toolInput.command as string | undefined;
      if (!cmd) return null;
      return cmd.slice(0, 80);
    }

    case 'Glob': {
      const pattern = (toolInput.pattern as string) ?? '';
      const path = toolInput.path as string | undefined;
      if (!pattern) return null;
      return path ? `${pattern} in ${path}` : pattern;
    }

    case 'Grep': {
      const pattern = (toolInput.pattern as string) ?? '';
      const path = toolInput.path as string | undefined;
      if (!pattern) return null;
      return path ? `${pattern} in ${path}` : pattern;
    }

    case 'Skill': {
      const skill = toolInput.skill as string | undefined;
      if (skill) return skill.slice(0, 80);
      const args = toolInput.args as string | undefined;
      return args ? args.slice(0, 80) : null;
    }

    case 'Agent': {
      const subagentType = toolInput.subagent_type as string | undefined;
      const desc = toolInput.description as string | undefined;
      if (subagentType && desc) return `${subagentType}: ${desc}`.slice(0, 80);
      if (subagentType) return subagentType;
      if (desc) return desc.slice(0, 80);
      const prompt = toolInput.prompt as string | undefined;
      return prompt ? prompt.slice(0, 80) : null;
    }

    case 'WebFetch': {
      const url = toolInput.url as string | undefined;
      return url || null;
    }

    case 'WebSearch': {
      const query = toolInput.query as string | undefined;
      return query || null;
    }

    case 'ToolSearch': {
      const query = toolInput.query as string | undefined;
      return query ? query.slice(0, 80) : null;
    }

    case 'SendMessage': {
      const summary = toolInput.summary as string | undefined;
      const to      = toolInput.to      as string | undefined;
      if (summary) return to ? `→${to}: ${summary}`.slice(0, 80) : summary.slice(0, 80);
      return to ? `→${to}` : null;
    }

    case 'AskUserQuestion': {
      const questions = toolInput.questions as Array<{ question: string }> | undefined;
      const first = questions?.[0]?.question;
      return first ? first.slice(0, 80) : null;
    }

    default: {
      // mcp__* 공통: 첫 번째 의미 있는 문자열 필드 반환
      if (toolName.startsWith('mcp__')) {
        const firstStr = Object.values(toolInput).find(v => typeof v === 'string' && v.length > 2);
        return firstStr ? (firstStr as string).slice(0, 80) : null;
      }
      return null;
    }
  }
}

// =============================================================================
// 이벤트 분류
// =============================================================================

/**
 * hook_event_name → request_type 분류
 *
 * bash의 classify_request_type() 대체.
 */
export function classifyRequestType(
  hookEventName: string
): 'prompt' | 'tool_call' | 'system' {
  switch (hookEventName) {
    case 'UserPromptSubmit':
      return 'prompt';
    case 'PreToolUse':
    case 'PostToolUse':
      return 'tool_call';
    default:
      return 'system';
  }
}

// =============================================================================
// 세션 관리
// =============================================================================

/** 활성 세션 캐시 (메모리) */
const activeSessions = new Set<string>();

/**
 * 세션 확인 및 생성
 * INSERT OR IGNORE 사용으로 동시 요청/서버 재시작에도 FK 오류 없음
 */
function ensureSession(db: Database, payload: CollectPayload): boolean {
  const { session_id, project_name, timestamp } = payload;

  // 인메모리 캐시 히트: DB에도 실제 존재하는지 검증
  if (activeSessions.has(session_id)) {
    if (getSessionById(db, session_id)) return true;
    activeSessions.delete(session_id); // 스테일 캐시 제거
  }

  try {
    // INSERT OR IGNORE: 이미 존재하면 무시, 없으면 생성 — 항상 세션이 DB에 존재
    createSession(db, {
      id: session_id,
      project_name,
      started_at: timestamp,
      total_tokens: 0,
    });
    activeSessions.add(session_id);
    return true;
  } catch (error) {
    console.error('[Collect] Failed to ensure session:', error);
    return false;
  }
}

/**
 * 세션 토큰 업데이트
 */
function updateSessionTotalTokens(db: Database, payload: CollectPayload): void {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (db as any).run(
    'UPDATE sessions SET total_tokens = total_tokens + ? WHERE id = ?',
    payload.tokens_total,
    payload.session_id
  );
}

// =============================================================================
// 요청 저장
// =============================================================================

/**
 * 세션 내 다음 turn_id 채번
 * - prompt 타입 수신 시 호출
 * - 포맷: "<session_id>-T<순번>" (1부터 시작)
 */
function assignTurnId(db: Database, sessionId: string): string {
  const row = db.query(
    `SELECT COUNT(*) as cnt FROM requests WHERE session_id = ? AND type = 'prompt'`
  ).get(sessionId) as { cnt: number } | null;
  const next = (row?.cnt ?? 0) + 1;
  return `${sessionId}-T${next}`;
}

/**
 * 현재 세션의 마지막 turn_id 조회 (tool_call 저장 시 사용)
 */
function getLastTurnId(db: Database, sessionId: string): string | null {
  const row = db.query(
    `SELECT turn_id FROM requests WHERE session_id = ? AND type = 'prompt' ORDER BY timestamp DESC LIMIT 1`
  ).get(sessionId) as { turn_id: string } | null;
  return row?.turn_id ?? null;
}

/**
 * prompt 타입 요청의 사용자 입력 텍스트를 100자로 축약하여 반환
 */
function extractPreview(payload: CollectPayload): string | null {
  if (payload.request_type !== 'prompt') return null;
  // hook payload JSON에서 prompt 필드 추출
  if (payload.payload) {
    try {
      const raw = JSON.parse(payload.payload) as Record<string, unknown>;
      const text = typeof raw.prompt === 'string' ? raw.prompt : null;
      if (text) return text.slice(0, 100);
    } catch {
      // JSON 파싱 실패 시 무시
    }
  }
  return null;
}

/**
 * payload JSON에서 tool_use_id 추출
 */
function extractToolUseId(payloadStr?: string): string | null {
  if (!payloadStr) return null;
  try {
    const raw = JSON.parse(payloadStr) as Record<string, unknown>;
    return typeof raw.tool_use_id === 'string' ? raw.tool_use_id : null;
  } catch {
    return null;
  }
}

/**
 * tool_use_id 기준으로 pre_tool 레코드 조회
 */
function findPreToolRecord(db: Database, sessionId: string, toolUseId: string): DbRequest | null {
  return db.query(
    "SELECT * FROM requests WHERE session_id = ? AND tool_use_id = ? AND event_type = 'pre_tool' LIMIT 1"
  ).get(sessionId, toolUseId) as DbRequest | null;
}

/**
 * pre_tool 레코드를 post_tool 데이터로 UPDATE (Upsert merge)
 * - 토큰, 소요 시간, payload, event_type을 'tool'로 갱신
 * - tool_name, tool_detail은 pre_tool에서 이미 저장된 값 유지
 */
function mergePostToolIntoPreTool(
  db: Database,
  preToolId: string,
  payload: CollectPayload
): boolean {
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
         event_type = 'tool'
     WHERE id = ?`,
    payload.duration_ms || 0,
    payload.tokens_input,
    payload.tokens_output,
    payload.tokens_total,
    payload.cache_creation_tokens ?? 0,
    payload.cache_read_tokens ?? 0,
    payload.model ?? null,
    payload.payload ?? null,
    preToolId
  );
  return result.changes > 0;
}

/**
 * 요청 데이터 저장
 *
 * tool_call 이벤트의 Upsert 패턴:
 *  - event_type='pre_tool': tool_use_id와 함께 INSERT (타이밍 기록용)
 *  - event_type='tool': 동일 tool_use_id의 pre_tool 레코드가 있으면 UPDATE, 없으면 INSERT
 *
 * @returns { saved: boolean, wasUpsert: boolean }
 *   wasUpsert=true: post_tool이 pre_tool을 덮어씀 → session 토큰 재계산 필요
 */
function saveRequest(db: Database, payload: CollectPayload): { saved: boolean; wasUpsert: boolean } {
  try {
    const toolUseId = extractToolUseId(payload.payload);
    const isPostTool = payload.event_type === 'tool' && payload.request_type === 'tool_call';

    // PostToolUse: 기존 pre_tool 레코드 Upsert 시도
    if (isPostTool && toolUseId) {
      const preToolRecord = findPreToolRecord(db, payload.session_id, toolUseId);
      if (preToolRecord) {
        const merged = mergePostToolIntoPreTool(db, preToolRecord.id, payload);
        if (merged) {
          return { saved: true, wasUpsert: true };
        }
      }
    }

    // 일반 INSERT (pre_tool 또는 pre_tool 레코드를 못 찾은 post_tool, 또는 tool_call 외 타입)
    let turnId: string | undefined;
    if (payload.request_type === 'prompt') {
      turnId = assignTurnId(db, payload.session_id);
    } else {
      turnId = getLastTurnId(db, payload.session_id) ?? undefined;
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
      tool_use_id: toolUseId,
      event_type: payload.event_type || null,
    });
    return { saved: true, wasUpsert: false };
  } catch (error) {
    console.error('[Collect] Failed to save request:', error);
    return { saved: false, wasUpsert: false };
  }
}

// =============================================================================
// Collect 핸들러
// =============================================================================

/**
 * /collect 엔드포인트 핸들러 (정제된 CollectPayload 기반 저장)
 *
 * rawCollectHandler()에서 정제 후 호출됨.
 * 기존 로직(turn_id 부여, pre/post merge, SSE 브로드캐스트) 유지.
 */
export function handleCollect(
  db: Database,
  payload: CollectPayload
): CollectResult {
  // 필수 필드 검증
  if (!payload.id || !payload.session_id) {
    return {
      success: false,
      request_id: payload.id || 'unknown',
      session_id: payload.session_id || 'unknown',
      saved: false,
      error: 'Missing required fields: id, session_id',
    };
  }

  // 세션 확인/생성
  const sessionOk = ensureSession(db, payload);
  if (!sessionOk) {
    return {
      success: false,
      request_id: payload.id,
      session_id: payload.session_id,
      saved: false,
      error: 'Failed to ensure session',
    };
  }

  // 요청 저장
  const { saved, wasUpsert } = saveRequest(db, payload);

  if (saved) {
    if (wasUpsert) {
      // Upsert(pre_tool → tool 병합): pre_tool에서 이미 0 토큰이 카운트됐을 수 있음.
      // pre_tool은 tokens_total=0이므로 단순히 post_tool 토큰을 더하면 됨.
      updateSessionTotalTokens(db, payload);
    } else if (payload.event_type !== 'pre_tool') {
      // 일반 INSERT (pre_tool 제외): 세션 토큰 업데이트
      // pre_tool은 토큰 0이므로 세션 카운트에서 제외
      updateSessionTotalTokens(db, payload);
    }

    // pre_tool은 SSE 브로드캐스트 제외:
    //   PreToolUse 시점엔 토큰·응답이 없는 미완성 레코드이며,
    //   PostToolUse에서 Upsert(갱신) 또는 별도 INSERT(event_type='tool')로 완성됨.
    //   브로드캐스트하면 실시간 피드에 동일 tool_call이 2건으로 중복 노출됨.
    if (payload.event_type !== 'pre_tool') {
      const updatedSession = getSessionById(db, payload.session_id);
      broadcastNewRequest({
        id: payload.id,
        session_id: payload.session_id,
        type: payload.request_type,
        request_type: payload.request_type,
        tool_name: payload.tool_name ?? null,
        tool_detail: payload.tool_detail ?? null,
        tokens_input: payload.tokens_input,
        tokens_output: payload.tokens_output,
        tokens_total: payload.tokens_total,
        duration_ms: payload.duration_ms || 0,
        model: payload.model ?? null,
        timestamp: payload.timestamp,
        payload: payload.payload ?? null,
        session_total_tokens: updatedSession?.total_tokens ?? payload.tokens_total,
      });
    }
  }

  return {
    success: saved,
    request_id: payload.id,
    session_id: payload.session_id,
    saved,
  };
}

// =============================================================================
// Raw Hook 핸들러 (신규)
// =============================================================================

/**
 * raw Claude Code hook payload를 수신하여 정제 후 handleCollect()에 위임
 *
 * 처리 흐름:
 *  1. raw payload 파싱
 *  2. [RECV] 로그 출력
 *  3. hook_event_name 분기
 *     - PreToolUse: toolTimingMap에 타임스탬프 저장 → pre_tool INSERT
 *     - PostToolUse: duration_ms 계산 → transcript 파싱 → tool INSERT
 *     - UserPromptSubmit: transcript 파싱 → prompt INSERT
 *  4. handleCollect() 호출
 */
export async function rawCollectHandler(req: Request, db: SpyglassDatabase): Promise<Response> {
  // POST만 허용
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  let raw: ClaudeHookPayload;
  try {
    raw = (await req.json()) as ClaudeHookPayload;
  } catch {
    return new Response(
      JSON.stringify({ success: false, error: 'Invalid JSON payload' }),
      { status: 400, headers: { 'Content-Type': 'application/json' } }
    );
  }

  const {
    hook_event_name,
    session_id,
    transcript_path,
    cwd,
    tool_name,
    tool_input,
    tool_use_id,
  } = raw;

  // 수신 즉시 로그
  console.log(`[RECV] ${hook_event_name} session=${session_id}`);

  // 기본값 설정
  const now = Date.now();
  const project_name = cwd ? cwd.split('/').pop() ?? 'unknown' : 'unknown';

  // PreToolUse: 타이밍 기록 후 pre_tool INSERT
  if (hook_event_name === 'PreToolUse') {
    if (tool_use_id) {
      toolTimingMap.set(tool_use_id, now);
    }

    const toolDetail = tool_name && tool_input
      ? extractToolDetail(tool_name, tool_input)
      : null;

    const requestId = `pre-${now}-${randomUUID().slice(0, 8)}`;
    const collectPayload: CollectPayload = {
      id: requestId,
      session_id,
      project_name,
      timestamp: now,
      event_type: 'pre_tool',
      request_type: 'tool_call',
      tool_name: tool_name ?? undefined,
      tool_detail: toolDetail ?? undefined,
      model: undefined,
      tokens_input: 0,
      tokens_output: 0,
      tokens_total: 0,
      duration_ms: 0,
      payload: JSON.stringify(raw),
      source: 'claude-code-hook',
      cache_creation_tokens: 0,
      cache_read_tokens: 0,
    };

    const result = handleCollect(db.instance, collectPayload);
    return new Response(JSON.stringify(result), {
      status: result.success ? 200 : 400,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    });
  }

  // PostToolUse: duration_ms 계산 + transcript 파싱 후 tool INSERT
  if (hook_event_name === 'PostToolUse') {
    let duration_ms = 0;
    if (tool_use_id) {
      const startTs = toolTimingMap.get(tool_use_id);
      if (startTs !== undefined) {
        duration_ms = now - startTs;
        toolTimingMap.delete(tool_use_id);
      }
    }

    const transcriptData = transcript_path ? parseTranscript(transcript_path) : null;
    const toolDetail = tool_name && tool_input
      ? extractToolDetail(tool_name, tool_input)
      : null;

    const requestId = `tool-${now}-${randomUUID().slice(0, 8)}`;
    const tokensInput = transcriptData?.inputTokens ?? 0;
    const tokensOutput = transcriptData?.outputTokens ?? 0;

    const collectPayload: CollectPayload = {
      id: requestId,
      session_id,
      project_name,
      timestamp: now,
      event_type: 'tool',
      request_type: 'tool_call',
      tool_name: tool_name ?? undefined,
      tool_detail: toolDetail ?? undefined,
      model: transcriptData?.model || undefined,
      tokens_input: tokensInput,
      tokens_output: tokensOutput,
      tokens_total: tokensInput + tokensOutput,
      duration_ms,
      payload: JSON.stringify(raw),
      source: 'claude-code-hook',
      cache_creation_tokens: transcriptData?.cacheCreationTokens ?? 0,
      cache_read_tokens: transcriptData?.cacheReadTokens ?? 0,
    };

    const result = handleCollect(db.instance, collectPayload);
    return new Response(JSON.stringify(result), {
      status: result.success ? 200 : 400,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    });
  }

  // UserPromptSubmit: transcript 파싱 후 prompt INSERT
  if (hook_event_name === 'UserPromptSubmit') {
    const transcriptData = transcript_path ? parseTranscript(transcript_path) : null;

    const requestId = `prompt-${now}-${randomUUID().slice(0, 8)}`;
    const tokensInput = transcriptData?.inputTokens ?? 0;
    const tokensOutput = transcriptData?.outputTokens ?? 0;

    const collectPayload: CollectPayload = {
      id: requestId,
      session_id,
      project_name,
      timestamp: now,
      event_type: 'prompt',
      request_type: 'prompt',
      tool_name: undefined,
      tool_detail: undefined,
      model: transcriptData?.model || undefined,
      tokens_input: tokensInput,
      tokens_output: tokensOutput,
      tokens_total: tokensInput + tokensOutput,
      payload: JSON.stringify(raw),
      source: 'claude-code-hook',
      cache_creation_tokens: transcriptData?.cacheCreationTokens ?? 0,
      cache_read_tokens: transcriptData?.cacheReadTokens ?? 0,
    };

    const result = handleCollect(db.instance, collectPayload);
    return new Response(JSON.stringify(result), {
      status: result.success ? 200 : 400,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    });
  }

  // 그 외 이벤트 (system 타입으로 저장)
  const requestId = `sys-${now}-${randomUUID().slice(0, 8)}`;
  const collectPayload: CollectPayload = {
    id: requestId,
    session_id,
    project_name,
    timestamp: now,
    event_type: hook_event_name.toLowerCase(),
    request_type: 'system',
    tokens_input: 0,
    tokens_output: 0,
    tokens_total: 0,
    payload: JSON.stringify(raw),
    source: 'claude-code-hook',
  };

  const result = handleCollect(db.instance, collectPayload);
  return new Response(JSON.stringify(result), {
    status: result.success ? 200 : 400,
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
  });
}

// =============================================================================
// HTTP 핸들러 (레거시 — 하위 호환용)
// =============================================================================

/**
 * Bun HTTP 서버용 collect 핸들러 (레거시)
 * api.ts에서는 rawCollectHandler를 사용
 */
export async function collectHandler(req: Request, db: SpyglassDatabase): Promise<Response> {
  // POST만 허용
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    // JSON 파싱
    const payload = (await req.json()) as CollectPayload;

    // 처리
    const result = handleCollect(db.instance, payload);

    // 응답
    const statusCode = result.success ? 200 : 400;
    return new Response(JSON.stringify(result), {
      status: statusCode,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
    });
  } catch (error) {
    console.error('[Collect] Error processing request:', error);
    return new Response(
      JSON.stringify({
        success: false,
        error: 'Invalid JSON payload',
      }),
      {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }
}

// =============================================================================
// CLI 테스트
// =============================================================================

/**
 * 직접 실행 테스트
 */
if (import.meta.main) {
  const db = getDatabase();

  // 테스트 데이터
  const testPayload: CollectPayload = {
    id: `test-${Date.now()}`,
    session_id: 'test-session',
    project_name: 'test-project',
    timestamp: Date.now(),
    event_type: 'prompt',
    request_type: 'prompt',
    model: 'claude-sonnet',
    tokens_input: 100,
    tokens_output: 50,
    tokens_total: 150,
    duration_ms: 1000,
    source: 'cli-test',
  };

  console.log('Testing collect handler...');
  const result = handleCollect(db.instance, testPayload);
  console.log('Result:', JSON.stringify(result, null, 2));

  if (result.success) {
    console.log('Collect test passed');
  } else {
    console.error('Collect test failed:', result.error);
    process.exit(1);
  }
}
