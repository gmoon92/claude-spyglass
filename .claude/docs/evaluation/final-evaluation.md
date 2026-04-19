# Claude Spyglass 최종 종합 평가 보고서

> 작성일: 2026-04-20
> 원본 문서: `.claude/docs/evaluation/spyglass-10round-evaluation/` (10라운드 전문가 평가) + `summary-strip-ux-evaluation.md` (UX 세부 평가)
> 통합 범위: 기술 아키텍처·토큰 수집·UX·컨텍스트·비용·확장성·경쟁력·보안·도입 장벽·대시보드 UI

---

## 1. Executive Summary

### 1.1 최종 점수

| 범주 | 평가 항목 | 점수 | 상태 |
|------|----------|------|------|
| 기술 | 데이터 아키텍처 | 6.5/10 | ⚠️ |
| 기술 | 토큰 수집 정확성 | 5.5/10 | 🔴 |
| 기술 | 비용 분석 | 6.0/10 | ⚠️ |
| 기술 | 확장성·유지보수 | 5.0/10 | ⚠️ |
| 기술 | 보안·개인정보 | 5.5/10 | ⚠️ |
| 사용자 | 실사용자 UX | 5.0/10 | ⚠️ |
| 사용자 | 컨텍스트 엔지니어링 | 4.0/10 | 🔴 |
| 사용자 | 도입 장벽 | 4.0/10 | 🔴 |
| 제품 | 경쟁 차별성 | 4.5/10 | 🔴 |
| **종합** | **10라운드 평균** | **5.3/10** | **실험 단계** |

### 1.2 한 줄 평가

> **"Spyglass는 Claude Code 모니터링의 재미있는 실험이지만, 실무에서 의존할 수 있는 수준은 아니다. 토큰 수집의 취약성과 `Context Growth` 차트의 오해 유발이 가장 큰 문제다."**

### 1.3 사용자 유형별 권고

| 사용자 유형 | 추천 | 근거 |
|------------|------|------|
| 개인 개발자 (로컬 분석) | ⚠️ 조건부 | 설정 공수 감수 가능하면 유용 |
| 엔터프라이즈 (민감 데이터) | ✅ 적합 | 외부 SaaS로 데이터 유출 방지 |
| 팀 단위 비용 관리 | ❌ 부적합 | `ccflare` 권장 |
| 빠른 PoC | ❌ 부적합 | 설정 30분 → PoC 목적 위배 |
| Windows 환경 | ❌ 부적합 | WSL 필수, PowerShell 미지원 |

---

## 2. 강점 (What's Working)

1. **로컬 SQLite 저장** — 민감한 프롬프트가 외부로 유출되지 않음. 엔터프라이즈 보안 환경에서 유일한 차별점.
2. **훅 기반 수집 아키텍처** — `ANTHROPIC_BASE_URL` 변경 없이 Claude Code 훅에 자연스럽게 통합.
3. **SQLite WAL + 64MB 캐시** — 읽기/쓰기 동시성과 내구성의 균형이 적절.
4. **캐시 토큰 분리 수집** — `cache_creation_input_tokens`/`cache_read_input_tokens`를 분리 저장하여 prompt caching 효과를 금액으로 환산 가능.
5. **실시간 SSE 스트리밍** — 웹/TUI 양쪽에서 "살아있는" 모니터링 경험 제공.
6. **부분 인덱스** — `tool_use_id IS NOT NULL` 조건의 부분 인덱스로 불필요한 인덱스 항목 감소.

---

## 3. 치명적 문제 (Critical Issues, P0)

### 3.1 🔴 토큰 수집이 transcript 파일에 100% 의존

**문제 위치:** `packages/server/src/collect.ts:parseTranscript`

```typescript
const tokensInput = transcriptData?.inputTokens ?? 0;  // 파일 없으면 0!
```

**실패 시나리오:**

| 시나리오 | 결과 | 사용자 체감 |
|---------|------|------------|
| transcript 파일 롤오버 | 토큰 0 저장 | "왜 0으로 나오지?" |
| 지연 쓰기 (기록 전) | 토큰 0 저장 | "버그인가?" |
| JSON 파싱 오류 | 토큰 0 저장 | 데이터 소실 |
| 100MB+ 대용량 파일 | 읽기 타임아웃 | 응답 없음 |

**파급 효과:**
- "10K 토큰 알림"이 0으로 잡히면 무의미해짐
- 비용 분석이 완전히 잘못된 값을 제공
- 사용자 신뢰도 붕괴

**해결 방향:**
```typescript
interface TokenResult {
  value: number | null;  // 실패 시 null (0 대신)
  confidence: 'high' | 'medium' | 'low' | 'error';
  source: 'transcript' | 'estimated' | 'unavailable';
  error?: string;
}
// UI: "12,456 ✓" / "~8,000 ~" / "-- ⚠️"
```

