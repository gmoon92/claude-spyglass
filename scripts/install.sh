#!/bin/bash
#
# spyglass One-Liner Installation Script
#
# @description Bun, 저장소, 환경 설정 자동화
# @usage curl -fsSL https://raw.githubusercontent.com/gmoon92/claude-spyglass/main/scripts/install.sh | bash
# @note --dry-run 플래그로 변경 없이 계획만 출력 가능
#
# 보안 주의사항:
# curl | bash 패턴은 중간자 공격 위험이 있습니다.
# 프로덕션 환경에선 다음과 같이 해시를 검증한 후 실행하세요:
#   curl -fsSL https://... -o /tmp/install.sh
#   echo "expected_sha256_hash  /tmp/install.sh" | sha256sum -c -
#   bash /tmp/install.sh

set -euo pipefail

# =============================================================================
# 색상 및 심볼
# =============================================================================

readonly COLOR_GREEN='\033[0;32m'
readonly COLOR_RED='\033[0;31m'
readonly COLOR_YELLOW='\033[0;33m'
readonly COLOR_BLUE='\033[0;34m'
readonly COLOR_RESET='\033[0m'

readonly CHECK='✓'
readonly CROSS='✗'
readonly WARN='⚠'
readonly ARROW='→'

# =============================================================================
# 설정
# =============================================================================

DRY_RUN=${1:-}
SPYGLASS_DIR="${HOME}/.spyglass-src"
SETTINGS_JSON="${HOME}/.claude/settings.json"
SPYGLASS_HOME="${HOME}/.spyglass"
REPO_URL="https://github.com/gmoon92/claude-spyglass.git"

# =============================================================================
# 유틸리티 함수
# =============================================================================

log_success() {
  echo -e "${COLOR_GREEN}${CHECK}${COLOR_RESET} $1"
}

log_error() {
  echo -e "${COLOR_RED}${CROSS}${COLOR_RESET} $1"
}

log_warn() {
  echo -e "${COLOR_YELLOW}${WARN}${COLOR_RESET} $1"
}

log_info() {
  echo -e "${COLOR_BLUE}ℹ${COLOR_RESET} $1"
}

log_step() {
  echo -e "\n${COLOR_BLUE}==>${COLOR_RESET} $1"
}

log_hint() {
  echo -e "  ${ARROW} $1"
}

die() {
  log_error "$1"
  exit 1
}

# =============================================================================
# 단계 1: Bun 감지 및 설치
# =============================================================================

step_detect_bun() {
  log_step "Bun 감지"

  if command -v bun &> /dev/null; then
    local version
    version=$(bun --version)
    log_success "Bun 이미 설치됨: $version"
    return 0
  fi

  log_warn "Bun이 설치되지 않았습니다"
  log_hint "다음을 실행하여 Bun을 설치하세요:"
  log_hint "  curl -fsSL https://bun.sh/install | bash"
  log_hint "그 후 이 스크립트를 다시 실행하세요."

  if [[ -z "$DRY_RUN" ]]; then
    read -p "지금 Bun을 설치하시겠습니까? (y/n) " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Yy]$ ]]; then
      if curl -fsSL https://bun.sh/install | bash; then
        log_success "Bun 설치 완료"
        # 현재 셸에 bun 로드
        export PATH="${HOME}/.bun/bin:${PATH}"
      else
        die "Bun 설치 실패"
      fi
    else
      die "Bun 설치 필수"
    fi
  else
    log_info "[DRY-RUN] Bun 설치 스크립트 실행 (curl -fsSL https://bun.sh/install | bash)"
  fi
}

# =============================================================================
# 단계 2: 저장소 Clone 또는 업데이트
# =============================================================================

