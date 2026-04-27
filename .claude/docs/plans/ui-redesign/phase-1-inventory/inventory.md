# Step 1.3 — 통합 인벤토리 (3라운드)

> 컴포넌트별 5라운드 결과를 모아 전체 통합. Phase 2(디자인 재설계)의 입력으로 사용.
> 작성일: 2026-04-23

---

## 정리 R1 — 1차 통합

### 컴포넌트 매트릭스 (15개 영역)

| 코드 | 컴포넌트 | 플랫폼 | 기능 개수 | 5라운드 문서 |
|------|---------|-------|----------|-------------|
| W1+W2 | Global Shell + Summary Strip | Web | 29 | [web-shell.md](round-5/web-shell.md) |
| W3 | Left Panel (Projects/Sessions/Tools) | Web | 37 | [web-left-panel.md](round-5/web-left-panel.md) |
| W4 | Chart Strip (Timeline/Donut/Cache Panel) | Web | 35 | [web-chart-strip.md](round-5/web-chart-strip.md) |
| W5 | Default View (Recent Feed) | Web | 57 | [web-default-view.md](round-5/web-default-view.md) |
| W6+W7+W8 | Detail Header + Context Chart + Tab Bar | Web | 35 | [web-detail-shell.md](round-5/web-detail-shell.md) |
| W9 | Detail Flat View | Web | 5 (W5와 공유) | [web-detail-flat.md](round-5/web-detail-flat.md) |
| W10 | Detail Turn View (Accordion Cards) | Web | 42 | [web-detail-turn.md](round-5/web-detail-turn.md) |
| W11 | Detail Gantt View | Web | 21 | [web-detail-gantt.md](round-5/web-detail-gantt.md) |
| W12 | Detail Tools View | Web | 25 | [web-detail-tools.md](round-5/web-detail-tools.md) |
| W13 | Cross-cutting (Tooltip/Anomaly/SSE/Resize/Persistence/Keyboard/Prompt Expand) | Web | 27 | [web-cross-cutting.md](round-5/web-cross-cutting.md) |
| T1+T6 | TUI Shell (Layout/TabBar/AlertBanner) + Cross-cutting | TUI | 41 | [tui-shell.md](round-5/tui-shell.md) |
| T2 | TUI Live Tab | TUI | 30 | [tui-live.md](round-5/tui-live.md) |
| T3 | TUI History Tab | TUI | 33 | [tui-history.md](round-5/tui-history.md) |
| T4 | TUI Analysis Tab | TUI | 30 | [tui-analysis.md](round-5/tui-analysis.md) |
| T5 | TUI Settings Tab | TUI | 25 | [tui-settings.md](round-5/tui-settings.md) |

**총 기능 개수**: 약 **472개** (W5+W9 공유분 제외 시 약 467개)

### 인벤토리 형식 통일

- 각 컴포넌트 문서: R1(작성) → R2(검토) → R3(추가) → R4(검토) → R5(최종 추가) 5라운드 누적
- 각 라운드 흔적 명시
- 각 컴포넌트 끝에 "최종 기능 개수"와 "발견된 누락·모호" 섹션
- 통합 R1 단계에서는 모든 문서가 같은 형식 가짐을 확인

---

## 정리 R2 — 누락/중복/cross-cutting 점검

### 1. 컴포넌트 간 경계 모호 항목

#### 검색·필터 인터랙션의 분산
- W5 검색: `#feedSearchInput` (대시보드 피드)
- W8 검색: `#detailSearchInput` (detail 컨트롤 바)
- 두 검색 input은 별도 — 검색 정책/적용 범위가 다름
- W8 검색은 flat 뷰만 적용, turn/gantt/tools 뷰는 미적용

#### 타입 필터 7개의 분산
- W5 타입 필터 (`#typeFilterBtns`)
- W8 타입 필터 (`#detailTypeFilterBtns`)
- 둘 다 7개 동일 (All/prompt/Agent/Skill/MCP/tool_call/system)
- 카운트 라벨은 W8만 동적 갱신

