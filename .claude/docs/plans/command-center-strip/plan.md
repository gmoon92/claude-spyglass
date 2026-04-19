---
feature: command-center-strip
title: Feature A — Command Center (Summary Strip 강화)
status: in-progress
priority: 1
---

# command-center-strip 개발 계획

> Feature: command-center-strip
> 작성일: 2026-04-19
> 작성자: Claude Code

## 목표

상단 summary strip의 3개 지표(세션·요청·토큰)에 비용·캐시절약·P95·오류율 4개 지표를 추가하여
"Command Center"로 확장한다. 서버 API 변경 없이 기존 `/api/dashboard` 응답 필드를 최대한
활용하며, 프론트엔드(HTML/CSS/JS)만 수정하는 범위로 한정한다.

## 범위

- 포함:
  - `packages/web/index.html` — 구분선 + 4개 새 stat-card 추가
  - `packages/web/assets/css/summary-strip.css` — 구분선·경고 변형 스타일
  - `packages/web/assets/js/main.js` — strip 업데이트 로직 추가
  - `packages/web/assets/css/design-tokens.css` — 필요 시 토큰 추가
- 제외:
  - DB 스키마·마이그레이션
  - 서버 API 비즈니스 로직
  - 서버에서 아직 내려오지 않는 필드 계산 (클라이언트는 응답 있을 때만 표시)

## 추가 지표 (4개)

| id | label | 표시 예시 | 경고 조건 |
|----|-------|-----------|----------|
| `stat-cost` | cost | `$0.12` | — |
| `stat-cache-savings` | saved | `$0.08` | — |
| `stat-p95` | p95 | `3.2s` / `340ms` | — |
| `stat-error-rate` | err | `2.3%` | > 5% → `.is-alert` |

### 포맷 규칙

- 비용: `$` + toFixed(2) (예: `$0.12`)
- 캐시절약: `$` + toFixed(2) (예: `$0.08`)
- P95: `< 1000ms` → `Xms`, `>= 1000ms` → `X.Xs` (소수 1자리)
- 오류율: toFixed(1) + `%` (예: `2.3%`)
- 초기/미지원: `--`

## 단계별 계획

### 1단계: CSS 설계 (summary-strip.css)
- `.stat-divider` 구분선 컴포넌트 추가
- `.stat-value.is-alert` 경고색 변형 추가
- overflow/flex-shrink 처리로 한 줄 유지 보장

### 2단계: HTML 마크업 (index.html)
- 기존 5개 stat-card 뒤에 `.stat-divider` 삽입
- `#stat-cost`, `#stat-cache-savings`, `#stat-p95`, `#stat-error-rate` 4개 추가
- 초기값 `--`

### 3단계: JS 업데이트 로직 (main.js / api.js)
- `fetchDashboard()` 에서 새 필드 파싱 및 DOM 업데이트
- 비용·P95·오류율 포맷 함수 인라인 또는 formatters.js 추가
- 오류율 > 5% 시 `.is-alert` 토글

## 완료 기준

- [ ] summary-strip이 한 줄로 유지됨 (overflow 없음)
- [ ] 4개 새 stat-card가 올바른 id로 존재
- [ ] 구분선이 좌측 활동지표 / 우측 비용성능지표를 시각적으로 분리
- [ ] `.is-alert` 클래스가 오류율 > 5% 조건에서 적용
- [ ] 하드코딩 색상 없음 (CSS 변수만 사용)
- [ ] 데이터 미수신 시 `--` 표시

## 예상 소요 시간

약 1시간 (CSS 20분 + HTML 15분 + JS 25분)
