# synthetic 모델 표시 ADR

## ADR-001: 'synthetic' 모델 값 표시 방식

### 상태
**결정됨** (2026-04-19)

### 배경
Model 컬럼에 'synthetic'이라는 값이 표시되어 사용자에게 혼란을 줌. 'synthetic'은 낶부 처리를 의미하나, 일반 사용자에게는 직관적이지 않음.

### 고려한 옵션

| 옵션 | 설명 | 장점 | 단점 |
|------|------|------|------|
| A. 숨기기 | '—'로 표시 | 깔끔함, 혼란 제거 | 낶부 처리 중임을 알 수 없음 |
| B. 친화적 텍스트 | '낶부 처리'로 표시 | 의미 명확 | 텍스트 길이 증가 |
| C. 특수 배지 | 'synthetic'을 배지 스타일로 표시 | 시각적 구분 | 여전히 'synthetic' 용어 사용 |
| D. 아이콘+툴팁 | 아이콘으로 표시, 툴팁에 설명 | 공간 효율적 | 호버 필요, 발견성 낮음 |

### 결정
**옵션 A (숨기기)** 채택 — 'synthetic'을 '—'로 표시

### 이유
1. **Signal over Noise 원칙**: 'synthetic'은 시스템 낶부 값으로 사용자가 actionable한 정보가 아님
2. **일관성**: 이미 `!r.model`인 경우 '—'로 표시 중, 동일 패턴 적용
3. **간결성**: Model 컬럼은 실제 모델명(Claude 4.x 등) 표시에 집중
4. **혼란 방지**: '낶부 처리' 등의 텍스트도 여전히 불필요한 정보

### 구현 방식
```javascript
export function makeModelCell(r) {
  if (!r.model || r.model === 'synthetic') {
    return `<td class="cell-model cell-empty">—</td>`;
  }
  return `<td class="cell-model"><span class="model-name">${escHtml(r.model)}</span></td>`;
}
```

### 대안 검토
- 'synthetic'이 특별한 의미(로컬 처리, 서버리스 등)를 가질 경우 옵션 B 고려
- 현재는 단순 낶부 마커로 판단하여 숨김 처리
