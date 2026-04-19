# command-center-strip Tasks

> Feature: command-center-strip
> 시작일: 2026-04-19
> 상태: 완료

## Tasks

### CSS

- [x] `summary-strip.css` — `.stat-divider` 컴포넌트 추가 (flex-item, 1px solid var(--border), align-self: stretch, margin 처리)
- [x] `summary-strip.css` — `.stat-value.is-alert` 변형 클래스 추가 (color: var(--red))
- [x] `summary-strip.css` — strip overflow 처리 확인 (overflow: hidden 추가)

### HTML

- [x] `index.html` — 기존 5번째 stat-card(`statAvgDuration`) 뒤에 `.stat-divider` 삽입
- [x] `index.html` — `#stat-cost` stat-card 추가 (label: cost, 초기값: --)
- [x] `index.html` — `#stat-cache-savings` stat-card 추가 (label: saved, 초기값: --)
- [x] `index.html` — `#stat-p95` stat-card 추가 (label: p95, 초기값: --)
- [x] `index.html` — `#stat-error-rate` stat-card 추가 (label: err, 초기값: --)

### JavaScript

- [x] `api.js` `fetchDashboard()` — `d.summary?.costUsd` 파싱 → `#stat-cost` 업데이트 (`$X.XX` 포맷, null이면 건너뜀)
- [x] `api.js` `fetchDashboard()` — `d.summary?.cacheSavingsUsd` 파싱 → `#stat-cache-savings` 업데이트 (`$X.XX` 포맷)
- [x] `api.js` `fetchDashboard()` — `d.summary?.p95DurationMs` 파싱 → `#stat-p95` 업데이트 (`< 1000ms` → `Xms`, `>= 1000ms` → `X.Xs`)
- [x] `api.js` `fetchDashboard()` — `d.summary?.errorRate` 파싱 → `#stat-error-rate` 업데이트 (`X.X%` 포맷, `> 5` → `.is-alert` 토글)

## 완료 기준

- [x] summary-strip이 한 줄로 유지됨 (overflow: hidden 처리)
- [x] `.stat-divider`가 활동 지표 / 비용·성능 지표 사이에 시각적으로 표시됨
- [x] 4개 새 stat-card가 올바른 id로 존재하고 초기값 `--` 표시
- [x] 서버 응답 필드 수신 시 올바른 포맷으로 업데이트됨
- [x] 오류율 > 5% 시 `.is-alert` 적용, 이하 시 제거
- [x] 하드코딩 색상 없음 (CSS 변수만 사용)
