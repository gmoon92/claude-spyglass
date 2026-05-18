# Web Dashboard — Screen Inventory

> claude-spyglass 웹 대시보드의 화면별 컴포넌트 / 인터랙션 / 데이터 의존성 SSoT.
> 디자인 변경 시 본 문서를 반드시 현행화한다. (ui-designer 스킬 규칙 §screen-inventory)

## 화면 목록 (auto-update-migration-hardening 라운드, 2026-05-18)

| ID | 화면 | 위치 (DOM / 파일) |
|---|---|---|
| `sidebar-session-list` | 좌측 패널 세션 리스트 | `#browserSessionsBody` · `assets/js/render/rows.js` `makeSessionRow` |
| `session-header` | 세션 상세 헤더 (요약 배지 영역) | `#detailBadges` · `assets/js/views/detail-view.js` |
| `request-row` | 요청 행 (피드/평면 뷰 공용) | `assets/js/render/rows.js` `makeRequestRow` |
| `context-chart` | 누적 토큰 라인 차트 | `#contextGrowthChart` · `assets/js/context-chart.js` |
| `turn-view` | 턴 카드 뷰 + 헤더 spike summary | `#turnUnifiedBody` · `assets/js/session-detail/turn-views.js` |
| `update-badge` | 좌측 패널 footer 버전 상태 배지 (available/latest/loading) | `#updateBadge` · `assets/js/version-check.js` |
| `update-modal` | 업데이트 모달 + 마이그레이션 결과 + local-changes 안내 | `#updateModal` · `assets/js/version-check.js` |
| `dashboard-shallow-warning` | dashboard 우하단 shallow clone warning 배너 | `#dashboardShallowWarning` · `assets/js/version-check.js` |

---

## sidebar-session-list

**책임**: 선택된 프로젝트의 세션 목록을 시각화. 토큰·시간·live state 표시.

**컴포넌트 위계**:
- 세션 행 `<tr.clickable>` — `makeSessionRow(s, isSelected)`
- 행 내부 헤더 `.sess-row-header` — id / time / tokens / status dot
- preview `.sess-row-preview` — 첫 prompt 미리보기

**anomaly-bloated-sys 신호** (ADR-005):
- `s.bloated_sys.status === 'critical'` 인 세션에만 우측 dot 노출
- dot: `.badge-bloated-sys--dot.is-critical` — 6px 원형, `var(--color-danger)`, 점멸 1.2s ease
- **warn 단계는 미노출** — 사이드바 노이즈 회피, critical만 즉시 행동 유발
- 툴팁: `ui.anomaly.bloated-sys.critical.tooltip` + `…modal` 결합

**관련 ADR**: ADR-001(임계 정책) · ADR-003(서버 SSoT) · ADR-005(glyph 동결 + dot 정책)

---

## session-header

**책임**: 선택 세션의 메타데이터(id / project / tokens / ended_at) 노출 + 요약 anomaly 뱃지.

**컴포넌트 위계**:
- `.chart-detail-meta` — id · project · tokens · ended_at
- `.detail-agg-badges` (id `detailBadges`) — anomaly / cost / top-tool 등 요약 뱃지 호스트

**anomaly-bloated-sys 신호** (ADR-001/005):
- 세션 응답의 `bloated_sys.status === 'warn'|'critical'` 시 `.badge-bloated-sys--full` 부착
- 라벨 형식: `▤ sys {pct}%` (glyph는 ::before로 SSoT, label은 i18n `ui.anomaly.bloated-sys.{stage}.label`)
- **hover 시 context-chart baseline 동기화** — `ctx-baseline-glow` 커스텀 이벤트 디스패치
  - baseline `opacity: .55 → 1.0`, `stroke-width: 1 → 1.5px` (Canvas 토글)
- `bloated_sys === null` 또는 `'normal'` 시 헬퍼가 빈 문자열 반환 → DOM에서 자연 미노출

**관련 ADR**: ADR-001(15/25%) · ADR-005(glyph 동결 · color·border·점멸)

---

## request-row

**책임**: 단일 요청 행. 평면 피드 + 세션 상세 flat 뷰 공용 (ADR-005).

**컴포넌트 위계**:
- `<tr data-request-id>` — `makeRequestRow(r, opts)` SSoT
- 셀: time / action / target / model / msg / in / out / cache / duration / (sess)
- target 셀: `targetInnerHtml(r)` — 아이콘 + 이름 + 상태배지 + spike·agent-spike·bloated mini 뱃지

