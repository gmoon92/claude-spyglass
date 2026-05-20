# claude-spyglass 배포 가이드

`claude-spyglass`는 본질적으로 **개인 PC에서 Claude Code와 함께 돌리는 로컬 관측 도구**입니다.
하지만 공용 데스크톱·홈서버·팀 공용 분석기 같은 운영 환경에서는 데몬으로 상주시키거나 Docker 컨테이너로 격리하고 싶은 경우가 있습니다.
이 문서는 그런 모든 배포 시나리오를 다룹니다.

> **이 문서를 읽어야 할까?**
> - 단일 사용자 워크스테이션이라면 → [`install-guide.md`](./install-guide.md) 한 페이지로 충분합니다.
> - **데몬화 · Docker · 백업 · 업그레이드 · 헬스 모니터링**이 필요하다면 → 이 문서를 계속 읽으세요.

---

## 목차

1. [배포 시나리오 개요](#1-배포-시나리오-개요)
2. [시스템 요구사항](#2-시스템-요구사항)
3. [로컬 설치 (포어그라운드)](#3-로컬-설치-포어그라운드)
4. [데몬화 (백그라운드 상주)](#4-데몬화-백그라운드-상주)
5. [Docker 배포](#5-docker-배포)
6. [데이터 볼륨과 백업](#6-데이터-볼륨과-백업)
7. [포트 · 네트워크 · 보안](#7-포트--네트워크--보안)
8. [환경변수 레퍼런스](#8-환경변수-레퍼런스)
9. [업그레이드와 마이그레이션](#9-업그레이드와-마이그레이션)
10. [헬스체크와 모니터링](#10-헬스체크와-모니터링)
11. [트러블슈팅](#11-트러블슈팅)

---

## 1. 배포 시나리오 개요

| 시나리오 | 언제 쓰나 | 기동 명령 | 부팅 시 자동 재시작 |
|---------|----------|----------|------------------|
| **① 로컬 포어그라운드** | 개발 중, 짧은 테스트 | `bun run dev` | 없음 (셸 종료해도 살아있긴 함) |
| **② 데몬 (launchd / systemd / PM2)** | 부팅 시 자동 기동, 장시간 상주 | OS 서비스 등록 | 있음 |
| **③ Docker 컨테이너** | 시스템 격리, 호스트에 Bun 설치 불가, 팀 공용 머신 | `docker compose up -d` | `restart: unless-stopped` |
| **④ tarball 배포** | 폐쇄망·오프라인 환경 | `docker load` → `docker run` | `--restart` 옵션 |

> **공통 데이터 경로**: 네 시나리오 모두 **`~/.spyglass/`** 를 사용하므로 운영 중 시나리오 전환이 가능합니다.
> **주의**: 두 서버가 동시에 같은 SQLite 파일을 쓰지 마세요.

```
┌──────────────────────────── 호스트 ─────────────────────────────┐
│                                                                 │
│  ┌─[로컬]──────────────┐    ┌─[Docker]─────────────────────┐   │
│  │  Claude Code         │    │  spyglass 컨테이너            │   │
│  │   │                  │    │   ├─ Bun 1.2 + 서버           │   │
│  │   ├─ 훅 HTTP →───────┼────┼───→ :9999                    │   │
│  │   └─ /v1 프록시 →────┼────┼───→ /v1/*                    │   │
│  │                      │    │                              │   │
│  │  bun run dev (Daemon)│    │  HEALTHCHECK /health          │   │
│  │  PID: ~/.spyglass/   │    │  VOLUME /data/.spyglass       │   │
│  │       server.pid     │    └───────────────┬───────────────┘   │
│  └──────────┬───────────┘                    │                   │
│             │                                ▼                   │
│             └─────────→  ${HOME}/.spyglass/  (DB·로그·PID)        │
│                                                                  │
└──────────────────────────────────────────────────────────────────┘
```

---

## 2. 시스템 요구사항

### 2.1 공통

| 항목 | 최소 | 권장 |
|------|------|------|
| **Bun** | 1.2.0 (`package.json` `engines.bun: ">=1.2.0"`) | 1.2.x 최신 |
| **메모리** | 256MB | 512MB+ (대시보드·차트 동시 사용 시) |
| **디스크** | 200MB (앱) + DB | 1GB (DB는 사용량에 따라 수십~수백 MB까지 증가) |
| **OS** | macOS 12+, Linux x86_64/arm64, Windows (WSL2) | macOS / Linux |
| **네트워크** | loopback 9999 사용 가능 | — |

> Bun이 SQLite를 내장하므로 별도 DB 서버는 필요하지 않습니다.

### 2.2 Docker 배포 시 추가 요구

| 항목 | 최소 |
|------|------|
| **Docker Engine** | 20.10+ (BuildKit 사용 — `Dockerfile`의 `# syntax=docker/dockerfile:1.6` 지시어 때문) |
| **Docker Compose** | v2 (v1 형식인 `docker-compose.yml`도 호환) |
| **이미지 베이스** | `oven/bun:1.2-alpine` (멀티스테이지 빌드) |

### 2.3 의존성 확인

```bash
bun --version       # >= 1.2.0
docker --version    # 컨테이너 배포 시
docker compose version
```

---

## 3. 로컬 설치 (포어그라운드)

개인 PC에서 Claude Code와 함께 돌리는 가장 단순한 시나리오입니다.

### 3.1 요구사항

- Bun 1.2.0+
- 9999 포트 사용 가능
- `~/.spyglass-src` 경로에 쓰기 권한

### 3.2 설치 단계

```bash
# 1) 클론 — 권장 경로 ~/.spyglass-src (훅 설정과 호환)
git clone https://github.com/gmoon92/claude-spyglass.git "${HOME}/.spyglass-src"
cd "${HOME}/.spyglass-src"

# 2) 의존성 설치 (워크스페이스 packages/* 전체)
bun install

# 3) 서버 기동 — restart 동작 (기존 PID 있으면 종료 후 재기동)
bun run dev
```

### 3.3 검증

```bash
curl -sf http://127.0.0.1:9999/health && echo OK
# OK
```

**제공되는 스크립트 한 눈에 보기:**

| 스크립트 | 동작 |
|----------|------|
| `bun run start` | 이미 실행 중이면 종료, 아니면 백그라운드 데몬으로 기동 |
| `bun run dev` | 강제 재시작 (restart) |
| `bun run stop` | PID 파일 기준 SIGTERM |
| `bun run status` | PID·포트·헬스를 한 줄로 출력 |
| `bun run doctor` | 5단계 환경 점검 |

<details>
<summary><code>package.json</code> 발췌</summary>

```json
"start":  "bun run packages/server/src/index.ts start",
"dev":    "bun run packages/server/src/index.ts restart",
"stop":   "bun run packages/server/src/index.ts stop",
"status": "bun run packages/server/src/index.ts status",
"doctor": "bun run packages/server/src/cli.ts doctor"
```
</details>

### 3.4 자동 백그라운드화

`bun run dev`는 fork 후 자식 프로세스를 백그라운드로 떼어내고 PID를 `~/.spyglass/server.pid`에 기록합니다.
**셸을 닫아도 서버는 계속 실행**됩니다. 별도 `nohup`·`&`·`disown`은 필요 없습니다.

> 자세한 절차는 [`install-guide.md`](./install-guide.md)를 참고하세요.

### 3.5 트러블슈팅

- **9999 포트 사용 중** → `lsof -i :9999`로 점유 프로세스 확인 후 종료, 또는 [§ 7.3](#73-포트-변경)로 포트 변경
- **PID는 있는데 응답 없음** → `bun run stop && bun run dev`로 재시작
- **그 외** → [§ 11 트러블슈팅](#11-트러블슈팅) 참조

---

## 4. 데몬화 (백그라운드 상주)

`bun run dev`만으로도 백그라운드 상주는 가능하지만, **부팅 시 자동 기동**이나 **크래시 시 자동 재시작**이 필요하면 OS 수준의 서비스로 등록해야 합니다.

| 플랫폼 | 서비스 매니저 | 권장 사용 시점 |
|--------|------------|--------------|
| macOS | launchd | 데스크톱·노트북 |
| Linux | systemd (`--user`) | 서버·워크스테이션 |
| 공통 | PM2 | Node 진영 친화 / 멀티 앱 관리 |

### 4.1 macOS — launchd

**요구사항**: macOS 12+, Bun이 `~/.bun/bin/bun`에 설치됨.

**설정 파일** `~/Library/LaunchAgents/com.user.spyglass.plist`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>com.user.spyglass</string>

  <key>ProgramArguments</key>
  <array>
    <string>/Users/YOUR_USER/.bun/bin/bun</string>
    <string>run</string>
    <string>packages/server/src/index.ts</string>
    <string>start</string>
  </array>

  <key>WorkingDirectory</key>
  <string>/Users/YOUR_USER/.spyglass-src</string>

  <key>EnvironmentVariables</key>
  <dict>
    <key>HOME</key>
    <string>/Users/YOUR_USER</string>
    <key>PATH</key>
    <string>/Users/YOUR_USER/.bun/bin:/usr/local/bin:/usr/bin:/bin</string>
  </dict>

  <key>RunAtLoad</key>
  <true/>

  <key>KeepAlive</key>
  <true/>

  <key>StandardOutPath</key>
  <string>/Users/YOUR_USER/.spyglass/logs/launchd.out.log</string>
  <key>StandardErrorPath</key>
  <string>/Users/YOUR_USER/.spyglass/logs/launchd.err.log</string>
</dict>
</plist>
```

**로드 / 언로드:**

```bash
# 등록 + 즉시 기동
launchctl load -w ~/Library/LaunchAgents/com.user.spyglass.plist

# 상태
launchctl list | grep spyglass

# 중지 + 해제
launchctl unload -w ~/Library/LaunchAgents/com.user.spyglass.plist
```

**검증:**

```bash
launchctl list | grep spyglass     # PID와 exit status 표시
curl -sf http://127.0.0.1:9999/health && echo OK
```

> **Note**: `bun run dev`(`restart`) 대신 `start`를 호출하는 이유 — launchd가 이미 프로세스 라이프사이클을 관리하므로 자체 restart 로직과 충돌을 피해야 합니다.

**트러블슈팅:**

- 기동 안 됨 → `~/.spyglass/logs/launchd.err.log` 확인
- `KeepAlive` 무한 루프 → `bun` 경로(`ProgramArguments[0]`)가 절대 경로인지 확인

### 4.2 Linux — systemd

**요구사항**: systemd 230+ (`--user` 모드), Bun이 `~/.bun/bin/bun`에 설치됨.

사용자 단위(`systemd --user`) 서비스가 권장됩니다. 호스트 부팅 시 자동 기동까진 필요 없고 로그인 세션과 함께 살아 있으면 충분합니다.

**설정 파일** `~/.config/systemd/user/spyglass.service`:

```ini
[Unit]
Description=claude-spyglass — Claude Code observability server
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=%h/.spyglass-src
ExecStart=%h/.bun/bin/bun run packages/server/src/index.ts start
Restart=on-failure
RestartSec=5

# 데이터 경로
Environment=HOME=%h

# 선택: 명시적 포트·보존 기간
# Environment=SPYGLASS_RETENTION_DAYS=30

StandardOutput=append:%h/.spyglass/logs/systemd.out.log
StandardError=append:%h/.spyglass/logs/systemd.err.log

[Install]
WantedBy=default.target
```

**활성화:**

```bash
systemctl --user daemon-reload
systemctl --user enable --now spyglass.service
systemctl --user status spyglass.service
```

**검증:**

```bash
systemctl --user is-active spyglass.service   # active
curl -sf http://127.0.0.1:9999/health && echo OK
journalctl --user -u spyglass.service -f      # 실시간 로그
```

**부팅 시 로그인 없이도 기동:**

```bash
sudo loginctl enable-linger "$USER"
```

**트러블슈팅:**

- 서비스 안 보임 → `daemon-reload` 누락 여부 확인
- `Restart=on-failure` 무한 루프 → `journalctl`로 원인 추적 후 `Wants=network-online.target` 등 의존성 점검

### 4.3 PM2 (Node 진영 친화)

**요구사항**: 시스템에 PM2 설치(`npm i -g pm2`), Bun이 PATH에 있음.

`ecosystem.config.cjs`:

```js
module.exports = {
  apps: [{
    name: 'spyglass',
    cwd: process.env.HOME + '/.spyglass-src',
    script: 'bun',
    args: 'run packages/server/src/index.ts start',
    interpreter: 'none',          // bun이 직접 실행, node로 감싸지 않음
    autorestart: true,
    max_restarts: 10,
    env: {
      HOME: process.env.HOME,
    },
    out_file: process.env.HOME + '/.spyglass/logs/pm2.out.log',
    error_file: process.env.HOME + '/.spyglass/logs/pm2.err.log',
  }],
};
```

**활성화 + 검증:**

```bash
pm2 start ecosystem.config.cjs
pm2 save
pm2 startup                          # 부팅 시 자동 기동 등록
pm2 status spyglass                  # 상태 확인
curl -sf http://127.0.0.1:9999/health && echo OK
```

---

## 5. Docker 배포

호스트에 Bun을 설치하고 싶지 않거나, 다른 사용자와 격리가 필요하거나, 폐쇄망에 tarball로 배포할 때 적합합니다.

### 5.1 요구사항

- Docker Engine 20.10+ (BuildKit 필요)
- Docker Compose v2
- 호스트의 `~/.spyglass` 디렉토리 쓰기 권한
- (오프라인 배포 시) 빌드 머신과 동일 아키텍처(`amd64` / `arm64`)

### 5.2 이미지 구조 (`Dockerfile`)

`Dockerfile`은 **멀티스테이지 + Alpine 기반**으로 경량화되어 있습니다.

```dockerfile
# syntax=docker/dockerfile:1.6
FROM oven/bun:1.2-alpine AS builder
WORKDIR /app
# 의존성 먼저 설치 — 레이어 캐시 최적화
COPY package.json ./
COPY packages/*/package.json ./packages/*/
RUN bun install --production --no-save
COPY packages ./packages
COPY hooks ./hooks

FROM oven/bun:1.2-alpine
ENV HOME=/data
ENV SPYGLASS_PORT=9999
WORKDIR /app
COPY --from=builder /app/package.json ./
COPY --from=builder /app/packages ./packages
COPY --from=builder /app/hooks ./hooks
COPY --from=builder /app/node_modules ./node_modules
RUN mkdir -p /data/.spyglass/logs /data/.spyglass/timing \
 && chmod 700 /data/.spyglass
VOLUME ["/data/.spyglass"]
EXPOSE 9999
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD bun -e "fetch('http://localhost:${SPYGLASS_PORT:-9999}/health')\
    .then(r=>r.ok?process.exit(0):process.exit(1)).catch(()=>process.exit(1))"
CMD ["bun", "run", "packages/server/src/index.ts", "start"]
```

**핵심 포인트:**

| 항목 | 의미 |
|------|------|
| `HOME=/data` | 데이터 경로가 `${HOME}/.spyglass`로 결정되므로, `HOME`을 `/data`로 매핑하면 모든 산출물이 `/data/.spyglass`에 모입니다 |
| `VOLUME ["/data/.spyglass"]` | DB·로그·PID·pricing.json 보관. **호스트에 바인드 마운트 필수** (안 하면 컨테이너 삭제 시 데이터 증발) |
| `HEALTHCHECK` | 내부에서 `/health` 엔드포인트로 30초마다 점검 |
| `CMD ["bun", ...]` (exec 형식) | PID 1로 `bun` 실행 — Docker가 SIGTERM을 정상 전달 |
| 훅 스크립트(`hooks/`) 포함 | 컨테이너 안에 있긴 하지만 **실제 호출은 호스트에서** 일어남. 컨테이너는 HTTP 수신만 담당 |

### 5.3 `docker-compose.yml` 사용

루트의 `docker-compose.yml`:

```yaml
services:
  spyglass:
    image: spyglass:latest
    container_name: spyglass
    restart: unless-stopped
    ports:
      - "9999:9999"                       # 호스트:컨테이너
    volumes:
      - "${HOME}/.spyglass:/data/.spyglass"   # DB·로그를 호스트에 영구 보관
    environment:
      SPYGLASS_PORT: 9999
    healthcheck:
      test: ["CMD", "bun", "-e", "fetch('http://localhost:9999/health').then(r=>r.ok?process.exit(0):process.exit(1)).catch(()=>process.exit(1))"]
      interval: 30s
      timeout: 5s
      retries: 3
      start_period: 10s
```

**빌드 + 기동:**

```bash
# 1) 로컬 이미지 빌드
docker build -t spyglass:latest .

# 2) 컴포즈로 기동
docker compose up -d
```

**검증:**

```bash
curl -sf http://127.0.0.1:9999/health && echo OK
docker compose ps          # 상태(running, healthy)
docker compose logs -f     # 실시간 로그
```

> **Note**: 호스트에서 훅이 호출하는 주소는 그대로 `http://127.0.0.1:9999` 입니다 — 포트 매핑 덕분에 Claude Code 입장에선 로컬 실행과 차이가 없습니다.

**트러블슈팅**: [§ 11.1](#111-컨테이너가-즉시-종료-exit-1), [§ 11.2](#112-볼륨-권한-linux), [§ 11.3](#113-헬스체크가-unhealthy-상태) 참조.

### 5.4 tarball 배포 (오프라인)

`scripts/build-image.sh`는 빌드된 이미지를 **`.tar.gz` + `.sha256`** 로 패키징해 외부 머신으로 옮길 수 있게 해 줍니다.

```bash
bash scripts/build-image.sh
# dist/spyglass-v<version>-<short-hash>.tar.gz
# dist/spyglass-v<version>-<short-hash>.tar.gz.sha256
```

**스크립트가 수행하는 일:**

1. 버전(`package.json` 또는 인자) + 짧은 git 해시로 태그 결정 → `spyglass:v1.0.0-abcdef1`, `spyglass:latest`
2. `docker build` 실행
3. `docker save | gzip -9` 로 tarball 생성
4. SHA-256 해시를 `*.sha256` 로 첨부

**수신자 측 절차:**

```bash
# 1) 무결성 검증
sha256sum -c spyglass-v1.0.0-abcdef1.tar.gz.sha256

# 2) 이미지 로드
docker load < spyglass-v1.0.0-abcdef1.tar.gz

# 3) 실행
docker run -d --name spyglass \
  -p 9999:9999 \
  -v "${HOME}/.spyglass:/data/.spyglass" \
  spyglass:v1.0.0-abcdef1
```

### 5.5 Docker 사용 시 훅 설정

호스트의 Claude Code 훅은 여전히 호스트 경로의 `hooks/spyglass-collect.sh`를 호출합니다.

> **Important**: 컨테이너 내부의 훅은 **사용되지 않습니다** — 컨테이너는 단순히 HTTP `/collect` 서버 역할만 합니다.
> 따라서 **컨테이너로 서버를 띄우더라도 호스트에 저장소는 클론**되어 있어야 훅 스크립트가 실행됩니다.

```jsonc
// ~/.claude/settings.json
{
  "env": {
    "SPYGLASS_DIR": "/Users/alice/.spyglass-src",   // 호스트에 클론된 저장소 경로
    "SPYGLASS_HOST": "localhost",
    "SPYGLASS_PORT": "9999"
  },
  "hooks": { /* ... install-guide.md 참조 */ }
}
```

---

## 6. 데이터 볼륨과 백업

### 6.1 데이터 위치

| 항목 | 로컬 경로 | 컨테이너 경로 |
|------|----------|--------------|
| DB | `~/.spyglass/spyglass.db` | `/data/.spyglass/spyglass.db` |
| WAL/SHM | `~/.spyglass/spyglass.db-wal`, `*-shm` | 동일 |
| 가격표 | `~/.spyglass/pricing.json` | 동일 |
| 훅 로그 | `~/.spyglass/logs/collect.log` | 동일 |
| 훅 원본 페이로드 | `~/.spyglass/logs/hook-raw.jsonl` | 동일 |
| 서버 로그 | `~/.spyglass/logs/server.log` | 동일 |
| PID | `~/.spyglass/server.pid` | 컨테이너에선 PID 1이므로 의미 없음 |

### 6.2 백업

DB는 SQLite + WAL 모드입니다. **안전한 백업은 SQLite의 `.backup` 또는 `VACUUM INTO`** 명령으로 수행합니다 (서버 실행 중에도 가능).

**방식 A: 핫 백업 (권장 — 서버 실행 중에도 안전)**

```bash
# 1) sqlite3 .backup 명령으로 일관된 스냅샷 생성
BACKUP="${HOME}/spyglass-backup-$(date +%Y%m%d).db"
sqlite3 "${HOME}/.spyglass/spyglass.db" ".backup '${BACKUP}'"

# 2) 압축
gzip "${BACKUP}"
```

**방식 B: 콜드 백업 (서버 중지)**

```bash
# 1) 서버 중지
cd "${HOME}/.spyglass-src" && bun run stop

# 2) DB 파일 복사 (WAL/SHM 포함)
cp ~/.spyglass/spyglass.db* ~/backups/

# 3) 서버 재기동
cd "${HOME}/.spyglass-src" && bun run dev
```

### 6.3 복구

```bash
# 1) 서버 중지
bun run stop

# 2) 백업 DB로 교체
cp ~/backups/spyglass.db ~/.spyglass/spyglass.db

# 3) WAL/SHM 잔재 제거 (없으면 SQLite가 자동 회복)
rm -f ~/.spyglass/spyglass.db-wal ~/.spyglass/spyglass.db-shm

# 4) 서버 재기동
bun run dev
```

### 6.4 자동 정리

`packages/server/src/runtime/maintenance.ts`는 매 시간 보존 기간 초과 데이터를 정리합니다.

```ts
const retentionDays = parseInt(process.env.SPYGLASS_RETENTION_DAYS ?? '30', 10);
```

기본 **30일**. 필요 시 환경변수로 조정합니다:

```bash
SPYGLASS_RETENTION_DAYS=7 bun run dev      # 7일만 보존
```

수동 정리는 [`install-guide.md` § 7.3](./install-guide.md#73-오래된-데이터-정리) 참조.

---

## 7. 포트 · 네트워크 · 보안

### 7.1 기본 바인딩

서버는 **`127.0.0.1:9999` loopback only** 로 기동됩니다 (`packages/server/src/runtime/config.ts`):

```ts
export const DEFAULT_PORT = 9999;
export const PORT = parseInt(process.env.SPGLASS_PORT || `${DEFAULT_PORT}`, 10);
export const HOST = process.env.SPGLASS_HOST || '127.0.0.1';
```

> **Warning — 환경변수 키 오타 보존**
> 서버 바인딩 환경변수 키는 `SPGLASS_PORT` / `SPGLASS_HOST` 입니다 (`SPYGLASS_` 아님, 오타가 코드에 보존됨).
> Docker 이미지의 `SPYGLASS_PORT` 와는 별개 변수이며, 컨테이너 안에선 둘 다 기본값 9999가 그대로 쓰이므로 실질 영향은 없습니다.
> 자세한 구분은 [§ 8 환경변수 레퍼런스](#8-환경변수-레퍼런스) 참조.

### 7.2 외부 노출 시 주의

`SPGLASS_HOST=0.0.0.0`로 바인딩하면 LAN의 다른 기기에서 접근 가능해지지만, **이 도구는 인증/권한 메커니즘이 없습니다.** 다음 두 가지를 권장합니다:

1. **항상 loopback** — 외부 노출이 정말 필요한 경우만 변경
2. **외부 노출 시 reverse proxy로 인증 추가** — Caddy의 basic auth, Tailscale의 ACL, nginx의 IP 화이트리스트 등

예시 (Caddy basic auth):

```caddy
spyglass.internal {
  basicauth {
    alice $2a$14$...   # caddy hash-password
  }
  reverse_proxy 127.0.0.1:9999
}
```

### 7.3 포트 변경

다른 포트로 옮기려면 **서버와 훅 양쪽**을 모두 바꿔야 합니다.

```bash
# 1) 서버 — 9999 → 8088
SPGLASS_PORT=8088 bun run dev

# 2) 훅 — ~/.claude/settings.json 의 env.SPYGLASS_PORT
"env": {
  "SPYGLASS_DIR": "/Users/alice/.spyglass-src",
  "SPYGLASS_PORT": "8088"
}
```

Docker의 경우 `docker-compose.yml`의 `ports: "8088:9999"` 처럼 호스트 포트만 바꾸는 게 더 간단합니다.

### 7.4 CORS

서버는 대시보드 정적 자원과 API를 같은 origin(`:9999`)에서 서빙하므로 CORS 설정이 별도로 필요하지 않습니다.
외부 도메인에서 API만 호출하는 경우라면 `packages/server/src/api.ts` 등을 수정해 CORS 헤더를 추가해야 합니다 — 기본 배포 흐름에선 권장하지 않습니다.

---

## 8. 환경변수 레퍼런스

> **Warning — `SPGLASS_*` vs `SPYGLASS_*`**
> 두 prefix는 별개 변수이며, 코드에 일부 오타가 보존되어 있어 혼동하기 쉽습니다.
> - **`SPGLASS_*`** (오타) → 포트·호스트·DB 경로 (`runtime/config.ts`)
> - **`SPYGLASS_*`** (정상) → PID 파일·로그·보존 기간·훅 변수
>
> 변수명 그대로 사용해야 적용됩니다. 잘못 쓰면 조용히 기본값으로 떨어집니다.

### 8.1 서버 측

| 변수 | 사용 위치 | 설명 | 기본값 |
|------|----------|------|--------|
| `SPGLASS_PORT` ⚠️ | `runtime/config.ts` | 서버 리스닝 포트 | `9999` |
| `SPGLASS_HOST` ⚠️ | `runtime/config.ts` | 서버 리스닝 호스트 | `127.0.0.1` |
| `SPGLASS_DB_PATH` ⚠️ | `runtime/config.ts` | SQLite DB 파일 경로 | `~/.spyglass/spyglass.db` |
| `SPYGLASS_PID_FILE` | `runtime/daemon.ts` | PID 파일 경로 | `~/.spyglass/server.pid` |
| `SPYGLASS_SERVER_LOG` | `runtime/stdio-mirror.ts` | 서버 로그 미러 경로 | `~/.spyglass/logs/server.log` |
| `SPYGLASS_RETENTION_DAYS` | `runtime/maintenance.ts` | 데이터 보존 기간(일) | `30` |
| `ANTHROPIC_UPSTREAM_URL` | `proxy/upstream.ts` | 기본 프록시 upstream | `https://api.anthropic.com` |
| `MOONSHOT_UPSTREAM_URL` | `proxy/upstream.ts` | `kimi-*` 모델 upstream | `https://api.moonshot.ai/anthropic` |
| `CUSTOM_UPSTREAMS` | `proxy/upstream.ts` | 추가 prefix→URL 매핑 (`prefix1=url1,prefix2=url2`) | 없음 |
| `HOME` | 전반 | 데이터 디렉토리 base | OS 기본 |

> ⚠️ 표시는 **오타 prefix(`SPGLASS_`)** 를 사용하는 변수입니다.

### 8.2 훅 측 (Claude Code가 주입)

`hooks/spyglass-collect.sh` 가 참조합니다.

| 변수 | 설명 | 기본값 |
|------|------|--------|
| `SPYGLASS_DIR` | 클론된 저장소 절대 경로 (필수) | — |
| `SPYGLASS_HOST` | 서버 호스트 | `localhost` |
| `SPYGLASS_PORT` | 서버 포트 | `9999` |
| `SPYGLASS_TIMEOUT` | 훅 HTTP 타임아웃(초) | `1` |

### 8.3 Claude Code 측 (프록시 활성화)

| 변수 | 설명 |
|------|------|
| `ANTHROPIC_BASE_URL` | `http://localhost:9999` 로 설정하면 `/v1/*` 가 spyglass를 경유 |
| `ANTHROPIC_AUTH_TOKEN` | 비공식 모델(kimi 등) 사용 시 |
| `ANTHROPIC_MODEL` | 모델 명시 (예: `kimi-k2.6`) |

자세한 활성화 절차는 [`install-guide.md` § 5](./install-guide.md#5-claude-code-프록시-설정) 참조.

---

## 9. 업그레이드와 마이그레이션

> **권장 절차**: 모든 업그레이드 직전에 [§ 6.2 백업](#62-백업)을 먼저 수행하세요. DB 마이그레이션은 단방향이므로 다운그레이드가 어렵습니다.

### 9.1 로컬 업그레이드

```bash
# 1) 백업 (권장)
sqlite3 ~/.spyglass/spyglass.db ".backup '${HOME}/spyglass-pre-upgrade.db'"

# 2) 코드 갱신
cd "${HOME}/.spyglass-src"
git pull
bun install

# 3) 재기동 — 기존 프로세스 자동 종료 + 마이그레이션 자동 적용
bun run dev

# 4) 검증
bun run status
```

### 9.2 Docker 업그레이드

```bash
# 1) 백업 (호스트의 ~/.spyglass 가 그대로 보존되지만 안전을 위해)
sqlite3 ~/.spyglass/spyglass.db ".backup '${HOME}/spyglass-pre-upgrade.db'"

# 2) 새 이미지 빌드 (또는 tarball 로드)
docker compose build --pull
# 또는: docker load < new-image.tar.gz

# 3) 컨테이너 재생성
docker compose up -d

# 4) 헬스 확인
docker compose ps
curl -sf http://127.0.0.1:9999/health && echo OK
```

> **Note**: 볼륨(`~/.spyglass`)은 그대로 재사용되므로 **DB는 보존**됩니다.

### 9.3 DB 마이그레이션

서버 기동 시 자동으로 적용됩니다 — 별도 명령 필요 없습니다.

**작동 원리:**
- `packages/storage/src/migrator.ts` 가 `packages/storage/migrations/*.sql` 파일을 스캔합니다.
- `PRAGMA user_version` 보다 큰 버전만 순서대로 실행하고, 그때마다 `user_version` 을 갱신합니다.
- 현재 마이그레이션은 `001-init.sql` ~ `020-payload-audit-fields.sql` 까지 누적되어 있습니다.

**업그레이드 후 마이그레이션 버전 확인:**

```bash
bun -e 'const {Database}=require("bun:sqlite");
  const db = new Database(`${process.env.HOME}/.spyglass/spyglass.db`);
  console.log(db.query("PRAGMA user_version").get());'
# { user_version: 20 }
```

> **Warning**: 마이그레이션은 **앞으로만** 진행되며 다운그레이드는 지원되지 않습니다. 업그레이드 직전에 반드시 `.backup` 핫백업을 떠 두세요.

### 9.4 다운그레이드

DB 마이그레이션은 단방향이므로, 다운그레이드는 백업 복원 방식으로만 가능합니다.

```bash
# 1) 서버 중지
bun run stop

# 2) 현재 DB를 보존하고 백업본 복원
mv ~/.spyglass/spyglass.db ~/.spyglass/spyglass.db.future
cp ~/backups/spyglass-pre-upgrade.db ~/.spyglass/spyglass.db

# 3) 이전 버전 코드로 체크아웃
git checkout <previous-tag>
bun install

# 4) 재기동
bun run dev
```

---

## 10. 헬스체크와 모니터링

**헬스체크 명령 모음 (한 눈에):**

| 명령 | 무엇을 점검하나 | 언제 쓰나 |
|------|--------------|---------|
| `curl -sf http://127.0.0.1:9999/health` | 서버·DB 응답 | 가장 빠른 1초 점검 |
| `bun run status` | PID·포트·헬스 한 줄 요약 | 매일 사용 |
| `bun run doctor` | 5단계 환경 종합 진단 | 설치 후·업그레이드 후·이상 시 |
| `docker compose ps` | 컨테이너 상태(`healthy`) | Docker 배포 시 |
| `docker inspect <name> --format='{{json .State.Health}}'` | 컨테이너 헬스 상세 이력 | 이상 진단 시 |

### 10.1 `/health` 엔드포인트

```bash
curl -sf http://127.0.0.1:9999/health
# OK
```

- 200 OK: 서버·DB 연결 정상
- 연결 실패: 서버 미기동 / 포트 충돌

`Dockerfile`과 `docker-compose.yml`의 `HEALTHCHECK`도 이 엔드포인트를 30초 간격으로 폴링합니다.

### 10.2 `bun run status`

```bash
$ cd ~/.spyglass-src && bun run status
[Server] Running (PID 12345) on 127.0.0.1:9999 — healthy
```

PID 파일·실제 프로세스·포트 리슨·헬스 응답을 한 줄로 요약합니다.

### 10.3 `bun run doctor`

5단계 종합 진단:

1. Bun 런타임 / 버전
2. 서버 프로세스 / 헬스체크
3. `~/.claude/settings.json` 훅 등록 여부 (`spyglass-collect.sh` 명령 포함 검사)
4. `SPYGLASS_DIR` 경로 유효성
5. DB 파일 / 마이그레이션 버전

설치 직후뿐 아니라 **업그레이드 후·이상 발생 시** 매번 실행하는 습관을 권장합니다.

### 10.4 외부 모니터링 (선택)

부팅 시 자동 기동된 데몬을 모니터링하려면, `/health`를 단순 핑 스크립트로 분 단위 체크하는 정도면 충분합니다.

```bash
# 1분 간격 ping 예시
*/1 * * * * curl -sf http://127.0.0.1:9999/health > /dev/null || \
  /usr/bin/logger -t spyglass "health check failed"
```

복잡한 메트릭(Prometheus exporter 등)은 현재 제공하지 않습니다 — 로컬 도구 성격에 맞춰 의도적으로 단순하게 유지합니다.

---

## 11. 트러블슈팅

### 11.1 컨테이너가 즉시 종료 (`exit 1`)

```bash
docker compose logs spyglass | tail -50
```

자주 보이는 원인:

| 증상 로그 | 원인 | 해결 |
|----------|------|------|
| `EADDRINUSE :9999` | 호스트 9999 이미 사용 중 | `ports`를 다른 호스트 포트로 변경 |
| `SQLITE_CANTOPEN` | 볼륨 권한 문제 | `chown -R $(id -u):$(id -g) ~/.spyglass` |
| `[migrator] Fatal error` | DB 마이그레이션 충돌 | 백업 복원 후 재시도 |

### 11.2 볼륨 권한 (Linux)

Linux에선 컨테이너 내 uid(`bun` 사용자)가 호스트 uid와 다를 수 있어 권한 문제가 자주 발생합니다.

```bash
# 호스트에서 컨테이너 내 uid(1000)에 맞춰 owner 변경
sudo chown -R 1000:1000 ~/.spyglass
chmod 700 ~/.spyglass
```

또는 `docker-compose.yml`에 `user:` 지시어를 추가:

```yaml
services:
  spyglass:
    user: "${UID}:${GID}"
```

### 11.3 헬스체크가 unhealthy 상태

```bash
docker inspect spyglass --format='{{json .State.Health}}' | jq
```

- `start_period`(10초) 이내에 마이그레이션이 끝나지 않으면 첫 헬스체크가 실패할 수 있음 → 자연스러운 일시 상태
- 30초 이상 unhealthy가 지속되면 로그 확인

### 11.4 부팅 시 자동 기동 안 됨

| 환경 | 점검 명령 |
|------|---------|
| macOS launchd | `launchctl list \| grep spyglass`, `~/.spyglass/logs/launchd.err.log` |
| Linux systemd | `systemctl --user is-enabled spyglass`, `loginctl enable-linger $USER` |
| PM2 | `pm2 startup` 실행 여부, `pm2 save`로 현재 상태 저장 여부 |

### 11.5 그 외

추가 트러블슈팅 항목은 [`install-guide.md` § 9](./install-guide.md#9-문제-해결) 를 참조하세요.

- 헬스체크 실패
- 데이터 미수집
- 프록시 오류
- 권한 오류
- 완전 초기화

---

## 참고 문서

- [`install-guide.md`](./install-guide.md) — 단일 사용자 설치 가이드
- [`examples/settings.hooks.minimal.json`](./examples/settings.hooks.minimal.json) — 최소 훅 프로파일
- [`examples/settings.hooks.full.json`](./examples/settings.hooks.full.json) — 권장(전체) 훅 프로파일
- 프로젝트 루트 [`README.md`](../README.md) — 기능과 철학 개요
- 프로젝트 루트 [`Dockerfile`](../Dockerfile), [`docker-compose.yml`](../docker-compose.yml)
- [`scripts/build-image.sh`](../scripts/build-image.sh) — tarball 패키징 스크립트
- [`scripts/install.sh`](../scripts/install.sh) — one-liner 설치 스크립트
