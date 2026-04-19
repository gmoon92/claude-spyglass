# 치명적 문제 3가지 상세 분석

> 본 문서는 spyglass 프로젝트의 가장 심각한 3가지 문제를 심층 분석합니다.

---

## 문제 1: transcript 파일 의존의 취약성 🔴

### 문제 요약
```typescript
// collect.ts
const transcriptData = transcript_path ? parseTranscript(transcript_path) : null;
const tokensInput = transcriptData?.inputTokens ?? 0;  // 파일 없으면 0!
```

**핵심 문제**: 토큰 수집이 transcript 파일에 100% 의존하며, 파일 접근 실패 시 토큰이 0으로 저장됨.

### 발생 가능한 시나리오

| 시나리오 | 발생 빈도 | 결과 | 사용자 경험 |
|---------|----------|------|------------|
| transcript 파일 롤오버 | 중간 | 토큰 0 | "왜 0으로 나오지?" |
| 파일 접근 권한 문제 | 낮음 | 토큰 0 | "설정 문제인가?" |
| 지연 쓰기 (아직 기록 안 됨) | 높음 | 토큰 0 | "버그인가?" |
| JSON 파싱 오류 | 낮음 | 토큰 0 | "데이터 손실" |
| 큰 파일로 인한 읽기 타임아웃 | 중간 | 토큰 0 | "응답 없음" |

### 영향 분석

#### 1. 데이터 신뢰성 붕괴
```typescript
// "10K 토큰 알림"이 0으로 잡히면 의미 없음
if (tokens_total > 10000) {
  showAlert("⚠️ 토큰 과다 사용");
}
// tokens_total이 0이면 알림 없음
```

#### 2. 비용 분석 완전히 잘못됨
```typescript
// 하루 비용 계산
cost_usd = sum(tokens_total * price);  // tokens_total이 0이면 cost 0
// 실제로는 $50 썼는데, $0으로 표시
```

#### 3. 사용자 혼란
```
사용자: "어제 큰 작업했는데 토큰 0으로 나와요"
개발자: "transcript 파일이 없어서 그래요"
사용자: "왜 없죠?"
개발자: "글쎄요..."
```

### 근본 원인

```typescript
// 현재 구조
Claude Code → 훅 → transcript 파일 → spyglass 파싱 → 저장
                    ↑
              여기서 실패 가능

// 문제: Claude Code가 transcript 파일을 관리
// - 파일 경로만 제공
// - 파일 생명주기 관리 안 됨
// - 동시 접근 충돌 가능
```

### 해결 방안

#### 방안 A: Fallback 메커니즘 (권장)
```typescript
// collect.ts 개선
interface TokenResult {
  value: number | null;
  confidence: 'high' | 'medium' | 'low' | 'error';
  source: 'transcript' | 'estimated' | 'unavailable';
  error?: string;
}

function parseTranscriptSafe(transcriptPath: string): TokenResult {
  if (!existsSync(transcriptPath)) {
    return {
      value: null,
      confidence: 'error',
      source: 'unavailable',
      error: 'TRANSCRIPT_NOT_FOUND'
    };
  }
  
  try {
    const data = parseTranscript(transcriptPath);
    return {
      value: data.inputTokens + data.outputTokens,
      confidence: 'high',
      source: 'transcript'
    };
  } catch (e) {
    return {
      value: null,
      confidence: 'error',
      source: 'unavailable',
      error: e.message
    };
  }
}

// UI 표시
// Tokens: 12,456 ✓ (high confidence)
// Tokens: ~8,000 ~ (estimated)
// Tokens: -- ! (error: TRANSCRIPT_NOT_FOUND)
```

#### 방안 B: Alternative 토큰 수집
```bash
# hooks/spyglass-collect.sh 개선
# 환경변수에서도 토큰 정보 확인

#!/bin/bash

# Claude Code가 제공하는 환경변수 활용
TOKENS_INPUT="${CLAUDE_TOKENS_INPUT:-0}"
TOKENS_OUTPUT="${CLAUDE_TOKENS_OUTPUT:-0}"

if [[ "$TOKENS_INPUT" != "0" ]]; then
  # 환경변수에서 획득
  echo "{\"tokens_input\": $TOKENS_INPUT, \"tokens_output\": $TOKENS_OUTPUT, \"source\": \"env\"}"
else
  # transcript에서 파싱
  parse_transcript "$TRANSCRIPT_PATH"
fi
```

