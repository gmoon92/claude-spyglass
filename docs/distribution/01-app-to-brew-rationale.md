# claude-spyglass — 배포 전략 분석: 앱(Electron DMG) → Homebrew 전환

> **용도**: spyglass 배포 채널이 "Electron DMG 앱 배포"에서 "Homebrew Formula 배포"로 전환된 배경·근거·현재 상태를 사실 기반으로 정리한 분석 문서.
> **정확성 원칙**: 모든 사실 주장에 `파일:라인` 또는 `커밋해시` 근거. 추측은 §8에 명시 분리.
> **대상**: `claude-spyglass` 루트 v3.1.0 / `@spyglass/desktop` v2.11.0
> **기준일**: 2026-05-31

---

## 0. TL;DR

- **"앱 배포"의 정체** = `packages/desktop`의 **Electron 42.x macOS `.dmg` 앱**(electron-builder).
- **"과금"의 정체** = Electron DMG를 정식 배포하려면 **Apple Developer Program(연 $99)**의 Developer ID 인증서로 **코드 서명 + notarization**이 필요하다. 서명이 없으면 (1) macOS Gatekeeper가 실행을 차단/경고하고, (2) `electron-updater` 자동 업데이트가 동작하지 않는다.
- **전환 방향** = **Homebrew Formula 배포**. standalone Bun bin을 **ad-hoc codesign**(무료)으로 서명해 tarball로 패키징하고 GitHub Release에 게시 → `brew install`/`brew upgrade`/`brew services`로 일원화. Apple Developer ID·연 과금 불필요.
- **현재 상태** = README·Formula·tap-template·빌드 스크립트 차원에서 brew 전환은 **확정**됐다. 다만 `release.yml`은 *tarball을 GitHub Release에 게시*하는 데까지만 자동화되어 있고, tap repo 부재로 **Formula 자동 갱신(bump) 잡은 일시 분리**된 상태다. **install-guide.md는 아직 git clone 방식**이라 brew 절 추가가 필요하다.

---

## 1. "앱 배포"의 정체 — Electron DMG

`packages/desktop`은 Bun 서버 + 웹 대시보드를 macOS 네이티브 셸로 감싼 **Electron 데스크톱 앱**이다.

| 항목 | 근거 |
|------|------|
| Electron 42.x DMG 셸 | `packages/desktop/package.json` (`electron: ^42.2.0`, `build:mac → electron-builder --mac dmg`) |
| 패키징 설정 | `packages/desktop/electron-builder.yml` (`appId: com.spyglass.desktop`, `productName: Claude Spyglass`, `mac.target: dmg` arm64/x64) |
| 동봉 방식 | `bun build --compile` standalone bin을 `extraResources`로 동봉, child로 spawn (`server-process.js`) |
| 자동 업데이트 | `packages/desktop/src/main/auto-updater.js` (GitHub Releases API 폴링 기반 알림) |
| 빌드 진입점 | 루트 `package.json` `desktop:build:mac` / `desktop:pack:mac` |

> Electron 앱은 **`30cda7f feat(desktop,brew)`**(2026-05-25, v2.10.0)에서 "Local agent mode"로 처음 도입됐다. 같은 커밋에서 Homebrew "Headless mode"도 함께 구축됐고, 처음부터 **brew가 recommended**였다.

---

## 2. "과금"의 정체 — Apple Developer Program 연 $99

Electron DMG를 macOS에 **정상적으로 배포**하려면 Apple Developer ID 코드 서명이 사실상 필수다. 이 인증서는 **Apple Developer Program 연 $99 유료 멤버십**으로만 발급된다.

### 2.1 서명을 적용하지 않은 현재 상태

- `electron-builder.yml`은 **코드 서명을 명시적으로 비활성화**한다: `mac.identity: null`, `hardenedRuntime: false`, `gatekeeperAssess: false`. 헤더 주석에 *"코드 서명 / notarization 은 이번 작업 범위 밖. 미적용 시 macOS Gatekeeper 경고가 발생할 수 있다"* 로 기록.
- 미서명 DMG는 Gatekeeper가 차단하므로, 사용자가 설치 후 `xattr -cr /Applications/Claude\ Spyglass.app`을 수동 실행해야 한다(같은 파일 주석 명시).

### 2.2 서명 없이는 자동 업데이트도 깨진다

`packages/desktop/src/main/auto-updater.js` 헤더 주석이 핵심 근거다:

> *"electron-updater 는 macOS 에서 Apple Developer ID 코드 서명이 필수다. 서명을 적용하지 않은 현 상태에서는 무료로 동작하는 반자동 방식을 채택"*

이 때문에 desktop은 정식 `electron-updater`(백그라운드 다운로드 + 재시작 시 자동 적용)를 포기하고, **반자동 방식**(GitHub Releases API로 최신 태그 조회 → native dialog 알림 → 사용자가 release 페이지에서 DMG를 직접 받아 교체)으로 다운그레이드했다.

### 2.3 정리 — "앱 배포 시 과금"의 실체

