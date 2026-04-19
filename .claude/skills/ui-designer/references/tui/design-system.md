# Design System — TUI (터미널 UI)

> 공통 토큰: `../common/design-tokens.md` 참조
> **TUI 개발 착수 시 이 문서를 먼저 현행화하세요.**

---

## 기술 스택

- **렌더링 엔진**: [Ink](https://github.com/vadimdemedes/ink) (React for CLI)
- **패키지 위치**: `packages/tui/src/`
- **진입점**: `packages/tui/src/index.tsx`

---

## 레이아웃 기준

| 항목 | 값 |
|------|-----|
| 기준 터미널 너비 | **80칼럼** |
| 사이드바 너비 | `25칼럼` 고정 |
| 메인 패널 너비 | `55칼럼` (80 - 25) |

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ HEADER (1행)                                                                │
├────────────────────────┬────────────────────────────────────────────────────┤
│ SIDEBAR (25칼럼)        │ MAIN PANEL (55칼럼)                               │
│                        │                                                    │
│  Projects              │  [F1 Live] [F2 Sessions] [F3 Tools]               │
│  Sessions              │                                                    │
│  Tool Stats            │  로그 리스트 / 세션 상세                           │
│                        │                                                    │
├────────────────────────┴────────────────────────────────────────────────────┤
│ FOOTER (1행)  단축키 안내                                                   │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Ink 컴포넌트 규칙

### 기본 레이아웃

```tsx
// 수직 배치
<Box flexDirection="column">
  <Text>...</Text>
</Box>

// 수평 배치
<Box flexDirection="row">
  <Box width={25}>...</Box>  {/* 사이드바 */}
  <Box flexGrow={1}>...</Box> {/* 메인 */}
</Box>
```

### 테두리

```tsx
<Box borderStyle="single">...</Box>   // ─┐ 스타일
<Box borderStyle="round">...</Box>    // ╭╮ 스타일
```

### 색상 사용

```tsx
// 텍스트 색상 (CSS 없음, prop으로 직접 지정)
<Text color="#d97757">accent text</Text>
<Text color="#4ade80">success</Text>
<Text color="#888">muted text</Text>
<Text dimColor>dim text</Text>
<Text bold>bold text</Text>
```

### 타입 색상 (ADR-003 SSoT)

```tsx
const TYPE_COLORS = {
  prompt:    { text: '#e8a07a', bg: 'transparent' },
  tool_call: { text: '#6ee7a0', bg: 'transparent' },
  system:    { text: '#fbbf24', bg: 'transparent' },
};
```

---

## 컴포넌트 패턴

### 탭 내비게이션

```
[F1 Live]  [F2 Sessions]  [F3 Tools]
```

```tsx
// 선택된 탭: accent 색상
<Text color="#d97757" bold>[F1 Live]</Text>
// 미선택 탭: text-dim
<Text color="#505050">[F2 Sessions]</Text>
```

### 프로그레스 바

```
████████░░░░░░░░░░  45.2K / 100K
```

```tsx
const filled = Math.round((value / max) * barWidth);
const empty  = barWidth - filled;
const bar = '█'.repeat(filled) + '░'.repeat(empty);
<Text>{bar}  {formatToken(value)} / {formatToken(max)}</Text>
```

### 상태 배지

```
● LIVE     ← green
○ OFFLINE  ← text-dim
```

```tsx
<Text color={connected ? '#4ade80' : '#505050'}>
  {connected ? '● LIVE' : '○ OFFLINE'}
</Text>
```

### 타입 배지

```
[P]  [T]  [S]
```

```tsx
const TYPE_ABBR = { prompt: 'P', tool_call: 'T', system: 'S' };
<Text color={TYPE_COLORS[type].text}>[{TYPE_ABBR[type]}]</Text>
```

### 섹션 헤더

```
── PROJECTS ──────────────
```

```tsx
<Text color="#505050" bold>── PROJECTS {'─'.repeat(padding)}</Text>
```

---

## 유틸리티 재사용

| 유틸 | 위치 | 용도 |
|------|------|------|
| `TokenFormatter` | `src/formatters.ts` | 토큰 수 포맷 (1.2k, 3.4M) |
| `TimeFormatter` | `src/formatters.ts` | 시간 포맷 (1s, 230ms, 2분 전) |

---

## 키보드 단축키 정책

| 키 | 동작 |
|----|------|
| `F1` | Live 뷰 |
| `F2` | 세션 목록 |
| `F3` | 툴 통계 |
| `↑↓` | 목록 탐색 |
| `Enter` | 선택/확장 |
| `Esc` | 뒤로가기 |
| `q` | 종료 |

---

## 구현 규칙

- `<Box>` / `<Text>` 기본 컴포넌트 사용
- 80칼럼 기준 — 넘치면 truncate 처리
- 색상은 CSS 없이 Ink `color` prop만 사용
- 터미널 최소 크기: 80×24 (경고 표시 후 동작)
- `process.stdout.columns`로 실제 너비 감지하여 동적 조정
