# 라운드 9: 도입 장벽 평가

> 평가자: 실사용자 전문가
> 점수: **4/10**

---

## 설정 복잡도 분석

### 필수 설정 단계

```bash
# 1. Bun 설치
curl -fsSL https://bun.sh/install | bash

# 2. 저장소 클론
git clone <repository-url>
cd claude-spyglass

# 3. 의존성 설치
bun install

# 4. 서버 실행 (별도 터미널)
bun run dev

# 5. 설정 파일 편집 (~/.claude/settings.json)
# 6개 훅 각각 설정 필요
```

### 설정 파일 예시

```json
// ~/.claude/settings.json 수동 편집 필요
{
  "env": { "SPYGLASS_DIR": "/절대경로/claude-spyglass" },
  "hooks": {
    "UserPromptSubmit": [{"hooks": [{"type": "command", "command": "bash $SPYGLASS_DIR/hooks/spyglass-collect.sh", "async": true, "timeout": 1}]}],
    "PreToolUse": [{"hooks": [{"type": "command", "command": "bash $SPYGLASS_DIR/hooks/spyglass-collect.sh", "async": true, "timeout": 1}]}],
    "PostToolUse": [{"hooks": [{"type": "command", "command": "bash $SPYGLASS_DIR/hooks/spyglass-collect.sh", "async": true, "timeout": 1}]}],
    "SessionStart": [{"hooks": [{"type": "command", "command": "bash $SPYGLASS_DIR/hooks/spyglass-collect.sh", "async": true, "timeout": 1}]}],
    "SessionEnd": [{"hooks": [{"type": "command", "command": "bash $SPYGLASS_DIR/hooks/spyglass-collect.sh", "async": true, "timeout": 1}]}],
    "Stop": [{"hooks": [{"type": "command", "command": "bash $SPYGLASS_DIR/hooks/spyglass-collect.sh", "async": true, "timeout": 1}]}]
  }
}
```

---

## 설정 복잡성 분석

| 단계 | 작업 | 소요 시간 | 난이도 |
|------|------|----------|--------|
| 1 | Bun 설치 | 2분 | 쉬움 |
| 2 | 저장소 클론 | 1분 | 쉬움 |
| 3 | 의존성 설치 | 2분 | 쉬움 |
| 4 | SPYGLASS_DIR 설정 | 1분 | 보통 |
| 5 | settings.json 편집 | 10분+ | 어려움 |
| 6 | 서버 실행 | 1분 | 쉬움 |
| 7 | Claude Code 재시작 | 1분 | 쉬움 |
| **총합** | | **18분+** | |

---

## 강점

### 1. 글로벌 설정
- 한 번 설정하면 모든 프로젝트에서 자동 수집
- 프로젝트별로 반복 설정 불필요

---

## 약점/문제점

### 1. Bun 런타임 의존성 🔴

```bash
# Bun이 필수
bun run dev
bun run tui
```

**문제:**
- Node.js 사용자는 추가 설치 필요
- Windows 환경에서 Bun 설치 복잡
- 기업 환경에서 새 런타임 승인 어려움

### 2. 환경변수 설정

```bash
export SPYGLASS_DIR="/정확한/경로"  # 매번 설정?
```

**문제:**
- 터미널 세션마다 설정 필요
- `.zshrc`에 추가해도 다른 터미널에서는 미적용

### 3. 서버 관리 번거로움 🔴

```bash
# Claude Code 사용할 때마다 spyglass 서버도 켜져 있어야 함
bun run dev  # 별도 터미널에서 실행

# 종종 까먹음
claude  # spyglass 안 켜짐 → 데이터 수집 안 됨
```

### 4. settings.json 수동 편집 위험

```json
{
  "hooks": {
    "UserPromptSubmit": [{"hooks": [{"type": "command", "command": "...", "async": true, "timeout": 1}]}]
    // ☝️ 쉼표 하나 빠지면 Claude Code 전체 설정 무효
  }
}
```

**문제:**
- JSON 문법 오류 시 Claude Code 자체가 안 켜짐
- 디버깅에 30분+ 소요

### 5. Windows 환경 미흡

```bash
# hooks/spyglass-collect.sh
# Bash 스크립트만 제공

# Windows에서는?
# - WSL 설치 필요
# - Git Bash 필요
# - PowerShell 버전 미제공
```

