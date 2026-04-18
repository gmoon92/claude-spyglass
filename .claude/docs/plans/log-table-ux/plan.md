# Log Table UX 개선 계획

> 작성일: 2026-04-18  
> Feature: log-table-ux

---

## 작업 목표

웹 대시보드의 로그 화면(플랫 뷰, 턴 뷰, 최근 요청 피드)에서 다음 UX 문제를 해결한다.

1. **타입+툴 컬럼 통합**: 현재 별도로 표시되는 "타입"과 "툴" 컬럼을 관측 의미론 중심의 단일 컬럼으로 통합
2. **관측 맥락 추가**: 단순 호출 여부를 넘어 "어떤 입력값으로 수행됐는지" 알 수 있는 메시지/맥락 정보 제공
3. **레이아웃 안정성**: 데이터가 길어질 때 컬럼 위치가 흔들리는 문제 수정
4. **여백 최적화**: 과도하게 넓은 여백을 실제 데이터 밀도에 맞게 조정
5. **공통 적용**: 변경된 설계를 사용자 데이터를 노출하는 모든 화면에 일관 적용

---

## 현재 구조 분석

### 로그 테이블 컬럼 (플랫 뷰 / 최근 요청)

| 컬럼 | 필드 | 문제 |
|------|------|------|
| 시각 | timestamp | - |
| 타입 | type (prompt/tool_call/system) | 별도 컬럼, 툴과 분리됨 |
| 툴 | tool_name + tool_detail | 별도 컬럼, 타입과 분리됨 |
| 입력 | tokens_input | - |
| 출력 | tokens_output | - |
| 응답시간 | duration_ms | - |
| 세션 | session_id | - |

### 데이터 구조 (Request 엔티티)

```typescript
interface Request {
  type: 'prompt' | 'tool_call' | 'system';
  tool_name?: string;       // tool_call 타입일 때 존재
  tool_detail?: string;     // tool_call 타입일 때 존재 (JSON/key=value)
  model?: string;           // prompt 타입일 때 존재
  preview?: string;         // 프롬프트 미리보기 텍스트
  payload?: string;         // 전체 요청 페이로드
  tokens_input: number;
  tokens_output: number;
  duration_ms: number;
  cache_read_tokens?: number;
  cache_creation_tokens?: number;
}
```

### 사용자 데이터 노출 화면 목록

1. **최근 요청 테이블** (메인 대시보드 우측) - makeRequestRow()
2. **플랫 뷰 테이블** (세션 상세, Flat 탭) - renderDetailRequests()
3. **턴 뷰** (세션 상세, Turn 탭) - renderTurnView()
4. **좌측 패널 - 툴 통계** - renderToolStats()
5. **좌측 패널 - 세션 브라우저** - renderSessions()

---

## 핵심 문제 정의

### 문제 1: 타입-툴 분리로 인한 의미 단절

현재 "타입" 컬럼은 P/T/S 배지만 보여주고, "툴" 컬럼은 도구명만 보여준다.
사용자는 두 컬럼을 조합해야 "tool_call 타입의 Bash 도구"라는 의미를 파악할 수 있다.
→ 하나의 컬럼으로 통합하되, 새로운 관측 의미론적 명칭 사용 검토

### 문제 2: 관측 맥락 부재

- `prompt` 타입: 어떤 사용자 입력 또는 시스템 지시로 이 요청이 발생했는지 불명확
- `tool_call` 타입: 어떤 인자(argument)로 도구가 호출됐는지 현재 tool_detail이 짧게 표시되지만 한계 있음
- `system` 타입: 어떤 시스템 컨텍스트가 주입됐는지 전혀 알 수 없음
→ "수행 맥락(context)" 또는 "입력 요약(input preview)" 을 인라인 또는 확장 형태로 제공

### 문제 3: 레이아웃 불안정성

- `tool_detail`이 길어지면 툴 셀 높이가 증가하여 인접 셀이 수직으로 밀림
- 플랫 뷰의 `cell-*` 클래스들이 `min-width`/`max-width` 없이 가변 너비로 동작
- 타임스탬프 등 고정 너비 컬럼도 데이터에 따라 크기가 달라짐
→ 컬럼별 고정/최소 너비 지정, 오버플로우 처리 통일

### 문제 4: 과도한 여백

- 일부 `td`에 불필요한 `padding`이 적용되어 실제 데이터보다 행 높이가 큼
- 특히 툴 셀(`tool-cell`)이 `flex-direction: column`으로 구성돼 있어 단일 라인도 2줄 공간 차지
→ 여백 값 재조정, 컴팩트 모드 적용

---

## 기술 스택

- **Frontend**: Vanilla JS + HTML (단일 파일 `packages/web/index.html`)
- **Backend**: Bun + TypeScript (`packages/server/`)
- **DB**: SQLite (`packages/db/`)
- **스타일**: CSS 변수 기반 인라인 스타일 + `<style>` 태그

---

## 중요 제약 사항

**UI 표현만 변경, 데이터 구조는 불변:**
- DB 스키마 (`type`, `tool_name`, `tool_detail` 필드) 변경 없음
- API 응답 구조 변경 없음
- 오직 렌더링 함수와 CSS만 수정

---

## 설계 후보 방향

> 모든 방향에서 `type`, `tool_name`, `tool_detail` 데이터는 그대로 사용.
> 단지 화면에서 "타입" 컬럼과 "툴" 컬럼을 **하나의 셀로 합쳐서** 렌더링하는 방식만 다름.

### 방향 A: "행위(Action)" 단일 컬럼

타입 배지 + 툴명/모델명을 하나의 셀로 합성:
- `prompt` → `[P] claude-sonnet-4-6`
- `tool_call` → `[T] Bash`
- `system` → `[S]`

**장점**: 컬럼 수 감소로 다른 정보 열에 공간 확보  
**단점**: 타입/툴 각각의 값을 개별로 읽기 어려울 수 있음

### 방향 B: "행위+맥락" 2단 단일 컬럼

동일 셀에 타입+툴명(1행)과 맥락 미리보기(2행) 표시:
- `prompt` → `[P] claude-sonnet-4-6` / `"파일을 분석해주세요..."`
- `tool_call` → `[T] Bash` / `ls -la /path`
- `system` → `[S]` / `CLAUDE.md 로드됨`

**장점**: 관측 맥락까지 한 셀에서 파악  
**단점**: 행 높이 증가 가능성 (단, 현재 여백 최적화로 상쇄 가능)

### 방향 C: 타입 컬럼 제거 + 툴 컬럼 확장

"타입" 컬럼을 없애고, "툴" 컬럼을 아이콘/배지로 타입을 암시:
- prompt → 모델 아이콘 + 모델명
- tool_call → 도구 아이콘 + 도구명
- system → 시스템 아이콘

**장점**: 시각적으로 가장 깔끔  
**단점**: 타입 구분이 색상/아이콘에만 의존

---

## 적용 범위

**공통 변경 대상:**
- `makeRequestRow()` - 최근 요청 테이블
- `renderDetailRequests()` - 플랫 뷰 테이블
- `renderTurnView()` 내 툴/프롬프트 행
- CSS 변수 및 공통 스타일

**개별 조정 대상:**
- 툴 통계 패널 (`renderToolStats()`)
- 세션 브라우저 (`renderSessions()`)
