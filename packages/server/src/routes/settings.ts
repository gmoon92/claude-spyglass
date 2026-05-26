/**
 * routes/settings.ts — `/api/settings/*` 라우터
 *
 * 책임 (Single Responsibility):
 *   웹 대시보드 *설정 패널* 의 7개 엔드포인트를 한 곳에서 처리.
 *   사용자가 터미널 없이 클릭으로 진단 + Hook 자동 병합 + Graph DB 관리 + Proxy 안내 + 로그
 *   조회까지 끝낼 수 있도록 한다.
 *
 * 의존성:
 *   - settings/version-probe   (bun/claude/git/curl/jq 버전 조회)
 *   - settings/hook-detect     (현재 ~/.claude/settings.json 의 spyglass hook 등록 상태)
 *   - settings/claude-hooks    (Hook 자동 병합 — 백업/병합/atomic write)
 *   - @spyglass/storage-graph  (graph mode/circuit/sync 상태)
 *   - node:fs (graph 캐시 디렉토리 크기, 로그 디렉토리 스캔)
 *
 * 호출 흐름:
 *   apiRouter → settingsRouter(req, db) → path 매칭 → 핸들러 → jsonResponse
 *
 * 엔드포인트 표:
 *   GET  /api/settings/diag                  — 전체 진단 (binary versions + hooks + graph + ports)
 *   GET  /api/settings/hooks/preview?profile — 미리보기 (diff + merged 결과, 파일 미수정)
 *   POST /api/settings/hooks/apply           — 백업 + 병합 + atomic write
 *   POST /api/settings/graph/mode            — 런타임 모드 전환 (영속화 X)
 *   GET  /api/settings/proxy/snippet?shell   — claude() 조건부 프록시 함수 스니펫
 *   GET  /api/settings/logs                  — ~/.spyglass/logs/ 디렉토리 스캔
 *
 * 정책 (사용자 명시):
 *   - graph DB 데이터는 RDB retention 과 동일 cutoff 로만 정리되며, 폴더 자체를 자동/수동
 *     삭제하는 API/UI 는 본 모듈에 존재하지 않는다 (이전 `/graph/reset-cache` 엔드포인트는
 *     제거됨).
 *
 * 디자인 결정:
 *   - 모든 응답은 `{success, data}` 표준 (jsonResponse SSoT 재사용).
 *   - 실패는 throw 하지 않고 `{success:false, error}` 4xx/5xx 응답 — UI 가 토스트로 안내.
 *   - graph mode 전환은 *런타임만* — 영속화는 사용자가 셸 export 로. 보안 + 단순성.
 *
 * 비범위:
 *   - 서버 자체 재시작 / 포트 동적 변경 — 본 PR 범위 밖 (보안/UX 검토 필요). 명령어 복사만.
 */

