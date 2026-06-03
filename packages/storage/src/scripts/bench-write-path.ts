#!/usr/bin/env bun
/**
 * hook 쓰기 경로(processHookEvent 동기 구간) latency 실측.
 *
 * Storage Redesign v3 재계획의 잔여 병목 주장("hook 응답 경로의 동기 SSE broadcast")을
 * 정량 검증하기 위한 벤치. read 측 bench-read-current.ts / bench-turn-breakdown.ts 와 짝.
 *
 * 측정 (전부 hook HTTP 응답을 블록하는 동기 구간):
 *   A. processHookEvent end-to-end — pre_tool INSERT (SSE 미발생)
 *   B. processHookEvent end-to-end — post(tool) Upsert + SSE broadcast 포함
 *   B2. Task 행 — anomaly enrich의 agent 경로 경유
 *   C. 단계별 분해 (B 경로): ensureSession / saveRequest / updateSessionTotalTokens
 *      / getSessionById / getRequestById / normalize+enrich / broadcastNewRequest
 *
 * 사용:
 *   bun run packages/storage/src/scripts/bench-write-path.ts --db=/tmp/spyglass-bench.db --iter=200
 *
 * ⚠️ 대상 DB에 bench-write-session 행을 INSERT 후 정리(DELETE)한다 — 운영 DB가 아닌
 *    사본(sqlite3 ".backup")을 대상으로 실행할 것. DB open 시 미적용 마이그레이션도 실행됨.
 *
 * 실측 기록 (4.9GB 운영 사본, SSE 2연결, 2026-06-04):
 *   B  post(tool) end-to-end : p50 0.12ms / p95 2.98ms / p99 4.06ms / max 13.89ms
 *   C  broadcastNewRequest   : p50 0.02ms — "동기 SSE 병목" 주장은 실측상 기각.
 *   가장 무거운 단계는 saveRequest(p95 2.31ms, 디스크 쓰기)이며 v3 목표(≤5ms)는 이미 충족.
 */

import { SpyglassDatabase } from '../connection';
import { getRequestById } from '../queries/request';
import { getSessionById } from '../queries/session';
import { processHookEvent } from '../../../server/src/hook/processor';
import { ensureSession, updateSessionTotalTokens } from '../../../server/src/hook/session';
import { saveRequest } from '../../../server/src/hook/persist';
import { normalizeRequest } from '../../../server/src/domain/request-normalizer';
import { enrichRowWithAnomalies } from '../../../server/src/domain/anomaly-enricher';
import { broadcastNewRequest, sseRouter, getConnectionCount } from '../../../server/src/sse';
import type { NormalizedHookPayload } from '../../../server/src/hook/types';

interface Opts {
  iter: number;
  dbPath: string;
}

function parseArgs(argv: string[]): Opts {
  const o: Opts = { iter: 200, dbPath: '/tmp/spyglass-bench.db' };
  for (const a of argv) {
    if (a.startsWith('--iter=')) o.iter = parseInt(a.slice(7), 10) || 200;
    else if (a.startsWith('--db=')) o.dbPath = a.slice(5);
  }
  return o;
}

const opts = parseArgs(process.argv.slice(2));
const SESSION = 'bench-write-session';

const sdb = new SpyglassDatabase({ dbPath: opts.dbPath });
const db = sdb.instance;

// SSE 연결 2개 등록 — 실사용 대시보드(1~2 연결) 수준 재현
sseRouter(new Request('http://localhost/api/events'));
sseRouter(new Request('http://localhost/api/events'));
console.log(`db=${opts.dbPath} iter=${opts.iter} sse_connections=${getConnectionCount()}`);

let seq = 0;
function mkPayload(
  eventType: 'pre_tool' | 'tool',
  toolUseSeq: number,
  toolName = 'Bash',
): NormalizedHookPayload {
  const isPre = eventType === 'pre_tool';
  return {
    id: `bench-${eventType}-${toolUseSeq}`,
    session_id: SESSION,
    project_name: 'bench-project',
    timestamp: Date.now(),
    event_type: eventType,
    request_type: 'tool_call',
    tool_name: toolName,
    tool_detail: 'bench command',
    model: 'claude-opus-4-8',
    tokens_input: isPre ? 0 : 1200,
    tokens_output: isPre ? 0 : 300,
    tokens_total: isPre ? 0 : 1500,
    duration_ms: isPre ? 0 : 850,
    payload: JSON.stringify({ tool_input: { command: 'echo bench' }, tool_response: 'x'.repeat(2000) }),
    source: 'hook',
    cache_creation_tokens: 0,
    cache_read_tokens: isPre ? 0 : 40000,
    preview: 'bench preview text — '.repeat(8),
    tokens_confidence: 'high',
    tokens_source: 'transcript',
  };
}

