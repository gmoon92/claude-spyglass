/**
 * features/settings/graph-api.ts — Graph DB / SQLite / Proxy fetch 핸들러 (P2-07)
 *
 * 원본: settings-view.js 의 graph/sqlite/proxy 섹션 *네트워크 부* 만 추출(hooks-api.ts 와 동일 정책).
 *   - graph : graph-db/status fetch + Ladybug 자동 설치 SSE(:904-1003). 모드 전환(graph/mode)은
 *             제거됨 — 그래프는 항상 켜진 상태로 고정(v4.3.x).
 *   - sqlite: sqlite/info fetch(:1072)
 *   - proxy : renderProxySection snippet+status 병렬(:1176) / onProxyInstall(:1353) /
 *             onProxyRestore(:1425)
 *
 * 계약(원본 1:1):
 *   - 응답 envelope `{ success, data?, error? }`. success=false → Error throw.
 *   - GET 류는 AbortSignal 수용 — sub-tab 전환/언마운트 cleanup(§5.1, hooks-api 동일).
 *   - Ladybug 설치만 POST 응답 스트림(SSE) — P4-04 useSSE(EventSource)와 다른 메커니즘(§5.3).
 *     consumeInstallStream 으로 reader 루프를 분리해 mock reader 로 단위 테스트 가능.
 */

import type {
  InstallEvent,
  InstallResult,
  LadybugStatus,
  ProxyInstallResult,
  ProxyRestoreResult,
  ProxySnippet,
  ProxyShell,
  ProxyStatus,
  SqliteInfo,
} from './types';
import { snippetShell } from './logic';

/** 응답 envelope 공통 형태(hooks-api.ts Envelope 와 동일 — SSoT 의도상 재선언 최소화). */
interface Envelope<T> {
  success: boolean;
  data?: T;
  error?: string;
}

/** envelope 검사 후 data 추출 — success=false 면 throw(원본 :708,1073,1180). */
async function unwrap<T>(res: Response, fallbackMsg: string): Promise<T> {
  const json = (await res.json()) as Envelope<T>;
  if (!json.success) throw new Error(json.error || fallbackMsg);
  return json.data as T;
}

// ── Graph DB ───────────────────────────────────────────────────────────────

/** GET /api/settings/graph-db/status — Ladybug 설치 상태(원본 :704). */
export async function fetchGraphDbStatus(signal?: AbortSignal): Promise<LadybugStatus> {
  const res = await fetch('/api/settings/graph-db/status', signal ? { signal } : undefined);
  return unwrap<LadybugStatus>(res, 'graph-db status failed');
}

// ── Ladybug 설치 SSE (POST 응답 스트림, §5.3) ─────────────────────────────────

/**
 * SSE 메시지 버퍼 파서 — `\n\n` 구분 메시지에서 `data:` 라인만 모아 JSON.parse(원본 :953-962).
 * 순수함수(I/O 없음) — 부분 메시지를 위해 잔여 버퍼를 반환한다.
 *
 * @returns { events, rest } — 완성된 이벤트 배열 + 다음 chunk 와 합칠 잔여 문자열.
 */
export function parseSseBuffer(buf: string): { events: InstallEvent[]; rest: string } {
  const events: InstallEvent[] = [];
  let rest = buf;
  let sepIdx: number;
  while ((sepIdx = rest.indexOf('\n\n')) !== -1) {
    const raw = rest.slice(0, sepIdx);
    rest = rest.slice(sepIdx + 2);
    // `data:` 로 시작하지 않는 라인(`: ping` heartbeat 등)은 무시(원본 :956-959).
    const dataLines = raw.split('\n').filter((l) => l.startsWith('data:'));
    if (!dataLines.length) continue;
    const json = dataLines.map((l) => l.slice(5).trimStart()).join('\n');
    try {
      events.push(JSON.parse(json) as InstallEvent);
    } catch {
      // 손상 메시지는 스킵(원본 :962 try/catch continue).
    }
  }
  return { events, rest };
}