import type { Database } from 'bun:sqlite';
import { readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { getLatestMigrationFile } from '@spyglass/storage';
import { jsonResponse } from './_shared';
import { probeAllVersions, probeSqlite3, type VersionProbeResult } from '../settings/version-probe';
import { detectHookStatus } from '../settings/hook-detect';
import {
  detectLadybugInstall,
  installLadybug,
  type InstallStrategy,
} from '../settings/graph-db-installer';
import {
  previewHookApply,
  applyHookProfile,
  restoreFromBackup,
  type HookProfileKind,
} from '../settings/claude-hooks';
import {
  installProxyHook,
  restoreProxyHook,
  checkProxyInstalled,
  type ShellSelector,
} from '../settings/proxy-installer';
import {
  getGraphMode,
  setGraphMode,
  getGraphModeSource,
  getCircuitBreaker,
  getSyncWorkerStatus,
  getGraphDir,
  saveServerConfig,
  getServerConfigPath,
  type GraphMode,
} from '@spyglass/storage-graph';
import { PORT } from '../runtime/config';

// =============================================================================
// 모듈 스코프 캐시 — /api/settings/diag 응답 (방안 A, dashboard.ts 패턴 복제)
// =============================================================================
//
// 배경 (분석 보고서 2026-05-26):
//   /api/settings/diag 는 5개 탭(diag/hooks/graph/sqlite/server)에서 동일 호출되며 한 번의
//   호출 비용이 외부 binary spawn × 5 + Hook 파일 IO + Graph 디렉토리 재귀 stat + Ladybug
//   탐지로 누적 ~100-300ms. 캐시 없음 → 매 탭 클릭마다 비용 반복.
//
// 정책:
//   - TTL 30초 — 사용자가 설정 페이지 안에서 탭을 왔다갔다 하는 일반 시나리오에서 ~1회 fetch
//   - 캐시 키 없음 — diag 는 사용자/쿼리 의존 없는 *전역 시스템 상태* 라 단일 슬롯
//   - mutation 직후 즉시 무효화 — invalidateDiagCacheNow() 호출 (debounce 없음)
//
// dashboard.ts 와 달리 hook 폭풍에 노출되지 않으므로(설정 페이지 명시적 액션에 한정)
// debounce 패턴 없이 단순 invalidateNow 만 제공.

const DIAG_CACHE_TTL = 30_000;

let _diagCache: { data: unknown; ts: number } | null = null;

/**
 * /api/settings/diag 응답 캐시 무효화 — 즉시.
 *
 * 호출자: 7개 mutation 핸들러 (hooks apply/restore, graph reset-cache/mode,
 *   graph-db install, proxy install/restore). 다음 GET /api/settings/diag 요청이
 *   fresh 데이터를 받도록 보장.
 */
function invalidateDiagCacheNow(): void {
  _diagCache = null;
}

// =============================================================================
// 라우터 본체
// =============================================================================

export async function settingsRouter(
  req: Request,
  db: Database,
): Promise<Response | null> {
  const url = new URL(req.url);
  const path = url.pathname;
  const method = req.method;

  if (!path.startsWith('/api/settings/')) return null;

  try {
    if (path === '/api/settings/diag' && method === 'GET') {
      return await handleDiag(db);
    }
    if (path === '/api/settings/hooks/preview' && method === 'GET') {
      return await handleHooksPreview(url);
    }
    if (path === '/api/settings/hooks/apply' && method === 'POST') {
      return await handleHooksApply(req);
    }
    if (path === '/api/settings/hooks/restore' && method === 'POST') {
      return await handleHooksRestore(req);
    }
    if (path === '/api/settings/graph/mode' && method === 'POST') {
      return await handleGraphMode(req);
    }
    if (path === '/api/settings/graph-db/status' && method === 'GET') {
      return await handleGraphDbStatus();
    }
    if (path === '/api/settings/graph-db/install' && method === 'POST') {
      return await handleGraphDbInstall(req);
    }
    if (path === '/api/settings/sqlite/info' && method === 'GET') {
      return jsonResponse({ success: true, data: await collectSqliteInfo(db) });
    }
    if (path === '/api/settings/proxy/snippet' && method === 'GET') {
      return handleProxySnippet(url);
    }
    if (path === '/api/settings/proxy/status' && method === 'GET') {
      return await handleProxyStatus(url);
    }
    if (path === '/api/settings/proxy/install' && method === 'POST') {
      return await handleProxyInstall(req);
    }
    if (path === '/api/settings/proxy/restore' && method === 'POST') {
      return await handleProxyRestore(req);
    }
    if (path === '/api/settings/logs' && method === 'GET') {
      return await handleLogs();
    }
    return jsonResponse({ success: false, error: `Unknown settings endpoint: ${method} ${path}` }, 404);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[settings-route] ${method} ${path} failed:`, err);
    return jsonResponse({ success: false, error: msg }, 500);
  }
}

// =============================================================================
// /api/settings/diag — 전체 진단
// =============================================================================

/**
 * 진단 카드 한 번에 — 외부 도구 버전 + hook 등록 + graph 상태 + 서버 메타 정보.
 *
 *   - 각 컴포넌트의 실패는 *부분 실패 허용* — 다른 컴포넌트 결과는 정상 반환.
 *   - 응답 셰이프는 settings-view.js 의 진단 카드 렌더 입력과 1:1 대응.
 */
async function handleDiag(db: Database): Promise<Response> {
  // 캐시 hit — TTL 안이면 즉시 반환 (방안 A).
  //   5개 탭이 같은 응답을 공유하므로 한 사용자 세션의 탭 순회 비용을 1회로 압축.
  const now = Date.now();
  if (_diagCache && now - _diagCache.ts < DIAG_CACHE_TTL) {
    return jsonResponse({ success: true, data: _diagCache.data });
  }

  // probeAllVersions / detectHookStatus / detectLadybugInstall / checkProxyInstalled 병렬.
  // proxy 는 사용자 shell 자동 감지 ('auto') — 진단 카드 통합 상태 배지로 노출.
  const [versions, hooks, ladybug, proxy] = await Promise.all([
    probeAllVersions(),
    detectHookStatus(),
    detectLadybugInstall().catch((err) => ({
      method: 'none' as const,
      installed: false,
      version: null,
      brewAvailable: false,
      npmAvailable: false,
      error: err instanceof Error ? err.message : String(err),
    })),
    checkProxyInstalled('auto').catch((err) => ({
      shell: 'zsh' as const,
      profilePath: '',
      profileExisted: false,
      installed: false,
      corrupted: false,
      hasMarkerOpen: false,
      hasMarkerClose: false,
      error: err instanceof Error ? err.message : String(err),
    })),
  ]);

  // graph 상태 — storage-graph 의 기존 헬퍼 재사용 (/api/graph/status 와 동일 데이터).
  //   PR 1: `source` 필드 추가 — UI 가 사용자에게 현재 mode 의 출처(env/file/default) 노출.
  //         `configFile` 필드 — 설정이 저장될 영속화 파일 경로.
  let graph: {
    mode: GraphMode;
    source: 'env' | 'file' | 'default';
    configFile: string;
    circuit: { state: string; consecutiveFailures: number; fallbackRate: number };
    sync: ReturnType<typeof getSyncWorkerStatus>;
    cacheDir: string;
    cacheSizeBytes: number | null;
  };
  try {
    const breaker = getCircuitBreaker();
    const cacheDir = getGraphDir();
    graph = {
      mode: getGraphMode(),
      source: getGraphModeSource(),
      configFile: getServerConfigPath(),
      circuit: {
        state: breaker.getState(),
        consecutiveFailures: breaker.getConsecutiveFailures(),
        fallbackRate: Number(breaker.getFallbackRate().toFixed(3)),
      },
      sync: getSyncWorkerStatus(),
      cacheDir,
      cacheSizeBytes: await dirSizeBytes(cacheDir).catch(() => null),
    };
  } catch (err) {
    // graph 미초기화 환경 (mode=off) 에서도 진단 자체는 응답.
    graph = {
      mode: 'off',
      source: 'default',
      configFile: getServerConfigPath(),
      circuit: { state: 'unknown', consecutiveFailures: 0, fallbackRate: 0 },
      sync: { running: false, cursor: null, lastErrorMessage: String(err) } as unknown as ReturnType<
        typeof getSyncWorkerStatus
      >,
      cacheDir: join(homedir(), '.spyglass', 'graph'),
      cacheSizeBytes: null,
    };
  }

  // 서버 메타.
  const server = {
    port: PORT,
    pid: process.pid,
    uptimeSec: Math.floor(process.uptime()),
    bunVersion: typeof Bun !== 'undefined' && Bun.version ? Bun.version : null,
    spyglassHome: join(homedir(), '.spyglass'),
    logsDir: join(homedir(), '.spyglass', 'logs'),
    cwd: process.cwd(),
  };

  // SQLite 진단 — DB 파일 + 마이그레이션 메타. Bun 내장 SQLite 라 별도 binary 진단 불필요.
  //   - dbPath          : ~/.spyglass/spyglass.db
  //   - dbSizeBytes     : 파일 크기
  //   - migration.version / filename : `_migrations` 최신 row
  const sqlite = await collectSqliteInfo(db);

  const data = { versions, hooks, graph, server, ladybug, proxy, sqlite };
  _diagCache = { data, ts: now };
  return jsonResponse({ success: true, data });
}

/**
 * SQLite DB 메타 정보 수집 — `/api/settings/diag` 및 `/api/settings/sqlite/info` SSoT.
 *
 *   - dbPath        : 환경변수 또는 기본 ~/.spyglass/spyglass.db
 *   - dbSizeBytes   : 파일 stat. 실패 시 null.
 *   - migration     : `_migrations` 최신 row → { version, filename }
 *   - cliVersion    : 외부 `sqlite3` CLI 의 VersionProbeResult (방안 B, 2026-05-26 분리).
 *                     SQLite 탭이 diag 응답을 추가로 fetch 하지 않고도 CLI 상태를 표시할 수
 *                     있도록 본 응답에 포함. diag 응답의 versions 에서는 제거됨.
 *
 * 실패는 부분 폴백 — 한 필드만 null 로 두고 나머지 정상 반환.
 */
async function collectSqliteInfo(db: Database): Promise<{
  dbPath: string;
  dbSizeBytes: number | null;
  migration: { version: number | null; filename: string | null };
  cliVersion: VersionProbeResult;
}> {
  const dbPath = process.env.SPYGLASS_DB_PATH
    || `${process.env.HOME || process.env.USERPROFILE}/.spyglass/spyglass.db`;

  // dbSize stat 과 sqlite3 CLI 프로브는 서로 독립이므로 Promise.all 로 fan-out — 직렬 대기 회피.
  const [dbStatResult, cliVersion] = await Promise.all([
    import('node:fs/promises')
      .then((m) => m.stat(dbPath))
      .then((st) => ({ ok: true as const, size: st.size }))
      .catch(() => ({ ok: false as const })),
    probeSqlite3(),
  ]);
  const dbSizeBytes = dbStatResult.ok ? dbStatResult.size : null;

  let migration: { version: number | null; filename: string | null } = { version: null, filename: null };
  try {
    const fn = getLatestMigrationFile(db);
    if (fn) {
      const match = /^(\d+)/.exec(fn);
      migration = { filename: fn, version: match ? parseInt(match[1], 10) : null };
    }
  } catch (err) {
    console.warn('[settings-route] getLatestMigrationFile failed:', err);
  }

  return { dbPath, dbSizeBytes, migration, cliVersion };
}

// =============================================================================
// /api/settings/hooks/preview — 적용 X, diff 만 반환
// =============================================================================

async function handleHooksPreview(url: URL): Promise<Response> {
  const profile = parseProfile(url.searchParams.get('profile'));
  if (!profile) {
    return jsonResponse(
      { success: false, error: 'profile query must be "full" or "minimal"' },
      400,
    );
  }
  const { diff, merged, current } = await previewHookApply(profile);
  return jsonResponse({
    success: true,
    data: {
      profile,
      diff,
      // UI 가 사용자에게 보여줄 수 있는 *압축된* before/after — 전체 JSON 은 너무 길어 hooks/env 만.
      before: { env: current.env ?? null, hooks: current.hooks ?? null },
      after: { env: merged.env ?? null, hooks: merged.hooks ?? null },
    },
  });
}

// =============================================================================
// /api/settings/hooks/apply — 백업 + 병합 + atomic write
// =============================================================================

async function handleHooksApply(req: Request): Promise<Response> {
  let body: { profile?: string } = {};
  try {
    body = (await req.json()) as { profile?: string };
  } catch {
    return jsonResponse({ success: false, error: 'invalid JSON body' }, 400);
  }
  const profile = parseProfile(body.profile ?? null);
  if (!profile) {
    return jsonResponse(
      { success: false, error: 'profile field must be "full" or "minimal"' },
      400,
    );
  }
  const result = await applyHookProfile(profile);
  // diag 캐시 무효화 — hooks 상태가 변경되었으므로 다음 GET /api/settings/diag 가 fresh 조회.
  invalidateDiagCacheNow();
  // PR 2 — Claude Code 재시작 안내를 응답에 명시 (UI 가 sticky banner 로 노출).
  //   사용자가 *이미 실행 중인* Claude Code 세션은 새 hook 을 자동으로 로드하지 않음.
  //   완전 종료 + 재시작이 필요한 사실이 그 동안 UI 에서 누락됐던 가장 큰 friction.
  return jsonResponse({
    success: true,
    data: {
      ...result,
      nextAction: 'restart-claude-code',
      nextActionHint:
        'Exit Claude Code completely and start a new session — the running session uses the previously loaded settings.json.',
    },
  });
}

// =============================================================================
// /api/settings/hooks/restore — 백업본으로부터 원복 (Undo)
// =============================================================================

/**
 * 사용자 보호: hooks/apply 직후 사용자가 "이전 설정으로 복구" 버튼을 누를 때 호출.
 *
 *   요청: { backupPath: string }  ← apply 응답의 data.backupPath 그대로 다시 전송.
 *
 *   백엔드는 backupPath 가 `settings.json.bak-` prefix 형식인지 *반드시* 검증
 *   (claude-hooks.ts::restoreFromBackup 내부) — 임의 경로의 파일을 settings.json 으로
 *   복사하는 path traversal 차단.
 *
 *   원복 자체도 안전을 위해 "현재 상태" 를 `settings.json.bak-<ts>-pre-restore` 로 한 번 더
 *   백업한 뒤 진행 (Undo 의 Undo).
 */
async function handleHooksRestore(req: Request): Promise<Response> {
  let body: { backupPath?: string } = {};
  try {
    body = (await req.json()) as { backupPath?: string };
  } catch {
    return jsonResponse({ success: false, error: 'invalid JSON body' }, 400);
  }
  if (typeof body.backupPath !== 'string' || body.backupPath.length === 0) {
    return jsonResponse(
      { success: false, error: 'backupPath is required and must be a non-empty string' },
      400,
    );
  }
  try {
    const result = await restoreFromBackup(body.backupPath);
    // diag 캐시 무효화 — hooks 상태가 복원되었으므로 다음 GET 이 fresh 조회.
    invalidateDiagCacheNow();
    return jsonResponse({ success: true, data: result });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return jsonResponse({ success: false, error: msg }, 400);
  }
}

// =============================================================================
// /api/settings/graph/mode — 런타임 모드 전환
// =============================================================================

/**
 * POST /api/settings/graph/mode
 *
 *   body: { mode: 'off'|'shadow'|'primary', persistent?: boolean }
 *     - mode       : 새로 적용할 graph 모드.
 *     - persistent : 기본값 true. true 면 `server-config.json` 에 저장 → 다음 서버 시작에도 유지.
 *                    false 면 *현재 세션 캐시만* 변경 (이전 동작과 동일).
 *
 *   응답 (Gemini API 사양):
 *     { previous, current, persistent, configFile, source, hint }
 *
 *   env override 가 있을 때: 사용자가 GUI 에서 토글해도 *현재 적용은 env 가 계속 우선*.
 *   이 경우에도 파일에는 저장 (다음 시작에서 env 가 사라지면 GUI 의도가 반영되도록).
 *   응답의 `hint` 가 env override 상황을 명시 — UI 가 사용자에게 경고.
 */
async function handleGraphMode(req: Request): Promise<Response> {
  let body: { mode?: string; persistent?: boolean } = {};
  try {
    body = (await req.json()) as { mode?: string; persistent?: boolean };
  } catch {
    return jsonResponse({ success: false, error: 'invalid JSON body' }, 400);
  }
  const raw = (body.mode ?? '').toLowerCase();
  if (raw !== 'off' && raw !== 'shadow' && raw !== 'primary') {
    return jsonResponse(
      { success: false, error: 'mode must be one of "off" / "shadow" / "primary"' },
      400,
    );
  }
  const next = raw as GraphMode;
  // 기본값 true — 대시보드 GUI 토글의 의도는 영구 변경. 명시적 false 만 세션-only.
  const persistent = body.persistent !== false;
  const previous = getGraphMode();
  const previousSource = getGraphModeSource();

  // 1) 런타임 캐시 갱신 (즉시 적용 — env override 가 있어도 setGraphMode 가 캐시 자체는 갱신).
  setGraphMode(next);
  // diag 캐시 무효화 — graph.mode / graph.source 변경. 영속화 실패 경로도 런타임은 바뀌었으므로
  // 영속화 try/catch 이전에 호출해 모든 경로에서 일관 무효화.
  invalidateDiagCacheNow();

  // 2) 영속화 (옵션).
  let persistedTo: string | null = null;
  if (persistent) {
    try {
      const cfg = await saveServerConfig({ graphMode: next });
      persistedTo = getServerConfigPath();
      // env override 가 있던 케이스에선 source 가 여전히 'env'. 그 외엔 file 갱신.
      void cfg; // type assertion 회피용 — 결과 자체는 사용 안 함.
    } catch (err) {
      console.warn('[settings-route] saveServerConfig failed:', err);
      // 영속화 실패해도 런타임 변경은 유효 — 사용자에게 명시.
      return jsonResponse({
        success: true,
        data: {
          previous,
          current: next,
          persistent: false,
          persistedTo: null,
          configFile: getServerConfigPath(),
          source: getGraphModeSource(),
          hint: 'runtime applied but failed to persist — please retry or check disk permissions',
        },
      });
    }
  }

  // 3) hint 생성 — env override 상황을 명시.
  let hint: string;
  if (previousSource === 'env') {
    hint = persistent
      ? 'env SPYGLASS_GRAPH_MODE overrides this setting — saved to file but not active until env is unset'
      : 'env SPYGLASS_GRAPH_MODE overrides this setting — runtime cache updated but env still wins on restart';
  } else if (persistent) {
    hint = `persisted — will apply on next start (config: ${getServerConfigPath()})`;
  } else {
    hint = 'runtime-only — pass persistent:true to save permanently';
  }

  return jsonResponse({
    success: true,
    data: {
      previous,
      current: next,
      persistent,
      persistedTo,
      configFile: getServerConfigPath(),
      source: getGraphModeSource(),
      hint,
    },
  });
}

// =============================================================================
// /api/settings/graph-db/* — Ladybug 의존성 자동 설치 (migration-plan §D)
// =============================================================================

/**
 * GET /api/settings/graph-db/status — 현재 시스템의 Ladybug 설치 상태.
 *
 * 응답: { success, data: { method, installed, version, path?, brewAvailable, npmAvailable } }
 *
 * 설정 페이지의 "Ladybug 의존성" 카드가 진단 시 호출. 회로 OPEN 여부와 무관 —
 * 설치 자체는 그래프 DB 의 상태와 별개로 평가.
 */
async function handleGraphDbStatus(): Promise<Response> {
  const status = await detectLadybugInstall();
  return jsonResponse({ success: true, data: status });
}

/**
 * POST /api/settings/graph-db/install — 자동 설치 실행.
 *
 * Body: { strategy?: 'brew' | 'npm' | 'auto' }
 *   - 'auto' (기본): brew 가능 시 brew, 아니면 npm.
 *
 * 응답: { success, data: { status, method, version, log, restartRequired, error? } }
 *
 * 설치 자체는 최대 180s. 완료 후 sticky alert "Claude Code 재시작 필요" 안내.
 */
async function handleGraphDbInstall(req: Request): Promise<Response> {
  let body: { strategy?: InstallStrategy } = {};
  try {
    if (req.headers.get('content-type')?.includes('application/json')) {
      body = await req.json();
    }
  } catch {
    return jsonResponse({ success: false, error: 'Invalid JSON body' }, 400);
  }
  const strategy = body.strategy ?? 'auto';
  const result = await installLadybug(strategy);
  // diag 캐시 무효화 — ladybug.installed / version 이 변경되었을 수 있음. 실패해도 부분 상태가
  // 바뀌었을 가능성이 있어 동일하게 무효화 (보수적).
  invalidateDiagCacheNow();
  return jsonResponse({ success: result.status !== 'failed', data: result });
}

// =============================================================================
// /api/settings/proxy/snippet — 조건부 claude() 함수
// =============================================================================

/**
 * 사용자 셸 종류별로 조건부 프록시 함수 스니펫을 생성.
 *
 *   - spyglass 가 LISTEN 상태일 때만 ANTHROPIC_BASE_URL 을 주입 — 서버가 죽으면 자동으로
 *     원래 Anthropic API 로 폴백.
 *   - PORT 는 서버 자신의 환경(`PORT`) 을 그대로 주입 — 사용자가 SPYGLASS_PORT 를 바꿔
 *     실행했으면 그 값이 반영됨.
 */
function handleProxySnippet(url: URL): Response {
  const shell = (url.searchParams.get('shell') ?? 'zsh').toLowerCase();
  const port = PORT;
  let snippet = '';
  if (shell === 'fish') {
    snippet = `function claude
  if curl -fsS http://localhost:${port}/health > /dev/null 2>&1
    ANTHROPIC_BASE_URL=http://localhost:${port} command claude $argv
  else
    command claude $argv
  end
end`;
  } else {
    // bash / zsh / sh 모두 동일.
    snippet = `claude() {
  if curl -fsS http://localhost:${port}/health > /dev/null 2>&1; then
    ANTHROPIC_BASE_URL=http://localhost:${port} command claude "$@"
  else
    command claude "$@"
  fi
}`;
  }
  return jsonResponse({
    success: true,
    data: { shell, port, snippet },
  });
}

// =============================================================================
// /api/settings/proxy/install — 셸 프로필에 마커 블록 자동 주입 (PR 2)
// =============================================================================

/**
 * 진정한 원클릭 자동화의 핵심 — 사용자가 `[프록시 자동 등록]` 한 번 누르면 백엔드가
 * `~/.zshrc` 등 셸 프로필에 spyglass 마커 블록을 idempotent 하게 추가/교체.
 *
 *   body: { shell?: 'auto'|'zsh'|'bash'|'fish' }
 *     - 'auto' (기본): proxy-installer 의 detectShellProfile 로 자동 탐지.
 *
 *   응답: { installedTo, shell, backupPath, action, cleanedGraphModeExports, nextAction }
 *     - installedTo: 실제 수정된 파일 경로 (UI 가 사용자에게 명시 노출).
 *     - backupPath : 백업 파일 절대 경로 — UI 의 [Undo] 버튼이 그대로 전달.
 *     - action     : 'replaced' (기존 마커 교체) | 'appended' (새로 추가).
 *     - cleanedGraphModeExports: SPYGLASS_GRAPH_MODE export 잔존을 주석 처리한 줄 수.
 *     - nextAction : 사용자에게 보여줄 다음 행동 안내 (예: "source ~/.zshrc 또는 새 터미널").
 *
 *   마커가 한쪽만 손상된 비정상 셸 프로필이면 *400* + 에러 메시지 — 사용자에게 수동 정정 안내.
 */
/**
 * GET /api/settings/proxy/status?shell=auto|zsh|bash|fish
 *
 *   *읽기 전용* — 셸 프로필을 수정하지 않고 *현재 설치 상태* 만 진단.
 *   진단 카드의 통합 상태 배지가 호출하여 ✓ 설치됨 / ⚠ 미설치 / ✕ 손상 표시.
 */
async function handleProxyStatus(url: URL): Promise<Response> {
  const shell = parseShellSelector(url.searchParams.get('shell') ?? undefined);
  const result = await checkProxyInstalled(shell);
  return jsonResponse({ success: true, data: result });
}

async function handleProxyInstall(req: Request): Promise<Response> {
  let body: { shell?: string } = {};
  try {
    body = (await req.json().catch(() => ({}))) as { shell?: string };
  } catch {
    // 빈 body 허용 — shell 자동 탐지로 진행.
  }
  const shell = parseShellSelector(body.shell);
  try {
    const result = await installProxyHook({ shell, port: PORT });
    // diag 캐시 무효화 — proxy.installed / profilePath 가 변경.
    invalidateDiagCacheNow();
    return jsonResponse({ success: true, data: result });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return jsonResponse({ success: false, error: msg }, 400);
  }
}

// =============================================================================
// /api/settings/proxy/restore — 백업 복원 또는 마커 블록 제거 (PR 2)
// =============================================================================

/**
 * 두 가지 모드:
 *   - body.backupPath 있음: 해당 백업 파일 전체를 셸 프로필에 복원 (사용자 셸 코드 포함).
 *   - body.backupPath 없음: 마커 블록만 제거 (다른 사용자 코드는 보존).
 *
 *   path traversal 가드는 proxy-installer.ts::restoreProxyHook 가 책임 (backup prefix 검증).
 */
async function handleProxyRestore(req: Request): Promise<Response> {
  let body: { backupPath?: string; shell?: string } = {};
  try {
    body = (await req.json().catch(() => ({}))) as { backupPath?: string; shell?: string };
  } catch {
    // 빈 body 허용 — uninstall-block 모드.
  }
  const shell = parseShellSelector(body.shell);
  try {
    const result = await restoreProxyHook({ backupPath: body.backupPath, shell });
    // diag 캐시 무효화 — proxy.installed 가 변경.
    invalidateDiagCacheNow();
    return jsonResponse({ success: true, data: result });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return jsonResponse({ success: false, error: msg }, 400);
  }
}

function parseShellSelector(raw: string | undefined): ShellSelector {
  if (raw === 'zsh' || raw === 'bash' || raw === 'fish' || raw === 'auto') return raw;
  return 'auto';
}

// =============================================================================
// /api/settings/logs — 로그 디렉토리 스캔
// =============================================================================

interface LogFileEntry {
  name: string;
  sizeBytes: number;
  mtimeMs: number;
}

async function handleLogs(): Promise<Response> {
  const dir = join(homedir(), '.spyglass', 'logs');
  let entries: LogFileEntry[] = [];
  try {
    const names = await readdir(dir);
    const stats = await Promise.all(
      names.map(async (name) => {
        try {
          const st = await stat(join(dir, name));
          return st.isFile()
            ? ({ name, sizeBytes: st.size, mtimeMs: st.mtimeMs } as LogFileEntry)
            : null;
        } catch {
          return null;
        }
      }),
    );
    entries = stats.filter((s): s is LogFileEntry => s !== null);
    entries.sort((a, b) => b.mtimeMs - a.mtimeMs);
  } catch {
    // 디렉토리 없음 — 빈 응답.
  }
  return jsonResponse({ success: true, data: { dir, files: entries } });
}

// =============================================================================
// 헬퍼
// =============================================================================

function parseProfile(raw: string | null): HookProfileKind | null {
  if (raw === 'full' || raw === 'minimal') return raw;
  return null;
}

/** 디렉토리 안의 모든 파일 사이즈 합산 — 재귀. 큰 디렉토리는 늦을 수 있지만 graph 캐시는 보통 수 MB. */
async function dirSizeBytes(dir: string): Promise<number> {
  let total = 0;
  let names: string[];
  try {
    names = await readdir(dir);
  } catch {
    return 0;
  }
  for (const name of names) {
    const p = join(dir, name);
    try {
      const st = await stat(p);
      if (st.isDirectory()) total += await dirSizeBytes(p);
      else if (st.isFile()) total += st.size;
    } catch {
      // skip 권한/race 에러.
    }
  }
  return total;
}
