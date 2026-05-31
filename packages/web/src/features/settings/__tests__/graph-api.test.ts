/**
 * graph-api.test.ts — Graph DB / SQLite / Proxy fetch + SSE 스트림 핸들러 검증 (P2-07)
 *
 * 원본: settings-view.js graph/sqlite/proxy 섹션 fetch 부 + onLadybugInstall SSE 파싱(:944-973).
 * 전략(tasks.json:338): apiFetch(fetch) mock 후 입력→호출 인자(URL/method/body) 검증 +
 *   성공/실패 분기. SSE 는 mock reader 로 parseSseBuffer/consumeInstallStream 직접 검증.
 */
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import {
  fetchGraphDbStatus,
  setGraphMode,
  fetchSqliteInfo,
  fetchProxySnippet,
  fetchProxyStatus,
  proxyInstall,
  proxyRestore,
  parseSseBuffer,
  consumeInstallStream,
  ladybugInstallStream,
} from '../graph-api';
import type { InstallEvent } from '../types';

// ── fetch mock 하네스(hooks-api.test.ts 와 동일) ─────────────────────────────
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
    return Promise.resolve({ json: () => Promise.resolve(body) } as Response);
  }) as typeof fetch;
});
afterEach(() => {
  globalThis.fetch = realFetch;
});

describe('fetchGraphDbStatus (settings-view.js:704)', () => {
  it('GET /api/settings/graph-db/status + data 추출', async () => {
    responder = () => ({ success: true, data: { method: 'brew', installed: true, version: '0.16.1', bunAvailable: false, brewAvailable: true, npmAvailable: true } });
    const d = await fetchGraphDbStatus();
    expect(calls[0].url).toBe('/api/settings/graph-db/status');
    expect(d.installed).toBe(true);
    expect(d.method).toBe('brew');
  });
  it('AbortSignal 전달(§5.1)', async () => {
    const ctrl = new AbortController();
    await fetchGraphDbStatus(ctrl.signal);
    expect(calls[0].init?.signal).toBe(ctrl.signal);
  });
  it('success=false → throw', async () => {
    responder = () => ({ success: false, error: 'no status' });
    await expect(fetchGraphDbStatus()).rejects.toThrow('no status');
  });
});

describe('setGraphMode (settings-view.js:1015)', () => {
  it('POST /api/settings/graph/mode + body { mode, persistent:true }', async () => {
    responder = () => ({ success: true, data: { previous: 'off', current: 'primary', persistent: true, configFile: '/cfg', source: 'file', hint: 'ok' } });
    const d = await setGraphMode('primary');
    expect(calls[0].url).toBe('/api/settings/graph/mode');
    expect(calls[0].init?.method).toBe('POST');
    expect(JSON.parse(String(calls[0].init?.body))).toEqual({ mode: 'primary', persistent: true });
    expect(d.current).toBe('primary');
  });
  it('source=env 보존(원본 :1031 env override toast 판별)', async () => {
    responder = () => ({ success: true, data: { previous: 'off', current: 'shadow', persistent: true, configFile: '/cfg', source: 'env', hint: 'env wins' } });
    const d = await setGraphMode('shadow');
    expect(d.source).toBe('env');
  });
  it('success=false → throw(원본 :1021)', async () => {
    responder = () => ({ success: false, error: 'mode change failed' });
    await expect(setGraphMode('off')).rejects.toThrow('mode change failed');
  });
});

describe('fetchSqliteInfo (settings-view.js:1072)', () => {
  it('GET /api/settings/sqlite/info + data', async () => {
    responder = () => ({ success: true, data: { dbPath: '/db', dbSizeBytes: 1024, migration: { version: 3, filename: '003.sql' }, cliVersion: null } });
    const d = await fetchSqliteInfo();
    expect(calls[0].url).toBe('/api/settings/sqlite/info');
    expect(d.migration.version).toBe(3);
  });
  it('success=false → throw(원본 :1073)', async () => {
    responder = () => ({ success: false, error: 'sqlite info failed' });
    await expect(fetchSqliteInfo()).rejects.toThrow('sqlite info failed');
  });
});

