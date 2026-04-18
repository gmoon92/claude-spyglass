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
# 토큰 파싱 함수
# =============================================================================

# JSON에서 값 추출 (간단한 파싱)
json_get() {
    local json="$1"
    local key="$2"
    # 정규식으로 "key": value 또는 "key": "value" 추출
    echo "$json" | grep -oE "\"$key\"\s*:\s*(\"[^\"]*\"|[0-9]+|true|false|null)" | cut -d: -f2- | sed 's/^\s*"//;s/"$//'
}

# transcript JSONL에서 마지막 assistant 메시지의 usage 추출
# 출력: "input_tokens,output_tokens,cache_creation_tokens,cache_read_tokens"
# Claude Code 소스 확인 결과: CLAUDE_API_USAGE_* 환경변수는 존재하지 않음.
# transcript_path의 JSONL 파일이 유일한 신뢰 가능한 토큰 데이터 소스.
extract_usage_from_transcript() {
    local transcript_path="$1"
    if [[ -z "$transcript_path" || ! -f "$transcript_path" ]]; then
        echo "0,0,0,0"
        return
    fi

    local result
    result=$(grep '"type":"assistant"' "$transcript_path" 2>/dev/null | tail -1 \
      | python3 -c "
import sys, json
try:
    d = json.loads(sys.stdin.read())
    u = d.get('message', {}).get('usage', {})
    print('{},{},{},{}'.format(
        u.get('input_tokens', 0),
        u.get('output_tokens', 0),
        u.get('cache_creation_input_tokens', 0),
        u.get('cache_read_input_tokens', 0)
    ))
except:
    print('0,0,0,0')
" 2>/dev/null || echo "0,0,0,0")

    echo "${result:-0,0,0,0}"
}

# =============================================================================
# 요청 타입 분류
# =============================================================================

classify_request_type() {
    local event_type="$1"
    local payload="$2"

    # 이벤트 타입 기반 분류 (Claude Code hook_event_name 기준)
    case "$event_type" in
        pre_tool|tool|tool_failure)
            echo "tool_call"
            return
            ;;
        prompt|session_start|session_end|stop|permission_request|permission_denied)
            echo "prompt"
            return
            ;;
    esac

    # Payload 기반 fallback 분류
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

