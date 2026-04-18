# [UI/UX 분석] ccflare vs claude-spyglass 비교 분석

> **관점:** UI/UX 전문가  
> **핵심 질문:** 화면 표시 항목의 완성도, 시각화 효과, 인터랙션 개선점은?

---

## Round 1: 현황 분석

### 1-1. UI 기술 스택 비교

| 항목 | ccflare | claude-spyglass |
|------|---------|-----------------|
| 프레임워크 | React + 컴포넌트 분리 | 바닐라 JS + 단일 HTML |
| 스타일링 | CSS 모듈 (추정) | 인라인 CSS (1,663줄) |
| 차트 라이브러리 | 별도 라이브러리 (추정) | SVG 직접 드로잉 |
| 반응형 | 지원 여부 불명 | 제한적 |
| 상태관리 | React 상태 | 전역 JS 변수 |

---

### 1-2. ccflare 화면 항목 목록

#### 요청 목록 테이블 (RequestsTab)

| 컬럼 | 표시 형식 | 예시 |
|------|----------|------|
| Timestamp | ISO + 상대시간 | "2 mins ago" |
| Method | 배지 | POST |
| Path | 텍스트 | /v1/messages |
| Account | 이름 | Account A |
| Status | 색상 배지 | 200 / 429 / 500 |
| Model | 텍스트 | claude-sonnet-4-6 |
| Input Tokens | 숫자 포맷 | 1,234 |
| Output Tokens | 숫자 포맷 | 567 |
| Cache Read | 숫자 포맷 | 890 |
| Cache Creation | 숫자 포맷 | 234 |
| Total Tokens | 숫자 포맷 | 2,925 |
| Tok/s | 소수 1자리 | 125.3 tok/s |
| Cost | 4자리 소수 | $0.0234 |
| Response Time | 포맷 | 1.2s |
| Agent | 이름 | researcher |

#### 통계 패널 (StatsPresenter)

| 항목 | 설명 |
|------|------|
| 성공률 | % 표시 |
| 평균 응답 시간 | ms/s |
| 총 토큰 | 누적 |
| 총 비용 | USD |
| 평균 tok/s | 생성 속도 |
| 상위 모델 | 사용 빈도순 |

#### 상세 모달 (RequestDetailsModal) — 5탭

| 탭 | 내용 |
|----|------|
| Conversation | 대화 형식으로 요청/응답 포맷 |
| Request | 헤더 + 바디 (base64 디코드) |
| Response | 상태코드 + 헤더 + 바디 |
| Metadata | accountId, agentUsed, retry, rateLimited |
| Token Usage | 토큰 상세 분석 시각화 |

---

### 1-3. claude-spyglass 화면 항목 목록

#### Header 상단 바

| 항목 | ID | 데이터 |
|------|----|----|
| 라이브 배지 | — | SSE 연결 상태 (LIVE/OFFLINE) |
| 날짜 필터 | — | 전체 / 오늘 / 이번주 |
| 마지막 갱신 | — | "xx초 전 갱신" |

#### Summary Strip (5개 핵심 지표)

| 항목 | ID | 포맷 |
|------|----|----|
| 총 세션 수 | statSessions | 숫자 |
| 총 요청 수 | statRequests | 숫자 |
| 총 토큰 수 | statTokens | "1.2k", "1.5M" |
| 활성 세션 수 | statActive | 녹색 강조 |
| 평균 응답 시간 | statAvgDuration | "123ms", "1.2s" |

#### Left Panel — 프로젝트 목록

| 컬럼 | 포맷 |
|------|------|
| 프로젝트명 | 클릭 → 세션 필터 |
| 세션 수 | 숫자 |
| 토큰 | 토큰 바 시각화 |

#### Left Panel — 세션 목록

| 항목 | 포맷 |
|------|------|
| 세션 ID | 8자리 단축 |
| 상대 시간 | "5분 전" |
| 토큰 | fmtToken() |
| 상태 | ● 진행중 / ○ 종료 |
| 첫 프롬프트 미리보기 | 60자 + "…" |

#### Left Panel — 도구 통계

| 컬럼 | 포맷 |
|------|------|
| 도구명 | Bash / Read / Edit 등 |
| 호출 수 | 숫자 |
| 평균 토큰 | fmtToken() |
| 호출 비율 | 가로 진행 바 |

