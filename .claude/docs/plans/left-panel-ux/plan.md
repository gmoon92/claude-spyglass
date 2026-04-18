# Left Panel UX 개선 계획

## 배경

Web UI (`packages/web/index.html`) 왼쪽 패널은 3개의 섹션으로 구성된다:
- **프로젝트** 패널 (`1fr`)
- **세션** 패널 (`1fr`)
- **툴 통계** 패널 (`auto`, max-height: 160px)

## 문제

### 현재 구현 (`grid-template-rows: 1fr 1fr auto`)

툴 통계 섹션은 데이터 유무에 따라 `display: none` ↔ `display: ''`로 토글된다.
데이터가 로드되면 툴 통계 패널이 갑자기 나타나 나머지 두 패널의 높이가 줄어든다.
이로 인해 레이아웃이 흔들려 사용자가 불편함을 느낀다.

### 증상
1. 초기 로드: 프로젝트/세션 패널이 `1fr:1fr`로 동등 분할
2. SSE로 툴 데이터 도착: 툴 통계 패널 등장 (최대 160px)
3. 프로젝트/세션 패널이 `1fr:1fr`로 나머지 공간 재분할 → **레이아웃 점프**

## 현재 코드

**파일**: `packages/web/index.html`

```css
.left-panel {
  display: grid;
  grid-template-rows: 1fr 1fr auto;  /* 문제: auto 섹션이 나타날 때 레이아웃 흔들림 */
  overflow: hidden;
}

.tool-stats-section { max-height: 160px; }
```

```javascript
function renderTools(list) {
  const section = document.getElementById('toolStatsSection');
  if (!list.length) { 
    section.style.display = 'none';  /* 문제: 갑작스러운 표시/숨김 */
    return; 
  }
  section.style.display = '';
  // ...
}
```

## 요구사항

- 데이터 로드/업데이트 시 레이아웃 점프 제거
- 프로젝트/세션/툴 패널 모두 안정적으로 항상 표시
- 각 섹션은 자체 스크롤 유지
- 초기 로드 상태(스켈레톤)에서 최종 상태까지 UI 크기 변화 없음

## 기술 스택

- **파일**: `packages/web/index.html` (단일 파일 SPA)
- **CSS**: Vanilla CSS (CSS Grid, Flexbox)
- **JS**: Vanilla JavaScript (SSE, DOM 조작)
- **의존성**: 없음 (라이브러리 미사용)
