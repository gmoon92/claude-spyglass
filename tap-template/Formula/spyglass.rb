# typed: false
# frozen_string_literal: true
#
# spyglass.rb — Homebrew Formula for Claude Spyglass.
#
# 책임:
#   - Bun standalone executable + 정적 자원(web, migrations)을 사용자 머신에 배포.
#   - write_env_script 로 SPYGLASS_* env 를 wrapper 에 고정 → CLI/brew services 모두 동일 env.
#   - brew services 통합 — launchd 가 `spyglass serve`(foreground) 를 직접 호출.
#
# 의존성:
#   - 동봉된 standalone bin 안에 Bun 런타임이 포함되어 있어 시스템 bun 불필요.
#   - native deps 없음 (storage-graph @ladybugdb 는 SPYGLASS_GRAPH_MODE=off 로 dormant).
#
# 호출 흐름:
#   brew tap gmoon92/claude-code-spyglass
#   brew install spyglass                  →  tarball 다운로드 → bin/share 배치
#   spyglass start                         →  background daemonize wrapper
#   spyglass status / stop                 →  PID/LISTEN 기반 lifecycle
#   brew services start spyglass           →  launchd → `spyglass serve` (foreground)
#   brew upgrade spyglass                  →  새 tarball → 동일 위치 갱신 → (services 사용 시) 자동 재시작
#
# 비범위:
#   - 코드 서명 / Apple Developer ID 는 미적용. ad-hoc codesign 으로만 서명되어 있음.
#   - windows/linux 미지원 — release.yml 이 macOS 전용(darwin arm64/x64)으로 축소됨(e1f8266).
#
# 플랫폼 (macOS 전용):
#   - darwin-arm64 / darwin-x64 2개 url+sha256.
#   - ⚠️ url 은 release.yml 산출물 이름(spyglass-<v>-darwin-<arch>.tar.gz)에 의존.
#     update-formula.yml(D4)이 두 arch sha256 을 자동 갱신하므로 형식 변경 금지.

class Spyglass < Formula
  desc "Local observability for Claude Code (token, cost, anomaly)"
  homepage "https://github.com/gmoon92/claude-spyglass"
  license "MIT" # ※ 본 repo 의 실제 LICENSE 와 일치하도록 갱신
  version "3.1.0"

  # ⚠️ on_macos 안에 on_arm/on_intel 중첩 — top-level on_arm 만 쓰면 Linux ARM 머신이
  #     macOS arm64 binary 를 받는 버그가 있다 (steipete/homebrew-tap#19).
  on_macos do
    on_arm do
      url "https://github.com/gmoon92/claude-spyglass/releases/download/v#{version}/spyglass-#{version}-darwin-arm64.tar.gz"
      sha256 "3f11aed54ff9c6238a97ea524340892079eed4c73c6ef3284e1754e3131c7e23"
    end
    on_intel do
      url "https://github.com/gmoon92/claude-spyglass/releases/download/v#{version}/spyglass-#{version}-darwin-x64.tar.gz"
      sha256 "3e6361411ae5e0dffa17b26820838373bda49a88329ebe5b6c356052216c6631"
    end
  end

  # standalone bin 안에 Bun 런타임이 포함됨 → depends_on "bun" 불필요.
  # git CLI 의존은 brew 채널에서 제거됨 — auto-update 는 `brew upgrade` 가 canonical.

  def install
    # standalone bin 은 libexec 으로 — write_env_script 로 wrapper 만 bin/ 에 노출.
    libexec.install "bin/spyglass" => "spyglass-bin"
    (share/"spyglass").install Dir["share/spyglass/*"]

    # wrapper script — env 주입을 단일 진입점으로 고정.
    #   - 사용자가 `spyglass <cmd>` 로 호출하든 brew services 가 호출하든 동일한 env 보장.
    #   - SPYGLASS_GRAPH_MODE=off: native @ladybugdb 는 brew tarball 에 미동봉이므로 dormant.
    #     storage-graph 의 circuit breaker 가 동작하지만 첫 부팅 에러 로그를 피하려 명시.
    (bin/"spyglass").write_env_script libexec/"spyglass-bin",
      SPYGLASS_WEB_ROOT:        share/"spyglass/web",
      SPYGLASS_MIGRATIONS_ROOT: share/"spyglass/migrations",
      SPYGLASS_APP_VERSION:     version.to_s,
      SPYGLASS_GRAPH_MODE:      "off",
      SPYGLASS_UPDATE_CHANNEL:  "brew"
  end

  service do
    # ⚠️ 반드시 `serve`(foreground) 호출. `start` 는 detached spawn 이라 launchd 가 부모 PID 만 잡아
    #     실제 서버 child 를 관리하지 못한다.
    run [opt_bin/"spyglass", "serve"]
    run_type :immediate
    # 크래시만 자동 재기동. 사용자 의도된 정상 종료는 건드리지 않음.
    keep_alive successful_exit: false, crashed: true
    working_dir HOMEBREW_PREFIX
    log_path       var/"log/spyglass.log"
    error_log_path var/"log/spyglass.err.log"
    environment_variables PATH: std_service_path_env
  end

  def caveats
    <<~EOS
      Persistent:
        brew services start spyglass
        spyglass open

      Manual:
        spyglass start
        spyglass open

      Data: ~/.spyglass/
    EOS
  end

  test do
    # smoke test — help text 출력 + 0 exit.
    # 9999 점유는 CI 환경에 따라 다르므로 status / serve 는 호출하지 않는다.
    assert_match(/spyglass|Usage/i, shell_output("#{bin}/spyglass not-a-real-command 2>&1", 1))
  end
end
