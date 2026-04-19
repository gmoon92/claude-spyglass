# Design Tokens — 공통 (Web + TUI)

> **ADR-003 SSoT** — Web과 TUI가 공유하는 단일 진실 공급원. 임의 수정 금지.

---

## 요청 타입 색상

| 타입 | 텍스트 | 배경 |
|------|--------|------|
| `prompt` | `#e8a07a` | `rgba(217,119,87,0.18)` |
| `tool_call` | `#6ee7a0` | `rgba(74,222,128,0.15)` |
| `system` | `#fbbf24` | `rgba(245,158,11,0.15)` |

Web에서는 CSS 변수로 사용:
```css
--type-prompt-color:    #e8a07a;
--type-tool_call-color: #6ee7a0;
--type-system-color:    #fbbf24;
```

TUI에서는 Ink `color` prop으로 동일 값 사용.

---

## 기본 색상 팔레트

| 역할 | 값 | 의미 |
|------|-----|------|
| `--accent` | `#d97757` | 핵심 강조, 선택 상태 |
| `--accent-dim` | `rgba(217,119,87,0.1)` | 선택 행 배경 |
| `--accent-bg-light` | `rgba(217,119,87,0.04)` | 일반 행 hover, 확장 패널 배경 |
| `--accent-bg-medium` | `rgba(217,119,87,0.07)` | clickable 행 hover |
| `--green` | `#4ade80` | 성공, 활성, 연결됨 |
| `--orange` | `#f59e0b` | 경고, 부분 완료 |
| `--red` | `#ef4444` | 에러, 실패 |
| `--blue` | `#60a5fa` | 정보 |
| `--blue-bg-light` | `rgba(96,165,250,0.18)` | role/cache 배지 배경 |
| `--red-bg-light` | `rgba(239,68,68,0.18)` | error 배지 배경 |

## Border Radius 토큰

| 토큰 | 값 | 용도 |
|------|-----|------|
| `--radius-sm` | `4px` | 소형 배지 (.type-badge, .mini-badge, .expand-copy-btn) |
| `--radius-md` | `6px` | 중형 컨테이너 (.cache-tooltip) |

---

## 타입 배지 약어

| 약어 | `type` 값 | 의미 |
|------|----------|------|
| `P` | `prompt` | 사용자 입력 |
| `T` | `tool_call` | 도구 호출 |
| `S` | `system` | 시스템 메시지 |

---

## 상태 표시 규칙

| 상태 | 색상 | 기호 |
|------|------|------|
| 활성/연결 | `--green` | `●` |
| 비활성/오프라인 | `--text-dim` | `○` |
| 에러 | `--red` | `✕` |
| 경고 | `--orange` | `!` |