#### Right Panel — 차트 섹션

| 차트 | 내용 | 데이터 |
|------|------|--------|
| Timeline | 최근 30분 요청 추이 | 1분 버킷 30개, 꺾은선 + 영역 |
| Donut | 요청 타입 비율 | prompt/tool_call/system 색상 분리 |

#### Right Panel — 요청 테이블 (플랫 뷰)

| 컬럼 | 포맷 | 조건 |
|------|------|------|
| 시각 | 상대시간 + 정확시각 | 항상 |
| 타입 | 컬러 배지 | prompt(주황)/tool_call(녹)/system(노란) |
| 모델 | 소형 텍스트 | 있을 때만 |
| 캐시 배지 | ⚡{tokens} | cache_read_tokens > 0 |
| 미리보기 | 60자 | tool_detail 또는 prompt |
| 도구명 | 아이콘 + 이름 | tool_call 타입 |
| 입력 토큰 | fmtToken() | tokens_input > 0 ? 값 : '—' |
| **출력 토큰** | fmtToken() | **tokens_output > 0 ? 값 : '—'** |
| 응답 시간 | formatDuration() | duration_ms > 0 ? 값 : '—' |
| 세션 ID | 12자리 단축 | 항상 |

#### 세션 상세 — 턴 뷰 (spyglass 독창)

```
T{순번}  |  {시간}  |  도구 N개  ·  IN {tokens} / OUT {tokens}  ·  ⏱ {time}
 ├── [prompt] USER | {model} | ⚡{cache_read} · "{미리보기}"
 ├── [tool_call] 🔧 {tool_name} | "{tool_detail}"
 └── ...
```

- 토큰 바: 세션 전체 대비 Turn 비율 시각화
- 최고 비용 Turn 배지: "T3 (12.4k)"
- 최다 호출 도구 배지: "Bash (47회)"

---

## Round 2: 갭 분석 및 보완

> ⚠️ **Claude Code 소스 직접 검증 후 수정된 내용**

### 2-1. 표시 항목 갭 매트릭스

| UI 항목 | ccflare | spyglass | 실제 상태 | 우선순위 |
|--------|---------|---------|---------|---------|
| output_tokens 표시 | ✅ 정상 | ❌ **항상 '—'** | DB에 항상 0 저장 | **P0** |
| 캐시 배지 (⚡) | ❌ 별도 컬럼 | ❌ **표시 안됨** | DB에 항상 0 저장 | **P0** |
| 비용($) 표시 | ✅ $0.0234 | ❌ 없음 | 미구현 | **P1** |
| tok/s 속도 표시 | ✅ 125.3 tok/s | ❌ 없음 | 미구현 | P2 |
| 성공/실패 상태 | ✅ 색상 배지 | ❌ 없음 | 미구현 | P1 |
| 에러 메시지 | ✅ 표시 | ❌ 없음 | 미구현 | P1 |
| 상세 모달 | ✅ 5탭 | ❌ 없음 | 미구현 | P2 |
| 대화 형식 뷰 | ✅ Conversation 탭 | ❌ 없음 | 미구현 | P2 |
| 데이터 삭제 UI | ✅ API | ❌ 없음 | 미구현 | P1 |
| Turn 그룹화 뷰 | ❌ | ✅ 독창 | 정상 동작 | spyglass 강점 |
| 도구 통계 패널 | ❌ | ✅ | 정상 동작 | spyglass 강점 |
| Timeline 차트 | ❌ | ✅ SVG | 정상 동작 | spyglass 강점 |
| 프로젝트 분류 | ❌ | ✅ | 정상 동작 | spyglass 강점 |
| 날짜 필터 | ❌ 불명 | ✅ 전체/오늘/이번주 | 정상 동작 | spyglass 강점 |

### 2-2. 토큰 데이터 표시 오류 전체 범위 및 UX 임팩트

**[확인된 사실] output_tokens 뿐 아니라 cache_tokens도 항상 0:**

