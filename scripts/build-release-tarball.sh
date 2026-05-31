#!/usr/bin/env bash
#
# build-release-tarball.sh — Homebrew/멀티플랫폼 배포용 아카이브 빌드.
#
# 책임:
#   1) Bun standalone executable 컴파일 (packages/server → bin/spyglass[.exe]).
#      - Bun 1.3.12 darwin-arm64 code-sign 버그 우회: BUN_NO_CODESIGN_MACHO_BINARY=1 + ad-hoc codesign.
#   2) 자원 디렉터리 staging (web, storage/migrations).
#   3) 아카이브(tar.gz 또는 windows .zip) + .sha256 산출.
#
# 사용:
#   ./scripts/build-release-tarball.sh --version 3.0.7 --arch arm64 [--os darwin] [--out-dir dist/release]
#   (기본값: package.json 의 version, 호스트 arch, os=darwin)
#
#   멀티플랫폼 예시:
#     --os darwin  --arch arm64   → spyglass-<v>-darwin-arm64.tar.gz   (codesign O)
#     --os darwin  --arch x64     → spyglass-<v>-darwin-x64.tar.gz     (codesign O)
#     --os linux   --arch x64     → spyglass-<v>-linux-x64.tar.gz      (codesign X)
#     --os linux   --arch arm64   → spyglass-<v>-linux-arm64.tar.gz    (codesign X)
#     --os windows --arch x64     → spyglass-<v>-windows-x64.zip       (codesign X, bin=spyglass.exe)
#
# 산출:
#   <out-dir>/spyglass-<version>-<os>-<arch>.<tar.gz|zip>
#   <out-dir>/spyglass-<version>-<os>-<arch>.<tar.gz|zip>.sha256
#
# 의존성: bun, codesign(macOS darwin 만), tar(darwin/linux), zip(windows), shasum
#
# 호출 흐름:
#   .github/workflows/release.yml      → 본 스크립트 → bun build --compile → (darwin)codesign → tar/zip → shasum
#   (개발자) 로컬 검증                  → 본 스크립트 → 동일 (--skip-codesign 옵션으로 codesign 생략 가능)
#
# 회귀 가드:
#   --os 미지정 시 darwin 으로 동작 → 기존 darwin-arm64 호출(--arch arm64) 산출물 이름·codesign·tar 동작 불변.

set -euo pipefail

# -----------------------------------------------------------------------------
# 인자 파싱
# -----------------------------------------------------------------------------
VERSION=""
ARCH=""
OS=""
OUT_DIR="dist/release"
SKIP_CODESIGN=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --version)        VERSION="$2"; shift 2 ;;
    --arch)           ARCH="$2"; shift 2 ;;
    --os)             OS="$2"; shift 2 ;;
    --out-dir)        OUT_DIR="$2"; shift 2 ;;
    --skip-codesign)  SKIP_CODESIGN=1; shift ;;
    -h|--help)
      sed -n '1,38p' "$0"
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

# OS 기본값: darwin (미지정 호출의 회귀 0 보장).
if [[ -z "$OS" ]]; then
  OS="darwin"
fi
case "$OS" in
  darwin|linux|windows) ;;
  *) echo "Unsupported --os: $OS (expected darwin|linux|windows)" >&2; exit 1 ;;
esac

if [[ -z "$ARCH" ]]; then
  HOST_ARCH="$(uname -m)"
  case "$HOST_ARCH" in
    arm64|aarch64) ARCH="arm64" ;;
    x86_64)        ARCH="x64"   ;;
    *) echo "Unsupported host arch: $HOST_ARCH" >&2; exit 1 ;;
  esac
fi

# Bun target arch 표기: arm64 호스트 표기와 Bun 표기(arm64/x64)가 일치 → 그대로 사용.
BUN_TARGET="bun-${OS}-${ARCH}"
TARBALL_NAME="spyglass-${VERSION}-${OS}-${ARCH}"
STAGE_DIR="${OUT_DIR}/${TARBALL_NAME}"

# windows 는 .exe 바이너리 + .zip 패키징, 그 외는 확장자 없는 bin + .tar.gz.
if [[ "$OS" == "windows" ]]; then
  BIN_NAME="spyglass.exe"
  ARCHIVE_EXT="zip"
else
  BIN_NAME="spyglass"
  ARCHIVE_EXT="tar.gz"
fi

