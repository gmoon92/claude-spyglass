# tool-icon-agent-orange Tasks

> Feature: tool-icon-agent-orange
> 시작일: 2026-04-20
> 상태: 완료

## Tasks

- [x] badges.css: `.tool-icon-agent` 색상 변수 `var(--blue)` → `var(--orange)` 변경
- [x] badge-colors.md: 도구 아이콘 색상 테이블 파랑 → 오렌지 업데이트
- [x] badge-colors.md: 도구 유형별 색상 팔레트 Agent/Skill/Task 항목 오렌지로 업데이트
- [x] badge-colors.md: 판별 로직 주석 오렌지 반영
- [x] badge-colors.md: 설계 원칙 "파란색은 `--blue`" 항목 오렌지 반영 및 `--orange` 원칙 추가

## 완료 기준

- `.tool-icon-agent { color: var(--orange); }` 로 변경됨
- `badge-colors.md` 도구 아이콘 테이블, 팔레트, 주석, 원칙 모두 오렌지 기준으로 현행화
- `--blue` 토큰 사용 클래스(`.badge-cache`, `.role-user`, `.cache-tooltip-value.read`) 영향 없음
