# Round 9 UX ADR — 요약 스트립 & 세션 상세 헤더 개선

**날짜**: 2026-04-18  
**참여자**: Geunmyeong(개발), Bora(디자인), Hyunwoo(QA), Soyeon(사용자 테스터)

---

## 사용 회의 (Round 8 반영 후)

### 관찰된 문제들

**Soyeon**: "상단 요약 스트립에서 `활성` 카드 숫자가 0일 때도 초록색이야. 활성 세션이 없는데 초록색이면 '뭔가 있는 건가?' 하고 혼동돼. 0이면 기본 색상이어야 할 것 같아."

**Bora**: "`평균 응답시간` 레이블이 길어서 카드 너비가 모자랄 것 같아. 5개 카드가 균등 분할인데 `평균 응답시간` 레이블이 다른 카드 레이블(2-4자)보다 훨씬 길어. 좁은 화면에서 레이블이 잘릴 수 있어."

**Geunmyeong**: "세션 상세 헤더에서 토큰을 `입력 X토큰` 이라고 표시하는데, 실제로 세션의 total_tokens는 입력만이 아니라 총합일 수 있어. 레이블이 혼동을 줘."

**Hyunwoo**: "세션 상세 헤더의 `종료: HH:MM:SS` 포맷이 날짜가 없어서 어제 세션이면 시간만 보이고 날짜를 알 수 없어. `fmtDate` 포맷으로 통일해야 해."

**Bora**: "요청 피드 헤더 `시각/타입/툴/IN/OUT/응답시간/세션` 컬럼명이 영문 혼용이야. `IN/OUT`은 기술적 약어지만 이미 Round 5부터 '입력'으로 표시하던 관례가 있었는데 헤더는 그대로야. 헤더도 통일해야 해."

---

## 결정 사항

### ADR-R9-001: 활성 카운트 0일 때 기본 색상

**결정**: `활성` stat-card의 `.stat-card.active .stat-value` 클래스를 JS에서 동적으로 관리. 값이 0이면 green 적용 안 함.

```js
const activeEl = document.getElementById('statActive');
const count = d.summary?.activeSessions ?? 0;
activeEl.textContent = fmt(count);
activeEl.closest('.stat-card').classList.toggle('active', count > 0);
```

**이유**: 0인데 초록색이면 오해 유발. 의미 없는 상태 표시 제거.

### ADR-R9-002: 요청 테이블 컬럼 헤더 한글 통일

**결정**: 전역 피드 및 세션 상세 테이블의 `IN` → `입력`, `OUT` → `출력` 헤더 변경.

**이유**: 한글/영문 혼용 제거. `OUT` tooltip의 "출력 토큰 (현재 미수집)" 힌트는 유지.

### ADR-R9-003: 세션 상세 헤더 토큰 레이블 수정

**결정**: `입력 ${fmtToken(session.total_tokens)}` → `총 ${fmtToken(session.total_tokens)} 토큰`으로 변경.

**이유**: total_tokens는 입력 토큰 합계. "입력"이 정확하지 않음. "총"으로 의미 명확화.

### ADR-R9-004: 세션 상세 헤더 종료 시각 → fmtDate 사용

**결정**: `detailEndedAt` 포맷을 `.toLocaleTimeString()` → `fmtDate(session.ended_at)`로 변경.

**이유**: 날짜 포함 포맷으로 어제/그제 세션도 날짜 확인 가능.
