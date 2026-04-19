---
feature: context-growth-chart
title: Feature E — Context Growth Chart (세션 상세 컨텍스트 성장 곡선)
status: pending
priority: 4
---

## 작업 목표

세션 상세 뷰 상단에 턴별 tokens_input 성장 곡선을 표시한다.
"이 세션에서 컨텍스트가 어떻게 팽창했는가"와 "컨텍스트 윈도우가 얼마나 남았는가"를 보여준다.

## 차트 구성

### 메인 라인 차트
- X축: 턴 번호 (T1, T2, T3...)
- Y축(좌): tokens_input (누적 컨텍스트 크기)
- Y축(우): tokens_output (생성 토큰)
- 시각적 경고선: 모델 최대 컨텍스트 윈도우의 80% 지점

### 모델별 최대 컨텍스트 윈도우
```
claude-sonnet-4-*, claude-opus-4-*: 200,000 tokens
claude-haiku-4-*: 200,000 tokens
(기본값: 200,000)
```

### 인디케이터
- 현재 마지막 턴의 컨텍스트 사용률: "68% 사용 (136K / 200K)"
- 남은 컨텍스트: "64K tokens 남음"
- 추세 기반 예측: "이 속도면 T12에 한계 도달 예상"

## 단계별 실행 계획

### Step 1 — 서버: 턴별 토큰 집계 (packages/storage, packages/server)
- `getTokensByTurn(sessionId)` 쿼리: turn_id별 tokens_input/output 집계
- `/api/sessions/:id/turns` 또는 기존 엔드포인트에 token_summary 추가

### Step 2 — 프론트엔드: 차트 렌더링 (packages/web)
- 세션 상세 뷰(detail-view) 상단에 차트 컨테이너 추가
- `context-chart.js` 또는 기존 `chart.js`에 컨텍스트 성장 렌더러 추가
- 기존 chart.js의 타임라인 패턴 재사용 (Canvas API)
- 경고선 (80% 지점) 점선으로 표시
- 마지막 데이터 포인트에 현재 사용률 툴팁

### Step 3 — 세션 선택 시 차트 업데이트
- `session-detail.js`에서 세션 활성화 시 차트 데이터 fetch & render

## 영향 파일

```
packages/storage/src/queries/request.ts   — 턴별 토큰 집계 쿼리
packages/server/src/index.ts              — 세션 상세 API에 턴 토큰 포함
packages/web/index.html                   — detail-view 상단 차트 컨테이너
packages/web/assets/css/detail-view.css   — 차트 영역 스타일
packages/web/assets/js/chart.js           — 컨텍스트 성장 차트 렌더러
packages/web/assets/js/session-detail.js  — 차트 초기화 및 업데이트
```

## 예상 소요 시간

약 2시간 (서버 45분 + 차트 렌더러 1시간 + 연결 15분)
