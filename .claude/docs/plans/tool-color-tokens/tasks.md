# tool-color-tokens Tasks

> Feature: tool-color-tokens
> 시작일: 2026-04-20
> 상태: 완료

## Tasks

- [x] badge-colors.md 현행화 — --tool-* 토큰 섹션 신설, 기존 "도구 유형별 색상 팔레트" 섹션 교체
- [x] design-tokens.css에 --tool-* 7개 토큰 추가 (--purple 주석 현행화 포함)
- [x] turn-gantt.js: initToolColors() 함수 신설, TOOL_COLORS 런타임 읽기로 교체, export 추가
- [x] turn-gantt.js:330 anomaly 마커 하드코딩 #f59e0b → TOOL_COLORS.Agent 사용
- [x] session-detail.js: TOOL_COLORS import 추가, chipColors 인라인 객체 제거 후 TOOL_COLORS 참조로 교체

## 완료 기준

- [x] design-tokens.css에 --tool-* 7개 토큰 존재
- [x] turn-gantt.js TOOL_COLORS에 하드코딩 16진수 없음 (fallback 제외)
- [x] session-detail.js chipColors 인라인 객체 없음
- [x] turn-gantt.js:330 #f59e0b 하드코딩 없음
- [x] badge-colors.md --tool-* 섹션 존재
