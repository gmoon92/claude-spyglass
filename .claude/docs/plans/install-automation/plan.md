# Track 3 — 설치 자동화

## 목표

1. `scripts/install.sh` one-liner 설치 스크립트 (curl-pipe-bash)
2. `spyglass doctor` 검증 CLI — 환경·설정·DB 상태 점검

## 배경

`.claude/docs/evaluation/final-evaluation.md`의 P0 3번째(3.3 도입 장벽).

현재 설치: Bun 설치 → clone → install → `SPYGLASS_DIR` → `settings.json` 수동 편집(27개 훅) → 서버 실행 → Claude Code 재시작. 총 20~30분. 5% 전환율 추정.

## 작업 범위

### 1. `scripts/install.sh`

입력: `curl -fsSL https://raw.githubusercontent.com/gmoon92/claude-spyglass/main/scripts/install.sh | bash`

단계:
1. Bun 감지 → 없으면 `curl -fsSL https://bun.sh/install | bash` 자동 실행 (확인 프롬프트)
2. 저장소 clone (`$HOME/.spyglass-src` 또는 `$SPYGLASS_DIR`)
3. `bun install` 실행
4. `~/.claude/settings.json` 백업 (`settings.json.bak-$(date +%s)`)
5. 기존 `settings.json`에 hooks 블록 병합 (이미 있으면 건드리지 않고 경고)
6. `~/.spyglass/` 디렉토리 생성 + `chmod 700`
7. 완료 메시지 + 다음 단계 안내 (`bun run dev`, `spyglass doctor`)

UX 요구사항:
- dry-run 플래그 `--dry-run` — 변경 없이 계획만 출력
- 색상 출력 (`\033[0;32m` 등)
- 각 단계 성공/실패 명시
- `set -euo pipefail`로 안전하게

### 2. `spyglass doctor` CLI

위치: `packages/server/src/cli.ts` 또는 기존 CLI 엔트리포인트 확장.

체크 항목:
| 체크 | 통과 조건 |
|------|----------|
| Bun 버전 | `bun --version` ≥ 1.0 |
| `~/.claude/settings.json` 존재 | 파일 존재 및 JSON 파싱 성공 |
| 훅 등록 여부 | hooks 블록에 `spyglass-collect.sh` 경로 포함 |
| 훅 스크립트 실행 권한 | `stat`으로 execute bit 확인 |
| DB 파일 권한 | `0o600` 이상 (0o644 등은 경고) |
| DB 스키마 버전 | `PRAGMA user_version` ≥ 12 |
| 서버 포트 (3000) 가용성 | bind 시도 후 해제 |
| 최근 수집 활동 | 최근 5분 내 `requests` row 1건 이상 |

출력 형식:
```
✓ Bun 1.1.0
✓ settings.json 정상
✓ 훅 스크립트 실행 권한 OK
✗ DB 권한: 644 (권장 600)
  → 수정: chmod 600 ~/.spyglass/spyglass.db
⚠ 최근 수집 없음 (마지막 요청: 3시간 전)
  → 확인: bun run dev 실행 여부, settings.json 훅 경로
```

`--fix` 플래그로 자동 수정 가능한 항목(chmod 등)은 수정.

### 3. package.json 스크립트 추가

```json
{
  "scripts": {
    "doctor": "bun run packages/server/src/cli.ts doctor"
  }
}
```

또는 `bun link`로 `spyglass` 바이너리 노출 시 `spyglass doctor`로 직접 실행.

## 변경 파일

- `scripts/install.sh` (신규)
- `packages/server/src/cli.ts` (신규 또는 확장) — doctor 서브커맨드
- `package.json` — 스크립트 추가

## 검증

- `bash scripts/install.sh --dry-run` 결과 검토
- 깨끗한 macOS/Linux 환경에서 one-liner 설치 성공 확인
- `bun run doctor` 출력이 명확한지
- 설정 오류 상황(훅 누락, 포트 충돌 등) 재현 후 doctor가 정확히 진단하는지

## 주의사항

- `settings.json` 병합 시 기존 hooks 블록이 있으면 덮어쓰지 말고 경고 후 수동 안내
- Windows 대응은 제외 (WSL 가이드만 언급)
- `curl | bash` 패턴의 보안 리스크 명시 (README에 해시 검증 방법 안내)
