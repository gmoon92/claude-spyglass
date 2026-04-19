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

# 로그 설정
SPYGLASS_LOG_DIR="${HOME}/.spyglass/logs"
SPYGLASS_LOG_FILE="${SPYGLASS_LOG_DIR}/collect.log"
SPYGLASS_RAW_LOG="${SPYGLASS_LOG_DIR}/hook-raw.jsonl"

# =============================================================================
# 유틸리티 함수
# =============================================================================

# 로그 디렉토리 생성
ensure_log_dir() {
    if [[ ! -d "$SPYGLASS_LOG_DIR" ]]; then
        mkdir -p "$SPYGLASS_LOG_DIR"
    fi
}

# 로그 출력
log() {
    ensure_log_dir
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*" >> "$SPYGLASS_LOG_FILE"
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
    ensure_log_dir
    # 원장 기록
    echo "$payload" >> "$SPYGLASS_RAW_LOG"
    send_to_spyglass "$payload" "$SPYGLASS_EVENTS_ENDPOINT"
}

# =============================================================================
# 실행
# =============================================================================

# stdin에서 payload 읽기 (훅에서 전달)
# -p /dev/stdin 은 macOS에서 신뢰할 수 없으므로 TTY 체크 사용
if [[ ! -t 0 ]]; then
    payload=$(cat)

    # 전 이벤트 원장 기록 (hook-raw.jsonl)
    ensure_log_dir
    echo "$payload" >> "$SPYGLASS_RAW_LOG"

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
