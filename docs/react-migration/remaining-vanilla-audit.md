# React 마이그레이션 잔여 바닐라 흔크 감사 보고

> 기준: 커밋 8681b45 (v4.2.4) · packages/web/src/ + assets/js/ 기준
> 감사 방법: grep 기반 소스 스캔 + import 그래프 분석 + tsc/test/build 실측

---

## 1. 총평

React 마이그레이션은 **앱 아키텍처 수준(진입점·라우팅·상태·빌드)에서 완료**됐습니다.
그러나 **일부 컴포넌트 낸부에는 imperative DOM 조작 패턴이 잔여**합니다.

| 영역 | 상태 | 비고 |
|---|---|---|
| 진입점 (index.html → main.tsx) | ✅ 완료 | vanilla 앱 부트스트랩 완전 제거 |
| 라우팅 (React Router v6) | ✅ 완료 | BrowserRouter + AppModeSync |
| 상태관리 (Zustand) | ✅ 완료 | state.js 1:1 대체 |
| 데이터 흐름 (fetchers.ts) | ✅ 완료 | render 사이드이펙트 제거 |
| design-system 컴포넌트 | ✅ 완료 | src/components/design-system 40개 |
| **MetaDocsFlow.tsx (SVG)** | ⚠️ 잔여 | innerHTML 8 + appendChild 15 + addEventListener 20+ |
| **use-tooltip.ts** | ⚠️ 잔여 | createElement 2 + appendChild 2 + innerHTML 4 |
| **chip-jump.ts** | ⚠️ 잔여 | DOM 직접 탐색 (getElementById/querySelector) |
| **dangerouslySetInnerHTML** | ⚠️ 잔여 | 9곳 — assets/js HTML 문자열 주입 |
| **window.I18n** | ⚠️ 잔여 | 8개 컴포넌트에서 defaultT fallback |
| **CustomEvent** | ⚠️ 잔여 | ctx-point-hover, session-anomalies-loaded |

---

## 2. 잔여 항목 상세

### 2-1. MetaDocsFlow.tsx — SVG imperative 조작

```
파일: src/features/meta-docs/MetaDocsFlow.tsx
성격: "thin React 껍데기 + useRef escape-hatch"
```

| 패턴 | 횟수 | 구체적 위치 |
|---|---|---|
| `innerHTML = ...` | 8 | 254(icon), 293(sub), 304(row), 487(empty), 491(skeleton), 500(empty), 506(error), 547(shell) |
| `appendChild` | 15 | 255~328(card 조립), 559(nodesLayer), 602(edgesLayer), 737(nodesLayer) |
| `addEventListener` | 20+ | 622~841 (mousedown·mousemove·click·dblclick·mouseover·mouseout) |
| `querySelector` | 12 | 334, 405~552, 690, 806, 839 |

**검증 명령:**
```bash
grep -n "innerHTML\|appendChild\|addEventListener\|querySelector" \
  packages/web/src/features/meta-docs/MetaDocsFlow.tsx
```

**판정:** React의 선언적 SVG와 거리가 있는 명백한 imperative 패턴. 다만 SVG flow 다이어그램의 복잡성(줌/팬/더블클릭/하이라이트) 때문에 정당화됩니다. 완전 React화는 상당한 노력 필요.

---

### 2-2. use-tooltip.ts — imperative 툴팁 생성

```
파일: src/hooks/use-tooltip.ts
성격: React 훅 낸부에서 DOM 요소를 직접 생성·조작
```

| 패턴 | 횟수 | 구체적 위치 |
|---|---|---|
| `document.createElement` | 2 | 194(statEl), 200(cacheEl) |
| `document.body.appendChild` | 2 | 197(statEl), 203(cacheEl) |
| `innerHTML = ...` | 4 | 247(statEl), 257(cacheEl), 285(statEl), 303(statEl) |

**검증 명령:**
```bash
grep -n "createElement\|appendChild\|innerHTML" \
  packages/web/src/hooks/use-tooltip.ts
```

**판정:** React Portal이나 별도 컴포넌트로 대체 가능. 다만 툴팁의 위치 계산(absolute)과 lifecycle(cleanup)이 복잡하여 단순 교체는 어려움.

---

