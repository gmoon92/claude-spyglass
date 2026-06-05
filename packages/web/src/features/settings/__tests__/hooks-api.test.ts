/**
 * hooks-api.test.ts — Hook preview/apply/restore + diag fetch 핸들러 검증 (P2-06)
 *
 * 원본: settings-view.js onHookPreview(:517)/onHookApply(:531)/bindUndoButton(:617) fetch 부 +
 *   renderDiagSection diag fetch(:181) + in-flight 가드(§5.1).
 * 전략(tasks.json:323): apiFetch(fetch) mock 후 입력→호출 인자(URL/method/body) 검증 +
 *   성공/실패/abort 분기. DOM 없이 순수 async 함수로 테스트.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { fetchDiag, hookPreview, hookApply, hookRestore } from '../hooks-api';

// ── fetch mock 하네스 ─────────────────────────────────────────────────────────
type MockCall = { url: string; init?: RequestInit };
let calls: MockCall[] = [];
let responder: (url: string, init?: RequestInit) => unknown;

const realFetch = globalThis.fetch;
beforeEach(() => {
  calls = [];
  responder = () => ({ success: true, data: {} });
  globalThis.fetch = ((url: string, init?: RequestInit) => {
    calls.push({ url, init });
    const body = responder(url, init);
    return Promise.resolve({
      json: () => Promise.resolve(body),
    } as Response);
  }) as typeof fetch;
});
afterEach(() => {
  globalThis.fetch = realFetch;
});

describe('fetchDiag (settings-view.js:181)', () => {
  it('GET /api/settings/diag 호출 + data 추출', async () => {
    responder = () => ({ success: true, data: { server: { port: 9999 } } });
    const data = await fetchDiag();
    expect(calls[0].url).toBe('/api/settings/diag');
    expect((data as { server: { port: number } }).server.port).toBe(9999);
  });

  it('success=false → error throw(원본 :183)', async () => {
    responder = () => ({ success: false, error: 'boom' });
    await expect(fetchDiag()).rejects.toThrow('boom');
  });

  it('AbortSignal 전달 — sub-tab 전환/언마운트 cleanup(§5.1)', async () => {
    const ctrl = new AbortController();
    await fetchDiag(ctrl.signal);
    expect(calls[0].init?.signal).toBe(ctrl.signal);
  });
});

describe('hookPreview (settings-view.js:522)', () => {
  it('GET preview?profile= + diff 반환', async () => {
    responder = () => ({ success: true, data: { diff: { applied: ['Stop'], modified: [], preserved: [], spyglassDir: '', spyglassDirAfter: '/x' } } });
    const data = await hookPreview('full');
    expect(calls[0].url).toBe('/api/settings/hooks/preview?profile=full');
    expect(data.diff.applied).toEqual(['Stop']);
  });
  it('profile URL 인코딩', async () => {
    await hookPreview('full');
    expect(calls[0].url).toContain('profile=full');
  });
  it('success=false → throw', async () => {
    responder = () => ({ success: false, error: 'preview failed' });
    await expect(hookPreview('full')).rejects.toThrow('preview failed');
  });
});

describe('hookApply (settings-view.js:536)', () => {
  it('POST apply + JSON body { profile }', async () => {
    responder = () => ({ success: true, data: { diff: { applied: [], modified: [], preserved: [], spyglassDir: '', spyglassDirAfter: '' }, backupPath: '/bak' } });
    const data = await hookApply('full');
    expect(calls[0].url).toBe('/api/settings/hooks/apply');
    expect(calls[0].init?.method).toBe('POST');
    expect(JSON.parse(String(calls[0].init?.body))).toEqual({ profile: 'full' });
    expect(data.backupPath).toBe('/bak');
  });
  it('nextAction=restart-claude-code 보존(§4.4 재시작 배너)', async () => {
    responder = () => ({ success: true, data: { diff: { applied: [], modified: [], preserved: [], spyglassDir: '', spyglassDirAfter: '' }, backupPath: '/bak', nextAction: 'restart-claude-code' } });
    const data = await hookApply('full');
    expect(data.nextAction).toBe('restart-claude-code');
  });
  it('success=false → throw', async () => {
    responder = () => ({ success: false, error: 'apply failed' });
    await expect(hookApply('full')).rejects.toThrow('apply failed');
  });
});

describe('hookRestore (settings-view.js:621)', () => {
  it('POST restore + JSON body { backupPath }', async () => {
    responder = () => ({ success: true, data: { restoredFrom: '/bak', preRestoreBackup: '/pre' } });
    const data = await hookRestore('/bak');
    expect(calls[0].url).toBe('/api/settings/hooks/restore');
    expect(calls[0].init?.method).toBe('POST');
    expect(JSON.parse(String(calls[0].init?.body))).toEqual({ backupPath: '/bak' });
    expect(data.restoredFrom).toBe('/bak');
  });
  it('success=false → throw', async () => {
    responder = () => ({ success: false, error: 'restore failed' });
    await expect(hookRestore('/bak')).rejects.toThrow('restore failed');
  });
});
