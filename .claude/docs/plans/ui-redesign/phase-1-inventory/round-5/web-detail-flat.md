# web-detail-flat — Detail Flat View (W9)

> 세션 상세의 첫 번째 탭. 단일 세션의 모든 요청을 플랫 테이블로 표시 + 타입별 소계.
> 5라운드 누적 인벤토리.

---

## R1 — 1차 작성

### 컨테이너 (`#detailFlatView.detail-content`)

- 표시 조건: `_detailFilter` 적용 후 데이터를 `makeRequestRow(r, { showSession: false, fmtTime: fmtDate })`로 렌더
- 자체 스크롤 영역 (overflow-y:auto)

### colgroup
- 100/88/120/130/flex/48/48/52/68 px (Time/Action/Target/Model/Message/in/out/Cache/Duration)
- W5와 동일하지만 Session 컬럼 없음 (`FLAT_VIEW_COLS = 9`)

### thead
- Time / Action / Target / Model / Message / in / out / ⚡Cache / Duration

### tbody (`#detailRequestsBody`)
- W5와 동일 행 렌더 (`makeRequestRow`) 다만:
  - showSession: false → cell-sess 미표시
  - fmtTime: fmtDate (절대 시간 — 오늘이면 시각만, 아니면 MM/DD HH:MM:SS)
  - 컬럼 합 9개

### 하단 소계 행
- W5와 다른 점: 마지막에 `.flat-subtotal` 행 추가
- 텍스트: `${typeBadge(type)} ${count}건` (각 타입별, count 내림차순)
- text-align: right

### 빈 상태
- "요청 데이터 없음" (`<td colspan="9" class="table-empty">`)

---

## R2 — 검토

1. **W5와 차이점 명확화**:
   - cell-sess 컬럼 없음 (showSession=false)
   - 시각 포맷 다름 (fmtTimestamp → fmtDate, 상대시간 부재)
   - colspan 다름 (10 → 9)
   - 하단 소계 행 추가
2. **renderDetailRequests 스크롤/확장 보존**:
   - `scrollEl.scrollTop` 캡처/복원
   - 열린 prompt-expand-row의 `expandedFor` ID 캡처/복원
3. **타입별 소계 정렬**: count 내림차순.
4. **prompt-expand 복원 시점**: 빈 텍스트 캐시(_promptCache)에 있어야 복원. 캐시 max 500.
5. **detail filter 적용 흐름**:
   - applyDetailFilter() → flat용 list 생성 (전체 또는 type/agent/skill/mcp 필터)
   - renderDetailRequests(list) → tbody innerHTML 교체 + subtotal 추가
   - 그 후 `_detailSearchQuery` 적용 (별도 별 행 display 토글)
6. **filter 카운트 라벨**: detailTypeFilterBtns 버튼 텍스트가 `Label (count)`로 갱신 — applyDetailFilter 내부에서.
7. **카운트 매핑**: countMap = { all, prompt, tool_call, system, agent, skill, mcp }. agent는 tool_name='Agent', skill='Skill', mcp는 'mcp__'.
8. **소계 행은 필터 적용 후 결과 기준**: typeCounts는 list(필터 후) 기반 — 따라서 필터 변경 시 소계도 갱신.
9. **prompt-preview 클릭 동작**: main.js detailView 핸들러에서 `[data-expand-id]`를 가로채 togglePromptExpand 호출.
10. **column resize**: `initColResize(document.querySelector('#detailFlatView table'))` — flat 테이블도 resize 가능.

---

## R3 — R2 반영 + 추가

### 보강

- **W5와 정확한 비교**:
  | 항목 | W5 (대시보드) | W9 (플랫) |
  |------|--------------|-----------|
  | 컬럼 수 | 10 | 9 |
  | Session 컬럼 | ✅ | ❌ |
  | 시각 포맷 | fmtTimestamp (상대시간 포함) | fmtDate (절대시간) |
  | 소계 행 | ❌ | ✅ |
  | scroll-lock 배너 | ✅ | ❌ |
  | 더 보기 버튼 | ✅ | ❌ |
  | anomaly 배지 | ✅ | ❌ (현재 anomaly 미적용) |
  | filter 카운트 라벨 | ❌ | ✅ |
  | search 적용 | model/action/preview/role | action/preview/role (model 제외) |

- **anomaly 미적용 검증**: renderDetailRequests에서 `anomalyMap` 인자 미전달 → makeRequestRow의 anomalyFlags=null. **W9는 spike/loop/slow 배지 모두 미표시**.
- **search 적용 대상 차이**:
  - W5: `.model-name`, `.action-name`, `.prompt-preview`, `.target-role-badge`
  - W9: `.action-name`, `.prompt-preview`, `.target-role-badge` (model-name 제외)
  - **잠재 비일관**: 같은 makeRequestRow 결과인데 search 대상이 다름.
- **count 라벨 동기화**: 응답 후 `applyDetailFilter()` 첫 호출 시 카운트 채워짐. 세션 전환 시 클리어 후 재설정.

### 추가 인터랙션

- **prompt 확장 복원**: SSE 갱신(refreshDetailSession) 후에도 expandedFor 보존.
- **스크롤 위치 보존**: SSE 갱신 후 savedScroll 복원.
- **Agent/Skill/MCP 필터 클라이언트 적용**: `r.tool_name` 기반.

---

## R4 — 검토 (미세·키보드·에러·상태 전이)

