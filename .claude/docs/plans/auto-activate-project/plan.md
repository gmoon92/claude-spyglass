# auto-activate-project 개발 계획

> Feature: auto-activate-project
> 작성일: 2026-04-19
> 작성자: Claude Code

## 목표

웹 대시보드(`/`) 첫 진입 시 프로젝트 목록이 로드되자마자 가장 최근 활동 프로젝트를 자동 선택하여,
사용자가 클릭 없이도 세션 목록을 즉시 확인할 수 있도록 UX를 개선한다.

## 배경

현재 대시보드는 첫 진입 후 프로젝트 패널에서 직접 클릭해야만 세션 목록이 표시된다.
신규 사용자는 무엇을 해야 할지 알 수 없어 빈 화면을 마주하게 된다.

## 범위

### 포함

- `fetchDashboard()` 완료 후 자동 프로젝트 선택 로직 (`main.js`)
- `fetchAllSessions()` 완료 후 선택 프로젝트 반영 (`api.js` → `main.js` 콜백)
- `localStorage` 기반 마지막 선택 프로젝트 복원 (`main.js`)
- 자동 선택된 프로젝트에 대한 `row-selected` 시각 표시 (`left-panel.js`)
- 세션 패널 힌트 텍스트 초기화(`프로젝트를 선택하세요` → 자동 선택 완료 상태 반영)

### 제외

- 서버 API 신규 엔드포인트 추가 (기존 `/api/dashboard`의 `projects` 배열 활용)
- DB 스키마 변경
- CSS 신규 클래스 추가 (기존 `row-selected` 재사용)
- SSE 실시간 자동 재선택 (첫 진입 1회만 적용)

## 현행 데이터 흐름 분석

```
DOMContentLoaded
  → init()
    → fetchDashboard()   → renderProjects(d.projects)   ← _allProjects 채워짐
    → fetchAllSessions() → setAllSessions() + renderBrowserSessions()
```

`d.projects` 배열은 `project_name`, `session_count`, `total_tokens` 필드를 가진다.
"가장 최근 로그" 기준 정렬을 위해서는 별도 `last_activity` 필드가 필요하나,
현재 dashboard API 응답에는 포함되지 않는다.

대안: `fetchAllSessions()` 결과(`_allSessions`)에서 `started_at` 기준 최신 세션의
`project_name`을 추출하면 별도 API 변경 없이 "가장 최근 로그 기준" 정렬이 가능하다.

## 단계별 계획

### 1단계: 자동 선택 핵심 로직 구현 (`main.js`)

- `fetchAllSessions()` 완료 이후 실행되는 `autoActivateProject()` 함수 추가
- `localStorage` 복원 우선 → 없으면 `_allSessions` 중 `started_at` 최댓값의 `project_name` 선택
- `selectProject(name)`을 내부 호출하여 기존 렌더링 경로 재사용
- `selectProject` 실행 시 `localStorage`에 선택 프로젝트 저장

### 2단계: `localStorage` 통합 (`main.js`)

- 상수: `STORAGE_KEY = 'spyglass:lastProject'`
- 저장: `selectProject()` 내부에서 `localStorage.setItem` 호출
- 복원: `autoActivateProject()` 진입 시 `localStorage.getItem` → 해당 프로젝트 존재 확인 후 선택

### 3단계: `renderBrowserSessions` 호출 타이밍 조율

- 현재 `fetchAllSessions()`는 `renderBrowserSessions()`를 직접 호출
- `_selectedProject`가 세팅된 상태에서 `renderBrowserSessions()`가 호출되어야 세션이 표시됨
- `autoActivateProject()`가 `fetchAllSessions()` 완료 이후에 실행되도록 `api.js`에서
  완료 콜백(또는 반환 Promise) 활용

### 4단계: UI 힌트 텍스트 업데이트

- 자동 선택 완료 시 `#sessionPaneHint` 텍스트를 `selectProject()` 내부 로직과 동일하게 처리
  (기존 로직 그대로 재사용되므로 별도 수정 불필요)

### 5단계: 검증

- 첫 진입 시 세션 목록 자동 표시 확인
- 프로젝트 행 `row-selected` 클래스 적용 확인
- `localStorage`로 마지막 선택 복원 확인
- 수동 클릭으로 다른 프로젝트 선택 시 `localStorage` 갱신 확인

## 완료 기준

- [ ] 첫 진입 시 빈 세션 패널 없이 세션 목록이 즉시 표시된다
- [ ] 왼쪽 패널 프로젝트 행에 `row-selected` 스타일이 자동 적용된다
- [ ] `localStorage`에 마지막 선택 프로젝트가 저장된다
- [ ] 재진입 시 마지막 선택 프로젝트가 복원된다
- [ ] 마지막 선택 프로젝트가 더 이상 존재하지 않는 경우 최신 프로젝트로 폴백된다
- [ ] 서버 API 및 DB 스키마 변경 없음

## 예상 소요 시간

- 1~3단계: 30분 (JS 로직 수정)
- 4단계: 5분 (텍스트 확인)
- 5단계: 15분 (검증)
- 합계: 약 50분