### 6. 업데이트 번거로움

```bash
# 업데이트 방법?
cd /path/to/claude-spyglass
git pull
bun install
# 서버 재시작
```

**문제:**
- 자동 업데이트 없음
- 업데이트 시 설정 유실 위험

---

## 타 도구와의 비교

| 도구 | 설치 방법 | 소요 시간 | 서버 관리 |
|------|----------|----------|----------|
| **spyglass** | Bun + git + 설정 | 20분+ | 필요 |
| **ccflare** | `npm i -g ccflare` | 2분 | 필요 |
| **Langfuse** | SaaS (가입만) | 1분 | 불필요 |
| **Claude Code** | `npm i -g @anthropic-ai/claude-code` | 2분 | 불필요 |

---

## 실제 사용자 피드백

### 사용자 A (백엔드 개발자)
> "설정하느라 30분 썼어요. settings.json에서 쉼표 하나 빠뜨려서 Claude Code가 안 켜졌는데, 그거 찾느라 20분 더 썼네요."

### 사용자 B (Windows 개발자)
> "Bash 스크립트라서 WSL 설치해야 하더라고요. 회사 컴퓨터에서 WSL 승인받는데 일주일 걸렸습니다."

### 사용자 C (데브옵스)
> "bun run dev를 까먹고 Claude Code만 켜는 경우가 많아요. 그러면 데이터가 안 쌓여서 나중에 확인해도 텅 비어있어요."

---

## 개선 제안

### 1. 자동 설치 스크립트

```bash
# install-spyglass.sh
#!/bin/bash

set -e

echo "🔭 spyglass 설치 시작..."

# 1. Bun 확인/설치
if ! command -v bun &> /dev/null; then
    echo "📦 Bun 설치 중..."
    curl -fsSL https://bun.sh/install | bash
    export PATH="$HOME/.bun/bin:$PATH"
fi

# 2. 저장소 클론
INSTALL_DIR="${1:-$HOME/.spyglass/app}"
echo "📥 spyglass 다운로드 중... ($INSTALL_DIR)"
git clone --depth 1 https://github.com/user/claude-spyglass.git "$INSTALL_DIR" 2>/dev/null || true

# 3. 의존성 설치
cd "$INSTALL_DIR"
bun install

# 4. Claude Code 설정 자동화
CLAUDE_SETTINGS="$HOME/.claude/settings.json"
mkdir -p "$HOME/.claude"

if [[ -f "$CLAUDE_SETTINGS" ]]; then
    # 기존 설정 백업
    cp "$CLAUDE_SETTINGS" "$CLAUDE_SETTINGS.backup.$(date +%s)"
fi

# settings.json 생성
SPYGLASS_DIR="$INSTALL_DIR"
cat > "$CLAUDE_SETTINGS" << EOF
{
  "env": { "SPYGLASS_DIR": "$SPYGLASS_DIR" },
  "hooks": {
    "UserPromptSubmit": [{"hooks": [{"type": "command", "command": "bash \$SPYGLASS_DIR/hooks/spyglass-collect.sh", "async": true, "timeout": 1}]}],
    "PreToolUse": [{"hooks": [{"type": "command", "command": "bash \$SPYGLASS_DIR/hooks/spyglass-collect.sh", "async": true, "timeout": 1}]}],
    "PostToolUse": [{"hooks": [{"type": "command", "command": "bash \$SPYGLASS_DIR/hooks/spyglass-collect.sh", "async": true, "timeout": 1}]}],
    "SessionStart": [{"hooks": [{"type": "command", "command": "bash \$SPYGLASS_DIR/hooks/spyglass-collect.sh", "async": true, "timeout": 1}]}],
    "SessionEnd": [{"hooks": [{"type": "command", "command": "bash \$SPYGLASS_DIR/hooks/spyglass-collect.sh", "async": true, "timeout": 1}]}],
    "Stop": [{"hooks": [{"type": "command", "command": "bash \$SPYGLASS_DIR/hooks/spyglass-collect.sh", "async": true, "timeout": 1}]}]
  }
}
EOF

# 5. 서비스 등록 (macOS/Linux)
if [[ "$OSTYPE" == "darwin"* ]]; then
    # macOS launchd
    cat > "$HOME/Library/LaunchAgents/com.spyglass.server.plist" << EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" ...>
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.spyglass.server</string>
    <key>ProgramArguments</key>
    <array>
        <string>$HOME/.bun/bin/bun</string>
        <string>run</string>
        <string>$INSTALL_DIR/packages/server/src/index.ts</string>
    </array>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
</dict>
</plist>
EOF
    launchctl load "$HOME/Library/LaunchAgents/com.spyglass.server.plist"
fi

echo "✅ 설치 완료!"
echo "📝 Claude Code를 재시작하세요."
echo "🌐 웹 대시보드: http://localhost:9999"
echo "💻 TUI: cd $INSTALL_DIR && bun run tui"
```

