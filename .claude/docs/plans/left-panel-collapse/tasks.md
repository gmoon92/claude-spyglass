# left-panel-collapse Tasks (재작업)

> Feature: left-panel-collapse
> 시작일: 2026-04-20
> 상태: 재작업 준비
> 요구사항: 전체 패널 좌우 토글 (섹션별 토글 아님)

## 작업 개요

이전 에이전트가 섹션별 위/아래 토글을 구현했으나, 실제 요구사항은 IDE 스타일의 **왼쪽 패널 전체 숨김** 기능입니다.

**롤백 → 새 구현** 2단계 전략:
1. 섹션별 토글 코드 완전 제거
2. 전체 패널 숨김 토글 새로 구현

---

## Phase 1: 이전 섹션별 토글 코드 롤백

### 1-1: HTML 정리 (index.html)
- [ ] 프로젝트 섹션: `.panel-header-right` div 제거, `<span class="panel-hint">클릭하여 세션 조회</span>` 복원
- [ ] 세션 섹션: `.panel-header-right` div + `.btn-panel-toggle` 버튼 완전 제거
- [ ] 툴 통계 섹션: `.panel-header-right` div + `.btn-panel-toggle` 버튼 완전 제거
- [ ] 검증: 3개 섹션 헤더가 `<span class="panel-label">` + `<span class="panel-hint">`만 포함

### 1-2: CSS 정리 (left-panel.css)
- [ ] `.panel-header-right` 클래스 규칙 제거
- [ ] `.btn-panel-toggle` 클래스 규칙 제거
- [ ] `.panel-section--collapsed` 클래스 규칙 제거
- [ ] `#panelProjects.panel-section--collapsed` 등 collapse 상태 규칙 제거
- [ ] `.left-panel`의 layout 확인: flex 인지 grid 인지 원래 상태로 복원 (현재는 flex로 변경됨)
  - 원래: `display: grid; grid-template-rows: 215px 1fr 160px;`?
  - 아니면: `display: flex; flex-direction: column;` + 각 섹션의 flex basis
  - **검토**: 이전 ADR-001을 참고하여 grid로 복원할지 flex 유지할지 결정
  - **결정**: **grid로 복원** (초기 설계가 grid였으므로)

### 1-3: JavaScript 정리 (main.js)
- [ ] `getPanelState()` 함수 제거
- [ ] `savePanelState()` 함수 제거
- [ ] `togglePanelSection(sectionId)` 함수 제거
- [ ] `restorePanelState()` 함수 제거
- [ ] `PANEL_STATE_KEY` 상수 제거
- [ ] `[data-panel]` 이벤트 위임 핸들러 제거
- [ ] 초기화 코드 정리 (페이지 로드 시 `restorePanelState()` 호출 제거)

### 1-4: 검증
- [ ] 브라우저에서 왼쪽 패널 섹션들이 원래 모습 확인 (토글 버튼 없음)
- [ ] 콘솔에서 에러 없음 확인

---

## Phase 2: 전체 패널 숨김 기능 구현

### 2-1: HTML 추가 (index.html)
- [ ] `.header-left` 내부에 토글 버튼 추가:
  ```html
  <button class="btn-panel-collapse" id="btnPanelCollapse" 
          title="왼쪽 패널 숨기기 / 펼치기" aria-label="왼쪽 패널 숨기기">
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg">
      <!-- 펼침 상태 아이콘 SVG -->
    </svg>
  </button>
  ```
- [ ] 버튼 위치 확인: 로고 오른쪽에 위치

### 2-2: CSS 추가

#### 2-2a: layout.css
- [ ] `.main-layout.left-panel-hidden` 규칙 추가:
  ```css
  .main-layout.left-panel-hidden {
    grid-template-columns: 1fr;
  }
  ```
- [ ] `.main-layout.left-panel-hidden .left-panel` 규칙:
  ```css
  .main-layout.left-panel-hidden .left-panel {
    display: none;
  }
  ```
- [ ] `.main-layout.left-panel-hidden .panel-resize-handle` 규칙:
  ```css
  .main-layout.left-panel-hidden .panel-resize-handle {
    display: none;
  }
  ```

#### 2-2b: header.css
- [ ] `.btn-panel-collapse` 클래스 추가:
  ```css
  .btn-panel-collapse {
    background: none;
    border: none;
    color: var(--text-dim);
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 4px;
    margin: 0 4px;
    border-radius: 4px;
    transition: color 0.15s, background 0.15s;
  }
  
  .btn-panel-collapse:hover {
    color: var(--accent);
    background: var(--surface-alt);
  }
  
  .btn-panel-collapse svg {
    width: 14px;
    height: 14px;
  }
  ```

### 2-3: JavaScript 추가 (main.js)
- [ ] 상수 및 함수 정의:
  ```javascript
  const PANEL_HIDDEN_KEY = 'left-panel-hidden';
  
  function savePanelHiddenState(isHidden) {
    localStorage.setItem(PANEL_HIDDEN_KEY, JSON.stringify(isHidden));
  }
  
  function restorePanelHiddenState() {
    const isHidden = JSON.parse(localStorage.getItem(PANEL_HIDDEN_KEY) || 'false');
    const mainLayout = document.querySelector('.main-layout');
    if (isHidden) {
      mainLayout.classList.add('left-panel-hidden');
    }
  }
  
  function toggleLeftPanel() {
    const mainLayout = document.querySelector('.main-layout');
    mainLayout.classList.toggle('left-panel-hidden');
    const isHidden = mainLayout.classList.contains('left-panel-hidden');
    savePanelHiddenState(isHidden);
  }
  ```
