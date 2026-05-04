/**
 * /api/system-prompts/* 라우트 — System Prompt dedup 카탈로그.
 *
 * @description
 *   srp-redesign Phase 2: api.ts(406줄) 분해 결과.
 *   변경 이유: "system_prompts 카탈로그 노출 정책 변경 (정렬·페이지네이션·body lazy-fetch)".
 *
 *   포함 라우트 (2개):
 *   - GET /api/system-prompts          — dedup 카탈로그 목록 (라이브러리 패널, ADR-004 옵션 B)
 *   - GET /api/system-prompts/:hash    — 본문 lazy-fetch (LLM Input 탭 클릭 시)
 */

import {
  getSystemPromptByHash,
  listSystemPrompts,
  type SystemPromptOrderBy,
} from '@spyglass/storage';
import { jsonResponse, type RouteHandler } from './_shared';

export const systemPromptsRouter: RouteHandler = (_req, db, url, path, method) => {
  // GET /api/system-prompts — dedup 카탈로그 목록 (라이브러리 패널 — ADR-004 옵션 B)
  // 정렬: orderBy ∈ {last_seen_at|ref_count|byte_size|first_seen_at}, 기본 last_seen_at DESC
  // 본문(content) 미포함 — 라이브러리 표는 메타만, 본문은 lazy-fetch (/api/system-prompts/:hash)
  if (path === '/api/system-prompts' && method === 'GET') {
    const limit = Math.min(parseInt(url.searchParams.get('limit') || '100', 10), 500);
    const allowedOrder: SystemPromptOrderBy[] = ['last_seen_at', 'ref_count', 'byte_size', 'first_seen_at'];
    const requested = url.searchParams.get('orderBy') as SystemPromptOrderBy | null;
    const orderBy = (requested && allowedOrder.includes(requested)) ? requested : 'last_seen_at';
    const data = listSystemPrompts(db, { limit, orderBy });
    return jsonResponse({ success: true, data, meta: { total: data.length, limit } });
  }

  // GET /api/system-prompts/:hash — 본문 lazy-fetch (LLM Input 탭에서 클릭 시)
  if (path.match(/^\/api\/system-prompts\/[^\/]+$/) && method === 'GET') {
    const hash = path.split('/')[3];
    // hash 형식 검증 — SHA-256 hex 64자
    if (!/^[0-9a-f]{64}$/.test(hash)) {
      return jsonResponse({ success: false, error: 'Invalid hash format (expected 64-char hex)' }, 400);
    }
    const row = getSystemPromptByHash(db, hash);
    if (!row) return jsonResponse({ success: false, error: 'system prompt not found' }, 404);
    return jsonResponse({ success: true, data: row });
  }

  return null;
};
