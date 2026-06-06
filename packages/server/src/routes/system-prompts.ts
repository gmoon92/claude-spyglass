/**
 * /api/system-prompts/* 라우트 — System Prompt dedup 카탈로그.
 *
 * @description
 *   srp-redesign Phase 2: api.ts(406줄) 분해 결과.
 *   변경 이유: "system_prompts 카탈로그 노출 정책 변경 (정렬·페이지네이션·body lazy-fetch)".
 *
 *   포함 라우트 (3개):
 *   - GET /api/system-prompts            — dedup 카탈로그 목록 (라이브러리 패널, ADR-004 옵션 B)
 *   - GET /api/system-prompts/:hash      — 본문 lazy-fetch + usage 집계 (LLM Input 탭 클릭 시)
 *   - GET /api/system-prompts/:hash/refs — 재사용 현황(캐시 효율 집계 + 최근 샘플)
 */

import {
  getSystemPromptByHash,
  listSystemPrompts,
  getProxyRequestsBySystemHash,
  getSystemPromptUsageStats,
  type SystemPromptOrderBy,
} from '@spyglass/storage';
import { jsonResponse, type RouteHandler } from './_shared';

// ref 드릴다운에서 보여줄 최근 참조 샘플 개수. raw 100건 목록은 인사이트가 아니므로
// 집계(usage)를 본문으로 두고, 샘플은 "최근 어디서 쓰였나" 확인용으로만 소량 동봉.
const REFS_SAMPLE_LIMIT = 20;

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

  // GET /api/system-prompts/:hash/refs — 이 시스템 프롬프트(hash) 재사용 현황.
  // ref-drilldown pass: System 칩 클릭 시 호출. raw 목록 대신 **집계(usage) 중심**으로 재구성:
  //   - usage: 캐시 효율/누적 입력토큰/distinct 세션·모델/사용 기간 (비용 인사이트 SSoT)
  //   - samples: 최근 N건만 (어느 세션에서 쓰였나 확인용, raw 100건은 노이즈라 폐기)
  if (path.match(/^\/api\/system-prompts\/[^\/]+\/refs$/) && method === 'GET') {
    const hash = path.split('/')[3];
    if (!/^[0-9a-f]{64}$/.test(hash)) {
      return jsonResponse({ success: false, error: 'Invalid hash format (expected 64-char hex)' }, 400);
    }
    const usage = getSystemPromptUsageStats(db, hash);
    const samples = getProxyRequestsBySystemHash(db, hash, REFS_SAMPLE_LIMIT);
    return jsonResponse({ success: true, data: { usage, samples }, meta: { total: usage.reqs } });
  }

  // GET /api/system-prompts/:hash — 본문 lazy-fetch (LLM Input 탭에서 클릭 시).
  // 칩이 캐시 효율 신호를 클릭 전에도 표시할 수 있도록 usage 집계를 본문과 함께 동봉.
  if (path.match(/^\/api\/system-prompts\/[^\/]+$/) && method === 'GET') {
    const hash = path.split('/')[3];
    // hash 형식 검증 — SHA-256 hex 64자
    if (!/^[0-9a-f]{64}$/.test(hash)) {
      return jsonResponse({ success: false, error: 'Invalid hash format (expected 64-char hex)' }, 400);
    }
    const row = getSystemPromptByHash(db, hash);
    if (!row) return jsonResponse({ success: false, error: 'system prompt not found' }, 404);
    const usage = getSystemPromptUsageStats(db, hash);
    return jsonResponse({ success: true, data: { ...row, usage } });
  }

  return null;
};
