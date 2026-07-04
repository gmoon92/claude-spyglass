/**
 * features/settings/types.ts — /api/settings/* 응답의 web-local 런타임 contract (P2-06)
 *
 * 원본: assets/js/settings-view.js 의 fetch('/api/settings/diag') 응답을 *암묵* 으로 소비하던
 *   구조를 명시 타입으로 고정한다. 이 형태는 @spyglass/types(server/TUI 공통 데이터 contract)에
 *   존재하지 않는 web-local API contract 이므로(api.js PresetValue/ActiveRange 와 동일 정책,
 *   app-store.ts:13-14 주석 근거) 여기서 선언한다 — 도메인 타입 재선언이 아니다.
 *
 * 백엔드 SSoT(필드/널 규약 1:1):
 *   - versions: packages/server/src/settings/version-probe.ts VersionProbeResult / AllVersionsResult
 *   - hooks   : packages/server/src/settings/hook-detect.ts HookDetectResult / HookEventStatus
 *   - graph/server/sqlite/proxy/ladybug: packages/server/src/routes/settings.ts handleDiag (:185-281)
 *
 * 본 task(P2-06)는 진단(diag)/Hook/Server 3 sub-tab 만 이식하므로 graph/sqlite/ladybug 의
 *   세부 필드는 진단 카드가 읽는 최소 형태(아키텍처 §2 #3)만 좁게 선언한다 — P2-07 이
 *   GraphPanel/SqlitePanel 이식 시 확장한다(.passthrough 의도로 추가 필드 허용 = optional).
 */

// ── 외부 도구 버전 (version-probe.ts VersionProbeResult 1:1) ──────────────────
export interface VersionInfo {
  name: string;
  available: boolean;
  version: string | null;
  raw: string | null;
  installHint: string;
}

/** version-probe.ts AllVersionsResult 1:1 (진단 카드가 읽는 5개 도구). */
export interface VersionsData {
  bun: VersionInfo;
  claude: VersionInfo;
  git: VersionInfo;
  curl: VersionInfo;
  jq: VersionInfo;
}

/** 진단/Hook 카드가 읽는 도구 키 — versionRow 호출(settings-view.js:313-317). */
export type VersionKey = keyof VersionsData;

// ── Hook 등록 상태 (hook-detect.ts HookDetectResult/HookEventStatus 1:1) ──────
export interface HookEventStatus {
  event: string;
  count: number;
  expected: boolean;
}

export interface HookData {
  path: string;
  exists: boolean;
  parsed: boolean;
  spyglassDir: string | null;
  events: HookEventStatus[];
  registeredCount: number;
  expectedCount: number;
  fileSize: number | null;
}

// ── Graph DB (settings.ts handleDiag graph block :222-260 — P2-07 확장) ─────────
/** Sync Worker 상태 — handleDiag graph.sync(:243 getSyncWorkerStatus). 엔지니어링 카드만 읽음. */
export interface GraphSyncStatus {
  running: boolean;
  cursor: number | string | null;
}

/**
 * /api/settings/diag 응답 data.graph — Storage 패널 "관계 흐름 그래프" 섹션이 읽는 형태.
 * 그래프는 항상 켜진 상태로 고정(v4.3.x) — mode/source 개념 제거. 안전망(circuit/sync) 상태와
 * 캐시 크기·경로·설정 파일 경로만 노출. diag 엔드포인트가 항상 반환하는 필드라 전부 필수.
 */
export interface GraphData {
  configFile: string;
  circuit: { state: string; consecutiveFailures: number; fallbackRate: number };
  sync: GraphSyncStatus;
  cacheDir: string;
  cacheSizeBytes: number | null;
}

/**
 * Ladybug 의존성 설치 여부 — 진단 카드가 graph 상태 결정에 읽는 최소형(settings.ts:285).
 * GraphPanel 은 graph-db/status 전체(LadybugStatus)를 별도로 fetch 한다.
 */
export interface LadybugData {
  installed: boolean;
}

