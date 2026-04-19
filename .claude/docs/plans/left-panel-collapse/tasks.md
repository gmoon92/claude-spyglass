# left-panel-collapse Tasks

> Feature: left-panel-collapse
> 시작일: 2026-04-20
> 상태: 진행 중

## Tasks

### Phase 1: HTML 구조 수정
- [ ] index.html: 프로젝트 섹션 헤더 수정 — hint 제거, 토글 버튼 추가
- [ ] index.html: 세션 섹션 헤더 수정 — `panel-header-right` 래퍼 추가, hint 옆에 토글 버튼 배치
- [ ] index.html: 툴 통계 섹션 헤더 수정 — `panel-header-right` 래퍼 추가, hint 옆에 토글 버튼 배치

### Phase 2: CSS 스타일 추가
- [ ] left-panel.css: `.panel-header-right` flexbox 레이아웃 추가
- [ ] left-panel.css: `.btn-panel-toggle` 스타일 추가 (detail-view.css의 `.btn-toggle` 패턴 참조)
- [ ] left-panel.css: `.panel-section--collapsed` 상태 — `.panel-body` 숨김 + row 높이 제약

### Phase 3: JavaScript 구현
- [ ] main.js: `togglePanelSection(sectionId)` 함수 구현
- [ ] main.js: 초기화 로직 — 페이지 로드 시 localStorage에서 상태 복원
- [ ] main.js: 토글 버튼에 클릭 이벤트 핸들러 등록 (이벤트 위임)

### Phase 4: 동작 테스트
- [ ] 브라우저: 프로젝트 섹션 접기/펼치기 확인
- [ ] 브라우저: 세션 섹션 접기/펼치기 확인
- [ ] 브라우저: 툴 통계 섹션 접기/펼치기 확인
- [ ] 브라우저: localStorage 영속화 확인 (새로고침 후 상태 유지)
- [ ] 브라우저: `.panel-resize-handle` 너비 조절 기능 충돌 없음 확인
- [ ] 브라우저: 세션 섹션의 동적 텍스트(`#sessionPaneHint`) 업데이트 정상 동작
- [ ] 브라우저: 툴 통계 섹션의 동적 카운트(`#toolCount`) 업데이트 정상 동작

### Phase 5: 최종 검증 및 문서화
- [ ] 화살표 회전 애니메이션 smooth 확인
- [ ] hover 상태에서 accent 컬러 표시 확인
- [ ] 브라우저 DevTools에서 localStorage 키 확인
- [ ] screen-inventory.md 업데이트 (새 UI 요소 문서화)

## 완료 기준

- [x] plan.md 작성 완료
- [x] adr.md 작성 완료
- [x] tasks.md 작성 완료
- [ ] Phase 1: HTML 구조 수정 완료
- [ ] Phase 2: CSS 스타일 완료
- [ ] Phase 3: JavaScript 구현 완료
- [ ] Phase 4: 브라우저 테스트 통과
- [ ] Phase 5: 최종 검증 완료
- [ ] 요구사항 6개 모두 충족 확인
