# ADR: Gantt Chart Enhancement 설계 결정

> 날짜: 2026-04-19

---

## ADR-G01: Tooltip 구현 방식 — DOM overlay vs Canvas 내장

**결정:** DOM overlay (`.stat-tooltip` CSS 재사용)

**이유:**
- Canvas 내장 방식은 텍스트 래핑·스크롤 처리가 복잡
- 기존 `stat-tooltip.js`의 position() 로직과 `.stat-tooltip` CSS가 이미 완성된 인프라 제공
- 신규 CSS/JS 추가 없이 40~50줄 변경만으로 구현 가능

**트레이드오프:**
- DOM overlay는 Canvas 경계 밖으로 tooltip이 나갈 수 있음 → `position: fixed` 사용으로 해결

---

## ADR-G02: hitMap 등록 위치 — initGantt vs renderGantt

**결정:** 이벤트 리스너는 `initGantt()`에서 1회, hitMap 재빌드는 `renderGantt()`마다

**이유:**
- 이벤트 리스너를 `renderGantt`에 넣으면 세션 전환마다 중복 등록 → 메모리 누수
- hitMap 자체는 렌더링 시 좌표가 바뀌므로 매 렌더마다 `_hitMap = []`로 초기화 후 재빌드 필수

---

## ADR-G03: duration_ms=0 처리 전략

**결정:** 점 마커(◆) + 추정 duration 계산 병행

**이유:**
- MIN_BAR_W=3px 유지 시 동일 timestamp 다중 바 겹침으로 식별 불가
- ◆ 마커는 "실행됨"을 명확히 표현하면서 3px 바와 구분
- 추정 duration(다음 tc.timestamp - 현재 tc.timestamp)은 tooltip에만 노출, "(추정)" 명시

---

## ADR-G04: ResizeObserver 등록 대상

**결정:** `#ganttScroll` 컨테이너 관찰

**이유:**
- Canvas 자체가 아닌 스크롤 컨테이너 관찰 시 패널 리사이즈·탭 전환 모두 감지 가능
- `clearGantt()`에서 `_ro.disconnect()` 호출로 정리

---

## ADR-G05: Zoom/Pan 구현 시기

**결정:** Phase 3 이후로 연기

**이유:**
- hitMap이 zoom 상태에 종속되어 모든 좌표 계산 함수 재작성 필요
- Tooltip이 먼저 구현되면 zoom 없이도 정보 접근성 충분히 확보됨
- 세션 재생 Scrubber(G12)와 함께 별도 기획 후 진행
