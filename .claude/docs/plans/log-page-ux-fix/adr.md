# log-page-ux-fix ADR

> Feature: log-page-ux-fix
> 작성일: 2026-04-19
> 작성자: Claude Code

---

## ADR-001: cell-target ellipsis 처리 방식

### 상태
**결정됨** (2026-04-19)

### 배경
`td.cell-target`에 `overflow: hidden`만 있고 `text-overflow: ellipsis`와 `white-space: nowrap`이 누락되어 있다.
인접한 `td.cell-model`은 이미 3종 세트를 모두 갖추고 있으나 cell-target만 불완전하게 적용되어 있어,
긴 툴명(예: `Agent(long-skill-name)`)이 컬럼 경계를 넘어 레이아웃을 깨뜨릴 수 있다.

### 고려한 옵션

| 옵션 | 설명 | 장점 | 단점 |
|------|------|------|------|
| A | `td.cell-target`에 3종 세트 추가 | 인접 셀과 일관, 버그 수정 | 없음 |
| B | `.target-cell-inner`에 적용 | 이너 span 수준 제어 | td 레벨 overflow 없으면 td 자체가 늘어남 |

### 결정
옵션 A — `td.cell-target`에 `text-overflow: ellipsis; white-space: nowrap;` 추가.

### 이유
1. `td.cell-model`과 동일한 패턴으로 일관성 확보
2. td 레벨에서 overflow를 막아야 table-layout: fixed가 정상 동작함
3. `.target-cell-inner`는 이미 `overflow: hidden`이 있으므로 부모 td가 제한하는 구조가 맞음

---

## ADR-002: 총글자수 힌트 처리 방식

### 상태
**결정됨** (2026-04-19)

### 배경
`togglePromptExpand()`에서 텍스트 500자 초과 시 `─── 총 N자 ───`를 본문 끝에 append한다.
그러나 확장 패널은 전체 텍스트를 표시하므로 "잘린 텍스트"라는 오해를 유발한다.
사용자가 텍스트 복사 시 힌트 문구도 함께 복사되는 부작용도 있다.

### 고려한 옵션

| 옵션 | 설명 | 장점 | 단점 |
|------|------|------|------|
| A | 힌트 완전 제거 | 복사 부작용 제거, 오해 없음 | 글자 수 정보 손실 |
| B | 문구 변경 (`─── 전체 텍스트 (총 N자) ───`) | 정보 유지 | 복사 시 여전히 포함됨 |
| C | 힌트를 별도 `<div>`로 분리하여 복사 제외 | 정보 유지 + 복사 제외 | DOM 구조 복잡도 증가 |

### 결정
옵션 A — 힌트 완전 제거.

### 이유
1. 확장 패널 자체가 전체 텍스트를 보여주므로 글자 수 힌트는 중복 정보임
2. 복사 버튼으로 복사 시 힌트 문구가 포함되는 부작용 제거
3. DOM 구조를 단순하게 유지 (옵션 C 대비)
4. 필요 시 tooltip에 이미 `총 N자` 정보가 포함되어 있음 (`contextPreview()` 참조)

---

## ADR-003: 신규 CSS 토큰 명명 체계

### 상태
**결정됨** (2026-04-19)

### 배경
기존 `--accent-dim`(rgba 0.1)이 있으나 더 연한 accent 배경(0.04, 0.07)과
역할별 배지 배경(blue 0.18, red 0.18)이 하드코딩으로 산재되어 있다.
border-radius도 4px/6px 혼재가 발생하여 토큰화가 필요하다.

### 고려한 옵션 — accent 배경 토큰

| 옵션 | 명명 예시 | 장점 | 단점 |
|------|----------|------|------|
| A | `--accent-bg-light` / `--accent-bg-medium` | 의미 명확 | 기존 dim 체계와 혼재 |
| B | `--accent-hover` / `--accent-hover-strong` | hover 용도 명시 | hover 외 용도에도 쓰임 |
| C | `--accent-04` / `--accent-07` | 불투명도 명시 | 의미 불명확, 숫자 변경 시 이름 불일치 |

### 결정
옵션 A — `--accent-bg-light: rgba(217,119,87,0.04)`, `--accent-bg-medium: rgba(217,119,87,0.07)`.
배지 배경: `--blue-bg-light: rgba(96,165,250,0.18)`, `--red-bg-light: rgba(239,68,68,0.18)`.
border-radius: `--radius-sm: 4px`, `--radius-md: 6px`.

### 이유
1. `light`/`medium` 접미사가 0.04/0.07 불투명도 계층을 직관적으로 표현
2. 기존 `--accent-dim`(0.1)과 함께 3단계 계층(light→medium→dim) 형성
3. `--blue-bg-light`, `--red-bg-light`는 `--blue-dim`(0.12)과 구분하여 배지 전용 배경임을 명시
4. `--radius-sm`/`--radius-md`는 다른 컴포넌트에서도 재사용 가능한 범용 토큰

---

## ADR-004: turn-view.css rgba(217,119,87,0.05) 처리

### 상태
**결정됨** (2026-04-19)

### 배경
`turn-view.css`의 `.turn-header:hover`에 `rgba(217,119,87,0.05)`가 있다.
신규 토큰 `--accent-bg-light`는 0.04이므로 정확히 일치하지 않는다.

### 고려한 옵션

| 옵션 | 설명 | 장점 | 단점 |
|------|------|------|------|
| A | `--accent-bg-light`(0.04)로 통일 | 토큰 수 최소화, 하드코딩 제거 | 0.01 차이로 미세 변화 |
| B | `--accent-bg-subtle: rgba(217,119,87,0.05)` 별도 토큰 | 정확한 값 유지 | 토큰 남발, 0.04/0.05/0.07 3단계로 복잡 |

### 결정
옵션 A — `--accent-bg-light`(0.04)로 통일.

### 이유
1. 0.04와 0.05의 차이는 어두운 배경(#0f0f0f)에서 육안 식별 불가 수준
2. 토큰 수 최소화 원칙 — 필요 이상의 계층 생성 지양
3. `table.css`의 `tr:hover`(0.04)와 시각적으로 통일되어 인터랙션 일관성 향상
