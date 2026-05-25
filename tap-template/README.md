# tap-template — Homebrew Tap 부트스트랩

이 디렉터리는 **별도 GitHub repo `gmoon92/homebrew-spyglass`** 의 초기 콘텐츠 템플릿입니다.
본 repo 안에서는 동작하지 않으며, 아래 순서로 tap repo 를 만들 때 복사·푸시하세요.

## 1. tap repo 생성

GitHub 에서 새 public repo:

```text
이름:  homebrew-spyglass
설명:  Homebrew tap for spyglass (Claude Code observability).
```

> 레포명은 **반드시 `homebrew-` 접두사**가 붙어야 `brew tap` 명령이 인식합니다.

## 2. 본 디렉터리 콘텐츠 복사

```bash
cd <appropriate workspace>
git clone https://github.com/gmoon92/homebrew-spyglass.git
cd homebrew-spyglass
cp -r <claude-spyglass repo>/tap-template/* .
git add Formula/spyglass.rb README.md
git commit -m "init: spyglass formula skeleton"
git push origin main
```

## 3. 첫 release 후 sha256 채우기

- 본 repo 에서 `git tag v2.10.0 && git push origin v2.10.0`
- `.github/workflows/release.yml` 이 자동으로:
  1. tarball 빌드 + GitHub Release 게시
  2. **본 tap repo 의 `Formula/spyglass.rb` 의 url + sha256 자동 갱신 PR**
- 자동 PR 머지

## 4. 사용자 흐름

```bash
brew tap gmoon92/spyglass
brew install spyglass
spyglass start
open http://127.0.0.1:9999

# 업데이트
brew upgrade spyglass
```

## 필요한 PAT secret

본 repo `gmoon92/claude-spyglass` 의 Settings → Secrets → Actions 에 추가:

- **이름**: `HOMEBREW_TAP_TOKEN`
- **권한**: 본 tap repo `gmoon92/homebrew-spyglass` 의 `repo` + `workflow` scope PAT
- **만료**: 권장 1년
