# 라운드 2: 토큰 수집 정확성 평가

> 평가자: AI/LLM 전문가
> 점수: **5.5/10**

---

## 검토 대상 파일

- `packages/server/src/collect.ts` - 토큰 수집 로직
- `hooks/spyglass-collect.sh` - 훅 스크립트
- `packages/server/src/api.ts` - API 엔드포인트

---

## 토큰 수집 메커니즘 분석

```typescript
// collect.ts: transcript 파일 파싱
export function parseTranscript(transcriptPath: string): TranscriptUsage {
  const content = readFileSync(transcriptPath, 'utf-8');
  const lines = content.split('\n').filter(line => line.trim());
  
  // 마지막 assistant 메시지에서 usage 추출
  for (let i = lines.length - 1; i >= 0; i--) {
    try {
      const entry = JSON.parse(lines[i]) as Record<string, unknown>;
      if (entry.type !== 'assistant') continue;

      const message = entry.message as Record<string, unknown> | undefined;
      const usage = message?.usage as Record<string, unknown> | undefined;
      
      return {
        inputTokens: (usage?.input_tokens as number) ?? 0,
        outputTokens: (usage?.output_tokens as number) ?? 0,
        cacheCreationTokens: (usage?.cache_creation_input_tokens as number) ?? 0,
        cacheReadTokens: (usage?.cache_read_input_tokens as number) ?? 0,
        model: (message.model as string) ?? '',
      };
    } catch {
      continue;
    }
  }
  return defaultResult; // 전부 0
}
```

---

## 강점

### 1. Claude API usage 직접 사용
- 실제 API 응답의 `usage` 필드 사용 (추정이 아닌 실제 값)
- `input_tokens`, `output_tokens`, `cache_*_tokens` 분리 수집

### 2. 캐시 토큰 분리 수집
```typescript
cacheCreationTokens: usage?.cache_creation_input_tokens ?? 0,
cacheReadTokens: usage?.cache_read_input_tokens ?? 0,
```
- prompt caching 효과 분석 가능

### 3. Pre/Post 도구 시간 측정
```typescript
export const toolTimingMap = new Map<string, number>();
// PreToolUse: toolTimingMap.set(tool_use_id, now)
// PostToolUse: duration_ms = now - toolTimingMap.get(tool_use_id)
```
- 도구 실행 시간 정확히 측정

---

## 약점/문제점

### 1. transcript 파일 의존의 취약성 (치명적) 🔴

```typescript
// 문제 1: 파일 없으면 0 처리
const tokensInput = transcriptData?.inputTokens ?? 0;

// 문제 2: 파일 읽기 실패 무시
try {
  const content = readFileSync(transcriptPath, 'utf-8');
  // ...
} catch {
  // 파일 읽기 실패 → 기본값 반환 (전부 0)
  return defaultResult;
}
```

**발생 가능한 시나리오:**
| 시나리오 | 결과 | 영향 |
|---------|------|------|
| transcript 파일 롤오버 | 토큰 0 | 데이터 누락 |
| 파일 접근 권한 문제 | 토큰 0 | 데이터 누락 |
| 지연 쓰기 (아직 기록 안 됨) | 토큰 0 | 데이터 누락 |
| JSON 파싱 오류 | 토큰 0 | 데이터 누락 |
| 큰 파일로 인한 읽기 타임아웃 | 토큰 0 | 데이터 누락 |

**결과:**
- "10K 토큰 알림"이 무의미해짐
- 비용 분석이 완전히 잘못됨
- 사용자가 "왜 0으로 나오지?" 당혹

### 2. UserPromptSubmit만 토큰 수집

```typescript
// PostToolUse에서도 transcript 파싱
transcriptData = parseTranscript(transcript_path);
```

**문제:**
- Tool use 중간의 토큰 변화 누락
- 하나의 prompt로 여러 tool call이 발생할 때 정확한归因 어려움

### 3. 실시간성 한계

```typescript
// PostToolUse 시점에만 transcript 파싱
// User는 토큰 사용을 실시간으로 볼 수 없음
// 중간 값 확인 불가
```

