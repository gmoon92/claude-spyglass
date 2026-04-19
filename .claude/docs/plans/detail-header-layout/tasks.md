# detail-header-layout Tasks

> Feature: detail-header-layout
> 시작일: 2026-04-19
> 상태: 완료

## Tasks

- [x] detail-view.css — `.detail-header`에서 `flex-wrap: wrap` 제거
- [x] detail-view.css — `.detail-meta`에서 `flex-wrap: wrap` 제거
- [x] detail-view.css — `.detail-project`에 `flex-shrink: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap` 추가
- [x] detail-view.css — `.detail-session-id`에 `flex-shrink: 0` 추가
- [x] detail-view.css — `.detail-tokens`에 `flex-shrink: 0; white-space: nowrap` 추가
- [x] detail-view.css — `.detail-agg-badges`에서 `width: 100%` 제거, `display: inline-flex; flex-wrap: nowrap; overflow: hidden` 적용
- [x] detail-view.css — `.detail-ended-at` 신규 클래스 추가 (color: var(--text-muted))
- [x] detail-view.css — `.detail-agg-badges--hidden` 신규 클래스 추가 (display: none)
- [x] index.html — `detailEndedAt` span에서 인라인 스타일 제거 → `detail-ended-at` 클래스 추가
- [x] index.html — `detailBadges` div에서 인라인 스타일 제거 → `detail-agg-badges--hidden` 클래스 추가
- [x] session-detail.js — `badgesEl.style.display = 'flex'` → `classList` 방식으로 교체
- [x] session-detail.js — `badgesEl.style.display = 'none'` → `classList` 방식으로 교체
- [x] main.js — `badgesEl.style.display = 'none'` → `classList` 방식으로 교체
- [x] screen-inventory.md 현행화

## 완료 기준

- detail-header 영역이 1줄로 고정되어 줄 바꿈이 발생하지 않는다
- 프로젝트명이 좁은 공간에서 말줄임표(ellipsis)로 축소된다
- 세션 ID·버튼은 항상 완전히 표시된다
- 인라인 스타일이 모두 CSS 클래스로 이관된다
- JS에서 style.display 직접 조작이 없다
