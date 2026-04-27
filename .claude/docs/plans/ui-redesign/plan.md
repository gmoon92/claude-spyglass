# ui-redesign 개발 계획

> Feature: ui-redesign
> 작성일: 2026-04-23
> 작성자: Claude Code (designer 에이전트)

## 배경

실제 디자이너 피드백:
- "조금 숨막힌다" — 화면이 빽빽함
- "어떤 걸 봐야할지 모르겠다" — 시선 진입점 부재
- **"그룹핑 된 덩어리가 없어서 더 그런 것 같다"** ← 핵심 지적
- "AI가 만든 것 같다" — 정보 아키텍처/시각 위계 부재

지금까지 컴포넌트 단위 폴리싱(배지 색, 정렬, 토글 위치)에만 집중했고 **전체 정보 아키텍처를 다시 본 적이 없다**.
이번 라운드는 정보 아키텍처를 처음부터 다시 본다. Phase 1은 디자인을 바꾸기 전에 **현재 화면이 무엇을 하고 있는지** 빠짐없이 정리하는 작업이다.

## 목표

claude-spyglass UI(Web 대시보드 + TUI)를 **시각 위계와 그룹핑** 관점에서 재설계하기 위한 사전 작업.
이번 PR(Phase 1)에서는 디자인을 바꾸지 않고 **현행 기능 인벤토리만** 만든다. 디자인 재설계(Phase 2)는 사용자 합의 후 별도 라운드로 진행.

## 절대 제약 (위반 금지)

1. **UI만 변경한다.** 백엔드 로직, DB 스키마, SQL 쿼리, 서버 이벤트 구조는 동결.
2. **기존 기능을 100% 유지한다.** 누락 절대 금지.
3. 디자인 재설계 과정에서 백엔드/DB 변경이 필요해 보이면 `feedback.md`에 "허락 요청 항목"으로만 기록한다. 사용자가 별도 검토 후 허락한다.
4. 디자인 산출물은 메인이 아니라 **반드시 ui-designer 스킬을 통해** 작성.

## 범위

### 포함 (Phase 1)
- Web 대시보드 화면 전체 (`packages/web/`)
- TUI 화면 전체 (`packages/tui/`)
- 모든 컴포넌트의 기능·인터랙션·상태 전이·키보드/마우스 이벤트·에러 케이스 인벤토리화

### 포함 (Phase 2 — 사용자 합의 후)
- 정보 아키텍처 재설계 (그룹핑·시각 위계)
- 디자인 토큰 전면 재검토
- ui-designer 스킬을 통한 doc-planning/doc-adr/doc-tasks 작성 후 구현

### 제외
- 백엔드/DB/SQL/서버 로직 변경
- 새로운 기능 추가 (재설계 과정에서 발견된 누락은 feedback.md로 기록만)
- 데이터 모델 변경

## 단계별 계획

### Phase 1 — 현행 기능 인벤토리 (이번 PR)

#### Step 1.1 — 큰 덩어리 컴포넌트 분류
화면 전체를 굵직한 덩어리 단위로 분류. 디자이너가 "한 덩어리"로 다룰 수 있는 단위로 묶는다.
- 산출물: `phase-1-inventory/components.md`

#### Step 1.2 — 컴포넌트별 5라운드 인벤토리
각 컴포넌트마다 별도 문서를 만들고 5라운드를 누적적으로 진행.
- R1 (작성): 컴포넌트가 제공하는 모든 기능 1차 작성
- R2 (검토): R1을 비판적으로 검토 — 누락 기능, 모호 표현, 빠진 인터랙션
- R3 (추가): R2 검토 반영 + 신규 기능 추가
- R4 (검토): R3을 다시 검토 — 미세 인터랙션, 키보드/마우스, 에러/엣지 케이스, 상태 전이
- R5 (추가): R4 검토 반영 + 최종 추가

각 라운드 흔적을 문서 안에 명시 섹션으로 남김. 산출물: `phase-1-inventory/round-5/<component>.md`

#### Step 1.3 — 통합 3라운드 정리
컴포넌트별 5라운드 결과를 모아 전체 통합 인벤토리.
- 정리 R1 (1차 통합): 모든 컴포넌트 인벤토리를 하나로 합치고 일관된 형식으로 정리
- 정리 R2 (누락/중복 점검): 컴포넌트 간 경계가 모호한 기능, 누락된 cross-cutting(필터·검색·단축키·알림 등) 점검
- 정리 R3 (최종 정리): Phase 2 디자인 재설계의 입력으로 사용 가능한 수준의 완성도

산출물: `phase-1-inventory/inventory.md`

### Phase 2 — 디자인 재설계 (별도 라운드, 사용자 합의 후)

ui-designer 스킬을 통해 doc-planning → doc-adr → doc-tasks → 구현 순서로 진행.
이번 PR에서는 진행하지 않는다.

## 산출물 디렉토리 구조

```
.claude/docs/plans/ui-redesign/
├── plan.md                           ← 이 문서
├── phase-1-inventory/
│   ├── components.md                 ← Step 1.1
│   ├── round-5/                      ← Step 1.2 (컴포넌트별 5라운드)
│   │   ├── web-shell.md
│   │   ├── web-left-panel.md
│   │   ├── web-chart-strip.md
│   │   ├── web-default-view.md
│   │   ├── web-detail-shell.md
│   │   ├── web-detail-flat.md
│   │   ├── web-detail-turn.md
│   │   ├── web-detail-gantt.md
│   │   ├── web-detail-tools.md
│   │   ├── web-cross-cutting.md
│   │   ├── tui-shell.md
│   │   ├── tui-live.md
│   │   ├── tui-history.md
│   │   ├── tui-analysis.md
│   │   └── tui-settings.md
│   └── inventory.md                  ← Step 1.3 (최종 통합)
└── feedback.md                       ← 백엔드/DB 변경 허락 요청 (필요 시)
```

파일/디렉토리명은 모두 kebab-case.

## 완료 기준

- [ ] `phase-1-inventory/components.md` 작성 완료
- [ ] `phase-1-inventory/round-5/` 안에 컴포넌트별 5라운드 문서 모두 작성 완료 (각 문서에 R1~R5 섹션 존재)
- [ ] `phase-1-inventory/inventory.md` 작성 완료 (정리 R1~R3 섹션 존재)
- [ ] 백엔드/DB 변경 요청이 발견된 경우 `feedback.md` 작성
- [ ] `screen-inventory.md` (ui-designer 레퍼런스)와 충돌하지 않음
- [ ] 사용자 보고용 요약 메시지: 분류된 컴포넌트 목록, 컴포넌트별 최종 기능 개수, 발견된 누락/모호 지점, 백엔드 변경 요청 여부, 산출물 경로

## 참고 자료

- `.claude/skills/ui-designer/references/web/screen-inventory.md` — 기존 웹 화면 인벤토리
- `.claude/skills/ui-designer/references/web/badge-colors.md` — 배지 색 정책
- `.claude/skills/ui-designer/references/web/design-system.md` — 현재 디자인 시스템
- `packages/web/index.html` (330줄) + `packages/web/assets/css/*` (15개 CSS) + `packages/web/assets/js/*` (20개 JS)
- `packages/tui/src/{app.tsx, components/, hooks/, formatters/}`
- `packages/server/src/events.ts` — 이벤트 구조 (변경 금지, 식별 참고용)