**anomaly-bloated-sys 신호** (ADR-001/002/005):
- **첫 prompt 행 mini 뱃지** — `r.bloated_sys.status === 'warn'|'critical'` 시
  - `.badge-bloated-sys--mini` Target 셀 우측에 부착 (`bloatedSysBadgeMiniHtml`)
  - 라벨: `▤ sys {pct}%`, 단계별 색·점멸·shadow
- **행 단계 클래스**:
  - `tr.row-bloated-warn` → `box-shadow: inset 2px 0 0 var(--color-warn)` (좌측 2px 표지)
  - `tr.row-bloated-critical` → `inset 2px 0 0 var(--color-danger)` + `inset 0 0 0 1px var(--color-danger-soft)`
- **Agent/Skill 부모 Target 셀 `↑×N`** — `r.agent_spike.status === 'critical' && ratio ≥ 3`
  - `<span.badge-spike data-spike-variant="agent">↑<span.agent-spike-count>×N</span></span>`
  - **N < 3은 기존 `↑` 유지** (회귀 차단)

**캡슐화 규칙** (CLAUDE.md 사용자 지침):
- 모든 뱃지 부착은 `bloatedSysBadgeMiniHtml` / `agentSpikeBadgeHtml` 헬퍼 경유
- 직접 HTML 작성 금지 — i18n 키·tone·축약 형식의 SSoT 보존

**관련 ADR**: ADR-001(bloated-sys 임계) · ADR-002(agent-spike AND 조건) · ADR-005(non-color 신호)

---

## context-chart

**책임**: 세션 누적 토큰 라인 차트 (Canvas). 모델 한도 대비 사용률 추세.

**렌더 단계** (`renderContextChart(turns)`):
1. 데이터 유효성 검사 → empty state 토글
2. 모델 컨텍스트 윈도우 추론 (`resolveSessionContextWindow`)
3. DPR 처리, 캔버스 클리어
4. **격자선** (4분할)
5. **점선 baseline** — `bloated_sys.pct` 비율 위치에 표시 (anomaly-bloated-sys)
6. 영역 fill (남은 한도 / 사용량)
7. 라인 + 호버 가이드 + 데이터 포인트

**anomaly-bloated-sys 신호** (ADR-001/005):
- **점선 baseline** — `bloated_sys.system_tokens` 위치에 점선 표시
  - `stroke: var(--text-muted); stroke-dasharray: 4 3; stroke-width: 1px; opacity: .55`
  - 세션 헤더 hover 시 `_baselineGlow = true` → opacity `.55 → 1.0`, stroke-width `1 → 1.5px`
- **풋터 split 카피** — `ui.chart.footer.split` → `system {sys}% / user {user}%`
  - 풋터 라인 끝에 ` · system 82% / user 18%` 형태로 합류
- **풋터 클릭 → anchor scroll** — 첫 prompt 행으로 `scrollIntoView({block:'center', behavior:'smooth'})`
  - `.row-flash` 1.5s ease 클래스 부여 (`@keyframes row-flash`)
  - 풋터에 `cursor: pointer`, `role="button"`, `tabindex="0"` 부여

**구독 이벤트**:
- `DETAIL_FILTER_CHANGED` — turns 갱신
- `ctx-baseline-glow` — 세션 헤더 hover (T-12 dispatch ↔ T-17 receive)

**관련 ADR**: ADR-001(임계 비율) · ADR-005(점선 baseline)

---

## turn-view

**책임**: 턴 카드 통합 뷰. 사용자 프롬프트(1급) + 메타 시그널 + tool chip 흐름 + IN/OUT/지속시간 + system reminder.

