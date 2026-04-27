# chart-log-integration 디자인 아이디어 계획

> Feature: chart-log-integration
> 작성일: 2026-04-21
> 작성자: Claude Code

## 목표

RIGHT PANEL의 `chartSection`이 `content-switcher`(로그 피드 · 세션 상세)를 세로로 압박하는 구조적 문제를 해결한다.
로그 데이터 영역을 최대한 크게 확보하면서, 차트 정보(요청 추이 · 타입 도넛 · Cache Intelligence)에 대한 접근성을 유지하는 통합 인터랙션 방안 3개를 산출한다.

**이번 단계는 아이디어 산출에 한정한다. 코드·CSS·HTML 변경 없음.**

## 배경 및 현재 구조

```
RIGHT PANEL (flex-direction: column)
├── chartSection          ← 항상 상단 고정, flex-shrink: 0
│   ├── view-section-header (요청 추이 실시간 / 접기 버튼)
│   └── charts-inner (grid 2fr 1fr)
│       ├── chart-wrap: timelineChart (canvas height=100)
│       ├── donut-section: typeChart + typeLegend
│       └── cache-panel: Hit Rate / Cost / Creation·Read 비율
└── content-switcher      ← flex: 1, 나머지 공간 차지
    ├── defaultView: 최근 요청 피드 테이블 (10 컬럼)
    └── detailView: 세션 상세 (플랫/턴/간트/도구 탭)
```

현재 chartSection이 약 180–220px 고정 높이를 점유하여,
1280px 높이 화면 기준 content-switcher 가용 영역이 약 1060px으로 제한됨.
차트를 접으면(chart-collapsed) 로그 영역이 확장되지만, 토글 클릭이 번거롭고
차트 정보 접근이 완전히 차단되는 이분법적 UX가 문제.

## 범위

### 포함
- chartSection + content-switcher 통합 인터랙션 3가지 아이디어 제안 문서
- 각 안의 레이아웃 스케치(ASCII), 인터랙션 흐름, 기술 실현 방식, 장단점
- ADR 작성 (doc-adr): 3안의 트레이드오프 기록

### 제외
- 코드 구현 (HTML/CSS/JS 변경)
- doc-tasks 작성 (사용자가 안을 선택한 후 진행)
- DB 스키마 · 서버 API · 비즈니스 로직 변경

## 단계별 계획

### 1단계: 현황 분석 (완료)
- `packages/web/index.html:174–397` 구조 파악
- `packages/web/assets/css/default-view.css` chartSection 관련 CSS 분석
- 핵심 제약 조건 도출: flex 레이아웃, Chart.js canvas, CSS grid collapse 패턴

### 2단계: 3가지 아이디어 설계
각 안은 **서로 다른 인터랙션 철학**을 가진다.

| 라운드 | 인터랙션 철학 | 핵심 키워드 |
|--------|-------------|-----------|
| A안    | Ambient Intelligence — 로그 최우선, 차트는 배경 존재 | Focus/Peek, 미니맵, 스파크라인 |
| B안    | Spatial Layering — 차트가 공간을 공유하되 겹치지 않음 | 플로팅 오버레이, 드래그 가능 핸들 |
| C안    | Temporal Binding — 차트와 로그가 같은 시간축으로 묶임 | 타임라인 상단 바, 시간 연동 |

### 3단계: ADR 작성
- 3안의 트레이드오프, 구현 복잡도, 리스크를 기록
- 사용자가 선택할 수 있도록 비교 기준 명시

### 4단계: 사용자 선택 후 (이번 범위 밖)
- 선택된 안의 doc-tasks 작성
- ui-designer 스킬로 실제 구현

## 완료 기준

- [x] plan.md 작성
- [ ] adr.md 작성 (3안 비교 ADR)
- [ ] 최종 응답에 3라운드 제안 요약 비교표 포함
- [ ] 코드 변경 없음 확인