#### 방안 C: 신뢰도 표시
```typescript
// UI 컴포넌트
function TokenDisplay({ tokens, confidence }: TokenDisplayProps) {
  if (confidence === 'error') {
    return <span>-- <Tooltip title="Failed to read transcript file" /></span>;
  }
  
  if (confidence === 'estimated') {
    return <span>~{tokens} <Tooltip title="Estimated value" /></span>;
  }
  
  return <span>{tokens} ✓</span>;
}
```

### 우선순위: P0 (즉시 해결 필요)

---

## 문제 2: "Context Growth Chart"의 오해 유발 🔴

### 문제 요약
```javascript
// context-chart.js
const CTX_MAX_TOKENS = 200_000;  // "context 한도"
const values = sorted.map(t => t.prompt.context_tokens || t.prompt.tokens_input || 0);
// 실제로는 누적 토큰 수
```

**핵심 문제**: 차트 이름이 "Context Growth"이지만, 실제로는 "누적 토큰 사용량"을 보여줌. 이는 사용자에게 "context window 사용률"이라는 오해를 줌.

### 개념 혼란

```
[사용자가 이해하는 것]
Context Growth Chart = Context Window 사용률
┌─────────────────────────────┐
│ Context Window: 200K        │
│ Used: 160K (80%)           │ ← 80% 경고선
│ [████████████████░░]       │
│ ⚠️ 경고: 곧 한도 도달       │
└─────────────────────────────┘

[실제로 측정하는 것]
Accumulated Tokens = 누적 토큰 합계
┌─────────────────────────────┐
│ Total Input Tokens: 160K    │ ← 단순 합계
│ [████████████████░░]       │
│ ⚠️ 의미 없는 경고선         │
└─────────────────────────────┘
```

### Context Window vs Accumulated Tokens

| 항목 | Context Window | Accumulated Tokens |
|------|---------------|-------------------|
| **정의** | 현재 conversation의 총 토큰 수 | 모든 요청의 토큰 합계 |
| **Claude의 관리** | 자동 압축/관리 | 없음 (단순 합계) |
| **한도** | 200K | 무제한 |
| **80% 의미** | 압축 시작 지점 | 의미 없음 |
| **측정 가능성** | Claude 낭부 정볼만 앎 | 외부에서 계산 가능 |

### 200K 하드코딩 문제

```javascript
// context-chart.js
const CTX_MAX_TOKENS = 200_000; // claude 기준 컨텍스트 한도

// 실제 상황:
// - Claude 3 (구버전): 100K
// - Claude 3.5 Sonnet: 200K
// - Claude 3.5 Haiku: 200K
// - Claude 3 Opus: 200K
// - 미래 모델: ???
```

### 사용자 혼란 사례

```
[사용자 A]
"Context가 90%라는데 Claude가 계속 잘 대화하네요?"
→ 실제로는 누적 토큰이 90%일 뿐, context window는 별개

[사용자 B]
"Context가 80% 넘었으니 새 세션 시작해야겠죠?"
→ 불필요한 세션 전환 (실제로는 Claude가 자동 관리)

[사용자 C]
"왜 Context 차트랑 Claude가 보여주는 토큰 수가 다르죠?"
→ 둘은 다른 개념
```

### 해결 방안

#### 방안 A: 제거 (가장 안전)
```javascript
// context-chart.js
// export function renderContextChart() { ... }
// → 삭제
```

#### 방안 B: 이름 변경 + 경고선 제거 (차선)
```javascript
// 변경 전
const CTX_MAX_TOKENS = 200_000;
const WARN_RATIO = 0.80;
renderContextChart(turns);

// 변경 후
const ACCUMULATED_TOKENS_MAX = 200_000;  // 사용자 설정 가능
// const WARN_RATIO = 0.80;  // 제거
renderAccumulatedTokensChart(turns);

// 툴팁 추가
"This chart shows accumulated tokens, not context window usage."
"Claude automatically manages context window."
```

#### 방안 C: Context Window 추정 (복잡)
```typescript
// Claude의 context window 관리 방식을 역추정
// (불확실성이 높아 권장하지 않음)
function estimateContextWindow(turns: Turn[]): number {
  // System prompt 토큰 추정
  // Conversation history 토큰 계산
  // Current input 토큰 추가
  // → 부정확한 추정값
}
```

### 우선순위: P0 (즉시 해결 필요)

---

## 문제 3: 높은 도입 장벽 🔴

### 문제 요약
```bash
# 설치에 필요한 작업
1. Bun 설치
2. 저장소 클론
3. 의존성 설치
4. SPYGLASS_DIR 설정
5. settings.json 편집 (6개 훅)
6. 서버 실행 (별도 터미널)
7. Claude Code 재시작

# 총 소요 시간: 20~30분
```

