#!/usr/bin/env bash
#
# claude-spyglass Docker 이미지 빌드 및 tar 배포 패키지 생성
#
# 사용법:
#   bash scripts/build-image.sh [version]
#
# 출력:
#   dist/spyglass-v<version>-<short-hash>.tar.gz        — 배포용 이미지 파일
#   dist/spyglass-v<version>-<short-hash>.tar.gz.sha256  — SHA-256 검증 해시
#

set -euo pipefail

# =============================================================================
# 설정
# =============================================================================

readonly SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
readonly PROJECT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
readonly DIST_DIR="${PROJECT_ROOT}/dist"

# 색상
readonly C_GREEN='\033[0;32m'
readonly C_BLUE='\033[0;34m'
readonly C_YELLOW='\033[0;33m'
readonly C_RED='\033[0;31m'
readonly C_RESET='\033[0m'

log_info()   { echo -e "${C_BLUE}==>${C_RESET} $*"; }
log_ok()     { echo -e "${C_GREEN}✓${C_RESET}  $*"; }
log_warn()   { echo -e "${C_YELLOW}⚠${C_RESET}  $*"; }
log_error()  { echo -e "${C_RED}✗${C_RESET}  $*" >&2; }

# =============================================================================
# 사전 검증
# =============================================================================

if ! command -v docker >/dev/null 2>&1; then
  log_error "docker가 설치되어 있지 않습니다."
  exit 1
fi

cd "${PROJECT_ROOT}"

# 버전 결정 — 인자 > package.json > "0.0.0"
if [[ $# -ge 1 ]]; then
  VERSION="$1"
else
  VERSION="$(node -p "require('./package.json').version" 2>/dev/null || echo "0.0.0")"
fi

# Git 해시 (선택)
if git rev-parse --short HEAD >/dev/null 2>&1; then
  GIT_HASH="$(git rev-parse --short HEAD)"
else
  GIT_HASH="dev"
fi

readonly TAG_VERSIONED="spyglass:v${VERSION}-${GIT_HASH}"
readonly TAG_LATEST="spyglass:latest"
readonly OUTPUT_BASENAME="spyglass-v${VERSION}-${GIT_HASH}.tar.gz"
readonly OUTPUT_PATH="${DIST_DIR}/${OUTPUT_BASENAME}"
readonly CHECKSUM_PATH="${OUTPUT_PATH}.sha256"

mkdir -p "${DIST_DIR}"

# =============================================================================
# 빌드
# =============================================================================

log_info "Docker 이미지 빌드 중"
log_info "  버전: v${VERSION}"
log_info "  해시: ${GIT_HASH}"
log_info "  태그: ${TAG_VERSIONED}, ${TAG_LATEST}"

docker build \
  --tag "${TAG_VERSIONED}" \
  --tag "${TAG_LATEST}" \
  "${PROJECT_ROOT}"

log_ok "이미지 빌드 완료"

# =============================================================================
# tar.gz로 저장
# =============================================================================

log_info "이미지를 tar.gz로 저장 중..."
docker save "${TAG_VERSIONED}" | gzip -9 > "${OUTPUT_PATH}"

FILE_SIZE_HUMAN="$(du -h "${OUTPUT_PATH}" | cut -f1)"
log_ok "저장 완료: ${OUTPUT_PATH} (${FILE_SIZE_HUMAN})"

# =============================================================================
# SHA-256 해시 생성
# =============================================================================

log_info "SHA-256 해시 생성 중..."

if command -v sha256sum >/dev/null 2>&1; then
  (cd "${DIST_DIR}" && sha256sum "${OUTPUT_BASENAME}" > "${CHECKSUM_PATH}")
elif command -v shasum >/dev/null 2>&1; then
  (cd "${DIST_DIR}" && shasum -a 256 "${OUTPUT_BASENAME}" > "${CHECKSUM_PATH}")
else
  log_warn "sha256sum/shasum 미설치 — 해시 생성 건너뜀"
  CHECKSUM_PATH=""
fi

if [[ -n "${CHECKSUM_PATH}" && -f "${CHECKSUM_PATH}" ]]; then
  log_ok "해시: $(cat "${CHECKSUM_PATH}")"
fi

# =============================================================================
# 요약
# =============================================================================

echo
log_ok "빌드 완료!"
echo
echo "  이미지:      ${TAG_VERSIONED}"
echo "  tarball:    ${OUTPUT_PATH}"
[[ -n "${CHECKSUM_PATH}" ]] && echo "  SHA-256:    ${CHECKSUM_PATH}"
echo "  크기:        ${FILE_SIZE_HUMAN}"
echo
echo "수신자 사용법:"
echo "  docker load < ${OUTPUT_BASENAME}"
echo "  docker run -d --name spyglass \\"
echo "    -p 9999:9999 \\"
echo "    -v \"\${HOME}/.spyglass:/data/.spyglass\" \\"
echo "    ${TAG_VERSIONED}"
echo
