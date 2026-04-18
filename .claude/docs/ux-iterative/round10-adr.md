# Round 10 UX ADR — 최종 폴리쉬: CSS 정리 & 초기 상태 일관성

**날짜**: 2026-04-18  
**참여자**: Geunmyeong(개발), Bora(디자인), Hyunwoo(QA)

---

## 사용 회의 (Round 9 반영 후)

### 관찰된 문제들

**Hyunwoo**: "활성 카드가 초기 로딩 시 스켈레톤인데 초록색이야. HTML에 `class=\"stat-card active\"` 하드코딩돼 있어서 JS가 데이터 받기 전에 이미 active 상태야. 로딩 중엔 중립 색상이어야 해."

**Bora**: "배지들의 폰트 크기가 미묘하게 달라. `.role-badge`는 9px, `.model-badge`는 9px, `.badge-cache`도 9px. 같은데 각각 별도로 정의돼 있어서 나중에 유지보수할 때 하나만 바꿀 수 있어. 공통 소배지 CSS 묶음이 필요해."

**Geunmyeong**: "`renderBrowserProjects`에서 빈 상태 텍스트가 '데이터 없음'인데, 로딩 후 진짜 프로젝트가 없을 때와 로딩 전 스켈레톤이 다 사라진 후를 구분 못 해. 단순히 빈 상태일 때 '프로젝트 없음'으로 통일."

**Soyeon**: "세션 상세를 닫을 때 (`✕ 닫기` 버튼) 닫기 버튼 텍스트가 영문+한글 혼용이야. `✕` 특수문자 + `닫기`가 어색해. 통일하는 게 좋겠어."

**Hyunwoo**: "`.sess-row-preview` 클래스를 추가했는데 `.tool-sub` 클래스와 동일한 스타일을 쓰고 있어. `font-size:10px; color:var(--text-dim); font-style:italic` vs `font-size:10px; color:var(--text-dim)` — font-style만 다름. 스타일 중복."

---

## 결정 사항

### ADR-R10-001: 초기 활성 카드 `.active` 클래스 제거

**결정**: HTML의 `<div class="stat-card active">` → `<div class="stat-card" id="activeCard">`로 변경. JS에서만 dynamic하게 추가/제거.

**이유**: 로딩 전 스켈레톤이 초록색으로 보이는 문제 해결.

### ADR-R10-002: 소배지 공통 CSS 변수 블록

**결정**: `.role-badge`, `.model-badge`, `.badge-cache`가 공유하는 `font-size:9px; font-weight:600; letter-spacing:0.3px; vertical-align:middle; margin-left:2px` 속성을 `.mini-badge` 공통 클래스로 추출. 기존 클래스에 `.mini-badge` 추가 적용.

**이유**: 공통 스타일 한 곳에서 관리.

### ADR-R10-003: 프로젝트 빈 상태 텍스트 통일

**결정**: `renderBrowserProjects`의 빈 상태를 `'데이터 없음'` → `'프로젝트 없음'`으로 변경.

**이유**: 다른 패널의 빈 상태 텍스트 패턴(`세션 없음`, `데이터 없음`)과 일관성.

### ADR-R10-004: 닫기 버튼 텍스트 통일

**결정**: `✕ 닫기` → `닫기`로 단순화.

**이유**: 특수문자 + 한글 혼용 제거. 스타일로 X 아이콘 표현하거나 텍스트만 사용.
