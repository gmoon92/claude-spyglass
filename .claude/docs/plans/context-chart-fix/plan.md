# Feature Plan — context-chart-fix

> 근거: `.claude/docs/evaluation/spyglass-10round-evaluation/05-context-engineering.md`, `12-critical-issues.md`
> 우선순위: **P0**
> 예상 소요: 2~3 시간

---

## 1. 작업 목표

**`Context Growth Chart`가 사용자에게 "Context Window 사용률"로 오해되는 문제를 제거한다.**

- 오해 유발 요소 제거: `Context Growth` 명칭, `WARN_RATIO = 0.80` 경고선
- 실제 측정 대상을 정직하게 표기: `Accumulated Tokens`
- 200K 하드코딩은 "참고 스케일"로 맥락 설명 추가

**비목표:**
- 실제 Context Window 추정 로직 구현 (불확실성이 커 별도 라운드에서 논의)
- 차트 삭제 (사용자가 누적 토큰 흐름은 여전히 보고 싶어할 수 있음)

---

## 2. 변경 범위

### 2.1 주요 편집 파일

| 파일 | 변경 내용 |
|------|----------|
| `packages/web/assets/js/context-chart.js` | 상수·제목·툴팁 문구 수정, 경고선 렌더링 제거 |
| `packages/web/assets/css/context-chart.css` | `.warn`·`.crit` 클래스 제거 또는 중성화 |
| `packages/web/assets/js/session-detail.js` | `renderContextChart` 호출부의 라벨 동기화 (필요 시) |
| `packages/web/index.html` | Chart 섹션 헤더 문구 수정 |

### 2.2 스키마 변경
**없음** — 기존 `context_tokens` 컬럼과 fallback 로직 유지.

---

## 3. 단계별 실행 계획

### Step 1 — 상수·네이밍 정리 (30분)
```javascript
// Before
const CTX_MAX_TOKENS = 200_000;
const WARN_RATIO     = 0.80;

// After
const REFERENCE_SCALE_TOKENS = 200_000; // Claude 모델 참고 스케일 (실제 한도는 모델별 상이)
// WARN_RATIO 제거
```

### Step 2 — 차트 렌더링 로직 수정 (30분)
- `warnY` 경고선 그리기 삭제
- `usePct >= 80 ? 'warn' : ''` 클래스 분기 제거
- indicator 문구: `"N% (Nk)"` → `"누적 Nk tokens"`
- footer: `"한도 200K"` → `"참고 스케일: 200K (모델별 상이)"`

### Step 3 — 제목·툴팁 교체 (30분)
- HTML 헤더: `Context Growth` → `Accumulated Tokens`
- 차트 옆 `<details>` 또는 `title` 속성에 설명:
  > "이 차트는 누적 input_tokens의 흐름을 보여줍니다. Claude의 실제 Context Window 사용률과 다를 수 있습니다."

### Step 4 — CSS 경고 클래스 중성화 (15분)
- `.warn`, `.crit` 색상 룰 삭제 (또는 `.hidden` 처리)
- 디자인 토큰 파일(`design-tokens.css`)에서 이 차트용 경고 색상 참조 제거

### Step 5 — 검증 (30~60분)
- `bun run dev` 서버 기동
- 실제 세션 데이터로 차트 렌더링 확인
- 기존 세션 열람 시 레이아웃 깨짐 없는지 확인
- 스크린샷 비교 (전/후)

### Step 6 — 커밋 (10분)
- `git:commit` 스킬 사용
- 메시지 예시: `fix(web): Context Chart 네이밍·경고선 제거 — 오해 유발 방지`

---

## 4. 리스크 및 완화

| 리스크 | 확률 | 완화 |
|--------|------|------|
| 기존 사용자가 경고선 사라짐에 혼란 | 중간 | 툴팁에 "실제 한도 관리는 Claude가 자동 수행" 명시 |
| `.warn`/`.crit` CSS가 다른 차트에서도 사용됨 | 낮음 | 변경 전 `grep "\.warn"` 로 용도 확인 |
| 제목 변경이 문서·SKILL.md와 불일치 | 중간 | `screen-inventory.md` 동시 업데이트 |

---

## 5. CLAUDE.md 지침 적용

- **디자이너 서브에이전트 위임 필수** — CSS·레이아웃 변경이 포함되므로 `designer` 에이전트에게 Step 2~4 위임
- **LSP 도구 우선** — `context-chart.js`의 상수·함수 수정 시 LSP rename/refactor 활용

---

## 6. 완료 기준

- [ ] `CTX_MAX_TOKENS`·`WARN_RATIO` 관련 모든 경고 로직 제거
- [ ] 차트 제목 `Accumulated Tokens`로 변경
- [ ] 툴팁에 "Context Window와 다름" 설명 추가
- [ ] 브라우저에서 실제 세션으로 동작 확인
- [ ] screen-inventory 문서 업데이트
- [ ] 커밋 완료

---

## 7. 후속 작업 (별도 라운드)

- 실제 Context Window 추정 모듈 (P2) — 가능한가 여부부터 ADR 필요
- 모델별 동적 스케일 적용 (`claude_events` payload 활용)
