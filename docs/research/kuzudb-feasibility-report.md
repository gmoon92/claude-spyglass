# Spyglass Graph DB 도입 타당성 연구 보고서

> **목적**: 플로우 차트 및 관계 탐색 visualization 최적화를 위한 KuzuDB 도입 가능성 연구
> **범위**: Local-first Electron macOS 앱 기준
> **작성일**: 2026-05-25
> **아키텍처 전제**: SQLite = raw append log store, KuzuDB = graph projection/read model

---

## 1. 개요 및 요약

### 1.1 연구 결론

> **경고: KuzuDB는 Apple 인수(2025년 10월)로 GitHub/npm이 archived/deprecated 되어 유지보수가 종료되었습니다. 본 연구의 원래 전제(KuzuDB 도입)는 더 이상 유효하지 않습니다.**

**권장 방향: KuzuDB 대신 그 직접 포크인 LadybugDB를 검토하라.**

| 평가 항목 | KuzuDB | LadybugDB (대안) |
|---|---|---|
| 프로젝트 상태 | ❌ **Archived (2025.10)** | ✅ Active fork, Arun Sharma 관리 |
| 그래프 쿼리 성능 | 이론상 적합 | KuzuDB와 동일한 엔진 기반 |
| Electron/macOS 호환성 | Deprecated npm | `@ladybugdb/core` npm, Node-API v5, macOS Intel/ARM |
| SQLite 공존성 | CQRS 가능 | CQRS 가능 |
| 실사용 사례 | 없음 | Auto-Claude(Electron 앱) 실제 사용 |
| 운영 복잡도 | 단순 | 단순 |

**본 문서의 KuzuDB 관련 분석은 아키텍처 참고용으로 유지되나, 실제 도입은 LadybugDB로 대체해야 합니다.**

### 1.2 핵심 아키텍처

```
┌─────────────────────────────────────────────────────────────┐
│                      Command Side (SQLite)                   │
│  ┌─────────┐    ┌──────────┐    ┌──────────────────────┐   │
│  │  Hooks  │───▶│  SQLite  │───▶│  Append-only Logs    │   │
│  │ (write) │    │  (WAL)   │    │  sessions, requests  │   │
│  └─────────┘    └──────────┘    └──────────────────────┘   │
│         │                                                    │
│         │  워터마크 기반 Delta 감지                          │
│         ▼                                                    │
│  ┌──────────────────────────────────────────────────────┐   │
│  │              Projection Builder (Node.js)             │   │
│  │  ┌─────────────┐   ┌─────────────┐   ┌────────────┐  │   │
│  │  │ Delta Scan  │──▶│ Transform   │──▶│ Kuzu Write │  │   │
│  │  │ (watermark) │   │ (SQL→Graph) │   │ (COPY/CREATE)│  │   │
│  │  └─────────────┘   └─────────────┘   └────────────┘  │   │
│  └──────────────────────────────────────────────────────┘   │
│                             │                                │
│                             ▼                                │
│  ┌──────────────────────────────────────────────────────┐   │
│  │              Query Side (KuzuDB)                      │   │
│  │  ┌──────────┐    ┌──────────┐    ┌──────────────┐   │   │
│  │  │  Cypher  │───▶│  Graph   │───▶│  Visualization│   │   │
│  │  │  Queries │    │  Reads   │    │  (React Flow) │   │   │
│  │  └──────────┘    └──────────┘    └──────────────┘   │   │
│  └──────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
```

---

## 2. KuzuDB 개요 및 적합성 분석

> ⚠️ **2025년 10월 9일 Apple 인수 이후 KuzuDB 프로젝트는 완전히 종료되었습니다.**
> - GitHub `kuzudb/kuzu` archived (2025.10.10)
> - npm `kuzu` deprecated (2025.10.10)
> - 마지막 버전: 0.11.3
>
> **본 섹션의 아키텍처 분석은 참고용으로 유지되나, 실제 도입은 불가합니다. 대안은 13절을 참조하세요.**

### 2.1 KuzuDB 특성 (Archival)

KuzuDB는 **임베디드 그래프 데이터베이스**로, 다음 특성을 가졌었다.

| 특성 | 설명 | 현재 상태 |
|---|---|---|
| 임베디드 | 별도 서버 프로세스 불필요 | Archived |
| Cypher 지원 | `MATCH`, `CREATE`, `RETURN` 등 | Archived |
| Node.js API | `kuzu` npm 패키지 | **Deprecated** |
| 컬럼 기반 저장소 | DuckDB 유사 컬럼 스토어 | Archived |
| 단일 작가 제한 | 동시 쓰기 불가 | Archived |
| ACID 트랜잭션 | 기본 제공 | Archived |

### 2.2 종료 경위

- **2025년 10월 9일**: Apple Inc.가 KuzuDB 인수 (Kitchener-Waterloo, Canada 기업)
- **2025년 10월 10일**: GitHub 저장소 archived, npm 패키지 deprecated
- **2026년 2월**: EU Digital Markets Act 공시를 통해 인수 사실 공개
- **이후**: 오픈소스 유지보수 완전 종료

### 2.3 포크 및 대안 생태계

KuzuDB 종료 후 여러 커뮤니티 포크가 등장했다:

| 포크/대안 | 관리자 | 특성 | 상태 |
|---|---|---|---|
| **LadybugDB** | Arun Sharma (ex-Facebook, ex-Google) | Kuzu 직접 포크, Node-API v5, macOS Universal | ✅ **가장 활발** |
| **Vela-Engineering/kuzu** | Vela Partners | Concurrent multi-writer | ✅ AI 에이전트 특화 |
| **Grafeo** | 신규 (Rust) | 새로운 임베디드 그래프 DB | 초기 단계 |
| **FalkorDBLite** | FalkorDB | Embedded Redis 기반 | ⚠️ Dev/CI용 |
| **ArcadeDB** | ArcadeData | Apache 2.0, 멀티모델 | ✅ 활발 |

### 2.4 로컬 애널리틱스 적합성 (Archival)

