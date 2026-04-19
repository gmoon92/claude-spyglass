# left-panel-resize 개발 계획

> Feature: left-panel-resize
> 작성일: 2026-04-19
> 작성자: Claude Code

## 목표

왼쪽 패널(Left Panel) 너비를 사용자가 직접 조절할 수 있도록 합니다.

현재 280px로 고정된 너비는 긴 프로젝트명이나 툴명이 잘릴 때 사용자가 전체 내용을 확인하기 어렵습니다. 두 가지 조작 방식으로 UX를 개선합니다:

1. **드래그 리사이즈**: 패널 우측 끝 핸들을 드래그하여 원하는 너비로 자유 조절
2. **더블클릭 Auto-fit**: 핸들을 더블클릭하면 패널 내 가장 긴 콘텐츠 너비에 맞게 자동 조절 (Excel 컬럼 자동맞춤과 동일한 UX)

## 범위

**포함:**
- `panel-resize.js` 신규 파일 작성 (드래그 + Auto-fit 로직)
- `left-panel.css` — 리사이즈 핸들 스타일 추가
- `index.html` — 핸들 DOM 삽입 + 스크립트 import
- `design-tokens.css` — `--panel-resize-min`, `--panel-resize-max` 변수 추가
- localStorage 저장/복원으로 새로고침 후 너비 유지

**제외:**
- 모바일/반응형 (768px 이하에서는 핸들 숨김)
- TUI

> **⚠️ 연관 기능**: `col-resize.js`는 테이블 컬럼 드래그 리사이즈만 구현되어 있고 **더블클릭 Auto-fit이 없다.**
> 이번 feature에서 Auto-fit 측정 로직을 `resize-utils.js`로 공통화하여 `col-resize.js`도 함께 완성한다.

## 기술 접근

```
CSS 변수 방식:
  document.documentElement.style.setProperty('--left-panel-width', newPx + 'px')
  → .main-layout { grid-template-columns: var(--left-panel-width) 1fr } 자동 반영

Auto-fit 측정 방식:
  패널 내 모든 텍스트 요소의 scrollWidth 측정
  → 가장 넓은 값 + padding(24px) = 새 너비
```

## 단계별 계획

### 1단계: 디자인 토큰 추가
`design-tokens.css`에 리사이즈 관련 변수 추가:
- `--panel-resize-min: 180px`
- `--panel-resize-max: 480px`
- `--panel-resize-handle-width: 4px`

### 2단계: 핸들 DOM + CSS
`index.html` — `.left-panel` 내 `<div class="panel-resize-handle"></div>` 삽입
`left-panel.css` — 핸들 스타일 (absolute 우측 배치, hover/dragging 상태 시각화)

### 3단계: resize-utils.js 공통 유틸 작성 (신규)
Auto-fit 측정 로직을 패널/컬럼 양쪽에서 재사용할 수 있도록 분리:
```js
// resize-utils.js
export function measureMaxWidth(elements) { ... }
// overflow:hidden 임시 해제 → scrollWidth 최대값 반환 → 복원
```

### 4단계: panel-resize.js 구현
- `initPanelResize(panelEl, handleEl)` 함수 export
- 드래그: `mousedown` → `mousemove` → CSS 변수 업데이트 → `mouseup` → localStorage 저장
- Auto-fit: `dblclick` → `measureMaxWidth()` 호출 → 결과 + padding → CSS 변수 적용
- 초기화: localStorage에 저장된 너비 복원

### 5단계: col-resize.js Auto-fit 추가 (기존 파일 보완)
`col-resize.js`에 더블클릭 핸들러 추가:
- `dblclick` on handle → `measureMaxWidth(해당 컬럼 td 목록)` → `col[i].style.width` 적용

### 6단계: main.js 연동
`main.js`에서 `initPanelResize` import 후 DOMContentLoaded 시 호출

## 완료 기준

- [ ] 드래그로 180px~480px 범위에서 너비 자유 조절
- [ ] 핸들 더블클릭 시 콘텐츠 길이에 맞게 Auto-fit 동작
- [ ] 새로고침 후 마지막 너비 복원 (localStorage)
- [ ] 768px 이하에서 핸들 미표시 (반응형 유지)
- [ ] 드래그 중 텍스트 선택 방지 (`user-select: none`)
- [ ] 핸들 hover/dragging 시 시각 피드백 (accent 색상)
- [ ] 기존 `col-resize.js` 동작에 영향 없음