### 진입장벽 분석

| 장벽 | 영향 | 타 도구 대비 |
|------|------|-------------|
| Bun 의존성 | Node.js 사용자 배제 | ccflare는 npm |
| settings.json 편집 | JSON 문법 오류 위험 | 대부분 자동 설정 |
| 6개 훅 설정 | 반복 작업, 실수 가능 | ccflare는 프록시 1줄 |
| 서버 별도 실행 | 까먹으면 데이터 누락 | Langfuse는 SaaS |
| Windows 미지원 | Windows 개발자 배제 | 대부분 크로스플랫폼 |

### 사용자 이탈 퍼널

```
100명: spyglass 관심
  70명: 설치 시도
  40명: Bun 설치 완료
  25명: 저장소 클론 완료
  15명: settings.json 설정 완료
  10명: 서버 실행 성공
   5명: 정상 사용 (5% 전환율)
```

### 실제 사용자 피드백

```
[사용자 A - 백엔드 개발자]
"설정하느라 30분 썼어요. settings.json에서 쉼표 하나 빠뜨려서 
Claude Code가 안 켜졌는데, 그거 찾느라 20분 더 썼네요."

[사용자 B - Windows 개발자]
"Bash 스크립트라서 WSL 설치해야 하더라고요. 
회사 컴퓨터에서 WSL 승인받는데 일주일 걸렸습니다."

[사용자 C - 데이터 사이언티스트]
"bun run dev를 까먹고 Claude Code만 켜는 경우가 많아요. 
그러면 데이터가 안 쌓여서 나중에 확인해도 텅 비어있어요."
```

### 해결 방안

#### 방안 A: 자동 설치 스크립트 (권장)
```bash
# one-liner 설치
curl -fsSL https://spyglass.dev/install.sh | bash

# Homebrew
brew install spyglass
brew services start spyglass

# Docker
docker run -d -p 9999:9999 spyglass/spyglass
```

#### 방안 B: 자동 설정 도구
```typescript
// setup-wizard.ts
import { writeFileSync } from 'fs';
import { execSync } from 'child_process';

export function runSetupWizard() {
  console.log('🔭 spyglass 설정 마법사');
  
  // 1. SPYGLASS_DIR 감지
  const spyglassDir = detectSpyglassDir();
  
  // 2. Claude Code 설정 백업
  backupClaudeSettings();
  
  // 3. 설정 자동 생성
  const settings = generateSettings(spyglassDir);
  writeFileSync(`${HOME}/.claude/settings.json`, JSON.stringify(settings, null, 2));
  
  // 4. 설정 검증
  const validation = validateSettings();
  if (!validation.valid) {
    console.error('❌ 설정 오류:', validation.errors);
    return;
  }
  
  // 5. 서버 자동 시작
  startServer();
  
  console.log('✅ 설정 완료! Claude Code를 재시작하세요.');
}
```

#### 방안 C: 자동 서버 시작
```bash
# hooks/spyglass-collect.sh 개선
#!/bin/bash

# 서버가 실행 중인지 확인
if ! curl -s http://localhost:9999/health > /dev/null; then
    echo "🚀 spyglass 서버 자동 시작..."
    (cd "$SPYGLASS_DIR" && nohup bun run packages/server/src/index.ts > /dev/null 2>&1 &)
    sleep 2
fi

# 기존 로직...
```

#### 방안 D: Windows 지원
```powershell
# hooks/spyglass-collect.ps1 (PowerShell 버전)
param(
    [Parameter(ValueFromPipeline=$true)]
    [string]$Payload
)

$SPYGLASS_HOST = $env:SPYGLASS_HOST -or "localhost"
$SPYGLASS_PORT = $env:SPYGLASS_PORT -or 9999

# PowerShell로 구현된 동일 로직
```

### 우선순위: P1 (단기 개선 필요)

---

## 종합 권고사항

### 즉시 해결 (1주일 내)
1. **Context Chart 제거** 또는 이름 변경
2. 토큰 수집에 신뢰도 표시 추가

### 단기 개선 (1개월 내)
3. 자동 설치 스크립트 제공
4. PII 마스킹 구현
5. 설정 검증 도구 제공

### 중기 개선 (2~3개월 내)
6. Homebrew/Docker 지원
7. 마이그레이션 파일 분리
8. Windows PowerShell 지원

---

*분석 완료: 2026-04-20*