**컴포넌트 위계** (`renderTurnCards`) — turn-header-prompt-prominence 라운드(2026-05-18)에서 2-row 헤더로 재구성:
- `.turn-card` — 카드 컨테이너 (펼침 상태 `.expanded`)
- `.turn-card-summary[data-toggle-card]` — 헤더 영역 (클릭 시 카드 토글, `role="button"` / `tabindex="0"`)
  - **Row 1** `.turn-card-header` — 메타 시그널 묶음
    - `.turn-card-index` (T번호) → system 변경 배지 → `.turn-system-reminder-anchor` (chip+popover) → `.turn-spike-summary`
    - `.turn-card-summary-actions` — 우측 정렬 액션 묶음 (`margin-left:auto`)
      - `.turn-card-action-payload` (API 페이로드 딥링크)
      - `.turn-card-expand-btn` (펼침 chevron, 회전 `-90deg↔0deg`)
  - **Row 2** `.turn-card-prompt-row` — 사용자 프롬프트 1급 노출 (ADR-002)
    - `.turn-card-prompt-icon` — 따옴표 SVG(`svgQuote`, 12px, `--text-3` 톤)
    - `.turn-card-prompt-text` — 본문 (font-size `--text-body` / color `--text-1` / weight-medium / 2줄 line-clamp / `user-select:text`)
    - prompt 없는 케이스(prologue로 분리됨)에는 Row 2 자체 미렌더
    - **min-height 2줄 분량** (turn-prompt-preview-regression 라운드 ADR-002, 2026-05-18) — `calc(var(--text-body) * 1.45 * 2)`. 다중 세션 병렬 환경에서 1줄·2줄 prompt 카드의 시각 단차(약 17px)를 제거해 prompt 영역이 동일 높이로 좌측 정렬. `align-items:flex-start`로 1줄 prompt는 위쪽 정렬, 빈 아래 공간은 자연 여백
- `.turn-card-flow` — 도구 chip 인터리빙 (`compressFlowWithResponses`)
- `.turn-card-footer` — IN/OUT/⏱ + complexity + 비율%
- `.turn-card-expanded` — 펼침 시 `buildTurnDetailRows(turn)` lazy 렌더

**스크롤바 SSoT** (ADR-001):
- `#turnUnifiedBody`에 `scrollbar-width: thin` + `scrollbar-color: var(--border-strong) transparent` (Firefox), WebKit 8px thumb=`--border-strong`(hover `--text-3`) / track=transparent.
- meta-docs / syslib / llm-input-system-content / meta-tool-stats와 동일 패턴.

**캡슐화 규칙** (CLAUDE.md 사용자 지침):
- 헤더 HTML 골격 변경 시 `renderTurnCards`만 수정 — 인라인 스타일 금지, 모든 색·간격·radius는 `design-tokens.css` 토큰을 `var()`로 경유.
- prompt 본문 변경/슬라이스 금지 — Row 2 line-clamp가 시각 한도를 담당. 텍스트 슬라이스를 코드에서 하면 `user-select` 드래그 복사 시 잘린 텍스트가 복사되는 회귀 발생.
- payload + chevron은 반드시 `.turn-card-summary-actions` wrapper로 묶어 단일 우측 정렬 책임 보존.

**데이터 컨트랙트 SSoT** (turn-prompt-preview-regression ADR-001):
- `getTurnsBySession`(`packages/storage/src/queries/request/turn.ts`) 응답의 `turn.prompt`는 반드시 `preview: string | null` 필드를 포함해야 한다.
- 클라이언트의 `turn.prompt?.preview ? escHtml(...) : ''` 분기가 Row 2 렌더 여부를 결정 — `undefined`가 도달하면 Row 2 자체가 안 그려져 다중 세션 식별 UX가 무효화된다.
- 회귀 차단 테스트: `packages/storage/src/__tests__/request-contract.test.ts` "prompt.preview 컨트랙트 — null/빈문자열/정상값 모두 응답에 도달".

**anomaly-bloated-sys 신호** (ADR-002/005):
- **`.turn-spike-summary`** — turn.agent_spike.status === 'critical' AND ratio ≥ 3 일 때만 노출
  - 라벨: `↑{n}× larger than parent row` (i18n `ui.anomaly.agent-spike.summary`)
  - **sparkline SVG 60×16** — 최대 20 샘플 (자식 토큰 시계열)
    - `stroke: var(--color-accent); stroke-width: 1.5; fill: var(--color-accent-soft)`
    - peak `circle r=2 fill: var(--color-accent)`
  - 컨테이너: 우측 정렬 (`margin-left: auto`), `max-width: 280px`, 1줄 ellipsis
- **샘플 데이터 소스**:
  - 1순위: `turn.agent_spike.samples` (서버 제공 시계열)
  - 폴백: `turn.tool_calls`의 자식 토큰 (`tokens_input + tokens_output > 0`)

**관련 ADR**: ADR-002(AND 조건 + 깊이 3 자식 합산) · ADR-005(sparkline·glyph)