KuzuDB의 아키텍처는 "단일 머신, 단일 사용자, 대량의 연결 관계 탐색" 워크로드에 최적화되어 있었다. Spyglass의 사용 패턴은 KuzuDB의 강점인 **인접성 기반 탐색(index-free adjacency)**과 일치했다. 이 아키텍처 특성은 LadybugDB에서 그대로 계승된다.

---

## 3. 그래프 스키마 제안

### 3.1 노드 테이블

```cypher
// Session 노드
CREATE NODE TABLE Session(
  id STRING, project_name STRING, started_at INT64,
  ended_at INT64, total_tokens INT64, live_state STRING,
  PRIMARY KEY (id)
);

// Turn 노드
CREATE NODE TABLE Turn(
  id STRING, turn_index INT64, started_at INT64,
  system_hash STRING, system_byte_size INT64,
  PRIMARY KEY (id)
);

// Request 노드 (다형성: prompt/tool_call/system/response)
CREATE NODE TABLE Request(
  id STRING, type STRING, timestamp INT64,
  tool_name STRING, model STRING, tokens_input INT64,
  tokens_output INT64, tokens_total INT64, duration_ms INT64,
  event_type STRING, preview STRING,
  PRIMARY KEY (id)
);

// Agent 노드
CREATE NODE TABLE Agent(
  id STRING, agent_type STRING,
  PRIMARY KEY (id)
);

// ToolCall 노드
CREATE NODE TABLE ToolCall(
  id STRING, tool_name STRING, tool_detail STRING,
  tokens_total INT64, duration_ms INT64,
  PRIMARY KEY (id)
);

// Event 노드
CREATE NODE TABLE Event(
  id STRING, event_type STRING, timestamp INT64,
  payload_size INT64,
  PRIMARY KEY (id)
);

// Badge 노드
CREATE NODE TABLE Badge(
  id STRING, badge_type STRING, value STRING,
  PRIMARY KEY (id)
);
```

### 3.2 관계 테이블

```cypher
// 계층/포함 관계
CREATE REL TABLE CONTAINS(FROM Session TO Turn);
CREATE REL TABLE HAS_REQUEST(FROM Turn TO Request);
CREATE REL TABLE TRIGGERED_BY(FROM Request TO ToolCall);
CREATE REL TABLE PARENT_OF(FROM ToolCall TO ToolCall);
CREATE REL TABLE EMITTED(FROM Request TO Event);
CREATE REL TABLE HAS_BADGE(FROM Turn TO Badge);

// 시간 순서 관계
CREATE REL TABLE NEXT_TURN(FROM Turn TO Turn);
CREATE REL TABLE PREV_TURN(FROM Turn TO Turn);

// 프록시 상관 관계
CREATE REL TABLE PROXIED_BY(FROM Request TO Request);
```

### 3.3 설계 근거

- **Turn을 일급 노드로**: 턴은 `NEXT_TURN`/`PREV_TURN`으로 연결되고 배지를 집계하는 핵심 단위
- **Request 다형성**: `type` 속성으로 구분, 하나의 노드 테이블로 통합하여 스키마 단순화
- **PARENT_OF**: `parent_tool_use_id` 계층을 직접 엣지로 표현하여 재귀 쿼리 불필요
- **PROXIED_BY**: `correlated_requests` VIEW의 휴리스틱을 직접 엣지로 대체

---

## 4. SQLite + KuzuDB 공존 전략

### 4.1 동기화 전략 비교

| 전략 | 장점 | 단점 | 평가 |
|---|---|---|---|
| 이벤트 기반 | 거의 실시간 | Kuzu 단일 writer 병목, hook 지연 추가 | ❌ 부적합 |
| 배치 동기화 | 단순, 예측 가능 | 약간의 데이터 시차 | ✅ 적합 |
| **Lazy Rebuild** | 쿼리 전까지 오버헤드 제로, 완전한 일관성 | 오랜 미사용 후 첫 쿼리 느림 | ✅ **최적** |

### 4.2 Lazy Batch Rebuild 메커니즘

```typescript
class GraphProjection {
  private watermark: number = 0;  // requests.id 기준

  async rebuildIfStale(): Promise<void> {
    const maxId = this.sqliteDb.query(
      "SELECT MAX(CAST(SUBSTR(id, 2) AS INTEGER)) as max FROM requests"
    ).get()?.max ?? 0;

    if (maxId <= this.watermark) return;  // 동기화 불필요

    // 1. Delta를 CSV로 내보내기
    const csvPath = await this.exportDeltaToCsv(this.watermark, maxId);

    // 2. Kuzu COPY FROM으로 벌크 삽입
    await this.kuzuConn.query(`COPY Request FROM '${csvPath}'`);

    // 3. Cypher로 관계 엣지 생성
    await this.kuzuConn.query(`
      MATCH (r:Request) WHERE r._delta = true
      WITH r
      MATCH (t:Turn {id: r.turn_id})
      CREATE (t)-[:HAS_REQUEST]->(r)
    `);

    this.watermark = maxId;
  }
}
```

### 4.3 워터마크 메커니즘

```typescript
interface SyncWatermark {
  lastRequestId: string;      // requests.id
  lastEventId: number;        // claude_events.id
  lastProxyId: number;        // proxy_requests.id
  checksum: string;           // 행 수 기반 SHA256
}
```

**동작 흐름**:
1. **감지**: `MAX(id)` vs 워터마크 비교
2. **내보내기**: SQLite `SELECT ... INTO CSV` (Delta 행만)
3. **가져오기**: Kuzu `COPY FROM` (노드), `CREATE` (관계)
4. **검증**: 행 수 일치 + 체크섬
5. **커밋**: 워터마크 파일 원자적 갱신

---

## 5. CQRS 프로젝션 아키텍처

### 5.1 명령(Command) 사이드 — 변경 없음

SQLite는 기존과 동일하게 append-only 로그 저장소로 작동한다. 모든 hook 쓰기, 마이그레이션, 인덱스는 그대로 유지된다.

### 5.2 조회(Query) 사이드 — KuzuDB 추가

