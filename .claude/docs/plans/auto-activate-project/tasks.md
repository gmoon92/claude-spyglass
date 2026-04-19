# auto-activate-project Tasks

> Feature: auto-activate-project
> 시작일: 2026-04-19
> 상태: 진행 중

## Tasks

### 1단계: 자동 선택 핵심 로직 구현

- [ ] `main.js`에 `STORAGE_KEY` 상수 추가 (`'spyglass:lastProject'`)
- [ ] `main.js`에 `autoActivateProject()` 함수 구현
  - `localStorage.getItem(STORAGE_KEY)`로 저장값 확인
  - 저장값이 `_allProjects`에 존재하면 해당 프로젝트 선택
  - 없으면 `getAllSessions()`에서 `started_at` 최댓값의 `project_name` 추출
  - 여전히 없으면 `getAllProjects()[0]?.project_name` 폴백
  - 유효한 프로젝트명이 확정되면 `selectProject(name)` 호출
- [ ] `autoActivateProject()`가 이미 선택된 프로젝트가 있을 때는 실행하지 않도록 가드 조건 추가
  (`getSelectedProject()` 확인 — 사용자가 로딩 중 클릭한 경우 우선)

### 2단계: localStorage 통합

- [ ] `selectProject(name)` 함수 내부에 `localStorage.setItem(STORAGE_KEY, name)` 추가
  (자동 선택 및 수동 클릭 모두 동일 경로로 저장)

### 3단계: fetchAllSessions 완료 후 autoActivateProject 연결

- [ ] `api.js`의 `fetchAllSessions()` 함수가 완료 Promise를 반환하도록 확인 (현재 `async` 함수이므로 반환값 있음)
- [ ] `main.js`의 `init()` 또는 `sseSource.onopen` 콜백에서 `fetchAllSessions()` 완료 후 `autoActivateProject()` 호출
  ```js
  fetchAllSessions().then(() => autoActivateProject());
  ```
- [ ] SSE 재연결(`sseSource.onopen`) 시에는 `autoActivateProject()` 재실행 제외 확인
  (재연결 시에는 이미 프로젝트가 선택된 상태이므로 가드 조건으로 자동 차단됨)

### 4단계: 검증

- [ ] 브라우저 첫 진입 시 세션 패널에 세션 목록이 즉시 표시되는지 확인
- [ ] 프로젝트 패널에서 자동 선택된 행에 `row-selected` CSS 클래스가 적용되는지 확인
- [ ] `#sessionPaneHint` 텍스트가 `프로젝트를 선택하세요`가 아닌 선택된 프로젝트명으로 표시되는지 확인
- [ ] DevTools → Application → localStorage에서 `spyglass:lastProject` 키가 저장되는지 확인
- [ ] 다른 프로젝트를 수동 클릭 후 새로고침 시 해당 프로젝트가 복원되는지 확인
- [ ] `localStorage`를 지운 후 새로고침 시 최신 세션 기준 프로젝트가 자동 선택되는지 확인
- [ ] 존재하지 않는 프로젝트명이 `localStorage`에 저장되어 있을 때 폴백이 동작하는지 확인

## 완료 기준

- [ ] 첫 진입 시 빈 세션 패널 없이 세션 목록이 즉시 표시된다
- [ ] 왼쪽 패널 프로젝트 행에 `row-selected` 스타일이 자동 적용된다
- [ ] `localStorage`에 마지막 선택 프로젝트가 저장된다
- [ ] 재진입 시 마지막 선택 프로젝트가 복원된다
- [ ] 마지막 선택 프로젝트가 더 이상 존재하지 않는 경우 최신 프로젝트로 폴백된다
- [ ] 서버 API 및 DB 스키마 변경 없음
- [ ] 기존 수동 클릭 동작에 영향 없음
