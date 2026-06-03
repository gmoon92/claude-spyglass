# 다른 세션 작업 위임 프롬프트 — React 마이그레이션 잔여 바닐라 정리

> 이 프롬프트는 다른 Claude 세션(또는 동료 개발자)에게 전달하여 작업을 위임할 때 사용합니다.

---

## 🎯 작업 목표

커밋 8681b45(v4.2.4) 기준으로 packages/web/src/에 남아있는 **imperative DOM 조작 패턴**을 확인하고, 제거 가능한 항목부터 점진적으로 정리합니다.

**전제 조건:**
- React 마이그레이션은 앱 아키텍처 수준에서 완료됨(index.html → main.tsx 단일 진입점)
- 남은 것은 **컴포넌트 낸부의 imperative 패턴**뿐
- `typecheck 0 · test 1,082 pass · build OK`를 항상 유지해야 함

---

## 📋 작업 전 확인 사항

먼저 다음 파일을 읽고 현재 상태를 파악하세요:

```
1. /Users/moongyeom/IdeaProjects/claude-spyglass/docs/react-migration/remaining-vanilla-audit.md
2. /Users/moongyeom/IdeaProjects/claude-spyglass/packages/web/src/features/meta-docs/MetaDocsFlow.tsx
3. /Users/moongyeom/IdeaProjects/claude-spyglass/packages/web/src/hooks/use-tooltip.ts
4. /Users/moongyeom/IdeaProjects/claude-spyglass/packages/web/src/features/session-detail/chip-jump.ts
```

그리고 다음 명령으로 현재 잔여 상태를 직접 확인하세요:

```bash
cd /Users/moongyeom/IdeaProjects/claude-spyglass

# 1. innerHTML 직접 사용
grep -rn "innerHTML" packages/web/src --include="*.tsx" --include="*.ts" | grep -v test | grep -v "//"

# 2. dangerouslySetInnerHTML
grep -rn "dangerouslySetInnerHTML" packages/web/src --include="*.tsx" --include="*.ts" | grep -v test

# 3. document.getElementById/querySelector 직접 사용
grep -rn "document\.getElementById\|document\.querySelector" packages/web/src --include="*.tsx" --include="*.ts" | grep -v test | grep -v "//"

# 4. window.I18n
grep -rn "window\.I18n" packages/web/src --include="*.tsx" --include="*.ts" | grep -v test | grep -v "//"

# 5. CustomEvent
grep -rn "CustomEvent" packages/web/src --include="*.tsx" --include="*.ts" | grep -v test

# 6. src → assets/js import
grep -rn "from.*assets/js" packages/web/src --include="*.tsx" --include="*.ts" | grep -v test | grep -v "//"
```

---

## 🔧 작업 범위 (우선순위 순)

### Phase A: 명백한 바닐라 흔적 제거 (권장 먼저)

**A-1. chip-jump.ts React화**
- `document.getElementById('turnLogBody')` → `useRef` + `scrollIntoView`
- `document.querySelector(#detailView)` → React ref
- 파일: `src/features/session-detail/chip-jump.ts`
- 판정: 기술적으로 가장 쉬움

**A-2. CustomEvent 제거**
- `ContextChart.tsx`의 `ctx-point-hover` CustomEvent → 콜백 prop
- `Sidebar.tsx`의 `session-anomalies-loaded` → Zustand 스토어 구독
- 파일: `src/features/dashboard/ContextChart.tsx`, `src/features/browse/Sidebar.tsx`
- 판정: 이벤트 버스 → React 패턴으로 교체

### Phase B: imperative → 선언적 개선

**B-1. use-tooltip.ts 개선 (선택)**
- `document.createElement` + `document.body.appendChild` → React Portal 고려
- `innerHTML` 주입 → React 컴포넌트
- 파일: `src/hooks/use-tooltip.ts`
- 판정: 복잡도 중간. 툴팁 위치 계산(absolute) 유지 필요.

**B-2. dangerouslySetInnerHTML 정리**
- 9곳의 `dangerouslySetInnerHTML` 중 `cells.tsx`·`RequestRow.tsx`·`SessionRow.tsx` 등은 assets/js HTML producer에 의존
- 배지/셀 렌더링을 React 컴포넌트로 직접 구현하는 방안 검토
- 단, SSoT 이중화 위험 있음 — `render/badges.ts`의 정책(색상·라벨·단계)을 먼저 단일 모듈로 추출 필요
- 파일: `src/components/render/*.tsx`
- 판정: SSoT 정책 합의 후 진행

### Phase C: 고난이도 (선택적, 마지막)

**C-1. MetaDocsFlow.tsx SVG React화**
- `innerHTML` 8개 + `appendChild` 15개 + `addEventListener` 20+개
- React의 선언적 SVG(onMouseDown, onClick 등)로 대체
- 파일: `src/features/meta-docs/MetaDocsFlow.tsx`
- 판정: 가장 복잡함. SVG flow 다이어그램의 줌/팬/더블클릭/하이라이트 기능 유지 필요.

---

## 🚫 하지 말아야 할 것

1. **assets/js의 순수 유틸(formatters.ts, request-types.ts, i18n-utils.ts)을 무조건 src로 이동하지 마세요.**
   - 이들은 DOM·렌더 무관 함수입니다.
   - 위치 정리와 마이그레이션 완료는 다른 문제입니다.

2. **MetaDocsFlow.tsx를 한 번에 완전히 React화하지 마세요.**
   - 1,000+ 줄의 imperative SVG 조작을 한 번에 교체하면 회귀 위험이 큽니다.
   - 이벤트 핸들러 하나씩 교체하는 점진적 접근이 필요합니다.

3. **window.I18n을 무조건 제거하지 마세요.**
   - i18next 리소스가 완비되지 않은 키가 있을 수 있습니다.
   - `defaultT` fallback을 제거하기 전에 모든 키가 react-i18next 리소스에 존재하는지 확인해야 합니다.

4. **테스트를 깨뜨리지 마세요.**
   - 모든 변경 후 `bun run --cwd packages/web test`가 통과해야 합니다.

---

## ✅ 작업 완료 기준

각 Phase 완료 후 다음을 실행하고 결과를 보고하세요:

```bash
cd /Users/moongyeom/IdeaProjects/claude-spyglass

# 타입 체크
bun run --cwd packages/web typecheck

# 테스트
bun run --cwd packages/web test

# 빌드
bun run --cwd packages/web build
```

**통과 기준:**
- typecheck: 0 error
- test: 1,082 pass (현재 기준) 이상 유지
- build: 정상 종료

---

## 📤 보고 형식

작업 완료 후 다음 형식으로 보고하세요:

```markdown
## 작업 보고

### 완료 항목
- [ ] A-1 chip-jump.ts React화
- [ ] A-2 CustomEvent 제거
- [ ] B-1 use-tooltip.ts 개선
- ...

### 변경 파일 목록
- `src/features/session-detail/chip-jump.ts` → `src/features/session-detail/chip-jump.tsx` (변경 내용 요약)
- ...

### 회귀 테스트 결과
- typecheck: X error
- test: X pass / X fail
- build: OK / FAIL

### 남은 항목
- (완료하지 못한 항목과 이유)

### 다음 작업 제안
- (다음 세션에서 진행할 항목)
```

---

**참고 문서:**
- `/Users/moongyeom/IdeaProjects/claude-spyglass/docs/react-migration/remaining-vanilla-audit.md` — 잔여 항목 상세 분석
- `/Users/moongyeom/IdeaProjects/claude-spyglass/docs/react-migration/migration-status-report.html` — 현행화된 종합 보고서
