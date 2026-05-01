# 훅 방식 vs 프록시 방식 — 옵저빌리티 데이터 수집 비교 분석

> 작성일: 2026-05-01  
> 목적: claude-spyglass(훅 기반)와 ccflare(프록시 기반)의 데이터 수집 방식 비교, 하이브리드 통합 가능성 검토

---

## 1. 배경

claude-spyglass는 Claude Code 훅(hook) 이벤트를 통해 세션/툴 호출/프롬프트 데이터를 수집하는 옵저빌리티 프로젝트다. ccflare는 Anthropic API 앞에 HTTP 프록시를 두어 멀티 OAuth 계정 부하분산을 수행하면서 요청/응답 메트릭을 수집한다.

두 방식은 **수집 레이어가 다르다** — 훅은 Claude Code의 의미(semantic) 레이어, 프록시는 HTTP 전송(transport) 레이어. 서로가 볼 수 없는 데이터를 각각 수집한다.

---

## 2. 수집 경로 비교

### 훅 방식 (claude-spyglass)

```
사용자 입력
    ↓
Claude Code (내부 동작)
    ↓ hooks (UserPromptSubmit / PreToolUse / PostToolUse / SessionStart 등)
spyglass-collect.sh (stdin으로 raw payload 수신)
    ↓ HTTP POST
/collect 또는 /events 엔드포인트
    ↓
SQLite (sessions / requests / claude_events 테이블)
```

### 프록시 방식 (ccflare)

```
Claude Code (CLAUDE_API_URL 설정)
    ↓ HTTP
ccflare 프록시 서버
    ↓ HTTP (OAuth 토큰 주입)
Anthropic API
    ↓ 응답 가로채기 (Response.clone() + Post-Processor Worker)
SQLite (accounts / requests / request_payloads 테이블)
```

---

## 3. 수집 데이터 비교

### 3.1 claude-spyglass가 수집하는 것 (훅 전용)

| 데이터 | 수집 테이블 | 출처 훅 |
|--------|------------|---------|
| 세션 ID, 프로젝트명, 시작/종료 시각 | sessions | SessionStart / SessionEnd |
| 사용자 프롬프트 텍스트(preview 2000자) | requests | UserPromptSubmit |
| 툴 이름 (Bash, Edit, Read, Agent, Skill …) | requests | PreToolUse / PostToolUse |
| 툴 입력값 (tool_input) | requests.payload | PreToolUse |
| 툴 응답값 (tool_response) | requests.payload | PostToolUse |
| Pre↔Post 페어링 키 (tool_use_id) | requests | PreToolUse / PostToolUse |
| 실제 툴 실행 시간 (duration_ms) | requests | Pre→Post 타임스탬프 차 |
| Turn 구조 (turn_id) | requests | 계산 컬럼 |
| 토큰 수 (transcript 파싱) | requests | PostToolUse → transcript 파일 |
| 캐시 토큰 (transcript 파싱) | requests | transcript 파일 |
| 작업 디렉토리 (cwd) | claude_events | 모든 훅 |
| 에이전트 정보 (agent_id, agent_type) | claude_events | SubAgent 훅 |
| 권한 모드 (permission_mode) | claude_events | SessionStart |
| 라이프사이클 이벤트 27종 | claude_events | 와일드카드 훅 |

### 3.2 ccflare가 수집하는 것 (프록시 전용)

| 데이터 | 수집 테이블 | 출처 |
|--------|------------|------|
| HTTP 메서드, 경로 | requests | HTTP 요청 |
| HTTP 상태 코드 | requests | HTTP 응답 |
| 전체 API 응답 시간 (response_time_ms) | requests | 요청~응답 타이머 |
| **정확한 토큰 수** (input/output) | requests | API 응답 body |
| **캐시 토큰** (cache_read/creation) | requests | API 응답 body |
| **비용 (cost_usd)** | requests | 모델 가격표 × 토큰 |
| **출력 속도 (output_tokens_per_second)** | requests | SSE 청크 타이밍 |
| 레이트 리밋 상태 | accounts | API 응답 헤더 |
| 페일오버 시도 횟수 | requests | 재시도 카운터 |
| 사용된 OAuth 계정 | requests | 자체 계정 풀 |
| 전체 요청/응답 JSON | request_payloads | HTTP 본문 |

### 3.3 어느 쪽도 수집하지 못하는 것

| 데이터 | 이유 |
|--------|------|
| 훅 → API 응답의 정확한 토큰 | 훅은 HTTP 응답을 볼 수 없음, transcript 파싱에 의존 |
| 프록시 → Claude Code 세션 구조 | HTTP 요청에 session_id 헤더가 없음 |
| 프록시 → 툴 이름/입출력 | HTTP 레벨에서는 어떤 툴인지 알 수 없음 |
| 프록시 → 라이프사이클 이벤트 | Claude Code 내부 이벤트는 훅으로만 관찰 가능 |

---

## 4. 방식별 장단점 요약

### 훅 방식

**장점**
- 설치 단순: 훅 스크립트 등록만으로 완료, CLAUDE_API_URL 변경 불필요
- 단일 장애점 없음: 훅 전송 실패해도 Claude Code 정상 동작 (비동기 curl)
- 의미 컨텍스트 완전: 어떤 툴을 왜 실행했는지, 어떤 프로젝트에서 실행 중인지
- 세션/턴 구조 파악: 대화 흐름을 계층적으로 분석 가능
- Claude Code 라이프사이클 가시성: 27종 훅 이벤트