step_clone_repo() {
  log_step "저장소 확인"

  if [[ -d "$SPYGLASS_DIR/.git" ]]; then
    log_success "저장소 이미 존재: $SPYGLASS_DIR"
    log_info "최신 버전으로 업데이트 중..."

    if [[ -z "$DRY_RUN" ]]; then
      cd "$SPYGLASS_DIR"
      git pull origin main || {
        log_warn "git pull 실패 (오프라인 또는 네트워크 오류)"
        return 0
      }
      cd - > /dev/null
    else
      log_info "[DRY-RUN] git pull origin main (in $SPYGLASS_DIR)"
    fi
  else
    log_info "저장소 클론 중... ($REPO_URL)"

    if [[ -z "$DRY_RUN" ]]; then
      if git clone "$REPO_URL" "$SPYGLASS_DIR"; then
        log_success "저장소 클론 완료: $SPYGLASS_DIR"
      else
        die "저장소 클론 실패: $REPO_URL"
      fi
    else
      log_info "[DRY-RUN] git clone $REPO_URL $SPYGLASS_DIR"
    fi
  fi
}

# =============================================================================
# 단계 3: bun install
# =============================================================================

step_install_deps() {
  log_step "의존성 설치"

  if [[ -z "$DRY_RUN" ]]; then
    cd "$SPYGLASS_DIR"
    if bun install; then
      log_success "의존성 설치 완료"
    else
      die "bun install 실패"
    fi
    cd - > /dev/null
  else
    log_info "[DRY-RUN] bun install (in $SPYGLASS_DIR)"
  fi
}

# =============================================================================
# 단계 4: settings.json 백업 및 훅 병합
# =============================================================================

step_merge_hooks() {
  log_step "settings.json 훅 설정"

  local backup_file
  backup_file="${SETTINGS_JSON}.bak-$(date +%s)"

  # ~/.claude 디렉토리 생성
  if [[ -z "$DRY_RUN" ]]; then
    mkdir -p "$(dirname "$SETTINGS_JSON")" || die "~/.claude 디렉토리 생성 실패"
  else
    log_info "[DRY-RUN] mkdir -p $(dirname "$SETTINGS_JSON")"
  fi

  # settings.json 존재 여부 확인
  if [[ ! -f "$SETTINGS_JSON" ]]; then
    log_info "settings.json이 없습니다. 신규 생성 중..."

    if [[ -z "$DRY_RUN" ]]; then
      # 최소 설정으로 생성
      cat > "$SETTINGS_JSON" << 'EOF'
{
  "env": {
    "SPYGLASS_DIR": ""
  },
  "hooks": {}
}
EOF
      log_success "settings.json 생성 완료"
    else
      log_info "[DRY-RUN] Create settings.json with empty env.SPYGLASS_DIR"
    fi
  else
    log_success "settings.json 존재: $SETTINGS_JSON"
  fi

  # 기존 hooks 블록 확인
  if [[ -z "$DRY_RUN" ]]; then
    local has_hooks
    has_hooks=$(grep -c '"hooks"' "$SETTINGS_JSON" 2>/dev/null || echo 0)

    if [[ "$has_hooks" -gt 0 ]]; then
      # hooks 블록이 이미 있는 경우
      local non_empty_hooks
      non_empty_hooks=$(jq '.hooks | length' "$SETTINGS_JSON" 2>/dev/null || echo 0)

      if [[ "$non_empty_hooks" -gt 0 ]]; then
        log_warn "이미 hooks가 설정되어 있습니다"
        log_hint "기존 설정을 보존하고, 새로운 훅을 추가하려면 다음 설정 가이드를 참고하세요:"
        log_hint "  $SPYGLASS_DIR/README.md (훅 설정 섹션)"
        return 0
      fi
    fi

    # hooks 블록이 비어있거나 없으면 병합
    log_info "훅 설정 병합 중..."

    # SPYGLASS_DIR을 JSON에 업데이트하고 hooks 병합
    local temp_settings
    temp_settings=$(mktemp)

    jq \
      --arg spyglass_dir "$SPYGLASS_DIR" \
      '.env.SPYGLASS_DIR = $spyglass_dir |
       .hooks |= if . == null or . == {} then {} else . end' \
      "$SETTINGS_JSON" > "$temp_settings"

    # 훅 설정 병합 로직
    # 최소 6개 훅 추가 (권장은 27개이지만, 이 스크립트는 최소만 추가)
    # 기존 settings.json의 hooks에 merge

    local hook_config='{
      "UserPromptSubmit": [{"hooks": [{"type": "command", "command": "bash $SPYGLASS_DIR/hooks/spyglass-collect.sh", "async": true, "timeout": 1}]}],
      "PreToolUse": [{"matcher": "*", "hooks": [{"type": "command", "command": "bash $SPYGLASS_DIR/hooks/spyglass-collect.sh", "async": true, "timeout": 1}]}],
      "PostToolUse": [{"matcher": "*", "hooks": [{"type": "command", "command": "bash $SPYGLASS_DIR/hooks/spyglass-collect.sh", "async": true, "timeout": 1}]}],
      "SessionStart": [{"hooks": [{"type": "command", "command": "bash $SPYGLASS_DIR/hooks/spyglass-collect.sh", "async": true, "timeout": 1}]}],
      "SessionEnd": [{"hooks": [{"type": "command", "command": "bash $SPYGLASS_DIR/hooks/spyglass-collect.sh", "async": true, "timeout": 1}]}],
      "Stop": [{"hooks": [{"type": "command", "command": "bash $SPYGLASS_DIR/hooks/spyglass-collect.sh", "async": true, "timeout": 1}]}]
    }'

    jq \
      --argjson hooks "$hook_config" \
      '.hooks = ($hooks + (.hooks // {}))' \
      "$temp_settings" > "${temp_settings}.merged"

    mv "${temp_settings}.merged" "$temp_settings"

    # 백업 저장
    cp "$SETTINGS_JSON" "$backup_file"
    log_success "백업 저장: $backup_file"

    # 새 설정으로 덮어쓰기
    mv "$temp_settings" "$SETTINGS_JSON"
    log_success "settings.json 업데이트 완료"
  else
    log_info "[DRY-RUN] Backup $SETTINGS_JSON to $backup_file"
    log_info "[DRY-RUN] Merge hooks configuration and update SPYGLASS_DIR"
  fi
}

