# 웹 대시보드 Formatter 모듈화 및 UI/UX 개선

## 1. 개요

### 1.1 배경
TUI(tui-badge-prompt-content)에서 완료된 formatter 모듈화 작업을 웹 대시보드에 적용합니다.
현재 웹 대시보드는 단일 `index.html` 파일(~1670줄)로 모든 CSS, JavaScript, HTML이 인라인으로 존재합니다.

TUI에서는 4개 컴포넌트의 중복 로직을 `RequestTypeFormatter`, `TokenFormatter`, `TimeFormatter` 클래스로 통합했습니다.
웹 대시보드는 중복 구조는 없지만 모듈화 자체가 없어 유지보수성이 낮습니다.

### 1.2 현재 상태 분석
```
packages/web/
├── index.html         # 모든 코드가 하나의 파일 (~1670줄)
│   ├── <style>        # 450줄의 인라인 CSS
│   └── <script>       # 1100줄의 인라인 JavaScript
│       ├── formatters: fmt(), fmtToken(), fmtTime(), fmtDate(), formatDuration()
│       ├── badge:      typeBadge(), TYPE_COLORS
│       ├── chart:      drawTimeline(), drawDonut()
│       ├── renderer:   makeRequestRow(), renderDetailRequests(), renderTurnView()
│       └── fetch:      fetchDashboard(), fetchRequests(), fetchAllSessions()
├── favicon.svg
└── parseToolDetail.test.ts  # 단독 단위 테스트 (Bun)
```

### 1.3 TUI와 웹의 차이점
| 항목 | TUI | Web |
|------|-----|-----|
| 기술 스택 | TypeScript + React (Ink) | Vanilla JS + HTML (단일 파일) |
| 모듈 시스템 | ES Modules | 없음 |
| 중복 | 4개 파일에 동일 로직 | 1개 파일, 중복 없음 |
| 타입 뱃지 | RequestTypeFormatter.getColor() | typeBadge() + CSS class |
| 토큰 포맷 | TokenFormatter.format() | fmtToken() 인라인 |
| 시간 포맷 | TimeFormatter.formatTime() | fmtTime(), fmtDate() 인라인 |
| 프롬프트 미리보기 | preview 필드 (DB에서) | payload JSON 파싱 |

### 1.4 목표
1. 웹 대시보드를 모듈화된 구조로 전환
2. TUI formatter와 일관된 타입 뱃지/색상 시스템 구현
3. `preview` 필드를 직접 활용 (payload 파싱 대신)
4. 웹 환경에 맞는 UI/UX 개선 (터미널 제약 없음)

## 2. 기술 현황

### 2.1 이미 구현된 기능
- 타입 뱃지 표시 (CSS class: `.type-prompt`, `.type-tool_call`, `.type-system`)
- 토큰/시간 포맷팅 함수들
- 프롬프트 preview (payload JSON 파싱으로 구현)
- 턴 뷰 (아코디언), 캐시 배지, 모델 배지
- SSE 실시간 업데이트

### 2.2 부재한 기능
- 모듈 시스템 (import/export)
- TUI formatter 클래스와의 공유 또는 동기화
- `preview` DB 필드 직접 사용
- 컴포넌트 단위 테스트
- 빌드 시스템 (타입 검사, 번들링)

## 3. 요구사항

### 3.1 필수 (P0)
| ID | 요구사항 |
|----|---------|
| R1 | 타입 뱃지/색상 로직이 TUI와 동일한 설계 원칙을 따를 것 |
| R2 | preview 필드를 DB에서 직접 사용 (payload 파싱 보조 폴백 유지) |
| R3 | 모듈화 구조로 전환 (유지보수 가능한 파일 분리) |

### 3.2 권장 (P1)
| ID | 요구사항 |
|----|---------|
| R4 | 웹 환경 특화 UI/UX 개선 (호버, 툴팁, 애니메이션) |
| R5 | 빌드 시스템 도입 (Vite 등) |
| R6 | formatter 단위 테스트 |

## 4. 제약사항
- 현재 동작 중인 대시보드의 기능 회귀 없을 것
- 서버 API 변경 최소화
- Java 개발자 친화적인 구조 유지 (클래스 기반)
- 기존 디자인 시스템(색상, 폰트) 유지

## 5. 참고 자료
- packages/web/index.html (현재 구현)
- packages/tui/src/formatters/ (TUI formatter 클래스)
- packages/storage/src/schema.ts (preview 필드 포함 Request 타입)
- .claude/docs/plans/tui-badge-prompt-content/adr.md (TUI ADR)