**단점**
- 토큰 수 정확도 중간: transcript 파싱 의존 → `tokens_confidence='error'` 발생 가능
- 비용 계산 불가: API 응답을 직접 보지 못하므로 cost_usd 산출 어려움
- API 레이턴시 측정 불가: Claude Code → Anthropic 간 실제 응답 시간 모름
- TPS(토큰/초) 측정 불가: 스트리밍을 직접 관찰하지 않음

### 프록시 방식

**장점**
- 토큰 카운트 완전 정확: API 응답 body에서 직접 추출
- 비용 계산 정확: cost_usd, 모델별 가격 × 토큰
- HTTP 메트릭 완전: response_time_ms, status_code, TPS
- 캐시 효과 정확 측정: cache_read / cache_creation 토큰 수 신뢰 가능
- 전체 페이로드 저장: 요청/응답 재현 가능

**단점**
- 설치 복잡: CLAUDE_API_URL 또는 baseurl 설정 변경 필요
- 단일 장애점: 프록시 다운 = Claude Code 동작 불가
- 의미 컨텍스트 없음: session_id, tool_name, cwd 불투명
- Max(OAuth) 사용자 복잡도: 토큰 갱신/멀티계정 관리 부담

---

## 5. 하이브리드 통합 가능성

### 5.1 ccflare를 그대로 앞에 붙이기 (옵션 A)

```
Claude Code
  └─ CLAUDE_API_URL=http://localhost:8888 → ccflare → Anthropic API
  └─ hooks → spyglass → SQLite (spyglass.db)
```

- ccflare.db와 spyglass.db 분리 → 통합 분석 불편
- ccflare의 OAuth 멀티계정 기능은 Max 사용자에게 불필요
- **권고: 비적합** — 목적 불일치, 복잡도 과도

### 5.2 claude-spyglass 자체 경량 프록시 추가 (옵션 B) ← 권고

```
Claude Code
  └─ CLAUDE_API_URL=http://localhost:9998 → spyglass-proxy → Anthropic API
  └─ hooks → spyglass-collect → SQLite (동일 DB)
```

- `packages/proxy` 패키지: 단순 포워딩, 로드밸런싱 불필요
- API 응답에서 usage 블록 파싱 → requests 테이블에 정확한 토큰/비용 저장
- 타임스탬프 기반 세션 매핑: 프록시 요청의 `responded_at` ≈ `PostToolUse.timestamp`로 근사 조인
- **장점**: 단일 DB, 훅 데이터와 통합 저장, correlation 가능
- **단점**: 개발 공수 필요 (1-2 스프린트), 프록시 단일 장애점

#### 추가할 컬럼 (requests 테이블)

```sql
ALTER TABLE requests ADD COLUMN http_status INTEGER;
ALTER TABLE requests ADD COLUMN api_response_time_ms INTEGER;
ALTER TABLE requests ADD COLUMN tokens_per_second REAL;
ALTER TABLE requests ADD COLUMN cost_usd REAL;
ALTER TABLE requests ADD COLUMN tokens_source_v2 TEXT; -- 'proxy' | 'transcript'
```

### 5.3 단기 개선: transcript 파싱 + 가격 테이블 (옵션 C)

- 프록시 없이 현재 방식 유지
- 모델별 가격 테이블 hardcode → `cost_usd` 근사값 제공
- transcript tail 방식으로 usage 블록 더 빠르게 파싱
- **권고: 즉시 실행 가능한 단기 개선**

---

## 6. Correlation 전략

두 방식을 동시에 운영할 경우, 훅 데이터와 프록시 데이터를 연결하는 것이 핵심 과제다.

### 현실적 correlation 방법

| 방법 | 정확도 | 복잡도 |
|------|--------|--------|
| 타임스탬프 근사 조인 (±2초) | 중 | 낮음 |
| 세션 시작 타임스탬프 기반 session_id 매핑 | 높음 | 중 |
| 프록시가 훅 서버에 session_id 질의 (역방향) | 매우 높음 | 높음 |

**권고**: 옵션 B 구현 시 spyglass-proxy가 `/collect` 서버에 현재 활성 세션 목록을 질의하여 타임스탬프로 매핑. 동일 프로세스 내에서 session_id를 메모리 공유하는 방식이 가장 정확.

---

## 7. 최종 권고

### 단기 (즉시)
- 현재 훅 방식 유지
- 모델 가격 테이블 추가 → `cost_usd` 근사 계산 기능 추가
- transcript 파싱 안정성 개선

### 중기 (1-2 스프린트)
- `packages/proxy` 추가: Bun HTTP 서버로 단순 포워딩
- API 응답에서 usage 직접 파싱 → requests 테이블 갱신
- `output_tokens_per_second` (TPS) 측정 추가
- `api_response_time_ms` 측정 추가
- 단일 DB 내에서 훅 데이터와 프록시 데이터 통합

### 장기 (선택적)
- ccflare와의 직접 통합 (session_id 헤더 표준화) — Claude Code upstream 기여 필요
- 프록시 고가용성 (프록시 장애 시 직접 연결 fallback)

---

## 8. 참고 자료

- ccflare 데이터베이스 문서: `workspace/ccflare/docs/database.md`
- ccflare 데이터 플로우: `workspace/ccflare/docs/data-flow.md`
- claude-spyglass 마이그레이션: `packages/storage/migrations/`
- 훅 수집 스크립트: `hooks/spyglass-collect.sh`
- 수집 핸들러: `packages/server/src/collect.ts`
