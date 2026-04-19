---
feature: tool-performance-summary
title: Feature F — Tool Performance Summary (도구 성능 분석 패널)
status: pending
priority: 6
---

## 작업 목표

도구별 평균 응답시간·성공률·비용 기여율을 분석하는 전용 패널을 추가한다.
"어떤 도구가 느리고, 실패가 많고, 비용이 가장 비싼가"를 한눈에 파악한다.

## 패널 구성 (3개 서브 차트)

### 1. 도구별 평균 응답시간 수평 바 차트
```
Bash    ████████████████████  8.2s  (P95: 23s)
Agent   ████████████          4.1s
Edit    ████                  1.3s
Read    ██                    0.7s
Grep    █                     0.3s
```

### 2. 도구별 성공/실패율 스택 바
- 초록: 성공, 빨강: 실패(오류 응답)
- tool_detail에서 오류 패턴 감지

### 3. 도구별 토큰 비용 기여 파이 차트 (또는 스택 바)
- tool_call 타입 요청의 tokens_total 합계를 도구별로 집계
- "Read가 전체 토큰의 38%"

## 단계별 실행 계획

### Step 1 — 서버: 도구 집계 쿼리 (packages/storage, packages/server)
- `getToolStats(projectName?, dateRange?)` 쿼리 추가:
  ```sql
  SELECT tool_name,
    COUNT(*) as call_count,
    AVG(duration_ms) as avg_duration,
    PERCENTILE(duration_ms, 0.95) as p95_duration,
    SUM(tokens_total) as total_tokens,
    SUM(CASE WHEN is_error THEN 1 ELSE 0 END) as error_count
  FROM requests
  WHERE type = 'tool_call'
  GROUP BY tool_name
  ORDER BY avg_duration DESC
  ```
- `/api/tools/stats` 신규 엔드포인트

### Step 2 — UI 패널 추가 (packages/web)
- view-section에 새 탭 또는 좌측 패널 하단에 토글 섹션 추가
- `tool-stats.js`: 도구 통계 패널 렌더러
  - 수평 바 차트 (CSS width 기반)
  - 스택 바 성공/실패율
  - 미니 파이 차트 (SVG)

### Step 3 — 필터 연동
- 프로젝트/날짜 필터 변경 시 도구 통계 자동 갱신

## 영향 파일

```
packages/storage/src/queries/request.ts   — 도구 집계 쿼리 추가
packages/server/src/index.ts              — /api/tools/stats 엔드포인트
packages/web/index.html                   — 도구 통계 패널 HTML
packages/web/assets/js/tool-stats.js      — 신규: 도구 통계 렌더러
packages/web/assets/css/tool-stats.css    — 신규: 도구 통계 스타일
```

## 예상 소요 시간

약 2.5시간 (서버 1시간 + UI 1.5시간)
