---
feature: session-story-cards
title: Feature G — Session Story Cards (턴 뷰 카드 UI 개선)
status: pending
priority: 7
---

## 작업 목표

세션 상세 뷰의 Turn 탭을 기존 테이블에서 카드 형식으로 개선한다.
"이 세션에서 무슨 일이 있었는지"를 스토리처럼 읽을 수 있게 만든다.

## 카드 구조

```
┌─────────────────────────────────────────────────────┐
│ T3  "left-panel 리사이즈 구현..."          🔺 복잡  │
│ ─────────────────────────────────────────────────── │
│ 도구 흐름:  [Read×3] → [Grep×2] → [Edit×4] → [Bash] │
│ ─────────────────────────────────────────────────── │
│ 입력 45K   출력 3.2K   💰 $0.018   ⏱ 34.2s         │
└─────────────────────────────────────────────────────┘
```

### 카드 헤더
- 턴 번호 (T1, T2...)
- prompt preview 첫 60자 (있는 경우)
- 복잡도 배지: 도구 호출 수 × 평균 토큰 기준
  - 낮음(< 5 calls): 기본
  - 중간(5~15 calls): 주황 배지
  - 높음(> 15 calls): 빨강 배지 🔺

### 카드 바디 — 도구 흐름 타임라인 바
- 도구 호출 시퀀스를 미니 chip으로 표시
- 같은 도구 연속이면 "Read×3" 으로 축약
- 색상: 도구 타입별

### 카드 푸터
- tokens_input / tokens_output
- 계산된 비용 (USD)
- 소요 시간

## 단계별 실행 계획

### Step 1 — 서버: 턴 요약 데이터 확인
- 기존 `/api/sessions/:id` 응답의 turn 데이터 구조 확인
- 각 turn에 tool sequence (순서대로 tool_name 배열) 포함 여부 확인
- 없으면 turn별 requests 배열에서 client-side 계산

### Step 2 — 카드 렌더러 (packages/web/assets/js/)
- `session-detail.js` 내 `renderTurnCards(turns)` 함수 추가
- 도구 흐름 chip 생성: 연속 중복 압축 알고리즘
- 복잡도 점수 계산

### Step 3 — 스타일 (packages/web/assets/css/turn-view.css)
- 카드 레이아웃 (border, shadow, gap)
- 도구 chip 스타일 (미니 배지)
- 카드 hover 효과
- 기존 테이블 뷰와 토글 가능하게 (선택)

## 영향 파일

```
packages/web/assets/js/session-detail.js  — 턴 카드 렌더러 추가
packages/web/assets/css/turn-view.css     — 카드 및 chip 스타일
packages/web/index.html                   — 뷰 전환 버튼 추가 (선택)
```

## 예상 소요 시간

약 2시간 (렌더러 1시간 + 스타일 1시간)
