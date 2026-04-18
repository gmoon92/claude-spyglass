# 모델 추출 로직 개선 계획

## 1. 개요

### 1.1 배경
현재 `spyglass-collect.sh`의 `extract_model()` 함수는 payload 내 모든 `"model"` 필드 중 첫 번째를 추출합니다. 이로 인해 `tool_response.model` (예: `kimi-k2.5`)이 수집되며, 실제 Claude API 요청에 사용된 `message.model` (예: `claude-sonnet-4-7`)이 누락됩니다.

### 1.2 목표
- Anthropic API 표준 응답 형식의 `message.model` 필드 추출
- tool_response 낸부 모델이 아닌, 요청의 실제 모델 정확히 수집
- ccflare의 추출 방식과 일관성 확보

### 1.3 참고
- ccflare: `packages/proxy/src/post-processor.worker.ts` (Line 155-167)
- 현재 코드: `hooks/spyglass-collect.sh:293`

## 2. 문제 분석

### 2.1 현재 동작
```bash
extract_model() {
    local model=$(echo "$payload" | grep -oE '"model"\s*:\s*"[^"]+"' | head -1 | cut -d'"' -f4)
    echo "${model:-claude-sonnet}"
}
```

### 2.2 문제점
| 항목 | 현재 | 예상 |
|------|------|------|
| 추출 위치 | payload 내 첫 번째 model | message 객체의 model |
| 결과 예시 | `kimi-k2.5` | `claude-sonnet-4-7` |
| API 표준 | 비표준 | Anthropic API 표준 |

### 2.3 transcript 구조
```json
{
  "tool_response": {
    "model": "kimi-k2.5",     // ← 현재 여기서 추출됨 (잘못됨)
    "content": [...]
  },
  "message": {
    "model": "claude-sonnet-4-7",  // ← 여기서 추출해야 함 (정확함)
    "usage": {...}
  }
}
```

## 3. 요구사항

### 3.1 기능 요구사항
| ID | 요구사항 | 우선순위 |
|----|---------|---------|
| R1 | `message.model` 우선 추출 | P0 |
| R2 | message_start 이벤트 대응 | P0 |
| R3 | fallback 처리 유지 | P1 |

### 3.2 기술 요구사항
- bash 호환성 유지
- jq 사용 가능 (이미 의존성 있음)
- 기존 collect.sh 구조 변경 최소화

## 4. 참고 파일

- `hooks/spyglass-collect.sh`
- `.claude/docs/research/ccflare-comparison/01-system-architecture.md`

## 5. 제약사항

- 문서 작성만 진행, 개발은 별도 세션에서
- 회의 라운드: 3라운드
