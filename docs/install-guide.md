# spyglass 설치 가이드

Claude Code 실행 과정을 가시화하는 spyglass를 **Docker 이미지**로 배포·운영하는 방법과, 호스트의 Claude Code에서 훅을 연결하는 설정을 안내합니다.

> **배포 전제**: 본 프로젝트는 비공개(Private) 저장소입니다. Docker Hub 등 공용 레지스트리를 사용하지 않고 **tar.gz 이미지 파일**을 직접 공유·배포합니다.

---

## 목차

1. [구성 개요](#1-구성-개요)
2. [필수 조건](#2-필수-조건)
3. [Docker 이미지 사용법 (수신자)](#3-docker-이미지-사용법-수신자)
4. [Claude Code 훅 설정](#4-claude-code-훅-설정)
5. [동작 확인](#5-동작-확인)
6. [관리 명령어](#6-관리-명령어)
7. [이미지 빌드 (배포자)](#7-이미지-빌드-배포자)
8. [문제 해결](#8-문제-해결)

---

## 1. 구성 개요

spyglass는 **서버(Docker 컨테이너) + 훅(호스트 Bash)** 하이브리드 구조로 동작합니다.

```
┌──────────────────────── 호스트 ────────────────────────┐
│                                                        │
│   Claude Code (호스트에서 실행)                         │
│      │                                                 │
│      │  훅 이벤트 발생                                 │
│      ▼                                                 │
│   ~/.claude/settings.json                              │
│      │                                                 │
│      │  bash $SPYGLASS_DIR/hooks/spyglass-collect.sh   │
│      ▼                                                 │
│   훅 스크립트 (호스트 Bash)                            │
│      │                                                 │
│      │  HTTP POST http://localhost:9999/{collect,events}│
│      ▼                                                 │
│   ┌─────── Docker 컨테이너 ─────────┐                  │
│   │  spyglass 서버 (Bun)            │                  │
│   │  포트 9999 노출                 │                  │
│   │                                 │                  │
│   │  /data/.spyglass ◀──── 볼륨 마운트 ──┐           │
│   └─────────────────────────────────┘    │           │
│                                          │           │
│   ~/.spyglass/ (호스트 영구 보관) ───────┘           │
│     ├── spyglass.db                                    │
│     ├── pricing.json                                   │
│     ├── logs/                                          │
│     └── timing/                                        │
│                                                        │
└────────────────────────────────────────────────────────┘
```

**중요 원칙**

- **서버는 컨테이너**, **훅은 호스트**에서 실행됩니다. Claude Code가 호스트에서 동작하므로 훅도 호스트 Bash로 실행되어야 합니다.
- DB/로그/타이밍 파일은 볼륨 마운트(`~/.spyglass` ↔ `/data/.spyglass`)로 호스트에 영구 보관됩니다. 컨테이너를 삭제해도 데이터는 유지됩니다.
- 훅은 `localhost:9999`로 HTTP 호출만 수행하므로 컨테이너 네트워크 설정이 단순합니다.

---

## 2. 필수 조건

| 구성요소 | 버전 | 비고 |
|---------|------|-----|
| Docker Engine | 20.10 이상 | `docker version`으로 확인 |
| Docker Compose | v2 이상 (선택) | `docker compose version`. 없으면 `docker run`으로 대체 가능 |
| Claude Code | 최신 | 호스트에 설치되어 있어야 훅 호출 가능 |
| bash | 호스트 기본 | 훅 스크립트 실행용 |

이미지에는 Bun/TypeScript/SQLite 등 런타임이 포함되어 있어 **호스트에 별도 설치 불필요**합니다.

---

## 3. Docker 이미지 사용법 (수신자)

배포받은 파일:

- `spyglass-v<version>-<hash>.tar.gz` — Docker 이미지
- `spyglass-v<version>-<hash>.tar.gz.sha256` — 무결성 해시 (선택)
- `hooks/spyglass-collect.sh` — 호스트 훅 스크립트 (이미지와 별도로 제공)
- `docker-compose.yml` — 컨테이너 기동 설정 (선택)

### 3.1 무결성 검증 (권장)

```bash
# macOS
shasum -a 256 -c spyglass-v*.tar.gz.sha256

# Linux
sha256sum -c spyglass-v*.tar.gz.sha256
```

출력에 `OK`가 표시되어야 합니다.

### 3.2 이미지 로드

```bash
# 이미지 로드 (tar.gz 자동 해제)
docker load < spyglass-v0.1.0-abcdef0.tar.gz

# 로드 확인
docker images | grep spyglass
# spyglass   v0.1.0-abcdef0   ...   120MB
# spyglass   latest           ...   120MB
```

### 3.3 훅 스크립트 배치

호스트에서 사용할 훅 스크립트를 로컬 디렉토리에 배치합니다. 경로는 자유지만 권장 위치는 `~/spyglass-hooks/`입니다.

```bash
mkdir -p ~/spyglass-hooks/hooks
cp hooks/spyglass-collect.sh ~/spyglass-hooks/hooks/
chmod +x ~/spyglass-hooks/hooks/spyglass-collect.sh
```

이후 `~/.claude/settings.json`에서 이 경로를 `SPYGLASS_DIR`로 지정합니다 ([4장](#4-claude-code-훅-설정) 참고).

### 3.4 컨테이너 기동

**방법 A — `docker compose` (권장)**

동일 디렉토리에 있는 `docker-compose.yml`을 그대로 사용합니다.

```bash
# 백그라운드 기동
docker compose up -d

# 상태 확인
docker compose ps
# NAME        STATUS
# spyglass    Up (healthy)

# 로그 확인
docker compose logs -f spyglass
```

**방법 B — `docker run`**

Compose 없이 단독 실행:

```bash
docker run -d \
  --name spyglass \
  --restart unless-stopped \
  -p 9999:9999 \
  -v "${HOME}/.spyglass:/data/.spyglass" \
  spyglass:latest
```

### 3.5 헬스체크 확인

```bash
# 헬스체크 엔드포인트 응답 확인
curl -sf http://localhost:9999/health && echo "OK"

# Docker 헬스 상태
docker inspect --format='{{.State.Health.Status}}' spyglass
# healthy
```

### 3.6 대시보드 접속

```bash
open http://localhost:9999   # macOS
# 또는 브라우저에서 http://localhost:9999 직접 접속
```

---

## 4. Claude Code 훅 설정

spyglass는 Claude Code의 훅으로 데이터를 수집합니다. 훅 설정은 **반드시 글로벌 사용자 설정 파일 `~/.claude/settings.json`에 작성**해야 하며, 프로젝트 로컬 설정에는 적용하지 않습니다.

> **왜 `~/.claude/settings.json`(글로벌)인가?**
> - 프로젝트별로 훅을 중복 등록할 필요가 없습니다.
> - 모든 Claude Code 세션을 단일 spyglass 서버로 수집해 프로젝트별로 자동 분리됩니다(`project_name` = `basename $PWD`).
> - 프로젝트 로컬 설정(`.claude/settings.local.json`)에 훅을 두면 다른 레포에서는 수집되지 않아 데이터 공백이 생깁니다.

### 4.1 기존 설정 백업

```bash
cp ~/.claude/settings.json ~/.claude/settings.json.bak-$(date +%Y%m%d-%H%M%S)
```

### 4.2 설정 예제 파일

훅 JSON은 길어 관리 편의를 위해 예제 파일로 분리되어 있습니다. 아래 파일을 복사·붙여넣은 뒤 `SPYGLASS_DIR` 경로만 본인 환경에 맞게 수정하세요.

| 프로파일 | 수집 범위 | 파일 |
|---------|-----------|------|
| **최소(6개 훅)** | 토큰·세션·도구 사용량 | [examples/settings.hooks.minimal.json](./examples/settings.hooks.minimal.json) |
| **권장(27개 전체 HOOK_EVENTS)** ★ | Subagent·Task·Permission·Compact·Worktree 포함 전체 | [examples/settings.hooks.full.json](./examples/settings.hooks.full.json) |

빠른 적용(권장 27개):

```bash
# 1) 예제 파일 다운로드 또는 저장소에서 복사
cp <spyglass-repo>/docs/examples/settings.hooks.full.json /tmp/spyglass-hooks.json

# 2) SPYGLASS_DIR 경로 본인 환경에 맞게 수정
#    예: /Users/alice/spyglass-hooks

# 3) 기존 ~/.claude/settings.json의 env / hooks 키에 병합
#    (전체 교체 금지 — 다른 훅·플러그인 설정 보존)
```

`SPYGLASS_DIR`은 **훅 스크립트가 위치한 디렉토리의 절대 경로**입니다. 이 디렉토리 아래에 `hooks/spyglass-collect.sh`가 존재해야 합니다.

> **왜 `env`와 `hooks`만 병합하는가?**
> `~/.claude/settings.json`에는 `model`, `enabledPlugins`, `statusLine`, `autoMemoryEnabled` 등 Claude Code 전반의 설정이 함께 저장됩니다. 예제 파일을 그대로 덮어쓰면 기존 설정이 모두 사라지므로, `env`·`hooks` 두 키만 기존 파일에 추가/병합해야 합니다.

### 4.3 환경변수

| 변수 | 설명 | 기본값 |
|------|------|--------|
| `SPYGLASS_DIR` | 훅 스크립트가 위치한 디렉토리(절대경로) | **필수** |
| `SPYGLASS_HOST` | 서버 호스트 | `localhost` |
| `SPYGLASS_PORT` | 서버 포트 | `9999` |
| `SPYGLASS_PROJECT` | 프로젝트명 (수동 지정) | 현재 디렉토리명 |
| `SPYGLASS_TIMEOUT` | HTTP 요청 타임아웃(초) | `1` |

### 4.4 Claude Code 재시작

`settings.json`을 수정한 뒤 Claude Code를 **재시작**해야 훅이 로드됩니다.

### 4.5 주의사항

- Claude Code는 이벤트 키 수준의 `"*"` 와일드카드를 **지원하지 않습니다**. 27개 키를 **개별 등록**해야 전체 수집이 가능합니다.
- `matcher: "*"`는 `PreToolUse`/`PostToolUse`/`PostToolUseFailure`의 **도구 매칭 전용**입니다.
- `type: "command"` 필드가 없으면 Claude Code가 훅을 무시합니다.
- 기존 설정이 있다면 **반드시 백업한 뒤 병합**하세요. 통째로 교체하면 다른 훅·MCP 서버·권한 설정이 사라집니다.

---

## 5. 동작 확인

### 5.1 컨테이너 상태

```bash
docker compose ps
# NAME        STATUS
# spyglass    Up (healthy)

curl -sf http://localhost:9999/health && echo OK
```

### 5.2 훅 수집 로그

Claude Code 세션을 한 번 실행한 뒤:

```bash
# 훅 스크립트 로그
tail -f ~/.spyglass/logs/collect.log

# raw 이벤트(27개 훅 전체)
tail -f ~/.spyglass/logs/hook-raw.jsonl
```

### 5.3 이벤트 분포 확인

```bash
# 호스트에 sqlite3가 있으면
sqlite3 ~/.spyglass/spyglass.db \
  "SELECT event_type, COUNT(*) FROM claude_events GROUP BY event_type ORDER BY 2 DESC;"

# 없으면 컨테이너에서 실행
docker exec spyglass sh -c \
  "bun -e \"const db=new (require('bun:sqlite').Database)('/data/.spyglass/spyglass.db'); console.log(db.query('SELECT event_type, COUNT(*) as c FROM claude_events GROUP BY event_type ORDER BY c DESC').all())\""
```

### 5.4 대시보드

```
http://localhost:9999
```

최소 한 번의 Claude Code 세션이 수집되면 세션 목록·실시간 피드·Command Center Strip(COST/SAVED/P95/ERR)이 활성화됩니다.

---

## 6. 관리 명령어

| 작업 | 명령어 |
|------|--------|
| 기동 | `docker compose up -d` |
| 중지 | `docker compose stop` |
| 재시작 | `docker compose restart` |
| 로그 | `docker compose logs -f spyglass` |
| 컨테이너 삭제(데이터 보존) | `docker compose down` |
| **데이터 포함 완전 삭제** | `docker compose down && rm -rf ~/.spyglass` ⚠️ |
| 컨테이너 쉘 진입 | `docker exec -it spyglass sh` |
| 이미지 목록 | `docker images \| grep spyglass` |
| 구버전 이미지 제거 | `docker rmi spyglass:v0.0.x-xxxxxxx` |

### 6.1 DB 수동 접근

```bash
# 컨테이너 안에서
docker exec -it spyglass sh
# 컨테이너 내 쉘에서
bun -e "const {Database}=require('bun:sqlite'); const db=new Database('/data/.spyglass/spyglass.db'); console.log(db.query('SELECT COUNT(*) FROM requests').get())"
```

### 6.2 모델 가격 커스터마이징

Anthropic 가격 변경 시 재배포 없이 `~/.spyglass/pricing.json`을 편집하면 반영됩니다. 파일이 없으면 최초 기동 시 기본값이 자동 생성됩니다.

```json
[
  {
    "model": "claude-opus-4-7",
    "input": 15,
    "output": 75,
    "cacheCreate": 18.75,
    "cacheRead": 1.5
  }
]
```

단위는 **1M 토큰당 USD**입니다. 파일은 프로세스 시작 시 1회 로드되므로 수정 후 `docker compose restart`가 필요합니다.

---

## 7. 이미지 빌드 (배포자)

저장소 보유자만 해당됩니다. 배포 패키지를 생성하려면:

```bash
# 저장소 루트에서
bash scripts/build-image.sh
```

출력:

```
dist/spyglass-v<version>-<hash>.tar.gz        # Docker 이미지
dist/spyglass-v<version>-<hash>.tar.gz.sha256 # 무결성 해시
```

버전을 명시하려면:

```bash
bash scripts/build-image.sh 0.2.0
```

이 두 파일과 `hooks/spyglass-collect.sh`, `docker-compose.yml`을 함께 수신자에게 전달합니다.

---

## 8. 문제 해결

### 8.1 `curl http://localhost:9999/health`가 실패함

```bash
# 컨테이너 상태 확인
docker compose ps
docker compose logs spyglass --tail=50

# 포트 충돌 확인 (이미 9999를 쓰는 프로세스가 있는지)
lsof -iTCP:9999 -sTCP:LISTEN

# 필요 시 호스트 포트 변경 (docker-compose.yml)
#   ports:
#     - "19999:9999"
# 그리고 settings.json의 SPYGLASS_PORT=19999로 변경
```

### 8.2 Claude Code 세션을 실행해도 데이터가 수집되지 않음

체크리스트:

1. **훅 스크립트 경로**: `echo $SPYGLASS_DIR` → `~/.claude/settings.json`의 값과 일치하는가?
2. **실행 권한**: `ls -l $SPYGLASS_DIR/hooks/spyglass-collect.sh` → execute bit(`x`) 포함?
3. **Claude Code 재시작**: 설정 변경 후 반드시 재시작
4. **글로벌 설정에 있는가**: `~/.claude/settings.json` (프로젝트 로컬 아님)
5. **서버 접근 가능**: `curl -sf http://localhost:9999/health`
6. **훅 로그 확인**: `tail ~/.spyglass/logs/collect.log` — 오류 메시지가 있는지

### 8.3 `~/.spyglass` 볼륨에 권한 오류

컨테이너가 `/data/.spyglass`에 쓸 수 있어야 합니다. 첫 기동 시 다음을 확인:

```bash
# 호스트에서
ls -ld ~/.spyglass
# drwx------ ... 본인 소유

# 소유자가 다른 경우 (예: 과거 root로 생성됨)
sudo chown -R $(id -u):$(id -g) ~/.spyglass
chmod 700 ~/.spyglass
```

### 8.4 DB 스키마 마이그레이션

컨테이너 재시작만으로 마이그레이션이 자동 수행됩니다. 수동 확인:

```bash
docker exec spyglass sh -c \
  "bun -e \"console.log(new (require('bun:sqlite').Database)('/data/.spyglass/spyglass.db').query('PRAGMA user_version').get())\""
# { user_version: 12 }
```

### 8.5 완전 초기화

```bash
docker compose down
rm -rf ~/.spyglass
docker compose up -d
```

---

## 참고

- [README.md](../README.md) — 프로젝트 개요와 기능 설명
- [architecture.md](./architecture.md) — 아키텍처 상세
- [planning/](./planning/) — 개발 계획, PRD, ADR, 스펙
