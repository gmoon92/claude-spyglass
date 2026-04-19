---
feature: anomaly-detection
title: Feature D — Anomaly Detection (요청 피드 이상 감지 배지)
status: in-progress
priority: 2
updated: 2026-04-19
---

## 작업 목표

요청 피드의 각 행에 이상 패턴을 자동 감지하여 인라인 배지를 표시한다.
추가 데이터 수집 없이 프론트엔드 계산만으로 구현한다.

## 감지 규칙 (4종)

| 배지 | 조건 | 의미 |
|------|------|------|
| 🔺 Token Spike | tokens_input이 같은 세션 평균 대비 200% 초과 | 갑작스러운 컨텍스트 폭발 |
| 🔄 Loop | 동일 turn_id 내 같은 tool_name 3회 이상 연속 | 에이전트 루프 의심 |
| 🐌 Slow | duration_ms가 현재 뷰 기준 P95 초과 | 비정상적으로 느린 실행 |
| ❌ Error | tool_detail 또는 기존 오류 배지 보유 | 도구 실패 (기존 강화) |

## 단계별 실행 계획

### Step 1 — 이상 감지 로직 (packages/web/assets/js/)
- `anomaly.js` 신규 파일 작성
- `detectAnomalies(requests)` 함수: 요청 배열을 순회하며 각 행에 anomaly 플래그 계산
  - Token Spike: 세션별 평균 tokens_input 계산 → 200% 초과 여부
  - Loop: turn_id 그룹 내 연속 동일 tool_name 카운트
  - Slow: 전체 duration_ms 배열에서 P95 계산 → 초과 여부

### Step 2 — 배지 렌더링 (packages/web/assets/js/renderers.js)
- 기존 `renderRequestRow()` 에 anomaly 플래그 파라미터 추가
- Target 컬럼 또는 별도 컬럼에 배지 HTML 삽입
- 복수 배지 동시 표시 가능

### Step 3 — 스타일 (packages/web/assets/css/badges.css)
- `.badge-spike`, `.badge-loop`, `.badge-slow` 스타일 추가
- 기존 배지 시스템과 일관성 유지

### Step 4 — 실시간 재계산
- SSE로 새 요청 수신 시 전체 뷰 데이터 기준 재계산
- 또는 슬라이딩 윈도우(최근 50건) 기준으로 계산

## 영향 파일

```
packages/web/assets/js/anomaly.js         — 신규: 이상 감지 로직
packages/web/assets/js/renderers.js       — 행 렌더링에 배지 추가
packages/web/assets/css/badges.css        — 신규 배지 스타일
packages/web/assets/js/main.js            — anomaly.js import 및 호출
```

## 예상 소요 시간

약 1시간 (감지 로직 30분 + UI 30분)
