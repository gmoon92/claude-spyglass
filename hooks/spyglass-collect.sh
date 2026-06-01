#!/bin/bash
#
# spyglass-collect.sh
#
# @description Claude Code 훅에서 호출되는 데이터 수집 스크립트
# @usage stdin으로 Claude Code raw hook payload를 받아 서버로 전달
#
# 역할: raw payload 원장 기록 + 서버로 전달
# 정제 로직(token 추출, model 추출, tool_detail, duration_ms)은 서버(collect.ts)가 담당
#

set -euo pipefail

# =============================================================================
# 설정
# =============================================================================

SPYGLASS_HOST="${SPYGLASS_HOST:-localhost}"
SPYGLASS_PORT="${SPYGLASS_PORT:-9999}"
SPYGLASS_COLLECT_ENDPOINT="http://${SPYGLASS_HOST}:${SPYGLASS_PORT}/collect"
SPYGLASS_EVENTS_ENDPOINT="http://${SPYGLASS_HOST}:${SPYGLASS_PORT}/events"
SPYGLASS_TIMEOUT="${SPYGLASS_TIMEOUT:-1}"

# 로그 설정 — collect 운영 로그·raw 원장 모두 일자별 버킷으로 분리(무한 단일 파일 증가 방지).
#   TS log-paths.ts 가 SSoT 이며, 디렉토리명(collect/·hook-raw/)·날짜포맷(%Y-%m-%d)·7일 보존
#   규약을 양쪽이 공유한다. 7일 지난 버킷은 서버 maintenance(runCleanupNow)가 자동 삭제.
SPYGLASS_LOG_DIR="${HOME}/.spyglass/logs"
SPYGLASS_COLLECT_LOG_DIR="${SPYGLASS_LOG_DIR}/collect"
SPYGLASS_COLLECT_LOG="${SPYGLASS_COLLECT_LOG_DIR}/$(date '+%Y-%m-%d').log"
SPYGLASS_RAW_LOG_DIR="${SPYGLASS_LOG_DIR}/hook-raw"
SPYGLASS_RAW_LOG="${SPYGLASS_RAW_LOG_DIR}/$(date '+%Y-%m-%d').jsonl"

# DIAG 게이트 — server diag-log.ts 와 동일 판정('1'|'true'만 활성, 기본 off).
#   ON: collect 로그·raw 원장을 일자 버킷 파일에 기록. OFF: 파일 적재 없이 콘솔(stderr)로만.
SPYGLASS_DIAG_ENABLED_NORM="$(printf '%s' "${SPYGLASS_DIAG_ENABLED:-}" | tr '[:upper:]' '[:lower:]')"
# 디스크 critical 임계(MB) — server disk-space SSoT 기본값(200)과 일치.
SPYGLASS_DISK_MIN_FREE_MB="${SPYGLASS_DISK_MIN_FREE_MB:-200}"

# =============================================================================
# 유틸리티 함수
# =============================================================================

# DIAG 게이트 판정 — '1'|'true' 면 0(성공). raw 원장·collect 로그가 공유하는 단일 판정.
diag_on() {
    [[ "$SPYGLASS_DIAG_ENABLED_NORM" == "1" || "$SPYGLASS_DIAG_ENABLED_NORM" == "true" ]]
}

# raw 원장 기록 — DIAG 활성 + 디스크 여유 시에만 (단일 진입점).
#   판단 로직(DIAG 게이트 + 디스크 가드)을 여기 한 곳에 캡슐화한다 — 호출측은 raw payload 만
#   넘기고 boolean 을 재계산하지 않는다. critical 디스크에서는 raw 폭주가 write I/O hang 의
#   주범이므로 기록을 건너뛴다(측정 실패 시엔 막지 않음).
record_raw_payload() {
    diag_on || return 0
    local avail_mb
    avail_mb=$(df -m "$HOME" 2>/dev/null | awk 'NR==2 {print $4}')
    if [[ -n "$avail_mb" ]] && (( avail_mb < SPYGLASS_DISK_MIN_FREE_MB )); then
        return 0
    fi
    [[ -d "$SPYGLASS_RAW_LOG_DIR" ]] || mkdir -p "$SPYGLASS_RAW_LOG_DIR"
    echo "$1" >> "$SPYGLASS_RAW_LOG"
}

