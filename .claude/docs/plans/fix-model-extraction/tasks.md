# fix-model-extraction 작업 목록

> 기반 문서: plan.md, adr.md  
> 작성일: 2026-04-18  
> 총 태스크: 2개

---

## 태스크 목록

| ID | 태스크 | 예상 시간 | 선행 태스크 | 커밋 타입 |
|----|--------|----------|------------|----------|
| T-01 | `extract_model()` — jq 기반 교체 및 fallback 수정 | 15m | - | fix |
| T-02 | 변경 동작 검증 (수동 테스트) | 10m | T-01 | - |

---

## T-01: `extract_model()` — jq 기반 교체 및 fallback 수정

**선행 조건**: 없음

### 작업 내용

`hooks/spyglass-collect.sh`의 `extract_model()` 함수 내부를 교체한다.

- **현재**: `grep -oE '"model"\s*:\s*"[^"]+"' | head -1 | cut -d'"' -f4` — payload 첫 번째 `"model"` 필드 추출
- **변경**: `jq -r '.message.model // empty' <<< "$payload"` — `.message.model` 경로 명시 추출
- **fallback**: `claude-sonnet` → 빈 문자열 (main() jq 빌더가 null로 처리)

### 구현 범위

- `hooks/spyglass-collect.sh:291-295`: `extract_model()` 함수 내부 교체

### 변경 전후

```bash
# 변경 전
extract_model() {
    local payload="$1"
    local model=$(echo "$payload" | grep -oE '"model"\s*:\s*"[^"]+"' | head -1 | cut -d'"' -f4)
    echo "${model:-claude-sonnet}"
}

# 변경 후
extract_model() {
    local payload="$1"
    local model
    model=$(jq -r '.message.model // empty' <<< "$payload" 2>/dev/null)
    echo "${model:-}"
}
```

### 커밋 메시지
```
fix(collect): extract_model — jq로 message.model 명시 추출

grep 방식은 payload 내 첫 번째 "model" 필드를 추출하므로
tool_response.model(kimi-k2.5)이 잘못 수집됐다.
jq로 .message.model 경로를 명시해 Anthropic API 표준 모델명만 추출한다.
fallback은 claude-sonnet 하드코딩 대신 빈 문자열(→ null)로 변경한다.
```

### 검증 명령어
```bash
# 함수 단독 검증 — message.model 정상 추출
payload='{"message":{"model":"claude-sonnet-4-7","usage":{}},"tool_response":{"model":"kimi-k2.5"}}'
result=$(jq -r '.message.model // empty' <<< "$payload" 2>/dev/null)
echo "추출 결과: $result"
# 기대: claude-sonnet-4-7

# fallback 검증 — message 없을 때 빈 문자열
payload='{"tool_response":{"model":"kimi-k2.5"}}'
result=$(jq -r '.message.model // empty' <<< "$payload" 2>/dev/null)
echo "fallback 결과: '${result:-}'"
# 기대: (빈 문자열)
```

### 완료 기준
- [ ] `message.model`과 `tool_response.model`이 함께 있을 때 `message.model` 반환
- [ ] `message.model`이 없을 때 빈 문자열 반환 (null로 저장됨)
- [ ] `tool_response.model`만 있을 때 빈 문자열 반환
- [ ] 빈 payload `{}` 에서도 오류 없이 빈 문자열 반환

### 롤백 방법
```bash
git revert HEAD
```

---

## T-02: 변경 동작 검증 (커밋 없음)

**선행 조건**: T-01 완료 후

### 작업 내용

실제 스크립트를 직접 실행해 모델 추출 경로를 검증한다. 커밋 대상이 아닌 수동 확인 단계.

### 검증 명령어
```bash
# Case 1: message.model 우선 추출 (R1, R2 통합 검증)
payload='{"session_id":"test","message":{"model":"claude-sonnet-4-7","usage":{"input_tokens":10,"output_tokens":5}},"tool_response":{"model":"kimi-k2.5"}}'
result=$(jq -r '.message.model // empty' <<< "$payload" 2>/dev/null)
echo "Case1: $result"  # 기대: claude-sonnet-4-7

# Case 2: message.model 없을 때 빈 문자열 (ADR-003)
payload='{"tool_response":{"model":"kimi-k2.5"}}'
result=$(jq -r '.message.model // empty' <<< "$payload" 2>/dev/null)
echo "Case2: '${result:-}'"  # 기대: (빈 문자열)

# Case 3: malformed JSON — 오류 없이 빈 문자열
result=$(jq -r '.message.model // empty' <<< "NOT_JSON" 2>/dev/null)
echo "Case3: '${result:-}'"  # 기대: (빈 문자열)

# Case 4: message_start 이벤트 구조 (R2 검증)
payload='{"type":"message_start","message":{"model":"claude-sonnet-4-7","usage":{}}}'
result=$(jq -r '.message.model // empty' <<< "$payload" 2>/dev/null)
echo "Case4: $result"  # 기대: claude-sonnet-4-7
```

### 완료 기준
- [ ] Case1: `claude-sonnet-4-7` 반환 — `message.model` 우선 추출 확인
- [ ] Case2: 빈 문자열 반환 — `tool_response.model` 배제 확인 (ADR-003)
- [ ] Case3: 빈 문자열 반환, stderr 오류 없음 — malformed JSON 방어 확인
- [ ] Case4: `claude-sonnet-4-7` 반환 — message_start 이벤트 구조 호환 (R2)
