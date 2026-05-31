#!/usr/bin/env bash
#
# build-release-tarball.sh — macOS 배포용 tarball 빌드 (mac 전용, windows 미지원).
#
# 책임:
#   1) Bun standalone executable 컴파일 (packages/server → bin/spyglass).
#      - Bun 1.3.12 darwin-arm64 code-sign 버그 우회: BUN_NO_CODESIGN_MACHO_BINARY=1 + ad-hoc codesign.
#   2) 자원 디렉터리 staging (web, storage/migrations).
#   3) tar.gz 아카이브 + .sha256 산출.
#
# 사용:
#   ./scripts/build-release-tarball.sh --version 3.1.0 --arch arm64 [--os darwin] [--out-dir dist/release]
#   (기본값: package.json 의 version, 호스트 arch, os=darwin)
#
#   예시(mac):
#     --os darwin  --arch arm64   → spyglass-<v>-darwin-arm64.tar.gz   (codesign O)
#     --os darwin  --arch x64     → spyglass-<v>-darwin-x64.tar.gz     (codesign O)
#   (--os linux 도 동작하나 릴리스 matrix 는 darwin 만 사용. windows 는 미지원.)
#
# 산출:
#   <out-dir>/spyglass-<version>-<os>-<arch>.tar.gz
#   <out-dir>/spyglass-<version>-<os>-<arch>.tar.gz.sha256
#
# 의존성: bun, codesign(macOS darwin 만), tar, shasum
#
# 호출 흐름:
#   .github/workflows/release.yml      → 본 스크립트 → bun build --compile → (darwin)codesign → tar → shasum
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
  darwin|linux) ;;
  *) echo "Unsupported --os: $OS (expected darwin|linux)" >&2; exit 1 ;;
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

# 산출물: 확장자 없는 bin + .tar.gz. mac 전용 — windows(.exe/.zip) 미지원.
BIN_NAME="spyglass"
ARCHIVE_EXT="tar.gz"

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
echo "[build] building web (Vite) → dist..."
# React+Vite 전환(P4-10): 데몬은 빌드 산출(dist: index.html + assets)을 서빙한다(WEB_ROOT→dist).
# 따라서 tarball 도 원본 .ts/.tsx 가 아닌 dist 산출만 stage 한다(P5-08 머지 정합).
bun run --cwd packages/web build
echo "[build] staging web/dist..."
mkdir -p "$STAGE_DIR/share/spyglass/web"
# rsync 는 windows git-bash 에 미탑재(exit 127) → tar 파이프로 portable 복사.
tar -cf - -C packages/web/dist . \
  | tar -xf - -C "$STAGE_DIR/share/spyglass/web"

echo "[build] staging migrations/..."
mkdir -p "$STAGE_DIR/share/spyglass/migrations"
cp packages/storage/migrations/*.sql "$STAGE_DIR/share/spyglass/migrations/"

# LadybugDB native (@ladybugdb) — graph projection.
#   bun --compile bin 은 .node(native addon) 를 내장 못 하므로 동봉한다. Formula 의
#   write_env_script 가 NODE_PATH=share/spyglass/native/node_modules 를 주입 → client.ts 의
#   동적 import('@ladybugdb/core') 가 이 경로에서 resolve 된다.
#   (PoC 근거: docs/distribution/.distribution-gap-report.md D2-01)
#   wrapper(core) + arch 별 native(core-${OS}-${ARCH}) 둘 다 필요(optionalDependencies 구조).
echo "[build] staging LadybugDB native (@ladybugdb/core + core-${OS}-${ARCH})..."
NATIVE_DST="$STAGE_DIR/share/spyglass/native/node_modules/@ladybugdb"
mkdir -p "$NATIVE_DST"
cp -RL node_modules/.bun/@ladybugdb+core@*/node_modules/@ladybugdb/core "$NATIVE_DST/"
cp -RL node_modules/.bun/@ladybugdb+core-${OS}-${ARCH}@*/node_modules/@ladybugdb/core-${OS}-${ARCH} "$NATIVE_DST/"
echo "[build]   native staged: $(ls "$NATIVE_DST" | tr '\n' ' ')"

# LICENSE 가 있으면 동봉
if [[ -f LICENSE ]]; then
  cp LICENSE "$STAGE_DIR/LICENSE"
fi

# -----------------------------------------------------------------------------
# 4) 아카이브(tar.gz) + sha256 — mac 전용 단일 포맷.
# -----------------------------------------------------------------------------
ARCHIVE_PATH="${OUT_DIR}/${TARBALL_NAME}.${ARCHIVE_EXT}"
echo "[build] packing tarball..."
tar -czf "${ARCHIVE_PATH}" -C "${OUT_DIR}" "${TARBALL_NAME}"

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