```javascript
// index.html 캐시 배지 렌더링 조건
if (r.cache_read_tokens > 0) {  // 항상 false → 배지 미표시
  // "⚡{cache_read_tokens}" 배지
}

// output 토큰 렌더링 조건
${r.tokens_output > 0 ? fmtToken(r.tokens_output) : '—'}  // 항상 '—'

// 턴 뷰 OUT 표시 조건
const outPart = tokOut > 0 ? ` / OUT ${fmtToken(tokOut)}` : '';  // 항상 빈 문자열
```

**사용자가 보는 실제 현상:**
- 요청 테이블 "출력 토큰" 컬럼: **모두 `—`**
- 턴 뷰 `IN xxx / OUT —`: **OUT 부분 미표시**
- 캐시 절약 배지 ⚡: **전혀 표시 안됨** (캐시를 매우 많이 활용해도)
- Summary Strip "총 토큰": **실제보다 크게 과소 집계** (input만)

**UX 영향도:** 매우 높음 — 핵심 지표 3가지가 동시에 broken

### 2-3. spyglass 독창 UI 강점 분석

#### Turn 뷰의 가치

ccflare는 HTTP 요청 단위로만 보여주므로 "이 프롬프트가 어떤 도구를 몇 번 호출했는가"를 알 수 없다. spyglass의 Turn 뷰는:

```
T3  |  14:32:15  |  도구 7개  ·  IN 4.2k / OUT 890  ·  ⏱ 45.2s
 ├── [prompt] USER | claude-sonnet-4-6 | "파일 구조 분석해줘"
 ├── [tool_call] 📁 Glob | src/**/*.ts
 ├── [tool_call] 📖 Read | packages/server/src/index.ts
 ├── [tool_call] 🔍 Grep | "createRequest"
 ├── [tool_call] ✏️  Edit | packages/storage/src/queries/request.ts
 ├── [tool_call] 🔧 Bash | bun run build
 └── [tool_call] 🔧 Bash | bun test
```

→ 개발자가 Claude Code가 "어떻게 일했는지"를 그대로 추적할 수 있음

#### 도구 통계 패널의 가치

```
Bash     47회  avg 234 tok  ████████████████████░░
Read     31회  avg 1.2k tok ████████████░░░░░░░░░░
Edit     18회  avg 89 tok   ███████░░░░░░░░░░░░░░░
Agent     5회  avg 8.4k tok ██░░░░░░░░░░░░░░░░░░░░
```

→ 어떤 도구에 토큰이 집중되는지 한눈에 파악

---

## Round 3: 고도화 제안

### 3-1. P0 — 토큰 데이터 수집 전면 수정 (transcript 방식)

**UI 변경 불필요** — 수집만 고치면 표시 조건 로직(`> 0`)이 자동으로 동작함.

수집 개선 (`hooks/spyglass-collect.sh`):

```bash
# 기존 코드 (잘못된 가정):
# local cache_creation_tokens="${CLAUDE_API_USAGE_CACHE_CREATION_INPUT_TOKENS:-0}"  # 항상 0
# local cache_read_tokens="${CLAUDE_API_USAGE_CACHE_READ_INPUT_TOKENS:-0}"           # 항상 0

# 올바른 코드 (transcript_path 파싱):
extract_usage_from_transcript() {
    local transcript_path="$1"
    [[ -f "$transcript_path" ]] || { echo "0,0,0,0"; return; }
    grep '"type":"assistant"' "$transcript_path" | tail -1 \
      | python3 -c "
import sys, json
d = json.loads(sys.stdin.read())
u = d.get('message', {}).get('usage', {})
print(f\"{u.get('input_tokens',0)},{u.get('output_tokens',0)},{u.get('cache_creation_input_tokens',0)},{u.get('cache_read_input_tokens',0)}\")
" 2>/dev/null || echo "0,0,0,0"
}

transcript_path=$(echo "$payload" | jq -r '.transcript_path // empty')
if [[ -n "$transcript_path" && -f "$transcript_path" ]]; then
    usage=$(extract_usage_from_transcript "$transcript_path")
    tokens_input=$(echo "$usage"   | cut -d',' -f1)
    tokens_output=$(echo "$usage"  | cut -d',' -f2)
    cache_creation_tokens=$(echo "$usage" | cut -d',' -f3)
    cache_read_tokens=$(echo "$usage"     | cut -d',' -f4)
fi
```

