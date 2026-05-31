# tasks.json 스키마 정합성 검토 — TaskCreate 1:1 등록 가능성

> 대상: `docs/react-migration/tasks.json` (36 tasks, 5 phases)
> 검토자: 스키마 정합성 검토자 / 2026-05-31
> 결론: **등록 가능(PASS). 차단 결함 0건.** 권고 수정 4건(전부 비차단).

## 1. 판정 요약

| 검증 항목 | 결과 | 비고 |
|-----------|------|------|
| JSON 파싱 유효성 | PASS | top keys: mission/constraints/baseline/phases/tasks |
| 필수 필드 존재 (10개) | PASS | 36/36 태스크 모두 id·title·phase·path·depends_on·status·test_strategy·worktree·risk·done_criteria 보유, 빈 값 0 |
| id 중복 | PASS | 중복 0건 |
| id 명명 규칙 (`P{phase}-{nn}`) | PASS | 36개 전부 정규식 `P\d-\d\d` 일치, phase 번호와 prefix 일치 |
| depends_on 참조 유효성 | PASS | 모든 참조가 실재 id (dangling 0건) |
| 순환 의존 | PASS | DFS 결과 cycle 0건 |
| 위상 정렬 가능성 | PASS | 36/36 정렬 완료(DAG 확정) |
| 순방향(forward) 페이즈 의존 | PASS | 후행 페이즈를 의존하는 태스크 0건 |
| merge_order ↔ phase 태스크 집합 | PASS | 5개 페이즈 모두 누락·잉여 0 |
| merge_order ↔ depends_on 정합 | PASS | 글로벌 머지 순서에서 의존성 역전 0건 |
| status enum | 주의 | 전 태스크 `pending` 단일값 — enum 정의 부재(아래 4-A) |
| 단일 루트 / 싱크 | PASS | 루트 P1-01(유일), 싱크 9개 정상 |

## 2. TaskCreate 매핑 적합성

Claude Code `TaskCreate`는 `subject`(필수)·`description`(필수)·`activeForm`(선택)·`metadata`(선택)를 받고, 의존성은 생성 후 `TaskUpdate`의 `addBlockedBy`/`addBlocks`로 설정한다. tasks.json은 이 모델에 직접 사상 가능하다.

| TaskCreate 필드 | tasks.json 원천 | 적합성 |
|-----------------|----------------|--------|
| `subject` | `title` | 적합. 단 4건이 120자 초과(아래 4-B) |
| `description` | `path` + `test_strategy` + `done_criteria` 결합 | 적합 |
| `metadata` | `phase`·`risk`·`worktree`·`path` | 적합(임의 키 허용) |
| `addBlockedBy` | `depends_on` | 적합. P1-04(fan-in 12)가 최대 차단원 |
| status 흐름 | `status` (`pending`) | 적합. TaskCreate는 항상 `pending`으로 생성되므로 1:1 일치 |

**등록 절차 정합성**: TaskCreate는 모두 `pending`으로 생성된다. tasks.json도 전부 `pending`이므로 초기 상태 불일치 없음. 이후 `depends_on`을 `addBlockedBy`로 주입하면 DAG가 그대로 재현된다(순환 없음이 보장되어 `addBlockedBy` 주입 시 교착 불가).

## 3. 의존 구조 분석(참고)

- **루트(depends_on 빈 배열)**: `P1-01` 단 1개 — 전체 그래프의 유일 진입점. TaskCreate 등록 시 P1-01만 즉시 착수 가능 상태가 되어 명확.
- **최대 fan-in**: `P1-04`(Zustand 스토어) 12건, `P1-01` 7건, `P2-01` 4건. P1-04/P1-01이 병목이므로 우선 완료 필요 — merge_order가 이를 반영(P1-01→P1-06→P1-04).
- **싱크(아무도 의존 안 함)**: P1-05, P2-02·03·06·07, P3-07, P4-07, P5-03, P5-06 — 페이즈 말단 작업으로 자연스러움.
- **최종 게이트**: P5-06 ← P5-05 단일 체인. 전체 36개가 P5-06에 도달하는 단일 종료점 구조는 아니나(P5-06은 P5-05만 직접 의존), 머지 순서상 마지막에 배치되어 종합 보고 시점은 정합.

## 4. 권고 수정(전부 비차단)

### 4-A. status enum 명시 부재 (권고)
모든 태스크가 `"pending"` 단일값이며, 허용 enum이 스키마 어디에도 선언되어 있지 않다. TaskCreate/TaskUpdate가 쓰는 상태는 `pending`/`in_progress`/`completed`/`deleted`다.
- **수정안**: 루트에 `"status_enum": ["pending","in_progress","completed"]`를 추가하거나, 문서 주석으로 "값은 Claude Code TaskUpdate status에 사상된다"를 명기. tasks.json은 명세 스냅샷이므로 초기값 `pending` 고정은 정당 — enum 합의만 남기면 충분.

### 4-B. title(subject) 길이 초과 4건 (권고)
P1-01(128자), P1-02(137자), P1-05(136자), P4-07(125자)가 120자를 넘는다. TaskCreate `subject`는 길이 제한이 강제되진 않으나 UI 가독성이 떨어진다.
- **수정안**: 괄호 안 상세를 `description`(test_strategy/done_criteria)로 이전하고 subject는 핵심 동사구로 단축. 예: P1-02 → "서버 정적 서빙 계약 결정 문서화 (Vite outDir ↔ dispatch.ts 정합)".

### 4-C. P1-02/P1-03 합성 토큰 (권고)
phase 1 merge_order의 `"P1-02/P1-03(GAP 문서)"`는 단일 문자열에 두 id가 묶여 있다. 정규식 추출로 두 id 모두 인식되어 검증은 통과하나, 자동 파서가 토큰을 그대로 태스크 키로 쓰면 실패한다.
- **수정안**: 배열 항목을 `"P1-02"`, `"P1-03"` 두 원소로 분리하거나, merge_order를 id 배열로만 구성하고 설명은 별도 필드로 분리. (P2·P3에서 순서 변형 토큰들은 단일 id라 무해.)

### 4-D. depends_on 외 path 형식 혼재 (정보)
`path`에 `A.js → B.tsx` 화살표 표기(P2-01 등)와 단일 경로(P1-04 등)가 섞여 있다. 검증·등록에는 무해(metadata 문자열). 자동화로 path를 파싱할 계획이라면 `source`/`target` 분리 필드를 권고하나 현 단계에선 불필요.

## 5. 검증에서 확인하지 않은 범위(휴먼 확인 권고)
- `path`에 적힌 소스 파일이 실제 baseline(HEAD 2126e11)에 존재하는지의 **실측 대조**는 본 스키마 검토 범위 밖이다(파일 경로 문자열의 형식만 검증). 라인 번호 표기(main.js:359-440 등)의 현행성은 별도 트랙에서 대조 필요.
- `test_strategy`의 baseline 수치(12파일/174 pass/20 snapshot)와 실제 `bun test` 결과 일치 여부는 미검증.
