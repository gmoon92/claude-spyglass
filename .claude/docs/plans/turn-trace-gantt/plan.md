---
feature: turn-trace-gantt
title: Feature C — Turn Trace Gantt (도구 실행 시퀀스 Gantt 차트)
status: pending
priority: 5
---

## 작업 목표

세션 상세 뷰의 턴(Turn) 탭에 각 턴별 도구 실행 시퀀스를 Gantt 차트로 시각화한다.
"이 턴에서 어떤 도구가 얼마나 걸렸는가"와 "어떤 도구가 병목인가"를 보여준다.

## Gantt 차트 구조

```
Turn T3  ████████████████████████████  총 12.3s

  Read   [====]                           0.8s
  Grep        [==]                        0.4s
  Read            [===]                   0.9s
  Bash                [===========]       8.1s  ← 병목!
  Edit                           [==]     2.1s
```

- X축: 상대 시간 (턴 시작 기준, ms)
- Y축: 각 도구 호출 (행)
- 색상: 도구 타입별
  - Read/Glob: 파란계열
  - Bash: 초록계열
  - Edit/Write: 주황계열
  - Grep: 보라계열
  - Agent/MCP: 빨간계열
- 호버 시 툴팁: 도구명, 파라미터, 소요 시간

## 단계별 실행 계획

### Step 1 — 서버: 턴별 도구 상세 데이터 (packages/storage, packages/server)
- 기존 `/api/sessions/:id` 응답에 각 request의 `timestamp`, `duration_ms` 포함 확인
- turn_id 그룹 내 tool_call 타입만 필터링, 시간 순 정렬
- 첫 tool_call timestamp를 턴 시작 기준으로 상대 시간 계산

### Step 2 — SVG Gantt 렌더러 (packages/web/assets/js/)
- `gantt.js` 신규 파일: SVG 기반 Gantt 차트 렌더러
  - `renderGantt(container, toolCalls)` 함수
  - 각 도구 → SVG rect 요소 (x: 시작 시간, width: duration)
  - 도구 타입별 색상 매핑
  - 툴팁: mouseover 이벤트
  - 스크롤 가능한 가로 레이아웃

### Step 3 — 턴 뷰 통합 (packages/web/assets/js/session-detail.js)
- 기존 Turn 탭에 턴 카드 클릭 → 해당 턴의 Gantt 펼침 (accordion 패턴)
- 또는 턴 목록 우측에 미니 Gantt 인라인 표시

### Step 4 — 스타일 (packages/web/assets/css/turn-view.css)
- Gantt 컨테이너 스타일
- 도구 타입별 색상 CSS 변수

## 영향 파일

```
packages/web/assets/js/gantt.js           — 신규: SVG Gantt 렌더러
packages/web/assets/js/session-detail.js  — 턴 클릭 시 Gantt 렌더 호출
packages/web/assets/css/turn-view.css     — Gantt 스타일
packages/web/index.html                   — 필요 시 컨테이너 추가
```

## 예상 소요 시간

약 2.5시간 (SVG 렌더러 1.5시간 + 통합 1시간)
