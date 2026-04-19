# stat-card-tooltip 개발 계획

> Feature: stat-card-tooltip
> 작성일: 2026-04-19
> 작성자: Claude Code

## 목표

summary strip에 새로 추가된 4개 지표(COST, SAVED, P95, ERR)에 hover 툴팁을 추가하여
각 지표의 계산 방식과 의미를 사용자에게 인라인으로 설명한다.

기존 `cache-tooltip.js` 패턴(position:fixed + 이벤트 위임)을 그대로 따르며,
CSS 클래스도 최대한 재사용하여 코드 중복을 최소화한다.

## 범위

### 포함

- `packages/web/assets/js/stat-tooltip.js` 신규 파일 생성
  - `initStatTooltip()` export
  - `data-stat-tooltip` 속성 기반 이벤트 위임 (mouseover / mousemove / mouseout)
  - 4개 툴팁 콘텐츠 정의 (COST, SAVED, P95, ERR)
  - 뷰포트 충돌 방지 위치 계산 (cache-tooltip 동일 로직)
- `packages/web/assets/css/badges.css` 에 `.stat-tooltip` 스타일 추가
  - `.cache-tooltip` 기본 구조 상속, stat-card 전용 너비/여백 조정
- `packages/web/index.html` 4개 stat-card에 `data-stat-tooltip` 속성 추가
- `packages/web/assets/js/main.js` 에 `initStatTooltip()` import + `init()` 내 호출

### 제외

- 서버 API 변경 없음
- DB 스키마 변경 없음
- 기존 `.cache-tooltip` CSS 수정 없음 (하위 호환 유지)

## 단계별 계획

### 1단계: stat-tooltip.js 신규 작성

`cache-tooltip.js` 구조를 참고하여 동일한 패턴으로 구현한다.

- `tooltip` div 생성 → `document.body` append
- 4개 stat-card 식별자 → `data-stat-tooltip="cost|saved|p95|err"` 속성 사용
- 각 key에 대응하는 제목/설명 맵 정의
- mouseover 시 해당 key의 콘텐츠 렌더링 후 표시
- mousemove 시 위치 갱신 (뷰포트 경계 보정)
- mouseout 시 숨김

툴팁 콘텐츠 맵:

| key | 제목 | 설명 |
|-----|------|------|
| cost | Today's API Cost | model별 단가 × (input + output + cache_create + cache_read tokens) 합산 |
| saved | Cache Savings | 프롬프트 캐시 덕분에 절약된 비용. cache_read 단가가 일반 input의 10% 수준 |
| p95 | P95 Response Time | tool_call 응답시간의 95번째 백분위. 상위 5% 느린 요청 제외한 기준 |
| err | Tool Error Rate | tool_call 중 오류 응답 비율. 5% 초과 시 빨간색 경고 |

### 2단계: badges.css에 .stat-tooltip 스타일 추가

`.cache-tooltip` 클래스를 base로, stat-card 툴팁에 필요한 너비/레이아웃만 조정한다.

- `.stat-tooltip` : `.cache-tooltip`과 동일한 position:fixed, z-index, background, border, shadow 적용
- `.stat-tooltip-title` : `.cache-tooltip-title`과 동일
- `.stat-tooltip-desc` : 설명 텍스트용 스타일 (color: var(--text-muted), line-height 1.5)

### 3단계: index.html stat-card에 data 속성 추가

```html
<div class="stat-card" data-stat-tooltip="cost"> ... </div>
<div class="stat-card" data-stat-tooltip="saved"> ... </div>
<div class="stat-card" data-stat-tooltip="p95"> ... </div>
<div class="stat-card" data-stat-tooltip="err"> ... </div>
```

cursor: help 처리는 CSS에서 `.stat-card[data-stat-tooltip]` 선택자로 적용한다.

### 4단계: main.js import + 초기화

```js
import { initStatTooltip } from './stat-tooltip.js';
// init() 내부
initStatTooltip();
```

## 완료 기준

- [ ] `#stat-cost` hover 시 "Today's API Cost" 툴팁 표시
- [ ] `#stat-cache-savings` hover 시 "Cache Savings" 툴팁 표시
- [ ] `#stat-p95` hover 시 "P95 Response Time" 툴팁 표시
- [ ] `#stat-error-rate` hover 시 "Tool Error Rate" 툴팁 표시
- [ ] 툴팁이 뷰포트 밖으로 나가지 않음
- [ ] 하드코딩 색상 없음 (CSS 변수만 사용)
- [ ] 기존 `.cache-tooltip` 동작에 영향 없음