#### 토글 버튼 4종
- W3: `#btnPanelCollapse` (좌측 패널 숨김/펼침)
- W3: `.btn-panel-toggle[data-panel]` (섹션별 접기 — 마크업 누락 가능성)
- W4: `#btnToggleChart` (차트 영역 접기)
- W6: `#btnToggleDetail` (detail context chart 접기)
- 같은 디자인 패턴(chevron SVG, 회전, 영속화)이지만 4개 별도 구현

#### 토글 동작 + localStorage 키
- panel-hidden / panel-width / chart-collapsed / panel-state(섹션별) — prefix 비일관 (`spyglass:` 일부)

### 2. 기능 누락 cross-cutting

#### 키보드 단축키 (전반적 부재)
- 모든 web 컴포넌트에서 행 ↑↓ 이동 부재
- ESC 핸들러 거의 부재 (검색/확장 패널/detail/툴팁)
- Tab ←→ 전환 부재
- 1~9 단축키 (탭/필터) 부재
- Cmd/Ctrl+F (검색 포커스) 부재
- ? (도움말) 부재
- 카드 (W10)만 키보드 양호 (Enter/Space + tabindex + role + aria-expanded)

#### ARIA 일관성 부재
- 대부분 컴포넌트: aria-expanded/aria-controls/role="tab"/role="tablist"/role="tabpanel" 부재
- W10 카드만 일부 ARIA ✅
- TUI는 Ink 라이브러리 특성상 ARIA 무관

#### 빈 상태 텍스트 비일관
- "데이터 없음" (W5)
- "요청 데이터 없음" (W9)
- "턴 데이터 없음" (W10)
- "tool_call 데이터 없음" (W12)
- "프로젝트 없음"/"세션 없음"/"—" (W3)
- "데이터 없음" / "로딩 중…" (W4 도넛)
- 통일된 빈 상태 디자인 SSoT 부재

#### 로딩 상태 비일관
- skeleton shimmer (W2/W3/W5)
- "로딩 중…" 텍스트 (W6 detail-loading, W12, W11 hint)
- "Loading..." 영문 (TUI 전반)
- skeleton vs 텍스트 정책 비일관

#### 에러 상태 비일관
- 에러 배너 (W1 전역)
- 빨간 텍스트 "요청 목록 로드 실패" (W5)
- silent (W3, W12, T2 fetchRecent, T3 fetchDetail)
- TUI 일부 inline error
- 통일된 에러 표시 SSoT 부재

#### 다국어 일관성
- LIVE/OFFLINE (W1) — 영문
- 갱신/날짜 필터 (W1) — 한국어
- "복잡"/"중간" (W10) — 한국어
- "Recent Requests"/"Top Token Consumers" (TUI) — 영문
- "프로젝트를 선택하세요"/"세션을 선택하세요" (W3) — 한국어
- "stable"/"building" (W4) — 영문
- 같은 화면 안 영문/한국어 혼재 — Phase 2에서 정책 결정 필요

### 3. anomaly detection 적용 범위 (재차 강조)

| 뷰 | 적용 |
|----|------|
| W5 Default View | ✅ (모든 행) |
| W9 Detail Flat View | ❌ |
| W10 Detail Turn View | 부분 (turn 단위) |
| W11 Detail Gantt View | 부분 (turn 라벨) |
| W12 Detail Tools View | ❌ |
| TUI 전반 | ❌ |

**anomaly SSoT 부재 — 일관성 문제**

### 4. 시각 위계·그룹핑 부재 (디자이너 피드백 직접 후보)

#### Summary Strip (W2)
- 9개 stat-card 동일 폰트 굵기·크기
- 핵심(활성/오류) vs 보조(요청/토큰) 구분 부재 → "어디 봐야 할지 모르겠다"의 직접 원인

#### Detail Turn Card Footer (W10)
- IN/OUT/⏱/% 동일 무게 4종 — 시각 위계 부재

#### Detail Tools View (W12)
- 3섹션이 같은 도구를 다른 정렬로 노출 → 같은 도구 비교 어려움 → "덩어리 부재" 직접 후보
- 단일 매트릭스 뷰 후보 (도구 1행, 컬럼 3종 지표)

#### Turn Card 단독 vs 그룹 행 (W10)
- chevron 유무만 다름 — 시각 차이 약함 → "덩어리 부재" 직접 후보

