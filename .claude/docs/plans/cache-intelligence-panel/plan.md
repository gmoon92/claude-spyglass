---
feature: cache-intelligence-panel
title: Feature B — Cache Intelligence Panel
status: in-progress
priority: 3
updated: 2026-04-19
---

## 작업 목표

타임라인 차트 + 도넛 차트 영역 옆(아래)에 캐시 효율을 시각화하는 독립 패널을 추가한다.
"캐시가 얼마나 작동하고 있는가"와 "덕분에 얼마를 절약했는가"를 한눈에 보여준다.

## 패널 구성 (3개 섹션)

```
┌─────────────────────────────┐
│  CACHE EFFICIENCY           │
│                             │
│  Hit Rate  ████████░  83%   │
│                             │
│  without cache  $40.21      │
│  actual cost    $6.59       │
│  saved          $33.62 (84%)│
│                             │
│  creation ██░░ read  72%    │
└─────────────────────────────┘
```

### 1. Cache Hit Rate 프로그레스 바
- 계산: `cache_read_tokens / (tokens_input + cache_read_tokens) × 100`
- 표시: 수평 프로그레스 바 (0~100%)
- 색상: < 30% 빨강(`--red`), 30~70% 노랑(`--orange`), > 70% 초록(`--green`)

### 2. 비용 비교 3줄
- without cache: 캐시 없었다면 지불했을 금액
- actual cost: 실제 지불 금액
- saved: 절약액 + 절약률

### 3. Cache Creation vs Read 비율 미니 바
- cache_creation_tokens : cache_read_tokens 비율
- 생성이 많으면 "구축 중", 읽기가 많으면 "안정화" 상태 표시

## 단계별 실행 계획

### Step 1 — 서버: `/api/stats/cache` 엔드포인트 추가
- `packages/server/src/api.ts` 에 `GET /api/stats/cache` 라우트 추가
- `getCacheStats(db, fromTs, toTs)` 호출 (`packages/storage` 에 이미 구현됨)
- 날짜 필터(`from`/`to`) 쿼리 파라미터 지원
- 응답: `{ success: true, data: CacheStats }`

### Step 2 — HTML 구조 추가
- `packages/web/index.html` — `.charts-inner` 그리드 아래에 `.cache-panel` div 삽입
- `index.html` 에 `cache-panel.css` link 태그 추가

### Step 3 — CSS 작성 (`cache-panel.css` 신규)
- `.cache-panel` 레이아웃 (border-top 구분선으로 차트 섹션 하단에 붙임)
- 프로그레스 바: `.cache-hit-bar` + `.cache-hit-fill` (width transition)
- 색상 임계값 CSS 변수: `--cache-bar-color` 동적 클래스로 분기
- 비용 줄 스타일: `.cache-cost-row`, `.cache-cost-label`, `.cache-cost-value`
- 미니 Creation/Read 바: `.cache-ratio-bar`

### Step 4 — JS 렌더러 (`cache-panel.js` 신규)
- `renderCachePanel(data)` 함수: 위 필드 수신 후 DOM 업데이트
- `showCachePanelSkeleton()`: 초기 로딩 skeleton 표시
- 색상 분기 로직: hitRate < 0.3 → `is-low`, < 0.7 → `is-mid`, else `is-high`

### Step 5 — API 연동 (`api.js` 수정, `main.js` import 추가)
- `fetchCacheStats()` 함수를 `api.js` 에 추가
- `fetchDashboard()` 내에서 함께 호출 (날짜 필터 공유)
- `main.js` import 및 `init()` 내 초기 `fetchCacheStats()` 호출

## 영향 파일

```
packages/server/src/api.ts                      — /api/stats/cache 엔드포인트 추가
packages/web/index.html                         — 캐시 패널 HTML + CSS link
packages/web/assets/css/cache-panel.css         — 신규: 캐시 패널 스타일
packages/web/assets/js/cache-panel.js           — 신규: 캐시 패널 렌더러
packages/web/assets/js/api.js                   — fetchCacheStats() 추가
packages/web/assets/js/main.js                  — import + init 호출
```

## 완료 기준

- [ ] `GET /api/stats/cache` 정상 응답
- [ ] 캐시 패널이 chartSection 내에 표시됨
- [ ] Hit Rate 프로그레스 바: 값에 따라 빨강/노랑/초록 색상 전환
- [ ] 비용 비교 3줄(without / actual / saved) 정상 표시
- [ ] Creation vs Read 미니 바 표시
- [ ] 데이터 없을 때 `--` 또는 skeleton 표시
- [ ] CSS 변수만 사용 (하드코딩 색상 없음)
- [ ] 날짜 필터 변경 시 캐시 패널 데이터 갱신

## 예상 소요 시간

약 1.5시간 (서버 20분 + CSS/HTML 30분 + JS 렌더러 30분 + 연동 10분)
