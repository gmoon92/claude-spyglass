/**
 * getSubagentUsage + Migration 071 — 서브에이전트 모델 판정은 proxy 실측을 우선한다.
 *
 * 고정하는 것:
 *  - requests.model 이 부모 모델(fable)로 잘못 들어가 있어도 proxy 모델(opus)로 집계 → over_cap 거짓 양성 없음
 *  - 한 응답에 도구 행이 여럿이어도 api_request_id 중복 없이 토큰을 더한다
 *  - proxy 와 이어지지 않으면 훅 기록 모델로 판정(model_source='requests')
 *  - max_tier 초과면 over_cap=true, 미지정이면 null
 *  - Migration 071 이 서브에이전트 행의 잘못된 model 을 proxy 값으로 보정하고 메인 행은 건드리지 않는다
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { runMigrations } from '../migrator';
import { getSubagentUsage, modelTier } from '../queries/stats/subagent-usage';

const SUB_SYS = 'x-anthropic-billing-header: cc_version=2.1.330; cc_entrypoint=cli; cc_is_subagent=true; You are...';
const MAIN_SYS = 'x-anthropic-billing-header: cc_version=2.1.330; cc_entrypoint=cli; You are Claude Code';

let db: Database;
beforeEach(() => {
  db = new Database(':memory:');
  runMigrations(db);
  db.run("INSERT INTO sessions (id, project_name, started_at) VALUES ('s1', 'claude-hub', 1000)");
});
afterEach(() => db.close());

function req(id: string, o: { agent?: string | null; type?: string | null; model?: string | null; api?: string | null; ts?: number }) {
  db.run(
    `INSERT INTO requests (id, session_id, timestamp, type, model, agent_id, agent_type, api_request_id)
     VALUES (?, 's1', ?, 'tool_call', ?, ?, ?, ?)`,
    [id, o.ts ?? 2000, o.model ?? null, o.agent ?? null, o.type ?? null, o.api ?? null],
  );
}
function proxy(api: string, model: string, sys: string, tokens = 100) {
  db.run(
    `INSERT INTO proxy_requests (id, timestamp, method, path, model, tokens_input, tokens_output,
       cache_creation_tokens, cache_read_tokens, api_request_id, session_id, system_preview)
     VALUES (?, 2000, 'POST', '/v1/messages', ?, ?, 10, 0, 0, ?, 's1', ?)`,
    [`p-${api}`, model, tokens, api, sys],
  );
}

describe('getSubagentUsage', () => {
  test('requests.model 이 부모 모델이어도 proxy 모델로 집계해 over_cap 거짓 양성이 없다', () => {
    req('r1', { agent: 'a1', type: 'general-purpose', model: 'claude-fable-5-2', api: 'm1' });
    proxy('m1', 'claude-opus-5-5', SUB_SYS);

    const rows = getSubagentUsage(db, { maxTier: 'opus' });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ agent_type: 'general-purpose', model: 'claude-opus-5-5', model_source: 'proxy', runs: 1, over_cap: false });
  });

  test('같은 api_request_id 의 도구 행이 여럿이어도 토큰은 한 번만 더한다', () => {
    req('r1', { agent: 'a1', type: 'Explore', api: 'm1' });
    req('r2', { agent: 'a1', type: 'Explore', api: 'm1' });
    req('r3', { agent: 'a1', type: 'Explore', api: 'm2' });
    proxy('m1', 'claude-haiku-5-5', SUB_SYS, 100);
    proxy('m2', 'claude-haiku-5-5', SUB_SYS, 200);

    const [row] = getSubagentUsage(db);
    expect(row).toMatchObject({ runs: 1, api_requests: 2, tokens_input: 300, tokens_output: 20, over_cap: null });
  });

  test('proxy 가 없으면 훅 기록 모델로 판정하고 상한 초과를 표시한다', () => {
    req('r1', { agent: 'a1', type: 'Plan', model: 'claude-fable-5-2' });
    const [row] = getSubagentUsage(db, { maxTier: 'opus' });
    expect(row).toMatchObject({ model: 'claude-fable-5-2', model_source: 'requests', over_cap: true, tokens_total: 0 });
  });

  test('메인 세션 행(agent_id NULL)은 집계하지 않고, 기간·프로젝트로 거른다', () => {
    req('main', { model: 'claude-fable-5-2' });
    req('r1', { agent: 'a1', type: 'Explore', model: 'claude-haiku-5-5', ts: 5000 });
    expect(getSubagentUsage(db)).toHaveLength(1);
    expect(getSubagentUsage(db, { from: 6000 })).toHaveLength(0);
    expect(getSubagentUsage(db, { project: 'other' })).toHaveLength(0);
    expect(getSubagentUsage(db, { project: 'claude-hub' })).toHaveLength(1);
  });

  test('modelTier 는 모델 ID 에서 등급을 뽑는다', () => {
    expect(modelTier('claude-fable-5-2')).toBe('fable');
    expect(modelTier('claude-opus-5-5')).toBe('opus');
    expect(modelTier('kimi-k2')).toBeNull();
  });
});

describe('Migration 071 — 서브에이전트 행 model 보정', () => {
  const SQL = readFileSync(join(import.meta.dir, '../../migrations/071-subagent-model-repair.sql'), 'utf8');

  test('서브에이전트 행만 proxy 모델로 고치고 메인 행·이미 맞는 행은 그대로 둔다', () => {
    req('sub-bad', { agent: 'a1', type: 'general-purpose', model: 'claude-fable-5-2', api: 'm1' });
    req('sub-ok', { agent: 'a2', type: 'Explore', model: 'claude-haiku-5-5', api: 'm2' });
    req('main', { model: 'claude-fable-5-2', api: 'm1' });
    req('sub-mainproxy', { agent: 'a3', type: 'Plan', model: 'claude-fable-5-2', api: 'm3' });
    proxy('m1', 'claude-opus-5-5', SUB_SYS);
    proxy('m2', 'claude-haiku-5-5', SUB_SYS);
    proxy('m3', 'claude-opus-5-5', MAIN_SYS); // 서브에이전트 요청이 아니면 근거로 쓰지 않는다

    db.run(SQL);
    db.run(SQL); // 멱등
    const m = (id: string) => (db.query('SELECT model FROM requests WHERE id = ?').get(id) as { model: string }).model;
    expect(m('sub-bad')).toBe('claude-opus-5-5');
    expect(m('sub-ok')).toBe('claude-haiku-5-5');
    expect(m('main')).toBe('claude-fable-5-2');
    expect(m('sub-mainproxy')).toBe('claude-fable-5-2');
  });
});
