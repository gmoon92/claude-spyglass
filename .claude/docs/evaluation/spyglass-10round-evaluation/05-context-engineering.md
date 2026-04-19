# 라운드 4: 컨텍스트 엔지니어링 평가

> 평가자: LLM 컨텍스트 관리 전문가
> 점수: **4/10**

---

## 검토 대상 파일

- `packages/web/assets/js/context-chart.js` - Context Growth Chart
- `packages/storage/src/queries/session.ts` - 세션 쿼리
- `packages/web/index.html` - 웹 대시보드

---

## Context Growth Chart 분석

```javascript
// context-chart.js
const CTX_MAX_TOKENS = 200_000; // claude 기준 컨텍스트 한도
const WARN_RATIO = 0.80;        // 경고 임계값

// 문제: context_tokens의 정의가 모호함
const values = sorted.map(t => t.prompt.context_tokens || t.prompt.tokens_input || 0);
```

---

## 강점

### 1. 시각적 경고
```javascript
if (_indicator) {
  _indicator.textContent = `${usePct}% (${fmtK(latest)})`;
  _indicator.className = usePct >= 95 ? 'crit' : usePct >= 80 ? 'warn' : '';
}
```
- 80% 도달 시 색상 변경으로 주목 유도

### 2. 턴(Turn) 기반 추적
```javascript
const sorted = (turns || []).filter(t => t.prompt)
  .slice().sort((a, b) => a.turn_index - b.turn_index);
```
- prompt 단위로 context 추적

---

## 약점/문제점

### 1. context_tokens 정의 불명확 (치명적) 🔴

```javascript
// context-chart.js
const values = sorted.map(t => t.prompt.context_tokens || t.prompt.tokens_input || 0);
```

**문제:**
- `context_tokens` vs `tokens_input` 혼용
- **실제 context window 사용량이 아님**
- Claude Code의 남부 context 관리는 외부에서 알 수 없음

**Claude의 Context Window 구성:**
```
Context Window = 
  System Prompt (CLAUDE.md 등)
  + Conversation History (이전 대화)
  + Current Input (현재 입력)
  + Tool Results (도구 실행 결과)
  + Thinking/Reasoning (추론 과정)
```

**spyglass가 측정하는 것:**
```
tokens_input = 현재 요청의 input_tokens
≠ 실제 context window 사용량
```

### 2. 200K 하드코딩

```javascript
const CTX_MAX_TOKENS = 200_000; // claude 기준 컨텍스트 한도
```

**문제:**
- Claude 모델별로 다름:
  - Claude 3 Opus: 200K
  - Claude 3.5 Sonnet: 200K
  - Claude 3.5 Haiku: 200K
  - Claude 3 (구버전): 100K
- 미래 모델은 더 커질 수도, 작아질 수도 있음

### 3. Actionable insight 부족

```javascript
// 80% 경고선
const WARN_RATIO = 0.80;

// 그래서 사용자가 뭘 해야 하죠?
// - 컨텍스트 압축?
// - 새 세션 시작?
// - 어떤 메시지를 삭제?
```

**문제:**
- "80% 도달" 이후 어떤 행동을 취해야 하는가?
- 구체적인 가이드 없음
- Claude Code가 자동으로 context를 관리하는데 개입 방법 불명확

---

## "토큰 누수" 개념의 정확성

### 프로젝트가 정의하는 "토큰 누수"
> "예상보다 과도한 토큰이 소모되는 지점"

### 실제로 측정 가능한 것
- 요청별 tokens_input + tokens_output
- 누적 토큰 수

### 측정 불가능한 것
- "예상" 토큰 수 (기준이 없음)
- "불필요한" 토큰 사용 (의도 vs 비의도 구분 불가)
- context window의 실제 사용률

**결론:**
> "토큰 누수"는 직관적인 개념이지만, spyglass는 이를 객관적으로 측정하지 못함.
> 단순히 "많이 썼다"는 것을 보여줄 뿐, "왜 누수됐는지"는 알려주지 않음.

---

## CLAUDE.md와의 연계 가능성

```typescript
// 현재: 없음
// claude_events 테이블에 payload 저장만 함

// 가능했을 기능:
// - CLAUDE.md 변경 시점과 토큰 사용 변화 상관관계
// - 프로젝트별 context length 분석
// - system prompt 최적화 가이드
```

**문제:**
- CLAUDE.md (system prompt)의 영향 분석 불가
- 프로젝트별 컨텍스트 패턴 분석 미흡

---

## 개선 제안

### 1. 정확한 명칭 사용

```javascript
// 변경 전 (오해 유발)
const CTX_MAX_TOKENS = 200_000;
renderContextChart(turns); // "Context Growth Chart"

// 변경 후 (명확)
const ACCUMULATED_TOKENS_MAX = 200_000; // 또는 사용자 설정값
renderAccumulatedTokensChart(turns); // "Accumulated Tokens Chart"
```

### 2. 모델별 한도 설정

```typescript
// schema.ts에 추가
interface ModelConfig {
  model_id: string;
  context_window: number;
  is_active: boolean;
}

const DEFAULT_MODEL_CONFIGS: ModelConfig[] = [
  { model_id: 'claude-opus-4', context_window: 200000, is_active: true },
  { model_id: 'claude-sonnet-4', context_window: 200000, is_active: true },
  { model_id: 'claude-haiku-4', context_window: 200000, is_active: true },
];
```

### 3. Actionable 가이드 제공

```javascript
// context-chart.js 개선
function getContextAdvice(currentTokens, modelLimit) {
  const ratio = currentTokens / modelLimit;
  if (ratio >= 0.95) {
    return {
      level: 'critical',
      message: 'Context window nearly full. Start new session soon.',
      actions: [
        'Start new session with /new',
        'Use @file to reference large files instead of pasting',
        'Clear conversation with /clear'
      ]
    };
  } else if (ratio >= 0.80) {
    return {
      level: 'warning',
      message: 'Context window filling up.',
      actions: [
        'Consider summarizing conversation',
        'Remove unused @ references'
      ]
    };
  }
  return { level: 'ok', message: 'Context usage normal' };
}
```

### 4. Context Chart 대체안

```typescript
// 대안 1: Turn 당 토큰 사용량 분포
// 대안 2: Tool별 평균 토큰 사용량
// 대안 3: 시간대별 토큰 사용량 (히트맵)
// 대안 4: 현재는 제거 (오해 방지)
```

---

## 실용성 점수: 4/10

**근거:**
- ✅ 시각적 경고는 사용자 주목을 끌 수 있음
- ✅ 턴 기반 추적은 conversation flow 분석에 유용
- ❌ **"Context Growth"라는 이름이 오해를 유발** (실제 context window 아님)
- ❌ **80% 경고선은 의미 없는 숫자** (실제 context 사용량과 무관)
- ❌ 200K 하드코딩은 모델별 차이를 무시
- ❌ 사용자에게 actionable insight 제공 안 함

**컨텍스트 엔지니어링 전문가 의견:**
> "이 차트는 '누적 토큰 사용량'을 보여줄 뿐, 실제 'context window 사용률'이 아닙니다. context window는 시스템 프롬프트 + 히스토리 + 현재 입력의 총합인데, 이는 Claude Code 내부에서만 알 수 있습니다. '80% 경고'는 의미 없는 숫자입니다."
> 
> **권장:** Context Chart를 제거하거나, "Accumulated Tokens Chart"로 이름을 바꾸고, 80% 경고선을 제거하세요.
