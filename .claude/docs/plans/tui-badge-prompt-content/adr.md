# ADR-010: TUI 뱃지 및 프롬프트 내용 표시 개선

## 상태
**승인됨** (2026-04-18)

---

## 배경

현재 spyglass TUI의 4개 컴포넌트(LiveTab, HistoryTab, RequestList, AnalysisTab)에 타입 뱃지 표시 로직이 중복되어 있습니다. 또한 사용자가 어떤 프롬프트를 입력했는지 내용이 표시되지 않아 사용성이 제한적입니다.

### 현재 중복 로직 예시
```typescript
// 4개 파일에서 동일 패턴 반복
function typeColor(type: string): string {
  if (type === 'prompt') return 'cyan';
  if (type === 'tool_call') return 'yellow';
  return 'gray';
}
```

### 요구사항
- Java 개발자 친화적인 클래스 기반 모듈화
- 중복 로직 제거 및 단일 책임 원칙 적용
- 사용자 프롬프트 내용 표시 기능 추가

---

## 고려한 옵션

| 옵션 | 설명 | 장점 | 단점 |
|------|------|------|------|
| A. 순수 함수 모듈 | 개별 export 함수 | 간단함, tree-shaking 우수 | Java 개발자에게 덜 익숙, 응집도 낮음 |
| B. 클래스(정적 메서드) | `BadgeFormatter.getColor()` | Java 친화적, 응집도 높음, 네임스페이스 제공 | 상속/다형성 제한 |
| C. 클래스(인스턴스 + DI) | 생성자 주입 패턴 | 런타임 설정 가능, DI 패턴 | 현재 요구사항에 과도한 설계 |
| D. Hook 기반 | `useBadge()` | React 관용구 익숙 | 단순 매핑에 과도, 클래스 요구사항 불일치 |

---

## 결정

**Option B: 클래스 기반 정적 메서드 패턴 채택**

### 클래스 설계

```typescript
// packages/tui/src/formatters/RequestTypeFormatter.ts
export type RequestType = 'prompt' | 'tool_call' | 'system';

const TYPE_CONFIG = {
  prompt: { label: 'P', color: 'cyan', desc: 'Prompt' },
  tool_call: { label: 'T', color: 'yellow', desc: 'Tool' },
  system: { label: 'S', color: 'gray', desc: 'System' },
} as const satisfies Record<RequestType, { label: string; color: string; desc: string }>;

export class RequestTypeFormatter {
  private static readonly CONFIG = TYPE_CONFIG;
  
  static getLabel(type: RequestType): string {
    return this.CONFIG[type]?.label ?? '?';
  }
  
  static getColor(type: RequestType): string {
    return this.CONFIG[type]?.color ?? 'white';
  }
  
  static getDescription(type: RequestType): string {
    return this.CONFIG[type]?.desc ?? type;
  }
  
  static formatBadge(type: RequestType): { label: string; color: string } {
    return { label: this.getLabel(type), color: this.getColor(type) };
  }
  
  static getAllTypes(): RequestType[] {
    return Object.keys(this.CONFIG) as RequestType[];
  }
}
```

### 파일 구조

```
packages/tui/src/
├── formatters/
│   ├── RequestTypeFormatter.ts    # 타입 뱃지 색상/레이블
│   ├── TokenFormatter.ts          # 토큰 수량 포맷팅
│   ├── TimeFormatter.ts           # 시간/날짜 포맷팅
│   └── index.ts                   # 통합 export
├── components/
│   ├── LiveTab.tsx                # RequestTypeFormatter 사용
│   ├── HistoryTab.tsx             # RequestTypeFormatter 사용
│   ├── AnalysisTab.tsx            # RequestTypeFormatter 사용
│   └── RequestList.tsx            # RequestTypeFormatter 사용
```

### 프롬프트 내용 표시 설계

**데이터 모델 수정 (schema.ts)**
```typescript
export interface Request {
  // ... existing fields
  preview?: string;        // 표시용 축약 내용 (100자 제한)
}
```

**UI 표시 전략**
| 컴포넌트 | 현재 | 개선안 |
|---------|------|--------|
| LiveTab | tool_name만 표시 | tool_name + preview 2줄 |
| HistoryTab | Type/Tool/Tokens/Time | Description 컬럼 추가 |
| RequestList | description 필드 존재 | 데이터 연결 필요 |

---

## 이유

1. **Java 개발자 친화적**: `ClassName.staticMethod()` 패턴은 Java 개발자에게 매우 익숙
2. **타입 안전성**: `RequestType` union type으로 컴파일 타임 검증
3. **단일 책임 원칙**: 각 Formatter 클래스는 하나의 포맷팅 책임만 담당
4. **확장성**: 새로운 타입 추가 시 `TYPE_CONFIG`에 항목만 추가
5. **테스트 용이성**: 정적 메서드는 단위 테스트가 간단함

---

## 대안 채택 시 영향

- **Option A (순수 함수)**: 클래스 캡슐화 없음, Java 개발자 요구사항 미충족
- **Option C (인스턴스 + DI)**: 불필요한 복잡성, 현재는 오버엔지니어링
- **Option D (Hook)**: React 의존성 불필요, 순수 유틸리티로 충분

---

## 참고

- 전문가 회의 산출물 (3명 전문가 Round 1 분석)
- Java 개발자 관점에서의 클래스 기반 설계 요구사항
- lazygit 스타일 레이아웃 (PRD 참조)
