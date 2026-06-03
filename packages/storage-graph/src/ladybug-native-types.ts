/**
 * ladybug-native-types.ts — Ladybug native binding 의 duck-typing 타입 표면
 *
 * 책임 (Single Responsibility):
 *   `client.ts` 가 `@ladybugdb/core` native 모듈을 lazy import 한 뒤 *실제로 접근하는*
 *   메서드/프로퍼티만을 좁게 추린 최소 인터페이스 모음. native 의존성을 import 하지
 *   않고도(설치 안 된 환경 포함) client 코드를 정밀하게 타입체크하기 위한 계약이다.
 *
 * 설계 결정 — 왜 `@ladybugdb/core` 의 실제 타입을 안 쓰고 직접 정의하는가:
 *   - native 패키지는 fork(LadybugDB / Bighorn 등) 마다 export 표면이 다르고, 일부
 *     빌드는 클래스를 `Ladybug` namespace 안에 넣는다. 어느 한 fork 의 d.ts 에 결합하면
 *     교체 시 client.ts 전체가 깨진다.
 *   - 따라서 *우리가 호출하는 부분*만 옵셔널 멤버로 흡수하는 구조적(structural) 계약을
 *     둔다. fork 별 차이는 `?` 옵셔널 / 유니온으로 표현하고, 런타임 분기(`?? fallback`)는
 *     client.ts 가 그대로 유지한다.
 *
 * 비범위:
 *   - native 가 제공하지만 client 가 쓰지 않는 API (트랜잭션 격리 수준, 백업 등) 는
 *     의도적으로 누락. 새 호출을 추가할 때만 본 파일에 멤버를 추가한다.
 *   - 런타임 값 검증은 하지 않는다 (타입 계약 전용). 실제 형태 불일치는 client 의
 *     런타임 분기(`Array.isArray` / `typeof === 'function'`)가 흡수한다.
 */

/**
 * Cypher 쿼리/실행이 반환하는 raw 결과의 가능한 형태들.
 *
 *   fork 마다 record 배열을 직접 주거나({@link Array}), `{ rows }` / `{ records }` 로
 *   감싸거나, lazy `getAll()` 을 가진 QueryResult 객체를 준다. `client.normalizeResult`
 *   가 이 4가지를 모두 수용하므로 입력 타입도 그에 맞춰 좁게 표현한다.
 *
 *   `unknown` 단일 타입이 아니라 유니온으로 둠으로써 normalizeResult 내부 분기가
 *   각 갈래에서 정밀한 좁혀짐(narrowing)을 받도록 한다. (주의: 유니온에 bare `unknown`
 *   을 넣으면 TS 가 전체를 `unknown` 으로 흡수하므로 넣지 않는다. fork 별 미지 형태는
 *   normalizeResult 의 object 가드 + 최종 `return []` 이 런타임에서 흡수한다.)
 */
export type LadybugRawResult =
  | Record<string, unknown>[]
  | { rows: Record<string, unknown>[] }
  | { records: Record<string, unknown>[] }
  | LadybugQueryResultObject;

/**
 * lazy `getAll()` 을 노출하는 QueryResult 형태 (Ladybug 0.16.x).
 *   `getAll()` 은 Promise 를 반환할 수도, 동기 배열을 반환할 수도 있어 둘 다 허용.
 */
export interface LadybugQueryResultObject {
  getAll(): Promise<Record<string, unknown>[]> | Record<string, unknown>[];
}

/**
 * prepare→execute 파라미터화 쿼리에서 prepare 가 돌려주는 statement 핸들.
 *   client 는 핸들 내부를 들여다보지 않고 그대로 `execute(stmt, params)` 에 넘기기만
 *   하므로 불투명(opaque) 토큰으로 둔다.
 */
export type LadybugPreparedStatement = unknown;

/**
 * native 가 만든 Connection 핸들 — client 가 호출하는 메서드만 추린 표면.
 *
 *   - `query(cypher)`            : 무파라미터 Cypher 실행.
 *   - `prepare(cypher)`          : 파라미터화 쿼리용 statement 준비.
 *   - `execute(stmt, params)`    : prepare 한 statement 를 params 와 실행.
 *   - `transaction(work)`        : (fork 옵셔널) 트랜잭션 래퍼. 없으면 client 가 work 직접 실행.
 *   - `close()`                  : (옵셔널) 연결 종료.
 *
 *   query/prepare/execute 결과를 client 가 `await` 하므로 Promise 또는 동기 반환 양쪽을
 *   허용한다. 반환 형태는 {@link LadybugRawResult} 로 normalizeResult 가 흡수.
 */
export interface LadybugConnectionHandle {
  query(cypher: string): Promise<LadybugRawResult> | LadybugRawResult;
  prepare(
    cypher: string,
  ): Promise<LadybugPreparedStatement> | LadybugPreparedStatement;
  execute(
    stmt: LadybugPreparedStatement,
    params: Record<string, unknown>,
  ): Promise<LadybugRawResult> | LadybugRawResult;
  transaction?<T>(work: () => Promise<T>): Promise<T> | T;
  close?(): void;
}

/**
 * native 가 만든 Database 핸들 — client 는 ConnectionCtor 인자로 넘기고 close 만 호출.
 *   내부 구조는 불투명. close 는 fork 에 따라 없을 수 있어 옵셔널.
 */
export interface LadybugDatabaseHandle {
  close?(): void;
}

/**
 * `new Database(path)` 생성자. path 만 인자로 받는다.
 */
export type LadybugDatabaseCtor = new (path: string) => LadybugDatabaseHandle;

/**
 * `new Connection(db)` 생성자. Database 핸들을 인자로 받는다.
 */
export type LadybugConnectionCtor = new (
  db: LadybugDatabaseHandle,
) => LadybugConnectionHandle;

/**
 * lazy import 로 받은 `@ladybugdb/core` 모듈의 표면.
 *
 *   client 는 Database/Connection 생성자를 최상위(`mod.Database`) 또는 namespace
 *   (`mod.Ladybug.Database`) 두 위치에서 찾는다. fork 마다 위치가 달라 둘 다 옵셔널로
 *   두고, client 의 `??` 폴백이 런타임에 실제 위치를 고른다.
 *
 *   index signature 를 둬서 `Object.keys(mod)` 진단 출력과, 정의에 없는 fork 별 추가
 *   export 접근을 타입 에러 없이 허용한다.
 */
export interface LadybugNativeModule {
  Database?: LadybugDatabaseCtor;
  Connection?: LadybugConnectionCtor;
  Ladybug?: {
    Database?: LadybugDatabaseCtor;
    Connection?: LadybugConnectionCtor;
  };
  default?: LadybugNativeModule;
  [key: string]: unknown;
}
