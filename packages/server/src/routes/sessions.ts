/**
 * /api/sessions/* 라우트 — 세션 도메인.
 *
 * @description
 *   srp-redesign Phase 2: api.ts(406줄) 분해 결과.
 *   변경 이유: "세션 조회·세션별 자식 데이터 제공 정책 변경".
 *
 *   포함 라우트 (10개):
 *   - GET /api/sessions
 *   - GET /api/sessions/active
 *   - GET /api/sessions/:id/requests
 *   - GET /api/sessions/:id/stats
 *   - GET /api/sessions/:id/turns
 *   - GET /api/sessions/:id/tool-stats
 *   - GET /api/sessions/:id/events
 *   - GET /api/sessions/:id  (catch-all — 마지막에 배치)
 *   - GET /api/projects/:name/sessions
 *   - GET /api/projects/:name/tool-stats  (ADR-004 meta-docs-tool-stats)
 *
 *   세션 도메인이 같은 파일에 응집된 이유: 라우트 매칭 우선순위 보존.
 *   예: /api/sessions/:id가 catch-all이라 /api/sessions/active·:id/requests 등
 *   하위 경로보다 늦게 매칭되어야 함 — 한 파일 안에서 순서 명시가 가장 안전.
 */

import {
  getActiveSessions,
  getAllSessions,
  getEventsBySession,
  getMaxContextProxyForSession,
  getProjectToolStats,
  getRequestsBySession,
  getRequestStatsBySession,
  getSessionById,
  getSessionsByProject,
  getSessionToolStats,
  getTurnsBySession,
  getOrphanRowsBySession,
  type Request,
  type TurnItem,
} from '@spyglass/storage';
import { normalizeRequests, normalizeTurns } from '../domain/request-normalizer';
import { jsonResponse, type RouteHandler } from './_shared';

