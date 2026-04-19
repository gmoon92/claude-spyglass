# ADR — message-type-badge

## ADR-001: "행위" 컬럼을 4개 독립 컬럼으로 분리

### 상태
**결정됨** (2026-04-19)

### 배경

웹 대시보드 로그 테이블의 "행위" 컬럼은 단일 셀에 4가지 정보를 혼재하고 있다:
- type badge (P/T/S 약어)
- 도구명 또는 모델명
- 캐시 토큰 뱃지 (⚡)
- 오류 상태 뱃지

사용자(AI 전문가/개발자)가 특정 정보를 기준으로 시각적으로 스캔하거나 비교하기 어렵고,
컬럼 정렬·필터링도 불가능하다.

### 고려한 옵션

| 옵션 | 설명 | 장점 | 단점 |
|------|------|------|------|
| A | 현행 유지 (단일 행위 컬럼) | 컬럼 수 적음 | 혼재 정보, 스캔 어려움 |
| B | Action + Target 2분리 (모델명 Target에 포함) | 구현 단순 | prompt의 Target이 "모델"인지 불명확 |
| C | Action + Target + Model + Cache 4분리 | 정보 명확 분리, 컬럼별 의미 일관 | 컬럼 수 증가 (6→9) |

### 결정

**옵션 C** 채택: Action / Target / Model / Cache 4개 독립 컬럼으로 분리

| 컬럼 | 표시 대상 | 노출 조건 |
|------|----------|---------|
| Action | type badge (prompt/tool_call/system) | 항상 |
| Target | tool_name + tool_detail | tool_call만 |
| Model | model 명 | prompt만 |
| Cache | cache_read_tokens | prompt + 캐시 있을 때 |

### 이유

1. prompt의 모델명을 Target에 넣으면 "tool_call의 도구명"과 의미 충돌 발생
2. Cache 정보를 독립 컬럼으로 분리해야 cache_creation_tokens 툴팁 함께 제공 가능
3. 컬럼이 9개로 늘지만 빈칸이 많아 실제 시각 밀도는 낮음

---

## ADR-002: 컬럼 명칭 — AI Agent 도메인 영문 표준 채택

### 상태
**결정됨** (2026-04-19)

### 배경

기존 "행위"는 LLM/AI 도메인과 무관한 한국어 번역어다.
분리된 컬럼들의 영문 명칭을 어떤 기준으로 정할 것인가.

사용자 페르소나: Claude Code(AI Agent)를 관찰하는 AI 전문가 및 개발자.

### 고려한 옵션

| 옵션 | 컬럼 A | 컬럼 B | 근거 |
|------|--------|--------|------|
| A | Kind | Name | OpenTelemetry SpanKind 차용 |
| B | Type | Name | Langfuse/LangSmith 표준 |
| C | Interaction | Target | AI 에이전트 맥락 |
| **D** | **Action** | **Target** | ReAct 프레임워크 (Thought→Action→Observation) |

### 결정

**옵션 D** 채택: `Action` / `Target`

### 이유

1. claude-spyglass 사용자는 Claude Code(AI Agent)를 관찰하는 사람 → ReAct 개념이 가장 직관적
2. AI Agent 논문·LangGraph·AutoGen 등에서 에이전트 행동 단위를 `Action`으로 표기
3. `Target`은 tool_call(도구 대상)·prompt(처리 모델) 모두에서 "향하는 대상"으로 일관 해석 가능
4. 한국어로 번역 시 어색하므로 영문 그대로 사용 — AI 전문가 대상 서비스는 영문 기술 용어가 더 자연스러움

---

## ADR-003: type badge — 약어(P/T/S) 폐기, 풀텍스트 표시

### 상태
**결정됨** (2026-04-19)

### 배경

현재 type badge는 P(prompt) / T(tool_call) / S(system) 약어를 표시한다.
- TUI: 터미널 공간 제약으로 약어가 필수
- Web: 공간 제약 없음, 약어가 오히려 학습 비용 유발

