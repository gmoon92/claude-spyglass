# detail-header-layout — Architecture Decision Records

> Feature: detail-header-layout
> 작성일: 2026-04-19

---

## ADR-001: flex-wrap 제거 + overflow:hidden 전략

### 상태
**결정됨** (2026-04-19)

### 배경
`detail-header`와 `detail-meta` 모두에 `flex-wrap: wrap`이 적용되어 있어, 집계 배지(`detail-agg-badges`)가 표시될 때 헤더가 2줄 이상으로 확장되는 문제가 발생함.

### 고려한 옵션

| 옵션 | 설명 | 장점 | 단점 |
|------|------|------|------|
| A | `flex-wrap` 제거 + `overflow:hidden` | 구조 단순, 1줄 완전 보장 | 오버플로우 항목 완전 숨김 |
| B | `max-height` 클리핑 | 구현 간단 | 빈 공간 시각적 부작용 우려 |

### 결정
`detail-header`와 `detail-meta` 모두에서 `flex-wrap: wrap`을 제거한다. `detail-header`와 `detail-meta` 모두 `overflow: hidden`을 적용하여 1줄을 강제한다.

### 이유
1. `flex-wrap: wrap`이 배지 추가 시 2줄 확장을 유발하는 직접적 원인이므로 제거가 근본 해결책
2. `max-height` 클리핑은 빈 공간이 생기는 시각적 부작용 우려로 기각

---

## ADR-002: 항목별 flex 축소 우선순위

### 상태
**결정됨** (2026-04-19)

### 배경
1줄 고정 레이아웃에서 공간이 부족할 때 어떤 항목을 우선 축소할지 명확한 우선순위가 필요함.

### 고려한 옵션

| 옵션 | 설명 | 장점 | 단점 |
|------|------|------|------|
| A | 프로젝트명 우선 축소 | 핵심 항목(ID, 버튼) 보호 | 경로가 많이 잘릴 수 있음 |
| B | 토큰/종료 시각 우선 축소 | 프로젝트명 최대 표시 | 숫자 정보 손실 |

### 결정
- `detail-session-id`: `flex-shrink: 0` — 항상 완전 표시
- `detail-project`: `flex: 1 1 0; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap` — 공간 부족 시 우선 축소
- `detail-tokens`(토큰/종료 시각): `flex-shrink: 0; white-space: nowrap` — 잘리지 않도록
- `detail-agg-badges`: `flex-shrink: 0` — 배지 완전 표시
- `btn-close`: 기존 `flex-shrink: 0` 유지

### 이유
1. 세션 ID와 닫기 버튼은 핵심 식별자/액션이므로 완전 표시 필수
2. 프로젝트 경로는 길어질 수 있고 축약해도 `title` 속성으로 전체 경로 확인 가능

---

## ADR-003: 인라인 스타일 → CSS 클래스

### 상태
**결정됨** (2026-04-19)

### 배경
HTML에 인라인 스타일 2개가 존재함:
- `detailEndedAt`: `style="color:var(--text-muted)"`
- `detailBadges`: `style="display:none"`

JS에서도 `badgesEl.style.display = 'none'/'flex'`로 직접 조작 중.

### 고려한 옵션

| 옵션 | 설명 | 장점 | 단점 |
|------|------|------|------|
| A | CSS 클래스로 이관 | 단일 책임, 유지보수 용이 | JS 변경 필요 |
| B | 인라인 스타일 유지 | 변경 없음 | CSS 일관성 저하 |

### 결정
- `style="color:var(--text-muted)"` → `detail-ended-at` CSS 클래스 신설
- `style="display:none"` → `detail-agg-badges--hidden` CSS 클래스 신설
- JS에서 `badgesEl.style.display` 직접 조작 → `classList.add/remove('detail-agg-badges--hidden')`

### 이유
1. 인라인 스타일은 CSS 유지보수 복잡도 증가
2. CSS 클래스로 이관 시 단일 책임 원칙 준수

---

## ADR-004: 배지 영역 레이아웃 — 가로 배치

### 상태
**결정됨** (2026-04-19)

### 배경
현재 `detail-agg-badges`에 `width: 100%`가 적용되어 배지 영역이 독립 행(full-width block)으로 동작함. 이것이 헤더 2줄화의 직접 원인.

### 고려한 옵션

| 옵션 | 설명 | 장점 | 단점 |
|------|------|------|------|
| A | `width:100%` 제거, `inline-flex`로 전환 | 1줄 배치 가능 | 배지 개수 증가 시 오버플로우 |
| B | 배지를 별도 행으로 유지 | 배지 표시 영역 충분 | 2줄 문제 해결 불가 |

### 결정
`detail-agg-badges`에서 `width: 100%`와 `flex-wrap: wrap`을 제거하고, `flex-shrink: 0; display: inline-flex; gap: 6px`으로 변경하여 배지를 가로 1줄로 배치한다.

### 이유
1. `width: 100%`가 배지를 독립 행으로 밀어내는 직접 원인이므로 제거 필수
2. 현재 배지 최대 2개로 제한되므로 오버플로우 위험 낮음
3. `flex-shrink: 0`으로 배지 자체는 축소되지 않도록 보호
