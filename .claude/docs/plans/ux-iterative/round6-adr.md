# Round 6 UX ADR — 요청 행 컴포넌트화 & 표시 항목 통일

**날짜**: 2026-04-18  
**참여자**: Geunmyeong(개발), Bora(디자인), Hyunwoo(QA)

---

## 사용 회의

### 관찰된 문제들

**Geunmyeong**: "요청 행(request row) HTML 템플릿이 코드에 4군데 중복돼 있어. `renderRequests`, `appendRequests`, `prependRequest`, `renderDetailRequests` 각각 따로 구현. 컬럼 수도 전역 7개, 상세 6개로 달라서 colspan 상수까지 두 개(`FLAT_VIEW_COLS=6`, `RECENT_REQ_COLS=7`) 따로 관리 중이야."

**Bora**: "전역 최근 요청 피드에는 model 배지가 없고, 세션 상세 플랫 뷰에는 있어. 같은 데이터인데 보이는 게 달라. cache hit 배지(⚡)도 상세 뷰에만 나오고 피드에는 없음. 정보 일관성이 없어."

**Hyunwoo**: "캐시 배지가 인라인 스타일로 박혀 있어 (`style=\"background:rgba(96,165,250,0.18);color:#93c5fd\"`). CSS 클래스 없음. 다른 배지(`.role-badge`, `.model-badge`)는 클래스가 있는데 혼자 인라인이야."

**Bora**: "세션 상세 플랫 뷰의 시각 컬럼이 `fmtDate`(초 단위 표시)를 쓰고, 전역 피드는 `fmtTimestamp`(상대시간 표시)를 써. 같은 컬럼 헤더 `시각`인데 포맷이 달라."

---

## 결정 사항

### ADR-R6-001: `makeRequestRow(r, opts)` 단일 함수로 통일

**결정**: 요청 행 HTML을 생성하는 `makeRequestRow(r, opts)` 함수를 만들고, 4개의 중복 구현을 모두 이 함수로 교체한다.

**구조**:
```
makeRequestRow(r, { showSession: bool, fmtTime: fn })
```

- `showSession: true` → 세션 컬럼 포함 (7열, 전역 피드)
- `showSession: false` → 세션 컬럼 생략 (6열, 세션 상세)
- `fmtTime` → 시각 포맷 함수 주입 (기존 포맷 유지)

**이유**: 한 곳만 수정하면 모든 뷰에 반영됨. colspan 상수도 showSession 옵션으로 통일.

### ADR-R6-002: 전역 피드에도 model · cache 배지 표시

**결정**: `makeTypeCell(r)` 함수를 추출해 model 배지, cache 배지, prompt 미리보기를 항상 포함한다. 두 뷰 모두 동일 함수 사용.

**이유**: 같은 데이터를 같은 방식으로 표시한다. "빼거나 수정하지 않고" 전역 피드에 추가하는 것.

### ADR-R6-003: `.badge-cache` CSS 클래스 추가

**결정**: cache hit 배지의 인라인 스타일을 `.badge-cache` CSS 클래스로 대체한다.

```css
.badge-cache {
  display:inline-block; padding:1px 5px; border-radius:3px;
  font-size:9px; font-weight:600; letter-spacing:0.3px;
  background:rgba(96,165,250,0.18); color:#93c5fd;
  margin-left:2px; vertical-align:middle; white-space:nowrap;
}
```

**이유**: 모든 배지를 CSS 클래스로 관리. 인라인 스타일 제거.

### ADR-R6-004: 테이블 셀 시맨틱 클래스 추가

**결정**: `.cell-time`, `.cell-token`, `.cell-sess` CSS 클래스를 추가해 td에 적용한다.

```css
.cell-time  { white-space:nowrap; }
.cell-token { text-align:right; font-variant-numeric:tabular-nums; }
.cell-sess  { max-width:120px; }
```

**이유**: HTML 구조와 시각 스타일을 분리. 컬럼 스타일을 CSS에서 관리.
