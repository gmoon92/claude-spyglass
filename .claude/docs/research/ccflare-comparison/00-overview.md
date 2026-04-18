# ccflare vs claude-spyglass 비교 연구 개요

> **작성일:** 2026-04-18  
> **목적:** ccflare 프로젝트를 참고하여 개발된 claude-spyglass의 현재 기능을 재점검하고, 고도화 방향을 도출한다.  
> **분석 라운드:** 3라운드 (검토 → 문서 보완 → 최종 검토)

---

## 프로젝트 관계도

```
ccflare (원본 참고 프로젝트)
  └─ Claude API 프록시 서버
  └─ 목적: API 트래픽 중간 차단 및 분석

claude-spyglass (현재 프로젝트)
  └─ Claude Code CLI 모니터링 도구
  └─ 목적: 개발자가 Claude Code 사용 중 발생하는 내부 이벤트 추적
  └─ ccflare의 데이터 모델/UI 패턴을 참고하여 훅 기반으로 재구현
```

---

## 핵심 차이점 요약

| 구분 | ccflare | claude-spyglass |
|------|---------|-----------------|
| **수집 방식** | API 프록시 (중간 차단) | Claude Code 훅 이벤트 구독 |
| **포트** | 8080 | 9999 |
| **아키텍처** | Monorepo + DI + Worker Thread | 단순 패키지 구조 + Bun |
| **UI 기술** | React + 컴포넌트 | 바닐라 JS + 단일 HTML |
| **데이터 보존** | payload 7일 / 메타 365일 (설정 가능) | **미구현** (DB 무한 증가) |
| **비용 계산** | 있음 (models.dev API) | **없음** |
| **output_tokens** | Provider 최종값 + tiktoken 추정 | **항상 0** (`CLAUDE_API_USAGE_*` env 미존재) |
| **cache_tokens** | Provider 값 | **항상 0** (동일 이유) |
| **토큰 수집 방식** | API 스트리밍 직접 파싱 | transcript_path JSONL 파싱 필요 |
| **멀티 계정** | 있음 (로드밸런싱) | 없음 (단일 사용자) |
| **세션 개념** | HTTP 요청 단위 | Claude Code 실행 세션 단위 |
| **Turn 추적** | 없음 | **있음** (spyglass 독창 기능) |
| **프로젝트 분류** | 없음 | **있음** (project_name 기반) |
| **도구 통계** | 없음 | **있음** (tool_name, call_count) |

---

## 전문가별 분석 문서

| 문서 | 담당 관점 | 핵심 질문 |
|------|----------|-----------|
| [01-system-architecture.md](01-system-architecture.md) | 시스템 아키텍처 | 수집 신뢰성, 확장성, 유지보수성 |
| [02-data-analysis.md](02-data-analysis.md) | 데이터 | 스키마 완성도, 삭제 정책, 갭 항목 |
| [03-ux-analysis.md](03-ux-analysis.md) | UI/UX | 표시 항목, 시각화, 인터랙션 개선 |

---

## 3라운드 요약

### Round 1: 현황 분석
- ccflare 대비 spyglass의 구현 현황 파악
- 각 관점에서 현재 동작하는 기능 목록화

### Round 2: 갭 분석 및 보완
- ccflare 대비 누락된 기능 식별
- spyglass 독자 강점 인정 및 보강
- `output_tokens` 미수집 문제 근본 원인 규명

### Round 3: 고도화 제안
- 우선순위별 개선 로드맵 제시
- 구현 복잡도 vs 사용자 가치 매트릭스

---

## 고도화 우선순위 요약

| 우선순위 | 항목 | 예상 효과 |
|---------|------|---------|
| **P0** | transcript 파싱으로 토큰 수집 전면 교체 | output/cache 토큰 모두 정상화, ⚡ 배지 표시 |
| **P0** | 데이터 삭제 정책 구현 | DB 무한 증가 방지 |
| **P1** | 비용 계산 추가 | 토큰 소비량의 경제적 가치 파악 |
| **P1** | 요청 성공/실패 상태 | 오류 추적 가능 |
| **P2** | 페이로드 상세 모달 | 대화 내용 전체 확인 |
| **P2** | 토큰/초 속도 표시 | 모델 성능 비교 |
| **P3** | TUI 완성도 향상 | 터미널 사용자 경험 |
| **P3** | 주간/월간 리포트 | 장기 사용 패턴 분석 |
