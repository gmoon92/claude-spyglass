# left-panel-collapse 개발 계획 (재작업)

> Feature: left-panel-collapse
> 작성일: 2026-04-20
> 작성자: Claude Code
> 상태: 요구사항 재정의 및 전면 재작업

## 요구사항 재정의

### 이전 (잘못된 구현)
- 각 `.panel-section`(프로젝트/세션/툴 통계)에 위/아래 토글 버튼 추가
- 섹션별로 접고 펼치는 기능
- 총 3개 토글 버튼이 각 섹션 헤더에 배치

### 현재 (정확한 요구사항)
- **왼쪽 패널 전체를 좌우로 접어서 완전히 숨기는 기능**
- 토글 버튼 **1개만 존재** (섹션별 아님)
- IDE 사이드바 숨김 패턴 (VS Code 파일 탐색기 토글 같은 UX)
- 숨김 상태: `.left-panel`은 `display: none`, `.right-panel`이 전체 너비 차지
- 펼침 상태: 원래 레이아웃 복원 (grid-template-columns 원위치)

## 목표

IDE 스타일의 좌우 패널 토글 기능을 구현하여, 사용자가 필요에 따라 왼쪽 패널을 숨기고 오른쪽 메인 컨텐츠 영역을 최대한 활용할 수 있도록 함. 토글 상태는 localStorage에 영속화됨.

## 범위

### 포함
- 왼쪽 패널 전체 숨김 토글 기능
- 토글 버튼 1개 배치 (위치: 헤더 또는 우측 패널 상단)
- CSS 레이아웃 변경: `.main-layout`의 `grid-template-columns` 동적 제어
- localStorage 영속화: `left-panel-hidden` key로 boolean 저장
- Resize handle은 숨김 상태에서 함께 숨겨짐
- 아이콘: IDE 스타일 사이드바 토글 SVG (열림/닫힘 상태 시각적 구분)
- 상태 복원: 페이지 새로고침 시 저장된 상태 유지

### 제외
- 섹션별 토글 기능 완전히 제거 (이전 구현 롤백)
- 다른 패널이나 뷰의 collapse 기능
- 토글 버튼의 복잡한 애니메이션 (간단한 아이콘 회전만)

## 단계별 계획

### 1단계: 이전 섹션별 토글 코드 완전 롤백
- HTML: `index.html`에서 `.panel-header-right` div와 `.btn-panel-toggle` 버튼 3개 제거
  - 프로젝트 섹션의 `<span class="panel-hint">클릭하여 세션 조회</span>` 복원
- CSS: `left-panel.css`에서 `.panel-header-right`, `.btn-panel-toggle`, `.panel-section--collapsed` 관련 스타일 모두 제거
  - `.left-panel`을 원래 레이아웃으로 복원 (grid 또는 flex 확인)
- JavaScript: `main.js`에서 `getPanelState`, `savePanelState`, `togglePanelSection`, `restorePanelState`, `PANEL_STATE_KEY` 및 관련 이벤트 위임 제거

### 2단계: 기술 결정 (ADR 작성)
- 토글 버튼 위치 결정:
  - 옵션 A: `.header`의 왼쪽 끝에 배치 (항상 접근 가능)
  - 옵션 B: `.right-panel` 최상단 왼쪽에 배치
  - 옵션 C: 왼쪽 패널의 상단 헤더 영역에 배치 (펼쳐진 상태일 때만 접근 가능)
  - 선택: 옵션 A (전체 헤더에 통합, 가장 일반적인 패턴)
- 숨김 메커니즘 선택:
  - CSS: `grid-template-columns: 1fr` (숨김) vs `grid-template-columns: var(--left-panel-width) 1fr` (펼침)
  - 클래스: `.main-layout.left-panel-hidden` 토글로 제어
- 아이콘 스타일: 세로 막대 + 화살표 (열림/닫힘 상태 구분)

### 3단계: CSS 수정
- `layout.css`: `.main-layout.left-panel-hidden .main-layout { grid-template-columns: 1fr; }`
- `left-panel.css`: `.main-layout.left-panel-hidden .left-panel { display: none; }`
- `header.css`: 토글 버튼 스타일 추가 (`.btn-panel-collapse`)
- 원래 섹션별 토글 CSS 완전 제거

### 4단계: HTML 구조 수정
- `index.html` `.header-left` 내부에 토글 버튼 추가:
  ```html
  <button class="btn-panel-collapse" id="btnPanelCollapse" title="왼쪽 패널 숨기기" aria-label="왼쪽 패널 숨기기">
    <svg>...</svg>
  </button>
  ```
- 섹션별 토글 버튼 3개 완전 제거

### 5단계: JavaScript 구현
- 상태 저장/복원 함수:
  - `savePanelHiddenState(isHidden)` — localStorage에 boolean 저장
  - `restorePanelHiddenState()` — 페이지 로드 시 상태 복원
- 토글 함수:
  - `toggleLeftPanel()` — `.main-layout`에 `.left-panel-hidden` 클래스 토글
- 초기화:
  - 페이지 로드 시 `restorePanelHiddenState()` 호출
  - 토글 버튼 클릭 시 `toggleLeftPanel()` 호출 + 상태 저장

### 6단계: Playwright 검증
- 초기 상태: 왼쪽 패널 보임, 토글 버튼 상태 확인
- 토글 클릭: 왼쪽 패널 완전히 사라짐, 오른쪽 패널이 전체 너비 차지
- 다시 토글 클릭: 왼쪽 패널 원위치 복원, 너비 원래대로
- 새로고침: 저장된 상태 정상 복원
- Resize handle: 숨김 상태에서 접근 불가, 펼친 상태에선 정상 동작
- 스크린샷: 초기 / 숨김 / 복원 상태 각 1장씩

## 완료 기준

- [ ] plan.md 작성 완료 (요구사항 재정의 포함)
- [ ] adr.md 작성 완료 (토글 위치, 숨김 메커니즘 결정)
- [ ] tasks.md 작성 완료 (원자성 작업 분해)
- [ ] 이전 섹션별 토글 코드 완전 제거 (HTML/CSS/JS)
- [ ] 전체 패널 숨김 토글 기능 구현 (토글 버튼 배치 포함)
- [ ] localStorage 영속화 검증
- [ ] Playwright 스크린샷 및 동작 검증 완료
- [ ] 관련 파일 목록 및 커밋 전략 정리