---

## update-modal

**책임**: `/api/update` 호출 흐름의 사용자 confirm → 진행 → 결과 시각화. 단일 dialog (`#updateModal`).

**자동 업데이트 강화 라운드(2026-05-18) 변경**:
- 마이그레이션 결과 3분기 영역 + local-changes 안내 영역이 모달 본문 내부에 추가됨
- 두 영역은 default `hidden`, version-check.js가 응답 분기에 따라 인플레이스 토글

**컴포넌트 위계** (`version-check.js` 단일 진입점):
- `.update-modal` — dialog 본체
- `.update-modal-title` — i18n `ui.html.update-modal.title`
- `.update-modal-body`
  - `.update-version-compare` — 현재/최신 버전 비교 (변경 없음)
  - `.update-modal-note` — i18n `ui.html.update-modal.note`
  - **`.update-modal-migration`** (T-08 신규) — 마이그레이션 결과 영역
    - `data-state="empty" | "success" | "failed"` — 3분기 톤 분기 (CSS가 글리프·색·border 동시 적용)
    - `.update-modal-migration-glyph` — 비-색상 신호(dot / ✓ / !) + `failed`는 1.6s ease 점멸
    - `.update-modal-migration-label` — i18n `ui.version-check.migration.{none|applied|applied-single|failed}`
    - `.update-modal-migration-duration` — `{ms}ms` (성공 시만)
    - `.update-modal-migration-detail` — 변경 없음 detail(`none-detail`) / 실패 가이드(`failed-file` + `failed-guide`)
    - `.update-modal-migration-files` — `<details>` 토글, 적용된 파일 리스트 (성공 분기 전용)
  - **`.update-modal-local-changes`** (T-09 신규) — 409 응답 안내 패널 (actions 자리 대체)
    - `.update-modal-local-changes-head` — `!` 글리프 + i18n `ui.version-check.local-changes.title`
    - `.update-modal-local-changes-body` — i18n `ui.version-check.local-changes.body`
    - `.update-modal-local-changes-files` — 응답 `dirtyFiles[]` 최대 5건 리스트 + `+N more` 폴드
    - `.update-modal-cmd-block` — `git status` / `git stash push -m 'before-spyglass-update'` 코드 블록 (비번역) + 복사 버튼
- `.update-modal-actions` — Cancel / Update 버튼 (409 시 자동 hidden)

**3분기 분기 로직** (단일 SSoT: `applyMigrationResult(ma)` in version-check.js):
1. **변경 없음** (`data-state="empty"`) — `ma == null` OR `files.length === 0 && from === to`
2. **성공** (`data-state="success"`) — `files.length > 0`, green tone, ✓ 글리프, 파일 토글 노출
3. **실패** (`data-state="failed"`) — 응답에 `migrationFailure` 또는 error 메시지에 'migration' 포함 시 `applyMigrationFailure()` 호출, danger tone, ! 글리프 점멸

**데이터 의존성** (트랙 A 응답 contract — ADR-004 / ADR-005):
- `POST /api/update` 응답: `{ migrationsApplied?: { from, to, files[], durationMs } }` — 옵셔널, 미수신 시 "변경 없음" 처리
- `POST /api/update` 409: `{ error: 'local_changes', dirtyFiles?: string[] }` — `applyLocalChangesGuard()` 분기
- 트랙 A 미적용 환경에서도 회귀 없이 자연 동작 (방어 코드 + 옵셔널 필드)

**캡슐화 규칙** (CLAUDE.md 사용자 지침):
- 모달 영역 토글은 `applyMigrationResult` / `applyMigrationFailure` / `applyLocalChangesGuard` / `resetMigrationSection` / `resetLocalChangesPanel` 헬퍼 경유 — 직접 hidden 조작 금지
- 복사 버튼은 `bindCopyDelegation(rootEl)` 위임 핸들러 SSoT 사용 — 모달과 dashboard warning 공용

**관련 ADR**: ADR-004(/api/update contract) · ADR-007(local-changes UX)

---

## dashboard-shallow-warning

**책임**: `/api/version` 응답 `isShallowRepository === true` 시 dashboard 우하단에 비차단 경고 배너 노출. 사용자가 자동 업데이트 실패 위험을 사전 인지하고 `git fetch --unshallow`로 복구 가능.