### 3.2 🔴 `Context Growth Chart`의 개념적 오류

**문제 위치:** `packages/web/assets/js/context-chart.js`

```javascript
const CTX_MAX_TOKENS = 200_000;
const WARN_RATIO = 0.80;
const values = sorted.map(t => t.prompt.context_tokens || t.prompt.tokens_input || 0);
```

**핵심 오해:**

| 사용자 인식 | 실제 측정값 |
|------------|------------|
| Context Window 사용률 | 누적 input_tokens 합계 |
| 80% 도달 시 압축 시작 | 80% 경고선은 임의 숫자 |
| 200K 한도 | 모델별로 다름 |

**왜 오해를 유발하는가:**
- Claude Code 내부의 실제 context window 사용량은 외부에서 알 수 없음
- `context_tokens`는 `tokens_input`과 혼용되어 정의가 모호함
- 사용자는 "80% 넘었으니 새 세션 시작하자"는 잘못된 행동을 함

**해결 방향 (우선순위):**
1. **최선:** Context Chart 제거
2. **차선:** 이름 변경 (`Accumulated Tokens`) + 80% 경고선 제거 + 툴팁 추가
3. **피해야 할 선택:** Context Window를 추정하려는 시도 (부정확성 가중)

### 3.3 🔴 높은 도입 장벽 (5% 전환율 추정)

**설치 단계:** Bun 설치 → clone → install → `SPYGLASS_DIR` → `settings.json` 수동 편집(6개 훅) → 서버 별도 실행 → Claude Code 재시작 (총 20~30분).

**사용자 이탈 퍼널:**
```
100명 관심 → 70명 시도 → 40명 Bun 설치 → 15명 settings 완료 → 5명 사용
```

**특히 위험한 지점:**
- `settings.json`에서 쉼표 하나 빠지면 Claude Code 자체가 실행 불가 → 30분+ 디버깅
- `bun run dev` 깜빡하면 데이터 수집 자체가 누락 (사용자는 인지 못함)
- Windows는 WSL 필수, PowerShell 훅 미제공

**해결 방향:**
- `curl -fsSL .../install.sh | bash` one-liner 제공
- Homebrew formula · Docker 이미지 배포
- `hooks/spyglass-collect.sh`에 서버 자동 기동 로직 탑재
- 설정 검증 CLI(`spyglass doctor`) 제공

---

## 4. 주요 문제 (P1)

### 4.1 N+1 쿼리 및 메모리 그룹화
- `getAllSessions()`가 세션당 2회 추가 쿼리 (1000세션 → 2000회 추가)
- `getTurnsBySession()`이 전 행을 메모리 로드 후 JS에서 그룹화 → O(n) 메모리
- **해결:** `LEFT JOIN` + 윈도우 함수, 페이지네이션 지원

### 4.2 마이그레이션 시스템의 비일관성
- V1~V8은 `PRAGMA table_info` 방식, V9~V10은 `user_version` 방식 하이브리드
- V6이 코드상 V7보다 뒤에 정의됨 → 순서 혼란
- 롤백 전략 부재
- **해결:** `migrations/001-init.sql` 파일 분리 + 트랜잭션 기반 순차 실행 + up/down 지원

### 4.3 가격 하드코딩
- `MODEL_PRICING` 배열이 코드에 하드코딩 → Anthropic 가격 변경 시 재배포 필요
- `claude-opus-5` 같은 신규 모델은 `DEFAULT_PRICING` fallback → 부정확한 비용
- **해결:** `~/.spyglass/pricing.json` 외부 파일 + 신규 모델 감지 시 경고

### 4.4 보안 — 민감 정보 마스킹 부재
- `payload`가 원본 그대로 `requests.payload`에 저장됨
- `Bash` 도구의 `command`에 API 키/비밀번호가 포함될 수 있음
- 로그 파일 권한 미설정 (755로 생성 가능)
- **해결:** PII 마스킹 패턴 적용, `chmod 700/600`, 데이터 보관 정책(TTL), 선택적 원본 저장 옵션

### 4.5 TUI/Web 기능 중복
- 실시간 모니터링·세션 목록·요청 상세·토큰 통계·설정 5개 기능 전부 중복
- 유지보수 부담 2배, 기능 불일치 위험
- **해결:** 선택적 빌드(`build:tui-only`, `build:web-only`) 또는 하나로 통합

---

## 5. 개선 권장 (P2)

| 항목 | 현재 | 개선 방향 |
|------|------|----------|
| `event_type` 필터 중복 | 쿼리마다 WHERE 절 다름 | `CREATE VIEW visible_requests` 뷰로 캡슐화 |
| `tokens_total` 비정규화 | 저장 + 계산 혼재 | 생성 컬럼(generated column) 또는 계산만 |
| `timestamp` 인덱스 부재 | 시간 범위 조회 풀스캔 | 단독 인덱스 추가 |
| F1~F4 키 충돌 | iTerm2·tmux와 충돌 | `~/.spyglass/keybindings.json` 커스터마이징 |
| 하드코딩 maxTokens(100K) | Opus/Haiku 모두 동일 | 모델별 context_window 조회 |
| TUI fetch 실패 | 조용히 실패 | `<Text color="red">⚠️ {error}</Text>` 표시 |
| 차별화 기능 | ccflare 대비 빈약 | CLAUDE.md 효과 분석, 프로젝트별 비교, Tool 체인 최적화 |

