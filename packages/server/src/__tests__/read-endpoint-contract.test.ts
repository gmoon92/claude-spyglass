/**
 * Read Endpoint Contract — Zero-Regression 게이트
 * (structured-coalescing-feather Plan §2.5)
 *
 * 책임:
 *  - 흐름 차트 PR 이 다른 read 엔드포인트의 응답 shape / 필드 set 을 망가뜨리지 못하게 막는다.
 *  - 각 엔드포인트에 대해 status / success / top-level shape / 핵심 필드 존재만 검증한다.
 *  - 정확한 값·통계는 도메인별 테스트의 책임 — 여기서는 "응답이 살아있나" 만 본다.
 *
 * 새 read 엔드포인트가 추가되면 CONTRACTS 에 한 줄 추가하면 충분하다.
 */

import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import {
  SpyglassDatabase,
  createSession,
  createRequest,
  upsertMetaDocument,
} from '@spyglass/storage';
import { apiRouter } from '../api';

const SUFFIX = `${Date.now()}-${process.pid}-${crypto.randomUUID().slice(0, 8)}`;
const TEST_DB_PATH = `/tmp/spyglass-contract-${SUFFIX}.db`;

let db: SpyglassDatabase;
const SEED_NOW = Date.now() - 60_000;
const SEED_PROJECT = 'contract-fixture';
const SEED_SESSION_ID = crypto.randomUUID();

beforeAll(() => {
  db = new SpyglassDatabase({ dbPath: TEST_DB_PATH, autoInit: true });

  createSession(db.instance, {
    id: SEED_SESSION_ID,
    project_name: SEED_PROJECT,
    started_at: SEED_NOW - 30_000,
  });

  upsertMetaDocument(db.instance, {
    type: 'skill',
    name: 'reviewer',
    source: 'userSettings',
    source_root: '/home/user/.claude',
    file_path: '/home/user/.claude/skills/reviewer.md',
    description: 'reviewer skill',
    user_invocable: true,
    frontmatter_json: null,
    seen_at: SEED_NOW,
  });

  // 최소한의 흐름 데이터 — center=reviewer 직접 호출 1건.
  createRequest(db.instance, {
    id: 'r-reviewer',
    session_id: SEED_SESSION_ID,
    timestamp: SEED_NOW,
    type: 'tool_call',
    tool_name: 'Skill',
    tool_detail: 'reviewer',
    turn_id: 'T1',
    tool_use_id: 'tu-reviewer',
    event_type: 'tool',
    tokens_input: 10, tokens_output: 5, tokens_total: 15,
  });

  // 일반 prompt 행 — /api/requests, /api/dashboard 에 노출.
  createRequest(db.instance, {
    id: 'r-prompt',
    session_id: SEED_SESSION_ID,
    timestamp: SEED_NOW + 1000,
    type: 'prompt',
    turn_id: 'T1',
    tokens_input: 100, tokens_output: 200, tokens_total: 300,
    duration_ms: 1500,
  });
});

afterAll(() => {
  try { db.close(); } catch {}
  try { require('fs').unlinkSync(TEST_DB_PATH); } catch {}
});

interface Contract {
  path: string;
  /** top-level data 의 형태. */
  shape: 'array' | 'object';
  /**
   *  - shape='array': 첫 행이 있을 때 가져야 하는 키 집합.
   *  - shape='object': data 가 직접 가져야 하는 키 집합.
   */
  required: string[];
  /** array shape 인 경우 최소 행 수. 미지정 시 0 이상 허용. */
  minRows?: number;
}

const CONTRACTS: Contract[] = [
  {
    path: `/api/requests?limit=200&fromTs=${SEED_NOW - 86400_000}&toTs=${SEED_NOW + 86400_000}`,
    shape: 'array',
    required: ['id', 'session_id', 'timestamp', 'tool_name', 'turn_id'],
    minRows: 1,
  },
  {
    path: '/api/sessions',
    shape: 'array',
    required: ['id', 'project_name', 'started_at'],
    minRows: 1,
  },
  {
    path: '/api/sessions/active',
    shape: 'array',
    required: ['id', 'project_name'],
  },
  {
    path: `/api/dashboard?fromTs=${SEED_NOW - 86400_000}&toTs=${SEED_NOW + 86400_000}`,
    shape: 'object',
    required: ['summary', 'sessions', 'requests', 'projects', 'tools', 'types', 'active'],
  },
  // migration-plan §B: /api/meta-docs/flow 는 폐기, /api/graph/unified-flow 가 대체.
  // 응답 셰이프가 변경되었으므로 본 contract 도 갱신.
  {
    path: `/api/graph/unified-flow?center_kind=skill&center_name=reviewer`,
    shape: 'object',
    required: ['nodes', 'edges', 'columns', 'meta'],
  },
];

describe('Read Endpoint Contract — Zero-Regression 게이트', () => {
  for (const c of CONTRACTS) {
    it(`${c.path} — shape & 핵심 필드 유지`, async () => {
      const res = await apiRouter(new Request(`http://x${c.path}`), db.instance);
      expect(res.status).toBe(200);

      const body = await res.json() as { success: boolean; data: unknown };
      expect(body.success).toBe(true);
      expect(body.data).toBeDefined();

      if (c.shape === 'array') {
        expect(Array.isArray(body.data)).toBe(true);
        const arr = body.data as Array<Record<string, unknown>>;
        if (c.minRows !== undefined) {
          expect(arr.length).toBeGreaterThanOrEqual(c.minRows);
        }
        if (arr.length > 0) {
          const keys = new Set(Object.keys(arr[0]));
          for (const f of c.required) {
            expect(keys.has(f)).toBe(true);
          }
        }
      } else {
        expect(typeof body.data).toBe('object');
        expect(body.data).not.toBeNull();
        const keys = new Set(Object.keys(body.data as Record<string, unknown>));
        for (const f of c.required) {
          expect(keys.has(f)).toBe(true);
        }
      }
    });
  }
});

