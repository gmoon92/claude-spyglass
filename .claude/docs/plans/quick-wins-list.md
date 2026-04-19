# Quick Wins — 즉시 해결 가능한 개선 리스트

> 작성일: 2026-04-20
> 근거: `.claude/docs/evaluation/final-evaluation.md` P0 3종
> 목표: 1~2주 내 종합 점수 5.1 → 7.0 상승

---

## 1. 병렬 실행 트랙 (3 features)

3개 feature는 **파일 교집합이 최소**이므로 독립적으로 병렬 진행 가능합니다.

| 트랙 | Feature | 주 편집 영역 | 난이도 | 소요 |
|------|--------|-------------|--------|------|
| A | `context-chart-fix` | `packages/web/assets/js/context-chart.js` 외 | 낮음 | 2~3h |
| B | `token-confidence` | `packages/server/src/collect.ts` + storage + web | 중간 | 1~2d |
| C | `summary-strip-ux` | `packages/web/index.html` + `summary-strip.css` | 낮음 | 2~3h |

### 1.1 파일 교집합 분석

| 파일 | A | B | C | 충돌 위험 |
|------|---|---|---|----------|
| `packages/web/assets/js/context-chart.js` | ✅ | | | 단독 |
| `packages/web/assets/css/context-chart.css` | ✅ | | | 단독 |
| `packages/web/assets/js/session-detail.js` | ✅ | | | 단독 (chart 호출부) |
| `packages/server/src/collect.ts` | | ✅ | | 단독 |
| `packages/storage/src/schema.ts` | | ✅ | | 단독 (컬럼 추가 시) |
| `packages/web/assets/js/api.js` | | ✅ | | B 전용 |
| `packages/web/assets/css/summary-strip.css` | | | ✅ | 단독 |
| `packages/web/index.html` | ⚠️ | | ⚠️ | **Context Card 영역 vs Summary Strip 영역 분리 편집** |

**충돌 완화 전략:** A는 Context Chart 영역(line 190+ 추정), C는 Summary Strip 영역(line 52~90)만 건드림. 머지 시 lines이 다르므로 rebase 가능.

---

## 2. Feature별 핵심 변경 요약

### 🟥 Track A — Context Chart 재설계
**원문 지적:** `Context Growth`라는 이름이 Context Window 사용률로 오해를 유발. 200K·80% 하드코딩.

**핵심 변경:**
- 차트 제목: `Context Growth` → `Accumulated Tokens`
- `WARN_RATIO = 0.80` 경고선 제거
- 200K 하드코딩은 유지하되 "참고 스케일"임을 툴팁으로 명시
- 기존 `context_tokens` fallback 로직 유지 (backwards compat)

**상세:** [`context-chart-fix/plan.md`](./context-chart-fix/plan.md)

### 🟦 Track B — 토큰 수집 신뢰도(Confidence) 표시
**원문 지적:** `parseTranscript` 실패 시 silent 0 저장 → 대시보드 신뢰도 붕괴.

**핵심 변경:**
- `TokenResult` 구조체 도입: `{value, confidence, source, error?}`
- Fallback 시 `value: null` + `confidence: 'error'`
- 스키마에 `tokens_confidence`·`tokens_source` 컬럼 추가 (마이그레이션 V11)
- UI에 `✓ / ~ / ⚠️` 인디케이터

**상세:** [`token-confidence/plan.md`](./token-confidence/plan.md)

### 🟩 Track C — Summary Strip UX 개선
**원문 지적:** 한영 혼재("cost"·"saved"·"err"), 카드 순서가 장애 대응에 부적합, 경고 시각화 부재.

**핵심 변경:**
- 라벨 한글 통일: `cost→비용`, `saved→절감`, `err→오류`, `p95→P95`
- "총" 접두사 제거: `총 세션→세션`
- 카드 재배열: `[실시간] → [성능] → [볼륨] → [비용]`
- 오류율 > 0% 시 빨간 텍스트, > 1% 시 카드 테두리 강조

**상세:** [`summary-strip-ux/plan.md`](./summary-strip-ux/plan.md)

---

## 3. 실행 순서 권장

### Option 1: 완전 병렬 (속도 우선, 3인 이상 팀)
```
t=0h  ┬── A: context-chart-fix  (2~3h)
      ├── B: token-confidence    (1~2d)
      └── C: summary-strip-ux    (2~3h)
```

### Option 2: 순차 (검토 품질 우선, 1인)
```
Day 1 오전: C (summary-strip-ux)  — 가장 가벼움, 워밍업
Day 1 오후: A (context-chart-fix) — UI만 수정, 리스크 낮음
Day 2~3   : B (token-confidence)  — 스키마 변경 포함, 검증 시간 확보
```

### Option 3: 위험도순 (권장) ⭐
```
1. C (summary-strip-ux)   — 사용자 즉각 체감, 리스크 거의 없음
2. A (context-chart-fix)  — 잘못된 멘탈 모델 즉시 차단
3. B (token-confidence)   — 스키마·마이그레이션 수반, 충분한 테스트
```

---

## 4. 완료 기준 (Definition of Done)

| 항목 | A | B | C |
|------|---|---|---|
| 코드 변경 완료 | ✅ | ✅ | ✅ |
| CLAUDE.md 지침 준수 (designer 위임) | `designer` 서브에이전트 사용 | 불필요 | `designer` 서브에이전트 사용 |
| 로컬 서버 실행 검증 | ✅ | ✅ | ✅ |
| 브라우저 실제 동작 확인 | ✅ | ✅ | ✅ |
| 커밋 (`git:commit` 스킬) | ✅ | ✅ | ✅ |
| 원본 평가 문서 교차 링크 | ✅ | ✅ | ✅ |

---

## 5. 제외 항목 (이번 라운드 미포함)

다음 P1/P2 항목은 **별도 라운드**로 분리:
- N+1 쿼리 제거 (대용량 리팩터링 필요)
- 마이그레이션 파일 분리 (기반 시스템 변경)
- PII 마스킹 (설계 논의 선행)
- 자동 설치 스크립트 (배포 인프라 결정 필요)
- 가격 외부화 (운영 정책 합의 필요)

---

*다음 단계: 3개 feature plan 중 우선순위 결정 → `doc-adr` 스킬로 기술 결정 기록 → 구현 착수*
