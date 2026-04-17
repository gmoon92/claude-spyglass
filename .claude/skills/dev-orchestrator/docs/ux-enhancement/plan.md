# UX Enhancement Plan — 분석 도구 고도화

> Feature: `ux-enhancement`  
> Date: 2026-04-18  
> Scope: 기존 기능의 UX 품질 향상 (신규 기능 추가 없음)

---

## 1. 목표

Spyglass는 Claude Code 개발자가 **토큰 낭비 지점을 찾는 분석 도구**다.  
현재 데이터 수집과 저장 레이어는 완성도가 높지만,  
분석 도구로서의 UX에는 다음 문제들이 있다.

- 웹 대시보드: 정보는 있으나 **탐색 경로가 단절**되어 있음
- TUI: 컴포넌트 구조는 완성됐으나 **데이터 바인딩이 미완성**
- 공통: **컨텍스트 없이 숫자만 나열** — 분석에 필요한 "왜?"가 없음

---

## 2. 현재 상태 진단

### 2.1 웹 대시보드 (`packages/web/index.html`)

**완성된 기능:**
- Summary Strip (총 세션/요청/토큰/활성 세션)
- Timeline Chart (30분 롤링 윈도우, Canvas 기반)
- Type Donut Chart (prompt/tool_call/system 분포)
- 프로젝트·세션 브라우저 (왼쪽 패널)
- 최근 요청 테이블 (10건 고정)
- 세션 상세 — 플랫 뷰 / 턴 뷰 (아코디언)
- Tool Stats (상위 5개)
- SSE 실시간 업데이트

**UX 문제 (기존 기능 내):**
| 문제 | 위치 | 영향 |
|------|------|------|
| 최근 요청 10건 고정 — 페이지네이션 없음 | 오른쪽 패널 | 분석 범위 제한 |
| 세션 선택 후 왜 이 세션이 비쌌는지 알기 어려움 | 세션 상세 | 인사이트 부족 |
| 턴 뷰에서 토큰 비중 시각화 없음 | 턴 뷰 아코디언 | 비교 어려움 |
| 프로젝트 간 비교 수단 없음 | 왼쪽 패널 | 분석 컨텍스트 부족 |
| tool_detail 내용이 텍스트 덤프 수준 | 최근 요청 테이블 | 가독성 저하 |
| 요청 검색/필터 없음 | 최근 요청 테이블 | 탐색 불가 |

### 2.2 TUI (`packages/tui/`)

**완성된 기능:**
- Live Tab: 토큰 카운터, 프로그레스바, SSE 연결 상태
- History Tab: 세션 목록 (텍스트 검색 가능)
- Analysis Tab: Overview/Top Requests/By Type/By Tool 4섹션
- Alert 시스템: 5K/10K 임계값

**미완성 (기존 기능의 바인딩 누락):**
| 문제 | 파일 | 현상 |
|------|------|------|
| History Tab — 세션 선택 후 상세 없음 | HistoryTab.tsx | `onSessionSelect` 미구현 |
| Live Tab — 최근 요청 목록 미갱신 | LiveTab.tsx | SSE 수신 후 목록 업데이트 없음 |
| Sidebar — 데이터 연동 없음 | app.tsx | `sessions={[]}` 고정값 전달 |
| Settings Tab — placeholder 상태 | SettingsTab | 설정 기능 없음 |
| 세션 경과 시간 고정값 | LiveTab.tsx | `'00:15:32'` 하드코딩 |

---

## 3. 고도화 작업 범위

### 우선순위 1 — TUI 데이터 바인딩 완성

기능은 존재하나 데이터가 연결되지 않은 항목들:

1. **History Tab 세션 상세 뷰**
   - 세션 선택 → `/api/sessions/:id/requests` 조회
   - 요청 목록 + 토큰 분포 표시
   - `onSessionSelect` 콜백 구현

2. **Live Tab 실시간 요청 목록**
   - SSE `new_request` 이벤트 → 목록 append 방식 갱신
   - 최대 N건 유지 (오래된 항목 자동 제거)

3. **Sidebar 세션 데이터 연동**
   - `useStats` 반환 데이터에서 active sessions 추출
   - app.tsx에서 sessions 상태 실제 데이터로 교체

4. **세션 경과 시간 동적 계산**
   - `started_at` 기준으로 1초마다 업데이트

### 우선순위 2 — 웹 대시보드 분석 UX 개선

기능은 있으나 분석 도구로서 활용성이 낮은 항목들:

1. **턴 뷰 토큰 비중 바**
   - 각 Turn 아코디언 헤더에 토큰 비중 시각화
   - 전체 세션 토큰 대비 해당 턴의 비율 (인라인 바)

2. **최근 요청 테이블 개선**
   - 타입 필터 버튼 (All / prompt / tool_call / system)
   - 페이지 단위 로드 (더 보기 버튼)

3. **tool_detail 표시 개선**
   - 긴 텍스트를 키=값 형태로 파싱하여 가독성 향상
   - Agent/Skill 호출의 경우 별도 아이콘 강조

4. **세션 상세 — 토큰 집계 요약**
   - 세션 상단에 "가장 비싼 Turn", "가장 많이 호출된 Tool" 배지 추가
   - 플랫 뷰에서도 타입별 소계 표시

### 우선순위 3 — Settings Tab 기본 기능

- 알림 임계값 변경 (WARNING/CRITICAL) — 로컬스토리지 저장
- 서버 URL 변경
- 폴링 간격 설정

---

## 4. 기술 스택 (변경 없음)

| 영역 | 현재 기술 |
|------|----------|
| 웹 대시보드 | HTML5 Canvas, vanilla JS, SSE |
| TUI | Ink 5.x, React 18, TypeScript |
| 서버 | Bun HTTP, SQLite WAL |
| 공통 | TypeScript strict, Bun workspace |

---

## 5. 예상 작업 범위

- **총 변경 파일**: 8~12개
- **예상 커밋 수**: 8~12개 (원자성 커밋)
- **추가 API 없음**: 기존 엔드포인트 활용
- **DB 스키마 변경 없음**: 기존 데이터 그대로 사용
