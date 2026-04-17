#!/bin/bash
#
# spyglass-collect.sh
#
# @description Claude Code 훅에서 호출되는 데이터 수집 스크립트
# @usage spyglass-collect.sh [prompt|tool|response] <json_payload>
#

set -euo pipefail

# =============================================================================
# 설정
# =============================================================================

SPYGLASS_HOST="${SPYGLASS_HOST:-localhost}"
SPYGLASS_PORT="${SPYGLASS_PORT:-9999}"
SPYGLASS_ENDPOINT="http://${SPYGLASS_HOST}:${SPYGLASS_PORT}/collect"
SPYGLASS_TIMEOUT="${SPYGLASS_TIMEOUT:-1}"

# 로그 설정
SPYGLASS_LOG_DIR="${HOME}/.spyglass/logs"
SPYGLASS_LOG_FILE="${SPYGLASS_LOG_DIR}/collect.log"

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
# 토큰 파싱 함수
# =============================================================================

# JSON에서 값 추출 (간단한 파싱)
json_get() {
    local json="$1"
    local key="$2"
    # 정규식으로 "key": value 또는 "key": "value" 추출
    echo "$json" | grep -oE "\"$key\"\s*:\s*(\"[^\"]*\"|[0-9]+|true|false|null)" | cut -d: -f2- | sed 's/^\s*"//;s/"$//'
}

# 입력/출력 토큰 추출 (API 응답에서)
parse_tokens_from_response() {
    local response="$1"
    local input_tokens=$(echo "$response" | grep -oE '"input_tokens"\s*:\s*[0-9]+' | grep -oE '[0-9]+' || echo "0")
    local output_tokens=$(echo "$response" | grep -oE '"output_tokens"\s*:\s*[0-9]+' | grep -oE '[0-9]+' || echo "0")

    if [[ -z "$input_tokens" ]]; then input_tokens="0"; fi
    if [[ -z "$output_tokens" ]]; then output_tokens="0"; fi

    echo "${input_tokens:-0},${output_tokens:-0}"
}

# =============================================================================
# 요청 타입 분류
# =============================================================================

classify_request_type() {
    local payload="$1"

    # Claude Code PostToolUse hook: "tool_name" 필드 존재
    if echo "$payload" | grep -qE '"tool_name"\s*:\s*"[^"]+"'; then
        echo "tool_call"
        return
    fi

    # 기존 API 형식 툴 콜 확인
    if echo "$payload" | grep -qE '"type"\s*:\s*"(tool_use|tool_call|function)"' || \
       echo "$payload" | grep -qE '"tool_calls"'; then
        echo "tool_call"
        return
    fi

    # 시스템 메시지 확인
    if echo "$payload" | grep -qE '"role"\s*:\s*"system"'; then
        echo "system"
        return
    fi

    echo "prompt"
}

# 툴 이름 추출 (Claude Code hook의 "tool_name" 필드 우선)
extract_tool_name() {
    local payload="$1"
    local tool_name
    # Claude Code PostToolUse: "tool_name": "Bash"
    tool_name=$(echo "$payload" | grep -oE '"tool_name"\s*:\s*"[^"]+"' | head -1 | cut -d'"' -f4)
    if [[ -z "$tool_name" ]]; then
        tool_name=$(echo "$payload" | grep -oE '"name"\s*:\s*"[^"]+"' | head -1 | cut -d'"' -f4)
    fi
    echo "${tool_name:-unknown}"
}

# Skill 이름 추출 (tool_input.skill)
extract_skill_name() {
    local payload="$1"
    echo "$payload" | grep -oE '"skill"\s*:\s*"[^"]+"' | head -1 | cut -d'"' -f4
}

# Agent 타입 추출 (tool_input.subagent_type)
extract_subagent_type() {
    local payload="$1"
    echo "$payload" | grep -oE '"subagent_type"\s*:\s*"[^"]+"' | head -1 | cut -d'"' -f4
}

