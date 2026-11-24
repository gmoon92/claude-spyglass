/**
 * /api/conversations 라우트 — 날짜 범위 대화(프롬프트·응답) 조회.
 *
 * @description
 *   주간 업무 보고·사용 패턴 분석·메타 문서 고도화용 원천 데이터 API.
 *   변경 이유: "대화 프로젝션 노출 정책 (날짜 해석·본문 추출·그룹핑) 변경" —
 *   requests.ts(정규화+anomaly 노출)와 변경 축이 달라 분리.
 *
 *   GET /api/conversations?start=YYYY-MM-DD&end=YYYY-MM-DD&project=<optional>
 *   GET /api/conversations?from=<ms>&to=<ms>&project=<optional>        (허브 API 함정 4)
 *   - 날짜는 로컬 타임존 기준 start 00:00:00.000 ~ end 23:59:59.999 로 해석
 *   - from·to(ms epoch, 둘 다 포함)를 주면 start·end 대신 쓴다. 섞어 쓰면 400.
 *   - fields=summary: 원문 대신 세션별 {id, project, started_at, prompts(첫 줄 120자), prompt_count,
 *     response_count, first_at, last_at, tokens, skills, agents} — 허브 업무일지용. 기본은 원문 그대로.
 *   - 본문은 payload JSON에서 전문 추출, 실패 시 preview(≤2000자) 폴백
 *     (text_source: 'full' | 'preview' 로 절단 가능성 노출)
 *   - 툴 호출 행은 storage 쿼리에서 제외 (type IN ('prompt','response'))
 */

import { getConversationRows, getSessionWindowActivity } from '@spyglass/storage';
import { jsonResponse, type RouteHandler } from './_shared';

/** 한 번에 fetch 하는 행 상한 — 일주일치 전문 payload 디코딩 비용 안전장치 */
const MAX_ROWS = 5000;
/** 날짜 범위 상한 (일) — 과대 범위 요청 차단 */
const MAX_RANGE_DAYS = 31;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MS_RE = /^\d+$/;
/** fields=summary 에서 프롬프트 한 줄 미리보기 길이 */
const SUMMARY_PROMPT_CHARS = 120;

/** 응답 메시지 1건 — 세션 그룹 내 시간순 */
interface ConversationMessage {
  ts: number;
  role: 'user' | 'assistant';
  text: string;
  /** 'full' = payload 전문 / 'preview' = ≤2000자 폴백 (proxy-fallback 행 등 절단 가능) */
  text_source: 'full' | 'preview';
}

/** 세션 그룹 — 세션 메타 + 시간순 메시지 배열 */
interface ConversationSession {
  id: string;
  project: string;
  started_at: number;
  messages: ConversationMessage[];
}

/**
 * payload JSON에서 본문 전문 추출. 판단 로직 단일화 — 호출 측 재계산 금지.
 *
 * 행 출처별 전문 위치 (write 경로 SSoT 참조):
 *  - prompt: raw UserPromptSubmit hook JSON `.prompt` (user-prompt-submit.handler.ts)
 *  - response/Stop hook: `.last_assistant_message` (events.ts saveAssistantResponse)
 *  - response/transcript backfill: `.text` (persist.ts persistAssistantTextResponses)
 *  - proxy-fallback 행: payload에 전문 없음 → preview 폴백 (전문 복구 불가, ≤2000자)
 */
function extractText(
  type: 'prompt' | 'response',
  payload: string | null,
  preview: string | null,
): { text: string; text_source: 'full' | 'preview' } {
  if (payload) {
    try {
      const obj = JSON.parse(payload) as Record<string, unknown>;
      if (type === 'prompt' && typeof obj.prompt === 'string') {
        return { text: obj.prompt, text_source: 'full' };
      }
      if (type === 'response') {
        if (typeof obj.last_assistant_message === 'string' && obj.last_assistant_message.trim()) {
          return { text: obj.last_assistant_message, text_source: 'full' };
        }
        if (typeof obj.text === 'string' && obj.text.trim()) {
          return { text: obj.text, text_source: 'full' };
        }
      }
    } catch {
      // 파싱 실패 → preview 폴백
    }
  }
  return { text: preview ?? '', text_source: 'preview' };
}