# =============================================================================
# 단계 5: ~/.spyglass/ 디렉토리 생성
# =============================================================================

step_create_spyglass_home() {
  log_step "~/.spyglass 디렉토리 생성"

  if [[ -z "$DRY_RUN" ]]; then
    mkdir -p "$SPYGLASS_HOME/logs" || die "~/.spyglass/logs 생성 실패"
    mkdir -p "$SPYGLASS_HOME/timing" || die "~/.spyglass/timing 생성 실패"
    chmod 700 "$SPYGLASS_HOME" || die "~/.spyglass chmod 700 실패"
    log_success "디렉토리 생성 및 권한 설정 완료"
  else
    log_info "[DRY-RUN] mkdir -p $SPYGLASS_HOME/logs $SPYGLASS_HOME/timing"
    log_info "[DRY-RUN] chmod 700 $SPYGLASS_HOME"
  fi
}

# =============================================================================
# 단계 6: 완료 메시지
# =============================================================================

step_finish() {
  log_step "설치 완료"

  echo ""
  log_success "spyglass 설치가 완료되었습니다!"
  echo ""

  log_info "다음 단계:"
  echo "  1. Claude Code 재시작 (훅 설정 반영)"
  echo "  2. 서버 실행:"
  echo "     cd $SPYGLASS_DIR"
  echo "     bun run dev"
  echo "  3. 환경 검증:"
  echo "     bun run doctor"
  echo "  4. 대시보드 열기 (서버 실행 중):"
  echo "     open http://localhost:9999"
  echo ""
  log_info "자세한 설정은 다음을 참고하세요:"
  log_hint "$SPYGLASS_DIR/README.md (훅 설정 섹션)"
}

# =============================================================================
# 메인 실행
# =============================================================================

main() {
  if [[ "$DRY_RUN" == "--dry-run" ]]; then
    log_info "=== DRY-RUN MODE ==="
    echo ""
  fi

  step_detect_bun
  step_clone_repo
  step_install_deps
  step_merge_hooks
  step_create_spyglass_home
  step_finish
}

main "$@"
