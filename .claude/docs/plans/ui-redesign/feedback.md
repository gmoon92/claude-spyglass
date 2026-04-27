# feedback — 백엔드/DB 변경 허락 요청

> Phase 1 인벤토리 작업 중 발견한, 디자인 재설계만으로는 해결할 수 없거나 백엔드/DB 변경이 필요해 보이는 항목.
> **이 문서의 항목은 임의 진행 금지.** 사용자가 별도 검토 후 허락한다.

---

## 분류

| 카테고리 | 의미 |
|---------|------|
| **A. UI 버그 (즉시 수정 가능)** | UI만 고치면 되지만 영향 범위가 커서 사용자에게 알림 필요 |
| **B. 백엔드 데이터 추가** | 디자인 재설계에 필요하나 서버 응답에 새 필드/엔드포인트 필요 |
| **C. 데이터 정확성** | 현재 표시값이 실제와 다를 가능성 (모델 한도, 임계값 등) |
| **D. SSE/이벤트 구조** | SSE 페이로드 구조 변경 필요 — 변경 금지 영역 |

---

## A — UI 버그 (즉시 수정 후보)

### A-1. `closeDetail()` 핸들러 누락
- **위치**: `index.html` `#btnCloseDetail.btn-close` (Detail Header)
- **현상**: 닫기 버튼이 화면에 있지만 `main.js`에 click 핸들러가 등록되어 있지 않음. 클릭해도 동작 안 함.
- **검증**: `main.js` 전체에 `closeDetail` 함수 정의·호출이 보이지 않음. screen-inventory.md(228라인)는 "closeDetail() 호출"이라 표기.
- **사용자 영향**: 사용자가 detail 뷰에서 default 뷰로 돌아가는 명시적 방법 부재 (좌측 패널에서 다른 세션 선택만 가능).
- **결정 요청**:
  1. UI만 고침 (closeDetail 함수 추가) — Phase 2 디자인 시 처리
  2. 닫기 버튼 자체 제거 (좌측 패널 점프만으로 충분하다고 판단)
  3. 다른 동선 도입 (ESC 키 등)
- **백엔드 영향**: 없음

### A-2. `AlertBanner` (TUI) 정의만 되고 화면 미사용
- **위치**: `packages/tui/src/components/AlertBanner.tsx`
- **현상**: 컴포넌트 정의는 되어 있으나 `app.tsx`에 import/렌더 부재. 화면에 노출되지 않음.
- **사용자 영향**: 알림 시스템(useAlerts)이 작동해도 사용자가 시각적으로 인지 불가.
- **결정 요청**:
  1. Layout에 AlertBanner 통합 (Header 위 또는 Footer 위)
  2. 죽은 코드 제거
  3. Phase 2에서 통합 디자인 결정 후 처리
- **백엔드 영향**: 없음

---

## B — 백엔드 데이터 추가 (재설계 후 필요할 수 있는 항목)

### B-1. Timeline Chart의 날짜 범위 데이터 부재
- **위치**: W4 Chart Strip
- **현상**: Timeline은 클라이언트 in-memory 30분 버킷만. 헤더 날짜 필터(전체/오늘/이번주)를 변경하면 chartSubtitle 텍스트만 변경되고 실제 데이터는 그대로 30분.
- **재설계 시 옵션**:
  1. 그대로 두고 chartSubtitle을 항상 "최근 30분 (실시간)"으로 고정 (백엔드 변경 없음)
  2. 서버에 시간 범위별 timeline 집계 API 추가 (백엔드 변경 필요) — `GET /api/timeline?range=today&buckets=24`
- **결정 요청**: 디자인 의도가 "실시간만" vs "기간 비교" 중 어느 쪽인지 사용자 합의 필요
- **백엔드 영향**: 옵션 2 선택 시 신규 API 1개

### B-2. Tools View 검색/필터 미적용
- **위치**: W12 Detail Tools View
- **현상**: 같은 Detail 뷰의 검색/타입 필터가 tools 뷰에 영향 없음. tools 뷰는 단순 통계 표시만.
- **재설계 시 옵션**:
  1. tools 뷰에 자체 도구명 검색 추가 (클라이언트 필터, 백엔드 변경 없음)
  2. 검색어를 서버 쿼리 파라미터로 전달 (백엔드 변경 필요)