/**
 * GET /api/settings/graph-db/status 응답 data — graph-db-installer.ts LadybugInstallStatus 1:1.
 * GraphPanel 의 Ladybug 카드(buildLadybugCardHtml :860) + 엔지니어링 row(:765-784)가 읽는다.
 */
export interface LadybugStatus {
  /** 설치 방식 — 'bun'|'brew'|'npm'|'none' 등(InstallMethod). 'none' 이면 미설치. */
  method: string;
  installed: boolean;
  version: string | null;
  path?: string;
  bunAvailable: boolean;
  brewAvailable: boolean;
  npmAvailable: boolean;
  error?: string;
}

// ── Ladybug 설치 SSE (graph-db-installer.ts InstallEvent/InstallResult 1:1) ─────
/** 설치 결과 — done 이벤트의 result(graph-db-installer.ts:55). */
export interface InstallResult {
  status: 'installed' | 'already-installed' | 'failed';
  method: string;
  version: string | null;
  log: string;
  restartRequired: boolean;
  error?: string;
  hints?: string[];
}

/**
 * 설치 진행 SSE 이벤트(graph-db-installer.ts:74). POST /graph-db/install 스트림이 emit.
 * 원본 onLadybugInstall(:963-970) 파싱부와 1:1 — start/stdout/stderr/done.
 */
export type InstallEvent =
  | { type: 'start'; cmd: string[]; cwd?: string }
  | { type: 'stdout'; line: string }
  | { type: 'stderr'; line: string }
  | { type: 'done'; result: InstallResult };

// ── SQLite (진단 카드가 읽는 migration 메타만 — settings.ts collectSqliteInfo) ──
export interface SqliteData {
  migration: { version: number | null; filename: string | null } | null;
}

/** sqlite3 외부 CLI 프로브 — collectSqliteInfo cliVersion(version-probe.ts VersionProbeResult 1:1). */
export interface SqliteCliVersion {
  name: string;
  available: boolean;
  version: string | null;
  raw: string | null;
  installHint: string;
}

/**
 * GET /api/settings/sqlite/info 응답 data — collectSqliteInfo(:296-301) 1:1.
 * SqlitePanel 이 읽는 전체형(원본 renderSqliteSection :1062). 진단 카드 SqliteData 보다 넓다.
 */
export interface SqliteInfo {
  dbPath: string;
  dbSizeBytes: number | null;
  migration: { version: number | null; filename: string | null };
  cliVersion: SqliteCliVersion | null;
  /**
   * CAS(Content-Addressed Storage) 실현 절감 — settings.ts getCasStats 1:1.
   * 구버전 서버 응답 호환을 위해 옵셔널(없으면 저장소 패널이 CAS 행을 숨김).
   */
  cas?: {
    artifactCount: number;
    chunkRefCount: number;
    casRowCount: number;
    logicalBytes: number;
    uniqueBytes: number;
    storedBytes: number;
    savedBytes: number;
    savedPct: number;
  };
}

// ── Proxy (진단 카드 proxyRowHtml 이 읽는 형태 — settings.ts checkProxyInstalled) ─
export interface ProxyData {
  shell: string;
  profilePath: string;
  profileExisted: boolean;
  installed: boolean;
  corrupted: boolean;
}

/** Proxy 셸 선택 옵션(원본 renderProxySection shells :1208). 'auto' 포함 — local union. */
export type ProxyShell = 'auto' | 'zsh' | 'bash' | 'fish';

/**
 * GET /api/settings/proxy/status 응답 data — proxy-installer.ts checkProxyInstalled(:285-293) 1:1.
 * ProxyPanel 통합 배지 + 엔지니어링 row(마커 검출)가 읽는다(원본 :1191-1271).
 */
export interface ProxyStatus {
  shell: string;
  profilePath: string;
  profileExisted: boolean;
  installed: boolean;
  corrupted: boolean;
  hasMarkerOpen: boolean;
  hasMarkerClose: boolean;
}

