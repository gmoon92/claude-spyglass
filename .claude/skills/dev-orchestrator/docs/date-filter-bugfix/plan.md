# 날짜 필터 버그 수정 계획

## 개요

Spyglass Web UI의 "전체/오늘/이번주" 날짜 필터 버튼이 실제 데이터 조회에 적용되지 않는 버그를 수정합니다.

## 문제 분석

### 버그 위치
- 파일: `packages/web/index.html`
- 관련 함수: `fetchDashboard()`, `fetchSessionsByProject()`

### 현재 동작
날짜 필터 버튼을 클릭하면 UI는 변경되지만, API 요청에 `from`/`to` 파라미터가 전달되지 않아 항상 전체 기간 데이터가 표시됩니다.

### 영향 범위

#### 심각도: 높음 (11개 UI 요소)
1. **요약 통계 패널** (5개): statSessions, statRequests, statTokens, statActive, statAvgDuration
2. **프로젝트 목록**: browserProjectsBody
3. **툴 통계**: toolsBody, toolCount
4. **타입 분포 차트**: typeChart, typeLegend, typeTotal

#### 심각도: 중간 (4개 UI 요소)
5. **프로젝트 선택 시 세션 목록**: browserSessionsBody
6. **SSE 실시간 피드**: requestsBody (실시간 업데이트 시 필터 무시)
7. **타임라인 차트**: timelineChart (항상 최근 30분)
8. **차트 부제목**: chartSubtitle ("최근 30분" 고정)

## 수정 계획

### Phase 1: 핵심 버그 수정 (P0)

#### 1-1. fetchDashboard() 수정
- 위치: `packages/web/index.html:1006`
- 변경: `buildQuery()` 함수를 사용하여 날짜 파라미터 추가
- 영향: 요약 통계, 프로젝트 목록, 툴 통계, 타입 차트

#### 1-2. fetchSessionsByProject() 수정
- 위치: `packages/web/index.html:1457`
- 변경: `buildQuery()` 함수를 사용하여 날짜 파라미터 추가
- 영향: 프로젝트 선택 시 세션 목록

### Phase 2: UX 개선 (P1)

#### 2-1. SSE 필터링 개선
- 위치: `packages/web/index.html:1516-1542`
- 변경: 실시간 업데이트 시에도 날짜/타입 필터 조건 체크

#### 2-2. 차트 부제목 동적 변경
- 위치: `packages/web/index.html:574`
- 변경: 필터에 따라 "전체 기간"/"오늘"/"이번 주"로 변경

## 기술 스택

- 언어: JavaScript (Vanilla JS)
- 프레임워크: 없음 (HTML + CSS + JS)
- 파일: `packages/web/index.html`

## 검증 방법

1. 서버 실행: `bun run packages/server/src/index.ts`
2. 웹 UI 접속: 브라우저에서 `http://localhost:9999` 열기
3. 테스트 시나리오:
   - "오늘" 필터 선택 → 요약 통계가 오늘 데이터만 표시되는지 확인
   - "이번주" 필터 선택 → 요약 통계가 이번 주 데이터만 표시되는지 확인
   - 프로젝트 선택 → 세션 목록이 필터된 기간 내 데이터만 표시되는지 확인

## API 확인 필요 사항

- [ ] `GET /api/dashboard?from=TS&to=TS` 지원 여부
- [ ] `GET /api/projects/:name/sessions?from=TS&to=TS` 지원 여부

## 예상 소요 시간

- 개발: 30분
- 검증: 20분
- 총계: 50분