function pct(sorted: number[], p: number): number {
  return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * p))];
}

function report(name: string, samples: number[]): void {
  const s = [...samples].sort((a, b) => a - b);
  const mean = s.reduce((a, v) => a + v, 0) / s.length;
  console.log(
    `${name.padEnd(48)} p50=${pct(s, 0.5).toFixed(2).padStart(7)}ms  ` +
      `p95=${pct(s, 0.95).toFixed(2).padStart(7)}ms  ` +
      `p99=${pct(s, 0.99).toFixed(2).padStart(7)}ms  ` +
      `max=${s[s.length - 1].toFixed(2).padStart(7)}ms  mean=${mean.toFixed(2).padStart(7)}ms`,
  );
}

// ── A+B: end-to-end (pre_tool INSERT → tool Upsert) — 실제 훅 시퀀스 재현
const preSamples: number[] = [];
const postSamples: number[] = [];
for (let i = 0; i < opts.iter; i++) {
  const n = seq++;
  let t0 = performance.now();
  processHookEvent(db, mkPayload('pre_tool', n));
  preSamples.push(performance.now() - t0);

  const post = mkPayload('tool', n);
  t0 = performance.now();
  processHookEvent(db, post);
  postSamples.push(performance.now() - t0);
}
report('A. processHookEvent pre_tool (INSERT, no SSE)', preSamples);
report('B. processHookEvent post tool (Upsert + SSE)', postSamples);

// B2: Task(서브에이전트) 행 — enrich의 agent 경로 경유
const taskSamples: number[] = [];
for (let i = 0; i < Math.min(opts.iter, 50); i++) {
  const n = seq++;
  processHookEvent(db, mkPayload('pre_tool', n, 'Task'));
  const post = mkPayload('tool', n, 'Task');
  const t0 = performance.now();
  processHookEvent(db, post);
  taskSamples.push(performance.now() - t0);
}
report('B2. post Task행 (agent enrich 경유)', taskSamples);

// ── C: 단계별 분해 — post(tool) 경로의 각 동기 단계 (processor.ts 시퀀스 복제, 측정 전용)
const steps: Record<string, number[]> = {
  ensureSession: [],
  saveRequest: [],
  updateSessionTotalTokens: [],
  getSessionById: [],
  getRequestById: [],
  'normalize+enrich': [],
  broadcastNewRequest: [],
};
for (let i = 0; i < opts.iter; i++) {
  const n = seq++;
  processHookEvent(db, mkPayload('pre_tool', n)); // pre 먼저 (실제 시퀀스)
  const p = mkPayload('tool', n);

  let t = performance.now();
  ensureSession(db, p);
  steps.ensureSession.push(performance.now() - t);

  t = performance.now();
  const { savedId } = saveRequest(db, p);
  steps.saveRequest.push(performance.now() - t);

  t = performance.now();
  updateSessionTotalTokens(db, p);
  steps.updateSessionTotalTokens.push(performance.now() - t);

  t = performance.now();
  const session = getSessionById(db, p.session_id);
  steps.getSessionById.push(performance.now() - t);

  t = performance.now();
  const rawRow = getRequestById(db, savedId ?? p.id);
  steps.getRequestById.push(performance.now() - t);

  t = performance.now();
  const normalized = enrichRowWithAnomalies(db, normalizeRequest(rawRow!));
  steps['normalize+enrich'].push(performance.now() - t);

  t = performance.now();
  broadcastNewRequest(normalized, {
    session_total_tokens: session?.total_tokens ?? 0,
    event_phase: 'created',
  });
  steps.broadcastNewRequest.push(performance.now() - t);
}
console.log('\n--- C. post(tool) 경로 단계별 분해 ---');
for (const [name, samples] of Object.entries(steps)) report(`   ${name}`, samples);

// 정리: 벤치 행 삭제 (사본 DB 대상이지만 반복 실행 시 행 누적 방지)
db.prepare(`DELETE FROM requests WHERE session_id = ?`).run(SESSION);
db.prepare(`DELETE FROM sessions WHERE id = ?`).run(SESSION);
console.log('\ndone');
process.exit(0); // SSE ReadableStream이 이벤트 루프를 유지하므로 명시 종료
