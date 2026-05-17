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
  log_step "Detecting Bun"

  if command -v bun &> /dev/null; then
    local version
    version=$(bun --version)
    log_success "Bun already installed: $version"
    return 0
  fi

  log_warn "Bun is not installed"
  log_hint "Install Bun by running:"
  log_hint "  curl -fsSL https://bun.sh/install | bash"
  log_hint "Then re-run this script."

  if [[ -z "$DRY_RUN" ]]; then
    read -p "Install Bun now? (y/n) " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Yy]$ ]]; then
      if curl -fsSL https://bun.sh/install | bash; then
        log_success "Bun installation complete"
        # 현재 셸에 bun 로드
        export PATH="${HOME}/.bun/bin:${PATH}"
      else
        die "Bun installation failed"
      fi
    else
      die "Bun is required"
    fi
  else
    log_info "[DRY-RUN] Run Bun install script (curl -fsSL https://bun.sh/install | bash)"
  fi
}

# =============================================================================
# 단계 2: 저장소 Clone 또는 업데이트
# =============================================================================

step_clone_repo() {
  log_step "Checking repository"

  if [[ -d "$SPYGLASS_DIR/.git" ]]; then
    log_success "Repository already exists: $SPYGLASS_DIR"
    log_info "Updating to latest version..."

    if [[ -z "$DRY_RUN" ]]; then
      cd "$SPYGLASS_DIR"
      git pull origin main || {
        log_warn "git pull failed (offline or network error)"
        return 0
      }
      cd - > /dev/null
    else
      log_info "[DRY-RUN] git pull origin main (in $SPYGLASS_DIR)"
    fi
  else
    log_info "Cloning repository... ($REPO_URL)"

    if [[ -z "$DRY_RUN" ]]; then
      if git clone "$REPO_URL" "$SPYGLASS_DIR"; then
        log_success "Repository cloned: $SPYGLASS_DIR"
      else
        die "Repository clone failed: $REPO_URL"
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
  log_step "Installing dependencies"

  if [[ -z "$DRY_RUN" ]]; then
    cd "$SPYGLASS_DIR"
    if bun install; then
      log_success "Dependencies installed"
    else
      die "bun install failed"
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
  log_step "Configuring settings.json hooks"

  local backup_file
  backup_file="${SETTINGS_JSON}.bak-$(date +%s)"

  # ~/.claude 디렉토리 생성
  if [[ -z "$DRY_RUN" ]]; then
    mkdir -p "$(dirname "$SETTINGS_JSON")" || die "Failed to create ~/.claude directory"
  else
    log_info "[DRY-RUN] mkdir -p $(dirname "$SETTINGS_JSON")"
  fi

  # settings.json 존재 여부 확인
  if [[ ! -f "$SETTINGS_JSON" ]]; then
    log_info "settings.json not found. Creating a new one..."

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
      log_success "settings.json created"
    else
      log_info "[DRY-RUN] Create settings.json with empty env.SPYGLASS_DIR"
    fi
  else
    log_success "settings.json found: $SETTINGS_JSON"
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
        log_warn "Hooks are already configured"
        log_hint "To preserve existing settings and add new hooks, see the configuration guide:"
        log_hint "  $SPYGLASS_DIR/README.md (Hooks section)"
        return 0
      fi
    fi

    # hooks 블록이 비어있거나 없으면 병합
    log_info "Merging hook configuration..."

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
    log_success "Backup saved: $backup_file"

    # 새 설정으로 덮어쓰기
    mv "$temp_settings" "$SETTINGS_JSON"
    log_success "settings.json updated"
  else
    log_info "[DRY-RUN] Backup $SETTINGS_JSON to $backup_file"
    log_info "[DRY-RUN] Merge hooks configuration and update SPYGLASS_DIR"
  fi
}

# =============================================================================
# 단계 5: ~/.spyglass/ 디렉토리 생성
# =============================================================================

step_create_spyglass_home() {
  log_step "Creating ~/.spyglass directory"

  if [[ -z "$DRY_RUN" ]]; then
    mkdir -p "$SPYGLASS_HOME/logs" || die "Failed to create ~/.spyglass/logs"
    mkdir -p "$SPYGLASS_HOME/timing" || die "Failed to create ~/.spyglass/timing"
    chmod 700 "$SPYGLASS_HOME" || die "Failed to chmod 700 ~/.spyglass"
    log_success "Directories created and permissions set"
  else
    log_info "[DRY-RUN] mkdir -p $SPYGLASS_HOME/logs $SPYGLASS_HOME/timing"
    log_info "[DRY-RUN] chmod 700 $SPYGLASS_HOME"
  fi
}

# =============================================================================
# 단계 6: 완료 메시지
# =============================================================================

step_finish() {
  log_step "Installation complete"

  echo ""
  log_success "spyglass installation complete!"
  echo ""

  log_info "Next steps:"
  echo "  1. Restart Claude Code (to apply hook configuration)"
  echo "  2. Run the server:"
  echo "     cd $SPYGLASS_DIR"
  echo "     bun run dev"
  echo "  3. Verify environment:"
  echo "     bun run doctor"
  echo "  4. Open dashboard (while server is running):"
  echo "     open http://localhost:9999"
  echo ""
  log_info "For detailed configuration, see:"
  log_hint "$SPYGLASS_DIR/README.md (Hooks section)"
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
