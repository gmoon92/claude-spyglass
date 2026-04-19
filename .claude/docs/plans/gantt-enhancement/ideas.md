# Gantt Chart Enhancement Ideas

> 회의 일자: 2026-04-19  
> 참여: 옵저빌리티 전문가 · UX/인터랙션 전문가 · Canvas 기술 전문가  
> 대상 파일: `packages/web/assets/js/turn-gantt.js`

---

## 핵심 합의: 우선순위 매트릭스

| 순위 | 기능 | 난이도 | 변경 규모 | 전문가 합의 | 현재 데이터 |
|------|------|--------|-----------|------------|------------|
| **1** | Hover Tooltip (hitMap + mousemove) | LOW | +40~50줄 | 3/3 만장일치 | 즉시 가능 |
| **2** | ResizeObserver 반응형 처리 | LOW | +10줄 | 기술 전문가 강력 권고 | 즉시 가능 |
| **3** | 토큰 비용 히트맵 (opacity 인코딩) | LOW | +5줄 | 2/3 권고 | 즉시 가능 |
| **4** | Prompt 구간 오버레이 | LOW~MED | +20~30줄 | 2/3 권고 | 즉시 가능 |
| **5** | duration=0 점(◆) 마커 처리 | LOW | +15줄 | 기술 전문가 | 즉시 가능 |
| **6** | 이상 감지 마커 연동 (anomaly.js) | LOW | +10줄 | 옵저빌리티 전문가 | 즉시 가능 (anomaly.js 존재) |
| **7** | 클릭 → 턴 뷰 연동 내비게이션 | MED | +20줄 | UX 전문가 | 즉시 가능 |
| **8** | 시간 축 동적 눈금 (zoom 단위 자동) | LOW | +15줄 | 2/3 권고 | 즉시 가능 |
| **9** | 캐시 히트 시각화 (줄무늬 패턴) | LOW | +20줄 | 옵저빌리티 전문가 | 즉시 가능 |
| **10** | Critical Path 강조 (병목 테두리) | MED | +25줄 | 옵저빌리티 전문가 | 즉시 가능 |
| **11** | X축 Zoom / Pan (wheel + drag) | HIGH | +80~120줄 | 3/3 언급, 우선순위 낮음 | 즉시 가능 |
| **12** | 세션 재생 Scrubber | HIGH | +100줄+ | UX 전문가 (차별화) | 즉시 가능 |
| **13** | Agent 중첩 트리 (서브에이전트 들여쓰기) | HIGH | 스키마 변경 필요 | 옵저빌리티 전문가 | parent_turn_id 추가 필요 |

---

## 기능별 상세

### G1 · Hover Tooltip ★★★★★

**설명:** 바 위에 마우스를 올리면 팝업으로 상세 정보 표시  
**표시 내용:** tool_name · duration_ms · tokens_input/output · timestamp · Turn 번호  
**구현 패턴:**
```
렌더링 시: _hitMap에 {x, y, w, h, tc, turn} 저장
mousemove: clientX/Y → canvas 좌표 변환 → hitMap O(n) 탐색
tooltip: 기존 .stat-tooltip CSS 클래스 재사용 (신규 CSS 불필요)
이벤트 등록: initGantt()에서 1회만 (renderGantt에 넣으면 중복 등록됨)
```
**주의:** `getBoundingClientRect()` 기반이므로 DPR 보정 불필요

---

### G2 · ResizeObserver 반응형 ★★★★☆

**설명:** 패널 너비 변경 시 Canvas 자동 재렌더  
**구현 패턴:**
```js
const _ro = new ResizeObserver(() => {
  cancelAnimationFrame(_resizeRaf);
  _resizeRaf = requestAnimationFrame(() => {
    if (_canvas?.style.display !== 'none') renderGantt(_turns);
  });
});
_ro.observe(_scroll);
```
**참고:** `panel-resize.js`와 동일한 RAF debounce 패턴

---

### G3 · 토큰 히트맵 (opacity) ★★★★☆

**설명:** `tokens_input`이 클수록 바의 불투명도 높게 (0.3 ~ 1.0 매핑)  
**효과:** 비용이 큰 호출을 추가 공간 없이 즉각 식별  
**구현:** `ctx.globalAlpha = 0.3 + 0.7 * (tc.tokens_input / maxTokens)`

---

### G4 · Prompt 구간 오버레이 ★★★☆☆

**설명:** 각 턴 행에 LLM 추론 시간(`prompt.duration_ms`)을 반투명 세로 띠로 표시  
**효과:** 툴 실행 시간 vs LLM 대기 시간 구분 — AI 에이전트 성능 분석의 핵심  
**구현:** `turn.started_at` 기준으로 `prompt.duration_ms` 구간을 회색 반투명 rect 선처리

---

### G5 · duration=0 점 마커 ★★★☆☆

**설명:** `duration_ms === 0`인 호출은 roundRect 대신 ◆ 마커로 렌더링  
**추가 개선:** 다음 tool_call의 timestamp 차이로 추정 duration 계산, tooltip에 "(추정)" 표시

---

### G6 · 이상 감지 마커 연동 ★★★☆☆

**설명:** `anomaly.js`의 spike/loop/slow 플래그를 Gantt 턴 레이블(T3, T7...) 옆에 ⚠ 아이콘으로 표시  
**데이터 흐름:** `session-detail.js`의 `_detailAllRequests`에서 anomaly 결과를 Gantt에 전달

---

### G7 · 클릭 → 턴 뷰 연동 ★★★☆☆

**설명:** Gantt 바 클릭 시 "턴 뷰" 탭으로 전환 + 해당 턴 자동 펼침  
**구현:** hitMap에서 turn_id 추출 → `setDetailView('turn')` + `toggleTurn(turn_id)` 호출

---

### G8 · 시간 축 동적 눈금 ★★☆☆☆

**설명:** 세션 총 duration에 따라 ms/s/m 단위 자동 선택, 격자 5~8분할  
**현황 문제:** 10초 세션과 10분 세션이 동일한 "0 / 중간 / 끝" 3개 레이블 사용

---

### G11 · X축 Zoom / Pan ★★★☆☆ (미래 기능)

**설명:** 마우스 휠로 X축 확대/축소, 드래그로 범위 이동  
**상태 추가:** `_zoom = { scale: 1.0, offsetX: 0 }`  
**복잡도 이유:** hitMap이 zoom 상태에 종속 → 매 renderGantt마다 재빌드 필요

---

### G12 · 세션 재생 Scrubber ★★☆☆☆ (미래 기능, 차별화)

**설명:** 타임라인 상단에 재생 헤드(수직선)를 `requestAnimationFrame`으로 이동  
**효과:** DevTools Performance 패널의 "재생" 경험 이식  
**난이도 HIGH** — 별도 기획 필요

---

## Phase 구분 제안

| Phase | 포함 기능 | 예상 작업량 |
|-------|-----------|------------|
| **Phase 1** (즉시 실행) | G1 Tooltip + G2 ResizeObserver + G3 토큰 히트맵 + G5 점 마커 | ~1일 |
| **Phase 2** (다음 이터레이션) | G4 Prompt 오버레이 + G6 이상 감지 연동 + G7 클릭 연동 + G8 동적 눈금 | ~1일 |
| **Phase 3** (미래) | G11 Zoom/Pan + G12 Scrubber + G13 중첩 트리 | 별도 기획 |