| 항목 | 미서명(현재) | 정식 서명 |
|------|-------------|----------|
| 비용 | $0 | **Apple Developer Program 연 $99** |
| Gatekeeper | 차단/경고 → 사용자 `xattr -cr` 수동 | 통과 |
| notarization | 없음 | 필요(Apple 공증 서버 제출) |
| 자동 업데이트 | 반자동(수동 DMG 교체) | electron-updater 완전 자동 |
| UX | 설치 마찰 큼 | 매끄러움 |

→ "제대로 된 앱 배포 = 연 $99 + 서명/공증 인프라 부담", "미서명 앱 배포 = UX·자동업데이트 희생". 이 딜레마가 **brew 전환의 동기**다.

---

## 3. Homebrew 배포가 과금을 회피하는 방식

Homebrew Formula 경로는 **Apple Developer ID 없이도** 매끄러운 설치·업데이트를 제공한다.

| 메커니즘 | 근거 | 효과 |
|----------|------|------|
| **ad-hoc codesign** | `scripts/build-release-tarball.sh` (`codesign --sign - --force --options runtime`) | Developer ID 불필요 = **연 과금 0** |
| **standalone bin** | Formula `spyglass.rb`: *"동봉된 standalone bin 안에 Bun 런타임이 포함 → depends_on \"bun\" 불필요"* | 시스템 Bun 설치 불필요 |
| **tarball + GitHub Release** | `release.yml` → `build-release-tarball.sh` → `tar.gz`+`sha256` 업로드 | 호스팅 비용 0(GitHub Release 무료) |
| **brew services** | `spyglass.rb` `service do ... run [opt_bin/spyglass, serve]` | launchd 자동시작, 코드서명 무관 |
| **brew upgrade** | `spyglass.rb`: *"auto-update 는 `brew upgrade` 가 canonical"* | electron-updater 대체 |

`spyglass.rb` 헤더 주석도 동일하게 명시한다: *"코드 서명 / Apple Developer ID 는 미적용. ad-hoc codesign 으로만 서명되어 있음."*

**사용자 설치 흐름**(README.md §Install 기준):

```bash
brew tap gmoon92/claude-code-spyglass
brew install spyglass
brew services start spyglass   # 로그인 시 자동 시작
spyglass open
brew upgrade spyglass          # 업데이트
```

---

## 4. 전환 타임라인 (커밋 근거)

| 순서 | 커밋 | 날짜 | 내용 |
|------|------|------|------|
| 1 | `30cda7f` | 05-25 | **feat(desktop,brew)**: Electron DMG(Local agent) + Homebrew(Headless, recommended) **두 채널 동시 구축**. brew Formula sha256 자동 bump(`mislav/bump-homebrew-formula-action`) 포함. `serve`/`start` lifecycle 분리, `SPYGLASS_*_ROOT` env 외부화, `updateChannel: git\|brew\|packaged` 도입 |
| 2 | `0107ce7` | — | **feat(release) R6**: 릴리스 matrix를 5타겟(darwin arm64/x64, linux arm64/x64, windows-x64)으로 확장. Formula `on_macos`/`on_linux` 활성화 |
| 3 | `1992b54`, `c47be60` | 05-31 | windows 빌드의 git-bash 도구 부재(rsync→tar, zip/PowerShell 부재) 연쇄 수정 |
| 4 | `af3c959` | 05-31 12:51 | **ci(release): homebrew bump 잡 제거 — tarball-only**. tap repo(`gmoon92/homebrew-spyglass`)가 부재해 bump 잡이 항상 실패/skip → 잡 제거, GitHub Release 직접 다운로드로 전환. *"추후 homebrew 도입 시 잡+tap repo 별도 구성"* |
| 5 | `e1f8266` | 05-31 13:04 | **feat(release)! macOS 전용 축소**. windows/linux 빌드 제거(*"windows 지원 중단 — 앱·설치형 배포 계획 없음"*). matrix를 darwin arm64/x64만으로 축소 |

> 흐름 요약: **두 채널 동시 출발(앱+brew) → brew를 recommended로 → 멀티플랫폼 확장 시도 → windows 빌드 마찰 + tap repo 부재로 정리 → macOS·tarball 중심으로 수렴.** "앱(DMG) 배포"는 README 2순위로 남았고, 무게중심은 brew/tarball로 이동했다.

---

## 5. 현재 상태 정합성 — 컴포넌트별

