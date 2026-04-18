# spyglass 훅 이벤트 확장 ADR

> 작성일: 2026-04-18  
> 참여 전문가: 소프트웨어 아키텍트, 데이터 엔지니어, 데브옵스 엔지니어

---

## ADR-001: 이벤트 저장소 아키텍처

### 상태
**결정됨** (2026-04-18)

### 배경
현재 spyglass는 UserPromptSubmit과 PostToolUse 두 가지 이벤트만 수집하여 디버깅/관제 도구로서의 완전성이 부족합니다. 6개의 추가 이벤트(PreToolUse, SessionStart/End, Stop/StopFailure, PermissionRequest/Denied, PostToolUseFailure)를 수집하기 위한 저장소 아키텍처를 결정해야 합니다.

### 고려한 옵션

| 옵션 | 설명 | 장점 | 단점 |
|------|------|------|------|
| **A. requests 테이블 확장** | 기존 테이블에 type enum 확장 | 기존 쿼리 재사용, 단순한 마이그레이션 | 스키마 유연성 제한 |
| **B. events 테이블 신규** | 비도구 이벤트용 별도 테이블 | 이벤트별 스키마 최적화 가능 | JOIN 복잡성, 쿼리 분산 |
| **C. 단일 테이블 + JSON** | 공통 컬럼 + JSON payload | 최대 유연성, 스키마 변경 용이 | 타입 안전성 저하 |

### 결정
**옵션 A (requests 테이블 확장) + events 테이블 신규 (하이브리드)**

- 도구 실행 관련: requests 테이블 확장 (type enum 추가)
- 세션/권한 등 비도구 이벤트: events 테이블 신규

### 이유

1. **데이터 엔지니어 관점**: turn_id 기반 관계를 유지하려면 단일 테이블이 유리. 기존 집계 쿼리 재사용 가능.
2. **아키텍트 관점**: 이벤트 성격이 다른 도구 vs 비도구를 분리하여 쿼리 패턴 최적화.
3. **데브옵스 관점**: 마이그레이션 복잡도와 운영 비용의 균형.

### 대안 채택 시 영향

- **옵션 B (완전 분리)**: 기존 분석 쿼리 대부분 재작성 필요, turn_id 연계 로직 복잡화
- **옵션 C (JSON)**: 타입스크립트 타입 안전성 상실, 쿼리 작성 어려움

---

## ADR-002: 훅 설정 전략

### 상태
**결정됨** (2026-04-18)

### 배경
6개 이벤트 추가 시 설정 복잡도가 3배로 증가합니다. 글로벌 vs 프로젝트별 설정, 설정 검증, 롤아웃 전략이 필요합니다.

### 결정
**단계적 롤아웃 + 글로벌 설정 권장**

```json
{
  "hooks": {
    "SessionStart": [{
      "matcher": "startup",
      "hooks": [{
        "command": "bash ${SPYGLASS_DIR}/hooks/spyglass-collect.sh session_start",
        "async": true, "timeout": 1
      }]
    }],
    "PreToolUse": [{
      "hooks": [{
        "command": "bash ${SPYGLASS_DIR}/hooks/spyglass-collect.sh pre_tool_use",
        "async": true, "timeout": 1
      }]
    }],
    "PostToolUse": [...],
    "PostToolUseFailure": [...],
    "SessionEnd": [...],
    "Stop": [...],
    "PermissionRequest": [...]
  }
}
```

### 단계적 롤아웃

- **Phase 1**: SessionStart/End + Stop (세션 생명주기)
- **Phase 2**: PreToolUse + PermissionRequest/Denied + PostToolUseFailure (고급 디버깅)

### 이유

- 글로벌 설정: 모든 프로젝트에 자동 적용, 설정 일관성
- 단계적 도입: 설정 오류 리스크 감소, 검증 기회 제공
- async + 1초 timeout: Claude 흐름 블로킹 없음

---

## ADR-003: 데이터 품질 및 신뢰성

### 상태
**결정됨** (2026-04-18)

### 배경
async 수집, 1초 timeout 제약으로 인한 데이터 유실 위험이 있습니다.

### 결정
**fire-and-forget + 최소한의 로컬 버퍼링**

1. 훅 스크립트는 `|| true`로 항상 0 exit code 반환
2. 수집 실패 시 로컬 로그 파일에 기록 (나중에 수동 재처리 가능)
3. SessionEnd 누락 대비: 30분 무응답 시 세션 종료 추론
4. CHECK 제약 제거: 애플리케이션 레벨에서 type 검증

### 스키마 변경

```sql
-- requests 테이블 확장
ALTER TABLE requests ADD COLUMN error_message TEXT;
ALTER TABLE requests ADD COLUMN sequence_number INTEGER;
ALTER TABLE requests ADD COLUMN started_at INTEGER;  -- PreToolUse timestamp

-- events 테이블 신규
CREATE TABLE events (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  timestamp INTEGER NOT NULL,
  event_type TEXT NOT NULL,
  payload TEXT,
  metadata TEXT
);

-- 인덱스
CREATE INDEX idx_requests_event_type ON requests(type, timestamp DESC);
CREATE INDEX idx_requests_error ON requests(session_id, timestamp) 
  WHERE error_message IS NOT NULL;
```

### 이유

- timeout 제약으로 인해 재시도 로직은 오히려 리스크
- SQLite WAL 모드로 동시 쓰기 처리
- 세션 추론으로 필수 이벤트(SessionEnd) 누락 보완

---

## 전문가 이견 및 해소

### 이견 1: 테이블 분리 수준

**데이터 엔지니어**: requests 테이블 단일 확장 선호 (turn_id 관계 유지)  
**아키텍트**: events 테이블 분리 선호 (관심사 분리)  
**해소**: 하이브리드 접근 - 도구 이벤트는 requests 확장, 비도구는 events 테이블

### 이견 2: 동기 vs 비동기 수집

**데브옵스**: 일부 Critical 이벤트는 동기적 저장 고려  
**데이터 엔지니어**: 모두 비동기 유지 (timeout 리스크)  
**해소**: 모두 비동기 + 로컬 로그 버퍼링 (추후 개선 가능)

### 이견 3: 스키마 엄격성

**아키텍트**: JSON payload로 유연성 확보 제안  
**데이터 엔지니어**: 명시적 컬럼으로 타입 안전성 제안  
**해소**: 하이브리드 - 공통 필드는 컬럼, 가변 데이터는 JSON

---

## 구현 체크리스트

- [ ] ADR-001: events 테이블 생성 마이그레이션
- [ ] ADR-001: requests 테이블 컬럼 추가 마이그레이션
- [ ] ADR-002: spyglass-collect.sh 6개 이벤트 핸들러 구현
- [ ] ADR-002: 글로벌 설정 템플릿 작성
- [ ] ADR-003: 로컬 버퍼링 및 로깅 구현
- [ ] ADR-003: 세션 종료 추론 로직 구현
- [ ] 문서: README 훅 설정 가이드 업데이트
- [ ] 문서: 마이그레이션 가이드 작성
