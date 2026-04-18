# Log Message Column 추가 계획

> 작성일: 2026-04-18  
> Feature: log-message-col  
> 관련: log-table-ux (이전 ADR 참고)

---

## 작업 목표

현재 로그 테이블의 행위(Action) 컬럼과 입력(tokens_input) 컬럼 사이에
**"메시지"** 컬럼을 추가한다.

메시지 컬럼은 각 행위 유형이 **어떤 데이터로 수행됐는지**를 표시하여
관측(observability) 맥락을 제공한다.

---

## 현재 구조

### 컬럼 (현재)

| 시각 | 행위 | 입력 | 출력 | 응답시간 | 세션 |
|------|------|------|------|----------|------|

### 컬럼 (목표)

| 시각 | 행위 | **메시지** | 입력 | 출력 | 응답시간 | 세션 |
|------|------|-----------|------|------|----------|------|

---

## 타입별 표시 데이터

| 타입 | DB 필드 | 메시지 컬럼에 표시할 것 | 클릭 시 전체 노출 |
|------|--------|----------------------|----------------|
| `tool_call` | `tool_detail` (JSON/key=value) | 파싱된 인자 미리보기 (50자) | 전체 tool_detail raw |
| `prompt` | `preview`, `payload.prompt` | 프롬프트 텍스트 미리보기 (50자) | 전체 payload |
| `system` | `payload` (system context) | 시스템 컨텍스트 요약 (50자) | 전체 payload |

### 실제 데이터 예시

**tool_call - Skill 호출:**
- tool_name: `Skill`
- tool_detail: `git:commit` (호출 이름)
- 메시지 표시: `git:commit`
- 클릭 시: `git:commit` 전체

**tool_call - Bash 호출:**
- tool_name: `Bash`
- tool_detail: `{"command":"ls -la /path","description":"List files"}`
- 메시지 표시: `command: ls -la /path`
- 클릭 시: 전체 JSON

**prompt:**
- preview: `파일을 분석해주세요`
- 메시지 표시: `파일을 분석해주세요`
- 클릭 시: 전체 payload

**system:**
- payload: CLAUDE.md 내용 등
- 메시지 표시: 첫 줄 또는 50자
- 클릭 시: 전체 payload

---

## 클릭 확장 패턴

기존 `togglePromptExpand()` 패턴을 메시지 컬럼에도 적용:
- 메시지 셀 클릭 → 해당 행 아래에 확장 행 삽입
- 확장 행에는 전체 데이터를 `<pre>` 코드 블록 형태로 표시
- 재클릭 시 축소

---

## 기술 제약

- DB/API 변경 없음 (렌더링만 변경)
- 기술 스택: Vanilla JS + HTML (packages/web/index.html 단일 파일)
- 기존 `makeActionCell()`, `getContextText()`, `contextPreview()` 재활용
- 기존 `togglePromptExpand()` 확장 또는 신규 `toggleMessageExpand()` 도입
- 컬럼 추가로 `FLAT_VIEW_COLS`, `RECENT_REQ_COLS`, colspan 전수 갱신 필요

---

## 적용 범위

| 화면 | 변경 |
|------|------|
| 최근 요청 테이블 (`makeRequestRow`) | 메시지 컬럼 추가 |
| 플랫 뷰 (`renderDetailRequests`) | 메시지 컬럼 추가 |
| 턴 뷰 (`renderTurnView`) | tool-sub 재활용 또는 인라인 메시지 |
| 툴 통계 패널 (`renderTools`) | 변경 없음 (구조 다름) |
| 세션 브라우저 (`renderSessions`) | 변경 없음 |

---

## 핵심 설계 질문 (회의 주제)

1. **메시지 컬럼 너비**: 고정(예: 200px)? 가변(나머지 공간 분할)?
2. **행위 컬럼 vs 메시지 컬럼 공간 배분**: 행위는 좁게, 메시지가 더 넓게?
3. **미리보기 글자 수**: 50자? 80자? 컬럼 너비에 따라 유동?
4. **클릭 확장 대상**: 현재 action-preview의 contextPreview와 중복 제거 필요
5. **tool_detail 파싱**: JSON key=value 파싱 결과 표시 vs raw 표시
6. **턴 뷰**: 기존 tool-sub와의 관계 (중복? 교체?)
7. **메시지가 없는 경우**: `—` 표시? 셀 비움?