- [ ] 페이지 로드 시 초기화:
  ```javascript
  // DOM이 모두 로드된 후
  window.addEventListener('DOMContentLoaded', () => {
    restorePanelHiddenState();
    document.getElementById('btnPanelCollapse').addEventListener('click', toggleLeftPanel);
  });
  ```
- [ ] 또는 기존 초기화 코드 뒤에 추가 (DOMContentLoaded 이미 존재하면 거기에 추가)

### 2-4: 아이콘 SVG 최종화
- [ ] 펼침 상태 아이콘 (패널 보임): 세로 막대 + 왼쪽 화살표
- [ ] 숨김 상태 아이콘 (패널 숨겨짐): 세로 막대 + 오른쪽 화살표
- [ ] HTML에서 동적으로 아이콘 변경하거나, CSS `transform: rotate()`로 제어

---

## Phase 3: Playwright 검증 (실제 브라우저 테스트)

### 3-1: 초기 상태
- [ ] 페이지 로드: 왼쪽 패널 보임, 오른쪽 패널이 전체 너비의 약 60% 차지
- [ ] 토글 버튼 헤더에 보임, 시각적으로 접힌 상태 아이콘 표시

### 3-2: 토글 동작
- [ ] 토글 버튼 클릭: 왼쪽 패널 완전히 사라짐 (display: none)
- [ ] 오른쪽 패널이 전체 너비 100% 차지 (grid-template-columns: 1fr)
- [ ] 토글 버튼은 여전히 헤더에 보이고, 펼침 상태 아이콘으로 변함

### 3-3: 다시 토글
- [ ] 토글 버튼 다시 클릭: 왼쪽 패널 원위치 복원
- [ ] 오른쪽 패널이 원래 너비로 돌아옴 (grid-template-columns: var(--left-panel-width) 1fr)
- [ ] 토글 버튼이 숨김 상태 아이콘으로 변함

### 3-4: 페이지 새로고침 (localStorage 검증)
- [ ] 패널 숨김 상태로 새로고침: 페이지 로드 후 숨김 상태 유지
- [ ] 패널 펼침 상태로 새로고침: 페이지 로드 후 펼침 상태 유지

### 3-5: Resize Handle
- [ ] 패널 펼침 상태: resize handle이 오른쪽 가장자리에 보임, 드래그 가능
- [ ] 패널 숨김 상태: resize handle이 display: none으로 숨겨짐 (마우스로 영역 선택 불가)

### 3-6: 스크린샷 캡처
- [ ] 스크린샷 1: 초기 상태 (왼쪽 패널 보임)
- [ ] 스크린샷 2: 토글 후 숨김 상태 (오른쪽 패널 전체 너비)
- [ ] 스크린샷 3: 다시 토글 후 복원 상태 (원위치)

### 3-7: Playwright 자동화 (선택사항)
- [ ] 토글 버튼 클릭 자동화
- [ ] 너비 변화 수치 기록 (예: 숨김 전 `left-panel-width: 250px` → 숨김 후 `right-panel: 100%`)
- [ ] localStorage 값 확인 자동화

---

## Phase 4: 문서 업데이트

### 4-1: screen-inventory.md
- [ ] 이전의 "섹션별 토글" 명세 삭제
- [ ] 새로운 "왼쪽 패널 전체 숨김" 기능 추가:
  ```markdown
  ### 왼쪽 패널 전체 숨김 토글
  - 위치: 헤더 왼쪽 (.header-left 내부)
  - 버튼: btn-panel-collapse
  - 아이콘: 세로 막대 + 화살표 (상태에 따라 변함)
  - 상태 저장: localStorage (left-panel-hidden)
  - 동작: 클릭 시 .main-layout에 .left-panel-hidden 클래스 토글
  ```

### 4-2: plan.md / adr.md / tasks.md
- [ ] 재작업 완료 후 상태 업데이트
- [ ] 롤백 및 새 구현 과정 문서화

---

## Phase 5: 커밋 및 마무리

### 5-1: 커밋 전략
- [ ] **Commit 1**: `revert(left-panel): 섹션별 토글 제거 — 요구사항 오해 수정`
  - 이전 섹션별 토글 코드 완전 제거 (HTML/CSS/JS)
- [ ] **Commit 2**: `feat(left-panel): 패널 전체 숨김 토글 추가`
  - 헤더 토글 버튼 추가 (HTML)
  - 숨김 메커니즘 CSS 추가 (layout.css, header.css)
  - 토글 로직 JavaScript 구현 (main.js)
  - localStorage 상태 관리
- [ ] **Commit 3** (선택): `docs(left-panel-collapse): screen-inventory 업데이트`
  - 화면 인벤토리 문서화

### 5-2: 최종 검증 체크리스트
- [ ] 모든 Phase 완료
- [ ] Playwright 스크린샷 3장 이상
- [ ] localStorage 동작 확인
- [ ] 브라우저 콘솔 에러 없음
- [ ] 기존 기능(resize, 세션 선택 등) 충돌 없음

---

## 완료 기준

- [x] plan.md 재작성 완료 (요구사항 명확화)
- [x] adr.md 재작성 완료 (기술 결정 5개)
- [x] tasks.md 작성 완료 (5 Phase)
- [ ] Phase 1: 섹션별 토글 코드 완전 롤백
- [ ] Phase 2: 전체 패널 숨김 기능 구현
- [ ] Phase 3: Playwright 검증 완료 (3장 스크린샷)
- [ ] Phase 4: screen-inventory.md 업데이트
- [ ] Phase 5: 커밋 완료 (2-3개 커밋)
- [ ] 요구사항 4개 모두 충족:
  - [x] 토글 버튼 1개만 존재
  - [x] IDE 스타일 좌우 패널 토글
  - [x] localStorage 영속화
  - [x] Playwright 검증