| 컴포넌트 | 상태 | 근거 / 비고 |
|----------|------|-------------|
| **README.md** | ✅ brew 1순위 | §Install "1. Headless mode — Homebrew Formula (recommended)" / "2. Local agent mode — Electron app". brew tap/install/services/upgrade/uninstall 흐름 완비 |
| **Formula** `tap-template/Formula/spyglass.rb` | ⚠️ sha256 미충전 | 4플랫폼 url+sha256, `write_env_script`, `service do`, `caveats` 완비. 단 sha256은 `REPLACE_WITH_*` placeholder(첫 릴리스 전) |
| **tap-template/README.md** | ✅ 절차 완비 | `homebrew-spyglass` tap repo 부트스트랩(생성→복사→첫 release sha256 자동 갱신→`HOMEBREW_TAP_TOKEN` PAT) 안내 |
| **build-release-tarball.sh** | ✅ 동작 | standalone bin + ad-hoc codesign + `tar.gz` + `sha256` 산출. macOS 전용(windows 분기 제거됨) |
| **release.yml** | ⚠️ 부분 자동화 | darwin arm64/x64 tarball을 GitHub Release에 게시까지만. **homebrew bump 잡은 제거됨**(tap repo 부재). 비범위에 *"homebrew tap·앱/설치형 배포 미지원"* 명시 |
| **install-guide.md** | ⚠️ 미현행화 | 여전히 `git clone` + `bun run dev` 방식만 1차 안내. **brew tap/install/services 절 부재** |
| **packages/desktop** (Electron) | ⚠️ 잔존 | README 2순위로 유지. `desktop` v2.11.0(루트 3.1.0 대비 정체). x64 dmg arch 고정 이슈(R4)는 `SPYGLASS_BIN_ARCH` 인자화로 해결됨 |

---

## 6. brew 배포 완성까지 잔여 작업

현재는 "brew Formula가 소비할 tarball"은 자동 생산되지만, Formula까지 닿는 마지막 연결고리가 끊겨 있다.

1. **tap repo 생성** — `gmoon92/homebrew-spyglass` public repo 생성 후 `tap-template/*` 푸시 (tap-template/README §1~2 절차).
2. **Formula sha256 충전** — 첫 release 후 4플랫폼(또는 macOS 2타겟) sha256을 `spyglass.rb`에 반영. 미충전 시 `brew install` 실패.
3. **bump 잡 재도입** — `af3c959`에서 제거된 `bump-homebrew-formula-action`을 tap repo 구성 후 `release.yml`에 복원 → tag push 시 Formula 자동 갱신.
4. **install-guide.md 현행화** — `brew tap`/`brew install`/`brew services` 절을 1차 설치 경로로 추가(현재 git clone 방식은 "From source(contributors)"로 격하). README와 정합 맞춤.
5. **(선택) desktop 노선 정리** — Electron DMG를 보조 채널로 유지할지, deprecate할지 결정. 유지 시 미서명/`xattr` 안내를 install-guide에 명시.

---

## 7. 결론

사용자가 의도한 **"앱(Electron DMG) 배포 → Homebrew 배포 전환"**은 **README·Formula·tap-template·빌드 스크립트 차원에서 이미 확정**됐다. 동기는 명확하다 — **Electron DMG의 정식 배포에 드는 Apple Developer Program 연 $99 + 코드 서명/공증 인프라 부담**을, **ad-hoc codesign 기반 Homebrew Formula(무료)**로 회피하는 것이다.

남은 것은 운영 연결고리다: **tap repo 생성 → Formula sha256 충전 → bump 잡 재도입 → install-guide brew 절 추가.** 이 4가지가 채워지면 `brew install spyglass` 한 줄로 끝나는 무과금 배포가 완성된다.

---

## 8. 부록 — 파일:라인 근거 인덱스

| 주장 | 근거 |
|------|------|
| Electron DMG = "앱 배포" | `packages/desktop/electron-builder.yml`, `packages/desktop/package.json` |
| 코드 서명 미적용 / Gatekeeper / xattr | `packages/desktop/electron-builder.yml` (`identity: null` + 헤더 주석) |
| electron-updater = Apple Developer ID 필수 → 반자동 채택 | `packages/desktop/src/main/auto-updater.js` (헤더 주석) |
| brew = ad-hoc codesign(무료) | `tap-template/Formula/spyglass.rb` (헤더 주석), `scripts/build-release-tarball.sh:125-128` |
| brew upgrade = canonical auto-update | `tap-template/Formula/spyglass.rb` (헤더 주석) |
| brew 1순위 / Electron 2순위 | `README.md` §Install |
| 현재 release = macOS tarball-only, homebrew/앱 미지원 | `.github/workflows/release.yml` (헤더 주석 + matrix) |
| tap repo 부트스트랩 절차 | `tap-template/README.md` |
| install-guide가 git clone 방식 | `docs/install-guide.md` §3 |

### 미확인 / 추정 (별도 검증 필요)

- "$99"는 Apple Developer Program 표준 연회비(일반 통념)로, 코드 주석은 "Apple Developer ID 코드 서명 필수"까지만 명시한다. 금액 자체는 코드 근거가 아닌 외부 사실이다.
- desktop 노선의 deprecate 여부는 명시된 결정 문서가 없다. README 2순위 잔존·`desktop` v2.11.0 정체는 정황 근거일 뿐, 공식 중단 선언은 확인되지 않았다.

---

*Generated by Claude Code (Opus 4.8) — 소스 직접 Read 기반. 기준일 2026-05-31.*