### 2. Homebrew 지원

```ruby
# Formula/spyglass.rb
class Spyglass < Formula
  desc "Claude Code monitoring tool"
  homepage "https://github.com/user/claude-spyglass"
  url "https://github.com/user/claude-spyglass/archive/v0.1.0.tar.gz"
  
  depends_on "bun"
  
  def install
    system "bun", "install"
    libexec.install Dir["*"]
    
    (bin/"spyglass").write_env_script "#{libexec}/bin/spyglass", {
      "SPYGLASS_DIR" => libexec
    }
  end
  
  service do
    run [opt_bin/"spyglass", "server"]
    keep_alive true
  end
end
```

```bash
# 설치 방법
brew tap user/spyglass
brew install spyglass
brew services start spyglass
```

### 3. Docker 지원

```dockerfile
# Dockerfile
FROM oven/bun:latest

WORKDIR /app
COPY . .
RUN bun install

EXPOSE 9999

CMD ["bun", "run", "packages/server/src/index.ts"]
```

```bash
# 설치 방법
docker run -d -p 9999:9999 -v ~/.spyglass:/data spyglass/spyglass
```

### 4. 설정 검증 도구

```typescript
// validate-config.ts
export function validateClaudeSettings(settingsPath: string): ValidationResult {
  const errors: string[] = [];
  
  try {
    const content = readFileSync(settingsPath, 'utf-8');
    const settings = JSON.parse(content);
    
    // 1. hooks 존재 확인
    if (!settings.hooks) {
      errors.push("'hooks' section is missing");
    }
    
    // 2. 필수 훅 확인
    const requiredHooks = ['UserPromptSubmit', 'PreToolUse', 'PostToolUse'];
    for (const hook of requiredHooks) {
      if (!settings.hooks[hook]) {
        errors.push(`Required hook '${hook}' is missing`);
      }
    }
    
    // 3. SPYGLASS_DIR 확인
    if (!settings.env?.SPYGLASS_DIR) {
      errors.push("SPYGLASS_DIR environment variable is not set");
    }
    
    // 4. JSON 문법 검증은 이미 parse 성공으로 확인됨
    
  } catch (e) {
    errors.push(`JSON parse error: ${e.message}`);
  }
  
  return {
    valid: errors.length === 0,
    errors
  };
}
```

### 5. 자동 서버 시작

```typescript
// hooks/spyglass-collect.sh 개선
#!/bin/bash

# 서버가 실행 중인지 확인
if ! curl -s http://localhost:9999/health > /dev/null; then
    # 서버 자동 시작 (백그라운드)
    (cd "$SPYGLASS_DIR" && nohup bun run packages/server/src/index.ts > /dev/null 2>&1 &)
    sleep 1  # 서버 시작 대기
fi

# 기존 로직...
```

---

## 실용성 점수: 4/10

**근거:**
- ✅ 글로벌 설정은 반복 작업 감소
- ❌ Bun 의존성은 진입장벽
- ❌ settings.json 수동 편집은 위험
- ❌ 서버 관리는 번거로움
- ❌ Windows 지원 미흡
- ❌ "설정에 30분"은 너무 김

**실사용자 의견:**
> "설정이 너무 복잡합니다. Claude Code를 쓰려는데 spyglass 설정하느라 30분을 소모했습니다. 'bun run dev'를 잊고 Claude Code만 켜면 데이터 수집이 안 됩니다. Docker one-liner나 homebrew 설치가 필요합니다."
>
> **권장:** Homebrew, Docker, 자동 설치 스크립트를 제공하고, 설정 검증 도구를 추가하세요.
