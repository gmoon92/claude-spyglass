#!/usr/bin/env bash
#
# build-release-tarball.sh — Homebrew 배포용 tarball 빌드.
#
# 책임:
#   1) Bun standalone executable 컴파일 (packages/server → bin/spyglass).
#      - Bun 1.3.12 darwin-arm64 code-sign 버그 우회: BUN_NO_CODESIGN_MACHO_BINARY=1 + ad-hoc codesign.
#   2) 자원 디렉터리 staging (web, storage/migrations).
#   3) tar.gz + .sha256 산출.
#
# 사용:
#   ./scripts/build-release-tarball.sh --version 2.10.0 --arch arm64 [--out-dir dist/release]
#   (기본값: package.json 의 version, 호스트 arch)
#
# 산출:
#   <out-dir>/spyglass-<version>-darwin-<arch>.tar.gz
#   <out-dir>/spyglass-<version>-darwin-<arch>.tar.gz.sha256
#
# 의존성: bun, codesign(macOS), tar, shasum
#
# 호출 흐름:
#   .github/workflows/release.yml      → 본 스크립트 → bun build --compile → codesign → tar → shasum
#   (개발자) 로컬 검증                  → 본 스크립트 → 동일 (--skip-codesign 옵션으로 codesign 생략 가능)

set -euo pipefail

# -----------------------------------------------------------------------------
# 인자 파싱
# -----------------------------------------------------------------------------
VERSION=""
ARCH=""
OUT_DIR="dist/release"
SKIP_CODESIGN=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --version)        VERSION="$2"; shift 2 ;;
    --arch)           ARCH="$2"; shift 2 ;;
    --out-dir)        OUT_DIR="$2"; shift 2 ;;
    --skip-codesign)  SKIP_CODESIGN=1; shift ;;
    -h|--help)
      sed -n '1,30p' "$0"
      exit 0
      ;;
    *)
      echo "Unknown arg: $1" >&2; exit 1 ;;
  esac
done

# -----------------------------------------------------------------------------
# 기본값 결정
# -----------------------------------------------------------------------------
REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"

if [[ -z "$VERSION" ]]; then
  VERSION="$(node -p "require('./package.json').version" 2>/dev/null || bun -e "console.log(require('./package.json').version)")"
fi

if [[ -z "$ARCH" ]]; then
  HOST_ARCH="$(uname -m)"
  case "$HOST_ARCH" in
    arm64|aarch64) ARCH="arm64" ;;
    x86_64)        ARCH="x64"   ;;
    *) echo "Unsupported host arch: $HOST_ARCH" >&2; exit 1 ;;
  esac
fi

BUN_TARGET="bun-darwin-${ARCH}"
TARBALL_NAME="spyglass-${VERSION}-darwin-${ARCH}"
STAGE_DIR="${OUT_DIR}/${TARBALL_NAME}"

echo "[build] version=${VERSION} arch=${ARCH} target=${BUN_TARGET}"
echo "[build] stage=${STAGE_DIR}"

# -----------------------------------------------------------------------------
# 1) 깨끗한 staging 디렉토리
# -----------------------------------------------------------------------------
rm -rf "$STAGE_DIR"
mkdir -p "$STAGE_DIR/bin"
mkdir -p "$STAGE_DIR/share/spyglass"

# -----------------------------------------------------------------------------
# 2) standalone bin 컴파일
#    Bun 1.3.12 darwin-arm64 sig_size 잘림 버그 우회.
#    - BUN_NO_CODESIGN_MACHO_BINARY=1 로 codesign 없이 컴파일
#    - 직후 ad-hoc codesign --sign - 재서명
# -----------------------------------------------------------------------------
echo "[build] compiling standalone bin (Bun)..."
BUN_NO_CODESIGN_MACHO_BINARY=1 bun build \
  --compile \
  --minify \
  --target="$BUN_TARGET" \
  packages/server/src/index.ts \
  --outfile "$STAGE_DIR/bin/spyglass"

if [[ "$SKIP_CODESIGN" -eq 0 ]]; then
  echo "[build] ad-hoc codesign..."
  codesign --sign - --force --options runtime "$STAGE_DIR/bin/spyglass"
  codesign -dv "$STAGE_DIR/bin/spyglass" 2>&1 | sed 's/^/[build]   /'
fi

# 실행 권한 보장 (Bun build 가 이미 +x 주지만 확실히)
chmod +x "$STAGE_DIR/bin/spyglass"

# -----------------------------------------------------------------------------
# 3) 자원 staging
#    - web:        __tests__, *.test.ts 제외 모든 파일
#    - migrations: *.sql 만
# -----------------------------------------------------------------------------
echo "[build] staging web/..."
# rsync 는 macOS 기본 탑재. exclude 규칙 단순.
rsync -a \
  --exclude='__tests__' \
  --exclude='*.test.ts' \
  --exclude='*.md' \
  --exclude='prototypes' \
  packages/web/ "$STAGE_DIR/share/spyglass/web/"

echo "[build] staging migrations/..."
mkdir -p "$STAGE_DIR/share/spyglass/migrations"
cp packages/storage/migrations/*.sql "$STAGE_DIR/share/spyglass/migrations/"

# LICENSE 가 있으면 동봉
if [[ -f LICENSE ]]; then
  cp LICENSE "$STAGE_DIR/LICENSE"
fi

# -----------------------------------------------------------------------------
# 4) tar.gz + sha256
# -----------------------------------------------------------------------------
echo "[build] packing tarball..."
tar -czf "${OUT_DIR}/${TARBALL_NAME}.tar.gz" -C "${OUT_DIR}" "${TARBALL_NAME}"

# BSD shasum (macOS) 와 GNU shasum 모두 같은 출력 형식
SHA256_HEX="$(shasum -a 256 "${OUT_DIR}/${TARBALL_NAME}.tar.gz" | awk '{print $1}')"
echo "${SHA256_HEX}  ${TARBALL_NAME}.tar.gz" > "${OUT_DIR}/${TARBALL_NAME}.tar.gz.sha256"

# -----------------------------------------------------------------------------
# 5) 최종 요약
# -----------------------------------------------------------------------------
TARBALL_SIZE="$(du -h "${OUT_DIR}/${TARBALL_NAME}.tar.gz" | awk '{print $1}')"
BIN_SIZE="$(du -h "${STAGE_DIR}/bin/spyglass" | awk '{print $1}')"
echo ""
echo "[build] DONE"
echo "[build]   tarball : ${OUT_DIR}/${TARBALL_NAME}.tar.gz (${TARBALL_SIZE})"
echo "[build]   sha256  : ${SHA256_HEX}"
echo "[build]   bin size: ${BIN_SIZE}"
echo "[build]   sha-file: ${OUT_DIR}/${TARBALL_NAME}.tar.gz.sha256"
