# model 컬럼 표시 개선 스펙

> 작성일: 2026-04-19  
> 작성자: 데이터 분석  
> 대상: ui-designer 서브에이전트  
> 관련 feature: collect-pipeline-refactor

---

## 배경 — 데이터 수집 변경 사항

`collect-pipeline-refactor` 작업으로 훅 스크립트의 정제 로직이 서버(TypeScript)로 이전됐다.
**결과적으로 `tool_call` 타입에도 model 값이 수집되기 시작했다.**

### 리팩터 이전

```
prompt     → model 수집 ✅ (transcript 파싱)
tool_call  → model 항상 NULL ❌ (조건 분기로 수집 안 함)
```

### 리팩터 이후

```
prompt                → model 수집 ✅
tool_call|event_type=tool     → model 수집 ✅ (PostToolUse, transcript 파싱)
tool_call|event_type=pre_tool → model 항상 NULL (PreToolUse, 응답 전이라 transcript 미갱신)
```

---

## DB 실측 데이터 (2026-04-19 기준)

### 이벤트 타입별 model 수집률

| type | event_type | 설명 | model 수집 가능 여부 |
|------|-----------|------|-------------------|
| `prompt` | `prompt` | 사용자 프롬프트 | ✅ 가능 (92.1%) |
| `tool_call` | `tool` | PostToolUse — 도구 실행 완료 | ✅ 가능 |
| `tool_call` | `pre_tool` | PreToolUse — 도구 실행 시작 | ❌ 불가 (응답 전) |

### 수집된 모델 종류

| 모델명 | 비고 |
|--------|------|
| `claude-sonnet-4-6` | 메인 모델 |
| `claude-haiku-4-5-20251001` | 서브에이전트(Agent) 사용 시 |
| `kimi-k2.5` | 외부 모델 (prompt 타입에서 확인) |
| `<synthetic>` | 합성 데이터 (1건) |

### tool_call 도구별 model 수집 가능 여부

| 도구 | model 수집 | 비고 |
|------|-----------|------|
| Bash | ✅ | PostToolUse transcript 파싱 |
| Read | ✅ | 동일 |
| Edit / MultiEdit | ✅ | 동일 |
| Write | ✅ | 동일 |
| Glob / Grep | ✅ | 동일 |
| Skill | ✅ | 동일 |
| Agent | ✅ | 서브에이전트 모델이 다를 수 있음 |
| ToolSearch | ✅ | 동일 |
| mcp__* | ✅ | 동일 |

> 현재 DB의 tool_call model 수집률이 낮아 보이는 이유: 대다수 레코드가 리팩터 이전 수집 데이터.
> 리팩터 이후 신규 수집 레코드는 정상 수집 확인됨.

---

## 현재 UI 문제점

`packages/web/assets/js/renderers.js:108`

```javascript
// 현재 코드 — prompt 타입만 model 표시
if (r.type !== 'prompt' || !r.model) {
  return `<td class="cell-model cell-empty">—</td>`;
}
return `<td class="cell-model"><span class="model-name">${escHtml(r.model)}</span></td>`;
```

**문제**: `r.type !== 'prompt'` 조건으로 tool_call 레코드는 model 값이 있어도 `—`로 표시됨.

---

## 개선 요청 사항

### 1. model 표시 조건 변경

```
현재: type === 'prompt' AND model 있음 → 표시
변경: model 있음 → 표시 (type 무관)
```

변경 후 표시 규칙:
- `model != null` → model 배지 표시
- `model == null` → `—` (pre_tool 이벤트 등)

### 2. tool_call row에서 model 표시 시 고려사항

- Agent 도구 사용 시 서브에이전트가 다른 모델(예: `claude-haiku-4-5-20251001`)을 쓸 수 있음
  → **같은 세션 내에서 모델이 달라질 수 있다는 것을 UI에서 직관적으로 인지 가능해야 함**
- model 배지는 현재 `prompt` row에만 노출됨. tool_call row에도 노출 시 시각적 밀도 증가 가능
  → 배지 크기·색상·위치 등 디자인 판단 필요

### 3. 수정 대상 파일

| 파일 | 수정 내용 |
|------|----------|
| `packages/web/assets/js/renderers.js:108` | `r.type !== 'prompt'` 조건 제거 |
| CSS 필요 시 | `td.cell-model` 스타일 조정 |