# 툴별 tool_detail 추출 (tool_name + tool_input JSON 기반)
# Claude Code PostToolUse hook: payload에 "tool_name"과 "tool_input" 필드가 있음
extract_tool_detail() {
    local tool_name="$1"
    local payload="$2"

    # tool_input 오브젝트를 JSON으로 추출 (python3 우선, fallback: grep)
    local tool_input
    tool_input=$(python3 -c "
import sys, json, re
try:
    data = json.loads(sys.stdin.read())
    ti = data.get('tool_input', {})
    print(json.dumps(ti))
except:
    print('{}')
" 2>/dev/null <<< "$payload" || echo '{}')

    local detail=""

    case "$tool_name" in
        Read)
            # file_path 추출
            detail=$(python3 -c "
import sys, json
try:
    d = json.loads(sys.stdin.read())
    print(d.get('file_path', ''))
except:
    print('')
" 2>/dev/null <<< "$tool_input" || echo "")
            ;;
        Bash)
            # command 앞 80자 추출
            detail=$(python3 -c "
import sys, json
try:
    d = json.loads(sys.stdin.read())
    cmd = d.get('command', '')
    print(cmd[:80])
except:
    print('')
" 2>/dev/null <<< "$tool_input" || echo "")
            ;;
        Edit|MultiEdit)
            # file_path 추출
            detail=$(python3 -c "
import sys, json
try:
    d = json.loads(sys.stdin.read())
    print(d.get('file_path', ''))
except:
    print('')
" 2>/dev/null <<< "$tool_input" || echo "")
            ;;
        Write)
            # file_path 추출
            detail=$(python3 -c "
import sys, json
try:
    d = json.loads(sys.stdin.read())
    print(d.get('file_path', ''))
except:
    print('')
" 2>/dev/null <<< "$tool_input" || echo "")
            ;;
        Glob)
            # pattern 추출 (path가 있으면 "pattern in path" 형태로)
            detail=$(python3 -c "
import sys, json
try:
    d = json.loads(sys.stdin.read())
    pattern = d.get('pattern', '')
    path = d.get('path', '')
    if path:
        print(f'{pattern} in {path}')
    else:
        print(pattern)
except:
    print('')
" 2>/dev/null <<< "$tool_input" || echo "")
            ;;
        Grep)
            # pattern + path 추출
            detail=$(python3 -c "
import sys, json
try:
    d = json.loads(sys.stdin.read())
    pattern = d.get('pattern', '')
    path = d.get('path', '')
    if path:
        print(f'{pattern} in {path}')
    else:
        print(pattern)
except:
    print('')
" 2>/dev/null <<< "$tool_input" || echo "")
            ;;
        Skill)
            detail=$(extract_skill_name "$payload")
            ;;
        Agent)
            detail=$(extract_subagent_type "$payload")
            ;;
        TodoRead|TodoWrite)
            # 특별한 detail 없음 — tool_name 자체가 충분
            detail=""
            ;;
        WebFetch|WebSearch)
            # url 또는 query 추출
            detail=$(python3 -c "
import sys, json
try:
    d = json.loads(sys.stdin.read())
    print(d.get('url', '') or d.get('query', ''))
except:
    print('')
" 2>/dev/null <<< "$tool_input" || echo "")
            ;;
        *)
            detail=""
            ;;
    esac

    echo "$detail"
}

# 모델명 추출
extract_model() {
    local payload="$1"
    local model=$(echo "$payload" | grep -oE '"model"\s*:\s*"[^"]+"' | head -1 | cut -d'"' -f4)
    echo "${model:-claude-sonnet}"
}

# =============================================================================
# 데이터 전송
# =============================================================================

send_to_spyglass() {
    local json_data="$1"

    # 비동기로 전송 (백그라운드)
    (
        local response
        local http_code

        response=$(curl -s -w "\n%{http_code}" \
            -X POST \
            -H "Content-Type: application/json" \
            -d "$json_data" \
            --max-time "$SPYGLASS_TIMEOUT" \
            "$SPYGLASS_ENDPOINT" 2>/dev/null || echo -e "\n000")

        http_code=$(echo "$response" | tail -1)

        if [[ "$http_code" != "200" && "$http_code" != "201" && "$http_code" != "000" ]]; then
            error "Failed to send data: HTTP $http_code"
        fi
    ) &

    # 백그라운드 프로세스 ID 저장 (필요시 wait으로 대기)
    echo $!
}

# =============================================================================
# 메인 처리
# =============================================================================