# 로그 출력 — DIAG ON: collect/YYYY-MM-DD.log 일자 버킷에 append / OFF: 콘솔(stderr)로만.
#   server.log·hook-raw 와 통일된 게이트 — 평상시 파일 적재 0, 진단 시에만 영구 기록.
log() {
    local line="[$(date '+%Y-%m-%d %H:%M:%S')] $*"
    if diag_on; then
        [[ -d "$SPYGLASS_COLLECT_LOG_DIR" ]] || mkdir -p "$SPYGLASS_COLLECT_LOG_DIR"
        echo "$line" >> "$SPYGLASS_COLLECT_LOG"
    else
        echo "$line" >&2
    fi
}

# 오류 로그
error() {
    log "[ERROR] $*"
}

# 정보 로그
info() {
    log "[INFO] $*"
}

# =============================================================================
# 데이터 전송
# =============================================================================

send_to_spyglass() {
    local json_data="$1"
    local endpoint="${2:-$SPYGLASS_COLLECT_ENDPOINT}"

    # 비동기로 전송 (백그라운드)
    (
        local response
        local http_code

        response=$(curl -s -w "\n%{http_code}" \
            -X POST \
            -H "Content-Type: application/json" \
            -d "$json_data" \
            --max-time "$SPYGLASS_TIMEOUT" \
            "$endpoint" 2>/dev/null || echo -e "\n000")

        http_code=$(echo "$response" | tail -1)

        if [[ "$http_code" != "200" && "$http_code" != "201" && "$http_code" != "000" ]]; then
            error "Failed to send data: HTTP $http_code (endpoint=$endpoint)"
        fi
    ) &

    echo $!
}

# raw hook payload를 /events로 전송 (SessionStart/Stop/SessionEnd용)
send_raw_event() {
    local payload="$1"
    record_raw_payload "$payload"
    send_to_spyglass "$payload" "$SPYGLASS_EVENTS_ENDPOINT"
}

# =============================================================================
# 실행
# =============================================================================

# stdin에서 payload 읽기 (훅에서 전달)
# -p /dev/stdin 은 macOS에서 신뢰할 수 없으므로 TTY 체크 사용
if [[ ! -t 0 ]]; then
    payload=$(cat)

    # 전 이벤트 원장 기록 — DIAG 활성 + 디스크 여유 시에만 (record_raw_payload 가 게이트)
    record_raw_payload "$payload"

    # hook_event_name 필드로 이벤트 유형 판별
    hook_event=$(python3 -c "
import sys, json
try:
    d = json.loads(sys.stdin.read())
    print(d.get('hook_event_name', ''))
except:
    print('')
" 2>/dev/null <<< "$payload" || echo "")

    info "Event: $hook_event"

    case "$hook_event" in
      "UserPromptSubmit"|"PreToolUse"|"PostToolUse")
        # 정제 로직은 서버(collect.ts)가 담당 — raw payload를 그대로 전달
        send_to_spyglass "$payload" "$SPYGLASS_COLLECT_ENDPOINT"
        ;;
      "")
        # hook_event_name 없음: 레거시 인수 방식 fallback — /collect로 전달
        send_to_spyglass "$payload" "$SPYGLASS_COLLECT_ENDPOINT"
        ;;
      *)
        # SessionStart/Stop/SessionEnd 등: /events로 전달 (claude_events 테이블 저장)
        send_to_spyglass "$payload" "$SPYGLASS_EVENTS_ENDPOINT"
        ;;
    esac
else
    error "No stdin payload received"
fi