### 2-3. chip-jump.ts — DOM 직접 탐색

```
파일: src/features/session-detail/chip-jump.ts
성격: 칩 클릭 시 DOM에서 행을 찾아 스크롤
```

| 패턴 | 횟수 | 구체적 위치 |
|---|---|---|
| `document.getElementById` | 3 | 42(turnLogBody), 51(turnLogBody) |
| `document.querySelector` | 2 | 45(detailView), 52(turnLogBody) |
| `tr.querySelector` | 1 | 93(preview) |

**검증 명령:**
```bash
grep -n "getElementById\|querySelector" \
  packages/web/src/features/session-detail/chip-jump.ts
```

**판정:** React ref + scrollIntoView로 대체 가능. 현재는 DOM 직접 탐색에 의존.

---

### 2-4. dangerouslySetInnerHTML 9곳

```
원인: assets/js/render/badges.ts·extract.ts 등의 HTML 문자열을 React 컴포넌트에 주입
```

| 파일 | 위치 | 주입 내용 |
|---|---|---|
| `LLMInput.tsx` | 429 | 배너 텍스트 |
| `DetailView.tsx` | 59 | 배지 HTML |
| `FlowPane.tsx` | 62 | 배지 HTML |
| `PrologueCard.tsx` | 34 | 미리보기 HTML |
| `cells.tsx` | 42 | 타겟/캐시 셀 HTML |
| `RequestRow.tsx` | 181, 218 | anomaly 미니배지 + 메시지 미리보기 |
| `SessionRow.tsx` | 90 | anomaly 도트 배지 |
| `PromptExpandRow.tsx` | 50 | 펼침 콘텐츠 HTML |

**검증 명령:**
```bash
grep -rn "dangerouslySetInnerHTML" \
  packages/web/src --include="*.tsx" --include="*.ts" | grep -v test
```

**판정:** React 공식 API이나, 내용 생성은 assets/js의 HTML producer(badges.ts, extract.ts)에 의존. SSoT 이중화 위험(보고서 §SSoT 정책 충돌 참조).

---

### 2-5. window.I18n 전역 참조

```
사용 형태: const defaultT = (k, vars) => window.I18n?.t?.(k, vars) ?? k
```

| 파일 | 라인 | 용도 |
|---|---|---|
| `MetaDocsCatalog.tsx` | 38 | 카탈로그 라벨 fallback |
| `MetaDocsFilterBar.tsx` | 21 | 필터 라벨 fallback |
| `MetaDocsSummaryCards.tsx` | 33 | 요약 카드 라벨 fallback |
| `ToolStatsMatrix.tsx` | 32 | 도구 통계 라벨 fallback |
| `SystemPromptLibrary.tsx` | 29 | 라이브러리 라벨 fallback |
| `SystemPromptDetailModal.tsx` | 28 | 모달 라벨 fallback |
| `ObsPanel.tsx` | 48 | 관찰 패널 라벨 fallback |
| `CachePanel.tsx` | 32 | 캐시 패널 라벨 fallback |
| `LLMInput.tsx` | 46 | LLM 입력 라벨 fallback |

**검증 명령:**
```bash
grep -rn "window\.I18n" \
  packages/web/src --include="*.tsx" --include="*.ts" | grep -v test | grep -v "//"
```

**판정:** i18next 리소스가 완비되면 `useTranslation()`으로 대체 가능. 현재는 fallback 형태로 사용되어 직접 의존이 약함.

---

### 2-6. CustomEvent 잔여

| 파일 | 이벤트 | 용도 |
|---|---|---|
| `ContextChart.tsx` | `ctx-point-hover` | 캔버스 포인트 호버 시 외부 통지 |
| `Sidebar.tsx` | `session-anomalies-loaded` | anomaly 로드 완료 시 사이드바 갱신 |

**검증 명령:**
```bash
grep -rn "CustomEvent\|session-anomalies-loaded\|ctx-point-hover" \
  packages/web/src --include="*.tsx" --include="*.ts" | grep -v test
```

**판정:** React의 콜백/prop으로 대체 가능한 이벤트 버스 패턴 잔여.

---

### 2-7. assets/js 의존 (src/에서 import)