echo "[build] version=${VERSION} os=${OS} arch=${ARCH} target=${BUN_TARGET}"
echo "[build] stage=${STAGE_DIR} archive=${ARCHIVE_EXT} bin=${BIN_NAME}"

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
#    - 직후(darwin 만) ad-hoc codesign --sign - 재서명
#    windows 타깃은 Bun 이 outfile 에 .exe 를 자동 부착하므로 --outfile 은 확장자 없이 전달.
# -----------------------------------------------------------------------------
echo "[build] compiling standalone bin (Bun)..."
BUN_NO_CODESIGN_MACHO_BINARY=1 bun build \
  --compile \
  --minify \
  --target="$BUN_TARGET" \
  packages/server/src/index.ts \
  --outfile "$STAGE_DIR/bin/spyglass"

BIN_PATH="$STAGE_DIR/bin/${BIN_NAME}"

# codesign 은 darwin 에서만. linux/windows 는 자동 skip (호스트가 macOS 라도 의미 없음).
if [[ "$OS" == "darwin" && "$SKIP_CODESIGN" -eq 0 ]]; then
  echo "[build] ad-hoc codesign..."
  codesign --sign - --force --options runtime "$BIN_PATH"
  codesign -dv "$BIN_PATH" 2>&1 | sed 's/^/[build]   /'
elif [[ "$OS" != "darwin" ]]; then
  echo "[build] codesign skipped (os=${OS}, darwin 전용)"
fi

# 실행 권한 보장 (Bun build 가 이미 +x 주지만 확실히)
chmod +x "$BIN_PATH"

# -----------------------------------------------------------------------------
# 3) 자원 staging
#    - web:        __tests__, *.test.ts 제외 모든 파일
#    - migrations: *.sql 만
# -----------------------------------------------------------------------------
echo "[build] staging web/..."
# rsync 는 windows git-bash 에 미탑재(exit 127) → tar 파이프로 portable 복사.
#   tar 는 macOS(BSD)/linux(GNU)/git-bash(GNU) 모두 --exclude 지원, exclude 규칙 동일.
mkdir -p "$STAGE_DIR/share/spyglass/web"
tar --exclude='__tests__' \
    --exclude='*.test.ts' \
    --exclude='*.md' \
    --exclude='prototypes' \
    -cf - -C packages/web . \
  | tar -xf - -C "$STAGE_DIR/share/spyglass/web"

echo "[build] staging migrations/..."
mkdir -p "$STAGE_DIR/share/spyglass/migrations"
cp packages/storage/migrations/*.sql "$STAGE_DIR/share/spyglass/migrations/"

# LICENSE 가 있으면 동봉
if [[ -f LICENSE ]]; then
  cp LICENSE "$STAGE_DIR/LICENSE"
fi

# -----------------------------------------------------------------------------
# 4) 아카이브(tar.gz | zip) + sha256
#    darwin/linux → tar.gz, windows → zip.
# -----------------------------------------------------------------------------
ARCHIVE_PATH="${OUT_DIR}/${TARBALL_NAME}.${ARCHIVE_EXT}"
if [[ "$ARCHIVE_EXT" == "zip" ]]; then
  echo "[build] packing zip..."
  # -r 재귀, -q 조용히. 상대 경로 보존 위해 OUT_DIR 기준에서 실행.
  ( cd "${OUT_DIR}" && rm -f "${TARBALL_NAME}.zip" && zip -r -q "${TARBALL_NAME}.zip" "${TARBALL_NAME}" )
else
  echo "[build] packing tarball..."
  tar -czf "${ARCHIVE_PATH}" -C "${OUT_DIR}" "${TARBALL_NAME}"
fi

# BSD shasum (macOS) 와 GNU shasum 모두 같은 출력 형식
SHA256_HEX="$(shasum -a 256 "${ARCHIVE_PATH}" | awk '{print $1}')"
echo "${SHA256_HEX}  ${TARBALL_NAME}.${ARCHIVE_EXT}" > "${ARCHIVE_PATH}.sha256"

# -----------------------------------------------------------------------------
# 5) 최종 요약
# -----------------------------------------------------------------------------
ARCHIVE_SIZE="$(du -h "${ARCHIVE_PATH}" | awk '{print $1}')"
BIN_SIZE="$(du -h "${BIN_PATH}" | awk '{print $1}')"
echo ""
echo "[build] DONE"
echo "[build]   archive : ${ARCHIVE_PATH} (${ARCHIVE_SIZE})"
echo "[build]   sha256  : ${SHA256_HEX}"
echo "[build]   bin size: ${BIN_SIZE}"
echo "[build]   sha-file: ${ARCHIVE_PATH}.sha256"