export const sessionsRouter: RouteHandler = (_req, db, url, path, method) => {
  // GET /api/sessions
  if (path === '/api/sessions' && method === 'GET') {
    const limit = parseInt(url.searchParams.get('limit') || '100', 10);
    const fromTs = url.searchParams.get('from') ? parseInt(url.searchParams.get('from')!, 10) : undefined;
    const toTs = url.searchParams.get('to') ? parseInt(url.searchParams.get('to')!, 10) : undefined;
    const sessions = getAllSessions(db, limit, fromTs, toTs);
    return jsonResponse({ success: true, data: sessions, meta: { total: sessions.length, limit } });
  }

  // GET /api/sessions/active
  if (path === '/api/sessions/active' && method === 'GET') {
    const sessions = getActiveSessions(db);
    return jsonResponse({ success: true, data: sessions });
  }

  // GET /api/sessions/:id/requests — ADR-001 (log-view-unification): 응답 직전 정규화
  if (path.match(/^\/api\/sessions\/[^\/]+\/requests$/) && method === 'GET') {
    const sessionId = path.split('/')[3];
    const limit = parseInt(url.searchParams.get('limit') || '100', 10);
    const rawRequests = getRequestsBySession(db, sessionId, limit);
    const requests = normalizeRequests(rawRequests);
    return jsonResponse({ success: true, data: requests, meta: { total: requests.length, limit } });
  }

  // GET /api/sessions/:id/stats
  if (path.match(/^\/api\/sessions\/[^\/]+\/stats$/) && method === 'GET') {
    const sessionId = path.split('/')[3];
    const stats = getRequestStatsBySession(db, sessionId);
    return jsonResponse({ success: true, data: stats });
  }

  // GET /api/sessions/:id/turns — ADR-001/006: 정규화 + items[] 인터리빙
  // 정책: orphan(turn_id NULL) 행은 항상 첫 turn에 흡수해 반환 — 별도 "세션 프롤로그" 섹션 노출 안 함.
  //  - prompt 0건이면 orphan들로 implicit turn(T1)을 합성
  //  - prompt 있으면 orphan을 첫 turn의 tool_calls/responses에 합쳐 normalizeTurns에 넘김
  if (path.match(/^\/api\/sessions\/[^\/]+\/turns$/) && method === 'GET') {
    const sessionId = path.split('/')[3];
    const rawTurns = getTurnsBySession(db, sessionId);
    const rawOrphans = getOrphanRowsBySession(db, sessionId);

    if (rawTurns.length === 0 && rawOrphans.length > 0) {
      const implicit = buildImplicitTurnFromOrphans(db, sessionId, rawOrphans);
      const turns = normalizeTurns([implicit], sessionId);
      return jsonResponse({
        success: true,
        data: turns,
        prologue: [],
        meta: { total: turns.length, prologue_count: 0, implicit_turn: true },
      });
    }

    const mergedTurns = rawOrphans.length > 0
      ? absorbOrphansIntoFirstTurn(rawTurns, rawOrphans)
      : rawTurns;
    const turns = normalizeTurns(mergedTurns, sessionId);
    return jsonResponse({
      success: true,
      data: turns,
      prologue: [],
      meta: { total: turns.length, prologue_count: 0 },
    });
  }

  // GET /api/sessions/:id/tool-stats
  const toolStatsMatch = path.match(/^\/api\/sessions\/([^/]+)\/tool-stats$/);
  if (toolStatsMatch && method === 'GET') {
    const sessionId = decodeURIComponent(toolStatsMatch[1]);
    const rows = getSessionToolStats(db, sessionId);
    // data-honesty-ui: confidence 카운트 → has_low_confidence boolean 파생
    const data = rows.map((r) => ({
      ...r,
      has_low_confidence: (r.confidence_low_count ?? 0) + (r.confidence_error_count ?? 0) > 0,
    }));
    return jsonResponse({ success: true, data });
  }

  // GET /api/sessions/:id/events — events 라우터에서도 매칭되지만 ordering으로 여기서 먼저
  if (path.match(/^\/api\/sessions\/[^\/]+\/events$/) && method === 'GET') {
    const sessionId = path.split('/')[3];
    const limit = parseInt(url.searchParams.get('limit') || '100', 10);
    const events = getEventsBySession(db, sessionId, limit);
    return jsonResponse({ success: true, data: events, meta: { total: events.length, limit } });
  }

  // GET /api/sessions/:id  (반드시 하위 경로 라우트 뒤에 위치)
  if (path.startsWith('/api/sessions/') && method === 'GET') {
    const id = path.replace('/api/sessions/', '');
    const session = getSessionById(db, id);
    if (!session) {
      return jsonResponse({ success: false, error: 'Session not found' }, 404);
    }
    return jsonResponse({ success: true, data: session });
  }

  return helperFallthrough(_req, db, url, path, method);
};

/**
 * orphan(turn_id NULL) 행을 첫 turn에 흡수.
 *
 * - tool_call orphan은 첫 turn의 tool_calls 앞에 추가 (timestamp ASC 유지)
 * - response orphan은 첫 turn의 responses 앞에 추가
 * - summary.tool_call_count / total_tokens / duration_ms도 보정
 *
 * c397081의 retroactive 매핑(--fix CLI 전용 SQL)을 실시간 응답 단계에서 무손실로 적용한 등가.
 */