// ──────────────────────────────────────────────────────────────────────────
// R-S — ACTIVE_REQUEST_FILTER_SQL SSoT 변경 detector
//   (event_type IS NULL OR event_type != 'pre_tool' OR tool_name = 'Agent')
//   상수 변경 시 5개 read 도메인 (requests, sessions, dashboard 등) 응답 누수가 즉시 빨강.
//
// 검증 시나리오:
//   - pre_tool + 일반 도구 (Bash) → /api/requests 에 안 보여야 함.
//   - pre_tool + Agent 도구 → /api/requests 에 보여야 함 (Agent 예외 정책).
//   - tool/post_tool → 항상 노출.
// ──────────────────────────────────────────────────────────────────────────
describe('ACTIVE_REQUEST_FILTER_SQL — pre_tool 누수 감지', () => {
  const SSOT_SUFFIX = `${Date.now()}-${process.pid}-${crypto.randomUUID().slice(0, 8)}-ssot`;
  const SSOT_DB_PATH = `/tmp/spyglass-ssot-${SSOT_SUFFIX}.db`;
  let ssotDb: SpyglassDatabase;
  const ssotSession = crypto.randomUUID();
  const ssotProject = 'ssot-fixture';
  const ssotNow = Date.now() - 60_000;

  beforeAll(() => {
    ssotDb = new SpyglassDatabase({ dbPath: SSOT_DB_PATH, autoInit: true });
    createSession(ssotDb.instance, {
      id: ssotSession, project_name: ssotProject, started_at: ssotNow - 30_000,
    });

    // 케이스 1: 일반 도구 (Bash) pre_tool — 필터 정책상 제외.
    createRequest(ssotDb.instance, {
      id: 'ssot-bash-pre',
      session_id: ssotSession, timestamp: ssotNow,
      type: 'tool_call', tool_name: 'Bash', tool_detail: 'ls',
      turn_id: 'T1', tool_use_id: 'ssot-tu-bash',
      event_type: 'pre_tool',
    });
    // 케이스 2: Agent 도구 pre_tool — Agent 예외 정책상 포함.
    createRequest(ssotDb.instance, {
      id: 'ssot-agent-pre',
      session_id: ssotSession, timestamp: ssotNow + 1000,
      type: 'tool_call', tool_name: 'Agent', tool_detail: 'reviewer',
      turn_id: 'T1', tool_use_id: 'ssot-tu-agent',
      event_type: 'pre_tool',
    });
    // 케이스 3: 정상 머지된 'tool' 행 — 항상 노출.
    createRequest(ssotDb.instance, {
      id: 'ssot-bash-tool',
      session_id: ssotSession, timestamp: ssotNow + 2000,
      type: 'tool_call', tool_name: 'Bash', tool_detail: 'pwd',
      turn_id: 'T1', tool_use_id: 'ssot-tu-bash2',
      event_type: 'tool',
    });
  });

  afterAll(() => {
    try { ssotDb.close(); } catch {}
    try { require('fs').unlinkSync(SSOT_DB_PATH); } catch {}
  });

  it('/api/requests — Bash pre_tool 미노출, Agent pre_tool + tool 행은 노출', async () => {
    const path = `/api/requests?limit=200&fromTs=${ssotNow - 86400_000}&toTs=${ssotNow + 86400_000}`;
    const res = await apiRouter(new Request(`http://x${path}`), ssotDb.instance);
    const body = await res.json() as { success: boolean; data: Array<{ id: string }> };
    const ids = new Set(body.data.map(r => r.id));

    // Bash pre_tool — 누수 안 됨.
    expect(ids.has('ssot-bash-pre')).toBe(false);
    // Agent pre_tool — 예외 정책상 노출.
    expect(ids.has('ssot-agent-pre')).toBe(true);
    // tool 행 — 항상 노출.
    expect(ids.has('ssot-bash-tool')).toBe(true);
  });

  it(`/api/sessions/${ssotSession}/requests — 동일 정책 적용`, async () => {
    const path = `/api/sessions/${ssotSession}/requests`;
    const res = await apiRouter(new Request(`http://x${path}`), ssotDb.instance);
    const body = await res.json() as { success: boolean; data: Array<{ id: string }> };
    const ids = new Set(body.data.map(r => r.id));

    expect(ids.has('ssot-bash-pre')).toBe(false);
    expect(ids.has('ssot-agent-pre')).toBe(true);
    expect(ids.has('ssot-bash-tool')).toBe(true);
  });

  it('/api/dashboard — 활성 행만 통계에 카운트 (pre_tool Bash 제외)', async () => {
    const path = `/api/dashboard?fromTs=${ssotNow - 86400_000}&toTs=${ssotNow + 86400_000}`;
    const res = await apiRouter(new Request(`http://x${path}`), ssotDb.instance);
    const body = await res.json() as {
      success: boolean;
      data: { summary: { totalRequests: number } };
    };
    // 시드는 총 3행 (bash-pre / agent-pre / bash-tool). 필터링 적용 시:
    //   - bash-pre: 제외 (pre_tool + 비 Agent)
    //   - agent-pre: 포함 (Agent 예외)
    //   - bash-tool: 포함
    // → totalRequests >= 2 (다른 시드 데이터 없음).
    expect(body.data.summary.totalRequests).toBe(2);
  });
});