describe('fetchProxySnippet (settings-view.js:1177)', () => {
  it("shell='auto' → snippet?shell=zsh 로 정규화(원본 :1177)", async () => {
    responder = () => ({ success: true, data: { shell: 'zsh', port: 9999, snippet: 'claude(){...}' } });
    await fetchProxySnippet('auto');
    expect(calls[0].url).toBe('/api/settings/proxy/snippet?shell=zsh');
  });
  it("shell='fish' 그대로 전달", async () => {
    await fetchProxySnippet('fish');
    expect(calls[0].url).toBe('/api/settings/proxy/snippet?shell=fish');
  });
});

describe('fetchProxyStatus (settings-view.js:1178)', () => {
  it("shell='auto' 그대로 전달(snippet 과 달리 status 는 정규화 X)", async () => {
    responder = () => ({ success: true, data: { shell: 'zsh', profilePath: '/h/.zshrc', profileExisted: true, installed: false, corrupted: false, hasMarkerOpen: false, hasMarkerClose: false } });
    await fetchProxyStatus('auto');
    expect(calls[0].url).toBe('/api/settings/proxy/status?shell=auto');
  });
  it('AbortSignal 전달', async () => {
    const ctrl = new AbortController();
    await fetchProxyStatus('zsh', ctrl.signal);
    expect(calls[0].init?.signal).toBe(ctrl.signal);
  });
});

describe('proxyInstall (settings-view.js:1353)', () => {
  it('POST install + body { shell }', async () => {
    responder = () => ({ success: true, data: { installedTo: '/h/.zshrc', shell: 'zsh', backupPath: '/h/.zshrc.bak-1', action: 'appended', cleanedGraphModeExports: 0, nextAction: 'source ~/.zshrc' } });
    const d = await proxyInstall('zsh');
    expect(calls[0].url).toBe('/api/settings/proxy/install');
    expect(calls[0].init?.method).toBe('POST');
    expect(JSON.parse(String(calls[0].init?.body))).toEqual({ shell: 'zsh' });
    expect(d.action).toBe('appended');
  });
  it('success=false → throw(원본 :1359)', async () => {
    responder = () => ({ success: false, error: 'install failed' });
    await expect(proxyInstall('auto')).rejects.toThrow('install failed');
  });
});

describe('proxyRestore (settings-view.js:1425)', () => {
  it('POST restore + body { backupPath, shell }', async () => {
    responder = () => ({ success: true, data: { targetPath: '/h/.zshrc', mode: 'restore-backup', restoredFrom: '/h/.zshrc.bak-1', preRestoreBackup: '/h/.zshrc.bak-2', removedBlock: false } });
    const d = await proxyRestore('/h/.zshrc.bak-1', 'zsh');
    expect(calls[0].url).toBe('/api/settings/proxy/restore');
    expect(JSON.parse(String(calls[0].init?.body))).toEqual({ backupPath: '/h/.zshrc.bak-1', shell: 'zsh' });
    expect(d.restoredFrom).toBe('/h/.zshrc.bak-1');
  });
  it('success=false → throw(원본 :1431)', async () => {
    responder = () => ({ success: false, error: 'restore failed' });
    await expect(proxyRestore('/bak', 'auto')).rejects.toThrow('restore failed');
  });
});

// ── SSE 파싱(원본 onLadybugInstall :944-973) ─────────────────────────────────
describe('parseSseBuffer (settings-view.js:953-962)', () => {
  it('단일 data: 메시지 → 이벤트 1개 + 빈 잔여', () => {
    const buf = 'data: {"type":"start","cmd":["brew","install","ladybug"]}\n\n';
    const { events, rest } = parseSseBuffer(buf);
    expect(events).toHaveLength(1);
    expect((events[0] as { type: string }).type).toBe('start');
    expect(rest).toBe('');
  });

  it('부분 메시지는 잔여로 보존(다음 chunk 와 합침)', () => {
    const buf = 'data: {"type":"stdout","line":"a"}\n\ndata: {"type":"stdout"';
    const { events, rest } = parseSseBuffer(buf);
    expect(events).toHaveLength(1);
    expect(rest).toBe('data: {"type":"stdout"');
  });

  it("`: ping` heartbeat 라인은 무시(원본 :956)", () => {
    const buf = ': ping\n\ndata: {"type":"stderr","line":"warn"}\n\n';
    const { events } = parseSseBuffer(buf);
    expect(events).toHaveLength(1);
    expect((events[0] as { type: string }).type).toBe('stderr');
  });

  it('손상 JSON 메시지는 스킵(원본 :962)', () => {
    const buf = 'data: {bad json\n\ndata: {"type":"done","result":{"status":"installed","method":"brew","version":"1","log":"","restartRequired":true}}\n\n';
    const { events } = parseSseBuffer(buf);
    expect(events).toHaveLength(1);
    expect((events[0] as { type: string }).type).toBe('done');
  });

  it('multi-line data: 는 \\n 으로 join(원본 :960)', () => {
    const buf = 'data: {"type":"stdout",\ndata: "line":"x"}\n\n';
    const { events } = parseSseBuffer(buf);
    expect(events).toHaveLength(1);
    expect((events[0] as { type: string; line: string }).line).toBe('x');
  });
});

