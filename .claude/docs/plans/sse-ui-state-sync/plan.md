# sse-ui-state-sync 개발 계획

> Feature: sse-ui-state-sync
> 작성일: 2026-04-19
> 작성자: Claude Code

## 목표

SSE 실시간 이벤트 수신 중 UI 상태(전환 잠금·검색 필터·유형 필터)가 무시되는 버그 3건을 수정한다.

## 배경

`prependRequest`는 SSE `new_request` 이벤트마다 새 행을 DOM 최상단에 무조건 삽입한다.
이 과정에서 현재 활성화된 UI 상태(세션 전환 중 여부, 검색어, 유형 필터)를 전혀 고려하지 않아
세 가지 독립적인 버그가 발생한다.

## 버그 상세

### Bug 1: `isTransitioning` stuck → 세션 클릭 마비
- **위치**: `main.js:71` `selectSession`
- **원인**: `uiState.isTransitioning = true` 후 복구를 `detailView`의 `transitionend` 이벤트에만 의존.
  SSE DOM 조작이 CSS transition을 방해하면 `transitionend` 미발화 → stuck 상태.
- **증상**: 이후 모든 세션 클릭이 `if (uiState.isTransitioning) return`으로 영구 무시.
  새로고침 시에만 일시 복구.

### Bug 2: SSE가 검색 필터 무시
- **위치**: `main.js:126` `prependRequest` + `initEventDelegation`
- **원인**: `prependRequest` 후 `feed:updated` 이벤트를 dispatch하지 않음.
  `applyFeedSearch`는 `feed:updated`를 수신할 때만 실행되므로 SSE 신규 행에는 필터가 적용되지 않음.
- **증상**: 검색어 입력 중 관련 없는 행이 그대로 노출됨.

### Bug 3: SSE가 유형 필터 무시
- **위치**: `main.js:126` `prependRequest`
- **원인**: `prependRequest`가 `api.js`의 `reqFilter` 상태를 참조하지 않음.
  유형 필터(prompt/tool_call/system)가 선택된 상태에서 모든 타입의 행이 그냥 삽입됨.
- **증상**: 유형 필터 적용 후 SSE 이벤트 수신 시 필터와 무관한 행이 노출됨.

## 범위

- **포함**
  - Bug 1: `transitionend` 의존 제거, 타임아웃 fallback 추가
  - Bug 2: `prependRequest` 내 `feed:updated` dispatch 추가
  - Bug 3: `prependRequest` 내 `reqFilter` 상태 확인 후 행 표시 여부 결정
- **제외**
  - 날짜 범위 필터(`dateFilter`)와 SSE 연동 — 현재 날짜 필터는 API 재조회 방식이라 별도 이슈
  - `appendRequests` (더 불러오기) 경로 — SSE와 무관

## 영향 파일

| 파일 | 변경 내용 |
|------|-----------|
| `packages/web/assets/js/main.js` | `selectSession` transition 복구 로직, `prependRequest` 필터 연동 |
| `packages/web/assets/js/api.js` | `reqFilter` getter export 추가(선택) |

## 단계별 계획

### 1단계: Bug 1 수정 — isTransitioning 안전 복구
- `transitionend` 리스너에 `setTimeout` fallback(예: 500ms) 추가
- transition이 발화되지 않아도 일정 시간 후 자동으로 `isTransitioning = false`
- `{ once: true }` 리스너는 유지하되 fallback timer와 경쟁

### 2단계: Bug 2·3 수정 — prependRequest 필터 연동
- `prependRequest`에서 새 `<tr>` 삽입 직후 `feed:updated` 이벤트 dispatch
  → `applyFeedSearch`가 자동 실행되어 검색 필터 적용
- `reqFilter` 상태를 읽어 `all`이 아닌 경우 현재 행의 `r.type`과 비교
  → 일치하지 않으면 `tr.style.display = 'none'` 처리
- 인플레이스 업데이트(`existing` 분기) 경우도 동일 적용

### 3단계: 검증
- SSE 수신 중 세션 클릭 → isTransitioning stuck 재현 불가 확인
- 검색어 입력 후 SSE 이벤트 대기 → 관련 없는 행 미노출 확인
- 유형 필터 선택 후 SSE 이벤트 대기 → 해당 유형만 노출 확인

## 완료 기준

- [ ] 세션을 한 번 클릭 후 닫았다가 다시 클릭해도 SSE 이벤트와 무관하게 정상 동작
- [ ] 검색어 필터링 상태에서 SSE 이벤트가 오면 검색 조건에 맞는 행만 노출
- [ ] 유형 필터 적용 상태에서 SSE 이벤트가 오면 해당 유형 행만 노출
- [ ] 코드 변경은 `main.js` (+ 필요시 `api.js`) 2파일 이하