| 쿼리 유형 | 저장소 | 이유 |
|---|---|---|
| 턴 목록, 통계, 이상 탐지 | SQLite | 집계 쿼리, 기존 인덱스 활용 |
| 플로우 차트, 이웃 확장, 경로 탐색 | **KuzuDB** | 그래프 탐색 최적화 |
| 메타 문서 사용량 | SQLite | `GROUP BY` 기반 집계 |
| 에이전트 실행 흐름 | **KuzuDB** | 재귀적 전개 최적화 |

### 5.3 프로젝션 빌더 위치

- **메인 프로세스**에서 실행 (렌더러 프로세스는 KuzuDB에 직접 접근하지 않음)
- **IPC**를 통해 렌더러가 Cypher 쿼리를 요청
- 빌드는 **백그라운드 스레드** 또는 **비동기 태스크**로 처리하여 UI 블로킹 방지

---

## 6. 쿼리 마이그레이션 예시

### 6.1 턴 체인 탐색

**SQLite (기존)**:
```sql
WITH RECURSIVE turn_chain AS (
  SELECT turn_id, started_at, 1 as depth
  FROM requests WHERE session_id = ? AND type = 'prompt'
  UNION ALL
  SELECT r.turn_id, r.started_at, tc.depth + 1
  FROM requests r
  JOIN turn_chain tc ON r.turn_id > tc.turn_id
  WHERE r.session_id = ? AND r.type = 'prompt'
)
SELECT * FROM turn_chain ORDER BY started_at;
```

**Cypher (KuzuDB)**:
```cypher
MATCH (s:Session {id: $sessionId})-[:CONTAINS]->(t:Turn)
RETURN t
ORDER BY t.started_at;

// 경로 기반 탐색
MATCH path = (s:Session)-[:CONTAINS]->(t1:Turn)-[:NEXT_TURN*]->(t2:Turn)
WHERE s.id = $sessionId
RETURN path;
```

### 6.2 에이전트 → 툴콜 → 이벤트 조인

**SQLite (기존)**:
```sql
SELECT r.*, e.event_type, e.payload
FROM requests r
LEFT JOIN claude_events e ON e.session_id = r.session_id
WHERE r.type = 'tool_call'
  AND r.agent_id IS NOT NULL
  AND r.session_id = ?;
```

**Cypher (KuzuDB)**:
```cypher
MATCH (s:Session {id: $sessionId})-[:CONTAINS]->(:Turn)-[:HAS_REQUEST]->(req:Request)
WHERE req.type = 'tool_call' AND req.agent_id IS NOT NULL
MATCH (req)-[:TRIGGERED_BY]->(tc:ToolCall)
OPTIONAL MATCH (req)-[:EMITTED]->(e:Event)
RETURN req, tc, e;
```

### 6.3 턴별 배지 집계

**SQLite (기존)**:
```sql
SELECT turn_id,
       COUNT(DISTINCT tool_name) as tool_variety,
       SUM(tokens_total) as turn_total,
       SUM(CASE WHEN cache_read_tokens > 0 THEN 1 ELSE 0 END) as cache_hits
FROM requests
WHERE session_id = ? AND turn_id IS NOT NULL
GROUP BY turn_id;
```

**Cypher (KuzuDB)**:
```cypher
MATCH (s:Session {id: $sessionId})-[:CONTAINS]->(t:Turn)-[:HAS_REQUEST]->(r:Request)
RETURN t.id AS turn_id,
       COUNT(DISTINCT r.tool_name) AS tool_variety,
       SUM(r.tokens_total) AS turn_total,
       SUM(CASE WHEN r.cache_read_tokens > 0 THEN 1 ELSE 0 END) AS cache_hits;
```

---

## 7. 성능 및 복잡도 비교

### 7.1 복잡도 비교표

| 패턴 | SQLite 복잡도 | KuzuDB 복잡도 | 예상 개선 |
|---|---|---|---|
| 단일 노드 조회 | O(log n) B-tree | O(1) 직접 접근 | 2~5배 |
| 1-hop 이웃 (자식) | O(log n) + 필터 | O(k), k=차수 | 10~20배 |
| 경로 탐색 (깊이 d) | O(n × d) 재귀 CTE | O(d × 평균차수) | 50~100배 |
| 역방향 탐색 | O(n) 풀스캔 | O(k) 역엣지 | 10~20배 |
| 서브트리 집계 | O(n log n) GROUP BY | O(서브트리 크기) | 20~40배 |
| BFS 전면 확장 | O(전면 × 왕복) | O(전면) 단일 쿼리 | 30~80배 |
| 다중 홉 필터 경로 | O(n²) 조인 폭발 | O(d × 평균차수) WCOJ | 100~374배 |
| 시간 범위 + 조인 | O(n log n) 복합 인덱스 | O(결과집합) 벡터화 | 5~15배 |

### 7.2 주요 쿼리 성능 예상

| 사용 사례 | SQLite 현재 | KuzuDB 예상 | 개선율 |
|---|---|---|---|
| `getTurnsBySession` (5K req) | p95 ~229ms | ~20-40ms | **6-12배** |
| `detectAgentSpike` 단일 (깊이 3) | ~5-15ms | ~0.5-2ms | **5-10배** |
| `detectAgentSpikeBatch` (200 부모) | ~20-50ms | ~2-5ms | **10-20배** |
| `getMetaFlowEgo` BFS (깊이 3) | ~100-300ms | ~5-15ms | **20-60배** |
| 이웃 확장 (1-hop) | ~2-5ms | ~0.1-0.3ms | **10-50배** |

### 7.3 메모리/런타임 트레이드오프

| 차원 | SQLite | KuzuDB |
|---|---|---|
| 쿼리 메모리 | 낮음 — 행 스트리밍 | 중간 — 팩터라이즈 벡터 + 인접 리스트 |
| 유휴 메모리 | ~5-20MB (페이지 캐시) | ~30-100MB (컬럼 + 인접) |
| 디스크 크기 | 1x (기준) | ~1.5-2.5x (노드/엣지 저장소) |
| 쓰기 오버헤드 | 최소 (단일 WAL 추가) | 동기화 비용 발생 |
| 쿼리 CPU | 중간 (B-tree + 정렬) | 낮음 (벡터화 SIMD) |
| 콜드 스타트 | 즉시 | ~100-500ms (컬럼 스토어 mmap) |