#### Recent Feed Type Filter 7개 (W5)
- All/prompt/Agent/Skill/MCP/tool_call/system 평면 나열
- prompt/system vs tool 계열 구분 부재 → 그룹핑 부재 직접 후보

### 5. 시각적 진입점 부재 (디자이너 피드백 직접 후보)

- 헤더에 토글 버튼 없음 (panel-toggle-button-position 라운드에서 좌측 패널 자식으로 이동) → 좌측 시각 무게 약함
- 로고 클릭 동작 없음
- LIVE 배지 클릭 부재
- stat-card 클릭 액션 없음 (활성 → 활성 세션 점프 등 잠재)

### 6. 영속화 정책

- localStorage 키 5종 (W13 정리)
- prefix 비일관 (`spyglass:` 일부)
- 마이그레이션 정책 부재
- 페이지 위치/탭 위치/검색어 영속화 부재 (재진입 시 초기화)

### 7. 데이터 갱신 동선

| 동선 | 갱신 트리거 |
|------|-------------|
| W5 (default) | SSE prependRequest (인플레이스/append) + 1초 debounce fetchDashboard |
| W9 (flat) | refreshDetailSession (전체 re-render) |
| W10 (turn) | refreshDetailSession |
| W11 (gantt) | refreshDetailSession |
| W12 (tools) | setDetailView('tools') 시점만 (실시간 갱신 부재) |
| W2 (summary) | 1초 debounce fetchDashboard (SSE 새 요청 시) |
| W3 (sessions) | SSE 시 해당 세션 토큰 직접 갱신 + 30초 polling fetchAllSessions |
| TUI Live | useStats 5초 폴링 + SSE → fetchRecent |
| TUI History | 5초 폴링 useSessionList + 정적 detail fetch |
| TUI Analysis | useAnalysis (폴링/SSE? 미확인) |

**갱신 정책 SSoT 부재**

### 8. 백엔드 변경 후보 (`feedback.md` 참조)

이번 라운드에서 백엔드 변경이 강제되는 항목은 없음. 모두 UI 변경 또는 사용자 정책 합의 항목.

---

## 정리 R3 — 최종 정리 (Phase 2 입력 형태)

### 디자이너 피드백 핵심 4종에 매핑된 직접 후보

| 디자이너 피드백 | 직접 후보 | 컴포넌트 |
|-----------------|----------|---------|
| "조금 숨막힌다" | Summary Strip 9 stat-card 동일 무게 / 좁은 폭 wrap 정책 부재 | W2, W3, W4 |
| "어디 봐야 할지 모르겠다" | Summary Strip 시각 위계 부재 / Turn Card Footer 4종 동일 무게 | W2, W10 |
| "그룹핑 된 덩어리가 없다" | 단독 vs 그룹 행 시각 차이 약함 (W10) / Tools View 3섹션이 같은 도구 분산 (W12) / Type Filter 7개 평면 (W5/W8) | W5, W8, W10, W12 |
| "AI가 만든 것 같다" | 정보 아키텍처 부재 / 빈 상태/로딩/에러 텍스트 비일관 / 다국어 혼재 | 전반 |

### Phase 2 재설계 시 우선순위 후보 (높음 → 낮음)

#### 우선순위 1 (디자이너 피드백 직접 후보)
1. **Summary Strip 시각 위계 재설계 (W2)**: 9개 평면 → 핵심/보조 그룹핑
2. **Turn Card 단독/그룹 시각 차이 강화 (W10)**: chevron 외 추가 시각 단서
3. **Tools View 단일 매트릭스 뷰 (W12)**: 3섹션 분산 → 1매트릭스
4. **Type Filter 7개 그룹핑 (W5/W8)**: prompt/system vs tool 계열 분리

#### 우선순위 2 (사용성/일관성)
5. **빈 상태/로딩/에러 텍스트 SSoT (W13/전반)**: 통일 디자인
6. **다국어 정책 결정 (전반)**: 영문 only 또는 한국어 only
7. **anomaly 적용 범위 일관화 (W13)**: 모든 뷰 적용 또는 명시 비적용
8. **localStorage prefix 통일 (W13)**: `spyglass:` 강제

