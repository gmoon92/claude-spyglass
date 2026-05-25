/**
 * client.ts — LadybugDB native binding 래퍼 (Lazy Single Connection)
 *
 * 책임:
 *   `@ladybugdb/core` 네이티브 모듈을 *런타임에서만 lazy import* 해서 Spyglass 의
 *   다른 코드 경로가 native 의존성 없이도 구동되도록 한다. dlopen 실패, native crash,
 *   schema 적용 실패는 모두 본 모듈 안에서 흡수하고 호출자에게는 명확한 Error 만
 *   전달.
 *
 * 의존성:
 *   - @ladybugdb/core           — devDependency, 본 모듈 안에서만 import.
 *   - schema/ddl, schema/apply  — 첫 connect 시 DDL 자동 적용.
 *   - runtime/paths             — 데이터 파일 위치.
 *   - runtime/circuit-breaker   — 실패 시 회로 보고.
 *
 * 호출 흐름:
 *   1) 첫 사용 측이 `getLadybugClient()` 호출.
 *   2) singleton 인스턴스가 없으면 새로 만들고 `connect()` (lazy dynamic import).
 *   3) 성공하면 `applySchema()` 까지 호출하고 ready 상태.
 *   4) 실패하면 `closed` 상태로 두고 `LadybugUnavailableError` throw — 회로가 OPEN 으로
 *      전이.
 *
 * 디자인 결정:
 *   - 모든 Ladybug 호출은 `client.query()` 를 단일 진입점으로 통과시킨다. 직접 native
 *     handle 을 노출하지 않음으로써, 향후 fork 교체(Bighorn 등) 시 본 파일만 수정.
 *   - native module 은 `await import('@ladybugdb/core')` 로 로드하므로 패키지가 install
 *     안 되어 있어도 본 파일이 *import 자체에서* 깨지지 않음 — 그래프 모드가 off
 *     이면 절대 호출되지 않으므로 안전.
 *   - `closeLadybugClient()` 는 멱등 — server shutdown hook 에서 안전하게 호출 가능.
 *
 * @see ${CLAUDE_PROJECT_DIR}/.claude/.tmp/plans/spyglass/graph-db-research/02-electron-runtime.md
 *   §2 Bun ↔ Kuzu 호환성 — exit segfault 등 잠재 위험은 회로 차단기로 격리.
 */

import { getGraphDir, getGraphDbPath } from './runtime/paths';
import { getCircuitBreaker } from './runtime/circuit-breaker';
import { applySchema } from './schema/apply';

// =============================================================================
// 타입 — Ladybug native 결과를 좁은 표면적으로 추상화
// =============================================================================

/**
 * Cypher 쿼리 결과의 표준 형태. 다양한 fork 가 row[] vs nodes/edges 등 서로 다른
 * 형태를 반환할 수 있어 본 표면을 통일한다.
 */
export interface LadybugQueryResult {
  /** 각 record (RETURN 절의 한 row) 를 plain object 로 매핑한 배열. */
  rows: Record<string, unknown>[];
  /** 쿼리 실행 소요 시간 (ms). 없으면 0. */
  durationMs: number;
}

/**
 * Ladybug 가 사용 불가한 상태(설치 안 됨, native dlopen 실패, schema 적용 실패) 임을
 * 명시. 호출자는 본 에러를 catch 해서 회로 OPEN + SQLite 폴백을 수행.
 */
export class LadybugUnavailableError extends Error {
  readonly cause: unknown;
  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = 'LadybugUnavailableError';
    this.cause = cause;
  }
}

// =============================================================================
// 외부에서 보는 인터페이스 — 직접 native handle 노출 금지
// =============================================================================

export class LadybugClient {
  /** lazy import로 받은 native module — `any` 인 이유는 fork마다 타입 표면이 달라서. */
  private native: any = null;
  /** native 가 만든 Database 핸들. */
  private dbHandle: any = null;
  /** 한 번 연결한 뒤 close 까지 유지되는 connection 객체. */
  private connHandle: any = null;
  private state: 'idle' | 'ready' | 'failed' | 'closed' = 'idle';
  private lastError: unknown = null;

  /**
   * Ladybug native binding 로드 + DB 파일 open + 스키마 idempotent 적용.
   * 한 번 실패하면 state='failed' 로 굳히고 재시도하지 않음 (서버 재기동 필요).
   * 호출은 `getLadybugClient()` 안에서만 일어나므로 외부에서 직접 부를 일 없음.
   */
  async connect(): Promise<void> {
    if (this.state === 'ready') return;
    if (this.state === 'failed') {
      throw new LadybugUnavailableError('client previously failed to initialize', this.lastError);
    }

    try {
      // 디렉토리 보장 — paths 모듈이 자동 생성 + README 작성.
      getGraphDir();

      // Lazy native import — 본 줄에서만 @ladybugdb/core 가 평가된다.
      // 패키지가 install 되지 않은 경우 ERR_MODULE_NOT_FOUND 가 발생하고 catch 분기로 진입.
      // 메타 패키지 이름이 확정되기 전까지는 fork에 맞춰 조정 (TODO: install 후 lockfile 확인).
      const mod = await import(/* @vite-ignore */ '@ladybugdb/core' as string);
      this.native = (mod as any).default ?? mod;

      // Database open — Kuzu/Ladybug API는 보통 `new Database(path)` + `new Connection(db)`.
      // 정확한 클래스 이름이 fork에 따라 다를 수 있어 두 패턴 모두 시도.
      const dbPath = getGraphDbPath();
      const DatabaseCtor = this.native.Database ?? this.native.Kuzu?.Database;
      const ConnectionCtor = this.native.Connection ?? this.native.Kuzu?.Connection;
      if (!DatabaseCtor || !ConnectionCtor) {
        throw new LadybugUnavailableError(
          `@ladybugdb/core does not expose expected Database/Connection constructors. ` +
            `Got keys: ${Object.keys(this.native).join(',')}`,
        );
      }

      this.dbHandle = new DatabaseCtor(dbPath);
      this.connHandle = new ConnectionCtor(this.dbHandle);

      // 스키마 idempotent 적용 (DDL × 7 + REL × 8 + _SchemaMeta 갱신).
      await applySchema(this);

      this.state = 'ready';
    } catch (err) {
      this.lastError = err;
      this.state = 'failed';
      // 회로 즉시 보고 — 다음 호출부터 회로가 차단 결정.
      getCircuitBreaker().recordFailure(err);
      const message =
        err instanceof LadybugUnavailableError
          ? err.message
          : `Failed to initialize @ladybugdb/core — graph projection disabled this session. ` +
            `Reason: ${err instanceof Error ? err.message : String(err)}`;
      throw new LadybugUnavailableError(message, err);
    }
  }

