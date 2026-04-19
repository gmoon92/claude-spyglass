# 라운드 3: 실사용자 UX 평가

> 평가자: Claude Code 실사용자
> 점수: **5/10**

---

## 검토 대상 파일

- `packages/tui/src/components/*.tsx` - TUI 컴포넌트들
- `packages/web/` - 웹 대시보드
- `README.md` - 설치/사용 가이드

---

## TUI 분석 (LiveTab.tsx)

```typescript
const MAX_RECENT = 20;
// ...
// SSE new_request 이벤트 수신 시 re-fetch
const newReqCount = messages.filter(m => m.type === 'new_request').length;
useEffect(() => {
  if (newReqCount > 0) fetchRecent();
}, [newReqCount, fetchRecent]);
```

---

## 강점

### 1. lazygit 스타일 직관적 UI
- F1~F4 탭 네비게이션 (Live/History/Analysis/Settings)
- 터미널 사용자에게 친숙한 패턴

### 2. 실시간 SSE 스트리밍
```typescript
const { status: sseStatus, messages, lastMessage } = useSSE({ autoReconnect: true });
```
- 실시간 업데이트로 "살아있는" 느낌 제공

### 3. Progress Bar 시각화
```typescript
const progress = Math.min((tokens / maxTokens) * 100, 100);
<ProgressBar progress={progress} width={Math.min(40, columns - 30)} />
```
- 토큰 사용량을直관적으로 표시

---

## 약점/문제점

### 1. 하드코딩된 값들 🔴

```typescript
// LiveTab.tsx
const maxTokens = 100000; // 예상 최대 토큰 - Claude 모델별로 다름!
// Claude Haiku: 200K, Claude Sonnet: 200K, Claude Opus: 200K...

// 문제: 사용자의 실제 모델과 무관하게 100K 고정
```

**영향:**
- Claude Opus 사용 시 100K 넘어가도 100% 넘어감 표시
- Haiku 사용 시 100K 도달 전에 실제로는 한도 초과

### 2. fetch 실패 시 조용히 실패

```typescript
try {
  const res = await fetch(`${API_URL}/api/requests?limit=${MAX_RECENT}`);
  const json = await res.json();
  if (json.success && json.data) {
    setRecentRequests(json.data.slice(0, MAX_RECENT));
  }
} catch {
  // 조용히 실패 - 사용자에게 아무 알림 없음
}
```

**문제:**
- 서버 연결 끊김 시 사용자가 모름
- "왜 데이터 안 나오지?" 당혹

### 3. 고정된 최근 요청 수

```typescript
slice(0, 8)  // 최근 8개만 표시
```

**문제:**
- 사용자가 조정 불가
- 더 많은 히스토리를 보고 싶어도 불가능

### 4. 키보드 단축키 충돌

```typescript
// TUI 단축키
F1: Live 탭
F2: History 탭
F3: Analysis 탭
F4: Settings 탭
```

**문제:**
- F1~F4는 터미널 이미 사용 중인 경우 많음
- iTerm2, tmux 등에서 기능 키로 사용됨
- 사용자가 단축키 커스터마이징 불가

---

## 훅 설정의 번거로움

```json
// ~/.claude/settings.json 수동 편집 필요
{
  "env": { "SPYGLASS_DIR": "/절대경로/claude-spyglass" },
  "hooks": {
    "UserPromptSubmit": [{"hooks": [{"type": "command", "command": "...", "async": true, "timeout": 1}]}],
    "PreToolUse": [{"hooks": [{"type": "command", "command": "...", "async": true, "timeout": 1}]}],
    "PostToolUse": [{"hooks": [{"type": "command", "command": "...", "async": true, "timeout": 1}]}],
    "SessionStart": [{"hooks": [{"type": "command", "command": "...", "async": true, "timeout": 1}]}],
    "SessionEnd": [{"hooks": [{"type": "command", "command": "...", "async": true, "timeout": 1}]}],
    "Stop": [{"hooks": [{"type": "command", "command": "...", "async": true, "timeout": 1}]}]
  }
}
```

**문제:**
1. **6개 훅 각각 설정 필요** - 복사붙여넣기 6회
2. **절대경로 설정** - `SPYGLASS_DIR` 환경변수
3. **JSON 문법 오류 위험** - 쉼표 하나 빠지면 전체 설정 무효
4. **Claude Code 재시작 필요** - 설정 변경 후 반영

---

## TUI vs Web 중복

| 기능 | TUI | Web | 중복 여부 |
|------|-----|-----|----------|
| 실시간 모니터링 | ✅ | ✅ | 중복 |
| 세션 목록 | ✅ | ✅ | 중복 |
| 요청 상세 | ✅ | ✅ | 중복 |
| 토큰 통계 | ✅ | ✅ | 중복 |
| 설정 변경 | ✅ | ✅ | 중복 |

**문제:**
- 두 인터페이스 모두 유지보수 필요
- 기능 불일치 가능성 (TUI에는 있고 Web에는 없는 기능 등)
- 개발 리소스 분산

---

## 실제 사용 시나리오 (가상 인터뷰)

