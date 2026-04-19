# syntax=docker/dockerfile:1.6
# =============================================================================
# claude-spyglass Docker 이미지
# -----------------------------------------------------------------------------
# 서버 + 웹 대시보드를 실행하는 경량 이미지.
# 훅 스크립트(hooks/spyglass-collect.sh)는 호스트에서 실행되어야 하므로
# 이미지에 포함되지만 실제 호출은 호스트에서 HTTP로 컨테이너 포트에 전달한다.
# =============================================================================

FROM oven/bun:1.2-alpine AS builder

WORKDIR /app

# 의존성 먼저 설치 (레이어 캐시 최적화)
COPY package.json ./
COPY packages/server/package.json ./packages/server/
COPY packages/storage/package.json ./packages/storage/
COPY packages/types/package.json ./packages/types/
COPY packages/web/package.json ./packages/web/
COPY packages/tui/package.json ./packages/tui/

RUN bun install --production --no-save

# 소스 복사 (migrations/*.sql 포함)
COPY packages ./packages
COPY hooks ./hooks

# =============================================================================
# 런타임 이미지
# =============================================================================
FROM oven/bun:1.2-alpine

LABEL org.opencontainers.image.title="claude-spyglass"
LABEL org.opencontainers.image.description="Local Claude Code monitoring - server + web dashboard"
LABEL org.opencontainers.image.source="https://github.com/gmoon92/claude-spyglass"

# 환경 변수
# HOME을 /data로 설정하면 ~/.spyglass = /data/.spyglass로 매핑된다
ENV HOME=/data
ENV SPYGLASS_PORT=9999

WORKDIR /app

# 런타임에 필요한 파일만 복사
COPY --from=builder /app/package.json ./
COPY --from=builder /app/packages ./packages
COPY --from=builder /app/hooks ./hooks
COPY --from=builder /app/node_modules ./node_modules

# 데이터 디렉토리 준비 (볼륨 마운트 지점)
RUN mkdir -p /data/.spyglass/logs /data/.spyglass/timing \
 && chmod 700 /data/.spyglass

VOLUME ["/data/.spyglass"]

EXPOSE 9999

# /health 엔드포인트로 헬스체크
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD bun -e "fetch('http://localhost:${SPYGLASS_PORT:-9999}/health').then(r=>r.ok?process.exit(0):process.exit(1)).catch(()=>process.exit(1))"

# 컨테이너는 서버를 PID 1로 실행 (Docker가 시그널 관리)
CMD ["bun", "run", "packages/server/src/index.ts", "start"]