/**
 * reader 루프 — SSE 스트림을 읽어 각 InstallEvent 를 onEvent 로 통지(원본 :944-973).
 * fetch 와 분리해 mock reader 로 단위 테스트 가능. 디코딩은 TextDecoder(stream:true).
 */
export async function consumeInstallStream(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  onEvent: (event: InstallEvent) => void,
): Promise<void> {
  const decoder = new TextDecoder();
  let buf = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const { events, rest } = parseSseBuffer(buf);
    buf = rest;
    for (const evt of events) onEvent(evt);
  }
}

/**
 * POST /api/settings/graph-db/install — SSE 설치 스트림 시작 + 이벤트 통지(원본 onLadybugInstall :904).
 *   done 이벤트의 result 를 반환(없으면 null). AbortSignal 로 취소(§5.3 신계약 — 원본은 가드 없음).
 *
 * @param strategy 'auto'|'brew'|'npm' — 백엔드가 선택(원본 buildLadybugCardHtml :874 data-ladybug-install).
 * @param onEvent  start/stdout/stderr/done 라인 단위 통지(UI 스트림 표시).
 */
export async function ladybugInstallStream(
  strategy: string,
  onEvent: (event: InstallEvent) => void,
  signal?: AbortSignal,
): Promise<InstallResult | null> {
  const res = await fetch('/api/settings/graph-db/install', {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'text/event-stream' },
    body: JSON.stringify({ strategy }),
    ...(signal ? { signal } : {}),
  });
  if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);

  let finalResult: InstallResult | null = null;
  await consumeInstallStream(res.body.getReader(), (evt) => {
    if (evt.type === 'done') finalResult = evt.result;
    onEvent(evt);
  });
  return finalResult;
}

// ── SQLite ───────────────────────────────────────────────────────────────────

/** GET /api/settings/sqlite/info — DB 파일 + 마이그레이션 + CLI(원본 :1072). */
export async function fetchSqliteInfo(signal?: AbortSignal): Promise<SqliteInfo> {
  const res = await fetch('/api/settings/sqlite/info', signal ? { signal } : undefined);
  return unwrap<SqliteInfo>(res, 'sqlite info failed');
}

// ── Proxy ──────────────────────────────────────────────────────────────────

/** GET /api/settings/proxy/snippet?shell= — 미리보기 스니펫(원본 :1177). 'auto'→'zsh' 정규화. */
export async function fetchProxySnippet(shell: ProxyShell, signal?: AbortSignal): Promise<ProxySnippet> {
  const res = await fetch(
    `/api/settings/proxy/snippet?shell=${encodeURIComponent(snippetShell(shell))}`,
    signal ? { signal } : undefined,
  );
  return unwrap<ProxySnippet>(res, 'proxy snippet failed');
}

/** GET /api/settings/proxy/status?shell= — 설치 상태(원본 :1178). 'auto' 그대로 전달. */
export async function fetchProxyStatus(shell: ProxyShell, signal?: AbortSignal): Promise<ProxyStatus> {
  const res = await fetch(
    `/api/settings/proxy/status?shell=${encodeURIComponent(shell)}`,
    signal ? { signal } : undefined,
  );
  return unwrap<ProxyStatus>(res, 'proxy status failed');
}

/** POST /api/settings/proxy/install — 셸 프로필 자동 등록(원본 :1353). body { shell }. */
export async function proxyInstall(shell: ProxyShell): Promise<ProxyInstallResult> {
  const res = await fetch('/api/settings/proxy/install', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ shell }),
  });
  return unwrap<ProxyInstallResult>(res, 'install failed');
}

/** POST /api/settings/proxy/restore — 백업 복구(원본 :1425). body { backupPath, shell }. */
export async function proxyRestore(backupPath: string, shell: ProxyShell): Promise<ProxyRestoreResult> {
  const res = await fetch('/api/settings/proxy/restore', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ backupPath, shell }),
  });
  return unwrap<ProxyRestoreResult>(res, 'restore failed');
}
