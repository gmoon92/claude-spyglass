# detail-ux-improvements 개발 계획

> Feature: detail-ux-improvements
> 작성일: 2026-04-19
> 작성자: Claude Code

## 목표

세션 상세 뷰(detailView)의 두 가지 UX 개선 사항을 구현합니다.

1. "닫기" 버튼 → "접기" 버튼: 텍스트 변경 + 아이콘 추가 + hover 색상을 중립적으로 개선
2. Context Growth 차트 항상 표시: 데이터 없을 때도 영역 유지, 빈 상태(empty state) UI 표시

## 범위

- 포함:
  - `index.html` 버튼 텍스트 및 마크업 수정
  - `detail-view.css` btn-close 스타일 개선 (hover 색상 변경)
  - `context-chart.css` 빈 상태 스타일 추가 (`.context-chart-empty`)
  - `context-chart.js` 숨김 로직 제거 → 빈 상태 UI 렌더링으로 대체
  - `clearContextChart()` 함수에서 `display:none` 제거 → 빈 상태 표시로 전환
  - `screen-inventory.md` 현행화
- 제외:
  - 서버/DB 코드 변경 없음
  - 기존 차트 렌더링 로직 변경 없음 (빈 상태 분기만 추가)

## 단계별 계획

### 1단계: ADR 작성 (doc-adr 스킬)

기술 결정 사항 기록:
- 버튼 아이콘 선택 (`‹` vs `←` vs `⌃`)
- hover 색상 대안 결정
- 빈 상태 UI 구현 방식 (캔버스 대체 vs div overlay)

### 2단계: Tasks 작성 (doc-tasks 스킬)

원자성 작업으로 분해

### 3단계: 구현 (ui-designer 스킬)

Phase 1~5 워크플로우에 따라 구현

## 완료 기준

- [ ] 버튼 텍스트가 "접기"로 변경되고 아이콘이 앞에 표시됨
- [ ] hover 시 red 대신 중립적 색상(text-muted 계열) 사용
- [ ] Context Growth 섹션이 항상 표시됨 (인라인 `display:none` 없음)
- [ ] 데이터 없을 때 빈 상태 메시지 표시
- [ ] 모든 스타일이 CSS 변수만 사용 (하드코딩 색상 없음)
- [ ] screen-inventory.md 현행화 완료