#### 우선순위 3 (접근성·키보드)
9. **키보드 내비 전반 (W3/W5/W9/W10/W11)**: 행 ↑↓/Enter/ESC/Tab 단축키 도입
10. **ARIA SSoT (W6/W8/W10/W11/W12)**: role/aria-expanded/aria-controls
11. **TUI Sidebar selectedId 전달 (T1)**: 세션 선택 시각 단서

#### 우선순위 4 (잠재 버그)
12. **closeDetail 핸들러 (W6 / feedback.md A-1)**: 닫기 버튼 동작 확인 또는 제거
13. **AlertBanner 통합 (T1 / feedback.md A-2)**: 미사용 코드 정리
14. **TUI maxTokens (T2 / feedback.md C-1)**: 모델 한도 정확성

#### 우선순위 5 (디자인 정합성)
15. **인라인 style → CSS 토큰화 (W10/W11/W12 chip/legend dot)**: 다크/라이트 대응
16. **chip-arrow 텍스트 → SVG (W10)**: 시각 위계 강화
17. **Context Chart Indicator 색상 동적 (W7)**: warning/critical 시각화
18. **Timeline 색상 단일 → 타입별 (W4)**: 도넛과 시각 일관성

### Phase 2 재설계 시 명시적 제외 (Phase 1 결과)

- 백엔드 API 변경 (서버 응답 구조, SSE 페이로드)
- DB 스키마/마이그레이션
- SQL 쿼리 변경
- claude_events 테이블 구조

이번 인벤토리에서 백엔드 변경이 *강제되는* 항목은 발견되지 않음. (`feedback.md`의 모든 항목은 UI 변경 또는 정책 합의로 처리 가능)

### 재설계 시 보존해야 할 핵심 SSoT

- `renderers.toolIconHtml(toolName, eventType)` — pre_tool pulse 애니메이션 자동
- `renderers.makeRequestRow(r, opts)` — W5/W9 공유
- `renderers.targetInnerHtml(r)` — W5/W9/W10 공유
- `session-detail.compressContinuousTools` — W10 chip/세부 행 공유
- `session-detail.fmtActionLabel` — W10 그룹화 라벨
- `session-detail.buildTurnDetailRows` — W10 펼침 행
- `formatters.fmtToken / fmtDate / fmtTimestamp / fmtRelative / fmtTime / formatDuration / escHtml`
- `chart.TYPE_COLORS` — CSS 변수 동기화
- `turn-gantt.TOOL_COLORS` — CSS 변수 동기화
- `anomaly.detectAnomalies(requests, p95)` — spike/loop/slow 알고리즘
- `resize-utils.measureMaxWidth` — panel-resize/col-resize 공유
- `renderers._promptCache` — 500개 LRU
- `renderers.togglePromptExpand` — 테이블/외부 컨테이너 모두 처리

### 재설계 시 무너뜨리지 말아야 할 행동 (R1~R5에서 명시 ✅된 부분)

- W5 prependRequest 인플레이스 업데이트 (cell-target/duration만, 위치 보존)
- W5 scroll-lock 배너 + 사용자가 위로 본 상태 위치 보정
- W6/W7 detail collapse가 Context Chart만 접고 Tab Bar/Controls/콘텐츠는 항상 표시 (ADR-002)
- W10 카드 키보드 Enter/Space + tabindex/role/aria-expanded
- W10 카드 정렬 통일 48px (turn-view-chevron-alignment)
- W3 패널 토글 floating 위치 (panel-toggle-button-position)
- W3 더블클릭 Auto-fit (panel-resize) + 컬럼 col-resize 공유 측정
- 좌측 패널 30초 polling fail-safe
- localStorage 영속화 5종 (panel-hidden/width/chart-collapsed/panel-state/lastProject)

---

## 부록 — 컴포넌트별 누락 항목 빠른 인덱스

### W1+W2 (Global Shell + Summary Strip)
1. 시각 위계 부재 (9 stat-card)
2. 로고/LIVE 배지 클릭 부재
3. SSE 갱신 시 lastUpdated 미갱신
4. ARIA 부족
5. 반응형 미정
6. is-active-indicator vs active 클래스 중복
7. stat-card 클릭 액션 부재
8. 한국어/영문 혼재