function absorbOrphansIntoFirstTurn(turns: TurnItem[], orphans: Request[]): TurnItem[] {
  if (turns.length === 0 || orphans.length === 0) return turns;
  // getTurnsBySession는 desc 정렬(최신 turn 먼저) — 첫 turn은 turn_index가 가장 작은 turn.
  // orphan은 항상 가장 오래된 turn에 흡수되어야 시간 일관성이 맞는다.
  let firstIdx = 0;
  let firstIndex = turns[0].turn_index;
  turns.forEach((t, i) => {
    if (t.turn_index < firstIndex) { firstIdx = i; firstIndex = t.turn_index; }
  });
  const first = turns[firstIdx];

  const orphanTools = orphans
    .filter((r) => r.type === 'tool_call')
    .map((r) => ({
      id: r.id,
      type: 'tool_call' as const,
      timestamp: r.timestamp,
      tool_name: r.tool_name ?? null,
      tool_detail: r.tool_detail ?? null,
      tokens_input: r.tokens_input ?? 0,
      tokens_output: r.tokens_output ?? 0,
      tokens_total: r.tokens_total ?? 0,
      duration_ms: r.duration_ms ?? 0,
      payload: r.payload ?? null,
      event_type: r.event_type ?? null,
      model: r.model ?? null,
      parent_tool_use_id: r.parent_tool_use_id ?? null,
      tokens_confidence: r.tokens_confidence ?? null,
    }));

  const orphanResponses = orphans
    .filter((r) => r.type === 'response')
    .map((r) => ({
      id: r.id,
      timestamp: r.timestamp,
      preview: r.preview ?? null,
      payload: r.payload ?? null,
      tokens_input: r.tokens_input ?? 0,
      tokens_output: r.tokens_output ?? 0,
      tokens_total: r.tokens_total ?? 0,
      model: r.model ?? null,
      tokens_confidence: r.tokens_confidence ?? null,
    }));

  const mergedTools = [...orphanTools, ...first.tool_calls]
    .sort((a, b) => a.timestamp - b.timestamp);
  const mergedResponses = [...orphanResponses, ...first.responses]
    .sort((a, b) => a.timestamp - b.timestamp);

  const addedTokens = orphans.reduce((s, r) => s + (r.tokens_total ?? 0), 0);
  const newStartedAt = Math.min(
    first.started_at,
    ...orphans.map((r) => r.timestamp),
  );
  const lastTool = mergedTools[mergedTools.length - 1];
  const newDuration = lastTool
    ? Math.max(first.summary.duration_ms, lastTool.timestamp + lastTool.duration_ms - newStartedAt)
    : first.summary.duration_ms;

  const newFirst: TurnItem = {
    ...first,
    started_at: newStartedAt,
    tool_calls: mergedTools,
    responses: mergedResponses,
    summary: {
      ...first.summary,
      tool_call_count: mergedTools.length,
      total_tokens: first.summary.total_tokens + addedTokens,
      duration_ms: newDuration,
    },
  };

  const next = turns.slice();
  next[firstIdx] = newFirst;
  return next;
}

/**
 * 진행 중 세션이 prompt 0건 + orphan 다수인 경우 단일 implicit turn으로 합성.
 *
 * - turn_id: `implicit-<sessionId>` (고유, 안정)
 * - turn_index: 1
 * - prompt 토큰 합: proxy_requests에서 컨텍스트가 가장 큰 행으로 추정. 없으면 0
 *   → context-chart의 hasValid 체크(context_tokens > 0 || tokens_input > 0)와 자연스럽게 정합
 * - tool_calls / responses: orphan에서 type별 분기, timestamp 오름차순
 */