1. **W9 키보드 접근성**: W5와 동일하게 행 tabindex 부재. detail 뷰에서도 키보드 내비 부재.
2. **소계 행 의미**: 타입별 N건. 그러나 토큰/시간 합계는 표시 안 함.
3. **소계 정렬 일관성**: count 내림차순 — 타입 색 매핑과 무관 (필터 버튼 색 순서와 다름).
4. **anomaly 배지 부재**: W5 비교 시 명백한 불일치. 같은 행 데이터인데 detail 뷰에서는 spike/loop/slow가 안 보임.
5. **SSE refreshDetailSession 빈도**: SSE new_request 수신 시 selectedSession === sess 이면 refresh. 빈번하면 깜박임 가능.
6. **scrollEl 보존 race**: SSE 갱신 시 savedScroll이 0 (사용자가 막 진입한 상태)이면 0으로 복원 — `if (scrollEl && savedScroll)` 가드. 0이면 복원 안 함.
7. **빈 데이터 처리**: 응답이 [] 면 "요청 데이터 없음" 행, 소계 행 없음.
8. **detail filter all에서 빈 list**: applyDetailFilter는 filter='all'에서 _detailAllRequests 그대로. 빈 배열이면 renderDetailRequests([]) → 빈 메시지.
9. **filter 변경 race**: 필터 클릭 → applyDetailFilter() 즉시 호출 (서버 재조회 없음 — 클라이언트 필터). 빠른 연속 클릭 시도 OK.
10. **카운트 라벨이 0건일 때**: 텍스트 "Skill (0)" 같이 표시. 클릭 시 빈 결과 — 사용자가 예상 가능.
11. **테이블 sticky thead 부재**: 스크롤 시 헤더 사라짐.
12. **flat 뷰 단독 표시일 때 detail-controls-bar는 W8 영역**: 검색/필터 컨트롤은 W8 (Tab Bar/Controls 컨테이너) 안에.
13. **column resize 더블클릭 Auto-fit**: detail flat 테이블도 적용. 그러나 세션 전환 시 (다른 데이터) 자동 재측정 부재.

---

## R5 — R4 반영 + 최종 추가

### 추가된 미세·접근성·상태 전이

- **anomaly 배지 W5/W9 비일관**:
  - 디자인 의도: 대시보드만 anomaly 강조 vs 모든 뷰에 표시
  - 현재: detect는 W5만, W9/W10/W11에선 turn 단위로 한정 적용
  - **잠재 일관성 문제** (Phase 2에서 정리 필요)
- **search 적용 대상 W5/W9 비일관**:
  - W9는 model-name 미포함
  - 단순 코드 차이 — 의도된 누락인지 확인 필요
- **소계 행 보강 후보**:
  - 토큰 총합 (in/out 합)
  - 평균 응답시간
  - 현재는 건수만
- **소계 행 정렬**: count 내림차순 — 디자인 의도 명확하지 않음. 일관 색 정렬도 가능.
- **sticky thead 부재** — 긴 세션 스크롤 시 컬럼 의미 잃음
- **Tab 전환 시 detailFlatView 비활성화** — display:none → 스크롤/확장 상태 유지되지만 다음 세션 선택 시 초기화
- **필터 라벨 0건 시 비활성 표시 부재**: "Skill (0)" 클릭 시 빈 결과. disabled 또는 dim 효과 부재.
- **SSE 인플레이스 업데이트 부재 (W9)**:
  - W5는 prependRequest로 인플레이스
  - W9는 refreshDetailSession 호출 → 전체 re-render (renderDetailRequests innerHTML 교체)
  - 전체 re-render는 깜박임 가능, 그러나 스크롤/확장 보존으로 부드럽게 처리
- **fetch 실패 처리 부재**: refreshDetailSession catch silent. 사용자에게 알림 없음.
- **빈 메시지 텍스트**: "요청 데이터 없음" — W5 "데이터 없음"과 미세 다름.

### 키보드 단축키 (현재 부재)

| 의도 | 현재 |
|------|------|
| 행 ↑↓ 이동 | 없음 |
| Enter | 없음 |
| ESC 검색 클리어 | 없음 (W8에 속함) |
| Cmd/Ctrl+F | 없음 |

---

## 최종 기능 개수 (W9)

- 컨테이너/스크롤: 1개
- colgroup 9컬럼: 9개
- 행 렌더 (W5와 공유): -
- 소계 행 (count 내림차순): 1개
- prompt 확장/복원: 1개 (W5와 공유 함수)
- column resize: 1개
- 빈 상태: 1개
- filter 카운트 라벨 (W8 컴포넌트와 공유): 1개

W9 자체 고유 기능 약 **5개** + W5와 공유 기능 다수.

## 발견된 누락·모호 (Phase 2 입력)

1. anomaly 배지가 W5에만 있고 W9에 없음 — 일관성 문제
2. search 적용 대상이 W5/W9 다름 (model 제외)
3. 소계 행이 건수만 — 토큰/시간 합계 부재
4. sticky thead 부재
5. 필터 0건 라벨에 disabled 시각 단서 부재
6. SSE refreshDetailSession 시 전체 re-render — W5와 다른 패턴 (인플레이스 vs 전체)
7. fetch 실패 알림 부재
8. 빈 메시지 텍스트 W5/W9 비일관 ("데이터 없음" vs "요청 데이터 없음")