---

## 6. Summary Strip UX 개선안 (독립 트랙)

> 원본: `summary-strip-ux-evaluation.md` (2026-04-19)
> 범위: 웹 대시보드 상단 9개 지표 카드의 정보 계층, 라벨링, 시각적 우선순위

### 6.1 진단

**3대 문제:**
1. **정보 계층** — 볼륨(세션/요청/토큰)이 앞, 실시간(활성)이 4번째. 장애 대응 시 오류율(9번째) 파악 지연.
2. **라벨 혼재** — 한글 5개 + 영어 4개(`cost`, `saved`, `p95`, `err`) 혼용.
3. **시각적 우선순위 부재** — 경고 신호(오류율 상승) 인지 어려움.

### 6.2 권고안

**카드 재배열** (권장 순서):
```
[실시간] 활성
[성능]   평균 응답 · P95 · 오류
[구분선]
[볼륨]   세션 · 요청
[비용]   토큰 · 비용 · 절감
```

**라벨 통일:** 영어 4개 모두 한글화 (`cost → 비용`, `saved → 절감`, `err → 오류`, `p95 → P95`), "총" 접두사 제거.

**상태 시각화:**
- 활성 세션: 녹색 원형 인디케이터 + 미세 배경
- 오류율 > 0%: 빨간 텍스트
- 오류율 > 1%: 카드 테두리 강조 또는 배경 틴트

**우선순위:** 1순위(라벨 한글 통일 + 카드 재배열) → 2순위(활성 강조, 오류 경고 상태) → 3순위(그룹 gap).

---

## 7. 개선 로드맵

### P0 — 1~2주 내 해결
1. 토큰 수집에 confidence 필드 추가 (`value: null` + `confidence: 'error'`)
2. Context Chart 제거 또는 `Accumulated Tokens`로 재명명 + 80% 경고선 제거
3. Summary Strip 라벨 한글 통일·카드 재배열

### P1 — 2~4주 내 개선
4. 자동 설치 스크립트 (one-liner) + `spyglass doctor` 검증 CLI
5. PII 마스킹 (API 키/비밀번호 정규식 기반)
6. N+1 쿼리 제거 (`LEFT JOIN` + 윈도우 함수)
7. 로그 파일 권한 `chmod 700/600` 적용

### P2 — 1~2개월 내 개선
8. 가격 외부화 (`~/.spyglass/pricing.json` + 원격 갱신)
9. 마이그레이션 파일 분리 (`migrations/*.sql` + up/down)
10. Homebrew/Docker 배포
11. Windows PowerShell 훅 제공
12. 차별화 기능 개발 (CLAUDE.md 효과 분석, 프로젝트별 비교)

---

## 8. 전문가 합의 및 이견

### 8.1 합의된 강점
- 로컬 저장 아키텍처는 보안 중시 환경에서 유의미
- 훅 기반 수집은 프록시 대비 설정이 상대적으로 간단
- SQLite WAL 모드는 적절한 성능 최적화

### 8.2 합의된 문제
- transcript 파일 의존은 데이터 신뢰성을 심각하게 훼손
- `Context Growth` 차트는 오해를 유발하며 제거가 바람직
- 설정 복잡도는 실제 사용의 주요 장벽

### 8.3 이견
- **TUI/Web 통합 여부** — 실사용자는 통합 선호, 데이터 전문가는 선택적 빌드 선호
- **ccflare 대비 경쟁력** — 대부분 부정적, 로컬 저장 니치는 인정

---

## 9. 결론

Spyglass는 **훅 기반 로컬 수집**이라는 포지셔닝 자체는 유효하지만, 세 가지 P0 문제 — **토큰 수집 취약성**, **오해 유발 시각화**, **높은 도입 장벽** — 이 해결되지 않으면 실무 도구로 승격하기 어렵다.

**전략적 권고:**
1. **"엔터프라이즈 보안 환경용 로컬 Claude Code 분석기"** 로 포지셔닝을 명확화
2. P0 3종을 먼저 해결하여 데이터 신뢰성과 온보딩을 정상화
3. 차별화 기능(CLAUDE.md 효과 분석, 프로젝트별 비교)으로 ccflare·Langfuse와의 경쟁 구도 재편

---

*본 문서는 `.claude/docs/evaluation/` 하위 13개 원본 평가 문서를 통합하여 작성되었으며, 개별 세부 근거는 원본 파일 참조.*