/** mock reader — chunk 배열을 UTF-8 인코딩해 순차 read() 로 흘려보냄. */
function mockReader(chunks: string[]): ReadableStreamDefaultReader<Uint8Array> {
  const enc = new TextEncoder();
  let i = 0;
  return {
    read: () =>
      Promise.resolve(
        i < chunks.length
          ? { value: enc.encode(chunks[i++]), done: false }
          : { value: undefined, done: true },
      ),
    releaseLock: () => {},
    cancel: () => Promise.resolve(),
    closed: Promise.resolve(undefined),
  } as unknown as ReadableStreamDefaultReader<Uint8Array>;
}

describe('consumeInstallStream (settings-view.js:944-973)', () => {
  it('chunk 경계를 넘어 분할된 메시지를 재조립', async () => {
    const events: InstallEvent[] = [];
    // 메시지가 chunk 중간에서 잘림 — 재조립되어야 함.
    await consumeInstallStream(
      mockReader(['data: {"type":"start","cmd":["x"]}\n', '\ndata: {"type":"stdout","li', 'ne":"hi"}\n\n']),
      (e) => events.push(e),
    );
    expect(events.map((e) => e.type)).toEqual(['start', 'stdout']);
    expect((events[1] as { line: string }).line).toBe('hi');
  });

  it('done 이벤트도 통지', async () => {
    const events: InstallEvent[] = [];
    await consumeInstallStream(
      mockReader(['data: {"type":"done","result":{"status":"installed","method":"npm","version":null,"log":"","restartRequired":true}}\n\n']),
      (e) => events.push(e),
    );
    expect(events[0].type).toBe('done');
  });
});

describe('ladybugInstallStream (settings-view.js:904)', () => {
  it('POST install(SSE) + done.result 반환 + 이벤트 통지', async () => {
    const enc = new TextEncoder();
    const chunks = [
      'data: {"type":"start","cmd":["brew","install"]}\n\n',
      'data: {"type":"stdout","line":"downloading"}\n\n',
      'data: {"type":"done","result":{"status":"installed","method":"brew","version":"0.16.1","log":"","restartRequired":true}}\n\n',
    ];
    let i = 0;
    globalThis.fetch = ((url: string, init?: RequestInit) => {
      calls.push({ url, init });
      return Promise.resolve({
        ok: true,
        body: {
          getReader: () => ({
            read: () =>
              Promise.resolve(
                i < chunks.length ? { value: enc.encode(chunks[i++]), done: false } : { value: undefined, done: true },
              ),
          }),
        },
      } as unknown as Response);
    }) as typeof fetch;

    const events: InstallEvent[] = [];
    const result = await ladybugInstallStream('auto', (e) => events.push(e));
    expect(calls[0].url).toBe('/api/settings/graph-db/install');
    expect(calls[0].init?.method).toBe('POST');
    expect(JSON.parse(String(calls[0].init?.body))).toEqual({ strategy: 'auto' });
    expect(events.map((e) => e.type)).toEqual(['start', 'stdout', 'done']);
    expect(result?.status).toBe('installed');
    expect(result?.version).toBe('0.16.1');
  });

  it('res.ok=false → throw(원본 :940-942)', async () => {
    globalThis.fetch = (() => Promise.resolve({ ok: false, status: 500, body: null } as Response)) as unknown as typeof fetch;
    await expect(ladybugInstallStream('auto', () => {})).rejects.toThrow('HTTP 500');
  });
});