# raw hook payload를 /events로 전송 (기존 가공 파이프라인 미사용 이벤트용)
send_raw_event() {
    local payload="$1"
    ensure_log_dir
    # 로그 파일에 기록 (데이터 구조 파악 및 fallback용)
    echo "$payload" >> "$SPYGLASS_RAW_LOG"
    send_to_spyglass "$payload" "$SPYGLASS_EVENTS_ENDPOINT"
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
    request_type=$(classify_request_type "$event_type" "$payload")

    # 툴/모델 정보 추출
    local raw_tool_name=""
    local raw_tool_detail=""
    local raw_model=""

    if [[ "$request_type" == "tool_call" ]]; then
        raw_tool_name=$(extract_tool_name "$payload")
        raw_tool_detail=$(extract_tool_detail "$raw_tool_name" "$payload")
    elif [[ "$request_type" == "prompt" ]]; then
        raw_model=$(extract_model "$payload")
    fi

    # 토큰 정보 — transcript_path JSONL에서 마지막 assistant 메시지 usage 추출
    local tokens_input=0
    local tokens_output=0
    local tokens_total=0
    local cache_creation_tokens=0
    local cache_read_tokens=0

    local transcript_path
    transcript_path=$(echo "$payload" | python3 -c "
import sys, json
try:
    d = json.loads(sys.stdin.read())
    print(d.get('transcript_path', ''))
except:
    print('')
" 2>/dev/null || echo "")

    if [[ -n "$transcript_path" && -f "$transcript_path" ]]; then
        local usage
        usage=$(extract_usage_from_transcript "$transcript_path")
        tokens_input=$(echo "$usage"         | cut -d',' -f1)
        tokens_output=$(echo "$usage"        | cut -d',' -f2)
        cache_creation_tokens=$(echo "$usage" | cut -d',' -f3)
        cache_read_tokens=$(echo "$usage"     | cut -d',' -f4)
    fi

    # transcript에서 input_tokens를 얻지 못한 경우 payload 길이 기반 추정 (fallback)
    if [[ "$tokens_input" -eq 0 ]]; then
        local payload_length=${#payload}
        tokens_input=$((payload_length / 4))
    fi
    tokens_total=$((tokens_input + tokens_output))

    # duration_ms — 이벤트 타입별 타이밍 측정
    local duration_ms=0
    local timing_dir="${HOME}/.spyglass/timing"
    local timing_file="${timing_dir}/${session_id}"

    case "$event_type" in
        pre_tool)
            # PreToolUse: 시작 타임스탬프 저장
            mkdir -p "$timing_dir"
            echo "$timestamp" > "$timing_file"
            ;;
        tool|tool_failure)
            # PostToolUse/PostToolUseFailure: 경과 시간 계산 후 파일 삭제
            if [[ -f "$timing_file" ]]; then
                local start_ts
                start_ts=$(cat "$timing_file")
                duration_ms=$((timestamp - start_ts))
                rm -f "$timing_file"
            fi
            ;;
        session_start)
            # 세션 시작: 세션 타이밍 파일 생성
            mkdir -p "$timing_dir"
            echo "$timestamp" > "${timing_file}.session"
            ;;
        session_end)
            # 세션 종료: 세션 지속 시간 계산
            if [[ -f "${timing_file}.session" ]]; then
                local session_start_ts
                session_start_ts=$(cat "${timing_file}.session")
                duration_ms=$((timestamp - session_start_ts))
                rm -f "${timing_file}.session"
            fi
            ;;
    esac

    # JSON 데이터 구성 (jq --arg 로 특수문자 안전 이스케이프)
    local json_data
    json_data=$(jq -n \
        --arg     id             "$request_id" \
        --arg     session_id     "$session_id" \
        --arg     project_name   "$project_name" \
        --argjson timestamp      "$timestamp" \
        --arg     event_type     "$event_type" \
        --arg     request_type   "$request_type" \
        --arg     tool_name      "$raw_tool_name" \
        --arg     tool_detail    "$raw_tool_detail" \
        --arg     model          "$raw_model" \
        --argjson tokens_input   "$tokens_input" \
        --argjson tokens_output  "$tokens_output" \
        --argjson tokens_total   "$tokens_total" \
        --argjson cache_creation "$cache_creation_tokens" \
        --argjson cache_read     "$cache_read_tokens" \
        --argjson duration_ms    "$duration_ms" \
        --arg     payload_str    "$payload" \
        '{
            id:                    $id,
            session_id:            $session_id,
            project_name:          $project_name,
            timestamp:             $timestamp,
            event_type:            $event_type,
            request_type:          $request_type,
            tool_name:             (if $tool_name   != "" then $tool_name   else null end),
            tool_detail:           (if $tool_detail != "" then $tool_detail else null end),
            model:                 (if $model       != "" then $model       else null end),
            tokens_input:          $tokens_input,
            tokens_output:         $tokens_output,
            tokens_total:          $tokens_total,
            cache_creation_tokens: $cache_creation,
            cache_read_tokens:     $cache_read,
            duration_ms:           $duration_ms,
            payload:               $payload_str,
            source:                "claude-code-hook"
        }' 2>/dev/null)

    if [[ -z "$json_data" ]]; then
        error "JSON 빌드 실패: event=$event_type session=$session_id"
        exit 0
    fi

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

    # hook_event_name 필드로 Claude Code 와일드카드 훅 여부 판별
    hook_event=$(python3 -c "
import sys, json
try:
    d = json.loads(sys.stdin.read())
    print(d.get('hook_event_name', ''))
except:
    print('')
" 2>/dev/null <<< "$payload" || echo "")

    case "$hook_event" in
      "UserPromptSubmit")
        # 기존 가공 파이프라인: 프롬프트 처리
        main "prompt" "$payload"
        ;;
      "PostToolUse")
        # 기존 가공 파이프라인: 도구 결과 처리
        main "tool" "$payload"
        ;;
      "")
        # hook_event_name 없음: 레거시 인수 방식 (기존 개별 이벤트 훅)
        main "$@" "$payload"
        ;;
      *)
        # 그 외 모든 이벤트: raw payload를 /events로 전송
        send_raw_event "$payload"
        ;;
    esac
else
    main "$@"
fi