- **결정 요청**: 클라이언트 필터로 충분한지
- **백엔드 영향**: 옵션 2 선택 시 `GET /api/sessions/{id}/tool-stats?q=...`

### B-3. Top Requests에서 세션 점프 동선 부재
- **위치**: T4 Analysis Tab — Top Token Consumers
- **현상**: 비싼 요청 정보만 표시, 해당 세션으로 가는 키보드 동선 부재. requests에 session_id 필드는 있음.
- **재설계 시 옵션**: TUI 키보드 내비 강화 (Enter로 세션 점프) — UI 변경만으로 충분.
- **백엔드 영향**: 없음

---

## C — 데이터 정확성 (백엔드 또는 설정 동기화 필요)

### C-1. TUI LiveTab `maxTokens = 100000` 하드코딩
- **위치**: `packages/tui/src/components/LiveTab.tsx`
- **현상**: 진행률 계산의 분모가 100K 고정. 실제 Claude 모델은 200K(Sonnet/Opus). 사용자가 100K 도달해도 50%만 표시되어 잘못된 안전감 제공 가능.
- **재설계 시 옵션**:
  1. 모델별 한도 매핑 테이블 (TUI 코드, 백엔드 변경 없음)
  2. SettingsTab의 critical 임계값 사용 (백엔드 변경 없음, useConfig 연동)
  3. 서버에서 모델별 한도 응답 (백엔드 변경 필요)
- **결정 요청**: 정책 합의 필요
- **백엔드 영향**: 옵션 3 선택 시 dashboard 응답에 `modelLimits` 필드 추가

### C-2. Anomaly Detection 임계값 hardcoded
- **위치**: `packages/web/assets/js/anomaly.js`
- **현상**: spike 200%, loop 3회, slow p95 — 사용자/세션 컨텍스트와 무관한 고정값.
- **재설계 시 옵션**:
  1. SettingsTab(웹은 부재)에 임계값 노출 — UI 신규 작업
  2. 서버에서 세션별 적정 임계값 계산 — 백엔드 변경
  3. 그대로 두기
- **결정 요청**: 사용자가 anomaly 정의를 어느 정도 통제 권한 가져야 하는지

### C-3. Context Growth Chart 참고 스케일 200K 고정
- **위치**: `packages/web/assets/js/context-chart.js`
- **현상**: REFERENCE_SCALE_TOKENS = 200_000 하드코딩. 푸터에 "참고 스케일: 200K (모델별 상이)"만 표시.
- **재설계 시 옵션**: 모델별 한도 동적 적용 — 서버 응답에 모델 정보 포함되어 있으면 클라이언트만으로 가능
- **백엔드 영향**: 가능하면 없음

---

## D — SSE / 이벤트 구조 (변경 금지 — 보고만)

### D-1. SSE prependRequest는 anomaly 미적용
- **위치**: W5 Default View
- **현상**: SSE로 새 요청이 들어와도 spike/loop/slow 배지가 즉시 안 붙음. detectAnomalies는 fetchRequests 응답에만 적용.
- **재설계 시 옵션**: 클라이언트에서 prependRequest 시점에 anomaly 재계산 (UI 변경만, 백엔드 무관)
- **백엔드 영향**: 없음

### D-2. SSE 인증 부재
- **위치**: `connectSSE` (`main.js`), TUI useSSE
- **현상**: EventSource로 모든 요청 데이터가 모든 사용자에게 노출.
- **컨텍스트**: 로컬 도구 가정이라 합리적이지만, 디자인 재설계 시 멀티 유저 시나리오 가정 시 변경 필요.
- **재설계 시 옵션**: Phase 2 범위 외 — 별도 보안 라운드.
- **결정 요청**: 보안 모델이 변할 가능성 있는지 사용자 합의 필요
- **백엔드 영향**: 인증 추가 시 큰 변경

---

## 요약

이번 Phase 1 인벤토리에서 발견한 **백엔드/DB 변경 후보는 없음** (D는 보고만, A/B/C는 UI 변경 또는 사용자 정책 합의 항목).

가장 시급히 사용자 결정이 필요한 항목:
1. **A-1 closeDetail 누락** — 사용자 동선 영향 큼
2. **A-2 AlertBanner 미사용** — TUI 알림 시스템 노출 여부
3. **C-1 maxTokens 100K 하드코딩** — 정확성 문제

위 3개는 Phase 2 시작 전 정책 합의 필요.