**컴포넌트 위계** (`#dashboardShallowWarning`):
- `.dashboard-warning.dashboard-warning--shallow` — 컨테이너 (fixed, bottom: 36px, left: 12px)
- `.dashboard-warning-glyph` — `!` 글리프 (warn 톤, border + 컬러 동시)
- `.dashboard-warning-body`
  - `.dashboard-warning-title` — i18n `ui.version-check.shallow.warning` ("shallow clone 환경 — 자동 업데이트 실패 위험")
  - `.dashboard-warning-text` — i18n `ui.version-check.shallow.body`
  - `.dashboard-warning-cmd-row` — `git fetch --unshallow` 코드 블록 (비번역) + 복사 버튼
- `.dashboard-warning-dismiss` — × 닫기 버튼 (localStorage `spyglass:shallow-warning-dismissed=1` 영속)

**노출 조건** (단일 SSoT: `applyShallowWarning(isShallow)` in version-check.js):
- 호출 경로: `refreshBadge()` → `/api/version` 응답 → `applyShallowWarning(cache.isShallowRepository)`
- `isShallow === true` AND localStorage dismiss 플래그 미설정 → `hidden = false`
- `isShallow === false` OR undefined → `hidden = true` (회귀 차단)
- dismiss 후엔 다음 세션에서도 비노출. 강제 재노출은 `localStorage.removeItem('spyglass:shallow-warning-dismissed')`

**tone 선택**: warn(black/yellow) — error 아님(자동 업데이트가 "실패할 수 있다"는 위험 안내이지, 현재 동작은 정상이므로). border + glyph + label tone 3중 신호로 색약 사용자 대응.

**관련 ADR**: ADR-007(shallow/local-changes UX — 안내문 + 권장 명령 SSoT)

---

## i18n 카피 키 인덱스

```
ui.anomaly.bloated-sys.warn.label      = "sys {pct}%"
ui.anomaly.bloated-sys.warn.tooltip    = "시스템 컨텍스트 비대 ({pct}%)" / "system context bloated ({pct}%)"
ui.anomaly.bloated-sys.warn.modal      = "시스템 비대 · /mcp list 검토" / "system bloated · /mcp list"
ui.anomaly.bloated-sys.critical.*      = "bloated {pct}%" 계열
ui.anomaly.agent-spike.label           = "↑×{n}"
ui.anomaly.agent-spike.tooltip         = "Agent가 부모 대비 {n}배" / "Agent is {n}× parent row"
ui.anomaly.agent-spike.modal           = "Agent 토큰 폭증 · ↑×{n} · 세션 분리 권장"
ui.anomaly.agent-spike.summary         = "↑{n}× larger than parent row"
ui.chart.footer.split                  = "system {sys}% / user {user}%"

# turn-header-prompt-prominence 라운드 (2026-05-18) — ADR-002
# turn-prompt-preview-regression 라운드 (2026-05-18) — ADR-004 동치 검증 완료, 변경 없음
session.session-detail.turn-views.prompt-row-aria   = "사용자 프롬프트" / "User prompt" / "ユーザープロンプト" / "用户提示"
session.session-detail.turn-views.prompt-icon-aria  = "사용자 프롬프트" / "User prompt" / "ユーザープロンプト" / "用户提示"

# auto-update-migration-hardening 라운드 (2026-05-18) — T-13
ui.version-check.migration.applied         = "마이그레이션 {n}건 적용 (v{from} → v{to})"
ui.version-check.migration.applied-single  = "마이그레이션 1건 적용 (v{from} → v{to})"
ui.version-check.migration.none            = "스키마 변경 없음"
ui.version-check.migration.none-detail     = "DB 버전 v{version} · 이번 업데이트엔 마이그레이션이 없습니다."
ui.version-check.migration.failed          = "마이그레이션 실패"
ui.version-check.migration.failed-file     = "실패한 파일: {file}"
ui.version-check.migration.failed-guide    = "서버 로그를 확인하고, 필요하면 운영 가이드의 복구 절차를 따르세요."
ui.version-check.migration.duration        = "{ms}ms 소요"
ui.version-check.local-changes.title       = "git 변경사항 감지"
ui.version-check.local-changes.body        = "working tree에 미커밋 변경이 있어 자동 업데이트를 진행할 수 없습니다…"
ui.version-check.local-changes.files-label = "변경 파일"
ui.version-check.local-changes.files-more  = "외 {n}건"
ui.version-check.shallow.warning           = "shallow clone 환경 — 자동 업데이트 실패 위험"
ui.version-check.shallow.body              = "이 설치본은 git shallow clone입니다. 자동 업데이트가 실패할 수 있으므로…"
ui.html.update-modal.migration-section-label = "스키마 마이그레이션"
ui.html.update-modal.migration-files-toggle  = "적용 파일 보기"
ui.html.update-modal.migration-files-collapse = "접기"
ui.html.update-modal.local-changes-cmd-label = "권장 명령"
ui.html.update-modal.local-changes-retry     = "정리 후 다시 시도"
ui.html.update-modal.copy                    = "복사"
ui.html.update-modal.copied                  = "복사됨"
ui.html.dashboard-warning.shallow-cmd-label  = "권장 명령"
ui.html.dashboard-warning.shallow-dismiss-aria = "경고 닫기"
```