### 4. context_tokens의 모호한 정의

```typescript
// schema.ts
interface Request {
  // ...
  tokens_input: number;
  tokens_output: number;
  tokens_total: number;  // input + output
  // context_tokens은 없음!
}
```

**문제:**
- `context_tokens`는 `tokens_input`과 혼용되어 사용됨
- 실제 context window 사용량이 아님
- 사용자에게 혼란을 줌

---

## 검증 테스트 (가상)

| 테스트 케이스 | 예상 결과 | 실제 동작 | 문제 여부 |
|-------------|----------|----------|----------|
| 정상 transcript 파일 | 토큰 값 정상 | ✅ | - |
| 파일 없음 | 에러 또는 예외 | 0으로 저장 | 🔴 심각 |
| 파일 접근 권한 없음 | 에러 또는 예외 | 0으로 저장 | 🔴 심각 |
| JSON 파싱 오류 | 에러 또는 예외 | 0으로 저장 | 🔴 심각 |
| 빈 transcript 파일 | 0 또는 예외 | 0으로 저장 | ⚠️ |
| 매우 큰 파일 (>100MB) | 타임아웃 또는 청크 처리 | 전체 읽기 시도 | ⚠️ |

---

## 개선 제안

### 1. Fallback 메커니즘

```typescript
// collect.ts 개선안
export function parseTranscript(transcriptPath: string): TranscriptUsage {
  if (!transcriptPath) {
    return { 
      inputTokens: null,  // null로 표시
      outputTokens: null,
      // ...
      _error: 'NO_TRANSCRIPT_PATH'
    };
  }
  
  try {
    // 파일 존재 확인
    if (!existsSync(transcriptPath)) {
      return { _error: 'FILE_NOT_FOUND' };
    }
    
    // 크기 확인 (너무 크면 청크 처리)
    const stats = statSync(transcriptPath);
    if (stats.size > 100 * 1024 * 1024) { // 100MB
      return parseTranscriptChunked(transcriptPath);
    }
    
    // 기존 파싱 로직
    // ...
  } catch (error) {
    return { _error: error.message };
  }
}
```

### 2. Alternative 토큰 수집

```typescript
// hooks/spyglass-collect.sh 개선
# transcript 외에 환경변수나 다른 소스에서도 토큰 정보 수집
echo "$payload" | python3 -c "
import sys, json
data = json.load(sys.stdin)
# 환경변수에서도 토큰 정보 확인
tokens = os.environ.get('CLAUDE_USAGE', '{}')
print(tokens)
"
```

### 3. 신뢰도 표시

```typescript
// UI에 토큰 데이터의 신뢰도 표시
interface TokenDisplay {
  value: number;
  confidence: 'high' | 'medium' | 'low' | 'error';
  source: 'transcript' | 'estimated' | 'unavailable';
}

// 표시 예시
// Tokens: 12,456 ✓ (from transcript)
// Tokens: ~8,000 ~ (estimated)
// Tokens: -- ! (unavailable)
```

---

## 실용성 점수: 5.5/10

**근거:**
- ✅ Claude API의 실제 usage 필드 사용은 올바른 접근
- ✅ 캐시 토큰 분리 수집은 prompt caching 분석에 유용
- ⚠️ transcript 파일 의존은 안정성 이슈가 너무 큼
- ⚠️ 파일 누락 시 0으로 저장되면 사용자가 오해함
- ❌ "10K 토큰 알림"이 의미 있으려면 데이터가 정확해야 함
- ❌ 현재 구현은 프로덕션 사용에 위험이 큼

**권장사항:**
> "transcript 파일 의존은 안정성 이슈가 너무 큽니다. 파일 롤오버, 접근 권한, 지연 쓰기 등 다양한 이유로 토큰이 누락될 수 있습니다. '10K 토큰 알림'이 0으로 잡히면 의미가 없습니다."
>
> 반드시 fallback 메커니즘과 신뢰도 표시를 추가해야 합니다.
