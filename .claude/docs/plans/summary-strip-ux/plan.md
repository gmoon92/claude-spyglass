# Feature Plan — summary-strip-ux

> 근거: `.claude/docs/evaluation/summary-strip-ux-evaluation.md`
> 우선순위: **P0** (사용자 즉각 체감, 리스크 최저)
> 예상 소요: 2~3 시간

---

## 1. 작업 목표

**웹 대시보드 상단 9개 지표 카드의 정보 계층·라벨·시각적 우선순위를 통일하여 장애 대응·성능 분석 효율을 개선한다.**

### 핵심 전환
- 한영 혼재 해소: 모든 라벨 한글 통일
- 순서 재편: `[실시간] → [성능] → [볼륨] → [비용]`
- 경고 상태 시각화: 오류율 기반 색상·테두리 강조

---

## 2. 변경 범위

### 2.1 편집 파일

| 파일 | 변경 내용 |
|------|----------|
| `packages/web/index.html` | 라인 52~90 Summary Strip 카드 순서·라벨 재편 |
| `packages/web/assets/css/summary-strip.css` | 그룹 간 gap, 오류 상태 스타일 |
| `packages/web/assets/js/api.js` | 오류율 기반 클래스 토글 로직 (있다면 강화) |
| `.claude/skills/ui-designer/references/web/screen-inventory.md` | 현행화 |

### 2.2 라벨 통일안

| 현재 | 개선 |
|------|------|
| 총 세션 | 세션 |
| 총 요청 | 요청 |
| 총 토큰 | 토큰 |
| 활성 | 활성 (유지) |
| 평균 응답시간 | 평균 응답 |
| cost | 비용 |
| saved | 절감 |
| p95 | P95 |
| err | 오류 |

### 2.3 카드 재배열

```
[실시간]  활성
[성능]    평균 응답 · P95 · 오류
[구분선]
[볼륨]    세션 · 요청
[비용]    토큰 · 비용 · 절감
```

### 2.4 상태 시각화

| 조건 | 처리 |
|------|------|
| 활성 세션 > 0 | 녹색 원형 dot + 미세 배경 틴트 |
| 오류율 > 0% | 카드 값 텍스트 빨간색 (`--color-error`) |
| 오류율 > 1% | 카드 테두리 또는 배경 강조 (`.is-critical` 클래스) |

---

## 3. 단계별 실행 계획

### Step 1 — HTML 구조 재배열 (30분)
- `packages/web/index.html` 52~90 라인 카드 순서 변경
- 라벨 텍스트 한글 통일
- 그룹 간 구분선 위치 이동

### Step 2 — CSS 정비 (40분)
- `.summary-strip` flex/grid 간격을 그룹 단위로 조정 (그룹 내 8px, 그룹 간 16px)
- `.stat-card.is-error`, `.is-critical`, `.is-active` 상태 클래스 정의
- 디자인 토큰(`design-tokens.css`)에서 오류·경고 색상 참조

### Step 3 — JS 상태 반영 (40분)
- `api.js` 또는 해당 렌더러에서 통계 응답 시:
  ```javascript
  const errRate = total > 0 ? errors / total : 0;
  document.getElementById('stat-err').classList.toggle('is-error', errRate > 0);
  document.getElementById('stat-err').classList.toggle('is-critical', errRate > 0.01);
  ```

### Step 4 — 검증 (30분)
- `bun run dev` 기동
- 활성 세션 시 dot 표시 확인
- 오류율 인위 주입(또는 기존 데이터로) 상태 토글 확인
- 반응형: 좁은 폭에서 그룹 단위 줄바꿈 되는지

### Step 5 — 문서 갱신 (20분)
- `screen-inventory.md`의 summary-strip 섹션 라벨·순서 업데이트
- `badge-colors.md` 필요 시 오류 색상 추가

### Step 6 — 커밋 (10분)
- `git:commit` 스킬 사용
- 메시지: `feat(web): Summary Strip UX 개선 — 한글 통일·재배열·오류 상태 시각화`

---

## 4. 리스크 및 완화

| 리스크 | 확률 | 완화 |
|--------|------|------|
| 카드 순서 변경에 기존 사용자 혼란 | 낮음 | 라벨 변경이 더 직관적이므로 단기 학습 비용 허용 |
| `err`·`p95` ID 참조 코드가 다른 곳에 있음 | 중간 | 변경 전 `grep "stat-err\|stat-p95"` 전체 검색 |
| `designer` 서브에이전트 없이 직접 CSS 수정 | 높음 | **CLAUDE.md 위반** — 반드시 designer 위임 |

---

## 5. CLAUDE.md 지침 적용

- **디자이너 서브에이전트 위임 필수** — Step 2(CSS), Step 1(레이아웃)은 `designer` 에이전트에게 위임
- **kebab-case 파일명** — 신규 파일 생성 시 준수

---

## 6. 완료 기준

- [ ] 9개 카드 라벨 모두 한글 통일
- [ ] 카드 순서가 `[실시간→성능→볼륨→비용]` 순
- [ ] 오류율 > 0%, > 1% 시 각각 다른 시각적 상태
- [ ] 활성 세션 dot 인디케이터 동작
- [ ] screen-inventory 문서 갱신
- [ ] 브라우저 실측 스크린샷 비교(전/후) 첨부
- [ ] 커밋 완료

---

## 7. 후속 작업 (별도 라운드)

- 실시간 트렌드 표시 (↑↓ 화살표, 지난 1시간 대비)
- 반응형 최적화 (모바일 뷰 그룹 단위 줄바꿈)
- 툴팁 컨텍스트 강화 (`USD 기준`, `최근 1시간` 명시)