export const conversationsRouter: RouteHandler = (_req, db, url, path, method) => {
  if (path !== '/api/conversations' || method !== 'GET') return null;

  const start = url.searchParams.get('start');
  const end = url.searchParams.get('end');
  const fromParam = url.searchParams.get('from');
  const toParam = url.searchParams.get('to');
  const project = url.searchParams.get('project') || undefined;
  const fields = url.searchParams.get('fields');
  if (fields && fields !== 'summary') {
    return jsonResponse({ success: false, error: 'fields must be "summary"' }, 400);
  }

  let fromTs: number;
  let toTs: number;
  if (fromParam != null || toParam != null) {
    if (start != null || end != null) {
      return jsonResponse({ success: false, error: 'use either start/end or from/to, not both' }, 400);
    }
    if (!fromParam || !toParam || !MS_RE.test(fromParam) || !MS_RE.test(toParam)) {
      return jsonResponse({ success: false, error: 'from/to must be ms epoch integers' }, 400);
    }
    fromTs = Number(fromParam);
    toTs = Number(toParam);
  } else {
    if (!start || !end || !DATE_RE.test(start) || !DATE_RE.test(end)) {
      return jsonResponse({ success: false, error: 'start/end must be YYYY-MM-DD (or use from/to ms)' }, 400);
    }
    // 로컬 타임존 해석 — 단일 사용자 로컬 도구라 서버 TZ = 사용자 TZ 가정
    fromTs = new Date(`${start}T00:00:00.000`).getTime();
    toTs = new Date(`${end}T23:59:59.999`).getTime();
  }
  if (Number.isNaN(fromTs) || Number.isNaN(toTs) || toTs < fromTs) {
    return jsonResponse({ success: false, error: 'invalid date range' }, 400);
  }
  if (toTs - fromTs > MAX_RANGE_DAYS * 86_400_000) {
    return jsonResponse({ success: false, error: `range exceeds ${MAX_RANGE_DAYS} days` }, 400);
  }

  // limit+1 fetch 로 절단 여부 감지
  const rows = getConversationRows(db, fromTs, toTs, project, MAX_ROWS + 1);
  const truncated = rows.length > MAX_ROWS;
  const used = truncated ? rows.slice(0, MAX_ROWS) : rows;

  // 이미 session_id ASC, timestamp ASC 정렬 — 1-pass 그룹핑
  const sessions: ConversationSession[] = [];
  let cur: ConversationSession | undefined;
  for (const r of used) {
    if (!cur || cur.id !== r.session_id) {
      cur = { id: r.session_id, project: r.project_name, started_at: r.started_at, messages: [] };
      sessions.push(cur);
    }
    const { text, text_source } = extractText(r.type, r.payload, r.preview);
    cur.messages.push({
      ts: r.timestamp,
      role: r.type === 'prompt' ? 'user' : 'assistant',
      text,
      text_source,
    });
  }

  if (fields === 'summary') {
    const data = sessions.map((s) => summarizeSession(db, s, fromTs, toTs));
    return jsonResponse({ success: true, data, meta: { total: data.length, truncated } });
  }

  return jsonResponse({
    success: true,
    data: sessions,
    meta: { total: used.length, truncated },
  });
};

/** fields=summary — 원문 없이 세션 한 줄 요약. 프롬프트는 첫 줄만 잘라 담는다. */
function summarizeSession(db: Parameters<RouteHandler>[1], s: ConversationSession, fromTs: number, toTs: number) {
  const prompts = s.messages.filter((m) => m.role === 'user');
  const activity = getSessionWindowActivity(db, s.id, fromTs, toTs);
  return {
    id: s.id,
    project: s.project,
    started_at: s.started_at,
    first_at: s.messages[0]?.ts ?? null,
    last_at: s.messages[s.messages.length - 1]?.ts ?? null,
    prompt_count: prompts.length,
    response_count: s.messages.length - prompts.length,
    prompts: prompts.map((m) => ({ ts: m.ts, text: firstLine(m.text, SUMMARY_PROMPT_CHARS) })),
    tokens: activity.tokens,
    skills: activity.skills,
    agents: activity.agents,
  };
}

function firstLine(text: string, max: number): string {
  const line = text.split('\n').find((l) => l.trim() !== '')?.trim() ?? '';
  return line.length > max ? `${line.slice(0, max)}…` : line;
}