/** GET /api/settings/proxy/snippet 응답 data — handleProxySnippet(:677-680). 미리보기 코드박스. */
export interface ProxySnippet {
  shell: string;
  port: number;
  snippet: string;
}

/** POST /api/settings/proxy/install 응답 data — proxy-installer.ts InstallResult(:334-341) 1:1. */
export interface ProxyInstallResult {
  installedTo: string;
  shell: string;
  backupPath: string | null;
  action: 'replaced' | 'appended';
  nextAction: string;
  /** 마커 밖에 stray 프록시 함수가 남아 중복 위험 시 true — UI 가 수동 정리 경고 노출. */
  legacyUnmarked?: boolean;
  /** 설치 후 셸 구문 검증(`<shell> -n`) 결과. */
  verify?: 'ok' | 'failed' | 'skipped';
  /** 검증 성공으로 이번 백업을 삭제했으면 true. */
  backupRemoved?: boolean;
}

/** POST /api/settings/proxy/restore 응답 data — proxy-installer.ts restoreProxyHook(:392-399) 1:1. */
export interface ProxyRestoreResult {
  targetPath: string;
  mode: 'restore-backup' | 'uninstall-block';
  restoredFrom: string | null;
  preRestoreBackup: string | null;
  removedBlock: boolean;
}

// ── 서버 메타 (settings.ts handleDiag server :263-271) ────────────────────────
export interface ServerInfo {
  port: number;
  pid: number;
  uptimeSec: number;
  bunVersion: string | null;
  spyglassHome: string;
  logsDir: string;
  cwd: string;
}

/** 보관 기간 — handleDiag retention 블록(settings.ts). Storage 패널 요약 카드가 노출. */
export interface RetentionData {
  days: number;
}

/** /api/settings/diag 응답 data — handleDiag 의 `{ versions, hooks, graph, server, ladybug, proxy, sqlite, retention }`. */
export interface DiagData {
  versions: VersionsData;
  hooks: HookData;
  graph: GraphData;
  server: ServerInfo;
  ladybug: LadybugData | null;
  proxy: ProxyData | null;
  sqlite: SqliteData | null;
  retention: RetentionData;
}

// ── /api/settings/logs 응답 data (ServerPanel 로그 목록 — settings-view.js:1485) ─
export interface LogFile {
  name: string;
  sizeBytes: number | null;
  mtimeMs: number;
}

export interface LogsData {
  dir: string;
  files: LogFile[];
}

// ── /api/settings/hooks/{preview,apply} 응답 data.diff (settings-view.js renderHookDiff) ─
export interface HookDiff {
  applied: string[];
  modified: string[];
  preserved: string[];
  spyglassDir: string;
  spyglassDirAfter: string;
}

/** preview 응답 data. */
export interface HookPreviewData {
  diff: HookDiff;
}

/** apply 응답 data — backupPath + nextAction(재시작 안내) 포함. */
export interface HookApplyData {
  diff: HookDiff;
  /** 검증 성공 후 백업을 삭제하면 null. */
  backupPath: string | null;
  nextAction?: string;
  /** 적용 후 JSON 유효성 검증 결과. */
  verify?: 'ok' | 'failed';
  /** 검증 성공으로 이번 백업을 삭제했으면 true. */
  backupRemoved?: boolean;
}

/** restore 응답 data — bindUndoButton 이 읽는 형태(settings-view.js:628-634). */
export interface HookRestoreData {
  restoredFrom: string;
  preRestoreBackup?: string;
}

/** Hook 프로필 — full 단일(선택 아님). minimal 제거됨. */
export type HookProfile = 'full';

/** 진단 row 상태 — rowHtml status(settings-view.js:1534) 와 1:1. */
export type RowStatus = 'ok' | 'warn' | 'fail';

/** Hook 통합 헬스 상태 — renderHooksSection healthState(settings-view.js:409-413). */
export type HookHealthState = 'ok' | 'warn' | 'missing' | 'broken';
