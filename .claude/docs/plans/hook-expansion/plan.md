# spyglass 훅 이벤트 확장 계획

## 개요

spyglass는 현재 UserPromptSubmit과 PostToolUse 두 가지 훅 이벤트만 수집하고 있습니다. 디버깅/관제 도구로서의 완전성을 확보하기 위해 6+개 이벤트로 확장이 필요합니다.

## 현재 상태

### 수집 중인 이벤트 (2개)
- UserPromptSubmit: 사용자 입력
- PostToolUse: 도구 실행 결과

### 놓치고 있는 핵심 이벤트 (예시)
- PreToolUse: 도구 선택 "의도" (실행 전)
- SessionStart/End: 세션 생명주기
- Stop/StopFailure: 응답 완료 및 최종 토큰
- PermissionRequest/Denied: 사용자 개입 시점
- PostToolUseFailure: 에러 원인

## 목표

> 업데이트 (adr-v2.md 기준): 6개 개별 이벤트 대신 **와일드카드(*) 방식으로 25개 이상의 모든 이벤트** 수집

1. 스키마 확장: `claude_events` 테이블 신규 추가 (기존 requests/sessions 테이블 유지)
2. 수집 스크립트 교체: 와일드카드 단일 스크립트로 모든 이벤트 수신 후 분기 처리
3. 서버 API: `/events` 엔드포인트 신규 추가
4. 훅 설정 가이드 업데이트

## 기술 스택

- Bun / TypeScript
- SQLite (WAL mode)
- Bash (hook scripts)

## 제약사항

- async 수집 (Claude 흐름 블로킹 없음)
- timeout 1초 이하
- 기존 데이터 마이그레이션 필요