**4언어 동치 정책**: 라벨 ≤ 8자, 툴팁 ≤ 40자, 모달은 액션 명령어 포함 (ADR-005 §카피 SSoT 3단계). auto-update-migration-hardening 라운드 신규 키 22종은 ko/en/ja/zh 완전 동치 — 권장 git 명령(`git status`, `git stash`, `git fetch --unshallow`)은 비번역 영역으로 분리.

---

## 디자인 토큰 (design-tokens.css)

| 토큰 | 값 | 용도 |
|---|---|---|
| `--color-warn` | `var(--warn)` (#F0B72F) | bloated-sys warn 단계 |
| `--color-danger` | `var(--error)` (#F47174) | bloated-sys critical 단계 |
| `--color-accent` | `var(--accent)` (#FF7A45) | agent-spike sparkline |
| `--color-warn-soft` | `rgba(240,183,47,0.18)` | warn fill (옅은 tint) |
| `--color-danger-soft` | `rgba(244,113,116,0.22)` | critical inset shadow |
| `--color-accent-soft` | `rgba(255,122,69,0.22)` | sparkline fill 영역 |

---

## 변경 이력

### 2026-05-18 — turn-header-prompt-prominence 라운드

- 영향 화면: `turn-view` (단일)
- 핵심 변경: 턴 카드 헤더를 **2-row 구조**로 재설계 — 사용자 프롬프트를 카드의 주제목(1급 요소)으로 승격해, 접힌 카드만 보고도 여러 턴의 prompt를 즉시 비교할 수 있게 한다.
- 신규/변경 컴포넌트 (`packages/web/assets/`):
  - `.turn-card-summary` 내부 2-row 분리 — Row 1 `.turn-card-header`(메타) + Row 2 `.turn-card-prompt-row`(prompt 1급)
  - `.turn-card-summary-actions` (신규) — payload + chevron 우측 정렬 묶음 단일 SSoT
  - `.turn-card-prompt-row` / `.turn-card-prompt-icon` / `.turn-card-prompt-text` (신규) — 12px 따옴표 SVG + 본문(text-body / text-1 / weight-medium / line-height 1.45 / 2줄 line-clamp / `user-select: text`)
  - `.turn-card-action-payload`에서 `margin-left: auto` 제거 (부모 wrapper로 책임 이동)
  - `.turn-card-preview` — deprecated 주석 처리 (외부 호환 보존, 이후 라운드에서 제거 예정)
- 스크롤바 SSoT 통일 — `#turnUnifiedBody`에 `scrollbar-width: thin` + `scrollbar-color: var(--border-strong) transparent` + WebKit 8px thumb (`--border-strong`, hover `--text-3`) / radius `--radius-sm` / transparent track. meta-docs / syslib / llm-input-system-content / meta-tool-stats와 동일 패턴.
- 신규 SVG 헬퍼: `design-system/icons/quote.js` — fill-only currentColor, viewBox 12x12, 채움형 따옴표 한 쌍 (svgDiamond 패밀리)
- 신규 i18n 키 2종 × 4언어 (ko/en/ja/zh 완전 동치): `session.session-detail.turn-views.prompt-row-aria`, `session.session-detail.turn-views.prompt-icon-aria`
- 코드 변경:
  - `assets/js/session-detail/turn-views.js` — `renderTurnCards` 카드 HTML 골격 2-row 재구성, prompt 60자 슬라이스 제거(line-clamp로 위임)
  - `assets/js/design-system/icons/quote.js` (신규 1파일)
  - `assets/css/turn-view.css` — 신규 4 클래스 + `#turnUnifiedBody` 스크롤바 토큰화 + `.turn-card-action-payload` margin 제거 + `.turn-card-preview` deprecated 주석
- 트레이드오프: 접힌 카드 높이 ~48px → ~70px → 한 화면 노출 턴 수 ~7 → ~5개 감소. 사용자의 명시적 우선순위(prompt 가독성)에 따른 수용 가능한 trade-off.
- ADR 참조: ADR-001(스크롤바 SSoT) · ADR-002(2-row 헤더 + prompt 1급 승격) · ADR-003(chevron 위치 유지 + user-select 허용) — `.claude/docs/plans/turn-header-prompt-prominence/adr.md`

### 2026-05-18 — auto-update-migration-hardening 라운드

- 신규 화면 영향: `update-modal`(확장 — 마이그레이션 결과 + local-changes 안내), `dashboard-shallow-warning`(신규)
- 신규 컴포넌트:
  - `.update-modal-migration` — 3분기 영역(`data-state="empty|success|failed"`) + 글리프(dot/✓/!) + 점멸 애니메이션(failed)
  - `.update-modal-migration-files` — 적용 파일 리스트 `<details>` 토글
  - `.update-modal-local-changes` — 409 응답 안내 패널 + dirty 파일 리스트(+N more 폴드)
  - `.update-modal-cmd-block` / `.dashboard-warning-cmd-row` — 명령 코드 블록 + 복사 버튼 (모달·dashboard 공용 SSoT)
  - `.dashboard-warning--shallow` — 우하단 비차단 warn 배너 + dismiss 버튼(localStorage 영속)
- 색은 기존 시맨틱 토큰만 사용: `--color-warn` / `--color-danger` / `--color-warn-soft` / `--color-danger-soft` / `--green`. 신규 hex/rgb 직접 추가 없음.
- 신규 함수 (`assets/js/version-check.js` 단일 진입점 SSoT):
  - `applyMigrationResult(ma)` / `applyMigrationFailure(info)` / `resetMigrationSection()` — T-08
  - `applyLocalChangesGuard(info)` / `resetLocalChangesPanel()` — T-09
  - `applyShallowWarning(isShallow)` — T-10
  - `bindCopyDelegation(rootEl)` — T-09 / T-10 공용 복사 위임
- 신규 i18n 키 22종: `ui.version-check.migration.*` / `ui.version-check.local-changes.*` / `ui.version-check.shallow.*` / `ui.html.update-modal.{migration-section-label, migration-files-toggle, ..., copy, copied}` / `ui.html.dashboard-warning.*` — 4언어(ko/en/ja/zh) 완전 동치 (namespace 중복 회귀 테스트 PASS)
- 신규 데이터 의존성(트랙 A): `POST /api/update` 응답 `migrationsApplied`, 409 `dirtyFiles`, `GET /api/version` 응답 `isShallowRepository`. 모두 옵셔널 — 트랙 A 미적용 환경에서도 회귀 없이 자연 동작.
- ADR 참조: ADR-004(/api/update contract) / ADR-005(/api/version contract) / ADR-007(local-changes & shallow UX) — `.claude/docs/plans/auto-update-migration-hardening/adr.md`

### 2026-05-18 — anomaly-bloated-sys 라운드

- 신규 화면 영향: `sidebar-session-list`, `session-header`, `request-row`, `context-chart`, `turn-view` (5개)
- 신규 컴포넌트:
  - `.badge-bloated-sys` (mini / full / dot 변형) — `▤` glyph 동결
  - `.turn-spike-summary` + sparkline (60×16)
  - `.row-flash` 1.5s ease 펄스 (anchor scroll 강조용)
- 신규 디자인 토큰: `--color-warn/danger/accent` + `*-soft` (semantic alias)
- 신규 헬퍼 (render/badges.js):
  - `bloatedSysBadgeMiniHtml` / `bloatedSysBadgeFullHtml` / `bloatedSysBadgeDotHtml`
  - `agentSpikeBadgeHtml` / `turnSpikeSummaryHtml`
- 신규 i18n 키: `ui.anomaly.*` + `ui.chart.footer.split` (4언어 동치)
- ADR 참조: ADR-001 ~ ADR-005 (.claude/docs/plans/anomaly-bloated-sys/adr.md)
