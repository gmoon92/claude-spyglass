---
name: spyglass 자동 설치
description: Claude Code에게 spyglass를 자동으로 설치하도록 지시하는 작업 프롬프트
type: tasks
---

다음 절차에 따라 spyglass를 설치해주세요.
설치 상세 절차는 `docs/install-guide.md`를 읽고 그대로 따릅니다.

## 사전 정보

- 저장소 위치: `<SPYGLASS_REPO_PATH>` (실제 절대 경로로 치환)
- 훅 프로파일: full (`docs/examples/settings.hooks.full.json`)

## 수행 순서

1. **의존성 확인** — Bun 1.2+, curl 설치 여부 확인 (`bun --version`, `curl --version`)
2. **의존성 설치** — `cd <SPYGLASS_REPO_PATH> && bun install`
3. **서버 기동** — `bun run dev`, 이후 `curl -sf http://127.0.0.1:9999/health` 로 헬스체크
4. **훅 설정** — `~/.claude/settings.json`의 `env` 및 `hooks` 키 병합
   - 기존 파일 백업 먼저 수행
   - `env.SPYGLASS_DIR` 을 저장소 절대 경로로 설정
   - 그 외 `SPYGLASS_HOST`, `SPYGLASS_PORT`, `SPYGLASS_TIMEOUT` 은 기본값이 있으므로 생략 가능
   - `hooks` 는 full 프로파일을 그대로 병합 (기존 키 보존)
5. **동작 확인** — `bun run doctor` 실행, 모든 단계 PASS 확인
6. **Claude Code 재시작 안내** — 훅 변경사항 반영을 위해 Claude Code 재시작 필요

## 주의사항

- `~/.claude/settings.json` 전체를 교체하지 말 것. 기존 `model`, `enabledPlugins`, `statusLine` 등은 유지.
- `SPYGLASS_DIR` 값은 절대 경로 (홈 디렉토리를 `~` 로 쓰지 말 것).
- 설치 완료 후 반드시 `bun run doctor` 로 5단계 점검 결과를 사용자에게 보고.