### 고려한 옵션

| 옵션 | 표시 | 비고 |
|------|------|------|
| A | 약어 유지 (P/T/S) | TUI와 일관성, 좁은 공간 |
| B | 풀텍스트 (prompt/tool_call/system) | 즉시 이해 가능 |
| C | 아이콘만 | 언어 중립적이나 학습 필요 |

### 결정

**옵션 B** 채택: 풀텍스트 (`prompt` / `tool_call` / `system`)

TUI는 P/T/S 약어 유지 — 웹과 TUI는 독립 디자인 체계.

### 이유

1. 웹 대시보드는 공간 여유가 있어 약어로 인한 인지 비용이 불필요한 트레이드오프
2. DB 컬럼 값(`type`)과 UI 표시가 1:1 대응 → 디버깅 도구로서 투명성 향상
3. TUI와 동일할 이유 없음 — 플랫폼별 최적화가 맞는 방향

---

## ADR-004: Cache 툴팁 구현 방식

### 상태
**결정됨** (2026-04-19)

### 배경

`cache_read_tokens` / `cache_creation_tokens`는 Anthropic 프롬프트 캐싱 개념으로,
이를 모르는 사용자를 위해 호버 시 설명 제공이 필요하다.

구현 방식을 결정해야 한다.

### 고려한 옵션

| 옵션 | 방식 | 장점 | 단점 |
|------|------|------|------|
| A | HTML `title` 속성 | 구현 즉시, 코드 없음 | 브라우저 기본 스타일, 딜레이, 줄바꿈 제한 |
| B | CSS `::after` pseudo-element | 외부 의존성 없음, 완전한 스타일 제어 | 테이블 `overflow:hidden`에서 클리핑 위험 |
| C | JS `position:fixed` 툴팁 | 클리핑 없음, 리치 콘텐츠 가능 | JS 코드 추가 필요 |

### 결정

**옵션 C** 채택: JS `mouseenter`/`mouseleave` + `position: fixed` 방식

```html
<td class="cell-token num cache-cell"
    data-cache-read="1240"
    data-cache-write="3200">
  1.2K
</td>
```

```
툴팁 표시 내용:
Prompt Cache
⚡ Read   1,240 tokens  (×0.1 cost)
📝 Write  3,200 tokens  (×1.25 cost)
```

### 이유

1. 테이블 행에 `overflow: hidden`이 적용되어 있어 CSS pseudo-element 방식은 클리핑 발생
2. `title` 속성은 Read/Write 두 줄 + 비용 배율 정보를 표현하기에 포맷 제약이 큼
3. 프로젝트가 이미 vanilla JS 방식으로 동적 UI 처리 중 — 추가 의존성 없이 구현 가능
4. Cache 셀은 `prompt` 타입 row에만 존재 → 툴팁 이벤트 수가 적어 성능 부담 없음

---

## ADR-005: "캐시 히트율" 명칭 오류 수정

### 상태
**결정됨** (2026-04-19)

### 배경

현재 코드에서 `cacheHitBadge()` 함수의 `title` 속성이 "캐시 히트"로 표시되나,
실제로는 `cache_read_tokens` 원시 토큰 수를 표시하고 있다.

캐시 히트율(Hit Rate)은 비율(%)이므로 현재 표시와 개념이 다르다.

```
Cache Hit Rate = cache_read_tokens / (tokens_input + cache_read_tokens) × 100%
```

### 결정

- 컬럼 명칭: `Cache` (히트율이 아닌 캐시 토큰 수 표시임을 명확히)
- 히트율(%) 계산 및 표시는 이번 범위에서 **제외** (별도 기능으로 분리)
- `cache_creation_tokens`는 툴팁에서만 표시

### 이유

1. 잘못된 명칭을 그대로 유지하는 것은 사용자 혼란 유발
2. 히트율 계산은 단순하나 "입력 토큰의 어느 부분이 캐시였는가"를 정의하는 추가 설계가 필요 → 이번 범위 외