function buildImplicitTurnFromOrphans(
  db: Parameters<RouteHandler>[1],
  sessionId: string,
  orphans: Request[],
): TurnItem {
  const turnId = `implicit-${sessionId}`;
  const sorted = orphans.slice().sort((a, b) => a.timestamp - b.timestamp);
  const startedAt = sorted[0]?.timestamp ?? Date.now();

  const proxyCtx = getMaxContextProxyForSession(db, sessionId);
  const promptInput = proxyCtx?.tokens_input ?? 0;
  const promptOutput = proxyCtx?.tokens_output ?? 0;
  const cacheRead = proxyCtx?.cache_read_tokens ?? 0;
  const cacheCreate = proxyCtx?.cache_creation_tokens ?? 0;
  const contextTokens = promptInput + cacheRead + cacheCreate;

  const toolCalls: TurnItem['tool_calls'] = sorted
    .filter((r) => r.type === 'tool_call')
    .map((r) => ({
      id: r.id,
      type: 'tool_call' as const,
      timestamp: r.timestamp,
      tool_name: r.tool_name ?? null,
      tool_detail: r.tool_detail ?? null,
      tokens_input: r.tokens_input ?? 0,
      tokens_output: r.tokens_output ?? 0,
      tokens_total: r.tokens_total ?? 0,
      duration_ms: r.duration_ms ?? 0,
      payload: r.payload ?? null,
      event_type: r.event_type ?? null,
      model: r.model ?? null,
      parent_tool_use_id: r.parent_tool_use_id ?? null,
      tokens_confidence: r.tokens_confidence ?? null,
    }));

  const responses = sorted
    .filter((r) => r.type === 'response')
    .map((r) => ({
      id: r.id,
      timestamp: r.timestamp,
      preview: r.preview ?? null,
      payload: r.payload ?? null,
      tokens_input: r.tokens_input ?? 0,
      tokens_output: r.tokens_output ?? 0,
      tokens_total: r.tokens_total ?? 0,
      model: r.model ?? null,
      tokens_confidence: r.tokens_confidence ?? null,
    }));

  const totalTokens = toolCalls.reduce((s, t) => s + t.tokens_total, 0)
    + responses.reduce((s, r) => s + r.tokens_total, 0)
    + (promptInput + promptOutput);

  const lastTool = toolCalls[toolCalls.length - 1];
  const duration_ms = lastTool
    ? Math.max(0, lastTool.timestamp + lastTool.duration_ms - startedAt)
    : 0;

  return {
    turn_id: turnId,
    turn_index: 1,
    started_at: startedAt,
    prompt: {
      id: `${turnId}-prompt`,
      timestamp: startedAt,
      tokens_input: promptInput,
      tokens_output: promptOutput,
      tokens_total: promptInput + promptOutput,
      duration_ms: 0,
      model: proxyCtx?.model ?? null,
      payload: null,
      cache_read_tokens: cacheRead,
      cache_creation_tokens: cacheCreate,
      context_tokens: contextTokens,
      tokens_confidence: 'low',
      anthropic_beta: proxyCtx?.anthropic_beta ?? null,
    },
    system_hash: null,
    system_byte_size: null,
    system_reminder: null,
    tool_calls: toolCalls,
    responses,
    summary: {
      tool_call_count: toolCalls.length,
      tokens_input: promptInput,
      tokens_output: promptOutput,
      total_tokens: totalTokens,
      duration_ms,
    },
  };
}

/**
 * sessions 라우터의 prefix 매칭이 모두 실패한 경우 — 라우터의 잔여 라우트 처리.
 */
const helperFallthrough: RouteHandler = (_req, db, url, path, method) => {
  // GET /api/projects/:name/sessions
  if (path.match(/^\/api\/projects\/[^\/]+\/sessions$/) && method === 'GET') {
    const projectName = path.split('/')[3];
    const limit = parseInt(url.searchParams.get('limit') || '100', 10);
    const fromTs = url.searchParams.get('from') ? parseInt(url.searchParams.get('from')!, 10) : undefined;
    const toTs = url.searchParams.get('to') ? parseInt(url.searchParams.get('to')!, 10) : undefined;
    const sessions = getSessionsByProject(db, projectName, limit, fromTs, toTs);
    return jsonResponse({ success: true, data: sessions, meta: { total: sessions.length, limit } });
  }

  // GET /api/projects/:name/tool-stats (ADR-004 meta-docs-tool-stats)
  // 프로젝트 단위 도구별 성능 매트릭스. getSessionToolStats와 동일 컬럼 + has_low_confidence 파생.
  const projectToolStatsMatch = path.match(/^\/api\/projects\/([^/]+)\/tool-stats$/);
  if (projectToolStatsMatch && method === 'GET') {
    const projectName = decodeURIComponent(projectToolStatsMatch[1]);
    const fromTs = url.searchParams.get('from') ? parseInt(url.searchParams.get('from')!, 10) : undefined;
    const toTs   = url.searchParams.get('to')   ? parseInt(url.searchParams.get('to')!,   10) : undefined;
    const rows = getProjectToolStats(db, projectName, fromTs, toTs);
    // data-honesty-ui: getSessionToolStats 라우트와 동일 파생(SSoT) — has_low_confidence boolean
    const data = rows.map((r) => ({
      ...r,
      has_low_confidence: (r.confidence_low_count ?? 0) + (r.confidence_error_count ?? 0) > 0,
    }));
    return jsonResponse({ success: true, data });
  }

  return null;
};
