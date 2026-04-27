# chart-section-filter-sync Tasks

> Feature: chart-section-filter-sync
> 시작일: 2026-04-27
> 상태: 완료

## Tasks

- [x] **T1**: HTML — `#chartSubtitle` 초기값 변경
  - 파일: `packages/web/index.html` line 159
  - `최근 30분` → `최근 30분 · 실시간`
  - 의존: 없음
  - 검증: 페이지 로드 시 부제 노출 확인

- [x] **T2**: HTML — `.timeline-meta-group-label` 두 곳 초기값 + `aria-label` 갱신
  - 파일: `packages/web/index.html` line 185-216
  - 그룹1 (`요청 품질`): aria-label `(지난 30분)` → `(전체 기간)`, 라벨 `지난 30분` → `품질 · 전체 기간`
  - 그룹2 (`누적 볼륨`): aria-label `(오늘)` → `(전체 기간)`, 라벨 `오늘` → `누적 · 전체 기간`
  - 의존: 없음
  - 검증: 초기 로드 라벨이 `RANGE_LABELS['all']` 결과와 일치

- [x] **T3**: JS — `RANGE_LABELS` 상수 + `applyRangeLabels(range)` 함수 도입
  - 파일: `packages/web/assets/js/main.js`
  - 위치: `initEventDelegation` 직전 모듈 스코프
  - SSoT: `const RANGE_LABELS = { all: '전체 기간', today: '오늘', week: '이번 주' };`
  - 함수가 두 그룹의 `<.timeline-meta-group-label>` 텍스트와 `aria-label`을 갱신
  - 본질 prefix: `['품질', '누적']` / aria prefix: `['요청 품질', '누적 볼륨']`
  - 의존: 없음
  - 검증: 함수 호출 시 두 라벨이 입력 range에 맞게 갱신됨

- [x] **T4**: JS — `dateFilter` 클릭 핸들러 정리
  - 파일: `packages/web/assets/js/main.js` line 323-335
  - 삭제: `const subtitles = ...; ... chartSubtitle.textContent = ...` 블록
  - 추가: `setActiveRange(btn.dataset.range)` 직후 `applyRangeLabels(btn.dataset.range)` 호출
  - 의존: T3
  - 검증: 필터 클릭 시 timeline-meta 라벨 갱신 / `#chartSubtitle`은 변경되지 않음

- [x] **T5**: JS — 초기화 시점 `applyRangeLabels` 호출
  - 파일: `packages/web/assets/js/main.js` (init 흐름)
  - 추가: 페이지 첫 로드 시 `applyRangeLabels(getActiveRange())` 호출
  - 의존: T3
  - 검증: 새로고침 시 라벨 정상 노출

- [x] **T6**: `screen-inventory.md` 갱신
  - 파일: `.claude/skills/ui-designer/references/web/screen-inventory.md`
  - 추가: chartSection / timeline-meta 영역에 라벨 동기화 동작 기록
    - `RANGE_LABELS` SSoT, `applyRangeLabels(range)` 호출 흐름
    - chartSubtitle 고정 의미 ("최근 30분 · 실시간")
  - 의존: T1~T5
  - 검증: 문서에 변경 반영됨

## 완료 기준

- date-filter 변경 시 timeline-meta 두 그룹 라벨이 즉시 동기화됨
- 초기 로드 (기본 `all`) 라벨이 정상 노출됨
- `#chartSubtitle`은 timelineChart 본질("최근 30분 · 실시간")로 고정 — 필터와 분리
- 모든 task 체크박스 완료
- screen-inventory 현행화
- CSS 하드코딩 색상 없음 (본 feature는 CSS 변경 없음)