  /**
   * Cypher 쿼리 실행. 모든 Ladybug 호출은 본 메서드를 통과한다 (단일 진입점).
   * 실패는 LadybugUnavailableError 로 표준화되어 회로가 OPEN 결정할 수 있게 한다.
   */
  async query(cypher: string, params: Record<string, unknown> = {}): Promise<LadybugQueryResult> {
    if (this.state !== 'ready') {
      throw new LadybugUnavailableError(`client not ready (state=${this.state})`, this.lastError);
    }
    const started = Date.now();
    try {
      // Kuzu/Ladybug API는 fork마다 `connection.query(cypher, params)` 가 row[] 반환 또는
      // `QueryResult` 객체 반환. 두 패턴 모두 흡수.
      const raw = await this.connHandle.query(cypher, params);
      const rows = this.normalizeResult(raw);
      return { rows, durationMs: Date.now() - started };
    } catch (err) {
      getCircuitBreaker().recordFailure(err);
      throw new LadybugUnavailableError(
        `Cypher query failed: ${err instanceof Error ? err.message : String(err)}`,
        err,
      );
    }
  }

  /**
   * 트랜잭션 헬퍼 — sync worker 의 batch MERGE 에서 사용. fork 에 따라 transaction API
   * 가 다를 수 있어 fallback 으로 begin/commit 패턴도 지원.
   */
  async transaction<T>(work: () => Promise<T>): Promise<T> {
    if (this.state !== 'ready') {
      throw new LadybugUnavailableError(`client not ready (state=${this.state})`, this.lastError);
    }
    // 우선 fork 의 네이티브 transaction 호출 시도.
    if (typeof this.connHandle.transaction === 'function') {
      return this.connHandle.transaction(work);
    }
    // 폴백 — Cypher BEGIN/COMMIT/ROLLBACK.
    await this.connHandle.query('BEGIN TRANSACTION');
    try {
      const result = await work();
      await this.connHandle.query('COMMIT');
      return result;
    } catch (err) {
      try {
        await this.connHandle.query('ROLLBACK');
      } catch {
        // rollback 실패는 무시 — 원본 에러를 throw.
      }
      throw err;
    }
  }

  /** 연결 종료 — 멱등. server shutdown hook 에서 호출. */
  close(): void {
    if (this.state === 'closed') return;
    try {
      if (this.connHandle?.close) this.connHandle.close();
      if (this.dbHandle?.close) this.dbHandle.close();
    } catch {
      // close 실패는 무시 — 어차피 프로세스 종료 임박.
    }
    this.connHandle = null;
    this.dbHandle = null;
    this.native = null;
    this.state = 'closed';
  }

  /** 현재 상태 — sync worker / API 라우터가 ready 여부 확인용. */
  isReady(): boolean {
    return this.state === 'ready';
  }

  // ---------------------------------------------------------------------------
  // private
  // ---------------------------------------------------------------------------

  /**
   * native query 결과를 Record<string, unknown>[] 로 정규화. fork 마다 형태가 다르므로
   * 알려진 3가지 패턴(배열 직반환 / { rows } / { records }) 을 모두 수용.
   */
  private normalizeResult(raw: any): Record<string, unknown>[] {
    if (Array.isArray(raw)) return raw as Record<string, unknown>[];
    if (raw && Array.isArray(raw.rows)) return raw.rows;
    if (raw && Array.isArray(raw.records)) return raw.records;
    if (raw && typeof raw.getAll === 'function') {
      // Kuzu Node API의 QueryResult.getAll() 패턴.
      const all = raw.getAll();
      if (Array.isArray(all)) return all;
    }
    return [];
  }
}

// =============================================================================
// 글로벌 싱글톤 — 그래프 모드가 활성화된 동안 1개 연결 유지
// =============================================================================

let globalClient: LadybugClient | null = null;

/**
 * 싱글톤 반환. 첫 호출에서 connect() 가 실행되며, 실패하면 throw 후 다음 호출은 즉시
 * fail. mode='off' 인 경우 호출자가 본 함수를 부르지 않아야 — 호출 자체가 native
 * import 를 유발한다.
 */
export async function getLadybugClient(): Promise<LadybugClient> {
  if (!globalClient) {
    globalClient = new LadybugClient();
    await globalClient.connect();
  } else if (!globalClient.isReady()) {
    // 이전 실패 인스턴스가 캐시되어 있으면 즉시 같은 에러로 거절 — 무한 retry 방지.
    await globalClient.connect();
  }
  return globalClient;
}

/** 서버 shutdown 시 호출. 멱등. */
export function closeLadybugClient(): void {
  if (globalClient) {
    globalClient.close();
    globalClient = null;
  }
}
