# spyglass-adr

Architecture Decision Records (ADR) 관리 스킬

## 개요

spyglass 프로젝트의 아키텍처 결정을 기록하고 관리합니다.

## 문서 위치

`docs/planning/03-adr.md`

## 사용법

### 새 ADR 추가

```
@ spyglass-adr:add {ADR 번호} {제목}
```

예시:
```
@ spyglass-adr:add 005 SSE 스트리밍 프로토콜 선택
```

### ADR 상태 변경

```
@ spyglass-adr:status {번호} {상태}
```

상태: `proposed` | `accepted` | `rejected` | `superseded`

### ADR 목록 확인

```
@ spyglass-adr:list
```

## ADR 형식

```markdown
## ADR-XXX: {제목}

- **상태**: 제안/수띅/반려/대체
- **날짜**: YYYY-MM-DD
- **결정자**: @claude

### 배경

### 결정

### 대안

### 영향
```

## 관례

1. **번호**: 순차적 부여 (ADR-001, ADR-002, ...)
2. **제목**: 명령문 또는 명사구
3. **상태 전이**: 
   - `제안` → `수띅`/`반려`
   - `수띅` → `대체` (새 ADR로)
