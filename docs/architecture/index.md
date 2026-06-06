# claude-spyglass 아키텍처 문서

> Claude Code 실행을 들여다보는 로컬 망원경의 현행 시스템 설계 문서.

---

## 문서 기준

| 항목 | 값 |
|------|-----|
| 시각 | 2026-06-06 16:44:03 KST |
| 커밋 | `4ea9686` |
| 태그 | `v4.4.0` |
| 마이그레이션 | `057-preview-encryption.sql` (`PRAGMA user_version = 57`) |

---

## 문서 네비게이션

### 전체 그림
- [개요 및 시스템 다이어그램](./overview.md) — 목적, 핵심 가치, 아키텍처 한눈에 보기
- [데이터 흐름](./data-flow.md) — Hook/Proxy → 저장 → SSE → 클라이언트까지의 end-to-end 흐름
- [패키지 구조](./packages.md) — 9개 워크스페이스 의존 그래프와 책임

### 계층별 상세
- [서버(Server)](./server.md) — HTTP 서버, Hook 수집, Proxy 미러링, SSE, 라우터
- [스토리지(Storage)](./storage.md) — SQLite 스키마, 마이그레이션, 사전 집계, Retention, At-Rest 암호화
- [웹 대시보드(Web)](./web.md) — React 18 + Vite SPA, 실시간 피드, 차트, 메타 문서 Flow
- [터미널 UI(TUI)](./tui.md) — Ink 기반 CLI 대시보드
- [그래프(Graph)](./graph.md) — Ladybug 그래프 DB 동기화, 통합 Flow

### 인터페이스 및 운영
- [API & SSE Contract](./api.md) — HTTP 엔드포인트, SSE 페이로드, Hook 입력 명세
- [운영(Operations)](./operations.md) — 환경 변수, 빌드, 배포, 유지보수, 문제 해결

### 스키마 상세
- [`schema/`](./schema/) — 테이블별 전체 컬럼 명세
  - [sessions](./schema/sessions.md) · [requests](./schema/requests.md) · [claude-events](./schema/claude-events.md)
  - [proxy-requests](./schema/proxy-requests.md) · [system-prompts](./schema/system-prompts.md)
  - [meta-documents](./schema/meta-documents.md) · [model-limits](./schema/model-limits.md)

---

> 모든 문서는 현재 소스 트리 기준으로 기술하며, 과거 변경 이력(예: 프레임워크 전환)은 기술하지 않습니다.
