# fix-model-extraction Architecture Decision Records

> 작성일: 2026-04-18  
> 참여 전문가: 소프트웨어 아키텍트, 백엔드 엔지니어

---

## ADR-001: extract_model() 파싱 방식 — grep → jq 전환

### 상태
**결정됨** (2026-04-18)

### 배경

`extract_model()`은 payload 문자열에서 `grep -oE '"model"\s*:\s*"[^"]+"' | head -1`으로 첫 번째 `"model"` 필드를 추출한다. hook payload에 `tool_response.model`("kimi-k2.5")과 `message.model`("claude-sonnet-4-7")이 함께 존재할 때, grep은 JSON 구조를 이해하지 못하므로 등장 순서에 의존해 `tool_response.model`을 잘못 선택한다.

### 고려한 옵션

| 옵션 | 설명 | 장점 | 단점 |
|------|------|------|------|
| A | jq로 payload에서 `.message.model` 직접 추출 | 변경 최소화, JSON 경로 명시적 | transcript와 소스 분리 |
| B | `extract_usage_from_transcript()` 확장 (5번째 필드에 model 추가) | 소스 일관성(transcript), 파일 I/O 1회 | 반환 포맷 변경 → 모든 호출 측 수정 필요 |
| C | 별도 `extract_model_from_transcript()` 추가 | 관심사 분리 | 파일 I/O 2회, 코드 중복 |

### 결정

**옵션 A 채택** — jq로 payload의 `.message.model`을 직접 추출한다.

```bash
extract_model() {
    local payload="$1"
    local model
    model=$(jq -r '.message.model // empty' <<< "$payload" 2>/dev/null)
    echo "${model:-}"
}
```

### 이유

1. **변경 범위 최소화** — plan.md 제약사항 "기존 구조 변경 최소화" 충족. 함수 내부만 교체하며 호출 측(`main()`)은 변경 없음.
2. **payload에 `message.model` 존재 확인** — hook payload 구조상 `message.model`이 최상위에 존재하므로 transcript 파일 접근 없이 추출 가능.
3. **JSON 경로 명시** — jq는 JSON 구조를 파싱하므로 `tool_response.model`이 먼저 등장해도 영향받지 않음. 버그 재발 방지.
4. **jq는 이미 의존성** — 스크립트 전체에서 JSON 빌드 시 jq를 사용 중(line 445). 추가 의존성 없음.

### 대안 채택 시 영향

- **옵션 B 선택 시**: `extract_usage_from_transcript()` 반환 포맷이 `"input,output,cache_creation,cache_read,model"`로 변경되어, main()의 `cut -d',' -f1~4` 파싱 4줄과 echo 기본값이 모두 수정되어야 함.
- **옵션 C 선택 시**: transcript 파일을 두 번 읽으므로 1초 타임아웃 제약 환경에서 I/O 부담 증가.

---

## ADR-002: fallback 반환값 — `claude-sonnet` → 빈 문자열

### 상태
**결정됨** (2026-04-18)

### 배경

현재 `echo "${model:-claude-sonnet}"`은 파싱 실패 시 `claude-sonnet`을 반환한다. 이 값은 실제 모델 사용과 파싱 실패를 구분할 수 없어 통계 오염을 유발한다.

### 고려한 옵션

| 옵션 | 설명 | 장점 | 단점 |
|------|------|------|------|
| A | 빈 문자열 반환 | jq 빌드에서 null로 변환 (기존 패턴 활용) | null 레코드는 집계 시 별도 처리 필요 |
| B | `UNKNOWN` sentinel | 명시적 오류 가시화 | jq 빌드 측 `(if $model != "" then $model else null end)` 조건 변경 필요 |
| C | `claude-sonnet` 유지 | 변경 없음 | 파싱 실패와 실제 사용 구분 불가 — 통계 오염 지속 |

### 결정

**옵션 A 채택** — 빈 문자열 반환 (`echo "${model:-}"`).

main()의 jq 빌드(line 471)에는 이미 `(if $model != "" then $model else null end)` 패턴이 존재하므로 추가 변경 없이 null로 저장된다.

### 이유

1. **기존 jq 빌드 패턴 재활용** — 별도 수정 없이 null 처리가 동작한다.
2. **통계 오염 방지** — `claude-sonnet` 하드코딩은 실제 사용과 구분 불가.
3. **변경 범위 최소화** — main()의 JSON 빌더를 건드리지 않음.

---

## ADR-003: `tool_response.model` fallback 완전 배제

### 상태
**결정됨** (2026-04-18)

### 배경

수집 목적은 "Claude API에 실제 사용된 모델" 기록이다. `tool_response.model`은 Claude가 도구 호출 중 사용한 서드파티 모델(예: kimi-k2.5)이므로 수집 대상이 아니다.

### 결정

fallback 체인에서 `tool_response.model` 경로를 완전히 제외한다. 추출 실패 시 null 저장이 잘못된 모델명 저장보다 낫다.

### 이유

1. **데이터 정확성** — 잘못된 값(kimi-k2.5)보다 null이 하위 집계에서 더 안전하다.
2. **명시적 경로 제한** — `.message.model`만 추출하므로 `tool_response.model`이 payload에 있어도 무시된다.

---

## ADR-004: `prompt` 이벤트에서만 모델 수집 (현행 설계 유지)

### 상태
**결정됨** (2026-04-18)

### 배경

현재 `main()`은 `request_type == "prompt"`일 때만 `extract_model()`을 호출한다. `tool_call` 이벤트에는 `raw_model`이 빈 문자열로 남는다.

### 결정

현행 설계를 유지한다. tool_call 이벤트에 모델을 추가로 수집하는 것은 이 계획의 범위 밖이다.

### 이유

1. **단일 관심사** — 이 fix의 목적은 잘못된 모델 추출 교정이지 수집 범위 확장이 아니다.
2. **YAGNI** — tool_call별 모델 통계는 현재 요구사항에 없다.
