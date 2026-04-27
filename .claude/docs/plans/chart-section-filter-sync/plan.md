# chart-section-filter-sync 개발 계획

> Feature: chart-section-filter-sync
> 작성일: 2026-04-27
> 작성자: Claude Code (designer 서브에이전트)

## 목표

웹 대시보드 chartSection의 `timeline-meta` 두 그룹 라벨이 활성 date-filter("전체"/"오늘"/"이번주")와 동기화되지 않아 발생하는 UX 불일치 문제를 해결한다.

### 배경

- 백엔드는 이미 `/api/dashboard?from=X&to=Y`의 6개 stat (`avgDurationMs`, `p95DurationMs`, `errorRate`, `totalSessions`, `totalRequests`, `totalTokens`)을 모두 동일한 `fromTs`/`toTs` 윈도우로 일관되게 산출.
- 그러나 프론트엔드의 `.timeline-meta-group-label` 두 곳은 "지난 30분" / "오늘"로 하드코딩되어 있어 사용자가 date-filter를 변경해도 라벨이 갱신되지 않음 → 데이터와 라벨이 불일치하는 거짓 정보.
- `#chartSubtitle`은 timelineChart(클라이언트 sliding 30분 윈도우)의 부제임에도 date-filter("전체 기간"/"오늘"/"이번 주")와 동기화되도록 잘못 설계됨 → 의미 충돌.

## 범위

### 포함

- `packages/web/index.html` line 185-216: `.timeline-meta-group-label` 두 곳의 초기 텍스트와 그룹 `aria-label` 갱신
- `packages/web/index.html` line 159: `#chartSubtitle` 초기 텍스트를 timelineChart 본질에 맞게 변경
- `packages/web/assets/js/main.js` line 323-335: `dateFilter` 클릭 핸들러에서 라벨 갱신 로직 추가 + `subtitles` 매핑 제거
- `packages/web/assets/js/main.js`: 초기 `setActiveRange` 호출 시점에 라벨 적용
- 캡슐화 함수 `applyRangeLabels(range)` 도입 — SSoT `RANGE_LABELS` 객체에서 라벨 조회
- `.claude/skills/ui-designer/references/web/screen-inventory.md`: chartSection timeline-meta 영역 변경 반영

### 제외

- DB 스키마/마이그레이션 변경
- 서버 `/api/dashboard` 라우트 로직 변경 (이미 fromTs/toTs 일관 처리 완료)
- timeline-meta 외 다른 stat 카드 (`#statSessions` 등 값 자체) 동작 변경
- TUI 컴포넌트 변경 (designer 역할 내이지만 본 feature 범위 외)

## 단계별 계획

### 1단계: doc-planning (본 문서)

- plan.md 작성 — 목표/범위/단계/완료 기준 정의

### 2단계: doc-adr

기록할 결정 항목:

1. **ADR-001 (chart-section-filter-sync)**: 라벨 SSoT 설계 — `RANGE_LABELS` 객체를 main.js 내부에 두고 `applyRangeLabels(range)` 함수로 캡슐화
2. **ADR-002**: chartSubtitle 의미 — 옵션A (항상 "최근 30분 · 실시간"으로 고정, subtitles 매핑 삭제) 채택
3. **ADR-003**: timeline-meta 라벨 표기 방식 — 옵션2 (본질 라벨 + 범위 표시, 예: "품질 · 전체 기간") 또는 옵션1 (단순 범위) 중 디자인 판단으로 선택

### 3단계: doc-tasks

원자성 task 분해:

1. T1: HTML — `#chartSubtitle` 초기값을 "최근 30분 · 실시간"으로 변경
2. T2: HTML — `.timeline-meta-group-label` 두 곳 초기값 + `aria-label` 갱신
3. T3: JS — `RANGE_LABELS` 상수 + `applyRangeLabels(range)` 함수 도입
4. T4: JS — `dateFilter` 클릭 핸들러에서 `subtitles` 매핑 제거 + `applyRangeLabels(range)` 호출
5. T5: JS — 초기 `setActiveRange` 호출 시점에 `applyRangeLabels(getActiveRange())` 추가
6. T6: screen-inventory.md 갱신 — timeline-meta 영역 라벨 동기화 동작 기록

### 4단계: 구현 (ui-designer Phase 1~5)

- Phase 1: 화면 분석 (이미 완료 — 본 plan에서 분석함)
- Phase 2: 디자인 결정 (ADR에서 결정)
- Phase 3: 구현 (위 T1~T6)
- Phase 4: CSS 토큰 검증 (CSS 변경 없으나 hardcoding 점검)
- Phase 5: screen-inventory 현행화 + 검증 체크리스트

### 5단계: 검증

- Playwright MCP로 `bun run dev` 백그라운드 서버에 접속
- date-filter "전체"/"오늘"/"이번주" 클릭 시 두 그룹 라벨이 즉시 갱신되는지 시각 확인
- 초기 로드 시 (기본 "전체") 라벨이 정상 노출되는지 확인
- chartSubtitle이 "최근 30분 · 실시간"으로 고정 노출되는지 확인

## 예상 소요 시간

약 30분

## 제약 / 주의사항

- 모든 디렉토리·파일명은 **kebab-case**
- CSS 변수만 사용 (하드코딩 색상 금지) — 본 feature는 CSS 변경 없으나 점검 필수
- 라벨 매핑은 **SSoT 한 곳에 정의** (`RANGE_LABELS`), 호출처에서 조회만
- `getActiveRange()` (api.js:15) 활용
- DB/서버 API 코드 수정 금지 (designer 역할 외)
- 기존 `.timeline-meta-group-label` CSS 스타일 유지

## 완료 기준

- [ ] date-filter "전체"/"오늘"/"이번 주" 클릭 시 timeline-meta 두 그룹 라벨이 즉시 활성 범위에 맞게 갱신됨
- [ ] 초기 로드 시 (기본 "전체") 라벨이 정상 노출됨
- [ ] timelineChart 부제 의미가 명확 (timelineChart 본질과 충돌 없음)
- [ ] doc-planning / doc-adr / doc-tasks 3개 문서 작성 완료
- [ ] screen-inventory.md 갱신 완료
- [ ] CSS 하드코딩 색상 없음 (본 feature는 CSS 변경 없음)
- [ ] 변경된 파일 목록 + 핵심 diff 요약 보고