```
실제 import 문: 37개 (운영 코드 기준, 테스트 제외)
고유 소비처 파일: 26개
```

주요 의존:
- `assets/js/formatters.ts` — fmt, fmtToken, fmtRelative (순수 함수, DOM 무관)
- `assets/js/render/badges.ts` — bloatedSysBadge*Html, contextSaturationBadgeFullHtml
- `assets/js/render/extract.ts` — contextPreview, extractPromptText
- `assets/js/session-detail/turn-rows.ts` — chipKeyForRequest, compressFlowWithResponses
- `assets/js/request-types.ts` — subTypeOf (순유 분류 함수)
- `assets/js/i18n-utils.ts` — getCollator (순유 유틸)
- `assets/js/state/anomaly-cache.ts` — setBloatedSysFor (모듈 상태 캐시)

**검증 명령:**
```bash
grep -rn "from.*assets/js" \
  packages/web/src --include="*.tsx" --include="*.ts" | grep -v test | grep -v "//"
```

---

## 3. 정당한 패턴 (바닐라 아님)

다음은 React에서도 표준적으로 사용하는 패턴으로 "바닐라 흔적"로 보지 않습니다:

| 패턴 | 파일 | 이유 |
|---|---|---|
| `getElementById('react-root')` | `main.tsx` | React 진입점 찾기 |
| `useRef + canvas getContext` | `Chart.tsx` | 캔버스는 React ref가 표준 |
| `mousemove/mouseup` | `use-panel-resize.ts` | 드래그 핸들 — React에서도 표준 |
| `querySelectorAll('thead th')` | `use-col-resize.ts` | 테이블 컬럼 측정 — 정당 |
| `addEventListener('keydown')` | `AppShell.tsx` | 전역 키보드 단축키 — React에서도 표준 |
| `addEventListener('mousedown')` | `BrowseLayout.tsx` | 외부 클릭 감지 — React에서도 표준 |

---

## 4. 작업 요청

### 우선순위 A (명백한 바닐라 흔적 제거)

1. **chip-jump.ts React화**
   - `document.getElementById('turnLogBody')` → `useRef` + `scrollIntoView`
   - 예상: 2~4h

2. **CustomEvent 제거**
   - `ctx-point-hover` → React 콜백 prop
   - `session-anomalies-loaded` → Zustand 스토어 구독
   - 예상: 2~3h

### 우선순위 B (imperative → 선언적 개선)

3. **use-tooltip.ts 개선**
   - `createElement`/`appendChild` → React Portal 고려
   - 예상: 4~8h (툴팁 위치 계산 복잡)

4. **MetaDocsFlow.tsx SVG React화 (선택)**
   - imperative 이벤트 → React onMouseDown/onClick
   - innerHTML → JSX
   - 예상: 16~24h (복잡도 높음, 선택적)

### 우선순위 C (SSoT 정리)

5. **배지 producer React화**
   - `render/badges.ts`의 순수 판정 로직 → 단일 모듈 추출
   - 표면 → JSX 컴포넌트
   - `dangerouslySetInnerHTML` 9곳 제거
   - 예상: 8~16h (SSoT 이중화 정책 합의 필요)

6. **window.I18n 제거**
   - i18next 리소스 완비 확인 후 `useTranslation()` 대체
   - 예상: 4~6h

---

## 5. 검증 체크리스트

작업 완료 후 다음을 확인:

- [ ] `grep -rn "getElementById\|querySelector" src/ --include="*.tsx"` (test 제외) → 0건
- [ ] `grep -rn "innerHTML" src/ --include="*.tsx"` (test 제외) → MetaDocsFlow만 남김
- [ ] `grep -rn "dangerouslySetInnerHTML" src/ --include="*.tsx"` (test 제외) → 0건
- [ ] `grep -rn "window\.I18n" src/ --include="*.tsx"` (test 제외) → 0건
- [ ] `grep -rn "CustomEvent" src/ --include="*.tsx"` (test 제외) → 0건
- [ ] `bun run --cwd packages/web typecheck` → 0 error
- [ ] `bun run --cwd packages/web test` → 전량 pass
- [ ] `bun run --cwd packages/web build` → 정상 종료

---

*작성: 2026-06-03 현행화 · 기준 커밋 8681b45*