**판결**: 단일 사용자 Electron 환경, 1M 이하 요소에서 KuzuDB의 유휴 메모리 오버헤드(~50MB)는 현대 데스크톱에서 수용 가능하다. 동기화 쓰기 페널티가 주요 우려사항이다.

### 7.4 캐싱 전략

| 캐시 키 | TTL | 비고 |
|---|---|---|
| `turns:{sessionId}` | 5초 / 무효화 | `getTurnsBySession` 가장 무거운 경로 |
| `ego:{centerType}:{centerName}:{project}:{window}` | 30초 | BFS 결과 윈도우 내 안정적 |
| `agent_spike_batch:{pageHash}` | 계산당 1회 | 이미 배치됨 |
| `meta_doc_usage:{project}:{range}` | 60초 | 대량 GROUP BY 반복 |
| `session_anomaly:{sessionId}` | 10초 | `summarizeSessionAnomalies` 경량 |

**무효화 트리거**: `requests`/`proxy_requests`/`claude_events` INSERT 시 해당 `session_id` 관련 캐시 무효화.

---

## 8. Electron 통합 전략

### 8.1 KuzuDB Node.js 바인딩

- **npm 패키지**: `kuzu` — 공식 제공 (MIT 라이선스)
- **Node.js API 문서**: [kuzudb.github.io/api-docs/nodejs](https://kuzudb.github.io/api-docs/nodejs/) 공식 제공
- **Browser UI**: `kuzudb/explorer` — 웹 기반 탐색기 존재 (웹 환경 호환성 입증)
- **MCP Server**: `kuzudb-mcp-server` — AI 에이전트 생태계 지원

### 8.2 Prebuilt 바이너리 전략

Kuzu는 `prebuildify` 방식을 채택하여 **모든 플랫폼의 prebuilt 바이너리를 npm 패키지에 직접 포함**한다. 별도 다운로드 단계 없이 설치 시점에 플랫폼에 맞는 `.node` 파일을 선택한다.

```
kuzujs-${platform}-${arch}.node
```

| 플랫폼 | 아키텍처 | 상태 |
|---|---|---|
| macOS Apple Silicon | arm64 (Sequoia, Sonoma, Ventura) | ✅ 지원 |
| macOS Intel | x64 (Sonoma) | ✅ 지원 |
| Linux | ARM64 / x86_64 | ✅ 지원 |

⚠️ **중요**: Kuzu는 N-API/Node-API를 명시적으로 사용하지 않고 직접 Node.js native addon을 사용하므로, Electron의 Node.js ABI와 맞춤 rebuild가 필요할 수 있다.

### 8.3 Electron 네이티브 모듈 호환성

| 항목 | 상태 | 비고 |
|---|---|---|
| 네이티브 애드온 | 필요 | `kuzu`는 C++ 기반 네이티브 모듈 |
| `electron-rebuild` | **필요** | Electron ABI 맞춤 rebuild 권장 |
| Prebuilt 바이너리 | 패키지 내 포함 | `prebuildify` 방식, 플랫폼 자동 선택 |
| Electron-specific prebuild | **미문서화** | 공식 Electron prebuild 제공 여부 불명확 |
| V8/ABI 호환성 | 주의 | Electron 메이저 업그레이드 시 rebuild 필요 |
| macOS Intel 이슈 | **보고됨** | GitNexus 프로젝트에서 설치 실패 → `kuzu@0.11.3` downgrade workaround |

**macOS Intel 사용자 이슈**: 일부 프로젝트(GitNexus)에서 macOS Intel(x64) 환경에서 prebuilt 바이너리 누락으로 설치 실패가 보고되었다. 현재 버전(0.11.3)에서는 해소되었으나, **패키징 테스트 시 Intel Mac 반드시 포함**해야 한다.

### 8.3 프로세스 아키텍처 권장안

```
┌──────────────────────────────────────────┐
│          Renderer Process                │
│  ┌─────────────┐    ┌─────────────────┐ │
│  │  React Flow │◄───│  Graph IPC API  │ │
│  │  (UI)       │    │  (contextBridge)│ │
│  └─────────────┘    └─────────────────┘ │
└──────────────────┬───────────────────────┘
                   │ IPC invoke
┌──────────────────┼───────────────────────┐
│          Main Process                    │
│  ┌───────────────┼─────────────────────┐ │
│  │  ┌────────────▼────────────┐        │ │
│  │  │   KuzuDB Connection     │        │ │
│  │  │   (in-process)          │        │ │
│  │  └─────────────────────────┘        │ │
│  │  ┌─────────────────────────┐        │ │
│  │  │   Projection Builder    │        │ │
│  │  │   (async rebuild)       │        │ │
│  │  └─────────────────────────┘        │ │
│  │  ┌─────────────────────────┐        │ │
│  │  │   SQLite (better-sqlite3)│       │ │
│  │  └─────────────────────────┘        │ │
│  └─────────────────────────────────────┘ │
└──────────────────────────────────────────┘
```

- **KuzuDB는 메인 프로세스에서만 실행**
- 렌더러는 `contextBridge`를 통한 IPC로 쿼리
- 메모리 오버헤드는 메인 프로세스에 집중되나, 단일 사용자 앱에서는 수용 가능

### 8.4 소스 빌드 폴백

Prebuilt 바이너리가 없는 플랫폼에서는 설치 시점에 **소스에서 자동 빌드**된다.

| 도구 | 최소 버전 |
|---|---|
| CMake | ≥ 3.15 |
| Python | 3.x |
| C++ 컴파일러 | C++20 호환 |

Spyglass는 macOS 전용이므로 prebuilt 사용이 기본이나, 개발 환경 또는 향후 아키텍처 확장 시 소스 빌드 가능성을 염두에 둬야 한다.

### 8.5 macOS 패키징 및 코드 서명

| 항목 | 영향 | 완화책 |
|---|---|---|
| 앱 번들 크기 | +20MB (네이티브 바이너리) | 선택적 기능 플래그로 분리 |
| 코드 서명 | 네이티브 바이너리 포함 시 서명 대상 증가 | Kuzu 공식 바이너리가 이미 서명되어 있으면 간소화 |
| 낫라이제이션 | Apple notarization 대상 증가 | 빌드 파이프라인에서 자동 처리 |
| Universal Binary | arm64 + x64 병합 시 `lipo` 수동 결합 필요 | `electron-builder`의 `universal` 옵션 활용 |

### 8.6 Electron 통합 체크리스트

- [ ] `npm install kuzu` 후 `npm run electron:build` 성공 확인
- [ ] `electron-rebuild`로 ABI 호환성 rebuild 테스트
- [ ] macOS Apple Silicon (arm64) 설치/실행 확인
- [ ] macOS Intel (x64) 설치/실행 확인
- [ ] 패키징 후 `.app` 번들 내 `kuzujs-darwin-*.node` 포함 확인
- [ ] 코드 서명 및 notarization 통과 확인

### 8.5 앱 라이프사이클 통합

- **초기화**: 첫 그래프 쿼리 시점에 Lazy 초기화 (부팅 시 지연 없음)
- **종료**: KuzuDB 연결 정상 종료 (파일 손상 방지)
- **복구**: KuzuDB 파일 손상 시 자동 재빌드 (SQLite는 그대로 유지)

---

## 9. React Flow 통합 제안

### 9.1 IPC 레이어 설계

```typescript
// preload.ts
contextBridge.exposeInMainWorld('graphAPI', {
  query: (cypher: string, params: Record<string, unknown>) =>
    ipcRenderer.invoke('kuzu:query', { cypher, params }),
  subscribe: (sessionId: string, cb: (delta: GraphDelta) => void) =>
    ipcRenderer.on(`kuzu:sync:${sessionId}`, (_e, delta) => cb(delta)),
});
```

**쿼리 파라미터화**:
- `expand(nodeId, type, limit, cursor?)` — 이웃 BFS + 페이지네이션
- `subgraph(rootId, depth, viewport?)` — 뷰포트 제한 초기 로드
- `path(fromId, toId)` — 최단 경로 (애니메이션용)

### 9.2 점진적 노드 확장 상태 머신

```
[Idle] --클릭--> [Fetching] --성공--> [Expanded]
                      |                    |
                   오류                  |
                      |                    |
                   [Idle] <--- 축소 ------+
```

- **중복 방지**: `nodeMap: Map<string, Node>` + `edgeMap: Map<string, Edge>`
- **재확장 방지**: `expandedSet: Set<string>` — 재클릭 시 새로고침만 수행
- **원자적 갱신**: 단일 `setNodes`/`setEdges` 호출로 배치 처리

### 9.3 지연 그래프 로딩

| 전략 | 구현 |
|---|---|
| 깊이 제한 시드 | 초기 로드는 선택 세션 노드로부터 깊이=2만 |
| 뷰포트 컬링 | `onlyRenderVisibleElements={true}`로 오프스크린 DOM 제거 |
| 공간 페이지네이션 | `onMoveEnd` 시 뷰포트 bbox 계산, 버퍼 1.5배 영역만 쿼리 |
| 대형 이웃 제한 | 100개 이상 자식 시 커서 기반 페이지네이션 (`LIMIT 50` + `SKIP`) + "더 보기" 고스트 노드 |

### 9.4 React Flow 성능 최적화 체크리스트

- [ ] **배칭**: 단일 확장의 모든 노드/엣지를 한 번의 상태 갱신으로 묶음
- [ ] **`onlyRenderVisibleElements`**: 200노드 이상 시 활성화
- [ ] **커스텀 노드 타입**:
  - `turnNode` — 턴 번호 배지
  - `agentNode` — 에이전트 아이콘
  - `toolCallNode` — 도구 이름 칩
  - `eventNode` — 점/배지 하이브리드
  - `badgeNode` — 상태 표시 (성공/실패/중단)
- [ ] **엣지 라우팅**:
  - 시간 순서: `type: 'smoothstep'`, `animated: true`
  - 포함 관계: `type: 'default'`, `strokeDasharray: '4 2'`
- [ ] **메모이제이션**: 커스텀 노드를 `React.memo`로 래핑

### 9.5 캐싱 전략

| 계층 | 대상 | 무효화 | 한계 |
|---|---|---|---|
| 인메모리 그래프 캐시 | `Map<nodeId, NodeData>` | SSE `new_request` 또는 `session_update` | LRU, 최대 10,000 노드 |
| 확장 상태 | `Set<expandedNodeIds>` | 세션 전환 시 초기화 | — |
| 쿼리 결과 캐시 | `hash(cypher + params)` | TTL 60초 또는 동기화 시 즉시 | 최대 100개 |
| 뷰포트 공간 인덱스 | R-tree | 매 fetch 후 재구축 | 메모리 전용 |

**메모리 압력 처리**: 10,000노드 초과 시 `lastViewportTime` 기준 LRU 제거. 제거된 노드는 "로드" 플레이스홀더로 축소.

### 9.6 애니메이션 탐색 UX

- **확장 피드백**: 신규 노드 200ms `opacity 0→1`, `scale 0.8→1` 전환
- **경로 하이라이트**: 선택된 실행 경로의 엣지를 `stroke: var(--accent)` + `strokeWidth: 2.5`로 강조
- **시간 재생**: 스크러버 컴포넌트가 `turnIndex`를 0→N 순회. `turnNumber <= currentTurn`인 노드만 표시, 나머지는 `opacity: 0.25`로 흐림. `requestAnimationFrame`으로 60fps 스크러빙.

---

## 10. 마이그레이션 전략 및 리스크 분석

### 10.1 마이그레이션 단계

| 단계 | 내용 | 종료 기준 |
|---|---|---|
| **P0: Foundation** | KuzuDB를 dev-only 의존성으로 추가; 그래프 스키마 DDL 작성; 프로젝션 빌더 스크립트 작성 | `bun test` 통과; 샘플 SQLite DB로부터 유효한 `.kuzu` 파일 생성 |
| **P1: Shadow Mode** | 세션 종료마다 Kuzu 프로젝션 빌드; ego-graph 쿼리를 SQLite와 Kuzu 양쪽에서 실행하여 결과를 조용히 비교 | 7일 섀도우 기간 동안 100% 결과 일치; 프로덕션 로그에서 Kuzu 크래시 0건 |
| **P2: Opt-in Read** | `settings.experimental.kuzuGraph` 토글 뒤에 Kuzu ego-graph 게이트; SQLite는 폰백으로 유지 | 5명 이상 난뎃 사용자가 문제 없이 활성화; 응답 시간 p95 < 150ms (SQLite p95는 ~229ms) |
| **P3: Default On** | 그래프 뷰의 기본값을 Kuzu로 전환; SQLite는 토글로 긴급 폰백 유지 | 30일 안정성; SQLite로의 롤백이 5초 이내에 작동 |

**단계 간 이동 조건**: 각 단계의 종료 기준을 충족한 후에만 다음 단계로 진행. 언제든 이전 단계로 롤백 가능.
### 10.2 프로젝션 빌드 전략

**권장: On-Demand Full Rebuild**

사용자가 Meta-Docs [Flow] 탭을 열 때 Lazy로 전체 재빌드를 수행한다. 쓰기 시점이 아닌 **조회 시점**에 빌드한다.

**근거:**
- Spyglass 데이터는 append-only 실행 로그 (sessions, requests, proxy_requests). 기존 행에 대한 갱신/삭제가 없다.
- ego-graph BFS (`getMetaFlowEgo`)가 유일한 그래프 집중 워크로드이다. 깊이 32까지의 `parent_tool_use_id` 체인을 탐색하며, 현재는 4회 이상의 재귀 SQL + 청크 IN 절(BFS_FRONTIER_CHUNK = 800)이 필요하다.
- 대형 세션(5K requests)의 전체 재빌드도 Kuzu에서 2초 미만 — 그래프 DB가 이 탐색 패턴에 최적화되어 있다.
- Delta 동기화는 복잡도(마지막 동기화 시점 추적, 순서가 맞지 않는 proxy_requests 처리)에 비해 이득이 적다. 그래프 뷰는 명시적 사용자 상호작용에서만 렌더링된다.

**구현:** `KuzuProjectionBuilder` 클래스
1. `requests` 행을 `ACTIVE_REQUEST_FILTER_SQL`로 필터링 (시간 윈도우)
2. 노드 생성: `(Turn {id})`, `(MetaDoc {kind, name})`, `(McpTool {name})`
3. 엣지 생성: `(MetaDoc)-[:CALLS {turn_id}]->(MetaDoc)`, `(Turn)-[:CONTAINS]->(MetaDoc)`
4. `.kuzu` 파일을 `spyglass.db` 옆에 저장 (`~/.spyglass/spygraph.kuzu`)

| 전략 | 설명 | 권장 시점 |
|---|---|---|
| **On-Demand Full Rebuild** | 사용자가 그래프 뷰 열 때 전체 재빌드 | **일반적 운영** |
| Delta 동기화 | 워터마크 이후 변경분만 동기화 | 고빈도 그래프 조회 시 |
| 전체 재빌드 (강제) | KuzuDB 초기화 → SQLite 전체 재생 | 스키마 버전 변경 시 |

### 10.3 장애 복구

**복구 흐름:**

```
[Kuzu 쿼리 실패 또는 예외 발생]
        |
        v
[routes/meta-docs.ts에서 Catch]
        |
        v
[sessionId + centerName으로 오류 로깅]
        |
        v
[SQLite 폰백 결과 응답]
        |
        v
[백그라운드: 60초 후 재빌드 예약]
        |
        v
[재빌드 3회 실패 → 해당 세션 Kuzu 비활성화]
        |
        v
[사용자가 설정에서 "그래프 DB 사용" 체크 해제 가능]
        |
        v
[체크 해제 → spygraph.kuzu 삭제 → 순수 SQLite 모드]
```

| 시나리오 | 복구 동작 |
|---|---|
| KuzuDB 파일 손상 | `CALL dbmeta('version')` 검증 실패 시 자동 삭제 → 재빌드 트리거 |
| 동기화 불일치 | 체크섬 mismatch 시 전체 재빌드 |
| 네이티브 모듈 로드 실패 | `require('kuzu')` 실패 시 SQLite 단독 모드로 우아한 퇴화 |
| 앱 크래시 | 다음 실행 시 워터마크 검증 → 필요 시 재빌드 |
| 메모리 부족 (대형 세션) | 기본 30일 윈도우 제한; 행을 1K 청크로 스트리밍 |
| 결과 불일치 (Shadow Mode) | CI에서 golden snapshot 비교; 불일치 시 Kuzu 경로 차단 |

**원자적 쓰기:**
- 재빌드 시 `.kuzu.tmp`에 먼저 작성 → 검증 완료 후 `rename`으로 교체
- 중간에 크래시가 나도 `.kuzu.tmp`만 남고 기존 파일은 손상되지 않음

### 10.4 데이터 일관성

- SQLite는 **유일한 진실 공급원(SSoT)**으로 유지
- KuzuDB는 **재생산 가능한 프로젝션** (삭제 후 재빌드 가능)
- SQLite 스키마 변경 시 KuzuDB는 **전체 재빌드** (스키마 버전 불일치 감지)
- `PROJECTION_VERSION` 파일로 SQLite 스키마 버전 추적

### 10.5 하위 호환성

- KuzuDB 없는 구버전 앱도 SQLite만으로 정상 동작
- KuzuDB 파일은 `.gitignore` 대상, 삭제해도 데이터 손실 없음
- SQLite 스키마 변경 불필요

### 10.6 리스크 매트릭스

| 리스크 | 가능성 | 영향 | 완화책 |
|---|---|---|---|
| KuzuDB 네이티브 모듈 로드 실패 | 중간 | 높음 | SQLite 폴백, 기능 플래그 |
| 프로젝션 동기화 불일치 | 낮음 | 중간 | 체크섬 검증, 자동 재빌드 |
| **Electron ABI rebuild 실패** | **중간** | **높음** | `electron-rebuild` CI 테스트, 버전 핀 |
| **macOS Intel prebuilt 누락** | **낮음** | **높음** | `kuzu@0.11.3` 고정, Intel Mac CI 필수 |
| **소스 빌드 의존성 누락** | **낮음** | **중간** | 개발 문서에 CMake/Python 필수 명시 |
| KuzuDB 단일 writer 병목 | 중간 | 중간 | 배치 + Lazy rebuild, 실시간 동기화 회피 |
| 시작 시간 증가 | 중간 | 중간 | Lazy 빌드 |
| 앱 번들 크기 증가 | 높음 | 낮음 | 예상된 비용, 선택적 기능 |
| macOS 코드 서명 이슈 | 낮음 | 높음 | 초기 테스트, 프리빌트 바이너리 사용 |
| 메모리 사용량 증가 | 중간 | 낮음 | ~50MB 추가, 현대 데스크톱 수용 가능 |

### 10.7 최소 실행 가능 마이그레이션(MVP)

**범위:** 오직 `getMetaFlowEgo`의 ego-graph BFS만 이관. 나머지 쿼리(턴 집계, 통계, 카탈로그 목록)는 SQLite 그대로 유지.

**핵심 파일:**
- `packages/storage/src/queries/meta-document.ts` — ego-graph BFS 원본
- `packages/server/src/routes/meta-docs.ts` — Kuzu 게이트 라우터
- `packages/storage/src/connection.ts` — Kuzu 연결 관리
- `packages/storage/src/queries/request/read.ts` — `ACTIVE_REQUEST_FILTER_SQL` SSoT

1. **KuzuDB 설치**: `npm install kuzu`
2. **Electron rebuild 검증**: `electron-rebuild`로 macOS arm64/x64 빌드 확인
3. **스키마 정의**: 노드/관계 테이블 CREATE
4. **빌더 구현**: Delta scan → CSV → COPY FROM
5. **단일 쿼리 이관**: `getMetaFlowEgo` 또는 이웃 확장 1개
6. **폰백 구현**: KuzuDB 실패 시 기존 SQLite 쿼리로 대체
7. **기능 플래그**: `settings.json`의 `enableGraphProjection` 추가
8. **CI 통합**: GitHub Actions에서 `npm install kuzu` + `electron:build` 성공 확인

**통합 테스트:** 픽스처 DB로부터 프로젝션 빌드 → Kuzu ego 쿼리 실행 → SQLite 결과와 노드 수 일치 검증.

**롤백:** `~/.spyglass/spygraph.kuzu` 삭제 및 플래그 해제. SQLite 코드는 전혀 건드리지 않음.
---

## 11. 최종 권장 아키텍처

### 11.1 권장 구조

```
┌─────────────────────────────────────────────────────────────┐
│                    Electron Main Process                     │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────┐│
│  │  SQLite     │  │ Projection  │  │  KuzuDB             ││
│  │  (SSoT)     │  │  Builder    │  │  (Read Model)       ││
│  │  WAL mode   │  │  (lazy)     │  │  columnar + graph   ││
│  └─────────────┘  └─────────────┘  └─────────────────────┘│
│         ▲                │                    ▲             │
│         │                │ Delta sync         │ Cypher      │
│         │                ▼                    │ queries     │
│  ┌──────┴────────────────────────────────────┴──────┐      │
│  │              IPC (contextBridge)                  │      │
│  └──────────────────────────────────────────────────┘      │
│                         ▲                                  │
└─────────────────────────┼──────────────────────────────────┘
                          │
┌─────────────────────────┼──────────────────────────────────┐
│                    Renderer Process                          │
│  ┌──────────────────────┼──────────────────────────────┐   │
│  │  ┌───────────────────┘                              │   │
│  │  │  React Flow                                       │   │
│  │  │  - Incremental expansion                          │   │
│  │  │  - Viewport culling                               │   │
│  │  │  - Temporal playback                              │   │
│  │  └──────────────────────────────────────────────────┘   │
│  └─────────────────────────────────────────────────────────┘
```

### 11.2 핵심 원칙

1. **SQLite는 절대 대체되지 않는다** — 쓰기, 집계, 하위 호환성 모두 SQLite가 담당
2. **KuzuDB은 읽기 전용 프로젝션** — 삭제 후 언제든 재빌드 가능
3. **Lazy Batch Rebuild** — 실시간 동기화가 아닌, 쿼리 직전에 Delta 감지 및 동기화
4. **메인 프로세스 고립** — 렌더러는 IPC만, KuzuDB는 메인에서만 실행
5. **기능 플래그** — `enableGraphProjection`으로 롤백 가능

### 11.3 예상 효과

| 지표 | 현재 (SQLite) | 예상 (KuzuDB) | 개선 |
|---|---|---|---|
| 이웃 확장 응답 | 2-5ms | 0.1-0.3ms | **10-50배** |
| 플로우 차트 로드 | 100-300ms | 5-15ms | **20-60배** |
| 턴 체인 탐색 | 229ms (p95) | 20-40ms | **6-12배** |
| 대화형 UX | 경미한 지연 | 즉각적 (<100ms) | **지각 개선** |

### 11.4 과도기적 설계 경계

다음은 **의도적으로 피할** 설계다:

- ❌ 이벤트 기반 실시간 동기화 (Kafka, Redis, WebSocket)
- ❌ 분산 트랜잭션 (2PC, Saga)
- ❌ 블루/그린 배포, 카나리 (단일 사용자 앱)
- ❌ KuzuDB를 쓰기 저장소로 사용
- ❌ 원격 서버 기반 그래프 DB (Neo4j, Neptune)

---

## 12. 부록

### A. 참고 자료

- [KuzuDB GitHub](https://github.com/kuzudb/kuzu)
- [KuzuDB Node.js API 문서](https://kuzudb.github.io/api-docs/nodejs/)
- [KuzuDB Explorer (Browser UI)](https://github.com/kuzudb/explorer)
- [Embedded DB 비교 — The Data Quarry](https://thedataquarry.com/blog/embedded-db-2)
- [KuzuDB vs Neo4j 벤치마크 — Vela Partners](https://vela.partners/blog/kuzudb-ai-agent-memory-graph-database)
- [KuzuDB Study — GitHub](https://github.com/prrao87/kuzudb-study)
- [KuzuDB Transactions 이슈](https://github.com/kuzudb/kuzu/issues/2529)
- [KuzuDB Bulk Loading 이슈](https://github.com/kuzudb/kuzu/issues/2739)

### B. 용어 정리

| 용어 | 설명 |
|---|---|
| CQRS | Command Query Responsibility Segregation — 명령과 조회의 책임 분리 |
| WCOJ | Worst-Case Optimal Join — 최악 경우에도 최적인 조인 알고리즘 |
| SSoT | Single Source of Truth — 유일한 진실 공급원 |
| Lazy Rebuild | 필요 시점까지 재구축을 미루는 전략 |
| Watermark | 동기화 시점을 표시하는 기준점 |
| Index-free adjacency | 인접 노드를 포인터로 직접 참조하는 그래프 저장 방식 |

### C. 문서 변경 이력

| 날짜 | 버전 | 변경 내용 |
|---|---|---|
| 2026-05-25 | 1.0 | 초안 작성 (5개 Sub-Agent 병렬 연구 결과 통합) |
---

## 13. 대안 분석: LadybugDB (권장)

> KuzuDB가 종료된 상황에서, **LadybugDB**가 가장 현실적인 대안이다.

### 13.1 LadybugDB 개요

LadybugDB는 KuzuDB의 **직접 커뮤니티 포크**로, Kuzu의 아키텍처와 API를 그대로 계승하면서 활발히 유지보수되고 있다.

| 항목 | 내용 |
|---|---|
| **원본** | KuzuDB 직접 포크 |
| **관리자** | Arun Sharma (ex-Facebook, ex-Google) |
| **라이선스** | MIT |
| **npm** | `@ladybugdb/core` |
| **API** | Node-API v5 (N-API 기반, ABI 안정성) |
| **macOS** | Intel + Apple Silicon Universal 지원 |
| **Homebrew** | `brew install ladybug` |

### 13.2 Electron/macOS 적합성

| 항목 | 상태 | 비고 |
|---|---|---|
| npm 패키지 | ✅ `@ladybugdb/core` | Active, Node-API v5 |
| Prebuilt 바이너리 | ✅ macOS Universal | arm64 + x64 |
| Electron ABI | ✅ N-API 기반 | `electron-rebuild` 불필요할 가능성 높음 |
| Native addon | ✅ C++ 기반 | Kuzu와 동일한 구조 |
| 실사용 사례 | ✅ **Auto-Claude** | Electron 기반 데스크톱 앱, LadybugDB 사용 중 |

**Auto-Claude 사례**:
- Electron + TypeScript 프론트엔드 + Python 백엔드
- Docker 기반 FalkorDB에서 **embedded LadybugDB**로 마이그레이션 (v2.7.2, 2026년 1월)
- Windows, macOS(Intel/ARM), Linux 크로스플랫폼

### 13.3 KuzuDB와의 호환성

LadybugDB는 KuzuDB의 Cypher 스키마와 쿼리를 **대부분 호환**한다.

```cypher
-- KuzuDB와 동일한 스키마 정의
CREATE NODE TABLE Session(id STRING, PRIMARY KEY (id));
CREATE REL TABLE CONTAINS(FROM Session TO Turn);
```

따라서 본 문서의 **3절(그래프 스키마)**, **4절(공존 전략)**, **6절(쿼리 마이그레이션)**, **7절(성능 비교)**는 LadybugDB에도 그대로 적용 가능하다.

### 13.4 마이그레이션 변경점 (KuzuDB → LadybugDB)

| 항목 | KuzuDB (Archival) | LadybugDB (권장) |
|---|---|---|
| 설치 | `npm install kuzu` (deprecated) | `npm install @ladybugdb/core` |
| import | `const kuzu = require('kuzu')` | `const ladybug = require('@ladybugdb/core')` |
| 클래스명 | `kuzu.Database` | `ladybug.Database` (추정) |
| Cypher | 동일 | 동일 |
| 스키마 | 동일 | 동일 |
| Electron | `electron-rebuild` 필요 | N-API v5로 rebuild 불필요 가능 |
| macOS Intel | prebuilt 누락 이슈 보고 | Universal 바이너리 제공 |

### 13.5 다른 대안 비교

| 대안 | 라이선스 | 특성 | 평가 |
|---|---|---|---|
| **LadybugDB** | MIT | Kuzu 직접 포크, N-API, macOS Universal, Auto-Claude 사용 | ✅ **1순위** |
| **Vela-Engineering/kuzu** | — | Concurrent multi-writer, AI 에이전트 특화 | ✅ 2순위 (멀티 에이전트 시) |
| **FalkorDBLite** | — | Embedded Redis 기반, `falkordblite` npm | ⚠️ 3순위 (프로토타입용) |
| **ArcadeDB** | Apache 2.0 | 멀티모델(그래프+문서+키밸류) | ⚠️ 4순위 (학습 곡선) |
| **Grafeo** | — | Rust 기반 신규 | ❌ 아직 시기상조 |

### 13.6 최종 권장

1. **KuzuDB 도입은 불가** — archived/deprecated
2. **LadybugDB로 전환** — `@ladybugdb/core` npm 설치, Kuzu 스키마/Cypher 그대로 재사용
3. **Electron 통합** — N-API v5 기반으로 rebuild 리스크 대폭 감소, Auto-Claude 사례 참조
4. **아키텍처** — 본 문서의 CQRS 프로젝션, Lazy Rebuild, React Flow 통합 전략은 그대로 유효

