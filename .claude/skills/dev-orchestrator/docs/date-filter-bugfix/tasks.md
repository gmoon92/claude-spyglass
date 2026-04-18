# 날짜 필터 버그 수정 작업 목록

## Task 1: fetchDashboard()에 날짜 파라미터 추가

**파일**: `.claude/worktrees/date-filter-bugfix/packages/web/index.html`

**변경 내용**:
```javascript
// Before (line ~1006)
const res = await fetch(`${API}/api/dashboard`, { signal: AbortSignal.timeout(8000) });

// After
const res = await fetch(buildQuery(`${API}/api/dashboard`), { signal: AbortSignal.timeout(8000) });
```

**검증 방법**:
1. 서버 실행
2. "오늘" 필터 선택
3. 요약 통계가 오늘 데이터만 표시되는지 확인

**커밋 메시지**: `fix(web): fetchDashboard()에 날짜 필터 파라미터 추가`

---

## Task 2: fetchSessionsByProject()에 날짜 파라미터 추가

**파일**: `.claude/worktrees/date-filter-bugfix/packages/web/index.html`

**변경 내용**:
```javascript
// Before (line ~1457)
const res = await fetch(`${API}/api/projects/${encodeURIComponent(projectName)}/sessions?limit=200`);

// After
const res = await fetch(buildQuery(`${API}/api/projects/${encodeURIComponent(projectName)}/sessions`, { limit: 200 }));
```

**검증 방법**:
1. "오늘" 필터 선택
2. 프로젝트 선택
3. 세션 목록이 오늘 데이터만 표시되는지 확인

**커밋 메시지**: `fix(web): fetchSessionsByProject()에 날짜 필터 파라미터 추가`

---

## Task 3: 차트 부제목 동적 변경

**파일**: `.claude/worktrees/date-filter-bugfix/packages/web/index.html`

**변경 내용**:
- 필터 변경 시 chartSubtitle 텍스트를 동적으로 변경
- 'all' → "전체 기간"
- 'today' → "오늘"
- 'week' → "이번 주"

**검증 방법**:
1. 각 필터 버튼 클릭
2. 차트 부제목이 적절히 변경되는지 확인

**커밋 메시지**: `feat(web): 차트 부제목을 날짜 필터에 따라 동적으로 변경`

---

## Task 4: API 지원 확인 및 필요시 백엔드 수정

**검증 방법**:
1. 브라우저 개발자 도구에서 API 호출 확인
2. `/api/dashboard?from=xxx&to=xxx` 응답 확인
3. `/api/projects/:name/sessions?from=xxx&to=xxx` 응답 확인
4. API가 지원하지 않으면 백엔드 수정

**커밋 메시지**: `fix(server): 대시보드 및 세션 API에 날짜 범위 필터 추가`