### 시나리오 1: 일상적 사용
> **Q:** spyglass를 얼마나 자주 열어보시나요?
> 
> **A:** "처음엔 매일 봤는데, 지금은 일주일에 한 번도 안 켜요. 토큰 얼마 썼는지보다 작업을 마치는 게 더 중요해요."

### 시나리오 2: 알림 반응
> **Q:** 10K 토큰 알림이 뜨면 어떻게 하시나요?
> 
> **A:** "처음엔 놀라서 봤는데, 대부분 의도된 대화라서 그냥 넘어가요. 알림이 너무 자주 떠서 무시하게 됐어요."

### 시나리오 3: 설정 유지보수
> **Q:** 훅 설정 변경이 필요했을 때 어떻게 하셨나요?
> 
> **A:** "JSON 수정하다가 실수해서 Claude Code가 안 켜졌어요. 30분 디버깅했네요."

---

## 개선 제안

### 1. 설정 자동화 스크립트

```bash
# setup-spyglass.sh
#!/bin/bash

# 1. SPYGLASS_DIR 감지
SPYGLASS_DIR="$(cd "$(dirname "$0")" && pwd)"

# 2. settings.json 자동 생성
cat > ~/.claude/settings.json << EOF
{
  "env": { "SPYGLASS_DIR": "$SPYGLASS_DIR" },
  "hooks": {
    "UserPromptSubmit": [{"hooks": [{"type": "command", "command": "bash $SPYGLASS_DIR/hooks/spyglass-collect.sh", "async": true, "timeout": 1}]}],
    "PreToolUse": [{"hooks": [{"type": "command", "command": "bash $SPYGLASS_DIR/hooks/spyglass-collect.sh", "async": true, "timeout": 1}]}],
    "PostToolUse": [{"hooks": [{"type": "command", "command": "bash $SPYGLASS_DIR/hooks/spyglass-collect.sh", "async": true, "timeout": 1}]}],
    "SessionStart": [{"hooks": [{"type": "command", "command": "bash $SPYGLASS_DIR/hooks/spyglass-collect.sh", "async": true, "timeout": 1}]}],
    "SessionEnd": [{"hooks": [{"type": "command", "command": "bash $SPYGLASS_DIR/hooks/spyglass-collect.sh", "async": true, "timeout": 1}]}],
    "Stop": [{"hooks": [{"type": "command", "command": "bash $SPYGLASS_DIR/hooks/spyglass-collect.sh", "async": true, "timeout": 1}]}]
  }
}
EOF

echo "설정 완료! Claude Code를 재시작하세요."
```

### 2. 단축키 커스터마이징

```typescript
// keybindings.ts
export const DEFAULT_KEYBINDINGS = {
  tabLive: 'F1',
  tabHistory: 'F2',
  tabAnalysis: 'F3',
  tabSettings: 'F4',
  quit: 'q',
  search: '/',
};

// ~/.spyglass/keybindings.json에서 로드
export function loadKeybindings() {
  try {
    const custom = JSON.parse(readFileSync(`${HOME}/.spyglass/keybindings.json`, 'utf-8'));
    return { ...DEFAULT_KEYBINDINGS, ...custom };
  } catch {
    return DEFAULT_KEYBINDINGS;
  }
}
```

### 3. 에러 상태 명확히 표시

```typescript
// fetchRecent 개선
const fetchRecent = useCallback(async () => {
  try {
    const res = await fetch(`${API_URL}/api/requests?limit=${MAX_RECENT}`);
    if (!res.ok) {
      setError(`Server error: ${res.status}`);
      return;
    }
    const json = await res.json();
    if (json.success && json.data) {
      setRecentRequests(json.data.slice(0, MAX_RECENT));
      setError(null);
    }
  } catch (e) {
    setError(`Connection failed: ${e.message}`);
  }
}, []);

// UI에 표시
{error && <Text color="red">⚠️ {error}</Text>}
```

### 4. TUI/웹 통합 또는 선택적 빌드

```json
// package.json
{
  "scripts": {
    "tui": "bun run packages/tui/src/index.tsx",
    "web": "bun run packages/server/src/index.ts && open http://localhost:9999",
    "build:tui-only": "bun build --target=node packages/tui/src/index.tsx",
    "build:web-only": "bun build --target=browser packages/web/index.html"
  }
}
```

---

## 실용성 점수: 5/10

**근거:**
- ✅ lazygit 스타일 UI는 터미널 사용자에게 친숙함
- ✅ 실시간 SSE 스트리밍은 "살아있는" 느낌을 줌
- ⚠️ F1~F4 키 충돌은 실제 사용성 저하
- ⚠️ 설정 복잡도는 진입장벽을 높임
- ❌ "내가 지금 몇 토큰 썼지?"보다 "이 작업을 마칠 수 있을까?"가 더 중요
- ❌ 초반 신기함 이후에는 잊고 사용하지 않게 됨

**사용자 인터뷰 요약:**
> "설치 후 한 달간 사용해 봤습니다. 초반에는 신기했지만, 금방 잊고 사용하지 않게 됐습니다. '내가 지금 몇 토큰 썼지?'보다 '이 작업을 마칠 수 있을까?'가 더 중요합니다."