이 수정 적용 후 자동으로 정상화되는 UI:
- ✅ 출력 토큰 컬럼: `—` → 실제 숫자
- ✅ 캐시 배지 ⚡: 미표시 → `⚡85,020`
- ✅ 턴 뷰 OUT: 빈값 → `OUT 120`
- ✅ 총 토큰 집계: 과소 → 정확한 값

### 3-2. P1 — 비용 표시 추가

```javascript
// Summary Strip에 추가
<div class="stat-item">
  <div class="stat-value" id="statCost">$0.0000</div>
  <div class="stat-label">총 비용</div>
</div>

// 요청 테이블에 컬럼 추가
<th>비용</th>
// ...
<td>${r.cost_usd > 0 ? '$' + r.cost_usd.toFixed(4) : '—'}</td>
```

### 3-3. P1 — 성공/실패 상태 표시

```javascript
// 현재: 타입 배지만 있음
// 제안: stop_reason 기반 상태 표시

const stopReasonBadge = (reason) => {
  if (!reason) return '';
  const map = {
    'end_turn':   { label: 'OK',    color: '#4ade80' },
    'tool_use':   { label: 'TOOL',  color: '#60a5fa' },
    'max_tokens': { label: 'LIMIT', color: '#f59e0b' },
    'error':      { label: 'ERR',   color: '#f87171' },
  };
  const s = map[reason] ?? { label: reason, color: '#9ca3af' };
  return `<span class="badge" style="color:${s.color}">${s.label}</span>`;
};
```

### 3-4. P2 — 페이로드 상세 모달 (ccflare 참고)

```html
<!-- 요청 행 클릭 시 모달 -->
<div id="detailModal" class="modal">
  <div class="modal-tabs">
    <button data-tab="conversation">대화</button>
    <button data-tab="raw">원본 JSON</button>
    <button data-tab="tokens">토큰 상세</button>
  </div>
  
  <!-- 대화 탭: 메시지 형식 렌더링 -->
  <div class="tab-content" id="tab-conversation">
    <!-- user/assistant 메시지 버블 형식 -->
  </div>
  
  <!-- 토큰 상세 탭 -->
  <div class="tab-content" id="tab-tokens">
    <div>Input:    {tokens_input} tok</div>
    <div>Output:   {tokens_output} tok</div>
    <div>Cache↑:   {cache_creation} tok (+25%)</div>
    <div>Cache↓:   {cache_read} tok (-90%)</div>
    <div>비용 추정: ${cost_usd}</div>
  </div>
</div>
```

### 3-5. P2 — tok/s 생성 속도 표시

```javascript
// 계산: output_tokens / (duration_ms / 1000)
const tokPerSec = (r.tokens_output > 0 && r.duration_ms > 0)
  ? (r.tokens_output / (r.duration_ms / 1000)).toFixed(1)
  : null;

// 표시: "89.3 tok/s"
```

### 3-6. P3 — UX 개선 아이디어

| 아이디어 | 설명 | 복잡도 |
|---------|------|--------|
| 세션 비교 | 두 세션을 나란히 토큰/도구 비교 | 중간 |
| 모델별 필터 | "claude-sonnet만 보기" | 낮음 |
| 주간 리포트 | 7일간 토큰/비용 추이 | 중간 |
| 검색 | 프롬프트 내용 검색 | 낮음 |
| 북마크 | 특정 세션/Turn 저장 | 낮음 |
| 다크/라이트 전환 | 테마 토글 | 낮음 |

---

## Round 3: spyglass UX 강점 유지 전략

spyglass는 ccflare를 "참고하여 개발"했지만, 실제로는 **개발자 워크플로우 추적**이라는 독자적 사용 목적을 가지고 있어 다음 강점을 유지해야 한다:

1. **Turn 뷰** — Claude Code의 reasoning 흐름 시각화. ccflare에 없는 핵심 차별점
2. **도구 통계** — 어떤 도구를 얼마나 자주 쓰는지 파악
3. **세션 + 프로젝트 계층** — 작업 맥락 보존
4. **캐시 배지 (⚡)** — 캐시 효율을 인라인으로 즉시 확인

이 강점들은 ccflare의 기능을 추가하면서도 **희석시키지 않도록** 레이아웃 설계가 중요하다.
