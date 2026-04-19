# turn-card-agent-name Tasks

> Feature: turn-card-agent-name
> 시작일: 2026-04-20
> 상태: 완료

## Tasks

- [x] T1. `turn-view.css` — `.agent-chip` 클래스 추가 (`.tool-chip` 기반 확장, inline-flex, gap)
- [x] T2. `turn-view.css` — `.agent-chip .tool-icon` font-size inherit 재정의
- [x] T3. `turn-view.css` — `.agent-chip-name` max-width:10ch + ellipsis + nowrap
- [x] T4. `turn-view.css` — `.agent-chip` background CSS 변수 적용 (--tool-agent-bg)
- [x] T5. `session-detail.js` — `compressed` 배열 구조 확장: `{ key, name, count, isAgent, agentName }`
- [x] T6. `session-detail.js` — 압축 키를 `name + '|' + (agentName||'')` 복합 키로 변경
- [x] T7. `session-detail.js` — Agent/Skill 칩 렌더: `.agent-chip` + `toolIconHtml()` + `.agent-chip-name` span
- [x] T8. `session-detail.js` — `toolIconHtml` import 추가
- [x] T9. 검증 — Agent/Skill 칩에 서브에이전트명 표기 확인
- [x] T10. 검증 — 긴 이름(10ch 초과) ellipsis 처리 확인
- [x] T11. 검증 — 일반 도구 칩(Bash/Read 등) 레이아웃 변화 없음 확인
- [x] T12. 검증 — CSS 하드코딩 색상 없음 확인
- [x] T13. 검증 — `toolIconHtml()` 재사용 원칙 준수 확인

## 완료 기준

- [x] Agent/Skill 칩에 서브에이전트명 표기 (예: `◎ designer`, `◎ general-pur…`)
- [x] 이름 10ch 초과 시 ellipsis 처리, 개행 없음
- [x] 일반 도구 칩 레이아웃 변화 없음
- [x] CSS 변수만 사용 (하드코딩 색상 없음)
- [x] `toolIconHtml()` 재사용 원칙 준수