### W3 (Left Panel)
1. 섹션 토글 마크업 index.html에서 누락 가능
2. 키보드 내비 전무
3. ARIA 부족
4. 토글-resize 충돌 우측 가장자리
5. 토큰 바 색상 비일관 (accent vs green)
6. toolIconHtml 사본 분산
7. localStorage prefix 비일관
8. 검색·필터 부재

### W4 (Chart Strip)
1. chartSubtitle vs Timeline 데이터 disconnect
2. Donut/Timeline 인터랙션 부재
3. Cache Panel 섹션 접기 부재
4. Timeline 색상 단일 (타입별 분리 부재)
5. Hover 일관성 (Cache만)

### W5 (Default View)
1. Type Filter 7개 그룹핑 부족
2. 행 키보드 내비 전무
3. ESC 부재
4. anomaly 배지 위치 분산
5. fetch 실패 시 기존 행 사라짐
6. SSE prependRequest는 anomaly 미적용
7. filtered 카운트 부재
8. sticky thead 부재

### W6+W7+W8 (Detail Shell)
1. **closeDetail() 핸들러 누락 (feedback.md A-1)**
2. ARIA tab/panel 전면 부재
3. Tab 키보드 ←→ 부재
4. 검색/필터 탭별 적용 비일관
5. 세션ID/프로젝트명/agg-badge 클릭 부재
6. Loading skeleton 부재
7. Context Chart 모델 한도 미명시

### W9 (Detail Flat)
1. anomaly 배지 W5와 비일관 (W9 미적용)
2. search 적용 대상 W5/W9 다름
3. 소계 행 건수만 (토큰/시간 합 부재)
4. sticky thead 부재
5. SSE 시 전체 re-render

### W10 (Detail Turn)
1. 그룹 토글 키보드 부재
2. aria-controls 부재
3. chip 색상 인라인 style
4. complexity 임계값 근거 약함
5. footer 시각 위계 부재
6. 검색 미적용
7. 단독/그룹 시각 차이 약함

### W11 (Detail Gantt)
1. screen-inventory.md outdated ("미구현" 표기)
2. canvas 키보드 미지원
3. canvas ARIA 부재
4. 페이지 정보 부족
5. anomaly 시각 단서 약함
6. 클릭 영역 작음
7. 줌/스크롤 부재

### W12 (Detail Tools)
1. ARIA 부재
2. 정렬 변경 옵션 부재
3. 3섹션 분산 비교 어려움 (단일 매트릭스 후보)
4. 검색/필터 미적용
5. fetch 재시도 부재
6. AbortController 미적용

### W13 (Cross-cutting)
1. anomaly SSoT 부재
2. 툴팁 ARIA/키보드 부재
3. localStorage prefix 비일관
4. SSE retry exponential backoff 부재
5. Resize z-index 충돌
6. 키보드 단축키 전반 부재

### T1+T6 (TUI Shell + Cross)
1. **AlertBanner 미사용 (feedback.md A-2)**
2. Sidebar selectedId 미전달
3. ESC TODO 미구현
4. / 검색 토글 미연결
5. A 키 미구현
6. maxIndex hardcoded 10

### T2 (TUI Live)
1. **maxTokens 100K 하드코딩 (feedback.md C-1)**
2. 키보드 내비 부재
3. 에러 상태 재시도 부재
4. timestamp stale 위험

### T3 (TUI History)
1. Backspace 검색 충돌
2. 한글 IME 미지원
3. '/' 시맨틱 비표준
4. 더 보기 부재
5. AbortController 미적용

### T4 (TUI Analysis)
1. Top Requests 세션 점프 부재
2. 슬라이스 정책 비일관
3. error 위치 통합
4. 행 ↑↓/Enter 부재

### T5 (TUI Settings)
1. NaN 알림 부재
2. Default 복원 부재
3. apiUrl/pollInterval 검증 부재
4. Cmd/Ctrl+S/Z 부재
5. FIELDS hardcoded