main() {
    local event_type="${1:-unknown}"
    local payload="${2:-{}}"

    # 프로젝트명 확인 (환경변수 또는 현재 디렉토리)
    local project_name="${SPYGLASS_PROJECT:-$(basename "$(pwd)")}"
    # session_id: 환경변수 → payload JSON의 session_id 필드 → fallback
    local session_id="${SPYGLASS_SESSION_ID:-}"
    if [[ -z "$session_id" ]]; then
        session_id=$(echo "$payload" | grep -oE '"session_id"\s*:\s*"[^"]+"' | head -1 | cut -d'"' -f4)
    fi
    session_id="${session_id:-unknown}"
    local timestamp
    timestamp=$(python3 -c 'import time; print(int(time.time() * 1000))' 2>/dev/null || echo "$(( $(date +%s) * 1000 ))")

    # 요청 ID 생성
    local request_id="${event_type:0:1}-${timestamp}-${RANDOM}"

    # 타입 분류
    local request_type
    request_type=$(classify_request_type "$payload")

    # 툴/모델 정보 추출
    local tool_name="null"
    local tool_detail="null"
    local model="null"
    local raw_tool_name=""
    local raw_tool_detail=""

    if [[ "$request_type" == "tool_call" ]]; then
        raw_tool_name=$(extract_tool_name "$payload")
        tool_name="\"$raw_tool_name\""
        raw_tool_detail=$(extract_tool_detail "$raw_tool_name" "$payload")
        if [[ -n "$raw_tool_detail" ]]; then
            tool_detail="\"$raw_tool_detail\""
        fi
    elif [[ "$request_type" == "prompt" ]]; then
        model="\"$(extract_model "$payload")\""
    fi

    # 토큰 정보 — payload에서 직접 추출
    local tokens_input=0
    local tokens_output=0
    local tokens_total=0

    local token_pair
    token_pair=$(parse_tokens_from_response "$payload")
    tokens_input=$(echo "$token_pair" | cut -d',' -f1)
    tokens_output=$(echo "$token_pair" | cut -d',' -f2)

    # 토큰이 0이면 payload 길이 기반 추정 (input만)
    if [[ "$tokens_input" -eq 0 ]]; then
        local payload_length=${#payload}
        tokens_input=$((payload_length / 4))
    fi
    tokens_total=$((tokens_input + tokens_output))

    # duration_ms — PreToolUse가 기록한 타임스탬프 파일로 측정
    local duration_ms=0
    local timing_dir="${HOME}/.spyglass/timing"
    local timing_file="${timing_dir}/${session_id}"

    if [[ "$event_type" == "prompt" ]]; then
        # PreToolUse: 시작 타임스탬프 저장
        mkdir -p "$timing_dir"
        echo "$timestamp" > "$timing_file"
    elif [[ "$event_type" == "tool" && -f "$timing_file" ]]; then
        # PostToolUse: 경과 시간 계산 후 파일 삭제
        local start_ts
        start_ts=$(cat "$timing_file")
        duration_ms=$((timestamp - start_ts))
        rm -f "$timing_file"
    fi

    # JSON 데이터 구성
    local json_data
    json_data=$(cat <<EOF
{
  "id": "$request_id",
  "session_id": "$session_id",
  "project_name": "$project_name",
  "timestamp": $timestamp,
  "event_type": "$event_type",
  "request_type": "$request_type",
  "tool_name": $tool_name,
  "tool_detail": $tool_detail,
  "model": $model,
  "tokens_input": $tokens_input,
  "tokens_output": $tokens_output,
  "tokens_total": $tokens_total,
  "duration_ms": $duration_ms,
  "payload": $(echo "$payload" | jq -R -s '.' 2>/dev/null || echo '""'),
  "source": "claude-code-hook"
}
EOF
)

    # 로그 기록 (툴 상세 포함)
    local log_tool_detail=""
    if [[ "$request_type" == "tool_call" ]]; then
        if [[ -n "$raw_tool_detail" ]]; then
            log_tool_detail=", Tool: ${raw_tool_name}(${raw_tool_detail})"
        else
            log_tool_detail=", Tool: $raw_tool_name"
        fi
    fi
    info "Event: $event_type, Type: $request_type${log_tool_detail}, Project: $project_name"

    # spyglass 서버로 전송
    send_to_spyglass "$json_data"

    # 즉시 반환 (비동기)
    exit 0
}

# =============================================================================
# 테스트 모드
# =============================================================================

if [[ "${1:-}" == "test" ]]; then
    echo "Running spyglass-collect.sh tests..."

    # 테스트: JSON 파싱
    test_json='{"name": "Read", "input_tokens": 100, "output_tokens": 50}'
    result=$(json_get "$test_json" "name")
    if [[ "$result" == "Read" ]]; then
        echo "✓ json_get test passed"
    else
        echo "✗ json_get test failed: got '$result'"
        exit 1
    fi

    # 테스트: 타입 분류
    tool_payload='{"type": "tool_use", "name": "Bash"}'
    result=$(classify_request_type "$tool_payload")
    if [[ "$result" == "tool_call" ]]; then
        echo "✓ classify_request_type (tool) test passed"
    else
        echo "✗ classify_request_type (tool) test failed: got '$result'"
        exit 1
    fi

    prompt_payload='{"role": "user", "content": "hello"}'
    result=$(classify_request_type "$prompt_payload")
    if [[ "$result" == "prompt" ]]; then
        echo "✓ classify_request_type (prompt) test passed"
    else
        echo "✗ classify_request_type (prompt) test failed: got '$result'"
        exit 1
    fi

    echo "All tests passed!"
    exit 0
fi

# =============================================================================
# 실행
# =============================================================================

# stdin에서 payload 읽기 (훅에서 전달)
# -p /dev/stdin 은 macOS에서 신뢰할 수 없으므로 TTY 체크 사용
if [[ ! -t 0 ]]; then
    payload=$(cat)
    main "$@" "$payload"
else
    main "$@"
fi
